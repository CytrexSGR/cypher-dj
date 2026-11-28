import { AblageFehler } from '../../project/storage.ts';
import { type Projekt, TEMPO_MAX, TEMPO_MIN, platzVonGruppe } from '../../project/model.ts';
import type { Quelle } from './core_path.ts';
import { SLOTS, type Slot, modulAmPlatz } from '../../project/live.ts';
import { kanalOffen } from '../../hand_operation.ts';
import { pultContainerPfad } from '../../../contract/pult.ts';
import { type Antwort, LIVE_SLUG, ProjFehler, liveSlotAntwort } from './session_helpers.ts';
import type { ProjSitzung } from './session.ts';

// Workbench shelf (A 2026-11-16): SAVE AS copies a module under a new name (the open one too: its project.json holds every change already), DELETE
// moves a module that is not open to the bin of the project folder (project/storage.ts entferne), so it can be put back by hand.
export function kopie(this: ProjSitzung, slug: unknown, name: unknown, quelle: Quelle): Promise<Antwort> {
  return this.seriell(async () => {
    this.riegel(quelle);
    const r = this.projekte.kopiere(slug as string, name as string);
    return { code: 200, j: { slug: r.slug, name: r.projekt.name } };
  });
}

export function loeschen(this: ProjSitzung, slug: unknown, quelle: Quelle): Promise<Antwort> {
  return this.seriell(async () => {
    this.riegel(quelle);
    if (this.offen?.slug === slug) throw new ProjFehler(409, 'projekt_offen', { text: 'the open module cannot be deleted; open another one first' });
    const r = this.projekte.entferne(slug as string);
    return { code: 200, j: { slug, papierkorb: r.papierkorb } };
  });
}

export function oeffnen(this: ProjSitzung, slug: unknown, quelle: Quelle, bestaetigt = false): Promise<Antwort> {
  return this.seriell(async () => {
    this.riegel(quelle); this.sperreOeffnen(); this.sperreLiveLaeuft(quelle, bestaetigt); this.sperreFremderTransport(quelle);
    return this.oeffnetGerade(() => this.oeffneIntern(slug as string, quelle));
  }).then(async (r) => {
    if (r.code !== 200 || !this.liveFaderLauf) return r;
    const fader = await this.liveFaderErgebnis();
    if (fader.angehoben.length === 0 && fader.gemeldet.length === 0) return r;
    return { code: 200, j: { ...r.j as object, ...(fader.angehoben.length ? { projekt: this.offen?.projekt } : {}), fader } };
  });
}

// SAVE VERSION: a named copy of the current state. Pending hand values are written first (rueckwegSpeichern) so the copy is the current state.
export function versionSichern(this: ProjSitzung, name: string, quelle: string): Promise<{ id: string }> {
  return this.seriell(async () => {
    this.riegel(quelle as Quelle);                                     // Stop Cypher holds this write back like the others
    const o = this.brauchOffen();
    this.rueckwegSpeichern();
    return { id: this.projekte.versionen.sichereBenannt(o.slug, name) };
  });
}

// RESTORE: close the open project (flushes the write-back), restore at storage level (safety version first), reopen the same slug. Guarded exactly
// like opening another project (a recording, a running live transport or a foreign transport refuse it), entered once in the chain like oeffnen().
// Closing first is on purpose: the open path reloads the core (the restored file carries wiedergabe_rev 0, so istWiederanlauf cannot skip it), and
// the write-back of the close cannot overwrite the restored file. A failed restore reopens the project anyway and rethrows.
export function versionZurueck(this: ProjSitzung, id: string, quelle: string): Promise<{ gesichert_als: string }> {
  const q = quelle as Quelle;
  return this.seriell(async () => {
    this.riegel(q); this.sperreOeffnen(); this.sperreLiveLaeuft(q, false); this.sperreFremderTransport(q);
    const slug = this.brauchOffen().slug;
    this.projekte.pruefeVersion(slug, id);   // unknown or invalid: refused before anything is closed (no transport stop, no core reload)
    let ergebnis: { gesichert_als: string } | null = null, fehler: unknown = null;
    await this.oeffnetGerade(async () => {
      await this.schliesseOffen(q);
      try { ergebnis = this.projekte.stelleWiederHer(slug, id, q); } catch (e) { fehler = e; }
      await this.oeffneIntern(slug, q);
      return { code: 200, j: {} };
    });
    if (fehler !== null) throw fehler;
    this.ctx.log({ typ: 'proj_version_zurueck', slug, id, quelle: q });
    return ergebnis as unknown as { gesichert_als: string };
  });
}

