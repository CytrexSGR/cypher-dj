// cypherdj-oberflaeche (Scheibe 60m): liefert die MVP-Seite aus und ist ihr Arm zum Kern.
// - Andreas' Griffe (POST /griff) gehen als /test/hand (§19.0, Semantik der Hand §7.3) an den Kern, sein Laden
//   (POST /laden) als /k/deck/laden mit Quelle andreas (§4.4). Der Leitstand sieht beides über /e/hand, /e/regler,
//   /e/geladen und /q; gelesen wird dort (WS §9, Rolle anzeige), nicht hier.
// - Kern-Abonnent (§4.1) für die schnellen Anzeigen, die der Leitstand nicht verteilt: /uhr, /zustand/deck, /pegel,
//   /e/regler, /e/hand, /e/geladen, /q, /e/protokollfehler → SSE an die Seite (GET /strom), gedrosselt.
// - Nur POST sendet an den Kern. Öffnen der Seite, /strom, /bestand, /konfig senden nichts (Negativ-Kontrolle A1).
// - 60m-Nachtrag: vor /k/deck/laden kopiert der Server die Fassung aus dem Bestand in den Arbeitsbestand
//   (working_inventory.ts, Form Plan 36 F2), geprüft gegen fassung.json; kaputt oder fehlend → 400, nichts an den Kern,
//   keine halbe Kopie. Beim Start räumt er Reste toter Kopien (.kopie-<pid>-<n>) weg.
// Aufruf: node djk/ui/server.ts [--port N] [--kern-port N] [--abo-port N] [--leitstand-ws N] [--bestand DIR]
//   [--mediathek DATEI]  (Vorgabe $CYPHERDJ_MEDIATHEK, z. B. /path/to/mediathek.sqlite; nur lesen)
//   [--katalog DATEI]    (Vorgabe $CYPHERDJ_KATALOG, sonst katalog.sqlite neben der Mediathek; nur lesen)
//   [--analyse DIR]      (Slice 3a: Analyse-Ablage der Karten; Vorgabe nur im Betrieb: $CYPHERDJ_ANALYSE, sonst ~/werkstatt/cypher-dj-analyse; nur lesen)
//   [--korrekturen DIR]  (Slice 3b: Bestand des Decks, in den Set 1.1.1 Here die Eins-Korrektur schreibt; Vorgabe nur im Betrieb: --bestand; Prüfinstanz nur ausdrücklich)
//   [--python DATEI]     (Slice 3a: Python für Werkstatt-Aufträge und waveform.py; Vorgabe $CYPHERDJ_PYTHON, sonst die venv der Werkstatt)
//   [--welle-cache ORDNER]  (Vorgabe: Betrieb ~/.cache/cypherdj/welle, Prüfinstanz /dev/shm/cypherdj-<i>/welle)
//   [--digitalout DATEI]  (Glanz 2.1, F22: Standdatei der Digital-Out-Wache; fehlt sie, gilt 'unbewacht')
//   [--arbeitsbestand DIR]  (Vorgabe /dev/shm/cypherdj/material, mit Prüfinstanz /dev/shm/cypherdj-<i>/material)
//   [--ziel-kurve kern|attrappe_linear]  (Vorgabe kern; Prüfstapel gegen die Attrappe: attrappe_linear)
//   [--kern-pruefmodus an|aus]  (ohne Angabe unbekannt: gelernt aus /e/protokollfehler des Kerns auf /test/hand;
//   aus → POST /griff 409 pruefmodus_aus, „hand input needs test mode until slice 35“, nichts an den Kern)
// Umgebung: CYPHERDJ_INSTANZ (Z2: Ports +1000·k), OBERFLAECHE_MUTATION=riegel_aus (nur Prüfung: Ziel-Riegel aus).
import fs from 'node:fs';
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { KernAnbindung } from '../conductor/src/core.ts';
import { KernWeg } from './areas/proj/core_path.ts';
import { json as sendeJson, koerper as leseKoerper } from './http/transport.ts';
import { Seitenfehler } from './seitenfehler.ts';
import { Kopplung, type TabletHandler } from './http/coupling.ts';
import { bremsRegel, type HandRegel, type Stufe } from './http/hand_schutz.ts';
import { stufenRegel } from './http/hand_stufe.ts';
import { eimerRegel } from './http/hand_eimer.ts';
import { spielRegel } from './http/hand_spielregel.ts';
import { HandSchluessel } from './http/hand_key.ts';
import { HandLog } from './http/hand_log.ts';
import { Router, type Route, type Bereich } from './http/router.ts';
import { projBereich } from './areas/proj/area.ts';
import { KollektionSpeicher } from './collections/store.ts';
import { ausgabeBereich } from './areas/proj/output.ts';   // Paket S3
import { aufnahmeBereich } from './areas/proj/recording.ts';   // 1.8 Slice 1
import { stemsBereich } from './areas/proj/stems.ts';   // 1.13 Slice 6
import { notenBereich } from './areas/proj/notes.ts';   // note editor (slice 1, B2)
import { NotenRender } from './areas/proj/notes_render.ts';   // note editor (slice 1, B4)
import { MasterPegel } from './project/master_level.ts';
import { LiveHarmonie } from './areas/live/harmonie.ts';   // strand 7 task 2.3: live harmony lane
import type { Dekodiert, Felder } from '../conductor/src/addresses.ts';
import { ZIEL_KURVEN } from './public/curves.js';

const TASTEN = ['annehmen', 'verwerfen', 'stopp', 'freigabe'];
import { HAND_PRUEFMODUS_TEXT } from './public/messages.js';
import { WelleCache } from './wave_cache.ts';
import { REPO, REPO_PFADE, instanz, ports, shmOrdner, musterOrdnerVorgabe, loopOrdnerVorgabe, welleCacheVorgabe, arbeitsbestandVorgabe, ablageOrdner } from './paths.ts';
import { sprungDelta, type Fassung, rasterErbe } from './deck_operation.ts';
// @ts-expect-error reines .mjs ohne Typen (djk/loops)
import { kanalOffen } from './hand_operation.ts';
import { rueckAlias } from './stream_alias.ts';
import { Sammlungen, SammlungFehler } from './collection.ts';
import { MusterBibliothek } from './pattern_library.ts';
import { Katalog, KatalogFehler, katalogVorgabe, type Typ, type Zeile, type Filter } from './catalog.ts';
import { Erreichbarkeit } from './erreichbar.ts';   // media browser slice 1
import { Quellen } from './sources.ts';   // storage layout A4
import { KatalogJob } from './catalog_job.ts';
import { ImportDienst } from './importe.ts';
import { Einsammler } from './project/einsammeln.ts';   // storage layout A5
import { Vorhoeren, kernNurCueVorgabe, vorhoeerKlientVorgabe } from './prelisten.ts';
import { Mediathek, Vorbereiter, mediathekVorgabe } from './media_library.ts';
import { type Fahrt } from './track.ts';
import { leseAusgang } from './output.ts';
import { OhrLeser, K as OHR_K, Hoerscheinstelle, type Hoerschein } from './ear.ts';
// @ts-expect-error reines .mjs ohne Typen (djk/generator); muster_stand lädt Strudel NICHT (Plan-Review M3)
import { PegelPuffer } from './level_buffer.ts';
import { leseLebt } from '../generator/src/pattern_state.mjs';
import { ALLE_STROEME } from '../contract/streams.ts';   // S18: stream <-> channel table
import { pultContainerPfad } from '../contract/pult.ts';
import { graphenNachNeustart } from './graphs.ts';   // Baukasten S12

import { handOrdnerVon, handLogOrdnerVon, kopplungPfadVon, pythonVorgabe, STROM_MAX_BYTES, DROSSEL_MS, INS_GR_FRIST_MS, DURCHREICHEN, leseBestand, kompAbweichend, OFFENE_DECKS, istOffenesDeck, WERKZEUG_PFAD, werkzeugAbweichend, bkAbweichend, LAGE_KANALZUG, LAGE_SEND, LAGE_ABWEICHEND, NEUSTART_STAND_ADRESSEN, CONTAINER_ART, type NeustartStand } from './server_kopf.ts';
import type { ServerOptionen, Pruefmodus, SpurLauf } from './server_kopf.ts';
import * as ST from './areas/bibliothek/browse.ts';
import * as SL from './areas/spur/run.ts';
import * as SZ from './areas/spur/szene.ts';
import * as KL from './areas/spur/sound.ts';
import * as SC from './areas/spur/schleifen.ts';
import * as DK from './areas/live/deck.ts';
import * as GF from './areas/live/graph_fx.ts';
import * as NS from './areas/live/restart.ts';
import * as SD from './areas/live/strudel.ts';
import * as RS from './areas/live/grid.ts';
import * as RG from './areas/live/controls.ts';
import * as WI from './areas/live/instrument_host.ts';
import * as LW from './areas/live/loop_wave.ts';
import * as LB from './areas/server/lebenslauf.ts';
import * as AN from './areas/server/anfrage.ts';
import * as KX from './areas/server/context.ts';
import * as BE from './areas/server/areas.ts';
export { hauptCheckout, pythonVorgabe, INS_GR_FRIST_MS, leseBestand, istOffenesDeck } from './server_kopf.ts';
export type { TabletOptionen, ServerOptionen, Pruefmodus } from './server_kopf.ts';

/** A restore plan: FX units 1/2, the FX 3 assignments and the graphs, each with the source of its last setting. */
type Wiederplan = {
  fx: { einheit: 1 | 2; felder: Felder; zuweisung: string[]; besitzer: string }[]; fx3: { zuweisung: string[]; besitzer: string } | null;
  graphen: ReturnType<typeof graphenNachNeustart> };

