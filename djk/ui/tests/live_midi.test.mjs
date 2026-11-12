// Plan live-module task 8 (decisions 8, 9): the new instrument paths. baueNeuePfade as a pure project edit (instrument tracks with the default graphs,
// MIDI clips with the bar phase of the audio clips, new fader closed), and the chain after the stems arrive with the MIDI runner as a double:
// success = one undo step, runner failure = no new path and midi_fehler in /modul/stand while stems and loop stay as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { neuesProjekt, pruefeProjekt, MAX_BK_SPUREN } from '../project/model.ts';
import { baueModul, baueNeuePfade, liveSlots, NEU_INSTRUMENT } from '../project/live.ts';
import { pythonMidiLauf } from '../areas/live/midi.ts';
import { rmsDbVonWav, pegelVersatz } from '../areas/live/level.ts';
import os from 'node:os';
import path from 'node:path';
import { pythonVorgabe } from '../server.ts';
import { REPO_PFADE } from '../paths.ts';
import { warteBis } from './support/proj_context.mjs';
import { liveAufbau } from './support/live_module.mjs';

const OHNE_GPU = !fs.existsSync('/dev/nvidia0') && 'no NVIDIA GPU: stems run on the GPU only';
const HASH = 'c'.repeat(64), D = (n) => ({ sha256: n.repeat(64), pfad: `/x/${n}.wav` });
const herkunft = (extra = {}) => ({ quelle_sha256: HASH, titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120,
  tonart: '8A', datum: '2026-11-12', ...extra });
const LOOP = { ...D('e'), beats: 16, frames: 16 * 24000 };
const live = () => { const p = neuesProjekt('x'); p.live = true; return p; };
const vier = () => ({ drums: D('1'), bass: D('2'), other: D('3'), vocals: D('4') });
const KICK = [{ beat: 0, laenge: 0.25, ton: 36, vel: 100 }, { beat: 2, laenge: 0.25, ton: 39, vel: 90 }, { beat: 13, laenge: 0.25, ton: 42, vel: 80 }, { beat: 15.5, laenge: 0.5, ton: 42, vel: 70 }];
const BASS = [{ beat: 0, laenge: 1, ton: 36, vel: 100 }, { beat: 8, laenge: 2, ton: 41, vel: 90 }];
const kind = (p, name) => p.gruppen.find((g) => g.name === name);
const spuren = (p, g) => p.spuren.filter((s) => s.ausgang?.id === g.id);
const valide = (p) => assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(p))), JSON.stringify(pruefeProjekt(JSON.parse(JSON.stringify(p)))));

test('baueNeuePfade: Drums and Bass get an instrument track with their default graph, the new fader closed, the original untouched', () => {
  const p0 = baueModul(live(), 'A', LOOP, vier(), herkunft());
  const p = baueNeuePfade(p0, 'A', { drums: KICK, bass: BASS });
  for (const [name, graph, noten] of [['Drums', 'drums-909', KICK], ['Bass', 'synth-neuro', BASS]]) {
    assert.equal(NEU_INSTRUMENT[name.toLowerCase()], graph);
    const g = kind(p, name);
    const [orig, neu] = [spuren(p, g).find((s) => s.art === 'audio'), spuren(p, g).find((s) => s.art === 'instrument')];
    assert.equal(spuren(p, g).length, 2, name);
    assert.deepEqual(neu.geraet, { art: 'intern', name: 'bk', graph, parameter: {} });
    assert.equal(neu.fader_db, -200);
    assert.equal(neu.name, `${name} new`);
    assert.equal(orig.fader_db, 0);
    assert.equal(orig.mute, false);
    assert.equal(g.blend, undefined);
    // von_beat 4 = bar phase 0: one clip from beat 0 over the 64 beat region, looping every 16 beats, with all notes
    assert.equal(neu.clips.length, 1);
    const c = neu.clips[0];
    assert.deepEqual([c.art, c.start_beat, c.laenge_beats, c.loop_beats], ['midi', 0, 64, 16]);
    assert.deepEqual(c.noten.map(({ beat, laenge, ton, vel }) => ({ beat, laenge, ton, vel })), noten);
  }
  assert.equal(spuren(p, kind(p, 'Other')).length, 1, 'Other and Vocals get no new path');
  assert.equal(spuren(p, kind(p, 'Vocals')).length, 1);
  assert.equal(p.spuren.length, p0.spuren.length + 2);
  valide(p);
});

test('baueNeuePfade: a stem without notes gets no track; a second run adds nothing; two modules use four of the eight bk tracks', () => {
  const p0 = baueModul(live(), 'A', LOOP, vier(), herkunft());
  const nurDrums = baueNeuePfade(p0, 'A', { drums: KICK, bass: [] });
  assert.equal(nurDrums.spuren.filter((s) => s.art === 'instrument').length, 1);
  assert.equal(baueNeuePfade(nurDrums, 'A', { drums: KICK }).spuren.length, nurDrums.spuren.length, 'no second instrument track');
  let p = baueNeuePfade(p0, 'A', { drums: KICK, bass: BASS });
  p = baueNeuePfade(baueModul(p, 'B', LOOP, vier(), herkunft()), 'B', { drums: KICK, bass: BASS });
  const bk = p.spuren.filter((s) => s.geraet?.name === 'bk').length;
  assert.equal(bk, 4);
  assert.ok(bk <= MAX_BK_SPUREN);
  valide(p);
});

