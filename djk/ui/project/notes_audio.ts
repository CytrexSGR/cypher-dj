// Note editor (slice 1, task B2): the pure helpers of the note detection job (areas/proj/notes.ts). They turn a checked sidecar into the clip field
// `audio_noten`, judge whether the clip is still the one the run started on, and choose the detector path. The contract is djk/contract/notes.md,
// its checks are in notes_contract.ts; nothing here touches the disk or a process.
import { audioNotenPruefung, NOTEN_HOP, NOTEN_SR, type AudioNote, type AudioNotenFeld, type NotenKurve } from './notes_contract.ts';
import { sucheClip, type Projekt } from './model.ts';

/** What a run keeps of the clip it started on: the clip id, its source, the decoded length, the field it had (null = none) and its name */
export type NotenPlan = { clipId: string; sha256: string; frames: number; vorher: AudioNotenFeld | null; name: string };

/** The sidecar cannot be turned into a clip field: a note ends after the source, or the field breaks a rule; the job ends `fehler` with `noten_fehler` */
export class NotenAudioFehler extends Error {
  readonly grund = 'noten_fehler';
  constructor(message: string) { super(message); }
}

// A real program rounds seconds to six decimals, so a note that ends at the last sample may come out half a microsecond long
const RUNDUNG_S = 1e-6;

/**
 * The detected notes of a sidecar as the field of a clip: ids `t1..tn` in the order of the start, only the detected values (no targets), the curve id of
 * the sidecar. The server's half of the rule "a note lies inside the source": the sidecar check lets a note end up to one hop after the last sample,
 * here a note that ends later than `frames / 48000` (beyond the rounding) is refused. A note within the rounding is cut to the end of the source.
 */
export function baueNotenFeld(sd: NotenKurve, frames: number): AudioNotenFeld {
  const ende = frames / NOTEN_SR;
  const sortiert = [...sd.noten].sort((a, b) => a.qa - b.qa);
  const liste: AudioNote[] = sortiert.map((n, i) => {
    if (n.qe > ende + RUNDUNG_S) throw new NotenAudioFehler(`note ${i + 1} ends at ${n.qe} s, after the end of the source (${ende} s)`);
    return { id: `t${i + 1}`, qa: n.qa, qe: Math.min(n.qe, ende), qton: n.qton, p: n.p };
  });
  const feld: AudioNotenFeld = { kurve: sd.kurve, liste };
  const f = audioNotenPruefung(feld);
  if (f) throw new NotenAudioFehler(`the detected notes do not make a valid field: ${f.text}`);
  return feld;
}

/** The project with the field placed on the clip (a copy; the argument stays as it is); a clip that is gone or not an audio clip is an error of the caller */
export function baueNotenProjekt(p: Projekt, clipId: string, feld: AudioNotenFeld): Projekt {
  const neu = structuredClone(p);
  const g = sucheClip(neu, clipId);
  if (!g || g.clip.art !== 'audio') throw new Error(`clip ${clipId} is not an audio clip of the project`);
  g.clip.audio_noten = structuredClone(feld);
  return neu;
}

/** null = the clip is still the one the run started on (same source, same field); else `veraltet`. Cutting, moving or looping the clip does not matter:
 *  the notes are in source seconds and the field travels with the clip. */
export function notenNochGleich(p: Projekt, plan: NotenPlan): 'veraltet' | null {
  const g = sucheClip(p, plan.clipId);
  if (!g || g.clip.art !== 'audio') return 'veraltet';
  if (g.clip.quelle.sha256 !== plan.sha256) return 'veraltet';
  if (JSON.stringify(g.clip.audio_noten ?? null) !== JSON.stringify(plan.vorher)) return 'veraltet';
  return null;
}

// 60 Hz in cents (MIDI times 100): 1200 * log2(60 / 8.1758)
export const NETZ_P5_MIN_CT = 3450.6;

/** The detector path rule (P5): the network runs only when the 5th percentile of the voiced pitch of the own curve is at least 60 Hz (the network
 *  does not follow bass below that). Linear interpolation between the ranks, as numpy does. No voiced frame: false. */
export function netzPasst(sd: NotenKurve): boolean {
  const ct = sd.f0_ct.filter((v) => v > 0).sort((a, b) => a - b);
  if (ct.length === 0) return false;
  const pos = (ct.length - 1) * 0.05;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  const p5 = ct[lo] + (ct[hi] - ct[lo]) * (pos - lo);
  return p5 >= NETZ_P5_MIN_CT;
}

/** The time limit of a run: the length of the source in real time, at least two minutes */
export function notenZeitlimitMs(frames: number): number { return Math.max(120_000, Math.round(frames / NOTEN_SR * 1000)); }

/** Below this share of pitched frames a result is probably a full mix, not a single voice or instrument (the monophonic check does not catch it:
 *  the detector calls most of a mix unvoiced). It is a hint, never a refusal. */
export const NOTEN_WENIG_STIMMHAFT = 0.15;

/**
 * The one hint of a finished run, or null. Precedence: no notes at all (keine_noten) before little pitched sound (wenig_stimmhaft) before a failed
 * network path (netz_fehler): one `hinweis` field, the most useful one. `stimmhaft` is the share of pitched frames of the sidecar the notes come from.
 */
export function fertigHinweis(stimmhaft: number, noten: number, netzFehler: boolean): { hinweis: string; text: string } | null {
  if (noten === 0) return { hinweis: 'keine_noten', text: 'No notes found in this clip.' };
  if (stimmhaft < NOTEN_WENIG_STIMMHAFT) {
    return { hinweis: 'wenig_stimmhaft', text: 'Little pitched sound found. If this is a full mix, separate stems first and detect notes on the vocal stem.' };
  }
  if (netzFehler) return { hinweis: 'netz_fehler', text: 'the network detector failed; the notes come from the own detector' };
  return null;
}

