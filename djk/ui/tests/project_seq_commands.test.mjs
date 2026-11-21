// SEQ deck v2, task 1: the commands seq_anlegen, seq_folge_neu and seq_leeren, the field `seq` on clip_neu and clip_aendern (spec sections 4, 5 and 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { uebersetze } from '../project/playback.ts';
import { wende } from '../project/patch.ts';
import { baueModul, modulAmPlatz } from '../project/live.ts';
import { seqGruppe, seqFolgen, seqSichtPruefung } from '../project/seq.ts';
import { ohneAbgeleitetes } from './support/project.mjs';

const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }]; return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const ergebnis = (p, ...b) => fuehreListeAus(p, b);
const fehler = (p, ...b) => { try { fuehreListeAus(p, b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e; } return assert.fail(`${b.map((x) => x.befehl)} was not refused`); };
const kopie = (x) => JSON.parse(JSON.stringify(x));
const valide = (p) => { const u = pruefeProjekt(kopie(p)); assert.ok('projekt' in u, JSON.stringify(u)); };
const mitSeq = (platz = 2) => lauf(live(), { befehl: 'seq_anlegen', platz });
const bk = (graph = 'synth-mono') => ({ art: 'intern', name: 'bk', graph, parameter: {} });
const KIT = { art: 'intern', name: 'kit', kit: 'k909' };
const RB = { art: 'intern', name: 'rb338', parameter: {} };
const opt = () => ({ nr: 1, audioOrdner: '/arbeit/arr/audio', frames: () => null });
const LOOP = { sha256: 'e'.repeat(64), pfad: '/x/e.wav', beats: 16, frames: 16 * 24000 };
const herkunft = () => ({ quelle_sha256: 'c'.repeat(64), titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120,
  tonart: '8A', datum: '2026-11-12' });
const folge = (p, extra = {}, gruppe = p.gruppen[0]) => lauf(p, { befehl: 'seq_folge_neu', gruppe_id: gruppe.id, name: 'Bass', geraet: bk(), ...extra });
const sicht = (...zeilen) => ({ schema: 1, zeilen });

test('seq_anlegen on a live project: an empty top group SEQ <platz> at 0 dB, marker {schema: 2}, the place holds it, no tracks', () => {
  const p = mitSeq(2);
  valide(p);
  assert.equal(p.gruppen.length, 1);
  assert.equal(p.spuren.length, 0);
  const g = p.gruppen[0];
  assert.deepEqual([g.name, g.fader_db, g.ausgang, g.seq], ['SEQ 2', 0, undefined, { schema: 2 }]);
  assert.deepEqual(p.plaetze[1], { typ: 'seq', gruppe: g.id });
  assert.equal(seqGruppe(p, 2)?.id, g.id);
  assert.deepEqual(seqFolgen(p, g), []);
});

test('the playback of an empty deck group on place N plays into the container N: dj nr N', () => {
  for (const platz of [1, 2, 3, 4]) {
    const w = uebersetze(mitSeq(platz), opt());
    assert.equal(w.live, true);
    assert.deepEqual(w.gruppen.map((x) => x.ausgang), [{ art: 'dj', nr: platz }], String(platz));
  }
});

test('seq_anlegen takes the place from its argument; other places stay free', () => {
  const p = lauf(mitSeq(2), { befehl: 'seq_anlegen', platz: 3 });
  valide(p);
  assert.deepEqual(p.gruppen.map((g) => g.name), ['SEQ 2', 'SEQ 3']);
  assert.deepEqual(p.plaetze.map((x) => x.typ), ['leer', 'seq', 'seq', 'leer']);
});

test('seq_anlegen on a live project without places is refused kein_liveprojekt, not a TypeError', () => {
  const p = neuesProjekt('x'); p.live = true;
  assert.equal(fehler(p, { befehl: 'seq_anlegen', platz: 2 }).grund, 'kein_liveprojekt');
});

test('seq_anlegen refusals: seq_belegt, kein_liveprojekt, bad arguments, the group limit; the project stays as it was', () => {
  assert.equal(fehler(mitSeq(2), { befehl: 'seq_anlegen', platz: 2 }).grund, 'seq_belegt');
  assert.equal(fehler(neuesProjekt('x'), { befehl: 'seq_anlegen', platz: 2 }).grund, 'kein_liveprojekt');
  for (const platz of [0, 5, 1.5, '2', undefined]) assert.equal(fehler(live(), { befehl: 'seq_anlegen', platz }).grund, 'argument_ungueltig', String(platz));
  assert.equal(fehler(live(), { befehl: 'seq_anlegen', platz: 1, extra: 1 }).grund, 'argument_unbekannt');
  let p = live();
  for (let i = 0; i < 16; i++) p = lauf(p, { befehl: 'gruppenspur_neu', name: `G${i}` });
  const vorher = kopie(p);
  assert.match(fehler(p, { befehl: 'seq_anlegen', platz: 1 }).message, /all 16 groups are used/);
  assert.deepEqual(kopie(p), vorher);
});

test('seq_folge_neu: track, routing and clip in one command; defaults name, beat 0, 64 beats, loop 4, unmuted', () => {
  const p0 = mitSeq(1);
  const r = ergebnis(p0, { befehl: 'seq_folge_neu', gruppe_id: p0.gruppen[0].id, name: 'Bass', geraet: bk('synth-mono') });
  valide(r.projekt);
  const p = r.projekt;
  assert.equal(p.spuren.length, 1);
  const s = p.spuren[0];
  assert.deepEqual([s.name, s.art, s.geraet.name, s.geraet.graph, s.ausgang, s.mute], ['Bass', 'instrument', 'bk', 'synth-mono', { art: 'gruppe', id: p.gruppen[0].id }, false]);
  assert.equal(s.clips.length, 1);
  const c = s.clips[0];
  assert.deepEqual([c.art, c.name, c.start_beat, c.laenge_beats, c.loop_beats, c.noten.length, c.seq], ['midi', 'Bass', 0, 64, 4, 0, undefined]);
  assert.deepEqual(seqFolgen(p, p.gruppen[0]).map((x) => [x.spur.id, x.clip.id, x.editierbar]), [[s.id, c.id, true]]);
  assert.equal(r.betrifft_wiedergabe, true);
  assert.equal(ohneAbgeleitetes(wende(p, r.zurueck)), ohneAbgeleitetes(p0), 'one patch back to the empty deck');
});

test('seq_folge_neu starts the track at -6 dB: two new patterns at 0 dB would reach 0 dBFS in the sum', () => {
  const p = folge(folge(mitSeq(2)), { name: 'Lead' });
  assert.deepEqual(p.spuren.map((s) => s.fader_db), [-6, -6]);
});

test('seq_folge_neu loop_beats and stumm; the order of patterns is the track order', () => {
  let p = folge(mitSeq(1), { name: 'A', loop_beats: 16 });
  p = folge(p, { name: 'B', loop_beats: 0.125, stumm: true, geraet: KIT });
  p = folge(p, { name: 'C', loop_beats: 64, stumm: false, geraet: RB });
  valide(p);
  assert.deepEqual(p.spuren.map((s) => [s.name, s.mute, s.clips[0].loop_beats, s.clips[0].name]), [['A', false, 16, 'A'], ['B', true, 0.125, 'B'], ['C', false, 64, 'C']]);
  assert.deepEqual(seqFolgen(p, p.gruppen[0]).map((x) => x.spur.name), ['A', 'B', 'C']);
});

test('seq_folge_neu with a kit and with rb338 gives the matching device', () => {
  let p = folge(mitSeq(3), { name: 'Drums', geraet: KIT });
  p = folge(p, { name: 'Acid', geraet: RB });
  valide(p);
  assert.deepEqual(p.spuren.map((s) => [s.geraet.name, s.geraet.kit]), [['kit', 'k909'], ['rb338', undefined]]);
  assert.ok(p.spuren.every((s) => s.ausgang.id === p.gruppen[0].id));
});

test('the playback holds the notes of a pattern clip with loop_beats 4 rolled out over 64 beats', () => {
  let p = folge(mitSeq(2), { name: 'Bass', loop_beats: 4 });
  const clip = p.spuren[0].clips[0];
  p = lauf(p, { befehl: 'noten_neu', clip_id: clip.id, noten: [{ beat: 0, laenge: 0.5, ton: 36, vel: 100 }, { beat: 2, laenge: 0.5, ton: 38, vel: 90 }] });
  const w = uebersetze(p, opt());
  assert.equal(w.spuren.length, 1);
  const n = w.spuren[0].noten;
  assert.equal(n.length, 32, 'two notes in each of the 16 copies of 4 beats');
  assert.equal(Math.max(...n.map((x) => x.beat)), 62);
  assert.deepEqual(n.slice(0, 3).map((x) => [x.beat, x.ton]), [[0, 36], [2, 38], [4, 36]]);
  assert.deepEqual(w.gruppen.map((x) => x.ausgang), [{ art: 'dj', nr: 2 }]);
});

test('seq_folge_neu: the 17th Baukasten track is refused with the model text, nothing changes; a kit track still fits', () => {
  let p = mitSeq(1);
  for (let i = 0; i < 16; i++) p = folge(p, { name: `B${i}` });
  valide(p);
  const vorher = kopie(p);
  assert.match(fehler(p, { befehl: 'seq_folge_neu', gruppe_id: p.gruppen[0].id, name: 'B17', geraet: bk() }).message, /at most 16 Baukasten tracks/);
  assert.deepEqual(kopie(p), vorher);
  valide(folge(p, { name: 'Drums', geraet: KIT }));
});

test('seq_folge_neu refusals: unknown group, group without a deck, missing or bad fields, a loop above 64 beats; nothing changes', () => {
  const p = mitSeq(1);
  const g = p.gruppen[0].id;
  const vorher = kopie(p);
  const b = (extra) => ({ befehl: 'seq_folge_neu', gruppe_id: g, name: 'X', geraet: bk(), ...extra });
  assert.equal(fehler(p, b({ gruppe_id: 'gibtsnicht' })).grund, 'gruppe_unbekannt');
  const ohne = lauf(live(), { befehl: 'gruppenspur_neu', name: 'plain' });
  assert.equal(fehler(ohne, b({ gruppe_id: ohne.gruppen[0].id })).grund, 'seq_fehlt');
  for (const [name, x] of [['name', { name: undefined }], ['name empty', { name: ' ' }], ['geraet', { geraet: undefined }], ['loop 65', { loop_beats: 65 }],
    ['loop 0', { loop_beats: 0 }], ['loop 0.1 (not a multiple of 0.125)', { loop_beats: 0.1 }], ['loop 0.0625', { loop_beats: 0.0625 }], ['loop text', { loop_beats: '4' }], ['stumm text', { stumm: 'ja' }]]) {
    assert.equal(fehler(p, b(x)).grund, 'argument_ungueltig', name);
  }
  assert.equal(fehler(p, b({ extra: 1 })).grund, 'argument_unbekannt');
  assert.deepEqual(kopie(p), vorher);
});

test('seq_leeren removes the group and every track that plays into it, a track of another group stays, a sub-group moves to the master', () => {
  let p = mitSeq(3);
  p = folge(p, { name: 'A' });
  p = folge(p, { name: 'B', geraet: KIT });
  const g = p.gruppen[0];
  p = lauf(p, { befehl: 'gruppenspur_neu', name: 'Andere' });
  const andere = p.gruppen.at(-1);
  p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'Frei', geraet: bk() }, { befehl: 'spur_neu', art: 'audio', name: 'Aud' });
  const [frei, aud] = p.spuren.slice(-2).map((s) => s.id);
  p = lauf(p, { befehl: 'ziel_setzen', strang_id: frei, ausgang: { art: 'gruppe', id: andere.id } },
    { befehl: 'ziel_setzen', strang_id: aud, ausgang: { art: 'gruppe', id: g.id } },
    { befehl: 'ziel_setzen', strang_id: andere.id, ausgang: { art: 'gruppe', id: g.id } });
  const r = ergebnis(p, { befehl: 'seq_leeren', gruppe_id: g.id });
  valide(r.projekt);
  assert.equal(seqGruppe(r.projekt, 3), undefined);
  assert.deepEqual(r.projekt.spuren.map((s) => s.id), [frei], 'the pattern tracks and the audio track that played into the group are gone');
  assert.equal(r.projekt.spuren[0].ausgang.id, andere.id);
  assert.deepEqual(r.projekt.gruppen.map((x) => x.id), [andere.id]);
  assert.equal(r.projekt.gruppen[0].ausgang, undefined, 'the sub-group plays into the master');
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), 'one patch back');
});

