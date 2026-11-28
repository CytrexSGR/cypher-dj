import fs from 'node:fs';
import { GESTE_RUHE_MS } from './times.ts';
import { aendere } from '../../project/history.ts';
import { type Quelle, type Quittung, type ReglerErgebnis, quittungAbgelehnt, quittungOk } from './core_path.ts';
import { alleRegler, istMixerRegler, reglerZuBefehl } from './mapping.ts';
import { wiedergabeDatei } from '../../project/playback.ts';
import { istStromZeile } from '../../stream_alias.ts';
import { type Offen, RUECKWEG_MS, reglerBefund } from './session_helpers.ts';
import type { ProjSitzung } from './session.ts';

// --- Kern-Ereignisse (Haken ereignis, Spec 2.10) ---------------------------------------------------------------------
export function ereignis(this: ProjSitzung, adresse: string, f: Record<string, unknown>): void {
  const vorherGeneration = this.lage.generation;
  this.aufAuto.raeume();                       // a deleted track does not stay armed
  const { neustart } = this.lage.nimm(adresse, f);
  // 1.12 slice 3 (D6/D8): a new core generation clears the mirror (the new core overrides nothing); the first /k/willkommen since this server
  // started ends any override of a core that kept running (AK34, own start). A re-hello of the same generation changes nothing.
  if (adresse === '/e/ins_mess' || adresse === '/zustand/arr') this.hosts.ereignis(adresse, f);   // plan 1.11 task 7
  if (adresse === '/zustand/arr') this.laneSpieler.zustand(f);
  if (adresse === '/zustand/mod') this.laneSpieler.mod(f);   // strand 6 task 4.3: plugin targets of the modulators are played from here (D2)
  if (adresse === '/e/hand') this.reglerWeiter.ereignis(adresse, f);
  if (adresse === '/e/auto') this.nimmAuto(f);
  // a channel closed under a module at -200
  const padRegler = adresse === '/e/regler' && /^pad\/[12]\/(fader|trim)$/.test(String(f.pfad));
  if (padRegler && this.liveFaderFaellig()) void this.liveModulFader().catch(() => undefined);
  if (neustart || (adresse === '/k/willkommen' && vorherGeneration !== null && Number(f.generation) !== vorherGeneration)) {
    this.uebersteuert.clear();
    if (this.aufAuto.istArm()) this.ctx.verteile({ a: 'proj', f: { auto_arm: { modus: 'touch', spuren: [] } } });   // D11: the new core starts unarmed
    this.aufAuto.verwirf(); this.basisWartend.clear();
  }
  if (adresse === '/k/willkommen' && vorherGeneration === null) {
    void this.autoFreiMitLog();
    void this.armFreiMitLog();   // AK34 / D6: a core that kept running over a server restart is disarmed
  }
  // 1.12 slice 3 (task 8): the take collector. /zustand/arr (start, seam, stop), the hand points, the release of the hand
  if (adresse === '/zustand/arr') this.aufAuto.zustand(f);
  if (adresse === '/e/auto_punkt') this.aufAuto.handPunkt(f);
  // S1b K2: halter `huelle` is the state mirror of a cell envelope (INTERFACES 5.7): display only, never a hand, a release or a move to store
  const huelleSpiegel = adresse === '/e/regler' && f.halter === 'huelle';
  if (adresse === '/e/regler' && !huelleSpiegel && f.halter !== 'mensch') this.aufAuto.reglerFrei(String(f.pfad));
  if (adresse === '/e/regler' && !huelleSpiegel && this.basisWartend.size) {
    const w = this.basisWartend.get(String(f.pfad));
    if (f.halter === 'mensch') this.basisWartend.delete(String(f.pfad));            // the hand moved it again: its value is the truth now
    else if (w) { this.basisWartend.delete(String(f.pfad)); void this.basisSenden([w]).catch(() => undefined); }   // released: the base value can go
  }
  // D10: an armed track that plays keeps the hand value for the take, not for the project base value
  // M8 / C1: a row of a strom track also follows Cypher's moves (halter cypher, or plan:<id> of a ramp) into the project, coalesced like the hand, so a
  // later playback swap does not reset the fader. The one place where this lane writes a project from a core echo for Cypher.
  const stromHalter = f.halter === 'cypher' || String(f.halter).startsWith('plan:');
  if (adresse === '/e/regler' && (f.halter === 'mensch' || (stromHalter && istStromZeile(this.offen?.projekt ?? null, String(f.pfad))))
    && istMixerRegler(String(f.pfad)) && !this.aufAuto.unterdrueckt(String(f.pfad))) {
    // the follow-up keeps the source of the move that caused it
    this.rueckweg(String(f.pfad), Number(f.wert), f.halter === 'mensch' ? 'andreas' : 'cypher');
  }
  // /zustand/arr status 0 setzt transportQuelle bewusst nicht zurück; ein neuer Start überschreibt die Quelle.
  // Spec 6.37 (REVIEW-5-opus M2): die Hand-Taste am Gerät führt der Kern selbst aus (core_arr.cpp arr_hand_start_stopp) und meldet danach
  // /e/hand arr/start_stopp mit wert 1 (nur beim Druck; die Attrappe meldet auch das Loslassen mit 0). Ein Start oder Stopp dort gehört
  // Andreas: Cypher bedient ihn danach nicht (fremderLauf), bis Andreas stoppt und Cypher selbst wieder startet.
  if (adresse === '/e/hand' && f.pfad === 'arr/start_stopp' && Number(f.wert) >= 0.5) this.transportQuelle = 'andreas';
  // Entscheidung E-a (Andreas 2026-10-20: „stop cypher sollte nicht alles stoppen weil ich ja übernehme, du solltest dann nur nicht mehr eingreifen“):
  // Stop Cypher stoppt auch Cyphers eigenen laufenden Transport nicht mehr (vorher Spec 6.37: kiStoppTransport, /k/arr/stopp als andreas), der Kern
  // beendet ihn auch nicht (Arrangement::ki_stopp). Er gehört ab dem Stopp Andreas: Cypher bedient ihn danach nicht mehr, im Stopp nicht (Riegel,
  // ki_gestoppt), nach der Freigabe nicht (fremderLauf, transport_laeuft), bis Andreas ihn stoppt und Cypher neu startet. Ein noch WARTENDER Start von
  // Cypher (status 1) wird übergeben wie ein laufender, der Kern verwirft ihn aber (Quittung 7 ki_stopp, wie wartende Deck-Befehle): danach meldet
  // er status 0, und fremderLauf (nur status 1 oder 2) sperrt nichts mehr. Zweiter Weg, falls /e/ki verloren geht: das periodische /zustand/kern
  // (ki_gestoppt), aus dem auch server.ts den Riegel nachführt.
  const kiAn = adresse === '/e/ki' ? f.gestoppt : adresse === '/zustand/kern' ? f.ki_gestoppt : undefined;
  if (Number(kiAn) === 1 && this.transportQuelle === 'cypher') this.transportQuelle = 'andreas';
  if (neustart) { this.hostBelegt = new Map(); this.hostFreiMs.clear(); this.hostVorab.clear(); this.hosts.kernNeustart(); this.nachNeustart(); }
}

