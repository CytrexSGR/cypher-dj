// cypherdj-leitstand, Grundgerüst (Scheibe 12): Kern-Anbindung, WS-Hub, Takt-Strom, Journal.
// Scheibe 21: Annahme (Verriegelung, Autonomie, Vorschläge, Kopplung), Hörschein-Register, Tasten, Abgleich nach Neustart.
// Aufruf: node src/leitstand.ts [--konfig <pfad>] [--kern-port <n>] [--set-id JJJJ-MM-TT_hhmm]
//                               [--ki-spur deck/3,erz/1] [--kern-konfig <kern.toml>]
// Umgebung: CYPHERDJ_INSTANZ (ROADMAP Z2), LEITSTAND_MUTATION (nur Prüfung: autonomie_aus, kopplung_aus,
// wiederaufnahme_aus). Ohne --set-id setzt der Leitstand ein laufendes Set fort (src/fortsetzen.ts).
// Erste Zeile auf stdout beginnt mit "leitstand:" (bereit).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Dekodiert, Felder } from './adressen.ts';
import { ansageFuer, ART_JE_ADRESSE, NICHT_INS_JOURNAL } from './ereignisse.ts';
import { Hub, RpcFehler, type Client, type Rolle } from './hub.ts';
import { Journal, setIdAus, type JournalZeile, type Von } from './journal.ts';
import { KernAnbindung, type KernZustand } from './kern.ts';
import { ladeKonfig, type Laufzeit } from './konfig.ts';
import { Annahme } from './annahme.ts';
import { mitAutonomie } from './autonomie.ts';
import type { Hoerschein } from './hoerscheine.ts';
import { fortsetzbar, merkeAktuell } from './fortsetzen.ts';
import { ladeKernWerte } from './kern_konfig.ts';
import type { MenschenPlan } from './plan.ts';
import { BERICHT_FRIST_NS, TaktStrom, type Ereignis, type TaktZustand } from './takt.ts';
import { pruefer, SCHEMA_MCP } from './vertrag.ts';
import {
  beatBeiSample, jetztNs, monoBeiSample, sampleBeiBeat, schlagVonBeat, taktVonBeat, zeitpunkt, type Zeitpunkt,
} from './zeit.ts';

// §10 Eingabeform, gegen djk/vertrag/schemas/mcp.schema.json geprüft (dasselbe Schema wie das CLI, damit ein
// falsch geformter Aufruf schon hier scheitert und nicht erst am Kern).
const pruefeBestand = pruefer(SCHEMA_MCP, '#/$defs/bestand_eingabe');
const pruefeLaden = pruefer(SCHEMA_MCP, '#/$defs/laden_eingabe');
const pruefeWarte = pruefer(SCHEMA_MCP, '#/$defs/warte_eingabe');

interface BestandFassung { basis_bpm: number; fassung: number; stems: boolean }
interface BestandEintrag {
  material_id: string; titel: string; quelle_bpm: number; camelot: string | null;
  tore_ok: boolean; nur_fuer_andreas: boolean; erzeugt_am: string | null; fassungen: BestandFassung[];
}

export const ANSAGE_AN: readonly Rolle[] = ['ansage', 'anzeige']; // §9.3

const VON_ROLLE: Record<Rolle, Von> = {
  spieler: 'spieler', mcp: 'spieler', analyse: 'analyse', werkstatt: 'werkstatt',
  ansage: 'andreas', anzeige: 'andreas', pruefstand: 'leitstand',
};

export interface LeitstandOptionen {
  konfigPfad?: string;
  kernPort?: number;
  setId?: string;
  env?: NodeJS.ProcessEnv;
  kiSpur?: string[];      // Scheibe 21: Kanäle der KI-Spur (§4.7 /k/ki/spur), Vorgabe keiner
  kernKonfig?: string;    // Scheibe 21: kern.toml für hoerbar_db, tief_offen_db, max_stretcher (§2.1)
}

// Nach /k/willkommen sammelt der Leitstand /q/stand so lange, bevor er abgleicht (§4.1: willkommen, neustart und
// /q/stand kommen in einem Zug; 30 ms sind sechs Zyklen bei 256, gesetzt)
export const ABGLEICH_FENSTER_MS = 30;

