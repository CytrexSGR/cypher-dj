// 1.8 S4b.2 (D6, D18, AK19, AK20): the punch is cut in the server. The core records the whole pass; the take clip that is placed holds only [von, bis) of it, the
// catalog clip around it is untouched except for the short seam fades (96 samples) on the edges where the two clips touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nehmeTakeAuf, PUNCH_FADE_SAMPLES } from '../project/recording.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';

const SHA = 'a'.repeat(64), ALT = 'b'.repeat(64);
const BPM = 120;   // a beat is 0.5 s = 24000 frames
const FADE = (96 / 48000) * (BPM / 60);   // 96 samples in beats (a literal: the test must not follow the constant it checks)
function projekt(clips) {
  let p = neuesProjekt('P');
  p = fuehreListeAus(p, [{ befehl: 'tempo_setzen', bpm: BPM }, { befehl: 'spur_neu', art: 'audio', name: 'Gitarre' }]).projekt;
  const sid = p.spuren[0].id;
  p = fuehreListeAus(p, clips.map(([von, laenge]) => ({ befehl: 'clip_neu', spur_id: sid, art: 'audio', start_beat: von, laenge_beats: laenge, sha256: ALT, name: 'alt' }))).projekt;
  return { p, sid };
}
const nehme = (p, sid, extra = {}, von = 0, laenge = 16) =>
  nehmeTakeAuf(p, { spurId: sid, startBeat: von, laengeBeats: laenge, sha256: SHA, pfadHinweis: '/x/take.wav', name: 'Take 1', ...extra });
const haupt = (p) => [...p.spuren[0].clips].sort((a, b) => a.start_beat - b.start_beat);
const nah = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

test('PUNCH_FADE_SAMPLES is 96 (AK20, ARR_NAHT)', () => assert.equal(PUNCH_FADE_SAMPLES, 96));

test('AK19: catalog clip [0,16), take [0,16), punch [4,8): catalog [0,4), take [4,8) with the offset 4 beats into the take, catalog [8,16); the outer sources are unchanged', () => {
  const { p, sid } = projekt([[0, 16]]);
  const n = nehme(p, sid, { versatzSamples: 120, punch: { von_beat: 4, bis_beat: 8 } });
  const c = haupt(n);
  assert.deepEqual(c.map((x) => [x.start_beat, x.laenge_beats, x.quelle.sha256[0]]), [[0, 4, 'b'], [4, 4, 'a'], [8, 8, 'b']]);
  assert.ok(nah(c[1].offset_s, 120 / 48000 + 4 * 60 / BPM, 1e-9), `take offset: 4 beats in seconds plus the latency offset (${c[1].offset_s})`);
  assert.ok(nah(c[0].offset_s, 0) && nah(c[2].offset_s, 8 * 60 / BPM), 'the catalog parts keep their material position');
  assert.equal(c[0].quelle.sha256, ALT); assert.equal(c[2].quelle.sha256, ALT);
});

test('AK20: 96-sample fades at 4 and 8 on both touching edges; none on the outer edges', () => {
  const { p, sid } = projekt([[0, 16]]);
  const c = haupt(nehme(p, sid, { punch: { von_beat: 4, bis_beat: 8 } }));
  assert.ok(nah(c[0].fade_aus_beats, FADE) && nah(c[1].fade_ein_beats, FADE), 'seam at 4 on both sides');
  assert.ok(nah(c[1].fade_aus_beats, FADE) && nah(c[2].fade_ein_beats, FADE), 'seam at 8 on both sides');
  assert.equal(c[0].fade_ein_beats, 0); assert.equal(c[2].fade_aus_beats, 0);
  const lane = n2lane(nehme(p, sid, { punch: { von_beat: 4, bis_beat: 8 } }));
  assert.ok(nah(lane.fade_ein_beats, FADE) && nah(lane.fade_aus_beats, FADE), 'the take lane carries the same clip');
});
const n2lane = (n) => n.spuren[0].takes.filter((t) => t.art === undefined).at(-1).clips[0];

test('AK20: no fade at an edge to silence (the catalog clip ends inside the range)', () => {
  const { p, sid } = projekt([[0, 6]]);
  const c = haupt(nehme(p, sid, { punch: { von_beat: 4, bis_beat: 8 } }));
  assert.deepEqual(c.map((x) => [x.start_beat, x.laenge_beats]), [[0, 4], [4, 4]]);
  assert.ok(nah(c[0].fade_aus_beats, FADE) && nah(c[1].fade_ein_beats, FADE), 'seam at 4');
  assert.equal(c[1].fade_aus_beats, 0, 'at 8 the take meets silence: no fade');
});

