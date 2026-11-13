// Plan live-module task 2: the loop cue export. The deck side (active loop, rendering file, catalogue) is a double; everything else is real: the proj
// session, the dekodier cache, the real stems child process with the test separators (identitaet, identitaet_vier, gpu_belegt) like proj_stems.test.mjs.
import baseTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { Stems } from '../areas/proj/stems.ts';
import { liveBereich } from '../areas/live/export.ts';
import { schneideAusFassung, schreibeLoopAusFassung } from '../loops.ts';
import { pythonVorgabe } from '../server.ts';
import { REPO_PFADE } from '../paths.ts';

import { OHNE_GPU, OHNE_STEMS_PYTHON } from './support/stems_voraussetzung.mjs';   // no GPU, or a Python without the werkstatt: skipped, not hung
// The tests start the real stem child (werkstatt.stems); with a Python that cannot import it none of them can run.
const test = (name, a, b) => (typeof a === 'function' ? baseTest(name, { skip: OHNE_STEMS_PYTHON }, a) : baseTest(name, { ...a, skip: a.skip || OHNE_STEMS_PYTHON }, b));
const RATE = 24000;                                  // frames per beat at 120 bpm
const SHA = 'a'.repeat(64), MID = SHA.slice(0, 16);
const BASIS_FRAMES = 12 * RATE;

// a rendering file of stereo float32 frames whose value tells the frame (a ramp), so the cut can be compared frame for frame
function basisDatei(dir) {
  const b = Buffer.alloc(BASIS_FRAMES * 8);
  for (let i = 0; i < BASIS_FRAMES; i++) { b.writeFloatLE(((i % 2000) - 1000) / 4000, i * 8); b.writeFloatLE(((i * 7) % 2000 - 1000) / 4000, i * 8 + 4); }
  const f = path.join(dir, 'basis.f32');
  fs.writeFileSync(f, b);
  return f;
}

async function modulAufbau(t, { trenner = 'identitaet', loop = {}, katalog = {}, live = true } = {}) {
  const r = await aufbau(t, { mitKick: false });
  const dir = path.join(r.tmp, 'deckdaten');
  fs.mkdirSync(dir);
  const basis = basisDatei(dir);
  const opt = { python: pythonVorgabe(), cwd: REPO_PFADE.werkstatt, zusatzArgs: ['--trenner', trenner], killMs: 2000 };
  const stems = new Stems(r.ctx, r.zugang, opt);
  t.after(() => stems.schliesse());
  stems.ereignis('/zustand/kern', { generation: 1, quantum: 256, ki_gestoppt: 0 });
  const deck = { deck: 1, material_id: MID, basis_bpm: 120, fassung: 1, basisDatei: basis, startFrame: 3 * RATE + 17, frames: 4 * RATE, laenge_beats: 4, von_beat: 5, ...loop };
  const zeile = { sha: SHA, typ: 'track', titel: 'Song', kuenstler: 'Art', bpm: 120, camelot: '8A', ...katalog };
  const ruf = { deck: () => ({ ...deck }), herkunft: () => zeile };
  const nach = [];
  const b = liveBereich(r.ctx, r.zugang, stems, { deckLoop: (d) => ruf.deck(d), herkunft: (m) => ruf.herkunft(m), nachExport: (e) => { nach.push(e); } });
  if (live) assert.equal((await r.s.liveOeffnen('andreas')).code, 200);
  const projekt = () => r.s.aktuell().j.projekt;
  const fehl = async (f) => { try { await f(); } catch (e) { return { code: e.code, fehler: e.fehler, text: e.extra?.text }; } assert.fail('no refusal'); };
  const stand = (s = 'A') => b.modul.stand()[s];
  const ende = async (s = 'A', ms = 60000) => {
    assert.ok(await warteBis(() => stand(s).stems.stems !== 'wartet' && stand(s).stems.stems !== 'laeuft', ms), JSON.stringify(stand(s)));
    return stand(s).stems;
  };
  // waits until the separation runs and cancels it (the slow test separator), so no child outlives the test
  const abbruch = async (s = 'A') => {
    assert.ok(await warteBis(() => stand(s).stems.stems === 'laeuft', 20000), JSON.stringify(stand(s)));
    stems.abbrechen({ auftrag_id: stand(s).stems.auftrag_id });
    await ende(s);
  };
  return { ...r, abbruch, b, m: b.modul, opt, deck, ruf, nach, projekt, fehl, stand, ende, basis, stems,
    export: (d = {}, q = 'andreas') => b.modul.exportiere({ deck: 1, ...d }, q), neu: (d, q = 'andreas') => b.modul.stemsNeu(d, q) };
}
const top = (p, slot = 'A') => p.gruppen.find((g) => g.ausgang === undefined && g.modul?.slot === slot);
const kinder = (p, id) => p.gruppen.filter((g) => g.ausgang?.id === id);

