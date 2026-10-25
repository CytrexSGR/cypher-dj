// Bereich proj am laufenden Stapel (Seiten-Server + Kern-Attrappe mit den K1-Adressen), D1 S2-Integration Slice 3 (Spec 3.4, 2.10).
// Ersetzt den Andockpunkt-Test aus S1 (Plan d1-s1 Task 10: GET /proj/liste 501): die Routen sind jetzt gebaut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPUREN } from '../projekt/modell.ts';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf, anKern, CYPHER } from './hilfen/proj_stapel.mjs';
import { GRUND_TEXT } from '../http/gruende.ts';   // Spec 6.34: jede Antwort mit Grund trägt einen englischen text

const LESEN_OEFFNEN = ['GET /proj/liste', 'GET /proj/aktuell', 'GET /proj/verlauf', 'POST /proj/neu', 'POST /proj/oeffnen'];

test('Routen und Schutz: lesen ohne Projekt (null bzw. kein_projekt), POST nur JSON und eigene Herkunft, kaputtes JSON 400, unbekannter Pfad 404', async (t) => {
  const { o, url } = await stapel(t);
  const proj = o.routen().filter((e) => e.bereich === 'proj');
  for (const r of LESEN_OEFFNEN) assert.ok(proj.some((e) => `${e.methode} ${e.pfad}` === r), r);
  assert.ok(proj.filter((e) => e.methode === 'POST').every((e) => e.schutz === 'fremdePost'));
  assert.deepEqual(await ruf(url, 'GET', '/proj/aktuell'), { code: 200, j: { slug: null, projekt: null, kern: null, ausgabe_lauf: null } }, 'Spec 6.34: ausgabe_lauf steht immer da');
  assert.deepEqual(await ruf(url, 'GET', '/proj/liste'), { code: 200, j: [] });
  assert.deepEqual(await ruf(url, 'GET', '/proj/verlauf'), { code: 409, j: { fehler: 'kein_projekt', text: GRUND_TEXT.kein_projekt } });
  assert.equal((await fetch(`${url}/proj/neu`, { method: 'POST', body: '{"name":"x"}' })).status, 415);
  const fremd = await fetch(`${url}/proj/neu`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://boese.example' }, body: '{"name":"x"}' });
  assert.equal(fremd.status, 403);
  assert.deepEqual(await ruf(url, 'POST', '/proj/neu', '{kaputt'), { code: 400, j: { fehler: 'json', text: GRUND_TEXT.json } });
  assert.deepEqual(await ruf(url, 'POST', '/proj/neu', '[1]'), { code: 400, j: { fehler: 'koerper_kein_objekt', text: GRUND_TEXT.koerper_kein_objekt } });
  assert.equal((await ruf(url, 'GET', '/proj/unbekannt')).code, 404);
  assert.equal(o.gesendet, 0, 'nichts davon geht an den Kern');
});

test('neu und öffnen mit der Kern-Attrappe: Wiedergabe geladen (Quittung 3), erz/4 und alle Spur-Regler (4 · MAX_SPUREN) angenommen, Liste, aktuell, Verlauf', async (t) => {
  const { url, log } = await stapel(t);
  const n = await ruf(url, 'POST', '/proj/neu', { name: 'First Track' });
  assert.equal(n.code, 200, JSON.stringify(n.j));
  assert.equal(n.j.slug, 'first-track');
  assert.equal(n.j.kern.wiedergabe.quittung.status, 3, 'Attrappe lädt die Wiedergabe');
  assert.deepEqual(n.j.kern.regler_fehler, [], 'erz/4 und Spur-Regler angenommen');
  assert.equal(anKern(log, '/k/teil').filter((z) => /^spur\//.test(z.felder.pfad)).length, 4 * MAX_SPUREN);
  assert.equal(anKern(log, '/k/teil').filter((z) => /^erz\/4\//.test(z.felder.pfad)).length, 16);
  assert.deepEqual(anKern(log, '/k/arr/laden').map((z) => z.felder.nr), [n.j.projekt.wiedergabe_rev]);
  assert.deepEqual((await ruf(url, 'GET', '/proj/liste')).j.map((e) => [e.slug, e.name]), [['first-track', 'First Track']]);
  assert.equal((await ruf(url, 'GET', '/proj/aktuell')).j.slug, 'first-track');
  assert.deepEqual((await ruf(url, 'GET', '/proj/verlauf')).j, []);
  const z = await ruf(url, 'POST', '/proj/neu', { name: 'Second' });
  assert.equal(z.j.projekt.wiedergabe_rev, n.j.projekt.wiedergabe_rev + 1, 'Wiedergabe-Nummer je Instanz, über Projekte hinweg (Spec 6.1)');
  const o2 = await ruf(url, 'POST', '/proj/oeffnen', { slug: 'first-track' });
  assert.deepEqual([o2.code, o2.j.slug], [200, 'first-track']);
  assert.deepEqual((await ruf(url, 'POST', '/proj/oeffnen', { slug: 'gibt-es-nicht' })), { code: 404, j: { fehler: 'unbekannt', text: GRUND_TEXT.unbekannt } });
  assert.deepEqual((await ruf(url, 'POST', '/proj/neu', { name: '' })), { code: 400, j: { fehler: 'name_ungueltig', text: GRUND_TEXT.name_ungueltig } });
});

// --- P3 (a), Spec 6.22: Spur-Regler nur über das Projekt ---------------------------------------------------------------------------------

test('POST /regler mit Pfad spur/* → 409 ueber_projekt (jede Quelle), nichts an den Kern; erz/* und Pfadfehler bleiben wie sie waren', async (t) => {
  const { o, url } = await stapel(t);
  for (const pfad of ['spur/1/fader', 'spur/8/pan', 'spur/3/mute', 'spur/2/solo']) {
    for (const kopf of [{}, CYPHER]) {
      const r = await ruf(url, 'POST', '/regler', { pfad, nach: 0 }, kopf);
      assert.deepEqual([r.code, r.j.fehler], [409, 'ueber_projekt'], `${pfad} ${JSON.stringify(kopf)}`);
    }
  }
  assert.equal(o.gesendet, 0, 'nichts ging an den Kern');
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'spur/33/fader', nach: 0 })).j.fehler, 'pfad', 'spur/33 gibt es nicht: weiter 400 pfad');
  const ok = await ruf(url, 'POST', '/regler', { pfad: 'erz/2/fader', nach: -3 });
  assert.deepEqual([ok.code, ok.j.ok], [200, true], 'Negativ-Kontrolle: ein erlaubter Pfad geht weiter durch');
  assert.equal(o.gesendet, 1);
});
