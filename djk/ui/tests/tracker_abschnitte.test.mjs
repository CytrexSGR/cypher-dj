// Tracker task 8: time insert and remove (zeit_einfuegen, zeit_entfernen) and the section commands with ripple.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { neuesProjekt, pruefeFehler, insertWertNamen } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { mitglieder, verbundPruefung } from '../project/verbund.ts';
import { zeitEinfuegen, zeitEntfernen, standardListe } from '../project/time.ts';
import { abschnitte as seitenListe } from '../public/tracker/grid_model.js';
import { kopie, tmpOrdner, SHA_A } from './support/project.mjs';

const lauf = (p, ...b) => fuehreListeAus(kopie(p), b).projekt;
const fehler = (p, ...b) => {
  const vor = JSON.stringify(p);
  try { fuehreListeAus(kopie(p), b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); assert.equal(JSON.stringify(p), vor); return e; }
  return assert.fail('expected a refusal');
};
const GERAET = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
const clip = (p, id) => p.spuren.flatMap((s) => s.clips).find((c) => c.id === id);
const starts = (p) => Object.fromEntries(p.spuren.flatMap((s) => s.clips).map((c) => [c.id, c.start_beat]));
const laenge = (p) => p.tracker.abschnitte.map((a) => [a.id, a.laenge_beats]);
const lane = (p, strang) => (strang === 'g1' ? p.gruppen[0] : p.spuren.find((s) => s.id === strang)).automation[0].punkte.map((q) => [q.beat, q.wert]);
// delete the clips of the middle section (so that time can be removed there)
const MITTE_LEER = [{ befehl: 'clip_loeschen', clip_id: 'c2' }, { befehl: 'clip_loeschen', clip_id: 'c4' }];
const NOTE = { beat: 3, laenge: 0.5, ton: 72, vel: 80 };
const midi = (start) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: start, laenge_beats: 16, noten: [NOTE] });

// three sections of 16 beats: MIDI clips c1 c2 c3 on s1 "Lead", an audio clip c4 (16..32) on s2 "Drums", a pan lane on s1 (4, 20, 36), a lane on the
// group g1 (compressor parameter, 4, 20, 36) and the loop 16..32
function drei() {
  let p = lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: GERAET }, { befehl: 'spur_neu', art: 'audio', name: 'Drums' });
  p = lauf(p, midi(0), midi(16), midi(32),
    { befehl: 'clip_neu', spur_id: 's2', art: 'audio', start_beat: 16, laenge_beats: 16, sha256: SHA_A, name: 'loop', pfad_hinweis: '/x/l.wav' },
    { befehl: 'auto_neu', spur_id: 's1', ziel: 'pan', punkte: [{ beat: 4, wert: 0.2 }, { beat: 20, wert: 0.5 }, { beat: 36, wert: -0.5 }] },
    { befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1'] },
    { befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'komp' },
    { befehl: 'loop_setzen', an: true, von_beat: 16, bis_beat: 32 });
  const param = insertWertNamen('komp')[0];
  return lauf(p, { befehl: 'auto_neu', strang_id: 'g1', ziel: `insert.${p.gruppen[0].inserts[0].id}.${param}`,
    punkte: [{ beat: 4, wert: -40 }, { beat: 20, wert: -30 }, { beat: 36, wert: -20 }] });
}

test('setup: the three-section project is valid', () => {
  const p = drei();
  assert.equal(pruefeFehler(p), null);
  assert.deepEqual(starts(p), { c1: 0, c2: 16, c3: 32, c4: 16 });
  assert.deepEqual(lane(p, 'g1').map((x) => x[0]), [4, 20, 36]);
});

