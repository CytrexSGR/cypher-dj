// Plan 8 task 9 (TRACKER): the shelf hint names the real key, the abbreviations of the bar carry a title, a shelf card shows its date in the shared format.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeTracker } = await import('../public/tracker/tracker.js');
const { REGAL_TEXT } = await import('../public/tracker/regal.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const projekt = () => ({ name: 'Song', rev: 5, tempo_bpm: 120, taktart: [4, 4], loop: { an: false, von_beat: 0, bis_beat: 16 }, spuren: [], tracker: { schema: 1 } });
const LISTE = [{ slug: 'alpha', name: 'alpha', geaendert: '2026-11-18T11:05:00.000Z', tracker: true }];

function aufbau() {
  installiere({ antworten: { 'GET /proj/aktuell': { j: { slug: 'song', projekt: projekt() } }, 'GET /proj/liste': { j: LISTE }, 'GET /graphen': { j: { graphen: [] } } } });
  const wurzel = document.createElement('section');
  const w = bindeTracker({ post, wurzel, frage: () => true });
  return { w, wurzel, $t: (n) => wurzel.querySelector(`[data-t="${n}"]`) };
}

test('the shelf hint is the plan sentence and names the key the head shows', async () => {
  assert.equal(REGAL_TEXT.hinweis('SAVE MODULE'), 'click = open the module · every change is saved at once · SAVE MODULE (in the head) keeps a copy under a new name');
  assert.equal(REGAL_TEXT.hinweis('SAVE AS'), 'click = open the module · every change is saved at once · SAVE AS (in the head) keeps a copy under a new name');
  const { w, wurzel, $t } = aufbau();   // a marked module: the head key reads SAVE AS and the drawn hint says the same
  w.zeige(); await ruhe();
  const hinweis = wurzel.querySelector('.t-regal-hinweis');
  assert.equal($t('speichern').textContent, 'SAVE AS');
  assert.ok(hinweis.textContent.includes('SAVE AS (in the head)') && !hinweis.textContent.includes('SAVE MODULE'));
});

test('LPB, DLY, CHN, RPT and HEX carry a title that spells them out', async () => {
  const { w, wurzel, $t } = aufbau();
  w.zeige(); await ruhe();
  const lpb = [...wurzel.querySelectorAll('[data-t="kopf"] label span')].find((s) => s.textContent === 'LPB');
  assert.equal(lpb.getAttribute('title'), 'Lines per beat');
  const titel = { vol: 'Velocity', dly: 'Delay', chn: 'Chance', rpt: 'Repeat', fx: 'Effect' };   // grid_model.js: vol = n.vel, dly = n.versatz, chn = n.chance, rpt = n.wdh
  for (const [u, wort] of Object.entries(titel)) {
    const b = $t(`sp-${u}`);
    assert.ok(b.getAttribute('title').startsWith(wort), `${u}: ${b.getAttribute('title')}`);
  }
  assert.ok($t('zahlen').getAttribute('title').startsWith('Hexadecimal'));
});

test('the bar has a more-keys button that opens and closes the folded keys', async () => {
  const { w, wurzel, $t } = aufbau();
  w.zeige(); await ruhe();
  const mehr = $t('mehr');
  assert.ok(mehr, 'the ⋯ button exists');
  assert.equal(mehr.getAttribute('aria-expanded'), 'false');
  mehr.dispatch('click');
  assert.equal(mehr.getAttribute('aria-expanded'), 'true');
  assert.ok($t('kopf').classList.contains('t-mehr-auf'));
  mehr.dispatch('click');
  assert.ok(!$t('kopf').classList.contains('t-mehr-auf'));
});

test('a shelf card shows its date in the shared format', async () => {
  const { w, wurzel, $t } = aufbau();
  w.zeige(); await ruhe();
  $t('module').dispatch('click'); await ruhe();
  const karte = wurzel.querySelectorAll('[data-t="regal-modul"]')[0];
  assert.ok(karte, 'a card is drawn');
  const datum = karte.querySelectorAll('span')[0].textContent;
  assert.match(datum, /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/);
});
