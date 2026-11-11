// strudel-clip: the events of a Strudel pattern (generator/src/pattern_ereignisse.mjs) become the notes and envelopes of a MIDI clip on a given track.
// Pure: no Strudel, no file except the mapping table, no clock. The command clip_aus_muster (commands.ts) calls it; the Strudel side runs in a child process
// (areas/proj/pattern_run.ts). Spec: docs/superpowers/specs/2026-11-10-strudel-clip.md.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { HK_BEREICH, hkZielErlaubt, type Huellkurve } from './envelope.ts';
import { rbNorm } from './rb_mapping.ts';
import { MAX_LANE_PUNKTE, type MidiClip, type Spur } from './model.ts';
import type { Punkt } from './lane.ts';

// --- what the Strudel side delivers -------------------------------------------------------------------------------------------------
export interface MusterEreignis { beat: number; laenge: number; ton: number | null; werte: Record<string, number | string | boolean> }
export interface MusterErgebnis {
  ok: true; takte: number; laenge_beats: number; loop_beats: number | null; periode_takte: number | null;
  ereignisse: MusterEreignis[]; stetig: string[]; komplex: string[]; hinweise: string[];
}
export interface MusterFehlschlag { ok: false; grund: string; fehler: string }
export interface KitKlang { note: number; name: string }

// --- the mapping table (muster_zuordnung.json) --------------------------------------------------------------------------------------
export type Umrechnung =
  | { art: 'rb_norm'; parameter: string }
  | { art: 'linear'; von: [number, number]; nach: [number, number] }
  | { art: 'gain_db'; min_db: number };
export interface Zuordnung { ziel: string; umrechnung: Umrechnung; basis?: 'spur'; basis_ziel?: string; nur_stetig?: boolean }
export interface Tabelle { schema: 1; felder: Record<string, Zuordnung> }

let tabelleGeladen: Tabelle | null = null;
export function ladeZuordnung(): Tabelle {
  if (!tabelleGeladen) tabelleGeladen = JSON.parse(fs.readFileSync(new URL('./muster_zuordnung.json', import.meta.url), 'utf8')) as Tabelle;
  return tabelleGeladen;
}

// --- result -----------------------------------------------------------------------------------------------------------------------------
export interface MusterNote { beat: number; laenge: number; ton: number; vel: number }
export interface MusterClip {
  noten: MusterNote[]; huellkurven: Huellkurve[]; ohne_ziel: string[]; hinweise: string[];
}
export interface MusterAblehnung { grund: string; text: string }

const MIN_LAENGE = 1 / 64;
const runde6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const klemme = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const zahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function umrechnen(u: Umrechnung, v: number): number {
  if (u.art === 'rb_norm') return rbNorm(u.parameter, v);
  if (u.art === 'linear') {
    const [a, b] = u.von, [c, d] = u.nach;
    return klemme(c + ((v - a) / (b - a)) * (d - c), Math.min(c, d), Math.max(c, d));
  }
  return v <= 0 ? u.min_db : Math.max(u.min_db, 20 * Math.log10(v));
}

// The names of a kit as Strudel writes them: bank ("bd") and number inside the bank; n runs in the ring of the bank like in the erzeuger (kit.mjs noteFuer).
function kitBaenke(klaenge: readonly KitKlang[]): Map<string, KitKlang[]> {
  const baenke = new Map<string, KitKlang[]>();
  for (const k of klaenge) {
    const s = k.name.split(':')[0];
    baenke.set(s, [...(baenke.get(s) ?? []), k]);
  }
  for (const l of baenke.values()) l.sort((a, b) => Number(a.name.split(':')[1] ?? 0) - Number(b.name.split(':')[1] ?? 0));
  return baenke;
}
const baenkeText = (b: Map<string, KitKlang[]>): string =>
  [...b.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([s, l]) => (l.length === 1 ? s : `${s}:0-${l.length - 1}`)).join(', ');

