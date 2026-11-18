#!/usr/bin/env node
// Move proof for pure-move splits: compares the multiset of normalised source lines of an old file
// (read with `git show <ref>:<path>` in the current working directory) with the lines of the new files.
// Usage: node move_beweis.mjs --old <ref>:<path> --new <file>... [--strip <prefix>]...
// Normalisation: trim, drop empty lines, remove each --strip prefix (in the given order, everywhere in the line).
// Prints `missing: <n>` and `added: <n>` followed by the lines; exit 0 only when missing is 0, 2 on a usage or read error.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export function normalisiere(text, strips) {
  const aus = [];
  for (const roh of text.split('\n')) {
    let z = roh.trim();
    for (const s of strips) z = z.split(s).join('');
    z = z.trim();
    if (z !== '') aus.push(z);
  }
  return aus;
}

export function vergleiche(alt, neu) {
  const zaehler = new Map();
  for (const z of alt) zaehler.set(z, (zaehler.get(z) ?? 0) + 1);
  const hinzu = [];
  for (const z of neu) {
    const n = zaehler.get(z) ?? 0;
    if (n > 0) zaehler.set(z, n - 1);
    else hinzu.push(z);
  }
  const fehlt = [];
  for (const [z, n] of zaehler) for (let i = 0; i < n; i++) fehlt.push(z);
  return { fehlt, hinzu };
}

function lies(argv) {
  const o = { old: null, neu: [], strip: [] };
  let ziel = null;
  for (const a of argv) {
    if (a === '--old') { ziel = 'old'; continue; }
    if (a === '--new') { ziel = 'neu'; continue; }
    if (a === '--strip') { ziel = 'strip'; continue; }
    if (ziel === 'old') { o.old = a; ziel = null; }
    else if (ziel === 'neu') o.neu.push(a);
    else if (ziel === 'strip') { o.strip.push(a); ziel = null; }
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!o.old || o.neu.length === 0) throw new Error('usage: --old <ref>:<path> --new <file>... [--strip <prefix>]...');
  return o;
}

function haupt() {
  let o;
  try { o = lies(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  let altText;
  try {
    altText = execFileSync('git', ['show', o.old], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { console.error(`cannot read --old ${o.old}: ${String(e.stderr ?? e.message).trim()}`); return 2; }
  let neuText = '';
  for (const f of o.neu) {
    try { neuText += fs.readFileSync(f, 'utf8') + '\n'; } catch (e) { console.error(`cannot read ${f}: ${e.message}`); return 2; }
  }
  const { fehlt, hinzu } = vergleiche(normalisiere(altText, o.strip), normalisiere(neuText, o.strip));
  console.log(`missing: ${fehlt.length}`);
  for (const z of fehlt) console.log(`  - ${z}`);
  console.log(`added: ${hinzu.length}`);
  for (const z of hinzu) console.log(`  + ${z}`);
  return fehlt.length === 0 ? 0 : 1;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) process.exit(haupt());