test('zeit_einfuegen: clips, audio clip, lanes of a track and a group, the loop all move; earlier things stay', () => {
  const p = lauf(drei(), { befehl: 'zeit_einfuegen', beat: 16, beats: 8 });
  assert.deepEqual(starts(p), { c1: 0, c2: 24, c3: 40, c4: 24 });
  assert.deepEqual(lane(p, 's1').map((x) => x[0]), [4, 28, 44]);
  assert.deepEqual(lane(p, 'g1').map((x) => x[0]), [4, 28, 44]);
  assert.deepEqual([p.loop.von_beat, p.loop.bis_beat, p.loop.an], [24, 40, true]);
  assert.equal(pruefeFehler(p), null);
  // the loop end exactly at the beat stays (the end of what lies before), a loop that spans the beat grows
  assert.deepEqual([lauf(drei(), { befehl: 'zeit_einfuegen', beat: 32, beats: 4 }).loop.bis_beat], [32]);
  const q = lauf(drei(), ...MITTE_LEER, { befehl: 'zeit_einfuegen', beat: 24, beats: 4 });
  assert.deepEqual([q.loop.von_beat, q.loop.bis_beat], [16, 36]);
});

test('zeit_einfuegen: a clip crossing the beat is refused with the text naming clip and track; nothing is written', () => {
  const e = fehler(drei(), { befehl: 'zeit_einfuegen', beat: 8, beats: 4 });
  assert.equal(e.grund, 'zeit_schnitt');
  assert.equal(e.detail, 'clip "MIDI" on track "Lead" crosses beat 8');
  const e2 = fehler(drei(), { befehl: 'zeit_einfuegen', beat: 20, beats: 4 });
  assert.equal(e2.detail.includes('crosses beat 20'), true);
  assert.equal(fehler(drei(), { befehl: 'zeit_einfuegen', beat: 8 }).grund, 'argument_ungueltig');
  assert.equal(fehler(drei(), { befehl: 'zeit_einfuegen', beat: 8, beats: 0 }).grund, 'argument_ungueltig');
  assert.equal(fehler(drei(), { befehl: 'zeit_einfuegen', beat: 8, beats: 1, x: 1 }).grund, 'argument_unbekannt');
});

test('zeit_entfernen: the range is cut out, lane points inside go and the value at the end stays at the cut (D12), the loop follows', () => {
  let p = lauf(drei(), ...MITTE_LEER);
  p = lauf(p, { befehl: 'loop_setzen', an: true, von_beat: 8, bis_beat: 24 });
  p = lauf(p, { befehl: 'zeit_entfernen', beat: 16, beats: 16 });
  assert.deepEqual(starts(p), { c1: 0, c3: 16 });
  // the pan lane: 20 (0.5) is dropped; at 32 the lane had 0.5 + (-0.5 - 0.5) * 12/16 = -0.25
  assert.deepEqual(lane(p, 's1'), [[4, 0.2], [16, -0.25], [20, -0.5]]);
  assert.deepEqual([p.loop.von_beat, p.loop.bis_beat, p.loop.an], [8, 16, true]);
  assert.equal(pruefeFehler(p), null);
  // a loop that lay inside the removed time is switched off
  const q = lauf(drei(), ...MITTE_LEER, { befehl: 'zeit_entfernen', beat: 16, beats: 16 });
  assert.equal(q.loop.an, false);
  assert.equal(pruefeFehler(q), null);
});

test('zeit_entfernen: a clip that crosses or lies in the range is refused', () => {
  const e = fehler(drei(), { befehl: 'zeit_entfernen', beat: 8, beats: 8 });
  assert.equal(e.grund, 'zeit_schnitt');
  assert.equal(e.detail, 'clip "MIDI" on track "Lead" crosses beat 8');
  const f = fehler(drei(), { befehl: 'zeit_entfernen', beat: 16, beats: 16 });
  assert.equal(f.grund, 'zeit_schnitt');
  assert.equal(f.detail.includes('on track'), true);
});

