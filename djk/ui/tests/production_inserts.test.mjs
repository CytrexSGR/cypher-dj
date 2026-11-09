// Slice 4a T7: the insert chain on the production page. The pure parts (inserts.js) run in node; the page parts drive the real page in a headless
// Chrome against the project stub (check/page_mock.mjs: the stub computes every command with the real S2 core). Without google-chrome the page
// tests are skipped and say so. The real look (phone and desktop width) is in the task notes; golden: tests/hilfen/seite_ohne_inserts_golden.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { INSERT_ARTEN } from '../project/insert_key.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';
import { KOMP_PARAMETER, KOMP_VOLL_TEXT, MAX_PLAETZE, MAX_KOMP, MAX_EQ, MAX_SAETT, MAX_LIM, LIM_PARAMETER, plaetze, neuerInsertBefehl, paramBefehl, preBefehl,
  SAETT_PARAMETER, EQ_KOPF_PARAMETER, EQ_BAND_PARAMETER, EQ_BAENDER, EQ_BAND_TYP_VORGABE, EQ_BAND_FREQ_VORGABE, EQ_TYPEN, EQ_STEIL, EQ_PLATZ, parameterVon, wertText,
  freqVonPos, posVonFreq, POS_MAX, anzahl, frei, ARTEN,
  INS_GR_FRIST_MS, insGrAufnehmen, insGrLesung, insGrAblaufIn, insGrText } from '../public/production/inserts.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const GOLDEN = new URL('./support/seite_ohne_inserts_golden.json', import.meta.url);
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;

// four audio tracks, one group, two returns; `ketten`: {strangId: n} compressors appended per strip with the real command
function projekt(ketten = {}, art = 'komp') {
  let p = neuesProjekt('Inserts page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }, { befehl: 'return_neu', name: 'Hall' }, { befehl: 'return_neu', name: 'Plate' }]);
  for (const [strang, n] of Object.entries(ketten)) {
    for (let pos = 0; pos < n; pos++) p = lauf(p, [{ befehl: 'insert_setzen', strang_id: strang, pos, art }]);
  }
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
async function seite(t, p) {
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(p);
  return s;
}
const zaehle = (s, sel) => s.w(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

test('inserts.js: the literal komp table equals the generated contract, the limits equal the model', () => {
  const vertrag = INSERT_ARTEN.komp.parameter.filter((q) => q.name !== 'an' && q.name !== 'sc');
  assert.deepEqual(KOMP_PARAMETER.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), vertrag.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]));
  assert.equal(MAX_PLAETZE, 4); assert.equal(MAX_KOMP, INSERT_ARTEN.komp.instanzen);
});

test('inserts.js: four places per strip, no gaps; commands; the pool message', () => {
  const p = projekt({ s1: 2 });
  const pl = plaetze(p.spuren[0]);
  assert.equal(pl.length, 4); assert.deepEqual(pl.map((x) => x?.id ?? null), ['i1', 'i2', null, null]);
  assert.deepEqual(neuerInsertBefehl(p, 's1'), { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'komp' });
  assert.equal(neuerInsertBefehl(projekt({ s1: 4 }), 's1'), null, 'four stages are the end of a chain');
  assert.equal(neuerInsertBefehl(projekt({ s1: 4, s2: 4, s3: 4 }), 's4'), null, 'twelve compressors are the end of the pool');
  assert.equal(KOMP_VOLL_TEXT, 'No free compressor');
  assert.deepEqual(paramBefehl('i1', 'schwelle', -20), { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'schwelle', wert: -20 });
  assert.deepEqual(preBefehl('r1', true), { befehl: 'return_aendern', return_id: 'r1', pre: true });
});

