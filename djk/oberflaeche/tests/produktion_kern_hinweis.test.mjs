// PRODUCTION V2 Nachzug (Slice 0b, Punkte 7c und 7d): eine angenommene Änderung, die der Kern nicht nachvollzieht, ist kein stiller
// Erfolg. /proj/aendern antwortet 200 mit kern.wiedergabe = {nr: null, fehler, text}, wenn der Übersetzer die Wiedergabe nicht bauen
// konnte (bereiche/proj/sitzung.ts schreibeNeueWiedergabe, WiedergabeFehler), und mit kern.regler = 'kein_kern', wenn Mixer-Werte ohne
// Kern angenommen wurden (Spec 6.30). Die Seite zeigt dann eine Warnung. Dazu die Attrappe: sie liefert diese Antworten auf Wunsch
// (POST /attrappe/kernantwort) und vergibt wie S2 nur Wirt-Slot 1 (Spec 6.28).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { kernHinweis, hinweisMeldung, meldeNachSchreiben, WIEDERGABE_TEXT, analyseMeldung } from '../oeffentlich/produktion/produktion.js';
import { starteProjAttrappe } from '../pruef/proj_attrappe.mjs';

test('V2 Kern-Hinweis: Wiedergabe nicht geladen, Mixer ohne Kern; sonst nichts', () => {
  assert.equal(kernHinweis({ wiedergabe: { nr: null, fehler: 'datei_fehlt', text: 'datei_fehlt: /x/freeze-3-7.f32' } }),
    'Saved, but the core did not load the arrangement: a frozen track file is missing');
  assert.equal(kernHinweis({ wiedergabe: { nr: null, fehler: 'zu_gross', text: 'clips: 5000 > 4096' } }),
    'Saved, but the core did not load the arrangement: too many clips or notes for the core');
  assert.equal(kernHinweis({ wiedergabe: { nr: null, fehler: 'arbeitsordner_fehlt' } }),
    'Saved, but the core did not load the arrangement: the work folder of this instance is missing');
  assert.equal(kernHinweis({ wiedergabe: { nr: null, fehler: 'neu_im_server', text: 'x' } }),
    'Saved, but the core did not load the arrangement: neu_im_server', 'unbekannter Grund: der Code, nie stiller Erfolg');
  assert.equal(kernHinweis({ regler: 'kein_kern' }), 'Saved; the core is not running');
  // Negativ-Kontrollen: geladen, aufgeschoben (Freeze-Sperre), Regler ok, keine Kern-Angabe
  assert.equal(kernHinweis({ wiedergabe: { nr: 12, quittung: { status: 3 } }, regler: 'ok' }), null);
  assert.equal(kernHinweis({ wiedergabe: { nr: null, aufgeschoben: true } }), null);
  assert.equal(kernHinweis(undefined), null);
  for (const t of Object.values(WIEDERGABE_TEXT)) assert.doesNotMatch(t, /[äöüÄÖÜß]/);
});