test('time.ts: zeitEinfuegen and zeitEntfernen mutate a draft, a lane point at the end of the range lands on the cut', () => {
  const p = kopie(drei());
  zeitEinfuegen(p, 48, 4);
  assert.deepEqual(starts(p), { c1: 0, c2: 16, c3: 32, c4: 16 });
  zeitEntfernen(p, 52, 4);
  assert.equal(p.spuren[0].automation[0].punkte.length, 3);
  const q = kopie(drei());
  for (const sp of q.spuren) sp.clips = [];
  q.spuren[0].automation[0].punkte = [{ beat: 4, wert: 0 }, { beat: 10, wert: 1 }, { beat: 20, wert: 0.5 }];
  zeitEntfernen(q, 12, 8);                       // the point at 10 stays; 20 lands exactly on the cut 12: no extra point
  assert.deepEqual(q.spuren[0].automation[0].punkte.map((x) => [x.beat, x.wert]), [[4, 0], [10, 1], [12, 0.5]]);
});

test('a project without sections: the first section command writes the default list the page shows', () => {
  const p = drei();
  const aus = lauf(p, { befehl: 'abschnitt_umbenennen', id: 'a2', name: 'Verse' });
  assert.deepEqual(aus.tracker.abschnitte, [{ id: 'a1', laenge_beats: 16 }, { id: 'a2', name: 'Verse', laenge_beats: 16 }, { id: 'a3', laenge_beats: 16 }]);
  const seite = seitenListe(p).map((a) => [a.id, a.laenge_beats]);
  assert.deepEqual(standardListe(p).map((a) => [a.id, a.laenge_beats]), seite);
  assert.deepEqual(seite, [['a1', 16], ['a2', 16], ['a3', 16]]);
  assert.deepEqual(standardListe(neuesProjekt('y')), [{ id: 'a1', laenge_beats: 16 }]);
  assert.deepEqual(lauf(neuesProjekt('y'), { befehl: 'abschnitt_neu' }).tracker.abschnitte, [{ id: 'a1', laenge_beats: 16 }, { id: 'a2', laenge_beats: 16 }]);
  // name removed again: the field is gone, not empty
  assert.deepEqual(lauf(aus, { befehl: 'abschnitt_umbenennen', id: 'a2', name: null }).tracker.abschnitte[1], { id: 'a2', laenge_beats: 16 });
  assert.equal(fehler(p, { befehl: 'abschnitt_umbenennen', id: 'a2' }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'abschnitt_umbenennen', id: 'a9', name: 'x' }).grund, 'abschnitt_unbekannt');
  assert.equal(fehler(p, { befehl: 'abschnitt_umbenennen', id: 'a1', name: '' }).grund, 'argument_ungueltig');
});

test('abschnitt_neu: 64 rows at the project LPB, after `nach` or at the end, ripple behind it', () => {
  const p = lauf(drei(), { befehl: 'abschnitt_neu', nach: 'a1', name: 'Break' });
  assert.deepEqual(laenge(p), [['a1', 16], ['a4', 16], ['a2', 16], ['a3', 16]]);
  assert.equal(p.tracker.abschnitte[1].name, 'Break');
  assert.deepEqual(starts(p), { c1: 0, c2: 32, c3: 48, c4: 32 });
  assert.deepEqual(lane(p, 's1').map((x) => x[0]), [4, 36, 52]);
  assert.deepEqual([p.loop.von_beat, p.loop.bis_beat], [32, 48]);
  const q = lauf(drei(), { befehl: 'tracker_setzen', lpb: 8 }, { befehl: 'abschnitt_neu', zeilen: 32 });
  assert.deepEqual(laenge(q).at(-1), ['a4', 4]);
  assert.equal(pruefeFehler(p), null);
  assert.equal(fehler(drei(), { befehl: 'abschnitt_neu', nach: 'a9' }).grund, 'abschnitt_unbekannt');
  assert.equal(fehler(drei(), { befehl: 'abschnitt_neu', zeilen: 2.5 }).grund, 'argument_ungueltig');
});

