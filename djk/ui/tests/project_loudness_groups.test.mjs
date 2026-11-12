// 1.10 T10 (AK24, spec 5.10): loudness entries for groups and returns. A group entry runs its members, the group strip, its target chain and the returns they feed (the
// mechanics of a track entry with several tracks); a return entry is the return as the mix feeds it, wet only (render flag --trocken-aus). Unit part: reglerGruppe,
// reglerReturn, the key plan of a group path, renderArgumente. Process part: the real Ausgabe against the render stub (tests/support/render_mock.mjs, mode MISCHUNG: a
// track is a sine of 220 Hz times its number, 0.2 at 0 dB; a group fader scales its members; a send adds the track's sine times the send level into the output; with
// --trocken-aus only those wet parts are left). The own TMPDIR keeps this file from the djk-lautheit-* count of proj_lautheit_ablauf.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { reglerAusProjekt, renderArgumente, schluesselQuellen, schluesselReturns } from '../project/render.ts';
import { alsAntwort, gruppeStummImMix, reglerEinzeln, reglerGruppe, reglerReturn, stummImMix } from '../areas/proj/output.ts';
import { aufbau } from './support/output_setup.mjs';

const SHA = 'c'.repeat(64);
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
const komp = (strang, key) => ({ befehl: 'insert_setzen', strang_id: strang, pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 }, ...(key ? { key } : {}) });
const spur = (p, nr) => p.spuren.find((s) => s.nr === nr);

// s1, s2, s3 audio tracks with a clip each; g1 = {s1, s2}; return r1 (nr 1) and r2 (nr 2)
function basis() {
  let p = neuesProjekt('T');
  p = lauf(p, ['A', 'B', 'C'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  for (const id of ['s1', 's2', 's3']) p = lauf(p, [{ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: id }]);
  return lauf(p, [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's2'] }, { befehl: 'return_neu', name: 'R1' }, { befehl: 'return_neu', name: 'R2' }]);
}

test('reglerGruppe: the members run as the mix has them, every other track is muted, the group strip and the returns the path feeds follow', () => {
  let p = lauf(basis(), [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -6, pan: 0.25 }, { befehl: 'send_setzen', strang_id: 's2', return_id: 'r1', db: -9 },
    { befehl: 'send_setzen', strang_id: 's3', return_id: 'r2', db: 0 }, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }]);
  const g = p.gruppen[0];
  const r = reglerGruppe(g, p);
  assert.equal(r['spur/1/mute'], 0); assert.equal(r['spur/2/mute'], 0); assert.equal(r['spur/3/mute'], 1, 'a track outside the group is muted by the isolation');
  assert.equal(r['spur/1/fader'], -3);
  assert.equal(r['grp/1/fader'], -6); assert.equal(r['grp/1/pan'], 0.25); assert.equal(r['grp/1/mute'], 0);
  assert.equal(r['spur/2/send/1'], -9, 'the send of a member');
  assert.equal(r['ret/1/mute'], 0, 'the return a member feeds sounds');
  assert.equal(r['ret/2/fader'], undefined, 'return 2 is fed by a track outside the path: no control (it stays on the default and silent)');
  assert.ok(Object.keys(r).filter((k) => k.endsWith('/solo')).every((k) => r[k] === 0), 'no solo in an isolated render');
  // a muted member stays muted: the group is measured as the mix has it
  p = lauf(p, [{ befehl: 'spur_aendern', spur_id: 's2', mute: true }]);
  assert.equal(reglerGruppe(p.gruppen[0], p)['spur/2/mute'], 1);
});

test('reglerReturn: the controls of the project, every other return muted', () => {
  const p = lauf(basis(), [{ befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }, { befehl: 'send_setzen', strang_id: 's2', return_id: 'r2', db: -6 }]);
  const r1 = reglerReturn(p.returns[0], p), r2 = reglerReturn(p.returns[1], p);
  assert.equal(r1['ret/1/mute'], 0); assert.equal(r1['ret/2/mute'], 1);
  assert.equal(r2['ret/1/mute'], 1); assert.equal(r2['ret/2/mute'], 0);
  assert.equal(r1['spur/3/mute'], 0, 'the tracks are not isolated: the return is measured as the mix feeds it');
  const alle = reglerAusProjekt(p);
  for (const k of Object.keys(alle)) if (!k.endsWith('/mute') || !k.startsWith('ret/')) assert.equal(r1[k], alle[k], k);
});

