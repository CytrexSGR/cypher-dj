// Workbench task 4: the SOUND region (sound.js): header, the INSTRUMENT tile and the device area; extension points for the effect tiles (task 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { ersatzPanel, effektKachel, plusEintraege } = await import('../public/werkbank/sound.js');
const { offenesFace, schliesseFace } = await import('../public/face/frame.js');
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

test('SOUND shows the track name, the INSTRUMENT tile with the instrument text and the device area', async () => {
  aufbau(projektMit([bk(1, 'bass-banddrive')]));
  w.zeige(); await ruhe();
  assert.ok($w('klang-titel').textContent.includes('SOUND'));
  assert.ok($w('klang-titel').textContent.includes('T1'));
  const t = $w('kachel-instrument');
  assert.ok(t.textContent.includes('INSTRUMENT'));
  assert.ok(t.textContent.includes('Baukasten · bass-banddrive'));
  assert.ok(t.classList.contains('aktiv'));
  assert.ok($w('geraet') !== null);
});

test('a track without a front panel (kit) shows a text, no panel request', async () => {
  aufbau(projektMit([kit(1)]));
  w.zeige(); await ruhe();
  assert.equal(attrappe.anrufe.filter((a) => a.url.startsWith('/geraete/panel')).length, 0);
  assert.ok($w('geraet').textContent.includes('no front panel'));
});

test('an effect tile source is drawn after INSTRUMENT, a click selects it and calls the tile hooks', async () => {
  aufbau(projektMit([bk(1, 'bass-banddrive')]));
  const gewaehlt = [];
  w.ctx.klang.quellen.push((spur) => [{ id: 'fx1', titel: 'EFFECT', text: `on ${spur.name}` }]);
  w.ctx.klang.beiKachel.push((id) => gewaehlt.push(id));
  w.zeige(); await ruhe();
  const fxKachel = () => wurzel.querySelectorAll('[data-w="kachel"]').find((k) => k.dataset.kachel === 'fx1');
  assert.ok(fxKachel().textContent.includes('on T1'));
  fxKachel().dispatch('click'); await ruhe();
  assert.deepEqual(gewaehlt, ['fx1']);
  assert.ok(fxKachel().classList.contains('aktiv'));
  assert.ok(!$w('kachel-instrument').classList.contains('aktiv'));
  assert.ok($w('geraet-instrument').hidden);
  $w('kachel-instrument').dispatch('click'); await ruhe();
  assert.ok(!$w('geraet-instrument').hidden);
});

test('a project change refreshes the panel of the same track without a second panel request', async () => {
  aufbau(projektMit([bk(1, 'bass-banddrive')]));
  w.zeige(); await ruhe();
  const n = attrappe.anrufe.filter((a) => a.url.startsWith('/geraete/panel')).length;
  w.ctx.uebernimm('m1', projektMit([bk(1, 'bass-banddrive')], 2)); await ruhe();
  assert.equal(attrappe.anrufe.filter((a) => a.url.startsWith('/geraete/panel')).length, n);
});

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

test('adding a compressor to the bass sends insert_setzen; its tile opens the face; a bk stage shows its panel below', async () => {
  aufbauFx(mitInserts([]));
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 2, projekt: mitInserts([ins('i1', 'komp', 1)], 2) } };
  w.zeige(); await ruhe();
  assert.equal(effektKacheln().length, 0);
  $w('plus').dispatch('click'); await ruhe();
  const eintrag = (t) => [...wurzel.querySelectorAll('[data-w="plus-eintrag"]')].find((e) => e.textContent === t);
  assert.deepEqual(wurzel.querySelectorAll('[data-w="plus-eintrag"]').map((e) => e.textContent), ['Compressor', 'EQ', 'Saturator', 'Limiter', 'fx-delay-sync', 'fx-plate']);
  eintrag('Compressor').dispatch('click'); await ruhe();
  const s = SENDUNGEN().at(-1).koerper;
  assert.deepEqual(s.befehle, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }]);
  assert.equal(s.label, 'Add a compressor to T1');
  assert.equal(effektKacheln().length, 1);
  assert.ok(kachelVon('fx:i1').textContent.includes('COMPRESSOR'));
  assert.ok(kachelVon('fx:i1').classList.contains('gewaehlt'), 'the new stage is selected');
  assert.ok($w('plus-menue') === null, 'the menu closed');
  // a click on a face kind opens the floating face and leaves the device area alone
  assert.equal(offenesFace(), null);
  kachelVon('fx:i1').dispatch('click'); await ruhe();
  assert.ok(offenesFace() !== null);
  assert.equal(offenesFace().id, 'face:i1');
  assert.ok(!$w('geraet-instrument').hidden, 'the instrument panel stays');
  assert.ok($w('geraet-weiter').hidden);
  schliesseFace();
  // a bk stage: its panel (generated, no sidecar) appears in the device area below
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 3, projekt: mitInserts([ins('i1', 'komp', 1), ins('i2', 'bk', 1, { graph: 'fx-delay-sync' })], 3) } };
  $w('plus').dispatch('click'); await ruhe();
  eintrag('fx-delay-sync').dispatch('click'); await ruhe();
  const b = SENDUNGEN().at(-1).koerper;
  assert.deepEqual(b.befehle, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'bk', graph: 'fx-delay-sync' }]);
  assert.equal(kachelVon('fx:i2').textContent.includes('fx-delay-sync'), true);
  assert.ok(kachelVon('fx:i2').classList.contains('aktiv'));
  assert.ok($w('geraet-instrument').hidden);
  assert.ok(!$w('geraet-weiter').hidden);
  assert.ok(attrappe.anrufe.some((a) => a.url === '/graphen/panel?name=fx-delay-sync'));
  assert.ok($w('geraet-weiter').textContent.includes('Time'), 'the generated panel carries the knob names');
  assert.equal(offenesFace(), null);
  // back to the instrument
  $w('kachel-instrument').dispatch('click'); await ruhe();
  assert.ok(!$w('geraet-instrument').hidden);
  assert.ok($w('effekt-leiste').hidden);
});

