// 1.12 automation slice 5 (plan docs/b1-plaene/PLAN-1.12-slices4-5-7.md, unit U6): clip envelopes in the model (D7), the pure evaluation hkWert,
// the commands huellkurve_setzen / huellkurve_loeschen and what the clip commands do with envelopes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt, kanonisch, MAX_AUTO_PUNKTE } from '../projekt/modell.ts';
import { wende } from '../projekt/patch.ts';
import { hkWert, HK_BEREICH, huellkurvenPruefung, teileHuellkurve } from '../projekt/huellkurve.ts';
import { GRUND_TEXT } from '../http/gruende.ts';
import { grundCode } from '../bereiche/proj/abbildung.ts';
import { ohneAbgeleitetes, SHA_A } from './hilfen/projekt.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 140)}`);
function pruefe(p, r) {
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(r.projekt))).fehler, undefined);
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt), 'redo equal');
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), 'undo equal');
}
// s1 audio with clip c1 (8 beats), s2 RB-338 with MIDI clip c2 (8 beats), s3 host (Surge) with MIDI clip c3
function basis() {
  let p = neuesProjekt('T');
  p = ok(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }).projekt;
  p = structuredClone(p);
  p.spuren[0].clips.push({ id: 'c1', art: 'audio', name: 'a', start_beat: 0, laenge_beats: 8, quelle: { sha256: SHA_A, pfad_hinweis: '/a.wav' },
    dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
  p.spuren[1].clips.push({ id: 'c2', art: 'midi', name: 'm', start_beat: 0, laenge_beats: 8, noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 40, vel: 100 }] });
  p.spuren[2].clips.push({ id: 'c3', art: 'midi', name: 'h', start_beat: 0, laenge_beats: 8, noten: [] });
  p.naechste_id.clip = 4;
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(p))).fehler, undefined);
  return p;
}
const clip = (p, id) => p.spuren.flatMap((s) => s.clips).find((c) => c.id === id);
const RAMPE = [{ beat: 0, wert: -12 }, { beat: 8, wert: 0 }];
const mitHk = (p, id, hk) => { const q = structuredClone(p); clip(q, id).huellkurven = hk; return q; };
const fehlerVon = (p) => pruefeProjekt(JSON.parse(JSON.stringify(p))).fehler;

