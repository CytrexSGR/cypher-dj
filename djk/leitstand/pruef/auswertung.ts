// Auswertung der Abnahme (Scheibe 12): liest das Ergebnis des Prüf-Clients und das Journal, prüft jeden
// Abnahmepunkt am Ziel und gibt je Punkt eine Zeile mit Zahl aus. Rückgabewert 0 nur, wenn alle bestehen.
// Aufruf: node pruef/auswertung.ts --ergebnis ergebnis.json --journal <sets>/<set_id>/journal.jsonl [--bericht b.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { pruefer, SCHEMA_JOURNAL, SCHEMA_WS } from '../src/vertrag.ts';
import type { Empfangen } from '../src/ws_client.ts';

export interface Punkt { name: string; ok: boolean; wert: string }

export interface Ergebnis {
  erster_takt: number; letzter_takt: number; haupt_ende: number;
  takt_abo: { takt: number; sample: number; t: number; mono_anfang: number | null }[];
  q_abo: { id: number; status: number; t: number }[];
  vermittelt: { t: number; adresse: string }[];
  stopp: { t_stopp: number; t_weiter: number; uhr_letzte: number } | null;
  uhr_versatz_ms: { n: number; min: number; p50: number; max: number };
  ws_pruefstand: Empfangen[];
  ws_ansage: Empfangen[];
}

export function perzentil(werte: number[], p: number): number {
  const s = [...werte].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : String(x));

