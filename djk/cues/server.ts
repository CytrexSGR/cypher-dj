// djk cues: lokales Werkzeug zum schnellen Setzen von Hotcues an der Wellenform (Andreas, 2026-09-26).
// Liefert die Seite aus oeffentlich/, die Trackliste (Tags), Wellenformen (Cache), die MP3 zum Abhören (Range) und
// liest/schreibt Cue-Dateien. Nur 127.0.0.1. Andreas' MP3 werden nur gelesen, nie geschrieben.
// Aufruf: node djk/cues/server.ts [--port 47730] [--wurzel DIR] [--nml DATEI] [--daten DIR] [--cache DIR]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import crypto from 'node:crypto';
import { ladeBibliothek, ladeListen, ladeTraktor, verschiebeTraktor, type Liste, type Track, type TraktorEintrag } from './bibliothek.ts';
import { dekodiereKopf, rechneUndCache } from './welle.ts';
import { EingabeFehler, lade, sha1ErsteMib, speichere, zaehleAlle } from './speicher.ts';
import { VorhoererKlient } from './vorhoerer-klient.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const OEFFENTLICH = path.join(HIER, 'oeffentlich');
const BASIS = path.join(os.homedir(), 'cypher-dj', 'cues');

export const VORGABE = {
  port: 47730,
  wurzel: process.env.CYPHERDJ_MUSIK ?? '',            // Pflicht (Umgebung CYPHERDJ_MUSIK oder --wurzel), main prüft
  nml: process.env.CYPHERDJ_NML || null,              // optional (Traktor collection.nml)
  daten: path.join(BASIS, 'daten'),
  cache: path.join(BASIS, 'cache'),
};

export interface Optionen {
  port: number; wurzel: string; nml: string | null; daten: string; cache: string; lastGrenze?: number;
  log?: (z: Record<string, unknown>) => void;
  // Nativer Vorhörer (djk/vorhoerer, OSC/UDP): ohne `ausgang` kein Kindprozess, die Seite bleibt auf <audio>
  // (Andreas 2026-09-26: „browser dann nur anzeige“ ist das Ziel, aber nur mit `--ausgang` auf seine Senke).
  ausgang?: string; tonFrei?: boolean; ohneBlende?: boolean;
  vorhoererBin?: string; vorhoererInstanz?: string; vorhoererPort?: number; vorhoererQuantum?: number;
}

const TYPEN: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

