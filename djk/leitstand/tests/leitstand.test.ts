// Durchstich gegen den Taktgeber (480 BPM, ein Takt = 0,5 s): Kern-Meldung → Leitstand → WS-Client und Journal.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { baue } from '../src/adressen.ts';
import { pruefer, SCHEMA_JOURNAL, SCHEMA_MCP, SCHEMA_WS } from '../src/vertrag.ts';
import { WsClient } from '../src/ws_client.ts';
import { beende, BERICHT, freierTcpPort, freierUdpPort, starte, warte, type Kind } from './hilfen/prozess.ts';

const SET = '2026-09-23_0000';
let tmp: string;
let tg: Kind;
let ls: Kind;
let ws: number;
let aboL: number;

async function starteLeitstand(konfigText: string, kern: number): Promise<Kind> {
  const konfig = path.join(tmp, 'leitstand.toml');
  fs.writeFileSync(konfig, konfigText);
  return starte('src/leitstand.ts', ['--konfig', konfig, '--kern-port', String(kern), '--set-id', SET], 'leitstand:');
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-durchstich-'));
  const kern = await freierUdpPort();
  [ws, aboL] = [await freierTcpPort(), await freierUdpPort()];
  tg = await starte('tests/hilfen/taktgeber.ts', ['--port', String(kern), '--bpm', '480'], 'taktgeber:');
  ls = await starteLeitstand(`version = 1\nws_port = ${ws}\nabo_port = ${aboL}\nsets = "${tmp}/sets"\n`, kern);
});
after(async () => { await beende(ls); await beende(tg); });

const journal = () => fs.readFileSync(path.join(tmp, 'sets', SET, 'journal.jsonl'), 'utf8').trim().split('\n')
  .map((l) => JSON.parse(l));

test('je Takt eine takt-Nachricht, seq lückenlos, Kern-Ereignisse als ereignis und ansage, alles schema-gültig', { timeout: 20000 }, async () => {
  const ps = await WsClient.angemeldet(ws, 'pruefstand', 'test');
  const an = await WsClient.angemeldet(ws, 'ansage', 'test-ansage');
  await ps.warteAuf((n) => n.typ === 'takt');
  await warte(3000); // 6 Takte
  // Kern-Ereignisse von Hand an den Abo-Port: Lücke und Invariante
  const [abPs, abAn] = [ps.empfangen.length, an.empfangen.length];
  const u = dgram.createSocket('udp4');
  const s1 = baue('/e/luecke', { sample: 123456, frames: 256, zyklen: 1 });
  const s2 = baue('/e/invariante', { art: 'sub_doppelt', plan: 'p17', teil: 2, sample: 123456, beat: 10.5 });
  const s3 = baue('/e/neustart', { generation: 1, sample: 123456 });
  for (const s of [s1, s2, s3]) await new Promise((ok) => u.send(s, aboL, '127.0.0.1', ok));
  u.close();
  const e = await ps.warteAuf((n) => n.typ === 'ereignis' && n.daten.art === 'invariante', 3000, abPs);
  assert.equal(e.daten.invariante, 'sub_doppelt');
  await an.warteAuf((n) => n.typ === 'ansage' && String(n.daten.text).includes('Lücke im Kern'), 3000, abAn);
  await an.warteAuf((n) => n.typ === 'ansage' && String(n.daten.text).includes('Kern neu gestartet, Generation 1'), 3000, abAn);
  await ps.warteAuf((n) => n.typ === 'ereignis' && n.daten.art === 'neustart' && n.daten.generation === 1, 3000, abPs);
  await warte(1100); // die Ereignisse stehen im nächsten takt unter ereignisse_seit
  const takte = ps.empfangen.filter((x) => x.n.typ === 'takt').map((x) => x.n.daten.takt as number);
  assert.ok(takte.length >= 8, `nur ${takte.length} takt`);
  assert.deepEqual(takte, Array.from({ length: takte.length }, (_, i) => takte[0] + i)); // je Takt genau einer
  const seq = ps.empfangen.map((x) => x.n.seq);
  assert.deepEqual(seq, Array.from({ length: seq.length }, (_, i) => i + 1));
  // jedes Ereignis steht genau einmal unter ereignisse_seit eines takt nach dem Senden (welcher takt, hängt am Zeitpunkt)
  const nachher = ps.empfangen.slice(abPs).filter((x) => x.n.typ === 'takt').map((x) => x.n);
  const seit = nachher.flatMap((n) => (n.daten.ereignisse_seit as { art: string }[]).map((x) => x.art));
  assert.deepEqual(seit.sort(), ['invariante', 'luecke', 'neustart']);
  assert.equal(an.empfangen.some((x) => x.n.typ === 'takt'), true); // takt geht an alle
  assert.equal(ps.empfangen.some((x) => x.n.typ === 'ansage'), false); // ansage nur an ansage und anzeige (§9.3)
  const v = pruefer(SCHEMA_WS);
  const falsch = [...ps.empfangen, ...an.empfangen].map((x) => v(x.n)).filter((p) => !p.ok);
  assert.deepEqual(falsch, []);
  // Journal: set_start zuerst; /takt-Zeilen für jeden takt, den der Client bekam; die Ereignisse stehen drin
  const j = journal();
  assert.equal(j[0].typ, 'set_start');
  const jt = new Set(j.filter((z) => z.typ === '/takt').map((z) => z.daten.takt));
  assert.deepEqual(takte.filter((t) => !jt.has(t)), []);
  assert.equal(j.filter((z) => z.typ === '/e/luecke').length, 1);
  const vj = pruefer(SCHEMA_JOURNAL);
  assert.deepEqual(j.map((z) => vj(z)).filter((p) => !p.ok), []);
  ps.schliesse(); an.schliesse();
});

