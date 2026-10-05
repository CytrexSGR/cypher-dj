import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Hub, type Client, type Umschlag } from '../src/hub.ts';
import { pruefer, SCHEMA_WS } from '../src/vertrag.ts';
import { WsClient } from '../src/ws_client.ts';
import { freierTcpPort, warte } from './hilfen/prozess.ts';

let hub: Hub;
let port: number;
const empfangen: [string, string, Record<string, unknown>][] = [];
const gesendet: Umschlag[] = [];
const ZEIT = { sample: 1800000, beat: 80, takt: 21, phrase: 3 };

before(async () => {
  port = await freierTcpPort();
  hub = new Hub({
    port, setId: '2026-09-24_2100', generation: () => 0, autonomie: () => 1, zeit: () => ZEIT,
    methoden: { lage: () => ({ jetzt: { takt: 21, schlag: 1, beat: 80, seq: 2 } }) },
    empfangen: (c: Client, typ, daten) => empfangen.push([c.rolle ?? '-', typ, daten]),
    gesendet: (_c, n) => gesendet.push(n),
  });
  await hub.starte();
});
after(() => hub.schliesse());

test('hallo → willkommen mit Rolle, set_id, generation, autonomie; seq beginnt bei 1', async () => {
  const c = await WsClient.verbinde(port);
  c.rolle = 'spieler';
  c.sende('hallo', { rolle: 'spieler', name: 'sonnet', protokoll: 1 });
  const w = await c.warteAuf((n) => n.typ === 'willkommen');
  assert.deepEqual(w.daten, { rolle: 'spieler', set_id: '2026-09-24_2100', generation: 0, autonomie: 1 });
  assert.equal(w.seq, 1);
  assert.equal(w.von, 'leitstand');
  assert.deepEqual(w.zeit, ZEIT);
  c.schliesse();
});

test('Fehlerfall: vor hallo, kein JSON, unbekannte Rolle, Schema verletzt, falsches Protokoll', async () => {
  const c = await WsClient.verbinde(port);
  c.rolle = 'ansage';
  c.sende('zuruf', { text: 'x' });
  assert.equal((await c.warteAuf((n) => n.typ === 'rpc_fehler')).daten.code, 'form');
  c.sendeRoh('{kaputt');
  assert.equal((await c.warteAuf((n) => n.daten.text === 'kein JSON')).daten.code, 'form');
  c.sende('hallo', { rolle: 'dj', name: 'x', protokoll: 1 });
  assert.match(String((await c.warteAuf((n) => String(n.daten.text).includes('/daten/rolle'))).daten.text), /Schema/);
  c.sendeRoh(JSON.stringify({ v: 1, seq: 9, von: 'ansage', typ: 'hallo', daten: { rolle: 'ansage', name: 'x', protokoll: 1 } }));
  assert.match(String((await c.warteAuf((n) => String(n.daten.text).includes('zeit'))).daten.text), /Schema/);
  c.sende('hallo', { rolle: 'mcp', name: 'x', protokoll: 2 });
  assert.equal((await c.warteAuf((n) => n.daten.code === 'protokoll')).typ, 'rpc_fehler');
  await warte(100);
  assert.equal(c.geschlossen, 1002);
});

test('Fehlerfall: Rolle ansage kann nicht schreiben (rpc → rpc_fehler); Negativ-Kontrolle mcp → rpc_antwort', async () => {
  const a = await WsClient.angemeldet(port, 'ansage');
  a.sende('rpc', { id: 17, methode: 'lage', parameter: {} });
  const f = await a.warteAuf((n) => n.typ === 'rpc_fehler');
  assert.deepEqual([f.daten.id, f.daten.code], [17, 'form']);
  assert.match(String(f.daten.text), /Rolle ansage darf rpc nicht senden/);
  const m = await WsClient.angemeldet(port, 'mcp');
  m.sende('rpc', { id: 18, methode: 'lage', parameter: {} });
  const r = await m.warteAuf((n) => n.typ === 'rpc_antwort');
  assert.deepEqual(r.daten, { id: 18, ergebnis: { jetzt: { takt: 21, schlag: 1, beat: 80, seq: 2 } } });
  m.sende('rpc', { id: 19, methode: 'waehle', parameter: { material_id: '3fa1c09b2e7d4410', spielart: 'sicher', start_takt: 33, hoerschein: 'h1' } });
  assert.match(String((await m.warteAuf((n) => n.typ === 'rpc_fehler')).daten.text), /Methode waehle gibt es/);
  a.schliesse(); m.schliesse();
});

test('zuruf von ansage ist erlaubt (§9.4) und kommt beim Leitstand an', async () => {
  const a = await WsClient.angemeldet(port, 'ansage');
  a.sende('zuruf', { text: 'mehr Druck im Bass' });
  await warte(100);
  assert.ok(empfangen.some(([r, t, d]) => r === 'ansage' && t === 'zuruf' && d.text === 'mehr Druck im Bass'));
  assert.equal(a.typen().includes('rpc_fehler'), false);
  a.schliesse();
});

test('sende an Rollen: nur angemeldete Empfänger, seq je Verbindung lückenlos, jede Nachricht schema-gültig', async () => {
  const s = await WsClient.angemeldet(port, 'spieler');
  const a = await WsClient.angemeldet(port, 'ansage');
  const nackt = await WsClient.verbinde(port); // nicht angemeldet
  for (let i = 0; i < 50; i++) hub.sende('ereignis', { art: 'luecke', takt: 21, sample: i, frames: 256, zyklen: 1 }, 'alle');
  hub.sende('ansage', { text: 'T 21: x', art: 'info' }, ['ansage']);
  await warte(200);
  const seqS = s.empfangen.map((e) => e.n.seq);
  assert.deepEqual(seqS, Array.from({ length: seqS.length }, (_, i) => i + 1));
  assert.equal(s.typen().filter((t) => t === 'ereignis').length, 50);
  assert.equal(s.typen().includes('ansage'), false);
  assert.equal(a.typen().filter((t) => t === 'ansage').length, 1);
  assert.equal(nackt.empfangen.length, 0);
  const v = pruefer(SCHEMA_WS);
  assert.deepEqual(gesendet.map((n) => v(n)).filter((p) => !p.ok), []);
  s.schliesse(); a.schliesse(); nackt.schliesse();
});
