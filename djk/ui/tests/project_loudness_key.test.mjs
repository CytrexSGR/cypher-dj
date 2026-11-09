// 1.10 T9 (AK24): per-track loudness keeps the sidechain keys. The isolation mutes every other track; a keyed compressor on the measured path would stop ducking.
// The render-only mask (--nur-schluessel) lets the key sources run and keeps them out of the output. Unit part: schluesselQuellen (the ids with their suffixes),
// reglerEinzeln, renderArgumente. Process part: the real Ausgabe against the render stub (tests/support/render_mock.mjs, mode MISCHUNG: a track whose stage is keyed
// by a running track is 12 dB lower; a listed source runs without sounding). A project without keys is the negative control: no flag, the controls as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { renderArgumente, schluesselQuellen } from '../project/render.ts';
import { reglerEinzeln, alsAntwort, ohneFremdeLanen } from '../areas/proj/output.ts';
import { aufbau } from './support/output_setup.mjs';

const SHA = 'c'.repeat(64);
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
const komp = (strang, key) => ({ befehl: 'insert_setzen', strang_id: strang, pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 }, ...(key ? { key } : {}) });
const spur = (p, nr) => p.spuren.find((s) => s.nr === nr);

// s1 kick, s2 bass, s3 and s4 members of group g1 (nr 1), return r1 (nr 1)
function basis() {
  let p = neuesProjekt('T');
  p = lauf(p, ['K', 'B', 'M3', 'M4'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  for (const id of ['s1', 's2', 's3', 's4']) p = lauf(p, [{ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: id }]);
  return lauf(p, [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s3', 's4'] }, { befehl: 'return_neu', name: 'R' }]);
}

test('schluesselQuellen: a post track key names the key track bare; no key, a pre key (row sc) and a DJ key name nothing', () => {
  const ohne = basis();
  assert.deepEqual(schluesselQuellen(ohne, spur(ohne, 2)), []);
  const p = lauf(ohne, [komp('s2', { quelle: 'spur', nr: 1, punkt: 'post' })]);
  assert.deepEqual(schluesselQuellen(p, spur(p, 2)), ['spur/1']);
  assert.deepEqual(schluesselQuellen(p, spur(p, 1)), [], 'the key track measured itself has no stage on its path');
  assert.deepEqual(schluesselQuellen(p, spur(p, 3)), [], 'a track whose path has no keyed stage');
  const pre = lauf(ohne, [komp('s2', { quelle: 'spur', nr: 1, punkt: 'pre' })]);
  assert.deepEqual(schluesselQuellen(pre, spur(pre, 2)), [], 'a pre key is taken before the mute: nothing to run');
  const dj = lauf(ohne, [komp('s2', { quelle: 'deck', nr: 1 })]);
  assert.deepEqual(schluesselQuellen(dj, spur(dj, 2)), [], 'DJ keys are live only (E7)');
});

test('schluesselQuellen error case: a key source that does not exist is ignored, not an error', () => {
  const p = lauf(basis(), [komp('s2', { quelle: 'spur', nr: 1, punkt: 'post' })]);
  spur(p, 2).inserts[0].key.nr = 9;   // the project no longer has track 9
  assert.deepEqual(schluesselQuellen(p, spur(p, 2)), []);
  const q = lauf(basis(), [komp('master', { quelle: 'grp', nr: 1, punkt: 'post' })]);
  q.master.inserts[0].key.nr = 5;
  assert.deepEqual(schluesselQuellen(q, spur(q, 1)), []);
});

test('schluesselQuellen: a key group is bare, its members :ziel; a key return is bare, the tracks that send to it :sends; transitive; both ends are left out', () => {
  const grp = lauf(basis(), [komp('master', { quelle: 'grp', nr: 1, punkt: 'post' })]);
  assert.deepEqual(schluesselQuellen(grp, spur(grp, 1)), ['spur/3:ziel', 'spur/4:ziel', 'grp/1']);
  assert.deepEqual(schluesselQuellen(grp, spur(grp, 3)), [], 'the group of the measured track is on the path: its other members stay muted by the isolation');
  const ret = lauf(basis(), [komp('master', { quelle: 'ret', nr: 1, punkt: 'post' }), { befehl: 'send_setzen', strang_id: 's3', return_id: 'r1', db: 0 }]);
  assert.deepEqual(schluesselQuellen(ret, spur(ret, 1)), ['spur/3:sends', 'ret/1']);
  assert.deepEqual(schluesselQuellen(ret, spur(ret, 3)), [], 'the return is fed by the measured track: it is on the path');
  // a stage of the key track is keyed by a third track: the closure follows it
  const kette = lauf(basis(), [komp('s2', { quelle: 'spur', nr: 1, punkt: 'post' }), komp('s1', { quelle: 'spur', nr: 4, punkt: 'post' })]);
  assert.deepEqual(schluesselQuellen(kette, spur(kette, 2)), ['spur/1', 'spur/4']);
  // track 3 must feed the key group (keeps its target) AND the key return (keeps its sends): the mask cannot split it, it is left out
  const beide = lauf(basis(), [komp('master', { quelle: 'grp', nr: 1, punkt: 'post' }),
    { ...komp('master', { quelle: 'ret', nr: 1, punkt: 'post' }), pos: 1 },
    { befehl: 'send_setzen', strang_id: 's3', return_id: 'r1', db: 0 }]);
  assert.ok(!schluesselQuellen(beide, spur(beide, 1)).some((id) => id.startsWith('spur/3')), JSON.stringify(schluesselQuellen(beide, spur(beide, 1))));
});

test('schluesselQuellen: a group key on a group stage (group 1 keyed by group 2 pre): the members of group 2 are :ziel, group 2 is bare', () => {
  let p = lauf(basis(), [{ befehl: 'gruppenspur_neu', name: 'G2', mitglieder: ['s1', 's2'] }]);   // g1 = s3 + s4 (basis), g2 = s1 + s2
  p = lauf(p, [komp('g1', { quelle: 'grp', nr: 2, punkt: 'pre' })]);
  assert.deepEqual(schluesselQuellen(p, spur(p, 3)), ['spur/1:ziel', 'spur/2:ziel', 'grp/2']);
  assert.deepEqual(schluesselQuellen(p, spur(p, 1)), [], 'the measured track is a member of the key group itself: its group is on the path');
});

test('reglerEinzeln: a key track follows the PROJECT (mute, fader, a solo elsewhere); without keys the controls are what they were', () => {
  const ohne = basis();
  const alt = reglerEinzeln(spur(ohne, 2), ohne);
  assert.equal(alt['spur/1/mute'], 1, 'without keys the isolation mutes every other track');
  const p = lauf(ohne, [komp('s2', { quelle: 'spur', nr: 1, punkt: 'post' })]);
  const lebt = reglerEinzeln(spur(p, 2), p);
  assert.equal(lebt['spur/1/mute'], 0, 'the key track runs');
  assert.equal(lebt['spur/3/mute'], 1);
  const stumm = lauf(p, [{ befehl: 'spur_aendern', spur_id: 's1', mute: true }]);
  assert.equal(reglerEinzeln(spur(stumm, 2), stumm)['spur/1/mute'], 1, 'a key source the project mutes stays muted: its key is silent, as in the sum');
  const leise = lauf(p, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }]);
  assert.equal(reglerEinzeln(spur(leise, 2), leise)['spur/1/fader'], -6, 'the post key is taken after the fader');
  const solo = lauf(p, [{ befehl: 'spur_aendern', spur_id: 's3', solo: true }]);
  assert.equal(reglerEinzeln(spur(solo, 2), solo)['spur/1/mute'], 1, 'a solo elsewhere silences the key track in the mix too');
});

test('renderArgumente: --nur-schluessel only with a non-empty list', () => {
  const auf = { programm: ['x'], nr: 1, von_beat: 0, bis_beat: 4, bpm: 120, aus: 'a.wav', arbeitsordner: 'o', spurRegler: 'r.json', instanz: 'g', zeitlimitMs: 1 };
  const alt = renderArgumente(auf);
  assert.deepEqual(renderArgumente({ ...auf, nurSchluessel: [] }), alt, 'an empty list is the old command line');
  assert.deepEqual(renderArgumente({ ...auf, nurSchluessel: ['spur/1', 'spur/3:ziel'] }), [...alt, '--nur-schluessel', 'spur/1,spur/3:ziel']);
});

// --- process part: the real Ausgabe, the render stub
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');
const aufrufe = (a) => (fs.existsSync(protokollDatei(a)) ? fs.readFileSync(protokollDatei(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
const MISCHUNG = (a) => ({ RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) });
const lautheit = async (a) => {
  // TMPDIR of its own: proj_lautheit_ablauf counts the djk-lautheit-* folders of the shared temp dir and would see ours while this file runs beside it
  try { return { code: 200, body: await mitUmgebung({ ...MISCHUNG(a), TMPDIR: a.tmp }, () => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 8 })) }; } catch (e) { return alsAntwort(e); }
};
const nr = (r, n) => r.body.spuren.find((s) => s.nr === n);
const flag = (x) => { const i = x.argv.indexOf('--nur-schluessel'); return i < 0 ? null : x.argv[i + 1]; };

test('Lautheit: the bass keyed by the kick is measured ducked; the kick runs for its key and the stub hears it only through the bass', async (t) => {
  const grund = await aufbau(t, { tempo: 120 });
  const r0 = await lautheit(grund);
  assert.equal(r0.code, 200, JSON.stringify(r0.body));
  // negative control: a project without keys, no flag in any call, the isolation as before
  assert.ok(aufrufe(grund).every((x) => flag(x) === null), 'no key in the project: no --nur-schluessel');
  assert.equal(aufrufe(grund)[1].regler['spur/1/mute'], 1, 'bass alone: the kick is muted by the isolation, as before');

  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 }, key: { quelle: 'spur', nr: 1, punkt: 'post' } }], 'Keyed bass');
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const calls = aufrufe(a);
  assert.equal(calls.length, 3, 'kick, bass and the sum: the lead has no content in 0..8');
  assert.equal(flag(calls[0]), null, 'the kick has no keyed stage on its path');
  assert.equal(flag(calls[1]), 'spur/1', 'the bass alone, the kick listed');
  assert.equal(calls[1].regler['spur/1/mute'], 0, 'the kick runs in the bass render');
  assert.equal(flag(calls[2]), null, 'the sum is the project');
  const d = nr(r0, 2).lufs_i - nr(r, 2).lufs_i;
  assert.ok(Math.abs(d - 12) <= 0.3, `the bass is ${d} LU lower than without the key, 12 expected`);
  assert.equal(nr(r, 1).lufs_i, nr(r0, 1).lufs_i, 'the kick itself is unchanged');
});

