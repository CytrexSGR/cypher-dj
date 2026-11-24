// The view of the files of the open project (browser plan 2, task 1): pure builder over a project and a folder listing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dateienSicht } from '../areas/proj/files_view.ts';
import { specProjekt, tmpOrdner, SHA_A, SHA_B } from './support/project.mjs';

const KEYS = ['audio', 'midi', 'takes', 'exporte', 'stems', 'bounces', 'resamples', 'instrumente', 'kits', 'presets', 'fehlend'];
const clip = (id, sha, name = 'k') => ({ id, art: 'audio', name, start_beat: 0, laenge_beats: 1, quelle: { sha256: sha, pfad_hinweis: `/abs/${name}.wav` },
  dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
const sicht = (p, ordner, extra = {}) => dateienSicht({ projekt: p, ordner, gerettet: [], quellPfad: (sha) => (sha === SHA_B ? null : `/abs/${sha[0]}.wav`), katalogName: () => null, ...extra });

test('an empty project gives every list empty and all eleven keys', (t) => {
  const p = specProjekt(); p.spuren = [];
  const s = sicht(p, tmpOrdner(t));
  assert.deepEqual(Object.keys(s).sort(), [...KEYS].sort());
  for (const k of KEYS) assert.deepEqual(s[k], [], k);
});

test('audio merges clips by sha, take lanes count, a missing source is flagged', (t) => {
  const p = specProjekt();
  p.spuren[0].clips = [clip('c1', SHA_A, 'kick'), clip('c9', SHA_A, 'kick'), clip('c3', SHA_B, 'snare')];
  p.spuren[0].takes = [{ id: 't1', name: 'T1', clips: [clip('c4', SHA_A, 'kick')] }];
  const s = sicht(p, tmpOrdner(t));
  assert.equal(s.audio.length, 2);
  assert.deepEqual([s.audio[0].sha256, s.audio[0].clips, s.audio[0].fehlt], [SHA_A, 3, false]);
  assert.deepEqual([s.audio[1].sha256, s.audio[1].clips, s.audio[1].fehlt], [SHA_B, 1, true]);
  assert.equal(s.audio[1].pfad, '/abs/snare.wav', 'the hint when the resolver finds nothing');
  assert.deepEqual(s.fehlend, [SHA_B]);
});

test('name: catalogue name first; a loop deck cell is a source too', (t) => {
  const p = specProjekt();
  p.spuren[0].clips = [clip('c1', SHA_A, 'kick')];
  p.spuren[1].zellen = [{ id: 'z1', name: 'Loop', farbe: 0, art: 'loop', sha256: 'c'.repeat(64), gain_db: 0, pfad_hinweis: 'audio/loop-cccccccc.wav' }];
  const s = sicht(p, tmpOrdner(t), { katalogName: (sha) => (sha === SHA_A ? 'Kick Drum 01' : null), quellPfad: () => '/x/y.wav' });
  assert.equal(s.audio[0].name, 'Kick Drum 01');
  assert.equal(s.audio[1].name, 'Loop');
  assert.equal(s.audio[1].clips, 1);
});

test('midi clips, instruments, kits and presets', (t) => {
  const p = specProjekt();
  p.spuren[1].geraet = { art: 'intern', name: 'rb338', parameter: {}, preset: 'werk:rb338/acid' };
  p.spuren[2].geraet = { art: 'intern', name: 'kit', kit: 'Boom' };
  p.spuren.push({ id: 's4', nr: 4, name: 'BK', farbe: '#fff', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'pad1', parameter: {}, preset: 'nutzer:bk/p' },
    fader_db: 0, pan: 0, mute: false, solo: false, clips: [], inserts: [{ id: 'i1', art: 'komp', slot: 0, an: true, werte: {}, preset: 'werk:komp/glue' }] });
  const s = sicht(p, tmpOrdner(t));
  assert.deepEqual(s.midi, [{ clip_id: 'c2', spur_id: 's2', name: 'bassline' }]);
  assert.deepEqual(s.instrumente, [{ spur_id: 's2', spur_name: 'Bass', geraet: 'rb338' }, { spur_id: 's3', spur_name: 'Lead', geraet: 'kit:Boom' },
    { spur_id: 's4', spur_name: 'BK', geraet: 'bk:pad1' }]);
  assert.deepEqual(s.kits, ['Boom']);
  assert.deepEqual(s.presets, ['werk:rb338/acid', 'nutzer:bk/p', 'werk:komp/glue']);
});

test('takes: files of aufnahmen/ with their track, recovered ones once and flagged, dot files skipped', (t) => {
  const d = tmpOrdner(t), p = specProjekt();
  fs.mkdirSync(path.join(d, 'aufnahmen'));
  for (const n of ['take-7-2.wav', 'take-7-2-gerettet.wav', '.laufend-x.json', '.gerettet-7-2.json', 'notiz.txt']) fs.writeFileSync(path.join(d, 'aufnahmen', n), 'x');
  const s = sicht(p, d, { gerettet: [{ datei: 'take-7-2-gerettet.wav', spur_id: 'S2', gerettet: true }] });
  assert.deepEqual(s.takes, [{ datei: 'take-7-2.wav', spur_id: 's2', gerettet: false }, { datei: 'take-7-2-gerettet.wav', spur_id: 'S2', gerettet: true }]);
});

test('export, stems, bounce, resample: top-level entries, dot entries skipped, newest first', (t) => {
  const d = tmpOrdner(t), p = specProjekt();
  fs.mkdirSync(path.join(d, 'export', 'abc'), { recursive: true });
  fs.writeFileSync(path.join(d, 'export', '.hidden'), 'x');
  fs.writeFileSync(path.join(d, 'export', 'alt.wav'), 'x');
  fs.utimesSync(path.join(d, 'export', 'alt.wav'), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
  fs.utimesSync(path.join(d, 'export', 'abc'), new Date('2026-02-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
  for (const [o, n] of [['stems', 's.wav'], ['bounce', 'b.wav'], ['resample', 'r.wav']]) { fs.mkdirSync(path.join(d, o)); fs.writeFileSync(path.join(d, o, n), 'x'); }
  const s = sicht(p, d);
  assert.deepEqual(s.exporte.map((x) => x.datei), ['abc', 'alt.wav']);
  assert.equal(s.exporte[0].zeit, '2026-02-01T00:00:00.000Z');
  assert.deepEqual([s.stems, s.bounces, s.resamples].map((l) => l.map((x) => x.datei)), [['s.wav'], ['b.wav'], ['r.wav']]);
});

test('a project folder that does not exist is fine', (t) => {
  assert.doesNotThrow(() => sicht(specProjekt(), path.join(tmpOrdner(t), 'gibt-es-nicht')));
});
