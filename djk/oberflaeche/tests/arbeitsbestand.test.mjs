// 60m-Nachtrag: Kopie einer Fassung aus bestand/ in den Arbeitsbestand (Form Plan 36 F2 / Plan 31 N4): bytegleich und
// erst per rename sichtbar; Fehlerfall: kaputte oder fehlende Fassung wird abgewiesen, keine halbe Kopie bleibt liegen.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inArbeitsbestand, KopieFehler, raeumeAuf, fassungsOrdner, arbeitsbestandVorgabe } from '../arbeitsbestand.ts';
import { baueBestand } from './hilfen/bestand.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk60n-ab-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const B = path.join(tmp, 'bestand');
const GUT = 'f0000000000000a1';
const KAPUTT = { sha: 'f0000000000000b1', kurz: 'f0000000000000b2', ohne_audio: 'f0000000000000b3', ohne_json: 'f0000000000000b4',
  json: 'f0000000000000b5', fremd: 'f0000000000000b6' };
baueBestand(B, [{ material_id: GUT, titel: 'Alpha' }, ...Object.entries(KAPUTT).map(([k, id]) => ({ material_id: id, titel: k, kaputt: k }))]);
const inhalt = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);

test('Arbeitsbestand je Instanz wie der Kern (kern.toml:5, Z2)', () => {
  assert.equal(arbeitsbestandVorgabe(''), '/dev/shm/cypherdj/material');
  assert.equal(arbeitsbestandVorgabe('g'), '/dev/shm/cypherdj-g/material');
});

test('kopiert fassung.json und basis.f32 bytegleich; der zweite Aufruf kopiert nicht', async () => {
  const ab = path.join(tmp, 'ab1');
  const r = await inArbeitsbestand(B, ab, GUT, 128, 1);
  assert.equal(r.kopiert, true);
  assert.equal(r.mit_stems, 0);
  assert.equal(r.ordner, fassungsOrdner(ab, GUT, 128, 1));
  assert.equal(r.ordner, path.join(ab, GUT, 'fassungen', '128000_r1'));
  for (const n of ['fassung.json', 'basis.f32']) {
    assert.ok(fs.readFileSync(path.join(r.ordner, n)).equals(fs.readFileSync(path.join(fassungsOrdner(B, GUT, 128, 1), n))), n);
  }
  assert.equal(r.bytes, 48000 * 8);
  const r2 = await inArbeitsbestand(B, ab, GUT, 128, 1);
  assert.equal(r2.kopiert, false);
  assert.deepEqual(inhalt(ab), [GUT]);
});

for (const [art, code, muster] of [['sha', 'pruefung', /sha256/], ['kurz', 'pruefung', /Bytes statt/], ['ohne_audio', 'material_fehlt', /basis\.f32/],
  ['ohne_json', 'material_fehlt', /fassung\.json fehlt/], ['json', 'pruefung', /fassung\.json/], ['fremd', 'pruefung', /gehört zu/]]) {
  test(`Fehlerfall ${art}: ${code}, kein Zielordner, keine halbe Kopie`, async () => {
    const ab = path.join(tmp, `ab-${art}`);
    await assert.rejects(inArbeitsbestand(B, ab, KAPUTT[art], 128, 1),
      (e) => e instanceof KopieFehler && e.code === code && muster.test(e.message));
    assert.equal(fs.existsSync(fassungsOrdner(ab, KAPUTT[art], 128, 1)), false);
    assert.deepEqual(inhalt(ab).filter((n) => n.startsWith('.kopie-') || n === KAPUTT[art]), []);
  });
}

test('Fassung fehlt im Bestand → material_fehlt', async () => {
  await assert.rejects(inArbeitsbestand(B, path.join(tmp, 'ab3'), GUT, 128, 7), (e) => e instanceof KopieFehler && e.code === 'material_fehlt');
});

test('eine andere Fassung gleichen Namens liegt schon da → pruefung, sie bleibt unangetastet', async () => {
  const ab = path.join(tmp, 'ab4');
  const ziel = fassungsOrdner(ab, GUT, 128, 1);
  fs.mkdirSync(ziel, { recursive: true });
  fs.writeFileSync(path.join(ziel, 'fassung.json'), '{"anders": true}');
  await assert.rejects(inArbeitsbestand(B, ab, GUT, 128, 1), (e) => e instanceof KopieFehler && e.code === 'pruefung');
  assert.equal(fs.readFileSync(path.join(ziel, 'fassung.json'), 'utf8'), '{"anders": true}');
  assert.deepEqual(inhalt(ab), [GUT]);
});

test('zwei gleichzeitige Aufrufe teilen sich eine Kopie', async () => {
  const ab = path.join(tmp, 'ab5');
  const [x, y] = await Promise.all([inArbeitsbestand(B, ab, GUT, 128, 1), inArbeitsbestand(B, ab, GUT, 128, 1)]);
  assert.equal(x, y);
  assert.equal(x.kopiert, true);
});

