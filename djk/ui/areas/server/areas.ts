// The wiring of the areas (Bereiche) in the constructor of Oberflaeche: everything the constructor does after the kern, router and hand objects stand.
// Moved unchanged out of the constructor (pure move); it runs at the same place, with the same locals handed in.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { alsFloat32, TransientenLager } from '../../project/transients.ts';
import { KernWeg } from '../proj/core_path.ts';
import { type Bereich } from '../../http/router.ts';
import { projBereich } from '../proj/area.ts';
import { geraeteBereich } from '../devices/area.ts';
import { lernenBereich } from '../learn/area.ts';
import { controllerBereich } from '../controller/sequences.ts';
import { pultBereich } from '../controller/pult_production.ts';
import { neuerTastenArm } from '../controller/tasten.ts';
import { hostlernenBereich } from '../hostlernen/area.ts';
import { HostSpeicher } from '../hostlernen/store.ts';
import { registerBereich, aktivesPult } from '../controller/register.ts';
import { presetInhaltVon, presetsBereich } from '../../presets/area.ts';
import { PresetSpeicher } from '../../presets/store.ts';
import { PresetVorhoerer } from '../../presets/prelisten.ts';
import { kollektionenBereich } from '../../collections/area.ts';
import { tagsBereich } from '../../tags/area.ts';
import { tagsHook } from '../../tags/hook.ts';
import { rangVon } from '../../collections/feste.ts';
import { sucheBereich } from '../suche/area.ts';
import { baueQuellen } from '../../suche.ts';
import { listeInstrumente, zeileVon as instrumentZeile } from '../../sampler/instrument.ts';
import { listeSchnitte, liesSchnitt } from '../../sampler/schnitt.ts';
import { ausgabeBereich } from '../proj/output.ts';
import { aufnahmeBereich } from '../proj/recording.ts';
import { versionenBereich } from '../proj/versionen.ts';
import { rettungBereich, starteRettung, gerettetListe as gerettetListeVon } from '../proj/recording_rettung.ts';
import { stemsBereich } from '../proj/stems.ts';
import { notenBereich } from '../proj/notes.ts';
import { NotenRender } from '../proj/notes_render.ts';
import { speichereModul, modulBasis } from '../../project/module_storage.ts';
import { bibliothekBereich } from '../live/library.ts';
import { projektWurzelVorgabe, Projekte } from '../../project/storage.ts';
import { echteQuellen, liesProjektDatei } from '../../tags/bezuege.ts';
import { samplerBereich, schnittKurz } from '../sampler/area.ts';
import { legeKitAusAudio } from '../../sampler/kit.ts';
import { wavKopf } from '../../project/recording.ts';
import { samplerKitBereich } from '../sampler/kit_routes.ts';
import { portabelBereich } from '../proj/portabel_routes.ts';
import { kitsBereich } from '../kits/area.ts';
import { mitschnittBereich } from '../mitschnitt/area.ts';
import { liveBereich } from '../live/export.ts';
import { loopdeckBereich } from '../live/loopdeck.ts';
import { sessionBereich } from '../live/session.ts';
import { loopsetsBereich } from '../live/loopsets.ts';
import { renderPegelMesser } from '../live/level.ts';
import { pluginsBereich } from '../plugins/area.ts';
import { PluginIndex } from '../../plugins/index.ts';
import { leseLoops } from '../../loops.ts';
import { REPO, REPO_PFADE, instanz, shmOrdner, kitsOrdnerVorgabe, loopOrdnerVorgabe, analyseVorgabe, importeOrdnerVorgabe, mitschnittOrdnerVorgabe, setmitschnittProgramm, notenProgramm, katalogUmgebung, vorhoerCacheVorgabe } from '../../paths.ts';
import { WerkstattAnalyse } from '../proj/analysis.ts';
import { kanalOffen } from '../../hand_operation.ts';
import { Katalog, katalogVorgabe } from '../../catalog.ts';
import { Quellen } from '../../sources.ts';
import { quellenBereich } from '../quellen/area.ts';
import { importeBereich } from '../importe/area.ts';
import { bibliothekBereich as katalogBereich } from '../bibliothek/area.ts';
import { KatalogJob, katalogNachImport } from '../../catalog_job.ts';
import { ImportDienst, erlaubteWurzeln } from '../../importe.ts';
import { Einsammler } from '../../project/einsammeln.ts';
import { baueNachExport } from '../../project/exporte.ts';
import { einsammelnBereich } from '../proj/einsammeln.ts';
import { dateienBereich } from '../proj/files.ts';
import { mediathekVorgabe } from '../../media_library.ts';
import { listeGraphen, graphenOrdner } from '../../graphs.ts';
import { modulBasisVon } from '../../server_kopf.ts';
import type { Oberflaeche } from '../../server.ts';
import type { ServerOptionen } from '../../server_kopf.ts';

