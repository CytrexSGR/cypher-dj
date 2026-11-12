// 1.12 automation slice 5 (plan docs/b1-plaene/PLAN-1.12-slices4-5-7.md, D7): clip envelopes, pure. A clip may carry `huellkurven`, at most one per
// target: gain (audio, absolute dB -200..0 on top of the clip gain), transpose (MIDI, semitones -48..48, rounded at the note start), and the
// modulation targets spur_fader (-60..+6 dB), spur_pan (-2..2) and geraet.<param> (-1..1, MIDI clips on RB-338 tracks only), which act relative to
// the track's value. Points are clip beats from the clip start (offset_s and versatz_beats do not move them). Linked (verknuepft absent): the points of
// [0, clip loop) repeat with every loop copy of the clip; unlinked (verknuepft: false): they repeat modulo the envelope's own loop_beats from the clip
// start over the whole clip. `verknuepft: true` and an empty list are never written.
import { laneWert, type Punkt } from './lane.ts';
import { AUTO_FORMEN, LOOP_MIN, MAX_BEAT, MAX_LANE_PUNKTE, istObjekt, passtGeraetZiel, type Clip } from './model.ts';

export interface Huellkurve { ziel: string; verknuepft?: false; loop_beats?: number; punkte: Punkt[] }
// 1.12 slice 7: the last 64 are the bk knobs (BK_ZIELE of model.ts, which imports this file)
export const HK_GERAET = ['geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod',
  ...Array.from({ length: 64 }, (_, i) => `geraet.k${i + 1}`)];
export const HK_ZIELE = ['gain', 'transpose', 'spur_fader', 'spur_pan', ...HK_GERAET];
export function HK_BEREICH(ziel: string): { min: number; max: number } {
  if (ziel === 'gain') return { min: -200, max: 0 };
  if (ziel === 'transpose') return { min: -48, max: 48 };
  if (ziel === 'spur_fader') return { min: -60, max: 6 };
  if (ziel === 'spur_pan') return { min: -2, max: 2 };
  return { min: -1, max: 1 };
}
// modulation targets act relative to the track's value (a relative lane in the playback, D9); gain and transpose are absolute
export const istModulation = (ziel: string): boolean => ziel === 'spur_fader' || ziel === 'spur_pan' || ziel.startsWith('geraet.');
type ClipArt = { art: string; laenge_beats: number };
type SpurArt = { art: string; geraet?: unknown };
// Which target a clip may carry: gain on audio, transpose on MIDI, geraet.* on MIDI clips of tracks whose device owns that parameter
// (RB-338: four, bk: k1..k64); spur_* on every clip.
// spur null: the track is not known here (the model checks the RB rule in pruefeSpur).
export function hkZielErlaubt(ziel: string, clip: ClipArt, spur: SpurArt | null): boolean {
  if (!HK_ZIELE.includes(ziel)) return false;
  if (ziel === 'gain') return clip.art === 'audio';
  if (ziel === 'transpose') return clip.art === 'midi';
  if (ziel.startsWith('geraet.')) return clip.art === 'midi' && (spur === null || (spur.art === 'instrument' && passtGeraetZiel(ziel, spur.geraet)));
  return true;
}

