// Browser plan 2, task 13: the search state machine, the chip order, the RELATED rows and the batch tag call (no document needed).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { neueSuche, chipGruppen } from '../public/browser/suche.js';
import { verwandtZeilen, setzeTagsBatch, itemText } from '../public/browser/verwandt.js';

test('five text changes within 100 ms are one call after 250 ms with the last text', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const aufrufe = [];
    const s = neueSuche({ beiAenderung: (x) => aufrufe.push(x) });
    for (const t of ['k', 'ki', 'kic', 'kick', 'kick ']) { s.setzeText(t); mock.timers.tick(20); }
    assert.equal(aufrufe.length, 0);
    mock.timers.tick(250);
    assert.equal(aufrufe.length, 1);
    assert.equal(aufrufe[0].text, 'kick ');
  } finally { mock.timers.reset(); }
});

test('a tag toggles on and off, Esc clears the text first and the tags second', () => {
  const aufrufe = [];
  const s = neueSuche({ beiAenderung: (x) => aufrufe.push(x), verzoegerung: 0 });
  s.schalteTag('genre:techno'); s.schalteTag('typ:kick'); s.schalteTag('typ:kick');
  assert.deepEqual(s.stand().tags, ['genre:techno']);
  s.schalteTag('typ:kick');
  s.setzeAlles({ text: 'dark', tags: ['genre:techno', 'typ:kick'] });
  s.leere();
  assert.deepEqual(s.stand(), { text: '', tags: ['genre:techno', 'typ:kick'] });
  s.leere();
  assert.deepEqual(s.stand(), { text: '', tags: [] });
  const n = aufrufe.length;
  s.leere();
  assert.equal(aufrufe.length, n, 'nothing to clear: no call');
});

test('chipGruppen: null gives [], typ comes before genre, empty kinds have no chips', () => {
  assert.deepEqual(chipGruppen(null), []);
  const v = { arten: [{ art: 'genre', woerter: [{ wort: 'techno' }] }, { art: 'typ', woerter: [{ wort: 'kick' }] }, { art: 'tempo', woerter: [] }, { art: 'frei', woerter: [] }] };
  const g = chipGruppen(v);
  assert.deepEqual(g.map((x) => x.art), ['typ', 'genre']);
  assert.deepEqual(g[0].tags, [{ tag: 'typ:kick', titel: 'kick' }]);
});

test('verwandtZeilen: groups in the order Made from, Used in, Fits, Similar; empty groups skipped; null gives []', () => {
  assert.deepEqual(verwandtZeilen(null), []);
  const z = verwandtZeilen({ gemacht_aus: ['datei:abcdef0123456789'], steckt_in: [], passt_zu: ['kit:Main Kit'], aehnlich: ['preset:nutzer:wave/warm-pad'] });
  assert.deepEqual(z.map((x) => x.gruppe), ['Made from', 'Fits', 'Similar']);
  assert.deepEqual(z.map((x) => x.text), ['file abcdef01', 'Main Kit', 'warm-pad']);
  assert.equal(itemText('take:p/aufnahme 1.wav'), 'aufnahme 1.wav');
});

test('setzeTagsBatch posts 50 items in exactly one request; 404 and refusals are sentences', async () => {
  const posts = [];
  const items = Array.from({ length: 50 }, (_, i) => `datei:${String(i).padStart(64, '0')}`);
  const host = { holeJson: async (u, b) => { posts.push([u, b]); return { status: 200, j: { ok: true, geaendert: 50 } }; } };
  const r = await setzeTagsBatch(host, items, ['genre:techno'], true);
  assert.deepEqual(r, { ok: true, geaendert: 50 });
  assert.equal(posts.length, 1);
  assert.equal(posts[0][0], '/tags/setzen');
  assert.equal(posts[0][1].items.length, 50);
  assert.equal(posts[0][1].an, true);
  const nicht = await setzeTagsBatch({ holeJson: async () => ({ status: 404, j: null }) }, items, ['x'], true);
  assert.equal(nicht.ok, false); assert.match(nicht.text, /not available/);
  const abgelehnt = await setzeTagsBatch({ holeJson: async () => ({ status: 400, j: { ok: false, text: 'at most 500 items per call' } }) }, items, ['x'], true);
  assert.equal(abgelehnt.text, 'at most 500 items per call');
});

test('the library tag list asks /tags/suche without an art filter (art is the item kind; files are cut by the datei: prefix)', async () => {
  const { readFileSync } = await import('node:fs');
  const q = readFileSync(new URL('../public/browser/sektion_library.js', import.meta.url), 'utf8');
  const aufruf = q.split('\n').find((z) => z.includes('await tagSuche('));
  assert.ok(aufruf, 'the tagSuche call is there');
  assert.ok(!/art\s*:/.test(aufruf), aufruf);
  assert.ok(q.includes("startsWith('datei:')"));
});
