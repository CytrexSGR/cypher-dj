// B11 task 3: list and PLACE. A project with a left run file is opened, the rescue lists the take, POST /proj/gerettet_platzieren puts it on its track at its
// recorded start as one undoable entry. Refusals (track gone, clip limit, take-lane limit, recording running) leave the project and the record untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, warte } from './support/proj_stack.mjs';
import { GRUND_TEXT } from '../http/reasons.ts';
import { LAUF_FORMAT, gerettetListe, laufDateiPfad } from '../areas/proj/recording_rettung.ts';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-rettr-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const PLATZ = '/proj/gerettet_platzieren';

// a server with known folders; a project with `spuren` audio tracks (names G1..), closed again
async function aufbau(t, { spuren = 1, tempo } = {}) {
  const d = tmp(t);
  const wurzel = path.join(d, 'projekte'), arr = path.join(d, 'arr');
  const { url } = await stapel(t, { proj: { wurzel, arbeitsordner: arr } });
  const neu = await ruf(url, 'POST', '/proj/neu', { name: 'Rettung' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  const slug = neu.j.slug;
  const befehle = Array.from({ length: spuren }, (_, i) => ({ befehl: 'spur_neu', art: 'audio', name: `G${i + 1}` }));
  if (tempo) befehle.unshift({ befehl: 'tempo_setzen', bpm: tempo });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spuren', befehle });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  return { d, url, slug, arr, ordner: path.join(wurzel, slug), spuren: p.spuren.map((s) => ({ id: s.id, nr: s.nr })), bpm: p.tempo_bpm };
}
// a take as the crash leaves it: run file, f32 (distinct content per kennung), sidecar fertig
function hinterlasse(a, { kennung, spurIdx = 0, frames = 24000, startBeat = 4, tempo = 120 }) {
  const s = a.spuren[spurIdx];
  fs.mkdirSync(a.arr, { recursive: true });
  fs.mkdirSync(path.join(a.ordner, 'aufnahmen'), { recursive: true });
  const f32 = path.join(a.arr, `aufnahme-${s.nr}-${kennung}.f32`);
  const buf = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames * 2; i++) buf.writeFloatLE(Math.fround(0.5 * Math.sin((i + kennung * 3) / 13)), i * 4);
  fs.writeFileSync(f32, buf);
  fs.writeFileSync(f32.replace(/\.f32$/, '.json'), JSON.stringify({ status: 'fertig' }));
  fs.writeFileSync(laufDateiPfad(a.ordner, kennung), JSON.stringify({ format: LAUF_FORMAT, projekt: a.slug, kennung, seit: new Date().toISOString(), start_beat: startBeat,
    tempo_bpm: tempo, nachlauf_samples: 0, midi_spuren: [], spuren: [{ id: s.id, nr: s.nr, name: `G${spurIdx + 1}`, versatz_samples: 0, f32 }] }));
  return `take-${kennung}-${s.nr}-gerettet.wav`;
}
// the server restarted in effect: close and open again, the rescue runs at the open
async function oeffneNeu(a) {
  assert.equal((await ruf(a.url, 'POST', '/proj/schliessen', {})).code, 200);
  const r = await ruf(a.url, 'POST', '/proj/oeffnen', { slug: a.slug });
  assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 300));
  return gerettetListe(a.ordner);
}
const projekt = async (url) => (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
const record = (a, datei) => path.join(a.ordner, 'aufnahmen', `.gerettet-${/^take-(\d+)-(\d+)-/.exec(datei).slice(1, 3).join('-')}.json`);

test('end to end: open with a left run file, list, PLACE at another project tempo, one undo removes it, the record is gone and the take is not offered again', async (t) => {
  const a = await aufbau(t, { tempo: 100 });
  const datei = hinterlasse(a, { kennung: 7, frames: 48000, startBeat: 4, tempo: 120 });
  const liste = await oeffneNeu(a);
  assert.deepEqual(liste.map((x) => [x.datei, x.spur_id, x.gerettet, x.tempo_bpm]), [[datei, a.spuren[0].id, true, 120]]);
  const wav = path.join(a.ordner, 'aufnahmen', datei);
  const vorher = await projekt(a.url);
  assert.equal(vorher.tempo_bpm, 100);
  const r = await ruf(a.url, 'POST', PLATZ, { datei });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.ok, true);
  const p = await projekt(a.url);
  const spur = p.spuren[0];
  const c = spur.clips.find((x) => x.id === r.j.clip_id);
  assert.ok(c, 'clip_id is the clip of the main lane');
  assert.equal(c.start_beat, 4);
  assert.equal(c.quelle.sha256, crypto.createHash('sha256').update(fs.readFileSync(wav)).digest('hex'));
  assert.ok(Math.abs(c.laenge_beats - (48000 / 48000) * (100 / 60)) < 1e-9, `length uses the CURRENT tempo, not ${c.laenge_beats}`);
  assert.ok(!(spur.takes ?? []).some((l) => l.clips.some((x) => x.id === r.j.clip_id)), 'not one of the take-lane clips');
  assert.equal(fs.existsSync(record(a, datei)), false, 'the record file is removed after the save');
  assert.equal(fs.existsSync(wav), true, 'the WAV stays as an ordinary take');
  assert.deepEqual(await gerettetListe(a.ordner), [], 'not offered again');
  const v = (await ruf(a.url, 'GET', '/proj/verlauf')).j;
  assert.equal(v.at(-1).label, 'Place recovered take');
  const u = await ruf(a.url, 'POST', '/proj/undo', { rev: p.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  const nach = await projekt(a.url);
  assert.equal(nach.spuren[0].clips.length, 0, 'one undo removes the clip');
  assert.equal((nach.spuren[0].takes ?? []).flatMap((l) => l.clips).length, 0);
});

test('Review focus: the track was deleted after the open: veraltet_spur (ok:false, grund, text), project rev unchanged, the record stays listed', async (t) => {
  const a = await aufbau(t, { spuren: 2 });
  const datei = hinterlasse(a, { kennung: 5, spurIdx: 1 });
  await oeffneNeu(a);
  const p0 = await projekt(a.url);
  const del = await ruf(a.url, 'POST', '/proj/aendern', { rev: p0.rev, label: 'Del', befehle: [{ befehl: 'spur_loeschen', spur_id: a.spuren[1].id }] });
  assert.equal(del.code, 200, JSON.stringify(del.j));
  const rev = (await projekt(a.url)).rev;
  const r = await ruf(a.url, 'POST', PLATZ, { datei });
  assert.equal(r.code, 409, JSON.stringify(r.j));
  assert.deepEqual([r.j.ok, r.j.fehler, r.j.grund, r.j.text], [false, 'veraltet_spur', 'veraltet_spur', GRUND_TEXT.veraltet_spur]);
  assert.equal((await projekt(a.url)).rev, rev, 'project unchanged');
  assert.equal(fs.existsSync(record(a, datei)), true);
  assert.deepEqual((await gerettetListe(a.ordner)).map((x) => x.datei), [datei], 'still listed');
});

test('Review focus: the take-lane limit: placing take after take at one range ends in takes_voll, project unchanged, the record stays', async (t) => {
  const a = await aufbau(t);
  const dateien = [];
  for (let k = 1; k <= 36; k++) dateien.push(hinterlasse(a, { kennung: k, frames: 480, startBeat: 0 }));
  await oeffneNeu(a);
  let grund = null, platziert = 0, rev = 0, letzte = null;
  for (const datei of dateien) {
    rev = (await projekt(a.url)).rev;
    const r = await ruf(a.url, 'POST', PLATZ, { datei });
    if (r.code !== 200) { grund = r.j; letzte = datei; break; }
    platziert++;
  }
  assert.ok(grund, 'the lane limit was reached');
  assert.deepEqual([grund.ok, grund.fehler, grund.grund], [false, 'takes_voll', 'takes_voll']);
  assert.ok(platziert >= 10 && platziert < 36, `${platziert} placed`);
  assert.equal((await projekt(a.url)).rev, rev);
  assert.equal(fs.existsSync(record(a, letzte)), true);
});

test('Review focus: the clip limit: zu_gross, project unchanged, the record stays', async (t) => {
  const a = await aufbau(t);
  const datei = hinterlasse(a, { kennung: 3 });
  // an instrument track full of empty MIDI clips (MAX_CLIPS counts all clips)
  const s1 = await ruf(a.url, 'POST', '/proj/aendern', { rev: (await projekt(a.url)).rev, label: 'I', befehle: [{ befehl: 'spur_neu', art: 'instrument', name: 'I' }] });
  assert.equal(s1.code, 200, JSON.stringify(s1.j));
  const inst = (await projekt(a.url)).spuren.find((s) => s.art === 'instrument').id;
  for (let von = 0; von < 4095; von += 1000) {
    const n = Math.min(1000, 4095 - von);
    const r = await ruf(a.url, 'POST', '/proj/aendern', { rev: (await projekt(a.url)).rev, label: 'Fill',
      befehle: Array.from({ length: n }, (_, i) => ({ befehl: 'clip_neu', spur_id: inst, art: 'midi', start_beat: (von + i) * 2, laenge_beats: 1 })) });
    assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 200));
  }
  await oeffneNeu(a);
  const rev = (await projekt(a.url)).rev;
  const r = await ruf(a.url, 'POST', PLATZ, { datei });
  assert.equal(r.code, 409, JSON.stringify(r.j).slice(0, 200));
  assert.deepEqual([r.j.ok, r.j.fehler, r.j.grund], [false, 'zu_gross', 'zu_gross']);
  assert.equal((await projekt(a.url)).rev, rev);
  assert.equal(fs.existsSync(record(a, datei)), true);
});

