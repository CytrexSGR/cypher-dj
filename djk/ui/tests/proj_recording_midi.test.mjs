// 1.8 T8: the MIDI take becomes notes. Part 1 is the pure function nehmeMidiAuf (pairing, beat arithmetic, replace and overdub, ids, loop clips) and the reader of
// the take file; part 2 is the run through the server (instrument-only start, release for Cypher, offset, one undo step for audio and MIDI together) with a mock
// core context; part 3 is the whole path through the real server with the core stand-in; part 4 the device field midi.versatz_samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { leseMidiDatei, nehmeMidiAuf, TakeFehler } from '../project/recording.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt as neuesProjektModell, pruefeFehler, sucheSpur } from '../project/model.ts';
import { setzeMidi } from '../areas/devices/change.ts';
import { GeraeteFehler, GeraeteSpeicher, pruefeKonfig, standard } from '../areas/devices/store.ts';
import { projBereich } from '../areas/proj/area.ts';
import { aufnahmeBereich } from '../areas/proj/recording.ts';
import { pruefKontext, warteBis } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';
import { stapel } from './support/media_library.mjs';
import { ruf, warte } from './support/proj_stack.mjs';

const RATE = 48000;
const neuesProjekt = () => neuesProjektModell('T');
const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const bisNeun = (x) => Math.round(x * 1e9) / 1e9;

// ---- part 1: the pure function -------------------------------------------------------------------------------------------------------------------------------------
// A project with instrument tracks ("Keys", "Bass") and a clip layout given as [[start, length, notes]] on the first one
function projektMit(clips = [], spuren = 1) {
  let p = neuesProjekt();
  for (let i = 0; i < spuren; i++) p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', name: i === 0 ? 'Keys' : 'Bass' }]).projekt;
  const sid = p.spuren[0].id;
  for (const [start, laenge, noten, extra] of clips) {
    p = fuehreListeAus(p, [{ befehl: 'clip_neu', spur_id: sid, art: 'midi', start_beat: start, laenge_beats: laenge,
      ...(noten.length > 0 ? { noten } : {}), ...(extra ?? {}) }]).projekt;
  }
  assert.equal(pruefeFehler(p), null);
  return { p, sid, ids: p.spuren.map((s) => s.id) };
}
const note = (beat, laenge, ton = 60, vel = 100) => ({ beat, laenge, ton, vel });
// 120 bpm: one beat is 24000 samples; startSample 1_000_000 and versatz 0 unless given
const BPM = 120, START = 1_000_000, BEAT = 24000;
const an = (beat, ton = 60, vel = 100, kanal = 0) => ({ sample: START + beat * BEAT, status: 0x90 | kanal, d1: ton, d2: vel });
const aus = (beat, ton = 60, kanal = 0) => ({ sample: START + beat * BEAT, status: 0x80 | kanal, d1: ton, d2: 0 });
// the sample of beat b is START + b * BEAT, so the events of the helpers an() / aus() are written in project beats; the take begins at startBeat
function nimm(p, ids, ereignisse, extra = {}) {
  const startBeat = extra.startBeat ?? 0;
  return nehmeMidiAuf(p, { spurIds: ids, startBeat, bpm: BPM, startSample: START + startBeat * BEAT, ereignisse, versatzSamples: 0, overdub: false, endeBeat: 8,
    name: 'Take 1', ...extra });
}
const clipsVon = (p, sid) => [...sucheSpur(p, sid).clips].sort((a, b) => a.start_beat - b.start_beat);
// the notes of a track as absolute [beat, laenge, ton, vel], sorted
const absolut = (p, sid) => clipsVon(p, sid).flatMap((c) => c.noten.map((n) => [bisNeun(c.start_beat + n.beat), n.laenge, n.ton, n.vel])).sort((a, b) => a[0] - b[0] || a[2] - b[2]);

test('T8 beats: 16 notes land at startBeat + (sample - startSample - versatz) * bpm / (60 * 48000), lengths from note off, ids from the one counter (1e-9)', () => {
  const { p, sid } = projektMit();
  const bpm = 127, startBeat = 4.25, startSample = 1_000_003, versatz = 777;
  const proSample = bpm / (60 * RATE);
  const ev = [], erwartet = [];
  for (let k = 0; k < 16; k++) {
    const onS = startSample + 5000 + 7919 * k + 13 * k, laenge = 3000 + 101 * k, ton = 40 + k, vel = 20 + 5 * k;
    ev.push({ sample: onS, status: 0x90, d1: ton, d2: vel }, { sample: onS + laenge, status: 0x80, d1: ton, d2: 0 });
    erwartet.push({ beat: startBeat + (onS - startSample - versatz) * proSample, laenge: laenge * proSample, ton, vel });
  }
  const n = nehmeMidiAuf(p, { spurIds: [sid], startBeat, bpm, startSample, ereignisse: ev, versatzSamples: versatz, overdub: false, endeBeat: startBeat + 40, name: 'Take 1' });
  const c = clipsVon(n, sid);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].art, c[0].start_beat, c[0].name], ['midi', startBeat, 'Take 1']);
  assert.ok(Math.abs(c[0].laenge_beats - 40) < 1e-9);
  assert.equal(c[0].noten.length, 16);
  c[0].noten.forEach((x, k) => {
    assert.ok(Math.abs(startBeat + x.beat - erwartet[k].beat) < 1e-9, `note ${k}: beat ${startBeat + x.beat} against ${erwartet[k].beat}`);
    assert.ok(Math.abs(x.laenge - erwartet[k].laenge) < 1e-9, `note ${k}: length`);
    assert.deepEqual([x.ton, x.vel], [erwartet[k].ton, erwartet[k].vel]);
    assert.equal(x.id, `n${k + 1}`, 'ids n1.. from the counter of a fresh project');
  });
  assert.equal(n.naechste_noten_id, 17, 'the counter moved past the 16 notes');
  assert.equal(p.naechste_noten_id, 1, 'the input is never touched');
  assert.equal(pruefeFehler(n), null);
});

