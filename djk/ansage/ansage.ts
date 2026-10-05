// Ansage-Zeile (ADR 019): liest den Leitstand-WebSocket als Rolle "ansage" und schreibt je takt eine Zeile
// ("T 17.1  P3  128,00 BPM") und je ansage einen Satz ("T 14: Kern antwortet nicht …"). Eine getippte Zeile geht
// als zuruf an den Leitstand (§9.4). Fällt der Leitstand weg, verbindet sie sich jede Sekunde neu.
// Aufruf: node djk/ansage/ansage.ts [--konfig <leitstand.toml>] [--port <ws>]; CYPHERDJ_INSTANZ wie beim Leitstand.
// Die Abhängigkeiten (ws, ajv, smol-toml) kommen aus djk/leitstand/node_modules über die Importe von dort.
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Umschlag } from '../leitstand/src/hub.ts';
import { ladeKonfig } from '../leitstand/src/konfig.ts';
import { WsClient } from '../leitstand/src/ws_client.ts';

const zahl = (x: unknown, stellen: number) => Number(x).toFixed(stellen).replace('.', ',');

// Eine Zeile für das Terminal oder null (nichts anzuzeigen).
export function zeile(n: Umschlag): string | null {
  const d = n.daten;
  switch (n.typ) {
    case 'takt':
      return `T ${d.takt}.1  P${d.phrase}  ${zahl(d.bpm, 2)} BPM` + (d.bericht_vorher ? '' : '  (ohne Bericht)');
    case 'ansage':
      return (d.art === 'info' ? '' : `${String(d.art).toUpperCase()} `) + String(d.text);
    case 'willkommen':
      return `verbunden: Set ${d.set_id}, Generation ${d.generation}, Autonomie ${d.autonomie}`;
    case 'rpc_fehler':
      return `FEHLER ${d.code}: ${d.text}`;
    default:
      return null;
  }
}

async function verbinde(port: number, schreib: (s: string) => void): Promise<WsClient> {
  for (;;) {
    try {
      const c = await WsClient.verbinde(port);
      c.rolle = 'ansage';
      c.bei = (e) => { const z = zeile(e.n); if (z !== null) schreib(z); };
      c.sende('hallo', { rolle: 'ansage', name: 'ansage-zeile', protokoll: 1 });
      return c;
    } catch {
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { konfig: { type: 'string' }, port: { type: 'string' } } });
  const port = values.port ? Number(values.port) : ladeKonfig({ pfad: values.konfig }).ws_port;
  const schreib = (s: string) => process.stdout.write(s + '\n');
  schreib(`ansage: Leitstand ws://127.0.0.1:${port}/`);
  let c = await verbinde(port, schreib);
  const neu = (): void => {
    c.ws.once('close', async () => {
      schreib('Leitstand weg, verbinde neu …');
      c = await verbinde(port, schreib);
      neu();
    });
  };
  neu();
  readline.createInterface({ input: process.stdin }).on('line', (l) => {
    const text = l.trim();
    if (text) c.sende('zuruf', { text });
  });
  process.on('SIGTERM', () => { c.schliesse(); process.exit(0); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: Error) => { process.stderr.write(`ansage: ${e.message}\n`); process.exit(2); });
}
