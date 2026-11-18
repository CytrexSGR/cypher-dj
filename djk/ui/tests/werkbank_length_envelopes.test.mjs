// LENGTH grows a pattern: its linked envelopes (PITCH and knob step locks) are copied into the new bars, so the grown pattern sounds like the repeated original.
// A linked envelope repeats with the clip loop and holds the value of its last point, so without the copy bar 2 would play the last step lock everywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';
import { hkWert } from '../project/envelope.ts';

installiere();
const { laengeKlickBefehle } = await import('../public/werkbank/kopf.js');
const { pitchPunkte, knopfPunkte } = await import('../public/werkbank/grid.js');

const noten = Array.from({ length: 16 }, (_, s) => ({ id: `n${s}`, beat: s * 0.25, laenge: 0.25, ton: 36 + s, vel: 100 }));
const projekt = (clip) => ({ werkbank: { schema: 1 }, loop: { an: true, von_beat: 0, bis_beat: 4 }, spuren: [{ id: 's', art: 'instrument', clips: [clip] }] });
const clipMit = (huellkurven, extra = {}) => ({ id: 'c', art: 'midi', start_beat: 0, laenge_beats: 4, loop_beats: 4, noten: structuredClone(noten), huellkurven, ...extra });
// what the commands leave on the clip: its loop and its envelopes by target
function anwenden(clip, befehle) {
  let loop = clip.loop_beats;
  const hk = new Map((clip.huellkurven ?? []).map((h) => [h.ziel, h]));
  for (const b of befehle) {
    if (b.befehl === 'clip_aendern' && b.loop_beats !== undefined) loop = b.loop_beats;
    if (b.befehl === 'huellkurve_setzen') hk.set(b.ziel, { ziel: b.ziel, punkte: b.punkte, ...(b.verknuepft === false ? { verknuepft: false, loop_beats: b.loop_beats } : {}) });
  }
  return { loop, hk };
}
const gleichInJederWiederholung = (h, loop, P) => {
  for (let s = 0; s < P / 0.25; s++) {
    const erste = hkWert(h, s * 0.25, loop);
    for (let k = 1; k * P < loop; k++) assert.ok(Math.abs(erste - hkWert(h, s * 0.25 + k * P, loop)) < 1e-9, `step ${s}, copy ${k}: ${erste} against ${hkWert(h, s * 0.25 + k * P, loop)}`);
  }
};

test('LENGTH 1 -> 2 keeps a linked PITCH step lock sounding as bar 1 in bar 2', () => {
  const clip = clipMit([{ ziel: 'geraet.k3', punkte: pitchPunkte(new Map([[0, 5 / 24]]), 16) }]);   // +5 st on step 0 only
  const { befehle } = laengeKlickBefehle(projekt(clip), 2);
  const { loop, hk } = anwenden(clip, befehle);
  assert.equal(loop, 8);
  gleichInJederWiederholung(hk.get('geraet.k3'), loop, 4);
  assert.notEqual(hkWert(hk.get('geraet.k3'), 0, loop), hkWert(hk.get('geraet.k3'), 0.25, loop), 'the lock still sits on step 0 only');
  const i = befehle.findIndex((b) => b.befehl === 'huellkurve_setzen');
  assert.ok(i > befehle.findIndex((b) => b.befehl === 'clip_aendern'), 'the envelope is written after the clip got its new length');
  assert.equal(befehle[i].verknuepft, undefined, 'the envelope stays linked');
  assert.equal(befehle[i].loop_beats, undefined);
});

test('LENGTH 1 -> 8 copies a knob lane (no closing point) without a ramp from one copy into the next', () => {
  const clip = clipMit([{ ziel: 'geraet.k5', punkte: knopfPunkte(new Map([[1, 0.3], [2, 0.3], [5, -0.2]]), 16) }]);
  const { befehle } = laengeKlickBefehle(projekt(clip), 8);
  const { loop, hk } = anwenden(clip, befehle);
  assert.equal(loop, 32);
  gleichInJederWiederholung(hk.get('geraet.k5'), loop, 4);
  // just before the next copy the value of the last step still holds (a `sprung` at its start, no linear segment)
  assert.equal(hkWert(hk.get('geraet.k5'), 3.99, loop), hkWert(hk.get('geraet.k5'), 3.75, loop));
  assert.ok(hk.get('geraet.k5').punkte.every((q) => q.beat < 32));
});

test('LENGTH copies an envelope whose first point sits behind beat 0 and holds its first value before it', () => {
  const clip = clipMit([{ ziel: 'geraet.k2', punkte: [{ beat: 1, wert: 0.5 }, { beat: 3, wert: -0.5, form: 'sprung' }] }]);
  const { befehle } = laengeKlickBefehle(projekt(clip), 2);
  const { loop, hk } = anwenden(clip, befehle);
  gleichInJederWiederholung(hk.get('geraet.k2'), loop, 4);
});

