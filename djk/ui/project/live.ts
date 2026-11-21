// Live container: reading the modules (a module is a top group with `modul` that sits in a `stems` place) and building a module tree. Where a module
// sounds is `Projekt.plaetze`, not a field of the group.
import { fuehreListeAus } from './commands.ts';
import { SAMPLERATE, blendPfad, type Herkunft, type Projekt, type Spur, type Warp } from './model.ts';
import { STEMS, type Stem } from './stems.ts';
import { liveBeats, takteProLive } from './taktart_live.ts';
import { TROMMEL_KARTEN } from './trommel_map.ts';

// The module groups of the places that hold `stems`, in place order (place 1 first)
export function modulGruppen(p: Projekt): string[] {
  return (p.plaetze ?? []).flatMap((x) => (x.typ === 'stems' ? [x.gruppe] : []));
}

// A module is addressed by its place: the container letter A..D is place 1..4 (the wire name stays `slot`). Nothing is derived from the order of the
// modules; a place holds a module exactly when `plaetze[place - 1]` is `stems`.
export type Slot = 'A' | 'B' | 'C' | 'D';
export const SLOTS: readonly Slot[] = ['A', 'B', 'C', 'D'];
export const slotPlatz = (s: Slot): 1 | 2 | 3 | 4 => (SLOTS.indexOf(s) + 1) as 1 | 2 | 3 | 4;
export const platzSlot = (platz: number): Slot => SLOTS[platz - 1];

// The group of the module that sits in the place of `slot`, or undefined (empty place, or a place of another type)
export function modulAmPlatz(p: Projekt, slot: Slot): string | undefined {
  const x = p.plaetze?.[slotPlatz(slot) - 1];
  return x?.typ === 'stems' ? x.gruppe : undefined;
}

// The container letter of the place that holds the module group, or undefined (parked or no module place)
export function platzVonModul(p: Projekt, gruppeId: string): Slot | undefined {
  const i = (p.plaetze ?? []).findIndex((x) => x.typ === 'stems' && x.gruppe === gruppeId);
  return i < 0 ? undefined : SLOTS[i];
}

// A place argument: 1..4 (number or string) or the container letter A..D; anything else is undefined
export function normierePlatz(v: unknown): Slot | undefined {
  if (typeof v === 'string' && /^[A-D]$/.test(v)) return v as Slot;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[1-4]$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 4 ? SLOTS[n - 1] : undefined;
}

export const LIVE_LOOP_BEATS = 64;                                   // the live loop region in 4/4: 16 bars
// The live loop region of a project: 16 bars of its meter (4/4 and no meter: LIVE_LOOP_BEATS).
export const liveRegion = (p: Projekt): number => liveBeats(takteProLive(p.taktart));
const STEM_NAME: Record<Stem, string> = { drums: 'Drums', bass: 'Bass', other: 'Other', vocals: 'Vocals', guitar: 'Guitar', piano: 'Piano' };
export const LOOP_SPUR = 'Loop';
const EPS = 1e-3;

export interface ModulDatei { sha256: string; pfad: string }
export interface ModulLoop extends ModulDatei { beats: number; frames: number }
export type ModulHerkunftSlot = NonNullable<Projekt['gruppen'][number]['modul']>;

// Decision 17: every module clip carries a warp of two markers (source 0 s at beat 0, source end at `beats`), so it follows the core tempo from the
// rendering's basis_bpm. The source bar phase is kept: with p = (von_beat - eins_beat) mod 4, eins_beat = first downbeat of the rendering
// (0 if unknown), and a loop of 4 beats or more, the content starts at (L - p) mod L at project beat 0. A repeating clip cannot start inside its file,
// so that is two clips: the loop clip from beat p to 64 (its copies end exactly at
// 64) and a lead-in of p beats before it that plays the tail of the loop (content L - p .. L). Shorter than 4 beats: no offset.
export function modulPhase(vonBeat: number, beats: number, eins = 0): number {
  if (beats < 4) return 0;
  const p = (((vonBeat - eins) % 4) + 4) % 4;
  return p < EPS || p > 4 - EPS ? 0 : p;
}
function clipBefehle(spurId: string, d: ModulDatei, loop: ModulLoop, vonBeat: number, eins: number, name: string, modus: Warp['modus'],
  region = LIVE_LOOP_BEATS): unknown[] {
  const dauer = loop.frames / SAMPLERATE, L = loop.beats, p = modulPhase(vonBeat, L, eins);
  const warp = (versatz: number): Warp => ({ an: true, modus, marker: [[0, 0], [dauer, L]], versatz_beats: versatz, quelle: 'hand',
    transpose_st: 0, detune_ct: 0 });
  const laenge = region - p;
  const aus: unknown[] = [];
  if (p > 0) aus.push({ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: 0, laenge_beats: p, sha256: d.sha256, pfad_hinweis: d.pfad,
    name: `${name} lead-in`.slice(0, 80), warp: warp(L - p) });
  aus.push({ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: p, laenge_beats: laenge, sha256: d.sha256, pfad_hinweis: d.pfad,
    name: name.slice(0, 80), warp: warp(0), ...(L < laenge - 1e-9 ? { loop_beats: L } : {}) });
  return aus;
}

