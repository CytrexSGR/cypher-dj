// Loop deck M3: decode bookkeeping for cells. A cell sha is decoded like a clip source, a cell change counts for the playback,
// and a finished decode of a cell sha rebuilds the snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { neuesProjekt, wiedergabeSicht, kanonisch } from '../project/model.ts';
import { fuehreListeAus, vergleiche } from '../project/commands.ts';
import { sitzung } from './support/proj_context.mjs';
import { sammleEin } from '../project/einsammeln.ts';

const SHA = 'd'.repeat(64);
const zelle = (id, extra = {}) => ({ id, name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 1, bpm: 120, gain_db: 0, ...extra });

function deck() {
  let p = neuesProjekt('ld'); p.live = true; p.plaetze = [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }];
  for (let i = 1; i <= 4; i++) p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: `L1.${i}` }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'gruppenspur_neu', name: 'LOOP 1', mitglieder: p.spuren.map((s) => s.id) }]).projekt;
  p = JSON.parse(JSON.stringify(p));
  p.gruppen[0].loopdeck = { platz: 1, raster: 'takt' };
  p.plaetze[0] = { typ: 'loops', gruppe: p.gruppen[0].id };   // container core: the deck sounds in the container its place holds, a deck no place holds is parked
  for (const s of p.spuren) s.zellen = Array.from({ length: 8 }, () => null);
  return p;
}

test('a cell change counts as a playback change (betrifft_wiedergabe), an unrelated name change does not', () => {
  const a = deck();
  const b = JSON.parse(JSON.stringify(a)); b.spuren[0].zellen[0] = zelle('z1');
  assert.equal(vergleiche(a, b).betrifft_wiedergabe, true);
  const c = JSON.parse(JSON.stringify(b)); c.spuren[0].zellen[0].gain_db = -6;
  assert.equal(vergleiche(b, c).betrifft_wiedergabe, true);
  const d = JSON.parse(JSON.stringify(b)); d.name = 'other';
  assert.equal(vergleiche(b, d).betrifft_wiedergabe, false);
});


// what the snapshot is built from: sha, kind, beats, gain and the slot; a rename or a recolour is no new playback
test('the playback view of a cell holds sha256, art, beats, gain_db and the slot only', () => {
  const a = deck(); a.spuren[0].zellen[2] = zelle('z1');
  const sicht = (p) => kanonisch(wiedergabeSicht(p));
  const mit = (f) => { const q = JSON.parse(JSON.stringify(a)); f(q.spuren[0].zellen[2]); return q; };
  assert.equal(sicht(mit((z) => { z.name = 'other'; })), sicht(a), 'name');
  assert.equal(sicht(mit((z) => { z.farbe = 9; })), sicht(a), 'farbe');
  assert.equal(vergleiche(a, mit((z) => { z.name = 'x'; z.farbe = 1; })).betrifft_wiedergabe, false);
  for (const [k, v] of [['gain_db', -6], ['art', 'einmal'], ['beats', 2], ['sha256', 'e'.repeat(64)]]) {
    assert.notEqual(sicht(mit((z) => { z[k] = v; })), sicht(a), k);
    assert.equal(vergleiche(a, mit((z) => { z[k] = v; })).betrifft_wiedergabe, true, k);
  }
  const b = JSON.parse(JSON.stringify(a)); b.spuren[0].zellen[3] = b.spuren[0].zellen[2]; b.spuren[0].zellen[2] = null;
  assert.notEqual(sicht(b), sicht(a), 'the slot');
});

// --- session part (a ProjSitzung on the core double: no studio port, no test instance lock) ---------------------------------------------------
function schreibeWav(datei, sek = 1) {
  const n = 48000 * sek, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 48000)), 44 + i * 2);
  fs.writeFileSync(datei, b);
}
// a stored live project whose only audio is one cell (sha SHA, the wav is the path hint)
async function oeffneDeck(t) {
  const e = sitzung(t);
  assert.equal((await e.s.neu('Dek', 'andreas')).code, 200);
  const slug = fs.readdirSync(e.wurzel)[0];
  const datei = path.join(e.wurzel, slug, 'project.json');
  fs.mkdirSync(path.join(e.wurzel, slug, 'audio'), { recursive: true });
  schreibeWav(path.join(e.wurzel, slug, 'audio', 'cell.wav'));
  const j = deck();
  j.spuren[0].zellen[0] = zelle('z1', { pfad_hinweis: 'audio/cell.wav' });
  j.naechste_id = { ...(j.naechste_id ?? {}), zelle: 2 };
  const alt = JSON.parse(fs.readFileSync(datei, 'utf8'));
  fs.writeFileSync(datei, JSON.stringify({ ...j, name: alt.name, rev: alt.rev ?? 0, wiedergabe_rev: alt.wiedergabe_rev ?? 0 }));
  return { ...e, slug };
}
const bis = async (f, n = 600) => { for (let i = 0; i < n; i++) { if (await f()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };

test('opening a deck project queues the decode of a fresh cell sha and the finished decode rebuilds the snapshot', async (t) => {
  const { s, arr, slug } = await oeffneDeck(t);
  const o = await s.oeffnen(slug, 'andreas');
  assert.equal(o.code, 200, JSON.stringify(o.j));
  const f32 = path.join(arr, 'audio', `${SHA}.f32`);
  assert.ok(await bis(() => fs.existsSync(f32)), 'the cell sha was decoded (queued from pfad_hinweis)');
  const snap = () => {
    const n = s.aktuell().j.projekt.wiedergabe_rev;
    try { return JSON.parse(fs.readFileSync(path.join(arr, `wiedergabe-${n}.json`), 'utf8')); } catch { return null; }
  };
  assert.ok(await bis(() => snap()?.spuren?.[0]?.zellen?.length === 1), `snapshot with the cell: ${JSON.stringify(snap())?.slice(0, 300)}`);
  const c = snap().spuren[0].zellen[0];
  assert.deepEqual([c.index, c.frames, c.modus, c.beats], [1, 48000, 2, 1]);
});

test('the decode of an open project\'s cell sha is protected from the size cap (offeneShas); a closed project protects nothing', async (t) => {
  const { s, slug } = await oeffneDeck(t);
  assert.equal(s.offeneShas().has(SHA), false, 'nothing open yet');
  assert.equal((await s.oeffnen(slug, 'andreas')).code, 200);
  assert.equal(s.offeneShas().has(SHA), true);
});

test('collecting a project takes the audio of its cells along (outside source copied into audio/)', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-ldein-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const proj = path.join(d, 'proj'), aussen = path.join(d, 'platte', 'Cell One.wav');
  fs.mkdirSync(proj, { recursive: true }); fs.mkdirSync(path.dirname(aussen), { recursive: true });
  fs.writeFileSync(aussen, 'cell-bytes');
  const sha = crypto.createHash('sha256').update('cell-bytes').digest('hex');
  const p = deck(); p.spuren[0].zellen[0] = zelle('z1', { sha256: sha });
  const b = await sammleEin({ projekt: p, projektOrdner: proj, quellPfad: (s) => (s === sha ? aussen : null) });
  assert.deepEqual([b.kopiert, b.fehlt], [1, []]);
  assert.equal(fs.readFileSync(path.join(proj, 'audio', `cell-one-${sha.slice(0, 8)}.wav`), 'utf8'), 'cell-bytes');
});
