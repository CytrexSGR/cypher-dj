// 1.14 comping, slice 1, task 1: take lanes in the project model (Take, Spur.takes, validation, counting, ids, counters).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  neuesProjekt, pruefeProjekt, pruefeFehler, neueId, sucheClip, sucheTakeClip, setzeFehlendeZaehler, entferneLeereTakes,
  MAX_CLIPS, MAX_TAKES_PRO_SPUR, TAKE_NAME_MAX,
} from '../project/model.ts';
import { normalisiere } from '../project/storage.ts';
import { hebeZaehler } from '../project/history.ts';
import { wende } from '../project/patch.ts';
import { fuehreAus } from '../project/commands.ts';
import { specProjekt, SHA_A } from './support/project.mjs';

const clip = (id, extra = {}) => ({
  id, art: 'audio', name: id, start_beat: 0, laenge_beats: 4, quelle: { sha256: SHA_A, pfad_hinweis: '/abs/x.wav' }, dekodiert: 'fertig',
  offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, ...extra,
});
const take = (id, clips = [], extra = {}) => ({ id, name: `Take ${id}`, clips, ...extra });
const spur = (n, extra = {}) => ({ id: `s${n}`, nr: n, name: `T${n}`, farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [], von: 'andreas', ...extra });
const projekt = (spuren) => { const p = neuesProjekt('T'); p.spuren = spuren; return p; };
const mitTake = (t = take('t1', [clip('c1')])) => projekt([spur(1, { takes: [t] })]);
const bytes = (p) => JSON.stringify(normalisiere(p));

// Golden bytes: serialised with the code of the commit before 1.14 T1 (git show 68b5f842^), empty project and the D1 example after load.
const GOLD_LEER = "{\"format\":\"cypherdj-projekt/2\",\"gruppen\":[],\"loop\":{\"an\":false,\"bis_beat\":32,\"von_beat\":0},\"master\":{\"fader_db\":0},\"metronom\":{\"an\":false,\"pegel_db\":-12,\"ziel\":\"master\"},\"naechste_id\":{\"clip\":1,\"gruppe\":1,\"spur\":1},\"naechste_noten_id\":1,\"name\":\"E\",\"rev\":0,\"spuren\":[],\"taktart\":[4,4],\"tempo_bpm\":120,\"wiedergabe_rev\":0}";
const GOLD_D1 = "{\"format\":\"cypherdj-projekt/2\",\"gruppen\":[],\"loop\":{\"an\":true,\"bis_beat\":32,\"von_beat\":0},\"master\":{\"fader_db\":0},\"metronom\":{\"an\":false,\"pegel_db\":-12,\"ziel\":\"master\"},\"naechste_id\":{\"clip\":3,\"gruppe\":1,\"spur\":4},\"naechste_noten_id\":2,\"name\":\"First Track\",\"rev\":17,\"spuren\":[{\"art\":\"audio\",\"clips\":[{\"art\":\"audio\",\"dekodiert\":\"fertig\",\"fade_aus_beats\":0,\"fade_ein_beats\":0,\"gain_db\":0,\"id\":\"c1\",\"laenge_beats\":1,\"name\":\"kick\",\"offset_s\":0,\"quelle\":{\"pfad_hinweis\":\"/abs/kick.wav\",\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},\"start_beat\":0}],\"fader_db\":0,\"farbe\":\"#e0563b\",\"id\":\"s1\",\"mute\":false,\"name\":\"Kick\",\"nr\":1,\"pan\":0,\"solo\":false,\"von\":\"andreas\"},{\"art\":\"instrument\",\"clips\":[{\"art\":\"midi\",\"id\":\"c2\",\"laenge_beats\":16,\"name\":\"bassline\",\"noten\":[{\"beat\":0,\"id\":\"n1\",\"laenge\":0.5,\"ton\":36,\"vel\":100}],\"start_beat\":0}],\"fader_db\":0,\"farbe\":\"#3b8de0\",\"geraet\":{\"art\":\"intern\",\"name\":\"rb338\",\"parameter\":{}},\"id\":\"s2\",\"mute\":false,\"name\":\"Bass\",\"nr\":2,\"pan\":0,\"solo\":false,\"von\":\"andreas\"},{\"art\":\"instrument\",\"clips\":[],\"fader_db\":0,\"farbe\":\"#9b59d0\",\"freeze\":null,\"geraet\":{\"art\":\"wirt\",\"name\":\"surge\",\"slot\":1},\"id\":\"s3\",\"mute\":false,\"name\":\"Lead\",\"nr\":3,\"pan\":0,\"solo\":false,\"von\":\"andreas\"}],\"taktart\":[4,4],\"tempo_bpm\":124,\"wiedergabe_rev\":15}";

