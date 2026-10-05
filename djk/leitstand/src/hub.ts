// WebSocket-Hub (SCHNITTSTELLEN §9): Umschlag mit seq je Verbindung und Richtung, Anmeldung per hallo, Rollen,
// rpc mit rpc_antwort/rpc_fehler. Jede eingehende Nachricht wird gegen das WS-Schema aus Scheibe 09 geprüft
// (Verstoß: rpc_fehler mit code "form", §16.2). ansage und anzeige sind nur lesend (§9.2); zuruf von ansage ist
// die eine Ausnahme, die §9.4 ausdrücklich nennt.
import { WebSocketServer, WebSocket } from 'ws';
import { pruefer, SCHEMA_WS } from './vertrag.ts';
import type { Zeitpunkt } from './zeit.ts';

export const ROLLEN = ['spieler', 'mcp', 'analyse', 'werkstatt', 'ansage', 'anzeige', 'pruefstand'] as const;
export type Rolle = (typeof ROLLEN)[number];

// Was jede Rolle an den Leitstand schicken darf (§9.4); alles andere → rpc_fehler, code "form".
export const DARF_SENDEN: Record<Rolle, readonly string[]> = {
  spieler: ['zug_status'],
  mcp: ['rpc'],
  analyse: ['takt_bericht', 'hoerschein'],
  werkstatt: ['auftrag_status', 'material_fertig'],
  ansage: ['zuruf'],
  anzeige: [],
  pruefstand: ['rpc'],
};

export interface Umschlag {
  v: 1;
  seq: number;
  von: string;
  typ: string;
  zeit: Zeitpunkt;
  daten: Record<string, unknown>;
}

// Scheibe 36: eine Methode darf ein Promise liefern (laden wartet auf Kopie und Kern-Quittung). Ein RpcFehler wird
// rpc_fehler mit seinem Code aus §16.2; jede andere Ausnahme bleibt code "form".
export type Methode = (parameter: Record<string, unknown>, client: Client) =>
  Record<string, unknown> | Promise<Record<string, unknown>>;

export class RpcFehler extends Error {
  readonly code: string;
  constructor(code: string, text: string) { super(text); this.code = code; }
}

export interface HubOptionen {
  port: number;
  setId: string;
  generation: () => number;
  autonomie: () => number;
  zeit: () => Zeitpunkt;
  methoden: Record<string, Methode>;
  empfangen: (client: Client, typ: string, daten: Record<string, unknown>) => void;
  gesendet?: (client: Client, n: Umschlag) => void;
}

export class Client {
  rolle: Rolle | null = null;
  name = '';
  seqAus = 0;
  seqEin = 0;
  luecken = 0; // eingehende seq-Lücken dieses Clients
  readonly ws: WebSocket;
  constructor(ws: WebSocket) { this.ws = ws; }
}

const PUFFER_GRENZE = 4 * 1024 * 1024; // ein Client, der 4 MiB nicht abnimmt, wird getrennt
const pruefeWs = pruefer(SCHEMA_WS);

export class Hub {
  private wss: WebSocketServer | null = null;
  readonly clients = new Set<Client>();
  private readonly opt: HubOptionen;

  constructor(opt: HubOptionen) { this.opt = opt; }