test('rpc lage (§10): jetzt und Lage des letzten takt, gültig gegen mcp.schema.json mit_jetzt; Ereignisse nur einmal', { timeout: 10000 }, async () => {
  const m = await WsClient.angemeldet(ws, 'mcp', 'test-mcp');
  await m.warteAuf((n) => n.typ === 'takt');
  m.sende('rpc', { id: 41, methode: 'lage', parameter: {} });
  const r = await m.warteAuf((n) => n.typ === 'rpc_antwort' && n.daten.id === 41);
  const erg = r.daten.ergebnis as { jetzt: { takt: number; beat: number }; lage: { takt: number }; ereignisse: unknown[] };
  const p = pruefer(SCHEMA_MCP, '#/$defs/mit_jetzt')(erg);
  assert.equal(p.ok, true, p.fehler);
  assert.ok(erg.jetzt.takt >= erg.lage.takt && erg.jetzt.takt <= erg.lage.takt + 1, JSON.stringify(erg.jetzt));
  m.sende('rpc', { id: 42, methode: 'lage', parameter: {} });
  const r2 = await m.warteAuf((n) => n.typ === 'rpc_antwort' && n.daten.id === 42);
  assert.deepEqual((r2.daten.ergebnis as { ereignisse: unknown[] }).ereignisse, []); // seit dem letzten Aufruf nichts
  m.schliesse();
});

test('mit Analyse: takt trägt den Bericht des vorigen Takts; Bericht fehlt → bericht_vorher null', { timeout: 20000 }, async () => {
  const an = await WsClient.angemeldet(ws, 'analyse', 'test-analyse');
  let n = 0;
  an.bei = (e) => {
    if (e.n.typ !== 'takt') return;
    n++;
    const t = e.n.daten.takt as number;
    if (n % 2 === 0) an.sende('takt_bericht', { ...BERICHT, takt: t, phrase: e.n.daten.phrase });
  };
  await warte(4000);
  const takte = an.empfangen.filter((x) => x.n.typ === 'takt').map((x) => x.n.daten);
  const mit = takte.filter((z) => z.bericht_vorher !== null);
  const ohne = takte.filter((z) => z.bericht_vorher === null);
  assert.ok(mit.length >= 2 && ohne.length >= 2, `mit ${mit.length}, ohne ${ohne.length}`);
  for (const z of mit) assert.equal((z.bericht_vorher as { takt: number }).takt, (z.takt as number) - 1);
  assert.equal(an.typen().includes('rpc_fehler'), false); // die Berichte waren schema-gültig
  an.schliesse();
});

test('SIGTERM: Leitstand meldet sich beim Kern ab, letzte Journalzeile /k/tschuess', { timeout: 10000 }, async () => {
  await beende(ls, 'SIGTERM');
  assert.equal(ls.p.exitCode, 0);
  assert.equal(journal().at(-1).typ, '/k/tschuess');
});

test('Fehlerfall: unbekannter Schlüssel in der Konfiguration → Startfehler, Rückgabewert 2, WS-Port bleibt frei', { timeout: 10000 }, async () => {
  const kern = await freierUdpPort();
  await assert.rejects(starteLeitstand(`version = 1\nws_port = ${ws}\nws_prot = 1\n`, kern), /endete mit 2: .*ws_prot/s);
  const frei = await new Promise<boolean>((ok) => {
    const s = net.createServer();
    s.once('error', () => ok(false));
    s.listen(ws, '127.0.0.1', () => s.close(() => ok(true)));
  });
  assert.equal(frei, true);
});