test('AK20: the fade is capped at half the shorter neighbour', () => {
  const { p, sid } = projekt([[0, 16]]);
  const c = haupt(nehme(p, sid, { punch: { von_beat: 4, bis_beat: 4.001 } }));   // a take clip of 0.001 beats (0.5 ms)
  assert.ok(nah(c[1].fade_ein_beats, 0.0005, 1e-7) || c[1].fade_ein_beats <= 0.0005 + 1e-7, `capped at half of the take clip: ${c[1].fade_ein_beats}`);
  assert.ok(c[1].fade_ein_beats + c[1].fade_aus_beats <= c[1].laenge_beats + 1e-9);
});

test('punch-in only ([von, take end)) and punch-out only ([take start, bis)): one seam each', () => {
  const { p, sid } = projekt([[0, 16]]);
  const ein = haupt(nehme(p, sid, { punch: { von_beat: 4, bis_beat: 16 } }));
  assert.deepEqual(ein.map((x) => [x.start_beat, x.laenge_beats, x.quelle.sha256[0]]), [[0, 4, 'b'], [4, 12, 'a']]);
  assert.ok(nah(ein[0].fade_aus_beats, FADE) && nah(ein[1].fade_ein_beats, FADE), 'seam at the punch-in');
  assert.equal(ein[1].fade_aus_beats, 0, 'the take end is no cut');
  const aus = haupt(nehme(p, sid, { punch: { von_beat: 0, bis_beat: 8 } }));
  assert.deepEqual(aus.map((x) => [x.start_beat, x.laenge_beats, x.quelle.sha256[0]]), [[0, 8, 'a'], [8, 8, 'b']]);
  assert.ok(nah(aus[0].fade_aus_beats, FADE) && nah(aus[1].fade_ein_beats, FADE), 'seam at the punch-out');
  assert.equal(aus[0].fade_ein_beats, 0, 'the take start is no cut');
});

test('Negativ-Kontrolle: without a punch the result is the slice 1 result (the whole take replaces its range, no fades)', () => {
  const { p, sid } = projekt([[0, 16]]);
  const c = haupt(nehme(p, sid, {}, 4, 4));
  assert.deepEqual(c.map((x) => [x.start_beat, x.laenge_beats, x.quelle.sha256[0], x.fade_ein_beats, x.fade_aus_beats]),
    [[0, 4, 'b', 0, 0], [4, 4, 'a', 0, 0], [8, 8, 'b', 0, 0]]);
});

test('a take that lies entirely outside the punch range places nothing: punch_leer', () => {
  const { p, sid } = projekt([[0, 16]]);
  assert.throws(() => nehme(p, sid, { punch: { von_beat: 20, bis_beat: 24 } }), (e) => e.grund === 'punch_leer');
  assert.throws(() => nehme(p, sid, { punch: { von_beat: 16, bis_beat: 20 } }), (e) => e.grund === 'punch_leer', 'touching the end only is outside');
  assert.ok(nehme(p, sid, { punch: { von_beat: 15, bis_beat: 20 } }), 'negative control: one beat of overlap places');
});

test('D2: a loop clip crossing the punch edge 4 is not cut: ersetzen_loop', () => {
  let { p, sid } = projekt([[0, 16]]);
  p = fuehreListeAus(p, [{ befehl: 'clip_aendern', clip_id: p.spuren[0].clips[0].id, loop_beats: 2 }]).projekt;
  assert.throws(() => nehme(p, sid, { punch: { von_beat: 4, bis_beat: 8 } }), (e) => e.grund === 'ersetzen_loop');
});

test('the Original lane keeps what the punch overwrote', () => {
  const { p, sid } = projekt([[0, 16]]);
  const n = nehme(p, sid, { punch: { von_beat: 4, bis_beat: 8 } });
  const orig = n.spuren[0].takes.find((t) => t.art === 'original');
  assert.deepEqual(orig.clips.map((x) => [x.start_beat, x.laenge_beats]), [[4, 4]], 'only the overwritten part, not the whole catalog clip');
});
