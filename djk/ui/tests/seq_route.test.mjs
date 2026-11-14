// SEQ deck v2, task 3: the /seq routes and the gates of a SEQ deck. SeqBereich is driven like live_leeren.test.mjs drives ModulLeeren (the methods behind the
// routes); the live container is the real proj session of support/live_module.mjs, the deck state is a double, the instrument description is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liveAufbau } from './support/live_module.mjs';
import { ist } from './support/proj_context.mjs';
import { alsAntwort } from '../areas/proj/area.ts';
import { SeqBereich, geraetInfo } from '../areas/live/seq.ts';
import { seqGruppe } from '../project/seq.ts';

const INFO_BK = { art: 'bk', regler: [{ nr: 3, name: 'Cutoff', vorgabe: 0.5 }, { nr: 4, name: 'Resonance', vorgabe: 0.3 }], klaenge: [] };
const INFO_KIT = { art: 'kit', regler: [], klaenge: [{ ton: 36, name: 'kick' }, { ton: 38, name: 'snare' }, { ton: 42, name: 'hat' }] };
const info = (g) => (g?.name === 'bk' ? INFO_BK : g?.name === 'kit' ? INFO_KIT : { art: 'rb338', regler: [], klaenge: [] });

// the session checks that a kit and a graph exist: a kit folder with 909 and a graph folder with bassmusik, as environment of the test instance
function ordner(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-seq-route-'));
  const bkO = path.join(tmp, 'bk'), kitO = path.join(tmp, 'kits');
  fs.mkdirSync(bkO); fs.mkdirSync(path.join(kitO, '909'), { recursive: true });
  fs.writeFileSync(path.join(bkO, 'bassmusik.json'), JSON.stringify({ knoten: [{ id: 1, art: 'regler', nr: 3, min: 0, max: 1 }, { id: 2, art: 'regler', nr: 4, min: 0, max: 1 }] }));
  fs.writeFileSync(path.join(kitO, '909', 'kit.json'), JSON.stringify({ schema: 1, klaenge: [{ note: 36, name: 'kick', datei: 'k.wav' }] }));
  const vorher = { bk: process.env.CYPHERDJ_BK_ORDNER, kit: process.env.CYPHERDJ_KIT_ORDNER };
  process.env.CYPHERDJ_BK_ORDNER = bkO; process.env.CYPHERDJ_KIT_ORDNER = kitO;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', vorher.bk], ['CYPHERDJ_KIT_ORDNER', vorher.kit]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
}
async function aufbau(t) {
  ordner(t);
  const z = await liveAufbau(t);
  const spielt = new Set();
  const seq = new SeqBereich(z.ctx, z.zugang, { deckLaeuft: (n) => spielt.has(n), geraetInfo: info });
  const fehl = async (f) => {
    try { await f(); } catch (e) { const a = alsAntwort(e, z.ctx); return { code: a.code, fehler: a.j.fehler, text: a.j.text, detail: a.j.detail }; }   // the answer the route sends
    assert.fail('no refusal'); };
  const ereignisse = () => z.protokoll.verteilt.filter((e) => e.a === 'seq');
  const schritte = () => z.offen().verlauf.liste().length;
  const spur = (name) => z.projekt().spuren.find((s) => s.name === name);
  const gid = (platz = 2) => seqGruppe(z.projekt(), platz).id;
  return { ...z, seq, spielt, fehl, ereignisse, schritte, spur, gid };
}
const bk = 'bk:bassmusik';