// POST /proj/schliessen: closes the open project on purpose (guarded like an open; a running transport is stopped as on a switch). Nothing open: a no-op.
export function schliessen(this: ProjSitzung, quelle: Quelle, bestaetigt = false): Promise<Antwort> {
  return this.seriell(async () => {
    this.riegel(quelle); this.sperreOeffnen(); this.sperreLiveLaeuft(quelle, bestaetigt); this.sperreFremderTransport(quelle);
    const slug = this.offen?.slug ?? null;
    if (slug === null) return { code: 200, j: { slug: null } };
    await this.oeffnetGerade(() => this.schliesseOffen(quelle).then(() => ({ code: 200, j: {} })));
    for (const h of this.offenHaken) try { h(null); } catch (e) { this.ctx.log({ typ: 'proj_offen_haken_fehler', fehler: (e as Error).message }); }
    this.ctx.log({ typ: 'proj_geschlossen', slug, quelle });
    return { code: 200, j: { slug } };
  });
}

// POST /live/oeffnen (plan live-module task 1): open the live container (slug `live`), creating it on the first call (flag live, loop region on, 0..64).
// Already open: nothing is reopened (a reopen would stop the set); the answer is the same. Opening it from another project is guarded like any open.
// nurWennLeer (loop deck writes): the container is opened or created only if no project is open when this job's turn comes; any other open project
// (also one that was opened by a job queued before this one) is 409 projekt_offen and nothing changes
export async function liveOeffnen(this: ProjSitzung, quelle: Quelle, bestaetigt = false, nurWennLeer = false): Promise<Antwort> {
  const r = await this.liveOeffnenOhneTempo(quelle, bestaetigt, nurWennLeer);
  if (r.code === 200) {
    await this.liveTempo(quelle);
    const fader = await this.liveFaderErgebnis();
    if (fader.angehoben.length > 0 || fader.gemeldet.length > 0) return { code: 200, j: { ...r.j as object, fader } };
  }
  return r;
}

// The result of the module fader migration for the open that just happened (started by oeffneIntern); a call on the open container runs it again,
// so a slot that was only reported (channel open, or unknown) is raised as soon as its channel is closed and known.
export async function liveFaderErgebnis(this: ProjSitzung): Promise<{ angehoben: string[]; gemeldet: string[] }> {
  const lauf = this.liveFaderLauf;
  this.liveFaderLauf = null;
  return lauf ? lauf : this.liveModulFader();
}

// Is pad/<n> open as the server sees it: the rows of the core (kanalOffen) or a planned or running ramp of Cypher (hook of the server)
export function kanalOffenGesehen(this: ProjSitzung, kanal: string): boolean {
  const w = (n: string): number | undefined => this.lage.reglerWert(`${kanal}/${n}`) ?? undefined;
  return kanalOffen({ [`${kanal}/fader`]: w('fader') as number, [`${kanal}/trim`]: w('trim') as number }, kanal) || (this.kanalHaken?.(kanal) ?? false);
}

// The strip of a container sounds or is monitored: open by trim + fader or a planned ramp (kanalOffenGesehen), or PFL on (the gate of a place change)
export function kanalBelegtGesehen(this: ProjSitzung, kanal: string): boolean {
  return this.kanalOffenGesehen(kanal) || (this.lage.reglerWert(`${kanal}/pfl`) ?? 0) >= 0.5;
}

