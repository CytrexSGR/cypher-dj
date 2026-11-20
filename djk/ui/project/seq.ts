// SEQ deck v2 (spec 2026-11-14-seq-deck-design, sections 2 to 4): the deck marker of a group, the view descriptor of a MIDI clip, the reader
// conversion of the v1 document and the helpers that list the patterns of a deck.
// A SEQ deck is a top group of the live container (`Gruppe.seq = {schema: 2, platz}`); a pattern is an instrument track that plays into the group,
// with one MIDI clip; the lanes are a view on that clip's notes and envelopes, described by `MidiClip.seq` (`SeqSicht`). The descriptor holds
// no music. This file holds the types and the pure checks of one marker and one descriptor (shape and limits, no project knowledge); the checks
// that need the project (live flag, places, nesting) are in model.ts.
// No file access here. Types are imported from model.ts only as types, so model.ts can import this file without a runtime cycle.
import type { Gruppe, MidiClip, Projekt, Spur } from './model.ts';
import { LPB_WERTE, TICKS_MAX, TICKS_MIN } from './tracker.ts';   // the effect frame of a section that came from the tracker
import { liveBeats, takteProLive } from './taktart_live.ts';   // runtime cycle with model.ts is harmless: used only inside functions

export const SEQ_BEATS = 64;          // the region a pattern clip covers in 4/4 (and the legacy length that stays valid in every meter)
export const SEQ_ZEILEN_MAX = 32;     // lanes per pattern
export const SEQ_TEILER = [1, 0.5, 0.25, 0.125] as const;   // beats per cell: 1/4, 1/8, 1/16, 1/32
export const SEQ_FORMEN = ['sinus', 'dreieck', 'saege', 'saege_ab', 'rechteck', 'rampe', 'zufall'] as const;
export const SEQ_STUFEN_MAX = 64;     // steps of the `zufall` shape (the same limit as MAX_STUFEN of seq_logic.js)

// lpb, ticks (task 24): the effect frame (rows per beat, effect ticks per row) of the patterns that came from a tracker section with effect commands
// or sample slots; absent = the project defaults (4 and 6), never written with a default. The live container has no tracker marker to carry them.
export interface SeqDeck { schema: 2; platz: 1 | 2 | 3 | 4; lpb?: number; ticks?: number }   // later slices add `tonart` and nothing else

export type SeqForm = {
  art: typeof SEQ_FORMEN[number]; von: number; bis: number; phase?: number; saat?: number; stufen?: number;
  abdruck: string;   // fingerprint of the points the shape wrote
};
export type SeqZeile =
  | { id: string; art: 'noten'; teiler: number; ton?: number; name?: string }
  | { id: string; art: 'werte'; teiler: number; ziel: string; von?: string }
  | { id: string; art: 'kurve'; ziel: string; form?: SeqForm };
export interface SeqSicht { schema: 1; zeilen: SeqZeile[] }

// Ids of lanes
const KENNUNG = /^[a-z][a-z0-9]{0,7}$/;
const NAME_MAX = 80;
const ABDRUCK_MAX = 64;
const NOTENFELDER = ['vel', 'laenge'];   // targets of a `werte` lane that are fields of the notes of lane `von`
// envelope targets a pattern lane may carry: the model's, without `gain` (audio clips only). Listed here so this file needs no runtime import.
export const SEQ_HK_ZIELE = ['transpose', 'spur_fader', 'spur_pan', 'geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod',
  ...Array.from({ length: 64 }, (_, i) => `geraet.k${i + 1}`)];

type Urteil = { grund: string; text: string };
const istObjekt = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const zahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const ganzIn = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;

// A check that stops at the first problem: returns the verdict instead of throwing, so the caller decides what to do with it.
class Halt extends Error { urteil: Urteil; constructor(urteil: Urteil) { super(urteil.text); this.urteil = urteil; } }
const ungueltig = (text: string): never => { throw new Halt({ grund: 'argument_ungueltig', text }); };
const unbekannt = (text: string): never => { throw new Halt({ grund: 'argument_unbekannt', text }); };

function schluessel(o: Record<string, unknown>, wo: string, pflicht: string[], optional: string[] = []): void {
  for (const k of Object.keys(o)) if (!pflicht.includes(k) && !optional.includes(k)) unbekannt(`${wo}.${k}`);
  for (const k of pflicht) if (!(k in o)) ungueltig(`${wo}.${k}: missing`);
}

// null = fine; otherwise the reason (the command's reason) and a text. Shape and limits of the deck marker.
export function seqPruefung(x: unknown): Urteil | null {
  try {
    if (!istObjekt(x)) return ungueltig('seq: object expected');
    schluessel(x, 'seq', ['schema', 'platz'], ['lpb', 'ticks']);
    if (x.schema !== 2) ungueltig('seq.schema: 2 expected');
    if (!ganzIn(x.platz, 1, 4)) ungueltig('seq.platz: integer 1..4 expected');
    if ('lpb' in x && !LPB_WERTE.includes(x.lpb as number)) ungueltig(`seq.lpb: one of ${LPB_WERTE.join(' ')} expected`);
    if ('ticks' in x && !ganzIn(x.ticks, TICKS_MIN, TICKS_MAX)) ungueltig(`seq.ticks: integer ${TICKS_MIN}..${TICKS_MAX} expected`);
    return null;
  } catch (e) {
    if (e instanceof Halt) return e.urteil;
    throw e;
  }
}