// Spec 3.4 Rückweg: Andreas' Hand an spur/<n>/* landet im Projekt (Quelle andreas). Spec 6.30: zusammengefasst. Je Pfad zählt der letzte Wert;
// gespeichert wird höchstens einmal je RUECKWEG_MS (das erste Ereignis nach einer Pause sofort), und eine Geste ist ein Verlaufseintrag: sie
// endet nach GESTE_RUHE_MS ohne Ereignis. Vorher speicherte jedes Hand-Ereignis das ganze Projekt.
export function rueckweg(this: ProjSitzung, pfad: string, wert: number, quelle: Quelle = 'andreas'): void {
  const o = this.offen;
  if (!o) return;
  const jetzt = Date.now();
  if (this.geste.offen !== o || jetzt - this.geste.letzteMs > GESTE_RUHE_MS) this.geste = { nr: this.geste.nr + 1, letzteMs: jetzt, labels: [], offen: o };
  this.geste.letzteMs = jetzt;
  this.rueckwegWartend.set(pfad, { wert, quelle });
  if (this.rueckwegTimer) return;
  this.rueckwegTimer = setTimeout(() => {
    this.rueckwegTimer = null;
    void this.seriell(async () => this.rueckwegSpeichern()).catch((e) => this.ctx.log({ typ: 'proj_rueckweg_fehler', fehler: (e as Error).message }));
  }, Math.max(0, this.rueckwegGespeichertMs + RUECKWEG_MS - jetzt));
  this.rueckwegTimer.unref();
}

