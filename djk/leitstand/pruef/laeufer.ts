// Folgen-Läufer mit Leitstand (Scheibe 21): fährt eine Folge nach djk/vertrag/folgen/FORMAT.md gegen die Kern-Attrappe
// (Scheibe 13, eigener Prozess, UDP) und den Leitstand (eigener Prozess, WebSocket), sammelt am Ziel, was die Attrappe
// an ihr Abo schickt und was der Leitstand an die WS-Clients des Läufers schickt, und urteilt mit
// djk/vertrag/folgen_vergleich.py (über attrappe_kern/vergleich.py), also mit derselben Regel wie jeder andere Läufer.
//
// Schritt-Arten: sende, hand, ws_sende, aktion, erwarte, erwarte_nicht, erlaube, wert, notiz (FORMAT.md 1 bis 16).
// ws_sende darf verbindung tragen (Vorgabe "haupt"): je Name eine WS-Verbindung; ein typ hallo öffnet sie neu.
// Eine notiz-Zeile mit leitstand_args (Liste) gibt dem Leitstand dieser Folge weitere Aufrufparameter (FORMAT.md Punkt 10).
// aktion: kern_kill9 (FORMAT.md), dazu nur für Folgen unter djk/leitstand/pruef/folgen/: leitstand_kill9
// (SIGKILL, alle WS-Verbindungen des Läufers sind danach zu) und leitstand_start (neuer Leitstand, gleiche set_id;
// mit ohne_set_id: true ohne --set-id, wie ein Neustart durch systemd).
// Ports: frei vom Betriebssystem vergeben; nichts unter /dev/shm (Arbeitsbestand und Zustand im eigenen tmp-Ordner).
//
// Aufruf: node pruef/laeufer.ts [--mutation-attrappe m1,m2] [--mutation-leitstand m] [--ki-spur deck/3]
//                               [--behalte] folge.jsonl ...
// Rückgabe: 0 alle grün, 1 mindestens eine rot, 2 Aufruf- oder Aufbaufehler.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { baue, liesUndDekodiere, ADRESSEN } from '../src/adressen.ts';
import { kodiere } from '../src/osc.ts';
import { REGLER } from '../src/regler_info.ts';
import { WsClient } from '../src/ws_client.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const LEITSTAND = path.resolve(HIER, '..');
const VERTRAG = path.resolve(LEITSTAND, '..', 'vertrag');
const SR = 48000;
const HAND_VORLAUF = 4800;  // FORMAT.md Punkt 5
const NACHLAUF = 9600;      // 0,2 s nach dem letzten Sample der Folge
const MELDEABSTAND = 1100;  // /e/regler kommt in Bewegung etwa alle 960 Samples
const warte = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export type Zeile = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Beobachtung {
  sample: number; osc?: [string, string, ...unknown[]]; verbindung?: string;
  ws?: { typ: string; daten: Record<string, unknown>; zeit: { sample: number; beat: number } };
}
export interface LaufOptionen { mutationAttrappe?: string[]; mutationLeitstand?: string[]; kiSpur?: string[]; behalte?: boolean; name?: string }
export interface Lauf {
  name: string; befunde: Array<[number, string, string]>; beobachtet: Beobachtung[]; regler: Map<string, Array<[number, number]>>;
  verzug: number; // größter Sendeverzug des Läufers in Samples; über 1 200 (25 ms) gilt der Lauf als unter Last
  mutationen: string[];
  leitstandStartMs: number[]; // je Start des Leitstands: Millisekunden vom Aufruf bis zur Zeile "leitstand:"
  journal: Array<Record<string, any>>; ordner: string; setId: string; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function leseFolge(datei: string): Zeile[] {
  return fs.readFileSync(datei, 'utf8').split('\n').filter((z) => z.trim()).map((z) => JSON.parse(z));
}

function freierPort(tcp: boolean): Promise<number> {
  return new Promise((ok) => {
    if (tcp) { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); }); return; }
    const s = dgram.createSocket('udp4');
    s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

function starteKind(argv: string[], bereit: RegExp, env: NodeJS.ProcessEnv): Promise<ChildProcess> {
  return new Promise((ok, nein) => {
    const k = spawn(process.execPath, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let aus = '';
    let err = '';
    k.stdout!.on('data', (d) => { aus += d; if (bereit.test(aus)) ok(k); });
    k.stderr!.on('data', (d) => { err += d; });
    k.once('exit', (c) => nein(new Error(`${path.basename(argv[0])} endete mit ${c}: ${aus}${err}`)));
  });
}

async function beende(k: ChildProcess | null, sig: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (!k || k.exitCode !== null || k.signalCode !== null) return;
  const weg = new Promise((ok) => k.once('exit', ok));
  k.kill(sig);
  await weg;
}

// Werte für Python: NaN und ±Infinity als nackte Literale, BigInt als Zahl
function pyJson(v: unknown): string {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(pyJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${pyJson(x)}`).join(',')}}`;
  return JSON.stringify(v);
}

// Wert an Sample s aus [[sample, wert], ...]: linear nur zwischen Meldungen, die höchstens MELDEABSTAND auseinander liegen
export function wertBei(r: Array<[number, number]>, s: number): number | undefined {
  let i = -1;
  for (let j = 0; j < r.length && r[j][0] <= s; j++) i = j;
  if (i < 0) return undefined;
  const [x0, w0] = r[i];
  if (x0 === s || i + 1 >= r.length || r[i + 1][0] - x0 > MELDEABSTAND) return w0;
  const [x1, w1] = r[i + 1];
  return w0 + ((w1 - w0) * (s - x0)) / (x1 - x0);
}

export async function fahre(datei: string, opt: LaufOptionen = {}): Promise<Lauf> {
  const zeilen = leseFolge(datei);
  const name = opt.name ?? path.basename(datei, '.jsonl');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), `laeufer-21-${name}-`));
  const ab = path.join(ordner, 'material');
  const r = spawnSync('python3', [path.join(VERTRAG, 'erzeuge_material.py'), '--ziel', ab], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`erzeuge_material.py: ${r.stdout}${r.stderr}`);
  const [kernPort, aboLs, aboLaeufer, wsPort] = [await freierPort(false), await freierPort(false), await freierPort(false), await freierPort(true)];
  fs.writeFileSync(path.join(ordner, 'kern.toml'), 'version = 1\npruefmodus = true\n');
  fs.writeFileSync(path.join(ordner, 'leitstand.toml'),
    `version = 1\nws_port = ${wsPort}\nabo_port = ${aboLs}\nsets = "${path.join(ordner, 'sets')}"\n`);
  const setId = '2026-09-23_2100';
  const { CYPHERDJ_INSTANZ: _i, ...env } = process.env; // Ports sind hier ausdrücklich, keine Z2-Verschiebung
  const attrArgs = [path.join(VERTRAG, 'attrappe_kern.mjs'), '--udp-port', String(kernPort), '--zustand',
    path.join(ordner, 'zustand.json'), '--arbeitsbestand', ab, '--konfig', path.join(ordner, 'kern.toml'),
    ...(opt.mutationAttrappe?.length ? ['--mutation', opt.mutationAttrappe.join(',')] : [])];
  // --kern-konfig kennt erst der Leitstand dieser Scheibe; ohne die Option fährt der Läufer auch den von Scheibe 12
  // (Fehlerfall vorher in Task 8: autonomie_1_eq ist dort rot)
  const kannKernKonfig = fs.readFileSync(path.join(LEITSTAND, 'src', 'leitstand.ts'), 'utf8').includes("'kern-konfig'");
  const lsArgs = [path.join(LEITSTAND, 'src', 'leitstand.ts'), '--konfig', path.join(ordner, 'leitstand.toml'),
    '--kern-port', String(kernPort), '--set-id', setId, ...(kannKernKonfig ? ['--kern-konfig', path.join(ordner, 'kern.toml')] : []),
    ...(opt.kiSpur?.length ? ['--ki-spur', opt.kiSpur.join(',')] : []),
    ...zeilen.filter((z) => z.t === 'notiz' && Array.isArray(z.leitstand_args)).flatMap((z) => z.leitstand_args as string[])];
  const lsEnv = { ...env, LEITSTAND_MUTATION: (opt.mutationLeitstand ?? []).join(',') };

