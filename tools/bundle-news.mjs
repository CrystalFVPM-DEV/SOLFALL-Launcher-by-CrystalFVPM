#!/usr/bin/env node
// Prebuild (tauri.conf.json → build.beforeBuildCommand): content/news.json → src/js/news.bundled.json,
// the OFFLINE fallback compiled into the launcher (remote → cache → this file). Validates first when the
// Backend validator is present; an invalid feed fails the build instead of shipping broken news.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'content/news.json'), OUT = join(ROOT, 'src/js/news.bundled.json');
if (!existsSync(SRC)) { console.error(`bundle-news: ${SRC} missing`); process.exit(1); }
const V = join(ROOT, 'scripts/validate-content.mjs');
if (existsSync(V)) execFileSync(process.execPath, [V, SRC, '--quiet'], { stdio: 'inherit' });
const feed = JSON.parse(readFileSync(SRC, 'utf8').replace(/^\uFEFF/, ''));
delete feed.$schema;
writeFileSync(OUT, JSON.stringify(feed, null, 2) + '\n');
console.log(`bundle-news: ${OUT} (schema ${feed.schema_version}, updated ${feed.updated})`);
