// Automation Slice 1, task 10 (AK26 JS half, AK28): the lane functions of the page, pure (node).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { laneWert, wertZuY, yZuWert, lanePfad, trefferPunkt, ziehePunkt, setzePunkt, loeschePunkt, faderLane, hatLane, LANE_HOEHE, ZUG_SCHWELLE,
  NACHBAR_ABSTAND, WERT_MIN, WERT_MAX, MAX_BEAT, ZIEL_ANZEIGE, ZIELE, freieZiele, gezeigteLane, laneFuer, bereich, laneSchutz, unbekanntesZiel } from '../public/production/lanes.js';
import { ZIEL_BEREICH } from '../project/model.ts';

const REF = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kern', 'tests', 'daten', 'lane_ref.json');
import { posVonDb } from '../public/production/fader_curve.js';
const zeile = { y: 100, h: LANE_HOEHE };

test('S1 T10 lanes.js: laneWert equals the reference file at 1000 pairs (relative 1e-4), the same pairs as the core and the server', () => {
  const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
  assert.equal(ref.paare.length, 1000);
  let mute = 0;
  const schlecht = [];
  for (const pr of ref.paare) {
    const ist = laneWert(ref.lanes[pr.lane], pr.beat, 'fader');
    if (pr.wert <= -120) mute++;
    if (!(Math.abs(ist - pr.wert) <= 1e-4 * Math.max(1, Math.abs(pr.wert)))) schlecht.push({ lane: pr.lane, beat: pr.beat, ist, soll: pr.wert });
  }
  assert.deepEqual(schlecht.slice(0, 5), []);
  assert.ok(mute > 10, `positive control: the file holds mute cases (${mute})`);
});

test('S1 T10 lanes.js: negative control, a jump read as linear differs from the reference file', () => {
  const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
  const falsch = (pk, b) => laneWert(pk.map((p) => ({ ...p, form: p.form === 'sprung' ? 'linear' : p.form })), b, 'fader');
  const abw = ref.paare.filter((pr) => Math.abs(falsch(ref.lanes[pr.lane], pr.beat) - pr.wert) > 1e-4 * Math.max(1, Math.abs(pr.wert)));
  assert.ok(abw.length > 5, `${abw.length} pairs differ`);
});

test('S1 T10 lanes.js: value to y and back, limits clamp', () => {
  assert.ok(wertZuY(zeile, WERT_MAX, 'fader') < wertZuY(zeile, -60, 'fader'), 'louder is higher (smaller y)');
  assert.ok(wertZuY(zeile, -200, 'fader') > wertZuY(zeile, -60, 'fader'), 'fader taper: off sits on the bottom edge, -60 dB just above it');
  assert.equal(wertZuY(zeile, -200, 'fader'), zeile.y + zeile.h - 3, 'off = bottom edge');
  for (const db of [-30, 0, 6]) assert.ok(Math.abs(yZuWert(zeile, wertZuY(zeile, db, 'fader'), 'fader') - db) < 1e-9, `db=${db}`);
  assert.equal(yZuWert(zeile, 0, 'fader'), WERT_MAX, 'above the row clamps to +6');
  assert.ok(yZuWert(zeile, 1000, 'fader') >= WERT_MIN && yZuWert(zeile, 1000, 'fader') <= -59.9, 'below the row clamps to the bottom of the display range');
});

test('S1 T10 lanes.js: the path shows a jump as a vertical edge', () => {
  const punkte = [{ beat: 0, wert: 0 }, { beat: 8, wert: -10 }, { beat: 8, wert: -40 }, { beat: 16, wert: -40 }];
  const a = { beat0: 0, pxProBeat: 10 };
  const pfad = lanePfad(punkte, zeile, (b) => (b - a.beat0) * a.pxProBeat, (x) => a.beat0 + x / a.pxProBeat, 200, 'fader');
  const ys = new Set(pfad.filter(([x]) => x === 80).map(([, y]) => y));
  assert.ok(ys.has(wertZuY(zeile, -10, 'fader')) && ys.has(wertZuY(zeile, -40, 'fader')), 'both values of the jump at x=80');
  assert.equal(lanePfad([], zeile, (b) => b, (x) => x, 100, 'fader').length, 0);
});