export class Oberflaeche {
  readonly opt: ServerOptionen;
  readonly kern: KernAnbindung;
  private http: http.Server | null = null;
  private tabletServer: http.Server | null = null;
  private tabletHandler: TabletHandler | null = null;
  private tablet: { adresse: string; port: number } | null = null;
  private readonly kopplung: Kopplung;
  private readonly seitenfehler: Seitenfehler;
  private readonly stroeme = new Set<http.ServerResponse>();
  private readonly letzte = new Map<string, number>();
  private readonly pegelPuffer = new PegelPuffer();   // ungedrosselt, vor der SSE-Drossel gefüttert (GET /pegel)
  private readonly wartend = new Map<string, NodeJS.Timeout>();
  private spektrumLetzt: { kanal: string; rahmen: number; pegel: string; zeit: number } | null = null;   // 1.15 A7b: last /zustand/spektrum frame
  private insGr: Record<string, { db: number; t: number }> = {};   // 1.10 slice 4a: last /e/ins_gr reading per stage (ins/komp/<n>) for /lage, not part of the SSE start picture
  private readonly stand = { regler: {} as Record<string, number>, decks: {} as Record<string, Felder>, geladen: {} as Record<string, Felder>,
    fx: [null, null] as (Felder | null)[], fxZuweisung: [{}, {}, {}] as Record<string, boolean>[],   // index 0 = FX1, 1 = FX2, 2 = FX3 (the remix insert on fx/3: any source channel, never master)
    hallPool: null as { an: boolean; faeden: number; spaet: number; zurueck: number } | null,   // mehrkern Task 5: the kern's /zustand/hall_pool (2 Hz and on change); null until it came, i.e. an old kern only: a kern without a pool sends nine zeros, which become {an: false, modus: 'aus', ...}
    spurPool: null as { an: boolean; modus: 'aus' | 'an' | 'auto'; blocks_parallel: number; einheiten_worker: number; einheiten_caller: number; seriell: number; haengt: number; spaet: number; zurueck: number } | null,   // mehrkern slice 3.2 Task 8: the kern's /zustand/spur_pool (2 Hz and on change); null until it came, i.e. no pool or an old kern
    kanalLimiter: null as { gebaut: boolean; latenz_samples: number } | null,   // 1.15 A5c: the kern's own word (/e/kanal_limiter); null until it came, a new kern says it again on its first hallo
    fxRouting: 'post_fader' as 'post_fader' | 'insert',   // Ohr T18: wo der Beat-FX in den Kanalzügen sitzt (Stand des Kerns)
    graphen_geladen: {} as Record<string, string> };   // Baukasten S12/S16: channel -> graph as the kern reports it (/e/graph); optimistic after a POST
  // Ohr T18: Andreas' letzte Wahl. Der Kern behält das Routing über einen Neustart nicht (Rev. 5); der Server sendet sie
  // nach /e/neustart erneut, wenn sie nicht die Vorgabe ist. Nur im Speicher: ein Server-Neustart kehrt zur Vorgabe zurück.
  private fxRoutingWunsch: 'post_fader' | 'insert' = 'post_fader';
  // Command ids: µs since the epoch (about 1.8e15), so they rise across page-server restarts and stay below 2^53 for good. The old start, the
  // monotonic clock in ns, passed 2^53 after 104 days of uptime; Number(++id) then rounded neighbouring ids to one double (audit U00).
  private id = BigInt(Date.now()) * 1000n;
  private generation: number | null = null;
  private readonly welle: WelleCache;
  private readonly ohr: OhrLeser;   // Ohr T5: Hüllkurven-Ring (§6.2), liest deck/1, deck/2, master
  private ohrTakt: NodeJS.Timeout | null = null;
  private graphenVomKernMs: number | null = null;   // Baukasten S16: when the kern last reported a graph slot (null: not known yet)
  private graphTakt: ReturnType<typeof setInterval> | null = null;   // Baukasten S16: asks the kern every 30 s
  private static readonly GRAPH_FRAGE_MS = 30000;
  // Effekt-Sektion Schritt 4: je Box die geplante Loop-Automation (Name, bis wohin geplant, nächste Teilnummer)

  // Ohr T10: Hörscheinstelle hält je Kanal den letzten Schein; `hoerscheine` ist dieselbe Objekt-Referenz wie
  // `hoerscheinstelle.scheine` (kein Copy), damit ein Test (oder eine spätere Anzeige) direkt hineinschreiben bzw.
  // lesen kann und die Hoerscheinstelle denselben Stand sieht.
  private readonly hoerscheinstelle = new Hoerscheinstelle();
  readonly hoerscheine: Record<string, Hoerschein> = this.hoerscheinstelle.scheine as Record<string, Hoerschein>;
  private hoerscheinLetzterTakt: number | null = null;
  pruefmodus: Pruefmodus;
  gesendet = 0;
  // Plan Grid (D5): je Deck der zuletzt an den Kern geschickte Versatz, mit dem Schlüssel der Fassung
  private readonly rasterLive: Record<string, { schluessel: string; v: number }> = {};
  private static fassungSchluessel(f: Fassung): string { return `${f.material_id}|${f.basis_bpm}|${f.fassung}`; }
  private rasterWert(...a: Parameters<typeof RS.rasterWert>) { return RS.rasterWert.call(this, ...a); }
  private rasterOrdner(...a: Parameters<typeof RS.rasterOrdner>) { return RS.rasterOrdner.call(this, ...a); }
  private huellenPfad(...a: Parameters<typeof RS.huellenPfad>) { return RS.huellenPfad.call(this, ...a); }
  private liveLetzt: { w: number; t: number } | null = null;   // GET /analyse/live: ring counter and time of the previous call
  private masterPegel = new MasterPegel();   // GET /analyse/pegel: streaming master meter, advances on every read
  private masterPegelW: number | null = null;   // ring counter the meter has read up to
  private masterPegelLetzt: { w: number; t: number } | null = null;   // ring counter and time of first sight, for steht
  // Gespeicherter Versatz der Fassung; fehlt ihre Datei, gilt die der nächstälteren Fassung (rasterErbe, Bericht grid-phase M7).
  private readonly einsGelesen = new Map<string, { eins: number; esf: number }>();
  private einsDerFassung(...a: Parameters<typeof RS.einsDerFassung>) { return RS.einsDerFassung.call(this, ...a); }
  private rasterErbeVon(...a: Parameters<typeof RS.rasterErbeVon>) { return RS.rasterErbeVon.call(this, ...a); }
  private rasterGespeichert(...a: Parameters<typeof RS.rasterGespeichert>) { return RS.rasterGespeichert.call(this, ...a); }
  private einsZurueck(...a: Parameters<typeof RS.einsZurueck>) { return RS.einsZurueck.call(this, ...a); }
  private rasterSenden(...a: Parameters<typeof RS.rasterSenden>) { return RS.rasterSenden.call(this, ...a); }
  private deckRaster(...a: Parameters<typeof RS.deckRaster>) { return RS.deckRaster.call(this, ...a); }
  private hoerenAus(...a: Parameters<typeof RS.hoerenAus>) { return RS.hoerenAus.call(this, ...a); }
  private osziAus(...a: Parameters<typeof RS.osziAus>) { return RS.osziAus.call(this, ...a); }
  private analyseLiveAus(...a: Parameters<typeof RS.analyseLiveAus>) { return RS.analyseLiveAus.call(this, ...a); }
  private analysePegelAus(...a: Parameters<typeof RS.analysePegelAus>) { return RS.analysePegelAus.call(this, ...a); }
  private hoerscheinTakt(...a: Parameters<typeof RS.hoerscheinTakt>) { return RS.hoerscheinTakt.call(this, ...a); }
  private deckRasterSet(...a: Parameters<typeof RS.deckRasterSet>) { return RS.deckRasterSet.call(this, ...a); }
  private deckRasterFix(...a: Parameters<typeof RS.deckRasterFix>) { return RS.deckRasterFix.call(this, ...a); }
  private rasterWieder(...a: Parameters<typeof RS.rasterWieder>) { return RS.rasterWieder.call(this, ...a); }

  private readonly mediathek: Mediathek;
  private readonly katalog: Katalog;
  private readonly erreichbar = new Erreichbarkeit();
  private readonly quellenMerk = new Map<string, { b: object; t: number; j: unknown }>();
  private readonly jetzt = (): number => Date.now();
  private readonly vorbereiter: Vorbereiter;
  private readonly vorhoeren: Vorhoeren;
  private readonly sammlungen: Sammlungen;
  private readonly muster: MusterBibliothek;
  private warteschlange: string[] = [];
  constructor(opt: ServerOptionen) {
    this.opt = opt;
    const python = opt.python ?? pythonVorgabe();
    this.welle = new WelleCache(opt.welleCache ?? welleCacheVorgabe(instanz()),
      python, REPO_PFADE.welleSkript, opt.log, { ffmpeg: opt.welleFfmpeg, zeitlimit: opt.welleZeitlimit });
    this.mediathek = new Mediathek(opt.mediathek ?? mediathekVorgabe());
    this.katalog = new Katalog(opt.katalog ?? katalogVorgabe(opt.mediathek ?? mediathekVorgabe()));
    const inst = instanz();
    const shm = shmOrdner(inst);
    this.vorhoeren = opt.vorhoeren ?? new Vorhoeren({ kopfhoererDa: () => Vorhoeren.kopfhoererDaVorgabe(inst), kernNurCue: () => kernNurCueVorgabe(shm),
      klient: () => vorhoeerKlientVorgabe(REPO, inst, opt.log), kantenDatei: path.join(shm, 'kanten'), instanz: inst });
    this.sammlungen = new Sammlungen(opt.sammlungen ?? ablageOrdner('sammlungen'));
    this.muster = new MusterBibliothek({ eigen: opt.musterBibliothek ?? ablageOrdner('muster'), sets: opt.musterSets ?? REPO_PFADE.musterSets, starter: opt.musterStarter ?? REPO_PFADE.musterStarter });
    this.vorbereiter = new Vorbereiter({ python: python,
      cwd: REPO_PFADE.werkstatt, bestand: opt.bestand, modul: opt.einleserModul, log: opt.log });
    this.ohr = new OhrLeser(this.huellenPfad(), [OHR_K.deck1, OHR_K.deck2, OHR_K.deck3, OHR_K.deck4, OHR_K.master]);
    this.pruefmodus = this.pruefmodusAusKonfig();
    this.kern = new KernAnbindung({ kernPort: opt.kernPort, aboPort: opt.aboPort, name: 'oberflaeche' }, {
      nachricht: (d) => this.vomKern(d),
      gesendet: (adresse, felder) => { if (adresse !== '/k/hallo') opt.log?.({ typ: 'an_kern', adresse, felder }); },
      zustand: (neu) => this.verteile({ a: 'kern', f: { zustand: neu } }),
      unlesbar: (grund) => opt.log?.({ typ: 'unlesbar', grund }),
    });
    this.seitenfehler = new Seitenfehler(this.hotcueOrdner());   // R7
    this.router.melde({ name: 'oberflaeche', routen: () => this.routenOberflaeche() });
    this.kopplung = new Kopplung(kopplungPfadVon(opt.tablet?.kopplungPfad, instanz()));
    this.schluessel = new HandSchluessel(handOrdnerVon(opt.hand?.ordner, instanz()));
    this.handLog = new HandLog(handLogOrdnerVon(opt.hand?.logOrdner, instanz()));
    this.router.melde({ name: 'kopplung', routen: () => this.routenKopplung() });
    this.router.melde({ name: 'hand', routen: () => this.routenHand() });
    BE.verdrahteBereiche.call(this, opt, python, inst);
  }

  starte(...a: Parameters<typeof LB.starte>) { return LB.starte.call(this, ...a); }

  // The project that was open last comes back after a restart of the page server: its slug lives in offenes_projekt.json next to neustart_stand.json (same
  // temp file and rename). It is written at every open and removed by a close on purpose (POST /proj/schliessen); djk-stop leaves it alone. The reopen goes
  // through ProjSitzung.oeffnen, the code of POST /proj/oeffnen, once the kern is there. It never sends a transport start. Any failure: start empty, one log
  // line, one notice on the demo overlay line (the SSE event `ansage`, also in /ansage).
  projektWieder: Promise<void> = Promise.resolve();
  private offenesProjektDatei(...a: Parameters<typeof NS.offenesProjektDatei>) { return NS.offenesProjektDatei.call(this, ...a); }
  private leseOffenesProjektDatei(...a: Parameters<typeof NS.leseOffenesProjektDatei>) { return NS.leseOffenesProjektDatei.call(this, ...a); }
  private merkeOffenesProjekt(...a: Parameters<typeof NS.merkeOffenesProjekt>) { return NS.merkeOffenesProjekt.call(this, ...a); }
  private projektWiederOeffnen(...a: Parameters<typeof NS.projektWiederOeffnen>) { return NS.projektWiederOeffnen.call(this, ...a); }
  private starteTablet(...a: Parameters<typeof LB.starteTablet>) { return LB.starteTablet.call(this, ...a); }
  private nurAndreasLoopback(...a: Parameters<typeof LB.nurAndreasLoopback>) { return LB.nurAndreasLoopback.call(this, ...a); }
  private routenHand(...a: Parameters<typeof LB.routenHand>) { return LB.routenHand.call(this, ...a); }
  private routenKopplung(...a: Parameters<typeof LB.routenKopplung>) { return LB.routenKopplung.call(this, ...a); }

