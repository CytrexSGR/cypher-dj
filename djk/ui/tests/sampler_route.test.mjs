// Sampler A1 task 4: the routes /sampler/* of the page server and the waveform of a cut (GET /welle?schnitt=). Server with the kern stand-in (stack of
// support/media_library.mjs); the cut store, the graph folder, the loop library and the module store are temp folders, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schreibeWavAusF32 } from '../project/recording.ts';
import { stapel } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { bis, ruf, warte, anKern, CYPHER } from './support/proj_stack.mjs';
import { samplerBereich } from '../areas/sampler/area.ts';
import { fitWert, speedVon } from '../sampler/device.ts';

const DEMOS = path.resolve(import.meta.dirname, '../../instruments/modular_dsp/demos');
const MOD = '0123456789abcdef', MOD2 = 'fedcba9876543210';

// a loop of `beats` beats, frame i = (i, -i)
function schreibeLoop(loops, name, beats) {
  const frames = beats * 22500, f = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { f[2 * i] = i; f[2 * i + 1] = -i; }
  fs.mkdirSync(path.join(loops, name));
  fs.writeFileSync(path.join(loops, name, 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(loops, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}
// a module with one WAV per track; `spuren` = {track name: frames}
function schreibeModul(root, module, id, { herkunft, spuren }) {
  const ordner = path.join(module, id, 'audio');
  fs.mkdirSync(ordner, { recursive: true });
  const liste = [];
  let n = 0;
  for (const [name, frames] of Object.entries(spuren)) {
    const sha = String(n++).repeat(64).slice(0, 64);
    const f = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) { f[2 * i] = i + n; f[2 * i + 1] = -i; }
    const tmp = path.join(root, `roh-${sha}.f32`);
    fs.writeFileSync(tmp, Buffer.from(f.buffer));
    schreibeWavAusF32(tmp, path.join(ordner, `${sha}.wav`));
    liste.push({ name, clips: [{ id: `c${n}`, art: 'audio', quelle: { sha256: sha, pfad_hinweis: `audio/${sha}.wav` } }] });
  }
  fs.writeFileSync(path.join(module, id, 'modul.json'), JSON.stringify({ format: 1, id, gespeichert: '2026-11-16T10:00:00Z', herkunft, gruppen: [{ id: 'g1', name: 'Mod' }], spuren: liste, audio: [] }));
}

// Sampler A2: noise bursts (decaying noise, 40 ms) make a break with hits; `still` is silence. Written into the library of a running test (read at each request).
function burstDaten(beats, bursts) {
  const frames = beats * 22500, f = new Float32Array(frames * 2);
  let z = 12345;
  const rausch = () => { z = (Math.imul(z, 1664525) + 1013904223) >>> 0; return z / 2 ** 31 - 1; };
  for (const [start, amp] of bursts) {
    for (let t = 0; t < 1920 && start + t < frames; t++) { const v = rausch() * amp * Math.exp(-t / 96); f[2 * (start + t)] += v; f[2 * (start + t) + 1] += v; }
  }
  return f;
}
function schreibeDaten(loops, name, beats, daten) {
  fs.mkdirSync(path.join(loops, name));
  fs.writeFileSync(path.join(loops, name, 'loop.f32'), Buffer.from(daten.buffer));
  fs.writeFileSync(path.join(loops, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames: beats * 22500, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}
const BRUCH = [[0, 0.8], [11000, 0.05], [22500, 0.8], [30100, 0.4], [45000, 0.8], [61000, 0.2], [75500, 0.8]];
const mitBruch = (z) => {
  schreibeDaten(z.d.loops, 'bruch', 4, burstDaten(4, BRUCH));
  schreibeDaten(z.d.loops, 'still', 4, new Float32Array(90000 * 2));
};

async function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-t4-'));
  const d = { root, loops: path.join(root, 'loops'), module: path.join(root, 'module'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  fs.copyFileSync(path.join(DEMOS, 'drums-909.json'), path.join(d.bk, 'drums-909.json'));
  const alt = { bk: process.env.CYPHERDJ_BK_ORDNER, sampler: process.env.CYPHERDJ_SAMPLER };
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  process.env.CYPHERDJ_SAMPLER = d.sampler;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', alt.bk], ['CYPHERDJ_SAMPLER', alt.sampler]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  schreibeLoop(d.loops, 'l4', 4);
  schreibeLoop(d.loops, 'l8', 8);
  schreibeModul(root, d.module, MOD2, { herkunft: { bpm: 300, laenge_beats: 4, titel: 'Fast' }, spuren: { Loop: 38400 } });   // 4 beats in 38 400 frames: 300 BPM
  schreibeModul(root, d.module, MOD, { herkunft: { bpm: 127, laenge_beats: 4, titel: 'Song' }, spuren: { Loop: 90000, 'Drums original': 90000 } });
  const s = await stapel(t, { loops: d.loops });
  s.optionen.modulOrdner = d.module;      // read at each request
  s.optionen.samplerOrdner = d.sampler;
  const bkDateien = () => fs.readdirSync(d.bk).filter((n) => n.startsWith('smp-'));
  const oeffne = async (name = 'Mod', tempo) => {
    const r = await ruf(s.url, 'POST', '/proj/neu', { name, werkbank: true });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    if (tempo !== undefined) {
      const a = await ruf(s.url, 'POST', '/proj/aendern', { rev: r.j.projekt.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: tempo }] });
      assert.equal(a.code, 200, JSON.stringify(a.j));
    }
  };
  const projekt = async () => (await ruf(s.url, 'GET', '/proj/aktuell')).j.projekt;
  return { ...s, d, bkDateien, oeffne, projekt };
}
const liste = async (z) => (await ruf(z.url, 'GET', '/sampler/liste')).j.schnitte;

test('the routes of the Bereich', () => {
  const b = samplerBereich({ log() {}, quelle: () => 'andreas', kiGestoppt: () => false }, { sitzung: {}, zugang: {}, loops: '', module: '' });
  assert.equal(b.name, 'sampler');
  assert.deepEqual(b.routen().map((r) => `${r.methode} ${r.pfad}`),
    ['GET /sampler/quellen', 'GET /sampler/liste', 'GET /sampler/schnitt', 'POST /sampler/schnitt', 'POST /sampler/spur', 'POST /sampler/fit', 'POST /sampler/loeschen', 'POST /sampler/hoeren',
      'POST /sampler/neu_schneiden', 'POST /sampler/marke', 'POST /sampler/ursprung',
      'POST /sampler/ton', 'GET /sampler/ton', 'POST /sampler/ton/grund', 'POST /sampler/ton/loeschen',
      'GET /sampler/dateien', 'GET /sampler/datei/hoer', 'POST /sampler/datei/spur', 'POST /sampler/datei/pad',
      'POST /sampler/instrument', 'GET /sampler/instrument/lauf', 'GET /sampler/instrumente', 'POST /sampler/instrument/spur', 'POST /sampler/instrument/loeschen']);   // A2 (three), plan C (four), sample player (three), instruments (five), media browser (datei/hoer, datei/spur, datei/pad)
  assert.deepEqual(b.routen().filter((r) => r.methode === 'POST').map((r) => r.schutz), Array(16).fill('fremdePost'));
});

test('quellen lists loops and module audio; a cut from a module takes its tempo from the frames (review focus 2)', async (t) => {
  const z = await aufbau(t);
  fs.mkdirSync(path.join(z.d.loops, 'kaputt'));
  fs.writeFileSync(path.join(z.d.loops, 'kaputt', 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats: 4, frames: 90000, datei: 'loop.f32' }));   // loop.f32 missing: not loadable
  const r = await ruf(z.url, 'GET', '/sampler/quellen');
  assert.equal(r.code, 200);
  const q = r.j;
  assert.deepEqual(q.loops, [{ name: 'l4', beats: 4 }, { name: 'l8', beats: 8 }]);
  assert.deepEqual(q.module.map((m) => m.id).sort(), [MOD, MOD2].sort());
  const m = q.module.find((x) => x.id === MOD);
  assert.deepEqual([m.titel, m.beats, m.bpm], ['Song', 4, 127]);
  assert.deepEqual(m.audio.map((a) => a.stem), [null, 'drums']);
  assert.deepEqual(m.audio.map((a) => a.name), ['Loop', 'Drums original']);
  const p = await ruf(z.url, 'POST', '/sampler/schnitt', { quelle: { art: 'modul', ref: MOD, stem: 'drums' } });
  assert.equal(p.code, 200, JSON.stringify(p.j));
  assert.equal(p.j.schnitt.bpm, 128, 'herkunft.bpm says 127, the 90 000 frames say 128');
  assert.deepEqual([p.j.schnitt.beats, p.j.schnitt.grenzen.length, p.j.schnitt.quelle], [4, 17, { art: 'modul', ref: MOD, stem: 'drums' }]);
  const l = await liste(z);
  assert.deepEqual(l.map((x) => [x.id, x.name, x.bpm, x.beats, x.scheiben, x.geraet]), [[p.j.schnitt.id, 'Song · Drums', 128, 4, 16, `smp-${p.j.schnitt.id}`]]);
  assert.deepEqual(l[0].quelle, { art: 'modul', ref: MOD, stem: 'drums' });
});

test('a cut: the method gets the unknown keys as options; refusals carry fehler and text and write nothing', async (t) => {
  const z = await aufbau(t);
  const a = await ruf(z.url, 'POST', '/sampler/schnitt', { quelle: { art: 'loop', ref: 'l4' }, name: 'Mine', scheiben: 8 });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual([a.j.schnitt.name, a.j.schnitt.grenzen.length, a.j.schnitt.methode], ['Mine', 9, 'raster']);
  const vorher = z.bkDateien();
  for (const [koerper, code, fehler] of [
    [{ quelle: { art: 'loop', ref: 'nix' } }, 404, 'quelle_unbekannt'],
    [{ quelle: { art: 'loop', ref: 'l4' }, scheiben: 7 }, 400, 'argument_ungueltig'],
    [{ quelle: { art: 'loop', ref: 'l4' }, methode: 'nix' }, 400, 'methode_unbekannt'],
    [{ quelle: { art: 'loop', ref: 'l4' }, methode: 'anschlag', empfindlichkeit: 2 }, 400, 'argument_ungueltig'],
    [{ quelle: { art: 'datei', ref: '/x.wav' } }, 404, 'quelle_unbekannt'],
    [{}, 400, 'argument_ungueltig'],
  ]) {
    const r = await ruf(z.url, 'POST', '/sampler/schnitt', koerper);
    assert.deepEqual([r.code, r.j.fehler], [code, fehler], JSON.stringify(koerper));
    assert.ok(typeof r.j.text === 'string' && r.j.text.length > 5, 'an English text');
  }
  assert.deepEqual(z.bkDateien(), vorher);
  assert.equal((await liste(z)).length, 1);
});

test('SLICE TO TRACK writes one history step with the original order and FIT', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 130);
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l4' } });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const p = await z.projekt();
  const spur = p.spuren.find((s) => s.id === r.j.spur_id);
  assert.ok(spur, 'the track exists');
  assert.equal(r.j.schnitt_id, (await liste(z))[0].id);
  assert.deepEqual([spur.name, spur.geraet.graph], ['l4', `smp-${r.j.schnitt_id}`]);
  const noten = spur.clips[0].noten;
  assert.deepEqual([noten.length, noten.map((n) => n.ton)], [16, Array.from({ length: 16 }, (_, i) => i)]);
  assert.deepEqual([noten[0].beat, noten[1].beat, noten[1].laenge, noten[0].vel], [0, 0.25, 0.25, 100]);
  assert.equal(spur.geraet.parameter.k2, fitWert(130, 128));
  assert.equal(r.j.fit, fitWert(130, 128));
  assert.equal(r.j.rev, p.rev);
  assert.equal(r.j.projekt.rev, p.rev);
  const v = (await ruf(z.url, 'GET', '/proj/verlauf')).j;
  assert.equal(v.filter((e) => e.label === 'Slice l4').length, 1, 'one history step');
  // a second cut of the same loop: the track name is taken, " 2"
  const r2 = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l4' } });
  assert.equal(r2.code, 200, JSON.stringify(r2.j));
  assert.equal((await z.projekt()).spuren.find((s) => s.id === r2.j.spur_id).name, 'l4 2');
  // the track of an existing cut by id: no new cut
  const n = (await liste(z)).length;
  const r3 = await ruf(z.url, 'POST', '/sampler/spur', { id: r.j.schnitt_id, name: 'Again' });
  assert.equal(r3.code, 400, 'name next to id is refused');
  const r4 = await ruf(z.url, 'POST', '/sampler/spur', { id: r.j.schnitt_id });
  assert.equal(r4.code, 200, JSON.stringify(r4.j));
  assert.equal((await z.projekt()).spuren.find((s) => s.id === r4.j.spur_id).name, 'l4 3');
  assert.equal((await liste(z)).length, n);
});

