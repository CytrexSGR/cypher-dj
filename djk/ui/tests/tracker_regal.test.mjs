// Tracker task 23: SAVE MODULE and the tracker module shelf. The page binder runs against the DOM stand-in; the stage acceptance (save, close, open from the shelf,
// byte for byte the saved project) runs on a real project store in a temporary folder. Nothing touches the running studio.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';
import { Projekte } from '../project/storage.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, kanonisch } from '../project/model.ts';
import { tmpOrdner } from './support/project.mjs';

installiere();
const { bindeTracker, BINDER } = await import('../public/tracker/tracker.js');
const { bindeRegal, regalEintraege, REGAL_TEXT } = await import('../public/tracker/regal.js');
const { regalEintraege: werkbankEintraege } = await import('../public/werkbank/regal.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = () => attrappe.anrufe.filter((a) => a.methode === 'POST');
const projekt = (extra = {}) => ({ name: 'Song', rev: 5, tempo_bpm: 120, taktart: [4, 4], loop: { an: false, von_beat: 0, bis_beat: 16 }, spuren: [], ...extra });
const LISTE = [
  { slug: 'zeta', name: 'Zeta', geaendert: '2026-11-18T10:00:00.000Z', tracker: true },
  { slug: 'bench', name: 'Bench', geaendert: '2026-11-18T10:00:00.000Z', werkbank: true },
  { slug: 'alpha', name: 'alpha', geaendert: '2026-11-18T11:00:00.000Z', tracker: true },
  { slug: 'plain', name: 'Plain', geaendert: '2026-11-18T09:00:00.000Z' },
  { slug: 'kaputt', name: 'kaputt', geaendert: '2026-11-18T09:00:00.000Z', fehler: 'json_kaputt', text: 'x' },
];

let wurzel, w, $t, frageAnzahl;
function aufbau({ p = projekt(), slug = 'song', antworten = {}, ja = true } = {}) {
  installiere({ antworten: { 'GET /proj/aktuell': { j: { slug, projekt: p } }, 'GET /proj/liste': { j: LISTE }, 'GET /graphen': { j: { graphen: [] } }, ...antworten } });
  wurzel = document.createElement('section');
  frageAnzahl = 0;
  w = bindeTracker({ post, wurzel, frage: () => { frageAnzahl++; return ja; } });
  $t = (n) => wurzel.querySelector(`[data-t="${n}"]`);
}
const karten = () => wurzel.querySelectorAll('[data-t="regal-modul"]');
const taste = (e, key) => e.dispatch('keydown', { key });

beforeEach(() => aufbau());

test('BINDER carries the shelf binder', () => {
  assert.ok(BINDER.includes(bindeRegal));
});

test('SAVE MODULE is enabled with a project (off without one), MODULES always', async () => {
  assert.ok($t('speichern').disabled, 'no project yet');
  w.zeige(); await ruhe();
  assert.equal($t('speichern').disabled, false);
  assert.equal($t('module').disabled, false);
  assert.equal($t('speichern').textContent, 'SAVE MODULE');
});

test('SAVE MODULE on a project without the marker sends tracker_setzen {an: true} once and says it is on the shelf', async () => {
  const p2 = projekt({ rev: 6, tracker: { schema: 1 } });
  aufbau({ antworten: { 'POST /proj/aendern': { j: { slug: 'song', projekt: p2, rev: 6 } } } });
  w.zeige(); await ruhe();
  attrappe.anrufe.length = 0;
  $t('speichern').dispatch('click'); await ruhe();
  const a = POSTS().filter((x) => x.url === '/proj/aendern');
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].koerper.befehle, [{ befehl: 'tracker_setzen', an: true }]);
  assert.equal(a[0].koerper.label, 'Save as tracker module');
  assert.equal($t('meldung').textContent, REGAL_TEXT.gespeichert);
  assert.equal(REGAL_TEXT.gespeichert, 'Saved as a tracker module: it is on the shelf');
  assert.equal($t('speichern').textContent, 'SAVE AS', 'with the marker the button asks for a copy name');
});

test('SAVE MODULE with the marker opens SAVE AS: the name is proposed, Enter posts /proj/kopie, Escape gives up', async () => {
  aufbau({ p: projekt({ tracker: { schema: 1 } }), antworten: { 'POST /proj/kopie': { j: { slug: 'neu', name: 'My Song' } } } });
  w.zeige(); await ruhe();
  const feld = $t('speichern-name');
  assert.ok(feld.hidden, 'closed at first');
  attrappe.anrufe.length = 0;
  $t('speichern').dispatch('click'); await ruhe();
  assert.ok(!feld.hidden);
  assert.equal(feld.value, 'Song copy');
  assert.equal(POSTS().length, 0, 'the click alone writes nothing');
  taste(feld, 'Escape');
  assert.ok(feld.hidden);
  $t('speichern').dispatch('click');
  feld.value = 'My Song';
  taste(feld, 'Enter'); await ruhe();
  const k = POSTS().filter((x) => x.url === '/proj/kopie');
  assert.equal(k.length, 1);
  assert.deepEqual(k[0].koerper, { slug: 'song', name: 'My Song' });
  assert.equal($t('meldung').textContent, 'Saved as My Song.');
  assert.ok(feld.hidden);
});