test('export answers with a loop-only module: top group with modul.slot, Loop unmuted, fader -200, warp markers and bar phase', async (t) => {
  const z = await modulAufbau(t, { trenner: 'langsam' });                       // slow separator: the loop-only state stays visible
  const a = await z.export();
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.slot, 'A');
  const p = z.projekt();
  const g = top(p);
  assert.equal(g.name, 'A · Song');
  assert.equal(g.fader_db, -200);
  assert.deepEqual([g.modul.titel, g.modul.kuenstler, g.modul.quelle_sha256, g.modul.basis_bpm, g.modul.fassung, g.modul.von_beat, g.modul.laenge_beats, g.modul.tonart, g.modul.bpm],
    ['Song', 'Art', SHA, 120, '1', 5, 4, '8A', 120]);
  assert.equal(kinder(p, g.id).length, 0);
  const loop = p.spuren.find((s) => s.name === 'Loop');
  assert.equal(loop.ausgang.id, g.id);
  assert.equal(loop.mute, false);
  const [kopf, haupt] = [...loop.clips].sort((x, y) => x.start_beat - y.start_beat);
  assert.deepEqual([kopf.start_beat, kopf.laenge_beats, kopf.warp.versatz_beats], [0, 1, 3]);   // p = 5 mod 4 = 1, L = 4: lead-in plays beat 3..4 of the loop
  assert.deepEqual([haupt.start_beat, haupt.laenge_beats, haupt.loop_beats], [1, 63, 4]);
  assert.deepEqual(haupt.warp.marker, [[0, 0], [2, 4]]);
  assert.equal(z.nach.length, 1, 'the hook for the module store ran once');
  assert.equal(z.nach[0].slot, 'A');
  assert.equal(z.nach[0].gruppeId, g.id);
  assert.equal(a.j.stand.stems.stems, 'wartet');
  assert.ok(await warteBis(() => z.stand().stems.stems === 'laeuft', 20000), JSON.stringify(z.stand()));
  assert.equal(z.projekt().spuren.find((s) => s.name === 'Loop').mute, false, 'still audible while the separation runs');
  assert.equal(z.projekt().gruppen.filter((x) => x.ausgang).length, 0);
  await z.abbruch();
});

test('the exported WAV equals the deck loop section sample for sample, and the cut is the one of the loop library', async (t) => {
  const z = await modulAufbau(t, { trenner: 'langsam' });
  await z.export();
  const p = z.projekt();
  const clip = p.spuren.find((s) => s.name === 'Loop').clips[0];
  const wav = fs.readFileSync(clip.quelle.pfad_hinweis);
  const soll = fs.readFileSync(z.basis).subarray(z.deck.startFrame * 8, (z.deck.startFrame + z.deck.frames) * 8);
  assert.equal(wav.length, 58 + z.deck.frames * 8);
  assert.ok(wav.subarray(58).equals(soll), 'frames differ from the rendering section');
  assert.equal(path.dirname(clip.quelle.pfad_hinweis), path.join(z.offen().ordner, 'loops'));
  // same code as deck/loop/sichern: schreibeLoopAusFassung writes exactly schneideAusFassung
  const dir = path.join(z.tmp, 'bibliothek');
  fs.mkdirSync(dir);
  schreibeLoopAusFassung({ basis: z.basis, dir, name: 'x-1b', startFrame: z.deck.startFrame, frames: z.deck.frames, bpm: 120, beats: 4, herkunft: {} });
  assert.ok(fs.readFileSync(path.join(dir, 'x-1b', 'loop.f32')).equals(schneideAusFassung(z.basis, z.deck.startFrame, z.deck.frames)));
  assert.ok(fs.readFileSync(path.join(dir, 'x-1b', 'loop.f32')).equals(soll));
  // a cut that reaches over the file end is silence there, like the library loop
  const ueber = schneideAusFassung(z.basis, BASIS_FRAMES - 10, 20);
  assert.equal(ueber.length, 160);
  assert.ok(ueber.subarray(80).every((x) => x === 0));
  await z.abbruch();
});

