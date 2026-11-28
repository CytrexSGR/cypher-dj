// One classification of every tool of the hand (djk/hand/hand.ts): what it may do to the studio and to the person's files.
// The page server enforces the level of a token against this table, the hand imports it for its early check.
// Rules: lesen changes nothing. schreiben changes studio state but is undoable or transient, or writes a new file that
// never overwrites. zerstoerend deletes, overwrites without undo, exports into the person's folders or stops sound.
// A new tool in hand.ts needs an entry here (djk/hand/tests/hand_klassen.test.mjs fails otherwise).

import type { Stufe } from './hand_schutz.ts';
export type { Stufe };
export type Art = 'loescht' | 'ueberschreibt' | 'exportiert' | 'stoppt_klang';
export interface Klasse { stufe: Stufe; art?: Art; warum?: string }
export interface Eintrag extends Klasse {
  /** Overrides per `aktion` argument of the tool; an aktion that is not listed uses the entry itself. */
  aktionen?: Record<string, Klasse>;
  /** Exact POST paths this tool sends that only read (a measurement), so a `lesen` token may call them. */
  lesendePost?: readonly string[];
}

const L: Klasse = { stufe: 'lesen' };
const S: Klasse = { stufe: 'schreiben' };
const loescht = (warum: string): Klasse => ({ stufe: 'zerstoerend', art: 'loescht', warum });
const stoppt = (warum: string): Klasse => ({ stufe: 'zerstoerend', art: 'stoppt_klang', warum });
const exportiert = (warum: string): Klasse => ({ stufe: 'zerstoerend', art: 'exportiert', warum });
const ueberschreibt = (warum: string): Klasse => ({ stufe: 'zerstoerend', art: 'ueberschreibt', warum });

export const RANG: Readonly<Record<Stufe, number>> = { lesen: 0, schreiben: 1, zerstoerend: 2 };