test('schluesselQuellen of a group path: the members are on the path, a key from a member is no source; a key from outside is', () => {
  let p = lauf(basis(), [komp('s2', { quelle: 'spur', nr: 1, punkt: 'post' })]);
  const pfad = (q) => ({ spuren: q.spuren.filter((s) => s.ausgang?.id === 'g1'), gruppen: [q.gruppen[0]] });
  assert.deepEqual(schluesselQuellen(p, pfad(p)), [], 'track 1 is a member: it plays in the group render');
  p = lauf(basis(), [komp('s2', { quelle: 'spur', nr: 3, punkt: 'post' })]);
  assert.deepEqual(schluesselQuellen(p, pfad(p)), ['spur/3'], 'track 3 is outside the group: it runs for its key and adds nothing');
});

test('renderArgumente: --trocken-aus only when set', () => {
  const auf = { programm: ['x'], nr: 1, von_beat: 0, bis_beat: 4, bpm: 120, aus: 'a.wav', arbeitsordner: 'o', spurRegler: 'r.json', instanz: 'g', zeitlimitMs: 1 };
  const alt = renderArgumente(auf);
  assert.deepEqual(renderArgumente({ ...auf, trockenAus: false }), alt);
  assert.deepEqual(renderArgumente({ ...auf, trockenAus: true }), [...alt, '--trocken-aus']);
});

// --- process part
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');
const aufrufe = (a) => (fs.existsSync(protokollDatei(a)) ? fs.readFileSync(protokollDatei(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
const lautheit = async (a) => {
  try {
    return { code: 200, body: await mitUmgebung({ RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a), TMPDIR: a.tmp }, () => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 8 })) };
  } catch (e) { return alsAntwort(e); }
};
const trocken = (x) => x.argv.includes('--trocken-aus');
// the fixture adds g1 = {s1, s2} (s1 kick 220 Hz, s2 bass 440 Hz); the lead s3 has no content in 0..8
const mitGruppe = async (t, befehle = [], tempo = 120) => {
  const a = await aufbau(t, { tempo });
  await a.aendern([{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's2'] }, ...befehle], 'Group');
  return a;
};
const nr = (liste, n) => liste.find((x) => x.nr === n);

test('Lautheit: a group entry holds its members with the group fader: members sum - 6 LU within 0.1, and it agrees with the sum', async (t) => {
  const a0 = await mitGruppe(t);
  const r0 = await lautheit(a0);
  assert.equal(r0.code, 200, JSON.stringify(r0.body));
  const a = await mitGruppe(t, [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -6 }]);
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.gruppen.length, 1);
  const g = r.body.gruppen[0], g0 = r0.body.gruppen[0];
  assert.deepEqual([g.gruppe_id, g.nr, g.name, g.stumm, g.unter_messgrenze], ['g1', 1, 'G', false, false]);
  assert.ok(Math.abs((g0.lufs_i - g.lufs_i) - 6) <= 0.1, `the group fader takes ${g0.lufs_i - g.lufs_i} LU, 6 expected`);
  assert.ok(Math.abs(g.lufs_i - r.body.summe.lufs_i) <= 0.1, `group ${g.lufs_i} against the sum ${r.body.summe.lufs_i}: all content of the project is in the group`);
  assert.equal(g.return_id, undefined);
  // the render of the group: s1 and s2 run, the lead does not, the group fader is in the controls, no --trocken-aus
  const call = aufrufe(a).find((x) => x.regler && x.regler['grp/1/fader'] === -6 && x.regler['spur/1/mute'] === 0 && x.regler['spur/2/mute'] === 0 && x.regler['spur/3/mute'] === 1);
  assert.ok(call, 'a render of the group exists: its members run, the lead is muted');
  assert.equal(trocken(call), false);
  assert.deepEqual(r.body.returns, [], 'a project without returns has no return entries');
});

