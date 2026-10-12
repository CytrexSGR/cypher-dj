// Effekt-Sektion Schritt 4 (Plan 2026-10-11-effekt-sektion.md): Automation je Loop. Sie liegt in loop.json (Feld
// `automation`) und kommt mit dem Loop in jede Box. Eine Spur ist ein Regler des Box-Kanals (relativ: `komp/schwelle`,
// `filter`, `eq/tief` …) mit Punkten [beat, wert], beat im Loop (0 ≤ beat < beats). Die Box spielt phasenstarr zum
// Master-Beat (kern/src/loopbox.cpp: Phase = fmod(beat, Länge)), ein Durchgang beginnt also auf jedem Vielfachen der
// Loop-Länge. Je Durchgang plant der Seitenserver lineare Fahrten von Punkt zu Punkt und vom letzten zurück zum ersten.
import fs from 'node:fs';
import path from 'node:path';

// Was eine Loop-Automation fahren darf, mit dem Bereich des Vertrags (§1.5); Fader und Schalter nicht (Fader öffnet die Box)
export const AUTO_BEREICH: Record<string, [number, number]> = {
  'komp/schwelle': [-60, 0], 'komp/ratio': [1, 20], 'komp/attack': [0.1, 100], 'komp/release': [10, 1000],
  'komp/makeup': [0, 24], 'komp/mix': [0, 1], filter: [-1, 1], 'eq/tief': [-26, 6], 'eq/mitte': [-26, 6], 'eq/hoch': [-26, 6],
  'send/2': [-60, 0],   // Hall-Send (Throws); −60 dB ist praktisch aus
};
// Länge einer Spur in Durchgängen des Loops (ein Build über 16 Takte auf einem 2-Takt-Loop: 8)
export const DURCHGAENGE = [1, 2, 4, 8, 16, 32];
export const MAX_PUNKTE = 64;

export interface AutoSpur { pfad: string; punkte: [number, number][]; durchgaenge?: number }
export interface AutoTeil { pfad: string; ab_beat: number; dauer_beats: number; nach: number }

export function pruefeAutomation(x: unknown, beats: number): { automation: AutoSpur[] } | { fehler: string } {
  if (!Array.isArray(x)) return { fehler: 'automation: list expected' };
  const gesehen = new Set<string>();
  const aus: AutoSpur[] = [];
  for (const [i, roh] of x.entries()) {
    const s = roh as AutoSpur;
    const wo = `automation[${i}]`;
    if (!s || typeof s.pfad !== 'string' || !(s.pfad in AUTO_BEREICH)) return { fehler: `${wo}.pfad: one of ${Object.keys(AUTO_BEREICH).join(', ')}` };
    if (gesehen.has(s.pfad)) return { fehler: `${wo}.pfad: ${s.pfad} twice` };
    gesehen.add(s.pfad);
    if (!Array.isArray(s.punkte) || s.punkte.length < 1 || s.punkte.length > MAX_PUNKTE) return { fehler: `${wo}.punkte: 1..${MAX_PUNKTE} points` };
    const d = s.durchgaenge ?? 1;
    if (!DURCHGAENGE.includes(d)) return { fehler: `${wo}.durchgaenge: one of ${DURCHGAENGE.join(', ')}` };
    const laenge = beats * d;
    const [lo, hi] = AUTO_BEREICH[s.pfad];
    let vorher = -1;
    for (const [j, p] of s.punkte.entries()) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return { fehler: `${wo}.punkte[${j}]: [beat, value]` };
      if (p[0] < 0 || p[0] >= laenge || p[0] <= vorher) return { fehler: `${wo}.punkte[${j}]: beat ascending in 0..${laenge}` };
      if (p[1] < lo || p[1] > hi) return { fehler: `${wo}.punkte[${j}]: value ${lo}..${hi}` };
      vorher = p[0];
    }
    aus.push({ pfad: s.pfad, punkte: s.punkte.map((p) => [p[0], p[1]] as [number, number]), ...(d > 1 ? { durchgaenge: d } : {}) });
  }
  return { automation: aus };
}

// Länge einer Spur in Beats (Loop-Länge mal Durchgänge); ihre Anfänge liegen auf Vielfachen davon, also auch auf Loop-Anfängen
export function spurLaenge(s: AutoSpur, beats: number): number { return beats * (s.durchgaenge ?? 1); }

// Fahrten eines Durchgangs ab Master-Beat c (Vielfaches von beats). Eine Spur mit einem Punkt setzt nur. erster = true:
// vorneweg ein Setzen auf den ersten Punkt (der Wert davor ist unbekannt); es steht in der Liste vor der Rampe am selben
// Beat (§17 I4: Setzen und Rampe am selben Beat nur mit kleinerer Nummer für das Setzen).
// Eine Spur über ihre Länge laenge (spurLaenge) ab Master-Beat c (Vielfaches von laenge)
export function planeSpur(s: AutoSpur, laenge: number, c: number, erster: boolean): AutoTeil[] {
  const aus: AutoTeil[] = [];
  const p = s.punkte;
  if (erster || p.length === 1) aus.push({ pfad: s.pfad, ab_beat: c + p[0][0], dauer_beats: 0, nach: p[0][1] });
  if (p.length === 1) return aus;
  for (let i = 0; i + 1 < p.length; i++) aus.push({ pfad: s.pfad, ab_beat: c + p[i][0], dauer_beats: p[i + 1][0] - p[i][0], nach: p[i + 1][1] });
  const letzt = p[p.length - 1];
  aus.push({ pfad: s.pfad, ab_beat: c + letzt[0], dauer_beats: laenge - letzt[0] + p[0][0], nach: p[0][1] });   // zurück zum Anfang
  return aus;
}
// Alle Spuren eines Loops über einen Durchgang (nur für Spuren mit Länge = Loop-Länge; Tests und Rückwärtsverträglichkeit)
export function planeDurchgang(auto: AutoSpur[], beats: number, c: number, erster: boolean): AutoTeil[] {
  return auto.flatMap((s) => planeSpur(s, spurLaenge(s, beats), c, erster));
}

// Nächster Durchgang, der jetzt zu planen ist: der nächste Anfang nach beat, sobald er höchstens vorlauf Beats entfernt
// ist und noch nicht geplant wurde; sonst null
export function naechsterDurchgang(beat: number, beats: number, geplantBis: number, vorlauf = 4): number | null {
  const c = Math.ceil(beat / beats - 1e-9) * beats;
  if (c <= geplantBis || c - beat > Math.max(vorlauf, 0)) return null;
  return c;
}

export function leseLoopAutomation(dir: string, name: string): AutoSpur[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, name, 'loop.json'), 'utf8')) as Record<string, unknown>;
    const beats = Number(j.beats);
    const r = pruefeAutomation(j.automation ?? [], beats);
    return 'fehler' in r ? [] : r.automation;
  } catch {
    return [];
  }
}
export function schreibeLoopAutomation(dir: string, name: string, auto: AutoSpur[]): void {
  const datei = path.join(dir, name, 'loop.json');
  const j = JSON.parse(fs.readFileSync(datei, 'utf8')) as Record<string, unknown>;
  if (auto.length) j.automation = auto;
  else delete j.automation;
  const tmp = `${datei}.${process.pid}.neu`;
  fs.writeFileSync(tmp, JSON.stringify(j));
  fs.renameSync(tmp, datei);
}
