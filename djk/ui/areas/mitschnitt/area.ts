// Mix and set recording from the page (journey tours, task 2). The recorder cypherdj-setmitschnitt only reads the core's audio ring and writes a WAV
// plus <file.wav>.json; it never touches the core. It runs in its own transient user unit (cypherdj-setmitschnitt plus the instance suffix, the name djk-demo
// uses too, so a demo recording and a page recording exclude each other), not as a child of the page server: a page restart does not stop a recording.
//   POST /mitschnitt/start {name?}  -> { ok, datei, seit }                                      page   (name: [a-z0-9_-]{1,40}, default date and time)
//   POST /mitschnitt/stopp          -> { ok, datei, sekunden, luecken, spruenge }                page
//   GET  /mitschnitt/stand          -> { laeuft, datei?, seit?, sekunden?, spitze_db? }          open
// State of a running recording: <zustandsDatei> (/dev/shm/cypherdj[-<i>]/mitschnitt.json) { unit, datei, seit, start_ms }. After a restart stand and stopp find it
// there (unit active), else the file is stale and removed. Stop = the --stopp file, up to 5 s for the unit to end, then the unit is stopped.
// Reasons: mitschnitt_laeuft 409, kein_mitschnitt 409, kern_fehlt 503, mitschnitt_fehler 500 (the log's last line in `detail`), name_ungueltig 400.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json, koerper } from '../../http/transport.ts';
import { fehlerKoerper } from '../../http/error_form.ts';
import { grundText } from '../../http/reasons.ts';

export const MITSCHNITT_NAME = /^[a-z0-9_-]{1,40}$/;
export const NAME_TEXT = 'a recording name has 1 to 40 characters from a-z, 0-9, _ and -';

/** The seam to systemd: tests give a fake, the server the real one (systemd-run / systemctl --user). */
export interface EinheitLaeufer {
  start(unit: string, programm: string, args: string[], umgebung: Record<string, string>, logDatei: string): Promise<void>;
  aktiv(unit: string): Promise<boolean>;
  /** Exit status of the main process of an ended unit; null when unknown. */
  ende(unit: string): Promise<number | null>;
  stopp(unit: string): Promise<void>;
}

const lauf = (cmd: string, args: string[]): Promise<{ code: number; aus: string; fehl: string }> => new Promise((ok) => {
  execFile(cmd, args, { timeout: 15000 }, (e, aus, fehl) => ok({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, aus: String(aus), fehl: String(fehl) }));
});

export const systemdLaeufer: EinheitLaeufer = {
  async start(unit, programm, args, umgebung, logDatei) {
    await lauf('systemctl', ['--user', 'reset-failed', unit]);   // an earlier failed run of the same name would block the new one (and its exit status is read below)
    const env = Object.entries(umgebung).map(([k, v]) => `--setenv=${k}=${v}`);
    const r = await lauf('systemd-run', ['--user', '--quiet', `--unit=${unit}`, ...env, '-p', 'Nice=5', '-p', `StandardError=append:${logDatei}`, programm, ...args]);
    if (r.code !== 0) throw new Error(r.fehl.trim().split('\n').pop() || 'systemd-run failed');
  },
  async aktiv(unit) { return (await lauf('systemctl', ['--user', 'is-active', '--quiet', unit])).code === 0; },
  async ende(unit) {
    const r = await lauf('systemctl', ['--user', 'show', unit, '-p', 'ExecMainStatus', '--value']);
    const n = Number(r.aus.trim());
    return r.code === 0 && r.aus.trim() !== '' && Number.isFinite(n) ? n : null;
  },
  async stopp(unit) { await lauf('systemctl', ['--user', 'stop', unit]); },
};

export interface MitschnittOptionen {
  ordner: () => string;                 // where the WAVs go
  zustandsDatei: string;                // mitschnitt.json
  programm: () => string;               // the recorder binary (env CYPHERDJ_SETMITSCHNITT is read by the server's default)
  instanz?: string;                     // '' or a..i: unit suffix and the recorder's ring
  kernDa?: () => boolean;               // the page server's own core state: an orphaned ring does not make the recorder exit
  laeufer?: EinheitLaeufer;
  jetzt?: () => Date;
  anlaufMs?: number;                    // how long the unit must stay up to count as started (default 1000)
  stoppWarteMs?: number;                // how long the unit gets to end after the --stopp file (default 5000)
}

interface Zustand { unit: string; datei: string; seit: string; start_ms: number }

const schlaf = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
const zweistellig = (n: number): string => String(n).padStart(2, '0');
const standardName = (d: Date): string => `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}_${zweistellig(d.getHours())}-${zweistellig(d.getMinutes())}-${zweistellig(d.getSeconds())}`;

