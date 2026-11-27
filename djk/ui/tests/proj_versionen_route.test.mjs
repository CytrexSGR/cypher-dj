// Project versions B10, task 3: routes, session restore (close-first design) and the guards, on the real server with the core stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { ruf, anKern, CYPHER } from './support/proj_stack.mjs';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vers-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const aktuell = async (url) => (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
// one stack per test (a second stand-in in the same test collides on the test instance)
async function start(t) {
  const d = tmp(t);
  const wurzel = path.join(d, 'projekte');
  const s = await stapel(t, { proj: { arbeitsordner: path.join(d, 'arr'), wurzel } });
  return { ...s, wurzel };
}
async function aufbau(t, vorhanden = null) {
  const { wurzel, ...s } = vorhanden ?? await start(t);
  const neu = await ruf(s.url, 'POST', '/proj/neu', { name: 'Vers' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  return { ...s, wurzel, slug: neu.j.slug, ordner: path.join(wurzel, neu.j.slug) };
}
const spurDazu = async (url, name) => {
  const p = await aktuell(url);
  const r = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: name, befehle: [{ befehl: 'spur_neu', art: 'audio', name }] });
  assert.equal(r.code, 200, JSON.stringify(r.j));
};

test('GET lists the open-time copy; nothing open gives an empty list', async (t) => {
  const v = await start(t);
  assert.deepEqual((await ruf(v.url, 'GET', '/proj/versionen')).j, { versionen: [] });
  const a = await aufbau(t, v);
  const l = (await ruf(a.url, 'GET', '/proj/versionen')).j.versionen;
  assert.equal(l.length, 1); assert.equal(l[0].auto, true); assert.match(l[0].zeit, /^\d{4}-\d\d-\d\dT.*Z$/);
});