test('kette_zeigt_vier_plaetze', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 2, g1: 1 }));
  assert.equal(await zaehle(s, '.p-kette[data-strang="s1"] .p-platz'), 4, 'four places on the track');
  assert.equal(await zaehle(s, '.p-kette[data-strang="s1"] .p-stufe'), 2);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-kette[data-strang="s1"] .p-platz')].map((e) => e.dataset.insert ?? '')`), ['i1', 'i2', '', '']);
  assert.equal(await zaehle(s, '.p-kette[data-strang="g1"] .p-stufe'), 1, 'a group has a chain too');
  for (const id of ['s2', 'r1', 'master']) assert.equal(await zaehle(s, `.p-kette[data-strang="${id}"] .p-platz`), 4, `${id} shows four places`);
  assert.equal(await zaehle(s, '.p-kette[data-strang="s2"] .p-stufe'), 0);
  // the add button of the first free place makes insert_setzen at the end of the chain
  await s.b.klick('.p-kette[data-strang="s2"] .p-ins-neu');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[1].inserts?.length === 1), 'insert_setzen reached the project');
  assert.ok(await s.bis(() => zaehle(s, '.p-kette[data-strang="s2"] .p-stufe').then((n) => n === 1)), 'the page shows the new stage');
});

test('pre_schalter_sendet_return_aendern', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  assert.equal(await s.w(`document.querySelector('.p-returnkopf[data-ret="r1"] .p-prepost').getAttribute('aria-pressed')`), 'false', 'post is the default');
  await s.b.klick('.p-returnkopf[data-ret="r1"] .p-prepost');
  assert.ok(await s.bis(async () => (await s.projekt()).returns[0].pre === true), `the project holds pre: ${JSON.stringify((await s.projekt()).returns[0])}`);
  assert.ok(await s.bis(() => s.w(`document.querySelector('.p-returnkopf[data-ret="r1"] .p-prepost').getAttribute('aria-pressed') === 'true'`)), 'the switch shows PRE');
  assert.equal((await s.projekt()).returns[1].pre, undefined, 'the other return stays post');
  await s.b.klick('.p-returnkopf[data-ret="r1"] .p-prepost');
  assert.ok(await s.bis(async () => (await s.projekt()).returns[0].pre === undefined), 'back to post removes the flag');
});

test('voll_meldung', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 4, s2: 4, s3: 4 }));
  const knopf = '.p-kette[data-strang="s4"] .p-ins-neu';
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(knopf)}).disabled`), true, 'the 13th compressor cannot be added');
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(knopf)}).title`), 'No free compressor');
  assert.match(await s.w(`document.querySelector('[data-p="inserts"] summary').textContent`), /12\/12/);
  assert.match(await s.w(`document.querySelector('[data-p="inserts"] summary').textContent`), /No free compressor/, 'the message is visible text, not only a tooltip (phone)');
  // negative control: with a free slot the button works and says what it does
  const s2 = await seite(t, projekt({ s1: 4, s2: 4, s3: 3 }));
  assert.equal(await s2.w(`document.querySelector(${JSON.stringify(knopf)}).disabled`), false);
  assert.equal(await s2.w(`document.querySelector(${JSON.stringify(knopf)}).title`), 'Add a compressor');
  assert.doesNotMatch(await s2.w(`document.querySelector('[data-p="inserts"] summary').textContent`), /No free/, 'a free slot: no message');
});

test('popover_aendert_param_live', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }));
  assert.equal(await zaehle(s, '.p-ins-popover'), 0, 'closed by default');
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  assert.equal(await zaehle(s, '.p-ins-popover[data-insert="i1"] .p-ins-param'), KOMP_PARAMETER.length, 'one slider per parameter');
  const aend = async () => (await (await fetch(`${s.url}attrappe/aenderungen`)).json());
  await s.w(`(() => { const e = document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-param[data-param="schwelle"]'); e.value = '-30'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.schwelle === -30), 'the value reached the project');
  assert.deepEqual((await aend()).at(-1).befehle, ['insert_param_setzen']);
  assert.equal((await aend()).at(-1).wiedergabe, false, 'live: no new playback');
  assert.equal(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-wert[data-param="schwelle"]').textContent`), '-30.0 dB');
  // bypass is live as well
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-an');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].an === false), 'bypass reached the project');
  assert.deepEqual((await aend()).at(-1).befehle, ['insert_an']);
  assert.equal((await aend()).at(-1).wiedergabe, false, 'bypass: no new playback');
  // positive control: a structure change (a second stage) does make a new playback
  await s.b.klick('.p-kette[data-strang="s1"] .p-ins-neu');
  assert.ok(await s.bis(async () => (await aend()).at(-1).befehle[0] === 'insert_setzen'), 'insert_setzen arrived');
  assert.equal((await aend()).at(-1).wiedergabe, true, 'insert_setzen is a structure change: a new playback');
});

