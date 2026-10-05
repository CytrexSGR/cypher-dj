// Befund 2 (adversariale Prüfung): scheitert ein Kind beim Start des Prüfstapels, bleibt nichts liegen: kein
// /dev/shm/djk60m-<i>-XXXXXX, kein laufendes Kind (Ports wieder frei), kein offenes Relais. Instanz f (Z2, Ports 53xxx),
// damit der Test weder die Server-Tests (h) noch die Abnahme (g) stört. Kein Ton, kein Fenster.
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { starteStapel } from '../pruef/stapel.mjs';

const I = 'f';
const K = 1000 * (I.charCodeAt(0) - 96);
const reste = () => fs.readdirSync('/dev/shm').filter((n) => n.startsWith(`djk60m-${I}-`));
const udpFrei = (port) => new Promise((ok) => { const s = dgram.createSocket('udp4'); s.once('error', () => ok(false)); s.bind(port, '127.0.0.1', () => s.close(() => ok(true))); });
const tcpFrei = (port) => new Promise((ok) => { const s = net.createServer(); s.once('error', () => ok(false)); s.listen(port, '127.0.0.1', () => s.close(() => ok(true))); });

async function portsFrei() {
  return { kern: await udpFrei(47100 + K), relais: await udpFrei(47199 + K), leitstand: await tcpFrei(47200 + K), seite: await tcpFrei(47300 + K) };
}

test('Befund 2: Seiten-Server scheitert beim Start → Fehler, /dev/shm-Ordner weg, Kinder beendet, Ports frei', async (t) => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'djk60m-stapel-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  assert.deepEqual(reste(), [], 'vorher keine Reste dieser Instanz');
  // CYPHERDJ_INSTANZ=z nur für den Seiten-Server: versatz() wirft, der Server endet mit 2 (Attrappe und Leitstand laufen dann schon)
  await assert.rejects(starteStapel(ordner, I, { CYPHERDJ_INSTANZ: 'z' }), /server endete mit 2/);
  assert.deepEqual(reste(), [], 'kein /dev/shm-Ordner bleibt liegen');
  assert.deepEqual(await portsFrei(), { kern: true, relais: true, leitstand: true, seite: true }, 'Kinder und Relais beendet');
});

test('Befund 2, Gegenprobe: gelingender Start und Stopp hinterlassen ebenfalls nichts', async (t) => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'djk60m-stapel-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const s = await starteStapel(ordner, I);
  assert.equal(reste().length, 1, 'während des Laufs liegt genau ein Arbeitsbestand');
  assert.equal((await fetch(s.url + 'bestand')).status, 200);
  await s.stoppe();
  assert.deepEqual(reste(), []);
  assert.deepEqual(await portsFrei(), { kern: true, relais: true, leitstand: true, seite: true });
});
