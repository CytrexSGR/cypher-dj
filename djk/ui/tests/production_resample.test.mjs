// 1.10 slice 7 (T7, spec 5.7, plan D6, D12): Resample on the page and limiter_db in proj_lage.
//  - pure: resampleBefehl, strangName, the shared head menu KOPF_MENUE (a second entry shows up: the 1.9 hook)
//  - the run frame of freeze_export.js with a DOM stand-in: the click posts {strang_id, punkt: 'post'}, the busy text "Resampling <name>" (never
//    "Exporting") from the own run and from ausgabe_lauf after a reload, with the core status 0 (the page stub) and 3 (the real core: a tap is a special
//    run like the freeze, Arrangement::sonderlauf), refusals show their reason text and leave no busy state behind
//  - the page in headless Chrome against the project stub: head menus of track, group, return and master, the matrix column
//  - proj_lage: kern.limiter_db from /zustand/arr, everything else byte-equal to a stored golden of the answer before T7 (D12)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bindeAusgabe } from '../public/production/freeze_export.js';
import { KOPF_MENUE, kopfMenuePunkte } from '../public/production/context_menu.js';
import { resampleBefehl, strangName } from '../public/production/resample.js';
import { laufText } from '../public/production/output.js';
import { fehlerText, FEHLER_TEXT } from '../public/production/production.js';
import { element, installiereDom } from './support/dom_mock.mjs';
import { starteSeite, warte, neuesProjekt } from '../check/page_mock.mjs';
import { fuehreListeAus } from '../project/commands.ts';
import { KernLage } from '../areas/proj/state.ts';
import { aufbau } from './support/output_setup.mjs';

const PROJEKT = { spuren: [{ id: 's2', name: 'Bass' }], gruppen: [{ id: 'g1', name: 'Drums' }], returns: [{ id: 'r1', name: 'Hall' }] };

// ---- pure ------------------------------------------------------------------------------------------------------------------------------
test('resampleBefehl: the strip id and the point post; a range only when given; no strip, no command', () => {
  assert.deepEqual(resampleBefehl({ id: 's2', name: 'Bass' }), { strang_id: 's2', punkt: 'post' });
  assert.deepEqual(resampleBefehl({ id: 'master', name: 'Master' }), { strang_id: 'master', punkt: 'post' });
  assert.deepEqual(resampleBefehl({ id: 'g1' }, { von_beat: 4, bis_beat: 12 }), { strang_id: 'g1', punkt: 'post', von_beat: 4, bis_beat: 12 });
  assert.equal(resampleBefehl(null), null, 'error case: nothing clicked');
  assert.equal(resampleBefehl({ name: 'x' }), null, 'error case: no id');
});

test('strangName: track, group, return, the master; unknown falls back to the id', () => {
  assert.deepEqual(['s2', 'g1', 'r1', 'master', 'x9'].map((i) => strangName(PROJEKT, i)), ['Bass', 'Drums', 'Hall', 'Master', 'x9']);
  assert.equal(strangName(null, 's2'), 's2');
});

test('laufText: resample says "Resampling <name>" with seconds when this page started it, never "Exporting"', () => {
  assert.equal(laufText({ art: 'resample', name: 'Bass', seit: null }, null, 9000), 'Resampling Bass');
  assert.equal(laufText({ art: 'resample', name: 'Bass', seit: 1000 }, { status: 3, projekt_beat: 4 }, 3500), 'Resampling Bass · 2 s');
  assert.doesNotMatch(laufText({ art: 'resample', name: 'Bass', seit: null }, { status: 3, projekt_beat: 4 }, 0), /Export/);
});

test('KOPF_MENUE: Resample for every strip kind and the master; a second registered entry appears (the 1.9 hook); none for no strip', () => {
  const ctx = { st: { spurWahl: new Set() } };
  for (const s of [{ id: 's2' }, { id: 'g1' }, { id: 'r1' }, { id: 'master' }]) assert.ok(kopfMenuePunkte(ctx, s).some((p) => p.text === 'Resample'), s.id);
  assert.deepEqual(kopfMenuePunkte(ctx, null), [], 'error case: no strip, no entry');
  const aufrufe = [];
  const zweiter = { text: 'MAKE RACK', zeige: (s) => s.id === 's2', aktion: (c, s) => aufrufe.push(s.id) };
  KOPF_MENUE.push(zweiter);
  try {
    assert.deepEqual(kopfMenuePunkte(ctx, { id: 's2' }).map((p) => p.text), ['Resample', 'MAKE RACK']);
    assert.deepEqual(kopfMenuePunkte(ctx, { id: 'g1' }).map((p) => p.text), ['Resample'], 'its own zeige decides');
    kopfMenuePunkte(ctx, { id: 's2' })[1].aktion();
    assert.deepEqual(aufrufe, ['s2']);
  } finally { KOPF_MENUE.splice(KOPF_MENUE.indexOf(zweiter), 1); }
  assert.deepEqual(kopfMenuePunkte(ctx, { id: 's2' }).map((p) => p.text), ['Resample']);
});

