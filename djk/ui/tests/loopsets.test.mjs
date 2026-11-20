// Loop deck S1b: GET /loopsets, POST /loopset/speichern, POST /loopset/laden (areas/live/loopsets.ts). Real live project of the proj session, no core.
// The store is a temp folder of the test; the clock is never read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ldAufbau, schreibeLoop } from './support/loopdeck_write.mjs';
import { loopsetsBereich } from '../areas/live/loopsets.ts';

async function aufbau(t, o = {}) {
  const z = await ldAufbau(t, o);
  const store = path.join(z.tmp, 'loopsets');
  const sets = loopsetsBereich(z.ctx, z.zugang, { ordner: () => store, loopdeck: z.bereich });
  const speichern = (d, q = 'andreas') => sets.speichern(d, q);
  const laden = (d, q = 'andreas') => sets.laden(d, q);
  const fuelle = async (loops = ['groove', 'long']) => {   // loads cells 1..n of track 1
    for (const l of loops) { schreibeLoop(z.loops, l, l === 'long' ? 8 : 4); assert.equal((await z.bereich.laden({ deck: 1, quelle: { loop: l } }, 'andreas')).code, 200); }
  };
  return { ...z, store, sets, speichern, laden, fuelle };
}
const KOMPLETT = (z) => fs.readdirSync(z.store).sort();

test('save then list: set.json and the audio copy, listing with name, grid and cell count', async (t) => {
  const z = await aufbau(t, { deck: true });
  await z.fuelle();
  const a = await z.speichern({ deck: 1, name: 'warehouse a' });
  assert.deepEqual([a.code, a.j], [200, { ok: true, name: 'warehouse a' }]);
  const dir = path.join(z.store, 'warehouse a');
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'set.json'), 'utf8'));
  assert.deepEqual([s.format, s.name, s.raster, s.spuren.length, s.spuren.map((x) => x.zellen.length)], [1, 'warehouse a', 'takt', 4, [8, 8, 8, 8]]);
  const c = s.spuren[0].zellen[0];
  assert.deepEqual([c.name, c.art, c.beats, c.bpm, c.gain_db, c.datei, 'id' in c, 'pfad_hinweis' in c], ['groove', 'loop', 4, 128, 0, `audio/${c.sha256}.wav`, false, false]);
  assert.ok(fs.statSync(path.join(dir, c.datei)).size > 0);
  assert.equal(s.spuren[0].zellen[2], null);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'audio')).length, 2);
  const l = z.sets.liste();
  assert.deepEqual([l.code, l.j.sets.map((x) => [x.name, x.raster, x.zellen]), typeof l.j.sets[0].geaendert], [200, [['warehouse a', 'takt', 2]], 'string']);
  assert.deepEqual(KOMPLETT(z), ['warehouse a'], 'no temporary folder is left');
});

test('save overwrites the same name atomically and keeps the old set when saving fails', async (t) => {
  const z = await aufbau(t, { deck: true });
  await z.fuelle(['groove']);
  await z.speichern({ deck: 1, name: 'x' });
  await z.fuelle(['long']);
  assert.equal((await z.speichern({ deck: 1, name: 'x' })).code, 200);
  assert.equal(z.sets.liste().j.sets[0].zellen, 2);
  assert.deepEqual(KOMPLETT(z), ['x']);
  // a cell whose audio is gone from the project: refused, the stored set stays as it was, no temp folder
  const c = z.zelle(1, 2);
  fs.rmSync(path.join(z.ordner(), c.pfad_hinweis));
  const f = await z.speichern({ deck: 1, name: 'x' });
  assert.deepEqual([f.code, f.j.grund], [409, 'audio_fehlt']);
  assert.equal(z.sets.liste().j.sets[0].zellen, 2);
  assert.deepEqual(KOMPLETT(z), ['x']);
});

