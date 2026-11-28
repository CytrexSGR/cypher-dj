// Das offene Projekt des Seiten-Servers (Spec D1 2.1, 3.4): Projektordner, Verlauf, Wiedergabe-Nummer, Abgleich mit dem Kern.
// Die schreibenden Wege der Sitzung laufen nacheinander in einer Kette (seriell). Eine Ausnahme gibt es: uebernimm() (S3, Freeze und
// Export) setzt den Stand synchron, bevor es sich in die Kette stellt, also auch während ein Befehl in der Kette auf Regler-Quittungen
// wartet. Ein Befehl sieht darum nach einem await nicht sicher den Stand, gegen den er geprüft wurde; vollziehe prüft die rev nach dem
// Warten noch einmal (Spec 6.30, 409 rev_veraltet). Der Kern wird nur über KernWeg angesprochen (BereichKontext), Kern-Ereignisse kommen über ereignis().
// Reihenfolge einer Änderung: prüfen (rev, KI-Stopp, Katalog, Freeze-Sperre) → Probe rechnen → Regler setzen und Quittungen abwarten → rev noch
// einmal prüfen (409 rev_veraltet) → echte Ablehnung des Kerns: zurückdrehen, 409 regler_abgelehnt, nichts gespeichert (Quittung null heißt kein Kern:
// angenommen, kern.regler kein_kern) → Wiedergabe schreiben, wenn nötig (Freeze-Sperre erneut geprüft), dann EINMAL speichern und ins Log → laden,
// Loop, Metronom, Tempo nachziehen → SSE proj. Der Rückweg der Hand speichert zusammengefasst (höchstens alle 250 ms, ein Eintrag je Geste).
// Stand Slice 6 (S2-Integration): vollständig. Dazu Transport, Tempo-Regel, Rückweg der Hand, KI-Stopp, KI-Maske (immer spur/0) und der Neustart des Kerns.
import fs from 'node:fs';
import path from 'node:path';
import { Projekte, projektWurzelVorgabe, setzeVorgabenQuelle } from '../../project/storage.ts';
import { type AnalyseEintrag, type AnalyseEnde, AnalyseListe, type Anforderung, type Wunsch } from './analysis.ts';
import { type DekodiertZustand, type Projekt, sucheSpur } from '../../project/model.ts';
import { type AufnahmeZiel, AutoAufnahme } from './recording_auto.ts';
import type { BereichKontext } from '../../http/router.ts';
import { DekodierCache, type DekodierEreignis } from '../../project/decode.ts';
import type { Einsammler } from '../../project/einsammeln.ts';
import { GESTE_RUHE_MS } from './times.ts';
import { type Haken, type Meta, type Verlauf, type Wirkung, aendere } from '../../project/history.ts';
import { HostVerwaltung, insertAusfuehren, pluginIdVon, sockAnfrage } from '../../plugins/hostverwaltung.ts';
import { InstrumentWirte, instrumenteStart, wirtSockAnfrage, wirtStandLesen } from '../../plugins/instrumentwirte.ts';
import { Katalog, type Zeile } from '../../catalog.ts';
import { KernLage } from './state.ts';
import { KernWeg, type Quelle, type Quittung, type ReglerErgebnis, quittungAbgelehnt } from './core_path.ts';
import { MasterAbMarke } from './master_ab_marker.ts';
import { laneStart } from '../../project/commands.ts';
import type { NotenRenderQuelle } from './notes_render.ts';
import { PluginLanenSpieler } from '../../plugins/lanes_player.ts';
import { ProjBk } from './modular.ts';
import { type ReglerLernen, SitzungGeraet } from './session_device.ts';
import { ReglerWeiterleitung } from '../../plugins/controls_weiterleitung.ts';
import type { Slot } from '../../project/live.ts';
import { SURGE_RICHTUNGEN, nurFilter1, surgeParameterVon } from '../../project/direction.ts';
import type { SicherGrund } from '../../plugins/state.ts';
import { SitzungAuto } from './session_auto.ts';
import { SitzungQuellen } from './session_sources.ts';
import { SitzungVorhoeren } from './session_prelisten.ts';
import type { Soll } from './mapping.ts';
import type { StiftAenderung } from '../../project/commands_helpers.ts';
import { SurgeSpiegel } from './surge.ts';
import type { TempoQuelle } from '../../project/warp.ts';
import { TransientenLager } from '../../project/transients.ts';
import type { VersionEintrag } from '../../project/versionen.ts';
import { type Wiedergabe, WiedergabeZaehler, containerQuellen, schreibeWiedergabe } from '../../project/playback.ts';
import { analyseVorgabe } from '../../paths.ts';
import { arrOrdner, zaehlerDateiVorgabe } from './config.ts';
import { kanalOffen } from '../../hand_operation.ts';
import { vorgabenVon } from '../../graphs.ts';
import { takteProLive } from '../../project/taktart_live.ts';
import {
  AUTO_PUNKTE_VORGABE, type Antwort, type AusgabeLauf, type Hinweis, type Koerper, MARKER_VORGABE, type Offen, ProjFehler,
  type ProjOptionen, REV_JETZT, RUECKWEG_MS, TRANSIENTEN_VORGABE, bkGraphenFehlen, graphArt, steckfeldLookup,
} from './session_helpers.ts';
import {
  fremderLauf, kanalBelegtGesehen, kanalOffenGesehen, kanalZuUndBekannt, kopie, liveFaderErgebnis, liveFaderFaellig, liveModulFader,
  liveModulFaderLauf, liveOeffnen, liveOeffnenOhneTempo, liveTempo, loeschen, oeffneIntern, oeffnen, oeffnetGerade, schliesse,
  schliesseOffen, schliessen, slotGruppe, sperreFremderTransport, sperreLiveLaeuft, sperreOeffnen, versionSichern, versionZurueck,
} from './session_projekte.ts';
import {
  bereiteWiedergabe, hostBelegung, hostNeuLaden, istWiederanlauf, ladeNr as ladeNrF, ladeWiedergabe, leereKiMaske, schreibeNeueWiedergabe,
  schreibeVorhoerWiedergabe, stelleMasterAbHer, synchronisiere, uebernimmMixer, uebersetzeFuer, unbekannteSpurRegler,
} from './session_playback.ts';
import {
  betrifftWiedergabe, deckelDekodiert, dekodiertEreignis, gleicheDekodiertAb, katalogQuelle, meldeEinsammeln, offeneShas, projektQuellPfad,
  quellPfad, tempoQuelleFuer,
} from './session_dekodiert.ts';
import { aendern, analyseEnde, ankunft, einsRueckweg, musterVorlauf, pruefeRev, starteAnalysen } from './session_change.ts';
import { reglerZurueck, stifteZurueck, umkehr, umkehrVollzug } from './session_umkehr.ts';
import {
  holeNach, pruefeAufnahmeSpuren, pruefeMarkerInQuelle, pruefeSperre, sperreFremderStart, sperreLaden, sperreTransport, tempoVorStart,
  transport,
} from './session_transport.ts';
import { aktuell, bkLaden, bkLage, bkMerken, modAutoLage, verlaufListe } from './session_state.ts';
import { autoLage, hoereBk, hoereMaster, neu, schreibeWiedergabeFuer, uebernimm, vollziehe, warpLage } from './session_vollzug.ts';
import { ereignis, meldeRegler, meldeStand, nachNeustart, rueckweg, rueckwegSpeichern, wacheStart } from './session_ereignis.ts';