export class Leitstand {
  readonly lz: Laufzeit;
  readonly journal: Journal;
  readonly kern: KernAnbindung;
  readonly hub: Hub;
  readonly takt: TaktStrom;
  private nbZustand: number | null = null;
  private ereignisLog: Ereignis[] = [];
  private ereignisBasis = 0; // Index des ersten Eintrags in ereignisLog
  private readonly zeiger = new WeakMap<Client, number>();
  verspaetet = 0; // takt-Nachrichten mehr als 150 ms nach Taktanfang (eigene Sicht; gemessen wird am Ziel)
  readonly annahme: Annahme;
  private bekannteGeneration: number | null = null;
  private idZaehler = jetztNs(); // §1.4: je Absender streng steigend, Start = mono_ns beim Prozessstart
  private arbeitsbestandPfad = ''; // §6.4, aus kern.toml (kw.arbeitsbestand_pfad), gesetzt im Konstruktor
  // Scheibe 31: wer auf eine Kern-Quittung wartet, die nicht über einen Plan der Annahme läuft (laden, §4.4).
  // Schlüssel wie annahme.ts: "<quelle>:<id>".
  private readonly wartendeQuittungen = new Map<string, { erfuellt: (f: Felder) => void; verworfen: (e: Error) => void }>();

  constructor(opt: LeitstandOptionen) {
    this.lz = ladeKonfig({ pfad: opt.konfigPfad, kernPort: opt.kernPort, env: opt.env });
    this.journal = new Journal(this.lz.sets_pfad, opt.setId ?? fortsetzbar(this.lz.sets_pfad) ?? setIdAus(new Date()));
    this.takt = new TaktStrom({
      berichtFristNs: BERICHT_FRIST_NS,
      analyseDa: () => [...this.hub.clients].some((c) => c.rolle === 'analyse'),
      lage: () => ({ set_basis_bpm: this.lz.konfig.set_basis_bpm, ...this.annahme.lage(this.beatJetzt()) }),
      senden: (z, zeit, mono) => this.taktSenden(z, zeit, mono),
      jetzt: jetztNs,
    });
    this.hub = new Hub({
      port: this.lz.ws_port,
      setId: this.journal.setId,
      generation: () => this.kern.generation ?? 0,
      autonomie: () => this.annahme.stufe,
      zeit: () => this.blockanfang() ?? zeitpunkt(0, 0),
      // Positivliste §10 vor jeder Methode (autonomie.ts mitAutonomie), auch vor denen späterer Scheiben
      methoden: Leitstand.mitSeq(mitAutonomie({
        lage: (_p, c) => this.lage(c),
        plan_einreichen: (p) => ({ ...this.annahme.einreichen(p as unknown as MenschenPlan), jetzt: this.jetzt() }),
        plan_abbrechen: (p) => ({ ...this.annahme.abbrechen(p.plan_id as string, p.teile as number[] | undefined), jetzt: this.jetzt() }),
        bestand: (p) => this.bestand(p),
        laden: (p) => this.laden(p),
        warte: (p, c) => this.warte(p, c),
      }, () => this.annahme.stufe, () => this.annahme.spiegel.kiGestoppt)),
      empfangen: (c, typ, daten) => this.vonClient(c, typ, daten),
    });
    this.kern = new KernAnbindung(
      { kernPort: this.lz.kern_port, aboPort: this.lz.abo_port, name: 'leitstand', frischAnmelden: true },
      {
        nachricht: (d, t) => this.vomKern(d, t),
        gesendet: (adresse, felder, t) => this.zeile('leitstand', adresse, felder, t, this.blockanfang()),
        zustand: (neu, t) => this.kernZustand(neu, t),
        unlesbar: (grund, laenge, t) => this.zeile('leitstand', 'osc_unlesbar', { grund, laenge }, t, this.blockanfang()),
      },
    );
    const kw = ladeKernWerte(opt.kernKonfig, this.lz.instanz);
    this.arbeitsbestandPfad = kw.arbeitsbestand_pfad;
    const env = opt.env ?? process.env;
    this.annahme = new Annahme({
      sende: (adresse, felder) => this.kern.sende(adresse, felder),
      ereignis: (art, daten, beat, sample) => this.meldeEreignis(art, daten, beat, sample),
      ansage: (text, art) => { this.hub.sende('ansage', { text, art }, ANSAGE_AN, this.blockanfang() ?? undefined); },
      journal: (typ, daten) => this.zeile('leitstand', typ, daten, jetztNs(), this.blockanfang()),
      jetztBeat: () => this.beatJetzt(),
      bpm: () => this.kern.uhr?.bpm ?? this.lz.konfig.set_basis_bpm,
      kernBereit: () => this.kern.zustand === 'verbunden' && !this.annahme.abgleichOffen,
      neueId: () => ++this.idZaehler,
    }, {
      stufe: this.lz.konfig.autonomie_start, kiSpur: opt.kiSpur ?? [],
      schwellen: { hoerbarDb: kw.hoerbar_db, tiefOffenDb: kw.tief_offen_db }, maxStretcher: kw.max_stretcher,
      mutationen: (env.LEITSTAND_MUTATION ?? '').split(',').filter(Boolean),
    });
  }

