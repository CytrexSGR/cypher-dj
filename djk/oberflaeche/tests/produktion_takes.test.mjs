// 1.14 Comping slice 1, task 7: take rows on the production page. Pure parts (row table, derived highlight, copy rule) and the heads on the DOM stand-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPUR_HOEHE, LANE_HOEHE, TAKE_HOEHE, zeilenTabelle, zeilenHoehe, zeileBei, spurIndexBeiTabelle, takeZeile } from '../oeffentlich/produktion/layout.js';
import { takeZeilenVon, hatTakes, istTakeKopie, genutzteBereiche, vorhoerenKoerper, TAKE_TEXT } from '../oeffentlich/produktion/takes.js';
import { neueTakeKoepfe } from '../oeffentlich/produktion/takes_bedienung.js';
import { arrBild } from '../oeffentlich/produktion/zeitachse_bedienung.js';
import { TAKE_KOPIE_FIXTURES, T3_SPUR, T3_TEMPO, projektMit, audio } from './helfer/take_fixtures.mjs';

const audioSpur = (id, extra = {}) => ({
  id, nr: 1, name: id, art: 'audio', farbe: '#e0563b', clips: [], fader_db: 0, pan: 0, mute: false, solo: false, automation: [], ...extra,
});
const mitTakes = (id, n) => audioSpur(id, { takes: Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Take ${i + 1}`, clips: [] })) });

test('T7 rows: 3 takes + open automation: order track, t1, t2, t3, automation; heights 64/40/40/40/48', () => {
  assert.equal(TAKE_HOEHE, 40);
  const st = { projekt: projektMit([mitTakes('s1', 3)]), takeOffen: new Set(['s1']) };
  const tab = zeilenTabelle(1, [0], takeZeilenVon(st));
  assert.deepEqual(tab.map((z) => [z.art, z.spur, z.take, z.y, z.h]),
    [['spur', 0, undefined, 0, SPUR_HOEHE], ['take', 0, 0, 64, 40], ['take', 0, 1, 104, 40], ['take', 0, 2, 144, 40], ['lane', 0, undefined, 184, LANE_HOEHE]]);
  assert.equal(zeilenHoehe(tab), 64 + 3 * 40 + 48);
  assert.deepEqual(takeZeile(tab, 0, 1), tab[2]);
  assert.equal(takeZeile(tab, 0, 3), null);
  assert.equal(spurIndexBeiTabelle(tab, 70), -1, 'a click in a take row never hits a clip');
  assert.equal(zeileBei(tab, 150).art, 'take');
  assert.equal(zeileBei(tab, 190).art, 'lane', 'the automation row stays under the take rows');
});

test('T7 rows: closed T gives no take rows, and a project without takes gives the table of today (negative control)', () => {
  const mit = projektMit([mitTakes('s1', 3), audioSpur('s2')]);
  assert.equal(takeZeilenVon({ projekt: mit, takeOffen: new Set() }).size, 0, 'closed: no rows');
  assert.deepEqual(zeilenTabelle(2, [1], takeZeilenVon({ projekt: mit, takeOffen: new Set() })), zeilenTabelle(2, [1]), 'closed T: the table of today');
  // T open for ids in a project that carries no takes (an old file): still deep-equal to today
  const ohne = projektMit([audioSpur('s1'), audioSpur('s2', { takes: [] })]);
  const st = { projekt: ohne, takeOffen: new Set(['s1', 's2']) };
  assert.equal(takeZeilenVon(st).size, 0);
  for (const offen of [[], [0], [0, 1]]) {
    assert.deepEqual(zeilenTabelle(2, offen, takeZeilenVon(st)), zeilenTabelle(2, offen), `open lanes ${offen}`);
    assert.deepEqual(zeilenTabelle(2, offen, new Map()), zeilenTabelle(2, offen));
  }
  assert.equal(takeZeilenVon({ projekt: null, takeOffen: new Set(['s1']) }).size, 0, 'no project');
  assert.equal(takeZeilenVon({ projekt: ohne }).size, 0, 'no state at all');
  // the open rows follow the spur id and count the takes of that track only; a non-audio track never shows rows
  const gemischt = projektMit([mitTakes('s1', 2), mitTakes('s2', 3), { ...mitTakes('s3', 1), art: 'instrument' }]);
  assert.deepEqual([...takeZeilenVon({ projekt: gemischt, takeOffen: new Set(['s2', 's3']) })], [[1, 3]]);
  assert.equal(hatTakes(mitTakes('s1', 1)), true);
  assert.equal(hatTakes(audioSpur('s1')), false);
});

test('T7 rows: arrBild hands the take rows of the shown project to the arrangement', () => {
  const st = {
    projekt: projektMit([mitTakes('s1', 2)]), takeOffen: new Set(['s1']), laneOffen: new Set(), laneZiel: new Map(), ansicht: {}, start: 0, kopfBeat: null,
  };
  assert.deepEqual([...arrBild(st).takeZeilen], [[0, 2]]);
  st.projektEntwurf = projektMit([mitTakes('s1', 3)]);
  assert.deepEqual([...arrBild(st).takeZeilen], [[0, 3]], 'the draft is what is drawn');
});

test('T7 highlight: the T3 fixture marks take 2 [3,5) and take 3 [0,3) and [5,8); take 1 stays unused', () => {
  assert.deepEqual(genutzteBereiche(T3_SPUR, T3_TEMPO), [
    { take_id: 't2', von: 3, bis: 5 }, { take_id: 't3', von: 0, bis: 3 }, { take_id: 't3', von: 5, bis: 8 }]);
  // mutation: a moved main clip (start shifted, content kept) stops highlighting
  const bewegt = { ...T3_SPUR, clips: T3_SPUR.clips.map((c) => (c.id === 'm2' ? { ...c, start_beat: 3.5 } : c)) };
  assert.deepEqual(genutzteBereiche(bewegt, T3_TEMPO).map((r) => r.take_id), ['t3', 't3'], 'take 2 is no longer used');
  // negative control: without a main lane nothing is used, without takes nothing at all
  assert.deepEqual(genutzteBereiche({ ...T3_SPUR, clips: [] }, T3_TEMPO), []);
  assert.deepEqual(genutzteBereiche({ ...T3_SPUR, takes: undefined }, T3_TEMPO), []);
  // touching copies of one take merge into one region; a part of a main clip counts only where it overlaps the take clip
  const geteilt = { ...T3_SPUR, clips: [audio('m1', 'C', 0, 2, 0), audio('m2', 'C', 2, 4, 1), audio('m3', 'C', 6, 4, 3)] };
  assert.deepEqual(genutzteBereiche(geteilt, T3_TEMPO), [{ take_id: 't3', von: 0, bis: 8 }], 'merged, cut at the end of the take clip (8)');
  // a loop clip is never highlighted
  const schleife = { ...T3_SPUR, clips: [audio('m1', 'C', 0, 8, 0, { loop_beats: 4 })] };
  assert.deepEqual(genutzteBereiche(schleife, T3_TEMPO), []);
});

test('T7 highlight: warp clips compare versatz_beats and equal markers (review round 1)', () => {
  const marker = [[0, 0], [4, 8]];
  const w = (versatz, m = marker) => ({ an: true, marker: m, versatz_beats: versatz });
  const spur = (haupt) => ({ ...audioSpur('s1'), clips: [haupt], takes: [{ id: 't1', name: 'Take 1', clips: [audio('c1', 'A', 0, 8, 0, { warp: w(0) })] }] });
  assert.deepEqual(genutzteBereiche(spur(audio('m1', 'A', 3, 5, 0, { warp: w(3) })), 120), [{ take_id: 't1', von: 3, bis: 8 }]);
  assert.deepEqual(genutzteBereiche(spur(audio('m1', 'A', 3, 5, 1.5, { warp: w(0) })), 120), [], 'offset_s would match, versatz does not');
  assert.deepEqual(genutzteBereiche(spur(audio('m1', 'A', 3, 5, 0, { warp: w(3, [[0, 0], [4, 7]]) })), 120), [], 'other markers');
});

test('T7 copy rule: the page istTakeKopie gives the verdict of every fixture (the cross test against projekt/takes.ts imports the same list)', () => {
  assert.ok(TAKE_KOPIE_FIXTURES.length >= 12);
  assert.ok(TAKE_KOPIE_FIXTURES.some((f) => f.erwartet) && TAKE_KOPIE_FIXTURES.some((f) => !f.erwartet), 'both verdicts are present');
  for (const f of TAKE_KOPIE_FIXTURES) assert.equal(istTakeKopie(f.haupt, f.take, f.bpm), f.erwartet, f.name);
  assert.equal(istTakeKopie({ art: 'midi', id: 'x' }, audio('c1', 'A', 0, 8, 0), 120), false, 'a MIDI clip is no copy');
});

test('T7 audition: the body toggles the lit take off and any other on', () => {
  assert.deepEqual(vorhoerenKoerper({}, 's1', 't1'), { spur_id: 's1', take_id: 't1' });
  assert.deepEqual(vorhoerenKoerper({ s1: 't1' }, 's1', 't1'), { spur_id: 's1', take_id: null }, 'lit: off');
  assert.deepEqual(vorhoerenKoerper({ s1: 't1' }, 's1', 't2'), { spur_id: 's1', take_id: 't2' }, 'another take of the track');
  assert.deepEqual(vorhoerenKoerper({ s2: 't1' }, 's1', 't1'), { spur_id: 's1', take_id: 't1' }, 'another track audibles on its own');
  assert.deepEqual(vorhoerenKoerper(null, 's1', 't1'), { spur_id: 's1', take_id: 't1' });
});

// ---- the heads on the DOM stand-in ----
const { installiere, El } = await import('./helfer/seiten_attrappe.mjs');
const baueKoepfe = (opt = {}) => {
  installiere();
  const gesendet = [], aenderungen = [], menues = [];
  const vorhoeren = opt.vorhoeren ?? {};
  const k = neueTakeKoepfe({
    vorhoeren: () => vorhoeren, sende: async (b) => { gesendet.push(b); }, aendere: (label, befehle) => { aenderungen.push([label, befehle]); },
    menue: (punkte, x, y) => menues.push({ punkte, x, y }),
  });
  return { k, gesendet, aenderungen, menues, vorhoeren };
};

test('T7 heads: name, speaker and the one-POST audition toggle', async () => {
  const { k, gesendet, vorhoeren } = baueKoepfe();
  k.begin();
  const [e1, e2, e3] = k.fuer(T3_SPUR);
  k.ende();
  assert.deepEqual([e1, e2, e3].map((e) => e.querySelector('.p-takename').textContent), ['Take 1', 'Take 2', 'Take 3']);
  assert.deepEqual([e1, e2, e3].map((e) => e.dataset.take), ['t1', 't2', 't3']);
  assert.equal(e2.querySelector('.p-takehoer').getAttribute('aria-pressed'), 'false');
  e2.querySelector('.p-takehoer').click();
  assert.deepEqual(gesendet, [{ spur_id: 's1', take_id: 't2' }], 'exactly one POST body');
  // the server answered, the page reloaded /proj/aktuell: the map says t2 is lit and the head shows it
  await new Promise((r) => setImmediate(r));   // the answer is there: the button is unlocked
  vorhoeren.s1 = 't2';
  k.begin(); k.fuer(T3_SPUR); k.ende();
  assert.equal(e2.querySelector('.p-takehoer').getAttribute('aria-pressed'), 'true');
  assert.ok(e2.classList.contains('an'));
  assert.equal(e1.querySelector('.p-takehoer').getAttribute('aria-pressed'), 'false', 'only the lit take');
  e2.querySelector('.p-takehoer').click();
  assert.deepEqual(gesendet.at(-1), { spur_id: 's1', take_id: null });
  assert.equal(gesendet.length, 2, 'one POST per click');
});

test('T7 heads: rename by double click commits one take_umbenennen, Escape and an unchanged name send nothing', () => {
  const { k, aenderungen } = baueKoepfe();
  k.begin(); const [e1] = k.fuer(T3_SPUR); k.ende();
  const name = e1.querySelector('.p-takename');
  name.dispatch('dblclick');
  const ein = e1.querySelector('.p-takefeld');
  assert.ok(ein, 'an input replaces the name');
  ein.value = ' Keeper ';
  ein.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(aenderungen, [['Rename take lane', [{ befehl: 'take_umbenennen', spur_id: 's1', take_id: 't1', name: 'Keeper' }]]]);
  name.dispatch('dblclick');
  const ein2 = e1.querySelector('.p-takefeld');
  ein2.value = 'Nope';
  ein2.dispatch('keydown', { key: 'Escape' });
  name.dispatch('dblclick');
  e1.querySelector('.p-takefeld').dispatch('keydown', { key: 'Enter' });   // unchanged
  assert.equal(aenderungen.length, 1, 'negative control: Escape and an unchanged name change nothing');
});

test('T7 heads: context menu offers rename and delete take lane; delete sends take_loeschen', () => {
  const { k, aenderungen, menues } = baueKoepfe();
  k.begin(); const [, e2] = k.fuer(T3_SPUR); k.ende();
  let verhindert = false;
  e2.dispatch('contextmenu', { clientX: 30, clientY: 50, preventDefault() { verhindert = true; } });
  assert.equal(verhindert, true);
  assert.deepEqual(menues[0].punkte.map((p) => p.text), ['Rename take lane', 'Delete take lane', 'Use Whole Lane'], '1.14 slice 4 adds Use Whole Lane');
  assert.deepEqual([menues[0].x, menues[0].y], [30, 50]);
  menues[0].punkte[1].aktion();
  assert.deepEqual(aenderungen, [['Delete take lane', [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't2' }]]]);
});

test('T7 heads: the heads follow the takes of the track and are reused, a removed take loses its head', () => {
  const { k } = baueKoepfe();
  k.begin(); const a = k.fuer(T3_SPUR); k.ende();
  k.begin(); const b = k.fuer(T3_SPUR); k.ende();
  assert.deepEqual(b, a, 'same elements, no rebuild');
  const zwei = { ...T3_SPUR, takes: T3_SPUR.takes.slice(0, 2) };
  k.begin(); const c = k.fuer(zwei); k.ende();
  assert.equal(c.length, 2);
  assert.equal(a[2].parent, null, 'it is removed from the column, not just forgotten');
});

// ---- the heads in the head column: order and the T button ----
const { bindeKoepfe } = await import('../oeffentlich/produktion/spurkoepfe.js');
const koepfeAufbau = (st) => {
  installiere();
  const behaelter = new El('div');
  const gesten = { alleEnden() {}, verwirf() {}, verwerfeSpur() {}, ende() {}, wert() {} };
  const takeKoepfe = neueTakeKoepfe({ vorhoeren: () => st.vorhoeren ?? {}, sende: async () => {}, aendere: () => {}, menue: () => {} });
  const umgeschaltet = [];
  const k = bindeKoepfe(behaelter, { aendere: () => {}, aendereAus: () => {}, gesten, offen: () => st.laneOffen, takeOffen: () => st.takeOffen, takeKoepfe,
    takesUmschalten: (id) => umgeschaltet.push(id) });
  return { k, behaelter, umgeschaltet };
};
const klasse = (e) => (e.klassen.has('p-kopf') ? 'spur' : e.klassen.has('p-takekopf') ? `take:${e.dataset.take}` : e.klassen.has('p-lanenkopf') ? 'lane' : '?');

test('T7 heads: column order equals the row table (track, takes, automation lane); the T button shows only on audio tracks with takes', () => {
  const projekt = projektMit([mitTakes('s1', 3), audioSpur('s2'), { ...mitTakes('s3', 1), art: 'instrument' }]);
  const st = { laneOffen: new Set(['s1']), takeOffen: new Set(['s1']) };
  const { k, behaelter, umgeschaltet } = koepfeAufbau(st);
  k.zeige(projekt, true);
  const sollTab = zeilenTabelle(3, [0], takeZeilenVon({ projekt, takeOffen: st.takeOffen }));
  const dom = behaelter.elemente.map(klasse);
  assert.deepEqual(dom, ['spur', 'take:t1', 'take:t2', 'take:t3', 'lane', 'spur', 'spur']);
  assert.deepEqual(sollTab.map((z) => z.art), ['spur', 'take', 'take', 'take', 'lane', 'spur', 'spur'], 'the same order as the table');
  const t = (id) => k.element(id).querySelector('.p-take');
  assert.equal(t('s1').hidden, false);
  assert.equal(t('s1').getAttribute('aria-pressed'), 'true');
  assert.equal(t('s2').hidden, true, 'audio track without takes');
  assert.equal(t('s3').hidden, true, 'instrument track');
  assert.ok(k.element('s1').classList.contains('hat-takes'));
  t('s1').click();
  assert.deepEqual(umgeschaltet, ['s1']);
  // closed: the take heads leave the column, the track keeps its button
  st.takeOffen = new Set();
  k.zeige(projekt);
  assert.deepEqual(behaelter.elemente.map(klasse), ['spur', 'lane', 'spur', 'spur']);
  assert.equal(t('s1').getAttribute('aria-pressed'), 'false');
  // negative control: a project without takes shows today's column
  const alt = projektMit([audioSpur('s1'), audioSpur('s2')]);
  st.takeOffen = new Set(['s1', 's2']);
  k.zeige(alt);
  assert.deepEqual(behaelter.elemente.map(klasse), ['spur', 'lane', 'spur']);
});

test('T7 texts are English: no German words or umlauts in the new files', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'oeffentlich', 'produktion');
  const texte = Object.values(TAKE_TEXT).join('\n');
  assert.doesNotMatch(texte, /[äöüÄÖÜß]/);
  assert.doesNotMatch(texte, /\b(und|oder|nicht|Spur|L[oö]schen|Umbenennen)\b/);
  assert.equal(TAKE_TEXT.knopf_titel, 'Show the take lanes of this track');
  for (const f of ['takes.js', 'takes_bedienung.js']) {
    const quelle = fs.readFileSync(path.join(dir, f), 'utf8');
    const strings = [...quelle.matchAll(/'([^'\n]{12,})'/g)].map((m) => m[1]).filter((s) => !/^[./\w-]+$/.test(s) && !s.startsWith('#'));
    for (const s of strings) assert.equal(/\b(und|oder|nicht)\b/.test(s), false, `${f}: ${s}`);
  }
});
