// Paket 1.13 Warp, Slice 3a: Analyse auf Abruf. Teil 1 (Task 11): der Adapter auf den Vorbereiter (Kindprozess werkstatt.einzeln --nur-analyse,
// Ablage statt Bestand). Teil 2 (Task 12): der Verwalter AnalyseListe (ein Auftrag je sha256, Wünsche je Clip, Schlange).
import path from 'node:path';
import { Vorbereiter, type VorbereitStand } from '../../mediathek.ts';
import type { Warp } from '../../projekt/modell.ts';

export interface AnalyseEnde { ok: boolean; grund?: string }
export interface AnalyseStarter {
  // gestartet: ein Lauf für diese sha beginnt; laeuft: einer besteht schon (fertig kommt auch zu diesem Rückruf); ausgelastet: kein Platz, nichts gestartet
  starte(sha: string, pfad: string, fertig: (e: AnalyseEnde) => void): 'gestartet' | 'laeuft' | 'ausgelastet';
  stoppe(): void;
}

// T9: eine Analyse zugleich (der Nachtlauf und die Schwester teilen die Maschine), nice 19 / ionice 3 (Vorbereiter), Zeitlimit 10 Minuten
// (Median 29 s, p90 46 s, Maximum 202 s im Nachtlauf, E-W 3). Schlüssel des Vorbereiters ist die Material-ID (sha[:16]); die Gegenprobe der
// vollen sha macht der Leser (leseKarte).
export class WerkstattAnalyse implements AnalyseStarter {
  private readonly rueckrufe = new Map<string, ((e: AnalyseEnde) => void)[]>();
  private readonly v: Vorbereiter;
  constructor(o: { python: string; cwd: string; ablage: string; modul?: string; zeitlimitMs?: number; maxGleichzeitig?: number;
    log?: (z: Record<string, unknown>) => void }) {
    this.v = new Vorbereiter({ python: o.python, cwd: o.cwd, bestand: o.ablage, modul: o.modul, zusatzArgs: ['--nur-analyse'],
      maxGleichzeitig: o.maxGleichzeitig ?? 1, zeitlimitMs: o.zeitlimitMs ?? 10 * 60_000, log: o.log, bei: (mid, st) => this.ende(mid, st) });
  }
  starte(sha: string, pfad: string, fertig: (e: AnalyseEnde) => void): 'gestartet' | 'laeuft' | 'ausgelastet' {
    const mid = sha.slice(0, 16);
    const r = this.v.starte(mid, pfad, path.parse(pfad).name);   // der Titel steht nur im material.json; wie der Nachtlauf: der Dateiname
    if (r === 'ausgelastet') return r;
    const liste = this.rueckrufe.get(mid) ?? [];
    liste.push(fertig);
    this.rueckrufe.set(mid, liste);
    return r;
  }
  stoppe(): void { this.v.stoppe(); this.rueckrufe.clear(); }
  private ende(mid: string, st: VorbereitStand): void {
    const liste = this.rueckrufe.get(mid) ?? [];
    this.rueckrufe.delete(mid);
    const e: AnalyseEnde = st.status === 'analysiert' || st.status === 'vorhanden' ? { ok: true } : { ok: false, grund: st.grund ?? 'unbekannt' };
    for (const f of liste) f(e);
  }
}

// --- Teil 2: der Verwalter ----------------------------------------------------------------------------------------------------------------------------
// Ein Auftrag je sha256 (nicht je Material-ID: 16 Hex sind mehrdeutig, E-S 2). Wünsche: welche Clips (je Projekt und Clip-ID) auf die Karte
// warten, mit dem Stand beim Auftrag (für „unangefasst“, T11) und der Quelle des Auslösers (T10: der Verlaufseintrag der Ankunft trägt sie).
// Ein Lauf zugleich (Starter), weitere warten in der Schlange.
// Anforderung: was loeseQuellenAuf vor dem Schreiben festhält; clip_id fehlt bei clip_neu (die ID entsteht erst beim Schreiben).
export interface Anforderung { sha: string; pfad: string; clip_id?: string }
export interface Wunsch { slug: string; clip_id: string; quelle: 'andreas' | 'cypher'; vorher: Warp | null; laenge_beats: number }
export interface AnalyseEintrag { sha: string; pfad: string; wuensche: Wunsch[]; status: 'wartet' | 'laeuft' }

export class AnalyseListe {
  private readonly eintraege = new Map<string, AnalyseEintrag>();
  private readonly schlange: string[] = [];
  private readonly starter: AnalyseStarter;
  private readonly bei: (sha: string, e: AnalyseEintrag, ende: AnalyseEnde) => void;
  private readonly meldung: (w: Wunsch, status: 'wartet' | 'laeuft') => void;
  // Keine Parameter-Properties (constructor(private readonly x ...)): node lädt die .ts-Dateien im Strip-Modus, der sie nicht kennt
  // (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). Felder deklarieren und im Rumpf zuweisen.
  constructor(starter: AnalyseStarter, bei: (sha: string, e: AnalyseEintrag, ende: AnalyseEnde) => void,
    meldung: (w: Wunsch, status: 'wartet' | 'laeuft') => void) {
    this.starter = starter;
    this.bei = bei;
    this.meldung = meldung;
  }

  laeuft(sha: string): boolean { return this.eintraege.has(sha); }
  anfordern(sha: string, pfad: string, w: Wunsch): 'neu' | 'dabei' {
    const e = this.eintraege.get(sha);
    if (e) {
      const i = e.wuensche.findIndex((x) => x.slug === w.slug && x.clip_id === w.clip_id);
      if (i >= 0) e.wuensche[i] = w; else e.wuensche.push(w);
      this.meldung(w, e.status);
      return 'dabei';
    }
    this.eintraege.set(sha, { sha, pfad, wuensche: [w], status: 'wartet' });
    this.schlange.push(sha);
    this.meldung(w, 'wartet');
    this.versuche();
    return 'neu';
  }
  stand(slug: string): { clip_id: string; status: 'wartet' | 'laeuft' }[] {
    const aus: { clip_id: string; status: 'wartet' | 'laeuft' }[] = [];
    for (const e of this.eintraege.values()) for (const w of e.wuensche) if (w.slug === slug) aus.push({ clip_id: w.clip_id, status: e.status });
    return aus;
  }
  stoppe(): void { this.schlange.length = 0; this.eintraege.clear(); this.starter.stoppe(); }

  private versuche(): void {
    while (this.schlange.length > 0) {
      const sha = this.schlange[0], e = this.eintraege.get(sha);
      if (!e) { this.schlange.shift(); continue; }
      e.status = 'laeuft';
      const r = this.starter.starte(sha, e.pfad, (ende) => this.ende(sha, ende));
      if (r === 'ausgelastet') { e.status = 'wartet'; return; }
      if (this.schlange[0] === sha) this.schlange.shift();            // ein synchrones Ende hat sie schon entfernt
      if (this.eintraege.has(sha)) for (const w of e.wuensche) this.meldung(w, 'laeuft');
    }
  }
  private ende(sha: string, ende: AnalyseEnde): void {
    const e = this.eintraege.get(sha);
    if (!e) return;
    this.eintraege.delete(sha);
    const i = this.schlange.indexOf(sha);
    if (i >= 0) this.schlange.splice(i, 1);
    try { this.bei(sha, e, ende); } finally { this.versuche(); }
  }
}
