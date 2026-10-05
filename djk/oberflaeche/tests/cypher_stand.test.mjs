// Plan M-1 Annahme-Weg: was die Seite aus den Leitstand-Ereignissen über Cyphers Vorschlag und Stopp anzeigt (reine Funktion, ohne Browser)
import test from 'node:test';
import assert from 'node:assert/strict';
import { cypherStand } from '../oeffentlich/meldungen.js';

const leer = { vorschlag: null, gestoppt: false };
const vorgeschlagen = { art: 'plan_vorgeschlagen', plan_id: 'p1', vorschlag: { id: 'v1', plan_id: 'p1', text: 'T 113: Nightshift rein', start_beat: 452, verfaellt_beat: 448, kanal: 'k' } };

test('Vorschlag erscheint mit id, Text und Start', () => {
  assert.deepEqual(cypherStand(leer, vorgeschlagen).vorschlag, { id: 'v1', text: 'T 113: Nightshift rein', start_beat: 452 });
});
test('angenommen, verworfen, verfallen, verriegelt räumen genau diesen Vorschlag ab', () => {
  const da = cypherStand(leer, vorgeschlagen);
  for (const art of ['vorschlag_angenommen', 'vorschlag_verworfen', 'vorschlag_verfallen', 'plan_verriegelt']) {
    assert.equal(cypherStand(da, { art, vorschlag_id: 'v1' }).vorschlag, null, art);
  }
});
test('Negativ-Kontrolle: Ereignis zu einem ANDEREN Vorschlag lässt den offenen stehen (null = keine Änderung)', () => {
  const da = cypherStand(leer, vorgeschlagen);
  assert.equal(cypherStand(da, { art: 'vorschlag_verworfen', vorschlag_id: 'v0' }), null);
  assert.equal(cypherStand(leer, { art: 'vorschlag_verworfen', vorschlag_id: 'v1' }), null);
});
test('ki_stopp setzt und löst den Stopp, der Vorschlag bleibt', () => {
  const da = cypherStand(leer, vorgeschlagen);
  const g = cypherStand(da, { art: 'ki_stopp', gestoppt: 1 });
  assert.equal(g.gestoppt, true); assert.equal(g.vorschlag.id, 'v1');
  assert.equal(cypherStand(g, { art: 'ki_stopp', gestoppt: 0 }).gestoppt, false);
});
test('fremde Ereignisse ändern nichts', () => {
  for (const art of ['geladen', 'takt', 'neustart', 'hand', 'teil_gestartet']) assert.equal(cypherStand(leer, { art }), null, art);
});