test('Lautheit: a group without members is not listed; a muted group, a solo elsewhere and a solo member follow the mix (stumm, no render)', async (t) => {
  const a = await mitGruppe(t, [{ befehl: 'gruppenspur_neu', name: 'Empty', mitglieder: ['s3'] }, { befehl: 'ziel_setzen', strang_id: 's3', ausgang: 'master' }]);
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.gruppen.map((g) => g.nr), [1], 'group 2 has no members');

  const m = await mitGruppe(t, [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', mute: true }]);
  const rm = await lautheit(m);
  assert.equal(rm.body.gruppen[0].stumm, true, 'a muted group is silent in the mix');
  assert.equal(rm.body.gruppen[0].lufs_i, null);
  assert.equal(rm.body.gruppen[0].spitze_db, -200);
  assert.equal(aufrufe(m).length, rm.body.spuren.length + 1, 'the muted group is not rendered: the tracks and the sum only')

  const s = await mitGruppe(t, [{ befehl: 'spur_aendern', spur_id: 's3', solo: true }]);
  const rs = await lautheit(s);
  assert.equal(rs.body.gruppen[0].stumm, true, 'a solo on a track outside the group silences the group in the mix');

  const so = await mitGruppe(t, [{ befehl: 'spur_aendern', spur_id: 's1', solo: true }]);
  const rso = await lautheit(so);
  assert.equal(rso.body.gruppen[0].stumm, false, 'a solo member keeps its group sounding');
  const gc = aufrufe(so).find((x) => x.regler['grp/1/fader'] !== undefined && x.regler['spur/3/mute'] === 1 && x.regler['spur/1/mute'] === 0);
  assert.equal(gc.regler['spur/2/mute'], 1, 'the group entry follows the mix: the member next to the solo member is silent');
  const volle = (await lautheit(await mitGruppe(t))).body.gruppen[0].lufs_i;
  assert.ok(rso.body.gruppen[0].lufs_i < volle - 2, `only one member sounds: ${rso.body.gruppen[0].lufs_i} against ${volle}`);
});

test('Lautheit: a return entry holds the wet part only; with the send off it is silent and not rendered; the sum is the project as before', async (t) => {
  const a = await mitGruppe(t, [{ befehl: 'return_neu', name: 'R' }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }]);
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.returns.length, 1);
  const x = r.body.returns[0];
  assert.deepEqual([x.return_id, x.nr, x.stumm, x.unter_messgrenze, x.gruppe_id], ['r1', 1, false, false, undefined]);
  const kick = nr((await lautheit(await mitGruppe(t))).body.spuren, 1);   // the same kick without the send: the dry level
  assert.ok(Math.abs((kick.lufs_i - x.lufs_i) - 6) <= 0.2, `the wet part is the send level below the track: ${kick.lufs_i - x.lufs_i} LU, 6 expected`);
  assert.ok(nr(r.body.spuren, 1).lufs_i > kick.lufs_i + 3, 'the track entry carries its own return, the return entry does not carry the track');
  const calls = aufrufe(a);
  const ret = calls.filter(trocken);
  assert.equal(ret.length, 1, 'one render with --trocken-aus');
  assert.equal(ret[0].regler['ret/1/mute'], 0);
  assert.equal(ret[0].regler['spur/1/mute'], 0, 'the tracks run as the mix has them');
  // the sum is the project: the controls of the project, no flag
  const summe = calls.find((c) => !trocken(c) && c.regler['spur/3/mute'] === 0 && c.regler['spur/1/send/1'] === -6);
  assert.ok(summe, 'the sum render');
  assert.deepEqual(summe.regler, reglerAusProjekt(a.projekt()));
  assert.equal(summe.argv.includes('--nur-schluessel'), false);

  // the send off: silent, and the return is not rendered at all
  const b = await mitGruppe(t, [{ befehl: 'return_neu', name: 'R' }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -200 }]);
  const rb = await lautheit(b);
  assert.equal(rb.body.returns[0].stumm, true);
  assert.equal(rb.body.returns[0].lufs_i, null);
  assert.equal(aufrufe(b).filter(trocken).length, 0);
  // the return muted: silent in the mix
  const c = await mitGruppe(t, [{ befehl: 'return_neu', name: 'R' }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: 0 }, { befehl: 'return_aendern', return_id: 'r1', mute: true }]);
  const rc = await lautheit(c);
  assert.equal(rc.body.returns[0].stumm, true);
  assert.equal(aufrufe(c).filter(trocken).length, 0);
});