test('SLICE TO TRACK refusals create nothing (review focus 3)', async (t) => {
  const z = await aufbau(t);
  const gleich = async (f) => {
    const vorher = [z.bkDateien(), fs.readdirSync(z.d.sampler)];
    const l0 = JSON.stringify(await liste(z));
    const r = await f();
    assert.deepEqual([z.bkDateien(), fs.readdirSync(z.d.sampler)], vorher, 'no file left');
    assert.equal(JSON.stringify(await liste(z)), l0, 'the list is unchanged');
    return r;
  };
  const quelle = { quelle: { art: 'loop', ref: 'l4' } };
  let r = await gleich(() => ruf(z.url, 'POST', '/sampler/spur', quelle));
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_projekt']);
  await ruf(z.url, 'POST', '/proj/neu', { name: 'Plain' });
  r = await gleich(() => ruf(z.url, 'POST', '/sampler/spur', quelle));
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_werkbank']);
  await z.oeffne('Full');
  const rev0 = (await z.projekt()).rev;
  const befehle = Array.from({ length: 8 }, (_, i) => ({ befehl: 'werkbank_spur_neu', name: `T${i}`, geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} } }));
  const f = await ruf(z.url, 'POST', '/proj/aendern', { rev: rev0, label: 'Fill', befehle });
  assert.equal(f.code, 200, JSON.stringify(f.j));
  const projektVor = JSON.stringify(await z.projekt());
  r = await gleich(() => ruf(z.url, 'POST', '/sampler/spur', quelle));
  assert.deepEqual([r.code, r.j.fehler], [409, 'werkbank_voll']);
  assert.equal(JSON.stringify(await z.projekt()), projektVor, 'the project is unchanged');
  // a refused source leaves nothing either (a fresh module, so that the source is what is refused)
  await z.oeffne('Fresh');
  r = await gleich(() => ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'nix' } }));
  assert.deepEqual([r.code, r.j.fehler], [404, 'quelle_unbekannt']);
});

