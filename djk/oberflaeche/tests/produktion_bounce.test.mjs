// Package 1.14 slice 4 (bounce, N08), unit U3: the page parts of the bounce: clip menu items and their disabled reasons, the paste item at the
// grid-snapped beat, the action texts, the run text, ctx.bounce (one POST /proj/bounce per item), the one-track merge item dropped (plan 3.1),
// and Use Whole Lane in the take head menu (plan 3.3). Pure functions and DOM stand-ins; the real-mouse probe is pruef/probe_bounce.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bouncePunkte, einfuegenPunkt, einfuegenBeiMaus, bounceAktion, bounceHuelle, BOUNCE_TEXT } from '../oeffentlich/produktion/bounce.js';
import { mergePunkte } from '../oeffentlich/produktion/merge.js';
import { laufText } from '../oeffentlich/produktion/ausgabe.js';
import { bindeAusgabe } from '../oeffentlich/produktion/freeze_export.js';
import { FEHLER_TEXT } from '../oeffentlich/produktion/produktion.js';
import { zeilenTabelle, SPUR_HOEHE } from '../oeffentlich/produktion/layout.js';
import { neueTakeKoepfe } from '../oeffentlich/produktion/takes_bedienung.js';
import { element, installiereDom } from './hilfen/dom_attrappe.mjs';
import { T3_SPUR } from './helfer/take_fixtures.mjs';

const au = (id, a, l, extra = {}) => ({ id, art: 'audio', start_beat: a, laenge_beats: l, dekodiert: 'fertig', ...extra });
const midi = (id, a, l) => ({ id, art: 'midi', start_beat: a, laenge_beats: l, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] });
const spur = (id, art, clips, extra = {}) => ({ id, art, name: id.toUpperCase(), clips, ...extra });
const projekt = (extra = {}) => ({ loop: { an: false, von_beat: 0, bis_beat: 32 }, spuren: [
  spur('s1', 'audio', [au('c1', 4, 8), au('c2', 20, 4.5)]), spur('s2', 'audio', [au('c3', 8, 8)]),
  spur('s3', 'instrument', [midi('m1', 0, 4)], { geraet: { art: 'intern' } }), spur('s4', 'audio', []),
], ...extra });
const nach = (punkte) => Object.fromEntries(punkte.map((p) => [p.id, p]));

test('3.1 bounceHuelle (spec D4): floor/ceil with EPS, null without clips', () => {
  assert.deepEqual(bounceHuelle([au('a', 0.5, 7), au('b', 4, 4 + 1e-12)]), { von_beat: 0, bis_beat: 8 });
  assert.equal(bounceHuelle([]), null);
});

test('3.1 bouncePunkte, one track: Bounce Track in Place, Bounce to New Track (range in the text), Copy for Bounced Paste; no merge item', () => {
  const p = projekt(), c = p.spuren[0].clips[0];
  const punkte = bouncePunkte(p, ['c1'], c, null);
  assert.deepEqual(punkte.map((x) => x.id), ['an_ort', 'neue_spur', 'kopieren']);
  const x = nach(punkte);
  assert.deepEqual([x.an_ort.text, x.an_ort.aus, x.an_ort.koerper], [BOUNCE_TEXT.an_ort, false, { art: 'an_ort', spur_id: 's1' }]);
  assert.equal(x.neue_spur.text, 'Bounce to New Track (beats 4–24.5)');
  assert.deepEqual([x.neue_spur.aus, x.neue_spur.koerper], [false, { art: 'neue_spur', spur_ids: ['s1'], von_beat: 4, bis_beat: 24.5 }]);
  assert.deepEqual([x.kopieren.text, x.kopieren.aus, x.kopieren.ablage], [BOUNCE_TEXT.kopieren, false, { spur_ids: ['s1'], von_beat: 4, bis_beat: 24.5 }]);
  assert.deepEqual(mergePunkte(p, ['c1'], c, null), [], 'plan 3.1: no disabled one-track merge item any more');
  const loop = projekt({ loop: { an: true, von_beat: 8, bis_beat: 16 } });
  assert.deepEqual(nach(bouncePunkte(loop, ['c1'], loop.spuren[0].clips[0], null)).kopieren.ablage, { spur_ids: ['s1'], von_beat: 8, bis_beat: 16 },
    'the loop bracket when it is on');
});

