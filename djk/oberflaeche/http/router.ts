// Router der Oberfläche mit Bereich-Schnittstelle (Plan 2026-10-15-d1-s1, Task 9; Spec D1 2.10, Erhebung u4 „Variante A“ Schritt 3).
// Ein Bereich meldet seine Routen (Methode, Pfad, Schutzart, Handler). Der Router sucht in Melde-Reihenfolge, erster Treffer gewinnt
// (wie die frühere if-Kette); was keine Route trifft, beantwortet server.ts wie zuvor (GET → statische Datei, sonst 405).
// Bereiche bekommen nur den BereichKontext, nie die Oberflaeche selbst (kein Zugriff auf stand, angefasst, vomKern); der Haken ereignis
// bekommt eine tief eingefrorene Kopie der Felder, denn vomKern legt dieselben Felder in stand.* ab und verteilt sie an /strom.
import type http from 'node:http';

export type Methode = 'GET' | 'POST' | '*';
export type Schutz = 'offen' | 'fremdePost';   // fremdePost: bei POST 415 nur_json / 403 fremde_herkunft vor dem Handler (http/transport.ts)
export type Handler = (q: http.IncomingMessage, a: http.ServerResponse, url: URL) => void | Promise<void>;
export interface Route {
  methode: Methode;
  pfad: string | readonly string[] | ((pfad: string) => boolean);
  schutz: Schutz;
  handler: Handler;
  offenErlaubt?: true;   // nur für eine POST-/*-Route, die bewusst ohne fremdePost-Prüfung bleibt (heute keine)
}
// ereignis (Spec D1 2.10): optionaler Haken. Der Server ruft ihn am Ende von vomKern für jedes Kern-Ereignis auf (nach der Zustands-
// führung, vor dem Durchreichen an /strom, auch für Adressen, die nicht durchgereicht werden). So empfängt proj /e/regler und /zustand/arr.
export interface Bereich { name: string; routen(): Route[]; ereignis?(adresse: string, felder: Record<string, unknown>): void }

// Spec D1 2.10: was ein Bereich vom Server braucht. sende vergibt die id aus dem gemeinsamen Zähler der Oberfläche und zählt
// `gesendet` mit; quelle gilt für die laufende Anfrage (x-djk-quelle), außerhalb einer Anfrage andreas (gemessen: auch im Haken ereignis,
// selbst wenn die auslösende Anfrage cypher war). sende wirft, wenn felder eine id tragen, und setzt quelle: quelle(), wenn felder keine
// tragen; eine ausdrücklich mitgegebene quelle bleibt.
export interface BereichKontext {
  sende(adresse: string, felder: Record<string, unknown>): number;
  warteQuittung(id: number, abBeat?: number): Promise<{ status: number; grund: string } | null>;
  quelle(): 'andreas' | 'cypher';
  kiGestoppt(): boolean;
  verteile(ereignis: { a: string; f: unknown }): void;
  log(zeile: Record<string, unknown>): void;
}

const trifft = (r: Route, pfad: string): boolean =>
  typeof r.pfad === 'string' ? r.pfad === pfad : typeof r.pfad === 'function' ? r.pfad(pfad) : r.pfad.includes(pfad);

const tiefEingefroren = <T>(x: T): T => {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x)) tiefEingefroren(v); }
  return x;
};

export class Router {
  private readonly eintraege: { bereich: string; route: Route }[] = [];
  private readonly namen = new Set<string>();
  private readonly haken: { name: string; ereignis: NonNullable<Bereich['ereignis']> }[] = [];
  melde(b: Bereich): void {
    if (this.namen.has(b.name)) throw new Error(`Bereich ${b.name} ist schon gemeldet`);
    const routen = b.routen();
    for (const r of routen) {   // erst prüfen, dann eintragen: eine abgelehnte Meldung hinterlässt nichts
      if (r.methode !== 'GET' && r.schutz === 'offen' && !r.offenErlaubt) {
        throw new Error(`Bereich ${b.name}: Route ${r.methode} ${typeof r.pfad === 'string' ? r.pfad : '(mehrere/muster)'} ist schutz offen; schreibende Wege brauchen fremdePost oder ausdrücklich offenErlaubt: true`);
      }
    }
    this.namen.add(b.name);
    if (b.ereignis) this.haken.push({ name: b.name, ereignis: b.ereignis.bind(b) });
    for (const route of routen) this.eintraege.push({ bereich: b.name, route });
  }
  // Kern-Ereignis an alle Haken in Melde-Reihenfolge; ein werfender Haken hält weder die übrigen noch den Kern auf (Rückruf meldet ihn).
  // Die Kopie entsteht nur, wenn mindestens ein Bereich einen Haken hat (ohne Haken keine Kosten) und wird von allen Haken geteilt.
  ereignis(adresse: string, felder: Record<string, unknown>, fehler?: (bereich: string, e: Error) => void): void {
    if (this.haken.length === 0) return;
    const kopie = tiefEingefroren(structuredClone(felder));
    for (const h of this.haken) {
      try { h.ereignis(adresse, kopie); } catch (e) { fehler?.(h.name, e instanceof Error ? e : new Error(String(e))); }
    }
  }
  finde(methode: string, pfad: string): Route | null {
    for (const { route } of this.eintraege) if ((route.methode === '*' || route.methode === methode) && trifft(route, pfad)) return route;
    return null;
  }
  liste(): { bereich: string; methode: Methode; pfad: string; schutz: Schutz }[] {
    return this.eintraege.map(({ bereich, route: r }) => ({ bereich, methode: r.methode, schutz: r.schutz,
      pfad: typeof r.pfad === 'string' ? r.pfad : typeof r.pfad === 'function' ? '(muster)' : r.pfad.join('|') }));
  }
}
