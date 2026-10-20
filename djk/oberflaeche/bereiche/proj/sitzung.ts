// Das offene Projekt des Seiten-Servers (Spec D1 2.1, 3.4): Projektordner, Verlauf, Wiedergabe-Nummer, Abgleich mit dem Kern.
// Die schreibenden Wege der Sitzung laufen nacheinander in einer Kette (seriell). Eine Ausnahme gibt es: uebernimm() (S3, Freeze und
// Export) setzt den Stand synchron, bevor es sich in die Kette stellt, also auch während ein Befehl in der Kette auf Regler-Quittungen
// wartet. Ein Befehl sieht darum nach einem await nicht sicher den Stand, gegen den er geprüft wurde; vollziehe prüft die rev nach dem
// Warten noch einmal (Spec 6.30, 409 rev_veraltet). Der Kern wird nur über KernWeg angesprochen (BereichKontext), Kern-Ereignisse kommen über ereignis().
// Reihenfolge einer Änderung: prüfen (rev, KI-Stopp, Katalog, Freeze-Sperre) → Probe rechnen → Regler setzen und Quittungen abwarten → rev noch
// einmal prüfen (409 rev_veraltet) → echte Ablehnung des Kerns: zurückdrehen, 409 regler_abgelehnt, nichts gespeichert (Quittung null heißt kein Kern:
// angenommen, kern.regler kein_kern) → Wiedergabe schreiben, wenn nötig (Freeze-Sperre erneut geprüft), dann EINMAL speichern und ins Log → laden,
// Loop, Metronom, Tempo nachziehen → SSE proj. Der Rückweg der Hand speichert zusammengefasst (höchstens alle 250 ms, ein Eintrag je Geste).
// Stand Slice 6 (S2-Integration): vollständig. Dazu Transport, Tempo-Regel, Rückweg der Hand, KI-Stopp, KI-Maske (aus dem Spurfeld von,
// Spec 6.22) und der Neustart des Kerns.
import fs from 'node:fs';
import path from 'node:path';
import type { BereichKontext } from '../../http/router.ts';
import { Katalog } from '../../katalog.ts';
import { Projekte, projektWurzelVorgabe } from '../../projekt/ablage.ts';
import { fuehreListeAus, setzeDekodiert, vergleiche } from '../../projekt/befehle.ts';
import { DekodierCache, type DekodierEreignis } from '../../projekt/dekodier.ts';
import { MAX_BEAT, herkunft, kanonisch, type DekodiertZustand, type Projekt } from '../../projekt/modell.ts';
import { PatchFehler, wende } from '../../projekt/patch.ts';
import { aendere, rueckgaengig, wiederholen, type Haken, type Meta, type Verlauf, type Wirkung } from '../../projekt/verlauf.ts';
import { WiedergabeFehler, WiedergabeZaehler, schreibeWiedergabe, uebersetze, wiedergabeDatei } from '../../projekt/wiedergabe.ts';
import { ERZ4_NUR_HAND, alleSpurRegler, cypherSpuren, erz4Soll, istSpurRegler, kiSpurListe, reglerZuBefehl, type Soll } from './abbildung.ts';
import { arrOrdner, zaehlerDateiVorgabe } from './konfig.ts';
import { grundText } from '../../http/gruende.ts';
import { KernLage } from './lage.ts';
import { KernWeg, quittungAbgelehnt, quittungOk, type Quelle, type Quittung, type ReglerErgebnis } from './kern_weg.ts';

export class ProjFehler extends Error {
  readonly code: number;
  readonly fehler: string;
  readonly extra: Record<string, unknown>;
  constructor(code: number, fehler: string, extra: Record<string, unknown> = {}) { super(fehler); this.code = code; this.fehler = fehler; this.extra = extra; }
  get grund(): string { return this.fehler; }   // wie BefehlFehler.grund (S3 liest den Grund so)
}
export interface Antwort { code: number; j: unknown }
export interface ProjOptionen {
  instanz?: string;            // Vorgabe CYPHERDJ_INSTANZ
  wurzel?: string;             // Projektordner-Wurzel (Vorgabe projektWurzelVorgabe(instanz))
  arbeitsordner?: string;      // Arbeitsordner der Wiedergaben (Vorgabe: kern.toml arr_ordner, sonst ~/.cache/cypherdj[-<i>]/arr)
  zaehlerDatei?: string;       // Spec 6.30, 6.31: Zustandsdatei des Wiedergabe-Zählers ausserhalb des Arbeitsordners. Vorgabe: mit ausdrücklichem
                               // arbeitsordner `<arbeitsordner>.zaehler` (je Ordner eine, Test-Server teilen nie eine Datei), sonst
                               // ~/.local/state/cypherdj[-<i>]/wiedergabe-zaehler
  katalog?: string;            // katalog.sqlite (Audio-Quellen nur über den Katalog, Spec 2.11)
  ffmpeg?: string[]; ffprobe?: string[]; vorsatz?: string[];   // Dekodier-Cache (Tests)
  arrFristMs?: number;         // P2: so lange wartet oeffne auf /zustand/arr, wenn der Server den Kern-Stand noch nicht kennt (Vorgabe 600 ms)
  rampeWarteMs?: number;       // höchstens so lange wartet ein Transport-Start auf das Ende der Tempo-Rampe (Vorgabe 20 s)
  uhrStillMs?: number;         // Spec 6.30: läuft /uhr so lange nicht weiter, bricht das Warten auf die Rampe ab (503 kein_kern, Vorgabe 1 s)
}
// merk (Spec 6.30, 6.31): was die Freeze-Sperre aufgeschoben hat und nach der letzten Freigabe nachgeholt wird. Es gehört zum offenen Projekt und
// verfällt mit ihm: ein anderes Projekt lädt beim Öffnen ohnehin seine eigene Wiedergabe.
interface Merk { laden: boolean; loop: boolean; tempo: boolean }
// Spec 6.34: was GET /proj/aktuell als ausgabe_lauf zeigt, solange S3 einen Freeze oder Export fährt (Spur nur beim Freeze)
export type AusgabeLauf = { art: 'freeze'; spur_id: string } | { art: 'export' };
interface Offen { slug: string; projekt: Projekt; verlauf: Verlauf; merk: Merk }
type Koerper = Record<string, unknown>;

const schlaf = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
// Flache Kopie für proj_lage: MIDI-Clips tragen noten_zahl statt noten, alles andere wird geteilt (nur lesen, nicht verändern)
const ohneNoten = (p: Projekt): unknown => ({ ...p, spuren: p.spuren.map((s) => ({ ...s, clips: s.clips.map((c) => {
  if (c.art !== 'midi') return c;
  const { noten, ...rest } = c;
  return { ...rest, noten_zahl: noten.length };
}) })) });
// Spec 6.30, 6.31: wie in vollziehe ist nur eine echte Ablehnung des Kerns ein Regler-Fehler; Quittung null heißt kein Kern (keine Antwort bis
// zur Frist), das Projekt bleibt die Wahrheit. Für Antworten und Protokoll getrennt gezählt.
const reglerBefund = (e: ReglerErgebnis[]): { regler_fehler: ReglerErgebnis[]; regler_ohne_kern: number } =>
  ({ regler_fehler: e.filter((r) => quittungAbgelehnt(r.quittung)), regler_ohne_kern: e.filter((r) => r.quittung === null).length });
// Spec 6.35: die Rückfahrt nach der KI-Freigabe dauert so lange wie die Ausblende des Stopps (SCHNITTSTELLEN §4.7, ki.cpp KI_STOPP_BEATS)
export const KI_BEATS = 4;
// Spec 6.36: die Rückfahrt ist ein benannter Plan, Teil-Nummer = Spur-Nummer. So bricht der Server genau ihre Teile ab (neuer Stopp, Andreas'
// Hand an der Seite), nie fremde. Der Halter im Kern heißt dann plan:ki_rueck (§4.3).
export const RUECK_PLAN = 'ki_rueck';
// Spec 6.37 (Fix8 V1): der eigene Weg für Fader, die nicht zu Cyphers Spuren gehören und beim Öffnen in einer laufenden Ausblende stehen. Ein
// eigener Plan, damit weder ein Stopp (offeneRueckfahrt kennt nur ki_rueck) noch die Freigabe ihn trifft.
export const ZIEL_PLAN = 'proj_ziel';
const spurNr = (pfad: string): number => Number(pfad.split('/')[1]);
const STUMM_GRENZE = -120;          // SCHNITTSTELLEN §1.2: jeder Wert ≤ −120 dB ist stumm (typen.h STUMM_GRENZE)
const STUMM = -200;                 // SCHNITTSTELLEN §1.2: der Stumm-Wert, wie die Ausblende des KI-Stopps ihn setzt
export const RUECKWEG_MS = 250;     // Spec 6.30: höchstens eine Speicherung des Rückwegs je 250 ms
export const GESTE_RUHE_MS = 500;   // Spec 6.30: so lange Ruhe schließt eine Geste (ein Verlaufseintrag je Geste)

export class ProjSitzung {
  readonly lage = new KernLage();
  readonly arbeitsordner: string;
  private readonly ctx: BereichKontext;
  private readonly kern: KernWeg;
  private readonly projekte: Projekte;
  private readonly cache: DekodierCache;
  private readonly zaehler: WiedergabeZaehler;
  private readonly katalog: Katalog | null;
  private readonly arrFristMs: number;
  private readonly rampeWarteMs: number;
  private readonly uhrStillMs: number;
  private offen: Offen | null = null;
  private letzteKiListe: string | null = null;      // zuletzt vom Kern angenommene Liste für /k/ki/spur
  private transportQuelle: Quelle | null = null;     // wer den laufenden Transport gestartet hat (Spec 2.12)
  private kiStand: boolean | null = null;            // Spec 6.35: zuletzt gesehener KI-Stopp (null: noch nichts gehört); gestoppt → frei ist die Freigabe
  private kiStoppBeat: number | null = null;         // Beat des letzten Stopps aus /e/ki sample (null: unbekannt)
  // Spec 6.36, 6.37: gesendete Rückfahrten je Fader-Pfad → Start (ab), Ende (ab + 4) und laufende Nummer der Sendung (eine spätere Sendung an
  // denselben Fader, etwa Andreas' neues Ziel, wird von der Antwort einer früheren nie gelöscht)
  private readonly rueckfahrt = new Map<string, { ab: number; ende: number; nr: number }>();
  private rueckfahrtNr = 0;
  // Spec 6.37 (Fix8 V1): wartende Setzungen des eigenen Wegs (setzeNachAusblende) je Fader-Pfad → Start und Nummer der Sendung. Nie in rueckfahrt.
  private readonly zielWeg = new Map<string, { ab: number; nr: number }>();
  private kette: Promise<unknown> = Promise.resolve();
  private readonly rueckwegWartend = new Map<string, number>();     // Rückweg: letzter Wert je Pfad, noch nicht gespeichert
  private rueckwegTimer: ReturnType<typeof setTimeout> | null = null;
  private rueckwegGespeichertMs = -Infinity;                         // Zeit der letzten Speicherung des Rückwegs
  private geste: { nr: number; letzteMs: number; labels: string[]; offen: Offen | null } = { nr: 0, letzteMs: -Infinity, labels: [], offen: null };
  private sperren = 0;          // P4 (Spec 6.23): offene sperreLaden()-Freigaben
  private oeffnet = 0;          // Spec 6.32: laufende /proj/oeffnen und /proj/neu (in der Kette); solange > 0 lehnt sperreLaden() ab
  private ausgabeLauf: AusgabeLauf | null = null;   // Spec 6.34: laufender Freeze oder Export (Paket S3), GET /proj/aktuell ausgabe_lauf

