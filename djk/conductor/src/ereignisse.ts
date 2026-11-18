// Kern- und Notbahn-Meldungen → WS-Ereignis-Art (INTERFACES §9.3) und Ansage-Satz (ADR 019).
// Was hier keine Art hat (/e/regler, /e/taste, /e/frist, /e/raster, /e/hotcue, /e/rueckweg, /e/protokollfehler,
// /q, /q/stand), geht nur ins Journal: §9.3 kennt dafür keine Art; Pläne und Teile kommen mit Scheibe 21.
import type { Felder } from './addresses.ts';

export const ART_JE_ADRESSE: Record<string, string> = {
  '/e/geladen': 'geladen',
  '/e/halter': 'halter',
  '/e/invariante': 'invariante',
  '/e/rueckfall': 'rueckfall',
  '/e/luecke': 'luecke',
  '/e/quantum': 'quantum',
  '/e/ki': 'ki_stopp',
  '/e/tempo': 'tempo',
  '/e/neustart': 'neustart',
  '/e/hand': 'hand',
  '/nb': 'notbahn',
};

// Hochfrequente Ströme gehen nicht ins Journal (§18 Punkt 5, §15 Pflichtliste): /uhr je Zyklus wären
// 187,5 Zeilen je Sekunde, /zustand/kern und /pegel je 20 Hz, /zustand/deck 50 Hz je Deck, /zustand/box 50 Hz je Box
// (Keylock 7b.3, §5.5b).
// /zustand/komp 10 Hz je aktivem Kompressor (2026-10-11); /zustand/ein 20 Hz ohne Änderungs-Auslöser (§5.14, 2026-10-26: 60 % der Zeilen)
// A6 (1.15 mix tools): /zustand/mix 10 Hz x one line per channel with a running tool (up to 17 channels = 170 lines per second),
// /zustand/spektrum 25 Hz while a source is selected; a journal.jsonl of 0.3 GB already exists (review M3), these would add more than the
// rest together. Neither carries a decision, both are meters.
export const NICHT_INS_JOURNAL = new Set([
  '/uhr', '/zustand/kern', '/zustand/deck', '/zustand/box', '/zustand/komp', '/zustand/ein', '/pegel', '/zustand/mix', '/zustand/spektrum',
  '/e/ins_gr',   // 1.10 slice 4a: gain reduction of up to 12 insert stages at 20 Hz = 240 lines per second, a meter, no decision
  '/e/stufe_pegel',   // device faces T9: input and output peak of up to 14 compressor and limiter stages plus the channel compressors at 20 Hz, a meter, no decision
]);

// Jede Adresse, die dieser Leitstand liest oder schreibt; tests/addresses.test.ts prüft, dass der Vertrag
// (djk/contract/osc_addresses.ts) sie alle kennt.
export const GENUTZT = [
  '/k/hallo', '/k/tschuess', '/k/willkommen', '/uhr', '/takt', '/q', '/q/stand', '/e/protokollfehler',
  ...Object.keys(ART_JE_ADRESSE),
  // Scheibe 21: Annahme, Hörschein-Register, KI, LEDs, Tasten, Spiegel
  '/k/teil', '/k/abbruch', '/k/tempo/rampe', '/k/deck/start', '/k/deck/stopp', '/k/deck/loop', '/k/deck/roll',
  '/k/deck/sprung', '/k/deck/hotcue', '/k/hoerschein', '/k/hoerschein/weg', '/k/ki/spur', '/k/ki/stufe', '/k/led',
  '/k/vorschlag_kanal', '/e/regler', '/e/taste', '/zustand/deck', '/zustand/kern', '/test/hand',
  '/zustand/box',  // Keylock 7b.3: nur gelesen, um es aus dem Journal zu halten
  '/zustand/komp',  // Effekt-Sektion 2026-10-11: ebenso
  '/zustand/mix', '/zustand/spektrum',  // A6: ebenso
  '/e/ins_gr',  // 1.10 slice 4a: read only to keep it out of the journal
  '/e/stufe_pegel',  // device faces T9: ebenso
];