test('seq_leeren leaves a loop module in place 1 untouched; the place can be built again afterwards', () => {
  const basis = baueModul(live(), 'A', LOOP, {}, herkunft());
  const slotA = modulAmPlatz(basis, 'A');
  let p = lauf(basis, { befehl: 'seq_anlegen', platz: 2 });
  p = folge(p, { name: 'A' }, seqGruppe(p, 2));
  const q = lauf(p, { befehl: 'seq_leeren', gruppe_id: seqGruppe(p, 2).id });
  valide(q);
  assert.equal(modulAmPlatz(q, 'A'), slotA);
  assert.deepEqual(q.gruppen, basis.gruppen);
  assert.deepEqual(q.spuren, basis.spuren);
  valide(lauf(q, { befehl: 'seq_anlegen', platz: 2 }));
});

test('seq_leeren on a group without a deck is seq_fehlt, an unknown group gruppe_unbekannt', () => {
  const ohne = lauf(live(), { befehl: 'gruppenspur_neu', name: 'plain' });
  assert.equal(fehler(ohne, { befehl: 'seq_leeren', gruppe_id: ohne.gruppen[0].id }).grund, 'seq_fehlt');
  assert.equal(fehler(ohne, { befehl: 'seq_leeren', gruppe_id: 'gibtsnicht' }).grund, 'gruppe_unbekannt');
});

