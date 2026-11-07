// Package 1.14 slice 4 (bounce): regression tests from the adversarial review (docs/b1-plaene/BERICHT-claude-bounce-adversarial-review-b3iyjl.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindeClips } from '../oeffentlich/produktion/clip_bedienung.js';
import { zeilenTabelle, SPUR_HOEHE } from '../oeffentlich/produktion/layout.js';
import { element, installiereDom } from './hilfen/dom_attrappe.mjs';

const au = (id, a, l) => ({ id, art: 'audio', start_beat: a, laenge_beats: l, dekodiert: 'fertig' });
const seite = (spuren) => ({ loop: { an: false, von_beat: 0, bis_beat: 32 }, spuren });

// bindeClips with just enough of ctx; rechtsklick(y) fires the context menu on the arrangement and says whether a menu was opened
function bindeSeite(p) {
  const ueber = Object.assign(element('canvas'), { getContext: () => ({}), focus() {} }), flaeche = element('div');
  const ctx = {
    st: { projekt: p, ansicht: { beat0: 0, pxProBeat: 10 }, raster: 'beat', slug: 'a' }, $: (n) => ({ ueber, flaeche })[n],
    beimProjekt: [], beimBild: [], vorBild: [], zeilen: () => zeilenTabelle(ctx.st.projekt.spuren.length), laufJetzt: () => null,
    aendereMit: async () => null, aendereAus: async () => null, aendere: async () => null, melde: () => {},
  };
  bindeClips(ctx);
  const wechsle = (slug, q) => { const w = slug !== ctx.st.slug; ctx.st.slug = slug; ctx.st.projekt = q; for (const h of ctx.beimProjekt) h(q, w); };
  const rechtsklick = (zeile) => {
    let offen = false;
    const e = { offsetX: 400, offsetY: zeile * SPUR_HOEHE + 5, clientX: 0, clientY: 0, preventDefault: () => { offen = true; } };
    try { for (const f of ueber.ereignisse.contextmenu) f(e); } catch { /* the DOM double has no full menu; preventDefault came first */ }
    return offen;
  };
  return { ctx, wechsle, rechtsklick };
}

test('review F1: a Copy for Bounced Paste does not survive a project switch (track ids repeat across projects)', (t) => {
  t.after(installiereDom());
  const p = seite([{ id: 's1', art: 'audio', name: 'A', clips: [au('c1', 0, 8)] }, { id: 's2', art: 'audio', name: 'B', clips: [] }]);
  const { ctx, wechsle, rechtsklick } = bindeSeite(p);
  ctx.setzeBounceAblage({ spur_ids: ['s1'], von_beat: 0, bis_beat: 8 });
  assert.equal(rechtsklick(1), true, 'control: in the same project the paste item opens on the empty track s2');
  wechsle('a', structuredClone(p));
  assert.equal(rechtsklick(1), true, 'control: a new state of the same project keeps the copy');
  // another project that also has tracks s1 and s2: the old copy would bounce its s1, a different track
  wechsle('b', seite([{ id: 's1', art: 'audio', name: 'Other', clips: [au('c9', 0, 4)] }, { id: 's2', art: 'audio', name: 'Z', clips: [] }]));
  assert.equal(rechtsklick(1), false, 'after a project switch there is no paste item');
});

test('review F2: Bounce to New Track tells when the source has content outside the range (hinweis quellen_laenger), like Merge Tracks', async () => {
  const { bounceAktion, BOUNCE_TEXT } = await import('../oeffentlich/produktion/bounce.js');
  const meldungen = [];
  const ctx = (antwort) => ({ bounce: async () => antwort, melde: (t) => meldungen.push(t), fehlerText: () => 'x', setzeBounceAblage: () => {} });
  const p = { id: 'neue_spur', koerper: { art: 'neue_spur', spur_ids: ['s1'], von_beat: 0, bis_beat: 7.66 } };
  await bounceAktion(p, ctx({ rev: 2, art: 'neue_spur' }));
  await bounceAktion(p, ctx({ rev: 3, art: 'neue_spur', hinweis: 'quellen_laenger' }));
  assert.equal(meldungen[0], BOUNCE_TEXT.fertig_neue_spur, 'control: without hinweis the plain text');
  assert.match(meldungen[1], /muted completely, also outside the range/, 'the hint of the server answer reaches the page');
});
