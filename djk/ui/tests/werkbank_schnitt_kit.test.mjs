// Sampler B task 3: TO KIT, the kit dialog and KIT TO TRACK (public/werkbank/schnitt_kit.js) against the DOM stand-in. The requests the dialog sends are
// asserted, not only the markup. The server's answers are the stand-in's recorded answers; nothing is written anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { KIT_TEXT } = await import('../public/werkbank/schnitt_kit.js');
const { NEU_TEXT } = await import('../public/werkbank/tracks.js');

const bk = (nr, graph) => ({ id: `s${nr}`, nr, name: `T${nr}`, farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} }, clips: [] });
const drums = (nr) => ({ id: `s${nr}`, nr, name: `D${nr}`, farbe: '#ff8800', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} }, clips: [] });
const kitSpur = (nr, kit) => ({ id: `s${nr}`, nr, name: kit, farbe: '#ff8800', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit }, clips: [] });
const projektMit = (spuren, rev = 1) => ({ name: 'M', rev, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren });
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const GETS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url.split('?')[0] === weg);
const letzter = (kopf) => { const [m, u] = kopf.split(' '); return attrappe.anrufe.filter((a) => a.methode === m && a.url === u).at(-1); };

const schnittJson = (id, n = 16) => ({
  schema: 1, id, name: `Break ${id}`, quelle: { art: 'loop', ref: 'break' }, bpm: 128, beats: 16, frames: n * 5625, methode: 'raster',
  grenzen: Array.from({ length: n + 1 }, (_, k) => k * 5625), guete: Array.from({ length: n }, () => ({ staerke: null, raster_abstand_beats: 0 })),
});
function welle() {
  const spalten = 600, b = new ArrayBuffer(16 + spalten * 4), v = new DataView(b);
  'DJKW'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 1, true); v.setUint32(8, 150, true); v.setUint32(12, spalten, true);
  return b;
}
const WELLE = welle();
const klangPlan = (scheibe, note, bank, name, extra = {}) => ({ scheibe, note, bank, name, frames: 5625, sekunden: 0.12, baender: { tief: 0.5, mitte: 0.3, hoch: 0.2 }, zu_lang: false, ...extra });
const VORSCHLAG = { kit: 'break-x', klaenge: [klangPlan(1, 36, 'bd', 'bd:0'), klangPlan(3, 37, 'sd', 'sd:0')] };
const GESCHRIEBEN = { kit: 'brk', klaenge: [{ scheibe: 1, note: 36, name: 'bd:0', datei: '36.f32', frames: 5625 }, { scheibe: 3, note: 37, name: 'sd:0', datei: '37.f32', frames: 5625 }] };

let wurzel, w, tor, schnitte, infoStand;
const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
const alle = (n) => wurzel.querySelectorAll(`[data-w="${n}"]`);
const streifen = () => $w('schnitt');
const scheibeEl = (i) => { const e = streifen().querySelectorAll('[data-w="schnitt-scheibe"]').find((x) => x.dataset.scheibe === String(i)); assert.ok(e, `no slice ${i}`); return e; };
const klick = (el, ev = {}) => el.dispatch('click', ev);
const kitKnopf = () => streifen().querySelectorAll('[data-aktion="kit"]')[0];
const zeilen = () => alle('kit-klang');
const dialog = () => $w('kit-dialog');