test('SAVE AS shows a refusal and an empty name sends nothing', async () => {
  aufbau({ p: projekt({ tracker: { schema: 1 } }), antworten: { 'POST /proj/kopie': { code: 400, j: { fehler: 'name_ungueltig' } } } });
  w.zeige(); await ruhe();
  $t('speichern').dispatch('click');
  const feld = $t('speichern-name');
  attrappe.anrufe.length = 0;
  feld.value = '   '; taste(feld, 'Enter'); await ruhe();
  assert.equal(POSTS().length, 0);
  feld.value = 'x'; taste(feld, 'Enter'); await ruhe();
  assert.equal(POSTS().length, 1);
  assert.ok($t('meldung').classList.contains('fehler'));
});

test('a refused marker (live container) is shown and not reported as saved', async () => {
  aufbau({ antworten: { 'POST /proj/aendern': { code: 409, j: { fehler: 'tracker_live', text: 'the live container has no tracker view' } } } });
  w.zeige(); await ruhe();
  $t('speichern').dispatch('click'); await ruhe();
  assert.notEqual($t('meldung').textContent, REGAL_TEXT.gespeichert);
  assert.ok($t('meldung').classList.contains('fehler'));
});

test('the shelf lists only tracker modules, sorted by name, the open one marked', async () => {
  aufbau({ p: projekt({ tracker: { schema: 1 } }), slug: 'zeta' });
  w.zeige(); await ruhe();
  assert.ok($t('regal').hidden, 'closed until MODULES is clicked');
  $t('module').dispatch('click'); await ruhe();
  assert.ok(!$t('regal').hidden);
  assert.ok(attrappe.anrufe.some((a) => a.url === '/proj/liste'));
  assert.deepEqual(karten().map((k) => k.getAttribute('data-slug')), ['alpha', 'zeta']);
  assert.ok(karten()[1].disabled, 'the open module cannot be opened again');
  assert.ok(!karten()[0].disabled);
  $t('module').dispatch('click');
  assert.ok($t('regal').hidden, 'a second click closes it');
});

test('regalEintraege: tracker entries only; the workbench shelf does not show them and the tracker shelf shows no workbench module', () => {
  assert.deepEqual(regalEintraege(LISTE, 'zeta').map((m) => m.slug), ['alpha', 'zeta']);
  assert.deepEqual(regalEintraege(LISTE, 'zeta').map((m) => m.offen), [false, true]);
  assert.deepEqual(regalEintraege(null, null), []);
  const wb = werkbankEintraege(LISTE, [], null).module.map((m) => m.slug);
  assert.ok(wb.includes('bench'));
  assert.ok(!wb.includes('alpha') && !wb.includes('zeta'), 'tracker modules are not workbench modules');
});

test('a click on a card opens it through the live confirmation and the view keeps showing the opened project', async () => {
  const neu = projekt({ name: 'Alpha', rev: 3, tracker: { schema: 1 } });
  let n = 0;
  aufbau({ antworten: { 'POST /proj/oeffnen': (k) => (k.bestaetigt ? { j: { slug: 'alpha', projekt: neu } } : (n++, { code: 409, j: { fehler: 'live_laeuft' } })) } });
  w.zeige(); await ruhe();
  $t('module').dispatch('click'); await ruhe();
  attrappe.anrufe.length = 0;
  karten()[0].dispatch('click'); await ruhe();
  const o = POSTS().filter((x) => x.url === '/proj/oeffnen');
  assert.equal(o.length, 2);
  assert.deepEqual(o[0].koerper, { slug: 'alpha' });
  assert.deepEqual(o[1].koerper, { slug: 'alpha', bestaetigt: true });
  assert.equal(frageAnzahl, 1);
  assert.equal(w.ctx.st.slug, 'alpha');
  assert.equal($t('name').textContent, 'Alpha');
  assert.ok($t('regal').hidden, 'the shelf closes after opening');
});

test('a "no" to the live confirmation sends nothing more and keeps the project', async () => {
  aufbau({ ja: false, antworten: { 'POST /proj/oeffnen': { code: 409, j: { fehler: 'live_laeuft' } } } });
  w.zeige(); await ruhe();
  $t('module').dispatch('click'); await ruhe();
  attrappe.anrufe.length = 0;
  karten()[0].dispatch('click'); await ruhe();
  assert.equal(POSTS().length, 1);
  assert.equal(w.ctx.st.slug, 'song');
});

test('a refused open is shown', async () => {
  aufbau({ antworten: { 'POST /proj/oeffnen': { code: 404, j: { fehler: 'unbekannt' } } } });
  w.zeige(); await ruhe();
  $t('module').dispatch('click'); await ruhe();
  karten()[0].dispatch('click'); await ruhe();
  assert.ok($t('meldung').classList.contains('fehler'));
  assert.equal(w.ctx.st.slug, 'song');
});

