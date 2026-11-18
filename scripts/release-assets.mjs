#!/usr/bin/env node
// Nombres de los assets del release multiplataforma — ÚNICA fuente de verdad (la usan release.yml y los tests).
// Sin dependencias (Node >= 18). Si cambia un nombre de artefacto de Tauri o un nombre público, se cambia SÓLO aquí.
//
// Versión: en el workflow sale del TAG (`--tag vX.Y.Z` -> X.Y.Z; nada hardcodeado) y se exige que sea igual a la
// "version" de src-tauri/tauri.conf.json (Tauri nombra sus artefactos y firma el trusted comment con esa versión).
// Modo macOS (`--mac-mode`): universal (por defecto: un .dmg/.app.tar.gz universal) | split (plan B: Apple Silicon e
// Intel por separado, con darwin-aarch64 y darwin-x86_64 apuntando cada uno a su tarball).
//
//   node scripts/release-assets.mjs version                         -> versión (del --tag si se pasa)
//   node scripts/release-assets.mjs list [--kind main|technical]    -> nombres finales de assets (1 por línea, orden C)
//   node scripts/release-assets.mjs count                           -> nº de assets (10 universal, 13 split)
//   node scripts/release-assets.mjs name <id>                       -> exe, dmg, app_tar_gz, appimage, deb, latest_json,
//                                                                      dmg_aarch64, dmg_x86_64, app_tar_gz_aarch64, ...
//   node scripts/release-assets.mjs source <id>                     -> ruta del artefacto de Tauri relativa a src-tauri/target
//   node scripts/release-assets.mjs matrix                          -> JSON {include:[...]} de la matriz de build (por modo)
//   node scripts/release-assets.mjs platform-info --platform <p>    -> líneas KEY=VALUE (app/dmg/tar.gz/archs) para macOS
//   node scripts/release-assets.mjs collect --platform <p> --out <dir>
//        copia del bundle de Tauri a <dir> los archivos de esa plataforma con su nombre FINAL (+ .sig);
//        falla si falta alguno o si <dir> queda con algo extra.
//   node scripts/release-assets.mjs latest-json --dir <dir> --download-base <url>
//        escribe <dir>/latest.json (firma = contenido del .sig de cada archivo).
//   node scripts/release-assets.mjs check-dir --dir <dir>           -> <dir> == list exacto (ni falta ni sobra nada)
//   node scripts/release-assets.mjs notes --template <file> --out <file>
//        sustituye {{VERSION}}, {{EXE}}, {{DMG}}, ..., y {{MACOS_ROWS}} (filas macOS de la tabla, según el modo)
// Opciones comunes: --tag vX.Y.Z (workflow), --mac-mode universal|split, --conf <tauri.conf.json>,
//                   --version X.Y.Z (sólo tests: no lee tauri.conf.json).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCT = 'SolfallLauncher';        // productName de tauri.conf.json (nombres de Tauri; el guard lo exige)
export const PUBLIC = 'SOLFALL-Launcher';        // prefijo de los assets publicados
export const APP_BUNDLE = `${PRODUCT}.app`;      // {productName}.app (bundle.macOS.bundleName sólo cambia CFBundleName)
export const MAC_MODES = ['universal', 'split'];

// Rutas de bundle de Tauri v2 (tauri-cli 2.12.x / tauri-bundler 2.10.x) relativas a src-tauri/target/.
// - windows-latest: build nativo sin --target            -> release/bundle/nsis/
// - macos-latest:   --target <triple>                    -> <triple>/release/bundle/{dmg,macos}/
//   El tarball del updater sale SIN versión (SolfallLauncher.app.tar.gz) y el .dmg con sufijo de arquitectura de Tauri
//   (universal | aarch64 | x64). Se renombran: la firma minisign no depende del nombre, sólo del contenido.
// - ubuntu-22.04:   build nativo                         -> release/bundle/{appimage,deb}/
const MAC = {
  universal: { triple: 'universal-apple-darwin', tauriArch: 'universal', label: 'macOS-universal', archs: ['x86_64', 'arm64'] },
  aarch64: { triple: 'aarch64-apple-darwin', tauriArch: 'aarch64', label: 'macOS-AppleSilicon', archs: ['arm64'] },
  x86_64: { triple: 'x86_64-apple-darwin', tauriArch: 'x64', label: 'macOS-Intel', archs: ['x86_64'] },
};
const macPlatform = (key) => (key === 'universal' ? 'macos' : `macos-${key}`);
const macFiles = (v, key) => {
  const m = MAC[key]; const sfx = key === 'universal' ? '' : `_${key}`;
  return [
    { id: `dmg${sfx}`, from: `${m.triple}/release/bundle/dmg/${PRODUCT}_${v}_${m.tauriArch}.dmg`, as: `${PUBLIC}_${v}_${m.label}.dmg`, kind: 'main', signed: false },
    { id: `app_tar_gz${sfx}`, from: `${m.triple}/release/bundle/macos/${APP_BUNDLE}.tar.gz`, as: `${PUBLIC}_${v}_${m.label}.app.tar.gz`, kind: 'technical', signed: true },
  ];
};
const macKeys = (mode) => (mode === 'split' ? ['aarch64', 'x86_64'] : ['universal']);