  constructor(ctx: BereichKontext, opt: ProjOptionen = {}) {
    const instanz = opt.instanz ?? process.env.CYPHERDJ_INSTANZ ?? '';
    this.ctx = ctx;
    this.kern = new KernWeg(ctx, this.lage);
    this.projekte = new Projekte(opt.wurzel ?? projektWurzelVorgabe(instanz));
    this.arbeitsordner = opt.arbeitsordner ?? arrOrdner(instanz);
    const zaehlerDatei = opt.zaehlerDatei
      ?? (opt.arbeitsordner ? `${path.resolve(opt.arbeitsordner)}.zaehler` : zaehlerDateiVorgabe(instanz));
    this.zaehler = new WiedergabeZaehler(this.arbeitsordner, zaehlerDatei);
    this.cache = new DekodierCache(this.arbeitsordner, { ffmpeg: opt.ffmpeg, ffprobe: opt.ffprobe, vorsatz: opt.vorsatz,
      bei: (e) => this.dekodiertEreignis(e) });
    this.katalog = opt.katalog ? new Katalog(opt.katalog) : null;
    this.arrFristMs = opt.arrFristMs ?? 600;
    this.rampeWarteMs = opt.rampeWarteMs ?? 20_000;
    this.uhrStillMs = opt.uhrStillMs ?? 1000;
  }

  // Ein schreibender Weg zur Zeit; ein Fehler bricht die Kette nicht.
  private seriell<T>(f: () => Promise<T>): Promise<T> {
    const p = this.kette.then(f, f);
    this.kette = p.catch(() => undefined);
    return p;
  }
  private brauchOffen(): Offen {
    if (!this.offen) throw new ProjFehler(409, 'kein_projekt');
    return this.offen;
  }
  // Spec 3.5 / 2.12: bei KI-Stopp schreibt Cypher nichts
  private riegel(quelle: Quelle): void {
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
  }
  private haken(o: Offen): Haken {
    return { speichere: (p) => this.projekte.speichere(o.slug, p), dekodiert: (sha) => this.zustandVon(sha) };
  }
  private speichereStand(o: Offen): void {
    try { this.projekte.speichere(o.slug, o.projekt); } catch (e) {
      this.ctx.log({ typ: 'proj_speichern_fehler', slug: o.slug, fehler: (e as Error).message });
    }
  }

  // --- lesen ----------------------------------------------------------------------------------------------------------
  liste(): Antwort { return { code: 200, j: this.projekte.liste() }; }
  // ansicht (Spec 6.30, Leistung): 'voll' (die Seite), 'noten_zahl' (Werkzeug proj_lage: je MIDI-Clip noten_zahl statt noten), 'rev' ({slug, rev}
  // für das Werkzeug, bevor es schreibt)
  aktuell(ansicht: 'voll' | 'noten_zahl' | 'rev' = 'voll'): Antwort {
    const o = this.offen;
    if (ansicht === 'rev') return { code: 200, j: { slug: o?.slug ?? null, rev: o?.projekt.rev ?? null } };
    // Spec 6.34: die Seite (ansicht voll) bekommt immer ausgabe_lauf, damit ein Reload mitten in einem Freeze oder Export ihn sieht
    const lauf = ansicht === 'voll' ? { ausgabe_lauf: this.ausgabeLauf } : {};
    if (!o) return { code: 200, j: { slug: null, projekt: null, kern: null, ...lauf } };
    const a = this.lage.arr;
    const projekt = ansicht === 'noten_zahl' ? ohneNoten(o.projekt) : o.projekt;
    return { code: 200, j: { slug: o.slug, projekt, kern: { rev_geladen: a ? a.nr : null, status: a ? a.status : null }, ...lauf } };
  }
  // zeit in Millisekunden seit 1970 (Festlegung V1, Seite rechnet damit), volle Liste
  verlaufListe(): Antwort {
    const o = this.brauchOffen();
    return { code: 200, j: o.verlauf.liste().map((e) => ({ ...e, zeit: Date.parse(e.zeit) })) };
  }