test('T8 pairing: an Off without an On inside the take is dropped, an On without an Off is closed at endeBeat, a repeated On closes the old note at the new onset', () => {
  const { p, sid } = projektMit();
  const n = nimm(p, [sid], [
    aus(0.5, 50),                                       // held from before the take: orphan Off
    an(1, 60), an(2, 60, 90), aus(3, 60),               // retrigger: [1,2) and [2,3)
    an(5, 64, 80),                                      // never released: closed at endeBeat 8
    aus(6, 99),                                         // orphan Off of a pitch that never sounded
  ]);
  assert.deepEqual(absolut(n, sid), [[1, 1, 60, 100], [2, 1, 60, 90], [5, 3, 64, 80]]);
});

test('T8 pairing: the pitch alone is the key (as in the core file), an On with velocity 0 is an Off, control change and other messages are not notes, a note of zero length is dropped', () => {
  const { p, sid } = projektMit();
  const n = nimm(p, [sid], [
    an(1, 60, 100, 0), an(1.5, 60, 70, 1),             // same pitch on a second channel: a retrigger, the first note ends at the new onset
    { sample: START + 2 * BEAT, status: 0x90, d1: 60, d2: 0 },   // Off written as On with velocity 0, channel 0: closes the open pitch whatever its channel
    { sample: START + 2.5 * BEAT, status: 0xB0, d1: 1, d2: 64 },  // control change
    { sample: START + 2.5 * BEAT, status: 0xE0, d1: 0, d2: 64 },  // pitch bend
    aus(3, 60, 1),                                      // the pitch is not open any more: dropped
    an(4, 72), aus(4, 72),                              // On and Off on the same sample: no length, dropped
  ]);
  assert.deepEqual(absolut(n, sid), [[1, 0.5, 60, 100], [1.5, 0.5, 60, 70]]);
});

test('R2 fix: a core file with a channel change on one pitch (MPE-style rotation) pairs as the core wrote it: the retrigger Off and a late Off of another channel both close by pitch', () => {
  const { p, sid } = projektMit();
  // exactly what the core writes (recording_thread.cpp midi_ereignis): On ch1 p60 at 1; On ch2 p60 at 2 gives the synthetic Off with the OLD channel (ch1) at 2 and then
  // the On ch2; the player's Off ch1 at 3 finds the pitch open and is written; the player's Off ch2 at 4 finds it closed and is dropped by the core.
  const n = nimm(p, [sid], [an(1, 60, 100, 1), aus(2, 60, 1), an(2, 60, 90, 2), aus(3, 60, 1)]);
  assert.deepEqual(absolut(n, sid), [[1, 1, 60, 100], [2, 1, 60, 90]], 'the second note ends at 3, not at endeBeat');
  // and with the Off on the new channel it still closes (a pitch is one voice, whichever channel closes it)
  const m = nimm(p, [sid], [an(1, 62, 100, 1), aus(2, 62, 1), an(2, 62, 90, 2), aus(3, 62, 2)]);
  assert.deepEqual(absolut(m, sid), [[1, 1, 62, 100], [2, 1, 62, 90]]);
});

test('T8 take edges: notes that begin before the take (versatz) or end after it are cut to the range; a note wholly outside is dropped', () => {
  const { p, sid } = projektMit();
  // versatz 12000 samples = half a beat: a note played at 0.25 beats sits at -0.25 beats, ends at 0.75 and is cut to start at 0
  const n = nimm(p, [sid], [an(0.25, 60), aus(1.25, 60), an(0.1, 61), aus(0.4, 61), an(7.5, 62), aus(9, 62)], { versatzSamples: 12000 });
  assert.deepEqual(absolut(n, sid), [[0, 0.75, 60, 100], [7, 1, 62, 100]]);
});

test('T8 replace keeps what lies outside (hash) and removes what lies inside; the new clip covers exactly the take range', () => {
  const links = [note(0, 1, 60), note(2, 1, 62)], rechts = [note(0.5, 1, 65)], mitte = [note(0.5, 2, 70), note(2.5, 1, 71)];
  const { p, sid } = projektMit([[0, 4, links], [4, 4, mitte], [8, 4, rechts]]);
  const vorher = sucheSpur(p, sid).clips;
  const n = nimm(p, [sid], [an(4.5, 80, 90), aus(5.5, 80)], { startBeat: 4, endeBeat: 8 });
  const c = clipsVon(n, sid);
  assert.equal(c.length, 3);
  assert.equal(hash(c[0]), hash(vorher[0]), 'left clip byte for byte');
  assert.equal(hash(c[2]), hash(vorher[2]), 'right clip byte for byte');
  assert.deepEqual([c[1].start_beat, c[1].laenge_beats, c[1].art], [4, 4, 'midi']);
  assert.deepEqual(c[1].noten.map((x) => [x.beat, x.laenge, x.ton, x.vel]), [[0.5, 1, 80, 90]], 'only the take is inside; the old notes of the range are gone');
  assert.ok(!c.some((x) => x.id === vorher[1].id), 'the replaced clip is gone');
});

