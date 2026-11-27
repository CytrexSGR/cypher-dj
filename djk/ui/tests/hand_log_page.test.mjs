// Task 6.2: the agent log panel. logZeile is pure; the binding is driven with stand-in elements and a stub fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logZeile, bindeHandLog } from '../public/hand_log.js';

test('logZeile: allowed and refused rows', () => {
  const t = new Date(2026, 10, 26, 9, 5, 7).getTime();
  assert.deepEqual(logZeile({ t, name: 'local', werkzeug: 'regler', aktion: 'setze', ok: true }),
    { zeit: '09:05:07', schluessel: 'local', werkzeug: 'regler setze', urteil: 'allowed', abgelehnt: false });
  const r = logZeile({ t, name: 'k', werkzeug: 'proj_export', ok: false, fehler: 'musik_laeuft' });
  assert.equal(r.urteil, 'refused: musik_laeuft'); assert.equal(r.abgelehnt, true); assert.equal(r.werkzeug, 'proj_export');
  assert.equal(logZeile({}).zeit, '--:--:--');
});

const el = () => ({ hidden: true, innerHTML: '', l: {}, addEventListener(e, f) { this.l[e] = f; }, setAttribute() {} });

test('panel: newest first, polls only while open, 404 is quiet', async () => {
  const knopf = el(), fenster = el(); let n = 0, code = 200, tick = null;
  const holen = async () => { n++; return { code, j: { zeilen: [{ t: 1, name: 'a', werkzeug: 'x', ok: true }, { t: 2, name: 'b', werkzeug: 'y', ok: false, fehler: 'zu_schnell' }] } }; };
  const p = bindeHandLog({ knopf, fenster, holen, takt: (f) => { tick = f; return 1; }, stopp: () => { tick = null; } });
  assert.equal(n, 0);
  p.oeffne(); await new Promise((r) => setImmediate(r));
  assert.equal(n, 1); assert.ok(fenster.innerHTML.indexOf('zu_schnell') < fenster.innerHTML.indexOf('>a<')); assert.ok(fenster.innerHTML.includes('class="refused"'));
  p.schliesse(); assert.equal(tick, null); assert.equal(fenster.hidden, true);
  code = 404; p.oeffne(); await new Promise((r) => setImmediate(r));
  assert.match(fenster.innerHTML, /No agent log/);
});
