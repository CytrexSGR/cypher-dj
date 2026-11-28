import path from 'node:path';
import { type AudioClip, HALL_FELDER, type Projekt, alleInserts } from '../../project/model.ts';
import { aendere } from '../../project/history.ts';
import { type Quelle, type Quittung, quittungAbgelehnt } from './core_path.ts';
import { type Soll, alleRegler, reglerZuBefehl } from './mapping.ts';
import { type Wiedergabe, WiedergabeFehler, schreibeWiedergabe, uebersetze } from '../../project/playback.ts';
import { abNachLauf } from '../../project/master_ab.ts';
import { geraetFx } from '../../devices_parameter.ts';
import { grundText } from '../../http/reasons.ts';
import { type Offen, ProjFehler, bkGraphenFehlen, reglerBefund, schlaf } from './session_helpers.ts';
import type { ProjSitzung } from './session.ts';

// Wiedergabe laden, Mixer-Regler (alle), Loop, Metronom, Leeren der KI-Maske; alles parallel, Quittungen abgewartet
// wiederanlauf (Spec 6.21, 6.30): der Kern gewinnt ganz. Keine neue Wiedergabe, kein Loop, kein Metronom; von den Spur-Reglern
// nur die mit unbekanntem Ist-Wert (für genau diese gewinnt das Projekt).
export async function synchronisiere(this: ProjSitzung, quelle: Quelle, wiederanlauf = false): Promise<Record<string, unknown>> {
  const o = this.brauchOffen();
  const soll: Soll[] = wiederanlauf ? this.unbekannteSpurRegler(o.projekt)
    : alleRegler(o.projekt, (pfad) => this.lage.reglerWert(pfad));   // free pool rows the core already holds at the default are left out
  // A switch is a fresh start (Andreas, 2026-11-02): the hand holder of the regulators written below ends first, in the same order as the writes.
  // Not on a restart of the page server in front of a running core (wiederanlauf): there the core wins. Only Andreas's own switch breaks his hand (D9):
  // when Cypher opens or creates, nothing is sent and the core's refusal stays visible in kern.regler_fehler.
  if (!wiederanlauf && quelle === 'andreas') await this.handFreiMitLog(soll, quelle);
  // Spec 6.32: die Sperre zusätzlich unmittelbar vor Laden und Loop (gesperrt: am Offen merken, nicht senden; die Freigabe holt es nach).
  // Die erste Linie ist sperreLaden(), das während eines Öffnens ablehnt; dies ist die zweite.
  const [wiedergabe, regler, loop, metronom, ki] = await Promise.all([
    wiederanlauf ? Promise.resolve({ nr: o.projekt.wiedergabe_rev, quittung: null, wiederanlauf: true }) : this.ladeOderMerke(quelle),
    this.kern.setzeReglerPakete(soll, quelle),
    wiederanlauf ? Promise.resolve(null) : this.loopOderMerke(o, quelle),
    wiederanlauf ? Promise.resolve(null) : this.kern.metronom(o.projekt, quelle), this.leereKiMaske()]);
  const bkFehlt = bkGraphenFehlen(o.projekt);   // arr-bk: a stage whose graph file is gone plays dry; the answer says which
  return { wiedergabe, regler: regler.ergebnis.length, regler_nicht_gesendet: regler.nicht_gesendet, ...reglerBefund(regler.ergebnis),
    loop, metronom, ki, ...(bkFehlt.length > 0 ? { bk_graph_fehlt: bkFehlt } : {}) };
}

// Spec 6.21: gleicht /zustand/arr.nr der wiedergabe_rev des Projekts, spielt der Kern genau dessen letzte Wiedergabe. Kennt der Server den
// Kern-Stand noch nicht (Start), wartet er höchstens arrFristMs auf /zustand/arr (der Kern meldet es mindestens mit 2 Hz); danach gilt: verschieden.
export async function istWiederanlauf(this: ProjSitzung, p: Projekt): Promise<boolean> {
  if (p.wiedergabe_rev <= 0) return false;
  for (let t0 = Date.now(); !this.lage.arr && Date.now() - t0 < this.arrFristMs;) await schlaf(10);
  return this.lage.arr !== null && this.lage.arr.nr === p.wiedergabe_rev;
}

// Spec 6.30: Spur-Regler, deren Ist-Wert der Server nicht kennt (der Kern schickt den Regler-Stand nur beim ersten Hallo einer Generation;
// ein Server, der binnen 5 s neu startet, bekommt ihn nicht). Für genau diese gewinnt beim Wiederanlauf das Projekt.
export function unbekannteSpurRegler(this: ProjSitzung, p: Projekt): Soll[] {
  return alleRegler(p).filter((r) => this.lage.reglerWert(r.pfad) === null);
}