test('T8 replace splits a clip that reaches over the range edges; the outside notes keep their place and their ids, a note over an edge is cut by clip_teilen', () => {
  const { p, sid } = projektMit([[0, 16, [note(1, 1, 60), note(3.5, 1, 61), note(5, 1, 62), note(9, 2, 63), note(15, 1, 64)]]]);
  const n = nimm(p, [sid], [an(4.5, 80), aus(6, 80)], { startBeat: 4, endeBeat: 8 });
  const c = clipsVon(n, sid);
  assert.deepEqual(c.map((x) => [x.start_beat, x.laenge_beats]), [[0, 4], [4, 4], [8, 8]]);
  assert.deepEqual(absolut(n, sid).map((x) => [x[0], x[2]]), [[1, 60], [3.5, 61], [4.5, 80], [9, 63], [15, 64]], 'inside the range only the take; 62 is gone');
  assert.deepEqual(c[0].noten.map((x) => x.id), p.spuren[0].clips[0].noten.slice(0, 2).map((x) => x.id), 'left notes keep their ids');
  assert.deepEqual(c[2].noten.map((x) => x.id), p.spuren[0].clips[0].noten.slice(3).map((x) => x.id), 'right notes keep their ids');
  assert.equal(pruefeFehler(n), null);
});

test('T8 overdub keeps the old clip and its notes and ids and adds the new notes with fresh ids; no clip is split (negative control for "overdub treated as replace")', () => {
  const alt = [note(0, 1, 60), note(2, 1, 62), note(5, 1, 64)];
  const { p, sid } = projektMit([[0, 8, alt]]);
  const vorher = hash(sucheSpur(p, sid).clips[0].noten);
  const n = nimm(p, [sid], [an(2, 70), aus(3, 70), an(4, 71, 50), aus(4.5, 71)], { startBeat: 2, endeBeat: 6, overdub: true });
  const c = clipsVon(n, sid);
  assert.equal(c.length, 1, 'the clip is neither split nor replaced');
  assert.deepEqual([c[0].id, c[0].start_beat, c[0].laenge_beats], [p.spuren[0].clips[0].id, 0, 8]);
  assert.equal(hash(c[0].noten.slice(0, 3)), vorher, 'the old notes first, unchanged');
  assert.deepEqual(c[0].noten.slice(3).map((x) => [x.id, x.beat, x.laenge, x.ton, x.vel]), [['n4', 2, 1, 70, 100], ['n5', 4, 0.5, 71, 50]]);
  assert.equal(n.naechste_noten_id, 6);
});

test('T8 overdub: a stretch of the range that no clip covers gets a clip of its own, one per stretch; a covered part takes its notes into the clip that covers them', () => {
  const { p, sid } = projektMit([[0, 4, [note(0, 1, 60)]], [6, 2, [note(0, 1, 61)]]]);
  // range [2, 10): covered [2,4) and [6,8); free [4,6) and [8,10)
  const n = nimm(p, [sid], [an(3, 70), aus(3.5, 70), an(5, 71), aus(5.5, 71), an(7, 72), aus(7.5, 72), an(9, 73), aus(9.5, 73)], { startBeat: 2, endeBeat: 10, overdub: true });
  const c = clipsVon(n, sid);
  assert.deepEqual(c.map((x) => [x.start_beat, x.laenge_beats]), [[0, 4], [4, 2], [6, 2], [8, 2]]);
  assert.deepEqual(c.map((x) => x.noten.map((y) => y.ton)), [[60, 70], [71], [61, 72], [73]]);
  assert.deepEqual(c[1].noten[0].beat, 1, 'relative to the new clip');
  assert.deepEqual(absolut(n, sid).map((x) => x[0]), [0, 3, 5, 6, 7, 9]);
});

test('T8 overdub: a note that would reach over the end of its clip is cut at the clip end, the next clip does not receive it', () => {
  const { p, sid } = projektMit([[0, 4, []], [4, 4, []]]);
  const n = nimm(p, [sid], [an(3.5, 70), aus(5, 70)], { startBeat: 0, endeBeat: 8, overdub: true });
  assert.deepEqual(absolut(n, sid), [[3.5, 0.5, 70, 100]]);
});

test('T8 two instrument tracks get identical notes, every note with its own id from the one counter', () => {
  const { p, ids } = projektMit([], 2);
  const n = nimm(p, ids, [an(1, 60), aus(2, 60), an(3, 62, 80), aus(4, 62)]);
  const [a, b] = ids.map((id) => absolut(n, id));
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  const alle = ids.flatMap((id) => clipsVon(n, id).flatMap((c) => c.noten.map((x) => x.id)));
  assert.deepEqual(alle, ['n1', 'n2', 'n3', 'n4'], 'four notes, four ids, none twice');
  assert.equal(new Set(ids.flatMap((id) => clipsVon(n, id).map((c) => c.id))).size, 2, 'two clips, two ids');
});

test('T8 loop clips: a clip that crosses a range edge gives ersetzen_loop and changes nothing; a loop clip wholly inside is replaced; overdub into a loop clip is refused', () => {
  const { p, sid } = projektMit([[0, 8, [note(0, 1)], { loop_beats: 2 }]], 1);
  const vorher = hash(p);
  const kante = (f) => assert.throws(f, (e) => e instanceof TakeFehler && e.grund === 'ersetzen_loop');
  kante(() => nimm(p, [sid], [an(5), aus(6)], { startBeat: 4, endeBeat: 12 }));   // [4,12) cuts the loop clip [0,8) at 4
  kante(() => nimm(p, [sid], [an(1), aus(2)], { startBeat: 0, endeBeat: 4 }));    // [0,4) cuts it at 4
  assert.equal(hash(p), vorher, 'the refusals changed nothing');
  const innen = nimm(p, [sid], [an(1), aus(2)], { startBeat: 0, endeBeat: 8 });   // exactly covers it
  assert.deepEqual(clipsVon(innen, sid).map((c) => [c.start_beat, c.laenge_beats, c.loop_beats ?? null]), [[0, 8, null]]);
  kante(() => nimm(p, [sid], [an(1), aus(2)], { startBeat: 0, endeBeat: 8, overdub: true }));
});