  private gestoppt = false;
  stoppe(...a: Parameters<typeof LB.stoppe>) { return LB.stoppe.call(this, ...a); }
  private pruefmodusAusKonfig(...a: Parameters<typeof WI.pruefmodusAusKonfig>) { return WI.pruefmodusAusKonfig.call(this, ...a); }
  private setzePruefmodus(...a: Parameters<typeof WI.setzePruefmodus>) { return WI.setzePruefmodus.call(this, ...a); }

  private vomKern(d: Dekodiert): void {
    const f = d.felder;
    // Der Kern ohne Prüfmodus verwirft /test/hand als unbekannte Adresse (net.cpp paket(), §19.0) und meldet es allen
    // Abonnenten. Nur dieser Grund heißt „ohne Prüfmodus“; unbekannter_regler (falsches Ziel) heißt das Gegenteil.
    if (d.adresse === '/e/protokollfehler' && f.adresse === '/test/hand' && f.grund === 'unbekannte_adresse') {
      this.setzePruefmodus('aus', 'kern');
    }
    // Neue Generation (Kern neu gestartet, vielleicht mit anderem Schalter): wieder der Stand aus der Konfig
    const alteGeneration = this.generation;   // Slice 5 F4: nur eine NEUE Generation ist ein Kern-Neustart
    // t_7f487235: the first word of a kern after THIS server started. The stand of the file is true for the generation it was written in: the same kern kept
    // it (take it over, send nothing), a higher generation is a kern that restarted while this server was down (take it over as the snapshot of the plan below),
    // a lower one is a brake start without continuation (drop it). Without a file the first word counts as before.
    const erstkontakt = alteGeneration === null && (d.adresse === '/k/willkommen' || d.adresse === '/e/neustart');
    let platte = erstkontakt ? this.vomPlatte : null;
    if (erstkontakt) this.vomPlatte = null;
    // The same generation number is not the same running kern (generation 0 again after a reboot or a brake start): its sample position tells. A smaller one
    // than the file saw is another kern life, the file is of another day and dropped.
    const gruss = Number(f.sample);
    if (platte !== null && platte.sample !== undefined && Number.isFinite(gruss) && Number(f.generation) === platte.generation && gruss < platte.sample) {
      this.opt.log?.({ typ: 'neustart_stand_verworfen', grund: 'anderes_kernleben', generation: platte.generation, sample: gruss, gespeichert: platte.sample });
      platte = null;
    }
    if ((d.adresse === '/k/willkommen' || d.adresse === '/e/neustart') && Number.isFinite(gruss)) this.kernSample = gruss;
    const bezug = alteGeneration ?? platte?.generation ?? null;
    if (d.adresse === '/k/willkommen' || d.adresse === '/e/neustart') {
      const g = f.generation as number;
      if (this.generation !== null && g !== this.generation) {
        this.setzePruefmodus(this.pruefmodusAusKonfig(), 'neue_generation');
        this.stand.regler = {};   // Bug t_bffc3708: the values of the old kern are not the new kern's; it reports its own on its first hallo (before: /lage showed the old ones)
      }
      this.generation = g;
    }
    if (d.adresse === '/k/willkommen' && alteGeneration === null) this.fragGraphen('start');   // Baukasten S16: first contact
    if (d.adresse === '/e/graph') this.merkeGraph(String(f.kanal), String(f.name));   // Baukasten S16: the kern's word
    if (d.adresse === '/e/regler') {
      this.stand.regler[f.pfad as string] = f.wert as number;
      const alias = rueckAlias(this.proj.zugang.offen()?.projekt ?? null, String(f.pfad));   // the old erz/<n>/... key of a strom row: both keys carry the value
      if (alias !== null) {
        this.stand.regler[alias] = f.wert as number;
      }
    }
    if (d.adresse === '/e/halter' && f.halter === 'mensch') this.schleifenHandgriff(String(f.pfad));   // 1.12 S7 MAJOR 3
    if (d.adresse === '/e/regler' && f.pfad === 'spektrum/kanal') this.spektrumLetzt = null;   // 1.15 A7b: a frame of the old source must not be served for the new one
    if (d.adresse === '/zustand/spektrum') this.spektrumLetzt = { kanal: String(f.kanal), rahmen: Number(f.rahmen), pegel: String(f.pegel), zeit: Date.now() };   // before the throttle
    if (d.adresse === '/q') this.merkeQuittung(f);
    if (d.adresse === '/e/ki') this.setzeKiGestoppt(Number(f.gestoppt) === 1);
    // Riegel 2026-09-30: /e/ki kommt nur beim Wechsel; ein neu gestarteter Server holt den Stand aus dem periodischen
    // /zustand/kern (ki_gestoppt, Scheibe 25), sonst vergäße er ein gedrücktes Stop Cypher
    if (d.adresse === '/zustand/kern' && f.ki_gestoppt !== undefined) this.setzeKiGestoppt(Number(f.ki_gestoppt) === 1);
    if (d.adresse === '/zustand/deck') { this.merkeNachgeladen(f); this.stand.decks[String(f.deck)] = f; this.zieheGeladenNach(f); }   // Fix-Runde S3 R8
    if (d.adresse === '/e/geladen') {
      this.seqNachgeladen.add(Number(f.deck));
      const n = String(f.deck), z = this.stand.decks[n];
      this.geladenSeit[n] = { vorher: z ? Oberflaeche.deckSchluessel(z) : null, bestaetigt: false };
      this.stand.geladen[n] = f;
    }
    if (d.adresse === '/e/geladen') this.hotcuesWieder(Number(f.deck), f as unknown as Fassung);   // Plan E9 D5
    if (d.adresse === '/e/geladen') this.rasterWieder(Number(f.deck), f as unknown as Fassung, false);   // Plan Grid D3
    if (d.adresse === '/e/neustart') {   // der Neustart-Zustand kennt keine Hotcues; /e/geladen kommt dann nicht
      setTimeout(() => { for (const [n, g] of Object.entries(this.stand.geladen)) { this.hotcuesWieder(Number(n), g as unknown as Fassung); this.rasterWieder(Number(n), g as unknown as Fassung, true); } }, 500);
    }
    if (d.adresse === '/e/fx') { const e = Number(f.einheit); if (e === 1 || e === 2) { this.stand.fx[e - 1] = f; this.angefasst.add(`fx:${e}`); } }
    if (d.adresse === '/e/fx/zuweisung') {
      const e = Number(f.einheit);
      if (e === 1 || e === 2 || e === 3) this.stand.fxZuweisung[e - 1][String(f.kanal)] = f.an === 1;
    }
    // Gleiche Generation (ein Abonnent hat sich nur neu gemeldet, der Kern lief weiter): der Stand des Kerns ist unverändert,
    // der Server leert nichts und sendet nichts erneut. Nur ein neuer Kern (andere Generation) beginnt leer.
    const neuerKern = (d.adresse === '/e/neustart' && f.generation !== bezug)
      || (d.adresse === '/k/willkommen' && platte !== null && Number(f.generation) > platte.generation);   // t_7f487235: a kern that restarted while the page server was down
    // Final-Review MAJOR-1: ein gebremster Kern (Bremse F20) startet mit Generation 0 und sendet nur /k/willkommen, kein
    // /e/neustart. Eine KLEINERE Generation ist ein neuer Kern ohne Fortsetzung: Stand leeren, Routing-Wunsch erneut senden,
    // aber nichts wiederherstellen (die Bremse hat den Zustand absichtlich verworfen).
    const gebremst = d.adresse === '/k/willkommen' && bezug !== null && Number(f.generation) < bezug;
    if (gebremst) {
      this.opt.log?.({ typ: 'wiederherstellung_uebersprungen', grund: 'gebremster_start', generation: f.generation });
      this.verteile({ a: 'wiederherstellung', f: { uebersprungen: true, grund: 'gebremster_start' } });
    }
    if (platte !== null && Number(f.generation) >= platte.generation) this.uebernehmeNeustartStand(platte, Number(f.generation) === platte.generation);
    // t_7f487235, review 2: a higher generation than the file's says the kern restarted while this server was down, not when. The kern's two words tell:
    // /e/neustart carries the first sample of the generation, /k/willkommen the present one. The snapshot waits for both (in either order) and is planned
    // only if the kern restarted less than 30 s before (planEntscheiden); a kern that restarted an hour ago has had its own set since.
    if (neuerKern && erstkontakt && platte !== null) this.planWartet = { generation: Number(f.generation), plan: this.boxFxSchnappschuss() };
    else if (neuerKern) this.boxFxPlanen();   // Paket 2 Slice 5 (F07): Schnappschuss VOR dem Leeren (B15)
    this.planWartetFuehren(d.adresse, Number(f.generation), gruss);
    if (neuerKern || gebremst) this.spektrumLetzt = null;   // 1.15 A7b: the new kern starts with the selector at 0
    if (neuerKern || gebremst) { this.stand.fx = [null, null]; this.stand.fxZuweisung = [{}, {}, {}]; }  // after a restart all units are off
    if (neuerKern || gebremst) this.stand.hallPool = null;   // mehrkern Task 5: a new kern says it again within 0.5 s, or has no pool
    if (neuerKern || gebremst) this.stand.spurPool = null;   // mehrkern slice 3.2 Task 8: a new kern says it again within 0.5 s, or has no pool
    if (d.adresse === '/zustand/spur_pool') this.stand.spurPool = { an: Number(f.an) === 1, modus: (['aus', 'an', 'auto'] as const)[Number(f.modus)] ?? 'aus', blocks_parallel: Number(f.blocks_parallel),
      einheiten_worker: Number(f.einheiten_worker), einheiten_caller: Number(f.einheiten_caller), seriell: Number(f.seriell_summe), haengt: Number(f.haengt), spaet: Number(f.spaet), zurueck: Number(f.zurueck) };   // real boolean and mode text for /lage, nothing from the config
    if (d.adresse === '/zustand/hall_pool') this.stand.hallPool = { an: Number(f.an) === 1, faeden: Number(f.faeden), spaet: Number(f.spaet), zurueck: Number(f.zurueck) };   // mehrkern Task 5: real boolean for /lage
    if (d.adresse === '/e/kanal_limiter') this.stand.kanalLimiter = { gebaut: Number(f.gebaut) === 1, latenz_samples: Number(f.latenz_samples) };   // A5c: real boolean for the page (=== true)
    if (d.adresse === '/e/fx/routing') this.stand.fxRouting = Number(f.routing) === 1 ? 'insert' : 'post_fader';
    if (neuerKern || gebremst) {   // Ohr T18: der neue Kern steht auf Post Fader; Andreas' Wahl geht erneut hin
      this.stand.fxRouting = 'post_fader';
      if (this.fxRoutingWunsch !== 'post_fader') this.fxRoutingSenden(this.fxRoutingWunsch, 'andreas');
    }
    if (neuerKern || gebremst) this.fahrtEnde.clear();                 // Plan Glanz 1.2: ob ein gebremster Start den Beat auf 0 setzt, ist ungeprüft
    if ((neuerKern || gebremst) && Object.keys(this.stand.graphen_geladen).length) this.setzeGraphenGeladen({});   // S12: the kern keeps no graph over a restart
    if (neuerKern || gebremst) { this.graphenVomKernMs = null; this.fragGraphen('neustart'); }   // Baukasten S16: ask the new kern
    if (neuerKern || gebremst || erstkontakt || NEUSTART_STAND_ADRESSEN.has(d.adresse)) this.merkeNeustartStand();   // t_7f487235
    if (neuerKern || gebremst) this.insGr = {};   // 1.10 slice 4a: a new kern starts without a stage running
    if (d.adresse === '/e/ins_gr' && typeof f.kanal === 'string' && Number.isFinite(Number(f.gr_db))) this.insGr[f.kanal] = { db: Number(f.gr_db), t: Date.now() };
    if (d.adresse === '/pegel') this.pegelPuffer.nimm({ kanal: String(f.kanal), spitze_db: Number(f.spitze_db) });   // vor der Drossel: Spitzen gehen nicht verloren
    // Spec D1 2.10: Haken ereignis? der Bereiche, für jedes Kern-Ereignis, nach der Zustandsführung und vor dem Durchreichen (Plan d1-s1 Task 9)
    this.router.ereignis(d.adresse, f, (bereich, e) => this.opt.log?.({ typ: 'bereich_ereignis_fehler', bereich, adresse: d.adresse, fehler: e.message }));
    if (!DURCHREICHEN.has(d.adresse)) return;
    const ms = DROSSEL_MS[d.adresse];
    const n = { a: d.adresse, f };
    if (!ms) { this.verteile(n); return; }
    const schluessel = `${d.adresse}|${f.deck ?? f.kanal ?? (d.adresse === '/zustand/mod' ? f.nr : '') ?? ''}`;
    const jetzt = Date.now();
    const zuletzt = this.letzte.get(schluessel) ?? 0;
    if (jetzt - zuletzt >= ms) {
      this.letzte.set(schluessel, jetzt);
      this.verteile(n);
      return;
    }
    const alt = this.wartend.get(schluessel);
    if (alt) clearTimeout(alt);
    this.wartend.set(schluessel, setTimeout(() => {
      this.wartend.delete(schluessel);
      this.letzte.set(schluessel, Date.now());
      this.verteile(n);
    }, ms - (jetzt - zuletzt)));
  }