  starte(): Promise<void> {
    return new Promise((ok, fehler) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port: this.opt.port });
      wss.once('error', fehler);
      wss.once('listening', () => { wss.off('error', fehler); ok(); });
      wss.on('connection', (ws) => this.verbunden(ws));
      this.wss = wss;
    });
  }

  private verbunden(ws: WebSocket): void {
    const c = new Client(ws);
    this.clients.add(c);
    ws.on('message', (daten, binaer) => this.nachricht(c, binaer ? '' : daten.toString()));
    ws.on('close', () => this.clients.delete(c));
    ws.on('error', () => this.clients.delete(c));
  }

  // Schickt eine Nachricht an einen Client; seq zählt je Verbindung streng steigend ab 1 (§9.1).
  sendeAn(c: Client, typ: string, daten: Record<string, unknown>, zeit?: Zeitpunkt): void {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    if (c.ws.bufferedAmount > PUFFER_GRENZE) { c.ws.terminate(); this.clients.delete(c); return; }
    const n: Umschlag = { v: 1, seq: ++c.seqAus, von: 'leitstand', typ, zeit: zeit ?? this.opt.zeit(), daten };
    c.ws.send(JSON.stringify(n));
    this.opt.gesendet?.(c, n);
  }

  // an: Liste von Rollen oder "alle" (nur angemeldete Clients); gibt die Zahl der Empfänger zurück.
  sende(typ: string, daten: Record<string, unknown>, an: readonly Rolle[] | 'alle', zeit?: Zeitpunkt): number {
    let n = 0;
    for (const c of this.clients) {
      if (c.rolle === null) continue;
      if (an !== 'alle' && !an.includes(c.rolle)) continue;
      this.sendeAn(c, typ, daten, zeit);
      n++;
    }
    return n;
  }

  private fehler(c: Client, id: number, code: string, text: string): void {
    this.sendeAn(c, 'rpc_fehler', { id, code, text });
  }

  private nachricht(c: Client, text: string): void {
    let n: Umschlag;
    try {
      n = JSON.parse(text) as Umschlag;
    } catch {
      this.fehler(c, 0, 'form', 'kein JSON');
      return;
    }
    const d = (typeof n === 'object' && n !== null && typeof n.daten === 'object' && n.daten !== null)
      ? n.daten : {};
    const id = n?.typ === 'rpc' && Number.isInteger(d.id) && (d.id as number) >= 0 ? (d.id as number) : 0;
    if (n?.typ === 'hallo' && d.protokoll !== 1) {
      this.fehler(c, 0, 'protokoll', `Protokoll ${String(d.protokoll)} statt 1 (§9.2)`);
      c.ws.close(1002, 'protokoll');
      return;
    }
    const p = pruefeWs(n);
    if (!p.ok) {
      this.fehler(c, id, 'form', `Nachricht verletzt das Schema (§9): ${p.fehler}`);
      return;
    }
    if (n.seq !== c.seqEin + 1) c.luecken++;
    c.seqEin = n.seq;
    if (c.rolle === null) {
      this.anmelden(c, n.typ, n.daten);
      return;
    }
    if (!DARF_SENDEN[c.rolle].includes(n.typ)) {
      this.fehler(c, id, 'form', `Rolle ${c.rolle} darf ${n.typ} nicht senden (§9.2, §9.4)`);
      return;
    }
    if (n.typ === 'rpc') {
      this.rpc(c, n.daten);
      return;
    }
    this.opt.empfangen(c, n.typ, n.daten);
  }

  private anmelden(c: Client, typ: string, d: Record<string, unknown>): void {
    if (typ !== 'hallo') {
      this.fehler(c, 0, 'form', 'erst hallo (§9.2)');
      return;
    }
    c.rolle = d.rolle as Rolle; // Rolle und Name hat das Schema geprüft
    c.name = d.name as string;
    this.opt.empfangen(c, 'hallo', d);
    this.sendeAn(c, 'willkommen', {
      rolle: c.rolle, set_id: this.opt.setId, generation: this.opt.generation(), autonomie: this.opt.autonomie(),
    });
  }

  private rpc(c: Client, d: Record<string, unknown>): void {
    const id = d.id as number;
    const m = this.opt.methoden[d.methode as string];
    if (!m) {
      this.fehler(c, id, 'form', `Methode ${String(d.methode)} gibt es in diesem Leitstand noch nicht`);
      return;
    }
    this.opt.empfangen(c, 'rpc', d);
    let r: Record<string, unknown> | Promise<Record<string, unknown>>;
    try {
      r = m((d.parameter ?? {}) as Record<string, unknown>, c);
    } catch (e) {
      this.rpcFehler(c, id, e);
      return;
    }
    if (r instanceof Promise) {
      r.then((ergebnis) => {
        const j = ergebnis.jetzt as { seq?: number } | undefined; // §10: seq des Antwort-Umschlags, wie bei lage
        if (j && typeof j === 'object') j.seq = c.seqAus + 1;
        this.sendeAn(c, 'rpc_antwort', { id, ergebnis });
      }, (e: unknown) => this.rpcFehler(c, id, e));
      return;
    }
    this.sendeAn(c, 'rpc_antwort', { id, ergebnis: r });
  }

  private rpcFehler(c: Client, id: number, e: unknown): void {
    this.fehler(c, id, e instanceof RpcFehler ? e.code : 'form', (e as Error).message);
  }

  schliesse(): Promise<void> {
    for (const c of this.clients) c.ws.close(1001, 'leitstand endet');
    return new Promise((ok) => (this.wss ? this.wss.close(() => ok()) : ok()));
  }
}
