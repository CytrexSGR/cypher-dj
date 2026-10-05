// Prüf-Client der Abnahme (Scheibe 12). Misst am Ziel, unabhängig vom Leitstand:
//  - Vermittler (UDP): der Leitstand schickt an --vermittler-port, der Prüf-Client reicht an den Kern weiter
//    und notiert jede Nachricht Leitstand → Kern mit Zeit (zählt /k/hallo und /k/tschuess);
//  - eigenes Kern-Abo (Name "pruefstand"): /uhr, /takt, /q als Bezug für Taktanfang (mono_ns) und Zählung;
//  - WS-Client Rolle "pruefstand": jede Nachricht mit Empfangszeit und seq; schickt rpc lage (Gegenprobe);
//  - WS-Client Rolle "ansage": schickt rpc lage (muss rpc_fehler bekommen), sammelt die ansage-Sätze;
//  - schickt /test/klick an den Kern (erzeugt /q), hält den Kern per SIGSTOP an und lässt ihn per SIGCONT weiter.
// Aufruf: node pruef/pruefclient.ts --kern-port K --vermittler-port V --abo-port A --ws-port W
//         [--takte 100] [--klicks 10] [--kern-pid PID --stopp-ms 1000] --aus ergebnis.json
import dgram from 'node:dgram';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { baue, liesUndDekodiere } from '../src/adressen.ts';
import { KernAnbindung } from '../src/kern.ts';
import { WsClient } from '../src/ws_client.ts';
import { jetztNs } from '../src/zeit.ts';

const { values: a } = parseArgs({
  options: {
    'kern-port': { type: 'string' }, 'vermittler-port': { type: 'string' }, 'abo-port': { type: 'string' },
    'ws-port': { type: 'string' }, takte: { type: 'string', default: '100' }, klicks: { type: 'string', default: '10' },
    'kern-pid': { type: 'string' }, 'stopp-ms': { type: 'string', default: '1000' }, aus: { type: 'string' },
  },
});
const KERN = Number(a['kern-port']);
const TAKTE = Number(a.takte);
const KLICKS = Number(a.klicks);
const warte = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const log = (s: string) => process.stdout.write(`pruefclient: ${s}\n`);

// 1. Vermittler: Leitstand → V → Kern, mit Zeit und Adresse
const vermittelt: { t: number; adresse: string }[] = [];
const verm = dgram.createSocket('udp4');
const aus = dgram.createSocket('udp4');
verm.on('message', (buf) => {
  let adresse = '?';
  try { adresse = liesUndDekodiere(buf).adresse; } catch { /* trotzdem weiterreichen */ }
  vermittelt.push({ t: jetztNs(), adresse });
  aus.send(buf, KERN, '127.0.0.1');
});
await new Promise<void>((ok) => verm.bind(Number(a['vermittler-port']), '127.0.0.1', () => ok()));

// 2. Eigenes Abo beim Kern
const uhr: [number, number, number][] = []; // [sample, mono_ns, empfangen]
const taktAbo: { takt: number; sample: number; t: number }[] = [];
const qAbo: { id: number; status: number; t: number }[] = [];
const abo = new KernAnbindung({ kernPort: KERN, aboPort: Number(a['abo-port']), name: 'pruefstand' }, {
  nachricht: (d, t) => {
    const f = d.felder;
    if (d.adresse === '/uhr') uhr.push([f.sample as number, f.mono_ns as number, t]);
    else if (d.adresse === '/takt') taktAbo.push({ takt: f.takt as number, sample: f.sample as number, t });
    else if (d.adresse === '/q') qAbo.push({ id: f.id as number, status: f.status as number, t });
  },
  gesendet: () => {}, zustand: () => {}, unlesbar: (g) => log(`unlesbar: ${g}`),
});
await abo.starte();

// 3. WS-Clients; der Leitstand kann noch starten
const WS = Number(a['ws-port']);
let ps: WsClient | null = null;
for (let i = 0; i < 100 && !ps; i++) {
  try { ps = await WsClient.angemeldet(WS, 'pruefstand', 'pruefclient'); } catch { await warte(100); }
}
if (!ps) throw new Error(`Leitstand auf ws ${WS} nicht erreichbar`);
const ansage = await WsClient.angemeldet(WS, 'ansage', 'pruef-ansage');
ansage.sende('rpc', { id: 1, methode: 'lage', parameter: {} });
ps.sende('rpc', { id: 2, methode: 'lage', parameter: {} });
log('angemeldet');

