// Tracker task 14: effect commands in the playback file, the limit and the device description (geraetFx).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uebersetze, WiedergabeFehler, WIEDERGABE_FORMAT, WIEDERGABE_FORMAT_2 } from '../project/playback.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { MAX_FX_PUNKTE, pruefeFehler } from '../project/model.ts';
import { geraetFx, pruefeGeraete } from '../devices_parameter.ts';
import { ohneFx, ohneFxEinfach, BK, KIT, lauf, note } from './support/fx_basis.mjs';

const e = (beat, spalte, code, wert) => ({ beat, spalte, code, wert });
const fx = (clipId, ...eintraege) => ({ befehl: 'fx_setzen', clip_id: clipId, eintraege });
const GLATT = () => ({ stufig: false, rollen: {} });
const ROLLEN = () => ({ stufig: false, rollen: { slot: 3, start: 5, rueckwaerts: 6 } });
const STUFIG = () => ({ stufig: true, rollen: {} });
const spiel = (p, gf = GLATT) => uebersetze(p, { nr: 1, audioOrdner: '@A@', frames: () => 400000, geraetFx: gf });
const sha = (w) => crypto.createHash('sha256').update(JSON.stringify(w)).digest('hex');
const spur = (w, nr) => w.spuren.find((s) => s.nr === nr);
const gleich = (a, b, msg) => {
  assert.equal(a.length, b.length, msg);
  a.forEach((x, i) => { assert.ok(Math.abs(x[0] - b[i][0]) < 1e-9 && x[1] === b[i][1] && x[2] === b[i][2], `${msg} at ${i}: ${x} vs ${b[i]}`); });
};
const lane = (s, ziel) => s.auto?.find((l) => l.ziel === ziel);

// pinned before the effect code existed (old translator output of the same projects, tests/support/fx_basis.mjs)
const HASH_ZUSAMMEN = 'e46fa08e60805c91838c3450d79a4ea5128bb952f20c769bb517c7ba173df9b7';
const HASH_EINFACH = '6839d3ef6ad1c970b4a0ac719d0cb553ee6430600f38bc6a30472e14604825b1';

test('a project without fx writes byte for byte the old playback file, and /1 stays /1', () => {
  const z = spiel(ohneFx()), ein = spiel(ohneFxEinfach());
  assert.equal(z.format, WIEDERGABE_FORMAT_2);
  assert.equal(sha(z), HASH_ZUSAMMEN);
  assert.equal(ein.format, WIEDERGABE_FORMAT);
  assert.equal(sha(ein), HASH_EINFACH);
  // the device description changes nothing without fx
  assert.equal(sha(spiel(ohneFx(), STUFIG)), HASH_ZUSAMMEN);
  assert.equal(sha(spiel(ohneFx(), ROLLEN)), HASH_ZUSAMMEN);
  for (const w of [z, ein]) for (const s of w.spuren) assert.ok(!('bend' in s) && !('pegel' in s));
  // an fx list that was set and removed again leaves no trace
  let p = lauf(ohneFx(), fx('c1', e(1, 0, 'VIB', 0x46)));
  p = lauf(p, fx('c1', { beat: 1, spalte: 0, code: null }));
  assert.equal(sha(spiel(p)), HASH_ZUSAMMEN);
});

test('a bk track with VIB carries bend (a smooth device: glides of one tick); the file becomes /2', () => {
  const ein = lauf(ohneFxEinfach(), fx('c1', e(1, 0, 'VIB', 0x46)));
  const w = spiel(ein);
  assert.equal(w.format, WIEDERGABE_FORMAT_2, 'bend forces /2');
  assert.ok(Array.isArray(w.gruppen));
  const s = spur(w, 1);
  assert.ok(s.bend.length > 4);
  assert.ok(!('pegel' in s), 'no level event without a level command');
  const tk = 1 / 24;   // lpb 4, ticks 6
  assert.deepEqual(s.bend[0], [1, s.bend[0][1], s.bend[0][2]]);
  for (const [beat, st, gleit] of s.bend) { assert.ok(beat >= 0 && Number.isFinite(st) && gleit >= 0); assert.ok(Math.abs(gleit - tk) < 1e-9 || gleit === 0); }
  assert.ok(s.bend.every((x, i, l) => i === 0 || l[i - 1][0] <= x[0]), 'sorted by beat');
  assert.equal(s.bend.at(-1)[1], 0, 'the pitch returns to neutral at the end of the row');
});

test('a kit, an rb338 and a track with another device get no bend and no pegel', () => {
  let p = lauf(ohneFx(), fx('c2', e(1, 0, 'VIB', 0x46), e(2, 0, 'LVL', 64)), fx('c3', e(0, 0, 'VIB', 0x46)));
  const w = spiel(p, ROLLEN);
  for (const nr of [2, 3]) { assert.ok(!('bend' in spur(w, nr)) && !('pegel' in spur(w, nr)), `track ${nr}`); assert.ok(!lane(spur(w, nr), 'geraet.k5')); }
  p = lauf(ohneFx(), fx('c1', e(1, 0, 'VIB', 0x46)));
  assert.ok(spur(spiel(p), 1).bend.length > 0, 'the bk track of the same project does');
});

