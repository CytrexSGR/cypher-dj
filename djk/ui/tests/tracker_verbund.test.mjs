// Tracker task 7: linked clips (field `verbund`) with fan-out in the command layer (ADR 039).
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt, pruefeFehler } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { FAECHER_BEFEHLE, mitglieder, weite, verbundPruefung } from '../project/verbund.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { musterZuEreignissen } from '../../generator/src/pattern_ereignisse.mjs';
import { kopie, tmpOrdner } from './support/project.mjs';
import path from 'node:path';

const lauf = (p, ...b) => fuehreListeAus(kopie(p), b).projekt;
const grund = (p, ...b) => { try { fuehreListeAus(kopie(p), b); return null; } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e.grund; } };
const GERAET = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
const instr = (p, name = 'I') => lauf(p, { befehl: 'spur_neu', art: 'instrument', name, geraet: GERAET });
const NOTE0 = [{ beat: 3, laenge: 0.5, ton: 72, vel: 80 }];   // clip_neu wants at least one note
const clipNeu = (spur, start, noten = NOTE0) => ({ befehl: 'clip_neu', spur_id: spur, art: 'midi', start_beat: start, laenge_beats: 4, noten });
const clip = (p, id) => p.spuren.flatMap((s) => s.clips).find((c) => c.id === id);
const sig = (c) => JSON.stringify(c.noten);

// two clips c1, c2 on s1 (c1 has one note), linked: both carry that note
function verknuepft() {
  let p = instr(neuesProjekt('x'));
  p = lauf(p, clipNeu('s1', 0, [{ beat: 0, laenge: 1, ton: 60, vel: 100 }]), clipNeu('s1', 8));
  return lauf(p, { befehl: 'clip_verknuepfen', clip_id: 'c2', mit: 'c1' });
}

test('constants and mitglieder', () => {
  assert.deepEqual([...FAECHER_BEFEHLE], ['noten_neu', 'noten_aendern', 'noten_loeschen', 'zeile_setzen', 'huellkurve_setzen', 'huellkurve_loeschen', 'clip_aus_muster', 'fx_setzen']);
  const p = verknuepft();
  assert.deepEqual(mitglieder(p, 'c2').map((c) => c.id), ['c2', 'c1']);
  assert.deepEqual(mitglieder(p, 'c1').map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(mitglieder(p, 'nope'), []);
});

test('clip_verknuepfen: content of clip_id is replaced by the content of mit, both get one verbund', () => {
  const p = verknuepft();
  assert.match(clip(p, 'c1').verbund, /^v[0-9]+$/);
  assert.ok(clip(p, 'c1').verbund === clip(p, 'c2').verbund);
  assert.equal(p.naechste_id.verbund, 2);
  assert.equal(sig(clip(p, 'c2')), sig(clip(p, 'c1')));
  assert.equal(clip(p, 'c2').noten[0].id, clip(p, 'c1').noten[0].id);
  assert.equal(verbundPruefung(p), null);
  assert.equal(pruefeFehler(p), null);
});

test('clip_verknuepfen: refusals', () => {
  let p = instr(neuesProjekt('x'));
  p = instr(p, 'J');
  p = lauf(p, clipNeu('s1', 0), clipNeu('s2', 0), clipNeu('s1', 8));
  assert.equal(grund(p, { befehl: 'clip_verknuepfen', clip_id: 'c2', mit: 'c1' }), 'verbund_spur');
  assert.equal(grund(p, { befehl: 'clip_verknuepfen', clip_id: 'c1', mit: 'c1' }), 'argument_ungueltig');
  assert.equal(grund(p, { befehl: 'clip_verknuepfen', clip_id: 'c1', mit: 'c9' }), 'clip_unbekannt');
  assert.equal(grund(p, { befehl: 'clip_entknuepfen', clip_id: 'c9' }), 'clip_unbekannt');
});

test('noten_neu on a member adds the note with the same id to both members', () => {
  const p = lauf(verknuepft(), { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 1, laenge: 1, ton: 64, vel: 90 }, { beat: 2, laenge: 1, ton: 67, vel: 90 }] });
  assert.equal(clip(p, 'c1').noten.length, 3);
  assert.deepEqual(clip(p, 'c1').noten.map((n) => n.id), clip(p, 'c2').noten.map((n) => n.id));
  assert.equal(sig(clip(p, 'c1')), sig(clip(p, 'c2')));
  assert.equal(new Set(clip(p, 'c1').noten.map((n) => n.id)).size, 3);
  assert.equal(verbundPruefung(p), null);
  // the counter moved past the drawn ids: the next note does not reuse them
  const q = lauf(p, { befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 3, laenge: 1, ton: 70, vel: 90 }] });
  assert.equal(new Set(clip(q, 'c1').noten.map((n) => n.id)).size, 4);
});