test('Lautheit: a return fed by a group send, and the group entry carries the return it feeds (members sends included)', async (t) => {
  const a = await mitGruppe(t, [{ befehl: 'return_neu', name: 'R' }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }]);
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const g = r.body.gruppen[0];
  const call = aufrufe(a).find((x) => x.regler['grp/1/fader'] !== undefined && x.regler['spur/3/mute'] === 1 && !trocken(x));
  assert.equal(call.regler['spur/1/send/1'], -6, 'the send of a member is in the group render');
  assert.equal(call.regler['ret/1/mute'], 0);
  // dry s1 + s2 plus the wet part of s1 (in phase with s1): the group is louder than without the send
  const b = await mitGruppe(t);
  const rb = await lautheit(b);
  assert.ok(g.lufs_i > rb.body.gruppen[0].lufs_i + 0.3, `${g.lufs_i} against ${rb.body.gruppen[0].lufs_i}`);
  assert.ok(Math.abs(g.lufs_i - r.body.summe.lufs_i) <= 0.1);
});

test('Lautheit error case: a project without groups and returns has empty lists, the other fields as before, and no render gets the new flag', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.gruppen, []);
  assert.deepEqual(r.body.returns, []);
  assert.deepEqual(Object.keys(r.body), ['von_beat', 'bis_beat', 'spuren', 'summe', 'gruppen', 'returns'], 'the new lists come after the old fields');
  const calls = aufrufe(a);
  assert.equal(calls.length, r.body.spuren.length + 1, 'one render per track and the sum: nothing else');
  assert.ok(calls.every((c) => !trocken(c) && !c.argv.includes('--nur-schluessel')));
  assert.equal(r.body.spuren.length, 2);
});

// fix 1: a PM stage keyed by ANOTHER return (post). The return entry mutes the other returns, which would silence the key; the key return runs through the mask instead.
const pmKey = { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 }, key: { quelle: 'ret', nr: 2, punkt: 'post' } };
const zweiReturns = [{ befehl: 'return_neu', name: 'R1' }, { befehl: 'return_neu', name: 'R2' }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 },
  { befehl: 'send_setzen', strang_id: 's2', return_id: 'r2', db: 0 }];

test('schluesselReturns: the key returns of the stages that sound in a return entry, the entry itself and non-returns left out', () => {
  const p = lauf(basis(), [komp('master', { quelle: 'ret', nr: 2, punkt: 'post' })]);
  assert.deepEqual(schluesselReturns(p, p.returns[0]).map((r) => r.nr), [2]);
  assert.deepEqual(schluesselReturns(p, p.returns[1]).map((r) => r.nr), [], 'a return keyed by itself needs no mask');
  assert.deepEqual(schluesselReturns(lauf(basis(), [komp('master', { quelle: 'spur', nr: 3, punkt: 'post' })]), basis().returns[0]), [], 'a track key runs live anyway');
  // only the production master can be keyed by a return (sidechain_spaet for every other strip), so the master chain is the whole path
});

test('Lautheit: a return entry ducks like the mix when a PM stage is keyed by another return; the key return muted by the project does not', async (t) => {
  const ohne = await mitGruppe(t, zweiReturns);
  const r0 = await lautheit(ohne);
  assert.equal(r0.code, 200, JSON.stringify(r0.body));
  const a = await mitGruppe(t, [...zweiReturns, pmKey]);
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const d = nr(r0.body.returns, 1).lufs_i - nr(r.body.returns, 1).lufs_i;
  assert.ok(Math.abs(d - 12) <= 0.5, `return 1 is ${d} LU lower with the key, 12 expected`);
  const ruf = aufrufe(a).find((x) => trocken(x) && x.regler['ret/1/mute'] === 0);
  assert.ok(ruf, 'the render of return 1');
  const i = ruf.argv.indexOf('--nur-schluessel');
  assert.equal(ruf.argv[i + 1], 'ret/2', 'the key return is masked');
  assert.equal(ruf.regler['ret/2/mute'], 0, 'and runs instead of being muted');
  // counter-check: the key return muted by the PROJECT stays muted, so the key is silent in the mix as well
  const m = await mitGruppe(t, [...zweiReturns, pmKey, { befehl: 'return_aendern', return_id: 'r2', mute: true }]);
  const rm = await lautheit(m);
  const rufm = aufrufe(m).find((x) => trocken(x) && x.regler['ret/1/mute'] === 0);
  assert.equal(rufm.regler['ret/2/mute'], 1);
  assert.ok(Math.abs(nr(rm.body.returns, 1).lufs_i - nr(r0.body.returns, 1).lufs_i) <= 0.1, 'no key, no ducking');
  // a project without a return key: no flag at all
  assert.equal(aufrufe(ohne).filter(trocken).every((x) => !x.argv.includes('--nur-schluessel')), true);
});

