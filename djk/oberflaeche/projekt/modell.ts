// Projektmodell D1 (Spec docs/masterplan/D1-SPEC.md 3.3): project.json im Format cypherdj-projekt/2 (/1 wird beim Laden gehoben, 1.10 P3).
// Typen, Prüfung, Erzeugung, IDs.
// Reine Funktionen, keine Datei, kein Server. Die Prüfung ist geschlossen: ein unbekanntes Feld ist ein Fehler (Tippfehler sollen
// auffallen, die Version des Formats ist festgelegt; Erweiterungen bekommen die nächste Nummer).
// Paket 1.13: Audio-Clips dürfen in /2 einen Warp tragen (ein weiteres optionales Feld, keine neue Nummer); in /1 ist warp ein unbekanntes Feld.
import { SEGMENT_BPM_MAX, SEGMENT_BPM_MIN } from './warp.ts';

export const FORMAT = 'cypherdj-projekt/2';
export const FORMAT_ALT = 'cypherdj-projekt/1';   // 1.10 (P3): /1 öffnet weiter und wird beim Laden im Speicher zu /2
export const MAX_SPUREN = 32;          // gleich oeffentlich/produktion/grenzen.js, geprüft von tests/grenzen.test.mjs
export const MAX_GRUPPEN = 8;          // 1.10 (F1: eigene Plätze neben den 32 Spuren); gleich grenzen.js
export const WIRT_SLOTS = 1;            // Spec 6.28: in D1 läuft genau ein Wirt (arr1); der Kern behält die Ports für Slot 2
export const MAX_CLIPS = 4096;          // Grenzen des Kerns (Spec 3.2)
export const MAX_NOTEN = 65536;
export const TEMPO_MIN = 60;
export const TEMPO_MAX = 200;
export const MAX_BEAT = 100_000;        // Obergrenze für Lagen und Längen: schützt vor Unsinn, ~25 000 Takte
export const FADER_MIN = -200;          // −200 heißt im Stellwerk „aus"
export const GAIN_MIN = -96;           // Spec 6.27: Clip-Gain −96..+24 dB, derselbe Bereich nimmt der Kern an
export const GAIN_MAX = 24;
export const FADER_MAX = 6;            // Spec 6.16: Spur-Fader −200..+6 dB in allen Fundorten
export const SAMPLERATE = 48000;
export const GRUPPE_MAX = 32;          // Paket 1.18 E-c: Länge des Gruppennamens einer Spur (Varianten)
export const INTERNE_EINGAENGE = ['erz/1', 'erz/2', 'erz/3'] as const;
export const MAX_ARM_AUDIO = 8;
// 1.8 Slice 1: optional; fehlt es, ist die Spur nicht scharf und ohne Eingang. Externe Eingänge kommen mit Slice 2.
export interface SpurAufnahme { scharf: boolean; eingang: { art: 'intern'; name: (typeof INTERNE_EINGAENGE)[number] } | null }
export const SPUR_FARBEN = ['#e0563b', '#3b8de0', '#9b59d0', '#3bb07a', '#e0a83b', '#d03b8d', '#3bc7d0', '#8a8f98'];

// --- Warp (Paket 1.13, ADR 031): eine Eigenschaft des Audio-Clips ---------------------------------------------------------------
// marker: [quell_s, beat], beide streng steigend; beat ist Clip-Beat (0 = die Stelle der Quelle, an der 1.1.1 liegt). versatz_beats:
// welcher Clip-Beat am Clip-Anfang spielt (ersetzt offset_s, solange an). Ist `an` falsch, bleibt der Warp erhalten, gilt aber nicht.
// Slice 2: complex und tones (Warp-Werk im Kern); Slice 4: beats (Einheiten im Callback des Kerns, warp.ts beatsEinheiten)
export const WARP_MODI = ['repitch', 'beats', 'complex', 'tones'] as const;
export type WarpModus = (typeof WARP_MODI)[number];
export const WARP_QUELLEN = ['werkstatt', 'traktor', 'mediathek', 'takte', 'hand'] as const;
export type WarpQuelle = (typeof WARP_QUELLEN)[number];
export const MAX_MARKER = 4096;                                // je Clip; der Kern prüft zusätzlich 262 144 in der ganzen Wiedergabe
// Halbtöne; Bungee rechnet 2 Oktaven (third_party/bungee/src/Timing.cpp:22, Plan Slice 5 D1); die Spec sagte 48. Nach unten nur −12 (D1, Andreas 2026-10-28):
// ab −13 st liegt der Anschlag im Arrangement über dem Lage-Gate (gemessen −13 st 26,9 Samples, −24 st 50,9, Gate 25). Der Kern nimmt weiter 0,25 bis 4.
export const TRANSPOSE_MIN = -12;
export const TRANSPOSE_MAX = 24;
export const DETUNE_MAX = 50;
export const GESAMT_CT_MIN = TRANSPOSE_MIN * 100;       // transpose_st · 100 + detune_ct liegt in [MIN, MAX]: pitch 0,5 bis 4
export const GESAMT_CT_MAX = TRANSPOSE_MAX * 100;
// Frequenzfaktor des Warps (Bungee Request.pitch): die einzige Rechnung, der Kern bekommt den Faktor und rechnet nicht aus Halbtönen
export const pitchFaktor = (st: number, ct: number): number => 2 ** (st / 12 + ct / 1200);
export const BEATS_RASTER = ['1/4', '1/8', '1/16', '1/32', 'transienten'] as const;
export const BEATS_LOOP = ['aus', 'vor', 'vor_zurueck'] as const;
export interface BeatsParameter { raster: (typeof BEATS_RASTER)[number]; loop: (typeof BEATS_LOOP)[number]; huelle: number }
// wie Live (Preserve Transients, Loop Forward, Envelope 100)
export const BEATS_VORGABE: Readonly<BeatsParameter> = { raster: 'transienten', loop: 'vor', huelle: 100 };
export interface Warp {
  an: boolean; modus: WarpModus; marker: [number, number][]; versatz_beats: number; quelle: WarpQuelle; eins_unsicher?: boolean;
  transpose_st: number; detune_ct: number;
  beats?: BeatsParameter;   // nur gelesen im Modus beats; bleibt beim Moduswechsel stehen (wie Live)
}

