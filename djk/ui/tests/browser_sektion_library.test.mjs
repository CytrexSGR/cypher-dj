// LIBRARY section (browser plan 2, task 8): the pure parts (state line, first start, rows, MIDI rows) and the actions against a stand-in host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiereDom } from './support/dom_mock.mjs';
import { standText, ersterStart, bibliotheksZeilen, midiZeilen, fuegeOrdnerHinzu, bauZeile, midiHinzufuegen, midiUrl } from '../public/browser/sektion_library.js';

const SHA = 'a'.repeat(64);
const stand = (o = {}) => ({ phase: 'ruht', fertig: 0, gesamt: null, letzter_bau: null, fremd: false, leer: false, ...o });

test('standText: progress, phase words, no NaN and no null in the line', () => {
  const s = standText(stand({ phase: 'merkmale', fertig: 40, gesamt: 200 }));
  assert.equal(s.balken, 0.2);
  assert.match(s.zeile, /Reading audio features/);
  assert.match(s.zeile, /40 of 200/);
  const r = standText(stand({ letzter_bau: { zeit: '2026-11-23T10:15:00.000Z', dateien: 1240, rc: 0 } }));
  assert.equal(r.balken, null);
  assert.match(r.zeile, /1,240/);
  assert.match(r.zeile, /2026-11-23/);
  const o = standText(stand({ phase: 'scan', fertig: 1240, gesamt: null }));
  assert.equal(o.balken, null);
  assert.match(o.zeile, /Scanning/);
  assert.match(o.zeile, /1,240/);
  assert.doesNotMatch(o.zeile, /null|NaN/);
  for (const [phase, wort] of [['schreiben', 'Writing the catalogue'], ['analyse', 'Analysing loops']]) assert.match(standText(stand({ phase, fertig: 1, gesamt: 2 })).zeile, new RegExp(wort));
});

test('standText: hints follow the exit of the last build and the foreign catalogue', () => {
  const bau = (rc, grund) => ({ zeit: '2026-11-23T10:15:00.000Z', dateien: 5, rc, ...(grund ? { grund } : {}) });
  assert.equal(standText(stand({ letzter_bau: bau(4, '/media/x') })).hinweis, 'ordner_fehlt');
  assert.equal(standText(stand({ letzter_bau: bau(5) })).hinweis, 'nicht_schreibbar');
  assert.equal(standText(stand({ letzter_bau: bau(6) })).hinweis, 'luecken');
  assert.equal(standText(stand({ fremd: true })).hinweis, 'fremd');
  assert.equal(standText(stand({ letzter_bau: bau(0) })).hinweis, null);
  assert.equal(standText(stand({ phase: 'scan', fertig: 3, gesamt: 9, letzter_bau: bau(4) })).hinweis, null);   // a stale error is not shown while a build runs
});

test('ersterStart: only when both routes answered, the catalogue is empty and no source exists', () => {
  assert.equal(ersterStart({ stand: null, quellen: { quellen: [] } }), false);
  assert.equal(ersterStart({ stand: stand({ leer: true }), quellen: null }), false);
  assert.equal(ersterStart({ stand: stand({ leer: true }), quellen: { quellen: [{ pfad: '/a', typ: 'auto', fehlt: false }] } }), false);
  assert.equal(ersterStart({ stand: stand({ leer: false }), quellen: { quellen: [] } }), false);
  assert.equal(ersterStart({ stand: stand({ leer: true }), quellen: { quellen: [] } }), true);
});

test('midiZeilen: null gives nothing, the size is shown as KB and the path is kept', () => {
  assert.deepEqual(midiZeilen(null), []);
  const z = midiZeilen({ dateien: [{ pfad: '/m/a.mid', name: 'a.mid', groesse: 12288 }, { pfad: '/m/b.mid', name: 'b.mid', groesse: 300 }] });
  assert.equal(z[0].zusatz, '12 KB');
  assert.equal(z[0].pfad, '/m/a.mid');
  assert.equal(z[1].zusatz, '1 KB');
});

