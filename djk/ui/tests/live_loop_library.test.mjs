// DJ view places task 10: POST /modul/loop {name, slot?}: a loop of the loop library becomes a module of the live container. Same set-up as
// live_export.test.mjs (real proj session, real stems child with the test separators); the loop library is a temp folder.
import baseTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { Stems } from '../areas/proj/stems.ts';
import { liveBereich } from '../areas/live/export.ts';
import { pythonVorgabe } from '../server.ts';
import { REPO_PFADE } from '../paths.ts';
import { OHNE_STEMS_PYTHON } from './support/stems_voraussetzung.mjs';

const test = (name, a, b) => (typeof a === 'function' ? baseTest(name, { skip: OHNE_STEMS_PYTHON }, a) : baseTest(name, { ...a, skip: a.skip || OHNE_STEMS_PYTHON }, b));
const BEAT = 22500;
const SHA = 'b'.repeat(64);

// a loop folder like the core and schreibeLoopAusFassung write it; the frames are a ramp so the WAV can be compared frame for frame
function schreibeLoop(dir, name, beats, extra = {}) {
  const frames = beats * BEAT, b = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) { b.writeFloatLE(((i % 1000) - 500) / 2000, i * 8); b.writeFloatLE(((i * 3) % 1000 - 500) / 2000, i * 8 + 4); }
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'loop.f32'), b);
  fs.writeFileSync(path.join(dir, name, 'loop.json'), JSON.stringify({ schema: 1, name, beats, bpm: 128, frames, datei: 'loop.f32', quelle: 'deck', erstellt: '2026-11-13 10:00', ...extra }));
  return b;
}

async function aufbauLoop(t, { trenner = 'gpu_belegt', live = true, kanalOffen = () => false } = {}) {
  const r = await aufbau(t, { mitKick: false });
  const lib = path.join(r.tmp, 'loopbib');
  fs.mkdirSync(lib);
  const opt = { python: pythonVorgabe(), cwd: REPO_PFADE.werkstatt, zusatzArgs: ['--trenner', trenner], killMs: 2000 };
  const stems = new Stems(r.ctx, r.zugang, opt);
  t.after(() => stems.schliesse());
  stems.ereignis('/zustand/kern', { generation: 1, quantum: 256, ki_gestoppt: 0 });
  const kat = { sha: SHA, typ: 'track', titel: 'Song', kuenstler: 'Art', bpm: 126, camelot: '8A' };
  const kanaele = { offen: kanalOffen };
  const b = liveBereich(r.ctx, r.zugang, stems, { kanalOffen: (k) => kanaele.offen(k), loopOrdner: () => lib,
    deckLoop: () => ({ code: 409, fehler: 'kein_loop' }), herkunft: (m) => (m === SHA.slice(0, 16) ? kat : null) });
  if (live) assert.equal((await r.s.liveOeffnen('andreas')).code, 200);
  const projekt = () => r.s.aktuell().j.projekt;
  const fehl = async (f) => { try { await f(); } catch (e) { return { code: e.code, fehler: e.fehler, text: e.extra?.text }; } assert.fail('no refusal'); };
  const ende = async (s = 'A') => {
    assert.ok(await warteBis(() => b.modul.stand()[s].stems.stems !== 'wartet' && b.modul.stand()[s].stems.stems !== 'laeuft', 60000), JSON.stringify(b.modul.stand()[s]));
    return b.modul.stand()[s].stems;
  };
  return { ...r, b, lib, kanaele, projekt, fehl, ende, laden: (d, q = 'andreas') => b.modul.ladeLoop(d, q) };
}
const top = (p, slot = 'A') => p.gruppen.find((g) => g.ausgang === undefined && g.modul?.slot === slot);

test('an imported loop becomes a module: WAV equals the loop frames, basis_bpm 128, eins_beat from versatz_frames, origin copied', async (t) => {
  const z = await aufbauLoop(t);
  const roh = schreibeLoop(z.lib, 'imp', 4, { quelle: 'import', versatz_frames: 22500 * 1.5,
    herkunft: { quelle: 'mediathek', sha: SHA, pfad: '/x/y.wav', bpm: 126, takte: 1 } });
  const a = await z.laden({ name: 'imp', slot: 'A' });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual([a.j.slot, a.j.laenge_beats, a.j.frames], ['A', 4, 4 * BEAT]);
  const g = top(z.projekt());
  assert.equal(g.name, 'A · imp');
  assert.equal(g.fader_db, 0);
  assert.deepEqual([g.modul.quelle_sha256, g.modul.basis_bpm, g.modul.bpm, g.modul.von_beat, g.modul.laenge_beats, g.modul.eins_beat, g.modul.fassung, g.modul.quelle],
    [SHA, 128, 128, 0, 4, 1.5, '0', undefined]);
  const clip = z.projekt().spuren.find((s) => s.name === 'Loop').clips.at(-1);
  const wav = fs.readFileSync(clip.quelle.pfad_hinweis);
  assert.equal(wav.length, 58 + roh.length);
  assert.ok(wav.subarray(58).equals(roh), 'frames differ from the loop');
  assert.equal(path.dirname(clip.quelle.pfad_hinweis), path.join(z.offen().ordner, 'loops'));
  assert.equal(z.projekt().spuren.find((s) => s.name === 'Loop').mute, false);
});