export function spec(version, macMode = 'universal') {
  const v = version;
  const out = {
    windows: [
      { id: 'exe', from: `release/bundle/nsis/${PRODUCT}_${v}_x64-setup.exe`, as: `${PUBLIC}_${v}_Windows_x64-setup.exe`, kind: 'main', signed: true },
    ],
  };
  for (const k of macKeys(macMode)) out[macPlatform(k)] = macFiles(v, k);
  out.linux = [
    { id: 'appimage', from: `release/bundle/appimage/${PRODUCT}_${v}_amd64.AppImage`, as: `${PUBLIC}_${v}_Linux_x86_64.AppImage`, kind: 'main', signed: true },
    { id: 'deb', from: `release/bundle/deb/${PRODUCT}_${v}_amd64.deb`, as: `${PUBLIC}_${v}_Linux_amd64.deb`, kind: 'main', signed: true },
  ];
  return out;
}

// Claves de latest.json -> id del asset. tauri-plugin-updater 2.x busca `{os}-{arch}-{installer}` y luego `{os}-{arch}`.
// windows-x86_64(-nsis): mantiene compatibles los clientes 0.2.1 (Windows). darwin-*: universal -> el mismo tarball;
// split -> cada arquitectura el suyo. linux-x86_64(-appimage): AppImage. linux-x86_64-deb: una instalación .deb DEBE
// recibir el .deb (si cayera en linux-x86_64 recibiría el AppImage e intentaría instalarlo con dpkg).
export function platforms(macMode = 'universal') {
  const arm = macMode === 'split' ? 'app_tar_gz_aarch64' : 'app_tar_gz';
  const intel = macMode === 'split' ? 'app_tar_gz_x86_64' : 'app_tar_gz';
  return {
    'windows-x86_64-nsis': 'exe',
    'windows-x86_64': 'exe',
    'darwin-x86_64': intel,
    'darwin-aarch64': arm,
    'darwin-x86_64-app': intel,
    'darwin-aarch64-app': arm,
    'linux-x86_64': 'appimage',
    'linux-x86_64-appimage': 'appimage',
    'linux-x86_64-deb': 'deb',
  };
}
export const PLATFORMS = platforms('universal');

// Matriz de build (la arma el job guard y la consume build vía fromJSON). family: windows|macos|linux (para los if:).
export function matrix(macMode = 'universal') {
  const include = [{ platform: 'windows', family: 'windows', os: 'windows-latest', bundles: 'nsis', tauri_target: '', rust_targets: '', tauri_config: '' }];
  for (const k of macKeys(macMode)) {
    const m = MAC[k];
    include.push({
      platform: macPlatform(k), family: 'macos', os: 'macos-latest', bundles: 'app,dmg', tauri_target: m.triple,
      rust_targets: k === 'universal' ? 'aarch64-apple-darwin,x86_64-apple-darwin' : m.triple, tauri_config: '',
    });
  }
  // overlay de Engine: sólo bundle.linux.appimage.bundleMediaFramework (GStreamer dentro del AppImage)
  include.push({ platform: 'linux', family: 'linux', os: 'ubuntu-22.04', bundles: 'appimage,deb', tauri_target: '', rust_targets: '', tauri_config: 'src-tauri/tauri.linux-appimage.conf.json' });
  return { include };
}