test('T8 an empty take places nothing (keine_noten), an empty or inverted range gives punch_leer, an unknown or audio track is refused before anything changes', () => {
  let { p, sid } = projektMit([[0, 4, [note(0, 1)]]]);
  assert.throws(() => nimm(p, [sid], [aus(1, 60), { sample: START, status: 0xB0, d1: 1, d2: 2 }]), (e) => e.grund === 'keine_noten');
  assert.throws(() => nimm(p, [sid], [an(1), aus(2)], { punch: { von_beat: 9, bis_beat: 12 } }), (e) => e.grund === 'punch_leer');
  assert.throws(() => nimm(p, ['s99'], [an(1), aus(2)]), (e) => e.grund === 'veraltet_spur');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Gitarre' }]).projekt;
  assert.throws(() => nimm(p, [p.spuren[1].id], [an(1), aus(2)]), (e) => e.grund === 'art_passt_nicht');
  assert.throws(() => nimm(p, [sid, p.spuren[1].id], [an(1), aus(2)]), TakeFehler, 'all or nothing: the good track is not placed either');
});

test('T8 punch: only [von, bis) of the take is placed, notes are cut to it', () => {
  const { p, sid } = projektMit();
  const n = nimm(p, [sid], [an(1, 60), aus(3, 60), an(4, 61), aus(5, 61), an(6, 62), aus(7, 62)], { punch: { von_beat: 2, bis_beat: 6.5 } });
  const c = clipsVon(n, sid);
  assert.deepEqual([c[0].start_beat, c[0].laenge_beats], [2, 4.5]);
  assert.deepEqual(absolut(n, sid), [[2, 1, 60, 100], [4, 1, 61, 100], [6, 0.5, 62, 100]]);
});

test('T8 file reader: records of 12 bytes (i64 sample, status, d1, d2, pad) little endian, a torn last record is dropped', () => {
  const puf = Buffer.alloc(3 * 12 + 5);
  [[48_000_000_123, 0x90, 60, 100], [48_000_000_999, 0xB0, 1, 64], [48_000_001_000, 0x80, 60, 0]].forEach(([s, st, a, b], i) => {
    puf.writeBigInt64LE(BigInt(s), i * 12); puf[i * 12 + 8] = st; puf[i * 12 + 9] = a; puf[i * 12 + 10] = b; puf[i * 12 + 11] = 0;
  });
  assert.deepEqual(leseMidiDatei(puf), [
    { sample: 48_000_000_123, status: 0x90, d1: 60, d2: 100 }, { sample: 48_000_000_999, status: 0xB0, d1: 1, d2: 64 }, { sample: 48_000_001_000, status: 0x80, d1: 60, d2: 0 }]);
  assert.deepEqual(leseMidiDatei(Buffer.alloc(0)), []);
});