test('a recorded loop gets the placeholder sha and quelle mitschnitt; a deck loop keeps the catalogue origin', async (t) => {
  const z = await aufbauLoop(t);
  schreibeLoop(z.lib, 'rec', 2, { quelle: 'mitschnitt' });
  schreibeLoop(z.lib, 'dk', 4, { herkunft: { material_id: SHA.slice(0, 16), fassung: 3, quell_beat: 8 } });
  assert.equal((await z.laden({ name: 'rec', slot: 1 })).code, 200);
  const g = top(z.projekt());
  assert.deepEqual([g.modul.quelle_sha256, g.modul.quelle, g.modul.laenge_beats, g.modul.eins_beat], ['0'.repeat(64), 'mitschnitt', 2, undefined]);
  assert.equal((await z.laden({ name: 'dk', slot: 2 })).code, 200);
  const h = top(z.projekt(), 'B');
  assert.deepEqual([h.modul.quelle_sha256, h.modul.fassung, h.modul.kuenstler, h.modul.tonart, h.modul.quelle], [SHA, '3', 'Art', '8A', undefined]);
});

test('slot 1, 2, A and B all work and mean the same', async (t) => {
  for (const [wunsch, soll] of [[1, 'A'], [2, 'B'], ['A', 'A'], ['B', 'B']]) {
    const z = await aufbauLoop(t);
    schreibeLoop(z.lib, 'l', 1);
    const a = await z.laden({ name: 'l', slot: wunsch });
    assert.equal(a.j.slot, soll, `slot ${wunsch}`);
    assert.ok(top(z.projekt(), soll), `module in ${soll}`);
  }
  const z = await aufbauLoop(t);
  schreibeLoop(z.lib, 'l', 1);
  assert.equal((await z.fehl(() => z.laden({ name: 'l', slot: 'C' }))).fehler, 'slot_ungueltig');
  assert.equal((await z.fehl(() => z.laden({ name: 'l', slot: 3 }))).fehler, 'slot_ungueltig');
  assert.equal((await z.laden({ name: 'l' })).j.slot, 'A', 'no slot: the first free one');
});

test('an occupied slot is slot_belegt, an unknown name loop_unbekannt, no live project kein_liveprojekt', async (t) => {
  const z = await aufbauLoop(t);
  schreibeLoop(z.lib, 'l', 1);
  assert.equal((await z.laden({ name: 'l', slot: 'A' })).code, 200);
  assert.equal((await z.fehl(() => z.laden({ name: 'l', slot: 'A' }))).fehler, 'slot_belegt');
  assert.equal((await z.fehl(() => z.laden({ name: 'gibtsnicht', slot: 'B' }))).fehler, 'loop_unbekannt');
  assert.equal((await z.fehl(() => z.laden({ name: '../x', slot: 'B' }))).fehler, 'loop_unbekannt');
  const n = await aufbauLoop(t, { live: false });
  schreibeLoop(n.lib, 'l', 1);
  assert.equal((await n.fehl(() => n.laden({ name: 'l' }))).fehler, 'kein_liveprojekt');
});

test('an open channel refuses with kanal_offen and creates no group and no file in the project folder', async (t) => {
  const z = await aufbauLoop(t, { kanalOffen: (k) => k === 'pad/1' });
  schreibeLoop(z.lib, 'l', 1);
  const vor = z.projekt().gruppen.length;
  const f = await z.fehl(() => z.laden({ name: 'l', slot: 'A' }));
  assert.equal(f.fehler, 'kanal_offen');
  assert.equal(z.projekt().gruppen.length, vor);
  const loops = path.join(z.offen().ordner, 'loops');
  assert.deepEqual(fs.existsSync(loops) ? fs.readdirSync(loops) : [], []);
  assert.equal((await z.laden({ name: 'l' })).j.slot, 'B', 'no slot: the closed channel is taken');
});

test('without a free GPU the module sounds through its loop track and the state says separation waits (no error)', async (t) => {
  const z = await aufbauLoop(t, { trenner: 'gpu_belegt' });
  schreibeLoop(z.lib, 'l', 4);
  const a = await z.laden({ name: 'l', slot: 'A' });
  assert.equal(a.code, 200);
  const e = await z.ende('A');
  assert.equal(e.stems, 'fehler');
  assert.equal(e.grund, 'gpu_belegt');
  const p = z.projekt();
  assert.equal(p.spuren.find((s) => s.name === 'Loop').mute, false, 'still audible through the loop track');
  assert.equal(p.gruppen.filter((g) => g.ausgang).length, 0);
});

test('the other slot verbs take 1/2 as well: modul/stems with slot 2 on an empty slot is slot_leer, a bad slot argument_ungueltig', async (t) => {
  const z = await aufbauLoop(t);
  schreibeLoop(z.lib, 'l', 1);
  assert.equal((await z.laden({ name: 'l', slot: 1 })).code, 200);
  assert.equal((await z.fehl(() => z.b.modul.stemsNeu({ slot: 2 }, 'andreas'))).fehler, 'slot_leer');
  assert.equal((await z.fehl(() => z.b.modul.stemsNeu({ slot: 'C' }, 'andreas'))).fehler, 'argument_ungueltig');
});
