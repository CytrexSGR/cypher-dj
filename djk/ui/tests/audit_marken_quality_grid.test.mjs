// Audit U15: a marker edit on a fine raster cut (32/64 slices, grid finer than 1/16) measures every marker against the grid of the cut itself, as the
// raster method does; the untouched grid markers keep raster_abstand_beats 0, also after the edit is moved back (methode raster again).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setzeMarke } from '../sampler/marken.ts';
import { guete } from '../sampler/schnitt.ts';

const FRAMES = 90000, BEATS = 4;
function rasterSchnitt(n) {
  const grenzen = Array.from({ length: n + 1 }, (_, k) => Math.round(k * FRAMES / n));
  const a = { frames: FRAMES, beats: BEATS };
  return { schema: 1, id: 'x', name: 'x', quelle: {}, bpm: 128, beats: BEATS, frames: FRAMES, methode: 'raster', grenzen,
    guete: guete(a, grenzen, [], Math.min(0.25, BEATS / n)), erstellt: '2026-11-17T00:00:00Z' };
}

for (const n of [32, 64, 16]) {
  test(`${n} slices: a marker edit leaves the other grid markers on the grid, and moving it back restores raster with all zero`, () => {
    const s = rasterSchnitt(n);
    assert.ok(s.guete.every((x) => x.raster_abstand_beats === 0), 'fixture: a pure grid cut is all zero');
    const k = 5;
    const e1 = setzeMarke(s, { art: 'schieben', marke: k, frame: s.grenzen[k] + 300, einrasten: false }, []);
    assert.equal(e1.schnitt.methode, 'hand');
    e1.schnitt.guete.forEach((x, i) => { if (i !== k) assert.equal(x.raster_abstand_beats, 0, `marker ${i} untouched: ${JSON.stringify(x)}`); });
    const e2 = setzeMarke(e1.schnitt, { art: 'schieben', marke: k, frame: s.grenzen[k], einrasten: false }, []);
    assert.equal(e2.schnitt.methode, 'raster');
    assert.ok(e2.schnitt.guete.every((x) => x.raster_abstand_beats === 0), JSON.stringify(e2.schnitt.guete.filter((x) => x.raster_abstand_beats !== 0)));
  });
}

test('negative control: an anschlag cut is still measured against 1/16', () => {
  const s = { ...rasterSchnitt(8), methode: 'anschlag' };
  const e = setzeMarke(s, { art: 'schieben', marke: 3, frame: s.grenzen[3] + 100, einrasten: false }, []);
  const erwartet = guete({ frames: FRAMES, beats: BEATS }, e.schnitt.grenzen, []);
  assert.deepEqual(e.schnitt.guete, erwartet);
});