test('S1 T10 lanes.js: hit test picks the nearest point within the radius', () => {
  const punkte = [{ beat: 0, wert: 0 }, { beat: 4, wert: -20 }];
  const bx = (b) => b * 10;
  assert.equal(trefferPunkt(punkte, zeile, bx, 40 + 2, wertZuY(zeile, -20, 'fader') - 2, 'fader'), 1);
  assert.equal(trefferPunkt(punkte, zeile, bx, 40 + 9, wertZuY(zeile, -20, 'fader'), 'fader'), -1, 'outside the radius');
  assert.equal(trefferPunkt([], zeile, bx, 0, 0, 'fader'), -1);
});

test('S1 T10 lanes.js: limits and neighbours of a drag', () => {
  const pk = [{ beat: 0, wert: 0 }, { beat: 4, wert: -10 }, { beat: 8, wert: -20 }];
  assert.deepEqual(ziehePunkt(pk, 1, 5.1, -12, 1, 'fader'), { beat: 5, wert: -12 }, 'raster');
  assert.equal(ziehePunkt(pk, 1, 99, 0, 1, 'fader').beat, 8 - NACHBAR_ABSTAND, 'stops before the right neighbour');
  assert.equal(ziehePunkt(pk, 1, -99, 0, 0, 'fader').beat, NACHBAR_ABSTAND, 'stops after the left neighbour');
  assert.equal(ziehePunkt(pk, 1, 4, 99, 0, 'fader').wert, WERT_MAX);
  assert.equal(ziehePunkt(pk, 1, 4, -999, 0, 'fader').wert, WERT_MIN);
  assert.equal(ziehePunkt(pk, 2, 1e9, 0, 0, 'fader').beat, MAX_BEAT, 'the last point stops at MAX_BEAT');
  assert.equal(ziehePunkt(pk, 0, -5, 0, 0, 'fader').beat, 0, 'the first point stops at beat 0');
  assert.equal(ZUG_SCHWELLE, 3);
});

test('S1 T10 lanes.js: set and delete points, the order stays sorted, the last point stays', () => {
  const pk = [{ beat: 0, wert: 0 }, { beat: 8, wert: -20 }];
  const r = setzePunkt(pk, 4.2, -10, 0.25, 'fader');
  assert.deepEqual(r.punkte.map((p) => p.beat), [0, 4.25, 8]);
  assert.equal(r.index, 1);
  assert.equal(setzePunkt(Array.from({ length: 8192 }, (_, i) => ({ beat: i, wert: 0 })), 9000, 0, 1, 'fader'), null, 'a full lane takes no point');
  assert.deepEqual(loeschePunkt(r.punkte, 1), pk);
  assert.equal(loeschePunkt([{ beat: 0, wert: 0 }], 0), null, 'the last point cannot be deleted');
  assert.equal(loeschePunkt(pk, 5), null);
});

test('S1 T10 lanes.js: the lane of a track', () => {
  const s = { automation: [{ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }] }] };
  assert.equal(faderLane(s).id, 'a1');
  assert.equal(hatLane(s), true);
  assert.equal(hatLane({}), false);
  assert.equal(faderLane(null), null);
});

// ---------------------------------------------------------------- Automation Slice 2, task 6

test('S2 T6 lanes.js: the page table ZIEL_ANZEIGE has the ranges of the server table ZIEL_BEREICH (same targets, same order, same min, max, nurSprung)', () => {
  assert.deepEqual(Object.keys(ZIEL_ANZEIGE), Object.keys(ZIEL_BEREICH));
  assert.deepEqual(ZIELE, Object.keys(ZIEL_BEREICH));
  for (const [z, b] of Object.entries(ZIEL_BEREICH)) {
    assert.equal(ZIEL_ANZEIGE[z].min, b.min, `${z} min`);
    assert.equal(ZIEL_ANZEIGE[z].max, b.max, `${z} max`);
    assert.equal(ZIEL_ANZEIGE[z].nurSprung, b.nurSprung, `${z} nurSprung`);
    assert.ok(ZIEL_ANZEIGE[z].anzeigeMin >= b.min && ZIEL_ANZEIGE[z].anzeigeMin < b.max, `${z} anzeigeMin inside the range`);
  }
  assert.deepEqual(Object.values(ZIEL_ANZEIGE).map((b) => b.label), ['Volume', 'Pan', 'Mute', 'Solo', 'Device Volume', 'Cutoff', 'Resonance', 'Env Mod',
    'Knob 1', 'Knob 2', 'Knob 3', 'Knob 4', 'Knob 5', 'Knob 6', 'Knob 7', 'Knob 8']);
});

