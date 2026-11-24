// finden, relink, aufraeumen (browser plan 2, task 2): the pure `unreferenziert` and the three routes in the real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, CYPHER } from './support/proj_stack.mjs';
import { baueKatalog } from './support/catalog.mjs';
import { innen } from './support/inside.mjs';
import { unreferenziert } from '../areas/proj/files_view.ts';
import { specProjekt, tmpOrdner, SHA_A } from './support/project.mjs';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-dakt-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SHA_D = 'd'.repeat(64);
// files are written an hour in the past: CLEAN UP leaves files newer than the last saved project state alone (`neu` writes one that is not backdated)
const schreibe = (ordner, rel, inhalt = 'x', neu = false) => {
  const p = path.join(ordner, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, inhalt);
  if (!neu) { const alt = new Date(Date.now() - 3600_000); fs.utimesSync(p, alt, alt); }
  return p;
};
const clip = (id, s, hinweis) => ({ id, art: 'audio', name: id, start_beat: 0, laenge_beats: 1, quelle: { sha256: s, pfad_hinweis: hinweis }, dekodiert: 'fertig',
  offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
// hints are absolute, as the take, bounce, resample and stems routes write them
function projektMit(d) {
  const p = specProjekt();
  p.spuren[0].clips = [clip('c1', SHA_A, path.join(d, 'audio/kick-aaaaaaaa.wav')), clip('c5', SHA_D, path.join(d, 'aufnahmen/take-1-1.wav'))];
  return p;
}
function ordnerMit(t) {
  const d = tmpOrdner(t);
  for (const r of ['audio/kick-aaaaaaaa.wav', 'audio/old-bbbbbbbb.wav', 'aufnahmen/take-1-1.wav', 'aufnahmen/take-2-1.wav', 'export/x/mix.wav', '.versionen/1.json']) schreibe(d, r);
  return d;
}

test('unreferenziert: exactly the two unnamed files; export, dot entries and project files are never listed', (t) => {
  const d = ordnerMit(t);
  assert.deepEqual(unreferenziert({ projekt: projektMit(d), ordner: d, gerettet: [] }), ['audio/old-bbbbbbbb.wav', 'aufnahmen/take-2-1.wav']);
});

test('unreferenziert: a rescued take is protected by its name and by the list, even without a clip naming it', (t) => {
  const d = ordnerMit(t);
  schreibe(d, 'aufnahmen/take-9-1-gerettet.wav'); schreibe(d, 'aufnahmen/.gerettet-9-1.json');
  schreibe(d, 'aufnahmen/take-5-1.wav');
  const r = unreferenziert({ projekt: projektMit(d), ordner: d, gerettet: [{ datei: 'take-5-1.wav' }] });
  assert.deepEqual(r, ['audio/old-bbbbbbbb.wav', 'aufnahmen/take-2-1.wav']);
});

test('unreferenziert: a run file in aufnahmen/ protects everything there, until it is gone', (t) => {
  const d = ordnerMit(t);
  schreibe(d, 'aufnahmen/.laufend-x.json');
  assert.deepEqual(unreferenziert({ projekt: projektMit(d), ordner: d, gerettet: [] }), ['audio/old-bbbbbbbb.wav']);
  fs.rmSync(path.join(d, 'aufnahmen', '.laufend-x.json'));
  assert.deepEqual(unreferenziert({ projekt: projektMit(d), ordner: d, gerettet: [] }), ['audio/old-bbbbbbbb.wav', 'aufnahmen/take-2-1.wav']);
});

test('unreferenziert: never descends into dot folders; stems, bounce and resample are walked', (t) => {
  const d = ordnerMit(t);
  schreibe(d, '.versionen/3/project.json'); schreibe(d, '.versionen/3/audio/old-cccccccc.wav'); schreibe(d, '.papierkorb/s/audio/z-dddddddd.wav');
  schreibe(d, 'stems/Drums.wav'); schreibe(d, 'bounce/b.wav'); schreibe(d, 'resample/r.wav');
  assert.deepEqual(unreferenziert({ projekt: projektMit(d), ordner: d, gerettet: [] }),
    ['audio/old-bbbbbbbb.wav', 'aufnahmen/take-2-1.wav', 'bounce/b.wav', 'resample/r.wav', 'stems/Drums.wav']);
});

// a server with a catalogue that knows one outside file; the project is open and has one clip of it
async function aufbau(t, { katalogDa = true, projExtra = {} } = {}) {
  const d = tmp(t);
  const datei = schreibe(d, 'platte/Kick Drum.wav', 'kick-bytes');
  const s = sha('kick-bytes');
  const katalog = katalogDa ? baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'oneshot', sha: s, pfad: datei, dauer_s: 1 }]) : path.join(d, 'kat', 'gibt-es-nicht.sqlite');
  const st = await stapel(t, { katalog, proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr'), ...projExtra } });
  const { url } = st;
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Actions' })).code, 200);
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'Drums' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const c = !katalogDa ? { code: 200 } : await ruf(url, 'POST', '/proj/aendern', { rev: a.j.rev, label: 'Clip', befehle: [{ befehl: 'clip_neu', spur_id: a.j.projekt.spuren[0].id, art: 'audio',
    start_beat: 0, laenge_beats: 1, sha256: s }] });
  assert.equal(c.code, 200, JSON.stringify(c.j));
  const slug = (await ruf(url, 'GET', '/proj/liste')).j[0].slug;
  return { ...st, d, datei, s, slug, projOrdner: path.join(d, 'proj', slug) };
}
const fehlerForm = (r) => { assert.equal(r.j.ok, false); assert.equal(r.j.grund, r.j.fehler); assert.ok(typeof r.j.text === 'string' && r.j.text.length > 3, JSON.stringify(r.j)); };

test('aufraeumen: nur_zeigen moves nothing, {} moves to .papierkorb, export stays, a second call finds nothing', async (t) => {
  const x = await aufbau(t);
  for (const r of ['audio/old-bbbbbbbb.wav', 'aufnahmen/take-2-1.wav', 'export/x/mix.wav']) schreibe(x.projOrdner, r);
  const zeige = await ruf(x.url, 'POST', '/proj/aufraeumen', { nur_zeigen: true });
  assert.deepEqual([zeige.code, zeige.j.dateien, zeige.j.verschoben], [200, ['audio/old-bbbbbbbb.wav', 'aufnahmen/take-2-1.wav'], false]);
  assert.ok(fs.existsSync(path.join(x.projOrdner, 'audio/old-bbbbbbbb.wav')));
  const echt = await ruf(x.url, 'POST', '/proj/aufraeumen', {});
  assert.deepEqual([echt.j.dateien, echt.j.verschoben], [['audio/old-bbbbbbbb.wav', 'aufnahmen/take-2-1.wav'], true]);
  assert.ok(!fs.existsSync(path.join(x.projOrdner, 'audio/old-bbbbbbbb.wav')));
  const bin = path.join(x.projOrdner, '.papierkorb');
  const stempel = fs.readdirSync(bin);
  assert.equal(stempel.length, 1);
  assert.ok(fs.existsSync(path.join(bin, stempel[0], 'audio/old-bbbbbbbb.wav')));
  assert.ok(fs.existsSync(path.join(bin, stempel[0], 'aufnahmen/take-2-1.wav')));
  assert.ok(fs.existsSync(path.join(x.projOrdner, 'export/x/mix.wav')));
  assert.deepEqual((await ruf(x.url, 'POST', '/proj/aufraeumen', {})).j.dateien, []);
});

test('aufraeumen: a rescued take and versions stay whole, a rejecting gerettetListe does not break the route', async (t) => {
  const x = await aufbau(t, { projExtra: { gerettetListe: async () => { throw new Error('plan 4 broke'); } } });
  schreibe(x.projOrdner, 'aufnahmen/take-9-1-gerettet.wav'); schreibe(x.projOrdner, 'aufnahmen/.gerettet-9-1.json');
  schreibe(x.projOrdner, '.versionen/3/project.json'); schreibe(x.projOrdner, '.versionen/3/audio/old-cccccccc.wav');
  const r = await ruf(x.url, 'POST', '/proj/aufraeumen', {});
  assert.deepEqual([r.code, r.j.dateien], [200, []]);
  for (const p of ['aufnahmen/take-9-1-gerettet.wav', 'aufnahmen/.gerettet-9-1.json', '.versionen/3/project.json', '.versionen/3/audio/old-cccccccc.wav']) {
    assert.ok(fs.existsSync(path.join(x.projOrdner, p)), p);
  }
});

test('relink: a file with another content hash is refused 409 sha_stimmt_nicht and nothing is copied; the right file is copied and the clip is found', async (t) => {
  const x = await aufbau(t);
  fs.rmSync(x.datei);
  const weg = await ruf(x.url, 'GET', '/proj/dateien');
  assert.deepEqual([weg.j.audio[0].fehlt, weg.j.fehlend], [true, [x.s]]);
  const falsch = schreibe(x.d, 'anderswo/falsch.wav', 'other-bytes');
  const r = await ruf(x.url, 'POST', '/proj/relink', { sha256: x.s, pfad: falsch });
  assert.deepEqual([r.code, r.j.fehler], [409, 'sha_stimmt_nicht']); fehlerForm(r);
  assert.ok(!fs.existsSync(path.join(x.projOrdner, 'audio')) || fs.readdirSync(path.join(x.projOrdner, 'audio')).length === 0);
  const richtig = schreibe(x.d, 'anderswo/Kick Drum.wav', 'kick-bytes');
  const ok = await ruf(x.url, 'POST', '/proj/relink', { sha256: x.s, pfad: richtig });
  assert.deepEqual([ok.code, ok.j.ok], [200, true]);
  assert.ok(fs.existsSync(path.join(x.projOrdner, 'audio', `kick-drum-${x.s.slice(0, 8)}.wav`)));
  const da = await ruf(x.url, 'GET', '/proj/dateien');
  assert.deepEqual([da.j.audio[0].sha256, da.j.audio[0].fehlt, da.j.fehlend], [x.s, false, []]);
});

test('relink: a directory or an unreadable path is 400 datei_unlesbar', async (t) => {
  const x = await aufbau(t);
  for (const pfad of [x.d, path.join(x.d, 'gibt-es-nicht.wav')]) {
    const r = await ruf(x.url, 'POST', '/proj/relink', { sha256: x.s, pfad });
    assert.deepEqual([r.code, r.j.fehler], [400, 'datei_unlesbar']); fehlerForm(r);
  }
});

test('finden: a sha the catalogue knows at an existing path is copied into audio/ and answers ok with the path; an unknown sha is 200 nicht_gefunden', async (t) => {
  const x = await aufbau(t);
  const r = await ruf(x.url, 'POST', '/proj/finden', { sha256: x.s });
  assert.deepEqual([r.code, r.j.ok], [200, true], JSON.stringify(r.j));
  assert.equal(r.j.pfad, path.join(x.projOrdner, 'audio', `kick-drum-${x.s.slice(0, 8)}.wav`));
  assert.equal(fs.readFileSync(r.j.pfad, 'utf8'), 'kick-bytes');
  const u = await ruf(x.url, 'POST', '/proj/finden', { sha256: sha('unbekannt') });
  assert.deepEqual([u.code, u.j.ok, u.j.grund], [200, false, 'nicht_gefunden']); fehlerForm(u);
});

test('finden without a catalogue file answers 503 katalog_fehlt', async (t) => {
  const x = await aufbau(t, { katalogDa: false });
  const r = await ruf(x.url, 'POST', '/proj/finden', { sha256: x.s });
  assert.deepEqual([r.code, r.j.fehler], [503, 'katalog_fehlt']); fehlerForm(r);
});

test('a write by cypher with Stop Cypher on is 409 ki_gestoppt; Andreas is not stopped', async (t) => {
  const x = await aufbau(t);
  await innen(x.o).kiStopp(true);
  for (const [pfad, koerper] of [['/proj/aufraeumen', {}], ['/proj/finden', { sha256: x.s }], ['/proj/relink', { sha256: x.s, pfad: x.datei }]]) {
    const r = await ruf(x.url, 'POST', pfad, koerper, CYPHER);
    assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt'], pfad);
  }
  assert.equal((await ruf(x.url, 'POST', '/proj/aufraeumen', {})).code, 200);
});

test('without a project the actions answer 409 kein_projekt, a bad body 400', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  for (const [pfad, koerper] of [['/proj/aufraeumen', {}], ['/proj/finden', { sha256: 'a'.repeat(64) }], ['/proj/relink', { sha256: 'a'.repeat(64), pfad: '/x' }]]) {
    const r = await ruf(url, 'POST', pfad, koerper);
    assert.deepEqual([r.code, r.j.fehler], [409, 'kein_projekt'], pfad); fehlerForm(r);
  }
});