// Builds decision 2's tree in one project value (the caller stores it as one undo step, like baueStemsProjekt):
//   top group `A · <title>` (group fader 0 dB: the channel pad/N is the only gain, DJ view places decision 9; modul = the origin)
//     track `Loop` (the exported loop; muted once the stems are in)
//     group `Drums` / `Bass` / `Other` / `Vocals` (/ `Guitar` / `Piano`), each with the original track of that stem at 0 dB
// Without stems the module is loop-only: the Loop track is audible. When the slot already holds a module, the stem groups are added to it and the
// Loop track is muted; its fader and everything else stay as Andreas left them.
export function baueModul(p0: Projekt, slot: Slot, loop: ModulLoop, stems: Partial<Record<Stem, ModulDatei>>,
  herkunft: ModulHerkunftSlot, quelle: Herkunft = 'andreas'): Projekt {
  const lauf = (p: Projekt, b: unknown): Projekt => fuehreListeAus(p, [b], { quelle }).projekt;
  const nimm = (p: Projekt, liste: unknown[]): Projekt => liste.reduce<Projekt>((q, b) => lauf(q, b), p);
  let p = p0;
  const vorhanden = modulAmPlatz(p, slot);
  const von = herkunft.von_beat, eins = herkunft.eins_beat ?? 0, titel = herkunft.titel;
  let oben: string, loopId: string;
  if (vorhanden === undefined) {
    p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: LOOP_SPUR });
    loopId = p.spuren[p.spuren.length - 1].id;
    p = nimm(p, clipBefehle(loopId, loop, loop, von, eins, `${titel} loop`, 'complex', liveRegion(p0)));
  } else {
    const g = p.gruppen.find((x) => x.id === vorhanden)!;
    if (p.gruppen.some((x) => x.ausgang?.id === g.id)) throw new Error(`the module in slot ${slot} already has its stems`);
    const l = p.spuren.find((s) => s.ausgang?.id === g.id && s.name === LOOP_SPUR);
    if (!l) throw new Error(`the module in slot ${slot} has no ${LOOP_SPUR} track`);
    loopId = l.id;
  }
  const gewaehlt = STEMS.filter((s) => stems[s] !== undefined);
  const kinder: string[] = [];
  for (const stem of gewaehlt) {
    const d = stems[stem]!;
    p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: `${STEM_NAME[stem]} original` });
    const sid = p.spuren[p.spuren.length - 1].id;
    p = nimm(p, clipBefehle(sid, d, loop, von, eins, `${titel} ${STEM_NAME[stem]}`, stem === 'drums' ? 'repitch' : 'complex', liveRegion(p0)));
    p = lauf(p, { befehl: 'gruppenspur_neu', name: STEM_NAME[stem], mitglieder: [sid] });
    kinder.push(p.gruppen.at(-1)!.id);
  }
  if (vorhanden === undefined) {
    p = lauf(p, { befehl: 'gruppenspur_neu', name: `${slot} · ${titel}`.slice(0, 80), mitglieder: [loopId, ...kinder] });
    oben = p.gruppen.at(-1)!.id;
    p = lauf(p, { befehl: 'modul_setzen', gruppe_id: oben, modul: { ...herkunft } });
    // the module sits in the place of its slot letter (the caller made sure it is a free place)
    p = lauf(p, { befehl: 'platz_setzen', platz: slotPlatz(slot), typ: 'stems', gruppe_id: oben });
  } else {
    oben = vorhanden;
    for (const k of kinder) p = lauf(p, { befehl: 'ziel_setzen', strang_id: k, ausgang: { art: 'gruppe', id: oben } });
  }
  if (gewaehlt.length > 0) p = lauf(p, { befehl: 'spur_aendern', spur_id: loopId, mute: true });
  return p;
}

