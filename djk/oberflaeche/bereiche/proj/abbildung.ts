// Reine Abbildungen des Bereichs proj (Spec D1 2.3, 2.12, 3.4, 6.15): Grund → HTTP-Code, Projekt → Regler-Sollwerte, Regler-Ereignis →
// Befehl (Rückweg). Kein Server, kein Kern, keine Datei.
import { FADER_MAX, FADER_MIN, MAX_GRUPPEN, MAX_SPUREN, type Projekt, type Spur } from '../../projekt/modell.ts';
import type { Quelle } from '../../projekt/verlauf.ts';

// --- Gründe → HTTP ----------------------------------------------------------------------------------------------------
// Die Gründe sind die aus projekt/befehle.ts (Spec 4) plus die des Bereichs; die Seite zeigt für jeden einen Text.
const C400 = new Set(['argument_ungueltig', 'argument_unbekannt', 'befehl_unbekannt', 'sha_ungueltig', 'slug_ungueltig', 'name_ungueltig',
  'label_ungueltig', 'quelle_ungueltig', 'json', 'koerper_kein_objekt', 'beat_ungueltig', 'aktion_unbekannt']);
const C404 = new Set(['unbekannt', 'spur_unbekannt', 'clip_unbekannt', 'noten_unbekannt', 'sha_unbekannt', 'gruppe_unbekannt', 'ziel_unbekannt']);
export function grundCode(grund: string): number {
  if (C400.has(grund)) return 400;
  if (C404.has(grund)) return 404;
  if (grund === 'koerper_zu_gross') return 413;
  if (grund === 'katalog_fehlt') return 503;
  return 409;
}
// Gründe, die nur der Bereich vergibt (zusätzlich zu befehle.ts, verlauf.ts, ablage.ts): Liste für die Seite (V1/V2) und AUFRUF.md
export const BEREICH_GRUENDE: readonly string[] = ['kein_projekt', 'rev_veraltet', 'regler_abgelehnt', 'deck_laeuft', 'ki_gestoppt',
  'koerper_zu_gross', 'json', 'koerper_kein_objekt', 'katalog_fehlt', 'sha_unbekannt', 'nur_live', 'quelle_fehlt', 'beat_ungueltig',
  'aktion_unbekannt', 'tempo_abgelehnt', 'rampe_haengt', 'log_voraus', 'kein_kern', 'transport_laeuft', 'kein_tempo', 'warp_auto_neuer_clip'];

// --- Regler -----------------------------------------------------------------------------------------------------------
export interface Soll { pfad: string; wert: number }
// Spec 2.3: erz/4 neutral beim Öffnen. ziel und xseite sind „nur Hand“ (SCHNITTSTELLEN §1.5), doch der Kern lehnt nur_hand nur bei Quelle
// cypher ab (einsortieren.cpp:38): bei Quelle andreas gehören sie in die Sollliste (P6, erz4Soll), bei Quelle cypher meldet der Server
// nur, wenn sie bekannt anders stehen (ERZ4_NUR_HAND).
export const ERZ4_NEUTRAL: readonly Soll[] = [
  { pfad: 'erz/4/fader', wert: 0 }, { pfad: 'erz/4/trim', wert: 0 },
  { pfad: 'erz/4/eq/tief', wert: 0 }, { pfad: 'erz/4/eq/mitte', wert: 0 }, { pfad: 'erz/4/eq/hoch', wert: 0 },
  { pfad: 'erz/4/kill/tief', wert: 0 }, { pfad: 'erz/4/kill/mitte', wert: 0 }, { pfad: 'erz/4/kill/hoch', wert: 0 },
  { pfad: 'erz/4/filter', wert: 0 }, { pfad: 'erz/4/komp/an', wert: 0 },
  { pfad: 'erz/4/send/1', wert: -200 }, { pfad: 'erz/4/send/2', wert: -200 }, { pfad: 'erz/4/send/3', wert: -200 }, { pfad: 'erz/4/send/4', wert: -200 },
];
export const ERZ4_NUR_HAND: readonly Soll[] = [{ pfad: 'erz/4/ziel', wert: 0 }, { pfad: 'erz/4/xseite', wert: 1 }];
export const erz4Soll = (quelle: Quelle): Soll[] => (quelle === 'andreas' ? [...ERZ4_NEUTRAL, ...ERZ4_NUR_HAND] : [...ERZ4_NEUTRAL]);

