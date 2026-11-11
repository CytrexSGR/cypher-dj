// Plan 1.11 task 17: the hosts of foreign INSTRUMENT plugins (a track with geraet {art: 'wirt', name: 'plugin'}). They run in the production slots of Surge
// (unit cypherdj-wirt-arr<slot>, status file wirt-arr<slot>.json, socket wirt-arr<slot>.sock), started by `djk-instrumente start arr<slot> plugin:<spec>`;
// the playback of such a track is the one of a Surge track on that slot. This manager only starts the host in the background (open never waits for it),
// restores the plugin state before notes play, answers parameter and window calls, writes the state back (D8 triggers, plugins/state.ts) and
// notices a host that systemd restarted (new pid): state again, then `panik`, so no note of the old run hangs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { HostPlugin, Projekt } from '../project/model.ts';
import { hostSpec, sockAnfrage } from './hostverwaltung.ts';
import { ZustandPlan, zustandDa, zustandDatei, zustandNeu, zustandOrdner, zustandUebernehmen, zustandVerwerfen, type SicherGrund } from './state.ts';

export type InstrumentStatus = 'startet' | 'bereit' | 'fehlt' | 'ausfall';
export interface InstrumentLage { spur_id: string; slot: number; status: InstrumentStatus; grund?: string; fenster: boolean; anzeige: boolean | null }
/** what the status file of a slot says (wirt-arr<slot>.json) */
export interface WirtStand { lebt: boolean; bereit: boolean; art: string | null; kennung: string | null; pid: number | null }
export interface InstrumentAbhaengig {
  /** `djk-instrumente start arr<slot> <plugin:spec|surge>`; code 0 = the host is ready, 2 = refused (stderr holds the reason) */
  start(slot: number, art: string): Promise<{ code: number; fehler: string }>;
  stand(slot: number): WirtStand;
  sock(slot: number, befehl: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>>;
  ordner(): string | null;      // the folder of the open project
  log(zeile: Record<string, unknown>): void;
}
export interface InstrumentZeiten { pollMs: number; zustandRuheMs: number; fensterMs: number; endeMs: number; sockMs: number; startMs: number }
export const INSTRUMENT_ZEITEN: Readonly<InstrumentZeiten> = { pollMs: 500, zustandRuheMs: 2000, fensterMs: 30_000, endeMs: 3000, sockMs: 10_000, startMs: 90_000 };

interface Wirt {
  slot: number; spurId: string; plugin: HostPlugin; zustandRel: string; status: InstrumentStatus; grund?: string;
  pid: number | null; gesperrt: boolean; weg: boolean; sichert: Promise<void> | null; fenster: boolean; anzeige: boolean | null; sequenz: boolean;
}

export class InstrumentWirte {
  private readonly dep: InstrumentAbhaengig;
  private readonly z: InstrumentZeiten;
  private readonly wirte = new Map<number, Wirt>();
  private readonly ketten = new Map<number, Promise<void>>();
  private readonly plan: ZustandPlan;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickLaeuft = false;

  constructor(dep: InstrumentAbhaengig, zeiten: Partial<InstrumentZeiten> = {}) {
    this.dep = dep; this.z = { ...INSTRUMENT_ZEITEN, ...zeiten };
    this.plan = new ZustandPlan({ ruheMs: this.z.zustandRuheMs, fensterMs: this.z.fensterMs, sichere: (g, id) => this.sichere(g, id) });
  }