// ---- review rework: absolute hints, `.teil` files, running jobs, files newer than the save ----
const ROUTEN = { take: 'aufnahmen/take-7-1.wav', bounce: 'bounce/bounce-3.wav', resample: 'resample/resample-2.wav', stems: 'stems/4-Beat-bass.wav' };

for (const [art, rel] of Object.entries(ROUTEN)) {
  test(`aufraeumen: a clip made the way the ${art} route makes it (absolute hint) keeps its file out of the list`, async (t) => {
    const x = await aufbau(t);
    const datei = schreibe(x.projOrdner, rel);
    // the routes place a clip whose sha the catalogue does not know, with the absolute path as the hint (/proj/aendern would swap in the catalogue path):
    // the stored project.json gets such a clip while another project is open, then the project is opened again
    assert.equal((await ruf(x.url, 'POST', '/proj/neu', { name: 'Other' })).code, 200);
    const pj = path.join(x.projOrdner, 'project.json');
    const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
    j.spuren[0].clips.push(clip(`k-${art}`, sha(art), datei));
    fs.writeFileSync(pj, JSON.stringify(j));
    assert.equal((await ruf(x.url, 'POST', '/proj/oeffnen', { slug: x.slug })).code, 200);
    const r = await ruf(x.url, 'POST', '/proj/aufraeumen', {});
    assert.deepEqual([r.code, r.j.dateien], [200, []]);
    assert.ok(fs.existsSync(datei));
  });
}