async function oben() {
  const srv = http.createServer((q, a) => { a.writeHead(200, { 'content-type': 'text/plain' }); a.end('oben'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, stoppe: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
}
const post = async (url, weg, d) => { const r = await fetch(url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }); return { status: r.status, j: await r.json() }; };

test('V2 Attrappe: kern-Antwort auf Wunsch (einmal), nur Wirt-Slot 1', async () => {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url });
  try {
    await post(at.url, '/proj/neu', { name: 'Kern' });
    const kern = { wiedergabe: { nr: null, fehler: 'datei_fehlt', text: 'datei_fehlt: x' } };
    await post(at.url, '/attrappe/kernantwort', { kern });
    const a = await post(at.url, '/proj/aendern', { rev: 1, label: 'Metronome on', befehle: [{ befehl: 'metronom_setzen', an: true }] });
    assert.deepEqual([a.status, a.j.kern, a.j.projekt.metronom.an], [200, kern, true], 'angenommen, mit Kern-Angabe');
    const b = await post(at.url, '/proj/aendern', { rev: a.j.rev, label: 'Metronome off', befehle: [{ befehl: 'metronom_setzen', an: false }] });
    assert.equal(b.j.kern, undefined, 'nur einmal');
    const surge = (slot) => ({ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', ...(slot ? { slot } : {}) } });
    const s2 = await post(at.url, '/proj/aendern', { rev: b.j.rev, label: 'x', befehle: [surge(2)] });
    assert.deepEqual([s2.status, s2.j.fehler], [409, 'slot_belegt'], 'Slot 2 gibt es in D1 nicht');
    const s1 = await post(at.url, '/proj/aendern', { rev: b.j.rev, label: 'Add Surge track', befehle: [surge()] });
    assert.equal(s1.j.projekt.spuren[0].geraet.slot, 1);
    const zweite = await post(at.url, '/proj/aendern', { rev: s1.j.rev, label: 'x', befehle: [surge()] });
    assert.deepEqual([zweite.status, zweite.j.fehler], [409, 'slot_belegt'], 'eine zweite Surge-Spur: slot_belegt (Spec 6.28)');
  } finally { await at.stoppe(); await o.stoppe(); }
});

test('Hinweise des Schreibwegs: kein_tempo ist ein Fehler-Hinweis, die Analyse-Hinweise sind Information; unbekannte Hinweise erscheinen mit ihrem Namen; leer: nichts', () => {
  assert.equal(hinweisMeldung(undefined), null); assert.equal(hinweisMeldung([]), null);
  const k = hinweisMeldung([{ index: 0, hinweis: 'kein_tempo' }]);
  assert.equal(k.fehler, true); assert.match(k.text, /No tempo found/); assert.match(k.text, /unwarped/);
  const a = hinweisMeldung([{ index: 0, hinweis: 'analyse_angefordert' }]);
  assert.equal(a.fehler, false); assert.match(a.text, /Analysing the track/);
  assert.match(hinweisMeldung([{ index: 1, hinweis: 'analyse_laeuft' }]).text, /already running/);
  assert.match(hinweisMeldung([{ index: 1, hinweis: 'karte_zu_gross' }]).text, /more than 4096/);
  assert.match(hinweisMeldung([{ index: 1, hinweis: 'karte_unbrauchbar' }]).text, /not usable/);
  const zwei = hinweisMeldung([{ index: 0, hinweis: 'kein_tempo' }, { index: 2, hinweis: 'analyse_angefordert' }]);
  assert.equal(zwei.fehler, true); assert.ok(zwei.text.includes('No tempo found') && zwei.text.includes('Analysing the track'));
  assert.equal(hinweisMeldung([{ index: 0, hinweis: 'neu_vom_server' }]).text, 'Note: neu_vom_server');
});

// Nachbesserung Task 9: die Verdrahtung beiProjekt des Schreibwegs (bindeProduktion) ruft meldeNachSchreiben(j, melde); die Entscheidung steckt in dieser reinen Funktion
test('Verdrahtung des Schreibwegs: Hinweise erscheinen als Meldung, der Kern-Hinweis hat Vorrang, ohne beides bleibt die Meldung ungerufen', () => {
  const ruf = [];
  const melde = (text, fehler) => ruf.push([text, fehler]);
  meldeNachSchreiben({ rev: 3, hinweise: [{ index: 0, hinweis: 'karte_unbrauchbar' }] }, melde);
  assert.equal(ruf.length, 1); assert.match(ruf[0][0], /not usable/); assert.equal(ruf[0][1], false, 'Information, kein Fehler');
  ruf.length = 0;
  meldeNachSchreiben({ rev: 3, hinweise: [{ index: 0, hinweis: 'kein_tempo' }] }, melde);
  assert.equal(ruf.length, 1); assert.match(ruf[0][0], /No tempo found/); assert.equal(ruf[0][1], true, 'kein_tempo ist ein Fehler-Hinweis');
  ruf.length = 0;
  meldeNachSchreiben({ rev: 3, kern: { regler: 'kein_kern' }, hinweise: [{ index: 0, hinweis: 'kein_tempo' }] }, melde);
  assert.deepEqual(ruf, [['Saved; the core is not running', true]], 'Kern-Hinweis zuerst, genau eine Meldung');
  ruf.length = 0;
  meldeNachSchreiben({ rev: 3 }, melde); meldeNachSchreiben({ rev: 3, hinweise: [] }, melde); meldeNachSchreiben(undefined, melde);
  assert.deepEqual(ruf, [], 'Negativ-Kontrolle: harmlose Antwort, keine Meldung');
});

test('Der Schreiber reicht die ganze Antwort (mit hinweise) an beiProjekt weiter', async () => {
  const { neuerSchreiber } = await import('../oeffentlich/produktion/schreiber.js');
  const gesehen = [];
  const antwort = { rev: 2, projekt: { rev: 2 }, hinweise: [{ index: 0, hinweis: 'karte_unbrauchbar' }] };
  const s = neuerSchreiber({ holeJson: async () => ({ status: 200, j: antwort }), beiProjekt: (slug, p, rev, j) => gesehen.push(j), beiFehler: () => assert.fail('kein Fehler erwartet') });
  s.setze('x', 1);
  await s.aendere('Test', [{ befehl: 'tempo_setzen', bpm: 120 }]);
  assert.deepEqual(gesehen, [antwort]);
});

test('Analyse-Ereignis der Seite: fehler zeigt den Grund, karte_bereit sagt, dass der Clip spielt, verworfen nur bei angefasst und ki_gestoppt eine Meldung, fertig und laeuft keine', () => {
  assert.equal(analyseMeldung({ clip_id: 'c1', analyse: 'laeuft' }), null);
  assert.equal(analyseMeldung({ clip_id: 'c1', analyse: 'fertig' }), null);
  assert.equal(analyseMeldung({ clip_id: 'c1', analyse: 'verworfen', grund: 'clip_weg' }), null);
  const f = analyseMeldung({ clip_id: 'c1', analyse: 'fehler', grund: 'RuntimeError: In RhythmExtractor2013.compute' });
  assert.equal(f.fehler, true); assert.match(f.text, /Analysis failed/); assert.match(f.text, /RhythmExtractor2013/); assert.match(f.text, /keeps its current warp/);
  const b = analyseMeldung({ clip_id: 'c1', analyse: 'karte_bereit' });
  assert.equal(b.fehler, false); assert.match(b.text, /clip is playing/); assert.match(b.text, /not playing/);
  assert.match(analyseMeldung({ clip_id: 'c1', analyse: 'verworfen', grund: 'angefasst' }).text, /changed meanwhile/);
  assert.match(analyseMeldung({ clip_id: 'c1', analyse: 'verworfen', grund: 'ki_gestoppt' }).text, /Stop Cypher/);
  assert.equal(analyseMeldung(undefined), null);
});