/** What a note measures against its detection (D13): time and pitch parts, and with a curve the vibrato and drift widths (D12, cents) of the source
 *  and of the target. Without a curve only notes with a target carry `mass`; with a curve every note does (the widths help before an edit). */
export type NotenMass = { a_ms: number; e_ms: number; laenge_ms: number; dehnung: number; ton_ct: number;
  vib_ct?: number | null; drift_ct?: number | null; vib_ziel_ct?: number | null; drift_ziel_ct?: number | null };
const runde = (x: number, f: number): number => Math.round(x * f) / f;
const hatZiel = (n: AudioNote): boolean => n.a !== undefined || n.e !== undefined || n.ton !== undefined || n.vib !== undefined || n.drift !== undefined;
const ZERLEGE_FENSTER = 47;   // frames, 0.25 s at hop 256 (contract notes.md, "Vibrato and drift")

/** D12 (contract notes.md): the frames j with qa <= j * hop / sr <= qe; voiced frames give dev = ct / 100 - qton (semitones), unvoiced ones are
 *  interpolated linearly between voiced neighbours (held at the ends); drift = centred mean of dev over 47 frames applied twice (each pass truncated at
 *  the note edges), vibrato = dev - drift. The same definition as the core render (render.cpp `zerlege`). No voiced frame: null. */
export function zerlege(ct: readonly number[], hopS: number, n: Pick<AudioNote, 'qa' | 'qe' | 'qton'>): { j0: number; vib: number[]; drift: number[] } | null {
  const j0 = Math.max(0, Math.ceil(n.qa / hopS - 1e-9)), j1 = Math.min(ct.length - 1, Math.floor(n.qe / hopS + 1e-9));
  if (j1 < j0) return null;
  const m = j1 - j0 + 1;
  const dev = new Array<number>(m).fill(0);
  const stimm: number[] = [];
  for (let i = 0; i < m; i++) if (ct[j0 + i] > 0) { dev[i] = ct[j0 + i] / 100 - n.qton; stimm.push(i); }
  if (!stimm.length) return null;
  for (let i = 0; i < stimm[0]; i++) dev[i] = dev[stimm[0]];
  for (let i = stimm[stimm.length - 1] + 1; i < m; i++) dev[i] = dev[stimm[stimm.length - 1]];
  for (let s = 0; s + 1 < stimm.length; s++) {
    const a = stimm[s], b = stimm[s + 1];
    for (let i = a + 1; i < b; i++) dev[i] = dev[a] + (dev[b] - dev[a]) * (i - a) / (b - a);
  }
  const h = Math.floor(ZERLEGE_FENSTER / 2);
  const mittel = (x: number[]): number[] => {
    const kum = [0];
    for (let i = 0; i < m; i++) kum.push(kum[i] + x[i]);
    return x.map((_, i) => { const a = Math.max(0, i - h), b = Math.min(m, i + h + 1); return (kum[b] - kum[a]) / (b - a); });
  };
  const drift = mittel(mittel(dev));
  return { j0, drift, vib: dev.map((d, i) => d - drift[i]) };
}

/** Widths in cents over the inner part [qa + 0.05, qe - 0.05] of the note (the edges are left out like in the core's tests): vibrato = 2 sqrt(2) rms,
 *  drift = max - min; null without voiced frames or when the inner part is empty */
export function breiten(ct: readonly number[], hopS: number, n: Pick<AudioNote, 'qa' | 'qe' | 'qton'>): { vib_ct: number; drift_ct: number } | null {
  const z = zerlege(ct, hopS, n);
  if (!z) return null;
  const innen = z.vib.map((_, i) => i).filter((i) => { const t = (z.j0 + i) * hopS; return t >= n.qa + 0.05 - 1e-9 && t <= n.qe - 0.05 + 1e-9; });
  if (!innen.length) return null;
  const q = innen.reduce((s, i) => s + z.vib[i] * z.vib[i], 0) / innen.length;
  const d = innen.map((i) => z.drift[i]);
  return { vib_ct: 100 * 2 * Math.SQRT2 * Math.sqrt(q), drift_ct: 100 * (Math.max(...d) - Math.min(...d)) };
}

/** The list with `mass` added (see NotenMass); `kurve` = the pitch curve of the source (its f0_ct and hop). Pure, the input stays as it is */
export function notenMass(liste: readonly AudioNote[], kurve?: Pick<NotenKurve, 'f0_ct' | 'hop'> | null): (AudioNote & { mass?: NotenMass })[] {
  const hopS = (kurve?.hop ?? NOTEN_HOP) / NOTEN_SR;
  return liste.map((n) => {
    if (!kurve && !hatZiel(n)) return n;
    const a = n.a ?? n.qa, e = n.e ?? n.qe;
    const mass: NotenMass = { a_ms: runde((a - n.qa) * 1000, 10) + 0, e_ms: runde((e - n.qe) * 1000, 10) + 0, laenge_ms: runde((e - a) * 1000, 10) + 0,
      dehnung: runde((e - a) / (n.qe - n.qa), 1000) + 0, ton_ct: runde(((n.ton ?? n.qton) - n.qton) * 100, 10) + 0 };
    if (kurve) {
      const b = breiten(kurve.f0_ct, hopS, n);
      mass.vib_ct = b ? runde(b.vib_ct, 10) : null;
      mass.drift_ct = b ? runde(b.drift_ct, 10) : null;
      mass.vib_ziel_ct = b ? runde(b.vib_ct * (n.vib ?? 1), 10) : null;
      mass.drift_ziel_ct = b ? runde(b.drift_ct * (n.drift ?? 1), 10) : null;
    }
    return { ...n, mass };
  });
}