test('strips_ohne_inserts_dom_gleich: heads of tracks and groups and the master are identical to the page before the slice', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  const dom = await s.w(`({
    koepfe: [...document.querySelectorAll('[data-p="koepfe"] .p-kopf')].map((e) => e.outerHTML),
    gruppen: [...document.querySelectorAll('[data-p="mixer-gruppen"] .p-kopf')].map((e) => e.outerHTML),
    master: document.querySelector('.p-pm').outerHTML })`);
  if (process.env.GOLDEN_SCHREIBEN) fs.writeFileSync(GOLDEN, JSON.stringify(dom, null, 1));
  assert.ok(dom.koepfe.length === 4 && dom.gruppen.length === 1);
  assert.deepEqual(dom, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
});

test('inserts.js: gain-reduction readings (/e/ins_gr): taken per slot, clamped, a stale reading is none, foreign addresses and junk are refused', () => {
  const g = {};
  assert.equal(INS_GR_FRIST_MS, 500);
  assert.equal(insGrAufnehmen(g, { kanal: 'ins/komp/3', gr_db: 4.5 }, 1000), true);
  assert.equal(insGrAufnehmen(g, { kanal: 'ins/komp/12', gr_db: -2 }, 1000), true);
  assert.equal(insGrLesung(g, 3, 1100), 4.5);
  assert.equal(insGrLesung(g, 12, 1100), 0, 'a negative reading is clamped to 0');
  assert.equal(insGrLesung(g, 3, 1500), null, 'older than 500 ms: no reading');
  assert.equal(insGrLesung(g, 4, 1100), null, 'never reported');
  assert.equal(insGrAblaufIn(g, 1100), 400);
  assert.equal(insGrAblaufIn(g, 1600), null);
  for (const f of [{ kanal: 'ins/komp/0', gr_db: 1 }, { kanal: 'ins/komp/13', gr_db: 1 }, { kanal: 'bus/1', gr_db: 1 }, { kanal: 'ins/komp/2', gr_db: NaN },
    { kanal: 'ins/komp/2', gr_db: '3' }, { gr_db: 1 }, null]) assert.equal(insGrAufnehmen(g, f, 1000), false, JSON.stringify(f));
  assert.equal(g[2], undefined, 'nothing was taken for slot 2');
  assert.equal(insGrText(null), '–'); assert.equal(insGrText(4.46), '4.5 dB');
});

test('gr_zeigt_absenkung_je_stufe: /e/ins_gr shows on the stage with that slot, falls back to "-" without a message, other stages stay "-"', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1, g1: 1 }));
  const text = (id) => s.w(`document.querySelector('.p-stufe[data-insert="${id}"] .p-ins-gr').textContent`);
  assert.equal(await text('i1'), '–', 'no reading before the first message');
  await s.post('/attrappe/sse', { a: '/e/ins_gr', f: { kanal: 'ins/komp/1', gr_db: 6.04 } });
  assert.ok(await s.bis(async () => (await text('i1')) === '6.0 dB'), 'stage i1 (slot 1) shows its reduction');
  assert.equal(await text('i2'), '–', 'negative control: the stage of slot 2 got no message');
  assert.equal(await s.w(`document.querySelector('.p-stufe[data-insert="i1"] .p-ins-gr').classList.contains('wirkt')`), true);
  assert.ok(await s.bis(async () => (await text('i1')) === '–', 1500), 'no message for 500 ms: back to the dash');
});

