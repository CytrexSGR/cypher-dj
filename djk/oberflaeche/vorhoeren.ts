// Vorhören im Browser als Kern-Eingang (Plan 2026-10-10-mediathek-browser, S7). Der Vorhörer (djk/vorhoerer) spielt die
// Datei und speist rueck_erz_8 des Kerns; erz/8 ist im Mixer Nur-Cue (Task 7.1): PFL fest an, nie Master. Damit wirken
// cue/mix und cue/pegel am Kopfhörer (FiiO KA11, docs/architecture/stand/kopfhoerer-cue.md). Ohne Kopfhörer-Kante am
// Cue des Kerns: 409, nichts wird gestartet.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { VorhoererKlient } from '../cues/vorhoerer-klient.ts';
import { vorhoererPort } from '../cues/osc.ts';

const lauf = promisify(execFile);
export class VorhoerFehler extends Error {
  readonly code: number; readonly fehler: string;
  constructor(code: number, fehler: string) { super(fehler); this.code = code; this.fehler = fehler; }
}
const nameMit = (basis: string, i: string): string => (i ? `${basis}-${i}` : basis);

// pw-link -l: Zeile "<client>:cue_L", darunter eingerückt "|-> <ziel>" je Kante
export function kopfhoererAus(pwLinkL: string, kern: string): boolean {
  const z = pwLinkL.split('\n');
  const i = z.findIndex((x) => x.trim() === `${kern}:cue_L`);
  return i >= 0 && /^\s+\|->\s*\S/.test(z[i + 1] ?? '');
}
export const VORHOER_MAX_S = 1800;   // M1: der Vorhörer dekodiert höchstens die ersten 30 min (djk/vorhoerer MAX_DEKODIER_S), sonst belegt ein 5-h-Track 7 GB
export const VORHOERER_NAME = 'cypherdj-vorhoerer-mt';   // eigener JACK-Name neben dem Cue-Werkzeug (Review S7 m4)
// kern-faehigkeiten.json (Task 7.1): der LAUFENDE Kern hat erz/8 als Nur-Cue. comm(pid) liest /proc/<pid>/comm (null = tot).
export function nurCueAus(json: string | null, comm: (pid: number) => string | null): boolean {
  try {
    const j = JSON.parse(json ?? '') as { pid?: unknown; nur_cue?: unknown };
    return typeof j.pid === 'number' && j.nur_cue === 'erz/8' && comm(j.pid) === 'cypherdj-kern';
  } catch { return false; }
}
export function kernNurCueVorgabe(shm: string): boolean {
  let json: string | null = null;
  try { json = fs.readFileSync(path.join(shm, 'kern-faehigkeiten.json'), 'utf8'); } catch { /* fehlt: alter Kern */ }
  return nurCueAus(json, (pid) => { try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return null; } });
}
export function kantenZeilen(i: string): string[] {
  const v = nameMit(VORHOERER_NAME, i), k = nameMit('cypherdj-kern', i);
  return [`${v}:aus_L\t${k}:rueck_erz_8_L`, `${v}:aus_R\t${k}:rueck_erz_8_R`];
}

interface Klient {
  starte(): Promise<void>; laden(p: string): void; play(): void; pause(): void; springe(s: number): void; loop(a: number, b: number): void; loopAus(): void;
  geschaetztePosition(): number | null; spielt: boolean;
  on(e: string, f: (...a: unknown[]) => void): unknown; once(e: string, f: (...a: unknown[]) => void): unknown; off(e: string, f: (...a: unknown[]) => void): unknown; removeAllListeners(e: string): unknown;
}
export interface Element { pfad: string; typ: 'track' | 'loop' | 'oneshot'; sha: string; bpm?: number | null }