test('old file round trip: golden bytes of the pre-1.14 code, and a reload keeps them (no takes key, no take counter)', () => {
  const leer = neuesProjekt('E');
  const d1 = pruefeProjekt(specProjekt()).projekt;
  const rout = projekt([spur(1, { ausgang: { art: 'gruppe', id: 'g1' }, automation: [{ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 16, wert: -30 }] }] }),
    spur(2, { clips: [clip('c1')] })]);
  rout.gruppen = [{ id: 'g1', nr: 1, name: 'G', farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false }];
  const routing = pruefeProjekt(rout);
  assert.ok(routing.projekt, JSON.stringify(routing));
  assert.equal(bytes(leer), GOLD_LEER, 'empty project equals the pre-1.14 bytes');
  assert.equal(bytes(d1), GOLD_D1, 'D1 example equals the pre-1.14 bytes');
  for (const [name, p] of [['empty', leer], ['d1', d1], ['routing+automation', routing.projekt]]) {
    const r = pruefeProjekt(JSON.parse(bytes(p)));
    assert.ok(r.projekt, `${name}: ${JSON.stringify(r)}`);
    assert.equal(bytes(r.projekt), bytes(p), `${name}: reload is stable`);
    assert.ok(!bytes(r.projekt).includes('takes'), `${name}: no takes key`);
    assert.equal(r.projekt.naechste_id.take, undefined, `${name}: no take counter`);
  }
});

test('takes validate: valid take loads, empty list loads without the key, each rejection from one changed field', () => {
  assert.equal(pruefeFehler(mitTake()), null);
  assert.equal(pruefeFehler(mitTake(take('t1', [clip('c1')], { art: 'original' }))), null, 'art original is valid');
  const leer = projekt([spur(1, { takes: [] })]);
  const r = pruefeProjekt(leer);
  assert.ok(r.projekt, JSON.stringify(r));
  assert.ok(!('takes' in r.projekt.spuren[0]), 'empty takes list is dropped on load');
  assert.ok(!bytes(r.projekt).includes('takes'));
  const faelle = [
    ['id x1', (p) => { p.spuren[0].takes[0].id = 'x1'; }, /takes\[0\]\.id/],
    ['id t', (p) => { p.spuren[0].takes[0].id = 't'; }, /takes\[0\]\.id/],
    ['name empty', (p) => { p.spuren[0].takes[0].name = ''; }, /takes\[0\]\.name/],
    ['name 65 chars', (p) => { p.spuren[0].takes[0].name = 'x'.repeat(TAKE_NAME_MAX + 1); }, /takes\[0\]\.name/],
    ['art other', (p) => { p.spuren[0].takes[0].art = 'comp'; }, /takes\[0\]\.art/],
    ['unknown field', (p) => { p.spuren[0].takes[0].zusatz = 1; }, /zusatz/],
    ['clips missing', (p) => { delete p.spuren[0].takes[0].clips; }, /clips/],
    ['midi clip', (p) => { p.spuren[0].takes[0].clips = [{ id: 'c1', art: 'midi', name: 'm', start_beat: 0, laenge_beats: 4, noten: [] }]; }, /takes\[0\]\.clips\[0\]\.art: passt nicht/],
    ['broken audio clip', (p) => { p.spuren[0].takes[0].clips[0].gain_db = 99; }, /gain_db/],
    ['take id twice', (p) => { p.spuren[0].takes.push(take('t1')); }, /takes\[1\]\.id: duplicate \(t1\)/],
    ['take on instrument track', (p) => {
      Object.assign(p.spuren[0], { art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} }, clips: [] });
      p.spuren[0].takes[0].clips = [];
    }, /spuren\[0\]\.takes: unbekanntes Feld/],
    [`${MAX_TAKES_PRO_SPUR + 1} takes`, (p) => {
      p.spuren[0].takes = Array.from({ length: MAX_TAKES_PRO_SPUR + 1 }, (_, i) => take(`t${i + 1}`));
    }, /at most 32 takes per track/],
  ];
  for (const [name, aendere, muster] of faelle) {
    const p = mitTake(); aendere(p);
    const f = pruefeFehler(p);
    assert.match(f ?? 'kein Fehler', muster, `${name}: ${f}`);
  }
  const voll = projekt([spur(1, { takes: Array.from({ length: MAX_TAKES_PRO_SPUR }, (_, i) => take(`t${i + 1}`)) })]);
  assert.equal(pruefeFehler(voll), null, 'negative control: exactly the maximum is valid');
  const alt = specProjekt(); alt.spuren[0].takes = [take('t1', [clip('c9')])];
  assert.match(pruefeFehler(alt) ?? '', /takes: unknown field \(takes exist only from/, 'a /1 file with takes is refused');
});

