// Session view S1b task B3: slice boundaries of a cell (project/scheiben.ts) and POST /session/scheiben. The core side is a double as in
// session_route.test.mjs; the transients come from a hook (seconds of the source), so no audio file is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveAufbau } from './support/live_module.mjs';
import { loopdeckBereich } from '../areas/live/loopdeck.ts';
import { sessionBereich } from '../areas/live/session.ts';
import { scheibenGrenzen, zellBeatsAusFrames } from '../project/scheiben.ts';
import { zellFehler } from '../project/model.ts';
import { grundText } from '../http/reasons.ts';

const SHA = 'a'.repeat(64);
const frames = (sha) => (sha === SHA ? 96000 : null);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });
const rising = (g) => g.every((x, i) => i === 0 ? x === 0 : x > g[i - 1]);

test('grid boundaries: 4 beats at 1/16 are 16 boundaries 0..3.75; 1/8 and takt follow their step', () => {
  const g = scheibenGrenzen('1/16', 4, null);
  assert.equal(g.length, 16);
  assert.deepEqual([g[0], g[1], g[15]], [0, 0.25, 3.75]);
  assert.deepEqual(scheibenGrenzen('1/8', 4, null), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(scheibenGrenzen('takt', 16, null), [0, 4, 8, 12]);
});

test('16 beats at 1/16 are exactly 64; 32 beats are capped to 64 by merging, still starting at 0 and rising inside the cell', () => {
  assert.equal(scheibenGrenzen('1/16', 16, null).length, 64);
  const g = scheibenGrenzen('1/16', 32, null);
  assert.equal(g.length, 64);
  assert.ok(rising(g));
  assert.ok(g.at(-1) < 32);
  assert.deepEqual(scheibenGrenzen('1/16', 32, null), g, 'deterministic');
});

test('transients: 0 plus each transient at least 0.125 beats after the previous boundary; closer ones collapse', () => {
  assert.deepEqual(scheibenGrenzen('transienten', 4, [0.5, 0.55, 0.6, 1, 1.1, 1.125, 3]), [0, 0.5, 1, 1.125, 3]);
  assert.deepEqual(scheibenGrenzen('transienten', 4, [0.05, 2]), [0, 2], 'a transient within 0.125 beats of 0 collapses into the start');
  assert.deepEqual(scheibenGrenzen('transienten', 4, [2, 4, 5]), [0, 2], 'at or beyond the cell length is dropped');
});

test('transients on silence (none found, or no decoded source) give [0]', () => {
  assert.deepEqual(scheibenGrenzen('transienten', 4, []), [0]);
  assert.deepEqual(scheibenGrenzen('transienten', 4, null), [0]);
});

test('more than 64 transients are capped to 64 by merging the closest pairs', () => {
  const t = Array.from({ length: 200 }, (_, i) => 0.2 + i * 0.15);
  const g = scheibenGrenzen('transienten', 40, t);
  assert.equal(g.length, 64);
  assert.ok(rising(g));
});

async function aufbau(t, { transienten, frames: framesHook = frames } = {}) {
  const z = await liveAufbau(t);
  const kern = { gesendet: [], id: 1000, ki: false, quelle: 'andreas' };
  const ctx = { ...z.ctx,
    sende(adresse, felder) { const id = ++kern.id; kern.gesendet.push({ id, adresse, felder: { ...felder } }); return id; },
    async warteQuittung() { return { status: 1, grund: '' }; },
    kiGestoppt: () => kern.ki, quelle: () => kern.quelle };
  ctx.verteile = () => {};
  const ld = loopdeckBereich(ctx, z.zugang, { jetzt: () => 5000, frames: framesHook });
  const bereich = sessionBereich(ctx, z.zugang, ld, { frames: framesHook, transienten, ladenGesperrt: () => false });
  await z.aendern([{ befehl: 'loopdeck_neu', platz: 1 }]);
  const s = z.projekt().spuren.filter((x) => x.zellen);
  await z.aendern([
    { befehl: 'zelle_setzen', spur_id: s[0].id, index: 1, zelle: Z() },
    { befehl: 'zelle_setzen', spur_id: s[1].id, index: 1, zelle: Z({ art: 'einmal' }) },
    { befehl: 'zelle_halten', spur_id: s[2].id, index: 1, an: true },
  ]);
  return { ...z, bereich, spuren: s, zelle: (n, i = 1) => z.projekt().spuren.find((x) => x.id === s[n].id).zellen[i - 1], kern };
}

test('POST /session/scheiben stores scheiben with identity folge on a loop cell', async (t) => {
  const z = await aufbau(t);
  const a = await z.bereich.scheiben({ spur_id: z.spuren[0].id, zelle: 1, teilung: '1/16' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.ok, true);
  assert.equal(a.j.grenzen.length, 16);
  const s = z.zelle(0).scheiben;
  assert.equal(s.teilung, '1/16');
  assert.deepEqual(s.grenzen, a.j.grenzen);
  assert.deepEqual(s.folge, Array.from({ length: 16 }, (_, i) => i + 1));
  assert.equal(zellFehler(z.zelle(0)), null);
});

test('transienten: frames of the source hook become cell beats through the cell bpm', async (t) => {
  // 120 bpm: 1 second = 2 beats; the hook returns seconds of the source
  const z = await aufbau(t, { transienten: (sha) => (sha === SHA ? [0.25, 0.26, 0.75, 1.5] : null) });
  const a = await z.bereich.scheiben({ spur_id: z.spuren[0].id, zelle: 1, teilung: 'transienten' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j.grenzen, [0, 0.5, 1.5, 3]);
  assert.deepEqual(z.zelle(0).scheiben.folge, [1, 2, 3, 4]);
});

test('transienten without a transient source is [0]', async (t) => {
  const z = await aufbau(t);
  const a = await z.bereich.scheiben({ spur_id: z.spuren[0].id, zelle: 1, teilung: 'transienten' }, 'andreas');
  assert.deepEqual([a.code, a.j.grenzen], [200, [0]]);
});

test('an einmal cell slices like a loop ', async (t) => {
  const z = await aufbau(t);
  const a = await z.bereich.scheiben({ spur_id: z.spuren[1].id, zelle: 1, teilung: '1/8' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.grenzen.length, 8);
});

test('an einmal cell without beats: the length comes from frames and bpm (as the translator derives it) and is stored with the slices', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren[1].id, index: 2, zelle: (({ beats, ...r }) => r)(Z({ art: 'einmal' })) }]);
  assert.equal(z.zelle(1, 2).beats, undefined);
  const a = await z.bereich.scheiben({ spur_id: z.spuren[1].id, zelle: 2, teilung: '1/16' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(z.zelle(1, 2).beats, zellBeatsAusFrames(96000, 120));
  assert.equal(z.zelle(1, 2).beats, 4);
  assert.equal(a.j.grenzen.length, 16);
});

const SHC = 'c'.repeat(64), SHD = 'd'.repeat(64);
const ohneBeats = (extra) => (({ beats, ...r }) => r)(Z({ art: 'einmal', ...extra }));

test('review: an einmal cell of 100003 frames at 120 bpm stores beats as a multiple of 0.25 (what zelle_aendern takes) and the slices load', async (t) => {
  const z = await aufbau(t, { frames: (sha) => (sha === SHC ? 100003 : frames(sha)) });
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren[1].id, index: 2, zelle: ohneBeats({ sha256: SHC }) }]);
  const a = await z.bereich.scheiben({ spur_id: z.spuren[1].id, zelle: 2, teilung: '1/16' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const b = z.zelle(1, 2).beats;
  assert.equal(b, 4.25, 'the nearest 0.25 of 4.1668');
  assert.ok(Number.isInteger(b * 4));
  assert.deepEqual(a.j.grenzen, Array.from({ length: Math.ceil(b * 4) }, (_, i) => i / 4), 'the slices use exactly the stored length');
  assert.equal(zellFehler(z.zelle(1, 2)), null);
});

test('review: an einmal cell shorter than a quarter beat is stored as 0.25 at least', async (t) => {
  const z = await aufbau(t, { frames: (sha) => (sha === SHC ? 2000 : frames(sha)) });
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren[1].id, index: 2, zelle: ohneBeats({ sha256: SHC }) }]);
  const a = await z.bereich.scheiben({ spur_id: z.spuren[1].id, zelle: 2, teilung: 'takt' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(z.zelle(1, 2).beats, 0.25);
});