test('SAVE VERSION: ok and id, listed with the name; empty name refused; a foreign origin refused on both POSTs', async (t) => {
  const a = await aufbau(t);
  const r = await ruf(a.url, 'POST', '/proj/version_sichern', { name: 'A' });
  assert.equal(r.code, 200); assert.equal(r.j.ok, true);
  assert.equal((await ruf(a.url, 'GET', '/proj/versionen')).j.versionen.find((v) => v.id === r.j.id).name, 'A');
  for (const b of [{}, { name: '' }, { name: '///' }]) {
    const x = await ruf(a.url, 'POST', '/proj/version_sichern', b);
    assert.deepEqual([x.code, x.j.ok, x.j.fehler, x.j.grund], [400, false, 'version_name_leer', 'version_name_leer']); assert.ok(x.j.text);
  }
  for (const pfad of ['/proj/version_sichern', '/proj/version_zurueck']) {
    const f = await fetch(`${a.url}${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://boese.example' }, body: '{}' });
    assert.deepEqual([f.status, (await f.json()).fehler], [403, 'fremde_herkunft'], pfad);
  }
});

test('SAVE VERSION without a project: kein_projekt', async (t) => {
  const s = await start(t);
  const x = await ruf(s.url, 'POST', '/proj/version_sichern', { name: 'A' });
  assert.deepEqual([x.code, x.j.ok, x.j.grund], [409, false, 'kein_projekt']);
});

test('RESTORE: old state back, safety version holds the edited state, the core got a reload, one undo brings the edit back', async (t) => {
  const a = await aufbau(t);
  const id = (await ruf(a.url, 'POST', '/proj/version_sichern', { name: 'vorher' })).j.id;
  await spurDazu(a.url, 'Neu');
  assert.equal((await aktuell(a.url)).spuren.length, 1);
  const laden0 = anKern(a.log, '/k/arr/laden').length;
  const wiederVor = JSON.parse(fs.readFileSync(path.join(a.ordner, 'project.json'), 'utf8')).wiedergabe_rev;
  const r = await ruf(a.url, 'POST', '/proj/version_zurueck', { id });
  assert.equal(r.code, 200, JSON.stringify(r.j)); assert.equal(r.j.ok, true);
  assert.equal((await aktuell(a.url)).spuren.length, 0, 'the old state is open');
  const sicher = JSON.parse(fs.readFileSync(path.join(a.ordner, '.versionen', `${r.j.gesichert_als}.json`), 'utf8'));
  assert.equal(sicher.spuren.length, 1, 'the safety version holds the edited state');
  assert.ok(anKern(a.log, '/k/arr/laden').length > laden0, 'the core received a reload (the restart check did not skip it)');
  // the stored 0 (pinned at storage level in proj_versionen_zurueck) is replaced by the fresh load's number: a full load, not a restart skip
  assert.ok(JSON.parse(fs.readFileSync(path.join(a.ordner, 'project.json'), 'utf8')).wiedergabe_rev > wiederVor);
  const u = await ruf(a.url, 'POST', '/proj/undo', { rev: (await aktuell(a.url)).rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.equal((await aktuell(a.url)).spuren.length, 1, 'undo is back at the edited state');
});

test('RESTORE of the freshly opened, never edited project works', async (t) => {
  const a = await aufbau(t);
  const id = (await ruf(a.url, 'GET', '/proj/versionen')).j.versionen[0].id;
  const r = await ruf(a.url, 'POST', '/proj/version_zurueck', { id });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal((await ruf(a.url, 'GET', '/proj/aktuell')).code, 200);
});

test('RESTORE: unknown id is version_unbekannt and the project stays open; no project is kein_projekt', async (t) => {
  const v = await start(t);
  assert.equal((await ruf(v.url, 'POST', '/proj/version_zurueck', { id: 'x' })).j.grund, 'kein_projekt');
  const a = await aufbau(t, v);
  const laden0 = anKern(a.log, '/k/arr/laden').length;
  for (const id of ['nix', '../project', '']) {
    const r = await ruf(a.url, 'POST', '/proj/version_zurueck', { id });
    assert.deepEqual([r.code, r.j.ok, r.j.fehler, r.j.grund], [404, false, 'version_unbekannt', 'version_unbekannt'], id); assert.ok(r.j.text);
  }
  assert.equal((await ruf(a.url, 'GET', '/proj/aktuell')).code, 200, 'still open');
  assert.equal(anKern(a.log, '/k/arr/laden').length, laden0, 'nothing was closed or reloaded');
});

test('RESTORE of an invalid version: refused, project reopened and unchanged, no safety version', async (t) => {
  const a = await aufbau(t);
  await spurDazu(a.url, 'Eins');
  const id = '20260101T000000000Z--kaputt';
  fs.writeFileSync(path.join(a.ordner, '.versionen', `${id}.json`), '{nein');
  const benannt = async () => (await ruf(a.url, 'GET', '/proj/versionen')).j.versionen.filter((x) => !x.auto).length;
  const n = await benannt();
  const laden0 = anKern(a.log, '/k/arr/laden').length, stopp0 = anKern(a.log, '/k/arr/stopp').length;
  const r = await ruf(a.url, 'POST', '/proj/version_zurueck', { id });
  assert.deepEqual([r.code, r.j.grund], [409, 'version_ungueltig']);
  assert.equal((await aktuell(a.url)).spuren.length, 1, 'the project stayed open with its edit');
  assert.equal(anKern(a.log, '/k/arr/laden').length, laden0, 'no core reload');
  assert.equal(anKern(a.log, '/k/arr/stopp').length, stopp0, 'no transport stop');
  assert.equal(await benannt(), n, 'no safety version (the reopen may add an automatic copy)');
  assert.equal((await ruf(a.url, 'POST', '/proj/undo', { rev: (await aktuell(a.url)).rev })).code, 200, 'the open project works');
});

test('RESTORE during a recording is refused like opening another project; the project stays open and unchanged', async (t) => {
  const s = await start(t);
  const { url } = s;
  await ruf(url, 'POST', '/proj/neu', { name: 'Rec' });
  const id = (await ruf(url, 'GET', '/proj/versionen')).j.versionen[0].id;
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'audio', name: 'Gitarre' }] });
  const p = await aktuell(url);
  const b = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: p.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }] });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  const st = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  const slug = (await ruf(url, 'GET', '/proj/liste')).j[0].slug;
  const open = await ruf(url, 'POST', '/proj/oeffnen', { slug });
  const laden0 = anKern(s.log, '/k/arr/laden').length;
  const r = await ruf(url, 'POST', '/proj/version_zurueck', { id });
  assert.deepEqual([r.code, r.j.ok, r.j.grund], [open.code, false, open.j.fehler]);
  assert.equal(open.j.fehler, 'beschaeftigt');
  assert.equal((await aktuell(url)).spuren.length, 1, 'unchanged');
  assert.equal(anKern(s.log, '/k/arr/laden').length, laden0);
  await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
});

test('sperreLaden refuses while a restore runs and is free afterwards, also after a failed restore', async (t) => {
  const a = await aufbau(t);
  const sitz = a.o.proj.sitzung;
  const id = (await ruf(a.url, 'GET', '/proj/versionen')).j.versionen[0].id;
  const frei = () => { try { sitz.sperreLaden()(); return true; } catch (e) { return e.fehler === 'beschaeftigt' ? false : (() => { throw e; })(); } };
  assert.equal(frei(), true, 'free before');
  // sample from inside the storage call, which runs inside oeffnetGerade
  const echt = sitz.projekte.stelleWiederHer.bind(sitz.projekte);
  const waehrend = [];
  sitz.projekte.stelleWiederHer = (...x) => { waehrend.push(frei()); return echt(...x); };
  await sitz.versionZurueck(id, 'andreas');
  assert.deepEqual(waehrend, [false], 'refused while the restore runs');
  assert.equal(frei(), true, 'free after');
  sitz.projekte.stelleWiederHer = () => { throw new Error('boom'); };
  await assert.rejects(sitz.versionZurueck(id, 'andreas'), /boom/);
  assert.equal(frei(), true, 'free after a failed restore');
  assert.equal((await ruf(a.url, 'GET', '/proj/aktuell')).code, 200, 'the project was reopened');
});

test('SAVE VERSION respects Stop Cypher: cypher is refused with ki_gestoppt, andreas may save', async (t) => {
  const a = await aufbau(t);
  await innen(a.o).kiStopp(true);
  const x = await ruf(a.url, 'POST', '/proj/version_sichern', { name: 'K' }, CYPHER);
  assert.deepEqual([x.code, x.j.fehler], [409, 'ki_gestoppt']);   // strand 9: the page server's agent gate answers before the route
  assert.equal((await ruf(a.url, 'GET', '/proj/versionen')).j.versionen.some((v) => v.name === 'K'), false);
  assert.equal((await ruf(a.url, 'POST', '/proj/version_sichern', { name: 'K' })).code, 200);
});