// Die wartenden Werte als EINE Änderung der laufenden Geste (synchron: auch beim Schliessen des Projekts, damit der letzte Wert nicht verloren geht)
export function rueckwegSpeichern(this: ProjSitzung): void {
  const liste = [...this.rueckwegWartend];
  this.rueckwegWartend.clear();
  const o = this.offen, g = this.geste;
  if (!o || g.offen !== o || !liste.length) return;
  // one change per source (a log entry has one source; only equal sources coalesce within a gesture)
  const quellen = [...new Set(liste.map(([, v]) => v.quelle))];
  const proQuelle = new Map<Quelle, Record<string, unknown>[]>();
  for (const [p, v] of liste) {
    const b = reglerZuBefehl(o.projekt, p, v.wert);
    if (!b) continue;
    proQuelle.set(v.quelle, [...(proQuelle.get(v.quelle) ?? []), b.befehl]);
    if (!g.labels.includes(b.label)) g.labels.push(b.label);
  }
  if (!proQuelle.size) return;
  this.rueckwegGespeichertMs = Date.now();
  const label = (g.labels.length === 1 ? g.labels[0] : `Mixer: ${g.labels.map((l) => l.replace(/^Mixer: /, '')).join(', ')}`).slice(0, 200);
  for (const quelle of quellen) {
    const befehle = proQuelle.get(quelle);
    if (!befehle?.length) continue;
    try {
      const r = aendere(o.verlauf, o.projekt, befehle as never, { quelle, label }, this.haken(o), {
        schluessel: `rueckweg:${g.nr}`, transienten: this.transienten });
      if (!r.eintrag) continue;
      r.projekt.wiedergabe_rev = o.projekt.wiedergabe_rev;
      o.projekt = r.projekt;
      this.meldeStand(o);
      this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: r.projekt.rev, label, quelle } });
    } catch (e) { this.ctx.log({ typ: 'proj_rueckweg_fehler', pfade: liste.map(([p]) => p), fehler: (e as Error).message }); }
  }
}

