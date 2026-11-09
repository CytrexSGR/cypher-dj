// 1.14 comping, slice 1, task 5: take clips are decoded like main clips (spec R9, AK12). Pure part: gleicheDekodiertAb and setzeDekodiert.
// Session part (harness proj_stapel): decode on open, the decode event, undo of take_loeschen, and the waveform route for a take-only sha.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fuehreListeAus, gleicheDekodiertAb, setzeDekodiert } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';
import { baueKatalog } from './support/catalog.mjs';

const SHA_H = 'a'.repeat(64);   // main clip sha
const SHA_T = 'e'.repeat(64);   // sha that only a take clip carries
const clipJ = (id, sha, von, laenge, hinweis = '') => ({ id, art: 'audio', name: id, start_beat: von, laenge_beats: laenge,
  quelle: { sha256: sha, pfad_hinweis: hinweis }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });

// --- pure part ---------------------------------------------------------------------------------------------------------------------------
function mitTake() {
  let p = neuesProjekt('T');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: 'G' }]).projekt;
  p.spuren[0].clips = [clipJ('c1', SHA_H, 0, 4)];
  p.spuren[0].takes = [{ id: 't1', name: 'Take 1', clips: [clipJ('c2', SHA_T, 0, 4)] }];
  return p;
}

test('gleicheDekodiertAb: a take clip gets the state of its sha like a main clip, rev goes up once', () => {
  const p = mitTake();
  const q = gleicheDekodiertAb(p, (sha) => (sha === SHA_T ? 'fertig' : 'nein'));
  assert.equal(q.spuren[0].takes[0].clips[0].dekodiert, 'fertig');
  assert.equal(q.spuren[0].clips[0].dekodiert, 'nein');
  assert.equal(q.rev, p.rev + 1);
});

test('setzeDekodiert: take clips too (the undo hook)', () => {
  const p = mitTake();
  setzeDekodiert(p, () => 'fertig');
  assert.deepEqual([p.spuren[0].clips[0].dekodiert, p.spuren[0].takes[0].clips[0].dekodiert], ['fertig', 'fertig']);
});

test('negative control: a project without takes asks the state function for exactly the main clip shas, as before', () => {
  const p = mitTake();
  delete p.spuren[0].takes;
  const gefragt = [];
  assert.equal(gleicheDekodiertAb(p, (sha) => { gefragt.push(sha); return 'nein'; }), p, 'nothing changed: the same object');
  assert.deepEqual(gefragt, [SHA_H]);
});

// The undo hook in isolation (history.ts umkehren): the session repairs the state afterwards anyway (vollziehe -> gleicheDekodiertAb), so only a
// test below the session can pin setzeDekodiert itself.
function verlaufMitZweiLanes(t) {
  const p = mitTake();
  p.spuren[0].takes.push({ id: 't2', name: 'Take 2', clips: [clipJ('c3', 'f'.repeat(64), 0, 4)] });
  const v = new Verlauf(path.join(tmp(t), 'undo.jsonl'), { zeitgeber: false });
  return { p, v, meta: { quelle: 'andreas', label: 'Del' }, fertig: { haken: { dekodiert: () => 'fertig' } } };
}
const takeZustaende = (p) => (p.spuren[0].takes ?? []).flatMap((x) => x.clips.map((c) => [c.id, c.dekodiert]));

test('undo of take_loeschen: the hook sets the restored take clips to the state of their sha', (t) => {
  const { p, v, meta } = verlaufMitZweiLanes(t);
  const w = aendere(v, p, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't1' }], meta);
  assert.deepEqual(takeZustaende(w.projekt), [['c3', 'nein']]);
  const u = rueckgaengig(v, w.projekt, meta, { dekodiert: () => 'fertig' });
  assert.deepEqual(takeZustaende(u.projekt), [['c2', 'fertig'], ['c3', 'fertig']]);
});

test('redo of take_loeschen: the hook also sets the take clips that stay (negative control: main clip is set the same way)', (t) => {
  const { p, v, meta } = verlaufMitZweiLanes(t);
  const w = aendere(v, p, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't1' }], meta);
  const u = rueckgaengig(v, w.projekt, meta, { dekodiert: () => 'fertig' });
  const stale = structuredClone(u.projekt); stale.spuren[0].takes.forEach((x) => x.clips.forEach((c) => { c.dekodiert = 'nein'; }));
  const r = wiederholen(v, stale, meta, { dekodiert: () => 'fertig' });
  assert.deepEqual(takeZustaende(r.projekt), [['c3', 'fertig']]);
  assert.equal(r.projekt.spuren[0].clips[0].dekodiert, 'fertig', 'main clip');
});