test('S2 T6 lanes.js: negative control, a changed page table would be caught (a pan range of 0..1 differs from the server)', () => {
  assert.notEqual({ ...ZIEL_ANZEIGE.pan, min: 0 }.min, ZIEL_BEREICH.pan.min);
});

test('S2 T6 lanes.js: the dB rule belongs to the fader only', () => {
  const mute = [{ beat: 0, wert: -200 }, { beat: 8, wert: 0 }];
  assert.equal(laneWert(mute, 4, 'fader'), -30, 'fader: the ramp from mute runs from -60 to 0 (the dB rule)');
  const pan = [{ beat: 0, wert: -1 }, { beat: 8, wert: 1 }];
  assert.equal(laneWert(pan, 4, 'pan'), 0, 'pan: plain linear, the centre in the middle');
  assert.equal(laneWert(pan, 2, 'pan'), -0.5);
  const lo = [{ beat: 0, wert: -200 }, { beat: 8, wert: 0 }];   // out of the range of pan, but the point is: no dB rule outside the fader
  assert.equal(laneWert(lo, 4, 'geraet.cutoff'), -100, 'a device target interpolates plainly');
  
});

test('S2 T6 lanes.js: pan is drawn bipolar: -1 at the bottom edge, 0 in the middle, +1 at the top edge', () => {
  const yMitte = wertZuY(zeile, 0, 'pan'), yOben = wertZuY(zeile, 1, 'pan'), yUnten = wertZuY(zeile, -1, 'pan');
  assert.ok(yOben < yMitte && yMitte < yUnten);
  assert.ok(Math.abs((yOben + yUnten) / 2 - yMitte) < 1e-9, 'the centre line lies in the middle of the row');
  assert.equal(ZIEL_ANZEIGE.pan.mittellinie, 0);
  assert.equal(ZIEL_ANZEIGE.fader.mittellinie, 0);
  for (const v of [-1, -0.25, 0, 0.5, 1]) assert.ok(Math.abs(yZuWert(zeile, wertZuY(zeile, v, 'pan'), 'pan') - v) < 1e-9, `pan=${v}`);
  assert.equal(yZuWert(zeile, 0, 'pan'), 1, 'above the row clamps to +1');
  assert.equal(yZuWert(zeile, 1000, 'pan'), -1, 'below the row clamps to -1');
  });

test('S2 T6 lanes.js: geraet.* runs 0..1 from the bottom to the top edge and clamps', () => {
  for (const z of ['geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod']) {
    assert.ok(wertZuY(zeile, 1, z) < wertZuY(zeile, 0, z), z);
    assert.equal(yZuWert(zeile, 0, z), 1, `${z} top`);
    assert.equal(yZuWert(zeile, 1000, z), 0, `${z} bottom`);
    assert.ok(Math.abs(yZuWert(zeile, wertZuY(zeile, 0.3, z), z) - 0.3) < 1e-9, `${z} 0.3`);
    assert.equal(ziehePunkt([{ beat: 0, wert: 0 }], 0, 0, 5, 0, z).wert, 1, `${z}: a drag clamps to 1`);
    assert.equal(ziehePunkt([{ beat: 0, wert: 0 }], 0, 0, -5, 0, z).wert, 0, `${z}: a drag clamps to 0`);
  }
  assert.equal(setzePunkt([{ beat: 0, wert: 0 }], 4, 0.4375, 0, 'geraet.cutoff').punkte[1].wert, 0.438, 'rounded to 1e-3 like the other targets');
});

