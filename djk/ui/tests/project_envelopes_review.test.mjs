// 1.12 slice 5, independent review (docs/b1-plaene/BERICHT-claude-pkg-1-12-review-c04bf2.md): defects found in the envelope commands and the
// playback translation, one test per finding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uebersetze } from '../project/playback.ts';
import { fuehreAus } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { hkWert } from '../project/envelope.ts';
import { SHA_A } from './support/project.mjs';

const opt = { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: (sha) => (sha === SHA_A ? 48000 * 600 : null) };
const ok = (p, b) => fuehreAus(p, b).projekt;
const audio = (id, start, laenge, extra = {}) => ({ id, art: 'audio', name: id, start_beat: start, laenge_beats: laenge,
  quelle: { sha256: SHA_A, pfad_hinweis: '/a.wav' }, dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, ...extra });
function mitClips(...clips) {
  let p = neuesProjekt('T');
  p = structuredClone(ok(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }));
  p.spuren[0].clips.push(...clips);
  p.naechste_id.clip = clips.length + 1;
  const r = pruefeProjekt(JSON.parse(JSON.stringify(p)));
  assert.equal(r.fehler, undefined);
  return r.projekt;
}

// R1: clip_teilen kept an unlinked envelope's loop_beats although a part became shorter than it; the end check then refused the whole split
test('review R1: clip_teilen of a clip whose unlinked envelope loop is longer than a part works and keeps the sound of both parts', () => {
  const p = ok(mitClips(audio('c1', 0, 8)), { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', verknuepft: false, loop_beats: 4,
    punkte: [{ beat: 0, wert: -12 }, { beat: 4, wert: 0 }] });
  const alt = p.spuren[0].clips[0].huellkurven[0];
  for (const schnitt of [2, 6]) {
    const [links, rechts] = ok(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: schnitt }).spuren[0].clips;
    for (const c of [links, rechts]) assert.ok(c.huellkurven[0].loop_beats <= c.laenge_beats, `split ${schnitt}: loop within ${c.id}`);
    for (let i = 0; i < 20; i++) {
      const t = (i / 20) * 8;
      const [c, rel] = t < schnitt ? [links, t] : [rechts, t - schnitt];
      assert.ok(Math.abs(hkWert(c.huellkurven[0], rel) - hkWert(alt, t)) < 1e-9, `split ${schnitt}, song beat ${t}`);
    }
  }
});
test('review R1 negative control: a split where the loop fits both parts keeps loop_beats unchanged', () => {
  const p = ok(mitClips(audio('c1', 0, 8)), { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', verknuepft: false, loop_beats: 2,
    punkte: [{ beat: 0, wert: -12 }, { beat: 2, wert: 0 }] });
  const teile = ok(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: 3 }).spuren[0].clips;
  assert.deepEqual(teile.map((c) => c.huellkurven[0].loop_beats), [2, 2]);
});

// R2: relativeLanen assumed clips on a track never overlap (D9); the model allows overlap, and the merged lane then had falling beats, which the core
// refuses for the whole playback (arr_playback.cpp "beats fall"). Rule now: the clip that starts later takes the modulation over from its start.
const steigt = (l) => l.punkte.every((q, i) => i === 0 || q[0] >= l.punkte[i - 1][0]);
test('review R2: modulation envelopes of overlapping clips give a relative lane with rising beats; the later clip takes over at its start', () => {
  let p = mitClips(audio('c1', 0, 8), audio('c2', 4, 8));
  p = ok(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_fader', punkte: [{ beat: 0, wert: -6 }] });
  p = ok(p, { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'spur_fader', punkte: [{ beat: 0, wert: -3 }] });
  const [lane] = uebersetze(p, opt).spuren[0].auto;
  assert.ok(steigt(lane), JSON.stringify(lane.punkte));
  assert.deepEqual(lane.punkte, [[0, 0, 0], [0, -6, 2], [4, -6, 0], [4, -3, 2], [12, -3, 0], [12, 0, 2]]);
});
test('review R2 negative control: adjacent clips (no overlap) keep their lane as before', () => {
  let p = mitClips(audio('c1', 0, 4), audio('c2', 4, 4));
  p = ok(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_fader', punkte: [{ beat: 0, wert: -6 }] });
  p = ok(p, { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'spur_fader', punkte: [{ beat: 0, wert: -3 }] });
  assert.deepEqual(uebersetze(p, opt).spuren[0].auto[0].punkte, [[0, 0, 0], [0, -6, 2], [4, -6, 0], [4, -3, 2], [8, -3, 0], [8, 0, 2]]);
});

// R3: the merged relative lane of a track is one lane in the core, which refuses more than 8192 points per lane (ARR_AUTO_LANE_PUNKTE_MAX) for the
// whole playback; the command check only counted against the 65536 total, so a looped clip with a dense modulation envelope was accepted.
test('review R3: a modulation envelope whose rolled-out relative lane exceeds 8192 points is refused with zu_gross', () => {
  const p = mitClips(audio('c1', 0, 100, { loop_beats: 1 }));
  const punkte = Array.from({ length: 100 }, (_, i) => ({ beat: i / 100, wert: -(i % 7) }));
  assert.throws(() => fuehreAus(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_fader', punkte }), (e) => e.grund === 'zu_gross');
});
test('review R3 negative control: the same envelope on a shorter looped clip (below 8192 lane points) is accepted and plays', () => {
  const p = mitClips(audio('c1', 0, 50, { loop_beats: 1 }));
  const punkte = Array.from({ length: 100 }, (_, i) => ({ beat: i / 100, wert: -(i % 7) }));
  const q = ok(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_fader', punkte });
  assert.ok(uebersetze(q, opt).spuren[0].auto[0].punkte.length <= 8192);
});

// R4: pruefeGrenzen counted an envelope as (points x repetitions); the roll-out (hkStrecke) adds a start and an end point per period piece, so a
// command was accepted whose playback the translator then refused with zu_gross (the change is stored, the core keeps playing the old file)
test('review R4: a command whose rolled-out envelope points exceed MAX_AUTO_PUNKTE is refused, so an accepted project always translates', () => {
  for (const ziel of ['gain', 'spur_fader']) {
    const p = mitClips(audio('c1', 0, 1500));
    const b = { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel, verknuepft: false, loop_beats: 1 / 16, punkte: [{ beat: 0, wert: -1 }, { beat: 0.03, wert: -2 }] };
    let q;
    try { q = fuehreAus(p, b).projekt; } catch (e) { assert.equal(e.grund, 'zu_gross', ziel); continue; }
    assert.doesNotThrow(() => uebersetze(q, opt), `${ziel}: accepted, so it must translate`);
  }
});
test('review R4 negative control: the same envelope over 64 beats is accepted and translates', () => {
  for (const ziel of ['gain', 'spur_fader']) {
    const p = mitClips(audio('c1', 0, 64));
    const q = ok(p, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel, verknuepft: false, loop_beats: 1 / 16, punkte: [{ beat: 0, wert: -1 }, { beat: 0.03, wert: -2 }] });
    assert.doesNotThrow(() => uebersetze(q, opt));
  }
});