function pruefeForm(x: unknown, wo: string): void {
  if (!istObjekt(x)) return ungueltig(`${wo}: object expected`);
  schluessel(x, wo, ['art', 'von', 'bis', 'abdruck'], ['phase', 'saat', 'stufen']);
  if (!(SEQ_FORMEN as readonly unknown[]).includes(x.art)) ungueltig(`${wo}.art: ${SEQ_FORMEN.join(' | ')} expected`);
  if (!zahl(x.von)) ungueltig(`${wo}.von: number expected`);
  if (!zahl(x.bis)) ungueltig(`${wo}.bis: number expected`);
  if ('phase' in x && !zahl(x.phase)) ungueltig(`${wo}.phase: number expected`);
  if ('saat' in x && !ganzIn(x.saat, 0, 2 ** 32 - 1)) ungueltig(`${wo}.saat: integer 0..${2 ** 32 - 1} expected`);
  if ('stufen' in x && !ganzIn(x.stufen, 1, SEQ_STUFEN_MAX)) ungueltig(`${wo}.stufen: integer 1..${SEQ_STUFEN_MAX} expected`);
  if (typeof x.abdruck !== 'string' || x.abdruck.length < 1 || x.abdruck.length > ABDRUCK_MAX) {
    ungueltig(`${wo}.abdruck: text of 1..${ABDRUCK_MAX} characters expected`);
  }
}

const teilerOk = (x: unknown): boolean => (SEQ_TEILER as readonly unknown[]).includes(x);

// null = fine. Shape and limits of one view descriptor: lane count, unique ids, grid, trigger notes, targets and the `von` links.
export function seqSichtPruefung(x: unknown): Urteil | null {
  try {
    if (!istObjekt(x)) return ungueltig('seq: object expected');
    schluessel(x, 'seq', ['schema', 'zeilen']);
    if (x.schema !== 1) ungueltig('seq.schema: 1 expected');
    if (!Array.isArray(x.zeilen) || x.zeilen.length < 1 || x.zeilen.length > SEQ_ZEILEN_MAX) {
      ungueltig(`seq.zeilen: list of 1..${SEQ_ZEILEN_MAX} lanes expected`);
    }
    const zeilen = x.zeilen as unknown[];
    const arten = new Map<string, string>();      // lane id -> art
    const toene = new Set<number>();               // trigger notes
    const ziele = new Set<string>();               // envelope targets
    let getoent = 0;                                // pitched lanes
    zeilen.forEach((zx, i) => {
      const wo0 = `seq.zeilen[${i}]`;
      if (!istObjekt(zx)) return ungueltig(`${wo0}: object expected`);
      if (typeof zx.id !== 'string' || !KENNUNG.test(zx.id)) ungueltig(`${wo0}.id: a lane id is a letter and up to seven letters or digits, lower case`);
      const id = zx.id as string, wo = `${wo0} (lane ${id})`;
      if (arten.has(id)) ungueltig(`${wo}.id: lane id used twice in this pattern`);
      if (zx.art === 'noten') {
        schluessel(zx, wo, ['id', 'art', 'teiler'], ['ton', 'name']);
        if (!teilerOk(zx.teiler)) ungueltig(`${wo}.teiler: ${SEQ_TEILER.join(' | ')} beats per cell expected`);
        if ('name' in zx && (typeof zx.name !== 'string' || zx.name.length < 1 || zx.name.length > NAME_MAX)) {
          ungueltig(`${wo}.name: text of 1..${NAME_MAX} characters expected`);
        }
        if ('ton' in zx) {
          if (!ganzIn(zx.ton, 0, 127)) ungueltig(`${wo}.ton: integer 0..127 expected`);
          if (toene.has(zx.ton as number)) ungueltig(`${wo}.ton: another trigger lane already holds note ${zx.ton}`);
          toene.add(zx.ton as number);
        } else if (++getoent > 1) ungueltig(`${wo}: a clip has at most one pitched lane (a notes lane without ton)`);
      } else if (zx.art === 'werte') {
        schluessel(zx, wo, ['id', 'art', 'teiler', 'ziel'], ['von']);
        if (!teilerOk(zx.teiler)) ungueltig(`${wo}.teiler: ${SEQ_TEILER.join(' | ')} beats per cell expected`);
        if (typeof zx.ziel !== 'string') ungueltig(`${wo}.ziel: vel, laenge or an envelope target expected`);
        if (!NOTENFELDER.includes(zx.ziel as string) && !SEQ_HK_ZIELE.includes(zx.ziel as string)) {
          ungueltig(`${wo}.ziel: ${String(zx.ziel)} is neither a note field (${NOTENFELDER.join(', ')}) nor an envelope target of a pattern`);
        }
        if ('von' in zx && typeof zx.von !== 'string') ungueltig(`${wo}.von: the id of a notes lane expected`);
      } else if (zx.art === 'kurve') {
        schluessel(zx, wo, ['id', 'art', 'ziel'], ['form']);
        if (typeof zx.ziel !== 'string' || !SEQ_HK_ZIELE.includes(zx.ziel)) {
          ungueltig(`${wo}.ziel: an envelope target of a pattern expected (${String(zx.ziel)})`);
        }
        if ('form' in zx) pruefeForm(zx.form, `${wo}.form`);
      } else ungueltig(`${wo}.art: 'noten', 'werte' or 'kurve' expected`);
      arten.set(id, zx.art as string);
      if ((zx.art === 'werte' || zx.art === 'kurve') && SEQ_HK_ZIELE.includes(zx.ziel as string)) {
        if (ziele.has(zx.ziel as string)) ungueltig(`${wo}.ziel: the envelope of ${String(zx.ziel)} is already written by another lane`);
        ziele.add(zx.ziel as string);
      }
    });
    // links between lanes, after all ids are known
    const notenZeilen = zeilen.filter((z) => (z as { art: string }).art === 'noten') as { id: string }[];
    const gesehen = new Set<string>();
    zeilen.forEach((zx, i) => {
      const z = zx as { id: string; art: string; ziel?: string; von?: string };
      if (z.art !== 'werte') return;
      const wo = `seq.zeilen[${i}] (lane ${z.id})`;
      const feld = NOTENFELDER.includes(z.ziel as string);
      if (z.von !== undefined) {
        if (arten.get(z.von) !== 'noten') ungueltig(`${wo}.von: ${z.von} is no notes lane of this clip`);
        if (!feld) ungueltig(`${wo}.von: only a lane of ${NOTENFELDER.join(' or ')} names a notes lane`);
      }
      if (!feld) return;
      if (z.von === undefined && notenZeilen.length !== 1) {
        ungueltig(`${wo}.von: ${notenZeilen.length === 0 ? 'the clip has no notes lane to write' : 'the clip has several notes lanes, name one'}`);
      }
      const ziel = `${z.ziel}@${z.von ?? notenZeilen[0].id}`;
      if (gesehen.has(ziel)) ungueltig(`${wo}.ziel: another lane already writes ${z.ziel} of that notes lane`);
      gesehen.add(ziel);
    });
    return null;
  } catch (e) {
    if (e instanceof Halt) return e.urteil;
    throw e;
  }
}

