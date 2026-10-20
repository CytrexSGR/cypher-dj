// Paket 1.18, S3-Fix W1: während einer Lautheitsmessung von Cypher (ausgabe_lauf {art: 'lautheit'} aus GET /proj/aktuell) zeigt die Seite
// "Measuring loudness" und sperrt EXPORT und FREEZE wie bei einem fremden Export. Test über den echten Weg: das Ereignis ctx.ausgabeLauf, den die
// Seite beim Laden von /proj/aktuell auslöst, bis zum Zustand der Tasten und der Anzeige (freeze_export.js mit DOM-Attrappe).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindeAusgabe } from '../oeffentlich/produktion/freeze_export.js';
import { element, installiereDom } from './hilfen/dom_attrappe.mjs';

function seite(t) {
  const zurueck = installiereDom();
  t.after(zurueck);
  const el = { export: element('button'), ausgabe: element('output'), koepfe: element('div'), meldung: element('div') };
  const kopf = element('div'); kopf.className = 'p-kopf'; kopf.klassen.add('p-kopf'); kopf.dataset.spur = 's3';
  el.koepfe.append(kopf);
  const nachfragen = [];
  const ctx = {
    st: { projekt: { spuren: [{ id: 's3', name: 'Lead', geraet: { art: 'wirt' }, freeze: null }, { id: 's1', name: 'Kick', geraet: { art: 'sampler' } }] }, arr: null, slug: 'x' },
    $: (n) => el[n], vorBild: [], beimProjekt: [], ladeAktuell: () => nachfragen.push(1), holeJson: async () => ({ status: 200, j: {} }),
    melde: () => {}, uebernimm: () => {}, antwortText: () => 'x',
  };
  bindeAusgabe(ctx);
  ctx.beimProjekt.forEach((f) => f(ctx.st.projekt, true));
  t.after(() => ctx.ausgabeLauf(null));                                // räumt die Nachfrage-Uhr (500 ms) ab
  const bild = () => { ctx.vorBild.forEach((f) => f(5000)); return el.ausgabe.textContent; };
  const freeze = () => kopf.querySelector('.p-freeze');
  return { ctx, el, bild, freeze, nachfragen };
}

test('W1 lautheit: Messung von Cypher sperrt EXPORT und FREEZE und zeigt "Measuring loudness"; danach frei', (t) => {
  const s = seite(t);
  assert.equal(s.el.export.disabled, false, 'Ausgang: EXPORT frei');
  assert.equal(s.freeze().disabled, false, 'Ausgang: FREEZE frei');
  s.ctx.ausgabeLauf({ art: 'lautheit' });
  assert.equal(s.el.export.disabled, true, 'EXPORT gesperrt');
  assert.equal(s.freeze().disabled, true, 'FREEZE gesperrt');
  assert.equal(s.bild(), 'Measuring loudness');
  s.ctx.ausgabeLauf(null);                                             // Messung zu Ende: GET /proj/aktuell meldet ausgabe_lauf null
  assert.equal(s.el.export.disabled, false, 'danach EXPORT frei');
  assert.equal(s.freeze().disabled, false, 'danach FREEZE frei');
  assert.equal(s.bild(), '');
});

test('W1 lautheit: Negativ-Kontrolle, ein fremder Export sperrt wie bisher, ein unbekannter Lauf sperrt nicht', (t) => {
  const s = seite(t);
  s.ctx.ausgabeLauf({ art: 'export' });
  assert.deepEqual([s.el.export.disabled, s.freeze().disabled], [true, true]);
  assert.match(s.bild(), /^Exporting/);
  s.ctx.ausgabeLauf(null);
  s.ctx.ausgabeLauf({ art: 'unbekannt' });
  assert.deepEqual([s.el.export.disabled, s.freeze().disabled], [false, false], 'eine unbekannte Art sperrt nichts');
});
