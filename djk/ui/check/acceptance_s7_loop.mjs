// Acceptance of 1.12 S7 (M13) "track band loop" against the REAL CORE on test instance d (plan PLAN-1.12-slices4-5-7, outside the repo,
// U12 T12.6 and U13 T13.5; source: Studio S8 plan tasks 5 and 8). The script refuses every instance but d (never a, never f).
// Call order (every step under the flock rule of the plan's global rules, d outside):
//   1  djk/start/djk-start --instanz d    (core built from this tree, silent sink, the page server of this tree)
//   2  flock -w 1800 /dev/shm/cypherdj-instanz-d.flock node djk/ui/check/acceptance_s7_loop.mjs --url http://127.0.0.1:51300 \
//        [--ausgabe <folder>] [--nur S1,S4,STOP,AE]
// The core must run at 128 BPM (the plan's numbers); another tempo is a usage error (rc 2).
// Criteria, measured on the events the page server passes through /strom (/uhr, /e/regler, /q; check/s7_loop_measure.mjs):
//   S1, S4  a loop on erz/2/fader (set 0 at bar 1, linear ramp to -30 over n bars) with n = 1 and n = 4 runs 6 passes: every pass sets 0 on its
//           start beat with a gap of 0 samples (sample of the set event minus the sample of the start beat on the /uhr line), no part rejected
//           (GET /spur abgelehnt, polled), the start beats are anker + 4n·k.
//   STOP    POST /spur/stopp during pass 3 of S1: the hold event on erz/2/fader comes within one block of the sample at which the core executed
//           the abort (ist_sample of its /q); GET /spur is empty; no further set within 10 s.
//   AE      (U13) a loop n = 2 (0 -> -30); during pass k POST /spur/aendern with the line 0 -> -10: the answer names ab_beat; every pass before
//           ab_beat follows the old line (minimum of its reported course below -20; /e/regler reports at most 50 Hz, so the exact end -30
//           coincides with the next pass's set and is not reported), every pass from ab_beat on stays at or above -10.5 (the new line), so the
//           change never applies inside pass k. Negative control: erz/3/filter (not moved) reports no event in that time.
// STOP's limit is the core quantum (--block, default 256 samples, INTERFACES section 20 "Quantum 256"): the /uhr lines on /strom are
// throttled to 50 ms by the page server, so the block cannot be read from them.
// Return: 0 all OK, 1 at least one FEHL, 2 usage. Raw events go to rohdaten.jsonl in the output folder, the lines to ergebnis.txt.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { blockGroesse, nahtLuecken, verlauf, stoppVerzug } from './s7_loop_measure.mjs';

const { values: opt } = parseArgs({ options: { url: { type: 'string' }, instanz: { type: 'string' }, ausgabe: { type: 'string' }, nur: { type: 'string' },
  block: { type: 'string' } } });
const BLOCK = Number(opt.block ?? 256);
const nutzung = (t) => { process.stderr.write(`abnahme_s7_schleife: ${t}\n`); process.exit(2); };
if (!opt.url) nutzung('usage: --url <http://127.0.0.1:port of instance d> [--instanz d] [--ausgabe <folder>] [--nur S1,S4,STOP,AE] [--block 256]');
const port = Number(new globalThis.URL(opt.url).port), k = (port - 47300) / 1000;
const instanz = opt.instanz ?? (Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : '?');
if (instanz !== 'd' || port !== 47300 + 4000) nutzung(`instance ${instanz} (port ${port}) is not allowed: d only (port 51300)`);
const NUR = opt.nur ? new Set(opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const soll = (x) => !NUR || NUR.has(x);
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir()))
  : path.join(path.dirname(new globalThis.URL(import.meta.url).pathname), 'ergebnisse', `${Date.now()}-abnahme_s7_schleife`);
