// UI polish T7 (Nr. 2): the DJ FX fold of the header applies to PRODUCTION as it does to STUDIO and TRACKER; the key shows there and toggles the class.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
const regel = (muster) => css.split('\n').find((z) => z.includes(muster)) ?? '';

test('the stylesheet hides #fx and #seq-szenen under body.produktion without djfx-auf and shows the key', () => {
  assert.match(regel('body.produktion:not(.djfx-auf) #kopf > #fx'), /display: none/);
  assert.match(regel('body.produktion:not(.djfx-auf) #kopf > #seq-szenen'), /display: none/);
  assert.match(regel('body.produktion #djfx-auf'), /display: inline-block/);
  assert.match(regel('#djfx-auf { display: none'), /display: none/, 'the key stays hidden in the DJ view');
});

test('clicking the key in the real page adds djfx-auf to the body and sets aria-pressed', async () => {
  const { installiere, attrappe } = await import('./helpers/pages_mock.mjs');
  installiere({ html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] } } });
  await import('../public/app.js');
  const b = attrappe.body.querySelector('#djfx-auf');
  assert.ok(b, 'the key exists');
  assert.ok(!attrappe.body.classList.contains('djfx-auf'));
  b.click();
  assert.ok(attrappe.body.classList.contains('djfx-auf'));
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  b.click();
  assert.ok(!attrappe.body.classList.contains('djfx-auf'));
});
