// Note editor, task B7: the block of the clip detail (production/notes_block.js): DETECT NOTES, the progress bar, the render state and the analysis stand around
// the canvas of the note editor. Elements are stand-ins (tests/support/dom_mock.mjs); the surface of public/noten/ is replaced by a counter here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { element } from './support/dom_mock.mjs';
import { bindeNoten } from '../public/production/notes_block.js';
import { fehlerText } from '../public/production/production.js';

const SHA = 'a'.repeat(64);
const clip = (extra = {}) => ({ id: 'c1', art: 'audio', name: 'vox', start_beat: 0, laenge_beats: 16, quelle: { sha256: SHA }, dekodiert: 'fertig', offset_s: 0, gain_db: 0,
  fade_ein_beats: 0, fade_aus_beats: 0, audio_noten: { kurve: 'pyin-1.noten_hmm-1', liste: [{ id: 't1', qa: 0, qe: 1, qton: 60, p: 1 }] }, ...extra });
const midi = () => ({ id: 'm1', art: 'midi', name: 'keys', start_beat: 0, laenge_beats: 4, noten: [] });
const projekt = (...clips) => ({ rev: 1, tempo_bpm: 120, spuren: [{ id: 's1', clips }] });

// a container whose querySelector hands out the element of a `[data-d="name"]` selector
function behaelter(namen) {
  const e = element('div'), kinder = Object.fromEntries(namen.map((n) => [n, element(n === 'notencanvas' ? 'canvas' : 'span')]));
  e.querySelector = (sel) => kinder[/data-d="([^"]+)"/.exec(sel)?.[1]] ?? null;
  e.hidden = false; e.kinder2 = kinder;
  return e;
}
function aufbau({ p = projekt(clip()), antworten = {}, bestaetigt = true } = {}) {
  const post = [], melden = [], fragen = [], gebunden = [];
  const oben = behaelter(['notencanvas', 'notenstand', 'notenanalyse']);
  const knopf = behaelter(['notenknopf', 'notenbalken', 'notenabbruch']);
  const ctx = { st: { slug: 'proj', projekt: p, stems: null }, fehlerText, beimEreignis: [], beimBild: [],
    holeGet: async (weg) => antworten[weg.split('?')[0]] ?? { status: 404, j: { fehler: 'noten_unbekannt' } },
    holeJson: async (weg, koerper) => { post.push([weg, koerper]); return antworten[weg] ?? { status: 200, j: { auftrag_id: 9 } }; },
    melde: (t, f) => melden.push([t, f]), aendereAus: () => Promise.resolve(true) };
  const bindeEditor = (canvas, adapter, o) => { const b = { canvas, adapter, o, los: 0, zeige: 0 }; gebunden.push(b);
    return { zeige() { b.zeige++; }, los() { b.los++; } }; };
  const wellen = { hole: () => ({ welle: null, fehler: null }) };
  const zu = { n: 0 };
  const block = bindeNoten(ctx, oben, knopf, { wellen, bindeEditor, menue: () => {}, schliesse: () => { zu.n++; }, frage: (t) => { fragen.push(t); return bestaetigt; } });
  const k = { canvas: oben.kinder2.notencanvas, stand: oben.kinder2.notenstand, analyse: oben.kinder2.notenanalyse, knopf: knopf.kinder2.notenknopf,
    balken: knopf.kinder2.notenbalken, abbruch: knopf.kinder2.notenabbruch };
  const sse = (f, a = 'proj') => { for (const h of ctx.beimEreignis) h(a, f); };
  const bild = () => { for (const h of ctx.beimBild) h(); };
  const klick = (el) => { for (const f of el.ereignisse.click ?? []) f({ type: 'click' }); };
  const warte = () => new Promise((ok) => setTimeout(ok, 0));
  return { zu, ctx, block, oben, knopfBeh: knopf, k, post, melden, fragen, gebunden, sse, bild, klick, warte };
}

