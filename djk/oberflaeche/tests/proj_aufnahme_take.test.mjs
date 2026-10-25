// 1.8 Task 26: WAV aus der Rohdatei (bitgenau, nie ersetzen) und der Clip auf der Spur (Ersetzen-Regel, ein Zustandswechsel).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schreibeWavAusF32, nehmeTakeAuf, wavKopf, eingangsCode } from '../projekt/aufnahme.ts';
import { fuehreListeAus } from '../projekt/befehle.ts';
import { neuesProjekt as neuesProjektModell } from '../projekt/modell.ts';

const neuesProjekt = () => neuesProjektModell('T');   // projekt/modell.ts (Probelauf, N7)
const SHA = 'a'.repeat(64);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'djk-take-'));

test('WAV: Kopf 58 Byte wie wav.h, Daten sind die Rohdatei unverändert, sha256 über die ganze WAV, nie ersetzen', () => {
  const d = tmp();
  const roh = Buffer.alloc(5 * 8);
  for (let i = 0; i < 5; i++) { roh.writeFloatLE(0.25 * (i + 1), i * 8); roh.writeFloatLE(-0.25 * (i + 1), i * 8 + 4); }
  fs.writeFileSync(path.join(d, 'r.f32'), roh);
  const r = schreibeWavAusF32(path.join(d, 'r.f32'), path.join(d, 'out', 't.wav'));
  assert.equal(r.frames, 5);
  const w = fs.readFileSync(path.join(d, 'out', 't.wav'));
  assert.equal(w.length, 58 + 40);
  assert.deepEqual(w.subarray(0, 58), wavKopf(5));
  assert.equal(w.toString('ascii', 0, 4) + w.toString('ascii', 8, 12), 'RIFFWAVE');
  assert.equal(w.readUInt32LE(4), 50 + 40, 'RIFF-Größe = 50 + 8 · frames');
  assert.equal(w.readUInt16LE(20), 3, 'WAVE_FORMAT_IEEE_FLOAT');
  assert.deepEqual([w.readUInt16LE(22), w.readUInt32LE(24), w.readUInt16LE(34)], [2, 48000, 32]);
  assert.equal(w.toString('ascii', 38, 42), 'fact');
  assert.equal(w.readUInt32LE(46), 5);
  assert.deepEqual(w.subarray(58), roh, 'bitgleich');
  assert.equal(r.sha256, crypto.createHash('sha256').update(w).digest('hex'));
  assert.throws(() => schreibeWavAusF32(path.join(d, 'r.f32'), path.join(d, 'out', 't.wav')), /EEXIST/, 'nie ersetzen');
  fs.writeFileSync(path.join(d, 'halb.f32'), Buffer.concat([roh, Buffer.alloc(3)]));
  assert.equal(schreibeWavAusF32(path.join(d, 'halb.f32'), path.join(d, 'out', 'h.wav')).frames, 5, 'ein halber letzter Frame wird verworfen');
  fs.rmSync(d, { recursive: true, force: true });
});

test('eingangsCode: erz/1..3 = 11..13, sonst Fehler', () => {
  assert.deepEqual(['erz/1', 'erz/2', 'erz/3'].map(eingangsCode), [11, 12, 13]);
  assert.throws(() => eingangsCode('erz/4'));
});

const projektMitClips = () => {
  let p = neuesProjekt();
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Gitarre' }]).projekt;
  const sid = p.spuren[0].id;
  p = fuehreListeAus(p, [
    { befehl: 'clip_neu', spur_id: sid, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: 'b'.repeat(64), name: 'alt' },
    { befehl: 'clip_neu', spur_id: sid, art: 'audio', start_beat: 20, laenge_beats: 4, sha256: 'c'.repeat(64), name: 'weit' },
  ]).projekt;
  return { p, sid };
};
const nehme = (p, sid, v, l) => nehmeTakeAuf(p, { spurId: sid, startBeat: v, laengeBeats: l, sha256: SHA, pfadHinweis: '/x/take.wav', name: 'Take 1' });

test('Take auf freier Fläche: ein neuer Clip, nichts anderes ändert sich (Negativ-Kontrolle)', () => {
  const { p, sid } = projektMitClips();
  const n = nehme(p, sid, 30, 8);
  const clips = n.spuren[0].clips;
  assert.equal(clips.length, 3);
  const neu = clips.find((c) => c.quelle.sha256 === SHA);
  assert.deepEqual([neu.start_beat, neu.laenge_beats, neu.offset_s, neu.art], [30, 8, 0, 'audio']);
  assert.deepEqual(p.spuren[0].clips.map((c) => JSON.stringify(c)), clips.filter((c) => c !== neu).map((c) => JSON.stringify(c)), 'die übrigen Clips sind unverändert');
});

