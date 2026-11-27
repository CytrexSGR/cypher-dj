// Note editor, task B7: the adapter between the host-neutral surface (public/noten/) and the page of PRODUCTION. It builds Sicht from the project and the two
// routes, and turns the surface's ops into project commands (computed at send time) or calls of the detection routes. No browser, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefeAdapter } from '../public/noten/contract.js';
import { neuerNotenAdapter, RENDER_TEXT } from '../public/production/notes_adapter.js';
import { fehlerText } from '../public/production/production.js';
import { beatBeiQuelle, quellSekunde } from '../public/production/warp.js';
import { rasteEin } from '../public/harmonie.js';

const SHA = 'a'.repeat(64);
const liste = () => [
  { id: 't1', qa: 0.5, qe: 1.0, qton: 60, p: 0.8 },
  { id: 't2', qa: 1.0, qe: 1.5, qton: 64, p: 0.7, ton: 65 },
];
const clip = (extra = {}) => ({ id: 'c1', art: 'audio', name: 'vox', start_beat: 8, laenge_beats: 16, quelle: { sha256: SHA }, dekodiert: 'fertig', offset_s: 2, gain_db: 0,
  fade_ein_beats: 0, fade_aus_beats: 0, audio_noten: { kurve: 'pyin-1.noten_hmm-1', liste: liste() }, ...extra });
const projekt = (c = clip(), extra = {}) => ({ rev: 7, tempo_bpm: 120, taktart: [3, 4], spuren: [{ id: 's1', clips: [c] }], ...extra });
const warp = (extra = {}) => ({ an: true, modus: 'complex', marker: [[0, 0], [4, 8], [8, 24]], versatz_beats: 2, quelle: 'werkstatt', transpose_st: 0, detune_ct: 0, ...extra });

// a waveform of 400 columns of hop 480 samples = 4 s at 48000 Hz; every column has peak 255
const welleEintrag = () => ({ welle: { hop: 480, spalten: 400, daten: new Uint8Array(400 * 4).fill(255), gain: [1, 1, 1, 1] }, fehler: null });

function aufbau({ p = projekt(), antworten = {}, wellenEintrag = welleEintrag() } = {}) {
  const get = [], post = [], melden = [], aufgerufen = [];
  const ctx = {
    st: { slug: 'proj', projekt: p }, fehlerText,
    holeGet: async (weg) => { get.push(weg); const a = antworten[weg.split('?')[0]]; return typeof a === 'function' ? a(weg) : a ?? { status: 404, j: { fehler: 'noten_unbekannt' } }; },
    holeJson: async (weg, koerper) => { post.push([weg, koerper]); const a = antworten[weg]; return typeof a === 'function' ? a(koerper) : a ?? { status: 200, j: { auftrag_id: 3 } }; },
    melde: (t, f) => melden.push([t, f]),
    aendereAus: (rechne) => { aufgerufen.push(rechne); return Promise.resolve(true); },
  };
  const wellen = { hole: (sha, wenn) => { wellen.gefragt.push(sha); wellen.wenn = wenn; return wellenEintrag; }, gefragt: [] };
  const a = neuerNotenAdapter(ctx, 'c1', { wellen });
  const gesendet = (i = 0, q = ctx.st.projekt) => aufgerufen[i]?.(q);
  return { ctx, a, get, post, melden, aufgerufen, gesendet, wellen };
}
const warte = () => new Promise((ok) => setTimeout(ok, 0));