test('stems follow: four stems give four child groups, Loop muted, module fader and original faders as built, one undo step back to loop-only', { skip: OHNE_GPU }, async (t) => {
  const z = await modulAufbau(t, { trenner: 'identitaet_vier' });
  await z.export();
  const e = await z.ende();
  assert.equal(e.stems, 'fertig', JSON.stringify(e));
  const p = z.projekt();
  const g = top(p);
  assert.deepEqual(kinder(p, g.id).map((x) => x.name), ['Drums', 'Bass', 'Other', 'Vocals']);
  assert.equal(p.spuren.find((s) => s.name === 'Loop').mute, true);
  assert.equal(g.fader_db, -200);
  for (const k of kinder(p, g.id)) {
    const o = p.spuren.find((s) => s.ausgang?.id === k.id);
    assert.deepEqual([o.name, o.fader_db, o.mute, o.clips.length], [`${k.name} original`, 0, false, 2], k.name);
    assert.equal(o.clips[0].laenge_beats + o.clips[1].laenge_beats, 64);
  }
  assert.ok(await warteBis(() => z.projekt().spuren.every((s) => s.clips.every((c) => c.dekodiert === 'fertig')), 20000), 'stems decoded');
  // the stems are real files of the live project, with the loop's frame count
  const wavs = fs.readdirSync(path.join(z.offen().ordner, 'stems'));
  assert.equal(wavs.length, 4);
  for (const w of wavs) assert.equal(fs.statSync(path.join(z.offen().ordner, 'stems', w)).size, 58 + z.deck.frames * 8, w);
  assert.equal(z.protokoll.uebernommen.filter((u) => u.label.startsWith('Stems module')).length, 1, 'one project change for all stems');
  await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas');
  const nach = z.projekt();
  assert.equal(kinder(nach, top(nach).id).length, 0);
  assert.equal(nach.spuren.find((s) => s.name === 'Loop').mute, false);
  assert.equal(nach.spuren.length, 1);
  assert.equal(fs.readdirSync(z.arbeitsordner).filter((f) => f.startsWith('stems-')).length, 0, 'temp gone');
});

test('stems follow with guitar and piano: six child groups', { skip: OHNE_GPU }, async (t) => {
  const z = await modulAufbau(t, { trenner: 'identitaet' });
  await z.export({ slot: 'B' });
  assert.equal((await z.ende('B')).stems, 'fertig');
  const p = z.projekt();
  assert.deepEqual(kinder(p, top(p, 'B').id).map((x) => x.name), ['Drums', 'Bass', 'Other', 'Vocals', 'Guitar', 'Piano']);
  assert.equal(top(p, 'B').name, 'B · Song');
});

test('slot rules: an occupied slot is slot_belegt, without a slot A then B, then both are taken', async (t) => {
  const z = await modulAufbau(t, { trenner: 'identitaet_vier' });
  assert.equal((await z.export()).j.slot, 'A');
  const e = await z.fehl(() => z.export({ slot: 'A' }));
  assert.deepEqual([e.code, e.fehler], [409, 'slot_belegt']);
  assert.match(e.text, /^[\x20-\x7e]+$/);
  assert.match(e.text, /live slot A/);
  assert.equal((await z.export()).j.slot, 'B');
  const e2 = await z.fehl(() => z.export());
  assert.deepEqual([e2.code, e2.fehler], [409, 'slot_belegt']);
  assert.equal(z.projekt().gruppen.filter((g) => g.modul).length, 2, 'refusals changed nothing');
  await warteBis(() => z.stand('A').stems.stems !== 'wartet', 30000);
});

