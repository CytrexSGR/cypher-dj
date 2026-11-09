// 1.12 automation slice 5 (plan docs/b1-plaene/PLAN-1.12-slices4-5-7.md, unit U7): the translation of clip envelopes into the playback file:
// gain_hk per loop copy, transpose resolved on the server, modulation envelopes merged into one relative lane per track and target (D9), the playback
// view (D14), freeze and isolation, limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uebersetze, WiedergabeFehler } from '../project/playback.ts';
import { fuehreAus, vergleiche } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, wiedergabeSicht, spurSicht, MAX_AUTO_PUNKTE } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { laneWert } from '../project/lane.ts';
import { hkWert } from '../project/envelope.ts';
import { ohneFremdeLanen } from '../areas/proj/output.ts';
import { SHA_A } from './support/project.mjs';

const opt = { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: (sha) => (sha === SHA_A ? 48000 * 600 : null) };
const ok = (p, b) => fuehreAus(p, b).projekt;
const FORM = ['linear', 's', 'sprung'];
const alsPunkte = (tripel) => tripel.map(([beat, wert, f]) => ({ beat, wert, form: FORM[f] }));
const audio = (id, start, laenge, extra = {}) => ({ id, art: 'audio', name: id, start_beat: start, laenge_beats: laenge, quelle: { sha256: SHA_A, pfad_hinweis: '/a.wav' },
  dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, ...extra });
// s1 audio, s2 RB-338, s3 host (Surge)
function basis() {
  let p = neuesProjekt('T');
  p = ok(p, { befehl: 'spur_neu', art: 'audio', name: 'A' });
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } });
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } });
  return structuredClone(p);
}
const gueltig = (p) => { const r = pruefeProjekt(JSON.parse(JSON.stringify(p))); assert.equal(r.fehler, undefined); return r.projekt; };

// --- T7.0 ----------------------------------------------------------------------------------------------------------------
test('U7 T7.0 playback view (D14): setting, deleting and undoing an envelope changes the playback for every target kind', () => {
  const p = basis();
  p.spuren[0].clips.push(audio('c1', 0, 8));
  p.spuren[1].clips.push({ id: 'c2', art: 'midi', name: 'm', start_beat: 0, laenge_beats: 8, noten: [] });
  p.naechste_id.clip = 3;
  const q = gueltig(p);
  for (const [clip, ziel, wert] of [['c1', 'gain', -6], ['c2', 'transpose', 7], ['c1', 'spur_fader', -6], ['c2', 'geraet.cutoff', 0.3]]) {
    const r = fuehreAus(q, { befehl: 'huellkurve_setzen', clip_id: clip, ziel, punkte: [{ beat: 0, wert }] });
    assert.equal(r.betrifft_wiedergabe, true, `set ${ziel}`);
    assert.equal(vergleiche(r.projekt, wende(r.projekt, r.zurueck)).betrifft_wiedergabe, true, `undo of set ${ziel}`);
    const d = fuehreAus(r.projekt, { befehl: 'huellkurve_loeschen', clip_id: clip, ziel });
    assert.equal(d.betrifft_wiedergabe, true, `delete ${ziel}`);
  }
  // without envelopes the view has exactly the keys it had before slice 5
  const sicht = JSON.parse(JSON.stringify(wiedergabeSicht(q)));
  assert.deepEqual(Object.keys(sicht.spuren[0]).sort(), ['art', 'clips', 'freeze', 'geraet', 'nr']);
  assert.deepEqual(Object.keys(sicht.spuren[0].clips[0]).sort(), ['art', 'dekodiert', 'fade_aus_beats', 'fade_ein_beats', 'gain_db', 'id', 'laenge_beats', 'loop_beats',
    'offset_s', 'sha256', 'start_beat', 'warp']);
  assert.deepEqual(Object.keys(sicht.spuren[1].clips[0]).sort(), ['art', 'id', 'laenge_beats', 'loop_beats', 'noten', 'start_beat']);
  assert.ok(!JSON.stringify(sicht).includes('huellkurven') && !JSON.stringify(sicht).includes('transpose'));
});

// --- T7.1 ----------------------------------------------------------------------------------------------------------------
test('U7 T7.1 gain_hk (AK18): a linked envelope on a looped clip gives every loop copy the same table; no envelope, the same file', () => {
  const p = basis();
  p.spuren[0].clips.push(audio('c1', 0, 16, { loop_beats: 4 }));
  p.naechste_id.clip = 2;
  const ohne = gueltig(p);
  const vorher = JSON.stringify(uebersetze(ohne, opt));
  assert.ok(!vorher.includes('gain_hk'));
  const q = ok(ohne, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [{ beat: 0, wert: -12 }, { beat: 4, wert: 0 }] });
  const w = uebersetze(q, opt);
  assert.equal(w.format, 'cypherdj-arr/2', 'gain_hk only in /2');
  assert.deepEqual(w.spuren[0].clips.map((c) => [c.id, c.gain_hk]), [0, 1, 2, 3].map((k) => [`c1~${k}`, [[0, -12, 0], [4, 0, 0]]]));
  // negative control: the envelope deleted again gives the file of before, byte for byte
  assert.equal(JSON.stringify(uebersetze(ok(q, { befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'gain' }), opt)), vorher);
});