  private ansageZeile: { text: string; art: string; von: string; zeit: number } | null = null;   // demo overlay (POST /ansage)

  private verteile(n: Record<string, unknown>): void {
    const text = `data: ${JSON.stringify(n)}\n\n`;
    for (const s of this.stroeme) {
      // a client that does not read (a stuck tab, a paired device gone to sleep) must not make this process buffer without bound: past the cap its stream is closed;
      // EventSource reconnects on its own and starts again with the full state
      if (s.writableLength > STROM_MAX_BYTES || s.destroyed) { this.stroeme.delete(s); s.destroy(); continue; }
      s.write(text);
    }
  }

  // Studio S1: ein Ordner je Strom (1 Drums, 2 Bass, 3 Melodie). Strom 1 behält den alten Ordner, 2 und 3 hängen die
  // Nummer an (…/erzeuger2). Dateinamen im Ordner bleiben (strom1.js historisch; der Ordner bestimmt den Strom).
  private musterOrdner(strom = 1): string {
    const basis = this.opt.musterOrdner ?? musterOrdnerVorgabe();
    return strom === 1 ? basis : `${basis}${strom}`;
  }
  // S18: is the multi-stream erzeuger of this Baukasten stream alive? Its heartbeat (lebt.json) is written once per bar, so 6 s
  // (about 3 bars at 120 BPM, 2.5 at 60) separates "serving" from "stopped". Only after the first /uhr does the process write it.
  static readonly LEBT_FRIST_MS = 6000;
  private erzeugerLebt(strom: number): boolean {
    const l = leseLebt(this.musterOrdner(strom));
    return l !== null && Date.now() - l.zeit <= Oberflaeche.LEBT_FRIST_MS && l.zeit - Date.now() < 2000;
  }
  private static strom(x: unknown): number | null {
    const n = x === undefined || x === null || x === '' ? 1 : Number(x);
    return (ALLE_STROEME as readonly number[]).includes(n) ? n : null;   // S18: the stream table (1, 2, 3, 5, 6, 7, 9, 10)
  }