test('seq_setzen no longer exists', () => {
  const p = mitSeq(1);
  assert.equal(fehler(p, { befehl: 'seq_setzen', gruppe_id: p.gruppen[0].id, seq: { schema: 2, platz: 1 } }).grund, 'befehl_unbekannt');
});

test('clip_neu and clip_aendern store the descriptor, null removes it, a bad one is refused and changes nothing', () => {
  let p = folge(mitSeq(1), { name: 'Bass' });
  const clip = p.spuren[0].clips[0].id, spur = p.spuren[0].id;
  const s = sicht({ id: 'bass', art: 'noten', teiler: 0.25 }, { id: 'cut', art: 'werte', teiler: 0.25, ziel: 'geraet.k3' });
  p = lauf(p, { befehl: 'clip_aendern', clip_id: clip, seq: s });
  valide(p);
  assert.deepEqual(p.spuren[0].clips[0].seq, s);
  assert.equal(seqSichtPruefung(p.spuren[0].clips[0].seq), null);
  // the descriptor alone is a change
  const vorher = kopie(p);
  p = lauf(p, { befehl: 'clip_aendern', clip_id: clip, name: 'Neu' });
  assert.deepEqual(p.spuren[0].clips[0].seq, s, 'other edits keep it');
  for (const schlecht of [sicht(), sicht({ id: 'A', art: 'noten', teiler: 0.25 }), { schema: 1, zeilen: [{ id: 'a', art: 'noten', teiler: 0.25 }], extra: 1 }, 'x', 5]) {
    const e = fehler(p, { befehl: 'clip_aendern', clip_id: clip, seq: schlecht });
    assert.ok(['argument_ungueltig', 'argument_unbekannt'].includes(e.grund), `${JSON.stringify(schlecht)}: ${e.grund}`);
  }
  assert.equal(kopie(p).spuren[0].clips[0].name, 'Neu');
  assert.notDeepEqual(kopie(p), vorher);
  const weg = lauf(p, { befehl: 'clip_aendern', clip_id: clip, seq: null });
  valide(weg);
  assert.ok(!('seq' in weg.spuren[0].clips[0]), 'removed, not null');
  // clip_neu
  const neu = lauf(p, { befehl: 'clip_neu', spur_id: spur, art: 'midi', start_beat: 64, laenge_beats: 4, seq: s });
  assert.deepEqual(neu.spuren[0].clips.at(-1).seq, s);
  assert.equal(fehler(p, { befehl: 'clip_neu', spur_id: spur, art: 'midi', start_beat: 64, laenge_beats: 4, seq: sicht() }).grund, 'argument_ungueltig');
});