  async starte(): Promise<void> {
    this.wiederaufnehmen();
    await this.hub.starte();
    await this.kern.starte();
  }

  // Leitstand-Neustart (Scheibe 21): liegt das Journal dieses Sets schon vor, übernimmt der neue Leitstand Pläne,
  // Vorschläge, Stufe, Hörscheine und Spiegel daraus und gleicht nach der Neuanmeldung über /q/stand ab.
  private wiederaufnehmen(): void {
    if (!fs.existsSync(this.journal.pfad)) return;
    const zeilen = fs.readFileSync(this.journal.pfad, 'utf8').split('\n').filter((z) => z.trim())
      .flatMap((z) => { try { return [JSON.parse(z) as JournalZeile]; } catch { return []; } });
    for (const z of zeilen) {
      if (z.typ === '/k/willkommen' || z.typ === '/e/neustart') this.bekannteGeneration = z.daten.generation as number;
    }
    const n = this.annahme.wiederaufnehmen(zeilen);
    if (n > 0 || this.annahme.offeneTeile().length > 0) this.annahme.abgleichBeginnen('leitstand_neustart');
  }

  private beatJetzt(): number {
    const u = this.kern.uhr;
    return u ? u.beat + ((jetztNs() - u.mono_ns) * u.bpm) / 60e9 : 0;
  }

  // seq setzt mitSeq beim Antworten (F18)
  private jetzt(): Record<string, number> {
    const b = this.beatJetzt();
    return { takt: taktVonBeat(b), schlag: schlagVonBeat(b), beat: b, seq: 0 };
  }

  // §10: jede Rückgabe trägt jetzt, seq ist die seq des Antwort-Umschlags an diesen Client (wie bei lage). Gesetzt für
  // jede Methode der Tabelle, auch für die späterer Scheiben, direkt bevor der Hub antwortet; ein Promise (spätere
  // Scheiben) hat kein jetzt und bleibt unberührt.
  private static mitSeq(methoden: ConstructorParameters<typeof Hub>[0]['methoden']): ConstructorParameters<typeof Hub>[0]['methoden'] {
    const aus: ConstructorParameters<typeof Hub>[0]['methoden'] = {};
    for (const [name, m] of Object.entries(methoden)) {
      aus[name] = (p, c) => {
        const r = m(p, c) as Record<string, unknown>;
        const j = r.jetzt as { seq?: number } | undefined;
        if (j && typeof j === 'object') j.seq = c.seqAus + 1;
        return r;
      };
    }
    return aus;
  }

  // Ereignis der Annahme an alle Clients, in den Takt-Zustand und für lage; beat: der Kern-Beat, auf den es sich bezieht
  private meldeEreignis(art: string, daten: Record<string, unknown>, beat?: number, sample?: number): void {
    const u = this.kern.uhr;
    const zeit = beat !== undefined && sample !== undefined ? zeitpunkt(sample, beat)
      : beat !== undefined && u ? zeitpunkt(sampleBeiBeat(u, beat), beat) : this.blockanfang() ?? zeitpunkt(0, 0);
    const e: Ereignis = { ...daten, art, takt: zeit.takt };
    this.takt.merke(e);
    this.ereignisLog.push(e);
    if (this.ereignisLog.length > 1000) { this.ereignisLog.shift(); this.ereignisBasis++; }
    this.zeile('leitstand', `ereignis_${art}`, daten, jetztNs(), zeit);
    this.hub.sende('ereignis', e, 'alle', zeit);
  }

