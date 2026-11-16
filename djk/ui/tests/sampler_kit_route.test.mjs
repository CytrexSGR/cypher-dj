// Sampler B task 2: the routes GET /sampler/kit/vorschlag and POST /sampler/kit through the real server (kern stand-in), and the proof that the kit picker,
// the drum grid rows and both Strudel name resolutions (the live generator's, the clip path's) see a kit made from slices. The cut store, the graph
// folder, the loop library and the kit folder are temp folders, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { bis, ruf, CYPHER } from './support/proj_stack.mjs';
import { samplerKitBereich } from '../areas/sampler/kit_routes.ts';
import { samplerBereich } from '../areas/sampler/area.ts';
import { kitKlaenge } from '../areas/proj/kits.ts';
import { geraetInfo } from '../areas/live/seq.ts';
import { wendeMusterAn } from '../project/pattern_clip.ts';
import { ladeKit, noteFuer } from '../../generator/src/kit.mjs';

// a loop of `beats` beats, frame i = (i, -i)
function schreibeLoop(loops, name, beats) {
  const frames = beats * 22500, f = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { f[2 * i] = i; f[2 * i + 1] = -i; }
  fs.mkdirSync(path.join(loops, name));
  fs.writeFileSync(path.join(loops, name, 'loop.f32'), Buffer.from(f.buffer));
  fs.writeFileSync(path.join(loops, name, 'loop.json'), JSON.stringify({ schema: 1, bpm: 128, beats, frames, datei: 'loop.f32', quelle: 'test', erstellt: '2026-11-16T10:00:00Z' }));
}
// a cut written by hand (frames of a slice = bounds), for the case that no source makes: a slice longer than 10 s
function schreibeSchnitt(d, id, grenzen) {
  fs.mkdirSync(path.join(d.sampler, id), { recursive: true });
  fs.mkdirSync(path.join(d.bk, 'samples'), { recursive: true });
  fs.writeFileSync(path.join(d.sampler, id, 'schnitt.json'), JSON.stringify({
    schema: 1, id, name: 'Long Cut', quelle: { art: 'loop', ref: 'l4' }, bpm: 128, beats: 4, frames: grenzen[grenzen.length - 1], methode: 'raster', grenzen,
    guete: grenzen.slice(1).map(() => ({ staerke: null, raster_abstand_beats: 0 })), erstellt: '2026-11-16T10:00:00Z',
  }));
  fs.writeFileSync(path.join(d.bk, 'samples', `smp-${id}.f32`), Buffer.alloc(grenzen[grenzen.length - 1] * 8));
}

