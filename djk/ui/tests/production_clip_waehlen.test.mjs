// SEQ v2 task 5: waehleClip (public/production/clip_waehlen.js), the jump of the SEQ place into PRODUCTION. The clip of a pattern sits in a track of the deck
// group, the group may be folded: waehleClip unfolds it with a project write and selects the clip only after that write has landed, because the real
// ctx.setzeAuswahl (clip_operation.js) gives the selection up as soon as a project arrives that does not hold the clip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuerClipWaehler, gefalteteGruppen } from '../public/production/clip_waehlen.js';
import { bindeClips } from '../public/production/clip_operation.js';
import { zeilenTabelle } from '../public/production/layout.js';
import { element, installiereDom } from './support/dom_mock.mjs';

// ---------- unfold, then select ----------
const gruppenProjekt = (innen, aussen) => ({ spuren: [{ id: 'sp', ausgang: { art: 'gruppe', id: 'gi' }, clips: [{ id: 'cl1' }] }, { id: 'so', ausgang: { art: 'gruppe', id: 'gx' }, clips: [{ id: 'cl9' }] }],
  gruppen: [{ id: 'gi', name: 'SEQ 2', gefaltet: innen, ausgang: { art: 'gruppe', id: 'ga' } }, { id: 'ga', name: 'Top', gefaltet: aussen }, { id: 'gx', name: 'Other', gefaltet: true }] });
const waehler = (st, opt = {}) => {
  const log = [];
  const w = neuerClipWaehler({ st, geladen: async () => { log.push('geladen'); await new Promise((r) => setTimeout(r, 5)); log.push('geladen-fertig'); if (opt.nachLaden) st.projekt = opt.nachLaden; },
    aendere: async (label, b) => { log.push(['aendere', label, b]); return opt.schreibenOk !== false; }, setzeAuswahl: (ids) => log.push(['auswahl', ids]), melde: (t, f) => log.push(['melde', t, f]) });
  return { w, log };
};

test('waehleClip on a folded group unfolds every folded group on the way up (one write), then selects the clip', async () => {
  const st = { projekt: gruppenProjekt(true, true) };
  const { w, log } = waehler(st);
  assert.equal(await w('cl1'), true);
  assert.deepEqual(log, ['geladen', 'geladen-fertig',
    ['aendere', 'Unfold group SEQ 2', [{ befehl: 'gruppenspur_aendern', gruppe_id: 'gi', gefaltet: false }, { befehl: 'gruppenspur_aendern', gruppe_id: 'ga', gefaltet: false }]],
    ['auswahl', ['cl1']]], 'the selection comes after the write, the group of another track stays folded');
});

test('waehleClip: nothing folded is no write; a refused write selects nothing; an unknown clip is a message; the project is the one the load left', async () => {
  const offen = waehler({ projekt: gruppenProjekt(false, false) });
  assert.equal(await offen.w('cl1'), true); assert.deepEqual(offen.log.slice(2), [['auswahl', ['cl1']]]);
  const teil = waehler({ projekt: gruppenProjekt(false, true) });
  await teil.w('cl1');
  assert.deepEqual(teil.log[2][2], [{ befehl: 'gruppenspur_aendern', gruppe_id: 'ga', gefaltet: false }], 'only the folded one');
  const nein = waehler({ projekt: gruppenProjekt(true, false) }, { schreibenOk: false });
  assert.equal(await nein.w('cl1'), false); assert.ok(!nein.log.some((x) => x[0] === 'auswahl'), 'a refused unfold leaves the selection alone');
  const fremd = waehler({ projekt: gruppenProjekt(false, false) });
  assert.equal(await fremd.w('gone'), false); assert.deepEqual(fremd.log.at(-1), ['melde', 'The pattern is not in the project shown here', true]);
  const leer = waehler({ projekt: null }, { nachLaden: gruppenProjekt(false, false) });
  assert.equal(await leer.w('cl1'), true, 'the project arrives with the load: the clip is looked up after it');
  assert.deepEqual(gefalteteGruppen({ gruppen: [{ id: 'a', gefaltet: true, ausgang: { art: 'gruppe', id: 'a' } }] }, { ausgang: { id: 'a' } }).length, 1, 'a cycle in a broken project ends');
});


// ---------- with the real selection of clip_operation.js ----------
function seiteMitAuswahl(start) {
  const ueber = Object.assign(element('canvas'), { getContext: () => ({}), focus() {} }), flaeche = element('div');
  const ctx = {
    st: { projekt: null, ansicht: { beat0: 0, pxProBeat: 10 }, raster: 'beat', slug: 'live' }, $: (n) => ({ ueber, flaeche })[n],
    beimProjekt: [], beimBild: [], vorBild: [], zeilen: () => zeilenTabelle(1), laufJetzt: () => null,
    aendereMit: async () => null, aendereAus: async () => null, aendere: async () => null, melde: () => {},
  };
  bindeClips(ctx);
  ctx.beimAuswahl.push((ids) => ctx.gewaehlt.push([...ids]));
  ctx.gewaehlt = [];
  const setze = (p) => { ctx.st.projekt = p; for (const h of ctx.beimProjekt) h(p, false); };   // what setzeProjekt does
  return { ctx, setze, start: start && (() => setze(start)) };
}

test('with the real selection: unfold, the new project arrives, then the clip is selected and the detail area is told (the piano roll opens from there)', async (t) => {
  t.after(installiereDom());
  const geladen = gruppenProjekt(true, true), entfaltet = gruppenProjekt(false, false);
  const { ctx, setze } = seiteMitAuswahl();
  const w = neuerClipWaehler({ st: ctx.st, geladen: async () => { setze(geladen); },   // the view switch started the load: the project is there when it is awaited
    aendere: async (label, b) => { assert.equal(b.length, 2); setze(entfaltet); return true; }, setzeAuswahl: (ids) => ctx.setzeAuswahl(ids), melde: () => {} });
  assert.equal(await w('cl1'), true);
  assert.deepEqual(ctx.st.auswahl, ['cl1']); assert.deepEqual(ctx.gewaehlt, [['cl1']]);
  // negative control: a selection made before the project has loaded is dropped by the arrival of the project that does not hold the clip yet
  const vor = seiteMitAuswahl();
  vor.ctx.setzeAuswahl(['cl1']);
  assert.deepEqual(vor.ctx.st.auswahl, ['cl1']);
  vor.setze({ spuren: [], gruppen: [] });
  assert.deepEqual(vor.ctx.st.auswahl, [], 'this is why waehleClip waits for the load');
});
