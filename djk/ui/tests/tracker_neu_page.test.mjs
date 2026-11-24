// Tracker task 22: the NEW MODULE menu of the TRACKER view (public/tracker/neu.js) against the DOM stand-in. The request body, the confirmation of the live
// container, the refusal text, and that the menu is there with and without an open project. Nothing is sent but POST /proj/neu.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeTracker, BINDER } = await import('../public/tracker/tracker.js');
const { neuKoerper, NEU_EINTRAEGE, bindeNeu } = await import('../public/tracker/neu.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url.startsWith('/proj/neu'));
const projekt = (name) => ({ name, rev: 3, tempo_bpm: 125, taktart: [4, 4], loop: { an: false, von_beat: 0, bis_beat: 16 }, spuren: [], tracker: { schema: 1 } });

let wurzel, w, fragen;
function aufbau({ antwort = { j: { slug: 'neu', projekt: projekt('Neu') } }, frage = true } = {}) {
  installiere({ antworten: { 'POST /proj/neu': antwort } });
  wurzel = document.createElement('section');
  fragen = [];
  w = bindeTracker({ post, wurzel, frage: (t) => { fragen.push(t); return frage; } });
}
const $t = (n, i = 0) => wurzel.querySelectorAll(`[data-t="${n}"]`)[i];
beforeEach(() => aufbau());

test('the binder is appended by its own block; the pure body of a request', () => {
  assert.equal(BINDER.at(-1), bindeNeu);
  assert.deepEqual(NEU_EINTRAEGE.map((e) => e.vorlage), [null, '8bit-4kanal', 'chip']);
  assert.deepEqual(neuKoerper(NEU_EINTRAEGE[1]), { name: '8-BIT · 4 CHANNELS', tracker: true, vorlage: '8bit-4kanal' });
  assert.deepEqual(neuKoerper(NEU_EINTRAEGE[2], '  My Chip '), { name: 'My Chip', tracker: true, vorlage: 'chip' });
  assert.deepEqual(neuKoerper(NEU_EINTRAEGE[0], ' Mine '), { name: 'Mine', tracker: true });
});

test('the menu is in the bar and in the empty pane, closed at first, three items', () => {
  assert.equal(wurzel.querySelectorAll('[data-t="neu"]').length, 2);
  assert.equal($t('neu-menue', 0).hidden, true);
  assert.equal($t('neu-menue', 1).hidden, true);
  $t('neu', 1).dispatch('click');
  assert.equal($t('neu-menue', 1).hidden, false);
  assert.deepEqual(['neu-leer', 'neu-8bit-4kanal', 'neu-chip'].map((n) => wurzel.querySelectorAll(`[data-t="${n}"]`).length), [2, 2, 2]);
});

test('a template item creates the module with tracker true and its template; the view takes the project over', async () => {
  $t('neu', 1).dispatch('click');
  $t('neu-8bit-4kanal', 1).dispatch('click'); await ruhe();
  assert.deepEqual(POSTS().map((a) => a.koerper), [{ name: '8-BIT · 4 CHANNELS', tracker: true, vorlage: '8bit-4kanal' }]);
  assert.equal(w.ctx.st.slug, 'neu');
  assert.equal($t('neu-menue', 1).hidden, true, 'the menu closes');
});

test('EMPTY asks for a name; Enter creates without a template, Escape sends nothing', async () => {
  $t('neu', 0).dispatch('click');
  $t('neu-leer', 0).dispatch('click');
  const feld = $t('neu-name', 0);
  assert.equal(feld.hidden, false);
  feld.value = 'x'; feld.dispatch('keydown', { key: 'Escape' }); await ruhe();
  assert.deepEqual([feld.hidden, POSTS().length], [true, 0]);
  $t('neu', 0).dispatch('click'); $t('neu-leer', 0).dispatch('click');
  feld.value = '   '; feld.dispatch('keydown', { key: 'Enter' }); await ruhe();
  assert.equal(POSTS().length, 0, 'a blank name sends nothing');
  feld.value = '  Mine '; feld.dispatch('keydown', { key: 'Enter' }); await ruhe();
  assert.deepEqual(POSTS().map((a) => a.koerper), [{ name: 'Mine', tracker: true }]);
});

test('the live container question: "no" sends nothing more, "yes" repeats the request with bestaetigt', async () => {
  aufbau({ antwort: (k) => (k.bestaetigt ? { j: { slug: 'neu', projekt: projekt('Neu') } } : { code: 409, j: { fehler: 'live_laeuft', text: 'Modules are playing' } }), frage: false });
  $t('neu-chip', 0).dispatch('click'); await ruhe();
  assert.equal(fragen.length, 1);
  assert.equal(POSTS().length, 1);
  assert.equal(w.ctx.st.slug, null);
  aufbau({ antwort: (k) => (k.bestaetigt ? { j: { slug: 'neu', projekt: projekt('Neu') } } : { code: 409, j: { fehler: 'live_laeuft', text: 'Modules are playing' } }) });
  $t('neu-chip', 0).dispatch('click'); await ruhe();
  assert.deepEqual(POSTS().map((a) => a.koerper.bestaetigt), [undefined, true]);
  assert.equal(w.ctx.st.slug, 'neu');
});

test('a refusal is shown and the open project stays', async () => {
  aufbau({ antwort: { code: 400, j: { fehler: 'vorlage_unbekannt', text: 'vorlage: one of 8bit-4kanal | chip' } } });
  $t('neu-chip', 0).dispatch('click'); await ruhe();
  assert.equal(w.ctx.st.slug, null);
  assert.ok($t('meldung').textContent.length > 0);
  assert.ok($t('meldung').classList.contains('fehler'));
});

test('the menu is an overlay: Escape and a click beside it close it, a click on its own button toggles it', () => {
  $t('neu', 0).dispatch('click');
  assert.equal($t('neu-menue', 0).hidden, false);
  wurzel.dispatch('keydown', { key: 'Escape' });
  assert.equal($t('neu-menue', 0).hidden, true, 'Escape closes');
  $t('neu', 0).dispatch('click');
  assert.equal($t('neu-menue', 0).hidden, false, 'opened again');
  $t('status').dispatch('click');
  assert.equal($t('neu-menue', 0).hidden, true, 'a click beside closes');
  $t('neu', 0).dispatch('click');
  $t('neu-leer', 0).dispatch('click');   // EMPTY shows the name field inside the menu: a click on it keeps the menu
  assert.equal($t('neu-menue', 0).hidden, false);
  assert.ok($t('neu-menue', 0).contains($t('neu-name', 0)), 'the name field stands in the menu');
  assert.equal($t('neu-name', 0).hidden, false);
});

// UI check M4: a menu whose right edge lies beyond the window aligns to the right edge of its button; one inside the window stays where it is.
test('the menu stays inside the window: right-aligned when it would run out at the right edge', () => {
  const m = $t('neu-menue', 0);
  const alt = globalThis.innerWidth;
  try {
    globalThis.innerWidth = 1366;
    m.getBoundingClientRect = () => ({ left: 1127, right: 1427, top: 40, bottom: 140, width: 300, height: 100 });
    $t('neu', 0).dispatch('click');
    assert.equal(m.hidden, false);
    assert.equal(m.style.left, 'auto');
    assert.equal(m.style.right, '0');
    $t('neu', 0).dispatch('click');   // close
    m.getBoundingClientRect = () => ({ left: 100, right: 400, top: 40, bottom: 140, width: 300, height: 100 });
    m.style.left = 'auto'; m.style.right = '0';
    $t('neu', 0).dispatch('click');   // open: a menu that fits is reset to the left edge
    assert.notEqual(m.style.left, 'auto');
    assert.notEqual(m.style.right, '0');
  } finally { globalThis.innerWidth = alt; }
});