test('unreferenziert: an absolute hint reached through a linked project folder still protects its file', (t) => {
  const d = tmp(t); const echt = path.join(d, 'echt'); const link = path.join(d, 'link');
  schreibe(echt, 'bounce/bounce-3.wav'); fs.symlinkSync(echt, link);
  const p = specProjekt();
  p.spuren[0].clips = [clip('c1', SHA_D, path.join(echt, 'bounce/bounce-3.wav'))];
  assert.deepEqual(unreferenziert({ projekt: p, ordner: link, gerettet: [] }), []);
});

test('unreferenziert: a `.teil` file is never listed', (t) => {
  const d = tmpOrdner(t);
  schreibe(d, 'bounce/bounce-3.wav.123.teil'); schreibe(d, 'stems/x.wav.teil'); schreibe(d, 'bounce/old.wav');
  assert.deepEqual(unreferenziert({ projekt: specProjekt(), ordner: d, gerettet: [] }), ['bounce/old.wav']);
});

test('unreferenziert: a file newer than the saved project.json is not a candidate', (t) => {
  const d = tmpOrdner(t);
  const pj = schreibe(d, 'project.json', '{}', true);
  const vor = new Date(Date.now() - 1800_000); fs.utimesSync(pj, vor, vor);
  schreibe(d, 'bounce/alt.wav'); schreibe(d, 'bounce/frisch.wav', 'x', true);
  assert.deepEqual(unreferenziert({ projekt: specProjekt(), ordner: d, gerettet: [] }), ['bounce/alt.wav']);
});

test('aufraeumen: while a bounce, resample or stems job runs the move is refused 409 aufraeumen_laeuft_arbeit and nothing moves; nur_zeigen still answers', async (t) => {
  let laeuft = true;
  const x = await aufbau(t, { projExtra: { arbeitLaeuft: () => laeuft } });
  const datei = schreibe(x.projOrdner, 'bounce/orphan.wav');
  const r = await ruf(x.url, 'POST', '/proj/aufraeumen', {});
  assert.deepEqual([r.code, r.j.grund], [409, 'aufraeumen_laeuft_arbeit']);
  fehlerForm(r);
  assert.ok(fs.existsSync(datei));
  assert.deepEqual((await ruf(x.url, 'POST', '/proj/aufraeumen', { nur_zeigen: true })).j.dateien, ['bounce/orphan.wav']);
  laeuft = false;
  assert.equal((await ruf(x.url, 'POST', '/proj/aufraeumen', {})).j.verschoben, true);
});
