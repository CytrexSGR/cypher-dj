// Tracker task 21: slot banks of the amiga device. Pure bank graph and the conversion into the Amiga form, then the slot logic behind the routes against a
// stand-in project session (the commands run through the real project engine). Every folder is a temp folder; no server, no core, no ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { findeGraph } from '../graphs.ts';
import { pfadeVon } from '../devices_parameter.ts';
import { bankGraph, wandleAmiga, plaetzeVon, tiefpassUmrechnen, BANK_NAME, LEER_DATEI } from '../sampler/slots.ts';
import { platzLogik, platzRouten } from '../areas/sampler/platz_routes.ts';
import { sinusWav } from './support/sinus_wav.mjs';

const REPO_BK = pfadeVon();
const AMIGA = JSON.parse(fs.readFileSync(path.join(REPO_BK.beispiele, 'amiga.json'), 'utf8'));

// ---- pure ----
const sinus = (hz, sekunden, amp = 0.5, rate = 48000) => {
  const n = Math.round(sekunden * rate), x = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) x[2 * i] = x[2 * i + 1] = amp * Math.sin(2 * Math.PI * hz * i / rate);
  return x;
};
const rms = (x, von = 0, bis = x.length >> 1) => { let s = 0; for (let i = von; i < bis; i++) s += x[2 * i] ** 2; return Math.sqrt(s / (bis - von)); };
const nulldurchgaenge = (x) => { let n = 0; for (let i = 1; i < x.length >> 1; i++) if (x[2 * (i - 1)] < 0 && x[2 * i] >= 0) n++; return n; };

test('bankGraph: copies the base, fills the paula slots, leaves the base alone', () => {
  const vorher = JSON.stringify(AMIGA);
  const g = bankGraph(AMIGA, [{ datei: 'a.f32', name: 'A', grund: 261.6256, rate: 16574, schleife: 0, s_von: 0, s_laenge: 0, pegel: 1, fein: 0 },
    { datei: 'b.f32', grund: 200, rate: 8363, schleife: 1, s_von: 4, s_laenge: 8, pegel: 0.5, fein: -2 }], 'amiga-0a1b2c');
  assert.equal(JSON.stringify(AMIGA), vorher);
  assert.equal(g.name, 'amiga-0a1b2c');
  assert.deepEqual(plaetzeVon(g), [{ datei: 'a.f32', name: 'A', grund: 261.6256, rate: 16574 },
    { datei: 'b.f32', grund: 200, rate: 8363, schleife: 1, s_von: 4, s_laenge: 8, pegel: 0.5, fein: -2 }]);
  assert.equal(g.knoten.length, AMIGA.knoten.length);
  assert.deepEqual(g.kanten, AMIGA.kanten);
  assert.ok(BANK_NAME.test(g.name));
  assert.throws(() => bankGraph(AMIGA, []), /1..32/);
  assert.throws(() => bankGraph(AMIGA, Array.from({ length: 33 }, () => ({ datei: 'a.f32', grund: 261, rate: 8000 }))), /1..32/);
  assert.throws(() => bankGraph({ knoten: [{ id: 'x', art: 'add' }] }, [{ datei: 'a.f32', grund: 261, rate: 8000 }]), /no paula/);
});

test('wandleAmiga: 1 kHz at 48 kHz becomes 16574 Hz frames, every value a multiple of 1/128', () => {
  const w = wandleAmiga(sinus(1000, 1), 16574);
  assert.ok(Math.abs(w.frames - 16574) <= 1, `frames ${w.frames}`);
  assert.equal(w.daten.length, w.frames * 2);
  assert.ok(w.daten.every((v) => Number.isInteger(v * 128) && v >= -1 && v <= 127 / 128));
  assert.ok(Math.abs(nulldurchgaenge(w.daten) - 1000) <= 3, `zero crossings ${nulldurchgaenge(w.daten)}`);
  assert.ok(Math.abs(rms(w.daten) - 0.5 / Math.SQRT2) < 0.01, `rms ${rms(w.daten)}`);
});