export type DekodiertZustand = 'nein' | 'laeuft' | 'fertig' | 'fehler';
export const DEKODIERT: readonly DekodiertZustand[] = ['nein', 'laeuft', 'fertig', 'fehler'];

export interface Note { id: string; beat: number; laenge: number; ton: number; vel: number }
// loop_beats (Spec 6.17): null oder fehlend = kein Loop; sonst wiederholt sich [0, loop_beats) bis laenge_beats (1/16 ≤ loop_beats ≤ laenge_beats)
export interface AudioClip {
  id: string; art: 'audio'; name: string; start_beat: number; laenge_beats: number; loop_beats?: number | null;
  stumm?: boolean;   // Slice 6 (D12): true = der Übersetzer lässt den Clip weg (Live und Export); fehlt = hörbar
  quelle: { sha256: string; pfad_hinweis: string }; dekodiert: DekodiertZustand;
  offset_s: number; gain_db: number; fade_ein_beats: number; fade_aus_beats: number;
  warp?: Warp | null;                                          // Paket 1.13 (nur /2): fehlt oder null = ohne Warp (das Verhalten von /1)
}
// naechste_noten_id am Clip: nur noch in Dateien des ersten S2int-Baus (Spec 6.28 Nachsatz zu 6.26); pruefeProjekt übernimmt ihn ins Projekt
export interface MidiClip {
  id: string; art: 'midi'; name: string; start_beat: number; laenge_beats: number; loop_beats?: number | null; naechste_noten_id?: number; noten: Note[];
}
export type Clip = AudioClip | MidiClip;
export interface InternGeraet { art: 'intern'; name: 'rb338'; parameter: Record<string, number> }
export interface WirtGeraet { art: 'wirt'; name: 'surge'; slot: number }
export type Geraet = InternGeraet | WirtGeraet;
// kennung: ganze Zahl (Spec 3.1 und 6.2, wie /k/arr/freeze). sha256: Inhalts-Hash der Datei, beim Einfrieren berechnet (6.2); der Übersetzer liest
// die Datei dafür nicht neu. von_beat: Ankerpunkt der Freeze-Datei im Projekt (Ergänzung zur Spec); fehlt das Feld, gilt 0.
export interface Freeze { datei: string; frames: number; kennung: number; sha256: string; von_beat?: number }
// von (Spec 6.22): wer die Spur angelegt hat, gesetzt bei spur_neu aus der Quelle, in D1 unveränderlich; fehlt es (älteres Projekt), gilt andreas
export type Herkunft = 'andreas' | 'cypher';
export const herkunft = (s: { von?: Herkunft }): Herkunft => s.von ?? 'andreas';
// gruppe (Paket 1.18, E-c): optional; Spuren mit demselben Text sind Varianten (Befehl variante_waehlen), der Text hat 1 bis GRUPPE_MAX Zeichen
// 1.10 Slice 1: Ziel einer Spur. Fehlt das Feld, gilt master (es wird nie gespeichert); sonst die Gruppen-Spur mit dieser ID.
export interface AusgangGruppe { art: 'gruppe'; id: string }
export interface Gruppe { id: string; nr: number; name: string; farbe: string; fader_db: number; pan: number; mute: boolean; solo: boolean; gefaltet: boolean }
export interface Master { fader_db: number }
export interface Spur {
  id: string; von?: Herkunft; gruppe?: string; nr: number; name: string; farbe: string; art: 'audio' | 'instrument';
  geraet?: Geraet; freeze?: Freeze | null; aufnahme?: SpurAufnahme; ausgang?: AusgangGruppe;
  fader_db: number; pan: number; mute: boolean; solo: boolean; clips: Clip[];
}
// naechste_id (Spec 6.26): Zähler je Art (spur, clip, gruppe); naechste_noten_id (Spec 6.28 Nachsatz zu 6.26): EIN Noten-Zähler für alle Clips.
// Alle steigen nur und stehen in keinem Patch, Undo und Redo setzen sie nicht zurück.
export interface Projekt {
  format: typeof FORMAT; name: string; rev: number; wiedergabe_rev: number; tempo_bpm: number; taktart: [number, number];
  naechste_id?: { spur?: number; clip?: number; gruppe?: number }; naechste_noten_id?: number;
  loop: { an: boolean; von_beat: number; bis_beat: number };
  metronom: { an: boolean; pegel_db: number; ziel: 'master' | 'cue' };
  spuren: Spur[];
  gruppen: Gruppe[]; master: Master;   // 1.10 (P3): ab /2 Pflicht
}

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;          // kein „/": Wiedergabe-Noten heißen <clip>/<note>
const FARBE = /^#[0-9a-fA-F]{6}$/;
const SHA = /^[0-9a-f]{64}$/;
// Parameter des RB-338 (Spec 2.4 und 6.4, aus rb_dsp::parameter::IDS). Alles andere lehnen Befehle als argument_unbekannt ab.
export const RB_PARAMETER: readonly string[] = ['lautstaerke', 'wellenform', 'cutoff', 'resonanz', 'env_mod', 'decay', 'accent'];
export const KENNUNG_MAX = 2 ** 31 - 1;                 // /k/arr/freeze trägt die Kennung als int32
export const LOOP_MIN = 1 / 16;                         // Spec 6.17: kürzester Clip-Loop

export const istObjekt = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const zahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const ganz = (x: unknown): x is number => Number.isInteger(x);