test('a project write that is refused removes the cut this call created', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod');
  // a track called like the cut is refused by the command only when the names collide; force a refusal through the open project instead: close the
  // module's workbench flag is not possible, so the project write is refused by a deck that is playing? Use the rev race: the session answers
  // rev_veraltet when the project changes between the read and the write.
  const o = z.o;
  const sitz = innen(o).proj?.sitzung ?? o.proj.sitzung;
  const echt = sitz.aendern.bind(sitz);
  sitz.aendern = async (d, q, e) => { sitz.aendern = echt; return { code: 409, j: { fehler: 'rev_veraltet', text: 'the project changed meanwhile' } }; };
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l4' } });
  assert.deepEqual([r.code, r.j.fehler], [409, 'rev_veraltet']);
  assert.deepEqual(z.bkDateien(), [], 'graph and panel are gone');
  assert.deepEqual(fs.readdirSync(z.d.sampler), [], 'the cut folder is gone');
  assert.deepEqual(fs.readdirSync(path.join(z.d.bk, 'samples')), [], 'the audio is gone');
  assert.deepEqual(await liste(z), []);
  // and thrown refusals too
  sitz.aendern = async () => { sitz.aendern = echt; throw Object.assign(new Error('x'), { code: 409, fehler: 'verlauf_inkonsistent', extra: {} }); };
  const r2 = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l4' } });
  assert.notEqual(r2.code, 200);
  assert.deepEqual(await liste(z), []);
  assert.deepEqual(z.bkDateien(), []);
});