test('take clips count: 4095 main clips plus 2 take clips exceed MAX_CLIPS, plus 1 does not', () => {
  const haupt = Array.from({ length: MAX_CLIPS - 1 }, (_, i) => clip(`c${i + 1}`, { start_beat: i }));
  const p1 = projekt([spur(1, { clips: haupt, takes: [take('t1', [clip('c9001')])] })]);
  assert.equal(pruefeFehler(p1), null, 'negative control: exactly MAX_CLIPS is valid');
  const p2 = projekt([spur(1, { clips: haupt, takes: [take('t1', [clip('c9001'), clip('c9002')])] })]);
  assert.match(pruefeFehler(p2) ?? '', /höchstens 4096 Clips/);
});

test('ids unique: a take clip id equal to a main clip id (or to another take clip id) is refused', () => {
  const p = projekt([spur(1, { clips: [clip('c1')], takes: [take('t1', [clip('c2')])] })]);
  assert.equal(pruefeFehler(p), null, 'negative control: distinct ids are valid');
  p.spuren[0].takes[0].clips[0].id = 'c1';
  assert.match(pruefeFehler(p) ?? '', /takes\[0\]\.clips\[0\]\.id: duplicate \(c1\)/);
  const q = projekt([spur(1, { takes: [take('t1', [clip('c2')]), take('t2', [clip('c2')])] })]);
  assert.match(pruefeFehler(q) ?? '', /takes\[1\]\.clips\[0\]\.id: duplicate \(c2\)/);
  const r = projekt([spur(1, { takes: [take('t1', [clip('c2')])] }), spur(2, { takes: [take('t1', [clip('c3')])] })]);
  assert.match(pruefeFehler(r) ?? '', /spuren\[1\]\.takes\[0\]\.id: duplicate \(t1\)/, 'take ids are project wide');
});

test('counters: neueId take is t<n> with its own counter, written only with the first use', () => {
  const p = projekt([spur(1)]);
  setzeFehlendeZaehler(p);
  assert.equal(p.naechste_id.take, undefined, 'load does not create the take counter');
  assert.equal(neueId(p, 'take'), 't1');
  assert.equal(p.naechste_id.take, 2);
  assert.equal(neueId(p, 'take'), 't2');
  assert.equal(pruefeFehler({ ...mitTake(), naechste_id: { take: 3 } }), null, 'naechste_id.take is a known key');
  assert.match(pruefeFehler({ ...mitTake(), naechste_id: { take: 0 } }) ?? '', /naechste_id\.take/);
  const q = mitTake(take('t7', [clip('c1')])); setzeFehlendeZaehler(q);
  assert.equal(q.naechste_id.take, undefined, 'setzeFehlendeZaehler never creates it');
  assert.equal(neueId(q, 'take'), 't8', 'a living take id lifts the counter');
});

test('a take clip with a real warp object validates in /2', () => {
  const warp = { an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0 };
  assert.equal(pruefeFehler(mitTake(take('t1', [clip('c1', { warp: null })]))), null, 'warp null');
  const p = mitTake(take('t1', [clip('c1', { warp })]));
  const f = pruefeFehler(p);
  assert.equal(f, null, f);
  p.spuren[0].takes[0].clips[0].warp = { ...warp, modus: 'texture' };
  assert.match(pruefeFehler(p) ?? '', /takes\[0\]\.clips\[0\]\.warp/, 'negative control: a broken warp object is refused inside a take');
});

test('setzeFehlendeZaehler keeps an existing take counter on load (20 stays 20)', () => {
  const p = mitTake(take('t3', [clip('c1')]));
  p.naechste_id = { spur: 2, clip: 2, gruppe: 1, take: 20 };
  const r = pruefeProjekt(p);
  assert.ok(r.projekt, JSON.stringify(r));
  assert.equal(r.projekt.naechste_id.take, 20);
  assert.equal(neueId(r.projekt, 'take'), 't20');
});