test('a full pool or strip refuses in the menu and sends nothing', async () => {
  aufbauFx(mitInserts(Array.from({ length: MAX_PLAETZE }, (_, i) => ins(`e${i}`, 'eq', i + 1))));
  w.zeige(); await ruhe();
  $w('plus').dispatch('click'); await ruhe();
  const e = wurzel.querySelectorAll('[data-w="plus-eintrag"]');
  assert.equal(e.length, 6);
  assert.ok(e.every((x) => x.disabled === true));
  e[0].dispatch('click'); await ruhe();
  assert.equal(SENDUNGEN().length, 0);
});

test('moving, bypassing and removing a stage', async () => {
  const zwei = (rev, extra = {}) => mitInserts([ins('i1', 'komp', 1, extra.i1), ins('i2', 'eq', 1, extra.i2)], rev);
  aufbauFx(zwei(1));
  w.zeige(); await ruhe();
  assert.deepEqual(effektKacheln().map((k) => k.dataset.kachel), ['fx:i1', 'fx:i2']);
  kachelVon('fx:i1').dispatch('click'); await ruhe();   // opens its face, selects the tile
  schliesseFace();
  assert.ok(!$w('effekt-leiste').hidden);
  assert.equal($w('fx-links').disabled, true, 'nothing to the left of stage 1');
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 2, projekt: mitInserts([ins('i2', 'eq', 1), ins('i1', 'komp', 1)], 2) } };
  $w('fx-rechts').dispatch('click'); await ruhe();
  let s = SENDUNGEN().at(-1).koerper;
  assert.deepEqual(s.befehle, [{ befehl: 'insert_ordnung', strang_id: 's1', reihenfolge: ['i2', 'i1'] }]);
  assert.equal(s.label, 'Move compressor 1 on T1 later');
  assert.deepEqual(effektKacheln().map((k) => k.dataset.kachel), ['fx:i2', 'fx:i1'], 'the tiles follow the new order');
  assert.equal($w('fx-rechts').disabled, true, 'the selected stage is last now');
  // bypass
  assert.equal($w('fx-an').textContent, 'ON');
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 3, projekt: mitInserts([ins('i2', 'eq', 1), ins('i1', 'komp', 1, { an: false })], 3) } };
  $w('fx-an').dispatch('click'); await ruhe();
  s = SENDUNGEN().at(-1).koerper;
  assert.deepEqual(s.befehle, [{ befehl: 'insert_an', insert_id: 'i1', an: false }]);
  assert.equal($w('fx-an').textContent, 'OFF');
  assert.ok(kachelVon('fx:i1').classList.contains('aus'));
  // remove: no question, one command
  const gefragt = [];
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 4, projekt: mitInserts([ins('i2', 'eq', 1)], 4) } };
  $w('fx-weg').dispatch('click'); await ruhe();
  s = SENDUNGEN().at(-1).koerper;
  assert.deepEqual(s.befehle, [{ befehl: 'insert_entfernen', insert_id: 'i1' }]);
  assert.equal(s.label, 'Remove compressor 2 from T1');
  assert.deepEqual(gefragt, []);
  assert.deepEqual(effektKacheln().map((k) => k.dataset.kachel), ['fx:i2']);
  assert.ok($w('effekt-leiste').hidden, 'nothing is selected after the removal');
});

test('a stage removed elsewhere: its tile goes, the device area returns to the instrument', async () => {
  aufbauFx(mitInserts([ins('i2', 'bk', 1, { graph: 'fx-delay-sync' })]));
  w.zeige(); await ruhe();
  kachelVon('fx:i2').dispatch('click'); await ruhe();
  assert.ok(!$w('geraet-weiter').hidden);
  assert.ok(!$w('effekt-leiste').hidden);
  w.ctx.uebernimm('m1', mitInserts([], 2)); await ruhe();
  assert.equal(effektKacheln().length, 0);
  assert.ok(!$w('geraet-instrument').hidden);
  assert.ok($w('geraet-weiter').hidden);
  assert.equal($w('geraet-weiter').children.length, 0);
  assert.ok($w('effekt-leiste').hidden);
  assert.equal(w.ctx.klang.kachel, 'instrument');
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
  $w('instrument-wechsel').click(); await ruhe();
  const greif = punkte.find((p) => p.text === 'synth-greif');
  assert.ok(greif, 'menu lists the Baukasten instruments');
  const kopf = punkte.filter((p) => p.gruppe).map((p) => p.text);
  assert.deepEqual(kopf, ['Baukasten \u00b7 lead', 'Baukasten \u00b7 other', 'Other'], 'grouped by category, the uncategorised after');
  assert.ok(punkte.indexOf(greif) < punkte.findIndex((p) => p.text === 'bass-banddrive'));
  greif.aktion(); await ruhe();
  const a = attrappe.anrufe.filter((x) => x.url.startsWith('/proj/aendern')).at(-1);
  assert.ok(a, 'a project change was sent');
  const k = typeof a.koerper === 'string' ? JSON.parse(a.koerper) : a.koerper;
  const befehle = k.befehle;
  assert.deepEqual(befehle.map((b) => b.befehl), ['spur_aendern']);
  assert.equal(befehle[0].geraet.graph, 'synth-greif');
});
