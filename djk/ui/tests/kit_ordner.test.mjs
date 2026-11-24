// Browser plan 5, task 4: a new kit from a folder of sound files. The decoder is injected (files hold raw stereo float32), no ffmpeg.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { klasseAusName, legeKitAusOrdner } from '../sampler/kit_ordner.ts';
import { pruefeKitOrdner } from '../project/kit_storage.ts';
import { tmpOrdner } from './support/kit_build.mjs';

const dekodiere = async (p) => {
  const b = fs.readFileSync(p);
  if (b.length === 0 || b.length % 8) throw new Error('broken');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};
const klang = (ordner, name, { frames = 200, wert = 0.3, tief = false } = {}) => {
  const f = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { const v = tief ? Math.sin(i / 60) * wert : (i % 2 ? wert : -wert); f[2 * i] = v; f[2 * i + 1] = v; }
  fs.writeFileSync(path.join(ordner, name), Buffer.from(f.buffer));
};
const aufbau = (t) => {
  const d = tmpOrdner(t, 'kit-ordner-');
  const quelle = path.join(d, 'quelle'), kits = path.join(d, 'kits');
  fs.mkdirSync(quelle); fs.mkdirSync(kits);
  const o = { kitsOrdner: kits, erlaubt: () => [{ name: 'd', pfad: fs.realpathSync(d) }], dekodiere };
  return { d, quelle, kits, o };
};
const lies = (ordner) => JSON.parse(fs.readFileSync(path.join(ordner, 'kit.json'), 'utf8'));
const bank = (k) => k.name.split(':')[0];

test('file names classify', () => {
  assert.equal(klasseAusName('My_Kick-01.wav'), 'bd');
  assert.equal(klasseAusName('snare2.flac'), 'sd');
  assert.equal(klasseAusName('Clap.wav'), 'cp');
  assert.equal(klasseAusName('closed hat.wav'), 'hh');
  assert.equal(klasseAusName('tom_low.wav'), 'perc');
  assert.equal(klasseAusName('kickstart.wav'), null);
  assert.equal(klasseAusName('zap.wav'), null);
});

test('folder becomes a valid kit with the kick first', async (t) => {
  const { quelle, kits, o } = aufbau(t);
  klang(quelle, 'a_snare.wav'); klang(quelle, 'z_kick.wav'); klang(quelle, 'hat.wav');
  fs.writeFileSync(path.join(quelle, 'notes.txt'), 'x');
  const r = await legeKitAusOrdner({ pfad: quelle, name: 'neu' }, o);
  assert.deepEqual([r.name, r.pads, r.uebrig], ['neu', 3, []]);
  assert.equal((await pruefeKitOrdner(path.join(kits, 'neu'))).ok, true);
  const j = lies(path.join(kits, 'neu'));
  assert.equal(bank(j.klaenge[0]), 'bd');
  assert.deepEqual(j.klaenge.map(bank).sort(), ['bd', 'hh', 'sd']);
});

test('without a kick name the deepest file becomes the kick', async (t) => {
  const { quelle, kits, o } = aufbau(t);
  klang(quelle, 'zap.wav'); klang(quelle, 'boom.wav', { tief: true, frames: 2000 });
  await legeKitAusOrdner({ pfad: quelle, name: 'k' }, o);
  assert.equal(bank(lies(path.join(kits, 'k')).klaenge[0]), 'bd');
});

test('at most 16 pads, the rest is listed; broken and silent files are listed', async (t) => {
  const { quelle, o } = aufbau(t);
  for (let i = 0; i < 18; i++) klang(quelle, `s${String(i).padStart(2, '0')}.wav`);
  klang(quelle, 'a_silent.wav', { wert: 0 });
  fs.writeFileSync(path.join(quelle, 'b_broken.wav'), 'abc');
  const r = await legeKitAusOrdner({ pfad: quelle, name: 'viel' }, o);
  assert.equal(r.pads, 16);
  assert.ok(r.uebrig.includes('a_silent.wav') && r.uebrig.includes('b_broken.wav'));
  assert.equal(r.uebrig.length, 4, '2 failed plus 2 beyond 16');
});

test('refusals: outside roots, empty folder, bad name, existing kit, not a folder', async (t) => {
  const { d, quelle, kits, o } = aufbau(t);
  const aus = tmpOrdner(t, 'kit-aus-');
  klang(aus, 'kick.wav');
  await assert.rejects(legeKitAusOrdner({ pfad: aus, name: 'x' }, o), (e) => e.code === 403 && e.grund === 'pfad_verboten');
  await assert.rejects(legeKitAusOrdner({ pfad: quelle, name: 'x' }, o), (e) => e.code === 400 && e.grund === 'ordner_leer');
  await assert.rejects(legeKitAusOrdner({ pfad: quelle, name: '../x' }, o), (e) => e.grund === 'kit_name_ungueltig');
  await assert.rejects(legeKitAusOrdner({ pfad: 'rel/path', name: 'x' }, o), (e) => e.grund === 'argument_ungueltig');
  await assert.rejects(legeKitAusOrdner({ pfad: path.join(d, 'nix'), name: 'x' }, o), (e) => e.code === 404 && e.grund === 'pfad_fehlt');
  klang(quelle, 'kick.wav');
  await assert.rejects(legeKitAusOrdner({ pfad: path.join(quelle, 'kick.wav'), name: 'x' }, o), (e) => e.grund === 'kein_ordner');
  await legeKitAusOrdner({ pfad: quelle, name: 'x' }, o);
  await assert.rejects(legeKitAusOrdner({ pfad: quelle, name: 'x' }, o), (e) => e.code === 409 && e.grund === 'kit_vorhanden');
  assert.deepEqual(fs.readdirSync(kits), ['x']);
});

test('a link that leaves the roots is not read', async (t) => {
  const { quelle, o } = aufbau(t);
  const aus = tmpOrdner(t, 'kit-aus-');
  klang(aus, 'geheim.wav'); klang(quelle, 'kick.wav');
  fs.symlinkSync(path.join(aus, 'geheim.wav'), path.join(quelle, 'link.wav'));
  const r = await legeKitAusOrdner({ pfad: quelle, name: 'l' }, o);
  assert.deepEqual([r.pads, r.uebrig], [1, ['link.wav']]);
});
