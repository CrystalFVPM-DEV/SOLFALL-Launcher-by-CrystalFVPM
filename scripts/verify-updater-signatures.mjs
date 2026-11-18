#!/usr/bin/env node
// Verifica firmas minisign del updater de Tauri SIN dependencias (node:crypto: Ed25519 + BLAKE2b-512).
// Se ejecuta en release.yml ANTES de publicar: cada archivo firmado y cada entrada de latest.json deben verificar
// contra la pubkey de src-tauri/tauri.conf.json (la que llevan embebida los launchers instalados).
//
//   node scripts/verify-updater-signatures.mjs --dir <release-assets> [--latest-json <file>] [--conf <tauri.conf.json>]
//        [--pubkey <base64 como en tauri.conf | archivo .pub>] [--expect-key-id D78F00A86CB044C7] [--expect-version X.Y.Z]
//   node scripts/verify-updater-signatures.mjs --file <archivo> --sig <archivo.sig> [--pubkey ...|--conf ...]
//
// Formato (minisign): pubkey = "Ed" + keyId(8, LE) + pk(32).  Firma = "ED" (prehash BLAKE2b-512, lo que usa Tauri) o
// "Ed" (legacy, mensaje completo) + keyId(8) + sig(64); luego "trusted comment: ..." y una firma global Ed25519 sobre
// sig(64) || trusted_comment. Se comprueban: algoritmo, key ID == el de la pubkey, firma del archivo y firma global.
// Versión firmada: `tauri build` escribe el trusted comment "timestamp:..\tfile:..\tversion:X.Y.Z" y
// tauri-plugin-updater 2.14 RECHAZA la descarga si ese version: no coincide con la "version" de latest.json
// (SignedVersionMismatch). Por eso: cada entrada de latest.json con version: debe coincidir con latest.json.version, y con
// --expect-version cada firma DEBE llevar version: igual a X.Y.Z (artefactos viejos o de otro build -> falla).
// Tauri guarda el .sig y el campo "signature" de latest.json como base64 del texto minisign completo.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const b64text = (s, what) => {
  const t = Buffer.from(String(s).trim(), 'base64').toString('utf8');
  if (!t.startsWith('untrusted comment:')) throw new Error(`${what}: no es base64 de un texto minisign ("untrusted comment:" ...)`);
  return t.split(/\r?\n/);
};
const keyIdHex = (le8) => Buffer.from(le8).reverse().toString('hex').toUpperCase();

export function parsePubkey(pubkeyB64) {
  const lines = b64text(pubkeyB64, 'pubkey');
  const raw = Buffer.from(lines[1] ?? '', 'base64');
  if (raw.length !== 42 || raw.subarray(0, 2).toString('latin1') !== 'Ed') throw new Error('pubkey: se esperaban 42 bytes que empiezan por "Ed"');
  const keyId = keyIdHex(raw.subarray(2, 10));
  const commentId = (lines[0].match(/([0-9A-Fa-f]{16})\s*$/) || [])[1]?.toUpperCase();
  if (commentId && commentId !== keyId) throw new Error(`pubkey: key ID del comentario (${commentId}) != bytes (${keyId})`);
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.subarray(10).toString('base64url') }, format: 'jwk' });
  return { keyId, key };
}

export function parseSignature(sigB64) {
  const lines = b64text(sigB64, 'firma');
  const raw = Buffer.from(lines[1] ?? '', 'base64');
  if (raw.length !== 74) throw new Error(`firma: se esperaban 74 bytes, hay ${raw.length}`);
  const alg = raw.subarray(0, 2).toString('latin1');
  if (alg !== 'ED' && alg !== 'Ed') throw new Error(`firma: algoritmo desconocido "${alg}"`);
  const tc = lines[2] ?? '';
  if (!tc.startsWith('trusted comment: ')) throw new Error('firma: falta la línea "trusted comment: "');
  const global = Buffer.from(lines[3] ?? '', 'base64');
  if (global.length !== 64) throw new Error('firma: falta la firma global (64 bytes)');
  return { alg, keyId: keyIdHex(raw.subarray(2, 10)), sig: raw.subarray(10), trusted: tc.slice('trusted comment: '.length), global };
}

export const signedVersion = (trusted) => trusted.split('\t').map((f) => f.match(/^version:(.*)$/)?.[1]).find((x) => x !== undefined);
const sameVersion = (a, b) => String(a).replace(/^v/, '') === String(b).replace(/^v/, '');