// Zahlen wie JSON.stringify (-0 → 0, 1.0 → 1) und Schlüssel tief sortiert (Spec A8). Array-Reihenfolge bleibt.
export function sortiert<T>(x: T): T {
  if (Array.isArray(x)) return x.map(sortiert) as unknown as T;
  if (x !== null && typeof x === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(x as object).sort()) o[k] = sortiert((x as Record<string, unknown>)[k]);
    return o as T;
  }
  return (typeof x === 'number' && Object.is(x, -0) ? 0 : x) as T;
}
export const kanonisch = (x: unknown): string => JSON.stringify(sortiert(x));

export function neuesProjekt(name: string): Projekt {
  return {
    format: FORMAT, name, rev: 0, wiedergabe_rev: 0, tempo_bpm: 120, taktart: [4, 4],
    loop: { an: false, von_beat: 0, bis_beat: 32 },
    metronom: { an: false, pegel_db: -12, ziel: 'master' },
    spuren: [], naechste_id: { spur: 1, clip: 1, gruppe: 1 }, naechste_noten_id: 1,    // Spec 6.26, 6.35: ein neues Projekt führt seine Zähler von Anfang an
    gruppen: [], master: { fader_db: 0 },                                              // 1.10 (F3): ein neues Projekt hat keine Gruppen, der PM steht bei 0 dB
  };
}

// --- IDs ------------------------------------------------------------------------------------------------------------
const ZIFFERN = /^\d+$/;
export function hoechste(ids: Iterable<string>, praefix: string): number {
  let m = 0;
  for (const id of ids) if (id.length > 1 && id[0] === praefix && ZIFFERN.test(id.slice(1))) m = Math.max(m, Number(id.slice(1)));
  return m;
}
// Spur-IDs s<n>, Clip-IDs c<n> projektweit, Noten-IDs n<n> aus einem Zähler für alle Clips (eindeutig sind sie je Clip). Eine ID wird nie
// wiederverwendet (Spec 6.26): Löschen ist eine Vorwärts-Änderung, und ein spätes Ereignis (Dekodieren, Kern-Quittung) darf nie das falsche Objekt
// treffen. Das Projekt führt dazu den Zähler naechste_id je Art und naechste_noten_id; sie steigen nur und stehen in keinem Patch (patch.ts),
// Undo und Redo lassen sie also stehen. Der Noten-Zähler liegt im Projekt, nicht im Clip (Spec 6.28): ein Clip ist Teil der Undo-Patches, ein
// Redo brachte seinen Zählerstand von damals mit. Fehlt ein Zähler (älteres Projekt), gilt das Maximum der vorhandenen IDs plus 1, beim
// Noten-Zähler auch ein alter Clip-Zähler. Die Funktionen ändern den Zähler an `p` selbst: sie gehören auf den Entwurf eines Befehls.
export function neueId(p: Projekt, art: 'spur' | 'clip' | 'gruppe'): string {
  const praefix = art === 'spur' ? 's' : art === 'clip' ? 'c' : 'g';
  const ids = art === 'spur' ? p.spuren.map((s) => s.id)
    : art === 'clip' ? p.spuren.flatMap((s) => s.clips.map((c) => c.id)) : (p.gruppen ?? []).map((g) => g.id);
  const lebend = hoechste(ids, praefix);
  const n = Math.max(p.naechste_id?.[art] ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, [art]: n + 1 };
  return `${praefix}${n}`;
}
// Stand des Noten-Zählers: der Projekt-Zähler, sonst das Maximum aller Noten-IDs und alter Clip-Zähler (Spec 6.28) plus 1
export function notenZaehler(p: Projekt): number {
  if (p.naechste_noten_id !== undefined) return p.naechste_noten_id;
  let m = 1;
  for (const s of p.spuren) {
    for (const c of s.clips) if (c.art === 'midi') m = Math.max(m, hoechste(c.noten.map((x) => x.id), 'n') + 1, c.naechste_noten_id ?? 1);
  }
  return m;
}
export function neueNotenId(p: Projekt): string {
  const n = notenZaehler(p);
  p.naechste_noten_id = n + 1;
  return `n${n}`;
}
// Nummer einer Noten-ID der Form n<ziffern>, sonst null (eine eigene ID wie „kick“ zählt nicht)
export const notenNummer = (id: string): number | null => (id.length > 1 && id[0] === 'n' && ZIFFERN.test(id.slice(1)) ? Number(id.slice(1)) : null);
// Spec 6.28: alte Clip-Zähler (erster S2int-Bau) ins Projekt übernehmen (Maximum) und am Clip entfernen. Ändert `p` selbst.
export function uebernimmNotenZaehler(p: Projekt): void {
  let alt = false;
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'midi' && c.naechste_noten_id !== undefined) alt = true;
  if (!alt) return;
  const projektweit = p.naechste_noten_id;
  delete p.naechste_noten_id;
  p.naechste_noten_id = Math.max(projektweit ?? 1, notenZaehler(p));
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'midi') delete c.naechste_noten_id;
}

// Spec 6.35 (zu 6.26): fehlen einem älteren Projekt die Zähler, setzt sie schon das Öffnen auf das Maximum der vorhandenen IDs plus 1, nicht
// erst das erste Anlegen (neueId rechnet sonst mit den lebenden IDs, und eine vorher gelöschte höchste ID käme wieder). Ein vorhandener Zähler
// bleibt, wie er ist (er steigt nur). Ändert `p` selbst.
export function setzeFehlendeZaehler(p: Projekt): void {
  const z = p.naechste_id;
  p.naechste_id = {
    spur: z?.spur ?? hoechste(p.spuren.map((s) => s.id), 's') + 1,
    clip: z?.clip ?? hoechste(p.spuren.flatMap((s) => s.clips.map((c) => c.id)), 'c') + 1,
    gruppe: z?.gruppe ?? hoechste((p.gruppen ?? []).map((g) => g.id), 'g') + 1,
  };
  if (p.naechste_noten_id === undefined) p.naechste_noten_id = notenZaehler(p);
}