test('refusals: no loop, no library track, no live container, bad arguments; nothing is written', async (t) => {
  const z = await modulAufbau(t);
  const rev = z.projekt().rev, dateien = () => fs.existsSync(path.join(z.offen().ordner, 'loops')) ? fs.readdirSync(path.join(z.offen().ordner, 'loops')).length : 0;
  z.ruf.deck = () => ({ code: 409, fehler: 'kein_loop' });
  let e = await z.fehl(() => z.export());
  assert.deepEqual([e.code, e.fehler], [409, 'kein_loop']);
  assert.match(e.text, /no active loop/);
  z.ruf.deck = () => ({ code: 400, fehler: 'unbekanntes_deck' });
  assert.deepEqual((await z.fehl(() => z.export({ deck: 4 }))).fehler, 'unbekanntes_deck');
  z.ruf.deck = () => ({ ...z.deck });
  z.ruf.herkunft = () => null;
  e = await z.fehl(() => z.export());
  assert.deepEqual([e.code, e.fehler], [409, 'kein_bibliothekstrack']);
  z.ruf.herkunft = () => ({ sha: SHA, typ: 'oneshot', titel: 'x', kuenstler: null, bpm: null, camelot: null });
  assert.equal((await z.fehl(() => z.export())).fehler, 'kein_bibliothekstrack');
  assert.equal((await z.fehl(() => z.export({ slot: 'C' }))).code, 400);
  assert.equal((await z.fehl(() => z.export({ extra: 1 }))).code, 400);
  assert.equal(z.projekt().rev, rev);
  assert.equal(dateien(), 0);
  assert.equal(z.nach.length, 0);
  await z.s.neu('Flat', 'andreas');
  e = await z.fehl(() => z.export());
  assert.deepEqual([e.code, e.fehler], [409, 'kein_liveprojekt']);
});

test('Cypher: Stop Cypher refuses the export; nothing is written', async (t) => {
  const z = await modulAufbau(t);
  z.zustand.ki = true;
  const e = await z.fehl(() => z.export({}, 'cypher'));
  assert.equal(e.fehler, 'ki_gestoppt');
  assert.equal(z.projekt().gruppen.filter((g) => g.modul).length, 0);
});

test('a GPU-busy separation leaves the loop-only module with gpu_belegt in its state; /modul/stems retries and succeeds', { skip: OHNE_GPU }, async (t) => {
  const z = await modulAufbau(t, { trenner: 'gpu_belegt' });
  await z.export();
  const e = await z.ende();
  assert.deepEqual([e.stems, e.grund], ['fehler', 'gpu_belegt']);
  assert.ok(e.text.includes('GPU'), JSON.stringify(e));
  const p = z.projekt();
  assert.equal(kinder(p, top(p).id).length, 0, 'loop-only module stays');
  assert.equal(p.spuren.find((s) => s.name === 'Loop').mute, false, 'and plays');
  assert.equal(z.stand().stems.grund, 'gpu_belegt');
  z.opt.zusatzArgs = ['--trenner', 'identitaet_vier'];                           // the GPU is free again
  const r = await z.neu({ slot: 'A' });
  assert.equal(r.code, 200);
  assert.equal((await z.ende()).stems, 'fertig');
  assert.equal(kinder(z.projekt(), top(z.projekt()).id).length, 4);
  const doppelt = await z.fehl(() => z.neu({ slot: 'A' }));
  assert.equal(doppelt.fehler, 'modul_hat_stems');
});

test('a failed separation (nothing separates) is stems_fehler in the state; retry rules: slot_leer, running separation refused', async (t) => {
  const z = await modulAufbau(t, { trenner: 'langsam' });
  assert.equal((await z.fehl(() => z.neu({ slot: 'B' }))).fehler, 'slot_leer');
  assert.equal((await z.fehl(() => z.neu({ slot: 'X' }))).code, 400);
  await z.export();
  assert.ok(await warteBis(() => z.stand().stems.stems === 'laeuft', 20000));
  assert.equal((await z.fehl(() => z.neu({ slot: 'A' }))).fehler, 'stems_laeuft');
  const nr = z.stand().stems.auftrag_id;
  z.stems.abbrechen({ auftrag_id: nr });
  const e = await z.ende();
  assert.deepEqual([e.stems, e.grund], ['fehler', 'abbruch']);
  assert.equal(kinder(z.projekt(), top(z.projekt()).id).length, 0);
  // a separator that does not deliver: the python child fails with an unknown separator name
  z.opt.zusatzArgs = ['--trenner', 'gibt_es_nicht'];
  assert.equal((await z.neu({ slot: 'A' })).code, 200);
  const f = await z.ende();
  assert.deepEqual([f.stems, f.grund], ['fehler', 'stems_fehler']);
});

