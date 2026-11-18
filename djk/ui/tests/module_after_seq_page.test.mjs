// Workbench module -> SEQ deck, page side: the readable line, the load call, the way from the Workbench (public/module_after_seq.js) and the top bar
// button TO SEQ DECK (public/werkbank/zu_seq.js) against the DOM stand-in. The SEQ place entry (LOAD MODULE) is tested in page_seq.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, El } from './helpers/pages_mock.mjs';

installiere();
const { berichtText, weggelassenText, ladeModulInSeq, modulZuSeq, modulListe } = await import('../public/module_after_seq.js');
const { bindeZuSeq, ZU_SEQ_TEXT } = await import('../public/werkbank/zu_seq.js');
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };

const WEG = { sends: 0, inserts: 0, master_inserts: 0, returns: 0, gruppen: 0, kettenautomation: 0, tonart: false, spuren_uebersprungen: [], gekuerzt: [] };
const BERICHT = (w = {}) => ({ platz: 2, deck_neu: true, patterns: [1, 2, 3, 4].map((i) => ({ name: `P${i}`, spur_id: `s${i}`, quelle_spur: `q${i}` })), weggelassen: { ...WEG, ...w } });

test('berichtText: one readable line, what was left out is counted', () => {
  assert.equal(berichtText(BERICHT()), 'loaded 4 patterns into SEQ 2');
  assert.equal(berichtText(BERICHT({ sends: 2, inserts: 1 })), 'loaded 4 patterns into SEQ 2 · left out: 2 sends, 1 insert');
  assert.equal(berichtText({ ...BERICHT(), patterns: [{}] }), 'loaded 1 pattern into SEQ 2');
  assert.equal(weggelassenText(BERICHT({ master_inserts: 1, returns: 2, gruppen: 1, kettenautomation: 3, tonart: true }).weggelassen),
    '1 master insert, 2 returns, 1 group, 3 chain automation lanes, the key');
  assert.equal(weggelassenText(BERICHT({ spuren_uebersprungen: [{ name: 'Aud', grund: 'audio track' }], gekuerzt: [{ name: 'L', noten: 2, punkte: 1 }, { name: 'M', noten: 1, punkte: 0 }] }).weggelassen),
    '1 track (Aud: audio track), 3 notes after bar 16, 1 lane point after bar 16');
});

test('ladeModulInSeq posts {slug, platz}; a refusal is one line with the reason text and the detail', async () => {
  const gesehen = [];
  const ok = await ladeModulInSeq('mod-a', 2, async (w, k) => { gesehen.push([w, k]); return { status: 200, j: { ok: true, bericht: BERICHT({ sends: 1 }), projekt: { live: true } } }; });
  assert.deepEqual(gesehen, [['/seq/modul', { slug: 'mod-a', platz: 2 }]]);
  assert.deepEqual([ok.ok, ok.text], [true, 'loaded 4 patterns into SEQ 2 · left out: 1 send']);
  const nein = await ladeModulInSeq('mod-a', 2, async () => ({ status: 409, j: { fehler: 'projekt_ungueltig', text: 'the project is invalid', detail: 'spuren: at most 8 Baukasten tracks (bk)' } }));
  assert.deepEqual([nein.ok, nein.text], [false, 'Load refused: the project is invalid (spuren: at most 8 Baukasten tracks (bk))']);
  const leer = await ladeModulInSeq('x', 1, async () => ({ status: 409, j: { fehler: 'modul_ohne_instrument', text: 'the module has no instrument track' } }));
  assert.match(leer.text, /no instrument track/);
});

test('modulZuSeq opens LIVE first (with the usual confirmation), loads second; a "no" sends nothing more', async () => {
  const gesehen = [], fragen = [];
  const h = (live) => async (w, k) => { gesehen.push([w, k]); return w === '/live/oeffnen' ? live(k) : { status: 200, j: { bericht: BERICHT() } }; };
  const a = await modulZuSeq('m', 3, h(() => ({ status: 200, j: {} })), (t) => { fragen.push(t); return true; });
  assert.deepEqual(gesehen.map((g) => g[0]), ['/live/oeffnen', '/seq/modul']); assert.equal(a.ok, true); assert.deepEqual(fragen, []);
  gesehen.length = 0;
  const live = (k) => (k.bestaetigt ? { status: 200, j: {} } : { status: 409, j: { fehler: 'live_laeuft', text: 'x' } });
  const b = await modulZuSeq('m', 3, h(live), (t) => { fragen.push(t); return true; });
  assert.deepEqual(gesehen.map((g) => g[0]), ['/live/oeffnen', '/live/oeffnen', '/seq/modul']); assert.equal(b.ok, true); assert.equal(fragen.length, 1);
  gesehen.length = 0;
  const c = await modulZuSeq('m', 3, h(live), () => false);
  assert.deepEqual([c.ok, c.abgelehnt], [false, true]); assert.deepEqual(gesehen.map((g) => g[0]), ['/live/oeffnen']);
  gesehen.length = 0;
  const d = await modulZuSeq('m', 3, h(() => ({ status: 409, j: { text: 'refused for a reason' } })), () => true);
  assert.equal(d.ok, false); assert.match(d.text, /refused for a reason/); assert.deepEqual(gesehen.map((g) => g[0]), ['/live/oeffnen']);
});

