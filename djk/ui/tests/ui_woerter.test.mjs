// Wording guard: no German product word in any string a person reads (page and server texts), and the public device names.
// Reads the sources, removes comments, extracts string literals. Identifiers, stored values and file names are not strings
// of this kind and never match; the few literals that are stored values are named in ALLOW with a reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { literaleVon } from './helpers/literale.mjs';
import { GERAETE } from '../presets/devices.ts';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.join(UI, '..', '..');
const SKIP = new Set(['tests', 'check', 'node_modules', 'prototype-wave']);

const VERBOTEN = [/Baukasten/, /(^|[^\p{L}])Komp($|[^\p{L}])/u, /Saett/, /Sättigung/, /Cypher Komp/];

// file (relative to djk/ui) -> [literal fragment, reason]
const ALLOW = [
  ['public/presets.js', 'Baukasten preset', 'presets.js belongs to plan 2 (browser component); its one message is reported, not changed here'],
];

function quellen(dir, aus = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) quellen(path.join(dir, e.name), aus); continue; }
    if (/\.(js|ts|mjs)$/.test(e.name) || e.name === 'index.html') aus.push(path.join(dir, e.name));
  }
  return aus;
}

function texteVon(datei) {
  const src = fs.readFileSync(datei, 'utf8');
  if (datei.endsWith('.html')) return [src.replace(/<!--[\s\S]*?-->/g, '')];
  return literaleVon(src).map((l) => l.text);
}

test('no UI string carries Baukasten, Komp, Saett or Sättigung', () => {
  const funde = [];
  for (const datei of quellen(UI)) {
    const rel = path.relative(UI, datei);
    for (const text of texteVon(datei)) {
      if (!VERBOTEN.some((re) => re.test(text))) continue;
      if (ALLOW.some(([f, frag]) => f === rel && text.includes(frag))) continue;
      funde.push(`${rel}: ${text.slice(0, 100)}`);
    }
  }
  assert.deepEqual(funde, []);
});

test('the effect titles are the public names', () => {
  assert.equal(GERAETE.find((g) => g.id === 'komp').titel, 'Cypher Comp');
  assert.equal(GERAETE.find((g) => g.id === 'saett').titel, 'Cypher Saturation');
});

test('the public README names Cypher Comp and Cypher Saturation', () => {
  const readme = fs.readFileSync(path.join(REPO, 'docs/veroeffentlichung/public/README.md'), 'utf8');
  assert.doesNotMatch(readme, /Cypher Komp|Cypher Saett/);
  assert.match(readme, /Cypher Comp/);
  assert.match(readme, /Cypher Saturation/);
});