test('wandleAmiga: the low-pass keeps a tone below the target Nyquist and removes one above it (no alias)', () => {
  const unten = tiefpassUmrechnen(sinus(6000, 0.5), 16574);   // Nyquist 8287
  assert.ok(Math.abs(rms(unten, 300, unten.length / 2 - 300) - 0.5 / Math.SQRT2) < 0.02, `6 kHz rms ${rms(unten, 300, unten.length / 2 - 300)}`);
  for (const hz of [10000, 12000, 20000]) {
    const t = tiefpassUmrechnen(sinus(hz, 0.5), 16574);
    const r = rms(t, 300, t.length / 2 - 300);
    assert.ok(r < 0.005, `${hz} Hz leaves rms ${r}`);   // 0.5 amplitude in: -40 dB is 0.0035 rms
  }
  const klein = tiefpassUmrechnen(sinus(1000, 0.5), 4000);
  assert.ok(Math.abs(klein.length / 2 - 2000) <= 1);
  assert.deepEqual([...tiefpassUmrechnen(sinus(1000, 0.01), 48000)], [...sinus(1000, 0.01)]);
});

// ---- the slot logic ----
function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plaetze-'));
  const d = { root, bk: path.join(root, 'bk'), sampler: path.join(root, 'sampler'), lib: path.join(root, 'lib') };
  fs.mkdirSync(path.join(d.bk, 'panels'), { recursive: true });
  fs.mkdirSync(d.sampler); fs.mkdirSync(d.lib);
  fs.copyFileSync(path.join(REPO_BK.beispiele, 'amiga.json'), path.join(d.bk, 'amiga.json'));
  fs.copyFileSync(path.join(REPO_BK.paneele, 'amiga.json'), path.join(d.bk, 'panels', 'amiga.json'));
  fs.writeFileSync(path.join(d.bk, 'ohne-rolle.json'), JSON.stringify({ format: 'baukasten/2', name: 'ohne-rolle', stimmen: 1, knoten: [{ id: 'aus', art: 'ausgang' }], kanten: [] }));
  fs.mkdirSync(path.join(d.bk, 'samples'));
  for (const n of ['amiga-quadrat', 'amiga-dreieck', 'amiga-saege']) fs.writeFileSync(path.join(d.bk, 'samples', `${n}.f32`), Buffer.alloc(32 * 8));
  fs.writeFileSync(path.join(d.bk, 'samples', 'amiga-rauschen.f32'), Buffer.alloc(4096 * 8));
  fs.writeFileSync(path.join(d.sampler, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: d.lib }]));
  sinusWav(path.join(d.lib, 'Sinus.wav'), { hz: 1000, sekunden: 1, rate: 48000, kanaele: 1, pegel: 0.5 });
  sinusWav(path.join(d.lib, 'lang.wav'), { hz: 100, sekunden: 61, rate: 8000, kanaele: 1 });
  const alt = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt; fs.rmSync(root, { recursive: true, force: true }); });
  const BK = { art: 'intern', name: 'bk', graph: 'amiga', parameter: {} };
  const lauf = (p, b) => fuehreListeAus(structuredClone(p), b, { graphArt: (n) => findeGraph(n)?.art ?? null }).projekt;
  let p = lauf(neuesProjekt('x'), [
    { befehl: 'spur_neu', art: 'instrument', name: 'Amiga', geraet: BK },
    { befehl: 'spur_neu', art: 'instrument', name: 'Plain', geraet: { art: 'intern', name: 'bk', graph: 'ohne-rolle', parameter: {} } },
    { befehl: 'spur_neu', art: 'instrument', name: 'Second', geraet: BK },
    { befehl: 'spur_neu', art: 'instrument', name: 'Host', geraet: { art: 'wirt', name: 'surge' } },
  ]);
  const z = { projekt: { ...p, rev: 5 }, verlauf: [], rueck: [], reloads: 0, offen: true, gestoppt: false };
  const sitzung = {
    async aendern({ rev, label, befehle }, quelle) {
      assert.equal(rev, z.projekt.rev);
      try {
        const projekt = { ...lauf(z.projekt, befehle), rev: rev + 1 };
        z.verlauf.push({ label, quelle, vorher: z.projekt }); z.rueck.length = 0;
        z.projekt = projekt;
        return { code: 200, j: { rev: rev + 1, projekt } };
      } catch (e) { return { code: 409, j: { fehler: e.grund ?? e.message } }; }
    },
    async ladeLiveNeuFrei() { z.reloads++; return true; },
  };
  // undo and redo as the project history does them: the whole project state of before / after the step comes back
  z.undo = () => { const e = z.verlauf.pop(); z.rueck.push({ ...e, nachher: z.projekt }); z.projekt = { ...e.vorher, rev: z.projekt.rev + 1 }; };
  z.redo = () => { const e = z.rueck.pop(); z.verlauf.push(e); z.projekt = { ...e.nachher, rev: z.projekt.rev + 1 }; };
  const zugang = { offen: () => (z.offen ? { projekt: z.projekt, slug: 'x' } : null) };
  const ctx = { log() {}, quelle: () => 'andreas', kiGestoppt: () => z.gestoppt };
  const opt = { sitzung, zugang, ordner: d.sampler, loops: '', module: '' };
  const l = platzLogik(ctx, opt);
  const spur = (n) => z.projekt.spuren.find((s) => s.name === n);
  const lies = (id) => l.lies(new URL(`http://x/sampler/plaetze?spur_id=${id}`)).j;
  const f32 = (datei) => { const b = fs.readFileSync(path.join(d.bk, 'samples', datei)); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
  return { d, z, l, spur, lies, f32, opt, ctx };
}
const refuse = async (f, code, grund) => {
  await assert.rejects(Promise.resolve().then(f), (e) => (e.code === code || e.status === code) && (e.fehler ?? e.grund) === grund, `expected ${code} ${grund}`);
};