// `spuren` of the project; the cut x has 16 slices; `tor` holds the proposal back when a test needs it
function aufbau(projekt, { vorschlag = { j: VORSCHLAG }, info = null, bremse = false } = {}) {
  installiere({ antworten: { 'GET /proj/aktuell': { j: { slug: 'm1', projekt } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } }, 'GET /geraete/panel': { j: {} },
    'GET /sampler/kit/vorschlag': vorschlag, 'POST /sampler/kit': { j: GESCHRIEBEN } } });
  schnitte = { x: schnittJson('x'), y: schnittJson('y', 8) };
  infoStand = info ?? { s1: { schnitt: { id: 'x', scheiben: 16, laengen_beats: [] } } };
  tor = null;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    const u = String(url), q = new URLSearchParams(u.split('?')[1] ?? '');
    if (bremse && u.startsWith('/sampler/kit/vorschlag') && tor) await tor.offen;
    const r = await orig(url, opt);
    if (u.startsWith('/welle')) return { ...r, status: 200, ok: true, arrayBuffer: async () => WELLE };
    if (u.startsWith('/seq/geraet')) {
      const s = infoStand[q.get('spur_id')];
      return { ...r, json: async () => ({ art: 'bk', regler: [], klaenge: [], ...(s ? { schnitt: s.schnitt } : {}) }) };
    }
    if (u.startsWith('/sampler/schnitt') && (opt?.method ?? 'GET') === 'GET') {
      const s = schnitte[q.get('id')];
      return { ...r, status: 200, ok: true, json: async () => ({ schnitt: s }) };
    }
    return r;
  };
  if (bremse) { let frei; tor = { offen: new Promise((ok) => { frei = ok; }), frei }; }
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
}
const zweiSpuren = (rev = 1) => projektMit([bk(1, 'smp-x'), drums(2), bk(3, 'smp-y')], rev);
// the slice track with 1 and 3 selected, TO KIT clicked and the proposal shown
async function oeffne(projekt = zweiSpuren()) {
  aufbau(projekt);
  w.zeige(); await ruhe();
  klick(scheibeEl(3), { shiftKey: true }); klick(scheibeEl(1), { shiftKey: true });
  klick(kitKnopf()); await ruhe();
}

test('TO KIT is disabled without a selection and opens the dialog with the proposal', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  assert.equal(kitKnopf().textContent, KIT_TEXT.knopf);
  assert.equal(kitKnopf().disabled, true);
  assert.ok(dialog().hidden);
  klick(kitKnopf()); await ruhe();
  assert.equal(GETS('/sampler/kit/vorschlag').length, 0);
  klick(scheibeEl(3), { shiftKey: true }); klick(scheibeEl(1), { shiftKey: true });
  assert.equal(kitKnopf().disabled, false);
  klick(kitKnopf()); await ruhe();
  assert.deepEqual(GETS('/sampler/kit/vorschlag').map((a) => a.url), ['/sampler/kit/vorschlag?id=x&scheiben=1,3']);
  assert.ok(!dialog().hidden);
  assert.equal(zeilen().length, 2);
  assert.deepEqual(zeilen().map((z) => z.dataset.scheibe), ['1', '3']);
  assert.deepEqual(alle('kit-nr').map((e) => e.textContent), ['2', '4']);
  assert.equal($w('kit-name').value, VORSCHLAG.kit);
  assert.deepEqual(alle('kit-bank').map((e) => e.value), ['bd', 'sd']);
  assert.deepEqual(alle('kit-voll').map((e) => e.textContent), ['bd:0 · note 36', 'sd:0 · note 37']);
  assert.equal($w('kit-schreiben').textContent, 'WRITE KIT');
  assert.equal($w('kit-spur').textContent, 'KIT TO TRACK');
  assert.equal($w('kit-zu').textContent, 'CLOSE');
  assert.equal($w('kit-schreiben').disabled, false);
  assert.equal($w('kit-spur').disabled, true, 'nothing to place before the kit is written');
  assert.equal(alle('kit-lang').length, 0);
  assert.equal(attrappe.anrufe.filter((a) => a.methode === 'POST').length, 0, 'opening sends no write');
  klick($w('kit-zu'));
  assert.ok(dialog().hidden);
  assert.equal(zeilen().length, 0);
});

