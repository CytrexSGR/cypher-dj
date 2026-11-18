// Plan studio-taktart T4: the page grids and counters follow the open project's meter n/4; at 4 they equal the old expressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { takteProLive as tsHelfer } from '../project/taktart_live.ts';
import { takteProLive, zaehlerVon, leitstandZaehlt, proTaktJetzt, setzeProTakt } from '../public/bar_live.js';
import { linealZellen, laengeText, laengeAusSchritten, laengenWahl, pxProBeat, sichtbarBeats, eigenLaengen } from '../public/seq_field.js';
import { zelleBefehle, laengeBefehle, folgeEditierbar } from '../public/seq_logic.js';

const WERTE = [undefined, null, [4, 4], [3, 4], [6, 8], [13, 4], [1, 4], [3.5, 4], '3', [12, 4], [2, 4]];

test('drift: takteProLive (TS) equals takteProLive (public/bar_live.js)', () => {
  for (const w of WERTE) assert.equal(takteProLive(w), tsHelfer(w), JSON.stringify(w));
  assert.deepEqual(WERTE.map(takteProLive), [4, 4, 4, 3, 4, 4, 4, 4, 4, 12, 2]);
});

test('zaehlerVon: 7.5 in 3 is bar 3 beat 2 phrase 1, in 4 bar 2 beat 4 phrase 1; at 4 equal to the old expressions', () => {
  assert.deepEqual(zaehlerVon(7.5, 3), { takt: 3, schlag: 2, phrase: 1 });
  assert.deepEqual(zaehlerVon(7.5, 4), { takt: 2, schlag: 4, phrase: 1 });
  for (const b of [0, 0.5, 3.99, 4, 31.9, 32, 100, 1234.5]) {
    const z = zaehlerVon(b, 4);
    assert.equal(z.takt, Math.floor(b / 4) + 1);
    assert.equal(z.phrase, Math.floor(b / 32) + 1);
  }
  assert.equal(zaehlerVon(100).takt, Math.floor(100 / 4) + 1, 'default is 4');
  assert.equal(zaehlerVon(24, 3).phrase, 2, 'a phrase is 8 bars of 3');
});

test('seq ruler at proTakt 3 flags a bar every 3 beats; the length text counts bars of 3', () => {
  const z = linealZellen(12, 12, 3);
  assert.deepEqual(z.filter((c) => c.takt).map((c) => c.beat), [0, 3, 6, 9]);
  assert.deepEqual(linealZellen(12, 12).filter((c) => c.takt).map((c) => c.beat), [0, 4, 8]);
  assert.equal(laengeText(6, 3), '2 bars');
  assert.equal(laengeText(3, 3), '1 bar');
  assert.equal(laengeText(48, 3), '16 bars');
  assert.equal(laengeText(4), '1 bar');
  assert.equal(sichtbarBeats(2, 4, 3), 6);
  assert.equal(pxProBeat(2, 16, 600, 3), 100);
  assert.equal(laengeAusSchritten('768', 12), 192);
  assert.equal(laengeAusSchritten('768'), null, 'default 4 keeps the 256 step limit');
});

test('a new pattern clip is 16 bars of the open meter; a 48-beat clip is editable at 3, the legacy 64 too', () => {
  const spur = { id: 's1', name: 'Bass', art: 'instrument', clips: [] };
  const neu = (p) => { setzeProTakt(p); return laengeBefehle(spur, null, 8)[0].laenge_beats; };
  try {
    assert.equal(neu(4), 64);
    assert.equal(neu(3), 48);
    assert.equal(neu(12), 192);
    assert.equal(proTaktJetzt(), 12);
    const mit = (l) => ({ ...spur, clips: [{ id: 'c', art: 'midi', start_beat: 0, laenge_beats: l }] });
    setzeProTakt(3);
    assert.equal(folgeEditierbar(mit(48)), true);
    assert.equal(folgeEditierbar(mit(64)), true, 'stored 64 stays valid (no migration)');
    assert.equal(folgeEditierbar(mit(50)), false);
    setzeProTakt(4);
    assert.equal(folgeEditierbar(mit(48)), false, 'at 4 only 64');
    assert.equal(zelleBefehle(spur, null, { id: 'noten', art: 'noten', teiler: 0.25 }, 0, { an: true })[0].laenge_beats, 64);
  } finally { setzeProTakt(4); }
});

test('instanzen: since bar at ab_beat 9 is 4 at proTakt 3 and 3 at 4', () => {
  const q = fs.readFileSync(new URL('../public/instanzen.js', import.meta.url), 'utf8');
  assert.match(q, /Math\.floor\(s\.status\.ab_beat \/ proTaktJetzt\(\)\) \+ 1/);
  assert.equal(Math.floor(9 / 3) + 1, 4);
  assert.equal(Math.floor(9 / 4) + 1, 3);
});

test('stream.js: the conductor takt event counts only while proTakt is 4; /uhr uses the project meter; the meter arrives by SSE and /lage', () => {
  assert.equal(leitstandZaehlt(4), true);
  assert.equal(leitstandZaehlt(3), false);
  const q = fs.readFileSync(new URL('../public/stream.js', import.meta.url), 'utf8');
  assert.match(q, /if \(leitstandZaehlt\(proTaktJetzt\(\)\)\) \{ \$\('#takt'\)\.textContent = n\.daten\.takt/);
  assert.match(q, /zaehlerVon\(f\.beat, proTaktJetzt\(\)\)/);
  assert.match(q, /case 'taktart': uebernimmTaktart\(f\.proTakt\)/);
  assert.match(q, /fetch\('\/lage'\)/);
});

test('length menu offers only bar counts that fit the stored clip (review finding: 12/4 over a 64-beat clip)', () => {
  assert.deepEqual(laengenWahl(64, 4), [1, 2, 4, 8, 16], '4/4 over 64 beats: the old menu');
  assert.deepEqual(laengenWahl(48, 3), [1, 2, 4, 8, 16], '3/4 over its own 48-beat clip');
  assert.deepEqual(laengenWahl(64, 3), [1, 2, 4, 8, 16], '3/4 over a stored 64-beat clip: 48 fits');
  assert.deepEqual(laengenWahl(64, 12), [1, 2, 4], '12/4 over 64 beats: 8 bars (96) and 16 bars (192) are refused by the clip');
  assert.deepEqual(laengenWahl(192, 12), [1, 2, 4, 8, 16], '12/4 over its own 192-beat clip');
  assert.deepEqual(laengenWahl(48, 4), [1, 2, 4, 8], '4/4 over a 48-beat clip of a former 3/4 project: 16 bars (64) do not fit');
  assert.equal(laengeAusSchritten('768', 12, 64), null, 'the step prompt is bounded by the clip as well');
  assert.equal(laengeAusSchritten('256', 12, 64), 64);
  assert.equal(laengeAusSchritten('256', 4), 64, 'default unchanged');
});