  /** Sets the hosts to the plugin tracks of the project (null = none). Returns at once; starting, restoring and stopping run in the background. */
  abgleich(p: Projekt | null): void {
    const soll = new Map<number, { spurId: string; plugin: HostPlugin; zustand: string }>();
    for (const s of p?.spuren ?? []) {
      const g = s.geraet;
      if (s.art === 'instrument' && g?.art === 'wirt' && g.name === 'plugin' && g.plugin && g.zustand) soll.set(g.slot, { spurId: s.id, plugin: g.plugin, zustand: g.zustand });
    }
    for (const [slot, w] of [...this.wirte]) {
      const s = soll.get(slot);
      if (!s || s.spurId !== w.spurId || hostSpec(s.plugin) !== hostSpec(w.plugin)) this.entferne(w, p !== null, s === undefined);
    }
    for (const [slot, s] of soll) if (!this.wirte.has(slot)) this.lege(slot, s);
    if (this.wirte.size > 0 && !this.timer) { this.timer = setInterval(() => void this.tick(), this.z.pollMs); this.timer.unref(); }
    if (this.wirte.size === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  lage(): InstrumentLage[] {
    return [...this.wirte.values()].sort((a, b) => a.slot - b.slot).map((w) => ({ spur_id: w.spurId, slot: w.slot, status: w.status,
      ...(w.grund ? { grund: w.grund } : {}), fenster: w.fenster, anzeige: w.anzeige }));
  }
  /** resolves when everything queued for the host of a slot so far is done (a start, a restore or the swap back to Surge); at once when nothing is */
  slotFertig(slot: number): Promise<void> { return this.ketten.get(slot) ?? Promise.resolve(); }
  /** the slot that holds the plugin host of a track, or null */
  private von(spurId: string): Wirt | undefined { return [...this.wirte.values()].find((w) => w.spurId === spurId); }
  hatSpur(spurId: string): boolean { return this.von(spurId) !== undefined; }

  // --- life cycle -------------------------------------------------------------------------------------------------------------------
  private lege(slot: number, s: { spurId: string; plugin: HostPlugin; zustand: string }): void {
    const w: Wirt = { slot, spurId: s.spurId, plugin: s.plugin, zustandRel: s.zustand, status: 'startet', pid: null, gesperrt: false, weg: false, sichert: null,
      fenster: false, anzeige: null, sequenz: false };
    this.wirte.set(slot, w);
    if (s.plugin.format === 'vst3' && !fs.existsSync(s.plugin.pfad)) {   // a missing plugin file is known at once: nothing is started, the track shows `fehlt`
      w.status = 'fehlt'; w.grund = 'plugin_nicht_ladbar';
      this.dep.log({ typ: 'instrument_fehlt', slot, spur: s.spurId, pfad: s.plugin.pfad });
      return;
    }
    this.inKette(slot, () => this.starte(w));
  }

  private inKette(slot: number, f: () => Promise<void>): void {
    const vor = this.ketten.get(slot) ?? Promise.resolve();
    this.ketten.set(slot, vor.then(f).catch((e) => this.dep.log({ typ: 'instrument_fehler', slot, fehler: (e as Error).message })));
  }

  /** the track left the project (or the project closed): its state is written first (at most endeMs), then the slot goes back to Surge when no
   *  other plugin track takes it over at once */
  private entferne(w: Wirt, sichern: boolean, zuSurge: boolean): void {
    w.weg = true;
    this.fensterStopp(w);
    if (this.wirte.get(w.slot) === w) this.wirte.delete(w.slot);
    this.inKette(w.slot, async () => {
      if (sichern && w.status === 'bereit' && !w.gesperrt) await Promise.race([this.sichereEins(w), pause(this.z.endeMs)]);
      if (zuSurge && this.dep.stand(w.slot).art === 'plugin') await this.dep.start(w.slot, 'surge');
    });
  }

  private async starte(w: Wirt): Promise<void> {
    if (w.weg) return;
    const spec = hostSpec(w.plugin);
    const st = this.dep.stand(w.slot);
    if (!(st.lebt && st.bereit && st.art === 'plugin' && st.kennung === spec)) {   // a host that already runs this plugin is adopted (server restart)
      const r = await this.dep.start(w.slot, `plugin:${spec}`);
      if (w.weg) return;
      if (r.code !== 0) {
        const kein = r.fehler.includes('kein_instrument');
        w.status = kein || r.code === 2 ? 'fehlt' : 'ausfall';
        w.grund = kein ? 'kein_instrument' : r.code === 2 ? 'plugin_nicht_ladbar' : 'start_fehlgeschlagen';
        this.dep.log({ typ: 'instrument_start_fehler', slot: w.slot, code: r.code, fehler: r.fehler.slice(0, 300) });
        return;
      }
    }
    await this.herstellen(w);
  }

  /** the host is up: its state back (before any note), then `panik`; the track is ready only after that */
  private async herstellen(w: Wirt): Promise<void> {
    if (w.sequenz || w.weg) return;
    w.sequenz = true;
    try {
      const st = this.dep.stand(w.slot);
      if (!st.lebt) { w.status = 'ausfall'; w.grund = 'host_tot'; return; }
      const ordner = this.dep.ordner();
      if (ordner) {
        const datei = zustandDatei(ordner, w.zustandRel);
        if (zustandDa(datei)) {
          const r = await this.rufe(w, 'zustand_setzen', { pfad: datei });
          if (!r.ok) {   // never play with defaults and then overwrite the user's file: locked until the user acts (a new plugin in the track)
            this.dep.log({ typ: 'instrument_zustand_fehler', slot: w.slot, fehler: r.fehler });
            w.gesperrt = true; w.status = 'ausfall'; w.grund = r.fehler === 'zustand_passt_nicht' ? 'zustand_passt_nicht' : 'zustand_fehler';
            return;
          }
        }
      }
      await this.rufe(w, 'panik');
      const info = await this.rufe(w, 'info');
      if (info.ok) w.anzeige = typeof info.anzeige === 'boolean' ? info.anzeige : typeof info.editor === 'boolean' ? info.editor : null;
      w.pid = this.dep.stand(w.slot).pid;
      w.status = 'bereit'; delete w.grund; w.gesperrt = false;
    } catch (e) {
      w.status = 'ausfall'; w.grund = (e as Error).message === 'sock_timeout' ? 'haengt' : 'host_fehlt';
      this.dep.log({ typ: 'instrument_sequenz_fehler', slot: w.slot, fehler: (e as Error).message });
    } finally { w.sequenz = false; }
  }

  private async rufe(w: Wirt, befehl: string, felder: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.dep.sock(w.slot, { befehl, ...felder }, this.z.sockMs);
  }

  // --- watchdog ---------------------------------------------------------------------------------------------------------------------
  private async tick(): Promise<void> {
    if (this.tickLaeuft) return;
    this.tickLaeuft = true;
    try { for (const w of [...this.wirte.values()]) if (!w.weg && !w.sequenz && w.status !== 'fehlt' && w.status !== 'startet' && !w.gesperrt) this.pruefe(w); }
    finally { this.tickLaeuft = false; }
  }
  private pruefe(w: Wirt): void {
    const st = this.dep.stand(w.slot);
    if (w.status === 'bereit') {
      if (!st.lebt) { w.status = 'ausfall'; w.grund = 'host_tot'; this.fensterStopp(w); return; }
      if (st.pid !== w.pid) { w.status = 'ausfall'; w.grund = 'neustart'; this.fensterStopp(w); }   // restarted by systemd: empty plugin, state is restored below
    }
    if (w.status === 'ausfall' && st.lebt && st.bereit && st.art === 'plugin' && st.kennung === hostSpec(w.plugin) && (w.pid !== st.pid || w.grund === 'haengt')) {
      this.inKette(w.slot, () => this.herstellen(w));
    }
  }

  // --- parameters and window --------------------------------------------------------------------------------------------------------
  private bereit(spurId: string): Wirt | null { const w = this.von(spurId); return w && w.status === 'bereit' ? w : null; }

  async param(spurId: string, werte: Record<string, number>): Promise<{ ok: true; werte: Record<string, number> } | { ok: false; fehler: string }> {
    const w = this.bereit(spurId);
    if (!w) return { ok: false, fehler: 'host_fehlt' };
    const klemmt: Record<string, number> = {};
    for (const [k, v] of Object.entries(werte)) klemmt[k] = Math.min(1, Math.max(0, v));
    let r: Record<string, unknown>;
    try { r = await this.rufe(w, 'params_setzen', { werte: klemmt }); } catch { return { ok: false, fehler: 'host_fehlt' }; }
    if (!r.ok) return { ok: false, fehler: r.fehler === 'param_unbekannt' ? 'param_unbekannt' : r.fehler === 'wert_ungueltig' ? 'wert_ungueltig' : 'host_fehlt' };
    this.plan.param();
    return { ok: true, werte: klemmt };
  }

  async parameter(spurId: string): Promise<{ ok: true; parameter: Record<string, unknown>[] } | { ok: false; fehler: string }> {
    const w = this.bereit(spurId);
    if (!w) return { ok: false, fehler: 'host_fehlt' };
    try {
      const [info, werte] = [await this.rufe(w, 'info'), await this.rufe(w, 'params')];
      if (!info.ok || !werte.ok) return { ok: false, fehler: 'host_fehlt' };
      const wv = (werte.werte ?? {}) as Record<string, number>;
      const liste = Array.isArray(info.parameter) ? info.parameter as Record<string, unknown>[] : [];
      return { ok: true, parameter: liste.map((x) => ({ ...x, wert: wv[String(x.index)] ?? null })) };
    } catch { return { ok: false, fehler: 'host_fehlt' }; }
  }

  async fenster(spurId: string, an: boolean): Promise<{ ok: true; fenster: boolean } | { ok: false; fehler: string }> {
    const w = this.bereit(spurId);
    if (!w) return { ok: false, fehler: 'host_fehlt' };
    let r: Record<string, unknown>;
    try { r = await this.rufe(w, 'fenster', { an }); } catch { return { ok: false, fehler: 'host_fehlt' }; }
    if (r.ok === false && r.fehler) return { ok: false, fehler: 'host_fehlt' };
    if (an) {
      if (r.fenster !== true) return { ok: false, fehler: r.grund === 'keine_anzeige' ? 'keine_anzeige' : 'kein_fenster' };
      w.fenster = true;
      this.plan.fensterOffen(spurId);
      return { ok: true, fenster: true };
    }
    w.fenster = false;
    await this.plan.fensterZu(spurId);
    return { ok: true, fenster: false };
  }
  private fensterStopp(w: Wirt): void { w.fenster = false; }

  // --- state ------------------------------------------------------------------------------------------------------------------------
  private async sichereEins(w: Wirt): Promise<void> {
    if (w.sichert) return w.sichert;
    const ordner = this.dep.ordner();
    if (!ordner || w.status !== 'bereit' || w.gesperrt) return;
    const datei = zustandDatei(ordner, w.zustandRel);
    w.sichert = (async () => {
      try {
        zustandOrdner(datei);
        const r = await this.rufe(w, 'zustand_holen', { pfad: zustandNeu(datei) });
        if (r.ok) zustandUebernehmen(datei); else { zustandVerwerfen(datei); this.dep.log({ typ: 'instrument_zustand_holen_fehler', slot: w.slot, fehler: r.fehler }); }
      } catch (e) { zustandVerwerfen(datei); this.dep.log({ typ: 'instrument_zustand_holen_fehler', slot: w.slot, fehler: (e as Error).message }); }
    })().finally(() => { w.sichert = null; });
    return w.sichert;
  }

  private async sichere(grund: SicherGrund, spurId?: string): Promise<void> {
    const ziele = [...this.wirte.values()].filter((x) => spurId === undefined || x.spurId === spurId);
    const lauf = Promise.all(ziele.map((x) => this.sichereEins(x))).then(() => undefined);
    if (grund === 'param' || grund === 'fenster') { await lauf; return; }
    await Promise.race([lauf, pause(this.z.endeMs)]);   // close, export and end wait at most endeMs: a slow host never holds the server
    if (grund === 'schliessen' || grund === 'ende') this.plan.verwirf();
  }

  /** writes the state of every ready host (triggers 'export', 'schliessen', 'ende'; 'param' and 'fenster' come from the timers) */
  zustandSichern(grund: SicherGrund): Promise<void> { return this.sichere(grund); }
  async beende(): Promise<void> { await this.sichere('ende'); this.halt(); }
  halt(): void {
    this.plan.verwirf();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

const pause = (ms: number): Promise<void> => new Promise((ok) => { setTimeout(ok, ms).unref(); });

// --- the real dependencies --------------------------------------------------------------------------------------------------------
const HIER = path.dirname(fileURLToPath(import.meta.url));
export const INSTRUMENTE_BEFEHL = (): string => process.env.CYPHERDJ_INSTRUMENTE_BEFEHL ?? path.resolve(HIER, '..', '..', 'start', 'djk-instrumente');

/** the real `start` (djk-instrumente can take a while: the host comes up) */
export function instrumenteStart(instanz: string, befehl = INSTRUMENTE_BEFEHL()): InstrumentAbhaengig['start'] {
  return (slot, art) => new Promise((ok) => {
    const args = [...(instanz ? ['--instanz', instanz] : []), 'start', `arr${slot}`, art];
    const k = spawn(befehl, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let fehler = '';
    const frist = setTimeout(() => k.kill('SIGKILL'), INSTRUMENT_ZEITEN.startMs);
    k.stderr.on('data', (d) => { fehler += d; });
    k.on('error', (e) => { clearTimeout(frist); ok({ code: 127, fehler: e.message }); });
    k.on('close', (code) => { clearTimeout(frist); ok({ code: code ?? 1, fehler }); });
  });
}

/** reads wirt-arr<slot>.json of a status folder; a missing or damaged file is a host that is not there */
export function wirtStandLesen(ordner: string, slot: number): WirtStand {
  const leer: WirtStand = { lebt: false, bereit: false, art: null, kennung: null, pid: null };
  try {
    const st = JSON.parse(fs.readFileSync(path.join(ordner, `wirt-arr${slot}.json`), 'utf8')) as Record<string, unknown>;
    const pid = typeof st.pid === 'number' && Number.isInteger(st.pid) && st.pid > 0 ? st.pid : null;
    let lebt = false;
    if (pid !== null) { try { lebt = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').some((a) => path.basename(a) === 'instrument_host.py'); } catch { lebt = false; } }
    return { lebt: lebt && st.bereit === true, bereit: st.bereit === true, art: typeof st.art === 'string' ? st.art : null,
      kennung: typeof st.kennung === 'string' ? st.kennung : null, pid };
  } catch { return leer; }
}

export const wirtSockAnfrage = (ordner: () => string): InstrumentAbhaengig['sock'] =>
  (slot, befehl, ms) => sockAnfrage(path.join(ordner(), `wirt-arr${slot}.sock`), befehl, ms);