// 4. TAKTE Takte beobachten, dabei KLICKS /test/klick verteilen (an 1, aus 0 im Wechsel). Das Fenster beginnt erst,
//    wenn der Leitstand selbst einen takt verteilt hat: dann ist er beim Kern angemeldet. Vorher kann der erste /takt
//    des Fensters den Prüf-Client erreichen, den Leitstand aber noch nicht (gemessen: 1 von 30 Läufen „WS-takt 11,
//    soll 12“ und „Journal /takt 11 gegen empfangen 12“).
const bisLs = Date.now() + 10000;
while (!ps.empfangen.some((x) => x.n.typ === 'takt')) {
  if (Date.now() > bisLs) { log('der Leitstand verteilt in 10 s keinen takt'); process.exit(4); }
  await warte(5);
}
const ersterTakt = await new Promise<number>((ok) => {
  const n0 = taktAbo.length;
  const bis = Date.now() + 10000;
  const iv = setInterval(() => {
    if (taktAbo.length > n0) { clearInterval(iv); ok(taktAbo[n0].takt); return; }
    if (Date.now() > bis) { log(`kein /takt vom Kern auf Port ${KERN} in 10 s`); process.exit(4); }
  }, 5);
});
log(`erster Takt ${ersterTakt}`);
const id0 = jetztNs(); // §1.4: Zählerstart = mono_ns
let klick = 0;
while (taktAbo[taktAbo.length - 1].takt < ersterTakt + TAKTE - 1) {
  const seit = taktAbo[taktAbo.length - 1].takt - ersterTakt;
  if (klick < KLICKS && seit >= Math.floor(((klick + 1) * TAKTE) / (KLICKS + 1))) {
    aus.send(baue('/test/klick', { id: id0 + klick, quelle: 'pruefstand', kanal: 'master', an: klick % 2 === 0 ? 1 : 0 }),
      KERN, '127.0.0.1');
    klick++;
  }
  await warte(20);
}
const letzterTakt = ersterTakt + TAKTE - 1;
await warte(400); // letzte takt-Nachricht und Quittungen abwarten
const hauptEnde = jetztNs();
log(`Takte ${ersterTakt} bis ${letzterTakt} beobachtet, ${klick} Klick-Befehle`);

// 5. Fehlerfall: Kern anhalten und weiterlaufen lassen. Angehalten wird 200 ms nach einem Herzschlag-hallo, damit
//    der nächste Herzschlag (1 500 ms später) nicht ins Stopp-Fenster fällt und als „zu früh“ zählt.
let stopp: { t_stopp: number; t_weiter: number; uhr_letzte: number } | null = null;
if (a['kern-pid']) {
  const pid = Number(a['kern-pid']);
  const n0 = vermittelt.length;
  while (!vermittelt.slice(n0).some((v) => v.adresse === '/k/hallo')) await warte(5);
  await warte(200);
  const t_stopp = jetztNs();
  process.kill(pid, 'SIGSTOP');
  await warte(Number(a['stopp-ms']));
  // Kern-Zeit (mono_ns) der letzten /uhr vor dem Anhalten. Nicht der eigene Empfang: der Leitstand empfängt dieselbe
  // /uhr bis rund 1 ms früher als dieser Prozess (gemessen: erstes hallo „99,2 ms“ nach dem eigenen Empfang, 1 von 30
  // Läufen); seine 100 ms beginnen nie vor mono_ns (A0 prüft, dass beide Seiten dieselbe Uhr lesen).
  const uhr_letzte = uhr.at(-1)?.[1] ?? 0;
  const t_weiter = jetztNs();
  process.kill(pid, 'SIGCONT');
  await warte(1500);
  stopp = { t_stopp, t_weiter, uhr_letzte };
  log(`Kern ${pid} ${Number(a['stopp-ms'])} ms angehalten`);
}

await abo.stoppe();
ps.schliesse();
ansage.schliesse();
verm.close();
aus.close();

// Taktanfang in CLOCK_MONOTONIC aus dem eigenen /uhr-Strom: Block, der das Takt-Sample enthält, plus Versatz.
function monoVon(sample: number): number | null {
  let lo = 0, hi = uhr.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (uhr[m][0] <= sample) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0) return null;
  const [s, mono] = uhr[best];
  return mono + Math.round(((sample - s) * 1e9) / 48000);
}

// Instrument: Empfang einer /uhr minus ihr mono_ns (gleiche Uhr beider Seiten, sonst ist der Verzug erfunden)
const uhrVersatz = uhr.map(([, mono, t]) => (t - mono) / 1e6).sort((x, y) => x - y);
const ergebnis = {
  erster_takt: ersterTakt, letzter_takt: letzterTakt, haupt_ende: hauptEnde,
  takt_abo: taktAbo.map((x) => ({ ...x, mono_anfang: monoVon(x.sample) })),
  q_abo: qAbo, vermittelt, stopp,
  uhr_versatz_ms: {
    n: uhrVersatz.length, min: uhrVersatz[0], p50: uhrVersatz[Math.floor(uhrVersatz.length / 2)], max: uhrVersatz.at(-1),
  },
  ws_pruefstand: ps.empfangen, ws_ansage: ansage.empfangen,
};
fs.writeFileSync(String(a.aus), JSON.stringify(ergebnis));
log(`Ergebnis ${a.aus}`);
process.exit(0);