export class CueServer {
  http: http.Server | null = null;
  tracks: Track[] = [];
  nachRel = new Map<string, Track>();
  listen: Liste[] = [];
  traktor = new Map<string, TraktorEintrag>();
  vorlaeufe = new Map<string, number>();
  // Encoder-Vorlauf der Datei (ffprobe stream start_time), einmal je Track gemerkt; Fehler → 0
  vorlauf(t: Track): Promise<number> {
    const m = this.vorlaeufe.get(t.rel);
    if (m !== undefined) return Promise.resolve(m);
    return new Promise((ok) => {
      const p = spawn('ffprobe', ['-v', 'quiet', '-select_streams', 'a:0', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', path.join(this.opt.wurzel, t.rel)]);
      let o = ''; p.stdout.on('data', (b) => { o += b; });
      p.on('close', () => { const v = Number.parseFloat(o); const w = Number.isFinite(v) && v >= 0 && v < 1 ? v : 0; this.vorlaeufe.set(t.rel, w); ok(w); });
      p.on('error', () => ok(0));
    });
  }
  zaehler = new Map<string, number>();
  laden = { ms: 0, frisch: 0 };
  vorrechnen = { laeuft: false, fertig: 0, gesamt: 0, fehler: 0, pausiert_last: false };
  vorhoerer: VorhoererKlient | null = null;
  private sseKlienten = new Set<http.ServerResponse>();
  private stopp = false;
  private inArbeit = new Map<string, Promise<Buffer>>();
  opt: Optionen;
  constructor(opt: Optionen) { this.opt = opt; }

  async starte(): Promise<void> {
    fs.mkdirSync(this.opt.daten, { recursive: true });
    fs.mkdirSync(path.join(this.opt.cache, 'welle'), { recursive: true });
    const b = await ladeBibliothek(this.opt.wurzel, path.join(this.opt.cache, 'index.json'));
    this.tracks = b.tracks;
    this.laden = { ms: Math.round(b.ms), frisch: b.frisch };
    this.nachRel = new Map(this.tracks.map((t) => [t.rel, t]));
    this.listen = ladeListen(this.opt.wurzel, this.tracks);
    this.traktor = this.opt.nml ? ladeTraktor(this.opt.nml, path.basename(this.opt.wurzel)) : new Map();
    this.zaehler = zaehleAlle(this.opt.daten);
    await this.starteVorhoerer();
    this.http = http.createServer((q, a) => { this.anfrage(q, a).catch((e: Error) => this.json(a, 500, { fehler: e.message })); });
    await new Promise<void>((ok, f) => { this.http!.once('error', f); this.http!.listen(this.opt.port, '127.0.0.1', ok); });
    this.opt.log?.({ typ: 'bereit', port: this.port, tracks: this.tracks.length, index_ms: this.laden.ms, frisch: this.laden.frisch, traktor: this.traktor.size, vorhoerer: !!this.vorhoerer });
  }

  // Ohne --ausgang: kein Kindprozess, die Seite bleibt auf <audio> (Browser-Fallback). Mit --ausgang, aber der
  // Start scheitert (Binärdatei fehlt, Riegel, JACK weg): ebenso Fallback, aber geloggt statt verschluckt.
  private async starteVorhoerer(): Promise<void> {
    if (!this.opt.ausgang) return;
    const bin = this.opt.vorhoererBin ?? path.join(HIER, '..', 'vorhoerer', 'build', 'cypherdj-vorhoerer');
    const v = new VorhoererKlient({
      bin, ausgang: this.opt.ausgang, tonFrei: this.opt.tonFrei, ohneBlende: this.opt.ohneBlende,
      instanz: this.opt.vorhoererInstanz, port: this.opt.vorhoererPort, quantum: this.opt.vorhoererQuantum,
      log: this.opt.log ? (z) => this.opt.log!({ typ: 'vorhoerer', ...z }) : undefined,
    });
    try {
      await v.starte();
      this.vorhoerer = v;
      v.on('position', (d) => this.sseRundruf('position', d));
      v.on('geladen', (d) => this.sseRundruf('geladen', d));
      v.on('fehler', (d) => this.sseRundruf('fehler', { text: d }));
      v.on('ended', () => this.sseRundruf('ended', {}));
    } catch (e) {
      this.opt.log?.({ typ: 'vorhoerer_fehlgeschlagen', fehler: (e as Error).message });
      // v.starte() kann nach dem Socket-Bind scheitern (Kindprozess stirbt, antwortet nicht): ohne dieses Aufräumen
      // bliebe das UDP-Socket offen und hielte den Prozess am Leben (gemessen: node --test hing nach Testende).
      await v.stoppe().catch(() => { /* Socket ggf. schon zu, Kind ggf. schon tot */ });
      this.vorhoerer = null;
    }
  }

  private sseRundruf(ev: string, daten: unknown): void {
    for (const a of this.sseKlienten) {
      try { a.write(`event: ${ev}\ndata: ${JSON.stringify(daten)}\n\n`); } catch { this.sseKlienten.delete(a); }
    }
  }

  get port(): number { return (this.http!.address() as { port: number }).port; }

  async stoppe(): Promise<void> {
    this.stopp = true;
    for (const a of this.sseKlienten) { try { a.end(); } catch { /* schon zu */ } }
    this.sseKlienten.clear();
    await this.vorhoerer?.stoppe();
    await new Promise((r) => this.http?.close(r));
  }

  private json(a: http.ServerResponse, code: number, o: unknown): void {
    a.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    a.end(JSON.stringify(o));
  }

  private track(u: URL): Track {
    const rel = u.searchParams.get('rel') ?? '';
    const t = this.nachRel.get(rel);
    if (!t) throw Object.assign(new Error(`unbekannter Track: ${rel}`), { code: 404 });
    return t;
  }

  welleDatei(t: Track): string {
    const h = crypto.createHash('sha1').update(`${t.rel}|${t.groesse}|${t.mtime}`).digest('hex');
    return path.join(this.opt.cache, 'welle', `${h}.welle`);
  }

  // Aus dem Cache oder frisch rechnen; gleichzeitige Anfragen für denselben Track teilen sich eine Rechnung
  async welle(t: Track, nice = false): Promise<{ b: Buffer; aus_cache: boolean; ms: number }> {
    const t0 = performance.now();
    const ziel = this.welleDatei(t);
    try { const b = fs.readFileSync(ziel); dekodiereKopf(b); return { b, aus_cache: true, ms: performance.now() - t0 }; } catch { /* rechnen */ }
    let p = this.inArbeit.get(ziel);
    if (!p) {
      p = rechneUndCache(path.join(this.opt.wurzel, t.rel), ziel, { nice }).finally(() => this.inArbeit.delete(ziel));
      this.inArbeit.set(ziel, p);
    }
    const b = await p;
    return { b, aus_cache: false, ms: performance.now() - t0 };
  }

  // Hintergrund: höchstens 2 Prozesse, nice 19, Pause solange die 1-min-Last > 4
  async starteVorrechnen(): Promise<void> {
    if (this.vorrechnen.laeuft) return;
    const offen = this.tracks.filter((t) => !fs.existsSync(this.welleDatei(t)));
    this.vorrechnen = { laeuft: true, fertig: 0, gesamt: offen.length, fehler: 0, pausiert_last: false };
    const arbeiter = async (): Promise<void> => {
      while (offen.length && this.vorrechnen.laeuft && !this.stopp) {
        while (os.loadavg()[0] > (this.opt.lastGrenze ?? 4) && this.vorrechnen.laeuft && !this.stopp) { this.vorrechnen.pausiert_last = true; await new Promise((r) => setTimeout(r, 500)); }
        this.vorrechnen.pausiert_last = false;
        // nach der Pause neu prüfen: ausgeschaltet oder der andere Arbeiter hat den letzten genommen
        if (!this.vorrechnen.laeuft || this.stopp || !offen.length) break;
        const t = offen.shift()!;
        const ziel = this.welleDatei(t);
        if (fs.existsSync(ziel)) { this.vorrechnen.fertig++; continue; }
        const rc = await new Promise<number>((ok) => {
          const p = spawn('nice', ['-n', '19', process.execPath, path.join(HIER, 'welle.ts'), path.join(this.opt.wurzel, t.rel), ziel], { stdio: 'ignore' });
          p.once('close', (c) => ok(c ?? 1));
          p.once('error', () => ok(1));
        });
        if (rc === 0) this.vorrechnen.fertig++; else this.vorrechnen.fehler++;
      }
    };
    void Promise.all([arbeiter(), arbeiter()]).then(() => { this.vorrechnen.laeuft = false; });
  }

  private liste(): unknown {
    return {
      wurzel: this.opt.wurzel,
      index_ms: this.laden.ms,
      listen: this.listen.map((l) => ({ name: l.name, rels: l.rels, fehlend: l.fehlend })),
      tracks: this.tracks.map((t) => ({ rel: t.rel, titel: t.titel, artist: t.artist, bpm: t.bpm, tonart: t.tonart, energie: t.energie,
        cues: this.zaehler.get(t.rel) ?? 0, traktor: (this.traktor.get(path.basename(t.rel).toLowerCase())?.cues.length ?? 0) > 0 })),
    };
  }

  private async anfrage(q: http.IncomingMessage, a: http.ServerResponse): Promise<void> {
    const u = new URL(q.url ?? '/', 'http://127.0.0.1');
    try {
      if (q.method === 'GET' && u.pathname === '/api/tracks') { this.json(a, 200, this.liste()); return; }
      if (q.method === 'GET' && u.pathname === '/api/status') { this.json(a, 200, { vorrechnen: this.vorrechnen, last: os.loadavg()[0] }); return; }
      if (q.method === 'POST' && u.pathname === '/api/vorrechnen') {
        if (u.searchParams.get('an') === '0') this.vorrechnen.laeuft = false; else await this.starteVorrechnen();
        this.json(a, 200, { vorrechnen: this.vorrechnen }); return;
      }
      if (q.method === 'GET' && u.pathname === '/api/welle') {
        const w = await this.welle(this.track(u));
        a.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-aus-cache': String(w.aus_cache), 'x-ms': w.ms.toFixed(1) });
        a.end(w.b); return;
      }
      if (q.method === 'GET' && u.pathname === '/api/audio') { this.audio(q, a, this.track(u)); return; }
      if (u.pathname.startsWith('/api/vorhoerer/')) { this.vorhoererAnfrage(q, a, u); return; }
      if (q.method === 'GET' && u.pathname === '/api/cues') {
        const t = this.track(u);
        const d = lade(this.opt.daten, t.rel);
        let passt = true;
        if (d) {
          const abs = path.join(this.opt.wurzel, t.rel);
          passt = d.schluessel.groesse === t.groesse && d.schluessel.sha1_erste_mib === sha1ErsteMib(abs);
        }
        const tr = verschiebeTraktor(this.traktor.get(path.basename(t.rel).toLowerCase()) ?? null, await this.vorlauf(t));
        this.json(a, 200, { datei: d, schluessel_passt: passt, traktor: tr, tags: { titel: t.titel, artist: t.artist, bpm: t.bpm, tonart: t.tonart, energie: t.energie } });
        return;
      }
      if (q.method === 'PUT' && u.pathname === '/api/cues') {
        const t = this.track(u);
        const koerper = await new Promise<string>((ok, f) => { let s = ''; q.setEncoding('utf8'); q.on('data', (d) => { s += d; if (s.length > 1e6) f(new EingabeFehler('zu groß')); }); q.on('end', () => ok(s)); });
        let e: unknown;
        try { e = JSON.parse(koerper); } catch { throw new EingabeFehler('kein JSON'); }
        const w = await this.welle(t);
        const dauer = dekodiereKopf(w.b).dauer_s;
        const d = speichere(this.opt.daten, this.opt.wurzel, t.rel, { titel: t.titel, artist: t.artist, tbpm: t.bpm, tkey: t.tonart }, e, dauer);
        if (d && d.cues.length) this.zaehler.set(t.rel, d.cues.length); else this.zaehler.delete(t.rel);
        this.opt.log?.({ typ: 'gespeichert', rel: t.rel, cues: d?.cues.length ?? 0 });
        this.json(a, 200, { datei: d }); return;
      }
      if (q.method === 'GET') { this.statisch(u, a); return; }
      this.json(a, 405, { fehler: 'Methode' });
    } catch (e) {
      const code = e instanceof EingabeFehler ? 400 : (e as { code?: number }).code === 404 ? 404 : 500;
      this.json(a, code, { fehler: (e as Error).message });
    }
  }

  private statisch(u: URL, a: http.ServerResponse): void {
    const name = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const p = path.resolve(OEFFENTLICH, name);
    if (!p.startsWith(OEFFENTLICH + path.sep) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { this.json(a, 404, { fehler: 'nicht da' }); return; }
    a.writeHead(200, { 'content-type': TYPEN[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(p).pipe(a);
  }

  // MP3 mit Range-Unterstützung (Springen im Browser), nur lesend
  private audio(q: http.IncomingMessage, a: http.ServerResponse, t: Track): void {
    const p = path.join(this.opt.wurzel, t.rel);
    const g = fs.statSync(p).size;
    const r = /^bytes=(\d*)-(\d*)$/.exec(q.headers.range ?? '');
    if (r) {
      let von = r[1] ? Number(r[1]) : g - Number(r[2]);
      let bis = r[1] && r[2] ? Number(r[2]) : g - 1;
      if (!r[1]) { von = Math.max(0, von); bis = g - 1; }
      if (von >= g || von > bis) { a.writeHead(416, { 'content-range': `bytes */${g}` }); a.end(); return; }
      bis = Math.min(bis, g - 1);
      a.writeHead(206, { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'content-range': `bytes ${von}-${bis}/${g}`, 'content-length': bis - von + 1 });
      fs.createReadStream(p, { start: von, end: bis, flags: 'r' }).pipe(a);
      return;
    }
    a.writeHead(200, { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'content-length': g });
    fs.createReadStream(p, { flags: 'r' }).pipe(a);
  }

  // Zweiter Weg für spieler.js (oeffentlich/spieler.js), dieselbe API wie das <audio>-Element: laden, play, pause,
  // springe, loop/loop_aus, dazu status (welcher Weg aktiv) und stream (SSE: position, geladen, fehler, ended).
  // Ohne Kindprozess (kein --ausgang oder Start gescheitert): 409, die Seite fällt auf <audio> zurück.
  private vorhoererAnfrage(q: http.IncomingMessage, a: http.ServerResponse, u: URL): void {
    const pfad = u.pathname.slice('/api/vorhoerer/'.length);
    if (q.method === 'GET' && pfad === 'status') {
      this.json(a, 200, {
        aktiv: !!this.vorhoerer, weg: this.vorhoerer ? 'vorhoerer' : 'browser',
        geladen: this.vorhoerer?.geladen ?? null, position: this.vorhoerer?.letztePosition ?? null,
        spielt: this.vorhoerer?.spielt ?? false, fehler: this.vorhoerer?.fehler ?? null,
      });
      return;
    }
    if (q.method === 'GET' && pfad === 'stream') {
      a.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      a.write(': verbunden\n\n');
      this.sseKlienten.add(a);
      q.on('close', () => this.sseKlienten.delete(a));
      return;
    }
    if (!this.vorhoerer) { this.json(a, 409, { fehler: 'kein Vorhörer gestartet (--ausgang fehlt oder Start gescheitert)' }); return; }
    if (q.method === 'POST' && pfad === 'laden') { this.vorhoerer.laden(path.join(this.opt.wurzel, this.track(u).rel)); this.json(a, 200, { ok: true }); return; }
    if (q.method === 'POST' && pfad === 'play') { this.vorhoerer.play(); this.json(a, 200, { ok: true }); return; }
    if (q.method === 'POST' && pfad === 'pause') { this.vorhoerer.pause(); this.json(a, 200, { ok: true }); return; }
    if (q.method === 'POST' && pfad === 'springe') {
      const s = Number(u.searchParams.get('s'));
      if (!Number.isFinite(s)) throw new EingabeFehler('s fehlt oder ungültig');
      this.vorhoerer.springe(s); this.json(a, 200, { ok: true }); return;
    }
    if (q.method === 'POST' && pfad === 'loop') {
      const von = Number(u.searchParams.get('a')); const bis = Number(u.searchParams.get('b'));
      if (!Number.isFinite(von) || !Number.isFinite(bis) || von >= bis) throw new EingabeFehler('a/b fehlen oder ungültig');
      this.vorhoerer.loop(von, bis); this.json(a, 200, { ok: true }); return;
    }
    if (q.method === 'POST' && pfad === 'loop_aus') { this.vorhoerer.loopAus(); this.json(a, 200, { ok: true }); return; }
    this.json(a, 404, { fehler: 'unbekannt' });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    port: { type: 'string' }, wurzel: { type: 'string' }, nml: { type: 'string' }, daten: { type: 'string' }, cache: { type: 'string' },
    ausgang: { type: 'string' }, 'ton-frei': { type: 'boolean' }, 'ohne-blende': { type: 'boolean' },
    'vorhoerer-bin': { type: 'string' }, 'vorhoerer-instanz': { type: 'string' }, 'vorhoerer-port': { type: 'string' },
  } });
  const wurzel = values.wurzel ?? VORGABE.wurzel;
  if (!wurzel) {
    process.stderr.write('djk cues: keine Musikwurzel. Umgebungsvariable CYPHERDJ_MUSIK setzen (Wurzel der Musiksammlung) oder --wurzel DIR angeben; Vorlage: djk/konfig/umgebung.env.beispiel\n');
    process.exit(2);
  }
  const s = new CueServer({
    port: Number(values.port ?? VORGABE.port), wurzel, nml: values.nml ?? VORGABE.nml,
    daten: values.daten ?? VORGABE.daten, cache: values.cache ?? VORGABE.cache,
    ausgang: values.ausgang, tonFrei: values['ton-frei'], ohneBlende: values['ohne-blende'],
    vorhoererBin: values['vorhoerer-bin'], vorhoererInstanz: values['vorhoerer-instanz'],
    vorhoererPort: values['vorhoerer-port'] ? Number(values['vorhoerer-port']) : undefined,
    log: (z) => process.stdout.write(`${JSON.stringify(z)}\n`),
  });
  s.starte().then(() => process.stdout.write(`djk cues: http://127.0.0.1:${s.port}/ (vorhoerer: ${!!s.vorhoerer})\n`), (e: Error) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
