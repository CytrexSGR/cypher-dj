// DJ view: the live set is closed (another project is open, or none): one banner above the desk with one key, the place heads stay quiet.
// Real page on the DOM stand-in. The page never opens the live set on its own; the key calls the hook that app.js wires to liveOeffnen.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PLAETZE = [{ typ: 'seq', gruppe: 'g2' }, { typ: 'track' }, { typ: 'strudel', gruppe: 'g1' }, { typ: 'track' }];
let ansicht, la;
let lage = null;   // what GET /lage answers: null = no live project (a production project is open)
let aktuell = { slug: 'p1', rev: 3 };
const warte = () => new Promise((r) => setTimeout(r, 30));
const banner = () => attrappe.body.querySelector('#live-zu');
const hinweise = () => attrappe.body.querySelectorAll('[data-platz-hinweis]').map((e) => e.textContent);

before(async () => {
  installiere({ html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /lage': () => ({ j: lage ? { plaetze: PLAETZE, container: [] } : {} }), 'GET /proj/aktuell': () => ({ j: aktuell }) } });
  await import('../public/app.js');
  ansicht = await import('../public/slots_view.js');
  la = await import('../public/live_view.js');
  await warte();
});

test('another project open: the banner shows the closed-because sentence and the key, and no head hint says modules', async () => {
  lage = null; la.live.projekt = null; la.live.anderes = 'p1';
  await ansicht.holeLage();
  assert.ok(banner(), 'the page has #live-zu');
  assert.equal(banner().hidden, false);
  assert.equal(banner().getAttribute('role'), 'status');
  assert.match(banner().textContent, /The live set is closed because another project is open\./);
  assert.ok(banner().querySelector('[data-live-oeffnen]'));
  assert.equal(banner().querySelector('[data-live-oeffnen]').textContent, 'OPEN LIVE SET');
  assert.ok(hinweise().length >= 4);
  assert.ok(hinweise().every((t) => t === ''), `heads stay empty: ${JSON.stringify(hinweise())}`);
  assert.doesNotMatch(banner().textContent, /module|place/i);
  const typ = attrappe.body.querySelector('[data-platz-typ]');
  assert.equal(typ.disabled, true);
  assert.equal(typ.title, 'Open the live set first');
});

test('no project at all: the plain sentence', async () => {
  lage = null; la.live.projekt = null; la.live.anderes = null;
  await ansicht.holeLage();
  assert.equal(banner().hidden, false);
  assert.match(banner().textContent, /The live set is not open\./);
});

test('the key calls the hook once and sends no request of its own', async () => {
  lage = null; la.live.anderes = 'p1';
  let n = 0;
  ansicht.setzeLiveOeffnen(async () => { n++; return { ok: true }; });
  await ansicht.holeLage();
  const vor = attrappe.anrufe.length;
  banner().querySelector('[data-live-oeffnen]').click();
  await warte();
  assert.equal(n, 1);
  assert.equal(attrappe.anrufe.length, vor, 'the banner code sends nothing itself');
});

test('a refused open leaves the banner, reports nothing itself and sends nothing further', async () => {
  lage = null; la.live.anderes = 'p1';
  let n = 0;
  ansicht.setzeLiveOeffnen(async () => { n++; return { ok: false, abgelehnt: true }; });
  await ansicht.holeLage();
  const vor = attrappe.anrufe.length, meldung = attrappe.body.querySelector('#meldung')?.textContent ?? '';
  banner().querySelector('[data-live-oeffnen]').click();
  await warte();
  assert.equal(n, 1);
  assert.equal(banner().hidden, false, 'the banner stays');
  assert.equal(attrappe.anrufe.length, vor);
  assert.equal(attrappe.body.querySelector('#meldung')?.textContent ?? '', meldung, 'no message from the banner code');
});

test('a live project is open: the banner is hidden', async () => {
  lage = true; la.live.projekt = { live: true, gruppen: [] }; la.live.anderes = null;
  await ansicht.holeLage();
  assert.equal(banner().hidden, true);
});

test('live.anderes follows pruefeLive: the slug of the open production project, null once the live set is read, null with no project', async () => {
  la.live.projekt = null; la.live.anderes = null; la.live.rev = null; la.live.schreiben.clear(); la.live.laeuft = false; la.live.seqLaeuft = false;
  aktuell = { slug: 'p1', rev: 3 };
  await la.pruefeLive();
  assert.equal(la.live.anderes, 'p1');
  aktuell = { slug: 'live', rev: 4, projekt: { live: true, rev: 4, gruppen: [] } };
  attrappe.antworten['GET /modul/stand'] = { j: {} };
  await la.pruefeLive();
  assert.equal(la.live.anderes, null);
  aktuell = { slug: null };
  await la.pruefeLive();
  assert.equal(la.live.anderes, null, 'no project at all: nothing else is open');
});

test('before the first read of /proj/aktuell no banner is drawn (no flicker between "not open" and "another project"); after it, once and right', async () => {
  lage = null; la.live.projekt = null; la.live.anderes = 'p1'; la.live.gelesen = false;
  await ansicht.holeLage();
  assert.equal(banner().hidden, true, 'unknown yet: nothing');
  la.live.gelesen = true;
  ansicht.zeigePlaetze();
  assert.equal(banner().hidden, false);
  assert.match(banner().textContent, /another project is open/);
});

test('pruefeLive sets gelesen itself after a real read; a failed read leaves it false and shows a neutral text', async () => {
  lage = null; la.live.projekt = null; la.live.anderes = null; la.live.rev = null; la.live.slug = null; la.live.gelesen = false; la.live.lesefehler = false;
  la.live.schreiben.clear(); la.live.laeuft = false; la.live.seqLaeuft = 0;
  attrappe.antworten['GET /proj/aktuell'] = () => { throw new Error('offline'); };
  await la.pruefeLive();
  assert.equal(la.live.gelesen, false, 'an error is no reading');
  await ansicht.holeLage();
  ansicht.zeigePlaetze();
  assert.equal(banner().hidden, false);
  assert.match(banner().textContent, /could not be read/);
  attrappe.antworten['GET /proj/aktuell'] = () => ({ j: { slug: 'p1', rev: 3 } });
  await la.pruefeLive();
  assert.equal(la.live.gelesen, true, 'set by pruefeLive, not by hand');
  assert.equal(la.live.lesefehler, false);
  ansicht.zeigePlaetze();
  assert.match(banner().textContent, /another project is open/);
});
