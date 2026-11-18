// SOLFALL Launcher — UI and state machine (launcher-spec §4, animation-spec). No dependencies, no bundler.
// data-state: main · launcher-update · update (blocking) · error. "Ready" is a SUB-STATE of main (S.ready → .lu.ready/#bRestart).
// data-view="settings": Settings view on top of any state.
import { createNewsClient, localStorageAdapter, compareVersions, DEFAULT_NEWS_URL } from './news-client.mjs';
import { LINKS } from './config.js';

const T = window.__TAURI_INTERNALS__;
const invoke = (cmd, args) => T ? T.invoke(cmd, args) : Promise.reject(new Error('no Tauri'));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MB = (b) => (b / 1048576).toFixed(b >= 10 * 1048576 ? 0 : 1);
const MANIFEST_CACHE = 'solfall.manifest.cache.v1';

// Exact copy from launcher-spec §4.2 (proposal copy, British English).
const COPY = {
  main:  { h1: 'Star’s up. <em>Engines warm.</em>', lede: 'Everything checks out on the board. The galaxy kept turning while you were away, so mind the traffic.',
           jamie: '“Tanks topped up and the star’s on our six. Your call, pilot.”' },
  'launcher-update': { h1: 'Star’s up. <em>Engines warm.</em>', lede: null, jamie: '“New firmware’s coming down the wire. Fly on, I’ll swap it in later.”' },
  update: { h1: 'Refitting <em>the bridge.</em>', lede: 'The launcher is fitting its new build. Sit tight, you’ll be back in the air in a few seconds.',
            jamie: '“Quick refit on the console, pilot. Kettle’s on, back in a tick.”' },
  error: { h1: 'No signal. <em>Stand by.</em>', lede: 'The bridge can’t reach the galaxy. We’ll keep knocking. You can retry or check the status board.',
           jamie: '“Comms are dead, pilot. Not our hull. Give it a moment and try again.”' },
};

const READY_COPY = { h1: 'Star’s up. <em>Engines warm.</em>', lede: null, jamie: '“Console update’s ready when you are, pilot. No rush at all.”' };
const S = {
  state: 'main', info: null, manifest: null, pingMs: null, upd: null, prog: { downloaded: 0, total: 0 },
  attempt: 0, err: null, notice: null, lastPatch: null, feedLinks: {}, forced: false, graceTimer: null, t0: 0, ready: false, checkedAt: null,
  set: { autostart: false, start_minimized: false, close_action: 'quit', game_fullscreen: false, on_launch: 'replace', auto_update: true,
         window_size: '1440x900', remember_window: true, ui_scale: 'auto', reduce_motion: null, volume: 0.8, music: false, music_volume: 0.6 },
};

// ---------- render ----------
function setPill(kind, html) { const p = $('pill'); p.className = 'pill' + (kind ? ' ' + kind : ''); $('pillText').innerHTML = html; }