  async stoppe(): Promise<void> {
    this.takt.stoppe();
    await this.kern.stoppe();
    await this.hub.schliesse();
    if (!this.journal.offen) {
      process.stderr.write(`leitstand: Kern nie erreicht, kein Set begonnen, kein Journal geschrieben\n`);
    }
    this.journal.schliesse();
  }

  // letzter bekannter Blockanfang (§9.1: Zeit ohne eigenen Bezug); null, solange kein /uhr kam
  blockanfang(): Zeitpunkt | null {
    const u = this.kern.uhr;
    return u ? zeitpunkt(u.sample, u.beat) : null;
  }

  private zeitVon(d: Dekodiert): Zeitpunkt | null {
    const f = d.felder;
    const q = d.adresse.startsWith('/q');
    const s = q ? f.ist_sample : f.sample;
    const b = q ? f.ist_beat : f.beat;
    if (typeof s === 'number' && typeof b === 'number' && Number.isFinite(b)) return zeitpunkt(s, b);
    if (typeof s === 'number' && this.kern.uhr) return zeitpunkt(s, beatBeiSample(this.kern.uhr, s));
    return this.blockanfang();
  }

  private zeile(von: Von, typ: string, daten: Record<string, unknown>, mono: number, z: Zeitpunkt | null): void {
    const zeile: JournalZeile = {
      sample: z ? z.sample : null, beat: z ? z.beat : null, takt: z ? z.takt : null, mono_ns: mono, von, typ, daten,
    };
    this.journal.schreibe(zeile);
  }

  private vomKern(d: Dekodiert, t: number): void {
    if (d.adresse === '/k/willkommen' && !this.journal.offen) {
      const z = zeitpunkt(d.felder.sample as number, d.felder.beat as number);
      this.journal.oeffne({
        sample: z.sample, beat: z.beat, takt: z.takt, mono_ns: t, von: 'leitstand', typ: 'set_start',
        daten: {
          set_id: this.journal.setId, generation: d.felder.generation, vertrag: 1,
          konfiguration: {
            datei: this.lz.quelle, instanz: this.lz.instanz, werte: this.lz.konfig,
            ports: { ws: this.lz.ws_port, abo: this.lz.abo_port, kern: this.lz.kern_port },
          },
        },
      });
      merkeAktuell(this.lz.sets_pfad, this.journal.setId);
    }
    this.annahme.spiegel.aufnehmen(d);
    if (d.adresse === '/uhr') this.annahme.tick(d.felder.beat as number);
    if (NICHT_INS_JOURNAL.has(d.adresse)) return;
    const zeit = this.zeitVon(d);
    this.zeile(d.adresse === '/nb' ? 'notbahn' : 'kern', d.adresse, d.felder, t, zeit);
    const still = this.annahmeVomKern(d);
    if (d.adresse === '/takt') {
      const f = d.felder;
      const mono = this.kern.uhr ? monoBeiSample(this.kern.uhr, f.sample as number) : t;
      this.takt.aufTakt({
        takt: f.takt as number, phrase: f.phrase as number, sample: f.sample as number,
        beat: f.beat as number, bpm: f.bpm as number,
      }, mono);
      return;
    }
    if (!still) this.melde(d.adresse, d.felder, zeit ?? zeitpunkt(0, 0));
  }

  // Scheibe 21: Quittungen, Tasten, KI-Stopp, Anmeldung und Neustart für die Annahme. true: kein ereignis melden
  private annahmeVomKern(d: Dekodiert): boolean {
    const f = d.felder;
    switch (d.adresse) {
      case '/q': this.annahme.quittung(f, false); this.quittungAnkommen(f); return false;
      case '/q/stand': this.annahme.quittung(f, true); this.quittungAnkommen(f); return false;
      case '/e/taste':
        if ((f.wert as number) !== 0 && f.name === 'annehmen') this.annahme.annehmen(f.beat as number);
        if ((f.wert as number) !== 0 && f.name === 'verwerfen') this.annahme.verwerfen(f.beat as number);
        if (f.name === 'autonomie') this.annahme.setzeStufe(f.wert as number);
        return false;
      case '/e/ki': this.annahme.kiStopp((f.gestoppt as number) === 1, this.beatJetzt()); return false;
      case '/e/protokollfehler':
        if (f.grund === 'unbekannte_adresse' && typeof f.adresse === 'string') this.annahme.kernUnbekannt(f.adresse);
        return false;
      case '/k/willkommen':
        this.bekannteGeneration ??= f.generation as number;
        this.annahme.verbunden();
        if (this.annahme.abgleichOffen) setTimeout(() => this.annahme.abgleichSchliessen(), ABGLEICH_FENSTER_MS);
        return false;
      case '/e/neustart': {
        // §16.3: nur ein Generationssprung ist ein Kern-Neustart; eine Neuanmeldung in derselben Generation nicht
        const g = f.generation as number;
        const echt = this.bekannteGeneration !== null && g > this.bekannteGeneration;
        this.bekannteGeneration = Math.max(this.bekannteGeneration ?? g, g);
        if (echt) this.annahme.kernNeu();
        if (echt && !this.annahme.abgleichOffen) this.annahme.abgleichBeginnen('kern_neustart');
        return !echt;
      }
      default: return false;
    }
  }