test('load into an empty and a filled deck; one undo restores the old cells', async (t) => {
  const z = await aufbau(t, { deck: true });
  await z.fuelle(['groove', 'long']);
  await z.speichern({ deck: 1, name: 'one' });
  await z.aendern([{ befehl: 'loopdeck_aendern', gruppe_id: z.projekt().gruppen.find((g) => g.loopdeck).id, raster: '1' }]);
  // clear the deck, then load: into an empty deck
  await z.aendern([{ befehl: 'loopdeck_leeren', gruppe_id: z.projekt().gruppen.find((g) => g.loopdeck).id }]);
  assert.equal(z.zelle(1, 1), null);
  let rev = z.projekt().rev;
  const a = await z.laden({ deck: 1, name: 'one' });
  assert.deepEqual([a.code, a.j], [200, { ok: true }]);
  assert.equal(z.projekt().rev, rev + 1, 'one revision');
  assert.deepEqual([z.zelle(1, 1).name, z.zelle(1, 2).name, z.zelle(1, 2).beats, z.zelle(1, 3)], ['groove', 'long', 8, null]);
  assert.equal(z.projekt().gruppen.find((g) => g.loopdeck).loopdeck.raster, 'takt', 'the grid of the set is applied');
  assert.match(z.zelle(1, 1).pfad_hinweis, /^loops\/\d+-L1-groove\.wav$/);
  assert.ok(fs.existsSync(path.join(z.ordner(), z.zelle(1, 1).pfad_hinweis)));
  // into a filled deck: other cells are replaced, one undo brings them back
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren()[3].id, index: 5, zelle: { name: 'other', farbe: 1, art: 'loop', sha256: 'e'.repeat(64), beats: 4, bpm: 120, gain_db: 0 } }]);
  const vorher = JSON.stringify(z.spuren().map((s) => s.zellen));
  rev = z.projekt().rev;
  assert.equal((await z.laden({ deck: 1, name: 'one' })).code, 200);
  assert.deepEqual([z.projekt().rev, z.zelle(4, 5)], [rev + 1, null]);
  const u = await z.undo();
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.equal(JSON.stringify(z.spuren().map((s) => s.zellen)), vorher, 'undo restores the old cells');
});

test('a missing deck (and container) is created in the same undo step; the set loads without the project it came from', async (t) => {
  const z = await aufbau(t, { deck: true });
  await z.fuelle(['groove']);
  await z.speichern({ deck: 1, name: 'fresh' });
  const w = await aufbau(t, { deck: false, container: false });
  fs.cpSync(z.store, w.store, { recursive: true });
  const rev = w.projekt().rev;
  const a = await w.laden({ deck: 2, name: 'fresh' });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(w.o.geoeffnet, 1);
  assert.deepEqual([w.projekt().rev, w.projekt().gruppen.some((g) => g.loopdeck?.platz === 2), w.zelle(1, 1)?.name], [rev + 1, true, 'groove']);
  assert.equal((await w.undo()).code, 200);
  assert.deepEqual([w.projekt().gruppen.some((g) => g.loopdeck), w.spuren().length], [false, 0]);
});

test('unknown set 409, damaged set 409, bad names and deck 400, nothing changed', async (t) => {
  const z = await aufbau(t, { deck: true });
  const rev = z.projekt().rev;
  assert.deepEqual([(await z.laden({ deck: 1, name: 'nope' })).code, (await z.laden({ deck: 1, name: 'nope' })).j.grund], [409, 'set_unbekannt']);
  fs.mkdirSync(path.join(z.store, 'broken'), { recursive: true });
  fs.writeFileSync(path.join(z.store, 'broken', 'set.json'), '{ not json');
  assert.equal((await z.laden({ deck: 1, name: 'broken' })).j.grund, 'set_defekt');
  for (const name of ['../x', 'a/b', '..', '', ' x', 'x ', 'a.b', 'n'.repeat(65), 3, undefined]) {
    for (const f of [z.laden, z.speichern]) {
      const r = await f({ deck: 1, name });
      assert.deepEqual([r.code, r.j.grund], [400, 'argument_ungueltig'], String(name));
    }
  }
  for (const deck of [0, 3, '1', undefined]) assert.equal((await z.laden({ deck, name: 'x' })).code, 400);
  assert.equal((await z.laden({ deck: 1, name: 'x', y: 1 })).j.grund, 'argument_unbekannt');
  assert.deepEqual([z.projekt().rev, z.wavs().length], [rev, 0]);
  assert.equal(fs.existsSync(path.join(z.store, '..x')), false);
});

