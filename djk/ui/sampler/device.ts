// Sampler A1: the device generated for a cut, as plain objects (the writer in schnitt.ts turns them into JSON). Decisions D3, D8, D9 of the plan.
//
//   note.hz, note.trig -> smp (sampler, slice table `grenzen`, `noten_wahl` 1: note n plays slice n, n + 64 reversed)
//   smp.gate = note.gate + Hold            (Hold >= 0.5 lets a hit play on after the key is up)
//   smp.tempo = Speed, smp.halb = Pitch, smp.ausklang = Release   (Speed and Pitch latched: `rastet` 1, A2 E8)
//   smp.l/r -> krume (Crush bits, 48 000 Hz) -> svf low-pass (Cutoff, Reso) -> x gain -> out
//   gain = note.vel * 1.27 * Level         (vel arrives as vel/127, so velocity 100 at Level 1 is unity)
import type { Schnitt } from './schnitt.ts';

export const geraetName = (id: string): string => `smp-${id}`;

const KNOEPFE = [
  { nr: 1, id: 'lvl', name: 'Level', min: 0, max: 2, log: 0, mitte: 1, vorgabe: 0.5, format: 'raw', unit: 'x' },
  { nr: 2, id: 'spd', name: 'Speed', min: 0.25, max: 4, log: 1, mitte: 1, vorgabe: 0.5, format: 'raw', unit: 'x' },
  { nr: 3, id: 'pit', name: 'Pitch', min: -12, max: 12, log: 0, vorgabe: 0.5, format: 'raw', unit: 'st' },
  { nr: 4, id: 'hld', name: 'Hold', min: 0, max: 1, log: 0, vorgabe: 0, format: 'percent' },
  { nr: 5, id: 'rel', name: 'Release', min: 1, max: 2000, log: 1, vorgabe: 0.3, format: 'ms' },
  { nr: 6, id: 'cut', name: 'Cutoff', min: 40, max: 20000, log: 1, vorgabe: 1, format: 'hz' },
  { nr: 7, id: 'res', name: 'Reso', min: 0, max: 1, log: 0, vorgabe: 0, format: 'percent' },
  { nr: 8, id: 'crs', name: 'Crush', min: 24, max: 4, log: 0, vorgabe: 0, format: 'raw', unit: 'bit' },
] as const;

// Speed (k2) and Pitch (k3) are latched at the trigger by the block (A1 D2). Marked `rastet: 1`, the core hands each hit the lane value of its own step
// (A2 E8): no glide, applied before the note-on. Every other knob stays as it was (no key).
const RASTENDE: readonly number[] = [2, 3];

/** The device graph `smp-<id>` (4 voices). */
export function geraetGraph(s: Schnitt): Record<string, unknown> {
  const name = geraetName(s.id);
  const knoten: Record<string, unknown>[] = [
    { id: 'note', art: 'note' },
    { id: 'smp', art: 'sampler', datei: `${name}.f32`, grenzen: s.grenzen, noten_wahl: 1, schleife: 0 },
    ...KNOEPFE.map((k) => ({ id: k.id, art: 'regler', nr: k.nr, min: k.min, max: k.max, log: k.log, vorgabe: k.vorgabe, ...('mitte' in k ? { mitte: k.mitte } : {}), ...(RASTENDE.includes(k.nr) ? { rastet: 1 } : {}) })),
    { id: 'gate', art: 'add' },
    { id: 'vel', art: 'mul', b: 1.27 },
    { id: 'gain', art: 'mul' },
    ...['l', 'r'].flatMap((z) => [
      { id: `crush_${z}`, art: 'krume', rate: 48000 },
      { id: `lp_${z}`, art: 'svf', pole: 2 },
      { id: `amp_${z}`, art: 'mul' },
    ]),
    { id: 'aus', art: 'ausgang' },
  ];
  const kanten: { von: string; nach: string }[] = [
    { von: 'note.hz', nach: 'smp.hz' }, { von: 'note.trig', nach: 'smp.trig' },
    { von: 'note.gate', nach: 'gate.a' }, { von: 'hld.aus', nach: 'gate.b' }, { von: 'gate.aus', nach: 'smp.gate' },
    { von: 'spd.aus', nach: 'smp.tempo' }, { von: 'pit.aus', nach: 'smp.halb' }, { von: 'rel.aus', nach: 'smp.ausklang' },
    { von: 'note.vel', nach: 'vel.a' }, { von: 'vel.aus', nach: 'gain.a' }, { von: 'lvl.aus', nach: 'gain.b' },
  ];
  for (const z of ['l', 'r']) {
    kanten.push({ von: `smp.${z}`, nach: `crush_${z}.x` }, { von: 'crs.aus', nach: `crush_${z}.bits` },
      { von: `crush_${z}.aus`, nach: `lp_${z}.x` }, { von: 'cut.aus', nach: `lp_${z}.cutoff` }, { von: 'res.aus', nach: `lp_${z}.reso` },
      { von: `lp_${z}.tp`, nach: `amp_${z}.a` }, { von: 'gain.aus', nach: `amp_${z}.b` }, { von: `amp_${z}.aus`, nach: `aus.${z}` });
  }
  return { format: 'baukasten/2', name, stimmen: 4, regler_namen: Object.fromEntries(KNOEPFE.map((k) => [String(k.nr), k.name])), knoten, kanten };
}