test('review: an einmal cell of 200 s (more than 64 beats at 120 bpm) is 409 einmal_zu_lang, nothing stored', async (t) => {
  const z = await aufbau(t, { frames: (sha) => (sha === SHD ? 200 * 48000 : frames(sha)) });
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren[1].id, index: 2, zelle: ohneBeats({ sha256: SHD }) }]);
  const a = await z.bereich.scheiben({ spur_id: z.spuren[1].id, zelle: 2, teilung: '1/16' }, 'andreas');
  assert.deepEqual([a.code, a.j.ok, a.j.grund], [409, false, 'einmal_zu_lang']);
  assert.equal(z.zelle(1, 2).scheiben, undefined);
  assert.equal(z.zelle(1, 2).beats, undefined);
  assert.ok(!grundText('einmal_zu_lang').startsWith('request refused'), 'has a reason text');
});

test('an einmal cell without beats whose source is not decoded is refused by the model (scheiben_ungueltig), nothing stored', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren[1].id, index: 2, zelle: (({ beats, ...r }) => r)(Z({ art: 'einmal', sha256: 'b'.repeat(64) })) }]);
  const a = await z.bereich.scheiben({ spur_id: z.spuren[1].id, zelle: 2, teilung: '1/16' }, 'andreas');
  assert.equal(a.j.ok, false);
  assert.equal(a.j.grund, 'scheiben_ungueltig');
  assert.equal(z.zelle(1, 2).scheiben, undefined);
});