function render() {
  const st = S.state, c = (st === 'main' && S.ready) ? READY_COPY : COPY[st];
  $('app').dataset.state = st;
  $('h1').innerHTML = c.h1;
  $('lede').textContent = c.lede ?? COPY.main.lede;
  $('jamie').textContent = c.jamie;
  const v = esc(S.info?.version ?? '—'), nv = esc(S.upd?.version ?? '—');
  const lp = $('launchp'); lp.classList.toggle('errp', st === 'error');
  const ping = S.pingMs != null ? ` · ping <span class="n" title="manifest.json round trip (not the game server ping)">${S.pingMs}</span> ms` : '';
  if (st === 'update') setPill('warn', `Launcher updating · <span class="n">${v} → ${nv}</span>`);
  else if (st === 'error') setPill('bad', `Galaxy unreachable · <span class="n">${esc(S.err?.code ?? 'SF-NET-000')}</span>`);
  else setPill('', `Galaxy online${ping}`);

  const launchBtn = (label = 'LAUNCH', extra = '') => `<div class="launch" role="button" tabindex="0" id="bLaunch" ${extra}><span class="tri"></span>${label}</div>`;
  const pct = S.prog.total ? Math.floor(100 * S.prog.downloaded / S.prog.total) : 0;
  let h = '';
  if (st === 'main') {
    const lp = S.lastPatch;
    h = `<div class="ptitle">Pre-flight<span class="r">All green</span></div>
      <div class="meta"><span>Launcher <b class="num">${v}</b></span>${S.ready ? '<span style="color:var(--ok)">✓ Ready to fly</span>' : S.notice ? `<span class="notice" title="${esc(S.notice.detail || '')}" style="color:${S.notice.bad ? 'var(--bad)' : 'var(--sun)'}">⚠ ${esc(S.notice.text)}</span>` : '<span style="color:var(--ok)">✓ Up to date</span>'}</div>
      <div class="btnrow">${launchBtn()}<div class="sq" role="button" tabindex="0" title="Settings" data-settings>⚙</div></div>
      ${S.ready ? `<div class="lu ready"><span class="lu-t">✓ Launcher <b class="num">${nv}</b> ready</span><button class="btn2 sm sun" type="button" id="bRestart">⟳ Restart to apply</button></div>` : ''}
      ${lp ? `<div class="foot"><span>Last update ${esc(lp.date)} · ${esc(lp.title)}</span>${patchUrl() ? '<a href="#" id="aPatch">Patch notes →</a>' : ''}</div>` : ''}`;
  } else if (st === 'launcher-update') {
    h = `<div class="ptitle">Pre-flight<span class="r">All green</span></div>
      <div class="meta"><span>Launcher <b class="num">${v}</b></span><span style="color:var(--ok)">✓ Ready to fly</span></div>
      <div class="btnrow">${launchBtn()}<div class="sq" role="button" tabindex="0" title="Settings" data-settings>⚙</div></div>
      <div class="lu"><span class="lu-t">Launcher <b class="num">${nv}</b> downloading in background · <b class="num">${pct} %</b></span><span class="lu-r">Keep flying</span></div>
      <div class="bar thin"><i style="--p:${pct / 100}"></i></div>`;
  } else if (st === 'update') {
    // Blocking: if the package is already downloaded it shows 100 % and a grace countdown
    // (Cancel goes back to ready); if mandatory (min_launcher_version / kill switch) it downloads here.
    const left = S.graceLeft != null ? `00:0${Math.max(0, S.graceLeft)}` : '--:--';
    const notes = S.upd?.notes ? esc(S.upd.notes) : '';
    h = `<div class="ptitle" style="--c:var(--sun)">Launcher update<span class="r"><span class="num">${pct}%</span></span></div>
      <div class="meta"><span>Launcher <b class="num">${v}</b> → <b class="num" style="color:var(--sun)">${nv}</b></span><span><b class="num">${MB(S.prog.downloaded)}</b> / <b class="num">${MB(S.prog.total || 0)} MB</b> · <b class="num">${left}</b> left</span></div>
      <div class="bar sun"><i style="--p:${pct / 100}"></i></div>
      ${notes ? `<div class="lu-notes"><span>${notes}</span></div>` : ''}<div class="lu-links">${S.upd?.notes_url || patchUrl() ? '<a href="#" class="wn" id="aWhatsNew">What’s new →</a>' : '<span></span>'}${S.forced ? '' : '<a class="cancel" href="#" id="aCancel">Cancel</a>'}</div>
      <div class="btnrow"><div class="launch off" aria-disabled="true"><span class="tri"></span>UPDATING</div><div class="sq busy" role="status" aria-label="Applying update"><span class="spin"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></div></div>`;
  } else if (st === 'error') {
    const e = S.err || {};
    h = `<div class="ptitle" style="--c:var(--bad)">Link lost<span class="r">Attempt <span class="num">${S.attempt}</span></span></div>
      <div style="margin:12px 0 10px;display:flex;align-items:center;gap:12px"><span class="code">${esc(e.code)}</span><span style="font:600 14px var(--f-display);letter-spacing:.16em;color:var(--ink-2);text-transform:uppercase">${esc(e.title || 'Galaxy server not responding')}</span></div>
      <div class="diag"><span><i class="lbl ${navigator.onLine ? 'ok' : 'bad'}">${navigator.onLine ? 'OK' : 'Down'}</i> Connection</span><span><i class="lbl ok">OK</i> Files</span><span><i class="lbl bad">Down</i> ${esc(e.what || 'Launcher service')}</span></div>
      <div class="btnrow">${launchBtn('RETRY', 'style="font-size:32px"')}<div class="sq" role="button" tabindex="0" title="Diagnostics" id="bDiag">⟲</div></div>
      <div style="display:flex;gap:10px;margin-top:12px">${link('status') ? '<a class="btn2 sm" href="#" id="aStatus">Status page ↗</a>' : ''}<a class="btn2 sm" href="#" id="aDiscord">Discord ↗</a></div>
      <div style="margin-top:10px;font:500 13px var(--f-body);color:var(--ink-3)">Game might still answer · <a href="#" id="aLaunchAnyway" style="color:var(--holo);text-decoration:none">Launch anyway →</a></div>`;
  }
  $('launchBody').innerHTML = h;
  wire();
}