test('FIT out of range and on a foreign track', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 60);                                           // 60 / 300 = 0.2, below 0.25 (the module cut plays at 300 BPM)
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'modul', ref: MOD2 } });
  assert.equal(r.code, 200, 'the track is created anyway');
  assert.equal(r.j.fit, null);
  const spur = (await z.projekt()).spuren.find((s) => s.id === r.j.spur_id);
  assert.equal(spur.geraet.parameter.k2, undefined, 'SPEED stays at its default');
  const rev = (await z.projekt()).rev;
  const f = await ruf(z.url, 'POST', '/sampler/fit', { spur_id: r.j.spur_id });
  assert.deepEqual([f.code, f.j.fehler], [409, 'fit_ausserhalb']);
  assert.ok(f.j.text.length > 5);
  assert.equal((await z.projekt()).rev, rev, 'the knob is unchanged, no history step');
  // a drums track
  const a = await ruf(z.url, 'POST', '/proj/aendern', { rev, label: 'Drums', befehle: [{ befehl: 'werkbank_spur_neu', name: 'Drums', geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} } }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const drums = a.j.projekt.spuren.find((s) => s.name === 'Drums');
  const k = await ruf(z.url, 'POST', '/sampler/fit', { spur_id: drums.id });
  assert.deepEqual([k.code, k.j.fehler], [409, 'kein_schnitt_geraet']);
  assert.equal((await ruf(z.url, 'POST', '/sampler/fit', { spur_id: 'nix' })).code, 404);
  assert.equal((await ruf(z.url, 'POST', '/sampler/fit', {})).code, 400);
  // the tempo comes into range: FIT sets k2 in one step "Fit <track>"
  const t2 = await ruf(z.url, 'POST', '/proj/aendern', { rev: a.j.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 120 }] });
  assert.equal(t2.code, 200, JSON.stringify(t2.j));
  // The kern stand-in has no row spur/<slot>/bk/<k> (the live value of a knob), so a real write of k2 is refused there with regler_abgelehnt; the command
  // itself is covered by project_commands_device_param.test.mjs. Here the session is a recorder: the route must send exactly one step.
  const sitz = z.o.proj.sitzung, echt = sitz.aendern.bind(sitz), gesehen = [];
  sitz.aendern = async (d, q) => { gesehen.push([d, q]); sitz.aendern = echt; return { code: 200, j: { rev: d.rev + 1, projekt: { rev: d.rev + 1 } } }; };
  const g = await ruf(z.url, 'POST', '/sampler/fit', { spur_id: r.j.spur_id });
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.equal(g.j.wert, fitWert(120, 300));
  assert.ok(g.j.wert > 0 && g.j.wert < 0.5, 'slower than the cut: below the middle');
  assert.equal(gesehen.length, 1, 'one history step');
  assert.deepEqual([gesehen[0][0].rev, gesehen[0][0].label, gesehen[0][1]], [t2.j.rev, 'Fit Fast · Loop', 'andreas']);
  assert.deepEqual(gesehen[0][0].befehle, [{ befehl: 'geraet_param_setzen', spur_id: r.j.spur_id, param: 'k2', wert: fitWert(120, 300) }]);
  assert.deepEqual([g.j.rev, g.j.projekt.rev], [t2.j.rev + 1, t2.j.rev + 1]);
});

test('read as text, delete refused while in use, welle of a cut, Stop Cypher', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 128);
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l4' } });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const id = r.j.schnitt_id;
  const j = await ruf(z.url, 'GET', `/sampler/schnitt?id=${id}`);
  assert.deepEqual([j.code, j.j.schnitt.id, j.j.schnitt.grenzen.length], [200, id, 17]);
  const x = await ruf(z.url, 'GET', `/sampler/schnitt?id=${id}&format=text`);
  assert.equal(x.code, 200);
  assert.equal(x.j.id, id);
  assert.ok(x.j.text.startsWith('cut '), x.j.text.slice(0, 40));
  const u = await ruf(z.url, 'GET', '/sampler/schnitt?id=nix-0000');
  assert.deepEqual([u.code, u.j.fehler], [404, 'schnitt_unbekannt']);
  assert.equal((await ruf(z.url, 'GET', '/sampler/schnitt')).code, 400);
  // delete while the track exists
  const d = await ruf(z.url, 'POST', '/sampler/loeschen', { id });
  assert.deepEqual([d.code, d.j.fehler, d.j.spuren], [409, 'schnitt_in_gebrauch', ['l4']]);
  assert.equal((await liste(z)).length, 1);
  // the waveform
  const w = await fetch(`${z.url}/welle?schnitt=${id}`);
  assert.equal(w.status, 200);
  const b = Buffer.from(await w.arrayBuffer());
  assert.equal(b.toString('ascii', 0, 4), 'DJKW');
  assert.equal((await fetch(`${z.url}/welle?schnitt=nix-0000`)).status, 404);
  assert.equal((await fetch(`${z.url}/welle?schnitt=${'..%2F'.repeat(3)}x`)).status, 400);
  // Stop Cypher: Cypher's writes are refused, Andreas' go on
  const ctx = z.o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(z.o).kiGestoppt));
  const n = (await liste(z)).length;
  for (const [pfad, koerper] of [['/sampler/schnitt', { quelle: { art: 'loop', ref: 'l4' } }], ['/sampler/spur', { quelle: { art: 'loop', ref: 'l4' } }],
    ['/sampler/fit', { spur_id: r.j.spur_id }], ['/sampler/loeschen', { id }]]) {
    const c = await ruf(z.url, 'POST', pfad, koerper, CYPHER);
    assert.deepEqual([c.code, c.j.fehler], [409, 'ki_gestoppt'], pfad);
  }
  assert.equal((await liste(z)).length, n, 'nothing was made or removed');
  assert.equal((await ruf(z.url, 'GET', '/sampler/liste', undefined, CYPHER)).code, 200, 'reading stays open');
  // Andreas deletes after the track is gone
  const spur = r.j.spur_id;
  const rev = (await z.projekt()).rev;
  const lo = await ruf(z.url, 'POST', '/proj/aendern', { rev, label: 'Remove', befehle: [{ befehl: 'spur_loeschen', spur_id: spur }] });
  assert.equal(lo.code, 200, JSON.stringify(lo.j));
  const ok = await ruf(z.url, 'POST', '/sampler/loeschen', { id });
  assert.deepEqual([ok.code, ok.j], [200, { ok: true }]);
  assert.deepEqual(await liste(z), []);
  assert.deepEqual(z.bkDateien(), []);
  assert.equal((await ruf(z.url, 'POST', '/sampler/loeschen', { id })).code, 404);
});