test('noten_neu with an explicit id below the counter is still refused in a pattern; an explicit new id reaches all members', () => {
  const p = verknuepft();
  assert.equal(grund(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'n1', beat: 1, laenge: 1, ton: 64, vel: 90 }] }), 'id_belegt');
  const q = lauf(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'kick', beat: 1, laenge: 1, ton: 64, vel: 90 }] });
  assert.ok(clip(q, 'c1').noten.some((n) => n.id === 'kick') && clip(q, 'c2').noten.some((n) => n.id === 'kick'));
});

test('noten_aendern, noten_loeschen, zeile_setzen, huellkurve_setzen/loeschen reach both members', () => {
  let p = verknuepft();
  const id = clip(p, 'c1').noten[0].id;
  p = lauf(p, { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id, ton: 62 }] });
  assert.equal(clip(p, 'c2').noten[0].ton, 62);
  p = lauf(p, { befehl: 'zeile_setzen', clip_id: 'c2', ton: 62, schritte: 8 });
  assert.deepEqual(clip(p, 'c1').zeilen, { 62: { schritte: 8 } });
  p = lauf(p, { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: 'spur_pan', punkte: [{ beat: 0, wert: 0.5 }, { beat: 2, wert: -0.5 }] });
  assert.ok(clip(p, 'c1').huellkurven?.length === 1);
  assert.equal(JSON.stringify(clip(p, 'c1').huellkurven), JSON.stringify(clip(p, 'c2').huellkurven));
  p = lauf(p, { befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'spur_pan' });
  assert.ok(clip(p, 'c2').huellkurven === undefined);
  p = lauf(p, { befehl: 'noten_loeschen', clip_id: 'c2', ids: [id] });
  assert.equal(clip(p, 'c1').noten.length, 0);
  assert.equal(verbundPruefung(p), null);
});

test('clip_aendern: name, laenge_beats, loop_beats, seq fan out', () => {
  let p = verknuepft();
  p = lauf(p, { befehl: 'clip_aendern', clip_id: 'c2', name: 'Verse', laenge_beats: 8, loop_beats: 4 });
  for (const id of ['c1', 'c2']) {
    assert.equal(clip(p, id).name, 'Verse'); assert.equal(clip(p, id).laenge_beats, 8); assert.equal(clip(p, id).loop_beats, 4);
  }
  assert.ok(clip(p, 'c1').verbund === clip(p, 'c2').verbund && clip(p, 'c1').verbund !== undefined);
});

test('the PRODUCTION left trim (clip_aendern start_beat + noten_loeschen) unlinks the clip and leaves the other member untouched', () => {
  const p0 = verknuepft();
  const id = clip(p0, 'c1').noten[0].id;
  const p = lauf(p0, { befehl: 'clip_aendern', clip_id: 'c2', start_beat: 9, laenge_beats: 3 }, { befehl: 'noten_loeschen', clip_id: 'c2', ids: [id] });
  assert.equal(clip(p, 'c2').noten.length, 0);
  assert.equal(clip(p, 'c2').verbund, undefined);
  assert.equal(clip(p, 'c1').verbund, undefined, 'a pattern left with one member loses its verbund');
  assert.equal(clip(p, 'c1').noten.length, 1);
  assert.equal(clip(p, 'c1').laenge_beats, 4);
  assert.equal(JSON.stringify(clip(p, 'c1').noten), JSON.stringify(clip(p0, 'c1').noten));
});

test('a pure move in time (clip_aendern with start_beat alone) keeps the link; the other member and the content stay as they are', () => {
  const p0 = verknuepft();
  const p = lauf(p0, { befehl: 'clip_aendern', clip_id: 'c2', start_beat: 9 });
  assert.equal(clip(p, 'c2').start_beat, 9);
  assert.equal(clip(p, 'c2').verbund, clip(p0, 'c2').verbund);
  assert.equal(clip(p, 'c1').verbund, clip(p0, 'c1').verbund);
  assert.equal(clip(p, 'c1').start_beat, 0, 'the other member does not move');
  assert.equal(sig(clip(p, 'c2')), sig(clip(p0, 'c2')));
  assert.equal(pruefeFehler(p), null);
  // all members at once (a moved selection)
  const q = lauf(p0, { befehl: 'clip_aendern', clip_id: 'c1', start_beat: 1 }, { befehl: 'clip_aendern', clip_id: 'c2', start_beat: 9 });
  assert.equal(mitglieder(q, 'c1').length, 2);
  assert.deepEqual([clip(q, 'c1').start_beat, clip(q, 'c2').start_beat], [1, 9]);
});