// State swap: fade out → swap → fade in (WAAPI, opacity only). Same-state re-renders (progress) are instant.
const reduced = () => $('app').dataset.motion === 'reduced' || ($('app').dataset.motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
let swapping = Promise.resolve();
function go(state) {
  if (state === 'launcher-update-ready') { S.ready = true; state = 'main'; } // 0.2.0: ready is a sub-state of main
  const key = state + (S.ready ? ':ready' : '') + (S.notice ? ':n' : '');
  if (key === S.lastKey) { S.state = state; render(); return swapping; }
  S.lastKey = key;
  const els = ['launchBody', 'h1', 'lede', 'jamie', 'pill'].map($).filter(Boolean);
  const dur = reduced() ? { duration: 80 } : { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)' };
  swapping = swapping.then(async () => {
    if (document.hidden) { S.state = state; render(); return; }
    await Promise.all(els.map(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { ...dur, fill: 'forwards' }).finished.catch(() => {})));
    S.state = state; render();
    els.forEach(el => { el.getAnimations().forEach(a => a.cancel()); el.animate([{ opacity: 0 }, { opacity: 1 }], dur); });
  });
  console.log('[state]', state + (S.ready ? ' (ready)' : ''));
  log('state ' + state + (S.ready ? ' ready' : '') + (S.notice ? ' notice=' + S.notice.text : ''));
  return swapping;
}
const log = (m) => invoke('ui_log', { msg: m }).catch(() => {});

// ---------- acciones ----------
function wire() {
  const on = (id, f) => { const el = $(id); if (el) { el.onclick = (e) => { e.preventDefault(); f(); }; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f(); } }; } };
  on('bLaunch', () => S.state === 'error' ? boot(true) : launch());
  on('bRestart', startBlockingUpdate);
  on('aCancel', cancelBlockingUpdate);
  on('aPatch', () => openLink(patchUrl()));
  on('aWhatsNew', () => openLink(S.upd?.notes_url || patchUrl()));
  on('bDiag', () => boot(true));
  on('aLaunchAnyway', launch);
  on('aStatus', () => openLink(link('status')));
  on('aDiscord', () => openLink(link('discord')));
  document.querySelectorAll('#launchBody [data-settings]').forEach(el => { el.onclick = () => openSettings(); el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSettings(); } }; });
}
const IS_MAC = () => S.info?.platform === 'macos';
// Windows wording in index.html → macOS / Linux wording (text nodes only; no markup changes).
function platformCopy() {
  const p = S.info?.platform; if (!p || p === 'windows') return;
  const mac = p === 'macos';
  const map = [['Start with Windows', 'Start at login'], ['when you sign in to Windows', 'when you log in'],
    ['Match Windows', 'Match system'], ['Follows Windows', 'Follows the system'], ['F11', FS_KEY()],
    ...(mac ? [['to the tray', 'to the menu bar'], ['Tray icon menu', 'Menu bar icon menu'], ['In tray', 'In menu bar'], ['the tray', 'the menu bar']] : [])];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { let t = n.nodeValue; for (const [a, b] of map) t = t.split(a).join(b); if (t !== n.nodeValue) n.nodeValue = t; }
  document.querySelectorAll('[title]').forEach(el => { let t = el.title; for (const [a, b] of map) t = t.split(a).join(b); el.title = t; });
}
const FS_KEY = () => (IS_MAC() ? '⌃⌘F' : 'F11');
function openLink(u) { if (u) invoke('open_link', { url: u }).catch(() => {}); }
// ---------- links: news.json "links" (remote/cache/bundled) → manifest "links" → src/js/config.js. null = hidden.
// Only https URLs are used (Rust open_link additionally allows only known hosts).
const FEED_KEY = { web: 'website', patchNotes: 'patch_notes', roadmap: 'roadmap', patreon: 'patreon', discord: 'discord', status: 'status' };
const https = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);
function link(key) {
  return https(S.feedLinks?.[FEED_KEY[key] || key]) || https(S.manifest?.links?.[key]) || https(LINKS[key]) || null;
}
const patchUrl = () => https(S.lastPatch?.url) || link('patchNotes');
function applyLinks() {
  document.querySelectorAll('[data-link]').forEach(a => { const u = link(a.dataset.link); a.hidden = !u; });
}

async function launch() {
  const url = S.manifest?.game?.url || S.info.default_game_url;
  // "Open in this window": the launcher UI is discarded by the navigation (nothing of it stays in memory).
  music.pause();
  try { const mode = await invoke('launch_game', { url }); log('launch mode=' + mode); } catch (e) { S.err = { code: 'SF-LCH-001', title: String(e), what: 'Game URL' }; go('error'); }
}

function startBlockingUpdate() {
  go('update');
  S.graceLeft = 3; render();
  clearInterval(S.graceTimer);
  S.graceTimer = setInterval(async () => {
    S.graceLeft -= 1; render();
    if (S.graceLeft <= 0) {
      clearInterval(S.graceTimer); S.graceTimer = null;
      try { await invoke('apply_update'); } catch (e) { S.err = { code: 'SF-UPD-002', title: 'Update could not be applied', what: String(e).slice(0, 40) }; go('error'); }
    }
  }, 1000);
}
function cancelBlockingUpdate() { clearInterval(S.graceTimer); S.graceTimer = null; S.graceLeft = null; S.ready = true; go('main'); }

