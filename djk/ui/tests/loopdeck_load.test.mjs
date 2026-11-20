// Loop deck M5: POST /loopdeck/laden of LoopdeckBereich (areas/live/loopdeck.ts, sources in loopdeck_load.ts). Real live project of the proj session,
// the core is not involved; the catalogue import and the deck loop (server.ts) are doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ldAufbau, schreibeLoop, schreibeModul, BEAT } from './support/loopdeck_write.mjs';
import { ladeZelle } from '../areas/live/loopdeck.ts';

const laden = (z, d, q = 'andreas') => z.bereich.laden(d, q);
const MID = 'ab12cd34ef567890';

test('a library loop lands in the first empty cell with name, colour, gain, grid length and a project-relative WAV', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  schreibeLoop(z.loops, 'groove', 4);
  schreibeLoop(z.loops, 'long', 8);
  const a = await laden(z, { deck: 1, quelle: { loop: 'groove' } });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const c = z.zelle(1, 1);
  assert.deepEqual([a.j.ok, a.j.spur, a.j.zelle, a.j.zelle_id], [true, 1, 1, c.id]);
  assert.deepEqual([c.name, c.farbe, c.art, c.beats, c.bpm, c.gain_db], ['groove', 0, 'loop', 4, 128, 0]);
  assert.match(c.pfad_hinweis, /^loops\/\d+-L1-groove\.wav$/);
  assert.ok(fs.statSync(path.join(z.ordner(), c.pfad_hinweis)).size >= 4 * BEAT * 8);
  assert.deepEqual(z.wavs(), [path.basename(c.pfad_hinweis)]);
  // the next load takes the next row of the same track; a given target is overwritten and coloured by its place
  const b = await laden(z, { deck: 1, quelle: { loop: 'long' } });
  assert.deepEqual([b.j.spur, b.j.zelle], [1, 2]);
  assert.equal(z.zelle(1, 2).farbe, 1);
  const g = await laden(z, { deck: 1, spur: 2, zelle: 3, quelle: { loop: 'groove' } });
  assert.deepEqual([g.j.spur, g.j.zelle, z.zelle(2, 3).farbe, z.zelle(2, 3).beats], [2, 3, 6, 4]);
  // the exported function is the same load
  const e = await ladeZelle(z.bereich, 1, { spur: 4 }, { loop: 'groove' }, 'andreas');
  assert.deepEqual([e.spur, e.zelle, e.zelle_id], [4, 1, z.zelle(4, 1).id]);
});

test('module sources: the main loop and the named stem', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  const m = await schreibeModul(z.module, MID, { titel: 'Night Song', beats: 8 });
  const a = await laden(z, { deck: 1, quelle: { modul: MID } });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const c = z.zelle(1, 1);
  assert.deepEqual([c.name, c.sha256, c.beats, c.bpm, c.art], ['Night Song', m.loop.sha256, 8, 120, 'loop']);
  assert.ok(fs.existsSync(path.join(z.ordner(), c.pfad_hinweis)));
  const b = await laden(z, { deck: 1, quelle: { modul: MID, stem: 'drums' } });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  assert.deepEqual([z.zelle(1, 2).name, z.zelle(1, 2).sha256], ['Drums', m.drums.sha256]);
  const x = await laden(z, { deck: 1, quelle: { modul: MID, stem: 'vocals' } });
  assert.deepEqual([x.code, x.j.grund], [409, 'quelle_unbekannt']);
  assert.equal((await laden(z, { deck: 1, quelle: { modul: 'f'.repeat(16) } })).j.grund, 'quelle_unbekannt');
});

test('catalogue source goes through the import and lands as that loop; a failed import is quelle_unbekannt', async (t) => {
  const SHA = 'c'.repeat(64);
  const z = await ldAufbau(t, { deck: true, katalogLoop: async (sha, loops) => {
    if (sha !== SHA) throw Object.assign(new Error('unbekannt'), { fehler: 'unbekannt' });
    schreibeLoop(loops, 'kat-loop', 2); return { name: 'kat-loop' };
  } });
  const a = await laden(z, { deck: 1, quelle: { sha: SHA } });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual([z.zelle(1, 1).name, z.zelle(1, 1).beats, z.zelle(1, 1).bpm], ['kat-loop', 2, 128]);
  for (const sha of ['d'.repeat(64), 'zz']) {
    const b = await laden(z, { deck: 1, quelle: { sha } });
    assert.deepEqual([b.code, b.j.grund], [409, 'quelle_unbekannt']);
  }
});