// DJ view places, decision 9: the module group fader is 0 dB from now on, the channel fader of pad/N is the only gain. A live project from before has
// its module group at -200. The migration happens ONCE per open of the live project: on the open the group goes to 0 dB when pad/N is closed (kanalOffen
// false, no ramp planned) and its fader is known. Otherwise (channel open, ramping or unknown) the group is remembered as waiting and reported.
// A row of pad/N (or a call of /live/oeffnen on the open container) raises only waiting groups, only while the live playback is stopped and only when
// the channel is closed and known then; once raised a group is not waiting any more, so an undo or a deliberate -200 holds. A refused write (a freeze is
// running) leaves the group waiting, with one log entry per group. One undo step; never fails the open.
export function liveModulFader(this: ProjSitzung, modus: 'oeffnen' | 'wartend' = 'wartend'): Promise<{ angehoben: string[]; gemeldet: string[] }> {
  const lauf = this.liveFaderKette.then(() => this.liveModulFaderLauf(modus));
  this.liveFaderKette = lauf.catch(() => undefined);
  return lauf;
}

// slot A..D = the container letter of a place (1..4); the channel is the container strip of that place
export function slotGruppe(this: ProjSitzung, p: Projekt, slot: Slot): Projekt['gruppen'][number] | undefined {
  const id = modulAmPlatz(p, slot);
  return id === undefined ? undefined : p.gruppen.find((x) => x.id === id);
}

export function kanalZuUndBekannt(this: ProjSitzung, slot: Slot): boolean {
  const p = this.offen?.projekt, g = p && this.slotGruppe(p, slot), platz = p && g ? platzVonGruppe(p, g.id) : null;
  if (platz === null || platz === undefined) return false;
  const kanal = pultContainerPfad[platz - 1];
  return this.lage.reglerWert(`${kanal}/fader`) !== null && !this.kanalOffenGesehen(kanal);
}

export function liveFaderFaellig(this: ProjSitzung): boolean {
  const o = this.offen;
  if (!o?.projekt.live || this.liveFaderWartend.size === 0 || this.liveSpielt()) return false;
  return SLOTS.some((slot) => {
    const g = this.slotGruppe(o.projekt, slot);
    return !!g && this.liveFaderWartend.has(g.id) && this.kanalZuUndBekannt(slot);
  });
}

export async function liveModulFaderLauf(this: ProjSitzung, modus: 'oeffnen' | 'wartend'): Promise<{ angehoben: string[]; gemeldet: string[] }> {
  const aus = { angehoben: [] as string[], gemeldet: [] as string[] };
  for (let versuch = 0; versuch < 2; versuch++) {
    aus.angehoben.length = 0; aus.gemeldet.length = 0;
    const o = this.offen;
    if (!o?.projekt.live) return aus;
    const befehle: unknown[] = [];
    const hebt: string[] = [];
    for (const slot of SLOTS) {
      const g = this.slotGruppe(o.projekt, slot);
      if (!g) continue;
      if (modus === 'oeffnen' ? g.fader_db === -200 : this.liveFaderWartend.has(g.id)) {
        if (g.fader_db !== -200) { this.liveFaderWartend.delete(g.id); continue; }   // moved by hand meanwhile: nothing to do
        if (this.kanalZuUndBekannt(slot) && (modus === 'oeffnen' || !this.liveSpielt())) {
          befehle.push({ befehl: 'gruppenspur_aendern', gruppe_id: g.id, fader_db: 0 });
          aus.angehoben.push(slot); hebt.push(g.id);
        } else { this.liveFaderWartend.add(g.id); aus.gemeldet.push(slot); }
      }
    }
    if (befehle.length === 0) return aus;
    try {
      await this.aendern({ rev: o.projekt.rev, label: 'Live module fader 0 dB', befehle }, 'andreas');
      for (const id of hebt) this.liveFaderWartend.delete(id);
      return aus;
    } catch (e) {
      if (versuch === 1 || (e as { fehler?: string }).fehler === 'beschaeftigt') {
        for (const id of hebt) {
          this.liveFaderWartend.add(id);
          if (this.liveFaderGemeldet.has(id)) continue;
          this.liveFaderGemeldet.add(id);
          this.ctx.log({ typ: 'live_modul_fader_fehler', gruppe: id, fehler: (e as Error).message });
        }
        return { angehoben: [], gemeldet: aus.gemeldet.concat(aus.angehoben) };
      }
    }
  }
  return aus;
}

