// Task 8.2: the channel strip row of the Strudel place, on the real app.js and index.html (DOM stand-in, fake fetch; no studio port).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
let kb, deck, spur, instanzen;

before(async () => {
  installiere({
    html,
    antworten: {
      'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /graphen': { j: { graphen: [] } }, 'GET /proj/kits': { j: { kits: [] } }, 'GET /proj/liste': { j: [] },
      'GET /strudel': { j: { text: 's("bd")', autonom: true, bezeichnung: 'conga' } },
    },
  });
  await import('../public/app.js');
  kb = await import('../public/kanalband.js');
  deck = await import('../public/deck_view.js');
  instanzen = (await import('../public/instanzen.js')).instanzen;
  await new Promise((r) => setTimeout(r, 40));
  kb.zeigeKanalband();
});
const wurzel = () => attrappe.body.querySelector('#kanalband');
const zelle = (n) => wurzel().querySelector(`.kanalzelle[data-strom="${n}"]`);

test('the strip sits in the Strudel place above the stream rows, one cell per stream row, number first', () => {
  assert.ok(html.indexOf('id="kanalband"') > html.indexOf('id="deck-c"') && html.indexOf('id="kanalband"') < html.indexOf('id="strudel-zeilen"'));
  assert.deepEqual([...instanzen.keys()].sort(), ['1', '2', '3'].map(Number).sort());
  for (const n of [1, 2, 3]) assert.equal(zelle(n).querySelector('.kanalnr').textContent, String(n));
  assert.equal(zelle(2).querySelector('.meter').dataset.kanal, 'erz/2');
});

test('a label from /strudel?strom=5 appears in cell 5; without one the pattern start shows, dimmed', () => {
  instanzen.set(5, {});
  kb.meldeStrom(5, 'acid line', 's("a")');
  assert.equal(zelle(5).querySelector('.kanalname').textContent, 'acid line');
  assert.equal(zelle(5).querySelector('.kanalname').classList.contains('ohne-bezeichnung'), false);
  kb.meldeStrom(5, null, 'note("c2 e2")   .s("sawtooth")');
  assert.equal(zelle(5).querySelector('.kanalname').textContent, 'note("c2 e2") .s("sawtooth")');
  assert.equal(zelle(5).querySelector('.kanalname').classList.contains('ohne-bezeichnung'), true);
  instanzen.delete(5);
  kb.zeigeKanalband();
  assert.equal(zelle(5), null);
});

test('a /pegel event moves the strip meter through the existing zeigePegel', () => {
  deck.zeigePegel('erz/2', -30);
  deck.zeigePegelJetzt();
  assert.equal(zelle(2).querySelector('.meter i').style.width, '50%');
});

test('a jump of 10 dB over the floor sets the blink class; a steady level does not', () => {
  let t = 0;
  kb.setzeUhr(() => t);
  deck.zeigePegel('erz/3', -40); deck.zeigePegel('erz/3', -40);
  assert.equal(zelle(3).classList.contains('blinkt'), false);
  t += 100;
  deck.zeigePegel('erz/3', -30);
  assert.equal(zelle(3).classList.contains('blinkt'), true);
});

test('the floor rises 1 dB/s: after 20 s the same level no longer blinks', async () => {
  let t = 0;
  kb.setzeUhr(() => t);
  deck.zeigePegel('erz/1', -50);
  t += 20000;
  deck.zeigePegel('erz/1', -40);   // floor is min(-40, -50 + 20) = -40
  assert.equal(zelle(1).classList.contains('blinkt'), false);
});

test('B6: after silence the first audible level blinks once, a steady level stops blinking within 2 s', () => {
  let t = 0;
  kb.setzeUhr(() => t);
  deck.zeigePegel('erz/2', -200);
  t += 100;
  deck.zeigePegel('erz/2', -20);
  assert.equal(zelle(2).classList.contains('blinkt'), true, 'blinks once on the way out of silence');
  zelle(2).classList.remove('blinkt');
  for (let i = 0; i < 4; i++) {   // 2 s of steady level, an event every 500 ms
    t += 500;
    deck.zeigePegel('erz/2', -20);
    assert.equal(zelle(2).classList.contains('blinkt'), false, `no blink ${(i + 1) * 500} ms into the steady level`);
  }
});

test('a /spur list with bogen renders "in 3 bars: drop"; none hides the line', () => {
  kb.zeigeBogen([{ name: 'x', fahrten: [] }, { name: 'bogen-a', bogen: { name: 'build', takte: 16, takt_im_bogen: 5, naechste: { in_takten: 3, text: 'drop' } } }]);
  const l = wurzel().querySelector('.kanalbogen');
  assert.equal(l.hidden, false);
  assert.match(l.textContent, /build/);
  assert.match(l.textContent, /5\/16/);
  assert.match(l.textContent, /in 3 bars: drop/);
  kb.zeigeBogen([]);
  assert.equal(wurzel().querySelector('.kanalbogen').hidden, true);
});

test('readable from two metres: number >= 28 px, label >= 20 px', () => {
  const px = (sel) => Number(new RegExp(`${sel.replace('.', '\\.')} \\{[^}]*font-size: (\\d+)px`).exec(css)?.[1]);
  assert.ok(px('.kanalnr') >= 28);
  assert.ok(px('.kanalname') >= 20);
  assert.ok(px('.kanalname.ohne-bezeichnung') >= 20);
});
