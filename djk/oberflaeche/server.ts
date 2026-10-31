// cypherdj-oberflaeche (Scheibe 60m): liefert die MVP-Seite aus und ist ihr Arm zum Kern.
// - Andreas' Griffe (POST /griff) gehen als /test/hand (§19.0, Semantik der Hand §7.3) an den Kern, sein Laden
//   (POST /laden) als /k/deck/laden mit Quelle andreas (§4.4). Der Leitstand sieht beides über /e/hand, /e/regler,
//   /e/geladen und /q; gelesen wird dort (WS §9, Rolle anzeige), nicht hier.
// - Kern-Abonnent (§4.1) für die schnellen Anzeigen, die der Leitstand nicht verteilt: /uhr, /zustand/deck, /pegel,
//   /e/regler, /e/hand, /e/geladen, /q, /e/protokollfehler → SSE an die Seite (GET /strom), gedrosselt.
// - Nur POST sendet an den Kern. Öffnen der Seite, /strom, /bestand, /konfig senden nichts (Negativ-Kontrolle A1).
// - 60m-Nachtrag: vor /k/deck/laden kopiert der Server die Fassung aus dem Bestand in den Arbeitsbestand
//   (arbeitsbestand.ts, Form Plan 36 F2), geprüft gegen fassung.json; kaputt oder fehlend → 400, nichts an den Kern,
//   keine halbe Kopie. Beim Start räumt er Reste toter Kopien (.kopie-<pid>-<n>) weg.
// Aufruf: node djk/oberflaeche/server.ts [--port N] [--kern-port N] [--abo-port N] [--leitstand-ws N] [--bestand DIR]
//   [--mediathek DATEI]  (Vorgabe $CYPHERDJ_MEDIATHEK, z. B. /path/to/mediathek.sqlite; nur lesen)
//   [--katalog DATEI]    (Vorgabe $CYPHERDJ_KATALOG, sonst katalog.sqlite neben der Mediathek; nur lesen)
//   [--analyse DIR]      (Slice 3a: Analyse-Ablage der Karten; Vorgabe nur im Betrieb: $CYPHERDJ_ANALYSE, sonst ~/werkstatt/cypher-dj-analyse; nur lesen)
//   [--korrekturen DIR]  (Slice 3b: Bestand des Decks, in den Set 1.1.1 Here die Eins-Korrektur schreibt; Vorgabe nur im Betrieb: --bestand; Prüfinstanz nur ausdrücklich)
//   [--python DATEI]     (Slice 3a: Python für Werkstatt-Aufträge und welle.py; Vorgabe $CYPHERDJ_PYTHON, sonst die venv der Werkstatt)
//   [--welle-cache ORDNER]  (Vorgabe: Betrieb ~/.cache/cypherdj/welle, Prüfinstanz /dev/shm/cypherdj-<i>/welle)
//   [--digitalout DATEI]  (Glanz 2.1, F22: Standdatei der Digital-Out-Wache; fehlt sie, gilt 'unbewacht')
//   [--arbeitsbestand DIR]  (Vorgabe /dev/shm/cypherdj/material, mit Prüfinstanz /dev/shm/cypherdj-<i>/material)
//   [--ziel-kurve kern|attrappe_linear]  (Vorgabe kern; Prüfstapel gegen die Attrappe: attrappe_linear)
//   [--kern-pruefmodus an|aus]  (ohne Angabe unbekannt: gelernt aus /e/protokollfehler des Kerns auf /test/hand;
//   aus → POST /griff 409 pruefmodus_aus, „hand input needs test mode until slice 35“, nichts an den Kern)
// Umgebung: CYPHERDJ_INSTANZ (Z2: Ports +1000·k), OBERFLAECHE_MUTATION=riegel_aus (nur Prüfung: Ziel-Riegel aus).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { KernAnbindung } from '../leitstand/src/kern.ts';
import { json as sendeJson, koerper as leseKoerper, postAbgewiesen, quelleAusKopf } from './http/transport.ts';
import { Router, type Route, type Bereich, type BereichKontext } from './http/router.ts';
import { projBereich, type ProjOptionen } from './bereiche/proj/bereich.ts';
import { geraeteBereich, type GeraeteOptionen } from './bereiche/geraete/bereich.ts';
import { ausgabeBereich } from './bereiche/proj/ausgabe.ts';   // Paket S3
import { aufnahmeBereich } from './bereiche/proj/aufnahme.ts';   // 1.8 Slice 1
import { stemsBereich, type StemsOptionen } from './bereiche/proj/stems.ts';   // 1.13 Slice 6
import type { Dekodiert, Felder } from '../leitstand/src/adressen.ts';
import { ZIELE, ZIEL_KURVE, ZIEL_KURVEN } from './oeffentlich/kurven.js';

const TASTEN = ['annehmen', 'verwerfen', 'stopp', 'freigabe'];
import { inArbeitsbestand, KopieFehler, raeumeAuf } from './arbeitsbestand.ts';
import { HAND_PRUEFMODUS_TEXT } from './oeffentlich/meldungen.js';
import { leseLoops, LOOP_NAME, leseLoopVersatz, schreibeLoopVersatz, schreibeLoopAusFassung } from './loops.ts';
import { pruefeAutomation, planeSpur, spurLaenge, naechsterDurchgang, leseLoopAutomation, schreibeLoopAutomation, type AutoSpur } from './loop_automation.ts';
import { beatsVon, importiereLoop, loopNameVon, findeImport, raeumeImportReste, LoopImportFehler, type ImportOptionen } from './loop_import.ts';
import { WelleCache, WelleFehler, loopQuelle, fassungQuelle, dateiQuelle } from './welle_cache.ts';
import { OEFFENTLICH, REPO, REPO_PFADE, instanz, ports, shmOrdner, rasterOrdnerVorgabe, hotcueOrdnerVorgabe, huellenVorgabe, musterOrdnerVorgabe,
  wirtOrdnerVorgabe, baukastenOrdnerVorgabe, kitsOrdnerVorgabe, zusatzKit, strudelPakete, loopOrdnerVorgabe, welleCacheVorgabe, arbeitsbestandVorgabe,
  analyseVorgabe } from './pfade.ts';
import { WerkstattAnalyse } from './bereiche/proj/analyse.ts';
import { tempoRampe, vorlaufBeats } from './tempo_rampe.ts';
import { RASTER_WAHL, abBeat, sprungDelta, loopStart, rasterRunden, hotcueDatei, leseHotcues, schreibeHotcues, type Hotcue, type Fassung, rasterSchritt, RASTER_MAX, rasterDatei, leseRaster, schreibeRaster, einsSetzen, rasterErbe, einsNachFix, einsZeile, haengeKorrekturAn, letzteEinsZeile, hatHandEins, hotcuesErbe } from './deck_bedienung.ts';
// @ts-expect-error reines .mjs ohne Typen (djk/loops)
import { loopZuKlang } from '../loops/kit_schreiben.mjs';
import { AB, PFAD, oeffnet, kanalOffen, FEHL_STATUS, ersterFreierBeat } from './hand_bedienung.ts';
import { Sammlungen, SammlungFehler, uebersicht } from './sammlung.ts';
import { MusterBibliothek, MusterFehler, type MusterEintrag } from './muster_bibliothek.ts';
import { suchTerme } from './suchtext.ts';
import { Katalog, KatalogFehler, KATALOG_TYPEN, SORT_VORGABE, SEITE_VORGABE, SEITE_MAX, katalogVorgabe, type Typ, type Zeile, type Filter } from './katalog.ts';
import { Vorhoeren, VorhoerFehler, kernNurCueVorgabe, vorhoeerKlientVorgabe } from './vorhoeren.ts';
import { Mediathek, Vorbereiter, MediathekFehler, KLANG_TYPEN, type KlangTreffer, MEDIATHEK_VORGABE, bestandIds, parseBpm, parseLimit } from './mediathek.ts';
import { pruefeSpur, plane, oeffnetKanal, beatZuMono, wirtRuf, stromVonZiel, faelligeMuster, SPUR_NAME, type MusterPlan, type Fahrt } from './spur.ts';
import { leseAusgang } from './ausgang.ts';
import { OhrLeser, hoerAntwort, sync as ohrSync, K as OHR_K, type DeckLage, Hoerscheinstelle, type Hoerschein, type DeckStand as OhrDeckStand } from './ohr.ts';
// @ts-expect-error reines .mjs ohne Typen (djk/erzeuger); muster_stand lädt Strudel NICHT (Plan-Review M3)
import { PegelPuffer } from './pegel_puffer.ts';
import { leseMusterStand, setzeAutonom } from '../erzeuger/src/muster_stand.mjs';

// Python für welle.py (braucht numpy): CYPHERDJ_PYTHON, sonst die venv der Werkstatt (Arbeitsrechner), sonst die venv
// im Repo-Wurzelordner (INSTALL §3: `python3 -m venv .venv`), sonst python3 aus dem PATH.
export function pythonVorgabe(): string {
  const kandidaten = [process.env.CYPHERDJ_PYTHON, path.join(REPO, 'djk', 'werkstatt', '.venv', 'bin', 'python'), path.join(REPO, '.venv', 'bin', 'python')];
  return kandidaten.find((p) => p !== undefined && p !== '' && fs.existsSync(p)) ?? 'python3';
}
// Mixer-Regler des Projekts (spur/*, grp/*, pm/fader) ändern sich nur über das Projekt (Spec 6.22), auf keinem Weg am Projekt vorbei
const ueberProjekt = (pfad: string): boolean => pfad.startsWith('spur/') || pfad.startsWith('grp/') || pfad === 'pm/fader';
const STRUDEL_ZEITLIMIT_MS = 2000;   // Plan-Review M3

export interface ServerOptionen {
  port: number; kernPort: number; aboPort: number; leitstandWs: number; bestand: string; arbeitsbestand: string;
  mutationen?: string[]; log?: (zeile: Record<string, unknown>) => void;
  // Läuft der Kern im Prüfmodus (§19.0)? true/false aus der Konfig (--kern-pruefmodus an|aus), sonst unbekannt:
  // dann lernt der Server es aus der Antwort des Kerns auf /test/hand (Befund 5 der adversarialen Prüfung).
  kernPruefmodus?: boolean | null;
  // Kurve, nach der die Seite Griffe rechnet (oeffentlich/kurven.js): 'kern' (Vorgabe) oder 'attrappe_linear' (Attrappe 13)
  zielKurve?: string;
  loops?: string;  // MVP 2: Loop-Ordner (Vorgabe aus CYPHERDJ_INSTANZ)
  digitalout?: string;  // Glanz 2.1: Standdatei der Digital-Out-Wache
  kits?: string;   // MVP 2 Scheibe 3: Kit-Ordner (Vorgabe ~/.config/cypherdj/kits, wie der Kern)
  kit?: string;    // Basis-Kit des Erzeugers (Vorgabe battery); Zusatz-Kit rec bzw. rec-<i>
  welleCache?: string;  // Plan Oberfläche T2: Vorgabe je Instanz (S5-Review B4): Betrieb ~/.cache/cypherdj/welle, Prüfinstanz /dev/shm/cypherdj-<i>/welle
  welleFfmpeg?: string[];  // Tests: anderer Aufruf statt ffmpeg (z. B. eine langsame Attrappe)
  welleZeitlimit?: (dauerS?: number) => number;  // Tests: Zeitlimit der Dekodierung in ms
  python?: string;      // Vorgabe: pythonVorgabe() (welle.py braucht numpy)
  musterOrdner?: string;  // Plan 2: Vorgabe /dev/shm/cypherdj[-i]/erzeuger
  hotcueOrdner?: string;  // Plan E9: Vorgabe ~/.config/cypherdj/hotcues
  rasterOrdner?: string;  // Plan Grid: Vorgabe ~/.config/cypherdj/raster
  huellen?: string;  // Ohr T5: Vorgabe /dev/shm/cypherdj[-i]/huellen
  wirtOrdner?: string;  // Studio S6: Ordner der Wirt-Sockets (Vorgabe /dev/shm/cypherdj[-i])
  baukastenOrdner?: string;  // Baukasten S2: Ordner der Graphen baukasten-<gruppe>.json (Vorgabe ~/.config/cypherdj[-i])
  sammlungen?: string;   // Sets: Ordner, Vorgabe <REPO>/bibliothek/sets
  musterBibliothek?: string;   // S2b: eigene Strudel-Muster, Vorgabe <REPO>/bibliothek/muster
  musterSets?: string;         // S2b: Muster-Quellen track.mjs und Dirigent-Blöcke, Vorgabe <REPO>/sets
  loopWerkzeug?: ImportOptionen['werkzeug'];   // Tests: Attrappen vor ffmpeg/rubberband des Loop-Imports (S6)
  katalog?: string;      // Browser (Plan 2026-10-10): katalog.sqlite, Vorgabe $CYPHERDJ_KATALOG bzw. neben der Mediathek
  stems?: Partial<StemsOptionen>;   // 1.13 Slice 6: Tests biegen zusatzArgs (Prüftrenner, P3) und killMs um
  geraete?: GeraeteOptionen;   // I08: Pfade und Erkennung (Tests geben eigene)
  proj?: ProjOptionen;   // D1 S2: Projektwurzel, Arbeitsordner (Vorgaben je Instanz, bereiche/proj/sitzung.ts)
  mediathek?: string;    // Mediathek T2: Vorgabe $CYPHERDJ_MEDIATHEK (nur lesen; fehlt sie: 503 mediathek_fehlt)
  korrekturen?: string;  // Slice 3b: Bestand des Decks für die Eins-Korrekturen; Vorgabe nur im Betrieb: bestand; eine Prüfinstanz (a..i) schreibt nur ausdrücklich
  analyse?: string;      // Slice 3a: Analyse-Ablage (Karten), Vorgabe nur im Betrieb: $CYPHERDJ_ANALYSE, sonst ~/werkstatt/cypher-dj-analyse
  einleserModul?: string;  // Mediathek T2: Python-Modul für POST /mediathek/vorbereiten (Vorgabe werkstatt.einzeln); Python selbst: `python`
  vorhoeren?: Vorhoeren;   // S7: Vorhören als Kern-Eingang (Tests: Attrappe statt Vorhörer-Prozess)
  klangBefehl?: string;  // Task 3: Programm für POST /klang (Vorgabe djk/wirte/carla/djk-klang); Tests biegen es auf ein Stub-Skript um
}

const KLANG_GRUPPEN = ['bass', 'melodie'];
const KLANG_AUS_MAX = 32768, KLANG_ERR_MAX = 8192;

export type Pruefmodus = 'an' | 'aus' | 'unbekannt';

// Drosselung je Schlüssel: höchstens eine Meldung je Intervall, die letzte gewinnt (nachgereicht)
const DROSSEL_MS: Record<string, number> = { '/uhr': 50, '/zustand/deck': 100, '/pegel': 100, '/zustand/komp': 100, '/zustand/arr': 50, '/zustand/ein': 250, '/zustand/rec': 100 };   // D1 S2: /zustand/arr 50 Hz beim Spielen, Drossel 50 ms (Spec 3.1)
const DURCHREICHEN = new Set(['/uhr', '/zustand/deck', '/pegel', '/e/regler', '/e/hand', '/e/geladen', '/e/hotcue', '/e/fx',
  '/e/fx/zuweisung', '/e/fx/routing', '/q', '/e/protokollfehler', '/e/halter', '/e/neustart', '/k/willkommen', '/e/ki', '/e/loop', '/e/mitschnitt', '/e/raster',
  '/zustand/komp',   // Effekt-Sektion 2026-10-11: Absenkung je aktivem Kompressor (10 Hz)
  '/zustand/arr', '/e/freeze', '/zustand/ein', '/zustand/rec', '/e/aufnahme']);   // D1 S2 (Spec 3.4); I08 (§5.14)

interface Eintrag {
  material_id: string; titel: string; camelot: string | null; quelle_bpm: number; dauer_s: number; lufs: number;
  tore_ok: boolean; basis_bpm: number; fassung: number; beats: number | null; erste_eins_quell_beat: number;
  eins_unsicher: boolean;   // tore.eins.unsicher der Fassung (2026-10-11): die Seite zeigt „downbeat?“
}

export function leseBestand(dir: string): Eintrag[] {
  const idx = path.join(dir, 'index.sqlite');
  if (!fs.existsSync(idx)) return [];
  const db = new DatabaseSync(idx, { readOnly: true });
  try {
    const zeilen = db.prepare(`SELECT m.material_id, m.titel, m.camelot, m.quelle_bpm, m.dauer_s, m.lufs AS m_lufs,
        f.basis_bpm, f.fassung, f.lufs, f.tore_ok FROM fassung f JOIN material m USING (material_id)
        ORDER BY m.titel, f.basis_bpm, f.fassung`).all() as Record<string, unknown>[];
    return zeilen.map((z) => {
      const mo = path.join(dir, String(z.material_id));
      const fj = path.join(dir, String(z.material_id), 'fassungen', `${Math.round(Number(z.basis_bpm) * 1000)}_r${z.fassung}`, 'fassung.json');
      let beats: number | null = null;
      let eins = 0, unsicher = false, bewertet = false;
      try {
        const j = JSON.parse(fs.readFileSync(fj, 'utf8')) as { beats?: number; erste_eins_quell_beat?: number; tore?: { eins?: { unsicher?: unknown } } };
        beats = j.beats ?? null;
        eins = j.erste_eins_quell_beat ?? 0;
        unsicher = j.tore?.eins?.unsicher === true;
        bewertet = (j.tore?.eins as { bewertet?: unknown } | undefined)?.bewertet === true;
      } catch { /* Fassung ohne json: Anzeige ohne Länge */ }
      // Seitenwert von lauf_eins (eins_bewertung.json neben material.json), solange die Fassung selbst nicht bewertet ist
      if (!bewertet) {
        try {
          const sw = JSON.parse(fs.readFileSync(path.join(mo, 'eins_bewertung.json'), 'utf8')) as { unsicher?: unknown };
          unsicher = sw.unsicher === true && !hatHandEins(mo);
        } catch { /* keine oder unlesbare Seitendatei: nichts zeigen */ }
      }
      return {
        material_id: String(z.material_id), titel: String(z.titel), camelot: (z.camelot as string) ?? null,
        quelle_bpm: Number(z.quelle_bpm), dauer_s: Number(z.dauer_s), lufs: Number(z.lufs), tore_ok: z.tore_ok === 1,
        basis_bpm: Number(z.basis_bpm), fassung: Number(z.fassung), beats, erste_eins_quell_beat: eins,
        eins_unsicher: unsicher,
      };
    });
  } finally { db.close(); }
}

const TYPEN: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

interface SpurLauf { quelle: string; anker: number; ende: number; fahrten: Fahrt[]; timer: NodeJS.Timeout[]; offen: MusterPlan[]; gruppen: Set<string>; ids: number[]; teile: { id: number; teil: number; pfad: string }[] }

// K2: Regler, die /lage erst zeigt, wenn sie von der Vorgabe (INTERFACES §1.5) abweichen
// Kompressor je Quellkanal (2026-10-11): in der Lage, sobald ein Feld von seiner Vorgabe abweicht
const KOMP_VORGABE: Record<string, number> = { an: 0, schwelle: -18, ratio: 4, attack: 10, release: 120, makeup: 0, mix: 1, sc: 0 };
const kompAbweichend = (p: string, w: number): boolean => { const m = /^(?:deck\/[1-4]|erz\/[1-8]|pad\/[12])\/komp\/(\w+)$/.exec(p); return !!m && m[1] in KOMP_VORGABE && w !== KOMP_VORGABE[m[1]]; };
const LAGE_ABWEICHEND: Record<string, number> = { 'master/kleber': 0, 'duck/tiefe': 0, 'duck/release': 200, 'fx/2/rueckweg': 0, 'color/art': 0, 'color/param': 0.5 };

export class Oberflaeche {
  readonly opt: ServerOptionen;
  readonly kern: KernAnbindung;
  private http: http.Server | null = null;
  private readonly stroeme = new Set<http.ServerResponse>();
  private readonly letzte = new Map<string, number>();
  private readonly pegelPuffer = new PegelPuffer();   // ungedrosselt, vor der SSE-Drossel gefüttert (GET /pegel)
  private readonly wartend = new Map<string, NodeJS.Timeout>();
  private readonly stand = { regler: {} as Record<string, number>, decks: {} as Record<string, Felder>, geladen: {} as Record<string, Felder>, loops: {} as Record<string, Felder>,
    fx: [null, null] as (Felder | null)[], fxZuweisung: [{}, {}] as Record<string, boolean>[],   // Index 0 = FX1, 1 = FX2
    fxRouting: 'post_fader' as 'post_fader' | 'insert' };   // Ohr T18: wo der Beat-FX in den Kanalzügen sitzt (Stand des Kerns)
  // Ohr T18: Andreas' letzte Wahl. Der Kern behält das Routing über einen Neustart nicht (Rev. 5); der Server sendet sie
  // nach /e/neustart erneut, wenn sie nicht die Vorgabe ist. Nur im Speicher: ein Server-Neustart kehrt zur Vorgabe zurück.
  private fxRoutingWunsch: 'post_fader' | 'insert' = 'post_fader';
  private id = process.hrtime.bigint();
  private generation: number | null = null;
  private readonly welle: WelleCache;
  private readonly ohr: OhrLeser;   // Ohr T5: Hüllkurven-Ring (§6.2), liest deck/1, deck/2, master
  private ohrTakt: NodeJS.Timeout | null = null;
  // Effekt-Sektion Schritt 4: je Box die geplante Loop-Automation (Name, bis wohin geplant, nächste Teilnummer)
  private loopAuto: Record<string, { name: string; auto: AutoSpur[]; beats: number; geplantBis: number[]; teil: number }> = {};   // geplantBis je Spur
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
  private rasterWert(deck: number, f: Fassung): { versatz_frames: number; gespeichert_frames: number } {
    const g = this.rasterGespeichert(f);
    const x = this.rasterLive[String(deck)];
    return { versatz_frames: x && x.schluessel === Oberflaeche.fassungSchluessel(f) ? x.v : g, gespeichert_frames: g };
  }
  private rasterOrdner(): string { return this.opt.rasterOrdner ?? rasterOrdnerVorgabe(); }
  private huellenPfad(): string { return this.opt.huellen ?? huellenVorgabe(); }
  // Gespeicherter Versatz der Fassung; fehlt ihre Datei, gilt die der nächstälteren Fassung (rasterErbe, Bericht grid-phase M7).
  private readonly einsGelesen = new Map<string, { eins: number; esf: number }>();
  private einsDerFassung(mid: string, bpm: number, fassung: number): { eins: number; esf: number } | null {
    const k = `${mid}|${bpm}|${fassung}`, c = this.einsGelesen.get(k);
    if (c !== undefined) return c;
    try {
      const q = fassungQuelle(this.opt.bestand, mid, bpm, fassung);
      const j = JSON.parse(fs.readFileSync(path.join(path.dirname(q.datei), 'fassung.json'), 'utf8')) as Record<string, unknown>;
      const e = { eins: Number(j.erste_eins_quell_beat), esf: Number(j.erster_schlag_frame) };
      if (!Number.isFinite(e.eins) || !Number.isFinite(e.esf)) return null;
      this.einsGelesen.set(k, e);
      return e;
    } catch { return null; }
  }
  private rasterErbeVon(f: Fassung): { v: number; von: number | null } {
    return rasterErbe(this.rasterOrdner(), f, { fpb: 48000 * 60 / f.basis_bpm, einsVon: (r) => this.einsDerFassung(f.material_id, f.basis_bpm, r) });
  }
  private rasterGespeichert(f: Fassung): number { return this.rasterErbeVon(f).v; }
  // Nur FIX (der ausdrückliche Speicherakt, Review B4; SET bleibt flüchtig wie der Raster-Versatz): die ganzen Beats im Versatz sind die Eins; sie gehört ins Material (korrekturen.jsonl art=eins), damit sie in
  // jeder Folgefassung von selbst stimmt (kette.korrigieren). Ein Fehler hier darf das Grid nicht blockieren: nur loggen.
  private einsZurueck(st: { f: Fassung; eins: number }, v: number, quelle: 'FIX'): void {
    try {
      const mo = path.join(this.opt.bestand, st.f.material_id);
      const fpb = 48000 * 60 / st.f.basis_bpm;
      const ziel = einsNachFix({ v, fpb, eins: st.eins, letzte: letzteEinsZeile(mo) });
      if (ziel === null) return;
      const k = Math.round(v / fpb);
      haengeKorrekturAn(mo, einsZeile(st.f, ziel, k, quelle));
      this.opt.log?.({ typ: 'eins_korrektur', quelle, material_id: st.f.material_id, fassung: st.f.fassung, eins: ziel, beats: k });
    } catch (e) { this.opt.log?.({ typ: 'eins_korrektur_fehler', material_id: st.f.material_id, fehler: (e as Error).message }); }
  }
  private rasterSenden(deck: number, f: Fassung, v: number): void {
    this.kern.sende('/k/deck/raster', { id: Number(++this.id), quelle: this.quelle(), deck, material_id: f.material_id,
      basis_bpm: f.basis_bpm, fassung: f.fassung, versatz_frames: v });
    this.gesendet++;
    this.rasterLive[String(deck)] = { schluessel: Oberflaeche.fassungSchluessel(f), v };
  }
  // POST /deck/raster {deck, schritt_ms} (relativ, |schritt| ≤ 100 ms) oder {deck, versatz_frames} (absolut, ganzzahlig)
  private deckRaster(d: Record<string, unknown>, a: http.ServerResponse): void {
    if (d.deck !== 1 && d.deck !== 2) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
    const st = this.deckStand(d.deck);
    if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
    if (d.set === true) return this.deckRasterSet(st, a);
    let v: number;
    if (typeof d.versatz_frames === 'number' && Number.isInteger(d.versatz_frames) && Math.abs(d.versatz_frames) <= RASTER_MAX) {
      v = d.versatz_frames;
    } else if (typeof d.schritt_ms === 'number' && Number.isFinite(d.schritt_ms) && Math.abs(d.schritt_ms) <= 100) {
      v = rasterSchritt(this.rasterWert(st.deck, st.f).versatz_frames, d.schritt_ms);
    } else {
      return this.json(a, 400, { fehler: 'schritt_oder_versatz' });
    }
    this.rasterSenden(st.deck, st.f, v);
    this.json(a, 200, { ok: true, ...this.rasterWert(st.deck, st.f) });
  }