test('the routes are registered with their protection', () => {
  const r = platzRouten({ log() {}, quelle: () => 'andreas', kiGestoppt: () => false }, { sitzung: {}, zugang: {}, loops: '', module: '' });
  assert.deepEqual(r.map((x) => `${x.methode} ${x.pfad}`), ['GET /sampler/plaetze', 'POST /sampler/platz', 'POST /sampler/platz/aendern', 'POST /sampler/platz/leeren']);
  assert.deepEqual(r.map((x) => x.schutz), ['offen', 'fremdePost', 'fremdePost', 'fremdePost']);
});

test('GET plaetze of a track on the base graph lists the four factory slots', (t) => {
  const s = aufbau(t);
  const j = s.lies(s.spur('Amiga').id);
  assert.equal(j.graph, 'amiga');
  assert.deepEqual(j.plaetze.map((x) => [x.nr, x.name, x.frames, x.rate, x.schleife, x.s_laenge]),
    [[1, 'Square', 32, 8372, 1, 32], [2, 'Triangle', 32, 8372, 1, 32], [3, 'Saw', 32, 8372, 1, 32], [4, 'Noise burst', 4096, 8372, 0, 0]]);
  assert.deepEqual(Object.keys(j.plaetze[0]).sort(), ['fein', 'frames', 'grund', 'name', 'nr', 'pegel', 'rate', 's_laenge', 's_von', 'schleife']);
});

