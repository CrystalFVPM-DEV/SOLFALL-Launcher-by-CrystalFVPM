#!/usr/bin/env node
// Validates content/news.json against content/news.schema.json plus a few content rules. No dependencies.
// Usage: node scripts/validate-content.mjs [content/news.json] [--schema content/news.schema.json] [--quiet]
// Exit code: 0 = valid, 1 = errors (printed with the JSON path), 2 = usage/IO error.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_PREFIX = 'https://raw.githubusercontent.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/main/';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const file = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--schema') || join(REPO, 'content/news.json'));
const schemaFile = resolve(opt('schema', join(dirname(file), 'news.schema.json')));
const quiet = argv.includes('--quiet');

const errors = []; const warnings = [];
const err = (path, msg) => errors.push(`${path || '(root)'}: ${msg}`);
const warn = (path, msg) => warnings.push(`${path || '(root)'}: ${msg}`);

function parse(path, label) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { console.error(`cannot read ${label} ${path}: ${e.message}`); process.exit(2); }
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) {
    const m = /position (\d+)/.exec(e.message); let where = '';
    if (m) { const pos = +m[1]; const before = text.slice(0, pos); const line = before.split('\n').length; const col = pos - before.lastIndexOf('\n'); where = ` (line ${line}, column ${col})`; }
    console.error(`INVALID JSON in ${label}${where}: ${e.message}\nTip: check for a missing comma, a trailing comma, or straight quotes "…" instead of curly quotes.`);
    process.exit(1);
  }
}
const doc = parse(file, 'content'); const schema = parse(schemaFile, 'schema');

// ---- minimal JSON Schema (2020-12 subset used by news.schema.json) ----
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const resolveRef = (ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], schema);
function check(s, v, path, sink = err) {
  if (s.$ref) return check(resolveRef(s.$ref), v, path, sink);
  let ok = true; const fail = (m) => { ok = false; sink(path, m); };
  if (s.oneOf) {
    const passing = s.oneOf.filter((sub) => { const tmp = []; check(sub, v, path, (p, m) => tmp.push(m)); return tmp.length === 0; });
    if (passing.length === 1) return ok;
    const objShape = typeOf(v) === 'object' && s.oneOf.find((x) => (x.$ref ? resolveRef(x.$ref) : x).type === 'object');
    if (passing.length === 0 && objShape) { check(objShape, v, path, sink); return false; } // report the real field errors
    fail(passing.length ? 'matches more than one allowed shape' : `not an allowed value: must be ${describe(s)} (got ${JSON.stringify(v)})`);
    return ok;
  }
  if ('const' in s && v !== s.const) fail(`must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(v)) fail(`must be one of ${s.enum.map((x) => JSON.stringify(x)).join(', ')} (got ${JSON.stringify(v)})`);
  if (s.type) { const t = typeOf(v); const okT = t === s.type || (s.type === 'number' && t === 'integer'); if (!okT) { fail(`must be ${s.type} (got ${t})`); return ok; } }
  if (typeof v === 'string') {
    if (s.minLength != null && v.length < s.minLength) fail(s.minLength === 1 ? 'must not be empty' : `must have at least ${s.minLength} characters`);
    if (s.maxLength != null && v.length > s.maxLength) fail(`too long: ${v.length} characters, max ${s.maxLength}`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) fail(`bad format (${s.pattern.includes('https') ? 'must be an https:// URL' : s.pattern.includes('\\d{4}') ? 'must be a date YYYY-MM-DD' : s.pattern})`);
  }
  if (Array.isArray(v)) {
    if (s.maxItems != null && v.length > s.maxItems) fail(`too many entries: ${v.length}, max ${s.maxItems}`);
    if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, sink));
  }
  if (typeOf(v) === 'object') {
    for (const k of s.required || []) if (!(k in v)) fail(`missing required field "${k}"`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties?.[k]) check(s.properties[k], x, path ? `${path}.${k}` : k, sink);
      else if (s.additionalProperties === false) fail(`unknown field "${k}" (typo?)`);
    }
  }
  return ok;
}
const describe = (s) => s.oneOf.map((x) => { const r = x.$ref ? resolveRef(x.$ref) : x; return r.pattern?.includes('https') ? 'an https:// URL' : r.type || '?'; }).join(' or ');
check(schema, doc, '');

// ---- content rules the schema can't express ----
const realDate = (d) => { const t = new Date(`${d}T00:00:00Z`); return !isNaN(t) && t.toISOString().slice(0, 10) === d; };
const walk = (v, path, fn) => { fn(v, path); if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? `${path}[${k}]` : path ? `${path}.${k}` : k, fn); };
walk(doc, '', (v, path) => {
  if (typeof v !== 'string') return;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !realDate(v)) err(path, `${v} is not a real calendar date`);
  if (/\[EJEMPLO\]|\bSAMPLE\b|lorem ipsum|\bTODO\b|<dominio-solfall>/i.test(v)) err(path, 'looks like placeholder/sample text; only real content goes here');
});
const img = doc?.featured?.image;
if (typeof img === 'string') {
  const okHost = /^https:\/\/(www\.)?solfall\.online\//.test(img) || img.startsWith(RAW_PREFIX);
  if (!okHost) err('featured.image', `images must be on https://solfall.online/ or ${RAW_PREFIX}content/img/`);
  if (img.startsWith(RAW_PREFIX)) { const local = join(REPO, decodeURIComponent(img.slice(RAW_PREFIX.length).split('?')[0])); if (!existsSync(local)) err('featured.image', `points to ${img.slice(RAW_PREFIX.length)} but that file is not in the repo (upload it first)`); }
}
if (Array.isArray(doc?.patch_notes)) {
  for (let i = 1; i < doc.patch_notes.length; i++) if ((doc.patch_notes[i].date || '') > (doc.patch_notes[i - 1].date || '')) warn(`patch_notes[${i}]`, 'not newest-first (the launcher sorts by date anyway)');
  const newest = doc.patch_notes.map((p) => p.date).sort().pop();
  if (newest && doc.updated && newest > doc.updated) warn('updated', `older than the newest patch note (${newest}); bump "updated"`);
}
if (Array.isArray(doc?.roadmap) && doc.roadmap.length > 3) warn('roadmap', `${doc.roadmap.length} rows; the launcher shows only the first 3`);

for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`ERROR    ${e}`);
if (errors.length) { console.log(`\n${file}: ${errors.length} error(s). Fix them before committing.`); process.exit(1); }
if (!quiet) console.log(`OK ${file} is valid (schema_version ${doc.schema_version}, featured: ${doc.featured ? 'yes' : 'hidden'}, roadmap: ${doc.roadmap.length}, patch_notes: ${doc.patch_notes.length})`);