test('abschnitt_duplizieren verknuepft: the copies are members, a note edit on one reaches both', () => {
  let p = lauf(drei(), { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'verknuepft' });
  assert.deepEqual(laenge(p), [['a1', 16], ['a4', 16], ['a2', 16], ['a3', 16]]);
  assert.deepEqual(starts(p), { c1: 0, c5: 16, c2: 32, c3: 48, c4: 32 });
  assert.equal(clip(p, 'c1').verbund, clip(p, 'c5').verbund);
  assert.match(clip(p, 'c1').verbund, /^v[0-9]+$/);
  assert.equal(mitglieder(p, 'c1').length, 2);
  assert.equal(verbundPruefung(p), null);
  assert.equal(pruefeFehler(p), null);
  p = lauf(p, { befehl: 'noten_neu', clip_id: 'c5', noten: [{ beat: 8, laenge: 1, ton: 60, vel: 90 }] });
  assert.equal(clip(p, 'c1').noten.length, 2);
  assert.equal(clip(p, 'c5').noten.length, 2);
  assert.equal(verbundPruefung(p), null);
});

test('abschnitt_duplizieren kopie: unique copies, audio too; the new section keeps the name', () => {
  let p = lauf(drei(), { befehl: 'abschnitt_umbenennen', id: 'a2', name: 'Verse' }, { befehl: 'abschnitt_duplizieren', id: 'a2', als: 'kopie' });
  assert.deepEqual(laenge(p), [['a1', 16], ['a2', 16], ['a4', 16], ['a3', 16]]);
  assert.equal(p.tracker.abschnitte[2].name, 'Verse');
  assert.deepEqual(starts(p), { c1: 0, c2: 16, c5: 32, c3: 48, c4: 16, c6: 32 });
  assert.equal(clip(p, 'c5').verbund, undefined);
  assert.equal(clip(p, 'c2').verbund, undefined);
  assert.equal(clip(p, 'c6').art, 'audio');
  assert.equal(pruefeFehler(p), null);
  assert.equal(fehler(drei(), { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'x' }).grund, 'argument_ungueltig');
  // a unique copy of a member of a pattern is not a member
  p = lauf(drei(), { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'verknuepft' });
  p = lauf(p, { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'kopie' });
  assert.equal(clip(p, 'c6').verbund, undefined);
  assert.equal(mitglieder(p, 'c1').length, 2);
});

test('abschnitt_loeschen: clips inside go, time is removed, lanes and loop follow', () => {
  const p = lauf(drei(), { befehl: 'abschnitt_loeschen', id: 'a2' });
  assert.deepEqual(laenge(p), [['a1', 16], ['a3', 16]]);
  assert.deepEqual(starts(p), { c1: 0, c3: 16 });
  assert.equal(clip(p, 'c4'), undefined);
  // pan lane: the point at 20 is inside the section and goes; 36 -> 20; the value at 32 (-0.25) stays at the cut 16
  assert.deepEqual(lane(p, 's1'), [[4, 0.2], [16, -0.25], [20, -0.5]]);
  assert.equal(p.loop.an, false);
  assert.equal(pruefeFehler(p), null);
  assert.equal(fehler(neuesProjekt('y'), { befehl: 'abschnitt_loeschen', id: 'a1' }).grund, 'abschnitt_letzter');
});

test('review focus 3: deleting the section that holds one member of a two-member pattern leaves the other clip without verbund', () => {
  let p = lauf(drei(), { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'verknuepft' });   // c1 (a1) and c5 (a4) linked
  assert.ok(clip(p, 'c1').verbund);
  p = lauf(p, { befehl: 'abschnitt_loeschen', id: 'a4' });
  assert.ok(clip(p, 'c5') === undefined);
  assert.equal(clip(p, 'c1').verbund, undefined);
  assert.equal('verbund' in clip(p, 'c1'), false);
  assert.equal(pruefeFehler(p), null);
});