  // GET /hoeren?deck=1|2&takte=1..16 (Vorgabe 4): Ohr T5, erlaubt für jede Quelle (lesend).
  private hoerenAus(url: URL, a: http.ServerResponse): void {
    const deck = Number(url.searchParams.get('deck'));
    if (deck !== 1 && deck !== 2) return this.json(a, 400, { fehler: 'deck' });
    const takteRoh = url.searchParams.get('takte');
    const takte = takteRoh === null ? 4 : Number(takteRoh);
    if (!Number.isInteger(takte) || takte < 1 || takte > 16) return this.json(a, 400, { fehler: 'takte' });
    const u = this.kern.uhr;
    if (!u) return this.json(a, 409, { fehler: 'kein_kernstand' });
    const st = this.deckStand(deck);
    const lage: DeckLage = { deck, geladen: st !== null, laeuft: st ? Number(st.z.status) >= 2 : false,
      offen: kanalOffen(this.stand.regler, `deck/${deck}`) };
    const r = hoerAntwort(this.ohr, lage, u.beat, u.bpm, takte);
    if (r.code === 200) {
      // Ohr T8 (Plan Rev. 4): Sync unvalidiert (Befund Slice 2, anschlagPhase instabil an Mischungen,
      // ~/messungen/2026-09-28-ohr-slice2/anschlag_echt.json) — geht NICHT ins Urteil (Task 9), nur mitgeliefert.
      const kanalDeck = deck - 1;
      const saetzeDeck = this.ohr.saetze(kanalDeck, r.j.gemessen_von_beat, r.j.gemessen_bis_beat);
      const partnerDeck = deck === 1 ? 2 : 1;
      const stPartner = this.deckStand(partnerDeck);
      const partnerLaeuft = stPartner ? Number(stPartner.z.status) >= 2 : false;
      const partnerOffen = kanalOffen(this.stand.regler, `deck/${partnerDeck}`);
      const saetzePartner = partnerLaeuft && partnerOffen
        ? this.ohr.saetze(partnerDeck - 1, r.j.gemessen_von_beat, r.j.gemessen_bis_beat) : null;
      const s = ohrSync(saetzeDeck, saetzePartner, u.bpm);
      r.j.sync = { sync_ms: s.sync_ms, deck_gegen_deck_ms: s.deck_gegen_deck_ms, n: s.n, validiert: false };
      r.j.hoerschein = this.hoerscheinstelle.letzter(deck);   // Ohr T10
      // Task 1.5: der Mess-Abgriff liegt NACH dem Trim (adr/008), also relativ korrigieren, nicht absolut.
      // Einheit dB; absoluter Soll für deck/N/trim (derselbe Pfad wie /regler), geklemmt auf die Reglertabelle ±24.
      // Kein Vorschlag, wenn der alte Trim unbekannt ist (stand.regler startet nach Seiten-Neustart leer, der Kern
      // schickt Neuabonnenten keine Regler: `trim_unbekannt`) oder wenn eine Seite stumm ist (ohr db10 −200).
      const v = r.j.vergleich;
      const pd = v.pegel_diff_db;
      if (typeof pd === 'number' && Number.isFinite(pd) && v.neu.lufs > -200 && v.laufend.lufs > -200) {
        const trimAlt = this.stand.regler[`deck/${deck}/trim`];
        if (typeof trimAlt === 'number' && Number.isFinite(trimAlt)) {
          v.trim_vorschlag_db = Math.max(-24, Math.min(24, Math.round((trimAlt - pd) * 10) / 10));
        } else {
          v.trim_unbekannt = true;
        }
      }
    }
    this.json(a, r.code, r.j);
  }

  // Ohr T10: je neuem Takt der Master-Uhr (Beat überschreitet ein Vielfaches von 4) Hörscheine ausstellen/zurückziehen.
  private hoerscheinTakt(): void {
    const u = this.kern.uhr;
    if (!u) return;
    const takt = Math.floor(u.beat / 4);
    if (takt === this.hoerscheinLetzterTakt) return;
    this.hoerscheinLetzterTakt = takt;
    const decks: OhrDeckStand[] = [1, 2].map((n) => {
      const st = this.deckStand(n);
      const laeuft = st !== null && Number(st.z.status) >= 2;
      const inhalt = st ? `${st.f.material_id}/${Math.round(st.f.basis_bpm * 1000)}_r${st.f.fassung}` : '';
      return { deck: n, laeuft, inhalt, bpm: st ? st.f.basis_bpm : 0 };
    });
    const aktionen = this.hoerscheinstelle.takt(this.ohr, u.beat, u.bpm, decks, (deck) => kanalOffen(this.stand.regler, `deck/${deck}`));
    for (const akt of aktionen) {
      // §4.5: quelle fest 'cypher' (die Analyse spricht als Cyphers Ohr, unabhängig von der Anfrage, die den Takt auslöste)
      this.kern.sende(akt.adresse, { id: Number(++this.id), quelle: 'cypher', ...akt.felder });
      this.gesendet++;
    }
  }
  // POST /deck/raster {deck, set: true}: der Beat unter dem stehenden Kopf wird Takt-Eins (einsSetzen). Der Kern hält beim
  // Versatz den Quell-Beat unter dem Kopf, der Ton rückt um k Beats; der Sprung um −k stellt den Kopf physisch zurück.
  // Laufend 409: dort würde der Ton gegen den Master springen.
  private deckRasterSet(st: NonNullable<ReturnType<Oberflaeche['deckStand']>>, a: http.ServerResponse): void {
    if (Number(st.z.status) >= 2) return this.json(a, 409, { fehler: 'deck_laeuft' });
    const alt = this.rasterWert(st.deck, st.f).versatz_frames;
    const n = einsSetzen({ v: alt, quell: Number(st.z.quell_beat), eins: st.eins, fpb: 48000 * 60 / st.f.basis_bpm, erster: st.erster });
    if (!n) return this.json(a, 409, { fehler: 'ausserhalb_bereich' });
    if (n.k === 0) return this.json(a, 200, { ok: true, k: 0, ...this.rasterWert(st.deck, st.f) });
    // Reihenfolge so, dass der Kopf dazwischen nach HINTEN wandert: nach vorn klemmt der Kern am Frame 0 (Instanz i,
    // Kopf auf dem ersten Schlag, k −2: 1,56 Beats daneben). k > 0: Raster (sofort) rückt den Ton später, dann Sprung −k.
    // k < 0: erst Sprung +|k| (später), abwarten, bis der Kern ihn meldet, dann Raster.
    const deck = st.deck, q0 = Number(st.z.quell_beat);
    const sprung = () => this.deckTeil('/k/deck/sprung', st, this.deckAb(st, 0), 0, { delta_beats: -n.k });
    const fertig = () => {
      this.opt.log?.({ typ: 'raster_set', deck, k: n.k, versatz_frames: n.v });
      this.json(a, 200, { ok: true, k: n.k, ...this.rasterWert(deck, st.f) });
    };
    if (n.k > 0) { this.rasterSenden(deck, st.f, n.v); sprung(); return fertig(); }
    sprung();
    const ziel = q0 - n.k, t0 = Date.now();
    const warte = () => {
      const q = Number((this.stand.decks[String(deck)] as Record<string, unknown> | undefined)?.quell_beat);
      if (Math.abs(q - ziel) < 1e-3) { this.rasterSenden(deck, st.f, n.v); return fertig(); }
      if (Date.now() - t0 > 1500) return this.json(a, 504, { fehler: 'sprung_ohne_meldung' });
      setTimeout(warte, 20);
    };
    warte();
  }
  // POST /deck/raster/fix {deck}: der Live-Versatz wird der gespeicherte (D3)
  private deckRasterFix(d: Record<string, unknown>, a: http.ServerResponse): void {
    if (d.deck !== 1 && d.deck !== 2) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
    const st = this.deckStand(d.deck);
    if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
    const v = this.rasterWert(st.deck, st.f).versatz_frames;
    // Review F1: ein nur geerbter Satz hängt an der Audio-Stelle (rechnet mit dem gespeicherten Raster), ein eigener an der
    // Raster-Position. Vor dem neuen Raster mit dem alten Versatz festschreiben, sonst hängt das Ergebnis von der Reihenfolge ab.
    const hd = hotcueDatei(this.hotcueOrdner(), st.f);
    if (!fs.existsSync(hd)) { const e = this.hotcuesErbeVon(st.f); if (e.von !== null) schreibeHotcues(hd, e.hotcues); }
    schreibeRaster(rasterDatei(this.rasterOrdner(), st.f), v);
    this.opt.log?.({ typ: 'raster_fix', deck: st.deck, versatz_frames: v });
    this.einsZurueck(st, v, 'FIX');
    this.json(a, 200, { ok: true, ...this.rasterWert(st.deck, st.f) });
  }
  // Nach /e/geladen und nach /e/neustart: gespeicherten (bzw. beim Neustart den live) Versatz an den Kern (D3, D7)
  private rasterWieder(deck: number, f: Fassung, nachNeustart: boolean): void {
    if (!f?.material_id) return;
    const erbe = this.rasterErbeVon(f);
    const v = nachNeustart ? this.rasterWert(deck, f).versatz_frames : erbe.v;
    this.rasterLive[String(deck)] = { schluessel: Oberflaeche.fassungSchluessel(f), v };
    if (v === 0) return;
    this.rasterSenden(deck, f, v);
    this.opt.log?.({ typ: 'raster_wieder', deck, versatz_frames: v, ...(erbe.von !== null && v === erbe.v ? { geerbt_von: erbe.von } : {}) });
  }