test('3.1 both menus side by side, two tracks: Merge Tracks (enabled), Bounce Track in Place and Copy; no Bounce to New Track', () => {
  const p = projekt(), c = p.spuren[0].clips[0];
  const merge = mergePunkte(p, ['c1', 'c3'], c, null);
  assert.deepEqual(merge.map((x) => [x.id, x.aus]), [['merge', false]]);
  const b = bouncePunkte(p, ['c1', 'c3'], c, null);
  assert.deepEqual(b.map((x) => x.id), ['an_ort', 'kopieren']);
  assert.deepEqual(nach(b).an_ort.koerper, { art: 'an_ort', spur_id: 's1' }, 'in place is the track of the clicked clip');
  assert.deepEqual(nach(b).kopieren.ablage.spur_ids, ['s1', 's2']);
});

test('3.1 disabled reasons: instrument track, a running run, an undecoded clip, a hull over 1024 beats', () => {
  const p = projekt();
  const inst = nach(bouncePunkte(p, ['m1'], p.spuren[2].clips[0], null));
  assert.equal(inst.an_ort.aus, true, 'instrument track in place');
  assert.equal(inst.an_ort.grund, BOUNCE_TEXT.nur_audio);
  assert.equal(inst.neue_spur.aus, false, 'negative control: an RB-338 track can be bounced to a new track');
  const lauf = nach(bouncePunkte(p, ['c1'], p.spuren[0].clips[0], { art: 'export' }));
  assert.deepEqual([lauf.an_ort.aus, lauf.neue_spur.aus], [true, true]);
  const roh = projekt(); roh.spuren[0].clips[1].dekodiert = 'laeuft';
  assert.equal(nach(bouncePunkte(roh, ['c1'], roh.spuren[0].clips[0], null)).an_ort.aus, true, 'undecoded clip on the track');
  const lang = projekt(); lang.spuren[0].clips.push(au('c9', 2000, 4));
  const l = nach(bouncePunkte(lang, ['c1'], lang.spuren[0].clips[0], null));
  assert.equal(l.an_ort.aus, true, 'hull over 1024 beats'); assert.match(l.an_ort.grund, /1024/);
  const surge = projekt(); surge.spuren[2].geraet = { art: 'wirt' };
  assert.match(nach(bouncePunkte(surge, ['m1'], surge.spuren[2].clips[0], null)).neue_spur.grund, /Freeze/);
});

test('3.1 einfuegenPunkt: the paste item at the snapped beat, off for an instrument track and during a run; nothing without a copy', () => {
  const p = projekt(), ablage = { spur_ids: ['s1', 's2'], von_beat: 4, bis_beat: 12 };
  const x = einfuegenPunkt(p, ablage, 3, 33.3, 1, null);
  assert.deepEqual([x.id, x.text, x.aus], ['einfuegen', 'Paste Bounced Audio (beat 33)', false]);
  assert.deepEqual(x.koerper, { art: 'einfuegen', spur_ids: ['s1', 's2'], von_beat: 4, bis_beat: 12, ziel_spur_id: 's4', ziel_beat: 33 });
  assert.equal(einfuegenPunkt(p, ablage, 3, 33.3, 0.25, null).koerper.ziel_beat, 33.25, 'a finer grid');
  assert.equal(einfuegenPunkt(p, ablage, 3, 33.3, 0, null).koerper.ziel_beat, 33.3, 'grid off');
  assert.equal(einfuegenPunkt(p, ablage, 3, -0.4, 1, null).koerper.ziel_beat, 0, 'never before beat 0');
  const inst = einfuegenPunkt(p, ablage, 2, 8, 1, null);
  assert.deepEqual([inst.aus, inst.grund], [true, BOUNCE_TEXT.ziel_art]);
  assert.equal(einfuegenPunkt(p, ablage, 3, 8, 1, { art: 'merge' }).aus, true);
  assert.equal(einfuegenPunkt(p, null, 3, 8, 1, null), null, 'no copy: no item');
  assert.equal(einfuegenPunkt(p, ablage, -1, 8, 1, null), null, 'not on a track row');
  const weg = { ...ablage, spur_ids: ['s1', 'sX'] };
  assert.equal(einfuegenPunkt(p, weg, 3, 8, 1, null).aus, true, 'a copied track is gone');
});