// Stage 5 acceptance on a real store: save as a tracker module, close, open from the shelf: byte for byte the saved project (without rev).
test('stage 5: save, close, open from the shelf: the project is the saved one; the same file is a normal project in PRODUCTION', (t) => {
  const wurzelOrdner = tmpOrdner(t, 'djk-tr-regal-');
  const store = new Projekte(wurzelOrdner);
  const { slug, projekt: leer } = store.lege('Chip Song');
  const p = fuehreListeAus(leer, [{ befehl: 'tracker_setzen', an: true, lpb: 8 }]).projekt;
  store.speichere(slug, p);
  const geschrieben = store.lies(slug);
  assert.ok(geschrieben.tracker);
  // a second store over the same folder = closing and opening again
  const neu = new Projekte(wurzelOrdner);
  const liste = neu.liste();
  const eintrag = liste.find((x) => x.slug === slug);
  assert.equal(eintrag.tracker, true, 'the listing carries the marker');
  assert.equal(eintrag.werkbank, undefined);
  assert.deepEqual(regalEintraege(liste, null).map((m) => m.slug), [slug]);
  const offen = neu.lies(slug);
  const ohneRev = (x) => kanonisch({ ...JSON.parse(JSON.stringify(x)), rev: 0 });
  assert.equal(ohneRev(offen), ohneRev(geschrieben));
  assert.equal(ohneRev(offen), ohneRev(p));
  // PRODUCTION reads the same file: no marker of the tracker is a must there (the project is an ordinary one)
  assert.equal(offen.live, undefined);
  assert.equal(offen.werkbank, undefined);
});

test('the listing marks only tracker projects; a plain, a workbench and a broken one carry no tracker field', (t) => {
  const store = new Projekte(tmpOrdner(t, 'djk-tr-regal-'));
  const a = store.lege('Plain'); const b = store.lege('Bench', { werkbank: true }); const c = store.lege('Trk');
  store.speichere(c.slug, fuehreListeAus(c.projekt, [{ befehl: 'tracker_setzen', an: true }]).projekt);
  const l = Object.fromEntries(store.liste().map((x) => [x.slug, x]));
  assert.equal(l[a.slug].tracker, undefined);
  assert.equal(l[b.slug].tracker, undefined);
  assert.equal(l[b.slug].werkbank, true);
  assert.equal(l[c.slug].tracker, true);
  assert.ok(neuesProjekt('x'));
});

test('the shelf is an overlay: Escape and a click beside it close it, a click inside does not', async () => {
  aufbau({ p: projekt({ tracker: { schema: 1 } }), slug: 'zeta' });
  w.zeige(); await ruhe();
  $t('module').dispatch('click'); await ruhe();
  assert.ok(!$t('regal').hidden);
  $t('regal').dispatch('click');
  assert.ok(!$t('regal').hidden, 'a click inside keeps it open');
  wurzel.dispatch('keydown', { key: 'Escape' });
  assert.ok($t('regal').hidden, 'Escape closes');
  assert.equal($t('module').getAttribute('aria-pressed'), 'false');
  $t('module').dispatch('click'); await ruhe();
  assert.ok(!$t('regal').hidden, 'the MODULES button opens it again');
  $t('status').dispatch('click');
  assert.ok($t('regal').hidden, 'a click beside closes');
});

test('the shelf texts name only buttons that exist: MODULES, SAVE AS on a module, SAVE MODULE on a project that is none yet, NEW MODULE', async () => {
  const wort = (t) => ['NEW MODULE', 'SAVE MODULE', 'SAVE AS', 'MODULES'].filter((x) => new RegExp(`\\b${x}\\b`).test(t));
  aufbau({ p: projekt({ tracker: { schema: 1 } }), slug: 'zeta' });
  w.zeige(); await ruhe();
  const knoepfe = new Set([...wurzel.querySelectorAll('button')].map((b) => b.textContent));
  assert.ok(knoepfe.has('SAVE AS') && knoepfe.has('MODULES') && knoepfe.has('NEW MODULE'));
  const hinweis = wurzel.querySelector('.t-regal-hinweis').textContent;
  assert.ok(!hinweis.includes('SAVE MODULE'), 'the hint does not name the button a module does not have');
  for (const x of wort(hinweis)) assert.ok(knoepfe.has(x), `the hint names ${x}`);
  assert.ok(hinweis.includes('SAVE AS'));
  aufbau();   // an unmarked project: the button reads SAVE MODULE
  w.zeige(); await ruhe();
  const ohne = new Set([...wurzel.querySelectorAll('button')].map((b) => b.textContent));
  for (const x of wort(REGAL_TEXT.leer)) assert.ok(ohne.has(x) || knoepfe.has(x), `the empty text names ${x}`);
  const hinweisOhne = wurzel.querySelector('.t-regal-hinweis').textContent;
  for (const x of wort(hinweisOhne)) assert.ok(ohne.has(x), `the hint names ${x}`);
  assert.ok(!hinweisOhne.includes('SAVE AS') && hinweisOhne.includes('SAVE MODULE'));
  assert.ok(ohne.has('SAVE MODULE'));
});