/** The last non-empty line of a text file; '' when it cannot be read. */
function letzteZeile(datei: string): string {
  try { return fs.readFileSync(datei, 'utf8').split('\n').map((z) => z.trim()).filter(Boolean).pop() ?? ''; } catch { return ''; }
}
/** The peak of the last 10-second line the recorder logged ("setmitschnitt: 20 s, peak -12.3 dBFS"); undefined before the first. A silent stretch (-200) is floored to -120. */
export function spitzeAusLog(datei: string): number | undefined {
  let text = '';
  try { text = fs.readFileSync(datei, 'utf8'); } catch { return undefined; }
  let letzte: number | undefined;
  for (const m of text.matchAll(/peak (-?\d+(?:\.\d+)?|-?inf) dBFS/g)) letzte = Number.isFinite(Number(m[1])) ? Math.max(-120, Number(m[1])) : -120;
  return letzte;
}

export function mitschnittBereich(ctx: Pick<BereichKontext, 'log'>, opt: MitschnittOptionen): Bereich {
  const sfx = opt.instanz ? `-${opt.instanz}` : '';
  const unit = `cypherdj-setmitschnitt${sfx}`;
  const laeufer = opt.laeufer ?? systemdLaeufer;
  const jetzt = opt.jetzt ?? ((): Date => new Date());
  const kernDa = opt.kernDa ?? ((): boolean => true);
  const anlaufMs = opt.anlaufMs ?? 1000, stoppWarteMs = opt.stoppWarteMs ?? 5000;

  const liesZustand = (): Zustand | null => {
    try {
      const z = JSON.parse(fs.readFileSync(opt.zustandsDatei, 'utf8')) as Partial<Zustand>;
      return typeof z.unit === 'string' && typeof z.datei === 'string' && typeof z.seit === 'string' && typeof z.start_ms === 'number' ? z as Zustand : null;
    } catch { return null; }
  };
  const loescheZustand = (): void => { try { fs.rmSync(opt.zustandsDatei, { force: true }); } catch { /* best effort */ } };
  /** The recording that runs: the state file with an active unit. A state file whose unit is gone is stale and removed. */
  const laufend = async (): Promise<Zustand | null> => {
    const z = liesZustand();
    if (!z) return null;
    if (await laeufer.aktiv(z.unit)) return z;
    loescheZustand();
    return null;
  };

  const fehler = (a: http.ServerResponse, code: number, grund: string, extra: { text?: string; detail?: string } = {}): void => {
    ctx.log({ typ: 'mitschnitt_abgelehnt', grund });
    json(a, code, { ...fehlerKoerper(grund, extra.text ?? grundText(grund)), ...(extra.detail ? { detail: extra.detail } : {}) });
  };

  // start and stop run one after the other: two clicks cannot start two units or stop one twice
  let kette: Promise<unknown> = Promise.resolve();
  const seriell = <T>(f: () => Promise<T>): Promise<T> => { const n = kette.then(f, f); kette = n.catch(() => undefined); return n; };

  const startRoute: Route['handler'] = async (q, a) => {
    let body: Record<string, unknown>;
    try { body = await koerper(q); } catch { return fehler(a, 400, 'json'); }
    const roh = body.name;
    if (roh !== undefined && (typeof roh !== 'string' || !MITSCHNITT_NAME.test(roh))) return fehler(a, 400, 'name_ungueltig', { text: NAME_TEXT });
    await seriell(async () => {
      try {
        // the unit of a demo recording counts too: no state file of ours, but the same unit name is taken
        if (await laufend() || await laeufer.aktiv(unit)) return fehler(a, 409, 'mitschnitt_laeuft');
        if (!kernDa()) return fehler(a, 503, 'kern_fehlt');
        const ordner = opt.ordner();
        fs.mkdirSync(ordner, { recursive: true });
        const jetztWert = jetzt();
        const stamm = typeof roh === 'string' ? roh : standardName(jetztWert);
        let datei = path.join(ordner, `${stamm}.wav`);
        for (let n = 2; fs.existsSync(datei) || fs.existsSync(`${datei}.json`); n++) datei = path.join(ordner, `${stamm}-${n}.wav`);   // never overwrite an earlier recording
        const stoppDatei = datei.replace(/\.wav$/, '.stopp');
        const logDatei = `${datei}.log`;
        fs.rmSync(stoppDatei, { force: true });
        fs.writeFileSync(logDatei, '');
        // stderr goes to <file>.log beside the WAV (a unit property, so no pipe of the page server is involved)
        await laeufer.start(unit, opt.programm(), ['--aus', datei, '--stopp', stoppDatei], { CYPHERDJ_INSTANZ: opt.instanz ?? '' }, logDatei);
        const bis = Date.now() + anlaufMs;
        let aktiv = true;
        while (Date.now() < bis) { aktiv = await laeufer.aktiv(unit); if (!aktiv) break; await schlaf(Math.min(50, Math.max(1, bis - Date.now()))); }
        if (!aktiv) {
          const code = await laeufer.ende(unit);
          const zeile = letzteZeile(logDatei);
          ctx.log({ typ: 'mitschnitt_start_fehlt', code, zeile });
          return code === 3 ? fehler(a, 503, 'kern_fehlt', { detail: zeile }) : fehler(a, 500, 'mitschnitt_fehler', { detail: zeile || `recorder ended with status ${code ?? 'unknown'}` });
        }
        const z: Zustand = { unit, datei, seit: jetztWert.toISOString(), start_ms: jetztWert.getTime() };
        fs.mkdirSync(path.dirname(opt.zustandsDatei), { recursive: true });
        fs.writeFileSync(opt.zustandsDatei, JSON.stringify(z));
        ctx.log({ typ: 'mitschnitt_start', datei });
        json(a, 200, { ok: true, datei, seit: z.seit });
      } catch (e) {
        ctx.log({ typ: 'mitschnitt_fehler', fehler: (e as Error)?.message ?? String(e) });
        fehler(a, 500, 'mitschnitt_fehler', { detail: (e as Error)?.message ?? String(e) });
      }
    });
  };

  const stoppRoute: Route['handler'] = async (_q, a) => {
    await seriell(async () => {
      try {
        const z = await laufend();
        if (!z) return fehler(a, 409, 'kein_mitschnitt');
        const stoppDatei = z.datei.replace(/\.wav$/, '.stopp');
        fs.writeFileSync(stoppDatei, '');
        const bis = Date.now() + stoppWarteMs;
        let aktiv = true;
        while (Date.now() < bis) { aktiv = await laeufer.aktiv(z.unit); if (!aktiv) break; await schlaf(Math.min(50, Math.max(1, bis - Date.now()))); }
        if (aktiv) await laeufer.stopp(z.unit);
        fs.rmSync(stoppDatei, { force: true });
        loescheZustand();
        let ende: { frames?: unknown; ok?: unknown; ereignisse?: unknown } | null = null;
        try { ende = JSON.parse(fs.readFileSync(`${z.datei}.json`, 'utf8')); } catch { /* the recorder wrote no end file */ }
        if (!ende || ende.ok === false || typeof ende.frames !== 'number') {
          return fehler(a, 500, 'mitschnitt_fehler', { detail: letzteZeile(`${z.datei}.log`) || 'the recorder wrote no end file' });
        }
        const ereignisse = Array.isArray(ende.ereignisse) ? ende.ereignisse as Array<{ art?: unknown }> : [];
        const zaehle = (art: string): number => ereignisse.filter((e) => e?.art === art).length;
        ctx.log({ typ: 'mitschnitt_stopp', datei: z.datei });
        json(a, 200, { ok: true, datei: z.datei, sekunden: Math.round(ende.frames / 48) / 1000, luecken: zaehle('luecke'), spruenge: zaehle('sprung') });
      } catch (e) {
        ctx.log({ typ: 'mitschnitt_fehler', fehler: (e as Error)?.message ?? String(e) });
        fehler(a, 500, 'mitschnitt_fehler', { detail: (e as Error)?.message ?? String(e) });
      }
    });
  };

  const standRoute: Route['handler'] = async (_q, a) => {
    try {
      const z = await laufend();
      if (!z) return json(a, 200, { laeuft: false });
      const spitze = spitzeAusLog(`${z.datei}.log`);
      json(a, 200, { laeuft: true, datei: z.datei, seit: z.seit, sekunden: Math.max(0, Math.round((jetzt().getTime() - z.start_ms) / 100) / 10), ...(spitze !== undefined ? { spitze_db: spitze } : {}) });
    } catch (e) {
      fehler(a, 500, 'mitschnitt_fehler', { detail: (e as Error)?.message ?? String(e) });
    }
  };

  const routen = (): Route[] => [
    { methode: 'POST', pfad: '/mitschnitt/start', schutz: 'fremdePost', handler: startRoute },
    { methode: 'POST', pfad: '/mitschnitt/stopp', schutz: 'fremdePost', handler: stoppRoute },
    { methode: 'GET', pfad: '/mitschnitt/stand', schutz: 'offen', handler: standRoute },
  ];
  return { name: 'mitschnitt', routen };
}
