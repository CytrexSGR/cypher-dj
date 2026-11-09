// 1.14 comping, slice 1, task 4: recording writes a take per pass and the overwritten material goes to the Original lane.
// Pure part: nehmeTakeAuf (spec R3, AK2 to AK4, AK10b, AK10c). Session part: the uebernehmen path of /proj/aufnahme on the stand-in core.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as auf from '../project/recording.ts';
import { fuehreListeAus, vergleiche } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, MAX_CLIPS, MAX_TAKES_PRO_SPUR } from '../project/model.ts';
import { unterschied, wende } from '../project/patch.ts';
import { stapel } from './support/media_library.mjs';
import { ruf, warte } from './support/proj_stack.mjs';

const { nehmeTakeAuf, TakeFehler } = auf;
const SHA_ALT = 'b'.repeat(64);
const warpO = (versatz) => ({ an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: versatz,
  quelle: 'takte', transpose_st: 0, detune_ct: 0 });
const SHA_T = (n) => n.toString(16).padStart(64, '0');
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const kurz = (cs) => cs.map((c) => [c.start_beat, c.laenge_beats, c.quelle.sha256[0]]);
const sortiert = (cs) => [...cs].sort((a, b) => a.start_beat - b.start_beat);

// audio track s1 with one catalog clip over beats [0,16) (sha b) and one far clip [20,24) (sha c)
function projekt() {
  let p = neuesProjekt('T');
  p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'Gitarre' });
  p = lauf(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA_ALT, name: 'alt' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 20, laenge_beats: 4, sha256: 'c'.repeat(64), name: 'weit' });
  return p;
}
const nehme = (p, von, laenge, sha = 'a'.repeat(64), name = 'Take x') => nehmeTakeAuf(p, { spurId: 's1', startBeat: von, laengeBeats: laenge, sha256: sha,
  pfadHinweis: `/x/${sha.slice(0, 4)}.wav`, name });
const lanes = (p) => p.spuren[0].takes ?? [];
const original = (p) => lanes(p).find((t) => t.art === 'original');

test('ORIGINAL_NAME is "Original"', () => {
  assert.equal(auf.ORIGINAL_NAME, 'Original');
});

test('AK2: first recording on a track without takes creates "Take 1" with the take clip and the same clip in the main lane', () => {
  const p = lauf(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'G' });
  const n = nehme(p, 2, 8);
  assert.deepEqual(lanes(n).map((t) => [t.id, t.name, t.art]), [['t1', 'Take 1', undefined]], 'one lane, no Original (nothing was overwritten)');
  assert.equal(lanes(n)[0].clips.length, 1);
  assert.equal(n.spuren[0].clips.length, 1);
  const [t, m] = [lanes(n)[0].clips[0], n.spuren[0].clips[0]];
  assert.deepEqual([t.quelle.sha256, t.start_beat, t.laenge_beats], [m.quelle.sha256, m.start_beat, m.laenge_beats]);
  assert.deepEqual([m.start_beat, m.laenge_beats, m.quelle.sha256[0]], [2, 8, 'a']);
  assert.notEqual(t.id, m.id, 'ids are project wide unique');
  const { id: _a, ...tRest } = t, { id: _b, ...mRest } = m;
  assert.deepEqual(tRest, mRest, 'the take clip is the main clip but for its id');
});

test('AK3: recording over a catalog clip keeps the overwritten part in the Original lane with the right offset', () => {
  const p = projekt();
  const n = nehme(p, 4, 4);   // 128 bpm default: 4 beats = 1.875 s
  assert.deepEqual(kurz(sortiert(n.spuren[0].clips)), [[0, 4, 'b'], [4, 4, 'a'], [8, 8, 'b'], [20, 4, 'c']]);
  const o = original(n);
  assert.ok(o, 'an Original lane exists');
  assert.deepEqual([o.name, o.art, o.clips.length], [auf.ORIGINAL_NAME, 'original', 1]);
  assert.deepEqual(kurz(o.clips), [[4, 4, 'b']]);
  assert.ok(Math.abs(o.clips[0].offset_s - (4 * 60) / p.tempo_bpm) < 1e-6, `offset_s moved on by 4 beats, got ${o.clips[0].offset_s}`);
  assert.deepEqual(lanes(n).filter((t) => t.art === undefined).map((t) => [t.name, kurz(t.clips)]), [['Take 1', [[4, 4, 'a']]]]);
  assert.ok(pruefeProjekt(JSON.parse(JSON.stringify(n))).projekt, 'the result is a valid project');
});