// Task 7 (D12): POST /sampler/hoeren plays one slice by /k/arr/note. The kern stand-in records the messages; the timers are real (the slices here are short).
const noten = (z) => anKern(z.log, '/k/arr/note').map((m) => [m.felder.spur, m.felder.ton, m.felder.vel]);
const anSpur = async (z, quelle, tempo, extra = {}) => {
  await z.oeffne('Mod', tempo);
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle, ...extra });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  return (await z.projekt()).spuren.find((s) => s.id === r.j.spur_id);
};

test('hoeren sends the note on now and the off after the slice length; a new request ends the previous note first', async (t) => {
  const z = await aufbau(t);
  const spur = await anSpur(z, { art: 'loop', ref: 'l4' }, 128);        // 16 slices of 5625 frames, SPEED at 1
  const t0 = Date.now();
  const h = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: spur.id, scheibe: 2 });
  assert.deepEqual([h.code, h.j], [200, { ok: true, dauer_ms: 117 }]);   // 5625 / 48
  assert.deepEqual(noten(z), [[spur.nr, 2, 100]], 'the on went out and nothing else yet');
  assert.ok(await bis(() => noten(z).length === 2), 'the off follows');
  assert.deepEqual(noten(z)[1], [spur.nr, 2, 0]);
  assert.ok(Date.now() - t0 >= 110, `the off came after ${Date.now() - t0} ms`);
  // two requests in a row: the first note is ended by the second request, then the second ends by its own timer
  const n = noten(z).length;
  const a = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: spur.id, scheibe: 3 });
  const b = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: spur.id, scheibe: 5 });
  assert.deepEqual([a.code, b.code], [200, 200]);
  assert.ok(await bis(() => noten(z).length === n + 4));
  await warte(250);
  assert.deepEqual(noten(z).slice(n), [[spur.nr, 3, 100], [spur.nr, 3, 0], [spur.nr, 5, 100], [spur.nr, 5, 0]], 'one off per on, in this order, nothing twice');
});

test('hoeren: the length follows the SPEED of the track, is capped at 10 s, and a long note is ended by the next request', async (t) => {
  const z = await aufbau(t);
  const schnell = await anSpur(z, { art: 'loop', ref: 'l4' }, 192);     // FIT 192 / 128 = 1.5: SPEED 1.5
  const speed = speedVon(schnell.geraet.parameter.k2);
  assert.ok(Math.abs(speed - 1.5) < 1e-9);
  const h = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: schnell.id, scheibe: 0 });
  assert.deepEqual([h.code, h.j.dauer_ms], [200, Math.round(5625 / 48 / speed)]);
  assert.equal(h.j.dauer_ms, 78);
  assert.ok(await bis(() => noten(z).length === 2));
  // a 60 s module cut into 4 slices of 15 s at SPEED 1 (project 64 BPM = the cut tempo): capped at 10 s
  schreibeModul(z.d.root, z.d.module, 'aaaaaaaaaaaaaaaa', { herkunft: { bpm: 64, laenge_beats: 64, titel: 'Long' }, spuren: { Loop: 2880000 } });
  const rev = (await z.projekt()).rev;
  const ap = await ruf(z.url, 'POST', '/proj/aendern', { rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 64 }] });
  assert.equal(ap.code, 200, JSON.stringify(ap.j));
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'modul', ref: 'aaaaaaaaaaaaaaaa' }, scheiben: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const lang = (await z.projekt()).spuren.find((s) => s.id === r.j.spur_id);
  const n = noten(z).length;
  const l = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: lang.id, scheibe: 1 });
  assert.deepEqual([l.code, l.j.dauer_ms], [200, 10000]);
  assert.deepEqual(noten(z).slice(n), [[lang.nr, 1, 100]]);
  const l2 = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: lang.id, scheibe: 2 });
  assert.equal(l2.code, 200);
  assert.deepEqual(noten(z).slice(n), [[lang.nr, 1, 100], [lang.nr, 1, 0], [lang.nr, 2, 100]], 'the long note was ended at once by the next request');
});

