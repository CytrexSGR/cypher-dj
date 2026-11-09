// 1.14 comping, slice 1, task 2: take lane commands take_neu, take_umbenennen, take_loeschen (reasons, neutrality, undo, empty list).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, MAX_TAKES_PRO_SPUR, TAKE_NAME_MAX } from '../project/model.ts';
import { normalisiere } from '../project/storage.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { tmpOrdner, SHA_A } from './support/project.mjs';

const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 80)}`);
const clip = (id) => ({ id, art: 'audio', name: id, start_beat: 0, laenge_beats: 4, quelle: { sha256: SHA_A, pfad_hinweis: '/abs/x.wav' },
  dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
// `dekodiert` is derived state and never part of a patch (spec 6.6); the session sets it after undo, so it is left out of the comparison
const ohneDek = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'dekodiert' ? undefined : v)));
const bytes = (p) => JSON.stringify(normalisiere(p));
// audio track s1 with a main clip c1, instrument track s2
function projekt() {
  let p = neuesProjekt('T');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', name: 'I' }).projekt;
  p = structuredClone(p);
  p.spuren[0].clips = [clip('c1')];
  p.naechste_id = { ...p.naechste_id, clip: 2 };
  return pruefeProjekt(JSON.parse(bytes(p))).projekt;
}
const mitTakeClip = () => {
  const p = projekt();
  p.spuren[0].takes = [{ id: 't1', name: 'Original', art: 'original', clips: [clip('c2')] }, { id: 't2', name: 'Take 1', clips: [clip('c3')] }];
  p.naechste_id = { ...p.naechste_id, clip: 4, take: 3 };
  const g = pruefeProjekt(JSON.parse(bytes(p)));
  assert.ok(g.projekt, JSON.stringify(g));
  return g.projekt;
};

test('take_neu: new project gets Take 1 with id t1, empty clips, neutral for playback', () => {
  const p = projekt();
  const r = fuehreAus(p, { befehl: 'take_neu', spur_id: 's1' });
  assert.deepEqual(r.projekt.spuren[0].takes, [{ id: 't1', name: 'Take 1', clips: [] }]);
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.projekt.spuren[0].clips, p.spuren[0].clips);
  const r2 = fuehreAus(r.projekt, { befehl: 'take_neu', spur_id: 's1', name: 'Verse' });
  assert.deepEqual(r2.projekt.spuren[0].takes.map((t) => [t.id, t.name]), [['t1', 'Take 1'], ['t2', 'Verse']]);
  assert.equal(r2.betrifft_wiedergabe, false);
});

test('take_neu: default number counts only takes without art (the Original lane does not count)', () => {
  const p = mitTakeClip();   // t1 is the original lane, t2 "Take 1"
  const r = fuehreAus(p, { befehl: 'take_neu', spur_id: 's1' });
  assert.equal(r.projekt.spuren[0].takes.at(-1).name, 'Take 2');
  assert.equal(r.projekt.spuren[0].takes.at(-1).id, 't3');
});

test('take_neu: instrument track, unknown track, bad names, extra fields', () => {
  const p = projekt();
  lehntAb(p, { befehl: 'take_neu', spur_id: 's2' }, 'take_nur_audio');
  lehntAb(p, { befehl: 'take_neu', spur_id: 's9' }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'take_neu', spur_id: 's1', name: '' }, 'take_name_ungueltig');
  lehntAb(p, { befehl: 'take_neu', spur_id: 's1', name: '   ' }, 'take_name_ungueltig');
  lehntAb(p, { befehl: 'take_neu', spur_id: 's1', name: 'x'.repeat(TAKE_NAME_MAX + 1) }, 'take_name_ungueltig');
  lehntAb(p, { befehl: 'take_neu', spur_id: 's1', name: 5 }, 'take_name_ungueltig');
  lehntAb(p, { befehl: 'take_neu', spur_id: 's1', bogus: 1 }, 'argument_unbekannt');
  assert.ok(fuehreAus(p, { befehl: 'take_neu', spur_id: 's1', name: 'x'.repeat(TAKE_NAME_MAX) }).projekt, 'negative control: 64 characters pass');
});

test('take_neu: the 33rd take on a track is takes_voll', () => {
  let p = projekt();
  for (let i = 0; i < MAX_TAKES_PRO_SPUR; i++) p = fuehreAus(p, { befehl: 'take_neu', spur_id: 's1' }).projekt;
  assert.equal(p.spuren[0].takes.length, MAX_TAKES_PRO_SPUR);
  lehntAb(p, { befehl: 'take_neu', spur_id: 's1' }, 'takes_voll');
});

test('take_umbenennen: renames, keeps art and clips, neutral; reasons', () => {
  const p = mitTakeClip();
  const r = fuehreAus(p, { befehl: 'take_umbenennen', spur_id: 's1', take_id: 't1', name: 'Rec A' });
  assert.deepEqual(r.projekt.spuren[0].takes[0], { id: 't1', name: 'Rec A', art: 'original', clips: [clip('c2')] });
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.projekt.spuren[0].clips, p.spuren[0].clips);
  lehntAb(p, { befehl: 'take_umbenennen', spur_id: 's1', take_id: 't9', name: 'x' }, 'take_unbekannt');
  lehntAb(p, { befehl: 'take_umbenennen', spur_id: 's9', take_id: 't1', name: 'x' }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'take_umbenennen', spur_id: 's1', take_id: 't1', name: '' }, 'take_name_ungueltig');
  lehntAb(p, { befehl: 'take_umbenennen', spur_id: 's1', take_id: 't1' }, 'take_name_ungueltig');
  lehntAb(p, { befehl: 'take_umbenennen', spur_id: 's2', take_id: 't1', name: 'x' }, 'take_unbekannt');
});

test('take_loeschen: removes the take, leaves s.clips deep-equal, neutral; unknown id', () => {
  const p = mitTakeClip();
  const r = fuehreAus(p, { befehl: 'take_loeschen', spur_id: 's1', take_id: 't2' });
  assert.deepEqual(r.projekt.spuren[0].takes.map((t) => t.id), ['t1']);
  assert.deepEqual(r.projekt.spuren[0].clips, p.spuren[0].clips);
  assert.equal(r.betrifft_wiedergabe, false);
  lehntAb(p, { befehl: 'take_loeschen', spur_id: 's1', take_id: 't9' }, 'take_unbekannt');
  lehntAb(p, { befehl: 'take_loeschen', spur_id: 's2', take_id: 't1' }, 'take_unbekannt');
  lehntAb(p, { befehl: 'take_loeschen', spur_id: 's1' }, 'argument_ungueltig');
});

test('clip_loeschen with a take clip id: 404 clip_unbekannt, project unchanged (AK11)', () => {
  const p = mitTakeClip(); const vorher = bytes(p);
  lehntAb(p, { befehl: 'clip_loeschen', clip_id: 'c3' }, 'clip_unbekannt');
  assert.equal(bytes(p), vorher);
  assert.equal(grundCode('clip_unbekannt'), 404);
});

test('reason codes map to HTTP: take_unbekannt 404, takes_voll 409, take_nur_audio 409, take_name_ungueltig 400', () => {
  assert.deepEqual(['take_unbekannt', 'takes_voll', 'take_nur_audio', 'take_name_ungueltig', 'comp_leer'].map(grundCode), [404, 409, 409, 400, 400]);
});

test('delete the last take: no takes key (serialised bytes), undo restores deep-equal, redo drops the key again', (t) => {
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { zeitgeber: false });
  const meta = { quelle: 'andreas', label: 'T' };
  let p = projekt();
  p = aendere(v, p, [{ befehl: 'take_neu', spur_id: 's1', name: 'Only' }], meta).projekt;
  const mit = structuredClone(p);
  assert.equal(p.spuren[0].takes.length, 1);
  const w = aendere(v, p, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't1' }], meta);
  assert.ok(!('takes' in w.projekt.spuren[0]), 'no takes key in the draft');
  assert.ok(!bytes(w.projekt).includes('"takes"'), 'no takes key in the serialised file');
  const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
  assert.deepEqual(u.projekt.spuren[0].takes, mit.spuren[0].takes);
  assert.deepEqual(u.projekt.spuren, mit.spuren);
  const r = wiederholen(v, u.projekt, { quelle: 'andreas' });
  assert.ok(!('takes' in r.projekt.spuren[0]));
  assert.ok(!bytes(r.projekt).includes('"takes"'), 'redo: no takes key (byte check)');
});

test('undo of take_loeschen restores the take with its clips deep-equal', (t) => {
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { zeitgeber: false });
  const meta = { quelle: 'andreas', label: 'T' };
  const p = mitTakeClip();
  const w = aendere(v, p, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't2' }], meta);
  const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
  assert.deepEqual(ohneDek(u.projekt.spuren[0].takes), ohneDek(p.spuren[0].takes));
  assert.deepEqual(ohneDek(u.projekt.spuren[0].clips), ohneDek(p.spuren[0].clips));
  assert.equal(u.betrifft_wiedergabe, false);
});

// --- routes: takes_zahl in the short answers, HTTP codes over POST /proj/aendern (session harness) ---
const { stapel } = await import('./support/media_library.mjs');
const { ruf, CYPHER } = await import('./support/proj_stack.mjs');

test('takes_zahl: short open answer and ?noten=zahl report a count per track, no key without takes, never the list', { timeout: 60_000 }, async (t) => {
  const { url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Zahl' }, CYPHER);
  const a = await ruf(url, 'POST', '/proj/aendern?antwort=kurz', { rev: 0, label: 'Takes', befehle: [{ befehl: 'spur_neu', art: 'audio' },
    { befehl: 'spur_neu', art: 'audio' }, { befehl: 'take_neu', spur_id: 's1' }, { befehl: 'take_neu', spur_id: 's1' }] }, CYPHER);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const gesehen = [
    (await ruf(url, 'POST', '/proj/oeffnen?antwort=kurz', { slug: 'zahl' }, CYPHER)).j.spuren,
    (await ruf(url, 'GET', '/proj/aktuell?noten=zahl')).j.projekt.spuren,
  ];
  for (const spuren of gesehen) {
    assert.equal(spuren[0].takes_zahl, 2);
    assert.ok(!('takes' in spuren[0]), 'the list is not in the short answer');
    assert.ok(!('takes_zahl' in spuren[1]) && !('takes' in spuren[1]), 'a track without takes has neither key');
  }
  // negative control: the full answer (the page) still carries the whole list
  const voll = await ruf(url, 'GET', '/proj/aktuell');
  assert.equal(voll.j.projekt.spuren[0].takes.length, 2);
});

test('HTTP codes over POST /proj/aendern: take_unbekannt 404, take_name_ungueltig 400, takes_voll 409', { timeout: 60_000 }, async (t) => {
  const { url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Codes' }, CYPHER);
  let rev = (await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, CYPHER)).j.rev;
  const aendere = (befehle) => ruf(url, 'POST', '/proj/aendern', { rev, label: 'x', befehle }, CYPHER);
  const u = await aendere([{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't9' }]);
  assert.deepEqual([u.code, u.j.fehler], [404, 'take_unbekannt']);
  const n = await aendere([{ befehl: 'take_neu', spur_id: 's1', name: '' }]);
  assert.deepEqual([n.code, n.j.fehler], [400, 'take_name_ungueltig']);
  const ok = await aendere(Array.from({ length: MAX_TAKES_PRO_SPUR }, () => ({ befehl: 'take_neu', spur_id: 's1' })));
  assert.equal(ok.code, 200, JSON.stringify(ok.j).slice(0, 200)); rev = ok.j.projekt.rev;
  const v = await aendere([{ befehl: 'take_neu', spur_id: 's1' }]);
  assert.deepEqual([v.code, v.j.fehler], [409, 'takes_voll']);
});

// --- Task 3: comp_waehlen (spec R4, R5, R6, AK5 to AK7) -------------------------------------------------------------------------------
const { MAX_BEAT } = await import('../project/model.ts');
const { COMP_FADE_S } = await import('../project/commands.ts');
const BPM = 120, FADE = 0.004 * BPM / 60, SEK = 60 / BPM;   // one beat is 0.5 s at 120 bpm
const SHA = (c) => c.toLowerCase().repeat(64);   // the letters A, B, C stand for the hex digits a, b, c
const au = (id, sha, start, laenge, offset, extra = {}) => ({ id, art: 'audio', name: id, start_beat: start, laenge_beats: laenge,
  quelle: { sha256: SHA(sha), pfad_hinweis: `/abs/${sha}.wav` }, dekodiert: 'fertig', offset_s: offset, gain_db: 0,
  fade_ein_beats: 0, fade_aus_beats: 0, ...extra });
const warpO = (versatz, extra = {}) => ({ an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: versatz, quelle: 'takte',
  transpose_st: 0, detune_ct: 0, ...extra });
// track s1 with `haupt` on the main lane and `takes` ([id, clips]); ids of the clips given here must be unique
function compProjekt(haupt, takes) {
  let p = neuesProjekt('C');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = structuredClone(p);
  p.spuren[0].clips = haupt;
  p.spuren[0].takes = takes.map(([id, clips]) => ({ id, name: `Take ${id}`, clips }));
  p.naechste_id = { ...p.naechste_id, clip: 100, take: 10 };
  const g = pruefeProjekt(JSON.parse(bytes(p)));
  assert.ok(g.projekt, JSON.stringify(g));
  return g.projekt;
}
const comp = (take_id, von_beat, bis_beat) => ({ befehl: 'comp_waehlen', spur_id: 's1', take_id, von_beat, bis_beat });
const kurz = (c) => [c.start_beat, c.laenge_beats, c.quelle.sha256[0].toUpperCase()];
const nah = (a, b, wo) => assert.ok(Math.abs(a - b) < 1e-9, `${wo}: ${a} vs ${b}`);
const mainDreiZwei = () => compProjekt([au('m1', 'C', 0, 8, 0)],
  [['t1', [au('c1', 'A', 0, 8, 0)]], ['t2', [au('c2', 'B', 0, 8, 1)]], ['t3', [au('c3', 'C', 0, 8, 0)]]]);

test('COMP_FADE_S is 4 ms', () => { assert.equal(COMP_FADE_S, 0.004); });

test('comp_waehlen: take 2 over [3,5) on a main lane holding take 3 gives take3, take2, take3 with 4 ms seam fades', () => {
  const p = mainDreiZwei();
  const r = fuehreAus(p, comp('t2', 3, 5));
  const c = r.projekt.spuren[0].clips;
  assert.deepEqual(c.map(kurz), [[0, 3, 'C'], [3, 2, 'B'], [5, 3, 'C']]);
  nah(c[0].offset_s, 0, 'first part offset'); nah(c[1].offset_s, 1 + 3 * SEK, 'take 2 offset + 3 beats');
  nah(c[2].offset_s, 5 * SEK, 'third part offset + 5 beats');
  nah(c[0].fade_aus_beats, FADE, 'main fade out at 3'); nah(c[1].fade_ein_beats, FADE, 'clone fade in at 3');
  nah(c[1].fade_aus_beats, FADE, 'clone fade out at 5'); nah(c[2].fade_ein_beats, FADE, 'main fade in at 5');
  assert.equal(c[0].fade_ein_beats, 0); assert.equal(c[2].fade_aus_beats, 0);
  assert.equal(r.betrifft_wiedergabe, true);
  assert.equal(new Set(c.map((x) => x.id)).size, 3, 'ids unique');
  assert.ok(!['c1', 'c2', 'c3', 'm1'].includes(c[1].id), 'the clone has a fresh id');
  assert.deepEqual(r.projekt.spuren[0].takes, p.spuren[0].takes, 'the take lanes are not touched');
});

test('comp_waehlen: the clone keeps every field of the take clip, entstehung and name included', () => {
  const ent = { art: 'strom', strom: 2, graph: 'g', regler: [0, 0, 0, 0, 0, 0, 0, 0.5], code: 's("bd")', bpm: 120 };
  const p = compProjekt([au('m1', 'C', 0, 8, 0)], [['t1', [au('c2', 'B', 0, 8, 1, { entstehung: ent, name: 'Vox pass', gain_db: -3, stumm: true })]]]);
  const k = fuehreAus(p, comp('t1', 2, 6)).projekt.spuren[0].clips[1];
  assert.deepEqual(k.entstehung, ent); assert.equal(k.name, 'Vox pass'); assert.equal(k.gain_db, -3); assert.equal(k.stumm, true);
});

test('comp_waehlen negative control: take 3 over its own range on a main lane that is a copy of take 3 returns the project unchanged', () => {
  const p = mainDreiZwei();
  const r = fuehreAus(p, comp('t3', 0, 8));
  assert.equal(bytes(r.projekt), bytes(p), 'byte for byte the same project');
  assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(r.vor, []); assert.deepEqual(r.zurueck, []);
  assert.deepEqual(r.projekt.naechste_id, p.naechste_id, 'no id was spent');
  // the same holds for a sub range that cuts the main clip nowhere (inside it): the main clip is a copy there
  const r2 = fuehreAus(p, comp('t3', 2, 5));
  assert.equal(bytes(r2.projekt), bytes(p)); assert.equal(r2.betrifft_wiedergabe, false);
  // positive control: the same main lane against take 2 is not a copy and does change
  assert.notEqual(bytes(fuehreAus(p, comp('t2', 0, 8)).projekt), bytes(p));
});

test('comp_waehlen no-op rule: a copy that is shifted by one beat or has other fades is still replaced or kept as the rule says', () => {
  const geschoben = compProjekt([au('m1', 'C', 1, 7, 0)], [['t3', [au('c3', 'C', 0, 8, 0)]]]);   // start moved, offset kept: not a copy
  const r = fuehreAus(geschoben, comp('t3', 1, 8));
  assert.notEqual(bytes(r.projekt), bytes(geschoben), 'a moved main clip is replaced by the take');
  assert.deepEqual(r.projekt.spuren[0].clips.map(kurz), [[1, 7, 'C']]);
  nah(r.projekt.spuren[0].clips[0].offset_s, 1 * SEK, 'offset follows the take timeline');
  const mitFade = compProjekt([au('m1', 'C', 0, 8, 0, { fade_ein_beats: 0.25 })], [['t3', [au('c3', 'C', 0, 8, 0)]]]);
  const k = fuehreAus(mitFade, comp('t3', 0, 8));
  assert.equal(bytes(k.projekt), bytes(mitFade), 'a copy with its own fade is still a copy: fades untouched');
  assert.equal(k.projekt.spuren[0].clips[0].fade_ein_beats, 0.25);
});

test('comp_waehlen gap (AK6): a take with clips [0,2) and [6,8) leaves exactly those two parts in the range, nothing in [2,6)', () => {
  const p = compProjekt([au('m1', 'C', 0, 8, 0)], [['t1', [au('c1', 'A', 0, 2, 0), au('c2', 'A', 6, 2, 3)]]]);
  const c = fuehreAus(p, comp('t1', 0, 8)).projekt.spuren[0].clips;
  assert.deepEqual(c.map(kurz), [[0, 2, 'A'], [6, 2, 'A']]);
  assert.ok(c.every((x) => x.start_beat + x.laenge_beats <= 2 + 1e-9 || x.start_beat >= 6 - 1e-9), 'nothing inside [2,6)');
  assert.equal(c[0].fade_ein_beats, 0, 'no fade at the edge to silence (start)'); assert.equal(c[0].fade_aus_beats, 0); assert.equal(c[1].fade_aus_beats, 0);
});

test('comp_waehlen: two adjacent take clips inside the range both land in main and get no fade between them', () => {
  const p = compProjekt([au('m1', 'C', 0, 12, 0)], [['t1', [au('c1', 'A', 2, 3, 1), au('c2', 'A', 5, 3, 2.5)]]]);
  const c = fuehreAus(p, comp('t1', 2, 8)).projekt.spuren[0].clips;
  assert.deepEqual(c.map(kurz), [[0, 2, 'C'], [2, 3, 'A'], [5, 3, 'A'], [8, 4, 'C']]);
  nah(c[1].fade_aus_beats, 0, 'no fade between the two clones'); nah(c[2].fade_ein_beats, 0, 'no fade between the two clones');
  nah(c[0].fade_aus_beats, FADE, 'seam at 2'); nah(c[1].fade_ein_beats, FADE, 'seam at 2');
  nah(c[2].fade_aus_beats, FADE, 'seam at 8'); nah(c[3].fade_ein_beats, FADE, 'seam at 8');
});

test('comp_waehlen: splits only strictly inside a clip; a range on clip edges splits nothing and spends only the id of the clone', () => {
  const p = compProjekt([au('m1', 'C', 0, 3, 0), au('m2', 'C', 3, 2, 1.5), au('m3', 'C', 5, 3, 2.5)], [['t2', [au('c2', 'B', 3, 2, 0)]]]);
  const r = fuehreAus(p, comp('t2', 3, 5)), c = r.projekt.spuren[0].clips;
  assert.deepEqual(c.map(kurz), [[0, 3, 'C'], [3, 2, 'B'], [5, 3, 'C']]);
  assert.deepEqual([c[0].id, c[2].id], ['m1', 'm3'], 'untouched main clips keep their ids');
  assert.equal(r.projekt.naechste_id.clip, p.naechste_id.clip + 1, 'one id for the clone, none for splits');
  nah(c[0].fade_aus_beats, FADE, 'seam fade at 3'); nah(c[2].fade_ein_beats, FADE, 'seam fade at 5');
});

test('comp_waehlen: the seam fade is capped at half the shorter neighbour, an existing longer fade stays, an edge to silence gets none (AK5b)', () => {
  // a 0.004 beat sliver of take (shorter than 2 * FADE): fade capped at half of it on both sides
  const p = compProjekt([au('m1', 'C', 0, 8, 0)], [['t1', [au('c1', 'B', 0, 8, 0)]]]);
  const c = fuehreAus(p, comp('t1', 3, 3.004)).projekt.spuren[0].clips;
  [3, 0.004, 4.996].forEach((l, i) => nah(c[i].laenge_beats, l, `length ${i}`));   // clip_teilen does not round the lengths
  for (const f of [c[0].fade_aus_beats, c[1].fade_ein_beats, c[1].fade_aus_beats, c[2].fade_ein_beats]) nah(f, 0.002, 'half of the sliver');
  assert.ok(c[1].fade_ein_beats + c[1].fade_aus_beats <= c[1].laenge_beats + 1e-9);
  // an existing longer fade is not shortened
  const q = compProjekt([au('m1', 'C', 0, 3, 0, { fade_aus_beats: 0.5 }), au('m3', 'C', 5, 3, 2.5)], [['t1', [au('c1', 'B', 0, 8, 0)]]]);
  const d = fuehreAus(q, comp('t1', 3, 5)).projekt.spuren[0].clips;
  assert.equal(d[0].fade_aus_beats, 0.5, 'longer existing fade kept'); nah(d[1].fade_ein_beats, FADE, 'the clone side gets the seam fade');
  // edge to silence: the main lane ends at 3 and is empty after 5, so only the edge at 3 gets a fade
  const s = compProjekt([au('m1', 'C', 0, 3, 0)], [['t1', [au('c1', 'B', 0, 8, 0)]]]);
  const e = fuehreAus(s, comp('t1', 3, 5)).projekt.spuren[0].clips;
  nah(e[0].fade_aus_beats, FADE, 'seam at 3'); nah(e[1].fade_ein_beats, FADE, 'seam at 3');
  assert.equal(e[1].fade_aus_beats, 0, 'no fade at the edge to silence');
});

test('comp_waehlen with warp: the cut clone part keeps versatz_beats consistent (same rule as clip_teilen)', () => {
  const take = au('c2', 'B', 0, 8, 0, { warp: warpO(1.5) });
  const p = compProjekt([au('m1', 'C', 0, 8, 0)], [['t2', [take]]]);
  const c = fuehreAus(p, comp('t2', 3, 5)).projekt.spuren[0].clips;
  assert.deepEqual(c.map(kurz), [[0, 3, 'C'], [3, 2, 'B'], [5, 3, 'C']]);
  assert.equal(c[1].warp.versatz_beats, 4.5, '1.5 + 3 beats'); assert.deepEqual(c[1].warp.marker, take.warp.marker);
  const ganz = fuehreAus(p, comp('t2', 0, 8)).projekt.spuren[0].clips;
  assert.equal(ganz.length, 1); assert.equal(ganz[0].warp.versatz_beats, 1.5);
  // the result counts as a copy of the take (R6) and a second identical comp is a no-op
  const zwei = fuehreAus(fuehreAus(p, comp('t2', 3, 5)).projekt, comp('t2', 3, 5));
  assert.equal(zwei.betrifft_wiedergabe, false); assert.deepEqual(zwei.vor, []);
});

test('comp_waehlen: a loop clip on the main lane crossing an edge gives ersetzen_loop, project unchanged', () => {
  const p = compProjekt([au('m1', 'C', 0, 8, 0, { loop_beats: 2 })], [['t2', [au('c2', 'B', 0, 8, 0)]]]);
  const vorher = bytes(p);
  lehntAb(p, comp('t2', 3, 5), 'ersetzen_loop');
  assert.equal(bytes(p), vorher);
  assert.equal(grundCode('ersetzen_loop'), 409);
  // positive control: a loop clip that lies wholly inside the range is simply replaced
  const q = compProjekt([au('m1', 'C', 4, 2, 0, { loop_beats: 1 })], [['t2', [au('c2', 'B', 0, 8, 0)]]]);
  assert.deepEqual(fuehreAus(q, comp('t2', 3, 7)).projekt.spuren[0].clips.map(kurz), [[3, 4, 'B']]);
});

test('comp_waehlen: a loop clip in the take lane crossing an edge gives ersetzen_loop; wholly inside it is copied as it is', () => {
  const p = compProjekt([au('m1', 'C', 0, 8, 0)], [['t2', [au('c2', 'B', 2, 4, 0, { loop_beats: 1 })]]]);
  lehntAb(p, comp('t2', 3, 5), 'ersetzen_loop');
  const ganz = fuehreAus(p, comp('t2', 1, 7)).projekt.spuren[0].clips;
  assert.deepEqual(ganz.map(kurz), [[0, 1, 'C'], [2, 4, 'B'], [7, 1, 'C']]);
  assert.equal(ganz[1].loop_beats, 1);
});

test('comp_waehlen: bis <= von, a range outside [0, MAX_BEAT], an unknown take or track', () => {
  const p = mainDreiZwei(), vorher = bytes(p);
  for (const [v, b] of [[5, 5], [5, 3], [-1, 4], [0, MAX_BEAT + 1], [-5, -1]]) lehntAb(p, comp('t2', v, b), 'comp_leer');
  lehntAb(p, comp('t9', 3, 5), 'take_unbekannt');
  lehntAb(p, { ...comp('t2', 3, 5), spur_id: 's9' }, 'spur_unbekannt');
  lehntAb(p, comp('t2', 'x', 5), 'argument_ungueltig');
  lehntAb(p, { ...comp('t2', 3, 5), extra: 1 }, 'argument_unbekannt');
  assert.equal(bytes(p), vorher);
  assert.equal(grundCode('comp_leer'), 400); assert.equal(grundCode('take_unbekannt'), 404);
  assert.ok(fuehreAus(p, comp('t2', 0, MAX_BEAT)).projekt, 'positive control: the full legal range is accepted');
});

test('comp_waehlen: one undo restores the main lane deep-equal, redo repeats it (AK7)', (t) => {
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { zeitgeber: false });
  const p = mainDreiZwei();
  const w = aendere(v, p, [comp('t2', 3, 5)], { quelle: 'andreas', label: 'Comp' });
  assert.equal(w.projekt.spuren[0].clips.length, 3);
  const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
  assert.deepEqual(ohneDek(u.projekt.spuren[0].clips), ohneDek(p.spuren[0].clips));
  assert.deepEqual(ohneDek(u.projekt.spuren[0].takes), ohneDek(p.spuren[0].takes));
  assert.equal(u.betrifft_wiedergabe, true);
  const r = wiederholen(v, u.projekt, { quelle: 'andreas' });
  assert.deepEqual(ohneDek(r.projekt.spuren[0].clips), ohneDek(w.projekt.spuren[0].clips));
});

// --- Task 3 fix round 1: no-op fields, seam priority, 127 BPM, range comparison ---------------------------------------------------------
test('comp_waehlen no-op rule: a main copy that is muted, louder/quieter or pitched differently is not a no-op (betrifft_wiedergabe true)', () => {
  const take = (extra) => [['t3', [au('c3', 'C', 0, 8, 0, extra)]]];
  for (const [was, haupt] of [['stumm', { stumm: true }], ['gain -24 dB', { gain_db: -24 }]]) {
    const p = compProjekt([au('m1', 'C', 0, 8, 0, haupt)], take({}));
    const r = fuehreAus(p, comp('t3', 0, 8));
    assert.equal(r.betrifft_wiedergabe, true, `${was}: replaced by the take`);
    assert.notEqual(bytes(r.projekt), bytes(p), was);
  }
  const w = (st) => warpO(0, { modus: 'complex', transpose_st: st });   // transpose needs a pitch-preserving mode
  const p = compProjekt([au('m1', 'C', 0, 8, 0, { warp: w(7) })], take({ warp: w(0) }));
  assert.equal(fuehreAus(p, comp('t3', 0, 8)).betrifft_wiedergabe, true, 'warp +7 st is not a copy of warp 0');
  for (const extra of [{ detune_ct: 30 }, { modus: 'tones' }]) {
    const q = compProjekt([au('m1', 'C', 0, 8, 0, { warp: warpO(0, { modus: 'complex', ...extra }) })], take({ warp: warpO(0, { modus: 'complex' }) }));
    assert.equal(fuehreAus(q, comp('t3', 0, 8)).betrifft_wiedergabe, true, JSON.stringify(extra));
  }
  // negative control: the identical fields (stumm, gain, warp parameters) stay a no-op
  const gleich = { stumm: true, gain_db: -6, warp: w(7) };
  const g = compProjekt([au('m1', 'C', 0, 8, 0, gleich)], take(gleich));
  const r = fuehreAus(g, comp('t3', 0, 8));
  assert.equal(r.betrifft_wiedergabe, false); assert.equal(bytes(r.projekt), bytes(g));
});

test('comp_waehlen no-op rule: a different name or entstehung alone stays a no-op (labels, not sound)', () => {
  const ent = { art: 'strom', strom: 2, graph: 'g', regler: [0, 0, 0, 0, 0, 0, 0, 0.5], code: 's("bd")', bpm: 120 };
  const p = compProjekt([au('m1', 'C', 0, 8, 0, { name: 'renamed' })], [['t3', [au('c3', 'C', 0, 8, 0, { entstehung: ent })]]]);
  const r = fuehreAus(p, comp('t3', 0, 8));
  assert.equal(r.betrifft_wiedergabe, false); assert.equal(bytes(r.projekt), bytes(p)); assert.deepEqual(r.vor, []);
  // positive control: a different gain next to the same other name does replace
  const q = compProjekt([au('m1', 'C', 0, 8, 0, { name: 'renamed', gain_db: -3 })], [['t3', [au('c3', 'C', 0, 8, 0)]]]);
  assert.equal(fuehreAus(q, comp('t3', 0, 8)).betrifft_wiedergabe, true);
});

test('comp_waehlen no-op rule compares the ranges: a main copy that covers only part of the take material is not a no-op', () => {
  // main holds a copy of [0,4) of the take clip, comp [0,8): same count, same sha and timeline, but the range differs
  const p = compProjekt([au('m1', 'C', 0, 4, 0)], [['t3', [au('c3', 'C', 0, 8, 0)]]]);
  assert.deepEqual(fuehreAus(p, comp('t3', 0, 8)).projekt.spuren[0].clips.map(kurz), [[0, 8, 'C']]);
  // different count: take [0,2) and [6,8), main only a copy of the first one
  const q = compProjekt([au('m1', 'C', 0, 2, 0)], [['t3', [au('c1', 'C', 0, 2, 0), au('c2', 'C', 6, 2, 3)]]]);
  assert.deepEqual(fuehreAus(q, comp('t3', 0, 8)).projekt.spuren[0].clips.map(kurz), [[0, 2, 'C'], [6, 2, 'C']]);
  // positive control: both pieces present is a no-op
  const g = compProjekt([au('m1', 'C', 0, 2, 0), au('m2', 'C', 6, 2, 3)], [['t3', [au('c1', 'C', 0, 2, 0), au('c2', 'C', 6, 2, 3)]]]);
  assert.equal(fuehreAus(g, comp('t3', 0, 8)).betrifft_wiedergabe, false);
});

test('comp_waehlen seam fade has priority: the opposite fade of the remainder gives way (main [0,8) fade_ein 4, comp [3,5))', () => {
  const p = compProjekt([au('m1', 'C', 0, 8, 0, { fade_ein_beats: 4 })], [['t2', [au('c2', 'B', 0, 8, 1)]]]);
  const c = fuehreAus(p, comp('t2', 3, 5)).projekt.spuren[0].clips;
  assert.deepEqual(c.map(kurz), [[0, 3, 'C'], [3, 2, 'B'], [5, 3, 'C']]);
  nah(c[0].fade_aus_beats, FADE, 'seam fade out of the remainder is set');
  nah(c[0].fade_ein_beats, 3 - FADE, 'the opposite fade gives way: length minus seam fade');
  nah(c[1].fade_ein_beats, FADE, 'clone side of the seam');
  for (const x of c) assert.ok(x.fade_ein_beats + x.fade_aus_beats <= x.laenge_beats + 1e-9, `${x.id} fades fit`);
});

test('comp_waehlen at 127 BPM: seam fade 0.004 s in beats and clone offset follow the tempo (a hard-coded 120 is wrong)', () => {
  const p = compProjekt([au('m1', 'C', 0, 8, 0)], [['t2', [au('c2', 'B', 0, 8, 1)]]]);
  p.tempo_bpm = 127;
  const c = fuehreAus(p, comp('t2', 3, 5)).projekt.spuren[0].clips;
  const f = 0.004 * 127 / 60, sek = 60 / 127;
  nah(f, 0.008466666667, 'expected fade');
  nah(c[0].fade_aus_beats, f, 'main fade out'); nah(c[1].fade_ein_beats, f, 'clone fade in');
  nah(c[1].fade_aus_beats, f, 'clone fade out'); nah(c[2].fade_ein_beats, f, 'main fade in');
  nah(c[1].offset_s, 1 + 3 * sek, 'clone offset at 127 bpm'); nah(c[2].offset_s, 5 * sek, 'third part offset at 127 bpm');
  assert.ok(Math.abs(c[1].offset_s - (1 + 3 * SEK)) > 1e-3, 'differs from the 120 bpm value');
});