// --- session part ------------------------------------------------------------------------------------------------------------------------
const tmp = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-compdek-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
// 1 s of a 440 Hz sine, 48 kHz mono 16 bit
function schreibeWav(datei, sek = 1) {
  const n = 48000 * sek, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 48000)), 44 + i * 2);
  fs.writeFileSync(datei, b);
}
// open a project whose only audio is one take clip (sha SHA_T, the file is the hint); the main lane is empty (the main copy was overwritten)
async function oeffneNurTake(t, extra = (_j, _wav) => {}) {
  const d = tmp(t);
  const { url } = await stapel(t, { katalog: baueKatalog(d, []), proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Dek' });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'Gitarre' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const wav = path.join(d, 'take.wav'); schreibeWav(wav);
  const slug = (await ruf(url, 'GET', '/proj/liste')).j[0].slug;
  const datei = path.join(d, 'proj', slug, 'project.json');
  const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  j.spuren[0].clips = [];
  j.spuren[0].takes = [{ id: 't1', name: 'Take 1', clips: [clipJ('c9', SHA_T, 0, 4, wav)] }];
  j.naechste_id.clip = 10; j.naechste_id.take = 2;
  extra(j, wav);
  fs.writeFileSync(datei, JSON.stringify(j));
  return { url, d, slug, wav };
}
const warteFertig = async (url) => {
  for (let i = 0; i < 600; i++) { if ((await takeClip(url))?.dekodiert === 'fertig') return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
};
const takeClip = async (url) => (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].takes?.[0]?.clips[0];

test('opening a project requests the decode of a sha that only a take clip carries; the take clip becomes fertig', async (t) => {
  const { url, slug, d } = await oeffneNurTake(t);
  const o = await ruf(url, 'POST', '/proj/oeffnen', { slug });
  assert.equal(o.code, 200, JSON.stringify(o.j));
  assert.ok(await warteFertig(url), `take clip state: ${(await takeClip(url))?.dekodiert}`);
  assert.ok(fs.existsSync(path.join(d, 'arr', 'audio', `${SHA_T}.f32`)), 'the decoded file exists');
});

test('undo of take_loeschen: the restored take clip is fertig again when its sha is decoded', async (t) => {
  const { url, slug } = await oeffneNurTake(t);
  assert.equal((await ruf(url, 'POST', '/proj/oeffnen', { slug })).code, 200);
  assert.ok(await warteFertig(url), 'precondition: decoded');
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const l = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Del', befehle: [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't1' }] });
  assert.equal(l.code, 200, JSON.stringify(l.j));
  const q = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal('takes' in q.spuren[0], false, 'the lane is gone');
  const u = await ruf(url, 'POST', '/proj/undo', { rev: q.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.equal((await takeClip(url)).dekodiert, 'fertig', 'restored take clip carries the state of its sha');
});

test('GET /welle?sha= serves a take-only sha through the open project (200); a sha no clip carries is 404 (negative control)', async (t) => {
  const { url, slug } = await oeffneNurTake(t);
  assert.equal((await ruf(url, 'POST', '/proj/oeffnen', { slug })).code, 200);
  const r = await fetch(`${url}/welle?sha=${SHA_T}`);
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok((await r.arrayBuffer()).byteLength > 0);
  const n = await fetch(`${url}/welle?sha=${'d'.repeat(64)}`);
  assert.equal(n.status, 404);
});

// --- playback reload: only a changed MAIN clip reaches the playback (task 5 round 2) ----------------------------------------------------------
const wrev = async (url) => (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.wiedergabe_rev;
const alleFertig = async (url) => {
  for (let i = 0; i < 800; i++) {
    const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
    const cs = p.spuren[0].clips.concat((p.spuren[0].takes ?? []).flatMap((x) => x.clips));
    if (cs.every((c) => c.dekodiert === 'fertig')) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};
const SHAS8 = Array.from({ length: 8 }, (_, i) => (i + 1).toString(16).repeat(64));

test('8 take-only shas decoded: wiedergabe_rev rises by at most 1 against the state right after opening', async (t) => {
  const { url, slug } = await oeffneNurTake(t, (j, w) => {
    j.spuren[0].takes = [{ id: 't1', name: 'Take 1', clips: SHAS8.map((sha, i) => clipJ(`c${20 + i}`, sha, i * 4, 4, w)) }];
  });
  assert.equal((await ruf(url, 'POST', '/proj/oeffnen', { slug })).code, 200);
  const vor = await wrev(url);
  assert.ok(await alleFertig(url), 'all eight take clips decoded');
  await new Promise((r) => setTimeout(r, 300));
  const nach = await wrev(url);
  assert.ok(nach - vor <= 1, `wiedergabe_rev ${vor} -> ${nach}`);
});

test('negative control: a changed main clip does reload the playback', async (t) => {
  const { url, slug } = await oeffneNurTake(t, (j, w) => {
    j.spuren[0].clips = [clipJ('c30', SHAS8[0], 0, 4, w)];
    delete j.spuren[0].takes;
  });
  assert.equal((await ruf(url, 'POST', '/proj/oeffnen', { slug })).code, 200);
  const vor = await wrev(url);
  assert.ok(await alleFertig(url), 'main clip decoded');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(await wrev(url) > vor, 'wiedergabe_rev rose');
});
