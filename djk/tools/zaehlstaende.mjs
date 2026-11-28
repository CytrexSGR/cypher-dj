#!/usr/bin/env node
// zaehlstaende.mjs: the counts that tests pin (command registry, hand tools, router table), computed from the code and stored once in
// djk/tests/zaehlstaende.json. Tests read the json instead of a literal; a count that moved is pin drift with one fix:
//   node djk/tools/zaehlstaende.mjs             compare: exit 1 and name every count that differs
//   node djk/tools/zaehlstaende.mjs --schreiben rewrite the json (djk/tools/pins_follow_up.sh does this)
// Sources: befehle_gesamt = keys of the command registry (ui/project/commands.ts); befehle_main = the historic NAMEN_MAIN list in
// commands_table.test.mjs (a frozen list: its length changes only when someone edits that list); hand_werkzeuge = tool entries in hand/hand.ts
// (read only, the same count hand_presets.test.mjs takes); routen = router table and probe size in ui/tests/support/routen_golden.json
// (written by routes_golden.test.mjs from the real router, so run the route golden first).
// Doc numbers: a count in a document is wrapped as `<!-- zahl:KEY -->120<!-- /zahl -->` (KEY = a key of the json). --schreiben fills every marker
// of ZAHL_DOKUMENTE from the json; the compare mode names a stale one. The public export strips the markers (docs/veroeffentlichung/export.py). A German source
// with an English copy under docs/veroeffentlichung/englisch/ gets the same digits there and the new sha256 in the copy's first line (the text stays as it is).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DJK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const JSON_DATEI = path.join(DJK, 'tests', 'zaehlstaende.json');

export async function berechne() {
  const { PRO_BEFEHL } = await import(path.join(DJK, 'ui', 'project', 'commands.ts'));
  const tabelle = fs.readFileSync(path.join(DJK, 'ui', 'tests', 'commands_table.test.mjs'), 'utf8');
  const main = tabelle.match(/const NAMEN_MAIN = \[([^\]]*)\];/s);
  if (!main) throw new Error('NAMEN_MAIN not found in commands_table.test.mjs');
  const { handQuelle } = await import(path.join(DJK, 'hand', 'tests', 'support', 'hand_source.mjs'));
  const hand = handQuelle().split('\n').filter((z) => z.startsWith("  { name: '")).length;
  const routen = JSON.parse(fs.readFileSync(path.join(DJK, 'ui', 'tests', 'support', 'routen_golden.json'), 'utf8'));
  const { INSERT_PFADE } = await import(path.join(DJK, 'ui', 'project', 'insert_key.ts'));
  return {
    insert_pfad_laenge_max: Math.max(...INSERT_PFADE.map((p) => p.length)),
    befehle_gesamt: Object.keys(PRO_BEFEHL).length,
    befehle_main: (main[1].match(/'[^']+'/g) ?? []).length,
    hand_werkzeuge: hand,
    routen_tabelle: routen.tabelle.length,
    routen_probe: routen.n,
  };
}

const REPO = path.resolve(DJK, '..');
export const ZAHL_DOKUMENTE = ['djk/hand/AUFRUF.md', 'docs/veroeffentlichung/englisch/djk/hand/AUFRUF.md',
  'docs/veroeffentlichung/public/README.md', 'docs/veroeffentlichung/public/docs/features.md'];
const MARKE = /<!-- zahl:([a-z_]+) -->(.*?)<!-- \/zahl -->/g;
const KOPF = /^<!-- quelle-sha256: ([0-9a-f]{64}) -->\n/;
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** Every marker of the document files against `soll`: [{datei, key, ist, soll}] for the stale ones; `schreibe` rewrites the files. */
export function dokumentZahlen(soll, schreibe = false) {
  const falsch = [];
  const neueTexte = new Map();
  for (const rel of ZAHL_DOKUMENTE) {
    const datei = path.join(REPO, rel);
    if (!fs.existsSync(datei)) continue;
    const text = fs.readFileSync(datei, 'utf8');
    const neu = text.replace(MARKE, (ganz, key, ist) => {
      if (!(key in soll)) throw new Error(`${rel}: marker zahl:${key} is not a key of zaehlstaende.json`);
      if (ist !== String(soll[key])) falsch.push({ datei: rel, key, ist, soll: soll[key] });
      return `<!-- zahl:${key} -->${soll[key]}<!-- /zahl -->`;
    });
    if (neu !== text) neueTexte.set(rel, neu);
  }
  if (schreibe) {
    for (const [rel, neu] of neueTexte) fs.writeFileSync(path.join(REPO, rel), neu);
    // the English copy of a changed German source carries its sha256 in line 1
    for (const rel of neueTexte.keys()) {
      const englisch = path.join(REPO, 'docs/veroeffentlichung/englisch', rel);
      if (rel.startsWith('docs/veroeffentlichung/') || !fs.existsSync(englisch)) continue;
      const t = fs.readFileSync(englisch, 'utf8');
      if (KOPF.test(t)) fs.writeFileSync(englisch, t.replace(KOPF, `<!-- quelle-sha256: ${sha(fs.readFileSync(path.join(REPO, rel)))} -->\n`));
    }
  }
  return falsch;
}

export function lies() { return JSON.parse(fs.readFileSync(JSON_DATEI, 'utf8')); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const ist = await berechne();
  if (process.argv.includes('--schreiben')) {
    fs.mkdirSync(path.dirname(JSON_DATEI), { recursive: true });
    fs.writeFileSync(JSON_DATEI, JSON.stringify(ist, null, 1) + '\n');
    console.log(`zaehlstaende: wrote ${path.relative(process.cwd(), JSON_DATEI)}`);
    for (const f of dokumentZahlen(ist, true)) console.log(`zaehlstaende: ${f.datei}: ${f.key} ${f.ist} -> ${f.soll}`);
  } else {
    const soll = fs.existsSync(JSON_DATEI) ? lies() : {};
    const falsch = Object.keys({ ...ist, ...soll }).filter((k) => ist[k] !== soll[k]);
    for (const k of falsch) console.log(`[pin] count ${k}: json ${soll[k]}, code ${ist[k]}: run djk/tools/pins_follow_up.sh`);
    const doku = dokumentZahlen(soll);
    for (const f of doku) console.log(`[pin] doc ${f.datei}: zahl:${f.key} says ${f.ist}, zaehlstaende.json ${f.soll}: run djk/tools/pins_follow_up.sh`);
    if (falsch.length || doku.length) process.exit(1);
    console.log('zaehlstaende: all counts match');
  }
}
