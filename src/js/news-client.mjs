// Solfall Launcher — cliente del feed de noticias (PoC, sin dependencias).
// Funciona en: Electron (main o renderer), webview de Tauri, Android WebView/TWA, Node >= 18.
//   - fetch con timeout (AbortController)
//   - ETag / If-None-Match  -> 304 = usar caché sin re-descargar
//   - caché offline mediante un "storage adapter" (localStorage, archivo, etc.)
//   - fallback: red -> caché -> feed embebido en el binario -> lista vacía
//   - filtra por min_launcher_version, platforms y expires_at; ordena pinned + fecha
//   - buildView(): destacada, roadmap (3 filas + .lbl), «Last update · hito» + Patch notes (spec Dirección C «Lite» §4.4)
//   - Formatos aceptados: v3 (content/news.json del repo, editado a mano desde GitHub; recomendado) y v2 (legado).
// IMPORTANTE (v2): body_md es Markdown NO confiable -> renderizar con un parser que
// escape HTML (p. ej. markdown-it {html:false}) + DOMPurify antes de insertar en el DOM.

const CACHE_KEY = 'solfall.news.cache.v3';
export const SCHEMA_VERSION = 3;
export const SUPPORTED_SCHEMA_VERSIONS = [2, 3];
/** URL por defecto del feed v3 (archivo editado a mano en GitHub; raw.githubusercontent.com cachea ~5 min). */
export const DEFAULT_NEWS_URL = 'https://raw.githubusercontent.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/main/content/news.json';

/** Estado del roadmap -> etiqueta .lbl de la spec (Dirección C «Lite», §3.5). */
export const STATUS_LABELS = {
  done: { text: 'Done', cls: 'lbl ok' },
  in_progress: { text: 'In progress', cls: 'lbl sun' },
  next_up: { text: 'Next up', cls: 'lbl' },
  planned: { text: 'Planned', cls: 'lbl vio' },
};
const label = (status) => STATUS_LABELS[status] || null;

/** Compara semver simple "x.y.z" (ignora prerelease). Devuelve -1/0/1. */
export function compareVersions(a, b) {
  const pa = String(a).split(/[-+]/)[0].split('.').map(Number);
  const pb = String(b).split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Storage adapter basado en localStorage (renderer/webview). */
export function localStorageAdapter(ls = globalThis.localStorage) {
  return {
    async get(k) { const v = ls.getItem(k); return v ? JSON.parse(v) : null; },
    async set(k, v) { ls.setItem(k, JSON.stringify(v)); },
  };
}

/** Storage adapter basado en archivo (Electron main / Node). */
export async function fileStorageAdapter(dir) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(dir, { recursive: true });
  const f = (k) => path.join(dir, k.replace(/[^a-z0-9.-]/gi, '_') + '.json');
  return {
    async get(k) { try { return JSON.parse(await fs.readFile(f(k), 'utf8')); } catch { return null; } },
    async set(k, v) { const tmp = f(k) + '.tmp'; await fs.writeFile(tmp, JSON.stringify(v)); await fs.rename(tmp, f(k)); },
  };
}

function isValidFeed(feed) {
  if (!feed || typeof feed !== 'object') return false;
  if (feed.schema_version === 3) {
    return 'featured' in feed && (feed.featured === null || (typeof feed.featured === 'object' && !!feed.featured.title))
      && Array.isArray(feed.roadmap) && Array.isArray(feed.patch_notes);
  }
  return feed.schema_version === 2 && Array.isArray(feed.items)
    && !!feed.featured && Array.isArray(feed.roadmap?.items);
}

const httpsOrNull = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);
const slug = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const dateText = (d, timeZone) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: timeZone || 'UTC' });

/** v3: content/news.json editado a mano. Secciones vacías (null / []) -> null en la vista (la UI las oculta). */
function buildViewV3(feed, opts) {
  const links = Object.fromEntries(Object.entries(feed.links || {}).map(([k, v]) => [k, httpsOrNull(v)]));
  const f = feed.featured;
  const rows = feed.roadmap.filter((r) => r && r.title).slice(0, 3).map((r) => ({ id: slug(r.title), title: r.title, status: r.status, when: r.when || null, label: label(r.status) }));
  let host = null; try { host = links.roadmap ? new URL(links.roadmap).hostname : null; } catch { /* sin host */ }
  const items = feed.patch_notes
    .filter((p) => p && p.title && /^\d{4}-\d{2}-\d{2}$/.test(p.date || ''))
    .map((p, i) => ({ i, id: `${p.date}-${slug(p.title)}`, kind: p.kind || null, title: p.title, date: p.date, summary: Array.isArray(p.summary) ? p.summary.slice(0, 3) : [], url: httpsOrNull(p.url) || links.patch_notes || null }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.i - b.i))
    .map(({ i, ...p }) => p);
  const last = items[0];
  return {
    featured: f ? { title: f.title, body: f.text, text: f.text, status: f.status || null, url: httpsOrNull(f.url), image: httpsOrNull(f.image), label: label(f.status) } : null,
    roadmap: rows.length ? { source_label: host ? `from ${host.replace(/^www\./, '')}` : null, source_url: links.roadmap || null, rows } : null,
    lastUpdate: last ? { date: last.date, dateText: dateText(last.date, opts.timeZone), milestone: last.title, url: last.url, id: last.id } : null,
    items,
    links,
    updated: feed.updated || null,
  };
}