test('anlegen, folge, befehle, text, leeren: every write is one undo step and one event, answers {rev, projekt, gruppe_id}, the state shows patterns with their text', async (t) => {
  const z = await aufbau(t);
  const a = await z.seq.anlege({ platz: 2 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.gruppe_id, z.gid());
  assert.equal(a.j.rev, z.projekt().rev);
  assert.equal(a.j.projekt.rev, a.j.rev, 'the page needs the project that was written');
  assert.deepEqual(z.ereignisse().map((e) => e.f), [{ platz: 2, rev: a.j.rev }]);
  const n0 = z.schritte();
  const f = await z.seq.folge({ platz: 2, name: 'Drums', geraet: 'kit:909', loop_beats: 4 }, 'andreas');
  assert.equal(f.code, 200, JSON.stringify(f.j));
  assert.equal(f.j.gruppe_id, a.j.gruppe_id);
  assert.equal(z.spur('Drums').mute, false, 'a pattern of Andreas is audible');
  assert.equal(z.schritte(), n0 + 1);
  const clip = z.spur('Drums').clips[0];
  const b = await z.seq.befehle({ platz: 2, label: 'click', befehle: [{ befehl: 'noten_neu', clip_id: clip.id, noten: [{ beat: 0, laenge: 0.125, ton: 36, vel: 100 }] }] }, 'andreas');
  assert.equal(b.code, 200, JSON.stringify(b.j));
  assert.equal(z.spur('Drums').clips[0].noten.length, 1);
  assert.equal(z.schritte(), n0 + 2);
  const x = await z.seq.text({ platz: 2, text: 'folge Drums\nnoten kick 36 1/16 x...x...x...x...' }, 'andreas');
  assert.equal(x.code, 200, JSON.stringify(x.j));
  assert.deepEqual(z.spur('Drums').clips[0].noten.map((n) => n.beat), [0, 1, 2, 3]);
  assert.equal(z.schritte(), n0 + 3);
  const stand = z.seq.stand().j;
  assert.deepEqual([stand['1'], stand['3'], stand['4']], [null, null, null]);
  assert.equal(stand['2'].gruppe_id, a.j.gruppe_id);
  assert.deepEqual(Object.keys(stand['2'].folgen[0]).sort(), ['clip_id', 'editierbar', 'geraet', 'laenge_beats', 'name', 'spur_id', 'stumm', 'text', 'zeilen']);
  const d = stand['2'].folgen[0];
  assert.deepEqual([d.name, d.geraet, d.stumm, d.editierbar, d.laenge_beats, d.clip_id], ['Drums', 'kit:909', false, true, 4, clip.id]);
  assert.match(d.text, /^folge Drums {2}kit:909 {2}1bar\nnoten kick 36 {2}1\/16 {2}x\.\.\. x\.\.\. x\.\.\. x\.\.\. {3}; kick$/);
  assert.deepEqual(d.zeilen, [{ id: 'kick', art: 'noten', name: 'kick', teiler: 0.25, ton: 36, abgeleitet: false }]);
  assert.equal(z.ereignisse().length, 4);
  assert.deepEqual(z.ereignisse().map((e) => e.f.rev), [a.j.rev, f.j.rev, b.j.rev, x.j.rev]);
  const l = await z.seq.leere({ platz: 2 }, 'andreas');
  assert.equal(l.code, 200, JSON.stringify(l.j));
  assert.equal(l.j.gruppe_id, a.j.gruppe_id, 'the cleared group is named');
  assert.equal(seqGruppe(z.projekt(), 2), undefined);
  assert.equal(z.projekt().spuren.length, 0);
  assert.equal(z.seq.stand().j['2'], null);
  // the same text again changes nothing and says so
  await z.seq.anlege({ platz: 2 }, 'andreas');
  await z.seq.text({ platz: 2, text: 'folge Drums kit:909 1bar\nnoten kick 36 1/16 x...' + '.'.repeat(12) }, 'andreas');
  const rev = z.projekt().rev;
  const nix = await z.seq.text({ platz: 2, text: z.seq.stand().j['2'].folgen[0].text }, 'andreas');
  assert.deepEqual([nix.code, nix.j.ohne_aenderung, nix.j.rev], [200, true, rev]);
  assert.equal(z.projekt().rev, rev);
});

test('GET /seq/geraet gives the info of a track; a stand with a pattern arranged in PRODUCTION shows one row without lanes', async (t) => {
  const z = await aufbau(t);
  await z.seq.anlege({ platz: 1 }, 'andreas');
  await z.seq.folge({ platz: 1, name: 'Bass', geraet: bk }, 'andreas');
  await z.seq.folge({ platz: 1, name: 'Arr', geraet: 'kit:909' }, 'andreas');
  const bass = z.spur('Bass');
  assert.deepEqual(z.seq.geraet(bass.id).j, INFO_BK);
  assert.deepEqual(z.seq.geraet(z.spur('Arr').id).j.klaenge.map((k) => k.name), ['kick', 'snare', 'hat']);
  const e = await z.fehl(() => z.seq.geraet('s999'));
  assert.deepEqual([e.code, e.fehler], [404, 'spur_unbekannt']);
  await z.aendern([{ befehl: 'clip_neu', spur_id: z.spur('Arr').id, art: 'midi', name: 'Two', start_beat: 64, laenge_beats: 4 }]);
  const folgen = z.seq.stand().j['1'].folgen;
  assert.deepEqual(folgen.map((x) => [x.name, x.editierbar]), [['Bass', true], ['Arr', false]]);
  assert.deepEqual([folgen[1].clip_id, folgen[1].zeilen, folgen[1].text, folgen[1].laenge_beats], [null, [], null, null]);
  const r = await z.fehl(() => z.seq.text({ platz: 1, text: 'folge Arr\nnoten k 36 1/4 x...' }, 'andreas'));
  assert.deepEqual([r.code, r.fehler], [400, 'argument_ungueltig']);
  assert.match(r.text, /Arr.*PRODUCTION/);
});

test('befehle: only the listed commands on tracks and clips of the deck; a clip or track outside the deck, a foreign field, a wrong clip_neu are refused and nothing is written', async (t) => {
  const z = await aufbau(t);
  await z.seq.anlege({ platz: 2 }, 'andreas');
  await z.seq.folge({ platz: 2, name: 'Drums', geraet: 'kit:909' }, 'andreas');
  await z.seq.folge({ platz: 2, name: 'Bass2', geraet: 'kit:909' }, 'andreas');
  await z.seq.anlege({ platz: 3 }, 'andreas');
  await z.seq.folge({ platz: 3, name: 'Other', geraet: 'kit:909' }, 'andreas');
  await z.aendern([{ befehl: 'spur_neu', art: 'instrument', name: 'Loose', geraet: { art: 'intern', name: 'kit', kit: '909' } },
    { befehl: 'clip_neu', spur_id: 's99', art: 'midi', start_beat: 0, laenge_beats: 4 }].slice(0, 1));
  const loose = z.spur('Loose');
  await z.aendern([{ befehl: 'clip_neu', spur_id: loose.id, art: 'midi', name: 'L', start_beat: 0, laenge_beats: 64 }]);
  const drums = z.spur('Drums'), clip = drums.clips[0], fremd = z.spur('Loose').clips[0], anderes = z.spur('Other').clips[0];
  const rev = z.projekt().rev;
  const neu = [{ beat: 0, laenge: 0.125, ton: 36, vel: 100 }];
  const faelle = [
    ['a clip of a loose track', { befehl: 'noten_neu', clip_id: fremd.id, noten: neu }, 'argument_ungueltig'],
    ['a clip of another deck', { befehl: 'noten_neu', clip_id: anderes.id, noten: neu }, 'argument_ungueltig'],
    ['a loose track deleted', { befehl: 'spur_loeschen', spur_id: loose.id }, 'argument_ungueltig'],
    ['a loose track changed', { befehl: 'spur_aendern', spur_id: loose.id, mute: true }, 'argument_ungueltig'],
    ['clip_neu on a loose track', { befehl: 'clip_neu', spur_id: loose.id, art: 'midi', start_beat: 0, laenge_beats: 64 }, 'argument_ungueltig'],
    ['clip_neu from beat 4', { befehl: 'clip_neu', spur_id: drums.id, art: 'midi', start_beat: 4, laenge_beats: 64 }, 'argument_ungueltig'],
    ['clip_neu of 32 beats', { befehl: 'clip_neu', spur_id: drums.id, art: 'midi', start_beat: 0, laenge_beats: 32 }, 'argument_ungueltig'],
    ['a command that is not allowed', { befehl: 'tempo_setzen', bpm: 90 }, 'argument_ungueltig'],
    ['the group', { befehl: 'seq_leeren', gruppe_id: z.gid() }, 'argument_ungueltig'],
    ['the output of a track', { befehl: 'spur_aendern', spur_id: drums.id, ausgang: 'master' }, 'argument_unbekannt'],
    ['the colour of a track', { befehl: 'spur_aendern', spur_id: drums.id, farbe: '#fff' }, 'argument_unbekannt'],
    ['a foreign field on a clip', { befehl: 'clip_aendern', clip_id: clip.id, start_beat: 8 }, 'argument_unbekannt'],
    ['the clip id of a track command', { befehl: 'clip_aendern', spur_id: drums.id, loop_beats: 2 }, 'argument_unbekannt'],
    ['not an object', 7, 'argument_ungueltig'],
    ['a rename to another pattern', { befehl: 'spur_aendern', spur_id: drums.id, name: 'BASS2' }, 'argument_ungueltig'],
  ];
  for (const [name, c, grund] of faelle) {
    const e = await z.fehl(() => z.seq.befehle({ platz: 2, befehle: [{ befehl: 'noten_neu', clip_id: clip.id, noten: neu }, c] }, 'andreas'));
    if (grund) assert.deepEqual([e.code, e.fehler], [400, grund], `${name}: ${e.text}`);
    assert.equal(z.projekt().rev, rev, `${name}: the first command of the list was not written either`);
  }
  for (const d of [{ platz: 2 }, { platz: 2, befehle: [] }, { platz: 2, befehle: 'x' }, { platz: 2, befehle: [{}], extra: 1 }, { platz: 9, befehle: [{}] }]) {
    const e = await z.fehl(() => z.seq.befehle(d, 'andreas'));
    assert.equal(e.code, 400, JSON.stringify(d));
  }
  // allowed: rename (to a free name), mute, loop length, descriptor, envelope, a new clip is refused by the model when there is one already
  const ok = await z.seq.befehle({ platz: 2, befehle: [{ befehl: 'spur_aendern', spur_id: drums.id, name: 'Kit', mute: true },
    { befehl: 'clip_aendern', clip_id: clip.id, loop_beats: 2 }, { befehl: 'noten_neu', clip_id: clip.id, noten: neu }] }, 'andreas');
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  assert.deepEqual([z.spur('Kit').mute, z.spur('Kit').clips[0].loop_beats], [true, 2]);
});

test('befehle: a noten_neu whose note is already there (same clip, beat to 1e-6, pitch) is dropped, the rest of the command stays; a list that is only doubles writes nothing', async (t) => {
  const z = await aufbau(t);
  await z.seq.anlege({ platz: 2 }, 'andreas');
  await z.seq.folge({ platz: 2, name: 'Drums', geraet: 'kit:909' }, 'andreas');
  const clip = z.spur('Drums').clips[0];
  const n = (beat, ton = 36) => ({ beat, laenge: 0.125, ton, vel: 100 });
  const eins = await z.seq.befehle({ platz: 2, befehle: [{ befehl: 'noten_neu', clip_id: clip.id, noten: [n(1)] }] }, 'andreas');
  assert.equal(eins.code, 200);
  const rev = z.projekt().rev;
  const zwei = await z.seq.befehle({ platz: 2, befehle: [{ befehl: 'noten_neu', clip_id: clip.id, noten: [n(1 + 1e-7), n(1, 38), n(2)] }] }, 'andreas');
  assert.equal(zwei.code, 200, JSON.stringify(zwei.j));
  assert.deepEqual(z.spur('Drums').clips[0].noten.map((x) => [x.beat, x.ton]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), [[1, 36], [1, 38], [2, 36]]);
  const nix = await z.seq.befehle({ platz: 2, befehle: [{ befehl: 'noten_neu', clip_id: clip.id, noten: [n(2)] }] }, 'andreas');
  assert.deepEqual([nix.code, nix.j.ohne_aenderung, nix.j.rev], [200, true, zwei.j.rev]);
  assert.ok(zwei.j.rev > rev);
});

test('review focus 3: twenty writes of clicks and texts, sent without awaiting, are all in the project at the end, in the order they were queued', async (t) => {
  const z = await aufbau(t);
  await z.seq.anlege({ platz: 1 }, 'andreas');
  await z.seq.folge({ platz: 1, name: 'Drums', geraet: 'kit:909' }, 'andreas');
  const clip = z.spur('Drums').clips[0];
  const n0 = z.schritte();
  const aufrufe = [];
  for (let i = 0; i < 10; i++) {
    aufrufe.push(z.seq.befehle({ platz: 1, befehle: [{ befehl: 'noten_neu', clip_id: clip.id, noten: [{ beat: i * 0.25, laenge: 0.125, ton: 36, vel: 100 }] }] }, 'andreas'));
    aufrufe.push(z.seq.text({ platz: 1, text: `folge Drums\nnoten h${i} ${50 + i} 1/16 ${'.'.repeat(i)}x${'.'.repeat(15 - i)}` }, 'cypher'));
  }
  const alle = await Promise.all(aufrufe);
  assert.deepEqual(alle.map((a) => a.code), Array(20).fill(200), JSON.stringify(alle.find((a) => a.code !== 200)?.j));
  const c = z.spur('Drums').clips[0];
  assert.equal(c.noten.filter((x) => x.ton === 36).length, 10, 'every click');
  for (let i = 0; i < 10; i++) assert.deepEqual(c.noten.filter((x) => x.ton === 50 + i).map((x) => x.beat), [i * 0.25], `text ${i}`);
  assert.equal(c.seq.zeilen.length, 10, 'ten lanes of the texts: no text overwrote the descriptor of another; the clicks stay a derived lane');
  assert.equal(z.schritte(), n0 + 20, 'twenty undo steps');
  const revs = alle.map((a) => a.j.rev);
  assert.deepEqual(revs, [...revs].sort((a, b) => a - b), 'answered in queue order');
});

test('a write past the queue (rev_veraltet) is retried once on a fresh project; a second miss is passed on', async (t) => {
  const z = await aufbau(t);
  await z.seq.anlege({ platz: 1 }, 'andreas');
  await z.seq.folge({ platz: 1, name: 'Drums', geraet: 'kit:909' }, 'andreas');
  const echt = z.zugang.aendern;
  let n = 0;
  const umweg = new SeqBereich(z.ctx, { ...z.zugang, aendern: async (d, q) => {
    if (n++ === 0) await echt({ rev: d.rev, label: 'other writer', befehle: [{ befehl: 'gruppenspur_neu', name: 'Other' }] }, 'andreas');   // not through the queue
    return echt(d, q);
  } }, { geraetInfo: info });
  const r = await umweg.text({ platz: 1, text: 'folge Drums\nnoten kick 36 1/16 x...x...' + '.'.repeat(8) }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(n, 2, 'planned and sent twice');
  assert.equal(z.spur('Drums').clips[0].noten.length, 2);
  assert.ok(z.projekt().gruppen.some((g) => g.name === 'Other'), 'the other write is still there');
  let m = 0;
  const immer = new SeqBereich(z.ctx, { ...z.zugang, aendern: async (d, q) => {
    m++;
    await echt({ rev: d.rev, label: 'other writer', befehle: [{ befehl: 'gruppenspur_neu', name: `Other${m}` }] }, 'andreas');
    return echt(d, q);
  } }, { geraetInfo: info });
  const e = await z.fehl(() => immer.text({ platz: 1, text: 'folge Drums\nnoten kick 36 1/16 x' + '.'.repeat(15) }, 'andreas'));
  assert.deepEqual([e.code, e.fehler], [409, 'rev_veraltet']);
  assert.equal(m, 2);
  // the queue goes on after a refusal
  assert.equal((await z.seq.text({ platz: 1, text: 'folge Drums\nnoten kick 36 1/16 x' + '.'.repeat(15) }, 'andreas')).code, 200);
});

test('a pattern Cypher makes, by /folge and by text, is muted; Andreas\' is audible; Cypher writing into an existing pattern leaves its mute', async (t) => {
  const z = await aufbau(t);
  await z.seq.anlege({ platz: 1 }, 'andreas');
  await z.seq.folge({ platz: 1, name: 'C1', geraet: 'kit:909' }, 'cypher');
  await z.seq.folge({ platz: 1, name: 'A1', geraet: 'kit:909' }, 'andreas');
  await z.seq.text({ platz: 1, text: 'folge C2 kit:909 1bar' }, 'cypher');
  await z.seq.text({ platz: 1, text: 'folge A2 kit:909 1bar' }, 'andreas');
  assert.deepEqual(['C1', 'A1', 'C2', 'A2'].map((n) => z.spur(n).mute), [true, false, true, false]);
  await z.seq.text({ platz: 1, text: 'folge A1\nnoten k 36 1/4 x...' }, 'cypher');
  assert.equal(z.spur('A1').mute, false);
  assert.equal(z.spur('A1').clips[0].noten.length, 1);
  // a device as an object works too; a bad text instrument is 400 with the reason
  const o = await z.seq.folge({ platz: 1, name: 'Obj', geraet: { art: 'intern', name: 'rb338', parameter: {} } }, 'andreas');
  assert.equal(o.code, 200);
  const e = await z.fehl(() => z.seq.folge({ platz: 1, name: 'X', geraet: 'surge' }, 'andreas'));
  assert.deepEqual([e.code, e.fehler], [400, 'argument_ungueltig']);
  const dup = await z.fehl(() => z.seq.folge({ platz: 1, name: 'a1', geraet: 'kit:909' }, 'andreas'));
  assert.deepEqual([dup.code, dup.fehler], [400, 'argument_ungueltig']);
  assert.match(dup.detail, /already has a pattern/);
});

test('text: refused as a whole before the first write; a new pattern with a bad third line leaves no pattern behind; nothing is half written', async (t) => {
  const z = await aufbau(t);
  await z.seq.anlege({ platz: 1 }, 'andreas');
  await z.seq.text({ platz: 1, text: 'folge Old kit:909 1bar\nnoten kick 36 1/16 x...x...x...x...' }, 'andreas');
  const rev = z.projekt().rev, ereignisse = z.ereignisse().length;
  const faelle = [
    ['bad third line, new pattern', 'folge New bk:bassmusik 1bar\nnoten bass 1/16 c1 . . . c1 . . . c1 . . . c1 . . .\nnoten hat 42 1/16 x...'],
    ['bad line in an existing pattern after a good one of a new pattern', 'folge New2 kit:909 1bar\nnoten kick 36 1/4 x...\nfolge Old\nnoten kick 36 1/16 x...'],
    ['unknown knob', 'folge New3 bk:bassmusik 1bar\nwerte Nope 1/4 .1 . . .'],
    ['syntax', 'folge New4 bk:bassmusik 1bar\nnoten bass 1/16 c1 . . q9'],
    ['no head', 'noten bass 1/16 c1'],
  ];
  for (const [name, text] of faelle) {
    const e = await z.fehl(() => z.seq.text({ platz: 1, text }, 'andreas'));
    assert.deepEqual([e.code, e.fehler], [400, 'argument_ungueltig'], `${name}: ${e.text}`);
    assert.ok(e.text.length > 10, name);
  }
  assert.equal(z.projekt().rev, rev);
  assert.equal(z.ereignisse().length, ereignisse, 'no event for a refusal');
  assert.deepEqual(z.projekt().spuren.map((s) => s.name), ['Old']);
  const u = await z.fehl(() => z.seq.text({ platz: 1, text: 'folge Old kit:909 1bar\nnoten kick 36 1/16 x...x...x...x...', x: 1 }, 'andreas'));
  assert.deepEqual([u.code, u.fehler], [400, 'argument_unbekannt']);
  const k = await z.fehl(() => z.seq.text({ platz: 1, text: 'folge K kit:909 1bar\nwerte k3 1/4 .1 . . .' }, 'andreas'));
  assert.deepEqual([k.code, k.fehler], [400, 'huellkurve_ziel']);
});

test('the gates: seq_fehlt without a deck, seq_belegt, kein_liveprojekt, ki_gestoppt for Cypher only', async (t) => {
  const z = await aufbau(t);
  const text = 'folge A kit:909 1bar';
  for (const f of [() => z.seq.folge({ platz: 1, name: 'A', geraet: 'kit:909' }, 'andreas'), () => z.seq.text({ platz: 1, text }, 'andreas'),
    () => z.seq.befehle({ platz: 1, befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] }, 'andreas'), () => z.seq.leere({ platz: 1 }, 'andreas')]) {
    const e = await z.fehl(f);
    assert.deepEqual([e.code, e.fehler], [409, 'seq_fehlt']);
  }
  await z.seq.anlege({ platz: 1 }, 'andreas');
  const b = await z.fehl(() => z.seq.anlege({ platz: 1 }, 'andreas'));
  assert.deepEqual([b.code, b.fehler], [409, 'seq_belegt']);
  const x = await z.fehl(() => z.seq.anlege({ platz: 1, extra: 1 }, 'andreas'));
  assert.deepEqual([x.code, x.fehler], [400, 'argument_unbekannt']);
  z.zustand.ki = true;
  const rev = z.projekt().rev;
  for (const f of [() => z.seq.anlege({ platz: 2 }, 'cypher'), () => z.seq.folge({ platz: 1, name: 'A', geraet: 'kit:909' }, 'cypher'), () => z.seq.text({ platz: 1, text }, 'cypher'),
    () => z.seq.befehle({ platz: 1, befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] }, 'cypher'), () => z.seq.leere({ platz: 1 }, 'cypher')]) {
    const e = await z.fehl(f);
    assert.deepEqual([e.code, e.fehler], [409, 'ki_gestoppt']);
  }
  assert.equal(z.projekt().rev, rev);
  assert.equal((await z.seq.text({ platz: 1, text }, 'andreas')).code, 200, 'Andreas still writes');
  z.zustand.zu = true;
  for (const f of [() => z.seq.anlege({ platz: 1 }, 'andreas'), () => z.seq.folge({ platz: 1, name: 'B', geraet: 'kit:909' }, 'andreas'), () => z.seq.text({ platz: 1, text }, 'andreas'),
    () => z.seq.befehle({ platz: 1, befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] }, 'andreas'), () => z.seq.leere({ platz: 1 }, 'andreas'), () => z.seq.geraet('s1')]) {
    const e = await z.fehl(f);
    assert.deepEqual([e.code, e.fehler], [409, 'kein_liveprojekt']);
  }
  assert.deepEqual(z.seq.stand().j, { 1: null, 2: null, 3: null, 4: null });
});

