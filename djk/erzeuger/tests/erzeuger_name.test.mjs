// Studio S1 T2: drei Erzeuger-Prozesse brauchen drei Namen, sonst verdrängen sie einander beim Kern (netz.cpp:146,
// Abonnenten nach Name). --name setzt den Hallo-Namen; Strom und Kanal kommen wie bisher aus --strom/--kanal.
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kodiere, dekodiere } from '../../vertrag/attrappe_kern/osc.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function starte(t, extra) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erzname-'));
  fs.mkdirSync(path.join(tmp, 'kits/t'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'kits/t/kit.json'), JSON.stringify({ schema: 1, name: 't', klaenge: [
    { note: 0, name: 'bd:0', datei: 'bd_0.f32', frames: 1 }] }));
  const muster = path.join(tmp, 'strom1.js');
  fs.writeFileSync(muster, 's("bd*4")');
  const kern = dgram.createSocket('udp4');
  await new Promise((r) => kern.bind(0, '127.0.0.1', r));
  const eingang = [];
  kern.on('message', (b) => eingang.push(dekodiere(b)));
  const p = spawn(process.execPath, ['--permission', `--allow-fs-read=${path.resolve(HIER, '../..')}`,
    `--allow-fs-read=${process.env.HOME}/strudel`, `--allow-fs-read=${tmp}`, `--allow-fs-write=${tmp}`,
    path.join(HIER, '../erzeuger.mjs'), '--kern-port', String(kern.address().port), '--abo-port', '0',
    '--kit-ordner', path.join(tmp, 'kits'), '--kit', 't', '--muster', muster, ...extra], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { p.kill('SIGTERM'); kern.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const hallo = () => eingang.find((m) => m.adresse === '/k/hallo');
  for (let i = 0; i < 100 && !hallo(); i++) await warte(50);
  return { hallo: hallo(), kern, eingang };
}

test('--name erzeuger2 --strom 2 --kanal erz/2: Hallo und Strom tragen beides', { timeout: 15000 }, async (t) => {
  const { hallo, kern, eingang } = await starte(t, ['--name', 'erzeuger2', '--strom', '2', '--kanal', 'erz/2']);
  assert.equal(hallo?.werte[0], 'erzeuger2');
  kern.send(kodiere('/uhr', 'hhddd', [0n, process.hrtime.bigint(), 6.0, 128, 0]), hallo.werte[1], '127.0.0.1');
  await warte(300);
  const strom = eingang.find((m) => m.adresse === '/erz/strom');
  assert.deepEqual(strom?.werte.slice(1), ['erzeuger', 2, 'kit:t', 'erz/2']);   // quelle bleibt 'erzeuger' (Vertrag)
});

test('ohne --name: Vorgabe erzeuger (Negativ-Kontrolle, Betrieb wie bisher)', { timeout: 15000 }, async (t) => {
  const { hallo } = await starte(t, []);
  assert.equal(hallo?.werte[0], 'erzeuger');
});
