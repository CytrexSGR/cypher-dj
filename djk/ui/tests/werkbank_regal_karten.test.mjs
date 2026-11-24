// Plan 8 task 8: the shelf cards. The mark ("template", "open") is the first line of its card in normal flow, the title carries its full name, the date is the shared one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installiere } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { datumText } = await import('../public/format_text.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const VORLAGEN = { vorlagen: [{ id: 'techno-130-start', name: 'Techno 130 · Start', text: 'Drums 909 and Bass Banddrive, 4 bars, 130 BPM' }] };
const modul = (name) => ({ name, rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren: [{ id: 's1', name: 'Drums', art: 'instrument', clips: [] }] });
const LISTE = [
  { slug: 'beta', name: 'Beta', werkbank: true, geaendert: '2026-11-14T09:30:00.000Z' },
  { slug: 'alpha', name: 'Alpha', werkbank: true, geaendert: '2026-11-15T12:00:00.000Z' },
];

let wurzel, w;
async function aufbau(aktuell = { slug: null }) {
  installiere({ antworten: { 'GET /proj/aktuell': { j: aktuell }, 'GET /proj/liste': { j: LISTE }, 'GET /proj/werkbank/vorlagen': { j: VORLAGEN } } });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
  w.zeige(); await ruhe();
}
const karten = () => wurzel.querySelector('[data-w="regal"]').querySelectorAll('.w-karte');
const karte = (text) => { const k = karten().find((x) => x.textContent.includes(text)); assert.ok(k, `no card with ${text}`); return k; };

test('a template card starts with its mark "template"; the title keeps its full name in title', async () => {
  await aufbau();
  const k = karte('Techno 130 · Start');
  assert.equal(k.children[0].className, 'w-karte-marke');
  assert.equal(k.children[0].textContent, 'template');
  assert.equal(k.querySelector('b').getAttribute('title'), 'Techno 130 · Start');
});

test('the card of the open module starts with "open"; the date line is datumText', async () => {
  await aufbau({ slug: 'alpha', projekt: modul('Alpha') });
  const k = karte('Alpha');
  assert.equal(k.children[0].className, 'w-karte-marke');
  assert.equal(k.children[0].textContent, 'open');
  assert.equal(k.children[2].textContent, datumText('2026-11-15T12:00:00.000Z'));
  assert.equal(karte('Beta').children[0].tagName === 'I', false, 'a module that is not open has no mark');
  assert.equal(karte('Beta').children[1].textContent, datumText('2026-11-14T09:30:00.000Z'));
});

test('regal.css: the mark is a static first line, the title has no padding for an absolute mark', () => {
  const css = readFileSync(new URL('../public/werkbank/regal.css', import.meta.url), 'utf8');
  const regel = css.split('\n').find((z) => z.includes('.w-karte .w-karte-marke {'));
  assert.ok(regel.includes('position: static') && regel.includes('order: -1') && regel.includes('margin-bottom: 2px'), regel);
  assert.ok(!css.includes('position: absolute; top: 6px; right: 8px; font-style'), 'the absolute mark is gone');
  assert.ok(!css.includes(':has(.w-karte-marke) b'), 'no dead 44 px gap on the title');
});