// ---------- boot ----------
async function fetchManifest(base) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 6000);
  const t0 = performance.now();
  try {
    const r = await fetch(base + '/manifest.json', { signal: ctl.signal, cache: 'no-cache',
      headers: { 'X-Launcher-Version': S.info.version, 'X-Launcher-Platform': 'windows-tauri' } });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { code: 'SF-NET-' + r.status });
    const m = await r.json();
    S.pingMs = Math.round(performance.now() - t0);
    localStorage.setItem(MANIFEST_CACHE, JSON.stringify(m));
    return { m, cached: false };
  } catch (e) {
    const cached = localStorage.getItem(MANIFEST_CACHE);
    if (cached) return { m: JSON.parse(cached), cached: true, error: e };
    throw Object.assign(e, { code: e.code || (e.name === 'AbortError' ? 'SF-NET-408' : 'SF-NET-000') });
  } finally { clearTimeout(to); }
}

async function loadNews(m) {
  let bundled = null;
  try { bundled = await (await fetch('js/news.bundled.json')).json(); } catch {}
  // The feed is fetched by Rust (fetch_news, fixed URL = DEFAULT_NEWS_URL, ETag): GitHub raw rejects the CORS
  // preflight that custom headers / If-None-Match would trigger from the page.
  const rustFetch = async (url, { headers } = {}) => {
    if (url !== DEFAULT_NEWS_URL) throw new Error('news URL not allowed');
    const r = await invoke('fetch_news', { etag: headers?.['If-None-Match'] || null });
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: (k) => (/^etag$/i.test(k) ? r.etag : null) }, text: async () => r.body || '' };
  };
  const client = createNewsClient({ url: DEFAULT_NEWS_URL, launcherVersion: S.info.version, platform: S.info.platform, platformTag: S.info.platform + '-tauri',
    storage: localStorageAdapter(), bundledFallback: bundled, timeoutMs: 7000, fetchImpl: rustFetch });
  const v = await client.fetchNews();   // news.json v2 → buildView(): featured, roadmap, lastUpdate, items
  console.log('[news]', v.source, 'items=' + v.items.length, v.error || '');
  log('news source=' + v.source + ' items=' + v.items.length + (v.error ? ' (' + String(v.error).slice(0, 80) + ')' : ''));
  S.newsSource = v.source;
  const real = !v.example; // a feed marked _example is never shown in a release build
  S.feedLinks = real ? (v.links || {}) : {};
  const f = real ? v.featured : null;
  $('featP').hidden = !f;
  if (f) {
    $('featTitle').textContent = f.title || '';
    $('featText').textContent = f.text || f.body || '';
    $('featTag').hidden = !f.label; if (f.label) { $('featTag').textContent = f.label.text; $('featTag').className = f.label.cls; }
    if (https(f.image)) $('featImg').src = f.image;
  }
  const rows = real && v.roadmap ? v.roadmap.rows.filter(r => r.title && r.label) : [];
  $('roadP').hidden = !rows.length;
  if (rows.length) {
    $('roadSrc').textContent = v.roadmap.source_label || '';
    $('roadRows').innerHTML = rows.map(r => `<div class="it"><span class="${esc(r.label.cls)}">${esc(r.label.text)}</span>${esc(r.title)}</div>`).join('');
  }
  S.lastPatch = real && v.lastUpdate ? { date: v.lastUpdate.dateText, title: v.lastUpdate.milestone, url: v.lastUpdate.url } : null;
  document.querySelector('.rcol').hidden = $('featP').hidden && $('roadP').hidden;
  applyLinks();
  if (S.state === 'main' || S.state === 'error') render();
}

// Game reachability WITHOUT interacting with it: a no-cors HEAD (opaque response; only network/server matter).
async function gameReachable(url) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
  try { await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctl.signal }); return true; }
  catch { return false; } finally { clearTimeout(to); }
}

async function boot(isRetry = false) {
  S.attempt = isRetry ? S.attempt + 1 : 1;
  S.info = S.info || await invoke('launcher_info');
  if (S.info.demo_state) return demo(S.info.demo_state);
  S.notice = null; S.err = null;
  // Manifest / news / updates NEVER block the game: on failure, a non-blocking notice and LAUNCH stays enabled.
  let mres = null;
  try { mres = await fetchManifest(S.info.launcher_base); }
  catch (e) { console.warn('[manifest] unavailable (non-blocking):', e.code, e.message); log('manifest unavailable ' + (e.code || '')); S.manifestFailed = true; }
  const m = S.manifest = mres?.m || null;
  const gameUrl = m?.game?.url || S.info.default_game_url;
  if (m?.game?.status && m.game.status !== 'online') {
    S.err = { code: 'SF-GAME-' + String(m.game.status).toUpperCase().slice(0, 8), title: m.game.status_message || 'Galaxy server not responding', what: 'Game server' };
    go('error'); loadNews(m).catch(() => {}); return;
  }
  // Full error state only if play.solfall.online does not answer (spec: "the galaxy is not responding").
  if (!(await gameReachable(gameUrl))) {
    S.err = { code: 'SF-NET-000', title: 'Galaxy server not responding', what: 'Game server' };
    go('error'); loadNews(m).catch(() => {}); return;
  }
  applyLinks();
  go('main');
  loadNews(m).catch(e => console.warn('news', e));
  // Updates: ALWAYS checked. The manifest may suggest an endpoint (Rust validates it against an allowlist);
  // without manifest (or if not allowed) the compiled endpoints (GitHub Releases) are used.
  const minV = m?.min_launcher_version?.windows; const blocked = (m?.kill_switch?.blocked_versions || []).includes(S.info.version);
  S.forced = !!(blocked || (minV && compareVersions(S.info.version, minV) < 0));
  if (!S.set.auto_update && !S.forced) { S.updMsg = 'Automatic updates off · use Check now'; renderSettings(); return; }
  await checkUpdates(m?.updates?.['windows-tauri']?.url || m?.updates?.windows?.url || null);
}

