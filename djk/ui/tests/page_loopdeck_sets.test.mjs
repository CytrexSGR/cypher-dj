// Loop deck set menu (loop deck P4): SAVE SET, LOAD SET, CLEAR DECK and the refusal texts, with the DOM stand-in and a fake fetch. Never touches a studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

const HTML = '<body><div id="meldung"></div><section id="platz-loops"><div class="loopdeck" data-deck="1"></div></section><section id="platz-loops2"><div class="loopdeck" data-deck="2"></div></section></body>';
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const zelle = (n, extra = {}) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, bpm: 128, gain_db: 0, frames: 1000, ...extra });
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const spur = (g, nr) => ({ spur_id: `s${g}${nr}`, nr, name: `L${g}.${nr}`, fader_db: 0, mute: false, filter: 0, zellen: [zelle(1), null, null, null, null, null, null, null], lauf: lauf0() });
const deck = (g) => ({ gruppe_id: `g${g}`, platz: g, raster: '1', spuren: [1, 2, 3, 4].map((n) => spur(g, n)) });
const SETS = [{ name: 'Warmup', raster: '1', zellen: 5, geaendert: '2026-11-20T10:00:00Z' }, { name: 'Peak time', raster: 'takt', zellen: 12, geaendert: '2026-11-20T11:00:00Z' }];

async function start(extra = {}) {
  const a = installiere({ html: HTML, antworten: { 'GET /loopdeck/stand': () => ({ j: { decks: { 1: deck(1), 2: deck(2) }, beat: 16, bpm: 120 } }), 'GET /loopsets': { j: { sets: SETS } }, ...extra } });
  const m = await import('../public/loopdeck/view.js');
  m.zuruecksetzen(); m.zeigeLoopdecks(); await ruhe();
  return { a, m };
}
const posts = (a) => a.anrufe.filter((c) => c.methode === 'POST');
const dk = (n = 1) => document.querySelector(`.loopdeck[data-deck="${n}"]`);
const menue = (n = 1) => dk(n).querySelector('.ld-setmenu');
const oeffne = (n = 1) => dk(n).querySelector('.ld-set').click();
const eintrag = (art, n = 1) => menue(n).querySelector(`[data-eintrag="set-${art}"]`);
const tippe = (text, n = 1) => { const f = menue(n).querySelector('input'); f.value = text; return f; };
const meldung = () => document.querySelector('#meldung').textContent;
const bestaetige = (antwort) => { const frage = []; globalThis.confirm = (t) => { frage.push(t); return antwort; }; return frage; };

test('the SET button opens and closes the menu with its three entries', async () => {
  await start();
  assert.equal(menue().hidden, true);
  oeffne();
  assert.equal(menue().hidden, false);
  for (const e of ['speichern', 'laden', 'leeren']) assert.ok(eintrag(e), e);
  assert.equal(eintrag('speichern').textContent, 'SAVE SET');
  assert.equal(eintrag('laden').textContent, 'LOAD SET');
  assert.equal(eintrag('leeren').textContent, 'CLEAR DECK');
  oeffne();
  assert.equal(menue().hidden, true);
});

test('SAVE SET asks for the name in the menu (no window.prompt) and posts deck and name', async () => {
  const { a } = await start({ 'POST /loopset/speichern': { j: { ok: true, name: 'Night 2' } } });
  globalThis.prompt = () => { throw new Error('window.prompt must not be used'); };
  oeffne();
  assert.equal(menue().querySelector('.ld-setname').hidden, true);
  eintrag('speichern').click();
  assert.equal(menue().querySelector('.ld-setname').hidden, false);
  tippe('  Night 2 ');
  eintrag('speichern-ok').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopset/speichern', methode: 'POST', koerper: { deck: 1, name: 'Night 2' } });
  assert.match(meldung(), /Set "Night 2" saved/);
  assert.equal(menue().hidden, true);
});

test('SAVE SET with Enter in the field; deck 2 sends deck 2', async () => {
  const { a } = await start({ 'POST /loopset/speichern': { j: { ok: true, name: 'B' } } });
  oeffne(2); eintrag('speichern', 2).click();
  tippe('B', 2).dispatch('keydown', { key: 'Enter' }); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 2, name: 'B' });
});

test('an invalid name sends nothing and says why', async () => {
  const { a } = await start();
  oeffne(); eintrag('speichern').click();
  for (const t of ['', '   ', 'a/b', 'x'.repeat(65)]) { tippe(t).dispatch('keydown', { key: 'Enter' }); await ruhe(); }
  assert.equal(posts(a).length, 0);
  assert.match(menue().querySelector('.ld-setname .ld-hinweis').textContent, /1 to 64 letters/);
  assert.equal(menue().hidden, false);
});

