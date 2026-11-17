// Sampler source of the art `katalog` (media browser slice 1, task 2): the audio of a catalog file loads through Ordner.katalogPfad.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ladeQuellAudio, SchnittFehler, legeSchnitt, listeSchnitte } from '../sampler/schnitt.ts';
import { sinusWav } from './support/sinus_wav.mjs';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-katq-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const SHA = 'a'.repeat(64);

test('ladeQuellAudio: art katalog loads through o.katalogPfad', (t) => {
  const d = tmp(t);
  const wav = path.join(d, 'Sine.wav');
  sinusWav(wav, { hz: 220, sekunden: 1, rate: 44100, kanaele: 1 });
  const q = ladeQuellAudio({ art: 'katalog', ref: SHA }, { katalogPfad: (sha) => (sha === SHA ? wav : null) });
  assert.ok(q.frames > 0);
  assert.equal(q.name, 'Sine');
});

test('ladeQuellAudio: without katalogPfad or with null it is 404 quelle_unbekannt', (t) => {
  const e = (f) => assert.throws(f, (x) => x instanceof SchnittFehler && x.code === 404 && x.grund === 'quelle_unbekannt');
  e(() => ladeQuellAudio({ art: 'katalog', ref: SHA }, {}));
  e(() => ladeQuellAudio({ art: 'katalog', ref: SHA }, { katalogPfad: () => null }));
  e(() => ladeQuellAudio({ art: 'katalog', ref: SHA }, { katalogPfad: () => path.join(os.tmpdir(), 'gibt-es-nicht.wav') }));
});

test('legeSchnitt: a katalog source is refused without katalogPfad (POST /sampler/schnitt), made with it', (t) => {
  const d = tmp(t);
  const wav = path.join(d, 'Sine.wav');
  sinusWav(wav, { hz: 220, sekunden: 1, rate: 44100, kanaele: 1 });
  const o = { ordner: path.join(d, 'store'), bk: path.join(d, 'bk') };
  assert.throws(() => legeSchnitt({ quelle: { art: 'katalog', ref: SHA }, methode: 'ganz' }, o), (x) => x.code === 400 && x.grund === 'argument_ungueltig');
  assert.deepEqual(listeSchnitte(o), []);
  const s = legeSchnitt({ quelle: { art: 'katalog', ref: SHA }, methode: 'ganz' }, { ...o, katalogPfad: () => wav });
  assert.deepEqual(s.quelle, { art: 'katalog', ref: SHA });
});
