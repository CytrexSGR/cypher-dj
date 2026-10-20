// Bereich proj am Stapel, D1 S2-Integration Slice 5: alle neun Routen, Transport mit /zustand/arr über /strom (Durchreichen, Drossel
// 50 ms), Rückweg der Hand über den Haken ereignis (Spec 3.4, 2.2, 2.10, 3.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, sse, ruf } from './hilfen/proj_stapel.mjs';
import { GRUND_TEXT } from '../http/gruende.ts';   // Spec 6.34: jede Antwort mit Grund trägt einen englischen text

const ROUTEN = ['GET /proj/liste', 'GET /proj/aktuell', 'GET /proj/verlauf', 'POST /proj/neu', 'POST /proj/oeffnen', 'POST /proj/aendern',
  'POST /proj/undo', 'POST /proj/redo', 'POST /proj/transport'];

test('Routen: genau die neun aus Spec 3.4 (ohne freeze und export, die bringt S3), alle POST mit fremdePost', async (t) => {
  const { o } = await stapel(t);
  const proj = o.routen().filter((e) => e.bereich === 'proj');
  assert.deepEqual(proj.map((e) => `${e.methode} ${e.pfad}`), ROUTEN);
  assert.ok(proj.filter((e) => e.methode === 'POST').every((e) => e.schutz === 'fremdePost'));
});

test('Transport mit der Kern-Attrappe: Start (quant 0, Quittung 2 am Einsatz), /zustand/arr mit nr und Status über /strom, Stopp', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url); t.after(s.zu);
  const n = await ruf(url, 'POST', '/proj/neu', { name: 'Lauf' });
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm }] });
  const st = await ruf(url, 'POST', '/proj/transport', { aktion: 'start', beat: 0 });
  assert.deepEqual([st.code, st.j.ok, st.j.quant, st.j.quittung.status, st.j.tempo.gesetzt], [200, true, 0, 2, false], JSON.stringify(st.j));
  assert.ok(await bis(() => s.ereignisse.some((e) => e.a === '/zustand/arr' && e.f.status === 2 && e.f.nr >= n.j.projekt.wiedergabe_rev)), 'durchgereicht');
  assert.equal((await ruf(url, 'GET', '/proj/aktuell')).j.kern.status, 2);
  assert.equal((await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' })).j.ok, true);
  assert.ok(await bis(() => s.ereignisse.filter((e) => e.a === '/zustand/arr').at(-1).f.status === 0));
  assert.deepEqual((await ruf(url, 'POST', '/proj/transport', { aktion: 'rueckwaerts' })).j, { fehler: 'aktion_unbekannt', text: GRUND_TEXT.aktion_unbekannt });
});

test('Rückweg über den Haken: /e/regler spur/1/fader mit Halter mensch landet im Projekt (Quelle andreas), mit Halter frei nicht', async (t) => {
  const { o, url } = await stapel(t);
  const s = sse(url); t.after(s.zu);
  await ruf(url, 'POST', '/proj/neu', { name: 'Hand' });
  await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  innen(o).vomKern('/e/regler', { pfad: 'spur/1/pan', wert: 0.5, halter: 'frei', sample: 0, beat: 0 });
  innen(o).vomKern('/e/regler', { pfad: 'spur/1/fader', wert: -9, halter: 'mensch', sample: 0, beat: 0 });
  assert.ok(await bis(() => s.ereignisse.some((e) => e.a === 'proj' && e.f.label === 'Mixer: Audio 1 fader' && e.f.quelle === 'andreas')));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.deepEqual([p.spuren[0].fader_db, p.spuren[0].pan, p.rev], [-9, 0, 2]);
  assert.deepEqual((await ruf(url, 'GET', '/proj/verlauf')).j.map((e) => [e.quelle, e.label]), [['andreas', 'Spur'], ['andreas', 'Mixer: Audio 1 fader']]);
});
