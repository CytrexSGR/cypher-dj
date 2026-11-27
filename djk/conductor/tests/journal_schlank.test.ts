// Lean operating journal (plan 2026-11-18-lean-operating-journal, task A): the heartbeat no longer repeats the LED state,
// journalWuerdig decides what mode "schlank" writes, the resume skips lines it never reads before parsing them.
// The integration tests run a Leitstand in this process against a fake core on loopback ports of their own.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { baue, liesUndDekodiere, type Felder } from '../src/addresses.ts';
import { journalModus, journalWuerdig, resumeLiestZeile, RESUME_UEBERSPRINGT, type JournalModus } from '../src/ereignisse.ts';
import { journalZeilen } from '../src/journal.ts';
import { Leitstand } from '../src/conductor.ts';
import { jetztNs } from '../src/time.ts';
import { beende, freierTcpPort, freierUdpPort, ohneInstanz, starte, warte } from './support/process.ts';
import { annahme as welteAnnahme, welt } from './support/world.ts';

const SET = '2026-11-18_1200';
const SEK = 1e9;

// ---------- (b) journalWuerdig, table test ----------

const leer = (): Map<string, string> => new Map();
const kenntNichts = (): boolean => false;
const w = (modus: JournalModus, von: string, typ: string, daten: Record<string, unknown>, merker: Map<string, string>,
  mono = 0, kennt: (d: Record<string, unknown>) => boolean = kenntNichts): boolean =>
  journalWuerdig(modus, von, typ, daten, merker, kennt, mono);

test('mode voll: every line is journaled, also an exact repeat and the LED commands', () => {
  const m = leer();
  for (let i = 0; i < 3; i++) {
    assert.equal(w('voll', 'leitstand', '/k/led', { id: 1, quelle: 'leitstand', name: 'a', zustand: 1 }, m), true);
    assert.equal(w('voll', 'kern', '/zustand/warp', { stimmen: 0, unterlauf: 0, kein_platz: 0, spaet: 0, faeden: 0 }, m), true);
    assert.equal(w('voll', 'kern', '/q', { id: 1, quelle: 'x', status: 1, grund: '' }, m), true);
    assert.equal(w('voll', 'kern', '/erz/quittung', { strom: 1, sendung: 1, verworfen: 0, verworfen_anderes_muster: 0, eingefuegt: 0, zu_spaet: 0, ungehoert: 0 }, m), true);
  }
  assert.equal(m.size, 0, 'voll keeps no memory');
});

test('mode schlank: /k/led and /k/vorschlag_kanal sent by the leitstand are not journaled', () => {
  const m = leer();
  assert.equal(w('schlank', 'leitstand', '/k/led', { id: 1, quelle: 'leitstand', name: 'vorschlag', zustand: 2 }, m), false);
  assert.equal(w('schlank', 'leitstand', '/k/vorschlag_kanal', { id: 2, quelle: 'leitstand', kanal: 'deck/1' }, m), false);
  // negative control: the other commands of the leitstand stay
  assert.equal(w('schlank', 'leitstand', '/k/teil', { id: 3, quelle: 'cypher' }, m), true);
  assert.equal(w('schlank', 'leitstand', '/k/ki/stufe', { id: 4, quelle: 'leitstand', stufe: 1 }, m), true);
});

test('mode schlank: /k/hallo and /k/willkommen only on a new generation or after 60 s', () => {
  const m = leer();
  const will = (g: number) => ({ protokoll: 1, generation: g, sample: 0, beat: 0, bpm: 128, kern_version: 'x' });
  assert.equal(w('schlank', 'kern', '/k/willkommen', will(0), m, 0), true);          // baseline
  assert.equal(w('schlank', 'kern', '/k/willkommen', will(0), m, 1.5 * SEK), false);  // heartbeat answer
  assert.equal(w('schlank', 'kern', '/k/willkommen', will(0), m, 59 * SEK), false);
  assert.equal(w('schlank', 'kern', '/k/willkommen', will(1), m, 60 * SEK), true);    // new generation
  assert.equal(w('schlank', 'kern', '/k/willkommen', will(1), m, 61 * SEK), false);
  assert.equal(w('schlank', 'kern', '/k/willkommen', will(1), m, 120.5 * SEK), true); // older than 60 s since the last journaled one
  assert.equal(w('schlank', 'kern', '/k/willkommen', will(1), m, 121 * SEK), false);
  // /k/hallo has no generation: first line, then once per 60 s; the memory of the two types is separate
  const hallo = { name: 'leitstand', port: 47110, protokoll: 1 };
  assert.equal(w('schlank', 'leitstand', '/k/hallo', hallo, m, 130 * SEK), true);
  assert.equal(w('schlank', 'leitstand', '/k/hallo', hallo, m, 131.5 * SEK), false);
  assert.equal(w('schlank', 'leitstand', '/k/hallo', hallo, m, 191 * SEK), true);
});