export function vorhoeerKlientVorgabe(repo: string, i: string, log?: (z: Record<string, unknown>) => void): Klient {
  return new VorhoererKlient({ bin: path.join(repo, 'djk', 'vorhoerer', 'build', 'cypherdj-vorhoerer'), ausgang: `${nameMit('cypherdj-kern', i)}:rueck_erz_8_`,
    name: VORHOERER_NAME, instanz: i, port: vorhoererPort(i) + 5, log }) as unknown as Klient;
}

export class Vorhoeren {
  private k: Klient | null = null;
  private start: Promise<void> | null = null;
  private el: (Element & { dauer_s: number }) | null = null;
  private kopf = { wert: false, bis: 0 };
  private abbruch: (() => void) | null = null;   // F2: bricht das Warten auf die Ladung der gerade laufenden (nun überholten) Anfrage ab
  private erwartet: string | null = null;        // Pfad, auf dessen geladen die laufende Anfrage wartet
  private nr = 0;                 // Anfrage-Nummer: eine neuere Anfrage (oder stopp) überholt jede ältere (B1)
  private lade: Promise<void> = Promise.resolve();   // der Vorhörer lädt eine Datei zur Zeit: Anfragen stellen sich hinten an
  private laeuft = false;   // eigene Wahrheit über „spielt": der Klient meldet bei Loops kurz vor B fälschlich ended (m5)
  private readonly o: { kopfhoererDa: () => Promise<boolean>; kernNurCue: () => boolean; klient: () => Klient; kantenDatei: string; instanz: string };
  constructor(o: { kopfhoererDa: () => Promise<boolean>; kernNurCue: () => boolean; klient: () => Klient; kantenDatei: string; instanz: string }) { this.o = o; }

  // F3: Lesen-Ändern-Ersetzen der Kanten-Datei unter flock auf ihrem Ordner. djk-instrumente hängt Wirt-Zeilen unter derselben Sperre an
  // (`flock <ordner>`), damit keine Zeile zwischen Lesen und rename verloren geht. flock statt Lockdatei: der Kernel gibt die Sperre
  // beim Tod des Halters frei (keine verwaiste Sperre), und djk-stop muss keine Datei mehr abräumen. Wartezeit höchstens 5 s.
  // Asynchron (execFile): wartet die Sperre, laufen HTTP, Pegel und Hand der Oberfläche weiter (Review R3).
  private async unterSperre(skript: string, ...args: string[]): Promise<void> {
    await lauf('flock', ['-x', '-w', '5', path.dirname(this.o.kantenDatei), 'sh', '-c', skript, 'sh', ...args], { timeout: 8000 });
  }
  private async kantenWeg(): Promise<void> {   // Vorhörer-Kanten aus der Datei, damit kein Kern (auch kein alter) sie nachverbindet. Atomar: Temp + rename (M2)
    if (!fs.existsSync(this.o.kantenDatei)) return;
    const muster = kantenZeilen(this.o.instanz).flatMap((z) => ['-e', z]);
    await this.unterSperre('d=$1; shift; grep -vxF "$@" "$d" > "$d.tmp"; [ $? -le 1 ] || exit 1; mv "$d.tmp" "$d"', this.o.kantenDatei, ...muster);
  }

  static async kopfhoererDaVorgabe(i: string): Promise<boolean> {
    try { return kopfhoererAus((await lauf('pw-link', ['-l'])).stdout, nameMit('cypherdj-kern', i)); } catch { return false; }
  }
  private async kopfhoerer(): Promise<boolean> {   // höchstens einmal je Sekunde gemessen (stand() pollt 5×/s)
    if (Date.now() < this.kopf.bis) return this.kopf.wert;
    this.kopf = { wert: await this.o.kopfhoererDa(), bis: Date.now() + 1000 };
    return this.kopf.wert;
  }
  private async kanten(): Promise<void> {   // Kern verbindet nach Neustarts nach (main.cpp lade_kanten_datei); jede Zeile nur einmal, unter derselben Sperre
    fs.mkdirSync(path.dirname(this.o.kantenDatei), { recursive: true });
    await this.unterSperre('d=$1; shift; for z in "$@"; do grep -qxF -- "$z" "$d" 2>/dev/null || printf \'%s\\n\' "$z" >> "$d"; done', this.o.kantenDatei, ...kantenZeilen(this.o.instanz));
  }