fs.mkdirSync(ORDNER, { recursive: true });
const roh = fs.createWriteStream(path.join(ORDNER, 'rohdaten.jsonl'));
const zeilen = [];
let fehl = 0;
const notiere = (kz, ok, text) => { if (!ok) fehl++; const z = `${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}`; zeilen.push(z); process.stdout.write(`${z}\n`); };
const info = (t) => { zeilen.push(`INFO ${t}`); process.stdout.write(`INFO ${t}\n`); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ruf = async (methode, weg, koerper) => {
  const r = await fetch(opt.url + weg, methode === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(koerper ?? {}) });
  let j = null; try { j = await r.json(); } catch { /* no JSON */ }
  return { code: r.status, j };
};

// Events of /strom
const uhren = [], regler = [], quittungen = [];
const ac = new AbortController();
(async () => {
  const r = await fetch(`${opt.url}/strom`, { signal: ac.signal });
  const dec = new TextDecoder();
  let puffer = '';
  for await (const teil of r.body) {
    puffer += dec.decode(teil, { stream: true });
    let i;
    while ((i = puffer.indexOf('\n\n')) >= 0) {
      const z = puffer.slice(0, i); puffer = puffer.slice(i + 2);
      if (!z.startsWith('data: ')) continue;
      const n = JSON.parse(z.slice(6));
      if (n.a === '/uhr') uhren.push({ sample: Number(n.f.sample), beat: n.f.beat, bpm: n.f.bpm });
      else if (n.a === '/e/regler') regler.push({ pfad: n.f.pfad, wert: n.f.wert, halter: n.f.halter, sample: Number(n.f.sample), beat: n.f.beat });
      else if (n.a === '/q') quittungen.push({ id: Number(n.f.id), status: n.f.status, ist_sample: Number(n.f.ist_sample) });
      else continue;
      roh.write(`${JSON.stringify(n)}\n`);
    }
  }
})().catch(() => {});
const beat = () => uhren.at(-1)?.beat ?? null;
const bisBeat = async (b) => { while ((beat() ?? -Infinity) < b) await warte(50); };

const linie = (name, n, nach, ziel = 'erz/2/fader') => ({ name, schleife_takte: n, fahrten: [
  { ziel, ab_takt: 1, nach: 0 }, { ziel, ab_takt: 1, takte: n, nach, form: 'linear' }] });
const abgelehnt = new Map();
const sammleAbgelehnt = async () => { for (const s of (await ruf('GET', '/spur')).j ?? []) for (const a of s.abgelehnt ?? []) abgelehnt.set(`${s.name}:${a.teil}`, a); };

async function schleife(kz, n) {
  const name = `abn-s7-${n}`;
  const r = await ruf('POST', '/spur', { spur: linie(name, n, -30) });
  if (r.code !== 200) return notiere(kz, false, `POST /spur -> ${r.code} ${JSON.stringify(r.j)}`);
  const anker = r.j.anker_beat, starts = [1, 2, 3, 4, 5].map((x) => anker + 4 * n * x);
  info(`${kz}: anchor beat ${anker}, passes at ${[anker, ...starts].join(', ')}`);
  for (let p = 1; p <= 6; p++) { await bisBeat(anker + 4 * n * p + 0.5); await sammleAbgelehnt(); }
  const stop = kz === 'S1' && soll('STOP');
  if (!stop) await ruf('POST', '/spur/stopp', { name });
  const l = nahtLuecken(regler, uhren, { pfad: 'erz/2/fader', starts, wert: 0 });
  const ab = [...abgelehnt.entries()].filter(([x]) => x.startsWith(`${name}:`));
  notiere(kz, l.every((x) => x.luecke === 0) && ab.length === 0,
    `n = ${n}, gaps at the 5 seams [${l.map((x) => (x.fehlt ? 'missing' : x.luecke)).join(', ')}] samples, rejected parts ${ab.length}`);
  return { name, anker };
}