// The live container follows the core tempo (display and render length only: the project says 120, the core plays 128). Only while no deck plays,
// because tempo_setzen is refused then; with a playing deck it stays as it is. Never fails the open.
export async function liveTempo(this: ProjSitzung, quelle: Quelle): Promise<void> {
  const o = this.offen, bpm = this.lage.uhr?.bpm;
  if (!o?.projekt.live || typeof bpm !== 'number' || !(bpm >= TEMPO_MIN && bpm <= TEMPO_MAX) || this.lage.deckLaeuft()) return;
  if (Math.abs(o.projekt.tempo_bpm - bpm) < 1e-9) return;
  const d = { rev: o.projekt.rev, label: 'Live tempo', befehle: [{ befehl: 'tempo_setzen', bpm }] };
  try { await this.aendern(d, quelle); } catch { /* shown tempo only */ }
}

export function liveOeffnenOhneTempo(this: ProjSitzung, quelle: Quelle, bestaetigt = false, nurWennLeer = false): Promise<Antwort> {
  return this.seriell(async () => {
    this.riegel(quelle);
    if (this.offen?.projekt.live) return { code: 200, j: { slug: this.offen.slug, slots: liveSlotAntwort(this.offen.projekt) } };
    if (nurWennLeer && this.offen) {
      throw new ProjFehler(409, 'projekt_offen',
        { text: 'A project is open. Open the live container first (LIVE); the loop deck never closes a project by itself.' });
    }
    this.sperreOeffnen(); this.sperreLiveLaeuft(quelle, bestaetigt); this.sperreFremderTransport(quelle);
    return this.oeffnetGerade(async () => {
      try {
        // a project named `live` without the flag is somebody's project: opening it as the container would be opened as the container (nothing is sent
        // before)
        if (this.projekte.lies(LIVE_SLUG).live !== true) {
          throw new ProjFehler(409, 'kein_liveprojekt_flag', { text: 'a project named live exists without the live flag; rename it' });
        }
      } catch (e) {
        if (e instanceof ProjFehler) throw e;
        if (!(e instanceof AblageFehler) || e.fehler !== 'unbekannt') throw e;
        const { slug } = this.projekte.lege('Live', { live: true });
        if (slug !== LIVE_SLUG) throw new ProjFehler(409, 'beschaeftigt', { text: 'the folder for the live container is taken by something else' });
      }
      const r = await this.oeffneIntern(LIVE_SLUG, quelle);
      if (r.code !== 200) return r;
      return { code: 200, j: { slug: LIVE_SLUG, slots: liveSlotAntwort(this.brauchOffen().projekt) } };
    });
  });
}

// The live container plays a loop in a set: while its transport runs (status 1 or 2) and a deck plays, opening or creating another project would
// stop it. Cypher is always refused; Andreas only with bestaetigt (the page's confirm), then the switch goes through and stops the transport as always.
export function sperreLiveLaeuft(this: ProjSitzung, quelle: Quelle, bestaetigt: boolean): void {
  const a = this.lage.arr;
  if (!this.offen?.projekt.live || !a || !(a.status === 1 || a.status === 2) || !this.lage.djLaeuft()) return;
  if (quelle === 'andreas' && bestaetigt) return;
  throw new ProjFehler(409, 'live_laeuft', { text: 'the live container is running while a deck plays; opening another project would stop it '
    + '(Andreas must confirm, Cypher cannot)' });
}

// Spec 6.31: Öffnen lädt die Wiedergabe des Projekts in den Kern, und jedes Laden bricht einen laufenden Freeze ab (6.23). Geprüft in der
// Kette, also gegen die Sperre zu dem Zeitpunkt, an dem das Öffnen wirklich läuft; vor lege(), damit ein abgelehntes neu() keinen Ordner anlegt.
export function sperreOeffnen(this: ProjSitzung): void {
  if (this.sperren > 0) throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; opening or creating a project waits until it is done' });
}