  // Ereignis an alle und in den Takt-Zustand, Ansage an ansage und anzeige
  private melde(adresse: string, f: Felder, zeit: Zeitpunkt): void {
    const art = ART_JE_ADRESSE[adresse];
    const nbVorher = this.nbZustand;
    if (adresse === '/nb') this.nbZustand = f.zustand as number;
    const a = ansageFuer(adresse, f, zeit.takt, nbVorher);
    if (a) this.hub.sende('ansage', { ...a }, ANSAGE_AN, zeit);
    if (!art) return;
    if (adresse === '/nb' && nbVorher === f.zustand) return;
    // /e/invariante hat selbst ein Feld art (sub_doppelt …): es wandert nach invariante, art ist die §9.3-Art
    const e: Ereignis = { ...f, ...(adresse === '/e/invariante' ? { invariante: f.art } : {}), art, takt: zeit.takt };
    this.takt.merke(e);
    this.ereignisLog.push(e);
    if (this.ereignisLog.length > 1000) { this.ereignisLog.shift(); this.ereignisBasis++; }
    this.hub.sende('ereignis', e, 'alle', zeit);
  }

  private kernZustand(neu: KernZustand, t: number): void {
    const z = this.blockanfang();
    this.zeile('leitstand', neu === 'suche' ? 'kern_weg' : 'kern_da', { generation: this.kern.generation }, t, z);
    const takt = z ? z.takt : 1;
    const text = neu === 'suche'
      ? `T ${takt}: Kern antwortet nicht (100 ms ohne /uhr), suche alle 50 ms`
      : `T ${takt}: Kern da, Generation ${this.kern.generation}`;
    this.hub.sende('ansage', { text, art: neu === 'suche' ? 'warnung' : 'info' }, ANSAGE_AN, z ?? undefined);
  }

  private taktSenden(z: TaktZustand, zeit: Zeitpunkt, mono: number): void {
    this.hub.sende('takt', z as unknown as Record<string, unknown>, 'alle', zeit);
    const verzugMs = (jetztNs() - mono) / 1e6;
    if (verzugMs > 150) {
      this.verspaetet++;
      process.stderr.write(`leitstand: takt ${z.takt} ${verzugMs.toFixed(1)} ms nach Taktanfang\n`);
    }
  }

  private vonClient(c: Client, typ: string, daten: Record<string, unknown>): void {
    const von = c.rolle ? VON_ROLLE[c.rolle] : 'leitstand';
    this.zeile(von, typ, { rolle: c.rolle, name: c.name, daten }, jetztNs(), this.blockanfang());
    if (typ === 'takt_bericht') this.takt.bericht(daten);
    if (typ === 'hoerschein') this.annahme.hoerschein(daten as unknown as Hoerschein);
  }

  // Ereignisse seit dem letzten Aufruf dieses Clients, OHNE den Zeiger fortzuschreiben (warte prüft damit wiederholt,
  // ohne lage() vorwegzunehmen; lage() selbst ruft dies auf und schreibt den Zeiger danach fort).
  private ereignisseSeit(c: Client): Ereignis[] {
    const ab = Math.max(0, (this.zeiger.get(c) ?? this.ereignisBasis) - this.ereignisBasis);
    return this.ereignisLog.slice(ab);
  }