  let attrappe: ChildProcess | null = null;
  let leitstand: ChildProcess | null = null;
  const verbindungen = new Map<string, WsClient>();
  const sock = dgram.createSocket('udp4');
  let beobachtet: Beobachtung[] = [];
  let uhr: { sample: number; mono: bigint; bpm: number } | null = null;
  let letzteUhr = 0n;
  let willkommen = false;
  let setNeu: { id: number; gestartet: boolean } | null = null;
  const B = Number(process.hrtime.bigint()); // FORMAT.md Punkt 4: Basis der Kennungen
  let verzug = 0;
  let aktionBis = -Infinity;
  const jetzt = () => (uhr ? uhr.sample + (Number(process.hrtime.bigint() - uhr.mono) * SR) / 1e9 : -Infinity);

  // Stempel wie attrappe_kern/echtzeit.mjs (Scheibe 13): /uhr trägt sein Sample; eine Meldung mit eigenem Feld sample bzw.
  // ist_sample, das nicht vor dem letzten /uhr liegt, trägt dieses Feld; jede andere gilt am Blockanfang nach dem letzten
  // /uhr. Die Attrappe rechnet einen Block an seinem Anfang und schickt seine Meldungen dann (bis 256 Samples früh).
  sock.on('message', (buf) => {
    let d;
    try { d = liesUndDekodiere(buf); } catch { return; }
    const a = ADRESSEN[d.adresse];
    const neueAchse = setNeu !== null && !setNeu.gestartet && d.adresse === '/q' && (d.felder.id as number) - B === setNeu.id && d.felder.status === 2;
    if (neueAchse) uhr = null;
    const basis = uhr ? uhr.sample : 0;
    if (d.adresse === '/uhr') { uhr = { sample: d.felder.sample as number, mono: BigInt(d.felder.mono_ns as number), bpm: d.felder.bpm as number }; letzteUhr = process.hrtime.bigint(); }
    if (d.adresse === '/k/willkommen') willkommen = true;
    const feld = a.felder.includes('ist_sample') ? 'ist_sample' : a.felder.includes('sample') ? 'sample' : null;
    const eigen = feld ? (d.felder[feld] as number) : null;
    const stempel = d.adresse === '/uhr' ? (eigen as number) : eigen !== null && eigen >= basis ? eigen : uhr ? basis + 256 : 0;
    const werte = a.felder.map((f) => (f === 'id' || f === 'ziel_id' ? (d.felder[f] as number) - B : d.felder[f]));
    beobachtet.push({ sample: stempel, osc: [d.adresse, `,${a.typen}`, ...werte] });
    if (neueAchse) {
      setNeu!.gestartet = true; // Punkt 2: Älteres gehört zur alten Zeitachse
      beobachtet = beobachtet.filter((x) => x.osc && x.osc[0] === '/q' && x.osc[2] === setNeu!.id);
    }
  });
  await new Promise<void>((ok, nein) => { sock.once('error', nein); sock.bind(aboLaeufer, '127.0.0.1', () => ok()); });
  const schicke = (buf: Buffer) => sock.send(buf, kernPort, '127.0.0.1');
  let letzterHallo = 0;
  const hallo = () => { schicke(baue('/k/hallo', { name: 'laeufer21', port: aboLaeufer, protokoll: 1 })); letzterHallo = Date.now(); };

