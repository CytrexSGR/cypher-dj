// MIDI import planner (docs/superpowers/specs/2026-11-10-midi-import.md): a parsed Standard MIDI File plus the open project in, a plan out.
// The plan is a list of EXISTING project commands (tempo_setzen, spur_neu, spur_aendern, clip_neu) and a report. The server runs the list through the
// normal command path (/proj/aendern logic), so validation, limits, the history (ONE undo step) and the playback swap are the ones every change has.
// Pure: no file, no server, no core. What the environment knows (which kit and which Baukasten graphs exist) comes in through `ctx`.
import { GM_PROGRAMME, gmProgrammName, type SmfDatei, type SmfTeil } from './smf.ts';
import {
  MAX_BEAT, MAX_BK_SPUREN, MAX_CLIPS, MAX_NOTEN, MAX_SPUREN, TEMPO_MAX, TEMPO_MIN, neueId, type Projekt,
} from './model.ts';

export class MidiImportFehler extends Error {
  grund: string; code: number; extra: Record<string, unknown>;
  constructor(code: number, grund: string, text: string, extra: Record<string, unknown> = {}) {
    super(text); this.name = 'MidiImportFehler'; this.grund = grund; this.code = code; this.extra = extra;
  }
}

export type GeraetWunsch = string | { [k: string]: unknown } | null;
export interface ImportEingabe {
  auswahl?: string[];                                  // part keys "<track>.<channel 1..16>" (as the preview lists them); absent = every part with notes
  // part key -> device ('rb338' | 'kit:<name>' | 'bk:<graph>' | 'surge[:1|2]' | a geraet object | null = no sound)
  zuordnung?: Record<string, GeraetWunsch>;
  tempo?: 'auto' | 'uebernehmen' | 'behalten';         // auto: take the file's first tempo when the project holds no track yet
  profil?: 'einfach' | 'poly';                         // einfach: every melodic part on the RB-338; poly: chord parts on Baukasten graphs (up to 8)
}
export interface ImportKontext {
  gmKit: { name: string; noten: Set<number> } | null;  // the kit channel-10 parts play (null = none can be built)
  graphArt?: (name: string) => 'instrument' | 'effekt' | null;
  kitDa?: (name: string) => boolean;
}
export interface BerichtHinweis { code: string; text: string }
export interface BerichtSpur {
  schluessel: string; name: string; spur: number; kanal: number; programm: number | null; programm_name: string | null; schlagzeug: boolean;
  noten: number; von_beat: number; bis_beat: number; polyphonie: number;
  geraet: Record<string, unknown> | null;              // null = no sound (the track is created muted on the default device)
  geraet_text: string; stumm: boolean; hinweise: BerichtHinweis[];
}
export interface ImportBericht {
  datei: {
    format: 0 | 1; ticks_pro_viertel: number; midi_spuren: number; spuren_mit_noten: number; noten: number; laenge_beats: number; dauer_s: number | null;
  };
  tempo: { quelle_bpm: number | null; gesetzt_bpm: number | null; aenderungen: number; aenderungen_liste: { beat: number; bpm: number }[] };
  taktart: { quelle: [number, number] | null; projekt: [number, number]; abweichend: boolean; wechsel: number };
  spuren: BerichtSpur[];
  nicht_angelegt: { schluessel: string; grund: string }[];
  summe: { spuren: number; clips: number; noten: number; ohne_klang: number };
  ignoriert: SmfDatei['ignoriert'];
  hinweise: BerichtHinweis[];
  anlegbar: boolean; grund?: string; grund_text?: string;
}
export interface ImportPlan { befehle: unknown[]; bericht: ImportBericht }

export const teilSchluessel = (t: SmfTeil): string => `${t.spur}.${t.kanal + 1}`;
const runde = (x: number, stellen: number): number => Math.round(x * 10 ** stellen) / 10 ** stellen;

/** start level of a track on a Baukasten instrument graph (dB): graphs are far louder than the RB-338, which stays at 0 dB */
export const GRAPH_FADER_DB = -6;

