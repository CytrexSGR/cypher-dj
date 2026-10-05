// Taktgeber für die Tests der Scheibe 12: ein Mini-Kern ohne JACK und ohne Ton. Er beantwortet
// /k/hallo mit /k/willkommen, schickt je 256 Samples Echtzeit /uhr und am Taktanfang /takt, quittiert
// /test/klick mit /q 1 und 2. Er ist NICHT die Kern-Attrappe (Scheibe 13) und prüft keine Semantik.
// Als eigener Prozess, damit SIGSTOP/SIGCONT ihn wie den Kern anhalten.
// Aufruf: node tests/hilfen/taktgeber.ts --port <udp> [--bpm 128]
import dgram from 'node:dgram';
import { parseArgs } from 'node:util';
import { baue, liesUndDekodiere } from '../../src/adressen.ts';
import { jetztNs } from '../../src/zeit.ts';

const { values } = parseArgs({ options: { port: { type: 'string' }, bpm: { type: 'string', default: '128' } } });
const PORT = Number(values.port);
const BPM = Number(values.bpm);
const RATE = 48000;
const BLOCK = 256;
const SPB = (RATE * 60) / BPM;     // Samples je Beat
const SPT = 4 * SPB;               // Samples je Takt

const sock = dgram.createSocket('udp4');
const abonnenten = new Map<number, string>();
let t0 = jetztNs();
let bloecke = 0;

const an = (buf: Buffer) => { for (const p of abonnenten.keys()) sock.send(buf, p, '127.0.0.1'); };
const sampleJetzt = () => bloecke * BLOCK;

function block(): void {
  const s = bloecke * BLOCK;
  const mono = t0 + Math.round((s * 1e9) / RATE);
  an(baue('/uhr', { sample: s, mono_ns: mono, beat: s / SPB, bpm: BPM, bpm_pro_s: 0 }));
  const k = Math.ceil(s / SPT);           // erster Taktanfang ab s
  if (k * SPT < s + BLOCK) {
    an(baue('/takt', { takt: k + 1, phrase: Math.floor(k / 8) + 1, sample: k * SPT, beat: 4 * k, bpm: BPM }));
  }
  bloecke++;
}

setInterval(() => {
  const soll = Math.floor(((jetztNs() - t0) * RATE) / 1e9 / BLOCK);
  // nach SIGCONT kein Nachholschwall; t0 bleibt ganzzahlig, sonst ist mono_ns kein int64 mehr
  if (soll - bloecke > 10) t0 += Math.round(((soll - bloecke - 1) * BLOCK * 1e9) / RATE);
  while (bloecke < Math.floor(((jetztNs() - t0) * RATE) / 1e9 / BLOCK)) block();
}, 1);

sock.on('message', (buf, rinfo) => {
  let d;
  try { d = liesUndDekodiere(buf); } catch { an(baue('/e/protokollfehler', { adresse: '?', grund: 'unbekannte_adresse' })); return; }
  const f = d.felder;
  if (d.adresse === '/k/hallo') {
    abonnenten.set(f.port as number, f.name as string);
    sock.send(baue('/k/willkommen', { protokoll: 1, generation: 0, sample: sampleJetzt(), beat: sampleJetzt() / SPB,
      bpm: BPM, kern_version: 'taktgeber' }), f.port as number, '127.0.0.1');
  } else if (d.adresse === '/k/tschuess') {
    for (const [p, n] of abonnenten) if (n === f.name) abonnenten.delete(p);
  } else if (d.adresse === '/test/klick') {
    const s = sampleJetzt();
    an(baue('/q', { id: f.id, quelle: f.quelle, status: 1, ist_sample: s, ist_beat: s / SPB, grund: '' }));
    an(baue('/q', { id: f.id, quelle: f.quelle, status: 2, ist_sample: s + BLOCK, ist_beat: (s + BLOCK) / SPB, grund: '' }));
  }
  void rinfo;
});

sock.bind(PORT, '127.0.0.1', () => process.stdout.write(`taktgeber: udp ${PORT}, ${BPM} BPM\n`));