test('bibliotheksZeilen: a row without its file is not draggable, a valid one-shot carries its sha', () => {
  const ok = { typ: 'oneshot', sha: SHA, name: 'Kick 1', instrument: 'kick', pfad_da: true, dauer_s: 0.4, nur_live: false };
  const weg = { typ: 'oneshot', sha: 'b'.repeat(64), name: 'Gone', instrument: 'snare', pfad_da: false, dauer_s: 0.4 };
  const z = bibliotheksZeilen([ok, weg], 'oneshot');
  assert.equal(z[0].nutzlast.sha, SHA);
  assert.equal(z[0].sha, SHA);
  assert.equal(z[1].nutzlast, null);
  assert.match(z[0].zusatz, /kick/);
  const t = bibliotheksZeilen([{ typ: 'track', sha: SHA, material_id: SHA.slice(0, 16), titel: 'Song', mix: 'Club', bpm: 128, camelot: '8A', pfad_da: true, dauer_s: 200, status: 'prepare' }], 'track');
  assert.equal(t[0].name, 'Song (Club)');
  assert.equal(t[0].pruefen, true);
  assert.deepEqual(bibliotheksZeilen(null, 'loop'), []);
});

test('a file name is shown as text, never as markup', () => {
  const weg = installiereDom();
  try {
    const wirt = { vorhoeren() {} };
    const z = bibliotheksZeilen([{ typ: 'oneshot', sha: SHA, name: '<b>x</b>.wav', pfad_da: true, dauer_s: 1 }], 'oneshot')[0];
    const r = bauZeile(z, wirt, {});
    const t = r.kinder.find((k) => k.className.includes('b-text'));
    assert.equal(t.textContent, '<b>x</b>.wav');
    assert.equal(r.innerHTML, '');
    const dot = bibliotheksZeilen([{ typ: 'oneshot', sha: SHA, name: '.hidden Kick ä.wav', pfad_da: true, dauer_s: 1 }], 'oneshot')[0];
    assert.equal(dot.name, '.hidden Kick ä.wav');
  } finally { weg(); }
});

const aktHost = (antworten = {}) => {
  const g = { posts: [], gets: [], meldungen: [] };
  g.holeJson = async (url, body) => { g.posts.push([url, body]); return antworten[url] ?? { status: 200, j: { ok: true } }; };
  g.holeGet = async (url) => { g.gets.push(url); return antworten[url] ?? { status: 200, j: {} }; };
  g.melde = (t, f) => g.meldungen.push([t, f === true]);
  return g;
};

test('ADD FOLDER posts the chosen folder as an auto source; cancelling posts nothing; a refusal shows its text', async () => {
  let h = aktHost();
  const r = await fuegeOrdnerHinzu(h, { waehleOrdner: async () => '/media/x/Music' });
  assert.equal(r.status, 'ok');
  assert.deepEqual(h.posts, [['/bibliothek/quellen/dazu', { pfad: '/media/x/Music', typ: 'auto' }]]);
  h = aktHost();
  assert.equal((await fuegeOrdnerHinzu(h, { waehleOrdner: async () => null })).status, 'abgebrochen');
  assert.deepEqual(h.posts, []);
  h = aktHost({ '/bibliothek/quellen/dazu': { status: 400, j: { ok: false, grund: 'argument_ungueltig', text: 'that folder does not exist' } } });
  const f = await fuegeOrdnerHinzu(h, { waehleOrdner: async () => '/nope' });
  assert.equal(f.status, 'fehler');
  assert.deepEqual(h.meldungen, [['that folder does not exist', true]]);
  h = aktHost({ '/bibliothek/quellen/dazu': { status: 404 } });
  assert.equal((await fuegeOrdnerHinzu(h, { waehleOrdner: async () => '/x' })).status, 'nicht_da');
});

