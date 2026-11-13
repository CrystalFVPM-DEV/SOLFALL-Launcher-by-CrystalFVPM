#!/usr/bin/env node
// Swap the updater PUBLIC key — the single place it lives is src-tauri/tauri.conf.json → plugins.updater.pubkey.
// Usage:  npm run set-pubkey -- <path to solfall.key.pub>      (e.g. %USERPROFILE%\.tauri\solfall.key.pub)
// Accepts the .pub file as written by `tauri signer generate` (base64 of the minisign public key file).
// Never pass a PRIVATE key here; the script refuses anything that looks like one.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const CONF = new URL('../src-tauri/tauri.conf.json', import.meta.url);
// The local TEST-ONLY pubkey (keys/ is gitignored) — used only to warn; it is never stored in the repo.
const TP = new URL('../keys/TEST-ONLY-updater.key.pub', import.meta.url);
const TEST_ONLY = existsSync(TP) ? readFileSync(TP, 'utf8').trim() : null;
const f = process.argv[2];
if (!f) { console.error('usage: npm run set-pubkey -- <solfall.key.pub>'); process.exit(2); }
let v = readFileSync(f, 'utf8').trim();
// tauri signer writes base64; tolerate a raw minisign .pub too.
if (v.startsWith('untrusted comment:')) v = Buffer.from(v + '\n').toString('base64');
const dec = Buffer.from(v, 'base64').toString('utf8');
if (/secret key/i.test(dec) || /secret key/i.test(v)) { console.error('This looks like a PRIVATE key. Pass the .pub file.'); process.exit(1); }
if (!/^untrusted comment: minisign public key/.test(dec)) { console.error('Not a minisign/Tauri public key.'); process.exit(1); }
const c = JSON.parse(readFileSync(CONF, 'utf8'));
const old = c.plugins.updater.pubkey;
c.plugins.updater.pubkey = v;
writeFileSync(CONF, JSON.stringify(c, null, 2) + '\n');
const id = dec.match(/public key: ([0-9A-F]+)/)?.[1] ?? '?';
console.log(`plugins.updater.pubkey updated (key id ${id})${(TEST_ONLY && old === TEST_ONLY) ? ' — replaced the TEST-ONLY key' : ''}.`);
if (TEST_ONLY && v === TEST_ONLY) console.warn('WARNING: this is the TEST-ONLY key; release CI rejects it.');