// ---- part 2: the run through the server (mock core context) ---------------------------------------------------------------------------------------------------------
const ergebnis = async (pr) => { try { const r = await pr; return { code: r.code, j: r.j }; } catch (x) { return { code: x.code, fehler: x.fehler, grund: x.extra?.grund }; } };
const ANGENOMMEN = { status: 1, grund: '' };
const ERK0 = { audio: [], midi: [{ port: 'Midi-Bridge:XDJ-XZ (1): XDJ-XZ MIDI 1', alias: 'XDJ-XZ (1):XDJ-XZ MIDI 1' }] };
// opt.midi: { frei, versatz } writes a device on midi_ein_1 into a temp config; without it the file has no MIDI device
function konfigDatei(d, midi) {
  let k = standard();
  if (midi) {
    k = setzeMidi(k, 'andreas', { profil: 'xdj-xz' }, ERK0);
    if (midi.versatz !== undefined) k = setzeMidi(k, 'andreas', { versatz_samples: midi.versatz }, ERK0);
    if (midi.frei) k = setzeMidi(k, 'andreas', { frei_fuer_cypher: true }, ERK0);
  }
  const pfad = path.join(d, 'geraete.json');
  new GeraeteSpeicher(pfad).schreibe(k);
  return pfad;
}
const REC_MELDUNG = (vorhalt) => ({ status: 0, kennung: 0, scharf: 0, luecken: 0n, projekt_beat: 0, ausgang_vorhalt: vorhalt, quantum: 256, rec_midi_scharf: 0 });
// spuren: [{ name, art: 'instrument' | 'audio', clips?: [[start, length, notes]], overdub? }]; instrument tracks are armed on midi_ein_1, audio tracks on erz/1
async function bereit(t, { spuren, midi, vorhalt = 144, overdub = false }) {
  const k = pruefKontext();
  const roh = k.warteQuittung.bind(k);
  k.warteQuittung = async (id) => (k.gesendet.find((x) => x.id === id)?.adresse === '/k/rec/start' ? ANGENOMMEN : roh(id));
  const d = tmpOrdner(t, 'djk-recmidi-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const br = aufnahmeBereich(k, b.zugang, { fristMs: 60, geraeteKonfig: konfigDatei(d, midi), zustandMs: 80, ladeMs: 150 });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung, a = br.aufnahme;
  await s.neu('R', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: BPM });
  const rev = () => s.aktuell().j.projekt.rev;
  const gib = async (label, befehle) => { const r = await s.aendern({ rev: rev(), label, befehle }, 'andreas'); assert.equal(r.code, 200, JSON.stringify(r.j)); };
  await gib('Tempo', [{ befehl: 'tempo_setzen', bpm: BPM }]);
  for (const sp of spuren) {
    await gib('Spur', [{ befehl: 'spur_neu', art: sp.art, name: sp.name }]);
    const id = s.aktuell().j.projekt.spuren.at(-1).id;
    for (const [von, laenge, noten] of sp.clips ?? []) {
      await gib('Clip', [{ befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: von, laenge_beats: laenge, ...(noten.length > 0 ? { noten } : {}) }]);
    }
    await gib('Arm', [{ befehl: 'spur_aendern', spur_id: id, arm: true, eingang: sp.art === 'instrument' ? { art: 'midi' } : { art: 'intern', name: 'erz/1' } }]);
  }
  if (overdub) await gib('Overdub', [{ befehl: 'aufnahme_setzen', overdub: true }]);
  const arrMeldung = () => ({ status: 0, nr: s.aktuell().j.projekt.wiedergabe_rev, loop_an: 0, projekt_beat: 0, ursprung_sample: -1n, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  a.ereignis('/zustand/arr', arrMeldung());
  a.ereignis('/zustand/rec', REC_MELDUNG(vorhalt));
  await a.abgeglichen();
  k.leere();
  const kern = (adr, f) => { b.ereignis(adr, f); a.ereignis(adr, f); };
  const spurenNeu = () => s.aktuell().j.projekt.spuren;
  const arbeits = b.zugang.arbeitsordner();
  // the core's MIDI take: file, sidecar and the report; `ereignisse` as [sample, status, d1, d2]; `ende` is the sidecar's ende_sample
  const meldeMidi = (kennung, ereignisse, { ende, status = 0, start = START, art = 1, ohneDatei = false } = {}) => {
    if (!ohneDatei) {
      const puf = Buffer.alloc(ereignisse.length * 12);
      ereignisse.forEach(([sm, st, d1, d2], i) => { puf.writeBigInt64LE(BigInt(sm), i * 12); puf[i * 12 + 8] = st; puf[i * 12 + 9] = d1; puf[i * 12 + 10] = d2; });
      fs.writeFileSync(path.join(arbeits, `midi-${kennung}.bin`), puf);
      fs.writeFileSync(path.join(arbeits, `midi-${kennung}.json`), JSON.stringify({ art: 'midi', spur: 0, kennung, eingang: 30, start_sample: start, ende_sample: ende, status: 'fertig' }));
    }
    kern('/e/aufnahme', { spur: 0, kennung, status, frames: ereignisse.length, start_sample: BigInt(start), luecken: 0, art });
  };
  const meldeAudio = (nr, kennung, frames) => {
    const buf = Buffer.alloc(frames * 8);
    for (let i = 0; i < frames; i++) { buf.writeFloatLE((i % 1000) / 1000, i * 8); buf.writeFloatLE(-(i % 1000) / 1000, i * 8 + 4); }
    fs.writeFileSync(path.join(arbeits, `aufnahme-${nr}-${kennung}.f32`), buf);
    kern('/e/aufnahme', { spur: nr, kennung, status: 0, frames, start_sample: BigInt(START), luecken: 0, art: 0 });
  };
  const umkehr = (art) => b.sitzung.umkehr(art, { rev: rev() }, 'andreas');
  return { k, b, s, a, d, kern, arbeits, spurenNeu, meldeMidi, meldeAudio, gib, rev, umkehr, kernLaedt: () => { a.ereignis('/zustand/arr', arrMeldung()); a.ereignis('/zustand/rec', REC_MELDUNG(vorhalt)); } };
}
// notes of a take in project beats (from the take start) as events with the offset `versatz` baked in: the compensated beat is exactly the one given
const mitVersatz = (versatz) => (beat, laenge, ton, vel = 100) => [
  [START + Math.round(beat * BEAT) + versatz, 0x90, ton, vel], [START + Math.round((beat + laenge) * BEAT) + versatz, 0x80, ton, 0]];
const ereignisListe = (...paare) => paare.flat().sort((x, y) => x[0] - y[0]);
const VORHALT = 144, MV = 256, V = VORHALT + MV;   // ausgang_vorhalt of the core + midi.versatz_samples = the offset of the MIDI take
const takt = (versatz = V) => ({ n: mitVersatz(versatz), ende: START + 8 * BEAT + versatz });   // a pass of 8 beats plus a tail of `versatz`

test('T8 an instrument-only run: arming goes out as eingang 30, the run starts, the one MIDI report ends it and puts the notes in a clip (offset = vorhalt + midi.versatz_samples)', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument' }], midi: { versatz: MV } });
  assert.deepEqual(e.a.imKernStand(e.spurenNeu()[0].nr), { eingang: 30, modus: 0, monitor: 1 }, 'sent at arming (D13), the core confirmed it');
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.deepEqual(r.j.spuren.map((x) => [x.art, x.versatz_samples]), [['instrument', V]]);
  assert.equal(r.j.nachlauf_samples, V, 'one tail for the run: the largest offset');
  assert.equal(e.k.an('/k/rec/start')[0].felder.nachlauf_samples, V);
  assert.equal(e.a.lage().j.lauf.spuren[0].art, 'instrument');
  const { n, ende } = takt();
  e.meldeMidi(r.j.kennung, ereignisListe(n(0.5, 1, 60), n(2, 0.25, 64, 80), n(7.5, 1, 67)), { ende });   // the last note reaches over the end of the pass
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 3000), 'one report with art 1 ends the run, no audio report is awaited');
  const z = e.a.lage().j.letzte;
  assert.equal(z.code, 200, JSON.stringify(z));
  assert.deepEqual(z.takes.map((x) => [x.art, x.fehler, x.ereignisse, x.noten, x.versatz_samples, x.overdub]), [['midi', undefined, 6, 3, V, false]]);
  const clips = e.spurenNeu()[0].clips;
  assert.equal(clips.length, 1);
  assert.deepEqual([clips[0].art, clips[0].start_beat, clips[0].laenge_beats, clips[0].name], ['midi', 0, 8, `Take ${r.j.kennung}`]);
  assert.deepEqual(clips[0].noten.map((x) => [x.beat, x.laenge, x.ton, x.vel]), [[0.5, 1, 60, 100], [2, 0.25, 64, 80], [7.5, 0.5, 67, 100]], 'beats compensated, the last note cut at the pass');
  assert.ok(fs.existsSync(path.join(e.arbeits, `midi-${r.j.kennung}.bin`)), 'the take file stays');
  assert.equal(e.b.sitzung.ladenGesperrt(), false, 'the lock is gone');
});

