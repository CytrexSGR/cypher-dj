// node --test tests/golden.test.mjs: der Golden-Läufer in simulierter Zeit (golden.mjs) samt Urteil über
// folgen_vergleich.py (vergleich.py). Instrument-Prüfung: die drei Folgen aus Scheibe 02 sind grün, und eine Folge mit
// einem absichtlich falschen Erwartungswert ist rot, genau an dieser Zeile (sonst wäre "grün" nur ein stummes Werkzeug).
// VERTRAG_DIR überschreibt djk/vertrag (dort liegen folgen/, erzeuge_material.py und folgen_vergleich.py aus 02 und 09).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fahreAlle } from '../golden.mjs';
import { zahlJson, material } from '../folge.mjs';

const HIER = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const VERTRAG = process.env.VERTRAG_DIR ?? path.resolve(HIER, '..');
const FOLGEN = path.join(VERTRAG, 'folgen');
const AB = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-golden-test-'));
material(VERTRAG, AB);
const cfg = { arbeitsbestand: AB };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-golden-folgen-'));

function kopie(name, aendern) {
  const zeilen = fs.readFileSync(path.join(FOLGEN, `${name}.jsonl`), 'utf8').split('\n').filter((z) => z.trim());
  const ziel = path.join(TMP, `${name}_mutiert.jsonl`);
  fs.writeFileSync(ziel, `${aendern(zeilen).join('\n')}\n`);
  return ziel;
}

test('JSON für Python: 64.0 bleibt Gleitkomma, NaN und Unendlich als Literal, int64 ohne Verlust', () => {
  assert.equal(zahlJson(64, 'd'), '64.0');
  assert.equal(zahlJson(-7.5, 'f'), '-7.5');
  assert.equal(zahlJson(NaN, 'd'), 'NaN');
  assert.equal(zahlJson(Infinity, 'd'), 'Infinity');
  assert.equal(zahlJson(9007199254740993n, 'h'), '9007199254740993');
  assert.equal(zahlJson('deck/1/fader', 's'), '"deck/1/fader"');
});

test('uhr_golden, storno, protokollfehler (Scheibe 02) grün über folgen_vergleich.py', () => {
  const r = fahreAlle(['uhr_golden', 'storno', 'protokollfehler'].map((n) => path.join(FOLGEN, `${n}.jsonl`)), { cfg });
  assert.deepEqual(r.map((x) => [x.name, x.gruen, x.befunde]), [['uhr_golden', true, []], ['storno', true, []], ['protokollfehler', true, []]]);
});

test('Fehlerfall: uhr_golden mit Takt 37 bei 3 237 189 statt 3 237 188 ist rot, genau an Zeile 12', () => {
  const datei = kopie('uhr_golden', (z) => z.map((x, i) => (i === 11 ? x.replace('3237188, 144.0', '3237189, 144.0') : x)));
  const [r] = fahreAlle([datei], { cfg });
  assert.equal(r.gruen, false);
  assert.deepEqual(r.befunde.map((b) => [b[0], b[1]]), [[12, 'fehlt']]);
});

test('Fehlerfall Punkt 8: protokollfehler ohne seine erwarte-Zeilen für /e/protokollfehler ist rot (unverbraucht)', () => {
  const datei = kopie('protokollfehler', (z) => z.filter((x) => !x.includes('"/e/protokollfehler"')));
  const [r] = fahreAlle([datei], { cfg });
  assert.equal(r.gruen, false);
  assert.deepEqual(r.befunde.map((b) => b[1]), ['unverbraucht', 'unverbraucht', 'unverbraucht']);
});