test('hoeren refusals send nothing; Stop Cypher refuses Cypher, the off of a Cypher note still goes out as andreas', async (t) => {
  const z = await aufbau(t);
  const h0 = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: 'x', scheibe: 0 });
  assert.deepEqual([h0.code, h0.j.fehler], [409, 'kein_projekt']);
  const spur = await anSpur(z, { art: 'loop', ref: 'l4' }, 128);
  const rev = (await z.projekt()).rev;
  const a = await ruf(z.url, 'POST', '/proj/aendern', { rev, label: 'Drums', befehle: [{ befehl: 'werkbank_spur_neu', name: 'Drums', geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} } }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const drums = a.j.projekt.spuren.find((s) => s.name === 'Drums');
  const nein = async (koerper, code, fehler, wer) => {
    const x = await ruf(z.url, 'POST', '/sampler/hoeren', koerper, wer);
    assert.deepEqual([x.code, x.j.fehler], [code, fehler], JSON.stringify(koerper));
    assert.ok(x.j.text === undefined || x.j.text.length > 3);
  };
  await nein({ spur_id: drums.id, scheibe: 0 }, 409, 'kein_schnitt_geraet');
  await nein({ spur_id: 'nix', scheibe: 0 }, 404, 'spur_unbekannt');
  for (const scheibe of [16, -1, 1.5, '2', null]) await nein({ spur_id: spur.id, scheibe }, 400, 'argument_ungueltig');
  await nein({ spur_id: spur.id }, 400, 'argument_ungueltig');
  await nein({ scheibe: 0 }, 400, 'argument_ungueltig');
  await nein({ spur_id: spur.id, scheibe: 0, vel: 5 }, 400, 'argument_unbekannt');
  assert.deepEqual(noten(z), [], 'nothing reached the core');
  // Cypher before Stop Cypher: the on carries its source, the off goes as andreas
  const c = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: spur.id, scheibe: 1 }, CYPHER);
  assert.equal(c.code, 200, JSON.stringify(c.j));
  assert.ok(await bis(() => noten(z).length === 2));
  assert.deepEqual(anKern(z.log, '/k/arr/note').map((m) => m.felder.quelle), ['cypher', 'andreas']);
  // Stop Cypher: Cypher is refused before anything is sent, Andreas still hears
  const ctx = z.o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(z.o).kiGestoppt));
  await nein({ spur_id: spur.id, scheibe: 1 }, 409, 'ki_gestoppt', CYPHER);
  assert.equal(noten(z).length, 2, 'nothing was sent for Cypher');
  const ok = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: spur.id, scheibe: 1 });
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  assert.equal(noten(z).length, 3);
});

// Review fix: delete looks beyond the open project (stored projects, the module store, rack members) before it removes a cut.
const bkGeraet = (graph) => ({ art: 'intern', name: 'bk', graph, parameter: {} });
const dateienDesSchnitts = (z, id) => [path.join(z.bk, `smp-${id}.json`), path.join(z.bk, 'panels', `smp-${id}.json`), path.join(z.bk, 'samples', `smp-${id}.f32`), path.join(z.sampler, id)]
  .map((p) => fs.existsSync(p));

test('loeschen refuses while a stored project, a module of the store or a rack member of the open project uses the cut (named in the text)', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Alpha', 128);
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l4' } });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const id = r.j.schnitt_id, graph = `smp-${id}`;
  assert.deepEqual(dateienDesSchnitts({ ...z.d }, id), [true, true, true, true]);
  // Alpha is saved and closed when Beta opens; Beta carries a broken neighbour project that must be skipped
  await z.oeffne('Beta', 128);
  fs.mkdirSync(path.join(z.optionen.proj.wurzel, 'kaputt'));
  fs.writeFileSync(path.join(z.optionen.proj.wurzel, 'kaputt', 'project.json'), '{ not json');
  const d1 = await ruf(z.url, 'POST', '/sampler/loeschen', { id });
  assert.deepEqual([d1.code, d1.j.fehler], [409, 'schnitt_in_gebrauch'], JSON.stringify(d1.j));
  assert.ok(d1.j.text.includes('Alpha'), d1.j.text);
  assert.ok(!d1.j.text.includes('Beta') && !d1.j.text.includes('kaputt'), d1.j.text);
  assert.deepEqual(dateienDesSchnitts({ ...z.d }, id), [true, true, true, true], 'nothing was removed');
  // a module of the store that plays the graph
  const alpha = (await ruf(z.url, 'GET', '/proj/liste')).j.find((x) => x.name === 'Alpha');
  const o = await ruf(z.url, 'POST', '/proj/oeffnen', { slug: alpha.slug });
  assert.equal(o.code, 200, JSON.stringify(o.j));
  const spurAlpha = (await z.projekt()).spuren.find((s) => s.geraet?.graph === graph);
  const lo = await ruf(z.url, 'POST', '/proj/aendern', { rev: (await z.projekt()).rev, label: 'Remove', befehle: [{ befehl: 'spur_loeschen', spur_id: spurAlpha.id }] });
  assert.equal(lo.code, 200, JSON.stringify(lo.j));
  const d2 = await ruf(z.url, 'POST', '/sampler/loeschen', { id });
  assert.deepEqual([d2.code, d2.j.fehler], [200, undefined], 'Alpha was the only user and is clean now: ' + JSON.stringify(d2.j));
});

test('loeschen: a module of the store with a track on the graph refuses; five names then "and N more"', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Open', 128);
  const r = await ruf(z.url, 'POST', '/sampler/schnitt', { quelle: { art: 'loop', ref: 'l4' } });
  const id = r.j.schnitt.id, graph = `smp-${id}`;
  const modul = (n, titel) => {
    const mid = n.toString(16).padStart(16, '0');
    fs.mkdirSync(path.join(z.d.module, mid), { recursive: true });
    const spur = { id: 's1', nr: 1, name: 'Slices', art: 'instrument', geraet: bkGeraet(graph), clips: [] };
    fs.writeFileSync(path.join(z.d.module, mid, 'modul.json'), JSON.stringify({ format: 1, id: mid, gespeichert: '2026-11-16T10:00:00Z', herkunft: { titel }, gruppen: [{ id: 'g1', name: titel }], spuren: [spur], audio: [] }));
  };
  modul(1, 'Mod One');
  const d1 = await ruf(z.url, 'POST', '/sampler/loeschen', { id });
  assert.deepEqual([d1.code, d1.j.fehler], [409, 'schnitt_in_gebrauch'], JSON.stringify(d1.j));
  assert.ok(d1.j.text.includes('Mod One'), d1.j.text);
  assert.ok(!d1.j.text.includes('more'), d1.j.text);
  for (let n = 2; n <= 7; n++) modul(n, `Mod ${n}`);
  const d2 = await ruf(z.url, 'POST', '/sampler/loeschen', { id });
  assert.equal(d2.code, 409);
  assert.equal(d2.j.text.split('module "').length - 1, 5, d2.j.text);
  assert.ok(d2.j.text.includes('and 2 more'), d2.j.text);
  assert.deepEqual(dateienDesSchnitts({ ...z.d }, id), [true, true, true, true]);
});