test('an empty or hold cell is zelle_leer; bad arguments are 400', async (t) => {
  const z = await aufbau(t);
  const leer = await z.bereich.scheiben({ spur_id: z.spuren[3].id, zelle: 1, teilung: '1/16' }, 'andreas');
  assert.deepEqual([leer.code, leer.j.grund], [409, 'zelle_leer']);
  const halten = await z.bereich.scheiben({ spur_id: z.spuren[2].id, zelle: 1, teilung: '1/16' }, 'andreas');
  assert.deepEqual([halten.code, halten.j.grund], [409, 'zelle_leer']);
  const schlecht = await z.bereich.scheiben({ spur_id: z.spuren[0].id, zelle: 1, teilung: '1/3' }, 'andreas');
  assert.deepEqual([schlecht.code, schlecht.j.grund], [400, 'argument_ungueltig']);
  const extra = await z.bereich.scheiben({ spur_id: z.spuren[0].id, zelle: 1, teilung: 'takt', x: 1 }, 'andreas');
  assert.deepEqual([extra.code, extra.j.grund], [400, 'argument_unbekannt']);
  const ki = await (async () => { z.kern.ki = true; return z.bereich.scheiben({ spur_id: z.spuren[0].id, zelle: 1, teilung: 'takt' }, 'cypher'); })();
  assert.deepEqual([ki.code, ki.j.grund], [409, 'ki_gestoppt']);
});

test('review: transients become cell beats through frames and beats (as the loader reads the cell), not through a bpm that disagrees', async (t) => {
  // 96000 frames = 2 s over 4 beats: 1 s is beat 2, whatever the stored bpm says (90 bpm would make it beat 1.5)
  const z = await aufbau(t, { transienten: (sha) => (sha === SHA ? [1] : null) });
  await z.aendern([{ befehl: 'zelle_aendern', spur_id: z.spuren[0].id, index: 1, bpm: 90 }]);
  assert.equal(z.zelle(0).bpm, 90);
  const a = await z.bereich.scheiben({ spur_id: z.spuren[0].id, zelle: 1, teilung: 'transienten' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j.grenzen, [0, 2]);
  // an einmal cell without bpm slices the same way
  const b = await z.bereich.scheiben({ spur_id: z.spuren[1].id, zelle: 1, teilung: 'transienten' }, 'andreas');
  assert.equal(b.code, 200, JSON.stringify(b.j));
  assert.ok(b.j.grenzen.length === 2 && Math.abs(b.j.grenzen[1] - 2) < 1e-9, JSON.stringify(b.j));
});

test('review: the model refuses falling envelope beats, and transponieren holds at -24 and fails at -25 and 25', () => {
  const Zl = (extra) => ({ id: 'z', name: 'x', farbe: 1, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });
  const h = (punkte) => zellFehler(Zl({ huellen: [{ ziel: 'gain', punkte }] }));
  assert.equal(h([{ beat: 0, wert: -3 }, { beat: 2, wert: -6 }]), null);
  assert.equal(h([{ beat: 2, wert: -3 }, { beat: 1, wert: -6 }])?.grund, 'huelle_ungueltig');
  assert.equal(zellFehler(Zl({ transponieren: -24 })), null);
  assert.equal(zellFehler(Zl({ transponieren: 24 })), null);
  assert.equal(zellFehler(Zl({ transponieren: -25 }))?.grund, 'argument_ungueltig');
  assert.equal(zellFehler(Zl({ transponieren: 25 }))?.grund, 'argument_ungueltig');
});
