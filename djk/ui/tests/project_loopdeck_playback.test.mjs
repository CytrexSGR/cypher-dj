// Loop deck M3: the translator writes the cells of a loop deck group into the playback snapshot (index 1.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { uebersetze } from '../project/playback.ts';
import { neuesProjekt, LOOP_MAX_FRAMES } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { specProjekt, SHA_A, SHA_B } from './support/project.mjs';

const AUDIO = '/arbeit/arr/audio';
const SHA_C = 'c'.repeat(64);
const opt = (extra = {}) => ({ nr: 1, audioOrdner: AUDIO, frames: (sha) => (sha === SHA_A ? 960000 : sha === SHA_B ? 48000 : null), ...extra });
const zelle = (id, extra = {}) => ({ id, name: 'Loop', farbe: 3, art: 'loop', sha256: SHA_A, beats: 8, bpm: 120, gain_db: -3, ...extra });

// a live project with a loop deck on `platz`, built as an object (not through the commands)
function deck(platz = 2) {
  let p = neuesProjekt('ld'); p.live = true;
  for (let i = 1; i <= 4; i++) p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: `L${platz}.${i}` }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'gruppenspur_neu', name: `LOOP ${platz}`, mitglieder: p.spuren.map((s) => s.id) }]).projekt;
  p = JSON.parse(JSON.stringify(p));
  p.gruppen[0].loopdeck = { platz, raster: 'takt' };
  for (const s of p.spuren) s.zellen = Array.from({ length: 8 }, () => null);
  return p;
}

test('a deck on place 2 plays into dj channel 2; its tracks carry id and zellen, nothing else does', () => {
  const p = deck(2);
  p.spuren[0].zellen[0] = zelle('z1');
  const w = uebersetze(p, opt());
  assert.deepEqual(w.gruppen[0].ausgang, { art: 'dj', nr: 2 });
  assert.equal(w.live, true);
  assert.deepEqual(w.spuren.map((s) => s.id), p.spuren.map((s) => s.id));
  assert.deepEqual(w.spuren[0].zellen, [{ index: 1, sha256: SHA_A, datei: `${AUDIO}/${SHA_A}.f32`, frames: 960000, beats: 8, art: 'loop', gain_db: -3, modus: 2 }]);
  for (const s of w.spuren.slice(1)) assert.deepEqual(s.zellen, []);
  // negative control: a plain track of the same project has neither key
  const q = specProjekt(); const o = uebersetze(q, opt());
  for (const s of o.spuren) assert.deepEqual(['id' in s, 'zellen' in s], [false, false]);
});

test('place 1 plays into dj channel 1', () => {
  assert.deepEqual(uebersetze(deck(1), opt()).gruppen[0].ausgang, { art: 'dj', nr: 1 });
});

test('only filled cells with known frames are written; index is the 1-based slot', () => {
  const p = deck(1);
  p.spuren[1].zellen[2] = zelle('z1');
  p.spuren[1].zellen[4] = zelle('z2', { sha256: SHA_C });   // frames unknown: left out
  p.spuren[1].zellen[7] = zelle('z3', { sha256: SHA_B, beats: 2 });
  const z = uebersetze(p, opt()).spuren[1].zellen;
  assert.deepEqual(z.map((c) => c.index), [3, 8]);
});

test('einmal has modus 0 and beats 0 when it has none (the core loader wants beats on every cell)', () => {
  const p = deck(1);
  p.spuren[0].zellen[0] = zelle('z1', { art: 'einmal', beats: undefined, bpm: undefined });
  delete p.spuren[0].zellen[0].beats; delete p.spuren[0].zellen[0].bpm;
  const c = uebersetze(p, opt()).spuren[0].zellen[0];
  assert.deepEqual([c.art, c.modus, c.beats], ['einmal', 0, 0]);
});

test('a cell longer than LOOP_MAX_FRAMES (60 s) is left out, one of exactly the limit stays', () => {
  const p = deck(1);
  p.spuren[0].zellen[0] = zelle('z1', { sha256: SHA_A });
  p.spuren[0].zellen[1] = zelle('z2', { sha256: SHA_B });
  p.spuren[0].zellen[2] = zelle('z3', { sha256: SHA_C });
  const frames = (sha) => (sha === SHA_A ? LOOP_MAX_FRAMES + 1 : sha === SHA_B ? LOOP_MAX_FRAMES : 48000);
  assert.deepEqual(uebersetze(p, opt({ frames })).spuren[0].zellen.map((c) => c.index), [2, 3]);
});

test('the filter is not in the snapshot', () => {
  const p = deck(1); p.spuren[0].zellen[0] = zelle('z1');
  const a = uebersetze(p, opt());
  p.spuren[0].filter = 0.7;
  assert.deepEqual(uebersetze(p, opt()), a);
  assert.ok(!JSON.stringify(a).includes('filter'));
});