test('T8 Cypher records MIDI only with midi.frei_fuer_cypher: without it 409 eingang_nicht_frei and nothing goes to the core; Andreas needs no release; with it Cypher starts', async (t) => {
  const zu = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument' }], midi: { frei: false } });
  const r = await ergebnis(zu.a.start({ von_beat: 0 }, 'cypher'));
  assert.deepEqual([r.code, r.fehler], [409, 'eingang_nicht_frei']);
  assert.equal(zu.k.an('/k/rec/start').length, 0);
  assert.equal(zu.b.sitzung.ladenGesperrt(), false, 'no lock left behind');
  assert.equal((await ergebnis(zu.a.start({ von_beat: 0 }, 'andreas'))).code, 200, 'Andreas needs no release');
  const auf = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument' }], midi: { frei: true } });
  assert.equal((await ergebnis(auf.a.start({ von_beat: 0 }, 'cypher'))).code, 200);
  const ohne = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument' }] });   // no MIDI device at all
  assert.equal((await ergebnis(ohne.a.start({ von_beat: 0 }, 'cypher'))).fehler, 'eingang_nicht_frei', 'no device cannot be released');
  assert.equal((await ergebnis(ohne.a.start({ von_beat: 0 }, 'andreas'))).code, 200, 'the computer keyboard or any source on midi_ein_1 needs no device for Andreas');
});

test('T8 without midi.versatz_samples the offset is the core delay only, no hint; an implausible value in the file is latenz_ungueltig', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument' }], midi: {}, vorhalt: 84 });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.j.spuren[0].versatz_samples, r.j.nachlauf_samples, r.j.hinweise], [200, 84, 84, undefined]);
  const f = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument' }], midi: { versatz: 48000 }, vorhalt: 440000 });
  assert.deepEqual(await ergebnis(f.a.start({ von_beat: 0 }, 'andreas')).then((x) => [x.code, x.fehler]), [409, 'latenz_ungueltig'], 'together over the tail the core accepts');
  assert.equal(f.k.an('/k/rec/start').length, 0);
});

test('T8 a mixed run (audio and instrument track) is ONE undo step for both; the run ends only when both reports are in; the audio track is not touched by the MIDI offset', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'Gitarre', art: 'audio' }, { name: 'Keys', art: 'instrument' }], midi: { versatz: MV } });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.deepEqual(r.j.spuren.map((x) => [x.name, x.art, x.versatz_samples]), [['Gitarre', undefined, 0], ['Keys', 'instrument', V]]);
  const vorher = e.s.aktuell().j.projekt, revVor = vorher.rev;
  const { n, ende } = takt();
  e.meldeAudio(vorher.spuren[0].nr, r.j.kennung, 48000);
  await warte(60);
  assert.notEqual(e.a.lage().j.lauf, null, 'the audio report alone does not end the run');
  e.meldeMidi(r.j.kennung, ereignisListe(n(1, 1, 60)), { ende });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 3000));
  const z = e.a.lage().j.letzte;
  assert.deepEqual(z.takes.map((x) => [x.spur_id === vorher.spuren[0].id ? 'audio' : 'midi', x.fehler]), [['audio', undefined], ['midi', undefined]]);
  const p = e.s.aktuell().j.projekt;
  assert.deepEqual(p.spuren.map((x) => x.clips.map((c) => c.art)), [['audio'], ['midi']]);
  assert.equal(p.rev, revVor + 1, 'one new revision for both tracks');
  const u = await e.umkehr('undo');
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.deepEqual(e.s.aktuell().j.projekt.spuren.map((x) => x.clips.length), [0, 0], 'one undo takes both clips');
  assert.equal((await e.umkehr('redo')).code, 200);
  assert.deepEqual(e.s.aktuell().j.projekt.spuren.map((x) => x.clips.length), [1, 1], 'and one redo brings both back');
});

test('T8 a missing MIDI file is datei_fehlt for the instrument track only; the audio take of the same run is still placed', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'Gitarre', art: 'audio' }, { name: 'Keys', art: 'instrument' }], midi: {} });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  const nr = e.s.aktuell().j.projekt.spuren[0].nr;
  e.meldeAudio(nr, r.j.kennung, 48000);
  e.meldeMidi(r.j.kennung, [], { ohneDatei: true });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 3000));
  const z = e.a.lage().j.letzte;
  assert.deepEqual(z.takes.map((x) => x.fehler), [undefined, 'datei_fehlt']);
  assert.deepEqual(e.spurenNeu().map((x) => x.clips.length), [1, 0]);
});

test('T8 a take without a complete note places nothing (keine_noten) and leaves the track as it was; the file stays', async (t) => {
  const alt = [[0, 8, [note(1, 1, 60)]]];
  const e = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument', clips: alt }], midi: {} });
  const vorher = hash(e.spurenNeu());
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  e.meldeMidi(r.j.kennung, [[START + 100, 0x80, 60, 0], [START + 200, 0xB0, 1, 20]], { ende: START + 8 * BEAT + VORHALT });   // a stray Off and a controller
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 3000));
  const z = e.a.lage().j.letzte;
  assert.deepEqual(z.takes.map((x) => x.fehler), ['keine_noten']);
  assert.equal(hash(e.spurenNeu()), vorher);
  assert.ok(fs.existsSync(path.join(e.arbeits, `midi-${r.j.kennung}.bin`)));
});