/** The panel `smp-<id>` (cypherdj-panel/2): one section SLICES with the eight knobs k1..k8. The title carries the cut name, cut to the 40 characters a title may have. */
export function geraetPanel(s: Schnitt): Record<string, unknown> {
  const kopf = 'Slices · ';
  const titel = `${kopf}${s.name}`.length <= 40 ? `${kopf}${s.name}` : `${kopf}${s.name.slice(0, 40 - kopf.length - 1).trimEnd()}…`;
  return {
    format: 'cypherdj-panel/2',
    geraet: { art: 'bk', graph: geraetName(s.id) },
    title: titel,
    sections: [{
      id: 'slices', title: 'SLICES', cols: 4,
      controls: KNOEPFE.map((k) => ({ id: `c${k.nr}`, type: 'knob', label: k.name, bind: { param: `k${k.nr}` }, format: k.format, ...('unit' in k ? { unit: k.unit } : {}), default: k.vorgabe })),
    }],
  };
}

/** Speed in 0.25..4 for the knob position `k` of SPEED (log, 1 in the middle): 4^(2k - 1). */
export const speedVon = (k: number): number => 4 ** (2 * k - 1);

/** FIT: the knob position of SPEED that plays the cut at the project tempo (r = project / cut tempo). null when r is outside 0.25..4 (or not a number). */
export function fitWert(projektBpm: number, quellBpm: number): number | null {
  const r = projektBpm / quellBpm;
  if (!Number.isFinite(r) || !(r >= 0.25 && r <= 4)) return null;
  return Math.min(1, Math.max(0, 0.5 + 0.5 * Math.log(r) / Math.log(4)));
}

/** The command `werkbank_spur_neu` for the cut in its original order: one note per slice at the slice start, as long as the slice (a grid cut on the exact grid, hit and hand cuts in beats of their bounds, not quantised),
 *  note = slice index, velocity 100. `fit` is what went onto k2, null when the project tempo is out of FIT's range (SPEED then stays at 1). */
export function spurBefehl(s: Schnitt, o: { name?: string; projektBpm: number }): { befehl: Record<string, unknown>; fit: number | null } {
  const fit = fitWert(o.projektBpm, s.bpm);
  const n = s.grenzen.length - 1;
  // A grid cut writes the exact grid (k * beats / n, one slice long): its frame bounds are rounded, and a note at the rounded bound would sit a fraction of a
  // beat in front of its step. Hit and hand cuts keep the beat of their bound (not quantised, the groove stays).
  const exakt = s.methode === 'raster';
  const noten = Array.from({ length: n }, (_, i) => exakt
    ? { beat: i * s.beats / n, laenge: s.beats / n, ton: i, vel: 100 }
    : { beat: s.grenzen[i] * s.beats / s.frames, laenge: (s.grenzen[i + 1] - s.grenzen[i]) * s.beats / s.frames, ton: i, vel: 100 });
  return {
    // fader 0 dB, not the -6 dB of a new pattern track: the slices are the loop itself, and at 0 dB the track plays as loud as the loop on an audio track
    befehl: { befehl: 'werkbank_spur_neu', name: o.name ?? s.name, loop_beats: s.beats, fader_db: 0, noten,
      geraet: { art: 'intern', name: 'bk', graph: geraetName(s.id), parameter: fit === null ? {} : { k2: fit } } },
    fit,
  };
}
