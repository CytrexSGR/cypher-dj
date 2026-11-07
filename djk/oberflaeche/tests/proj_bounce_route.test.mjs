// Package 1.14 slice 4 (bounce, N08), unit U2: POST /proj/bounce in the real server (area proj-ausgabe next to proj): route, protection fremdePost,
// unreadable body 400, kein_projekt, Stop Cypher only for cypher, ?antwort=kurz. Plus the guard order of spec R4 (flow setup) and the status table
// of spec D12. The render is the double render_attrappe.mjs. No sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stapel, post } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { ruf } from './hilfen/proj_stapel.mjs';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { alsAntwort } from '../bereiche/proj/ausgabe.ts';
import { MergeFehler } from '../projekt/zusammenfuehren.ts';

const kopfJson = { 'content-type': 'application/json' };
const URL_ = '/proj/bounce';

test('proj/bounce: route in area proj-ausgabe, protection fremdePost, unreadable body 400, no project kein_projekt, Stop Cypher only for cypher',
  async (t) => {
  const { o, url } = await stapel(t);
  const i = innen(o);
  const routen = o.routen().filter((r) => r.pfad === URL_);
  assert.deepEqual(routen.map((r) => [r.bereich, r.methode, r.schutz]), [['proj-ausgabe', 'POST', 'fremdePost']]);
  const n0 = i.gesendet;
  const roh = await fetch(`${url}${URL_}`, { method: 'POST', body: '{}' });
  assert.deepEqual([roh.status, (await roh.json()).fehler], [415, 'nur_json']);
  const fremd = await fetch(`${url}${URL_}`, { method: 'POST', headers: { ...kopfJson, origin: 'https://boese.example' }, body: '{}' });
  assert.deepEqual([fremd.status, (await fremd.json()).fehler], [403, 'fremde_herkunft']);
  const kaputt = await fetch(`${url}${URL_}`, { method: 'POST', headers: kopfJson, body: '{"art":' });
  const kj = await kaputt.json();
  assert.deepEqual([kaputt.status, kj.fehler], [400, 'argument_ungueltig']);
  assert.match(kj.text, /^unreadable request body/);
  const koerper = { art: 'an_ort', spur_id: 's1' };
  const ohne = await post(url, URL_, koerper);
  assert.deepEqual([ohne.code, ohne.j.fehler, ohne.j.text], [409, 'kein_projekt', 'no project is open']);
  i.vomKern('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0 });
  const ki = await post(url, URL_, koerper, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([ki.code, ki.j.fehler], [409, 'ki_gestoppt']);
  const hand = await post(url, URL_, koerper);
  assert.deepEqual([hand.code, hand.j.fehler], [409, 'kein_projekt'], 'negative control: Stop Cypher does not stop Andreas');
  i.vomKern('/e/ki', { gestoppt: 0, grund: '', sample: 0 });
  assert.equal(i.gesendet, n0, 'nothing sent to the core');
});

test('proj/bounce: arguments 400, a full body passes, ?antwort=kurz without projekt, without the query with projekt', async (t) => {
  const alt = process.env.CYPHERDJ_RENDER;
  process.env.CYPHERDJ_RENDER = path.join(import.meta.dirname, 'hilfen', 'render_attrappe.mjs');
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_RENDER; else process.env.CYPHERDJ_RENDER = alt; });
  const { url, optionen } = await stapel(t);
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Bounce Route' })).code, 200);
  const rev = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.rev;
  const noten = [{ beat: 0, laenge: 0.5, ton: 36, vel: 100 }];
  const spuren = ['A', 'B'].flatMap((name, k) => [{ befehl: 'spur_neu', art: 'instrument', name, geraet: { art: 'intern' } },
    { befehl: 'clip_neu', spur_id: `s${k + 1}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten }]);
  const aufbauR = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'Aufbau', befehle: [...spuren, { befehl: 'spur_neu', art: 'audio', name: 'Z' }] });
  assert.equal(aufbauR.code, 200, JSON.stringify(aufbauR.j));
  const fehler = async (k, h) => { const r = await ruf(url, 'POST', URL_, k, h); return [r.code, r.j.fehler]; };
  assert.deepEqual(await fehler({ spur_id: 's1' }), [400, 'argument_ungueltig'], 'no art');
  assert.deepEqual(await fehler({ art: 'an_ort', spur_id: 's1', unbekannt: 1 }), [400, 'argument_ungueltig'], 'unknown field');
  assert.deepEqual(await fehler({ art: 'an_ort', spur_id: 's1' }), [409, 'bounce_nur_audio'], 'instrument track in place');
  assert.deepEqual(await fehler({ art: 'einfuegen', spur_ids: ['s1'], von_beat: 0, bis_beat: 4, ziel_spur_id: 's2', ziel_beat: 0 }), [409, 'bounce_ziel_art']);
  assert.deepEqual(await fehler({ art: 'neue_spur', gruppe_id: 'g7' }), [400, 'gruppe_unbekannt']);
  const kurz = await ruf(url, 'POST', `${URL_}?antwort=kurz`, { art: 'neue_spur', spur_ids: ['s1'], von_beat: 0, bis_beat: 4 });
  assert.equal(kurz.code, 200, JSON.stringify(kurz.j));
  assert.deepEqual(Object.keys(kurz.j).sort(), ['art', 'clip_id', 'datei', 'frames', 'hinweis', 'lanes_verworfen', 'quellen', 'rev', 'spur_id'],
    'short: no projekt');
  assert.deepEqual([kurz.j.quellen, kurz.j.hinweis], [['s1'], 'quellen_laenger'], 'clips 0..8, range 0..4');
  assert.ok(kurz.j.datei.startsWith(path.resolve(optionen.proj.wurzel)) && fs.statSync(kurz.j.datei).size > 44);
  assert.match(path.basename(kurz.j.datei), /^bounce-\d+\.wav$/);
  const voll = await ruf(url, 'POST', URL_, { art: 'einfuegen', spur_ids: ['s2'], von_beat: 0, bis_beat: 8, ziel_spur_id: 's3', ziel_beat: 16 });
  assert.equal(voll.code, 200, JSON.stringify(voll.j));
  assert.ok(voll.j.projekt && !('hinweis' in voll.j), 'negative control: without the query the whole project');
  assert.deepEqual(voll.j.projekt.spuren.find((s) => s.id === 's3').clips.map((c) => [c.start_beat, c.laenge_beats]), [[16, 8]]);
});

test('2.1 status (spec D12): bounce_nur_audio, bounce_ziel_art, takes_voll, ersetzen_loop 409, gruppe_unbekannt 400', () => {
  const code = (g) => alsAntwort(new MergeFehler(g, 'x')).code;
  assert.deepEqual(['bounce_nur_audio', 'bounce_ziel_art', 'takes_voll', 'ersetzen_loop', 'gruppe_unbekannt', 'spur_unbekannt'].map(code),
    [409, 409, 409, 409, 400, 400]);
});

// ---- guard order of spec R4 (flow setup, real S2 integration): each line has two faults, the earlier guard wins ----------------------------------
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function grund(a, d) {
  try { await a.ausgabe.bounce(d); return 'ok'; } catch (e) { const x = alsAntwort(e); return `${x.code} ${x.body.fehler}`; }
}
const mitRender = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('2.3 guard order (R4): ki_gestoppt, kein_projekt, beschaeftigt, transport_laeuft, plan refusals before audio_fehlt', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  // s4: a track of Andreas with an audio clip that is never decoded (unknown sha)
  await a.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Pad' }]);
  await a.vorbei([{ befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: 'b'.repeat(64) }]);
  const unbekannt = { art: 'an_ort', spur_id: 'nope' };
  a.zustand.quelle = 'cypher'; a.zustand.ki = true; a.zustand.zu = true;
  assert.equal(await grund(a, { art: 'quer' }), '409 ki_gestoppt', 'Stop Cypher + no project');
  a.zustand.ki = false;
  assert.equal(await grund(a, { art: 'quer' }), '409 kein_projekt', 'no project + unknown art');
  a.zustand.zu = false; a.zustand.quelle = 'andreas';
  const lauf = mitRender({ RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_SCHLAF_MS: '300' }, () => grund(a, { art: 'an_ort', spur_id: 's1' }));
  await warte(150);
  assert.equal(await grund(a, unbekannt), '409 beschaeftigt', 'a running run + unknown track');
  assert.equal(await lauf, 'ok');
  a.zustand.kernStatus = 1; a.arrMeldung();
  assert.equal(await grund(a, unbekannt), '409 transport_laeuft', 'running transport + unknown track');
  a.zustand.kernStatus = 0; a.arrMeldung();
  a.zustand.quelle = 'cypher';
  assert.equal(await grund(a, { art: 'an_ort', spur_id: 's4' }), '409 merge_andreas_spur', 'undecoded clip + a track of Andreas as cypher');
  a.zustand.quelle = 'andreas';
  assert.equal(await grund(a, { art: 'an_ort', spur_id: 's4' }), '409 audio_fehlt', 'negative control: as Andreas the plan passes, audio_fehlt follows');
  assert.equal(await grund(a, { art: 'neue_spur', gruppe_id: 'g9' }), '400 gruppe_unbekannt');
});