test('each command: SLU glides, LVL sets the level, ARP jumps per tick on any device, a stepped device jumps per tick', () => {
  const einz = (code, wert) => spur(spiel(lauf(ohneFxEinfach(), fx('c1', e(1, 0, code, wert)))), 1);
  const slu = einz('SLU', 0x20);
  assert.deepEqual(slu.bend, [[1, 12, 0.25], [4, 0, 0]], 'a rise over the row (to 12 semitones), neutral again at the clip end');
  const lvl = einz('LVL', 128);
  assert.equal(lvl.pegel[0][0], 1);
  assert.ok(Math.abs(lvl.pegel[0][1] - 128 / 255) < 1e-12);
  const arp = einz('ARP', 0x37);
  assert.ok(arp.bend.length >= 4 && arp.bend.every((x) => x[2] === 0), 'ARP is a jump per tick');
  const stufig = spur(spiel(lauf(ohneFxEinfach(), fx('c1', e(1, 0, 'VIB', 0x46))), STUFIG), 1);
  assert.ok(stufig.bend.every((x) => x[2] === 0), 'a stepped device: jumps only');
  assert.ok(stufig.bend.length > 4);
});

test('OFS and REV on a device with roles add absolute lanes geraet.k<n>; without roles nothing is added', () => {
  const p = lauf(ohneFxEinfach(), fx('c1', e(0, 0, 'OFS', 128), e(0, 1, 'REV', 1)));
  const w = spiel(p, ROLLEN);
  const s = spur(w, 1);
  assert.deepEqual(lane(s, 'geraet.k5').punkte, [[0, 0.5, 2], [4, 0, 2]], 'start offset 128/256, then neutral at the clip end');
  assert.deepEqual(lane(s, 'geraet.k6').punkte, [[0, 1, 2], [4, 0, 2]], 'reverse on, then neutral at the clip end');
  assert.equal(w.format, WIEDERGABE_FORMAT_2, 'a lane forces /2 as before');
  assert.equal(spur(spiel(p), 1).auto, undefined, 'a smooth device without roles: no lane');
});

test('PAN: a jump to the value at the row and back to the track value at the clip end; it wins inside the clip over a pan lane', () => {
  let p = lauf(ohneFxEinfach(), { befehl: 'spur_aendern', spur_id: 's1', pan: -0.25 }, fx('c1', e(1, 0, 'PAN', 255), e(2, 0, 'PAN', 0)));
  const s = spur(spiel(p), 1);
  assert.deepEqual(lane(s, 'pan').punkte, [[0, -0.25, 2], [1, 1, 2], [2, -1, 2], [4, -0.25, 2]]);
  // a pan lane of the track: outside the clip it stays, inside the clip PAN wins, after the clip end the lane value of that beat is back
  let q = ohneFxEinfach();
  q = lauf(q, { befehl: 'clip_aendern', clip_id: 'c1', start_beat: 2, laenge_beats: 2 });
  q = lauf(q, { befehl: 'auto_neu', spur_id: 's1', ziel: 'pan', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 0.8 }] }, fx('c1', e(0, 0, 'PAN', 255)));
  const pan = lane(spur(spiel(q), 1), 'pan').punkte;
  assert.deepEqual(pan.map((x) => [x[0], x[1]]), [[0, 0], [2, 1], [4, 0.4], [8, 0.8]], 'before the clip the lane, then the jump, back to the lane value at beat 4 (0.4)');
  assert.equal(pan[2][2], 2);
});

test('the loop copies of a clip roll out equal and a linked clip rolls out like its twin', () => {
  let p = lauf(ohneFxEinfach(), { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 8, loop_beats: 4 }, fx('c1', e(1, 0, 'SLU', 0x20)));
  const s = spur(spiel(p), 1);
  const erste = s.bend.filter((x) => x[0] > 0 && x[0] <= 4), zweite = s.bend.filter((x) => x[0] > 4 && x[0] <= 8).map((x) => [x[0] - 4, x[1], x[2]]);
  assert.ok(erste.length > 0);
  gleich(zweite, erste, 'copy 1 equals copy 0, shifted by the loop length');
  // linked clips: the fan-out puts the same entries into both
  let q = lauf(ohneFxEinfach(), { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 8, laenge_beats: 4, noten: [note('e9', 0, 1, 60)] });
  q = lauf(q, { befehl: 'clip_verknuepfen', clip_id: 'c2', mit: 'c1' }, fx('c1', e(1, 0, 'VIB', 0x46), e(2, 0, 'LVL', 64)));
  const t = spur(spiel(q), 1);
  const a = t.bend.filter((x) => x[0] > 0 && x[0] <= 4), b = t.bend.filter((x) => x[0] >= 8 && x[0] <= 12).map((x) => [x[0] - 8, x[1], x[2]]);
  assert.ok(a.length > 0);
  gleich(b, a, 'linked clip bend');
  const pa = t.pegel.filter((x) => x[0] <= 4), pb = t.pegel.filter((x) => x[0] >= 8 && x[0] <= 12).map((x) => [x[0] - 8, x[1], x[2]]);
  gleich(pb, pa, 'linked clip pegel');
});