test('POST platz: first use makes the bank and switches the track in ONE history step; the file is in the Amiga form', async (t) => {
  const s = aufbau(t);
  const id = s.spur('Amiga').id;
  const a = await s.l.neu({ spur_id: id, platz: 5, wurzel: 'Lib', rel: 'Sinus.wav' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.bank_neu, true);
  assert.ok(BANK_NAME.test(a.j.graph), a.j.graph);
  assert.equal(s.z.verlauf.length, 1);
  assert.equal(s.spur('Amiga').geraet.graph, a.j.graph);
  assert.equal(s.spur('Second').geraet.graph, 'amiga', 'another track keeps the base');
  assert.ok(fs.existsSync(path.join(s.d.bk, 'panels', `${a.j.graph}.json`)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.d.bk, 'panels', `${a.j.graph}.json`), 'utf8')).geraet.graph, a.j.graph);
  const g = JSON.parse(fs.readFileSync(path.join(s.d.bk, `${a.j.graph}.json`), 'utf8'));
  assert.equal(g.name, a.j.graph);
  const pl = plaetzeVon(g);
  assert.equal(pl.length, 5);
  assert.deepEqual(pl.slice(0, 4), plaetzeVon(AMIGA).map((x) => { const { s_von, ...r } = x; return r; }), 'the factory slots stay, defaults left out');
  assert.deepEqual([pl[4].name, pl[4].grund, pl[4].rate], ['Sinus', 261.6256, 16574]);
  // the answer and the file: frames ~ duration x 16574, every value a multiple of 1/128, stereo float32 at the slot rate
  assert.ok(Math.abs(a.j.frames - 16574) <= 1, `frames ${a.j.frames}`);
  const daten = s.f32(pl[4].datei);
  assert.equal(daten.length, a.j.frames * 2);
  assert.ok(daten.every((v) => Number.isInteger(v * 128)), 'values are k/128');
  assert.ok(new Set(daten).size > 20, 'not silent');
  const lies = s.lies(id).plaetze;
  assert.deepEqual([lies.length, lies[4].frames, lies[4].rate, lies[4].name], [5, a.j.frames, 16574, 'Sinus']);
  assert.equal(s.z.reloads, 0, 'the history step reloads the playback, no extra reload');
});

test('POST platz: the second write makes a NEW bank and a second history step (the first bank stays as it was); roh keeps 48 kHz', async (t) => {
  const s = aufbau(t);
  const id = s.spur('Amiga').id;
  const a = await s.l.neu({ spur_id: id, platz: 2, wurzel: 'Lib', rel: 'Sinus.wav', rate: 8363, name: 'Hi' }, 'andreas');
  const bank1 = a.j.graph;
  const hash1 = fs.readFileSync(path.join(s.d.bk, `${bank1}.json`), 'utf8');
  assert.ok(Math.abs(a.j.frames - 8363) <= 1);
  const b = await s.l.neu({ spur_id: id, platz: 7, wurzel: 'Lib', rel: 'Sinus.wav', roh: true, grund: 440 }, 'cypher');
  assert.equal(b.code, 200, JSON.stringify(b.j));
  const bank = b.j.graph;
  assert.deepEqual([b.j.bank_neu, b.j.rate, b.j.roh], [true, 48000, true]);
  assert.ok(BANK_NAME.test(bank) && bank !== bank1);
  assert.equal(fs.readFileSync(path.join(s.d.bk, `${bank1}.json`), 'utf8'), hash1, 'the first bank file is never changed');
  assert.equal(b.j.rev, s.z.projekt.rev);
  assert.equal(b.j.projekt.spuren.find((x) => x.name === 'Amiga').geraet.graph, bank);
  assert.ok(Math.abs(b.j.frames - 48000) <= 2, `frames ${b.j.frames}`);   // the zero first sample of the sine is trimmed as leading silence
  assert.deepEqual([s.z.verlauf.length, s.z.reloads], [2, 0]);
  const pl = plaetzeVon(JSON.parse(fs.readFileSync(path.join(s.d.bk, `${bank}.json`), 'utf8')));
  assert.equal(pl.length, 7);
  assert.deepEqual([pl[1].name, pl[1].rate], ['Hi', 8363]);
  assert.deepEqual([pl[4].datei, pl[5].datei], [LEER_DATEI, LEER_DATEI], 'a gap is filled with empty slots');
  assert.equal(fs.statSync(path.join(s.d.bk, 'samples', LEER_DATEI)).size, 32 * 8);
  assert.deepEqual([pl[6].rate, pl[6].grund], [48000, 440]);
  assert.ok(s.f32(pl[6].datei).some((v) => !Number.isInteger(v * 128)), 'raw keeps the full resolution');
  assert.equal(s.lies(id).plaetze[4].leer, true);
});

