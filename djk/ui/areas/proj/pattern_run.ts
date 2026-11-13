// strudel-clip: runs the Strudel side (generator/pattern-clip.mjs) in a child process so that no pattern can hold the server.
//
// The server thread NEVER waits for a pattern: the translation is asynchronous (`vorlauf`), every outcome (answer, time limit, crash, memory kill)
// is cached by {code, takte}, and the synchronous command only READS the cache (`ausCache`). The caller (session.ts) fills the cache before the
// command runs and repeats until the command finds everything it asks for.
//
// Limits of the child, and what they cover (measured, see docs/superpowers/specs/2026-11-10-strudel-clip.md):
//   - node --permission: no writing, reading only djk and Strudel, no child process, no worker
//   - environment: empty except STRUDEL_PAKETE (no tokens of the server)
//   - time: 5 s wall clock, then SIGKILL
//   - memory: V8 heap 384 MB (--max-old-space-size) AND a watcher that reads VmRSS of the child every 20 ms and kills it above 640 MB (the heap
//     flag does not cover ArrayBuffers: new Uint8Array(2e9).fill(7) takes 2 GB of RSS in 0.6 s); a kill by the watcher overshoots by what one tick
//     allocates (about 100 MB measured). RLIMIT_AS cannot be used: node needs more than 8 GB of address space to start (wasm).
//   - parallelism: at most MUSTER_KINDER_MAX children at a time, the rest waits; the same pattern asked twice at once runs once
//   - network: the child runs in its own empty network namespace (`bwrap --unshare-net`, no route, its own loopback): a pattern that imports
//     node:http or node:net reaches nothing, neither the studio API on 127.0.0.1 nor the internet. node --permission itself has no network switch in
//     Node 22 and plain unshare is refused here, but bwrap is allowed by the AppArmor profile. The child also deletes fetch/WebSocket/process.getBuiltinModule.
//     Without a usable bwrap (probe at the first use) the child runs as before WITHOUT the network lock; `netzsperre()` says which one it is and a
//     line goes to stderr once. The watcher below reads the memory of the whole process tree, since bwrap is the parent of node.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strudelPakete } from '../../paths.ts';
import type { MusterErgebnis, MusterFehlschlag } from '../../project/pattern_clip.ts';

export const MUSTER_ZEITLIMIT_MS = 5000;
export const MUSTER_KINDER_MAX = 2;
export const MUSTER_HEAP_MB = 384;
export const MUSTER_RSS_MAX_KB = 640 * 1024;
export const MUSTER_RSS_TAKT_MS = 20;
const DJK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKRIPT = path.join(DJK, 'generator', 'pattern-clip.mjs');
const MARKE = 'MUSTER-CLIP ';
const MAX_AUSGABE = 64 * 1024 * 1024;
const MAX_EREIGNISSE_ANTWORT = 20000;
export type Anfrage = { code: string; takte: number | null };
export type Antwort = MusterErgebnis | MusterFehlschlag;

/** what the tests (and nobody else) read: the highest RSS the watcher saw, the most children alive at once */
export const messung = { spitzeKB: 0, kinderMax: 0 };

const cache = new Map<string, Antwort>();
const unterwegs = new Map<string, Promise<void>>();
const lebende = new Set<{ kill: (s: NodeJS.Signals) => boolean }>();
const schluessel = (a: Anfrage): string => JSON.stringify([a.code, a.takte]);
const merke = (a: Anfrage, r: Antwort): void => {
  if (cache.size >= 64) cache.delete(cache.keys().next().value as string);
  cache.set(schluessel(a), r);
};
process.once('exit', () => { for (const k of lebende) k.kill('SIGKILL'); });

const BWRAP_PROG = '/usr/bin/bwrap';
const BWRAP = ['--unshare-net', '--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'];
let sperreStand: boolean | null = null;
/** true when the children run in an empty network namespace (probed once with bwrap; MUSTER_OHNE_NETZSPERRE=1 switches it off, tests only) */
export function netzsperre(): boolean {
  if (sperreStand !== null) return sperreStand;
  let ok = false;
  if (process.env.MUSTER_OHNE_NETZSPERRE !== '1') {
    try { ok = spawnSync(BWRAP_PROG, [...BWRAP, 'true'], { timeout: 5000, stdio: 'ignore' }).status === 0; } catch { ok = false; }
  }
  if (!ok) process.stderr.write('muster_lauf: no network lock for the pattern child (bwrap unusable): a pattern could reach the network\n');
  sperreStand = ok;
  return ok;
}