// Spec 6.37 (Andreas F13, REVIEW-5-opus M1: schliesseOffen stoppte jeden laufenden Transport mit der Quelle des Wechsels): Cypher öffnet oder
// legt kein Projekt an, solange ein Transport läuft, den sie nicht selbst gestartet hat (auch unbekannt, etwa nach einem Server-Neustart, und
// Andreas' Hand-Taste); nichts wird gestoppt. Andreas' eigener Wechsel stoppt wie bisher, Cyphers Wechsel über ihren eigenen Lauf stoppt ihren.
// Geprüft in der Kette vor lege() und vor jedem await des Öffnens, also unmittelbar vor dem Stopp in schliesseOffen.
export function sperreFremderTransport(this: ProjSitzung, quelle: Quelle): void {
  if (!this.fremderLauf(quelle)) return;
  throw new ProjFehler(409, 'transport_laeuft', { text: 'a transport Andreas started is running; Cypher opens or creates a project only after it stops' });
}

// Spec 6.37: läuft oder wartet ein Transport (status 1 oder 2), den nicht Cypher gestartet hat, während Cypher (Quelle cypher) handeln will?
// Andreas' Seite, seine Hand-Taste und ein unbekannter Starter (null, etwa nach einem Server-Neustart) zählen als seiner.
export function fremderLauf(this: ProjSitzung, quelle: Quelle): boolean {
  const a = this.lage.arr;
  return quelle === 'cypher' && !!a && (a.status === 1 || a.status === 2) && this.transportQuelle !== 'cypher';
}

// Spec 6.32: zwischen Öffnen und Freeze gewinnt, wer zuerst kommt. Öffnen und Anlegen haben Wartestellen (Stopp-Quittung des laufenden Projekts,
// Wiederanlauf-Prüfung); solange sie laufen, lehnt sperreLaden() ab. Zählt nur, was in der Kette schon läuft: ein wartendes Öffnen prüft die
// Sperre selbst, wenn es dran ist (sperreOeffnen).
export async function oeffnetGerade(this: ProjSitzung, f: () => Promise<Antwort>): Promise<Antwort> {
  this.oeffnet += 1;
  try { return await f(); } finally { this.oeffnet -= 1; }
}

export async function oeffneIntern(this: ProjSitzung, slug: string, quelle: Quelle): Promise<Antwort> {
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
  this.gleicheDekodiertAb(projekt, true, slug);   // the slug: this.offen is still the project before
  const merk = { laden: false, loop: false, tempo: false, reglerNach: [], stummStart: [], stifte: false };
    this.offen = { slug, projekt, verlauf: o.verlauf, merk, vorhoeren: new Map() };
  this.liveFaderWartend.clear(); this.liveFaderGemeldet.clear();
  // every open of the live project (queued behind this job)
  this.liveFaderLauf = projekt.live ? Promise.resolve().then(() => this.liveModulFader('oeffnen')) : null;
  this.meldeStand(this.offen);               // 1.8 S3 (D13): the core follows the opened project (tracks of the one before are disarmed)
  this.meldeEinsammeln(this.offen);
  this.hosts.abgleich(projekt);              // plan 1.11 task 7: the hosts start in the background; open never waits for one
  this.instrumente.abgleich(projekt);        // plan 1.11 task 17: the same for the plugin instrument hosts
  this.wacheStart();
  void this.surge.gleiche(projekt, true);                       // 1.9 U5: the Surge map of the opened project goes to the hosts (all entries)
  // AK34 / D6: a project open or new ends every override in the core (the override is never part of a project); the mirror starts empty
  this.uebersteuert.clear();
  this.aufAuto.verwirf();                    // D6: no track stays armed, no open take reaches the new project
  this.basisWartend.clear();
  // source andreas like nachNeustart: server housekeeping, Stop Cypher does not hold it back
  const autoFrei = Promise.all([this.autoFreiMitLog(), this.armFreiMitLog()]);
  // Spec 6.21: die Wiedergabe-Nummer entscheidet, wer beim Mixer gewinnt (gleiche Nummer: Wiederanlauf, die Spur-Regler des Kerns gewinnen)
  const abMarke = this.masterAbMarke.lies();   // a master A/B the page server died in
  const wieder = await this.istWiederanlauf(projekt);
  const abPfade = wieder && abMarke?.slug === slug ? new Set(abMarke.pfade) : null;
  if (abMarke && !abPfade) this.masterAbMarke.loesche();   // not the playback the core still plays: this open sends every row anyway
  // S17: the saved sound goes back while the controls are synchronised (not after a page server restart in front of a running kern: it kept everything)
  const [kern, bk] = await Promise.all([this.synchronisiere(quelle, wieder),
    wieder || !projekt.baukasten ? Promise.resolve(null) : this.bk.wiederherstellen(projekt, quelle, { schonGeladenUeberspringen: true }), autoFrei]);
  if (wieder && projekt.baukasten) kern.baukasten = { uebersprungen: 'wiederanlauf' }; else if (bk) kern.baukasten = bk;
  if (projekt.live) {   // the playback is loaded: now the container sources (a refusal is reported, it never fails the open)
    const abgelehnt = await this.sendeContainer(projekt, 'beide', quelle);
    if (abgelehnt.length) { kern.container_abgelehnt = abgelehnt; this.ctx.log({ typ: 'proj_container_abgelehnt', abgelehnt }); }
  }
  if (wieder) {
    const n = this.uebernimmMixer(this.offen, abPfade ?? undefined);   // the rows A/B touched are not the core's to win
    kern.wiederanlauf = true; kern.mixer_uebernommen = n;
    if (abPfade) await this.stelleMasterAbHer(this.offen.projekt, abPfade, quelle);
  }
  const offenes = this.offen;
  this.ctx.log({ typ: 'proj_offen', slug, nachgezogen: o.nachgezogen, quelle, wiederanlauf: wieder });
  this.ctx.verteile({ a: 'proj', f: { slug, rev: offenes.projekt.rev, label: 'Open', quelle } });
  for (const h of this.offenHaken) try { h(slug); } catch (e) { this.ctx.log({ typ: 'proj_offen_haken_fehler', fehler: (e as Error).message }); }
  return { code: 200, j: { slug, projekt: offenes.projekt, kern } };
}