  // --- öffnen ---------------------------------------------------------------------------------------------------------
  neu(name: unknown, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      this.riegel(quelle);
      this.sperreOeffnen();
      this.sperreFremderTransport(quelle);
      return this.oeffnetGerade(() => {
        const { slug } = this.projekte.lege(name as string);
        return this.oeffneIntern(slug, quelle);
      });
    });
  }
  oeffnen(slug: unknown, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      this.riegel(quelle); this.sperreOeffnen(); this.sperreFremderTransport(quelle);
      return this.oeffnetGerade(() => this.oeffneIntern(slug as string, quelle));
    });
  }
  // Spec 6.31: Öffnen lädt die Wiedergabe des Projekts in den Kern, und jedes Laden bricht einen laufenden Freeze ab (6.23). Geprüft in der
  // Kette, also gegen die Sperre zu dem Zeitpunkt, an dem das Öffnen wirklich läuft; vor lege(), damit ein abgelehntes neu() keinen Ordner anlegt.
  private sperreOeffnen(): void {
    if (this.sperren > 0) throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; opening or creating a project waits until it is done' });
  }
  // Spec 6.37 (Andreas F13, REVIEW-5-opus M1: schliesseOffen stoppte jeden laufenden Transport mit der Quelle des Wechsels): Cypher öffnet oder
  // legt kein Projekt an, solange ein Transport läuft, den sie nicht selbst gestartet hat (auch unbekannt, etwa nach einem Server-Neustart, und
  // Andreas' Hand-Taste); nichts wird gestoppt. Andreas' eigener Wechsel stoppt wie bisher, Cyphers Wechsel über ihren eigenen Lauf stoppt ihren.
  // Geprüft in der Kette vor lege() und vor jedem await des Öffnens, also unmittelbar vor dem Stopp in schliesseOffen.
  private sperreFremderTransport(quelle: Quelle): void {
    if (!this.fremderLauf(quelle)) return;
    throw new ProjFehler(409, 'transport_laeuft', { text: 'a transport Andreas started is running; Cypher opens or creates a project only after it stops' });
  }
  // Spec 6.37: läuft oder wartet ein Transport (status 1 oder 2), den nicht Cypher gestartet hat, während Cypher (Quelle cypher) handeln will?
  // Andreas' Seite, seine Hand-Taste und ein unbekannter Starter (null, etwa nach einem Server-Neustart) zählen als seiner.
  private fremderLauf(quelle: Quelle): boolean {
    const a = this.lage.arr;
    return quelle === 'cypher' && !!a && (a.status === 1 || a.status === 2) && this.transportQuelle !== 'cypher';
  }
  // Spec 6.32: zwischen Öffnen und Freeze gewinnt, wer zuerst kommt. Öffnen und Anlegen haben Wartestellen (Stopp-Quittung des laufenden Projekts,
  // Wiederanlauf-Prüfung); solange sie laufen, lehnt sperreLaden() ab. Zählt nur, was in der Kette schon läuft: ein wartendes Öffnen prüft die
  // Sperre selbst, wenn es dran ist (sperreOeffnen).
  private async oeffnetGerade(f: () => Promise<Antwort>): Promise<Antwort> {
    this.oeffnet += 1;
    try { return await f(); } finally { this.oeffnet -= 1; }
  }
  private async oeffneIntern(slug: string, quelle: Quelle): Promise<Antwort> {
    // Spec 6.30: erst das neue Projekt öffnen, dann das laufende schliessen. Ein unbekannter, gesperrter oder kaputter Slug wirft in oeffne(),
    // und das laufende Projekt bleibt offen. Dasselbe Projekt noch einmal: zuerst schliessen, sonst hielte es seine eigene Sperre (projekt_busy).
    if (this.offen?.slug === slug) await this.schliesseOffen(quelle);
    // Spec 6.12: nur über oeffne() (zieht ein vorauslaufendes Log nach)
    const o = this.projekte.oeffne(slug, { beiFehler: (e) => this.ctx.log({ typ: 'proj_verlauf_fehler', slug, fehler: e.message }) });
    try { await this.schliesseOffen(quelle); } catch (e) {
      try { o.verlauf.schliesse(); } catch { /* der erste Fehler zählt */ }
      throw e;
    }
    const projekt = structuredClone(o.projekt);
    this.gleicheDekodiertAb(projekt, true);
    this.offen = { slug, projekt, verlauf: o.verlauf, merk: { laden: false, loop: false, tempo: false } };
    // Spec 6.21: die Wiedergabe-Nummer entscheidet, wer beim Mixer gewinnt (gleiche Nummer: Wiederanlauf, die Spur-Regler des Kerns gewinnen)
    const wieder = await this.istWiederanlauf(projekt);
    // Spec 6.37 (Re-Review Fix5 R3: der Kern lehnte die Fader des neuen Projekts wegen der Überlappung ab, die Rückfahrt des alten lief zu Ende):
    // spielt der Kern ein anderes Projekt, laufende und wartende Rückfahrten vor dem Setzen der neuen Regler abbrechen; danach gelten die Werte
    // dieses Projekts. Beim Wiederanlauf ist es die Rückfahrt dieses Projekts: sie fährt auf seinen Wert weiter (6.36, Fix5 K4).
    // Spec 6.37 (Re-Review Fix6 RR6-1, rr6_r3w R3w: wartete die Rückfahrt noch, fiel das Setzen in die Ausblende des Stopps, der Kern lehnte es
    // ab, und die Spur stand danach ohne Stopp stumm): eine WARTENDE Rückfahrt wird wie bei Andreas' Griff (vollziehe) nicht gestrichen, sondern
    // mit dem Wert dieses Projekts als Ziel ab demselben Start neu geplant (rueckfahrtAufZiel, zweiter Versuch bei ueberlappung). Eine laufende
    // bricht ab, und der Abgleich setzt den Wert direkt (Fix6 T3).
    // Spec 6.37 (Re-Review Fix7 RR7-1, rr7 M_frei: U1 plante auch eine Spur um, die in B Andreas gehört; ein neuer Stopp setzte sie stumm, die
    // Freigabe fuhr nur Cyphers Spuren zurück, Andreas' Spur stand danach bei −200 ohne Stopp): in this.rueckfahrt stehen nur Fader von Cyphers
    // Spuren des offenen Projekts. Jeder andere Fader (Andreas' Spur, freier Slot), der wegen der laufenden Ausblende nicht sofort gesetzt werden
    // kann, bekommt den Wert dieses Projekts zum Ende der Ausblende auf dem eigenen Weg (zielNachAusblende, Plan proj_ziel); den fassen weder
    // Stopp noch Freigabe an. Wartet dort noch der Wert eines vorher geöffneten Projekts, gilt dasselbe für ihn.
    const ziel = new Map<string, number>();                              // Pfad → Start der wartenden Rückfahrt oder des wartenden eigenen Wegs
    if (!wieder) {
      const beat = this.lage.uhr?.beat ?? -Infinity;
      for (const [p, e] of this.rueckfahrt) if (e.ab > beat) ziel.set(p, e.ab);
      for (const [p, e] of this.zielWeg) if (e.ab > beat && !ziel.has(p)) ziel.set(p, e.ab);
      await Promise.all([this.rueckfahrtAbbrechen(null), this.zielWegAbbrechen(null)]);
    }
    // Spec 6.36: Cyphers Spuren, die im Kern stumm stehen, obwohl kein Stopp gilt (Freigabe ohne offenes Projekt oder ohne Server), fahren
    // nach dem Abgleich über 4 Beats auf ihren Projektwert; das Setzen im Abgleich lässt sie darum aus.
    const rueck = await this.verfalleneRueckfahrt(projekt, ziel);
    const cypherFader = new Set(cypherSpuren(projekt).map((n) => `spur/${n}/fader`));
    const wartend = alleSpurRegler(projekt).filter((r) => ziel.has(r.pfad));
    // Unmittelbar vor dem Senden (kein await dazwischen): im Stopp wird nichts neu geplant, der Abgleich setzt Cyphers Fader stumm (imStoppStumm)
    const umplanen = this.ctx.kiGestoppt() ? [] : wartend.filter((r) => cypherFader.has(r.pfad));
    const andreasZiel = wartend.filter((r) => !cypherFader.has(r.pfad));   // nicht Cyphers: auch im Stopp (er senkt sie nicht)
    const [kern, gefahren, spaeter] = await Promise.all([this.synchronisiere(quelle, true, wieder,
      [...rueck.aus, ...umplanen.map((r) => r.pfad), ...andreasZiel.map((r) => r.pfad)]),
    this.rueckfahrtAufZiel(umplanen, ziel), this.rueckfahrtAufZiel(andreasZiel, ziel, true)]);
    // Fix8 V1, Probe M_stopp (gemessen: Öffnen während der Ausblende eines geltenden Stopps, keine Rückfahrt beteiligt, der Kern lehnte Andreas'
    // Fader mit ueberlappung ab, die Spur endete bei −200): lehnt der Kern das Setzen eines Faders, der nicht zu Cyphers Spuren gehört, wegen
    // Überlappung ab, kommt sein Wert auf dem eigenen Weg zum Ende der Ausblende (Stopp-Beat + 4; unbekannt: der zweite Versuch nach jetzt + 4).
    const fehler = kern.regler_fehler as ReglerErgebnis[];
    const nachholen = fehler.filter((r) => r.quittung?.grund === 'ueberlappung' && /^spur\/\d+\/fader$/.test(r.pfad) && !cypherFader.has(r.pfad));
    let nach: ReglerErgebnis[] = [];
    if (nachholen.length) {
      const ab = this.kiStoppBeat !== null ? this.kiStoppBeat + KI_BEATS : -Infinity;
      nach = await this.rueckfahrtAufZiel(nachholen.map((r) => ({ pfad: r.pfad, wert: r.wert })), new Map(nachholen.map((r) => [r.pfad, ab])), true);
      kern.regler_fehler = fehler.filter((r) => !nachholen.includes(r));
    }
    if (gefahren.length) kern.rueckfahrt_ziel = gefahren.map((r) => r.pfad);
    if (spaeter.length || nach.length) kern.ziel_nach_ausblende = [...spaeter, ...nach].map((r) => r.pfad);
    if (gefahren.length || spaeter.length || nach.length) {
      const befund = reglerBefund([...gefahren, ...spaeter, ...nach]);
      kern.regler_fehler = [...(kern.regler_fehler as ReglerErgebnis[]), ...befund.regler_fehler];
      kern.regler_ohne_kern = (kern.regler_ohne_kern as number) + befund.regler_ohne_kern;
    }
    if (wieder) {
      const n = this.uebernimmMixer(this.offen);
      kern.wiederanlauf = true; kern.mixer_uebernommen = n;
    }
    if (rueck.soll.length && this.offen && !this.ctx.kiGestoppt()) {
      kern.rueckfahrt = { pfade: rueck.soll.map((r) => r.pfad), ...reglerBefund(await this.fahreZurueck(rueck.soll, {})) };
    }
    const offenes = this.offen;
    this.ctx.log({ typ: 'proj_offen', slug, nachgezogen: o.nachgezogen, quelle, wiederanlauf: wieder });
    this.ctx.verteile({ a: 'proj', f: { slug, rev: offenes.projekt.rev, label: 'Open', quelle } });
    return { code: 200, j: { slug, projekt: offenes.projekt, kern } };
  }
  private async schliesseOffen(quelle: Quelle): Promise<void> {
    const o = this.offen;
    if (!o) return;
    this.rueckwegSpeichern();                                            // Spec 6.30: wartende Rückweg-Werte gehören diesem Projekt
    if (this.lage.arr && (this.lage.arr.status === 1 || this.lage.arr.status === 2)) await this.kern.stopp(quelle);
    this.rueckwegSpeichern();                                            // Spec 6.31: auch, was während des Stopps kam (nach dem letzten await)
    this.transportQuelle = null;
    this.offen = null;
    try { o.verlauf.schliesse(); } catch (e) { this.ctx.log({ typ: 'proj_verlauf_fehler', slug: o.slug, fehler: (e as Error).message }); }
  }
  // Beim Beenden des Servers: ausstehenden Mixer-Eintrag schreiben, Sperre freigeben
  schliesse(): void {
    if (this.rueckwegTimer) { clearTimeout(this.rueckwegTimer); this.rueckwegTimer = null; }
    this.rueckwegSpeichern();
    const o = this.offen;
    this.offen = null;
    if (o) try { o.verlauf.schliesse(); } catch { /* der Server endet ohnehin */ }
  }

  // Wiedergabe laden, Spur-Regler (alle 32), auf Wunsch erz/4 neutral, Loop, Metronom, KI-Maske; alles parallel, Quittungen abgewartet
  // wiederanlauf (Spec 6.21, 6.30): der Kern gewinnt ganz. Keine neue Wiedergabe, kein erz/4, kein Loop, kein Metronom; von den Spur-Reglern
  // nur die mit unbekanntem Ist-Wert (für genau diese gewinnt das Projekt). Die KI-Maske kommt immer aus dem Projekt (Spec 6.22).
  // aus (Spec 6.36): Pfade, die das Setzen auslässt (Cyphers stumme Fader, die danach zurückfahren oder, Stopp-Stand unbekannt, stumm bleiben).
  private async synchronisiere(quelle: Quelle, erz4: boolean, wiederanlauf = false, aus: readonly string[] = []): Promise<Record<string, unknown>> {
    const o = this.brauchOffen();
    const ohne = new Set(aus);
    const soll: Soll[] = (wiederanlauf ? this.unbekannteSpurRegler(o.projekt)
      : [...(erz4 ? erz4Soll(quelle) : []), ...this.imStoppStumm(o.projekt, alleSpurRegler(o.projekt))]).filter((r) => !ohne.has(r.pfad));
    // Spec 6.32: die Sperre zusätzlich unmittelbar vor Laden und Loop (gesperrt: am Offen merken, nicht senden; die Freigabe holt es nach).
    // Die erste Linie ist sperreLaden(), das während eines Öffnens ablehnt; dies ist die zweite.
    const [wiedergabe, regler, loop, metronom, ki] = await Promise.all([
      wiederanlauf ? Promise.resolve({ nr: o.projekt.wiedergabe_rev, quittung: null, wiederanlauf: true }) : this.ladeOderMerke(quelle),
      this.kern.setzeRegler(soll, quelle),
      wiederanlauf ? Promise.resolve(null) : this.loopOderMerke(o, quelle),
      wiederanlauf ? Promise.resolve(null) : this.kern.metronom(o.projekt, quelle), this.kiMaske(true)]);
    // P6: nur bei Quelle cypher werden ziel und xseite nicht gesendet (der Kern lehnt nur_hand ab) und als Meldung geführt
    const nurHand = erz4 && !wiederanlauf && quelle === 'cypher'
      ? ERZ4_NUR_HAND.filter((r) => { const ist = this.lage.reglerWert(r.pfad); return ist !== null && ist !== r.wert; })
      .map((r) => ({ pfad: r.pfad, soll: r.wert, ist: this.lage.reglerWert(r.pfad) })) : [];
    return { wiedergabe, regler: regler.length, ...reglerBefund(regler), loop, metronom, ki, erz4_nur_hand: nurHand };
  }

  // Spec 6.21: gleicht /zustand/arr.nr der wiedergabe_rev des Projekts, spielt der Kern genau dessen letzte Wiedergabe. Kennt der Server den
  // Kern-Stand noch nicht (Start), wartet er höchstens arrFristMs auf /zustand/arr (der Kern meldet es mindestens mit 2 Hz); danach gilt: verschieden.
  private async istWiederanlauf(p: Projekt): Promise<boolean> {
    if (p.wiedergabe_rev <= 0) return false;
    for (let t0 = Date.now(); !this.lage.arr && Date.now() - t0 < this.arrFristMs;) await schlaf(10);
    return this.lage.arr !== null && this.lage.arr.nr === p.wiedergabe_rev;
  }
  // Spec 6.30: Spur-Regler, deren Ist-Wert der Server nicht kennt (der Kern schickt den Regler-Stand nur beim ersten Hallo einer Generation;
  // ein Server, der binnen 5 s neu startet, bekommt ihn nicht). Für genau diese gewinnt beim Wiederanlauf das Projekt. Ausgenommen der Fader
  // von Cyphers Spuren während des KI-Stopps: die Absenkung des Kerns (ki.cpp) bleibt, wie in uebernimmMixer.
  private unbekannteSpurRegler(p: Projekt): Soll[] {
    return this.ohneGestoppteFader(p, alleSpurRegler(p)).filter((r) => this.lage.reglerWert(r.pfad) === null);
  }
  // Spec 6.21 Nachsatz, 6.35: während des KI-Stopps bleibt der Fader von Cyphers Spuren bei der Absenkung des Kerns (ki.cpp). Gilt für den
  // Wiederanlauf (unbekannte Regler) und für den Kern-Neustart (nachNeustart): der neue Kern stellt Stopp und −200 aus seinem Zustand wieder her.
  private ohneGestoppteFader(p: Projekt, liste: Soll[]): Soll[] {
    if (!this.ctx.kiGestoppt()) return liste;
    const cypherFader = new Set(cypherSpuren(p).map((n) => `spur/${n}/fader`));
    return liste.filter((r) => !cypherFader.has(r.pfad));
  }
  // Spec 6.36 (gemessen Fix5 K3: Öffnen im Stopp setzte Cyphers Fader auf den Projektwert, die Spur klang mitten im Stopp): beim Öffnen gewinnt das
  // Projekt, aber während des KI-Stopps steht der Fader von Cyphers Spuren auf stumm, wie die Ausblende ihn setzt (auch eine Spur, die im Kern
  // vorher zu einem anderen Projekt gehörte). Die Freigabe fährt sie danach zurück.
  private imStoppStumm(p: Projekt, liste: Soll[]): Soll[] {
    if (!this.ctx.kiGestoppt()) return liste;
    const cypherFader = new Set(cypherSpuren(p).map((n) => `spur/${n}/fader`));
    return liste.map((r) => (cypherFader.has(r.pfad) ? { pfad: r.pfad, wert: STUMM } : r));
  }
  // Spec 6.36: Cyphers Fader, die im Kern bekannt stumm stehen (≤ −120), im Projekt aber nicht, und weder in Andreas' Hand noch schon in einer
  // Rückfahrt sind. soll: was nach dem Abgleich zurückfährt; aus: was das Setzen im Abgleich auslässt. Den Stopp-Stand braucht es dafür; kennt
  // der Server ihn noch nicht (Start), wartet er höchstens arrFristMs auf /zustand/kern (20 Hz). Bleibt er unbekannt, fährt nichts zurück und
  // die Fader bleiben stumm (sichere Richtung). Im Stopp: nichts (der Abgleich setzt sie stumm, imStoppStumm).
  // ohne (Spec 6.37): Fader, deren wartende Rückfahrt das Öffnen ohnehin neu plant.
  private async verfalleneRueckfahrt(p: Projekt, ohne: ReadonlyMap<string, number> = new Map()): Promise<{ soll: Soll[]; aus: string[] }> {
    const nr = new Set(cypherSpuren(p));
    const kandidat = alleSpurRegler(p).filter((r) => {
      if (!/^spur\/\d+\/fader$/.test(r.pfad) || !nr.has(spurNr(r.pfad)) || r.wert <= STUMM_GRENZE || ohne.has(r.pfad)) return false;
      const ist = this.lage.reglerWert(r.pfad), halter = this.lage.reglerHalter(r.pfad);
      return ist !== null && ist <= STUMM_GRENZE && halter !== 'mensch' && halter !== `plan:${RUECK_PLAN}`;
    });
    if (!kandidat.length) return { soll: [], aus: [] };
    for (let t0 = Date.now(); this.kiStand === null && Date.now() - t0 < this.arrFristMs;) await schlaf(10);
    if (this.kiStand === null) return { soll: [], aus: kandidat.map((r) => r.pfad) };
    if (this.ctx.kiGestoppt()) return { soll: [], aus: [] };
    return { soll: kandidat, aus: kandidat.map((r) => r.pfad) };
  }
  // Ist-Werte der Spur-Regler, die der Kern gemeldet hat, als EINE Änderung ins Projekt (Quelle andreas, undo-fähig). Unbekannte Werte
  // bleiben. Nachsatz: die Fader-Absenkung des KI-Stopps ist keine Handbewegung, der Fader von Cyphers Spuren bleibt, solange ki_gestoppt gilt.
  private uebernimmMixer(o: Offen): number {
    const befehle: Record<string, unknown>[] = [];
    for (const s of o.projekt.spuren) {
      for (const k of ['fader', 'pan', 'mute', 'solo'] as const) {
        if (k === 'fader' && herkunft(s) === 'cypher' && this.ctx.kiGestoppt()) continue;
        const pfad = `spur/${s.nr}/${k}`, wert = this.lage.reglerWert(pfad);
        // Spec 6.35: die Absenkung kommt nie ins Projekt, auch nicht nach der Freigabe. Kam die Freigabe, während kein Server lief (oder ging
        // die Rückfahrt nicht durch), steht der Fader einer Cypher-Spur im Kern noch stumm: das ist die Absenkung des Stopps, keine Hand.
        // Preis: zieht Andreas den Fader einer Cypher-Spur ohne laufenden Server ganz zu, übernimmt der Wiederanlauf das nicht.
        if (k === 'fader' && herkunft(s) === 'cypher' && wert !== null && wert <= STUMM_GRENZE) continue;
        // Spec 6.36 (Fix5 K4, gemessen: Server-Neustart mitten in der Rückfahrt schrieb −54,2 ins Projekt, der Kern endete auf −3): eine laufende
        // Rückfahrt ist keine Hand. Ihr Halter heißt plan:ki_rueck, ihr Zwischenwert kommt nicht ins Projekt; sie endet ohnehin auf dem Projektwert.
        if (this.lage.reglerHalter(pfad) === `plan:${RUECK_PLAN}`) continue;
        const b = wert === null ? null : reglerZuBefehl(o.projekt, pfad, wert);
        if (b) befehle.push(b.befehl);
      }
    }
    if (!befehle.length) return 0;
    const meta = { quelle: 'andreas' as const, label: 'Mixer nach Wiederanlauf' };
    try {
      const w = aendere(o.verlauf, o.projekt, befehle as never, meta, this.haken(o));
      if (!w.eintrag) return 0;
      w.projekt.wiedergabe_rev = o.projekt.wiedergabe_rev;
      o.projekt = w.projekt;
      this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: w.projekt.rev, label: meta.label, quelle: 'andreas' } });
      return befehle.length;
    } catch (e) {
      this.ctx.log({ typ: 'proj_wiederanlauf_fehler', slug: o.slug, fehler: (e as Error).message });
      return 0;
    }
  }

  // Spec 6.1: neue Wiedergabe-Nummer, Datei schreiben, /k/arr/laden; project.json führt die Nummer als wiedergabe_rev (ohne neue rev)
  private async ladeWiedergabe(quelle: Quelle): Promise<Record<string, unknown>> {
    const o = this.brauchOffen();
    const nr = this.schreibeNeueWiedergabe(o.projekt);
    if (typeof nr !== 'number') return nr;
    this.speichereStand(o);
    return { nr, quittung: await this.kern.laden(nr, quelle) };
  }
  // Wiedergabe-Datei zum Stand p mit der nächsten Nummer schreiben und p.wiedergabe_rev setzen (ohne Speichern, ohne Laden). Gibt die Nummer zurück
  // oder, wenn der Übersetzer ablehnt, {nr: null, fehler, text}.
  private schreibeNeueWiedergabe(p: Projekt): number | Record<string, unknown> {
    const nr = this.zaehler.naechste();
    let w;
    try {
      // Spec 6.14, 6.29: freeze.datei ist relativ zum Arbeitsordner
      w = uebersetze(p, { nr, audioOrdner: path.join(this.arbeitsordner, 'audio'), frames: (sha) => this.cache.frames(sha),
        arbeitsordner: this.arbeitsordner });
    } catch (e) {
      if (e instanceof WiedergabeFehler) {
        this.ctx.log({ typ: 'proj_wiedergabe_fehler', grund: e.grund });
        return { nr: null, fehler: e.grund, text: grundText(e.grund), detail: e.message };   // Spec 6.34: text englisch
      }
      throw e;
    }
    schreibeWiedergabe(this.arbeitsordner, w);
    p.wiedergabe_rev = nr;
    return nr;
  }
  // Für vollziehe, unmittelbar vor der einen Speicherung: während der Freeze-Sperre (Spec 6.23, 6.30) merken statt schreiben, sonst die Wiedergabe
  // zum neuen Stand schreiben. Rückgabe: {nr} zum Laden nach dem Speichern, {nr: null, aufgeschoben} oder {nr: null, fehler, text}.
  private bereiteWiedergabe(o: Offen, p: Projekt): Record<string, unknown> {
    if (this.sperren > 0) { o.merk.laden = true; return { nr: null, aufgeschoben: true }; }
    const nr = this.schreibeNeueWiedergabe(p);
    return typeof nr === 'number' ? { nr } : nr;
  }

  // Spec 6.15, 6.22: Cyphers Spuren (Feld von) in die KI-Maske. Gesendet wird nur, wenn sich die Liste ändert; immer beim Öffnen und nach einem
  // Neustart des Kerns. Absender ist der Server (andreas): die Maske gehört dem Leitstand, nicht der KI. Eine abgelehnte Liste gilt nicht als
  // gesendet und wird bei der nächsten Gelegenheit erneut versucht.
  private async kiMaske(immer: boolean): Promise<Record<string, unknown> | null> {
    const o = this.brauchOffen();
    const liste = kiSpurListe(cypherSpuren(o.projekt));
    if (!immer && liste === this.letzteKiListe) return null;
    const q = await this.kern.kiSpur(liste, 'andreas');
    if (quittungOk(q)) this.letzteKiListe = liste;
    return { kanaele: liste, quittung: q };
  }

  // --- Dekodier-Cache (Spec 2.8) ----------------------------------------------------------------------------------------
  private zustandVon(sha: string): DekodiertZustand { return this.cache.zustand(sha); }
  // Pfad einer Quelle: über den Katalog (Spec 2.9: sha ist die Identität, der Pfad nur Hinweis); ohne Katalog-Treffer der Hinweis, wenn da.
  private quellPfad(sha: string, hinweis: string): string | null {
    if (this.katalog) {
      try {
        const z = this.katalog.eintrag(sha);
        if (z && z.schutz !== 'ableton' && z.pfad && fs.existsSync(z.pfad)) return z.pfad;
      } catch { /* Katalog fehlt oder ist kaputt: Hinweis versuchen */ }
    }
    return hinweis && fs.existsSync(hinweis) ? hinweis : null;
  }
  // Setzt dekodiert aller Audio-Clips (ohne rev, Spec 6.6) und fordert fehlende Dekodierungen an. fehlerNeu: auch Fehlgeschlagene neu versuchen.
  private gleicheDekodiertAb(p: Projekt, fehlerNeu: boolean): boolean {
    let anders = false;
    for (const s of p.spuren) for (const c of s.clips) {
      if (c.art !== 'audio') continue;
      let z = this.zustandVon(c.quelle.sha256);
      if (z === 'nein' || (fehlerNeu && z === 'fehler')) {
        const pfad = this.quellPfad(c.quelle.sha256, c.quelle.pfad_hinweis);
        z = pfad ? this.cache.fordereAn(c.quelle.sha256, pfad) : 'fehler';
      }
      if (c.dekodiert !== z) { c.dekodiert = z; anders = true; }
    }
    return anders;
  }
  private dekodiertEreignis(e: DekodierEreignis): void {
    void this.seriell(async () => {
      const o = this.offen;
      if (!o) return;
      let fertig = false;
      for (const s of o.projekt.spuren) for (const c of s.clips) {
        if (c.art !== 'audio' || c.quelle.sha256 !== e.sha || c.dekodiert === e.zustand) continue;
        c.dekodiert = e.zustand;
        if (e.zustand === 'fertig') fertig = true;
        this.ctx.verteile({ a: 'proj', f: { clip_id: c.id, dekodiert: e.zustand } });   // ohne neue rev (Festlegung V1)
      }
      if (fertig) await this.ladeOderMerke('andreas');
    }).catch((x) => this.ctx.log({ typ: 'proj_dekodier_fehler', sha: e.sha, fehler: (x as Error).message }));
  }

  // --- ändern -----------------------------------------------------------------------------------------------------------
  // Audio-Clips nur aus dem Katalog (Spec 2.11): sha256 → Pfad; Ableton-geschützt, Datei fehlt, unbekannt werden abgelehnt.
  private loeseQuellenAuf(befehle: unknown[]): { befehle: unknown[]; quellen: Map<string, string> } {
    const quellen = new Map<string, string>();
    const aus = befehle.map((b, index) => {
      const x = b as Koerper;
      if (!x || typeof x !== 'object' || x.befehl !== 'clip_neu' || x.art !== 'audio' || typeof x.sha256 !== 'string') return b;
      if (!this.katalog) throw new ProjFehler(503, 'katalog_fehlt', { index });
      const z = this.katalog.eintrag(x.sha256);
      if (!z) throw new ProjFehler(404, 'sha_unbekannt', { index });
      if (z.schutz === 'ableton') throw new ProjFehler(409, 'nur_live', { index });
      if (!z.pfad || !fs.existsSync(z.pfad)) throw new ProjFehler(409, 'quelle_fehlt', { index });
      quellen.set(z.sha, z.pfad);
      return { ...x, sha256: z.sha, pfad_hinweis: z.pfad };
    });
    return { befehle: aus, quellen };
  }
  private pruefeRev(o: Offen, rev: unknown): void {
    if (rev !== o.projekt.rev) throw new ProjFehler(409, 'rev_veraltet', { rev: o.projekt.rev });
  }

  aendern(d: Koerper, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      const o = this.brauchOffen();
      this.riegel(quelle);
      this.pruefeRev(o, d.rev);
      if (!Array.isArray(d.befehle) || d.befehle.length === 0) {
        throw new ProjFehler(400, 'argument_ungueltig', { text: 'befehle: a non-empty list of commands is required' });
      }
      const meta = { quelle, label: d.label as string };
      o.verlauf.pruefeMeta(meta);
      const { befehle, quellen } = this.loeseQuellenAuf(d.befehle);
      if (befehle.some((b) => (b as Koerper)?.befehl === 'tempo_setzen') && this.lage.deckLaeuft()) throw new ProjFehler(409, 'deck_laeuft');
      const probe = fuehreListeAus(o.projekt, befehle, { quelle });   // quelle: Herkunft für spur_neu (Spec 6.22)
      if (probe.vor.length === 0) return { code: 200, j: { rev: o.projekt.rev, projekt: o.projekt } };
      this.pruefeSperre(o.projekt, probe.projekt, probe.betrifft_wiedergabe);
      // Spec 6.31 (Leistung): die Probe IST die Ausführung; aendere rechnet sie nicht noch einmal. Gültig, weil vollziehe nach dem Warten auf die
      // Quittungen prüft, dass o.projekt noch genau der Stand ist, gegen den sie gerechnet wurde (sonst 409 rev_veraltet).
      const projekt = o.projekt;
      return this.vollziehe(o, quelle, probe.regler_aenderungen, (h) => aendere(o.verlauf, projekt, befehle as never, meta, h, { ergebnis: probe }),
        quellen, probe.betrifft_wiedergabe, probe.projekt);
    });
  }

  umkehr(art: 'undo' | 'redo', d: Koerper, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      const o = this.brauchOffen();
      this.riegel(quelle);
      this.pruefeRev(o, d.rev);
      const ziel = art === 'undo' ? o.verlauf.naechstesUndo() : o.verlauf.naechstesRedo();
      let probe: Projekt;
      try { probe = wende(o.projekt, art === 'undo' ? ziel.zurueck : ziel.vor); } catch (e) {
        if (e instanceof PatchFehler) throw new ProjFehler(409, 'verlauf_inkonsistent', { detail: e.message });   // R2: deutsche Meldung nur als detail
        throw e;
      }
      setzeDekodiert(probe, (sha) => this.zustandVon(sha));
      if (probe.tempo_bpm !== o.projekt.tempo_bpm && this.lage.deckLaeuft()) throw new ProjFehler(409, 'deck_laeuft');
      const vergleich = vergleiche(o.projekt, probe);
      this.pruefeSperre(o.projekt, probe, vergleich.betrifft_wiedergabe);
      const f = art === 'undo' ? rueckgaengig : wiederholen;
      // Spec 6.31 (Leistung): die Probe ist der Stand; der Verlauf wendet den Patch nicht noch einmal an (gültig wie in aendern, über die rev-Prüfung)
      const projekt = o.projekt;
      return this.vollziehe(o, quelle, vergleich.regler_aenderungen, (h) => f(o.verlauf, projekt, { quelle }, h, { ziel, stand: probe, vergleich }), new Map(),
        vergleich.betrifft_wiedergabe, probe);
    });
  }

  // Regler zuerst (Quittungen abwarten), dann speichern. Spec 3.4: Ablehnung eines /k/teil setzt die Änderung zurück.
  // Spec 6.30 (Leistung): betrifft die Änderung die Wiedergabe, entsteht diese vor dem Speichern (im Haken speichere), und die EINE Speicherung
  // trägt ihre Nummer schon als wiedergabe_rev. Vorher speicherte ladeWiedergabe den Stand gleich danach ein zweites Mal.
  private async vollziehe(o: Offen, quelle: Quelle, regler: Soll[], schreibe: (h: Haken) => Wirkung, quellen: Map<string, string>,
    betrifftWiedergabe: boolean, neuStand: Projekt): Promise<Antwort> {
    const alt = o.projekt;
    // Spec 6.36: Andreas' Hand gewinnt auch während der Rückfahrt. Setzt er einen Fader, dessen Rückfahrt läuft, bricht der Server erst sie ab
    // (nur deren Teile), dann setzt er Andreas' Wert; sonst lehnte der Kern das Setzen mit ueberlappung ab (409, zurückgedreht).
    // Spec 6.37 (Re-Review Fix5 R2: der Abbruch lief, bevor feststand, ob der Kern den Wert annimmt; in die Ausblende hinein lehnte er ab, die
    // Spur stand ohne Stopp stumm): wartet die Rückfahrt noch auf das Ende der Ausblende, wird Andreas' Wert ihr Ziel. Abbruch der wartenden,
    // dann dieselbe Rückfahrt auf seinen Wert ab demselben Start. Nicht während eines Stopps: dann gibt es keine Rückfahrt (der Stopp bricht sie
    // ab), die Ausblende bleibt, wie bisher.
    // Spec 6.37 (Fix8 V1): dasselbe für den eigenen Weg (Andreas' Spur nach einem Projektwechsel, zielNachAusblende): sein neuer Wert wird dessen Ziel.
    // Spec 6.37 (D1 S3 Auftrag 17 a, Re-Review Fix8 Probe L: Andreas löschte während einer wartenden Rückfahrt Cyphers Spur und legte auf demselben
    // Slot eine eigene an; sein Fader landete in this.rueckfahrt, ein neuer Stopp setzte ihn −200, die Freigabe fuhr ihn nicht zurück): in
    // this.rueckfahrt stehen nach jeder Änderung nur Fader von Cyphers Spuren des NEUEN Stands. Gehört ein Slot mit Rückfahrt dort nicht mehr Cypher,
    // wird sie abgebrochen; wartete sie noch und setzt die Änderung diesen Fader, kommt sein Wert zum selben Start auf den eigenen Weg (proj_ziel),
    // den weder Stopp noch Freigabe anfassen. Gleich für beide Quellen.
    let direkt = regler;
    const ziel = new Map<string, number>();                              // Pfad → Start der wartenden Rückfahrt
    const eigen = new Map<string, number>();                             // Pfad → Start des wartenden eigenen Wegs
    const beat = this.lage.uhr?.beat ?? -Infinity;
    const cypherNeu = new Set(cypherSpuren(neuStand).map((n) => `spur/${n}/fader`));
    const gesetztePfade = new Set(regler.map((r) => r.pfad));
    const fremd = [...this.rueckfahrt.keys()].filter((p) => !cypherNeu.has(p));
    for (const p of fremd) { const e = this.rueckfahrt.get(p)!; if (e.ab > beat && gesetztePfade.has(p)) eigen.set(p, e.ab); }
    if (fremd.length) await this.rueckfahrtAbbrechen(fremd);
    if (quelle === 'andreas') {
      const fader = regler.map((r) => r.pfad).filter((p) => /^spur\/\d+\/fader$/.test(p));
      for (const p of fader) {
        const e = this.rueckfahrt.get(p), w = this.zielWeg.get(p);
        if (e && e.ab > beat) ziel.set(p, e.ab); else if (w && w.ab > beat && !eigen.has(p)) eigen.set(p, w.ab);
      }
      await Promise.all([this.rueckfahrtAbbrechen(fader), this.zielWegAbbrechen(fader)]);
    }
    if (ziel.size || eigen.size) direkt = regler.filter((r) => !ziel.has(r.pfad) && !eigen.has(r.pfad));
    const [gesetzt, gefahren, spaeter] = await Promise.all([this.kern.setzeRegler(direkt, quelle),
      this.rueckfahrtAufZiel(regler.filter((r) => ziel.has(r.pfad)), ziel), this.rueckfahrtAufZiel(regler.filter((r) => eigen.has(r.pfad)), eigen, true)]);
    const ergebnis = [...gesetzt, ...gefahren, ...spaeter];
    const zurueck = (stand: Projekt): Promise<void> => this.reglerZurueck(stand, gesetzt, quelle, gefahren, ziel, spaeter, eigen);
    // Spec 6.30: nach dem await die rev noch einmal gegen den offenen Stand. S3 setzt ihn über uebernimm() synchron, auch während diese
    // Änderung auf ihre Quittungen wartet; geprüft wurde sie gegen alt. Ihre Regler gehen dann auf den offenen Stand zurück.
    if (this.offen !== o || o.projekt !== alt || o.projekt.rev !== alt.rev) {
      await zurueck(o.projekt);
      if (this.offen !== o) throw new ProjFehler(409, 'kein_projekt');
      throw new ProjFehler(409, 'rev_veraltet', { rev: o.projekt.rev });
    }
    // Spec 6.30: nur eine echte Ablehnung dreht zurück. Ohne Kern (Quittung null) gilt die Änderung wie eine Noten-Änderung (kern.regler: kein_kern).
    const abgelehnt = ergebnis.filter((r) => quittungAbgelehnt(r.quittung));
    if (abgelehnt.length) {
      await zurueck(alt);
      throw new ProjFehler(409, 'regler_abgelehnt', { regler: abgelehnt });
    }
    // Haken-Vertrag mit verlauf.ts (speichereDannProtokolliere, Spec 6.31 festgehalten): speichere wird genau einmal mit dem NEUEN Stand gerufen, vor
    // dem Log-Eintrag; nur wenn das Log scheitert, folgt ein zweiter Aufruf mit dem alten Stand (zurückschreiben). vollziehe hängt an genau dieser
    // Reihenfolge: nur der erste Aufruf fordert Dekodieren an, gleicht dekodiert ab und schreibt die Wiedergabe (bereiteWiedergabe prüft die
    // Freeze-Sperre), damit die eine Speicherung die neue wiedergabe_rev trägt. Ruft verlauf.ts speichere anders (öfter, später, mit einem anderen
    // Stand zuerst), entstünde die Wiedergabe zum falschen Stand; Tests: proj_fix_b4_speichern, projekt_verlauf.
    const vorab: { wiedergabe: Record<string, unknown> | null; erster: boolean } = { wiedergabe: null, erster: true };
    const haken: Haken = { ...this.haken(o), speichere: (p) => {
      if (vorab.erster) {
        vorab.erster = false;
        for (const [sha, pfad] of quellen) {
          try { this.cache.fordereAn(sha, pfad); } catch (e) { this.ctx.log({ typ: 'proj_dekodier_fehler', sha, fehler: (e as Error).message }); }
        }
        const dekodiertAnders = this.gleicheDekodiertAb(p, false);
        if (betrifftWiedergabe || dekodiertAnders) vorab.wiedergabe = this.bereiteWiedergabe(o, p);
      }
      this.projekte.speichere(o.slug, p);
    } };
    let w: Wirkung;
    try { w = schreibe(haken); } catch (e) { await zurueck(alt); throw e; }
    if (!w.eintrag) return { code: 200, j: { rev: alt.rev, projekt: alt } };
    const neu = w.projekt;
    const wiedergabe = vorab.wiedergabe;
    if (typeof wiedergabe?.nr !== 'number') neu.wiedergabe_rev = alt.wiedergabe_rev;   // ohne neue Wiedergabe gilt die alte Nummer
    o.projekt = neu;
    const kern: Record<string, unknown> = {};
    if (ergebnis.length) kern.regler = ergebnis.some((r) => r.quittung === null) ? 'kein_kern' : 'ok';
    if (gefahren.length) kern.rueckfahrt_ziel = gefahren.map((r) => r.pfad);   // Spec 6.37: Andreas' Wert fährt nach dem Ende der Ausblende ein
    if (spaeter.length) kern.ziel_nach_ausblende = spaeter.map((r) => r.pfad);
    // Spec 6.30: die Freeze-Sperre gilt bis zum Laden. bereiteWiedergabe prüfte sie nach den Regler-Quittungen, zwischen dort und /k/arr/laden liegt
    // kein await. War sie gesetzt, bleibt die Änderung gespeichert und das Laden folgt nach der Freigabe.
    const nr = wiedergabe?.nr;
    if (wiedergabe) kern.wiedergabe = typeof nr === 'number' ? { nr, quittung: await this.kern.laden(nr, quelle) } : wiedergabe;
    // Spec 6.31: Loop und Tempo sperrt 6.23 wie das Laden. Kam die Änderung vor der Sperre durch die Prüfung, werden sie gemerkt und nach der
    // Freigabe gesendet (holeNach, mit dem Stand von dann). Das Metronom sperrt 6.23 nicht.
    if (kanonisch(alt.loop) !== kanonisch(neu.loop)) {
      if (this.sperren > 0) { o.merk.loop = true; kern.loop = { aufgeschoben: true }; } else kern.loop = await this.kern.loop(neu, quelle);
    }
    if (kanonisch(alt.metronom) !== kanonisch(neu.metronom)) kern.metronom = await this.kern.metronom(neu, quelle);
    if (alt.tempo_bpm !== neu.tempo_bpm) {                                                               // Spec 2.7: ein Tempo-Weg
      if (this.sperren > 0) { o.merk.tempo = true; kern.tempo = { aufgeschoben: true }; } else kern.tempo = await this.kern.tempo(neu.tempo_bpm, quelle);
    }
    const ki = await this.kiMaske(false);
    if (ki) kern.ki = ki;
    this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: neu.rev, label: w.eintrag.label, quelle } });
    return { code: 200, j: { rev: neu.rev, projekt: neu, kern } };
  }
  // Angenommene Regler einer abgelehnten Änderung auf den alten Stand zurück. Spec 6.37: eine Rückfahrt, die die Änderung auf Andreas' Wert
  // umgeplant hat (gefahren, Start je Pfad in ziel), fährt wieder auf den alten Wert, ab demselben Start (direkt setzen ginge nicht in die Ausblende).
  private async reglerZurueck(alt: Projekt, ergebnis: ReglerErgebnis[], quelle: Quelle, gefahren: ReglerErgebnis[] = [],
    ziel: ReadonlyMap<string, number> = new Map(), spaeter: ReglerErgebnis[] = [], eigen: ReadonlyMap<string, number> = new Map()): Promise<void> {
    const vorher = new Map(alleSpurRegler(alt).map((r) => [r.pfad, r.wert] as const));
    const auf = (liste: ReglerErgebnis[]): Soll[] =>
      liste.filter((r) => r.ok && vorher.has(r.pfad)).map((r) => ({ pfad: r.pfad, wert: vorher.get(r.pfad) as number }));
    const zurueck = auf(ergebnis), wieder = auf(gefahren), wiederEigen = auf(spaeter);
    await Promise.all([wieder.length ? this.rueckfahrtAbbrechen(wieder.map((r) => r.pfad)) : null,
      wiederEigen.length ? this.zielWegAbbrechen(wiederEigen.map((r) => r.pfad)) : null]);
    await Promise.all([zurueck.length ? this.kern.setzeRegler(zurueck, quelle) : null, this.rueckfahrtAufZiel(wieder, ziel),
      this.rueckfahrtAufZiel(wiederEigen, eigen, true)]);
  }
  // Spec 6.37: Rückfahrten auf ein neues Ziel (Andreas' Wert), je Pfad ab dem Start der abgebrochenen (ziel: Pfad → Start). Gewartet wird nur das
  // kurze Fenster (die Antwort an die Seite wartet nicht auf den Start). Lehnt der Kern wegen Überlappung ab (Start nur genähert, wie in
  // kiFreigabe), ein zweiter Versuch nach dem spätesten Ende der Ausblende (jetzt + 4).
  // eigen (Fix8 V1): statt der Rückfahrt der eigene Weg (setzeNachAusblende) für einen Fader, der nicht zu Cyphers Spuren gehört. Der zweite
  // Versuch gilt dort auch im Stopp: der Stopp senkt diese Spur nicht.
  private async rueckfahrtAufZiel(liste: readonly Soll[], ziel: ReadonlyMap<string, number>, eigen = false): Promise<ReglerErgebnis[]> {
    if (!liste.length) return [];
    const weg = (soll: readonly Soll[], o: { fruehest?: number; versatz?: number; kurz: boolean }): Promise<ReglerErgebnis[]> =>
      (eigen ? this.setzeNachAusblende(soll, o) : this.fahreZurueck(soll, o));
    const starts = [...new Set(liste.map((r) => ziel.get(r.pfad) as number))];
    const erst = (await Promise.all(starts.map((ab) => weg(liste.filter((r) => ziel.get(r.pfad) === ab), { fruehest: ab, kurz: true })))).flat();
    const ueber = erst.filter((r) => r.quittung?.grund === 'ueberlappung');
    // Kam inzwischen ein neuer Stopp, kein zweiter Versuch (er liefe nach dessen Ausblende auf, mitten im Stopp; wie in kiFreigabe)
    if (!ueber.length || (!eigen && this.ctx.kiGestoppt())) return erst;
    const zweit = await weg(ueber.map((r) => ({ pfad: r.pfad, wert: r.wert })), { versatz: KI_BEATS, kurz: true });
    return [...erst.filter((r) => !ueber.includes(r)), ...zweit];
  }

  // --- Transport (Spec 2.2, 2.7) -----------------------------------------------------------------------------------------
  transport(d: Koerper, quelle: Quelle): Promise<Antwort> {
    return this.seriell(async () => {
      const o = this.brauchOffen();
      this.riegel(quelle);
      if (d.aktion === 'stopp') {
        // Spec 6.37 (Andreas 16.10.: „Cypher stoppt nur einen Transport, den sie selbst gestartet hat“): Cyphers Stopp über Andreas' Lauf wird
        // abgelehnt, nichts gestoppt. Andreas' Stopp stoppt immer. Ohne Lauf (status 0) geht Cyphers Stopp durch, er ist ohne Wirkung.
        if (this.fremderLauf(quelle)) {
          throw new ProjFehler(409, 'transport_laeuft', { text: 'a transport Andreas started is running; Cypher stops only a transport she started' });
        }
        const q = await this.kern.stopp(quelle);
        if (quittungOk(q)) this.transportQuelle = null;
        return { code: 200, j: { ok: quittungOk(q), quittung: q } };
      }
      if (d.aktion !== 'start') throw new ProjFehler(400, 'aktion_unbekannt');
      const beat = d.beat === undefined ? 0 : d.beat;
      if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 0 || beat > MAX_BEAT) throw new ProjFehler(400, 'beat_ungueltig');
      // Spec 6.37 Nachtrag (Re-Review Fix7 RR7-2, rr7 T_start: der Kern beendet beim Start einen laufenden Lauf, kern_arr.cpp:97, und Cypher wurde
      // Starterin; ihr Stopp ging danach durch): Cyphers Start über Andreas' Lauf (oder einen unbekannten) wird abgelehnt, nichts gesendet. Geprüft
      // vor der Tempo-Rampe und noch einmal unmittelbar vor /k/arr/start (Andreas kann während der Rampe am Gerät starten).
      this.sperreFremderStart(quelle);
      this.sperreTransport();                                            // Spec 6.32: vor der Tempo-Rampe
      const tempo = await this.tempoVorStart(o.projekt.tempo_bpm, quelle);
      if (tempo.fehler) throw new ProjFehler(tempo.fehler === 'kein_kern' ? 503 : 409, tempo.fehler as string, { tempo });
      this.sperreFremderStart(quelle);
      this.sperreTransport();                                            // und unmittelbar vor /k/arr/start (die Sperre kann während der Rampe kommen)
      const quant = this.lage.djLaeuft() ? 2 : 0;
      // Spec 6.37 (D1 S3 Auftrag 17 b, Re-Review Fix8 Probe K, am Stapel gemessen: mit quant 2 kam die Quittung erst 1,87 s nach dem Absenden, bis
      // dahin galt der Lauf noch als Cyphers, und ein Stop Cypher in diesem Fenster stoppte Andreas' Lauf): der Start gehört ab dem Absenden dem,
      // der ihn sendet (der Kern beendet beim Start den laufenden Lauf, kern_arr.cpp:97). Lehnt der Kern ab oder antwortet nicht, gilt wieder der
      // vorige, sofern nichts anderes (Hand-Taste, KI-Stopp, Stopp) inzwischen entschieden hat.
      const vorher = this.transportQuelle;
      this.transportQuelle = quelle;
      const q = await this.kern.start(beat, quant, quelle);
      if (!quittungOk(q) && this.transportQuelle === quelle) this.transportQuelle = vorher;
      return { code: 200, j: { ok: quittungOk(q), quittung: q, quant, start_beat: beat, tempo } };
    });
  }
  // Spec 6.37 Nachtrag: Cyphers Start, solange ein Transport läuft oder wartet, den sie nicht selbst gestartet hat (fremderLauf)
  private sperreFremderStart(quelle: Quelle): void {
    if (!this.fremderLauf(quelle)) return;
    throw new ProjFehler(409, 'transport_laeuft', {
      text: 'a transport Andreas started is running; Cypher starts the transport only when none of his is running',
    });
  }
  // Spec 6.32: ein Freeze ist ein Transport-Lauf; Start und Tempo-Rampe brechen ihn ab oder verändern die Datei. Stopp bleibt erlaubt.
  private sperreTransport(): void {
    if (this.sperren > 0) throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; transport start waits until it is done' });
  }
  // Spec 6.32: für POST /tempo des Seiten-Servers (Studio-Route und Werkzeug tempo): läuft gerade eine Freeze-Sperre?
  ladenGesperrt(): boolean { return this.sperren > 0; }
  // Spec 2.7: Projekttempo beim Start setzen, wenn das Master-Tempo abweicht und kein Deck läuft; der Start wartet das Rampen-Ende ab.
  // Spec 6.30: läuft /uhr uhrStillMs lang nicht weiter (kein Kern), bricht das Warten mit kein_kern ab, statt die Kette zu halten.
  private async tempoVorStart(ziel: number, quelle: Quelle): Promise<Record<string, unknown>> {
    const u = this.lage.uhr;
    if (!u || Math.abs(u.bpm - ziel) < 0.005) return { gesetzt: false };
    if (this.lage.deckLaeuft()) return { gesetzt: false, grund: 'deck_laeuft', text: grundText('deck_laeuft'), master_bpm: u.bpm };
    const r = await this.kern.tempo(ziel, quelle);
    if (!r || !quittungOk(r.quittung)) return { gesetzt: false, fehler: 'tempo_abgelehnt', text: grundText('tempo_abgelehnt'), quittung: r?.quittung ?? null };
    const ende = r.ab_beat + r.dauer_beats, t0 = Date.now();
    let beat = this.lage.uhr?.beat ?? -Infinity, seit = t0;
    while (!(this.lage.uhr && this.lage.uhr.beat >= ende)) {
      const jetzt = Date.now(), b = this.lage.uhr?.beat ?? -Infinity;
      if (b > beat) { beat = b; seit = jetzt; } else if (jetzt - seit > this.uhrStillMs) {
        return { gesetzt: true, fehler: 'kein_kern', text: grundText('kein_kern'), ab_beat: r.ab_beat };
      }
      if (jetzt - t0 > this.rampeWarteMs) return { gesetzt: true, fehler: 'rampe_haengt', text: grundText('rampe_haengt'), ab_beat: r.ab_beat };
      await schlaf(20);
    }
    return { gesetzt: true, ziel_bpm: r.ziel_bpm, ab_beat: r.ab_beat };
  }

  // --- Sperre (P4, Spec 6.23) und Zugang für S3 (P5) ---------------------------------------------------------------------------------------
  // Während eines Freeze lädt der Server nicht neu: jedes Laden bricht den Echtzeit-Durchlauf im Kern ab. Gesperrt sind Änderungen, die die
  // Wiedergabe berühren (Noten, Clips, Spuren anlegen, löschen, verschieben, Gerät, Tempo, Loop); Mixer (Regler) bleibt frei.
  // Spec 6.32: solange ein Öffnen oder Anlegen läuft, 409 beschaeftigt (wer zuerst kommt, gewinnt; S3 startet den Freeze dann nicht).
  sperreLaden(): () => void {
    if (this.oeffnet > 0) throw new ProjFehler(409, 'beschaeftigt', { text: 'a project is being opened; a freeze waits until it is open' });
    this.sperren += 1;
    let frei = false;
    return () => {
      if (frei) return;
      frei = true;
      this.sperren -= 1;
      const o = this.offen;
      if (this.sperren > 0 || !o || !(o.merk.laden || o.merk.loop || o.merk.tempo)) return;
      // Spec 6.31: das Nachholen läuft in der Kette, also später. Ist das Projekt bis dahin geschlossen, verfällt es; setzt S3 inzwischen eine
      // neue Sperre (nächster Freeze), prüft holeNach sie direkt vor jedem Senden und lässt den Rest gemerkt bis zu deren Freigabe.
      void this.seriell(async () => { if (this.offen === o) await this.holeNach(o); })
        .catch((x) => this.ctx.log({ typ: 'proj_nachladen_fehler', fehler: (x as Error).message }));
    };
  }
  private async holeNach(o: Offen): Promise<void> {
    const ergebnis: Record<string, unknown> = {};
    if (o.merk.laden) {
      if (this.sperren > 0) return;
      ergebnis.wiedergabe = await this.ladeWiedergabe('andreas');
      o.merk.laden = false;                                              // erst nach dem gelungenen Laden: wirft es, bleibt es gemerkt (Fix3 G9)
    }
    if (o.merk.loop) {
      if (this.sperren > 0 || this.offen !== o) return;
      o.merk.loop = false;
      ergebnis.loop = await this.kern.loop(o.projekt, 'andreas');
    }
    if (o.merk.tempo) {
      if (this.sperren > 0 || this.offen !== o) return;
      o.merk.tempo = false;
      ergebnis.tempo = await this.kern.tempo(o.projekt.tempo_bpm, 'andreas');
    }
    this.ctx.log({ typ: 'proj_nachgeholt', slug: o.slug, ...ergebnis });
  }
  private pruefeSperre(alt: Projekt, neu: Projekt, betrifftWiedergabe: boolean): void {
    if (this.sperren === 0) return;
    if (betrifftWiedergabe || alt.tempo_bpm !== neu.tempo_bpm || kanonisch(alt.loop) !== kanonisch(neu.loop)) {
      throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; changes to the playback wait until it is done' });
    }
  }
  // Laden, außer während der Sperre: dann merken und bei der letzten Freigabe nachholen
  private async ladeOderMerke(quelle: Quelle): Promise<Record<string, unknown>> {
    if (this.sperren > 0) { this.brauchOffen().merk.laden = true; return { nr: null, aufgeschoben: true }; }
    return this.ladeWiedergabe(quelle);
  }
  // Loop ebenso (Spec 6.31, 6.32): während der Sperre gemerkt, nach der Freigabe mit dem Stand von dann gesendet
  private async loopOderMerke(o: Offen, quelle: Quelle): Promise<unknown> {
    if (this.sperren > 0) { o.merk.loop = true; return { aufgeschoben: true }; }
    return this.kern.loop(o.projekt, quelle);
  }

  zugangOffen(): { slug: string; ordner: string; projekt: Projekt; verlauf: Verlauf } | null {
    const o = this.offen;
    return o ? { slug: o.slug, ordner: path.resolve(this.projekte.wurzelPfad, o.slug), projekt: o.projekt, verlauf: o.verlauf } : null;
  }
  zugangHaken(): Haken { return this.haken(this.brauchOffen()); }
  // Spec 6.34: S3 meldet Beginn (art, beim Freeze spur_id) und Ende (null) jedes Laufs; nur diese Form geht an die Seite
  setzeAusgabeLauf(l: AusgabeLauf | null): void {
    this.ausgabeLauf = l === null ? null : l.art === 'freeze' ? { art: 'freeze', spur_id: l.spur_id } : { art: 'export' };
  }
  // Spec 6.25: die nächste Nummer des einen Wiedergabe-Zählers der Instanz (derselbe wie für /k/arr/laden, mit Zustandsdatei, Spec 6.30), für die
  // Freeze-Kennung. Eine Kennung kommt so nie zweimal und nie gleich einer Wiedergabe-Nummer.
  naechsteNummer(): number { return this.zaehler.naechste(); }
  // Wiedergabe-Datei mit der nächsten Nummer des einen Zählers, ohne /k/arr/laden (Plan S3: Freeze, Export)
  schreibeWiedergabeFuer(p: Projekt): { nr: number; datei: string } {
    const nr = this.zaehler.naechste();
    const w = uebersetze(p, { nr, audioOrdner: path.join(this.arbeitsordner, 'audio'), frames: (sha) => this.cache.frames(sha),
      arbeitsordner: this.arbeitsordner });
    return { nr, datei: schreibeWiedergabe(this.arbeitsordner, w) };
  }
  // Was /proj/aendern nach aendere() tut, für einen Schreiber außerhalb (S3): Stand synchron setzen, dann nachziehen. Die Freeze-Sperre lehnt hier
  // nichts ab (der Stand ist schon gesetzt), aber sie gilt für das Senden (Spec 6.32): unmittelbar vor Laden und Loop wird sie geprüft wie in holeNach;
  // gesperrt (auch die eigene des Aufrufers oder die des nächsten Freeze) bleibt beides am Offen gemerkt und folgt nach der letzten Freigabe.
  uebernimm(w: Wirkung, meta: Meta): Promise<void> {
    const o = this.brauchOffen();
    if (!w.eintrag) return Promise.resolve();
    const alt = o.projekt, neu = w.projekt, quelle = meta.quelle;
    neu.wiedergabe_rev = alt.wiedergabe_rev;
    o.projekt = neu;                                                     // synchron, vor dem ersten await
    return this.seriell(async () => {
      if (this.offen !== o) return;                                      // inzwischen geschlossen
      const regler = await this.kern.setzeRegler(w.regler_aenderungen, quelle);
      const abgelehnt = regler.filter((r) => quittungAbgelehnt(r.quittung)), keinKern = regler.filter((r) => r.quittung === null);   // Spec 6.31
      if (abgelehnt.length || keinKern.length) {
        this.ctx.log({ typ: 'proj_uebernimm_regler', slug: o.slug, abgelehnt: abgelehnt.map((r) => r.pfad), kein_kern: keinKern.map((r) => r.pfad) });
      }
      const dekodiertAnders = this.gleicheDekodiertAb(neu, false);
      if (w.betrifft_wiedergabe || dekodiertAnders) await this.ladeOderMerke(quelle);
      if (kanonisch(alt.loop) !== kanonisch(neu.loop)) await this.loopOderMerke(o, quelle);
      if (kanonisch(alt.metronom) !== kanonisch(neu.metronom)) await this.kern.metronom(neu, quelle);
      this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: neu.rev, label: w.eintrag.label, quelle } });
    });
  }
  // Projekttempo an den Master auf dem einen Tempo-Weg (Spec 2.7), zurück erst nach dem Rampen-Ende. deck_laeuft nur, wenn das Master-Tempo
  // abweicht UND ein Deck läuft.
  async tempoAnMaster(): Promise<void> {
    const o = this.brauchOffen();
    const t = await this.tempoVorStart(o.projekt.tempo_bpm, 'andreas');
    const grund = (t.fehler ?? t.grund) as string | undefined;
    if (grund) throw new ProjFehler(grund === 'kein_kern' ? 503 : 409, grund, { tempo: t });
  }

  // --- Kern-Ereignisse (Haken ereignis, Spec 2.10) ---------------------------------------------------------------------
  ereignis(adresse: string, f: Record<string, unknown>): void {
    const { neustart } = this.lage.nimm(adresse, f);
    if (adresse === '/e/regler' && f.halter === 'mensch' && istSpurRegler(String(f.pfad))) this.rueckweg(String(f.pfad), Number(f.wert));
    // /zustand/arr status 0 setzt transportQuelle bewusst nicht zurück: der Kern beendet Cyphers Transport beim KI-Stopp selbst (kern_arr.cpp:190,
    // kern_stellwerk.cpp:353), sein status 0 kann vor /e/ki eintreffen. Das zweite Stopp als andreas ist dann ohne Wirkung;
    // ein neuer Start überschreibt die Quelle.
    // Spec 6.37 (REVIEW-5-opus M2): die Hand-Taste am Gerät führt der Kern selbst aus (kern_arr.cpp arr_hand_start_stopp) und meldet danach
    // /e/hand arr/start_stopp mit wert 1 (nur beim Druck; die Attrappe meldet auch das Loslassen mit 0). Ein Start oder Stopp dort gehört
    // Andreas: Stop Cypher stoppt danach nichts, bis Cypher selbst wieder startet.
    if (adresse === '/e/hand' && f.pfad === 'arr/start_stopp' && Number(f.wert) >= 0.5) this.transportQuelle = 'andreas';
    if (adresse === '/e/ki' && Number(f.gestoppt) === 1 && this.transportQuelle === 'cypher') this.kiStoppTransport();
    this.kiWechsel(adresse, f);
    if (neustart) this.nachNeustart();
  }
  // Spec 6.35: Stopp und Freigabe aus /e/ki (mit Sample) oder, falls das verloren ging, aus dem periodischen /zustand/kern (ki_gestoppt).
  // Nur der Wechsel gestoppt → frei ist eine Freigabe; ein Server, der erst nach dem Stopp startet, kennt den Stopp aus /zustand/kern.
  private kiWechsel(adresse: string, f: Record<string, unknown>): void {
    const roh = adresse === '/e/ki' ? f.gestoppt : adresse === '/zustand/kern' ? f.ki_gestoppt : undefined;
    if (roh === undefined) return;
    const gestoppt = Number(roh) === 1, war = this.kiStand;
    this.kiStand = gestoppt;
    if (gestoppt && adresse === '/e/ki') this.kiStoppBeat = this.lage.beatVonSample(Number(f.sample));
    else if (gestoppt && war !== true) this.kiStoppBeat = null;
    if (gestoppt && war !== true) this.rueckfahrtAbbrechen(null, true);   // Spec 6.36, 6.37: nur beim Wechsel (/zustand/kern kommt mit 20 Hz)
    if (war === true && !gestoppt) this.kiFreigabe();
  }
  // Spec 6.36: Rückfahrten, die noch warten oder laufen (Ende nach dem jetzigen Beat), dazu jede, deren Teil der Kern als Halter meldet
  // (plan:ki_rueck, etwa von einem Server vor einem Neustart). pfade: nur diese Fader (null: alle).
  private offeneRueckfahrt(pfade: readonly string[] | null): string[] {
    const beat = this.lage.uhr?.beat ?? -Infinity;
    for (const [p, e] of this.rueckfahrt) if (e.ende <= beat) this.rueckfahrt.delete(p);
    const kandidaten = pfade ?? [...new Set([...this.rueckfahrt.keys(), ...Array.from({ length: 8 }, (_, i) => `spur/${i + 1}/fader`)])];
    return kandidaten.filter((p) => this.rueckfahrt.has(p) || this.lage.reglerHalter(p) === `plan:${RUECK_PLAN}`);
  }
  // Spec 6.36: ein neuer KI-Stopp gewinnt. Der Kern bricht beim Stopp nur Teile an Fadern über der Stummgrenze ab (ki.cpp ki_fader_ab); eine
  // Rückfahrt, die noch wartet (Fader −200, Start erst am Ende der Ausblende), liefe sonst nach dem Stopp auf den Projektwert. Der Server bricht
  // seine Rückfahrt darum selbst ab, sobald er den Stopp sieht, synchron im Ereignis (nicht in der Kette, die gerade warten kann).
  // Spec 6.37 (Re-Review Fix5 R1, am Kern gemessen: startet die wartende Rückfahrt, bevor der Abbruch ankommt, hält der Abbruch den Fader bei
  // etwa −59 dB, mitten im Stopp): stumm (beim Stopp) setzt nach der Quittung des Abbruchs −200 nach, solange der Stopp gilt. Gleich in welcher
  // Reihenfolge Abbruch und Start den Kern erreichen, endet die Spur so stumm: kam der Abbruch zuerst, steht der Fader schon bei −200 und das
  // Setzen ist ohne Wirkung; lief die Rückfahrt beim Stopp schon, blendet der Kern selbst aus und lehnt das Setzen ab (ueberlappung, nur Protokoll).
  private rueckfahrtAbbrechen(pfade: readonly string[] | null, stumm = false): Promise<Quittung> | null {
    const offen = this.offeneRueckfahrt(pfade);
    for (const p of offen) this.rueckfahrt.delete(p);
    if (!offen.length) return null;
    const q = this.kern.abbruch(RUECK_PLAN, offen.map(spurNr), 'andreas');
    void q.then(async (x) => {
      this.ctx.log({ typ: 'proj_rueckfahrt_abbruch', pfade: offen, quittung: x });
      if (!stumm || !this.ctx.kiGestoppt()) return;
      const erg = await this.kern.setzeRegler(offen.map((p) => ({ pfad: p, wert: STUMM })), 'andreas');
      this.ctx.log({ typ: 'proj_rueckfahrt_stumm', pfade: offen, ...reglerBefund(erg) });
    }).catch((e) => this.ctx.log({ typ: 'proj_rueckfahrt_fehler', fehler: (e as Error).message }));
    return q;
  }
  // Spec 6.35 (Andreas 16.10.: „Zurück, über 4 Beats“): nach der KI-Freigabe fahren Cyphers Spuren (die Maske aus dem Feld von, die der Stopp
  // gesenkt hat) über 4 Beats auf ihren Fader-Wert im Projekt zurück, Quelle andreas wie der Stopp. Gemessen (messungen fix4, probe_ki_frei):
  // Kern und Attrappe melden bei der Freigabe nur /e/ki 0, die Fader bleiben bei −200; eine Rampe, die die Ausblende des Stopps (4 Beats ab dem
  // Stopp, interner Teil) überlappt, lehnen beide mit ueberlappung ab, eine ab deren Ende nimmt der Kern an. Deshalb frühestens ab dem Ende der
  // Ausblende; ist der Stopp-Beat unbekannt oder nur genähert und lehnt der Kern ab, ein zweiter Versuch nach deren spätestem Ende (jetzt + 4).
  // Gesendet wird in der Kette (Stand des Projekts), gewartet auf die Quittungen außerhalb: eine spätere Rampe quittiert erst bei ihrem Start.
  private kiFreigabe(): void {
    const stopp = this.kiStoppBeat;
    this.kiStoppBeat = null;
    void this.seriell(async () => {
      const o = this.offen;
      if (!o || this.ctx.kiGestoppt()) return null;
      const nrs = new Set(cypherSpuren(o.projekt).map((n) => `spur/${n}/fader`));
      const soll = alleSpurRegler(o.projekt).filter((r) => nrs.has(r.pfad));
      if (!soll.length) return null;
      return { o, soll, erste: this.fahreZurueck(soll, { fruehest: stopp === null ? null : stopp + KI_BEATS }) };
    }).then(async (x) => {
      if (!x) return;
      let erg = await x.erste;
      const ueber = erg.filter((r) => r.quittung?.grund === 'ueberlappung');
      // Spec 6.37: ein Fader, dessen Rückfahrt inzwischen neu geplant ist (Andreas' Griff, rueckfahrtAufZiel), fährt nicht noch einmal auf den alten Wert
      const nochmal = ueber.filter((r) => !this.rueckfahrt.has(r.pfad));
      if (nochmal.length && this.offen === x.o && !this.ctx.kiGestoppt()) {
        const zweit = await this.fahreZurueck(nochmal.map((r) => ({ pfad: r.pfad, wert: r.wert })), { versatz: KI_BEATS });
        erg = [...erg.filter((r) => !nochmal.includes(r)), ...zweit];
      }
      this.ctx.log({ typ: 'proj_ki_freigabe', slug: x.o.slug, stopp_beat: stopp, pfade: x.soll.map((r) => r.pfad), ...reglerBefund(erg) });
    }).catch((e) => this.ctx.log({ typ: 'proj_ki_freigabe_fehler', fehler: (e as Error).message }));
  }

  // Spec 6.37 (Fix8 V1): den Wert eines Faders, der nicht zu Cyphers Spuren gehört, zum Ende der Ausblende setzen (Dauer 0, Plan proj_ziel, Teil =
  // Spur-Nummer; ein Setzen am Ende einer Rampe überlappt sie nicht, SCHNITTSTELLEN I4). Gemerkt bis zum Start, synchron mit dem Senden.
  private setzeNachAusblende(soll: readonly Soll[], o: { fruehest?: number; versatz?: number; kurz?: boolean }): Promise<ReglerErgebnis[]> {
    const f = this.kern.fahreRegler(soll, 0, 'andreas', { ...o, plan: ZIEL_PLAN, teil: spurNr });
    const nr = ++this.rueckfahrtNr;
    for (const r of soll) this.zielWeg.set(r.pfad, { ab: f.ab, nr });
    return f.ergebnis.then((erg) => {
      for (const r of erg) if (!r.ok && this.zielWeg.get(r.pfad)?.nr === nr) this.zielWeg.delete(r.pfad);   // abgelehnt: nichts wartet
      return erg;
    });
  }
  // Spec 6.37 (Fix8 V1): wartende Setzungen des eigenen Wegs abbrechen (pfade: nur diese, null: alle). Nur Andreas' Griff, ein Projektwechsel und
  // reglerZurueck rufen das; Stopp und Freigabe nie.
  private zielWegAbbrechen(pfade: readonly string[] | null): Promise<Quittung> | null {
    const beat = this.lage.uhr?.beat ?? -Infinity;
    for (const [p, e] of this.zielWeg) if (e.ab <= beat) this.zielWeg.delete(p);
    const offen = [...this.zielWeg.keys()].filter((p) => pfade === null || pfade.includes(p));
    for (const p of offen) this.zielWeg.delete(p);
    if (!offen.length) return null;
    const q = this.kern.abbruch(ZIEL_PLAN, offen.map(spurNr), 'andreas');
    void q.then((x) => this.ctx.log({ typ: 'proj_ziel_abbruch', pfade: offen, quittung: x }))
      .catch((e) => this.ctx.log({ typ: 'proj_ziel_fehler', fehler: (e as Error).message }));
    return q;
  }

  // Spec 6.36: eine Rückfahrt als benannter Plan senden und bis zu ihrem Ende merken (synchron mit dem Senden, damit ein Stopp sie immer sieht)
  private fahreZurueck(soll: readonly Soll[], o: { fruehest?: number | null; versatz?: number; kurz?: boolean }): Promise<ReglerErgebnis[]> {
    const f = this.kern.fahreRegler(soll, KI_BEATS, 'andreas', { ...o, plan: RUECK_PLAN, teil: spurNr });
    const nr = ++this.rueckfahrtNr;
    for (const r of soll) this.rueckfahrt.set(r.pfad, { ab: f.ab, ende: f.ab + KI_BEATS, nr });
    return f.ergebnis.then((erg) => {
      for (const r of erg) if (!r.ok && this.rueckfahrt.get(r.pfad)?.nr === nr) this.rueckfahrt.delete(r.pfad);   // abgelehnt: keine Fahrt
      return erg;
    });
  }

  // Spec 3.4 Rückweg: Andreas' Hand an spur/<n>/* landet im Projekt (Quelle andreas). Spec 6.30: zusammengefasst. Je Pfad zählt der letzte Wert;
  // gespeichert wird höchstens einmal je RUECKWEG_MS (das erste Ereignis nach einer Pause sofort), und eine Geste ist ein Verlaufseintrag: sie
  // endet nach GESTE_RUHE_MS ohne Ereignis. Vorher speicherte jedes Hand-Ereignis das ganze Projekt.
  private rueckweg(pfad: string, wert: number): void {
    const o = this.offen;
    if (!o) return;
    const jetzt = Date.now();
    if (this.geste.offen !== o || jetzt - this.geste.letzteMs > GESTE_RUHE_MS) this.geste = { nr: this.geste.nr + 1, letzteMs: jetzt, labels: [], offen: o };
    this.geste.letzteMs = jetzt;
    this.rueckwegWartend.set(pfad, wert);
    if (this.rueckwegTimer) return;
    this.rueckwegTimer = setTimeout(() => {
      this.rueckwegTimer = null;
      void this.seriell(async () => this.rueckwegSpeichern()).catch((e) => this.ctx.log({ typ: 'proj_rueckweg_fehler', fehler: (e as Error).message }));
    }, Math.max(0, this.rueckwegGespeichertMs + RUECKWEG_MS - jetzt));
    this.rueckwegTimer.unref();
  }
  // Die wartenden Werte als EINE Änderung der laufenden Geste (synchron: auch beim Schliessen des Projekts, damit der letzte Wert nicht verloren geht)
  private rueckwegSpeichern(): void {
    const liste = [...this.rueckwegWartend];
    this.rueckwegWartend.clear();
    const o = this.offen, g = this.geste;
    if (!o || g.offen !== o || !liste.length) return;
    const befehle: Record<string, unknown>[] = [];
    for (const [p, w] of liste) {
      const b = reglerZuBefehl(o.projekt, p, w);
      if (!b) continue;
      befehle.push(b.befehl);
      if (!g.labels.includes(b.label)) g.labels.push(b.label);
    }
    if (!befehle.length) return;
    this.rueckwegGespeichertMs = Date.now();
    const label = (g.labels.length === 1 ? g.labels[0] : `Mixer: ${g.labels.map((l) => l.replace(/^Mixer: /, '')).join(', ')}`).slice(0, 200);
    try {
      const r = aendere(o.verlauf, o.projekt, befehle as never, { quelle: 'andreas', label }, this.haken(o), { schluessel: `rueckweg:${g.nr}` });
      if (!r.eintrag) return;
      r.projekt.wiedergabe_rev = o.projekt.wiedergabe_rev;
      o.projekt = r.projekt;
      this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: r.projekt.rev, label, quelle: 'andreas' } });
    } catch (e) { this.ctx.log({ typ: 'proj_rueckweg_fehler', pfade: liste.map(([p]) => p), fehler: (e as Error).message }); }
  }

  // Spec 2.12: KI-Stopp beendet einen von Cypher gestarteten Transport (der Kern lehnt Cyphers Befehle ab; der Server stoppt als andreas)
  private kiStoppTransport(): void {
    this.transportQuelle = null;
    void this.seriell(async () => {
      const q = await this.kern.stopp('andreas');
      this.ctx.log({ typ: 'proj_ki_stopp_transport', quittung: q });
    }).catch((e) => this.ctx.log({ typ: 'proj_ki_stopp_fehler', fehler: (e as Error).message }));
  }

  // Spec 2.12: nach /e/neustart (neue Generation) die letzte Wiedergabe neu laden, Spur-Regler, Loop, Metronom und KI-Maske neu setzen.
  // Spec 6.32, Ausnahme Kern-Neustart: nachNeustart lädt IMMER, auch während der Freeze-Sperre. Ein Neustart beendet jeden Freeze im Kern, es gibt
  // nichts mehr abzubrechen, und ohne Laden spielte der neue Kern nichts. Pflicht für S3: kommt während eines Freeze ein Kern-Neustart oder geht
  // der Kern verloren, endet der Freeze mit freeze_fehler und gibt die Sperre frei; einen neuen Freeze startet S3 nicht von selbst.
  // Ist das Laden gemerkt (eine Änderung kam während der Sperre durch), ist die Datei zu wiedergabe_rev veraltet: dann eine neue schreiben.
  // Nach dem gelungenen Laden sind die Merk-Flags erledigt (Laden und Loop gehen hier mit dem Stand von jetzt an den Kern), damit die Freigabe nicht
  // noch einmal lädt. Das gemerkte Tempo bleibt: nachNeustart sendet kein Tempo, holeNach tut es nach der Freigabe.
  // Spec 6.35: im KI-Stopp setzt nachNeustart die Spur-Regler mit derselben Ausnahme wie der Wiederanlauf (6.21): Cyphers Spuren bleiben stumm.
  private nachNeustart(): void {
    void this.seriell(async () => {
      const o = this.offen;
      if (!o) return;
      const nr = o.projekt.wiedergabe_rev;
      const wiedergabe: Record<string, unknown> = !o.merk.laden && nr > 0 && fs.existsSync(wiedergabeDatei(this.arbeitsordner, nr))
        ? { nr, quittung: await this.kern.laden(nr, 'andreas') } : await this.ladeWiedergabe('andreas');
      if (typeof wiedergabe.nr === 'number' && quittungOk(wiedergabe.quittung as Quittung)) { o.merk.laden = false; o.merk.loop = false; }
      this.transportQuelle = null;
      this.zielWeg.clear();                                              // Fix8 V1: der neue Kern kennt die Pläne nicht mehr, die Regler folgen
      // Spec 6.31, 6.32: wartende Handwerte ins Projekt, unmittelbar vor dem Senden der Regler (nach der Lade-Quittung, kein await dazwischen),
      // damit auch, was während des Ladens kam, an den neuen Kern geht und Kern und Projekt denselben Wert haben
      this.rueckwegSpeichern();
      const [regler, loop, metronom, ki] = await Promise.all([this.kern.setzeRegler(this.ohneGestoppteFader(o.projekt, alleSpurRegler(o.projekt)), 'andreas'),
        this.kern.loop(o.projekt, 'andreas'), this.kern.metronom(o.projekt, 'andreas'), this.kiMaske(true)]);
      this.ctx.log({ typ: 'proj_neustart', slug: o.slug, wiedergabe, ...reglerBefund(regler), loop, metronom, ki });
    }).catch((e) => this.ctx.log({ typ: 'proj_neustart_fehler', fehler: (e as Error).message }));
  }
}