  // rpc lage (§10): Takt-Zustand des letzten takt und Ereignisse seit dem letzten Aufruf dieses Clients
  private lage(c: Client): Record<string, unknown> {
    const beat = this.beatJetzt();
    const ereignisse = this.ereignisseSeit(c);
    this.zeiger.set(c, this.ereignisBasis + this.ereignisLog.length);
    return {
      jetzt: { takt: taktVonBeat(beat), schlag: schlagVonBeat(beat), beat, seq: c.seqAus + 1 },
      lage: this.takt.letzter,
      ereignisse,
    };
  }

  // Scheibe 31: /q oder /q/stand für einen Befehl, den laden (nicht über die Annahme) verschickt hat. status
  // 3 = fertig (§16.2-Tabelle, annahme.ts Q_STATUS) löst auf; 4/6/7/8 (verworfen/abgelehnt/abgebrochen/storniert)
  // verwerfen mit dem Grund des Kerns als RpcFehler-Code; 1/2/5 (angenommen/gestartet) sind Zwischenstände.
  private quittungAnkommen(f: Felder): void {
    const schluessel = `${f.quelle}:${f.id}`;
    const w = this.wartendeQuittungen.get(schluessel);
    if (!w) return;
    const status = f.status as number;
    if (status === 3) { this.wartendeQuittungen.delete(schluessel); w.erfuellt(f); } else if ([4, 6, 7, 8].includes(status)) {
      this.wartendeQuittungen.delete(schluessel);
      const grund = String(f.grund ?? 'abgelehnt');
      w.verworfen(new RpcFehler(grund, `Kern lehnt ab: ${grund}`));
    }
  }

  // sendet einen §4-Befehl mit eigener id und wartet auf dessen Endquittung (§16.2: status 3 fertig, sonst Grund
  // als RpcFehler-Code). Frist 5 s: der Kern quittiert Sofort-Befehle wie /k/deck/laden am nächsten Zyklus.
  private wartAufQuittung(quelle: string, id: number, sende: () => void, fristMs = 5000): Promise<Felder> {
    const schluessel = `${quelle}:${id}`;
    return new Promise((ok, fehler) => {
      const frist = setTimeout(() => {
        if (this.wartendeQuittungen.delete(schluessel)) {
          fehler(new RpcFehler('zu_spaet', `laden: keine Quittung des Kerns für ${schluessel} innerhalb ${fristMs} ms`));
        }
      }, fristMs);
      this.wartendeQuittungen.set(schluessel, {
        erfuellt: (f) => { clearTimeout(frist); ok(f); },
        verworfen: (e) => { clearTimeout(frist); fehler(e); },
      });
      sende();
    });
  }

  // rpc bestand (§10, §13.4): liest ~/cypher-dj/bestand/index.sqlite (Werkstatt-Ausgabe, Pfad aus leitstand.toml
  // Schlüssel bestand) und liefert Einträge in der Form der Kiste (§6.5) als Kurz-Fingerabdruck je Material.
  private bestand(p: Record<string, unknown>): Record<string, unknown> {
    const chk = pruefeBestand(p);
    if (!chk.ok) throw new RpcFehler('form', `bestand: ${chk.fehler}`);
    const max = p.max as number;
    const filter = (p.filter ?? {}) as {
      camelot?: string; bpm_von?: number; bpm_bis?: number; frisch_seit_min?: number; nur_tore_ok?: boolean;
    };
    const jetztMs = Date.now();
    const passt = (e: BestandEintrag): boolean => {
      if (filter.camelot !== undefined && e.camelot !== filter.camelot) return false;
      if (filter.nur_tore_ok && !e.tore_ok) return false;
      if ((filter.bpm_von !== undefined || filter.bpm_bis !== undefined) && !e.fassungen.some((f) =>
        (filter.bpm_von === undefined || f.basis_bpm >= filter.bpm_von) && (filter.bpm_bis === undefined || f.basis_bpm <= filter.bpm_bis))) {
        return false;
      }
      if (filter.frisch_seit_min !== undefined) {
        if (!e.erzeugt_am) return false;
        const alterMin = (jetztMs - Date.parse(e.erzeugt_am)) / 60000;
        if (!(alterMin >= 0 && alterMin <= filter.frisch_seit_min)) return false;
      }
      return true;
    };
    return { jetzt: this.jetzt(), eintraege: this.bestandLesen().filter(passt).slice(0, max) };
  }