test('the Resample entry calls ctx.resample with the strip', () => {
  const gesehen = [];
  const e = kopfMenuePunkte({ st: {}, resample: (s) => gesehen.push(s) }, { id: 'g1', name: 'Drums' }).find((p) => p.text === 'Resample');
  e.aktion();
  assert.deepEqual(gesehen, [{ id: 'g1', name: 'Drums' }]);
});

// ---- the run frame (DOM stand-in) ------------------------------------------------------------------------------------------------------
function seite(t, holeJson) {
  const zurueck = installiereDom();
  t.after(zurueck);
  const el = { export: element('button'), ausgabe: element('output'), koepfe: element('div'), meldung: element('div') };
  const meldungen = [], nachfragen = [], posts = [];
  const ctx = {
    st: { projekt: PROJEKT, arr: null, slug: 'x' }, $: (n) => el[n], vorBild: [], beimProjekt: [], ladeAktuell: () => nachfragen.push(1),
    holeJson: async (weg, k) => { posts.push([weg, k]); return holeJson(weg, k); },
    melde: (text, fehler) => meldungen.push([text, !!fehler]), uebernimm: () => {}, antwortText: fehlerText,
  };
  bindeAusgabe(ctx);
  ctx.beimProjekt.forEach((f) => f(ctx.st.projekt, true));
  t.after(() => ctx.ausgabeLauf(null));
  const bild = () => { ctx.vorBild.forEach((f) => f(5000)); return el.ausgabe.textContent; };
  return { ctx, el, bild, meldungen, nachfragen, posts };
}
const ok = { rev: 3, spur_id: 's5', clip_id: 'c9', datei: '/x.wav', frames: 96000, quelle: 's2', punkt: 'post', von_beat: 0, bis_beat: 4 };

test('click: posts {strang_id, punkt: post}; busy text "Resampling Bass" during the run, locked, free afterwards with a toast and a reload of the project', async (t) => {
  let fertig; const offen = new Promise((r) => { fertig = r; });
  const s = seite(t, () => offen);
  const lauf = s.ctx.resample({ id: 's2', name: 'Bass' });
  assert.deepEqual(s.posts, [['/proj/resample', { strang_id: 's2', punkt: 'post' }]]);
  assert.match(s.bild(), /^Resampling Bass( · \d+ s)?$/);
  assert.equal(s.el.export.disabled, true, 'EXPORT locked while it runs');
  await s.ctx.resample({ id: 'g1', name: 'Drums' });
  assert.equal(s.posts.length, 1, 'a second resample during the run sends nothing');
  assert.deepEqual(s.meldungen.at(-1), ['A run is going on', true]);
  fertig({ status: 200, j: ok });
  await lauf;
  assert.equal(s.bild(), '');
  assert.equal(s.el.export.disabled, false);
  assert.deepEqual(s.meldungen.at(-1), ['Resampled Bass', false]);
  assert.equal(s.nachfragen.length, 1, 'the project is fetched again: the new track shows');
});

for (const status of [0, 3]) {
  test(`reload mid-run (ausgabe_lauf resample, core status ${status}): "Resampling Bass", EXPORT locked, free when the run is gone`, (t) => {
    const s = seite(t, async () => ({ status: 200, j: ok }));
    s.ctx.st.arr = { status, projekt_beat: 12 };
    s.ctx.ausgabeLauf({ art: 'resample', strang_id: 's2' });
    assert.equal(s.bild(), 'Resampling Bass', 'no bar position: the text hangs on the run, not on the core status');
    assert.equal(s.el.export.disabled, true);
    s.ctx.ausgabeLauf({ art: 'resample', strang_id: 'master' });
    assert.equal(s.bild(), 'Resampling Master', 'another strip: another text');
    s.ctx.ausgabeLauf(null);
    assert.equal(s.bild(), '');
    assert.equal(s.el.export.disabled, false);
  });
}