test('mode schlank: /q from the core is journaled for status 4 to 8, with a reason, or for a known receipt', () => {
  const m = leer();
  const q = (status: number, grund = '', id = 7, quelle = 'spieler') => ({ id, quelle, status, ist_sample: 0, ist_beat: 0, grund });
  for (const s of [1, 2, 3]) assert.equal(w('schlank', 'kern', '/q', q(s), m), false, `status ${s}`);
  for (const s of [4, 5, 6, 7, 8]) assert.equal(w('schlank', 'kern', '/q', q(s), m), true, `status ${s}`);
  assert.equal(w('schlank', 'kern', '/q', q(3, 'neustart'), m), true, 'a reason');
  const kennt = (d: Record<string, unknown>) => d.quelle === 'cypher' && d.id === 42;
  assert.equal(w('schlank', 'kern', '/q', q(2, '', 42, 'cypher'), m, 0, kennt), true, 'receipt of a plan part');
  assert.equal(w('schlank', 'kern', '/q', q(2, '', 43, 'cypher'), m, 0, kennt), false, 'another id of the same sender');
  // /q/stand and the other lines of the leitstand are not touched by this rule
  assert.equal(w('schlank', 'kern', '/q/stand', q(3), m), true);
});

test('mode schlank: /erz/quittung only when verworfen, verworfen_anderes_muster, zu_spaet or ungehoert is not 0', () => {
  const m = leer();
  const e = (o: Record<string, number> = {}) => ({ strom: 1, sendung: 9, verworfen: 0, verworfen_anderes_muster: 0, eingefuegt: 0, zu_spaet: 0, ungehoert: 0, ...o });
  assert.equal(w('schlank', 'kern', '/erz/quittung', e(), m), false);
  for (const f of ['verworfen', 'verworfen_anderes_muster', 'zu_spaet', 'ungehoert']) {
    assert.equal(w('schlank', 'kern', '/erz/quittung', e({ [f]: 1 }), m), true, f);
  }
  assert.equal(w('schlank', 'kern', '/erz/quittung', e({ eingefuegt: 5 }), m), false, 'eingefuegt is not a loss counter');
});