test('raeumeAuf entfernt Reste toter Prozesse und lässt eigene und fertige Fassungen', () => {
  const ab = path.join(tmp, 'ab6');
  fs.mkdirSync(path.join(ab, '.kopie-999999999-1'), { recursive: true });
  fs.writeFileSync(path.join(ab, '.kopie-999999999-1', 'basis.f32'), 'halb');
  fs.mkdirSync(path.join(ab, `.kopie-${process.pid}-1`), { recursive: true });
  fs.mkdirSync(path.join(ab, GUT), { recursive: true });
  assert.equal(raeumeAuf(ab), 1);
  assert.deepEqual(inhalt(ab).sort(), [`.kopie-${process.pid}-1`, GUT].sort());
  assert.equal(raeumeAuf(path.join(tmp, 'gibt-es-nicht')), 0);
});

// Befund 1 (adversariale Prüfung): Pfade aus fassung.json ('datei', 'stems.*.datei') bestimmen, wohin geschrieben
// wird. '..' oder absolut → pruefung, nichts außerhalb des Arbeitsbestands. Die Audiodaten liegen jeweils an der Stelle,
// auf die der böse Pfad zeigt, mit passender Größe und sha256: ohne Pfadprüfung ginge die Kopie durch.
const B2 = path.join(tmp, 'bestand2');
const BOESE = { hoch: 'f0000000000000c1', absolut: 'f0000000000000c2', stem_hoch: 'f0000000000000c3', STEMS: 'f0000000000000c4' };
const absolutZiel = path.join(tmp, 'absolut', 'basis.f32');
baueBestand(B2, [
  { material_id: BOESE.hoch, titel: 'up', datei: '../../boese.f32' },
  { material_id: BOESE.absolut, titel: 'abs', datei: absolutZiel },
  { material_id: BOESE.stem_hoch, titel: 'stem up', stems: true, stem_datei: { vocals: '../../boese_stem.f32' } },
  { material_id: BOESE.STEMS, titel: 'Stems', stems: true },
]);

for (const [art, auswaerts] of [['hoch', 'boese.f32'], ['absolut', null], ['stem_hoch', 'boese_stem.f32']]) {
  test(`Befund 1: böser Pfad in fassung.json (${art}) → pruefung, nichts außerhalb geschrieben`, async () => {
    const wurzel = path.join(tmp, `ab-boese-${art}`);
    const ab = path.join(wurzel, 'material');
    await assert.rejects(inArbeitsbestand(B2, ab, BOESE[art], 128, 1),
      (e) => e instanceof KopieFehler && e.code === 'pruefung' && /Pfad/.test(e.message));
    if (auswaerts) assert.equal(fs.existsSync(path.join(wurzel, auswaerts)), false, `${auswaerts} neben dem Arbeitsbestand`);
    assert.deepEqual(inhalt(wurzel).filter((n) => n !== 'material'), [], 'neben dem Arbeitsbestand liegt nichts');
    assert.deepEqual(inhalt(ab), [], 'keine halbe Kopie, kein Zielordner');
  });
}

test('Befund 3: analyse_quelle = stems → vier Stems bytegleich, basis.f32 nicht kopiert, mit_stems 1', async () => {
  const ab = path.join(tmp, 'ab-stems');
  const r = await inArbeitsbestand(B2, ab, BOESE.STEMS, 128, 1);
  assert.equal(r.kopiert, true);
  assert.equal(r.mit_stems, 1);
  assert.equal(r.bytes, 4 * 48000 * 8);
  const q = fassungsOrdner(B2, BOESE.STEMS, 128, 1);
  for (const n of ['drums', 'bass', 'vocals', 'other']) {
    assert.ok(fs.readFileSync(path.join(r.ordner, 'stems', `${n}.f32`)).equals(fs.readFileSync(path.join(q, 'stems', `${n}.f32`))), n);
  }
  assert.deepEqual(inhalt(r.ordner).sort(), ['fassung.json', 'stems']);
  assert.deepEqual(inhalt(path.join(r.ordner, 'stems')).sort(), ['bass.f32', 'drums.f32', 'other.f32', 'vocals.f32']);
  const r2 = await inArbeitsbestand(B2, ab, BOESE.STEMS, 128, 1);
  assert.equal(r2.kopiert, false, 'zweiter Aufruf erkennt die Stems als schon da');
  assert.equal(r2.mit_stems, 1);
});

test('Befund 3: ein Stem mit falscher Prüfsumme → pruefung, keine halbe Kopie', async () => {
  const B3 = path.join(tmp, 'bestand3');
  baueBestand(B3, [{ material_id: BOESE.STEMS, titel: 'Stems', stems: true }]);
  const fjPfad = path.join(fassungsOrdner(B3, BOESE.STEMS, 128, 1), 'fassung.json');
  const fj = JSON.parse(fs.readFileSync(fjPfad, 'utf8'));
  fj.stems.other.sha256 = '0'.repeat(64);
  fs.writeFileSync(fjPfad, JSON.stringify(fj));
  const ab = path.join(tmp, 'ab-stems-kaputt');
  await assert.rejects(inArbeitsbestand(B3, ab, BOESE.STEMS, 128, 1), (e) => e instanceof KopieFehler && e.code === 'pruefung' && /other/.test(e.message));
  assert.deepEqual(inhalt(ab), []);
});