test('AK3 over several clips: whole covered clips move too, the far clip stays untouched (negative control)', () => {
  const p = projekt();
  const n = nehme(p, 12, 10);   // [12,22): cuts [0,16) to [0,12) and [20,24) to [22,24)
  assert.deepEqual(kurz(sortiert(n.spuren[0].clips)), [[0, 12, 'b'], [12, 10, 'a'], [22, 2, 'c']]);
  assert.deepEqual(kurz(sortiert(original(n).clips)), [[12, 4, 'b'], [20, 2, 'c']]);
  const frei = nehme(p, 40, 4);   // nothing overwritten: no Original lane at all
  assert.equal(original(frei), undefined);
  assert.equal(frei.spuren[0].clips.length, 3);
});

test('AK4: a second take over the same range gets "Take 2"; an empty range of the newest lane reuses it', () => {
  const eins = nehme(projekt(), 4, 4, 'a'.repeat(64));
  const zwei = nehme(eins, 4, 4, 'd'.repeat(64));
  assert.deepEqual(lanes(zwei).map((t) => t.name), ['Take 1', auf.ORIGINAL_NAME, 'Take 2']);
  assert.deepEqual(lanes(zwei).map((t) => t.clips.length), [1, 1, 1]);
  const drei = nehme(zwei, 20, 2, 'e'.repeat(64));   // [20,22): Take 2 holds nothing there
  assert.deepEqual(lanes(drei).map((t) => t.name), ['Take 1', auf.ORIGINAL_NAME, 'Take 2'], 'no Take 3');
  assert.deepEqual(kurz(sortiert(lanes(drei)[2].clips)), [[4, 4, 'd'], [20, 2, 'e']]);
});

test('AK10b: the newest-lane choice skips the Original lane (it is the newest by position but never chosen)', () => {
  const eins = nehme(projekt(), 4, 4);   // lanes: Take 1, Original (Original last in the list)
  assert.equal(lanes(eins).at(-1).art, 'original');
  const zwei = nehme(eins, 40, 4, 'd'.repeat(64));   // empty range in both: must go to Take 1, not to Original
  assert.deepEqual(lanes(zwei).map((t) => [t.name, t.clips.length]), [['Take 1', 2], [auf.ORIGINAL_NAME, 1]]);
  assert.equal(original(zwei).clips.some((c) => c.quelle.sha256[0] === 'd'), false);
});

test('main material that is itself a take copy (R6) is not copied into Original', () => {
  const eins = nehme(projekt(), 4, 4);   // main [4,8) is now a copy of Take 1
  assert.equal(original(eins).clips.length, 1);
  const zwei = nehme(eins, 4, 4, 'd'.repeat(64));   // overwrites the copy of take 1 entirely
  assert.deepEqual(kurz(original(zwei).clips), [[4, 4, 'b']], 'Original still holds only the catalog part');
  assert.deepEqual(kurz(lanes(zwei)[0].clips), [[4, 4, 'a']], 'Take 1 survives in its lane');
  const drei = nehme(eins, 2, 4, 'd'.repeat(64));   // [2,6): catalog part [2,4) moves, the take copy part [4,6) does not
  assert.deepEqual(kurz(sortiert(original(drei).clips)), [[2, 2, 'b'], [4, 4, 'b']]);
  assert.equal(original(drei).clips.some((c) => c.quelle.sha256[0] === 'a'), false, 'no part of Take 1 in Original');
  assert.deepEqual(kurz(sortiert(drei.spuren[0].clips)), [[0, 2, 'b'], [2, 4, 'd'], [6, 2, 'a'], [8, 8, 'b'], [20, 4, 'c']]);
});