export function verdrahteBereiche(this: Oberflaeche, opt: ServerOptionen, python: string, inst: string): void {
  // D1 S2 (Spec 3.4): Audio-Quellen über denselben Katalog wie der Browser. Spec 6.30: die Meldung bleibt zweizeilig (erst this.proj, dann melden),
  // weil stoppe() den Bereich braucht; S3 zieht seinen Anker auf diese zwei Zeilen nach.
  // Slice 3a: die Analyse-Ablage (Karten) und der Auftragsgeber der Analyse auf Abruf. Betrieb: Vorgabe $CYPHERDJ_ANALYSE bzw. ~/werkstatt/cypher-dj-analyse; eine
  // Prüfinstanz (a..i) hat keine Vorgabe und liest/schreibt die Ablage nur mit ausdrücklichem --analyse (sie berührt nie die echte).
  // A5: removable sources are collected into the project in the background, never while the transport runs or a deck plays
  this.quellen = new Quellen({ python, cwd: path.join(REPO, 'djk'), erreichbar: this.erreichbar, env: opt.samplerOrdner ? { CYPHERDJ_SAMPLER: opt.samplerOrdner } : undefined });
  this.router.melde(quellenBereich(this.bereichKontext(), this.quellen));   // A4: /quellen
  // browser plan 1: raw file import into the storage kind importe (or the open project's audio folder)
  // plan 7 task 12: the tags hook runs after the last good build, on the catalogue the tags area serves; a test instance only on its own /dev/shm catalogue
  const hookKatalog = opt.katalog ?? katalogVorgabe(opt.mediathek ?? mediathekVorgabe());
  const hookErlaubt = instanz() === '' || path.resolve(hookKatalog).startsWith(`/dev/shm/cypherdj-${instanz()}/`);
  const katalogEnv = katalogUmgebung(instanz(), opt.samplerOrdner ? { CYPHERDJ_SAMPLER: opt.samplerOrdner } : undefined);
  const hookEnv = { ...(katalogEnv ?? {}), ...(opt.katalog ? { CYPHERDJ_KATALOG: opt.katalog } : {}) };
  const nachLetztemBau = hookErlaubt ? tagsHook({ python, cwd: path.join(REPO, 'djk'), env: hookEnv, katalog: hookKatalog,
    tags: opt.tags?.pfad ?? path.join(path.dirname(hookKatalog), 'tags.sqlite'), log: (z) => opt.log?.(z) }) : undefined;
  this.katalogJob = new KatalogJob({ python, cwd: path.join(REPO, 'djk'), env: katalogEnv, importeOrdner: () => importeOrdnerVorgabe(), ...(nachLetztemBau ? { nachLetztemBau } : {}) });
  this.importDienst = new ImportDienst({ python, importeOrdner: () => importeOrdnerVorgabe(), projektAudioOrdner: () => { const o = this.proj.zugang.offen(); return o ? path.join(o.ordner, 'audio') : null; },
    nachImport: katalogNachImport(this.katalogJob, () => importeOrdnerVorgabe()) });   // an accepted import registers the importe folder once and asks for one build
  this.router.melde(importeBereich(this.bereichKontext(), this.importDienst, { port: () => this.opt.port }));   // /import/datei
  this.router.melde(katalogBereich(this.bereichKontext(), this.katalogJob));   // /bibliothek/bauen, /bibliothek/stand, /bibliothek/midi
  this.einsammler = new Einsammler({ wechselplatte: (p) => this.quellen.wechselplatte(p), frei: () => this.proj.sitzung.lage.arr !== null && this.proj.sitzung.lage.arr.status === 0 && !this.proj.sitzung.lage.djLaeuft(),   // the page's own question: deck, loop box, stream
    log: (z) => opt.log?.(z) });
  const analyseOrdner = opt.analyse !== undefined ? opt.analyse : analyseVorgabe(inst);
  const analysierer = analyseOrdner ? new WerkstattAnalyse({ python, cwd: REPO_PFADE.werkstatt, ablage: analyseOrdner, modul: opt.einleserModul, log: opt.log }) : null;
  // browser plan 6: the preset preview service (offline render, cache) and the headphone previewer; one store is shared with the PRESETS routes
  const presetSpeicher = opt.presets?.speicher ?? new PresetSpeicher(opt.presets ?? {});
  const presetVorhoerer = opt.presets?.vorhoerer ?? new PresetVorhoerer({ speicher: presetSpeicher, cacheOrdner: vorhoerCacheVorgabe(inst),
    loopsDatei: path.join(REPO, 'djk', 'starter', 'loops.json'), starterWavOrdner: path.join(os.homedir(), '.local', 'share', 'cypherdj', 'starter', 'klaenge', 'loops'),
    graphenOrdner: graphenOrdner(), kitOrdner: opt.kits ?? kitsOrdnerVorgabe(), log: (z) => opt.log?.({ typ: 'preset_vorhoeren', ...z }) });
  const presets = presetsBereich(this.bereichKontext(), { ...(opt.presets ?? {}), speicher: presetSpeicher, port: () => this.opt.port, vorhoerer: presetVorhoerer, spiele: opt.presets?.spiele ?? ((e, klick) => this.vorhoeren.spiele(e, klick)), neuerKlick: opt.presets?.spiele ? undefined : () => this.vorhoeren.neuerKlick(), projekt: () => this.proj.zugang.offen()?.projekt ?? null, graphVon: (kanal) => this.stand.graphen_geladen[kanal] });   // 1.9 (O28): built first, the project command preset_anwenden reads its store
  const pluginIndex = new PluginIndex({ python, ...opt.plugins, log: opt.log, bei: (scan) => this.bereichKontext().verteile({ a: 'plugins', f: { scan } }) });
  this.proj = projBereich(this.bereichKontext(), { pluginIndex: (id) => pluginIndex.finde(id), presetLies: (id) => presetInhaltVon(presets.speicher, id), katalog: opt.katalog ?? katalogVorgabe(opt.mediathek ?? mediathekVorgabe()), mediathek: opt.mediathek ?? mediathekVorgabe(),
    wirtOrdner: () => this.wirtBasis(), analyse: analyseOrdner, analysierer, bestand: opt.korrekturen !== undefined ? opt.korrekturen : (inst === '' ? opt.bestand : null), kanalOffen: (k) => this.kanalGeoeffnet(k), einsammler: this.einsammler, samplerOrdner: () => opt.samplerOrdner, ...opt.proj });
  this.router.melde(this.proj);
  // A5: the route uses the collector of the session (a test may hand its own through opt.proj)
  this.router.melde(einsammelnBereich(this.bereichKontext(), this.proj.zugang, { einsammler: opt.proj?.einsammler ?? this.einsammler,
    quellPfad: (sha, hinweis) => this.proj.sitzung.quellePfadVon(sha, hinweis), kitsOrdner: opt.kits ?? kitsOrdnerVorgabe() }));
  // browser plan 2: GET /proj/dateien and the project file actions. The recovered-take listing is plan 4's (areas/proj/recording_rettung.ts); a test may hand a stub through opt.proj.
  this.router.melde(dateienBereich(this.bereichKontext(), this.proj.zugang, { quellPfad: (sha, hinweis) => this.proj.sitzung.quellePfadVon(sha, hinweis),
    katalogName: (sha) => this.proj.sitzung.katalogQuelle(sha)?.name ?? null, katalogDa: () => fs.existsSync(opt.katalog ?? katalogVorgabe(opt.mediathek ?? mediathekVorgabe())), wurzel: () => opt.proj?.wurzel ?? projektWurzelVorgabe(inst),
    arbeitLaeuft: (opt.proj as { arbeitLaeuft?: () => boolean } | undefined)?.arbeitLaeuft ?? (() => this.ausgabe.ausgabe.zustand().lauf !== null || this.stems.stems.laeuft() || this.noten.analyse.laeuft()),   // a test may hand a stub
    gerettetListe: (opt.proj as { gerettetListe?: (ordner: string) => Promise<{ datei: string; spur_id: string; gerettet: true }[]> } | undefined)?.gerettetListe ?? ((o) => gerettetListeVon(o, (z) => opt.log?.(z))) }));
  this.ausgabe = ausgabeBereich(this.bereichKontext(), this.proj.zugang, { wirtOrdner: () => this.wirtBasis(),
    katalogPfad: (sha) => this.proj.sitzung.katalogQuelle(sha),
    nachExport: baueNachExport({ einsammler: opt.proj?.einsammler ?? this.einsammler, offen: () => this.proj.zugang.offen(),
      quellPfad: (sha, hinweis) => this.proj.sitzung.quellePfadVon(sha, hinweis), log: (z) => opt.log?.(z) }) });   // A5: keep three exports, collect   // Paket S3: /proj/freeze, /proj/export (Spec 3.4)
  this.router.melde(this.ausgabe);
  const tastenArm = neuerTastenArm();   // keys follow the focus (N1): session state shared by the controller area (decides) and the recording area (arms in the core)
  this.aufnahme = aufnahmeBereich(this.bereichKontext(), this.proj.zugang, { geraeteKonfig: opt.geraete?.konfigPfad, tasten: tastenArm });   // 1.8: /proj/aufnahme
  this.router.melde(this.aufnahme);
  let tagsB: ReturnType<typeof tagsBereich> | undefined;   // built further down; the stems hook reads it when a placement happens
  this.router.melde(versionenBereich(this.bereichKontext(), this.proj.sitzung));   // B10: /proj/versionen, /proj/version_sichern, /proj/version_zurueck
  this.router.melde(rettungBereich(this.bereichKontext(), this.proj.zugang));   // B11: POST /proj/gerettet_platzieren
  starteRettung(this.proj.zugang, this.bereichKontext());                       // B11: rescue left run files when a project opens
  this.stems = stemsBereich(this.bereichKontext(), this.proj.zugang, { python, cwd: REPO_PFADE.werkstatt, bezug: (a, v, n) => { tagsB?.speicher.meldeBezug(a, v, n); }, ...opt.stems });   // 1.13 S6
  this.router.melde(this.stems);
  const notenOpt = { programm: notenProgramm(), netz: [python, '-m', 'werkstatt.notes_net'] as string[] | null, cwd: REPO_PFADE.werkstatt,
    stemsLaeuft: () => this.stems.stems.laeuft(), ...opt.noten };
  // note editor B4: the render of a note edit is what a clip plays; the same program, environment and CPU mask as the detection. Wired in starte().
  this.notenRender = new NotenRender(this.bereichKontext(), this.proj.zugang, { programm: notenOpt.programm, netz: notenOpt.netz, cwd: notenOpt.cwd,
    neuLaden: () => this.proj.sitzung.ladeLiveNeuFrei(),
    ...(notenOpt.env ? { env: notenOpt.env } : {}), ...(notenOpt.cpus !== undefined ? { cpus: notenOpt.cpus } : {}), ...(notenOpt.spawn ? { spawn: notenOpt.spawn } : {}),
    ...(notenOpt.killMs !== undefined ? { killMs: notenOpt.killMs } : {}) });
  this.noten = notenBereich(this.bereichKontext(), this.proj.zugang, { ...notenOpt, render: this.notenRender });   // note editor B2: /proj/noten/*
  this.router.melde(this.noten);
  this.router.melde(liveBereich(this.bereichKontext(), this.proj.zugang, this.stems.stems, {   // plan live-module task 2: /modul/export, /modul/stems, /modul/stand
    loopOrdner: () => this.loopOrdner(),   // task 10: POST /modul/loop reads the loop library
    kanalOffen: (k) => this.kanalGeoeffnet(k),   // DJ view places task 7: an open channel refuses the export (PFL is no reason; a planned or running ramp counts)
    deckLoop: (deck) => this.deckLoopAusschnitt(deck), herkunft: (mid) => this.moduleHerkunft(mid), masterTonart: () => this.masterTonart(),
    samplerOrdner: () => opt.samplerOrdner,
    deckLaeuft: (n) => { const st = this.deckStand(n); return st !== null && Number(st.z.status) >= 2; },   // SEQ deck: POST /seq/anlegen refuses deck_laeuft
    // SEQ scenes: the bar target comes from the same-block /uhr + /zustand/arr pair of the session's lage, the parts go through the shared KernWeg
    szenen: { zielLage: (loop) => this.proj.sitzung.lage.zielLage(loop), szenenTeile: (plan, q, ab, zeilen) => this.kernWeg().szenenTeile(plan, q, ab, zeilen),
      abbruchPlan: (plan, q) => this.kernWeg().abbruchPlan(plan, q) },
    deckAufraeumen: (n, quelle) => { this.seqNachgeladen.delete(n); this.seqDeckAufraeumen(n, quelle, false); },   // SEQ deck: a new deck ejects a stopped, closed track of its place
    // task 3: every module is saved (at export, when the stems arrive, when the slot is cleared); the ramp of POST /modul/leeren reads the core clock
    nachExport: (e) => { speichereModul(e.projekt, e.gruppeId, { basis: modulBasisVon(opt.modulOrdner, inst) }); },
    nachStems: (e) => { speichereModul(e.projekt, e.gruppeId, { basis: modulBasisVon(opt.modulOrdner, inst) }); },
    midi: { python, cwd: REPO_PFADE.werkstatt, pegel: renderPegelMesser(this.proj.zugang) },   // task 8: MIDI of Drums and Bass (werkstatt.midi_aus_stem) for the new instrument paths
    leeren: { speichere: (p, gid) => speichereModul(p, gid, { basis: modulBasisVon(opt.modulOrdner, inst) }),
      kern: { uhr: () => (this.kern.uhr as { beat: number; bpm: number } | null),
        laeuft: () => { const st = this.proj.sitzung.lage.arr?.status; return st === 1 || st === 2; } } } }));
  // loop deck M4: /loopdeck/stand, /start, /stopp, /szene; the decoded length of a cell comes from the decode folder of the project
  const zellFrames = (sha: string): number | null => {
    try { const g = fs.statSync(path.join(this.proj.zugang.arbeitsordner(), 'audio', `${sha}.f32`)).size; return g >= 8 ? Math.floor(g / 8) : null; } catch { return null; }
  };
  // slice boundaries by transients (POST /session/scheiben): the same store beside the decoded .f32 as the project session's (content-addressed, atomic writes)
  const transientenLager = new TransientenLager(path.join(this.proj.zugang.arbeitsordner(), 'audio'));
  const loopdeck = loopdeckBereich(this.bereichKontext(), this.proj.zugang, {
    frames: zellFrames,
    liveOeffnen: (q) => this.proj.sitzung.liveOeffnen(q, false, true),   // M5 writes open or create the live container the way POST /live/oeffnen does
    loopOrdner: () => this.loopOrdner(), modulBasis: () => modulBasisVon(opt.modulOrdner, inst),
    katalogLoop: (sha) => this.katalogFuerDeck(sha), deckLoop: (deck) => this.deckLoopAusschnitt(deck) });
  this.router.melde(loopdeck);
  // session view M6: /session/*; the scene tempo uses the freeze lock like POST /tempo
  this.router.melde(sessionBereich(this.bereichKontext(), this.proj.zugang, loopdeck, { frames: zellFrames, transienten: (sha) => transientenLager.fuer(sha),
    kit: (a) => legeKitAusAudio({ name: a.name, daten: a.daten, quelle: a.quelle, scheiben: a.scheiben.map((r) => ({ von: Math.round(r.von_s * 48000), bis: Math.round(r.bis_s * 48000) })) },
      { kits: this.opt.kits ?? kitsOrdnerVorgabe() }),
    vorhoeren: async (a) => {   // slot audition: the previewer takes a file, so the rendered slot goes to a WAV named by its content (older ones are removed)
      const wav = Buffer.concat([wavKopf(a.daten.length / 2), Buffer.from(a.daten.buffer, a.daten.byteOffset, a.daten.byteLength)]);
      const dir = path.join(this.proj.zugang.arbeitsordner(), 'vorhoer'), id = crypto.createHash('sha256').update(wav).digest('hex').slice(0, 16);
      fs.mkdirSync(dir, { recursive: true });
      for (const n of fs.readdirSync(dir)) fs.rmSync(path.join(dir, n), { force: true });
      const pfad = path.join(dir, `slot-${id}.wav`);
      fs.writeFileSync(pfad, wav);
      await this.vorhoeren.spiele({ pfad, typ: 'oneshot', sha: `${a.sha}/${a.slot}`, bpm: null });
    },
    audio: (sha) => { try { return alsFloat32(fs.readFileSync(path.join(this.proj.zugang.arbeitsordner(), 'audio', `${sha}.f32`))); } catch { return null; } }, ladenGesperrt: () => this.proj.sitzung.ladenGesperrt() }));
  this.router.melde(loopsetsBereich(this.bereichKontext(), this.proj.zugang));   // loop deck S1b: /loopsets, /loopset/speichern, /loopset/laden (store kind loopsets)
  // plan live-module task 10: GET /module, POST /modul/einsetzen, POST /modul/speichern (the same store as above)
  this.router.melde(bibliothekBereich(this.bereichKontext(), this.proj.zugang, { basis: () => modulBasisVon(opt.modulOrdner, inst), kanalOffen: (k) => this.kanalGeoeffnet(k) }));
  // sampler A1 task 4: /sampler/*; loops and module folder of this instance, read at every request (the getters follow the options)
  this.router.melde(samplerBereich(this.bereichKontext(), { sitzung: this.proj.sitzung, zugang: this.proj.zugang, katalog: this.katalog,
    get ordner() { return opt.samplerOrdner; }, get loops() { return opt.loops ?? loopOrdnerVorgabe(inst); }, get module() { return modulBasisVon(opt.modulOrdner, inst); } }));
  this.router.melde(samplerKitBereich(this.bereichKontext(), { get ordner() { return opt.samplerOrdner; } }));   // sampler B task 2: /sampler/kit/vorschlag, /sampler/kit
  // browser plan 5: /kits (list, export, import; rename, copy, delete, preview and from-folder follow); the same kit folder as the sampler kit route
  this.router.melde(kitsBereich(this.bereichKontext(), { kitsOrdner: opt.kits ?? kitsOrdnerVorgabe(), projektOrdner: () => this.proj.zugang.offen()?.ordner ?? null, port: () => this.opt.port,
    projekteWurzel: () => this.opt.proj?.wurzel ?? projektWurzelVorgabe(instanz()),
    vorhoeren: async (wavPfad, sha) => {   // like the slot audition: the previewer takes a file from the work folder; older kit previews are removed
      const dir = path.join(this.proj.zugang.arbeitsordner(), 'vorhoer');
      fs.mkdirSync(dir, { recursive: true });
      for (const n of fs.readdirSync(dir)) if (n.startsWith('kit-')) fs.rmSync(path.join(dir, n), { force: true });
      const pfad = path.join(dir, path.basename(wavPfad));
      fs.copyFileSync(wavPfad, pfad);
      await this.vorhoeren.spiele({ pfad, typ: 'oneshot', sha, bpm: null });
    } }));
  // journey tours task 2: /mitschnitt (REC MIX): the recorder runs in its own user unit and only reads the core's ring
  this.router.melde(mitschnittBereich(this.bereichKontext(), { ordner: () => mitschnittOrdnerVorgabe(instanz()), zustandsDatei: path.join(shmOrdner(instanz()), 'mitschnitt.json'),
    programm: setmitschnittProgramm, instanz: instanz(), kernDa: () => this.kern.zustand === 'verbunden' }));
  // browser plan 5: /proj/export_zip and /proj/import_zip (a project as one zip)
  this.router.melde(portabelBereich(this.bereichKontext(), this.proj.zugang, { projekteWurzel: () => this.opt.proj?.wurzel ?? projektWurzelVorgabe(instanz()),
    quellPfad: (sha, hinweis) => this.proj.sitzung.quellePfadVon(sha, hinweis), kitsOrdner: opt.kits ?? kitsOrdnerVorgabe(), port: () => this.opt.port }));
  this.router.melde(pluginsBereich(this.bereichKontext(), pluginIndex, { insertParameter: (id) => this.proj.sitzung.insertParameter(id),
    insertFenster: (id, d, q) => this.proj.sitzung.insertFenster(id, d, q),
    geraetParameter: (id) => this.proj.sitzung.geraetParameter(id), geraetParam: (id, d, q) => this.proj.sitzung.geraetParam(id, d, q), geraetIst: (id, n) => this.proj.sitzung.geraetIst(id, n),
    geraetFenster: (id, d, q) => this.proj.sitzung.geraetFenster(id, d, q) }, { port: () => this.opt.port, erlaubt: () => erlaubteWurzeln() }));   // 1.11 task 10; plan 6: plugin folders (the roots of the folder picker): /plugins, the parameter list and the window
  let controllerAnstoss: () => void = () => {};   // set below: the devices file may change a place's follow flag or its device
  this.router.melde(geraeteBereich(this.bereichKontext(), { ...(opt.geraete ?? {}), beiAenderung: () => controllerAnstoss() }));   // I08: /geraete
  const lernBereich = lernenBereich(this.bereichKontext(), opt.lernen ?? {});
  this.router.melde(lernBereich);   // S19: /lernen
  this.proj.sitzung.reglerLernen = { pruefeBereit: () => lernBereich.pruefeBereit(), arme: (p) => lernBereich.arme(p), wartet: () => lernBereich.wartet(),
    abbrechen: () => lernBereich.abbrechen(), loesche: (p) => lernBereich.loesche(p),
    gelernt: () => new Set(lernBereich.speicher.lies().zuordnungen.map((z) => z.pfad)) };   // strand 2 task 2.4: the knob learn route of a plugin stage
  // controller presets and follow: /controller/*; re-resolves on the kern event /e/graph, on every change of the open project and on a change of the devices file
  const controller = controllerBereich(this.bereichKontext(), lernBereich, { geraeteKonfig: opt.lernen?.geraeteKonfig, werk: opt.lernen?.werkOrdner, nutzer: opt.lernen?.presetOrdner, zugang: this.proj.zugang, tasten: tastenArm });
  this.router.melde(controller);
  this.router.melde(pultBereich(this.bereichKontext(), { zugang: this.proj.zugang, pult: () => aktivesPult(inst) }));   // the APC20 in PRODUCTION: /controller/ansicht, /controller/pult (pult_production.ts)
  controllerAnstoss = () => { void controller.anstoss(); };
  this.proj.zugang.beiStand(() => controllerAnstoss());
  this.router.melde(hostlernenBereich(this.bereichKontext(), lernBereich, { ordner: lernBereich.speicher.ordner }));   // host learn: /lernen/host, host_ziele.json next to lernen.json
  this.router.melde(registerBereich(this.bereichKontext(), { ordner: lernBereich.speicher.ordner, aktiv: () => aktivesPult(inst), midiPort: () => lernBereich.midiPort(), host: () => new HostSpeicher(lernBereich.speicher.ordner).lies().ziele }));   // controller register: /register
  this.router.melde(presets);   // 1.16: /presets (presets/area.ts), built above so that the project command preset_anwenden reads its store
  this.router.melde(kollektionenBereich(this.bereichKontext(), opt.kollektionen ?? {}));   // 1.16 rest: /kollektionen (collections/area.ts)
  tagsB = tagsBereich(this.bereichKontext(), { katalog: opt.katalog ?? katalogVorgabe(opt.mediathek ?? mediathekVorgabe()),
    quellen: echteQuellen({ presets: presets.speicher, projekte: (() => { const pr = new Projekte(opt.proj?.wurzel ?? projektWurzelVorgabe(instanz())); return { wurzelPfad: pr.wurzelPfad, liste: () => pr.liste(), lies: (sl: string) => pr.lies(sl), liesAsync: (sl: string) => liesProjektDatei(pr.wurzelPfad, sl) }; })(),
      kitsOrdner: () => opt.kits ?? kitsOrdnerVorgabe(), loopOrdner: () => this.loopOrdner(), listeLoops: leseLoops,
      katalogSha: (mid) => this.katalogEintrag(mid)?.sha ?? null, schnitt: (id) => liesSchnitt(id, { ordner: opt.samplerOrdner }) }), ...(opt.tags ?? {}) });
  this.router.melde(tagsB);   // B19..B21: /tags, tags.sqlite next to the catalogue (tags/area.ts)
  this.tagsStopp = () => { tagsB?.bezuege?.stopp(); tagsB?.speicher.schliesse(); };   // close(): no further slice, then the tag store handle is closed
  // media browser B4: GET /suche asks the sources the shelf already has (catalogue, graphs, sampler lists, presets, modules), each with its own search
  this.router.melde(sucheBereich(this.bereichKontext(), {
    projekt: () => this.proj.zugang.offen()?.projekt ?? null,
    quellen: baueQuellen({
      katalog: this.katalog,
      fehlend: (typ) => this.katalog.ordnerSummen(typ).ordner.filter((o) => !this.erreichbar.ordnerDa(o.pfad)).map((o) => o.pfad),
      rang: () => rangVon(this.kollektionSpeicher()),
      zeile: (z, favorit) => ({ ...this.stoebernTreffer(z, new Set()), favorit }),
      graphen: () => listeGraphen(undefined, { ordner: opt.samplerOrdner }).graphen,
      instrumente: () => listeInstrumente({ ordner: opt.samplerOrdner }).map(instrumentZeile),
      schnitte: () => listeSchnitte({ ordner: opt.samplerOrdner }).map(schnittKurz),
      presets: (q) => presets.speicher.liste({ q }).map(({ notiz: _n, ...e }) => e),
      module: () => this.proj.sitzung.liste().j as unknown as Record<string, unknown>[],
    }),
  }));
}