test('editing a bank renumbers; a bad bank disables WRITE KIT (review focus 3)', async () => {
  await oeffne();
  const bank = alle('kit-bank');
  bank[1].value = 'bd'; bank[1].dispatch('input');
  assert.deepEqual(alle('kit-voll').map((e) => e.textContent), ['bd:0 · note 36', 'bd:1 · note 37']);
  assert.equal($w('kit-schreiben').disabled, false);
  for (const falsch of ['BD', 'bd:2', '', '9x', 'a'.repeat(17), 'b d']) {
    bank[0].value = falsch; bank[0].dispatch('input');
    assert.ok(bank[0].classList.contains('falsch'), `"${falsch}" is marked`);
    assert.ok(!bank[1].classList.contains('falsch'));
    assert.equal($w('kit-schreiben').disabled, true, `"${falsch}" blocks WRITE KIT`);
    assert.ok($w('kit-text').textContent.length > 10);
    assert.equal(alle('kit-voll')[0].textContent, '');
  }
  bank[0].value = 'hh_2'; bank[0].dispatch('input');
  assert.ok(!bank[0].classList.contains('falsch'));
  assert.equal($w('kit-schreiben').disabled, false);
  assert.deepEqual(alle('kit-voll').map((e) => e.textContent), ['hh_2:0 · note 36', 'bd:0 · note 37']);
  // the kit name follows KIT_NAME
  for (const falsch of ['A b', '', 'x'.repeat(33), '../x']) {
    $w('kit-name').value = falsch; $w('kit-name').dispatch('input');
    assert.ok($w('kit-name').classList.contains('falsch'), `name "${falsch}"`);
    assert.equal($w('kit-schreiben').disabled, true);
  }
  $w('kit-name').value = 'brk-2_x'; $w('kit-name').dispatch('input');
  assert.ok(!$w('kit-name').classList.contains('falsch'));
  assert.equal($w('kit-schreiben').disabled, false);
  assert.equal(POSTS('/sampler/kit').length, 0);
});

test('WRITE KIT sends the banks, then KIT TO TRACK adds a kit track and selects it', async () => {
  await oeffne();
  $w('kit-name').value = 'brk'; $w('kit-name').dispatch('input');
  klick($w('kit-schreiben')); await ruhe();
  assert.deepEqual(letzter('POST /sampler/kit').koerper, { id: 'x', scheiben: [1, 3], banken: ['bd', 'sd'], kit: 'brk' });
  assert.equal($w('kit-text').textContent, 'Kit brk: bd:0 · sd:0');
  assert.ok($w('kit-name').hasAttribute('readonly') && alle('kit-bank').every((b) => b.hasAttribute('readonly')), 'name and banks are read-only now');
  assert.equal($w('kit-schreiben').disabled, true, 'a written kit is not written again');
  assert.equal($w('kit-spur').disabled, false);
  assert.ok(!dialog().hidden);
  const mit = { ...zweiSpuren(2), spuren: [...zweiSpuren().spuren, kitSpur(4, 'brk')] };
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 2, projekt: mit } };
  klick($w('kit-spur')); await ruhe();
  const a = letzter('POST /proj/aendern').koerper;
  assert.equal(a.rev, 1);
  assert.equal(a.label, 'Add track brk');
  assert.equal(a.befehle.length, 1);
  assert.deepEqual([a.befehle[0].befehl, a.befehle[0].name, a.befehle[0].geraet], ['werkbank_spur_neu', 'brk', { art: 'intern', name: 'kit', kit: 'brk' }]);
  assert.equal(a.befehle[0].loop_beats, 16);
  assert.equal(w.ctx.st.wahl, 's4');
  assert.ok(dialog().hidden);
  assert.equal(POSTS('/sampler/kit').length, 1);
});