test('review focus 1: a loop clip crossing the edge refuses with ersetzen_loop and creates no lane; a fully covered loop clip moves', () => {
  let p = projekt();
  p = lauf(p, { befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 2 });
  const vorher = structuredClone(p);
  assert.throws(() => nehme(p, 4, 4), (e) => e.grund === 'ersetzen_loop');
  assert.deepEqual(p, vorher, 'the input project is untouched');
  const n = nehme(p, 0, 17);   // covers the loop clip [0,16) completely
  assert.deepEqual(kurz(original(n).clips), [[0, 16, 'b']]);
  assert.equal(original(n).clips[0].loop_beats, 2, 'the loop is kept in the Original lane');
});

test('AK10c: 32 take lanes refuse with takes_voll when a new lane is needed, the input stays as it was', () => {
  let p = projekt();
  p = structuredClone(p);
  p.spuren[0].takes = Array.from({ length: MAX_TAKES_PRO_SPUR }, (_, i) => ({ id: `t${i + 1}`, name: `Take ${i + 1}`, clips: [{
    id: `c${100 + i}`, art: 'audio', name: 'x', start_beat: 0, laenge_beats: 16, quelle: { sha256: SHA_T(i + 1), pfad_hinweis: '' }, dekodiert: 'nein',
    offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }] }));
  p = pruefeProjekt(JSON.parse(JSON.stringify(p))).projekt;
  assert.ok(p, '32 lanes are a valid project');
  const vorher = structuredClone(p);
  assert.throws(() => nehme(p, 4, 4), (e) => e.grund === 'takes_voll');
  assert.deepEqual(p, vorher);
  const frei = nehme(p, 40, 4);   // newest lane is empty there: reused, no new lane needed (negative control)
  assert.equal(lanes(frei).length, MAX_TAKES_PRO_SPUR);
});