test('the pitch state of a clip ends with the clip: the next clip starts neutral', () => {
  const p = lauf(ohneFxEinfach(), { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 4, laenge_beats: 4, noten: [note('e9', 0, 1, 60)] },
    fx('c1', e(3, 0, 'SLU', 0x20)));
  const s = spur(spiel(p), 1);
  const bei4 = s.bend.filter((x) => x[0] === 4);
  assert.deepEqual(bei4, [[4, 0, 0]]);
});

test('the limit: more pitch and level events than MAX_FX_PUNKTE after unrolling are refused with the number in the text', () => {
  assert.equal(MAX_FX_PUNKTE, 65536);
  let p = lauf(ohneFxEinfach(), { befehl: 'tracker_setzen', lpb: 16, ticks: 24 }, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 256 });
  const eintraege = Array.from({ length: 4096 }, (_, i) => e(i / 16, 0, 'VIB', 0x46));
  let fehler = null;
  try { fuehreListeAus(p, [fx('c1', ...eintraege)], { geraetFx: STUFIG }); } catch (x) { fehler = x; }
  assert.ok(fehler instanceof BefehlFehler, String(fehler));
  assert.equal(fehler.grund, 'zu_gross');
  assert.match(String(fehler.detail ?? fehler.message), /after unrolling \d+ pitch and level events \(at most 65536\)/);
  assert.ok(Number(/unrolling (\d+) pitch/.exec(String(fehler.detail ?? fehler.message))[1]) > MAX_FX_PUNKTE);
  // a short list on a smooth device is far below the limit and goes through; the translator refuses what the command check would
  const ok = fuehreListeAus(p, [fx('c1', ...eintraege.slice(0, 100))], { geraetFx: GLATT }).projekt;
  assert.equal(pruefeFehler(ok), null);
  assert.ok(spur(spiel(ok, GLATT), 1).bend.length < MAX_FX_PUNKTE);
  const q = structuredClone(p); q.spuren[0].clips[0].fx = eintraege;
  assert.throws(() => spiel(q, STUFIG), (x) => x instanceof WiedergabeFehler && x.grund === 'zu_gross' && /pitch and level events \(at most 65536\)/.test(x.message));
});

test('geraetFx reads the register: stufig and roles, amiga-* takes the amiga entry, an unknown graph is smooth without roles', () => {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-fx-'));
  try {
    const dir = path.join(wurzel, 'djk', 'instruments', 'modular_dsp');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'geraete.json'), JSON.stringify([
      { name: 'amiga', art: 'bk', familie: 'poly', akzent: 'blau', doku: 'x.md', fx_stufig: true, rollen: { slot: 1, start: 2, rueckwaerts: 3 } },
      { name: 'synth-mono', art: 'bk', familie: 'mono', akzent: 'orange', doku: 'x.md', rollen: { start: 9, slot: 99, bogus: 1 } },
      { name: 'rb338', art: 'rb338', familie: 'mono', akzent: 'gelb', doku: 'x.md' },
    ]));
    assert.deepEqual(geraetFx('amiga', wurzel), { stufig: true, rollen: { slot: 1, start: 2, rueckwaerts: 3 } });
    assert.deepEqual(geraetFx('amiga-bank7', wurzel), { stufig: true, rollen: { slot: 1, start: 2, rueckwaerts: 3 } });
    assert.deepEqual(geraetFx('synth-mono', wurzel), { stufig: false, rollen: { start: 9 } }, 'a knob outside 1..64 and an unknown role are ignored');
    assert.deepEqual(geraetFx('nicht-da', wurzel), { stufig: false, rollen: {} });
    assert.deepEqual(geraetFx('rb338', wurzel), { stufig: false, rollen: {} }, 'only bk entries count');
    assert.deepEqual(geraetFx('amiga', path.join(wurzel, 'leer')), { stufig: false, rollen: {} }, 'no register: smooth, no roles');
    const f = pruefeGeraete(wurzel).filter((m) => /rollen|fx_stufig/.test(m));
    assert.equal(f.length, 1, f.join('|'));
    assert.match(f[0], /synth-mono: rollen must be/);
  } finally { fs.rmSync(wurzel, { recursive: true, force: true }); }
});