test('MIDI tab: the URL carries the search text, ADD TO PROJECT posts the path, an answer text goes to melde, a 404 is not available', async () => {
  assert.equal(midiUrl('kick'), '/bibliothek/midi?text=kick');
  assert.equal(midiUrl(' a b '), '/bibliothek/midi?text=a%20b');
  assert.equal(midiUrl(''), '/bibliothek/midi?text=');
  let h = aktHost({ '/proj/midi_import': { status: 200, j: { text: 'Imported bass.mid as 1 clip' } } });
  assert.equal((await midiHinzufuegen(h, '/m/bass.mid')).status, 'ok');
  assert.deepEqual(h.posts, [['/proj/midi_import', { pfad: '/m/bass.mid' }]]);
  assert.deepEqual(h.meldungen, [['Imported bass.mid as 1 clip', false]]);
  h = aktHost({ '/proj/midi_import': { status: 404 } });
  assert.equal((await midiHinzufuegen(h, '/x.mid')).status, 'nicht_da');
  h = aktHost({ '/proj/midi_import': { status: 409, j: { fehler: 'kein_projekt', text: 'no project is open' } } });
  assert.equal((await midiHinzufuegen(h, '/x.mid')).status, 'fehler');
  assert.deepEqual(h.meldungen, [['no project is open', true]]);
});

// ---- the section against the DOM stand-in: the status line follows the build ----
async function baueSektion(stands, quellen = [{ pfad: '/m', typ: 'auto', fehlt: false }]) {
  const { baueBibliothekAbschnitt } = await import('../public/browser/sektion_library.js');
  const rueck = installiereDom();
  const roh = globalThis.document.createElement;
  globalThis.document.createElement = (t) => { const e = roh(t); e.style = {}; return e; };
  let n = 0;
  const host = {
    meldungen: [], posts: [],
    melde(t, f) { this.meldungen.push([t, f]); },
    holeJson: async (url, body) => { host.posts.push(url); return { status: 200, j: { ok: true } }; },
    holeGet: async (url) => {
      if (url === '/bibliothek/stand') return { status: 200, j: stands[Math.min(n++, stands.length - 1)] };
      if (url === '/bibliothek/quellen') return { status: 200, j: { datei: 'b.json', quellen } };
      return { status: 200, j: { gesamt: 0, treffer: [], dateien: [] } };
    },
  };
  const a = baueBibliothekAbschnitt(host, { ohneDom: true });
  const finde = (e, text) => (e.textContent === text && e.ereignisse?.click ? e : (e.kinder ?? []).map((k) => finde(k, text)).find(Boolean));
  const zeile = () => finde2(a.wurzel, 'b-bib-stand')?.textContent;
  const finde2 = (e, kl) => (e.className?.split(' ').includes(kl) ? e : (e.kinder ?? []).map((k) => finde2(k, kl)).find(Boolean));
  return { a, host, rueck, finde, zeile };
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bau5 = { zeit: '2026-11-23T11:06:50.179Z', dateien: 5, rc: 0 };

test('library status line: during a build it shows the progress, when the build ends the count and the time', async () => {
  const s = await baueSektion([stand({ phase: 'scan', fertig: 2, gesamt: 5 }), stand({ phase: 'ruht', letzter_bau: bau5, katalog: { track: 0, loop: 1, oneshot: 4 } })]);
  try {
    await s.a.laden();
    assert.equal(s.zeile(), 'Scanning, 2 of 5');
    await warte(1300);
    assert.equal(s.zeile(), '5 files, last build 2026-11-23 11:06');
  } finally { s.rueck(); }
});

test('library status line: a RESCAN whose first reads still say ruht follows the build once it shows up', async () => {
  const leer = stand({ phase: 'ruht', letzter_bau: null });
  const s = await baueSektion([leer, leer, leer, stand({ phase: 'merkmale', fertig: 1, gesamt: 5 }), stand({ phase: 'ruht', letzter_bau: bau5 })]);
  try {
    await s.a.laden();
    assert.equal(s.zeile(), 'No build yet');
    const knopf = s.finde(s.a.wurzel, 'RESCAN');
    await knopf.ereignisse.click[0]({ stopPropagation() {} });
    await warte(4500);
    assert.equal(s.zeile(), '5 files, last build 2026-11-23 11:06');
  } finally { s.rueck(); }
});
