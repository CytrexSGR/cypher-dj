// djk/oberflaeche/anschluss.ts
// Anschluss-Vorauswahl (Plan 2026-10-10-anschluss-vorauswahl, T1): welcher Track passt auf den laufenden?
// Reine Funktionen. Gewichte nach Andreas' Hörtest 2026-10-10 (Tempo zuerst, Energie nur in drei Klassen).
// Camelot-Züge aus Plan 2026-10-10-tonart-referenz, Slice 5.

export type EnergieWunsch = 'halten' | 'heben' | 'senken';
export interface Merkmale { bpm: number | null; camelot: string | null; energie: number | null; genre: string | null }
export interface Bewertung { punkte: number; zug: string | null; gruende: string[] }

const GEWICHT = { tempo: 0.35, genre: 0.25, key: 0.25, energie: 0.15 };
const KLASSE = ['niedrig', 'mittel', 'hoch'];

function lies(c: string | null): { n: number; b: 'A' | 'B' } | null {
  const m = /^\s*(\d{1,2})\s*([AaBb])\s*$/.exec(c ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? { n, b: m[2].toUpperCase() as 'A' | 'B' } : null;
}

// undefined = einer unbekannt (zählt mit 0,3), null = kein erlaubter Zug (raus)
export function camelotZug(von: string | null, nach: string | null, wunsch: EnergieWunsch): { zug: string; punkte: number } | null | undefined {
  const a = lies(von), b = lies(nach);
  if (!a || !b) return undefined;
  let d = (b.n - a.n + 12) % 12;
  if (d > 6) d -= 12;
  if (a.b === b.b) {
    if (d === 0) return { zug: 'gleich', punkte: 1 };
    if (d === 1 || d === -1) return { zug: 'nachbar', punkte: 0.9 };
    if (d === 2) return { zug: 'boost', punkte: 0.5 };
    if (d === -2) return { zug: 'absenken', punkte: 0.45 };
    if (d === -5 && wunsch === 'heben') return { zug: 'halbton', punkte: 0.3 };
    return null;
  }
  if (d === 0) return { zug: 'parallele', punkte: 0.85 };
  if ((a.b === 'A' && d === -1) || (a.b === 'B' && d === 1)) return { zug: 'diagonale', punkte: 0.75 };
  return null;
}

export function energieKlasse(e: number | null): number | null {
  if (e === null || !Number.isFinite(e)) return null;
  return e <= 5 ? 0 : e <= 7 ? 1 : 2;
}

export function genreNaehe(a: string | null, b: string | null): number {
  if (!a || !b) return 0.5;
  const x = a.toLowerCase().trim(), y = b.toLowerCase().trim();
  if (x === y) return 1;
  // kompakte Form: nur Buchstaben/Ziffern (Unicode), damit "TechHouse" = "Tech House" und "HipHop" in "Hip-Hop/Rap" steckt
  const kompakt = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '');
  const kx = kompakt(x), ky = kompakt(y);
  if (kx && kx === ky) return 1;
  const [kurz, lang] = kx.length <= ky.length ? [kx, ky] : [ky, kx];
  if (kurz.length >= 4 && lang.includes(kurz)) return 0.6;
  const woerter = (s: string) => new Set(s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));
  const wy = woerter(y);
  return [...woerter(x)].some((w) => wy.has(w)) ? 0.6 : 0.2;
}

// Jeder Wunsch außer 'halten' und 'heben' fällt hier auf 'senken'; die Route validiert den Wunsch (Task 3).
function energiePunkte(von: number | null, nach: number | null, wunsch: EnergieWunsch): number {
  if (von === null || nach === null) return 0.5;
  const d = nach - von;
  if (wunsch === 'halten') return d === 0 ? 1 : Math.abs(d) === 1 ? 0.5 : 0;
  if (wunsch === 'heben') return d === 1 ? 1 : d === 0 ? 0.6 : d > 1 ? 0.5 : 0;
  return d === -1 ? 1 : d === 0 ? 0.6 : d < -1 ? 0.5 : 0;
}

export function bewerte(lauf: Merkmale, k: Merkmale, opt: { fenster: number; energie: EnergieWunsch }): Bewertung | null {
  // BPM <= 0 oder nicht endlich gilt auf beiden Seiten als unbekannt (tempo 0,3), nie als raus (Mediathek: 18 Reggae-Werke mit BPM 0)
  const gueltig = (n: number | null) => n !== null && Number.isFinite(n) && n > 0;
  const tempoBekannt = gueltig(lauf.bpm) && gueltig(k.bpm);
  const abw = tempoBekannt ? Math.abs(k.bpm! - lauf.bpm!) / lauf.bpm! * 100 : 0;
  if (abw > opt.fenster + 1e-9) return null; // Grenze einschließlich (128→135,68 ergibt 6,000000000000005)
  const zug = camelotZug(lauf.camelot, k.camelot, opt.energie);
  if (zug === null) return null;
  const ev = energieKlasse(lauf.energie), ek = energieKlasse(k.energie);
  // Halbton nur mit steigendem Energy Level (Slice 5); bei unbekannter Energie bleibt er erlaubt
  if (zug && zug.zug === 'halbton' && ev !== null && ek !== null && ek <= ev) return null;
  const g = genreNaehe(lauf.genre, k.genre);
  const summe = GEWICHT.tempo * (tempoBekannt ? 1 - abw / opt.fenster : 0.3) + GEWICHT.genre * g + GEWICHT.key * (zug ? zug.punkte : 0.3)
    + GEWICHT.energie * energiePunkte(ev, ek, opt.energie);
  const zahl = (n: number) => String(Math.round(n * 10) / 10);
  return {
    punkte: Math.round(summe * 1000) / 1000,
    zug: zug ? zug.zug : null,
    gruende: [
      tempoBekannt ? `tempo ${zahl(lauf.bpm!)}→${zahl(k.bpm!)}` : 'tempo unbekannt',
      g === 1 ? 'genre gleich' : g === 0.6 ? 'genre verwandt' : g === 0.5 ? 'genre unbekannt' : 'genre anders',
      zug ? `key ${lauf.camelot!.toUpperCase()}→${k.camelot!.toUpperCase()} ${zug.zug}` : 'key unbekannt',
      ev === null || ek === null ? 'energie unbekannt' : `energie ${KLASSE[ev]}→${KLASSE[ek]}`,
    ],
  };
}
