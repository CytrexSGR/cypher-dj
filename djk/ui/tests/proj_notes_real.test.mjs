// Note editor (slice 1, B8): the server side of the note editor against the REAL cypherdj-noten (no stand-in): detection through the area of
// areas/proj/notes.ts, renders through the service of areas/proj/notes_render.ts, on the real project session of the S3 set-up (in-process, temp folders,
// no server, no core, no sound). The source is a synthetic 6 s stereo voice written as <sha>.f32. The network path is off (netz: null): the run stays on
// the C++ detector. The program is CYPHERDJ_NOTEN or djk/core/build/cypherdj-noten of this checkout (the noten subproject builds into the top-level core
// build folder); a missing program FAILS the tests, it does not skip them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { notenBereich, CURVE_ID } from '../areas/proj/notes.ts';
import { NotenRender } from '../areas/proj/notes_render.ts';
import { AUFTRAG_FORMAT, kurveDatei, kurvePruefung, MASCHINE_VERSION, NOTEN_SR, renderSchluessel } from '../project/notes_contract.ts';

const DJK = path.resolve(import.meta.dirname, '..', '..');
const SHA = 'a'.repeat(64);
const ECHT = process.env.CYPHERDJ_NOTEN || path.join(DJK, 'core', 'build', 'cypherdj-noten');

test('the real program is there', () => {
  assert.ok(fs.existsSync(ECHT), `cypherdj-noten not found at ${ECHT} (set CYPHERDJ_NOTEN or build the core: ninja -C djk/core/build cypherdj-noten)`);
});

// 6 s stereo voice: four clear harmonic notes with silence between them, 20 ms fades
const STIMME = [[0.3, 1.5, 220], [1.8, 3.0, 261.63], [3.3, 4.5, 293.66], [4.8, 5.8, 246.94]];
function stimme() {
  const frames = 6 * NOTEN_SR, x = new Float32Array(frames * 2);
  for (const [a, e, f] of STIMME) {
    for (let i = Math.floor(a * NOTEN_SR); i < Math.floor(e * NOTEN_SR); i++) {
      const t = i / NOTEN_SR, huell = Math.min(1, (t - a) / 0.02, (e - t) / 0.02);
      let s = 0;
      for (let k = 1; k <= 6; k++) s += Math.sin(2 * Math.PI * f * k * t) / k;
      x[2 * i] = x[2 * i + 1] = 0.25 * huell * s;
    }
  }
  return Buffer.from(x.buffer);
}

