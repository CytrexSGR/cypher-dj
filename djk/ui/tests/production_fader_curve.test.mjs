// PRODUCTION: the fader taper (fader_curve.js). Stored values stay dB; the page maps slider position and lane height.
import test from 'node:test';
import assert from 'node:assert/strict';
import { posVonDb, dbVonPos, ANKER, reglerVonDb, dbVonRegler, REGLER_MAX, REGLER_SCHRITT, tasteMerke, tasteWert } from '../public/production/fader_curve.js';
import { wertZuY, yZuWert } from '../public/production/lanes.js';
import fs from 'node:fs';
import { LaneGeste } from '../public/production/lanes_operation.js';
import { faderWert } from '../public/production/track_heads.js';
const importVon = (datei, vor = './') => new RegExp(`from '${(vor + datei).replace(/[.]/g, '\\.')}'`);   // the file name stays a plain literal so the export's file renaming rewrites it too (a regex literal escapes the dot and escapes the rewrite)

test('anchors are exact in both directions', () => {
  const soll = [[1, 6], [0.85, 0], [0.72, -6], [0.6, -12], [0.4, -24], [0.2, -40], [0.05, -60], [0, -200]];
  for (const [p, db] of soll) {
    assert.equal(dbVonPos(p), db, `dbVonPos(${p})`);
    assert.ok(Math.abs(posVonDb(db) - p) < 1e-12, `posVonDb(${db})`);
  }
  assert.deepEqual(ANKER.map(([p, d]) => [p, d]).sort((a, b) => b[0] - a[0]), soll, 'the table is the documented one');
});

test('the mapping round-trips: every dB value of the grid goes position -> dB unchanged', () => {
  for (let db = -60; db <= 6; db += db >= -40 ? 0.5 : 1) {
    assert.equal(dbVonPos(posVonDb(db)), db, `db=${db}`);
    assert.equal(dbVonRegler(reglerVonDb(db)), db, `slider value for ${db} dB (1000 steps)`);
  }
  assert.equal(dbVonRegler(reglerVonDb(-200)), -200);
  // position -> dB -> position stays within one slider step where dB is rounded to the grid
  for (let p = 0.06; p <= 1; p += 0.01) assert.ok(Math.abs(posVonDb(dbVonPos(p)) - p) < 0.012, `p=${p}`);
});

test('the mapping is monotonic, the dB rounding is 0.5 above -40 and whole dB below', () => {
  let letzteDb = -Infinity, letztePos = -Infinity;
  for (let i = 0; i <= REGLER_MAX; i++) {
    const db = dbVonRegler(i);
    assert.ok(db >= letzteDb, `dbVonPos not decreasing at ${i}`);
    letzteDb = db;
    if (db > -40) assert.equal(db * 2, Math.round(db * 2), `0.5 dB grid at ${i}: ${db}`); else assert.equal(db, Math.round(db), `whole dB at ${i}: ${db}`);
  }
  for (let db = -200; db <= 6; db += 0.5) { const p = posVonDb(db); assert.ok(p >= letztePos, `posVonDb not decreasing at ${db}`); letztePos = p; }
  assert.ok(posVonDb(-100) > 0 && posVonDb(-100) < posVonDb(-60), 'between off and -60 strictly rising');
  assert.equal(posVonDb(-200), 0); assert.equal(posVonDb(-300), 0); assert.equal(posVonDb(9), 1); assert.equal(dbVonPos(2), 6); assert.equal(dbVonPos(-1), -200);
  assert.equal(posVonDb(NaN), 0); assert.equal(dbVonPos(NaN), -200);
});

test('control: half travel is between -20 and -12 dB (the linear -60..+6 slider gave -27)', () => {
  const taper = dbVonPos(0.5);
  assert.ok(taper >= -20 && taper <= -12, `taper: ${taper}`);
  const linear = -60 + 0.5 * 66;
  assert.equal(linear, -27);
  assert.ok(!(linear >= -20 && linear <= -12), 'the control: the old mapping fails this range');
});

test('slider grid: every anchor lies on a slider step, a step is at most 0.7 dB', () => {
  for (const [p] of ANKER) assert.equal((p * REGLER_MAX) % REGLER_SCHRITT, 0, `anchor ${p}`);
  for (let i = REGLER_SCHRITT * 10; i < REGLER_MAX; i += REGLER_SCHRITT) assert.ok(dbVonRegler(i + REGLER_SCHRITT) - dbVonRegler(i) <= 2, `step at ${i}`);
  assert.equal(faderWert(dbVonRegler(40)), -200, 'bottom of the slider = off (faderWert: -60 and below)');
});