test('the block shows for an audio clip, hides for a MIDI clip; DETECT NOTES is disabled while stems run', () => {
  const t = aufbau({ p: projekt(clip(), midi()) });
  t.block.zeige(null);
  assert.equal(t.oben.hidden, true, 'no clip: hidden');
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  assert.equal(t.oben.hidden, false);
  assert.equal(t.knopfBeh.hidden, false);
  assert.equal(t.k.knopf.disabled, false);
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[1]);
  assert.equal(t.oben.hidden, true, 'a MIDI clip: hidden');
  assert.equal(t.knopfBeh.hidden, true);
  assert.equal(t.gebunden.length, 1);
  assert.equal(t.gebunden[0].los, 1, 'the editor of the audio clip was released');
  // stems: the page gives no hook for its ticks, the frame hook sees st.stems
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  t.ctx.st.stems = { slug: 'proj', zustand: 'laeuft', clip_id: 'c1', prozent: 10 };
  t.bild();
  assert.equal(t.k.knopf.disabled, true, 'a stem separation runs');
  assert.match(t.k.knopf.title, /stem/i);
  t.ctx.st.stems = { slug: 'proj', zustand: 'fertig', clip_id: 'c1' };
  t.bild();
  assert.equal(t.k.knopf.disabled, false);
  // an audio clip that is still being decoded cannot be analysed
  t.ctx.st.projekt = projekt(clip({ dekodiert: 'laeuft' }));
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  assert.equal(t.k.knopf.disabled, true);
  assert.match(t.k.knopf.title, /still being prepared/);
});

test('the surface is bound once per clip: a change of clip releases the old surface and binds a new one, the same clip keeps it', () => {
  const c2 = clip({ id: 'c2' });
  const t = aufbau({ p: projekt(clip(), c2) });
  const [c1] = t.ctx.st.projekt.spuren[0].clips;
  t.block.zeige(c1);
  t.block.zeige(c1);
  assert.equal(t.gebunden.length, 1);
  assert.equal(t.gebunden[0].los, 0);
  assert.equal(t.gebunden[0].canvas, t.k.canvas);
  assert.equal(typeof t.gebunden[0].o.menue, 'function', 'the surface needs a menu function');
  t.block.zeige(c2);
  assert.equal(t.gebunden.length, 2);
  assert.equal(t.gebunden[0].los, 1);
  assert.equal(t.gebunden[1].los, 0);
  t.block.zeige(null);
  assert.equal(t.gebunden[1].los, 1);
});

test('SSE noten stand moves the bar; fertig with keine_noten shows the note text; noten_mehrstimmig shows the spec text', () => {
  const t = aufbau();
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  assert.equal(t.k.balken.hidden, true);
  assert.equal(t.k.abbruch.hidden, true);
  t.sse({ noten: { slug: 'proj', auftrag_id: 3, clip_id: 'c1', zustand: 'laeuft', stufe: 'analyse', prozent: 0 } });
  assert.equal(t.k.balken.hidden, false);
  assert.equal(t.k.abbruch.hidden, false);
  assert.equal(t.k.knopf.disabled, true, 'a detection runs');
  t.sse({ noten: { slug: 'proj', auftrag_id: 3, clip_id: 'c1', zustand: 'laeuft', stufe: 'segment', prozent: 55.4 } });
  assert.equal(t.k.balken.value, 55.4);
  assert.match(t.k.balken.title, /segment/);
  assert.match(t.k.analyse.textContent, /55 %/);
  t.sse({ noten: { slug: 'proj', auftrag_id: 3, clip_id: 'c1', zustand: 'fertig', stufe: 'segment', prozent: 100, noten: 0, hinweis: 'keine_noten', text: 'nothing' } });
  assert.equal(t.k.analyse.textContent, 'No notes found in this clip.');
  assert.equal(t.k.balken.hidden, true);
  assert.equal(t.k.abbruch.hidden, true);
  assert.equal(t.k.knopf.disabled, false);
  assert.equal(t.melden.length, 0, 'a clean end with a hint is not an error message');
  t.sse({ noten: { slug: 'proj', auftrag_id: 4, clip_id: 'c1', zustand: 'laeuft', prozent: 1 } });
  t.sse({ noten: { slug: 'proj', auftrag_id: 4, clip_id: 'c1', zustand: 'fehler', grund: 'noten_mehrstimmig', text: 'server words' } });
  assert.equal(t.k.analyse.textContent, 'More than one note at a time. Separate stems first, then detect notes on a stem.');
  assert.ok(t.k.analyse.klassen.has('fehler'));
  assert.deepEqual(t.melden, [['More than one note at a time. Separate stems first, then detect notes on a stem.', true]], 'a failure is said once in the message line too');
  t.sse({ noten: { slug: 'proj', auftrag_id: 5, clip_id: 'c1', zustand: 'laeuft', prozent: 1 } });
  assert.equal(t.k.analyse.klassen.has('fehler'), false);
});

