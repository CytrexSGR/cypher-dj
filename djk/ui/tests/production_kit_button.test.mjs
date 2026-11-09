// Package 1.9 U2 (L25), T2.4: the page side of the kit track. The head label, the "+ KIT" button (enabled/disabled), and the pick: the button asks
// GET /proj/kits and the picked kit becomes a spur_neu with the kit device. DOM attrappe, no browser, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { element } from './support/dom_mock.mjs';
import { geraetText, kitMenue, bindeSpuren } from '../public/production/track_heads.js';

const spur = (i, geraet) => ({ id: `s${i}`, nr: i, name: 'x', farbe: '#000000', art: 'instrument', geraet, fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
const kit = (k = 'kit_zwei') => ({ art: 'intern', name: 'kit', kit: k });

test('geraetText: a kit track says KIT · <kit>; the other devices say what they said', () => {
  assert.equal(geraetText(spur(1, kit('kit_zwei'))), 'KIT · kit_zwei');
  assert.equal(geraetText(spur(1, { art: 'intern', name: 'rb338', parameter: {} })), 'RB-338');
  assert.equal(geraetText(spur(1, { art: 'intern', name: 'bk', graph: 'juno', parameter: {} })), 'BK · juno');
  assert.equal(geraetText(spur(1, { art: 'wirt', name: 'surge', slot: 1 })), 'SURGE · 1');
});

function kontext(antwort) {
  const log = { aendere: [], melde: [], gets: [] };
  return { log, ctx: {
    holeGet: async (weg) => { log.gets.push(weg); return antwort; },
    antwortText: (r) => `refused ${r.status}`,
    melde: (t, fehler) => log.melde.push([t, fehler]),
    aendere: (label, befehle) => log.aendere.push([label, befehle]),
  } };
}

test('kitMenue: lists the kits of GET /proj/kits; the pick sends spur_neu with the kit device', async () => {
  const { ctx, log } = kontext({ status: 200, j: { kits: [{ name: 'kit_a', klaenge: 3 }, { name: 'kit_b', klaenge: 1 }] } });
  let menue = null;
  await kitMenue(ctx, 10, 20, (punkte, x, y) => { menue = { punkte, x, y }; });
  assert.deepEqual(log.gets, ['/proj/kits']);
  assert.deepEqual([menue.x, menue.y], [10, 20]);
  assert.deepEqual(menue.punkte.map((p) => p.text), ['kit_a (3)', 'kit_b (1)']);
  assert.deepEqual(log.aendere, [], 'nothing is added before the pick');
  menue.punkte[1].aktion();
  assert.deepEqual(log.aendere, [['Add kit track kit_b', [{ befehl: 'spur_neu', art: 'instrument', geraet: kit('kit_b') }]]]);
});

test('kitMenue: an empty folder and a failed answer are said, no menu opens', async () => {
  for (const [antwort, text] of [[{ status: 200, j: { kits: [] } }, 'No kit in the kit folder'], [{ status: 500, j: { fehler: 'intern' } }, 'refused 500'],
    [{ status: 200, j: {} }, 'refused 200']]) {
    const { ctx, log } = kontext(antwort);
    let offen = false;
    await kitMenue(ctx, 0, 0, () => { offen = true; });
    assert.equal(offen, false);
    assert.deepEqual(log.melde, [[text, true]]);
    assert.deepEqual(log.aendere, []);
  }
});

test('the + KIT button: enabled with a project below the limits, disabled without a project, at 8 kit devices and at the track limit', async () => {
  globalThis.document = { createElement: (t) => Object.assign(element(t), { style: { setProperty() {} }, value: '', querySelector: () => Object.assign(element(), { style: { setProperty() {} }, value: '' }), querySelectorAll: () => [] }) };
  try {
    const els = { koepfe: Object.assign(element(), { children: [], insertBefore(el) { this.children.push(el); } }) }; const $ = (k) => (els[k] ??= element());
    const beim = [];
    bindeSpuren({ st: {}, $, aendere() {}, aendereAus() {}, beimProjekt: beim, beimBild: [], beimEreignis: [] });
    const zeige = (p) => { for (const f of beim) f(p); return els['neu-kit'].disabled; };
    assert.equal(zeige(null), true, 'no project');
    assert.equal(zeige({ spuren: [] }), false, 'empty project');
    const acht = Array.from({ length: 8 }, (_, i) => spur(i + 1, kit()));
    assert.equal(zeige({ spuren: acht.slice(0, 7) }), false, '7 kit devices');
    assert.equal(zeige({ spuren: acht }), true, '8 kit devices');
    // negative control: eight RB-338 tracks do not use up the kit limit
    assert.equal(zeige({ spuren: acht.map((s, i) => spur(i + 1, { art: 'intern', name: 'rb338', parameter: {} })) }), false);
  } finally { delete globalThis.document; }
});