// --- Slice 3 (nested groups, task 6): the single-strip render machine follows the whole group chain.
// g1 holds g2 and the track s3; g2 holds g3 and s2; g3 holds s1 (3 in 2 in 1).
const ketteBefehle = [{ befehl: 'gruppenspur_neu', name: 'G1' }, { befehl: 'gruppenspur_neu', name: 'G2' }, { befehl: 'gruppenspur_neu', name: 'G3' },
  { befehl: 'ziel_setzen', strang_id: 'g2', ausgang: { art: 'gruppe', id: 'g1' } }, { befehl: 'ziel_setzen', strang_id: 'g3', ausgang: { art: 'gruppe', id: 'g2' } },
  { befehl: 'ziel_setzen', strang_id: 's1', ausgang: { art: 'gruppe', id: 'g3' } }, { befehl: 'ziel_setzen', strang_id: 's2', ausgang: { art: 'gruppe', id: 'g2' } },
  { befehl: 'ziel_setzen', strang_id: 's3', ausgang: { art: 'gruppe', id: 'g1' } }];
const OFFSETS = [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -2 }, { befehl: 'gruppenspur_aendern', gruppe_id: 'g3', fader_db: -3 },
  { befehl: 'gruppenspur_aendern', gruppe_id: 'g2', fader_db: -4 }, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -5 }];