test('LENGTH sends no envelope for a shortening, an unlinked envelope, one that has points in the new part, or one that would not fit', () => {
  const eigen = { ziel: 'geraet.k5', verknuepft: false, loop_beats: 2, punkte: [{ beat: 0, wert: 0.2 }, { beat: 1, wert: 0.4, form: 'sprung' }] };
  const lang = { ziel: 'geraet.k6', punkte: [{ beat: 0, wert: 0.2 }, { beat: 5, wert: 0.4, form: 'sprung' }] };
  const viele = { ziel: 'geraet.k7', punkte: Array.from({ length: 1000 }, (_, i) => ({ beat: i * 0.004, wert: (i % 2) * 0.1 })) };
  const setzen = (r) => r.befehle.filter((b) => b.befehl === 'huellkurve_setzen');
  assert.deepEqual(setzen(laengeKlickBefehle(projekt(clipMit([eigen, lang])), 2)), [], 'unlinked and already-long envelopes stay');
  assert.deepEqual(setzen(laengeKlickBefehle(projekt(clipMit([viele])), 64)), [], 'the copy would pass the 8192 points of an envelope');
  assert.equal(setzen(laengeKlickBefehle(projekt(clipMit([viele])), 4)).length, 1, 'a copy that fits is written');
  const kurz = clipMit([{ ziel: 'geraet.k3', punkte: pitchPunkte(new Map([[0, 0.2]]), 16) }], { laenge_beats: 8, loop_beats: 8 });
  assert.deepEqual(setzen(laengeKlickBefehle(projekt(kurz), 1)), [], 'shortening sends nothing');
  assert.deepEqual(setzen(laengeKlickBefehle(projekt(clipMit([])), 2)), [], 'no envelope, no command');
});

// An envelope that closes at the old loop end (SEQ shapes sinus, dreieck, saege, saege_ab, rampe, or a drawn one) is copied as well: the closing point stays the end
// of bar 1, every copy starts at k * P (two points at that beat, the model allows two) and ends with its own closing point.
const { formPunkte } = await import('../public/seq_logic.js');
const { hkPunktePruefung } = await import('../project/envelope.ts');
const proBeat = (punkte) => { const n = new Map(); for (const q of punkte) n.set(q.beat, (n.get(q.beat) ?? 0) + 1); return Math.max(...n.values()); };
const gleichInJederWiederholungFein = (h, loop, P) => {
  for (let b = 0; b < P - 1e-9; b += 0.125) for (let k = 1; k * P < loop - 1e-9; k++) {
    assert.ok(Math.abs(hkWert(h, b, loop) - hkWert(h, b + k * P, loop)) < 1e-9, `beat ${b}, copy ${k}: ${hkWert(h, b, loop)} against ${hkWert(h, b + k * P, loop)}`);
  }
};

for (const art of ['sinus', 'dreieck', 'saege', 'saege_ab', 'rampe']) {
  test(`LENGTH 1 -> 2 and 1 -> 4 repeat a shaped ${art} lane that closes at the loop end`, () => {
    for (const takte of [2, 4]) {
      const clip = clipMit([{ ziel: 'geraet.k3', punkte: formPunkte({ art, von: 0.1, bis: 0.9 }, 4).map((q) => ({ ...q, wert: q.wert })) }]);
      const { befehle } = laengeKlickBefehle(projekt(clip), takte);
      const { loop, hk } = anwenden(clip, befehle);
      assert.equal(loop, takte * 4);
      const h = hk.get('geraet.k3');
      gleichInJederWiederholungFein(h, loop, 4);
      assert.equal(hkPunktePruefung(h.punkte, 'geraet.k3'), null, 'the model takes the points');
      assert.ok(proBeat(h.punkte) <= 2);
      assert.deepEqual(h.punkte.slice(0, clip.huellkurven[0].punkte.length), clip.huellkurven[0].punkte, 'bar 1 keeps its points');
    }
  });
}

test('LENGTH: the sine of bar 1 sounds in bar 2 (the value halfway up and the way back down)', () => {
  const clip = clipMit([{ ziel: 'geraet.k3', punkte: formPunkte({ art: 'sinus', von: 0.1, bis: 0.9 }, 4) }]);
  const { loop, hk } = anwenden(clip, laengeKlickBefehle(projekt(clip), 2).befehle);
  const h = hk.get('geraet.k3');
  assert.ok(Math.abs(hkWert(h, 5, loop) - 0.5) < 1e-9);
  assert.ok(Math.abs(hkWert(h, 6, loop) - 0.9) < 1e-9);
  assert.ok(Math.abs(hkWert(h, 7.9, loop) - hkWert(h, 3.9, loop)) < 1e-9);
});

test('LENGTH leaves a closed envelope out when the copy would put three points on one beat', () => {
  const paar = [{ beat: 0, wert: 0.2 }, { beat: 0, wert: 0.6, form: 'sprung' }, { beat: 2, wert: 0.4 }, { beat: 4, wert: 0.2 }];
  const zwei = [{ beat: 0, wert: 0.2 }, { beat: 2, wert: 0.4 }, { beat: 4, wert: 0.2 }, { beat: 4, wert: 0.7, form: 'sprung' }];
  const setzen = (r) => r.befehle.filter((b) => b.befehl === 'huellkurve_setzen');
  assert.deepEqual(setzen(laengeKlickBefehle(projekt(clipMit([{ ziel: 'geraet.k3', punkte: paar }])), 2)), [], 'a jump pair at beat 0 plus a closing point');
  assert.deepEqual(setzen(laengeKlickBefehle(projekt(clipMit([{ ziel: 'geraet.k3', punkte: zwei }])), 2)), [], 'a jump pair at the loop end plus the next copy start');
});

test('LENGTH still writes a jump pair at beat 0 when the envelope has no closing point', () => {
  const paar = [{ beat: 0, wert: 0.2 }, { beat: 0, wert: 0.6, form: 'sprung' }, { beat: 2, wert: 0.4 }];
  const clip = clipMit([{ ziel: 'geraet.k3', punkte: paar }]);
  const { loop, hk } = anwenden(clip, laengeKlickBefehle(projekt(clip), 2).befehle);
  assert.equal(hkPunktePruefung(hk.get('geraet.k3').punkte, 'geraet.k3'), null);
  gleichInJederWiederholungFein(hk.get('geraet.k3'), loop, 4);
});