test('mode schlank: status lines only when the data differ from the last journaled line of the type, ignored fields left out', () => {
  const m = leer();
  const arr = (o: Record<string, number> = {}) => ({ nr: 1, status: 2, loop_an: 0, projekt_beat: 10, ursprung_sample: 0, start_beat: 0, metronom_an: 0, limiter_db: 0, ...o });
  assert.equal(w('schlank', 'kern', '/zustand/arr', arr(), m), true);                          // first line
  assert.equal(w('schlank', 'kern', '/zustand/arr', arr(), m), false);                         // identical
  assert.equal(w('schlank', 'kern', '/zustand/arr', arr({ projekt_beat: 99 }), m), false);     // only the ignored field
  assert.equal(w('schlank', 'kern', '/zustand/arr', arr({ status: 3 }), m), true);             // a change
  assert.equal(w('schlank', 'kern', '/zustand/arr', arr({ status: 3, projekt_beat: 5 }), m), false);
  assert.equal(w('schlank', 'kern', '/zustand/arr', arr({ status: 2, projekt_beat: 6 }), m), true); // against the last JOURNALED line (3), not the last seen
  // the types do not share a memory
  const warp = { stimmen: 1, unterlauf: 0, kein_platz: 0, spaet: 0, faeden: 2 };
  assert.equal(w('schlank', 'kern', '/zustand/warp', warp, m), true);
  assert.equal(w('schlank', 'kern', '/zustand/warp', { ...warp }, m), false);
  assert.equal(w('schlank', 'kern', '/zustand/warp', { ...warp, faeden: 3 }, m), true);
  const rec = (o: Record<string, number> = {}) => ({ status: 0, kennung: 0, scharf: 0, luecken: 0, projekt_beat: 1, ausgang_vorhalt: 0, quantum: 0, rec_midi_scharf: 0, ...o });
  assert.equal(w('schlank', 'kern', '/zustand/rec', rec(), m), true);
  assert.equal(w('schlank', 'kern', '/zustand/rec', rec({ projekt_beat: 2 }), m), false);
  assert.equal(w('schlank', 'kern', '/zustand/rec', rec({ luecken: 1 }), m), true);
  const pool = (o: Record<string, number> = {}) => ({ an: 1, modus: 1, blocks_parallel: 1, einheiten_worker: 1, einheiten_caller: 1, seriell_summe: 1, haengt: 0, spaet: 0, zurueck: 0, ...o });
  assert.equal(w('schlank', 'kern', '/zustand/spur_pool', pool(), m), true);
  for (const f of ['blocks_parallel', 'einheiten_worker', 'einheiten_caller', 'seriell_summe', 'zurueck']) {
    assert.equal(w('schlank', 'kern', '/zustand/spur_pool', pool({ [f]: 77 }), m), false, `${f} is ignored`);
  }
  assert.equal(w('schlank', 'kern', '/zustand/spur_pool', pool({ spaet: 1 }), m), true, 'spaet is compared');
  assert.equal(w('schlank', 'kern', '/zustand/spur_pool', pool({ haengt: 1, spaet: 1 }), m), true, 'haengt is compared');
  const hall = { an: 1, faeden: 2, spaet: 0, zurueck: 0 };
  assert.equal(w('schlank', 'kern', '/zustand/hall_pool', hall, m), true);
  assert.equal(w('schlank', 'kern', '/zustand/hall_pool', { ...hall }, m), false);
  assert.equal(w('schlank', 'kern', '/zustand/hall_pool', { ...hall, zurueck: 4 }, m), true, 'zurueck of hall_pool is compared');
  const ins = { h_1: 1, gesund_1: 1, rundweg_1: 5, h_2: 2, gesund_2: 1, rundweg_2: 5, h_3: 3, gesund_3: 1, rundweg_3: 5, h_4: 4, gesund_4: 1, rundweg_4: 5, h_5: 5, gesund_5: 1, rundweg_5: 5, h_6: 6, gesund_6: 1, rundweg_6: 5, h_7: 7, gesund_7: 1, rundweg_7: 5, h_8: 8, gesund_8: 1, rundweg_8: 5 };
  assert.equal(w('schlank', 'kern', '/zustand/ins_host', ins, m), true);
  assert.equal(w('schlank', 'kern', '/zustand/ins_host', { ...ins }, m), false);
  assert.equal(w('schlank', 'kern', '/zustand/ins_host', { ...ins, gesund_3: 0 }, m), true);
  const nb = (o: Record<string, number> = {}) => ({ zustand: 0, takte_in_schleife: 0, generation_gesehen: 1, w: 100, ...o });
  const m2 = leer();
  assert.equal(w('schlank', 'notbahn', '/nb', nb(), m2), true);
  assert.equal(w('schlank', 'notbahn', '/nb', nb({ w: 101 }), m2), false);
  assert.equal(w('schlank', 'notbahn', '/nb', nb({ zustand: 1 }), m2), true);
});

test('mode schlank: everything else is journaled', () => {
  const m = leer();
  for (const [von, typ] of [['kern', '/e/luecke'], ['kern', '/e/regler'], ['kern', '/takt'], ['kern', '/e/protokollfehler'], ['leitstand', 'plan_eingereicht'],
    ['leitstand', 'teil_gesendet'], ['spieler', 'rpc'], ['leitstand', 'kern_weg'], ['leitstand', 'osc_unlesbar']]) {
    assert.equal(w('schlank', von, typ, { a: 1 }, m), true, typ);
    assert.equal(w('schlank', von, typ, { a: 1 }, m), true, `${typ} repeated`);
  }
});

test('journalModus: the option wins over the config key, absent means voll, another value names the allowed ones', () => {
  assert.equal(journalModus(undefined, undefined), 'voll');
  assert.equal(journalModus(undefined, 'schlank'), 'schlank');
  assert.equal(journalModus('voll', 'schlank'), 'voll');
  assert.equal(journalModus('schlank', 'voll'), 'schlank');
  assert.throws(() => journalModus('x', undefined), /--journal.*"x".*voll.*schlank/s);
  assert.throws(() => journalModus(undefined, 'kurz'), /journal.*"kurz".*voll.*schlank/s);
});

// ---------- (e) journalZeilen with a raw predicate ----------