export function sucheSpur(p: Projekt, id: string): Spur | undefined { return p.spuren.find((s) => s.id === id); }
export function sucheGruppe(p: Projekt, id: string): Gruppe | undefined { return (p.gruppen ?? []).find((g) => g.id === id); }
export function sucheClip(p: Projekt, id: string): { spur: Spur; clip: Clip } | undefined {
  for (const spur of p.spuren) { const clip = spur.clips.find((c) => c.id === id); if (clip) return { spur, clip }; }
  return undefined;
}

// --- Prüfung --------------------------------------------------------------------------------------------------------
type Ergebnis<T> = { wert: T } | { fehler: string };
class Fehl extends Error {}
const werfe = (wo: string, was: string): never => { throw new Fehl(`${wo}: ${was}`); };

function felder(o: unknown, wo: string, pflicht: string[], optional: string[] = []): Record<string, unknown> {
  if (!istObjekt(o)) return werfe(wo, 'Objekt erwartet');
  for (const k of pflicht) if (!(k in o)) werfe(`${wo}.${k}`, 'fehlt');
  for (const k of Object.keys(o)) if (!pflicht.includes(k) && !optional.includes(k)) werfe(`${wo}.${k}`, 'unbekanntes Feld');
  return o;
}
const zahlIn = (x: unknown, wo: string, min: number, max: number, istGanz = false): number => {
  if (!zahl(x) || x < min || x > max || (istGanz && !ganz(x))) werfe(wo, `${istGanz ? 'ganze ' : ''}Zahl ${min}..${max} erwartet`);
  return x as number;
};
const boolean = (x: unknown, wo: string): boolean => (typeof x === 'boolean' ? x : werfe(wo, 'true/false erwartet'));
const text = (x: unknown, wo: string, max: number): string => (
  typeof x === 'string' && x.length >= 1 && x.length <= max ? x : werfe(wo, `Text 1..${max} Zeichen erwartet`));

export function beatsPruefung(x: unknown): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(x)) return ab('argument_ungueltig', 'warp.beats: Objekt erwartet');
  for (const k of Object.keys(x)) if (!['raster', 'loop', 'huelle'].includes(k)) return ab('argument_unbekannt', `warp.beats.${k}`);
  if (!(BEATS_RASTER as readonly unknown[]).includes(x.raster)) return ab('argument_ungueltig', `warp.beats.raster: ${BEATS_RASTER.join(' | ')} erwartet`);
  if (!(BEATS_LOOP as readonly unknown[]).includes(x.loop)) return ab('argument_ungueltig', `warp.beats.loop: ${BEATS_LOOP.join(' | ')} erwartet`);
  if (!ganz(x.huelle) || x.huelle < 0 || x.huelle > 100) return ab('argument_ungueltig', 'warp.beats.huelle: ganze Zahl 0..100 erwartet');
  return null;
}

// Prüfung eines Warp-Objekts (Modell und Befehle teilen sie): null = gültig, sonst Grund (der Befehls-Grund) und Text.
export function warpPruefung(w: unknown): { grund: string; text: string } | null {
  const ab = (grund: string, text: string) => ({ grund, text });
  if (!istObjekt(w)) return ab('argument_ungueltig', 'warp: Objekt erwartet');
  const pflicht = ['an', 'modus', 'marker', 'versatz_beats', 'quelle', 'transpose_st', 'detune_ct'];
  for (const k of Object.keys(w)) if (!pflicht.includes(k) && k !== 'eins_unsicher' && k !== 'beats') return ab('argument_unbekannt', `warp.${k}`);
  for (const k of pflicht) if (!(k in w)) return ab('argument_ungueltig', `warp.${k}: fehlt`);
  if (typeof w.an !== 'boolean') return ab('argument_ungueltig', 'warp.an: true oder false erwartet');
  if ('eins_unsicher' in w && typeof w.eins_unsicher !== 'boolean') {
    return ab('argument_ungueltig', 'warp.eins_unsicher: true oder false erwartet');
  }
  if ('beats' in w) { const f = beatsPruefung(w.beats); if (f) return f; }
  if (!(WARP_MODI as readonly unknown[]).includes(w.modus)) return ab('warp_modus', `warp.modus: ${WARP_MODI.join(' | ')} erwartet`);
  if (!(WARP_QUELLEN as readonly unknown[]).includes(w.quelle)) {
    return ab('argument_ungueltig', `warp.quelle: ${WARP_QUELLEN.join(' | ')} erwartet`);
  }
  if (!zahl(w.versatz_beats) || Math.abs(w.versatz_beats) > MAX_BEAT) {
    return ab('argument_ungueltig', `warp.versatz_beats: Zahl von −${MAX_BEAT} bis ${MAX_BEAT} erwartet`);
  }
  if (!ganz(w.transpose_st) || w.transpose_st < TRANSPOSE_MIN || w.transpose_st > TRANSPOSE_MAX) {
    return ab('argument_ungueltig', `warp.transpose_st: ganze Zahl ${TRANSPOSE_MIN}..${TRANSPOSE_MAX} erwartet`);
  }
  if (!zahl(w.detune_ct) || Math.abs(w.detune_ct) > DETUNE_MAX) {
    return ab('argument_ungueltig', `warp.detune_ct: Zahl ${-DETUNE_MAX}..${DETUNE_MAX} erwartet`);
  }
  if ((w.modus === 'repitch' || w.modus === 'beats') && (w.transpose_st !== 0 || w.detune_ct !== 0)) {   // D6b: BEATS wie RE-PITCH
    return ab('transpose_repitch', 'RE-PITCH und BEATS folgen dem Tempo; Transpose und Detune gibt es dort nicht');
  }
  const gesamt = w.transpose_st * 100 + w.detune_ct;
  if (gesamt < GESAMT_CT_MIN || gesamt > GESAMT_CT_MAX) {
    return ab('argument_ungueltig', `warp: transpose_st · 100 + detune_ct ${GESAMT_CT_MIN}..${GESAMT_CT_MAX} Cent`);
  }
  const m = w.marker;
  if (!Array.isArray(m) || m.length < 2 || m.length > MAX_MARKER) return ab('warp_marker', `warp.marker: 2 bis ${MAX_MARKER} Marker erwartet`);
  for (let i = 0; i < m.length; i++) {
    const p = m[i];
    if (!Array.isArray(p) || p.length !== 2 || !zahl(p[0]) || !zahl(p[1])) return ab('warp_marker', `warp.marker[${i}]: [quell_s, beat] erwartet`);
    if (p[0] < 0 || p[0] > 1e7) return ab('warp_marker', `warp.marker[${i}]: quell_s 0..1e7 erwartet`);
    if (Math.abs(p[1]) > MAX_BEAT) return ab('warp_marker', `warp.marker[${i}]: beat von −${MAX_BEAT} bis ${MAX_BEAT} erwartet`);
    if (i > 0 && !(p[0] > m[i - 1][0] && p[1] > m[i - 1][1])) {
      return ab('warp_marker', `warp.marker[${i}]: quell_s und beat müssen streng steigen`);
    }
    // so sieht sie der Kern (Frames = quell_s · 48 000, Beat minus Versatz): zwei Doubles, die danach gleich sind, lehnt er mit format ab
    if (i > 0 && !(p[0] * SAMPLERATE > m[i - 1][0] * SAMPLERATE && p[1] - w.versatz_beats > m[i - 1][1] - w.versatz_beats)) {
      return ab('warp_marker', `warp.marker[${i}]: nach der Umrechnung (Frames, Beat minus Versatz) nicht mehr streng steigend`);
    }
  }
  for (let i = 0; i + 1 < m.length; i++) {
    const bpm = 60 * (m[i + 1][1] - m[i][1]) / (m[i + 1][0] - m[i][0]);
    if (!(bpm >= SEGMENT_BPM_MIN && bpm <= SEGMENT_BPM_MAX)) {
      return ab('warp_faktor', `warp.marker[${i}]: Segment-Tempo ${Math.round(bpm * 100) / 100} BPM, erlaubt ${SEGMENT_BPM_MIN}..${SEGMENT_BPM_MAX}`);
    }
  }
  return null;
}