test('Lautheit (Review Focus 5): a key source the PROJECT mutes leaves the bass unducked, per track and in the sum within 0.1 LU', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 }, key: { quelle: 'spur', nr: 1, punkt: 'post' } },
    { befehl: 'spur_aendern', spur_id: 's1', mute: true }], 'Keyed bass, kick muted');
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(nr(r, 1).stumm, true, 'the muted kick is reported silent');
  const calls = aufrufe(a);
  assert.equal(calls[0].regler['spur/1/mute'], 1, 'the kick stays muted by the project in the bass render');
  assert.ok(Math.abs(nr(r, 2).lufs_i - r.body.summe.lufs_i) <= 0.1, `bass ${nr(r, 2).lufs_i} against the sum ${r.body.summe.lufs_i}`);
});

test('Lautheit (lanes): the lanes of the key sources stay in the single render, so the bass entry agrees with the sum within 0.1 LU', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 }, key: { quelle: 'spur', nr: 1, punkt: 'post' } },
    { befehl: 'spur_aendern', spur_id: 's1', fader_db: -150 }], 'Keyed bass, kick base fader down');
  await a.aendern([{ befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }], 'lane');
  const id = a.projekt().spuren.find((x) => x.id === 's1').automation.find((l) => l.ziel === 'fader').id;
  await a.aendern([{ befehl: 'auto_punkte', lane_id: id, setze: [{ beat: 0, wert: -3 }, { beat: 16, wert: -3 }], loesche_von: 0, loesche_bis: 1e6 }], 'points');
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const bass = aufrufe(a).find((x) => flag(x) === 'spur/1');
  assert.ok(bass, 'the bass render lists the kick');
  assert.deepEqual((bass.wiedergabe.spuren.find((x) => x.nr === 1).auto ?? []).map((x) => x.ziel), ['fader'], 'the lane of the key source is in the bass render');
  assert.equal(bass.regler['spur/1/mute'], 0, 'the lane can bring the kick in: its base mute is the project mute only');
  assert.ok(Math.abs(nr(r, 2).lufs_i - r.body.summe.lufs_i) <= 0.1, `bass ${nr(r, 2).lufs_i} against the sum ${r.body.summe.lufs_i}`);
  // counter-check: the lanes stripped (the old isolation) take the kick's lane away
  const p = a.projekt();
  const bassSpur = p.spuren.find((x) => x.id === 's2');
  assert.equal(ohneFremdeLanen(p, bassSpur).spuren.find((x) => x.id === 's1').automation, undefined, 'without the key plan the kick lane is stripped');
  assert.ok(ohneFremdeLanen(p, bassSpur, [p.spuren.find((x) => x.id === 's1')]) === null, 'with the key source kept nothing else is stripped');
});
