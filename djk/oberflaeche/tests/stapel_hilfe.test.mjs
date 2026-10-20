// Test-Stapel (hilfen/mediathek.mjs, Plan 2026-10-15-d1-s1 Task 1): scheitert der Server-Start an einem belegten Port, endet die
// Attrappe trotzdem (ihr Kern-Port ist danach frei) und die Datei hängt nicht. Vorher blieb die Attrappe als Waise am Leben.
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { stapel, K } from './hilfen/mediathek.mjs';

const udpFrei = (port) => new Promise((ok) => { const s = dgram.createSocket('udp4'); s.once('error', () => ok(false)); s.bind(port, '127.0.0.1', () => s.close(() => ok(true))); });

test('stapel: Abo-Port belegt → starte() wirft EADDRINUSE, die Attrappe wird beendet, ihr Port ist wieder frei', { timeout: 20000 }, async (t) => {
  const halter = dgram.createSocket('udp4');
  await new Promise((ok) => halter.bind(47150 + K, '127.0.0.1', ok));
  t.after(() => new Promise((r) => halter.close(r)));
  await t.test('Start scheitert', async (t2) => { await assert.rejects(stapel(t2), /EADDRINUSE/); });
  assert.equal(await udpFrei(47100 + K), true, 'Kern-Port der Attrappe ist frei: die Attrappe lebt nicht mehr');
});

test('stapel: Negativ-Kontrolle, freier Port → Start gelingt, nach dem Test ist der Kern-Port frei', { timeout: 20000 }, async (t) => {
  await t.test('Start gelingt', async (t2) => { const s = await stapel(t2); assert.equal((await fetch(`${s.url}/konfig`)).status, 200); });
  assert.equal(await udpFrei(47100 + K), true);
});
