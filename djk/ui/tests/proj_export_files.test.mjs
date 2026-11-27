// File export of the workbench on the server: POST /proj/export_midi, /proj/export_spuren, /proj/export_zeige (areas/proj/output.ts) against the render stub
// (tests/support/render_mock.mjs, mode MISCHUNG: a track is a sine of 220 Hz times its number). Fixture of aufbau(): s1 Kick (audio), s2 Bass (MIDI, note at 0),
// s3 Lead (MIDI from beat 8). The own TMPDIR keeps this file from the temp-folder counts of the loudness tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { alsAntwort } from '../areas/proj/output.ts';
import { Einsammler } from '../project/einsammeln.ts';
import { baueNachExport } from '../project/exporte.ts';
import { leseSmf } from '../project/smf.ts';
import { aufbau } from './support/output_setup.mjs';

const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const rufe = async (a, methode, d) => {
  try { return { code: 200, body: await mitUmgebung({ RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_PROTOKOLL: path.join(a.tmp, 'render.jsonl'), TMPDIR: a.tmp }, () => a.ausgabe[methode](d)) }; }
  catch (e) { return alsAntwort(e); }
};
const dateien = (ordner) => fs.readdirSync(ordner).sort();

test('export_midi: one folder with the all-parts file and one file per part; the files read back', async (t) => {
  const a = await aufbau(t);
  const r = await rufe(a, 'exportiereMidi', { von_beat: 0, bis_beat: 16 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.match(path.basename(r.body.ordner), /^.+-20261015-181500$/);
  assert.equal(path.dirname(r.body.ordner), path.join(a.offen().ordner, 'export'));
  assert.deepEqual([r.body.von_beat, r.body.bis_beat], [0, 16]);
  assert.deepEqual(r.body.dateien.map((x) => [x.art, x.datei, x.noten]), [['alle', `${a.offen().slug}.mid`, 2], ['spur', '02-bass.mid', 1], ['spur', '03-lead.mid', 1]]);
  assert.deepEqual(dateien(r.body.ordner), ['02-bass.mid', '03-lead.mid', `${a.offen().slug}.mid`].sort());
  const alle = leseSmf(new Uint8Array(fs.readFileSync(path.join(r.body.ordner, r.body.dateien[0].datei))));
  assert.deepEqual(alle.teile.map((x) => x.name), ['Bass', 'Lead']);
  assert.deepEqual(alle.teile[1].noten, [{ tick: 8 * 480, dauer: 480, ton: 60, vel: 90 }]);
  // a second export in the same second gets its own folder, nothing is overwritten
  const r2 = await rufe(a, 'exportiereMidi', {});
  assert.equal(r2.code, 200);
  assert.ok(r2.body.ordner !== r.body.ordner && r2.body.ordner.endsWith('-2'));
  // a range without notes, an unknown field and a bad range are refused
  assert.equal((await rufe(a, 'exportiereMidi', { von_beat: 2, bis_beat: 4 })).body.fehler, 'export_leer');
  assert.equal((await rufe(a, 'exportiereMidi', { x: 1 })).body.fehler, 'argument_ungueltig');
  assert.equal((await rufe(a, 'exportiereMidi', { von_beat: 0, bis_beat: 0.5 })).body.fehler, 'export_bereich');
});

test('export_spuren: mix, one file per track, every fed return wet only; a muted track is listed without a file', async (t) => {
  const a = await aufbau(t);
  await a.aendern([{ befehl: 'return_neu', name: 'Hall Room' }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }]);
  const r = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.dateien.map((x) => [x.art, x.datei, x.stumm]),
    [['mix', 'mix.wav', false], ['spur', '01-kick.wav', false], ['spur', '02-bass.wav', false], ['return', 'fx1-hall-room.wav', false]]);
  assert.deepEqual(dateien(r.body.ordner), ['01-kick.wav', '02-bass.wav', 'fx1-hall-room.wav', 'mix.wav']);
  assert.ok(r.body.dateien.every((x) => Number.isFinite(x.spitze_db) && x.spitze_db > -90));
  assert.equal(r.body.dateien[1].spur_id, 's1'); assert.equal(r.body.dateien[3].return_id, 'r1');
  // nothing stays behind: no playback of the export, no temp folder
  assert.deepEqual(fs.readdirSync(a.tmp).filter((x) => x.startsWith('djk-export-')), []);
  // a muted track: listed, no file; the lock is free again
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', mute: true }]);
  const m = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8 });
  assert.equal(m.code, 200, JSON.stringify(m.body));
  const bass = m.body.dateien.find((x) => x.spur_id === 's2');
  assert.deepEqual([bass.datei, bass.stumm], [null, true]);
  assert.ok(!dateien(m.body.ordner).includes('02-bass.wav'));
  assert.equal(a.ausgabe.zustand().lauf, null);
});

