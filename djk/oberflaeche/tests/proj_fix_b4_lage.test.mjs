// D1 S2-Integration, Fix-Runde B4 (Spec 6.30 Leistung): proj_lage liefert keine Noten, nur ihre Zahl je Clip (GET /proj/aktuell?noten=zahl), und
// die rev holt das Werkzeug über eine schmale Abfrage (GET /proj/aktuell?nur=rev). Die Seite liest weiter GET /proj/aktuell mit allen Noten.
// Die Antwort von /proj/aendern behält das ganze Projekt: die Seite liest es (oeffentlich/produktion/schreiber.js, beiProjekt(slug, r.j.projekt)).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf } from './hilfen/proj_stapel.mjs';

const N = (beat) => ({ beat, laenge: 1, ton: 60, vel: 100 });

test('B4 GET /proj/aktuell?noten=zahl: MIDI-Clips mit noten_zahl statt noten, sonst wie /proj/aktuell; ?nur=rev: {slug, rev}', async (t) => {
  const { url } = await stapel(t);
  assert.deepEqual((await ruf(url, 'GET', '/proj/aktuell?nur=rev')).j, { slug: null, rev: null });
  assert.deepEqual((await ruf(url, 'GET', '/proj/aktuell?noten=zahl')).j, { slug: null, projekt: null, kern: null });
  await ruf(url, 'POST', '/proj/neu', { name: 'Lage' });
  await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [N(0), N(1), N(2)] },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 8, laenge_beats: 4 }] });
  const voll = (await ruf(url, 'GET', '/proj/aktuell')).j;
  const kurz = (await ruf(url, 'GET', '/proj/aktuell?noten=zahl')).j;
  assert.equal(voll.projekt.spuren[0].clips[0].noten.length, 3, 'Negativ-Kontrolle: ohne Abfrage alle Noten (die Seite)');
  assert.deepEqual(kurz.projekt.spuren[0].clips.map((c) => [c.id, c.noten_zahl, 'noten' in c]), [['c1', 3, false], ['c2', 0, false]]);
  const ohneNoten = structuredClone(voll);
  delete ohneNoten.ausgabe_lauf;                       // Spec 6.34: nur die Seite (ohne Abfrage) bekommt ausgabe_lauf
  for (const c of ohneNoten.projekt.spuren[0].clips) { c.noten_zahl = c.noten.length; delete c.noten; }
  assert.deepEqual(kurz, ohneNoten, 'sonst unverändert: rev, Mixer, Tempo, kern');
  assert.deepEqual((await ruf(url, 'GET', '/proj/aktuell?nur=rev')).j, { slug: 'lage', rev: 1 });
  assert.equal((await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].clips[0].noten.length, 3, 'das lebende Projekt hat seine Noten behalten');
});