export function werte(e: Ergebnis, journal: Record<string, unknown>[], schemaPruefung = true): Punkt[] {
  const punkte: Punkt[] = [];
  const P = (name: string, ok: boolean, wert: string) => punkte.push({ name, ok, wert });
  const fenster = (t: number) => t >= e.erster_takt && t <= e.letzter_takt;
  const soll = e.letzter_takt - e.erster_takt + 1;

  // A0 Instrument: Prüf-Client und Kern lesen dieselbe Uhr (Empfang einer /uhr nie vor ihrem mono_ns)
  const u = e.uhr_versatz_ms;
  P('A0 Instrument: /uhr-Empfang minus mono_ns', u.n > 0 && u.min >= 0 && u.p50 < 20,
    `n ${u.n}, min ${f1(u.min)} ms, p50 ${f1(u.p50)} ms, max ${f1(u.max)} ms`);

  // A1 je Takt genau eine takt-Nachricht
  const abo = e.takt_abo.filter((x) => fenster(x.takt));
  const ws = e.ws_pruefstand.filter((x) => x.n.typ === 'takt' && fenster(x.n.daten.takt as number));
  const wsTakte = ws.map((x) => x.n.daten.takt as number);
  const doppelt = wsTakte.length - new Set(wsTakte).size;
  P('A1 takt je Takt', abo.length === soll && ws.length === soll && doppelt === 0,
    `Kern-/takt ${abo.length}, WS-takt ${ws.length}, soll ${soll}, doppelt ${doppelt}`);

  // A2 Verzug nach Taktanfang (mono_ns), p99 ≤ 150 ms. Negativ bis rund −5,3 ms ist echt: der Kern schickt /takt im
  // Zyklus, der den Taktanfang enthält, und mono_ns ist der Zyklusbeginn; ein Taktanfang mitten im Block liegt also bis
  // zu einem Block nach dem Senden. Unter −8 ms (Block plus 2,7 ms) stimmt der Bezug nicht: dann ist A2 rot.
  const verzug: number[] = [];
  for (const x of ws) {
    const k = abo.find((y) => y.takt === x.n.daten.takt);
    if (k && k.mono_anfang !== null) verzug.push((x.t - k.mono_anfang) / 1e6);
  }
  const p99 = verzug.length ? perzentil(verzug, 99) : Infinity;
  const min = verzug.length ? Math.min(...verzug) : -Infinity;
  P('A2 Verzug p99 ≤ 150 ms', verzug.length === soll && p99 <= 150 && min >= -8,
    `n ${verzug.length}, min ${f1(min)} ms, p50 ${f1(perzentil(verzug, 50))} ms, p99 ${f1(p99)} ms, ` +
    `max ${f1(Math.max(...verzug))} ms`);

  // A3 seq lückenlos (alle Nachrichten an beide Clients)
  const luecken = (l: Empfangen[]) => l.filter((x, i) => x.n.seq !== i + 1).length;
  const lp = luecken(e.ws_pruefstand);
  const la = luecken(e.ws_ansage);
  P('A3 seq lückenlos', lp === 0 && la === 0 && e.ws_pruefstand.length > 0,
    `pruefstand ${e.ws_pruefstand.length} Nachrichten, ${lp} Abweichungen; ansage ${e.ws_ansage.length}, ${la}`);

  // A4 Journal: jede empfangene /q und jeder /takt im Fenster genau einmal (am Ziel gezählt)
  const jt = journal.filter((z) => z.typ === '/takt' && fenster((z.daten as Record<string, number>).takt));
  const schluessel = (d: Record<string, unknown>) => `${d.id}/${d.status}`;
  const qEmpf = e.q_abo.map((q) => schluessel(q as unknown as Record<string, unknown>));
  const qSet = new Set(qEmpf);
  const jq = journal.filter((z) => z.typ === '/q' && qSet.has(schluessel(z.daten as Record<string, unknown>)))
    .map((z) => schluessel(z.daten as Record<string, unknown>));
  const qGleich = jq.length === qEmpf.length && [...qSet].every((k) => jq.includes(k));
  P('A4 Journal /takt und /q', jt.length === abo.length && qGleich && qEmpf.length > 0,
    `Journal /takt ${jt.length} gegen empfangen ${abo.length}; Journal /q ${jq.length} gegen empfangen ${qEmpf.length}`);

  // A5 Fehlerfall: Kern angehalten → erstes hallo nach 100 ms, dann alle 50 ms, danach willkommen
  if (e.stopp) {
    const s = e.stopp;
    const hallo = e.vermittelt.filter((v) => v.adresse === '/k/hallo').map((v) => v.t);
    // uhr_letzte = mono_ns der letzten /uhr vor dem Anhalten (Kern-Zeit). Vor 95 ms danach darf kein hallo kommen (der
    // Prüf-Client hält 200 ms nach einem Herzschlag an, ein Herzschlag fällt also nicht in dieses Fenster)
    const zuFrueh = hallo.filter((t) => t > s.uhr_letzte && t < s.uhr_letzte + 95e6).length;
    const schnell = hallo.filter((t) => t >= s.uhr_letzte + 95e6 && t < s.t_weiter);
    const erst = schnell.length ? (schnell[0] - s.uhr_letzte) / 1e6 : Infinity;
    const abst = schnell.slice(1).map((t, i) => (t - schnell[i]) / 1e6);
    // „alle 50 ms“ als Raster ab dem ersten hallo, ±15 ms: der Wächter hält das Raster, ein verspäteter Tick verschiebt
    // nur sein eigenes hallo (Abstände dann etwa 65 und 35 ms); eine Abstandsgrenze 40 bis 60 wäre dort falsch rot
    const raster = schnell.map((t) => (t - schnell[0]) / 1e6).map((x, k) => Math.abs(x - 50 * k));
    const dauer = (s.t_weiter - s.uhr_letzte) / 1e6;
    const erwartet = Number.isFinite(erst) ? 1 + Math.floor((dauer - erst) / 50) : 0; // ab dem ersten hallo alle 50 ms
    const willkommen = journal.find((z) => z.typ === '/k/willkommen' && (z.mono_ns as number) > s.t_weiter);
    const da = journal.find((z) => z.typ === 'kern_da' && (z.mono_ns as number) > s.t_weiter);
    P('A5 Kern weg: hallo nach 100 ms, dann alle 50 ms, danach willkommen',
      zuFrueh === 0 && erst >= 100 && erst <= 120 && abst.length > 0 && raster.every((x) => x <= 15) &&
      Math.abs(schnell.length - erwartet) <= 1 && !!willkommen && !!da,
      `${zuFrueh} zu früh, erstes ${f1(erst)} ms, ${schnell.length} hallo (erwartet ${erwartet}), Abstände ` +
      `${f1(Math.min(...abst))} bis ` +
      `${f1(Math.max(...abst))} ms, Rasterfehler max ${f1(Math.max(...raster))} ms, willkommen ` +
      (willkommen ? `${f1(((willkommen.mono_ns as number) - s.t_weiter) / 1e6)} ms nach SIGCONT` : 'fehlt'));
  } else {
    P('A5 Kern weg', false, 'kein Stopp gefahren (--kern-pid fehlt)');
  }

  // A6 Negativ-Kontrolle: laufender Kern → Herzschlag spätestens alle 2 s, keine zusätzlichen hallo
  const beginn = e.takt_abo.find((x) => x.takt === e.erster_takt)?.t ?? 0;
  const hH = e.vermittelt.filter((v) => v.adresse === '/k/hallo' && v.t >= beginn && v.t <= e.haupt_ende).map((v) => v.t);
  const aH = hH.slice(1).map((t, i) => (t - hH[i]) / 1e6);
  const sek = (e.haupt_ende - beginn) / 1e9;
  P('A6 Herzschlag ≤ 2 s, keine zusätzlichen hallo', aH.length > 0 && aH.every((x) => x >= 1400 && x <= 2000),
    `${hH.length} hallo in ${f1(sek)} s, Abstand ${f1(Math.min(...aH))} bis ${f1(Math.max(...aH))} ms`);

  // A7 Schema aus 09: jede Nachricht an beide Clients, jede Journalzeile
  if (schemaPruefung) {
    const vw = pruefer(SCHEMA_WS);
    const vj = pruefer(SCHEMA_JOURNAL);
    const alle = [...e.ws_pruefstand, ...e.ws_ansage].map((x) => x.n);
    const falsch = alle.map((n) => ({ n, p: vw(n) })).filter((x) => !x.p.ok);
    const jFalsch = journal.map((z) => ({ z, p: vj(z) })).filter((x) => !x.p.ok);
    P('A7 Schema aus 09', falsch.length === 0 && jFalsch.length === 0 && alle.length > 0,
      `${alle.length} WS-Nachrichten, ${falsch.length} ungültig; ${journal.length} Journalzeilen, ${jFalsch.length} ungültig` +
      (falsch.length ? `; erste: ${falsch[0].n.typ} ${falsch[0].p.fehler}` : '') +
      (jFalsch.length ? `; erste Zeile: ${String(jFalsch[0].z.typ)} ${jFalsch[0].p.fehler}` : ''));
  }

  // A8 Rolle ansage kann nicht schreiben; Gegenprobe pruefstand bekommt rpc_antwort
  const f = e.ws_ansage.find((x) => x.n.typ === 'rpc_fehler' && x.n.daten.id === 1);
  const r = e.ws_pruefstand.find((x) => x.n.typ === 'rpc_antwort' && x.n.daten.id === 2);
  P('A8 ansage kann nicht schreiben', !!f && f.n.daten.code === 'form' && !!r,
    `ansage: ${f ? `rpc_fehler ${f.n.daten.code}` : 'kein rpc_fehler'}; pruefstand: ${r ? 'rpc_antwort' : 'keine rpc_antwort'}`);

  // A9 Journal-Form: set_start zuerst
  P('A9 set_start ist die erste Journalzeile', journal[0]?.typ === 'set_start', `erste Zeile: ${String(journal[0]?.typ)}`);
  return punkte;
}

function main(): void {
  const { values } = parseArgs({ options: { ergebnis: { type: 'string' }, journal: { type: 'string' }, bericht: { type: 'string' } } });
  const e = JSON.parse(fs.readFileSync(String(values.ergebnis), 'utf8')) as Ergebnis;
  const j = fs.readFileSync(String(values.journal), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const p = werte(e, j);
  for (const x of p) process.stdout.write(`${x.ok ? 'OK  ' : 'FEHL'} ${x.name}: ${x.wert}\n`);
  if (values.bericht) fs.writeFileSync(values.bericht, JSON.stringify(p, null, 1));
  process.exit(p.every((x) => x.ok) ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