export const HAND_KLASSEN: Readonly<Record<string, Eintrag>> = {
  // read
  lage: L, bestand: L, modul_stand: L, spuren: L, studio: L, loops: L, pegel: L, spektrum: L, oszilloskop: L, hoeren: L,
  warte: L, graphen: L, bibliothek: L, anschluss: L, stoebern: L, klaenge: L, bestand_karte: L, sets: L, set_zeige: L,
  proj_liste: L, module_suchen: L, proj_kits: L, proj_lage: L, proj_routing: L, proj_verlauf: L, proj_versionen: L,
  proj_warp: L, proj_auto: L, geraete_lage: L, presets_suchen: L, presets_lesen: L, kollektionen: L, verwandt: L,
  // read, but sends a POST that only measures or resets a meter
  proj_analyse: { ...L, lesendePost: ['/proj/analyse'] },
  proj_lautheit: { ...L, lesendePost: ['/proj/lautheit'] },
  mischung: L,
  analyse_live: { ...L, lesendePost: ['/analyse/pegel/reset'] },
  // write
  laden: S, deck_start: S, sprung: S, loop: S, loop_nach_box: S, live_oeffnen: S, modul_export: S, modul_stems: S,
  modul_tonart: S, regler: S, fx: S, fx_zuweisung: S, graph: S, strudel: S, harmonie: S, abbrechen: S, tempo: S, ansage: S, rec: S,
  loop_klang: S, spur: S, bogen: S, spur_stopp: S, vorbereiten: S, set_lege: S, set_vorbereiten: S, instrumente: S, stimme: S,
  proj_umbenennen: S, modul_einsetzen: S, modul_speichern: S, proj_muster: S, proj_midi_import: S, proj_neu: S,
  proj_oeffnen: S, proj_aendern: S, proj_undo: S, proj_redo: S, proj_version_sichern: S, proj_freeze: S,
  proj_zusammenfuehren: S, proj_bounce: S, proj_resample: S, proj_aufnahme: S, proj_strom_aufnehmen: S, proj_noten: S,
  proj_auto_zustand: S, take_vorhoeren: S, proj_stems: S, proj_stems_abbrechen: S, presets_speichern: S,
  presets_anwenden: S, modul_blend: S, import_datei: S, preset_vorhoeren: S,
  // a live recording: a new file, never overwrites
  mix_aufnahme: { ...S, aktionen: { stand: L } },
  // destructive: stops sound
  deck_stopp: stoppt('stops the deck, which silences the loop that is playing'),
  stille: stoppt('releases the generators and silences what plays'),
  modul_leeren: stoppt('empties a place of the live container, the module there stops sounding'),
  proj_version_zurueck: stoppt('closes and reopens the project, the current state is saved as a version first'),
  // destructive: exports into the person's folders
  proj_export: exportiert('renders and writes a file into the person\'s export folder, runs up to 80 minutes'),
  proj_export_spuren: exportiert('renders one file per track into the person\'s export folder'),
  // per-aktion (default write unless noted)
  pad: { ...S, aktionen: { loeschen: S } },
  seq: {
    ...S,
    aktionen: {
      stand: L, szenen: L,
      leeren: loescht('empties the pattern of the sequencer, no undo'),
      szene_loeschen: loescht('deletes a stored scene of the sequencer, no undo'),
    },
  },
  tracker: { ...S, aktionen: { song: L, lesen: L } },
  loopdeck: { ...S, aktionen: { stand: L, sets: L, effekte: L, stopp: stoppt('stops the cell of the loop deck that plays') } },
  session: {
    ...S,
    aktionen: {
      stand: L,
      stopp: stoppt('stops the session grid, the clips that play go silent'),
      szene_loeschen: loescht('deletes a scene of the session grid, no undo'),
    },
  },
  box: { ...S, aktionen: { stopp: stoppt('stops the cell of the loop box that plays') } },
  szene: {
    ...S,
    aktionen: {
      liste: L, zeige: L,
      ersetzen: ueberschreibt('replaces a stored scene of that name'),
      loeschen: loescht('deletes a stored scene'),
    },
    lesendePost: ['/szene'],
  },
  aufbau: {
    ...S,
    aktionen: {
      liste: L, zeige: L,
      ersetzen: ueberschreibt('replaces a stored setup of that name'),
      loeschen: loescht('deletes a stored setup'),
    },
    lesendePost: ['/aufbau'],
  },
  klang: {
    ...S,
    aktionen: { liste: L, zeige: L, params: L, speichere: ueberschreibt('writes a sound preset to disk, may replace a stored one of that name') },
    lesendePost: ['/klang'],
  },
  proj_dateien: { ...L, aktionen: { finden: L, relink: S, aufraeumen: loescht('removes unused files from the project folder') } },
  kits: { ...S, aktionen: { liste: L, loeschen: loescht('deletes a drum kit of the person\'s library') } },
  analyse_referenz: {
    ...S,
    aktionen: {
      liste: L,
      messen: { ...L },
      loeschen: loescht('deletes a stored reference measurement'),
    },
    lesendePost: ['/analyse/referenz/messen'],
  },
  klang_runde: { ...S, aktionen: { lage: L } },
  proj_transport: { ...S, aktionen: { stopp: stoppt('stops the transport of the open project') } },
  proj_bk: { ...L, aktionen: { merken: S, laden: S } },
  plugins: { ...L, aktionen: { param: S } },
  kollektion_aendern: { ...S, aktionen: { loeschen: loescht('deletes a collection') } },
  sampler: {
    ...S,
    aktionen: { quellen: L, liste: L, lies: L, dateien: L, loeschen: loescht('deletes a sample or a sampler patch, no undo') },
  },
  steckfeld: { ...S, aktionen: { zeige: L } },
  tags: { ...S, aktionen: { lesen: L, suchen: L, vokabular: L, gespeichert: L } },
  bibliothek_bauen: { ...S, aktionen: { stand: L, quellen: L } },
};

/** The class of a tool call: the aktion override if there is one, else the entry of the tool, else null (unknown tool). */
export function klasseVon(werkzeug: string, aktion?: string | null): Klasse | null {
  const e = HAND_KLASSEN[werkzeug];
  if (!e) return null;
  const a = aktion ? e.aktionen?.[aktion] : undefined;
  return a ?? { stufe: e.stufe, ...(e.art ? { art: e.art } : {}), ...(e.warum ? { warum: e.warum } : {}) };
}
