// rb338 value mapping (package 1.16 rest T3a.1, stream coordination C2: one module for every stream; pure, no I/O).
// The project stores the seven RB-338 parameters normalised 0..1 (model.ts RB_PARAMETER); presets store plain values
// (presets/devices.ts rb338). rbPlain is a copy of djk/instruments/rb_dsp/src/parameter.rs Def::wert (nih-plug FloatRange::unnormalize)
// for the seven entries of defs(); rbNorm is its inverse: Linear (v-min)/(max-min), Schief ((v-min)/(max-min))^faktor, Schalter 1/0.
// tests/presets_apply.test.mjs parses defs() and fails when a kind, range, skew factor or default differs from RB_DEFS.
// Merge with 1.9 U4 (e7d6edfa): the same mapping existed twice; this module keeps RB_DEFS/rbPlain/rbNorm and adds the 1.9 names
// (normZuWert, wertZuNorm, RB_VORGABE_NORM7, presetZuParameter) on top. The golden table of rb_dsp/tests/abbildung_golden.rs pins them
// in tests/project_rb_mapping.test.mjs at 1e-5 relative.
import { RB_PARAMETER } from './model.ts';
export type RbBereich = { art: 'linear'; min: number; max: number } | { art: 'schief'; min: number; max: number; faktor: number } | { art: 'schalter' };
export type RbDef = RbBereich & { vorgabe: number };

const dbFaktor = (db: number): number => (db > -100 ? 10 ** (db * 0.05) : 0);               // util::db_to_gain
const schief = (f: number): number => 2 ** f;                                                // FloatRange::skew_factor
const schiefPegel = (minDb: number, maxDb: number): number => {                              // FloatRange::gain_skew_factor
  const min = dbFaktor(minDb), max = dbFaktor(maxDb), mitte = dbFaktor((maxDb + minDb) / 2);
  return Math.log(0.5) / Math.log((mitte - min) / (max - min));   // Rust 0.5f32.log(x) = ln 0.5 / ln x
};

export const RB_DEFS: Readonly<Record<string, RbDef>> = {
  lautstaerke: { art: 'schief', min: dbFaktor(-48), max: dbFaktor(0), faktor: schiefPegel(-48, 0), vorgabe: dbFaktor(-12) },
  wellenform: { art: 'schalter', vorgabe: 0 },
  cutoff: { art: 'schief', min: 40, max: 5000, faktor: schief(-2), vorgabe: 800 },
  resonanz: { art: 'linear', min: 0, max: 1, vorgabe: 0.3 },
  env_mod: { art: 'linear', min: 0, max: 1, vorgabe: 0.4 },
  decay: { art: 'schief', min: 0.2, max: 2, faktor: schief(-1), vorgabe: 0.6 },
  accent: { art: 'linear', min: 0, max: 1, vorgabe: 0.6 },
};

const def = (name: string): RbDef => {
  const d = RB_DEFS[name];
  if (!d) throw new Error(`rb338 has no parameter ${name}`);
  return d;
};
const klemme = (x: number): number => Math.min(1, Math.max(0, x));

/** normalised 0..1 → plain value (Def::wert) */
export function rbPlain(name: string, norm: number): number {
  const d = def(name);
  if (d.art === 'schalter') return norm > 0.5 ? 1 : 0;
  if (d.art === 'linear') return klemme(norm) * (d.max - d.min) + d.min;
  return klemme(norm) ** (1 / d.faktor) * (d.max - d.min) + d.min;
}

/** plain value (a switch also as boolean) → normalised 0..1, clamped */
export function rbNorm(name: string, plain: number | boolean): number {
  const d = def(name);
  const v = typeof plain === 'boolean' ? (plain ? 1 : 0) : plain;
  if (d.art === 'schalter') return v > 0.5 ? 1 : 0;
  const lin = klemme((v - d.min) / (d.max - d.min));
  return d.art === 'linear' ? lin : lin ** d.faktor;
}

// ---- 1.9 U4 names (instrument tracks, direction words, preset commands) ----

/** normalised 0..1 → value in display units (Def::wert); alias of rbPlain */
export function normZuWert(id: string, normiert: number): number {
  return rbPlain(id, normiert);
}

/** display units → normalised 0..1, clamped; unlike rbNorm it rejects a non-number for a non-switch parameter */
export function wertZuNorm(id: string, wert: number | boolean): number {
  const d = def(id);
  if (d.art !== 'schalter' && (typeof wert !== 'number' || !Number.isFinite(wert))) throw new Error(`${id}: a number is expected`);
  return rbNorm(id, wert);
}

/** the plugin defaults in normalised form, for all seven parameters (RB_VORGABE_NORM of model.ts holds the four lane parameters) */
export const RB_VORGABE_NORM7: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(RB_DEFS).map(([id, d]) => [id, wertZuNorm(id, d.vorgabe)]),
);

/** The `werte` of a preset file (display units; at least one parameter) as a project parameter object (normalised). Throws an Error naming
 *  the parameter for an unknown name or a value of the wrong type; the command turns that into a refusal. */
export function presetZuParameter(werte: Record<string, unknown>): Record<string, number> {
  const aus: Record<string, number> = {};
  for (const [k, v] of Object.entries(werte)) {
    if (!RB_PARAMETER.includes(k)) throw new Error(`${k}: not an RB-338 parameter`);
    const erwartet = k === 'wellenform' ? 'true or false' : 'a number';
    if (k === 'wellenform' ? typeof v !== 'boolean' && typeof v !== 'number' : typeof v !== 'number') throw new Error(`${k}: ${erwartet} expected`);
    aus[k] = wertZuNorm(k, v as number | boolean);
  }
  return aus;
}