test('unknown datei, a path part, an empty body: gerettet_unbekannt, nothing written; GET is not the route; a foreign origin is refused; no project: kein_projekt', async (t) => {
  const a = await aufbau(t);
  const datei = hinterlasse(a, { kennung: 2 });
  assert.equal((await ruf(a.url, 'POST', '/proj/schliessen', {})).code, 200);
  const keins = await ruf(a.url, 'POST', PLATZ, { datei });
  assert.deepEqual([keins.code, keins.j.fehler, keins.j.ok], [409, 'kein_projekt', false]);
  await oeffneNeu(a);
  const vorher = fs.readdirSync(path.join(a.ordner, 'aufnahmen')).sort();
  const rev = (await projekt(a.url)).rev;
  for (const [body, code] of [[{ datei: 'take-9-9-gerettet.wav' }, 404], [{ datei: `../${datei}` }, 400], [{ datei: `aufnahmen/${datei}` }, 400],
    [{ datei: '' }, 400], [{}, 400], [{ datei: 5 }, 400], [{ datei: '/etc/passwd' }, 400], [{ datei: datei.replace('take-', 'x-') }, 404]]) {
    const r = await ruf(a.url, 'POST', PLATZ, body);
    assert.deepEqual([r.code, r.j.fehler, r.j.ok, r.j.grund], [code, 'gerettet_unbekannt', false, 'gerettet_unbekannt'], JSON.stringify(body));
    assert.equal(r.j.text, GRUND_TEXT.gerettet_unbekannt);
  }
  assert.deepEqual(fs.readdirSync(path.join(a.ordner, 'aufnahmen')).sort(), vorher, 'nothing written');
  assert.equal((await projekt(a.url)).rev, rev);
  const g = await fetch(`${a.url}${PLATZ}`);
  assert.notEqual(g.status, 200, 'POST only');
  const fremd = await fetch(`${a.url}${PLATZ}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://boese.example' }, body: JSON.stringify({ datei }) });
  assert.deepEqual([fremd.status, (await fremd.json()).fehler], [403, 'fremde_herkunft']);
  assert.equal((await projekt(a.url)).rev, rev);
});

test('placing while a recording runs: aufnahme_laeuft', async (t) => {
  const a = await aufbau(t);
  const datei = hinterlasse(a, { kennung: 4 });
  await oeffneNeu(a);
  const p = await projekt(a.url);
  const arm = await ruf(a.url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: p.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }] });
  assert.equal(arm.code, 200, JSON.stringify(arm.j));
  const st = await ruf(a.url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  const r = await ruf(a.url, 'POST', PLATZ, { datei });
  assert.deepEqual([r.code, r.j.fehler, r.j.ok], [409, 'aufnahme_laeuft', false]);
  await warte(200);
  assert.equal((await ruf(a.url, 'POST', '/proj/aufnahme', { aktion: 'stopp' })).code, 200);
  assert.equal(fs.existsSync(record(a, datei)), true, 'the record is untouched');
});

test('gerettetListe yields the fields plan 2 needs: datei, spur_id, gerettet true', async (t) => {
  const a = await aufbau(t);
  const datei = hinterlasse(a, { kennung: 8 });
  const l = await oeffneNeu(a);
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].datei, l[0].spur_id, l[0].gerettet], [datei, a.spuren[0].id, true]);
});