function pruefeNote(n: unknown, wo: string): Note {
  const o = felder(n, wo, ['id', 'beat', 'laenge', 'ton', 'vel']);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.beat, `${wo}.beat`, 0, MAX_BEAT);
  if (!zahl(o.laenge) || o.laenge <= 0 || o.laenge > MAX_BEAT) werfe(`${wo}.laenge`, 'Zahl > 0 erwartet');
  zahlIn(o.ton, `${wo}.ton`, 0, 127, true); zahlIn(o.vel, `${wo}.vel`, 1, 127, true);
  return o as unknown as Note;
}

function pruefeGeraet(g: unknown, wo: string): Geraet {
  if (!istObjekt(g)) return werfe(wo, 'Objekt erwartet');
  if (g.art === 'intern') {
    const o = felder(g, wo, ['art', 'name', 'parameter']);
    if (o.name !== 'rb338') werfe(`${wo}.name`, 'rb338 erwartet');
    if (!istObjekt(o.parameter)) werfe(`${wo}.parameter`, 'Objekt erwartet');
    for (const [k, v] of Object.entries(o.parameter as Record<string, unknown>)) {
      if (!RB_PARAMETER.includes(k)) werfe(`${wo}.parameter.${k}`, `unbekannter Parameter (erlaubt: ${RB_PARAMETER.join(', ')})`);
      zahlIn(v, `${wo}.parameter.${k}`, 0, 1);
    }
    return o as unknown as Geraet;
  }
  if (g.art === 'wirt') {
    const o = felder(g, wo, ['art', 'name', 'slot']);
    if (o.name !== 'surge') werfe(`${wo}.name`, 'surge erwartet');
    zahlIn(o.slot, `${wo}.slot`, 1, WIRT_SLOTS, true);
    return o as unknown as Geraet;
  }
  return werfe(`${wo}.art`, 'intern oder wirt erwartet');
}

function pruefeFreeze(f: unknown, wo: string): void {
  const o = felder(f, wo, ['datei', 'frames', 'kennung', 'sha256'], ['von_beat']);
  if (typeof o.datei !== 'string' || !o.datei || o.datei.startsWith('/') || o.datei.split('/').includes('..')) {
    werfe(`${wo}.datei`, 'relativer Pfad im Arbeitsordner erwartet');
  }
  zahlIn(o.frames, `${wo}.frames`, 1, 2 ** 40, true);
  zahlIn(o.kennung, `${wo}.kennung`, 0, KENNUNG_MAX, true);
  if (typeof o.sha256 !== 'string' || !SHA.test(o.sha256)) werfe(`${wo}.sha256`, '64 Hex-Zeichen (klein) erwartet');
  if ('von_beat' in o) zahlIn(o.von_beat, `${wo}.von_beat`, 0, MAX_BEAT);
}

function pruefeLoop(o: Record<string, unknown>, wo: string): void {
  if (!('loop_beats' in o) || o.loop_beats === null) return;
  if (!zahl(o.loop_beats) || o.loop_beats < LOOP_MIN || o.loop_beats > (o.laenge_beats as number) + 1e-9) {
    werfe(`${wo}.loop_beats`, 'null oder Zahl von 1/16 bis laenge_beats erwartet');
  }
}

