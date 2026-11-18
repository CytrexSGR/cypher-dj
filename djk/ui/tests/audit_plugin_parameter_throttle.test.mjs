// Audit U21: the plugin parameter list sends while a slider is dragged (fixed-interval throttle), it does not wait for a pause (trailing debounce).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const { installiere, El } = await import('./helpers/pages_mock.mjs');
const { baueParameterListe, PARAM_ENTPRELLEN_MS } = await import('../public/production/plugin_parameter.js');

test('audit U21: a drag with an input event every 10 ms sends during the drag', async () => {
  installiere();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const el = new El('div'), gesendet = [];
    baueParameterListe(el, {
      holeListe: async () => ({ status: 200, j: [{ index: 0, name: 'Cutoff', wert: 0 }] }),
      sende: async (w) => { gesendet.push({ ...w }); return { status: 200, j: { werte: w } }; },
    });
    await Promise.resolve(); await Promise.resolve();
    const liste = el.querySelector('.p-hp-liste');
    const wert = { textContent: '' }, zeile = { querySelector: () => wert };
    const regler = { dataset: { index: '0' }, value: '0', closest: (s) => (s === '.p-hp-regler' ? regler : zeile) };
    for (let i = 1; i <= 10; i++) {                  // 100 ms of continuous movement
      regler.value = String(i / 10);
      for (const f of liste.listeners.input ?? []) f({ target: regler });
      mock.timers.tick(10);
    }
    assert.ok(gesendet.length >= 2, `sent during the drag: ${gesendet.length}`);
    assert.equal(gesendet.at(-1)[0] > 0.5, true, 'the newest value goes out, not the first');
    mock.timers.tick(PARAM_ENTPRELLEN_MS);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(gesendet.at(-1)[0], 1, 'the last value arrives after release');
  } finally { mock.timers.reset(); }
});
