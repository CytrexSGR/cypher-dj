// 1.12 automation slice 4, review fix (MINOR): key B toggles the draw mode only while the PRODUCTION tab is shown (st.sichtbar), like key r of the recording.
import test from 'node:test';
import assert from 'node:assert/strict';

const { installiere, El } = await import('./helfer/seiten_attrappe.mjs');
const { bindeZeitachse } = await import('../oeffentlich/produktion/zeitachse_bedienung.js');
const { bindeLanen, zeichenModus } = await import('../oeffentlich/produktion/lanen_bedienung.js');

test('S4 review fix: key B toggles the draw mode only when the production tab is visible; the DJ tab leaves it alone and does not swallow the key', () => {
  installiere();
  const tasten = [];
  const alt = document.addEventListener;
  document.addEventListener = (art, f) => { if (art === 'keydown') tasten.push(f); };
  try {
    const $ = (id) => document.querySelector(`#${id}`);
    const st = { projekt: { spuren: [], loop: null }, sichtbar: true };
    const ctx = { st, $, lies: (k, v) => v, merke() {}, beimProjekt: [], beimBild: [], beimEreignis: [], nachLaden: [], melde() {}, aendere() {} };
    bindeZeitachse(ctx);
    bindeLanen(ctx);
    assert.equal(tasten.length, 1, 'one keydown handler from the lane binder');
    const druecke = (extra = {}) => {
      let verschluckt = 0;
      tasten[0]({ key: 'b', target: new El('div'), ctrlKey: false, metaKey: false, altKey: false, preventDefault() { verschluckt++; }, ...extra });
      return verschluckt;
    };
    zeichenModus.setze(false);
    st.sichtbar = false;                                  // the DJ tab is shown
    assert.equal(druecke(), 0, 'DJ tab: key not swallowed');
    assert.equal(zeichenModus.an, false, 'DJ tab: draw mode stays off');
    st.sichtbar = true;                                   // negative control: the production tab still toggles
    assert.equal(druecke(), 1);
    assert.equal(zeichenModus.an, true, 'production tab: B switches the draw mode on');
    druecke({ key: 'B' });
    assert.equal(zeichenModus.an, false, 'and off again');
    druecke({ ctrlKey: true });
    assert.equal(zeichenModus.an, false, 'with a modifier nothing happens');
  } finally { document.addEventListener = alt; zeichenModus.setze(false); }
});