async function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-b2-'));
  const d = { root, loops: path.join(root, 'loops'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk'), kits: path.join(root, 'kits') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  const vars = { CYPHERDJ_BK_ORDNER: d.bk, CYPHERDJ_SAMPLER: d.sampler, CYPHERDJ_KIT_ORDNER: d.kits };
  const alt = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  schreibeLoop(d.loops, 'l4', 4);
  const s = await stapel(t, { loops: d.loops });
  s.optionen.samplerOrdner = d.sampler;      // read at each request
  const schnitt = async () => {
    const r = await ruf(s.url, 'POST', '/sampler/schnitt', { quelle: { art: 'loop', ref: 'l4' }, name: 'Amen Break', scheiben: 4 });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    return r.j.schnitt.id;
  };
  return { ...s, d, schnitt };
}
const kitsDa = (d) => fs.readdirSync(d.kits).sort();

test('the routes of the Bereich', () => {
  const b = samplerKitBereich({ log() {}, quelle: () => 'andreas', kiGestoppt: () => false }, {});
  assert.equal(b.name, 'sampler-kit');
  assert.deepEqual(b.routen().map((r) => `${r.methode} ${r.pfad} ${r.schutz}`), ['GET /sampler/kit/vorschlag offen', 'POST /sampler/kit fremdePost']);
  // the route list of samplerBereich stays as plan A1 pinned it
  const s = samplerBereich({ log() {}, quelle: () => 'andreas', kiGestoppt: () => false }, { sitzung: {}, zugang: {}, loops: '', module: '' });
  assert.ok(!s.routen().some((r) => r.pfad.startsWith('/sampler/kit')));
});

test('vorschlag proposes a free name and a bank per slice; POST writes the kit', async (t) => {
  const z = await aufbau(t);
  const id = await z.schnitt();
  const v = (await ruf(z.url, 'GET', `/sampler/kit/vorschlag?id=${id}&scheiben=0,2`)).j;
  assert.deepEqual(v.klaenge.map((k) => [k.scheibe, k.note]), [[0, 36], [2, 37]]);
  assert.equal(v.kit, 'amen-break');
  assert.deepEqual(v.klaenge.map((k) => [k.frames, k.zu_lang]), [[22500, false], [22500, false]]);
  assert.deepEqual(kitsDa(z.d), [], 'a proposal writes nothing');
  const w = await ruf(z.url, 'POST', '/sampler/kit', { id, scheiben: [0, 2], banken: ['bd', 'sd'], kit: 'brk' });
  assert.equal(w.code, 200, JSON.stringify(w.j));
  assert.deepEqual(w.j.klaenge.map((k) => k.name), ['bd:0', 'sd:0']);
  assert.deepEqual(w.j.klaenge.map((k) => [k.scheibe, k.note, k.datei, k.frames]), [[0, 36, '36.f32', 22500], [2, 37, '37.f32', 22500]]);
  assert.equal(w.j.kit, 'brk');
  assert.deepEqual(fs.readdirSync(path.join(z.d.kits, 'brk')).sort(), ['36.f32', '37.f32', 'kit.json']);
  // without a name and banks: the next free name and the proposal
  const w2 = await ruf(z.url, 'POST', '/sampler/kit', { id, scheiben: [1] });
  assert.equal(w2.code, 200, JSON.stringify(w2.j));
  assert.equal(w2.j.kit, 'amen-break');
  assert.equal((await ruf(z.url, 'GET', `/sampler/kit/vorschlag?id=${id}&scheiben=0`)).j.kit, 'amen-break-2');
});

test('the kit picker lists it, the drum grid names its rows, Strudel names resolve (G6, G7)', async (t) => {
  const z = await aufbau(t);
  const id = await z.schnitt();
  const w = await ruf(z.url, 'POST', '/sampler/kit', { id, scheiben: [0, 2], banken: ['bd', 'sd'], kit: 'brk' });
  assert.equal(w.code, 200, JSON.stringify(w.j));
  assert.ok((await ruf(z.url, 'GET', '/proj/kits')).j.kits.some((k) => k.name === 'brk' && k.klaenge === 2));
  assert.deepEqual(geraetInfo({ art: 'intern', name: 'kit', kit: 'brk' }).klaenge, [{ ton: 36, name: 'bd:0' }, { ton: 37, name: 'sd:0' }]);
  // the live generator's resolution (generator/src/kit.mjs)
  const kit = ladeKit(path.join(z.d.kits, 'brk'));
  assert.deepEqual([noteFuer(kit, 'bd'), noteFuer(kit, { s: 'sd', n: 0 })], [36, 37]);
  // the clip path: one event {s: 'sd'} on a kit track of brk becomes a note with ton 37
  const erg = { ok: true, takte: 1, laenge_beats: 4, loop_beats: null, periode_takte: null, stetig: [], komplex: [], hinweise: [],
    ereignisse: [{ beat: 0, laenge: 1, ton: null, werte: { s: 'bd' } }, { beat: 2, laenge: 1, ton: null, werte: { s: 'sd' } }] };
  const klaenge = kitKlaenge('brk');
  assert.deepEqual(klaenge, [{ note: 36, name: 'bd:0' }, { note: 37, name: 'sd:0' }]);
  const r = wendeMusterAn(erg, {}, klaenge, 'brk', () => 0);
  assert.ok(!('grund' in r), JSON.stringify(r));
  assert.deepEqual(r.noten.map((n) => [n.beat, n.ton]), [[0, 36], [2, 37]]);
  // a name that the kit does not have is refused with the kit's own sounds named
  const falsch = wendeMusterAn({ ...erg, ereignisse: [{ beat: 0, laenge: 1, ton: null, werte: { s: 'hh' } }] }, {}, klaenge, 'brk', () => 0);
  assert.ok('grund' in falsch && falsch.grund === 'klang_unbekannt' && falsch.text.includes('bd, sd'), JSON.stringify(falsch));
});

test('refusals: existing kit, too long, Stop Cypher, unknown key', async (t) => {
  const z = await aufbau(t);
  const id = await z.schnitt();
  const ok = await ruf(z.url, 'POST', '/sampler/kit', { id, scheiben: [0], kit: 'brk' });
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  const vorher = fs.readFileSync(path.join(z.d.kits, 'brk', 'kit.json'), 'utf8');
  const nein = async (koerper, code, fehler, kopf, text) => {
    const r = await ruf(z.url, 'POST', '/sampler/kit', koerper, kopf);
    assert.deepEqual([r.code, r.j.fehler], [code, fehler], JSON.stringify(r.j));
    if (text !== undefined) assert.ok(r.j.text.includes(text), r.j.text);
    return r;
  };
  const r = await nein({ id, scheiben: [1], kit: 'brk' }, 409, 'kit_vorhanden');
  assert.ok(typeof r.j.text === 'string' && r.j.text.length > 5, 'an English text');
  assert.equal(fs.readFileSync(path.join(z.d.kits, 'brk', 'kit.json'), 'utf8'), vorher);
  // a folder without kit.json counts as existing
  fs.mkdirSync(path.join(z.d.kits, 'leer'));
  await nein({ id, scheiben: [1], kit: 'leer' }, 409, 'kit_vorhanden');
  assert.deepEqual(fs.readdirSync(path.join(z.d.kits, 'leer')), []);
  await nein({ id, scheiben: [0], x: 1 }, 400, 'argument_unbekannt');
  await nein({ id, scheiben: [0], banken: ['BD'], kit: 'neu' }, 400, 'argument_ungueltig');
  await nein({ id, scheiben: [0], banken: ['bd:1'], kit: 'neu' }, 400, 'argument_ungueltig', undefined, 'write the bank only');
  await nein({ scheiben: [0] }, 400, 'argument_ungueltig');
  await nein({ id: 'nix-0000', scheiben: [0] }, 404, 'schnitt_unbekannt');
  await nein({ id, scheiben: [9] }, 400, 'argument_ungueltig');
  await nein({ id, scheiben: [] }, 400, 'argument_ungueltig');
  // a slice longer than 10 s: the proposal marks it, the writer refuses it and writes nothing
  schreibeSchnitt(z.d, 'long-0001', [0, 480001, 480011]);
  const v = (await ruf(z.url, 'GET', '/sampler/kit/vorschlag?id=long-0001&scheiben=0,1')).j;
  assert.deepEqual(v.klaenge.map((k) => k.zu_lang), [true, false]);
  await nein({ id: 'long-0001', scheiben: [0, 1], kit: 'lang' }, 400, 'klang_zu_lang', undefined, 'slice 1');
  assert.deepEqual(kitsDa(z.d), ['brk', 'leer']);
  // the proposal's refusals
  for (const [pfad, code, fehler] of [['/sampler/kit/vorschlag', 400, 'argument_ungueltig'], [`/sampler/kit/vorschlag?id=${id}`, 400, 'argument_ungueltig'],
    [`/sampler/kit/vorschlag?id=${id}&scheiben=a,b`, 400, 'argument_ungueltig'], [`/sampler/kit/vorschlag?id=${id}&scheiben=7`, 400, 'argument_ungueltig'],
    ['/sampler/kit/vorschlag?id=nix-0000&scheiben=0', 404, 'schnitt_unbekannt']]) {
    const g = await ruf(z.url, 'GET', pfad);
    assert.deepEqual([g.code, g.j.fehler], [code, fehler], pfad);
  }
  // Stop Cypher: Cypher's write is refused, Andreas' goes on, reading stays open
  const ctx = z.o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(z.o).kiGestoppt));
  await nein({ id, scheiben: [0], kit: 'cyp' }, 409, 'ki_gestoppt', CYPHER);
  assert.deepEqual(kitsDa(z.d), ['brk', 'leer']);
  assert.equal((await ruf(z.url, 'GET', `/sampler/kit/vorschlag?id=${id}&scheiben=0`, undefined, CYPHER)).code, 200);
  assert.equal((await ruf(z.url, 'POST', '/sampler/kit', { id, scheiben: [0], kit: 'andreas' })).code, 200);
});

test('a kit that is being written (sounds, no kit.json) is not listed by GET /proj/kits', async (t) => {
  const z = await aufbau(t);
  fs.mkdirSync(path.join(z.d.kits, 'halb'));
  fs.writeFileSync(path.join(z.d.kits, 'halb', '36.f32'), Buffer.alloc(80));
  fs.mkdirSync(path.join(z.d.kits, 'halb', '.sperre'));
  assert.deepEqual((await ruf(z.url, 'GET', '/proj/kits')).j.kits, []);
  const id = await z.schnitt();
  assert.equal((await ruf(z.url, 'POST', '/sampler/kit', { id, scheiben: [0], kit: 'fertig' })).code, 200);
  assert.deepEqual((await ruf(z.url, 'GET', '/proj/kits')).j.kits, [{ name: 'fertig', klaenge: 1 }]);
});