const argumente = (): string[] => [
  `--max-old-space-size=${MUSTER_HEAP_MB}`, '--permission', `--allow-fs-read=${DJK}`, `--allow-fs-read=${path.dirname(strudelPakete())}`, SKRIPT,
];
// nothing of the server's environment: tokens and paths stay out of reach of a pattern
const umgebung = (): NodeJS.ProcessEnv => ({ STRUDEL_PAKETE: strudelPakete(), LANG: 'C.UTF-8' });

const ablehnung = (grund: string, fehler: string): MusterFehlschlag => ({ ok: false, grund, fehler: `Zeile 1: ${fehler}` });
const zeitlimit = (): Antwort => ablehnung('muster_zeitlimit', `the pattern took longer than ${MUSTER_ZEITLIMIT_MS / 1000} s to evaluate`);
const zuViel = (): Antwort => ablehnung('muster_zu_gross',
  `the pattern needs more memory than allowed (${Math.round(MUSTER_RSS_MAX_KB / 1024)} MB): make it smaller`);

const zahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const texte = (x: unknown): x is string[] => Array.isArray(x) && x.every((t) => typeof t === 'string');
/** The answer of the child is data from a process that ran foreign code: shape and types are checked before anything else sees it. */
export function pruefeAntwort(x: unknown): Antwort | null {
  if (x === null || typeof x !== 'object') return null;
  const a = x as Record<string, unknown>;
  if (a.ok === false) {
    return typeof a.grund === 'string' && typeof a.fehler === 'string' ? { ok: false, grund: a.grund.slice(0, 64), fehler: a.fehler.slice(0, 400) } : null;
  }
  if (a.ok !== true) return null;
  if (!zahl(a.takte) || !zahl(a.laenge_beats)) return null;
  if (!(a.loop_beats === null || zahl(a.loop_beats)) || !(a.periode_takte === null || zahl(a.periode_takte))) return null;
  if (!texte(a.stetig) || !texte(a.komplex) || !texte(a.hinweise) || !Array.isArray(a.ereignisse) || a.ereignisse.length > MAX_EREIGNISSE_ANTWORT) return null;
  for (const e of a.ereignisse as unknown[]) {
    if (e === null || typeof e !== 'object') return null;
    const v = e as Record<string, unknown>;
    if (!zahl(v.beat) || !zahl(v.laenge) || !(v.ton === null || zahl(v.ton))) return null;
    if (v.werte === null || typeof v.werte !== 'object' || Array.isArray(v.werte)) return null;
    for (const w of Object.values(v.werte as object)) if (!(typeof w === 'string' || typeof w === 'boolean' || zahl(w))) return null;
  }
  return a as unknown as MusterErgebnis;
}

function lies(aus: string): Antwort {
  // the LAST marker line is the child's own (it is written after the pattern ran); a pattern's own line before it loses, and the shape is checked anyway
  const zeilen = aus.split('\n').filter((z) => z.startsWith(MARKE));
  for (const z of zeilen.reverse()) {
    try {
      const r = pruefeAntwort(JSON.parse(z.slice(MARKE.length)));
      if (r) return r;
    } catch { /* next */ }
  }
  return ablehnung('muster_fehler', 'the pattern check returned no usable answer');
}

// --- children: at most MUSTER_KINDER_MAX alive, the rest waits --------------------------------------------------------------------------------------
let laufend = 0;
const warteschlange: (() => void)[] = [];
const platz = (): Promise<void> => {
  if (laufend < MUSTER_KINDER_MAX) { laufend += 1; messung.kinderMax = Math.max(messung.kinderMax, laufend); return Promise.resolve(); }
  return new Promise((ok) => warteschlange.push(ok));          // the slot is handed over by frei(): laufend stays
};
const frei = (): void => {
  const n = warteschlange.shift();
  if (n) n(); else laufend -= 1;
};

function rssEinzel(pid: number): number | null {
  try {
    const m = /^VmRSS:\s+(\d+) kB/m.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) : null;
  } catch { return null; }
}
// the process and its descendants (bwrap is the parent of node when the network lock is on)
function rssKB(pid: number, tiefe = 0): number | null {
  const selbst = rssEinzel(pid);
  if (selbst === null) return null;
  let summe = selbst;
  if (tiefe < 3) {
    try {
      for (const t of fs.readdirSync(`/proc/${pid}/task`)) {
        const kinder = fs.readFileSync(`/proc/${pid}/task/${t}/children`, 'utf8').split(/\s+/).filter(Boolean);
        for (const kind of kinder) summe += rssKB(Number(kind), tiefe + 1) ?? 0;
      }
    } catch { /* the process ended */ }
  }
  return summe;
}