test('AK10c: 31 lanes and a needed Original are 33 lanes: takes_voll before anything moves; with 30 lanes it fits', () => {
  const mitLanes = (n) => {
    const q = structuredClone(projekt());
    q.spuren[0].takes = Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Take ${i + 1}`, clips: [{
      id: `c${100 + i}`, art: 'audio', name: 'x', start_beat: 0, laenge_beats: 16, quelle: { sha256: SHA_T(i + 1), pfad_hinweis: '' }, dekodiert: 'nein',
      offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }] }));
    return pruefeProjekt(JSON.parse(JSON.stringify(q))).projekt;
  };
  const p31 = mitLanes(MAX_TAKES_PRO_SPUR - 1);
  const vorher = structuredClone(p31);
  assert.throws(() => nehme(p31, 4, 4), (e) => e instanceof TakeFehler && e.grund === 'takes_voll');
  assert.deepEqual(p31, vorher, 'nothing moved');
  const p30 = mitLanes(MAX_TAKES_PRO_SPUR - 2);
  const n = nehme(p30, 4, 4);
  assert.equal(lanes(n).length, MAX_TAKES_PRO_SPUR, 'new lane plus Original make exactly 32');
  assert.ok(original(n));
});

test('AK10c: a recording that would exceed MAX_CLIPS refuses with zu_gross and leaves the project as it was (negative control: it fits one lower)', () => {
  const mitClips = (n) => {
    let q = lauf(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'G' });
    q = structuredClone(q);
    q.spuren[0].clips = Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, art: 'audio', name: 'x', start_beat: 100 + i, laenge_beats: 0.5,
      quelle: { sha256: SHA_ALT, pfad_hinweis: '' }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }));
    q.naechste_id = { ...q.naechste_id, clip: n + 1 };
    return pruefeProjekt(JSON.parse(JSON.stringify(q))).projekt;
  };
  const voll = mitClips(MAX_CLIPS - 1);   // the take adds two clips (main and take lane): 4097
  assert.ok(voll);
  const vorher = structuredClone(voll);
  assert.throws(() => nehme(voll, 0, 4), (e) => e.grund === 'zu_gross');
  assert.deepEqual(voll, vorher);
  const knapp = nehme(mitClips(MAX_CLIPS - 2), 0, 4);   // exactly 4096
  assert.equal(knapp.spuren[0].clips.length + lanes(knapp)[0].clips.length, MAX_CLIPS);
});

test('one undo step: the patch removes the take lane, the Original part and the main change; redo repeats it', () => {
  const p = projekt();
  const n = nehme(p, 4, 4);
  const zurueck = unterschied(n, p), vor = unterschied(p, n);
  const ohneZaehler = (x) => { const { naechste_id: _z, ...rest } = x; return rest; };   // id counters never go back (model rule)
  assert.deepEqual(ohneZaehler(wende(structuredClone(n), zurueck)), ohneZaehler(p), 'undo gives the old project back, deep equal');
  assert.equal('takes' in wende(structuredClone(n), zurueck).spuren[0], false, 'no empty takes list left');
  assert.deepEqual(ohneZaehler(wende(structuredClone(p), vor)), ohneZaehler(n), 'redo gives the new project');
});

test('AK10b lane filter: Take 2 deleted, Original holds the range and Take 1 does not: Take 1 is reused, no new Take 2', () => {
  let p = nehme(projekt(), 0, 4);                        // Take 1 [0,4), Original [0,4)
  p = nehme(p, 0, 4, 'd'.repeat(64));                    // Take 2 [0,4)
  p = nehme(p, 8, 4, 'e'.repeat(64));                    // [8,12): Take 2 is free there and is reused; the catalog part [8,12) goes to Original
  assert.deepEqual(lanes(p).map((t) => t.name), ['Take 1', auf.ORIGINAL_NAME, 'Take 2']);
  assert.equal(original(p).clips.some((c) => c.start_beat === 8), true);
  p = lauf(p, { befehl: 'take_loeschen', spur_id: 's1', take_id: lanes(p)[2].id });
  assert.deepEqual(lanes(p).map((t) => t.name), ['Take 1', auf.ORIGINAL_NAME]);
  const n = nehme(p, 8, 4, 'f'.repeat(64));              // Take 1 does not hold [8,12), Original does
  assert.deepEqual(lanes(n).map((t) => t.name), ['Take 1', auf.ORIGINAL_NAME], 'Take 1 reused, no Take 2');
  assert.deepEqual(kurz(sortiert(lanes(n)[0].clips)), [[0, 4, 'a'], [8, 4, 'f']]);
});

test('a copy whose gain or mute Andreas changed is kept in Original (klingtGleich), an untouched copy is dropped', () => {
  const eins = nehme(projekt(), 4, 4);                   // main [4,8) is a copy of Take 1
  const kopie = eins.spuren[0].clips.find((c) => c.start_beat === 4);
  const lauter = lauf(eins, { befehl: 'clip_aendern', clip_id: kopie.id, gain_db: -6 });
  const n = nehme(lauter, 4, 4, 'd'.repeat(64));
  assert.deepEqual(kurz(sortiert(original(n).clips)), [[4, 4, 'b'], [4, 4, 'a']].sort((x, y) => x[0] - y[0]), 'the changed copy joins the catalog part');
  assert.equal(original(n).clips.find((c) => c.quelle.sha256[0] === 'a').gain_db, -6, 'his setting survives');
  const stumm = lauf(eins, { befehl: 'clip_aendern', clip_id: kopie.id, stumm: true });
  assert.equal(original(nehme(stumm, 4, 4, 'd'.repeat(64))).clips.length, 2, 'a muted copy is kept as well');
  assert.equal(original(nehme(eins, 4, 4, 'd'.repeat(64))).clips.length, 1, 'negative control: the untouched copy is dropped');
});

test('recording over a fresh comp: the comp copy is a take copy, nothing lands twice in Original', () => {
  let p = nehme(projekt(), 4, 4);                        // Take 1 [4,8); Original [4,8) catalog
  p = nehme(p, 4, 4, 'd'.repeat(64));                    // Take 2 [4,8)
  p = lauf(p, { befehl: 'comp_waehlen', spur_id: 's1', take_id: lanes(p).find((t) => t.name === 'Take 1').id, von_beat: 4, bis_beat: 8 });
  const n = nehme(p, 4, 4, 'e'.repeat(64));
  assert.deepEqual(kurz(original(n).clips), [[4, 4, 'b']], 'Original still holds the catalog part once');
  assert.deepEqual(lanes(n).filter((t) => t.art === undefined).map((t) => t.name), ['Take 1', 'Take 2', 'Take 3']);
});

test('a warp clip at the range edge: the part in Original carries the warp with versatz_beats moved on by the cut', () => {
  let p = projekt();
  p = lauf(p, { befehl: 'warp_setzen', clip_id: 'c1', warp: warpO(0) });
  const n = nehme(p, 4, 4);
  const o = original(n).clips[0];
  assert.deepEqual([o.start_beat, o.laenge_beats], [4, 4]);
  assert.equal(o.warp.versatz_beats, 4);
  assert.ok(pruefeProjekt(JSON.parse(JSON.stringify(n))).projekt);
});

test('a recording changes playback (main lane), a take-lane-only change does not', () => {
  const p = projekt();
  const n = nehme(p, 4, 4);
  assert.equal(vergleiche(p, n).betrifft_wiedergabe, true);
  const nurLanes = structuredClone(p);
  nurLanes.spuren[0].takes = structuredClone(n.spuren[0].takes);
  assert.equal(vergleiche(p, nurLanes).betrifft_wiedergabe, false, 'negative control');
});

test('two tracks: each gets its own take (one lane per track)', () => {
  let p = lauf(projekt(), { befehl: 'spur_neu', art: 'audio', name: 'Bass' });
  p = nehmeTakeAuf(p, { spurId: 's1', startBeat: 4, laengeBeats: 4, sha256: 'a'.repeat(64), pfadHinweis: '/x/a.wav', name: 'T' });
  p = nehmeTakeAuf(p, { spurId: 's2', startBeat: 4, laengeBeats: 4, sha256: 'd'.repeat(64), pfadHinweis: '/x/d.wav', name: 'T' });
  assert.deepEqual(p.spuren.map((s) => (s.takes ?? []).filter((t) => t.art === undefined).map((t) => t.name)), [['Take 1'], ['Take 1']]);
  assert.equal(p.spuren[1].takes.length, 1, 'no Original on the empty second track');
  assert.deepEqual(p.spuren.map((s) => new Set((s.takes ?? []).flatMap((t) => t.clips.map((c) => c.id))).size > 0), [true, true]);
});

// --- session part: /proj/aufnahme on the stand-in core ---------------------------------------------------------------------------------
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-comp-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
async function scharf(url, name, spuren = ['Gitarre']) {
  await ruf(url, 'POST', '/proj/neu', { name });
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur',
    befehle: [{ befehl: 'tempo_setzen', bpm }, ...spuren.map((n) => ({ befehl: 'spur_neu', art: 'audio', name: n }))] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const b = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Arm', befehle: p.spuren.map((s, i) => ({ befehl: 'spur_aendern', spur_id: s.id,
    eingang: { art: 'intern', name: `erz/${i + 1}` }, arm: true })) });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  return { bpm, ids: p.spuren.map((s) => s.id) };
}
async function nimmAuf(url, von = 0, ms = 250) {
  const st = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: von });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  await warte(ms);
  const stop = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
  assert.equal(stop.code, 200, JSON.stringify(stop.j));
  return stop.j;
}
const aktuell = async (url) => (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;

test('session: one pass writes a take lane and the main clip; one undo removes both, redo brings both back', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  await scharf(url, 'Comp1');
  const stop = await nimmAuf(url);
  assert.ok(stop.takes[0].frames > 0 && !stop.takes[0].fehler, JSON.stringify(stop));
  const p = await aktuell(url);
  const s = p.spuren[0];
  assert.equal(s.clips.length, 1);
  assert.deepEqual(s.takes.map((x) => [x.name, x.clips.length]), [['Take 1', 1]]);
  assert.equal(s.takes[0].clips[0].quelle.sha256, s.clips[0].quelle.sha256);
  assert.equal((await ruf(url, 'GET', '/proj/verlauf')).j.filter((e) => e.label.startsWith('Record')).length, 1);
  const u = await ruf(url, 'POST', '/proj/undo', { rev: p.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  const z = await aktuell(url);
  assert.deepEqual([z.spuren[0].clips.length, 'takes' in z.spuren[0]], [0, false], 'one undo removes the lane and the clip');
  const r = await ruf(url, 'POST', '/proj/redo', { rev: z.rev });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const w = await aktuell(url);
  assert.deepEqual([w.spuren[0].clips.length, w.spuren[0].takes.length], [1, 1]);
});

test('session: two armed tracks give one take per track in one history entry', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  await scharf(url, 'Comp2', ['Gitarre', 'Bass']);
  const stop = await nimmAuf(url);
  assert.equal(stop.takes.length, 2);
  assert.ok(stop.takes.every((x) => x.frames > 0 && !x.fehler), JSON.stringify(stop));
  const p = await aktuell(url);
  assert.deepEqual(p.spuren.map((s) => [s.clips.length, (s.takes ?? []).map((x) => x.name)]), [[1, ['Take 1']], [1, ['Take 1']]]);
  assert.equal((await ruf(url, 'GET', '/proj/verlauf')).j.filter((e) => e.label.startsWith('Record')).length, 1);
});

// A project file prepared on disk, then opened: the way to reach states that only recording could build (take lanes are read-only, R7).
async function praepariere(url, d, name, aendere) {
  const slug = (await ruf(url, 'GET', '/proj/liste')).j.find((x) => x.name === name || x.slug)?.slug;
  const datei = path.join(d, 'proj', slug, 'project.json');
  const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  aendere(j);
  fs.writeFileSync(datei, JSON.stringify(j));
  const o = await ruf(url, 'POST', '/proj/oeffnen', { slug });
  assert.equal(o.code, 200, JSON.stringify(o.j));
  return slug;
}
const clipJ = (id, von, laenge, extra = {}) => ({ id, art: 'audio', name: id, start_beat: von, laenge_beats: laenge,
  quelle: { sha256: SHA_ALT, pfad_hinweis: '' }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, ...extra });

for (const fall of ['takes_voll', 'takes_voll_original', 'zu_gross', 'ersetzen_loop']) {
  test(`AK10c session: ${fall} keeps the raw file and the WAV, reports the reason, the project stays as it was`, async (t) => {
    const d = tmp(t);
    const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
    await scharf(url, `Fehler-${fall}`);
    await praepariere(url, d, `Fehler-${fall}`, (j) => {
      const s = j.spuren[0];
      if (fall === 'takes_voll' || fall === 'takes_voll_original') {
        // takes_voll_original: 31 lanes, so the new lane fits but the Original lane the catalog clip needs does not (the pre-check, not take_neu)
        const n = fall === 'takes_voll' ? MAX_TAKES_PRO_SPUR : MAX_TAKES_PRO_SPUR - 1;
        s.takes = Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Take ${i + 1}`, clips: [clipJ(`c${100 + i}`, 0, 1000)] }));
        // not a take copy (other sha), so it needs the Original lane
        if (fall === 'takes_voll_original') s.clips = [clipJ('c1', 0, 1000, { quelle: { sha256: 'c'.repeat(64), pfad_hinweis: '' } })];
      } else if (fall === 'zu_gross') {
        s.clips = Array.from({ length: MAX_CLIPS - 1 }, (_, i) => clipJ(`c${i + 1}`, 5000 + i, 0.5));
      } else {
        s.clips = [clipJ('c1', 0, 1000, { loop_beats: 1 })];
      }
    });
    const vor = await aktuell(url);
    const stop = await nimmAuf(url, 0);
    const e = stop.takes[0];
    assert.equal(e.fehler, fall.replace('_original', ''), JSON.stringify(e));   // never uebernahme_fehler
    assert.ok(e.text && e.datei, 'the answer carries a text and the WAV path');
    assert.ok(fs.existsSync(e.datei), 'the take WAV is kept');
    assert.ok(fs.readdirSync(path.join(d, 'arr')).some((f) => f.endsWith('.f32')), 'the raw file is kept');
    const nach = await aktuell(url);
    assert.deepEqual([nach.rev, nach.spuren[0].clips, nach.spuren[0].takes], [vor.rev, vor.spuren[0].clips, vor.spuren[0].takes], 'project unchanged');
  });
}