test('POST platz/aendern and leeren: fields, loop checks, empty slot refused', async (t) => {
  const s = aufbau(t);
  const id = s.spur('Amiga').id;
  // changing a factory slot of the base makes a bank as well (the base is never written)
  const a = await s.l.aendern({ spur_id: id, platz: 1, name: 'Sq', pegel: 0.5, fein: -3 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.bank_neu, true);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(s.d.bk, 'amiga.json'), 'utf8'))), JSON.stringify(AMIGA));
  const p1 = s.lies(id).plaetze[0];
  assert.deepEqual([p1.name, p1.pegel, p1.fein, p1.schleife, p1.s_laenge], ['Sq', 0.5, -3, 1, 32]);
  // the loop must lie inside the data (the block refuses it when it translates the graph)
  const b = await s.l.aendern({ spur_id: id, platz: 1, s_von: 8, s_laenge: 16 }, 'andreas');
  assert.deepEqual([b.code, b.j.bank_neu, s.z.verlauf.length], [200, true, 2]);
  await refuse(() => s.l.aendern({ spur_id: id, platz: 1, s_von: 20, s_laenge: 16 }, 'andreas'), 400, 'argument_ungueltig');
  await refuse(() => s.l.aendern({ spur_id: id, platz: 1, schleife: 1, s_laenge: 0 }, 'andreas'), 400, 'argument_ungueltig');
  const c = await s.l.aendern({ spur_id: id, platz: 4, schleife: 0 }, 'andreas');
  assert.equal(c.j.platz.schleife, 0);
  // clear
  const d = await s.l.leeren({ spur_id: id, platz: 2 }, 'andreas');
  assert.equal(d.code, 200);
  assert.deepEqual([s.lies(id).plaetze[1].leer, s.lies(id).plaetze[1].name], [true, '']);
  await refuse(() => s.l.leeren({ spur_id: id, platz: 2 }, 'andreas'), 404, 'bank_platz_leer');
  await refuse(() => s.l.aendern({ spur_id: id, platz: 2, name: 'x' }, 'andreas'), 404, 'bank_platz_leer');
  await refuse(() => s.l.aendern({ spur_id: id, platz: 9, name: 'x' }, 'andreas'), 404, 'bank_platz_leer');
  await refuse(() => s.l.aendern({ spur_id: id, platz: 1 }, 'andreas'), 400, 'argument_ungueltig');
  for (const bad of [{ pegel: 2 }, { fein: 8 }, { fein: -9 }, { name: '' }, { name: 'x'.repeat(23) }, { grund: 10 }, { schleife: 2 }, { s_von: -1 }])
    await refuse(() => s.l.aendern({ spur_id: id, platz: 1, ...bad }, 'andreas'), 400, 'argument_ungueltig');
});

test('a bank shared by several tracks: one write switches all of them in one step', async (t) => {
  const s = aufbau(t);
  const a = await s.l.neu({ spur_id: s.spur('Amiga').id, platz: 5, wurzel: 'Lib', rel: 'Sinus.wav' }, 'andreas');
  // the second track is switched to the same bank (what the MOD import does) by hand
  const o = s.z.projekt;
  s.z.projekt = { ...o, spuren: o.spuren.map((x) => (x.name === 'Second' ? { ...x, geraet: { ...x.geraet, graph: a.j.graph } } : x)) };
  const n = s.z.verlauf.length;
  const b = await s.l.aendern({ spur_id: s.spur('Amiga').id, platz: 5, name: 'Shared' }, 'andreas');
  assert.equal(b.code, 200);
  assert.equal(s.z.verlauf.length, n + 1, 'one history step');
  assert.equal(s.spur('Amiga').geraet.graph, b.j.graph);
  assert.equal(s.spur('Second').geraet.graph, b.j.graph, 'the second track follows');
  assert.equal(s.spur('Plain').geraet.graph, 'ohne-rolle');
  assert.equal(s.lies(s.spur('Second').id).plaetze[4].name, 'Shared');
  s.z.undo();
  assert.equal(s.spur('Amiga').geraet.graph, a.j.graph);
  assert.equal(s.spur('Second').geraet.graph, a.j.graph, 'undo puts both back');
  assert.equal(s.lies(s.spur('Second').id).plaetze[4].name, 'Sinus');
});