test('seq on an audio clip is refused', () => {
  let p = lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'audio', name: 'A' });
  p = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'audio', start_beat: 0, laenge_beats: 4, sha256: 'a'.repeat(64) });
  assert.equal(fehler(p, { befehl: 'clip_aendern', clip_id: p.spuren[0].clips[0].id, seq: sicht({ id: 'a', art: 'noten', teiler: 0.25 }) }).grund, 'argument_ungueltig');
  assert.equal(fehler(p, { befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'audio', start_beat: 8, laenge_beats: 4, sha256: 'a'.repeat(64),
    seq: sicht({ id: 'a', art: 'noten', teiler: 0.25 }) }).grund, 'argument_ungueltig');
});

test('instrument exchange: a kit refuses geraet.* envelopes (geraet_huellkurven, nothing changes); the deletions plus spur_aendern are one history entry', () => {
  let p = folge(mitSeq(1), { name: 'Bass', geraet: bk('synth-mono') });
  const clip = p.spuren[0].clips[0].id, spur = p.spuren[0].id;
  p = lauf(p, { befehl: 'huellkurve_setzen', clip_id: clip, ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.2 }, { beat: 2, wert: -0.2 }] },
    { befehl: 'huellkurve_setzen', clip_id: clip, ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0.1 }] });
  valide(p);
  const vorher = kopie(p);
  const tausch = { befehl: 'spur_aendern', spur_id: spur, geraet: KIT };
  assert.equal(fehler(p, tausch).grund, 'geraet_huellkurven');
  assert.deepEqual(kopie(p), vorher, 'a refusal leaves everything as it was');
  const r = ergebnis(p, { befehl: 'huellkurve_loeschen', clip_id: clip, ziel: 'geraet.k3' }, { befehl: 'huellkurve_loeschen', clip_id: clip, ziel: 'geraet.k4' }, tausch);
  valide(r.projekt);
  assert.equal(r.projekt.spuren[0].geraet.name, 'kit');
  assert.ok(!('huellkurven' in r.projekt.spuren[0].clips[0]));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), 'a single patch undoes the list');
  // a knob lane of one graph stays when the other graph is a Baukasten graph, too
  valide(lauf(p, { befehl: 'spur_aendern', spur_id: spur, geraet: bk('drums-909') }));
});