test('T8 replace is the default: the range of the take is replaced, clips outside stay; the overdub switch of the project at the start makes it an overdub', async (t) => {
  const alt = [[0, 8, [note(1, 1, 60), note(5, 1, 62)]]];
  const { n, ende } = takt(VORHALT);
  const lauf = async (e) => {
    const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
    e.meldeMidi(r.j.kennung, ereignisListe(n(2, 1, 70)), { ende });
    assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 3000));
    return e.a.lage().j.letzte;
  };
  const ersetzt = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument', clips: alt }], midi: {} });
  assert.equal((await lauf(ersetzt)).code, 200);
  assert.deepEqual(ersetzt.spurenNeu()[0].clips.map((c) => c.noten.map((x) => x.ton)), [[70]], 'replace: the old notes of the range are gone');
  const ueberspielt = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument', clips: alt }], midi: {}, overdub: true });
  const z = await lauf(ueberspielt);
  assert.deepEqual(z.takes.map((x) => x.overdub), [true]);
  assert.deepEqual(ueberspielt.spurenNeu()[0].clips.map((c) => [c.start_beat, c.laenge_beats, c.noten.map((x) => x.ton)]), [[0, 8, [60, 62, 70]]], 'overdub: old notes stay, the new one joins');
});

test('T8 note ids come from the one counter and are never reused: run, undo, run again continues above the first run (overdub)', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument', clips: [[0, 8, [note(0, 1, 60), note(2, 1, 61)]]] }], midi: {}, overdub: true });
  const { n, ende } = takt(VORHALT);
  const einmal = async (ton) => {
    e.kernLaedt();   // the core plays the playback of the project again (the notes changed it)
    const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
    assert.equal(r.code, 200, JSON.stringify(r));
    e.meldeMidi(r.j.kennung, ereignisListe(n(1, 1, ton), n(4, 1, ton + 1)), { ende });
    assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 3000));
    return e.spurenNeu()[0].clips[0].noten.map((x) => x.id);
  };
  assert.deepEqual(await einmal(70), ['n1', 'n2', 'n3', 'n4'], 'old ids first, then fresh ones');
  assert.equal((await e.umkehr('undo')).code, 200);
  assert.deepEqual(e.spurenNeu()[0].clips[0].noten.map((x) => x.id), ['n1', 'n2'], 'undo takes the new notes');
  assert.deepEqual(await einmal(80), ['n1', 'n2', 'n5', 'n6'], 'the counter did not go back with the undo: n3 and n4 are not used again');
  assert.equal((await e.umkehr('undo')).code, 200);
  assert.equal((await e.umkehr('redo')).code, 200);
  assert.deepEqual(e.spurenNeu()[0].clips[0].noten.map((x) => x.id), ['n1', 'n2', 'n5', 'n6'], 'redo brings the same ids back');
});

test('T8 punch: the project range cuts the MIDI take like the audio take (punch in and out)', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument' }], midi: {} });
  await e.gib('Punch', [{ befehl: 'aufnahme_setzen', punch: { ein: true, aus: true, von_beat: 2, bis_beat: 6 } }]);
  const { n, ende } = takt(VORHALT);
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r));
  e.meldeMidi(r.j.kennung, ereignisListe(n(1, 0.5, 60), n(3, 1, 62), n(5.5, 2, 64)), { ende });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 3000));
  const c = e.spurenNeu()[0].clips;
  assert.deepEqual(c.map((x) => [x.start_beat, x.laenge_beats]), [[2, 4]]);
  assert.deepEqual(c[0].noten.map((x) => [x.beat, x.laenge, x.ton]), [[1, 1, 62], [3.5, 0.5, 64]], 'in the clip relative to its start: note 60 is before the range, 64 is cut at 6');
});

test('T8 arming an instrument track follows the project to the core (D13): eingang 30, mode 0; disarming sends scharf 0; an audio arm of the same project is untouched', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'Keys', art: 'instrument' }, { name: 'Gitarre', art: 'audio' }], midi: {} });
  assert.deepEqual(e.a.imKernStand(e.spurenNeu()[0].nr), { eingang: 30, modus: 0, monitor: 1 });
  assert.equal(e.a.imKernStand(e.spurenNeu()[1].nr).eingang, 11);
  e.k.leere();
  await e.gib('Disarm', [{ befehl: 'spur_aendern', spur_id: e.spurenNeu()[0].id, arm: false }]);
  await e.a.abgeglichen();
  assert.deepEqual(e.k.an('/k/rec/spur').map((m) => [m.felder.spur, m.felder.scharf]), [[e.spurenNeu()[0].nr, 0]]);
  assert.equal(e.a.imKernStand(e.spurenNeu()[0].nr), null);
});