// --- T6.1 ----------------------------------------------------------------------------------------------------------------
test('U6 T6.1 model: no key when absent (old files byte for byte), /1 refuses the field, targets per clip and track, ranges, loop_beats', () => {
  const p = basis();
  assert.equal(kanonisch(pruefeProjekt(JSON.parse(JSON.stringify(p))).projekt), kanonisch(p), 'round trip without envelopes');
  assert.ok(!JSON.stringify(p).includes('huellkurven'));
  assert.equal(fehlerVon(mitHk(p, 'c1', [{ ziel: 'gain', punkte: RAMPE }])), undefined, 'gain on audio');
  assert.equal(fehlerVon(mitHk(p, 'c2', [{ ziel: 'transpose', punkte: [{ beat: 0, wert: 7 }] }, { ziel: 'geraet.cutoff', verknuepft: false, loop_beats: 2, punkte: [{ beat: 0, wert: -0.5 }] }])), undefined);
  assert.equal(fehlerVon(mitHk(p, 'c3', [{ ziel: 'spur_fader', punkte: [{ beat: 0, wert: -6 }] }, { ziel: 'spur_pan', punkte: [{ beat: 0, wert: 2 }] }])), undefined);
  const schlecht = [
    ['c1', [{ ziel: 'gain', punkte: RAMPE }, { ziel: 'gain', punkte: RAMPE }], 'doppelt'],
    ['c2', [{ ziel: 'gain', punkte: RAMPE }], 'gain on MIDI'],
    ['c1', [{ ziel: 'transpose', punkte: [{ beat: 0, wert: 1 }] }], 'transpose on audio'],
    ['c3', [{ ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0 }] }], 'geraet on a host track'],
    ['c1', [{ ziel: 'gain', punkte: [{ beat: 0, wert: 1 }] }], 'gain above 0'],
    ['c1', [{ ziel: 'spur_fader', punkte: [{ beat: 0, wert: 7 }] }], 'spur_fader above +6'],
    ['c2', [{ ziel: 'transpose', punkte: [{ beat: 0, wert: 49 }] }], 'transpose above 48'],
    ['c1', [{ ziel: 'gain', verknuepft: false, loop_beats: 9, punkte: RAMPE }], 'loop_beats over the length'],
    ['c1', [{ ziel: 'gain', verknuepft: false, loop_beats: 1 / 32, punkte: RAMPE }], 'loop_beats below 1/16'],
    ['c1', [{ ziel: 'gain', loop_beats: 2, punkte: RAMPE }], 'loop_beats on a linked envelope'],
    ['c1', [{ ziel: 'gain', verknuepft: true, punkte: RAMPE }], 'verknuepft true is never written'],
    ['c1', [], 'empty list'],
    ['c1', [{ ziel: 'gain', punkte: [] }], 'no points'],
    ['c1', [{ ziel: 'wurst', punkte: RAMPE }], 'unknown target'],
  ];
  for (const [id, hk, was] of schlecht) assert.notEqual(fehlerVon(mitHk(p, id, hk)), undefined, was);
  const alt = mitHk(p, 'c1', [{ ziel: 'gain', punkte: RAMPE }]);
  alt.format = 'cypherdj-projekt/1';
  for (const k of ['gruppen', 'returns', 'master', 'baukasten']) delete alt[k];
  for (const s of alt.spuren) for (const k of ['automation', 'sends', 'takes', 'ausgang']) delete s[k];
  const ohne = structuredClone(alt); delete clip(ohne, 'c1').huellkurven;
  assert.equal(fehlerVon(ohne), undefined, 'the same /1 file without the field is valid (control)');
  assert.match(fehlerVon(alt) ?? '', /huellkurven/, '/1 refuses the field');
  // the pure check names the reasons the commands use
  assert.equal(huellkurvenPruefung([{ ziel: 'gain', punkte: [{ beat: 0, wert: 3 }] }], clip(p, 'c1'), p.spuren[0])?.grund, 'punkte_ungueltig');
  assert.equal(huellkurvenPruefung([{ ziel: 'transpose', punkte: RAMPE }], clip(p, 'c1'), p.spuren[0])?.grund, 'huellkurve_ziel');
  assert.deepEqual(HK_BEREICH('gain'), { min: -200, max: 0 });
  assert.deepEqual(HK_BEREICH('geraet.env_mod'), { min: -1, max: 1 });
});

// --- T6.2 ----------------------------------------------------------------------------------------------------------------
test('U6 T6.2 hkWert: linked repeats per clip loop; unlinked per its own loop_beats (AK19 server half); before/after the points', () => {
  const hk = { ziel: 'spur_pan', punkte: [{ beat: 0.5, wert: -1 }, { beat: 1.5, wert: 1 }] };
  assert.equal(hkWert(hk, 0), -1, 'before the first point: the first value');
  assert.equal(hkWert(hk, 7), 1, 'after the last point: the last value');
  assert.equal(hkWert(hk, 1), 0);
  assert.equal(hkWert(hk, 3, 2), 0, 'linked on a clip with loop 2: beat 3 reads beat 1');
  assert.equal(hkWert(hk, 3, null), 1, 'linked without a clip loop: no repetition');
  const frei = { ...hk, verknuepft: false, loop_beats: 2 };
  for (let i = 0; i < 10; i++) {
    const t = i * 0.77;
    assert.equal(hkWert(frei, t, 4), hkWert(hk, t % 2), `unlinked at ${t} ignores the clip loop`);
  }
  assert.equal(hkWert({ ziel: 'gain', punkte: [{ beat: 0, wert: -200 }, { beat: 4, wert: 0 }] }, 2), -30, 'gain uses the fader dB rule (ramp from off runs from -60)');
});

