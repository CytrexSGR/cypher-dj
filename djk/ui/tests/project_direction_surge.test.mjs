// Package 1.9 U5 (O28 on Surge), T5.3: the Surge direction table (project/direction.ts SURGE_RICHTUNGEN), the command on a Surge track, and the session that reads
// the host's current values for a parameter the map does not hold yet. Spec 4.3: bright/dark cutoff, tight release and decay, aggressive/soft resonance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ladeVokabular } from '../presets/vocabulary.ts';
import { SURGE_RICHTUNGEN, SURGE_WORTE, richtungsWorte, wendeAn } from '../project/direction.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { wende } from '../project/patch.ts';
import { aendere } from '../project/history.ts';
import { kanonisch, neuesProjekt, pruefeFehler } from '../project/model.ts';
import { surgeBereich } from '../areas/proj/surge.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { sitzung, warteBis } from './support/proj_context.mjs';
import { falscherWirt, wirtOrdner, patchXml } from './support/surge_instrument_host.mjs';

const naeher = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const umfeld = (ist = {}, filter1An) => ({ bereich: surgeBereich, ist: (n) => ist[n] ?? null, ...(filter1An === undefined ? {} : { filter1An: () => filter1An }) });
const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const projekt = (parameter) => {
  let p = neuesProjekt('S');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', ...(parameter ? { parameter } : {}) } }], { surgeBereich }).projekt;
  return p;
};
const richtung = (p, wort, staerke, ist = {}, filter1An) => fuehreListeAus(p, [{ befehl: 'geraet_richtung', spur_id: 's1', wort, ...(staerke ? { staerke } : {}) }],
  { surgeBereich, surgeIst: (slot, n) => ist[n] ?? null, ...(filter1An === undefined ? {} : { surgeFilter1An: () => filter1An }) });

test('T5.3 table: the words of spec 4.3 for Surge, each a word of the closed vocabulary, each parameter in surge_bereiche.json, sorted word list', () => {
  assert.deepEqual(SURGE_WORTE, ['aggressive', 'bright', 'dark', 'soft', 'tight']);
  assert.deepEqual(richtungsWorte('surge'), SURGE_WORTE);
  const vok = ladeVokabular();
  for (const [wort, schritte] of Object.entries(SURGE_RICHTUNGEN)) {
    assert.ok(vok.inhalt.charakter.includes(wort), `${wort} is not in the vocabulary`);
    for (const s of schritte) assert.ok(surgeBereich(s.param) !== null, `${wort}: ${s.param}`);
  }
  const form = (w) => SURGE_RICHTUNGEN[w].map((s) => `${s.param}${s.vorzeichen > 0 ? '+' : '-'}`).join(' ');
  assert.equal(form('bright'), 'a_filter1_cutoff+');
  assert.equal(form('dark'), 'a_filter1_cutoff-');
  assert.equal(form('tight'), 'a_env1_release- a_env1_decay-');
  assert.equal(form('aggressive'), 'a_filter1_resonance+');
  assert.equal(form('soft'), 'a_filter1_resonance-');
});

test('T5.3 step: from the map when it holds the value, else from the host value; staerke multiplies; only the parameters of the word are written', () => {
  const s = SURGE_RICHTUNGEN.bright[0].schritt;
  const a = wendeAn('surge', { a_filter1_cutoff: 0 }, 'bright', 1, umfeld());
  assert.ok(naeher(a.parameter.a_filter1_cutoff, s));
  const b = wendeAn('surge', {}, 'bright', 2, umfeld({ a_filter1_cutoff: 3 }));
  assert.ok(naeher(b.parameter.a_filter1_cutoff, 3 + 2 * s), JSON.stringify(b));
  assert.deepEqual(Object.keys(b.parameter), ['a_filter1_cutoff']);
  const d = wendeAn('surge', { a_filter1_cutoff: 3, a_env1_release: 0 }, 'dark', 3, umfeld());
  assert.ok(naeher(d.parameter.a_filter1_cutoff, 3 - 3 * s));
  assert.equal(d.parameter.a_env1_release, 0, 'a parameter outside the word keeps its value');
  const t = wendeAn('surge', {}, 'tight', 1, umfeld({ a_env1_release: 0, a_env1_decay: -1 }));
  assert.deepEqual(Object.keys(t.parameter).sort(), ['a_env1_decay', 'a_env1_release']);
  assert.ok(t.parameter.a_env1_release < 0 && t.parameter.a_env1_decay < -1);
  const p = Object.freeze({ a_filter1_cutoff: 1 });
  wendeAn('surge', p, 'bright', 1, umfeld());
  assert.deepEqual(p, { a_filter1_cutoff: 1 }, 'the map passed in is not changed');
});