  const starteAttrappe = async (frisch: boolean) => { attrappe = await starteKind([...attrArgs, ...(frisch ? ['--frisch'] : [])], /port=\d+/, env); };
  // ohneSetId: wie ein Neustart durch systemd, der Leitstand findet das laufende Set selbst (src/fortsetzen.ts)
  const leitstandStartMs: number[] = [];
  const starteLeitstand = async (ohneSetId = false) => {
    verbindungen.clear();
    const args = ohneSetId ? lsArgs.filter((a, i) => a !== '--set-id' && lsArgs[i - 1] !== '--set-id') : lsArgs;
    const t0 = Date.now();
    leitstand = await starteKind(args, /leitstand:/, lsEnv);
    leitstandStartMs.push(Date.now() - t0);
  };
  const verbindung = async (n: string): Promise<WsClient> => {
    const c = await WsClient.verbinde(wsPort);
    // WS-Stempel: das Spätere aus Ankunft (Kern-Uhr des Läufers) und zeit.sample des Umschlags (§9.1). Ein Ereignis trägt
    // seine Kern-Zeit, die bis 256 Samples nach der Ankunft liegen kann (die Attrappe schickt einen Block an seinem
    // Anfang); eine Antwort trägt den letzten Blockanfang vor der Anfrage und zählt deshalb ab ihrer Ankunft.
    c.bei = (e) => {
      const z = e.n.zeit?.sample;
      const stempel = Math.max(Math.floor(jetzt()), typeof z === 'number' ? z : -Infinity);
      beobachtet.push({ sample: stempel, ws: { typ: e.n.typ, daten: e.n.daten, zeit: e.n.zeit }, verbindung: n });
    };
    verbindungen.set(n, c);
    return c;
  };