async function checkUpdates(ep) {
  if (S.updBusy || S.ready) return; S.updBusy = true; renderSettings();
  try {
    const u = await invoke('check_update', { endpoint: ep });
    S.checkedAt = new Date(); S.updMsg = u.available ? `Update ${u.version} found` : '✓ Up to date';
    console.log('[update] check', JSON.stringify(u)); log('update check available=' + u.available + (u.version ? ' version=' + u.version : ''));
    if (!u.available) { if (S.notice?.text === 'Updates unavailable') { S.notice = null; go('main'); } S.updBusy = false; renderSettings(); return; }
    S.upd = u; if (u.size) S.prog = { downloaded: 0, total: u.size };
    go(S.forced ? 'update' : 'launcher-update');
    const poll = setInterval(async () => {
      const s = await invoke('update_status'); S.prog = s;
      if (s.error) {
        clearInterval(poll); S.updBusy = false; console.warn('[update] error', s.error);
        const sig = /signature/i.test(s.error);
        S.notice = sig ? { text: 'Update rejected (invalid signature)', detail: String(s.error), bad: true } : { text: 'Update failed · retry next start', detail: String(s.error) };
        S.updMsg = S.notice.text; renderSettings();
        if (S.forced) { S.err = { code: sig ? 'SF-UPD-002' : 'SF-UPD-001', title: sig ? 'Update rejected (invalid signature)' : 'Update failed', what: 'Signature / download' }; go('error'); } else go('main');
        return;
      }
      if (s.ready) { clearInterval(poll); S.updBusy = false; S.updMsg = `✓ ${S.upd.version} ready · restart to apply`; renderSettings(); if (S.forced) startBlockingUpdate(); else { S.ready = true; go('main'); } return; }
      if (S.state === 'launcher-update' || S.state === 'update') render();
    }, 300);
    invoke('download_update').catch(e => console.warn('[update] download', e));
  } catch (e) {
    S.updBusy = false; S.checkedAt = new Date();
    console.warn('[update] check failed (does not block the game):', e); log('update check failed');
    S.notice = { text: 'Updates unavailable', detail: String(e).slice(0, 120) }; S.updMsg = '⚠ Updates unavailable';
    if (S.state === 'main') go('main'); renderSettings();
  }
}

// Screenshots only, when a state cannot be produced for real (SOLFALL_DEMO_STATE).
function demo(st) {
  S.pingMs = 38; S.upd = { version: '0.2.1', notes: null }; S.prog = { downloaded: 0.62 * 38 * 1048576, total: 38 * 1048576 };
  S.err = { code: 'SF-NET-503', title: 'Galaxy server not responding', what: 'Server eu-1' }; S.attempt = 3; S.graceLeft = 2;
  loadNews(null).catch(() => {}); if (st === 'launcher-update-ready') { S.ready = true; st = 'main'; } go(st);
}