test('deck loop source writes the cut as a WAV and uses its beats and basis tempo', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  const a = await laden(z, { deck: 1, quelle: { von_deck: 2 } });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const c = z.zelle(1, 1);
  assert.deepEqual([c.name, c.beats, c.bpm], ['Deck 2 loop', 4, 120]);
  assert.ok(fs.existsSync(path.join(z.ordner(), c.pfad_hinweis)));
  assert.deepEqual(z.wavs().length, 1, 'the cut leaves no temporary file in loops/');
  z.o.deck = { code: 409, fehler: 'kein_loop' };
  const b = await laden(z, { deck: 1, quelle: { von_deck: 1 } });
  assert.deepEqual([b.code, b.j.grund], [409, 'quelle_unbekannt']);
});

test('unknown and malformed sources and targets', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  assert.deepEqual([(await laden(z, { deck: 1, quelle: { loop: 'nope' } })).j.grund], ['quelle_unbekannt']);
  assert.deepEqual([(await laden(z, { deck: 1, quelle: { loop: '../x' } })).j.grund], ['quelle_unbekannt']);
  for (const d of [{ deck: 1 }, { deck: 1, quelle: {} }, { deck: 1, quelle: { loop: 'a', sha: 'b' } }, { deck: 3, quelle: { loop: 'a' } },
    { deck: 1, spur: 5, quelle: { loop: 'a' } }, { deck: 1, quelle: { von_deck: 9 } }, { deck: 1, quelle: { loop: 1 } }]) {
    const r = await laden(z, d);
    assert.equal(r.code, 400, JSON.stringify(d));
    assert.equal(r.j.ok, false);
  }
  assert.equal((await laden(z, { deck: 1, quelle: { loop: 'a' }, x: 1 })).j.grund, 'argument_unbekannt');
  assert.equal(z.wavs().length, 0);
});

test('a full deck is 409 deck_voll and nothing is written; a given cell is still replaced', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  schreibeLoop(z.loops, 'groove', 4);
  const Z = (n) => ({ name: n, farbe: 0, art: 'loop', sha256: 'e'.repeat(64), beats: 4, bpm: 120, gain_db: 0 });
  await z.aendern(z.spuren().flatMap((s) => Array.from({ length: 8 }, (_, i) => ({ befehl: 'zelle_setzen', spur_id: s.id, index: i + 1, zelle: Z(`x${i}`) }))));
  const rev = z.projekt().rev;
  const a = await laden(z, { deck: 1, quelle: { loop: 'groove' } });
  assert.deepEqual([a.code, a.j.ok, a.j.grund], [409, false, 'deck_voll']);
  const b = await laden(z, { deck: 1, spur: 3, quelle: { loop: 'groove' } });
  assert.equal(b.j.grund, 'deck_voll', 'a given track with no empty cell');
  assert.deepEqual([z.projekt().rev, z.wavs().length], [rev, 0]);
  const c = await laden(z, { deck: 1, spur: 2, zelle: 5, quelle: { loop: 'groove' } });
  assert.equal(c.code, 200, JSON.stringify(c.j));
  assert.equal(z.zelle(2, 5).name, 'groove');
});

test('61 s of audio is 409 zu_lang before anything is written', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  z.o.deckFrames = 2_880_001;
  const rev = z.projekt().rev;
  const a = await laden(z, { deck: 1, quelle: { von_deck: 1 } });
  assert.deepEqual([a.code, a.j.ok, a.j.grund], [409, false, 'zu_lang']);
  assert.deepEqual([z.projekt().rev, z.wavs().length], [rev, 0]);
  z.o.deckFrames = 2_880_000;
  assert.equal((await laden(z, { deck: 1, quelle: { von_deck: 1 } })).code, 200, '60 s exactly is allowed');
});