// --- T6.3 ----------------------------------------------------------------------------------------------------------------
test('U6 T6.3 huellkurve_setzen / huellkurve_loeschen: set, replace, delete, one undo step each; reasons', () => {
  const p = basis();
  const r1 = ok(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: RAMPE });
  pruefe(p, r1);
  assert.deepEqual(clip(r1.projekt, 'c1').huellkurven, [{ ziel: 'gain', punkte: RAMPE }]);
  const r2 = ok(r1.projekt, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [{ beat: 0, wert: -3 }], verknuepft: false, loop_beats: 4 });
  pruefe(r1.projekt, r2);
  assert.deepEqual(clip(r2.projekt, 'c1').huellkurven, [{ ziel: 'gain', verknuepft: false, loop_beats: 4, punkte: [{ beat: 0, wert: -3 }] }], 'replaced');
  const r3 = ok(r2.projekt, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_fader', punkte: [{ beat: 0, wert: -6 }], verknuepft: true });
  assert.deepEqual(clip(r3.projekt, 'c1').huellkurven.map((h) => [h.ziel, 'verknuepft' in h]), [['gain', true], ['spur_fader', false]], 'verknuepft true is not stored');
  const r4 = ok(r3.projekt, { befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'gain' });
  pruefe(r3.projekt, r4);
  const r5 = ok(r4.projekt, { befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'spur_fader' });
  assert.equal('huellkurven' in clip(r5.projekt, 'c1'), false, 'the last delete removes the key');
  assert.equal(kanonisch({ ...r5.projekt, rev: 0 }), kanonisch({ ...p, rev: 0 }), 'back to the start');
  lehntAb(p, { befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'gain' }, 'huellkurve_unbekannt');
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c9', ziel: 'gain', punkte: RAMPE }, 'clip_unbekannt');
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'gain', punkte: RAMPE }, 'huellkurve_ziel');
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0 }] }, 'huellkurve_ziel');
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'wurst', punkte: RAMPE }, 'huellkurve_ziel');
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [{ beat: 0, wert: 1 }] }, 'punkte_ungueltig');
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [] }, 'punkte_ungueltig');
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: RAMPE, verknuepft: false, loop_beats: 9 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: RAMPE, loop_beats: 2 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: RAMPE, extra: 1 }, 'argument_unbekannt');
  for (const g of ['huellkurve_ziel', 'geraet_huellkurven']) assert.equal(grundCode(g), 400, g);
  assert.equal(grundCode('huellkurve_unbekannt'), 404);
  for (const g of ['huellkurve_ziel', 'huellkurve_unbekannt', 'geraet_huellkurven']) assert.equal(typeof GRUND_TEXT[g], 'string', g);
});

// --- T6.4 ----------------------------------------------------------------------------------------------------------------
test('U6 T6.4 clip_teilen, linked: the right part gets the points shifted with a boundary point at 0, the left part a boundary at the cut', () => {
  const p = ok(basis(), { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [{ beat: 0, wert: -12 }, { beat: 2, wert: -6 }, { beat: 6, wert: 0 }] }).projekt;
  const r = ok(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: 3 });
  pruefe(p, r);
  const [links, rechts] = r.projekt.spuren[0].clips;
  assert.deepEqual(links.huellkurven[0].punkte, [{ beat: 0, wert: -12 }, { beat: 2, wert: -6 }, { beat: 3, wert: -4.5 }]);
  assert.deepEqual(rechts.huellkurven[0].punkte, [{ beat: 0, wert: -4.5 }, { beat: 3, wert: 0 }]);
  const hk = clip(p, 'c1').huellkurven[0];
  for (let t = 0; t < 5; t += 0.5) assert.equal(hkWert(rechts.huellkurven[0], t), hkWert(hk, t + 3), `right part at ${t}`);
  for (let t = 0; t < 3; t += 0.5) assert.equal(hkWert(links.huellkurven[0], t), hkWert(hk, t), `left part at ${t}`);
});

test('U6 T6.4 clip_teilen, unlinked: the right part is rotated by split mod L; a split on a multiple of L keeps the points', () => {
  const pk = [{ beat: 0, wert: -1 }, { beat: 0.5, wert: 0.6 }, { beat: 1.25, wert: 0.2, form: 's' }, { beat: 1.75, wert: -0.4 }];
  const p = ok(basis(), { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_pan', punkte: pk, verknuepft: false, loop_beats: 2 }).projekt;
  const hk = clip(p, 'c1').huellkurven[0];
  const r = ok(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: 3 });
  pruefe(p, r);
  const rechts = r.projekt.spuren[0].clips[1].huellkurven[0];
  assert.equal(rechts.loop_beats, 2); assert.equal(rechts.verknuepft, false);
  for (let i = 0; i < 10; i++) {
    const t = i * 0.5;
    assert.ok(Math.abs(hkWert(rechts, t) - hkWert(hk, t + 3)) < 1e-9, `rotated at ${t}: ${hkWert(rechts, t)} vs ${hkWert(hk, t + 3)}`);
  }
  assert.deepEqual(r.projekt.spuren[0].clips[0].huellkurven, [hk], 'the left part keeps its phase');
  const v = ok(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: 4 });
  assert.deepEqual(v.projekt.spuren[0].clips[1].huellkurven[0].punkte, pk, 'split at 4 (a multiple of L): unchanged (negative control)');
  assert.deepEqual(teileHuellkurve(hk, 4).rechts.punkte, pk);
});