// ---- slice 4b T12: the eq and saturator parts of the page --------------------------------------------------------------------------------------
const vertragWerte = (art) => INSERT_ARTEN[art].parameter.filter((q) => q.name !== 'an' && q.name !== 'sc');
test('inserts.js 4b: the literal saturator and EQ tables equal the generated contract (range, default, unit, integer steps), all eight bands', () => {
  assert.deepEqual(SAETT_PARAMETER.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), vertragWerte('saett').map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]));
  assert.equal(MAX_EQ, INSERT_ARTEN.eq.instanzen); assert.equal(MAX_SAETT, INSERT_ARTEN.saett.instanzen);
  assert.deepEqual(LIM_PARAMETER.map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]), vertragWerte('lim').map((q) => [q.name, q.min, q.max, q.vorgabe, q.einheit]));
  assert.equal(MAX_LIM, INSERT_ARTEN.lim.instanzen);
  const eq = Object.fromEntries(vertragWerte('eq').map((q) => [q.name, q]));
  for (const q of EQ_KOPF_PARAMETER) assert.deepEqual([q.min, q.max, q.vorgabe, q.einheit], [eq[q.name].min, eq[q.name].max, eq[q.name].vorgabe, eq[q.name].einheit], q.name);
  assert.equal(EQ_BAENDER, 8);
  for (let m = 1; m <= EQ_BAENDER; m++) {
    for (const q of EQ_BAND_PARAMETER) {
      const v = eq[`b${m}/${q.name}`], l = parameterVon('eq', `b${m}/${q.name}`);
      assert.ok(v, `b${m}/${q.name} is in the contract`);
      assert.deepEqual([l.min, l.max, l.vorgabe, l.einheit], [v.min, v.max, v.vorgabe, v.einheit], `b${m}/${q.name}`);
      assert.equal(q.typ === 'wahl' || q.typ === 'schalter' || q.name === 'typ', v.ganz, `${q.name}: a select or switch is an integer row`);
    }
  }
  assert.equal(Object.keys(eq).length, EQ_KOPF_PARAMETER.length + EQ_BAENDER * EQ_BAND_PARAMETER.length, 'the page offers every row of the contract, no more');
  assert.deepEqual(EQ_BAND_TYP_VORGABE, [1, 2, 3, 4, 5, 6, 7, 8].map((m) => eq[`b${m}/typ`].vorgabe));
  assert.deepEqual(EQ_BAND_FREQ_VORGABE, [1, 2, 3, 4, 5, 6, 7, 8].map((m) => eq[`b${m}/freq`].vorgabe));
  assert.equal(EQ_TYPEN.length, eq['b1/typ'].max + 1); assert.equal(EQ_STEIL.length, eq['b1/steil'].max + 1); assert.equal(EQ_PLATZ.length, eq['b1/platz'].max + 1);
});

test('inserts.js 4b: the log frequency slider maps both ends exactly and round-trips; value texts; pool counts per kind', () => {
  assert.equal(freqVonPos(0), 10); assert.ok(Math.abs(freqVonPos(POS_MAX) - 22000) < 1e-6);
  for (const f of [10, 30, 100, 1000, 2500, 18000, 22000]) assert.ok(Math.abs(freqVonPos(posVonFreq(f)) / f - 1) < 0.01, `${f} Hz survives the slider`);
  assert.equal(posVonFreq(5), 0, 'below the range clamps'); assert.equal(posVonFreq(99999), POS_MAX);
  assert.equal(wertText('eq', 'b1/typ', 3), 'Low cut'); assert.equal(wertText('eq', 'b2/steil', 1), '24 dB/oct'); assert.equal(wertText('eq', 'b3/platz', 2), 'Side');
  assert.equal(wertText('eq', 'b4/freq', 2500), '2.50 kHz'); assert.equal(wertText('eq', 'b4/freq', 80), '80.0 Hz'); assert.equal(wertText('eq', 'b4/q', 0.707), '0.71');
  assert.equal(wertText('eq', 'propq', 1), 'on'); assert.equal(wertText('saett', 'mix', 0.5), '50 %'); assert.equal(wertText('saett', 'drive', 12), '12.0 dB');
  assert.equal(wertText('komp', 'ratio', 4), '4.0:1', 'the compressor keeps its 4a texts');
  assert.throws(() => wertText('eq', 'b9/gain', 0)); assert.throws(() => wertText('saett', 'schwelle', 0));
  assert.equal(wertText('lim', 'decke', -1), '-1.0 dB'); assert.equal(wertText('lim', 'abklingen', 80), '80 ms');
  assert.throws(() => wertText('lim', 'schwelle', 0));
  const p1 = projekt({ s1: 1 }, 'eq');
  assert.deepEqual([anzahl(p1, 'eq'), frei(p1, 'eq')], [1, 1], 'one EQ placed, one left in the pool of two');
  assert.deepEqual(neuerInsertBefehl(p1, 's1', 'eq'), { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'eq' }, 'negative control: the second EQ is offered');
  const p = projekt({ s1: 2 }, 'eq');
  assert.deepEqual([anzahl(p, 'eq'), frei(p, 'eq'), anzahl(p, 'komp'), frei(p, 'komp'), frei(p, 'saett')], [2, 0, 0, 12, 1]);
  assert.equal(neuerInsertBefehl(p, 's1', 'eq'), null, 'the pool of two EQs is empty');
  assert.deepEqual(neuerInsertBefehl(p, 's1', 'saett'), { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'saett' });
  assert.deepEqual(neuerInsertBefehl(p, 's1'), { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'komp' }, 'the default kind is the compressor');
  assert.equal(neuerInsertBefehl(p, 's1', 'bk'), null, 'an unknown kind');
  assert.deepEqual(Object.keys(ARTEN), ['komp', 'eq', 'saett', 'lim']);
  const pl = projekt({ s1: 1 }, 'lim');
  assert.deepEqual([anzahl(pl, 'lim'), frei(pl, 'lim')], [1, 0], 'the one limiter of the pool is placed');
  assert.equal(neuerInsertBefehl(pl, 's2', 'lim'), null, 'the pool of one limiter is empty');
  assert.notEqual(neuerInsertBefehl(pl, 's2', 'komp'), null, 'negative control: a compressor is still offered');
});