test('refusals show the reason text and leave no busy state: resample_leer, resample_fehler, transport_laeuft (error case: transport running)', async (t) => {
  const antworten = [
    [409, { fehler: 'resample_leer' }, FEHLER_TEXT.resample_leer],
    [502, { fehler: 'resample_fehler' }, FEHLER_TEXT.resample_fehler],
    [409, { fehler: 'transport_laeuft', text: 'the core is playing' }, 'Stop the transport first'],
  ];
  for (const [status, j, text] of antworten) {
    const s = seite(t, async () => ({ status, j }));
    const r = await s.ctx.resample({ id: 's2', name: 'Bass' });
    assert.equal(r, null);
    assert.deepEqual(s.meldungen.at(-1), [text, true], j.fehler);
    assert.equal(s.bild(), '', `${j.fehler}: no busy text left`);
    assert.equal(s.el.export.disabled, false, `${j.fehler}: not locked`);
    assert.equal(s.ctx.laufJetzt(), null, `${j.fehler}: no run left`);
    assert.equal(s.nachfragen.length, 0, 'nothing changed, nothing to fetch');
  }
});

// ---- the page --------------------------------------------------------------------------------------------------------------------------
const CHROME = fs.existsSync('/usr/bin/google-chrome');
const KLEIN = { skip: !CHROME && 'no google-chrome' };
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// Kick, Bass (notes in bars 1 and 2), group Music (Bass), return Hall
function projekt() {
  let p = neuesProjekt('Resample page');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }, { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern' } }]);
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }] },
    { befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2'] }, { befehl: 'return_neu', name: 'Hall' }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
const log = async (s) => (await (await fetch(`${s.url}attrappe/log`)).json());
const resamples = async (s, ab = 0) => (await log(s)).slice(ab).filter((e) => e.methode === 'POST' && e.weg === '/proj/resample');
async function seiteMit(t, ausgabe = { freezeMs: 1200 }) {
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne(); await s.saat(projekt());
  await fetch(`${s.url}attrappe/ausgabe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ausgabe) });
  return s;
}
const sicht = (s, sel) => s.w(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
const rechtsklick = async (s, sel) => {
  await sicht(s, sel); await warte(30);
  const m = await s.b.mitte(sel);
  await s.b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
  await s.b.maus('mousePressed', m.x, m.y, { button: 'right', buttons: 2 });
  await s.b.maus('mouseReleased', m.x, m.y, { button: 'right', buttons: 0 });
};
const menue = (s) => s.w(`[...document.querySelectorAll('.p-menue button')].map((b) => b.textContent)`);
const text = (s, sel) => s.w(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);

const KOEPFE = [['track head', '.p-kopf[data-spur="s2"]', 's2'], ['group head', '.p-gruppenkopf[data-gruppe="g1"]', 'g1'],
  ['return head', '.p-returnkopf[data-ret="r1"]', 'r1'], ['master block', '.p-pm', 'master']];
for (const [wie, sel, id] of KOEPFE) {
  test(`page: right click on the ${wie} offers Resample, the click posts {strang_id: ${id}, punkt: post}, the new track appears`, KLEIN, async (t) => {
    const s = await seiteMit(t);
    const n = (await log(s)).length;
    await rechtsklick(s, sel);
    assert.ok(await s.bis(async () => (await menue(s)).includes('Resample')), `the menu offers Resample: ${JSON.stringify(await menue(s))}`);
    await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent === 'Resample').click()`);
    assert.ok(await s.bis(async () => (await resamples(s, n)).length === 1), 'one request');
    assert.deepEqual((await resamples(s, n))[0].koerper, { strang_id: id, punkt: 'post' });
    assert.ok(await s.bis(async () => /^Resampling /.test((await text(s, '[data-p="ausgabe"]')) ?? '')), 'busy text shows during the run');
    assert.ok(await s.bis(async () => (await s.projekt()).spuren.some((x) => /\(resampled\)$/.test(x.name)), 6000), 'the new track is in the project');
    assert.ok(await s.bis(async () => (await text(s, '[data-p="ausgabe"]')) === ''), 'busy text gone');
  });
}

test('page: a reload in the middle of a resample still shows "Resampling Bass" (ausgabe_lauf), not "Exporting"', KLEIN, async (t) => {
  const s = await seiteMit(t, { freezeMs: 3000 });
  const n = (await log(s)).length;
  fetch(`${s.url}proj/resample`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ strang_id: 's2' }) }).catch(() => {});   // another client (Cypher)
  assert.ok(await s.bis(async () => (await resamples(s, n)).length === 1));
  await s.w('location.reload()');
  await warte(1500);
  await s.b.klick('[data-ansicht="produktion"]');
  assert.ok(await s.bis(async () => (await text(s, '[data-p="ausgabe"]')) === 'Resampling Bass'), `shown after the reload: ${await text(s, '[data-p="ausgabe"]')}`);
  assert.equal(await s.w(`document.querySelector('[data-p="export"]').disabled`), true);
  assert.ok(await s.bis(async () => (await text(s, '[data-p="ausgabe"]')) === '', 6000), 'gone when the run ends');
});