  // Liest §13.4 index.sqlite (node:sqlite, wie die Doku es für den Leitstand vorsieht). Fehlt die Datei (Werkstatt
  // noch nie gelaufen), liefert es eine leere Liste statt eines Fehlers: ein leerer Bestand ist kein Formfehler.
  private bestandLesen(): BestandEintrag[] {
    const db = path.join(this.lz.bestand_pfad, 'index.sqlite');
    if (!fs.existsSync(db)) return [];
    const k = new DatabaseSync(db, { readOnly: true, open: true });
    try {
      const material = k.prepare(
        'SELECT material_id, titel, quelle_bpm, camelot, tore_ok, nur_fuer_andreas, erzeugt_am FROM material',
      ).all() as Array<Record<string, unknown>>;
      const fassung = k.prepare('SELECT material_id, basis_bpm, fassung, stems FROM fassung').all() as Array<Record<string, unknown>>;
      const nachMaterial = new Map<string, BestandFassung[]>();
      for (const f of fassung) {
        const id = f.material_id as string;
        const liste = nachMaterial.get(id) ?? [];
        liste.push({ basis_bpm: f.basis_bpm as number, fassung: f.fassung as number, stems: (f.stems as number) === 1 });
        nachMaterial.set(id, liste);
      }
      return material.map((m) => ({
        material_id: m.material_id as string, titel: m.titel as string, quelle_bpm: m.quelle_bpm as number,
        camelot: (m.camelot as string | null) ?? null, tore_ok: (m.tore_ok as number) === 1,
        nur_fuer_andreas: (m.nur_fuer_andreas as number) === 1, erzeugt_am: (m.erzeugt_am as string | null) ?? null,
        fassungen: nachMaterial.get(m.material_id as string) ?? [],
      }));
    } finally {
      k.close();
    }
  }