async function stopp(s1) {
  await bisBeat(s1.anker + 4 * 2 + 1.5);   // inside pass 3 (k = 2), in the middle of its ramp
  const r = await ruf('POST', '/spur/stopp', { name: s1.name });
  if (r.code !== 200) return notiere('STOP', false, `POST /spur/stopp -> ${r.code}`);
  const id = Number(r.j.felder.id);
  for (let i = 0; i < 100 && !quittungen.some((q) => q.id === id); i++) await warte(50);
  const q = quittungen.find((x) => x.id === id);
  if (!q) return notiere('STOP', false, 'no /q for the abort');
  await warte(500);
  const v = stoppVerzug(regler, 'erz/2/fader', q.ist_sample), block = BLOCK;
  const nach = regler.length;
  await warte(10000);
  const spaeter = regler.slice(nach).filter((x) => x.pfad === 'erz/2/fader' && x.wert === 0);
  const leer = ((await ruf('GET', '/spur')).j ?? []).every((x) => x.name !== s1.name);
  notiere('STOP', v !== null && v.verzug <= block && spaeter.length === 0 && leer,
    `hold ${v ? `${v.verzug} samples after the abort (block ${block}), value ${v.wert}` : 'missing'}, sets in the 10 s after: ${spaeter.length}, GET /spur without the loop: ${leer}`);
}

async function aendern() {
  const name = 'abn-s7-ae', n = 2, b0 = regler.length;
  const r = await ruf('POST', '/spur', { spur: linie(name, n, -30) });
  if (r.code !== 200) return notiere('AE', false, `POST /spur -> ${r.code} ${JSON.stringify(r.j)}`);
  const anker = r.j.anker_beat;
  await bisBeat(anker + 4 * n + 2);   // inside pass 1
  const a = await ruf('POST', '/spur/aendern', { name, spur: linie(name, n, -10) });
  if (a.code !== 200) return notiere('AE', false, `POST /spur/aendern -> ${a.code} ${JSON.stringify(a.j)}`);
  const ab = a.j.ab_beat;
  info(`AE: change sent at beat ${beat()}, applies from beat ${ab} (bar ${a.j.ab_takt})`);
  await bisBeat(ab + 4 * n * 2 + 0.5);
  await ruf('POST', '/spur/stopp', { name });
  const passes = [];
  for (let s = anker; s + 4 * n <= ab + 4 * n * 2; s += 4 * n) {
    const w = verlauf(regler.slice(b0), 'erz/2/fader', s, s + 4 * n);
    passes.push({ s, min: w.length ? Math.min(...w) : null, neu: s >= ab });
  }
  const gut = passes.every((p) => p.min !== null && (p.neu ? p.min >= -10.5 : p.min < -20));
  const fremd = regler.slice(b0).filter((x) => x.pfad === 'erz/3/filter').length;
  notiere('AE', gut && passes.some((p) => p.neu) && fremd === 0,
    `passes ${passes.map((p) => `${p.s}${p.neu ? '*' : ''}:${p.min}`).join(' ')} (* = after the change; min of the course), erz/3/filter events ${fremd}`);
}

try {
  for (let i = 0; i < 100 && uhren.length < 5; i++) await warte(50);
  if (uhren.length < 5) nutzung('no /uhr from the page server of instance d');
  if (Math.abs(uhren.at(-1).bpm - 128) > 0.01) nutzung(`the core runs at ${uhren.at(-1).bpm} BPM, the plan's numbers need 128`);
  info(`core quantum ${BLOCK} samples (--block), /uhr step on /strom ${blockGroesse(uhren)} samples, 128 BPM, output ${ORDNER}`);
  const s1 = soll('S1') ? await schleife('S1', 1) : null;
  if (s1 && soll('STOP')) await stopp(s1);
  if (soll('S4')) await schleife('S4', 4);
  if (soll('AE')) await aendern();
} finally {
  ac.abort();
  roh.end();
  fs.writeFileSync(path.join(ORDNER, 'ergebnis.txt'), `${zeilen.join('\n')}\n`);
}
process.stdout.write(fehl ? `FEHL: ${fehl}\n` : 'ALLES OK (core d)\n');
process.exit(fehl ? 1 : 0);
