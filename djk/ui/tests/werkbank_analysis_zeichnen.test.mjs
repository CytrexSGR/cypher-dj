// ANALYZE window: the pure helpers (axes, column under the playhead, time picture bytes, source list, number text). No DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hzZuX, xZuHz, dbZuY, notenName, bandBei, spalteBei, zeitbildBytes, spalteDb, quellenListe, zahlText, abfrageSchluessel, linienText, taktLinien, breiteText, zeitbildRgba, bildAnteil, bildFarbe, HZ_LINIEN, ANALYSE_TEXT }
  from '../public/werkbank/analysis_zeichnen.js';
import { tonName } from '../public/production/pianoroll.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const antwort = () => JSON.parse(fs.readFileSync(path.join(HIER, 'fixtures', 'analyse_antwort.json'), 'utf8'));
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('the frequency axis is logarithmic and invertible', () => {
  near(hzZuX(20, 1000), 0, 1e-9);
  near(hzZuX(20000, 1000), 1000, 1e-9);
  near(hzZuX(632.46, 1000), 500, 0.5);
  near(xZuHz(hzZuX(137, 800), 800), 137, 0.01);
  assert.deepEqual(HZ_LINIEN.map(linienText), ['20', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k']);
});

test('the dB axis maps top and bottom and clamps', () => {
  assert.equal(dbZuY(0, 200), 0);
  assert.equal(dbZuY(-90, 200), 200);
  assert.equal(dbZuY(-200, 200), 200);
  assert.equal(dbZuY(6, 200), 0);
  near(dbZuY(-45, 200), 100, 1e-9);
});

test('note names follow the house convention', () => {
  assert.equal(notenName(440), tonName(69));
  assert.equal(notenName(452), tonName(69));
  assert.equal(notenName(466.2), tonName(70));
});

test('the nearest band is by log distance', () => {
  const hz = [100, 200, 400];
  assert.equal(bandBei(150, hz), 1);   // the geometric mean of 100 and 200 is 141.4: 150 is nearer 200
  assert.equal(bandBei(130, hz), 0);
  assert.equal(bandBei(145, hz), 1);
  assert.equal(bandBei(1, hz), 0);
  assert.equal(bandBei(9999, hz), 2);
});

test('the column under the playhead', () => {
  const a = antwort();
  assert.equal(spalteBei(0, a), 0);
  assert.equal(spalteBei(15.999, a), 169);
  assert.equal(spalteBei(16, a), null);
  assert.equal(spalteBei(-1, a), null);
  assert.equal(spalteBei(null, a), null);
  assert.equal(spalteBei(undefined, a), null);
  assert.equal(spalteBei(8, null), null);
  const eine = antwort();
  eine.quelle.zeitbild = { ...eine.quelle.zeitbild, spalten: 1 };
  assert.equal(spalteBei(0, eine), 0);
  assert.equal(spalteBei(10, eine), 0);
});

test('the time picture decodes to dB', () => {
  const a = antwort(), z = a.quelle.zeitbild;
  const bytes = zeitbildBytes(z.daten);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes.length, z.spalten * z.zeilen);
  const db = spalteDb(a, a.quelle, 0);
  assert.equal(db.length, 120);
  for (const x of db) assert.ok(x >= -90 && x <= 0, `${x} outside -90..0`);
  near(spalteDb(a, a.quelle, 3)[5], z.db_min + (bytes[3 * z.zeilen + 5] / 255) * (z.db_max - z.db_min), 1e-9);
});

test('the source list has tracks by letter, returns, then MASTER', () => {
  const p = { spuren: [{ id: 's2', nr: 2, name: 'Bass', art: 'instrument', farbe: '#3b8fe0' }, { id: 's1', nr: 1, name: 'Drums', art: 'instrument', farbe: '#e0a33e' },
    { id: 's3', nr: 3, name: 'Loop', art: 'audio' }], returns: [{ id: 'r1', nr: 1, name: 'Echo', farbe: '#5cd0ff' }] };
  const l = quellenListe(p);
  assert.deepEqual(l.map((x) => x.text), ['A Drums', 'B Bass', 'FX 1 Echo', 'MASTER']);
  assert.deepEqual(l.map((x) => x.wert), ['spur:s1', 'spur:s2', 'return:r1', 'master']);
  assert.deepEqual(l.map((x) => x.quelle), [{ art: 'spur', id: 's1' }, { art: 'spur', id: 's2' }, { art: 'return', id: 'r1' }, { art: 'master' }]);
  assert.equal(l[0].farbe, '#e0a33e');
  assert.deepEqual(quellenListe({ spuren: [] }).map((x) => x.text), ['MASTER']);
  assert.deepEqual(quellenListe(null).map((x) => x.wert), ['master']);
  assert.equal(l.at(-1).text, ANALYSE_TEXT.master);
});

test('numbers read n/a for null', () => {
  assert.equal(zahlText(null), 'n/a');
  assert.equal(zahlText(undefined), 'n/a');
  assert.equal(zahlText(-14.234), '-14.2');
  assert.equal(zahlText(3.14159, 2), '3.14');
});

test('the request key joins source and comparison', () => {
  assert.equal(abfrageSchluessel({ art: 'spur', id: 's1' }, { art: 'spur', id: 's2' }), 'spur:s1|spur:s2');
  assert.equal(abfrageSchluessel({ art: 'master' }, null), 'master|');
});

test('bar lines follow the time signature, also when the range starts inside a bar', () => {
  assert.deepEqual(taktLinien(0, 16, 4), [0, 4, 8, 12]);
  assert.deepEqual(taktLinien(0, 16, 3), [0, 3, 6, 9, 12, 15]);
  assert.deepEqual(taktLinien(2, 14, 4), [4, 8, 12]);
  assert.deepEqual(taktLinien(4, 8, 4), [4]);
  assert.deepEqual(taktLinien(5, 4, 4), []);
});

test('a floor width reads mono', () => {
  assert.equal(breiteText(-200), 'mono');
  assert.equal(breiteText(-120), 'mono');
  assert.equal(breiteText(-14.5), '-14.5 dB');
  assert.equal(breiteText(null), 'n/a');
});

test('the time picture bytes become RGBA pixels, highest band on top', () => {
  const rgba = zeitbildRgba(Uint8Array.from([0, 255, 255, 0]), 2, 2);   // column 0: low 0, high 255; column 1: low 255, high 0
  assert.equal(rgba.length, 16);
  assert.deepEqual([...rgba.slice(0, 3)], bildFarbe(255), 'top left is the high band of column 0');
  assert.deepEqual([...rgba.slice(8, 11)], bildFarbe(0), 'bottom left is the low band of column 0');
  assert.deepEqual([...rgba.slice(12, 15)], bildFarbe(255), 'bottom right is the low band of column 1');
  assert.equal(rgba[3], 255);
});

test('the picture covers its share of the range', () => {
  const a = antwort();   // 170 columns of 0.04267 s = 7.253 s of 7.385 s
  near(bildAnteil(a), 7.2533 / 7.385, 1e-3);
  assert.equal(bildAnteil({ ...a, dauer_s: 1 }), 1);
  assert.equal(bildAnteil(null), 1);
});

// ---- slice 2 ----
import { minSekText, ballistik, maxHalten, neuesRollbild, rollbildSchiebe, ROLL_SPALTEN, vergleichOptionen, liveHinweise, haltHinweise }
  from '../public/werkbank/analysis_zeichnen.js';

test('m:ss text', () => {
  assert.equal(minSekText(0), '0:00');
  assert.equal(minSekText(65.9), '1:05');
  assert.equal(minSekText(600), '10:00');
  assert.equal(minSekText(null), 'n/a');
  assert.equal(minSekText(-1), 'n/a');
});

test('ballistics: rises at once, falls 20 dB per second', () => {
  assert.deepEqual(ballistik(null, [-30, -50], 0.1), [-30, -50]);
  assert.deepEqual(ballistik([-30, -50], [-10, -80], 0.5), [-10, -60]);
  assert.deepEqual(ballistik([-30], [-90], 0), [-30], 'no time, no fall');
  assert.deepEqual(ballistik([-30], [-90], 0.1), [-32]);
  assert.deepEqual(ballistik([-30], [-90], 1, 10), [-40], 'the fall rate is a parameter');
});

test('held maxima per band', () => {
  assert.deepEqual(maxHalten(null, [-30, -50]), [-30, -50]);
  assert.deepEqual(maxHalten([-30, -50], [-40, -20]), [-30, -20]);
});

test('the rolling picture keeps 300 columns and the newest sits at the right edge', () => {
  const b = neuesRollbild(4);
  assert.equal(b.spalten, ROLL_SPALTEN); assert.equal(ROLL_SPALTEN, 300);
  assert.equal(b.daten.length, 300 * 4);
  rollbildSchiebe(b, [0, -90, -45, 10]);
  assert.deepEqual([...b.daten.slice(299 * 4)], [255, 0, 128, 255]);
  rollbildSchiebe(b, [-90, -90, -90, -90]);
  assert.deepEqual([...b.daten.slice(298 * 4, 299 * 4)], [255, 0, 128, 255], 'the first column moved one to the left');
  assert.deepEqual([...b.daten.slice(299 * 4)], [0, 0, 0, 0]);
  for (let i = 0; i < 400; i++) rollbildSchiebe(b, [0, 0, 0, 0]);
  assert.equal(b.daten.length, 1200);
  assert.equal(b.daten[0], 255);
  rollbildSchiebe(b, [NaN, 0, 0, 0]);
  assert.equal(b.daten[299 * 4], 0, 'a value that is no number is the floor');
});

test('the comparison option list', () => {
  const streifen = [{ wert: 'spur:s1', text: 'A Drums' }, { wert: 'spur:s2', text: 'B Bass' }, { wert: 'master', text: 'MASTER' }];
  const refs = [{ id: 'r1', name: 'Club kick', rolle: 'kick' }];
  assert.deepEqual(vergleichOptionen({ streifen, quelle: 'spur:s1' }), [{ wert: '', text: 'none' }, { wert: 'spur:s2', text: 'B Bass' }, { wert: 'master', text: 'MASTER' }]);
  assert.deepEqual(vergleichOptionen({ streifen, quelle: 'live', referenzen: refs }), [{ wert: '', text: 'none' },
    { gruppe: 'REFERENCES', optionen: [{ wert: 'ref:r1', text: 'KICK · Club kick' }] }], 'no strips for the live source');
  const voll = vergleichOptionen({ streifen, quelle: 'master', referenzen: refs, datei: { sha: 'x', name: 'loop.wav' } });
  assert.equal(voll.length, 5);
  assert.deepEqual(voll.at(-2).optionen.map((o) => o.wert), ['ref:r1']);
  assert.deepEqual(voll.at(-1), { wert: 'datei', text: 'FILE · loop.wav' });
});

test('live hints: bass not mono, true peak', () => {
  const stereo = (korr, pegel) => ({ baender: [{ korrelation: korr, pegel_db: pegel }] });
  assert.deepEqual(liveHinweise({ stereo: stereo(0.9, -20), true_peak_dbtp: -3 }), []);
  assert.deepEqual(liveHinweise({ stereo: stereo(0.3, -20), true_peak_dbtp: -3 }).map((h) => h.art), ['bass_nicht_mono']);
  assert.deepEqual(liveHinweise({ stereo: stereo(0.3, -70), true_peak_dbtp: -3 }), [], 'a band without level is no hint');
  assert.deepEqual(liveHinweise({ stereo: stereo(0.9, -20), true_peak_dbtp: -0.5 }).map((h) => h.art), ['true_peak']);
  assert.deepEqual(liveHinweise({ stereo: stereo(0.9, -20), true_peak_dbtp: -1 }), [], 'exactly -1 dBTP is not above');
  assert.deepEqual(liveHinweise({ stumm: true, stereo: stereo(0.1, -20), true_peak_dbtp: 3 }), []);
  assert.deepEqual(liveHinweise(null), []);
});

test('hints are held for 2 s', () => {
  const h = [{ art: 'true_peak', text: 'tp' }];
  let r = haltHinweise({}, h, 1000);
  assert.deepEqual(r.liste, ['tp']);
  r = haltHinweise(r.gehalten, [], 2900);
  assert.deepEqual(r.liste, ['tp'], 'still held 1.9 s later');
  r = haltHinweise(r.gehalten, [], 3000);
  assert.deepEqual(r.liste, [], 'gone after 2 s');
  r = haltHinweise(r.gehalten, h, 4000); r = haltHinweise(r.gehalten, h, 5500);
  assert.deepEqual(r.liste, ['tp'], 'seen again: the hold starts anew');
});