/** Filtra y ordena según la versión/plataforma del launcher. */
export function selectItems(feed, { launcherVersion, platform, now = new Date() }) {
  if (!isValidFeed(feed)) return [];
  return feed.items
    .filter((it) => it && it.id && it.title && it.date)
    .filter((it) => !it.min_launcher_version || compareVersions(launcherVersion, it.min_launcher_version) >= 0)
    .filter((it) => !it.platforms || it.platforms.includes(platform))
    .filter((it) => !it.expires_at || new Date(it.expires_at) > now)
    .sort((a, b) => (b.pinned === true) - (a.pinned === true) || new Date(b.date) - new Date(a.date));
}

/**
 * Arma lo que pinta la UI de la spec:
 *  - featured: panel «Featured transmission» (+ label .lbl)
 *  - roadmap: 3 primeras filas (+ label .lbl) y rótulo «from solfall.online»
 *  - lastUpdate: «Last update 03 Nov · Salvage» + enlace «Patch notes →» (último item kind=patch)
 *  - items: lista completa filtrada (vista Log, fase 2)
 */
export function buildView(feed, opts) {
  if (!isValidFeed(feed)) return { featured: null, roadmap: null, lastUpdate: null, items: [], links: {} };
  if (feed.schema_version === 3) return buildViewV3(feed, opts);
  const items = selectItems(feed, opts);
  const patch = items.filter((i) => i.kind === 'patch').sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  return {
    featured: { ...feed.featured, label: label(feed.featured.status) },
    roadmap: {
      source_label: feed.roadmap.source_label || null,
      source_url: feed.roadmap.source_url || null,
      rows: feed.roadmap.items.slice(0, 3).map((r) => ({ ...r, label: label(r.status) })),
    },
    lastUpdate: patch ? {
      date: patch.date,
      // «03 Nov» en inglés británico como el mockup
      dateText: new Date(patch.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: opts.timeZone }),
      milestone: patch.milestone || patch.title, url: patch.url || null, id: patch.id,
    } : null,
    items,
    links: {},
  };
}

export function createNewsClient({
  url = DEFAULT_NEWS_URL,       // v3: raw de GitHub (content/news.json); v2: https://<dominio-solfall>/launcher/news.json
  launcherVersion,              // p. ej. app.getVersion()
  platform,                     // 'windows' | 'android'
  storage,                      // adapter {get,set}
  bundledFallback = null,       // feed embebido en el build (opcional)
  platformTag,                  // cabecera X-Launcher-Platform (contrato: windows-tauri | windows-electron | android-twa)
  timeZone,                     // para «03 Nov» (por defecto la del sistema)
  timeoutMs = 6000,
  fetchImpl = globalThis.fetch,
}) {
  if (!launcherVersion || !platform || !storage) throw new Error('news-client: faltan parámetros');

  async function fetchNews() {
    const cached = await storage.get(CACHE_KEY); // { etag, feed, fetchedAt }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = { Accept: 'application/json', 'X-Launcher-Version': launcherVersion, 'X-Launcher-Platform': platformTag || platform };
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      const res = await fetchImpl(url, { headers, signal: ctrl.signal, cache: 'no-cache' });
      if (res.status === 304 && cached?.feed) {
        await storage.set(CACHE_KEY, { ...cached, fetchedAt: new Date().toISOString() });
        return result(cached.feed, 'not-modified', false);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // raw.githubusercontent.com sirve text/plain: se parsea el texto. Un JSON roto por una edición a mano -> caché.
      const text = await res.text();
      let feed; try { feed = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { throw new Error(`JSON inválido en el feed: ${e.message}`); }
      if (!isValidFeed(feed)) throw new Error(`feed inválido (schema_version ${feed?.schema_version}; se acepta ${SUPPORTED_SCHEMA_VERSIONS.join(' o ')})`);
      await storage.set(CACHE_KEY, { etag: res.headers.get('etag'), feed, fetchedAt: new Date().toISOString() });
      return result(feed, 'network', false);
    } catch (err) {
      if (cached?.feed) return result(cached.feed, 'cache', true, err);
      if (isValidFeed(bundledFallback)) return result(bundledFallback, 'bundled', true, err);
      return { featured: null, roadmap: null, lastUpdate: null, items: [], links: {}, source: 'none', stale: true, error: String(err?.message || err) };
    } finally {
      clearTimeout(timer);
    }
  }

  function result(feed, source, stale, err) {
    return { ...buildView(feed, { launcherVersion, platform, timeZone }), source, stale, error: err ? String(err.message || err) : null, example: feed._example === true };
  }

  return { fetchNews };
}
