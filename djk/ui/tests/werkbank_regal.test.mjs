// Workbench task 10: the shelf strip (region `regal`). Run against the DOM stand-in; the requests the cards send are asserted, not only the markup.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { regalEintraege } = await import('../public/werkbank/regal.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const GETS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url === weg);

const VORLAGEN = { vorlagen: [{ id: 'techno-130-start', name: 'Techno 130 · Start', text: 'Drums 909 and Bass Banddrive, 4 bars, 130 BPM' }] };
const modul = (name) => ({
  name, rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 },
  spuren: [{ id: 's1', name: 'Drums', art: 'instrument', clips: [] }],
});
const LISTE = [
  { slug: 'beta', name: 'Beta', werkbank: true, geaendert: '2026-11-14T09:30:00.000Z' },
  { slug: 'song', name: 'Plain Song', geaendert: '2026-11-01T00:00:00.000Z' },
  { slug: 'alpha', name: 'Alpha', werkbank: true, geaendert: '2026-11-15T12:00:00.000Z' },
];

let wurzel, w, fragen;
function aufbau({ liste = LISTE, aktuell = { slug: null }, frage = () => true } = {}) {
  installiere({ antworten: { 'GET /proj/aktuell': { j: aktuell }, 'GET /proj/liste': { j: liste }, 'GET /proj/werkbank/vorlagen': { j: VORLAGEN } } });
  wurzel = document.createElement('section');
  fragen = [];
  w = bindeWerkbank({ post, wurzel, frage: (t) => { fragen.push(t); return frage(t); } });
}
const regal = () => wurzel.querySelector('[data-w="regal"]');
const karten = () => regal().querySelectorAll('.w-karte');
const karte = (text) => { const k = karten().find((x) => x.textContent.includes(text)); assert.ok(k, `no card with ${text}`); return k; };
beforeEach(() => aufbau());

test('regalEintraege keeps modules only, sorted, marks the open one', () => {
  const e = regalEintraege([{ slug: 'b', name: 'Beta', werkbank: true }, { slug: 'p', name: 'Plain' }, { slug: 'a', name: 'Alpha', werkbank: true }], VORLAGEN, 'b');
  assert.deepEqual(e.module.map((m) => [m.name, m.offen]), [['Alpha', false], ['Beta', true]]);
});

test('regalEintraege carries the change date and keeps a broken entry with its text', () => {
  const e = regalEintraege([{ slug: 'k', name: 'k', fehler: 'json_kaputt', text: 'The file is broken' }, { slug: 'a', name: 'Alpha', werkbank: true, geaendert: '2026-11-15T12:00:00.000Z' }], VORLAGEN, null);
  assert.deepEqual(e.module.map((m) => m.slug), ['a', 'k']);
  assert.equal(e.module[0].geaendert, '2026-11-15T12:00:00.000Z');
  assert.equal(e.module[1].fehler, 'json_kaputt');
  assert.equal(e.module[1].text, 'The file is broken');
});

test('the shelf strip shows the label, the single tab, the hint, module cards with a date, template cards and the empty-module card', async () => {
  w.zeige(); await ruhe();
  const t = regal().textContent;
  assert.ok(t.includes('SHELF'));
  assert.ok(t.includes('MODULES'));
  assert.ok(t.includes('click = open the module · changes are saved as you make them'));
  assert.equal(regal().querySelectorAll('.w-tab').length, 1);
  assert.deepEqual(karten().map((k) => k.querySelector('b').textContent), ['Alpha', 'Beta', 'Techno 130 · Start', '+ empty module']);
  assert.ok(karte('Alpha').textContent.includes('2026-11-15'));
  assert.ok(karte('Techno 130 · Start').textContent.includes('template'));
  assert.ok(karte('Techno 130 · Start').textContent.includes('Drums 909 and Bass Banddrive'));
  assert.ok(!t.includes('Plain Song'));
});