test('a left trim (start_beat with another field) and a track change still unlink', () => {
  const p0 = verknuepft();
  for (const felder of [{ start_beat: 9, laenge_beats: 3 }, { start_beat: 9, name: 'X' }]) {
    const p = lauf(p0, { befehl: 'clip_aendern', clip_id: 'c2', ...felder });
    assert.equal(clip(p, 'c2').verbund, undefined, JSON.stringify(felder));
    assert.equal(clip(p, 'c1').verbund, undefined);
  }
  const q = lauf(instr(p0, 'J'), { befehl: 'clip_aendern', clip_id: 'c2', spur_id: 's2' });
  assert.equal(clip(q, 'c2').verbund, undefined);
});

test('unlink: spur_id, clip_teilen, clips_verbinden, clip_entknuepfen, clip_loeschen', () => {
  let p = instr(neuesProjekt('x'));
  p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'J', geraet: GERAET });
  p = lauf(p, clipNeu('s1', 0, [{ beat: 0, laenge: 1, ton: 60, vel: 100 }]), clipNeu('s1', 8), clipNeu('s1', 16));
  p = lauf(p, { befehl: 'clip_verknuepfen', clip_id: 'c2', mit: 'c1' }, { befehl: 'clip_verknuepfen', clip_id: 'c3', mit: 'c1' });
  assert.equal(mitglieder(p, 'c1').length, 3);
  // move to another track: leaves the pattern, the other two stay linked
  let q = lauf(p, { befehl: 'clip_aendern', clip_id: 'c3', spur_id: 's2' });
  assert.equal(clip(q, 'c3').verbund, undefined); assert.equal(mitglieder(q, 'c1').length, 2);
  // split: both parts are unlinked, two members remain
  q = lauf(p, { befehl: 'clip_teilen', clip_id: 'c3', beat: 18 });
  const teile = q.spuren[0].clips.filter((c) => c.start_beat >= 16);
  assert.ok(teile.length === 2 && teile.every((c) => c.verbund === undefined)); assert.equal(mitglieder(q, 'c1').length, 2);
  // glue
  q = lauf(p, { befehl: 'clips_verbinden', clip_ids: ['c2', 'c3'] });
  assert.equal(clip(q, 'c2').verbund, undefined); assert.equal(clip(q, 'c1').verbund, undefined);
  // explicit unlink; with three members two stay
  q = lauf(p, { befehl: 'clip_entknuepfen', clip_id: 'c2' });
  assert.equal(clip(q, 'c2').verbund, undefined); assert.equal(mitglieder(q, 'c1').length, 2);
  q = lauf(q, { befehl: 'clip_entknuepfen', clip_id: 'c3' });
  assert.equal(clip(q, 'c1').verbund, undefined);
  // delete a member: the other loses verbund too
  q = lauf(lauf(p, { befehl: 'clip_loeschen', clip_id: 'c3' }), { befehl: 'clip_loeschen', clip_id: 'c2' });
  assert.equal(clip(q, 'c1').verbund, undefined);
  assert.equal(pruefeFehler(q), null);
});

test('clip_duplizieren: a copy of a linked clip is a new member; of an unlinked clip it stays unlinked', () => {
  const p = lauf(verknuepft(), { befehl: 'clip_duplizieren', clip_id: 'c1', ziel_beat: 16 });
  const neu = p.spuren[0].clips.find((c) => c.start_beat === 16);
  assert.ok(neu.verbund === clip(p, 'c1').verbund && neu.verbund !== undefined);
  assert.equal(mitglieder(p, 'c1').length, 3);
  assert.equal(verbundPruefung(p), null);
  const u = lauf(instr(neuesProjekt('x')), clipNeu('s1', 0), { befehl: 'clip_duplizieren', clip_id: 'c1' });
  assert.ok(u.spuren[0].clips.every((c) => c.verbund === undefined));
  // a copy on another track is alone there and unlinked
  const w = lauf(instr(p, 'J'), { befehl: 'clip_duplizieren', clip_id: 'c1', spur_id: 's2' });
  assert.equal(w.spuren[1].clips[0].verbund, undefined);
});