// ---------- settings (persisted by Rust in <config>/online.solfall.launcher/settings.json) ----------
const LS_SET = 'solfall.settings.v1';
const music = $('music');
let playWanted = false;
async function loadSettings() {
  try { S.set = { ...S.set, ...(await invoke('get_settings')) }; }
  catch { try { S.set = { ...S.set, ...JSON.parse(localStorage.getItem(LS_SET) || '{}') }; } catch {} }
  applySettings();
}
let saveT = null;
function saveSettings() {
  applySettings(); renderSettings();
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    try { S.set = { ...S.set, ...(await invoke('set_settings', { settings: S.set })) }; flashSaved(); renderSettings(); syncWin(); log('settings saved ' + JSON.stringify(S.set)); }
    catch { localStorage.setItem(LS_SET, JSON.stringify(S.set)); flashSaved(); }
  }, 150);
}
function flashSaved() { const el = $('sSaved'); el.innerHTML = '<b>✓ Saved</b> · <b>Esc</b> to go back'; clearTimeout(flashSaved.t); flashSaved.t = setTimeout(() => { el.innerHTML = 'Changes save as you go · <b>Esc</b> to go back'; }, 1600); }
function applySettings() {
  const app = $('app');
  if (S.set.reduce_motion === true) app.dataset.motion = 'reduced'; else if (S.set.reduce_motion === false) app.dataset.motion = 'full'; else delete app.dataset.motion;
  music.volume = Math.min(1, Math.max(0, S.set.volume * S.set.music_volume));
  if (!S.set.music) { music.pause(); playWanted = false; } else tryPlay();
  $('wSound').classList.toggle('on', !!S.set.music);
  $('wSound').title = S.set.music ? 'Music on · click to mute' : 'Music off · click to play';
  $('np').classList.toggle('off', !S.set.music);
}
const SELECTS = { sOnLaunch: 'on_launch', sSize: 'window_size', sScale: 'ui_scale' };
const TOGGLES = { sAuto: 'autostart', sAutoMin: 'start_minimized', sFull: 'game_fullscreen', sAutoUpd: 'auto_update', sRemember: 'remember_window', sMusic: 'music' };
const SLIDERS = { sVol: 'volume', sMVol: 'music_volume' };
const osReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function renderSettings() {
  const v = S.info?.version ?? '—';
  $('sVer').textContent = v; $('sVer2').textContent = v;
  const dbg = !!(S.info?.debug_ui); $('sBuildRow').hidden = !dbg; // debug flag only (debug build / SOLFALL_DEBUG=1)
  if (dbg) $('sBuild').textContent = 'Debug · updater key ' + (S.info.pubkey_id || '-');
  $('sChecked').textContent = S.checkedAt ? 'Today · ' + S.checkedAt.toTimeString().slice(0, 5) : '—';
  const st = $('sUpdState'); st.textContent = S.updBusy ? '⟳ Checking…' : (S.updMsg || '—');
  st.style.color = /rejected|unavailable|failed/i.test(S.updMsg || '') ? 'var(--sun)' : /✓/.test(S.updMsg || '') ? 'var(--ok)' : 'var(--ink-3)';
  $('sCheck').classList.toggle('off', !!S.updBusy); $('sCheck').textContent = S.updBusy ? '⟳ Checking…' : '⟳ Check now';
  for (const [id, k] of Object.entries(TOGGLES)) $(id).setAttribute('aria-checked', String(!!S.set[k]));
  $('sMotion').setAttribute('aria-checked', String(S.set.reduce_motion ?? osReduced()));
  for (const [id, k] of Object.entries(SLIDERS)) { const p = Math.round(S.set[k] * 100); $(id).style.setProperty('--v', p + '%'); $(id).setAttribute('aria-valuenow', p); $(id + 'V').textContent = p; }
  for (const [id, k] of Object.entries(SELECTS)) {
    const w = $(id).parentElement; let label = '';
    w.querySelectorAll('[role=option]').forEach(o => { const on = o.dataset.v === S.set[k]; o.setAttribute('aria-selected', String(on)); if (on) label = o.textContent; });
    w.querySelector('.selt').textContent = label;
  }
  $('sClose').querySelectorAll('[role=radio]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === S.set.close_action)));
  // dependent rows
  $('sAutoMinRow').classList.toggle('dis', !S.set.autostart); $('sAutoMin').classList.toggle('off', !S.set.autostart);
  $('sMVolRow').classList.toggle('dis', !S.set.music);
  const big = S.win?.maximized || S.win?.fullscreen; $('sSize').classList.toggle('off', !!big);
  $('sSize').title = big ? 'Restore the window to change its size' : '';
}
function openSettings() {
  const app = $('app'), panel = $('settings');
  if (app.dataset.view === 'settings') return closeSettings();
  renderSettings(); panel.hidden = false; app.dataset.view = 'settings';
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('in')));
  setTimeout(() => $('sBack').focus(), 30); log('view settings');
}
function closeSettings() {
  const app = $('app'), panel = $('settings');
  if (app.dataset.view !== 'settings') return;
  closeLists(); panel.classList.remove('in');
  let fin = false;
  const done = () => { if (fin) return; fin = true; panel.hidden = true; delete app.dataset.view; $('wSettings').focus(); };
  panel.addEventListener('transitionend', function te(e) { if (e.target === panel && e.propertyName === 'opacity') { panel.removeEventListener('transitionend', te); done(); } });
  setTimeout(done, reduced() ? 90 : 320); // also covers a missing transitionend
  log('view main');
}
const act = (el, f) => { el.onclick = (e) => { e.preventDefault(); f(e); }; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f(e); } }; };
act($('sBack'), closeSettings);
for (const [id, k] of Object.entries(TOGGLES)) act($(id), () => {
  if (id === 'sAutoMin' && !S.set.autostart) return;
  S.set[k] = !S.set[k]; saveSettings();
});
act($('sMotion'), () => { S.set.reduce_motion = !(S.set.reduce_motion ?? osReduced()); saveSettings(); });
act($('sCheck'), () => { if (!S.updBusy) checkUpdates(S.manifest?.updates?.['windows-tauri']?.url || null, true); });
// segmented
const segBtns = [...$('sClose').querySelectorAll('[role=radio]')];
segBtns.forEach((b, i) => { act(b, () => { S.set.close_action = b.dataset.v; saveSettings(); });
  b.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault();
    const n = segBtns[(i + d + segBtns.length) % segBtns.length]; S.set.close_action = n.dataset.v; saveSettings(); n.focus(); }); });