export class ProjSitzung {
  readonly lage = new KernLage();
  readonly arbeitsordner: string;
  readonly masterAbMarke: MasterAbMarke;   // a running master A/B: the rows it touched, read by the restart path of a project open
  private readonly transientenLager: TransientenLager;     // Slice 4: Transienten je Quelle (Quellsekunden), für BEATS und proj_warp
  private readonly transienten = (sha: string): number[] | null => this.transientenLager.fuer(sha);
  private readonly ctx: BereichKontext;
  private readonly kern: KernWeg;
  // Container core M5: what this session last told the core feeds container A..D (null = not told since this server or the core started)
  private containerGesendet: (0 | 1 | 2 | null)[] = [null, null, null, null];
  private readonly bk: ProjBk;   // S17
  private readonly projekte: Projekte;
  private readonly cache: DekodierCache;
  private readonly zaehler: WiedergabeZaehler;
  private readonly katalog: Katalog | null;
  private readonly einsammler: Einsammler | null;
  private readonly analyse: string | null;
  private readonly mediathekPfad: string | null;
  private readonly bestand: string | null;
  private readonly analysen: AnalyseListe | null;
  private readonly analyseWarteMs: number;
  private readonly analyseGescheitert = new Set<string>();   // D1: shas, deren Analyse scheiterte oder keine Karte brachte (bis zum Neustart)
  private readonly arrFristMs: number;
  private readonly rampeWarteMs: number;
  private readonly uhrStillMs: number;
  private offen: Offen | null = null;
  private readonly geraet: SitzungGeraet;
  private readonly quellen: SitzungQuellen;
  private readonly vorhoeren: SitzungVorhoeren;
  private readonly auto: SitzungAuto;
  private transportQuelle: Quelle | null = null;     // wer den laufenden Transport gestartet hat (Spec 2.12)
  // 1.12 slice 3 (task 4, D8): the fields the hand overrides, by track id then field name; fed only from /e/auto, never written into the project.
  // /e/auto carries the track number `nr`, which stays with a track over moves (spur_verschieben changes only the position), so it maps to the id
  // at the moment the event arrives. Cleared on a new core generation and on open or new.
  // Each entry remembers its track number: the core reports the end of an override of a deleted track (zustand 0 at the snapshot swap) only AFTER
  // the server removed the track, and the entry must still clear then (else an undo of the delete would show a stale mark).
  private readonly uebersteuert = new Map<string, { nr: number; ziele: Set<string> }>();
  private kette: Promise<unknown> = Promise.resolve();
  // F1: the base value after a take that the core refused because the hand still holds the regulator (regler_beim_menschen, stellwerk hand.cpp
  // mensch_bei: the holder stays `mensch` up to 32 beats without a grip). It waits here by regulator path and is sent when the holder is released.
  private readonly basisWartend = new Map<string, { spurId: string; ziel: AufnahmeZiel }>();
  readonly aufAuto: AutoAufnahme;   // 1.12 slice 3 (task 8): arm state and the take collector
  // Rückweg: letzter Wert je Pfad und wer ihn bewegt hat, noch nicht gespeichert
  private readonly rueckwegWartend = new Map<string, { wert: number; quelle: Quelle }>();
  private rueckwegTimer: ReturnType<typeof setTimeout> | null = null;
  private wirtWache: ReturnType<typeof setInterval> | null = null;   // audit U07: asks for a Surge sync when a host got a new pid
  private readonly wirtWacheMs: number;
  private rueckwegGespeichertMs = -Infinity;                         // Zeit der letzten Speicherung des Rückwegs
  private geste: { nr: number; letzteMs: number; labels: string[]; offen: Offen | null } = { nr: 0, letzteMs: -Infinity, labels: [], offen: null };
  private sperren = 0;          // P4 (Spec 6.23): offene sperreLaden()-Freigaben
  private sperrenAufnahme = 0;   // 1.8: davon die Sperre der Aufnahme (höchstens eine; sie darf den eigenen Transport-Start)
  private aufnahmeLauf: unknown = null;   // 1.8: laufende Aufnahme (sperrt Tempo-Änderungen)
  private oeffnet = 0;          // Spec 6.32: laufende /proj/oeffnen und /proj/neu (in der Kette); solange > 0 lehnt sperreLaden() ab
  private stemsStand: Record<string, unknown> | null = null;   // Slice 6 (P6): letzter Stems-Stand, GET /proj/aktuell stems
  private notenRender: NotenRenderQuelle | null = null;   // note editor (slice 1, B4): the render service; a clip with note targets plays its render
  private notenStand: Record<string, unknown> | null = null;   // note editor (slice 1, B2): last state of the note detection, GET /proj/aktuell noten
  private ausgabeLauf: AusgabeLauf | null = null;   // Spec 6.34: laufender Freeze oder Export (Paket S3), GET /proj/aktuell ausgabe_lauf

  private readonly presetLies: ProjOptionen['presetLies'];   // 1.9 (O28)
  private readonly surge: SurgeSpiegel;                        // 1.9 U5: the Surge parameter map of the project mirrored into the hosts
  private readonly pluginIndex: ProjOptionen['pluginIndex'];
  private readonly kanalHaken: ProjOptionen['kanalOffen'];
  private liveFaderKette: Promise<unknown> = Promise.resolve();   // the module fader migrations run one after the other
  private readonly liveFaderWartend = new Set<string>();   // module groups at -200 that wait for a closed channel and a stopped live playback
  private readonly liveFaderGemeldet = new Set<string>();   // groups whose refused raise was logged (one entry each)
  private liveFaderLauf: Promise<{ angehoben: string[]; gemeldet: string[] }> | null = null;   // the run that the last open of the live project started
  readonly instrumente: InstrumentWirte;                         // plan 1.11 task 17: the foreign instrument hosts (plugin tracks)
  private readonly laneSpieler: PluginLanenSpieler;               // plan strand 2 slice 1: plugin parameter lanes to the hosts
  private readonly reglerWeiter: ReglerWeiterleitung;             // plan strand 2 slice 2: knob rows plug/<h>/k<m> to the plugin parameters
  readonly hosts: HostVerwaltung;                                // plan 1.11 task 7: the foreign effect hosts
  // a host slot never changes strips inside one playback load (kern contract, task 4): what the last written playback holds per slot, when a slot was
  // released, and what the next load has to do first (key: the number of the playback file)
  private hostBelegt = new Map<number, string>();
  private readonly hostFreiMs = new Map<number, number>();
  private readonly hostFreiLatenz = new Map<number, number>();   // samples of the stage that last left a slot
  private readonly hostVorab = new Map<number, { zwischen: number | null; konflikt: number[]; eintritt: number[]; geraeumt: number[];
    span: Map<number, number> }>();