test('T5.3 AK-O4 bounds: a step never leaves the Surge range; repeated until the bound the last call is richtung_grenze without a change', () => {
  const [lo, hi] = surgeBereich('a_filter1_cutoff');
  assert.equal(wendeAn('surge', { a_filter1_cutoff: hi - 1 }, 'bright', 3, umfeld()).parameter.a_filter1_cutoff, hi, 'clamped at the top');
  assert.equal(wendeAn('surge', { a_filter1_cutoff: lo + 1 }, 'dark', 3, umfeld()).parameter.a_filter1_cutoff, lo, 'clamped at the bottom');
  let p = { a_filter1_resonance: 0.5 };
  let letzte = null, n = 0;
  for (; n < 60; n += 1) {
    const r = wendeAn('surge', p, 'aggressive', 1, umfeld());
    if ('grund' in r) { letzte = r; break; }
    assert.ok(r.parameter.a_filter1_resonance <= 1 && r.parameter.a_filter1_resonance >= 0);
    p = r.parameter;
  }
  assert.equal(letzte?.grund, 'richtung_grenze');
  assert.equal(p.a_filter1_resonance, 1);
  assert.ok(n > 1, 'it took more than one call');
  // tight: one of the two parameters at its bound, the other free: the free one still moves
  const t = wendeAn('surge', { a_env1_release: -8, a_env1_decay: 0 }, 'tight', 1, umfeld());
  assert.ok(!('grund' in t) && t.parameter.a_env1_release === -8 && t.parameter.a_env1_decay < 0);
});

test('T5.3 refusals: unknown word with the Surge list, bad staerke, an unknown start value (host silent) is wirt_wert_unbekannt, not a guess', () => {
  const u = wendeAn('surge', {}, 'deep', 1, umfeld());
  assert.equal(u.grund, 'richtung_unbekannt');
  for (const w of SURGE_WORTE) assert.match(u.text, new RegExp(w));
  assert.equal(wendeAn('surge', {}, 'constructor', 1, umfeld()).grund, 'richtung_unbekannt');
  for (const s of [0, 4, 1.5, '2', NaN]) assert.equal(wendeAn('surge', { a_filter1_cutoff: 0 }, 'bright', s, umfeld()).grund, 'argument_ungueltig');
  const stumm = wendeAn('surge', {}, 'bright', 1, umfeld());
  assert.equal(stumm.grund, 'wirt_wert_unbekannt');
  assert.match(stumm.text, /a_filter1_cutoff/);
  // negative control: with the value known the same call works
  assert.ok(!('grund' in wendeAn('surge', {}, 'bright', 1, umfeld({ a_filter1_cutoff: 3 }))));
});

test('T5.3 command on a Surge track: one undo step restores the device deep-equal (AK-O3 at model level), the freeze is discarded, the playback view changes', () => {
  const p = projekt({ a_filter1_cutoff: 3 });
  p.spuren[0].freeze = { datei: 'freeze-1-1.wav', frames: 10, kennung: 1, sha256: 'a'.repeat(64) };
  const r = richtung(p, 'dark', 2);
  assert.ok(naeher(r.projekt.spuren[0].geraet.parameter.a_filter1_cutoff, 3 - 2 * SURGE_RICHTUNGEN.dark[0].schritt));
  assert.equal(pruefeFehler(r.projekt), null);
  assert.equal(r.projekt.spuren[0].freeze, null);
  assert.equal(r.betrifft_wiedergabe, true);
  const zurueck = wende(r.projekt, r.zurueck);
  assert.equal(kanonisch(zurueck), kanonisch(p), 'the whole project is back');
  assert.equal(kanonisch(wende(zurueck, r.vor)), kanonisch(r.projekt), 'redo');
});