function wertung(a: Anfrage): Promise<Antwort> {
  return new Promise<Antwort>((fertig) => {
    const k = netzsperre()
      ? spawn(BWRAP_PROG, [...BWRAP, process.execPath, ...argumente()], { stdio: ['pipe', 'pipe', 'pipe'], env: umgebung() })
      : spawn(process.execPath, argumente(), { stdio: ['pipe', 'pipe', 'pipe'], env: umgebung() });
    lebende.add(k);
    let aus = '', fehler = '', abbruch: 'zeit' | 'speicher' | null = null, ende = false;
    const toete = (g: 'zeit' | 'speicher'): void => { if (abbruch === null) abbruch = g; k.kill('SIGKILL'); };
    const uhr = setTimeout(() => toete('zeit'), MUSTER_ZEITLIMIT_MS);
    const waechter = setInterval(() => {
      if (k.pid === undefined) return;
      const kb = rssKB(k.pid);
      if (kb === null) return;
      messung.spitzeKB = Math.max(messung.spitzeKB, kb);
      if (kb > MUSTER_RSS_MAX_KB) toete('speicher');
    }, MUSTER_RSS_TAKT_MS);
    const schluss = (r: Antwort): void => {
      if (ende) return;
      ende = true;
      clearTimeout(uhr); clearInterval(waechter); lebende.delete(k);
      fertig(r);
    };
    k.stdout.on('data', (b: Buffer) => { if (aus.length < MAX_AUSGABE) aus += b.toString(); });
    k.stderr.on('data', (b: Buffer) => { if (fehler.length < 8192) fehler += b.toString(); });
    k.on('error', () => schluss(ablehnung('muster_nicht_verfuegbar', 'the evaluator could not be started')));
    k.on('close', (code, signal) => {
      if (abbruch === 'zeit') return schluss(zeitlimit());
      if (abbruch === 'speicher') return schluss(zuViel());
      const r = lies(aus);
      if (r.ok || !/no usable answer/.test(r.fehler)) return schluss(r);
      // no answer at all: the child died (V8 heap limit, process.exit, a signal). A clear text, never a line of the V8 crash report
      if (/heap out of memory|OOM|Allocation failed|ERR_WORKER_OUT_OF_MEMORY/.test(fehler) || signal === 'SIGABRT') {
        return schluss(ablehnung('muster_zu_gross', `the pattern needs more memory than allowed (${MUSTER_HEAP_MB} MB): make it smaller`));
      }
      return schluss(ablehnung('muster_fehler', `the evaluation of the pattern stopped without an answer (${signal ?? `exit ${code}`}): simplify the pattern`));
    });
    k.stdin.on('error', () => {});
    k.stdin.end(JSON.stringify(a));
  });
}

/** The cached answer, or null when this pattern has not been evaluated (yet). Never starts a process, never waits. */
export function ausCache(a: Anfrage): Antwort | null {
  return cache.get(schluessel(a)) ?? null;
}

/** For the synchronous command: the cached answer; a pattern that is not there yet is a refusal with the reason muster_nicht_verfuegbar. */
export function uebersetzeAusCache(a: Anfrage): Antwort {
  return ausCache(a) ?? ablehnung('muster_nicht_verfuegbar', 'the pattern has not been evaluated yet: repeat the call');
}

/** Evaluates the patterns that are not cached, asynchronously, at most MUSTER_KINDER_MAX at a time; every outcome is cached. Never rejects. */
export function vorlauf(anfragen: Anfrage[]): Promise<void> {
  const offen = new Map<string, Anfrage>();
  for (const a of anfragen) if (!cache.has(schluessel(a))) offen.set(schluessel(a), a);
  return Promise.all([...offen.entries()].map(([s, a]) => {
    const schon = unterwegs.get(s);
    if (schon) return schon;
    const lauf = (async () => {
      await platz();
      try { merke(a, await wertung(a)); } finally { frei(); }
    })().catch(() => undefined).finally(() => { unterwegs.delete(s); });
    unterwegs.set(s, lauf);
    return lauf;
  })).then(() => undefined);
}

/** tests only: forget everything */
export function vergiss(): void { cache.clear(); messung.spitzeKB = 0; messung.kinderMax = 0; }