export async function schliesseOffen(this: ProjSitzung, quelle: Quelle): Promise<void> {
  const o = this.offen;
  if (!o) return;
  this.aufAuto.verwirf();
  this.leereVorhoeren(o);                                              // 1.14: the audition ends with the project (event {}, the new project loads its own)
  for (const h of this.schliessHaken) try { h(o.slug); } catch (e) { this.ctx.log({ typ: 'proj_schliess_haken_fehler', fehler: (e as Error).message }); }
  this.rueckwegSpeichern();                                            // Spec 6.30: wartende Rückweg-Werte gehören diesem Projekt
  if (this.lage.arr && (this.lage.arr.status === 1 || this.lage.arr.status === 2)) await this.kern.stopp(quelle);
  this.rueckwegSpeichern();                                            // Spec 6.31: auch, was während des Stopps kam (nach dem letzten await)
  await this.hostZustandSichern('schliessen');                         // plan 1.11 D8: the plugin states of the closing project (at most 3 s)
  this.rueckwegSpeichern();                                            // audit U03: hand values that came during that await (nothing awaits from here on)
  this.transportQuelle = null;
  this.offen = null;
  this.hosts.abgleich(null);                                           // the hosts of the closed project stop in the background
  this.instrumente.abgleich(null);                                     // first: the swap back to Surge is queued before the mirror asks for the slot
  this.wacheStopp();
  void this.surge.gleiche(null);                                       // 1.9 U5: the hosts go back to the values they had before this project's entries
  try { o.verlauf.schliesse(); } catch (e) { this.ctx.log({ typ: 'proj_verlauf_fehler', slug: o.slug, fehler: (e as Error).message }); }
}

export function schliesse(this: ProjSitzung): void {
  this.laneSpieler.halt();
  this.hosts.halt();
  this.instrumente.halt();
  this.aufAuto.beende();
  this.analysen?.stoppe();
  if (this.rueckwegTimer) { clearTimeout(this.rueckwegTimer); this.rueckwegTimer = null; }
  this.wacheStopp();
  this.rueckwegSpeichern();
  const o = this.offen;
  this.offen = null;
  if (o) try { o.verlauf.schliesse(); } catch { /* der Server endet ohnehin */ }
}
