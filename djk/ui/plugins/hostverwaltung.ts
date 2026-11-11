// Plan 1.11 task 7: the manager of the foreign effect hosts (one host process per host stage, h = 1..4 = pool ins/host/<h>).
// It never blocks the caller: abgleich() only records what the project wants and starts the work in the background. Per host the life cycle is the
// variant-B sequence (D17): `ins_host h 1` -> `ins_mess h` on the EMPTY rack (transport stopped) -> `lade` -> `zustand_setzen` (a state file exists) -> the
// stage is written `an: true` with its latency and the playback is reloaded. A watchdog polls `djk-insert status` and clears the server flag at once
// when the host is not what the sequence left (D7); a host that is missing, dead, hung or restarted empty plays dry and aligned (D6).
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { alleInserts, type HostPlugin, type Projekt } from '../project/model.ts';
import { ZustandPlan, zustandDa, zustandDatei, zustandNeu, zustandOrdner, zustandUebernehmen, zustandVerwerfen, type SicherGrund } from './state.ts';

export type HostLageStatus = 'startet' | 'bereit' | 'fehlt' | 'ausfall';
export interface HostLage {
  insert_id: string; h: number; status: HostLageStatus; latenz: number; gemessen: boolean; grund?: string;
  fenster: boolean; anzeige: boolean | null;   // plugin window open; the plugin has a UI (null = the host did not say)
}
export interface InsertAntwort { code: number; aus: string; fehler: string }
export interface InsertStatus {
  h: number; laeuft: boolean; bereit: 'leer' | 'laedt' | 'geladen' | 'fehler' | null; grund: string | null; sock: string | null;
  puls: number | null; pid: number | null; starts: number | null;
}
export interface HostAbhaengig {
  /** runs `djk-insert <args>` (start, stop, status) */
  insert(args: string[]): Promise<InsertAntwort>;
  /** one JSON line to the host socket, the answer line; rejects on a connection error or after timeoutMs (Error 'sock_timeout') */
  sock(pfad: string, befehl: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>>;
  /** the core: /k/arr/ins_host and /k/arr/ins_mess (source leitstand); the answer of ins_mess comes back through ereignis('/e/ins_mess') */
  kern: { insHost(h: number, gesund: 0 | 1): Promise<unknown>; insMess(h: number): void };
  ordner(): string | null;          // the folder of the open project
  transportSteht(): boolean;        // the core's transport is stopped (a round trip can only be measured then)
  neuLaden(): void;                 // the playback must be written and loaded again
  log(zeile: Record<string, unknown>): void;
}
export interface HostZeiten {
  pollMs: number; pulsMs: number; toleranzMs: number; zustandRuheMs: number; fensterMs: number; endeMs: number; messMs: number; ladeMs: number;
  sockMs: number; quantum: number;
  schleifeMs: number; schleifeMax: number;   // a host that fails this many sequences within this time stops restarting (absturz_schleife)
  fensterLatenzMs: number;   // while a plugin window is open the latency is read again at this interval (D4)
}
export const HOST_ZEITEN: Readonly<HostZeiten> = { pollMs: 200, pulsMs: 200, toleranzMs: 5000, zustandRuheMs: 2000, fensterMs: 30_000, endeMs: 3000,
  messMs: 2500, ladeMs: 90_000, sockMs: 10_000, quantum: 256, fensterLatenzMs: 2000,
  schleifeMs: 60_000, schleifeMax: 3 };
/** the core refuses a playback whose host stage latency is this many samples or more, even for `an: false` (ARR_HOST_LAT_MAX) */
export const HOST_LAT_MAX = 8192;
const MESS_WIEDER = 6, MESS_PAUSE_MS = 250;   // a measurement refused with host_fehlt is repeated this often (1.5 s: three edge checks of the core)
const MAX_RECYCLE = 2;   // measurements repeated by a restart of the host per start (a host that never answers must not restart at every stop)

/** the command-line form of a plugin identity: `<format>:<path>#<uid>`, ALWAYS with the trailing '#' (an LV2 URI may hold '#' itself) */
export const hostSpec = (pl: { format: string; pfad: string; uid: string }): string => `${pl.format}:${pl.pfad}#${pl.uid}`;

/** the core's `/zustand/ins_host` (12 integers: h, gesund, rundweg per host) as the list the page server adds to its `/zustand/arr` JSON */
export function insHostListe(f: Record<string, unknown>): { h: number; gesund: boolean; rundweg: number }[] {
  const aus: { h: number; gesund: boolean; rundweg: number }[] = [];
  for (let n = 1; n <= 4; n++) aus.push({ h: Number(f[`h_${n}`] ?? n), gesund: Number(f[`gesund_${n}`]) === 1, rundweg: Number(f[`rundweg_${n}`] ?? -1) });
  return aus;
}

/** the playback loader refuses with a token inside an existing reason (`format` holding `ungueltig` or `host_fehlt`, `zu_gross` holding `pdc_zu_lang`):
 *  search the substring, the token does not lead the message */
export function ladeAblehnung(grund: string, text = ''): 'host_fehlt' | 'pdc_zu_lang' | 'host_ungueltig' | null {
  const s = `${grund} ${text}`;
  if (s.includes('host_fehlt')) return 'host_fehlt';
  if (s.includes('pdc_zu_lang')) return 'pdc_zu_lang';
  if (grund === 'format' && s.includes('ungueltig') && s.includes('host')) return 'host_ungueltig';
  return null;
}

interface Host {
  h: number; insertId: string; strang: string; plugin: HostPlugin; zustandRel: string; extra: number;
  status: HostLageStatus; grund?: string; name: string;
  rundweg: number | null; gemessen: boolean; infoLatenz: number;
  flag: 0 | 1 | null; gesundSeit: number | null; sockPfad: string | null; ladePid: number | null; ladeStarts: number | null;
  offen: number; sequenz: boolean; pulsWert: number | null; pulsSeit: number; gesperrt: boolean;
  weg: boolean; recycle: number; sichert: Promise<void> | null; latenzFrage: boolean;
  fenster: boolean; fensterUhr: ReturnType<typeof setInterval> | null; anzeige: boolean | null;
  an: boolean; laeufe: number[]; sperre: 'absturz_schleife' | 'zustand_fehler' | 'latenz_zu_gross' | null; fertig: boolean; zuGross: boolean;
}

export class HostVerwaltung {
  private readonly dep: HostAbhaengig;
  private readonly z: HostZeiten;
  private readonly hosts = new Map<number, Host>();
  private readonly ketten = new Map<number, Promise<void>>();
  private readonly messWarte = new Map<number, (e: { rundweg: number; grund: string } | null) => void>();
  private readonly plan: ZustandPlan;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickLaeuft = false;
  private neuAusstehend = false;
  private transportStatus: number | null = null;