// Spec 2.12: nach /e/neustart (neue Generation) die letzte Wiedergabe neu laden, Spur-Regler, Loop, Metronom und KI-Maske neu setzen.
// Spec 6.32, Ausnahme Kern-Neustart: nachNeustart lädt IMMER, auch während der Freeze-Sperre. Ein Neustart beendet jeden Freeze im Kern, es gibt
// nichts mehr abzubrechen, und ohne Laden spielte der neue Kern nichts. Pflicht für S3: kommt während eines Freeze ein Kern-Neustart oder geht
// der Kern verloren, endet der Freeze mit freeze_fehler und gibt die Sperre frei; einen neuen Freeze startet S3 nicht von selbst.
// Ist das Laden gemerkt (eine Änderung kam während der Sperre durch), ist die Datei zu wiedergabe_rev veraltet: dann eine neue schreiben.
// Nach dem gelungenen Laden sind die Merk-Flags erledigt (Laden und Loop gehen hier mit dem Stand von jetzt an den Kern), damit die Freigabe nicht
// noch einmal lädt. Das gemerkte Tempo bleibt: nachNeustart sendet kein Tempo, holeNach tut es nach der Freigabe.
// Spec 6.35 (E-a): nachNeustart setzt alle Spur-Regler aus dem Projekt, auch im KI-Stopp; Cyphers Spuren sind nicht ausgenommen.
export function nachNeustart(this: ProjSitzung): void {
  void this.seriell(async () => {
    for (const h of this.neustartHaken) try { h(); } catch (e) { this.ctx.log({ typ: 'proj_neustart_haken_fehler', fehler: (e as Error).message }); }
    const o = this.offen;
    if (!o) return;
    this.leereVorhoeren(o);                      // 1.14: the new core plays the main lane; wiedergabe_rev already holds every comp made during an audition
    const nr = o.projekt.wiedergabe_rev;
    const wiedergabe: Record<string, unknown> = !o.merk.laden && !o.merk.stifte && nr > 0 && fs.existsSync(wiedergabeDatei(this.arbeitsordner, nr))
      ? { nr, quittung: await this.kern.laden(nr, 'andreas') } : await this.ladeWiedergabe('andreas');
    if (typeof wiedergabe.nr === 'number' && quittungOk(wiedergabe.quittung as Quittung)) { o.merk.laden = false; o.merk.loop = false; }
    this.transportQuelle = null;
    this.containerGesendet = [null, null, null, null];   // the new core knows nothing of what it was told
    const containerNein = o.projekt.live ? await this.sendeContainer(o.projekt, 'beide', 'andreas', true) : [];   // all four again, like the graphs
    // Spec 6.31, 6.32: wartende Handwerte ins Projekt, unmittelbar vor dem Senden der Regler (nach der Lade-Quittung, kein await dazwischen),
    // damit auch, was während des Ladens kam, an den neuen Kern geht und Kern und Projekt denselben Wert haben
    this.rueckwegSpeichern();
    // No /k/hand/frei here: the cause of a core restart is unknown, and the server must never release Andreas's hand in his name (D9).
    const [regler, loop, metronom, ki] = await Promise.all([this.kern.setzeRegler(alleRegler(o.projekt), 'andreas'),
      this.kern.loop(o.projekt, 'andreas'), this.kern.metronom(o.projekt, 'andreas'), this.leereKiMaske()]);
    // S17: the sound snapshot again (a new kern knows no graph); source andreas like the controls above (Spec 6.35 E-a)
    const baukasten = o.projekt.baukasten ? await this.bk.wiederherstellen(o.projekt, 'andreas', { schonGeladenUeberspringen: false }) : undefined;
    this.ctx.log({ typ: 'proj_neustart', slug: o.slug, wiedergabe, ...(containerNein.length ? { container_abgelehnt: containerNein } : {}),
      ...reglerBefund(regler), loop, metronom, ki, ...(baukasten ? { baukasten } : {}) });
    this.meldeStand(o);                      // 1.8 S3 (D13): the new core gets arm, input, mode and monitor of every armed track
  }).catch((e) => this.ctx.log({ typ: 'proj_neustart_fehler', fehler: (e as Error).message }));
}

export function meldeStand(this: ProjSitzung, o: Offen): void {
  for (const h of this.standHaken) try { h(o.projekt); } catch (e) { this.ctx.log({ typ: 'proj_stand_haken_fehler', fehler: (e as Error).message }); }
}

export function meldeRegler(this: ProjSitzung, o: Offen, regler: ReglerErgebnis[]): void {
  const abgelehnt = regler.filter((r) => quittungAbgelehnt(r.quittung)), keinKern = regler.filter((r) => r.quittung === null);   // Spec 6.31
  if (abgelehnt.length || keinKern.length) {
    this.ctx.log({ typ: 'proj_uebernimm_regler', slug: o.slug, abgelehnt: abgelehnt.map((r) => r.pfad), kein_kern: keinKern.map((r) => r.pfad) });
  }
}

// audit U07: a Surge host that systemd restarted plays at its init values; without this watch it would stay there until the next command or freeze
export function wacheStart(this: ProjSitzung): void {
  if (this.wirtWache || !this.surge.an) return;
  this.wirtWache = setInterval(() => {
    const o = this.offen;
    if (o && this.surge.wirtGewechselt()) void this.surge.gleiche(o.projekt);
  }, this.wirtWacheMs);
  this.wirtWache.unref();
}