export type AnsageArt = 'vorschlag' | 'plan' | 'rueckfall' | 'warnung' | 'info';
export interface Ansage { text: string; art: AnsageArt }

const NB_ZUSTAND = ['durchreichen', 'Schleife', 'ausgeblendet', 'Rückgabe'];

// Ein Satz mit Takt; null heißt: keine Ansage (zu häufig oder nichts für Andreas' Augen).
export function ansageFuer(adresse: string, f: Felder, takt: number, nbVorher: number | null): Ansage | null {
  const t = `T ${takt}`;
  switch (adresse) {
    case '/e/luecke':
      return { text: `${t}: Lücke im Kern, ${f.frames} Frames in ${f.zyklen} Zyklen`, art: 'warnung' };
    case '/e/neustart':
      return { text: `${t}: Kern neu gestartet, Generation ${f.generation}`, art: 'warnung' };
    case '/e/rueckfall':
      return { text: `${t}: Rückfall-Loop Deck ${f.deck} ${f.an === 1 ? 'an' : 'aus'}`, art: 'rueckfall' };
    case '/e/invariante':
      return { text: `${t}: Invariante ${f.art} hält Plan ${f.plan} Teil ${f.teil}`, art: 'warnung' };
    case '/e/ki':
      return { text: `${t}: KI ${f.gestoppt === 1 ? 'gestoppt' : 'frei'} (${f.grund})`, art: 'warnung' };
    case '/e/quantum':
      return { text: `${t}: Quantum ${f.alt} → ${f.neu}`, art: 'info' };
    case '/e/geladen':
      return { text: `${t}: Deck ${f.deck} geladen, ${f.material_id} r${f.fassung}`, art: 'info' };
    case '/e/protokollfehler':
      return { text: `${t}: Kern meldet Protokollfehler ${f.grund} bei ${f.adresse || '?'}`, art: 'warnung' };
    case '/nb': {
      const z = f.zustand as number;
      if (nbVorher === z) return null; // /nb kommt mit 1 Hz; angesagt wird nur der Wechsel
      if (nbVorher === null && z === 0) return null;
      return { text: `${t}: Notbahn ${NB_ZUSTAND[z] ?? z}`, art: z === 0 ? 'info' : 'warnung' };
    }
    default:
      return null;
  }
}

// ---------- Lean operating journal (plan 2026-11-18-lean-operating-journal) ----------

// "voll": every line as before. "schlank": the operating journal of a set keeps only lines that say something new
// (journalWuerdig). The filter sits only in front of Journal.schreibe; the annahme, the spiegel, the websocket clients and the
// tick see every message in both modes.
export type JournalModus = 'voll' | 'schlank';
export const JOURNAL_MODI: readonly JournalModus[] = ['voll', 'schlank'];

// Option (--journal / LeitstandOptionen.journal) wins over the config key; both absent means voll.
export function journalModus(option: string | undefined, konfig: string | undefined): JournalModus {
  const [wert, woher] = option !== undefined ? [option, '--journal'] : [konfig, 'journal (leitstand.toml)'];
  if (wert === undefined) return 'voll';
  if (!(JOURNAL_MODI as readonly string[]).includes(wert)) {
    throw new Error(`${woher}: "${wert}" is not a journal mode, allowed are ${JOURNAL_MODI.join(', ')}`);
  }
  return wert as JournalModus;
}

const HEARTBEAT_ALTER_NS = 60e9;   // a lean journal still gets a /k/hallo or /k/willkommen line every minute (keeps its mtime for fortsetzbar)

// Status lines: what the core repeats unchanged. Value: the fields left out of the comparison (they move every time).
const ZUSTAND_OHNE: Readonly<Record<string, readonly string[]>> = {
  '/zustand/arr': ['projekt_beat'],
  '/zustand/warp': [],
  '/zustand/rec': ['projekt_beat'],
  '/zustand/spur_pool': ['blocks_parallel', 'einheiten_worker', 'einheiten_caller', 'seriell_summe', 'zurueck'],
  '/zustand/hall_pool': [],
  '/zustand/ins_host': [],
  '/nb': ['w'],
};