const ohneGruppen = () => {   // basis() without its group and returns
  let p = neuesProjekt('T');
  p = lauf(p, ['A', 'B', 'C'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  for (const id of ['s1', 's2', 's3']) p = lauf(p, [{ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: id }]);
  return p;
};
const baum = (extra = []) => lauf(ohneGruppen(), [...ketteBefehle, ...extra]);

test('reglerEinzeln: a track in 3 in 2 in 1 carries the fader, pan and mute of every group above it, and nothing of the others', () => {
  const p = baum([...OFFSETS, { befehl: 'gruppenspur_aendern', gruppe_id: 'g2', pan: 0.5 }]);
  const r = reglerEinzeln(spur(p, 1), p);
  assert.deepEqual([r['grp/3/fader'], r['grp/2/fader'], r['grp/1/fader']], [-3, -4, -5]);
  assert.equal(r['grp/2/pan'], 0.5);
  assert.deepEqual([r['grp/3/mute'], r['grp/2/mute'], r['grp/1/mute']], [0, 0, 0]);
  // a track one level up does not see g3
  const r2 = reglerEinzeln(spur(p, 2), p);
  assert.equal(r2['grp/3/fader'], undefined);
  assert.deepEqual([r2['grp/2/fader'], r2['grp/1/fader']], [-4, -5]);
  // mute acts downwards: a muted middle group is muted in the chain of the track below, and wins over a solo on the track
  const m = lauf(p, [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g2', mute: true }, { befehl: 'spur_aendern', spur_id: 's1', solo: true }]);
  assert.equal(reglerEinzeln(spur(m, 1), m)['grp/2/mute'], 1);
});

test('Lautheit: a track in 3 in 2 in 1 with fader offsets on every level equals the soloed mix (the sum with the other tracks muted), and every group entry agrees', async (t) => {
  const mit = (extra = []) => aufbau(t).then(async (a) => { await a.aendern([...ketteBefehle, ...extra], 'Tree'); return a; });
  const a = await mit(OFFSETS);
  const r = await lautheit(a);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  // soloed on s1: the same project with s2 muted (s3 has no content in 0..8), measured as the sum
  const b = await mit([...OFFSETS, { befehl: 'spur_aendern', spur_id: 's2', mute: true }]);
  const rb = await lautheit(b);
  assert.equal(rb.code, 200, JSON.stringify(rb.body));
  const s1 = nr(r.body.spuren, 1), solo = rb.body.summe.lufs_i;
  assert.ok(Math.abs(s1.lufs_i - solo) <= 0.1, `track entry ${s1.lufs_i} against the soloed sum ${solo}`);
  // 14 dB under the unnested, unattenuated track
  const c = await aufbau(t);
  const rc = await lautheit(c);
  assert.ok(Math.abs((nr(rc.body.spuren, 1).lufs_i - s1.lufs_i) - 14) <= 0.1, `the four faders take ${nr(rc.body.spuren, 1).lufs_i - s1.lufs_i} LU, 14 expected`);
  // the groups: g3 holds s1 only (+ chain above), g2 and g1 hold more; every one with s1 + the chain
  const g3 = r.body.gruppen.find((g) => g.gruppe_id === 'g3');
  assert.ok(g3 && Math.abs(g3.lufs_i - s1.lufs_i) <= 0.1, 'group 3 holds the one track: same level as its entry');
  const g1 = r.body.gruppen.find((g) => g.gruppe_id === 'g1');
  assert.ok(g1 && Math.abs(g1.lufs_i - r.body.summe.lufs_i) <= 0.1, 'group 1 holds all content of the project: same level as the sum');
  assert.equal(r.body.gruppen.length, 3, 'a group whose members sit in child groups is listed too');
  // the render of g3 carries the chain above it
  const call = aufrufe(a).find((x) => x.regler && x.regler['grp/3/fader'] === -3 && x.regler['grp/2/fader'] === -4 && x.regler['grp/1/fader'] === -5 && x.regler['spur/1/mute'] === 0 && x.regler['spur/2/mute'] === 1);
  assert.ok(call, 'a render exists for group 3 with the whole chain, the other tracks muted');
});

test('mute/solo mirror in a three-level tree: solo plays the strip, its descendants and its ancestors; mute acts downwards and wins', () => {
  const stumm = (p) => [1, 2, 3].map((n) => stummImMix(p, spur(p, n)) ? n : 0).filter(Boolean).concat(p.gruppen.map((g) => gruppeStummImMix(p, g) ? `g${g.nr}` : '').filter(Boolean));
  const mit = (b) => baum([{ befehl: 'gruppenspur_neu', name: 'G4' }, { befehl: 'ziel_setzen', strang_id: 'g4', ausgang: { art: 'gruppe', id: 'g1' } }, ...b]);
  assert.deepEqual(stumm(mit([])), [], 'no solo, no mute: all sound');
  assert.deepEqual(stumm(mit([{ befehl: 'gruppenspur_aendern', gruppe_id: 'g2', solo: true }])), [3, 'g4'], 'solo g2: g2, g3, s1, s2 and ancestor g1 play; sibling s3 and g4 are silent');
  assert.deepEqual(stumm(mit([{ befehl: 'spur_aendern', spur_id: 's1', solo: true }])), [2, 3, 'g4'], 'solo s1: s1 and its three groups play');
  assert.deepEqual(stumm(mit([{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', solo: true }])), [], 'solo g1 (the top): everything below plays');
  assert.deepEqual(stumm(mit([{ befehl: 'gruppenspur_aendern', gruppe_id: 'g3', solo: true }, { befehl: 'gruppenspur_aendern', gruppe_id: 'g2', mute: true }])).filter((x) => typeof x === 'string'),
    ['g2', 'g3', 'g4'], 'mute wins over solo, and acts downwards: g3 under muted g2 is silent although soloed');
});

test('gruppeStummImMix: an ancestor with its fader off silences the child group like an ancestor mute', () => {
  const p = baum([{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -200 }]);
  assert.equal(gruppeStummImMix(p, p.gruppen.find((g) => g.id === 'g3')), true);
  assert.equal(gruppeStummImMix(baum(), baum().gruppen.find((g) => g.id === 'g3')), false);
});
