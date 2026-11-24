// UI polish task 5 (finding Nr. 8): the SEQ deck head has nine keys and clips the primary ones at 1920 px. The primary row keeps PLAY, + pattern, the width
// chips (now labelled) and the large view; a menu key holds LOAD MODULE, CLEAR, hide empty, collapse all and open in PRODUCTION. Runs the real page against
// the DOM stand-in; the document listeners are collected here because the stand-in does not dispatch to the document.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const spur = { id: 's1', nr: 1, name: 'Drums', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: '909' }, ausgang: { art: 'gruppe', id: 'g_seq' }, mute: false, solo: false, fader_db: 0, pan: 0,
  clips: [{ id: 'c1', art: 'midi', name: 'Drums', start_beat: 0, laenge_beats: 64, loop_beats: 4, noten: [{ id: 'n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }] }] };
const projekt = () => ({ rev: 7, live: true, name: 'live', tempo: 128, gruppen: [{ id: 'g_seq', name: 'SEQ', seq: { platz: 2 } }], spuren: [spur], master: {}, szenen: [] });
const dokument = { keydown: [], click: [] };
const sende = (art, e) => {
  const e2 = { target: attrappe.body, preventDefault() {}, ...e, stopImmediatePropagation() { this.gestoppt = true; } };
  for (const { f } of [...dokument[art].filter((x) => x.erst), ...dokument[art].filter((x) => !x.erst)]) { f(e2); if (e2.gestoppt) break; }
  return e2;
};
let seq, live, modulGeklickt = 0;
const platz = () => attrappe.body.querySelector('section.seqplatz[data-seq="2"]');

before(async () => {
  installiere({
    html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /proj/liste': () => { modulGeklickt++; return { j: [{ slug: 'mod-a', name: 'Mod A', werkbank: true }] }; } },
  });
  const orig = document.addEventListener;
  // capture listeners first, like the browser; a stopImmediatePropagation ends the walk
  document.addEventListener = (art, f, ...rest) => { (dokument[art] ??= []).push({ f, erst: rest[0] === true }); return orig?.(art, f, ...rest); };
  await import('../public/app.js');
  live = (await import('../public/live_view.js')).live;
  seq = await import('../public/seq_view.js');
  await new Promise((r) => setTimeout(r, 40));
  live.projekt = projekt(); live.rev = 7;
  seq.zeichneSeq();
});

const haken = ['sqModul', 'seqLeeren', 'sqLeerAus', 'sqAlleZu', 'sqProduktion'];
const hakenVon = (el) => el.querySelectorAll('button').map((b) => Object.keys(b.dataset).find((k) => haken.includes(k)) ?? Object.keys(b.dataset)[0]);

test('the head has a menu key; the menu holds exactly the five hooks, the primary row the rest', () => {
  const k = platz();
  assert.ok(k, 'the SEQ node exists');
  const mehr = k.querySelector('[data-sq-mehr]'), menue = k.querySelector('.sq-menue');
  assert.ok(mehr && menue);
  assert.equal(mehr.textContent, '⋯');
  assert.deepEqual(hakenVon(menue).sort(), [...haken].sort());
  assert.equal(menue.hidden, true, 'closed at the start');
  const primaer = k.querySelector('.sq-rechts').children.filter((c) => c !== menue).map((c) => c.dataset?.sqSpiel !== undefined ? 'spiel' : c.dataset?.sqNeu !== undefined ? 'neu' : c.dataset?.sqGross !== undefined ? 'gross' : c.dataset?.sqMehr !== undefined ? 'mehr' : c.className);
  assert.deepEqual(primaer, ['spiel', 'neu', 'sq-breite-wort', 'sq-breite', 'gross', 'mehr']);
});

test('the width group has the visible label "bars" and the title "Visible width in bars"', () => {
  const k = platz();
  const wort = k.querySelector('.sq-breite-wort');
  assert.equal(wort.textContent, 'bars');
  assert.equal(k.querySelector('.sq-breite').title, 'Visible width in bars');
  assert.deepEqual(k.querySelectorAll('[data-sq-breite]').map((b) => b.textContent), ['1', '2', '4', 'all']);
});

test('the menu key opens and closes the menu; aria-expanded follows', () => {
  const k = platz(), mehr = k.querySelector('[data-sq-mehr]'), menue = k.querySelector('.sq-menue');
  mehr.click();
  assert.equal(menue.hidden, false);
  assert.equal(mehr.getAttribute('aria-expanded'), 'true');
  assert.equal(k._menue.offen(), true);
  mehr.click();
  assert.equal(menue.hidden, true);
  assert.equal(mehr.getAttribute('aria-expanded'), 'false');
});

test('Escape and a click outside close the menu; a click inside does not', () => {
  const k = platz(), mehr = k.querySelector('[data-sq-mehr]'), menue = k.querySelector('.sq-menue');
  mehr.click();
  const esc = sende('keydown', { key: 'Escape' });
  assert.equal(menue.hidden, true, 'Escape closes it');
  assert.equal(esc.gestoppt, true, 'and the library does not also fold on that key');
  const andere = sende('keydown', { key: 'Escape' });
  assert.equal(andere.gestoppt, undefined, 'with no menu open the key passes on');
  mehr.click();
  sende('click', { target: menue });
  assert.equal(menue.hidden, false, 'a click inside the menu keeps it');
  sende('click', { target: attrappe.body });
  assert.equal(menue.hidden, true, 'a click outside closes it');
});

test('LOAD MODULE inside the menu still calls the handler bound to sqModul, and the menu closes after the click', async () => {
  const k = platz(), mehr = k.querySelector('[data-sq-mehr]'), menue = k.querySelector('.sq-menue');
  const modul = menue.querySelector('[data-sq-modul]');
  assert.equal(modul.textContent, 'LOAD MODULE');
  mehr.click();
  modulGeklickt = 0;
  modul.click();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(modulGeklickt, 1, 'the module list was asked once');
  assert.equal(menue.hidden, true);
});

test('the style gives the menu its own layer and keeps the five items out of the primary row', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  assert.match(css, /\.sq-menue \{[^}]*position: fixed/);
  assert.match(css, /\.sq-menue\[hidden\] \{ display: none; \}/);
});