test('page 4b: production.js says the new reasons in words (art_unbekannt, ins_voll); the temporary pdc_fehlt is gone', () => {
  const t = fs.readFileSync(new URL('../public/production/production.js', import.meta.url), 'utf8');
  assert.doesNotMatch(t, /pdc_fehlt/);
  assert.match(t, /art_unbekannt: 'That insert kind is not available \(compressor, EQ, saturator and limiter exist/);
  assert.match(t, /ins_voll: 'All stages of that kind are in use/);
});

test('eq_popover_hat_acht_baender', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }, 'eq'));
  assert.equal(await s.w(`document.querySelector('.p-stufe[data-insert="i1"] .p-ins-name').textContent`), 'EQ');
  assert.equal(await zaehle(s, '.p-stufe[data-insert="i1"] .p-ins-gr'), 0, 'an EQ has no gain reduction readout');
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  assert.equal(await zaehle(s, '.p-ins-popover[data-insert="i1"] .p-ins-band'), 8, 'eight band blocks');
  assert.equal(await zaehle(s, '.p-ins-popover[data-insert="i1"] .p-ins-param'), EQ_KOPF_PARAMETER.length + 8 * EQ_BAND_PARAMETER.length, '2 + 8 x 7 controls');
  assert.equal(await zaehle(s, '.p-ins-popover[data-insert="i1"] .p-ins-sc'), 0, 'an EQ has no key');
  // a slider of band 3 sends b3/gain; the value reaches the project; live (no new playback)
  const aend = async () => (await (await fetch(`${s.url}attrappe/aenderungen`)).json());
  await s.w(`(() => { const e = document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-param[data-param="b3/gain"]'); e.value = '6'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte['b3/gain'] === 6), 'b3/gain reached the project');
  assert.deepEqual((await aend()).at(-1).befehle, ['insert_param_setzen']);
  assert.equal((await aend()).at(-1).wiedergabe, false);
  assert.equal(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-wert[data-param="b3/gain"]').textContent`), '6.0 dB');
  // the log frequency slider: a position in the middle gives the geometric mean of the ends, as an integer-free value in the project
  await s.w(`(() => { const e = document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-param[data-param="b5/freq"]'); e.value = '500'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => Math.abs((await s.projekt()).spuren[0].inserts[0].werte['b5/freq'] - Math.sqrt(10 * 22000)) < 1), 'b5/freq at slider position 500');
  // a select (band type) and a switch (band on) send integers
  await s.w(`(() => { const e = document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-param[data-param="b2/typ"]'); e.value = '5'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte['b2/typ'] === 5), 'b2/typ reached the project');
  await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-param[data-param="b4/an"]').click()`);   // band 4 is below the fold of the scrolling list
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte['b4/an'] === 1), 'the band switch sends 1');
  assert.equal(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-wert[data-param="b4/an"]').textContent`), 'on');
  // negative control: the other bands stayed at their defaults
  const w = (await s.projekt()).spuren[0].inserts[0].werte;
  assert.deepEqual([w['b1/gain'], w['b3/an'], w['b5/typ']], [0, 0, 0]);
});