test('modulListe keeps the Workbench modules only', () => {
  assert.deepEqual(modulListe([{ slug: 'a', name: 'A', werkbank: true }, { slug: 'b', name: 'B' }, { slug: 'c', name: 'C', werkbank: true, fehler: 'json_kaputt' }]), [{ slug: 'a', name: 'A' }]);
  assert.deepEqual(modulListe(null), []);
});

// a context like the one of werkbank.js, just what the binder reads
function aufbau({ projekt = { name: 'M' }, antworten = {} } = {}) {
  installiere();
  const kopf = new El('div'), wurzel = new El('div');
  kopf.setAttribute('data-w', 'kopf'); wurzel.append(kopf);
  const meldungen = [], aufrufe = [], fragen = [], dj = [];
  const ctx = {
    st: { projekt, slug: projekt ? 'mod-a' : null }, $: (n) => wurzel.querySelector(`[data-w="${n}"]`), beimProjekt: [],
    melde: (t, f = false) => meldungen.push({ t, f }), frage: (t) => { fragen.push(t); return true; }, zeigeDj: () => dj.push(1),
    holeJson: async (weg, k) => { aufrufe.push({ weg, k }); const a = antworten[weg]; const x = typeof a === 'function' ? a(k) : a; return { status: x?.code ?? 200, j: x?.j ?? {} }; },
  };
  bindeZuSeq(ctx);
  return { ctx, $: ctx.$, meldungen, aufrufe, fragen, dj };
}

test('TO SEQ DECK: disabled without a module; a click opens LIVE, loads into the chosen place, shows the line and switches to the DJ view', async () => {
  const a = aufbau({ projekt: null, antworten: { '/seq/modul': { j: { bericht: BERICHT({ sends: 2, inserts: 1 }) } } } });
  assert.equal(a.$('zu-seq').textContent, 'TO SEQ DECK');
  assert.ok(a.$('zu-seq').disabled);
  assert.deepEqual(a.$('zu-seq-platz').querySelectorAll('option').map((o) => o.value), ['1', '2', '3', '4']);
  a.ctx.st.projekt = { name: 'M' }; a.ctx.st.slug = 'mod-a';
  for (const h of a.ctx.beimProjekt) h(a.ctx.st.projekt, true);
  assert.ok(!a.$('zu-seq').disabled);
  a.$('zu-seq-platz').value = '2';
  a.$('zu-seq').dispatch('click'); await ruhe();
  assert.deepEqual(a.aufrufe, [{ weg: '/live/oeffnen', k: {} }, { weg: '/seq/modul', k: { slug: 'mod-a', platz: 2 } }]);
  assert.deepEqual(a.meldungen, [{ t: 'loaded 4 patterns into SEQ 2 · left out: 2 sends, 1 insert', f: false }]);
  assert.equal(a.dj.length, 1);
  assert.ok(a.$('zu-seq').textContent === ZU_SEQ_TEXT.knopf && !a.$('zu-seq').disabled, 'the busy state is over');
});

test('TO SEQ DECK: a refusal is a readable error line and the view stays; a "no" to the confirmation says nothing', async () => {
  const a = aufbau({ antworten: { '/seq/modul': { code: 409, j: { fehler: 'kanal_offen', text: 'the channel deck/2 of place 2 is open; close it before a SEQ deck is created there' } } } });
  a.$('zu-seq').dispatch('click'); await ruhe();
  assert.equal(a.meldungen.length, 1); assert.equal(a.meldungen[0].f, true); assert.match(a.meldungen[0].t, /deck\/2/);
  assert.equal(a.dj.length, 0);
  const b = aufbau({ antworten: { '/live/oeffnen': (k) => (k.bestaetigt ? { j: {} } : { code: 409, j: { fehler: 'live_laeuft', text: 'x' } }) } });
  b.ctx.frage = () => false;
  b.$('zu-seq').dispatch('click'); await ruhe();
  assert.deepEqual(b.meldungen, []); assert.equal(b.dj.length, 0); assert.deepEqual(b.aufrufe.map((x) => x.weg), ['/live/oeffnen']);
});

test('the workbench knows the binder and app.js hands over the DJ view switch', () => {
  const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const wb = fs.readFileSync(path.join(PUBLIC, 'werkbank/werkbank.js'), 'utf8'), app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.match(wb, /bindeExport, bindeZuSeq, bindeAnalyse/);
  assert.match(app, /zeigeDj: \(\) => \{ setzeAnsicht\('dj'\)/);
});