test('loeschen without a user removes audio, graph, panel and folder; a rack member of the open project counts as a user', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Open', 128);
  const r = await ruf(z.url, 'POST', '/sampler/schnitt', { quelle: { art: 'loop', ref: 'l4' } });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const id = r.j.schnitt.id, graph = `smp-${id}`;
  assert.deepEqual(dateienDesSchnitts({ ...z.d }, id), [true, true, true, true]);
  const rack = { art: 'rack', glieder: [{ id: 'g1', geraet: bkGeraet(graph) }], kette: 0 };
  const a = await ruf(z.url, 'POST', '/proj/aendern', { rev: (await z.projekt()).rev, label: 'Rack', befehle: [{ befehl: 'werkbank_spur_neu', name: 'Racked', geraet: rack }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const d1 = await ruf(z.url, 'POST', '/sampler/loeschen', { id });
  assert.deepEqual([d1.code, d1.j.fehler, d1.j.spuren], [409, 'schnitt_in_gebrauch', ['Racked']], JSON.stringify(d1.j));
  assert.deepEqual(dateienDesSchnitts({ ...z.d }, id), [true, true, true, true]);
  const spurId = a.j.projekt.spuren.find((s) => s.name === 'Racked').id;
  const lo = await ruf(z.url, 'POST', '/proj/aendern', { rev: (await z.projekt()).rev, label: 'Remove', befehle: [{ befehl: 'spur_loeschen', spur_id: spurId }] });
  assert.equal(lo.code, 200, JSON.stringify(lo.j));
  const d2 = await ruf(z.url, 'POST', '/sampler/loeschen', { id });
  assert.deepEqual([d2.code, d2.j], [200, { ok: true }]);
  assert.deepEqual(dateienDesSchnitts({ ...z.d }, id), [false, false, false, false]);
});

test('hoeren: the same slice twice in a row is On, On, one Off at the end (the overtaken off must not end the new note)', async (t) => {
  const z = await aufbau(t);
  const spur = await anSpur(z, { art: 'loop', ref: 'l4' }, 128);
  const n = noten(z).length;
  const a = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: spur.id, scheibe: 4 });
  const b = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: spur.id, scheibe: 4 });
  assert.deepEqual([a.code, b.code], [200, 200]);
  assert.deepEqual(noten(z).slice(n), [[spur.nr, 4, 100], [spur.nr, 4, 100]], 'no off between the two ons');
  assert.ok(await bis(() => noten(z).length === n + 3));
  await warte(250);
  assert.deepEqual(noten(z).slice(n), [[spur.nr, 4, 100], [spur.nr, 4, 100], [spur.nr, 4, 0]], 'exactly one off, at the end');
});


// ---- Sampler A2 task 2: SLICE TO TRACK by hits ----

test('SLICE TO TRACK by hits: the track plays the break in its original order', async (t) => {
  const z = await aufbau(t);
  mitBruch(z);
  await z.oeffne('Mod', 128);
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'bruch' }, methode: 'anschlag' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const j = r.j;
  const noten = (await z.projekt()).spuren.find((s) => s.id === j.spur_id).clips[0].noten;
  const s = (await ruf(z.url, 'GET', `/sampler/schnitt?id=${j.schnitt_id}`)).j.schnitt;
  assert.deepEqual([s.methode, s.empfindlichkeit], ['anschlag', 0.5]);
  assert.ok(s.grenzen.length >= 7, 'the bursts are slices');
  assert.deepEqual(noten.map((n) => [n.ton, n.beat]), s.grenzen.slice(0, -1).map((g, i) => [i, g * s.beats / s.frames]));
  // the sensitivity is passed on
  const hoch = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'bruch' }, methode: 'anschlag', empfindlichkeit: 1 });
  assert.equal(hoch.code, 200, JSON.stringify(hoch.j));
  const sh = (await ruf(z.url, 'GET', `/sampler/schnitt?id=${hoch.j.schnitt_id}`)).j.schnitt;
  assert.deepEqual([sh.empfindlichkeit, sh.grenzen.length >= s.grenzen.length], [1, true]);
  // methode raster is the default's name
  const g = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l4' }, methode: 'raster', scheiben: 8 });
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.equal((await z.projekt()).spuren.find((x) => x.id === g.j.spur_id).clips[0].noten.length, 8);
});

