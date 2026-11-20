// Workbench SOUND plumbing (sound.js): the pure helpers (fallback panel, stage text, the "+" entries), the sound host with the cut strip, the stream hooks of
// the native stages and the instrument exchange (CHANGE on a dock card). The tiles of stage 1 are gone: the cards are tested in werkbank_dock.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { ersatzPanel } = await import('../public/dock/panel_source.js');
const { effektKachel } = await import('../public/dock/stages.js');
const { plusEintraege } = await import('../public/dock/plus.js');
const { MAX_PLAETZE, MAX_KOMP } = await import('../public/production/inserts.js');

const bk = (nr, graph) => ({ id: `s${nr}`, nr, name: `T${nr}`, farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} }, clips: [] });
const kit = (nr) => ({ id: `s${nr}`, nr, name: `K${nr}`, farbe: '#ff8800', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'k1', parameter: {} }, clips: [] });
const projektMit = (spuren, rev = 1) => ({ name: 'M', rev, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren });
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
let wurzel, w;
const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
function aufbau(projekt) {
  installiere({ antworten: { 'GET /proj/aktuell': { j: { slug: 'm1', projekt } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } }, 'GET /seq/geraet': { j: { art: 'bk', regler: [], klaenge: [] } }, 'GET /geraete/panel': { j: {} } } });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
}

// ---- task 8: the insert chain ------------------------------------------------------------------------------------------------------------------------
const ins = (id, art, slot, extra = {}) => ({ id, art, slot, an: true, werte: {}, ...extra });
const mitInserts = (inserts, rev = 1) => projektMit([{ ...bk(1, 'bass-banddrive'), inserts }], rev);
const GRAPHEN = [
  { name: 'fx-delay-sync', art: 'effekt', latenz: 0, regler_namen: { 1: 'Time', 2: 'Feedback' } },
  { name: 'bass-banddrive', art: 'instrument', latenz: 0, regler_namen: {} },
  { name: 'fx-plate', art: 'effekt', latenz: 0, regler_namen: {} },
];
const aufbauFx = (projekt, extra = {}) => {
  aufbau(projekt);
  Object.assign(attrappe.antworten, { 'GET /graphen': { j: { graphen: GRAPHEN } }, 'GET /graphen/panel': { j: { panel: null } }, ...extra });
};
const SENDUNGEN = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/proj/aendern');
const kachelVon = (id) => [...wurzel.querySelectorAll('[data-w="kachel"]')].find((k) => k.dataset.kachel === id);
const effektKacheln = () => [...wurzel.querySelectorAll('[data-w="kachel"]')].filter((k) => k.dataset.kachel.startsWith('fx:'));

test('ersatzPanel: groups of eight, names from the graph', () => {
  const p = ersatzPanel('fx-delay-sync', { 1: 'Time', 2: 'Feedback' }, { 1: { vorgabe: 0.3 } });
  assert.deepEqual(p.sections.map((s) => s.title), ['KNOBS 1–8']);
  assert.deepEqual(p.sections[0].controls.slice(0, 3).map((c) => [c.label, c.bind.param, c.default]), [['Time', 'k1', 0.3], ['Feedback', 'k2', 0.5], ['K3', 'k3', 0.5]]);
  assert.equal(p.format, 'cypherdj-panel/2');
  assert.equal(p.title, 'fx-delay-sync');
  const gross = ersatzPanel('g', { 12: 'Last' }, {});
  assert.deepEqual(gross.sections.map((s) => s.title), ['KNOBS 1–8', 'KNOBS 9–12']);
  assert.equal(gross.sections[1].controls.length, 4);
  assert.equal(gross.sections[1].controls[3].label, 'Last');
});

test('effektKachel: the tile text per kind', () => {
  assert.deepEqual(effektKachel(ins('i1', 'komp', 1)), { titel: 'EFFECT', text: 'COMPRESSOR', an: true });
  assert.deepEqual(['eq', 'saett', 'lim', 'utility'].map((a) => effektKachel(ins('x', a, 1)).text), ['EQ', 'SATURATION', 'LIMITER', 'UTILITY']);
  assert.deepEqual(effektKachel(ins('i2', 'bk', 1, { graph: 'fx-plate', an: false })), { titel: 'EFFECT', text: 'fx-plate', an: false });
});

