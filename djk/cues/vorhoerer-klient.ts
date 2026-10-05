// Kindprozess- und OSC/UDP-Verwaltung des nativen Vorhörers (djk/vorhoerer) für den Cue-Server. Der Cue-Server
// startet die Binärdatei mit --ausgang (nur wenn der Server-Parameter --ausgang gesetzt ist; sonst bleibt der
// Browser-Fallback <audio> aktiv, siehe server.ts), leitet Seiten-Befehle per UDP weiter und meldet Positionen,
// Ladezustand und Fehler über Events (server.ts reicht sie per SSE an die Seite weiter).
//
// Befund Vorhörer (docs/architektur/stand/vorhoerer.md, B3): ein Loop greift nur, wenn die Wiedergabe B von innen
// erreicht. Liegt die (geschätzte) aktuelle Position schon auf oder hinter B, springt loop() hier zuerst nach A,
// bevor der Loop gesetzt wird — sonst bliebe die Loop bis zum Dateiende wirkungslos.
import { type ChildProcess, spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { dekodiere, kodiere, type OscWert, vorhoererPort } from './osc.ts';

export interface VorhoererOpt {
  bin: string; // Pfad zur Binärdatei djk/vorhoerer/build/cypherdj-vorhoerer
  ausgang: string; // --ausgang Präfix (Pflicht: ohne diese Klasse gar nicht anlegen)
  tonFrei?: boolean;
  ohneBlende?: boolean;
  instanz?: string; // CYPHERDJ_INSTANZ für Kind + eigenen OSC-Port; Vorgabe process.env.CYPHERDJ_INSTANZ
  port?: number; // OSC-Port-Override, sonst aus instanz (47740 + 1000·k)
  quantum?: number; // pw-jack -p, Vorgabe 256 wie docs/architektur/stand/vorhoerer.md „Starten“
  log?: (z: Record<string, unknown>) => void;
}

export interface Position { s: number; frame: number; empfangen_ms: number; spielt: boolean }
export interface Geladen { pfad: string; dauer_s: number }

export class VorhoererKlient extends EventEmitter {
  proc: ChildProcess | null = null;
  sock: dgram.Socket;
  ziel: { address: string; port: number };
  geladen: Geladen | null = null;
  letztePosition: Position | null = null;
  spielt = false;
  fehler: string | null = null;
  bereit = false;
  private endeGemeldet = false;
  private opt: VorhoererOpt;

  constructor(opt: VorhoererOpt) {
    super();
    this.opt = opt;
    const port = opt.port ?? vorhoererPort(opt.instanz ?? process.env.CYPHERDJ_INSTANZ);
    this.ziel = { address: '127.0.0.1', port };
    this.sock = dgram.createSocket('udp4');
    this.sock.on('message', (b) => this.empfangen(b));
  }

  async starte(): Promise<void> {
    await new Promise<void>((ok, f) => { this.sock.once('error', f); this.sock.bind(0, '127.0.0.1', ok); });
    const args = [this.opt.bin, '--ausgang', this.opt.ausgang, '--port', String(this.ziel.port)];
    if (this.opt.tonFrei) args.push('--ton-frei');
    if (this.opt.ohneBlende) args.push('--ohne-blende');
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.opt.instanz !== undefined) env.CYPHERDJ_INSTANZ = this.opt.instanz;
    // pw-jack: der Vorhörer ist ein JACK-Client, läuft hier über PipeWires JACK-Kompatibilität (wie
    // docs/architektur/stand/vorhoerer.md „Starten“: `pw-jack -p 256 …`).
    this.proc = spawn('pw-jack', ['-p', String(this.opt.quantum ?? 256), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout?.on('data', (b: Buffer) => this.opt.log?.({ typ: 'vorhoerer_stdout', z: b.toString() }));
    this.proc.stderr?.on('data', (b: Buffer) => this.opt.log?.({ typ: 'vorhoerer_stderr', z: b.toString() }));
    let gestorben: string | null = null;
    this.proc.on('exit', (code, signal) => { gestorben = `beendet code=${code} signal=${signal}`; this.opt.log?.({ typ: 'vorhoerer_beendet', code, signal }); this.bereit = false; this.proc = null; });
    const ende = Date.now() + 5000;
    while (Date.now() < ende) {
      this.senden('/v/hallo', '');
      await new Promise((r) => setTimeout(r, 100));
      if (this.bereit) return;
      if (gestorben) throw new Error(`Vorhörer-Prozess ${gestorben}`);
    }
    throw new Error('Vorhörer antwortet nicht (5 s)');
  }

  async stoppe(): Promise<void> {
    this.sock.close();
    const p = this.proc;
    if (p) { p.kill(); await new Promise((r) => p.once('exit', r)); }
  }

  private senden(adr: string, typen: string, ...werte: OscWert[]): void {
    this.sock.send(kodiere(adr, typen, ...werte), this.ziel.port, this.ziel.address);
    this.opt.log?.({ typ: 'osc_gesendet', adr, werte });
  }

  laden(pfadAbs: string): void { this.geladen = null; this.spielt = false; this.endeGemeldet = false; this.senden('/v/laden', 's', pfadAbs); }
  play(): void { this.spielt = true; this.endeGemeldet = false; this.senden('/v/play', ''); }
  pause(): void { this.spielt = false; this.senden('/v/pause', ''); }
  springe(s: number): void { this.senden('/v/springe', 'd', s); }
  loopAus(): void { this.senden('/v/loop_aus', ''); }

  loop(a: number, b: number): void {
    const jetzt = this.geschaetztePosition();
    if (jetzt !== null && jetzt >= b) this.springe(a);
    this.senden('/v/loop', 'dd', a, b);
  }

  // Position jetzt, aus der letzten Meldung plus verstrichener Zeit, wenn gespielt wird (Graph-Versatz 1 Zyklus,
  // ~5,33 ms bei 256 Samples/48 kHz, hier nicht herausgerechnet: die Meldung selbst ist schon Sekunden-genau).
  geschaetztePosition(): number | null {
    if (!this.letztePosition) return null;
    if (!this.spielt) return this.letztePosition.s;
    return this.letztePosition.s + (Date.now() - this.letztePosition.empfangen_ms) / 1000;
  }

  private empfangen(buf: Buffer): void {
    this.bereit = true;
    const { adr, werte } = dekodiere(buf);
    const empfangen_ms = Date.now();
    if (adr === '/v/position') {
      const [s, frame] = werte as [number, number];
      this.letztePosition = { s, frame, empfangen_ms, spielt: this.spielt };
      if (this.spielt && this.geladen && s >= this.geladen.dauer_s - 1e-4) {
        if (!this.endeGemeldet) { this.endeGemeldet = true; this.spielt = false; this.emit('ended'); }
      } else if (this.spielt) { this.endeGemeldet = false; }
      this.emit('position', this.letztePosition);
    } else if (adr === '/v/geladen') {
      const [pfad, dauer_s] = werte as [string, number];
      this.geladen = { pfad, dauer_s };
      this.endeGemeldet = false;
      this.emit('geladen', this.geladen);
    } else if (adr === '/v/fehler') {
      this.fehler = String(werte[0]);
      this.emit('fehler', this.fehler);
    }
  }
}
