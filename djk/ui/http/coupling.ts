// Tablet access (plan 2026-11-11-instrument-oberflaechen, task 10): a second listener on the home-network address of this host, behind a pairing cookie.
// Everything that decides "who may do what on that listener" lives here so that it can be read and tested in one place:
//   - heimAdresse: the one address the listener may bind (private range, found from the interfaces; never 0.0.0.0, never a public or VPN address)
//   - Kopplung: one-time links (2 minutes) and paired devices (cookie = 32 random bytes, only its SHA-256 is stored, compared in constant time)
//   - tabletVerboten: the explicit deny list (routes that start or stop things, change device profiles or write the project) and the POST default
//   - baueTabletHandler: the request path of the second listener (host check, pairing, cookie, deny list, source andreas)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type http from 'node:http';
import type os from 'node:os';

export const TABLET_PORT = 47301;
export const LINK_MS = 120_000;                // a one-time link is valid for 2 minutes
export const COOKIE = 'djk_tablet';
const COOKIE_MAX_S = 60 * 60 * 24 * 365;       // a paired tablet stays paired for a year (or until revoked)
const MAX_LINKS = 5;                           // outstanding one-time links at once
const FEHLVERSUCHE = { fenster: 60_000, max: 10, adressen: 200 };   // per remote address; at most this many addresses are remembered
export const GERAET_MAX_MS = 30 * 24 * 3600 * 1000;   // a device not seen for 30 days is unpaired (sliding: every use renews it)
const ZULETZT_SPEICHERN_MS = 3600 * 1000;               // the last-seen time goes to disk at most once an hour per device

// ---------- address ----------