  constructor(ctx: BereichKontext, opt: ProjOptionen = {}) {
    const instanz = opt.instanz ?? process.env.CYPHERDJ_INSTANZ ?? '';
    this.ctx = ctx;
    this.presetLies = opt.presetLies;
    this.wirtWacheMs = opt.wirtWacheMs ?? 2000;
    this.pluginIndex = opt.pluginIndex;
    this.kanalHaken = opt.kanalOffen;
    this.surge = new SurgeSpiegel({ ordner: opt.wirtOrdner, log: (e) => ctx.log(e), slotBereit: (slot) => this.instrumente.slotFertig(slot),
      wirtPid: (slot) => this.instrumente.pid(slot) });
    this.hosts = new HostVerwaltung({
      insert: (a) => insertAusfuehren(a, instanz, opt.host?.befehl),
      sock: sockAnfrage,
      // the flag and the measurement go out as `leitstand`: Stop Cypher never holds them back (a `cypher` source would be refused ki_gestoppt)
      kern: {
        insHost: async (h, g) => { ctx.sende('/k/arr/ins_host', { quelle: 'leitstand', h, gesund: g }); },
        insMess: (h) => { ctx.sende('/k/arr/ins_mess', { quelle: 'leitstand', h }); },
      },
      ordner: () => (this.offen ? path.resolve(this.projekte.wurzelPfad, this.offen.slug) : null),
      transportSteht: () => this.lage.arr !== null && this.lage.arr.status === 0,
      neuLaden: () => this.hostNeuLaden(),
      log: (z) => ctx.log(z),
      onBereit: (id) => { void this.reglerWeiter.pickup(id).catch(() => undefined); },
      klasse: (pl) => this.pluginIndex?.(pluginIdVon(pl))?.klasse ?? 0,   // a later class of a VST3 bundle starts through the shim (`@<klasse>`)
      ...opt.host?.abhaengig,
    }, opt.host?.zeiten);
    this.laneSpieler = new PluginLanenSpieler({
      projekt: () => this.offen?.projekt ?? null,
      beatsProSekunde: () => (this.lage.uhr?.bpm ?? this.offen?.projekt.tempo_bpm ?? 128) / 60,
      senden: (id, w) => this.hosts.automation(id, w),
      parameterWert: async (id, index) => {   // strand 6 task 4.3: the base of a modulated parameter that has no lane
        const r = await this.hosts.parameter(id);
        const q = r.ok ? r.parameter.find((x) => Number(x.index) === index) : undefined;
        return typeof q?.wert === 'number' ? q.wert : undefined;
      },
    });
    this.reglerWeiter = new ReglerWeiterleitung({
      projekt: () => this.offen?.projekt ?? null,
      param: (id, w) => { this.laneSpieler.basisSetzen(id, w); return this.hosts.param(id, w); },   // a knob move is the new centre of the modulation
      parameter: (id) => this.hosts.parameter(id),
      setzeRegler: (pfad, wert) => this.kern.setzeRegler([{ pfad, wert }], 'andreas'),
      spielt: () => this.laneSpieler.spielt(),
      log: (z) => ctx.log(z),
    });
    // without a status folder (a session that was not given one) no instrument host is ever started
    const wo = opt.wirtOrdner;
    this.instrumente = new InstrumentWirte({
      start: wo ? instrumenteStart(instanz) : async () => ({ code: 1, fehler: 'no host folder' }),
      stand: (slot) => (wo ? wirtStandLesen(wo(), slot) : { lebt: false, bereit: false, art: null, kennung: null, pid: null }),
      sock: wo ? wirtSockAnfrage(wo) : async () => { throw new Error('sock_verbindung: no host folder'); },
      ordner: () => (this.offen ? path.resolve(this.projekte.wurzelPfad, this.offen.slug) : null),
      log: (z) => ctx.log(z),
      surgeNeu: (slot) => this.surge.vergiss(slot),
      klasse: (pl) => this.pluginIndex?.(pluginIdVon(pl))?.klasse ?? 0,   // a later class of a VST3 bundle starts through the shim (`@<klasse>`)
      ...opt.instrument?.abhaengig,
    }, opt.instrument?.zeiten);
    this.kern = new KernWeg(ctx, this.lage, { proTakt: () => takteProLive(this.offen?.projekt?.taktart), ...opt.kernWeg });
    this.bk = new ProjBk(ctx, this.lage, this.kern, opt.bkFristMs ?? 5000);
    setzeVorgabenQuelle((name) => vorgabenVon(name));   // the graph's `vorgabe` list: fill and trim of the knob rows of a project use the same one
    this.projekte = new Projekte(opt.wurzel ?? projektWurzelVorgabe(instanz));
    this.arbeitsordner = opt.arbeitsordner ?? arrOrdner(instanz);
    this.masterAbMarke = new MasterAbMarke(path.join(this.arbeitsordner, 'master_ab.json'));
    const zaehlerDatei = opt.zaehlerDatei
      ?? (opt.arbeitsordner ? `${path.resolve(opt.arbeitsordner)}.zaehler` : zaehlerDateiVorgabe(instanz));
    this.zaehler = new WiedergabeZaehler(this.arbeitsordner, zaehlerDatei);
    this.cache = new DekodierCache(this.arbeitsordner, { ffmpeg: opt.ffmpeg, ffprobe: opt.ffprobe, vorsatz: opt.vorsatz,
      bei: (e) => this.dekodiertEreignis(e), deckel: (frisch) => this.deckelDekodiert(frisch) });
    this.transientenLager = new TransientenLager(path.join(this.arbeitsordner, 'audio'));
    this.katalog = opt.katalog ? new Katalog(opt.katalog) : null;
    this.einsammler = opt.einsammler ?? null;
    this.analyse = opt.analyse !== undefined ? opt.analyse : analyseVorgabe(instanz);
    this.mediathekPfad = opt.mediathek ?? null;
    this.bestand = opt.bestand ?? null;
    this.analyseWarteMs = opt.analyseWarteMs ?? 2000;
    // Die Meldung läuft ohne neue rev: die Seite lädt bei clip_id nach (production.js)
    this.analysen = this.analyse && opt.analysierer
      ? new AnalyseListe(opt.analysierer, (sha, ei, ende) => this.analyseEnde(sha, ei, ende),
        (w, status) => this.ctx.verteile({ a: 'proj', f: { clip_id: w.clip_id, analyse: status } }))
      : null;
    this.arrFristMs = opt.arrFristMs ?? 600;
    this.rampeWarteMs = opt.rampeWarteMs ?? 20_000;
    this.uhrStillMs = opt.uhrStillMs ?? 1000;
    this.aufAuto = new AutoAufnahme({
      projekt: () => this.offen?.projekt ?? null, slug: () => this.offen?.slug ?? null, kennung: () => this.offen,
      bpm: () => this.lage.uhr?.bpm ?? this.offen?.projekt.tempo_bpm ?? 128,
      schreibe: (label, befehle, kennung) => this.schreibeTake(label, befehle, kennung as Offen),
      autoAn: async (nr, ziel) => this.kern.auto(nr, ziel, 1, 'andreas'),
      basis: (felder) => this.basisSenden(felder),
      entwaffne: async (nr) => {
        const q = await this.kern.arm(nr, 0, this.aufAuto.modusNr(), 'andreas');
        if (q === null || quittungAbgelehnt(q)) this.ctx.log({ typ: 'proj_arm_frei_fehler', nr, quittung: q });
      },
      verteile: (f) => this.ctx.verteile(f), log: (z) => this.ctx.log(z),
    }, opt.autoAufnahme);
    this.geraet = new SitzungGeraet({ brauchOffen: () => this.brauchOffen(), riegel: (q) => this.riegel(q),
      hosts: this.hosts, instrumente: this.instrumente, surge: this.surge,
      aendere: (d, q) => this.aendern(d, q), pickup: (id) => this.reglerWeiter.pickup(id), lernen: () => this.reglerLernen });
    this.quellen = new SitzungQuellen({ analyse: this.analyse, analyseGescheitert: this.analyseGescheitert, analysen: this.analysen,
      bestand: this.bestand, katalog: this.katalog, mediathekPfad: this.mediathekPfad, presetLies: this.presetLies,
      quellPfad: (sha, hinweis) => this.quellPfad(sha, hinweis), transienten: this.transienten });
    const s = this;   // the get members of the hosts read fields that change after the constructor
    this.vorhoeren = new SitzungVorhoeren({ arbeitsordner: this.arbeitsordner, get aufnahmeLauf() { return s.aufnahmeLauf; },
      brauchOffen: () => this.brauchOffen(), ctx: this.ctx, kern: this.kern, ladeWiedergabe: (q, v) => this.ladeWiedergabe(q, v),
      get offen() { return s.offen; }, riegel: (q) => this.riegel(q),
      schreibeVorhoerWiedergabe: (p, v, streng) => this.schreibeVorhoerWiedergabe(p, v, streng), seriell: (f) => this.seriell(f),
      get sperren() { return s.sperren; }, get sperrenAufnahme() { return s.sperrenAufnahme; } });
    this.auto = new SitzungAuto({ aendern: (d, q, erwartet) => this.aendern(d, q, erwartet), aufAuto: this.aufAuto,
      brauchOffen: () => this.brauchOffen(), ctx: this.ctx, kern: this.kern, get offen() { return s.offen; }, riegel: (q) => this.riegel(q),
      uebersteuert: this.uebersteuert });
  }