test('eq and kill are control rows, not in the snapshot', () => {
  const p = deck(1); p.spuren[0].zellen[0] = zelle('z1');
  const a = uebersetze(p, opt());
  p.spuren[0].eq = { tief: -3, mitte: 0, hoch: 2 }; p.spuren[0].kill = { mitte: true };
  assert.deepEqual(uebersetze(p, opt()), a);
});

test('deck returns play into the deck DJ channel, a plain return into the master', () => {
  let p = deck(1);
  p = fuehreListeAus(p, [{ befehl: 'loopdeck_send', spur_id: p.spuren[0].id, ziel: 'hall', db: -6 }, { befehl: 'return_neu' }]).projekt;
  const w = uebersetze(p, opt());
  const hall = p.returns.find((r) => r.loopdeck), plain = p.returns.find((r) => !r.loopdeck);
  assert.deepEqual(w.returns.find((r) => r.nr === hall.nr).ausgang, { art: 'dj', nr: 1 });
  assert.deepEqual(w.returns.find((r) => r.nr === plain.nr).ausgang, { art: 'master' });
  const q = JSON.parse(JSON.stringify(p)); delete q.live;   // never without the live flag (the model refuses it, the translator stays safe)
  assert.deepEqual(uebersetze(q, opt()).returns.find((r) => r.nr === hall.nr).ausgang, { art: 'master' });
});

test('a project without a deck translates exactly as before', () => {
  const p = specProjekt();
  const w = uebersetze(p, opt());
  assert.deepEqual(w, {
    format: 'cypherdj-arr/1', nr: 1,
    spuren: [
      { nr: 1, art: 'audio', clips: [{ id: 'c1', start_beat: 0, laenge_beats: 1, sha256: SHA_A, datei: `${AUDIO}/${SHA_A}.f32`, frames: 960000,
        offset_frames: 0, gain_db: 0, ein_beats: 0, aus_beats: 0 }] },
      { nr: 2, art: 'intern', geraet: 'rb338', parameter: {}, noten: [{ id: 'c2/n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }] },
      { nr: 3, art: 'wirt', slot: 1, noten: [] },
    ],
  });
  assert.equal(JSON.stringify(w).includes('zellen'), false);
});

test('the playback view of groups carries loopdeck.platz (a new snapshot), not the grid', async () => {
  const { vergleiche } = await import('../project/commands.ts');
  const alt = deck(1);
  const platz = structuredClone(alt); platz.gruppen[0].loopdeck.platz = 2;
  assert.equal(vergleiche(alt, platz).betrifft_wiedergabe, true, 'place change moves the DJ channel');
  const raster = structuredClone(alt); raster.gruppen[0].loopdeck.raster = '1/2';
  assert.equal(vergleiche(alt, raster).betrifft_wiedergabe, false, 'grid change is server business');
});

const RETURNS = (platz) => [
  { id: 'r1', nr: 1, name: 'HALL', fader_db: 0, pan: 0, mute: false, loopdeck: { platz, art: 'hall' } },
  { id: 'r2', nr: 2, name: 'DELAY', fader_db: 0, pan: 0, mute: false, loopdeck: { platz, art: 'delay' } },
];
test('ausgang_platz maps the place to the DJ channel (3 = pad/1, 4 = pad/2, 1 = deck/1, 2 = deck/2); HALL and DELAY returns follow the deck', () => {
  const nr = (ap) => { const p = deck(1); p.returns = RETURNS(1); if (ap) p.gruppen[0].loopdeck.ausgang_platz = ap; const w = uebersetze(p, opt()); return [w.gruppen[0].ausgang.nr, w.returns.map((r) => r.ausgang.nr)]; };
  assert.deepEqual(nr(0), [1, [1, 1]], 'absent: the deck number');
  assert.deepEqual(nr(3), [1, [1, 1]]);
  assert.deepEqual(nr(4), [2, [2, 2]], 'deck 1 shown in place 4 sounds on pad/2');
  assert.deepEqual(nr(1), [3, [3, 3]], 'place 1 = deck/1');
  assert.deepEqual(nr(2), [4, [4, 4]], 'place 2 = deck/2');
  const p = deck(2); assert.deepEqual(uebersetze(p, opt()).gruppen[0].ausgang, { art: 'dj', nr: 2 }, 'deck 2 default: pad/2');
});

test('an output change moves the playback (new snapshot); writing the default explicitly does not', async () => {
  const { vergleiche } = await import('../project/commands.ts');
  const alt = deck(1);
  const neu = structuredClone(alt); neu.gruppen[0].loopdeck.ausgang_platz = 4;
  assert.equal(vergleiche(alt, neu).betrifft_wiedergabe, true);
  const gleich = structuredClone(alt); gleich.gruppen[0].loopdeck.ausgang_platz = 3;
  assert.equal(vergleiche(alt, gleich).betrifft_wiedergabe, false);
});
