// legeKitAusAudio (sampler/kit.ts): a kit from frame ranges of decoded audio, as `→ SAMPLER INSTRUMENT` of the session view writes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { legeKitAusAudio, ERSTE_NOTE, AUSBLENDE_FRAMES } from '../sampler/kit.ts';

const daten = Float32Array.from({ length: 2 * 4800 }, (_, i) => Math.fround(((i >> 1) % 100) / 200 + 0.1));
const ordner = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kitaudio-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('one sound per range from note 36, the range frames with the end fade, kit.json last, quelle names the origin', (t) => {
  const kits = ordner(t);
  const r = legeKitAusAudio({ name: 'Drums', daten, scheiben: [{ von: 0, bis: 1000 }, { von: 1000, bis: 2500 }, { von: 2500, bis: 4800 }], quelle: 'zelle:abc' }, { kits });
  assert.equal(r.kit, 'drums');
  assert.deepEqual(r.klaenge.map((k) => [k.note, k.datei, k.frames]), [[36, '36.f32', 1000], [37, '37.f32', 1500], [38, '38.f32', 2300]]);
  const j = JSON.parse(fs.readFileSync(path.join(kits, 'drums', 'kit.json'), 'utf8'));
  assert.equal(j.schema, 1);
  assert.deepEqual(j.klaenge.map((k) => k.quelle), ['zelle:abc/1', 'zelle:abc/2', 'zelle:abc/3']);
  const roh = fs.readFileSync(path.join(kits, 'drums', '37.f32'));
  const f = new Float32Array(roh.buffer, roh.byteOffset, roh.length / 4);
  assert.equal(f.length, 3000);
  assert.equal(f[0], daten[2 * 1000]);   // bit for bit up to the fade
  assert.equal(f[2 * (1500 - 1)], 0);    // the last frame is silent
  assert.equal(ERSTE_NOTE, 36);
  assert.equal(AUSBLENDE_FRAMES, 240);
});

test('refusals come before anything is written: empty list, range outside the audio, a sound over 10 s, a taken name', (t) => {
  const kits = ordner(t);
  const gut = { name: 'x', daten, quelle: 'q' };
  assert.throws(() => legeKitAusAudio({ ...gut, scheiben: [] }, { kits }), /non-empty/);
  assert.throws(() => legeKitAusAudio({ ...gut, scheiben: [{ von: 0, bis: 5000 }] }, { kits }), /inside the audio/);
  assert.throws(() => legeKitAusAudio({ ...gut, scheiben: [{ von: 10, bis: 10 }] }, { kits }), /inside the audio/);
  const lang = new Float32Array(2 * 500_000);
  assert.throws(() => legeKitAusAudio({ name: 'x', daten: lang, quelle: 'q', scheiben: [{ von: 0, bis: 500_000 }] }, { kits }), (e) => e.grund === 'klang_zu_lang');
  assert.deepEqual(fs.existsSync(kits) ? fs.readdirSync(kits) : [], []);
  legeKitAusAudio({ ...gut, kit: 'dup', scheiben: [{ von: 0, bis: 1000 }] }, { kits });
  assert.throws(() => legeKitAusAudio({ ...gut, kit: 'dup', scheiben: [{ von: 0, bis: 1000 }] }, { kits }), (e) => e.grund === 'kit_vorhanden');
});