test('baueNeuePfade: the bar phase of the audio clips applies: von_beat 5 puts a lead-in of one beat before the looping clip', () => {
  const p = baueNeuePfade(baueModul(live(), 'A', LOOP, vier(), herkunft({ von_beat: 5 })), 'A', { drums: KICK });
  const neu = p.spuren.find((s) => s.art === 'instrument');
  const [kopf, haupt] = [...neu.clips].sort((a, b) => a.start_beat - b.start_beat);
  assert.deepEqual([kopf.start_beat, kopf.laenge_beats], [0, 1]);                   // p = 1: the lead-in plays beat 15..16 of the loop
  assert.deepEqual(kopf.noten.map((n) => [n.beat, n.ton]), [[0.5, 42]]);            // the hat at 15.5, moved to the clip start (15)
  assert.deepEqual([haupt.start_beat, haupt.laenge_beats, haupt.loop_beats], [1, 63, 16]);
  assert.equal(haupt.noten.length, 4);
  // the audio clips of the same module follow the same rule
  const audio = p.spuren.find((s) => s.name === 'Drums original').clips.map((c) => [c.start_beat, c.laenge_beats]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(audio, [[0, 1], [1, 63]]);
  valide(p);
});

test('the real runner reports a failure as an Error (missing file), not as an empty result', async () => {
  const lauf = pythonMidiLauf({ python: pythonVorgabe(), cwd: REPO_PFADE.werkstatt, zeitlimitMs: 60000 });
  await assert.rejects(() => lauf('drums', '/nonexistent/stem.wav', 16), /midi_aus_stem drums/);
});

async function kette(t, midi) {
  const z = await liveAufbau(t, { trenner: 'identitaet_vier', midi });
  assert.equal((await z.m.exportiere({ deck: 1, slot: 'A' }, 'andreas')).code, 200);
  assert.ok(await warteBis(() => z.stand('A')?.stems?.stems === 'fertig', 60000), JSON.stringify(z.stand('A')));
  return z;
}

test('after the stems arrive the module gets Drums and Bass instrument tracks in ONE undo step, new fader closed; the store hook sees them', { skip: OHNE_GPU }, async (t) => {
  const aufrufe = [];
  const z = await kette(t, { laufe: async (art, wav, beats) => { aufrufe.push([art, wav, beats]); return art === 'drums' ? KICK : BASS; } });
  assert.ok(await warteBis(() => z.nachStems.length === 1, 20000), 'nachStems ran');
  const p = z.projekt();
  assert.deepEqual(aufrufe.map((a) => a[0]), ['drums', 'bass']);
  assert.ok(aufrufe.every((a) => a[1].endsWith('.wav') && a[2] === 4), JSON.stringify(aufrufe));
  const d = kind(p, 'Drums'), b = kind(p, 'Bass');
  assert.deepEqual(spuren(p, d).map((s) => [s.art, s.fader_db]).sort(), [['audio', 0], ['instrument', -200]]);
  assert.equal(spuren(p, d).find((s) => s.art === 'instrument').geraet.graph, 'drums-909');
  assert.equal(spuren(p, b).find((s) => s.art === 'instrument').geraet.graph, 'synth-neuro');
  assert.equal(spuren(p, kind(p, 'Other')).length, 1);
  assert.equal(z.nachStems[0].projekt.spuren.filter((s) => s.art === 'instrument').length, 2, 'the module is stored with its new paths');
  assert.equal(z.stand('A').midi_fehler, undefined);
  await z.s.umkehr('undo', { rev: p.rev }, 'andreas');                            // one step back: the stems stay, the new paths go
  const q = z.projekt();
  assert.equal(q.spuren.filter((s) => s.art === 'instrument').length, 0);
  assert.equal(spuren(q, kind(q, 'Drums')).length, 1, 'stems are still there');
});

test('a failing MIDI runner leaves the module with its stems and loop and no new path; the reason is midi_fehler in /modul/stand', { skip: OHNE_GPU }, async (t) => {
  const z = await kette(t, { laufe: async (art) => { if (art === 'bass') throw new Error('midi_aus_stem bass: lauf:RuntimeError'); return KICK; } });
  assert.ok(await warteBis(() => z.stand('A').midi_fehler !== undefined, 20000), JSON.stringify(z.stand('A')));
  assert.ok(await warteBis(() => z.nachStems.length === 1, 20000));
  const p = z.projekt();
  assert.equal(p.spuren.filter((s) => s.art === 'instrument').length, 0, 'all or nothing: no new path at all');
  assert.equal(p.gruppen.filter((g) => g.ausgang?.id === liveSlots(p).A).length, 4, 'the stem groups stand');
  assert.equal(p.spuren.find((s) => s.name === 'Loop').mute, true);
  assert.deepEqual(spuren(p, kind(p, 'Drums')).map((s) => [s.name, s.fader_db, s.mute]), [['Drums original', 0, false]]);
  const f = z.stand('A').midi_fehler;
  assert.equal(f.grund, 'midi_fehler');
  assert.match(f.detail, /bass: lauf:RuntimeError/);
  assert.equal(z.stand('A').stems.stems, 'fertig');
  assert.deepEqual(await z.fehl(() => z.bl.blende({ slot: 'A', stem: 'drums', wert: 1 }, 'andreas')), { code: 409, fehler: 'kein_neuer_pfad' });
});

// the render double: the original track is -30 dB rms, the new instrument -17 dB (the Bastille measure: +13 dB)
const pegelDouble = (orig = -30, neu = -17, ruf = []) => async (p, spurId) => {
  const s = p.spuren.find((x) => x.id === spurId);
  ruf.push([s.art, s.fader_db]);
  return s.art === 'audio' ? orig : neu;
};

test('pegelVersatz: original rms minus new rms in 0.1 dB steps; a silent track or a failed render throws', async () => {
  const p = baueNeuePfade(baueModul(live(), 'A', LOOP, vier(), herkunft()), 'A', { drums: KICK });
  const [o, n] = [p.spuren.find((s) => s.name === 'Drums original').id, p.spuren.find((s) => s.name === 'Drums new').id];
  assert.equal(await pegelVersatz(pegelDouble(), p, o, n), -13);
  assert.equal(await pegelVersatz(pegelDouble(-30.04, -16.93), p, o, n), -13.1);
  await assert.rejects(() => pegelVersatz(pegelDouble(-100, -17), p, o, n), /original stem is silent/);
  await assert.rejects(() => pegelVersatz(async () => { throw new Error('render_fehler: rc 4'); }, p, o, n), /render_fehler/);
});

test('rmsDbVonWav reads a float32 WAV: a full-scale square is 0 dB, half amplitude -6 dB', () => {
  const schreibe = (amp) => {
    const n = 4800, d = Buffer.alloc(n * 8);
    for (let i = 0; i < n * 2; i++) d.writeFloatLE(i % 2 === 0 ? amp : -amp, i * 4);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22);
    h.writeUInt32LE(48000, 24); h.writeUInt32LE(48000 * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40);
    const f = path.join(os.tmpdir(), `cdj-rms-${process.pid}-${amp}.wav`);
    fs.writeFileSync(f, Buffer.concat([h, d]));
    return f;
  };
  const a = schreibe(1), b = schreibe(0.5);
  try { assert.ok(Math.abs(rmsDbVonWav(a)) < 1e-6); assert.ok(Math.abs(rmsDbVonWav(b) + 6.0206) < 1e-3); } finally { fs.rmSync(a); fs.rmSync(b); }
});