test('a detection on another clip or in another project locks the button but shows no text of its own on this clip', () => {
  const t = aufbau();
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  t.sse({ noten: { slug: 'proj', auftrag_id: 3, clip_id: 'c7', zustand: 'laeuft', prozent: 20 } });
  assert.equal(t.k.knopf.disabled, true, 'one run at a time for the whole server');
  assert.equal(t.k.abbruch.hidden, false, 'it can be cancelled from here');
  assert.equal(t.k.analyse.textContent, '', 'no analysis text for this clip');
  t.sse({ noten: { slug: 'proj', auftrag_id: 3, clip_id: 'c7', zustand: 'fertig', noten: 2 } });
  assert.equal(t.k.knopf.disabled, false);
  t.sse({ noten: { slug: 'andere', auftrag_id: 3, clip_id: 'c1', zustand: 'laeuft', prozent: 20 } });
  assert.equal(t.k.knopf.disabled, false, 'another project');
  t.sse({ noten: { slug: 'proj', auftrag_id: 3, clip_id: 'c7', zustand: 'laeuft', prozent: 20 } }, 'stand');
  assert.equal(t.k.knopf.disabled, false, 'only proj events');
});

test('a run seen while no clip was shown still locks the button when a clip is shown later', () => {
  const t = aufbau();
  t.block.zeige(null);
  t.sse({ noten: { slug: 'proj', auftrag_id: 3, clip_id: 'c1', zustand: 'laeuft', prozent: 20 } });
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  assert.equal(t.k.knopf.disabled, true);
  assert.equal(t.k.abbruch.hidden, false);
});

test('SSE noten_render updates the state label with the exact texts', () => {
  const t = aufbau();
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  assert.equal(t.k.stand.textContent, 'plays the original');
  const sage = (z, extra = {}) => { t.sse({ noten_render: { slug: 'proj', clip_id: 'c1', zustand: z, ...extra } }); return t.k.stand.textContent; };
  assert.equal(sage('rechnet'), 'rendering…');
  assert.equal(sage('alt'), 'plays the previous edit while rendering');
  assert.equal(sage('bereit', { sekunden: 0.3 }), 'plays the edit');
  assert.equal(sage('fehler', { grund: 'noten_programm_fehlt' }), 'The note program (cypherdj-noten) is not built or not installed');
  assert.ok(t.k.stand.klassen.has('fehler'));
  assert.equal(sage('quelle'), 'plays the original');
  assert.equal(t.k.stand.klassen.has('fehler'), false);
  t.sse({ noten_render: { slug: 'proj', clip_id: 'c2', zustand: 'rechnet' } });
  assert.equal(t.k.stand.textContent, 'plays the original', 'another clip');
});