test('U7 T7.1 gain_hk: an unlinked envelope is rolled out with its own loop (jump pairs at every multiple of L); the table plays hkWert', () => {
  const p = basis();
  p.spuren[0].clips.push(audio('c1', 2, 8));
  p.naechste_id.clip = 2;
  const pk = [{ beat: 0, wert: -12 }, { beat: 1, wert: 0 }, { beat: 1.5, wert: -3, form: 's' }];
  const q = ok(gueltig(p), { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: pk, verknuepft: false, loop_beats: 2 });
  const tab = uebersetze(q, opt).spuren[0].clips[0].gain_hk;
  const hk = q.spuren[0].clips[0].huellkurven[0];
  for (let i = 0; i < 64; i++) {
    const t = i * 0.125;
    assert.ok(Math.abs(laneWert(alsPunkte(tab), t, 'fader') - hkWert(hk, t)) < 1e-9, `copy beat ${t}`);
  }
  const paare = tab.filter((x, i) => i > 0 && tab[i - 1][0] === x[0]);
  assert.deepEqual(paare.map((x) => x[0]), [2, 4, 6], 'a jump pair at every multiple of L inside the clip');
});

// --- T7.2 ----------------------------------------------------------------------------------------------------------------
test('U7 T7.2 transpose (AK20 server half): notes from beat 8 sound 7 higher; the stored notes stay; clamped to 0..127', () => {
  const p = basis();
  p.spuren[1].clips.push({ id: 'c2', art: 'midi', name: 'm', start_beat: 4, laenge_beats: 16,
    noten: [0, 4, 8, 12].map((b, i) => ({ id: `n${i + 1}`, beat: b, laenge: 4, ton: i === 3 ? 125 : 40, vel: 100 })) });
  p.naechste_id.clip = 3;
  const q = ok(gueltig(p), { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'transpose', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 0 }, { beat: 8, wert: 7, form: 'sprung' }] });
  const w = uebersetze(q, opt);
  assert.deepEqual(w.spuren[1].noten.map((n) => [n.id, n.beat, n.ton]), [['c2/n1', 4, 40], ['c2/n2', 8, 40], ['c2/n3', 12, 47], ['c2/n4', 16, 127]]);
  assert.deepEqual(q.spuren[1].clips[0].noten.map((n) => n.ton), [40, 40, 40, 125], 'the stored notes are unchanged');
  const halb = ok(q, { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'transpose', punkte: [{ beat: 0, wert: 0 }, { beat: 16, wert: 4 }] });
  assert.deepEqual(uebersetze(halb, opt).spuren[1].noten.map((n) => n.ton), [40, 41, 42, 127], 'rounded at the note start (beats 0, 4, 8: 0, 1, 2)');
});

// --- T7.3 ----------------------------------------------------------------------------------------------------------------
test('U7 T7.3 modulation: the envelopes of a track merge into one relative lane (0 outside the clips, jumps at the edges) next to the absolute lane', () => {
  const p = basis();
  p.spuren[0].clips.push(audio('c1', 0, 4), audio('c2', 8, 4));
  p.naechste_id.clip = 3;
  let q = ok(gueltig(p), { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 16, wert: -30 }] });
  q = ok(q, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_fader', punkte: [{ beat: 0, wert: -6 }] });
  q = ok(q, { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'spur_fader', punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: -12 }] });
  const w = uebersetze(q, opt);
  const auto = w.spuren[0].auto;
  assert.deepEqual(auto.map((l) => [l.ziel, l.relativ ?? false]), [['fader', false], ['fader', true]]);
  const rel = alsPunkte(auto[1].punkte);
  const soll = (t) => (t >= 0 && t < 4 ? -6 : t >= 8 && t < 12 ? -3 * (t - 8) : 0);
  for (let t = -1; t < 16; t += 0.25) assert.ok(Math.abs(laneWert(rel, t, 'pan') - soll(t)) < 1e-9, `relative value at ${t}: ${laneWert(rel, t, 'pan')}`);
  for (let i = 2; i < rel.length; i++) assert.ok(!(rel[i].beat === rel[i - 1].beat && rel[i].beat === rel[i - 2].beat), 'at most two points per beat');
  // a track with only modulation (no absolute lane) still gets /2
  const nur = ok(basis(), { befehl: 'spur_neu', art: 'audio', name: 'B' });
  nur.spuren[3].clips.push(audio('c7', 0, 4)); nur.naechste_id.clip = 8;
  const m = ok(gueltig(nur), { befehl: 'huellkurve_setzen', clip_id: 'c7', ziel: 'spur_pan', punkte: [{ beat: 0, wert: 0.5 }] });
  const wm = uebersetze(m, opt);
  assert.equal(wm.format, 'cypherdj-arr/2');
  assert.deepEqual(wm.spuren[3].auto, [{ ziel: 'pan', punkte: [[0, 0, 0], [0, 0.5, 2], [4, 0.5, 0], [4, 0, 2]], relativ: true }]);
  // a device modulation on an RB-338 MIDI clip becomes a relative device lane
  const r = basis();
  r.spuren[1].clips.push({ id: 'c2', art: 'midi', name: 'm', start_beat: 0, laenge_beats: 4, noten: [] }); r.naechste_id.clip = 3;
  const rw = uebersetze(ok(gueltig(r), { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: -0.25 }] }), opt);
  assert.deepEqual(rw.spuren[1].auto.map((l) => [l.ziel, l.relativ]), [['geraet.cutoff', true]]);
});

