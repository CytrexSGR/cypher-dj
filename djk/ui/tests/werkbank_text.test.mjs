// Plan 8 task 8: texts of the shelf: the empty state sentence, plural of the cut card line, the instrument list while it reads.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank, WERKBANK_TEXT } = await import('../public/werkbank/werkbank.js');
const { liestText, INSTRUMENTE_TEXT } = await import('../public/werkbank/regal_instruments.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const modul = (name) => ({ name, rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren: [{ id: 's1', name: 'Drums', art: 'instrument', clips: [] }] });
const AKTUELL = { slug: 'alpha', projekt: modul('Alpha') };

test('keinWerkbank is the plain sentence', () => {
  assert.equal(WERKBANK_TEXT.keinWerkbank, 'This project is not a module. Open or create a module; your open project stays open until you do.');
});

test('the cut card line counts slices with the right plural', async () => {
  const schnitte = { schnitte: [
    { id: 'a-1', name: 'One', quelle: { art: 'loop', ref: 'a' }, bpm: 128, beats: 4, scheiben: 1, geraet: 'smp-a-1' },
    { id: 'b-2', name: 'Two', quelle: { art: 'loop', ref: 'b' }, bpm: 128, beats: 8, scheiben: 2, geraet: 'smp-b-2' }] };
  installiere({ speicher: { 'djk-wb-regal-tab': 'cuts' }, antworten: { 'GET /proj/aktuell': { j: AKTUELL }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } }, 'GET /sampler/liste': { j: schnitte } } });
  const wurzel = document.createElement('section');
  const w = bindeWerkbank({ post, wurzel, frage: () => true });
  w.zeige(); await ruhe();
  const zeilen = wurzel.querySelector('[data-w="regal"]').querySelectorAll('.w-karte').map((k) => k.querySelector('span').textContent);
  assert.deepEqual(zeilen, ['1 slice · 4 beats', '2 slices · 8 beats']);
});

test('liestText: short text first, long text after 1 s, with seconds after 3 s', () => {
  assert.equal(liestText(0), 'Reading…');
  assert.equal(liestText(999), 'Reading…');
  assert.equal(liestText(1000), INSTRUMENTE_TEXT.liestLang);
  assert.ok(INSTRUMENTE_TEXT.liestLang.startsWith('Reading instruments…') && INSTRUMENTE_TEXT.liestLang.includes('first read can take a few seconds'));
  assert.equal(liestText(2999), INSTRUMENTE_TEXT.liestLang);
  assert.equal(liestText(3400), `${INSTRUMENTE_TEXT.liestLang} (3 s)`);
});

test('the instrument list shows Reading… at 0 s and the long text after 1 s (fake timers)', async (t) => {
  installiere({ speicher: { 'djk-wb-regal-tab': 'instrumente' }, antworten: { 'GET /proj/aktuell': { j: AKTUELL }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
    'GET /sampler/instrumente': { j: { instrumente: [] } } } });
  // the read of the list is held back until the test lets it go
  let frei;
  const tor = new Promise((ok) => { frei = ok; });
  const echt = globalThis.fetch;
  t.after(() => { globalThis.fetch = echt; });
  globalThis.fetch = async (url, opt) => { if (String(url).includes('/sampler/instrumente')) await tor; return echt(url, opt); };
  const wurzel = document.createElement('section');
  const w = bindeWerkbank({ post, wurzel, frage: () => true });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  w.zeige(); await ruhe();
  const text = () => wurzel.querySelector('[data-w="regal"]').textContent;
  assert.ok(text().includes('Reading…') && !text().includes('first read'), text());
  t.mock.timers.tick(1000); await ruhe();
  assert.ok(text().includes('Reading instruments… the first read can take a few seconds'), text());
  t.mock.timers.tick(2500); await ruhe();
  assert.ok(text().includes('(3 s)'), text());
  frei(); await ruhe();
  assert.ok(text().includes('No instruments yet'), text());
});