test('a project copy that loads a slot leaves the bank of the original byte for byte alone', async (t) => {
  const s = aufbau(t);
  const a = await s.l.neu({ spur_id: s.spur('Amiga').id, platz: 5, wurzel: 'Lib', rel: 'Sinus.wav' }, 'andreas');
  const sha = (g) => crypto.createHash('sha256').update(fs.readFileSync(path.join(s.d.bk, `${g}.json`))).digest('hex');
  const h0 = sha(a.j.graph);
  const original = structuredClone(s.z.projekt);
  s.z.projekt = structuredClone(original);                                // SAVE AS: a copy keeps the bank name
  const c = await s.l.aendern({ spur_id: s.spur('Amiga').id, platz: 5, name: 'IN-COPY', pegel: 0.2 }, 'andreas');
  assert.equal(c.code, 200);
  assert.notEqual(c.j.graph, a.j.graph);
  assert.equal(sha(a.j.graph), h0, 'the old bank file is unchanged');
  const alt = original.spuren.find((x) => x.name === 'Amiga');
  assert.equal(alt.geraet.graph, a.j.graph, 'the original still points at the old bank');
  assert.equal(plaetzeVon(JSON.parse(fs.readFileSync(path.join(s.d.bk, `${alt.geraet.graph}.json`), 'utf8')))[4].name, 'Sinus', 'and still reads the old name');
});

test('undo and redo over three slot changes step through the banks', async (t) => {
  const s = aufbau(t);
  const id = s.spur('Amiga').id;
  const g0 = s.spur('Amiga').geraet.graph;
  const a = await s.l.neu({ spur_id: id, platz: 5, wurzel: 'Lib', rel: 'Sinus.wav', name: 'One' }, 'andreas');
  const b = await s.l.aendern({ spur_id: id, platz: 5, name: 'Two', schleife: 0 }, 'andreas');
  const c = await s.l.leeren({ spur_id: id, platz: 5 }, 'andreas');
  assert.deepEqual(s.z.verlauf.map((x) => x.label), ['Slot 05: One', 'Slot 05: settings', 'Slot 05: cleared']);
  const gs = [g0, a.j.graph, b.j.graph, c.j.graph];
  assert.equal(new Set(gs).size, 4);
  const name = () => s.lies(id).plaetze[4]?.name ?? null;
  assert.deepEqual([s.spur('Amiga').geraet.graph, name()], [gs[3], '']);
  s.z.undo(); assert.deepEqual([s.spur('Amiga').geraet.graph, name()], [gs[2], 'Two']);
  s.z.undo(); assert.deepEqual([s.spur('Amiga').geraet.graph, name()], [gs[1], 'One']);
  s.z.undo(); assert.deepEqual([s.spur('Amiga').geraet.graph, s.lies(id).plaetze.length], [g0, 4]);
  s.z.redo(); s.z.redo(); s.z.redo();
  assert.deepEqual([s.spur('Amiga').geraet.graph, name()], [gs[3], '']);
  for (const g of gs.slice(1)) assert.ok(fs.existsSync(path.join(s.d.bk, `${g}.json`)), `bank ${g} stays on disk`);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(s.d.bk, 'amiga.json'), 'utf8'))), JSON.stringify(AMIGA));
  const d = await s.l.aendern({ spur_id: id, platz: 1, schleife: 0 }, 'andreas');
  assert.equal(s.z.verlauf.at(-1).label, 'Slot 01: loop off');
  assert.equal(d.code, 200);
});

test('a failure in the middle of a write leaves no half bank and the project unchanged', async (t) => {
  const s = aufbau(t);
  const id = s.spur('Amiga').id;
  const ls = () => [fs.readdirSync(s.d.bk).sort(), fs.readdirSync(path.join(s.d.bk, 'panels')).sort(), fs.readdirSync(path.join(s.d.bk, 'samples')).sort()];
  const vorher = ls(), projekt = structuredClone(s.z.projekt);
  // (a) the panel cannot be written: a FILE sits where the panel folder is
  fs.rmSync(path.join(s.d.bk, 'panels'), { recursive: true });
  fs.writeFileSync(path.join(s.d.bk, 'panels'), 'x');
  await assert.rejects(s.l.neu({ spur_id: id, platz: 5, wurzel: 'Lib', rel: 'Sinus.wav' }, 'andreas'));
  fs.rmSync(path.join(s.d.bk, 'panels')); fs.mkdirSync(path.join(s.d.bk, 'panels'));
  fs.copyFileSync(path.join(REPO_BK.paneele, 'amiga.json'), path.join(s.d.bk, 'panels', 'amiga.json'));
  assert.deepEqual(ls(), vorher, 'no bank graph, no slot file left');
  // (b) the session throws
  s.opt.sitzung.aendern = async () => { throw new Error('boom'); };
  await assert.rejects(s.l.neu({ spur_id: id, platz: 5, wurzel: 'Lib', rel: 'Sinus.wav' }, 'andreas'), /boom/);
  assert.deepEqual(ls(), vorher);
  assert.deepEqual(s.z.projekt, projekt);
  assert.equal(s.z.verlauf.length, 0);
});