test('a too long slice blocks WRITE KIT; a refusal shows its text (review focus 1)', async () => {
  aufbau(zweiSpuren(), { vorschlag: { j: { kit: 'break-x', klaenge: [klangPlan(1, 36, 'bd', 'bd:0', { zu_lang: true, frames: 480001, sekunden: 10 }), klangPlan(3, 37, 'sd', 'sd:0')] } } });
  w.zeige(); await ruhe();
  klick(scheibeEl(3), { shiftKey: true }); klick(scheibeEl(1), { shiftKey: true });
  klick(kitKnopf()); await ruhe();
  assert.equal(alle('kit-lang').length, 1);
  assert.equal(zeilen()[0].querySelectorAll('[data-w="kit-lang"]').length, 1, 'on the row of the long slice');
  assert.equal(alle('kit-lang')[0].textContent, 'Longer than 10 s: remove it from the selection');
  assert.equal($w('kit-schreiben').disabled, true);
  assert.ok($w('kit-text').textContent.includes('Longer than 10 s'));
  klick($w('kit-schreiben')); await ruhe();
  assert.equal(POSTS('/sampler/kit').length, 0, 'a disabled WRITE KIT sends nothing');
  // the server's refusal of an existing name: its text, the dialog stays open and can write again
  await oeffne();
  attrappe.antworten['POST /sampler/kit'] = { code: 409, j: { fehler: 'kit_vorhanden', text: 'a kit named break-x exists already; choose another name' } };
  klick($w('kit-schreiben')); await ruhe();
  assert.equal($w('kit-text').textContent, 'A kit named break-x exists already; choose another name');
  assert.ok($w('kit-text').classList.contains('fehler'));
  assert.ok(!dialog().hidden);
  assert.ok(!$w('kit-name').hasAttribute('readonly'));
  assert.equal($w('kit-schreiben').disabled, false);
  assert.equal($w('kit-spur').disabled, true);
  // a refusal with a reason the page has its own generic text for still shows the server's text
  attrappe.antworten['POST /sampler/kit'] = { code: 400, j: { fehler: 'argument_ungueltig', text: 'the number is given in slice order: write the bank only' } };
  klick($w('kit-schreiben')); await ruhe();
  assert.equal($w('kit-text').textContent, 'The number is given in slice order: write the bank only');
});

test('a proposal that is refused shows its text and leaves nothing to write', async () => {
  aufbau(zweiSpuren(), { vorschlag: { code: 404, j: { fehler: 'schnitt_unbekannt', text: 'cut x does not exist' } } });
  w.zeige(); await ruhe();
  klick(scheibeEl(1), { shiftKey: true });
  klick(kitKnopf()); await ruhe();
  assert.ok(!dialog().hidden);
  assert.equal($w('kit-text').textContent, 'Cut x does not exist');
  assert.equal(zeilen().length, 0);
  assert.equal($w('kit-schreiben').disabled, true);
  assert.equal($w('kit-spur').disabled, true);
});

test('a full module shows the text and keeps the kit (review focus 5); a track change closes the dialog (review focus 4)', async () => {
  const acht = projektMit([bk(1, 'smp-x'), ...[2, 3, 4, 5, 6, 7, 8].map(drums)]);
  await oeffne(acht);
  klick($w('kit-schreiben')); await ruhe();
  assert.equal(POSTS('/sampler/kit').length, 1);
  const vor = POSTS('/proj/aendern').length;
  klick($w('kit-spur')); await ruhe();
  assert.equal($w('kit-text').textContent, NEU_TEXT.voll);
  assert.ok($w('kit-text').classList.contains('fehler'));
  assert.equal(POSTS('/proj/aendern').length, vor, 'nothing is posted');
  assert.ok(!dialog().hidden, 'the dialog stays: the kit is on disk');
  // a slot is free later: the same dialog still places the kit
  const sieben = projektMit([bk(1, 'smp-x'), ...[2, 3, 4, 5, 6, 7].map(drums)], 2);
  w.ctx.uebernimm('m1', sieben); await ruhe();
  assert.ok(!dialog().hidden);
  assert.equal($w('kit-spur').disabled, false);
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 3, projekt: { ...sieben, rev: 3, spuren: [...sieben.spuren, kitSpur(9, 'brk')] } } };
  klick($w('kit-spur')); await ruhe();
  assert.equal(POSTS('/proj/aendern').length, vor + 1);
  assert.ok(dialog().hidden);
  // a refusal of the project (the 8 kit devices): the writer's text is shown in the dialog, the dialog stays
  await oeffne(zweiSpuren());
  klick($w('kit-schreiben')); await ruhe();
  attrappe.antworten['POST /proj/aendern'] = { code: 409, j: { fehler: 'kit_geraete_voll', text: 'a project holds at most 8 kit devices' } };
  klick($w('kit-spur')); await ruhe();
  assert.ok(!dialog().hidden);
  assert.ok($w('kit-text').classList.contains('fehler'));
  assert.ok($w('kit-text').textContent.length > 5);
  assert.equal($w('kit-spur').disabled, false, 'it can be tried again');
  // another track: the dialog closes and sends nothing more
  w.ctx.waehle('s2'); await ruhe();
  const n = attrappe.anrufe.length;   // after the page's own reads for the new selection
  assert.ok(dialog().hidden);
  assert.equal(zeilen().length, 0);
  klick($w('kit-spur')); klick($w('kit-schreiben')); await ruhe();
  assert.equal(attrappe.anrufe.length, n, 'no further request');
});