type Fund = { grund: string; text: string } | null;
const fund = (grund: string, text: string): Fund => ({ grund, text });
const zahlOk = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
// The points of one envelope: 1..8192, clip beats 0..MAX_BEAT rising, at most two per beat, values in the range of the target (else punkte_ungueltig)
export function hkPunktePruefung(pk: unknown, ziel: string): Fund {
  if (!Array.isArray(pk) || pk.length < 1) return fund('punkte_ungueltig', 'punkte: at least one point expected (use huellkurve_loeschen)');
  if (pk.length > MAX_LANE_PUNKTE) return fund('zu_gross', `punkte: at most ${MAX_LANE_PUNKTE} per envelope`);
  const { min, max } = HK_BEREICH(ziel);
  let gleich = 0;
  for (let i = 0; i < pk.length; i++) {
    const x = pk[i];
    if (!istObjekt(x)) return fund('argument_ungueltig', `punkte[${i}]: object expected`);
    for (const k of Object.keys(x)) if (k !== 'beat' && k !== 'wert' && k !== 'form') return fund('argument_unbekannt', `punkte[${i}].${k}`);
    if (!zahlOk(x.beat) || x.beat < 0 || x.beat > MAX_BEAT) return fund('punkte_ungueltig', `punkte[${i}].beat: clip beat 0..${MAX_BEAT} expected`);
    if (!zahlOk(x.wert) || x.wert < min || x.wert > max) return fund('punkte_ungueltig', `punkte[${i}].wert: ${ziel} takes ${min}..${max}`);
    if ('form' in x && !(AUTO_FORMEN as readonly unknown[]).includes(x.form)) return fund('punkte_ungueltig', `punkte[${i}].form: ${AUTO_FORMEN.join(' | ')}`);
    if (i > 0) {
      const v = pk[i - 1] as { beat: number };
      if (x.beat < v.beat) return fund('punkte_ungueltig', `punkte[${i}].beat: rising beats expected`);
      gleich = x.beat === v.beat ? gleich + 1 : 0;
      if (gleich >= 2) return fund('punkte_ungueltig', `punkte[${i}].beat: at most two points at one beat`);
    }
  }
  return null;
}
// One envelope: its keys, its target on this clip (and track), verknuepft only as false, loop_beats only on an unlinked one, 1/16..clip length
export function huellkurvePruefung(x: unknown, clip: ClipArt, spur: SpurArt | null): Fund {
  if (!istObjekt(x)) return fund('argument_ungueltig', 'envelope: object expected');
  for (const k of Object.keys(x)) if (!['ziel', 'verknuepft', 'loop_beats', 'punkte'].includes(k)) return fund('argument_unbekannt', `envelope.${k}`);
  if (typeof x.ziel !== 'string' || !hkZielErlaubt(x.ziel, clip, spur)) {
    return fund('huellkurve_ziel', `${String(x.ziel)} is not an envelope target of this ${clip.art} clip (${HK_ZIELE.join(' | ')})`);
  }
  if ('verknuepft' in x && x.verknuepft !== false) return fund('argument_ungueltig', 'verknuepft: only false is stored (absent = linked)');
  if ('loop_beats' in x) {
    if (x.verknuepft !== false) return fund('argument_ungueltig', 'loop_beats: only on an unlinked envelope (verknuepft false)');
    if (!zahlOk(x.loop_beats) || x.loop_beats < LOOP_MIN || x.loop_beats > clip.laenge_beats + 1e-9) {
      return fund('argument_ungueltig', `loop_beats: ${LOOP_MIN}..${clip.laenge_beats} (the clip length) expected`);
    }
  }
  return hkPunktePruefung(x.punkte, x.ziel);
}
export function huellkurvenPruefung(x: unknown, clip: ClipArt, spur: SpurArt | null): Fund {
  if (!Array.isArray(x) || x.length < 1) return fund('argument_ungueltig', 'huellkurven: non-empty list expected (absent when none)');
  const ziele = new Set<unknown>();
  for (const [i, h] of x.entries()) {
    const f = huellkurvePruefung(h, clip, spur);
    if (f) return { grund: f.grund, text: `huellkurven[${i}]: ${f.text}` };
    if (ziele.has(h.ziel)) return fund('argument_ungueltig', `huellkurven[${i}].ziel: twice (${h.ziel})`);
    ziele.add(h.ziel);
  }
  return null;
}

// The lane rule of the target: gain is dB like the fader (the ramp from or to off runs from -60), every other target interpolates plainly
const laneZiel = (ziel: string): string => (ziel === 'gain' ? 'fader' : ziel);
const periode = (hk: Huellkurve, clipLoop?: number | null): number | null =>
  (hk.verknuepft === false ? hk.loop_beats ?? null : clipLoop ?? null);
// The value of an envelope at a clip beat. clipLoop: the clip's loop_beats (linked envelopes repeat with it; unlinked ones ignore it).
export function hkWert(hk: Huellkurve, clipBeat: number, clipLoop?: number | null): number {
  const P = periode(hk, clipLoop);
  const t = P ? clipBeat - Math.floor(clipBeat / P) * P : clipBeat;
  return laneWert(hk.punkte, t, laneZiel(hk.ziel));
}
// The points an envelope brings into the count of MAX_AUTO_PUNKTE: its points once per repetition over the clip
export function hkPunkteZahl(c: Clip): number {
  let n = 0;
  for (const hk of c.huellkurven ?? []) {
    const P = periode(hk, c.loop_beats);
    n += hk.punkte.length * (P ? Math.ceil(c.laenge_beats / P - 1e-9) : 1);
  }
  return n;
}