  // The base value of the project for fields of armed tracks (D10/D13a), through the same queue as every regulator write of the page (aendern, uebernimm):
  // two /k/teil of one regulator at one moment would overlap in the core. The value is read from the project when its turn comes. A refusal is logged;
  // one because of the hand is kept until the holder is released (see basisWartend).
  private basisSenden(felder: { spurId: string; ziel: AufnahmeZiel }[]): Promise<void> {
    return this.seriell(async () => {
      const p = this.offen?.projekt, soll: Soll[] = [], von = new Map<string, { spurId: string; ziel: AufnahmeZiel }>();
      for (const f of felder) {
        const sp = p?.spuren.find((x) => x.id === f.spurId);
        if (!sp) continue;
        const pfad = `spur/${sp.nr}/${f.ziel}`;
        soll.push({ pfad, wert: laneStart(sp, f.ziel) }); von.set(pfad, f);
      }
      if (!soll.length) return;
      for (const r of await this.kern.setzeRegler(soll, 'andreas')) {
        if (r.quittung !== null && !quittungAbgelehnt(r.quittung)) continue;
        const grund = r.quittung === null ? 'kein_kern' : r.quittung.grund;
        this.ctx.log({ typ: 'proj_basis_abgelehnt', pfad: r.pfad, grund });
        if (grund === 'regler_beim_menschen') this.basisWartend.set(r.pfad, von.get(r.pfad) as { spurId: string; ziel: AufnahmeZiel });
      }
    });
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
  /** Every stored project that can be read, one at a time (sampler delete: which project still plays a graph). A project file that is broken, invalid or
   *  gone is skipped; the open project is read from its file like the others (the caller decides what counts). */
  *gespeicherte(): Generator<{ slug: string; projekt: Projekt }> {
    for (const e of this.projekte.liste()) {
      if (e.fehler !== undefined) continue;
      let projekt: Projekt;
      try { projekt = this.projekte.lies(e.slug); } catch { continue; }
      yield { slug: e.slug, projekt };
    }
  }
  aktuell(ansicht: 'voll' | 'noten_zahl' | 'rev' = 'voll'): Antwort { return aktuell.call(this, ansicht); }
  // plugin and device parameter calls: see session_device.ts
  insertParam(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.insertParam(insertId, d, quelle); }
  insertParameter(insertId: string): Promise<Antwort> { return this.geraet.insertParameter(insertId); }
  insertFenster(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.insertFenster(insertId, d, quelle); }
  insertLernen(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.insertLernen(insertId, d, quelle); }
  insertLernenLoeschen(insertId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.insertLernenLoeschen(insertId, d, quelle); }
  reglerLernen: ReglerLernen | null = null;   // strand 2 task 2.4: set by the server once the learn Bereich exists
  geraetParam(spurId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.geraetParam(spurId, d, quelle); }
  geraetIst(spurId: string, namenText: string): Promise<Antwort> { return this.geraet.geraetIst(spurId, namenText); }
  geraetParameter(spurId: string): Promise<Antwort> { return this.geraet.geraetParameter(spurId); }
  geraetFenster(spurId: string, d: Koerper, quelle: Quelle): Promise<Antwort> { return this.geraet.geraetFenster(spurId, d, quelle); }
  hostLage(): ReturnType<HostVerwaltung['lage']> { return this.hosts.lage(); }
  hostZustandSichern(grund: SicherGrund): Promise<void> {
    return Promise.all([this.hosts.zustandSichern(grund), this.instrumente.zustandSichern(grund)]).then(() => undefined);
  }
  hostGesundAlterMs(nur?: ReadonlySet<string>): number { return this.hosts.gesundAlterMs(nur); }
  // plan 1.11 task 13: the real-time export plays `p` (host stages live, nothing frozen) as its own playback: written with the next number of the one
  // counter and loaded now. The caller holds sperreLaden and calls ladeLiveNeu() afterwards.
  async ladeEchtzeitSicht(p: Projekt): Promise<{ nr: number; datei: string }> {
    const nr = this.zaehler.naechste();
    const datei = schreibeWiedergabe(this.arbeitsordner, this.uebersetzeFuer(p, nr, undefined, true));
    const q = await this.kern.laden(nr, 'andreas');
    if (quittungAbgelehnt(q)) {
      fs.rmSync(datei, { force: true });
      throw new ProjFehler(409, q.grund || 'nicht_geladen', { kern: { wiedergabe: { nr, quittung: q } } });
    }
    return { nr, datei };
  }
  // the live view again (what the core played before the real-time export)
  ladeLiveNeu(): Promise<void> {
    return this.seriell(async () => { if (this.offen) await this.ladeWiedergabe('andreas'); });
  }
  // The same load for callers that do not hold the lock themselves (the sampler routes after they rewrote a graph): like every other loader it respects
  // sperreLaden. While a freeze, export, recording or resample holds the lock the load would cut it off in the core, so only the wish is kept (merk.laden)
  // and the release loads. true: loaded now (or no project is open); false: deferred. ladeLiveNeu stays unchecked for the real-time export, which
  // holds the lock.
  ladeLiveNeuFrei(): Promise<boolean> {
    return this.seriell(async () => {
      if (!this.offen) return true;
      const r = await this.ladeOderMerke('andreas');
      return r.aufgeschoben !== true;
    });
  }
  verlaufListe(): Antwort { return verlaufListe.call(this); }

  warpLage(clipId: string | null, von: number | null, bis: number | null, bei: number | null, max: number | null = null,
    transMax: number | null = null, quelleGanz = false): Antwort {
    return warpLage.call(this, clipId, von, bis, bei, max, transMax, quelleGanz);
  }

  modAutoLage(modId: string): Antwort { return modAutoLage.call(this, modId); }

  autoLage(laneId: string | null, spurId: string | null, von: number | null, bis: number | null, bei: number | null, max: number | null,
    clipId: string | null = null, ziel: string | null = null): Antwort {
    return autoLage.call(this, laneId, spurId, von, bis, bei, max, clipId, ziel);
  }

  bkLage(): Antwort { return bkLage.call(this); }
  bkMerken(d: Koerper, quelle: Quelle): Promise<Antwort> { return bkMerken.call(this, d, quelle); }
  bkLaden(d: Koerper, quelle: Quelle): Promise<Antwort> { return bkLaden.call(this, d, quelle); }

  neu(name: unknown, quelle: Quelle, bestaetigt = false,
    opt: { werkbank?: unknown; vorlage?: unknown; tracker?: unknown } = {}): Promise<Antwort> {
    return neu.call(this, name, quelle, bestaetigt, opt);
  }
  kopie(slug: unknown, name: unknown, quelle: Quelle): Promise<Antwort> { return kopie.call(this, slug, name, quelle); }
  loeschen(slug: unknown, quelle: Quelle): Promise<Antwort> { return loeschen.call(this, slug, quelle); }
  oeffnen(slug: unknown, quelle: Quelle, bestaetigt = false): Promise<Antwort> { return oeffnen.call(this, slug, quelle, bestaetigt); }
  // B10 versions (project/versionen.ts). The list of the open project; nothing open: empty.
  versionen(): VersionEintrag[] { return this.offen ? this.projekte.versionen.liste(this.offen.slug) : []; }
  versionSichern(name: string, quelle: string): Promise<{ id: string }> { return versionSichern.call(this, name, quelle); }
  versionZurueck(id: string, quelle: string): Promise<{ gesichert_als: string }> { return versionZurueck.call(this, id, quelle); }
  schliessen(quelle: Quelle, bestaetigt = false): Promise<Antwort> { return schliessen.call(this, quelle, bestaetigt); }
  liveOeffnen(quelle: Quelle, bestaetigt = false, nurWennLeer = false): Promise<Antwort> {
    return liveOeffnen.call(this, quelle, bestaetigt, nurWennLeer);
  }
  private liveFaderErgebnis(): Promise<{ angehoben: string[]; gemeldet: string[] }> { return liveFaderErgebnis.call(this); }
  private kanalOffenGesehen(kanal: string): boolean { return kanalOffenGesehen.call(this, kanal); }
  private kanalBelegtGesehen(kanal: string): boolean { return kanalBelegtGesehen.call(this, kanal); }
  private liveModulFader(modus: 'oeffnen' | 'wartend' = 'wartend'): Promise<{ angehoben: string[]; gemeldet: string[] }> {
    return liveModulFader.call(this, modus);
  }
  private liveSpielt(): boolean { const a = this.lage.arr; return !!a && (a.status === 1 || a.status === 2); }
  private slotGruppe(p: Projekt, slot: Slot): Projekt['gruppen'][number] | undefined { return slotGruppe.call(this, p, slot); }
  private kanalZuUndBekannt(slot: Slot): boolean { return kanalZuUndBekannt.call(this, slot); }
  private liveFaderFaellig(): boolean { return liveFaderFaellig.call(this); }
  private liveModulFaderLauf(modus: 'oeffnen' | 'wartend'): Promise<{ angehoben: string[]; gemeldet: string[] }> {
    return liveModulFaderLauf.call(this, modus);
  }
  private liveTempo(quelle: Quelle): Promise<void> { return liveTempo.call(this, quelle); }
  private liveOeffnenOhneTempo(quelle: Quelle, bestaetigt = false, nurWennLeer = false): Promise<Antwort> {
    return liveOeffnenOhneTempo.call(this, quelle, bestaetigt, nurWennLeer);
  }
  private sperreLiveLaeuft(quelle: Quelle, bestaetigt: boolean): void { return sperreLiveLaeuft.call(this, quelle, bestaetigt); }
  private sperreOeffnen(): void { return sperreOeffnen.call(this); }
  private sperreFremderTransport(quelle: Quelle): void { return sperreFremderTransport.call(this, quelle); }
  private fremderLauf(quelle: Quelle): boolean { return fremderLauf.call(this, quelle); }
  private oeffnetGerade(f: () => Promise<Antwort>): Promise<Antwort> { return oeffnetGerade.call(this, f); }
  private oeffneIntern(slug: string, quelle: Quelle): Promise<Antwort> { return oeffneIntern.call(this, slug, quelle); }
  private schliesseOffen(quelle: Quelle): Promise<void> { return schliesseOffen.call(this, quelle); }
  // Beim Beenden des Servers: ausstehenden Mixer-Eintrag schreiben, Sperre freigeben
  // plan 1.11 D8: the server ends: the plugin states are written first (at most 3 s), then schliesse()
  async beende(): Promise<void> { await Promise.all([this.hosts.beende(), this.instrumente.beende()]); }
  schliesse(): void { return schliesse.call(this); }

  private synchronisiere(quelle: Quelle, wiederanlauf = false): Promise<Record<string, unknown>> {
    return synchronisiere.call(this, quelle, wiederanlauf);
  }

  private istWiederanlauf(p: Projekt): Promise<boolean> { return istWiederanlauf.call(this, p); }
  private unbekannteSpurRegler(p: Projekt): Soll[] { return unbekannteSpurRegler.call(this, p); }
  private stelleMasterAbHer(p: Projekt, pfade: ReadonlySet<string>, quelle: Quelle): Promise<void> {
    return stelleMasterAbHer.call(this, p, pfade, quelle);
  }
  private uebernimmMixer(o: Offen, ausnahmen?: ReadonlySet<string>): number { return uebernimmMixer.call(this, o, ausnahmen); }

  // Container core M5: /k/container/quelle for every container whose source differs from what the core was last told (`alle`: all four, the replay after a
  // core restart). Order (F5): a container that gets a module (art 2) is told AFTER the playback swap (the module exists), every other one BEFORE it (the
  // group is dropped last), so `welche` picks the half. A receipt of status 6 is a refusal and is returned; no receipt (no core) is not told, so the
  // next call sends it again. Production projects have no places: nothing is sent.
  private async sendeContainer(p: Projekt, welche: 'vor' | 'nach' | 'beide', quelle: Quelle,
    alle = false): Promise<{ container: number; art: number; status: number; grund: string }[]> {
    const soll = containerQuellen(p);
    if (!soll) return [];
    const abgelehnt: { container: number; art: number; status: number; grund: string }[] = [];
    for (let i = 0; i < 4; i++) {
      if (!alle && soll[i] === this.containerGesendet[i]) continue;
      if (welche !== 'beide' && (soll[i] === 2) !== (welche === 'nach')) continue;
      const q = await this.kern.containerQuelle(i + 1, soll[i], quelle);
      if (quittungAbgelehnt(q)) { abgelehnt.push({ container: i + 1, art: soll[i], status: q!.status, grund: q!.grund }); continue; }
      if (q !== null) this.containerGesendet[i] = soll[i];
    }
    return abgelehnt;
  }
  private ladeWiedergabe(quelle: Quelle, vorhoeren?: ReadonlyMap<string, string>): Promise<Record<string, unknown>> {
    return ladeWiedergabe.call(this, quelle, vorhoeren);
  }
  private schreibeVorhoerWiedergabe(p: Projekt, vorhoeren: ReadonlyMap<string, string>, streng = false): number | null {
    return schreibeVorhoerWiedergabe.call(this, p, vorhoeren, streng);
  }
  private uebersetzeFuer(p: Projekt, nr: number, vorhoeren?: ReadonlyMap<string, string>, live = true, ohneHost?: ReadonlySet<number>): Wiedergabe {
    return uebersetzeFuer.call(this, p, nr, vorhoeren, live, ohneHost);
  }
  private hostNeuLaden(): void { return hostNeuLaden.call(this); }
  private hostBelegung(p: Projekt): Map<number, string> { return hostBelegung.call(this, p); }
  private ladeNr(ladeNr: number, quelle: Quelle, schluessel: number = ladeNr): Promise<Quittung> { return ladeNrF.call(this, ladeNr, quelle, schluessel); }
  private schreibeNeueWiedergabe(p: Projekt): number | Record<string, unknown> { return schreibeNeueWiedergabe.call(this, p); }
  private bereiteWiedergabe(o: Offen, p: Projekt, vorhoeren: ReadonlyMap<string, string>): Record<string, unknown> {
    return bereiteWiedergabe.call(this, o, p, vorhoeren);
  }
  private leereKiMaske(): Promise<Record<string, unknown>> { return leereKiMaske.call(this); }

  offeneShas(): Set<string> { return offeneShas.call(this); }
  private readonly deckelGemeldet = new Set<string>();
  private readonly deckelSperre = { bis: 0 };
  private deckelDekodiert(frisch: string | null): void { return deckelDekodiert.call(this, frisch); }

  // --- Dekodier-Cache (Spec 2.8) ----------------------------------------------------------------------------------------
  private zustandVon(sha: string): DekodiertZustand { return this.cache.zustand(sha); }
  private quellPfad(sha: string, hinweis: string, slug: string | null = this.offen?.slug ?? null): string | null {
    return quellPfad.call(this, sha, hinweis, slug);
  }
  katalogQuelle(sha: string): { pfad: string; name?: string } | null { return katalogQuelle.call(this, sha); }
  /** The resolver for the collector and the collect route (the same as the session's own). */
  quellePfadVon(sha: string, hinweis: string): string | null { return this.quellPfad(sha, hinweis); }
  private meldeEinsammeln(o: Offen): void { return meldeEinsammeln.call(this, o); }
  projektQuellPfad(sha: string): string | null { return projektQuellPfad.call(this, sha); }
  private gleicheDekodiertAb(p: Projekt, fehlerNeu: boolean, slug: string | null = this.offen?.slug ?? null): Set<string> {
    return gleicheDekodiertAb.call(this, p, fehlerNeu, slug);
  }
  private betrifftWiedergabe(p: Projekt, geaenderteShas: Iterable<string>): boolean { return betrifftWiedergabe.call(this, p, geaenderteShas); }
  private readonly zellZustand = new Map<string, DekodiertZustand>();
  private dekodiertEreignis(e: DekodierEreignis): void { return dekodiertEreignis.call(this, e); }

  private tempoQuelleFuer(z: Zeile, sha: string): TempoQuelle { return tempoQuelleFuer.call(this, z, sha); }
  private loeseQuellenAuf(befehle: unknown[], projekt: Projekt):
    { befehle: unknown[]; quellen: Map<string, string>; hinweise: Hinweis[]; wuensche: Anforderung[] } {
    return this.quellen.loeseQuellenAuf(befehle, projekt);
  }
  // 1.9 U5 (O28 on Surge): the current host values of the parameters that geraet_richtung commands of this list need and the track's map does not hold
  // yet (one read per slot), and whether filter 1 is on in the patch of each host a filter word goes to (one state read per slot; a word that hangs only
  // on filter 1 does nothing with filter 1 off, richtung_wirkungslos). undefined: nothing to read. A host that does not answer leaves the values out;
  // the command then refuses wirt_wert_unbekannt (a filter state that is not known never blocks).
  private async surgeIstFuer(p: Projekt, befehle: unknown[]):
    Promise<{ ist: (slot: number, name: string) => number | null; filter1An: (slot: number) => boolean | null } | undefined> {
    const noetig = new Map<number, Set<string>>();
    const filterSlots = new Set<number>();
    for (const b of befehle) {
      const x = b as Koerper;
      if (x?.befehl !== 'geraet_richtung' || typeof x.spur_id !== 'string' || typeof x.wort !== 'string') continue;
      const g = sucheSpur(p, x.spur_id)?.geraet;
      if (g?.art !== 'wirt' || g.name !== 'surge') continue;
      if (Object.hasOwn(SURGE_RICHTUNGEN, x.wort) && nurFilter1(x.wort)) filterSlots.add(g.slot);
      for (const n of surgeParameterVon(x.wort)) if (!Object.hasOwn(g.parameter ?? {}, n)) noetig.set(g.slot, (noetig.get(g.slot) ?? new Set<string>()).add(n));
    }
    if (noetig.size === 0 && filterSlots.size === 0) return undefined;
    const gelesen = new Map<string, number>();
    for (const [slot, namen] of noetig) {
      const w = await this.surge.ist(slot, [...namen]);
      if (w) for (const [n, v] of Object.entries(w)) gelesen.set(`${slot}:${n}`, v);
    }
    const filter = new Map<number, boolean>();
    for (const slot of filterSlots) {
      const an = await this.surge.filter1An(slot);
      if (an !== null) filter.set(slot, an);
    }
    return { ist: (slot, name) => gelesen.get(`${slot}:${name}`) ?? null, filter1An: (slot) => filter.get(slot) ?? null };
  }
  private pruefeRev(o: Offen, rev: unknown): void { return pruefeRev.call(this, o, rev); }

  aendern(d: Koerper, quelle: Quelle, erwartet?: Offen): Promise<Antwort> { return aendern.call(this, d, quelle, erwartet); }
  private musterVorlauf(befehle: unknown[], projekt: Projekt): Promise<void> { return musterVorlauf.call(this, befehle, projekt); }
  private einsRueckweg(o: Offen, roh: unknown[], quelle: Quelle): Hinweis[] { return einsRueckweg.call(this, o, roh, quelle); }
  private starteAnalysen(o: Offen, quelle: Quelle, wuensche: Anforderung[], alt: Projekt): void {
    return starteAnalysen.call(this, o, quelle, wuensche, alt);
  }
  private analyseEnde(sha: string, ei: AnalyseEintrag, ende: AnalyseEnde): void { return analyseEnde.call(this, sha, ei, ende); }
  private ankunft(sha: string, w: Wunsch): Promise<string> { return ankunft.call(this, sha, w); }

  umkehr(art: 'undo' | 'redo', d: Koerper, quelle: Quelle): Promise<Antwort> { return umkehr.call(this, art, d, quelle); }
  private umkehrVollzug(o: Offen, art: 'undo' | 'redo', quelle: Quelle): Promise<Antwort> { return umkehrVollzug.call(this, o, art, quelle); }

  private vollziehe(o: Offen, quelle: Quelle, regler: Soll[], schreibe: (h: Haken) => Wirkung, quellen: Map<string, string>,
    betrifftWiedergabe: boolean, stifte: StiftAenderung[] = [], ziel?: Projekt): Promise<Antwort> {
    return vollziehe.call(this, o, quelle, regler, schreibe, quellen, betrifftWiedergabe, stifte, ziel);
  }
  private stifteZurueck(stand: Projekt, liste: readonly StiftAenderung[], quittungen: readonly Quittung[], quelle: Quelle): Promise<void> {
    return stifteZurueck.call(this, stand, liste, quittungen, quelle);
  }
  private reglerZurueck(alt: Projekt, ergebnis: ReglerErgebnis[], quelle: Quelle): Promise<void> {
    return reglerZurueck.call(this, alt, ergebnis, quelle);
  }

  transport(d: Koerper, quelle: Quelle): Promise<Antwort> { return transport.call(this, d, quelle); }
  private sperreFremderStart(quelle: Quelle): void { return sperreFremderStart.call(this, quelle); }
  private sperreTransport(): void { return sperreTransport.call(this); }
  // Spec 6.32: für POST /tempo des Seiten-Servers (Studio-Route und Werkzeug tempo): läuft gerade eine Freeze-Sperre?
  ladenGesperrt(): boolean { return this.sperren > 0; }
  private tempoVorStart(ziel: number, quelle: Quelle): Promise<Record<string, unknown>> { return tempoVorStart.call(this, ziel, quelle); }

  sperreLaden(fuer?: 'aufnahme'): () => void { return sperreLaden.call(this, fuer); }
  private holeNach(o: Offen): Promise<void> { return holeNach.call(this, o); }
  private pruefeMarkerInQuelle(alt: Projekt, neu: Projekt): void { return pruefeMarkerInQuelle.call(this, alt, neu); }
  private pruefeAufnahmeSpuren(p: Projekt, befehle: readonly unknown[]): void { return pruefeAufnahmeSpuren.call(this, p, befehle); }
  private pruefeSperre(alt: Projekt, neu: Projekt, betrifftWiedergabe: boolean): void { return pruefeSperre.call(this, alt, neu, betrifftWiedergabe); }
  // Laden, außer während der Sperre: dann merken und bei der letzten Freigabe nachholen
  private async ladeOderMerke(quelle: Quelle): Promise<Record<string, unknown>> {
    if (this.sperren > 0) { this.brauchOffen().merk.laden = true; return { nr: null, aufgeschoben: true }; }
    return this.ladeWiedergabe(quelle);
  }
  // pre-listen of takes: see session_prelisten.ts
  private leereVorhoeren(o: Offen): boolean {
    return this.vorhoeren.leereVorhoeren(o);
  }
  private gueltigeVorhoeren(o: Offen, p: Projekt): Map<string, string> {
    return this.vorhoeren.gueltigeVorhoeren(o, p);
  }
  private setzeVorhoeren(o: Offen, neu: ReadonlyMap<string, string>): void {
    this.vorhoeren.setzeVorhoeren(o, neu);
  }
  vorhoerenLage(): Antwort { return this.vorhoeren.vorhoerenLage(); }
  vorhoerenSetzen(d: Koerper, quelle: Quelle): Promise<Antwort> { return this.vorhoeren.vorhoerenSetzen(d, quelle); }
  beendeVorhoeren(): Promise<void> { return this.vorhoeren.beendeVorhoeren(); }

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
  // Read-only: a stored project by slug (the open one as it is now, any other from its file).
  // An unknown slug is AblageFehler `unbekannt`, a bad one `slug_ungueltig`.
  liesProjekt(slug: string): Projekt {
    const o = this.offen;
    return o && o.slug === slug ? o.projekt : this.projekte.lies(slug);
  }
  hoereBk(spurId: string, werte: Readonly<Record<string, number>>, quelle: Quelle, faderDb?: number): Promise<void> {
    return hoereBk.call(this, spurId, werte, quelle, faderDb);
  }
  hoereMaster(zeilen: readonly { pfad: string; wert: number }[], quelle: Quelle): Promise<void> { return hoereMaster.call(this, zeilen, quelle); }
  // Spec 6.34: S3 meldet Beginn (art, beim Freeze spur_id) und Ende (null) jedes Laufs; nur diese Form geht an die Seite
  setzeAufnahmeLauf(l: unknown): void { this.aufnahmeLauf = l; }
  aufnahmeAktiv(): boolean { return this.aufnahmeLauf !== null || this.sperrenAufnahme > 0; }
  setzeStemsStand(x: Record<string, unknown> | null): void { this.stemsStand = x; }
  setzeNotenStand(x: Record<string, unknown> | null): void { this.notenStand = x; }
  setzeNotenRender(n: NotenRenderQuelle | null): void { this.notenRender = n; }
  // the export waits for the renders of the open project (true at once without a render service)
  notenBereit(fristMs: number): Promise<boolean> { return this.notenRender?.bereit?.(fristMs) ?? Promise.resolve(true); }
  notenExakt(): boolean { return this.notenRender?.exakt?.() ?? true; }            // the last export translation gave every clip with targets its exact render
  notenFehlerGrund(): string | null { return this.notenRender?.fehlerGrund?.() ?? null; }
  private readonly schliessHaken: ((slug: string) => void)[] = [];   // Slice 6 (T7): Läufe, die zum offenen Projekt gehören
  beiSchliessen(f: (slug: string) => void): void { this.schliessHaken.push(f); }
  // The page server remembers the open project across its own restart: f(slug) after every successful open, f(null) after a close on purpose
  private readonly offenHaken: ((slug: string | null) => void)[] = [];
  beiOffen(f: (slug: string | null) => void): void { this.offenHaken.push(f); }
  // 1.8 S3 (D13): listeners that follow the open project (the recording area keeps the core in sync with arm, input, mode and monitor)
  private readonly standHaken: ((p: Projekt) => void)[] = [];
  beiStand(f: (p: Projekt) => void): void { this.standHaken.push(f); }
  // f() at the start of every core restart handling (nachNeustart), before any row is sent: the core is fresh and holds the project's values
  private readonly neustartHaken: (() => void)[] = [];
  beiNeustart(f: () => void): void { this.neustartHaken.push(f); }
  private meldeStand(o: Offen): void { return meldeStand.call(this, o); }
  setzeAusgabeLauf(l: AusgabeLauf | null): void {
    this.ausgabeLauf = l === null ? null : l.art === 'freeze' ? { art: 'freeze', spur_id: l.spur_id }
      : l.art === 'export' && l.echtzeit ? { art: 'export', echtzeit: true, start_ms: l.start_ms, dauer_s: l.dauer_s }
      : l.art === 'resample' ? { art: 'resample', strang_id: l.strang_id } : { art: l.art };
  }
  // Spec 6.25: die nächste Nummer des einen Wiedergabe-Zählers der Instanz (derselbe wie für /k/arr/laden, mit Zustandsdatei, Spec 6.30), für die
  // Freeze-Kennung. Eine Kennung kommt so nie zweimal und nie gleich einer Wiedergabe-Nummer.
  naechsteNummer(): number { return this.zaehler.naechste(); }
  schreibeWiedergabeFuer(p: Projekt): { nr: number; datei: string } { return schreibeWiedergabeFuer.call(this, p); }
  uebernimm(w: Wirkung, meta: Meta): Promise<void> { return uebernimm.call(this, w, meta); }
  private meldeRegler(o: Offen, regler: ReglerErgebnis[]): void { return meldeRegler.call(this, o, regler); }
  private wacheStart(): void { return wacheStart.call(this); }
  private wacheStopp(): void { if (this.wirtWache) { clearInterval(this.wirtWache); this.wirtWache = null; } }
  // 1.9 U5: brings the hosts to the open project's Surge map and resolves when they answered (the freeze path waits for it). A missing host or an
  // error answer is logged, never thrown, and the entries stay pending; the errors come back as text so the freeze can refuse a sound that would not
  // match the map. Without an open project it only waits for the jobs already queued.
  async wirtSpiegel(): Promise<string[]> {
    const o = this.offen;
    if (o) return (await this.surge.gleiche(o.projekt, false, true)).fehler;   // the patch is loaded again: the host may have been changed by hand
    await this.surge.fertig();
    return [];
  }
  // Projekttempo an den Master auf dem einen Tempo-Weg (Spec 2.7), zurück erst nach dem Rampen-Ende. deck_laeuft nur, wenn das Master-Tempo
  // abweicht UND ein Deck läuft.
  async tempoAnMaster(): Promise<void> {
    const o = this.brauchOffen();
    const t = await this.tempoVorStart(o.projekt.tempo_bpm, 'andreas');
    const grund = (t.fehler ?? t.grund) as string | undefined;
    if (grund) throw new ProjFehler(grund === 'kein_kern' ? 503 : 409, grund, { tempo: t });
  }

  // --- 1.12 slice 3 (task 4): overridden lanes ---------------------------------------------------------------------------
  // AK34: the release of every override; a refusal, no core or an error is logged, never thrown (open must not fail because of it)
  // The regulator groups ("spur/", "grp/", ...) the writes touch, as prefixes for /k/hand/frei; source andreas like the rest of the housekeeping
  private async handFreiMitLog(soll: readonly Soll[], quelle: Quelle): Promise<void> {
    // Exactly what the switch writes: spur/, grp/, ret/ as prefixes, one erz channel (erz/4/, never erz/ whole: instruments and pads stay), else the path
    const teil = (p: string): string => {
      const s = p.split('/');
      return ['spur', 'grp', 'ret'].includes(s[0]) ? `${s[0]}/` : s[0] === 'erz' ? `erz/${s[1]}/` : p;
    };
    // ins/* and rack/* rows are project-only (POST /regler answers 409 ueber_projekt), the hand never holds them: 231 single paths would overflow the list
    const pfade = [...new Set(soll.filter((r) => !r.pfad.startsWith('ins/') && !r.pfad.startsWith('rack/')).map((r) => teil(r.pfad)))].join(',');
    if (!pfade) return;
    try {
      const q = await this.kern.handFrei(pfade, quelle);
      if (q === null) this.ctx.log({ typ: 'proj_hand_frei_ohne_quittung', pfade });
      else if (quittungAbgelehnt(q)) this.ctx.log({ typ: 'proj_hand_frei_fehler', quittung: q });
    } catch (e) { this.ctx.log({ typ: 'proj_hand_frei_fehler', fehler: (e as Error).message }); }
  }
  private async autoFreiMitLog(): Promise<void> {
    try {
      const q = await this.kern.autoFrei();
      if (q === null || quittungAbgelehnt(q)) this.ctx.log({ typ: 'proj_auto_frei_fehler', quittung: q });
    } catch (e) { this.ctx.log({ typ: 'proj_auto_frei_fehler', fehler: (e as Error).message }); }
  }
  // automation mirror and arm calls: see session_auto.ts
  private istUebersteuert(spurId: string, ziel: string): boolean { return this.auto.istUebersteuert(spurId, ziel); }
  private uebersteuertListe(p: Projekt): { spur_id: string; ziel: string }[] {
    return this.auto.uebersteuertListe(p);
  }
  private raeumeNummern(p: Projekt | undefined): void {
    this.auto.raeumeNummern(p);
  }
  private nimmAuto(f: Record<string, unknown>): void {
    this.auto.nimmAuto(f);
  }
  private async armFreiMitLog(): Promise<void> {
    await this.auto.armFreiMitLog();
  }
  private async schreibeTake(label: string, befehle: Record<string, unknown>[], kennung: Offen): Promise<void> {
    await this.auto.schreibeTake(label, befehle, kennung);
  }
  autoUebersteuern(d: Koerper, quelle: Quelle): Promise<Antwort> { return this.auto.autoUebersteuern(d, quelle); }
  autoReEnable(d: Koerper, quelle: Quelle): Promise<Antwort> { return this.auto.autoReEnable(d, quelle); }
  autoArm(d: Koerper, quelle: Quelle): Promise<Antwort> { return this.auto.autoArm(d, quelle); }
  autoGeste(d: Koerper, quelle: Quelle): Antwort { return this.auto.autoGeste(d, quelle); }

  ereignis(adresse: string, f: Record<string, unknown>): void { return ereignis.call(this, adresse, f); }
  private rueckweg(pfad: string, wert: number, quelle: Quelle = 'andreas'): void { return rueckweg.call(this, pfad, wert, quelle); }
  private rueckwegSpeichern(): void { return rueckwegSpeichern.call(this); }

  private nachNeustart(): void { return nachNeustart.call(this); }
}
// for the classes split out of ProjSitzung (session_device.ts, session_sources.ts)
export type { Hinweis, Koerper, Offen };
export { graphArt, steckfeldLookup };
export {
  AUTO_PUNKTE_VORGABE, MARKER_VORGABE, ProjFehler, REV_JETZT, RUECKWEG_MS, TRANSIENTEN_MAX, TRANSIENTEN_VORGABE, bkGraphenFehlen, hkKurz,
  midiLage,
} from './session_helpers.ts';
export { type Antwort, type AusgabeLauf, type ProjOptionen } from './session_helpers.ts';
export { GESTE_RUHE_MS } from './session_helpers.ts';