  // AUFTRAG 2026-09-28: zwei Beat-FX-Einheiten, drei Parameter; assignable are the decks, erz/1..3, the pads and the master.
  // FX3 (the remix insert on fx/3) takes every source channel of the mixer and never the master.
  private static readonly FX_ZUWEISUNG_KANAL = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'pad/1', 'pad/2', 'master'];
  private static readonly FX3_ZUWEISUNG_KANAL = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/4', 'erz/5', 'erz/6', 'erz/7', 'erz/8', 'pad/1', 'pad/2'];
  private static readonly FX_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16];
  private fx(...a: Parameters<typeof GF.fx>) { return GF.fx.call(this, ...a); }
  private merkeGraph(...a: Parameters<typeof GF.merkeGraph>) { return GF.merkeGraph.call(this, ...a); }
  private fragGraphen(...a: Parameters<typeof GF.fragGraphen>) { return GF.fragGraphen.call(this, ...a); }
  private setzeGraphenGeladen(...a: Parameters<typeof GF.setzeGraphenGeladen>) { return GF.setzeGraphenGeladen.call(this, ...a); }
  private graphLaden(...a: Parameters<typeof GF.graphLaden>) { return GF.graphLaden.call(this, ...a); }
  private graphSetzen(...a: Parameters<typeof GF.graphSetzen>) { return GF.graphSetzen.call(this, ...a); }
  private stromSpurDa(...a: Parameters<typeof GF.stromSpurDa>) { return GF.stromSpurDa.call(this, ...a); }
  private bkInsertVonStrom(...a: Parameters<typeof GF.bkInsertVonStrom>) { return GF.bkInsertVonStrom.call(this, ...a); }
  private graphAlsInsert(...a: Parameters<typeof GF.graphAlsInsert>) { return GF.graphAlsInsert.call(this, ...a); }
  private schiebeVorgaben(...a: Parameters<typeof GF.schiebeVorgaben>) { return GF.schiebeVorgaben.call(this, ...a); }
  private kernWegInstanz: KernWeg | null = null;
  private kernWeg(...a: Parameters<typeof GF.kernWeg>) { return GF.kernWeg.call(this, ...a); }
  private fxRiegel(...a: Parameters<typeof GF.fxRiegel>) { return GF.fxRiegel.call(this, ...a); }
  private fxRoutingSenden(...a: Parameters<typeof GF.fxRoutingSenden>) { return GF.fxRoutingSenden.call(this, ...a); }
  private fxZuweisung(...a: Parameters<typeof GF.fxZuweisung>) { return GF.fxZuweisung.call(this, ...a); }
  private fxVon(...a: Parameters<typeof GF.fxVon>) { return GF.fxVon.call(this, ...a); }
  private fxCypherAuslaufen(...a: Parameters<typeof GF.fxCypherAuslaufen>) { return GF.fxCypherAuslaufen.call(this, ...a); }
  private hotcueOrdner(...a: Parameters<typeof DK.hotcueOrdner>) { return DK.hotcueOrdner.call(this, ...a); }
  private readonly einsCache = new Map<string, { eins: number; erster: number }>();

  // D1 S3 Auftrag 15 (Abnahme A0b, gemessen: jedes 409 von GET /deck/raster kam, bevor der Server /zustand/deck für das Deck hatte; die Uhr war da):
  // die Fassung eines geladenen Decks für die Raster-Anzeige. /e/geladen (stand.geladen) kommt vor dem ersten /zustand/deck; meldet /zustand/deck
  // noch das vorige Material, gilt das neue Laden. /zustand/deck derselben Fassung mit Status 0 heißt leer. null: kein Deck 1/2 oder nicht geladen.
  // Fix-Runde S3 R8: stand.geladen wurde nie nachgezogen; meldete /zustand/deck danach anderes Material, lieferte die Route die alte Fassung. Je Deck
  // merkt sich /e/geladen, was /zustand/deck bis dahin meldete (vorher). Ein /zustand/deck mit genau diesem vorigen Material, solange das neue nicht
  // bestätigt ist, ist der Wettlauf aus Auftrag 15 und ändert nichts. Bestätigt es das geladene, gilt das; meldet es ein anderes, wird stand.geladen
  // darauf nachgezogen (auch für das Wiedersenden nach /e/neustart), Status 0 heißt leer und leert stand.geladen.
  private readonly geladenSeit: Record<string, { vorher: string | null; bestaetigt: boolean }> = {};
  private static deckSchluessel(x: Record<string, unknown>): string { return `${String(x.material_id)}|${Number(x.basis_bpm)}|${Number(x.fassung)}`; }
  private zieheGeladenNach(...a: Parameters<typeof DK.zieheGeladenNach>) { return DK.zieheGeladenNach.call(this, ...a); }
  private rasterFassung(...a: Parameters<typeof DK.rasterFassung>) { return DK.rasterFassung.call(this, ...a); }
  private deckStand(...a: Parameters<typeof DK.deckStand>) { return DK.deckStand.call(this, ...a); }
  private zeitRaster(...a: Parameters<typeof DK.zeitRaster>) { return DK.zeitRaster.call(this, ...a); }
  private deckAb(...a: Parameters<typeof DK.deckAb>) { return DK.deckAb.call(this, ...a); }
  private deckTeil(...a: Parameters<typeof DK.deckTeil>) { return DK.deckTeil.call(this, ...a); }
  private rasterAus(...a: Parameters<typeof DK.rasterAus>) { return DK.rasterAus.call(this, ...a); }
  private deckSprung(...a: Parameters<typeof DK.deckSprung>) { return DK.deckSprung.call(this, ...a); }
  private deckScrub(...a: Parameters<typeof DK.deckScrub>) { return DK.deckScrub.call(this, ...a); }

  private static readonly LOOP_LAENGEN = [1, 2, 4, 8, 16, 32, 64];   // beats; every length divides 64
  // Zuletzt an den Kern geschickter Deck-Loop je Deck (Quell-Beat des Starts, Länge), für „leeres Pad im Loop = Loop-Cue“.
  // Läuft das Deck, liegt der Start bei ab_beat: quell + (ab − beat) (Faktor 1 im Direktweg, wie sprungDelta).
  private aktiverLoop: Record<string, { schluessel: string; start: number; laenge: number }> = {};
  // Loop aktiv: läuft darin (Status 3) oder scharf bei stehendem Deck (der Kern meldet dann beats_bis_ende null, Instanz i)
  private static loopScharf(z: Record<string, unknown>): boolean {
    return Number(z.status) === 3 || (Number(z.status) >= 1 && z.beats_bis_ende === Infinity);   // Kern: im Loop INFINITY (deck.cpp)
  }
  private loopVon(...a: Parameters<typeof DK.loopVon>) { return DK.loopVon.call(this, ...a); }
  private merkeLoop(...a: Parameters<typeof DK.merkeLoop>) { return DK.merkeLoop.call(this, ...a); }
  private setzeAktivenLoop(...a: Parameters<typeof DK.setzeAktivenLoop>) { return DK.setzeAktivenLoop.call(this, ...a); }
  private aktiveLoopsDatei(...a: Parameters<typeof DK.aktiveLoopsDatei>) { return DK.aktiveLoopsDatei.call(this, ...a); }
  private sichereAktiveLoops(...a: Parameters<typeof DK.sichereAktiveLoops>) { return DK.sichereAktiveLoops.call(this, ...a); }
  ladeAktiveLoops(...a: Parameters<typeof DK.ladeAktiveLoops>) { return DK.ladeAktiveLoops.call(this, ...a); }
  private neustartStandDatei(...a: Parameters<typeof NS.neustartStandDatei>) { return NS.neustartStandDatei.call(this, ...a); }
  private vomPlatte: NeustartStand | null = null;
  private kernSample: number | null = null;   // the sample position of the kern's last greeting: the file keeps it to tell another kern life
  private planTimer: ReturnType<typeof setTimeout> | null = null;
  ladeNeustartStand(...a: Parameters<typeof NS.ladeNeustartStand>) { return NS.ladeNeustartStand.call(this, ...a); }
  private uebernehmeNeustartStand(...a: Parameters<typeof NS.uebernehmeNeustartStand>) { return NS.uebernehmeNeustartStand.call(this, ...a); }
  merkeNeustartStand(...a: Parameters<typeof NS.merkeNeustartStand>) { return NS.merkeNeustartStand.call(this, ...a); }
  private planFuerPlatte(...a: Parameters<typeof NS.planFuerPlatte>) { return NS.planFuerPlatte.call(this, ...a); }
  private sichereNeustartStandSofort(...a: Parameters<typeof NS.sichereNeustartStandSofort>) { return NS.sichereNeustartStandSofort.call(this, ...a); }
  private sichereNeustartStand(...a: Parameters<typeof NS.sichereNeustartStand>) { return NS.sichereNeustartStand.call(this, ...a); }
  private deckLoop(...a: Parameters<typeof DK.deckLoop>) { return DK.deckLoop.call(this, ...a); }
  private loopStartFrame(...a: Parameters<typeof DK.loopStartFrame>) { return DK.loopStartFrame.call(this, ...a); }
  deckLoopAusschnitt(...a: Parameters<typeof DK.deckLoopAusschnitt>) { return DK.deckLoopAusschnitt.call(this, ...a); }
  masterTonart(...a: Parameters<typeof DK.masterTonart>) { return DK.masterTonart.call(this, ...a); }
  tonartVon(...a: Parameters<typeof DK.tonartVon>) { return DK.tonartVon.call(this, ...a); }
  private moduleHerkunft(...a: Parameters<typeof DK.moduleHerkunft>) { return DK.moduleHerkunft.call(this, ...a); }
  private deckLoopSichern(...a: Parameters<typeof DK.deckLoopSichern>) { return DK.deckLoopSichern.call(this, ...a); }
  private hotcuesErbeVon(...a: Parameters<typeof DK.hotcuesErbeVon>) { return DK.hotcuesErbeVon.call(this, ...a); }
  private deckHotcue(...a: Parameters<typeof DK.deckHotcue>) { return DK.deckHotcue.call(this, ...a); }
  private hotcuesAus(...a: Parameters<typeof DK.hotcuesAus>) { return DK.hotcuesAus.call(this, ...a); }
  private hotcuesWieder(...a: Parameters<typeof DK.hotcuesWieder>) { return DK.hotcuesWieder.call(this, ...a); }

  // Plan 2 (Spec E5): Andreas' Muster aus dem Feld. Geprüft und geschrieben NICHT hier, sondern von djk-muster in einem
  // Kindprozess mit denselben Rechten wie der Erzeuger (node --permission, nur lesen in djk und Strudel, schreiben nur im
  // Muster-Ordner) und 2 s Zeitlimit (Plan-Review M3: ein Muster schrieb sonst Dateien, s("bd*1000000") hielt den Server
  // 3,4 s an). Asynchron, damit Griffe und Strom währenddessen weiterlaufen. Fehler → 400 mit Zeile, nichts geschrieben.
  // --als-andreas: das Feld ist Andreas, der AUTO-Schalter gilt nur für Cypher.
  // Review F1: Muster nacheinander prüfen und schreiben, sonst gewinnt bei zwei schnellen PLAY das zuerst gesendete.
  private musterKette: Promise<void> = Promise.resolve();
  // intern.versatz (live scene restore only, never from a request body): the phase offset in cycles, passed to djk-muster as --versatz
  // A2: per stream the switch bar of the running pattern (absolute bar, 1-based) = time zero of its .rein/.raus; a live scene stores it as `anker`
  private musterAnkerTakt = new Map<number, number>();
  private strudel(...a: Parameters<typeof SD.strudel>) { return SD.strudel.call(this, ...a); }
  private strudelEins(...a: Parameters<typeof SD.strudelEins>) { return SD.strudelEins.call(this, ...a); }
  private stromVonZielOffen(...a: Parameters<typeof SD.stromVonZielOffen>) { return SD.stromVonZielOffen.call(this, ...a); }
  private sorgeFuerStromSpur(...a: Parameters<typeof SD.sorgeFuerStromSpur>) { return SD.sorgeFuerStromSpur.call(this, ...a); }

  private json(a: http.ServerResponse, code: number, daten: unknown): void { sendeJson(a, code, daten); }   // http/transport.ts

  private loopAusKatalogName(...a: Parameters<typeof SD.loopAusKatalogName>) { return SD.loopAusKatalogName.call(this, ...a); }
  private katalogFuerDeck(...a: Parameters<typeof SD.katalogFuerDeck>) { return SD.katalogFuerDeck.call(this, ...a); }
  private loopAusKatalog(...a: Parameters<typeof SD.loopAusKatalog>) { return SD.loopAusKatalog.call(this, ...a); }

  private koerper(q: http.IncomingMessage): Promise<Record<string, unknown>> { return leseKoerper(q); }   // http/transport.ts

  // Plan Hand D4: Quittungen je Befehls-id (Ring 200), damit eine Anfrage von Cypher ihr Ergebnis mitbekommt
  private readonly quittungen = new Map<number, Felder[]>();
  private kernKiGestoppt = false;
  private handBremse = false;
  private get kiGestoppt(): boolean { return this.kernKiGestoppt || this.handBremse; }
  // Andreas 2026-10-05 (Hommage-Take): ein fester Wert fiel 0,19 Beat in die eigene laufende Fahrt, der Kern lehnte ab.
  // Je Pfad das Ende von Cyphers letzter Fahrt; ein neuer Cypher-Teil beginnt frühestens dort. Andreas' Teile nie.
  // Je Pfad ALLE offenen Cypher-Teile (id, ab, dauer). Gelöscht bei Quittung 4/6/7/8, nach ihrem Ende (nächster Aufruf),
  // bei Stop Cypher, /abbruch und neuem Kern.
  private readonly fahrtEnde = new Map<string, { id: number; ab: number; dauer: number }[]>();
  private setzeKiGestoppt(...a: Parameters<typeof WI.setzeKiGestoppt>) { return WI.setzeKiGestoppt.call(this, ...a); }
  private setzeHandBremse(...a: Parameters<typeof WI.setzeHandBremse>) { return WI.setzeHandBremse.call(this, ...a); }
  private handStand(...a: Parameters<typeof WI.handStand>) { return WI.handStand.call(this, ...a); }
  private nachKiWechsel(...a: Parameters<typeof WI.nachKiWechsel>) { return WI.nachKiWechsel.call(this, ...a); }
  private musikLaeuft(...a: Parameters<typeof WI.musikLaeuft>) { return WI.musikLaeuft.call(this, ...a); }
  private handRegeln: HandRegel[] = [bremsRegel(() => this.kiGestoppt), stufenRegel(), spielRegel(() => this.musikLaeuft()), eimerRegel()];
  private readonly cypherQuittungen: Felder[] = [];   // die letzten 20 mit Quelle cypher, für /lage
  private merkeQuittung(...a: Parameters<typeof RG.merkeQuittung>) { return RG.merkeQuittung.call(this, ...a); }
  private warteQuittung(...a: Parameters<typeof RG.warteQuittung>) { return RG.warteQuittung.call(this, ...a); }
  private warteBisAb(...a: Parameters<typeof RG.warteBisAb>) { return RG.warteBisAb.call(this, ...a); }
  private proTakt(...a: Parameters<typeof RG.proTakt>) { return RG.proTakt.call(this, ...a); }
  private letzteTaktart = 4;
  private taktartVeroeffentlicht = false;
  private meldeTaktart(...a: Parameters<typeof RG.meldeTaktart>) { return RG.meldeTaktart.call(this, ...a); }
  // Strand 7 task 2.3: the live harmony lane; its file goes into every stream folder like the meter. The bars come from the master clock.
  private readonly harmonie = new LiveHarmonie({ ordner: () => ALLE_STROEME.map((st) => this.musterOrdner(st)),
    fehler: (ordner, e) => this.opt.log?.({ typ: 'harmonie_datei_fehler', ordner, text: e.message }) });
  private harmonieTakte(...a: Parameters<typeof RG.harmonieTakte>) { return RG.harmonieTakte.call(this, ...a); }
  private abVon(...a: Parameters<typeof RG.abVon>) { return RG.abVon.call(this, ...a); }
  private rampePflicht(...a: Parameters<typeof RG.rampePflicht>) { return RG.rampePflicht.call(this, ...a); }
  private regler(...a: Parameters<typeof RG.regler>) { return RG.regler.call(this, ...a); }
  private aliasInsert(...a: Parameters<typeof RG.aliasInsert>) { return RG.aliasInsert.call(this, ...a); }
  private graphArt(...a: Parameters<typeof RG.graphArt>) { return RG.graphArt.call(this, ...a); }
  private kernPfadVon(...a: Parameters<typeof RG.kernPfadVon>) { return RG.kernPfadVon.call(this, ...a); }
  private spurAliasFehler(...a: Parameters<typeof RG.spurAliasFehler>) { return RG.spurAliasFehler.call(this, ...a); }
  private seqPlaetzeOffen(...a: Parameters<typeof RG.seqPlaetzeOffen>) { return RG.seqPlaetzeOffen.call(this, ...a); }

  // Plan seq-fader-frei D6/D9: a place that becomes a SEQ deck may still hold a STOPPED track with its channel closed; that track would keep the
  // I3a lock on deck/N. Eject it from the deck player (/k/deck/entladen). Never a playing track, never with an open channel. True iff the unload was
  // sent. One unload per state of the deck: the guard holds until /zustand/deck shows another state (or 5 s have passed, a lost datagram).
  private readonly seqEntladen = new Map<number, { schluessel: string; t: number; id: number }>();
  // Review: D9 covers a place that BECOMES a SEQ deck. The lazy path (spaet) repairs a state the page server did not see come about (a restart, the studio
  // of 2026-11-18); it never ejects a track that arrived while the page server was watching (a load of Andreas after the SEQ deck), and no path ejects a
  // track with a start planned by Andreas: /zustand/deck has no "start planned" status (it reads 1), the unload would cancel the start.
  private readonly seqNachgeladen = new Set<number>();
  private merkeNachgeladen(...a: Parameters<typeof RG.merkeNachgeladen>) { return RG.merkeNachgeladen.call(this, ...a); }
  private readonly startGeplant = new Map<number, number>();   // deck -> ab_beat of the last start sent by the page (any source)
  private startSteht(...a: Parameters<typeof RG.startSteht>) { return RG.startSteht.call(this, ...a); }
  private seqDeckAufraeumen(...a: Parameters<typeof RG.seqDeckAufraeumen>) { return RG.seqDeckAufraeumen.call(this, ...a); }
  private seqRampeLaeuft(...a: Parameters<typeof RG.seqRampeLaeuft>) { return RG.seqRampeLaeuft.call(this, ...a); }

  // Studio S6: laufende Automationsspuren (Name → Lauf) und die fahrbaren Surge-Parameter (surge_bereiche.json)
  private readonly spuren = new Map<string, SpurLauf>();
  private readonly fahrbar: Set<string> = (() => {
    try { return new Set(Object.keys(JSON.parse(fs.readFileSync(REPO_PFADE.surgeBereiche, 'utf8')).parameter)); }
    catch { return new Set<string>(); }
  })();

  // In-flight wirt calls of a loop's pass per track name (see sendeDurchlauf); settled entries remove themselves
  private readonly wirtImFlug = new Map<string, Promise<unknown>>();
  private wirtFlug<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const p = fn();
    const eintrag = p.then(() => undefined, () => undefined);
    this.wirtImFlug.set(name, eintrag);
    void eintrag.then(() => { if (this.wirtImFlug.get(name) === eintrag) this.wirtImFlug.delete(name); });
    return p;
  }
  private wirtFlugAbwarten(...a: Parameters<typeof WI.wirtFlugAbwarten>) { return WI.wirtFlugAbwarten.call(this, ...a); }
  private wirtBasis(...a: Parameters<typeof WI.wirtBasis>) { return WI.wirtBasis.call(this, ...a); }
  private wirtSock(...a: Parameters<typeof WI.wirtSock>) { return WI.wirtSock.call(this, ...a); }
  private spurenSichern(...a: Parameters<typeof SL.spurenSichern>) { return SL.spurenSichern.call(this, ...a); }
  private spurenLaden(...a: Parameters<typeof SL.spurenLaden>) { return SL.spurenLaden.call(this, ...a); }
  private spurStart(...a: Parameters<typeof SL.spurStart>) { return SL.spurStart.call(this, ...a); }
  private innenAntwort(...a: Parameters<typeof SL.innenAntwort>) { return SL.innenAntwort.call(this, ...a); }
  private aktionPasst(...a: Parameters<typeof SL.aktionPasst>) { return SL.aktionPasst.call(this, ...a); }
  private szeneSammeln(...a: Parameters<typeof SZ.szeneSammeln>) { return SZ.szeneSammeln.call(this, ...a); }
  private szene(...a: Parameters<typeof SZ.szene>) { return SZ.szene.call(this, ...a); }
  private szeneFxLaden(...a: Parameters<typeof SZ.szeneFxLaden>) { return SZ.szeneFxLaden.call(this, ...a); }
  private szeneAnkerTakt(...a: Parameters<typeof SZ.szeneAnkerTakt>) { return SZ.szeneAnkerTakt.call(this, ...a); }
  private szeneLaden(...a: Parameters<typeof SZ.szeneLaden>) { return SZ.szeneLaden.call(this, ...a); }
  private aufbau(...a: Parameters<typeof SZ.aufbau>) { return SZ.aufbau.call(this, ...a); }
  private aufbauLaden(...a: Parameters<typeof SZ.aufbauLaden>) { return SZ.aufbauLaden.call(this, ...a); }
  private spurStopp(...a: Parameters<typeof SL.spurStopp>) { return SL.spurStopp.call(this, ...a); }
  private spurAendern(...a: Parameters<typeof SL.spurAendern>) { return SL.spurAendern.call(this, ...a); }
  private musterTimer(...a: Parameters<typeof SL.musterTimer>) { return SL.musterTimer.call(this, ...a); }
  private spurMuster(...a: Parameters<typeof SL.spurMuster>) { return SL.spurMuster.call(this, ...a); }
  private spurAbbrechen(...a: Parameters<typeof SL.spurAbbrechen>) { return SL.spurAbbrechen.call(this, ...a); }
  private klang(...a: Parameters<typeof KL.klang>) { return KL.klang.call(this, ...a); }
  private reglerNamen(...a: Parameters<typeof KL.reglerNamen>) { return KL.reglerNamen.call(this, ...a); }
  private klangSperre(...a: Parameters<typeof KL.klangSperre>) { return KL.klangSperre.call(this, ...a); }
  private cypherSpurenAbbrechen(...a: Parameters<typeof SL.cypherSpurenAbbrechen>) { return SL.cypherSpurenAbbrechen.call(this, ...a); }
  private spurenAufraeumen(...a: Parameters<typeof SL.spurenAufraeumen>) { return SL.spurenAufraeumen.call(this, ...a); }
  private spurListe(...a: Parameters<typeof SL.spurListe>) { return SL.spurListe.call(this, ...a); }
  private bogenInfo(...a: Parameters<typeof SL.bogenInfo>) { return SL.bogenInfo.call(this, ...a); }
  private bogenStart(...a: Parameters<typeof SL.bogenStart>) { return SL.bogenStart.call(this, ...a); }
  private spurAbgelehnt(...a: Parameters<typeof SL.spurAbgelehnt>) { return SL.spurAbgelehnt.call(this, ...a); }
  private schleifenInfo(...a: Parameters<typeof SC.schleifenInfo>) { return SC.schleifenInfo.call(this, ...a); }
  private schleifenWaechter(...a: Parameters<typeof SC.schleifenWaechter>) { return SC.schleifenWaechter.call(this, ...a); }
  private schleifenTakt(...a: Parameters<typeof SC.schleifenTakt>) { return SC.schleifenTakt.call(this, ...a); }
  private schleifeUeberspringen(...a: Parameters<typeof SC.schleifeUeberspringen>) { return SC.schleifeUeberspringen.call(this, ...a); }
  private sendeDurchlauf(...a: Parameters<typeof SC.sendeDurchlauf>) { return SC.sendeDurchlauf.call(this, ...a); }
  private schleifeUebernimm(...a: Parameters<typeof SC.schleifeUebernimm>) { return SC.schleifeUebernimm.call(this, ...a); }
  private schleifenSperre(...a: Parameters<typeof SC.schleifenSperre>) { return SC.schleifenSperre.call(this, ...a); }
  private schleifenHandgriff(...a: Parameters<typeof SC.schleifenHandgriff>) { return SC.schleifenHandgriff.call(this, ...a); }
  private schleifeBeenden(...a: Parameters<typeof SC.schleifeBeenden>) { return SC.schleifeBeenden.call(this, ...a); }
  private planVon(...a: Parameters<typeof WI.planVon>) { return WI.planVon.call(this, ...a); }
  private deckStartStopp(...a: Parameters<typeof DK.deckStartStopp>) { return DK.deckStartStopp.call(this, ...a); }
  private leseWirtMeldungen(...a: Parameters<typeof WI.leseWirtMeldungen>) { return WI.leseWirtMeldungen.call(this, ...a); }
  private studioLage(...a: Parameters<typeof WI.studioLage>) { return WI.studioLage.call(this, ...a); }
  private spektrum(...a: Parameters<typeof WI.spektrum>) { return WI.spektrum.call(this, ...a); }
  private plaetzeLage(...a: Parameters<typeof WI.plaetzeLage>) { return WI.plaetzeLage.call(this, ...a); }
  private plaetzeSetzen(...a: Parameters<typeof WI.plaetzeSetzen>) { return WI.plaetzeSetzen.call(this, ...a); }

  private lage(): Record<string, unknown> {
    const u = this.kern.uhr as unknown as { beat: number; bpm: number } | null;
    const beat = u?.beat ?? 0, bestand = leseBestand(this.opt.bestand);
    const decks = OFFENE_DECKS.map((n) => {
      const z = this.stand.decks[String(n)] as Record<string, unknown> | undefined;
      if (!z) return { deck: n, status: 0 };
      const st = this.deckStand(n), e = bestand.find((x) => x.material_id === z.material_id);
      const l = st ? this.loopVon(st) : null;
      const rel = Number(z.quell_beat) - (st?.eins ?? 0);
      const hs = this.hoerscheinstelle.letzter(n);   // Ohr T10
      return { deck: n, status: z.status, material_id: z.material_id, titel: e?.titel ?? '', camelot: e?.camelot ?? null,
        basis_bpm: z.basis_bpm, faktor: z.faktor, hoerweg: z.hoerweg ?? null,   // Keylock 3b: 1 = Tonhöhe gehalten (Ring), 0 = Varispeed/direkt
        quell_beat: Math.round(Number(z.quell_beat) * 100) / 100, takt_im_track: rel < 0 ? null : Math.floor(rel / 4) + 1,
        beats_bis_ende: z.beats_bis_ende === Infinity ? null : z.beats_bis_ende, loop: l, offen: kanalOffen(this.stand.regler, pultContainerPfad[n - 1]),
        hoerschein: hs ? { urteil: hs.urteil, gueltig_bis_takt: Math.floor(hs.gueltig_bis_beat / 4) + 1, gruende: hs.gruende } : null };
    });
    const bkVorgabe = new Map<string, number[] | null>();
    const regler: Record<string, number | null> = Object.fromEntries(Object.entries(this.stand.regler)
      .filter(([p, w]) => LAGE_KANALZUG.test(p) || /^(xfader|master\/pegel)$/.test(p) || (p in LAGE_ABWEICHEND && w !== LAGE_ABWEICHEND[p]) || (LAGE_SEND.test(p) && w !== -200) || kompAbweichend(p, w) || bkAbweichend(p, w, this.stand.graphen_geladen, bkVorgabe) || werkzeugAbweichend(p, w))   // erst abweichend von der Vorgabe sichtbar (K2: Kleber, Duck, Hall-Rückweg und -Send)ar
      .map(([p, w]) => [p, p === 'master/kleber' || p === 'color/param' || p.includes('/bk/') || WERKZEUG_PFAD.test(p) ? Math.round(w * 100) / 100 : Math.round(w * 10) / 10]));
    // Keylock 3b (Prüfung MINOR 4): der Knopf steht immer da, 1 an, 0 aus, null unbekannt (noch keine Meldung vom Kern; der Kern
    // schickt sie jedem neuen Abonnenten beim ersten /k/hallo)
    regler.keylock = typeof this.stand.regler.keylock === 'number' ? this.stand.regler.keylock : null;
    const jetztMs = Date.now();   // 1.10 slice 4a: the stages that sent in the last 500 ms; a stage that stops sending (bypass, removed) simply falls out
    const insGr = Object.fromEntries(Object.entries(this.insGr).filter(([, g]) => jetztMs - g.t < INS_GR_FRIST_MS).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(([k, g]) => [k, Math.round(g.db * 10) / 10]));
    const proTakt = this.proTakt();
    return { uhr: { naechster_takt: Math.floor(this.abVon('takt') / proTakt) + 1, naechste_phrase_takt: Math.floor(this.abVon('phrase') / proTakt) + 1,
      beat: Math.round(beat * 100) / 100, takt: Math.floor(beat / proTakt) + 1, schlag: Math.floor(((beat % proTakt) + proTakt) % proTakt) + 1,
      bpm: u?.bpm ?? null }, ...(proTakt !== 4 ? { taktart: [proTakt, 4] } : {}), ki: { gestoppt: this.kiGestoppt }, ...(this.harmonie.lesen(this.harmonieTakte()) ? { harmonie: this.harmonie.lesen(this.harmonieTakte()) } : {}), decks, regler, fx: this.stand.fx,
      fx_routing: this.stand.fxRouting, plaetze: this.plaetzeLage(), container: this.proj.sitzung.lage.container.map((art) => ({ art: CONTAINER_ART[art] })), ...(Object.keys(insGr).length ? { ins_gr: insGr } : {}), ...(this.stand.kanalLimiter ? { kanal_limiter: { ...this.stand.kanalLimiter } } : {}), ...(this.stand.hallPool ? { hall_pool: { ...this.stand.hallPool } } : {}), ...(this.stand.spurPool ? { spur_pool: { ...this.stand.spurPool } } : {}), quittungen: this.cypherQuittungen.slice(-10), studio: this.studioLage(), ausgang: leseAusgang(this.opt.digitalout) };
  }

  // Plan Hand D1: Quelle je Anfrage. Kopf x-djk-quelle: cypher → jeder Kern-Befehl dieser Anfrage (auch über await)
  // trägt cypher; sonst andreas. Befehle aus Kern-Ereignissen (Wiederherstellen) laufen außerhalb und bleiben andreas.
  private readonly qs = new AsyncLocalStorage<string>();
  private readonly proj: ReturnType<typeof projBereich>;   // D1 S2: Bereich proj (Sitzung schliesst beim Stoppen)
  readonly stems: ReturnType<typeof stemsBereich>;   // 1.13 Slice 6: Bereich proj-stems
  readonly noten: ReturnType<typeof notenBereich>;   // note editor (slice 1, B2): Bereich proj-noten
  private readonly notenRender: NotenRender;           // note editor (slice 1, B4): render cache and queue of the note edits
  private tagsStopp: () => void = () => {};
  private readonly aufnahme: ReturnType<typeof aufnahmeBereich>;   // 1.8: Bereich proj-aufnahme
  private readonly einsammler: Einsammler;   // A5
  private readonly quellen: Quellen;   // A4
  private readonly importDienst: ImportDienst;   // browser plan 1
  private readonly katalogJob: KatalogJob;   // browser plan 1: the catalogue build as a background job
  readonly ausgabe: ReturnType<typeof ausgabeBereich>;   // Paket S3: Bereich proj-ausgabe (schliesst beim Stoppen, Fix-Runde R7)
  private readonly router = new Router();   // Plan d1-s1 Task 9: Bereiche melden hier ihre Routen (oberflaeche zuerst, dann proj)
  meldeBereich(b: Bereich): void { this.router.melde(b); }
  routen(): ReturnType<Router['liste']> { return this.router.liste(); }
  bereichKontext(...a: Parameters<typeof KX.bereichKontext>) { return KX.bereichKontext.call(this, ...a); }
  private quelle(): string { return this.qs.getStore() ?? 'andreas'; }
  private readonly wer = new AsyncLocalStorage<{ id: string; name: string; stufe: Stufe } | null>();   // the key of the request (agents only)
  private readonly schluessel: HandSchluessel;
  private streng(): boolean { return this.opt.hand?.streng ?? instanz() === ''; }
  private anfrage(...a: Parameters<typeof AN.anfrage>) { return AN.anfrage.call(this, ...a); }
  private readonly handLog: HandLog;
  private readonly gesehenAufrufe = new Set<string>();
  private neuerAufruf(...a: Parameters<typeof AN.neuerAufruf>) { return AN.neuerAufruf.call(this, ...a); }
  private anfrageInnen(...a: Parameters<typeof AN.anfrageInnen>) { return AN.anfrageInnen.call(this, ...a); }
  private routenOberflaeche(...a: Parameters<typeof AN.routenOberflaeche>) { return AN.routenOberflaeche.call(this, ...a); }

  private strom(q: http.IncomingMessage, a: http.ServerResponse): void {
    a.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    a.write(`data: ${JSON.stringify({ a: 'stand', f: { ...this.stand, kern: this.kern.zustand, pruefmodus: this.pruefmodus } })}\n\n`);
    if (this.ansageZeile) a.write(`data: ${JSON.stringify({ a: 'ansage', f: this.ansageZeile })}\n\n`);   // demo overlay
    a.write(`data: ${JSON.stringify({ a: 'hand', f: this.handStand() })}\n\n`);
    this.stroeme.add(a);
    q.on('close', () => this.stroeme.delete(a));
  }

  private griff(...a: Parameters<typeof AN.griff>) { return AN.griff.call(this, ...a); }

  // Eine Taste für den Leitstand (Plan M-1, Annahme-Weg): Andreas drückt „annehmen“ oder „verwerfen“ für Cyphers Vorschlag,
  // „stopp“/„freigabe“ für Cypher selbst. Der Kern meldet daraus dasselbe /e/taste wie eine Hardware-Taste (Scheibe 35, Zusatz),
  // der Leitstand nimmt an (Stufe 1: Vorschlag, nur so kommt er zur Wirkung). Nur die vier Namen; alles andere 400, nichts an den Kern.
  private taste(d: Record<string, unknown>, a: http.ServerResponse): void {
    if (this.quelle() === 'cypher') return this.json(a, 403, { fehler: 'nur_hand' });
    const name = d.name;
    const riegel = !(this.opt.mutationen ?? []).includes('taste_riegel_aus');
    if (typeof name !== 'string' || (riegel && !TASTEN.includes(name))) {
      this.opt.log?.({ typ: 'abgelehnt', grund: 'unbekannte_taste', name });
      return this.json(a, 400, { fehler: 'unbekannte_taste', name });
    }
    if (this.pruefmodus === 'aus') {
      this.opt.log?.({ typ: 'abgelehnt', grund: 'pruefmodus_aus', name });
      return this.json(a, 409, { fehler: 'pruefmodus_aus', name, text: HAND_PRUEFMODUS_TEXT });
    }
    const felder = { pfad: `taste/${name}`, midi_roh: 1, sample: this.kern.uhr?.sample ?? 0 };
    this.kern.sende('/test/hand', felder);
    this.gesendet++;
    // Review Hand B2: im Kern löst die Hand-Taste nur „stopp“ aus (core_hand.cpp:91), die Freigabe braucht /k/ki/frei
    // (§4.7). Ohne das blieb Stop Cypher eine Einbahnstraße, auch über einen Kern-Neustart.
    if (name === 'freigabe') { this.kern.sende('/k/ki/frei', { id: Number(++this.id), quelle: 'andreas' }); this.gesendet++; }
    this.json(a, 200, { ok: true, gesendet: '/test/hand', felder });
  }

  private anschlussAus(...a: Parameters<typeof AN.anschlussAus>) { return AN.anschlussAus.call(this, ...a); }
  private mediathekSuche(...a: Parameters<typeof ST.mediathekSuche>) { return ST.mediathekSuche.call(this, ...a); }
  private klaengeSuche(...a: Parameters<typeof ST.klaengeSuche>) { return ST.klaengeSuche.call(this, ...a); }

  // Karte: die Mediathek-Zahlen ändern sich nur nach einem Scan, darum je DB-Stand zwischengespeichert; die Loop-Bibliothek wird jedes Mal frisch gezählt.
  private karteCache: { stand: number; karte: ReturnType<Mediathek['karte']> } | null = null;
  private klaengeKarte(...a: Parameters<typeof ST.klaengeKarte>) { return ST.klaengeKarte.call(this, ...a); }
  private mediathekFehler(...a: Parameters<typeof ST.mediathekFehler>) { return ST.mediathekFehler.call(this, ...a); }
  private stoebern(...a: Parameters<typeof ST.stoebern>) { return ST.stoebern.call(this, ...a); }

  private kollektionLeser?: KollektionSpeicher;
  private kollektionSpeicher(...a: Parameters<typeof ST.kollektionSpeicher>) { return ST.kollektionSpeicher.call(this, ...a); }
  private stoebernMuster(...a: Parameters<typeof ST.stoebernMuster>) { return ST.stoebernMuster.call(this, ...a); }
  private stoebernMusterBaum(...a: Parameters<typeof ST.stoebernMusterBaum>) { return ST.stoebernMusterBaum.call(this, ...a); }
  private musterSpeichern(...a: Parameters<typeof ST.musterSpeichern>) { return ST.musterSpeichern.call(this, ...a); }
  private stoebernDetail(...a: Parameters<typeof ST.stoebernDetail>) { return ST.stoebernDetail.call(this, ...a); }
  private stoebernBaum(...a: Parameters<typeof ST.stoebernBaum>) { return ST.stoebernBaum.call(this, ...a); }

  // `schutz=aus` hides protected rows, `vorrang=1` switches on the priority order; an empty value counts as absent
  private static schutzAus(p: URLSearchParams): boolean {
    const v = p.get('schutz') ?? '';
    if (v !== '' && v !== 'aus') throw new KatalogFehler(400, 'schutz_ungueltig');
    return v === 'aus';
  }
  private static vorrangAn(p: URLSearchParams): boolean {
    const v = p.get('vorrang') ?? '';
    if (v !== '' && v !== '1') throw new KatalogFehler(400, 'vorrang_ungueltig');
    return v === '1';
  }

  private stoebernQuellen(...a: Parameters<typeof ST.stoebernQuellen>) { return ST.stoebernQuellen.call(this, ...a); }

  // Filter aus der URL (Task 2.2: Ordner, Facette; Task 3.1/4.2 erweitern)
  // Welche Filter ein Typ hat (wie public/browse.js FILTER_FUER). Ein anderer, gesetzter Filter ist ein 400, kein stilles Ignorieren.
  private static readonly FILTER_JE_TYP: Record<string, string[]> = { track: ['camelot', 'bpm', 'energie'], loop: ['camelot', 'bpm'], oneshot: [], strudel: ['bpm'] };
  private static filterPruefen(p: URLSearchParams, typ: string): void {
    const ok = Oberflaeche.FILTER_JE_TYP[typ] ?? [];
    for (const k of ['camelot', 'bpm', 'energie']) if ((p.get(k) ?? '') !== '' && !ok.includes(k)) throw new KatalogFehler(400, 'filter_nicht_anwendbar');
  }

  private stoebernFilter(...a: Parameters<typeof ST.stoebernFilter>) { return ST.stoebernFilter.call(this, ...a); }
  private stoebernTreffer(...a: Parameters<typeof ST.stoebernTreffer>) { return ST.stoebernTreffer.call(this, ...a); }
  private katalogEintrag(...a: Parameters<typeof ST.katalogEintrag>) { return ST.katalogEintrag.call(this, ...a); }
  private postenTyp(...a: Parameters<typeof ST.postenTyp>) { return ST.postenTyp.call(this, ...a); }
  private vorhoerenAus(...a: Parameters<typeof ST.vorhoerenAus>) { return ST.vorhoerenAus.call(this, ...a); }
  private katalogFehler(...a: Parameters<typeof ST.katalogFehler>) { return ST.katalogFehler.call(this, ...a); }
  private sammlungRoute(...a: Parameters<typeof ST.sammlungRoute>) { return ST.sammlungRoute.call(this, ...a); }

  // Eine von einem Fremdprozess belegte Liste (409 liste_busy, lock.ts): bis zu 4 mal nach 25 ms asynchron wiederholen, nie blockieren
  private async wiederhole<T>(f: () => T): Promise<T> {
    for (let i = 0; ; i++) {
      try { return f(); }
      catch (e) { if (!(e instanceof SammlungFehler) || e.fehler !== 'liste_busy' || i >= 4) throw e; await new Promise((ok) => setTimeout(ok, 25)); }
    }
  }

  private sammlungAnsicht(...a: Parameters<typeof ST.sammlungAnsicht>) { return ST.sammlungAnsicht.call(this, ...a); }

  private pumpeTimer: NodeJS.Timeout | null = null;
  private reihe(...a: Parameters<typeof ST.reihe>) { return ST.reihe.call(this, ...a); }
  private pumpe(...a: Parameters<typeof ST.pumpe>) { return ST.pumpe.call(this, ...a); }
  private vorbereitenStand(...a: Parameters<typeof ST.vorbereitenStand>) { return ST.vorbereitenStand.call(this, ...a); }
  private vorbereiten(...a: Parameters<typeof ST.vorbereiten>) { return ST.vorbereiten.call(this, ...a); }
  private laden(...a: Parameters<typeof ST.laden>) { return ST.laden.call(this, ...a); }

  // Paket 2 Slice 5 (F07): Der Neustart-Zustand des Kerns trägt Decks und Regler, aber keine Loop-Boxen und keine
  // FX-Einheiten. Der Server merkt sie VOR dem Leeren (B15) und schickt sie 500 ms später erneut, jedes Stück mit der
  // Quelle der letzten Ladung bzw. Einstellung (B12). Bei Stop Cypher bleibt alles von Cypher weg (B12). Höchstens eine
  // Wiederherstellung je 30 s (B13): eine Absturzschleife soll nicht jedes Mal Ton in einen Kern pumpen, der gleich wieder fällt.
  // Kanban t_e998388c: the kern keeps no Baukasten graph either. Source of the last load per channel; the graphs go into the same plan as boxes and FX.
  private readonly graphBesitzer: Record<string, string> = {};
  private readonly angefasst = new Set<string>();   // seit dem letzten Plan neu gesetzt: fx:E, graph:K
  private letzteBoxFxWieder = 0;
  private static readonly BOX_FX_SPERRE_MS = 30_000;
  private boxFxSchnappschuss(...a: Parameters<typeof NS.boxFxSchnappschuss>) { return NS.boxFxSchnappschuss.call(this, ...a); }
  private boxFxPlanen(...a: Parameters<typeof NS.boxFxPlanen>) { return NS.boxFxPlanen.call(this, ...a); }
  private planNachholen(...a: Parameters<typeof NS.planNachholen>) { return NS.planNachholen.call(this, ...a); }
  // per deck: length taps waiting for the core's answer
  private loopLaengeTasten?: Record<string, { sicher: number; tippen: number; offen: number; kette: Promise<void> }>;
  private offenerPlanFaellig = 0;   // epoch ms the waiting plan is due
  // The snapshot of a first contact with a higher generation, until /k/willkommen AND /e/neustart of that generation said their samples
  private planWartet: { generation: number; plan: Wiederplan | null; willkommen?: number; neustart?: number } | null = null;
  private planWartetFuehren(...a: Parameters<typeof NS.planWartetFuehren>) { return NS.planWartetFuehren.call(this, ...a); }
  private wiederTimer: ReturnType<typeof setTimeout> | null = null;   // the restore 500 ms after an accepted restart (cleared by stoppe)
  private offenerPlan: Wiederplan | null = null;   // t_7f487235: plan held back by the guard
  private offenerPlanTimer: ReturnType<typeof setTimeout> | null = null;
  private boxFxWieder(...a: Parameters<typeof NS.boxFxWieder>) { return NS.boxFxWieder.call(this, ...a); }
  private graphWieder(...a: Parameters<typeof NS.graphWieder>) { return NS.graphWieder.call(this, ...a); }
  private loopOrdner(...a: Parameters<typeof LW.loopOrdner>) { return LW.loopOrdner.call(this, ...a); }
  private loop(...a: Parameters<typeof LW.loop>) { return LW.loop.call(this, ...a); }
  private tempo(...a: Parameters<typeof LW.tempo>) { return LW.tempo.call(this, ...a); }
  private loopRec(...a: Parameters<typeof LW.loopRec>) { return LW.loopRec.call(this, ...a); }
  private kanalGeoeffnet(...a: Parameters<typeof LW.kanalGeoeffnet>) { return LW.kanalGeoeffnet.call(this, ...a); }
  private kanalFaehrt(...a: Parameters<typeof LW.kanalFaehrt>) { return LW.kanalFaehrt.call(this, ...a); }
  private loopKit(...a: Parameters<typeof LW.loopKit>) { return LW.loopKit.call(this, ...a); }
  private welleAus(...a: Parameters<typeof LW.welleAus>) { return LW.welleAus.call(this, ...a); }
  private fassungAus(...a: Parameters<typeof LW.fassungAus>) { return LW.fassungAus.call(this, ...a); }
  private datei(...a: Parameters<typeof LW.datei>) { return LW.datei.call(this, ...a); }
}