// the real program behind a logging wrapper: every call is one line of arguments, then the program runs unchanged
async function mitEchtem(t) {
  assert.ok(fs.existsSync(ECHT), `cypherdj-noten not found at ${ECHT}`);
  const z = await aufbau(t);
  const quelle = path.join(z.arbeitsordner, 'audio', `${SHA}.f32`);
  fs.writeFileSync(quelle, stimme());
  const prot = path.join(z.tmp, 'aufrufe.log');
  const huelle = path.join(z.tmp, 'noten-echt.sh');
  fs.writeFileSync(huelle, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${prot}'\nexec '${ECHT}' "$@"\n`, { mode: 0o755 });
  const b = notenBereich(z.ctx, z.zugang, { programm: huelle, netz: null, cwd: z.tmp, killMs: 2000 });
  const nr = new NotenRender(z.ctx, z.zugang, { programm: huelle, netz: null, cwd: z.tmp, killMs: 2000, neuLaden: () => z.s.ladeLiveNeuFrei() });
  z.s.setzeNotenRender(nr);
  z.zugang.beiStand((p) => nr.beiStand(p));
  await nr.start();
  await z.s.ladeLiveNeuFrei();
  t.after(() => { nr.schliesse(); b.analyse.schliesse(); });
  const clip = () => z.projekt().spuren[0].clips.find((c) => c.id === 'c1');
  const notenOrdner = path.join(z.arbeitsordner, 'noten');
  const stand = () => z.s.aktuell().j.noten;
  const erkenne = async () => {
    const a = b.analyse.starte({ clip_id: 'c1' }, 'andreas');
    assert.equal(a.code, 200, JSON.stringify(a.j));
    assert.ok(await warteBis(() => stand() && stand().auftrag_id === a.j.auftrag_id && stand().zustand !== 'laeuft', 60000), JSON.stringify(stand()));
    return stand();
  };
  const ton = (ids, um) => z.aendern([{ befehl: 'audio_noten_aendern', clip_id: 'c1', ids, ton_um: um }], 'Edit');
  const schluessel = () => { const c = clip(); return renderSchluessel(SHA, c.audio_noten.kurve, MASCHINE_VERSION, c.audio_noten.liste); };
  const aufrufe = () => (fs.existsSync(prot) ? fs.readFileSync(prot, 'utf8').trim().split('\n') : []);
  const floats = (f) => { const bu = fs.readFileSync(f); return new Float32Array(bu.buffer, bu.byteOffset, bu.length / 4); };
  return { ...z, b, nr, clip, notenOrdner, quelle, stand, erkenne, ton, schluessel, aufrufe, floats, renderDatei: (k) => path.join(notenOrdner, `${k}.f32`) };
}

test('real cypherdj-noten: detect -> at least 3 notes placed, mono false; the sidecar validates with kurvePruefung', async (t) => {
  const z = await mitEchtem(t);
  const e = await z.erkenne();
  assert.equal(e.zustand, 'fertig', JSON.stringify(e));
  assert.ok(e.noten >= 3, `notes found: ${e.noten}`);
  assert.equal(e.detektor, 'pyin');
  const c = z.clip();
  assert.equal(c.audio_noten.kurve, CURVE_ID);
  assert.equal(c.audio_noten.liste.length, e.noten);
  assert.ok(c.audio_noten.liste.every((n) => /^t\d+$/.test(n.id) && n.ton === undefined), 'detected values only, no target');
  const datei = path.join(z.notenOrdner, kurveDatei(SHA, CURVE_ID));
  const kurve = JSON.parse(fs.readFileSync(datei, 'utf8'));
  assert.equal(kurvePruefung(kurve), null, JSON.stringify(kurvePruefung(kurve)));
  assert.equal(kurve.mono.mehrstimmig, false);
  assert.equal(kurve.quelle, SHA);
  assert.deepEqual(z.aufrufe().map((l) => l.split(' ')[0]).filter((x) => x !== 'version'), ['analyse', 'pruefe']);
});

test('real render: one note +2 -> the render file has the source length and is bit-identical outside the note +-20 ms', async (t) => {
  const z = await mitEchtem(t);
  assert.equal((await z.erkenne()).zustand, 'fertig');
  const ziel = z.clip().audio_noten.liste[1];
  await z.ton([ziel.id], 2);
  assert.ok(await z.nr.bereit(60000), JSON.stringify(z.nr.zustand('c1')));
  assert.equal(z.nr.zustand('c1').zustand, 'bereit');
  const datei = z.renderDatei(z.schluessel());
  assert.ok(fs.existsSync(datei));
  const r = z.floats(datei), q = z.floats(z.quelle);
  assert.equal(r.length, q.length, 'the length of the source');
  const rand = 0.02 * NOTEN_SR;
  const von = Math.floor(ziel.qa * NOTEN_SR - rand) * 2, bis = Math.ceil(ziel.qe * NOTEN_SR + rand) * 2;
  let draussen = 0, innen = 0;
  for (let i = 0; i < r.length; i++) {
    if (i >= von && i < bis) { if (r[i] !== q[i]) innen++; } else if (r[i] !== q[i]) draussen++;
  }
  assert.equal(draussen, 0, 'every sample outside the note +-20 ms is the source');
  assert.ok(innen > 0, 'the note itself changed');
});

test('real incremental render: the second edit passes --vorher and the file equals a full render of the same list', async (t) => {
  const z = await mitEchtem(t);
  assert.equal((await z.erkenne()).zustand, 'fertig');
  const ids = z.clip().audio_noten.liste.map((n) => n.id);
  await z.ton([ids[0]], 2);
  assert.ok(await z.nr.bereit(60000));
  const renders = () => z.aufrufe().filter((l) => l.startsWith('render '));
  assert.equal(renders().length, 1);
  assert.ok(!renders()[0].includes('--vorher'), 'the first render is a full one');
  await z.ton([ids[2]], -3);
  assert.ok(await z.nr.bereit(60000));
  assert.equal(renders().length, 2);
  assert.ok(renders()[1].includes('--vorher') && renders()[1].includes(`--nur ${ids[2]}`), renders()[1]);
  const key = z.schluessel();
  const inkrementell = fs.readFileSync(z.renderDatei(key));
  // the same list rendered in full by the program itself
  const auftrag = path.join(z.tmp, 'voll-auftrag.json'), aus = path.join(z.tmp, 'voll.f32');
  fs.writeFileSync(auftrag, `${JSON.stringify({ format: AUFTRAG_FORMAT, kurve: CURVE_ID, liste: z.clip().audio_noten.liste })}\n`);
  const p = spawnSync(ECHT, ['render', z.quelle, path.join(z.notenOrdner, kurveDatei(SHA, CURVE_ID)), auftrag, aus], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(inkrementell.equals(fs.readFileSync(aus)), 'incremental equals full');
});