test('T5.3 command AK-O2: unknown word, no start value and a non-Surge device change nothing; bk and kit still know no word', () => {
  const p = projekt();
  const vorher = kanonisch(p);
  lehntAb(() => richtung(p, 'warm'), 'richtung_unbekannt');
  lehntAb(() => richtung(p, 'bright'), 'wirt_wert_unbekannt');
  lehntAb(() => richtung(p, 'dark', 4, { a_filter1_cutoff: 1 }), 'argument_ungueltig');
  assert.equal(kanonisch(p), vorher);
  assert.equal(grundCode('wirt_wert_unbekannt'), 409);
  assert.ok(GRUND_TEXT.wirt_wert_unbekannt, 'the server text of the reason');
  // negative control
  assert.ok(richtung(p, 'bright', 1, { a_filter1_cutoff: 1 }).projekt.spuren[0].geraet.parameter.a_filter1_cutoff > 1);
});

test('T5.3 session: a word on a Surge track reads the start value from the host (one ist per slot) and mirrors the result; the answer is the model move', async (t) => {
  const ordner = wirtOrdner(t);
  const h = falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3, a_env1_release: -1, a_env1_decay: -2 });
  const { s } = sitzung(t, { wirtOrdner: () => ordner });
  await s.neu('W', 'cypher');
  await s.aendern({ rev: 0, label: 'Lead', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }] }, 'cypher');
  const r = await s.aendern({ rev: 1, label: 'dark Lead', befehle: [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark', staerke: 2 }] }, 'cypher');
  assert.equal(r.code, 200);
  const soll = 3 - 2 * SURGE_RICHTUNGEN.dark[0].schritt;
  assert.ok(naeher(r.j.projekt.spuren[0].geraet.parameter.a_filter1_cutoff, soll));
  assert.ok(h.befehle.some((b) => b.befehl === 'ist' && b.namen.join() === 'a_filter1_cutoff'), 'the start value was read from the host');
  assert.ok(await warteBis(() => naeher(h.werte.a_filter1_cutoff, soll)), 'and the new value reached the host');
  // the map holds the value now: a second word does not read the host again
  h.befehle.length = 0;
  await s.aendern({ rev: 2, label: 'dark Lead', befehle: [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark' }] }, 'cypher');
  assert.ok(!h.befehle.some((b) => b.befehl === 'ist'), 'no read for a parameter the map holds');
  // undo twice: the host plays its own value again
  await s.umkehr('undo', { rev: 3 }, 'cypher');
  await s.umkehr('undo', { rev: 4 }, 'cypher');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 3), 'undo of both words brings the host back to its own 3');
});

test('T5.3 session: without a host the word is refused wirt_wert_unbekannt (409) and nothing is stored', async (t) => {
  const ordner = wirtOrdner(t);
  const { s } = sitzung(t, { wirtOrdner: () => ordner });
  await s.neu('W', 'cypher');
  await s.aendern({ rev: 0, label: 'Lead', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }] }, 'cypher');
  await assert.rejects(() => s.aendern({ rev: 1, label: 'dark Lead', befehle: [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark' }] }, 'cypher'),
    (e) => e.grund === 'wirt_wert_unbekannt');
  assert.equal(s.aktuell().j.projekt.rev, 1);
  // the host comes up: the same call works
  falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3 });
  const ok = await s.aendern({ rev: 1, label: 'dark Lead', befehle: [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark' }] }, 'cypher');
  assert.equal(ok.code, 200);
});

// Review fix (U5): the host read for a Surge word is an await inside /proj/aendern. The writers outside the queue (freeze, export, recording, stems)
// replace the open project synchronously through uebernimm and can land in that window; the caller's rev is stale then and the command must be
// refused (spec 6.31), not applied to the newer project.
const surgeSpur = async (s) => {
  await s.neu('W', 'cypher');
  await s.aendern({ rev: 0, label: 'Lead', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }] }, 'cypher');
};
const schreibeAusserhalb = (s, label) => {                       // what the S3 writers do: change the project and hand it to uebernimm
  const o = s.zugangOffen();
  const meta = { quelle: 'andreas', label };
  const w = aendere(o.verlauf, o.projekt, [{ befehl: 'spur_aendern', spur_id: 's1', name: label }], meta, s.zugangHaken());
  return { w, meta, fertig: s.uebernimm(w, meta) };
};

test('T5.3 review: a writer outside the queue lands while the host read of a Surge word is pending -> 409 rev_veraltet, the word is not applied', async (t) => {
  const ordner = wirtOrdner(t);
  const h = falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3 });
  const { s } = sitzung(t, { wirtOrdner: () => ordner });
  await surgeSpur(s);
  let los; h.halte = new Promise((r) => { los = r; });
  const p = s.aendern({ rev: 1, label: 'dark Lead', befehle: [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark' }] }, 'cypher').then((r) => ({ r }), (e) => ({ e }));
  assert.ok(await warteBis(() => h.befehle.some((b) => b.befehl === 'ist')), 'the host read is pending');
  const { fertig } = schreibeAusserhalb(s, 'Freeze');
  assert.equal(s.aktuell().j.projekt.rev, 2, 'the outside writer replaced the project');
  los();
  const { r, e } = await p;
  await fertig;
  assert.equal(r, undefined, `expected a refusal, got code ${r?.code}`);
  assert.deepEqual([e.code, e.grund ?? e.fehler, e.extra?.rev], [409, 'rev_veraltet', 2]);
  const proj = s.aktuell().j.projekt;
  assert.equal(proj.rev, 2, 'no third revision');
  assert.equal(proj.spuren[0].geraet.parameter?.a_filter1_cutoff, undefined, 'the word did not reach the map');
});

test('T5.3 review negative control: the same host delay without a writer in between applies the word (200)', async (t) => {
  const ordner = wirtOrdner(t);
  const h = falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3 });
  const { s } = sitzung(t, { wirtOrdner: () => ordner });
  await surgeSpur(s);
  let los; h.halte = new Promise((r) => { los = r; });
  const p = s.aendern({ rev: 1, label: 'dark Lead', befehle: [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark' }] }, 'cypher');
  assert.ok(await warteBis(() => h.befehle.some((b) => b.befehl === 'ist')));
  los();
  const r = await p;
  assert.equal(r.code, 200);
  assert.equal(r.j.projekt.rev, 2);
});

test('T5.3 review: uebernimm mirrors a changed Surge map into the host (the freeze, export, recording and stems writers go through it)', async (t) => {
  const ordner = wirtOrdner(t);
  const h = falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3 });
  const { s } = sitzung(t, { wirtOrdner: () => ordner });
  await surgeSpur(s);
  const o = s.zugangOffen();
  const meta = { quelle: 'andreas', label: 'S3' };
  const probe = fuehreListeAus(o.projekt, [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark' }],
    { surgeBereich, surgeIst: (slot, n) => ({ a_filter1_cutoff: 3 })[n] ?? null });
  const w = aendere(o.verlauf, o.projekt, [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark' }], meta, s.zugangHaken(), { ergebnis: probe });
  const soll = w.projekt.spuren[0].geraet.parameter.a_filter1_cutoff;
  assert.notEqual(soll, 3);
  h.befehle.length = 0;
  await s.uebernimm(w, meta);
  assert.ok(await warteBis(() => naeher(h.werte.a_filter1_cutoff, soll)), `the host got ${soll} through uebernimm`);
  assert.ok(h.fahrten().some(([n, v]) => n === 'a_filter1_cutoff' && naeher(v, soll)));
});

// Filter 1 off in the host's patch (Templates/Init Saw as the factory ships it: a_filter1_type 0): a word whose parameters all hang on filter 1 does nothing audible.
test('richtung_wirkungslos unit: bright/dark/aggressive/soft are refused when filter 1 is off, the parameters stay; filter 1 on, unknown and tight as before', () => {
  for (const wort of ['bright', 'dark', 'aggressive', 'soft']) {
    const eigene = { a_filter1_cutoff: 3, a_filter1_resonance: 0.5 };
    const vorher = JSON.stringify(eigene);
    const r = wendeAn('surge', eigene, wort, 1, umfeld({}, false));
    assert.equal(r.grund, 'richtung_wirkungslos', wort);
    assert.match(r.text, new RegExp(`^${wort} moves filter 1, and filter 1 is off in the patch this Surge host plays; load a patch with filter 1 on, or use another word`));
    assert.equal(JSON.stringify(eigene), vorher, 'input untouched');
    assert.ok('parameter' in wendeAn('surge', eigene, wort, 1, umfeld({}, true)), `${wort} with filter 1 on`);
    assert.ok('parameter' in wendeAn('surge', eigene, wort, 1, umfeld()), `${wort} with the filter state unknown is not blocked`);
  }
  const t = wendeAn('surge', { a_env1_release: 0, a_env1_decay: 0 }, 'tight', 1, umfeld({}, false));
  assert.ok('parameter' in t, 'tight moves the envelope, it works with filter 1 off');
  assert.equal(wendeAn('surge', {}, 'warm', 1, umfeld({}, false)).grund, 'richtung_unbekannt');
});

test('richtung_wirkungslos command: 409, project, rev and undo history unchanged; the reason has its text', () => {
  const p = projekt({ a_filter1_cutoff: 3 });
  const vorher = kanonisch(p);
  lehntAb(() => richtung(p, 'dark', 1, {}, false), 'richtung_wirkungslos');
  assert.equal(kanonisch(p), vorher);
  assert.equal(grundCode('richtung_wirkungslos'), 409);
  assert.ok(GRUND_TEXT.richtung_wirkungslos, 'the server text of the reason');
  assert.ok(richtung(p, 'dark', 1, {}, true).projekt, 'filter on: works');
  assert.ok(richtung(p, 'tight', 1, { a_env1_release: 0, a_env1_decay: 0 }, false).projekt, 'tight with filter off: works');
});

test('richtung_wirkungslos session: the stub host plays filter 1 off -> 409, rev and host unchanged; tight works; filter on works', async (t) => {
  const ordner = wirtOrdner(t);
  const h = falscherWirt(t, ordner, 1, { a_filter1_cutoff: 3, a_env1_release: -1, a_env1_decay: -2 });
  h.filter1Typ = 0;
  const { s } = sitzung(t, { wirtOrdner: () => ordner });
  await surgeSpur(s);
  const dunkel = { befehl: 'geraet_richtung', spur_id: 's1', wort: 'dark' };
  await assert.rejects(() => s.aendern({ rev: 1, label: 'dark Lead', befehle: [dunkel] }, 'cypher'),
    (e) => e.grund === 'richtung_wirkungslos' && grundCode(e.grund) === 409);
  assert.equal(s.aktuell().j.projekt.rev, 1, 'rev unchanged');
  assert.deepEqual(s.aktuell().j.projekt.spuren[0].geraet.parameter ?? {}, {}, 'project parameters unchanged');
  assert.equal(h.werte.a_filter1_cutoff, 3, 'the host plays what it played');
  assert.equal(h.fahrten().length, 0, 'nothing was sent to the host');
  const eng = await s.aendern({ rev: 1, label: 'tight Lead', befehle: [{ befehl: 'geraet_richtung', spur_id: 's1', wort: 'tight' }] }, 'cypher');
  assert.equal(eng.code, 200, 'tight does not depend on filter 1');
  h.filter1Typ = 1;
  const an = await s.aendern({ rev: 2, label: 'dark Lead', befehle: [dunkel] }, 'cypher');
  assert.equal(an.code, 200, 'filter 1 on: the word works');
});