test('plusEintraege: pools and the five places', () => {
  // 12 compressors are spread over strips of at most five: use three strips
  const verteilt = projektMit([1, 2, 3].map((n) => ({ ...bk(n, 'bass-banddrive'), inserts: Array.from({ length: n === 3 ? 2 : 5 }, (_, i) => ins(`k${n}${i}`, 'komp', (n - 1) * 5 + i + 1)) })));
  const e = plusEintraege(verteilt, 's3', GRAPHEN);
  assert.deepEqual(e.map((x) => x.text), ['Compressor', 'EQ', 'Saturator', 'Limiter', 'fx-delay-sync', 'fx-plate']);
  assert.equal(e[0].befehl, null); assert.equal(e[0].grund, 'No free compressor');
  assert.deepEqual(e[1].befehl, { befehl: 'insert_setzen', strang_id: 's3', pos: 2, art: 'eq' });
  assert.deepEqual(e[4].befehl, { befehl: 'insert_setzen', strang_id: 's3', pos: 2, art: 'bk', graph: 'fx-delay-sync' });
  // a strip with five stages: every entry is refused
  const fuenf = projektMit([{ ...bk(1, 'bass-banddrive'), inserts: Array.from({ length: MAX_PLAETZE }, (_, i) => ins(`e${i}`, 'eq', i + 1)) }]);
  const f = plusEintraege(fuenf, 's1', GRAPHEN);
  assert.equal(f.length, 6);
  assert.ok(f.every((x) => x.befehl === null && typeof x.grund === 'string' && x.grund.length > 0));
});

test('the sound host holds the cut strip, is hidden, and the panel source and the insert faces are on ctx', async () => {
  aufbau(projektMit([bk(1, 'bass-banddrive')]));
  w.zeige(); await ruhe();
  assert.equal($w('klang').hidden, true);
  assert.ok($w('klang').contains($w('schnitt')));
  assert.equal(typeof w.ctx.insertFaceOeffnen, 'function');
  assert.equal(typeof w.ctx.instrumentWechsel, 'function');
  assert.equal(typeof w.ctx.panelQuelle.panelVon, 'function');
});

test('a track without a front panel (kit): no panel request for it, its window says so', async () => {
  aufbau(projektMit([kit(1)]));
  w.zeige(); await ruhe();
  assert.equal(attrappe.anrufe.filter((a) => a.url.startsWith('/geraete/panel')).length, 0);
  $w('karte-auf').dispatch('click'); await ruhe();
  assert.ok($w('fenster').textContent.includes('no front panel'));
});

test('a full pool or strip refuses in the menu and sends nothing', async () => {
  aufbauFx(mitInserts(Array.from({ length: MAX_PLAETZE }, (_, i) => ins(`e${i}`, 'eq', i + 1))));
  w.zeige(); await ruhe();
  let punkte = null; w.ctx.oeffneMenue = (l) => { punkte = l; };
  $w('karte-plus').dispatch('click'); await ruhe();
  assert.equal(punkte.length, 6);
  assert.ok(punkte.every((x) => x.aus === true && typeof x.titel === 'string'));
  assert.equal(SENDUNGEN().length, 0);
});

test('the stream hooks for gain reduction and level take readings and malformed events', async () => {
  aufbauFx(mitInserts([ins('i1', 'komp', 1)]));
  w.zeige(); await ruhe();
  const n = w.ctx.beimEreignis.length;
  assert.ok(n >= 2);
  // a malformed event must not throw
  for (const h of w.ctx.beimEreignis) { h('/e/ins_gr', { kanal: 'ins/komp/1', gr_db: 3 }); h('/e/stufe_pegel', { kanal: 'ins/komp/1', ein_db: -6, aus_db: -9 }); h('/e/ins_gr', null); }
});

test('CHANGE swaps the instrument of the selected track in one command, the notes stay', async () => {
  const s = bk(1, 'bass-banddrive'); s.clips = [{ id: 'c1', art: 'midi', start_beat: 0, laenge_beats: 64, loop_beats: 16, noten: [{ id: 'n1', beat: 0, laenge: 0.25, ton: 36, vel: 100 }] }];
  aufbau(projektMit([s]));
  attrappe.antworten['GET /graphen'] = { j: { graphen: [{ name: 'bass-banddrive', art: 'instrument' }, { name: 'synth-greif', art: 'instrument', kategorie: 'lead' }] } };
  attrappe.antworten['GET /proj/kits'] = { j: { kits: [] } };
  w.zeige(); await ruhe();
  let punkte = null; w.ctx.oeffneMenue = (liste) => { punkte = liste; };
  $w('karte-wechsel').click(); await ruhe();
  const greif = punkte.find((p) => p.text === 'synth-greif \u00b7 Lead');   // grouped by type (the default); the text carries the role
  assert.ok(greif, 'menu lists the Baukasten instruments');
  const kopf = punkte.filter((p) => p.gruppe).map((p) => p.text);
  assert.deepEqual(kopf, ['Other', 'RB-338', 'View'], 'no type in this data: both graphs under Other, then the RB-338, then the view switch');
  assert.equal(punkte.at(-1).text, 'Group by role', 'the last item switches the axis');
  assert.ok(punkte.indexOf(greif) < punkte.findIndex((p) => p.text === 'bass-banddrive'));
  greif.aktion(); await ruhe();
  const a = attrappe.anrufe.filter((x) => x.url.startsWith('/proj/aendern')).at(-1);
  assert.ok(a, 'a project change was sent');
  const k = typeof a.koerper === 'string' ? JSON.parse(a.koerper) : a.koerper;
  const befehle = k.befehle;
  assert.deepEqual(befehle.map((b) => b.befehl), ['spur_aendern']);
  assert.equal(befehle[0].geraet.graph, 'synth-greif');
});