test('anlegen while deck/2 is open is kanal_offen, also through POST /proj/aendern with the raw command; while deck 2 plays it is deck_laeuft; leeren on an open channel is refused for cypher only; pattern writes are not gated', async (t) => {
  const z = await aufbau(t);
  ist(z.s, 'deck/2/trim', 0); ist(z.s, 'deck/2/fader', -6);
  const rev = z.projekt().rev;
  for (const q of ['andreas', 'cypher']) {
    const e = await z.fehl(() => z.seq.anlege({ platz: 2 }, q));
    assert.deepEqual([e.code, e.fehler], [409, 'kanal_offen'], q);
    assert.match(e.text, /deck\/2/);
    const r = await z.fehl(() => z.s.aendern({ rev, label: 'raw', befehle: [{ befehl: 'seq_anlegen', platz: 2 }] }, q));
    assert.deepEqual([r.code, r.fehler], [409, 'kanal_offen'], `raw ${q}`);
  }
  assert.equal(seqGruppe(z.projekt(), 2), undefined);
  assert.equal((await z.seq.anlege({ platz: 3 }, 'andreas')).code, 200, 'another place is not affected');
  ist(z.s, 'deck/2/fader', -200);
  z.spielt.add(2);
  const e = await z.fehl(() => z.seq.anlege({ platz: 2 }, 'andreas'));
  assert.deepEqual([e.code, e.fehler], [409, 'deck_laeuft']);
  z.spielt.clear();
  assert.equal((await z.seq.anlege({ platz: 2 }, 'cypher')).code, 200, 'closed and stopped: accepted');
  ist(z.s, 'deck/2/trim', 0); ist(z.s, 'deck/2/fader', 0);
  for (const q of ['andreas', 'cypher']) {
    assert.equal((await z.seq.text({ platz: 2, text: `folge ${q} kit:909 1bar\nnoten k 36 1/4 x...` }, q)).code, 200, `${q} writes a pattern on an open channel`);
  }
  const l = await z.fehl(() => z.seq.leere({ platz: 2 }, 'cypher'));
  assert.deepEqual([l.code, l.fehler], [409, 'kanal_offen']);
  assert.equal((await z.seq.leere({ platz: 2 }, 'andreas')).code, 200);
});