test('refusals: no slot role, slot 0 and 33, file too long, unknown names, no project, Stop Cypher', async (t) => {
  const s = aufbau(t);
  const id = s.spur('Amiga').id, N = { spur_id: id, platz: 3, wurzel: 'Lib', rel: 'Sinus.wav' };
  for (const n of ['Plain', 'Host']) {
    await refuse(() => s.l.neu({ ...N, spur_id: s.spur(n).id }, 'andreas'), 409, 'keine_plaetze');
    await refuse(() => s.l.leeren({ spur_id: s.spur(n).id, platz: 1 }, 'andreas'), 409, 'keine_plaetze');
    await refuse(async () => s.l.lies(new URL(`http://x/sampler/plaetze?spur_id=${s.spur(n).id}`)), 409, 'keine_plaetze');
  }
  for (const platz of [0, 33, 1.5, '3', undefined]) await refuse(() => s.l.neu({ ...N, platz }, 'andreas'), 400, 'argument_ungueltig');
  await refuse(() => s.l.neu({ ...N, extra: 1 }, 'andreas'), 400, 'argument_unbekannt');
  await refuse(() => s.l.neu({ ...N, rate: 3999 }, 'andreas'), 400, 'argument_ungueltig');
  await refuse(() => s.l.neu({ ...N, rate: 48001 }, 'andreas'), 400, 'argument_ungueltig');
  await refuse(() => s.l.neu({ ...N, rate: 16574, roh: true }, 'andreas'), 400, 'argument_ungueltig');
  await refuse(() => s.l.neu({ ...N, name: 'x'.repeat(23) }, 'andreas'), 400, 'argument_ungueltig');
  await refuse(() => s.l.neu({ ...N, grund: 5 }, 'andreas'), 400, 'argument_ungueltig');
  await refuse(() => s.l.neu({ ...N, spur_id: 's99' }, 'andreas'), 404, 'spur_unbekannt');
  await refuse(() => s.l.neu({ ...N, rel: 'lang.wav' }, 'andreas'), 422, 'zu_lang');
  await refuse(() => s.l.neu({ ...N, rel: '../x.wav' }, 'andreas'), 404, 'quelle_unbekannt');
  await refuse(() => s.l.neu({ ...N, wurzel: 'Nix' }, 'andreas'), 404, 'quelle_unbekannt');
  s.z.gestoppt = true;
  await refuse(() => s.l.neu(N, 'cypher'), 409, 'ki_gestoppt');
  s.z.gestoppt = false;
  s.z.offen = false;
  await refuse(() => s.l.neu(N, 'andreas'), 409, 'kein_projekt');
  // nothing was written by any refusal
  assert.deepEqual(fs.readdirSync(s.d.bk).sort(), ['amiga.json', 'ohne-rolle.json', 'panels', 'samples']);
  assert.ok(!fs.readdirSync(path.join(s.d.bk, 'samples')).some((n) => n.startsWith('smp-')));
  assert.equal(s.z.verlauf.length, 0);
});