test('Take mitten in einen Clip (AK9): links bleibt [0,4), rechts [8,16) mit fortgeschriebenem Offset, der Take liegt dazwischen, der ferne Clip bleibt', () => {
  const { p, sid } = projektMitClips();
  const n = nehme(p, sid, 4, 4);   // 128 BPM Vorgabe: 4 Beats = 1,875 s
  const clips = [...n.spuren[0].clips].sort((a, b) => a.start_beat - b.start_beat);
  assert.deepEqual(clips.map((c) => [c.start_beat, c.laenge_beats, c.quelle.sha256[0]]), [[0, 4, 'b'], [4, 4, 'a'], [8, 8, 'b'], [20, 4, 'c']]);
  const rechts = clips[2];
  assert.ok(Math.abs(rechts.offset_s - (8 * 60) / p.tempo_bpm) < 1e-6, 'der rechte Rest startet 8 Beats tief im Material');
  assert.deepEqual(JSON.stringify(clips[3]), JSON.stringify(p.spuren[0].clips[1]), 'der ferne Clip ist byteweise unverändert');
});

test('Take über einen Clip hinweg: ganz überdeckte Clips verschwinden, teilweise überdeckte werden gekürzt', () => {
  const { p, sid } = projektMitClips();
  const n = nehme(p, sid, 12, 10);   // [12,22): kürzt [0,16) auf [0,12), schneidet [20,24) auf [22,24)
  const clips = [...n.spuren[0].clips].sort((a, b) => a.start_beat - b.start_beat);
  assert.deepEqual(clips.map((c) => [c.start_beat, c.laenge_beats, c.quelle.sha256[0]]), [[0, 12, 'b'], [12, 10, 'a'], [22, 2, 'c']]);
  const voll = nehme(p, sid, 0, 30);
  assert.deepEqual(voll.spuren[0].clips.map((c) => [c.start_beat, c.laenge_beats, c.quelle.sha256[0]]), [[0, 30, 'a']], 'alles überdeckt: nur der Take bleibt');
});

test('Ein Loop-Clip, der angeschnitten würde, lässt den Take nicht setzen: ersetzen_loop', () => {
  let { p, sid } = projektMitClips();
  p = fuehreListeAus(p, [{ befehl: 'clip_aendern', clip_id: p.spuren[0].clips[0].id, loop_beats: 2 }]).projekt;
  assert.throws(() => nehme(p, sid, 4, 4), (e) => e.grund === 'ersetzen_loop');
  const frei = nehme(p, sid, 40, 4);   // ohne Überlapp geht es
  assert.equal(frei.spuren[0].clips.length, 3);
});

test('Spur weg: veraltet_spur', () => {
  const { p } = projektMitClips();
  assert.throws(() => nehmeTakeAuf(p, { spurId: 'gibt-es-nicht', startBeat: 0, laengeBeats: 1, sha256: SHA, pfadHinweis: '', name: 'x' }), (e) => e.grund === 'veraltet_spur');
});

test('R1 Take über 3 h 6 min (RIFF-Größe 32 Bit): TakeFehler take_zu_lang vor dem Öffnen, keine leere WAV (Negativ-Kontrolle: knapp darunter geht)', () => {
  const d = tmp(), roh = path.join(d, 'roh.f32');
  try {
    const grenze = Math.floor((0xFFFFFFFF - 50) / 8);
    fs.closeSync(fs.openSync(roh, 'w')); fs.truncateSync(roh, (grenze + 1) * 8);   // dünn besetzt: kostet keinen Platz
    const ziel = path.join(d, 'aus', 'lang.wav');
    assert.throws(() => schreibeWavAusF32(roh, ziel), (e) => e.constructor.name === 'TakeFehler' && e.grund === 'take_zu_lang');
    assert.equal(fs.existsSync(ziel), false);
    assert.equal(wavKopf(grenze).readUInt32LE(4), 50 + grenze * 8, 'Negativ-Kontrolle: bis zur Grenze schreibt der Kopf');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test('R1 WAV existiert schon (wx): EEXIST, die vorhandene Datei bleibt unberührt', () => {
  const d = tmp(), roh = path.join(d, 'roh.f32'), ziel = path.join(d, 'aus', 'x.wav');
  try {
    fs.writeFileSync(roh, Buffer.alloc(80, 1));
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, 'vorhanden');
    assert.throws(() => schreibeWavAusF32(roh, ziel), /EEXIST/);
    assert.equal(fs.readFileSync(ziel, 'utf8'), 'vorhanden', 'wx: eine vorhandene Datei wird nie entfernt');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test('R1 Lesefehler mitten im Schreiben (Quelle ist ein Verzeichnis, EISDIR): die halbe WAV wird entfernt', () => {
  const d = tmp(), ziel = path.join(d, 'aus', 'halb.wav');
  try {
    assert.throws(() => schreibeWavAusF32(d, ziel), /EISDIR/);
    assert.equal(fs.existsSync(ziel), false, 'keine halbe WAV zurück');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