test('3.2 einfuegenBeiMaus: the row from the row table, the beat from the view and the grid', () => {
  const p = projekt(), ablage = { spur_ids: ['s1'], von_beat: 4, bis_beat: 12 };
  const zeilen = zeilenTabelle(p.spuren.length);
  const ansicht = { beat0: 16, pxProBeat: 10 };
  const x = einfuegenBeiMaus(p, ablage, zeilen, ansicht, 72, 3 * SPUR_HOEHE + 5, 'beat', null);
  assert.deepEqual([x.koerper.ziel_spur_id, x.koerper.ziel_beat], ['s4', 23], 'x 72 px = beat 23.2, snapped to 23');
  assert.equal(einfuegenBeiMaus(p, ablage, zeilen, ansicht, 72, 100 * SPUR_HOEHE, 'beat', null), null, 'below the last row');
});

test('3.2 bounceAktion: one call per item, the texts, the reason text (never Rejected), Copy only stores', async () => {
  const meldungen = [], rufe = [];
  let ablage = null;
  const ctx = (antwort) => ({ bounce: async (k) => { rufe.push(k); return antwort; }, melde: (t, f) => meldungen.push([t, !!f]),
    fehlerText: (r) => FEHLER_TEXT[r.j.fehler], setzeBounceAblage: (a) => { ablage = a; } });
  await bounceAktion({ id: 'an_ort', koerper: { art: 'an_ort', spur_id: 's1' } }, ctx({ rev: 2, art: 'an_ort' }));
  await bounceAktion({ id: 'neue_spur', koerper: { art: 'neue_spur', spur_ids: ['s1'] } }, ctx({ rev: 3, art: 'neue_spur' }));
  await bounceAktion({ id: 'einfuegen', koerper: { art: 'einfuegen' } }, ctx({ rev: 4, art: 'einfuegen' }));
  await bounceAktion({ id: 'an_ort', koerper: { art: 'an_ort', spur_id: 's3' } }, ctx({ status: 409, j: { fehler: 'bounce_nur_audio' } }));
  await bounceAktion({ id: 'an_ort', koerper: { art: 'an_ort', spur_id: 's1' } }, ctx(null));
  assert.equal(rufe.length, 5, 'one call per item');
  await bounceAktion({ id: 'kopieren', ablage: { spur_ids: ['s1'], von_beat: 0, bis_beat: 4 } }, ctx({}));
  assert.equal(rufe.length, 5, 'copy sends nothing');
  assert.deepEqual(ablage, { spur_ids: ['s1'], von_beat: 0, bis_beat: 4 });
  assert.deepEqual(meldungen, [[BOUNCE_TEXT.fertig_an_ort, false], [BOUNCE_TEXT.fertig_neue_spur, false], [BOUNCE_TEXT.fertig_einfuegen, false],
    [FEHLER_TEXT.bounce_nur_audio, true], ['Copied 1 track (beats 0–4) for bounced paste: right click an empty spot of an audio track', false]]);
  assert.ok(!meldungen.some(([t]) => /Rejected/.test(t)));
});