test('the state at the start comes from GET /proj/noten', async () => {
  const t = aufbau({ antworten: { '/proj/noten': { status: 200, j: { clip_id: 'c1', render: { zustand: 'rechnet' }, analyse: { slug: 'proj', auftrag_id: 2, clip_id: 'c1', zustand: 'fertig', noten: 0, hinweis: 'keine_noten' } } } } });
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  await t.warte();
  assert.equal(t.k.stand.textContent, 'rendering…');
  assert.equal(t.k.analyse.textContent, 'No notes found in this clip.');
});

test('DETECT NOTES: a clip without notes sends no neu; a clip with edits asks first and then sends neu: true; no answers no request', async () => {
  const leer = clip({ audio_noten: undefined });
  const t = aufbau({ p: projekt(leer) });
  t.block.zeige(leer);
  t.klick(t.k.knopf);
  await t.warte();
  assert.deepEqual(t.post, [['/proj/noten/erkennen', { clip_id: 'c1' }]]);
  assert.deepEqual(t.fragen, []);
  // detected notes without any edit: nothing to lose, the request carries neu
  const roh = aufbau();
  roh.block.zeige(roh.ctx.st.projekt.spuren[0].clips[0]);
  roh.klick(roh.k.knopf);
  await roh.warte();
  assert.deepEqual(roh.post, [['/proj/noten/erkennen', { clip_id: 'c1', neu: true }]]);
  assert.deepEqual(roh.fragen, []);
  // an edited note: the confirm pattern of the page
  const bearb = clip({ audio_noten: { kurve: 'k', liste: [{ id: 't1', qa: 0, qe: 1, qton: 60, p: 1, ton: 62 }] } });
  const e = aufbau({ p: projekt(bearb) });
  e.block.zeige(bearb);
  e.klick(e.k.knopf);
  await e.warte();
  assert.deepEqual(e.fragen, ['Detect again? Your note edits on this clip are lost.']);
  assert.deepEqual(e.post, [['/proj/noten/erkennen', { clip_id: 'c1', neu: true }]]);
  const nein = aufbau({ p: projekt(bearb), bestaetigt: false });
  nein.block.zeige(bearb);
  nein.klick(nein.k.knopf);
  await nein.warte();
  assert.equal(nein.fragen.length, 1);
  assert.deepEqual(nein.post, [], 'no answer, no request');
  // a target of time counts as an edit too
  const zeit = clip({ audio_noten: { kurve: 'k', liste: [{ id: 't1', qa: 0, qe: 1, qton: 60, p: 1, a: 0.1 }] } });
  const z = aufbau({ p: projekt(zeit) });
  z.block.zeige(zeit);
  z.klick(z.k.knopf);
  assert.equal(z.fragen.length, 1);
});

test('DETECT NOTES refused by the server is shown with the text of the reason; a disabled button does nothing', async () => {
  const t = aufbau({ antworten: { '/proj/noten/erkennen': { status: 409, j: { fehler: 'noten_laeuft', auftrag_id: 1 } } } });
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  t.klick(t.k.knopf);
  await t.warte();
  assert.deepEqual(t.melden, [['A note detection is already running', true]]);
  const u = aufbau();
  u.block.zeige(u.ctx.st.projekt.spuren[0].clips[0]);
  u.k.knopf.disabled = true;
  u.klick(u.k.knopf);
  await u.warte();
  assert.deepEqual(u.post, []);
});

test('CANCEL posts the id of the running detection', async () => {
  const t = aufbau();
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  t.sse({ noten: { slug: 'proj', auftrag_id: 6, clip_id: 'c1', zustand: 'laeuft', prozent: 30 } });
  t.klick(t.k.abbruch);
  await t.warte();
  assert.deepEqual(t.post, [['/proj/noten/abbrechen', { auftrag_id: 6 }]]);
});