test('progress of the separation is the proj_stems state (GET /proj/aktuell stems)', async (t) => {
  const z = await modulAufbau(t, { trenner: 'langsam' });
  await z.export();
  assert.ok(await warteBis(() => z.s.aktuell().j.stems?.zustand === 'laeuft', 20000), JSON.stringify(z.s.aktuell().j.stems));
  assert.equal(z.s.aktuell().j.stems.clip_id, z.projekt().spuren.find((s) => s.name === 'Loop').clips[0].id);
  z.stems.abbrechen({ auftrag_id: z.s.aktuell().j.stems.auftrag_id });
  await z.ende();
});

test('module clips keep a finished module playable: the playback of the loop-only module is written for the core', async (t) => {
  const z = await modulAufbau(t, { trenner: 'langsam' });
  await z.export();
  assert.ok(await warteBis(() => z.projekt().spuren.find((s) => s.name === 'Loop').clips.every((c) => c.dekodiert === 'fertig'), 20000), 'decoded');
  const w = z.wiedergabe(z.projekt().wiedergabe_rev);
  const loops = JSON.stringify(w).match(/"sha256":"e?[0-9a-f]{64}"/g) ?? [];
  assert.ok(loops.length >= 1, 'the loop clips reached the playback');
  await z.abbruch();
});

test('the export stores the first downbeat of the rendering and the bar phase follows it', async (t) => {
  const z = await modulAufbau(t, { trenner: 'langsam', loop: { eins: 1, von_beat: 3 } });   // L = 4: p = (3 - 1) mod 4 = 2
  await z.export();
  const g = top(z.projekt());
  assert.equal(g.modul.eins_beat, 1);
  const clips = [...z.projekt().spuren.find((s) => s.name === 'Loop').clips].sort((x, y) => x.start_beat - y.start_beat);
  assert.deepEqual([clips[0].laenge_beats, clips[0].warp.versatz_beats, clips[1].start_beat], [2, 2, 2]);
  await z.abbruch();
});

test('leftover cut files of an export that died are removed when the stems area starts', async (t) => {
  const r = await aufbau(t, { mitKick: false });
  const alt = path.join(r.arbeitsordner, 'live-export-7.f32'), bleibt = path.join(r.arbeitsordner, 'live-export-x.f32');
  fs.mkdirSync(r.arbeitsordner, { recursive: true });
  fs.writeFileSync(alt, 'x'); fs.writeFileSync(bleibt, 'x');
  const stems = new Stems(r.ctx, r.zugang, { python: pythonVorgabe(), cwd: REPO_PFADE.werkstatt });
  t.after(() => stems.schliesse());
  assert.equal(fs.existsSync(alt), false);
  assert.equal(fs.existsSync(bleibt), true, 'only the export pattern is removed');
});

test('review fix 5: a track without tags or analysis exports (artist and key left out, title cut to 200)', async (t) => {
  const z = await modulAufbau(t, { trenner: 'langsam', katalog: { kuenstler: null, camelot: null, titel: 'T'.repeat(300) } });
  const r = await z.export();
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const m = top(z.projekt()).modul;
  assert.equal(m.titel.length, 200);
  assert.ok(!('kuenstler' in m) && !('tonart' in m), JSON.stringify(m));
  await z.abbruch('A');
});

test('review fix 6: a project switch while the loop decodes ends the slot state as abbruch, and /modul/stems is possible again later', async (t) => {
  const z = await modulAufbau(t, { trenner: 'langsam' });
  assert.equal((await z.export()).code, 200);
  await z.s.neu('Flat', 'andreas');                                            // right away: the decode of the loop is still going on
  const innen = () => z.m.zustand.A;                                           // the slot state without the open-project filter of stand()
  assert.ok(await warteBis(() => innen().stems !== 'wartet', 20000), JSON.stringify(innen()));
  assert.deepEqual([innen().stems, innen().grund], ['fehler', 'abbruch'], JSON.stringify(innen()));
  assert.equal((await z.s.liveOeffnen('andreas')).code, 200);
  assert.equal(z.stand().stems.grund, 'abbruch');
  const r = await z.neu({ slot: 'A' });                                        // not stuck on stems_laeuft
  assert.equal(r.code, 200, JSON.stringify(r.j));
  await z.abbruch('A');
});
