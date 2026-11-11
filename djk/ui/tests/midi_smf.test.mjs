// SMF reader (project/smf.ts): fixtures are built from bytes in the test, no real MIDI file is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leseSmf, SmfFehler, gmProgrammName } from '../project/smf.ts';
import { smf, spur, nameMeta, tempoMeta, taktMeta, programm, an, aus, note, meta } from './helpers/smf_build.mjs';

const wirft = (f, grund) => assert.throws(f, (e) => e instanceof SmfFehler && e.grund === grund, grund);

test('format 1: tempo, time signature, track names, notes with exact ticks', () => {
  const d = leseSmf(smf([
    spur([nameMeta('conductor'), tempoMeta(72), taktMeta(3, 2)]),
    spur([nameMeta('Flute'), programm(0, 73), ...note(0, 60, 100, 96), ...note(0, 62, 90, 192, 0)]),
  ]));
  assert.equal(d.format, 1);
  assert.equal(d.ticksProViertel, 192);
  assert.equal(d.spurenGelesen, 2);
  assert.deepEqual(d.spurNamen, ['conductor', 'Flute']);
  assert.equal(d.tempi.length, 1);
  assert.ok(Math.abs(d.tempi[0].bpm - 72) < 1e-4);
  assert.deepEqual(d.taktarten, [{ tick: 0, zaehler: 3, nenner: 4 }]);
  assert.equal(d.teile.length, 1);
  const t = d.teile[0];
  assert.equal(t.spur, 1); assert.equal(t.kanal, 0); assert.equal(t.name, 'Flute'); assert.equal(t.programm, 73);
  assert.deepEqual(t.noten, [{ tick: 0, dauer: 96, ton: 60, vel: 100 }, { tick: 96, dauer: 192, ton: 62, vel: 90 }]);
  assert.equal(gmProgrammName(73), 'Flute');
  assert.equal(d.hinweise.length, 0);
});

test('running status and note-on with velocity 0 as note-off', () => {
  const ev = [an(0, 60, 80, 0), an(0, 60, 0, 48), an(0, 64, 80, 0), an(0, 64, 0, 48)];
  const d = leseSmf(smf([spur(ev, { running: true })], { format: 0 }));
  assert.equal(d.format, 0);
  assert.deepEqual(d.teile[0].noten.map((n) => [n.tick, n.dauer, n.ton]), [[0, 48, 60], [48, 48, 64]]);
});

test('one part per channel of a chunk; channel 10 is index 9; program is the one in force at the first note', () => {
  const d = leseSmf(smf([spur([programm(2, 40), ...note(2, 55, 70, 24), ...note(9, 38, 100, 12), programm(2, 41, 0), ...note(2, 57, 70, 24)])]));
  assert.deepEqual(d.teile.map((t) => [t.kanal, t.programm, t.noten.length]), [[2, 40, 2], [9, null, 1]]);
  assert.deepEqual(d.teile[0].programme, [40, 41]);
});

test('overlapping notes of one pitch pair first on, first off; stray note-off dropped; open note ends with the track', () => {
  const ev = [an(0, 60, 80, 0), an(0, 60, 90, 10), aus(0, 60, 10), aus(0, 60, 10), aus(0, 61, 5), an(0, 62, 70, 0)];
  const d = leseSmf(smf([spur([...ev, meta(30, 0x7f, 1)])]));
  const n = d.teile[0].noten;
  assert.deepEqual(n.map((x) => [x.tick, x.dauer, x.ton, x.vel]), [[0, 20, 60, 80], [10, 20, 60, 90], [35, 30, 62, 70]]);
  const codes = d.hinweise.map((h) => h.code);
  assert.ok(codes.includes('smf_note_off_ohne_on') && codes.includes('smf_offene_noten'));
});

test('a zero-length note becomes one tick and is reported', () => {
  const d = leseSmf(smf([spur([an(0, 60, 80), aus(0, 60, 0)])]));
  assert.equal(d.teile[0].noten[0].dauer, 1);
  assert.ok(d.hinweise.some((h) => h.code === 'smf_nulldauer'));
});

test('tempo changes are collected sorted; controllers and pitch bend are counted, not read', () => {
  const d = leseSmf(smf([spur([tempoMeta(100), { dt: 10, bytes: [0xb0, 7, 100] }, { dt: 0, bytes: [0xe0, 0, 64] }, tempoMeta(120, 380), ...note(0, 60, 80, 10)])]));
  assert.deepEqual(d.tempi.map((t) => [t.tick, Math.round(t.bpm)]), [[0, 100], [390, 120]]);
  assert.equal(d.ignoriert.controller, 1); assert.equal(d.ignoriert.pitchbend, 1);
});

test('refusals name their cause', () => {
  wirft(() => leseSmf(new Uint8Array([1, 2, 3])), 'smf_kein_smf');
  wirft(() => leseSmf(new Uint8Array(40)), 'smf_kein_smf');
  wirft(() => leseSmf(smf([spur([])], { format: 2 })), 'smf_format2');
  wirft(() => leseSmf(smf([spur([])], { division: 0xe728 })), 'smf_smpte');   // -25 fps, 40 ticks
  wirft(() => leseSmf(smf([spur([])], { division: 0 })), 'smf_beschaedigt');
  wirft(() => leseSmf(smf([])), 'smf_leer');
});

test('a truncated track keeps the notes read so far and says so; a wrong track count is a hint', () => {
  const ganz = spur([...note(0, 60, 80, 48), ...note(0, 62, 80, 48)]);
  const abgeschnitten = ganz.slice(0, ganz.length - 9);   // cut inside the second note
  const d = leseSmf(smf([abgeschnitten], { spurenImKopf: 3 }));
  assert.equal(d.teile[0].noten[0].ton, 60);
  const codes = d.hinweise.map((h) => h.code);
  assert.ok(codes.includes('smf_abgeschnitten'), codes.join());
  assert.ok(codes.includes('smf_spurzahl'), codes.join());
});

test('a data byte above 127 ends that track with a hint, other tracks still read', () => {
  const kaputt = spur([an(0, 60, 80), { dt: 5, bytes: [0x90, 200, 80] }], { ohneEnde: true });
  const d = leseSmf(smf([kaputt, spur([...note(1, 50, 80, 10)])]));
  assert.ok(d.hinweise.some((h) => h.code === 'smf_spur_beschaedigt'));
  assert.equal(d.teile.length, 2);
});

test('track names: UTF-8 and Latin-1, control characters removed', () => {
  const lat = [...Buffer.from('Flöte', 'latin1')];
  const d = leseSmf(smf([
    spur([meta(0, 0x03, ...Buffer.from('Flöte ♪', 'utf8')), ...note(0, 60, 80, 10)]),
    spur([meta(0, 0x03, ...lat, 9, 10), ...note(0, 60, 80, 10)]),
  ]));
  assert.deepEqual(d.spurNamen, ['Flöte ♪', 'Flöte']);
});

test('RIFF RMID wrapper is unwrapped', () => {
  const inner = smf([spur([...note(0, 60, 80, 10)])]);
  const kopf = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('RMID'), ...Buffer.from('data'), inner.length & 255, inner.length >> 8, 0, 0]);
  const d = leseSmf(new Uint8Array([...kopf, ...inner]));
  assert.equal(d.notenZahl, 1);
});
