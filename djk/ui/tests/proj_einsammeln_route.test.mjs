// POST /proj/einsammeln and the background collector in the session (storage layout A5, task 11). Real server on the test instance, catalog with real shas.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { ruf } from './support/proj_stack.mjs';
import { baueKatalog } from './support/catalog.mjs';
import { Einsammler } from '../project/einsammeln.ts';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-einsr-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// a server whose catalog knows one outside file; the project is open and has an audio track
async function aufbau(t, einsammler) {
  const d = tmp(t);
  const datei = path.join(d, 'platte', 'HomeLW', '01 MP3', 'Kick Drum.wav');
  fs.mkdirSync(path.dirname(datei), { recursive: true }); fs.writeFileSync(datei, 'kick-bytes');
  const s = sha('kick-bytes');
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'oneshot', sha: s, pfad: datei, dauer_s: 1 }]);
  const { url } = await stapel(t, { katalog, proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr'), ...(einsammler ? { einsammler } : {}) } });
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Collect' })).code, 200);
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'Drums' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const slug = (await ruf(url, 'GET', '/proj/liste')).j[0].slug;
  const clipNeu = (rev) => ruf(url, 'POST', '/proj/aendern', { rev, label: 'Clip', befehle: [{ befehl: 'clip_neu', spur_id: a.j.projekt.spuren[0].id, art: 'audio', start_beat: 0,
    laenge_beats: 1, sha256: s }] });
  return { url, d, datei, s, slug, projOrdner: path.join(d, 'proj', slug), rev: a.j.rev, clipNeu };
}

test('POST /proj/einsammeln answers the report', async (t) => {
  const e = new Einsammler({ wechselplatte: () => false, frei: () => true });
  t.after(async () => { await e.schliesse(); });
  const x = await aufbau(t, e);
  const c = await x.clipNeu(x.rev);
  assert.equal(c.code, 200, JSON.stringify(c.j));
  const r = await ruf(x.url, 'POST', '/proj/einsammeln', {});
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j, { kopiert: 1, schon_da: 0, fehlt: [], abweichend: [], bytes: 10, aufgeschoben: 0, fehlt_grund: {} });
  assert.equal(fs.readFileSync(path.join(x.projOrdner, 'audio', `kick-drum-${x.s.slice(0, 8)}.wav`), 'utf8'), 'kick-bytes');
  assert.deepEqual((await ruf(x.url, 'POST', '/proj/einsammeln', {})).j.schon_da, 1, 'a second press copies nothing');
  const feld = await ruf(x.url, 'POST', '/proj/einsammeln', { alles: true });
  assert.deepEqual([feld.code, feld.j.fehler], [400, 'argument_ungueltig']);
  assert.match(feld.j.text, /^this request takes no fields/);
  const kaputt = await fetch(`${x.url}/proj/einsammeln`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":' });
  assert.equal(kaputt.status, 400);
});

test('without a project 409 kein_projekt', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  const r = await ruf(url, 'POST', '/proj/einsammeln', {});
  assert.deepEqual([r.code, r.j.fehler, r.j.text], [409, 'kein_projekt', 'no project is open']);
});

test('the button is refused while the transport runs', async (t) => {
  let frei = false;
  const e = new Einsammler({ wechselplatte: () => false, frei: () => frei });
  t.after(async () => { await e.schliesse(); });
  const x = await aufbau(t, e);
  await x.clipNeu(x.rev);
  const r = await ruf(x.url, 'POST', '/proj/einsammeln', {});
  assert.deepEqual([r.code, r.j.fehler, r.j.text], [409, 'transport_laeuft', 'music is playing: collecting starts when it stops']);
  assert.ok(!fs.existsSync(path.join(x.projOrdner, 'audio')), 'nothing copied');
  frei = true;
  assert.equal((await ruf(x.url, 'POST', '/proj/einsammeln', {})).code, 200, 'positive control: the same call passes when idle');
});

test('clip_neu with a source on a removable root is collected in the background', async (t) => {
  const e = new Einsammler({ wechselplatte: () => true, frei: () => true });
  t.after(async () => { await e.schliesse(); });
  const x = await aufbau(t, e);
  await e.leer();   // the open of the project had nothing to collect
  assert.ok(!fs.existsSync(path.join(x.projOrdner, 'audio')));
  const c = await x.clipNeu(x.rev);
  assert.equal(c.code, 200, JSON.stringify(c.j));
  await e.leer();
  assert.deepEqual(fs.readdirSync(path.join(x.projOrdner, 'audio')), [`kick-drum-${x.s.slice(0, 8)}.wav`]);
  assert.ok(fs.existsSync(x.datei), 'the source stays');
  // the copy is found when the source is gone
  fs.rmSync(x.datei);
  const nochmal = await ruf(x.url, 'POST', '/proj/einsammeln', {});
  assert.deepEqual([nochmal.code, nochmal.j.schon_da, nochmal.j.fehlt], [200, 1, []], 'the copy counts, the missing source is no problem');
});