test('saving over an existing set asks first; No sends nothing, Yes overwrites', async () => {
  const { a } = await start({ 'POST /loopset/speichern': { j: { ok: true, name: 'Warmup' } } });
  oeffne(); eintrag('speichern').click(); tippe('Warmup');
  let frage = bestaetige(false);
  eintrag('speichern-ok').click(); await ruhe();
  assert.equal(frage.length, 1); assert.match(frage[0], /Warmup/);
  assert.equal(posts(a).length, 0);
  frage = bestaetige(true);
  eintrag('speichern-ok').click(); await ruhe();
  assert.deepEqual(posts(a).at(-1).koerper, { deck: 1, name: 'Warmup' });
  bestaetige(true);
});

test('LOAD SET lists GET /loopsets and a click posts deck and name, then reads the stand', async () => {
  const { a } = await start({ 'POST /loopset/laden': { j: { ok: true, name: 'Peak time' } } });
  oeffne(); eintrag('laden').click(); await ruhe();
  assert.ok(a.anrufe.some((c) => c.url === '/loopsets' && c.methode === 'GET'));
  const wahl = menue().querySelectorAll('.ld-setwahl');
  assert.deepEqual(wahl.map((b) => b.dataset.set), ['Warmup', 'Peak time']);
  assert.match(wahl[1].textContent, /12 cells/);
  const stand0 = a.anrufe.filter((c) => c.url === '/loopdeck/stand').length;
  wahl[1].click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopset/laden', methode: 'POST', koerper: { deck: 1, name: 'Peak time' } });
  assert.equal(a.anrufe.filter((c) => c.url === '/loopdeck/stand').length, stand0 + 1);
  assert.match(meldung(), /Set "Peak time" loaded/);
  assert.equal(menue().hidden, true);
});

test('LOAD SET with no sets says so', async () => {
  await start({ 'GET /loopsets': { j: { sets: [] } } });
  oeffne(); eintrag('laden').click(); await ruhe();
  assert.equal(menue().querySelectorAll('.ld-setwahl').length, 0);
  assert.match(menue().querySelector('.ld-setliste').textContent, /No sets saved yet/);
});

test('a refused LOAD SET shows the reason and leaves the menu open', async () => {
  const { a } = await start({ 'POST /loopset/laden': { code: 409, j: { ok: false, grund: 'audio_budget', text: 'The distinct audio would exceed 512 MiB.' } } });
  oeffne(); eintrag('laden').click(); await ruhe();
  menue().querySelectorAll('.ld-setwahl')[0].click(); await ruhe();
  assert.equal(posts(a).length, 1);
  assert.match(meldung(), /512 MiB/);
  assert.equal(menue().hidden, false);
});

test('CLEAR DECK confirms, then posts leeren for that deck; No posts nothing', async () => {
  const { a } = await start({ 'POST /loopdeck/leeren': { j: { ok: true } } });
  oeffne(2);
  let frage = bestaetige(false);
  eintrag('leeren', 2).click(); await ruhe();
  assert.equal(frage.length, 1);
  assert.equal(posts(a).length, 0);
  frage = bestaetige(true);
  eintrag('leeren', 2).click(); await ruhe();
  assert.deepEqual(posts(a).at(-1), { url: '/loopdeck/leeren', methode: 'POST', koerper: { deck: 2 } });
  assert.match(meldung(), /LOOP 2 cleared/);
  bestaetige(true);
});

test('zelle_laedt is worded by the page; scene and stop answers with skipped tracks are no error', async () => {
  const { a } = await start({
    'POST /loopdeck/start': { code: 409, j: { ok: false, grund: 'zelle_laedt' } },
    'POST /loopdeck/szene': { j: { ok: true, gestartet: [1], abgelehnt: [{ spur: 2, grund: 'zelle_laedt' }] } },
    'POST /loopdeck/stopp': { j: { ok: true, gestartet: [], abgelehnt: [{ spur: 3, grund: 'zelle_leer' }] } },
  });
  const spurKnoten = dk().querySelectorAll('.ld-spur')[0];
  spurKnoten.querySelectorAll('.zelle')[0].click(); await ruhe();
  assert.match(meldung(), /That cell is still loading\./);
  assert.equal(document.querySelector('#meldung').className, 'fehler');
  document.querySelector('#meldung').textContent = ''; document.querySelector('#meldung').className = '';
  dk().querySelector('.ld-szene').click(); await ruhe();
  dk().querySelector('.ld-stopall').click(); await ruhe();
  assert.equal(meldung(), '');
  assert.equal(posts(a).length, 3);
});

test('a cell whose stand entry has frames: null is marked as loading, not as broken', async () => {
  const d = deck(1); d.spuren[0].zellen[0] = zelle(1, { frames: null });
  await start({ 'GET /loopdeck/stand': () => ({ j: { decks: { 1: d, 2: deck(2) }, beat: 16, bpm: 120 } }) });
  const c = dk().querySelectorAll('.ld-spur')[0].querySelectorAll('.zelle');
  assert.ok(c[0].classList.contains('laedt'));
  assert.match(c[0].title, /still loading/);
  assert.equal(c[0].classList.contains('voll'), true);
  assert.equal(dk().querySelectorAll('.ld-spur')[1].querySelectorAll('.zelle')[0].classList.contains('laedt'), false);
});
