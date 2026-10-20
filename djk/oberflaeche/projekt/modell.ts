// Projektmodell D1 (Spec docs/masterplan/D1-SPEC.md 3.3): project.json im Format cypherdj-projekt/1. Typen, Prüfung, Erzeugung, IDs.
// Reine Funktionen, keine Datei, kein Server. Die Prüfung ist geschlossen: ein unbekanntes Feld ist ein Fehler (Tippfehler sollen
// auffallen, die Version 1 des Formats ist festgelegt; Erweiterungen bekommen /2).
export const FORMAT = 'cypherdj-projekt/1';
export const MAX_SPUREN = 8;
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
export const SPUR_FARBEN = ['#e0563b', '#3b8de0', '#9b59d0', '#3bb07a', '#e0a83b', '#d03b8d', '#3bc7d0', '#8a8f98'];

export type DekodiertZustand = 'nein' | 'laeuft' | 'fertig' | 'fehler';
export const DEKODIERT: readonly DekodiertZustand[] = ['nein', 'laeuft', 'fertig', 'fehler'];

export interface Note { id: string; beat: number; laenge: number; ton: number; vel: number }
// loop_beats (Spec 6.17): null oder fehlend = kein Loop; sonst wiederholt sich [0, loop_beats) bis laenge_beats (1/16 ≤ loop_beats ≤ laenge_beats)
export interface AudioClip {
  id: string; art: 'audio'; name: string; start_beat: number; laenge_beats: number; loop_beats?: number | null;
  quelle: { sha256: string; pfad_hinweis: string }; dekodiert: DekodiertZustand;
  offset_s: number; gain_db: number; fade_ein_beats: number; fade_aus_beats: number;
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
export interface Spur {
  id: string; von?: Herkunft; gruppe?: string; nr: number; name: string; farbe: string; art: 'audio' | 'instrument';
  geraet?: Geraet; freeze?: Freeze | null;
  fader_db: number; pan: number; mute: boolean; solo: boolean; clips: Clip[];
}
// naechste_id (Spec 6.26): Zähler je Art (spur, clip); naechste_noten_id (Spec 6.28 Nachsatz zu 6.26): EIN Noten-Zähler für alle Clips.
// Alle steigen nur und stehen in keinem Patch, Undo und Redo setzen sie nicht zurück.
export interface Projekt {
  format: typeof FORMAT; name: string; rev: number; wiedergabe_rev: number; tempo_bpm: number; taktart: [number, number];
  naechste_id?: { spur?: number; clip?: number }; naechste_noten_id?: number;
  loop: { an: boolean; von_beat: number; bis_beat: number };
  metronom: { an: boolean; pegel_db: number; ziel: 'master' | 'cue' };
  spuren: Spur[];
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
    spuren: [], naechste_id: { spur: 1, clip: 1 }, naechste_noten_id: 1,    // Spec 6.26, 6.35: ein neues Projekt führt seine Zähler von Anfang an
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
export function neueId(p: Projekt, art: 'spur' | 'clip'): string {
  const praefix = art === 'spur' ? 's' : 'c';
  const lebend = hoechste(art === 'spur' ? p.spuren.map((s) => s.id) : p.spuren.flatMap((s) => s.clips.map((c) => c.id)), praefix);
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
  };
  if (p.naechste_noten_id === undefined) p.naechste_noten_id = notenZaehler(p);
}

export function sucheSpur(p: Projekt, id: string): Spur | undefined { return p.spuren.find((s) => s.id === id); }
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

function pruefeClip(c: unknown, wo: string, spurArt: string): Clip {
  if (!istObjekt(c)) return werfe(wo, 'Objekt erwartet');
  if (c.art !== (spurArt === 'audio' ? 'audio' : 'midi')) werfe(`${wo}.art`, `passt nicht zur ${spurArt}-Spur`);
  const basis = ['id', 'art', 'name', 'start_beat', 'laenge_beats'];
  if (c.art === 'audio') {
    const o = felder(c, wo, [...basis, 'quelle', 'dekodiert', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats'], ['loop_beats']);
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

function pruefeSpur(s: unknown, wo: string): Spur {
  if (!istObjekt(s)) return werfe(wo, 'Objekt erwartet');
  const basis = ['id', 'nr', 'name', 'farbe', 'art', 'fader_db', 'pan', 'mute', 'solo', 'clips'];
  if (s.art !== 'audio' && s.art !== 'instrument') werfe(`${wo}.art`, 'audio oder instrument erwartet');
  const o = s.art === 'audio' ? felder(s, wo, basis, ['von', 'gruppe']) : felder(s, wo, [...basis, 'geraet'], ['freeze', 'von', 'gruppe']);
  if ('von' in o && o.von !== 'andreas' && o.von !== 'cypher') werfe(`${wo}.von`, 'andreas oder cypher erwartet');
  // ohne Leerzeichen am Rand, wie die Befehle (Review S2)
  if ('gruppe' in o && text(o.gruppe, `${wo}.gruppe`, GRUPPE_MAX).trim() !== o.gruppe) werfe(`${wo}.gruppe`, 'ohne Leerzeichen am Rand erwartet');
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
  (o.clips as unknown[]).forEach((c, i) => pruefeClip(c, `${wo}.clips[${i}]`, o.art as string));
  return o as unknown as Spur;
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
  for (const s of p.spuren) s.von = herkunft(s);                                     // Spec 6.22: fehlt von (älteres Projekt), gilt andreas
  uebernimmNotenZaehler(p);                                                          // Spec 6.28: alte Clip-Zähler ins Projekt
  setzeFehlendeZaehler(p);                                                           // Spec 6.35: fehlende Zähler schon beim Öffnen
  return { projekt: p };
}

function pruefeAlles(x: unknown): void {
  const o = felder(x, 'projekt', ['format', 'name', 'rev', 'wiedergabe_rev', 'tempo_bpm', 'taktart', 'loop', 'metronom', 'spuren'],
    ['naechste_id', 'naechste_noten_id']);
  if ('naechste_noten_id' in o) zahlIn(o.naechste_noten_id, 'naechste_noten_id', 1, Number.MAX_SAFE_INTEGER, true);
  if ('naechste_id' in o) {
    const z = felder(o.naechste_id, 'naechste_id', [], ['spur', 'clip']);
    for (const k of ['spur', 'clip']) if (k in z) zahlIn(z[k], `naechste_id.${k}`, 1, Number.MAX_SAFE_INTEGER, true);
  }
  if (o.format !== FORMAT) werfe('format', `${FORMAT} erwartet`);
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
  const spurIds = new Set<string>(), nrs = new Set<number>(), clipIds = new Set<string>(), slots = new Set<number>();
  let clips = 0, noten = 0;
  (o.spuren as unknown[]).forEach((sx, i) => {
    const s = pruefeSpur(sx, `spuren[${i}]`);
    if (spurIds.has(s.id)) werfe(`spuren[${i}].id`, `doppelt (${s.id})`);
    if (nrs.has(s.nr)) werfe(`spuren[${i}].nr`, `doppelt (${s.nr})`);
    spurIds.add(s.id); nrs.add(s.nr);
    if (s.geraet?.art === 'wirt') { if (slots.has(s.geraet.slot)) werfe(`spuren[${i}].geraet.slot`, `doppelt (${s.geraet.slot})`); slots.add(s.geraet.slot); }
    s.clips.forEach((c, k) => {
      if (clipIds.has(c.id)) werfe(`spuren[${i}].clips[${k}].id`, `doppelt (${c.id})`);
      clipIds.add(c.id); clips++; if (c.art === 'midi') noten += c.noten.length;
    });
  });
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
    clips: s.clips.map((c) => (c.art === 'audio'
      ? { id: c.id, art: c.art, sha256: c.quelle.sha256, dekodiert: c.dekodiert, start_beat: c.start_beat, laenge_beats: c.laenge_beats,
        loop_beats: c.loop_beats ?? null, offset_s: c.offset_s, gain_db: c.gain_db, fade_ein_beats: c.fade_ein_beats, fade_aus_beats: c.fade_aus_beats }
      : { id: c.id, art: c.art, start_beat: c.start_beat, laenge_beats: c.laenge_beats, loop_beats: c.loop_beats ?? null, noten: c.noten })),
  };
}
export const wiedergabeSicht = (p: Projekt): unknown => ({ spuren: [...p.spuren].sort((a, b) => a.nr - b.nr).map((s) => spurSicht(s)) });
