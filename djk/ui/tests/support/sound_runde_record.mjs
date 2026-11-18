#!/usr/bin/env node
// FIND SOUND rework, task 0: records the feature vectors of the six candidates of the listening verdict of 2026-11-18 (module "base", track fm-bass,
// knobs Brightness, Feedback, Decay, Drive) with the REAL offline render, and writes tests/fixtures/klang_runde_hoerurteil.json.
// Manual script, not a test:  node tests/support/sound_runde_record.mjs [out.json]
//   run from djk/ui under  systemd-run --user --scope -q -p MemoryMax=6G -p MemorySwapMax=0 ...
// Isolation: HOME, the XDG folders, CYPHERDJ_BK_ORDNER and CYPHERDJ_KIT_ORDNER point into one temp folder that holds a copy of fm-bass.json;
// the render is the built cypherdj-render (CYPHERDJ_RENDER or djk/core/build of this checkout, read only), instance h.
// Nothing talks to a running studio: no HTTP, no OSC, no ~/.config/cypherdj, no /dev/shm/cypherdj*.
// Project: the REAL module "base", hard-coded from its project.json in the studio's projects folder (read 2026-11-18; the test must not depend on that
// file): tempo 120, loop beats 0 to 4, track s2 "fm-bass", graph fm-bass, parameter {k1: 0.5} only (every other knob at the graph's own default: the graph has no
// `vorgabe`, so 0.5, the way the product takes an absent parameter), fader -6 dB, one MIDI clip with loop_beats 4 and the notes (beat, tone, length, vel)
// (0, 36, 0.25, 100), (0.25, 53, 0.25, 100), (0.75, 53, 0.25, 100); a fourth note at beat 4 lies behind the loop and never sounds. The 909 kick of track s1 is
// not part of the measurement // (rendereKlangVarianten renders the track alone). The knob values of the six variants are computed from SCHRITTE of the old contract.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const DJK = path.resolve(HIER, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-hoerurteil-'));
const home = path.join(tmp, 'home');
const bk = path.join(tmp, 'baukasten'), kits = path.join(tmp, 'kits');
for (const d of [home, path.join(home, '.config'), path.join(home, '.cache'), path.join(home, '.local', 'share'), bk, kits, path.join(tmp, 'tmpdir')]) {
  fs.mkdirSync(d, { recursive: true });
}
fs.copyFileSync(path.join(DJK, 'instruments', 'modular_dsp', 'demos', 'fm-bass.json'), path.join(bk, 'fm-bass.json'));
Object.assign(process.env, {
  HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'), XDG_DATA_HOME: path.join(home, '.local', 'share'),
  CYPHERDJ_BK_ORDNER: bk, CYPHERDJ_KIT_ORDNER: kits, TMPDIR: path.join(tmp, 'tmpdir'), CYPHERDJ_TEST_INSTANZ: 'h',
});
for (const k of Object.keys(process.env)) if (k.startsWith('CYPHERDJ_') && !['CYPHERDJ_BK_ORDNER', 'CYPHERDJ_KIT_ORDNER', 'CYPHERDJ_TEST_INSTANZ', 'CYPHERDJ_RENDER'].includes(k)) delete process.env[k];

const kandidaten = [path.join(DJK, 'core', 'build', 'cypherdj-render')];
const RENDER = process.env.CYPHERDJ_RENDER || kandidaten.find((p) => fs.existsSync(p));
if (!RENDER) throw new Error('no cypherdj-render found');

const { aufbau } = await import('./output_setup.mjs');
const { analysiereImWerk } = await import('../../areas/proj/sound_analysis.ts');
const { merkmale } = await import('../../project/sound_runde.ts');
const { terzVon } = await import('../../project/sound_contract.ts');
// the step shares of the old contract (the contract no longer has them: the levels are audibility targets since the rework)
const SCHRITTE = { fein: 0.09, normal: 0.18, grob: 0.35 };

