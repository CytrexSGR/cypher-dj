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

// a live project with a loop deck of identity `platz` (1|2) in place `ort` (default: the same number), built as an object (not through the commands)
function deck(platz = 2, ort = platz) {
  let p = neuesProjekt('ld'); p.live = true; p.plaetze = [1, 2, 3, 4].map(() => ({ typ: 'leer' }));
  for (let i = 1; i <= 4; i++) p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: `L${platz}.${i}` }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'gruppenspur_neu', name: `LOOP ${platz}`, mitglieder: p.spuren.map((s) => s.id) }]).projekt;
  p = JSON.parse(JSON.stringify(p));
  p.gruppen[0].loopdeck = { platz, raster: 'takt' };
  for (const s of p.spuren) s.zellen = Array.from({ length: 8 }, () => null);
  p.plaetze = [1, 2, 3, 4].map((n) => (n === ort ? { typ: 'loops', gruppe: p.gruppen[0].id } : { typ: 'leer' }));
  return p;
}

test('a deck on place 2 plays into dj channel 2; its tracks carry id and zellen, nothing else does', () => {
  const p = deck(2);
  p.spuren[0].zellen[0] = zelle('z1');
  const w = uebersetze(p, opt());
  assert.deepEqual(w.gruppen[0].ausgang, { art: 'dj', nr: 2 });
  assert.equal(w.live, true);
  assert.equal(w.format, 'cypherdj-arr/4');
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

test('deck returns play into the container of the deck, also a generic return the deck owns; a production project writes the master', () => {
  let p = deck(1);
  p = fuehreListeAus(p, [{ befehl: 'loopdeck_send', spur_id: p.spuren[0].id, ziel: 'hall', db: -6 }, { befehl: 'return_neu' }]).projekt;
  const w = uebersetze(p, opt());
  const hall = p.returns.find((r) => r.loopdeck), plain = p.returns.find((r) => !r.loopdeck);
  assert.deepEqual(w.returns.find((r) => r.nr === hall.nr).ausgang, { art: 'dj', nr: 1 });
  assert.deepEqual(w.returns.find((r) => r.nr === plain.nr).ausgang, { art: 'dj', nr: 1 }, 'owned by the deck group');
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

test('the deck identity (loopdeck.platz) and the grid do not move the playback; only the place does', async () => {
  const { vergleiche } = await import('../project/commands.ts');
  const alt = deck(1);
  const platz = structuredClone(alt); platz.gruppen[0].loopdeck.platz = 2;
  assert.equal(vergleiche(alt, platz).betrifft_wiedergabe, false, 'identity is not the output; the place is');
  const raster = structuredClone(alt); raster.gruppen[0].loopdeck.raster = '1/2';
  assert.equal(vergleiche(alt, raster).betrifft_wiedergabe, false, 'grid change is server business');
});

const RETURNS = (platz) => [
  { id: 'r1', nr: 1, name: 'HALL', fader_db: 0, pan: 0, mute: false, loopdeck: { platz, art: 'hall' }, gruppe: 'g1' },
  { id: 'r2', nr: 2, name: 'DELAY', fader_db: 0, pan: 0, mute: false, loopdeck: { platz, art: 'delay' }, gruppe: 'g1' },
];
test('the place of the deck is the container it sounds in; HALL and DELAY returns follow the deck; a parked deck is not written', () => {
  const nr = (ort) => { const p = deck(1, ort); p.returns = RETURNS(1); const w = uebersetze(p, opt()); return [w.gruppen[0].ausgang.nr, w.returns.map((r) => r.ausgang.nr)]; };
  for (const ort of [1, 2, 3, 4]) assert.deepEqual(nr(ort), [ort, [ort, ort]], `place ${ort}`);
  const p = deck(2); assert.deepEqual(uebersetze(p, opt()).gruppen[0].ausgang, { art: 'dj', nr: 2 }, 'deck 2 in place 2');
  const parkt = deck(1); parkt.returns = RETURNS(1); parkt.plaetze = [1, 2, 3, 4].map(() => ({ typ: 'leer' }));
  const w = uebersetze(parkt, opt());
  assert.deepEqual([w.gruppen, w.spuren, 'returns' in w], [[], [], false]);
});

test('a place change moves the playback (new snapshot); the same place does not', async () => {
  const { vergleiche } = await import('../project/commands.ts');
  const alt = deck(1);
  const neu = structuredClone(alt); neu.plaetze = [1, 2, 3, 4].map((n) => (n === 4 ? { typ: 'loops', gruppe: neu.gruppen[0].id } : { typ: 'leer' }));
  assert.equal(vergleiche(alt, neu).betrifft_wiedergabe, true);
  assert.equal(vergleiche(alt, structuredClone(alt)).betrifft_wiedergabe, false);
});

// --- Session view S1b, B2 (index 2.2): the slice map, reverse, fade, pitch, keylock and envelopes of a cell ---------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARR_F_FILTER, arrFSend } from '../project/playback.ts';

const fx = (p, ...b) => fuehreListeAus(p, b).projekt;
// the deck 1 of a live project with HALL (nr 1) and DELAY (nr 2) returns of the deck, cell 1 on the first track (beats 8, bpm 120, 960000 frames)
function mitReturns(extra = {}) {
  let p = deck(1);
  p = fx(p, { befehl: 'loopdeck_send', spur_id: p.spuren[0].id, ziel: 'hall', db: -6 }, { befehl: 'loopdeck_send', spur_id: p.spuren[0].id, ziel: 'delay', db: -6 });
  p.spuren[0].zellen[0] = zelle('z1', extra);
  return p;
}
const kette = (p) => uebersetze(p, opt()).spuren[0].zellen[0];

test('the field numbers of the translator are the ones of the core header (arrangement.h)', () => {
  const h = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'include', 'cypherdj', 'arrangement.h'), 'utf8');
  const num = (n) => Number(new RegExp(`constexpr int ${n} = (\\d+);`).exec(h)[1]);
  assert.equal(ARR_F_FILTER, num('ARR_F_FILTER'));
  for (let r = 0; r < 8; r++) assert.equal(arrFSend(r), r < 4 ? num('ARR_F_SEND0') + r : num('ARR_F_SEND4') + (r - 4), `return ${r}`);
});

test('each S1b key appears with its numbers; the source slot index is 0-based, the field numbers resolve the deck returns', () => {
  const p = mitReturns({ rueckwaerts: true, blende: true, transponieren: 7,
    scheiben: { teilung: '1/8', grenzen: [0, 2, 4, 6], folge: [4, 3, 2, 1] },
    huellen: [{ ziel: 'filter', punkte: [{ beat: 0, wert: -1 }, { beat: 4, wert: 1, form: 's' }] }, { ziel: 'gain', punkte: [{ beat: 0, wert: -12, form: 'sprung' }] },
      { ziel: 'send.hall', punkte: [{ beat: 1, wert: -6 }] }, { ziel: 'send.delay', punkte: [{ beat: 2, wert: -200 }] }] });
  const c = kette(p);
  assert.equal(c.rueckwaerts, 1);
  assert.equal(c.blende, 1);
  assert.deepEqual(c.scheiben, [[0, 3], [2, 2], [4, 1], [6, 0]]);
  assert.equal(c.pitch, 2 ** (7 / 12));
  assert.equal(c.modus, 2);
  const hall = p.returns.find((r) => r.loopdeck.art === 'hall'), delay = p.returns.find((r) => r.loopdeck.art === 'delay');
  assert.deepEqual(c.huellen, [
    { art: 'feld', feld: 9, punkte: [[0, -1, 0], [4, 1, 1]] },
    { art: 'gain', punkte: [[0, -12, 2]] },
    { art: 'feld', feld: arrFSend(hall.nr - 1), punkte: [[1, -6, 0]] },
    { art: 'feld', feld: arrFSend(delay.nr - 1), punkte: [[2, -200, 0]] },
  ]);
  assert.deepEqual([arrFSend(hall.nr - 1), arrFSend(delay.nr - 1)], [4, 5]);
  assert.equal(c.beats, 8);
});

test('keylock off is the existing key modus 0 and writes no pitch; a one-shot keeps modus 0 and takes no pitch', () => {
  const c = kette(mitReturns({ keylock: false }));
  assert.equal(c.modus, 0);
  assert.ok(!('pitch' in c));
  const p = mitReturns(); p.spuren[0].zellen[1] = zelle('z2', { art: 'einmal', rueckwaerts: true });
  const e = uebersetze(p, opt()).spuren[0].zellen[1];
  assert.deepEqual([e.modus, e.rueckwaerts, 'pitch' in e], [0, 1, false]);
});

test('a cell without the fields writes exactly the keys of today, in the same order', () => {
  const c = kette(mitReturns());
  assert.deepEqual(Object.keys(c), ['index', 'sha256', 'datei', 'frames', 'beats', 'art', 'gain_db', 'modus']);
  const q = mitReturns(); q.spuren[0].zellen[1] = zelle('z2', { art: 'einmal', beats: undefined, bpm: undefined });
  delete q.spuren[0].zellen[1].beats; delete q.spuren[0].zellen[1].bpm;
  assert.deepEqual(uebersetze(q, opt()).spuren[0].zellen[1].beats, 0, 'a plain one-shot keeps beats 0');
});

test('a send envelope on a deck without that return is dropped with a note, not written', () => {
  let p = deck(1);
  p = fx(p, { befehl: 'loopdeck_send', spur_id: p.spuren[0].id, ziel: 'delay', db: -6 });   // DELAY exists, HALL does not
  p.spuren[0].zellen[0] = zelle('z1', { huellen: [{ ziel: 'send.hall', punkte: [{ beat: 0, wert: -6 }] }, { ziel: 'gain', punkte: [{ beat: 0, wert: -3 }] }] });
  const hinweise = [];
  const c = uebersetze(p, opt({ hinweise })).spuren[0].zellen[0];
  assert.deepEqual(c.huellen.map((h) => h.art), ['gain'], 'only the gain envelope is written');
  assert.equal(hinweise.length, 1);
  assert.match(hinweise[0], /z1.*send\.hall.*no HALL return/);
  const q = deck(1); q.spuren[0].zellen[0] = zelle('z1', { huellen: [{ ziel: 'send.hall', punkte: [{ beat: 0, wert: -6 }] }] });
  assert.ok(!('huellen' in uebersetze(q, opt({ hinweise: [] })).spuren[0].zellen[0]), 'the only envelope dropped: no huellen key');
});

test('beats of a cell that carries slices or envelopes but no beats come from frames and bpm (the loader needs beats > 0); a plain one-shot stays 0', () => {
  const p = deck(1);
  const roh = (extra) => { const z = zelle('z1', { art: 'einmal', sha256: SHA_B, ...extra }); delete z.beats; return z; };
  p.spuren[0].zellen[0] = roh({ scheiben: { teilung: '1/8', grenzen: [0, 1], folge: [2, 1] } });   // 48000 frames = 1 s at 120 bpm = 2 beats
  p.spuren[0].zellen[1] = roh({ huellen: [{ ziel: 'gain', punkte: [{ beat: 1.5, wert: -3 }] }] });
  p.spuren[0].zellen[2] = roh({});
  const z = uebersetze(p, opt()).spuren[0].zellen;
  assert.deepEqual(z.map((c) => c.beats), [2, 2, 0]);
  assert.deepEqual(z[0].scheiben, [[0, 1], [1, 0]]);
  // without bpm the project tempo stands in (as zellBeats of the page does)
  const q = deck(1); const r = roh({ scheiben: { teilung: '1/8', grenzen: [0, 1], folge: [1, 2] } }); delete r.bpm; q.spuren[0].zellen[0] = r;
  assert.equal(uebersetze(q, opt()).spuren[0].zellen[0].beats, 48000 / 48000 * q.tempo_bpm / 60);
});

// the rules of the core loader (zelle_erweitern in arr_playback.cpp), applied to what the translator wrote
function ladeRegeln(c) {
  const fehl = [];
  const loop = c.art === 'loop';
  if (c.scheiben) {
    const n = c.scheiben.length;
    if (n > 64) fehl.push('64 slots');
    if (!(c.beats > 0)) fehl.push('scheiben need beats > 0');
    c.scheiben.forEach(([start, src], i) => {
      if (!Number.isInteger(src) || src < 0 || src >= n) fehl.push(`source slot ${i}`);
      if (i === 0 ? start !== 0 : !(start > c.scheiben[i - 1][0])) fehl.push(`start ${i}`);
      if (!(start < c.beats)) fehl.push(`start beyond ${i}`);
    });
    const g = c.scheiben.map(([s]) => Math.round(s * c.frames / c.beats)); g.push(c.frames);
    for (let i = 0; i < n; i++) if (g[i + 1] - g[i] < 192) fehl.push(`slot ${i} shorter than 192 frames`);
  }
  if ('pitch' in c && !(loop && c.modus === 2 && c.pitch >= 0.25 - 1e-9 && c.pitch <= 4 + 1e-9)) fehl.push('pitch');
  if (c.huellen) {
    if (c.huellen.length > 4) fehl.push('4 envelopes');
    const ziele = new Set();
    for (const h of c.huellen) {
      const k = h.art === 'gain' ? 'gain' : `f${h.feld}`;
      if (ziele.has(k)) fehl.push('one envelope per target'); ziele.add(k);
      if (h.art === 'feld' && h.feld !== 9 && !(h.feld >= 4 && h.feld <= 7) && !(h.feld >= 13 && h.feld <= 16)) fehl.push('feld');
      if (h.punkte.length < 1 || h.punkte.length > 64) fehl.push('points');
      h.punkte.forEach(([b, w, f], i) => {
        if (b < 0 || (i > 0 && b < h.punkte[i - 1][0]) || !(b < c.beats)) fehl.push('beat');
        const [lo, hi] = h.art === 'feld' && h.feld === 9 ? [-1, 1] : [-200, 0];
        if (!(w >= lo && w <= hi)) fehl.push('value');
        if (![0, 1, 2].includes(f)) fehl.push('form');
        if (i > 1 && b === h.punkte[i - 1][0] && b === h.punkte[i - 2][0]) fehl.push('three at one beat');
      });
    }
  }
  return fehl;
}

test('what the model accepts passes the loader rules; what only the decoded length reveals (slot under 192 frames) is dropped with a note', () => {
  const p = mitReturns({ transponieren: -5, scheiben: { teilung: '1/16', grenzen: [0, 0.25, 7.75], folge: [3, 1, 2] },
    huellen: [{ ziel: 'filter', punkte: [{ beat: 0, wert: 0 }, { beat: 7.9, wert: 1 }] }] });
  assert.deepEqual(ladeRegeln(kette(p)), []);
  // a one-shot without bpm: the model cannot know the source tempo, the translator measures with the decoded frames (48000 frames, 2 beats at the project tempo)
  const q = deck(1);
  const e = zelle('z1', { art: 'einmal', sha256: SHA_B, beats: 2, scheiben: { teilung: '1/16', grenzen: [0, 0.001], folge: [2, 1] } }); delete e.bpm;
  q.spuren[0].zellen[0] = e;
  const hinweise = [];
  const c = uebersetze(q, opt({ hinweise })).spuren[0].zellen[0];
  assert.ok(!('scheiben' in c), 'the 24-frame slot would make the core refuse the whole snapshot: the slice map is not written');
  assert.match(hinweise.join('\n'), /z1.*scheiben.*192 frames/);
  assert.deepEqual(ladeRegeln(c), []);
});

test('wiedergabeSicht sees the S1b fields (an edit is a new playback) and still ignores a rename', async () => {
  const { vergleiche } = await import('../project/commands.ts');
  const alt = mitReturns();
  const neu = (f) => { const q = structuredClone(alt); Object.assign(q.spuren[0].zellen[0], f); return q; };
  for (const f of [{ transponieren: 2 }, { rueckwaerts: true }, { blende: true }, { keylock: false },
    { scheiben: { teilung: '1/8', grenzen: [0, 4], folge: [2, 1] } }, { huellen: [{ ziel: 'gain', punkte: [{ beat: 0, wert: -3 }] }] }]) {
    assert.equal(vergleiche(alt, neu(f)).betrifft_wiedergabe, true, JSON.stringify(f));
  }
  assert.equal(vergleiche(alt, neu({ name: 'other' })).betrifft_wiedergabe, false);
});

test('review: what the model would refuse but reaches the translator past it drops only that part (envelope, pitch), never the snapshot', () => {
  const huelle = (ziel, punkte) => ({ ziel, punkte });
  const gut = huelle('gain', [{ beat: 0, wert: -3 }]);
  const faelle = [
    ['falling beats', huelle('filter', [{ beat: 2, wert: 0 }, { beat: 1, wert: 0 }])],
    ['three points at one beat', huelle('filter', [{ beat: 1, wert: 0 }, { beat: 1, wert: 0.5 }, { beat: 1, wert: 1 }])],
    ['value out of range', huelle('filter', [{ beat: 0, wert: 3 }])],
    ['unknown form', huelle('filter', [{ beat: 0, wert: 0, form: 'zickzack' }])],
    ['too many points', huelle('filter', Array.from({ length: 65 }, (_, i) => ({ beat: i * 0.1, wert: 0 })))],
  ];
  for (const [was, schlecht] of faelle) {
    const hinweise = [];
    const p = mitReturns({ huellen: [gut, schlecht] });
    const c = uebersetze(p, opt({ hinweise })).spuren[0].zellen[0];
    assert.deepEqual(c.huellen.map((x) => x.art), ['gain'], `${was}: only the good envelope is written`);
    assert.match(hinweise.join('\n'), /z1.*filter envelope not written/, was);
    assert.deepEqual(ladeRegeln(c), [], was);
  }
  // a second envelope for one target and a fifth envelope
  const dup = [];
  const c2 = uebersetze(mitReturns({ huellen: [gut, huelle('gain', [{ beat: 1, wert: -6 }])] }), opt({ hinweise: dup })).spuren[0].zellen[0];
  assert.equal(c2.huellen.length, 1);
  assert.match(dup.join('\n'), /gain envelope not written/);
  const c5 = uebersetze(mitReturns({ huellen: [gut, huelle('filter', [{ beat: 0, wert: 0 }]), huelle('send.hall', [{ beat: 0, wert: -6 }]), huelle('send.delay', [{ beat: 0, wert: -6 }], ), huelle('gain', [{ beat: 2, wert: -1 }])] }), opt({ hinweise: [] })).spuren[0].zellen[0];
  assert.deepEqual(ladeRegeln(c5), []);
  assert.ok(c5.huellen.length <= 4);
  // pitch out of range: the key is left out with a note, the rest of the cell stays
  const ph = [];
  const c3 = uebersetze(mitReturns({ transponieren: 30 }), opt({ hinweise: ph })).spuren[0].zellen[0];
  assert.ok(!('pitch' in c3));
  assert.match(ph.join('\n'), /z1.*transponieren not written/);
  assert.equal(c3.frames, 960000);
  assert.ok('pitch' in kette(mitReturns({ transponieren: -24 })) && kette(mitReturns({ transponieren: -24 })).pitch === 0.25);
});
