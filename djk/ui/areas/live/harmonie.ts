// Live harmony lane (strand 7, task 2.3): the repeating chord sequence of the live streams. State in the page server, written as
// `harmonie.json` ({eintraege: [...]}, entries of public/harmonie.js laneEintrag) into every stream folder; the generator reads it.
// A cycle is one bar: bar N (1-based, absolute from beat 0) is cycle N - 1. Pure state machine with injected I/O: the server passes the
// folders and the bar numbers of the clock, so this file never touches the clock, a device or a service.
import fs from 'node:fs';
import path from 'node:path';
import { SKALEN, SKALA_TEXT, TON_NAMEN, akkordBei, folgeLesen, laneEintrag, tonartFehler } from '../../public/harmonie.js';
// @ts-expect-error pure .mjs without types (djk/generator)
import { atomar } from '../../../generator/src/pattern_state.mjs';

export const HARMONIE_DATEI = 'harmonie.json';
export const MAX_VORAUS_TAKTE = 256;   // as MAX_TAKT of the spur tool
const BEHALTE_TAKTE = 64;              // entries that ended more than this many bars ago are dropped

export interface LaneEintrag { ab_zyklus: number; takte_je_akkord: number; tonart: { grundton: number; stufen: number[] } | null; folge: { name: string; grundton: number; toene: number[] }[] }
// The bars the clock gives: `takt` = next bar, `phrase` = next bar on the absolute phrase grid, `jetzt` = the bar being played (all 1-based).
export interface Takte { takt: number; phrase: number; jetzt: number }
export interface HarmonieAntwort {
  tonart: string | null; folge: string[]; takte_je_akkord: number | null; ab_takt: number | null;
  jetzt: { takt: number; akkord: string | null }; naechster_wechsel_takt: number | null; aus?: true; probe?: true; ok?: true;
}
export class HarmonieFehler extends Error {
  code: number; fehler: string; extra: Record<string, unknown>;
  constructor(code: number, fehler: string, text: string, extra: Record<string, unknown> = {}) { super(text); this.code = code; this.fehler = fehler; this.extra = extra; }
}
const AKZ = new Set(['folge', 'takte_je_akkord', 'tonart', 'ab', 'anker_takt', 'probe', 'aus']);
const NOTEN: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 'A minor', 'F# dorian', 'Bb major pentatonic', 'D' (= minor, the house default) -> {grundton, skala} of harmonie.js; throws on anything else
export function tonartLesen(text: unknown): { grundton: number; skala: string } {
  const t = typeof text === 'string' ? text.trim() : '';
  const m = /^([A-Ga-g])([#b]?)(?:\s+(.+))?$/.exec(t);
  const skala = (m?.[3] ?? 'minor').toLowerCase().replace(/[\s-]+/g, '_');
  if (!m || !Object.hasOwn(SKALEN, skala)) throw new HarmonieFehler(400, 'argument_ungueltig', `tonart: '${t}' is not a key like 'A minor' (scales: ${Object.keys(SKALEN).join(', ')})`);
  const grundton = (NOTEN[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const k = { grundton, skala };
  const f = tonartFehler(k);
  if (f) throw new HarmonieFehler(400, 'argument_ungueltig', `tonart: ${f}`);
  return k;
}
export function tonartName(t: { grundton: number; stufen: number[] } | null): string | null {
  if (!t) return null;
  const s = Object.entries(SKALEN as Record<string, number[]>).find(([, v]) => v.length === t.stufen.length && v.every((x, i) => x === t.stufen[i]));
  return `${TON_NAMEN[t.grundton]} ${s ? (SKALA_TEXT as Record<string, string>)[s[0]].toLowerCase() : 'scale'}`;
}

export class LiveHarmonie {
  private eintraege: LaneEintrag[] = [];
  private readonly ordner: () => string[];
  private readonly fehler: (ordner: string, e: Error) => void;
  private readonly schreibe: (datei: string, inhalt: string) => void;
  constructor(opt: { ordner: () => string[]; fehler?: (ordner: string, e: Error) => void; schreibe?: (datei: string, inhalt: string) => void }) {
    this.ordner = opt.ordner; this.fehler = opt.fehler ?? (() => {}); this.schreibe = opt.schreibe ?? atomar;
  }

  // Server start: the state comes back from the folder of stream 2 (the second folder of the list); missing or broken = no lane
  lade(quelle: string | undefined = this.ordner()[1] ?? this.ordner()[0]): void {
    this.eintraege = [];
    if (!quelle) return;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(quelle, HARMONIE_DATEI), 'utf8'));
      if (Array.isArray(j?.eintraege)) this.eintraege = j.eintraege.filter((e: LaneEintrag) => e && Number.isInteger(e.ab_zyklus) && Array.isArray(e.folge));
    } catch { /* no file or broken: no lane */ }
  }

  // Validate and (unless probe) set. `quelleCypher` is checked by the caller (ki_gestoppt); this only needs the bars.
  setze(d: Record<string, unknown>, takte: Takte): HarmonieAntwort {
    for (const k of Object.keys(d)) if (!AKZ.has(k)) throw new HarmonieFehler(400, 'argument_unbekannt', `unknown argument '${k}'`, { detail: k });
    if (d.probe !== undefined && typeof d.probe !== 'boolean') throw new HarmonieFehler(400, 'argument_ungueltig', 'probe: boolean');
    if (d.aus !== undefined && typeof d.aus !== 'boolean') throw new HarmonieFehler(400, 'argument_ungueltig', 'aus: boolean');
    const aus = d.aus === true, probe = d.probe === true;
    if (d.ab !== undefined && d.ab !== 'takt' && d.ab !== 'phrase') throw new HarmonieFehler(400, 'argument_ungueltig', 'ab: takt or phrase');
    let anker = d.ab === 'phrase' ? takte.phrase : takte.takt;
    if (d.anker_takt !== undefined) {
      if (d.ab !== undefined) throw new HarmonieFehler(400, 'ab_und_anker', 'ab and anker_takt exclude each other');
      if (typeof d.anker_takt !== 'number' || !Number.isInteger(d.anker_takt) || d.anker_takt < 1) throw new HarmonieFehler(400, 'argument_ungueltig', 'anker_takt: integer >= 1 (an absolute bar)');
      if (d.anker_takt < takte.takt) throw new HarmonieFehler(409, 'anker_vorbei', 'the requested anchor bar is no longer ahead; use fruehester_takt or later', { fruehester_takt: takte.takt });
      if (d.anker_takt - takte.takt > MAX_VORAUS_TAKTE) throw new HarmonieFehler(400, 'argument_ungueltig', `anker_takt: at most ${MAX_VORAUS_TAKTE} bars ahead`);
      anker = d.anker_takt;
    }
    const takteJe = d.takte_je_akkord ?? 1;
    if (typeof takteJe !== 'number' || !Number.isInteger(takteJe) || takteJe < 1 || takteJe > 64) throw new HarmonieFehler(400, 'argument_ungueltig', 'takte_je_akkord: integer 1..64');
    let eintrag: LaneEintrag;
    try {
      if (aus) eintrag = laneEintrag({ folge: [], takte_je_akkord: 1, ab_zyklus: anker - 1 });
      else {
        if (typeof d.folge !== 'string' || d.folge.trim() === '') throw new HarmonieFehler(400, 'argument_ungueltig', "folge: a chord text like 'Am7 | Fmaj7 G' (or aus: true)");
        const folge = folgeLesen(d.folge);
        if (!folge.length) throw new HarmonieFehler(400, 'argument_ungueltig', 'folge: no chords');
        eintrag = laneEintrag({ folge, takte_je_akkord: takteJe, tonart: d.tonart === undefined ? undefined : tonartLesen(d.tonart), ab_zyklus: anker - 1 });
      }
    } catch (e) {
      if (e instanceof HarmonieFehler) throw e;
      throw new HarmonieFehler(400, 'argument_ungueltig', (e as Error).message);
    }
    const neu = this.zusammen(this.eintraege, eintrag, takte.jetzt - 1);
    if (probe) return { ...this.antwort(neu, takte.jetzt, eintrag), ok: true, probe: true };
    this.eintraege = neu;
    this.veroeffentliche();
    return { ...this.antwort(neu, takte.jetzt, eintrag), ok: true };
  }

  // Entries in force plus the new one: same cycle replaces; entries that ended more than BEHALTE_TAKTE before now go (the last one stays)
  private zusammen(alt: LaneEintrag[], neu: LaneEintrag, jetztZyklus: number): LaneEintrag[] {
    const liste = [...alt.filter((e) => e.ab_zyklus !== neu.ab_zyklus), neu].sort((a, b) => a.ab_zyklus - b.ab_zyklus);
    return liste.filter((e, i) => i === liste.length - 1 || liste[i + 1].ab_zyklus >= jetztZyklus - BEHALTE_TAKTE);
  }

  private veroeffentliche(): void {
    const text = JSON.stringify({ eintraege: this.eintraege });
    for (const o of this.ordner()) {
      try { fs.mkdirSync(o, { recursive: true }); this.schreibe(path.join(o, HARMONIE_DATEI), text); } catch (e) { this.fehler(o, e as Error); }   // one broken folder must not stop the others
    }
  }

  private antwort(eintraege: LaneEintrag[], jetztTakt: number, gesetzt?: LaneEintrag): HarmonieAntwort {
    const z = jetztTakt - 1;
    const wirkt = [...eintraege].reverse().find((e) => e.ab_zyklus <= z) ?? null;
    const bei = akkordBei(eintraege, z) as { tonart: LaneEintrag['tonart']; akkord: { name: string } } | null;
    const zeige = gesetzt ?? wirkt ?? eintraege.find((e) => e.ab_zyklus > z) ?? null;   // before the first entry starts: show what is coming
    let wechsel: number | null = null;
    const spaeter = eintraege.find((e) => e.ab_zyklus > z);
    if (spaeter) wechsel = spaeter.ab_zyklus + 1;
    if (wirkt && wirkt.folge.length > 1) {
      const n = wirkt.ab_zyklus + (Math.floor((z - wirkt.ab_zyklus) / wirkt.takte_je_akkord) + 1) * wirkt.takte_je_akkord;
      if (wechsel === null || n + 1 < wechsel) wechsel = n + 1;
    }
    const aus = zeige !== null && zeige.folge.length === 0;
    return {
      tonart: zeige ? tonartName(zeige.tonart) : null,
      folge: zeige ? zeige.folge.map((a) => a.name) : [], takte_je_akkord: zeige && !aus ? zeige.takte_je_akkord : null,
      ab_takt: zeige ? zeige.ab_zyklus + 1 : null, jetzt: { takt: jetztTakt, akkord: bei ? bei.akkord.name : null }, naechster_wechsel_takt: wechsel,
      ...(aus ? { aus: true as const } : {}),
    };
  }

  // GET /harmonie and the `harmonie` of /lage: the entry in force (before the first one starts: the first); null while no entry exists
  lesen(takte: Takte): HarmonieAntwort | null { return this.eintraege.length ? this.antwort(this.eintraege, takte.jetzt) : null; }
}