export function assets(version, macMode = 'universal') {
  const files = Object.values(spec(version, macMode)).flat();
  const out = [];
  for (const f of files) {
    out.push({ name: f.as, kind: f.kind, id: f.id });
    if (f.signed) out.push({ name: `${f.as}.sig`, kind: 'technical', id: `${f.id}_sig` });
  }
  out.push({ name: 'latest.json', kind: 'technical', id: 'latest_json' });
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const MAC_FIRST_LAUNCH = 'Open the .dmg and drag SolfallLauncher.app to Applications, then see "macOS: first launch" below.';
export function macosRows(macMode = 'universal') {
  return macMode === 'split'
    ? [`| macOS on Apple Silicon (M1 or newer) | \`{{DMG_AARCH64}}\` | ${MAC_FIRST_LAUNCH} |`,
       `| macOS on Intel | \`{{DMG_X86_64}}\` | ${MAC_FIRST_LAUNCH} |`].join('\n')
    : `| macOS (Intel and Apple Silicon) | \`{{DMG}}\` | ${MAC_FIRST_LAUNCH} |`;
}

const fail = (m) => { console.error(`::error::${m}`); process.exit(1); };
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const cSort = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function main(argv) {
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const cmd = argv[0];
  const conf = opt('conf', 'src-tauri/tauri.conf.json');
  const macMode = opt('mac-mode', 'universal');
  if (!MAC_MODES.includes(macMode)) fail(`--mac-mode debe ser ${MAC_MODES.join(' o ')} (hay "${macMode}")`);
  if (cmd === 'matrix') { console.log(JSON.stringify(matrix(macMode))); return; }
  const readConf = () => { try { return JSON.parse(readFileSync(conf, 'utf8')); } catch (e) { return fail(`no se pudo leer ${conf}: ${e.message}`); } };
  let version;
  const tag = opt('tag');
  if (tag !== undefined) {
    if (!/^v/.test(tag) || !VERSION_RE.test(tag.slice(1))) fail(`tag "${tag}" no es vX.Y.Z`);
    version = tag.slice(1);
    const c = readConf();
    if (c.version !== version) fail(`tag ${tag} != version "${c.version}" de ${conf} (Tauri nombra y firma los artefactos con la versión de tauri.conf.json)`);
    if (c.productName !== PRODUCT) fail(`productName debe ser exactamente "${PRODUCT}"`);
  } else if (opt('version') !== undefined) {
    version = opt('version');
  } else {
    const c = readConf(); version = c.version;
    if (c.productName !== PRODUCT) fail(`productName debe ser exactamente "${PRODUCT}"`);
  }
  if (!VERSION_RE.test(String(version))) fail(`versión inválida: ${version}`);
  const S = spec(version, macMode);
  const all = assets(version, macMode);
  const byId = Object.fromEntries(all.map((a) => [a.id, a.name]));
  const srcById = Object.fromEntries(Object.values(S).flat().map((f) => [f.id, f.from]));

  switch (cmd) {
    case 'version': console.log(version); break;
    case 'count': console.log(all.length); break;
    case 'list': {
      const kind = opt('kind');
      for (const a of all) if (!kind || a.kind === kind) console.log(a.name);
      break;
    }
    case 'name': {
      const n = byId[argv[1]]; if (!n) fail(`id desconocido: ${argv[1]} (válidos: ${Object.keys(byId).join(', ')})`);
      console.log(n); break;
    }
    case 'source': {
      const n = srcById[argv[1]]; if (!n) fail(`id desconocido: ${argv[1]} (válidos: ${Object.keys(srcById).join(', ')})`);
      console.log(n); break;
    }
    case 'platform-info': {
      // Para el paso de verificación ad-hoc de macOS: rutas (relativas a src-tauri/target) y arquitecturas esperadas.
      const p = opt('platform'); const files = S[p];
      if (!files || !p.startsWith('macos')) fail(`--platform debe ser una plataforma macOS de este modo (${Object.keys(S).filter((k) => k.startsWith('macos')).join(', ')})`);
      const key = p === 'macos' ? 'universal' : p.slice('macos-'.length); const m = MAC[key];
      const dmg = files.find((f) => f.id.startsWith('dmg')); const tgz = files.find((f) => f.id.startsWith('app_tar_gz'));
      console.log(`MAC_APP=${m.triple}/release/bundle/macos/${APP_BUNDLE}`);
      console.log(`MAC_DMG=${dmg.from}`);
      console.log(`MAC_TAR=${tgz.from}`);
      console.log(`MAC_ARCHS=${m.archs.join(' ')}`);
      console.log(`MAC_VERSION=${version}`);
      break;
    }
    case 'collect': {
      const platform = opt('platform'); const out = opt('out'); const target = opt('target-dir', 'src-tauri/target');
      const files = S[platform]; if (!files) fail(`--platform debe ser ${Object.keys(S).join(', ')} (modo mac ${macMode})`);
      if (!out) fail('falta --out');
      mkdirSync(out, { recursive: true });
      const want = [];
      for (const f of files) {
        const pairs = [[f.from, f.as]]; if (f.signed) pairs.push([`${f.from}.sig`, `${f.as}.sig`]);
        for (const [from, as] of pairs) {
          const src = join(target, from);
          if (!existsSync(src)) {
            const dir = join(target, from, '..');
            const near = existsSync(dir) ? readdirSync(dir).join(', ') : '(no existe el directorio)';
            fail(`no existe ${src} (nombre esperado en scripts/release-assets.mjs). En ${dir} hay: ${near}`);
          }
          if (as.endsWith('.sig') && !Buffer.from(readFileSync(src, 'utf8').trim(), 'base64').toString('utf8').startsWith('untrusted comment:')) fail(`${src}: .sig con formato inesperado`);
          copyFileSync(src, join(out, as)); want.push(as);
        }
      }
      const got = cSort(readdirSync(out)); const exp = cSort(want);
      if (!sameList(got, exp)) fail(`${out} debe contener exactamente ${exp.join(', ')}; hay: ${got.join(', ')}`);
      console.log(`${platform}: ${exp.join(', ')}`);
      break;
    }
    case 'latest-json': {
      const dir = opt('dir'); const base = opt('download-base');
      if (!dir || !base) fail('uso: latest-json --dir <dir> --download-base <url>');
      if (!/^https?:\/\/[^/]+\/.+\/releases\/download\/v[^/]+$/.test(base)) fail(`--download-base inesperado: ${base}`);
      if (!base.endsWith(`/v${version}`)) fail(`--download-base ${base} no termina en /v${version}`);
      const plats = {};
      for (const [key, id] of Object.entries(platforms(macMode))) {
        const name = byId[id]; const sig = join(dir, `${name}.sig`);
        if (!existsSync(join(dir, name)) || !existsSync(sig)) fail(`falta ${name} o ${name}.sig en ${dir} (plataforma ${key})`);
        plats[key] = { signature: readFileSync(sig, 'utf8').trim(), url: `${base}/${encodeURIComponent(name)}` };
      }
      const latest = {
        version,
        notes: `Solfall Launcher ${version}`,
        pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        platforms: plats,
      };
      writeFileSync(join(dir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
      console.log(JSON.stringify({ ...latest, platforms: Object.fromEntries(Object.entries(plats).map(([k, p]) => [k, basename(p.url)])) }, null, 2));
      break;
    }
    case 'check-dir': {
      const dir = opt('dir'); if (!dir) fail('falta --dir');
      const got = cSort(readdirSync(dir)); const exp = all.map((a) => a.name);
      if (!sameList(got, exp)) {
        const extra = got.filter((x) => !exp.includes(x)); const missing = exp.filter((x) => !got.includes(x));
        fail(`${dir} debe contener exactamente los ${exp.length} assets del release (mac ${macMode}). Sobra: [${extra.join(', ')}] Falta: [${missing.join(', ')}]`);
      }
      console.log(`OK ${dir}: ${exp.length} assets exactos (mac ${macMode})`);
      break;
    }
    case 'notes': {
      const tpl = opt('template'); const out = opt('out'); if (!tpl || !out) fail('uso: notes --template <f> --out <f>');
      let text = readFileSync(tpl, 'utf8');
      if (!text.includes('{{MACOS_ROWS}}')) fail('la plantilla de notas debe tener {{MACOS_ROWS}}');
      text = text.replaceAll('{{MACOS_ROWS}}', macosRows(macMode)).replaceAll('{{VERSION}}', version);
      for (const [id, n] of Object.entries(byId)) text = text.replaceAll(`{{${id.toUpperCase()}}}`, n);
      const left = text.match(/\{\{[A-Z0-9_]+\}\}/g); if (left) fail(`placeholders sin resolver en las notas: ${left.join(', ')}`);
      writeFileSync(out, text); console.log(text);
      break;
    }
    default: fail(`comando desconocido: ${cmd ?? '(ninguno)'}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