test('S2 T6 lanes.js: mute and solo are two levels, a drag or a new point lands on 0 or 1', () => {
  for (const z of ['mute', 'solo']) {
    assert.ok(wertZuY(zeile, 1, z) < wertZuY(zeile, 0, z));
    assert.equal(yZuWert(zeile, wertZuY(zeile, 0.4, z) - 8, z), 1, `${z}: upper half is 1`);
    assert.equal(yZuWert(zeile, wertZuY(zeile, 0.4, z) + 8, z), 0, `${z}: lower half is 0`);
    assert.equal(ziehePunkt([{ beat: 0, wert: 0 }], 0, 0, 0.7, 0, z).wert, 1);
    assert.equal(ziehePunkt([{ beat: 0, wert: 0 }], 0, 0, 0.3, 0, z).wert, 0);
    assert.equal(setzePunkt([{ beat: 0, wert: 0 }], 4, 0.9, 0, z).punkte[1].wert, 1);
  }
  const pk = [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 8, wert: 1, form: 'sprung' }];
  assert.equal(laneWert(pk, 7.99, 'mute'), 0);
  assert.equal(laneWert(pk, 8, 'mute'), 1);
  const bx = (b) => b * 10, xb = (x) => x / 10;
  const pfad = lanePfad(pk, zeile, bx, xb, 200, 'mute');
  const ys = new Set(pfad.filter(([x]) => x === 80).map(([, y]) => y));
  assert.ok(ys.has(wertZuY(zeile, 0, 'mute')) && ys.has(wertZuY(zeile, 1, 'mute')), 'the switch edge at beat 8 is vertical (both levels at x=80)');
  assert.ok(pfad.every(([, y]) => y === wertZuY(zeile, 0, 'mute') || y === wertZuY(zeile, 1, 'mute')), 'only the two levels are drawn');
});

test('S2 T6 lanes.js: the free targets of a track: no geraet.* on host or audio tracks, no target twice', () => {
  const audio = { id: 's1', art: 'audio' };
  const wirt = { id: 's2', art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 } };
  const rb = { id: 's3', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } };
  assert.deepEqual(freieZiele(audio), ['fader', 'pan', 'mute', 'solo']);
  assert.deepEqual(freieZiele(wirt), ['fader', 'pan', 'mute', 'solo']);
  assert.deepEqual(freieZiele(rb), ZIELE.filter((z) => !/^geraet\.k[1-8]$/.test(z)), 'an internal RB track offers its eight, not the bk knobs');
  const bk = { id: 's4', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'juno-pad', parameter: {} } };
  assert.deepEqual(freieZiele(bk), [...ZIELE.filter((z) => !z.startsWith('geraet.')), ...ZIELE.filter((z) => /^geraet\.k[1-8]$/.test(z))],
    'a bk track offers its eight knobs, not the RB-338 parameters');
  const mit = { ...rb, automation: [{ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }] }, { id: 'a2', ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0.5 }] }] };
  assert.deepEqual(freieZiele(mit), ['pan', 'mute', 'solo', 'geraet.lautstaerke', 'geraet.resonanz', 'geraet.env_mod']);
  assert.deepEqual(freieZiele({ ...audio, automation: ZIELE.slice(0, 4).map((z, i) => ({ id: `a${i}`, ziel: z, punkte: [] })) }), [], 'all four used: nothing left');
});

test('S2 T6 lanes.js: the shown lane is the chosen target, else the volume lane (slice 1), else the first lane', () => {
  const f = { id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }] }, p = { id: 'a2', ziel: 'pan', punkte: [{ beat: 0, wert: 0 }] };
  const s = { automation: [p, f] };
  assert.equal(gezeigteLane(s, 'pan').id, 'a2');
  assert.equal(gezeigteLane(s, undefined).id, 'a1', 'no choice: the volume lane, as in slice 1');
  assert.equal(gezeigteLane(s, 'mute').id, 'a1', 'a chosen target the track does not have: the volume lane');
  assert.equal(gezeigteLane({ automation: [p] }, undefined).id, 'a2');
  assert.equal(gezeigteLane({}, 'pan'), null);
  assert.equal(laneFuer(s, 'solo'), null);
});