// selects (listbox)
function closeLists() { document.querySelectorAll('.selw .lbx').forEach(l => { l.hidden = true; l.previousElementSibling.setAttribute('aria-expanded', 'false'); }); }
for (const [id, k] of Object.entries(SELECTS)) {
  const btn = $(id), lb = btn.nextElementSibling, opts = [...lb.querySelectorAll('[role=option]')];
  act(btn, () => { if (btn.classList.contains('off')) return; const open = lb.hidden; closeLists(); lb.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    opts.forEach(o => o.classList.toggle('act', o.dataset.v === S.set[k])); });
  opts.forEach(o => { o.onclick = () => { S.set[k] = o.dataset.v; closeLists(); saveSettings(); btn.focus(); }; });
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; e.preventDefault(); if (btn.classList.contains('off')) return;
    const i = opts.findIndex(o => o.dataset.v === S.set[k]); S.set[k] = opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length].dataset.v; saveSettings();
  });
}
document.addEventListener('click', (e) => { if (!e.target.closest('.selw')) closeLists(); });
// sliders
for (const [id, k] of Object.entries(SLIDERS)) {
  const el = $(id);
  const setV = (x) => { S.set[k] = Math.min(1, Math.max(0, Math.round(x * 100) / 100)); applySettings(); renderSettings(); };
  el.addEventListener('pointerdown', (e) => {
    if (el.closest('.dis')) return;
    el.setPointerCapture(e.pointerId); el.classList.add('is-press');
    const r = el.getBoundingClientRect(); const mv = (ev) => setV((ev.clientX - r.left) / r.width); mv(e);
    el.onpointermove = mv; el.onpointerup = () => { el.onpointermove = null; el.classList.remove('is-press'); saveSettings(); };
  });
  el.addEventListener('keydown', (e) => {
    const d = { ArrowRight: .05, ArrowUp: .05, ArrowLeft: -.05, ArrowDown: -.05, PageUp: .1, PageDown: -.1 }[e.key];
    if (e.key === 'Home') setV(0); else if (e.key === 'End') setV(1); else if (d) setV(S.set[k] + d); else return;
    e.preventDefault(); saveSettings();
  });
}
// focus trap inside the Settings dialog (titlebar stays reachable by mouse)
$('settings').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const f = [...$('settings').querySelectorAll('button:not([disabled]),[tabindex="0"],a')].filter(x => !x.closest('[hidden]'));
  if (!f.length) return; const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ---------- music (WebView2 runs with --autoplay-policy=no-user-gesture-required; fallback: first gesture) ----------
function tryPlay() {
  if (!S.set.music || document.hidden) return;
  playWanted = true;
  music.play().then(() => { playWanted = false; log('music playing'); }).catch((e) => {
    if (e.name === 'NotSupportedError' || music.error?.code === 4) { blobFallback(); return; }
    log('music blocked until first gesture: ' + e.name);
  });
}
const gesture = () => { if (playWanted && S.set.music) tryPlay(); };
window.addEventListener('pointerdown', gesture, true); window.addEventListener('keydown', gesture, true);
// Some engines (WebKitGTK) cannot stream media from the app's custom protocol (MEDIA_ERR_SRC_NOT_SUPPORTED).
// Fallback once, and only when music is actually wanted (preload=none): fetch() the file and play it from a Blob URL.
let blobTried = false;
function blobFallback() {
  if (blobTried) return; blobTried = true;
  fetch(music.getAttribute('src')).then((r) => r.blob()).then((b) => {
    music.src = URL.createObjectURL(new Blob([b], { type: 'audio/mpeg' }));
    log('music: using blob fallback');
    if (S.set.music) tryPlay();
  }).catch((e) => log('music blob fallback failed: ' + e.name));
}
music.addEventListener('error', () => {
  const code = music.error?.code ?? '';
  log('music error ' + code);
  if (code === 4 && S.set.music) blobFallback();
});