test('3.2 run text Bouncing; ctx.bounce sends exactly one POST /proj/bounce with the body and takes the project over', async (t) => {
  assert.equal(laufText({ art: 'bounce', seit: 1000 }, null, 4000), 'Bouncing · 3 s');
  const zurueck = installiereDom();
  t.after(zurueck);
  const el = { export: element('button'), ausgabe: element('output'), koepfe: element('div'), meldung: element('div') };
  const posts = [], uebernommen = [];
  const ctx = {
    st: { projekt: { spuren: [] }, arr: null, slug: 'x' }, $: (n) => el[n], vorBild: [], beimProjekt: [], ladeAktuell: () => {},
    holeJson: async (weg, koerper) => { posts.push([weg, koerper]); return { status: 200, j: { rev: 5, projekt: { spuren: [] } } }; },
    melde: () => {}, uebernimm: (slug, p) => uebernommen.push(slug), antwortText: () => 'x',
  };
  bindeAusgabe(ctx);
  t.after(() => ctx.ausgabeLauf(null));
  const j = await ctx.bounce({ art: 'an_ort', spur_id: 's1' });
  assert.deepEqual(posts, [['/proj/bounce', { art: 'an_ort', spur_id: 's1' }]]);
  assert.deepEqual([j.rev, uebernommen], [5, ['x']]);
  ctx.ausgabeLauf({ art: 'bounce' });
  ctx.vorBild.forEach((f) => f(5000));
  assert.equal(el.ausgabe.textContent, 'Bouncing', 'a bounce of Cypher locks and shows the run');
  assert.equal(el.export.disabled, true);
});

test('3.1 every new reason has a page text', () => {
  for (const g of ['bounce_nur_audio', 'bounce_ziel_art', 'takes_voll', 'ersetzen_loop', 'gruppe_unbekannt', 'export_bereich']) {
    assert.ok(typeof FEHLER_TEXT[g] === 'string' && FEHLER_TEXT[g].length > 5, g);
  }
});

// ---- Use Whole Lane on the take heads (DOM stand-in of produktion_takes.test.mjs) ----
const { installiere } = await import('./helfer/seiten_attrappe.mjs');
const koepfe = () => {
  installiere();
  const aenderungen = [], menues = [];
  const k = neueTakeKoepfe({ vorhoeren: () => ({}), sende: async () => {}, aendere: (label, befehle) => { aenderungen.push([label, befehle]); },
    menue: (punkte, x, y) => menues.push({ punkte, x, y }) });
  return { k, aenderungen, menues };
};

test('3.3 Use Whole Lane: the third item of the take head menu sends exactly one comp_waehlen over the hull of the lane', () => {
  const { k, aenderungen, menues } = koepfe();
  const s = { ...T3_SPUR, takes: [...T3_SPUR.takes, { id: 't4', name: 'Before bounce', clips: [
    { ...T3_SPUR.takes[0].clips[0], id: 'c7', start_beat: 0.5, laenge_beats: 3 }, { ...T3_SPUR.takes[0].clips[0], id: 'c8', start_beat: 4, laenge_beats: 3.5 }] }] };
  k.begin(); const e = k.fuer(s); k.ende();
  e[3].dispatch('contextmenu', { clientX: 1, clientY: 2, preventDefault() {} });
  assert.deepEqual(menues[0].punkte.map((p) => p.text), ['Rename take lane', 'Delete take lane', 'Use Whole Lane']);
  assert.equal(menues[0].punkte[2].aus, false);
  menues[0].punkte[2].aktion();
  assert.deepEqual(aenderungen, [['Use Whole Lane', [{ befehl: 'comp_waehlen', spur_id: 's1', take_id: 't4', von_beat: 0, bis_beat: 8 }]]]);
});

test('3.3 negative control: an empty lane disables Use Whole Lane and sends nothing', () => {
  const { k, aenderungen, menues } = koepfe();
  const s = { ...T3_SPUR, takes: [{ id: 't1', name: 'Empty', clips: [] }] };
  k.begin(); const [e] = k.fuer(s); k.ende();
  e.dispatch('contextmenu', { clientX: 1, clientY: 2, preventDefault() {} });
  const ganz = menues[0].punkte[2];
  assert.equal(ganz.aus, true);
  ganz.aktion();
  assert.deepEqual(aenderungen, []);
});
