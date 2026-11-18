// Audit U26: a track load that lands during a drag on the deck's zoom lane (a.raster is set to null) must end the drag cleanly:
// no TypeError, the scrub lifeline stops, and a later hover over the lane does not scrub.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere({ antworten: { 'POST /deck/scrub': { j: {} } } });
window.addEventListener ??= () => {};
const { bindeDeckBedienung } = await import('../public/deck_griffe.js');
const { deckAnsicht, zustand } = await import('../public/page_state.js');

const scrubs = () => attrappe.anrufe.filter((x) => x.methode === 'POST' && x.url === '/deck/scrub').map((x) => x.koerper.phase);
const ruhe = async () => { for (let i = 0; i < 8; i++) await new Promise((ok) => setImmediate(ok)); };

test('audit U26: a load during a drag ends the drag: pointermove and pointerup do not throw, the lifeline stops, a hover does not scrub', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    installiere({ antworten: { 'POST /deck/scrub': { j: {} } } });
    const raster = () => ({ basisSchlag: 0, ersterSchlagFrame: 0, framesProBeat: 24000, eins: 0 });
    deckAnsicht[1] = { raster: raster(), lauf: { w: {}, takte: 2, setzeWelle() {} }, ueber: { w: null, setzeWelle() {} }, kopf: { beat: () => 0 }, ziehMarke: 0 };
    zustand.decks[1] = { status: 1 };
    bindeDeckBedienung(1, document);
    const a = deckAnsicht[1], lauf = document.querySelector('[data-lauf]');
    lauf.setPointerCapture = () => {};
    lauf.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 });
    const feuer = (art, ev) => lauf.listeners[art].forEach((f) => f({ pointerId: 1, ...ev }));
    feuer('pointerdown', { clientX: 50 });
    feuer('pointermove', { clientX: 70 });
    await ruhe();
    assert.deepEqual(scrubs().slice(0, 2), [1, 2], 'the drag scrubs');
    a.raster = null;                                           // /e/geladen: ladeDeckWelle
    assert.doesNotThrow(() => feuer('pointermove', { clientX: 80 }));
    await assert.doesNotReject(async () => { for (const f of lauf.listeners.pointerup) await f({ pointerId: 1, clientX: 80 }); });
    await ruhe();
    assert.equal(scrubs().at(-1), 0, 'the core is released');
    const nach = scrubs().length;
    mock.timers.tick(2000);                                    // no lifeline any more
    await ruhe();
    assert.equal(scrubs().length, nach, 'the lifeline stopped');
    a.raster = raster();                                       // the new wave has loaded
    feuer('pointermove', { clientX: 10 });                     // plain hover
    mock.timers.tick(2000); await ruhe();
    assert.equal(scrubs().length, nach, 'a hover scrubs nothing');
    assert.equal(a.zieh, 0, 'the wave does not follow the hover');
  } finally { mock.timers.reset(); }
});