test('a refusal of the project removes the bank files and the slot file again', async (t) => {
  const s = aufbau(t);
  const id = s.spur('Amiga').id;
  s.opt.sitzung.aendern = async () => ({ code: 409, j: { fehler: 'rev_veraltet' } });
  const a = await s.l.neu({ spur_id: id, platz: 3, wurzel: 'Lib', rel: 'Sinus.wav' }, 'andreas');
  assert.deepEqual([a.code, a.j.fehler], [409, 'rev_veraltet']);
  assert.deepEqual(fs.readdirSync(s.d.bk).sort(), ['amiga.json', 'ohne-rolle.json', 'panels', 'samples']);
  assert.deepEqual(fs.readdirSync(path.join(s.d.bk, 'panels')), ['amiga.json']);
  assert.ok(!fs.readdirSync(path.join(s.d.bk, 'samples')).some((n) => n.startsWith('smp-')));
});

// ---- loopPlaetze: a loop deck sounds on the channel of the place that shows it ----
import { loopPlaetze, loopPlatzAbweichung } from '../public/slots.js';
test('loopPlaetze: the place (1..4) of each loop deck, null when no place shows it', () => {
  assert.deepEqual(loopPlaetze(['loops', 'track', 'strudel', 'loops2']), { 1: 1, 2: 4 });
  assert.deepEqual(loopPlaetze(['track', 'track', 'loops2', 'loops']), { 1: 4, 2: 3 });
  assert.deepEqual(loopPlaetze(['track', 'loops', 'strudel', 'seq']), { 1: 2, 2: null });
  assert.deepEqual(loopPlaetze(['track', 'track', 'strudel', 'seq']), { 1: null, 2: null });
});
test('loopPlatzAbweichung: a body only when a present deck sounds elsewhere than its place; absent decks and unshown decks are left alone', () => {
  const projekt = (d1, d2) => ({ gruppen: [
    ...(d1 === undefined ? [] : [{ loopdeck: { platz: 1, raster: 'takt', ...(d1 ? { ausgang_platz: d1 } : {}) } }]),
    ...(d2 === undefined ? [] : [{ loopdeck: { platz: 2, raster: 'takt', ...(d2 ? { ausgang_platz: d2 } : {}) } }]) ] });
  const L = ['track', 'track', 'loops', 'loops2'];
  assert.equal(loopPlatzAbweichung(L, projekt(0, 0)), null, 'defaults 3 and 4: already there');
  assert.deepEqual(loopPlatzAbweichung(['loops2', 'track', 'track', 'loops'], projekt(0, 0)), { 1: 4, 2: 1 }, 'both move: one request');
  assert.deepEqual(loopPlatzAbweichung(['loops', 'track', 'track', 'seq'], projekt(0, 0)), { 1: 1, 2: null }, 'deck 2 is not shown: untouched');
  assert.equal(loopPlatzAbweichung(['loops', 'track', 'track', 'seq'], projekt(1, 0)), null);
  assert.equal(loopPlatzAbweichung(['track', 'track', 'track', 'seq'], projekt(0, 0)), null, 'none shown');
  assert.equal(loopPlatzAbweichung(['loops', 'track', 'track', 'seq'], projekt(undefined, 0)), null);
  assert.equal(loopPlatzAbweichung(L, null), null);
});
test('loopPlatzAbweichung: an unshown deck that holds the channel the shown deck needs moves to the other loop pad (studio 2026-11-20: LOOP 1 in place 4)', () => {
  const projekt = (d1, d2) => ({ gruppen: [{ loopdeck: { platz: 1, raster: 'takt', ...(d1 ? { ausgang_platz: d1 } : {}) } },
    { loopdeck: { platz: 2, raster: 'takt', ...(d2 ? { ausgang_platz: d2 } : {}) } }] });
  assert.deepEqual(loopPlatzAbweichung(['track', 'seq', 'strudel', 'loops'], projekt(0, 0)), { 1: 4, 2: 3 }, 'deck 2 gives up L2');
  assert.deepEqual(loopPlatzAbweichung(['track', 'seq', 'loops2', 'strudel'], projekt(0, 0)), { 1: 4, 2: 3 }, 'deck 1 gives up L1');
  assert.deepEqual(loopPlatzAbweichung(['loops', 'seq', 'strudel', 'track'], projekt(0, 0)), { 1: 1, 2: null }, 'a deck channel takes nothing from deck 2');
  assert.equal(loopPlatzAbweichung(['track', 'seq', 'strudel', 'loops'], projekt(4, 3)), null, 'already moved');
});
