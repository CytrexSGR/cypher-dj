// Note editor slice 1, task B1: the clip field `audio_noten` (model check) and its three commands audio_noten_aendern, audio_noten_zuruecksetzen and
// audio_noten_entfernen. Contract: djk/contract/notes.md section "The clip field audio_noten", examples in djk/contract/cases/noten/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { neuesProjekt, pruefeProjekt, pruefeFehler, kanonisch } from '../project/model.ts';
import { rundeTon, ZIEL_FELDER } from '../project/notes_contract.ts';
import { SHA_A, tmpOrdner, ohneAbgeleitetes, specProjekt, kopie } from './support/project.mjs';

const CASES = fileURLToPath(new URL('../../contract/cases/noten/', import.meta.url));
const lies = (n) => JSON.parse(fs.readFileSync(path.join(CASES, n + '.json'), 'utf8'));

const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 120)}`);
const clip = (p, id = 'c1') => p.spuren.flatMap((s) => s.clips).find((c) => c.id === id);
const note = (p, id, cid = 'c1') => clip(p, cid).audio_noten.liste.find((n) => n.id === id);

// audio track s1 with the audio clip c1 (beats 0..8, 4 s at 120 bpm), an instrument track s2 with the MIDI clip c2; `liste` is the field of c1
// (what the analysis of task B2 will place; here it is set directly)
function aufbau(liste = lies('audio_noten_gut')) {
  let p = neuesProjekt('N');
  p = fuehreListeAus(p, [
    { befehl: 'spur_neu', art: 'audio' },
    { befehl: 'spur_neu', art: 'instrument', name: 'RB', geraet: { art: 'intern', name: 'rb338', parameter: {} } },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA_A, pfad_hinweis: '/x/voice.wav' },
    { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4 },
  ]).projekt;
  if (liste !== null) clip(p).audio_noten = kopie(liste);
  return p;
}
const ids = (...x) => x;

test('pruefeProjekt accepts audio_noten (good example of A1) and a project without it saves byte-identical', () => {
  for (const name of ['audio_noten_gut', 'audio_noten_leer_gut', 'audio_noten_ton_24_gut']) {
    const p = aufbau(lies(name));
    assert.equal(pruefeFehler(p), null, name);
    const r = pruefeProjekt(kopie(p));
    assert.ok(r.projekt, name);
    assert.deepEqual(clip(r.projekt).audio_noten, lies(name), `${name}: the field is kept as it is`);
  }
  // no field: the project is what it was, bytes of the canonical form included (old projects stay untouched)
  const ohne = aufbau(null);
  assert.equal('audio_noten' in clip(ohne), false);
  assert.equal(kanonisch(pruefeProjekt(kopie(ohne)).projekt), kanonisch(ohne));
  const spec = specProjekt();
  const geladen = pruefeProjekt(kopie(spec)).projekt;
  assert.equal(JSON.stringify(geladen).includes('audio_noten'), false);
  assert.equal(JSON.stringify(pruefeProjekt(kopie(geladen)).projekt), JSON.stringify(geladen));
});

test('pruefeProjekt refuses each bad example of A1 with a message naming audio_noten', () => {
  const gruende = lies('gruende');
  const schlecht = Object.keys(gruende).filter((n) => n.startsWith('audio_noten_schlecht_'));
  assert.ok(schlecht.length >= 13, `found ${schlecht.length} bad examples`);
  for (const datei of schlecht) {
    const p = aufbau(lies(datei.replace(/\.json$/, '')));
    const f = pruefeFehler(p);
    assert.ok(f, `${datei} must be refused`);
    assert.match(f, /audio_noten/, datei);
    assert.ok('fehler' in pruefeProjekt(kopie(p)), datei);
  }
  // shape errors of the field itself and the wrong clip kind
  for (const x of [null, [], 'x', {}, { kurve: 'pyin-1.noten_hmm-1' }, { liste: [] }, { kurve: 'x', liste: [] },
    { kurve: 'pyin-1.noten_hmm-1', liste: [], mehr: 1 }]) {
    const q = aufbau(null);
    clip(q).audio_noten = x;                       // aufbau(null) means no field, so the value is set here (null included: the field is never null)
    const f = pruefeFehler(q);
    assert.ok(f && /audio_noten/.test(f), JSON.stringify(x));
  }
  const midi = aufbau(null);
  clip(midi, 'c2').audio_noten = lies('audio_noten_gut');
  assert.match(pruefeFehler(midi) ?? '', /audio_noten/, 'a MIDI clip knows no audio_noten');
});

test('audio_noten_aendern ton_um +2 sets ton = qton + 2; a second +2 gives qton + 4; -4 removes ton', () => {
  const p0 = aufbau();
  const q = note(p0, 't1').qton;
  const e1 = fuehreAus(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton_um: 2 });
  assert.equal(note(e1.projekt, 't1').ton, rundeTon(q + 2));
  assert.deepEqual(note(e1.projekt, 't2'), note(p0, 't2'), 'other notes are untouched');
  assert.equal('ton' in note(p0, 't1'), false, 'the input project is not changed');
  const e2 = fuehreAus(e1.projekt, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton_um: 2 });
  assert.equal(note(e2.projekt, 't1').ton, rundeTon(q + 4));
  const e3 = fuehreAus(e2.projekt, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton_um: -4 });
  assert.equal('ton' in note(e3.projekt, 't1'), false, 'back on qton: the target is not stored');
  assert.deepEqual(note(e3.projekt, 't1'), note(p0, 't1'));
  // a note that already has a target moves from that target, not from qton
  const e4 = fuehreAus(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t2'), ton_um: 2 });
  assert.equal(note(e4.projekt, 't2').ton, rundeTon(note(p0, 't2').ton + 2));
  // the result is a valid project; the change is a pair of patches that leads there and back
  assert.equal(pruefeFehler(e2.projekt), null);
  // 24 semitones above a qton with five decimals is inside (the rounding rule of the contract)
  const gr = aufbau(lies('audio_noten_ton_24_gut'));
  gr.spuren[0].clips[0].audio_noten.liste.forEach((n) => { delete n.ton; });
  const e5 = fuehreAus(gr, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids(gr.spuren[0].clips[0].audio_noten.liste[0].id), ton_um: 24 });
  assert.equal(e5.projekt.spuren[0].clips[0].audio_noten.liste[0].ton, 84.1235);
  // the fixed-point rule: equal to qton within 1e-4 removes the target
  const e6 = fuehreAus(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t2'), ton: note(p0, 't2').qton + 0.00004 });
  assert.equal('ton' in note(e6.projekt, 't2'), false);
});

test('audio_noten_aendern ton absolute on two ids; beyond 24 semitones -> noten_ton_grenze; formant -> argument_unbekannt', () => {
  const p0 = aufbau();
  const e = fuehreAus(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1', 't3'), ton: 65.5 });
  assert.equal(note(e.projekt, 't1').ton, 65.5);
  assert.equal(note(e.projekt, 't3').ton, 65.5);
  assert.deepEqual(note(e.projekt, 't2'), note(p0, 't2'));
  const e2 = fuehreAus(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton: 60.123456789 });
  assert.equal(note(e2.projekt, 't1').ton, 60.1235, 'rounded to 1e-4 with rundeTon');
  const q1 = note(p0, 't1').qton;
  const gr = (b) => lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ...b }, 'noten_ton_grenze');
  gr({ ids: ids('t1'), ton: q1 + 24.01 });
  gr({ ids: ids('t1'), ton: q1 - 24.01 });
  gr({ ids: ids('t1'), ton_um: 25 });
  gr({ ids: ids('t1'), ton_um: -25 });
  gr({ ids: ids('t1'), ton: 128 });
  gr({ ids: ids('t1'), ton: -1 });
  gr({ ids: ids('t1', 't3'), ton: q1 + 24.01 });   // one id beyond the span refuses the whole command
  const rand = fuehreAus(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton: q1 + 24 });
  assert.equal(note(rand.projekt, 't1').ton, rundeTon(q1 + 24), '24 is inside');
  // the span is checked on the sum: a target of 90 for a note near MIDI 127 is outside 0..127
  const hoch = aufbau(); note(hoch, 't1').qton = 120;
  lehntAb(hoch, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton: 128 }, 'noten_ton_grenze');
  lehntAb(hoch, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton_um: 8 }, 'noten_ton_grenze');
  for (const feld of ['formant', 'gain_db']) {
    lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton: 61, [feld]: 1.5 }, 'argument_unbekannt');
  }
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton: 61, quatsch: 1 }, 'argument_unbekannt');
});

test('refusals: MIDI clip feld_nur_audio, unknown id noten_unbekannt, empty ids argument_ungueltig, no field keine_audio_noten', () => {
  const p0 = aufbau();
  const alle = [
    { befehl: 'audio_noten_aendern', ids: ids('t1'), ton: 61 },
    { befehl: 'audio_noten_zuruecksetzen', ids: ids('t1') },
    { befehl: 'audio_noten_entfernen' },
  ];
  for (const b of alle) {
    lehntAb(p0, { ...b, clip_id: 'c2' }, 'feld_nur_audio');
    lehntAb(p0, { ...b, clip_id: 'c99' }, 'clip_unbekannt');
    lehntAb(aufbau(null), { ...b, clip_id: 'c1' }, 'keine_audio_noten');
    lehntAb(p0, { ...b, clip_id: 7 }, 'argument_ungueltig');
  }
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t9'), ton: 61 }, 'noten_unbekannt');
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1', 't9'), ton: 61 }, 'noten_unbekannt');
  lehntAb(p0, { befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1', ids: ids('t9') }, 'noten_unbekannt');
  // the list of an empty field knows no note
  lehntAb(aufbau(lies('audio_noten_leer_gut')), { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton: 61 }, 'noten_unbekannt');
  // argument shapes
  const a = (b) => lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ...b }, 'argument_ungueltig');
  a({ ids: [], ton: 61 });
  a({ ton: 61 });
  a({ ids: 't1', ton: 61 });
  a({ ids: ids('t1', 't1'), ton: 61 });
  a({ ids: [1], ton: 61 });
  a({ ids: [''], ton: 61 });
  a({ ids: Array.from({ length: 4097 }, (_, i) => `t${i + 1}`), ton: 61 });
  a({ ids: ids('t1') });
  a({ ids: ids('t1'), ton: 61, ton_um: 1 });
  a({ ids: ids('t1'), ton: '61' });
  a({ ids: ids('t1'), ton: null });
  a({ ids: ids('t1'), ton: Number.NaN });
  a({ ids: ids('t1'), ton_um: Infinity });
  a({ ids: ids('t1'), ton_um: '2' });
  const z = (b) => lehntAb(p0, { befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1', ...b }, 'argument_ungueltig');
  z({ ids: [] });
  z({ ids: ids('t1', 't1') });
  z({ ids: 't1' });
  z({ ids: [3] });
  lehntAb(p0, { befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1', ids: ids('t1'), mehr: 1 }, 'argument_unbekannt');
  lehntAb(p0, { befehl: 'audio_noten_entfernen', clip_id: 'c1', ids: ids('t1') }, 'argument_unbekannt');
  // the largest list is fine (the notes must exist: a project with 4096 notes is checked by the model; here the limit of the argument is what counts)
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: Array.from({ length: 4096 }, (_, i) => `t${i + 1}`), ton: 61 }, 'noten_unbekannt');
});

test('audio_noten_zuruecksetzen with and without ids; audio_noten_entfernen drops the field', () => {
  const p0 = aufbau();
  const l = clip(p0).audio_noten.liste;
  Object.assign(l[0], { ton: 62, vib: 1.5, gain_db: -3 });
  assert.equal(pruefeFehler(p0), null, 'the prepared field is valid');
  const e1 = fuehreAus(p0, { befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1', ids: ids('t1') });
  assert.deepEqual(Object.keys(note(e1.projekt, 't1')), ['id', 'qa', 'qe', 'qton', 'p'], 'every target field of t1 is gone');
  assert.deepEqual(note(e1.projekt, 't2'), note(p0, 't2'), 't2 keeps its target');
  const e2 = fuehreAus(p0, { befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1' });
  for (const n of clip(e2.projekt).audio_noten.liste) {
    assert.equal(ZIEL_FELDER.some((f) => n[f] !== undefined), false, `${n.id} has no target field`);
  }
  assert.equal(clip(e2.projekt).audio_noten.liste.length, 3, 'the notes themselves stay');
  assert.equal(clip(e2.projekt).audio_noten.kurve, clip(p0).audio_noten.kurve);
  assert.equal(pruefeFehler(e2.projekt), null);
  // ids in a second order: the list order is the list's, not the ids'
  const e3 = fuehreAus(p0, { befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1', ids: ids('t2', 't1') });
  assert.deepEqual(clip(e3.projekt).audio_noten.liste.map((n) => n.id), ['t1', 't2', 't3']);
  const e4 = fuehreAus(p0, { befehl: 'audio_noten_entfernen', clip_id: 'c1' });
  assert.equal('audio_noten' in clip(e4.projekt), false, 'the field is deleted, not set to null');
  assert.equal(pruefeFehler(e4.projekt), null);
  // after the removal the clip is what a clip without detection is; the commands then say keine_audio_noten
  assert.equal(kanonisch(ohneAbgeleitetes(e4.projekt)), kanonisch(ohneAbgeleitetes((() => { const q = kopie(p0); delete clip(q).audio_noten; return q; })())));
  lehntAb(e4.projekt, { befehl: 'audio_noten_entfernen', clip_id: 'c1' }, 'keine_audio_noten');
  // an empty field (detection found nothing) can be removed too
  const e5 = fuehreAus(aufbau(lies('audio_noten_leer_gut')), { befehl: 'audio_noten_entfernen', clip_id: 'c1' });
  assert.equal('audio_noten' in clip(e5.projekt), false);
});

test('each command is one undo step; undo restores the stored bytes', (t) => {
  const dir = tmpOrdner(t);
  const v = new Verlauf(path.join(dir, 'undo.jsonl'), { zeitgeber: false });
  const meta = { quelle: 'andreas', label: 'Note pitch' };
  const ohneRev = (p) => ohneAbgeleitetes({ ...p, rev: 0, wiedergabe_rev: 0 });
  let p = aufbau();
  const folge = [
    { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1', 't3'), ton_um: 2 },
    { befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1', ids: ids('t2') },
    { befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1' },
    { befehl: 'audio_noten_entfernen', clip_id: 'c1' },
  ];
  const staende = [p];
  for (const b of folge) {
    const r = aendere(v, p, [b], meta);
    assert.ok(r.eintrag, `${b.befehl}: a history entry`);
    assert.equal(r.projekt.rev, p.rev + 1, `${b.befehl}: one revision`);
    p = r.projekt;
    staende.push(p);
  }
  for (let i = folge.length - 1; i >= 0; i--) {
    p = rueckgaengig(v, p, { quelle: 'andreas' }).projekt;
    assert.equal(ohneRev(p), ohneRev(staende[i]), `undo of ${folge[i].befehl} restores the stand before it`);
    assert.deepEqual(clip(p).audio_noten, clip(staende[i]).audio_noten);
  }
  // a command with two ids is one step, not one per note
  assert.equal(JSON.stringify(clip(p).audio_noten), JSON.stringify(clip(staende[0]).audio_noten), 'the stored field is byte-identical after the undos');
  // a refused command leaves no entry and no change
  const vorher = ohneRev(p);
  assert.throws(() => aendere(v, p, [{ befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton: 127 }], meta), (e) => e.grund === 'noten_ton_grenze');
  assert.equal(ohneRev(p), vorher);
  // the patches of a command list are replayable
  const r = fuehreListeAus(staende[0], [folge[0], { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t2'), ton_um: -1 }]);
  assert.ok(r.vor.length > 0 && r.zurueck.length > 0);
});

test('clip_teilen and clip_duplizieren copy audio_noten unchanged; clip_aendern offset_s leaves it unchanged', () => {
  let p = aufbau();
  clip(p).audio_noten.liste[0].ton = 62;
  const alt = kopie(clip(p).audio_noten);
  const geteilt = fuehreAus(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: 4 }).projekt;
  const teile = geteilt.spuren[0].clips;
  assert.equal(teile.length, 2);
  for (const c of teile) assert.deepEqual(c.audio_noten, alt, `${c.id}: the list is copied unchanged (notes outside the audible range stay)`);
  assert.notEqual(teile[0].audio_noten, teile[1].audio_noten, 'a copy, not a shared object');
  assert.equal(pruefeFehler(geteilt), null);
  // the two halves glue back to what they were
  const verbunden = fuehreAus(geteilt, { befehl: 'clips_verbinden', clip_ids: [teile[0].id, teile[1].id] }).projekt;
  assert.deepEqual(verbunden.spuren[0].clips[0].audio_noten, alt);
  // an edit of one half does not touch the other
  const eins = fuehreAus(geteilt, { befehl: 'audio_noten_aendern', clip_id: teile[1].id, ids: ids('t1'), ton_um: 3 }).projekt;
  assert.deepEqual(eins.spuren[0].clips[0].audio_noten, alt);
  assert.equal(eins.spuren[0].clips[1].audio_noten.liste[0].ton, rundeTon(62 + 3));
  // duplicate: into the same track, behind the clip
  const dup = fuehreAus(p, { befehl: 'clip_duplizieren', clip_id: 'c1' }).projekt;
  assert.equal(dup.spuren[0].clips.length, 2);
  assert.deepEqual(dup.spuren[0].clips[1].audio_noten, alt);
  assert.notEqual(dup.spuren[0].clips[1].audio_noten, dup.spuren[0].clips[0].audio_noten);
  // offset, loop, gain, start and length change nothing at the field
  for (const b of [{ offset_s: 0.5 }, { loop_beats: 2 }, { gain_db: -3 }, { start_beat: 3 }, { laenge_beats: 2 }]) {
    const q = fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', ...b }).projekt;
    assert.deepEqual(clip(q).audio_noten, alt, JSON.stringify(b));
  }
});

test('MIDI noten_aendern on an audio clip is refused as before', () => {
  const p0 = aufbau();
  lehntAb(p0, { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 't1', ton: 61 }] }, 'clip_nicht_midi');
  lehntAb(p0, { befehl: 'noten_loeschen', clip_id: 'c1', ids: ids('t1') }, 'clip_nicht_midi');
  lehntAb(p0, { befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] }, 'clip_nicht_midi');
  // and the MIDI commands still work on the MIDI clip
  const e = fuehreAus(p0, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] });
  assert.equal(clip(e.projekt, 'c2').noten.length, 1);
});

test('a project with audio_noten in a format that does not allow it (/1) is refused with a message naming audio_noten', () => {
  const alt = specProjekt();                       // format /1
  alt.spuren[0].clips[0].audio_noten = lies('audio_noten_gut');
  const f = pruefeFehler(alt);
  assert.ok(f, 'refused');
  assert.match(f, /audio_noten/);
  assert.match(f, /unbekanntes Feld|unknown field/);
  assert.ok('fehler' in pruefeProjekt(alt));
  // the same field in /2 and /3 is accepted (like warp)
  for (const format of ['cypherdj-projekt/2', 'cypherdj-projekt/3']) {
    const q = specProjekt();
    q.format = format;
    if (format.endsWith('/3')) Object.assign(q, { gruppen: [], master: { fader_db: 0 }, naechste_id: { spur: 4, clip: 3, gruppe: 1 } });
    q.spuren[0].clips[0].audio_noten = lies('audio_noten_gut');
    const r = pruefeProjekt(kopie(q));
    assert.ok(r.projekt || !/audio_noten/.test(r.fehler), `${format}: ${r.fehler}`);
  }
});

// ---- slice 2, task T3: time fields (a, e, zeit_um, mit_nachbarn) ----------------------------------------------------------------
// aufbau(): t1 0.5..1.0, t2 1.0..1.5 (touches t1, has ton 64.5), t3 2.0..2.6 (gap of 0.5 s to t2)
const zeit = (p, b) => fuehreAus(p, { befehl: 'audio_noten_aendern', clip_id: 'c1', ...b }).projekt;
const eff = (p, id) => { const n = note(p, id); return [n.a ?? n.qa, n.e ?? n.qe]; };

test('zeit_um moves both edges, keeps ton, ids in any order, 0 is no change', () => {
  const p0 = aufbau();
  const p1 = zeit(p0, { ids: ids('t3'), zeit_um: 0.1 });
  assert.deepEqual(eff(p1, 't3'), [2.1, 2.7]);
  assert.deepEqual(eff(p1, 't2'), [1.0, 1.5], 'the gap gives: t2 stays');
  const p2 = zeit(p0, { ids: ids('t2'), zeit_um: 0.1, mit_nachbarn: false });
  assert.equal(note(p2, 't2').ton, 64.5, 'ton kept when moved');
  assert.deepEqual(eff(p2, 't2'), [1.1, 1.6]);
  const p3 = zeit(p0, { ids: ids('t2', 't1'), zeit_um: 0.05 });   // order of ids does not matter
  assert.deepEqual(eff(p3, 't1'), [0.55, 1.05]);
  assert.deepEqual(eff(p3, 't2'), [1.05, 1.55]);
  assert.deepEqual(eff(p3, 't3'), [2.0, 2.6], 'the gap after t2 gives');
  // a moved note that touches an unmoved one in the middle of the selection overlaps it: refused
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1', 't3'), zeit_um: 0.05 }, 'noten_ueberlappen');
  const p4 = zeit(p0, { ids: ids('t1'), zeit_um: 0 });
  assert.deepEqual(p4.spuren, p0.spuren);
  assert.equal('a' in note(p1, 't2'), false);
});

test('absolute a and e; a value equal to qa/qe removes the field; one id only', () => {
  const p0 = aufbau();
  const p1 = zeit(p0, { ids: ids('t3'), a: 1.9, e: 2.8 });
  assert.deepEqual(eff(p1, 't3'), [1.9, 2.8]);
  const p2 = zeit(p1, { ids: ids('t3'), a: 2.0000004, e: 2.6 });
  assert.equal('a' in note(p2, 't3'), false);
  assert.equal('e' in note(p2, 't3'), false);
  const p3 = zeit(p0, { ids: ids('t3'), e: 2.9 });
  assert.deepEqual(eff(p3, 't3'), [2.0, 2.9]);
  assert.equal(note(p3, 't3').e, 2.9);
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1', 't3'), a: 0.4 }, 'argument_ungueltig');
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3'), a: 1.9, zeit_um: 0.1 }, 'argument_ungueltig');
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3'), zeit_um: 'x' }, 'argument_ungueltig');
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3'), zeit_um: 0.1, mit_nachbarn: 'ja' }, 'argument_ungueltig');
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3') }, 'argument_ungueltig');
});

test('neighbour follows when touching (gap < 40 ms), gap gives otherwise, mit_nachbarn false leaves it', () => {
  const p0 = aufbau();
  // t2 start moved to 1.2 (shorter): t1 touched it, so t1.e follows to 1.2
  const p1 = zeit(p0, { ids: ids('t2'), a: 1.2 });
  assert.deepEqual(eff(p1, 't1'), [0.5, 1.2]);
  assert.equal(note(p1, 't1').e, 1.2);
  // end of t2 extended to 1.9: t3 starts 0.5 s later, the gap gives, t3 stays
  const p2 = zeit(p0, { ids: ids('t2'), e: 1.9 });
  assert.deepEqual(eff(p2, 't3'), [2.0, 2.6]);
  // without neighbours the touching note overlaps
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t2'), a: 0.9, mit_nachbarn: false }, 'noten_ueberlappen');
  // with neighbours the same edit shortens t1
  assert.deepEqual(eff(zeit(p0, { ids: ids('t2'), a: 0.9 }), 't1'), [0.5, 0.9]);
  // a gap of 30 ms counts as touching, 50 ms does not
  const q = aufbau(); note(q, 't2').qa = 1.03; note(q, 't2').qe = 1.5;
  assert.deepEqual(eff(zeit(q, { ids: ids('t2'), a: 1.3 }), 't1'), [0.5, 1.3]);
  const r = aufbau(); note(r, 't2').qa = 1.05; note(r, 't2').qe = 1.5;
  assert.deepEqual(eff(zeit(r, { ids: ids('t2'), a: 1.3 }), 't1'), [0.5, 1.0]);
});

test('refusals: start before 0, overlap, stretch beyond 0.25..4; nothing is written', () => {
  const p0 = aufbau();
  const vorher = JSON.stringify(p0);
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), zeit_um: -0.6 }, 'argument_ungueltig');
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3'), zeit_um: -0.7 }, 'noten_ueberlappen');   // t3.a 1.3 into t2 (1.0..1.5)
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3'), a: 1.0 }, 'noten_ueberlappen');
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3'), e: 2.0 + 0.6 * 4.2 }, 'noten_dehnung_grenze');   // factor 4.2
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3'), e: 2.0 + 0.6 * 0.2 }, 'noten_dehnung_grenze');   // factor 0.2
  const ok = zeit(p0, { ids: ids('t3'), e: 2.0 + 0.6 * 4 });
  assert.equal(eff(ok, 't3')[1], 4.4, 'factor exactly 4 is allowed');
  // a neighbour dragged along is checked too: t1 shortened to 0.03 s of a 0.5 s note would be below a quarter
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t2'), a: 0.55 }, 'noten_dehnung_grenze');
  // both pitch and time: a refused time part writes nothing of the pitch part
  lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3'), ton: 61, a: 1.0 }, 'noten_ueberlappen');
  assert.equal(JSON.stringify(p0), vorher);
});

test('pitch and time in one command are one undo step; undo restores', (t) => {
  const p = aufbau();
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { zeitgeber: false });
  const meta = { quelle: 'andreas', label: 'Note time' };
  const r = aendere(v, p, [{ befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t3'), ton_um: 2, zeit_um: 0.1 }], meta);
  const p1 = r.projekt;
  assert.deepEqual(eff(p1, 't3'), [2.1, 2.7]);
  assert.equal(note(p1, 't3').ton, rundeTon(59.7 + 2));
  const z = rueckgaengig(v, p1, { quelle: 'andreas' }).projekt;
  assert.deepEqual(clip(z).audio_noten, clip(p).audio_noten);
});

test('audio_noten_aendern vib and drift: absolute 0..4 or a delta, rounded to 1e-3, 1 not stored, only the factor written, one undo step', () => {
  const p0 = aufbau();
  const e = fuehreAus(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1', 't2'), vib: 0 });
  assert.equal(note(e.projekt, 't1').vib, 0);
  assert.equal(note(e.projekt, 't2').vib, 0);
  assert.equal(note(e.projekt, 't1').ton, undefined, 'only the factor is written');
  const e2 = fuehreAus(e.projekt, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), vib_um: 0.5, drift: 2.00049 });
  assert.equal(note(e2.projekt, 't1').vib, 0.5);
  assert.equal(note(e2.projekt, 't1').drift, 2, 'rounded to 1e-3');
  const e3 = fuehreAus(e2.projekt, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), vib_um: 0.5, drift_um: -1 });
  assert.equal('vib' in note(e3.projekt, 't1'), false, 'back at 1: not stored');
  assert.equal('drift' in note(e3.projekt, 't1'), false);
  const e4 = fuehreAus(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ton: 61, vib: 1.5 });
  assert.equal(note(e4.projekt, 't1').ton, 61);
  assert.equal(note(e4.projekt, 't1').vib, 1.5, 'pitch and factor in one command');
  const un = (b) => lehntAb(p0, { befehl: 'audio_noten_aendern', clip_id: 'c1', ids: ids('t1'), ...b }, 'argument_ungueltig');
  un({ vib: 4.5 });
  un({ drift: -0.1 });
  un({ vib: 1, vib_um: 0.2 });
  un({ vib_um: 4 });
  un({ drift: 'viel' });
});