test('the routes are in the live area list', async (t) => {
  const z = await aufbau(t);
  const pfade = z.b.routen().map((r) => `${r.methode} ${r.pfad}`);
  for (const p of ['POST /seq/anlegen', 'POST /seq/leeren', 'POST /seq/folge', 'POST /seq/befehle', 'POST /seq/text', 'GET /seq/stand', 'GET /seq/geraet']) assert.ok(pfade.includes(p), p);
  for (const p of ['POST /seq/schritt']) assert.ok(!pfade.includes(p), `${p} is gone`);
  assert.ok(z.b.seq instanceof SeqBereich);
});

test('geraetInfo from the real sources: knobs of a graph with their names and start positions, the RB-338 targets by name, the sounds of a kit', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-seq-info-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bkOrdner = path.join(tmp, 'bk'), kitOrdner = path.join(tmp, 'kits');
  fs.mkdirSync(bkOrdner); fs.mkdirSync(path.join(kitOrdner, 'k909'), { recursive: true });
  fs.writeFileSync(path.join(bkOrdner, 'bassx.json'), JSON.stringify({ knoten: [
    { id: 1, art: 'regler', nr: 3, min: 20, max: 2000, log: 1, vorgabe: 0.7 }, { id: 2, art: 'regler', nr: 4, min: 0, max: 1 }], regler_namen: { 3: 'Cutoff', 4: 'Resonance' } }));
  fs.writeFileSync(path.join(kitOrdner, 'k909', 'kit.json'), JSON.stringify({ schema: 1, klaenge: [{ note: 36, name: 'bd:0', datei: 'a.wav' }, { note: 38, name: 'sd:0', datei: 'b.wav' }] }));
  const vorher = [process.env.CYPHERDJ_BK_ORDNER, process.env.CYPHERDJ_KIT_ORDNER];
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner; process.env.CYPHERDJ_KIT_ORDNER = kitOrdner;
  t.after(() => { for (const [k, v] of [['CYPHERDJ_BK_ORDNER', vorher[0]], ['CYPHERDJ_KIT_ORDNER', vorher[1]]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const b = geraetInfo({ art: 'intern', name: 'bk', graph: 'bassx', parameter: {} });
  assert.equal(b.art, 'bk');
  assert.deepEqual(b.regler.map((r) => [r.nr, r.name, r.vorgabe]), [[3, 'Cutoff', 0.7], [4, 'Resonance', 0.5]]);
  const rb = geraetInfo({ art: 'intern', name: 'rb338', parameter: {} });
  assert.deepEqual(rb.regler.map((r) => r.nr), ['lautstaerke', 'cutoff', 'resonanz', 'env_mod'], 'the four targets of an RB-338 envelope, by name');
  assert.ok(rb.regler.every((r) => typeof r.name === 'string' && r.vorgabe >= 0 && r.vorgabe <= 1));
  assert.deepEqual(geraetInfo({ art: 'intern', name: 'kit', kit: 'k909' }).klaenge, [{ ton: 36, name: 'bd:0' }, { ton: 38, name: 'sd:0' }]);
  assert.deepEqual(geraetInfo({ art: 'intern', name: 'kit', kit: 'missing' }), { art: 'kit', regler: [], klaenge: [] });
  assert.deepEqual(geraetInfo({ art: 'intern', name: 'bk', graph: 'missing', parameter: {} }).regler, []);
  assert.equal(geraetInfo({ art: 'wirt', name: 'surge', slot: 1 }).art, 'anderes');
});