  // §6.5: „Laden aus der Kiste nimmt die höchste Fassung zur Set-Basis, mit Stems, wenn vorhanden": höchste
  // r-Nummer unter den Fassungen mit basis_bpm = Set-Basis; mit_stems aus fassung.json analyse_quelle (§13.2).
  private hoechsteFassung(materialId: string, basisBpm: number): { fassung: number; mitStems: 0 | 1 } | null {
    const dir = path.join(this.lz.bestand_pfad, materialId, 'fassungen');
    if (!fs.existsSync(dir)) return null;
    const praefix = `${Math.round(basisBpm * 1000)}_r`;
    let bester: { r: number; mitStems: 0 | 1 } | null = null;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(praefix)) continue;
      const r = Number(name.slice(praefix.length));
      if (!Number.isInteger(r) || r < 1) continue;
      const fj = path.join(dir, name, 'fassung.json');
      if (!fs.existsSync(fj)) continue;
      let j: { analyse_quelle?: string };
      try { j = JSON.parse(fs.readFileSync(fj, 'utf8')) as { analyse_quelle?: string }; } catch { continue; }
      if (!bester || r > bester.r) bester = { r, mitStems: j.analyse_quelle === 'stems' ? 1 : 0 };
    }
    return bester ? { fassung: bester.r, mitStems: bester.mitStems } : null;
  }

  // §6.4 Arbeitsbestand: Kopie der Fassung aus dem Bestand nach /dev/shm/cypherdj/material/... (Kopie in ein
  // Temp-Verzeichnis, dann rename, wie die Doku es für den Leitstand verlangt). Überspringt, wenn das Ziel schon
  // vollständig da ist (dasselbe Deck erneut laden, oder ein zweites Deck dieselbe Fassung).
  private kopiereInArbeitsbestand(materialId: string, basisBpm: number, fassung: number): void {
    const teil = path.join(materialId, 'fassungen', `${Math.round(basisBpm * 1000)}_r${fassung}`);
    const quelle = path.join(this.lz.bestand_pfad, teil);
    const ziel = path.join(this.arbeitsbestandPfad, teil);
    if (fs.existsSync(path.join(ziel, 'fassung.json'))) return;
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    const tmp = `${ziel}.tmp-${process.pid}-${jetztNs()}`;
    fs.cpSync(quelle, tmp, { recursive: true });
    fs.rmSync(ziel, { recursive: true, force: true }); // Rest eines abgebrochenen früheren Kopierens
    fs.renameSync(tmp, ziel);
  }

  // rpc laden (§10, §4.4): höchste Fassung zur Set-Basis aus dem Bestand in den Arbeitsbestand kopieren, dann
  // /k/deck/laden schicken und auf die Endquittung warten. Autonomie und ki_gestoppt prüft autonomie.ts mitAutonomie
  // vor diesem Aufruf (laden steht in METHODEN_ALLEIN_AB_1); hier nur noch Bestand und Kern.
  private async laden(p: Record<string, unknown>): Promise<Record<string, unknown>> {
    const chk = pruefeLaden(p);
    if (!chk.ok) throw new RpcFehler('form', `laden: ${chk.fehler}`);
    const deck = p.deck as number;
    const materialId = p.material_id as string;
    const basisBpm = this.lz.konfig.set_basis_bpm;
    const f = this.hoechsteFassung(materialId, basisBpm);
    if (!f) {
      throw new RpcFehler('material_fehlt',
        `laden: keine Fassung von ${materialId} zur Set-Basis ${basisBpm} BPM in ${this.lz.bestand_pfad}`);
    }
    this.kopiereInArbeitsbestand(materialId, basisBpm, f.fassung);
    const id = ++this.idZaehler;
    const felder = await this.wartAufQuittung('cypher', id, () => this.kern.sende('/k/deck/laden', {
      id, quelle: 'cypher', deck, material_id: materialId, basis_bpm: basisBpm, fassung: f.fassung, mit_stems: f.mitStems,
    }));
    return {
      jetzt: this.jetzt(), deck, material_id: materialId, basis_bpm: basisBpm, fassung: f.fassung, mit_stems: f.mitStems,
      status: felder.status === 3 ? 'fertig' : 'gestartet',
    };
  }

  // rpc warte (§10): wie lage, sobald bis_takt erreicht ist oder eines der Ereignisse aus auf eintrifft
  // (seit dem letzten lage/warte-Aufruf dieses Clients), spätestens nach max_s.
  private warte(p: Record<string, unknown>, c: Client): Promise<Record<string, unknown>> {
    const chk = pruefeWarte(p);
    if (!chk.ok) throw new RpcFehler('form', `warte: ${chk.fehler}`);
    const bisTakt = p.bis_takt as number | undefined;
    const auf = new Set((p.auf as string[] | undefined) ?? []);
    const maxMs = (p.max_s as number) * 1000;
    return new Promise((ok) => {
      let erledigt = false;
      let iv: NodeJS.Timeout;
      let frist: NodeJS.Timeout;
      const fertig = (): void => {
        if (erledigt) return;
        erledigt = true;
        clearInterval(iv);
        clearTimeout(frist);
        ok(this.lage(c));
      };
      const pruefen = (): void => {
        const takt = taktVonBeat(this.beatJetzt());
        const trifft = auf.size > 0 && this.ereignisseSeit(c).some((e) => auf.has(e.art));
        if ((bisTakt !== undefined && takt >= bisTakt) || trifft) fertig();
      };
      pruefen();
      if (erledigt) return;
      iv = setInterval(pruefen, 50);
      frist = setTimeout(fertig, maxMs);
    });
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      konfig: { type: 'string' }, 'kern-port': { type: 'string' }, 'set-id': { type: 'string' },
      'ki-spur': { type: 'string' }, 'kern-konfig': { type: 'string' },
    },
  });
  const l = new Leitstand({
    konfigPfad: values.konfig,
    kernPort: values['kern-port'] ? Number(values['kern-port']) : undefined,
    setId: values['set-id'],
    kiSpur: values['ki-spur'] ? values['ki-spur'].split(',').filter(Boolean) : [],
    kernKonfig: values['kern-konfig'],
  });
  await l.starte();
  process.stdout.write(`leitstand: ws 127.0.0.1:${l.lz.ws_port} abo ${l.lz.abo_port} kern ${l.lz.kern_port} ` +
    `konfig ${l.lz.quelle} journal ${l.journal.pfad}\n`);
  let endet = false;
  const ende = async (): Promise<void> => {
    if (endet) return;
    endet = true;
    await l.stoppe();
    process.exit(0);
  };
  process.on('SIGTERM', () => void ende());
  process.on('SIGINT', () => void ende());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: Error) => {
    process.stderr.write(`leitstand: Startfehler: ${e.message}\n`);
    process.exit(2);
  });
}