test('a silent loop by hits is refused and creates nothing; hand and bad combinations are refused', async (t) => {
  const z = await aufbau(t);
  mitBruch(z);
  await z.oeffne('Mod', 128);
  const rev = (await z.projekt()).rev;
  const vorher = [z.bkDateien(), fs.readdirSync(z.d.sampler), (fs.existsSync(path.join(z.d.bk, 'samples')) ? fs.readdirSync(path.join(z.d.bk, 'samples')).length : 0)];
  const q = { art: 'loop', ref: 'still' };
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: q, methode: 'anschlag' });
  assert.deepEqual([r.code, r.j.fehler], [422, 'keine_anschlaege']);
  assert.match(r.j.text, /no hits found at sensitivity 0\.50/);
  for (const [koerper, code, fehler] of [
    [{ quelle: { art: 'loop', ref: 'bruch' }, methode: 'hand' }, 400, 'methode_unbekannt'],
    [{ quelle: { art: 'loop', ref: 'bruch' }, methode: 'nix' }, 400, 'methode_unbekannt'],
    [{ quelle: { art: 'loop', ref: 'bruch' }, methode: 7 }, 400, 'methode_unbekannt'],
    [{ quelle: { art: 'loop', ref: 'bruch' }, methode: 'anschlag', empfindlichkeit: 1.5 }, 400, 'argument_ungueltig'],
    [{ quelle: { art: 'loop', ref: 'bruch' }, methode: 'anschlag', scheiben: 8 }, 400, 'argument_ungueltig'],
    [{ quelle: { art: 'loop', ref: 'bruch' }, empfindlichkeit: 0.5 }, 400, 'argument_ungueltig'],
    [{ id: 'x', methode: 'anschlag' }, 400, 'argument_unbekannt'],
  ]) {
    const x = await ruf(z.url, 'POST', '/sampler/spur', koerper);
    assert.deepEqual([x.code, x.j.fehler], [code, fehler], JSON.stringify(koerper));
    assert.ok(typeof x.j.text === 'string' && x.j.text.length > 5, `an English text: ${JSON.stringify(x.j)}`);
  }
  assert.deepEqual([z.bkDateien(), fs.readdirSync(z.d.sampler), (fs.existsSync(path.join(z.d.bk, 'samples')) ? fs.readdirSync(path.join(z.d.bk, 'samples')).length : 0)], vorher, 'no file left');
  assert.equal((await z.projekt()).rev, rev, 'the project is unchanged');
  assert.deepEqual(await liste(z), []);
});

// ---- 2026-11-16 follow-ups: level, module length, silent loops ----

test('SLICE TO TRACK: the track starts at 0 dB; a cut longer than the module raises the module length in the same step', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod');
  const p0 = await z.projekt();
  const a = await ruf(z.url, 'POST', '/proj/aendern', { rev: p0.rev, label: 'Length', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 4 }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  // l4 fits the 4-beat module: nothing but the track
  const r = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l4' } });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.projekt.spuren.find((s) => s.id === r.j.spur_id).fader_db, 0);
  assert.equal(r.j.modul_takte, undefined);
  assert.equal(r.j.projekt.loop.bis_beat, 4);
  // l8 does not: the module grows to 2 bars, one history step, and one undo takes both back
  const r2 = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l8' } });
  assert.equal(r2.code, 200, JSON.stringify(r2.j));
  assert.equal(r2.j.modul_takte, 2);
  assert.deepEqual(r2.j.projekt.loop, { an: true, von_beat: 0, bis_beat: 8 });
  const v = (await ruf(z.url, 'GET', '/proj/verlauf')).j;
  assert.equal(v.filter((e) => e.label === 'Slice l8').length, 1);
  // a loop that is not a module length (the person's own range) stays
  const p1 = await z.projekt();
  const b = await ruf(z.url, 'POST', '/proj/aendern', { rev: p1.rev, label: 'Own', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 1, bis_beat: 3 }] });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  const r3 = await ruf(z.url, 'POST', '/sampler/spur', { quelle: { art: 'loop', ref: 'l8' } });
  assert.equal(r3.code, 200, JSON.stringify(r3.j));
  assert.equal(r3.j.modul_takte, undefined);
  assert.deepEqual(r3.j.projekt.loop, { an: true, von_beat: 1, bis_beat: 3 });
});

test('quellen marks a silent loop with stumm; the mark follows the file', async (t) => {
  const z = await aufbau(t);
  mitBruch(z);
  const q = (await ruf(z.url, 'GET', '/sampler/quellen')).j;
  assert.deepEqual(q.loops, [{ name: 'bruch', beats: 4 }, { name: 'l4', beats: 4 }, { name: 'l8', beats: 8 }, { name: 'still', beats: 4, stumm: true }]);
  fs.writeFileSync(path.join(z.d.loops, 'still', 'loop.f32'), Buffer.from(burstDaten(4, BRUCH).buffer));
  fs.utimesSync(path.join(z.d.loops, 'still', 'loop.f32'), new Date(), new Date(Date.now() + 5000));
  const q2 = (await ruf(z.url, 'GET', '/sampler/quellen')).j;
  assert.deepEqual(q2.loops.find((l) => l.name === 'still'), { name: 'still', beats: 4 });
});

test('hoeren with ton plays one note on any instrument track for 400 ms; scheibe and ton exclude each other', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod');
  const p = await z.projekt();
  const a = await ruf(z.url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Drums', befehle: [{ befehl: 'werkbank_spur_neu', name: 'Drums', geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} } }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const spur = (await z.projekt()).spuren.find((s) => s.name === 'Drums');
  const t0 = Date.now();
  const h = await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: spur.id, ton: 38 });
  assert.deepEqual([h.code, h.j], [200, { ok: true, dauer_ms: 400 }]);
  assert.deepEqual(noten(z), [[spur.nr, 38, 100]]);
  assert.ok(await bis(() => noten(z).length === 2), 'the off follows');
  assert.deepEqual(noten(z)[1], [spur.nr, 38, 0]);
  assert.ok(Date.now() - t0 >= 390, `the off came after ${Date.now() - t0} ms`);
  const n = noten(z).length;
  for (const k of [{ spur_id: spur.id }, { spur_id: spur.id, ton: 38, scheibe: 0 }, { spur_id: spur.id, ton: 128 }, { spur_id: spur.id, ton: 1.5 }]) {
    assert.equal((await ruf(z.url, 'POST', '/sampler/hoeren', k)).code, 400, JSON.stringify(k));
  }
  assert.equal((await ruf(z.url, 'POST', '/sampler/hoeren', { spur_id: 'x', ton: 38 })).code, 404);
  assert.equal(noten(z).length, n, 'a refusal sends nothing');
});