test('the adapter passes pruefeAdapter and builds Sicht from a project with audio_noten, warp markers and a key', async () => {
  const w = warp();
  const p = projekt(clip({ warp: w }), { tonart: { grundton: 0, skala: 'major' } });
  const t = aufbau({ p, antworten: { '/proj/noten/kurve': { status: 200, j: { kurve: 'pyin-1.noten_hmm-1', hop_s: 256 / 48000, ct: [0, 6000, 6000, 0] } } } });
  assert.deepEqual(pruefeAdapter(t.a), []);
  t.a.lies();                                                           // the first read asks for the curve
  await warte();
  const s = t.a.lies();
  assert.equal(s.quelleS, 4, 'the length of the source comes from the waveform');
  assert.equal(s.noten, p.spuren[0].clips[0].audio_noten.liste, 'the notes are the clip list itself');
  assert.ok(t.get.includes('/proj/noten/kurve?clip_id=c1'));
  assert.equal(s.kurve.hopS, 256 / 48000);
  assert.deepEqual([...s.kurve.ct], [0, 6000, 6000, 0]);
  // warp on: audible range through the markers: versatz 2 beats .. 2 + 16 beats
  assert.deepEqual(s.hoerbarS, [quellSekunde(w.marker, 2), quellSekunde(w.marker, 18)]);
  // grid: project beat = start_beat + (clip beat - versatz); the inverse maps back
  const b = s.raster.beatBeiS(3);
  assert.ok(Math.abs(b - (8 + beatBeiQuelle(w.marker, 3) - 2)) < 1e-9);
  assert.ok(Math.abs(s.raster.sBeiBeat(b) - 3) < 1e-9);
  assert.equal(s.raster.beatsProTakt, 3, 'from the time signature of the project');
  // the key: the nearest tone of C major
  assert.equal(s.rasteTonart(61), rasteEin(61, { grundton: 0, skala: 'major' }));
  assert.equal(s.rasteTonart(61), 60);
  // the waveform: n (min, max) pairs in -1..1
  const sp = s.welle.hole(0, 4, 8);
  assert.equal(sp.length, 8);
  assert.deepEqual(sp[0], [-1, 1]);
  assert.deepEqual(s.render, { zustand: 'quelle', text: RENDER_TEXT.quelle });
  assert.equal(s.analyse, null);
});

test('without warp, raster maps source seconds through offset_s and tempo; without a key rasteTonart is null', () => {
  const t = aufbau();
  const s = t.a.lies();
  assert.deepEqual(s.hoerbarS, [2, 2 + 16 * 60 / 120], 'offset_s .. offset_s + clip length in source seconds');
  assert.equal(s.raster.beatBeiS(2), 8, 'the clip start is at the offset');
  assert.equal(s.raster.beatBeiS(3), 8 + 2, 'one second is two beats at 120 BPM');
  assert.equal(s.raster.sBeiBeat(12), 4);
  assert.equal(s.rasteTonart, null);
  // a warp that is switched off counts as no warp
  const aus = aufbau({ p: projekt(clip({ warp: warp({ an: false }) })) }).a.lies();
  assert.deepEqual(aus.hoerbarS, [2, 10]);
  // no tempo, no grid
  assert.equal(aufbau({ p: projekt(clip(), { tempo_bpm: undefined }) }).a.lies().raster, null);
});

test('a clip without audio_noten gives an empty list and asks for no curve; a gone clip gives an empty Sicht', async () => {
  const t = aufbau({ p: projekt(clip({ audio_noten: undefined })) });
  const s = t.a.lies();
  assert.deepEqual(s.noten, []);
  assert.equal(s.kurve, null);
  await warte();
  assert.ok(!t.get.some((u) => u.startsWith('/proj/noten/kurve')));
  t.ctx.st.projekt = projekt(clip({ id: 'c9' }));
  assert.deepEqual(t.a.lies().noten, []);
});

test('the curve is cached per source and curve id; a failed read is not repeated by the same adapter', async () => {
  const kurven = new Map();
  const antw = { '/proj/noten/kurve': { status: 200, j: { kurve: 'pyin-1.noten_hmm-1', hop_s: 0.005, ct: [0, 6000] } } };
  const a1 = aufbau({ antworten: antw });
  const wellen = a1.wellen;
  const a = neuerNotenAdapter(a1.ctx, 'c1', { wellen, kurven });
  a.lies(); a.lies();
  await warte();
  assert.equal(a1.get.filter((u) => u.startsWith('/proj/noten/kurve')).length, 1, 'one read for two lies');
  assert.ok(kurven.has(`${SHA}|pyin-1.noten_hmm-1`));
  const b = neuerNotenAdapter(a1.ctx, 'c1', { wellen, kurven });
  assert.deepEqual([...b.lies().kurve.ct], [0, 6000]);
  assert.equal(a1.get.filter((u) => u.startsWith('/proj/noten/kurve')).length, 1, 'another adapter reads the cache');
  const n = aufbau();                                                   // the default answer is 404
  n.a.lies(); n.a.lies();
  await warte();
  n.a.lies();
  assert.equal(n.get.filter((u) => u.startsWith('/proj/noten/kurve')).length, 1);
  assert.equal(n.a.lies().kurve, null);
});

