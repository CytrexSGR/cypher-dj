// Loop deck M5, the real page server with the core stand-in: POST /loopdeck/laden opens or creates the live container through the session's own path
// (the code behind POST /live/oeffnen) and GET /welle?sha= answers the waveform of a cell of the open live project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './support/media_library.mjs';
import { baueKatalog, ksha } from './support/catalog.mjs';
import { ruf } from './support/proj_stack.mjs';
import { schreibeLoop } from './support/loopdeck_write.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('laden creates the live container and the deck itself; /welle?sha= serves the audio of the cell', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-ld-loops-'));
  t.after(() => fs.rmSync(loops, { recursive: true, force: true }));
  schreibeLoop(loops, 'groove', 4);
  const katalog = baueKatalog(path.join(loops, '..', `kat-${path.basename(loops)}`), []);
  t.after(() => fs.rmSync(path.join(loops, '..', `kat-${path.basename(loops)}`), { recursive: true, force: true }));
  const { url } = await stapel(t, { loops, katalog });
  assert.equal((await ruf(url, 'GET', '/loopdeck/stand')).j.decks['1'], null, 'no container yet');
  const a = await ruf(url, 'POST', '/loopdeck/laden', { deck: 1, quelle: { loop: 'groove' } });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual([a.j.ok, a.j.spur, a.j.zelle], [true, 1, 1]);
  const akt = (await ruf(url, 'GET', '/proj/aktuell')).j;
  assert.equal(akt.projekt.live, true, 'the live container was created and opened');
  const stand = (await ruf(url, 'GET', '/loopdeck/stand')).j;
  const zelle = stand.decks['1'].spuren[0].zellen[0];
  assert.equal(zelle.name, 'groove');
  const w = await fetch(`${url}/welle?sha=${zelle.sha256}`);
  assert.equal(w.status, 200, `waveform of a cell: ${w.status} ${await w.clone().text().catch(() => '')}`);
  assert.ok((await w.arrayBuffer()).byteLength > 0);
  assert.equal((await fetch(`${url}/welle?sha=${'d'.repeat(64)}`)).status, 404, 'a sha that neither the catalogue nor the project knows');
  // neu is idempotent on the real server too
  const n = await ruf(url, 'POST', '/loopdeck/neu', { deck: 1 });
  assert.deepEqual([n.code, n.j.gruppe_id], [200, stand.decks['1'].gruppe_id]);
});

// ---- review fixes: the {sha} source takes one-shots too; a start does not wait for a pending receipt --------------------------------------------


function wavDatei(datei, sek = 0.5) {
  const n = Math.round(48000 * sek), b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(48000 * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.sin(i / 20) * 8000); b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4); }
  fs.writeFileSync(datei, b);
}

test('{sha}: a catalogue one-shot loads as art einmal, a track is quelle_unbekannt; the real stand-in core answers a start at once', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-ld-os-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const kick = path.join(dir, 'Kick 01.wav'), track = path.join(dir, 'song.wav');
  wavDatei(kick); wavDatei(track, 1);
  const katalog = baueKatalog(path.join(dir, 'kat'), [{ n: 21, typ: 'oneshot', instrument: 'kick', dauer_s: 0.5, pfad: kick }, { n: 1, typ: 'track', titel: 'Song', bpm: 128, dauer_s: 1, pfad: track },
    { n: 22, typ: 'oneshot', instrument: 'kick', schutz: 'ableton', dauer_s: 0.5, pfad: kick }]);
  const loops = path.join(dir, 'loops'); fs.mkdirSync(loops);
  const { url } = await stapel(t, { loops, katalog });
  const a = await ruf(url, 'POST', '/loopdeck/laden', { deck: 1, quelle: { sha: ksha(21) } });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const stand = async () => (await ruf(url, 'GET', '/loopdeck/stand')).j;
  const z = (await stand()).decks['1'].spuren[0].zellen[0];
  assert.deepEqual([z.name, z.art, z.sha256, 'beats' in z, 'bpm' in z], ['Kick 01', 'einmal', ksha(21), false, false]);
  assert.match(z.pfad_hinweis, /^loops\/\d+-L1-Kick-01\.wav$/);
  const t1 = await ruf(url, 'POST', '/loopdeck/laden', { deck: 1, quelle: { sha: ksha(1) } });
  assert.deepEqual([t1.code, t1.j.grund], [409, 'quelle_unbekannt']);
  assert.equal((await ruf(url, 'POST', '/loopdeck/laden', { deck: 1, quelle: { sha: ksha(22) } })).j.grund, 'quelle_unbekannt', 'protected: only for Live');
  // the cell is decoded for the core in the background; before that a start is zelle_laedt
  for (let i = 0; i < 250 && (await stand()).decks['1'].spuren[0].zellen[0].frames === null; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok((await stand()).decks['1'].spuren[0].zellen[0].frames > 0, 'decoded');
  for (let i = 0; i < 250 && (await stand()).beat === null; i++) await new Promise((r) => setTimeout(r, 20));
  const t0 = Date.now();
  const s = await ruf(url, 'POST', '/loopdeck/start', { deck: 1, spur: 1, zelle: 1, raster: '4takte' });
  const ms = Date.now() - t0;
  assert.equal(s.code, 200, JSON.stringify(s.j));
  assert.equal(s.j.status, 1, 'accepted and pending: that is the answer');
  assert.ok(ms < 300, `a start answers on the first receipt, not after the 400 ms bound (${ms} ms)`);
});