const VERLUST_FELDER = ['verworfen', 'verworfen_anderes_muster', 'zu_spaet', 'ungehoert'];

// Does this line go into the journal? voll: always. schlank: see the plan, decision 2.
// merker: what the process wrote last per type (starts empty with the process, so the first line of each type is always
// written); it is updated here when a line is let through. kenntQuittung: the receipt belongs to a plan part or is waited for.
// monoNs: the mono_ns of the line (time base of the 60 s rule).
export function journalWuerdig(
  modus: JournalModus, von: string, typ: string, daten: Record<string, unknown>, merker: Map<string, string>,
  kenntQuittung: (daten: Record<string, unknown>) => boolean, monoNs = 0,
): boolean {
  if (modus !== 'schlank') return true;
  switch (typ) {
    case '/k/led':
    case '/k/vorschlag_kanal':
      return von !== 'leitstand';
    case '/k/hallo':
    case '/k/willkommen': {
      const generation = String(daten.generation);
      const zeitKey = `${typ}@mono`;
      const letzteZeit = merker.get(zeitKey);
      const neu = merker.get(typ) !== generation || letzteZeit === undefined || monoNs - Number(letzteZeit) > HEARTBEAT_ALTER_NS;
      if (neu) { merker.set(typ, generation); merker.set(zeitKey, String(monoNs)); }
      return neu;
    }
    case '/q': {
      if (von !== 'kern') return true;
      const status = daten.status as number;
      return !(status === 1 || status === 2 || status === 3) || (daten.grund !== undefined && daten.grund !== '') || kenntQuittung(daten);
    }
    case '/erz/quittung':
      return VERLUST_FELDER.some((f) => daten[f] !== 0 && daten[f] !== undefined);
    default: {
      if (!Object.hasOwn(ZUSTAND_OHNE, typ)) return true;
      const ohne = ZUSTAND_OHNE[typ];
      const stand = JSON.stringify(Object.entries(daten).filter(([k]) => !ohne.includes(k)));
      if (merker.get(typ) === stand) return false;
      merker.set(typ, stand);
      return true;
    }
  }
}

// Resume (Leitstand.wiederaufnehmen): the types of lines Annahme.wiederaufnehmen and Spiegel never consume. It reads only
// plan_eingereicht, vorschlag_ende, plan_status, teil_gesendet, kopplung, autonomie, hoerschein, /q (von kern) and /e/* (von
// kern), and the leitstand itself reads /k/willkommen and /e/neustart for the generation. None of the types below is one of
// them (a /zustand/* or /nb line is never fed to the spiegel on resume, /takt is not an /e/ address).
export const RESUME_UEBERSPRINGT: ReadonlySet<string> = new Set([
  '/k/led', '/k/hallo', '/erz/quittung', '/zustand/arr', '/zustand/warp', '/zustand/rec', '/zustand/spur_pool',
  '/zustand/hall_pool', '/zustand/ins_host', '/nb', '/takt',
]);

// Predicate on the RAW journal line (journalZeilen, third argument): false = the resume does not need the line, skip it
// before JSON.parse. Looks at the typ field only: it stands in the head of the line, before the daten object (Leitstand.zeile
// and Journal.oeffne write sample, beat, takt, mono_ns, von, typ, daten in this order); a text inside daten cannot match.
// A line whose typ is not found in the head is kept and parsed.
export function resumeLiestZeile(zeile: string): boolean {
  const ende = zeile.indexOf('"daten":');
  const kopf = ende < 0 ? zeile : zeile.slice(0, ende);
  const i = kopf.indexOf('"typ":"');
  if (i < 0) return true;
  const von = i + 7;
  const bis = kopf.indexOf('"', von);
  if (bis < 0) return true;
  return !RESUME_UEBERSPRINGT.has(kopf.slice(von, bis));
}