  const plan: Array<{ s: number; i: number; tu: () => Promise<void> }> = [];
  zeilen.forEach((z, i) => {
    if (z.t === 'sende') {
      plan.push({ s: z.sample, i, tu: async () => {
        const [adresse, typen, ...w] = z.osc as [string, string, ...unknown[]];
        const felder = ADRESSEN[adresse].felder;
        const werte = w.map((v, j) => (felder[j] === 'id' || felder[j] === 'ziel_id' ? B + (v as number) : v === 'NaN' ? NaN : v));
        if (adresse === '/k/set/neu') setNeu = { id: w[0] as number, gestartet: false };
        schicke(kodiere(adresse, typen.slice(1), werte as never));
        if (adresse !== '/k/set/neu') return;
        const bis = Date.now() + 2000;
        while (Date.now() < bis && !setNeu!.gestartet) await warte(1);
        if (!setNeu!.gestartet) throw new Error('/k/set/neu: keine Quittung gestartet in 2 s');
        const u = letzteUhr;
        while (letzteUhr === u) await warte(1);
      } });
    } else if (z.t === 'hand') {
      plan.push({ s: z.sample - HAND_VORLAUF, i, tu: async () => { schicke(baue('/test/hand', { pfad: z.pfad, midi_roh: z.midi_roh, sample: z.sample })); } });
    } else if (z.t === 'ws_sende') {
      plan.push({ s: z.sample, i, tu: async () => {
        const n = z.verbindung ?? 'haupt';
        const c = z.typ === 'hallo' || !verbindungen.has(n) ? await verbindung(n) : verbindungen.get(n)!;
        if (z.typ === 'hallo') c.rolle = z.daten.rolle;
        c.sende(z.typ, z.daten);
      } });
    } else if (z.t === 'aktion') {
      plan.push({ s: z.sample, i, tu: async () => {
        if (z.was === 'kern_kill9') { await beende(attrappe, 'SIGKILL'); await starteAttrappe(false); }
        else if (z.was === 'leitstand_kill9') { await beende(leitstand, 'SIGKILL'); verbindungen.clear(); }
        else if (z.was === 'leitstand_start') await starteLeitstand(z.ohne_set_id === true);
        else throw new Error(`Zeile ${i + 1}: aktion ${z.was} unbekannt`);
      } });
    } else if (!['erwarte', 'erwarte_nicht', 'erlaube', 'wert', 'ws_erwarte', 'notiz'].includes(z.t)) {
      throw new Error(`Zeile ${i + 1}: Schritt-Art ${z.t} kann dieser Läufer nicht (FORMAT.md Punkt 16)`);
    }
  });
  plan.sort((a, b) => a.s - b.s || a.i - b.i);
  const ende = Math.max(0, ...zeilen.map((z) => z.sample ?? z.bis_sample ?? 0)) + NACHLAUF;

  try {
    await starteAttrappe(true);
    await starteLeitstand();
    const bis = Date.now() + 3000;
    while (!willkommen && Date.now() < bis) { if (Date.now() - letzterHallo >= 50) hallo(); await warte(1); }
    if (!willkommen) throw new Error('kein /k/willkommen von der Attrappe');
    let p = 0;
    const wandEnde = Date.now() + (ende / SR) * 1000 + 60000;
    while ((p < plan.length || jetzt() <= ende) && Date.now() < wandEnde) {
      while (p < plan.length && plan[p].s <= jetzt()) {
        // Verzug zählt nur, was der Läufer selbst verschuldet: Schritte, die während einer abgewarteten aktion fällig
        // wurden (Leitstand oder Attrappe startet), sind durch die aktion verschoben, nicht durch Last beim Läufer
        if (p > 0 && plan[p].s > aktionBis) verzug = Math.max(verzug, jetzt() - plan[p].s);
        const istAktion = zeilen[plan[p].i].t === 'aktion';
        await plan[p++].tu();
        if (istAktion) aktionBis = jetzt();
      }
      const stumm = Number(process.hrtime.bigint() - letzteUhr) / 1e6;
      if (stumm >= 100 ? Date.now() - letzterHallo >= 50 : Date.now() - letzterHallo >= 1000) hallo();
      await warte(1);
    }
    await warte(100);
  } finally {
    for (const c of verbindungen.values()) c.schliesse();
    await beende(leitstand);
    await beende(attrappe);
    sock.close();
  }