// Decisions 8, 9: the new instrument paths. Drums and Bass get a Baukasten (bk) instrument track with the default graph and the MIDI clip that task 7
// extracted from the stem. Other stems have none (spec 3).
export type NeuStem = 'drums' | 'bass';
export const NEU_INSTRUMENT: Record<NeuStem, string> = { drums: 'drums-909', bass: 'synth-neuro' };
export interface NeueNote { beat: number; laenge: number; ton: number; vel: number }

// The notes sit on the loop's beat axis (beat 0 = the loop start, `beats` long). Like the audio clips (clipBefehle): bar phase p, then the loop clip from
// beat p to 64 repeating every L beats, and a lead-in of p beats that plays the tail of the loop (notes from L - p on, moved to the clip start).
function midiClipBefehle(spurId: string, noten: NeueNote[], loopBeats: number, vonBeat: number, eins: number, name: string,
  region = LIVE_LOOP_BEATS): unknown[] {
  const L = loopBeats, p = modulPhase(vonBeat, L, eins);
  const klemme = (n: NeueNote, v: number, bis: number): NeueNote => ({ beat: n.beat - v, ton: n.ton, vel: n.vel,
    laenge: Math.max(0.0625, Math.min(n.laenge, bis - (n.beat - v))) });
  const aus: unknown[] = [];
  if (p > 0) {
    const kopf = noten.filter((n) => n.beat >= L - p - EPS).map((n) => klemme(n, L - p, p));
    aus.push({ befehl: 'clip_neu', spur_id: spurId, art: 'midi', start_beat: 0, laenge_beats: p, name: `${name} lead-in`.slice(0, 80), noten: kopf });
  }
  const laenge = region - p;
  aus.push({ befehl: 'clip_neu', spur_id: spurId, art: 'midi', start_beat: p, laenge_beats: laenge, name: name.slice(0, 80),
    noten: noten.filter((n) => n.beat < L).map((n) => klemme(n, 0, L)), ...(L < laenge - 1e-9 ? { loop_beats: L } : {}) });
  return aus;
}

// Adds to every Drums/Bass stem group of the slot's module (that has MIDI notes) an instrument track `<Stem> new` with its default graph, the
// MIDI clips and the fader closed at -200 (blend 0 = the original alone, so nothing changes in the sound until Andreas blends). A stem group that
// already has an instrument track, or has no original track, is left alone. One project value; the caller stores it as one undo step.
export function baueNeuePfade(p0: Projekt, slot: Slot, noten: Partial<Record<NeuStem, NeueNote[]>>, quelle: Herkunft = 'andreas'): Projekt {
  const lauf = (p: Projekt, b: unknown): Projekt => fuehreListeAus(p, [b], { quelle }).projekt;
  const top = modulAmPlatz(p0, slot);
  if (top === undefined) throw new Error(`live slot ${slot} holds no module`);
  const herkunft = p0.gruppen.find((g) => g.id === top)!.modul!;
  let p = p0;
  for (const stem of ['drums', 'bass'] as const) {
    const liste = noten[stem];
    if (!liste || liste.length === 0) continue;
    const kind = p.gruppen.find((g) => g.ausgang?.id === top && g.name === STEM_NAME[stem]);
    if (!kind || p.spuren.some((s) => s.ausgang?.id === kind.id && s.art === 'instrument')) continue;
    if (!p.spuren.some((s) => s.ausgang?.id === kind.id && s.art === 'audio')) continue;
    const geraet = { art: 'intern', name: 'bk', graph: NEU_INSTRUMENT[stem], parameter: {} };
    p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: `${STEM_NAME[stem]} new`, geraet });
    const sid = p.spuren[p.spuren.length - 1].id;
    const mname = `${herkunft.titel} ${STEM_NAME[stem]} new`;
    p = midiClipBefehle(sid, liste, herkunft.laenge_beats, herkunft.von_beat, herkunft.eins_beat ?? 0, mname, liveRegion(p0))
      .reduce<Projekt>((q, b) => lauf(q, b), p);
    p = lauf(p, { befehl: 'ziel_setzen', strang_id: sid, ausgang: { art: 'gruppe', id: kind.id } });
    p = lauf(p, { befehl: 'spur_aendern', spur_id: sid, fader_db: -200 });
    if (blendPfad(p, kind.id) === null) throw new Error(`stem group ${kind.id} lost its tracks`);
  }
  return p;
}