test('review focus 2: an audio clip that crosses a border refuses every command that would cut there; the text names clip and track', () => {
  const p = lauf(drei(), { befehl: 'clip_aendern', clip_id: 'c4', start_beat: 8 });          // 8..24 on Drums crosses the border at 16
  const text = 'clip "loop" on track "Drums" crosses beat 16';
  const befehle = [{ befehl: 'abschnitt_neu', nach: 'a1' }, { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'kopie' },
    { befehl: 'abschnitt_loeschen', id: 'a2' }, { befehl: 'abschnitt_verschieben', id: 'a1', richtung: 1 },
    { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 8 }];
  for (const b of befehle) {
    const e = fehler(p, b);
    assert.equal(e.grund, b.befehl === 'abschnitt_laenge' ? 'abschnitt_grenze' : 'abschnitt_grenze', b.befehl);
    assert.equal(e.detail, text, b.befehl);
  }
  // a command that does not cut at that border still works: renaming, and a section the clip does not touch
  assert.equal(lauf(p, { befehl: 'abschnitt_umbenennen', id: 'a1', name: 'x' }).tracker.abschnitte[0].name, 'x');
  assert.equal(starts(lauf(p, { befehl: 'abschnitt_neu', nach: 'a3' })).c4, 8);
});

test('abschnitt_verschieben: clips and lane points of both sections swap places, the loop stays', () => {
  const p = lauf(drei(), { befehl: 'abschnitt_verschieben', id: 'a2', richtung: -1 });
  assert.deepEqual(laenge(p), [['a2', 16], ['a1', 16], ['a3', 16]]);
  assert.deepEqual(starts(p), { c1: 16, c2: 0, c3: 32, c4: 0 });
  assert.deepEqual(lane(p, 's1'), [[4, 0.5], [20, 0.2], [36, -0.5]]);
  assert.deepEqual(lane(p, 'g1').map((x) => x[0]), [4, 20, 36]);
  assert.deepEqual([p.loop.von_beat, p.loop.bis_beat, p.loop.an], [16, 32, true]);
  assert.equal(pruefeFehler(p), null);
  const q = lauf(drei(), { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 32 }, { befehl: 'abschnitt_verschieben', id: 'a1', richtung: 1 });
  assert.deepEqual(laenge(q), [['a2', 16], ['a1', 8], ['a3', 16]]);
  assert.deepEqual(starts(q), { c1: 16, c2: 0, c3: 24, c4: 0 });
  assert.equal(fehler(drei(), { befehl: 'abschnitt_verschieben', id: 'a1', richtung: -1 }).grund, 'abschnitt_rand');
  assert.equal(fehler(drei(), { befehl: 'abschnitt_verschieben', id: 'a3', richtung: 1 }).grund, 'abschnitt_rand');
  assert.equal(fehler(drei(), { befehl: 'abschnitt_verschieben', id: 'a3', richtung: 2 }).grund, 'argument_ungueltig');
});

test('abschnitt_laenge: the covering clips change with the section, everything behind moves (D11)', () => {
  const kurz = lauf(drei(), { befehl: 'abschnitt_laenge', id: 'a2', zeilen: 32 });         // 8 beats at LPB 4
  assert.deepEqual(laenge(kurz), [['a1', 16], ['a2', 8], ['a3', 16]]);
  assert.equal(clip(kurz, 'c2').laenge_beats, 8);
  assert.equal(clip(kurz, 'c4').laenge_beats, 8);
  assert.equal(starts(kurz).c3, 24);
  assert.deepEqual(lane(kurz, 's1').map((x) => x[0]), [4, 20, 24, 28]);   // removed time 24..32: the ramp 20..36 keeps its value at the cut by a point at 24
  assert.equal(pruefeFehler(kurz), null);
  const lang = lauf(drei(), { befehl: 'abschnitt_laenge', id: 'a2', zeilen: 96 });         // 24 beats
  assert.deepEqual(laenge(lang), [['a1', 16], ['a2', 24], ['a3', 16]]);
  assert.equal(clip(lang, 'c2').laenge_beats, 24);
  assert.equal(starts(lang).c3, 40);
  assert.deepEqual(lane(lang, 's1').map((x) => x[0]), [4, 20, 44]);
  assert.equal(pruefeFehler(lang), null);
  // the same length changes nothing but the written list
  assert.deepEqual(lauf(drei(), { befehl: 'abschnitt_laenge', id: 'a2', zeilen: 64 }).spuren, drei().spuren);
});

