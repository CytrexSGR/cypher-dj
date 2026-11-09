// Paket 1.13 Slice 7: POST /proj/zusammenfuehren im echten Server (Bereich proj-ausgabe neben proj): Route gemeldet, Schutz fremdePost, Körper unlesbar 400,
// ohne Projekt kein_projekt, Stop Cypher nur für cypher, Argumente, ?antwort=kurz. Der Render ist das Doppel render_mock.mjs. Kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stapel, post } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { ruf } from './support/proj_stack.mjs';

const kopfJson = { 'content-type': 'application/json' };
const URL_ = '/proj/zusammenfuehren';

test('proj/zusammenfuehren: Route im Bereich proj-ausgabe, Schutz fremdePost, Körper unlesbar 400, ohne Projekt kein_projekt, KI-Stopp nur für cypher',
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
  const kaputt = await fetch(`${url}${URL_}`, { method: 'POST', headers: kopfJson, body: '{"spur_ids":' });
  const kj = await kaputt.json();
  assert.deepEqual([kaputt.status, kj.fehler], [400, 'argument_ungueltig']);
  assert.match(kj.text, /^unreadable request body/, 'englischer text (Spec 6.34)');
  const koerper = { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 };
  const ohne = await post(url, URL_, koerper);
  assert.deepEqual([ohne.code, ohne.j.fehler, ohne.j.text], [409, 'kein_projekt', 'no project is open']);
  i.vomKern('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0 });   // set right before the request: the stack may reset it under load
  const ki = await post(url, URL_, koerper, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([ki.code, ki.j.fehler], [409, 'ki_gestoppt']);
  const hand = await post(url, URL_, koerper);
  assert.deepEqual([hand.code, hand.j.fehler], [409, 'kein_projekt'], 'Negativ-Kontrolle: Andreas sperrt der KI-Stopp nicht');
  i.vomKern('/e/ki', { gestoppt: 0, grund: '', sample: 0 });
  assert.equal(i.gesendet, n0, 'nichts an den Kern');
});

test('proj/zusammenfuehren: Argumente 400, vollständiger Körper läuft durch, ?antwort=kurz ohne projekt, ohne Abfrage mit projekt', async (t) => {
  const alt = process.env.CYPHERDJ_RENDER;
  process.env.CYPHERDJ_RENDER = path.join(import.meta.dirname, 'support', 'render_mock.mjs');
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_RENDER; else process.env.CYPHERDJ_RENDER = alt; });
  const { url, optionen } = await stapel(t);
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Merge Route' })).code, 200);
  const rev = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.rev;
  const noten = [{ beat: 0, laenge: 0.5, ton: 36, vel: 100 }];
  const spuren = ['A', 'B', 'C', 'D'].flatMap((name, k) => [{ befehl: 'spur_neu', art: 'instrument', name, geraet: { art: 'intern' } },
    { befehl: 'clip_neu', spur_id: `s${k + 1}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten }]);
  const aufbau = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'Aufbau', befehle: spuren });
  assert.equal(aufbau.code, 200, JSON.stringify(aufbau.j));
  const fehler = async (k, h) => { const r = await ruf(url, 'POST', URL_, k, h); return [r.code, r.j.fehler]; };
  assert.deepEqual(await fehler({ von_beat: 0, bis_beat: 4 }), [400, 'argument_ungueltig'], 'ohne spur_ids');
  assert.deepEqual(await fehler({ spur_ids: 's1', von_beat: 0, bis_beat: 4 }), [400, 'argument_ungueltig'], 'spur_ids kein Feld');
  assert.deepEqual(await fehler({ spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4, unbekannt: 1 }), [400, 'argument_ungueltig'], 'unbekanntes Feld');
  assert.deepEqual(await fehler({ spur_ids: ['s1'], von_beat: 0, bis_beat: 4 }), [400, 'argument_ungueltig'], 'eine Spur ist kein Merge');
  const kurz = await ruf(url, 'POST', `${URL_}?antwort=kurz`, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 });
  assert.equal(kurz.code, 200, JSON.stringify(kurz.j));
  assert.deepEqual(Object.keys(kurz.j).sort(), ['datei', 'frames', 'hinweis', 'lanes_verworfen', 'quellen', 'rev', 'spur_id'], 'schmal: kein projekt');
  assert.deepEqual([kurz.j.quellen, kurz.j.hinweis], [['s1', 's2'], 'quellen_laenger'], 'Clips 0..8, Bereich 0..4');
  assert.ok(kurz.j.datei.startsWith(path.resolve(optionen.proj.wurzel)) && fs.statSync(kurz.j.datei).size > 44);
  const voll = await ruf(url, 'POST', URL_, { spur_ids: ['s3', 's4'], von_beat: 0, bis_beat: 8 });
  assert.equal(voll.code, 200, JSON.stringify(voll.j));
  assert.ok(voll.j.projekt && !('hinweis' in voll.j), 'Negativ-Kontrolle: ohne Abfrage das ganze Projekt, Clips ganz im Bereich: kein Hinweis');
  assert.equal(voll.j.projekt.spuren.find((s) => s.id === voll.j.spur_id).clips.length, 1);
});