// Task 11 (decision 19): key distance of a module to the deck on the master, and adapting the module to it.
// The catalogue stores the key in Camelot notation ('8A' = A minor, '8B' = C major; catalog.ts camelotNachbarn). A minor key and its relative major share
// the wheel number, so the number alone gives the pitch class: major root = (n - 8) * 7 mod 12 (8B = C = 0, 5B = Eb = 3), and 8A = C major too.
// That is the relation of major and minor: Am and C are 0 apart, Am under Cm (5A = Eb major) is +3.
export function tonartWurzel(k: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2})([AB])\s*$/i.exec(k ?? '');
  const n = m ? Number(m[1]) : 0;
  if (!m || n < 1 || n > 12) return null;
  return ((((n - 8) * 7) % 12) + 12) % 12;
}
// Semitones the module must move to fit the deck key, the shortest way in -6..+6 (the tritone is +6). null = a key is unknown. This is the distance of
// the module as it came from the catalogue; what is already applied (`modul.transponiert`) is not subtracted here.
export function tonartAbstand(modul: { tonart?: string }, deckTonart: string | null | undefined): number | null {
  const a = tonartWurzel(modul.tonart), b = tonartWurzel(deckTonart);
  if (a === null || b === null) return null;
  const d = (((b - a) % 12) + 12) % 12;
  return d > 6 ? d - 12 : d;
}

// What adapting still has to move: distance minus what is applied. 0 = adapted. The new total is always `abstand`, so adapting twice changes nothing.
export function tonartRest(modul: { tonart?: string; transponiert?: number }, deckTonart: string | null | undefined): number | null {
  const d = tonartAbstand(modul, deckTonart);
  return d === null ? null : d - (modul.transponiert ?? 0);
}

// A track whose note number picks the sound, not the pitch: a drum-map graph (drums-909, drums-808) or a kit. Moving its notes swaps the drums.
const trommelSpur = (s: Spur): boolean => s.geraet?.art === 'intern'
  && (s.geraet.name === 'kit' || (s.geraet.name === 'bk' && Object.hasOwn(TROMMEL_KARTEN, s.geraet.graph)));

// Moves the whole module tree by the missing semitones: MIDI notes by `ton`, audio clips by warp.transpose_st (clips without a warp or in repitch/beats
// mode cannot be pitch shifted, so the drums stay; the MIDI of a drum track, drum-map graph or kit, stays too: there the note picks the drum), and
// stores the total on the module (`transponiert`, absent at 0). One project value: one undo step.
export function passeModulAn(p: Projekt, gruppeId: string, abstand: number, quelle: Herkunft = 'andreas'): Projekt {
  const top = p.gruppen.find((g) => g.id === gruppeId);
  if (!top?.modul) throw new Error(`group ${gruppeId} is no module`);
  const delta = abstand - (top.modul.transponiert ?? 0);
  const ids = new Set<string>([gruppeId]);
  for (let i = 0, l = [gruppeId]; i < l.length; i++) for (const g of p.gruppen) if (g.ausgang?.id === l[i]) { l.push(g.id); ids.add(g.id); }
  const befehle: unknown[] = [];
  if (delta !== 0) {
    for (const s of p.spuren) {
      if (!s.ausgang || !ids.has(s.ausgang.id)) continue;
      const trommel = trommelSpur(s);
      for (const c of s.clips) {
        if (c.art === 'midi') {
          if (c.noten.length > 0 && !trommel) befehle.push({ befehl: 'noten_aendern', clip_id: c.id,
            noten: c.noten.map((n) => ({ id: n.id, ton: Math.min(127, Math.max(0, n.ton + delta)) })) });
        } else if (c.warp && c.warp.modus !== 'repitch' && c.warp.modus !== 'beats') {
          befehle.push({ befehl: 'warp_setzen', clip_id: c.id, transpose_st: c.warp.transpose_st + delta });
        }
      }
    }
  }
  const { transponiert: _alt, ...rest } = top.modul;
  befehle.push({ befehl: 'modul_setzen', gruppe_id: gruppeId, modul: { ...rest, ...(abstand !== 0 ? { transponiert: abstand } : {}) } });
  return fuehreListeAus(p, befehle, { quelle }).projekt;
}
