// Schlanke, eigenständige WebSocket-Anbindung an den Leitstand-Hub (SCHNITTSTELLEN §9), fürs Kommandozeilen-
// Werkzeug djk-spiel. Angelehnt an das Muster von djk/leitstand/src/ws_client.ts (WsClient), aber eigenständiger
// Code: djk/leitstand/ wird nur gelesen, nie importiert oder verändert (Auftrag spieler-cli). Nutzt Node 22s
// eingebautes globales WebSocket (kein npm-Paket nötig, geprüft gegen den echten Hub).
export interface Zeitpunkt { sample: number; beat: number; takt: number; phrase: number }

export interface Umschlag {
  v: 1;
  seq: number;
  von: string;
  typ: string;
  zeit: Zeitpunkt;
  daten: Record<string, unknown>;
}

interface Warteeintrag {
  pred: (n: Umschlag) => boolean;
  ok: (n: Umschlag) => void;
  fehler: (e: Error) => void;
  zeitgeber: ReturnType<typeof setTimeout>;
}

export class Spielerverbindung {
  private readonly ws: WebSocket;
  private readonly empfangen: Umschlag[] = [];
  private readonly wartend: Warteeintrag[] = [];
  private seq = 0;
  private rpcId = 0;
  private zeit: Zeitpunkt = { sample: 0, beat: 0, takt: 1, phrase: 1 }; // Vorgabe wie WsClient, bis die erste Nachricht kommt
  rolle = 'mcp';

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev: MessageEvent) => {
      let n: Umschlag;
      try { n = JSON.parse(String(ev.data)) as Umschlag; } catch { return; }
      if (n.zeit) this.zeit = n.zeit;
      this.empfangen.push(n);
      for (let i = this.wartend.length - 1; i >= 0; i--) {
        if (this.wartend[i].pred(n)) {
          const w = this.wartend.splice(i, 1)[0];
          clearTimeout(w.zeitgeber);
          w.ok(n);
        }
      }
    };
  }

  static verbinde(port: number): Promise<Spielerverbindung> {
    return new Promise((ok, fehler) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      ws.onopen = () => ok(new Spielerverbindung(ws));
      ws.onerror = () => fehler(new Error(`Verbindung zu ws://127.0.0.1:${port}/ fehlgeschlagen`));
    });
  }

  // Meldet sich mit Rolle an (§9.2: hallo -> willkommen). Rolle laut Auftrag "mcp": der gebaute Leitstand lässt nur
  // mcp und pruefstand rpc senden (djk/leitstand/src/hub.ts DARF_SENDEN, Zeile ~14-21); Rolle "spieler" darf laut
  // dieser Tabelle nur zug_status senden, kein rpc. Siehe docs/architektur/stand/spieler-cli.md Abschnitt "Rollen-Befund".
  static async angemeldet(port: number, rolle: string, name: string): Promise<Spielerverbindung> {
    const c = await Spielerverbindung.verbinde(port);
    c.rolle = rolle;
    c.sende('hallo', { rolle, name, protokoll: 1 });
    await c.warteAuf((n) => n.typ === 'willkommen');
    return c;
  }

  sende(typ: string, daten: Record<string, unknown>): void {
    const n: Umschlag = { v: 1, seq: ++this.seq, von: this.rolle, typ, zeit: this.zeit, daten };
    this.ws.send(JSON.stringify(n));
  }

  // Wartet auf die erste bereits empfangene ODER künftige Nachricht, die pred erfüllt.
  warteAuf(pred: (n: Umschlag) => boolean, ms = 10000): Promise<Umschlag> {
    const treffer = this.empfangen.find(pred);
    if (treffer) return Promise.resolve(treffer);
    return new Promise((ok, fehler) => {
      const eintrag: Warteeintrag = {
        pred, ok, fehler,
        zeitgeber: setTimeout(() => {
          const i = this.wartend.indexOf(eintrag);
          if (i >= 0) this.wartend.splice(i, 1);
          fehler(new Error(`nicht empfangen in ${ms} ms`));
        }, ms),
      };
      this.wartend.push(eintrag);
    });
  }

  // Schickt eine rpc-Nachricht (§9.4) und wartet auf rpc_antwort ODER rpc_fehler mit passender id (§9.3).
  async rpc(methode: string, parameter: Record<string, unknown>, ms = 10000): Promise<Umschlag> {
    const id = ++this.rpcId;
    this.sende('rpc', { id, methode, parameter });
    return this.warteAuf((n) => (n.typ === 'rpc_antwort' || n.typ === 'rpc_fehler') && (n.daten as { id?: unknown }).id === id, ms);
  }

  schliesse(): void { this.ws.close(); }
}