test('a set over the audio budget is refused with nothing changed and no WAV left; a set over 60 s is zu_lang', async (t) => {
  const z = await aufbau(t, { deck: true });
  await z.fuelle(['groove']);
  await z.speichern({ deck: 1, name: 'big' });
  const sha = JSON.parse(fs.readFileSync(path.join(z.store, 'big', 'set.json'), 'utf8')).spuren[0].zellen[0].sha256;
  const OLD = 'f'.repeat(64);
  const w = await aufbau(t, { deck: true, frames: { [OLD]: 67_100_000 } });   // just under 512 MiB alone, over it with a 4 beat loop
  fs.cpSync(z.store, w.store, { recursive: true });
  // the big cell sits on deck 2: loading into deck 1 does not free it (a cell of the replaced deck would be freed)
  await w.aendern([{ befehl: 'loopdeck_neu', platz: 2 }]);
  await w.aendern([{ befehl: 'zelle_setzen', spur_id: w.spuren()[4].id, index: 1, zelle: { name: 'old', farbe: 0, art: 'loop', sha256: OLD, beats: 4, bpm: 120, gain_db: 0 } }]);
  const rev = w.projekt().rev;
  const a = await w.laden({ deck: 1, name: 'big' });
  assert.deepEqual([a.code, a.j.ok, a.j.grund], [409, false, 'audio_budget']);
  assert.deepEqual([w.projekt().rev, w.wavs().length, w.zelle(5, 1).name], [rev, 0, 'old']);
  assert.ok(sha);
  // 61 s: a set whose WAV is longer than the limit
  const v = await aufbau(t, { deck: true });
  fs.cpSync(z.store, v.store, { recursive: true });
  const dir = path.join(v.store, 'big');
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'set.json'), 'utf8'));
  const lang = path.join(v.tmp, 'lang.f32');
  fs.writeFileSync(lang, Buffer.alloc(2_880_001 * 8));
  const { schreibeWavAusF32Stueckweise } = await import('../project/recording.ts');
  const tmpWav = path.join(v.tmp, 'lang.wav');
  const w61 = await schreibeWavAusF32Stueckweise(lang, tmpWav);
  s.spuren[0].zellen[0].sha256 = w61.sha256; s.spuren[0].zellen[0].datei = `audio/${w61.sha256}.wav`;
  fs.renameSync(tmpWav, path.join(dir, s.spuren[0].zellen[0].datei));
  fs.writeFileSync(path.join(dir, 'set.json'), JSON.stringify(s));
  const b = await v.laden({ deck: 1, name: 'big' });
  assert.deepEqual([b.code, b.j.grund, v.wavs().length], [409, 'zu_lang', 0]);
});

test('an altered audio file of a set is set_defekt', async (t) => {
  const z = await aufbau(t, { deck: true });
  await z.fuelle(['groove']);
  await z.speichern({ deck: 1, name: 'alt' });
  const dir = path.join(z.store, 'alt', 'audio');
  const f = path.join(dir, fs.readdirSync(dir)[0]);
  const b = fs.readFileSync(f); b[b.length - 1] ^= 0xff; fs.writeFileSync(f, b);
  const rev = z.projekt().rev;
  assert.equal((await z.laden({ deck: 1, name: 'alt' })).j.grund, 'set_defekt');
  assert.deepEqual([z.projekt().rev, z.wavs().length], [rev, 1]);
});

test('Stop Cypher refuses save and load of Cypher; Andreas is not stopped', async (t) => {
  const z = await aufbau(t, { deck: true });
  await z.fuelle(['groove']);
  await z.speichern({ deck: 1, name: 'k' });
  z.zustand.ki = true;
  for (const r of [await z.speichern({ deck: 1, name: 'k2' }, 'cypher'), await z.laden({ deck: 1, name: 'k' }, 'cypher')]) assert.deepEqual([r.code, r.j.grund], [409, 'ki_gestoppt']);
  assert.deepEqual(KOMPLETT(z), ['k']);
  assert.equal((await z.laden({ deck: 1, name: 'k' }, 'andreas')).code, 200);
});

test('save without a deck is kein_loopdeck; the listing of a missing store is empty', async (t) => {
  const z = await aufbau(t, { deck: false });
  assert.deepEqual(z.sets.liste().j, { sets: [] });
  const r = await z.speichern({ deck: 1, name: 'x' });
  assert.deepEqual([r.code, r.j.grund], [409, 'kein_loopdeck']);
  assert.equal(fs.existsSync(z.store), false);
});