// Baukasten graph per GM program family for the `poly` profile; used only when the graph exists on the instance
const FAMILIE_GRAPH: readonly (string | ((p: number) => string))[] = [
  'saite-klavier', 'fm-glocke', 'juno-pad', 'saite-gitarre', 'fm-bass',                       // piano, chromatic percussion, organ, guitar, bass
  // strings (46 = harp), ensemble and choir
  (p) => (p === 46 ? 'saite-harfe' : 'juno-pad-hall'), (p) => (p >= 52 && p <= 54 ? 'wavetable-chor' : 'juno-pad-hall'),
  'hartsync-pad', 'fm-epiano', 'wavetable-chor', 'lead', 'juno-pad',                           // brass, reed, pipe, synth lead, synth pad
  'granular-pad', 'saite-karplus', 'resonator-marimba', 'granular-textur',                    // synth effects, ethnic, percussive, sound effects
];
export const graphFuerProgramm = (p: number | null): string => {
  if (p === null) return 'juno-pad';
  const f = FAMILIE_GRAPH[p >> 3] ?? 'juno-pad';
  return typeof f === 'function' ? f(p) : f;
};

/** the highest number of notes sounding at once in a part */
export function polyphonie(t: SmfTeil): number {
  const e: number[] = [];
  for (const n of t.noten) { e.push(n.tick * 2 + 1, (n.tick + n.dauer) * 2); }   // an end sorts before a start at the same tick
  e.sort((a, b) => a - b);
  let c = 0, m = 0;
  for (const x of e) { if (x & 1) { c++; if (c > m) m = c; } else c--; }
  return m;
}

function wunschZuGeraet(w: GeraetWunsch, schluessel: string): Record<string, unknown> | null {
  if (w === null) return null;
  if (typeof w === 'object' && !Array.isArray(w)) return w;
  if (typeof w !== 'string') {
    throw new MidiImportFehler(400, 'argument_ungueltig', `zuordnung[${schluessel}]: a device word, null or a geraet object expected`);
  }
  const s = w.trim();
  if (s === 'rb338') return { art: 'intern', name: 'rb338' };
  if (s === 'keins' || s === 'none') return null;
  let m = /^kit:([a-z0-9_-]{1,32})$/.exec(s);
  if (m) return { art: 'intern', name: 'kit', kit: m[1] };
  m = /^bk:([a-z0-9_-]{1,32})$/.exec(s);
  if (m) return { art: 'intern', name: 'bk', graph: m[1], parameter: {} };
  m = /^surge(?::([12]))?$/.exec(s);
  if (m) return { art: 'wirt', name: 'surge', ...(m[1] ? { slot: Number(m[1]) } : {}) };
  throw new MidiImportFehler(400, 'argument_ungueltig',
    `zuordnung[${schluessel}]: expected rb338, kit:<name>, bk:<graph>, surge[:1|2], keins, null or a geraet object`);
}
const geraetText = (g: Record<string, unknown> | null): string => {
  if (g === null) return 'no sound';
  if (g.art === 'intern' && g.name === 'kit') return `kit ${g.kit}`;
  if (g.art === 'intern' && g.name === 'bk') return `graph ${g.graph}`;
  if (g.art === 'intern') return 'RB-338';
  if (g.art === 'wirt') return `Surge${g.slot ? ` slot ${g.slot}` : ''}`;
  return String(g.art);
};

function dauerSekunden(d: SmfDatei, bisTick: number): number | null {
  const tempi = d.tempi.length ? d.tempi : [{ tick: 0, us: 500_000, bpm: 120 }];
  let s = 0, aktuell = tempi[0].tick === 0 ? tempi[0].us : 500_000, ab = 0, i = tempi[0].tick === 0 ? 1 : 0;
  for (; i < tempi.length && tempi[i].tick < bisTick; i++) {
    s += ((tempi[i].tick - ab) * aktuell) / d.ticksProViertel / 1e6;
    ab = tempi[i].tick; aktuell = tempi[i].us;
  }
  return runde(s + ((bisTick - ab) * aktuell) / d.ticksProViertel / 1e6, 1);
}