test('after the stems arrive the new path gets neu_trim_db from the level measure, in the same undo step; blend 1 then puts the new fader at the trim', { skip: OHNE_GPU }, async (t) => {
  const ruf = [];
  const z = await kette(t, { laufe: async (art) => (art === 'drums' ? KICK : BASS), pegel: pegelDouble(-30, -17, ruf) });
  assert.ok(await warteBis(() => z.nachStems.length === 1, 30000), 'nachStems ran');
  const p = z.projekt();
  assert.equal(kind(p, 'Drums').neu_trim_db, -13);
  assert.equal(kind(p, 'Bass').neu_trim_db, -13);
  assert.equal(ruf.length, 4, 'original and new of both stems');
  assert.equal(z.stand('A').pegel_fehler, undefined);
  const a = await z.bl.blende({ slot: 'A', stem: 'drums', wert: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const q = z.projekt();
  assert.equal(spuren(q, kind(q, 'Drums')).find((s) => s.art === 'instrument').fader_db, -13);
  await z.s.umkehr('undo', { rev: q.rev }, 'andreas');
  await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas');
  const r = z.projekt();
  assert.equal(r.spuren.filter((s) => s.art === 'instrument').length, 0, 'trim and new path were one undo step');
  assert.equal(kind(r, 'Drums').neu_trim_db, undefined);
});

test('a failing level measure leaves trim 0 and the reason as pegel_fehler in /modul/stand; the new path is built all the same', { skip: OHNE_GPU }, async (t) => {
  const z = await kette(t, { laufe: async (art) => (art === 'drums' ? KICK : BASS), pegel: async () => { throw new Error('render_fehler: the render program is missing'); } });
  assert.ok(await warteBis(() => z.nachStems.length === 1, 30000), 'nachStems ran');
  const p = z.projekt();
  assert.equal(p.spuren.filter((s) => s.art === 'instrument').length, 2);
  assert.equal(kind(p, 'Drums').neu_trim_db, undefined);
  const f = z.stand('A').pegel_fehler;
  assert.equal(f.grund, 'pegel_fehler');
  assert.match(f.detail, /Drums: render_fehler: the render program is missing/);
  assert.equal(z.stand('A').midi_fehler, undefined);
});