test('the distinct audio of the project over 512 MiB is 409 audio_budget; the WAV that was written is removed again', async (t) => {
  const OLD = 'f'.repeat(64);
  const z = await ldAufbau(t, { deck: true, frames: { [OLD]: 67_100_000 } });   // 536.8 MB: just under 512 MiB alone, over it with a 4 beat loop
  schreibeLoop(z.loops, 'groove', 4);
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren()[0].id, index: 1, zelle: { name: 'old', farbe: 0, art: 'loop', sha256: OLD, beats: 4, bpm: 120, gain_db: 0 } }]);
  const rev = z.projekt().rev;
  const a = await laden(z, { deck: 1, quelle: { loop: 'groove' } });
  assert.deepEqual([a.code, a.j.ok, a.j.grund], [409, false, 'audio_budget']);
  assert.deepEqual([z.projekt().rev, z.wavs().length], [rev, 0], 'nothing written, no WAV left behind');
  // replacing the big cell frees its audio: the same load into that cell fits (the budget counts the project after the command)
  const b = await laden(z, { deck: 1, spur: 1, zelle: 1, quelle: { loop: 'groove' } });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  assert.equal(z.wavs().length, 1);
});

test('a missing deck is created with the cell in one undo step; the container is opened when there is none', async (t) => {
  const z = await ldAufbau(t, { deck: false, container: false });
  schreibeLoop(z.loops, 'groove', 4);
  assert.equal(z.o.geoeffnet, 0);
  const rev = z.projekt().rev;
  const a = await laden(z, { deck: 2, quelle: { loop: 'groove' } });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(z.o.geoeffnet, 1, 'the live container was opened by the session path');
  const p = z.projekt();
  assert.equal(p.rev, rev + 1, 'deck and cell are one revision');
  assert.deepEqual([p.gruppen.some((g) => g.loopdeck?.platz === 2), z.zelle(1, 1)?.name], [true, 'groove']);
  const u = await z.undo();
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.deepEqual([z.projekt().gruppen.some((g) => g.loopdeck), z.spuren().length], [false, 0], 'undo removes deck and cell together');
  // opening is only done when the container is not open
  z.o.offen = true;
  await laden(z, { deck: 1, quelle: { loop: 'groove' } });
  assert.equal(z.o.geoeffnet, 1);
});

test('Stop Cypher refuses a load of Cypher and leaves no WAV', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  schreibeLoop(z.loops, 'groove', 4);
  z.zustand.ki = true;
  const a = await laden(z, { deck: 1, quelle: { loop: 'groove' } }, 'cypher');
  assert.deepEqual([a.code, a.j.grund], [409, 'ki_gestoppt']);
  assert.equal(z.wavs().length, 0);
  assert.equal((await laden(z, { deck: 1, quelle: { loop: 'groove' } }, 'andreas')).code, 200, 'Andreas is not stopped');
});

test('a catalogue one-shot is copied as it is: art einmal, no beats, no bpm, the file keeps its type; a loop stays a loop', async (t) => {
  const SHA = 'e'.repeat(64);
  let frames = 24000;
  const z = await ldAufbau(t, { deck: true, katalogLoop: async (sha, loops) => {
    if (sha === SHA) {
      const datei = path.join(z.tmp, 'Kick 01.flac');
      fs.writeFileSync(datei, 'not really audio, the decoder is not involved here');
      return { name: 'Kick 01', einmal: { datei, sha: SHA, frames } };
    }
    schreibeLoop(loops, 'kat-loop', 2); return { name: 'kat-loop' };
  } });
  const a = await laden(z, { deck: 1, quelle: { sha: SHA } });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const c = z.zelle(1, 1);
  assert.deepEqual([c.name, c.art, c.sha256, 'beats' in c, 'bpm' in c], ['Kick 01', 'einmal', SHA, false, false]);
  assert.match(c.pfad_hinweis, /^loops\/\d+-L1-Kick-01\.flac$/);
  assert.equal(fs.readFileSync(path.join(z.ordner(), c.pfad_hinweis), 'utf8').slice(0, 7), 'not rea');
  assert.equal((await z.undo()).code, 200);
  const b = await laden(z, { deck: 1, quelle: { sha: 'c'.repeat(64) } });
  assert.equal(z.zelle(1, 1).art, 'loop');
  assert.equal(b.code, 200);
  // a one-shot over the length limit is refused before anything is copied
  const vor = z.wavs().length;
  frames = 2_880_001;
  const x = await laden(z, { deck: 1, quelle: { sha: SHA } });
  assert.deepEqual([x.code, x.j.grund], [409, 'zu_lang']);
  assert.equal(z.wavs().length, vor, 'nothing was copied');
});