test('weite: the command per member, the clip itself first; note ids are drawn once', () => {
  const p = kopie(verknuepft());
  const z0 = p.naechste_noten_id;
  const cmds = weite(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 1, laenge: 1, ton: 64, vel: 90 }] });
  assert.deepEqual(cmds.map((c) => c.clip_id), ['c2', 'c1']);
  assert.equal(cmds[0].noten[0].id, cmds[1].noten[0].id);
  assert.equal(p.naechste_noten_id, z0 + 1);
  assert.deepEqual(weite(p, { befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1'] }).map((c) => c.clip_id), ['c1', 'c2']);
});

test('undo of a fan-out is one history step that restores both members (redo brings it back)', (t) => {
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 1_000_000, zeitgeber: false });
  const p0 = verknuepft();
  const w = aendere(v, kopie(p0), [{ befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 1, laenge: 1, ton: 64, vel: 90 }, { beat: 2, laenge: 1, ton: 65, vel: 90 }] },
    { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', ton: 61 }] }], { quelle: 'andreas', label: 'edit' });
  assert.equal(clip(w.projekt, 'c1').noten.length, 3);
  assert.equal(sig(clip(w.projekt, 'c1')), sig(clip(w.projekt, 'c2')));
  const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
  assert.equal(sig(clip(u.projekt, 'c1')), sig(clip(p0, 'c1')));
  assert.equal(sig(clip(u.projekt, 'c2')), sig(clip(p0, 'c2')));
  assert.equal(clip(u.projekt, 'c1').verbund, clip(p0, 'c1').verbund);
  const r = wiederholen(v, u.projekt, { quelle: 'andreas' });
  assert.equal(sig(clip(r.projekt, 'c2')), sig(clip(w.projekt, 'c2')));
  assert.equal(sig(clip(r.projekt, 'c1')), sig(clip(w.projekt, 'c1')));
});

test('verbundPruefung catches a hand-edited difference; pruefeProjekt refuses it', () => {
  const p = kopie(verknuepft());
  assert.equal(verbundPruefung(p), null);
  clip(p, 'c2').noten[0].ton = 61;
  const f = verbundPruefung(p);
  assert.equal(f.grund, 'verbund_ungleich');
  assert.match(f.text, /c1/); assert.match(f.text, /c2/); assert.match(f.text, /noten/);
  assert.match(pruefeFehler(p), /verbund/);
  assert.ok('fehler' in pruefeProjekt(p));
  const q = kopie(verknuepft());
  clip(q, 'c2').laenge_beats = 5;
  assert.match(verbundPruefung(q).text, /laenge_beats/);
  const r = kopie(verknuepft());
  clip(r, 'c2').name = 'Other';
  assert.match(verbundPruefung(r).text, /name/);
  const s = kopie(verknuepft());
  clip(s, 'c2').verbund = 'x1';
  assert.match(pruefeFehler(s), /verbund/);
});

test('verbund field shape: pattern v<digits>, in /2 only', () => {
  const p = kopie(verknuepft());
  clip(p, 'c1').verbund = 'v1234567890'; clip(p, 'c2').verbund = 'v1234567890';
  assert.match(pruefeFehler(p), /verbund/);
});

test('a project without verbund is byte for byte unchanged (no counter, no field)', () => {
  let p = instr(neuesProjekt('x'));
  p = lauf(p, clipNeu('s1', 0, [{ beat: 0, laenge: 1, ton: 60, vel: 100 }]), clipNeu('s1', 8));
  p = lauf(p, { befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 1, laenge: 1, ton: 62, vel: 100 }] },
    { befehl: 'clip_teilen', clip_id: 'c2', beat: 10 }, { befehl: 'clip_duplizieren', clip_id: 'c1' });
  const s = JSON.stringify(p);
  assert.ok(!s.includes('verbund'));
  assert.ok(!('verbund' in (p.naechste_id ?? {})));
});

test('the note fast path gives the same result as the full path, also in a pattern', () => {
  const p = verknuepft();
  const liste = [
    { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 1, laenge: 1, ton: 64, vel: 90 }] },
    { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', vel: 50 }] },
    { befehl: 'noten_loeschen', clip_id: 'c2', ids: ['n1'] },
  ];
  const schnell = fuehreListeAus(kopie(p), liste), voll = fuehreListeAus(kopie(p), liste, { voll: true });
  assert.equal(JSON.stringify(schnell.projekt), JSON.stringify(voll.projekt));
  assert.equal(JSON.stringify(schnell.vor), JSON.stringify(voll.vor));
  // the source project is not touched by the fast path
  const roh = kopie(p), vorher = JSON.stringify(roh);
  fuehreListeAus(roh, liste);
  assert.equal(JSON.stringify(roh), vorher);
});

test('clip_aus_muster in place fans out the generated content (same note ids in every member)', () => {
  const p = verknuepft();
  const r = fuehreListeAus(kopie(p), [{ befehl: 'clip_aus_muster', clip_id: 'c2', code: 'note("c3 e3 g3 e3")', takte: 1 }], { musterUebersetze: musterZuEreignissen }).projekt;
  assert.ok(clip(r, 'c2').noten.length >= 2);
  assert.equal(sig(clip(r, 'c1')), sig(clip(r, 'c2')));
  assert.equal(JSON.stringify(clip(r, 'c1').muster), JSON.stringify(clip(r, 'c2').muster));
  assert.equal(verbundPruefung(r), null);
});