test('abonniere calls back after a curve arrives, a project change and the end; the unsubscribe function works', async () => {
  const t = aufbau({ antworten: { '/proj/noten/kurve': { status: 200, j: { kurve: 'pyin-1.noten_hmm-1', hop_s: 0.005, ct: [0, 6000] } } } });
  let n = 0;
  const ab = t.a.abonniere(() => { n++; });
  t.a.lies();
  await warte();
  assert.ok(n >= 1, 'the curve arrived');
  const vor = n;
  t.a.projektNeu();
  assert.equal(n, vor + 1);
  ab();
  t.a.projektNeu();
  assert.equal(n, vor + 1, 'unsubscribed');
});

test('schreibe ton computes audio_noten_aendern from the stand at send time and returns null when the note is gone', async () => {
  const t = aufbau();
  const r = await t.a.schreibe({ art: 'ton', ids: ['t1', 't2'], um: 2 });
  assert.deepEqual(r, { ok: true });
  assert.equal(t.aufgerufen.length, 1);
  assert.deepEqual(t.gesendet(), { label: 'Note pitch', befehle: [{ befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ['t1', 't2'], ton_um: 2 }] });
  // the project changed after the gesture: a note is gone, nothing is sent from the new stand
  const ohne = projekt(clip({ audio_noten: { kurve: 'k', liste: [liste()[0]] } }));
  assert.equal(t.gesendet(0, ohne), null);
  assert.equal(t.gesendet(0, projekt(clip({ id: 'c2' }))), null, 'the clip is gone');
  assert.equal(t.gesendet(0, projekt(clip({ audio_noten: undefined }))), null, 'the clip has no notes any more');
  assert.equal(t.gesendet(0, { ...ohne, spuren: [] }), null);
  assert.notEqual(t.gesendet(0, projekt()), null, 'negative control: the full stand sends');
});