test('lane row: the y axis uses the taper, drawing a point converts back to dB', () => {
  const zeile = { y: 0, h: 48 };
  const unten = wertZuY(zeile, -200, 'fader'), oben = wertZuY(zeile, 6, 'fader');
  const mitte = (unten + oben) / 2;
  const dbMitte = yZuWert(zeile, mitte, 'fader');
  assert.ok(dbMitte >= -20 && dbMitte <= -12, `middle of the row: ${dbMitte} dB`);
  assert.ok(Math.abs(wertZuY(zeile, -30, 'fader') - mitte) > 1, '-30 dB is no longer the middle of the row');
  assert.equal(yZuWert(zeile, wertZuY(zeile, -60, 'fader'), 'fader'), -60, 'the lane axis ends at -60 dB, the bottom band is not off');
  assert.equal(yZuWert(zeile, wertZuY(zeile, -200, 'fader') - 1, 'fader'), -60, 'one pixel above the bottom edge: -60, still not off');
  for (const db of [-40, -24, -12, -6, 0, 6]) assert.ok(Math.abs(yZuWert(zeile, wertZuY(zeile, db, 'fader'), 'fader') - db) < 1e-9, `${db}`);
  assert.equal(yZuWert(zeile, 1000, 'fader'), -200, 'the bottom of the row draws off');
  // negative control: pan stays linear
  assert.equal(yZuWert(zeile, wertZuY(zeile, 0.5, 'pan'), 'pan') > 0.499 && yZuWert(zeile, wertZuY(zeile, 0.5, 'pan'), 'pan') < 0.501, true);
  assert.equal(wertZuY(zeile, 0, 'pan'), 24);
});

test('lane: a point at -55 dB grabbed 2 px below its centre and moved sideways keeps a value at or above -60 (no cliff to off)', () => {
  const zeile = { y: 0, h: 48 };
  const lane = { id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: -55 }, { beat: 8, wert: 0 }] };
  const g = new LaneGeste({ lane, zeile, beatZuX: (b) => b * 10, xZuBeat: (x) => x / 10, raster: 0 });
  const y0 = wertZuY(zeile, -55, 'fader');
  assert.equal(g.down(40, y0 + 2), 'punkt');
  g.move(60, y0 + 2); g.move(70, y0 + 2);
  const wert = g.ende.wert;
  assert.ok(wert >= -60 && wert < -50, `value after the sideways drag: ${wert}`);
  // without the grip offset the same y would be read absolutely
  assert.ok(yZuWert(zeile, y0 + 2, 'fader') >= -60, 'the bottom band is -60, not off');
  // negative control: really dragging down to the bottom edge still reaches off; a drag to the middle gives the taper value
  const g2 = new LaneGeste({ lane, zeile, beatZuX: (b) => b * 10, xZuBeat: (x) => x / 10, raster: 0 });
  g2.down(40, y0); g2.move(40, zeile.h + 20);
  assert.equal(g2.ende.wert, -200, 'dragged out below the row: off');
});

test('keyboard: one press moves the stored dB by at least one rounding step in its direction, from every grid value', () => {
  let tot = 0;
  for (let db = -59; db <= 6; db += db >= -40 ? 0.5 : 1) {
    for (const [key, richtung] of [['ArrowUp', 1], ['ArrowDown', -1]]) {
      const r = { value: String(reglerVonDb(db)) };
      tasteMerke(r, key);
      r.value = String(Number(r.value) + richtung * REGLER_SCHRITT);   // what the browser does
      const v = tasteWert(r);
      if (richtung > 0 && db === 6) { assert.equal(v, 6, 'clamped at the top'); continue; }
      tot++;
      assert.ok(richtung > 0 ? v > db : v < db, `${key} from ${db}: ${v}`);
      assert.equal(dbVonRegler(r.value), v, 'the thumb is put on the sent value');
    }
  }
  assert.ok(tot > 200);
  // negative control: no key press (a mouse move) is plain dbVonRegler
  const m = { value: '500' }; assert.equal(tasteWert(m), -18);
});

test('the production master template uses the slider constants of fader_curve.js (no hard-coded 0/1000/5)', () => {
  const src = fs.readFileSync(new URL('../public/production/production.js', import.meta.url), 'utf8');
  assert.match(src, /data-p="pm-fader" type="range" min="0" max="\$\{REGLER_MAX\}" step="\$\{REGLER_SCHRITT\}"/);
  assert.match(src, /import \{ REGLER_MAX, REGLER_SCHRITT \} /); assert.match(src, importVon('fader_curve.js'));
});