  private neuerKlient(): Klient {
    const k = this.o.klient();
    k.on('ended', () => {                              // Loop: falsches Ende überstimmen, sonst ist ended das Ende
      if (this.k !== k) return;
      if (this.el?.typ === 'loop' && this.laeuft) k.spielt = true; else this.laeuft = false;
    });
    k.on('geladen', (x) => {                           // N1: eine Datei, die niemand erwartet, wurde im Vorhörer getauscht (überholte Ladung fertig): er steht bei 0, die vorige läuft nicht mehr
      const pfad = (x as { pfad?: string }).pfad;
      if (this.k === k && this.el && pfad !== this.el.pfad && pfad !== this.erwartet) { this.el = null; this.laeuft = false; }   // Review R1: auch nach stopp (erwartet null): der Vorhörer hält jetzt diese Datei bei 0
    });
    k.on('beendet', () => {                            // B2: der Vorhörer-Prozess ist tot (kill, Absturz): nächste Anfrage startet neu
      if (this.k !== k) return;
      this.k = null; this.start = null; this.el = null; this.laeuft = false;
      void (k as unknown as { stoppe?: () => Promise<void> }).stoppe?.()?.catch?.(() => {});
    });
    return k;
  }

  async spiele(e: Element): Promise<void> {
    const nr = ++this.nr;
    this.abbruch?.();                                    // F2: die Ladung der überholten Anfrage nicht abwarten
    const ueberholt = (): VorhoerFehler => new VorhoerFehler(409, 'ueberholt');
    if (!this.o.kernNurCue()) { try { await this.kantenWeg(); } catch { /* Sperre nicht zu bekommen: die 503 kommt trotzdem, stand() räumt später nach */ } await this.ende(); throw new VorhoerFehler(503, 'kern_ohne_vorhoerkanal'); }
    this.kopf.bis = 0;                                   // beim Start immer frisch prüfen
    if (!(await this.kopfhoerer())) throw new VorhoerFehler(409, 'kein_kopfhoerer');
    // B1: ein Ladevorgang zur Zeit, in Anfragereihenfolge. Eine überholte Anfrage lädt nie und beantwortet nie die neueste.
    const vorher = this.lade;
    let frei!: () => void;
    this.lade = new Promise<void>((ok) => { frei = ok; });
    try {
      await vorher;
      if (nr !== this.nr) throw ueberholt();
      if (!this.k) { this.k = this.neuerKlient(); const k = this.k; this.start = k.starte().catch((x) => { if (this.k === k) this.k = null; throw x; }); }
      try { await this.start; } catch (x) { throw new VorhoerFehler(503, `vorhoerer_start: ${(x as Error).message}`); }
      if (nr !== this.nr) throw ueberholt();
      if (!this.k) throw new VorhoerFehler(503, 'vorhoerer_start: beendet');
      await this.kanten();
      if (nr !== this.nr) throw ueberholt();             // während der Sperre überholt: gar nicht erst laden
      const k = this.k;
      this.erwartet = e.pfad;
      const g = await new Promise<{ dauer_s: number }>((ok, f) => {
        const ab = (): void => { clearTimeout(zeit); k.off('geladen', bei); k.off('fehler', fehl); k.off('beendet', tot); if (this.abbruch === abbr) this.abbruch = null; };
        const zeit = setTimeout(() => { ab(); f(new VorhoerFehler(504, 'laden_zeitlimit')); }, 15_000);
        const bei = (x: unknown): void => {                // nur die Antwort für DIESE Datei (ein spätes geladen einer älteren zählt nicht)
          if ((x as { pfad?: string }).pfad !== e.pfad) return;
          ab(); ok(x as { dauer_s: number });
        };
        const fehl = (t: unknown): void => {                // nur der Fehler dieser Datei: der Vorhörer hängt den Pfad an jede Ladefehlermeldung (ein später Fehler einer überholten Datei zählt nicht)
          if (!String(t).includes(e.pfad.slice(0, 150))) return;
          ab(); f(new VorhoerFehler(422, `format: ${String(t)}`)); };
        const tot = (): void => { ab(); f(new VorhoerFehler(503, 'vorhoerer_beendet')); };
        const abbr = (): void => { ab(); f(ueberholt()); };
        this.abbruch = abbr;
        k.on('geladen', bei); k.on('fehler', fehl); k.on('beendet', tot);
        k.laden(e.pfad);
      }).finally(() => { this.erwartet = null; });
      if (nr !== this.nr) throw ueberholt();             // während des Ladens kam eine neuere Anfrage (oder stopp): nichts spielen
      this.el = { ...e, dauer_s: g.dauer_s };
      if (e.typ === 'loop') k.loop(0, g.dauer_s);
      else { k.loopAus(); if (e.typ === 'track') k.springe(Math.round(g.dauer_s * 0.25 * 1000) / 1000); }
      k.play();
      this.laeuft = true;
    } finally { frei(); }
  }