test('a write that finds nothing to send says why: the note gone is shown with its page text, a gone clip stays silent', async () => {
  const t = aufbau();
  t.ctx.aendereAus = (rechne) => { const x = rechne(projekt(clip({ audio_noten: { kurve: 'k', liste: [liste()[0]] } }))); return Promise.resolve(x !== null); };
  const r = await t.a.schreibe({ art: 'ton', ids: ['t2'], um: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.grund, 'noten_unbekannt');
  assert.deepEqual(t.melden, [[fehlerText({ j: { fehler: 'noten_unbekannt' } }), true]]);
  const u = aufbau();
  u.ctx.aendereAus = (rechne) => Promise.resolve(rechne(projekt(clip({ id: 'c2' }))) !== null);
  const r2 = await u.a.schreibe({ art: 'ton', ids: ['t1'], um: 1 });
  assert.equal(r2.ok, false);
  assert.equal(r2.grund, 'clip_unbekannt');
  assert.deepEqual(u.melden, []);
  // the writer refused (the page shows its own message): no second message here
  const v = aufbau();
  v.ctx.aendereAus = () => Promise.resolve(false);
  assert.deepEqual(await v.a.schreibe({ art: 'ton', ids: ['t1'], um: 1 }), { ok: false, grund: 'abgelehnt', text: '' });
  assert.deepEqual(v.melden, []);
});

test('zuruecksetzen and entfernen: commands, labels, and null when there is nothing to do', async () => {
  const t = aufbau();
  await t.a.schreibe({ art: 'zuruecksetzen', ids: ['t2'] });
  assert.deepEqual(t.gesendet(0), { label: 'Reset note', befehle: [{ befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1', ids: ['t2'] }] });
  await t.a.schreibe({ art: 'zuruecksetzen' });
  assert.deepEqual(t.gesendet(1), { label: 'Reset notes', befehle: [{ befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1' }] });
  await t.a.schreibe({ art: 'zuruecksetzen', ids: ['t1', 't2'] });
  assert.equal(t.gesendet(2).label, 'Reset notes');
  await t.a.schreibe({ art: 'entfernen' });
  assert.deepEqual(t.gesendet(3), { label: 'Remove notes', befehle: [{ befehl: 'audio_noten_entfernen', clip_id: 'c1' }] });
  const leer = projekt(clip({ audio_noten: undefined }));
  assert.equal(t.gesendet(1, leer), null);
  assert.equal(t.gesendet(3, leer), null);
  assert.equal(t.gesendet(0, projekt(clip({ audio_noten: { kurve: 'k', liste: [liste()[0]] } }))), null, 'the note is gone');
});

test('erkennen posts /proj/noten/erkennen with neu only when asked; a refusal is shown with its page text', async () => {
  const t = aufbau();
  assert.deepEqual(await t.a.schreibe({ art: 'erkennen' }), { ok: true });
  assert.deepEqual(t.post[0], ['/proj/noten/erkennen', { clip_id: 'c1' }]);
  assert.equal('neu' in t.post[0][1], false);
  await t.a.schreibe({ art: 'erkennen', neu: true });
  assert.deepEqual(t.post[1], ['/proj/noten/erkennen', { clip_id: 'c1', neu: true }]);
  const n = aufbau({ antworten: { '/proj/noten/erkennen': { status: 409, j: { fehler: 'noten_vorhanden', clip_id: 'c1' } } } });
  const r = await n.a.schreibe({ art: 'erkennen' });
  assert.equal(r.ok, false);
  assert.equal(r.grund, 'noten_vorhanden');
  assert.equal(r.text, 'This clip already has notes: detect them again only if you accept losing your edits');
  assert.deepEqual(n.melden, [[r.text, true]]);
  const s = aufbau({ antworten: { '/proj/noten/erkennen': { status: 409, j: { fehler: 'stems_laeuft' } } } });
  await s.a.schreibe({ art: 'erkennen' });
  assert.equal(s.melden[0][0], 'A stem separation is already running');
});

test('abbrechen posts the id of the running detection; without one it says so; a late cancel is shown', async () => {
  const t = aufbau();
  const keiner = await t.a.schreibe({ art: 'abbrechen' });
  assert.equal(keiner.ok, false, 'nothing runs');
  assert.equal(keiner.grund, 'kein_auftrag');
  assert.equal(t.post.length, 0);
  t.a.ereignis('proj', { noten: { slug: 'proj', auftrag_id: 4, clip_id: 'c1', zustand: 'laeuft', stufe: 'analyse', prozent: 10 } });
  assert.deepEqual(await t.a.schreibe({ art: 'abbrechen' }), { ok: true });
  assert.deepEqual(t.post[0], ['/proj/noten/abbrechen', { auftrag_id: 4 }]);
  const spaet = aufbau({ antworten: { '/proj/noten/abbrechen': { status: 409, j: { fehler: 'zu_spaet' } } } });
  spaet.a.ereignis('proj', { noten: { slug: 'proj', auftrag_id: 5, clip_id: 'c1', zustand: 'laeuft', prozent: 90 } });
  const r = await spaet.a.schreibe({ art: 'abbrechen' });
  assert.equal(r.ok, false);
  assert.equal(r.text, 'The notes are already placed: use undo to remove them', 'zu_spaet says notes here, the page map of that reason speaks of stems');
  assert.deepEqual(spaet.melden, [[r.text, true]]);
});

test('SSE: noten of this clip and this project moves analyse; noten_render moves render; other clips and other projects do nothing', () => {
  const t = aufbau();
  let n = 0;
  t.a.abonniere(() => { n++; });
  t.a.ereignis('proj', { noten: { slug: 'proj', auftrag_id: 1, clip_id: 'c1', zustand: 'laeuft', stufe: 'analyse', prozent: 40 } });
  assert.equal(t.a.lies().analyse.zustand, 'laeuft');
  assert.equal(t.a.lies().analyse.prozent, 40);
  t.a.ereignis('proj', { noten: { slug: 'proj', auftrag_id: 1, clip_id: 'c2', zustand: 'laeuft', prozent: 80 } });
  t.a.ereignis('proj', { noten: { slug: 'andere', auftrag_id: 1, clip_id: 'c1', zustand: 'laeuft', prozent: 90 } });
  assert.equal(t.a.lies().analyse.prozent, 40);
  t.a.ereignis('stand', { noten: { slug: 'proj', clip_id: 'c1', zustand: 'laeuft', prozent: 95 } });
  assert.equal(t.a.lies().analyse.prozent, 40, 'only proj events count');
  assert.equal(n, 1);
  t.a.ereignis('proj', { noten_render: { slug: 'proj', clip_id: 'c1', zustand: 'rechnet' } });
  assert.deepEqual(t.a.lies().render, { zustand: 'rechnet', text: 'rendering…' });
  t.a.ereignis('proj', { noten_render: { slug: 'proj', clip_id: 'c2', zustand: 'bereit' } });
  assert.equal(t.a.lies().render.zustand, 'rechnet');
  assert.equal(n, 2);
});

test('render texts are exact; fehler shows the text of its reason', () => {
  const t = aufbau();
  const text = (z, extra = {}) => { t.a.ereignis('proj', { noten_render: { slug: 'proj', clip_id: 'c1', zustand: z, ...extra } }); return t.a.lies().render.text; };
  assert.equal(text('quelle'), 'plays the original');
  assert.equal(text('rechnet'), 'rendering…');
  assert.equal(text('alt'), 'plays the previous edit while rendering');
  assert.equal(text('bereit', { sekunden: 0.4 }), 'plays the edit');
  assert.equal(text('fehler', { grund: 'noten_render_fehler', text: 'server words' }), 'The note edit could not be rendered. The clip plays without it.');
  assert.equal(text('fehler', { grund: 'noten_kurve_fehlt' }), fehlerText({ j: { fehler: 'noten_kurve_fehlt' } }));
});

test('analysis end texts: keine_noten, the hints, the refusal of a polyphonic source, cancel and stale', () => {
  const t = aufbau();
  const text = (s) => { t.a.ereignis('proj', { noten: { slug: 'proj', auftrag_id: 1, clip_id: 'c1', ...s } }); return t.a.lies().analyse.text; };
  assert.equal(text({ zustand: 'fertig', noten: 0, hinweis: 'keine_noten', text: 'server words' }), 'No notes found in this clip.');
  assert.equal(text({ zustand: 'fertig', noten: 3, hinweis: 'wenig_stimmhaft', text: 'Little pitched sound found.' }), 'Little pitched sound found.');
  assert.equal(text({ zustand: 'fertig', noten: 3 }), '', 'a plain success needs no text');
  assert.equal(text({ zustand: 'fehler', grund: 'noten_mehrstimmig', text: 'x' }), 'More than one note at a time. Separate stems first, then detect notes on a stem.');
  assert.equal(text({ zustand: 'abgebrochen', grund: 'abbruch', text: 'the note detection was cancelled' }), 'the note detection was cancelled');
  assert.equal(text({ zustand: 'veraltet', grund: 'veraltet', text: 'the clip changed while the notes were detected; nothing was placed' }), 'the clip changed while the notes were detected; nothing was placed');
});

test('GET /proj/noten at the start gives render and analyse; an SSE event that came first is not overwritten', async () => {
  const t = aufbau({ antworten: { '/proj/noten': { status: 200, j: { clip_id: 'c1', render: { zustand: 'alt' }, analyse: { slug: 'proj', auftrag_id: 2, clip_id: 'c1', zustand: 'fertig', noten: 0, hinweis: 'keine_noten' } } } } });
  await t.a.ladeZustand();
  assert.equal(t.a.lies().render.text, 'plays the previous edit while rendering');
  assert.equal(t.a.lies().analyse.text, 'No notes found in this clip.');
  const u = aufbau({ antworten: { '/proj/noten': async () => { await warte(); return { status: 200, j: { clip_id: 'c1', render: { zustand: 'quelle' }, analyse: null } }; } } });
  const p = u.a.ladeZustand();
  u.a.ereignis('proj', { noten_render: { slug: 'proj', clip_id: 'c1', zustand: 'bereit' } });
  await p;
  assert.equal(u.a.lies().render.zustand, 'bereit', 'the newer SSE state wins over the older answer');
  const v = aufbau({ antworten: { '/proj/noten': { status: 200, j: { clip_id: 'c1', render: null, analyse: null } } } });
  await v.a.ladeZustand();
  assert.equal(v.a.lies().render.zustand, 'quelle', 'no render service: the clip plays its source');
});

test('after ende() nothing is sent, nothing is read and the callbacks stay silent', async () => {
  const t = aufbau();
  let n = 0;
  t.a.abonniere(() => { n++; });
  t.a.ende();
  t.a.projektNeu();
  t.a.ereignis('proj', { noten_render: { slug: 'proj', clip_id: 'c1', zustand: 'bereit' } });
  assert.equal(n, 0);
  assert.equal((await t.a.schreibe({ art: 'ton', ids: ['t1'], um: 1 })).ok, false);
  assert.equal(t.aufgerufen.length, 0);
});

test('the real surface of public/noten/ drags a note through this adapter: one command at the release, computed from the stand of that moment', async () => {
  const { bindeNotenEditor } = await import('../public/noten/operation.js');
  const { neueAnsicht, notenKasten } = await import('../public/noten/view.js');
  const t = aufbau();
  const handler = new Map(), rufe = [];
  const g = new Proxy({}, { get: (_, n) => (n === 'measureText' ? () => ({ width: 5 }) : (...a) => { rufe.push([n, ...a]); }), set: () => true });
  const canvas = { width: 0, height: 0, style: {}, getContext: () => g, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
    addEventListener: (n, f) => handler.set(n, f), removeEventListener: (n) => handler.delete(n), setPointerCapture() {}, releasePointerCapture() {}, focus() {} };
  const menues = [];
  const e = bindeNotenEditor(canvas, t.a, { menue: (punkte) => menues.push(punkte) });
  const sicht = t.a.lies();
  const kasten = notenKasten(neueAnsicht(sicht, 400, 200), sicht.noten[0]);
  const ereignis = (name, o = {}) => handler.get(name)({ type: name, button: 0, shiftKey: false, altKey: false, pointerId: 1, preventDefault() {}, ...o });
  const x = kasten.x + kasten.w / 2, y = kasten.y + kasten.h / 2;
  ereignis('pointerdown', { offsetX: x, offsetY: y });
  ereignis('pointermove', { offsetX: x, offsetY: y - 18 });
  assert.equal(t.aufgerufen.length, 0, 'nothing is sent before the release');
  ereignis('pointerup', { offsetX: x, offsetY: y - 18 });
  await warte();
  assert.equal(t.aufgerufen.length, 1);
  assert.deepEqual(t.gesendet(), { label: 'Note pitch', befehle: [{ befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ['t1'], ton_um: 2 }] });
  // the context menu of the surface reaches the adapter: Reset all notes
  ereignis('contextmenu', { offsetX: 200, offsetY: 150, clientX: 200, clientY: 150 });
  menues[0].find((p) => p.text === 'Reset all notes').aktion();
  await warte();
  assert.deepEqual(t.gesendet(1), { label: 'Reset notes', befehle: [{ befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1' }] });
  e.los();
  assert.equal(handler.has('pointerdown'), false, 'los releases the canvas');
});