test('ids unique across lists: neueId clip and setzeFehlendeZaehler walk take clips (AK13)', () => {
  const p = projekt([spur(1, { clips: [clip('c2')], takes: [take('t1', [clip('c900')])] })]);
  delete p.naechste_id;                                  // a file without counters
  const r = pruefeProjekt(p);
  assert.ok(r.projekt, JSON.stringify(r));
  assert.equal(r.projekt.naechste_id.clip, 901, 'the load sets the clip counter above the take clip');
  assert.equal(neueId(r.projekt, 'clip'), 'c901');
  const q = projekt([spur(1, { clips: [clip('c2')], takes: [take('t1', [clip('c900')])] })]);
  assert.equal(neueId(q, 'clip'), 'c901', 'without a counter neueId counts the take clips');
  const s = pruefeProjekt(projekt([spur(1, { clips: [clip('c2')], takes: [take('t1', [clip('c900')])] })])).projekt;
  const w = fuehreAus(s, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 8, laenge_beats: 4, sha256: SHA_A, pfad_hinweis: '/x.wav' });
  const neu = w.projekt.spuren[0].clips.at(-1).id;
  assert.ok(Number(neu.slice(1)) > 900, `clip_neu after loading: ${neu}`);
});

test('hebeZaehler: whole takes array, one take, one take clip, a whole track carrying takes', () => {
  const eintrag = (vor) => ({ rev: 1, zeit: '', quelle: 'andreas', label: 'x', art: 'aendern', bezug: null, vor, zurueck: [] });
  const frisch = () => projekt([spur(1)]);
  const FAELLE = {
    'takes array': [{ op: 'add', pfad: '/spuren/s1/takes', wert: [take('t5', [clip('c900')])] }],
    'one take': [{ op: 'add', pfad: '/spuren/s1/takes/t5', wert: take('t5', [clip('c900')]) }],
    'one take clip': [{ op: 'add', pfad: '/spuren/s1/takes/t5/clips/c900', wert: clip('c900') }],
    'whole track': [{ op: 'add', pfad: '/spuren/s9', wert: spur(9, { takes: [take('t5', [clip('c900')])] }) }],
  };
  for (const [name, vor] of Object.entries(FAELLE)) {
    const p = frisch();
    hebeZaehler(p, [eintrag(vor)]);
    assert.ok(Number(neueId(p, 'clip').slice(1)) > 900, `${name}: clip counter`);
    assert.ok(Number(neueId(p, 'take').slice(1)) > 5, `${name}: take counter`);
  }
  const plain = frisch();
  hebeZaehler(plain, [eintrag([{ op: 'replace', pfad: '/spuren/s1/name', wert: 'x' }])]);
  assert.equal(plain.naechste_id.take, undefined, 'negative control: no take id, no take counter');
  // a patch that really adds the take clip (patch paths go by id)
  const p = projekt([spur(1, { takes: [take('t1')] })]);
  const w = wende(p, [{ op: 'add', pfad: '/spuren/s1/takes/t1/clips/c900', wert: clip('c900') }]);
  hebeZaehler(w, [eintrag([{ op: 'add', pfad: '/spuren/s1/takes/t1/clips/c900', wert: clip('c900') }])]);
  assert.ok(Number(neueId(w, 'clip').slice(1)) > 900);
});

test('sucheClip ignores takes, sucheTakeClip finds the take clip', () => {
  const p = projekt([spur(1, { clips: [clip('c1')], takes: [take('t1', [clip('c2')])] })]);
  assert.equal(sucheClip(p, 'c2'), undefined);
  assert.ok(sucheClip(p, 'c1'), 'negative control: main clip is found');
  const f = sucheTakeClip(p, 'c2');
  assert.deepEqual([f.spur.id, f.take.id, f.clip.id], ['s1', 't1', 'c2']);
  assert.equal(sucheTakeClip(p, 'c1'), null);
  assert.equal(sucheTakeClip(p, 'c99'), null);
});

test('tempo_setzen with takes: does not throw, take clips unchanged', () => {
  const p = pruefeProjekt(projekt([spur(1, { clips: [clip('c1')], takes: [take('t1', [clip('c2', { warp: null })])] })])).projekt;
  const vor = JSON.stringify(p.spuren[0].takes);
  const w = fuehreAus(p, { befehl: 'tempo_setzen', bpm: 133 });
  assert.equal(w.projekt.tempo_bpm, 133);
  assert.equal(JSON.stringify(w.projekt.spuren[0].takes), vor);
});

test('entferneLeereTakes drops an empty takes list (the helper only; commands must call it)', () => {
  const p = mitTake();
  const w = wende(p, [{ op: 'remove', pfad: '/spuren/s1/takes/t1' }]);
  assert.deepEqual(w.spuren[0].takes, [], 'negative control: patch alone leaves the empty list');
  entferneLeereTakes(w);
  assert.ok(!('takes' in w.spuren[0]));
  const r = pruefeProjekt(projekt([spur(1, { takes: [take('t1', [clip('c1')])] }), spur(2, { takes: [] })])).projekt;
  assert.ok('takes' in r.spuren[0] && !('takes' in r.spuren[1]), 'only the empty list is dropped');
});
