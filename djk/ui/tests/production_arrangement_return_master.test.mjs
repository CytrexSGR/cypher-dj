// Automation slice 1 T4: the arrangement painter draws the head rows of returns and master as bands (no track stripe), the lane of an open
// return/master row, and redraws when such a row opens or shows another target. Fake 2D context that records every call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neueAnsicht } from '../public/production/timeline.js';
import { setzeKettenZiele } from '../public/production/lanes.js';

const ZIEL = 'insert.i1.b1/freq';
function kontext(log) {
  const z = {};
  return new Proxy(z, { get: (o, k) => (k in o ? o[k] : (...a) => { log.push({ k, fill: o.fillStyle, stroke: o.strokeStyle, a }); }), set: (o, k, v) => { o[k] = v; return true; } });
}
function leinwand(w, h, log) {
  return { width: w, height: h, getContext: () => kontext(log), getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h }) };
}
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
const projekt = () => ({
  tempo_bpm: 120, loop: { an: false, von_beat: 0, bis_beat: 8 }, spuren: [{ id: 's1', clips: [], automation: [] }],
  returns: [{ id: 'r1', name: 'R1', inserts: [{ id: 'i1', art: 'eq' }],
    automation: [{ id: 'a1', ziel: ZIEL, punkte: [{ beat: 0, wert: 100 }, { beat: 4, wert: 400 }] }] }],
  master: { fader_db: 0, inserts: [{ id: 'i1', art: 'eq' }],
    automation: [{ id: 'a2', ziel: ZIEL, punkte: [{ beat: 0, wert: 200 }, { beat: 4, wert: 800 }] }] },
});
async function bauen() {
  const { Arrangement } = await import('../public/production/arrangement.js');
  const log = [];
  const arr = new Arrangement({ lineal: leinwand(800, 28, []), spuren: leinwand(800, 400, log), ueber: leinwand(800, 400, []), wellen: { hole: () => ({}) } });
  const p = projekt(); setzeKettenZiele(p);
  const ansicht = neueAnsicht();
  const bild = (straenge, laneZiel = null) => { log.length = 0; arr.bild({ ansicht, projekt: p, loop: p.loop, kopfBeat: null, startBeat: 0, geist: null, straenge, laneZiel }); return log.slice(); };
  return { arr, p, bild, log };
}

test('T4: the head rows of a return and of the master are bands, not track stripes', async () => {
  const { bild } = await bauen();
  const l = bild(new Set());
  const baender = l.filter((c) => c.k === 'fillRect' && c.a[3] === 28 && c.a[0] === 0 && c.a[2] === 800);
  assert.equal(baender.length, 2, 'one band per return head and the master head');
  for (const b of baender) assert.equal(b.fill, '#171a21', 'the group head colour, not the track stripe');
});

test('T4: an open return row and an open master row draw their lane line and points', async () => {
  const { bild } = await bauen();
  const zu = bild(new Set()).filter((c) => c.k === 'arc').length;
  const offen = bild(new Set(['r1', 'master']));
  assert.equal(zu, 0);
  assert.equal(offen.filter((c) => c.k === 'arc').length, 4, 'two points on each of the two lanes');
});

test('T4: opening a return row or choosing another target redraws the rows once', async () => {
  const { arr, bild } = await bauen();
  let n = 0; const orig = arr.zeichneSpuren.bind(arr); arr.zeichneSpuren = (...a) => { n++; return orig(...a); };
  bild(new Set()); bild(new Set()); assert.equal(n, 1);
  bild(new Set(['r1'])); assert.equal(n, 2, 'a return row opened');
  bild(new Set(['r1'])); assert.equal(n, 2);
  bild(new Set(['r1']), new Map([['r1', ZIEL]])); assert.equal(n, 3, 'a target chosen for the return row');
  bild(new Set(['r1', 'master'])); assert.equal(n, 4, 'the master row opened');
});