test('U6 T6.4 clip_aendern: a shorter clip clamps the envelope loop; a move to a track that cannot take the target is refused', () => {
  const p = ok(basis(), { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: RAMPE, verknuepft: false, loop_beats: 4 }).projekt;
  const r = ok(p, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 3 });
  pruefe(p, r);
  assert.equal(clip(r.projekt, 'c1').huellkurven[0].loop_beats, 3);
  assert.deepEqual(clip(r.projekt, 'c1').huellkurven[0].punkte, RAMPE, 'the clip-local points are kept (silent beyond)');
  const m = ok(basis(), { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0.3 }] }).projekt;
  lehntAb(m, { befehl: 'clip_aendern', clip_id: 'c2', spur_id: 's3' }, 'huellkurve_ziel');
  const n = ok(basis(), { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'transpose', punkte: [{ beat: 0, wert: 3 }] }).projekt;
  assert.equal(clip(ok(n, { befehl: 'clip_aendern', clip_id: 'c2', spur_id: 's3' }).projekt, 'c2').huellkurven[0].ziel, 'transpose', 'transpose moves freely');
});

test('U6 T6.4 device switch with geraet.* envelopes is refused (geraet_huellkurven); without them it works; duplicate copies', () => {
  const ohneWirt = () => ok(basis(), { befehl: 'spur_loeschen', spur_id: 's3' }).projekt;   // D1 has one Surge slot: free it first
  const m = ok(ohneWirt(), { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0.3 }] }).projekt;
  lehntAb(m, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'wirt', name: 'surge' } }, 'geraet_huellkurven');
  const t = ok(ohneWirt(), { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'transpose', punkte: [{ beat: 0, wert: 3 }] }).projekt;
  assert.equal(ok(t, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'wirt', name: 'surge' } }).projekt.spuren[1].geraet.art, 'wirt', 'negative control');
  const d = ok(m, { befehl: 'clip_duplizieren', clip_id: 'c2' }).projekt;
  assert.deepEqual(d.spuren[1].clips.map((c) => c.huellkurven), [clip(m, 'c2').huellkurven, clip(m, 'c2').huellkurven]);
});

// --- T6.5 ----------------------------------------------------------------------------------------------------------------
test('U6 T6.5 envelope points count with the lane points against 65536 (zu_gross)', () => {
  let p = basis();
  p = ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }).projekt;
  const viele = (n, von) => Array.from({ length: n }, (_, i) => ({ beat: von + i, wert: 0 }));
  // 8 lanes of 8192 points: the audio track's fader and pan lanes and six lanes on the RB track (fader, pan, 4 device targets)
  let q = p;
  for (const ziel of ['fader', 'pan', 'geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod']) q = ok(q, { befehl: 'auto_neu', spur_id: 's2', ziel }).projekt;
  q = ok(q, { befehl: 'auto_neu', spur_id: 's1', ziel: 'pan' }).projekt;
  const lanen = q.spuren.flatMap((s) => s.automation ?? []);
  assert.equal(lanen.length, 8);
  const voll = fuehreListeAus(q, lanen.map((l) => ({ befehl: 'auto_punkte', lane_id: l.id, loesche_von: 0, loesche_bis: 1e5,
    setze: viele(MAX_AUTO_PUNKTE / 8 - (l.id === lanen[0].id ? 4 : 0), 0) }))).projekt;
  // 65532 lane points leave room for 4. The check counts the envelope as the translator rolls it out (review R4): the gain envelope
  // gets one boundary point at the clip end, so 3 stored points (4 rolled out) fit (negative control) and 4 stored points (5) do not.
  const drei = [0, 1, 2].map((b) => ({ beat: b, wert: -1 }));
  ok(voll, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: drei });
  lehntAb(voll, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [...drei, { beat: 3, wert: -1 }] }, 'zu_gross');
});