// Ist-Werte der Spur-Regler, die der Kern gemeldet hat, als EINE Änderung ins Projekt (Quelle andreas, undo-fähig). Unbekannte Werte
// bleiben. Entscheidung E-a: der KI-Stopp senkt keinen Fader, jeder Ist-Wert ist eine Handbewegung oder der Projektstand.
export async function stelleMasterAbHer(this: ProjSitzung, p: Projekt, pfade: ReadonlySet<string>, quelle: Quelle): Promise<void> {
  try {
    const abgelehnt = (await this.kern.setzeRegler(abNachLauf(p, [...pfade]), quelle)).filter((r) => quittungAbgelehnt(r.quittung));
    if (abgelehnt.length) { this.ctx.log({ typ: 'proj_master_ab_neustart_abgelehnt', regler: abgelehnt }); return; }   // the marker stays: tried again
    this.masterAbMarke.loesche();
  } catch (e) { this.ctx.log({ typ: 'proj_master_ab_neustart_fehler', fehler: (e as Error).message }); }
}

export function uebernimmMixer(this: ProjSitzung, o: Offen, ausnahmen?: ReadonlySet<string>): number {
  const befehle: Record<string, unknown>[] = [];
  const pfade = [
    ...o.projekt.spuren.flatMap((s) => (['fader', 'pan', 'mute', 'solo'] as const).map((k) => `spur/${s.nr}/${k}`)),
    ...(o.projekt.gruppen ?? []).flatMap((g) => (['fader', 'pan', 'mute', 'solo'] as const).map((k) => `grp/${g.nr}/${k}`)),
    'pm/fader',
    // 1.10 slice 3: the sends of every existing track and group, and all controls of every existing return (Hall included)
    ...[...o.projekt.spuren.map((s) => `spur/${s.nr}`), ...(o.projekt.gruppen ?? []).map((g) => `grp/${g.nr}`)]
      .flatMap((st) => [1, 2, 3, 4].map((r) => `${st}/send/${r}`)),
    ...(o.projekt.returns ?? []).flatMap((r) => [...(['fader', 'pan', 'mute', 'solo'] as const).map((k) => `ret/${r.nr}/${k}`),
      ...['an', ...HALL_FELDER].map((k) => `ret/${r.nr}/hall/${k}`)])];
  for (const pfad of pfade) {
    if (ausnahmen?.has(pfad)) continue;
    const wert = this.lage.reglerWert(pfad);
    const b = wert === null ? null : reglerZuBefehl(o.projekt, pfad, wert);
    if (b) befehle.push(b.befehl);
  }
  if (!befehle.length) return 0;
  const meta = { quelle: 'andreas' as const, label: 'Mixer nach Wiederanlauf' };
  try {
    const w = aendere(o.verlauf, o.projekt, befehle as never, meta, this.haken(o), { transienten: this.transienten });
    if (!w.eintrag) return 0;
    w.projekt.wiedergabe_rev = o.projekt.wiedergabe_rev;
    o.projekt = w.projekt;
    this.meldeStand(o);
    this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: w.projekt.rev, label: meta.label, quelle: 'andreas' } });
    return befehle.length;
  } catch (e) {
    this.ctx.log({ typ: 'proj_wiederanlauf_fehler', slug: o.slug, fehler: (e as Error).message });
    return 0;
  }
}

// Spec 6.1: neue Wiedergabe-Nummer, Datei schreiben, /k/arr/laden; project.json führt die Nummer als wiedergabe_rev (ohne neue rev)
export async function ladeWiedergabe(this: ProjSitzung, quelle: Quelle, vorhoeren?: ReadonlyMap<string, string>): Promise<Record<string, unknown>> {
  const o = this.brauchOffen();
  try {
    const nr = this.schreibeNeueWiedergabe(o.projekt);
    if (typeof nr !== 'number') return nr;
    this.speichereStand(o);
    const ladeNr = this.schreibeVorhoerWiedergabe(o.projekt, vorhoeren ?? o.vorhoeren) ?? nr;
    return { nr: ladeNr, quittung: await this.ladeNr(ladeNr, quelle, nr) };
  } finally {
    o.merk.stummStart = [];   // the initial mute belongs to this one load (uebernimm); later loads leave the rows as they are
  }
}