test('a module card opens it; the open card sends nothing; a template card creates it', async () => {
  w.zeige(); await ruhe();
  attrappe.antworten['POST /proj/oeffnen'] = { j: { slug: 'alpha', projekt: modul('Alpha') } };
  const g0 = GETS('/proj/liste').length;
  karte('Alpha').dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/proj/oeffnen').map((a) => a.koerper), [{ slug: 'alpha' }]);
  assert.equal(w.ctx.st.slug, 'alpha');
  assert.ok(GETS('/proj/liste').length > g0, 'the shelf is fetched again after opening');
  // the open card is marked, disabled, and a click sends nothing
  const offen = karte('Alpha');
  assert.ok(offen.classList.contains('offen'));
  assert.ok(offen.textContent.includes('open'));
  assert.equal(offen.disabled, true);
  offen.dispatch('click'); await ruhe();
  assert.equal(POSTS('/proj/oeffnen').length, 1);
  assert.equal(POSTS('/proj/neu').length, 0);
  // a template card creates the module with its template
  attrappe.antworten['POST /proj/neu'] = { j: { slug: 'techno-130-start', projekt: modul('Techno 130 · Start') } };
  const g1 = GETS('/proj/liste').length;
  karte('Techno 130 · Start').dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/proj/neu').map((a) => a.koerper), [{ name: 'Techno 130 · Start', werkbank: true, vorlage: 'techno-130-start' }]);
  assert.equal(w.ctx.st.slug, 'techno-130-start');
  assert.ok(GETS('/proj/liste').length > g1, 'the shelf is fetched again after creating');
});

test('a module card refused by the live-container question sends nothing more', async () => {
  aufbau({ frage: () => false });
  w.zeige(); await ruhe();
  attrappe.antworten['POST /proj/oeffnen'] = { code: 409, j: { fehler: 'live_container_offen', text: 'A live container is open. Close it?' } };
  karte('Beta').dispatch('click'); await ruhe();
  assert.ok(POSTS('/proj/oeffnen').length <= 1);
  assert.equal(w.ctx.st.slug, null);
});

test('the empty-module card asks for a name; Enter creates, Escape sends nothing', async () => {
  w.zeige(); await ruhe();
  const feld = regal().querySelector('[data-w="regal-name"]');
  assert.equal(feld.hidden, true);
  karte('+ empty module').dispatch('click');
  assert.equal(feld.hidden, false);
  feld.value = 'x'; feld.dispatch('keydown', { key: 'Escape' }); await ruhe();
  assert.equal(feld.hidden, true);
  assert.equal(POSTS('/proj/neu').length, 0);
  karte('+ empty module').dispatch('click');
  attrappe.antworten['POST /proj/neu'] = { j: { slug: 'mine', projekt: modul('Mine') } };
  feld.value = '  Mine '; feld.dispatch('keydown', { key: 'Enter' }); await ruhe();
  assert.deepEqual(POSTS('/proj/neu').map((a) => a.koerper), [{ name: 'Mine', werkbank: true }]);
  assert.equal(w.ctx.st.slug, 'mine');
});

test('a broken list entry (fehler json_kaputt) is shown disabled with its text, not opened', async () => {
  aufbau({ liste: [{ slug: 'kaputt', name: 'kaputt', fehler: 'json_kaputt', text: 'The project file is broken', geaendert: '2026-11-10T00:00:00.000Z' }, ...LISTE] });
  w.zeige(); await ruhe();
  const k = karte('kaputt');
  assert.equal(k.disabled, true);
  assert.ok(k.classList.contains('kaputt'));
  assert.equal(k.getAttribute('title'), 'The project file is broken');
  k.dispatch('click'); await ruhe();
  assert.equal(POSTS('/proj/oeffnen').length, 0);
  // the empty state offers it disabled as well
  const o = wurzel.querySelector('[data-w="leer-oeffnen"]').querySelectorAll('option').find((x) => x.value === 'kaputt');
  assert.ok(o === undefined || o.disabled === true);
});

test('after a restart of the server the shelf lists the modules when none is open', async () => {
  aufbau({ aktuell: { slug: null } });
  w.zeige(); await ruhe();
  assert.equal(w.ctx.st.projekt, null);
  assert.ok(karte('Alpha'));
  assert.ok(!karte('Alpha').classList.contains('offen'));
});