const nachher = [];
const t = { after: (f) => nachher.push(f) };
const aus = process.argv[2] ?? path.join(HIER, '..', 'fixtures', 'klang_runde_hoerurteil.json');
try {
  const a = await aufbau(t, { tempo: 120, mitKick: false, opt: { render: () => [RENDER], instanz: () => 'h' } });
  const REAL = { k1: 0.5 };   // as in project.json; k2..k4 are absent there = the graph default 0.5
  const BASIS = { k1: 0.5, k2: 0.5, k3: 0.5, k4: 0.5 };
  await a.aendern([
    { befehl: 'spur_neu', art: 'instrument', name: 'FM Bass', geraet: { art: 'intern', name: 'bk', graph: 'fm-bass', parameter: REAL } },
    { befehl: 'spur_aendern', spur_id: 's4', fader_db: -6 },
    { befehl: 'clip_neu', spur_id: 's4', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [[0, 36], [0.25, 53], [0.75, 53]].map(([beat, ton]) => ({ beat, laenge: 0.25, ton, vel: 100 })) },
  ], 'fm-bass');
  const klemme = (x) => Math.round(Math.min(1, Math.max(0, x)) * 1e4) / 1e4;
  // normal = old SCHRITTE.normal (Brightness up, Decay and Drive down), coarse = old SCHRITTE.grob (Brightness down, Decay and Drive up)
  const sechs = [
    { name: 'Brightness 1 -> 1.36', schritt: 'normal', param: 'k1', wert: klemme(BASIS.k1 + SCHRITTE.normal) },
    { name: 'Decay 1 -> 0.56', schritt: 'normal', param: 'k3', wert: klemme(BASIS.k3 - SCHRITTE.normal) },
    { name: 'Drive 6 -> 3.84', schritt: 'normal', param: 'k4', wert: klemme(BASIS.k4 - SCHRITTE.normal) },
    { name: 'Brightness 1 -> 0.3', schritt: 'grob', param: 'k1', wert: klemme(BASIS.k1 - SCHRITTE.grob) },
    { name: 'Decay 1 -> 3.09', schritt: 'grob', param: 'k3', wert: klemme(BASIS.k3 + SCHRITTE.grob) },
    { name: 'Drive 6 -> 10.2', schritt: 'grob', param: 'k4', wert: klemme(BASIS.k4 + SCHRITTE.grob) },
  ];
  const varianten = [{}, {}, ...sechs.map((s) => ({ [s.param]: s.wert }))];
  const messungen = await a.ausgabe.rendereKlangVarianten('s4', varianten, 0, 4, async (r) => {
    const aus2 = [];
    for (const teil of r.teile) {
      if ('stumm' in teil) throw new Error('silent part: the render gave nothing');
      const w = (await analysiereImWerk({ quelle: teil.datei, frames: [teil.frames] })).quelle;
      aus2.push({ merkmale: merkmale(w), bild30: terzVon(w.spektrum.mittel_db), spitze_db: teil.spitze_db, frames: teil.frames });
    }
    return aus2;
  });
  const [a1, a2, ...rest] = messungen;
  const gleich = JSON.stringify(a1.merkmale) === JSON.stringify(a2.merkmale) && JSON.stringify(a1.bild30) === JSON.stringify(a2.bild30);
  // positive control (plan T0): highs of the normal Brightness candidate about +6.0 dB over A (+-1.5), levels of Drive normal, Brightness coarse and Drive
  // coarse about -1.0, +1.4, +1.3 dB (+-0.7). The fixture only pins constants when `kontrolle.ok` is true.
  const dm = (i, n) => rest[i].merkmale[n] - a1.merkmale[n];
  const kontrolle = { hoehen_brightness_normal: dm(0, 'hoehen'), pegel_drive_normal: dm(2, 'pegel'), pegel_brightness_grob: dm(3, 'pegel'), pegel_drive_grob: dm(5, 'pegel') };
  kontrolle.ok = Math.abs(kontrolle.hoehen_brightness_normal - 6.0) <= 1.5 && Math.abs(kontrolle.pegel_drive_normal + 1.0) <= 0.7
    && Math.abs(kontrolle.pegel_brightness_grob - 1.4) <= 0.7 && Math.abs(kontrolle.pegel_drive_grob - 1.3) <= 0.7;
  const doc = {
    kontrolle,
    quelle: { modul: 'base, track fm-bass (hard-coded from project.json of 2026-11-18)', render: path.basename(RENDER), bpm: 120,
      beats: 4, basis: BASIS, note: 'notes (beat, tone, length): (0, 36, 0.25), (0.25, 53, 0.25), (0.75, 53, 0.25); k1 0.5, k2..k4 graph default 0.5', aufgenommen: new Date().toISOString().slice(0, 10) },
    a_deterministisch: gleich,
    a: { name: 'A', merkmale: a1.merkmale, bild30: a1.bild30 },
    kandidaten: sechs.map((s, i) => ({ name: s.name, schritt: s.schritt, param: s.param, wert: s.wert, merkmale: rest[i].merkmale, bild30: rest[i].bild30,
      pegel_db_diff: rest[i].merkmale.pegel - a1.merkmale.pegel })),
  };
  fs.writeFileSync(aus, `${JSON.stringify(doc, null, 1)}\n`);
  console.log(`written ${aus}; A deterministic: ${gleich}`);
  for (const k of doc.kandidaten) {
    console.log(`${k.name.padEnd(24)} ${k.schritt.padEnd(6)} value ${k.wert}  hoehen ${(k.merkmale.hoehen - doc.a.merkmale.hoehen).toFixed(2)} dB  level ${k.pegel_db_diff.toFixed(2)} dB`);
  }
} finally {
  for (const f of nachher.reverse()) { try { await f(); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(0);
