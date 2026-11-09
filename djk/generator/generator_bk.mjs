#!/usr/bin/env node
// cypherdj-erzeuger-bk (S18): ONE process for the Baukasten streams 5, 6, 7, 9, 10 (erz/5..7, pad/1, pad/2). The kern keeps
// at most 8 subscribers (net.h MAX_ABONNENTEN); one process per stream would take five of them, so a single socket
// says one hello (name erzeuger-bk) and serves all streams: one /uhr state, one alarm clock per bar, one StromLauf per
// stream with its own pattern folder <muster-basis><strom> (strom1.js, status.json, lebt.json). generator.mjs (streams
// 1..3) is not touched. Streams and MIDI targets come from djk/contract/stroeme.ts. Exit 2: start error (stream outside
// the table), systemd does not restart in a loop.
import dgram from 'node:dgram';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { kodiere, dekodiere } from '../contract/mock_core/osc.mjs';
import { BK_STROEME, STROM_KANAL, STROM_MIDI_ZIEL } from '../contract/streams.ts';
import { WECHSEL_ABSTAND } from './src/planner.mjs';
import { StromLauf } from './src/stream_run.mjs';
import { NeustartRegel } from './src/generation.mjs';

const I = process.env.CYPHERDJ_INSTANZ ?? '';
const V = I ? 1000 * (I.charCodeAt(0) - 96) : 0;
const { values: opt } = parseArgs({ options: {
  'kern-port': { type: 'string', default: String(47100 + V) },
  'abo-port': { type: 'string', default: String(47165 + V) },   // P_ERZ + 5 (djk-start: P_ERZ = 47160 + V)
  strom: { type: 'string', default: BK_STROEME.join(',') },
  'muster-basis': { type: 'string', default: `/dev/shm/cypherdj${I ? `-${I}` : ''}/erzeuger` },   // folder of stream N: <basis>N
  name: { type: 'string', default: 'erzeuger-bk' },
} });
const log = (t) => process.stderr.write(`erzeuger-bk: ${t}\n`);

const streams = opt.strom.split(',').map(Number);
const fremd = streams.filter((s) => !BK_STROEME.includes(s));
if (!streams.length || fremd.length || new Set(streams).size !== streams.length) {
  log(`--strom ${opt.strom}: streams must be unique members of ${BK_STROEME.join(',')} (stream 4 is the production, 1..3 belong to generator.mjs); not allowed: ${fremd.join(',') || 'duplicates'}`);
  process.exit(2);
}

const KERN = Number(opt['kern-port']);
const sock = dgram.createSocket('udp4');
const sende = (buf) => sock.send(buf, KERN, '127.0.0.1');
let uhr = null;   // last /uhr: {mono_ns: BigInt, beat, bpm}
const beatJetzt = () => uhr === null ? null : uhr.beat + (Number(process.hrtime.bigint() - uhr.mono_ns) / 1e9) * uhr.bpm / 60;
const msBisBeat = (b) => ((b - beatJetzt()) * 60000) / uhr.bpm;
const laeufe = new Map(streams.map((s) => [s, new StromLauf({ strom: s, kanal: STROM_KANAL[s], ziel: STROM_MIDI_ZIEL[s],
  ordner: `${opt['muster-basis']}${s}`, sende, beatJetzt, log })]));

const neustartRegel = new NeustartRegel();   // S17: announce once per kern generation, not on the heartbeat repeat
let wecker = null;
function wecke() {   // shortly before the bar starts: replace the next two bars of every stream
  if (!uhr) return;
  // WECHSEL_ABSTAND before the one, see generator.mjs (an event on the one would reach the kern late by the alarm jitter)
  const n = Math.floor((beatJetzt() + WECHSEL_ABSTAND) / 4 + 1e-6);
  for (const l of laeufe.values()) l.takt(n);
  clearTimeout(wecker);
  wecker = setTimeout(wecke, Math.max(5, msBisBeat(4 * (n + 1) - WECHSEL_ABSTAND)));
}

sock.on('message', (buf) => {
  let m;
  try {
    m = dekodiere(buf);
  } catch {
    return;
  }
  if (m.adresse === '/uhr') {
    const erste = !uhr;
    uhr = { mono_ns: m.werte[1], beat: m.werte[2], bpm: m.werte[3] };
    if (erste) {
      for (const l of laeufe.values()) { l.stromMelden(); l.musterLesen(); }
      wecke();
    }
  } else if (m.adresse === '/k/willkommen') {
    neustartRegel.willkommen(m.werte[1]);
  } else if (m.adresse === '/e/neustart') {   // kern restarted: streams and queues are gone
    if (!neustartRegel.neustart(m.werte[0])) return;   // S17: the heartbeat repeat of the same generation changes nothing
    for (const l of laeufe.values()) l.neustart();
    wecke();
  } else if (m.adresse === '/erz/quittung' && laeufe.has(m.werte[0]) && m.werte[5] > 0) {
    laeufe.get(m.werte[0]).log(`shipment ${m.werte[1]}: ${m.werte[5]} events late`);
  }
});

sock.bind(Number(opt['abo-port']), '127.0.0.1', () => {
  const abo = sock.address().port;
  const hallo = () => sende(kodiere('/k/hallo', 'sii', [opt.name, abo, 1]));   // ONE hello for all streams: one subscriber slot
  hallo();
  setInterval(hallo, 1000);
  for (const l of laeufe.values()) fs.watchFile(l.muster, { interval: 100 }, () => l.musterLesen());
  log(`ready: kern udp ${KERN}, subscription udp ${abo}, streams ${streams.join(',')}, pattern folders ${opt['muster-basis']}N`);
});
process.on('SIGTERM', () => process.exit(0));
