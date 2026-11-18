// Header beat dots follow the open project's meter n/4 (plan studio-taktart, follow-up 2 item 2); at 4 the DOM is the one of index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zeigeSchlagPunkte } from '../public/bar_live.js';

// minimal DOM double: a container with <i> children
function behaelter(anzahl) {
  const mk = () => { const s = new Set(); return { classList: { toggle: (k, an) => (an ? s.add(k) : s.delete(k)), has: (k) => s.has(k) }, _s: s }; };
  const el = { kinder: Array.from({ length: anzahl }, mk), querySelectorAll() { return this.kinder; }, replaceChildren(...k) { this.kinder = k; } };
  return { el, neu: mk };
}
const an = (el) => el.kinder.map((i) => (i.classList.has('an') ? 1 : 0)).join('');

test('index.html holds the four <i> dots of 4/4', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<div class="schlaege" id="schlaege"><i></i><i></i><i></i><i></i></div>'));
});

test('proTakt 4: the four dots stay, no rebuild, the dot of the beat in the bar is lit (same as the old % 4)', () => {
  const { el, neu } = behaelter(4);
  const vorher = el.kinder.slice();
  for (const [b, w] of [[0, '1000'], [1.5, '0100'], [3.99, '0001'], [4, '1000'], [-0.5, '0001'], [10.3, '0010']]) {
    zeigeSchlagPunkte(el, b, 4, neu);
    assert.equal(an(el), w, String(b));
  }
  assert.deepEqual(el.kinder, vorher, 'the same nodes');
});

test('proTakt 3: three dots (one removed), beat 4.2 is the second dot; back to 4 builds four again', () => {
  const { el, neu } = behaelter(4);
  zeigeSchlagPunkte(el, 4.2, 3, neu);
  assert.equal(el.kinder.length, 3);
  assert.equal(an(el), '010');
  zeigeSchlagPunkte(el, 11, 3, neu);
  assert.equal(an(el), '001');
  zeigeSchlagPunkte(el, 5, 4, neu);
  assert.equal(el.kinder.length, 4);
  assert.equal(an(el), '0100');
});

test('proTakt 12 builds twelve dots; the default proTakt is 4', () => {
  const { el, neu } = behaelter(4);
  zeigeSchlagPunkte(el, 11.5, 12, neu);
  assert.equal(an(el), '000000000001');
  zeigeSchlagPunkte(el, 2, undefined, neu);
  assert.equal(an(el), '0010');
});