  constructor(dep: HostAbhaengig, zeiten: Partial<HostZeiten> = {}) {
    this.dep = dep; this.z = { ...HOST_ZEITEN, ...zeiten };
    this.plan = new ZustandPlan({ ruheMs: this.z.zustandRuheMs, fensterMs: this.z.fensterMs, sichere: (g, id) => this.sichere(g, id) });
  }

  // --- what the project wants -------------------------------------------------------------------------------------------------------
  /** Sets the hosts to the host inserts of the project (null = none). Returns at once; starting, stopping and loading run in the background. */
  abgleich(p: Projekt | null): void {
    const soll = new Map<number, { insertId: string; strang: string; plugin: HostPlugin; zustand: string; extra: number; an: boolean }>();
    if (p) {
      for (const x of alleInserts(p)) {
        if (x.insert.art === 'host' && x.insert.plugin) {
          soll.set(x.insert.slot, { insertId: x.insert.id, strang: x.strangId, plugin: x.insert.plugin, zustand: x.insert.zustand!,
            extra: x.insert.latenz_extra ?? 0, an: x.insert.an });
        }
      }
    }
    for (const [h, host] of [...this.hosts]) {
      const s = soll.get(h);
      if (!s || s.insertId !== host.insertId || hostSpec(s.plugin) !== hostSpec(host.plugin)) this.entferne(host, p !== null);
    }
    for (const [h, s] of soll) {
      const host = this.hosts.get(h);
      if (!host) { this.lege(h, s); continue; }
      if (host.sperre && s.an && !host.an) {   // the user switched the stage on again: the one way out of a restart loop or a failed restore
        this.entferne(host, false); this.lege(h, s); continue;
      }
      host.an = s.an;
      host.strang = s.strang;
      if (host.extra !== s.extra) { host.extra = s.extra; this.neuLadenAnfordern(); }
    }
    if (this.hosts.size > 0 && !this.timer) { this.timer = setInterval(() => void this.tick(), this.z.pollMs); this.timer.unref(); }
    if (this.hosts.size === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** the user's extra latency of the project about to be written, taken over BEFORE the translator runs: the playback then already carries it and
   *  the abgleich after the load finds nothing to reload */
  extrasSetzen(p: Projekt): void {
    for (const x of alleInserts(p)) {
      const host = x.insert.art === 'host' ? this.hosts.get(x.insert.slot) : undefined;
      if (host && host.insertId === x.insert.id) host.extra = x.insert.latenz_extra ?? 0;
    }
  }

  lage(): HostLage[] {
    return [...this.hosts.values()].sort((a, b) => a.h - b.h).map((x) => ({ insert_id: x.insertId, h: x.h, status: x.status, latenz: this.latenzVon(x),
      gemessen: x.gemessen, ...(x.grund ? { grund: x.grund } : {}), fenster: x.fenster, anzeige: x.anzeige }));
  }

  /** what the translator writes for the host stage of host number `slot`: on only while the host is ready, the latency always (the last known value) */
  stufe(slot: number): { an: boolean; latenz: number } {
    const x = this.hosts.get(slot);
    return x ? { an: x.status === 'bereit', latenz: this.latenzVon(x) } : { an: false, latenz: 0 };
  }

  /** the host slots whose stage the playback file leaves out: its latency is over what the core accepts (latenz_zu_gross) */
  ausgelassen(): Set<number> { return new Set([...this.hosts.values()].filter((x) => x.zuGross).map((x) => x.h)); }

  /** the core refused a playback load: a refusal that holds `pdc_zu_lang` takes the host with the most latency out of the playback */
  ladeAbgelehnt(grund: string, text = ''): void {
    if (ladeAblehnung(grund, text) !== 'pdc_zu_lang') return;
    const kand = [...this.hosts.values()].filter((x) => x.status === 'bereit').sort((a, b) => this.latenzVon(b) - this.latenzVon(a))[0];
    if (!kand) return;
    void this.zuGrossSetzen(kand);
  }
  private async zuGrossSetzen(host: Host): Promise<void> {
    host.zuGross = true; host.sperre = 'latenz_zu_gross'; host.status = 'ausfall'; host.grund = 'latenz_zu_gross';   // only the user (stage off and on) retries
    this.dep.log({ typ: 'host_latenz_zu_gross', h: host.h, latenz: this.latenzVon(host) });
    await this.flag(host, 0);
    this.neuLadenAnfordern();
  }

  private latenzVon(x: Host): number { return (x.rundweg ?? 2 * this.z.quantum) + x.infoLatenz + x.extra; }

  // --- life cycle ---------------------------------------------------------------------------------------------------------------------
  private lege(h: number, s: { insertId: string; strang: string; plugin: HostPlugin; zustand: string; extra: number; an: boolean }): void {
    const host: Host = { h, insertId: s.insertId, strang: s.strang, plugin: s.plugin, zustandRel: s.zustand, extra: s.extra, status: 'startet',
      name: s.plugin.name, rundweg: null, gemessen: false, infoLatenz: 0, flag: null, gesundSeit: null, sockPfad: null, ladePid: null, ladeStarts: null, offen: 0,
      sequenz: false, pulsWert: null, pulsSeit: Date.now(), gesperrt: false, weg: false, recycle: 0, sichert: null, latenzFrage: false,
      fenster: false, fensterUhr: null, anzeige: null, an: s.an, laeufe: [], sperre: null, fertig: false, zuGross: false };
    this.hosts.set(h, host);
    if (s.plugin.format === 'vst3' && !fs.existsSync(s.plugin.pfad)) {   // a missing plugin file is known at once: nothing is started
      host.status = 'fehlt'; host.grund = 'plugin_nicht_ladbar';
      this.dep.log({ typ: 'host_fehlt', h, insert: s.insertId, pfad: s.plugin.pfad });
      return;
    }
    this.inKette(h, () => this.starte(host));
  }

  private inKette(h: number, f: () => Promise<void>): void {
    const vor = this.ketten.get(h) ?? Promise.resolve();
    const n = vor.then(f).catch((e) => this.dep.log({ typ: 'host_fehler', h, fehler: (e as Error).message }));
    this.ketten.set(h, n);
  }

  private entferne(host: Host, sichern: boolean): void {
    host.weg = true;
    this.fensterUhrStopp(host);
    if (this.hosts.get(host.h) === host) this.hosts.delete(host.h);
    this.inKette(host.h, async () => {
      if (sichern && host.status === 'bereit' && !host.gesperrt) await Promise.race([this.sichereEins(host), pause(this.z.endeMs)]);
      if (host.flag !== 0) { host.flag = 0; await this.dep.kern.insHost(host.h, 0); }
      await this.dep.insert(['stop', String(host.h)]);
    });
  }

  private async starte(host: Host): Promise<void> {
    if (host.weg) return;
    const spec = hostSpec(host.plugin);
    let r = await this.dep.insert(['start', String(host.h), spec]);
    if (r.code === 4) { await this.dep.insert(['stop', String(host.h)]); r = await this.dep.insert(['start', String(host.h), spec]); }
    if (host.weg) return;
    if (r.code === 2) { host.status = 'fehlt'; host.grund = 'plugin_nicht_ladbar'; this.neuLadenAnfordern(); return; }
    if (r.code === 3) { host.status = 'ausfall'; host.grund = 'host_grenze'; return; }
    if (r.code !== 0) { host.status = 'ausfall'; host.grund = 'start_fehlgeschlagen'; this.dep.log({ typ: 'host_start_fehler', h: host.h, code: r.code, fehler: r.fehler }); return; }
    await this.sequenz(host);
  }

  private async status(h: number): Promise<InsertStatus | null> {
    try {
      const r = await this.dep.insert(['status', String(h)]);
      if (r.code !== 0) return null;
      return JSON.parse(r.aus.trim().split('\n').pop() ?? '') as InsertStatus;
    } catch { return null; }
  }

  private async flag(host: Host, g: 0 | 1, erzwingen = false): Promise<void> {
    if (host.flag === g && !erzwingen) return;
    host.flag = g;
    await this.dep.kern.insHost(host.h, g);
    host.gesundSeit = g === 1 ? Date.now() : null;
  }

  /** plan 1.11 task 13: milliseconds since the LAST health rise over all hosts (the youngest one counts; `nur` = only these insert IDs); Infinity without a host, 0 while one is not healthy.
   *  The core keeps a stage dry for 1 s after a host became healthy and its export counts no block of that hold-off, so an export waits for this. */
  gesundAlterMs(nur?: ReadonlySet<string>, jetzt = Date.now()): number {
    let alter = Infinity;
    for (const host of this.hosts.values()) {
      if (host.weg || (nur && !nur.has(host.insertId))) continue;
      alter = Math.min(alter, host.flag === 1 && host.gesundSeit !== null ? jetzt - host.gesundSeit : 0);
    }
    return alter;
  }

  /** one call to the host; while it is open the watchdog tolerates a silent pulse. On a timeout the status is read again before anyone decides. */
  private async rufe(host: Host, befehl: string, felder: Record<string, unknown> = {}, ms = this.z.sockMs): Promise<Record<string, unknown>> {
    if (!host.sockPfad) throw new Error('kein_socket');
    host.offen += 1;
    try {
      return await this.dep.sock(host.sockPfad, { befehl, ...felder }, ms);
    } catch (e) {
      const st = await this.status(host.h);
      if (befehl === 'lade' && st?.laeuft) {   // the load may just take long (a Windows plugin cold): wait for what the status says
        for (let t0 = Date.now(); Date.now() - t0 < this.z.ladeMs;) {
          const s2 = await this.status(host.h);
          if (s2?.bereit === 'geladen') return { ok: true };
          if (!s2?.laeuft || (s2.bereit !== 'laedt')) break;
          await pause(Math.min(200, this.z.pollMs * 4));
        }
      }
      throw e;
    } finally { host.offen -= 1; }
  }

  /** the round trip of the EMPTY rack, or null (not stopped, refused, not plausible). A value under 2 x quantum is stale return audio: discarded. */
  private async messen(host: Host): Promise<number | null> {
    // The core answers host_fehlt while its own 500 ms edge check has not yet seen the (re)started host, although the server flag is up: ask again
    // (found on the real core: every measurement right after `ins_host h 1` was refused, the stage stayed on the estimate).
    let e: { rundweg: number; grund: string } | null = null;
    for (let versuch = 0; versuch <= MESS_WIEDER; versuch++) {
      if (!this.dep.transportSteht()) return null;
      const antwort = new Promise<{ rundweg: number; grund: string } | null>((ok) => {
        this.messWarte.set(host.h, ok);
        setTimeout(() => ok(null), this.z.messMs).unref();
      });
      this.dep.kern.insMess(host.h);
      e = await antwort;
      this.messWarte.delete(host.h);
      if (!e || e.grund !== 'host_fehlt' || host.weg) break;
      await pause(MESS_PAUSE_MS);
    }
    if (!e || e.rundweg < 0) { this.dep.log({ typ: 'host_messung_ohne_zahl', h: host.h, grund: e?.grund ?? 'keine_antwort' }); return null; }
    if (e.rundweg < 2 * this.z.quantum) { this.dep.log({ typ: 'host_messung_unplausibel', h: host.h, rundweg: e.rundweg }); return null; }
    return e.rundweg;
  }

  private async sequenz(host: Host): Promise<void> {
    if (host.sequenz || host.weg) return;
    host.sequenz = true;
    host.laeufe.push(Date.now());
    host.status = 'startet'; delete host.grund; host.zuGross = false; host.fertig = false;
    try {
      const st = await this.status(host.h);
      if (!st?.laeuft) { host.status = 'ausfall'; host.grund = 'host_tot'; return; }
      host.sockPfad = st.sock;
      const adoptiert = st.bereit === 'geladen';   // a host that kept its plugin over a restart of the server: nothing to measure on, nothing to restore
      let messung: number | null = null;
      if (!adoptiert) {
        if (this.dep.transportSteht()) {
          await this.flag(host, 1);                 // the core measures only a healthy host (the stage is still `an: false`: dry)
          messung = await this.messen(host);
        }
        const l = await this.rufe(host, 'lade', {}, this.z.ladeMs);
        if (host.weg) return;
        if (!l.ok && l.fehler !== 'schon_geladen') {
          const ladbar = l.fehler !== 'nicht_ladbar' && l.fehler !== 'kein_effekt';
          host.status = ladbar ? 'ausfall' : 'fehlt'; host.grund = ladbar ? String(l.fehler) : 'plugin_nicht_ladbar';
          await this.flag(host, 0);
          this.neuLadenAnfordern();
          return;
        }
        host.ladePid = st.pid; host.ladeStarts = st.starts; host.pulsWert = st.puls; host.pulsSeit = Date.now();   // the load is confirmed: the watchdog knows this run
      }
      if (messung !== null) { host.rundweg = messung; host.gemessen = true; } else if (host.rundweg === null) { host.rundweg = 2 * this.z.quantum; host.gemessen = false; }
      const info = await this.rufe(host, 'info');
      if (info.ok) {
        host.infoLatenz = Number(info.latenz) || 0; if (typeof info.name === 'string') host.name = info.name;
        host.anzeige = typeof info.anzeige === 'boolean' ? info.anzeige : typeof info.editor === 'boolean' ? info.editor : null;
      }
      const ordner = this.dep.ordner();
      if (ordner) {
        const datei = zustandDatei(ordner, host.zustandRel);
        if (zustandDa(datei)) {
          const z = await this.rufe(host, 'zustand_setzen', { pfad: datei });
          if (z.fehler === 'zustand_passt_nicht') { host.gesperrt = true; host.grund = 'zustand_passt_nicht'; }   // never overwrite the other plugin's state file
          else if (!z.ok) {   // the stage must not play with defaults and then overwrite the user's file: dry, locked until the user acts
            this.dep.log({ typ: 'host_zustand_fehler', h: host.h, fehler: z.fehler });
            host.gesperrt = true; host.sperre = 'zustand_fehler'; host.status = 'ausfall'; host.grund = 'zustand_fehler';
            await this.flag(host, 0); this.neuLadenAnfordern();
            return;
          }
        }
      }
      const lz = await this.rufe(host, 'latenz');
      if (lz.ok) host.infoLatenz = Number(lz.latenz) || 0;
      const st2 = await this.status(host.h);
      if (host.weg) return;
      if (!st2?.laeuft || st2.bereit !== 'geladen') { host.status = 'ausfall'; host.grund = 'neustart'; await this.flag(host, 0); this.neuLadenAnfordern(); return; }
      host.ladePid = st2.pid; host.ladeStarts = st2.starts; host.pulsWert = st2.puls; host.pulsSeit = Date.now();
      if (this.latenzVon(host) >= HOST_LAT_MAX) { host.fertig = true; await this.zuGrossSetzen(host); return; }
      host.fertig = true;
      host.status = 'bereit';
      await this.flag(host, 1, true);
      this.neuLadenAnfordern();
    } catch (e) {
      host.status = 'ausfall'; host.grund = (e as Error).message === 'sock_timeout' ? 'haengt' : 'host_fehlt';
      this.dep.log({ typ: 'host_sequenz_fehler', h: host.h, fehler: (e as Error).message });
      await this.flag(host, 0).catch(() => undefined);
      this.neuLadenAnfordern();
    } finally { host.sequenz = false; }
  }

  // --- watchdog -----------------------------------------------------------------------------------------------------------------------
  private async tick(): Promise<void> {
    if (this.tickLaeuft) return;
    this.tickLaeuft = true;
    try { for (const host of [...this.hosts.values()]) if (!host.weg && !host.sperre && host.status !== 'fehlt' && host.status !== 'startet') await this.pruefe(host); }
    catch (e) { this.dep.log({ typ: 'host_tick_fehler', fehler: (e as Error).message }); } finally { this.tickLaeuft = false; }
  }

  private async ausfall(host: Host, grund: string): Promise<void> {
    host.status = 'ausfall'; host.grund = grund;
    this.fensterUhrStopp(host);
    await this.flag(host, 0);             // first the flag: the stage is dry within one poll
    this.neuLadenAnfordern();             // then the playback says `an: false` with the last latency
  }

  private async pruefe(host: Host): Promise<void> {
    const st = await this.status(host.h);
    if (host.weg || host.status === 'startet') return;
    const jetzt = Date.now();
    if (!st || !st.laeuft) { if (host.status === 'bereit' || host.flag === 1) await this.ausfall(host, 'host_tot'); else { host.status = 'ausfall'; host.grund = 'host_tot'; } return; }
    if (st.bereit === 'fehler') {
      const ladbar = st.grund !== 'nicht_ladbar' && st.grund !== 'kein_effekt';
      if (host.status !== 'fehlt' && (ladbar ? host.grund !== st.grund : true)) {
        await this.flag(host, 0); host.status = ladbar ? 'ausfall' : 'fehlt'; host.grund = ladbar ? (st.grund ?? 'host_fehlt') : 'plugin_nicht_ladbar'; this.neuLadenAnfordern();
      }
      return;
    }
    if (host.ladePid !== null && st.puls !== host.pulsWert) { host.pulsWert = st.puls; host.pulsSeit = jetzt; }
    const tolerant = host.offen > 0 || st.bereit === 'laedt';   // a call of ours is open or the host loads: the main loop may be busy
    const veraltet = jetzt - host.pulsSeit > (tolerant ? this.z.toleranzMs : this.z.pulsMs);
    const gleicherLauf = st.bereit === 'geladen' && host.ladePid !== null && st.pid === host.ladePid && st.starts === host.ladeStarts;
    if (host.status === 'bereit') {
      if (!gleicherLauf || veraltet) {
        await this.ausfall(host, !gleicherLauf ? 'neustart' : 'haengt');
      }
    } else if (host.status === 'ausfall' && gleicherLauf && !veraltet && host.grund === 'haengt') {   // the hung host recovered: same process, pulse back
      if (!host.fertig) { if (!host.sequenz) this.inKette(host.h, () => this.sequenz(host)); return; }   // it hung inside the sequence: run the rest of it
      host.status = 'bereit'; delete host.grund;
      await this.flag(host, 1, true); this.neuLadenAnfordern();
      return;
    }
    if (host.status === 'ausfall' && st.bereit === 'leer' && !host.sequenz) this.erneut(host);   // restarted empty: the sequence again (not forever)
  }

  /** the sequence again after a restart with an empty rack; the third failed sequence within schleifeMs ends it (absturz_schleife) */
  private erneut(host: Host): void {
    const jetzt = Date.now();
    host.laeufe = host.laeufe.filter((t) => jetzt - t < this.z.schleifeMs);
    if (host.laeufe.length < this.z.schleifeMax) { this.inKette(host.h, () => this.sequenz(host)); return; }
    host.sperre = 'absturz_schleife'; host.status = 'ausfall'; host.grund = 'absturz_schleife';
    this.dep.log({ typ: 'host_absturz_schleife', h: host.h, insert: host.insertId });
    this.inKette(host.h, async () => { await this.flag(host, 0); await this.dep.insert(['stop', String(host.h)]); });
    this.neuLadenAnfordern();
  }

  // --- the core's answers ---------------------------------------------------------------------------------------------------------
  /** /e/ins_mess (the answer of a measurement), /zustand/arr (the stop edge: estimated latencies are measured now) */
  ereignis(adresse: string, f: Record<string, unknown>): void {
    if (adresse === '/e/ins_mess') { this.messWarte.get(Number(f.h))?.({ rundweg: Number(f.rundweg), grund: String(f.grund ?? '') }); return; }
    if (adresse !== '/zustand/arr') return;
    const status = Number(f.status), vor = this.transportStatus;
    this.transportStatus = status;
    if (status !== 0 || vor === null || vor === 0) return;
    for (const host of this.hosts.values()) {   // transport stopped: a host that started on an estimate gets its measurement through a clean restart (empty rack)
      if (host.status === 'bereit' && !host.gemessen && host.recycle < MAX_RECYCLE && host.offen === 0) this.neuStart(host);
    }
  }

  private neuStart(host: Host): void {
    host.recycle += 1;
    this.inKette(host.h, async () => {
      if (host.weg) return;
      if (!host.gesperrt) await Promise.race([this.sichereEins(host), pause(this.z.endeMs)]);
      host.status = 'startet'; host.ladePid = null; host.ladeStarts = null;
      await this.flag(host, 0); this.neuLadenAnfordern();
      await this.dep.insert(['stop', String(host.h)]);
      await this.starte(host);
    });
  }

  /** a new core knows no flag: the hosts that are ready say so again (the hold-off of the core applies) */
  kernNeustart(): void {
    for (const host of this.hosts.values()) {
      host.flag = null;
      if (host.status === 'bereit') void this.flag(host, 1, true);
    }
    for (const w of this.messWarte.values()) w(null);
  }

  // --- parameters ---------------------------------------------------------------------------------------------------------------------
  async param(insertId: string, werte: Record<string, number>): Promise<{ ok: true; werte: Record<string, number> } | { ok: false; fehler: string }> {
    const host = [...this.hosts.values()].find((x) => x.insertId === insertId);
    if (!host || host.status !== 'bereit') return { ok: false, fehler: 'host_fehlt' };
    const klemmt: Record<string, number> = {};
    for (const [k, v] of Object.entries(werte)) klemmt[k] = Math.min(1, Math.max(0, v));
    let r: Record<string, unknown>;
    try { r = await this.rufe(host, 'params_setzen', { werte: klemmt }); } catch {
      const st = await this.status(host.h);
      if (!(st?.bereit === 'geladen' && st.pid === host.ladePid)) return { ok: false, fehler: 'host_fehlt' };
      try { r = await this.rufe(host, 'params_setzen', { werte: klemmt }); } catch { return { ok: false, fehler: 'host_fehlt' }; }
    }
    if (!r.ok) return { ok: false, fehler: r.fehler === 'param_unbekannt' ? 'param_unbekannt' : r.fehler === 'wert_ungueltig' ? 'wert_ungueltig' : 'host_fehlt' };
    this.plan.param();
    void this.latenzPruefen(host);
    return { ok: true, werte: klemmt };
  }

  /** a parameter can change the plugin's latency (a linear-phase mode): read it again; a new number is a new playback load (D4), once */
  private async latenzPruefen(host: Host): Promise<void> {
    if (host.latenzFrage) return;
    host.latenzFrage = true;
    try {
      const l = await this.rufe(host, 'latenz');
      if (l.ok && Number.isInteger(l.latenz) && l.latenz !== host.infoLatenz) {
        host.infoLatenz = l.latenz as number;
        if (this.latenzVon(host) >= HOST_LAT_MAX && host.status === 'bereit') { await this.zuGrossSetzen(host); return; }
        this.neuLadenAnfordern();
      }
    } catch { /* the watchdog sees a hung host */ } finally { host.latenzFrage = false; }
  }

  /** the parameters of a plugin as the host lists them (info), each with its current value 0..1 (params) */
  async parameter(insertId: string): Promise<{ ok: true; parameter: Record<string, unknown>[] } | { ok: false; fehler: string }> {
    const host = [...this.hosts.values()].find((x) => x.insertId === insertId);
    if (!host || host.status !== 'bereit') return { ok: false, fehler: 'host_fehlt' };
    try {
      const [info, werte] = [await this.rufe(host, 'info'), await this.rufe(host, 'params')];
      if (!info.ok || !werte.ok) return { ok: false, fehler: 'host_fehlt' };
      const w = (werte.werte ?? {}) as Record<string, number>;
      const liste = Array.isArray(info.parameter) ? info.parameter as Record<string, unknown>[] : [];
      return { ok: true, parameter: liste.map((x) => ({ ...x, wert: w[String(x.index)] ?? null })) };
    } catch { return { ok: false, fehler: 'host_fehlt' }; }
  }

  // --- plugin window ------------------------------------------------------------------------------------------------------------------
  /** opens or closes the plugin's own window in the host. While it is open the latency is read every fensterLatenzMs (D4: a plugin can change it
   *  from its UI) and the state is written every fensterMs (D8); on close the latency is read once more and the state is written once. */
  async fenster(insertId: string, an: boolean): Promise<{ ok: true; fenster: boolean } | { ok: false; fehler: string }> {
    const host = [...this.hosts.values()].find((x) => x.insertId === insertId);
    if (!host || host.status !== 'bereit') return { ok: false, fehler: 'host_fehlt' };
    let r: Record<string, unknown>;
    try { r = await this.rufe(host, 'fenster', { an }); } catch { return { ok: false, fehler: 'host_fehlt' }; }
    if (r.ok === false && r.fehler) return { ok: false, fehler: 'host_fehlt' };
    if (an) {
      if (r.fenster !== true) return { ok: false, fehler: r.grund === 'keine_anzeige' ? 'keine_anzeige' : 'kein_fenster' };
      host.fenster = true;
      this.plan.fensterOffen(insertId);
      if (!host.fensterUhr) { host.fensterUhr = setInterval(() => void this.latenzPruefen(host), this.z.fensterLatenzMs); host.fensterUhr.unref(); }
      return { ok: true, fenster: true };
    }
    host.fenster = false;
    this.fensterUhrStopp(host);
    await this.latenzPruefen(host);
    await this.plan.fensterZu(insertId);
    return { ok: true, fenster: false };
  }
  private fensterUhrStopp(host: Host): void {
    host.fenster = false;
    if (host.fensterUhr) { clearInterval(host.fensterUhr); host.fensterUhr = null; }
  }

  // --- state --------------------------------------------------------------------------------------------------------------------------
  private async sichereEins(host: Host): Promise<void> {
    if (host.sichert) return host.sichert;
    const ordner = this.dep.ordner();
    if (!ordner || host.status !== 'bereit' || host.gesperrt) return;
    const datei = zustandDatei(ordner, host.zustandRel);
    host.sichert = (async () => {
      try {
        zustandOrdner(datei);
        const r = await this.rufe(host, 'zustand_holen', { pfad: zustandNeu(datei) });
        if (r.ok) zustandUebernehmen(datei); else { zustandVerwerfen(datei); this.dep.log({ typ: 'host_zustand_holen_fehler', h: host.h, fehler: r.fehler }); }
      } catch (e) { zustandVerwerfen(datei); this.dep.log({ typ: 'host_zustand_holen_fehler', h: host.h, fehler: (e as Error).message }); }
    })().finally(() => { host.sichert = null; });
    return host.sichert;
  }

  private async sichere(grund: SicherGrund, insertId?: string): Promise<void> {
    const ziele = [...this.hosts.values()].filter((x) => insertId === undefined || x.insertId === insertId);
    const lauf = Promise.all(ziele.map((x) => this.sichereEins(x))).then(() => undefined);
    if (grund === 'param' || grund === 'fenster') { await lauf; return; }
    await Promise.race([lauf, pause(this.z.endeMs)]);   // close, export and end wait at most endeMs: a slow host never holds the server
    if (grund === 'schliessen' || grund === 'ende') this.plan.verwirf();
  }

  /** writes the state of every ready host (triggers: 'export', 'schliessen', 'ende'; 'param' and 'fenster' come from the timers) */
  zustandSichern(grund: SicherGrund): Promise<void> { return this.sichere(grund); }
  /** the window of a plugin opened or closed (the window itself is a later task): every 30 s while open, once on close */
  fensterOffen(insertId: string): void { this.plan.fensterOffen(insertId); }
  fensterZu(insertId: string): Promise<void> { return this.plan.fensterZu(insertId); }

  private neuLadenAnfordern(): void {
    if (this.neuAusstehend) return;
    this.neuAusstehend = true;
    setTimeout(() => { this.neuAusstehend = false; try { this.dep.neuLaden(); } catch (e) { this.dep.log({ typ: 'host_neu_laden_fehler', fehler: (e as Error).message }); } }, 0);
  }

  /** the server ends: write the state (at most endeMs), stop the timers; the host processes keep running (djk-stop ends them) */
  async beende(): Promise<void> {
    await this.sichere('ende');
    this.halt();
  }
  halt(): void {
    this.plan.verwirf();
    for (const host of this.hosts.values()) this.fensterUhrStopp(host);
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

const pause = (ms: number): Promise<void> => new Promise((ok) => { setTimeout(ok, ms).unref(); });

// --- the real dependencies ---------------------------------------------------------------------------------------------------------
const HIER = path.dirname(fileURLToPath(import.meta.url));
export const INSERT_BEFEHL = (): string => process.env.CYPHERDJ_INSERT_BEFEHL ?? path.resolve(HIER, '..', '..', 'start', 'djk-insert');

/** runs djk-insert; `start` may take 30 s (the host comes up), the others a few seconds */
export function insertAusfuehren(args: string[], instanz = '', befehl = INSERT_BEFEHL()): Promise<InsertAntwort> {
  return new Promise((ok) => {
    const mit = instanz ? [...args, '--instanz', instanz] : args;
    const k = spawn(befehl, mit, { stdio: ['ignore', 'pipe', 'pipe'] });
    let aus = '', fehler = '';
    const frist = setTimeout(() => k.kill('SIGKILL'), args[0] === 'start' ? 60_000 : 15_000);
    k.stdout.on('data', (d) => { aus += d; });
    k.stderr.on('data', (d) => { fehler += d; });
    k.on('error', (e) => { clearTimeout(frist); ok({ code: 127, aus, fehler: e.message }); });
    k.on('close', (code) => { clearTimeout(frist); ok({ code: code ?? 1, aus, fehler }); });
  });
}

/** one JSON line to the Unix socket of a host and its one answer line */
export function sockAnfrage(pfad: string, befehl: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((ok, nein) => {
    const s = net.createConnection(pfad);
    let puffer = '', fertig = false;
    const ende = (f: () => void): void => { if (fertig) return; fertig = true; clearTimeout(frist); s.destroy(); f(); };
    const frist = setTimeout(() => ende(() => nein(new Error('sock_timeout'))), timeoutMs);
    s.on('connect', () => s.write(`${JSON.stringify(befehl)}\n`));
    s.on('data', (d) => {
      puffer += d;
      const i = puffer.indexOf('\n');
      if (i < 0) return;
      try { const j = JSON.parse(puffer.slice(0, i)) as Record<string, unknown>; ende(() => ok(j)); } catch { ende(() => nein(new Error('sock_antwort'))); }
    });
    s.on('error', (e) => ende(() => nein(new Error(`sock_verbindung: ${e.message}`))));
    s.on('close', () => ende(() => nein(new Error('sock_verbindung: closed'))));
  });
}