// ---------- window controls ----------
const MAX_SVG = '<rect x="1" y="1" width="10" height="3"/><rect x="1" y="1" width="2" height="10"/><rect x="9" y="1" width="2" height="10"/><rect x="1" y="9" width="10" height="2"/>';
const RESTORE_SVG = '<rect x="4" y="1" width="7" height="2"/><rect x="9" y="1" width="2" height="7"/><rect x="4" y="1" width="2" height="3"/><rect x="8" y="6" width="3" height="2"/><rect x="1" y="4" width="7" height="2"/><rect x="1" y="4" width="2" height="7"/><rect x="6" y="4" width="2" height="7"/><rect x="1" y="9" width="7" height="2"/>';
async function syncWin() {
  try { S.win = await invoke('win_state'); } catch { return; }
  const b = $('wMax'), big = S.win.maximized || S.win.fullscreen;
  b.querySelector('svg').innerHTML = big ? RESTORE_SVG : MAX_SVG;
  b.title = S.win.fullscreen ? `Exit full screen (${FS_KEY()})` : big ? 'Restore down' : `Maximise (${FS_KEY()}: full screen)`;
  b.setAttribute('aria-label', big ? 'Restore down' : 'Maximise');
  if ($('app').dataset.view === 'settings') renderSettings();
}
let rzT = null; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(syncWin, 120); });
const wc = (id, f) => act($(id), f);
wc('wMin', () => invoke('win_minimize'));
wc('wMax', async () => { await invoke('win_toggle_maximize').catch(() => {}); syncWin(); });
wc('wClose', () => invoke('win_close'));
wc('wSound', () => { S.set.music = !S.set.music; saveSettings(); });
wc('np', () => { S.set.music = !S.set.music; saveSettings(); });
wc('wSettings', openSettings);
wc('nPlay', closeSettings);
document.querySelectorAll('[data-link]').forEach(a => act(a, () => openLink(link(a.dataset.link))));
wc('sLogs', () => invoke('open_logs').catch((e) => log('open logs failed ' + e)));
applyLinks();
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('app').dataset.view === 'settings') { e.preventDefault(); const open = document.querySelector('.selw .lbx:not([hidden])'); if (open) { closeLists(); open.previousElementSibling.focus(); } else closeSettings(); }
  // Full screen: Windows = F11 handled natively (WebView2 AcceleratorKeyPressed, never reaches the page);
  // macOS = native ⌃⌘F / green button (app menu → Window → Enter Full Screen); Linux = F11 here.
  if (e.key === 'F11' && S.info && S.info.platform === 'linux') { e.preventDefault(); invoke('win_toggle_fullscreen').then(syncWin).catch(() => {}); }
  // Settings: ⌘, on macOS, Ctrl+, elsewhere.
  if (e.key === ',' && (IS_MAC() ? e.metaKey : e.ctrlKey) && $('app').dataset.view !== 'settings') { e.preventDefault(); openSettings(); }
});

// ---------- pause loops when unfocused / hidden (animation-spec §4) ----------
const setFocused = () => {
  const on = !(document.hidden || !document.hasFocus());
  $('app').dataset.focused = on ? 'true' : 'false';
  if (document.hidden) { if (!music.paused) { music.pause(); S.musicWasOn = true; } }
  else if (S.musicWasOn) { S.musicWasOn = false; tryPlay(); }
};
window.addEventListener('focus', setFocused); window.addEventListener('blur', setFocused);
document.addEventListener('visibilitychange', setFocused); setFocused();

// Hooks for the tray menu (Rust evals these on the LOCAL launcher page only).
window.__solfall = { launch: () => launch(), checkUpdates: () => checkUpdates(S.manifest?.updates?.['windows-tauri']?.url || null) };

// ---------- rock drift stepper (transform only; pauses with the window; off under reduced motion) ----------
const DRIFT = { period: 18000, steps: 28 };
const driftEls = [...document.querySelectorAll('.drift')].map(el => ({ el, r: parseFloat(getComputedStyle(el).getPropertyValue('--r')) || 0 }));
const easeInOut = (t) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ≈ CSS ease-in-out
let driftT = null, driftK = 0;
function driftTick() {
  const k = driftK++ % (DRIFT.steps * 2), half = k < DRIFT.steps ? k : DRIFT.steps * 2 - k; // alternate
  const p = easeInOut(half / DRIFT.steps);
  for (const d of driftEls) d.el.style.transform = `translate(${(-14 * p).toFixed(2)}px,${(6 * p).toFixed(2)}px) rotate(${(d.r + 4 * p).toFixed(2)}deg)`;
}
function driftSync() {
  const run = $('app').dataset.focused !== 'false' && !reduced() && !document.hidden;
  if (run && !driftT) { driftTick(); driftT = setInterval(driftTick, DRIFT.period / DRIFT.steps); }
  else if (!run && driftT) { clearInterval(driftT); driftT = null; }
}
['focus', 'blur'].forEach(e => window.addEventListener(e, () => setTimeout(driftSync)));
document.addEventListener('visibilitychange', () => setTimeout(driftSync));
new MutationObserver(driftSync).observe($('app'), { attributes: true, attributeFilter: ['data-motion', 'data-focused'] });
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', driftSync);
driftSync();

// ---------- start ----------
render();
(async () => {
  try { S.info = await invoke('launcher_info'); $('app').dataset.platform = S.info.platform; platformCopy(); } catch {}
  await loadSettings(); renderSettings(); syncWin();
  if (S.info?.demo_view === 'settings') setTimeout(openSettings, 300);
  await boot();
})().catch(e => { S.err = { code: 'SF-INT-000', title: String(e).slice(0, 60), what: 'Launcher' }; go('error'); });