test('abschnitt_laenge: a covering clip linked to another section and any other crossing clip are refused', () => {
  const v = lauf(drei(), { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'verknuepft' });
  const e = fehler(v, { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 32 });
  assert.equal(e.grund, 'abschnitt_verknuepft');
  assert.equal(e.detail, 'clip "MIDI" on track "Lead" is linked to another section: make it UNIQUE first');
  // unlink, then it works
  const u = lauf(v, { befehl: 'clip_entknuepfen', clip_id: 'c1' });
  assert.equal(clip(lauf(u, { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 32 }), 'c1').laenge_beats, 8);
  // a clip that lies in the removed rows
  const k = lauf(drei(), midi(0).befehl === 'clip_neu' ? { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 4 } : {});
  assert.equal(fehler(k, { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 8 }).grund, 'abschnitt_grenze');
  // a clip that crosses the end of the section
  const x = lauf(drei(), { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 20 });
  const f = fehler(x, { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 80 });
  assert.equal(f.grund, 'abschnitt_grenze');
  assert.equal(f.detail, 'clip "MIDI" on track "Lead" crosses beat 16');
  assert.equal(fehler(drei(), { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 0 }).grund, 'argument_ungueltig');
});

test('live container and workbench module: refused', () => {
  const live = neuesProjekt('x'); live.live = true;
  assert.equal(fehler(live, { befehl: 'abschnitt_neu' }).grund, 'tracker_live');
  assert.equal(fehler(live, { befehl: 'zeit_einfuegen', beat: 0, beats: 1 }).grund, 'tracker_live');
  const wb = neuesProjekt('x'); wb.werkbank = { schema: 1 };
  assert.equal(fehler(wb, { befehl: 'abschnitt_neu' }).grund, 'tracker_werkbank');
});

test('every command is one undo step (and redo brings it back)', async (t) => {
  const befehle = [{ befehl: 'zeit_einfuegen', beat: 16, beats: 8 }, { befehl: 'zeit_entfernen', beat: 16, beats: 16, vorher: true },
    { befehl: 'abschnitt_neu', nach: 'a1' },
    { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'verknuepft' }, { befehl: 'abschnitt_loeschen', id: 'a2' },
    { befehl: 'abschnitt_verschieben', id: 'a2', richtung: -1 },
    { befehl: 'abschnitt_laenge', id: 'a2', zeilen: 32 }, { befehl: 'abschnitt_umbenennen', id: 'a2', name: 'Verse' }];
  const sicht = (p) => JSON.stringify({ s: p.spuren, g: p.gruppen, l: p.loop, t: p.tracker });
  for (const [i, b] of befehle.entries()) {
    const v = new Verlauf(path.join(tmpOrdner(t), `undo${i}.jsonl`), { jetzt: () => 1_000_000, zeitgeber: false });
    const { vorher, ...befehl } = b;
    const p0 = vorher ? lauf(drei(), ...MITTE_LEER) : drei();
    const w = aendere(v, kopie(p0), [befehl], { quelle: 'andreas', label: b.befehl });
    assert.notEqual(sicht(w.projekt), sicht(p0), b.befehl);
    const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
    assert.equal(sicht(u.projekt), sicht(p0), `undo ${b.befehl}`);
    const r = wiederholen(v, u.projekt, { quelle: 'andreas' });
    assert.equal(sicht(r.projekt), sicht(w.projekt), `redo ${b.befehl}`);
  }
});

test('a project without the new commands is unchanged: no marker, no sections written by other commands', () => {
  const p = drei();
  assert.equal(p.tracker, undefined);
  assert.equal(lauf(p, { befehl: 'tempo_setzen', bpm: 130 }).tracker, undefined);
});