test('S2 T6 negative control: a slice 1 project with only a fader lane looks and behaves as before', () => {
  const f = { id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: -12 }, { beat: 16, wert: -200 }] };
  const s = { art: 'audio', automation: [f] };
  assert.equal(gezeigteLane(s, undefined), f);
  assert.equal(gezeigteLane(s, 'fader'), f);
  const alt = lanePfad(f.punkte, zeile, (b) => b * 10, (x) => x / 10, 200, 'fader');
  const neu = lanePfad(f.punkte, zeile, (b) => b * 10, (x) => x / 10, 200, 'fader');
  assert.ok(neu.length > 50 && neu.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), 'a fader path is drawn');
  assert.equal(wertZuY(zeile, -30, 'fader'), zeile.y + 3 + (1 - posVonDb(-30)) * 42, 'the fader taper over the row (fader_curve.js)');
  assert.equal(yZuWert(zeile, 1000, 'fader'), -200, 'below the row clamps to off');
  assert.deepEqual(freieZiele(s), ['pan', 'mute', 'solo']);
});

// ---------------------------------------------------------------- Automation Slice 2, task 6, fix round 1

test('S2 T6 fix 3: lanePfad hands its target on to laneWert (a widened range shows plain interpolation for a non-fader target, the dB ramp for the fader)', () => {
  const alt = ZIEL_ANZEIGE['geraet.cutoff'];
  ZIEL_ANZEIGE['geraet.cutoff'] = { ...alt, min: -200, max: 6, anzeigeMin: -200 };   // spy: a range in which the dB rule would be visible
  try {
    const pk = [{ beat: 0, wert: -200 }, { beat: 10, wert: 0 }];
    const pfad = (ziel) => lanePfad(pk, zeile, (b) => b * 10, (x) => x / 10, 100, ziel);
    const mitte = (p) => p.find(([x]) => x === 50)[1];
    assert.ok(Math.abs(mitte(pfad('geraet.cutoff')) - wertZuY(zeile, -100, 'geraet.cutoff')) < 1e-9, 'device target: plain, -100 at the middle');
    ZIEL_ANZEIGE.fader = { ...ZIEL_ANZEIGE.fader, anzeigeMin: -200 };
    assert.ok(Math.abs(mitte(pfad('fader')) - wertZuY(zeile, -30, 'fader')) < 1e-9, 'fader: the dB rule ramps from -60, -30 at the middle');
  } finally { ZIEL_ANZEIGE['geraet.cutoff'] = alt; ZIEL_ANZEIGE.fader = { ...ZIEL_ANZEIGE.fader, anzeigeMin: -60 }; }
});

test('S2 T6 fix 3: the target is required, a forgotten one throws instead of silently applying the dB rule', () => {
  const pk = [{ beat: 0, wert: 0 }, { beat: 4, wert: -10 }];
  const bx = (b) => b * 10;
  assert.throws(() => laneWert(pk, 2), TypeError);
  assert.throws(() => wertZuY(zeile, 0), TypeError);
  assert.throws(() => yZuWert(zeile, 10), TypeError);
  assert.throws(() => lanePfad(pk, zeile, bx, (x) => x / 10, 100), TypeError);
  assert.throws(() => trefferPunkt(pk, zeile, bx, 0, 0), TypeError);
  assert.throws(() => ziehePunkt(pk, 0, 0, 0, 0), TypeError);
  assert.throws(() => setzePunkt(pk, 1, 0, 0), TypeError);
  assert.doesNotThrow(() => laneWert(pk, 2, 'fader'));
});

test('S2 T6 fix 4: an unknown target is not editable (dimmed like a locked lane) and gets a plain 0..1 frame instead of the fader range', () => {
  const fremd = { id: 'x1', ziel: 'geraet.zukunft', punkte: [{ beat: 0, wert: 0.5 }] };
  assert.equal(unbekanntesZiel(fremd), true);
  assert.equal(unbekanntesZiel({ ziel: 'pan' }), false);
  assert.equal(laneSchutz(fremd), 'unbekannt');
  assert.equal(laneSchutz({ ziel: 'pan', gesperrt: true }), 'gesperrt');
  assert.equal(laneSchutz({ ziel: 'pan' }), null);
  assert.equal(laneSchutz({ ziel: 'fader' }), null, 'negative control: a known unlocked lane is writable');
  assert.equal(bereich('geraet.zukunft').max, 1, 'not the fader range +6');
  assert.equal(bereich('geraet.zukunft').unbekannt, true);
  assert.equal(bereich('fader').unbekannt, undefined);
  assert.equal(wertZuY(zeile, 0.5, 'geraet.zukunft'), wertZuY(zeile, 0.5, 'geraet.cutoff'));
});
