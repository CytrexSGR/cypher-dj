// File export of the workbench on the server: POST /proj/export_midi, /proj/export_spuren, /proj/export_zeige (areas/proj/output.ts) against the render stub
// (tests/support/render_mock.mjs, mode MISCHUNG: a track is a sine of 220 Hz times its number). Fixture of aufbau(): s1 Kick (audio), s2 Bass (MIDI, note at 0),
// s3 Lead (MIDI from beat 8). The own TMPDIR keeps this file from the temp-folder counts of the loudness tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { alsAntwort } from '../areas/proj/output.ts';
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

test('export_zeige: only a folder directly inside export/ of the open project; no desktop session is a refusal', async (t) => {
  const a = await aufbau(t);
  const m = await rufe(a, 'exportiereMidi', {});
  const zeige = (d) => { try { return { code: 200, body: a.ausgabe.zeigeExport(d) }; } catch (e) { return alsAntwort(e); } };
  assert.equal(zeige({ ordner: a.tmp }).body.fehler, 'argument_ungueltig', 'a folder outside the export folder');
  assert.equal(zeige({ ordner: path.join(m.body.ordner, '..') }).body.fehler, 'argument_ungueltig', 'the export folder itself');
  assert.equal(zeige({}).body.fehler, 'argument_ungueltig');
  const alt = { d: process.env.DISPLAY, w: process.env.WAYLAND_DISPLAY };
  delete process.env.DISPLAY; delete process.env.WAYLAND_DISPLAY;
  try { assert.equal(zeige({ ordner: m.body.ordner }).body.fehler, 'keine_arbeitsflaeche'); }
  finally { if (alt.d !== undefined) process.env.DISPLAY = alt.d; if (alt.w !== undefined) process.env.WAYLAND_DISPLAY = alt.w; }
});