const tmpOrdner = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'ls-schlank-'));

test('journalZeilen: the raw predicate skips before parsing; a skipped line that is not valid JSON is no problem, a half last line neither', () => {
  const d = tmpOrdner();
  const p = path.join(d, 'journal.jsonl');
  const z = (typ: string, daten: Record<string, unknown> = {}) =>
    JSON.stringify({ sample: 1, beat: 0, takt: 1, mono_ns: 5, von: 'kern', typ, daten });
  fs.writeFileSync(p, [
    z('set_start'), z('/k/led', { name: 'a' }), '{"typ":"/k/led", kaputt', z('/q', { id: 1 }), '', 'not json at all',
    z('/zustand/warp'), z('/e/luecke', { frames: 1 }), z('/takt'),
  ].join('\n') + '\n{"sample":1,"beat":0,"typ":"/e/neust');  // half written last line
  const gesehen: string[] = [];
  const original = JSON.parse;
  let parsed = 0;
  JSON.parse = ((...a: Parameters<typeof JSON.parse>) => { parsed++; return original(...a); }) as typeof JSON.parse;
  let typen: string[];
  try {
    typen = [...journalZeilen(p, undefined, (zeile) => { gesehen.push(zeile.slice(0, 20)); return !/"typ":"\/(k\/led|zustand\/warp|takt)"/.test(zeile); })].map((x) => x.typ);
  } finally { JSON.parse = original; }
  assert.deepEqual(typen, ['set_start', '/q', '/e/luecke']);
  // parsed: only the lines the predicate let through (set_start, the broken "not json", /q, /e/luecke, the half line); never the skipped ones
  assert.equal(parsed, 5, 'JSON.parse ran only for kept lines');
  assert.ok(gesehen.length >= 8, 'the predicate saw every non-empty line');
  // without the predicate the same file gives the full list (negative control)
  assert.deepEqual([...journalZeilen(p)].map((x) => x.typ), ['set_start', '/k/led', '/q', '/zustand/warp', '/e/luecke', '/takt']);
});

test('resumeLiestZeile matches the typ field only, not a text inside daten', () => {
  const kopf = '{"sample":1,"beat":0,"takt":1,"mono_ns":5,"von":"leitstand",';
  assert.equal(resumeLiestZeile(`${kopf}"typ":"/k/led","daten":{"name":"a"}}`), false);
  assert.equal(resumeLiestZeile(`${kopf}"typ":"/q","daten":{"id":1}}`), true);
  // a hand typed key typ inside daten, or a string that contains the pattern, must not hide a line
  assert.equal(resumeLiestZeile(`${kopf}"typ":"plan_eingereicht","daten":{"typ":"/k/led"}}`), true);
  assert.equal(resumeLiestZeile(`${kopf}"typ":"hoerschein","daten":{"name":"\\"typ\\":\\"/k/led\\""}}`), true);
  assert.equal(resumeLiestZeile(`${kopf}"typ":"/q/stand","daten":{}}`), true);
  assert.equal(resumeLiestZeile(`${kopf}"typ":"/k/willkommen","daten":{"generation":3}}`), true);
  assert.equal(resumeLiestZeile(`${kopf}"typ":"/e/neustart","daten":{"generation":3}}`), true);
  assert.equal(resumeLiestZeile('not json'), true);                       // what we cannot place stays parsed
  for (const t of RESUME_UEBERSPRINGT) assert.equal(resumeLiestZeile(`${kopf}"typ":"${t}","daten":{}}`), false, t);
  assert.deepEqual([...RESUME_UEBERSPRINGT].sort(), ['/erz/quittung', '/k/hallo', '/k/led', '/nb', '/takt', '/zustand/arr', '/zustand/hall_pool',
    '/zustand/ins_host', '/zustand/rec', '/zustand/spur_pool', '/zustand/warp']);
});