test('the quellen flag wins over the path rule', async (t) => {
  const d = tmp(t);
  const proj = path.join(d, 'proj'); fs.mkdirSync(proj);
  const datei = path.join(d, 'x.wav'); fs.writeFileSync(datei, 'x');
  const clipVon = (pfad) => ({ spuren: [{ id: 's1', clips: [{ id: 'c1', art: 'audio', quelle: { sha256: sha('x'), pfad_hinweis: pfad } }], takes: [] }] });
  const versuche = [];
  const lauf = async (cmd, args) => { versuche.push(args.at(-2)); return { code: 1, stdout: '' }; };
  // flag false: a path under /media is not removable, so nothing is even tried
  const nein = new Einsammler({ wechselplatte: () => false, frei: () => true, lauf });
  nein.melde({ projekt: clipVon('/media/u/Disk/x.wav'), projektOrdner: proj, quellPfad: (_s, h) => h });
  await nein.leer();
  assert.deepEqual(versuche, []);
  // flag true: a path outside /media counts as removable, the copy is tried
  const ja = new Einsammler({ wechselplatte: () => true, frei: () => true, lauf });
  ja.melde({ projekt: clipVon(datei), projektOrdner: proj, quellPfad: (_s, h) => h });
  await ja.leer();
  assert.deepEqual(versuche, [datei]);
});

test('a deck that plays holds back the button and the background job although the transport stands', async (t) => {
  const d = tmp(t);
  const datei = path.join(d, 'k.wav'); fs.writeFileSync(datei, 'kick-bytes');
  const s = sha('kick-bytes');
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'oneshot', sha: s, pfad: datei, dauer_s: 1 }]);
  const { o, url } = await stapel(t, { katalog, proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  const i = innen(o);
  i.vomKern('/zustand/arr', { nr: 1, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  await ruf(url, 'POST', '/proj/neu', { name: 'Box' });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'Drums' }] });
  await ruf(url, 'POST', '/proj/aendern', { rev: a.j.rev, label: 'Clip', befehle: [{ befehl: 'clip_neu', spur_id: a.j.projekt.spuren[0].id, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: s }] });
  i.vomKern('/zustand/deck', { deck: 1, status: 2, material_id: 'x', basis_bpm: 128, fassung: 1, quell_beat: 0, beats_bis_ende: 64, faktor: 1, vorlauf_ms: 0 });   // the deck runs (loop boxes are gone: container core M10)
  const r = await ruf(url, 'POST', '/proj/einsammeln', {});
  assert.deepEqual([r.code, r.j.fehler], [409, 'transport_laeuft']);
  assert.match(r.j.text, /^music is playing/);
  i.vomKern('/zustand/deck', { deck: 1, status: 0, material_id: 'x', basis_bpm: 128, fassung: 1, quell_beat: 0, beats_bis_ende: 0, faktor: 1, vorlauf_ms: 0 });   // the deck stops
  assert.equal((await ruf(url, 'POST', '/proj/einsammeln', {})).code, 200, 'positive control: idle again');
});

test('the button does not hang on a stuck copy: it answers at the time limit', async (t) => {
  const e = new Einsammler({ wechselplatte: () => false, frei: () => true, zeit: () => 80,
    lauf: (cmd, args, o = {}) => new Promise((_ok, f) => o.signal?.addEventListener('abort', () => f(new Error('aborted')), { once: true })) });
  t.after(async () => { await e.schliesse(); });
  const x = await aufbau(t, e);
  await x.clipNeu(x.rev);
  const r = await ruf(x.url, 'POST', '/proj/einsammeln', {});
  assert.equal(r.code, 200);
  assert.deepEqual([r.j.kopiert, r.j.fehlt, r.j.fehlt_grund], [0, [x.s], { [x.s]: 'timeout' }]);
});

test('the job keeps the slug of the project it was reported for after a project switch', async (t) => {
  const d = tmp(t);
  const gemeldet = [];
  class Spion extends Einsammler { melde(a) { gemeldet.push(a); super.melde(a); } }
  const e = new Spion({ wechselplatte: () => false, frei: () => false, warteMs: 20 });
  t.after(async () => { await e.schliesse(); });
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr'), einsammler: e } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Eins' });
  const slugA = (await ruf(url, 'GET', '/proj/liste')).j[0].slug;
  const rel = path.join(d, 'proj', slugA, 'material'); fs.mkdirSync(rel); fs.writeFileSync(path.join(rel, 'k.wav'), 'k');
  await ruf(url, 'POST', '/proj/oeffnen', { slug: slugA });
  const meldungA = gemeldet.at(-1);
  assert.equal(path.basename(meldungA.projektOrdner), slugA);
  await ruf(url, 'POST', '/proj/neu', { name: 'Zwei' });   // the open project is now another one
  assert.equal(meldungA.quellPfad('a'.repeat(64), 'material/k.wav'), path.join(rel, 'k.wav'), 'still resolved against the first project');
});