// ---- part 3: the whole path through the real server with the core stand-in ---------------------------------------------------------------------------------------------
test('T8 server and stand-in: an instrument-only run (no audio track) gives a MIDI clip whose notes are exactly the deterministic pattern of the stand-in', async (t) => {
  const d = tmpOrdner(t, 'djk-recmidi2-');
  const arr = path.join(d, 'arr');
  const { url, log } = await stapel(t, { proj: { arbeitsordner: arr } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Keys' });
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'instrument', name: 'Keys' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const b = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: p.spuren[0].id, eingang: { art: 'midi' }, arm: true }] });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  const st = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  assert.ok(log.some((z) => z.typ === 'an_kern' && z.adresse === '/k/rec/spur' && z.felder?.eingang === 30), 'eingang 30 went to the stand-in');
  await warte(400);
  const stop = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
  assert.equal(stop.code, 200, JSON.stringify(stop.j));
  const take = stop.j.takes[0];
  assert.ok(!take.fehler && take.noten > 0, JSON.stringify(take));
  const bin = fs.readFileSync(path.join(arr, `midi-${st.j.kennung}.bin`)), side = JSON.parse(fs.readFileSync(path.join(arr, `midi-${st.j.kennung}.json`), 'utf8'));
  const ev = leseMidiDatei(bin).filter((x) => (x.status & 0xF0) === 0x90 || (x.status & 0xF0) === 0x80);
  const erwartet = [];
  for (let i = 0; i < ev.length; i += 2) {   // the pattern writes every note on directly followed by its note off (never overlapping)
    erwartet.push([bisNeun(((ev[i].sample - side.start_sample) * bpm) / (60 * RATE)), bisNeun(((ev[i + 1].sample - ev[i].sample) * bpm) / (60 * RATE)), ev[i].d1, ev[i].d2]);
  }
  const clip = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].clips[0];
  assert.equal(clip.art, 'midi');
  assert.equal(clip.noten.length, erwartet.length, 'every note of the file is a note of the clip');
  assert.equal(take.noten, erwartet.length);
  clip.noten.forEach((x, i) => {
    assert.ok(Math.abs(x.beat - erwartet[i][0]) < 1e-9 && Math.abs(x.laenge - erwartet[i][1]) < 1e-9, `note ${i}: ${x.beat}/${x.laenge} against ${erwartet[i]}`);
    assert.deepEqual([x.ton, x.vel], [erwartet[i][2], erwartet[i][3]]);
  });
  assert.equal((await ruf(url, 'GET', '/proj/verlauf')).j.at(-1).label, 'Record Keys');
  const u = await ruf(url, 'POST', '/proj/undo', { rev: (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.equal((await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].clips.length, 0, 'one undo takes the clip');
});

// ---- part 4: the device field midi.versatz_samples (Andreas only) ------------------------------------------------------------------------------------------------------
const ERK = { audio: [], midi: [{ port: 'Midi-Bridge:XDJ-XZ (1): XDJ-XZ MIDI 1', alias: 'XDJ-XZ (1):XDJ-XZ MIDI 1' }, { port: 'Midi-Bridge:Keys (1)', alias: 'Keys:Keys' }] };
const grundVon = (f) => { try { f(); } catch (e) { return e instanceof GeraeteFehler ? `${e.grund}/${e.code}` : String(e); } return null; };
const mitGeraet = () => setzeMidi(standard(), 'andreas', { profil: 'xdj-xz' }, ERK);

test('T8 device: Andreas sets midi.versatz_samples (0..48000, whole samples), the value is kept in the file and read back', () => {
  const k = setzeMidi(mitGeraet(), 'andreas', { versatz_samples: 1200 }, ERK);
  assert.equal(k.midi.versatz_samples, 1200);
  assert.equal(pruefeKonfig(JSON.parse(JSON.stringify(k))).midi.versatz_samples, 1200, 'the strict file check accepts it');
  assert.equal(setzeMidi(k, 'andreas', { versatz_samples: 0 }, ERK).midi.versatz_samples, 0, 'zero is a value, not a removal');
  assert.equal('versatz_samples' in standard().midi, false, 'a fresh file carries no key (absent means 0)');
  assert.equal(setzeMidi(k, 'andreas', { frei_fuer_cypher: true }, ERK).midi.versatz_samples, 1200, 'releasing for Cypher leaves it');
});

test('T8 device: Cypher cannot write midi.versatz_samples (403 latenz_nur_andreas, nothing changes); the same call by Andreas passes', () => {
  const k = mitGeraet();
  assert.equal(grundVon(() => setzeMidi(k, 'cypher', { versatz_samples: 300 }, ERK)), 'latenz_nur_andreas/403');
  assert.equal(grundVon(() => setzeMidi(k, 'andreas', { versatz_samples: 300 }, ERK)), null, 'control: Andreas');
  assert.equal(k.midi.versatz_samples, undefined, 'the input is never touched');
});

test('T8 device: range and type are checked, a device is needed, another device takes the offset away', () => {
  const k = mitGeraet();
  for (const v of [-1, 48001, 1.5, '12', null, Number.NaN]) assert.equal(grundVon(() => setzeMidi(k, 'andreas', { versatz_samples: v }, ERK)), 'argument_ungueltig/400', String(v));
  assert.equal(setzeMidi(k, 'andreas', { versatz_samples: 48000 }, ERK).midi.versatz_samples, 48000);
  assert.equal(grundVon(() => setzeMidi(standard(), 'andreas', { versatz_samples: 10 }, ERK)), 'eingang_leer/409', 'no device on the input');
  const k2 = setzeMidi(k, 'andreas', { versatz_samples: 700 }, ERK);
  assert.equal(setzeMidi(k2, 'andreas', { profil: 'xdj-xz' }, ERK).midi.versatz_samples, 700, 'the same device again keeps it');
  assert.equal('versatz_samples' in setzeMidi(k2, 'andreas', { profil: 'midi-controller', port: 'Midi-Bridge:Keys (1)' }, ERK).midi, false, 'another device: gone');
  assert.equal('versatz_samples' in setzeMidi(k2, 'andreas', { profil: null }, ERK).midi, false, 'no device: gone');
});

test('T8 device: a file with a bad midi.versatz_samples is reported, never overwritten', () => {
  const k = mitGeraet();
  for (const v of [-5, 48001, 2.5, 'x']) assert.throws(() => pruefeKonfig({ ...k, midi: { ...k.midi, versatz_samples: v } }), (e) => e instanceof GeraeteFehler && e.grund === 'konfig_defekt', String(v));
});