export function planeImport(d: SmfDatei, projekt: Projekt | null, eingabe: ImportEingabe, ctx: ImportKontext): ImportPlan {
  const hinweise: BerichtHinweis[] = d.hinweise.map((h) => ({ code: h.code, text: h.text }));
  const alle = new Map(d.teile.map((t) => [teilSchluessel(t), t]));
  if (alle.size === 0) throw new MidiImportFehler(409, 'midi_keine_noten', 'the file holds no notes');
  let gewaehlt: SmfTeil[];
  if (eingabe.auswahl === undefined) gewaehlt = d.teile;
  else {
    if (!Array.isArray(eingabe.auswahl) || eingabe.auswahl.length === 0) throw new MidiImportFehler(400, 'argument_ungueltig',
      'auswahl: a non-empty list of part keys expected');
    const gesehen = new Set<string>();
    gewaehlt = [];
    for (const k of eingabe.auswahl) {
      const t = typeof k === 'string' ? alle.get(k) : undefined;
      if (!t) throw new MidiImportFehler(400, 'midi_schluessel_unbekannt', `auswahl: no part with notes has the key ${JSON.stringify(k)}`, { schluessel: k });
      if (!gesehen.has(k)) { gesehen.add(k); gewaehlt.push(t); }
    }
    gewaehlt.sort((a, b) => a.spur - b.spur || a.kanal - b.kanal);
  }
  for (const k of Object.keys(eingabe.zuordnung ?? {})) {
    if (!alle.has(k)) throw new MidiImportFehler(400, 'midi_schluessel_unbekannt', `zuordnung: no part with notes has the key ${JSON.stringify(k)}`,
      { schluessel: k });
  }
  const nichtAngelegt = d.teile.filter((t) => !gewaehlt.includes(t)).map((t) => ({ schluessel: teilSchluessel(t), grund: 'not selected' }));

  // --- tempo and time signature ---
  const erstes = d.tempi[0] ?? null;
  const quelleBpm = erstes ? runde(erstes.bpm, 2) : null;
  const wiederholt = d.tempi.filter((t) => Math.abs(t.bpm - (erstes?.bpm ?? 0)) > 0.01);
  const modus = eingabe.tempo ?? 'auto';
  if (modus !== 'auto' && modus !== 'uebernehmen' && modus !== 'behalten') throw new MidiImportFehler(400, 'argument_ungueltig',
    'tempo: auto, uebernehmen or behalten expected');
  const leer = projekt === null || projekt.spuren.length === 0;
  const wollen = quelleBpm !== null && (modus === 'uebernehmen' || (modus === 'auto' && leer));
  let gesetzt: number | null = null;
  if (wollen && quelleBpm !== null) {
    if (quelleBpm < TEMPO_MIN || quelleBpm > TEMPO_MAX) {
      hinweise.push({ code: 'midi_tempo_ausserhalb',
        text: `the file's tempo ${quelleBpm} bpm is outside ${TEMPO_MIN} to ${TEMPO_MAX}; the project tempo stays, `
          + `so the piece plays ${runde(projekt?.tempo_bpm ?? 120, 1)}/${quelleBpm} times as fast as written` });
    } else if (projekt === null || Math.abs(projekt.tempo_bpm - quelleBpm) > 1e-9) gesetzt = quelleBpm;
  } else if (quelleBpm !== null && modus === 'auto' && projekt && Math.abs(projekt.tempo_bpm - quelleBpm) > 0.01) {
    hinweise.push({ code: 'midi_tempo_nicht_uebernommen',
      text: `the project already holds tracks, so its tempo ${projekt.tempo_bpm} bpm stays (the file says ${quelleBpm}); `
        + 'pass tempo "uebernehmen" to take the file\'s' });
  }
  if (erstes !== null && erstes.tick > 0) {
    hinweise.push({ code: 'midi_tempo_spaet',
      text: `the first tempo of the file comes at beat ${runde(erstes.tick / d.ticksProViertel, 3)}; before it the SMF default 120 bpm applies, `
        + 'the project takes the first tempo for the whole piece' });
  }
  if (quelleBpm === null) hinweise.push({ code: 'midi_kein_tempo', text: 'the file sets no tempo (the SMF default is 120 bpm); the project tempo stays' });
  if (wiederholt.length > 0) {
    hinweise.push({ code: 'midi_tempowechsel',
      text: `${wiederholt.length} tempo change${wiederholt.length === 1 ? '' : 's'} in the file are not mapped (a project has one tempo); `
        + 'the notes keep their beat positions and play at the project tempo throughout' });
  }
  const takt0 = d.taktarten[0] ? ([d.taktarten[0].zaehler, d.taktarten[0].nenner] as [number, number]) : null;
  const taktWechsel = d.taktarten.filter((t) => takt0 && (t.zaehler !== takt0[0] || t.nenner !== takt0[1])).length;
  const abweichend = (takt0 !== null && (takt0[0] !== 4 || takt0[1] !== 4)) || taktWechsel > 0;
  if (abweichend) {
    hinweise.push({ code: 'midi_taktart',
      text: `the file is in ${takt0 ? `${takt0[0]}/${takt0[1]}` : '?'}`
        + `${taktWechsel ? ` with ${taktWechsel} later change${taktWechsel === 1 ? '' : 's'}` : ''}; `
        + 'projects are 4/4 only, so the beat positions are kept and the bar lines will not line up with the source bars' });
  }

  // --- limits ---
  const frei = MAX_SPUREN - (projekt?.spuren.length ?? 0);
  const notenNeu = gewaehlt.reduce((s, t) => s + t.noten.length, 0);
  let anlegbar = true, grund: string | undefined, grundText: string | undefined;
  const sperre = (g: string, t: string): void => { if (anlegbar) { anlegbar = false; grund = g; grundText = t; } };
  if (gewaehlt.length > frei) sperre('midi_zu_viele_spuren',
    `${gewaehlt.length} tracks needed but only ${frei} of ${MAX_SPUREN} are free; select fewer parts (auswahl) or remove tracks`);
  const notenVorhanden = projekt?.spuren.reduce((s, x) => s + x.clips.reduce((c, k) => c + (k.art === 'midi' ? k.noten.length : 0), 0), 0) ?? 0;
  if (notenVorhanden + notenNeu > MAX_NOTEN) sperre('zu_gross',
    `${notenNeu} notes would bring the project to ${notenVorhanden + notenNeu} (at most ${MAX_NOTEN}); select fewer parts`);
  const clipsVorhanden = projekt?.spuren.reduce((s, x) => s + x.clips.length, 0) ?? 0;
  if (clipsVorhanden + gewaehlt.length > MAX_CLIPS) sperre('zu_gross', `too many clips (at most ${MAX_CLIPS})`);
  const tpq = d.ticksProViertel;
  // the length is the end of the last note: a far marker in an otherwise empty track must not refuse the file
  let endeNoten = 0;
  for (const t of d.teile) for (const x of t.noten) endeNoten = Math.max(endeNoten, x.tick + x.dauer);
  if (endeNoten / tpq > MAX_BEAT) sperre('midi_zu_lang', `the file is ${runde(endeNoten / tpq, 0)} beats long (at most ${MAX_BEAT})`);

  // --- devices ---
  const bkVorhanden = projekt?.spuren.filter((s) => s.geraet?.art === 'intern' && s.geraet.name === 'bk').length ?? 0;
  let bkFrei = MAX_BK_SPUREN - bkVorhanden;
  const polyAuto = new Set<string>();
  if (eingabe.profil === 'poly') {
    const kandidaten = gewaehlt.filter((t) => t.kanal !== 9 && eingabe.zuordnung?.[teilSchluessel(t)] === undefined && polyphonie(t) >= 2)
      .sort((a, b) => polyphonie(b) - polyphonie(a) || b.noten.length - a.noten.length);
    for (const t of kandidaten) {
      if (bkFrei <= 0) break;
      if (ctx.graphArt?.(graphFuerProgramm(t.programm)) !== 'instrument') continue;
      polyAuto.add(teilSchluessel(t)); bkFrei--;
    }
  } else if (eingabe.profil !== undefined && eingabe.profil !== 'einfach')
    throw new MidiImportFehler(400, 'argument_ungueltig', 'profil: einfach or poly expected');

  // --- the commands ---
  const befehle: unknown[] = [];
  if (gesetzt !== null) befehle.push({ befehl: 'tempo_setzen', bpm: gesetzt });
  const simulation = projekt ? structuredClone(projekt) : null;     // spur_neu takes its id from neueId; predicting it needs the same counter
  const spuren: BerichtSpur[] = [];
  const NAME_MAX = 80;
  const namenGesehen = new Map<string, number>();
  const nachSpur = new Map<number, number>();
  for (const t of gewaehlt) nachSpur.set(t.spur, (nachSpur.get(t.spur) ?? 0) + 1);
  let ohneKlang = 0;
  for (const t of gewaehlt) {
    const k = teilSchluessel(t);
    const schlag = t.kanal === 9;
    const h: BerichtHinweis[] = [];
    let geraet: Record<string, unknown> | null;
    const wunsch = eingabe.zuordnung?.[k];
    if (wunsch !== undefined) geraet = wunschZuGeraet(wunsch, k);
    else if (schlag) {
      if (ctx.gmKit) {
        geraet = { art: 'intern', name: 'kit', kit: ctx.gmKit.name };
        const fehlen = new Set(t.noten.filter((n) => !ctx.gmKit!.noten.has(n.ton)).map((n) => n.ton));
        if (fehlen.size) h.push({ code: 'midi_schlagzeug_ohne_klang',
          text: `${t.noten.filter((n) => !ctx.gmKit!.noten.has(n.ton)).length} drum notes `
            + `(GM notes ${[...fehlen].sort((a, b) => a - b).join(', ')}) have no sound in kit ${ctx.gmKit.name}` });
      } else { geraet = null; h.push({ code: 'midi_kein_gm_kit',
        text: 'no GM drum kit is available (the kit folder holds neither "gm" nor "techno"); the drum track has no sound until you assign a kit' }); }
    } else if (polyAuto.has(k)) geraet = { art: 'intern', name: 'bk', graph: graphFuerProgramm(t.programm), parameter: {} };
    else geraet = { art: 'intern', name: 'rb338' };
    // the GM kit may still be built by the import
    if (geraet?.art === 'intern' && geraet.name === 'kit' && ctx.kitDa && geraet.kit !== ctx.gmKit?.name && !ctx.kitDa(String(geraet.kit))) {
      h.push({ code: 'midi_kit_unbekannt', text: `kit ${geraet.kit} is not in the kit folder; the track gets no sound` }); geraet = null;
    }
    if (geraet?.art === 'intern' && geraet.name === 'bk' && ctx.graphArt && ctx.graphArt(String(geraet.graph)) !== 'instrument') {
      h.push({ code: 'midi_graph_unbekannt',
        text: `graph ${geraet.graph} is not an instrument graph of this instance; the track gets no sound` }); geraet = null;
    }
    const poly = polyphonie(t);
    if (geraet?.art === 'intern' && geraet.name === 'rb338' && poly >= 2) h.push({ code: 'midi_mono',
      text: `up to ${poly} notes sound at once, the RB-338 plays one; assign a polyphonic instrument (profil poly or zuordnung)` });
    if (geraet === null) ohneKlang++;
    const stumm = geraet === null;
    // name: the track name, else the GM program name (else Drums); channels of one MIDI track share its name, so add the channel then
    let name = t.name ?? (schlag ? 'Drums' : t.programm !== null ? gmProgrammName(t.programm) : `Track ${t.spur + 1}`);
    // a suffix is never cut off: the base shrinks, and a counter skips names that exist already (also real ones such as "Piano (2)")
    const mitSuffix = (basis: string, suffix: string): string => basis.slice(0, NAME_MAX - suffix.length) + suffix;
    if ((nachSpur.get(t.spur) ?? 0) > 1) name = mitSuffix(name, ` ch${t.kanal + 1}`);
    name = name.slice(0, NAME_MAX);
    if (namenGesehen.has(name)) {
      const basis = name;
      let n = 2;
      while (namenGesehen.has(mitSuffix(basis, ` (${n})`))) n++;
      name = mitSuffix(basis, ` (${n})`);
    }
    namenGesehen.set(name, 1);

    const startTick = Math.floor(t.noten[0].tick / tpq) * tpq;
    let endTick = 0;
    for (const x of t.noten) endTick = Math.max(endTick, x.tick + x.dauer);
    const start = startTick / tpq;
    const laenge = Math.max(1, Math.ceil(endTick / tpq) - start);
    const noten = t.noten.map((x) => ({ beat: (x.tick - startTick) / tpq, laenge: x.dauer / tpq, ton: x.ton, vel: x.vel }));

    const spurId = simulation ? neueId(simulation, 'spur') : `s${spuren.length + 1}`;
    const geraetBefehl = geraet === null ? {} : { geraet };
    befehle.push({ befehl: 'spur_neu', art: 'instrument', name, ...geraetBefehl });
    // faders stay at 0 dB: one RB-338 peaks near -28 dBFS, 26 of them stay below full scale (measured, stand file).
    // A Baukasten instrument graph is about 12 dB louder than an RB-338 (Bolero: Flutes -22.5 LUFS against -34.7 for the RB-338), so the poly profile
    // reached +1 dBTP in the last window of the sum (dress rehearsal 2): a track on a graph starts at GRAPH_FADER_DB.
    if (geraet?.art === 'intern' && geraet.name === 'bk') befehle.push({ befehl: 'spur_aendern', spur_id: spurId, fader_db: GRAPH_FADER_DB });
    if (stumm) befehle.push({ befehl: 'spur_aendern', spur_id: spurId, mute: true });
    befehle.push({ befehl: 'clip_neu', spur_id: spurId, art: 'midi', name, start_beat: start, laenge_beats: laenge, noten });
    spuren.push({
      schluessel: k, name, spur: t.spur, kanal: t.kanal + 1, programm: t.programm, programm_name: t.programm !== null ? GM_PROGRAMME[t.programm] ?? null : null,
      schlagzeug: schlag, noten: t.noten.length, von_beat: runde(t.noten[0].tick / tpq, 4), bis_beat: runde(endTick / tpq, 4), polyphonie: poly,
      geraet, geraet_text: geraetText(geraet), stumm, hinweise: h,
    });
  }
  if (ohneKlang > 0) hinweise.push({ code: 'midi_spuren_ohne_klang',
    text: `${ohneKlang} track${ohneKlang === 1 ? '' : 's'} created muted without an instrument; assign one and unmute` });
  const ignoriertSumme = Object.values(d.ignoriert).reduce((a, b) => a + b, 0);
  if (ignoriertSumme > 0) {
    hinweise.push({ code: 'midi_ignoriert',
      text: `not carried over: ${d.ignoriert.controller} controller, ${d.ignoriert.pitchbend} pitch bend, ${d.ignoriert.aftertouch} aftertouch, `
        + `${d.ignoriert.sysex} sysex, ${d.ignoriert.meta} other meta events` });
  }
  if (nichtAngelegt.length) hinweise.push({ code: 'midi_nicht_ausgewaehlt',
    text: `${nichtAngelegt.length} part${nichtAngelegt.length === 1 ? '' : 's'} with notes not selected` });
  const leereSpuren = d.spurenGelesen - new Set(d.teile.map((t) => t.spur)).size;
  if (leereSpuren > 0) hinweise.push({ code: 'midi_leere_spuren',
    text: `${leereSpuren} of ${d.spurenGelesen} MIDI tracks hold no notes (tempo or marker tracks) and make no project track` });

  return {
    befehle: anlegbar ? befehle : [],
    bericht: {
      datei: { format: d.format, ticks_pro_viertel: tpq, midi_spuren: d.spurenGelesen, spuren_mit_noten: new Set(d.teile.map((t) => t.spur)).size,
        noten: d.notenZahl,
        laenge_beats: runde(endeNoten / tpq, 3), dauer_s: dauerSekunden(d, endeNoten) },
      tempo: { quelle_bpm: quelleBpm, gesetzt_bpm: gesetzt, aenderungen: wiederholt.length,
        aenderungen_liste: wiederholt.slice(0, 5).map((t) => ({ beat: runde(t.tick / tpq, 3), bpm: runde(t.bpm, 2) })) },
      taktart: { quelle: takt0, projekt: [4, 4], abweichend, wechsel: taktWechsel },
      spuren, nicht_angelegt: nichtAngelegt,
      summe: { spuren: spuren.length, clips: spuren.length, noten: notenNeu, ohne_klang: ohneKlang },
      ignoriert: d.ignoriert, hinweise, anlegbar, ...(grund ? { grund, grund_text: grundText } : {}),
    },
  };
}