test('the dialog closes when the track changes to another cut; a proposal that arrives after that is dropped (review focus 4)', async () => {
  aufbau(zweiSpuren(), { bremse: true });
  w.zeige(); await ruhe();
  klick(scheibeEl(1), { shiftKey: true });
  klick(kitKnopf()); await ruhe();
  assert.ok(!dialog().hidden, 'open, waiting for the proposal');
  assert.ok($w('kit-text').textContent.includes('Reading'));
  assert.equal($w('kit-schreiben').disabled, true);
  w.ctx.waehle('s3'); await ruhe();
  assert.ok(dialog().hidden);
  tor.frei(); await ruhe();
  assert.ok(dialog().hidden, 'the late answer does not open it again');
  assert.equal(zeilen().length, 0);
  assert.equal(POSTS('/sampler/kit').length, 0);
});

test('the same track plays another cut: the dialog closes', async () => {
  await oeffne();
  assert.ok(!dialog().hidden);
  w.ctx.uebernimm('m1', projektMit([bk(1, 'smp-y'), drums(2), bk(3, 'smp-y')], 2)); await ruhe();
  assert.ok(dialog().hidden);
});

test('▶ hears the slice through the track', async () => {
  await oeffne();
  attrappe.antworten['POST /sampler/hoeren'] = { j: { ok: true, dauer_ms: 117 } };
  klick(zeilen()[1].querySelectorAll('[data-w="kit-hoeren"]')[0]); await ruhe();
  assert.deepEqual(letzter('POST /sampler/hoeren').koerper, { spur_id: 's1', scheibe: 3 });
  klick(zeilen()[0].querySelectorAll('[data-w="kit-hoeren"]')[0]); await ruhe();
  assert.deepEqual(letzter('POST /sampler/hoeren').koerper, { spur_id: 's1', scheibe: 1 });
  attrappe.antworten['POST /sampler/hoeren'] = { code: 409, j: { fehler: 'hoeren_abgelehnt', text: 'the core refused the note: spur_bereich' } };
  klick(zeilen()[0].querySelectorAll('[data-w="kit-hoeren"]')[0]); await ruhe();
  assert.equal($w('kit-text').textContent, 'The core refused the note: spur_bereich');
  assert.ok(!dialog().hidden);
});

test('a second click on WRITE KIT while the first request runs sends nothing', async () => {
  await oeffne();
  const k = $w('kit-schreiben');
  klick(k); klick(k); klick(k); await ruhe();
  assert.equal(POSTS('/sampler/kit').length, 1);
  klick(k); await ruhe();
  assert.equal(POSTS('/sampler/kit').length, 1, 'nor after it: the kit is written');
  // KIT TO TRACK likewise
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 2, projekt: { ...zweiSpuren(2), spuren: [...zweiSpuren().spuren, kitSpur(4, 'brk')] } } };
  const s = $w('kit-spur');
  klick(s); klick(s); await ruhe();
  assert.equal(POSTS('/proj/aendern').length, 1);
});