// 1.14 comping (R8): while an audition is on, the core plays a second file next to the main playback. The main playback is written as always and is
// the only one that becomes p.wiedergabe_rev (restart guard: a core restart and a page-server restart both fall back to it). The audition file
// takes its own number from the same counter (the core addresses files by number: wiedergabe-<nr>.json), nobody keeps that number.
// null: no audition, or the translator refused it (then the main playback is loaded; the refusal is logged).
// `streng`: a refusal of the translator throws ProjFehler (the audition request answers with the reason) instead of falling back to the main playback.
export function schreibeVorhoerWiedergabe(this: ProjSitzung, p: Projekt, vorhoeren: ReadonlyMap<string, string>, streng = false): number | null {
  if (vorhoeren.size === 0) return null;
  const nr = this.zaehler.naechste();
  try {
    schreibeWiedergabe(this.arbeitsordner, this.uebersetzeFuer(p, nr, vorhoeren));
    return nr;
  } catch (e) {
    if (!(e instanceof WiedergabeFehler)) throw e;
    this.ctx.log({ typ: 'proj_vorhoeren_wiedergabe_fehler', grund: e.grund });
    if (streng) throw new ProjFehler(409, e.grund, { detail: e.message });
    return null;
  }
}

// The one place that sets the translator options of the live playback and of the export paths; only the live ones pass `vorhoeren`.
// `live`: the playback goes to the core (the host stages are written from the host manager); the export paths write no host stage as ready
export function uebersetzeFuer(this: ProjSitzung, p: Projekt, nr: number, vorhoeren?: ReadonlyMap<string, string>, live = true,
  ohneHost?: ReadonlySet<number>): Wiedergabe {
  const ohne = new Set([...(ohneHost ?? []), ...this.hosts.ausgelassen()]);   // plus the stages whose latency the core would refuse (latenz_zu_gross)
  // note editor B4: a translation for the live playback starts a new record of the files its clips were given (an audition is not that playback)
  const notenLive = live && !vorhoeren;
  this.notenRender?.beginne?.(notenLive);
  return uebersetze(p, {
    geraetFx, nr, audioOrdner: path.join(this.arbeitsordner, 'audio'), frames: (sha) => this.cache.frames(sha),
    transienten: this.transienten,
    arbeitsordner: this.arbeitsordner, ...(vorhoeren ? { vorhoeren } : {}),
    ...(this.notenRender ? { notenDatei: (c: AudioClip) => this.notenRender!.datei(c, notenLive) } : {}),
    ...(live && this.offen?.merk.stummStart.length ? { stummStart: new Set(this.offen.merk.stummStart) } : {}),
    ...(live ? { host: (slot: number) => this.hosts.stufe(slot), ...(ohne.size ? { ohneHost: ohne } : {}) } : {}) });
}

// plan 1.11 task 7: the host manager asks for a new playback (a host became ready, failed or changed its latency)
export function hostNeuLaden(this: ProjSitzung): void {
  void this.seriell(async () => {
    const o = this.offen;
    if (!o) return;
    if (this.sperren > 0) { o.merk.laden = true; return; }
    const w = await this.ladeWiedergabe('andreas');
    if (typeof w.nr !== 'number') this.ctx.log({ typ: 'host_neu_laden_abgelehnt', fehler: w.fehler });
    const q = w.quittung as { status: number; grund: string } | null | undefined;
    if (q && [4, 6, 7, 8].includes(q.status)) this.hosts.ladeAbgelehnt(q.grund);   // pdc_zu_lang: the stage with the most latency leaves the playback
  }).catch((e) => this.ctx.log({ typ: 'host_neu_laden_fehler', fehler: (e as Error).message }));
}

// The host slot -> strip map of a project, and the loads a change needs: an entry into a slot another strip held in the last playback (or released
// less than `latenz + 480` samples ago) waits for a load without that stage first (removal in one load, entry in a later one).
export function hostBelegung(this: ProjSitzung, p: Projekt): Map<number, string> {
  return new Map(alleInserts(p).filter((x) => x.insert.art === 'host').map((x) => [x.insert.slot, x.strangId] as const));
}

export async function ladeNr(this: ProjSitzung, ladeNr: number, quelle: Quelle, schluessel: number = ladeNr): Promise<Quittung> {
  const v = this.hostVorab.get(schluessel);
  this.hostVorab.delete(schluessel);
  if (v) {
    if (v.zwischen !== null) {
      await this.kern.laden(v.zwischen, quelle);
      for (const s of v.konflikt) this.hostFreiMs.set(s, Date.now());
    }
    const warte = Math.max(0, ...v.eintritt.map((s) => (this.hostFreiMs.get(s) ?? -Infinity) + (v.span.get(s) ?? 0) - Date.now()));
    if (warte > 0) await schlaf(warte);
  }
  const q = await this.kern.laden(ladeNr, quelle);
  if (v) for (const s of v.geraeumt) this.hostFreiMs.set(s, Date.now());
  return q;
}