  const regler = new Map<string, Array<[number, number]>>();
  for (const m of beobachtet) {
    if (!m.osc || m.osc[0] !== '/e/regler') continue;
    const pfad = m.osc[2] as string;
    if (!regler.has(pfad)) regler.set(pfad, []);
    regler.get(pfad)!.push([Number(m.osc[5]), m.osc[3] as number]);
  }
  for (const r2 of regler.values()) r2.sort((a, b) => a[0] - b[0]);
  // nie oder erst später gemeldet: frische Attrappe, also die Vorgabe aus §1.5 (wie attrappe_kern/echtzeit.mjs)
  const werte = zeilen.filter((z) => z.t === 'wert').map((z) => {
    const r2 = regler.get(z.pfad) ?? [];
    return [z.pfad, z.sample, !r2.length || r2[0][0] > z.sample ? REGLER.get(z.pfad)?.vorgabe ?? null : wertBei(r2, z.sample)];
  }).filter((w) => w[2] !== null && w[2] !== undefined);
  const eintrag = `[{"name":${JSON.stringify(name)},"datei":${JSON.stringify(path.resolve(datei))},"auslassen":[],` +
    `"beobachtet":[${beobachtet.map((b) => pyJson({ sample: b.sample, ...(b.osc ? { osc: b.osc } : { ws: b.ws }) })).join(',')}],` +
    `"werte":${pyJson(werte)},"deck":[]}]`;
  const u = spawnSync('python3', [path.join(VERTRAG, 'attrappe_kern', 'vergleich.py')], { input: eintrag, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (u.status !== 0) throw new Error(`vergleich.py: ${u.stderr}`);
  const befunde = JSON.parse(u.stdout)[0].befunde as Array<[number, string, string]>;
  const jd = path.join(ordner, 'sets', setId, 'journal.jsonl');
  const journal = fs.existsSync(jd) ? fs.readFileSync(jd, 'utf8').split('\n').filter((z) => z.trim()).map((z) => JSON.parse(z)) : [];
  if (opt.behalte) fs.writeFileSync(path.join(ordner, 'beobachtet.jsonl'), beobachtet.map((b) => pyJson(b)).join('\n') + '\n');
  else fs.rmSync(ordner, { recursive: true, force: true });
  return { name, befunde, beobachtet, regler, journal, ordner, setId, verzug: Math.round(verzug), leitstandStartMs,
    mutationen: [...(opt.mutationAttrappe ?? []).map((m) => `attrappe:${m}`), ...(opt.mutationLeitstand ?? []).map((m) => `leitstand:${m}`)] };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'mutation-attrappe': { type: 'string' }, 'mutation-leitstand': { type: 'string' }, 'ki-spur': { type: 'string' }, behalte: { type: 'boolean' },
  } });
  if (!positionals.length) { process.stderr.write('Aufruf: node pruef/laeufer.ts [Optionen] folge.jsonl ...\n'); process.exit(2); }
  const liste = (x?: string) => (x ? x.split(',').filter(Boolean) : []);
  let rot = 0;
  for (const d of positionals) {
    const l = await fahre(d, { mutationAttrappe: liste(values['mutation-attrappe']), mutationLeitstand: liste(values['mutation-leitstand']),
      kiSpur: liste(values['ki-spur']), behalte: values.behalte });
    if (l.befunde.length) rot++;
    const last = l.verzug > 1200 ? `, UNTER LAST (Sendeverzug ${l.verzug} Samples)` : '';
    process.stdout.write(`${l.befunde.length ? 'ROT ' : 'GRÜN'} ${l.name}: ${l.befunde.length} Befunde${last}${values.behalte ? ` (Ordner ${l.ordner})` : ''}\n`);
    for (const [z, art, text] of l.befunde) process.stdout.write(`  Zeile ${z} ${art}: ${text.slice(0, 300)}\n`);
  }
  process.stdout.write(`laeufer: gefahren ${positionals.length}, grün ${positionals.length - rot}, rot ${rot}\n`);
  process.exit(rot ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: Error) => { process.stderr.write(`laeufer: ${e.message}\n`); process.exit(2); });
}