test('export_spuren: a failing render removes the new folder', async (t) => {
  const a = await aufbau(t, { opt: { render: () => [process.execPath, '-e', 'process.exit(3)'] } });
  const r = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8 });
  assert.ok(r.code >= 400, JSON.stringify(r));
  const ex = path.join(a.offen().ordner, 'export');
  assert.deepEqual(fs.existsSync(ex) ? fs.readdirSync(ex) : [], []);
  assert.equal(a.ausgabe.zustand().lauf, null);
});

const sonde = (datei) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,bits_per_raw_sample,bits_per_sample', '-of', 'json', datei]).toString()).streams[0];
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');

test('export_spuren with abgabe flac 24: every file is FLAC, no float file stays, the answer names the new files', async (t) => {
  const a = await aufbau(t);
  await a.aendern([{ befehl: 'return_neu', name: 'Hall Room' }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }]);
  const r = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8, abgabe: { format: 'flac', bits: 24, rate_hz: 44100 } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.dateien.map((x) => x.datei), ['mix.flac', '01-kick.flac', '02-bass.flac', 'fx1-hall-room.flac']);
  assert.deepEqual(r.body.abgabe, { format: 'flac', rate_hz: 44100, bits: 24 });
  assert.deepEqual(dateien(r.body.ordner), ['01-kick.flac', '02-bass.flac', 'fx1-hall-room.flac', 'mix.flac'], 'one format only, no .wav, no .teil');
  const s = sonde(path.join(r.body.ordner, 'mix.flac'));
  assert.deepEqual([s.codec_name, s.sample_rate, s.bits_per_raw_sample], ['flac', '44100', '24']);
  assert.ok(r.body.dateien.every((x) => Number.isFinite(x.spitze_db) && x.spitze_db > -90));
  assert.deepEqual(fs.readdirSync(a.tmp).filter((x) => x.startsWith('djk-export-')), []);
});

test('export_spuren with abgabe wav (even 32 float 48000 is converted): the folder holds the delivery files only, without tags', async (t) => {
  const a = await aufbau(t);
  const r = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8, abgabe: { format: 'wav', bits: 16, rate_hz: 44100 } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.abgabe, { format: 'wav', rate_hz: 44100, bits: 16, dither: 'tpdf' });
  assert.deepEqual(dateien(r.body.ordner), ['01-kick.wav', '02-bass.wav', 'mix.wav']);
  const s = sonde(path.join(r.body.ordner, 'mix.wav'));
  assert.deepEqual([s.codec_name, s.sample_rate], ['pcm_s16le', '44100']);
  const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', path.join(r.body.ordner, 'mix.wav')]).toString());
  assert.deepEqual(Object.keys(tags.format?.tags ?? {}).filter((k) => k !== 'encoder'), [], 'the files of the set carry no tags (ffmpeg\'s own encoder note aside)');
  const f = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8, abgabe: { format: 'wav', bits: 32, rate_hz: 48000 } });
  assert.equal(f.code, 200, JSON.stringify(f.body));
  assert.equal(sonde(path.join(f.body.ordner, 'mix.wav')).codec_name, 'pcm_f32le');
  assert.deepEqual(dateien(f.body.ordner), ['01-kick.wav', '02-bass.wav', 'mix.wav']);
});