function pruefeClip(c: unknown, wo: string, spurArt: string, warpErlaubt: boolean): Clip {
  if (!istObjekt(c)) return werfe(wo, 'Objekt erwartet');
  if (c.art !== (spurArt === 'audio' ? 'audio' : 'midi')) werfe(`${wo}.art`, `passt nicht zur ${spurArt}-Spur`);
  const basis = ['id', 'art', 'name', 'start_beat', 'laenge_beats'];
  if (c.art === 'audio') {
    const o = felder(c, wo, [...basis, 'quelle', 'dekodiert', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats'], ['loop_beats', 'warp', 'stumm']);
    if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
    text(o.name, `${wo}.name`, 80);
    zahlIn(o.start_beat, `${wo}.start_beat`, 0, MAX_BEAT);
    if (!zahl(o.laenge_beats) || o.laenge_beats <= 0 || o.laenge_beats > MAX_BEAT) werfe(`${wo}.laenge_beats`, 'Zahl > 0 erwartet');
    const q = felder(o.quelle, `${wo}.quelle`, ['sha256', 'pfad_hinweis']);
    if (typeof q.sha256 !== 'string' || !SHA.test(q.sha256)) werfe(`${wo}.quelle.sha256`, '64 Hex-Zeichen (klein) erwartet');
    if (typeof q.pfad_hinweis !== 'string' || q.pfad_hinweis.length > 4096) werfe(`${wo}.quelle.pfad_hinweis`, 'Text erwartet');
    if (!DEKODIERT.includes(o.dekodiert as DekodiertZustand)) werfe(`${wo}.dekodiert`, `${DEKODIERT.join('|')} erwartet`);
    zahlIn(o.offset_s, `${wo}.offset_s`, 0, 1e7); zahlIn(o.gain_db, `${wo}.gain_db`, GAIN_MIN, GAIN_MAX);
    const ein = zahlIn(o.fade_ein_beats, `${wo}.fade_ein_beats`, 0, MAX_BEAT), aus = zahlIn(o.fade_aus_beats, `${wo}.fade_aus_beats`, 0, MAX_BEAT);
    if (ein + aus > (o.laenge_beats as number) + 1e-9) werfe(`${wo}.fade`, 'Ein- plus Ausblende länger als der Clip');
    pruefeLoop(o, wo);
    if (o.stumm !== undefined && typeof o.stumm !== 'boolean') werfe(`${wo}.stumm`, 'true oder false erwartet');
    if ('warp' in o) {                                          // in /1 ist jedes warp-Feld unbekannt, auch null (N4-6)
      if (!warpErlaubt) werfe(`${wo}.warp`, `unbekanntes Feld (Warp gibt es erst ab ${FORMAT})`);
      const f = o.warp === null ? null : warpPruefung(o.warp);
      if (f) werfe(`${wo}.warp`, f.text);
    }
    return o as unknown as Clip;
  }
  const o = felder(c, wo, [...basis, 'noten'], ['loop_beats', 'naechste_noten_id']);
  if ('naechste_noten_id' in o) zahlIn(o.naechste_noten_id, `${wo}.naechste_noten_id`, 1, Number.MAX_SAFE_INTEGER, true);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  text(o.name, `${wo}.name`, 80);
  zahlIn(o.start_beat, `${wo}.start_beat`, 0, MAX_BEAT);
  if (!zahl(o.laenge_beats) || o.laenge_beats <= 0 || o.laenge_beats > MAX_BEAT) werfe(`${wo}.laenge_beats`, 'Zahl > 0 erwartet');
  pruefeLoop(o, wo);
  if (!Array.isArray(o.noten)) werfe(`${wo}.noten`, 'Liste erwartet');
  const ids = new Set<string>();
  (o.noten as unknown[]).forEach((n, i) => {
    const note = pruefeNote(n, `${wo}.noten[${i}]`);
    if (ids.has(note.id)) werfe(`${wo}.noten[${i}].id`, `doppelt (${note.id})`);
    ids.add(note.id);
  });
  return o as unknown as MidiClip;
}

function pruefeSpur(s: unknown, wo: string, warpErlaubt: boolean): Spur {
  if (!istObjekt(s)) return werfe(wo, 'Objekt erwartet');
  const basis = ['id', 'nr', 'name', 'farbe', 'art', 'fader_db', 'pan', 'mute', 'solo', 'clips'];
  if (s.art !== 'audio' && s.art !== 'instrument') werfe(`${wo}.art`, 'audio oder instrument erwartet');
  const o = s.art === 'audio' ? felder(s, wo, basis, ['von', 'gruppe', 'aufnahme', 'ausgang'])
    : felder(s, wo, [...basis, 'geraet'], ['freeze', 'von', 'gruppe', 'ausgang']);
  if ('von' in o && o.von !== 'andreas' && o.von !== 'cypher') werfe(`${wo}.von`, 'andreas oder cypher erwartet');
  // ohne Leerzeichen am Rand, wie die Befehle (Review S2)
  if ('gruppe' in o && text(o.gruppe, `${wo}.gruppe`, GRUPPE_MAX).trim() !== o.gruppe) werfe(`${wo}.gruppe`, 'ohne Leerzeichen am Rand erwartet');
  if ('aufnahme' in o) {
    const a = felder(o.aufnahme, `${wo}.aufnahme`, ['scharf', 'eingang']);
    boolean(a.scharf, `${wo}.aufnahme.scharf`);
    if (a.eingang !== null) {
      const e = felder(a.eingang, `${wo}.aufnahme.eingang`, ['art', 'name']);
      if (e.art !== 'intern' || !(INTERNE_EINGAENGE as readonly unknown[]).includes(e.name)) {
        werfe(`${wo}.aufnahme.eingang`, 'intern erz/1 bis erz/3 oder null erwartet');
      }
    }
    if (a.scharf === true && a.eingang === null) werfe(`${wo}.aufnahme.scharf`, 'scharf braucht einen Eingang');
  }
  if ('ausgang' in o) {   // 1.10: master steht nie in der Datei
    const au = felder(o.ausgang, `${wo}.ausgang`, ['art', 'id']);
    if (au.art !== 'gruppe') werfe(`${wo}.ausgang.art`, 'gruppe erwartet (master steht nie in der Datei)');
    if (typeof au.id !== 'string' || !ID.test(au.id)) werfe(`${wo}.ausgang.id`, 'ID erwartet');
  }
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.nr, `${wo}.nr`, 1, MAX_SPUREN, true);
  text(o.name, `${wo}.name`, 80);
  if (typeof o.farbe !== 'string' || !FARBE.test(o.farbe)) werfe(`${wo}.farbe`, '#rrggbb erwartet');
  zahlIn(o.fader_db, `${wo}.fader_db`, FADER_MIN, FADER_MAX); zahlIn(o.pan, `${wo}.pan`, -1, 1);
  boolean(o.mute, `${wo}.mute`); boolean(o.solo, `${wo}.solo`);
  if (o.art === 'instrument') {
    const g = pruefeGeraet(o.geraet, `${wo}.geraet`);
    if (g.art === 'wirt') {
      if (!('freeze' in o)) werfe(`${wo}.freeze`, 'fehlt (null oder Objekt)');
      if (o.freeze !== null) pruefeFreeze(o.freeze, `${wo}.freeze`);
    } else if ('freeze' in o) werfe(`${wo}.freeze`, 'nur bei Wirt-Geräten');
  }
  if (!Array.isArray(o.clips)) werfe(`${wo}.clips`, 'Liste erwartet');
  (o.clips as unknown[]).forEach((c, i) => pruefeClip(c, `${wo}.clips[${i}]`, o.art as string, warpErlaubt));
  return o as unknown as Spur;
}

function pruefeGruppe(g: unknown, wo: string): Gruppe {
  const o = felder(g, wo, ['id', 'nr', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet']);
  if (typeof o.id !== 'string' || !ID.test(o.id)) werfe(`${wo}.id`, 'ID erwartet');
  zahlIn(o.nr, `${wo}.nr`, 1, MAX_GRUPPEN, true);
  text(o.name, `${wo}.name`, 80);
  if (typeof o.farbe !== 'string' || !FARBE.test(o.farbe)) werfe(`${wo}.farbe`, '#rrggbb erwartet');
  zahlIn(o.fader_db, `${wo}.fader_db`, FADER_MIN, FADER_MAX); zahlIn(o.pan, `${wo}.pan`, -1, 1);
  boolean(o.mute, `${wo}.mute`); boolean(o.solo, `${wo}.solo`); boolean(o.gefaltet, `${wo}.gefaltet`);
  return o as unknown as Gruppe;
}

// Prüft ohne Kopie: null = gültig, sonst der Fehlertext. Der Befehlsweg braucht nur das Urteil (kein structuredClone des ganzen Projekts).
export function pruefeFehler(x: unknown): string | null {
  try {
    pruefeAlles(x);
    return null;
  } catch (e) {
    if (e instanceof Fehl) return e.message;
    throw e;
  }
}

export function pruefeProjekt(x: unknown): { projekt: Projekt } | { fehler: string } {
  const fehler = pruefeFehler(x);
  if (fehler !== null) return { fehler };
  const p = structuredClone(x) as Projekt;
  // 1.10 (P3): /1 → /2, kein rev-Schritt. Paket 1.13: ein /1-Projekt hat keinen Warp (die Prüfung lehnt ihn dort ab), die Hebung setzt keinen
  if ((p as { format: string }).format === FORMAT_ALT) { p.format = FORMAT; p.gruppen = []; p.master = { fader_db: 0 }; }
  for (const s of p.spuren) s.von = herkunft(s);                                     // Spec 6.22: fehlt von (älteres Projekt), gilt andreas
  uebernimmNotenZaehler(p);                                                          // Spec 6.28: alte Clip-Zähler ins Projekt
  setzeFehlendeZaehler(p);                                                           // Spec 6.35: fehlende Zähler schon beim Öffnen
  return { projekt: p };
}

function pruefeAlles(x: unknown): void {
  // Format zuerst (Prüfung 2, C1): ein fremdes Format, auch eines mit gruppen und master, ist der Fehler „format“
  // und scheitert nicht an „unbekanntes Feld“.
  // Ein fehlendes Format bleibt Sache von `felder` („projekt.format: fehlt“).
  if (istObjekt(x) && 'format' in x && x.format !== FORMAT && x.format !== FORMAT_ALT) werfe('format', `${FORMAT} oder ${FORMAT_ALT} erwartet`);
  const neu2 = istObjekt(x) && x.format === FORMAT;   // /2 verlangt gruppen und master, /1 hat sie nicht
  const pflicht = ['format', 'name', 'rev', 'wiedergabe_rev', 'tempo_bpm', 'taktart', 'loop', 'metronom', 'spuren', ...(neu2 ? ['gruppen', 'master'] : [])];
  const o = felder(x, 'projekt', pflicht, ['naechste_id', 'naechste_noten_id']);
  if ('naechste_noten_id' in o) zahlIn(o.naechste_noten_id, 'naechste_noten_id', 1, Number.MAX_SAFE_INTEGER, true);
  if ('naechste_id' in o) {
    const z = felder(o.naechste_id, 'naechste_id', [], ['spur', 'clip', 'gruppe']);
    for (const k of ['spur', 'clip', 'gruppe']) if (k in z) zahlIn(z[k], `naechste_id.${k}`, 1, Number.MAX_SAFE_INTEGER, true);
  }
  text(o.name, 'name', 80);
  zahlIn(o.rev, 'rev', 0, Number.MAX_SAFE_INTEGER, true); zahlIn(o.wiedergabe_rev, 'wiedergabe_rev', 0, Number.MAX_SAFE_INTEGER, true);
  zahlIn(o.tempo_bpm, 'tempo_bpm', TEMPO_MIN, TEMPO_MAX);
  if (!Array.isArray(o.taktart) || o.taktart.length !== 2 || o.taktart[0] !== 4 || o.taktart[1] !== 4) werfe('taktart', 'nur [4,4] (Spec 2.7)');
  const l = felder(o.loop, 'loop', ['an', 'von_beat', 'bis_beat']);
  boolean(l.an, 'loop.an'); zahlIn(l.von_beat, 'loop.von_beat', 0, MAX_BEAT); zahlIn(l.bis_beat, 'loop.bis_beat', 0, MAX_BEAT);
  if ((l.bis_beat as number) - (l.von_beat as number) < 1) werfe('loop', 'bis_beat − von_beat muss mindestens 1 sein');
  const m = felder(o.metronom, 'metronom', ['an', 'pegel_db', 'ziel']);
  boolean(m.an, 'metronom.an'); zahlIn(m.pegel_db, 'metronom.pegel_db', -60, 0);
  if (m.ziel !== 'master' && m.ziel !== 'cue') werfe('metronom.ziel', 'master oder cue erwartet');
  if (!Array.isArray(o.spuren)) werfe('spuren', 'Liste erwartet');
  if ((o.spuren as unknown[]).length > MAX_SPUREN) werfe('spuren', `höchstens ${MAX_SPUREN}`);
  const refs: [number, string][] = [];
  const spurIds = new Set<string>(), nrs = new Set<number>(), clipIds = new Set<string>(), slots = new Set<number>();
  let clips = 0, noten = 0;
  (o.spuren as unknown[]).forEach((sx, i) => {
    const s = pruefeSpur(sx, `spuren[${i}]`, neu2);   // Paket 1.13: warp nur in /2
    if (!neu2 && s.ausgang) werfe(`spuren[${i}].ausgang`, 'gibt es erst in /2');
    if (s.ausgang) refs.push([i, s.ausgang.id]);
    if (spurIds.has(s.id)) werfe(`spuren[${i}].id`, `doppelt (${s.id})`);
    if (nrs.has(s.nr)) werfe(`spuren[${i}].nr`, `doppelt (${s.nr})`);
    spurIds.add(s.id); nrs.add(s.nr);
    if (s.geraet?.art === 'wirt') { if (slots.has(s.geraet.slot)) werfe(`spuren[${i}].geraet.slot`, `doppelt (${s.geraet.slot})`); slots.add(s.geraet.slot); }
    s.clips.forEach((c, k) => {
      if (clipIds.has(c.id)) werfe(`spuren[${i}].clips[${k}].id`, `doppelt (${c.id})`);
      clipIds.add(c.id); clips++; if (c.art === 'midi') noten += c.noten.length;
    });
  });
  const gruppenIds = new Set<string>(), gruppenNrs = new Set<number>();
  if (neu2) {
    if (!Array.isArray(o.gruppen)) werfe('gruppen', 'Liste erwartet');
    if ((o.gruppen as unknown[]).length > MAX_GRUPPEN) werfe('gruppen', `höchstens ${MAX_GRUPPEN}`);
    (o.gruppen as unknown[]).forEach((gx, i) => {
      const g = pruefeGruppe(gx, `gruppen[${i}]`);
      if (gruppenIds.has(g.id)) werfe(`gruppen[${i}].id`, `doppelt (${g.id})`);
      if (gruppenNrs.has(g.nr)) werfe(`gruppen[${i}].nr`, `doppelt (${g.nr})`);
      gruppenIds.add(g.id); gruppenNrs.add(g.nr);
    });
    const ms = felder(o.master, 'master', ['fader_db']);
    zahlIn(ms.fader_db, 'master.fader_db', FADER_MIN, FADER_MAX);
  }
  for (const [i, id] of refs) if (!gruppenIds.has(id)) werfe(`spuren[${i}].ausgang.id`, `unbekannte Gruppe ${id}`);
  if (clips > MAX_CLIPS) werfe('spuren', `höchstens ${MAX_CLIPS} Clips`);
  if (noten > MAX_NOTEN) werfe('noten', `höchstens ${MAX_NOTEN} Noten`);
}

// --- Wiedergabe-Sicht -----------------------------------------------------------------------------------------------
// Alles, was den Klang des Kerns bestimmt, und nichts sonst. Zwei Stände mit gleicher Sicht brauchen keine neue Wiedergabe
// (Mixer, Namen, Farben, Tempo, Loop und Metronom laufen über eigene Wege); `betrifft_wiedergabe` der Befehle und das Verwerfen
// eines Freeze beruhen darauf.
export function spurSicht(s: Spur, mitFreeze = true): unknown {
  return {
    nr: s.nr, art: s.art, geraet: s.geraet ?? null, ...(mitFreeze ? { freeze: s.freeze ?? null } : {}),
    // 1.10: das Ziel gehört zur Wiedergabe, nicht zum Freeze (ein Ziel-Wechsel verwirft keinen Freeze)
    ...(mitFreeze && s.ausgang ? { ausgang: s.ausgang.id } : {}),
    clips: s.clips.map((c) => (c.art === 'audio'
      ? { id: c.id, art: c.art, sha256: c.quelle.sha256, dekodiert: c.dekodiert, start_beat: c.start_beat, laenge_beats: c.laenge_beats,
        loop_beats: c.loop_beats ?? null, offset_s: c.offset_s, gain_db: c.gain_db, fade_ein_beats: c.fade_ein_beats, fade_aus_beats: c.fade_aus_beats,
        warp: c.warp?.an ? c.warp : null, ...(c.stumm ? { stumm: true } : {}) }   // Paket 1.13: ein Warp an ändert den Klang, ein Warp aus nicht
      : { id: c.id, art: c.art, start_beat: c.start_beat, laenge_beats: c.laenge_beats, loop_beats: c.loop_beats ?? null, noten: c.noten })),
  };
}
export const wiedergabeSicht = (p: Projekt): unknown => ({
  spuren: [...p.spuren].sort((a, b) => a.nr - b.nr).map((s) => spurSicht(s)),
  // 1.10: die Topologie nur, wenn es welche gibt (neutral: wie vorher)
  ...((p.gruppen ?? []).length ? { gruppen: [...p.gruppen].sort((a, b) => a.nr - b.nr).map((g) => ({ id: g.id, nr: g.nr })) } : {}),
});