  springe(richtung: 1 | -1): void {
    const k = this.k, e = this.el; if (!k || !e) return;
    if (e.typ !== 'track') { if (richtung < 0) k.springe(0); return; }
    const s = k.geschaetztePosition() ?? 0;
    const schritt = e.bpm ? (8 * 4 * 60) / e.bpm : 15;   // 8 Takte à 4 Schläge, sonst 15 s
    k.springe(Math.round(Math.max(0, Math.min(e.dauer_s - 1, s + richtung * schritt)) * 1000) / 1000);
  }

  stoppe(): void { this.nr++; this.abbruch?.(); this.laeuft = false; this.k?.pause(); }   // nr++: eine ladende Anfrage soll danach nicht doch noch spielen

  async stand(): Promise<{ sha: string; typ: string; s: number | null; dauer_s: number; spielt: boolean; kopfhoerer: boolean; gekuerzt?: true } | { spielt: false; kopfhoerer: boolean }> {
    const kopfhoerer = await this.kopfhoerer();
    if (!this.o.kernNurCue()) {   // auch ohne laufenden Vorhörer (er beendet sich selbst, wenn der Kern kein Nur-Cue mehr meldet): die Kanten müssen weg
      if (this.k) await this.ende(); else { try { await this.kantenWeg(); } catch { /* keine Datei */ } }
      return { spielt: false, kopfhoerer };
    }   // B3: Kern ohne Nur-Cue (Rückweg, Neustart): Vorhörer weg, Kanten weg
    if (!this.k || !this.el) return { spielt: false, kopfhoerer };
    if (!kopfhoerer && this.laeuft) this.stoppe();     // Kopfhörer ab während des Hörens: anhalten, die Seite meldet es
    return { sha: this.el.sha, typ: this.el.typ, s: this.k.geschaetztePosition(), dauer_s: this.el.dauer_s, spielt: this.laeuft, kopfhoerer, ...(this.el.dauer_s >= VORHOER_MAX_S - 0.01 ? { gekuerzt: true as const } : {}) };
  }

  async ende(): Promise<void> {   // Ende der Oberfläche oder Kern ohne Nur-Cue: Vorhörer beenden, eigene Kanten-Zeilen entfernen (B3)
    this.nr++;
    const k = this.k as unknown as { stoppe?: () => Promise<void> } | null;
    this.k = null; this.start = null; this.el = null; this.laeuft = false;
    try { await this.kantenWeg(); } catch { /* ohne Datei oder Ordner: nichts zu entfernen */ }
    await k?.stoppe?.();
  }
}