/** Lanza Error si no verifica. Devuelve { alg, keyId, trusted }. opts.version: versión que debe constar en el trusted comment. */
export function verifyData(data, sigB64, pub, opts = {}) {
  const s = parseSignature(sigB64);
  if (s.keyId !== pub.keyId) throw new Error(`key ID de la firma ${s.keyId} != key ID de la pubkey ${pub.keyId}`);
  const msg = s.alg === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  if (!verify(null, msg, pub.key, s.sig)) throw new Error('firma del archivo INVÁLIDA (contenido alterado o firmado con otra clave)');
  if (!verify(null, Buffer.concat([s.sig, Buffer.from(s.trusted, 'utf8')]), pub.key, s.global)) throw new Error('firma global del trusted comment INVÁLIDA');
  const sv = signedVersion(s.trusted);
  if (opts.require && sv === undefined) throw new Error(`la firma no lleva version: en el trusted comment (se esperaba ${opts.version})`);
  if (opts.version !== undefined && sv !== undefined && !sameVersion(sv, opts.version)) throw new Error(`firmado para version ${sv}, pero se anuncia ${opts.version} (tauri-plugin-updater lo rechazaría)`);
  return { alg: s.alg, keyId: s.keyId, trusted: s.trusted };
}

function main(argv) {
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const fail = (m) => { console.error(`::error::${m}`); process.exit(1); };
  let pubB64 = opt('pubkey');
  if (pubB64 && existsSync(pubB64)) {
    const t = readFileSync(pubB64, 'utf8').trim();
    pubB64 = t.startsWith('untrusted comment:') ? Buffer.from(t + '\n').toString('base64') : t;
  }
  if (!pubB64) {
    const conf = opt('conf', 'src-tauri/tauri.conf.json');
    try { pubB64 = JSON.parse(readFileSync(conf, 'utf8')).plugins?.updater?.pubkey; } catch (e) { fail(`no se pudo leer ${conf}: ${e.message}`); }
    if (!pubB64) fail(`${conf} no tiene plugins.updater.pubkey`);
  }
  let pub; try { pub = parsePubkey(pubB64); } catch (e) { fail(e.message); }
  const expectId = opt('expect-key-id');
  if (expectId && pub.keyId !== expectId.toUpperCase()) fail(`pubkey con key ID ${pub.keyId}; se esperaba ${expectId}`);
  console.log(`pubkey key ID ${pub.keyId}`);

  const expectVersion = opt('expect-version');
  const checks = []; // [label, filePath, sigB64, opts]
  const vopts = expectVersion ? { version: expectVersion, require: true } : {};
  if (opt('file')) {
    if (!opt('sig')) fail('--file requiere --sig');
    checks.push([basename(opt('file')), opt('file'), readFileSync(opt('sig'), 'utf8'), vopts]);
  }
  const dir = opt('dir');
  if (dir) {
    const sigs = readdirSync(dir).filter((n) => n.endsWith('.sig')).sort();
    if (!sigs.length) fail(`no hay .sig en ${dir}`);
    for (const s of sigs) {
      const f = join(dir, s.slice(0, -4));
      if (!existsSync(f)) fail(`${s} sin su archivo ${basename(f)}`);
      checks.push([s, f, readFileSync(join(dir, s), 'utf8'), vopts]);
    }
    const lj = opt('latest-json', join(dir, 'latest.json'));
    if (existsSync(lj)) {
      const j = JSON.parse(readFileSync(lj, 'utf8'));
      const entries = Object.entries(j.platforms ?? {});
      if (!entries.length) fail(`${lj}: sin platforms`);
      if (expectVersion && !sameVersion(j.version, expectVersion)) fail(`latest.json version ${j.version} != ${expectVersion}`);
      for (const [k, e] of entries) {
        if (!e?.url || !e?.signature) fail(`latest.json[${k}]: falta url o signature`);
        const name = decodeURIComponent(new URL(e.url).pathname.split('/').pop());
        const f = join(dir, name);
        if (!existsSync(f)) fail(`latest.json[${k}] apunta a ${name}, que no está en ${dir}`);
        const sigFile = `${f}.sig`;
        if (existsSync(sigFile) && readFileSync(sigFile, 'utf8').trim() !== String(e.signature).trim()) fail(`latest.json[${k}]: signature distinta del contenido de ${name}.sig`);
        checks.push([`latest.json[${k}] -> ${name}`, f, e.signature, { version: j.version, require: !!expectVersion }]);
      }
    } else if (opt('latest-json')) fail(`no existe ${lj}`);
  }
  if (!checks.length) fail('nada que verificar (usa --dir o --file/--sig)');
  let bad = 0; const cache = new Map();
  for (const [label, f, sig, o] of checks) {
    try {
      if (!cache.has(f)) cache.set(f, readFileSync(f));
      const r = verifyData(cache.get(f), sig, pub, o);
      console.log(`OK  ${label}  (${r.alg}, key ${r.keyId}, "${r.trusted}")`);
    } catch (e) { console.error(`::error::${label}: ${e.message}`); bad++; }
  }
  if (bad) fail(`${bad} firma(s) no verifican contra la pubkey ${pub.keyId}; NO se publica`);
  console.log(`firmas OK: ${checks.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
