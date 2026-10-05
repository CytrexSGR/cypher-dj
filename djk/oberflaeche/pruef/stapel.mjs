// Prüfstapel für Scheibe 60m: Kern-Attrappe (13) + Zähl-Relais + Leitstand (21) + Seiten-Server + Anzeige-Sonde am
// Leitstand-WS. Alles auf einer Prüfinstanz (Z2, Vorgabe g), kein JACK, kein Ton. 60m-Nachtrag: die Attrappe liest
// wie der echte Kern nur aus dem Arbeitsbestand; dorthin kopiert der Seiten-Server beim Laden (arbeitsbestand.ts).
// Der Arbeitsbestand des Stapels ist ein eigener tmpfs-Ordner /dev/shm/djk60m-<i>-XXXXXX/material, beim Stoppen weg.
// Direkt aufgerufen: node pruef/stapel.mjs <ordner> [instanz]  → läuft bis SIGTERM/SIGINT.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteRelais } from './relais.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const OB = path.resolve(HIER, '..');
const REPO = path.resolve(OB, '..', '..');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function bereit(p, name, muster) {
  return new Promise((ok, fehler) => {
    let aus = '';
    p.stdout.on('data', (d) => { aus += d; if (aus.includes(muster)) ok(); });
    p.once('exit', (c) => fehler(new Error(`${name} endete mit ${c}: ${aus}`)));
  });
}

export async function starteStapel(ordner, instanz = 'g', env = {}, { bestand = path.join(REPO, 'bestand'), vorher } = {}) {
  fs.mkdirSync(ordner, { recursive: true });
  const abWurzel = fs.mkdtempSync(`/dev/shm/djk60m-${instanz}-`);
  const k = 1000 * (instanz.charCodeAt(0) - 96);
  const ports = { kern: 47100 + k, relais: 47199 + k, ls_ws: 47200 + k, ls_abo: 47110 + k, abo: 47150 + k, http: 47300 + k };
  const kinder = [];
  const sonde = { nachrichten: [] };
  let relais = null;
  let sondeLog = null;
  // Befund 2: dieselbe Aufräumung für Stopp und für einen Start, der unterwegs scheitert (Kind endet, Sonde, vorher):
  // Sonde zu, Kinder in umgekehrter Reihenfolge beenden, Relais zu, Arbeitsbestand in /dev/shm weg.
  let aufgeraeumt = false;
  const aufraeumen = async () => {
    if (aufgeraeumt) return;
    aufgeraeumt = true;
    try { sonde.ws?.close(); } catch { /* schon zu */ }
    for (const p of [...kinder].reverse()) {
      const zu = new Promise((r) => (p.exitCode !== null || p.signalCode !== null ? r() : p.once('exit', r)));
      p.kill('SIGTERM');
      await Promise.race([zu, warte(3000)]);
      if (p.exitCode === null && p.signalCode === null) { p.kill('SIGKILL'); await Promise.race([zu, warte(1000)]); }
    }
    relais?.stoppe();
    if (sondeLog !== null) fs.closeSync(sondeLog);
    fs.rmSync(abWurzel, { recursive: true, force: true });
  };
  const ab = path.join(abWurzel, 'material');
  const setId = '2026-09-26_6000';
  try {
    fs.mkdirSync(ab);
    vorher?.(ab);
    const logs = (name) => fs.openSync(path.join(ordner, `${name}.log`), 'a');
    const starte = (name, args, extra = {}) => {
      const out = logs(name);
      const p = spawn(process.execPath, ['--no-warnings', ...args], { env: { ...process.env, CYPHERDJ_INSTANZ: instanz, ...extra },
        stdio: ['ignore', 'pipe', out] });
      fs.closeSync(out); // das Kind hat seine eigene Kopie
      p.stdout.on('data', (d) => fs.appendFileSync(path.join(ordner, `${name}.log`), d));
      kinder.push(p);
      return p;
    };
    const att = starte('attrappe', [path.join(REPO, 'djk/vertrag/attrappe_kern.mjs'), '--frisch', '--arbeitsbestand',
      ab, '--zustand', path.join(ordner, 'zustand_attrappe.json')]);
    await bereit(att, 'attrappe', 'attrappe_kern:');
    relais = await starteRelais({ hoeren: ports.relais, kern: ports.kern, log: path.join(ordner, 'relais.jsonl') });
    fs.writeFileSync(path.join(ordner, 'leitstand.toml'),
      `version = 1\nws_port = ${ports.ls_ws - k}\nabo_port = ${ports.ls_abo - k}\nsets = "${path.join(ordner, 'sets')}"\n`);
    const ls = starte('leitstand', [path.join(REPO, 'djk/leitstand/src/leitstand.ts'), '--konfig', path.join(ordner, 'leitstand.toml'),
      '--kern-port', String(ports.relais), '--set-id', setId]);
    await bereit(ls, 'leitstand', 'leitstand:');
    const srv = starte('server', [path.join(OB, 'server.ts'), '--kern-port', String(ports.relais), '--log', path.join(ordner, 'server.jsonl'),
      '--bestand', bestand, '--arbeitsbestand', ab, '--ziel-kurve', 'attrappe_linear'], env);
    await bereit(srv, 'server', 'oberflaeche:');
    // Anzeige-Sonde: zweiter, unabhängiger Leser am Leitstand-WS (Rolle anzeige), protokolliert jede Nachricht
    sondeLog = fs.openSync(path.join(ordner, 'sonde.jsonl'), 'a');
    await new Promise((ok, fehler) => {
      const ws = new WebSocket(`ws://127.0.0.1:${ports.ls_ws}/`);
      sonde.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ v: 1, seq: 1, von: 'anzeige', typ: 'hallo', zeit: { sample: 0, beat: 0, takt: 1, phrase: 1 },
        daten: { rolle: 'anzeige', name: 'sonde60m', protokoll: 1 } }));
      ws.onmessage = (m) => {
        const n = JSON.parse(m.data);
        sonde.nachrichten.push({ t: Date.now(), n });
        if (n.typ !== 'takt') fs.writeSync(sondeLog, JSON.stringify({ t: Date.now(), typ: n.typ, daten: n.daten }) + '\n');
        if (n.typ === 'willkommen') ok();
      };
      ws.onerror = () => fehler(new Error('Sonde: WS-Fehler'));
    });
    await warte(300);
  } catch (e) {
    await aufraeumen();
    throw e;
  }
  const journal = path.join(ordner, 'sets', setId, 'journal.jsonl');
  return { ports, relais, sonde, journal, ab, url: `http://127.0.0.1:${ports.http}/`, stoppe: aufraeumen };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ordner = path.resolve(process.argv[2] ?? path.join(OB, 'pruef', 'ergebnisse', 'stapel'));
  const s = await starteStapel(ordner, process.argv[3] ?? 'g');
  process.stdout.write(`stapel: ${s.url} leitstand ws ${s.ports.ls_ws} relais ${s.ports.relais} → kern ${s.ports.kern} ordner ${ordner}\n`);
  const ende = async () => { await s.stoppe(); process.exit(0); };
  process.on('SIGTERM', ende);
  process.on('SIGINT', ende);
}