test('seq_folge_neu carries the clip content of a pattern written as text: notes, descriptor and envelopes arrive in the one command', () => {
  const p0 = mitSeq(2);
  const zeilen = [{ id: 'bass', art: 'noten', teiler: 0.25 }, { id: 'cut', art: 'werte', teiler: 0.25, ziel: 'geraet.k3' }];
  const r = ergebnis(p0, { befehl: 'seq_folge_neu', gruppe_id: p0.gruppen[0].id, name: 'Acid', geraet: bk(), loop_beats: 2, stumm: true,
    noten: [{ beat: 0, laenge: 0.25, ton: 36, vel: 100 }, { beat: 0.5, laenge: 0.125, ton: 38, vel: 90 }], seq: sicht(...zeilen),
    huellkurven: [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }, { beat: 1, wert: -0.2, form: 'sprung' }] }] });
  valide(r.projekt);
  const spur = r.projekt.spuren[0], clip = spur.clips[0];
  assert.equal(spur.mute, true);
  assert.equal(clip.loop_beats, 2);
  assert.deepEqual(clip.noten.map((n) => [n.beat, n.ton, n.vel]), [[0, 36, 100], [0.5, 38, 90]]);
  assert.deepEqual(clip.seq.zeilen.map((z) => z.id), ['bass', 'cut']);
  assert.deepEqual(clip.huellkurven.map((h) => [h.ziel, h.punkte.length]), [['geraet.k3', 2]]);
});

test('seq_folge_neu with a bad envelope or note is refused as a whole: no track, no clip, the project stays as it was', () => {
  const p0 = mitSeq(2);
  const vorher = kopie(p0);
  const b = (extra) => ({ befehl: 'seq_folge_neu', gruppe_id: p0.gruppen[0].id, name: 'Drums', geraet: KIT, noten: [{ beat: 0, laenge: 0.25, ton: 36, vel: 100 }], ...extra });
  assert.equal(fehler(p0, b({ huellkurven: [{ ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }] })).grund, 'huellkurve_ziel');
  assert.ok(fehler(p0, b({ noten: [{ beat: 0, laenge: 0.25, ton: 300, vel: 100 }] })));
  assert.equal(fehler(p0, b({ seq: { schema: 1, zeilen: [] } })).grund, 'argument_ungueltig');
  assert.equal(fehler(p0, b({ huellkurven: [] })).grund, 'argument_ungueltig');
  assert.deepEqual(kopie(p0), vorher);
});

test('seq_folge_neu: a pattern name is unique in the deck ignoring case; another deck may reuse it', () => {
  let p = mitSeq(1);
  p = folge(p, { name: 'Bass' });
  const e = fehler(p, { befehl: 'seq_folge_neu', gruppe_id: p.gruppen[0].id, name: 'bASS', geraet: bk() });
  assert.equal(e.grund, 'argument_ungueltig');
  assert.match(e.message, /already has a pattern called bASS/);
  p = lauf(p, { befehl: 'seq_anlegen', platz: 2 });
  valide(folge(p, { name: 'Bass' }, seqGruppe(p, 2)));
});