const runde9 = (x: number): number => Math.round(x * 1e9) / 1e9;
// the value at `b` approached from the left (a point exactly at b counts with its left value when it is a jump)
function linksWert(p: readonly Punkt[], b: number, ziel: string): number {
  const j = p.findIndex((q) => q.beat >= b);
  if (j < 0 || p[j].beat !== b) return laneWert(p, b, ziel);
  if (j === 0) return p[0].wert;
  return p[j].form === 'sprung' ? p[j - 1].wert : p[j].wert;
}
const mitForm = (q: Punkt, form: Punkt['form']): Punkt => (form === undefined ? q : { ...q, form });
// clip_teilen (T6.4): the envelope of the left and the right part when a clip without clip loop is cut `rel` beats after its start.
// Linked: the left part keeps the points below rel plus a boundary point at rel; the right part gets the points from rel on, shifted by -rel, with a
// boundary point at 0 (exact for linear and sprung segments). Unlinked with loop L: the left part keeps everything; the right part is rotated by
// r = rel mod L, so its phase stays the same in the song (points ((p - r) mod L), the seam of the period as a jump pair, boundary points at 0 and L).
export function teileHuellkurve(hk: Huellkurve, rel: number): { links: Huellkurve; rechts: Huellkurve } {
  const p = hk.punkte, z = laneZiel(hk.ziel);
  const kopf = { ziel: hk.ziel, ...(hk.verknuepft === false ? { verknuepft: false as const } : {}),
    ...(hk.loop_beats !== undefined ? { loop_beats: hk.loop_beats } : {}) };
  if (hk.verknuepft !== false || hk.loop_beats === undefined) {
    const amSchnitt = p.filter((q) => q.beat === rel);
    const naechster = p.find((q) => q.beat > rel);
    const linksEnde = amSchnitt.length ? { ...amSchnitt[0] } : mitForm({ beat: rel, wert: laneWert(p, rel, z) }, naechster?.form);
    const rechtsStart = { beat: 0, wert: amSchnitt.length ? amSchnitt[amSchnitt.length - 1].wert : laneWert(p, rel, z) };
    return {
      links: { ...kopf, punkte: [...p.filter((q) => q.beat < rel).map((q) => ({ ...q })), linksEnde] },
      rechts: { ...kopf, punkte: [rechtsStart, ...p.filter((q) => q.beat > rel).map((q) => ({ ...q, beat: runde9(q.beat - rel) }))] },
    };
  }
  const L = hk.loop_beats, r = runde9(rel - Math.floor(rel / L) * L);
  const links = { ...kopf, punkte: p.map((q) => ({ ...q })) };
  if (r < 1e-9 || L - r < 1e-9) return { links, rechts: { ...kopf, punkte: p.map((q) => ({ ...q })) } };
  const fr = laneWert(p, r, z), naht = linksWert(p, L, z), f0 = laneWert(p, 0, z);
  const formIn = (b: number): Punkt['form'] => p.find((q) => q.beat >= b)?.form;
  const aus: Punkt[] = [{ beat: 0, wert: fr }];
  aus.push(...p.filter((q) => q.beat > r && q.beat < L).map((q) => ({ ...q, beat: runde9(q.beat - r) })));
  aus.push(mitForm({ beat: runde9(L - r), wert: naht }, formIn(L)));
  if (f0 !== naht) aus.push({ beat: runde9(L - r), wert: f0, form: 'sprung' });
  aus.push(...p.filter((q) => q.beat > 0 && q.beat < r).map((q) => ({ ...q, beat: runde9(q.beat + L - r) })));
  aus.push(mitForm({ beat: L, wert: fr }, formIn(r)));
  return { links, rechts: { ...kopf, punkte: aus } };
}

// 1.12 slice 5 (U7): the points of an envelope over one stretch [von, von + laenge) of its clip (clip beats), in beats from the stretch start, as the
// core plays them. Linked: a loop copy starts on a period start, so the phase is the beat inside the copy; unlinked: the phase is (clip beat mod L),
// rolled out with a jump pair at every multiple of L. Each period piece starts with its value at the piece start and ends with a boundary point at the
// piece end (the value approached from the left), so the table plays hkWert exactly for linear and sprung segments.
export function hkStrecke(hk: Huellkurve, von: number, laenge: number, clipLoop?: number | null): Punkt[] {
  const p = hk.punkte, z = laneZiel(hk.ziel), bis = von + laenge;
  const P = hk.verknuepft === false ? hk.loop_beats ?? null : null;     // linked: one piece per copy (the caller passes the copy as the stretch)
  const linkedOff = hk.verknuepft !== false && clipLoop ? Math.floor(von / clipLoop + 1e-9) * clipLoop : 0;
  const aus: Punkt[] = [];
  const setze = (q: Punkt): void => {
    const l = aus[aus.length - 1];
    if (l && l.beat === q.beat) { if (l.wert !== q.wert) aus.push({ ...q, form: 'sprung' }); return; }
    aus.push(q);
  };
  for (let m = P ? Math.floor(von / P + 1e-9) : 0; ; m++) {
    const off = P ? m * P : linkedOff, s0 = Math.max(von, off), s1 = P ? Math.min(bis, off + P) : bis;
    if (s1 > s0 + 1e-12) {
      const a = runde9(s0 - off), b = runde9(s1 - off), lokal = (ph: number): number => runde9(ph + off - von);
      const amStart = p.filter((q) => q.beat === a);
      const startWert = amStart.length ? amStart[amStart.length - 1].wert : laneWert(p, a, z);
      setze(aus.length ? { beat: lokal(a), wert: startWert, form: 'sprung' } : { beat: lokal(a), wert: startWert });
      for (const q of p) if (q.beat > a && q.beat < b) aus.push({ ...q, beat: lokal(q.beat) });
      aus.push(mitForm({ beat: lokal(b), wert: linksWert(p, b, z) }, p.find((q) => q.beat >= b)?.form));
    }
    if (!P || s1 >= bis - 1e-12) break;
  }
  // a start point without a jump keeps no form key (the first point of a table, or a piece start that equals the previous end)
  if (aus[0]?.form === 'sprung') delete aus[0].form;
  return aus;
}
// The lane target of a modulation envelope in the playback (D9): spur_fader -> fader, spur_pan -> pan, geraet.* stays
export const modulationsZiel = (ziel: string): string => (ziel === 'spur_fader' ? 'fader' : ziel === 'spur_pan' ? 'pan' : ziel);