test('the resume with the raw predicate equals the resume without it on a journal that holds every skipped type', () => {
  const quelle = welt();
  const a0 = welteAnnahme(quelle, 1);
  const zeilen: Array<Record<string, unknown>> = [];
  const mach = (von: string, typ: string, daten: Record<string, unknown>) =>
    zeilen.push({ sample: 0, beat: 0, takt: 1, mono_ns: zeilen.length + 1, von, typ, daten });
  mach('leitstand', 'set_start', { set_id: SET, generation: 0, vertrag: 1, konfiguration: {} });
  mach('kern', '/e/regler', { pfad: 'pad/1/fader', wert: -6, halter: 'frei', sample: 0, beat: 0 });
  const e = a0.einreichen({ grund: 'leiser', teile: [{ regler: 'pad/1/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -20 }] });
  assert.equal(e.status, 'angenommen');
  for (const j of quelle.journal) mach(j.von, j.typ, j.daten);
  const id = quelle.gesendet.find((g) => g.adresse === '/k/teil')!.felder.id as number;
  const skipped = [...RESUME_UEBERSPRINGT];
  for (const status of [1, 2, 3]) {
    for (const t of skipped) mach('kern', t, { x: status });
    mach('kern', '/q', { id, quelle: 'cypher', status, ist_sample: 0, ist_beat: 33, grund: '' });
  }
  mach('kern', '/e/luecke', { sample: 1, frames: 2, zyklen: 1 });
  const p = path.join(tmpOrdner(), 'journal.jsonl');
  fs.writeFileSync(p, zeilen.map((z) => JSON.stringify(z)).join('\n') + '\n');
  const lies = (mitPraedikat: boolean): string => {
    const wk = welt();
    const a = welteAnnahme(wk, 1);
    const n = a.wiederaufnehmen(journalZeilen(p, undefined, mitPraedikat ? resumeLiestZeile : undefined));
    const plaene = [...a.plaene.values()].map((ps) => [ps.plan.id, ps.status, [...ps.teile.values()]]);
    return JSON.stringify({ n, plaene, offen: a.offeneTeile(), stufe: a.stufe, wert: a.spiegel.wert('pad/1/fader'), ki: a.spiegel.kiGestoppt,
      journal: wk.journal.map((x) => x.typ) });
  };
  const voll = lies(false);
  assert.equal(lies(true), voll);
  assert.match(voll, /"fertig"/);   // the plan part finished: the receipts were consumed in both runs
});

// ---------- fake core and Leitstand in this process ----------

class FalscherKern {
  readonly sock = dgram.createSocket('udp4');
  erhalten: Array<{ adresse: string; felder: Felder }> = [];
  abo: number | null = null;
  generation = 0;
  still = false;               // the core is gone: no answers, no /uhr
  quittiert = true;            // answers /k/teil with /q 1 and /q 3
  private readonly t0 = jetztNs();
  private timer: NodeJS.Timeout | null = null;

  readonly port: number;
  constructor(port: number) { this.port = port; }

  async starte(): Promise<void> {
    this.sock.on('message', (buf) => this.ein(buf));
    await new Promise<void>((ok) => this.sock.bind(this.port, '127.0.0.1', () => ok()));
    this.timer = setInterval(() => this.uhr(), 20);
  }

  private uhr(): void {
    if (this.abo === null || this.still) return;
    const dt = jetztNs() - this.t0;
    const beat = (dt * 128) / 60e9;
    this.sende('/uhr', { sample: Math.round((dt * 48000) / 1e9), mono_ns: jetztNs(), beat, bpm: 128, bpm_pro_s: 0 });
  }

  sende(adresse: string, felder: Felder): void {
    if (this.abo !== null) this.sock.send(baue(adresse, felder), this.abo, '127.0.0.1');
  }

  willkommen(generation = this.generation): void {
    this.sende('/k/willkommen', { protokoll: 1, generation, sample: 0, beat: 0, bpm: 128, kern_version: 'fake' });
  }

  private ein(buf: Buffer): void {
    const d = liesUndDekodiere(buf);
    this.erhalten.push({ adresse: d.adresse, felder: d.felder });
    if (this.still) return;
    if (d.adresse === '/k/hallo') { this.abo = d.felder.port as number; this.willkommen(); }
    if (d.adresse === '/k/teil' && this.quittiert) {
      for (const status of [1, 3]) {
        this.sende('/q', { id: d.felder.id, quelle: d.felder.quelle, status, ist_sample: 0, ist_beat: 1, grund: '' });
      }
    }
  }

  zaehle(adresse: string): number { return this.erhalten.filter((e) => e.adresse === adresse).length; }

  async schliesse(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await new Promise<void>((ok) => this.sock.close(() => ok()));
  }
}

async function bis(bedingung: () => boolean, ms = 5000, was = 'condition'): Promise<void> {
  const ende = Date.now() + ms;
  while (!bedingung()) {
    if (Date.now() > ende) throw new Error(`timeout waiting for ${was}`);
    await warte(10);
  }
}

interface Aufbau { dir: string; kern: FalscherKern; konfig: string; kernToml: string; ws: number; abo: number }

async function aufbau(): Promise<Aufbau> {
  const dir = tmpOrdner();
  const [kernPort, ws, abo] = [await freierUdpPort(), await freierTcpPort(), await freierUdpPort()];
  const konfig = path.join(dir, 'leitstand.toml');
  fs.writeFileSync(konfig, `version = 1\nws_port = ${ws}\nabo_port = ${abo}\nsets = "${dir}/sets"\n`);
  const kernToml = path.join(dir, 'kern.toml');
  fs.writeFileSync(kernToml, 'version = 1\n');
  const kern = new FalscherKern(kernPort);
  await kern.starte();
  return { dir, kern, konfig, kernToml, ws, abo };
}

function leitstand(a: Aufbau, journal?: JournalModus, setId = SET): Leitstand {
  return new Leitstand({
    konfigPfad: a.konfig, kernPort: a.kern.port, setId, env: ohneInstanz(), kiSpur: ['pad/1'], kernKonfig: a.kernToml, journal,
  });
}

const journalDatei = (a: Aufbau) => path.join(a.dir, 'sets', SET, 'journal.jsonl');
const journalLesen = (a: Aufbau): Array<{ typ: string; von: string; daten: Record<string, unknown> }> =>
  fs.readFileSync(journalDatei(a), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// ---------- (a) heartbeat ----------

test('heartbeat answers in one generation send no LED commands again; a new generation and a reconnect after a lost core do', { timeout: 20000 }, async () => {
  const a = await aufbau();
  const l = leitstand(a);
  try {
    await l.starte();
    await bis(() => l.kern.zustand === 'verbunden' && a.kern.zaehle('/k/led') > 0, 5000, 'first connection');
    await warte(300);   // the first /uhr ticks add the hearing-ticket LEDs
    const n1 = a.kern.zaehle('/k/led');
    const ki1 = a.kern.zaehle('/k/ki/spur');
    assert.ok(n1 >= 6, `LED commands after the first connection: ${n1}`);
    assert.equal(ki1, 1);
    // three heartbeat answers in the same generation while connected
    for (let i = 0; i < 3; i++) { a.kern.willkommen(); await warte(30); }
    await warte(150);
    assert.equal(a.kern.zaehle('/k/led'), n1, 'no LED command again');
    assert.equal(a.kern.zaehle('/k/ki/spur'), ki1);
    assert.equal(a.kern.zaehle('/k/ki/stufe'), 1);
    // a new generation: the full state once
    a.kern.generation = 1;
    a.kern.willkommen();
    await warte(300);
    assert.equal(a.kern.zaehle('/k/led'), 2 * n1, 'new generation: all LED commands once more');
    assert.equal(a.kern.zaehle('/k/ki/spur'), 2);
    a.kern.willkommen();
    await warte(150);
    assert.equal(a.kern.zaehle('/k/led'), 2 * n1, 'and then silence again');
    // lost core: no answers and no /uhr until the watcher says suche, then the core is back in the same generation
    a.kern.still = true;
    await bis(() => l.kern.zustand === 'suche', 3000, 'suche');
    a.kern.still = false;
    await bis(() => l.kern.zustand === 'verbunden', 3000, 'verbunden again');
    await warte(300);
    assert.equal(a.kern.zaehle('/k/led'), 3 * n1, 'reconnect after a lost core: all LED commands once more');
    assert.equal(a.kern.zaehle('/k/ki/spur'), 3);
    // the proposal and the plan LED still follow their own changes (kept correct without the repetition): a change sends
    const vorher = a.kern.zaehle('/k/led');
    l.annahme.setzeStufe(2);
    await warte(100);
    assert.equal(a.kern.zaehle('/k/led') - vorher, 2, 'autonomy LED 1 off, 2 on');
  } finally {
    await l.stoppe();
    await a.kern.schliesse();
  }
});

test('/e/neustart with a new generation and the willkommen that follows send the LED state once together', { timeout: 20000 }, async () => {
  const a = await aufbau();
  const l = leitstand(a);
  try {
    await l.starte();
    await bis(() => l.kern.zustand === 'verbunden' && a.kern.zaehle('/k/led') > 0);
    await warte(300);
    const n1 = a.kern.zaehle('/k/led');
    a.kern.generation = 1;
    a.kern.sende('/e/neustart', { generation: 1, sample: 0 });
    a.kern.willkommen();
    await warte(300);
    assert.equal(a.kern.zaehle('/k/led'), 2 * n1);
    assert.equal(a.kern.zaehle('/k/ki/spur'), 2);
  } finally {
    await l.stoppe();
    await a.kern.schliesse();
  }
});

// ---------- (c), (d), (f) leitstand in mode schlank ----------

test('mode schlank: refusals and late executions of any sender, receipts of an own plan part and the baseline are journaled; the rest is not; the plan part survives a restart', { timeout: 30000 }, async () => {
  const a = await aufbau();
  const l1 = leitstand(a, 'schlank');
  let l2: Leitstand | null = null;
  const warp = { stimmen: 1, unterlauf: 0, kein_platz: 0, spaet: 0, faeden: 2 };
  try {
    try {
      await l1.starte();
      await bis(() => l1.kern.zustand === 'verbunden' && a.kern.zaehle('/k/led') > 0);
      a.kern.sende('/e/regler', { pfad: 'pad/1/fader', wert: -6, halter: 'frei', sample: 0, beat: 0 });
      await warte(100);
      const e = l1.annahme.einreichen({ grund: 'leiser', teile: [{ regler: 'pad/1/fader', art: 'rampe', ab_takt: 400, dauer_takte: 2, nach: -20 }] });
      assert.equal(e.status, 'angenommen');
      await bis(() => l1.annahme.plaene.get(e.plan_id)?.status === 'fertig', 5000, 'plan part finished');
      // foreign senders (the player, the work bench): accepted, started, finished are silent; refused or late are not
      const fremd = (id: number, status: number, grund = '', quelle = 'spieler') =>
        a.kern.sende('/q', { id, quelle, status, ist_sample: 0, ist_beat: 1, grund });
      fremd(900, 1); fremd(900, 2); fremd(900, 3);
      fremd(901, 4, 'verriegelt'); fremd(902, 5); fremd(903, 8, 'storniert', 'werkstatt'); fremd(904, 6, 'abgelehnt'); fremd(905, 7, 'abgebrochen');
      // status lines: three identical /zustand/warp, then a change
      for (let i = 0; i < 3; i++) a.kern.sende('/zustand/warp', warp);
      a.kern.sende('/zustand/warp', { ...warp, faeden: 3 });
      a.kern.sende('/erz/quittung', { strom: 1, sendung: 1, verworfen: 0, verworfen_anderes_muster: 0, eingefuegt: 0, zu_spaet: 0, ungehoert: 0 });
      a.kern.sende('/erz/quittung', { strom: 1, sendung: 2, verworfen: 0, verworfen_anderes_muster: 0, eingefuegt: 0, zu_spaet: 1, ungehoert: 0 });
      await warte(400);
      for (let i = 0; i < 3; i++) { a.kern.willkommen(); await warte(20); }
      await warte(200);
    } finally {
      await l1.stoppe();
     }
    const j1 = journalLesen(a);
    const typen = (t: string) => j1.filter((z) => z.typ === t);
    assert.equal(j1[0].typ, 'set_start');
    assert.equal(j1[0].daten.journal, 'schlank', 'set_start carries the mode');
    assert.equal(typen('/k/led').length, 0, 'no LED command in the journal');
    assert.equal(typen('/k/vorschlag_kanal').length, 0);
    assert.ok(a.kern.zaehle('/k/led') > 0, 'but the core did get them');
    // /q: own plan part 1 and 3 in, the foreign accepted/started/finished (id 900) out, the refusals and the late execution in
    const q = typen('/q').map((z) => `${z.daten.quelle}:${z.daten.id}:${z.daten.status}`);
    assert.ok(!q.some((s) => s.startsWith('spieler:900:')), `foreign accepted receipts are not journaled: ${q}`);
    for (const s of ['spieler:901:4', 'spieler:902:5', 'werkstatt:903:8', 'spieler:904:6', 'spieler:905:7']) assert.ok(q.includes(s), `${s} in ${q}`);
    assert.equal(q.filter((s) => s.startsWith('cypher:')).length, 2, `receipts of the own plan part: ${q}`);
    // status lines: baseline, then the change; the identical repeats are out
    assert.deepEqual(typen('/zustand/warp').map((z) => z.daten.faeden), [2, 3]);
    assert.equal(typen('/erz/quittung').length, 1, 'only the one with a loss counter');
    assert.equal(typen('/erz/quittung')[0].daten.zu_spaet, 1);
    // heartbeat lines: the baseline of the generation only
    assert.equal(typen('/k/willkommen').length, 1);
    // restart on the same set: the finished plan part is finished after the resume
    try {
      l2 = leitstand(a, 'schlank');
      await l2.starte();
      const ps = l2.annahme.plaene.get('p1');
      assert.ok(ps, 'plan p1 was taken over');
      assert.equal(ps.status, 'fertig');
      assert.deepEqual([...ps.teile.values()].map((t) => t.status), ['fertig']);
      assert.equal(l2.annahme.offeneTeile().length, 0);
      // baseline after restart: the first /zustand/warp of the new process is written even though it equals the old last line
      await bis(() => l2!.kern.zustand === 'verbunden');
      a.kern.sende('/zustand/warp', { ...warp, faeden: 3 });
      a.kern.sende('/zustand/warp', { ...warp, faeden: 3 });
      await warte(300);
    } finally {
      if (l2) await l2.stoppe();
    }
    const j2 = journalLesen(a);
    assert.deepEqual(j2.filter((z) => z.typ === '/zustand/warp').map((z) => z.daten.faeden), [2, 3, 3], 'baseline after the restart');
    const fort = j2.filter((z) => z.typ === 'fortsetzung');
    assert.equal(fort.length, 1);
    assert.equal(fort[0].daten.journal, 'schlank', 'fortsetzung carries the mode');
  } finally {
    await a.kern.schliesse();
  }
});

test('mode voll (default): the full lines as before, set_start says voll, the receipts of a foreign command are journaled', { timeout: 20000 }, async () => {
  const a = await aufbau();
  const l = leitstand(a);   // no option, no config key: voll
  try {
    await l.starte();
    await bis(() => l.kern.zustand === 'verbunden' && a.kern.zaehle('/k/led') > 0);
    await warte(300);
    const warp = { stimmen: 1, unterlauf: 0, kein_platz: 0, spaet: 0, faeden: 2 };
    for (let i = 0; i < 3; i++) a.kern.sende('/zustand/warp', warp);
    a.kern.sende('/q', { id: 900, quelle: 'spieler', status: 1, ist_sample: 0, ist_beat: 1, grund: '' });
    a.kern.sende('/erz/quittung', { strom: 1, sendung: 1, verworfen: 0, verworfen_anderes_muster: 0, eingefuegt: 0, zu_spaet: 0, ungehoert: 0 });
    await warte(300);
  } finally {
    await l.stoppe();
    await a.kern.schliesse();
  }
  const j = journalLesen(a);
  assert.equal(j[0].daten.journal, 'voll');
  assert.equal(j.filter((z) => z.typ === '/zustand/warp').length, 3);
  assert.equal(j.filter((z) => z.typ === '/q' && z.daten.id === 900).length, 1);
  assert.equal(j.filter((z) => z.typ === '/erz/quittung').length, 1);
  // every LED command that went to the core is in the journal (once, as before) and so is each /k/ki/stufe
  assert.equal(j.filter((z) => z.typ === '/k/led').length, a.kern.zaehle('/k/led'));
  assert.equal(j.filter((z) => z.typ === '/k/ki/stufe').length, 1);
});

// ---------- (f) command line ----------

test('--journal with another value is a start error that names the allowed values; no port is bound', { timeout: 15000 }, async () => {
  const a = await aufbau();
  await a.kern.schliesse();
  await assert.rejects(
    starte('src/conductor.ts', ['--konfig', a.konfig, '--kern-port', String(a.kern.port), '--set-id', SET, '--kern-konfig', a.kernToml, '--journal', 'x'], 'leitstand:'),
    /endete mit 2: .*journal.*"x".*voll.*schlank/s);
  assert.equal(fs.existsSync(journalDatei(a)), false);
});

test('--journal schlank starts; the printed start line and the journal carry the mode', { timeout: 15000 }, async () => {
  const a = await aufbau();
  const k = await starte('src/conductor.ts', ['--konfig', a.konfig, '--kern-port', String(a.kern.port), '--set-id', SET, '--kern-konfig', a.kernToml, '--journal', 'schlank'], 'leitstand:');
  try {
    await bis(() => fs.existsSync(journalDatei(a)), 5000, 'journal file');
    assert.equal(journalLesen(a)[0].daten.journal, 'schlank');
  } finally {
    await beende(k, 'SIGTERM');
    await a.kern.schliesse();
  }
});