test('saett_popover_hat_drei_regler', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }, 'saett'));
  assert.equal(await s.w(`document.querySelector('.p-stufe[data-insert="i1"] .p-ins-name').textContent`), 'SAT');
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  assert.equal(await zaehle(s, '.p-ins-popover[data-insert="i1"] .p-ins-param'), 3);
  await s.w(`(() => { const e = document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-param[data-param="drive"]'); e.value = '24'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.drive === 24), 'drive reached the project');
  assert.equal(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-wert[data-param="drive"]').textContent`), '24.0 dB');
});

test('neu_knoepfe_je_art_und_pool_voll', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await s.w(`document.querySelector('[data-p="inserts"]').open = true`);   // a project without inserts keeps the block closed
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-kette[data-strang="s1"] .p-ins-neu')].map((b) => b.textContent)`), ['+ Comp', '+ EQ', '+ Sat', '+ Lim']);
  assert.match(await s.w(`document.querySelector('[data-p="inserts"] summary').textContent`), /INSERTS \(0\/12\) · EQ 0\/2 · Sat 0\/1 · Lim 0\/1$/, 'no pool is full: no message');
  await s.b.klick('.p-kette[data-strang="s1"] .p-ins-neu[data-art="eq"]');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts?.[0]?.art === 'eq'), 'the EQ button placed an EQ');
  assert.ok(await s.bis(() => s.w(`/EQ 1\\/2/.test(document.querySelector('[data-p="inserts"] summary').textContent)`)), 'one of two EQs used');
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="s1"] .p-ins-neu[data-art="eq"]').disabled`), false, 'negative control: the second EQ is still offered');
  await s.b.klick('.p-kette[data-strang="s1"] .p-ins-neu[data-art="eq"]');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts?.[1]?.art === 'eq'), 'the EQ button placed the second EQ');
  assert.ok(await s.bis(() => s.w(`/No free EQ/.test(document.querySelector('[data-p="inserts"] summary').textContent)`)), 'the full EQ pool is said in the header');
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="s1"] .p-ins-neu[data-art="eq"]').disabled`), true);
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="s1"] .p-ins-neu[data-art="eq"]').title`), 'No free EQ');
  // negative control: the other two kinds are still offered on that strip
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="s1"] .p-ins-neu[data-art="saett"]').disabled`), false);
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="s1"] .p-ins-neu[data-art="komp"]').disabled`), false);
  assert.doesNotMatch(await s.w(`document.querySelector('[data-p="inserts"] summary').textContent`), /No free (compressor|saturator)/);
});

test('master_lim_knopf_legt_limiter_auf_den_master', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await s.w(`document.querySelector('[data-p="inserts"]').open = true`);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-kette[data-strang="master"] .p-ins-neu')].map((b) => b.textContent)`), ['+ Comp', '+ EQ', '+ Sat', '+ Lim']);
  await s.w(`document.querySelector('.p-kette[data-strang="master"]').scrollIntoView({ block: 'center' })`);   // the master row is the last: below the fold
  await s.b.klick('.p-kette[data-strang="master"] .p-ins-neu[data-art="lim"]');
  assert.ok(await s.bis(async () => (await s.projekt()).master.inserts?.[0]?.art === 'lim'), 'the Lim button placed a limiter on the master');
  assert.ok(await s.bis(() => s.w(`/Lim 1\\/1/.test(document.querySelector('[data-p="inserts"] summary').textContent)`)), 'the header counts the limiter');
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="s1"] .p-ins-neu[data-art="lim"]').disabled`), true);
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="s1"] .p-ins-neu[data-art="lim"]').title`), 'No free limiter');
  // negative control: the compressor button of a strip stays enabled
  assert.equal(await s.w(`document.querySelector('.p-kette[data-strang="s1"] .p-ins-neu[data-art="komp"]').disabled`), false);
  // the popover of the stage: ceiling and release move the value in the project
  await s.b.klick('.p-kette[data-strang="master"] .p-stufe .p-ins-name');
  assert.equal(await zaehle(s, '.p-ins-popover .p-ins-param'), 2, 'ceiling and release');
  await s.w(`(() => { const e = document.querySelector('.p-ins-popover .p-ins-param[data-param="decke"]'); e.value = '-3'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).master.inserts[0].werte.decke === -3), 'the ceiling reached the project');
});