// Wiedergabe-Datei zum Stand p mit der nächsten Nummer schreiben und p.wiedergabe_rev setzen (ohne Speichern, ohne Laden). Gibt die Nummer zurück
// oder, wenn der Übersetzer ablehnt, {nr: null, fehler, text}.
export function schreibeNeueWiedergabe(this: ProjSitzung, p: Projekt): number | Record<string, unknown> {
  // plan 1.11 task 7: a host slot that would change strips inside this load: first a playback without the entering stage, then this one
  const neuB = this.hostBelegung(p), konflikt = [...neuB].filter(([s, st]) => this.hostBelegt.has(s) && this.hostBelegt.get(s) !== st).map(([s]) => s);
  const eintritt = [...neuB.keys()].filter((s) => this.hostBelegt.get(s) !== neuB.get(s) || this.hostFreiMs.has(s));
  const geraeumt = [...this.hostBelegt.keys()].filter((s) => !neuB.has(s) || konflikt.includes(s));
  // samples -> ms, with a margin
  // the entry wait follows the latency of the stage that LEFT the slot (the one in the hosts map before the abgleich), not of the entering one
  for (const s of geraeumt) this.hostFreiLatenz.set(s, this.hosts.stufe(s).latenz);
  const span = new Map([...neuB.keys(), ...geraeumt].map((s) => [s, ((this.hostFreiLatenz.get(s) ?? this.hosts.stufe(s).latenz) + 480) / 48 + 30] as const));
  this.hosts.extrasSetzen(p);
  const zwischenNr = konflikt.length ? this.zaehler.naechste() : null;
  const nr = this.zaehler.naechste();
  let w;
  try {
    if (zwischenNr !== null) schreibeWiedergabe(this.arbeitsordner, this.uebersetzeFuer(p, zwischenNr, undefined, true, new Set(konflikt)));
    w = this.uebersetzeFuer(p, nr);                                       // Spec 6.14, 6.29: freeze.datei ist relativ zum Arbeitsordner
  } catch (e) {
    if (e instanceof WiedergabeFehler) {
      this.ctx.log({ typ: 'proj_wiedergabe_fehler', grund: e.grund });
      return { nr: null, fehler: e.grund, text: grundText(e.grund), detail: e.message };   // Spec 6.34: text englisch
    }
    throw e;
  }
  schreibeWiedergabe(this.arbeitsordner, w);
  p.wiedergabe_rev = nr;
  if (this.offen) this.offen.merk.stifte = false;   // the new file holds every pin of `p` (Kraken patch field)
  this.hostBelegt = neuB;
  if (neuB.size || geraeumt.length || this.hostFreiMs.size) this.hostVorab.set(nr, { zwischen: zwischenNr, konflikt, eintritt, geraeumt, span });
  return nr;
}

// Für vollziehe, unmittelbar vor der einen Speicherung: während der Freeze-Sperre (Spec 6.23, 6.30) merken statt schreiben, sonst die Wiedergabe
// zum neuen Stand schreiben. Rückgabe: {nr} zum Laden nach dem Speichern, {nr: null, aufgeschoben} oder {nr: null, fehler, text}.
export function bereiteWiedergabe(this: ProjSitzung, o: Offen, p: Projekt, vorhoeren: ReadonlyMap<string, string>): Record<string, unknown> {
  if (this.sperren > 0) { o.merk.laden = true; return { nr: null, aufgeschoben: true }; }
  const nr = this.schreibeNeueWiedergabe(p);
  if (typeof nr !== 'number') return nr;
  const v = this.schreibeVorhoerWiedergabe(p, vorhoeren);
  return v === null ? { nr } : { nr, laden: v };
}

// Entscheidung E-a (2026-10-20): der KI-Stopp senkt keinen Fader mehr, Cyphers Spuren stehen in keiner Maske. Beim Öffnen und nach einem
// Neustart des Kerns geht trotzdem spur/0 hinaus: ein Kern, der von einem früheren Server noch eine Spur-Maske trägt, verliert sie. Absender ist
// der Server (andreas), die Maske gehört dem Leitstand, nicht der KI.
export async function leereKiMaske(this: ProjSitzung): Promise<Record<string, unknown>> {
  const q = await this.kern.kiSpur('spur/0', 'andreas');
  return { kanaele: 'spur/0', quittung: q };
}