test('the dialog is bound to the strip action list only and leaves other tracks alone', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  assert.deepEqual(w.ctx.schnittAktionen.map((a) => a.id).sort(), ['kit', 'ton'], 'TO KIT (plan B) next to TO TONE (plan C), nothing else');
  assert.ok(klammer(dialog()), 'the dialog sits in the SOUND region');
  w.ctx.waehle('s2'); await ruhe();
  assert.ok(streifen().hidden);
  assert.ok(dialog().hidden);
});
function klammer(e) { for (let p = e.parent; p; p = p.parent) if (p.attrs?.['data-w'] === 'klang') return true; return false; }

// A2: a cut can change under the same id (marker drag, set or delete, CUT AGAIN, or Cypher cut it again). The dialog was made for the old cut: it closes with a line
// and sends nothing with the old slice numbers.
const handle = (k) => streifen().querySelectorAll('[data-w="schnitt-marke"]').find((e) => e.dataset.marke === String(k));
const GEAENDERT = 'The cut changed. Select the slices again.';
function aendereSchnitt(n = 9) {
  const neu = { ...schnittJson('x', n), methode: 'hand' };
  schnitte.x = neu;
  infoStand.s1 = { schnitt: { id: 'x', scheiben: n, laengen_beats: [] } };
  attrappe.antworten['POST /sampler/marke'] = { j: { schnitt: neu, text: 'Marker 10 removed.', rev: 5, projekt: { ...zweiSpuren(), rev: 5 } } };
}

test('the cut changes under the same id while the dialog is open: it closes with a line and WRITE KIT sends nothing (review focus 4)', async () => {
  await oeffne();
  assert.ok(!dialog().hidden);
  aendereSchnitt();
  handle(5).dispatch('dblclick'); await ruhe();
  assert.equal(POSTS('/sampler/marke').length, 1, 'the strip edited the cut');
  assert.ok(dialog().hidden, 'the dialog is closed');
  assert.equal(zeilen().length, 0);
  assert.equal($w('meldung').textContent, GEAENDERT);
  assert.ok($w('meldung').classList.contains('fehler'));
  klick($w('kit-schreiben')); klick($w('kit-spur')); klick(alle('kit-hoeren')[0] ?? $w('kit-zu')); await ruhe();
  assert.equal(POSTS('/sampler/kit').length, 0, 'no kit goes out with the old indices');
  assert.equal(POSTS('/sampler/hoeren').length, 0);
  // the strip works on: TO KIT needs a new selection and then proposes for the new cut
  assert.equal(kitKnopf().disabled, true);
  klick(scheibeEl(2), { shiftKey: true });
  klick(kitKnopf()); await ruhe();
  assert.equal(GETS('/sampler/kit/vorschlag').at(-1).url, '/sampler/kit/vorschlag?id=x&scheiben=2');
});

test('the cut changes after the selection was emptied in the open dialog: it closes as well; a written kit stays on disk', async () => {
  await oeffne();
  klick($w('kit-schreiben')); await ruhe();
  assert.equal(POSTS('/sampler/kit').length, 1);
  klick(scheibeEl(1), { shiftKey: true }); klick(scheibeEl(3), { shiftKey: true });
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [], 'the selection is empty: the selection hook does not fire again on the change');
  assert.ok(!dialog().hidden);
  aendereSchnitt(8);
  handle(4).dispatch('dblclick'); await ruhe();
  assert.ok(dialog().hidden);
  assert.equal($w('meldung').textContent, GEAENDERT);
  klick($w('kit-spur')); await ruhe();
  assert.equal(POSTS('/proj/aendern').length, 0, 'KIT TO TRACK does not send after the change either');
});

test('a proposal that is on its way when the cut changes is dropped', async () => {
  aufbau(zweiSpuren(), { bremse: true });
  w.zeige(); await ruhe();
  klick(scheibeEl(1), { shiftKey: true });
  klick(kitKnopf()); await ruhe();
  assert.ok(!dialog().hidden);
  aendereSchnitt();
  handle(5).dispatch('dblclick'); await ruhe();
  assert.ok(dialog().hidden);
  tor.frei(); await ruhe();
  assert.ok(dialog().hidden);
  assert.equal(zeilen().length, 0);
});
