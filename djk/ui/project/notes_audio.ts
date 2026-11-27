// Note editor (slice 1, task B2): the pure helpers of the note detection job (areas/proj/notes.ts). They turn a checked sidecar into the clip field
// `audio_noten`, judge whether the clip is still the one the run started on, and choose the detector path. The contract is djk/contract/notes.md,
// its checks are in notes_contract.ts; nothing here touches the disk or a process.
import { audioNotenPruefung, NOTEN_SR, type AudioNote, type AudioNotenFeld, type NotenKurve } from './notes_contract.ts';
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