// The region a NEW pattern clip covers: 16 bars of the project meter (4/4: SEQ_BEATS). A stored clip of SEQ_BEATS stays valid in every meter (no migration).
export const seqRegion = (p: Projekt): number => liveBeats(takteProLive(p.taktart));
export const seqLaengeOk = (p: Projekt, laenge: number): boolean => Math.abs(laenge - seqRegion(p)) < 1e-9 || Math.abs(laenge - SEQ_BEATS) < 1e-9;

// The group of place `platz` that holds a SEQ deck, if any.
export const seqGruppe = (p: Projekt, platz: number): Gruppe | undefined => (p.gruppen ?? []).find((g) => g.seq?.platz === platz);

// The patterns of a deck: every track that plays into the group, in track order. `clip` is the track's only clip when that is a MIDI clip, else null.
// `editierbar` is the rule of D8: an instrument track whose clips are none (an empty pattern) or exactly one MIDI clip from beat 0 over the whole
// region (64 beats); anything else is laid out in PRODUCTION and is not edited in the grid.
export function seqFolgen(p: Projekt, gruppe: Gruppe): { spur: Spur; clip: MidiClip | null; editierbar: boolean }[] {
  return p.spuren.filter((s) => s.ausgang?.id === gruppe.id).map((spur) => {
    const einziger = spur.clips.length === 1 ? spur.clips[0] : null;
    const clip = einziger !== null && einziger.art === 'midi' ? einziger : null;
    const passt = clip !== null && Math.abs(clip.start_beat) < 1e-9 && seqLaengeOk(p, clip.laenge_beats);
    return { spur, clip, editierbar: spur.art === 'instrument' && (spur.clips.length === 0 || passt) };
  });
}

// The v1 document (a step document on the group, converted away by this function) had schema 1 and these fields; only `platz` carries over.
// In place on the raw project object that was parsed from a file, BEFORE the model check: every group with `seq.schema === 1` gets
// `{schema: 2, platz}`. Nothing else changes (the voice clips stay as v1 wrote them). Returns whether it changed something.
export function seqV1Wandeln(roh: unknown): boolean {
  if (!istObjekt(roh) || !Array.isArray(roh.gruppen)) return false;
  let geaendert = false;
  for (const g of roh.gruppen as unknown[]) {
    if (!istObjekt(g) || !istObjekt(g.seq) || g.seq.schema !== 1) continue;
    g.seq = { schema: 2, platz: g.seq.platz };
    geaendert = true;
  }
  return geaendert;
}