test('export_spuren with abgabe: a muted track keeps datei null', async (t) => {
  const a = await aufbau(t);
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', mute: true }]);
  const r = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8, abgabe: { format: 'flac', bits: 16 } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const bass = r.body.dateien.find((x) => x.spur_id === 's2');
  assert.deepEqual([bass.datei, bass.stumm, bass.spitze_db], [null, true, -200]);
  assert.deepEqual(dateien(r.body.ordner), ['01-kick.flac', 'mix.flac']);
});

test('export_spuren refuses mp3, an array and a malformed entry before the render starts', async (t) => {
  const a = await aufbau(t);
  const faelle = [['mp3', 'abgabe[0].format', { format: 'mp3' }], ['an array', 'abgabe[0] must be an object', [{ format: 'wav' }]], ['unknown format', 'abgabe[0].format', { format: 'ogg' }],
    ['a string', 'abgabe[0] must be an object', 'flac'], ['kbps on flac', 'abgabe[0].kbps', { format: 'flac', kbps: 320 }],
    ['dither at 24 bit', 'abgabe[0].dither', { format: 'flac', bits: 24, dither: 'tpdf' }], ['bits 32 on flac', 'abgabe[0].bits', { format: 'flac', bits: 32 }]];
  for (const [was, feld, abgabe] of faelle) {
    const r = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8, abgabe });
    assert.equal(r.code, 400, `${was}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.fehler, 'argument_ungueltig', was);
    assert.equal(r.body.text, 'abgabe: not a valid delivery format', was);
    assert.ok(String(r.body.detail).includes(feld), `${was}: ${r.body.detail}`);
  }
  assert.equal(fs.existsSync(protokollDatei(a)), false, 'the render stand-in was never started');
  assert.equal(fs.existsSync(path.join(a.offen().ordner, 'export')), false, 'nothing was exported');
});

test('export_spuren: a failing conversion removes the new folder and answers render_fehler', async (t) => {
  const a = await aufbau(t, { opt: { ffmpeg: ['/does/not/exist'] } });
  const r = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8, abgabe: { format: 'flac', bits: 24 } });
  assert.equal(r.code >= 400, true, JSON.stringify(r.body));
  assert.equal(r.body.fehler, 'render_fehler');
  assert.ok(r.body.text.startsWith('a file of the set could not be converted; nothing was exported'), r.body.text);
  assert.match(String(r.body.detail), /ffmpeg/);
  const ex = path.join(a.offen().ordner, 'export');
  assert.deepEqual(fs.existsSync(ex) ? fs.readdirSync(ex) : [], [], 'no half set, no .teil');
  assert.deepEqual(fs.readdirSync(a.tmp).filter((x) => x.startsWith('djk-export-')), []);
  assert.equal(a.ausgabe.zustand().lauf, null);
});

test('export_spuren without abgabe: the answer has no abgabe field', async (t) => {
  const a = await aufbau(t);
  const r = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8 });
  assert.equal(r.code, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['bis_beat', 'dateien', 'ordner', 'von_beat']);
});

test('export_zeige: the export folder of the open project or a folder directly inside it; no desktop session is a refusal', async (t) => {
  const a = await aufbau(t);
  const m = await rufe(a, 'exportiereMidi', {});
  const zeige = (d) => { try { return { code: 200, body: a.ausgabe.zeigeExport(d) }; } catch (e) { return alsAntwort(e); } };
  assert.equal(zeige({ ordner: a.tmp }).body.fehler, 'argument_ungueltig', 'a folder outside the export folder');
  const tief = path.join(m.body.ordner, 'tief'); fs.mkdirSync(tief);
  assert.equal(zeige({ ordner: tief }).body.fehler, 'argument_ungueltig', 'nested deeper than one level');
  assert.equal(zeige({ ordner: path.dirname(path.dirname(m.body.ordner)) }).body.fehler, 'argument_ungueltig', 'the project folder above export/');
  assert.equal(zeige({ ordner: path.join(m.body.ordner, m.body.dateien[0].datei) }).body.fehler, 'argument_ungueltig', 'a file, not a folder');
  assert.match(zeige({ ordner: tief }).body.text, /only the export folder of the open project or a folder inside it can be shown/);
  assert.equal(zeige({}).body.fehler, 'argument_ungueltig');
  const alt = { d: process.env.DISPLAY, w: process.env.WAYLAND_DISPLAY };
  delete process.env.DISPLAY; delete process.env.WAYLAND_DISPLAY;
  try {
    assert.equal(zeige({ ordner: m.body.ordner }).body.fehler, 'keine_arbeitsflaeche');
    assert.equal(zeige({ ordner: path.join(m.body.ordner, '..') }).body.fehler, 'keine_arbeitsflaeche', 'the export folder itself passes the check');
  }
  finally { if (alt.d !== undefined) process.env.DISPLAY = alt.d; if (alt.w !== undefined) process.env.WAYLAND_DISPLAY = alt.w; }
});

test('after the fourth export the oldest is in the bin and the sources are collected', async (t) => {
  const quelleOrdner = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-export-quelle-'));
  t.after(() => fs.rmSync(quelleOrdner, { recursive: true, force: true }));
  const quelle = path.join(quelleOrdner, 'Snare Hit.wav');
  fs.writeFileSync(quelle, 'snare-bytes');
  const sha = crypto.createHash('sha256').update('snare-bytes').digest('hex');
  const clip = { id: 'c9', art: 'audio', name: 'c9', start_beat: 0, laenge_beats: 4, quelle: { sha256: sha, pfad_hinweis: quelle }, dekodiert: 'nein',
    offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 };
  const protokoll = [];
  let a;
  const einsammler = new Einsammler({ wechselplatte: () => null, frei: () => true });
  const haken = baueNachExport({ einsammler, offen: () => ({ projekt: { spuren: [{ id: 's1', clips: [clip], takes: [] }] }, ordner: a.offen().ordner }),
    quellPfad: (s, h) => (s === sha ? h : null), log: (z) => protokoll.push(z) });
  a = await aufbau(t, { opt: { nachExport: haken } });
  const ordner = a.offen().ordner, slug = a.offen().slug;
  const namen = [];
  for (let i = 0; i < 4; i++) {
    const r = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4 });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    namen.push(path.basename(r.body.datei));
  }
  await einsammler.leer();
  assert.equal(new Set(namen).size, 4, 'four distinct exports (same second: -2, -3, -4)');
  const bin = path.join(path.dirname(ordner), '.papierkorb', 'exporte', slug);
  assert.deepEqual(dateien(bin), [namen[0]], 'the oldest is in the bin');
  assert.deepEqual(dateien(path.join(ordner, 'export')), namen.slice(1).sort());
  assert.equal(fs.readFileSync(path.join(ordner, 'audio', `snare-hit-${sha.slice(0, 8)}.wav`), 'utf8'), 'snare-bytes', 'the source is collected');
  assert.ok(fs.existsSync(quelle), 'the source stays');
  assert.deepEqual(protokoll, []);
});

test('a throwing nachExport hook is logged and never fails the export', async (t) => {
  const a = await aufbau(t, { opt: { nachExport: () => { throw new Error('boom'); } } });
  const r = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.protokoll.log.some((z) => z.typ === 'nach_export_fehler' && z.fehler === 'boom'));
});

test('the reported export path still exists after the hook, even with the clock set back', async (t) => {
  let nun = new Date(2026, 9, 15, 18, 15, 0);
  const a = await aufbau(t, { opt: { jetzt: () => nun } });
  const haken = baueNachExport({ einsammler: new Einsammler({ wechselplatte: () => null, frei: () => true }), offen: () => null, quellPfad: () => null });
  a.ausgabe.opt.nachExport = haken;
  const dateiNamen = [];
  for (const tag of [20, 21, 22]) { nun = new Date(2026, 9, tag, 10, 0, 0); const r = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4 }); dateiNamen.push(r.body.datei); }
  nun = new Date(2026, 9, 1, 10, 0, 0);                              // the clock was set back: the new export has the oldest stamp
  const r = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(fs.existsSync(r.body.datei), 'the reported file exists');
  assert.equal(dateien(path.join(a.offen().ordner, 'export')).length, 4);
});
