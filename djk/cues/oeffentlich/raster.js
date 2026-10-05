// Taktraster aus TBPM und einer Takt-Eins (eins_s). Geteilt von Seite und Server (dieselbe Rechnung beim Setzen und
// beim Speichern). Zählweise wie SCHNITTSTELLEN §1.1: quell_beat 0 = erster Schlag des Rasters in der Datei (>= 0 s),
// erste_eins_quell_beat 0..3 = Lage der ersten Takt-Eins. Takt 1 beginnt an der ersten Takt-Eins in der Datei.
export const SCHLAEGE_JE_TAKT = 4;
export const TAKTE_JE_PHRASE = 16;
const EPS = 1e-3; // Schläge: 1/1000 Schlag (< 0,5 ms bei 120 BPM) gilt als auf dem Raster

export function schlagS(r) { return 60 / r.bpm; }
export function taktS(r) { return SCHLAEGE_JE_TAKT * 60 / r.bpm; }

// Erste Takt-Eins in der Datei (>= 0 s), gleichwertig zu eins_s
export function ersteEinsS(r) { const t = taktS(r); return r.eins_s - Math.floor(r.eins_s / t + EPS) * t; }
// Erster Schlag des Rasters (>= 0 s)
export function ersterSchlagS(r) { const b = schlagS(r); return r.eins_s - Math.floor(r.eins_s / b + EPS) * b; }
export function ersteEinsQuellBeat(r) { return Math.round((ersteEinsS(r) - ersterSchlagS(r)) / schlagS(r)); }

export function quellBeat(r, s) { return (s - ersterSchlagS(r)) / schlagS(r); }

// Takt (1 = erste Takt-Eins) und Schlag (1..4) an Sekunde s; Positionen vor Takt 1 haben Takt <= 0
export function taktSchlag(r, s) {
  const rel = (s - ersteEinsS(r)) / schlagS(r);
  const ganz = Math.floor(rel + EPS);
  const takt = Math.floor(ganz / SCHLAEGE_JE_TAKT) + 1;
  const schlag = ganz - (takt - 1) * SCHLAEGE_JE_TAKT + 1;
  const rest = Math.abs(rel - Math.round(rel)) < EPS ? 0 : rel - ganz;
  return { takt, schlag, bruch: rest };
}

// Nächste Takt-Eins zu s (gerundet), innerhalb [0, dauer]
export function naechsterTakt(r, s, dauer = Infinity) {
  const t = taktS(r);
  const e = ersteEinsS(r);
  let k = Math.round((s - e) / t);
  let x = e + k * t;
  if (x < -0.005) x += t; // Eins knapp vor 0 (Rundung) zählt als 0
  if (x > dauer) x -= t;
  return Math.max(0, x);
}

// Setzposition eines Hotcues: quantisiert an der nächsten Takt-Eins, sonst genau s
export function cuePosition(r, s, quantisiert, dauer = Infinity) {
  if (!quantisiert || !r || !(r.bpm > 0)) return Math.min(Math.max(0, s), dauer);
  return naechsterTakt(r, s, dauer);
}

// Sprung um n Takte, Phase bleibt (wie beat jump am Pult)
export function springe(r, s, takte, dauer) {
  const x = s + takte * taktS(r);
  return Math.min(Math.max(0, x), Math.max(0, dauer - 0.01));
}

// Vollständiger Cue-Eintrag nach Schema djk.cues/1 (ohne Zeitstempel)
export function cueFelder(r, s) {
  const ts = taktSchlag(r, s);
  return { s: rund(s, 6), quell_beat: rund(quellBeat(r, s), 4), takt: ts.takt, schlag: ts.schlag };
}

export function rasterFelder(r) {
  return { bpm: r.bpm, eins_s: rund(r.eins_s, 6), erste_eins_s: rund(ersteEinsS(r), 6), erster_schlag_s: rund(ersterSchlagS(r), 6),
    erste_eins_quell_beat: ersteEinsQuellBeat(r), quelle: r.quelle ?? 'andreas' };
}

function rund(x, n) { const f = 10 ** n; return Math.round(x * f) / f; }

// ---------- Loops (Andreas, 2026-09-26: "L 4 takte, shift+L 8, alt+L 16 takte") ----------
// Erlaubte Loop-Längen in Takten. L/Shift+L/Alt+L in der Seite nutzen nur 4/8/16; 1/2/32 sind für die
// Traktor-Übernahme (naechsteLoopLaenge) und künftige Bedienung vorgesehen.
export const LAENGEN_TAKTE = [1, 2, 4, 8, 16, 32];

export function loopLaengeS(r, takte) { return takte * taktS(r); }
export function loopEndeS(r, s, takte) { return s + loopLaengeS(r, takte); }

// Nächstgelegene erlaubte Loop-Länge zu einer gemessenen (nicht notwendig ganzzahligen) Taktzahl, im log2-Raum
// gerundet: 3 Takte liegen näher an 4 als an 2, 6 näher an 4 als an 8.
export function naechsteLoopLaenge(takteExakt) {
  let beste = LAENGEN_TAKTE[0]; let bestAbstand = Infinity;
  for (const l of LAENGEN_TAKTE) {
    const a = Math.abs(Math.log2(l) - Math.log2(Math.max(takteExakt, 1e-9)));
    if (a < bestAbstand) { bestAbstand = a; beste = l; }
  }
  return beste;
}

// Zusätzliche Loop-Felder (ende_s, ende_takt) für Schema djk.cues/1, analog zu cueFelder
export function loopFelder(r, s, takte) {
  const ende = loopEndeS(r, s, takte);
  return { ende_s: rund(ende, 6), ende_takt: taktSchlag(r, ende).takt };
}
