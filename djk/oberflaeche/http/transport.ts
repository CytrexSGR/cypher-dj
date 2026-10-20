// HTTP-Bausteine der Oberfläche (Plan 2026-10-15-d1-s1, Task 8). Wortgleich aus server.ts herausgezogen, kein neues Verhalten.
import type http from 'node:http';
import { grundText } from './gruende.ts';

// Plan-Review M3: jede Webseite im Browser kann an 127.0.0.1 POSTen. Nur json (erzwingt beim Browser einen Preflight, den
// dieser Server nicht beantwortet → 415 sonst) und nur ohne Origin oder mit der eigenen (→ 403 sonst). Rangfolge: erst Content-Type.
export function fremdePost(q: http.IncomingMessage, port: number): 403 | 415 | null {
  if (!String(q.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return 415;
  const herkunft = q.headers.origin;   // Review F2: die Seite darf auch unter localhost geöffnet sein
  if (herkunft !== undefined && herkunft !== `http://127.0.0.1:${port}` && herkunft !== `http://localhost:${port}`) return 403;
  return null;
}

export function json(a: http.ServerResponse, code: number, daten: unknown): void {
  a.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  a.end(JSON.stringify(daten));
}

// true: abgewiesen und beantwortet (415 nur_json bzw. 403 fremde_herkunft); false: weiter im Handler. Spec 6.34: mit englischem text.
export function postAbgewiesen(q: http.IncomingMessage, a: http.ServerResponse, port: number): boolean {
  const abweisung = fremdePost(q, port);
  if (abweisung === null) return false;
  const grund = { fehler: abweisung === 415 ? 'nur_json' : 'fremde_herkunft' };
  json(a, abweisung, { ...grund, text: grundText(grund.fehler) });
  return true;
}

export async function koerper(q: http.IncomingMessage): Promise<Record<string, unknown>> {
  let s = '';
  for await (const teil of q) { s += teil; if (s.length > 32768) throw new Error('zu groß'); }
  const j = JSON.parse(s || '{}') as unknown;
  if (typeof j !== 'object' || j === null || Array.isArray(j)) throw new Error('kein Objekt');
  return j as Record<string, unknown>;
}

// Plan Hand D1: Kopf x-djk-quelle: cypher → Quelle cypher, sonst andreas
export function quelleAusKopf(q: http.IncomingMessage): 'cypher' | 'andreas' {
  return q.headers['x-djk-quelle'] === 'cypher' ? 'cypher' : 'andreas';
}