  private readonly mediathek: Mediathek;
  private readonly katalog: Katalog;
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
    this.mediathek = new Mediathek(opt.mediathek ?? MEDIATHEK_VORGABE);
    this.katalog = new Katalog(opt.katalog ?? katalogVorgabe(opt.mediathek ?? MEDIATHEK_VORGABE));
    const inst = instanz();
    const shm = shmOrdner(inst);
    this.vorhoeren = opt.vorhoeren ?? new Vorhoeren({ kopfhoererDa: () => Vorhoeren.kopfhoererDaVorgabe(inst), kernNurCue: () => kernNurCueVorgabe(shm),
      klient: () => vorhoeerKlientVorgabe(REPO, inst, opt.log), kantenDatei: path.join(shm, 'kanten'), instanz: inst });
    this.sammlungen = new Sammlungen(opt.sammlungen ?? REPO_PFADE.sammlungen);
    this.muster = new MusterBibliothek({ eigen: opt.musterBibliothek ?? REPO_PFADE.musterBibliothek, sets: opt.musterSets ?? REPO_PFADE.musterSets });
    this.vorbereiter = new Vorbereiter({ python: python,
      cwd: REPO_PFADE.werkstatt, bestand: opt.bestand, modul: opt.einleserModul, log: opt.log });
    this.ohr = new OhrLeser(this.huellenPfad(), [OHR_K.deck1, OHR_K.deck2, OHR_K.master]);
    this.pruefmodus = this.pruefmodusAusKonfig();
    this.kern = new KernAnbindung({ kernPort: opt.kernPort, aboPort: opt.aboPort, name: 'oberflaeche' }, {
      nachricht: (d) => this.vomKern(d),
      gesendet: (adresse, felder) => { if (adresse !== '/k/hallo') opt.log?.({ typ: 'an_kern', adresse, felder }); },
      zustand: (neu) => this.verteile({ a: 'kern', f: { zustand: neu } }),
      unlesbar: (grund) => opt.log?.({ typ: 'unlesbar', grund }),
    });
    this.router.melde({ name: 'oberflaeche', routen: () => this.routenOberflaeche() });
    // D1 S2 (Spec 3.4): Audio-Quellen über denselben Katalog wie der Browser. Spec 6.30: die Meldung bleibt zweizeilig (erst this.proj, dann melden),
    // weil stoppe() den Bereich braucht; S3 zieht seinen Anker auf diese zwei Zeilen nach.
    // Slice 3a: die Analyse-Ablage (Karten) und der Auftragsgeber der Analyse auf Abruf. Betrieb: Vorgabe $CYPHERDJ_ANALYSE bzw. ~/werkstatt/cypher-dj-analyse; eine
    // Prüfinstanz (a..i) hat keine Vorgabe und liest/schreibt die Ablage nur mit ausdrücklichem --analyse (sie berührt nie die echte).
    const analyseOrdner = opt.analyse !== undefined ? opt.analyse : analyseVorgabe(inst);
    const analysierer = analyseOrdner ? new WerkstattAnalyse({ python, cwd: REPO_PFADE.werkstatt, ablage: analyseOrdner, modul: opt.einleserModul, log: opt.log }) : null;
    this.proj = projBereich(this.bereichKontext(), { katalog: opt.katalog ?? katalogVorgabe(opt.mediathek ?? MEDIATHEK_VORGABE), mediathek: opt.mediathek ?? MEDIATHEK_VORGABE,
      analyse: analyseOrdner, analysierer, bestand: opt.korrekturen !== undefined ? opt.korrekturen : (inst === '' ? opt.bestand : null), ...opt.proj });
    this.router.melde(this.proj);
    this.ausgabe = ausgabeBereich(this.bereichKontext(), this.proj.zugang, { wirtOrdner: () => this.wirtBasis() });   // Paket S3: /proj/freeze, /proj/export (Spec 3.4)
    this.router.melde(this.ausgabe);
    this.aufnahme = aufnahmeBereich(this.bereichKontext(), this.proj.zugang);   // 1.8: /proj/aufnahme
    this.router.melde(this.aufnahme);
    this.stems = stemsBereich(this.bereichKontext(), this.proj.zugang, { python, cwd: REPO_PFADE.werkstatt, ...opt.stems });   // 1.13 S6
    this.router.melde(this.stems);
    this.router.melde(geraeteBereich(this.bereichKontext(), opt.geraete ?? {}));   // I08: /geraete
  }

  async starte(): Promise<void> {
    this.spurenLaden();   // Studio S6 F2
    this.ladeAktiveLoops();   // gemerkter Deck-Loop von vor dem Neustart
    const reste = raeumeAuf(this.opt.arbeitsbestand);
    if (reste > 0) this.opt.log?.({ typ: 'aufgeraeumt', anzahl: reste, arbeitsbestand: this.opt.arbeitsbestand });
    const importReste = raeumeImportReste(this.loopOrdner());   // S6: Arbeitsordner eines abgestürzten Loop-Imports
    if (importReste > 0) this.opt.log?.({ typ: 'loop_import_aufgeraeumt', anzahl: importReste });
    await this.kern.starte();
    this.ohrTakt = setInterval(() => { this.ohr.lies(); this.hoerscheinTakt(); this.loopAutoTakt(); }, 100);  // Ohr T5/T10: Ring 100 ms nachlesen, je neuem Takt Hörscheine
    this.http = http.createServer((q, a) => { this.anfrage(q, a).catch((e: Error) => this.json(a, 500, { fehler: e.message })); });
    await new Promise<void>((ok, fehler) => {
      this.http!.once('error', fehler);
      this.http!.listen(this.opt.port, '127.0.0.1', () => ok());
    });
  }

  private gestoppt = false;
  async stoppe(): Promise<void> {
    if (this.gestoppt) return;   // zweimal (Test-Neustart und Aufräumen) darf nichts werfen
    this.gestoppt = true;
    this.aufnahme.aufnahme.schliesse();
    this.stems.stems.schliesse();
    this.ausgabe.ausgabe.schliesse();   // Fix-Runde S3 R7: ein wartender Freeze endet jetzt mit freeze_fehler, nicht erst nach Stille oder Frist
    this.proj.sitzung.schliesse();   // D1 S2: ausstehenden Mixer-Eintrag schreiben, Projekt-Sperre frei
    for (const l of this.spuren.values()) for (const t of l.timer) clearTimeout(t);
    for (const s of this.stroeme) s.end();
    for (const t of this.wartend.values()) clearTimeout(t);
    if (this.ohrTakt) { clearInterval(this.ohrTakt); this.ohrTakt = null; }
    if (this.pumpeTimer) clearTimeout(this.pumpeTimer);
    this.vorbereiter.stoppe();
    await this.vorhoeren.ende();
    await this.kern.stoppe();
    await new Promise<void>((ok) => (this.http ? this.http.close(() => ok()) : ok()));
  }

  private pruefmodusAusKonfig(): Pruefmodus {
    const k = this.opt.kernPruefmodus;
    return k === true ? 'an' : k === false ? 'aus' : 'unbekannt';
  }

  private setzePruefmodus(neu: Pruefmodus, quelle: string): void {
    if (neu === this.pruefmodus) return;
    this.pruefmodus = neu;
    this.opt.log?.({ typ: 'pruefmodus', stand: neu, quelle });
    this.verteile({ a: 'pruefmodus', f: { stand: neu, text: neu === 'aus' ? HAND_PRUEFMODUS_TEXT : '' } });
  }

  private vomKern(d: Dekodiert): void {
    const f = d.felder;
    // Der Kern ohne Prüfmodus verwirft /test/hand als unbekannte Adresse (netz.cpp paket(), §19.0) und meldet es allen
    // Abonnenten. Nur dieser Grund heißt „ohne Prüfmodus“; unbekannter_regler (falsches Ziel) heißt das Gegenteil.
    if (d.adresse === '/e/protokollfehler' && f.adresse === '/test/hand' && f.grund === 'unbekannte_adresse') {
      this.setzePruefmodus('aus', 'kern');
    }
    // Neue Generation (Kern neu gestartet, vielleicht mit anderem Schalter): wieder der Stand aus der Konfig
    const alteGeneration = this.generation;   // Slice 5 F4: nur eine NEUE Generation ist ein Kern-Neustart
    if (d.adresse === '/k/willkommen' || d.adresse === '/e/neustart') {
      const g = f.generation as number;
      if (this.generation !== null && g !== this.generation) this.setzePruefmodus(this.pruefmodusAusKonfig(), 'neue_generation');
      this.generation = g;
    }
    if (d.adresse === '/e/regler') this.stand.regler[f.pfad as string] = f.wert as number;
    if (d.adresse === '/q') this.merkeQuittung(f);
    if (d.adresse === '/e/ki') this.setzeKiGestoppt(Number(f.gestoppt) === 1);
    // Riegel 2026-09-30: /e/ki kommt nur beim Wechsel; ein neu gestarteter Server holt den Stand aus dem periodischen
    // /zustand/kern (ki_gestoppt, Scheibe 25), sonst vergäße er ein gedrücktes Stop Cypher
    if (d.adresse === '/zustand/kern' && f.ki_gestoppt !== undefined) this.setzeKiGestoppt(Number(f.ki_gestoppt) === 1);
    if (d.adresse === '/zustand/deck') { this.stand.decks[String(f.deck)] = f; this.zieheGeladenNach(f); }   // Fix-Runde S3 R8
    if (d.adresse === '/e/geladen') {
      const n = String(f.deck), z = this.stand.decks[n];
      this.geladenSeit[n] = { vorher: z ? Oberflaeche.deckSchluessel(z) : null, bestaetigt: false };
      this.stand.geladen[n] = f;
    }
    if (d.adresse === '/e/geladen') this.hotcuesWieder(Number(f.deck), f as unknown as Fassung);   // Plan E9 D5
    if (d.adresse === '/e/geladen') this.rasterWieder(Number(f.deck), f as unknown as Fassung, false);   // Plan Grid D3
    if (d.adresse === '/e/neustart') {   // der Neustart-Zustand kennt keine Hotcues; /e/geladen kommt dann nicht
      setTimeout(() => { for (const [n, g] of Object.entries(this.stand.geladen)) { this.hotcuesWieder(Number(n), g as unknown as Fassung); this.rasterWieder(Number(n), g as unknown as Fassung, true); } }, 500);
    }
    if (d.adresse === '/e/loop') this.stand.loops[String(f.box)] = f;       // MVP 2
    if (d.adresse === '/e/loop') {   // Slice 5 F1: der Kern meldet den neuen Namen auf der Box = die Ladung ist angekommen
      const b = String(f.box), p = this.loopLadung[b];
      if (p && p.name === f.name) { this.loopBesitzer[b] = p.quelle; delete this.loopLadung[b]; }
      this.angefasst.add(`box:${b}`);
    }
    if (d.adresse === '/e/fx') { const e = Number(f.einheit); if (e === 1 || e === 2) { this.stand.fx[e - 1] = f; this.angefasst.add(`fx:${e}`); } }
    if (d.adresse === '/e/fx/zuweisung') {
      const e = Number(f.einheit);
      if (e === 1 || e === 2) this.stand.fxZuweisung[e - 1][String(f.kanal)] = f.an === 1;
    }
    // Gleiche Generation (ein Abonnent hat sich nur neu gemeldet, der Kern lief weiter): der Stand des Kerns ist unverändert,
    // der Server leert nichts und sendet nichts erneut. Nur ein neuer Kern (andere Generation) beginnt leer.
    const neuerKern = d.adresse === '/e/neustart' && f.generation !== alteGeneration;
    // Final-Review MAJOR-1: ein gebremster Kern (Bremse F20) startet mit Generation 0 und sendet nur /k/willkommen, kein
    // /e/neustart. Eine KLEINERE Generation ist ein neuer Kern ohne Fortsetzung: Stand leeren, Routing-Wunsch erneut senden,
    // aber nichts wiederherstellen (die Bremse hat den Zustand absichtlich verworfen).
    const gebremst = d.adresse === '/k/willkommen' && alteGeneration !== null && Number(f.generation) < alteGeneration;
    if (gebremst) {
      this.opt.log?.({ typ: 'wiederherstellung_uebersprungen', grund: 'gebremster_start', generation: f.generation });
      this.verteile({ a: 'wiederherstellung', f: { uebersprungen: true, grund: 'gebremster_start' } });
    }
    if (neuerKern) this.boxFxPlanen();   // Paket 2 Slice 5 (F07): Schnappschuss VOR dem Leeren (B15)
    if (neuerKern || gebremst) { this.stand.fx = [null, null]; this.stand.fxZuweisung = [{}, {}]; }  // nach einem Neustart sind beide Einheiten aus
    if (d.adresse === '/e/fx/routing') this.stand.fxRouting = Number(f.routing) === 1 ? 'insert' : 'post_fader';
    if (neuerKern || gebremst) {   // Ohr T18: der neue Kern steht auf Post Fader; Andreas' Wahl geht erneut hin
      this.stand.fxRouting = 'post_fader';
      if (this.fxRoutingWunsch !== 'post_fader') this.fxRoutingSenden(this.fxRoutingWunsch, 'andreas');
    }
    if (neuerKern || gebremst) this.fahrtEnde.clear();                 // Plan Glanz 1.2: ob ein gebremster Start den Beat auf 0 setzt, ist ungeprüft
    if (neuerKern || gebremst) this.loopRasterLive = {};              // Plan Grid, Review F5
    if (neuerKern || gebremst) this.stand.loops = {};                  // Boxen liegen nicht im Neustart-Zustand
    if (neuerKern || gebremst) for (const k of Object.keys(this.loopLadung)) delete this.loopLadung[k];   // Ladung ohne Echo gilt für den neuen Kern nicht (boxInhaltName zöge sie vor)
    if (d.adresse === '/pegel') this.pegelPuffer.nimm({ kanal: String(f.kanal), spitze_db: Number(f.spitze_db) });   // vor der Drossel: Spitzen gehen nicht verloren
    // Spec D1 2.10: Haken ereignis? der Bereiche, für jedes Kern-Ereignis, nach der Zustandsführung und vor dem Durchreichen (Plan d1-s1 Task 9)
    this.router.ereignis(d.adresse, f, (bereich, e) => this.opt.log?.({ typ: 'bereich_ereignis_fehler', bereich, adresse: d.adresse, fehler: e.message }));
    if (!DURCHREICHEN.has(d.adresse)) return;
    const ms = DROSSEL_MS[d.adresse];
    const n = { a: d.adresse, f };
    if (!ms) { this.verteile(n); return; }
    const schluessel = `${d.adresse}|${f.deck ?? f.kanal ?? ''}`;
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

  private verteile(n: Record<string, unknown>): void {
    const text = `data: ${JSON.stringify(n)}\n\n`;
    for (const s of this.stroeme) s.write(text);
  }

  // Studio S1: ein Ordner je Strom (1 Drums, 2 Bass, 3 Melodie). Strom 1 behält den alten Ordner, 2 und 3 hängen die
  // Nummer an (…/erzeuger2). Dateinamen im Ordner bleiben (strom1.js historisch; der Ordner bestimmt den Strom).
  private musterOrdner(strom = 1): string {
    const basis = this.opt.musterOrdner ?? musterOrdnerVorgabe();
    return strom === 1 ? basis : `${basis}${strom}`;
  }
  private static strom(x: unknown): number | null {
    const n = x === undefined || x === null || x === '' ? 1 : Number(x);
    return [1, 2, 3].includes(n) ? n : null;
  }

  // AUFTRAG 2026-09-28: zwei Beat-FX-Einheiten, drei Parameter; zuweisbar sind die fünf Kanäle und der Master.
  private static readonly FX_ZUWEISUNG_KANAL = ['deck/1', 'deck/2', 'erz/1', 'erz/2', 'erz/3', 'pad/1', 'pad/2', 'master'];
  private static readonly FX_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16];
  private fx(d: Record<string, unknown>, a: http.ServerResponse): void {
    const anteil = (x: unknown) => typeof x === 'number' && x >= 0 && x <= 1;
    if (d.einheit !== 1 && d.einheit !== 2) return this.json(a, 400, { fehler: 'einheit' });
    if (typeof d.art !== 'number' || !(Number.isInteger(d.art) && d.art >= 1 && d.art <= 12)) return this.json(a, 400, { fehler: 'art' });
    if (typeof d.beats !== 'number' || !Oberflaeche.FX_BEATS.includes(d.beats)) return this.json(a, 400, { fehler: 'beats' });
    if (!anteil(d.wet) || !anteil(d.param1) || !anteil(d.param2) || !anteil(d.param3)) return this.json(a, 400, { fehler: 'wet_param' });
    if (typeof d.an !== 'boolean') return this.json(a, 400, { fehler: 'an' });
    const felder = { id: Number(++this.id), quelle: this.quelle(), einheit: d.einheit, art: d.art, beats: d.beats, wet: d.wet, param1: d.param1, param2: d.param2, param3: d.param3, an: d.an ? 1 : 0 };
    this.kern.sende('/k/fx', felder);
    this.angefasst.add(`fx:${d.einheit}`);
    this.fxVon(d.einheit as 1 | 2, this.quelle() as 'andreas' | 'cypher');
    this.gesendet++;
    this.json(a, 200, { ok: true, felder });
  }
  // Plan Hand T7 (Review M3): Cyphers FX nur bei AUTO an und ohne Stop Cypher (der Kern nimmt /k/fx auch gestoppt an)
  private fxRiegel(a: http.ServerResponse): boolean {
    if (this.quelle() !== 'cypher') return false;
    if (this.kiGestoppt) { this.json(a, 409, { fehler: 'ki_gestoppt' }); return true; }
    if (!leseMusterStand(this.musterOrdner()).autonom) { this.json(a, 409, { fehler: 'auto_aus' }); return true; }
    return false;
  }
  // Ohr T18: /k/fx/routing an den Kern; gibt die Kennung zurück
  private fxRoutingSenden(routing: 'post_fader' | 'insert', quelle: string): { id: number; quelle: string; routing: number } {
    const felder = { id: Number(++this.id), quelle, routing: routing === 'insert' ? 1 : 0 };
    this.kern.sende('/k/fx/routing', felder);
    this.gesendet++;
    return felder;
  }
  private fxZuweisung(d: Record<string, unknown>, a: http.ServerResponse): void {
    if (d.einheit !== 1 && d.einheit !== 2) return this.json(a, 400, { fehler: 'einheit' });
    if (typeof d.kanal !== 'string' || !Oberflaeche.FX_ZUWEISUNG_KANAL.includes(d.kanal)) return this.json(a, 400, { fehler: 'kanal' });
    if (typeof d.an !== 'boolean') return this.json(a, 400, { fehler: 'an' });
    const felder = { id: Number(++this.id), quelle: this.quelle(), einheit: d.einheit, kanal: d.kanal, an: d.an ? 1 : 0 };
    this.kern.sende('/k/fx/zuweisung', felder);
    this.angefasst.add(`fx:${d.einheit}`);
    this.fxVon(d.einheit as 1 | 2, this.quelle() as 'andreas' | 'cypher');
    this.gesendet++;
    this.json(a, 200, { ok: true, felder });
  }

  // Wer eine Einheit zuletzt gesetzt hat (fx_von.json im Muster-Ordner, je Einheit ein Schlüssel "1"/"2"): die
  // Seite schreibt andreas, djk-fx (Slice 4) cypher.
  private fxVon(einheit: 1 | 2, von?: 'andreas' | 'cypher'): string | null {
    const datei = path.join(this.musterOrdner(), 'fx_von.json');
    let stand: Record<string, { von: string; zeit: number }> = {};
    try { stand = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { /* noch keine Datei */ }
    if (von) {
      stand[String(einheit)] = { von, zeit: Date.now() };
      try { fs.mkdirSync(this.musterOrdner(), { recursive: true }); fs.writeFileSync(datei, JSON.stringify(stand)); } catch { /* ohne Datei: AUTO aus lässt sie stehen */ }
      return von;
    }
    return stand[String(einheit)]?.von ?? null;
  }

  // AUTO aus (Andreas 2026-09-28: „effekte laufen besser immer aus“): je Einheit klingt ein laufender, von Cypher
  // gesetzter Effekt aus; einen von Andreas gesetzten fasst das nicht an. Beide Einheiten unabhängig geprüft.
  private fxCypherAuslaufen(): void {
    for (const einheit of [1, 2] as const) {
      const f = this.stand.fx[einheit - 1] as Record<string, unknown> | null;
      if (!f || f.an !== 1 || this.fxVon(einheit) !== 'cypher') continue;
      const felder = { id: Number(++this.id), quelle: this.quelle(), einheit, art: f.art, beats: f.beats, wet: f.wet, param1: f.param1, param2: f.param2, param3: f.param3, an: 0 };
      this.kern.sende('/k/fx', felder);
      this.gesendet++;
      this.opt.log?.({ typ: 'fx_auslaufen', einheit });
    }
  }

  // ---------- Plan E9: Deck-Bedienung (Sprung, Hotcues SHOT/LOOP, Loop) über /k/deck/* mit Quelle andreas ----------
  // Review E9 F3: je Instanz ein eigener Ordner (Prüfinstanz in /dev/shm wie die Loops), sonst teilen Prüfung und Betrieb
  private hotcueOrdner(): string { return this.opt.hotcueOrdner ?? hotcueOrdnerVorgabe(); }
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
  private zieheGeladenNach(z: Record<string, unknown>): void {
    const n = String(z.deck), g = this.stand.geladen[n] as Record<string, unknown> | undefined;
    if (!g) return;
    const seit = this.geladenSeit[n] ?? { vorher: null, bestaetigt: true }, kz = Oberflaeche.deckSchluessel(z), leer = !(Number(z.status) >= 1);
    if (kz === Oberflaeche.deckSchluessel(g)) {
      if (leer) { delete this.stand.geladen[n]; delete this.geladenSeit[n]; } else this.geladenSeit[n] = { vorher: null, bestaetigt: true };
      return;
    }
    if (!seit.bestaetigt && kz === seit.vorher) return;                   // noch das vorige Material: das neue Laden gilt
    if (leer) { delete this.stand.geladen[n]; delete this.geladenSeit[n]; return; }
    this.stand.geladen[n] = { deck: z.deck, material_id: z.material_id, basis_bpm: z.basis_bpm, fassung: z.fassung } as Felder;
    this.geladenSeit[n] = { vorher: null, bestaetigt: true };
  }

  private rasterFassung(deck: number): Fassung | null {
    if (deck !== 1 && deck !== 2) return null;
    const z = this.stand.decks[String(deck)] as Record<string, unknown> | undefined;
    const g = this.stand.geladen[String(deck)] as Record<string, unknown> | undefined;
    const fassung = (x: Record<string, unknown>): Fassung => ({ material_id: String(x.material_id), basis_bpm: Number(x.basis_bpm), fassung: Number(x.fassung) });
    if (g && (!z || String(z.material_id) !== String(g.material_id))) return fassung(g);
    return z && Number(z.status) >= 1 ? fassung(z) : null;
  }

  // Kern-Stand eines geladenen Decks (1, 2): /zustand/deck, /uhr, Fassung und ihre Takt-Eins. null: nicht bedienbar.
  private deckStand(deck: unknown): { deck: number; z: Record<string, unknown>; beat: number; bpm: number; f: Fassung; eins: number; erster: number } | null {
    if (deck !== 1 && deck !== 2) return null;
    const z = this.stand.decks[String(deck)] as Record<string, unknown> | undefined;
    const u = this.kern.uhr;
    if (!z || !u || !(Number(z.status) >= 1)) return null;
    const f: Fassung = { material_id: String(z.material_id), basis_bpm: Number(z.basis_bpm), fassung: Number(z.fassung) };
    const schluessel = `${f.material_id}|${f.basis_bpm}|${f.fassung}`;
    let e = this.einsCache.get(schluessel);
    if (e === undefined) {
      try {
        const q = fassungQuelle(this.opt.bestand, f.material_id, f.basis_bpm, f.fassung);
        const j = JSON.parse(fs.readFileSync(path.join(path.dirname(q.datei), 'fassung.json'), 'utf8')) as Record<string, unknown>;
        e = { eins: Number(j.erste_eins_quell_beat) || 0, erster: Number(j.erster_schlag_frame) || 0 };
      } catch { e = { eins: 0, erster: 0 }; }
      this.einsCache.set(schluessel, e);
    }
    return { deck, z, beat: u.beat, bpm: u.bpm, f, eins: e.eins, erster: e.erster };
  }

  // Ziel-Beat (D3): jetzt + Vorlauf (vorlauf_ms, mindestens 0,1 Beat: /uhr ist bis zu einem Zyklus alt), aufs Raster.
  // Review E9 F1: ein stehendes Deck wartet nicht auf die Rasterstelle (dort rastet nur das Ziel ein); sonst drückt
  // Andreas in der Wartezeit Play, und das für das stehende Deck gerechnete Delta landet daneben.
  private zeitRaster(st: { z: Record<string, unknown> }, raster: number): number { return Number(st.z.status) >= 2 ? raster : 0; }
  private deckAb(st: { z: Record<string, unknown>; beat: number; bpm: number }, raster: number): number {
    const vorlauf = Math.max(Number(st.z.vorlauf_ms ?? 0) / 1000 * st.bpm / 60, 0.1);
    return abBeat(st.beat, vorlauf, this.zeitRaster(st, raster));
  }

  private deckTeil(adresse: string, st: { deck: number; z: Record<string, unknown> }, ab: number, raster: number, extra: Record<string, unknown>): Record<string, unknown> {
    const r = this.zeitRaster(st, raster);
    const felder = { id: Number(++this.id), quelle: this.quelle(), plan: this.planVon(), gruppe: '', hoerschein: '', deck: st.deck, ab_beat: ab,
      ...extra, politik: r > 0 ? 2 : 1, raster_beats: r > 0 ? r : 0 };
    this.kern.sende(adresse, felder);
    this.gesendet++;
    return felder;
  }

  private rasterAus(d: Record<string, unknown>): number | null {
    const r = d.raster ?? 0;
    return typeof r === 'number' && (RASTER_WAHL as readonly number[]).includes(r) ? r : null;
  }

  // Sprung (D4): {deck, ziel (Quell-Beat) | delta, raster}
  private deckSprung(d: Record<string, unknown>, a: http.ServerResponse): void {
    const raster = this.rasterAus(d);
    if (raster === null) return this.json(a, 400, { fehler: 'raster' });
    if (d.deck !== 1 && d.deck !== 2) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
    const st = this.deckStand(d.deck);
    if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
    const ab = this.deckAb(st, raster);
    let delta: number;
    if (typeof d.ziel === 'number' && Number.isFinite(d.ziel)) {
      delta = sprungDelta({ laeuft: Number(st.z.status) >= 2, quell: Number(st.z.quell_beat), beat: st.beat, ab, ziel: d.ziel, raster, eins: st.eins });
    } else if (typeof d.delta === 'number' && Number.isFinite(d.delta)) {
      delta = d.delta;
    } else {
      return this.json(a, 400, { fehler: 'ziel_oder_delta' });
    }
    // Der Kern verschiebt einen scharfen Loop beim Sprung mit (kern_deck.cpp art 6: loop_a += llround(delta · fpb), deck.cpp springe);
    // das Loop-Gedächtnis zieht um dasselbe Delta nach (llround(delta · fpb) / fpb, wie der Kern in Frames rechnet). Lehnt der Kern ab
    // (ausserhalb_bereich: der Loop ginge aus dem Material), bleibt sein Loop stehen: dann Rücknahme.
    const l = this.loopVon(st) ? this.aktiverLoop[String(st.deck)] : undefined;
    let schritt = 0;
    if (l) {
      const fpb = 48000 * 60 / st.f.basis_bpm;
      schritt = Math.round(delta * fpb) / fpb;
      this.setzeAktivenLoop(st.deck, { ...l, start: l.start + schritt });
    }
    const felder = this.deckTeil('/k/deck/sprung', st, ab, raster, { delta_beats: delta });
    if (l) {
      void this.warteQuittung(Number(felder.id), ab).then((q) => {
        const jetzt = this.aktiverLoop[String(st.deck)];
        if (q && q.status === 6 && jetzt) this.setzeAktivenLoop(st.deck, { ...jetzt, start: jetzt.start - schritt });
      });
    }
    this.json(a, 200, { ok: true, felder });
  }

  // Hörbares Ziehen (2026-10-17): {deck, phase 0 los | 1 Griff | 2 Zug, delta (Quell-Beats seit dem Griff)}. Der Kern liest das Material
  // an der Handposition; der Strom (~60 Hz) wird nicht quittiert und nicht gezählt, nur gesendet.
  private deckScrub(d: Record<string, unknown>, a: http.ServerResponse): void {
    if (d.deck !== 1 && d.deck !== 2) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
    if (d.phase !== 0 && d.phase !== 1 && d.phase !== 2) return this.json(a, 400, { fehler: 'phase' });
    if (typeof d.delta !== 'number' || !Number.isFinite(d.delta) || Math.abs(d.delta) > 100000) return this.json(a, 400, { fehler: 'delta' });
    const felder = { id: Number(++this.id), quelle: this.quelle(), deck: d.deck, phase: d.phase, delta_beats: d.delta };
    this.kern.sende('/k/deck/scrub', felder);
    this.json(a, 200, { ok: true });
  }

  private static readonly LOOP_LAENGEN = [1, 2, 4, 8, 16];
  // Zuletzt an den Kern geschickter Deck-Loop je Deck (Quell-Beat des Starts, Länge), für „leeres Pad im Loop = Loop-Cue“.
  // Läuft das Deck, liegt der Start bei ab_beat: quell + (ab − beat) (Faktor 1 im Direktweg, wie sprungDelta).
  private aktiverLoop: Record<string, { schluessel: string; start: number; laenge: number }> = {};
  // Loop aktiv: läuft darin (Status 3) oder scharf bei stehendem Deck (der Kern meldet dann beats_bis_ende null, Instanz i)
  private static loopScharf(z: Record<string, unknown>): boolean {
    return Number(z.status) === 3 || (Number(z.status) >= 1 && z.beats_bis_ende === Infinity);   // Kern: im Loop INFINITY (deck.cpp)
  }
  private loopVon(st: { deck: number; z: Record<string, unknown>; f: Fassung }): { start: number; laenge: number } | null {
    const l = this.aktiverLoop[String(st.deck)];
    return l && l.schluessel === Oberflaeche.fassungSchluessel(st.f) && Oberflaeche.loopScharf(st.z) ? { start: l.start, laenge: l.laenge } : null;
  }
  private merkeLoop(st: { deck: number; z: Record<string, unknown>; beat: number; f: Fassung }, ab: number, laenge: number): void {
    if (!(laenge > 0)) { delete this.aktiverLoop[String(st.deck)]; this.sichereAktiveLoops(); return; }
    const q = Number(st.z.quell_beat), start = Number(st.z.status) >= 2 ? q + (ab - st.beat) : q;
    this.setzeAktivenLoop(st.deck, { schluessel: Oberflaeche.fassungSchluessel(st.f), start, laenge });
  }
  private setzeAktivenLoop(deck: number, l: { schluessel: string; start: number; laenge: number }): void {
    this.aktiverLoop[String(deck)] = l;
    this.sichereAktiveLoops();
  }
  // Der gemerkte Loop liegt auf Platte neben den Hotcues (Andreas 2026-09-28: nach einem Neustart des Seiten-Servers
  // kannte das Pad den laufenden Loop nicht mehr). Gültig bleibt er nur, solange der Kern ihn noch hält (loopVon).
  private aktiveLoopsDatei(): string { return path.join(this.hotcueOrdner(), 'aktive_loops.json'); }
  private sichereAktiveLoops(): void {
    try {
      fs.mkdirSync(this.hotcueOrdner(), { recursive: true });
      const tmp = `${this.aktiveLoopsDatei()}.${process.pid}.neu`;
      fs.writeFileSync(tmp, JSON.stringify(this.aktiverLoop));
      fs.renameSync(tmp, this.aktiveLoopsDatei());
    } catch (err) { this.opt.log?.({ typ: 'aktive_loops_nicht_gesichert', text: (err as Error).message }); }
  }
  ladeAktiveLoops(): void {
    try { this.aktiverLoop = JSON.parse(fs.readFileSync(this.aktiveLoopsDatei(), 'utf8')); } catch { this.aktiverLoop = {}; }
  }
  private deckLoop(d: Record<string, unknown>, a: http.ServerResponse): void {
    const raster = this.rasterAus(d);
    if (raster === null) return this.json(a, 400, { fehler: 'raster' });
    if (d.deck !== 1 && d.deck !== 2) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
    if (typeof d.laenge !== 'number' || !(d.laenge === 0 || Oberflaeche.LOOP_LAENGEN.includes(d.laenge))) return this.json(a, 400, { fehler: 'laenge' });
    const st = this.deckStand(d.deck);
    if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
    const ab = this.deckAb(st, raster);
    // behalte_start (Längenknöpfe, Traktor): bei scharfem Loop nur die Länge ändern, der Start bleibt (/k/deck/loop_laenge, Kern setzt
    // den Loop bei start_beat statt am Kopf). Ohne gemerkten scharfen Loop (oder Länge 0) der gewöhnliche Weg.
    const alt = d.behalte_start === true && d.laenge > 0 && this.loopVon(st) ? this.aktiverLoop[String(st.deck)] : undefined;
    if (alt) {
      this.setzeAktivenLoop(st.deck, { ...alt, laenge: d.laenge });
      const felder = this.deckTeil('/k/deck/loop_laenge', st, ab, raster, { start_beat: alt.start, laenge_beats: d.laenge });
      void this.warteQuittung(Number(felder.id), ab).then((q) => {   // abgelehnt (Loop ginge aus dem Material): der alte Loop läuft weiter
        if (q && q.status === 6) this.setzeAktivenLoop(st.deck, alt);
      });
      return this.json(a, 200, { ok: true, felder });
    }
    // Loop-Raster (Plan 2026-10-21): mit Raster setzt der Server den Start selbst auf das Track-Raster (L1/L2) und schickt ihn als
    // festen Start (/k/deck/loop_laenge, Kern art 5 mit quell_beat); lehnt der Kern ab, gilt wieder der vorige Loop (L4).
    const imLauf = Number(st.z.status) === 3 || Number(st.z.status) === 4;   // im Loop/Roll: den gewickelten Kopf kennt nur der Kern (L2b)
    if (d.laenge > 0 && raster > 0 && !imLauf) {
      // Sofort (nur Vorlauf), nicht auf die Rasterstelle des Masters: der Start liegt schon auf dem Track-Raster, das Warten kostete bei
      // Takt-Raster bis zu 4 Beats (Andreas 21.10.: „der loop knopf reagiert nur verzögert“). Liegt der Start bis zu ½ Beat vor dem Kopf,
      // läuft der Kopf in den Loop hinein.
      const jetzt = this.deckAb(st, 0);
      const start = loopStart({ laeuft: Number(st.z.status) >= 2, quell: Number(st.z.quell_beat), beat: st.beat, ab: jetzt, raster, eins: st.eins });
      const vorher = this.aktiverLoop[String(st.deck)];
      this.setzeAktivenLoop(st.deck, { schluessel: Oberflaeche.fassungSchluessel(st.f), start, laenge: d.laenge });
      const felder = this.deckTeil('/k/deck/loop_laenge', st, jetzt, 0, { start_beat: start, laenge_beats: d.laenge });
      void this.warteQuittung(Number(felder.id), jetzt).then((q) => {
        if (!q || q.status !== 6) return;
        if (vorher) this.setzeAktivenLoop(st.deck, vorher);
        else { delete this.aktiverLoop[String(st.deck)]; this.sichereAktiveLoops(); }
      });
      return this.json(a, 200, { ok: true, felder });
    }
    this.merkeLoop(st, ab, d.laenge);   // Raster 0 oder aus: der Kern setzt ab dem Kopf (L3)
    this.json(a, 200, { ok: true, felder: this.deckTeil('/k/deck/loop', st, ab, raster, { laenge_beats: d.laenge }) });
  }

  // POST /deck/loop/sichern {deck, box?}: aktiver Deck-Loop → Loop der Bibliothek (Ausschnitt der Fassung wie der Kern ihn
  // spielt: schlag0 = erster_schlag_frame + Grid-Versatz), Name a|b-HHMMSS-<beats>b; mit box gleich /k/loop/laden
  private deckLoopSichern(d: Record<string, unknown>, a: http.ServerResponse): void {
    if (d.deck !== 1 && d.deck !== 2) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
    if (d.box !== undefined && d.box !== 1 && d.box !== 2) return this.json(a, 400, { fehler: 'unbekannte_box' });
    // Plan Glanz 1.3 (Review B1): der Deck-Schnitt ist nie Cyphers Mitschnitt; in eine offene oder von Cyphers Rampe befahrene Box
    // tauscht der Kern ihn auch mitten im Lauf. Vor dem Schreiben der Datei sperren; Andreas nie.
    if ((d.box === 1 || d.box === 2) && this.quelle() === 'cypher' && this.boxBelegt(d.box)) {
      return this.json(a, 409, { fehler: 'box_offen_oder_faehrt', text: 'loop box is open or my pad ramp is running; a deck cut would play unheard material' });
    }
    const st = this.deckStand(d.deck);
    if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
    const l = this.loopVon(st);
    if (!l) return this.json(a, 409, { fehler: 'kein_loop' });
    const fpb = 48000 * 60 / st.f.basis_bpm;
    const start = Math.round(st.erster + this.rasterWert(st.deck, st.f).versatz_frames + l.start * fpb);
    const jetzt = new Date(), z = (n: number) => String(n).padStart(2, '0');
    const name = `${d.deck === 1 ? 'a' : 'b'}-${z(jetzt.getHours())}${z(jetzt.getMinutes())}${z(jetzt.getSeconds())}-${l.laenge}b`;
    try {
      const q = fassungQuelle(this.opt.bestand, st.f.material_id, st.f.basis_bpm, st.f.fassung);
      schreibeLoopAusFassung({ basis: q.datei, dir: this.loopOrdner(), name, startFrame: start, frames: Math.round(l.laenge * fpb),
        bpm: st.f.basis_bpm, beats: l.laenge, herkunft: { material_id: st.f.material_id, fassung: st.f.fassung, quell_beat: l.start } });
    } catch (err) { return this.json(a, 500, { fehler: 'schreiben', text: (err as Error).message }); }
    this.opt.log?.({ typ: 'deck_loop_gesichert', deck: st.deck, name, start_frame: start });
    if (d.box === 1 || d.box === 2) {
      delete this.loopRasterLive[String(d.box)];
      this.loopLadung[String(d.box)] = { name, quelle: this.quelle() };
      this.angefasst.add(`box:${d.box}`);
      this.kern.sende('/k/loop/laden', { id: Number(++this.id), quelle: this.quelle(), box: d.box, name });
      this.gesendet++;
    }
    this.json(a, 200, { ok: true, name });
  }

  // Hotcues der Fassung; fehlt ihre Datei, die der nächstälteren, auf dieselbe Audio-Stelle verschoben (hotcuesErbe)
  private hotcuesErbeVon(f: Fassung): { hotcues: Record<string, Hotcue>; von: number | null } {
    return hotcuesErbe(this.hotcueOrdner(), f, { fpb: 48000 * 60 / f.basis_bpm,
      esf: (r) => this.einsDerFassung(f.material_id, f.basis_bpm, r)?.esf ?? null,
      rasterV: (r) => this.rasterErbeVon({ ...f, fassung: r }).v });
  }
  // Hotcues (D5, D6): {deck, nr, aktion: setzen|spielen|loeschen, quell_beat?, art?, laenge?, raster}
  private deckHotcue(d: Record<string, unknown>, a: http.ServerResponse): void {
    const raster = this.rasterAus(d);
    if (raster === null) return this.json(a, 400, { fehler: 'raster' });
    if (d.deck !== 1 && d.deck !== 2) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
    if (typeof d.nr !== 'number' || !Number.isInteger(d.nr) || d.nr < 1 || d.nr > 8) return this.json(a, 400, { fehler: 'nr' });
    const st = this.deckStand(d.deck);
    if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
    const datei = hotcueDatei(this.hotcueOrdner(), st.f);
    const alle = this.hotcuesErbeVon(st.f).hotcues;   // neue Fassung ohne eigene Datei: der geerbte Satz wird beim Schreiben ihre eigene
    const setze = (q: number) => {
      this.kern.sende('/k/deck/hotcue_setzen', { id: Number(++this.id), quelle: this.quelle(), deck: st.deck, nr: d.nr, quell_beat: q });
      this.gesendet++;
    };
    if (d.aktion === 'setzen' && d.aus_loop === true) {   // leeres Pad bei laufendem Deck-Loop: genau dieser Loop wird der Cue
      if (!Oberflaeche.loopScharf(st.z)) return this.json(a, 409, { fehler: 'kein_loop' });
      const l = this.loopVon(st);
      // Ohne gemerkten Loop (Seiten-Server neu gestartet, der Kern hält ihn noch): Kopf aufs Raster ab der Eins, Länge der Seite
      const lg = typeof d.laenge === 'number' && Oberflaeche.LOOP_LAENGEN.includes(d.laenge) ? d.laenge : 4;
      const r0 = raster > 0 ? raster : 1, q = Number(st.z.quell_beat);
      const h: Hotcue = l ? { quell_beat: Math.round(l.start * 1000) / 1000, art: 'loop', laenge: l.laenge }
        : { quell_beat: st.eins + r0 * Math.floor((q - st.eins) / r0 + 1e-6), art: 'loop', laenge: lg };
      alle[String(d.nr)] = h;
      schreibeHotcues(datei, alle);
      setze(h.quell_beat);
      return this.json(a, 200, { ok: true, hotcue: h });
    }
    if (d.aktion === 'setzen') {
      const q = typeof d.quell_beat === 'number' && Number.isFinite(d.quell_beat) ? d.quell_beat : Number(st.z.quell_beat);
      const art = d.art === 'loop' ? 'loop' : 'shot';
      if (art === 'loop' && !(typeof d.laenge === 'number' && Oberflaeche.LOOP_LAENGEN.includes(d.laenge))) return this.json(a, 400, { fehler: 'laenge' });
      const h: Hotcue = art === 'loop' ? { quell_beat: rasterRunden(q, raster, st.eins), art, laenge: d.laenge as number }
        : { quell_beat: rasterRunden(q, raster, st.eins), art };
      alle[String(d.nr)] = h;
      schreibeHotcues(datei, alle);
      setze(h.quell_beat);
      return this.json(a, 200, { ok: true, hotcue: h });
    }
    if (d.aktion === 'loeschen') {
      delete alle[String(d.nr)];
      schreibeHotcues(datei, alle);
      setze(NaN);
      return this.json(a, 200, { ok: true });
    }
    if (d.aktion !== 'spielen') return this.json(a, 400, { fehler: 'aktion' });
    const h = alle[String(d.nr)];
    if (!h) return this.json(a, 400, { fehler: 'leer' });
    const ab = this.deckAb(st, raster);
    const hot = this.deckTeil('/k/deck/hotcue', st, ab, raster, { nr: d.nr });
    // LOOP: gleicher Ziel-Beat, spätere id → der Kern führt den Loop nach dem Hotcue aus (seq)
    const lp = h.art === 'loop' ? this.deckTeil('/k/deck/loop', st, ab, raster, { laenge_beats: h.laenge ?? 4 }) : null;
    if (lp) this.setzeAktivenLoop(st.deck, { schluessel: Oberflaeche.fassungSchluessel(st.f), start: h.quell_beat, laenge: h.laenge ?? 4 });
    this.json(a, 200, { ok: true, felder: hot, loop: lp });
  }

  private hotcuesAus(deck: number, a: http.ServerResponse): void {
    const st = this.deckStand(deck);
    if (!st) return this.json(a, 200, {});
    this.json(a, 200, this.hotcuesErbeVon(st.f).hotcues);
  }

  // Nach /e/geladen (und nach einem Kern-Neustart) die gespeicherten Hotcues der Fassung an den Kern (D5).
  private hotcuesWieder(deck: number, f: Fassung): void {
    if (!f?.material_id) return;
    const { hotcues: alle, von } = this.hotcuesErbeVon(f);
    let n = 0;
    for (const [nr, h] of Object.entries(alle)) {
      if (!Number.isFinite(h?.quell_beat)) continue;
      this.kern.sende('/k/deck/hotcue_setzen', { id: Number(++this.id), quelle: this.quelle(), deck, nr: Number(nr), quell_beat: h.quell_beat });
      this.gesendet++;
      n++;
    }
    if (n > 0) this.opt.log?.({ typ: 'hotcues_wieder', deck, anzahl: n, ...(von !== null ? { geerbt_von: von } : {}) });
  }

  // Plan 2 (Spec E5): Andreas' Muster aus dem Feld. Geprüft und geschrieben NICHT hier, sondern von djk-muster in einem
  // Kindprozess mit denselben Rechten wie der Erzeuger (node --permission, nur lesen in djk und Strudel, schreiben nur im
  // Muster-Ordner) und 2 s Zeitlimit (Plan-Review M3: ein Muster schrieb sonst Dateien, s("bd*1000000") hielt den Server
  // 3,4 s an). Asynchron, damit Griffe und Strom währenddessen weiterlaufen. Fehler → 400 mit Zeile, nichts geschrieben.
  // --als-andreas: das Feld ist Andreas, der AUTO-Schalter gilt nur für Cypher.
  // Review F1: Muster nacheinander prüfen und schreiben, sonst gewinnt bei zwei schnellen PLAY das zuerst gesendete.
  private musterKette: Promise<void> = Promise.resolve();
  private strudel(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    const lauf = this.musterKette.then(() => this.strudelEins(d, a));
    this.musterKette = lauf.catch(() => {});
    return lauf;
  }

  private async strudelEins(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    if (typeof d.text !== 'string') return this.json(a, 400, { fehler: 'kein_text' });
    const strom = Oberflaeche.strom(d.strom);
    if (strom === null) return this.json(a, 400, { fehler: 'strom' });
    // Plan Hand T7 (Review M4): Cypher schreibt als cypher und ohne --als-andreas; djk-muster hält AUTO ein (rc 4)
    const von = this.quelle();
    if (von === 'cypher' && this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
    const ordner = this.musterOrdner(strom);
    fs.mkdirSync(ordner, { recursive: true });   // Review F4: im Kindprozess scheitert das Schreiben in einen neuen Ordner
    const strudel = path.dirname(strudelPakete());
    const r = await new Promise<{ code: number | null; fehler: string; zeitlimit: boolean }>((fertig) => {
      const k = spawn(process.execPath, ['--max-old-space-size=512', '--permission', `--allow-fs-read=${path.join(REPO, 'djk')}`, `--allow-fs-read=${strudel}`,
        `--allow-fs-read=${ordner}`, `--allow-fs-write=${ordner}`, REPO_PFADE.djkMuster,
        '--ziel', path.join(ordner, 'strom1.js'), ...(von === 'cypher' ? ['--von', 'cypher'] : ['--von', 'andreas', '--als-andreas']), '-'], { stdio: ['pipe', 'ignore', 'pipe'] });
      let fehler = '';
      let zeitlimit = false;
      const uhr = setTimeout(() => { zeitlimit = true; k.kill('SIGKILL'); }, STRUDEL_ZEITLIMIT_MS);
      k.stderr.on('data', (b: Buffer) => { if (fehler.length < 4096) fehler += b.toString(); });
      k.on('error', (e) => { fehler += e.message; });
      k.on('close', (code) => { clearTimeout(uhr); fertig({ code, fehler, zeitlimit }); });
      k.stdin.on('error', () => {});
      k.stdin.end(d.text as string);
    });
    if (r.zeitlimit) return this.json(a, 400, { fehler: `Zeile 1: Zeitlimit ${STRUDEL_ZEITLIMIT_MS / 1000} s überschritten` });
    if (r.code === 4 && von === 'cypher') return this.json(a, 409, { fehler: 'auto_aus', text: 'AUTO is off: Andreas holds the pattern' });
    if (r.code === 2) {
      const zeile = r.fehler.split('\n').find((z) => z.startsWith('djk-muster: ')) ?? r.fehler;
      return this.json(a, 400, { fehler: zeile.replace(/^djk-muster: /, '').trim() || 'Zeile 1: unbekannter Fehler' });
    }
    if (r.code !== 0) {   // Review F3: die Fehlerzeile, nicht die letzte Zeile (das ist „Node.js v22…“)
      const zeilen = r.fehler.split('\n').map((z) => z.trim()).filter((z) => z && !/^Node\.js v/.test(z));
      const grund = zeilen.find((z) => /Error|ERR_|djk-muster:/.test(z)) ?? zeilen.pop() ?? `rc ${r.code}`;
      return this.json(a, 400, { fehler: `Zeile 1: Prüfung fehlgeschlagen (${grund.slice(0, 200)})` });
    }
    this.opt.log?.({ typ: 'muster', von, laenge: d.text.length });
    this.json(a, 200, { ok: true });
  }

  private json(a: http.ServerResponse, code: number, daten: unknown): void { sendeJson(a, code, daten); }   // http/transport.ts

  // Browser S6: Loop aus der Mediathek in die Loop-Bibliothek (danach lädt die Seite ihn wie jeden Loop per POST /loop).
  // Rechnen darf nur ein Import zur Zeit und nur mit nice 19 / ionice idle (loop_import.ts); dieselbe Quelle wird nicht doppelt angelegt.
  private async loopAusKatalog(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    try {
      const z = this.katalog.eintrag(String(d.sha ?? ''));
      if (!z) throw new KatalogFehler(404, 'unbekannt');
      if (z.typ !== 'loop') throw new KatalogFehler(409, 'kein_loop');
      if (z.schutz === 'ableton') throw new KatalogFehler(409, 'nur_live');
      if (!z.pfad || !fs.existsSync(z.pfad)) throw new KatalogFehler(409, 'datei_fehlt');
      const beats = beatsVon(z);
      const dir = this.loopOrdner();
      const da = findeImport(dir, z.sha);
      if (da) return this.json(a, 200, { ...da, schon_da: true });
      const t0 = Date.now();
      let naht: Record<string, unknown> = {};
      const name = await importiereLoop({ bericht: (x) => { naht = x; }, pfad: z.pfad, beats, bpm: z.bpm, name: loopNameVon(z.name ?? z.titel ?? 'loop', dir), dir, werkzeug: this.opt.loopWerkzeug,
        herkunft: { quelle: 'mediathek', sha: z.sha, pfad: z.pfad, bpm: z.bpm, takte: z.takte } });
      this.opt.log?.({ typ: 'loop_importiert', name, beats, sha: z.sha, ms: Date.now() - t0, ...naht });
      this.json(a, 201, { name, beats });
    } catch (e) {
      if (e instanceof LoopImportFehler) {
        if (e.code >= 500 || e.code === 422) this.opt.log?.({ typ: 'loop_import_fehler', fehler: e.fehler, text: e.text });
        return this.json(a, e.code, e.text ? { fehler: e.fehler, text: e.text } : { fehler: e.fehler });
      }
      this.katalogFehler(e, a);
    }
  }

  private koerper(q: http.IncomingMessage): Promise<Record<string, unknown>> { return leseKoerper(q); }   // http/transport.ts

  // Plan Hand D4: Quittungen je Befehls-id (Ring 200), damit eine Anfrage von Cypher ihr Ergebnis mitbekommt
  private readonly quittungen = new Map<number, Felder[]>();
  private kiGestoppt = false;
  // Andreas 2026-10-05 (Hommage-Take): ein fester Wert fiel 0,19 Beat in die eigene laufende Fahrt, der Kern lehnte ab.
  // Je Pfad das Ende von Cyphers letzter Fahrt; ein neuer Cypher-Teil beginnt frühestens dort. Andreas' Teile nie.
  // Je Pfad ALLE offenen Cypher-Teile (id, ab, dauer). Gelöscht bei Quittung 4/6/7/8, nach ihrem Ende (nächster Aufruf),
  // bei Stop Cypher, /abbruch und neuem Kern.
  private readonly fahrtEnde = new Map<string, { id: number; ab: number; dauer: number }[]>();
  private setzeKiGestoppt(an: boolean): void {
    const war = this.kiGestoppt;
    this.kiGestoppt = an;
    if (an && !war) this.fahrtEnde.clear();
    // Naht F13: der Kern verwirft bei Stop Cypher Cyphers wartende Loops ohne Echo; ihre Ladung gilt dann nicht mehr.
    if (an && !war) for (const [k, p] of Object.entries(this.loopLadung)) if (p.quelle === 'cypher') delete this.loopLadung[k];
    if (an && !war) void this.cypherSpurenAbbrechen();   // Studio S6 F1: Stop Cypher hält auch Wirt und Muster
  }
  private readonly cypherQuittungen: Felder[] = [];   // die letzten 20 mit Quelle cypher, für /lage
  private merkeQuittung(f: Felder): void {
    if (f.quelle === 'cypher') { this.cypherQuittungen.push(f); if (this.cypherQuittungen.length > 20) this.cypherQuittungen.shift(); }
    const id = Number(f.id), l = this.quittungen.get(id) ?? [];
    if ([4, 6, 7, 8].includes(Number(f.status))) {   // abgelehnt, abgebrochen: das Ende dieser Fahrt gibt es nicht
      for (const [pfad, teile] of this.fahrtEnde) {
        const rest = teile.filter((e) => e.id !== id);
        if (rest.length) this.fahrtEnde.set(pfad, rest); else this.fahrtEnde.delete(pfad);
      }
    }
    l.push(f); this.quittungen.set(id, l);
    if (this.quittungen.size > 200) this.quittungen.delete(this.quittungen.keys().next().value as number);
  }
  // Erste Quittung mit Status ≠ 1 (angenommen). Review Hand M2: Ablehnungen am Start (ki_stopp, regler_beim_menschen …)
  // kommen erst zum ab_beat; darum bis ab_beat + ¼ Beat warten (höchstens 4 s), dann die letzte; null, wenn keine kam.
  private async warteQuittung(id: number, abBeat?: number): Promise<{ status: number; grund: string } | null> {
    const t0 = Date.now();
    for (;;) {
      const l = this.quittungen.get(id);
      const x = l?.find((q) => Number(q.status) !== 1);
      if (x) return { status: Number(x.status), grund: String(x.grund ?? '') };
      const beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat ?? 0;
      const faellig = abBeat === undefined ? Date.now() - t0 >= 400 : beat >= abBeat + 0.25;
      if (faellig || Date.now() - t0 >= 4000) {
        const y = l?.at(-1);
        return y ? { status: Number(y.status), grund: String(y.grund ?? '') } : null;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  // Ziel-Beat der Master-Uhr zur Zeitangabe ab (D2): jetzt + Vorlauf, dann aufs Raster 1/4/16
  private abVon(ab: string): number {
    const u = this.kern.uhr as unknown as { beat: number; bpm: number } | null;
    const beat = u?.beat ?? 0, bpm = u?.bpm ?? 128;
    return abBeat(beat, vorlaufBeats(bpm), AB[ab]);                  // ein Vorlauf (tempo_rampe.ts), derselbe wie im Bereich proj
  }
  // POST /regler {pfad, nach, takte?=0, ab?='takt', form?='s'} → /k/teil (D3); D8 Öffnen-Sperre für cypher
  private async regler(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    const pfad = d.pfad, nach = d.nach, takte = d.takte ?? 0, ab = d.ab ?? 'takt', form = d.form ?? 's';
    if (typeof pfad !== 'string' || !PFAD.test(pfad)) return this.json(a, 400, { fehler: 'pfad' });
    // D1 S2-Integration (Spec 6.22): Spur-Regler ändern sich nur über das Projekt (/proj/aendern, spur_aendern) und über den Rückweg /e/regler
    // mit Halter mensch; PFAD bleibt Vokabular (Vertragstest), aber hier kommt nichts durch, sonst fuhre Cypher am Projekt vorbei.
    if (ueberProjekt(pfad)) return this.json(a, 409, { fehler: 'ueber_projekt', text: pfad.startsWith('spur/')
      ? 'track faders are changed through the project (/proj/aendern, spur_aendern)'
      : 'group and master faders are changed through the project (/proj/aendern: gruppenspur_aendern, master_aendern)' });
    if (typeof nach !== 'number' || !Number.isFinite(nach)) return this.json(a, 400, { fehler: 'nach' });
    if (typeof takte !== 'number' || !(takte >= 0 && takte <= 64)) return this.json(a, 400, { fehler: 'takte' });
    if (typeof ab !== 'string' || !(ab in AB)) return this.json(a, 400, { fehler: 'ab' });
    if (form !== 's' && form !== 'linear') return this.json(a, 400, { fehler: 'form' });
    if (this.quelle() === 'cypher') {
      const st = stromVonZiel(pfad);
      if (st !== null && !leseMusterStand(this.musterOrdner(st)).autonom) return this.json(a, 409, { fehler: 'auto_aus', strom: st, text: 'AUTO is off: Andreas holds this stream' });
    }
    let hoerscheinId = '';
    const padBox = /^pad\/([12])\//.exec(pfad)?.[1];
    const eigenePad = padBox !== undefined && this.boxEigen(Number(padBox));   // wie /loop: eigener Mitschnitt (laufend UND wartend)
    if (this.quelle() === 'cypher' && !eigenePad && oeffnet(this.stand.regler, pfad, nach)) {
      // Ohr T10: nur deck/1|2 kennt Hörscheine (§4.5); erz/* frei seit 2026-09-29, pad/* frei für Cyphers eigenen Mitschnitt (eigenePad, Glanz 1.3).
      const m = /^(deck\/[12])\//.exec(pfad);
      const kanal = m ? m[1] : null;
      const deckNr = kanal ? Number(kanal.split('/')[1]) : null;
      const st = deckNr ? this.deckStand(deckNr) : null;
      const inhalt = st ? `${st.f.material_id}/${Math.round(st.f.basis_bpm * 1000)}_r${st.f.fassung}` : '';
      const beat = this.kern.uhr?.beat ?? 0;
      const schein = kanal ? this.hoerscheinstelle.gueltig(kanal, inhalt, beat) : null;
      if (!schein) {
        const letzterSchein = deckNr ? this.hoerscheinstelle.letzter(deckNr) : null;
        return this.json(a, 409, { fehler: 'kein_hoerschein', text: 'channel is closed; opening needs a valid hearing check (Ohr)',
          urteil: letzterSchein?.urteil ?? null, gruende: letzterSchein?.gruende ?? [] });
      }
      hoerscheinId = schein.hs_id;
    }
    let abBeat = this.abVon(ab), verschobenAuf: number | undefined;
    const id = Number(++this.id);
    if (this.quelle() === 'cypher') {
      const beat = this.kern.uhr?.beat ?? 0;
      const offen = (this.fahrtEnde.get(pfad) ?? []).filter((e) => e.ab + e.dauer >= beat);   // Abgelaufenes räumt sich hier ab
      const frei = ersterFreierBeat(offen, abBeat, takte * 4);
      if (frei !== abBeat) { abBeat = frei; verschobenAuf = frei; }
      offen.push({ id, ab: abBeat, dauer: takte * 4 });
      this.fahrtEnde.set(pfad, offen);
    }
    // Keylock 3b (NITPICK): der Knopf mit Politik 1 (zu spät -> sofort ausgeführt, Quittung 5 statt 4 zu_spaet)
    const felder = { id, quelle: this.quelle(), plan: this.planVon(), teil: 0, pfad, ab_beat: abBeat,
      dauer_beats: takte * 4, nach, form: form === 's' ? 1 : 0, politik: pfad === 'keylock' || pfad === 'color/art' ? 1 : 0, gruppe: '', hoerschein: hoerscheinId };
    this.kern.sende('/k/teil', felder);
    this.gesendet++;
    this.json(a, 200, { ok: true, felder, ...(verschobenAuf !== undefined ? { verschoben_auf: verschobenAuf } : {}),
      quittung: await this.warteQuittung(felder.id, verschobenAuf !== undefined ? undefined : felder.ab_beat) });   // verschoben: nur das kurze Fenster (Sofort-Ablehnungen des Kerns), nicht bis zum Startbeat
  }

  // Studio S6: laufende Automationsspuren (Name → Lauf) und die fahrbaren Surge-Parameter (surge_bereiche.json)
  private readonly spuren = new Map<string, SpurLauf>();
  private readonly fahrbar: Set<string> = (() => {
    try { return new Set(Object.keys(JSON.parse(fs.readFileSync(REPO_PFADE.surgeBereiche, 'utf8')).parameter)); }
    catch { return new Set<string>(); }
  })();

  private wirtBasis(): string { return this.opt.wirtOrdner ?? wirtOrdnerVorgabe(); }
  private wirtSock(gruppe: string): string { return path.join(this.wirtBasis(), `wirt-${gruppe}.sock`); }

  // F2: laufende Spuren überstehen den Neustart des Seiten-Servers. Nach jeder Änderung atomar nach <wirtBasis>/spuren.json
  // (tmpfs wie die Wirt-Sockets); beim Start geladen. Abgelaufene Spuren räumt spurenAufraeumen ab, sobald die Uhr da ist.
  private spurenSichern(): void {
    const datei = path.join(this.wirtBasis(), 'spuren.json');
    const daten = [...this.spuren].map(([name, l]) => ({ name, quelle: l.quelle, anker: l.anker, ende: l.ende, fahrten: l.fahrten, gruppen: [...l.gruppen],
      ids: l.ids, teile: l.teile, muster: l.offen }));
    try {
      fs.mkdirSync(this.wirtBasis(), { recursive: true });
      const tmp = `${datei}.${process.pid}.neu`;
      fs.writeFileSync(tmp, JSON.stringify(daten));
      fs.renameSync(tmp, datei);
    } catch (e) { this.opt.log?.({ typ: 'spuren_sichern_fehler', fehler: (e as Error).message }); }
  }

  private spurenLaden(): void {
    let daten: unknown;
    try { daten = JSON.parse(fs.readFileSync(path.join(this.wirtBasis(), 'spuren.json'), 'utf8')); } catch { return; }
    if (!Array.isArray(daten)) return;
    for (const x of daten as Record<string, unknown>[]) {
      if (typeof x?.name !== 'string' || !SPUR_NAME.test(x.name) || this.spuren.has(x.name) || !Number.isFinite(x.anker) || !Number.isFinite(x.ende)) continue;
      const muster = (Array.isArray(x.muster) ? x.muster : []).filter((m: MusterPlan) => Number.isFinite(m?.ab_beat) && typeof m?.text === 'string' && [1, 2, 3].includes(m?.strom));
      const lauf: SpurLauf = { quelle: x.quelle === 'cypher' ? 'cypher' : 'andreas', anker: Number(x.anker), ende: Number(x.ende), fahrten: Array.isArray(x.fahrten) ? x.fahrten as Fahrt[] : [], timer: [], offen: muster,
        gruppen: new Set((Array.isArray(x.gruppen) ? x.gruppen : []).filter((g: unknown) => g === 'bass' || g === 'melodie') as string[]),
        ids: Array.isArray(x.ids) ? x.ids.filter(Number.isFinite) : [], teile: Array.isArray(x.teile) ? x.teile : [] };
      this.spuren.set(x.name, lauf);
      if (lauf.offen.length) this.musterTimer(x.name, lauf);
    }
    if (this.spuren.size) this.opt.log?.({ typ: 'spuren_geladen', anzahl: this.spuren.size });
  }

  // POST /spur {spur, ab?='takt'} (Studio S6): Anker = nächste Takt- bzw. Phrasen-Eins; Kanalzug-Fahrten als /k/teil mit
  // Plan spur:<name> (ein Handgriff bricht sie im Kern ab, /spur/stopp über /k/abbruch). D8 gilt für Cyphers Spur ganz.
  private async spurStart(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    const ab = d.ab ?? 'takt';
    if (ab !== 'takt' && ab !== 'phrase') return this.json(a, 400, { fehler: 'ab', text: 'ab: takt or phrase' });
    const r = pruefeSpur(d.spur, this.fahrbar);
    if ('fehler' in r) return this.json(a, 400, { fehler: 'spur', text: r.fehler });
    // D1 S2-Integration (Spec 6.22, 6.30): Spur-Regler ändern sich nur über das Projekt, auch eine Automationsspur fährt sie nicht
    const ueber = r.spur.fahrten.findIndex((f) => ueberProjekt(f.ziel));
    if (ueber >= 0) {
      return this.json(a, 409, { fehler: 'ueber_projekt', ziel: r.spur.fahrten[ueber].ziel, index: ueber,
        text: r.spur.fahrten[ueber].ziel.startsWith('spur/')
          ? 'track faders are changed through the project (/proj/aendern, spur_aendern), not by an automation track'
          : 'group and master faders are changed through the project (/proj/aendern: gruppenspur_aendern, master_aendern), not by an automation track' });
    }
    this.spurenAufraeumen();
    const quelle = this.quelle(), name = r.spur.name;
    if (quelle === 'cypher' && this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
    if (this.spuren.has(name)) return this.json(a, 409, { fehler: 'laeuft', text: `track ${name} is running; stop it first` });
    const u = this.kern.uhr as unknown as { beat: number; bpm: number; mono_ns: number } | null;
    if (!u) return this.json(a, 409, { fehler: 'keine_uhr' });
    const anker = this.abVon(ab);
    const g = plane(r.spur, anker);
    if (quelle === 'cypher') {
      // F4: AUTO aus auf einem Strom heißt, Andreas hält ihn; Cyphers Spur darf ihn nicht berühren (Kern, Wirt, Muster)
      for (const f of r.spur.fahrten) {
        const st = stromVonZiel(f.ziel);
        if (st !== null && !leseMusterStand(this.musterOrdner(st)).autonom) return this.json(a, 409, { fehler: 'auto_aus', strom: st, ziel: f.ziel, text: 'AUTO is off: Andreas holds this stream' });
      }
      const p = oeffnetKanal(this.stand.regler, g.teile);
      if (p) return this.json(a, 409, { fehler: 'kein_hoerschein', pfad: p, text: 'this track opens a closed channel; Cypher may not (Plan Hand D8)' });
    }
    const lauf: SpurLauf = { quelle, anker, ende: g.ende_beat, fahrten: r.spur.fahrten, timer: [], offen: [...g.muster], gruppen: new Set(), ids: [], teile: [] };
    this.spuren.set(name, lauf);
    this.spurenSichern();
    // Surge-Fahrten zuerst: scheitert ein Wirt, ist noch nichts beim Kern und die schon belegten Wirte halten an
    for (const w of g.wirt) {
      const befehl: Record<string, unknown> = { befehl: 'fahre', name: w.name, bis: w.bis, dauer: w.dauer_beats * 60 / u.bpm,
        ab: beatZuMono(u, w.ab_beat), spur: name, form: w.form, ...(w.von !== undefined ? { von: w.von } : {}) };
      const antwort = await wirtRuf(this.wirtSock(w.gruppe), befehl);
      if (!antwort.ok) {
        for (const gr of lauf.gruppen) await wirtRuf(this.wirtSock(gr), { befehl: 'halte', spur: name });
        this.spuren.delete(name);
        this.spurenSichern();
        return this.json(a, 409, { fehler: 'wirt', gruppe: w.gruppe, text: String(antwort.fehler ?? '') });
      }
      lauf.gruppen.add(w.gruppe);
      this.opt.log?.({ typ: 'spur_wirt', name, gruppe: w.gruppe, parameter: w.name, ab_beat: w.ab_beat, ab: befehl.ab });
      if (Number(antwort.ersetzt) > 0) this.opt.log?.({ typ: 'spur_wirt_ersetzt', name, gruppe: w.gruppe, parameter: w.name, ersetzt: Number(antwort.ersetzt) });   // F8: eine andere wartende Fahrt ging verloren
    }
    for (const [i, t] of g.teile.entries()) {
      const felder = { id: Number(++this.id), quelle, plan: `spur:${name}`, teil: i, pfad: t.pfad, ab_beat: t.ab_beat,
        dauer_beats: t.dauer_beats, nach: t.nach, form: t.form, politik: t.politik, gruppe: '', hoerschein: '' };
      this.kern.sende('/k/teil', felder);
      this.gesendet++;
      lauf.ids.push(felder.id);
      lauf.teile.push({ id: felder.id, teil: i, pfad: t.pfad });
    }
    if (lauf.offen.length) this.musterTimer(name, lauf);
    this.spurenSichern();
    this.opt.log?.({ typ: 'spur', name, quelle, anker, teile: g.teile.length, wirt: g.wirt.length, muster: g.muster.length });
    const quittung = lauf.ids.length ? await this.warteQuittung(lauf.ids[0], g.teile[0].ab_beat) : null;
    this.json(a, 200, { ok: true, name, anker_beat: anker, anker_takt: Math.floor(anker / 4) + 1, ende_beat: g.ende_beat,
      teile: g.teile.length, wirt: g.wirt.length, muster: g.muster.length, quittung, abgelehnt: this.spurAbgelehnt(lauf) });
  }

  // POST /spur/stopp {name} (Studio S6): wartende und laufende Fahrten der Spur enden am Ist-Wert (/k/abbruch, Wirt halte)
  private async spurStopp(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    const name = d.name;
    if (typeof name !== 'string' || !SPUR_NAME.test(name)) return this.json(a, 400, { fehler: 'name' });
    this.spurenAufraeumen();
    const lauf = this.spuren.get(name);
    if (!lauf) return this.json(a, 404, { fehler: 'keine_spur', name });
    if (this.quelle() === 'cypher' && lauf.quelle !== 'cypher') return this.json(a, 403, { fehler: 'nur_andreas', text: 'this track is Andreas\'s' });
    const { felder, wirt } = await this.spurAbbrechen(name, lauf, this.quelle());
    this.json(a, 200, { ok: true, name, felder, wirt });
  }

  // F5: ein Timer je Spur mit Muster-Fahrten; er schreibt, sobald der Kern-Beat ab_beat − Vorlauf erreicht hat
  private musterTimer(name: string, lauf: SpurLauf): void {
    const zeit = setInterval(() => {
      this.spurenAufraeumen();
      if (this.spuren.get(name) !== lauf) { clearInterval(zeit); return; }
      const beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat;
      if (beat === undefined) return;
      const faellig = faelligeMuster(lauf.offen, beat);
      if (!faellig.length) return;
      lauf.offen = lauf.offen.filter((m) => !faellig.includes(m));
      this.spurenSichern();
      if (!lauf.offen.length) clearInterval(zeit);
      for (const m of faellig) void this.spurMuster(name, lauf, m);
    }, 50);
    zeit.unref();
    lauf.timer.push(zeit);
  }

  // Studio S6: ein Muster der Spur über denselben Weg wie das Strudel-Feld (djk-muster, Musterkette, AUTO-Riegel für cypher)
  private async spurMuster(name: string, lauf: SpurLauf, m: MusterPlan): Promise<void> {
    if (this.spuren.get(name) !== lauf) return;
    const beatVorher = this.kern.uhr?.beat ?? 0;
    const fang = { code: 0, text: '', writeHead(c: number) { this.code = c; return this; }, end(t: string) { this.text = t; } };
    await this.qs.run(lauf.quelle, () => this.strudel({ text: m.text, strom: m.strom }, fang as unknown as http.ServerResponse));
    this.opt.log?.({ typ: 'spur_muster', name, strom: m.strom, ziel_beat: m.ab_beat, beat_vorher: beatVorher,
      beat_nachher: this.kern.uhr?.beat ?? 0, code: fang.code, antwort: fang.text });
  }

  // Eine Spur beenden: aus der Tabelle, Timer weg, /k/abbruch mit ihrem Plan, Wirt halte für ihre Gruppen
  private async spurAbbrechen(name: string, lauf: SpurLauf, quelle: string): Promise<{ felder: Felder; wirt: Record<string, unknown> }> {
    this.spuren.delete(name);
    this.spurenSichern();
    for (const t of lauf.timer) clearTimeout(t);
    const felder = { id: Number(++this.id), quelle, plan: `spur:${name}`, teile: '*' };
    this.kern.sende('/k/abbruch', felder);
    this.gesendet++;
    const wirt: Record<string, unknown> = {};
    for (const gr of lauf.gruppen) wirt[gr] = await wirtRuf(this.wirtSock(gr), { befehl: 'halte', spur: name });
    this.opt.log?.({ typ: 'spur_stopp', name });
    return { felder, wirt };
  }

  // Task 3: Surge-Klänge. Die Python-Logik von djk-klang bleibt (kein Nachbau); der Server spawnt sie ohne Shell.
  // fahre geht NICHT dorthin, sondern als Wirt-Befehl (Spur klang-<gruppe>), damit /abbruch und Stop Cypher es halten können.
  private async klang(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    const aktion = d.aktion;
    const lesend = aktion === 'zeige' || aktion === 'liste';
    if (typeof aktion !== 'string' || !['lade', 'setze', 'fahre', 'zeige', 'speichere', 'hoere', 'liste', 'param', 'params'].includes(aktion)) return this.json(a, 400, { fehler: 'aktion' });
    const gruppe = d.gruppe;
    if (aktion !== 'liste' && (typeof gruppe !== 'string' || !KLANG_GRUPPEN.includes(gruppe))) return this.json(a, 400, { fehler: 'gruppe', text: 'gruppe must be bass or melodie' });
    // Werte mit - vorne läsen djk-klang als Schalter (argparse): abweisen, bevor sie in argv landen
    const text = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 && x.length <= 200 && !x.startsWith('-') && !x.includes('\0') ? x : null);
    const zahl = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const bad = (was: string) => this.json(a, 400, { fehler: 'argument', text: `${was}: required, at most 200 characters, must not start with "-"` });
    const argv: string[] = [];
    if (aktion === 'lade' || aktion === 'speichere') {
      const n = text(d.name);
      if (n === null) return bad('name');
      if (aktion === 'speichere' && !SPUR_NAME.test(n)) return this.json(a, 400, { fehler: 'name', text: 'name must match [a-z0-9_-]{1,32}' });
      argv.push(n);
    } else if (aktion === 'setze') {
      const w = d.werte;
      if (typeof w !== 'object' || w === null || Array.isArray(w) || Object.keys(w).length === 0) return this.json(a, 400, { fehler: 'werte', text: 'werte: {NAME: number, ...}' });
      for (const [k, v] of Object.entries(w)) {
        if (text(k) === null || k.includes('=')) return bad(`werte.${k}`);
        if (zahl(v) === null) return this.json(a, 400, { fehler: 'werte', text: `werte.${k} must be a number` });
        argv.push(`${k}=${v}`);
      }
    } else if (aktion === 'zeige' || aktion === 'liste') {
      if (d.filter !== undefined) { const f = text(d.filter); if (f === null) return bad('filter'); argv.push(f); }
    } else if (aktion === 'hoere') {
      if (d.note !== undefined) {
        const n = zahl(d.note);
        if (n === null || !Number.isInteger(n) || n < 0 || n > 127) return this.json(a, 400, { fehler: 'note', text: 'note: integer 0..127' });
        argv.push(String(n));
        if (d.dauer !== undefined) { const s = zahl(d.dauer); if (s === null || s <= 0 || s > 10) return this.json(a, 400, { fehler: 'dauer', text: 'dauer: seconds, 0..10' }); argv.push(String(s)); }
      } else if (d.dauer !== undefined) return this.json(a, 400, { fehler: 'dauer', text: 'dauer needs note' });
    } else if (aktion === 'param') {   // Baukasten S2: ein Regler eines VST3-Wirts (ParamSteuerung), normiert 0..1, direkt an den Socket wie fahre
      const n = text(d.name), w = zahl(d.wert);
      // nur die acht Knobs von Cypher Modular, nicht Volume oder andere Plugin-Parameter (Review F3)
      if (n === null || !/^Knob [1-8]$/.test(n)) return this.json(a, 400, { fehler: 'name', text: 'name: Knob 1..8' });
      if (w === null || w < 0 || w > 1) return this.json(a, 400, { fehler: 'wert', text: 'wert: number 0..1 (normalized)' });
      if (this.quelle() === 'cypher') { const sperre = this.klangSperre(gruppe as string); if (sperre) return this.json(a, 409, sperre); }
      const r = await wirtRuf(this.wirtSock(gruppe as string), { befehl: 'param', name: n, wert: w });
      return r.ok ? this.json(a, 200, { ok: true }) : this.json(a, 409, { fehler: 'wirt', gruppe, text: String(r.fehler ?? 'wirt refused') });
    } else if (aktion === 'params') {   // Baukasten S2: alle Regler mit Ist-Wert, dazu die Knob-Namen aus dem Graphen (lesend, ohne Riegel)
      const r = await wirtRuf(this.wirtSock(gruppe as string), { befehl: 'params' });
      if (!r.ok) return this.json(a, 409, { fehler: 'wirt', gruppe, text: String(r.fehler ?? 'wirt refused') });
      return this.json(a, 200, { ok: true, params: r.params ?? {}, namen: this.reglerNamen(gruppe as string) });
    } else {   // fahre
      const p = text(d.parameter), ziel = zahl(d.ziel), sek = zahl(d.sekunden), von = d.von === undefined ? undefined : zahl(d.von);
      if (p === null) return bad('parameter');
      if (ziel === null || sek === null || von === null) return this.json(a, 400, { fehler: 'werte', text: 'ziel, sekunden (and von) must be numbers' });
      if (sek < 0 || sek > 600) return this.json(a, 400, { fehler: 'sekunden', text: 'sekunden: 0..600' });
      if (!this.fahrbar.has(p)) return this.json(a, 400, { fehler: 'nicht_fahrbar', parameter: p, text: `${p} is not a continuous parameter; use setze (reloads, audible click)` });
      if (this.quelle() === 'cypher') { const sperre = this.klangSperre(gruppe as string); if (sperre) return this.json(a, 409, sperre); }
      const befehl = { befehl: 'fahre', name: p, bis: ziel, dauer: sek, spur: `klang-${gruppe}`, form: 'linear', ...(von !== undefined ? { von } : {}) };
      const r = await wirtRuf(this.wirtSock(gruppe as string), befehl);
      return r.ok ? this.json(a, 200, { ok: true, ...(r.ersetzt ? { ersetzt: r.ersetzt } : {}) }) : this.json(a, 409, { fehler: 'wirt', gruppe, text: String(r.fehler ?? 'wirt refused') });
    }
    if (!lesend && this.quelle() === 'cypher') { const sperre = this.klangSperre(gruppe as string); if (sperre) return this.json(a, 409, sperre); }
    const inst = instanz();
    const cmd = this.opt.klangBefehl ?? REPO_PFADE.djkKlang;
    const voll = [...(inst ? ['--instanz', inst] : []), ...(aktion === 'liste' ? [] : [gruppe as string]), aktion, ...argv];
    const r = await new Promise<{ code: number | null; out: string; err: string; gekappt: boolean; fehler?: string }>((fertig) => {
      let out = '', err = '', gekappt = false, unten = false;
      const k = spawn(cmd, voll, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
      k.stdout.on('data', (b: Buffer) => { if (out.length + b.length > KLANG_AUS_MAX) { gekappt = true; out += b.toString().slice(0, KLANG_AUS_MAX - out.length); } else out += b; });
      k.stderr.on('data', (b: Buffer) => { if (err.length < KLANG_ERR_MAX) err += b.toString().slice(0, KLANG_ERR_MAX - err.length); });
      k.on('error', (e) => { if (!unten) { unten = true; fertig({ code: null, out, err, gekappt, fehler: e.message }); } });
      k.on('close', (c) => { if (!unten) { unten = true; fertig({ code: c, out, err, gekappt }); } });
    });
    if (r.fehler !== undefined) return this.json(a, 500, { fehler: 'klang_start', text: r.fehler });
    if (r.code === 0) return this.json(a, 200, { ok: true, text: r.out, ...(r.gekappt ? { abgeschnitten: true } : {}) });
    const zeilen = r.err.split('\n').map((z) => z.trim()).filter((z) => z !== '');
    return this.json(a, 400, { fehler: zeilen.at(-1) ?? (r.code === null ? 'timeout' : `exit ${r.code}`), text: r.err });
  }

  // Baukasten S2: regler_namen aus baukasten-<gruppe>.json → {"Knob 1": "Cutoff", …}; ohne Datei, bei kaputtem JSON oder
  // fremden Schlüsseln bleibt der Eintrag weg (der Wirt spielt dann ohnehin den eingebauten Graphen ohne Namen)
  private reglerNamen(gruppe: string): Record<string, string> {
    const namen: Record<string, string> = {};
    try {
      const g = JSON.parse(fs.readFileSync(path.join(this.opt.baukastenOrdner ?? baukastenOrdnerVorgabe(), `baukasten-${gruppe}.json`), 'utf8'));
      for (const [nr, name] of Object.entries(g?.regler_namen ?? {})) {
        if (/^[1-8]$/.test(nr) && typeof name === 'string' && name.length > 0 && name.length <= 40) namen[`Knob ${nr}`] = name;
      }
    } catch { /* keine Datei oder kein JSON: keine Namen */ }
    return namen;
  }

  // Cyphers Riegel für schreibende Klang-Aktionen: Stop Cypher, AUTO des Stroms (bass 2, melodie 3)
  private klangSperre(gruppe: string): Record<string, unknown> | null {
    if (this.kiGestoppt) return { fehler: 'ki_gestoppt' };
    const strom = gruppe === 'bass' ? 2 : 3;
    if (!leseMusterStand(this.musterOrdner(strom)).autonom) return { fehler: 'auto_aus', strom, text: 'AUTO is off for this instance: Andreas holds it' };
    return null;
  }

  // Alle Spuren mit Quelle cypher beenden (Cyphers /abbruch und Stop Cypher); Andreas' Spuren bleiben
  private async cypherSpurenAbbrechen(): Promise<void> {
    this.spurenAufraeumen();
    await Promise.all([...this.spuren].filter(([, l]) => l.quelle === 'cypher').map(([name, l]) => this.spurAbbrechen(name, l, 'cypher')));
    // Task 3: Cyphers Klang-Fahrten (POST /klang fahre) tragen die Spur klang-<gruppe> und stehen in keiner Tabelle; ein fehlender Wirt ist kein Fehler
    await Promise.all(KLANG_GRUPPEN.map((g) => wirtRuf(this.wirtSock(g), { befehl: 'halte', spur: `klang-${g}` }, 1000)));
  }

  // Spuren, deren Ende + 1 Beat im Kern-Beat vorbei ist, fallen aus der Tabelle (Kern-Beat statt Wanduhr: ein
  // Tempowechsel darf eine noch laufende Spur nicht verwaisen lassen)
  private spurenAufraeumen(): void {
    const beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat;
    if (beat === undefined) return;
    let weg = false;
    for (const [name, l] of this.spuren) if (l.ende + 1 < beat) { for (const t of l.timer) clearTimeout(t); this.spuren.delete(name); weg = true; }
    if (weg) this.spurenSichern();
  }

  private spurListe(): Record<string, unknown>[] {
    this.spurenAufraeumen();
    return [...this.spuren].map(([name, l]) => ({ name, quelle: l.quelle, anker_beat: l.anker, ende_beat: l.ende, fahrten: l.fahrten,
      abgelehnt: this.spurAbgelehnt(l) }));
  }

  // Teile der Spur, deren letzte Kern-Quittung ein Fehlstatus ist (GET /spur und Antwort von POST /spur)
  private spurAbgelehnt(l: SpurLauf): { teil: number; pfad: string; status: number; grund: string }[] {
    return l.teile.flatMap((t) => {
      const y = this.quittungen.get(t.id)?.at(-1);
      return y && FEHL_STATUS.has(Number(y.status)) ? [{ teil: t.teil, pfad: t.pfad, status: Number(y.status), grund: String(y.grund ?? '') }] : [];
    });
  }

  // Review Hand M7: Cyphers Befehle tragen plan 'cypher', damit /k/abbruch sie (auch wartende Deck-Teile) trifft
  // Effekt-Sektion Schritt 4 (10 Hz aus dem Ohr-Takt): je laufender Box mit Automation den nächsten Durchgang als /k/teil
  // planen, kurz vor seinem Anfang (Plan loopauto:<box>, Quelle andreas: die Automation gehört dem Loop, nicht Cypher);
  // läuft die Box nicht mehr oder trägt einen anderen Loop, bricht /k/abbruch die offenen Fahrten ab.
  private loopAutoTakt(): void {
    const beat = this.kern.uhr?.beat;
    if (beat === undefined) return;
    for (const b of ['1', '2']) {
      const st = this.stand.loops[b] as { status?: number; name?: string; beats?: number } | undefined;
      const name = st?.status === 3 ? String(st.name ?? '') : '';
      let la = this.loopAuto[b];
      if (la && la.name !== name) { this.loopAutoEnde(b); la = undefined; }
      if (!name) continue;
      if (!la) {
        const beats = Number(st?.beats);
        const auto = leseLoopAutomation(this.loopOrdner(), name);
        if (!auto.length || !(beats > 0)) continue;
        la = this.loopAuto[b] = { name, auto, beats, geplantBis: auto.map(() => -Infinity), teil: 0 };
      }
      for (const [i, s] of la.auto.entries()) {   // je Spur eigene Länge (Durchgänge), eigener Anfang
        const laenge = spurLaenge(s, la.beats);
        const c = naechsterDurchgang(beat, laenge, la.geplantBis[i]);
        if (c === null) continue;
        const erster = la.geplantBis[i] === -Infinity;
        for (const t of planeSpur(s, laenge, c, erster)) {
          this.kern.sende('/k/teil', { id: Number(++this.id), quelle: 'andreas', plan: `loopauto:${b}`, teil: la.teil++, pfad: `pad/${b}/${t.pfad}`,
            ab_beat: t.ab_beat, dauer_beats: t.dauer_beats, nach: t.nach, form: 0, politik: 0, gruppe: '', hoerschein: '' });
          this.gesendet++;
        }
        la.geplantBis[i] = c;
      }
    }
  }
  private loopAutoEnde(b: string): void {
    if (!this.loopAuto[b]) return;
    delete this.loopAuto[b];
    this.kern.sende('/k/abbruch', { id: Number(++this.id), quelle: 'andreas', plan: `loopauto:${b}`, teile: '*' });
    this.gesendet++;
  }

  private planVon(): string { return this.quelle() === 'cypher' ? 'cypher' : ''; }

  // POST /deck/start {deck, ab?='takt', quell_beat?} (Plan Hand T5): synchron zum Master auf den Takt, ab der Takt-Eins der
  // Fassung (oder quell_beat). Politik 0: zu spät heißt verworfen, nicht verschoben. Für cypher auf offenem Deck gesperrt.
  private async deckStartStopp(start: boolean, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    if (d.deck !== 1 && d.deck !== 2) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
    const ab = d.ab ?? (start ? 'takt' : 'jetzt');
    if (typeof ab !== 'string' || !(ab in AB)) return this.json(a, 400, { fehler: 'ab' });
    const st = this.deckStand(d.deck);
    if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
    if (start && this.quelle() === 'cypher' && kanalOffen(this.stand.regler, `deck/${d.deck}`)) {
      return this.json(a, 409, { fehler: 'ziel_ungehoert', text: 'deck is open; starting it plays unheard material' });
    }
    const q = d.quell_beat === undefined ? st.eins : d.quell_beat;
    if (typeof q !== 'number' || !Number.isFinite(q)) return this.json(a, 400, { fehler: 'quell_beat' });
    const basis = { id: Number(++this.id), quelle: this.quelle(), plan: this.planVon(), gruppe: '', hoerschein: '', deck: d.deck, ab_beat: this.abVon(ab) };
    const felder = start ? { ...basis, quell_beat: q, politik: 0 } : { ...basis, politik: 1 };
    this.kern.sende(start ? '/k/deck/start' : '/k/deck/stopp', felder);
    this.gesendet++;
    this.json(a, 200, { ok: true, felder, quittung: await this.warteQuittung(felder.id, felder.ab_beat) });
  }

  // wirt-<gruppe>.json je Klang-Gruppe, null ohne (lesbare) Datei; geteilt von GET /klang und /lage.studio.klang
  private leseWirtMeldungen(): Record<string, unknown> {
    const aus: Record<string, unknown> = {};
    for (const g of KLANG_GRUPPEN) {
      try { aus[g] = JSON.parse(fs.readFileSync(path.join(this.wirtBasis(), `wirt-${g}.json`), 'utf8')); } catch { aus[g] = null; }
    }
    return aus;
  }

  // Task 4: Studio-Zustand für /lage: AUTO und Muster je Strom (Kurzform), geladener Surge-Klang je Gruppe (Name aus wirt-<g>.json)
  private studioLage(): { stroeme: unknown[]; klang: Record<string, string | null> } {
    const stroeme = [1, 2, 3].map((strom) => {
      const m = leseMusterStand(this.musterOrdner(strom));
      return { strom, autonom: m.autonom, von: m.von, text_kurz: m.text.slice(0, 200) };
    });
    const w = this.leseWirtMeldungen(), klang: Record<string, string | null> = {};
    for (const g of KLANG_GRUPPEN) klang[g] = (w[g] as { klang?: unknown } | null)?.klang as string | null ?? null;
    return { stroeme, klang };
  }

  // GET /lage (Plan Hand D5): verdichteter Stand für einen Zug
  private lage(): Record<string, unknown> {
    const u = this.kern.uhr as unknown as { beat: number; bpm: number } | null;
    const beat = u?.beat ?? 0, bestand = leseBestand(this.opt.bestand);
    const decks = [1, 2].map((n) => {
      const z = this.stand.decks[String(n)] as Record<string, unknown> | undefined;
      if (!z) return { deck: n, status: 0 };
      const st = this.deckStand(n), e = bestand.find((x) => x.material_id === z.material_id);
      const l = st ? this.loopVon(st) : null;
      const rel = Number(z.quell_beat) - (st?.eins ?? 0);
      const hs = this.hoerscheinstelle.letzter(n);   // Ohr T10
      return { deck: n, status: z.status, material_id: z.material_id, titel: e?.titel ?? '', camelot: e?.camelot ?? null,
        basis_bpm: z.basis_bpm, faktor: z.faktor, hoerweg: z.hoerweg ?? null,   // Keylock 3b: 1 = Tonhöhe gehalten (Ring), 0 = Varispeed/direkt
        quell_beat: Math.round(Number(z.quell_beat) * 100) / 100, takt_im_track: rel < 0 ? null : Math.floor(rel / 4) + 1,
        beats_bis_ende: z.beats_bis_ende === Infinity ? null : z.beats_bis_ende, loop: l, offen: kanalOffen(this.stand.regler, `deck/${n}`),
        hoerschein: hs ? { urteil: hs.urteil, gueltig_bis_takt: Math.floor(hs.gueltig_bis_beat / 4) + 1, gruende: hs.gruende } : null };
    });
    const regler: Record<string, number | null> = Object.fromEntries(Object.entries(this.stand.regler)
      .filter(([p, w]) => /^(deck\/[12]|pad\/[12]|erz\/[1-3])\/(fader|trim|eq\/|kill\/|filter)|^(xfader|master\/pegel)$/.test(p) || (p in LAGE_ABWEICHEND && w !== LAGE_ABWEICHEND[p]) || (/^(deck\/[12]|pad\/[12]|erz\/[1-3])\/send\/2$/.test(p) && w !== -200) || kompAbweichend(p, w))   // erst abweichend von der Vorgabe sichtbar (K2: Kleber, Duck, Hall-Rückweg und -Send)ar
      .map(([p, w]) => [p, p === 'master/kleber' || p === 'color/param' ? Math.round(w * 100) / 100 : Math.round(w * 10) / 10]));
    // Keylock 3b (Prüfung MINOR 4): der Knopf steht immer da, 1 an, 0 aus, null unbekannt (noch keine Meldung vom Kern; der Kern
    // schickt sie jedem neuen Abonnenten beim ersten /k/hallo)
    regler.keylock = typeof this.stand.regler.keylock === 'number' ? this.stand.regler.keylock : null;
    return { uhr: { beat: Math.round(beat * 100) / 100, takt: Math.floor(beat / 4) + 1, schlag: Math.floor(((beat % 4) + 4) % 4) + 1,
      bpm: u?.bpm ?? null }, ki: { gestoppt: this.kiGestoppt }, decks, regler, boxen: this.stand.loops, fx: this.stand.fx,
      fx_routing: this.stand.fxRouting, quittungen: this.cypherQuittungen.slice(-10), studio: this.studioLage(), ausgang: leseAusgang(this.opt.digitalout) };
  }

  // Plan Hand D1: Quelle je Anfrage. Kopf x-djk-quelle: cypher → jeder Kern-Befehl dieser Anfrage (auch über await)
  // trägt cypher; sonst andreas. Befehle aus Kern-Ereignissen (Wiederherstellen) laufen außerhalb und bleiben andreas.
  private readonly qs = new AsyncLocalStorage<string>();
  private readonly proj: ReturnType<typeof projBereich>;   // D1 S2: Bereich proj (Sitzung schliesst beim Stoppen)
  readonly stems: ReturnType<typeof stemsBereich>;   // 1.13 Slice 6: Bereich proj-stems
  private readonly aufnahme: ReturnType<typeof aufnahmeBereich>;   // 1.8: Bereich proj-aufnahme
  readonly ausgabe: ReturnType<typeof ausgabeBereich>;   // Paket S3: Bereich proj-ausgabe (schliesst beim Stoppen, Fix-Runde R7)
  private readonly router = new Router();   // Plan d1-s1 Task 9: Bereiche melden hier ihre Routen (oberflaeche zuerst, dann proj)
  meldeBereich(b: Bereich): void { this.router.melde(b); }
  routen(): ReturnType<Router['liste']> { return this.router.liste(); }
  // Spec D1 2.10: dünne Fassade für Bereiche; sende nutzt denselben id-Zähler und zählt gesendet wie die Bestandsrouten
  bereichKontext(): BereichKontext {
    return {
      // id kommt nur aus dem gemeinsamen Zähler (eine id in felder wirft); quelle ist die der Anfrage, wenn felder keine tragen
      sende: (adresse, felder) => {
        if ('id' in felder) throw new Error('sende: id vergibt der Server, felder darf keine tragen');
        const id = Number(++this.id);
        this.kern.sende(adresse, { id, quelle: this.quelle(), ...felder } as Felder); this.gesendet++; return id;
      },
      warteQuittung: (id, abBeat) => this.warteQuittung(id, abBeat),
      quelle: () => (this.quelle() === 'cypher' ? 'cypher' : 'andreas'),
      kiGestoppt: () => this.kiGestoppt,
      verteile: (ereignis) => this.verteile(ereignis),
      log: (zeile) => { this.opt.log?.(zeile); },
    };
  }
  private quelle(): string { return this.qs.getStore() ?? 'andreas'; }
  private anfrage(q: http.IncomingMessage, a: http.ServerResponse): Promise<void> {
    return this.qs.run(quelleAusKopf(q), () => this.anfrageInnen(q, a));
  }
  private async anfrageInnen(q: http.IncomingMessage, a: http.ServerResponse): Promise<void> {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = this.router.finde(q.method ?? '', url.pathname);
    if (r) {
      if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, this.opt.port)) return;
      return await r.handler(q, a, url);
    }
    if (q.method === 'GET') return this.datei(url.pathname, a);
    this.json(a, 405, { fehler: 'methode' });
  }

  // Plan d1-s1 Task 9: die frühere if-Kette (bfdd3983 server.ts:1445-1648) als Routentabelle, Reihenfolge unverändert (erster Treffer
  // gewinnt). schutz 'fremdePost' prüft der Router vor dem Handler, nur bei POST (415 vor 403, wie zuvor an jeder Stelle einzeln).
  // Riegel (ki_gestoppt, nur_cypher, nur_andreas, AUTO) bleiben an ihrer Stelle im Handler: ihre Rangfolge hängt am Ort (Karte 01.10.).
  private routenOberflaeche(): Route[] {
    const F = 'fremdePost' as const, O = 'offen' as const;
    return [
      { methode: 'GET', pfad: '/strom', schutz: O, handler: (q, a) => this.strom(q, a) },
      { methode: 'GET', pfad: '/bestand', schutz: O, handler: (_q, a) => this.json(a, 200, leseBestand(this.opt.bestand)) },
      { methode: 'GET', pfad: '/mediathek/anschluss', schutz: O, handler: (_q, a, url) => this.anschlussAus(url, a) },
      { methode: 'GET', pfad: '/mediathek', schutz: O, handler: (_q, a, url) => this.mediathekSuche(url, a) },
      { methode: 'GET', pfad: '/mediathek/vorbereiten', schutz: O, handler: (_q, a, url) => this.vorbereitenStand(url, a) },
      { methode: 'POST', pfad: '/mediathek/vorbereiten', schutz: F, handler: async (q, a) => this.vorbereiten(await this.koerper(q), a) },
      { methode: 'GET', pfad: '/stoebern', schutz: O, handler: (_q, a, url) => (url.searchParams.get('typ') === 'strudel' ? this.stoebernMuster(url, a) : this.stoebern(url, a)) },
      { methode: 'GET', pfad: '/stoebern/detail', schutz: O, handler: (_q, a, url) => this.stoebernDetail(url, a) },
      { methode: 'GET', pfad: '/stoebern/baum', schutz: O, handler: (_q, a, url) => (url.searchParams.get('typ') === 'strudel' ? this.stoebernMusterBaum(a) : this.stoebernBaum(url, a)) },
      { methode: 'POST', pfad: '/muster', schutz: F, handler: (q, a) => this.musterSpeichern(q, a) },
      { methode: 'GET', pfad: '/vorhoeren', schutz: O, handler: async (_q, a) => this.json(a, 200, await this.vorhoeren.stand()) },
      { methode: 'POST', pfad: '/vorhoeren', schutz: F, handler: async (q, a) => this.vorhoerenAus(await this.koerper(q), a) },   // S7: Vorhören als Kern-Eingang
      { methode: 'GET', pfad: '/klaenge/karte', schutz: O, handler: (_q, a) => this.klaengeKarte(a) },
      { methode: 'GET', pfad: '/klaenge', schutz: O, handler: (_q, a, url) => this.klaengeSuche(url, a) },
      { methode: 'GET', pfad: '/mediathek/listen', schutz: O, handler: (_q, a) => { try { return this.json(a, 200, this.mediathek.listen()); } catch (e) { return this.mediathekFehler(e, a); } } },
      { methode: '*', pfad: (p) => p === '/sammlungen' || p.startsWith('/sammlungen/'), schutz: F, handler: (q, a, url) => this.sammlungRoute(q, url, a) },
      { methode: 'GET', pfad: '/konfig', schutz: O, handler: (_q, a) => this.json(a, 200, { leitstand_ws: `ws://127.0.0.1:${this.opt.leitstandWs}/`, ziel_kurve: this.opt.zielKurve ?? ZIEL_KURVE,
        kern_pruefmodus: this.pruefmodus }) },
      { methode: 'POST', pfad: '/griff', schutz: F, handler: async (q, a) => this.griff(await this.koerper(q), a) },   // Riegel 2026-09-30
      { methode: 'GET', pfad: '/lage', schutz: O, handler: (_q, a) => this.json(a, 200, this.lage()) },
      { methode: 'GET', pfad: '/ausgang', schutz: O, handler: (_q, a) => this.json(a, 200, leseAusgang(this.opt.digitalout)) },   // Glanz 2.1 (F22)
      { methode: 'POST', pfad: ['/deck/start', '/deck/stopp'], schutz: F, handler: async (q, a, url) => await this.deckStartStopp(url.pathname === '/deck/start', await this.koerper(q), a) },   // Plan Hand T5
      { methode: 'POST', pfad: '/abbruch', schutz: F, handler: async (_q, a) => {   // Plan Hand T8: Cypher bricht die eigenen Teile ab
        if (this.quelle() !== 'cypher') return this.json(a, 403, { fehler: 'nur_cypher', text: 'Andreas stops Cypher with Stop Cypher' });
        const felder = { id: Number(++this.id), quelle: 'cypher', plan: 'cypher', teile: '*' };
        this.kern.sende('/k/abbruch', felder);
        this.gesendet++;
        this.fahrtEnde.clear();
        await this.cypherSpurenAbbrechen();   // Studio S6: „alle meine Rampen“
        return this.json(a, 200, { ok: true, felder });
      } },
      { methode: 'GET', pfad: '/pegel', schutz: O, handler: (_q, a, url) => {   // Schnappschuss der letzten N Sekunden je Kanal
        const roh = url.searchParams.get('sek');
        const sek = roh === null ? 3 : Number(roh);
        if (roh !== null && !/^\d+$/.test(roh) || !Number.isInteger(sek) || sek < 1 || sek > 10) return this.json(a, 400, { fehler: 'sek', text: 'sek must be an integer 1..10' });
        return this.json(a, 200, { sek, kanaele: this.pegelPuffer.lies(sek) });
      } },
      { methode: 'GET', pfad: '/spur', schutz: O, handler: (_q, a) => this.json(a, 200, this.spurListe()) },
      { methode: 'POST', pfad: ['/spur', '/spur/stopp'], schutz: F, handler: async (q, a, url) => {   // Studio S6
        const d = await this.koerper(q);
        return url.pathname === '/spur' ? await this.spurStart(d, a) : await this.spurStopp(d, a);
      } },
      { methode: 'POST', pfad: '/regler', schutz: F, handler: async (q, a) => await this.regler(await this.koerper(q), a) },   // Plan Hand
      { methode: 'POST', pfad: '/taste', schutz: F, handler: async (q, a) => this.taste(await this.koerper(q), a) },   // Riegel 2026-09-30
      { methode: 'POST', pfad: '/laden', schutz: F, handler: async (q, a) => await this.laden(await this.koerper(q), a) },   // Riegel 2026-09-30
      { methode: 'POST', pfad: '/tempo', schutz: F, handler: async (q, a) => await this.tempo(await this.koerper(q), a) },   // Plan Tempo-Folge: Master-Tempo, Andreas' Hand
      { methode: 'GET', pfad: '/loops', schutz: O, handler: (_q, a) => this.json(a, 200, leseLoops(this.loopOrdner())) },
      { methode: 'POST', pfad: '/loops/aus-katalog', schutz: F, handler: async (q, a) => this.loopAusKatalog(await this.koerper(q), a) },   // Browser S6
      { methode: 'POST', pfad: '/loop', schutz: F, handler: async (q, a) => this.loop(await this.koerper(q), a) },   // Riegel 2026-09-30
      { methode: 'GET', pfad: '/loop/automation', schutz: O, handler: (_q, a, url) => {   // Effekt-Sektion Schritt 4
        const name = url.searchParams.get('name') ?? '';
        if (!LOOP_NAME.test(name) || !leseLoops(this.loopOrdner()).some((l) => l.name === name)) return this.json(a, 404, { fehler: 'kein_loop' });
        return this.json(a, 200, { name, automation: leseLoopAutomation(this.loopOrdner(), name) });
      } },
      { methode: 'POST', pfad: '/loop/automation', schutz: F, handler: async (q, a) => {
        const d = await this.koerper(q);
        const name = String(d.name ?? '');
        const l = LOOP_NAME.test(name) ? leseLoops(this.loopOrdner()).find((x) => x.name === name) : undefined;
        if (!l) return this.json(a, 404, { fehler: 'kein_loop' });
        const r = pruefeAutomation(d.automation, l.beats);
        if ('fehler' in r) return this.json(a, 400, { fehler: 'automation', text: r.fehler });
        schreibeLoopAutomation(this.loopOrdner(), name, r.automation);
        for (const [b, la] of Object.entries(this.loopAuto)) if (la.name === name) this.loopAutoEnde(b);   // neu planen ab dem nächsten Durchgang
        this.opt.log?.({ typ: 'loop_automation', name, spuren: r.automation.length });
        return this.json(a, 200, { ok: true, name, automation: r.automation });
      } },
      { methode: 'GET', pfad: '/loop/raster', schutz: O, handler: (_q, a, url) => {
        const w = this.loopRasterWert(Number(url.searchParams.get('box')));
        return w ? this.json(a, 200, { versatz_frames: w.versatz_frames, gespeichert_frames: w.gespeichert_frames }) : this.json(a, 409, { fehler: 'kein_loop' });
      } },
      { methode: 'GET', pfad: '/deck/hotcues', schutz: O, handler: (_q, a, url) => this.hotcuesAus(Number(url.searchParams.get('deck')), a) },
      { methode: 'GET', pfad: '/deck/loop', schutz: O, handler: (_q, a, url) => {   // aktiver Deck-Loop für die Anzeige, {} ohne
        const st = this.deckStand(Number(url.searchParams.get('deck')));
        const l = st ? this.loopVon(st) : null;
        return this.json(a, 200, l ? { start: Math.round(l.start * 1000) / 1000, laenge: l.laenge } : {});
      } },
      { methode: 'GET', pfad: '/deck/raster', schutz: O, handler: (_q, a, url) => {
        // D1 S3 Auftrag 15: nur an das gebunden, was rasterWert braucht (geladenes Deck mit Fassung), nicht an deckStand (Uhr, /zustand/deck)
        const deck = Number(url.searchParams.get('deck')), f = this.rasterFassung(deck);
        return f ? this.json(a, 200, this.rasterWert(deck, f)) : this.json(a, 409, { fehler: 'kein_kernstand' });   // Form wie bisher (Route-Golden)
      } },
      { methode: 'GET', pfad: '/hoeren', schutz: O, handler: (_q, a, url) => this.hoerenAus(url, a) },
      { methode: 'GET', pfad: '/fx', schutz: O, handler: (_q, a) => this.json(a, 200, this.stand.fx) },   // [FX1, FX2] oder null je Einheit
      { methode: 'GET', pfad: '/fx/zuweisung', schutz: O, handler: (_q, a) => this.json(a, 200, this.stand.fxZuweisung) },
      { methode: 'GET', pfad: '/fx/routing', schutz: O, handler: (_q, a) => this.json(a, 200, { routing: this.stand.fxRouting }) },
      { methode: 'POST', pfad: '/fx/routing', schutz: F, handler: async (q, a) => {   // Ohr T18: Andreas' Taste (Insert oder Post Fader), nie Cyphers
        if (this.quelle() === 'cypher') return this.json(a, 403, { fehler: 'nur_andreas' });   // wie /strudel/autonom (Review M5)
        const d = await this.koerper(q);
        if (d.routing !== 'post_fader' && d.routing !== 'insert') return this.json(a, 400, { fehler: 'routing' });
        const felder = this.fxRoutingSenden(d.routing, 'andreas');
        this.fxRoutingWunsch = d.routing;
        return this.json(a, 200, { ok: true, felder, quittung: await this.warteQuittung(felder.id) });
      } },
      { methode: 'POST', pfad: ['/fx', '/fx/zuweisung'], schutz: F, handler: async (q, a, url) => {
        const d = await this.koerper(q);
        if (this.fxRiegel(a)) return;
        return url.pathname === '/fx' ? this.fx(d, a) : this.fxZuweisung(d, a);
      } },
      { methode: 'POST', pfad: ['/deck/sprung', '/deck/scrub', '/deck/hotcue', '/deck/loop', '/deck/loop/sichern', '/deck/raster', '/deck/raster/fix'], schutz: F, handler: async (q, a, url) => {   // Plan E9
        const d = await this.koerper(q);
        // Review Hand B1 / I3d: Sprung, Hotcue spielen auf einem OFFENEN Deck bringt ungehörten Inhalt; für cypher gesperrt,
        // bis das Ohr Hörscheine ausstellt. Loop ist frei (wiederholt Gehörtes). Andreas' Weg bleibt unberührt.
        if (this.quelle() === 'cypher' && (d.deck === 1 || d.deck === 2) && kanalOffen(this.stand.regler, `deck/${d.deck}`)
          && (url.pathname === '/deck/sprung' || (url.pathname === '/deck/scrub' && d.phase !== 0) || (url.pathname === '/deck/hotcue' && d.aktion === 'spielen'))) {
          return this.json(a, 409, { fehler: 'ziel_ungehoert', text: 'deck is open; jumping there plays unheard material' });
        }
        if (url.pathname === '/deck/sprung') return this.deckSprung(d, a);
        if (url.pathname === '/deck/scrub') return this.deckScrub(d, a);
        if (url.pathname === '/deck/loop') return this.deckLoop(d, a);
        if (url.pathname === '/deck/loop/sichern') return this.deckLoopSichern(d, a);
        if ((url.pathname === '/deck/raster' || url.pathname === '/deck/raster/fix') && this.quelle() === 'cypher') {
          return this.json(a, 403, { fehler: 'nur_andreas' });   // das Grid ist sein Urteil (Review M5)
        }
        if (url.pathname === '/deck/raster') return this.deckRaster(d, a);
        if (url.pathname === '/deck/raster/fix') return this.deckRasterFix(d, a);
        return this.deckHotcue(d, a);
      } },
      { methode: 'GET', pfad: '/strudel', schutz: O, handler: (_q, a, url) => {
        const strom = Oberflaeche.strom(url.searchParams.get('strom'));
        if (strom === null) return this.json(a, 400, { fehler: 'strom' });
        return this.json(a, 200, leseMusterStand(this.musterOrdner(strom)));
      } },
      { methode: 'POST', pfad: ['/strudel', '/strudel/autonom'], schutz: F, handler: async (q, a, url) => {
        if (url.pathname === '/strudel/autonom') {
          if (this.quelle() === 'cypher') return this.json(a, 403, { fehler: 'nur_andreas' });   // sein AUTO-Schalter (Review M5)
          const d = await this.koerper(q);
          if (typeof d.an !== 'boolean') return this.json(a, 400, { fehler: 'an_muss_bool' });
          const strom = Oberflaeche.strom(d.strom);
          if (strom === null) return this.json(a, 400, { fehler: 'strom' });
          setzeAutonom(this.musterOrdner(strom), d.an);
          this.opt.log?.({ typ: 'autonom', an: d.an, strom });
          if (d.an === false && strom === 1) this.fxCypherAuslaufen();   // FX-Riegel hängt an Strom 1 (Plan: unverändert)
          return this.json(a, 200, { ok: true, autonom: d.an });
        }
        return await this.strudel(await this.koerper(q), a);
      } },
      { methode: 'GET', pfad: '/klang', schutz: O, handler: (_q, a) => this.json(a, 200, this.leseWirtMeldungen()) },   // Task 3: was die Wirte gerade melden (wirt-<gruppe>.json), null ohne Datei
      { methode: 'POST', pfad: '/klang', schutz: F, handler: async (q, a) => await this.klang(await this.koerper(q), a) },
      { methode: 'GET', pfad: '/welle', schutz: O, handler: async (_q, a, url) => await this.welleAus(url, a) },
      { methode: 'GET', pfad: '/fassung', schutz: O, handler: (_q, a, url) => this.fassungAus(url, a) },
    ];
  }

  private strom(q: http.IncomingMessage, a: http.ServerResponse): void {
    a.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    a.write(`data: ${JSON.stringify({ a: 'stand', f: { ...this.stand, kern: this.kern.zustand, pruefmodus: this.pruefmodus } })}\n\n`);
    this.stroeme.add(a);
    q.on('close', () => this.stroeme.delete(a));
  }

  // Ein Griff: pfad aus ZIELE, u = midi_roh 0..1. Riegel vor dem Senden: falsches Ziel → 400, nichts an den Kern.
  private griff(d: Record<string, unknown>, a: http.ServerResponse): void {
    if (this.quelle() === 'cypher') return this.json(a, 403, { fehler: 'nur_hand' });   // Plan Hand D1: die Hand ist Andreas
    const pfad = d.pfad;
    const u = d.u;
    const riegel = !(this.opt.mutationen ?? []).includes('riegel_aus');
    if (typeof pfad !== 'string' || (riegel && !ZIELE.has(pfad))) {
      this.opt.log?.({ typ: 'abgelehnt', grund: 'unbekanntes_ziel', pfad });
      return this.json(a, 400, { fehler: 'unbekanntes_ziel', pfad });
    }
    if (typeof u !== 'number' || !(u >= 0 && u <= 1)) {
      this.opt.log?.({ typ: 'abgelehnt', grund: 'ausserhalb_bereich', pfad, u });
      return this.json(a, 400, { fehler: 'ausserhalb_bereich', pfad });
    }
    if (pfad.length > 47) return this.json(a, 400, { fehler: 'unbekanntes_ziel', pfad });
    // Kern ohne Prüfmodus: /test/hand käme nie an. Sichtbar ablehnen statt still 200 (bis 35 hand_osc bringt).
    if (this.pruefmodus === 'aus') {
      this.opt.log?.({ typ: 'abgelehnt', grund: 'pruefmodus_aus', pfad });
      return this.json(a, 409, { fehler: 'pruefmodus_aus', pfad, text: HAND_PRUEFMODUS_TEXT });
    }
    const felder = { pfad, midi_roh: u, sample: this.kern.uhr?.sample ?? 0 };
    this.kern.sende('/test/hand', felder);
    this.gesendet++;
    this.json(a, 200, { ok: true, gesendet: '/test/hand', felder });
  }

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
    // Review Hand B2: im Kern löst die Hand-Taste nur „stopp“ aus (kern_hand.cpp:91), die Freigabe braucht /k/ki/frei
    // (§4.7). Ohne das blieb Stop Cypher eine Einbahnstraße, auch über einen Kern-Neustart.
    if (name === 'freigabe') { this.kern.sende('/k/ki/frei', { id: Number(++this.id), quelle: 'andreas' }); this.gesendet++; }
    this.json(a, 200, { ok: true, gesendet: '/test/hand', felder });
  }

  // Mediathek T2 (Plan 2026-10-03): Suche über die ganze Mediathek (nur lesen) und Vorbereiten durch die Werkstatt.
  // Kein Kern-Befehl in diesen Routen; ins Deck kommt ein vorbereiteter Track wie jeder andere über POST /laden.
  // Anschluss-Vorauswahl (Plan 2026-10-10-anschluss-vorauswahl, T3/T4): material_id oder deck (1|2), energie halten|heben|senken,
  // fenster in Prozent (Vorgabe 6, 1..16), limit (Vorgabe 10).
  private anschlussAus(url: URL, a: http.ServerResponse): void {
    try {
      const p = url.searchParams;
      let mid = p.get('material_id');
      const deck = p.get('deck');
      if (mid && deck) return this.json(a, 400, { fehler: 'material_id_oder_deck' });
      if (!mid && deck) {
        if (deck !== '1' && deck !== '2') return this.json(a, 400, { fehler: 'deck_ungueltig' });
        mid = (this.stand.geladen[deck]?.material_id as string | undefined) ?? null;
        if (!mid) return this.json(a, 409, { fehler: 'deck_leer' });
      }
      if (!mid) return this.json(a, 400, { fehler: 'material_id_oder_deck' });
      const energie = p.get('energie') ?? 'halten';
      if (energie !== 'halten' && energie !== 'heben' && energie !== 'senken') return this.json(a, 400, { fehler: 'energie_ungueltig' });
      const zahlOder = (s: string | null, vorgabe: number): number => { if (s === null || s === '') return vorgabe; const n = Number(s); return Number.isFinite(n) ? n : vorgabe; };
      const fenster = Math.min(16, Math.max(1, zahlOder(p.get('fenster'), 6)));
      const limit = Math.min(50, Math.max(1, Math.floor(zahlOder(p.get('limit'), 10))));
      this.json(a, 200, this.mediathek.anschluss(mid, { fenster, energie, limit }, bestandIds(this.opt.bestand), (m) => this.vorbereiter.anzeige(m)));
    } catch (e) { this.mediathekFehler(e, a); }
  }

  private mediathekSuche(url: URL, a: http.ServerResponse): void {
    try {
      const p = url.searchParams;
      const bpm = p.get('bpm');
      const antwort = this.mediathek.suche({ text: p.get('text') || undefined, camelot: p.get('camelot') || undefined,
        bpm: bpm ? parseBpm(bpm) : undefined, genre: p.get('genre') || undefined, limit: parseLimit(p.get('limit')) },
        bestandIds(this.opt.bestand), (mid) => this.vorbereiter.anzeige(mid));
      this.json(a, 200, antwort);
    } catch (e) { this.mediathekFehler(e, a); }
  }

  // Klänge (Plan 2026-10-06-klaenge, T1): eigene Loop-Bibliothek (sofort, ladbar) vor den Mediathek-Klängen. Fehlt die Mediathek,
  // bleibt die Antwort 200 mit mediathek:'fehlt' (die Loops spielen trotzdem), sonst wie /mediathek.
  private klaengeSuche(url: URL, a: http.ServerResponse): void {
    try {
      const p = url.searchParams;
      const typ = p.get('typ') || undefined, einsatz = p.get('einsatz') || undefined, bpmRoh = p.get('bpm');
      if (typ !== undefined && !(KLANG_TYPEN as readonly string[]).includes(typ)) throw new MediathekFehler(400, 'typ_ungueltig');
      if (einsatz !== undefined && !['sofort', 'werkstatt', 'nur_live'].includes(einsatz)) throw new MediathekFehler(400, 'einsatz_ungueltig');
      const bpm = bpmRoh ? parseBpm(bpmRoh) : undefined;
      const text = p.get('text') || undefined, pack = p.get('pack') || undefined, camelot = p.get('camelot') || undefined;
      const limit = Number.isFinite(Math.floor(Number(p.get('limit') || NaN))) ? parseLimit(p.get('limit')) : 30;
      // Loop-Bibliothek: Loops sind 128 bpm, ohne pack/camelot; nur ladbare spielen jetzt
      const loopsOk = (typ === undefined || typ === 'loop') && (einsatz === undefined || einsatz === 'sofort') && pack === undefined && camelot === undefined
        && (bpm === undefined || (bpm[0] <= 128 && 128 <= bpm[1]));
      const eigene: KlangTreffer[] = !loopsOk ? [] : leseLoops(this.loopOrdner())
        .filter((l) => l.ladbar && (text === undefined || l.name.includes(text.toLowerCase())))
        .map((l): KlangTreffer => ({ sha: null, pfad: null, pfad_da: true, typ: 'loop', pack: null, kategorie: null, instrument: null, titel: l.name,
          dauer_s: l.beats * 60 / 128, bpm: 128, camelot: null, einsatz: 'sofort', quelle: 'loopbib', name: l.name }));
      if (!this.mediathek.vorhanden()) return this.json(a, 200, { treffer: eigene.slice(0, limit), gesamt: eigene.length, gesamt_genau: true, mediathek: 'fehlt' });
      const m = (einsatz === 'sofort') ? { treffer: [] as KlangTreffer[], gesamt: 0 }
        : this.mediathek.klaenge({ text, typ, pack, einsatz, bpm, camelot, limit: Math.max(1, limit - Math.min(eigene.length, limit)) });
      this.json(a, 200, { treffer: [...eigene, ...m.treffer].slice(0, limit), gesamt: eigene.length + m.gesamt, gesamt_genau: true });
    } catch (e) { this.mediathekFehler(e, a); }
  }

  // Karte: die Mediathek-Zahlen ändern sich nur nach einem Scan, darum je DB-Stand zwischengespeichert; die Loop-Bibliothek wird jedes Mal frisch gezählt.
  private karteCache: { stand: number; karte: ReturnType<Mediathek['karte']> } | null = null;
  private klaengeKarte(a: http.ServerResponse): void {
    try {
      const loopbib = leseLoops(this.loopOrdner()).filter((l) => l.ladbar).length;
      const je: Record<string, { gesamt: number; sofort: number; werkstatt: number; nur_live: number }> = {};
      for (const t of KLANG_TYPEN) je[t] = { gesamt: 0, sofort: 0, werkstatt: 0, nur_live: 0 };
      let packs: { pack: string; gesamt: number; nur_live: number }[] = [], stand: string | null = null;
      const fehlt = !this.mediathek.vorhanden();
      if (!fehlt) {
        const st = this.mediathek.stand();
        if (this.karteCache === null || this.karteCache.stand !== st) this.karteCache = { stand: st, karte: this.mediathek.karte() };
        const k = this.karteCache.karte;
        for (const t of KLANG_TYPEN) je[t] = { gesamt: k.je_typ[t].gesamt, sofort: 0, werkstatt: k.je_typ[t].werkstatt, nur_live: k.je_typ[t].nur_live };
        packs = k.packs; stand = k.mediathek_stand;
      }
      je.loop.gesamt += loopbib; je.loop.sofort += loopbib;
      this.json(a, 200, { je_typ: je, packs, loopbib, mediathek_stand: stand, erzeugt_am: new Date().toISOString(), ...(fehlt ? { mediathek: 'fehlt' } : {}) });
    } catch (e) { this.mediathekFehler(e, a); }
  }

  private mediathekFehler(e: unknown, a: http.ServerResponse): void {
    if (e instanceof MediathekFehler) return this.json(a, e.code, { fehler: e.fehler });
    this.opt.log?.({ typ: 'mediathek_fehler', text: (e as Error).message });
    this.json(a, 500, { fehler: 'mediathek_abfrage', text: (e as Error).message });
  }

  // Browser (Plan 2026-10-10-mediathek-browser): eine Seite des Katalogs je Typ. Status nur für die angezeigten Zeilen.
  private stoebern(url: URL, a: http.ServerResponse): void {
    try {
      const p = url.searchParams;
      const typ = p.get('typ') ?? 'track';
      if (!(KATALOG_TYPEN as readonly string[]).includes(typ)) throw new KatalogFehler(400, 'typ_ungueltig');
      const t = typ as Typ;
      const sort = p.get('sort') || SORT_VORGABE[t];
      const ab = p.get('richtung') === 'ab';
      const lroh = Math.floor(Number(p.get('limit') ?? SEITE_VORGABE));
      const limit = Number.isFinite(lroh) ? Math.min(SEITE_MAX, Math.max(1, lroh)) : SEITE_VORGABE;
      const sroh = Math.floor(Number(p.get('seite') ?? 0));
      const seite = Number.isFinite(sroh) && sroh > 0 ? sroh : 0;
      if (!Number.isSafeInteger(seite * limit)) throw new KatalogFehler(400, 'seite_ungueltig');   // 1e300 → sonst SQLite „datatype mismatch“ (Review MINOR 5)
      const r = this.katalog.seite(t, this.stoebernFilter(p), sort, ab, seite, limit);
      const bestand = t === 'track' ? bestandIds(this.opt.bestand) : new Set<string>();
      this.json(a, 200, { typ: t, sort, richtung: ab ? 'ab' : 'auf', seite, limit, gesamt: r.gesamt, gebaut_am: r.gebaut_am,
        treffer: r.zeilen.map((z) => this.stoebernTreffer(z, bestand)) });
    } catch (e) { this.katalogFehler(e, a); }
  }

  // STRUDEL im Browser (S2b): ~250 Einträge, deshalb im Speicher filtern/sortieren statt FTS
  private async stoebernMuster(url: URL, a: http.ServerResponse): Promise<void> {
    try {
      const p = url.searchParams;
      let l = await this.muster.liste();
      // Muster liegen im Speicher (~250): Textvergleich statt FTS. Wörter UND-verknüpft, je Wort Teilstring in Name, Code oder Rolle;
      // name:/rolle: schränken auf ein Feld ein. Die Katalog-Felder (artist:, label:, folder: …) gibt es hier nicht: 400, kein stilles Ignorieren.
      const { terme, ordner, zuviele } = suchTerme(p.get('text') ?? '', ['rolle']);
      if (zuviele) throw new KatalogFehler(400, 'zu_viele_suchwoerter');
      if ((p.get('ordner') ?? '') !== '') throw new KatalogFehler(400, 'filter_nicht_anwendbar');   // Muster liegen in keinem Ordner (S4-Review 6)
      if (ordner.length || terme.some((x) => x.spalte !== null && x.spalte !== 'name' && x.spalte !== 'rolle')) throw new KatalogFehler(400, 'suchfeld_nicht_anwendbar');
      for (const x of terme) {
        const w = x.wert.toLowerCase();
        l = l.filter((e) => x.spalte === 'name' ? e.name.toLowerCase().includes(w) : x.spalte === 'rolle' ? (e.rolle ?? '').includes(w)
          : e.name.toLowerCase().includes(w) || e.text.toLowerCase().includes(w) || (e.rolle ?? '').includes(w));
      }
      Oberflaeche.filterPruefen(p, 'strudel');
      const bpmRoh = p.get('bpm');
      if (bpmRoh) { const [lo, hi] = parseBpm(bpmRoh); l = l.filter((e) => e.bpm !== null && e.bpm >= lo && e.bpm <= hi); }
      const feld = p.get('feld'), wert = p.get('wert') ?? '';
      if (feld === 'quelle') l = l.filter((e) => e.quelle === wert); else if (feld === 'rolle') l = l.filter((e) => (e.rolle ?? '') === wert);
      else if (feld) throw new KatalogFehler(400, 'facette_ungueltig');
      const sort = p.get('sort') || 'name', ab = p.get('richtung') === 'ab';
      if (!['name', 'rolle', 'quelle', 'bpm', 'takte'].includes(sort)) throw new KatalogFehler(400, 'sort_ungueltig');
      const wertVon = (e: MusterEintrag): string | number => (e[sort as keyof MusterEintrag] ?? '') as string | number;
      l.sort((x, y) => { const u = wertVon(x), v = wertVon(y); const c = typeof u === 'number' && typeof v === 'number' ? u - v : String(u).localeCompare(String(v), 'en', { sensitivity: 'base' }); return (ab ? -c : c) || x.id.localeCompare(y.id); });
      const limit = Math.min(SEITE_MAX, Math.max(1, Math.floor(Number(p.get('limit') ?? SEITE_VORGABE)) || SEITE_VORGABE));
      const seite = Math.max(0, Math.floor(Number(p.get('seite') ?? 0)) || 0);
      this.json(a, 200, { typ: 'strudel', sort, richtung: ab ? 'ab' : 'auf', seite, limit, gesamt: l.length, gebaut_am: '',
        treffer: l.slice(seite * limit, (seite + 1) * limit).map((e) => ({ typ: 'strudel', ...e })) });
    } catch (e) { this.katalogFehler(e, a); }
  }

  private async stoebernMusterBaum(a: http.ServerResponse): Promise<void> {
    try {
      const l = await this.muster.liste();
      const zaehle = (werte: string[]): { wert: string; n: number }[] => {
        const z = new Map<string, number>();
        for (const w of werte) z.set(w, (z.get(w) ?? 0) + 1);
        return [...z].map(([wert, n]) => ({ wert, n })).sort((x, y) => y.n - x.n || x.wert.localeCompare(y.wert));
      };
      this.json(a, 200, { ordner: [], facetten: { quelle: zaehle(l.map((e) => e.quelle)), rolle: zaehle(l.map((e) => e.rolle ?? '')) }, gebaut_am: '' });
    } catch (e) { this.katalogFehler(e, a); }
  }

  // SAVE am Strudel-Deck: gespeichert wird, was die Instanz SPIELT, nie Text aus der Anfrage (Andreas: „das laufende Muster“)
  private async musterSpeichern(q: http.IncomingMessage, a: http.ServerResponse): Promise<void> {   // fremdePost: Router (Task 9)
    try {
      const d = await this.koerper(q);
      const strom = Oberflaeche.strom(d.strom);
      if (strom === null) return this.json(a, 400, { fehler: 'strom' });
      const laufend = leseMusterStand(this.musterOrdner(strom)).text;
      const r = this.muster.speichere({ name: String(d.name ?? ''), text: laufend, rolle: (['drums', 'bass', 'melodie'] as const)[strom - 1], strom,
        von: this.quelle(), ueberschreiben: d.ueberschreiben === true });
      this.opt.log?.({ typ: 'muster_gespeichert', name: r.name, strom });
      return this.json(a, 201, r);
    } catch (e) { if (e instanceof MusterFehler) return this.json(a, e.code, { fehler: e.fehler }); throw e; }
  }

  // Detail-Spalte (S5): der Eintrag, alle gültigen Angaben mit Quelle (Mediathek) und der volle Pfad. Der Pfad geht nur hier an die
  // Seite (sie ist lokal), nicht in die Trefferzeilen. Listen-Zeilen kennen nur die material_id: dann ?mid=.
  private stoebernDetail(url: URL, a: http.ServerResponse): void {
    try {
      const sha = url.searchParams.get('sha'), mid = url.searchParams.get('mid');
      if (sha === null && mid === null) throw new KatalogFehler(400, 'sha_ungueltig');
      const z = sha !== null ? this.katalog.eintrag(sha) : this.katalog.eintragVonMid(mid ?? '');
      if (!z) throw new KatalogFehler(404, 'unbekannt');
      const bestand = z.typ === 'track' ? bestandIds(this.opt.bestand) : new Set<string>();
      const angaben = this.mediathek.vorhanden() ? this.mediathek.angaben(z.shas.split(' ')) : [];
      // Das Objekt, auf das gezeigt wurde (sha, oder mid als Präfix): bei einem unterlegenen Objekt DESSEN Datei, nicht die des Gewinners (B6)
      const objekt = sha !== null ? sha : (z.shas.split(' ').find((x) => x.startsWith(mid ?? '')) ?? z.sha);
      const treffer = this.stoebernTreffer(z, bestand);
      let pfad = z.pfad;
      if (objekt !== z.sha) {
        pfad = this.mediathek.vorhanden() ? this.mediathek.pfadVon(objekt) : null;
        treffer.pfad_da = pfad !== null && fs.existsSync(pfad);
      }
      this.json(a, 200, { eintrag: treffer, angaben, pfad, objekt_sha: objekt });
    } catch (e) { this.katalogFehler(e, a); }
  }

  private stoebernBaum(url: URL, a: http.ServerResponse): void {
    try {
      const typ = url.searchParams.get('typ') ?? 'track';
      if (!(KATALOG_TYPEN as readonly string[]).includes(typ)) throw new KatalogFehler(400, 'typ_ungueltig');
      this.json(a, 200, this.katalog.baum(typ as Typ));
    } catch (e) { this.katalogFehler(e, a); }
  }

  // Filter aus der URL (Task 2.2: Ordner, Facette; Task 3.1/4.2 erweitern)
  // Welche Filter ein Typ hat (wie oeffentlich/stoebern.js FILTER_FUER). Ein anderer, gesetzter Filter ist ein 400, kein stilles Ignorieren.
  private static readonly FILTER_JE_TYP: Record<string, string[]> = { track: ['camelot', 'bpm', 'energie'], loop: ['camelot', 'bpm'], oneshot: [], strudel: ['bpm'] };
  private static filterPruefen(p: URLSearchParams, typ: string): void {
    const ok = Oberflaeche.FILTER_JE_TYP[typ] ?? [];
    for (const k of ['camelot', 'bpm', 'energie']) if ((p.get(k) ?? '') !== '' && !ok.includes(k)) throw new KatalogFehler(400, 'filter_nicht_anwendbar');
  }

  private stoebernFilter(p: URLSearchParams): Filter {
    Oberflaeche.filterPruefen(p, p.get('typ') ?? 'track');
    const f: Filter = {};
    const text = p.get('text'); if (text) f.text = text;
    const ordner = p.get('ordner'); if (ordner) f.ordner = ordner;
    const feld = p.get('feld'); if (feld) f.facette = { feld, wert: p.get('wert') ?? '' };
    const cam = p.get('camelot'); if (cam) { f.camelot = cam; f.nachbarn = p.get('nachbarn') === '1'; }
    const bpm = p.get('bpm'); if (bpm) f.bpm = parseBpm(bpm);
    const en = p.get('energie');
    if (en !== null && en !== '') { if (!['0', '1', '2'].includes(en)) throw new KatalogFehler(400, 'energie_ungueltig'); f.energie = Number(en) as 0 | 1 | 2; }
    return f;
  }

  private stoebernTreffer(z: Zeile, bestand: Set<string>): Record<string, unknown> {
    const { shas, pfad, alle: _alle, id: _id, ...rest } = z;
    const pfadDa = pfad !== null && fs.existsSync(pfad);
    const basis: Record<string, unknown> = { ...rest, material_id: z.sha.slice(0, 16), pfad_da: pfadDa, nur_live: z.schutz === 'ableton' };
    if (z.typ === 'loop') {   // S6: ob und warum der Loop in die Box geht — dieselbe Regel wie der Import (beatsVon), die Seite rechnet nichts nach
      try { basis.import_beats = beatsVon(z); } catch (e) { if (e instanceof LoopImportFehler) basis.import_grund = e.fehler; else throw e; }
    }
    if (z.typ !== 'track') return basis;
    const laden = shas.split(' ').map((s) => s.slice(0, 16)).find((m) => bestand.has(m)) ?? null;
    const lauf = this.vorbereiter.stand(basis.material_id);
    const status = laden ? 'ready' : lauf?.status === 'laeuft' ? 'laeuft' : lauf?.status === 'fehler' ? 'fehler' : pfadDa ? 'prepare' : 'missing';
    return { ...basis, status, laden_mid: laden, ...(status === 'fehler' ? { grund: lauf?.grund ?? 'unbekannt', ...(lauf?.name ? { grund_stufe: lauf.name } : {}) } : {}) };
  }

  // Für die Sets: fehlender, fremder oder kaputter Katalog heißt „kein Eintrag“. Die Sets brauchen ihn nur für die Art-Prüfung,
  // er ist abgeleitet und löschbar (Review S1 MAJOR 1). /stoebern meldet den Zustand selbst als 503.
  private katalogEintrag(mid: string): Zeile | null {
    try { return this.katalog.vorhanden() ? this.katalog.eintragMid(mid) : null; }
    catch (e) { if (e instanceof KatalogFehler) return null; throw e; }
  }

  // Typ eines Postens für die Art-Prüfung: aus dem Katalog, ohne Katalog (fehlt, fremd, im Neubau) aus der Mediathek selbst
  // (Review S2b Befund 1). null = unbekannt; dann gibt es nichts abzuweisen.
  private postenTyp(mid: string): string | null {
    const k = this.katalogEintrag(mid);
    if (k) return k.typ;
    try { return this.mediathek.vorhanden() ? (this.mediathek.felder([mid], new Set()).get(mid)?.typ ?? null) : null; }
    catch (e) { if (e instanceof MediathekFehler) return null; throw e; }
  }

  private async vorhoerenAus(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    try {
      if (d.aktion === 'stopp') { this.vorhoeren.stoppe(); return this.json(a, 200, { ok: true }); }
      if (d.aktion === 'springe') { this.vorhoeren.springe(Number(d.richtung) < 0 ? -1 : 1); return this.json(a, 200, { ok: true }); }
      // sha (Browser-Zeile) oder mid (Listen-Zeilen tragen bei Tracks nur material_id; Review S7 m3), wie /stoebern/detail
      const z = typeof d.sha === 'string' && d.sha ? this.katalog.eintrag(d.sha) : this.katalog.eintragVonMid(String(d.mid ?? ''));
      if (!z) throw new KatalogFehler(404, 'unbekannt');
      if (z.schutz === 'ableton') throw new KatalogFehler(409, 'nur_live');
      if (!z.pfad || !fs.existsSync(z.pfad)) throw new KatalogFehler(409, 'datei_fehlt');
      await this.vorhoeren.spiele({ pfad: z.pfad, typ: z.typ, sha: z.sha, bpm: z.bpm });
      this.json(a, 200, { ok: true, ...(await this.vorhoeren.stand()) });
    } catch (e) {
      if (e instanceof VorhoerFehler) return this.json(a, e.code, { fehler: e.fehler });
      this.katalogFehler(e, a);
    }
  }

  private katalogFehler(e: unknown, a: http.ServerResponse): void {
    if (e instanceof KatalogFehler || e instanceof MediathekFehler) return this.json(a, e.code, { fehler: e.fehler });
    this.opt.log?.({ typ: 'katalog_fehler', text: (e as Error).message });
    this.json(a, 500, { fehler: 'katalog_abfrage', text: (e as Error).message });
  }

  // Sets (Plan 2026-10-03-sets-mit-tracks). Kein Kern-Befehl; Dateien unter opt.sammlungen.
  private async sammlungRoute(q: http.IncomingMessage, url: URL, a: http.ServerResponse): Promise<void> {
    try {   // fremdePost für POST: Router (Task 9)
      if (url.pathname === '/sammlungen') {
        if (q.method === 'GET') return this.json(a, 200, this.sammlungen.liste(url.searchParams.get('art') ?? undefined));
        if (q.method === 'POST') { const d = await this.koerper(q); return this.json(a, 201, { slug: this.sammlungen.lege(String(d.name ?? ''), [], String(d.art ?? 'set')) }); }
      }
      if (url.pathname === '/sammlungen/import' && q.method === 'POST') {
        const d = await this.koerper(q);
        const art = String(d.art ?? 'set');
        if (art !== 'set' && art !== 'playlist') return this.json(a, 400, { fehler: 'art_unbekannt' });   // Traktor-Listen sind Tracks
        const l = this.mediathek.listeMids(Number(d.liste_id));
        const slug = this.sammlungen.lege(l.name, l.mids.map((m, i) => ({ id: `p${i + 1}`, art: 'track' as const, material_id: m })), art);
        return this.json(a, 201, { slug, posten: l.mids.length });
      }
      const m = url.pathname.match(/^\/sammlungen\/([^/]+)(\/posten|\/posten\/entfernen|\/posten\/verschieben|\/umbenennen|\/vorbereiten|\/loeschen)?$/);
      if (!m) return this.json(a, 404, { fehler: 'nicht_gefunden' });
      const slug = decodeURIComponent(m[1]), was = m[2] ?? '';
      if (q.method === 'GET' && was === '') return this.json(a, 200, await this.sammlungAnsicht(slug));
      if (q.method === 'POST' && was === '/posten') {
        const d = await this.koerper(q);
        // Ein Loop/Sample darf nie als Track ins Set (sonst schickt PREPARE ALL ihn in die Werkstatt; Review M6)
        const art = String(d.art ?? ''), ref = String(art === 'muster' ? d.ref ?? '' : d.material_id ?? '');
        if (art !== 'muster') {
          const typ = this.postenTyp(ref);
          if (typ !== null && typ !== art && (art === 'track' || typ === 'track')) return this.json(a, 400, { fehler: 'art_passt_nicht' });
        }
        const r = await this.wiederhole(() => this.sammlungen.legeHinzu(slug, art, ref, typeof d.notiz === 'string' ? d.notiz : undefined));
        return this.json(a, r.schon_drin ? 200 : 201, r.schon_drin ? r : { id: r.id });
      }
      if (q.method === 'POST' && was === '/posten/entfernen') { const d = await this.koerper(q); await this.wiederhole(() => this.sammlungen.entferne(slug, String(d.id ?? ''))); return this.json(a, 200, { ok: true }); }
      if (q.method === 'POST' && was === '/posten/verschieben') { const d = await this.koerper(q); await this.wiederhole(() => this.sammlungen.verschiebe(slug, String(d.id ?? ''), Number(d.nach))); return this.json(a, 200, { ok: true }); }
      if (q.method === 'POST' && was === '/umbenennen') { const d = await this.koerper(q); await this.wiederhole(() => this.sammlungen.benenne(slug, String(d.name ?? ''))); return this.json(a, 200, { ok: true }); }
      if (q.method === 'POST' && was === '/vorbereiten') {
        const ansicht = await this.sammlungAnsicht(slug) as { posten: { art: string; material_id: string; status: string }[] };
        return this.json(a, 202, { eingereiht: this.reihe(ansicht.posten.filter((p) => p.art === 'track' && p.status === 'prepare').map((p) => p.material_id)) });
      }
      if (q.method === 'POST' && was === '/loeschen') { this.sammlungen.loesche(slug); return this.json(a, 200, { ok: true }); }
      return this.json(a, 404, { fehler: 'nicht_gefunden' });
    } catch (e) {
      if (e instanceof SammlungFehler) return this.json(a, e.code, { fehler: e.fehler });
      this.mediathekFehler(e, a);
    }
  }

  // Eine von einem Fremdprozess belegte Liste (409 liste_busy, sperre.ts): bis zu 4 mal nach 25 ms asynchron wiederholen, nie blockieren
  private async wiederhole<T>(f: () => T): Promise<T> {
    for (let i = 0; ; i++) {
      try { return f(); }
      catch (e) { if (!(e instanceof SammlungFehler) || e.fehler !== 'liste_busy' || i >= 4) throw e; await new Promise((ok) => setTimeout(ok, 25)); }
    }
  }

  private async sammlungAnsicht(slug: string): Promise<Record<string, unknown>> {
    const s = this.sammlungen.lies(slug);
    const bestand = bestandIds(this.opt.bestand);
    const mids = s.posten.filter((p) => p.art === 'track').map((p) => p.material_id as string);
    const felder = this.mediathek.vorhanden() ? this.mediathek.felder(mids, bestand) : new Map();
    const muster = s.posten.some((p) => p.art === 'muster') ? await this.muster.liste() : [];
    const posten = s.posten.map((p) => {
      if (p.art === 'muster') {
        const e = muster.find((m) => m.id === p.ref);
        return { ...p, titel: e?.name ?? p.ref ?? null, rolle: e?.rolle ?? null, bpm: e?.bpm ?? null, status: e ? 'ready' : 'missing',
          eintrag: e ? { typ: 'strudel', ...e } : { typ: 'strudel', id: p.ref, name: p.ref, quelle: null, rolle: null, bpm: null, takte: null, text: '', ladbar: false } };
      }
      if (p.art !== 'track') {
        const z = this.katalogEintrag(p.material_id ?? '');
        return { ...p, titel: z?.name ?? null, kuenstler: null, mix: null, bpm: z?.bpm ?? null, camelot: z?.camelot ?? null, energie: null,
          genre: null, dauer_s: z?.dauer_s ?? null, status: z?.pfad && fs.existsSync(z.pfad) ? 'ready' : 'missing', laden_mid: null,
          eintrag: z ? this.stoebernTreffer(z, new Set()) : { typ: p.art, material_id: p.material_id, name: null, pfad_da: false, nur_live: false } };
      }
      const k = this.katalogEintrag(p.material_id as string);
      if (k && k.typ !== 'track') return { ...p, titel: k.name, kuenstler: null, mix: null, bpm: k.bpm, camelot: k.camelot, energie: null,
        genre: null, dauer_s: k.dauer_s, status: 'kein_track', laden_mid: null, eintrag: this.stoebernTreffer(k, new Set()) };
      const f = felder.get(p.material_id as string);
      const lauf = this.vorbereiter.stand(p.material_id);
      let status = 'unbekannt', laden: string | null = null, grund: string | undefined, grundStufe: string | undefined;
      if (f?.bestand_mid) { status = 'ready'; laden = f.bestand_mid; }
      else if (bestand.has(p.material_id)) { status = 'ready'; laden = p.material_id; }
      else if (lauf?.status === 'laeuft') status = 'laeuft';
      else if (this.warteschlange.includes(p.material_id)) status = 'wartet';
      else if (lauf?.status === 'fehler') { status = 'fehler'; grund = lauf.grund; grundStufe = lauf.name; }
      else if (f) status = f.pfad_da ? 'prepare' : 'missing';
      return { ...p, titel: f?.titel ?? null, kuenstler: f?.kuenstler ?? null, mix: f?.mix ?? null, bpm: f?.bpm ?? null, camelot: f?.camelot ?? null, energie: f?.energie ?? null,
        genre: f?.genre ?? null, dauer_s: f?.dauer_s ?? null, status, laden_mid: laden, ...(grund ? { grund, ...(grundStufe ? { grund_stufe: grundStufe } : {}) } : {}),
        eintrag: { typ: 'track', material_id: p.material_id, titel: f?.titel ?? null, kuenstler: f?.kuenstler ?? null, mix: f?.mix ?? null, bpm: f?.bpm ?? null, camelot: f?.camelot ?? null,
          energie: f?.energie ?? null, genre: f?.genre ?? null, dauer_s: f?.dauer_s ?? null, status, laden_mid: laden, pfad_da: f?.pfad_da ?? false } };
    });
    return { slug, name: s.name, art: s.art ?? 'set', notiz: s.notiz, posten, uebersicht: uebersicht(posten.filter((p) => p.art === 'track')) };
  }

  private pumpeTimer: NodeJS.Timeout | null = null;
  // „Alles vorbereiten": Warteschlange vor dem Vorbereiter (der nimmt höchstens zwei zugleich, sonst 'ausgelastet').
  private reihe(mids: string[]): number {
    let n = 0;
    for (const m of mids) if (!this.warteschlange.includes(m) && this.vorbereiter.stand(m)?.status !== 'laeuft') { this.warteschlange.push(m); n++; }
    this.pumpe();
    return n;
  }
  private pumpe(): void {
    if (this.pumpeTimer) { clearTimeout(this.pumpeTimer); this.pumpeTimer = null; }
    if (this.gestoppt) return;
    while (this.warteschlange.length) {
      const mid = this.warteschlange[0];
      let q;
      try { q = this.mediathek.quelle(mid, bestandIds(this.opt.bestand)); }
      catch (e) { this.opt.log?.({ typ: 'set_vorbereiten_uebersprungen', material_id: mid, fehler: (e as Error).message }); this.warteschlange.shift(); continue; }
      if (q.vorhanden !== undefined) { this.warteschlange.shift(); continue; }
      if (this.vorbereiter.starte(mid, q.pfad, q.titel) === 'ausgelastet') break;
      this.warteschlange.shift();
    }
    if (this.warteschlange.length) this.pumpeTimer = setTimeout(() => this.pumpe(), 2000);
  }

  private vorbereitenStand(url: URL, a: http.ServerResponse): void {
    const mid = url.searchParams.get('material_id') ?? '';
    const st = this.vorbereiter.stand(mid);
    if (st) return this.json(a, 200, st);
    if (bestandIds(this.opt.bestand).has(mid)) return this.json(a, 200, { status: 'vorhanden' });
    this.json(a, 404, { fehler: 'unbekannt' });
  }

  private async vorbereiten(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    try {
      const mid = typeof d.material_id === 'string' ? d.material_id : '';
      const imBestand = bestandIds(this.opt.bestand);
      if (imBestand.has(mid)) return this.json(a, 200, { material_id: mid, status: 'vorhanden' });
      const q = this.mediathek.quelle(mid, imBestand);   // 400 / 404 / 409 datei_fehlt / 503 mediathek_fehlt
      if (q.vorhanden !== undefined) return this.json(a, 200, { material_id: q.vorhanden, status: 'vorhanden' });   // anderes Objekt desselben Werks liegt schon im Bestand
      const r = this.vorbereiter.starte(mid, q.pfad, q.titel);
      if (r === 'ausgelastet') return this.json(a, 429, { fehler: 'ausgelastet' });
      if (r === 'gestartet') this.opt.log?.({ typ: 'vorbereiten', material_id: mid, quelle: q.pfad });
      this.json(a, 202, { material_id: mid, status: 'laeuft' });
    } catch (e) { this.mediathekFehler(e, a); }
  }

  // Laden: Eintrag aus dem Index, dann Kopie in den Arbeitsbestand (geprüft), erst dann /k/deck/laden.
  private async laden(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    const deck = d.deck;
    // Ohne genannte Fassung die neueste derselben Basis: der Index ist nach Fassung aufsteigend sortiert, ein find()
    // nahm r1 und ließ jede Korrektur (r2, r3 … aus `korrigieren`) liegen (gemessen 2026-10-09, Phase-Korrektur).
    const passend = leseBestand(this.opt.bestand).filter((e) => e.material_id === d.material_id
      && e.fassung === (d.fassung ?? e.fassung) && e.basis_bpm === (d.basis_bpm ?? e.basis_bpm));
    const eintrag = passend.filter((e) => e.basis_bpm === passend[0].basis_bpm)
      .reduce<typeof passend[number] | undefined>((m, e) => (m === undefined || e.fassung > m.fassung ? e : m), undefined);
    if (deck !== 1 && deck !== 2) return this.json(a, 400, { fehler: 'unbekanntes_deck', deck });
    // Befund 4: nicht im Index ist ein anderer Fall als eine fehlende Datei der Fassung (material_fehlt aus der Kopie)
    if (!eintrag) return this.json(a, 400, { fehler: 'nicht_im_index', material_id: d.material_id });
    let kopie;
    try {
      kopie = await inArbeitsbestand(this.opt.bestand, this.opt.arbeitsbestand, eintrag.material_id, eintrag.basis_bpm, eintrag.fassung);
    } catch (e) {
      const code = e instanceof KopieFehler ? e.code : 'pruefung';
      this.opt.log?.({ typ: 'kopie_abgewiesen', material_id: eintrag.material_id, fehler: code, text: (e as Error).message });
      return this.json(a, 400, { fehler: code, material_id: eintrag.material_id, text: (e as Error).message });
    }
    this.opt.log?.({ typ: 'kopie', material_id: eintrag.material_id, kopiert: kopie.kopiert, bytes: kopie.bytes, dauer_ms: kopie.dauer_ms });
    const id = Number(++this.id);
    const felder = { id, quelle: this.quelle(), deck, material_id: eintrag.material_id, basis_bpm: eintrag.basis_bpm,
      fassung: eintrag.fassung, mit_stems: kopie.mit_stems };
    this.kern.sende('/k/deck/laden', felder);
    this.gesendet++;
    this.json(a, 200, { ok: true, gesendet: '/k/deck/laden', felder,
      kopie: { kopiert: kopie.kopiert, bytes: kopie.bytes, dauer_ms: kopie.dauer_ms } });
  }

  // Plan Grid (D6): je Box der zuletzt geschickte Versatz; Laden und Kern-Neustart verwerfen ihn (Review F5: der Kern nimmt
  // beim Laden den Wert aus loop.json)
  private loopRasterLive: Record<string, { name: string; v: number }> = {};
  // Paket 2 Slice 5 (F07): Der Neustart-Zustand des Kerns trägt Decks und Regler, aber keine Loop-Boxen und keine
  // FX-Einheiten. Der Server merkt sie VOR dem Leeren (B15) und schickt sie 500 ms später erneut, jedes Stück mit der
  // Quelle der letzten Ladung bzw. Einstellung (B12). Bei Stop Cypher bleibt alles von Cypher weg (B12). Höchstens eine
  // Wiederherstellung je 30 s (B13): eine Absturzschleife soll nicht jedes Mal Ton in einen Kern pumpen, der gleich wieder fällt.
  private readonly loopBesitzer: Record<string, string> = {};
  private readonly loopLadung: Record<string, { name: string; quelle: string }> = {};   // Ladeversuch, bis der Kern ihn bestätigt
  private readonly angefasst = new Set<string>();   // seit dem letzten Plan neu gesetzt: box:N, raster:N, fx:E (F3)
  private letzteBoxFxWieder = 0;
  private static readonly BOX_FX_SPERRE_MS = 30_000;
  private boxFxPlanen(): void {
    const boxen: { box: number; name: string; status: number; besitzer: string; versatz?: number }[] = [];
    for (const [n, l] of Object.entries(this.stand.loops)) {
      const name = String(l.name ?? ''), status = Number(l.status);
      if (!name || !(status >= 1)) continue;   // leere Box: nichts zu senden
      const live = this.loopRasterLive[n];
      boxen.push({ box: Number(n), name, status, besitzer: this.loopBesitzer[n] ?? 'cypher', ...(live && live.name === name ? { versatz: live.v } : {}) });
    }
    const fx: { einheit: 1 | 2; felder: Felder; zuweisung: string[]; besitzer: string }[] = [];
    for (const e of [1, 2] as const) {
      const f = this.stand.fx[e - 1];
      const zu = Object.entries(this.stand.fxZuweisung[e - 1]).filter(([, an]) => an).map(([kanal]) => kanal);
      if (!f || (f.an !== 1 && zu.length === 0)) continue;
      fx.push({ einheit: e, felder: f, zuweisung: zu, besitzer: this.fxVon(e) ?? 'cypher' });
    }
    if (boxen.length === 0 && fx.length === 0) return;
    const jetzt = Date.now();
    if (jetzt - this.letzteBoxFxWieder < Oberflaeche.BOX_FX_SPERRE_MS) {
      this.opt.log?.({ typ: 'wiederherstellung_uebersprungen', grund: 'zu_schnell', seit_ms: jetzt - this.letzteBoxFxWieder });
      this.verteile({ a: 'wiederherstellung', f: { uebersprungen: true, grund: 'zu_schnell' } });
      return;
    }
    this.letzteBoxFxWieder = jetzt;
    this.angefasst.clear();
    const geplant = this.generation;   // MINOR-2: ist der Kern bis zum Auslösen ein anderer geworden, verpufft der Plan
    setTimeout(() => {
      if (this.generation !== geplant) { this.opt.log?.({ typ: 'wiederherstellung_verworfen', geplant, jetzt: this.generation }); return; }
      this.boxFxWieder(boxen, fx);
    }, 500);
  }
  private boxFxWieder(boxen: { box: number; name: string; status: number; besitzer: string; versatz?: number }[],
    fx: { einheit: 1 | 2; felder: Felder; zuweisung: string[]; besitzer: string }[]): void {
    const nichtCypher = (besitzer: string) => !(besitzer === 'cypher' && this.kiGestoppt);   // Stop Cypher: Cyphers Teile bleiben weg
    const autoAus = !leseMusterStand(this.musterOrdner()).autonom;   // F7: wie fxRiegel, zum Zeitpunkt des Auslösens
    const ladbar = new Map(leseLoops(this.loopOrdner()).map((l) => [l.name, l.ladbar]));
    let n = 0;
    for (const b of boxen) {
      if (!nichtCypher(b.besitzer)) { this.opt.log?.({ typ: 'box_wieder_ausgelassen', box: b.box, grund: 'ki_gestoppt' }); continue; }
      if (this.angefasst.has(`box:${b.box}`)) { this.opt.log?.({ typ: 'box_wieder_ausgelassen', box: b.box, grund: 'neu_gesetzt' }); continue; }
      if (ladbar.get(b.name) !== true) { this.opt.log?.({ typ: 'box_wieder_ausgelassen', box: b.box, grund: 'nicht_ladbar' }); continue; }
      this.kern.sende('/k/loop/laden', { id: Number(++this.id), quelle: b.besitzer, box: b.box, name: b.name });
      this.gesendet++;
      if (b.versatz !== undefined && !this.angefasst.has(`raster:${b.box}`)) {   // der Kern nimmt beim Laden den Datei-Wert; Andreas' Live-Versatz geht danach erneut hin (B15)
        this.kern.sende('/k/loop/raster', { id: Number(++this.id), quelle: 'andreas', box: b.box, versatz_frames: b.versatz });
        this.gesendet++;
        this.loopRasterLive[String(b.box)] = { name: b.name, v: b.versatz };
      }
      if ((b.status === 2 || b.status === 3 || b.status === 5) && !this.angefasst.has(`box:${b.box}`)) {   // wartet, läuft, tempo: weiter; bereit und endet bleiben stehen (B14)
        this.kern.sende('/k/loop/start', { id: Number(++this.id), quelle: b.besitzer, box: b.box });
        this.gesendet++;
      }
      this.opt.log?.({ typ: 'box_wieder', box: b.box, name: b.name, status: b.status, besitzer: b.besitzer, versatz_frames: b.versatz ?? null });
      n++;
    }
    for (const u of fx) {
      if (!nichtCypher(u.besitzer)) { this.opt.log?.({ typ: 'fx_wieder_ausgelassen', einheit: u.einheit, grund: 'ki_gestoppt' }); continue; }
      if (u.besitzer === 'cypher' && autoAus) { this.opt.log?.({ typ: 'fx_wieder_ausgelassen', einheit: u.einheit, grund: 'auto_aus' }); continue; }
      if (this.angefasst.has(`fx:${u.einheit}`)) { this.opt.log?.({ typ: 'fx_wieder_ausgelassen', einheit: u.einheit, grund: 'neu_gesetzt' }); continue; }
      const f = u.felder;
      this.kern.sende('/k/fx', { id: Number(++this.id), quelle: u.besitzer, einheit: u.einheit, art: f.art, beats: f.beats, wet: f.wet,
        param1: f.param1, param2: f.param2, param3: f.param3, an: f.an });
      this.gesendet++;
      for (const kanal of u.zuweisung) {
        this.kern.sende('/k/fx/zuweisung', { id: Number(++this.id), quelle: u.besitzer, einheit: u.einheit, kanal, an: 1 });
        this.gesendet++;
      }
      this.opt.log?.({ typ: 'fx_wieder', einheit: u.einheit, besitzer: u.besitzer, zuweisungen: u.zuweisung.length });   // fx_von.json bleibt: hier wird nicht fxVon(…, von) gerufen
      n++;
    }
    this.opt.log?.({ typ: 'wiederherstellung', stuecke: n });
  }
  private loopRasterWert(box: number): { name: string; frames: number; versatz_frames: number; gespeichert_frames: number } | null {
    const name = String((this.stand.loops[String(box)] as Record<string, unknown> | undefined)?.name ?? '');
    if (!name) return null;
    const x = leseLoopVersatz(this.loopOrdner(), name);
    if (!x) return null;
    const l = this.loopRasterLive[String(box)];
    return { name, frames: x.frames, versatz_frames: l && l.name === name ? l.v : x.versatz, gespeichert_frames: x.versatz };
  }
  private loopRaster(d: Record<string, unknown>, a: http.ServerResponse): void {
    const box = d.box;
    if (box !== 1 && box !== 2) return this.json(a, 400, { fehler: 'unbekannte_box', box });
    const w = this.loopRasterWert(box);
    if (!w) return this.json(a, 409, { fehler: 'kein_loop' });
    if (d.aktion === 'raster_fix') {
      schreibeLoopVersatz(this.loopOrdner(), w.name, w.versatz_frames);
      this.opt.log?.({ typ: 'loop_raster_fix', box, versatz_frames: w.versatz_frames });
      return this.json(a, 200, { ok: true, versatz_frames: w.versatz_frames, gespeichert_frames: w.versatz_frames });
    }
    let v: number;
    if (typeof d.versatz_frames === 'number' && Number.isInteger(d.versatz_frames)) v = d.versatz_frames;
    else if (typeof d.schritt_ms === 'number' && Number.isFinite(d.schritt_ms) && Math.abs(d.schritt_ms) <= 100) v = w.versatz_frames + Math.round(d.schritt_ms * 48);
    else return this.json(a, 400, { fehler: 'schritt_oder_versatz' });
    v %= w.frames;   // Drehung: in (−frames, frames) falten (JS behält das Vorzeichen)
    this.kern.sende('/k/loop/raster', { id: Number(++this.id), quelle: this.quelle(), box, versatz_frames: v });
    this.gesendet++;
    this.loopRasterLive[String(box)] = { name: w.name, v };
    this.angefasst.add(`raster:${box}`);
    this.json(a, 200, { ok: true, versatz_frames: v, gespeichert_frames: w.gespeichert_frames });
  }
  private loopOrdner(): string { return this.opt.loops ?? loopOrdnerVorgabe(instanz()); }

  // MVP 2 (§4.9): Loop-Boxen. Geprüft wird vor dem Senden; Abgelehntes geht nicht an den Kern (400).
  private loop(d: Record<string, unknown>, a: http.ServerResponse): void | Promise<void> {
    const { aktion, box } = d;
    if (aktion === 'rec') return this.loopRec(d, a);  // MVP 2 Scheibe 2: kein box-Feld, eigener Zweig
    if (aktion === 'kit') return this.loopKit(d, a);  // MVP 2 Scheibe 3: → STRUDEL, nur Dateien, kein Kern
    if ((aktion === 'raster' || aktion === 'raster_fix') && this.quelle() === 'cypher') return this.json(a, 403, { fehler: 'nur_andreas' });
    if (aktion === 'raster' || aktion === 'raster_fix') return this.loopRaster(d, a);
    if (aktion !== 'laden' && aktion !== 'start' && aktion !== 'stopp') return this.json(a, 400, { fehler: 'unbekannte_aktion', aktion });
    if (box !== 1 && box !== 2) return this.json(a, 400, { fehler: 'unbekannte_box', box });
    // Plan Hand T7: Laden/Starten einer OFFENEN Box brächte ungehörten Inhalt; für cypher gesperrt, bis das Ohr steht
    // Ausnahme (Andreas 2026-10-05 „du hast freie fahrt“): ein Loop, den Cypher selbst vom Master mitgeschnitten hat, ist
    // gehörtes eigenes Material wie ein Strudel-Muster; fremd geschnittene Loops (Deck) bleiben gesperrt.
    const boxName = aktion === 'laden' ? d.name : this.boxInhaltName(box);
    if (aktion !== 'stopp' && this.quelle() === 'cypher' && !this.eigenerMitschnitt(boxName)) {
      if (kanalOffen(this.stand.regler, `pad/${box}`)) {
        return this.json(a, 409, { fehler: 'ziel_ungehoert', text: 'loop box is open; that would play unheard material' });
      }
      // Plan Glanz 1.3 (Review M2): pad/* öffnet für Cypher ohne Hörschein, weil die Box seinen Mitschnitt trägt; diese Prüfung gilt
      // nur im Moment der Anfrage. Darum kein fremder Inhalt, solange ein Cypher-Teil auf pad/<box>/… offen ist.
      if (this.boxBelegt(box)) {
        return this.json(a, 409, { fehler: 'box_offen_oder_faehrt', text: 'my pad ramp on this box is still running; foreign material would play unheard' });
      }
    }
    if (aktion === 'laden') delete this.loopRasterLive[String(box)];   // Review F5
    this.angefasst.add(`box:${box}`);   // Slice 5 F3
    const felder: Felder = { id: Number(++this.id), quelle: this.quelle(), box };
    if (aktion === 'laden') {
      const name = d.name;
      const eintrag = typeof name === 'string' && LOOP_NAME.test(name) ? leseLoops(this.loopOrdner()).find((l) => l.name === name) : undefined;
      if (!eintrag) return this.json(a, 400, { fehler: 'unbekannter_loop', name });
      if (!eintrag.ladbar) return this.json(a, 400, { fehler: 'loop_defekt', name, grund: eintrag.grund, text: eintrag.grund });
      felder.name = eintrag.name;
      this.loopLadung[String(box)] = { name: eintrag.name, quelle: this.quelle() };   // Besitzer erst mit dem Echo /e/loop (F1)
    }
    const adresse = `/k/loop/${aktion}`;
    this.kern.sende(adresse, felder);
    this.gesendet++;
    // Plan Tempo-Folge: wie /loop rec auf die Quittung warten, damit eine Ablehnung (pruefung, ki_gestoppt,
    // nicht_geladen) beim Aufrufer steht statt nur im Kern-Log (Anlass 2026-09-30: jam-boom lud viermal stumm nicht).
    return this.warteQuittung(Number(felder.id)).then((quittung) => {
      if (aktion === 'laden' && (quittung as Felder | null)?.status === 6 && this.loopLadung[String(box)]?.name === felder.name) delete this.loopLadung[String(box)];   // abgelehnt: kein Besitzerwechsel
      this.json(a, 200, { ok: true, gesendet: adresse, felder, quittung });
    });
  }

  // Plan Tempo-Folge (§4.2 /k/tempo/rampe): das Master-Tempo fährt ab der nächsten Takt-Eins über einen Takt auf bpm
  // (60 bis 200, auf 0,01 gerundet). Andreas und Cypher; bei Stop Cypher lehnt die Seite Cypher mit 409 ki_gestoppt ab. Laufende Decks
  // folgen im Varispeed (Welle 3, ADR 028); die Antwort trägt die Quittung.
  private async tempo(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    // Andreas 2026-10-05: „du willst ernsthaft das ich dir 138 bpm vortippe?“ – Tempo ist auch Cyphers Hand; Stop Cypher hält es.
    if (this.quelle() === 'cypher' && this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
    // D1 Spec 6.32: eine Tempo-Rampe verändert eine laufende Freeze-Datei; während der Sperre des Bereichs proj (S3) nimmt die Route nichts an
    if (this.proj.sitzung.ladenGesperrt()) return this.json(a, 409, { fehler: 'beschaeftigt', text: 'a freeze is running; tempo changes wait until it is done' });
    const u = this.kern.uhr as unknown as { beat: number; bpm: number } | null;
    const rampe = tempoRampe(u?.beat ?? 0, u?.bpm ?? 128, d.bpm as number);   // D1 S2: derselbe Weg wie der Bereich proj (Spec 2.7)
    if (!rampe) return this.json(a, 400, { fehler: 'bereich', text: 'bpm must be a number from 60 to 200' });
    const felder = { id: Number(++this.id), quelle: this.quelle(), ...rampe };
    this.kern.sende('/k/tempo/rampe', felder);
    this.gesendet++;
    const quittung = await this.warteQuittung(felder.id, felder.ab_beat);
    this.json(a, 200, { ok: true, gesendet: '/k/tempo/rampe', felder, quittung });
  }

  // MVP 2 Scheibe 2/3 (§4.9 /k/loop/rec): REC auf C. beats 1, 2, 4, 8, 16 oder 32; Name nur syntaktisch geprüft (ob er schon
  // vergeben ist, weiß erst der Kern nach der Aufnahme: /e/mitschnitt Status 1).
  // Plan djk-hand-mcp-studio (Review): die Antwort wartet auf die Kern-Quittung (wie /regler), damit Status 6 (Stop Cypher ki_gestoppt,
  // ueberlappung, eine Tempo-Rampe im Mitschnittfenster; jedes feste Tempo ist erlaubt, kern.cpp:196) beim Aufrufer ankommt statt still zu verpuffen.
  private async loopRec(d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
    const beats = d.beats;
    const name = d.name;
    if (![1, 2, 4, 8, 16, 32].includes(beats as number)) return this.json(a, 400, { fehler: 'unbekannte_beats', beats });
    if (typeof name !== 'string' || !LOOP_NAME.test(name)) return this.json(a, 400, { fehler: 'unbekannter_name', name });
    const felder: Felder = { id: Number(++this.id), quelle: this.quelle(), beats: beats as number, name };
    this.kern.sende('/k/loop/rec', felder);
    this.gesendet++;
    this.json(a, 200, { ok: true, gesendet: '/k/loop/rec', felder, quittung: await this.warteQuittung(felder.id) });
  }
  // Plan Glanz 1.3: trägt die Box Cyphers Fahrt (offener Teil auf pad/<box>/… in fahrtEnde, Abgelaufenes zählt nicht) oder ist sie offen?
  // Inhalt der Box für die Herkunftsprüfung: eine ausstehende Ladung (gesendet, Echo /e/loop fehlt noch) zählt schon; sonst wäre
  // der Deck-Schnitt zwischen Senden und Echo noch „der alte, eigene Name“ (Re-Review Glanz 1.3, Wettlauf)
  private boxInhaltName(box: number): string { return this.loopLadung[String(box)]?.name ?? this.boxLoopName(box); }
  // Naht F13 (Klickfrei): ein in eine klingende Box geladener Loop übernimmt im nächsten Block (bis Keylock Task 7 wartete
  // er bis zu 4 s auf seine Keylock-Variante), bis dahin spielt die Box den alten.
  // Eigen ist sie für Cyphers Fader nur, wenn der laufende UND ein wartender Inhalt Cyphers Mitschnitt sind.
  private boxEigen(box: number): boolean {
    const wartend = this.loopLadung[String(box)]?.name;
    const laufend = this.boxLoopName(box);
    return (laufend === '' ? wartend !== undefined : this.eigenerMitschnitt(laufend)) && (wartend === undefined || this.eigenerMitschnitt(wartend));
  }
  // zählt nur fader und trim: eq/filter/send können eine Box nicht öffnen
  private boxFaehrt(box: number): boolean {
    const beat = this.kern.uhr?.beat ?? 0;
    for (const [pfad, l] of this.fahrtEnde) if ((pfad === `pad/${box}/fader` || pfad === `pad/${box}/trim`) && l.some((e) => e.ab + e.dauer >= beat)) return true;
    return false;
  }
  private boxBelegt(box: number): boolean { return kanalOffen(this.stand.regler, `pad/${box}`) || this.boxFaehrt(box); }
  private boxLoopName(box: unknown): string {
    return String((this.stand.loops[String(box)] as Record<string, unknown> | undefined)?.name ?? '');
  }
  private eigenerMitschnitt(name: unknown): boolean {
    if (typeof name !== 'string' || !LOOP_NAME.test(name)) return false;
    const e = leseLoops(this.loopOrdner()).find((l) => l.name === name);
    return !!e && e.ladbar && e.quelle === 'mitschnitt';
  }
  // MVP 2 Scheibe 3 (E2): Loop wird Klang im Zusatz-Kit (rec, Prüfinstanz rec-<i>); der Erzeuger lädt ihn nach.
  private loopKit(d: Record<string, unknown>, a: http.ServerResponse): void {
    const name = d.name;
    if (typeof name !== 'string' || !LOOP_NAME.test(name)) return this.json(a, 400, { fehler: 'unbekannter_loop', name });
    if (d.klang !== undefined && typeof d.klang !== 'string') return this.json(a, 400, { fehler: 'unbekannter_klang' });
    // Riegel für Cypher: der Zusatz-Kit rec hängt am Drums-Erzeuger (Strom 1); Stop Cypher und AUTO aus gelten auch hier
    if (this.quelle() === 'cypher') {
      if (this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
      if (!leseMusterStand(this.musterOrdner(1)).autonom) return this.json(a, 409, { fehler: 'auto_aus', strom: 1, text: 'AUTO is off for the drums instance: Andreas holds it' });
    }
    try {
      const r = loopZuKlang({ loopOrdner: this.loopOrdner(), kitsOrdner: this.opt.kits ?? kitsOrdnerVorgabe(),
        basis: this.opt.kit ?? 'battery', zusatz: zusatzKit(), loop: name, klang: d.klang as string | undefined });
      this.json(a, 200, { ok: true, ...r });
    } catch (e) {
      this.json(a, 400, { fehler: 'kit', text: (e as Error).message });
    }
  }

  // Plan Oberfläche T2 (Spec E4): ?loop=<name> oder ?material=<id>&bpm=<basis>&fassung=<n>. Liest nur, sendet nichts an den Kern.
  private async welleAus(url: URL, a: http.ServerResponse): Promise<void> {
    try {
      const loop = url.searchParams.get('loop'), material = url.searchParams.get('material'), sha = url.searchParams.get('sha');
      const q = loop !== null ? loopQuelle(this.loopOrdner(), loop)
        // Browser (S5): der Pfad kommt aus dem Katalog, nie aus der Anfrage. Ableton-geschützte Dateien sind für ffmpeg nicht lesbar (422).
        : sha !== null ? (() => {
          // S6 Task 14: Stems und Takes liegen im Projektordner, nicht im Katalog; deren Pfad kommt aus dem offenen Projekt
          const ausProjekt = () => { const p = this.proj.sitzung.projektQuellPfad(sha); return p ? dateiQuelle(p, sha) : null; };
          let z;
          try { z = this.katalog.eintrag(sha); } catch (e) { const q = ausProjekt(); if (q) return q; throw e; }
          if (!z?.pfad) { const q = ausProjekt(); if (q) return q; throw new WelleFehler(404, 'unbekannt'); }
          if (z.schutz === 'ableton') throw new WelleFehler(422, 'nur_live');
          // sha eines unterlegenen Objekts: dessen eigene Datei (Fundort auf diesem Host), nie stillschweigend die des Gewinners
          const pfad = sha === z.sha ? z.pfad : (this.mediathek.vorhanden() ? this.mediathek.pfadVon(sha) : null);
          if (!pfad) throw new WelleFehler(404, 'unbekannt');
          return dateiQuelle(pfad, sha, z.dauer_s);
        })()
        : material !== null ? fassungQuelle(this.opt.bestand, material, Number(url.searchParams.get('bpm')), Number(url.searchParams.get('fassung')))
        : (() => { throw new WelleFehler(400, 'quelle_fehlt'); })();
      // Schließt die Seite die Anfrage (Auswahl gewechselt), bricht die Dekodierung ab, wenn sonst niemand auf sie wartet (S5-Review B2)
      const ac = new AbortController();
      a.on('close', () => { if (!a.writableFinished) ac.abort(); });
      const datei = await this.welle.hole(q, ac.signal);
      a.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(datei).on('error', () => a.destroy()).pipe(a);   // Review F6: Lesefehler beendet nur die Antwort
    } catch (e) {
      if (a.destroyed) return;                                   // die Seite ist weg (Abbruch): nichts mehr zu melden
      const code = e instanceof WelleFehler || e instanceof KatalogFehler ? e.code : 500;
      this.json(a, code, { fehler: (e as Error).message });
    }
  }

  // Plan Oberfläche T5: Raster der Fassung für die Deck-Welle (erster Schlag, erste Eins, Tempo, Länge). Liest nur.
  private fassungAus(url: URL, a: http.ServerResponse): void {
    try {
      const q = fassungQuelle(this.opt.bestand, url.searchParams.get('material') ?? '', Number(url.searchParams.get('bpm')), Number(url.searchParams.get('fassung')));
      const j = JSON.parse(fs.readFileSync(path.join(path.dirname(q.datei), 'fassung.json'), 'utf8')) as Record<string, unknown>;
      this.json(a, 200, { erster_schlag_frame: j.erster_schlag_frame, erste_eins_quell_beat: j.erste_eins_quell_beat, basis_bpm: j.basis_bpm, frames: j.frames });
    } catch (e) {
      this.json(a, e instanceof WelleFehler ? e.code : 500, { fehler: (e as Error).message });
    }
  }

  private datei(pfad: string, a: http.ServerResponse): void {
    const rel = pfad === '/' ? 'index.html' : decodeURIComponent(pfad).replace(/^\/+/, '');
    const voll = path.resolve(OEFFENTLICH, rel);
    if (!voll.startsWith(OEFFENTLICH + path.sep) || !fs.existsSync(voll) || !fs.statSync(voll).isFile()) {
      return this.json(a, 404, { fehler: 'nicht_gefunden' });
    }
    a.writeHead(200, { 'content-type': TYPEN[path.extname(voll)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(voll).on('error', () => a.destroy()).pipe(a);
  }
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
    bestand: v.bestand ?? REPO_PFADE.bestand,
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
