// A stem fader in the live container panel that has the keyboard focus keeps it after the panel is redrawn (its own write coming back, an event).
// zeichneLive replaces the markup of #live-panel; without the focus coming back the second arrow key scrolls the page instead of moving the fader.
// Uses the DOM stand-in (no jsdom in the repo), like page_seq.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const projekt = (db) => ({
  live: true, rev: 3, tempo_bpm: 128,
  gruppen: [
    { id: 'gA', name: 'Modul A', fader_db: 0, modul: { slot: 'A', titel: 'Loop', kuenstler: '', bpm: 128, tonart: '', laenge_beats: 16 } },
    { id: 'gD', name: 'Drums', ausgang: { id: 'gA' }, fader_db: 0 },
  ],
  spuren: [{ id: 'sD', art: 'audio', ausgang: { id: 'gD' }, fader_db: db, clips: [] }],
});

test('a keyboard step on a live stem fader keeps the focus on that fader after the write returns', async () => {
  let db = 0;
  installiere({
    html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    antworten: {
      'POST /proj/aendern': (k) => { db = k.befehle[0].fader_db; return { code: 200, j: { rev: 4, projekt: { ...projekt(db), rev: 4 } } }; },
    },
  });
  const m = await import('../public/live_view.js');
  m.bindeLive();
  m.live.projekt = projekt(0); m.live.rev = 3; m.live.stand = {};
  m.zeichneLive();
  const p = document.querySelector('#live-panel');
  const r = p.querySelector('.live-regler');
  assert.ok(r, 'the stem fader is drawn');
  assert.equal(r.dataset.spurId, 'sD');
  r.focus();
  r.dispatch('keydown', { key: 'ArrowDown' });
  r.value = String(Number(r.value) - 5);   // what the browser does on ArrowDown
  r.dispatch('input');
  await new Promise((x) => setTimeout(x, 30));
  assert.ok(db < 0, `the write went out: ${db}`);
  assert.ok(attrappe.anrufe.some((a) => a.url === '/proj/aendern'), 'POST /proj/aendern was sent');
  const jetzt = [...p.querySelectorAll('.live-regler')];
  const ak = document.activeElement;
  assert.ok(jetzt.includes(ak), 'the focused element is a fader that is still in the panel (not a detached one)');
  assert.equal(ak.dataset.spurId, 'sD', 'the focus sits on the same stem fader');
});

test('any redraw of the panel (an event) keeps the focus on the fader; a focus outside the panel is left alone', async () => {
  installiere({ html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8') });
  const m = await import('../public/live_view.js');
  m.bindeLive();
  m.live.projekt = projekt(0); m.live.rev = 3; m.live.stand = {};
  m.zeichneLive();
  const p = document.querySelector('#live-panel');
  const vorher = p.querySelector('.live-regler');
  vorher.focus();
  m.zeichneLive();
  const jetzt = p.querySelector('.live-regler');
  assert.notEqual(jetzt, vorher, 'the markup was replaced');
  assert.equal(document.activeElement, jetzt, 'the focus came back to the new fader of the same track');
  const woanders = document.createElement('button');
  document.body.append(woanders); woanders.focus();
  m.zeichneLive();
  assert.equal(document.activeElement, woanders, 'a focus outside the panel stays');
});

test('giving the focus back to a fader after a redraw does not scroll the page', async () => {
  installiere({ html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8') });
  const m = await import('../public/live_view.js');
  m.bindeLive();
  m.live.projekt = projekt(0); m.live.rev = 3; m.live.stand = {};
  m.zeichneLive();
  const p = document.querySelector('#live-panel');
  p.querySelector('.live-regler').focus();
  attrappe.fokusAufrufe = [];
  m.zeichneLive();
  const aufrufe = attrappe.fokusAufrufe.filter((a) => a.ziel === document.activeElement);
  assert.equal(aufrufe.length, 1, 'the new fader got the focus once');
  assert.equal(aufrufe[0].opt?.preventScroll, true, 'focus({ preventScroll: true }): the page stays where the hand left it');
});