// RFC 1918 only: 10/8, 172.16/12, the /16 below 192 (b = 168). Not link-local, not CGNAT or a mesh VPN (100.64/10), not loopback, not public.
export function istPrivat(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if ([a, b, c, d].some((x) => x > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Only interfaces that look physical: eth*, en* (eno, enp, ens, enx), wl* (wlan, wlp, wlx). Everything else carries private addresses too without being the home
// network: docker, podman, incus and libvirt bridges, veth/vnet, VPNs and tunnels (mesh VPNs, wg, nordlynx, tun, tap, ppp, zerotier), sandbox bridges.
const HEIMNETZ_SCHNITTSTELLE = /^(eth\d|en(o|p|s|x)|wl)/;

/** The home-network address of this host, from the interface table, or null. IPv4, not internal, RFC 1918, on a physical-looking interface; the 192 range before 10/8 before 172.16/12. */
export function heimAdresse(schnittstellen: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string | null {
  const kandidaten: string[] = [];
  for (const [name, liste] of Object.entries(schnittstellen)) {
    if (!HEIMNETZ_SCHNITTSTELLE.test(name)) continue;
    for (const i of liste ?? []) if (i.family === 'IPv4' && !i.internal && istPrivat(i.address)) kandidaten.push(i.address);
  }
  const rang = (ip: string): number => (ip.startsWith('192.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  kandidaten.sort((x, y) => rang(x) - rang(y));
  return kandidaten[0] ?? null;
}

// ---------- deny list ----------

// What a paired tablet may not reach. Matching is on the pathname the router itself uses (an exact path or a path prefix up to a "/"), for every method.
// Reason per entry: units and processes (start, stop, record, render), device and controller profiles, the project, code evaluation, files of the library.
export const TABLET_VERBOTEN: readonly { pfad: string; warum: string }[] = [
  { pfad: '/kopplung', warum: 'pairing is managed from the loopback page only' },
  { pfad: '/deck/start', warum: 'starts a deck' }, { pfad: '/deck/stopp', warum: 'stops a deck' },
  { pfad: '/spur', warum: 'starts and stops automation tracks and the take recorder' },
  { pfad: '/abbruch', warum: 'aborts running parts' },
  { pfad: '/strudel', warum: 'evaluates pattern code and switches the autonomous players' },
  { pfad: '/graph', warum: 'loads a graph into a channel (restarts its sound)' },
  { pfad: '/geraete', warum: 'device profiles: inputs, MIDI, latency' },
  { pfad: '/lernen', warum: 'controller profiles (MIDI learn), also the host learn table' },
  { pfad: '/plugins', warum: 'plug-in scan, unlock, rescan (spawns processes)' },
  { pfad: '/proj', warum: 'the project: freeze, bounce, export, stems, recording, edits' },
  { pfad: '/sammlungen', warum: 'sets: import, rename, delete' },
  { pfad: '/mediathek', warum: 'library preparation (spawns decoders)' },
  { pfad: '/vorhoeren', warum: 'pre-listening player' },
  { pfad: '/loops', warum: 'loop import' }, { pfad: '/loop', warum: 'loop boxes: record, start, stop' },
  { pfad: '/muster', warum: 'writes patterns' },
  { pfad: '/griff', warum: 'hand grips of the DJ view' }, { pfad: '/taste', warum: 'keys of the DJ view' },
  { pfad: '/laden', warum: 'loads material into a deck' }, { pfad: '/tempo', warum: 'master tempo' },
  { pfad: '/fx', warum: 'beat FX of the DJ view' },
  { pfad: '/deck', warum: 'deck transport and grid' }, { pfad: '/ansage', warum: 'announcements' },
  { pfad: '/presets', warum: 'writes preset files' }, { pfad: '/kollektionen', warum: 'writes collections' },
];
// The POSTs a tablet may send at all: the knobs of the device page. Everything else is refused as well, so a route added later is closed until it is named here.
export const TABLET_POST_ERLAUBT: readonly string[] = ['/regler', '/klang'];
// POST /klang carries many actions; the panel needs these only. Not allowed: lade, speichere, setze, hoere, fenster (the plug-in window on the host display).
export const TABLET_KLANG_AKTIONEN: readonly string[] = ['param', 'params', 'ist', 'fahre', 'zeige', 'liste'];

const unter = (pfad: string, wurzel: string): boolean => pfad === wurzel || pfad.startsWith(`${wurzel}/`);

/** true: the tablet listener refuses this (method, pathname) with 403. Reads stay open except under /kopplung; a POST must be on the allowed list. */
export function tabletVerboten(methode: string, pfad: string): boolean {
  if (unter(pfad, '/kopplung')) return true;
  if (methode === 'GET') return false;
  if (methode === 'POST' && TABLET_POST_ERLAUBT.includes(pfad)) return false;
  return true;   // POST elsewhere, PUT, DELETE, ...: closed (the deny list above names the known ones with a reason, this keeps unknown ones closed too)
}
/** The deny-list entry that names (method, pathname), for the answer and the log; null when only the default closes it. */
export function tabletVerbotenGrund(pfad: string): string | null {
  return TABLET_VERBOTEN.find((v) => unter(pfad, v.pfad))?.warum ?? null;
}

// ---------- pairing ----------

const sha = (s: string): Buffer => crypto.createHash('sha256').update(s).digest();
const zufall = (): string => crypto.randomBytes(32).toString('base64url');

export interface Geraet { id: string; name: string; hash: string; seit: number; zuletzt: number }
const gespeichert = new WeakMap<Geraet, number>();   // the last-seen time that is on disk
export type Einloesung = { ok: true; cookie: string; id: string } | { ok: false; warum: 'ungueltig' | 'abgelaufen' | 'zu_viele' };

export class Kopplung {
  private geraete: Geraet[] = [];
  private readonly links = new Map<string, number>();   // sha256(link token) as hex -> valid until (ms)
  private readonly fehler = new Map<string, number[]>();   // remote address -> times of wrong tries
  private readonly datei: string;
  private readonly jetzt: () => number;
  constructor(datei: string, jetzt: () => number = Date.now) {
    this.datei = datei; this.jetzt = jetzt;
    try {
      const j = JSON.parse(fs.readFileSync(datei, 'utf8')) as { geraete?: unknown };
      if (Array.isArray(j.geraete)) {
        this.geraete = j.geraete.filter((g): g is Geraet => typeof g?.id === 'string' && typeof g?.hash === 'string' && /^[0-9a-f]{64}$/.test(g.hash))
          .map((g) => ({ id: g.id, name: String(g.name ?? ''), hash: g.hash, seit: Number(g.seit) || 0, zuletzt: Number(g.zuletzt) || 0 }));
        for (const g of this.geraete) gespeichert.set(g, g.zuletzt);
      }
    } catch { /* no file yet or unreadable: no paired device */ }
  }

  /** A one-time link token. The token itself is returned once; only its hash is kept (in memory: a restart voids open links). */
  neuerLink(): { token: string; bis: number } {
    const t = this.jetzt();
    for (const [h, bis] of this.links) if (bis < t) this.links.delete(h);
    while (this.links.size >= MAX_LINKS) this.links.delete(this.links.keys().next().value as string);   // the oldest goes
    const token = zufall(), bis = t + LINK_MS;
    this.links.set(sha(token).toString('hex'), bis);
    return { token, bis };
  }

  /** Redeems a link token: one use, within 2 minutes. On success a new device is stored (hash only) and its cookie value returned once. */
  loeseEin(token: string, name = '', adresse = ''): Einloesung {
    const t = this.jetzt();
    const meine = (this.fehler.get(adresse) ?? []).filter((x) => x > t - FEHLVERSUCHE.fenster);
    if (meine.length) this.fehler.set(adresse, meine); else this.fehler.delete(adresse);
    if (meine.length >= FEHLVERSUCHE.max) return { ok: false, warum: 'zu_viele' };
    const falsch = (): void => {
      meine.push(t); this.fehler.set(adresse, meine);
      if (this.fehler.size > FEHLVERSUCHE.adressen) this.fehler.delete(this.fehler.keys().next().value as string);   // the oldest address is forgotten
    };
    const h = sha(token).toString('hex');
    const bis = this.links.get(h);
    this.links.delete(h);   // used or expired, either way it is gone
    if (bis === undefined) { falsch(); return { ok: false, warum: 'ungueltig' }; }
    if (bis < t) { falsch(); return { ok: false, warum: 'abgelaufen' }; }
    const cookie = zufall(), id = crypto.randomBytes(6).toString('hex');
    const g: Geraet = { id, name: name.replace(/[^\x20-\x7e]/g, '').slice(0, 80), hash: sha(cookie).toString('hex'), seit: t, zuletzt: t };
    this.geraete.push(g);
    gespeichert.set(g, t);
    this.sichere();
    return { ok: true, cookie, id };
  }

  /** The id of the paired device a Cookie header belongs to, or null. Hashes the presented value and compares it to every stored hash in constant time (no early exit). */
  pruefe(cookieKopf: string | undefined): string | null {
    const wert = cookieWert(cookieKopf);
    if (wert === null) return null;
    const h = sha(wert);
    let treffer: Geraet | null = null;
    for (const g of this.geraete) if (crypto.timingSafeEqual(h, Buffer.from(g.hash, 'hex')) && treffer === null) treffer = g;
    if (treffer === null) return null;
    const t = this.jetzt();
    if (t - treffer.zuletzt > GERAET_MAX_MS) { this.widerrufe(treffer.id); return null; }   // idle for 30 days: unpaired
    treffer.zuletzt = t;
    if (t - (gespeichert.get(treffer) ?? 0) > ZULETZT_SPEICHERN_MS) { gespeichert.set(treffer, t); this.sichere(); }
    return treffer.id;
  }

  liste(): { id: string; name: string; seit: number; zuletzt: number }[] {
    const t = this.jetzt();
    for (const g of this.geraete.filter((x) => t - x.zuletzt > GERAET_MAX_MS)) this.widerrufe(g.id);
    return this.geraete.map(({ id, name, seit, zuletzt }) => ({ id, name, seit, zuletzt }));
  }
  widerrufe(id: string): boolean {
    const n = this.geraete.length;
    this.geraete = this.geraete.filter((g) => g.id !== id);
    if (this.geraete.length === n) return false;
    this.sichere();
    return true;
  }
  private sichere(): void {
    fs.mkdirSync(path.dirname(this.datei), { recursive: true, mode: 0o700 });
    const tmp = `${this.datei}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ geraete: this.geraete }, null, 1) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.datei);
  }
}

export function cookieWert(kopf: string | undefined): string | null {
  for (const teil of String(kopf ?? '').split(';')) {
    const i = teil.indexOf('=');
    if (i > 0 && teil.slice(0, i).trim() === COOKIE) { const w = teil.slice(i + 1).trim(); return /^[A-Za-z0-9_-]{43}$/.test(w) ? w : null; }
  }
  return null;
}

// ---------- the request path of the second listener ----------

export interface TabletHandlerOptionen {
  kopplung: Kopplung;
  host: string;                                                    // "<address>:<port>": the only Host header accepted (rebinding guard)
  weiter: (q: http.IncomingMessage, a: http.ServerResponse) => Promise<void>;   // the normal router path, run with source andreas
  json: (a: http.ServerResponse, code: number, daten: unknown) => void;
  log?: (zeile: Record<string, unknown>) => void;
  logMs?: number;                                                  // wrong pairing tries are logged as one summary line per this window (default 60 s)
}
export interface TabletHandler {
  anfrage(q: http.IncomingMessage, a: http.ServerResponse): Promise<void>;
  /** Closes the open connections of a revoked device (an event stream would otherwise outlive the revocation). */
  kappe(id: string): void;
}

async function bodyLesen(q: http.IncomingMessage): Promise<Buffer | null> {
  const teile: Buffer[] = [];
  let n = 0;
  for await (const t of q) { n += (t as Buffer).length; if (n > 32768) return null; teile.push(t as Buffer); }
  return Buffer.concat(teile);
}

export function baueTabletHandler(o: TabletHandlerOptionen): TabletHandler {
  const sockets = new Map<string, Set<import('node:net').Socket>>();
  const merke = (id: string, q: http.IncomingMessage): void => {
    const s = q.socket;
    let menge = sockets.get(id);
    if (!menge) sockets.set(id, (menge = new Set()));
    if (!menge.has(s)) { menge.add(s); s.once('close', () => sockets.get(id)?.delete(s)); }
  };
  // wrong pairing tries: one summary line per window (the first try opens the window), so a client that hammers /koppeln cannot fill the log
  let fehlSumme: { anzahl: number; warum: Record<string, number>; adressen: Set<string> } | null = null;
  const abgewiesen = (warum: string, adresse: string): void => {
    if (fehlSumme === null) {
      const f = (fehlSumme = { anzahl: 0, warum: {}, adressen: new Set() });
      setTimeout(() => { fehlSumme = null; o.log?.({ typ: 'tablet_kopplung_abgewiesen', anzahl: f.anzahl, warum: f.warum, adressen: [...f.adressen].slice(0, 5) }); }, o.logMs ?? 60_000).unref();
    }
    fehlSumme.anzahl++; fehlSumme.warum[warum] = (fehlSumme.warum[warum] ?? 0) + 1; fehlSumme.adressen.add(adresse);
  };
  const abweisen = (a: http.ServerResponse, code: number, fehler: string, text: string): void => o.json(a, code, { fehler, text });

  async function anfrage(q: http.IncomingMessage, a: http.ServerResponse): Promise<void> {
    if (q.headers.host !== o.host) return abweisen(a, 421, 'falscher_host', 'use the address shown when pairing');
    const url = new URL(q.url ?? '/', 'http://tablet.invalid');
    // the one route without a cookie: redeeming a one-time link sets the cookie
    if (q.method === 'GET' && url.pathname === '/koppeln') {
      const r = o.kopplung.loeseEin(url.searchParams.get('t') ?? '', String(q.headers['user-agent'] ?? ''), q.socket.remoteAddress ?? '');
      if (!r.ok) { abgewiesen(r.warum, q.socket.remoteAddress ?? ''); return abweisen(a, r.warum === 'zu_viele' ? 429 : 401, r.warum, 'this pairing link is not valid (any more): create a new one on the main page'); }
      o.log?.({ typ: 'tablet_gekoppelt', id: r.id });
      // A page, not a 302: the link usually arrives from a QR scanner (a cross-site navigation), and Chrome does not send a SameSite=Strict
      // cookie on the redirected request of such a navigation ("this device is not paired" right after pairing, 2026-11-11). The page's own
      // navigation below is same-site, so the cookie goes along.
      a.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=${r.cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_S}` });
      return void a.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        + '<meta http-equiv="refresh" content="0;url=/#tablet"><title>Paired</title>'
        + '<p style="font:16px sans-serif">Paired. <a href="/#tablet">Open the instruments</a></p>'
        + "<script>location.replace('/#tablet')</script>");
    }
    const id = o.kopplung.pruefe(q.headers.cookie);
    if (id === null) return abweisen(a, 401, 'nicht_gekoppelt', 'this device is not paired');
    const methode = q.method ?? '';
    if (tabletVerboten(methode, url.pathname)) {
      o.log?.({ typ: 'tablet_verboten', id, methode, pfad: url.pathname });
      return abweisen(a, 403, 'nicht_am_tablet', tabletVerbotenGrund(url.pathname) ?? 'this route is not available from the tablet');
    }
    merke(id, q);
    if (methode === 'POST' && url.pathname === '/klang') {   // the action decides: the body is read here and handed on unchanged
      const roh = await bodyLesen(q);
      let aktion: unknown;
      try { aktion = (JSON.parse(roh?.toString('utf8') || '{}') as { aktion?: unknown }).aktion; } catch { aktion = undefined; }
      if (roh === null || typeof aktion !== 'string' || !TABLET_KLANG_AKTIONEN.includes(aktion)) {
        o.log?.({ typ: 'tablet_verboten', id, methode, pfad: url.pathname, aktion: typeof aktion === 'string' ? aktion : null });
        return abweisen(a, 403, 'nicht_am_tablet', `POST /klang from the tablet: only ${TABLET_KLANG_AKTIONEN.join(', ')}`);
      }
      const q2 = Object.assign(Readable.from([roh]), { headers: q.headers, method: q.method, url: q.url, socket: q.socket }) as unknown as http.IncomingMessage;
      return await o.weiter(q2, a);
    }
    return await o.weiter(q, a);
  }
  return {
    anfrage,
    kappe(id) { for (const s of sockets.get(id) ?? []) s.destroy(); sockets.delete(id); },
  };
}
