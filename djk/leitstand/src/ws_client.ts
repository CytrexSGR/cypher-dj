// WebSocket-Client für den Leitstand-Hub (SCHNITTSTELLEN §9): meldet sich mit einer Rolle an, schickt Umschläge
// mit eigenem seq und sammelt jede Nachricht mit Empfangszeit (CLOCK_MONOTONIC). Genutzt von der Ansage-Zeile,
// vom Prüf-Client und von den Tests.
import WebSocket from 'ws';
import type { Umschlag } from './hub.ts';
import { jetztNs, type Zeitpunkt } from './zeit.ts';

export interface Empfangen { n: Umschlag; t: number }

export class WsClient {
  readonly ws: WebSocket;
  readonly empfangen: Empfangen[] = [];
  rolle = 'unbekannt';
  zeit: Zeitpunkt = { sample: 0, beat: 0, takt: 1, phrase: 1 }; // letzter bekannter Kern-Zeitpunkt (§9.1)
  geschlossen: number | null = null;
  bei: ((e: Empfangen) => void) | null = null;
  private seq = 0;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (d) => {
      const e: Empfangen = { n: JSON.parse(d.toString()), t: jetztNs() };
      if (e.n.zeit) this.zeit = e.n.zeit;
      this.empfangen.push(e);
      this.bei?.(e);
    });
    ws.on('close', (code) => { this.geschlossen = code; });
  }

  static verbinde(port: number): Promise<WsClient> {
    return new Promise((ok, fehler) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      ws.once('open', () => ok(new WsClient(ws)));
      ws.once('error', fehler);
    });
  }

  static async angemeldet(port: number, rolle: string, name = 'test'): Promise<WsClient> {
    const c = await WsClient.verbinde(port);
    c.rolle = rolle;
    c.sende('hallo', { rolle, name, protokoll: 1 });
    await c.warteAuf((n) => n.typ === 'willkommen');
    return c;
  }

  sende(typ: string, daten: Record<string, unknown>): void {
    const n: Umschlag = { v: 1, seq: ++this.seq, von: this.rolle, typ, zeit: this.zeit, daten };
    this.ws.send(JSON.stringify(n));
  }

  sendeRoh(text: string): void { this.ws.send(text); }

  // Wartet auf eine Nachricht ab Index ab (Vorgabe: nur Nachrichten, die nach dem Aufruf kommen).
  warteAuf(pred: (n: Umschlag) => boolean, ms = 3000, ab = this.empfangen.length): Promise<Umschlag> {
    const start = ab;
    return new Promise((ok, fehler) => {
      const bis = Date.now() + ms;
      const schau = (): void => {
        const e = this.empfangen.slice(start).find((x) => pred(x.n));
        if (e) { ok(e.n); return; }
        if (Date.now() > bis) { fehler(new Error(`nicht empfangen in ${ms} ms`)); return; }
        setTimeout(schau, 5);
      };
      schau();
    });
  }

  typen(): string[] { return this.empfangen.map((e) => e.n.typ); }

  schliesse(): void { this.ws.close(); }
}