test('page: refusal on the page (silent strip): the reason text, no busy state, no track (error case)', KLEIN, async (t) => {
  const s = await seiteMit(t, { freezeMs: 200, fehler: 'resample_leer' });
  await rechtsklick(s, '.p-kopf[data-spur="s2"]');
  assert.ok(await s.bis(async () => (await menue(s)).includes('Resample')));
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent === 'Resample').click()`);
  assert.ok(await s.bis(async () => (await text(s, '[data-p="meldung"]')) === FEHLER_TEXT.resample_leer), `toast: ${await text(s, '[data-p="meldung"]')}`);
  assert.ok(await s.bis(async () => (await text(s, '[data-p="ausgabe"]')) === ''), 'no busy text left');
  assert.equal((await s.projekt()).spuren.some((x) => /resampled/.test(x.name)), false, 'no track');
});

test('page: the matrix has a RESAMPLE column with one button per row; a click posts the strip', KLEIN, async (t) => {
  const s = await seiteMit(t);
  await sicht(s, '[data-p="matrix"] > summary'); await s.b.klick('[data-p="matrix"] > summary');
  assert.ok(await s.bis(async () => (await s.w(`document.querySelectorAll('.p-mx-zeile').length`)) > 0), 'the matrix arrived');
  assert.equal(await text(s, '.p-mx-kopf-resample'), 'Resample');
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-mx-zeile')].map((e) => [e.dataset.strang, !!e.querySelector('.p-mx-resample')])`),
    [['s1', true], ['s2', true], ['g1', true], ['r1', true], ['master', true]]);
  const n = (await log(s)).length;
  await sicht(s, '.p-mx-resample[data-strang="g1"]'); await warte(30);
  await s.b.klick('.p-mx-resample[data-strang="g1"]');
  assert.ok(await s.bis(async () => (await resamples(s, n)).length === 1), 'one request');
  assert.deepEqual((await resamples(s, n))[0].koerper, { strang_id: 'g1', punkt: 'post' });
});

// ---- proj_lage: kern.limiter_db --------------------------------------------------------------------------------------------------------
const GOLDEN = JSON.parse(fs.readFileSync(new URL('./fixtures/proj_lage_vor_t7.json', import.meta.url), 'utf8'));
const ohneTmp = (o, tmp) => JSON.parse(JSON.stringify(o).split(tmp).join('<tmp>'));

test('KernLage: limiter_db comes from /zustand/arr; absent before any report', () => {
  const l = new KernLage();
  assert.equal(l.arr, null);
  const f = { nr: 3, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0 };
  l.nimm('/zustand/arr', { ...f, limiter_db: -3.5 });
  assert.equal(l.arr.limiter_db, -3.5);
  l.nimm('/e/neustart', { generation: 1 }); l.nimm('/e/neustart', { generation: 2 });
  assert.equal(l.arr, null, 'a new core knows nothing until it reports');
});

test('proj_lage view: kern.limiter_db is a number <= 0 with core state; everything else byte-equal to the golden of the answer before (D12)', async (t) => {
  const a = await aufbau(t, { tempo: 120, mitWirt: false });
  const bericht = (limiter_db) => a.vomKern('/zustand/arr', { nr: a.zustand.kernNr, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0,
    ...(limiter_db === undefined ? {} : { limiter_db }) });
  bericht(-2.5);
  const j = a.s.aktuell('noten_zahl').j;
  assert.equal(typeof j.kern.limiter_db, 'number');
  assert.ok(j.kern.limiter_db <= 0, 'a gain reduction is never positive');
  assert.equal(j.kern.limiter_db, -2.5);
  const rest = ohneTmp(j, a.tmp); delete rest.kern.limiter_db;
  assert.equal(JSON.stringify(rest), JSON.stringify(GOLDEN), 'byte-equal apart from kern.limiter_db');
  bericht(0);
  assert.equal(a.s.aktuell('noten_zahl').j.kern.limiter_db, 0, 'an idle limiter says 0, a number');
  assert.equal(typeof a.s.aktuell('voll').j.kern.limiter_db, 'number', 'the page view carries it too');
  // error cases: no core state, and a report from an older core without the field, name no number
  bericht(undefined);
  assert.equal('limiter_db' in a.s.aktuell('noten_zahl').j.kern, false, 'an old core (no field): absent, not 0');
  a.vomKern('/e/neustart', { generation: 2 });
  assert.deepEqual(a.s.aktuell('noten_zahl').j.kern, { rev_geladen: null, status: null }, 'no core state: absent');
});
