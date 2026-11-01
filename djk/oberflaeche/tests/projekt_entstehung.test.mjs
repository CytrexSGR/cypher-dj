// Baukasten S15 task 3: optional provenance "entstehung" on audio clips (the take of a Baukasten stream bounce).
// Set and removed through clip_aendern, /2 only, absent in every old project (byte-identical files), never reaches the kern.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Projekte, normalisiere } from '../projekt/ablage.ts';
import { fuehreAus, fuehreListeAus } from '../projekt/befehle.ts';
import { Verlauf, aendere, rueckgaengig } from '../projekt/verlauf.ts';
import { neuesProjekt, pruefeProjekt, pruefeFehler, kanonisch, ENTSTEHUNG_GRAPH, ENTSTEHUNG_CODE_MAX, FORMAT_ALT } from '../projekt/modell.ts';
import { GRAPH_NAME } from '../graphen.ts';
import { uebersetze } from '../projekt/wiedergabe.ts';
import { tmpOrdner, kopie, specProjekt, SHA_A } from './hilfen/projekt.mjs';

const E = () => ({ art: 'strom', strom: 3, graph: 'juno-pad', regler: [0.5, 0.7, 0.5, 0.5, 0.5, 0.5, 0.5, 0.25], code: 'note("c3 e3 g3 c4")', bpm: 128 });
const opt = { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: (sha) => (sha === SHA_A ? 24000 : null) };
// project with one audio track (clip c1) and one MIDI track (clip c2)
function projekt() {
  return fuehreListeAus(neuesProjekt('T'), [
    { befehl: 'spur_neu', art: 'audio', name: 'Take' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA_A, pfad_hinweis: '/p/aufnahmen/take-3-1.wav' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Keys' },
    { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4 },
  ]).projekt;
}
const audio = (p) => p.spuren[0].clips[0];
const setze = (p, e = E()) => fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', entstehung: e }).projekt;
const grund = (f) => { try { f(); } catch (e) { return e.grund; } return null; };

test('set: clip_aendern entstehung puts exactly the object on the audio clip; the project stays valid after a canonical roundtrip', () => {
  const p = projekt();
  assert.equal('entstehung' in audio(p), false, 'precondition: absent');
  const q = setze(p);
  assert.deepEqual(audio(q).entstehung, E());
  assert.equal(pruefeFehler(JSON.parse(kanonisch(q))), null, 'the saved form is accepted by the file check');
  const r = pruefeProjekt(JSON.parse(kanonisch(q))).projekt;
  assert.deepEqual(audio(r).entstehung, E());
  assert.equal(fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', entstehung: E() }).betrifft_wiedergabe, false, 'provenance is no playback change');
  const e = E(); const q2 = setze(p, e); e.regler[0] = 0.9;
  assert.equal(audio(q2).entstehung.regler[0], 0.5, 'the project holds a copy, not the caller object');
});

test('refusals: each bad provenance is rejected and the project stays unchanged; a MIDI clip refuses the field', () => {
  const p = projekt();
  const mut = (f) => { const e = E(); f(e); return e; };
  const falle = [
    ['strom 1', mut((e) => { e.strom = 1; })], ['strom 4', mut((e) => { e.strom = 4; })],
    ['graph with blank and capital', mut((e) => { e.graph = 'Juno Pad'; })], ['graph of 33 chars', mut((e) => { e.graph = 'a'.repeat(33); })],
    ['regler of 7 values', mut((e) => { e.regler = e.regler.slice(0, 7); })], ['regler of 9 values', mut((e) => { e.regler.push(0.5); })],
    ['a value 1.2', mut((e) => { e.regler[3] = 1.2; })], ['a value -0.1', mut((e) => { e.regler[3] = -0.1; })], ['a value "x"', mut((e) => { e.regler[3] = 'x'; })],
    ['code empty', mut((e) => { e.code = ''; })], ['code 20001 chars', mut((e) => { e.code = 'a'.repeat(20001); })], ['code a number', mut((e) => { e.code = 7; })],
    ['bpm 300', mut((e) => { e.bpm = 300; })], ['bpm 59', mut((e) => { e.bpm = 59; })],
    ['extra key zeit', mut((e) => { e.zeit = 1; })], ['missing key bpm', mut((e) => { delete e.bpm; })],
    ['art graph', mut((e) => { e.art = 'graph'; })], ['not an object', 'juno-pad'], ['an array', [E()]],
  ];
  for (const [name, e] of falle) {
    const g = grund(() => fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', entstehung: e }));
    assert.equal(g, name === 'extra key zeit' ? 'argument_unbekannt' : 'argument_ungueltig', `${name}: wrong refusal reason`);
  }
  assert.equal('entstehung' in audio(p), false, 'the input project is unchanged');
  // negative control: the boundary values pass (code of exactly 20000, graph of 32, regler 0 and 1, bpm 60 and 200)
  const grenze = mut((e) => { e.code = 'a'.repeat(ENTSTEHUNG_CODE_MAX); e.graph = 'a'.repeat(32); e.regler = [0, 1, 0, 1, 0, 1, 0, 1]; e.bpm = 60; });
  assert.equal(audio(setze(p, grenze)).entstehung.code.length, 20000);
  assert.equal(audio(setze(p, mut((e) => { e.bpm = 200; }))).entstehung.bpm, 200);
  assert.equal(grund(() => fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c2', entstehung: E() })), 'feld_nur_audio');
});

test('remove: entstehung null deletes the field (absent, never null in the file)', () => {
  const q = setze(projekt());
  const r = fuehreAus(q, { befehl: 'clip_aendern', clip_id: 'c1', entstehung: null }).projekt;
  assert.equal('entstehung' in audio(r), false);
  assert.equal(kanonisch(r).includes('entstehung'), false);
  assert.equal(grund(() => fuehreAus(projekt(), { befehl: 'clip_aendern', clip_id: 'c1' })), 'argument_ungueltig', 'a command without any change is still refused');
});

test('old projects stay byte-identical: untouched reopen equals the saved bytes; set + remove leaves no trace; a set field differs', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('Alt');
  pr.speichere(slug, projekt());
  const datei = path.join(w, slug, 'project.json');
  const b0 = fs.readFileSync(datei, 'utf8');
  const offen = pr.lies(slug);
  assert.equal(JSON.stringify(normalisiere(offen), null, 1) + '\n', b0, 'reopened untouched project serialises to the same bytes');
  assert.equal(b0.includes('entstehung'), false);
  const mit = setze(offen);
  const entfernt = fuehreAus(mit, { befehl: 'clip_aendern', clip_id: 'c1', entstehung: null }).projekt;
  pr.speichere(slug, entfernt);
  assert.equal(fs.readFileSync(datei, 'utf8').replace(/"rev": \d+/g, '"rev": 0'), b0.replace(/"rev": \d+/g, '"rev": 0'),
    'set then removed: the file equals the original apart from rev');
  // negative control: with the field still set the bytes differ
  pr.speichere(slug, mit);
  assert.notEqual(fs.readFileSync(datei, 'utf8').replace(/"rev": \d+/g, '"rev": 0'), b0.replace(/"rev": \d+/g, '"rev": 0'));
  assert.ok(fs.readFileSync(datei, 'utf8').includes('"entstehung"'));
});

test('playback is unchanged: the translation with and without entstehung is equal', () => {
  const p = pruefeProjekt(specProjekt()).projekt;   // opened as /2; its audio clip c1 is decoded (fertig), so it really appears in the translation
  const wClips = (w) => w.spuren.flatMap((s) => s.clips ?? []);
  const vorher = uebersetze(p, opt);
  assert.ok(wClips(vorher).some((c) => c.id === 'c1'), 'precondition: the clip is part of the translation');
  const mit = fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', entstehung: E() }).projekt;
  assert.deepEqual(mit.spuren[0].clips[0].entstehung, E());
  assert.deepEqual(uebersetze(mit, opt), vorher);
  // negative control: the comparison sees a real change (a muted clip leaves the translation)
  const stumm = fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', stumm: true }).projekt;
  assert.notDeepEqual(uebersetze(stumm, opt), vorher);
});

test('a /1 file with entstehung is refused as an unknown field (like warp); the same field in /2 is accepted', () => {
  const alt = kopie(JSON.parse(kanonisch(setze(projekt()))));
  alt.format = FORMAT_ALT; delete alt.gruppen; delete alt.master; delete alt.returns;
  assert.match(pruefeFehler(alt) ?? '', /entstehung.*unbekanntes Feld/);
  const neu = JSON.parse(kanonisch(setze(projekt())));
  assert.equal(pruefeFehler(neu), null);
  const ohne = JSON.parse(kanonisch(projekt())); ohne.format = FORMAT_ALT; delete ohne.gruppen; delete ohne.master; delete ohne.returns;
  assert.equal(pruefeFehler(ohne), null, 'negative control: the /1 form of the same project without the field is valid');
});

test('clip_duplizieren and clip_teilen keep entstehung on every resulting clip', () => {
  const q = setze(projekt());
  const d = fuehreAus(q, { befehl: 'clip_duplizieren', clip_id: 'c1' }).projekt;
  assert.equal(d.spuren[0].clips.length, 2);
  for (const c of d.spuren[0].clips) assert.deepEqual(c.entstehung, E());
  const t = fuehreAus(q, { befehl: 'clip_teilen', clip_id: 'c1', beat: 8 }).projekt;
  assert.equal(t.spuren[0].clips.length, 2);
  for (const c of t.spuren[0].clips) assert.deepEqual(c.entstehung, E());
});

test('undo of the clip_aendern restores the absent field, redo sets it again', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug, projekt: leer } = pr.lege('Undo');
  const v = pr.verlauf(slug, { zeitgeber: false });
  let p = aendere(v, leer, [{ befehl: 'spur_neu', art: 'audio', name: 'Take' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: SHA_A }], { quelle: 'cypher', label: 'take' }).projekt;
  const vorher = kanonisch(p);
  p = aendere(v, p, [{ befehl: 'clip_aendern', clip_id: 'c1', entstehung: E() }], { quelle: 'cypher', label: 'entstehung' }).projekt;
  assert.deepEqual(audio(p).entstehung, E());
  p = rueckgaengig(v, p, { quelle: 'cypher' }).projekt;
  assert.equal('entstehung' in audio(p), false);
  assert.equal(kanonisch({ ...p, rev: 0 }), kanonisch({ ...JSON.parse(vorher), rev: 0 }), 'back to the state before, field absent');
  v.schliesse();
});

test('the graph name rule of the model is the one of graphen.ts (regex parity)', () => {
  assert.equal(ENTSTEHUNG_GRAPH.source, GRAPH_NAME.source);
  assert.equal(ENTSTEHUNG_GRAPH.flags, GRAPH_NAME.flags);
});