// --- T7.4 ----------------------------------------------------------------------------------------------------------------
test('U7 T7.4 freeze: a transpose change on a frozen host track drops the freeze, a spur_fader modulation change keeps it', () => {
  const p = basis();
  p.spuren[2].clips.push({ id: 'c3', art: 'midi', name: 'h', start_beat: 0, laenge_beats: 8, noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 50, vel: 90 }] });
  p.naechste_id.clip = 4;
  p.spuren[2].freeze = { datei: 'freeze/s3-1.f32', frames: 48000, kennung: 1, sha256: SHA_A };
  const q = gueltig(p);
  assert.equal(ok(q, { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: 'transpose', punkte: [{ beat: 0, wert: 2 }] }).spuren[2].freeze, null, 'transpose: freeze dropped');
  assert.deepEqual(ok(q, { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: 'spur_fader', punkte: [{ beat: 0, wert: -3 }] }).spuren[2].freeze, q.spuren[2].freeze,
    'spur_fader: freeze kept (AK10 analogue)');
  assert.equal(JSON.stringify(spurSicht(q.spuren[2], false)), JSON.stringify(spurSicht(ok(q, { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: 'spur_fader',
    punkte: [{ beat: 0, wert: -3 }] }).spuren[2], false)), 'the freeze view does not see the modulation');
});

test('U7 T7.4 isolation: the single render of a track drops the other tracks\' modulation envelopes, also when no other track has a lane', () => {
  const p = basis();
  p.spuren[0].clips.push(audio('c1', 0, 4));
  p.spuren[1].clips.push({ id: 'c2', art: 'midi', name: 'm', start_beat: 0, laenge_beats: 4, noten: [] });
  p.naechste_id.clip = 3;
  let q = ok(gueltig(p), { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'spur_fader', punkte: [{ beat: 0, wert: -6 }] });
  q = ok(q, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_pan', punkte: [{ beat: 0, wert: 1 }] });
  const iso = ohneFremdeLanen(q, q.spuren[0]);
  assert.notEqual(iso, null, 'another track has a modulation envelope: an own playback is needed');
  const w = uebersetze(iso, opt);
  assert.equal(w.spuren[1].auto, undefined, 'no relative lane of the other track');
  assert.deepEqual(w.spuren[0].auto.map((l) => [l.ziel, l.relativ]), [['pan', true]], 'the own one stays');
  assert.equal(q.spuren[1].clips[0].huellkurven.length, 1, 'the input is untouched');
  const g = ok(gueltig(p), { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [{ beat: 0, wert: -6 }] });
  assert.equal(ohneFremdeLanen(g, g.spuren[1]), null, 'a gain envelope is not a lane: no own playback (negative control)');
});

// --- T7.5 ----------------------------------------------------------------------------------------------------------------
test('U7 T7.5 limits: rolled-out gain_hk points and relative lanes count against MAX_AUTO_PUNKTE (zu_gross)', () => {
  for (const ziel of ['gain', 'spur_fader']) {
    const p = basis();
    p.spuren[0].clips.push(audio('c1', 0, 4096, { huellkurven: [{ ziel, verknuepft: false, loop_beats: 1 / 16, punkte: [{ beat: 0, wert: -1 }, { beat: 0.03, wert: -2 }] }] }));
    p.naechste_id.clip = 2;
    assert.throws(() => uebersetze(p, opt), (e) => e instanceof WiedergabeFehler && e.grund === 'zu_gross', ziel);
    p.spuren[0].clips[0].laenge_beats = 64;      // 1024 periods: fits (negative control)
    assert.doesNotThrow(() => uebersetze(p, opt), ziel);
  }
  assert.ok(MAX_AUTO_PUNKTE === 65536);
});
