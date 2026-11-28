// Restart state of the page server: the saved state, the restore plan, box FX and graph restore, the reopened project (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import path from 'node:path';
import type { Felder } from '../../../conductor/src/addresses.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { graphenNachNeustart } from '../../graphs.ts';
import { bkDefVonId } from '../../project/modular.ts';
import { NEUSTART_PLAN_VERSPAETUNG_MS, NEUSTART_FRISCH_FRAMES } from '../../server_kopf.ts';
import { leseNeustartStand, leseOffenesProjekt, NEUSTART_STAND_TOLERANZ_MS, systemstartMs, type NeustartStand, type NeustartPlan } from '../../server_kopf.ts';
import type { Wiederplan } from '../../server.ts';
import { Oberflaeche } from '../../server.ts';

// t_7f487235: the memory of the restore plan (FX type of units 1/2, FX assignments 1-3, loop boxes with owner and live offset, graphs with owner) on disk
// next to aktive_loops.json, written the same way (temp file, rename), so a restart of the page server does not lose what the plan after a kern restart
// is made of. Read on start into vomPlatte; the first word of the kern decides what becomes of it (vomKern). A missing or corrupt file is no stand.
export function neustartStandDatei(this: Oberflaeche): string { return path.join(this.hotcueOrdner(), 'neustart_stand.json'); }
export function ladeNeustartStand(this: Oberflaeche): void {
  let text: string | null = null;
  try { text = fs.readFileSync(this.neustartStandDatei(), 'utf8'); } catch { /* noch keine Datei */ }
  const p = leseNeustartStand(text);
  // The kern's state lives in /dev/shm: after a reboot (or djk-stop, which removes the file with it) no kern life exists that a file of before could belong to
  const start = this.opt.systemstartMs ?? systemstartMs();
  const grund = p === null ? null : p.geschrieben === undefined ? 'ohne_zeit' : p.geschrieben < start - NEUSTART_STAND_TOLERANZ_MS ? 'vor_systemstart' : null;
  if (p !== null && grund !== null) this.opt.log?.({ typ: 'neustart_stand_verworfen', grund, geschrieben: p.geschrieben ?? null, systemstart: start });
  this.vomPlatte = grund === null ? p : null;
}
export function uebernehmeNeustartStand(this: Oberflaeche, p: NeustartStand, gleicheGeneration: boolean): void {
  this.stand.fx = p.fx as (Felder | null)[];
  this.stand.fxZuweisung = p.fxZuweisung;
  this.stand.graphen_geladen = { ...p.graphen_geladen };
  for (const [o, q] of [[this.graphBesitzer, p.graphBesitzer]] as const) { for (const k of Object.keys(o)) delete o[k]; Object.assign(o, q); }
  if (p.plan) {
    this.offenerPlan = { fx: p.plan.fx.map((u) => ({ ...u, felder: u.felder as Felder })), fx3: p.plan.fx3, graphen: p.plan.graphen };
    if (gleicheGeneration && p.plan.faellig < Date.now() - NEUSTART_PLAN_VERSPAETUNG_MS) {
      // the page was away past the due time: the moment is gone, only the owners stay
      this.offenerPlan = null;
      this.opt.log?.({ typ: 'neustart_plan_verworfen', grund: 'ueberfaellig', faellig: p.plan.faellig });
    } else if (gleicheGeneration) {   // the kern the plan waited for: the same delayed restore, filtered by what the file kept, no later than due
      this.letzteBoxFxWieder = p.plan.faellig - Oberflaeche.BOX_FX_SPERRE_MS - 500;
      this.planNachholen(Math.max(500, p.plan.faellig - Date.now()));
    }
  }
  this.opt.log?.({ typ: 'neustart_stand_gelesen', generation: p.generation, plan: p.plan !== undefined });
}
// Called at every change of one of those memories; the write is coalesced (a knob turned on an FX unit echoes /e/fx many times a second)
export function merkeNeustartStand(this: Oberflaeche): void {
  if (this.planTimer || this.gestoppt) return;
  this.planTimer = setTimeout(() => { this.planTimer = null; this.sichereNeustartStand(); }, 300);
  this.planTimer.unref?.();
}
// The plan that waits for the guard time, as the file keeps it: without what was touched since (the marks do not survive a restart of this server)
export function planFuerPlatte(this: Oberflaeche, wartet = this.offenerPlanTimer !== null): NeustartPlan | null {
  const p = this.offenerPlan;
  if (!p || !wartet) return null;
  const an = (k: string) => this.angefasst.has(k);
  return { faellig: this.offenerPlanFaellig,
    fx: p.fx.filter((u) => !an(`fx:${u.einheit}`)), fx3: an('fx:3') ? null : p.fx3, graphen: p.graphen.filter((g) => !an(`graph:${g.kanal}`)) };
}
// After a restore was sent: at once, not after the coalescing. Until then the file holds the old generation, and a crash of this server without a stop
// would read it as "kern restarted again" and send the same restore twice
export function sichereNeustartStandSofort(this: Oberflaeche): void {
  if (this.planTimer) { clearTimeout(this.planTimer); this.planTimer = null; }
  this.sichereNeustartStand();
}
export function sichereNeustartStand(this: Oberflaeche, planWartete?: boolean): void {
  // Not before a kern has spoken (the file of the last run must not be overwritten by an empty stand) and not in the 500 ms before an accepted restore ran:
  // until then the file keeps the stand of the old kern, so a crash in between loses nothing. During the longer wait for the guard time it IS written, with
  // the current generation and the part of the plan that is still due, so a page restart inside the wait arms the same delayed restore.
  if (this.generation === null || this.vomPlatte !== null || this.wiederTimer) return;
  try {
    fs.mkdirSync(this.hotcueOrdner(), { recursive: true });
    const tmp = `${this.neustartStandDatei()}.${process.pid}.neu`;
    const roh = { v: 1, generation: this.generation, sample: this.kernSample, geschrieben: Date.now(), plan: this.planFuerPlatte(planWartete),
      fx: this.stand.fx, fxZuweisung: this.stand.fxZuweisung,
      graphBesitzer: this.graphBesitzer, graphen_geladen: this.stand.graphen_geladen };
    fs.writeFileSync(tmp, JSON.stringify(roh, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
    fs.renameSync(tmp, this.neustartStandDatei());
  } catch (err) { this.opt.log?.({ typ: 'neustart_stand_nicht_gesichert', text: (err as Error).message }); }
}
export function boxFxSchnappschuss(this: Oberflaeche): Wiederplan | null {
  const fx: { einheit: 1 | 2; felder: Felder; zuweisung: string[]; besitzer: string }[] = [];
  for (const e of [1, 2] as const) {
    const f = this.stand.fx[e - 1];
    const zu = Object.entries(this.stand.fxZuweisung[e - 1]).filter(([, an]) => an).map(([kanal]) => kanal);
    if (!f) continue;   // never set: nothing to bring back (a unit that is off keeps its kind, beats and parameters)
    fx.push({ einheit: e, felder: f, zuweisung: zu, besitzer: this.fxVon(e) ?? 'cypher' });
  }
  // FX3 (the remix insert on fx/3): only its assignments live in the page server's state; the graph on fx/3 is in the graph plan below
  const zu3 = Object.entries(this.stand.fxZuweisung[2]).filter(([, an]) => an).map(([kanal]) => kanal);
  const fx3 = zu3.length > 0 ? { zuweisung: zu3, besitzer: this.fxVon(3) ?? 'cypher' } : null;
  // channels of the open project's sound snapshot belong to the project restore (session.ts nachNeustart sends its knobs and graphs itself)
  const projektKanaele = (this.proj?.zugang.offen()?.projekt.baukasten ?? []).map((e) => bkDefVonId(e.id)?.kanal ?? '');
  const graphen = graphenNachNeustart(this.stand.graphen_geladen, this.graphBesitzer, projektKanaele);
  // t_7f487235: an empty snapshot (the stand was cleared by a restart that was too fast) falls back to the plan that is still waiting
  const leer = fx.length === 0 && fx3 === null && graphen.length === 0;
  if (leer && !this.offenerPlan) return null;
  return leer ? this.offenerPlan! : { fx, fx3, graphen };
}
// Plan the restore of the snapshot (taken before the stand was cleared); without an argument the snapshot is taken now
export function boxFxPlanen(this: Oberflaeche, vorab?: Wiederplan | null): void {
  const plan = vorab === undefined ? this.boxFxSchnappschuss() : vorab;
  if (!plan) return;
  const jetzt = Date.now();
  if (jetzt - this.letzteBoxFxWieder < Oberflaeche.BOX_FX_SPERRE_MS) {
    // Keep the plan and restore it once when the guard time is over (a later restart replaces the wait, so one accepted restart sends once)
    this.offenerPlan = plan;
    this.angefasst.clear();   // marks gathered from here on (box, FX, graph set during the wait) keep that part out of the delayed replay; the echoes of earlier restores drop out here (audit C01)
    this.planNachholen(Oberflaeche.BOX_FX_SPERRE_MS - (jetzt - this.letzteBoxFxWieder) + 500);
    this.merkeNeustartStand();   // the wait is on disk too
    this.opt.log?.({ typ: 'wiederherstellung_uebersprungen', grund: 'zu_schnell', seit_ms: jetzt - this.letzteBoxFxWieder });
    this.verteile({ a: 'wiederherstellung', f: { uebersprungen: true, grund: 'zu_schnell' } });
    return;
  }
  if (this.offenerPlanTimer) { clearTimeout(this.offenerPlanTimer); this.offenerPlanTimer = null; }
  this.offenerPlan = null;
  this.letzteBoxFxWieder = jetzt;
  this.angefasst.clear();
  const geplant = this.generation;   // MINOR-2: ist der Kern bis zum Auslösen ein anderer geworden, verpufft der Plan
  if (this.wiederTimer) clearTimeout(this.wiederTimer);
  this.wiederTimer = setTimeout(() => {
    this.wiederTimer = null;
    if (this.generation !== geplant) { this.offenerPlan = plan; this.opt.log?.({ typ: 'wiederherstellung_verworfen', geplant, jetzt: this.generation }); return; }   // kept for the next restart
    this.boxFxWieder(plan.fx, plan.fx3);
    this.graphWieder(plan.graphen);
    this.sichereNeustartStandSofort();   // the file was held back during the 500 ms, and still holds the old generation
  }, 500);
}
// The delayed restore of offenerPlan once, warteMs from now (the guard time is over then); another restart takes it over
export function planNachholen(this: Oberflaeche, warteMs: number): void {
  const gen = this.generation;
  this.offenerPlanFaellig = Date.now() + warteMs;
  if (this.offenerPlanTimer) clearTimeout(this.offenerPlanTimer);
  this.offenerPlanTimer = setTimeout(() => {
    this.offenerPlanTimer = null;
    if (this.generation !== gen || !this.offenerPlan) return;   // another restart took over: its own pass decides
    const p = this.offenerPlan;
    this.offenerPlan = null;
    this.letzteBoxFxWieder = Date.now();
    this.opt.log?.({ typ: 'wiederherstellung_nachgeholt' });
    this.boxFxWieder(p.fx, p.fx3);
    this.graphWieder(p.graphen);
    this.sichereNeustartStandSofort();   // the plan is done
  }, warteMs);
  this.offenerPlanTimer.unref?.();
}
export function planWartetFuehren(this: Oberflaeche, adresse: string, generation: number, sample: number): void {
  const w = this.planWartet;
  if (!w || (adresse !== '/k/willkommen' && adresse !== '/e/neustart')) return;
  if (generation !== w.generation) { this.planWartet = null; return; }   // another kern life took over: its own pass decides
  if (!Number.isFinite(sample)) return;
  if (adresse === '/k/willkommen') w.willkommen ??= sample;
  else if (adresse === '/e/neustart') w.neustart ??= sample;
  if (w.willkommen === undefined || w.neustart === undefined) return;
  this.planWartet = null;
  const dauer = w.willkommen - w.neustart;   // frames the kern has run since it restarted
  if (dauer < NEUSTART_FRISCH_FRAMES) { this.boxFxPlanen(w.plan); return; }
  this.offenerPlan = null;   // adopted from the file, but not the plan of this kern
  this.opt.log?.({ typ: 'wiederherstellung_uebersprungen', grund: 'kern_laenger_neu', dauer_frames: dauer });
}
export function boxFxWieder(this: Oberflaeche, 
  fx: { einheit: 1 | 2; felder: Felder; zuweisung: string[]; besitzer: string }[],
  fx3: { zuweisung: string[]; besitzer: string } | null): void {
  const nichtCypher = (besitzer: string) => !(besitzer === 'cypher' && this.kiGestoppt);   // Stop Cypher: Cyphers Teile bleiben weg
  const autoAus = !leseMusterStand(this.musterOrdner()).autonom;   // F7: wie fxRiegel, zum Zeitpunkt des Auslösens
  let n = 0;
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
    this.opt.log?.({ typ: 'fx_wieder', einheit: u.einheit, besitzer: u.besitzer, an: f.an === 1 ? 1 : 0, zuweisungen: u.zuweisung.length });   // fx_von.json bleibt: hier wird nicht fxVon(…, von) gerufen
    n++;
  }
  if (fx3 !== null) {   // AUTO off does not hold FX3 back: an assignment sounds only with a graph on fx/3, nothing runs out by itself
    if (!nichtCypher(fx3.besitzer)) this.opt.log?.({ typ: 'fx_wieder_ausgelassen', einheit: 3, grund: 'ki_gestoppt' });
    else if (this.angefasst.has('fx:3')) this.opt.log?.({ typ: 'fx_wieder_ausgelassen', einheit: 3, grund: 'neu_gesetzt' });
    else {
      for (const kanal of fx3.zuweisung) {
        this.kern.sende('/k/fx/zuweisung', { id: Number(++this.id), quelle: fx3.besitzer, einheit: 3, kanal, an: 1 });
        this.gesendet++;
      }
      this.opt.log?.({ typ: 'fx_wieder', einheit: 3, besitzer: fx3.besitzer, zuweisungen: fx3.zuweisung.length });
      n++;
    }
  }
  this.opt.log?.({ typ: 'wiederherstellung', stuecke: n });
}
// Kanban t_e998388c: load the graphs of the plan again. No default rows (vorgaben false): the knob rows are in the kern's restart state and the kern
// hands them to the graph when it attaches. Stop Cypher keeps Cypher's graphs away (B12, like boxes and FX); AUTO off does not, because a silent
// stream that Andreas holds would be worse than the graph he was hearing.
export function graphWieder(this: Oberflaeche, graphen: { kanal: string; name: string; besitzer: string }[]): void {
  for (const g of graphen) {
    const aus = (grund: string) => this.opt.log?.({ typ: 'graph_wieder_ausgelassen', kanal: g.kanal, name: g.name, grund });
    if (g.besitzer === 'cypher' && this.kiGestoppt) { aus('ki_gestoppt'); continue; }
    if (this.angefasst.has(`graph:${g.kanal}`) || (this.stand.graphen_geladen[g.kanal] ?? '') !== '') { aus('neu_gesetzt'); continue; }
    void this.graphSetzen({ kanal: g.kanal, name: g.name, vorgaben: false }, g.besitzer, { wieder: true }).then((r) => {
      if (r.code !== 200) { aus(String(r.j.fehler ?? r.code)); return; }
      const q = r.j.quittung as { status?: number } | null | undefined;
      this.opt.log?.({ typ: 'graph_wieder', kanal: g.kanal, name: g.name, besitzer: g.besitzer, status: q?.status ?? null });
    }).catch((e) => aus((e as Error).message));
  }
}
export function offenesProjektDatei(this: Oberflaeche): string { return path.join(this.hotcueOrdner(), 'offenes_projekt.json'); }
export function leseOffenesProjektDatei(this: Oberflaeche): string | null {
  let text: string | null = null;
  try { text = fs.readFileSync(this.offenesProjektDatei(), 'utf8'); } catch { /* nothing remembered yet */ }
  return leseOffenesProjekt(text);
}
export function merkeOffenesProjekt(this: Oberflaeche, slug: string | null): void {
  try {
    if (slug === null) { fs.rmSync(this.offenesProjektDatei(), { force: true }); return; }
    fs.mkdirSync(this.hotcueOrdner(), { recursive: true });
    const tmp = `${this.offenesProjektDatei()}.${process.pid}.neu`;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, slug }));
    fs.renameSync(tmp, this.offenesProjektDatei());
  } catch (err) { this.opt.log?.({ typ: 'offenes_projekt_nicht_gesichert', text: (err as Error).message }); }
}
export async function projektWiederOeffnen(this: Oberflaeche, slug: string | null): Promise<void> {
  if (slug === null) return;
  const scheitert = (grund: string): void => {
    this.opt.log?.({ typ: 'projekt_wieder_oeffnen_fehlgeschlagen', slug, grund });
    this.meldeTaktart();   // nothing came back: no project, so a stale meter file of the crash goes now
    this.ansageZeile = { text: `Could not reopen project ${slug}`, art: 'tat', von: 'cypher', zeit: Date.now() };
    this.verteile({ a: 'ansage', f: this.ansageZeile });
  };
  const frist = this.opt.wiederOeffnenFristMs ?? 15000;
  for (let t0 = Date.now(); this.kern.zustand !== 'verbunden'; await new Promise((r) => setTimeout(r, 50))) {
    if (this.gestoppt) return;
    if (Date.now() - t0 >= frist) return scheitert('kein_kern');
  }
  if (this.gestoppt || this.proj.sitzung.offen !== null) return;   // stopped meanwhile, or somebody opened a project first: theirs wins
  try {
    const r = await this.proj.sitzung.oeffnen(slug, 'andreas');
    if (r.code === 200) this.opt.log?.({ typ: 'projekt_wieder_geoeffnet', slug });
    else scheitert(String((r.j as { fehler?: unknown } | null)?.fehler ?? `code_${r.code}`));
  } catch (e) { scheitert((e as Error).message); }
}