/** what the track is: a kit (klaenge given) or a pitched instrument */
export function wendeMusterAn(erg: MusterErgebnis, spur: Spur, klaenge: readonly KitKlang[] | null, kitName: string | null,
  basisWert: (ziel: string) => number, tabelle: Tabelle = ladeZuordnung()): MusterClip | MusterAblehnung {
  const hinweise = [...erg.hinweise];
  const ohne = new Set<string>(erg.komplex);
  const kit = klaenge !== null;
  const stetig = new Set(erg.stetig);
  const quellEnde = erg.loop_beats ?? erg.laenge_beats;

  // which Strudel fields the notes consume; the rest goes through the table or into ohne_ziel
  const verbraucht = new Set<string>(kit ? ['s', 'n', 'velocity', 'gain', 'clip'] : ['note', 'n', 'freq', 'velocity', 'gain', 'clip']);
  const gainAlsKurve = stetig.has('gain') && tabelle.felder.gain !== undefined && tabelle.felder.gain.nur_stetig === true;
  if (gainAlsKurve) verbraucht.delete('gain');

  const noten: MusterNote[] = [];
  let verworfen = 0;
  if (kit) {
    const baenke = kitBaenke(klaenge!);
    const fehlend = new Set<string>();
    for (const e of erg.ereignisse) {
      const s = e.werte.s;
      if (typeof s !== 'string') {
        return {
          grund: 'muster_ziel_passt_nicht',
          text: `kit track ${kitName ?? ''}: the pattern has events without a sound name `
            + '(use s("bd hh") on a kit track; note() and n() alone have nothing to play)',
        };
      }
      if (!baenke.has(s)) fehlend.add(s);
    }
    if (fehlend.size) {
      const namen = [...fehlend].map((x) => `"${x}"`).join(', ');
      return {
        grund: 'klang_unbekannt',
        text: `sound ${namen} is not in kit ${kitName}; the kit has: ${baenkeText(baenke)} (write bd, or bd:2 for the third of the bank)`,
      };
    }
    for (const e of erg.ereignisse) {
      const bank = baenke.get(e.werte.s as string)!;
      const n = Math.max(0, Math.floor(Number(e.werte.n ?? 0)) || 0) % bank.length;
      // like the erzeuger on a kit target (planner.mjs)
      const g = !gainAlsKurve && zahl(e.werte.gain) ? e.werte.gain : zahl(e.werte.velocity) ? e.werte.velocity : 1;
      noten.push({ beat: e.beat, laenge: e.laenge * (zahl(e.werte.clip) ? e.werte.clip : 1), ton: bank[n].note, vel: g });
    }
  } else {
    for (const e of erg.ereignisse) {
      if (e.ton === null) {
        if (typeof e.werte.s === 'string' && e.werte.note === undefined && e.werte.freq === undefined) {
          return {
            grund: 'muster_ziel_passt_nicht',
            text: `the pattern plays sounds (s("${e.werte.s}")) without notes; an instrument track needs note(...) or `
              + 'n(...).scale(...), or put the pattern on a kit track',
          };
        }
        verworfen += 1;
        continue;
      }
      // like the studio's MIDI path (Strudel midi.mjs): velocity (0.9) times gain
      const v = zahl(e.werte.velocity) ? e.werte.velocity : 0.9;
      const g = !gainAlsKurve && zahl(e.werte.gain) ? e.werte.gain : 1;
      noten.push({ beat: e.beat, laenge: e.laenge * (zahl(e.werte.clip) ? e.werte.clip : 1), ton: e.ton, vel: v * g });
    }
  }
  if (verworfen) hinweise.push(`${verworfen} event(s) dropped: no MIDI note 0..127`);
  for (const n of noten) {
    n.vel = klemme(Math.round(n.vel * 127), 1, 127);
    n.laenge = runde6(Math.max(MIN_LAENGE, Math.min(n.laenge, quellEnde - n.beat)));
  }

  // envelopes: every numeric field the notes do not consume
  const felder = new Set<string>();
  for (const e of erg.ereignisse) for (const k of Object.keys(e.werte)) if (!verbraucht.has(k)) felder.add(k);
  const huellkurven: Huellkurve[] = [];
  const belegt = new Set<string>();
  for (const feld of [...felder].sort()) {
    const z = tabelle.felder[feld];
    if (!z || (z.nur_stetig && !stetig.has(feld))) { ohne.add(feld); continue; }
    if (!hkZielErlaubt(z.ziel, { art: 'midi', laenge_beats: erg.laenge_beats }, spur)) {
      ohne.add(feld);
      hinweise.push(`${feld} has the target ${z.ziel}, which this track does not have (RB-338 tracks only)`);
      continue;
    }
    if (belegt.has(z.ziel)) { ohne.add(feld); hinweise.push(`${feld}: the target ${z.ziel} is already taken by another field`); continue; }
    const basis = z.basis === 'spur' ? basisWert(z.basis_ziel ?? z.ziel) : 0;
    const { min, max } = HK_BEREICH(z.ziel);
    const punkte: Punkt[] = [];
    let konflikte = 0;
    for (const e of erg.ereignisse) {
      const w = e.werte[feld];
      if (w === undefined) continue;
      if (!zahl(w)) { ohne.add(feld); punkte.length = 0; break; }
      const wert = runde6(klemme(umrechnen(z.umrechnung, w) - basis, min, max));
      const letzter = punkte[punkte.length - 1];
      if (letzter && letzter.beat === e.beat) { if (letzter.wert !== wert) konflikte += 1; continue; }
      punkte.push(stetig.has(feld) || punkte.length === 0 ? { beat: e.beat, wert } : { beat: e.beat, wert, form: 'sprung' });
    }
    if (konflikte) hinweise.push(`${feld}: ${konflikte} event(s) share a beat with a different value, the first value is kept`);
    if (!punkte.length) { ohne.add(feld); continue; }
    if (punkte.length > MAX_LANE_PUNKTE) return { grund: 'zu_gross', text: `${feld}: ${punkte.length} envelope points, at most ${MAX_LANE_PUNKTE}` };
    belegt.add(z.ziel);
    huellkurven.push({ ziel: z.ziel, punkte });
  }
  return { noten, huellkurven, ohne_ziel: [...ohne].sort(), hinweise };
}

// --- hand work -----------------------------------------------------------------------------------------------------------------------------
const kanon = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(kanon);
  if (x !== null && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, kanon((x as Record<string, unknown>)[k])]));
  return x;
};
/** Fingerprint of what a clip plays and automates (notes without their ids, envelopes): stored when a pattern makes the clip, compared before the next run. */
export function musterAbdruck(clip: Pick<MidiClip, 'noten' | 'huellkurven'>): string {
  const noten = clip.noten.map((n) => [n.beat, n.laenge, n.ton, n.vel]).sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1] || a[3] - b[3]);
  return createHash('sha256').update(JSON.stringify([noten, kanon(clip.huellkurven ?? [])])).digest('hex').slice(0, 32);
}