async function main(): Promise<void> {
  const { values: v } = parseArgs({ options: {
    port: { type: 'string' }, 'kern-port': { type: 'string' }, 'abo-port': { type: 'string' },
    'leitstand-ws': { type: 'string' }, bestand: { type: 'string' }, arbeitsbestand: { type: 'string' }, log: { type: 'string' },
    'kern-pruefmodus': { type: 'string' }, 'ziel-kurve': { type: 'string' }, loops: { type: 'string' }, mediathek: { type: 'string' }, analyse: { type: 'string' }, korrekturen: { type: 'string' }, python: { type: 'string' }, katalog: { type: 'string' }, sammlungen: { type: 'string' }, 'welle-cache': { type: 'string' }, 'muster-ordner': { type: 'string' }, 'muster-bibliothek': { type: 'string' }, 'muster-sets': { type: 'string' }, kit: { type: 'string' }, digitalout: { type: 'string' },
    'proj-wurzel': { type: 'string' }, 'arr-ordner': { type: 'string' },   // D1 S3 (Auftrag 14 e): Proben gegen den echten Server mit eigenen Ordnern
  } });
  const zk = v['ziel-kurve'];
  if (zk !== undefined && !ZIEL_KURVEN.includes(zk)) throw new Error(`--ziel-kurve ${zk}: erlaubt sind ${ZIEL_KURVEN.join(' oder ')}`);
  const pm = v['kern-pruefmodus'];
  if (pm !== undefined && pm !== 'an' && pm !== 'aus') throw new Error(`--kern-pruefmodus ${pm}: erlaubt sind an oder aus`);
  const vorgabe = ports();   // wirft bei ungültiger CYPHERDJ_INSTANZ (Startfehler, Exit 2), wie zuvor versatz()
  const logDatei = v.log ? fs.openSync(v.log, 'a') : null;
  const o = new Oberflaeche({
    port: v.port ? Number(v.port) : vorgabe.port,
    kernPort: v['kern-port'] ? Number(v['kern-port']) : vorgabe.kernPort,
    aboPort: v['abo-port'] ? Number(v['abo-port']) : vorgabe.aboPort,
    leitstandWs: v['leitstand-ws'] ? Number(v['leitstand-ws']) : vorgabe.leitstandWs,
    bestand: v.bestand ?? ablageOrdner('bestand'),
    arbeitsbestand: v.arbeitsbestand ?? arbeitsbestandVorgabe(instanz()),
    mutationen: (process.env.OBERFLAECHE_MUTATION ?? '').split(',').filter(Boolean),
    kernPruefmodus: pm === undefined ? null : pm === 'an',
    zielKurve: zk,
    loops: v.loops,
    digitalout: v.digitalout,
    mediathek: v.mediathek,
    analyse: v.analyse,
    korrekturen: v.korrekturen,
    python: v.python,
    katalog: v.katalog,
    sammlungen: v.sammlungen,
    welleCache: v['welle-cache'],
    musterOrdner: v['muster-ordner'], musterBibliothek: v['muster-bibliothek'], musterSets: v['muster-sets'],   // Proben mit eigener Ablage (S2b)
    kit: v.kit,   // Basis-Kit des Drums-Erzeugers (djk-start --strudel-kit): sonst zählt loop_klang freie Noten gegen battery
    // Bereich proj: Projektwurzel und Arbeitsordner (Vorgaben der Instanz, wenn nicht übergeben); ein übergebener Arbeitsordner bringt seine
    // eigene Zählerdatei <arbeitsordner>.zaehler mit (Spec 6.31)
    proj: { ...(v['proj-wurzel'] ? { wurzel: v['proj-wurzel'] } : {}), ...(v['arr-ordner'] ? { arbeitsordner: v['arr-ordner'] } : {}) },
    log: (z) => { if (logDatei !== null) fs.writeSync(logDatei, JSON.stringify({ t: Date.now(), ...z }) + '\n'); },
  });
  await o.starte();
  process.stdout.write(`oberflaeche: http://127.0.0.1:${o.opt.port}/ kern ${o.opt.kernPort} abo ${o.opt.aboPort} ` +
    `leitstand ws ${o.opt.leitstandWs} bestand ${o.opt.bestand} arbeitsbestand ${o.opt.arbeitsbestand} loops ${o.opt.loops ?? loopOrdnerVorgabe(instanz())} kern-pruefmodus ${o.pruefmodus} welle-cache ${o.opt.welleCache ?? welleCacheVorgabe(instanz())}\n`);
  const ende = async (): Promise<void> => { await o.stoppe(); process.exit(0); };
  process.on('SIGTERM', () => void ende());
  process.on('SIGINT', () => void ende());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: Error) => { process.stderr.write(`oberflaeche: Startfehler: ${e.message}\n`); process.exit(2); });
}
