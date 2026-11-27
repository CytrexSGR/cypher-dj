// Agent keys in the pairing dialog (page module): the pure row helpers and the dialog against a stubbed server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schluesselZeile, stufeText } from '../public/coupling.js';

test('stufeText: the three levels, unknown values as they are', () => {
  assert.equal(stufeText('lesen'), 'read only');
  assert.equal(stufeText('schreiben'), 'write');
  assert.equal(stufeText('zerstoerend'), 'full');
  assert.equal(stufeText('x'), 'x');
  assert.equal(stufeText(undefined), '');
});

test('schluesselZeile: name, level text, last use; never used and empty name have fallbacks', () => {
  const t = new Date(2026, 10, 22, 23, 1).getTime();
  assert.deepEqual(schluesselZeile({ id: 'a', name: 'hand', stufe: 'zerstoerend', zuletzt: t }),
    { id: 'a', name: 'hand', stufe: 'full', zuletzt: 'last used 22 Nov 2026, 23:01' });
  assert.deepEqual(schluesselZeile({ id: 'b', name: '', stufe: 'lesen' }), { id: 'b', name: 'Agent', stufe: 'read only', zuletzt: 'last used never' });
});

async function dialogMit(antwort) {
  const { installiere, El } = await import('./helpers/pages_mock.mjs');
  installiere();
  const { bindeKopplung } = await import('../public/coupling.js');
  const dialog = new El('dialog'); dialog.innerHTML = '<h2>Pair tablet</h2><div data-kopplung-inhalt></div>';
  dialog.open = false; dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  const aufrufe = [];
  const ruf = async (m, p, b) => { aufrufe.push(`${m} ${p}`); return antwort(m, p, b); };
  const k = bindeKopplung({ knopf: new El('button'), dialog, ruf });
  return { k, dialog, aufrufe, warte: async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); } };
}

test('dialog: route answers 404, the agent key section stays hidden and the tablet part works', async () => {
  const d = await dialogMit((m, p) => (p === '/hand/schluessel' ? { code: 404, j: {} }
    : m === 'GET' ? { code: 200, j: { an: false, geraete: [] } } : { code: 409, j: {} }));
  d.k.oeffne(); await d.warte();
  assert.equal(d.dialog.querySelector('[data-schluessel-neu]'), null);
  assert.equal(d.dialog.querySelector('[data-kopplung-liste]').textContent, 'none');
  d.k.schliesse();
});

test('dialog: keys are listed, a new key shows its token once, revoke posts the id', async () => {
  const keys = [{ id: 'k1', name: 'hand', stufe: 'schreiben', zuletzt: 0 }];
  const d = await dialogMit((m, p, b) => {
    if (p === '/hand/schluessel' && m === 'GET') return { code: 200, j: { schluessel: keys } };
    if (p === '/hand/schluessel' && m === 'POST') {
      keys.push({ id: 'k2', name: b.name, stufe: b.stufe });
      return { code: 200, j: { token: 'TOK123', id: 'k2' } };
    }
    if (p === '/hand/schluessel/loeschen') { keys.splice(0, 1); return { code: 200, j: {} }; }
    return m === 'GET' ? { code: 200, j: { an: false, geraete: [] } } : { code: 409, j: {} };
  });
  d.k.oeffne(); await d.warte();
  assert.equal(d.dialog.querySelectorAll('[data-schluessel-liste] li').length, 1);
  assert.match(d.dialog.querySelector('[data-schluessel-liste]').textContent, /hand.*write.*last used never/);
  d.dialog.querySelector('[data-schluessel-name]').value = 'tests';
  d.dialog.querySelector('[data-schluessel-stufe]').value = 'lesen';
  d.dialog.querySelector('[data-schluessel-neu]').click();
  await d.warte();
  assert.ok(d.aufrufe.includes('POST /hand/schluessel'));
  assert.equal(d.dialog.querySelector('[data-schluessel-token]').getAttribute('value'), 'TOK123');
  assert.match(d.dialog.querySelector('[data-kopplung-inhalt]').textContent, /Copy it now; it is not shown again\. Give it to the agent as its key file\./);
  d.dialog.querySelector('[data-schluessel-weg]').click(); await d.warte();
  assert.ok(d.aufrufe.includes('POST /hand/schluessel/loeschen'));
  d.k.schliesse();
});