test('a project change with the same clip id binds anew: no state of the old project stays', async () => {
  const t = aufbau();
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  t.sse({ noten_render: { slug: 'proj', clip_id: 'c1', zustand: 'bereit' } });
  t.sse({ noten: { slug: 'proj', clip_id: 'c1', auftrag_id: 3, zustand: 'fertig', hinweis: 'keine_noten' } });
  assert.equal(t.k.stand.textContent, 'plays the edit');
  assert.equal(t.k.analyse.textContent, 'No notes found in this clip.');
  t.ctx.st.slug = 'other';
  t.ctx.st.projekt = projekt(clip({ audio_noten: undefined }));
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  assert.equal(t.gebunden.length, 2, 'a new surface for the clip of the other project');
  assert.equal(t.gebunden[0].los, 1);
  assert.equal(t.k.stand.textContent, 'plays the original');
  assert.equal(t.k.analyse.textContent, '');
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  assert.equal(t.gebunden.length, 2, 'same project and clip: kept');
});

test('zeige(null) closes a menu only when a surface was bound', () => {
  const t = aufbau();
  t.block.zeige(null); t.block.zeige(null);
  assert.equal(t.zu.n, 0, 'nothing bound: a foreign menu stays open');
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  t.block.zeige(null);
  assert.equal(t.zu.n, 1);
});

test('CANCEL answered with kein_auftrag drops the run the page still showed', async () => {
  const t = aufbau({ antworten: { '/proj/noten/abbrechen': { status: 409, j: { fehler: 'kein_auftrag' } } } });
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  t.sse({ noten: { slug: 'proj', clip_id: 'c1', auftrag_id: 5, zustand: 'laeuft', prozent: 40 } });
  assert.equal(t.k.knopf.disabled, true);
  t.klick(t.k.abbruch); await t.warte();
  assert.equal(t.k.knopf.disabled, false);
  assert.equal(t.k.balken.hidden, true);
  assert.equal(t.k.analyse.textContent, '');
});

test('noten_fehler shows the text of the stand: saved but not loaded is not "nothing was changed"', () => {
  const t = aufbau();
  t.block.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  t.sse({ noten: { slug: 'proj', clip_id: 'c1', auftrag_id: 6, zustand: 'fehler', grund: 'noten_fehler', text: 'the notes were saved, but loading them failed' } });
  assert.equal(t.k.analyse.textContent, 'The notes were saved, but loading them failed');
  assert.equal(t.melden.at(-1)[0], 'the notes were saved, but loading them failed');
});

test('the markup of the clip detail: the block, the canvas with tabindex and no border, the button, the bar and the cancel button', () => {
  const dir = new URL('../public/production/', import.meta.url);
  const detail = readFileSync(new URL('detail.js', dir), 'utf8'), css = readFileSync(new URL('production.css', dir), 'utf8');
  assert.match(detail, /<div class="p-noten" data-d="noten" hidden>/);
  assert.match(detail, /<canvas class="p-noten-canvas" data-d="notencanvas" tabindex="0" aria-label="Note editor"><\/canvas>/);
  assert.match(detail, /data-d="notenknopf"[^>]*>DETECT NOTES<\/button>/);
  assert.match(detail, /<progress[^>]*data-d="notenbalken"/);
  assert.match(detail, /data-d="notenabbruch"/);
  assert.match(detail, /bindeNoten\(ctx, d\('noten'\), d\('notenaktion'\)\)/);
  assert.ok(detail.indexOf('data-d="editorcanvas"') < detail.indexOf('data-d="notencanvas"'), 'after the warp editor block');
  assert.match(css, /\.p-noten\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.p-noten\[hidden\][^{]*\{[^}]*display:\s*none/);
  const leinwand = /\.p-noten-canvas\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.ok(leinwand !== '', 'the canvas has a rule');
  assert.doesNotMatch(leinwand, /\b(border|padding)\s*:\s*(?!0\b)/, 'offsetX and offsetY must equal canvas pixels: no border, no padding');
  // every call of the block in the detail view: the audio branch shows the clip, every other branch hides it
  assert.ok((detail.match(/notenTeil\.zeige\(/g) ?? []).length >= 6);
  assert.match(detail, /notenTeil\.zeige\(c\)/);
});
