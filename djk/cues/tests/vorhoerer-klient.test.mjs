// VorhoererKlient: der Rand-Fall aus docs/architektur/stand/vorhoerer.md B3 — "Loop greift nur, wenn die
// Wiedergabe B von innen erreicht" — muss der Klient selbst abfangen: liegt die geschätzte Position schon auf
// oder hinter B, erst springen, dann Loop setzen. Geprüft ohne echten Vorhörer-Prozess: eigener UDP-Empfänger
// als Attrappe, k.sock wird direkt gebunden (starte() würde die Binärdatei spawnen).
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { dekodiere } from '../osc.ts';
import { VorhoererKlient } from '../vorhoerer-klient.ts';

async function attrappe(t) {
  const empf = dgram.createSocket('udp4');
  await new Promise((r) => empf.bind(0, '127.0.0.1', r));
  const nachrichten = [];
  empf.on('message', (b) => nachrichten.push(dekodiere(b)));
  t.after(() => empf.close());
  const port = empf.address().port;
  const k = new VorhoererKlient({ bin: '/bin/true', ausgang: 'x', port });
  await new Promise((r) => k.sock.bind(0, '127.0.0.1', r));
  t.after(() => k.sock.close());
  return { k, nachrichten, warte: () => new Promise((r) => setTimeout(r, 150)) };
}

test('B3: Loop hinter der aktuellen Position → erst /v/springe(a), dann /v/loop(a,b)', async (t) => {
  const { k, nachrichten, warte } = await attrappe(t);
  k.spielt = true;
  k.letztePosition = { s: 20, frame: 0, empfangen_ms: Date.now(), spielt: true }; // 20 s liegt hinter B = 10
  k.loop(5, 10);
  await warte();
  assert.deepEqual(nachrichten.map((m) => m.adr), ['/v/springe', '/v/loop']);
  assert.ok(Math.abs(nachrichten[0].werte[0] - 5) < 1e-9, 'springt auf A');
  assert.ok(Math.abs(nachrichten[1].werte[0] - 5) < 1e-9 && Math.abs(nachrichten[1].werte[1] - 10) < 1e-9);
});

test('Negativ-Kontrolle: Position vor B → kein Sprung, nur /v/loop', async (t) => {
  const { k, nachrichten, warte } = await attrappe(t);
  k.spielt = true;
  k.letztePosition = { s: 3, frame: 0, empfangen_ms: Date.now(), spielt: true }; // 3 s liegt vor B = 10
  k.loop(5, 10);
  await warte();
  assert.deepEqual(nachrichten.map((m) => m.adr), ['/v/loop']);
});

test('Ohne bekannte Position (noch nicht geladen): kein Sprung, nur /v/loop', async (t) => {
  const { k, nachrichten, warte } = await attrappe(t);
  assert.equal(k.letztePosition, null);
  k.loop(5, 10);
  await warte();
  assert.deepEqual(nachrichten.map((m) => m.adr), ['/v/loop']);
});

test('Position genau auf B → gilt als "dahinter" (springt), Grenzfall aus B3', async (t) => {
  const { k, nachrichten, warte } = await attrappe(t);
  k.spielt = false;
  k.letztePosition = { s: 10, frame: 0, empfangen_ms: Date.now(), spielt: false };
  k.loop(5, 10);
  await warte();
  assert.deepEqual(nachrichten.map((m) => m.adr), ['/v/springe', '/v/loop']);
});