const FELD = { fader: 'fader_db', pan: 'pan', mute: 'mute', solo: 'solo' } as const;
const werteVon = (s: Spur | undefined): Record<keyof typeof FELD, number> => ({
  fader: s ? s.fader_db : 0, pan: s ? s.pan : 0, mute: s?.mute ? 1 : 0, solo: s?.solo ? 1 : 0 });
// Alle 4 · MAX_SPUREN Spur-Regler (Spec 3.4: „alle Spur-Regler“): belegte Slots mit den Werten der Spur, freie mit der Vorgabe (0 dB, Mitte, aus).
export function alleSpurRegler(p: Projekt): Soll[] {
  const aus: Soll[] = [];
  for (let n = 1; n <= MAX_SPUREN; n++) {
    const w = werteVon(p.spuren.find((s) => s.nr === n));
    for (const k of Object.keys(FELD) as (keyof typeof FELD)[]) aus.push({ pfad: `spur/${n}/${k}`, wert: w[k] });
  }
  return aus;
}

// 1.10: alle 4 · MAX_GRUPPEN Gruppen-Regler (freie Slots mit der Vorgabe) und der PM-Fader
export function alleGruppenRegler(p: Projekt): Soll[] {
  const aus: Soll[] = [];
  for (let n = 1; n <= MAX_GRUPPEN; n++) {
    const g = (p.gruppen ?? []).find((x) => x.nr === n);
    const w = { fader: g ? g.fader_db : 0, pan: g ? g.pan : 0, mute: g?.mute ? 1 : 0, solo: g?.solo ? 1 : 0 };
    for (const k of Object.keys(FELD) as (keyof typeof FELD)[]) aus.push({ pfad: `grp/${n}/${k}`, wert: w[k] });
  }
  return aus;
}
export const alleRegler = (p: Projekt): Soll[] => [...alleSpurRegler(p), ...alleGruppenRegler(p), { pfad: 'pm/fader', wert: p.master?.fader_db ?? 0 }];

// Rückweg (Spec 3.4): /e/regler spur/<n>/<feld> mit Halter mensch → Befehl spur_aendern, oder null (keine Spur auf n, Wert schon da)
const REGLER_PFAD = /^spur\/([1-9][0-9]?)\/(fader|pan|mute|solo)$/;
const GRUPPEN_PFAD = /^grp\/([1-8])\/(fader|pan|mute|solo)$/;
const klemme = (k: keyof typeof FELD, wert: number): number | boolean => (k === 'mute' || k === 'solo' ? wert >= 0.5
  : k === 'fader' ? Math.min(FADER_MAX, Math.max(FADER_MIN, wert)) : Math.min(1, Math.max(-1, wert)));
export function reglerZuBefehl(p: Projekt, pfad: string, wert: number): { befehl: Record<string, unknown>; label: string } | null {
  if (pfad === 'pm/fader') {
    if (!Number.isFinite(wert)) return null;
    const w = Math.min(FADER_MAX, Math.max(FADER_MIN, wert));
    return (p.master?.fader_db ?? 0) === w ? null : { befehl: { befehl: 'master_aendern', fader_db: w }, label: 'Mixer: Master fader' };
  }
  const gm = GRUPPEN_PFAD.exec(pfad);
  if (gm) {
    const g = (p.gruppen ?? []).find((x) => x.nr === Number(gm[1]));
    if (!g || !Number.isFinite(wert)) return null;
    const k = gm[2] as keyof typeof FELD, feld = FELD[k], w = klemme(k, wert);
    return g[feld] === w ? null : { befehl: { befehl: 'gruppenspur_aendern', gruppe_id: g.id, [feld]: w }, label: `Mixer: ${g.name} ${k}` };
  }
  const m = REGLER_PFAD.exec(pfad);
  if (!m || Number(m[1]) > MAX_SPUREN || !Number.isFinite(wert)) return null;
  const s = p.spuren.find((x) => x.nr === Number(m[1]));
  if (!s) return null;
  const k = m[2] as keyof typeof FELD, feld = FELD[k];
  const w: number | boolean = k === 'mute' || k === 'solo' ? wert >= 0.5
    : k === 'fader' ? Math.min(FADER_MAX, Math.max(FADER_MIN, wert)) : Math.min(1, Math.max(-1, wert));
  if (s[feld] === w) return null;
  return { befehl: { befehl: 'spur_aendern', spur_id: s.id, [feld]: w }, label: `Mixer: ${s.name} ${k}` };
}
export const istSpurRegler = (pfad: string): boolean => REGLER_PFAD.test(pfad);
export const istMixerRegler = (pfad: string): boolean => REGLER_PFAD.test(pfad) || GRUPPEN_PFAD.test(pfad) || pfad === 'pm/fader';
