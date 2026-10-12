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

// S7 (Review S7 m4): --name steht auf der Befehlszeile (pw-jack-Stub auf dem PATH schreibt seine Argumente weg).
async function stubArgs(t, opt) {
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'pwjack-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'pw-jack'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\nexit 1\n`);
  chmodSync(join(dir, 'pw-jack'), 0o755);
  const alt = process.env.PATH;
  process.env.PATH = `${dir}:${alt}`;
  t.after(() => { process.env.PATH = alt; });
  const k = new VorhoererKlient({ bin: '/bin/true', ausgang: 'x', port: 47999, ...opt });
  await assert.rejects(k.starte(), /beendet/);
  k.sock.close();
  return readFileSync(join(dir, 'args'), 'utf8').split('\n');
}

test('S7: name → --name BASIS auf der Befehlszeile', async (t) => {
  const a = await stubArgs(t, { name: 'cypherdj-vorhoerer-mt' });
  const i = a.indexOf('--name');
  assert.ok(i >= 0 && a[i + 1] === 'cypherdj-vorhoerer-mt', a.join(' '));
});

test('S7 Negativ-Kontrolle: ohne name kein --name', async (t) => {
  const a = await stubArgs(t, {});
  assert.ok(!a.includes('--name'), a.join(' '));
});

test('S7 B2: stirbt der Kindprozess, meldet der Klient „beendet“ (Vorhoeren startet dann neu)', async (t) => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pwjack-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.writeFileSync(path.join(d, 'pw-jack'), '#!/bin/sh\nsleep 0.3\n', { mode: 0o755 });   // Attrappe: lebt kurz, antwortet nie, stirbt
  const alt = process.env.PATH; process.env.PATH = `${d}:${alt}`;
  t.after(() => { process.env.PATH = alt; });
  const k = new VorhoererKlient({ bin: '/bin/true', ausgang: 'x', port: 1 });
  t.after(() => { try { k.sock.close(); } catch { /* schon zu */ } });
  const beendet = new Promise((ok) => k.once('beendet', ok));
  k.starte().catch(() => {});
  const r = await Promise.race([beendet.then(() => 'beendet'), new Promise((x) => setTimeout(() => x('nie'), 3000))]);
  assert.equal(r, 'beendet');
});

test('Abo: der Klient erneuert sein /v/hallo regelmäßig (der Vorhörer hält nur 4 Abonnenten, fremde Absender verdrängen den ältesten)', async (t) => {
  const { k, nachrichten } = await attrappe(t);
  assert.equal(typeof k.aboErneuern, 'function', 'aboErneuern fehlt');
  k.aboErneuern(40);
  await new Promise((r) => setTimeout(r, 300));
  clearInterval(k.aboTimer);                                    // stoppe() schlösse den Socket ein zweites Mal (die Attrappe tut es in t.after)
  const n = nachrichten.filter((m) => m.adr === '/v/hallo').length;
  assert.ok(n >= 4, `mehrere hallo gesendet (${n})`);
  const vor = nachrichten.length; await new Promise((r) => setTimeout(r, 150));
  assert.equal(nachrichten.length, vor, 'nach dem Stoppen des Timers keine weiteren');
});
