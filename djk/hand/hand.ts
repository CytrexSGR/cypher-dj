#!/usr/bin/env node
// djk-hand: Cyphers Hand an djk als MCP-Server (stdio). Plan docs/superpowers/plans/2026-09-28-djk-hand-mcp.md.
// Jeder Aufruf geht als HTTP an den Seiten-Server mit dem Kopf x-djk-quelle: cypher; der Server setzt damit die Quelle
// cypher in jeden Kern-Befehl (Stop Cypher blockt, Andreas' Hand bricht Rampen ab, „nur Hand“-Regler lehnt der Kern ab,
// geschlossene Kanäle öffnen und auf offene Decks springen sperrt der Server, bis das Ohr Hörscheine ausstellt).
// Aufruf: node hand.ts [--seite http://127.0.0.1:47300]
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import nodeHttp from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { SkillsExtension, type SkillFiles } from '@modelcontextprotocol/server/ext/skills';
import { nodeSkillFiles } from '@modelcontextprotocol/server/ext/skills/node';
import { mittle, zielAufTerz, gegenZiel, chroma, tonartPasst, parseTonart, urteil, KLASSEN, type Ziele } from './mischung.ts';
import { fuerHand, terzVon, TERZ_HZ, ROLLEN, type AnalyseAntwort } from '../ui/project/sound_contract.ts';   // ANALYZE: the hand answer is the contract's reduction of the page answer
import { ladeVokabular } from '../ui/presets/vocabulary.ts';   // 1.16 U5: the search tool's schema is the server's own definition
import { frageSchema } from '../ui/presets/register.ts';
import { PRESET_ID } from '../ui/presets/preset_id.ts';
import { DEEP_FAKTOR } from '../ui/project/direction.ts';   // review U4: the deep size in the text is the code's own
import { ALLE_STROEME } from '../contract/streams.ts';   // container core U7: the stream list is the shared table, not a copy here
import { OSZI_KANAELE } from '../ui/ear.ts';   // the channels of the envelope ring, one list for server and hand
import { loopOrdnerVorgabe } from '../ui/paths.ts';   // strand 11 task 7.10: the loop folder the stimme CLI writes into
import { RANG } from '../ui/http/hand_klassen.ts';   // strand 9: the level order the server enforces, one table
import { bandMitteHz, SPEKTRUM_FRIST_MS } from '../ui/public/spectrum.js';   // 1.15 A9: one source for the band centres and the staleness limit

const { values: arg } = parseArgs({ options: { seite: { type: 'string', default: 'http://127.0.0.1:47300' } } });
const SEITE = arg.seite as string;
const FEHL_STATUS = new Set([4, 6, 7, 8]);   // §5.1: verworfen, abgelehnt, abgebrochen, storniert (5 = verspätet ausgeführt)

type Json = Record<string, unknown>;
// Instrumente nachrüsten startet Units, das kann der Seiten-Server nicht: die Hand ruft djk-instrumente selbst auf.
// Instanz aus dem Seiten-Port (47300 + 1000·k, k = 1 → a), wie djk-start sie vergibt.
const INSTRUMENTE = process.env.DJK_INSTRUMENTE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'start', 'djk-instrumente');
const SP = Number(new URL(SEITE).port || 80) - 47300, K = SP / 1000;
const INSTANZ = Number.isInteger(K) && K >= 1 && K <= 9 ? String.fromCharCode(96 + K) : '';
// Agent key (strand 9): the page server makes the file at start. Production page: the user's file; test instance: its /dev/shm folder;
// any other --seite (a stub in a test) reads no key unless DJK_HAND_SCHLUESSEL_DATEI says so.
const SCHLUESSEL_DATEI = process.env.DJK_HAND_SCHLUESSEL_DATEI ?? (SP === 0 && ['127.0.0.1', 'localhost'].includes(new URL(SEITE).hostname)
  ? path.join(os.homedir(), '.config', 'cypherdj', 'hand.token') : INSTANZ ? `/dev/shm/cypherdj-${INSTANZ}/hand.token` : '');
let schluesselWert: string | null | undefined;   // undefined = not read yet
function schluessel(neu = false): string | null {
  if (neu) schluesselWert = undefined;
  if (schluesselWert !== undefined) return schluesselWert;
  let k: string | null = null;
  try { const t = SCHLUESSEL_DATEI ? fs.readFileSync(SCHLUESSEL_DATEI, 'utf8').trim() : ''; k = /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null; } catch { k = null; }
  if (k === null && SCHLUESSEL_DATEI) process.stderr.write(`djk-hand: no key file ${SCHLUESSEL_DATEI}; the studio will refuse agent writes\n`);
  return (schluesselWert = k);
}
// Strand 9: every tool call names itself to the page server (tool, action, call id), so the server can class and log it per call.
const AUFRUF = new AsyncLocalStorage<{ werkzeug: string; aktion: string | null; aufruf: string }>();
const AUFRUF_PRAEFIX = crypto.randomBytes(4).toString('hex');
let aufrufZaehler = 0;
function koepfe(): Record<string, string> {
  const k = schluessel();
  const a = AUFRUF.getStore();
  return {
    'x-djk-quelle': 'cypher', ...(k ? { authorization: `Bearer ${k}` } : {}),
    ...(a ? { 'x-djk-werkzeug': a.werkzeug, ...(a.aktion ? { 'x-djk-aktion': a.aktion } : {}), 'x-djk-aufruf': a.aufruf } : {}),
  };
}
// S18: the streams the page currently serves: 1..3 always, any other stream of ALLE_STROEME while its erzeuger lives.
// /lage studio.stroeme says which; if /lage does not answer, the three studio streams as before.
async function stroemeListe(): Promise<number[]> {
  const r = await http('GET', '/lage');
  const st = (r.j as { studio?: { stroeme?: unknown } }).studio?.stroeme;
  const nr = Array.isArray(st) ? st.map((x) => Number((x as Json)?.strom)).filter((n) => (ALLE_STROEME as readonly number[]).includes(n)) : [];
  return r.code === 200 && nr.length ? [...new Set([1, 2, 3, ...nr])].sort((a, b) => a - b) : [1, 2, 3];
}
// instrumente starts units itself and bypasses the page server, so the stop switch and the level are checked here from GET /hand/ich.
// A 404 (old server) or an unreachable page goes on as before.
async function instrumenteLaden(extra: string[] = []): Promise<{ code: number; j: Json }> {
  const ich = await http('GET', '/hand/ich').catch(() => null);
  if (ich && ich.code === 200) {
    const stufe = String(ich.j.stufe);
    if (ich.j.gestoppt === true) return { code: 409, j: { fehler: 'ki_gestoppt', text: 'the person stopped the agent' } };
    if ((RANG as Record<string, number>)[stufe] !== undefined && (RANG as Record<string, number>)[stufe] < RANG.schreiben) {
      return { code: 403, j: { fehler: 'stufe_zu_niedrig', text: 'this key may not do that', braucht: 'schreiben', hat: stufe } };
    }
  }
  return new Promise((ok) => execFile(INSTRUMENTE, [...(INSTANZ ? ['--instanz', INSTANZ] : []), ...extra], { timeout: 90000 }, (e, aus, err) => {
    const zeilen = (t: string) => t.split('\n').map((z) => z.trim()).filter(Boolean);
    ok(e ? { code: 500, j: { fehler: 'instrumente_gescheitert', text: zeilen(err).join(' | ') || e.message, ausgabe: zeilen(aus) } }
      : { code: 200, j: { ok: true, ausgabe: zeilen(aus) } });
  }));
}
// Slice 6: compact `lage` / `warte`. The baseline is the last full answer THIS hand returned from lage or warte (the inner polls of warte do not move it).
let lageBasis: Json | null = null;
function lagePfade(w: unknown, pfad: string, aus: Map<string, unknown>): void {
  if (w !== null && typeof w === 'object' && !Array.isArray(w) && Object.keys(w).length) { for (const [k, v] of Object.entries(w)) lagePfade(v, pfad ? `${pfad}.${k}` : k, aus); }
  else aus.set(pfad, w);
}
function lageForm(r: { code: number; j: Json }, p: Json): { code: number; j: Json } {
  if (r.code !== 200 || r.j === null || typeof r.j !== 'object') return r;
  const voll = r.j, basis = lageBasis;
  lageBasis = JSON.parse(JSON.stringify(voll)) as Json;
  const felder = Array.isArray(p.felder) ? (p.felder as unknown[]).map(String) : null;
  const waehle = (o: Json): Json => felder ? Object.fromEntries(Object.entries(o).filter(([k]) => k === 'uhr' || felder.includes(k))) : o;
  if (p.kurz !== true) return { code: r.code, j: waehle(voll) };
  const jetzt = waehle(voll);
  if (basis === null) return { code: r.code, j: jetzt };
  const neu = new Map<string, unknown>(), alt = new Map<string, unknown>();
  const ohne = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'uhr' && k !== 'ki' && k !== 'quittungen'));
  lagePfade(ohne(jetzt), '', neu); lagePfade(ohne(waehle(basis)), '', alt);
  const geaendert: Record<string, unknown> = {}, entfernt: string[] = [];
  for (const [k, v] of neu) if (!alt.has(k) || JSON.stringify(alt.get(k)) !== JSON.stringify(v)) geaendert[k] = v;
  for (const k of alt.keys()) if (!neu.has(k)) entfernt.push(k);
  const spuren = [...new Set([...Object.keys(geaendert), ...entfernt].map((k) => {
    const t = k.split('.'); return t[0] === 'regler' && t[1] ? t[1].split('/').slice(0, 2).join('/') : t[0];
  }))].sort();
  const gesehen = new Set(((basis.quittungen as unknown[] | undefined) ?? []).map((x) => JSON.stringify(x)));
  const quittungen_neu = ((voll.quittungen as unknown[] | undefined) ?? []).filter((x) => !gesehen.has(JSON.stringify(x)));
  return { code: r.code, j: { uhr: voll.uhr, ki: voll.ki, geaendert, entfernt, spuren, quittungen_neu } };
}
async function http(methode: 'GET' | 'POST', pfad: string, daten?: Json, wiederholt = false, signal?: AbortSignal): Promise<{ code: number; j: Json }> {
  const r = await fetch(SEITE + pfad, methode === 'GET' ? { headers: koepfe(), signal }
    : { method: 'POST', headers: { 'content-type': 'application/json', ...koepfe() }, body: JSON.stringify(daten ?? {}), signal });
  const text = await r.text();
  let j: Json;
  try { j = JSON.parse(text) as Json; } catch { j = { text }; }
  // a rotated key: read the file once more and repeat the request once
  if (r.status === 401 && j.fehler === 'schluessel_ungueltig' && !wiederholt) { schluessel(true); return http(methode, pfad, daten, true, signal); }
  return { code: r.status, j };
}

// loop deck H1: the loop deck routes refuse with {ok:false, grund, text}; the tool error carries the reason as `fehler` like every other tool.
async function httpGrund(methode: 'GET' | 'POST', pfad: string, daten?: Json): Promise<{ code: number; j: Json }> {
  const r = await http(methode, pfad, daten);
  if (r.code >= 400 && r.j.fehler === undefined && r.j.grund !== undefined) r.j = { ...r.j, fehler: r.j.grund };
  return r;
}

// Fix-Runde S3 R6: proj_freeze und proj_export warten auf einen Lauf, der länger sein kann als Undicis 300 s (fetch bricht dann mit „fetch failed“
// ab, ohne Grund). Diese drei gehen über node:http mit eigenem Zeitlimit. Freeze und Export: gewählt über der längsten Dauer, die der Seiten-Server erlaubt:
//   Freeze: Rampe bis 20 s + Quittung bis 4 s + Frist (256 + 2 + 4 Beats bei 60 BPM + 5 s) ≈ 291 s          → Vorgabe 6 min
//   Export: Freeze ≈ 291 s + Render-Zeitlimit 4 · 1024 s + 60 s + Lautheit (ffmpeg) 120 s ≈ 4567 s          → Vorgabe 80 min
// (Grenzen aus ui/areas/proj/output.ts, session.ts rampeWarteMs, server.ts warteQuittung, project/loudness.ts, commands.ts TEMPO_MIN.)
// Überschreibbar mit DJK_HAND_FRIST_PROJ_FREEZE_MS, DJK_HAND_FRIST_PROJ_EXPORT_MS und DJK_HAND_FRIST_PROJ_LAUTHEIT_MS (Tests: kurze Grenze).
type Lang = 'proj_freeze' | 'proj_export' | 'proj_export_spuren' | 'proj_lautheit' | 'proj_stems' | 'proj_zusammenfuehren' | 'proj_bounce' | 'proj_resample' | 'proj_analyse' | 'proj_noten';
// proj_lautheit (Paket 1.18, S3-Fix G5): der Server rendert seriell, bis zu 129 Renders (128 Spuren und Summe) zu je 4 · 1024 s + 60 s (Zeitlimit des Renders)
// plus ffmpeg 120 s je Messung plus ein Freeze ≈ 291 s: Grenzfall ≈ 9198 min (153,3 h). Die Vorgabe liegt NICHT darüber (80 min wie der Export): echte Renders
// brauchen Sekunden, das Zeitlimit ist eine Kill-Schwelle; wer den Grenzfall erreicht, bekommt hand_frist und fragt später (beschaeftigt, solange es läuft).
// Darum sagt fristText für proj_lautheit nicht „above the longest run“, sondern nennt Grenze, Grenzfall und Override.
export const FRIST_VORGABE_MS: Readonly<Record<Lang, number>> = { proj_freeze: 6 * 60_000, proj_export: 80 * 60_000, proj_export_spuren: 80 * 60_000, proj_lautheit: 80 * 60_000, proj_stems: 20 * 60_000,
  proj_zusammenfuehren: 80 * 60_000, proj_bounce: 80 * 60_000,
  proj_resample: 6 * 60_000,
  proj_analyse: 30 * 60_000,   // 1.10 slice 7: the freeze's bound (a 256 beat tap at 60 BPM, ramp, receipt) plus the WAV conversion
  proj_noten: 2 * 60_000 };    // note editor B5: a detection of a normal clip takes seconds (spec: full analysis under 15 s); the run goes on after the wait, the answer is laeuft
const fristVon = (name: Lang): number => {
  const v = Number(process.env[`DJK_HAND_FRIST_${name.toUpperCase()}_MS`]);
  return Number.isFinite(v) && v > 0 ? v : FRIST_VORGABE_MS[name];
};
const FRIST_GRUND: Readonly<Record<Lang, string>> = {
  proj_freeze: 'above the longest run the server allows', proj_resample: 'above the longest run the server allows', proj_export: 'above the longest run the server allows',
  proj_export_spuren: 'above the longest run the server allows',
  proj_stems: 'at most 600 s of source take about 1 min on the GPU (measured 2026-11-06: 8 min in 43 s); the limit keeps a wide reserve',
  proj_zusammenfuehren: 'one render of the range (time limit 4 * 1024 s + 60 s) plus hashing the result, below 80 min; a normal merge takes seconds',
  proj_bounce: 'one render of the range (time limit 4 * 1024 s + 60 s) plus hashing the result, below 80 min; a normal bounce takes seconds',
  proj_lautheit: 'enough for normal ranges, but the server allows about 153.3 h in the extreme case: 129 renders of 1024 beats at 60 BPM, each at its time limit',
  proj_noten: 'a detection of a normal clip takes seconds; a long source takes longer, the run goes on after the wait',
  proj_analyse: 'one render of the strip and, with a comparison, of the second one, for at most 1024 beats each, plus the analysis in a worker thread; a normal range takes seconds, and a Surge track that must be frozen first adds its freeze',
};
const fristText = (name: Lang): string => `The call waits at most ${FRIST_VORGABE_MS[name] / 60_000} min (tool limit, DJK_HAND_FRIST_${name.toUpperCase()}_MS; `
  + `${FRIST_GRUND[name]}); after that it answers hand_frist, and the run may still finish on the server: a repeated call `
  + 'answers beschaeftigt while it runs.';
function httpLang(name: Lang, pfad: string, daten: Json): Promise<{ code: number; j: Json }> {
  const ms = fristVon(name), koerper = JSON.stringify(daten);
  return new Promise((ok, fehl) => {
    let fertig = false;
    const ende = (f: () => void): void => { if (fertig) return; fertig = true; clearTimeout(uhr); f(); };
    const kopf = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(koerper), ...koepfe() };
    const q = nodeHttp.request(SEITE + pfad, { method: 'POST', headers: kopf },
      (a) => {
        let text = '';
        a.setEncoding('utf8');
        a.on('data', (t: string) => { text += t; });
        a.on('end', () => ende(() => { let j: Json; try { j = JSON.parse(text) as Json; } catch { j = { text }; } ok({ code: a.statusCode ?? 0, j }); }));
        a.on('error', (e) => ende(() => fehl(e)));
      });
    const uhr = setTimeout(() => ende(() => {
      q.destroy();
      ok({ code: 504, j: { fehler: 'hand_frist', text: `no answer from the page server within ${ms / 1000} s (tool limit of ${name}); `
        + 'the run may still finish on the server: a repeated call answers beschaeftigt while it runs, proj_verlauf shows a finished freeze' } });
    }), ms);
    q.on('error', (e) => ende(() => fehl(e)));
    q.end(koerper);
  });
}

const zahl = (beschreibung: string, extra: Json = {}) => ({ type: 'number', description: beschreibung, ...extra });
const deck12 = { type: 'integer', enum: [1, 2, 3, 4], description: 'Deck 1 = A, 2 = B, 3 and 4 = the further decks (the hearing check knows all four)' };
const deck = { type: 'integer', enum: [1, 2, 3, 4], description: 'Deck 1 = A, 2 = B, 3 and 4 = the further decks (deck 3 also serves loop work)' };
const ab = { type: 'string', enum: ['jetzt', 'schlag', 'takt', 'phrase'], description: 'start on the master clock: now, next beat, next bar (default), next phrase (8 bars)' };
const raster = { type: 'number', enum: [0, 0.25, 1, 4, 16], description: 'snap in beats (0 = none, 4 = bar)' };

// 1.16 rest U5: presets and collections. presets_suchen takes its definition from frageSchema (the function behind GET /presets/suche/schema, P-R7),
// so the tool schema and the route cannot drift; tests/hand_presets.test.mjs compares the two against a real presetsBereich.
const SUCHE = frageSchema(ladeVokabular());
const isObj = (x: unknown): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x);
const definiert = (p: Json, ...felder: string[]): Json => Object.fromEntries(felder.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
const PRESET_ZIEL = { type: 'object', description: 'where the values go: {art: "spur", spur_id} (rb338 or bk track), {art: "insert", insert_id} (an existing stage), {art: "insert_neu", strang_id} (a new stage at the end of the chain of a track, group, return or master), {art: "kanal", kanal} (a kern source channel such as deck/1, erz/2, pad/1: the channel compressor and the mix tools)', additionalProperties: true };

const WARTE_FRIST_MAX_MS = 15 * 60_000;   // `warte bis spur_ende`: the longest total wait
// Beats per bar from the answer of GET /lage (`taktart: [n, 4]` appears only when it is not 4); 4 when absent
const proTaktVon = (lage: unknown): number => {
  const n = (lage as { taktart?: unknown } | null)?.taktart;
  return Array.isArray(n) && Number.isInteger(n[0]) && n[0] >= 1 ? n[0] : 4;
};
const MISCHUNG_ZIELE = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'mischung_ziele.json'), 'utf8')) as Ziele;   // ROUGH genre curves
interface Werkzeug { name: string; description: string; inputSchema: Json; lauf: (p: Json) => Promise<{ code: number; j: Json; text?: string; roh?: string }> }
const W: Werkzeug[] = [
  { name: 'lage', description: 'Current state: master clock (beat, bar, bpm; uhr.naechster_takt and uhr.naechste_phrase_takt: the absolute bars a spur with ab takt / phrase would anchor at now), Stop-Cypher flag, decks 1-4 (track, bar in track, loop, open/closed; a deck on a SEQ place carries no track and reads status 0), the four places (plaetze: the type of each place, leer, track, strudel, seq, loops or stems, with its group) and the four containers (container: what each of the strips A..D plays), mixer values (fader, trim, trim_auto, eq, kill, filter of the four container strips deck/1, deck/2, pad/1, pad/2 and of the stream aliases erz/1-3, 5-7 always, a closed fader reads -200, an absent fader means the kern has not said it yet and is never 0 dB; sends 1, 2, 3 and 4 of those same channels, decks included (earlier only send 2 showed, not 1, 3, 4), duck, reverb return, glue once off their defaults, a send that is absent is off; after a kern restart all values are empty until the new kern reports them), the loop decks, FX, my last acknowledgements, and the studio: AUTO/pattern per instance, loaded Surge sound (after a set it reads "edited": the name then says nothing about the content), and ins_gr (only while a project insert stage computes: {"ins/komp/<n>": gain reduction in dB, "ins/saett/<n>": how far the clipper goes over its ceiling in dB (0 = never over), "ins/eq/<n>": the deepest dynamic change of the EQ stage in dB (positive = cut, negative = boost; only a stage with a dynamic band on reports), "ins/trans/<n>": the largest level change of the transient shaper in the last block in dB (the size only, always 0 or more, a lift counts like a cut; an imager reports nothing), n = the slot of the stage as in proj_lage inserts; a stage that is bypassed or removed is absent after 0.5 s), hall_pool ({an, faeden, spaet, zurueck}: Hall pool of the kern for the return Halls, absent from an old kern; an false = no pool, no free cores or the pool switched itself off after repeated late blocks, the Halls then run in the callback and the sound stays the same), spur_pool ({an, modus, blocks_parallel, einheiten_worker, einheiten_caller, seriell, haengt, spaet, zurueck}: the pool of the kern for the track phases of the arrangement, absent only from an old kern (a kern without a pool sends zeros: an false, modus aus); modus is aus, an or auto as in force, an false = the phases run serial in the callback (also while the workers have no real-time priority), the sound stays the same; einheiten_worker counts units done on the workers, einheiten_caller the units the callback computed itself in phases that went to the pool (jobs it took back are in zurueck), haengt and spaet are late or stuck workers), and the digital output (ausgang.zustand: gut = on, aus = OFF and silent, kampf = keeps dropping, wache_stumm = watch not running, unbewacht = silent sink; faelle = dropouts this session). Call this before every move. Arguments: felder (top-level keys to keep, uhr always stays) and kurz (true: only what changed since the last lage or warte answer this hand gave: {uhr, ki, geaendert: {dotted path: value}, entfernt, spuren: channels touched, quittungen_neu}; the first kurz call returns everything). harmonie: the live harmony lane {tonart, folge, takte_je_akkord, ab_takt, jetzt: {takt, akkord}, naechster_wechsel_takt}.',
    inputSchema: { type: 'object', properties: { kurz: { type: 'boolean' }, felder: { type: 'array', items: { type: 'string' } } } }, lauf: async (p) => lageForm(await http('GET', '/lage'), p) },
  { name: 'bestand', description: 'Tracks that can be loaded (rendered at 128 BPM): material_id, title, key (camelot), original BPM, length. Optional text filter on title or key.',
    inputSchema: { type: 'object', properties: { suche: { type: 'string' }, max: { type: 'integer', minimum: 1, maximum: 50 } } },
    lauf: async (p) => {
      const r = await http('GET', '/bestand');
      const s = String(p.suche ?? '').toLowerCase(), max = Number(p.max ?? 20);
      const liste = (r.j as unknown as Json[]).filter((e) => !s || `${e.titel} ${e.camelot}`.toLowerCase().includes(s)).slice(0, max)
        .map((e) => ({ material_id: e.material_id, titel: e.titel, camelot: e.camelot, quelle_bpm: e.quelle_bpm, dauer_s: e.dauer_s }));
      return { code: r.code, j: { eintraege: liste } as unknown as Json };
    } },
  { name: 'laden', description: 'Load a track onto a deck. The deck must not be playing with its fader open. Fader is closed after loading.',
    inputSchema: { type: 'object', required: ['deck', 'material_id'], properties: { deck, material_id: { type: 'string' } } },
    lauf: (p) => http('POST', '/laden', p) },
  { name: 'deck_start', description: 'Start a deck in sync with the master, on the next bar by default (with another deck playing, on the next bar in phase with it: the downbeats meet), from the downbeat of the track (or quell_beat). Only on a CLOSED deck (fader down): that is how I pre-listen. On an open deck it is refused (ziel_ungehoert).',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck, ab, quell_beat: zahl('source beat to start from (default: first downbeat)') } },
    lauf: (p) => http('POST', '/deck/start', p) },
  { name: 'deck_stopp', description: 'Stop a deck (default: now).', inputSchema: { type: 'object', required: ['deck'], properties: { deck, ab } },
    lauf: (p) => http('POST', '/deck/stopp', p) },
  { name: 'sprung', description: 'Jump inside a track: to a source beat (ziel) or by delta beats. Snapped to the raster, phase kept. Refused on an open deck (unheard material).',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck, ziel: zahl('target source beat'), delta: zahl('beats to jump, negative = back'), raster } },
    lauf: (p) => http('POST', '/deck/sprung', { raster: 4, ...p }) },
  { name: 'loop', description: 'Deck loop on/off: beats 1, 2, 4, 8, 16, 32, 64 starts a loop at the raster; beats 0 ends it. Allowed on an open deck (repeats what is heard).',
    inputSchema: { type: 'object', required: ['deck', 'beats'], properties: { deck, beats: { type: 'integer', enum: [0, 1, 2, 4, 8, 16, 32, 64] }, raster } },
    lauf: (p) => http('POST', '/deck/loop', { deck: p.deck, laenge: p.beats, raster: p.raster ?? 4 }) },
  { name: 'pad', description: 'Hotcue pads 1-8: setzen (shot or loop cue at the playhead, or while a loop runs: that loop), spielen (jump in; refused on an open deck), loeschen.',
    inputSchema: { type: 'object', required: ['deck', 'nr', 'aktion'], properties: { deck, nr: { type: 'integer', minimum: 1, maximum: 8 },
      aktion: { type: 'string', enum: ['setzen', 'spielen', 'loeschen'] }, art: { type: 'string', enum: ['shot', 'loop'] },
      beats: { type: 'integer', enum: [1, 2, 4, 8, 16, 32, 64] }, raster } },
    lauf: async (p) => {
      const d: Json = { deck: p.deck, nr: p.nr, aktion: p.aktion, raster: p.raster ?? 1 };
      if (p.aktion === 'setzen') {
        const l = await http('GET', `/deck/loop?deck=${p.deck}`);
        if (p.art === 'loop' && (l.j as Json).laenge) Object.assign(d, { aus_loop: true, laenge: (l.j as Json).laenge });
        else {
          const lage = (await http('GET', '/lage')).j as { decks: Json[] };
          const q = lage.decks.find((x) => x.deck === p.deck)?.quell_beat;
          Object.assign(d, { quell_beat: q, art: p.art ?? 'shot', ...(p.art === 'loop' ? { laenge: p.beats ?? 4 } : {}) });
        }
      }
      return http('POST', '/deck/hotcue', d);
    } },
  { name: 'loop_nach_box', description: 'Load the running deck loop into a cell of loop deck 1 or 2 (box 1 = loop deck 1, box 2 = loop deck 2): POST /loopdeck/laden with the source {von_deck: deck}, into the first empty cell. '
    + 'Use loopdeck laden for a chosen track and cell. Refused: ki_gestoppt, deck_voll (no empty cell), quelle_unbekannt (the deck has no active loop), zu_lang, audio_budget, kein_loopdeck.',
    inputSchema: { type: 'object', required: ['deck', 'box'], properties: { deck, box: { type: 'integer', enum: [1, 2] } } },
    lauf: (p) => httpGrund('POST', '/loopdeck/laden', { deck: p.box, quelle: { von_deck: p.deck } }) },
  // plan live-module task 4: the live modules (the live container is the project that runs during a set; a module = one exported deck loop with its stems)
  { name: 'live_oeffnen', description: 'Open the live container, the persistent project that holds the live modules (places A to D, a module sits in one place), creating it on first use. '
    + 'If it is already open this changes nothing. Closes the project that was open like proj_oeffnen. I cannot confirm a switch away from a RUNNING live '
    + 'container while a deck plays: that is refused with live_laeuft, Andreas confirms on the page. Answers slug and slots (the group id per slot, null = empty). '
    + 'A module group of an older live project that still sits at -200 dB is raised to 0 dB on the open when the channel of its container is closed; with the channel open it stays and the answer names the slot under fader.gemeldet. '
    + 'Needed once before modul_export.',
    inputSchema: { type: 'object', properties: {} },
    lauf: () => http('POST', '/live/oeffnen', {}) },
  { name: 'modul_export', description: 'Export the running loop of a deck (1, 2, 3 or 4; normally deck 3 on headphones) as a module of the live container: the loop is cut '
    + 'sample-exact from the deck rendering and sounds at once through the module Loop track, the stem separation (drums, bass, other, vocals, guitar and piano when '
    + 'present) runs in the background on the GPU and replaces the loop when it is done (follow it with modul_stand). The module plays on a DJ channel: place A (also 1) on deck/1, B (2) on deck/2, C (3) on pad/1, D (4) on pad/2, through the strip of that container (trim, EQ, kill, filter, fader, PFL). '
    + 'The module group fader stays at 0 dB; the channel fader is the only gain. The channel is closed at the export (Andreas brings it in with the strip, I cannot open it: regler on that strip answers kein_hoerschein), the original of each stem is the track below its stem group. '
    + 'slot A to D (or 1 to 4); without slot the '
    + 'server takes the first free place whose channel is closed (order C, D, A, B). Refused with kanal_offen (the channel of that slot is open: trim plus fader above -26 dB or a planned or running ramp; PFL does not matter; without slot: every free slot is open), slot_belegt (that slot holds a module: modul_leeren first), kein_loop (no loop on the deck), kein_bibliothekstrack '
    + '(the deck does not play a library track), kein_liveprojekt (live_oeffnen first), ki_gestoppt (Stop Cypher). A busy GPU does not refuse the export: the module stays '
    + 'loop-only and modul_stand names gpu_belegt, modul_stems tries again. Answers slot, gruppe_id, laenge_beats, rev, stand.',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck, slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' } } },
    lauf: (p) => http('POST', '/modul/export', p) },
  { name: 'modul_leeren', description: 'Clear a live slot: the module fades out over takte bars (0 = at once; 0, 1, 2, 4, 8 or 16) and is then removed, the slot is free again. '
    + 'Every module is saved to the module library at export and again when cleared. Refused with slot_leer (nothing in that slot) and rampe_laeuft (a fade of that slot is running).',
    inputSchema: { type: 'object', required: ['slot', 'takte'], properties: { slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' }, takte: { type: 'integer', enum: [0, 1, 2, 4, 8, 16], description: 'bars to fade out over, 0 = at once' } } },
    lauf: (p) => http('POST', '/modul/leeren', p) },
  { name: 'modul_stems', description: 'Separate the stems of a module again when it has none: after a failed separation (gpu_belegt, stems_fehler), a busy GPU or a server restart. '
    + 'Starts the run in the background and answers at once with the slot state; follow it with modul_stand. Refused with slot_leer, modul_hat_stems (already separated), '
    + 'stems_laeuft (a run of that slot is going), kein_liveprojekt, ki_gestoppt.',
    inputSchema: { type: 'object', required: ['slot'], properties: { slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' } } },
    lauf: (p) => http('POST', '/modul/stems', p) },
  { name: 'modul_stand', description: 'State of the four places: per slot null (empty) or {gruppe_id, name, titel, stems: {stems: wartet | laeuft | fertig | fehler, grund?, text?, auftrag_id?}}. '
    + 'wartet = decoding the loop, laeuft = separating (the percent is in proj_lage stems), fertig = the stem groups are in the module, fehler = loop-only module with the reason in grund and text.',
    inputSchema: { type: 'object', properties: {} },
    lauf: () => http('GET', '/modul/stand') },
  { name: 'modul_tonart',
    description: 'Adapt the module of live place A to D to the key of the deck on the master (the playing deck with the loudest channel): the whole module moves by the '
      + 'shortest semitone distance (-6..+6, major and minor relative keys counted as equal, Am to Cm is +3); MIDI notes by pitch, stem clips by warp transpose_st '
      + '(drums in repitch mode stay); the MIDI of drum tracks (drum-map graph or kit) stays, there the note picks the drum. One undo step. The shift is stored on the module, so calling it again changes nothing. GET /modul/stand shows tonart_abstand per slot. '
      + 'Answers {slot, deck, deck_tonart, abstand, bewegt, transponiert, rev}. Reasons: kein_liveprojekt, slot_leer, kein_deck (no deck plays), tonart_unbekannt (module or deck key '
      + 'unknown), ki_gestoppt.',
    inputSchema: { type: 'object', required: ['slot'], properties: { slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' } } },
    lauf: (p) => http('POST', '/modul/tonart', { slot: p.slot }) },
  // SEQ deck v2 task 3 (spec 2026-11-14-seq-deck-design, sections 5 and 7): one tool for the sequencer decks of the DJ places; patterns are written and read as text
  { name: 'seq', description: 'The SEQ decks of the DJ places (platz 1 to 4): a deck holds patterns, a pattern is an instrument track with one MIDI clip and free lanes (notes, values per step, curves on a knob); the lanes are a view on ordinary project clips, so what is written here is the clip in PRODUCTION. '
    + 'Actions: stand (every place: null = no deck, else {gruppe_id, folgen: [{spur_id, clip_id, name, geraet, stumm, editierbar, laenge_beats, zeilen, text}]}; text is the pattern in the notation below; a pattern that is not editable (laid out in PRODUCTION) has editierbar false and no text), anlegen {platz} (builds an empty deck), '
    + 'folge {platz, text} (writes one or several patterns from the notation) or folge {platz, name} (reads one pattern of the deck as text, ignoring case), leeren {platz} (removes the deck and its patterns), modul {platz, slug, abschnitt?} (loads a Workbench module, the slugs of proj_liste entries with werkbank true, into the deck; with abschnitt (a section id from tracker song) any project, e.g. a tracker project, hands that one section to the deck (TO DJ): at most 64 beats, refused as abschnitt_zu_lang, abschnitt_unbekannt, abschnitt_leer or zu_viele_bk (Baukasten tracks of the live project plus the section, over 16), effect commands and sample slots come along, the tracker project is not changed. Per module: one pattern per instrument track with the same instrument, notes and knob values; a place without a deck gets one, a deck that is there gets the patterns added muted and named "<name> 2", "<name> 3" and so on; an answer {ok, bericht, rev, projekt, gruppe_id} where bericht lists the patterns and what was left out: sends, inserts, master inserts, returns, groups, chain automation, the key, audio and host instrument tracks, and notes beyond beat 64; it is one undo step and all or nothing, with kein_werkbank, modul_ohne_instrument, unbekannt, the track limits as projekt_ungueltig and the gates of anlegen for a new deck). Every write answers {rev, projekt, kern, gruppe_id}, or ohne_aenderung true when the text said what the project already holds. '
    + 'One text is ONE write and one undo step: all patterns of it, or none. A pattern I make by text starts muted (stumm), Andreas brings it in. The deck is heard on the strip of deck/<platz>: while the place holds a SEQ deck and no loaded track I can open that fader and trim with regler without a hearing pass (a loaded track needs the pass). '
    + 'NOTATION. A head line, then one line per lane: "folge <name> <instrument> <length>"; a name with spaces is in double quotes. Instruments: bk:<graph> (a Baukasten instrument), kit:<kit>, rb338. Length: 2bar, 3/4bar or 6b (beats), at most 64 beats, a multiple of 0.125 beat. For a pattern that exists, instrument and length may be left out: another length acts like the length control of the page (notes behind the new end go), another instrument is refused (argument_ungueltig, naming the playing one). A new pattern needs the instrument. The name is unique in the deck, ignoring case. '
    + 'Note lanes: "noten <lane id> [<note>] <grid> <cells>". Grids 1/4, 1/8, 1/16, 1/32. With a note (a number, a note name or a kit sound name) it is a trigger lane: one character per cell, . rest, x hit (velocity 100), X accent (127), o ghost (60); written back velocity falls into the bands up to 79, 80 to 110 and from 111. Without a note it is the pitched lane (one per pattern): tokens, . rest, a note name, ~ lengthens the note before it by one cell, c1+g1 a chord. Note names are those of the piano roll, 60 = c3, c-2 = 0, sharps d#1 (flats eb1 are read too). Spaces and | between cells are ignored (| marks bars). '
    + 'Value lanes: "werte <target> <grid> <cells> [je <length>]": a number per cell or . (no value). Targets: vel (velocity 1..127 of the notes of a note lane, the cell needs a note) and len (length in cells), with @<lane id> when the pattern has several note lanes (vel@kick); k<n> (knob n of a Baukasten instrument), a knob name without spaces (Cutoff), a knob name in double quotes ("Env amount"), for the RB-338 cutoff, resonanz, lautstaerke, env_mod (also its names); transpose, fader (track level dB), pan. Knob values are absolute 0..1. Where a werte vel line exists, it sets the velocities and x X o only say that a note is there; a len line wins over ~. A knob lane is an envelope: a cell without a number has no point and holds the value before it; the first cell always carries a value (it is written back with the value of the last cell; an envelope without a point at the start reads the value over the seam there, the last point, and writing that back changes nothing). k<n> with n 1 to 64 is a target of every Baukasten instrument; a knob the graph does not have reads back with the comment "; no such knob". je gives the envelope a length of its own (then the cell count follows it). '
    + 'Curve lanes: "kurve <target> <shape> <from> <to> [stufen <n>] [saat <n>] [je <length>]" with the shapes sinus, dreieck, saege, saege_ab, rechteck, rampe, zufall (stufen 1 to 64, default 8; the period is the length of the lane: the pattern, or je), or "kurve <target> punkte <beat>:<value> ..." (a point may end in @s or @sprung for the curve form; the beat is in the lane). '
    + 'A ";" starts a comment to the end of the line; read back, knobs are written as k<n> (the RB-338 by name) with the knob name as comment, a kit sound as comment after the note of its lane. '
    + 'A lane line is the whole lane: a cell with . has no note and no point afterwards. A lane the text does not name stays as it is. Reading back the text of a pattern and writing it changes nothing: a token that says the same as the data (same velocity band, same notes, same tie count, same value to two decimals) leaves that note or point as Andreas set it; a werte vel or len cell reads the value of the lowest note of the cell (a chord of velocities 90 and 40 reads as 90 and stays as it is), a really different value is set on every note of the cell. A lane id, a note or a target twice in one pattern is refused with both line numbers. A pattern shows all its lanes, also more than 32 derived ones; at most 32 lanes are stored (zu_gross when a write would store more). Cells count from 0 in the messages. '
    + 'Example: "folge bass  bk:bassmusik  2bar" then "noten bass  1/16  c1 ~ . c1 . . d#1 ~ . . c1 . g0 ~ ~ . | c1 ~ . c2 . . d#1 ~ . . f1 . g1 ~ . a#0", "werte vel  1/16  120 . . 64 . . 100 . . . 70 . 115 . . . | 120 . . 90 . . 100 . . . 76 . 108 . . 64", "werte k3  1/16  .25 . . .30 . . .55 . . . .35 . .80 . . . | .25 . . .90 . . .50 . . . .62 . .75 . . .40", "kurve k4  sinus .08 .92  je 3/4bar"; a drum pattern: "folge drums  kit:909  1bar", "noten kick 36  1/16  x...x...x.o.x...", "noten hat 42  1/32  x...o...x...o...x...o...x.o.oxxX". '
    + 'A line that does not fit (cell count, unknown knob, a knob name with spaces outside quotes, a value out of range, a note a trigger lane owns) refuses the whole text with argument_ungueltig and the line, lane and cell in the text; nothing is written. A knob lane on an instrument without that knob: huellkurve_ziel. '
    + 'Gates: anlegen is refused with kanal_offen when the channel deck/<platz> is open (trim plus fader above -26 dB), with deck_laeuft while deck <platz> plays, with seq_belegt when the place already holds a deck; I cannot clear a deck whose channel is open (kanal_offen), Andreas can; patterns may be written while the channel is open. Undo (proj_undo), redo (proj_redo) and opening a project are not gated by kanal_offen. Other refusals: seq_fehlt (no deck in that place), kein_liveprojekt (live_oeffnen first), ki_gestoppt (Stop Cypher), argument_ungueltig. '
    + 'SCENES (eight slots over all SEQ decks, stored in the project): szene_speichern {slot} saves the CURRENT mute picture (which patterns are on, which are off; I never pass ids), '
    + 'szene_starten {slot} switches all patterns of the scene together on the NEXT BAR (patterns join at their running position, mute is a level switch; a later press wins over a pending one; '
    + 'an M click between press and bar does not cancel it: the scene executes and overwrites), szene_loeschen {slot} empties the slot, szenen lists the slots as {szenen: [null or {an, aus} counts] x 8, aktiv, wartet}. '
    + 'slot is 1 to 8. Reasons: szene_leer_slot (starting an empty slot), szene_leer (no SEQ deck exists), kein_liveprojekt, ki_gestoppt, argument_ungueltig. '
    + 'A pattern that Andreas arranged in PRODUCTION (several clips, a clip that does not start at 0) is refused by name. The page shows the deck in place <platz> as soon as that place is silent.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['stand', 'anlegen', 'leeren', 'folge', 'modul', 'szene_speichern', 'szene_starten', 'szene_loeschen', 'szenen'] },
      platz: { type: 'integer', enum: [1, 2, 3, 4], description: 'the DJ place of the deck; needed by anlegen, leeren, folge and modul' },
      slot: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8], description: 'szene_speichern, szene_starten, szene_loeschen: the scene slot' },
      text: { type: 'string', description: 'folge: the notation, a head line and one line per lane, lines separated by a line break; one text may hold several patterns' },
      name: { type: 'string', description: 'folge: the name of a pattern of the deck; with name (and without text) the pattern is read back as text' },
      slug: { type: 'string', description: 'modul: the slug of a Workbench module (a proj_liste entry with werkbank true), or of any project with abschnitt' },
      abschnitt: { type: 'string', description: 'modul: the id of a section of that project (tracker song lists them): only that section goes to the deck' } } },
    lauf: async (p) => {
      const aktion = p.aktion;
      const falsch = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      if (aktion === 'stand') return http('GET', '/seq/stand');
      if (aktion === 'szenen') return http('GET', '/seq/szenen');
      if (aktion === 'szene_speichern' || aktion === 'szene_starten' || aktion === 'szene_loeschen') {
        if (typeof p.slot !== 'number' || !Number.isInteger(p.slot) || p.slot < 1 || p.slot > 8) return falsch(`${aktion} needs slot (1 to 8)`);
        return http('POST', '/seq/szene', { slot: p.slot - 1, aktion: aktion.slice('szene_'.length) });
      }
      if (aktion !== 'anlegen' && aktion !== 'leeren' && aktion !== 'folge' && aktion !== 'modul') return falsch('aktion: stand, anlegen, leeren, folge, modul, szene_speichern, szene_starten, szene_loeschen or szenen expected');
      if (typeof p.platz !== 'number' || !Number.isInteger(p.platz) || p.platz < 1 || p.platz > 4) return falsch(`${aktion} needs platz (1 to 4)`);
      if (aktion === 'folge') {
        if ((typeof p.text === 'string') === (typeof p.name === 'string')) return falsch('folge needs text (to write patterns) or name (to read one pattern as text), not both and not neither');
        if (typeof p.text === 'string') return http('POST', '/seq/text', { platz: p.platz, text: p.text });
        const s = await http('GET', '/seq/stand');
        if (s.code !== 200) return s;
        const eintrag = (s.j as Record<string, { folgen: { name: string; text: string | null; editierbar: boolean }[] } | null>)[String(p.platz)];
        if (!eintrag) return { code: 409, j: { fehler: 'seq_fehlt', text: `place ${p.platz} holds no SEQ deck` } };
        const f = eintrag.folgen.find((x) => x.name.toLowerCase() === String(p.name).toLowerCase());
        if (!f) return { code: 404, j: { fehler: 'folge_unbekannt', text: `place ${p.platz} has no pattern ${String(p.name)} (it has ${eintrag.folgen.map((x) => x.name).join(', ') || 'none'})` } };
        if (!f.editierbar || f.text === null) return { code: 409, j: { fehler: 'folge_nicht_editierbar', text: `pattern ${f.name} is arranged in PRODUCTION and has no text` } };
        return { code: 200, j: { platz: p.platz, name: f.name, text: f.text } };
      }
      if (aktion === 'modul') {
        if (typeof p.slug !== 'string' || p.slug === '') return falsch('modul needs slug (the slug of a Workbench module)');
        if (p.abschnitt !== undefined && (typeof p.abschnitt !== 'string' || p.abschnitt === '')) return falsch('modul: abschnitt must be a section id');
        return http('POST', '/seq/modul', { platz: p.platz, slug: p.slug, ...(p.abschnitt !== undefined ? { abschnitt: p.abschnitt } : {}) });
      }
      return http('POST', aktion === 'anlegen' ? '/seq/anlegen' : '/seq/leeren', { platz: p.platz });
    } },
  // tracker task 9 (spec 2026-11-18-tracker-design, section 5): the tracker view of the open project as text, and the section commands
  { name: 'tracker', description: 'The tracker view of the open project (the same raster as the TRACKER page): a song is a list of sections, a section is a raster of rows (rows per beat = lpb) over the instrument tracks; the raster is a view on ordinary MIDI clips, so what is written here is the clip in PRODUCTION. '
    + 'Actions: song (GET /tracker/song: {lpb, ticks, abschnitte: [{id, nr, name, von_beat, laenge_beats, zeilen, muster: [{spur_id, buchstabe, name, clip_id, verbund?}]}]}), lesen {abschnitt, von?, bis?, spuren?} (a section, or a range of rows (decimal) and tracks (letters, "A,B") as text), '
    + 'schreiben {text, rev?} (writes the text back), abschnitt_neu {nach?, zeilen?, name?}, abschnitt_duplizieren {id, als: verknuepft | kopie}, abschnitt_loeschen {id}, abschnitt_verschieben {id, richtung: -1 | 1}, abschnitt_laenge {id, zeilen}, abschnitt_umbenennen {id, name | null}. '
    + 'The section actions are the project commands of the same name, sent as a one-command list like proj_aendern (one undo step); id and nach are the section ids that song lists. '
    + 'TEXT. Head: "section NN "name"  rows R  lpb L  ticks T" and for a part "from XX to XX" (NN is the 0-based section number, rows in hex, both included). Then a legend line "row | A name | B name" (the letters of the instrument tracks; audio tracks are not in the text but keep their letter, so a letter can be skipped: write the letters as lesen shows them), then one line per row: the row in hex, then one block per track, separated by "|". '
    + 'A block holds its note columns (at most 8) separated by " / ", each "NOTE VOL DLY CHN RPT", then per effect column two spaces and "XXX vv". NOTE is C-3 (MIDI 60 = C-3), ... empty, === note off, lo a note below C-0 (it can be kept, not typed). VOL is hex 01..7F; the effect and knob values are hex 00..FF. DLY is a signed decimal, a percentage of a sixteenth ("+25", "-10", "..." none; on a note off the delay of its end). '
    + 'CHN is a chance 01..99, RPT repeats 2..8 (".." and "." none). An effect cell is "... .." empty, an effect command "CODE vv" (stored in the clip, in the column it stands in: "VIB 46", "ARP 37"; CODE in ARP SLU SLD GLD VIB TRM VSL LVL RTG PAN OFS REV, vv two hex digits; an unknown code refuses the line), K01..K64 a knob value (a jump point of that knob at the row; the knob values of a row are one set per track, a knob the block does not list is removed from that row) or ~~~ a drawn curve (shown, never written). Codes: ARP xy (each tick the pitch cycles through +0, +x, +y semitones), SLU xx (slide up xx/16 semitone per tick), SLD xx (slide down xx/16 semitone per tick), GLD xx (glide to the note of the row by xx/16 semitone per tick), VIB xy (vibrato, speed x/64 cycle per tick, depth y/8 semitone), TRM xy (tremolo, speed x, depth y/16 of the full level), VSL xy (volume slide, up x/64 or down y/64 of the full level per tick), LVL xx (level xx/FF from this row), RTG 0y (retrigger every y ticks), PAN xx (track pan, 00 left, 80 centre, FF right), OFS xx (sample offset xx/256 of the sample), REV 01 (the note plays backwards). ";" starts a comment, blank lines and spacing do not matter. '
    + 'INS: a track whose device has a slot role (the sampler graphs) has the column "INS" right after NOTE ("NOTE INS VOL DLY CHN RPT"), the slot of the note as two decimal digits 01..32 or ".." none; INS outside 01..32, or on a cell without a note, refuses the line, and a track without the role has no INS column. '
    + 'Example: "section 00 ""  rows 64  lpb 4  ticks 6  from 00 to 03", "row | A Bass", "00  | C-3 64 ... .. .  ... ..", "01  | D-3 7F ... 50 .  ... ..", "02  | === .. ... .. .  ... ..". '
    + 'WRITING. schreiben takes the text of lesen (edited): only the rows, tracks and note columns the text names are touched, and only a cell that differs from what the raster shows is written, so the text as read gives no commands (answer {rev, ohne_aenderung: true}). Head, section number, rows, lpb, ticks and legend letters must match the project. '
    + 'The whole text is ONE undo step. A line that does not fit refuses the whole text with argument_ungueltig and zeile (1-based) and nothing is written; a "===" in a cell where no note sounds is refused ("note off where no note sounds"). When a track has notes the raster does not show (more than 8 at one time) the head ends with "hidden: <letter> <n>", and writing never touches them. Other reasons: kein_projekt, tracker_live and tracker_werkbank (the live container and Workbench modules have no tracker view), rev_veraltet, and the section reasons of the commands (abschnitt_unbekannt, abschnitt_letzter, abschnitt_rand, abschnitt_grenze, abschnitt_verknuepft, zeit_schnitt). '
    + 'Answers of the writing actions are short like proj_aendern ({rev, kern, noten_zahl per clip}). '
    + 'import_mod {pfad} makes a NEW tracker module from a ProTracker module file (.mod, at most 4 MiB), given as <sample root>/<path in the root>: the samples become one bank graph, the song one history step; answer {slug, bank, rev, bericht, text}, the text says what was left out.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['song', 'lesen', 'schreiben', 'import_mod', 'abschnitt_neu', 'abschnitt_duplizieren', 'abschnitt_loeschen', 'abschnitt_verschieben', 'abschnitt_laenge', 'abschnitt_umbenennen'] },
      abschnitt: { type: 'string', description: 'lesen: the section id (song lists them)' },
      von: { type: 'integer', minimum: 0, description: 'lesen: first row of the part (decimal)' },
      bis: { type: 'integer', minimum: 0, description: 'lesen: last row of the part (decimal, included)' },
      spuren: { type: 'string', description: 'lesen: track letters of the part, comma separated ("A,C")' },
      text: { type: 'string', description: 'schreiben: the text form of a section or part' },
      rev: { type: 'integer', minimum: 0, description: 'schreiben and the section actions: the project rev (default: the current one)' },
      id: { type: 'string', description: 'abschnitt_duplizieren, _loeschen, _verschieben, _laenge, _umbenennen: the section id' },
      nach: { type: 'string', description: 'abschnitt_neu: the section after which the new one goes (default: the end)' },
      zeilen: { type: 'integer', minimum: 1, description: 'abschnitt_neu (default 64) and abschnitt_laenge: the rows of the section' },
      name: { type: ['string', 'null'], description: 'abschnitt_neu and abschnitt_umbenennen: the name (1 to 40 characters; null removes it)' },
      als: { type: 'string', enum: ['verknuepft', 'kopie'], description: 'abschnitt_duplizieren: linked members of the pattern, or unique copies' },
      richtung: { type: 'integer', enum: [-1, 1], description: 'abschnitt_verschieben: -1 earlier, 1 later' },
      pfad: { type: 'string', description: 'import_mod: the module file as <sample root>/<path>' },
      label: { type: 'string', description: 'the history label of a section action' } } },
    lauf: async (p) => {
      const aktion = p.aktion;
      const falsch = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      if (aktion === 'song') return http('GET', '/tracker/song');
      if (aktion === 'import_mod') {
        if (typeof p.pfad !== 'string' || p.pfad === '') return falsch('import_mod needs pfad (<sample root>/<path of the .mod file>)');
        return http('POST', '/tracker/import_mod', { pfad: p.pfad });
      }
      if (aktion === 'lesen') {
        if (typeof p.abschnitt !== 'string' || p.abschnitt === '') return falsch('lesen needs abschnitt (a section id, song lists them)');
        const q = new URLSearchParams({ abschnitt: p.abschnitt });
        for (const k of ['von', 'bis', 'spuren'] as const) if (p[k] !== undefined && p[k] !== null) q.set(k, String(p[k]));
        return http('GET', `/tracker/text?${q.toString()}`);
      }
      if (aktion === 'schreiben') {
        if (typeof p.text !== 'string' || p.text === '') return falsch('schreiben needs text (the text form of a section)');
        return mitRev(p, '/tracker/text', { text: p.text });
      }
      const felder: Record<string, string[]> = { abschnitt_neu: ['nach', 'zeilen', 'name'], abschnitt_duplizieren: ['id', 'als'], abschnitt_loeschen: ['id'],
        abschnitt_verschieben: ['id', 'richtung'], abschnitt_laenge: ['id', 'zeilen'], abschnitt_umbenennen: ['id', 'name'] };
      if (typeof aktion !== 'string' || !(aktion in felder)) return falsch('aktion: song, lesen, schreiben, import_mod, abschnitt_neu, abschnitt_duplizieren, abschnitt_loeschen, abschnitt_verschieben, abschnitt_laenge or abschnitt_umbenennen expected');
      const pflicht: Record<string, string[]> = { abschnitt_duplizieren: ['als'], abschnitt_verschieben: ['richtung'], abschnitt_laenge: ['zeilen'] };
      if (aktion !== 'abschnitt_neu' && typeof p.id !== 'string') return falsch(`${aktion} needs id (a section id)`);
      for (const k of pflicht[aktion] ?? []) if (p[k] === undefined) return falsch(`${aktion} needs ${k}`);
      if (aktion === 'abschnitt_umbenennen' && p.name === undefined) return falsch('abschnitt_umbenennen needs name (text, or null to remove it)');
      const befehl: Json = { befehl: aktion };
      for (const k of felder[aktion]) if (p[k] !== undefined) befehl[k] = p[k];
      return mitRev(p, '/proj/aendern', { label: typeof p.label === 'string' ? p.label : `Tracker ${aktion.replace('abschnitt_', 'section ')}`, befehle: [befehl] });
    } },
  // plan 1.11 tasks 8 and 10: the foreign plugins. Cypher may list, look at, read and set parameters; the scan and the plugin window are Andreas' hand only.
  // loop deck H1: the loop decks (2 decks x 4 tracks x 8 cells); routes /loopdeck/* and /loopset*
  { name: 'loopdeck', description: 'The loop decks (deck 1 or 2: 4 tracks of 8 cells, each cell holds a loop or a one-shot). A deck sounds through the container strip of the place that shows it (place N = strip N: A deck/1, B deck/2, C pad/1, D pad/2); the page shows it from the places, nothing to set. aktion: stand (both decks, beat, bpm), laden {deck, spur?, zelle?, quelle} (quelle is {loop: name}, {sha}, {modul: id, stem?} or {von_deck: 1..4}; without spur and zelle the first empty cell), '
    + 'start {deck, spur, zelle, versatz_beats?, raster?} (quantised to the grid), stopp {deck, spur?} (one track or the whole deck), szene {deck, zeile} (row 1..8 starts, others stop), sprung {deck, spur, slice 1..8} (jump inside the playing cell), raster {deck, raster}, '
    + 'zelle {deck, spur, zelle, name?, farbe?, art?, gain_db?, beats?, leeren?: true}, '
    + 'spur {deck, spur, fader_db? (-200..6), mute?, filter? (-1..1), eq? {tief, mitte, hoch} (dB -200..6; tief is LO, mitte is MID, hoch is HI), kill? {tief, mitte, hoch} booleans (a kill keeps the knob value), fx? {"1", "2", "3"} booleans (the FX 1 2 3 assignment of the track, like the 1 2 3 keys of a mixer channel; 3 sends the track into the Remix bus), send? {hall, delay} (dB -200..0; the first send opens the deck own HALL or DELAY return)} sets the channel strip of one track, '
    + 'effekt {deck, spur, graph?: name or \'\' to remove, an?: boolean} puts a Baukasten graph into the track effect slot or switches it, effekte lists the qualifying graphs {name, kurz, latenz}, set_speichern {deck, name}, set_laden {deck, name}, sets (the saved loop sets). '
    + 'Refused with 409 or 400: ki_gestoppt (Stop Cypher), zelle_leer, deck_voll (no empty cell), audio_budget (512 MiB of distinct audio), zu_lang (cell audio over 60 s), quelle_unbekannt, kein_loopdeck (that deck does not exist), nichts_gespielt (sprung on a track that never played), nur_loop (sprung on a one-shot cell), set_unbekannt, kein_platz (the 8 Baukasten stages, the 5 stages of the chain or the 4 returns are full), graph_unbekannt (not a qualifying graph). '
    + 'Also: projekt_offen, modul_nicht_umwandelbar, set_defekt, audio_fehlt, keine_uhr, zelle_laedt (the cell is still loading). szene and stopp may answer ok with abgelehnt [{spur, grund}]: tracks that refused, the rest went through. zelle leeren: true is sent alone.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['stand', 'laden', 'start', 'stopp', 'szene', 'sprung', 'raster', 'zelle', 'set_speichern', 'set_laden', 'sets', 'spur', 'effekt', 'effekte'] },
      deck: { type: 'integer', enum: [1, 2], description: 'loop deck 1 or 2' },
      spur: { type: 'integer', minimum: 1, maximum: 4 }, zelle: { type: 'integer', minimum: 1, maximum: 8 }, zeile: { type: 'integer', minimum: 1, maximum: 8 }, slice: { type: 'integer', minimum: 1, maximum: 8 },
      quelle: { type: 'object', description: 'laden: {loop: name} | {sha} | {modul: id, stem?: name} | {von_deck: 1..4}' },
      versatz_beats: { type: 'number' }, raster: { type: 'string', enum: ['1/4', '1/2', '1', 'takt', '4takte'], description: 'grid (start: for this start only; raster: the new deck grid)' },
      name: { type: 'string', description: 'zelle: cell name; set_speichern and set_laden: loop set name' }, farbe: { type: 'integer', minimum: 0, maximum: 15, description: 'cell colour 0..15' }, art: { type: 'string', enum: ['loop', 'einmal'] },
      gain_db: { type: 'number', minimum: -60, maximum: 12 }, beats: { type: 'number', minimum: 0.25, maximum: 64, description: 'a multiple of 0.25' }, leeren: { type: 'boolean' },
      fader_db: { type: 'number', minimum: -200, maximum: 6, description: 'spur: track fader in dB' }, mute: { type: 'boolean' }, filter: { type: 'number', minimum: -1, maximum: 1, description: 'spur: filter -1..1' },
      eq: { type: 'object', description: 'spur: EQ knobs in dB, -200..6', properties: { tief: { type: 'number', minimum: -200, maximum: 6 }, mitte: { type: 'number', minimum: -200, maximum: 6 }, hoch: { type: 'number', minimum: -200, maximum: 6 } } },
      kill: { type: 'object', description: 'spur: band kills, the knob value stays', properties: { tief: { type: 'boolean' }, mitte: { type: 'boolean' }, hoch: { type: 'boolean' } } },
      fx: { type: 'object', description: 'spur: FX 1 2 3 assignment of the track', properties: { '1': { type: 'boolean' }, '2': { type: 'boolean' }, '3': { type: 'boolean' } } },
      send: { type: 'object', description: 'spur: sends in dB, -200..0', properties: { hall: { type: 'number', minimum: -200, maximum: 0 }, delay: { type: 'number', minimum: -200, maximum: 0 } } },
      graph: { type: 'string', description: "effekt: graph name, '' removes the effect" }, an: { type: 'boolean', description: 'effekt: switch the effect on or off' } } },
    lauf: async (p) => {
      const falsch = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      const wege: Record<string, [string, string[]]> = {
        laden: ['/loopdeck/laden', ['deck', 'spur', 'zelle', 'quelle']],
        start: ['/loopdeck/start', ['deck', 'spur', 'zelle', 'versatz_beats', 'raster']],
        stopp: ['/loopdeck/stopp', ['deck', 'spur']],
        szene: ['/loopdeck/szene', ['deck', 'zeile']],
        sprung: ['/loopdeck/sprung', ['deck', 'spur', 'slice']],
        raster: ['/loopdeck/raster', ['deck', 'raster']],
        zelle: ['/loopdeck/zelle', ['deck', 'spur', 'zelle', 'name', 'farbe', 'art', 'gain_db', 'beats', 'leeren']],
        set_speichern: ['/loopset/speichern', ['deck', 'name']],
        set_laden: ['/loopset/laden', ['deck', 'name']],
        spur: ['/loopdeck/spur', ['deck', 'spur', 'fader_db', 'mute', 'filter', 'eq', 'kill', 'fx', 'send']],
        effekt: ['/loopdeck/effekt', ['deck', 'spur', 'graph', 'an']],
      };
      if (p.aktion === 'stand') return httpGrund('GET', '/loopdeck/stand');
      if (p.aktion === 'sets') return httpGrund('GET', '/loopsets');
      if (p.aktion === 'effekte') return httpGrund('GET', '/loopdeck/effekte');
      const weg = typeof p.aktion === 'string' && Object.hasOwn(wege, p.aktion) ? wege[p.aktion] : undefined;
      if (!weg) return falsch(`unknown aktion ${String(p.aktion)}`);
      const d: Json = {};
      for (const k of weg[1]) if (p[k] !== undefined) d[k] = p[k];
      return httpGrund('POST', weg[0], d);
    } },
  { name: 'session', description: 'The session view: the launch grid across the columns of both loop decks (columns L1.1 to L2.4 in the containers A..D that show them), scenes are rows 1..8 over all columns. '
    + 'stand returns the session stand {raster, szenen, beat, bpm, container: [{buchstabe, typ, name, spalten}], geparkt}: every column with its 8 cells ({halten: true} is a hold slot that a scene leaves alone), its play state and its mixer values. '
    + 'start {spur_id, zelle: 1..8, raster?} launches one cell (grid: raster, else the cell raster, else the session grid), stopp {spur_id?} stops one column or, without spur_id, every column. '
    + '`loopdeck szene` launches one deck\'s row; `session szene {zeile}` launches the row across all columns at one grid point: a filled cell starts, an empty slot stops its column, a hold slot is left alone, and a scene with a tempo also ramps the master tempo to it (over one beat, at the same grid point). '
    + 'raster {raster} sets the one launch grid of the live container (the session and both loop decks). '
    + 'szene_neu {nach?: 0..7} inserts an empty row after row nach (0 = at the top; absent = after the last row with content), szene_fangen {nach?} inserts a row with copies of the cells that play now (a pending launch does not count), '
    + 'szene_doppeln {zeile} copies a row right below itself, szene_loeschen {zeile} removes a row and moves the rows below up, szene_aendern {zeile, name?, farbe? 0..15, bpm? or null, takte? or null} edits a scene (null removes bpm or takte). Each write is one undo step. '
    + 'Refused with 409, 404 or 400: kein_projekt (no live project is open; the session view never opens one), zelle_leer, spur_unbekannt (no session column with that id), keine_uhr (no core clock yet), zelle_laedt (the cell is still loading), '
    + 'zeilen_voll (all 8 rows are in use, szene_neu, szene_fangen and szene_doppeln need row 8 free), ki_gestoppt (Stop Cypher), beschaeftigt (a scene with a tempo while a freeze runs; nothing of the scene is sent), argument_ungueltig. '
    + 'Cell editor (S1b): zelle {spur_id, zelle, transponieren? semitones, rueckwaerts?, blende?, scheiben?, keylock?, raster?, name?, farbe?, gain_db?, beats?, bpm?} edits a cell (null removes a field; transponieren needs keylock), '
    + 'huelle {spur_id, zelle, ziel: gain|filter|send.hall|send.delay, punkte: [{beat, wert, form?}] or null} sets or removes an envelope, scheiben {spur_id, zelle, teilung: 1/16|1/8|takt|transienten} cuts the cell into slices, '
    + 'neue_zelle {spur_id, zelle} renders the cell with its edits into a new cell in the next free slot (answers spur_id, zelle, trocken), zum_sampler {spur_id, zelle} writes the slices as a sampler kit, vorhoeren {spur_id, zelle, slot} plays one slice for me only. '
    + 'More refusals: nur_keylock (transponieren without keylock), scheiben_ungueltig, huelle_ungueltig, zellen_ungueltig (the project holds cells that fail the checks), deck_voll, audio_budget, einmal_zu_lang (scheiben on a one-shot without beats that is longer than 64 beats at its tempo: set beats and bpm by hand). '
    + 'szene and stopp may answer ok with abgelehnt [{spur_id, grund}]: columns that refused, the rest went through. szene also lists laedt [spur_id] (cells still loading, not started) and gehalten [spur_id] (hold slots, left alone); '
    + 'a scene with a tempo answers tempo (the ramp was acknowledged) or tempo_abgelehnt (the core refused it with its reason, or kein_kern when it gave no receipt), the starts of the scene stay in either case.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['stand', 'start', 'stopp', 'szene', 'raster', 'szene_neu', 'szene_fangen', 'szene_aendern', 'szene_doppeln', 'szene_loeschen', 'zelle', 'huelle', 'scheiben', 'neue_zelle', 'zum_sampler', 'vorhoeren'] },
      spur_id: { type: 'string', description: 'start, stopp, zelle, huelle, scheiben, neue_zelle, zum_sampler, vorhoeren: the column (its track id from stand)' }, zelle: { type: 'integer', minimum: 1, maximum: 8, description: 'start: the cell (row) 1..8' },
      zeile: { type: 'integer', minimum: 1, maximum: 8, description: 'szene, szene_aendern, szene_doppeln, szene_loeschen: the row 1..8' },
      raster: { type: 'string', enum: ['1/4', '1/2', '1', 'takt', '4takte'], description: 'start: for this start only; raster: the new launch grid' },
      nach: { type: 'integer', minimum: 0, maximum: 7, description: 'szene_neu, szene_fangen: insert after this row (0 = at the top)' },
      name: { type: 'string', description: 'szene_aendern: scene name, 0..32 characters' }, farbe: { type: 'integer', minimum: 0, maximum: 15, description: 'szene_aendern: scene colour 0..15' },
      bpm: { type: ['number', 'null'], description: 'szene_aendern: launching the scene ramps the tempo here (60..200); null removes it' },
      takte: { type: ['integer', 'null'], minimum: 1, maximum: 256, description: 'szene_aendern: scene length in bars; null removes it' },
      transponieren: { type: ['integer', 'null'], minimum: -24, maximum: 24, description: 'zelle: whole semitones -24..24 (needs keylock); null removes' }, rueckwaerts: { type: ['boolean', 'null'], description: 'zelle: play backwards; null removes' },
      blende: { enum: [true, null], description: 'zelle: true fades the loop seam out and in (a fixed fade, not a length); null removes' }, scheiben: { type: ['object', 'null'], description: 'zelle: {teilung, grenzen, folge} slice set; null removes' },
      keylock: { type: ['boolean', 'null'], description: 'zelle: keep the pitch; null removes' }, gain_db: { type: ['number', 'null'], description: 'zelle: cell gain in dB' },
      beats: { type: ['number', 'null'], description: 'zelle: cell length in beats' },
      ziel: { type: 'string', enum: ['gain', 'filter', 'send.hall', 'send.delay'], description: 'huelle: the envelope target' },
      punkte: { type: ['array', 'null'], items: { type: 'object' }, description: 'huelle: [{beat, wert, form?}]; null removes the envelope' },
      teilung: { type: 'string', enum: ['1/16', '1/8', 'takt', 'transienten'], description: 'scheiben: how to cut' },
      slot: { type: 'integer', minimum: 1, maximum: 64, description: 'vorhoeren: the slice' } } },
    lauf: async (p) => {
      const wege: Record<string, [string, string[]]> = {
        start: ['/session/start', ['spur_id', 'zelle', 'raster']],
        stopp: ['/session/stopp', ['spur_id']],
        szene: ['/session/szene', ['zeile']],
        raster: ['/session/raster', ['raster']],
        szene_neu: ['/session/szene_neu', ['nach']],
        szene_fangen: ['/session/szene_fangen', ['nach']],
        szene_aendern: ['/session/szene_aendern', ['zeile', 'name', 'farbe', 'bpm', 'takte']],
        szene_doppeln: ['/session/szene_doppeln', ['zeile']],
        szene_loeschen: ['/session/szene_loeschen', ['zeile']],
        zelle: ['/session/zelle', ['spur_id', 'zelle', 'transponieren', 'rueckwaerts', 'blende', 'scheiben', 'keylock', 'raster', 'name', 'farbe', 'gain_db', 'beats', 'bpm']],
        huelle: ['/session/huelle', ['spur_id', 'zelle', 'ziel', 'punkte']],
        scheiben: ['/session/scheiben', ['spur_id', 'zelle', 'teilung']],
        neue_zelle: ['/session/neue_zelle', ['spur_id', 'zelle']],
        zum_sampler: ['/session/zum_sampler', ['spur_id', 'zelle']],
        vorhoeren: ['/session/vorhoeren', ['spur_id', 'zelle', 'slot']],
      };
      if (p.aktion === 'stand') return httpGrund('GET', '/session/stand');
      const weg = typeof p.aktion === 'string' && Object.hasOwn(wege, p.aktion) ? wege[p.aktion] : undefined;
      if (!weg) return { code: 400, j: { fehler: 'argument_ungueltig', text: `unknown aktion ${String(p.aktion)}` } };
      const d: Json = {};
      for (const k of weg[1]) if (p[k] !== undefined) d[k] = p[k];
      return httpGrund('POST', weg[0], d);
    } },
  { name: 'box', description: 'Loop 1 / Loop 2 are loop deck 1 / 2. laden (name from the loop library) loads that library loop into a cell of the loop deck (POST /loopdeck/laden with the source {loop: name}): spur 1..4 and zelle 1..8 pick the cell, without them the first empty cell is used. Refused: ki_gestoppt, deck_voll, quelle_unbekannt, zu_lang, audio_budget, kein_loopdeck. '
    + 'start and stopp are gone: start a cell with loopdeck start, stop with loopdeck stopp, so they answer box_ersetzt.',
    inputSchema: { type: 'object', required: ['box', 'aktion'], properties: { box: { type: 'integer', enum: [1, 2] }, aktion: { type: 'string', enum: ['laden', 'start', 'stopp'] }, name: { type: 'string' },
      spur: { type: 'integer', minimum: 1, maximum: 4 }, zelle: { type: 'integer', minimum: 1, maximum: 8 } } },
    lauf: async (p) => {
      if (p.aktion !== 'laden') return { code: 409, j: { fehler: 'box_ersetzt', text: 'the core loop boxes are replaced by the loop decks: load with box laden, start and stop cells with loopdeck start and loopdeck stopp' } };
      if (typeof p.name !== 'string') return { code: 400, j: { fehler: 'argument_ungueltig', text: 'box laden needs name (a loop of the loop library)' } };
      const d: Json = { deck: p.box };
      if (p.spur !== undefined) d.spur = p.spur;
      if (p.zelle !== undefined) d.zelle = p.zelle;
      d.quelle = { loop: p.name };
      return httpGrund('POST', '/loopdeck/laden', d);
    } },
  { name: 'regler', description: 'Move a mixer control, optionally as a ramp over bars (my way to blend: channel fader, EQ, filter). Paths: deck/1|2/(fader|trim|eq/tief|eq/mitte|eq/hoch|kill/tief|kill/mitte|kill/hoch|filter), pad/1|2/... (deck/1, deck/2, pad/1 and pad/2 are the four container strips of the places A..D; pad/1 and pad/2 are the strips of places C and D, whatever the place holds; deck/N of a place that holds a SEQ deck and no loaded track opens without a hearing pass, a loaded track needs the pass: a stopped track on such a place is ejected by the first refused open, the answer says seq_geleert, then retry), the player rows deck/N/stem/*, erz/<n>/(fader|pfl|eq/*|kill/*|filter|bk/k) as aliases of the strip that plays stream n (the page server resolves them; with no strudel module placed they answer kein_strudel_modul), fx/1|2/(notenwert|rueckkopplung|rueckweg), duck/tiefe (dB -24..0, 0 = off: kick ducks bass and melody), duck/release (ms 50..600). <kanal>/komp/(an 0/1, schwelle dB -60..0, ratio 1..20, attack ms 0.1..100, release ms 10..1000, makeup dB 0..24, mix 0..1, sc 0..14 = sidechain key: 0 own signal, else source channel + 1, erz/1 = 5): compressor per source channel (container strips and stream aliases), after EQ/filter, before the fader; off by default. color/art (sound color FX like the XDJ-XZ, global for all channels: 0 FILTER, 1 SPACE, 2 DUB ECHO, 3 SWEEP, 4 NOISE, 5 CRUSH; set only, use ab:jetzt) and color/param (PARAMETER 0..1, default 0.5): the filter knob of every channel is the COLOR knob, center = dry, SPACE and DUB ECHO tails ring out when it returns to center. <kanal>/bk/1..64 (deck/1|2, pad/1|2, erz/1|2|3|5|6|7; 0..1, start value: the graph\'s own default, 0.5 where it has none; smoothed 20 ms in the engine) steer the knobs (up to 64, as many as the graph defines) of the graph loaded on that channel (effect graph or instrument graph on a container strip or an erz stream); a channel without a graph ignores them. fx/3/bk/1..64, fx/4/bk/1..64 (same range) steer the knobs of the effect graph on that send return. master/bk/1..64 (same range) steer the knobs of the effect graph on the DJ master sum (master insert, graph kanal \'master\'). Mix tools: <source>/gate/(an 0/1, schwelle dBFS -90..0, hysterese dB 0..24, ratio 1..100 = 100 hard gate, bereich dB -120..0, attack ms 0.1..500, hold ms 0..2000, release ms 1..5000, sc 0..14 = sidechain key as komp/sc) on deck/1|2 and pad/1|2 (the container strips; streams and their erz aliases have no gate rows); <source or bus>/util/(balance -1..1, breite % 0..200, bassmono Hz 0..500 = off, phase_l|phase_r|tausch|dc 0/1) on those and bus/1..4; bus/1..4 only: mb/an 0/1, mb/grenze_tief|grenze_hoch Hz 20..20000, mb/(tief|mitte|hoch)/(schwelle dB -60..0, ratio 1..20, attack ms 0.1..500, release ms 1..5000, knie dB 0..24, makeup dB -24..24 = trim on top of the automatic make-up, umgehen 0/1) = three-band compressor (every band adds back its own average gain reduction by itself, so compressing a band does not make it quieter; makeup 0 = automatic only), lim/(an 0/1, decke dBFS -60..0, abklingen ms 1..2000) = channel limiter (does nothing while kern.toml kanal_limiter_vorhalt_ms is 0, the default); global spektrum/kanal (0 off, 1..4 = the containers A..D = deck/1, deck/2, pad/1, pad/2, 5..8 = bus/1..4, 9 = master sum) picks the analyser source. All off or neutral by default, none of them counts as making things quieter for my autonomy. keylock (0/1, set only, default 1): one switch for all sources (decks, loop decks), 1 keeps the pitch at any tempo, 0 = varispeed. <kanal>/send/2 feeds the reverb (fx/2 return, 0 dB default; send -200..0 dB, -200 = off). trim is the hand part of the gain and ADDS to trim_auto, the read-only automatic gain of the loaded track (set at load, shown in lage as <strip>/trim_auto, refused as a write; a strip with no track reads 0). Units: fader/trim/eq in dB (fader -200..0, eq -200..+6), filter -1..+1, kill 0/1. Crossfader, master (master/pegel, master/kleber = threshold of the sum compressor 0..1, 0 = off), the channel targets and crossfader sides (<kanal>/ziel, <kanal>/xseite), PFL, cue/mix, cue/split, master/pfl, grp/<n>/cue and the bus faders are mine to move too. Still Andreas\' hand only (nur_hand): cue/pegel (the headphone level at his ears) and deck/<n>/transport (a holder of the jog, no value; use deck_start and deck_stopp). A raise of master/pegel, of a bus/<n>/fader or of the fader or trim of a loops or stems container by more than 6 dB must be a ramp of at least 1 bar (takte >= 1), else it is refused with nur_rampe; an unknown current level counts as quiet, so a set above -20 dB needs a ramp then. Stop Cypher still stops everything, including fx/routing and the live keys (ki_gestoppt). Opening a closed channel (trim+fader above -26 dB, deck/1|2 only) needs a valid hearing check from hoeren (urteil ok); the server attaches it. erz channels and container strips open freely with regler, whatever they play (the loops and stems strips are no longer refused), bus channels pass the hearing check as well, and while my ramp on a container is open I cannot load foreign material into it (box_offen_oder_faehrt). Automation tracks (spur) still may not open container strips. Andreas touching the control aborts my ramp (status 7 hand). A move into my own running ramp on the same path is queued to the ramp\'s end (verschoben_auf). Rejections at the start beat itself only show in lage (quittungen). Project mixer paths (spur/1..128/*, grp/1..16/*, pm/fader, the sends spur|grp/n/send/1..8, the returns ret/1..8/* and the insert stages ins/komp/1..160/* (an, schwelle, ratio, knie, attack, release, makeup, mix, schp, sc), ins/eq/1..160/* (an, out, propq, b1..b8/an|typ|freq|gain|q|steil|platz, and the dynamic bands d1..d8/dyn 0..4 (not a lane target)|schwelle dB -60..0|bereich dB -24..24, dyn_attack ms 0.1..100, dyn_release ms 5..1000) ins/saett/1..32/* (an, drive, out, mix, kurve 0..2, decke dBFS -24..0), ins/trans/1..32/* (an, angriff dB -24..24, halten dB -24..24, tempo ms 1..100, out dB -24..12, mix 0..1), ins/bild/1..16/* (an, grenze_tief Hz 40..1000, grenze_hoch Hz 1000..12000, breite_tief 0..1, breite_mitte 0..2, breite_hoch 0..2, mono_unter Hz 0..300) and ins/lim/1..8/* (an, decke dBFS -60..0, abklingen ms 1..2000) and ins/utility/1..8/* (an, breite 0..4, mono_unter Hz, gain dB, balance) and ins/gate/1..16/* and ins/mb/1..8/* (an plus the values of the kind, mb as b1..b3/<name>) and the rack macros rack/1..12/m1..m4) are refused with ueber_projekt: they change only through the project (proj_aendern: spur_aendern, gruppenspur_aendern, master_aendern, send_setzen, return_aendern, insert_setzen, insert_param_setzen, insert_an, insert_entfernen, insert_ordnung, rack_setzen, rack_makro).',
    inputSchema: { type: 'object', required: ['pfad', 'nach'], properties: { pfad: { type: 'string' }, nach: zahl('target value'),
      takte: zahl('ramp length in bars (0 = set)', { minimum: 0, maximum: 64 }), ab, form: { type: 'string', enum: ['s', 'linear'] } } },
    lauf: (p) => http('POST', '/regler', p) },
  { name: 'fx', description: 'Beat FX unit 1 or 2: art 1-8 (1 echo, 2 flanger, 3 phaser, 4 filter, 5 reverb: beats = decay time, param1 = size; 6 delay: one repeat, param1 = tone; 7 ping pong: repeats alternate left/right, param1 = feedback; 8 trans: beat gate, param1 = duty; 9 roll: records at on, repeats in beat length; 10 slip roll: like roll, re-records when beats change; 11 vinyl brake: slows to a stop over beats; 12 spiral: echo whose pitch glides when beats change, param1 = feedback), beats, wet 0..1, params 0..1, an. Only while AUTO is on and I am not stopped.',
    inputSchema: { type: 'object', required: ['einheit', 'art', 'beats', 'wet', 'an'], properties: { einheit: { type: 'integer', enum: [1, 2] },
      art: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, beats: { type: 'number' }, wet: zahl('0..1'), param1: zahl('0..1'), param2: zahl('0..1'), param3: zahl('0..1'), an: { type: 'boolean' } } },
    lauf: (p) => http('POST', '/fx', { param1: 0.5, param2: 0.5, param3: 0.5, ...p }) },
  { name: 'fx_zuweisung', description: 'Assign a channel to Beat FX 1 or 2 (kanal like deck/1, pad/1, erz/1, master), or to unit 3, the insert on fx/3 that carries the remix graph (any source channel such as deck/1|2, pad/1|2, erz/1..8, never master).',
    inputSchema: { type: 'object', required: ['einheit', 'kanal', 'an'], properties: { einheit: { type: 'integer', enum: [1, 2, 3] }, kanal: { type: 'string' }, an: { type: 'boolean' } } },
    lauf: (p) => http('POST', '/fx/zuweisung', p) },
  { name: 'graphen', description: 'Baukasten graphs in the graph folder (CYPHERDJ_BK_ORDNER, else $HOME/.config/cypherdj/baukasten, which is a link to the devices folder of the home folder, by default ~/cypherdj/werke/geraete, once the layout of INSTALL.md section 8 is in use): name, art (instrument = a synth/sampler that plays the notes of a Strudel stream; effekt = an insert with an input), regler_namen (the names of its knobs, numbered 1..64) and geladen (which graph sits on which channel, as the kern reports it; geladen_geprueft_vor_ms = age of the last kern report in ms, null = not known yet). uebersprungen lists files that were not usable (bad name or JSON). Free to read.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/graphen') },
  { name: 'graph', description: 'Put a Baukasten graph on a channel or take it off again (name "" removes). Instruments (art instrument) go on erz/2 (bass stream) or erz/3 (melody stream) and REPLACE that stream\'s sound (Surge or the Cypher synth) until removed (after a restart of the kern alone the page server loads the graph again; a full studio stop and start begins without it); the stream keeps playing its pattern through the graph. More instrument streams: erz/5, erz/6, erz/7 (streams 5, 6, 7) and erz/9, erz/10 (streams 9, 10, ordinary streams like the others). Streams 5..10 are played by one extra erzeuger process (djk/start/djk-stroeme, or djk-start --bk-stroeme); without it the call fails with kein_erzeuger. Write their patterns with strudel (strom 5, 6, 7, 9, 10); a stream parked without a graph is silent. erz/1 is a drum kit stream: no instrument there. Effects (art effekt) go on the container strips deck/1|2 and pad/1|2, the send returns fx/3, fx/4 or the DJ master sum (master: an insert that replaces the sum just before the master FX and the master fader; needs an eingang node, latency 0); their knobs are fx/3/bk/1..64, fx/4/bk/1..64, master/bk/1..64 (regler). Effects also go, as an insert on the channel before its fader, on erz/1..3 (Strudel drums, bass, melody) as an insert of the container strips (pad/1 and pad/2 are the strips of places C and D), knobs <kanal>/bk/1..64; a channel holds one graph: an effect on erz/2, erz/3 is refused with belegt while an instrument graph plays there, and the other way round. Sampler graphs read their files from <graph folder>/samples/ and may take a few seconds to load (the call waits up to 4 s; quittung null = no answer yet; graphen.geladen shows the kern state as soon as it has loaded). Refused while Stop Cypher is set (ki_gestoppt) and, for erz/N, while AUTO of that stream is off (auto_aus). A kern refusal comes back as a tool error with its reason (pruefung, kein_eingang, ...).',
    inputSchema: { type: 'object', required: ['kanal', 'name'], properties: { kanal: { type: 'string', enum: ['erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2', 'deck/1', 'deck/2', 'fx/3', 'fx/4', 'master', 'erz/1'] }, name: { type: 'string', description: 'graph name from graphen, or "" to remove' } } },
    lauf: (p) => http('POST', '/graph', { kanal: p.kanal, name: p.name }) },
  // Strand 11 task 7.10: voice phrases (WAV files made beforehand) become one slotted loop, are cut and put on an instrument channel.
  { name: 'stimme', description: 'Voice phrases as a playable instrument: turns several WAV files (one phrase each; make the WAVs first, this tool does no speech synthesis) into one loop of equal slots (stil roh = trimmed and levelled, fluester = whispered with a short echo), '
      + 'cuts it into one slice per phrase (method raster, scheiben = number of phrases unless given) and puts the cut on a channel. dateien = absolute paths of the WAVs (the order is the phrase order), takte = bars per phrase slot (default 1), name = loop name (refused when a loop of that name exists), '
      + 'kanal = erz/5, erz/6, erz/7, pad/1 or pad/2. Answers {loop, schnitt, kanal, noten}: noten is "note n-1 = phrase n" (play note 0 for the first phrase).',
    inputSchema: { type: 'object', required: ['dateien', 'stil', 'name', 'kanal'], properties: {
      dateien: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'absolute paths of the phrase WAV files, one phrase each' },
      stil: { type: 'string', enum: ['roh', 'fluester'] },
      takte: { type: 'integer', minimum: 1, maximum: 16, description: 'bars per phrase slot (default 1)' },
      name: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$', description: 'name of the new loop' },
      kanal: { type: 'string', enum: ['erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'] },
      scheiben: { type: 'integer', minimum: 1, maximum: 64, description: 'slices of the cut (default: the number of phrases)' } } },
    lauf: async (p) => {
      const nein = (text: string) => fehlerAntwort(400, 'argument_ungueltig', text);
      const d = p.dateien;
      if (!Array.isArray(d) || d.length === 0 || d.some((x) => typeof x !== 'string' || !path.isAbsolute(x))) return nein('dateien must be a non-empty list of absolute paths');
      if (p.stil !== 'roh' && p.stil !== 'fluester') return nein('stil must be roh or fluester');
      if (typeof p.name !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(p.name)) return nein('name must match [A-Za-z0-9_-]{1,40}');
      if (!['erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'].includes(p.kanal as string)) return nein('kanal must be erz/5, erz/6, erz/7, pad/1 or pad/2');
      if (p.takte !== undefined && (!Number.isInteger(p.takte) || (p.takte as number) < 1 || (p.takte as number) > 16)) return nein('takte must be an integer 1..16');
      if (p.scheiben !== undefined && (!Number.isInteger(p.scheiben) || (p.scheiben as number) < 1 || (p.scheiben as number) > 64)) return nein('scheiben must be an integer 1..64');
      const cli = process.env.DJK_STIMME_BAUEN;
      const skript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'voice_build.py');
      const argv = [...(d as string[]), '--stil', p.stil, '--name', p.name, '--loops', loopOrdnerVorgabe(INSTANZ), ...(p.takte !== undefined ? ['--takte', String(p.takte)] : [])];
      const lauf = await new Promise<{ ok: boolean; text: string }>((ok) => execFile(cli ?? 'python3', cli ? argv : [skript, ...argv], { timeout: 120000 }, (e, aus, err) =>
        ok(e ? { ok: false, text: err.trim() || e.message } : { ok: true, text: aus })));
      if (!lauf.ok) return fehlerAntwort(500, 'stimme_bauen_gescheitert', lauf.text);
      const schnitt = await http('POST', '/sampler/schnitt', { quelle: { art: 'loop', ref: p.name }, name: p.name, methode: 'raster', scheiben: p.scheiben ?? d.length });
      const sid = (schnitt.j.schnitt as Json | undefined)?.id;
      if (schnitt.code !== 200 || typeof sid !== 'string') return schnitt.code === 200 ? fehlerAntwort(502, 'schnitt_ohne_id', 'the page server answered the cut without an id') : schnitt;
      const g = await http('POST', '/graph', { kanal: p.kanal, name: sid });
      if (g.code !== 200) return g;
      return { code: 200, j: { loop: p.name, schnitt: sid, kanal: p.kanal, noten: 'note n-1 = phrase n' } };
    } },
  { name: 'strudel', description: 'Send a Strudel pattern to one of the instances: strom 1 drums (erz/1), 2 bass (erz/2), 3 melody (erz/3); with the extra erzeuger process (djk-stroeme) also 5, 6, 7 (erz/5..7) and 9, 10 (erz/9, erz/10: ordinary streams), any stream of the shared table; a stream without a track gets one, and the streams above 3 sound only through a Baukasten graph (graph). A strudel module must be placed in a place (otherwise the call is refused with kein_strudel_modul). Plays from the next bar. Only while Andreas has AUTO on for that instance (auto_aus otherwise). A pattern without any onset in the 16 bars from the next bar on counts as silence, like `silence`: it releases notes that are still held at that bar line (a sparse pattern such as `.slow(32)` is silence in this sense and cuts a held long note; a pattern with an onset inside the 16 bars never does, held notes then ring to their own end). After the next bar, studio shows status.taub: Strudel fields that do not sound in this studio (cutoff = lpf, hcutoff = hpf, room, delay, fmi ...); do not rely on them. taub lists at least these fields once taub_muster equals nr (fields first heard in later bars are added). '
      + 'Pattern methods .rein(n) and .raus(n) fade a layer in or out: time zero is the bar where THIS pattern starts to apply (its switch bar), not the global cycle, and n is the number of bars. .rein(n) scales the level of every note onset by k squared (k = 0 at the switch bar, 1 after n bars), .raus(n) by (1-k) squared, so a .raus layer is silent after n bars but still sends its onsets; n must be > 0 (compile error otherwise). The factor multiplies gain if the pattern sets one, else velocity, else it becomes the gain. It acts per note onset: a held pad note does not fade, use a fader ramp (spur) for that. Send the next pattern without the .raus layers. '
      + 'bezeichnung (1..60 characters) names what the stream plays in plain words Andreas can say back ("conga", "acid line"); it is shown on the channel strip of the studio page and in lage studio.stroeme. Always name what you play. Every pattern write replaces the label, a write without bezeichnung (also silence) clears it. '
      + 'To make a stream follow a chord sequence, set the lane with harmonie and use .harm(oktave) or .akkordton(oktave) in the pattern.',
    inputSchema: { type: 'object', required: ['code'], properties: { code: { type: 'string' }, strom: { type: 'integer', enum: [...ALLE_STROEME] }, bezeichnung: { type: 'string', minLength: 1, maxLength: 60, description: 'what this stream plays, in plain words ("conga", "acid line")' } } },
    lauf: (p) => http('POST', '/strudel', { text: p.code, strom: p.strom ?? 1, ...(p.bezeichnung !== undefined ? { bezeichnung: p.bezeichnung } : {}) }) },
  { name: 'harmonie', description: 'Live harmony lane: a repeating chord sequence that the Strudel streams follow, so bass, pad and melody stay in one key and change chord together. Set it with folge, chord symbols separated by spaces ("Am7 Dm7 G7 Cmaj7"), takte_je_akkord bars per chord (1, 2, 4 or 8; default 1), optionally tonart ("A minor"; otherwise found from the chords). The lane starts at the next bar (ab takt, default) or the next phrase (ab phrase), or at anker_takt (an absolute bar; refused with anker_vorbei if it has passed); the sequence repeats from there. '
      + 'A change is ONE call: the generator re-plans every stream from that bar, so all of them land on the same downbeat. aus true switches the lane off (no folge needed). probe true only checks the symbols and answers without writing. '
      + 'In a Strudel pattern (strudel) use .harm(oktave) for scale degrees of the lane key, e.g. n("0 2 4 7").harm(2) is a bass on degrees, and .akkordton(oktave) for the tones of the lane chord, e.g. n("[0,1,2]").akkordton(4) is a pad. '
      + 'studio status.harmonie.fremd counts, per stream, planned notes that lie outside the lane. lage harmonie shows the lane now (chord now, next change bar). The lane is session state, not a project change: no undo, like strudel. Refused while Stop Cypher is set (ki_gestoppt). Bad symbols give argument_ungueltig naming the symbol.',
    inputSchema: { type: 'object', properties: { folge: { type: 'string', description: 'chord symbols separated by spaces, e.g. "Am7 Dm7 G7 Cmaj7"; required unless aus' }, takte_je_akkord: { type: 'integer', enum: [1, 2, 4, 8] }, tonart: { type: 'string', description: 'e.g. "A minor"' }, ab: { type: 'string', enum: ['takt', 'phrase'] }, anker_takt: { type: 'integer', description: 'absolute bar where the lane starts' }, probe: { type: 'boolean' }, aus: { type: 'boolean' } } },
    lauf: (p) => {
      const k = {};
      for (const f of ['folge', 'takte_je_akkord', 'tonart', 'ab', 'anker_takt', 'probe', 'aus']) if (p[f] !== undefined) k[f] = p[f];
      return http('POST', '/harmonie', k);
    } },
  { name: 'abbrechen', description: 'Abort all my running and waiting ramps and deck commands; values stay where they are.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('POST', '/abbruch', {}) },
  { name: 'tempo', description: 'Set the master tempo (60-200 BPM): a 4-beat ramp starting on the next bar. Loop decks, REC, Strudel and playing decks follow; a deck also starts at any tempo. All sources keep their pitch (keylock, on by default; `keylock` via regler). lage regler.keylock: 1 on, 0 off, null unknown. With keylock off decks and loop decks follow in varispeed: their pitch moves with the tempo (128 -> 132 is +0.5 semitones). Exceptions with keylock on, still varispeed: a deck in a loop (until loops get keylock), a core started without keylock (kern.toml keylock = false), and about 0.1 s after each deck event (start, jump, hotcue) until the stretcher takes over; lage decks[].hoerweg 1 means the pitch is held. Refused while Stop Cypher is set (ki_gestoppt) and while a project freeze runs (beschaeftigt: proj_freeze, or the freeze inside proj_export; ask again when it is done).',
    inputSchema: { type: 'object', required: ['bpm'], properties: { bpm: zahl('target BPM', { minimum: 60, maximum: 200 }) } },
    lauf: (p) => http('POST', '/tempo', { bpm: p.bpm }) },
  { name: 'ansage', description: 'Show one line on the studio page over every view: what I am doing now, for an audience (demo overlay). Up to 300 characters; an empty text hides it. It fades by itself after a reading time. Speaking through cypher-say with CYPHER_SAY_ZIEL=studio sets the spoken sentence as the line already (shown in the voice colour).',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 300, description: 'the line, empty = hide' } } },
    lauf: (p) => http('POST', '/ansage', { text: p.text }) },
  { name: 'warte', description: 'Wait on the master clock, then return the state (lage), with the same optional kurz and felder (the diff runs against the last answer this hand gave, not against the polls inside the wait). '
      + 'Default: takte 1-8 bars. With bis "spur_ende" and name (an automation track): wait until that track is vorher_takte bars (0-64, default 4) before its end and answer {grund: "vorher", rest_takte, ...lage}; '
      + 'grund "gestoppt" = the track vanished before its end (stopped), "beendet" = it ended on its own; an unknown name at the first poll is refused with spur_unbekannt. '
      + 'The wait has one fixed deadline set at the first poll (the remaining bars at 60 BPM plus 30 s, at most 15 minutes): when it is reached the answer is {bis: "frist", rest_takte, ...lage}; a master clock that has not moved for 10 s ends it with {bis: "uhr_steht", ...}. Bars are counted with the meter of lage (taktart), 4 beats when absent. '
      + 'Polls every 2 s. For a loop track ende_beat is the end of the pass that is running now, so the wait ends before this pass, not before the loop as a whole.',
    inputSchema: { type: 'object', properties: { takte: { type: 'integer', minimum: 1, maximum: 8 }, bis: { type: 'string', enum: ['spur_ende'] },
      name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$', description: 'bis spur_ende: the track name' }, vorher_takte: { type: 'integer', minimum: 0, maximum: 64, default: 4 },
      kurz: { type: 'boolean' }, felder: { type: 'array', items: { type: 'string' } } } },
    lauf: async (p) => {
      if (p.bis === 'spur_ende') {
        if (typeof p.name !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(p.name)) return { code: 400, j: { fehler: 'name_fehlt', text: 'bis spur_ende needs name (the track name)' } };
        const vorher = p.vorher_takte === undefined ? 4 : Number(p.vorher_takte);
        if (!Number.isInteger(vorher) || vorher < 0 || vorher > 64) return { code: 400, j: { fehler: 'vorher_takte', text: 'vorher_takte: integer 0..64' } };
        let frist = 0, letztesEnde = Infinity, erste = true, letzterBeat = -Infinity, bewegtSeit = Date.now();
        for (;;) {
          const [sp, l] = [await http('GET', '/spur'), await http('GET', '/lage')];
          const beat = (l.j as { uhr?: { beat?: number } }).uhr?.beat;
          if (typeof beat !== 'number') return { code: l.code >= 400 ? l.code : 502, j: { fehler: 'keine_uhr', text: 'GET /lage carries no master clock beat', lage: l.j } };
          const proTakt = proTaktVon(l.j);
          const liste = Array.isArray(sp.j) ? sp.j as { name?: string; ende_beat?: number }[] : [];
          const e = liste.find((x) => x.name === p.name);
          if (e === undefined || typeof e.ende_beat !== 'number') {
            if (erste) return { code: 404, j: { fehler: 'spur_unbekannt', text: `no running automation track named ${String(p.name)}` } };
            const grund = beat < letztesEnde ? 'gestoppt' : 'beendet';
            const f = lageForm(l, p);
            return f.code === 200 ? { code: 200, j: { grund, ...f.j } } : f;
          }
          const restBeats = e.ende_beat - beat;
          if (erste) frist = Date.now() + Math.min(WARTE_FRIST_MAX_MS, Math.max(0, restBeats) * 1000 + 30_000);   // one fixed deadline: the end at 60 BPM plus 30 s, capped
          erste = false; letztesEnde = e.ende_beat;
          if (restBeats <= proTakt * vorher) {
            const f = lageForm(l, p);
            return f.code === 200 ? { code: 200, j: { grund: 'vorher', rest_takte: Math.max(0, restBeats) / proTakt, ...f.j } } : f;
          }
          if (beat > letzterBeat) { letzterBeat = beat; bewegtSeit = Date.now(); }
          const bis = Date.now() - bewegtSeit >= 10_000 ? 'uhr_steht' : Date.now() > frist ? 'frist' : null;   // a stopped clock or the deadline ends the wait
          if (bis) {
            const f = lageForm(l, p);
            return f.code === 200 ? { code: 200, j: { bis, rest_takte: Math.max(0, restBeats) / proTakt, ...f.j } } : f;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!Number.isInteger(p.takte) || Number(p.takte) < 1 || Number(p.takte) > 8) return { code: 400, j: { fehler: 'takte', text: 'takte: integer 1..8 (or bis spur_ende with name)' } };
      const l0 = (await http('GET', '/lage')).j as { uhr: { beat: number } };
      const start = l0.uhr.beat, ziel = start + proTaktVon(l0) * Number(p.takte);
      const t0 = Date.now();
      // Frist: the time the bars take at the slowest master tempo (60 BPM, ramps may slow down on the way) plus 10 s; a fixed 30 s cut 8 bars short below 64 BPM (audit U28).
      const fristMs = proTaktVon(l0) * Number(p.takte) * 60_000 / 60 + 10_000;
      for (;;) {
        const l = await http('GET', '/lage');
        if ((l.j as { uhr: { beat: number } }).uhr.beat >= ziel) return lageForm(l, p);
        if (Date.now() - t0 > fristMs) return { code: 504, j: { fehler: 'warte_frist', text: `the master clock did not reach beat ${ziel} within ${Math.round(fristMs / 1000)} s (clock stopped?)`, lage: l.j } };
        await new Promise((r) => setTimeout(r, 100));
      }
    } },
  { name: 'hoeren', description: 'Listen to a deck behind its fader: six bands, loudness, peak, overlap with the '
      + 'running master per band, level difference, EQ suggestion (tief/mitte/hoch in dB) and bass swap hint. Works '
      + 'on a CLOSED deck: start it with deck_start first, wait 4 bars. A place that carries a SEQ deck (deck = the place number 1 to 4) is heard the same way: the SEQ deck plays into the strip of deck/N, so no deck_start is needed, the project transport (proj_transport start) must run and the pattern must not be muted. Use it again after changing EQ or trim. '
      + 'vergleich.trim_vorschlag_db is the absolute target for deck/N/trim in dB (current trim minus the level difference, clamped to -24..+24), meaningful only while the deck is closed; trim_unbekannt: true instead means the studio does not know the current trim (after a server restart), so no suggestion; none either if one side is silent. sync.partner names the deck that sync.deck_gegen_deck_ms was measured against, null without a running deck that has an open channel; a SEQ place is never a partner.',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck: deck12,
      takte: { type: 'integer', minimum: 1, maximum: 16, default: 4, description: 'bars to measure (default: 4)' } } },
    lauf: (p) => http('GET', `/hoeren?deck=${p.deck}&takte=${p.takte ?? 4}`) },
  { name: 'studio', description: 'Studio state of the Strudel instances (1 drums, 2 bass, 3 melody, plus the Baukasten streams 5, 6, 7, 9, 10 while their erzeuger runs): current pattern, AUTO flag (autonom) and author (von) per instance. Call before playing: AUTO off means Andreas holds that instance and my writes are refused (auto_aus). status.taub lists Strudel fields of the current pattern that do not sound here (at least these once taub_muster equals nr; fields first heard in later bars are added). With a harmony lane set (harmonie), status.harmonie per stream is {noten, fremd, fremd_toene}: planned notes, and how many of them (and which tones) lie outside the lane.',
    inputSchema: { type: 'object', properties: {} },
    lauf: async () => {
      const stroeme: Json[] = [];
      let code = 200;
      for (const strom of await stroemeListe()) {
        const r = await http('GET', `/strudel?strom=${strom}`);
        code = Math.max(code, r.code);
        stroeme.push({ strom, ...r.j });
      }
      return { code, j: { stroeme } };
    } },
  { name: 'loops', description: 'Loop library: name, beats and source of every recorded loop. still true = the file is digital silence (it loads but plays nothing; do not build on it). Use the names with box (laden) and loop_klang.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/loops') },
  { name: 'rec', description: 'Record the Strudel generators before trim into the loop library: DRUMS (erz/1) alone, or with summe: true the sum DRUMS + BASS + MELODY (erz/1+2+3; not the master, no fader, no FX, the sum can exceed 0 dB: set gain_db of the loop deck cell). beats 1, 2, 4, 8, 16 or 32, name [a-z0-9_-]{1,32}. Starts on the next multiple of beats. Works at any steady tempo (the loop is stored at 128 BPM and plays back at the master tempo); refused with ausserhalb_bereich while a tempo ramp is running or queued, and by the core while Stop Cypher is set or when a recording overlaps.',
    inputSchema: { type: 'object', required: ['beats', 'name'], properties: { beats: { type: 'integer', enum: [1, 2, 4, 8, 16, 32] }, name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' }, summe: { type: 'boolean', description: 'true: sum of erz/1+2+3 instead of erz/1' } } },
    lauf: (p) => http('POST', '/loop', { aktion: 'rec', beats: p.beats, name: p.name, ...(p.summe !== undefined ? { summe: p.summe } : {}) }) },
  { name: 'loop_klang', description: 'Turn a library loop into a Strudel sound rec0, rec1, ... (add-on to the drums kit), playable as s("rec0") without restart. Reloads the drums kit: it may cut sounding voices, so do it between phrases, not mid-fill. Refused while Stop Cypher is set or AUTO of instance 1 (drums) is off.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'loop name from loops' }, klang: { type: 'string', description: 'optional sound name' } } },
    lauf: (p) => http('POST', '/loop', { aktion: 'kit', name: p.name, ...(p.klang !== undefined ? { klang: p.klang } : {}) }) },
  { name: 'spur', description: 'Start an automation track: a list of moves on the bar grid, anchored at the next bar (ab: takt, default) or the next phrase (ab: phrase, 8 bars). Arguments: name [a-z0-9_-]{1,32}, fahrten, ab, anker_takt, probe. '
      + 'The anchor is the next bar or phrase on the absolute phrase grid (bar 1 mod 8); lage uhr.naechster_takt / uhr.naechste_phrase_takt name those bars now. anker_takt n (integer >= 1, at most 256 bars ahead) anchors at the absolute bar n instead of ab (not together with ab; anker_vorbei when it is already past, the answer names fruehester_takt). probe: true runs every check and answers the plan (anker_beat, anker_takt, ende_beat, muster) without scheduling anything, so you know the anchor before it fires. '
      + 'Each move: {ziel, ab_takt, takte?, nach?, von?, form?: "s"|"linear", muster?}. Targets (ziel): mixer paths (erz/2/filter, deck/1/eq/tief, ...), wirt:bass/<param> and wirt:melodie/<param> (Surge parameters), strom:<n> for n in 1, 2, 3, 5, 6, 7, 9, 10 (with muster: switch that stream\'s pattern at ab_takt; the Baukasten streams 5, 6, 7, 9, 10 need their generator running, else strom_ohne_erzeuger). A move on a DISCRETE Surge parameter of wirt:bass/<param> or wirt:melodie/<param> (one that is not continuous: a switch, a type, a mode) is a set: nach is the value, takte 0 or absent, no von, no form, not inside a loop. The host reloads its state at that beat, so use a silent beat: the reload cuts sounding notes. Sets of one host on the same beat travel together; spur_stopp drops sets still waiting. '
      + 'A track may not open a closed channel and may not touch an instance whose AUTO is off. Andreas touching a control aborts the move on it. Stop it with spur_stopp. '
      + 'Track mixer paths spur/1..128/* (fader, pan, mute, solo of a project track) and the group and master paths grp/1..16/* and pm/fader, the send paths spur|grp/n/send/1..8, the return paths ret/1..8/* (fader, pan, mute, solo, hall/*) and the insert stage paths ins/komp/1..160/*, ins/eq/1..160/* (also d1..d8/dyn|schwelle|bereich, dyn_attack, dyn_release), ins/saett/1..32/* (an, drive, out, mix, kurve, decke), ins/trans/1..32/* (an, angriff, halten, tempo, out, mix), ins/bild/1..16/* (an, grenze_tief, grenze_hoch, breite_tief, breite_mitte, breite_hoch, mono_unter), ins/lim/1..8/* (an, decke dBFS -60..0, abklingen ms 1..2000) and ins/utility/1..8/* and ins/gate/1..16/* and ins/mb/1..8/* and the rack macro paths rack/1..12/m1..m4 are refused with ueber_projekt: they change only through the project (proj_aendern: spur_aendern, gruppenspur_aendern, master_aendern, send_setzen, return_aendern, insert_setzen, insert_param_setzen, insert_an, insert_entfernen, insert_ordnung, rack_setzen, rack_makro). '
      + 'A track mixer automation line inside a project is a lane, not a spur: proj_aendern auto_neu / auto_punkte / auto_aendern / auto_loeschen, read it with proj_auto. '
      + 'Loop (Studio track band): schleife_takte n (1..64) plays the moves as a pass of n bars again and again until spur_stopp; every move lies inside the pass '
      + '(ab_takt <= n, a ramp ends at n+1 at the latest, no set on bar n+1, no strom: targets). A hand on a target, AUTO off or Stop Cypher ends my loop. '
      + 'aendern: true changes a running loop of mine (same name, schleife_takte required, it may change) from its next pass, never inside the current one; '
      + 'the answer gives ab_beat/ab_takt (uebernaechster: true when the next pass was already on its way). aendern exists for loops only (keine_schleife) '
      + 'and only for the owner (nur_andreas on his loops). '
      + 'A strom: move with muster may carry bezeichnung (1..60 characters, plain words for what the stream plays from that bar: "conga"); it labels the stream when that pattern is written, and a move without it clears the label. bezeichnung on any other target is refused.',
    inputSchema: { type: 'object', required: ['name', 'fahrten'], properties: { name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' },
      fahrten: { type: 'array', items: { type: 'object', required: ['ziel', 'ab_takt'], properties: { ziel: { type: 'string' }, ab_takt: { type: 'number' }, takte: { type: 'number' },
        nach: { type: 'number' }, von: { type: 'number' }, form: { type: 'string', enum: ['s', 'linear'] }, muster: { type: 'string' },
        bezeichnung: { type: 'string', minLength: 1, maxLength: 60, description: 'strom: moves with muster only: label of the stream from that bar' } } } },
      ab: { type: 'string', enum: ['takt', 'phrase'] },
      anker_takt: { type: 'integer', minimum: 1, description: 'absolute bar to anchor at (not together with ab)' }, probe: { type: 'boolean', description: 'true: check and answer the plan, schedule nothing' },
      schleife_takte: { type: 'integer', minimum: 1, maximum: 64 }, aendern: { type: 'boolean' } } },   // 1.12 S7: loop, change of a loop
    lauf: (p) => {
      const spur = { name: p.name, fahrten: p.fahrten, ...(p.schleife_takte !== undefined ? { schleife_takte: p.schleife_takte } : {}) };
      return p.aendern === true ? http('POST', '/spur/aendern', { name: p.name, spur }) : http('POST', '/spur', { spur, ...(p.anker_takt !== undefined ? { anker_takt: p.anker_takt } : {}), ...(p.ab !== undefined || p.anker_takt === undefined ? { ab: p.ab ?? 'takt' } : {}), ...(p.probe !== undefined ? { probe: p.probe } : {}) });
    } },
  { name: 'bogen', description: 'Play an arc: layered sections on the bar grid, compiled by the server into one automation track. Arguments: name, takte (1..128), schichten, bruch, fahrten, ab, anker_takt, probe. '
      + 'schichten: each layer {strom, muster, ab_takt, bis_takt?, rein?, raus?, name?} puts a Strudel pattern on a stream (1, 2, 3, 5, 6, 7, 9, 10) from bar ab_takt of the arc (bar 1 = the anchor). bis_takt is exclusive (at most takte + 1); without it the layer keeps playing after the arc. '
      + 'Layers on the same stream are stacked, and a layer that enters or leaves later is a new section of that stream. rein n fades a layer in over n bars (1..32), raus n fades it out over the n bars before bis_takt (needs bis_takt); a fade may run across the start of another layer, the server continues it in the next section. '
      + 'bruch {ab_takt, takte, behalte: [strom]}: a break: every stream of the arc (a stream with a layer in it) that is not listed in behalte is silent for those bars and its layers come back at its end as the drop; a stream the arc has no layer on is never touched and keeps playing. '
      + 'A layer name (1..60 characters, plain words: "conga", "acid line") becomes the stream label shown on the channel strip: name every layer; layers stacked on one stream are joined with " + ". '
      + 'fahrten: optional hand-written moves as for spur (mixer paths, wirt: targets), passed into the same track. '
      + 'ab (takt or phrase) and anker_takt anchor the arc as for spur; probe: true runs every check and answers anchor, compiled sections (kompiliert) and plan without scheduling or sending anything: probe first, then start. '
      + 'The answer is the spur answer plus kompiliert (the track body) and plan [{takt, strom, text}]. spuren shows a running arc with bogen.naechste (in_takten, text of its next change). '
      + 'No schleife on an arc (bogen_schleife): to repeat an arc, `warte` with bis spur_ende, then call bogen again. Stop it with spur_stopp (same name). All spur rules apply (AUTO off on a layer stream is auto_aus, nur_andreas, Stop Cypher).',
    inputSchema: { type: 'object', required: ['name', 'takte', 'schichten'], properties: { name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' },
      takte: { type: 'integer', minimum: 1, maximum: 128 },
      schichten: { type: 'array', items: { type: 'object', required: ['strom', 'muster', 'ab_takt'], properties: { strom: { type: 'integer' }, muster: { type: 'string' }, ab_takt: { type: 'integer', minimum: 1 },
        bis_takt: { type: 'integer', minimum: 2, description: 'exclusive end bar; absent = keeps playing' }, rein: { type: 'integer', minimum: 1, maximum: 32 }, raus: { type: 'integer', minimum: 1, maximum: 32 },
        name: { type: 'string', minLength: 1, maxLength: 60 } } } },
      bruch: { type: 'object', required: ['ab_takt', 'takte', 'behalte'], properties: { ab_takt: { type: 'integer', minimum: 1 }, takte: { type: 'integer', minimum: 1 }, behalte: { type: 'array', items: { type: 'integer' } } } },
      fahrten: { type: 'array', items: { type: 'object', required: ['ziel', 'ab_takt'], properties: { ziel: { type: 'string' }, ab_takt: { type: 'number' }, takte: { type: 'number' },
        nach: { type: 'number' }, von: { type: 'number' }, form: { type: 'string', enum: ['s', 'linear'] }, muster: { type: 'string' } } } },
      ab: { type: 'string', enum: ['takt', 'phrase'] },
      anker_takt: { type: 'integer', minimum: 1, description: 'absolute bar to anchor at (not together with ab)' }, probe: { type: 'boolean', description: 'true: check and answer the plan, schedule nothing' } } },
    lauf: (p) => {
      const d: Json = { name: p.name, takte: p.takte, schichten: p.schichten };
      for (const k of ['bruch', 'fahrten', 'ab', 'anker_takt', 'probe']) if (p[k] !== undefined) d[k] = p[k];
      return http('POST', '/bogen', d);
    } },
  { name: 'spur_stopp', description: 'Stop one of MY automation tracks by name (Andreas\' tracks answer nur_andreas).',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    lauf: (p) => http('POST', '/spur/stopp', { name: p.name }) },
  { name: 'spuren', description: 'Running automation tracks, with the parts the core rejected.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/spur') },
  { name: 'szene', description: 'Live scenes: a snapshot of the whole live state that can be restored exactly. A scene holds the patterns per stream (with their phase offset), the mixer values, the loaded graphs, the Surge sounds of bass and melody, the beat FX units with their assignment and routing, and the running Cypher loops. '
      + 'aktion: sichern (store under name [a-z0-9_-]{1,32}; szene_vorhanden when the name exists, use ersetzen to overwrite), ersetzen, laden, liste, zeige (the stored content), loeschen. '
      + 'laden restores on the next bar as one internal track szene-<name> (takte 0..16: continuous mixer values ramp over that many bars, 0 = set at once). It saves the state as _vor_laden first, so the undo is `szene laden _vor_laden`. '
      + 'A part that Cypher may not touch right now (AUTO off on that stream, a refused control, a missing generator) is not restored and is listed under ausgelassen [{ziel, grund}]; everything else is restored. '
      + 'stille saves _vor_stille automatically before it silences, so `szene laden _vor_stille` brings the sound back (not when everything is silent already: szene_vorher schon_still). Names starting with _ are automatic; _vor_stille and _vor_laden keep three generations (-1, -2 are the older ones). Needs the open live project (kein_projekt otherwise).',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'] },
      name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$', description: 'required except for liste' },
      takte: { type: 'integer', minimum: 0, maximum: 16, description: 'laden: ramp the continuous mixer values over this many bars (default 0 = at once)' } } },
    lauf: (p) => {
      const falsch = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      const AKTIONEN = ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'];
      if (typeof p.aktion !== 'string' || !AKTIONEN.includes(p.aktion)) return falsch(`unknown aktion ${String(p.aktion)}`);
      const d: Json = { aktion: p.aktion };
      if (p.name !== undefined) d.name = p.name;
      if (p.takte !== undefined) d.takte = p.takte;
      return http('POST', '/szene', d);
    } },
  { name: 'aufbau', description: 'Stored session setups, outside any project: the whole live state of a session (everything a scene holds) plus the tempo, the four container faders (deck/1, deck/2, pad/1, pad/2) and the graphs of the Baukasten streams, so that one call rebuilds the studio, also after a core restart. '
      + 'aktion: sichern (store under name [a-z0-9_-]{1,32}; aufbau_vorhanden when the name exists, use ersetzen to overwrite), ersetzen, laden, liste, zeige (the stored content), loeschen (the file is kept in the papierkorb folder). '
      + 'laden opens the live container first if none is open (live_laeuft is returned when that is refused), sets the tempo, restores the graphs, and brings the scene back with every continuous value ramping over 2 bars (never nur_rampe, also from -200 dB after a restart). '
      + 'Answer: the scene answer plus live_geoeffnet, bpm and kanaele. What Cypher may not touch right now is not restored and is listed under ausgelassen [{ziel, grund}]; a container fader on a track place needs a hearing check first and comes back under ausgelassen with kein_hoerschein. Unknown name: aufbau_unbekannt.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'] },
      name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$', description: 'required except for liste' } } },
    lauf: (p) => {
      const AKTIONEN = ['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'];
      if (typeof p.aktion !== 'string' || !AKTIONEN.includes(p.aktion)) return { code: 400, j: { fehler: 'argument_ungueltig', text: `unknown aktion ${String(p.aktion)}` } };
      const d: Json = { aktion: p.aktion };
      if (p.name !== undefined) d.name = p.name;
      return http('POST', '/aufbau', d);
    } },
  { name: 'stille', description: 'Silence all Strudel instances from the next bar (tails ring for about 10 s; a note that is still held at that bar line, e.g. a long note on an instrument graph, is released there too, with a kern that knows the cut, otherwise it rings to its own end): the three studio streams and every Baukasten stream (5, 6, 7, 9, 10) whose erzeuger runs. All of them are always sent; if AUTO is off on one, that one is reported and the others still go silent.',
    inputSchema: { type: 'object', properties: {} },
    lauf: async () => {
      const stroeme: Json[] = [], fehler: string[] = [];
      let code = 200;
      // snapshot first so that `szene laden _vor_stille` brings the sound back; a failed or slow snapshot (1.5 s) never stops the silence,
      // and over a silence the server keeps the older snapshot (schon_still)
      let sicherung: Json | string;
      try {
        const sich = await http('POST', '/szene', { aktion: 'sichern', name: '_vor_stille' }, false, AbortSignal.timeout(1500));
        sicherung = sich.code >= 400 ? { fehler: String(sich.j.fehler ?? `http ${sich.code}`) }
          : sich.j.grund === 'schon_still' ? 'schon_still' : { name: '_vor_stille' };
      } catch (e) { sicherung = { fehler: (e as Error).name === 'TimeoutError' ? 'zeitlimit' : String((e as Error).message) }; }
      for (const strom of await stroemeListe()) {
        const r = await http('POST', '/strudel', { text: 'silence', strom });
        code = Math.max(code, r.code);
        stroeme.push({ strom, code: r.code, ...r.j });
        if (r.code >= 400) fehler.push(`strom ${strom}: ${String(r.j.fehler ?? `http ${r.code}`)}`);
      }
      return { code, j: { stroeme, szene_vorher: sicherung, ...(fehler.length ? { fehler: 'teilweise: ' + fehler.join('; ') } : {}) } };
    } },
  { name: 'mischung', description: 'Mix check of the master over N bars (live): samples the live analysis every 500 ms for the length of takte bars (at the bpm of lage), drops samples where the engine stands (steht) or the window is silent (stumm), averages the 1/12 octave spectrum by power. '
    + 'Answer {takte, proben, baender {sub, bass, mitte, praesenz, luft: dB difference to the genre target, level-matched, + = more than the target; only with ziel}, terz {hz, db, ziel_db?}, chroma {C..B, sums to 1}, tonart? {name, passt 0..1, staerkste: 3 pitch classes}, lufs_s, lufs_m_mittel, peak_db (the highest peak of the samples inside the N bars, not a true peak and not the peak since a reset), korrelation, ziel_grob, urteil}. '
    + 'ziel: techno, house, deep_house, dub, techstep or minimal; the target curves are ROUGH (a hand-set club tilt, not measured: ziel_grob is true), use them as a direction. '
    + 'tonart: Am, F#, C# minor or Camelot 8A; absent = the key of a playing deck from lage if there is one, else no key line (the chroma is a guess from the spectrum, a mix of several keys shows low). '
    + 'urteil is one line: peak above -1 dB is too hot, a region off by more than 3 dB is named with its sign, a key match below 0.5 is named. It takes takte bars of real time. It changes nothing.',
    inputSchema: { type: 'object', properties: { takte: { type: 'integer', minimum: 1, maximum: 16, default: 4 }, ziel: { type: 'string', enum: Object.keys(MISCHUNG_ZIELE.ziele) }, tonart: { type: 'string', description: 'Am, F#, C# minor or Camelot 8A' } } },
    lauf: async (p) => {
      const takte = p.takte === undefined ? 4 : Number(p.takte);
      if (!Number.isInteger(takte) || takte < 1 || takte > 16) return { code: 400, j: { fehler: 'takte_ungueltig', text: 'takte must be an integer 1..16' } };
      const ziel = p.ziel === undefined ? undefined : String(p.ziel);
      if (ziel !== undefined && !(ziel in MISCHUNG_ZIELE.ziele)) return { code: 400, j: { fehler: 'ziel_unbekannt', text: `ziel must be one of ${Object.keys(MISCHUNG_ZIELE.ziele).join(', ')}` } };
      const tonartArg = p.tonart === undefined ? undefined : String(p.tonart);
      if (tonartArg !== undefined && parseTonart(tonartArg) === null) return { code: 400, j: { fehler: 'tonart_ungueltig', text: 'tonart: Am, F#, C# minor or Camelot 8A' } };
      const l = await http('GET', '/lage');
      if (l.code !== 200) return l;
      const lj = l.j as { uhr?: { bpm?: number }; decks?: unknown; taktart?: unknown };
      const bpm = Number(lj.uhr?.bpm);
      if (!(bpm > 0)) return { code: 409, j: { fehler: 'kein_tempo', text: 'lage has no master tempo' } };
      const n = Math.max(1, Math.ceil(takte * proTaktVon(lj) * 60 / bpm / 0.5));
      const proben: number[][] = [], lufsM: number[] = [], korrs: number[] = [];
      let tpMax: number | null = null, lufsS: number | null = null;
      for (let k = 0; k < n; k++) {
        if (k > 0) await new Promise((ok) => setTimeout(ok, 500));
        const [r, m] = [await http('GET', '/analyse/live'), await http('GET', '/analyse/pegel')];
        const mj = (m.code === 200 && m.j !== null && typeof m.j === 'object' ? m.j : null) as Record<string, Json> | null;
        if (mj && typeof mj.lufs_s === 'number') lufsS = mj.lufs_s;
        const j = (r.code === 200 && r.j !== null && typeof r.j === 'object' ? r.j : null) as Record<string, any> | null;
        if (!j || j.leer !== false || j.steht === true || j.stumm === true) continue;
        const db = j.spektrum?.db;
        if (!Array.isArray(db) || db.length !== 120) return { code: 502, j: { fehler: 'antwort_ungueltig', text: 'GET /analyse/live: the spectrum is not 120 bands' } };
        proben.push(db as number[]);
        if (typeof j.lufs_m === 'number') lufsM.push(j.lufs_m);
        if (typeof j.true_peak_dbtp === 'number') tpMax = tpMax === null ? j.true_peak_dbtp : Math.max(tpMax, j.true_peak_dbtp);   // peak of the window of one sample, collected inside the N bars only
        if (typeof j.stereo?.korrelation === 'number') korrs.push(j.stereo.korrelation);
      }
      if (proben.length === 0) return { code: 409, j: { fehler: 'nichts_gehoert', text: 'no usable sample: the engine stands or the master is silent', proben: 0 } };
      const db120 = mittle(proben), terz = terzVon(db120), chr = chroma(db120);
      const zielDb = ziel ? zielAufTerz(MISCHUNG_ZIELE.anker_hz, MISCHUNG_ZIELE.ziele[ziel]) : undefined;
      const gz = zielDb ? gegenZiel(terz, zielDb) : undefined;
      let tonartName = tonartArg;
      if (tonartName === undefined && Array.isArray(lj.decks)) {
        const d = (lj.decks as Array<{ status?: number; camelot?: string | null }>).find((x) => Number(x?.status) >= 2 && typeof x.camelot === 'string' && parseTonart(x.camelot) !== null);
        if (d) tonartName = d.camelot as string;
      }
      const ton = tonartName !== undefined ? tonartPasst(chr, tonartName) : null;
      const mean = (a: number[]): number | null => (a.length > 0 ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const antwort = {
        takte, proben: proben.length,
        ...(gz ? { baender: gz.regionen } : {}),
        terz: { hz: [...TERZ_HZ], db: terz, ...(zielDb ? { ziel_db: zielDb } : {}) },
        chroma: Object.fromEntries(KLASSEN.map((c, i) => [c, chr[i]])),
        ...(ton ? { tonart: ton } : {}),
        lufs_s: lufsS, lufs_m_mittel: mean(lufsM), peak_db: tpMax, korrelation: mean(korrs), ziel_grob: MISCHUNG_ZIELE.grob,
        urteil: urteil({ peak_db: tpMax, regionen: gz?.regionen ?? {}, tonart: ton, ziel }),
      };
      return { code: 200, j: antwort as unknown as Json };
    } },
  { name: 'pegel', description: 'Levels of the last N seconds (1..10, default 3) per channel (erz/1..3, erz/5..7 (Baukasten instruments), pad/1..2, deck/1..2 (the container strips), spur/1..128 for each production track that has content, grp/1..16 for each group that has members or child groups, ret/1..8 for each return, pm (the production master after its fader, before the set limiter), master, cue): number of samples, peak dBFS (max_db, -200 = silence) and median of the audible peaks (median_db, null if silent). The peak is the sample peak after the track fader, not loudness: a 808 kick and a quiet pad can show the same peak and sound very different. For loudness per track use proj_lautheit. Read it after every change: master must stay below -3 dBFS, the kick leads. nur_hoerbar: true drops the channels with max_db at or below -90.',
    inputSchema: { type: 'object', properties: { sek: { type: 'integer', minimum: 1, maximum: 10, default: 3, description: 'window in seconds (default: 3)' }, nur_hoerbar: { type: 'boolean' } } },
    lauf: async (p) => {
      const r = await http('GET', `/pegel?sek=${p.sek ?? 3}`);
      const k = (r.j as { kanaele?: Record<string, { max_db?: number }> }).kanaele;
      if (p.nur_hoerbar !== true || r.code !== 200 || k === undefined || k === null || typeof k !== 'object') return r;
      return { code: r.code, j: { ...r.j, kanaele: Object.fromEntries(Object.entries(k).filter(([, v]) => !(Number(v?.max_db) <= -90))) } };
    } },
  { name: 'spektrum', description: 'The last frame of the spectrum analyser: 29 bands, three per octave, with the centre of each band in Hz (1000 Hz x 2^(i/3), i = -16..12, i.e. 24.8 Hz .. 16 kHz) and its level in dB (a full-scale sine reads about 0 dB, silence about -90 or lower). '
      + 'Answers {leer:true} while the analyser is off or no frame has arrived yet; right after choosing a source {leer:true} is normal (the window refills first), ask again after about 100 ms. '
      + 'Otherwise {leer:false, kanal (the source: deck/1, bus/2, master ...), rahmen (frame number since the last source change), alter_ms (age of the frame), veraltet (true when alter_ms is above 500 ms: the frame is stale, the analyser has stopped delivering, do not read it as the current sound), baender:[{hz, db}]}. '
      + 'The source is chosen with regler spektrum/kanal (0 off, 1..4 = the containers A..D = deck/1, deck/2, pad/1, pad/2, 5..8 = bus/1..4, 9 = master sum; a stream is heard through the container that plays it); this tool only reads and changes nothing.',
    inputSchema: { type: 'object', properties: {} },
    lauf: async () => {
      const r = await http('GET', '/spektrum');
      if (r.code !== 200) return r;
      const j = (r.j !== null && typeof r.j === 'object' ? r.j : {}) as { leer?: unknown; pegel?: unknown; alter_ms?: unknown };
      if (typeof j.leer !== 'boolean') return { code: 502, j: { fehler: 'antwort_ungueltig', text: 'GET /spektrum answered without a boolean leer', antwort: r.j } };
      if (j.leer) return r;
      const { pegel, ...rest } = j;
      if (typeof pegel !== 'string' || !/^-?\d+(,-?\d+){28}$/.test(pegel)) {
        return { code: 502, j: { fehler: 'pegel_ungueltig', text: 'the spectrum frame is not 29 integers in 0.1 dB' } };
      }
      const baender = pegel.split(',').map((x, i) => ({ hz: Math.round(bandMitteHz(i) * 10) / 10, db: Number(x) / 10 }));
      return { code: 200, j: { ...rest, veraltet: typeof j.alter_ms !== 'number' || j.alter_ms > SPEKTRUM_FRIST_MS, baender } };
    } },
  { name: 'oszilloskop', description: 'Scope for the last N seconds (1..15, default 5) of one channel: peak and when it happened, RMS, onsets (rises over a threshold, with time and strength), pump depth (how deep the low band swings per beat at the current tempo, null without tempo; on a bass or pad channel this is sidechain pumping, on a drum channel it is only the decay of the hits), click suspects, and a one-line envelope. '
      + 'Honest limits: this is the 1 ms envelope of the kern (peak and band RMS per millisecond, taken after EQ and filter, before the fader), not samples. A short spike that stands out against its neighbours is only a click SUSPECT; a real jump in the sample values is invisible here. '
      + 'Times are milliseconds before the end of the window (-1200 ms = 1.2 s ago). Channels: deck/1|2, pad/1|2 (the container strips), erz/1..4 (erz/4 = the production sum), master (before the master fader and limiter), cue. A deck that is not loaded reads as silence. '
      + 'Errors: kanal and sek out of range are 400, kein_ring (409) means the kern writes no envelope ring (kern off). Reads only, changes nothing.',
    inputSchema: { type: 'object', properties: { kanal: { type: 'string', enum: Object.keys(OSZI_KANAELE), description: 'channel to look at' },
      sek: { type: 'integer', minimum: 1, maximum: 15, default: 5, description: 'window in seconds (default: 5)' } }, required: ['kanal'] },
    lauf: async (p) => {
      const sek = p.sek ?? 5;
      const r = await http('GET', `/oszi?kanal=${encodeURIComponent(String(p.kanal ?? ''))}&sek=${encodeURIComponent(String(sek))}`);
      return r.code === 200 ? { ...r, text: osziText(r.j) } : r;
    } },
  { name: 'klang', description: 'Surge XT sounds on the BASS (strom 2) and MELODY (strom 3) instances. gruppe: bass|melodie. aktion: '
      + 'liste (find factory/own patches by regex, e.g. filter "Leads/Acidofil"; no gruppe needed), zeige (current values, optional regex filter), lade (load a patch by name, e.g. "Chords/Minor Chord Retro Stab"), '
      + 'setze (werte {NAME: number}; non-continuous parameters reload the state = audible click; with ab (jetzt|schlag|takt|phrase) or ab_beat (a core beat) the set is queued and the host reloads at that beat, so pick a silent beat: the reload cuts sounding notes; the answer gives ab_beat and ab_takt), fahre (parameter, ziel, sekunden, optional von: stepless fade, e.g. volume -12 over 15 s from -40), '
      + 'speichere (save the running sound under name [a-z0-9_-]{1,32}), hoere (play a note directly on the host: note 0..127, dauer seconds). '
      + 'If the instance plays Cypher Modular (our own synth, see instrumente) instead of Surge: params (Knob 1..64 with value 0..1 and the knob names from the graph, e.g. "Knob 1": "Cutoff"; free like zeige) '
      + 'and param (name "Knob 1".."Knob 8", wert 0..1, set at once, smoothed 20 ms in the synth); the Surge actions do not apply there. '
      + 'Blend with fahre, never hard-set volume while playing. Writing actions are refused while Stop Cypher is set or AUTO of that instance is off; zeige and liste are free. Values must not start with "-".',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      gruppe: { type: 'string', enum: ['bass', 'melodie'], description: 'required except for liste' },
      aktion: { type: 'string', enum: ['liste', 'zeige', 'lade', 'setze', 'fahre', 'speichere', 'hoere', 'params', 'param'] },
      name: { type: 'string', description: 'lade: patch name or path; speichere: [a-z0-9_-]{1,32}; param: "Knob 1".."Knob 8"' },
      wert: { type: 'number', minimum: 0, maximum: 1, description: 'param: knob position 0..1' },
      werte: { type: 'object', additionalProperties: { type: 'number' }, description: 'setze: {PARAMETER: number}' },
      ab: { type: 'string', enum: ['jetzt', 'schlag', 'takt', 'phrase'], description: 'setze: reload at this grid point (ab_beat wins when both are given)' },
      ab_beat: { type: 'number', description: 'setze: reload at this core beat' },
      parameter: { type: 'string', description: 'fahre: continuous Surge parameter, e.g. volume, a_filter1_cutoff' },
      ziel: { type: 'number' }, sekunden: { type: 'number', minimum: 0, maximum: 600 }, von: { type: 'number' },
      filter: { type: 'string', description: 'regex for zeige / liste' },
      note: { type: 'integer', minimum: 0, maximum: 127 }, dauer: { type: 'number', description: 'hoere: seconds' } } },
    lauf: (p) => http('POST', '/klang', p) },
  { name: 'bibliothek', description: 'Search the whole media library (tracks only): text (title, artist, mix), camelot key, bpm range "124-130", genre. Each hit: material_id, title, artist, bpm, key, genre, length, pfad_da (file reachable), im_bestand (ready to load). Not ready: use vorbereiten.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, camelot: { type: 'string' }, bpm: { type: 'string', pattern: '^\\d+-\\d+$' }, genre: { type: 'string' }, max: { type: 'integer', minimum: 1, maximum: 200 } } },
    lauf: (p) => {
      const q = new URLSearchParams();
      for (const k of ['text', 'camelot', 'bpm', 'genre'] as const) if (p[k] !== undefined) q.set(k, String(p[k]));
      q.set('limit', String(p.max ?? 20));
      return http('GET', `/mediathek?${q}`);
    } },
  { name: 'anschluss', description: 'Which library tracks fit after the running one? Give deck (1|2) or material_id. Ranked by tempo (within ±6 % by default), genre, Camelot move (same, neighbour, parallel, diagonal both ways, boost +2, lower -2; semitone only with energie=heben and a rising energy class; opposite key never) and energy class (low ≤5, mid 6-7, high ≥8). Unknown tempo (missing or ≤ 0), unknown key or an uncertain key (from a weak source such as Traktor) does not exclude a track, it only scores low. energie: halten (default), heben, senken. Each hit has punkte, zug and gruende, plus material_id and im_bestand as in bibliothek.',
    inputSchema: { type: 'object', properties: { deck: { type: 'integer', enum: [1, 2] }, material_id: { type: 'string', pattern: '^[0-9a-f]{16}$' },
      energie: { type: 'string', enum: ['halten', 'heben', 'senken'] }, fenster: { type: 'number', minimum: 1, maximum: 16 }, max: { type: 'integer', minimum: 1, maximum: 50 } } },
    lauf: (p) => {
      const q = new URLSearchParams();
      for (const k of ['deck', 'material_id', 'energie', 'fenster'] as const) if (p[k] !== undefined) q.set(k, String(p[k]));
      q.set('limit', String(p.max ?? 10));
      return http('GET', `/mediathek/anschluss?${q}`);
    } },
  { name: 'stoebern', description: 'Browse the whole media library by type: track (whole library, one per work), loop, oneshot (samples), strudel (pattern library). '
      + 'text: words match as prefixes over title, artist, label, genre, pack, instrument, folder, file name; field:value narrows to one field '
      + '(artist:, title:, label:, genre:, release:, catalog:, isrc:, remixer:, pack:, instrument:, year:, folder:); plain words also match values from every source, not only the winning one. '
      + 'For strudel the words are plain substrings of name, code and role, and only name: and rolle: exist (any other field is an error, suchfeld_nicht_anwendbar). '
      + 'Filters per type: camelot (nachbarn true adds ±1 and the relative key) for track and loop, bpm "124-130" for track, loop and strudel, energie 0 low | 1 mid | 2 high for track only; '
      + 'a filter the type does not have is an error (filter_nicht_anwendbar). Also ordner (folder path; not for strudel, which is an error too), sort, richtung auf|ab, seite, limit (100, max 200). '
      + 'Each hit has material_id and sha (for loop import and preview) and, for tracks, status ready|prepare|missing.',
    inputSchema: { type: 'object', properties: { typ: { type: 'string', enum: ['track', 'loop', 'oneshot', 'strudel'] }, text: { type: 'string' }, camelot: { type: 'string' },
      nachbarn: { type: 'boolean' }, bpm: { type: 'string', pattern: '^\\d+(-\\d+)?$' }, energie: { type: 'integer', enum: [0, 1, 2] }, ordner: { type: 'string' },
      sort: { type: 'string' }, richtung: { type: 'string', enum: ['auf', 'ab'] }, seite: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } } },
    lauf: (p) => http('GET', '/stoebern?' + new URLSearchParams(Object.entries(p).map(([k, v]) => [k, k === 'nachbarn' ? (v ? '1' : '0') : String(v)])).toString()) },
  { name: 'klaenge', description: 'Find sounds (not tracks): one-shots, loops, impulse responses, my recordings, generated sounds and voices from the media library on this host plus my loop library. Text matches path, pack, category, instrument, title. Each hit has einsatz: sofort (plays now: my loop library, load with box), werkstatt (open file, needs a kit build or loading first), nur_live (encrypted Ableton pack sample, only Ableton Live plays it; never try to load it). Filters: typ, pack, einsatz, bpm "124-130", camelot, limit (30, max 200). Ask this BEFORE building a sound.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, typ: { type: 'string', enum: ['oneshot', 'loop', 'impuls', 'mitschnitt', 'erzeugt', 'stimme'] }, pack: { type: 'string' }, einsatz: { type: 'string', enum: ['sofort', 'werkstatt', 'nur_live'] }, bpm: { type: 'string' }, camelot: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } },
    lauf: (p) => http('GET', '/klaenge?' + new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString()) },
  { name: 'bestand_karte', description: 'Overview of all sounds in numbers: per type how many play now (sofort), need the workshop, or are Live-only; the biggest packs; size of my loop library. Call it once at the start of a session that will build sounds.',
    inputSchema: { type: 'object', properties: {} },
    lauf: () => http('GET', '/klaenge/karte') },
  { name: 'vorbereiten', description: 'Run one library track through the workshop (analysis + render at 128 BPM, about a minute) so it can be loaded on a deck. Waits up to 150 s and returns the final status (neu, vorhanden, fehler) or laeuft if still running.',
    inputSchema: { type: 'object', required: ['material_id'], properties: { material_id: { type: 'string', pattern: '^[0-9a-f]{16}$' } } },
    lauf: async (p) => {
      const r = await http('POST', '/mediathek/vorbereiten', { material_id: p.material_id });
      if (r.code !== 202) return r;
      const t0 = Date.now();
      for (;;) {
        await new Promise((ok) => setTimeout(ok, 2000));
        const s = await http('GET', `/mediathek/vorbereiten?material_id=${p.material_id}`);
        // HTTP >= 400: sofort zurück (antwort() macht daraus den Werkzeugfehler); nach 150 s das Statusobjekt, kein Fehler
        if (s.code >= 400 || s.j.status !== 'laeuft' || Date.now() - t0 > 150000) return s;
      }
    } },
  { name: 'sets', description: 'List the prepared sets (free collections of tracks for a planned DJ set): slug, name, number of items.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/sammlungen?art=set') },
  { name: 'set_zeige', description: 'Show one set: every item with title, artist, bpm, key, genre, length, status (ready = loadable via laden with laden_mid, prepare, missing, wartet, laeuft, fehler) and a summary (total length, bpm range, keys, genres, status counts).',
    inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    lauf: (p) => http('GET', `/sammlungen/${encodeURIComponent(String(p.slug))}`) },
  { name: 'set_lege', description: 'Put a library track (material_id from bibliothek) into a set. If the set does not exist and name is given, it is created first. Same track twice is reported as schon_drin.',
    inputSchema: { type: 'object', required: ['slug', 'material_id'], properties: { slug: { type: 'string' }, name: { type: 'string', description: 'create the set with this name if it does not exist' },
      material_id: { type: 'string', pattern: '^[0-9a-f]{16}$' }, notiz: { type: 'string' } } },
    lauf: async (p) => {
      let slug = String(p.slug);
      if ((await http('GET', `/sammlungen/${encodeURIComponent(slug)}`)).code === 404) {
        if (!p.name) return { code: 404, j: { fehler: 'unbekannt', text: 'set does not exist; pass name to create it' } };
        const n = await http('POST', '/sammlungen', { name: p.name });
        if (n.code !== 201) return n;
        slug = String(n.j.slug);
      }
      const r = await http('POST', `/sammlungen/${encodeURIComponent(slug)}/posten`, { art: 'track', material_id: p.material_id, ...(p.notiz ? { notiz: p.notiz } : {}) });
      return { code: r.code, j: { slug, ...r.j } };
    } },
  { name: 'set_vorbereiten', description: 'Queue every not-yet-prepared track of a set for the workshop (two at a time, about a minute each). Returns how many were queued; watch progress with set_zeige.',
    inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    lauf: (p) => http('POST', `/sammlungen/${encodeURIComponent(String(p.slug))}/vorbereiten`, {}) },
  { name: 'instrumente', description: 'Load the Surge XT instruments into the RUNNING studio without stopping anything else: starts the bass and melody hosts, wires them to the core, and restarts only the bass (strom 2) and melody (strom 3) instances so they play into Surge instead of the sample kit. Patterns are kept and sound through Surge from the next bar (say so before). Drums, decks and the core keep running. Idempotent: already loaded parts are skipped. Afterwards klang works. Refused while Stop Cypher is set or AUTO of instance 2 or 3 is off. melodie: surge or fluegel (omitted: the melody host keeps the kind its status file says, Surge if there is none) ; fluegel = a real sampled grand piano (Ableton Core Library, 4 velocity layers) on the melody instance (strom 3) instead of Surge; switching only restarts the melody host, the pattern keeps playing. With fluegel klang does not work on melodie (no Surge there), velocity("<0.3 0.9>") picks the piano layer.',
    inputSchema: { type: 'object', properties: { melodie: { type: 'string', enum: ['surge', 'fluegel'] } } },
    lauf: async (p) => {
      if (p.melodie !== undefined && p.melodie !== 'surge' && p.melodie !== 'fluegel') return { code: 400, j: { fehler: 'melodie', text: 'melodie: surge or fluegel' } };
      const l = (await http('GET', '/lage')).j as { ki?: { gestoppt?: boolean }; studio?: { stroeme?: Json[] } };
      if (l.ki?.gestoppt) return { code: 409, j: { fehler: 'gestoppt', text: 'Stop Cypher is set' } };
      const aus = (l.studio?.stroeme ?? []).filter((x) => (x.strom === 2 || x.strom === 3) && x.autonom === false).map((x) => x.strom);
      if (aus.length) return { code: 409, j: { fehler: 'auto_aus', text: `AUTO off on instance ${aus.join(', ')}: Andreas holds it` } };
      return instrumenteLaden(p.melodie ? ['--melodie', String(p.melodie)] : []);
    } },
  // D1 S2 (Spec 3.5): Produktion. Schreiben sperrt Stop Cypher (409 ki_gestoppt, Seiten-Server); Projekt löschen gibt es hier nicht.
  { name: 'proj_liste', description: 'Production projects (PRODUCTION view): slug, name, last change (geaendert), last opened (zuletzt); the most recently opened is first.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/proj/liste') },
  // browser plan 2 (B3, B12, B18): the files of the open project. The pinned tool count of hand_mcp.test.mjs is set by the main instance after all browser plans merged.
  { name: 'proj_dateien', description: 'The files of the OPEN project (THIS PROJECT of the browser). Without aktion it reads: {audio: [{sha256, name, pfad, clips, fehlt}], midi: [{clip_id, spur_id, name}], '
    + 'takes: [{datei, spur_id?, gerettet}], exporte, stems, bounces, resamples: [{datei, zeit}], instrumente: [{spur_id, spur_name, geraet}], kits: [name], presets: [origin id], fehlend: [sha256 of every missing audio file]}. '
    + '409 kein_projekt without an open project. '
    + 'aktion finden {sha256}: looks the file up in the catalogue and the project and copies it into <project>/audio/ when it sits elsewhere: {ok: true, pfad} or 200 {ok: false, grund: nicht_gefunden} (503 katalog_fehlt without a catalogue). '
    + 'aktion relink {sha256, pfad}: copies the file at pfad into <project>/audio/ when its content hash is sha256 (409 sha_stimmt_nicht otherwise, 400 datei_unlesbar for a directory or unreadable path); project.json is not edited. '
    + 'aktion aufraeumen {nur_zeigen?}: files that no clip or loop cell names (audio/ copies, takes, stems, bounces, resamples; never export/, rescued takes, versions or anything while a recording run file exists) are listed, and moved into <project>/.papierkorb/<UTC stamp>/ unless nur_zeigen is true: {dateien: [relative paths], verschoben}. Nothing is deleted. Writes are refused 409 ki_gestoppt while Stop Cypher is on.',
    inputSchema: { type: 'object', properties: { aktion: { type: 'string', enum: ['finden', 'relink', 'aufraeumen'] }, sha256: { type: 'string', description: 'finden and relink: sha256 of the audio file (from the audio or fehlend list)' },
      pfad: { type: 'string', description: 'relink: absolute path of the file on this machine' }, nur_zeigen: { type: 'boolean', description: 'aufraeumen: only list, move nothing' } } },
    lauf: async (p) => {
      if (p.aktion === undefined) return http('GET', '/proj/dateien');
      if (p.aktion === 'finden') return http('POST', '/proj/finden', definiert(p, 'sha256'));
      if (p.aktion === 'relink') return http('POST', '/proj/relink', definiert(p, 'sha256', 'pfad'));
      if (p.aktion === 'aufraeumen') return http('POST', '/proj/aufraeumen', definiert(p, 'nur_zeigen'));
      return { code: 400, j: { fehler: 'aktion_unbekannt', text: 'aktion must be finden, relink or aufraeumen' } };
    } },
  { name: 'proj_umbenennen', description: 'Rename a STORED project (the shown name only; the folder and slug stay). slug: the project folder from proj_liste; name: 1 to 80 characters. '
    + 'The OPEN project cannot be renamed (409 projekt_offen: save a copy with a new name or open another project first); 409 name_vergeben when another project has that name (case-insensitive), 400 name_ungueltig, 404 unbekannt. Refused 409 ki_gestoppt while Stop Cypher is on. Answer: {ok: true, slug}.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' }, name: { type: 'string' } }, required: ['slug', 'name'] },
    lauf: (p) => http('POST', '/proj/umbenennen', definiert(p, 'slug', 'name')) },
  // plan live-module task 10: the module library (saved live modules; spec 6.7)
  { name: 'module_suchen', description: 'Search the module library: the live modules saved at export, when their stems arrived and when a slot was cleared, plus every group saved with modul_speichern. '
    + 'q: words that must all occur (case-insensitive) in the source title, artist, set, date, key or group name; sha: the library sha256 of the source track. Newest first. '
    + 'Each hit: id (use it with modul_einsetzen), titel, kuenstler, tonart, datum, set, bpm, laenge_beats, stems (false = loop only), audio_fehlt, spuren.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, sha: { type: 'string', description: 'sha256 of the source track' } } },
    lauf: (p) => { const q = new URLSearchParams(definiert(p, 'q', 'sha') as Record<string, string>).toString(); return http('GET', `/module${q ? `?${q}` : ''}`); } },
  { name: 'modul_einsetzen', description: 'Place a saved module into the OPEN project as one top group (the whole tree gets new ids, the audio is copied into the project, one undo step: proj_undo takes it back). '
    + 'In a production project the module keeps its origin but no live slot; in the live container it takes a place (slot A to D = place 1 to 4, A deck/1, B deck/2, C pad/1, D pad/2; default the first free place whose channel is closed, order C, D, A, B) with its group fader at 0 dB and plays through the strip of that container. '
    + 'Refusals: kanal_offen (live container: the channel of the place is open, PFL does not matter), routing_grenze (not enough free tracks or groups: 128 tracks, 16 groups), slot_belegt (live container, no free slot), modul_unbekannt, modul_nicht_einsetzbar (sends, inserts, takes, freezes, host or rack instruments, or insert and rack automation inside; Baukasten and RB-338 instrument tracks, MIDI clips, blend and blend lanes are carried; at most 16 Baukasten tracks count for routing_grenze), kein_projekt, ki_gestoppt.',
    inputSchema: { type: 'object', properties: { modul_id: { type: 'string', description: 'id from module_suchen' }, slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' } }, required: ['modul_id'] },
    lauf: (p) => http('POST', '/modul/einsetzen', p) },
  { name: 'modul_speichern', description: 'Save a top group of the open project (one that plays into the master; its member groups and tracks come with it) as a module of the library, with copies of its audio. '
    + 'A group without a module origin gets a minimal one (title = group name, date). Answers modul_id. A group inside another group is refused (argument_ungueltig).',
    inputSchema: { type: 'object', properties: { gruppe_id: { type: 'string', description: 'group id from proj_lage, e.g. g3' } }, required: ['gruppe_id'] },
    lauf: (p) => http('POST', '/modul/speichern', p) },
  // 1.9 (L25): the kits a kit track can play, read from the kit folder of the page server
  { name: 'proj_kits', description: 'Kits for kit tracks: the kit folder of the page server (CYPHERDJ_KIT_ORDNER, else ~/.config/cypherdj/kits, which is a link to the kits folder of the home folder, by default ~/cypherdj/werke/kits, once that layout is in use) lists every folder that holds a kit.json of the right shape: kits [{name, klaenge = number of sounds}], sorted by name. Use a name as geraet.kit in proj_aendern spur_neu / spur_aendern (geraet {art: intern, name: kit, kit}). The server checks only the shape; the core loads the sound files when the playback is loaded and refuses it with reason format when a kit does not load.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/proj/kits') },
  // browser plan 5 (B18): the kit management routes. Export and import are owner routes the hand cannot reach (a kit zip is classified by import_datei and installed by the page).
  { name: 'kits', description: 'Manage the kit folder of the page server. aktion liste: every kit, global and of the open project, as kits [{name, pads, quelle: global|projekt}]. '
    + 'umbenennen {name, neu}: renames a kit (refused with kit_in_benutzung when a project uses it). kopie {name, neu?}: copies a kit (default name <name>-2). loeschen {name, trotzdem?}: moves a kit to the kit folder bin (kit_in_benutzung unless trotzdem: true). '
    + 'vorhoeren {name, pad?}: plays the kit (one pad by its note number, else all pads) on the headphone cue (kein_kopfhoerer without headphones). aus_ordner {pfad, name}: builds a new kit from the audio files of a folder (absolute path inside the home folder, /media or /mnt), kick first, at most 16 pads; the answer lists the files left over (uebrig). '
    + 'name and neu are kit names (a-z, 0-9, _ and -, 1..32). quelle (global|projekt) says which kit of that name is meant when both exist. Every action answers the JSON of its route; a refusal carries fehler (the reason) and text.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['liste', 'umbenennen', 'kopie', 'loeschen', 'vorhoeren', 'aus_ordner'] },
      name: { type: 'string', minLength: 1, maxLength: 32 }, neu: { type: 'string', minLength: 1, maxLength: 32 },
      pad: { type: 'integer', minimum: 0, maximum: 127, description: 'vorhoeren: the note number of one pad' },
      pfad: { type: 'string', minLength: 1, description: 'aus_ordner: absolute folder path' },
      trotzdem: { type: 'boolean', description: 'loeschen: delete although a project names the kit' },
      quelle: { type: 'string', enum: ['global', 'projekt'] } } },
    lauf: (p) => {
      const { aktion, ...rest } = p as Json & { aktion?: unknown };
      if (aktion === 'liste') return httpGrund('GET', '/kits');
      const route: Record<string, string> = { umbenennen: '/kits/umbenennen', kopie: '/kits/kopie', loeschen: '/kits/loeschen', vorhoeren: '/kits/vorhoeren', aus_ordner: '/kits/aus_ordner' };
      if (typeof aktion !== 'string' || !Object.hasOwn(route, aktion)) return Promise.resolve({ code: 400, j: { fehler: 'aktion_unbekannt', text: 'aktion must be one of liste, umbenennen, kopie, loeschen, vorhoeren, aus_ordner' } });
      return httpGrund('POST', route[aktion], rest as Json);
    } },
  // journey tours task 2: record the master mix of the studio (the page's REC MIX key); the recorder only reads the core's audio ring
  { name: 'mix_aufnahme', description: 'Record the master mix of the studio to a WAV file (the REC MIX key of the page). aktion start {name?}: starts the recorder, name is 1 to 40 characters from a-z, 0-9, _ and - (default: the date and time); answers {ok, datei, seit}. '
    + 'stopp: ends the recording, answers {ok, datei, sekunden, luecken, spruenge} (luecken = stretches where the recorder lost frames and filled silence, spruenge = jumps of the audio clock; both 0 is a clean take). '
    + 'stand: {laeuft, datei?, seit?, sekunden?, spitze_db?} (spitze_db = the peak of the last 10 seconds in dBFS, absent before the first). The file lands in the recordings folder (CYPHERDJ_MITSCHNITTE, else ~/cypherdj/werke/mitschnitte); the recorder runs in its own user unit and survives a restart of the page server. '
    + 'Refusals carry fehler (the reason) and text: mitschnitt_laeuft (409, also while a demo recording runs), kein_mitschnitt (409, stopp without one), kern_fehlt (503, the audio core is not running), mitschnitt_fehler (500, detail = the last line of the recorder log), name_ungueltig (400).',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['start', 'stopp', 'stand'] },
      name: { type: 'string', minLength: 1, maxLength: 40, pattern: '^[a-z0-9_-]{1,40}$', description: 'start: the file name without .wav' } } },
    lauf: (p) => {
      const { aktion, name } = p as Json & { aktion?: unknown; name?: unknown };
      if (aktion === 'stand') return httpGrund('GET', '/mitschnitt/stand');
      if (aktion === 'stopp') return httpGrund('POST', '/mitschnitt/stopp', {});
      if (aktion === 'start') return httpGrund('POST', '/mitschnitt/start', name === undefined ? {} : { name });
      return Promise.resolve({ code: 400, j: { fehler: 'aktion_unbekannt', text: 'aktion must be one of start, stopp, stand' } });
    } },
  // strudel-clip: the friendly way to the clip_aus_muster command of proj_aendern (same server command, same one undo step), with the report
  { name: 'proj_muster', description: 'A Strudel pattern becomes a MIDI clip in the arrangement, with its envelopes: one call instead of dozens of notes. Same as proj_aendern with the command clip_aus_muster (that text has the full rules); this tool sends exactly that one command. '
    + 'New clip: spur_id (an instrument track from proj_lage: RB-338, Baukasten, Surge or a KIT track), start_beat, code, takte? (bars; absent = as long as the pattern takes to repeat). Generate a clip again from its stored pattern: clip_id alone (or clip_id + code for a new pattern). 1 cycle = 1 bar = 4 beats. '
    + 'Kit track: s("bd*4, ~ hh ~ hh") (names of the kit, bd:2 = third bd; an unknown name is refused klang_unbekannt with the list of the kit sounds). Instrument track: note("gs1 ~ gs1 b1").velocity("<0.8 1>") or n("0 2 4").scale("C:minor"). '
    + 'Answers {rev, kern, noten_zahl, muster: [{clip_id, spur_id, noten_zahl, takte, loop_beats (null = none), huellkurven: [targets that were drawn], ohne_ziel: [Strudel fields that have NO target here and were not applied], hinweise: [text]}]}. ohne_ziel is the honest list: room, delay, speed ... do nothing. '
    + 'Examples: {spur_id: "s1", start_beat: 0, code: "s(\"bd*4, ~ hh ~ hh\")"} for a kick and hat bar on a kit track; {spur_id: "s2", start_beat: 16, takte: 8, code: "note(\"gs1 ~ gs1 b1\").velocity(\"<0.8 1>\").cutoff(sine.range(300,3000).slow(4))"} for an 8 bar bass with a filter sweep (cutoff envelope on an RB-338 track). '
    + 'Generating a clip again that was edited by hand since (notes or envelopes) is refused handarbeit_vorhanden unless ueberschreiben is true. A pattern that does not run is refused muster_fehler with the line and column; nothing is created. The result is an ordinary clip: edit its notes with noten_aendern / proj_aendern, move it with clip_aendern.',
    inputSchema: { type: 'object', properties: { spur_id: { type: 'string', description: 'a new clip on this instrument track (give start_beat and code)' },
      start_beat: { type: 'number', minimum: 0, description: 'new clip: start in beats from the project start' },
      clip_id: { type: 'string', description: 'generate this MIDI clip again (from its stored pattern, or from code)' },
      code: { type: 'string', minLength: 1, maxLength: 8192, description: 'the Strudel pattern, one JavaScript expression' },
      takte: { type: 'number', exclusiveMinimum: 0, maximum: 1024, description: 'clip length in bars; absent = until the pattern repeats (new clip) or the clip length (existing clip)' },
      name: { type: 'string', maxLength: 80 }, ueberschreiben: { type: 'boolean', description: 'replace hand work (notes or envelopes changed since the pattern made them)' },
      label: { type: 'string', minLength: 1, maxLength: 200, description: 'history label, default "Pattern"' }, rev: { type: 'integer', minimum: 0 } } },
    lauf: (p) => {
      const befehl: Json = { befehl: 'clip_aus_muster' };
      for (const k of ['spur_id', 'start_beat', 'clip_id', 'code', 'takte', 'name', 'ueberschreiben']) if (p[k] !== undefined) befehl[k] = p[k];
      return mitRev(p, '/proj/aendern', { label: typeof p.label === 'string' ? p.label : 'Pattern', befehle: [befehl] });
    } },
  // MIDI import (spec 2026-11-10-midi-import): one call, the same route as the page's Import MIDI dialog
  { name: 'proj_midi_import', description: 'Import a Standard MIDI file (.mid, format 0 or 1) into the open project: one instrument track with one MIDI clip per (MIDI track, channel) that has notes, the project tempo from the file, all in ONE undo step (proj_undo takes it all back). '
    + 'Give pfad (absolute path of a .mid/.midi/.rmi file on this machine, at most 8 MiB). vorschau: true reads the file and answers the report without changing anything (use it first on a big file). '
    + 'Answers {bericht, angelegt}: bericht = {datei {format, ticks_pro_viertel, midi_spuren, spuren_mit_noten, noten, laenge_beats, dauer_s}, tempo {quelle_bpm, gesetzt_bpm (null = project tempo kept), aenderungen (tempo changes in the file, counted, NOT mapped), aenderungen_liste}, '
    + 'taktart {quelle [n, d], projekt [n, 4], abweichend} (an empty project takes the first meter of the file when it is n/4, n 2..12, through a leading taktart_setzen; otherwise the project meter stays, the beat positions are kept and the bar lines will not line up with the source bars), spuren [{schluessel "<midi track>.<channel 1..16>", name (the MIDI track name, else the GM program name), kanal, programm, programm_name, schlagzeug, noten, von_beat, bis_beat, polyphonie, geraet (null = no sound), geraet_text, stumm, hinweise}], '
    + 'nicht_angelegt, summe {spuren, clips, noten, ohne_klang}, ignoriert (controllers, pitch bend, ... counted, not carried over), hinweise [{code, text}], anlegbar}; angelegt = [{schluessel, name, spur_id, clip_id}]. Note positions are exact (tick / ticks per quarter = beats); a clip starts on the whole beat before its first note. '
    + 'Instruments: channel 10 (drums) goes to a kit track on the GM drum kit `gm` (the import builds it from the kit techno when the kit folder has none: note N plays the GM sound N, electronic stand-ins); without any kit the drum track exists muted with a hint. '
    + 'Every other part gets the RB-338 (the instrument that scales to 128 tracks; it plays ONE note at a time, so chord parts lose notes: `polyphonie` and the hint midi_mono say where). profil poly puts the parts with chords on Baukasten graphs by GM family (at most 8, only graphs the instance has). '
    + 'zuordnung {"<schluessel>": device} overrides the choice per part: rb338, kit:<name>, bk:<graph>, surge[:1|2], keins (or null: the track is created muted, no sound), or a geraet object as in proj_aendern spur_neu. auswahl [schluessel, ...] imports only those parts (default: all). '
    + 'tempo: auto (default: take the first tempo of the file when the project has no track yet, else keep the project tempo), uebernehmen (always), behalten (never); a tempo outside 60..200 is not set and the report says so. '
    + 'Refused with the reason (nothing is changed): smf_kein_smf, smf_format2, smf_smpte, smf_beschaedigt, smf_leer (the file), midi_datei_fehlt, midi_datei_zu_gross, midi_keine_noten, midi_schluessel_unbekannt, midi_zu_viele_spuren (more parts than free tracks of 128: the text names the numbers, select fewer), zu_gross (65536 notes per project), kein_projekt, rev_veraltet, ki_gestoppt, transport_laeuft, deck_laeuft (tempo).',
    inputSchema: { type: 'object', required: ['pfad'], properties: {
      pfad: { type: 'string', minLength: 1, description: 'absolute path of the .mid file' },
      vorschau: { type: 'boolean', description: 'true: report only, change nothing' },
      auswahl: { type: 'array', items: { type: 'string' }, description: 'part keys "<midi track>.<channel>" from the report; default all parts with notes' },
      zuordnung: { type: 'object', description: 'part key -> rb338 | kit:<name> | bk:<graph> | surge[:1|2] | keins | null | a geraet object' },
      tempo: { type: 'string', enum: ['auto', 'uebernehmen', 'behalten'] },
      profil: { type: 'string', enum: ['einfach', 'poly'] },
      label: { type: 'string', minLength: 1, maxLength: 200, description: 'history label (default "MIDI import: <file name>")' },
      rev: { type: 'integer', minimum: 0 } } },
    lauf: (p) => {
      const { vorschau, rev, ...rest } = p;
      if (vorschau === true) return http('POST', '/proj/midi_import', { ...rest, vorschau: true });
      return mitRev({ rev }, '/proj/midi_import', rest);
    } },
  { name: 'proj_neu', description: 'Create a production project and open it: loads its (empty) playback into the core, sets erz/4 (the production group channel) neutral and all 128 track mixer slots. Closes the project that was open: a transport I started stops. While a transport Andreas started or took over with Stop Cypher is running (from the page, the hardware key, or unknown), it is refused with 409 transport_laeuft and nothing is stopped, opened or created: wait until he stops it. Answers slug, rev, spuren (tracks with clips, notes only as noten_zahl), noten_zahl (notes per MIDI clip) and kern, not the whole project: read it with proj_lage. werkbank: true creates a workbench module instead (a production project with a module marker, loop 0..16 beats, at most 8 instrument tracks, tracks added with werkbank_spur_neu in proj_aendern); vorlage (techno-130-start: Drums 909 and Bass Banddrive, 4 bars, 130 BPM) fills the module in one history step labelled "Template <name>" and needs werkbank (vorlage needs werkbank); with a template it is refused with 409 deck_laeuft while a deck plays (it sets the project tempo), before anything is created. tracker: true creates a tracker project instead (the tracker view marker, nothing else; never together with werkbank): with vorlage 8bit-4kanal (8-BIT · 4 CHANNELS: four amiga tracks Ch 1..Ch 4 panned hard left, right, right, left, 125 BPM, a 64 row start pattern with bass, ARP arpeggio, melody with VIB, SLU and GLD, and drums) or chip (CHIP: Pulse 1, Pulse 2, Triangle, Noise, the same start pattern) it is filled in one history step labelled "Template <name>"; the template ids are checked against the tracker templates when tracker is set.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 },
      werkbank: { type: 'boolean', description: 'true: create a workbench module (loop workbench) instead of a plain production project' },
      tracker: { type: 'boolean', description: 'true: create a tracker project (tracker view marker) instead of a plain production project; not together with werkbank' },
      vorlage: { type: 'string', enum: ['techno-130-start', '8bit-4kanal', 'chip'],
        description: 'template to fill the project with: techno-130-start only together with werkbank: true; 8bit-4kanal and chip only together with tracker: true' } } },
    lauf: (p) => http('POST', '/proj/neu?antwort=kurz', { name: p.name, ...(p.werkbank !== undefined ? { werkbank: p.werkbank } : {}),
      ...(p.tracker !== undefined ? { tracker: p.tracker } : {}), ...(p.vorlage !== undefined ? { vorlage: p.vorlage } : {}) }) },
  { name: 'proj_oeffnen', description: 'Open a production project by slug (from proj_liste): playback, erz/4 neutral, track mixer, loop, metronome go to the core. kern.regler_fehler lists mixer values the core refused (e.g. Andreas holds that fader); kern.regler_ohne_kern counts values without an answer (no core running). Closes the open project like proj_neu: a transport I started stops; while a transport Andreas started or took over with Stop Cypher is running, 409 transport_laeuft and nothing changes. Answers like proj_neu (slug, rev, spuren with noten_zahl per clip, noten_zahl, kern), not the notes; audio tracks with takes carry `takes_zahl` (count of take lanes); `vorhoeren` maps spur_id to the auditioned take_id. A clip with envelopes (huellkurve_setzen) shows `huellkurven: [{ziel, punkte_zahl, verknuepft? (false = unlinked), loop_beats?}]` without the points (the points via proj_auto clip_id).',
    inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    lauf: (p) => http('POST', '/proj/oeffnen?antwort=kurz', { slug: p.slug }) },
  { name: 'proj_lage', description: 'The open project (tracks with id and nr, clips with id and noten_zahl = number of notes (the notes themselves are not listed), instrument tracks with a MIDI stage show midi {aus?, kette (the stages present, in order: akkord, skala, arp, velocity, chance), arp: {muster, rate, schritt_ms, schritte_je_takt (null when free), oktaven, gate_ms}, zaehler: {gehalten (input pitches held now), ein (input notes taken in), aus (notes the stage sent; a step skipped by chance does not count), verloren (input notes dropped, should stay 0)} as the core reports them twice a second, counted since the playback was loaded, null until the core has reported} (step and gate in milliseconds at the project tempo; change with proj_aendern midi_stufe_setzen), tracks with an automation line show lanes [{id, ziel, punkte_zahl, gesperrt? (true when locked)}] (the points themselves via proj_auto), audio tracks with takes carry `takes_zahl` (count of take lanes); `vorhoeren` maps spur_id to the auditioned take_id (audition with take_vorhoeren; instrument tracks have takes too), a clip with envelopes (huellkurve_setzen) shows `huellkurven: [{ziel, punkte_zahl, verknuepft? (false = unlinked), loop_beats?}]` without the points (the points via proj_auto clip_id), audio clips with warp {an, modus (repitch | beats | complex | tones), quelle, eins_unsicher, versatz_beats, marker_zahl, beats? (only when set: {raster, loop, huelle}; absent = default transienten/vor/100)} (the markers themselves via proj_warp); analyse [{clip_id, status: wartet|laeuft}] lists tracks the Werkstatt is analysing for a warp (absent when none), mixer, tempo, loop, marker (the arrangement markers [{id, beat, name, farbe?}] sorted by beat, absent when there is none; proj_aendern marker_setzen and marker_loeschen change them), metronome, rev; `hosts: HostLage[]` while the project has plugin stages: {insert_id, h (host number 1..8), status (startet | bereit | fehlt | ausfall), latenz (samples: round trip + the latency the plugin reports + the extra), gemessen, grund?, fenster (its window is open), anzeige (the plugin has a UI of its own; null = unknown)}) and the core state of the arrangement (kern.rev_geladen = playback number loaded, kern.status 0 stopped, 1 waiting, 2 playing, 3 a freeze or resample tap runs; kern.limiter_db = gain reduction of the set limiter in dB, 0 idle, negative while it reduces, absent until the core has reported). stems {auftrag_id, clip_id, zustand (laeuft | fertig | abgebrochen | veraltet | fehler), stufe (laden | trennen | schreiben), prozent, grund?, text?, hinweis?, spuren?} is the last stem separation of this project (proj_stems), kept after its end; absent when none ran. slug null = no project open. wirte {1: {laeuft, fehler[]}, 2: {laeuft, fehler[]}} says per Surge production host (slot 1 = arr1, slot 2 = arr2) whether it is running and lists the entries of its status file (a running host is never refused for them; for a host that is down a fatal entry makes freeze, export and loudness refuse with wirt_fehler, else wirt_fehlt). baukasten [{kanal, graph}] is the saved sound snapshot (values via proj_bk). A lane the hand has overridden carries uebersteuert: true (Andreas grabbed that field: fader, pan, mute or solo of a track; the lane stays and plays again only after a re-enable, until then the field keeps the value he set); Read it from the lane flag. Give a lane back with proj_auto_zustand. modulatoren [{id, nr, name?, art, form, takt | hz, phase, glatt_ms, an? (false = switched off), ziele [{strang_id, ziel, tiefe, polaritaet?}]}] (an envelope follower, art folger, lists quelle (track id), angriff_ms, abfall_ms, empfindlich_db instead of form, takt, hz and phase, and its targets are always polaritaet uni: offset = tiefe * envelope 0..1) lists the modulators of the project (absent when there is none; change them with proj_aendern mod_neu, mod_aendern, mod_loeschen). Call before proj_aendern.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/proj/aktuell?noten=zahl') },
  // 1.10 slice 6 (plan D1, D13): the routing matrix; read only, no guard. Changing goes through proj_aendern (ziel_setzen, send_setzen, insert_setzen, ...)
  { name: 'proj_routing', description: 'The routing of the open project as one table, read only (change it with proj_aendern: ziel_setzen, send_setzen, '
    + 'insert_setzen, insert_param_setzen). Answers {slug, rev, ziele: [{wert (master or a group id), name}], returns: [{id, nr, name, pre (true = the return takes its '
    + 'send before the track fader)}], straenge: [{art (spur | gruppe | return | pm), id (the production master is master), nr, name, ausgang (master or a group id), '
    + 'ziel_zellen: [{ziel, aktiv (the current target), erlaubt, grund?, text?}] (tracks and groups only; the server answers every cell with the rule of ziel_setzen), '
    + 'sends: [{return_id, db}], stufen: [{insert_id, art (komp | eq | saett | lim | utility | bk | gate | mb | trans | bild), slot, an, schluessel (null = own signal, else {quelle (spur | grp | ret | deck | erz), nr, '
    + 'punkt (pre | post)}; a track pre key set as sc shows as {spur, nr, pre})}]}]}. Without a project: {slug: null}. With stufe (an insert_id of a COMPRESSOR stage '
    + 'from stufen) that stage also lists optionen [{quelle, nr, punkt, erlaubt, grund?, text?}]: every key source the stage may be given (strips of the project at pre and '
    + 'post, deck 1..4, erz 1..4), refused ones with the reason the command would give: routing_zyklus (a group feeding itself or one of the groups below it), (routing_grenze, all 16 groups used, is a command reason and never a cell reason), '
    + 'sidechain_spaet (a group, return or master computed after the tracks cannot key a track stage), sidechain_zyklus (a strip keyed by its own output, a member by any group above it, a group by any group above it, '
    + 'two tracks by each other, own track number as pre key), sidechain_quelle (a source that does not exist in the arrangement block). An unknown stufe or a stage that is '
    + 'not a compressor is argument_ungueltig.',
    inputSchema: { type: 'object', properties: { stufe: { type: 'string', minLength: 1, description: 'insert_id of a compressor stage (from stufen): adds its key options' } } },
    lauf: (p) => http('GET', p.stufe === undefined ? '/proj/routing' : `/proj/routing?optionen=${encodeURIComponent(String(p.stufe))}`) },
  { name: 'proj_aendern', description: 'Change the open project with a list of commands (all or nothing, one undo step, label shows in the history). Each command is {befehl, ...}: spur_neu {art: audio|instrument, name?, gruppe? (text 1..32: tracks with the same gruppe are variants of each other), geraet?: {art: intern (rb338, parameter: lautstaerke, wellenform, cutoff, resonanz, env_mod, decay, accent, each 0..1; or name bk: graph = an instrument graph from graphen, parameter k1..k64 each 0..1, absent = the graph\'s default (0.5 where it has none); the notes of the track play through that graph inside the core, live and in proj_export, no freeze needed; a knob change is spur_aendern with the whole geraet; at most 16 bk tracks (live knob dragging reaches all of them); or name kit: kit = a folder name from proj_kits, [a-z0-9_-] 1..32; a one-shot kit track: the notes of the track start the kit sound of that note number at the exact sample, note off is ignored, velocity scales the level, 16 voices per track (the 17th note steals the oldest with a 5 ms fade), a transport start clears the voices; it needs no freeze and plays the same in proj_export and live; the device has no parameter and cannot be automated; the track is named KIT · <kit> unless you give a name; a kit that is not in the kit folder is refused kit_unbekannt (404); at most 8 kit tracks; format cypherdj-projekt/2 only; a kit that does not load in the core refuses the playback with reason format) | wirt (name plugin + plugin_id of a plugin INSTRUMENT from the plugins tool, status ok: a foreign instrument in the host of a slot, same slots and slot_belegt as Surge, kein_instrument for an effect; its sound is the own sound of the plugin (plugins parameter/param with spur_id), no Surge patch or parameter map) | wirt (surge, slot 1 or 2: without slot the first free one is taken, each slot is one host (arr1, arr2), a third Surge track is refused slot_belegt; patch? = the library name of the Surge patch the track plays, as klang liste prints it ("Pads/MKS-70 Warm Pad" factory, or an own sound): the project stores it, and the server loads it into the host of the slot when the project opens, when patch changes (also undo and redo) and before freeze, export and loudness, with the parameter map sent on top after every load; no patch = the host keeps what it plays (old projects); an unknown name is patch_unbekannt (404); to change it send spur_aendern with the whole geraet incl. patch and parameter; parameter? = a sparse map {name: value} of Surge parameters in the display units of surge_bereiche (at most 32 entries, names like a_filter1_cutoff, a_env1_release; a name or value outside that range is refused argument_unbekannt or argument_ungueltig). An entry is a value the project holds for the host: it is sent to the Surge host when the project opens, on every change, undo and redo, and before a freeze; a parameter not in the map stays as the host patch has it. Absent = no map; spur_aendern takes the whole geraet, so send the whole map)}}; spur_aendern {spur_id, name?, gruppe? (text 1..32, null = leave the group), farbe?, fader_db? (-200..6), pan? (-1..1), mute?, solo?, filter? (-1..1, only a track of a loop deck, 0 = off), eq? ({tief?, mitte?, hoch?} dB -200..6 per band, only a loop deck track), kill? ({tief?, mitte?, hoch?} booleans, false clears; the knob value stays), fx? ({"1"?, "2"?, "3"?} booleans: the track enters beat FX unit 1, 2 or the FX 3 bus, only a loop deck track), geraet?, arm? (true|false), eingang? ({art: intern, name: erz/1|erz/2|erz/3|erz/5|erz/6|erz/7|pad/1|pad/2|deck/1|deck/2} or {art: extern, paar: 1..4, modus: stereo|links|rechts|summe (default stereo)} for an audio track, {art: midi} (MIDI in, the keys on midi_ein_1) for an instrument track, or null; erz/4 and erz/8 cannot be recorded; modus: stereo keeps L and R, links copies L to both, rechts copies R to both, summe is 0.5 * (L + R) on both; monitor? (aus | auto | ein; only for an external input: the live input is heard through the track fader, pan and mute; ein always, auto while the track does not play a clip (or is recording), aus never; it is a project field, absent means auto, and the core takes a change at once, also during a take); an external input needs a device in geraete_lage, and Cypher may start a take on it only when Andreas released it (frei_fuer_cypher): proj_aufnahme then refuses with eingang_nicht_frei)}; variante_waehlen {gruppe, spur_id} (one undo step: the chosen variant plays (mute false), all other tracks of that gruppe are muted, tracks outside the gruppe are untouched; the page shows a key row A, B, C per gruppe; to accept a variant delete the others with spur_loeschen); gruppenspur_neu {name?, farbe?, mitglieder?: [spur_id | gruppe_id]} (a group track, up to 16 (routing_grenze at the 17th); a member is a track or an existing group, and the members play through it: their output moves to the group in the same undo step; a selected member that already plays into another selected group stays inside it); gruppenspur_aendern {gruppe_id, name?, farbe?, fader_db? (-200..6), pan? (-1..1, a balance: centre is 0 dB), mute?, solo?, gefaltet?}; modul_setzen {gruppe_id, modul: {quelle_sha256, titel, kuenstler, fassung, basis_bpm, von_beat, laenge_beats, bpm, tonart, datum, set?, eins_beat?}} (marks a top-level group of the live container as a module with its origin; refused for a group inside another group; a module sits in a container only after platz_setzen with typ stems and its gruppe_id; the export tool modul_export builds whole modules, this verb is for repairs); platz_setzen {platz: 1..4, typ: leer|track|strudel|seq|loops|stems, gruppe_id?} (sets what sits in container <platz> of the live container, one undo step; a group that no place holds is parked, silent and kept, and a later platz_setzen with its gruppe_id brings the same group back; strudel exists once (typ_doppelt), seq and loops create their group when no gruppe_id is given (seq_belegt, platz_belegt), stems needs the gruppe_id of a module; refused with kein_liveprojekt outside the live container; the still rule of the page is POST /plaetze, this verb is the project change itself); strom_spur_neu {strom: 1..16, name?} (adds the strom track of stream <strom> to the strudel module, no clips, plays into the strudel group; refused with kein_strudel_modul when no group is the strudel module, strom_belegt when the stream has a track); strom_send {spur_id, ziel: hall|delay, db} (send of a strom track into the HALL or DELAY return of the strudel module, -200..0 dB; the return is created on first use); loopdeck_neu {platz: 1|2, raster?: 1/4|1/2|1|takt|4takte (default takt)} (creates the loop deck LOOP <platz> (platz is the deck identity 1 or 2) with 4 audio tracks L<platz>.1..4 of 8 cells each in the live container and puts it into the first free container place (a track or empty place; no place is taken from a deck); refused platz_belegt when that deck exists, one undo step), loopdeck_aendern {gruppe_id, raster: 1/4|1/2|1|takt|4takte} (sets the launch grid of a loop deck), loopdeck_leeren {gruppe_id} (empties all 32 cells of a loop deck), zelle_setzen {spur_id, index: 1..8, zelle: {name, farbe 0..15, art: loop|einmal, sha256, beats?, bpm?, gain_db, pfad_hinweis?} or null} (writes a cell with a new id, null clears it; loop cells need beats and bpm), loopdeck_send {spur_id, ziel: hall|delay, db -200..0} (send of a loop deck track into the HALL or DELAY return of its deck, created on first use), loopdeck_effekt {spur_id, graph} or {spur_id, an} (the effect slot of the track, an empty graph removes it), zelle_aendern {spur_id, index: 1..8, name?, farbe?, art?, gain_db?, beats?, bpm?, raster?: 1/4|1/2|1|takt|4takte|null, transponieren?: -24..24|null, rueckwaerts?: true|null, blende?: true|null, scheiben?: {teilung: 1/16|1/8|takt|transienten, grenzen: [beats, rising from 0], folge: [1..n per slot]}|null, keylock?: false|null} (changes fields of a filled cell; raster is the own launch grid of the cell, null removes it; transponieren is semitones and needs a loop cell with keylock on, else nur_keylock; scheiben is the slot order, refused scheiben_ungueltig; every null removes the field; a shorter beats drops envelope points and slots beyond it; refused zelle_leer on an empty one or a hold slot), zelle_huelle {spur_id, index: 1..8, ziel: gain|filter|send.hall|send.delay, punkte: [{beat, wert, form?}]|null} (the envelope of one target of a filled cell, one per target and at most 4, values gain and sends -200..0 dB, filter -1..1, null removes it; refused huelle_ungueltig), zelle_bewegen {von: {spur_id, index}, nach: {spur_id, index}} (moves a cell, swaps when the target is filled, ids are kept, across both decks), session_aendern {raster: 1/4|1/2|1|takt|4takte} (the one launch grid of the live container: the session grid and both loop decks in one undo step; refused kein_liveprojekt outside it), zelle_halten {spur_id, index: 1..8, an: true|false} (an empty slot becomes a hold slot that a scene leaves alone, or an empty slot again; refused zelle_voll on a filled cell), szene_neu {nach: 0..7} (an empty scene row after row nach across all columns, rows below move down; refused zeilen_voll when row 8 is in use), szene_fangen {nach: 0..7, zellen: {spur_id: row 1..8 or null}} (a new row of copies of the chosen cells), szene_doppeln {zeile: 1..8} (a copy of a row right below it), szene_aendern {zeile: 1..8, name?, farbe? 0..15, bpm?|null, takte?|null, folge?|null: loop|weiter|stopp|{sprung: 1..8}} (edit a scene, null removes the optional value), seq_anlegen {platz: 1..4} (builds an empty step sequencer deck in the live container in one undo step: a top group SEQ <platz> without patterns, its marker {schema: 2}; it takes the place (a track or empty place; strudel, loops or a module there is platz_belegt); refused with seq_belegt when that place already holds a deck, with kein_liveprojekt outside the live container, and with the group limit of 16; the tool seq is the way to build decks and patterns); seq_folge_neu {gruppe_id, name, geraet, loop_beats?, stumm?, noten?, seq?, huellkurven?, fx?, raster?} (one pattern of a SEQ deck: an instrument track called name that plays into the group, with one MIDI clip of 64 beats whose loop_beats is the pattern length, 0.125..64 beats in steps of 0.125, default 4; geraet is what spur_neu takes (a bk graph, a kit, rb338); the name is unique in the deck ignoring case, else argument_ungueltig; stumm true mutes the track; noten (as clip_neu takes them), seq (the view descriptor) and huellkurven (a list of {ziel, punkte, verknuepft?, loop_beats?} as huellkurve_setzen takes them) and fx (effect command entries {beat, spalte 0..3, code, wert 0..255} as fx_setzen takes them, clip beats) fill the clip in the same command, all or nothing; raster {lpb?, ticks?} sets the effect frame (rows per beat, ticks per row) the deck plays the effect commands and sample slots of its patterns with, refused as seq_raster_belegt while a pattern of the deck already plays effects or slots at another frame; a group without a deck is seq_fehlt); werkbank_spur_neu {name, geraet, loop_beats?, stumm?, noten?, seq?, huellkurven?, fader_db?} (workbench module only: an instrument track to the master with its pattern clip of 64 beats, loop_beats the pattern length, default 16, fader_db the start level of the new track, at most 8 instrument tracks; a project that is not a module is kein_werkbank, the ninth track werkbank_voll); werkbank_bereich {von_beat, bis_beat} or {aus: true} (workbench module only: the loop range of the module in whole beats, at least 1 beat and inside the module length; aus sets the loop back to the whole module; refusals: kein_werkbank, loop_bereich, modul_bereich); zeile_setzen {clip_id, ton (0..127), schritte? (1..128), swing? (1..100), richtung? (\'pendel\')} (per-row settings of a MIDI clip in the step grid: own step count, swing and play direction of the row of that pitch; null removes a setting; at least one of the three is required); szene_speichern {slot (0..7), an (list of pattern track ids that are on), aus (list of pattern track ids that are off)} (stores a SEQ scene: the picture of the pattern mutes across all SEQ decks, one undo step; the seq tool action szene_speichern reads the current mutes itself, an track id that is no SEQ pattern or appears twice is argument_ungueltig); szene_loeschen {slot (0..7) or zeile 1..8, exactly one} (slot empties the SEQ scene slot; zeile deletes that session row across all columns, the rows below move up and row 8 becomes empty; one undo step); szene_anwenden {slot (0..7), an? and aus? (both together: lists of pattern track ids that replace the saved scene)} (sets the mute of the saved patterns in one undo step, deleted patterns are skipped, patterns outside the scene stay as they are; an empty slot is szene_leer_slot; the live studio switches scenes on the bar through the seq tool, not through this command); tonart_setzen {grundton (0..11, C = 0), skala} or {aus: true} (the key of the project: the page marks its notes in the grid and the piano roll; aus removes it; an unknown scale is argument_ungueltig); harmonie_setzen {eintraege: [{beat, grundton, skala, akkord?}] | null} (the production harmony lane of the project: replaces the whole lane, entries are sorted by beat, one entry per beat, 1..512 entries, beat 0..100000, grundton 0..11 with C = 0, skala as in tonart_setzen, akkord an optional chord symbol text; eintraege: null removes the lane; argument_ungueltig for a bad entry, tracker_live on the live container; a track whose MIDI stage scale is Project key follows it); marker_setzen {id?, beat?, name?, farbe?} (arrangement markers: named points on the timeline, drawn above the ruler of the production page and listed as `marker` [{id, beat, name, farbe?}] in proj_lage; without id a marker is created and beat and name are required, with id the given fields change; beat 0..100000, one marker per beat (marker_beat_belegt), name 1 to 40 characters without control characters, farbe 0..15 and farbe: null removes the colour, at most 64 markers (marker_zu_viele), songmarker_unbekannt for an unknown id, tracker_live on the live container; a marker is no part of the playback, so no change reloads the core; zeit_einfuegen, zeit_entfernen and the section commands move the markers with the material, a marker inside a removed range goes); marker_loeschen {id} (deletes one marker, songmarker_unbekannt for an unknown id); abgabe_meta_setzen {titel?, kuenstler?, album?, jahr?, genre?, isrc?, aus?} (release metadata of the project, written as tags into the delivery files of proj_export: titel, kuenstler, album and genre are text of 1 to 200 characters without control characters or line breaks, stored unchanged; jahr is an integer 1900 to 2100; isrc is 12 characters, capitals and digits, no hyphens, like DEXXX2600001; a given field is set, a field given as null is removed, aus: true alone removes all of them, the last removed field removes the whole object; no field at all, a bad value or aus with another field is argument_ungueltig; without titel the project name is the title; one undo step, playback does not change); seq_leeren {gruppe_id} (removes the SEQ group with its tracks and clips in one undo step, everything else of the project stays; a group without a deck is seq_fehlt); tracker_setzen {an?: true, lpb?: 2|3|4|6|8|12|16|null, ticks?: 1..24|null} (turns on the tracker view of the open production project by setting the marker, and sets its rows per beat (LPB, default 4) and ticks per row (default 6) as one undo step; the default value or null removes the field; at least one argument is required, else argument_ungueltig; refused with tracker_live on the live container and tracker_werkbank on a workbench module); zeit_einfuegen {beat, beats} (inserts empty time into the whole project timeline as one undo step: clips of every track, take clips, the lane points of every strip (tracks, groups, returns, master) the project loop and (when the project has aufnahme) its punch range at or after beat move later by beats, earlier things stay; with a stored section list (tracker view) the section that holds beat grows by beats (the last one for a beat at or behind the end of the list); a clip that crosses beat is refused zeit_schnitt with a text naming clip and track; refused tracker_live on the live container); zeit_entfernen {beat, beats} (removes the time from beat to beat + beats as one undo step: everything behind moves earlier, lane points inside the range are dropped and the value the lane had at the end of the range stays by a point at beat, a loop end inside the range goes to beat, a loop that lay entirely inside is switched off, the punch range likewise; with a stored section list the section that holds the range shrinks by beats, and a range that crosses a section border or covers a whole section is refused zeit_abschnitt; a clip that crosses or lies inside the range is refused zeit_schnitt); abschnitt_neu {nach?, zeilen?, name?} (tracker view: a new empty section after the section id nach, default at the end, of zeilen rows at the project LPB, default 64, with an optional name of 1..40 characters; everything behind moves later; the first section command on a project without a section list writes the list the tracker page shows (sections of 16 beats, ids a1, a2, ...) and the tracker marker first; a clip that crosses the border is refused abschnitt_grenze naming clip and track; abschnitt_unbekannt for an unknown id; refused tracker_live and tracker_werkbank like tracker_setzen); abschnitt_duplizieren {id, als} (a new section behind id of the same length, als = verknuepft: the clips fully inside are copied to the same offset as members of their pattern, so a note edit reaches both, or als = kopie: as unique clips; audio clips are copied in both modes; everything behind moves later; abschnitt_grenze for a clip crossing a border); abschnitt_loeschen {id} (deletes the section, the clips fully inside it and its time, one undo step; a pattern left with one member loses its link; abschnitt_letzter for the last section, abschnitt_grenze for a clip crossing a border); abschnitt_verschieben {id, richtung} (richtung -1 or 1: swaps the section with its neighbour, clips and lane points of both sections move, the project loop stays; abschnitt_rand at the first or last place, abschnitt_grenze for a clip crossing one of the three borders); abschnitt_laenge {id, zeilen} (sets the length of the section to zeilen whole rows at the project LPB; the clips that cover the section exactly change their length with it, everything behind moves; abschnitt_verknuepft when such a clip is linked to another section (make it unique first with clip_entknuepfen), abschnitt_grenze for any other clip that crosses or lies in the changed time); abschnitt_umbenennen {id, name} (names the section with 1..40 characters; name null removes the name); gruppenspur_loeschen {gruppe_id} (its tracks and child groups move to the deleted group\'s own target, its parent group or master, in the same undo step; a key that pointed at the deleted group is removed with it, and a remaining key that the new levels make late or cyclic refuses the delete with sidechain_zyklus or sidechain_spaet; an unknown gruppe_id here and in gruppenspur_aendern: gruppe_unbekannt); ziel_setzen {strang_id (a track id or a group id), ausgang: "master" | {art: "gruppe", id}} (a track can feed one group; a group can feed the master or another group, so groups nest up to the limit of 16 groups; a group onto itself or onto one of the groups below it: routing_zyklus; a move that would make a sidechain key of a compressor stage a cycle or too late is refused with sidechain_zyklus or sidechain_spaet, release the key first; unknown strang_id: spur_unbekannt; unknown target group: ziel_unbekannt); master_aendern {fader_db -200..6} (the production master fader; the export is taken here, see proj_export); return_neu {name?, farbe?, hall?: {an?, pre?, decay?, groesse?, tief?, highcut?, fahne?}, effekt?: {graph, werte?}, gruppe_id? (the top group that owns the return; a live project needs it for the container it plays into)} (a return strip with Cypher Hall, up to 8: routing_grenze; no arguments gives the default Hall; effekt makes an EFFECT return instead: the Hall is off and the chain carries one bk stage with that effect graph, so {befehl: "return_neu", name: "Delay", effekt: {graph: "fx-delay-sync"}} followed by {befehl: "send_setzen", strang_id: <track id>, return_id: <the new return id>, db: -6} is a tempo-synchronous stereo delay send (effekt and hall together are argument_ungueltig; the return id is in the result of proj_aendern or in proj_lage); the Hall values are 0..1 and map to units: pre 0..250 ms, decay 0.1..30 s (log), groesse (size) 5..200 ms, tief (low decay) factor 0.25..4 (log), highcut 1000..22000 Hz (log), fahne (tail level) -24..+12 dB; an = Hall on/off); return_aendern {return_id, name?, farbe?, fader_db? (-200..6), pan? (-1..1), mute?, solo?, hall?: {the same values}, pre? (true = the sends into this return are taken before the track fader and pan, mute and solo still silence them; false = after the fader, the default; a structure change)} (an unknown return_id: return_unbekannt); return_loeschen {return_id} (every send to it goes away in the same undo step); send_setzen {strang_id (a track id or a group id), return_id, db (-200..6, -200 = off)} (how much of the strand goes to the return; sends are post fader and post mute unless the return has pre, so the fader and mute of the track or group also act on the send; a return plays into the master; unknown ids: spur_unbekannt, return_unbekannt); insert_setzen {strang_id (a track, group or return id, or "master"), pos (0..3, at most the chain length; inserts, later stages move back), art: "komp" | "eq" | "saett" | "lim" | "utility" | "bk" | "gate" | "mb" | "trans" | "bild", graph? (art "bk" only, required: the name of an EFFECT graph, one with an input node; the graphen tool lists the graphs with art "effekt" or "instrument": unknown name and instrument graph are argument_ungueltig with the reason in the text; the shipped standard delay is "fx-delay-sync", a tempo-synchronous stereo ping-pong delay (dotted eighth, wet only: knob 1 feedback, knob 2 level); "fx-echo-achtel" is the eighth-note echo with its own dry), werte? (bk: {k1..k64} 0..1, default 0.5, the knobs of the graph, the names are the regler_namen of the graph from the graphen tool; also lane targets, "insert.<stage id>.k1"; utility, the stereo tool (width, bass mono, gain, balance): {breite 0..4 (1 = unchanged, 0 = mono, 2 = side doubled, 4 = side x4 = +12 dB; the mono sum keeps its level, but a width above 2 raises the side part by up to 12 dB and the peak can rise: there is no clipping guard), mono_unter 0 | 1..500 Hz (the signal below that frequency is summed to mono, 0 = off; 1 to 19 act as 20 Hz, a value between 0 and 1 is refused; a jump of mono_unter can be briefly audible, the step rings out in about 2 ms, so lanes on mono_unter are not recommended), gain -60..24 dB, balance -1..1}; lim: {decke -60..0 dB, abklingen 1..2000 ms}; gate: {schwelle -90..0 dB, hysterese 0..24 dB, ratio 1..100, bereich -120..0 dB, attack 0.1..500 ms, hold 0..2000 ms, release 1..5000 ms}; mb (three-band compressor): {grenze_tief 20..20000 Hz, grenze_hoch 20..20000 Hz, and per band m = 1 (Low), 2 (Mid), 3 (High) the names "b<m>/schwelle" -60..0 dB, "b<m>/ratio" 1..20, "b<m>/attack" 0.1..500 ms, "b<m>/release" 1..5000 ms, "b<m>/knie" 0..24 dB, "b<m>/makeup" -24..24 dB, "b<m>/umgehen" 0|1}; trans (transient shaper): {angriff -24..24 dB (gain on the onset, default 0), halten -24..24 dB (gain on the tail after it, default 0), tempo 1..100 ms (detector time, default 15), out -24..12 dB (0), mix 0..1 (1)}; bild (three-band imager): {grenze_tief 40..1000 Hz (150), grenze_hoch 1000..12000 Hz (4000), breite_tief 0..1 (1, the low band can only be narrowed), breite_mitte 0..2 (1), breite_hoch 0..2 (1; 0 mono, 1 unchanged, 2 double side), mono_unter 0..300 Hz (0 = off, everything below it is mono)}; komp: {schwelle -60..0 dB, ratio 1..20, knie 0..24 dB, attack 0.1..100 ms, release 10..1000 ms, makeup 0..24 dB, mix 0..1, schp 0..300 Hz}; saett: {drive 0..36 dB, out -24..12 dB, mix 0..1, kurve 0 Tanh | 1 Soft clip | 2 Hard clip (default 0), decke -24..0 dBFS (the clip ceiling, default 0); the Clipper is saett with kurve 2: werte {kurve: 2, drive: 0, out: 0, decke: -0.3, mix: 1}}; eq: {out -24..24 dB, propq 0|1, and per band m = 1..8 the names "b<m>/an" 0|1, "b<m>/typ" 0..6 (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass), "b<m>/freq" 10..22000 Hz, "b<m>/gain" -24..24 dB, "b<m>/q" 0.1..18, "b<m>/steil" 0..3 (12, 24, 36, 48 dB per octave), "b<m>/platz" 0..2 (stereo, mid, side), and the dynamic bands (EQ Pro): "d<m>/dyn" 0 off, 1 above threshold, 2 below threshold (3 and 4 are the same but detect on the key of the stage, set with sc or key as on a compressor; without a key they act as 1 and 2; only bell, low shelf and high shelf bands are dynamic), "d<m>/schwelle" -60..0 dB, "d<m>/bereich" -24..24 dB (the largest change of the band gain, negative cuts), and for the whole stage "dyn_attack" 0.1..100 ms and "dyn_release" 5..1000 ms; the De-esser recipe is werte {"b6/an": 1, "b6/typ": 2, "b6/freq": 6000, "b6/q": 0.707, "d6/dyn": 1, "d6/schwelle": -30, "d6/bereich": -8, dyn_attack: 1, dyn_release: 60}}; every band starts off, so a new EQ is flat), sc? (compressor and EQ only: 0 = own signal, n = the input of track number n), key? (compressor and EQ only, every other sidechain source: {quelle: spur | grp | ret | deck | erz, nr, punkt: pre | post}; spur with punkt post = the output of track nr after its fader and mute; grp and ret = group or return nr; deck nr 1..4 and erz nr 1 = the DJ mixer inputs, live only (punkt is left out); {quelle: spur, nr, punkt: pre} is the same as sc: nr; sc and key together: argument_ungueltig; a key is a structure change, a stage has one key at most), ersetzen? (true = replace the stage at pos), preset? (register id <werk|nutzer>:<geraet>/<slug> of the preset the values come from; the page sets it when a preset is dropped)} (a stage in the strip chain before the fader, at most 5 stages per strip; pools: 160 compressors, 160 EQs, 32 saturators, 8 limiters, 8 utilities, 16 gates (gate), 8 multibands (mb, three bands b1 Low, b2 Mid, b3 High), 32 transient shapers (trans), 16 imagers (bild) and 8 effect graphs (bk) in the project (the pools are a ceiling, not an operating case: placed stages cost, a full pool exceeds the cost gate): kette_voll, ins_voll, art_unbekannt; an EQ or saturator delays its strip by 69 samples, a limiter by 86 samples, a transient shaper or imager adds no delay (true-peak detection: its ceiling decke is a dBTP value); the core compensates that, so every strip stays in time and the project is that much later against the transport, the export skips it; a structure change); insert_setzen with art: "host" {strang_id, pos, art: "host", plugin_id (an ID from the plugins tool, aktion liste: only an effect with status ok) | plugin {format: vst3 | lv2, pfad, uid}, ersetzen?} puts a foreign plugin effect on a strip; it runs in its own host process (at most 4 at once; the project keeps its state in plugins/<insert id>.carxs) and plays dry and time-aligned while its host is missing or not ready; refused with plugin_unbekannt (404, the ID is not in the index), plugin_blockiert (the scan blocked it), kein_effekt (an instrument), plugin_nicht_ladbar (file missing), host_grenze (all eight hosts used), kette_voll; insert_latenz_extra {insert_id, samples 0..4096} adds samples to the latency of a host stage (0 removes it); the knobs of a plugin are not commands: set them with the plugins tool (aktion param), read them with aktion parameter; plugin_regler_setzen {insert_id, knopf 1..16, index 0..99999 or null} lets knob knopf of a host stage (controller row plug/<host slot>/k<knopf>) drive plugin parameter index (null frees the knob; an index already on another knob of the stage is refused index_doppelt, 409); their further reasons are host_fehlt, param_unbekannt, zustand_passt_nicht and host_insert_echtzeit (a strip with an active plugin stage cannot be rendered offline, it is captured in real time); the plugin window, the plugin scan and learning a controller onto a knob (the MIDI button of a parameter row) are the hand of Andreas only (nur_andreas); insert_param_setzen {insert_id, param (one of werte, or sc on a compressor, or key on a compressor or on a host stage with wert = a key object as in insert_setzen or null to remove it; on a compressor sc and key replace each other; a host stage has key only: its plugin needs 4 audio inputs (audio_ein >= 4, inputs 3 and 4 are the key pair), else kein_schluessel (409), and the source spur with punkt pre is argument_ungueltig there; a change of the key restarts that host), wert} and geraet_param_setzen {spur_id, param (k1..k64, a knob of a Baukasten track), wert (0..1)} (live: no new playback, the sound follows while the knob is dragged, one undo step per drag; refusals: spur_unbekannt, geraet_falsch for a track that is not a Baukasten track, argument_ungueltig; a lane on the knob answers a lane_treibt hint), geraet_stift_setzen {spur_id, satz (0|1, the pin set), zeile (0..15), spalte (0..15), wert (-1..1, 0 removes the pin) } (one pin of the patch field of a Baukasten track; live: no new playback, one undo step per cell; refusals: spur_unbekannt, geraet_falsch, kein_steckfeld when the graph has no matrix node, argument_ungueltig, stift_abgelehnt when the core refuses the pin), geraet_stifte_setzen {spur_id, satz? (0|1: replaces only that set, the other stays), stifte (list of [satz, zeile, spalte, wert], at most 512; null drops the own list so the graph defaults apply again, only without satz)} (a whole pin list in one step, same refusals), stammbaum_setzen {spur_id, stammbaum (the family tree of a Baukasten track: {graph, aktiv (id of the current node), knoten: [{id n1, n2 ..., eltern (null for the root, else an earlier node), werte ({k1..k64: 0..1}: the root holds all knobs, a child only those that differ from its parent), text (at most 80 characters)}]}, at most 200 nodes; null removes the tree)} (project data, no new playback; put it in the same list as the knob change for one undo step; refusals: spur_unbekannt, geraet_falsch for a track that is not a Baukasten track, argument_ungueltig with the first shape error) and insert_an {insert_id, an} (live, no new playback; changing sc between non-zero values is live too, but sc 0 or key with a key present, and any key change, is a structure change); duck_durch_kick {spur_id, kick_id, pos?} (Duck by Kick: a compressor stage on spur_id with the values of the Kick Sidechain preset (threshold -30 dB, ratio 8, knee 0, attack 1 ms, release 150 ms) keyed by the input of the kick track kick_id (sc = its number); pos defaults to the end of the chain; one undo step; refusals: kette_voll, ins_voll, spur_unbekannt, argument_ungueltig for the same track);  insert_entfernen {insert_id} (removes the stage; the slot goes back to the pool and the later stages move up; rack mappings onto it are removed with it, insert_unbekannt for an unknown id); insert_ordnung {strang_id, reihenfolge: [insert ids]} (a permutation of the chain); insert_werte_setzen {insert_id, werte (some of the insert_setzen werte, same names and ranges), preset? (register id <werk|nutzer>:<geraet>/<slug>, null clears it)} (several values of one stage in one undo step, live, no new playback; an and sc stay; applying a preset uses it); insert_setzen and the intern devices (rb338, bk) also take preset? and geraet.preset: the register id of the preset last applied, kept in the project, not part of the sound; changing a device\'s values on a frozen track drops the freeze; a change of only `preset` keeps it; rack_setzen {strang_id, makros: [up to 4 entries {name? (max 24 characters), ziel: [{insert (a stage id from the chain of that strip), param (a continuous parameter of that stage as in werte, not an, not sc, not a step list such as b1/typ), von, bis} | {glied (a member id g1..g4 of the rack device of that track, only on a rack track: glied_ohne_rack, glied_unbekannt), param (RB-338 lautstaerke, cutoff, resonanz, env_mod and bk k1..k64 with von and bis 0..1, gain_db of any internal member with von and bis -60..12; a Surge member takes none: makro_ziel_wirt), von, bis}]}]} (the whole mapping table of the rack of that strip: four macro knobs, each drives the listed parameters from von (macro at 0) to bis (macro at 1) in the real unit, von may be above bis; at most 16 mappings per strip: makro_voll, at most 12 racks in the project: rack_voll, one macro per parameter: ziel_doppelt, only continuous parameters: param_nicht_stetig; no mapping at all removes the rack; a mapping change is a structure change); rack_makro {strang_id, nr (1..4), wert (0..1)} (move a macro knob of the rack of that strip, live, no new playback; rack_unbekannt when the strip has no rack; while a parameter is mapped the own row of that parameter is ignored and insert_param_setzen on it is refused with param_gemappt, remove the mapping with rack_setzen first); makro_variation_speichern {strang_id, name (1..32 characters)} (store the four macro values of the rack of that strip as a variation; an existing name is replaced, at most 8 variations: variation_voll), makro_variation_laden {strang_id, name} (set the four macros to the stored values, live like rack_makro, one undo step; variation_unbekannt), makro_variation_loeschen {strang_id, name} (variation_unbekannt); a mapping change keeps the stored variations, but a table with no mapping at all removes the rack and with it its variations (one undo brings them back); sidechain key refusals of insert_setzen, insert_param_setzen and duck_durch_kick: sidechain_spaet (the source is computed after the stage: a track stage can listen to tracks and the DJ inputs only; groups also to the pre of other groups; returns also to groups; the master to everything but itself), sidechain_zyklus (the key would depend on the stage itself: its own strip, a member track keyed by its own group, two or more tracks keying each other through their post, the production master as a source, erz/4), sidechain_quelle (not available in the arrangement: erz/2, erz/3, erz/5 to erz/8, pad/1, pad/2); a key naming a strip that does not exist: spur_unbekannt, gruppe_unbekannt, return_unbekannt; deleting a track, group or return removes the keys that point at it in the same step; rack_makro {strang_id, nr (1..4), wert (0..1)} (move a macro knob of the rack of that strip, live, no new playback; rack_unbekannt when the strip has no rack; while a parameter is mapped the own row of that parameter is ignored and insert_param_setzen on it is refused with param_gemappt, remove the mapping with rack_setzen first); spur_loeschen {spur_id} (the track goes with its clips); spur_verschieben {spur_id, index} (index = the new position in the track list, 0 = first; index_bereich outside 0..tracks-1); midi_stufe_setzen {spur_id, midi} (MIDI stage chain of an instrument track, one undo step: midi replaces the whole object, null removes it; instrument tracks only, else art_passt_nicht; fields, all optional, order of the chain is fixed: aus true = whole chain bypassed, settings kept; akkord {intervalle} 1..6 integers -24..24, not 0, distinct, semitones added to every key; skala {quelle: projekt} or {grundton 0..11, skala name}, notes are fitted to the scale; arp {muster up|down|updown|downup|played|random|chord, sync true with rate 1/2|1/4|1/4t|1/8|1/8t|1/16|1/16t|1/32, or sync false with hz 0.5..40; oktaven 1..4, gate 0.05..1 = fraction of the step}; velocity {kurve -1..1 (above 0 louder, below 0 softer), zufall 0..64 (random plus or minus), fest 1..127 optional (every note at that value)}; chance 0..100 percent (per key, with an arp per step); saat integer seed (random pattern, velocity zufall and chance draw from it); the engine runs the whole chain, order chord, scale, arp, velocity, chance; proj_lage midi shows the result in real units and midi.zaehler the notes in and out); clip_neu {spur_id, art: audio|midi, start_beat, laenge_beats, loop_beats? (null or missing = off, else 1/16..laenge_beats: the clip repeats [0, loop) up to its length; audio and MIDI), name? (the library title for audio), sha256? (audio: only a sha from the library, see stoebern/klaenge), pfad_hinweis? (audio: text up to 4096 characters, the file path the sha came from; only a hint stored with the source, it names the clip when name is missing), noten? (midi), seq? (midi: the SEQ view descriptor {schema: 1, zeilen: up to thirty-two lanes} of the tool seq, null or missing = none), warp? (audio: "auto" warps a loop or track to the project tempo from the library data, the server then computes laenge_beats from the warp and yours is only the fallback; one-shots and samples without a tempo stay unwarped; "aus" or missing = no warp; or a whole warp object)}; clip_aus_muster {spur_id | clip_id, start_beat? (new clip: where it starts, beats from the project start), code? (a Strudel pattern, one JavaScript expression as in the studio pattern field: 1 cycle = 1 bar = 4 beats, e.g. s("bd*4, ~ hh ~ hh") or note("gs1 ~ gs1 b1").velocity("<0.8 1>"); 1..8192 characters; a bare string is no pattern here: write seq("0 2").add(...) or n("0 2").add(...)), takte? (clip length in bars; absent: a new clip is as long as the pattern takes to repeat (at most 16 bars when it never does), an existing clip keeps its length; a pattern that repeats sooner than the clip sets the clip loop), name? (new clip), ueberschreiben? (true: replace notes and envelopes that were changed by hand since the pattern made them; without it generating a clip again is refused handarbeit_vorhanden)} (spur_id + start_beat + code makes a NEW MIDI clip on an instrument track: the notes are ordinary notes you can edit in the piano roll afterwards, and the pattern is kept on the clip as muster.code; clip_id alone generates that clip AGAIN from its stored muster.code (it replaces the notes and the envelopes, keeps id, place and length: the notes get new ids), clip_id + code takes a new pattern over; one undo step. On a KIT track the sounds are the names of the kit: s("bd") is the first bd, bd:2 the third of the bank, a number beyond the bank wraps; a name the kit lacks is refused klang_unbekannt and the message lists the sounds the kit has; on an instrument track use note(...) or n(...).scale(...) (s(...) there is refused muster_ziel_passt_nicht, note(...) on a kit too). gain/velocity become the note velocity 1..127 (instrument: velocity (0.9) times gain, kit: gain, else velocity, else 1); Strudel randomness (degradeBy, sometimes, ?) is frozen into the notes. Controls with a target become a clip envelope that rides relative on the track value: cutoff/lpf (Hz) to geraet.cutoff and resonance/lpq to geraet.resonanz (RB-338 tracks only), pan (0..1) to spur_pan, a gain driven by a signal to spur_fader (dB); a signal (sine.range(300,3000).slow(4)) is sampled at the note starts and drawn linear, a patterned value (cutoff("<400 800>")) steps; read them with proj_auto {clip_id}. Everything without a target (room, delay, speed, orbit, s on an instrument ...) is NOT applied; cpm is ignored too (the tempo is the project one) and listed in ohne_ziel and is listed in muster.ohne_ziel of the clip and in the answer. A pattern that does not run is refused muster_fehler with the line and column in the message, nothing is created; muster_zeitlimit after 5 s and muster_zu_gross for a pattern with more than 20000 events or that needs too much memory (a refused pattern is remembered, the answer comes at once the second time); muster_fehlt (clip_id without stored pattern and without code). Examples: [{befehl: clip_aus_muster, spur_id: s1, start_beat: 0, code: s("bd*4, ~ hh ~ hh")}] on a kit track; [{befehl: clip_aus_muster, spur_id: s2, start_beat: 0, takte: 8, code: note("gs1 ~ gs1 b1").velocity("<0.8 1>").cutoff(sine.range(300,3000).slow(4))}] on an RB-338 track gives a clip of 8 bars with a loop of 4 and a cutoff envelope)}; clip_aendern {clip_id, start_beat?, laenge_beats?, seq? (midi clips: the SEQ view descriptor, null removes it; see the tool seq), loop_beats? (null = off, else 1/16..laenge_beats: the clip repeats [0, loop) up to its length), offset_s? (refused with offset_bei_warp on a warped clip), versatz_beats? (warped clips only: which beat of the warp plays at the clip start), gain_db? (-96..24), fade_ein_beats?, fade_aus_beats? (fades >= 0, together at most laenge_beats), stumm? (audio clips only: true mutes the clip in the arrangement and in exports, false makes it audible again (null is refused); proj_stems mutes the original this way), spur_id?, name?, entstehung? (provenance of a stream take: {art: "strom", strom: 2|3, graph, regler: 8..32 numbers 0..1, code, bpm}, written by proj_strom_aufnehmen; null deletes it)}; clip_teilen {clip_id, beat} (splits at a project beat strictly inside the clip, beat_ausserhalb otherwise; a clip with a loop must have it switched off first); clips_verbinden {clip_ids: [..]} (glue: two or more clips of ONE track become one clip from the first start to the last end, on the first clip; MIDI notes keep their beats, the envelopes and seq of the first clip win and nothing is merged from the others; audio only for consecutive pieces of one source as clip_teilen makes them, else verbinden_audio; verbinden_spur for clips of different tracks, verbinden_loop for a clip with an active loop); clip_duplizieren {clip_id, ziel_beat?, spur_id?} (a copy at ziel_beat or directly after the original; spur_id puts it on that track instead, spur_art if the track cannot carry that kind of clip); clip_verknuepfen {clip_id, mit} (links two MIDI clips of ONE track into a pattern: clip_id becomes a copy of mit and both get the same verbund; from then on notes, zeile_setzen, fx_setzen, huellkurve_setzen/_loeschen, clip_aus_muster and clip_aendern with name, laenge_beats, loop_beats or seq on either clip are repeated on every member in the same undo step, new notes get the same id in every member; verbund_spur when the clips lie on different tracks); fx_setzen {clip_id, eintraege: [{beat, spalte, code, wert} | {beat, spalte, code: null}]} (tracker view: writes the effect commands of a MIDI clip; beat is the start of the row in clip beats from 0 up to the clip length, spalte 0..3 is the effect column, code one of ARP SLU SLD GLD VIB TRM VSL LVL RTG PAN OFS REV, wert a whole number 0..255; an entry replaces the one in the same beat and column, code null removes it, and entries run in order; on a member of a pattern every member changes in the same undo step; refused fx_ungueltig with a text, nothing is written); clip_entknuepfen {clip_id} (the clip leaves its pattern and keeps its content; a pattern left with one member loses its link too; clip_teilen, clips_verbinden and clip_aendern with spur_id, or with start_beat plus another field (a left trim), unlink the clip the same way; clip_aendern with start_beat alone is a move in time and keeps the link); clip_loeschen {clip_id} (the clip goes with its notes); warp_setzen {clip_id, an? (false keeps the markers but plays the clip unwarped), modus? (repitch | beats | complex | tones. repitch: the pitch follows the tempo like a record; beats: drums, every slice starts on its beat at its own speed and keeps its shape, played by the core without the warp engine; complex: whole tracks, the pitch stays; tones: tonal material, finer grains. complex and tones are stretched ahead of time by the warp engine of the core, 64 voices; a core without it refuses them with warp_maschine_fehlt and a full pool plays the clip as repitch), transpose_st? (whole semitones, -12 to 24), detune_ct? (cents, -50 to 50; together -12 to 24 semitones: transpose_st x 100 + detune_ct within -1200..2400; only in complex and tones, they re-render the clip ahead of time, so a change is heard after a short moment; repitch follows the tempo like a record and refuses any value but 0 with transpose_repitch, so set modus repitch together with transpose_st 0 and detune_ct 0), beats? (the whole parameter object, written beats {raster: transienten | 1/4 | 1/8 | 1/16 | 1/32, loop: aus | vor | vor_zurueck, huelle: 0..100}; read only in mode beats and kept when the mode changes; default transienten/vor/100: raster = where each slice starts (at the transients of the audio, without a transient list on 1/16), loop = what fills the gap when the tempo is slower than the audio (aus: silence, vor: the end of the slice looped forward, vor_zurueck: back and forth), huelle = 100 keeps each slice whole, lower fades it out sooner; beats follows the tempo like repitch and refuses transpose_st and detune_ct other than 0 with transpose_repitch), or warp: {the whole warp object} / null to remove it}; warp_auto {clip_id} (sets the warp from the best source: the Werkstatt analysis map with every beat as a marker, else the Traktor grid, else the bars (takte), else the library BPM; refused with kein_tempo when there is none, except for a long track (60 s and more) without a map or a grid: then the Werkstatt analyses it in the background, the answer carries hinweise analyse_angefordert and the clip is warped when the analysis arrives; the clip length stays); clip_neu with warp "auto" and warp_auto warp in this order: (1) the Werkstatt analysis map of the file (same sha256), one marker per beat, marker beat 0 = the first bar one, the clip starts there and is as long as the rest of the file; eins_unsicher when the analysis was unsure; (2) the Traktor grid (anchor and BPM, eins_unsicher); (3) loops with bars (takte) lie on takte x 4 beats; (4) the library BPM from second 0 (for a track the bar one is then unsure). One-shots never warp. Warp by hand (all take a clip with a warp, else kein_warp; beats here are CLIP beats = the beat of a marker, 0 = the bar one of the source; every one is a single undo step and sets quelle hand): warp_tempo {clip_id, faktor: 2 | 0.5} (x2 or :2: every marker beat, the offset, the clip length and the loop length are multiplied, so every segment tempo is multiplied; the same piece of the source takes twice (half) as many beats; refused with warp_faktor when a segment would leave 15..800 BPM); warp_marker {clip_id, setze?: [{quell_s, beat?}] (a marker at source second quell_s; without beat it gets the beat the grid has there, so the sound does not change), loesche?: [beat], verschiebe?: [{beat, neu_quell_s | neu_beat}] (the marker that has this beat now; neu_quell_s moves it in the source and keeps its beat, neu_beat keeps its source second and moves its beat)} (order: delete, move, set; refused with marker_unbekannt when no marker has that beat, with warp_marker when the result is not strictly rising or has under 2 or over 4096 markers; the clip length stays); warp_ab_hier {clip_id, beat, art: gerade | start} (Warp From Here: gerade replaces every marker from that clip beat on by ONE segment with the tempo that holds there; start sets the auto warp again from there on, like warp_auto, and needs a tempo source, else kein_tempo; the clip length stays); eins_hier {clip_id, quell_s} (Set 1.1.1 Here: source second quell_s becomes beat 0, rounded to the nearest whole beat of the analysis map in the correction line. The clip starts there (offset unchanged), so the track moves on the project by the beats the point lay behind the old bar one (like Live); its length changes so it plays the same end of the source; eins_unsicher becomes false. If the track is in the deck stock and this server writes corrections, a line von andreas (also when Cypher sends it) is saved: the next auto-warp of that track starts there and the decks use it after their next render; undo takes back the clip, not the line; hinweise tell: eins_gemeldet, eins_nur_hier (no line written: the track is not in the stock or this server writes none, only this clip changed), eins_rueckweg_fehler (the clip changed, the line could not be written)); tempo_vom_clip {clip_id} (sets the project tempo to the tempo at which the clip plays as long as the piece of the source it uses, 60 x laenge / (source seconds); refused like tempo_setzen: deck_laeuft, tempo_bereich); audio_quantisieren {clip_id, raster: 1/4|1/8|1/16|1/32, staerke? (0..1, default 1), von_beat?, bis_beat? (clip beats, the beats of the markers, 0 = 1.1.1 of the source; not project beats; default: the range of the clip)} (Quantize Audio: the grid is the project grid (a clip that starts off the grid still lands on it); moves the hits onto the grid by setting a hand marker at each transient of the audio, strength 1 puts it exactly on the grid line, 0.5 half way; markers outside the range stay, the ones inside are replaced; clip length stays, one undo step; refused with transienten_fehlen when the audio is not decoded yet, keine_transienten when the range holds none, quantisieren_konflikt when the new markers would not rise strictly, warp_faktor or warp_marker when a segment would leave 15..800 BPM or the marker count 4096: nothing is shortened silently); noten_neu {clip_id, noten: [{beat (in the clip), laenge, ton 0..127, vel 1..127, spalte? 2..8 (the tracker note column; 1 is the same as absent and is never stored), platz? 1..32 (the slot of a device with a slot role, shown in the tracker INS column; absent = the slot the knob stands on)}]}; noten_aendern {clip_id, noten: [{id, ...changed}]} (changes the given fields of existing notes: beat, laenge, ton, vel, spalte (2..8, 1 or null removes it), platz (1..32, null removes it)); noten_loeschen {clip_id, ids} (ids = note ids from proj_lage notes; an unknown id: noten_unbekannt); noten_quantisieren {clip_id, raster: 1/32|1/16T|1/16|1/8T|1/8|1/4T|1/4, staerke? (0..1, default 1), swing? (50..75 percent, default 50 = straight; only with the straight grids 1/32, 1/16, 1/8, 1/4, a triplet grid is refused argument_ungueltig), tonart? (true also moves every touched pitch to the nearest note of the project key; refused argument_ungueltig when the project has no key), noten_ids? (default: all notes of the clip; an unknown id: noten_unbekannt, nothing changes)} (quantises the note starts of a MIDI clip to the grid, clip relative: new beat = beat + (nearest grid position - beat) x staerke; swing puts the second position of each pair of grid steps at pair start + 2 x step x swing / 100 (66.67 = triplet feel), stored in the notes; lengths stay; a note never leaves [0, end of the clip content) where the end is loop_beats, else laenge_beats: it takes the last grid position before it, and a note already outside stays untouched; linked clips stay equal; one undo step; a command that changes nothing succeeds without a change and without an undo step); noten_humanisieren {clip_id, saat (0..4294967295, whole number), zeit? (0..50 percent of a sixteenth, 50 = up to 0.125 beat earlier or later), vel? (0..40 velocity steps), noten_ids? (default: all notes)} (humanise: moves the note starts by up to zeit and the velocities by up to vel, uniformly; the draw is fixed by saat and note id, but it acts on the current starts and velocities: the same call twice moves twice, a new saat moves the notes again, only undo goes back; velocity stays 1..127, beats stay inside the clip content as in noten_quantisieren; at least one of zeit and vel must be above 0, else argument_ungueltig; one undo step); audio_noten_aendern {clip_id, ids, ton | ton_um, a, e, zeit_um, vib | vib_um, drift | drift_um, mit_nachbarn?} (pitch and time targets of detected notes of an audio clip, the detected values qa, qe and qton never change: ids = 1..4096 different note ids of the clip field audio_noten, written t1, t2 and so on. Pitch: exactly one of ton = an absolute MIDI pitch as a float for every id, and ton_um = semitones added to the current target of each note, or to its qton when it has none; the target is rounded to 1e-4, stays within 24 semitones of qton and inside MIDI 0..127, and a target equal to qton is removed. Time (all in SOURCE seconds, the time of the recording itself, not beats): a and e = the target start and end of exactly one note, absolute, either one or both (a is at least 0, e is after a); zeit_um = seconds added to start and end of every id, the length stays (a pure move). The new interval is what the note then covers: the sound is moved or stretched to it, what it vacates becomes silence, the total length of the clip stays. The stretch factor (new length / detected length) must be 0.25..4, else noten_dehnung_grenze. mit_nachbarn (boolean, default true): a neighbour that touched the moved edge (gap under 40 ms before the edit, legato) follows the edge; with false, or when there was a gap, the gap gives or takes and the neighbours stay. After that the effective intervals of notes must not overlap, else noten_ueberlappen. A target equal to the detected value is removed. Pitch and time in one command are one change; one undo step, nothing is written when one id is refused; after a time edit read proj_noten until render is bereit before you judge the sound; vib and drift are factors of the detected vibrato and drift of the note: 0 flat, 1 as sung (not stored), up to 4; vib_um and drift_um add to the current factor; rounded to 1e-3; outside 0..4 is argument_ungueltig; only the factor is written, formant and gain_db stay argument_unbekannt); audio_noten_raster {clip_id, ids?, zeit?, ton?, staerke?, tonart?} (quantise and snap detected notes of an audio clip in one change, one undo step: at least one of zeit and ton; zeit = a grid of 1/32, 1/16T, 1/16, 1/8T, 1/8, 1/4T, 1/4 (the beat grid of the clip, warp included) and moves each note start toward the nearest grid line, the length stays and touching neighbours follow; ton = halbton (nearest semitone) or tonart (nearest degree of the key: tonart {grundton 0..11, skala} given here, else the project key; no key at all is argument_ungueltig) and sets only the centre pitch target ton, vibrato and drift stay; staerke 0..1 (default 1) = how far of the way, 0 changes nothing; without ids every note in the audible range of the clip; a note whose move or pitch would break a limit (stretch, overlap, 24 semitones) stays unchanged and the others are still done; read proj_noten afterwards: mass shows the move of each note in ms and cents); audio_noten_zuruecksetzen {clip_id, ids?} (removes every target field of the given notes, of all notes of the clip without ids; the detected notes stay; one undo step); audio_noten_entfernen {clip_id} (deletes the whole note list of the audio clip so it plays its source again; one undo step). Audio note refusals: clip_unbekannt, feld_nur_audio (a MIDI clip: its notes are noten_aendern), keine_audio_noten (the clip has no notes yet: detect notes first), noten_unbekannt (an id that is not in the list), argument_ungueltig (empty or doubled ids, both or none of ton and ton_um when no time field is given, a and e with more than one id), noten_ton_grenze (a target beyond 24 semitones from qton or outside MIDI 0..127), noten_dehnung_grenze (stretch factor outside 0.25..4), noten_ueberlappen (effective intervals of two notes overlap); take_neu {spur_id, name?} (a new empty take lane on an audio or instrument track); take_umbenennen {spur_id, take_id, name} (renames a take; its kind stays, the Original lane keeps its mark); take_loeschen {spur_id, take_id} (removes the take lane only; it leaves the main track untouched); comp_waehlen {spur_id, take_id, von_beat, bis_beat} (copies [von_beat, bis_beat) from the take lane into the main track and replaces exactly that range there; gaps in the take become silence; four ms fades at the seams on an audio track; on an instrument track the take lane holds MIDI clips: the notes with onset in the range are copied with fresh ids, a note across the end of the range is cut there, and there are no fades; one undo step; if the range is already equal nothing changes; it switches no playback: to listen to a take use take_vorhoeren). Recording onto an armed audio track writes the take into the main track, where it replaces the range, and at the same time into a take lane: the newest lane if it is empty in that range, else a new lane "Take <n>". The lane "Original" is never chosen for this; overwritten material that is not itself a take goes into it. A MIDI recording in replace mode keeps every loop pass as its own take lane (see proj_aufnahme). Take refusals: take_unbekannt (404), takes_voll (at most 32 lanes per track), take_nur_audio (a stream track has no take lanes), take_name_ungueltig, comp_leer; auto_neu {spur_id (a track) or strang_id (a track, group, return or "master"), ziel: "fader" | "pan" | "mute" | "solo" | "geraet.lautstaerke" | "geraet.cutoff" | "geraet.resonanz" | "geraet.env_mod" (these four only on an RB-338 track) | "geraet.k1".."geraet.k64" (the knobs of a bk track, 0..1) | "send.<returnId>" (the level of an existing send of a TRACK into that return, e.g. "send.r1"; dB like send_setzen; tracks only, not groups) | "insert.<stage id>.<param>" | "plugin.<host stage id>.<index>" (0..1, a parameter of a foreign plugin, see below) | "rack.m1".."rack.m4", punkte?: [{beat, wert, form?}] (the lane and its points in one command, checked like auto_punkte; without it the lane starts as described below; this is also how a recorded take is written; strang_id r<n> with ziel "fader" is the volume curve of a return strip, read it back with proj_auto spur_id r<n>; the master and groups take no fader curve)} (a line under the track for one target; it starts as two points at the loop brackets on the current value of that target; ranges of wert: fader -200..6 dB (-200 = off), pan -1..1, mute and solo 0 or 1 (always jumps, form sprung), send.<returnId> -200..6 dB (the track must already have that send, else ziel_unbekannt; the lane plays at block rate, so a step is smoothed over up to 21 ms; while the lane exists the send knob is stored but not heard, and send_setzen to -200 is refused send_hat_lane: delete the send lane first; return_loeschen removes the lanes of that return; the hand cannot grab a send lane), insert.<stage id>.<param> the range and unit of that parameter in the contract (e.g. insert.i1.schwelle -60..0 dB, insert.i5.b1/gain -24..24 dB; a continuous parameter of a built-in stage on that strip; not an, not sc, not a switch or a step list, not a host stage: param_nicht_stetig, argument_unbekannt, ziel_unbekannt; the stage must be in the chain of the strip: insert_unbekannt), plugin.<host stage id>.<index> (0..1, a parameter of a foreign plugin: index as in the parameter list of the plugin (plugins aktion parameter); played by the page server at 50 Hz, about 10 ms timing, not sample-accurate; at most 16 per plugin, plugin_lanen_voll (409), counted per host stage and NOT against the 12 lanes per strip that reach the core), rack.m1..rack.m4 0..1 (macro value; the strip needs a rack: rack_unbekannt); an insert or rack lane lives on the strip that carries the stage or rack, so for a group, a return or the master give strang_id; one writer per parameter: a lane on a parameter a rack macro drives is refused with param_gemappt (automate the macro instead), and rack_setzen onto a parameter that has a lane is refused with param_hat_lane; a lane goes when its stage or rack goes; at most 12 lanes per strip, 64 insert and rack lanes in the project (zu_gross); while the transport plays, the lane replaces the row value of the parameter block by block, when it stops the row value is back; a write to such a parameter (insert_param_setzen, insert_setzen, rack_makro, a bk knob in spur_aendern) is kept as the rest value and answered with hinweise: [{index, hinweis: "lane_treibt", lane_id, ziel, strang_id, text}]; geraet.* 0..1 and only on tracks with the RB-338 device (not the bk device) (otherwise ziel_unbekannt; switching such a track to a host device while it has geraet.* lanes is refused with geraet_lanes from spur_aendern: delete the lanes first); one lane per target and track, else lane_doppelt; an unknown ziel: ziel_unbekannt; the value of the track itself stays the base value that sounds when the transport stops or the lane is gone); auto_punkte {lane_id, setze?: [{beat (project beat 0..100000), wert (in the unit and range of the lane target, see auto_neu), form? linear (default) | s | sprung}], loesche_von?, loesche_bis? (project beats, both ends included)} (first deletes the points from loesche_von to loesche_bis, then sets the given ones; a set point replaces every point at its beat; two points at the same beat make a jump, three are refused; beats rise; 1..8192 points per lane, 65536 per project: punkte_ungueltig, zu_gross; a wert outside the range of the target: punkte_ungueltig; to remove the last point use auto_loeschen); auto_loeschen {lane_id} (lane_unbekannt for an unknown lane_id); auto_aendern {lane_id, gesperrt: boolean} (lock or unlock a lane; on a locked lane auto_punkte and auto_loeschen are refused with lane_gesperrt (409) until it is unlocked; proj_auto and proj_lage show gesperrt: true); MODULATORS (strand 6, an LFO that moves a target around its base; each verb is one undo step, at most 16 modulators per project): mod_neu {art? (lfo | folger, default lfo; folger = envelope follower: the level of a source track moves the targets), form? (lfo only: sinus | dreieck | saege | rechteck | zufall, default sinus), takt? (lfo only: beats per period 1/64..256, default 4: synced to the project beat, so it also runs while the transport stands; exclusive with hz), hz? (lfo only: free rate 0.01..40 Hz instead of takt), phase? (lfo only: 0 up to below 1, default 0, the start position inside the period; 1 is refused, it is the same position as 0), quelle (folger only, required: the track id whose signal it follows, read before its chain and fader with one audio block of latency; none of the targets of the same follower may sit on that track), angriff_ms? (folger only: attack 0.1..500 ms, default 5), abfall_ms? (folger only: release 1..5000 ms, default 150), empfindlich_db? (folger only: sensitivity -24..24 dB, default 0: the output is 0 at -60 dBFS and 1 at 0 dBFS, a positive value lifts quiet sources), glatt_ms? (smoothing 0..500 ms, default 1), name? (1..32 characters), ziele (1..8 targets, required: [{strang_id, ziel, tiefe, polaritaet?}], strang_id = a track, group or return id from proj_lage or master, ziel = fader | pan of a track, fader of a return, geraet.<parameter> of a track whose device has it (RB-338 lautstaerke, cutoff, resonanz, env_mod; bk k1..k64), send.<return id> of a send the track has (a send of a group is not modulated), insert.<stage id>.<param> of a continuous parameter of a built-in stage on any strip (the names of lanes; not an, sc, a switch or a step list, not a host stage, not a parameter a rack macro drives: modulate the macro), rack.m1..rack.m4 on a strip with a rack, or plugin.<host stage id>.<index> of a host stage on the strip, tiefe = the swing in the unit of the target: fader and send dB -24..24, pan -1..1, geraet.*, rack.* and plugin.* -1..1 (parameter range 0..1), insert.* -1..1 as a share of the parameter range (0.5 on a threshold of -60..0 dB swings 30 dB), a negative tiefe inverts the swing, polaritaet = uni only (absent = bipolar: the offset swings between -tiefe and +tiefe; uni: between 0 and tiefe; a follower is always uni: silence gives 0, full level gives tiefe, so a negative tiefe on a fader ducks it); one target at most once per modulator)} (creates a modulator with the lowest free slot; the answer is the usual proj_aendern answer, read the new mod_id and its nr from proj_lage modulatoren; refused mod_voll when all 16 are used, mod_ziel_unbekannt when a target does not exist or does not fit its strip, param_gemappt for a stage parameter a rack macro drives, spur_unbekannt when quelle is no track, argument_unbekannt for a field of the other kind (form on a follower, angriff_ms on an lfo), argument_ungueltig for a value outside its range); mod_aendern {mod_id, any field of mod_neu: art, form, takt, hz, phase, quelle, angriff_ms, abfall_ms, empfindlich_db, glatt_ms, name, ziele (replaces the whole list of targets), plus an? (false switches the modulator off and keeps its settings, true switches it on again)} (takt and hz replace each other: give one of them; a new art drops the fields of the old kind, lfo gets form sinus and takt 4 again, folger needs quelle; refused mod_unbekannt for an unknown mod_id, otherwise like mod_neu); mod_loeschen {mod_id} (removes the modulator and all its targets, mod_unbekannt for an unknown mod_id). A modulator adds an offset on top of the base value of its target: result = base + offset, clamped to the range of the target. Moving the base (proj_aendern spur_setzen or insert values, regler rows, a lane, Andreas\' hand) keeps the modulation running around the new base; a hand override does not stop it, switch it off with mod_aendern an false. Removing a track, return or stage drops the targets on it, and a modulator left without targets goes with them; removing the source track of a follower switches it off (an false) and keeps it: give a new quelle with an true. The offset is evaluated in the core, per sample for fader and pan, once per block for geraet.*, send.*, insert.* and rack.*; plugin.* targets are sent to the plugin by the server at 50 Hz (as plugin lanes); the follower reads the source of the previous block (at most 21 ms late). Read the modulators with proj_lage modulatoren. the lane editor tools (each one undo step, refused on a locked lane with lane_gesperrt; von_beat < bis_beat inside 0..100000, else bereich_leer): auto_vereinfachen {lane_id, von_beat, bis_beat, toleranz? (default per target: fader 0.3 dB, pan 0.008, geraet.* 0.004)} (thins the points in the range while the line stays within the tolerance; only runs of linear segments are thinned, every s or sprung point and its neighbours stay, so mute and solo lanes come back unchanged); auto_dehnen {lane_id, von_beat, bis_beat, neu_bis_beat (> von_beat)} (stretches the points in (von_beat, bis_beat] onto (von_beat, neu_bis_beat]; points that lay in the new span go; after the later of bis_beat and neu_bis_beat the line keeps its values); auto_neigen {lane_id, von_beat, bis_beat, faktor -1..1} (skews the timing inside the range: a point at the share u of the range moves to u^(4^faktor), values and forms stay, 0 changes nothing, 1 pulls the points towards von_beat); auto_form {lane_id, von_beat, bis_beat, form: rampe_auf | rampe_ab | sinus | dreieck | rechteck, perioden? 1..64 (default 1), unten?, oben? (default: fader -60..0 dB, pan -1..1, geraet.* 0..1)} (replaces the points in the range by the shape; at both edges a jump keeps the old value outside; mute and solo take rechteck only, else form_ungueltig); clip envelopes (slice 5, one per target and clip, set as a whole): huellkurve_setzen {clip_id, ziel: gain | transpose | spur_fader | spur_pan | geraet.lautstaerke | geraet.cutoff | geraet.resonanz | geraet.env_mod | geraet.k1..geraet.k64 (the knobs of a bk track), punkte: [{beat (CLIP beat: from the clip start, 0..100000, rising, at most two at one beat = a jump), wert, form? linear (default) | s | sprung}] (1..8192), verknuepft? (only false is stored: unlinked), loop_beats? (only with verknuepft false, 1/16..clip length)} (the envelope of that target replaces the old one; gain: audio clips only, dB -200..0 on top of gain_db, a ramp from or to -200 runs from -60 like the fader; transpose: MIDI clips only, semitones -48..48, rounded at the start of each note (a note keeps its pitch while it sounds); spur_fader (dB -60..6), spur_pan (-2..2) and geraet.lautstaerke | cutoff | resonanz | env_mod (-1..1, MIDI clips on RB-338 tracks only) are RELATIVE: they ride on top of the track\'s own value or lane (the sum is clamped to the range of the target), so a track lane and a clip envelope on the same target work together; linked (default): the points of [0, clip loop) repeat with every loop copy of the clip; unlinked (verknuepft false): they repeat modulo loop_beats from the clip start over the whole clip, whatever the clip loop is (without loop_beats they do not repeat); the clip commands keep them consistent (clip_teilen cuts them at the split, clip_duplizieren copies them); there is no lock for envelopes; refused: huellkurve_ziel (400, the target does not fit this clip), punkte_ungueltig, zu_gross, argument_ungueltig, clip_unbekannt (404), geraet_huellkurven (400 from spur_aendern: a track with geraet.* envelopes cannot switch to a host device)); huellkurve_loeschen {clip_id, ziel} (huellkurve_unbekannt 404 when the clip has none); read an envelope back with proj_auto clip_id and ziel; tempo_setzen {bpm 60..200} (refused while a deck plays: deck_laeuft); taktart_setzen {taktart [n, 4], n 2..12} (the project meter, default [4, 4]; the ruler and the bar fields follow it, the core still counts bars of 4 beats: metronome accent, count-in and start quantise; other denominators: argument_ungueltig); loop_setzen {an, von_beat, bis_beat} (the loop range in project beats, at least 1 beat long: loop_bereich); metronom_setzen {an?, pegel_db? -60..0, ziel? master|cue} (the metronome on/off, its level and where it plays; at least one field); aufnahme_setzen {vorzaehler_takte? (0, 1, 2 or 4 bars of count-in before a recording), punch? {ein?, aus?, von_beat?, bis_beat?} (the punch range in project beats, bis_beat greater than von_beat; ein and aus switch punch in and punch out), overdub? (true or false: a MIDI take adds to the notes in its range, false replaces them; audio has no overdub switch)} (the recording settings of the project, kept in the project, at least one field; the first call creates them); bk_setzen {kanal e.g. erz/2, graph (name) | null (removes the entry), regler? [8..32 values 0..1; missing 9..32 read as 0.5], sha256?} edits the sound snapshot (normally proj_bk does this); geraet_richtung {spur_id, wort, staerke? (1..3, default 1)} (description to sound on an RB-338 track: a word moves the device parameters by bounded steps of 0.12 x staerke, clamped to 0..1: bright (cutoff up, env_mod up), dark (cutoff down, env_mod down), aggressive (resonanz up, accent up), soft (resonanz down, accent down), tight (decay down: on the RB-338 this only shortens the decay of the filter envelope, a slightly shorter bright tail, not the amplitude, so the note keeps its length), deep (cutoff down by ' + DEEP_FAKTOR + ' steps, volume untouched); one undo step, name it with the label "<word> <track name>"; a word the device does not know is refused richtung_unbekannt (404) and the detail lists the words it knows; a track that is not an RB-338 or Surge (audio, bk, kit) knows none. On a Surge track the words are bright, dark (a_filter1_cutoff +/-), aggressive, soft (a_filter1_resonance +/-) and tight (a_env1_release and a_env1_decay down); they move entries of the parameter map of the device by the bounded steps of the table in project/direction.ts times staerke, clamped to the range of surge_bereiche, starting from the value the map holds or, when it holds none, from the value the host plays now (read from the host; when the host is not running the word is refused wirt_wert_unbekannt (409) and nothing changes); when filter 1 is off in the patch the Surge host plays (a_filter1_type 0, the factory Init Saw) bright, dark, aggressive and soft are refused richtung_wirkungslos (409, nothing changes: they move only filter 1 and would not change the sound; load a patch with filter 1 on or use another word; tight still works); deep does not exist on Surge and is refused richtung_unbekannt; when every parameter of the word is already at its bound the call is refused richtung_grenze (409) and nothing changes); preset_anwenden {spur_id, preset} (sets the whole parameter object of an RB-338 track from a preset: preset = an id from presets_suchen like werk:rb338/dark-dub; a parameter the preset does not name goes back to the plugin default; one undo step; an unknown preset is preset_unbekannt (404), an id that is not <werk|nutzer>:rb338/<slug> or a track that is not an RB-338 is argument_ungueltig). Beats are project beats (4/4). Solo on a track keeps all groups above it sounding, solo on a group keeps everything below it and every group above it sounding (siblings stay silent); mute on a group silences everything below it, child groups and sends included; mute wins over solo. rev defaults to the current one (proj_lage); rev_veraltet means someone changed it in between: read again. regler_abgelehnt: the core refused a mixer value (nothing was changed). The arm of spur_aendern is the audio record arm (proj_aufnahme), not the automation record arm: arming a track to record fader, pan, mute or solo moves into a lane is Andreas\' hand (refused with nur_andreas, no tool exists for it). Stop Cypher stops only my hand: it lowers no fader, and what sounds keeps sounding (the track field von is cypher and never changes, it controls nothing). Answers rev, kern (what the core acknowledged) and noten_zahl (notes per MIDI clip), not the project: read it with proj_lage. hinweise [{index, hinweis}] appears when an auto-warp has something to say: kein_tempo (no source found: the clip was made without warp), analyse_angefordert (a long track has no map yet: the Werkstatt analyses it in the background and the clip is warped when it arrives, one history entry "Auto-Warp"; proj_lage lists the running analyses under analyse), analyse_laeuft (that analysis is already running), karte_zu_gross or karte_unbrauchbar (the analysis map was not usable, the next source was taken). Warp refusals: kein_warp, warp_marker, warp_faktor (segment tempo outside 15..800 BPM), warp_modus, transpose_repitch, offset_bei_warp, kein_tempo, warp_auto_neuer_clip (warp_auto names a clip created in the same list: use clip_neu with warp "auto"). Instrument rack (one track plays several members at once): the device is {art: \'rack\', kette, glieder: [{id, geraet, ton?, vel?, kette?, gain_db?}]} in spur_neu or spur_aendern geraet, at most 4 members (ids g1..g4), each member an RB-338, a bk graph, a kit or a Surge slot (no rack inside a rack; a Surge member has no parameter and takes a production slot); ton (0..127), vel (1..127) and kette (0..127) are zones [lo, hi], missing = the whole range; the rack\'s own kette (0..127) is the chain value, a member sounds while it lies inside its kette zone; gain_db -60..+12; at most 8 racks; a rack with a Surge member needs a freeze before export; spur_aendern geraet {art: \'rack\'} turns the current device into member g1. rack_glied_setzen {spur_id, glied} (add or replace by id), rack_glied_entfernen {spur_id, glied_id} (not the last member), rack_kette {spur_id, kette} (the chain value of the rack); each is one undo step. Refusals: keine_rackspur (the track has no rack), rack_voll_glieder (a fifth member), glied_unbekannt (no member with that id), rack_letztes_glied (the last member cannot be removed), slot_belegt (a Surge member needs a production slot that another track or member holds). '
    + 'blend_setzen {gruppe_id, wert} (the blend 0..1 of a stem group of a live module: stored on the group and turned into its two track faders by an equal-power law, 0 = original only, 1 = new instrument path only; the tool modul_blend does the same by slot and stem, also over bars; kein_neuer_pfad when the group has no new path; a lane on it is auto_neu with ziel blend:<group id>); blend_trim_setzen {gruppe_id, db} (the level offset of the new path against the original, -60..24 dB, normally measured by the server after the MIDI render and shown as neu_trim_db on the group: the new fader at blend 1 sits at db, so the new path is as loud as the original at 0 dB; 0 removes it).',
    inputSchema: { type: 'object', required: ['label', 'befehle'], properties: { label: { type: 'string', minLength: 1, maxLength: 200 },
      befehle: { type: 'array', minItems: 1, items: { type: 'object' } }, rev: { type: 'integer', minimum: 0 } } },
    lauf: (p) => mitRev(p, '/proj/aendern', { label: p.label, befehle: p.befehle }) },
  { name: 'proj_undo', description: 'Undo the last change of the open project (any source). rev defaults to the current one. Answers like proj_aendern (rev, kern, noten_zahl).',
    inputSchema: { type: 'object', properties: { rev: { type: 'integer', minimum: 0 } } }, lauf: (p) => mitRev(p, '/proj/undo', {}) },
  { name: 'proj_redo', description: 'Redo the last undone change (gone after a new change). rev defaults to the current one. Answers like proj_aendern (rev, kern, noten_zahl).',
    inputSchema: { type: 'object', properties: { rev: { type: 'integer', minimum: 0 } } }, lauf: (p) => mitRev(p, '/proj/redo', {}) },
  { name: 'proj_verlauf', description: 'History of the open project: rev, zeit (ms since 1970), quelle (andreas or cypher), label, art (aendern, undo, redo).',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/proj/verlauf') },
  // B10 project versions (plan browser-3): the same routes as the page's VERSIONS list
  { name: 'proj_versionen', description: 'List the saved versions of the open project, newest first: {versionen: [{id, zeit (ISO UTC), name (named ones only), auto}]}; automatic copies are made when a project opens and at most every five minutes while it changes (the last 20 are kept), named ones are never pruned; an empty list when no project is open.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => httpGrund('GET', '/proj/versionen') },
  { name: 'proj_version_sichern', description: 'Save a named version of the open project (a copy of its current state that is never pruned): answers {ok, id}; refused version_name_leer (no usable character in the name) and kein_projekt.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'the version name; / \\ : * ? " < > | and control characters are dropped, at most 60 characters' } } },
    lauf: (p) => httpGrund('POST', '/proj/version_sichern', { name: p.name }) },
  { name: 'proj_version_zurueck', description: 'Restore the open project to a saved version; it saves the current state first as the version "before restore", then closes and reopens the project (the core reloads it, one undo step brings the old state back): answers {ok, gesichert_als}; refused version_unbekannt, version_ungueltig (the stored file is invalid or from a newer format), kein_projekt, and like opening another project (beschaeftigt while a recording or freeze runs, transport_laeuft, live_laeuft, ki_gestoppt).',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'a version id from proj_versionen' } } },
    lauf: (p) => httpGrund('POST', '/proj/version_zurueck', { id: p.id }) },
  { name: 'proj_transport', description: 'Arrangement transport: start (from beat, default 0; the beat of a marker from proj_lage jumps there) or stopp. If the master tempo differs from the project tempo and no deck plays, the master ramps to it first (one bar) and the start waits. quant 2: the start always waits for the next master bar, also when nothing else plays. The transport plays the WHOLE open project: in the live container that is every SEQ deck and every loop deck at once; a module stays inaudible only while the strip of its place is closed, or while its group is muted (proj_aendern gruppenspur_aendern mute), there is no start per deck or per module. Stop Cypher stops no running transport, not even one I started: it keeps running and belongs to Andreas from then on (he takes over), so after Release start and stopp are refused with 409 transport_laeuft until he stops it. A start of mine that is still waiting for its downbeat, or for the tempo ramp before it, is dropped instead when Stop Cypher is pressed (ok false, quittung 7 ki_stopp, nothing is started); after Release I start again. I stop only a transport I started and he has not taken over, and I start only while no transport Andreas started is running: while one is running (from the page, the hardware key, after Stop Cypher, or unknown), start and stopp are refused with 409 transport_laeuft and nothing is sent, because the transport is his and a start would end his run; ask him.',
    inputSchema: { type: 'object', required: ['aktion'], properties: { aktion: { type: 'string', enum: ['start', 'stopp'] }, beat: zahl('project beat to start from', { minimum: 0 }) } },
    lauf: (p) => http('POST', '/proj/transport', p.beat === undefined ? { aktion: p.aktion } : { aktion: p.aktion, beat: p.beat }) },
  // Paket S3 (Spec D1 3.4, 3.5, 6.31): Freeze und Export des geöffneten Projekts, schmale Antworten; Stop Cypher sperrt beide (409 ki_gestoppt)
  { name: 'proj_freeze', description: 'Freeze a Surge (host) track of the open project: the core plays its notes once in real time (from the first to the last MIDI clip with sounding notes, plus 2 beats; at 124 BPM 8 bars take about 16 s, the call waits that long), and the track then plays as audio, live and in exports. an false discards the freeze (no run). Editing the notes, the instrument or the tempo discards it as well; undo brings it back. While it runs, note, clip, tempo and transport changes are refused (409 beschaeftigt), mixer changes go through. Answers rev, spur_id and freeze {datei, frames, kennung, sha256, von_beat} (null after discarding), not the project; one undo step ("Freeze <track>"). Refused: ki_gestoppt (Stop Cypher), transport_laeuft (stop it first), beschaeftigt (a freeze or export runs, a project is being opened, or the tempo is still ramping), keine_wirtspur, spur_leer (no sounding notes), zu_gross (over 256 beats), deck_laeuft, kein_kernstand, nicht_geladen, veraltet (the track changed meanwhile), wirt_fehlt (the Surge host for the slot of the track is not running: start djk-instrumente --arr1 or --arr2), wirt_fehler (that host is down and its status file holds a fatal entry, which the refusal quotes: fix it, then start the host again), freeze_fehler (the core aborted or restarted; nothing saved). ' + fristText('proj_freeze'),
    inputSchema: { type: 'object', required: ['spur_id', 'an'], properties: {
      spur_id: { type: 'string', description: 'track id from proj_lage, e.g. s3' },
      an: { type: 'boolean', description: 'true = freeze, false = discard the freeze' } } },
    lauf: (p) => httpLang('proj_freeze', '/proj/freeze?antwort=kurz', { spur_id: p.spur_id, an: p.an }) },
  { name: 'proj_export', description: 'Export the open project as WAV (48 kHz, 32 bit float) into its export folder (never overwrites): the loop range by default, or von_beat..bis_beat (1 to 1024 beats). Unfrozen Surge tracks with notes are frozen first in real time (see proj_freeze, one undo step each), then the core renders offline at low priority (a few seconds for 8 bars); the call waits for both. RB-338 and Baukasten (bk) tracks render offline directly, without a freeze. the export is taken at the production master (abgriff production, the default): after the master fader of the production (pm/fader) but before the DJ glue, the DJ master fader and the set limiter, so a mastering chain outside gets the unlimited signal; abgriff set is the signal as the room hears it (after the set limiter); loudness is measured on the written file. Answers {datei, frames, spitze_db, regler_quelle, abgriff, ueber_decke, limiter_db_max, lufs_i, lra, true_peak_dbtp, and dj_schluessel: true only when a compressor stage is keyed by a DJ input (deck or erz): no deck plays in a render, so that stage does not duck in the file}: regler_quelle kern = mixer as the running core has it, projekt = from the project file because no core ran since boot; ueber_decke true = the sample peak of the file is above the limiter ceiling (kern.toml limiter_dbtp): with abgriff production the set limiter would have reduced it, limiter_db_max is the largest reduction in dB it made while rendering (0 = never); the page shows SET LIMITER when it reduces while you listen; the loudness fields are null with loudness_fehler when ffmpeg failed (the WAV is still written). Optional abgabe (1 to 4 entries) also writes delivery files next to the master, derived from it with ffmpeg: format wav (bits 16, 24 or 32 float; default 24), flac (bits 16 or 24; default 24) or mp3 (kbps 192, 256 or 320; default 320); rate_hz 44100 (default), 48000, 88200 or 96000 (mp3: 44100 or 48000 only); dither tpdf (default) or aus at 16 bit only (24 bit has none); sample rate conversion is always high quality (soxr). A delivery file is named like its master with a tag before the extension, e.g. <master>.16bit-44k.wav, <master>.24bit-96k.flac, <master>.320kbps-44k.mp3 (32 bit float: 32float). The answer then carries abgaben: one entry per request entry in the same order, each with the request fields plus datei, lufs_i, lra and true_peak_dbtp measured on that delivery file (not copied from the master). The master is always written as before (it cannot be skipped) and the mix is never changed; a delivery that fails (ffmpeg missing, no mp3 or soxr support) does not fail the export: its entry has datei: null and fehler, the master and the other deliveries stay. Optional ziel {lufs_i (-40 to 0), true_peak_dbtp (-20 to 0), at least one} checks the master and every delivery against a loudness target and adds ziel, ziel_pruefung (lufs_abstand and tp_abstand: measured minus target in dB, rounded to 0.1, positive = louder than the target, null without that target or without a measurement; tp_ueber: true peak above the ceiling, false without a ceiling, null when the loudness could not be measured), the same ziel_pruefung in every abgaben entry, and ziel_ok over all written files (false when any true peak is above the ceiling, null when a file lacks the measurement its target needs: lufs_i for a lufs_i target, true_peak_dbtp for a true peak target, else true; the loudness distance alone never changes it). The mix is never normalised or limited to the target: the check only reports. Delivery files are tagged from the project (abgabe_meta_setzen in proj_aendern; the master carries no tags): title (the project name unless abgabe_meta has a titel), artist, album, genre, date (jahr) and the ISRC (wav and flac ISRC, mp3 TSRC; a wav also gets originator cypher-dj and originator_reference = the ISRC in its BWF chunk); flac also BPM (the project tempo, at most two decimals) and INITIALKEY, mp3 also TBPM (rounded) and TKEY, both only when the project key is a major or minor scale (A minor is Am); a wav carries neither tempo nor key. ohne_meta: true writes no release tags (ffmpeg still writes its own encoder tag) (any other value is argument_ungueltig). Invalid abgabe, ziel or ohne_meta is refused with argument_ungueltig before anything is frozen or rendered; for abgabe and ziel the text is fixed and the field detail names the entry and field at fault. The transport must be stopped. Refused: ki_gestoppt, transport_laeuft, beschaeftigt (a freeze or export runs), export_bereich, audio_fehlt (an audio clip is still being prepared), kein_kernstand (a track needs freezing but the core has not reported), veraltet, wirt_fehlt (a track needs freezing but the Surge host of its slot is not running: start djk-instrumente --arr1 or --arr2; checked for every slot before the first freeze), wirt_fehler (that host is down with a fatal entry in its status file, quoted), freeze_fehler, render_fehler. Foreign plugins: when a host stage (a foreign VST3/LV2 effect, an: true) is on, the export is captured in REAL TIME instead (the call takes as long as the range plays, a few minutes for a song; the answer adds echtzeit: true and dauer_s): the core plays the project once and writes the production master, host tracks are not frozen first, the transport must be stopped, and only abgriff production is possible. Before it plays, the master goes to the project tempo (an audition ends first): deck_laeuft (the master tempo differs while a deck plays: stop the deck), tempo_abgelehnt (the core refused the tempo), kein_kern (503, no core clock), rampe_haengt (the tempo ramp did not finish); nothing is loaded and no file is written then. Extra refusals: host_fehlt (a host is not ready; the text names the strip), export_host_ausfall (a host failed during the run), export_luecke (audio blocks were dropped); in both cases no file is left behind and the live playback is restored. Optional ordner: the absolute path of an existing folder below the home folder or a mount (no hidden path part), the master and every delivery file go there instead of the export folder of the project; absent = the export folder of the project. The tidy rule that keeps the last three exports applies to the project export folder only: nothing in a chosen folder is moved or counted. Same file system rules as everywhere: nothing is replaced, and a file system without hard links gets copies. Refused before anything is frozen or rendered: argument_ungueltig (not a string, empty, not absolute, or a file), pfad_fehlt, pfad_ausserhalb (outside the home folder and the mounts, or a hidden path part), pfad_nicht_lesbar, ordner_nicht_schreibbar. ' + fristText('proj_export'),
    inputSchema: { type: 'object', properties: {
      von_beat: zahl('first beat (default: loop start)', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (default: loop end)', { minimum: 1 }),
      abgriff: { type: 'string', enum: ['produktion', 'set'], description: 'tap of the export: production master (default) or the master after the set limiter' },
      ausklang_beats: zahl('optional tail: renders this many beats (0 to 64) beyond the end of the range so a reverb or delay tail is not cut; content after the range end plays in it too', { minimum: 0, maximum: 64 }),
      abgabe: { type: 'array', minItems: 1, maxItems: 4, description: 'optional delivery files next to the master (see the tool text): one entry per file',
        items: { type: 'object', additionalProperties: false, required: ['format'], properties: {
          format: { type: 'string', enum: ['wav', 'flac', 'mp3'] },
          bits: { type: 'number', enum: [16, 24, 32], description: 'wav: 16, 24 or 32 (float); flac: 16 or 24; not for mp3; default 24' },
          rate_hz: { type: 'number', enum: [44100, 48000, 88200, 96000], description: 'default 44100; mp3: 44100 or 48000 only' },
          dither: { type: 'string', enum: ['tpdf', 'aus'], description: '16 bit only; default tpdf' },
          kbps: { type: 'number', enum: [192, 256, 320], description: 'mp3 only; default 320' } } } },
      ohne_meta: { type: 'boolean', enum: [true], description: 'true: write no release tags into the delivery files (ffmpeg still writes its own encoder tag) (default: the release tags of the project, see the tool text)' },
      ordner: { type: 'string', description: 'absolute path of an existing folder below the home folder or a mount: the master and the delivery files are written there (default: the export folder of the project; the tidy rule does not apply there; not a folder inside the projects folder)' },
      ziel: { type: 'object', additionalProperties: false, description: 'optional loudness target to check the export against (see the tool text); nothing is normalised',
        properties: { lufs_i: zahl('integrated loudness target in LUFS (information only)', { minimum: -40, maximum: 0 }),
          true_peak_dbtp: zahl('true peak ceiling in dBTP (above it is a warning)', { minimum: -20, maximum: 0 }) } } } },
    lauf: (p) => httpLang('proj_export', '/proj/export', { ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}), ...(p.bis_beat !== undefined ? { bis_beat: p.bis_beat } : {}), ...(p.abgriff !== undefined ? { abgriff: p.abgriff } : {}), ...(p.ausklang_beats !== undefined ? { ausklang_beats: p.ausklang_beats } : {}), ...(p.abgabe !== undefined ? { abgabe: p.abgabe } : {}), ...(p.ziel !== undefined ? { ziel: p.ziel } : {}), ...(p.ohne_meta !== undefined ? { ohne_meta: p.ohne_meta } : {}), ...(p.ordner !== undefined ? { ordner: p.ordner } : {}) }) },
  // Per-track set: the mix, every track alone and every fed return wet only, as WAV or, with abgabe, as FLAC / WAV of a chosen depth and rate
  { name: 'proj_export_spuren', description: 'Export the open project as a set of files into a new folder of its export folder (never overwrites): the mix, every unmuted track alone (its own fader and pan, solo ignored, as proj_lautheit renders it) and every fed return wet only, as one file each: mix, 01-<track>, fx1-<return>. Default WAV, 48 kHz, 32 bit float. The loop range by default, or von_beat..bis_beat (1 to 1024 beats). Unfrozen Surge tracks with notes are frozen first in real time (see proj_freeze, one undo step each), then the core renders offline at low priority, one file after the other; the call waits for all of it. Offline only: with a plugin stage on (a foreign VST3/LV2 effect) it is refused with host_insert_echtzeit (use proj_export for the mix, it is captured in real time). Optional abgabe is ONE object (not an array) {format wav or flac, bits 16, 24 or 32 for wav and 16 or 24 for flac (default 24), rate_hz 44100 (default), 48000, 88200 or 96000, dither tpdf (default) or aus at 16 bit only}: every file of the set is then written in that format instead of the float WAV (converted with ffmpeg, high quality soxr resampling, no release tags; ffmpeg still writes its own encoder tag) and the folder holds that format only, with the extension of the format (mix.flac, 01-kick.flac); mp3 is not offered here. A conversion that fails (ffmpeg missing, no soxr support) fails the whole request with render_fehler and no folder stays. Answers {ordner, von_beat, bis_beat, dateien: [{art mix, spur or return, spur_id or return_id, nr, name, datei, spitze_db, stumm}], and abgabe: the format with its defaults filled, only when it was sent}: datei is the name inside ordner, null for a muted track or return (nothing is written or converted for it); stumm true = the file renders to silence (it is written anyway). Invalid abgabe is refused with argument_ungueltig before anything is frozen or rendered; the text is fixed and the field detail names the field at fault. The transport must be stopped. Refused: ki_gestoppt, transport_laeuft, beschaeftigt (a freeze or export runs), export_bereich, audio_fehlt (an audio clip is still being prepared), host_insert_echtzeit, kein_kernstand, veraltet, wirt_fehlt, wirt_fehler, freeze_fehler, render_fehler. Optional ordner: the absolute path of an existing folder below the home folder or a mount (no hidden path part), the set folder with all its files go there instead of the export folder of the project; absent = the export folder of the project. The tidy rule that keeps the last three exports applies to the project export folder only: nothing in a chosen folder is moved or counted. Same file system rules as everywhere: nothing is replaced, and a file system without hard links gets copies. Refused before anything is frozen or rendered: argument_ungueltig (not a string, empty, not absolute, or a file), pfad_fehlt, pfad_ausserhalb (outside the home folder and the mounts, or a hidden path part), pfad_nicht_lesbar, ordner_nicht_schreibbar. ' + fristText('proj_export_spuren'),
    inputSchema: { type: 'object', properties: {
      von_beat: zahl('first beat (default: loop start)', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (default: loop end)', { minimum: 1 }),
      abgabe: { type: 'object', additionalProperties: false, required: ['format'], description: 'optional: write every file of the set in this format instead of the float WAV (see the tool text)', properties: {
        format: { type: 'string', enum: ['wav', 'flac'] },
        bits: { type: 'number', enum: [16, 24, 32], description: 'wav: 16, 24 or 32 (float); flac: 16 or 24; default 24' },
        rate_hz: { type: 'number', enum: [44100, 48000, 88200, 96000], description: 'default 44100' },
        dither: { type: 'string', enum: ['tpdf', 'aus'], description: '16 bit only; default tpdf' } } },
      ordner: { type: 'string', description: 'absolute path of an existing folder below the home folder or a mount: the set folder is created there (default: the export folder of the project; the tidy rule does not apply there; not a folder inside the projects folder)' } } },
    lauf: (p) => httpLang('proj_export_spuren', '/proj/export_spuren', { ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}), ...(p.bis_beat !== undefined ? { bis_beat: p.bis_beat } : {}), ...(p.abgabe !== undefined ? { abgabe: p.abgabe } : {}), ...(p.ordner !== undefined ? { ordner: p.ordner } : {}) }) },
  // Paket 1.18, E-b: Lautheit je Spur und als Summe, offline und auf Anfrage (kein Dauerbetrieb im Kern); friert Wirt-Spuren vorher ein wie proj_export
  { name: 'proj_lautheit', description: 'Measure loudness per track of the open project, offline and on request: the server renders every sounding track alone (its own fader and pan from the project, then through its group and the production master, all other tracks silent, no deck or master state of the core; a compressor on that path that is keyed by another strip (a track, a group or a return, post or pre) still ducks: the key sources run without sounding, in their state from the project, so a key track that the project mutes gives no key; DJ keys (deck, erz) are live only and do not count) and once all together, then measures each WAV with ffmpeg. Range: the loop range by default, or von_beat..bis_beat (1 to 1024 beats). Unfrozen Surge tracks with notes are frozen first in real time (see proj_freeze; needs the Surge host for the slot of each track, arr1 or arr2, else wirt_fehlt or wirt_fehler). Answers {von_beat, bis_beat, spuren: [{spur_id, nr, name, lufs_i, lra, true_peak_dbtp, spitze_db, stumm, unter_messgrenze}], summe: {lufs_i, lra, true_peak_dbtp, spitze_db, unter_messgrenze, regler_quelle}, gruppen: [{gruppe_id, nr, name, lufs_i, lra, true_peak_dbtp, spitze_db, stumm, unter_messgrenze}], returns: [{return_id, nr, name, same fields}]}. lufs_i is integrated loudness in LUFS (use it to match the kick: the sample peak misleads for a 808 kick), lra loudness range in LU, true_peak_dbtp in dBTP, spitze_db the sample peak in dBFS at the production master (before the set limiter). A muted track (or one with the fader off, or silent in the range) answers stumm true and lufs_i null (not -70). If any track or group of the project is on solo, a track without solo that is not in a group on solo counts as muted, like in the mix (stumm true, not rendered). A track that is quiet but not silent, below the measuring floor of -70 LUFS (peak between -90 and about -68 dBFS), answers unter_messgrenze true, stumm false, lufs_i and lra null (not -70.0) and true_peak_dbtp as measured; the same holds for the sum. Tracks without content in the range are not listed. A group entry measures the group as the mix has it: its members, the group strip with fader and balance, the master and the returns they feed, all other tracks silent; a group without members is not listed, a muted group (or one silenced by a solo elsewhere) answers stumm true. A return entry measures the return as the mix feeds it, wet part only (the dry signal of the tracks and groups is left out, their sends stay in); a return that nothing feeds, or that the mix mutes, answers stumm true. Both are measured through the production master chain alone: with a non-linear master chain (compressor, limiter) an entry is not exactly what the group or return adds to the mix. A compressor keyed by another return still ducks in a return entry. Without groups and returns both lists are empty. The sum equals proj_export of the same range (default abgriff production) within 0.1 LU. Nothing is written into the project or the export folder. The transport must be stopped. Refused: ki_gestoppt, transport_laeuft, beschaeftigt (a freeze, export or measurement runs), export_bereich, host_insert_echtzeit (a plugin stage is active: it cannot be rendered offline, nothing is frozen), audio_fehlt, wirt_fehlt (a track needs freezing but the Surge host of its slot is not running: start djk-instrumente --arr1 or --arr2), wirt_fehler (that host is down with a fatal entry in its status file, quoted), render_fehler. ' + fristText('proj_lautheit'),
    inputSchema: { type: 'object', properties: {
      von_beat: zahl('first beat (default: loop start)', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (default: loop end)', { minimum: 1 }) } },
    lauf: (p) => httpLang('proj_lautheit', '/proj/lautheit', { ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}), ...(p.bis_beat !== undefined ? { bis_beat: p.bis_beat } : {}) }) },
  // ANALYZE window slice 1: the analysis of one strip (spectrum, stereo, loudness, masking against a second strip, hints), offline by a render of the range
  { name: 'proj_analyse', description: 'Analyse one strip of the open project (a track, a group, a return or the master), optionally against a second strip, so that you can judge a sound without hearing it. '
    + 'Offline and on request: the server renders the range exactly as proj_lautheit renders a strip (the strip alone with its own fader and pan from the project, then through its group and the production master; the other strips silent) and agrees with proj_lautheit on the loudness of the same strip and range. '
    + 'Range: the loop range by default, or von_beat..bis_beat (1 to 1024 beats). Nothing is written into the project or the export folder. '
    + 'It runs while the transport plays, unless an unfrozen Surge track with notes has to be frozen first (that freeze needs a stopped transport: 409 transport_laeuft). '
    + 'quelle (required) and vergleich (optional) are {art: spur | gruppe | return | master, id} (id is the spur_id, gruppe_id or return_id as proj_lage and proj_lautheit give it; master takes none). '
    + 'Answer: {rev, von_beat, bis_beat, dauer_s, tempo_bpm, quelle: M, vergleich?: M, ueberdeckung?, hinweise}. The time picture of the window is never part of the answer. '
    + 'M = {quelle, name, stumm, lautheit, stereo, spektrum}. '
    + 'lautheit: lufs_i integrated loudness in LUFS (null when silent or below -70 LUFS), lufs_s_max the highest short-term loudness (3 s) in LUFS, lufs_m_max the highest momentary loudness (400 ms) in LUFS, lra loudness range in LU, '
    + 'true_peak_dbtp true peak in dBTP, spitze_db sample peak in dBFS, rms_db RMS of both channels together in dBFS, crest_db = spitze_db - rms_db (small = dense or squashed, large = peaky, a kick on its own is high). '
    + 'stereo: korrelation over the whole range, 1 = mono, 0 = unrelated left and right, -1 = the channels cancel in mono; korrelation_min the lowest value over 400 ms windows (a short phase problem hides in the whole-range value); '
    + 'breite_db = 10 log10 of side over mid energy (side = (L-R)/2, mid = (L+R)/2; -200 = pure mono, about 0 = wide, positive = more side than mid); '
    + 'baender = the four bands below 120 Hz, 120-500 Hz, 500-4000 Hz and above 4000 Hz, each {hz_von, hz_bis, korrelation, breite_db} (the bass should stay near 1). '
    + 'spektrum: {hz, mittel_db, max_db}: band centres in Hz, the mean level over the range and the highest level of any frame, in dB where a full-scale sine reads 0 dB (a sine of amplitude 0.5 reads -6 dB), -200 = nothing. '
    + 'The bands are 1/3 octave (30 bands) unless fein is true, then 1/12 octave (120 semitone bands from 20.6 Hz to 19.9 kHz on the A440 grid, so a peak names a note); a 1/3 octave band is the power sum of four 1/12 bands, a sine keeps its level. '
    + 'The 1/12 bands are band integrals, not line levels. The mean and maximum spectrum below 400 Hz come from a long window (about 0.68 s) whenever the range is at least 0.68 s long, so a low note on the A440 grid reads close to its level in its own 1/12 band (55 Hz -0.2 dB, 41 Hz -1.1 dB, 27.5 Hz -2.3 dB); only a shorter range keeps the old short window, where a band is narrower than the window resolves and a full-scale sine reads lower (55 Hz -5.5 dB in its 1/12 band). '
    + 'A very long range (more than about 6 minutes) is sampled: the spectrum, the time picture and the band stereo values look at one window per column, not at every frame between the columns. '
    + 'ueberdeckung (only with vergleich and when both sound): masking between the two, baender [{hz, quelle_db, vergleich_db, anteil}] in 1/3 octave, anteil 0 to 1 = the share of the time in which both are above -60 dB and differ by at most 9 dB (they fight there; 0 = never, 1 = always); '
    + 'schwerpunkte [{hz_von, hz_bis, anteil}] = up to three runs of neighbouring bands with anteil of at least 0.5, the worst first. '
    + 'A strip that sounds but lies below the measuring floor (about -70 LUFS) answers stumm false with the lautheit values lufs_i and lra null (true_peak_dbtp and the peaks are still measured). '
    + 'vergleich equal to quelle is refused with argument_ungueltig. '
    + 'vergleich may also be a REFERENCE instead of a second strip: {art: datei, pfad | sha, von_s?, bis_s?} (an audio file: pfad is an absolute path, sha a catalogue sha256; von_s/bis_s in seconds fix the range of the file, else the whole file, at most its first 900 s) '
    + 'or {art: referenz, id} (a reference kept with analyse_referenz). Then the answer has vergleich = the measurement of the reference (the same fields as a strip, but no time picture, plus bereich {von_s, bis_s, datei_s, wahl: ganz | laut | fest} for a file and rolle for a kept reference), '
    + 'abgleich and NO ueberdeckung (there is no masking against a reference: it was not rendered with the strip), and hinweise of the source only. '
    + 'abgleich = {versatz_db, baender, abweichungen} compares the tonal balance, not the loudness: the reference curve is first shifted by versatz_db, the median band difference, so both curves have the same overall level; '
    + 'baender = 30 bands in 1/3 octave, each {hz, diff_db} with diff_db = source minus shifted reference in dB (diff_db > 0 = the source has more there than the reference, < 0 = less; null = one of the two carries no level in that band); '
    + 'abweichungen = the up to three strongest runs of neighbouring 1/3 octave bands that differ by 3 dB or more, each {hz_von, hz_bis, diff_db}, the strongest first (an empty list = the balance matches within 3 dB). To match loudness read lautheit of both. '
    + 'Extra refusals for a reference: referenz_unbekannt (no kept reference with that id), quelle_unbekannt (404: the file or sha is not found), format_falsch (422: the file is not audio the server can read). '
    + 'stumm true = the strip is silent in the mix (muted, fader off, silent in the range, or silenced by a solo elsewhere): every lautheit value null, korrelation 0, breite_db -200, spectrum at -200, no hints for it and no masking; the other strip is still measured. '
    + 'hinweise: objective hints, each {art, text, hz?}, in the order quelle, vergleich, masking; an empty list is a good result. The four kinds: '
    + 'bass_nicht_mono = the band below 120 Hz has a korrelation under 0.5 while it carries level above -60 dB (a bass that collapses in mono); '
    + 'true_peak = true_peak_dbtp above -1 dBTP; '
    + 'resonanz = a band that stands 9 dB or more over the median of the octave around it (the six bands on each side), above -60 dB and not lower than its neighbours, at most three per strip, hz names the centre; '
    + 'ueberdeckung_tief = a masking schwerpunkt that starts below 250 Hz (two strips fight in the bass). '
    + 'fein (boolean, default false) only chooses the resolution of the spectrum in the answer, also that of a reference; it is not sent to the server. '
    + 'alle_paare (boolean): masking over ALL strips instead of one analysis (quelle, vergleich and fein are ignored). The server renders every track that plays in the range once (at most the 24 with the highest peak are analysed, begrenzt true says more sounded), compares every pair and answers '
    + '{rev, von_beat, bis_beat, tempo_bpm, anzahl, begrenzt, maskierung: [{a, b, hz_von, hz_bis, anteil, breite_okt, score, leiser, vorschlag}]}: the five worst conflicts, worst first (score = share of the time x width in octaves), a = the louder strip, b = the quieter one, anteil as in ueberdeckung. '
    + 'vorschlag = {strang_id (the quieter strip), hz, q, gain_db, befehle} is a Bell cut of -3 dB at the geometric centre of the run, ready for proj_aendern (one insert_setzen of an EQ stage at position 0, one undo step); it is null when the chain of that strip is full. Nothing is changed by the analysis itself; apply the befehle to take the move. '
    + 'Resonances: when the strip sounds and has resonance hints, the answer also carries vorschlaege.resonanz {baender: [{hz, q, schwelle_db, bereich_db}], strang_id, befehle}: at most three dynamic EQ Pro bands (Bell, Q 8, dyn 1 above the threshold, range -6 dB, threshold = the mean level of the band minus 3 dB). '
    + 'befehle is ready for proj_aendern (one undo step): insert_param_setzen on the free bands of an EQ stage of the strip that is switched on, else one insert_setzen of a new EQ stage at position 0; null when the chain of five is full and no EQ has a free band. Nothing is changed by the analysis itself. '
    + 'Refusals as a tool error {fehler, text}: kein_projekt, ki_gestoppt, beschaeftigt (another render, freeze, export or loudness run is on; the same request twice waits for the one running and gets the same answer), export_bereich (range empty or over 1024 beats), audio_fehlt, '
    + 'wirt_fehlt, wirt_fehler, render_fehler, host_insert_echtzeit, transport_laeuft, spur_unbekannt, gruppe_unbekannt, return_unbekannt, argument_ungueltig. ' + fristText('proj_analyse'),
    inputSchema: { type: 'object', properties: {
      alle_paare: { type: 'boolean', description: 'true = masking over all strip pairs with a proposed EQ move (see above); then quelle is not needed' },
      quelle: { type: 'object', description: 'the strip to analyse: {art: spur | gruppe | return | master, id} (id = spur_id, gruppe_id or return_id; none for master)',
        properties: { art: { type: 'string', enum: ['spur', 'gruppe', 'return', 'master'] }, id: { type: 'string' } }, required: ['art'] },
      vergleich: { type: 'object', description: 'optional second strip, same form as quelle (adds the masking between the two), or a reference: {art: datei, pfad | sha, von_s?, bis_s?} or {art: referenz, id} (adds abgleich, no masking)',
        properties: { art: { type: 'string', enum: ['spur', 'gruppe', 'return', 'master', 'datei', 'referenz'] }, id: { type: 'string', description: 'spur_id, gruppe_id or return_id; with art referenz the id of the kept reference' },
          pfad: { type: 'string', description: 'art datei: absolute path of the audio file' }, sha: { type: 'string', description: 'art datei: catalogue sha256 of the file' },
          von_s: { type: 'number', minimum: 0, description: 'art datei: start of the range in the file, seconds' }, bis_s: { type: 'number', minimum: 0, description: 'art datei: end of the range in the file, seconds' } }, required: ['art'] },
      von_beat: zahl('first beat (default: loop start)', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (default: loop end)', { minimum: 1 }),
      fein: { type: 'boolean', description: 'true = the spectrum in 1/12 octave (120 bands) instead of 1/3 octave (30 bands); not sent to the server' } } },
    lauf: async (p) => {
      if (p.alle_paare === true) {   // strand 5 slice 6: the answer is the masking list as the server gives it (no strip measurement to reduce)
        return httpLang('proj_analyse', '/proj/analyse', { alle_paare: true, ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}),
          ...(p.bis_beat !== undefined ? { bis_beat: p.bis_beat } : {}) });
      }
      if (p.quelle === undefined) return { code: 400, j: { fehler: 'argument_ungueltig', text: 'quelle: a strip is required (or alle_paare: true)' } };
      const r = await httpLang('proj_analyse', '/proj/analyse', { quelle: p.quelle as Json, ...(p.vergleich !== undefined ? { vergleich: p.vergleich as Json } : {}),
        ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}), ...(p.bis_beat !== undefined ? { bis_beat: p.bis_beat } : {}) });
      return r.code >= 400 || (r.j as Json).fehler !== undefined ? r : { code: r.code, j: fuerHand(r.j as unknown as AnalyseAntwort, p.fein === true) as unknown as Json };
    } },
  // ANALYZE window slice 2: the live picture of the master output and the reference store
  { name: 'analyse_live', description: 'The live analysis of the master output as it goes out: the last 0.34 s of the master (the DJ master sum after its fader; in the live container this is the whole set including the Studio, because the production master of the Studio reaches it through erz/4). '
    + 'It is one moment: call it again for another moment. A strip that is soloed is seen alone, but soloing changes what the audience hears. '
    + 'Answer {leer: true, grund} when the engine is not running (nothing to measure). Otherwise {leer: false, w, steht, stumm, spektrum, stereo, spitze_db, rms_db, true_peak_dbtp, lufs_m}: '
    + 'w = the write counter of the audio ring, it grows while the engine writes; steht = true when the engine wrote nothing new since the previous call (stopped or hanging: the picture is old, do not read it as the current sound); '
    + 'stumm = true when the window is digital silence; '
    + 'spektrum {hz, db}: band centres in Hz and levels in dB where a full-scale sine reads 0 dB; 1/3 octave (30 bands, the power sum of four 1/12 bands) unless fein is true, then the 120 bands in 1/12 octave on the A440 grid; '
    + 'stereo {korrelation (1 = mono, 0 = unrelated, -1 = the channels cancel in mono), korrelation_min (lowest over 400 ms windows), breite_db (side over mid, -200 = mono), baender: four bands below 120 Hz, 120-500 Hz, 500-4000 Hz and above 4000 Hz, each {hz_von, hz_bis, korrelation, breite_db, pegel_db}}; '
    + 'spitze_db = sample peak in dBFS, rms_db = RMS of both channels in dBFS, true_peak_dbtp = true peak in dBTP (4x oversampling), lufs_m = momentary loudness in LUFS over 400 ms (null when silent or below the measuring floor). '
    + 'master {lufs_m, lufs_s (3 s), lufs_i (integrated since the last reset: RESET, PLAY in PRODUCTION or reset here), tp_max_dbtp (highest true peak since the reset), korrelation (400 ms), dauer_s (seconds measured since the reset), luecke_s (seconds not seen: the meter advances only while the page or this tool reads it; call again during playback for a complete integrated value), steht} is the master meter, null when it has nothing. '
    + 'It changes nothing except, with reset, the held values of the master meter. For a strip of the project use proj_analyse; for one deck or channel use pegel, spektrum or oszilloskop.',
    inputSchema: { type: 'object', properties: { fein: { type: 'boolean', default: false, description: 'true = the spectrum in 1/12 octave (120 bands) instead of 1/3 octave (30 bands)' }, reset: { type: 'boolean', default: false, description: 'true = clear the held true peak and the integrated loudness of the master meter first (the same as RESET in PRODUCTION), then read' } } },
    lauf: async (p) => {
      const m = p.reset === true ? await http('POST', '/analyse/pegel/reset', {}) : await http('GET', '/analyse/pegel');
      const mj = (m.code === 200 && m.j !== null && typeof m.j === 'object' ? m.j : null) as Record<string, Json> | null;
      const master: Json = mj === null || mj.leer === true ? null : {
        lufs_m: mj.lufs_m ?? null, lufs_s: mj.lufs_s ?? null, lufs_i: mj.lufs_i ?? null, tp_max_dbtp: mj.tp_max_dbtp ?? null,
        korrelation: mj.korrelation ?? null, dauer_s: mj.dauer_s ?? null, luecke_s: mj.luecke_s ?? null, steht: mj.steht ?? null,
      };
      const r = await http('GET', '/analyse/live');
      if (r.code !== 200) return r;
      const j = (r.j !== null && typeof r.j === 'object' ? r.j : {}) as { leer?: unknown; spektrum?: { hz?: unknown; db?: unknown } };
      if (typeof j.leer !== 'boolean') return { code: 502, j: { fehler: 'antwort_ungueltig', text: 'GET /analyse/live answered without a boolean leer', antwort: r.j } };
      const ohne = { ...(r.j as Record<string, Json>) }; delete ohne.vektor;   // the vector is a picture for the page
      if (j.leer) return { code: 200, j: ohne as unknown as Json };
      if (p.fein === true) return { code: 200, j: { ...ohne, master } as unknown as Json };
      const db = j.spektrum?.db;
      if (!Array.isArray(db) || db.length !== 120) return { code: 502, j: { fehler: 'antwort_ungueltig', text: 'GET /analyse/live: the spectrum is not 120 bands' } };
      return { code: 200, j: { ...ohne, spektrum: { hz: [...TERZ_HZ], db: terzVon(db as number[]) }, master } as unknown as Json };
    } },
  { name: 'analyse_referenz', description: 'Reference measurements: measure a finished track or a sample as a TARGET, keep it by role, and compare a strip of the open project against it with proj_analyse vergleich {art: referenz, id}. '
    + 'aktion: liste (GET: the kept references {referenzen: [{id, name, rolle, erstellt, herkunft, lufs_i}], rollen}), '
    + 'messen (measure without keeping: quelle {art: datei, pfad | sha, von_s?, bis_s?} (an absolute path or a catalogue sha256) or {art: referenz, id}, optional dauer_s 4..900; answers {messung} with loudness, stereo and spectrum like a strip of proj_analyse, no time picture, plus bereich {von_s, bis_s, datei_s, wahl}), '
    + 'merken (keep a measurement: name 1..60 characters, rolle, and either quelle (a file, with optional dauer_s) or projekt {quelle: a strip {art, id}, von_beat?, bis_beat?} to keep a strip of the open project as the reference; answers {referenz}), '
    + 'loeschen (id; answers {ok: true}; the file goes to a bin folder, nothing is destroyed). '
    + 'Range of a file: von_s/bis_s fix it (wahl fest); else with dauer_s and a file longer than twice that, the loudest window of dauer_s seconds (wahl laut); else the whole file, at most its first 900 s (wahl ganz). '
    + `Roles: ${ROLLEN.join(', ')}. `
    + 'The spectrum of messen is reduced to 1/3 octave (30 bands) unless fein is true (1/12 octave, 120 bands; only a choice of the answer, not sent). '
    + 'A reference carries tonal balance: proj_analyse compares it level-matched (abgleich), so the loudness of the reference does not matter, and there is no masking against a reference. '
    + 'Only merken and loeschen change the reference store; liste and messen read. Refusals as a tool error {fehler, text}, among them referenz_unbekannt, quelle_unbekannt (404), format_falsch (422), argument_ungueltig.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['liste', 'messen', 'merken', 'loeschen'] },
      quelle: { type: 'object', description: 'messen, merken: {art: datei, pfad | sha, von_s?, bis_s?} (merken: files only) or, for messen, {art: referenz, id}',
        properties: { art: { type: 'string', enum: ['datei', 'referenz'] }, pfad: { type: 'string' }, sha: { type: 'string' }, id: { type: 'string' },
          von_s: { type: 'number', minimum: 0 }, bis_s: { type: 'number', minimum: 0 } }, required: ['art'] },
      dauer_s: { type: 'number', minimum: 4, maximum: 900, description: 'messen, merken: length of the loudest window in seconds (4..900)' },
      name: { type: 'string', minLength: 1, maxLength: 60, description: 'merken: name of the reference' },
      rolle: { type: 'string', enum: [...ROLLEN], description: 'merken: role' },
      projekt: { type: 'object', description: 'merken: keep a strip of the open project: {quelle: {art: spur | gruppe | return | master, id}, von_beat?, bis_beat?}',
        properties: { quelle: { type: 'object', properties: { art: { type: 'string', enum: ['spur', 'gruppe', 'return', 'master'] }, id: { type: 'string' } }, required: ['art'] },
          von_beat: { type: 'number', minimum: 0 }, bis_beat: { type: 'number', minimum: 1 } }, required: ['quelle'] },
      id: { type: 'string', description: 'loeschen: id of the reference' },
      fein: { type: 'boolean', description: 'messen: the spectrum in 1/12 octave instead of 1/3 octave; not sent' } } },
    lauf: async (p) => {
      const fehlt = (f: string): { code: number; j: Json } => ({ code: 400, j: { fehler: 'argument_ungueltig', text: `${String(p.aktion)} needs ${f}` } });
      const nur = (...k: string[]): Json => Object.fromEntries(k.filter((x) => p[x] !== undefined).map((x) => [x, p[x] as Json]));
      switch (p.aktion) {
        case 'liste': return http('GET', '/analyse/referenzen');
        case 'messen': {
          if (p.quelle === undefined) return fehlt('quelle');
          const r = await http('POST', '/analyse/referenz/messen', nur('quelle', 'dauer_s'));
          const m = (r.j as { messung?: { spektrum?: { hz?: unknown; mittel_db?: unknown; max_db?: unknown } } }).messung;
          if (r.code !== 200 || p.fein === true || !m?.spektrum) return r;
          const sp = m.spektrum;
          if (!Array.isArray(sp.mittel_db) || sp.mittel_db.length !== 120 || !Array.isArray(sp.max_db) || sp.max_db.length !== 120) return r;
          return { code: 200, j: { ...(r.j as Record<string, Json>), messung: { ...m, spektrum: { hz: [...TERZ_HZ], mittel_db: terzVon(sp.mittel_db as number[]), max_db: terzVon(sp.max_db as number[]) } } } as unknown as Json };
        }
        case 'merken': {
          if (p.name === undefined) return fehlt('name');
          if (p.rolle === undefined) return fehlt('rolle');
          if ((p.quelle === undefined) === (p.projekt === undefined)) return fehlt('either quelle (a file) or projekt, not both');
          return http('POST', '/analyse/referenz/merken', nur('name', 'rolle', 'quelle', 'dauer_s', 'projekt'));
        }
        case 'loeschen': return p.id === undefined ? fehlt('id') : http('POST', '/analyse/referenz/loeschen', nur('id'));
        default: return { code: 400, j: { fehler: 'argument_ungueltig', text: 'aktion must be liste, messen, merken or loeschen' } };
      }
    } },
  // FIND SOUND part 1: a round of three measured one-knob neighbours of a Baukasten track's sound (routes /proj/klang/*)
  { name: 'klang_runde', description: 'Find a better sound for a Baukasten track by a variant round: the server renders the track with a few one-knob changes of its sound, '
    + 'measures every variant and offers the three clearest as places B, C and D next to A, the sound the track has now. Use it when a sound should become brighter, deeper, wider or '
    + 'otherwise different and you do not know which knob does that. '
    + 'Order: start (spur_id of a Baukasten track, optional schritt fein | normal | grob = how clearly audible the neighbours must differ from A: fein = subtle, normal = clear, grob = strong) renders and measures in the background over the loop range '
    + '(at most 16 beats) and waits until the measuring is done (up to 60 s; the answer then still says misst, call lage to wait further). '
    + 'The answer is the state {runde, spur_id, spur_name, graph, rev, zustand: misst | fertig | veraltet | fehler, fortschritt {gemessen, hoechstens}, aktiv, plaetze, stammbaum, weg, zurueck_moeglich}. '
    + 'plaetze lists A first, then up to three variants, each with its knob (param, label), the display values before and after (von_text, nach_text), a word for the clearest change '
    + '(wort, e.g. brighter, more sub, wider, punchier), its strength (staerke), the level difference to A (pegel_db), the measured features (merkmale: hell, sub, hoehen, bewegung, fuelle, breite, punch, pegel) '
    + 'and the whole line to show (text). A place with anschlag true sits at the range end of its knob and stays under the clearness you asked for (the line ends with " · max"): it is the strongest this knob can do, still audible at the subtle level. A finished round with only A and a hinweis says that no knob of the sound makes an audible difference on this pattern. Read these words and features to judge the places; a knob with an automation lane or an envelope is never a place. '
    + 'hoeren, waehlen and zurueck take the number runde of the state you read, so they never act on a round the owner started meanwhile. '
    + 'hoeren {platz: A | B | C | D, runde} lets the instrument play that place now (a transient change of one knob in the running core): listening does not write the project, no undo step, no new revision; '
    + 'A or ende puts the knob back to the value the project has. Listen, then decide. '
    + 'hoeren {platz: B | C | D, runde, vergleich: true} switches COMPARE on: the server then alternates the instrument between A and that place, one bar each, switching on the bar line of the open module '
    + '(the transport must run, else refused with vergleich_steht, 409); state.vergleich {an, platz, klingt, ab_beat} says which of the two sounds. Calling hoeren with another place (or vergleich false) '
    + 'ends COMPARE, as do waehlen, zurueck, ende, a new start, the transport stopping, the idle end of the round and 30 s without a lage or hoeren call of yours (call lage now and then while you listen). '
    + 'Places are played at the level of A (state plaetze[].ausgleich_db is the gain the listening adds to the track fader, pegel_db stays the true difference; a pick writes no gain). '
    + 'waehlen {platz: B | C | D} writes the pick into the project as one undo step (the knob value and a node in the family tree of the track, label "Find sound: <line>"); '
    + 'proj_undo takes it back. The answer is {label, rev}. After a pick call start again for new neighbours (the reverse of the pick is not offered again). '
    + 'zurueck {knoten?} goes back in the family tree of the track (the parent of the active node, or the node knoten; knobs turned by hand since the active node are undone first) and writes the knob values as one undo step; '
    + 'refused with kein_stammbaum when the track has no tree. weg and stammbaum show the path of picks. lage reads the state of the round (also one the owner started in the window FIND SOUND); '
    + 'ende drops the round and puts the knob back. '
    + 'The plan of waehlen and zurueck is computed on a revision of the project and sent with exactly that rev: a project that moved on since answers rev_veraltet, a stale round runde_veraltet, a changed track or graph '
    + 'makes the state veraltet; then start again. Refusals as a tool error {fehler, text}, among them keine_runde (404), platz_leer, runde_veraltet, kein_stammbaum, spur_still (the track is silent), '
    + 'spur_unbekannt, geraet_falsch (not a Baukasten track), argument_ungueltig, beschaeftigt, rev_veraltet.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['start', 'lage', 'hoeren', 'waehlen', 'zurueck', 'ende'] },
      spur_id: { type: 'string', description: 'start: the Baukasten track' },
      schritt: { type: 'string', enum: ['fein', 'normal', 'grob'], description: 'start: how clearly audible the neighbours must differ from A: fein = subtle, normal = clear (default), grob = strong' },
      platz: { type: 'string', enum: ['A', 'B', 'C', 'D'], description: 'hoeren: any place; waehlen: B, C or D' },
      vergleich: { type: 'boolean', description: 'hoeren: true = COMPARE, alternate A and this place (B, C or D) every bar; omitted or false = play the place steadily' },
      knoten: { type: 'string', description: 'zurueck: a node of the family tree (n1, n2, ...); without it the parent of the active node' },
      runde: { type: 'integer', description: 'hoeren, waehlen, zurueck: the number `runde` of the state you read (start or lage). Required: when the owner started another round meanwhile, the call is refused with runde_veraltet instead of acting on his round' } } },
    lauf: async (p) => {
      const fehlt = (text: string): { code: number; j: Json } => ({ code: 400, j: { fehler: 'argument_ungueltig', text: `${String(p.aktion)}: ${text}` } });
      const nur = (...k: string[]): Json => Object.fromEntries(k.filter((x) => p[x] !== undefined).map((x) => [x, p[x] as Json]));
      const ohneRunde = ['hoeren', 'waehlen', 'zurueck'].includes(String(p.aktion)) && !Number.isInteger(p.runde);
      if (ohneRunde) return fehlt('runde is required (the number of the round from start or lage)');
      if (p.schritt !== undefined && !['fein', 'normal', 'grob'].includes(String(p.schritt))) return fehlt('schritt must be fein, normal or grob');
      if (p.platz !== undefined && !['A', 'B', 'C', 'D'].includes(String(p.platz))) return fehlt('platz must be A, B, C or D');
      if (p.vergleich !== undefined && typeof p.vergleich !== 'boolean') return fehlt('vergleich must be true or false');
      const plan = async (pfad: string, koerper: Json): Promise<{ code: number; j: Json }> => {
        const r = await http('POST', pfad, koerper);
        if (r.code !== 200) return r;
        const pl = r.j as { rev?: unknown; label?: unknown; befehle?: unknown };
        const w = await mitRev({ rev: pl.rev }, '/proj/aendern', { label: pl.label, befehle: pl.befehle });
        return w.code === 200 ? { code: 200, j: { label: pl.label, rev: (w.j as { rev?: unknown }).rev } as Json } : w;
      };
      switch (p.aktion) {
        case 'start': {
          if (typeof p.spur_id !== 'string' || !p.spur_id) return fehlt('spur_id is required');
          let r = await http('POST', '/proj/klang/runde', nur('spur_id', 'schritt'));
          const frist = Date.now() + 60_000;
          while (r.code === 200 && r.j.zustand === 'misst' && Date.now() < frist) {
            await new Promise((ok) => setTimeout(ok, 500));
            r = await http('GET', '/proj/klang/runde');
          }
          return r;
        }
        case 'lage': return http('GET', '/proj/klang/runde');
        case 'hoeren': return typeof p.platz === 'string' ? http('POST', '/proj/klang/hoeren', nur('platz', 'runde', 'vergleich')) : fehlt('platz is required');
        case 'waehlen': return typeof p.platz === 'string' ? plan('/proj/klang/waehlen', nur('platz', 'runde')) : fehlt('platz is required');
        case 'zurueck': return plan('/proj/klang/zurueck', nur('knoten', 'runde'));
        case 'ende': return http('POST', '/proj/klang/ende', {});
        default: return fehlt('aktion must be start, lage, hoeren, waehlen, zurueck or ende');
      }
    } },
  // Paket 1.13 Slice 7: merge selected tracks into one new audio track by an isolated render (one undo step)
  { name: 'proj_zusammenfuehren', description: 'Merge selected tracks of the open project into ONE new audio track (merge, AK27): the server renders exactly '
    + 'these tracks '
    + 'over von_beat..bis_beat with their own faders and pans, their group and the production master neutral (a null '
    + 'test against the solo export of the sources '
    + 'is below -90 dBFS), writes the WAV into the project folder (merge/merge-<id>.wav, never replaced) and in ONE '
    + 'project change adds the new track with one clip '
    + 'and mutes the sources. 2 to 128 distinct spur_ids; a Stems group is chosen by its four tracks. The new track is '
    + 'gained by +3.01 dB to compensate the pan law. '
    + 'Answers {rev, spur_id, datei, frames, hinweis, quellen, lanes_verworfen} with the short answer (lanes_verworfen = number of mute and solo lanes of the muted source tracks that were dropped, locked ones included; fader, pan and geraet.* lanes stay). One undo restores the sources and their lanes; the WAV stays on disk. '
    + `The call waits for the render (up to ${FRIST_VORGABE_MS.proj_zusammenfuehren / 60_000} min, `
    + `DJK_HAND_FRIST_PROJ_ZUSAMMENFUEHREN_MS), then answers hand_frist and the run may still finish. `
    + 'Refused (409 unless noted): merge_leer (nothing sounds in the range), merge_gruppen (the tracks feed different '
    + 'groups or targets), merge_teil_solo (only some '
    + 'of the chosen tracks are on solo), merge_freeze_noetig (a Surge track has unfrozen notes: proj_freeze first), '
    + 'merge_andreas_spur (a track of Andreas; Cypher may not merge it), '
    + 'merge_keine_spur_frei (no free track slot), spur_unbekannt (404), ki_gestoppt (Stop Cypher), the transport '
    + 'must stand, and the export errors of proj_export (export_bereich, audio_fehlt, render_fehler).',
    inputSchema: { type: 'object', required: ['spur_ids', 'von_beat', 'bis_beat'], properties: {
      spur_ids: { type: 'array', minItems: 2, maxItems: 128, items: { type: 'string' }, description: 'ids of the tracks to merge (2 to 128, distinct)' },
      von_beat: zahl('first beat of the range', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (1 to 1024 beats)', { minimum: 1 }) } },
    lauf: (p) => httpLang('proj_zusammenfuehren', '/proj/zusammenfuehren?antwort=kurz', { spur_ids: p.spur_ids, von_beat: p.von_beat, bis_beat: p.bis_beat }) },
  // 1.14 slice 4 (bounce, N08, spec R13): bounce in place, to new track (also a group) and paste bounced audio; one undo step each
  { name: 'proj_bounce', description: 'Bounce audio in the open project (one render, ONE project change, One undo). art an_ort {spur_id}: Bounce Track in '
    + 'Place for an audio track. The server renders the whole track pre-mixer (fader 0 dB, pan 0, mute off, without its lanes, dry, group and master '
    + 'neutral) over the hull of its clips, moves the clips into a new take lane "Before bounce" (same ids) and puts one audio clip (+3.01 dB clip '
    + 'gain for the pan law) on the main lane; fader, pan, sends and lanes stay live, so the mix sounds the same. Restore: proj_aendern comp_waehlen of '
    + 'that lane over its clip hull (or take_vorhoeren to audition it). art neue_spur {spur_ids | gruppe_id, von_beat?, bis_beat?}: Bounce to New '
    + 'Track, the merge of proj_zusammenfuehren with ONE source allowed, or all tracks of a group (gruppe_id); the range defaults to the hull of the '
    + 'sources, the new track sits below them, the sources are muted. art einfuegen {spur_ids, von_beat, bis_beat, ziel_spur_id, ziel_beat}: Paste '
    + 'Bounced Audio, the sources rendered post-fader over von_beat..bis_beat (they stay unchanged) onto the audio track ziel_spur_id at ziel_beat, '
    + 'overwriting its main lane there (clips crossing an edge are split). The WAV goes to bounce/bounce-<id>.wav in the project folder (stays after '
    + 'undo) and is fixed in seconds (a later tempo change does not stretch it). Answers {art, rev, spur_id, clip_id, datei, frames, quellen, take_id?, '
    + 'lanes_verworfen?, hinweis?} (short answer). '
    + `The call waits for the render (up to ${FRIST_VORGABE_MS.proj_bounce / 60_000} min, DJK_HAND_FRIST_PROJ_BOUNCE_MS), then answers hand_frist `
    + 'and the run may still finish. Refused (409 unless noted): bounce_nur_audio (an_ort on an instrument track: use neue_spur, or proj_freeze for '
    + 'Surge), bounce_ziel_art (paste target is not an audio track), takes_voll (32 take lanes), ersetzen_loop (a looped clip of the target crosses '
    + 'a paste edge), gruppe_unbekannt (400), spur_unbekannt (400), merge_andreas_spur (Cypher may not bounce, use as a to-new-track source, or '
    + 'paste onto a track of Andreas; reading one as a paste source is fine), merge_leer (nothing sounds), merge_freeze_noetig, merge_gruppen, '
    + 'merge_teil_solo, merge_sends, merge_inserts (a source, the in-place track or the paste target has an insert chain: the bounce is dry and does not bake it), '
    + 'merge_keine_spur_frei, veraltet (the tracks changed during the render, nothing saved), ki_gestoppt, '
    + 'transport_laeuft, beschaeftigt, and export_bereich (1 to 1024 beats), audio_fehlt, render_fehler (502), and host_insert_echtzeit (a source track has an active foreign-plugin stage: it cannot be rendered offline, use proj_resample). ' + fristText('proj_bounce'),
    inputSchema: { type: 'object', required: ['art'], properties: {
      art: { type: 'string', enum: ['an_ort', 'neue_spur', 'einfuegen'], description: 'an_ort: in place; neue_spur: to new track; einfuegen: paste' },
      spur_id: { type: 'string', description: 'an_ort: the audio track to bounce in place' },
      spur_ids: { type: 'array', minItems: 1, maxItems: 128, items: { type: 'string' }, description: 'neue_spur or einfuegen: the source tracks (1 to 128)' },
      gruppe_id: { type: 'string', description: 'neue_spur instead of spur_ids: all tracks whose target is this group' },
      von_beat: zahl('neue_spur (optional) or einfuegen: first beat of the range', { minimum: 0 }),
      bis_beat: zahl('neue_spur (optional) or einfuegen: end beat, exclusive (1 to 1024 beats)', { minimum: 1 }),
      ziel_spur_id: { type: 'string', description: 'einfuegen: the audio track that receives the clip' },
      ziel_beat: zahl('einfuegen: the beat where the clip starts', { minimum: 0 }) } },
    lauf: (p) => httpLang('proj_bounce', '/proj/bounce?antwort=kurz', Object.fromEntries(
      ['art', 'spur_id', 'spur_ids', 'gruppe_id', 'von_beat', 'bis_beat', 'ziel_spur_id', 'ziel_beat'].filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))) },
  // 1.10 slice 7 (T6, spec 5.7): resample a strip through the core tap /k/arr/abgriff into a new audio track; one undo step
  { name: 'proj_resample', description: 'Resample a strip of the open project to a new audio track: the core plays the strip once in real time and the server '
    + 'records what it sends on, as a WAV, in one call (a 16-beat range at 124 BPM takes about 8 s, plus a tempo ramp if needed). strang_id is the strip: a '
    + 'track (s1), a group (g1), a return (r1) or master (the production master). punkt post (default) is what the strip sends to its target, after its '
    + 'insert chain, fader and pan, with its sends and its own pan law; pre is its input before the chain and fader. The monitor of an armed track is part of '
    + 'a `post` resample and not of a `pre` one. Range: von_beat..bis_beat (1 to 256 beats), by default the loop range if it is on, otherwise the whole song. '
    + 'The new track "<source> (resampled)" (name cut to 80 characters) has one audio clip of the range at von_beat, outputs to the master, and sits right '
    + 'below a source track, at the end for a group, a return and master. The source is unchanged, nothing is muted. ONE undo step ("Resample <name>"); the '
    + 'WAV stays in resample/resample-<id>.wav of the project folder after undo and is fixed in seconds (a later tempo change does not stretch it). A Surge '
    + 'track that sounds in the range is not frozen first: it plays along in real time through its host. The transport must be stopped. Answers {rev, spur_id, '
    + 'clip_id, datei, frames, quelle, punkt, von_beat, bis_beat}, not the project. Refused: resample_leer (409: the strip is silent in the range, muted or empty '
    + 'or a Surge host not playing; no track, no file), resample_fehler (502: the core aborted, restarted or wrote no file; nothing saved), ki_gestoppt (Stop '
    + 'Cypher, also when set during the run: the result is discarded), transport_laeuft (stop it first), beschaeftigt (a freeze, export, merge, bounce, '
    + 'recording or another resample runs, a project is being opened, or the tempo is still ramping), nicht_geladen, kein_kernstand, zu_gross (over 256 beats), '
    + 'export_bereich (range shorter than 1 beat or before beat 0), veraltet (the tempo or the strip changed during the run), spur_unbekannt (400), '
    + 'merge_keine_spur_frei (all 128 tracks used), wirt_fehlt (a Surge track that sounds needs its host: start djk-instrumente --arr1 or --arr2), wirt_fehler '
    + '(that host is down with a fatal entry, quoted). ' + fristText('proj_resample'),
    inputSchema: { type: 'object', required: ['strang_id'], properties: {
      strang_id: { type: 'string', description: 'the strip: a track id (s1), a group id (g1), a return id (r1) or master' },
      punkt: { type: 'string', enum: ['pre', 'post'], description: 'post (default): what the strip sends to its target; pre: its input before the chain' },
      von_beat: zahl('first beat of the range (default: the loop range if on, else beat 0)', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (1 to 256 beats after von_beat; default: the loop end, else the end of the last clip)', { minimum: 1 }) } },
    lauf: (p) => httpLang('proj_resample', '/proj/resample', Object.fromEntries(
      ['strang_id', 'punkt', 'von_beat', 'bis_beat'].filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))) },
  // 1.8 Task 28: Aufnahme auf armierte Audio-Spuren (interner Strom erz/1..3); Server: POST /proj/aufnahme, Quelle cypher
  { name: 'proj_aufnahme', description: 'Record onto the armed tracks of the open project (audio tracks and instrument tracks). aktion start {von_beat? default 0}: arms the core for each track set with proj_aendern spur_aendern {arm: true, eingang: {art: intern, name: erz/1|erz/2|erz/3|erz/5|erz/6|erz/7|pad/1|pad/2|deck/1|deck/2}}, starts the transport and records from its start; the take is the internal stream of that input, taken before the mixer fader (erz/1 is the Strudel channel; erz/5..7 are Baukasten instruments, pad/1, pad/2, deck/1 and deck/2 the container inputs C, D, A and B). aktion stopp: stops the transport, saves the takes as files in the project folder (aufnahmen/take-<kennung>-<spur>.wav), places one clip per track (replacing what was there) as ONE undo step, and answers takes [{spur_id, frames, luecken, datei} or fehler]. If the transport was stopped some other way (proj_transport, the hand key, the end of the arrangement) the take is saved by itself; aktion stopp then returns that result once, and proj_aufnahme without a running recording shows it under letzte. Refused: nichts_scharf (no armed track), ueberlappung (a transport is running), transport_laeuft (Andreas\' transport is running: wait), ki_gestoppt, aufnahme_laeuft, keine_aufnahme (stopp without a running recording and nothing to hand over), aufnahme_abgebrochen (the core dropped the start, nothing was recorded; grund says why: zu_spaet, abbruch, ki_stopp), transport_laeuft (stopp by Cypher while Andreas started the recording: it keeps running), beschaeftigt (a freeze, an export or a project change is running). External inputs (the PC input, the XDJ-XZ) record too: a track armed on {art: extern, paar, modus} takes that pair in its recording mode. Cypher needs Andreas\' release per input (frei_fuer_cypher in geraete_lage); without it start is refused with eingang_nicht_frei, an input without a device with kein_eingang, an implausible latency profile with latenz_ungueltig, no report of the core yet with kein_kern. The server places each take late-compensated: versatz_samples = the measured latency of the input (Andreas measures it, I never create a profile) + what the core delays its master; the clip gets that as offset_s and every clip of the run covers exactly the pass (the run takes a tail of nachlauf_samples = the largest versatz past the end, which stays in the raw file only). The start answer carries spuren [{id, nr, name, versatz_samples}], nachlauf_samples and hinweise: latenz_fehlt (no measured profile: only the core delay is compensated) or latenz_veraltet (the profile was measured at another quantum than the core runs now: measure again); each take in the stop result carries versatz_samples and nachlauf_samples. Count-in, punch, running start: the count-in is the project setting vorzaehler_takte (0, 1, 2 or 4 bars; set it with proj_aendern aufnahme_setzen): with a count-in the start answers only once the take has begun, after the count-in. A start into a transport that is already running is not allowed for me: it is refused with transport_laeuft (only Andreas may record into his running transport; his answer carries laufend: true, the take begins at the next bar and the count-in is ignored); stopping such a recording ends only the recording, never his transport. einsatz_ausgeblieben: the take did not begin within the expected time (count-in or next bar), nothing was recorded. With the project setting punch.ein and/or punch.aus on (aufnahme_setzen punch {ein, aus, von_beat, bis_beat}), the stop result carries punch {von_beat, bis_beat} per take, the range that was kept (punch.ein cuts the front, punch.aus the end; the raw file stays whole); punch_leer: the punch range does not touch the take, nothing was placed, the raw file is kept. MIDI: an instrument track set with proj_aendern spur_aendern {arm: true, eingang: {art: midi}} records the notes played on midi_ein_1 (the keys or pads Andreas connected); a run with only such tracks is a run (no audio track needed). Cypher may record MIDI only when Andreas released the MIDI input (frei_fuer_cypher of midi in geraete_lage), else eingang_nicht_frei. The take file is midi-<kennung>.bin in the work folder; the stop result has one entry per instrument track {spur_id, art: midi, ereignisse, noten, versatz_samples, overdub, datei} or fehler. The notes are placed late-compensated (versatz_samples = ausgang_vorhalt + the MIDI offset midi.versatz_samples of the device, which only Andreas sets; I never write it). Replace is the default: the range of the take on the track is replaced and clips outside stay; with the project setting overdub on (aufnahme_setzen overdub: true) the notes are added to the clips of the range (one new clip for every stretch no clip covers) and the old notes stay. With the loop on, the run starting inside it and replace mode, every loop pass that holds notes becomes its own take lane "Take <n>" (newest last) with one MIDI clip over the pass range, so you can comp bars from different passes with proj_aendern comp_waehlen and listen with take_vorhoeren; a note held across the loop end is cut at the end. The track itself gets the last complete pass (else the last pass with notes); what that pass overwrote goes into the lane "Original". Overdub, a punch range, or no loop keeps one pass and no take lanes. At most 32 lanes per track: the oldest passes are not kept as takes, and the entry says how many in takes_verworfen. The entry of an instrument track carries takes (the number of take lanes this run added). All of it, audio and MIDI, is ONE undo step. ersetzen_loop: a looped clip is in the way (or the overdub would go into one); keine_noten: the take holds no complete note, nothing was placed. aktion gerettet_platzieren {datei}: places a take that was rescued after a crash (file take-<id>-<nr>-gerettet.wav) on its track at its recorded start as ONE undo step and answers {ok, clip_id}; refused with gerettet_unbekannt (unknown file), aufnahme_laeuft or kein_projekt.',
    inputSchema: { type: 'object', required: ['aktion'], properties: { aktion: { type: 'string', enum: ['start', 'stopp', 'gerettet_platzieren'] }, von_beat: { type: 'number', minimum: 0 }, datei: { type: 'string', minLength: 1, description: 'gerettet_platzieren only: the WAV file name of a recovered take (take-<id>-<nr>-gerettet.wav in the aufnahmen folder of the open project)' } } },
    // der Low-Level-Server prüft das Schema nicht (Handler oben): eine unbekannte Aktion wird hier mit 400 abgewiesen, ohne etwas an den Server zu schicken
    lauf: async (p) => (p.aktion === 'gerettet_platzieren'
      ? (typeof p.datei !== 'string' || p.datei === '' ? { code: 400, j: { fehler: 'datei_fehlt', text: 'gerettet_platzieren needs datei, the WAV file name of a recovered take' } } : http('POST', '/proj/gerettet_platzieren', { datei: p.datei }))
      : p.aktion !== 'start' && p.aktion !== 'stopp' ? { code: 400, j: { fehler: 'aktion_unbekannt', text: 'aktion must be start, stopp or gerettet_platzieren' } } : http('POST', '/proj/aufnahme', p.aktion === 'start' ? { aktion: 'start', ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}) } : { aktion: 'stopp' })) },
  // Baukasten S15: bounce of a bk instrument stream into an audio track of the open project, composed of existing page routes only
  { name: 'proj_strom_aufnehmen', description: 'Record a Baukasten instrument into the open project in one call (a stream bounce). Puts the instrument graph on stream 2 (erz/2) or 3 (erz/3), plays the Strudel pattern on that stream, records the stream after the graph into an audio track for the given number of bars (real time) and stores where the take came from on its clip (entstehung: graph, the graph knob values (up to 64), the Strudel code, the project tempo). All checks are reads and come first, so a refusal changes nothing: ki_gestoppt (Stop Cypher), auto_aus (AUTO of that stream is off), kein_projekt, unbekannt (no such graph), falsche_art (the graph is an effect, or the track is an instrument track), aufnahme_laeuft (a recording is running), andere_scharf (other tracks are armed: they would be recorded too and get their clips replaced; disarm them with proj_aendern spur_aendern arm false), spur_belegt (the track already has clips in the recorded range: the recording would replace them; use a free range via von_beat or another track), plus argument errors strom, takte, graph, code, code_zu_lang (above 20000 characters), spur, von_beat. Then it loads the graph (a stream whose erzeuger runs in kit mode refuses with kein_midi_strom: run instrumente first), sends the pattern, finds the track by id or exact name (spur, created as an audio track when missing), arms it on erz/<strom>, waits for the next bar so the pattern is playing, reads the knob values, records takte bars from von_beat (default 0), stops and disarms the track again (also on every failure path after the arm; a disarm that fails is answered as warnung, or detail.disarm_fehler in a tool error). The wait for the next bar keeps a margin of half a beat (a new pattern starts at the first bar line after about 0.5 beat), so the take opens on the new pattern. The stop is sent even when the wait fails. Knob values are what the page server knows (lage regler erz/<strom>/bk/<k>; a knob never moved reads 0.5); the kern is not asked. The graph and the pattern STAY on the stream afterwards (remove them with graph and strudel if they should not keep playing). Notes of MIDI clips on instrument tracks do NOT sound through a Baukasten graph in this version: this bounce is the production path for bk instruments today. Effect graphs (fx-*) are for the DJ side and are refused. Answers {spur_id, clip_id, take {frames, luecken, status, datei}, entstehung, spur_neu, graph_quittung}. A tool error after the first write carries detail.getan (what was already done: graph, strudel, spur_neu, arm, aufnahme).',
    inputSchema: { type: 'object', required: ['spur', 'strom', 'graph', 'code', 'takte'], properties: {
      spur: { type: 'string', minLength: 1, maxLength: 80, description: 'audio track id (e.g. s3) or its exact name; a name that does not exist is created as an audio track' },
      strom: { type: 'integer', enum: [2, 3], description: '2 = bass stream (erz/2), 3 = melody stream (erz/3)' },
      graph: { type: 'string', description: 'instrument graph name from graphen' },
      code: { type: 'string', minLength: 1, maxLength: 20000, description: 'Strudel pattern for that stream (note(...) values; kit sounds are not used with a graph)' },
      takte: { type: 'integer', minimum: 1, maximum: 64, description: 'bars to record (real time)' },
      von_beat: zahl('project beat where the take starts (default 0)', { minimum: 0 }) } },
    lauf: (p) => stromAufnehmen(p) },
  { name: 'geraete_lage', description: 'Audio and MIDI inputs of the core and their devices: per input (1 to 4, plus the MIDI input) the assigned device profile (pc-eingang, xdj-xz, usb-audio for any other USB audio interface such as the Seiren or the K6), whether the device is present (da), linked in the core (verbunden; null = the core has sent no state for 2 s, unknown), the input level (pegel_db, -200 = silence, null = unknown), the measured latency (latenz, with art software or kabel) and frei_fuer_cypher. I may use an external input only when frei_fuer_cypher is true: Andreas releases each input himself, I cannot change it. Also the detected sources (quellen), the profiles and the last core state (kern.ein: verbunden bit mask, MIDI events seen and lost, last MIDI sample, last impulse sample).',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/geraete') },
  // Paket 1.13 (Warp, Slice 1): der Warp eines Audio-Clips mit Markern; lesen, ändern geht über proj_aendern (warp_setzen, warp_auto)
  { name: 'proj_warp', description: 'Read the warp of an audio clip of the open project. Answers {clip_id, start_beat, laenge_beats, warp, bei?}: warp is null for a clip without warp, else {an (false = markers kept but the clip plays unwarped), modus (repitch: speed follows the project tempo, the pitch goes with it; beats: drum slices on their beat, with the object beats {raster, loop, huelle} in the answer when it is set (absent = default transienten/vor/100); complex and tones keep the pitch), quelle (takte | mediathek | werkstatt | traktor | hand), eins_unsicher (true: the bar one of the track is a guess, the page shows "downbeat?"), transpose_st, detune_ct (pitch factor = 2^(transpose_st/12 + detune_ct/1200), complex and tones only), versatz_beats (which beat of the warp plays at the clip start), marker_zahl, marker: [{quell_s (source seconds), beat (clip beat; 0 is the 1.1.1 of the source), projekt_beat (where the marker lies in the first pass of the clip), segment_bpm (source tempo of the segment starting at the marker, null at the last marker)}]}. bei_beat (a project beat) adds bei {projekt_beat, quell_s}: the source second that plays there, as a counter check against what you hear or measured. von_beat and bis_beat (project beats) limit the marker list; marker_max (1 to 4096, default 200) caps it: marker_zahl is the number of markers in the clip, marker_gezeigt the number shown, weiter_ab_projekt_beat the project beat of the first marker not shown (use it as von_beat for the next page). transienten_zahl (the hits the server found in the source inside the clip; null: audio not decoded yet), transienten (source seconds of the hits in the window von_beat..bis_beat, at most transienten_max, default 4096), transienten_gezeigt (their number); tempo {mittel_bpm, min_bpm, max_bpm} and erster_marker {quell_s, beat} summarise the warp without the list (a track analysed by the Werkstatt has 350 to 2300 markers, one per beat; beat 0 is the first bar one). Change it with proj_aendern (warp_setzen, warp_auto, clip_aendern versatz_beats). Refused: kein_projekt, clip_unbekannt, feld_nur_audio.',
    inputSchema: { type: 'object', required: ['clip_id'], properties: {
      clip_id: { type: 'string', description: 'clip id from proj_lage, e.g. c3' },
      von_beat: zahl('first project beat of the marker list', {}),
      bis_beat: zahl('last project beat of the marker list', {}),
      bei_beat: zahl('project beat at which to read the source second W(bei_beat)', {}),
      marker_max: { type: 'integer', minimum: 1, maximum: 4096, description: 'at most this many markers in the list (default 200)' },
      transienten_max: { type: 'integer', minimum: 1, maximum: 32768, description: 'at most this many transients in the list (default 4096)' } } },
    lauf: (p) => http('GET', `/proj/warp?clip_id=${encodeURIComponent(String(p.clip_id))}${['von_beat', 'bis_beat', 'bei_beat', 'marker_max', 'transienten_max'].filter((k) => p[k] !== undefined)
      .map((k) => `&${k}=${encodeURIComponent(String(p[k]))}`).join('')}`) },
  // Note editor slice 1 (B5): the notes of an audio clip (detected from its pitch curve); editing goes through proj_aendern (audio_noten_aendern, audio_noten_zuruecksetzen, audio_noten_entfernen)
  { name: 'proj_noten', description: 'Read or detect the notes of an audio clip of the open project (single voice or single instrument; the pitch of the sound is cut into notes). '
    + 'Without flags it reads: {clip_id, quelle_sha, kurve, noten, analyse, render}. noten is the note list of the clip, null while the clip has none (an empty list means the detection found no notes): '
    + 'each note is {id (t1, t2, ... by start time, fixed), qa and qe (detected start and end in SOURCE seconds: the recording\'s own time, not beats, not project time), qton (detected pitch, float MIDI, A4 = 69, 60.5 is half way between C4 and C#4), p (level 0..1)} '
    + 'and a target field only when the note was edited: ton (target pitch, float MIDI), and a and e (target start and end in source seconds, like qa and qe), and vib and drift (factors of the detected vibrato and drift, 0 flat, 1 as sung and not stored, up to 4). The detected values qa, qe and qton never change. '
    + 'With a pitch curve every note carries mass, without one only a note with a target; mass is the measure of the edit from the list: {a_ms, e_ms (target minus detected start and end, ms, 0.1), laenge_ms (target length, ms), dehnung (target length divided by detected length, 1e-3), ton_ct (target minus detected pitch, cents, 0.1), and when the pitch curve is known vib_ct and drift_ct (source vibrato width peak to peak and drift range, cents), vib_ziel_ct and drift_ziel_ct (the same after the vib and drift factors)}. '
    + 'kurve is {id, detektor (pyin | netz), stimmhaft_anteil (share of pitched frames 0..1), mono} of the pitch curve the notes were cut from, null without notes. '
    + 'analyse is the last state of a detection of this clip in the open project (null before one), render the state of the edit sound: '
    + 'zustand quelle (no note has a target, the clip plays its source), rechnet (the edit is queued or computed, the clip still plays its source), alt (the previous render plays while the new one is computed), '
    + 'bereit (the exact edit plays; sekunden = computing time; messung = [{id, ton_ist, fehler_ct}], one entry per edited note: the pitch measured on the rendered sound over the middle of the note, float MIDI, and its distance to the target, cents; a note too short or unvoiced there has no entry), fehler (the clip plays its source; grund noten_programm_fehlt, noten_render_fehler or noten_kurve_fehlt with text); render is null when the server has no render service. '
    + 'After an edit with proj_aendern the render takes a moment: read again until zustand is bereit before you judge the sound. '
    + 'erkennen: true detects the notes (the clip must be decoded; one run at a time; no GPU; the result is one project change with the label "Detect notes <clip name>", one undo step with proj_undo). '
    + 'The call waits for the end and answers like a read with analyse = the end state, or up to '
    + `${FRIST_VORGABE_MS.proj_noten / 60_000} min (DJK_HAND_FRIST_PROJ_NOTEN_MS), then it answers laeuft with auftrag_id and the run goes on: read again later (analyse) or cancel it with abbrechen. `
    + 'analyse.zustand is laeuft (stufe, prozent), fertig (noten = count, detektor, sekunden, at most one hinweis with its English text: '
    + 'keine_noten = "No notes found in this clip." (an empty list is placed, no error), wenig_stimmhaft = "Little pitched sound found. If this is a full mix, separate stems first and detect notes on the vocal stem." (the notes are placed as usual), '
    + 'netz_fehler = "the network detector failed; the notes come from the own detector"), abgebrochen (grund abbruch or noten_zeitlimit), veraltet (grund veraltet: the clip or its source or its notes changed during the run, nothing placed; or ki_gestoppt: Stop Cypher was set at the end, the result was discarded) '
    + 'or fehler (grund noten_mehrstimmig = "More than one note at a time. Separate stems first, then detect notes on a stem." (more than 30 percent of the checked frames hold more than one note: use proj_stems and detect on a stem, nothing is placed), '
    + 'or noten_fehler with detail: a program failed or wrote no valid result, nothing changed). Closing or switching the project during a run cancels it; a run whose own state is no longer visible answers unbekannt. '
    + 'neu: true (only with erkennen) detects again on a clip that already has notes and replaces the list in one undo step; all edits of the old list are lost. Without it a clip with notes is refused noten_vorhanden. '
    + 'abbrechen: auftrag_id (integer, from erkennen or analyse; clip_id is not needed) cancels the running detection, the end state abgebrochen follows; an unknown or finished id is kein_auftrag, a run whose notes are already placed is zu_spaet (undo them with proj_undo). '
    + 'Refusals of erkennen (nothing changed): kein_projekt, clip_unbekannt, feld_nur_audio (a MIDI clip: it has its own note commands), audio_fehlt (the audio is not decoded yet), noten_laeuft (another detection runs, the detail names its auftrag_id), '
    + 'stems_laeuft (a stem separation runs), ki_gestoppt (Stop Cypher is set), nur_andreas_spur (the track belongs to Andreas), noten_vorhanden, noten_programm_fehlt (cypherdj-noten is not built or not installed), argument_ungueltig, argument_unbekannt. '
    + 'The read refuses kein_projekt, clip_unbekannt, feld_nur_audio and argument_ungueltig. '
    + 'The notes are not edited here: change targets with proj_aendern (audio_noten_aendern {clip_id, ids, ton | ton_um | a, e | zeit_um | vib | vib_um | drift | drift_um, mit_nachbarn?}, audio_noten_raster {clip_id, ids?, zeit?, ton?, staerke?, tonart?} to quantise starts or snap pitches, audio_noten_zuruecksetzen {clip_id, ids?}, audio_noten_entfernen {clip_id}); their refusals are named there (keine_audio_noten, noten_unbekannt, noten_ton_grenze and the others). '
    + 'Time edits (zeit_um moves, a and e set the edges, mit_nachbarn lets touching neighbours follow) are limited to a stretch of 0.25..4 (noten_dehnung_grenze) and to non-overlapping notes (noten_ueberlappen); after a time edit read again until render is bereit. '
    + 'An export waits up to 60 s for pending renders and is refused noten_render_fehlt when the edit is not ready by then.',
    inputSchema: { type: 'object', properties: {
      clip_id: { type: 'string', description: 'audio clip id from proj_lage, e.g. c3 (required except with abbrechen)' },
      erkennen: { type: 'boolean', description: 'true: detect the notes of the clip and wait for the end' },
      neu: { type: 'boolean', description: 'only with erkennen: replace an existing note list (the edits are lost)' },
      abbrechen: { type: 'integer', minimum: 1, description: 'auftrag_id of the running detection to cancel' } } },
    lauf: (p) => projNoten(p) },
  // Automation Slice 1/2 (ADR 032): read the points of a lane; changing goes through proj_aendern (auto_neu, auto_punkte, auto_loeschen, auto_aendern)
  { name: 'proj_auto', description: 'Read the automation lines (lanes) of the open project. Give lane_id (from proj_lage lanes, e.g. a1) for one lane '
    + 'or spur_id for all lanes of one track (also a group, a return or "master": their insert and rack lanes). Answers {lane_id, spur_id, ziel, gesperrt? (true only when the lane is locked), punkte_zahl (all points of the lane), punkte_gezeigt, '
    + 'punkte: [{beat (project beat), wert, form (linear | s | sprung: the segment INTO this point)}], '
    + 'weiter_ab_beat? (more points after the shown ones), bei?: {beat, wert}}; with spur_id: {spur_id, lanes: [...]}. '
    + 'ziel and the unit of wert: fader (dB, -200..6, -200 = off), pan (-1..1), mute and solo (0 or 1, always jumps), '
    + 'geraet.lautstaerke, geraet.cutoff, geraet.resonanz, geraet.env_mod (0..1, only on tracks with the RB-338 device), geraet.k1..geraet.k64 (0..1, the knobs of a bk track; an untouched knob sits at the graph\'s default, 0.5 where it has none), '
    + 'send.<returnId> (dB, -200..6, the level of a send of a track into that return), insert.<stage id>.<param> (the unit and range of that insert parameter, e.g. dB for schwelle), plugin.<host stage id>.<index> (0..1, a parameter of a foreign plugin: index as in the plugin\'s parameter list (plugins aktion parameter); played by the page server at 50 Hz, about 10 ms timing, not sample-accurate; at most 16 per plugin, plugin_lanen_voll (409), counted per host stage and NOT against the 12 lanes per strip that reach the core), rack.m1..rack.m4 (0..1). '
    + 'bei_beat reads the value the core plays at that project beat, in the unit of the lane (before the first point the first value holds, after the last the last); the answer carries it as bei. '
    + 'gesperrt: true = the lane is locked, auto_punkte and auto_loeschen are refused with lane_gesperrt until proj_aendern auto_aendern {lane_id, gesperrt: false}. '
    + 'von_beat and bis_beat (project beats, both included) narrow the list; punkte_max (default 200) caps it. '
    + 'A lane that Andreas recorded by hand (touch, latch or write take) is an ordinary lane here: read it like any other. '
    + 'Changing lanes: proj_aendern auto_neu, auto_punkte, auto_loeschen, auto_aendern. Refused: lane_unbekannt (404), spur_unbekannt (404), kein_projekt. '
    + 'CLIP ENVELOPES (slice 5): give clip_id (from proj_lage) and ziel (gain | transpose | spur_fader | spur_pan | geraet.lautstaerke | geraet.cutoff | geraet.resonanz | geraet.env_mod | geraet.k1..geraet.k64) to read the envelope of that target on that clip; clip_id alone lists every envelope of the clip as {clip_id, spur_id, huellkurven: [...]}, an empty list when it has none. '
    + 'Answers {clip_id, spur_id, ziel, verknuepft (true = linked: repeats with the clip loop; false = unlinked), loop_beats? (only unlinked), punkte_zahl, punkte_gezeigt, punkte: [{beat, wert, form}], weiter_ab_beat?, bei?: {beat, wert}}. '
    + 'For a clip envelope ALL beats (von_beat, bis_beat, bei_beat, the points) are CLIP beats counted from the clip start, not project beats; bei is the value the core plays at that clip beat (with the repetition of a linked or unlinked envelope), in the unit of the target (gain and spur_fader in dB, transpose in semitones before rounding, spur_pan and geraet.* plain). '
    + 'clip_id does not go with lane_id or spur_id (argument_ungueltig). Refused for a clip: clip_unbekannt (404), huellkurve_unbekannt (404, the clip carries no envelope for that ziel), huellkurve_ziel (400, ziel is not an envelope target). '
    + 'MODULATOR LIVE READ: give mod_id (from proj_lage modulatoren, alone, not with lane_id, spur_id or clip_id) to read what one modulator does to its targets right now. Answers {mod_id, nr, art, an, ausgang, ziele: [{strang_id, ziel, einheit, basis, versatz, wert, tiefe, polaritaet}]}. '
    + 'ausgang is the modulator output -1..1 the core reported last (null while the core reports none, e.g. no core yet). basis is the value the page server knows for that target: the last value the core reported for that row when there is one, else the project value (null for device and plugin targets, which the server does not track); versatz is the offset in the unit of the target (dB, pan units, 0..1, for insert parameters already multiplied by the parameter range); wert = basis + versatz clamped to the range of the target. versatz and wert are null while ausgang or basis is unknown. Several modulators on one target add up in the core, so wert here shows only this modulator. Moving the base (any write, or Andreas by hand) moves wert, the offset stays on top. Refused: mod_unbekannt (404), kein_projekt (409).',
    inputSchema: { type: 'object', properties: {
      lane_id: { type: 'string', description: 'lane id from proj_lage, e.g. a1' },
      mod_id: { type: 'string', description: 'modulator id from proj_lage modulatoren, e.g. m1: read its live offsets (alone)' },
      spur_id: { type: 'string', description: 'track id: all lanes of that track (instead of lane_id)' },
      clip_id: { type: 'string', description: 'clip id from proj_lage: read the clip envelopes (instead of lane_id or spur_id); then the beats below are CLIP beats' },
      ziel: { type: 'string', description: 'with clip_id: the envelope target to read (gain | transpose | spur_fader | spur_pan | geraet.lautstaerke | geraet.cutoff | geraet.resonanz | geraet.env_mod | geraet.k1..geraet.k64); without it every envelope of the clip' },
      von_beat: zahl('first beat of the point list (project beat for a lane, clip beat for a clip envelope)', {}),
      bis_beat: zahl('last beat of the point list (project beat for a lane, clip beat for a clip envelope)', {}),
      bei_beat: zahl('beat at which to read the lane value (project beat; clip beat for a clip envelope), in the unit of the lane target', {}),
      punkte_max: { type: 'integer', minimum: 1, maximum: 8192, description: 'at most this many points in the list (default 200)' } } },
    lauf: (p) => http('GET', `/proj/auto?${['lane_id', 'mod_id', 'spur_id', 'clip_id', 'ziel', 'von_beat', 'bis_beat', 'bei_beat', 'punkte_max'].filter((k) => p[k] !== undefined)
      .map((k) => `${k}=${encodeURIComponent(String(p[k]))}`).join('&')}`) },
  // Automation Slice 3 (ADR 032, D9): Cypher may only re-enable overridden lanes; the override route (/proj/auto/uebersteuern) is Andreas' hand and is never called here
  { name: 'proj_auto_zustand', description: 'Give overridden automation lanes back (re-enable). A lane is overridden (uebersteuert: true in proj_lage) when Andreas grabbed its field (fader, pan, mute or solo of a track) on the page or the controller; '
    + 'it then keeps his value instead of following the line. Give {re_enable: true} to re-enable every overridden lane, or {spur_id, ziel} (ziel: fader | pan | mute | solo) for one. '
    + 'This tool only re-enables: Cypher cannot override a lane and cannot arm automation recording: both are Andreas\' hand, no tool exists for either, and the server answers such a request from Cypher with nur_andreas. A take that Andreas records arrives as an ordinary lane, readable with proj_auto, and he can lock it with auto_aendern. A lane that is not overridden stays as it is. The lane follows the line again from the next block, with a short blend, not a jump. '
    + 'Answers {ok: true, quittung, alle: true | spur_id, ziel}. Refused: ki_gestoppt (409, Stop Cypher is set: wait for Andreas), argument_ungueltig (400: give re_enable true, or spur_id and ziel, not both), argument_ungueltig also for a half call, a non-string spur_id or a ziel outside fader | pan | mute | solo (refused here without a request; the server answers auto_ziel_unbekannt 400 as a backstop), kein_kern (503); only with spur_id and ziel: kein_projekt, spur_unbekannt (404).',
    inputSchema: { type: 'object', properties: {
      re_enable: { type: 'boolean', description: 'true = re-enable every overridden lane' },
      spur_id: { type: 'string', description: 'track id from proj_lage, e.g. s3 (with ziel, instead of re_enable)' },
      ziel: { type: 'string', enum: ['fader', 'pan', 'mute', 'solo'], description: 'the field of that track' } } },
    // the low-level server does not check the schema: a wrong combination is refused here without a request
    lauf: async (p) => {
      const hat = (k: string) => Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
      const nein = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      if (hat('re_enable')) {   // shape 1: {re_enable: true} and nothing else
        if (p.re_enable !== true) return nein('re_enable must be true (or leave it out and give spur_id and ziel)');
        if (hat('spur_id') || hat('ziel')) return nein('re_enable true re-enables every lane: leave out spur_id and ziel, or leave out re_enable');
        return http('POST', '/proj/auto/re_enable', { alle: true });
      }
      // shape 2: {spur_id, ziel}
      if (!hat('spur_id') && !hat('ziel')) return nein('give re_enable true, or spur_id and ziel');
      if (typeof p.spur_id !== 'string') return nein(hat('spur_id') ? 'spur_id must be a string (a track id from proj_lage, e.g. s3)' : 'spur_id is missing (give it together with ziel)');
      if (!hat('ziel')) return nein('ziel is missing (give it together with spur_id)');
      if (p.ziel !== 'fader' && p.ziel !== 'pan' && p.ziel !== 'mute' && p.ziel !== 'solo') return nein('ziel must be fader, pan, mute or solo');
      return http('POST', '/proj/auto/re_enable', { spur_id: p.spur_id, ziel: p.ziel });
    } },
  // 1.14 Comping Slice 1 (R8, R10): audition of one take of a track; the choice is not part of the project and not undoable
  { name: 'take_vorhoeren', description: 'Audition one take of a track in the open project, or stop the audition. Give {spur_id, take_id}: that take plays instead of the track\'s comp (the track\'s own playback, not the project change); '
    + 'take_id null ends the audition and the comp plays again. Takes are made and edited with proj_aendern (take_neu, take_umbenennen, take_loeschen, comp_waehlen); proj_lage shows the takes of each track. On an instrument track the take is a MIDI take and the audition plays its notes. '
    + 'The audition is not part of the project: it is not saved, not undoable and not in the history. Answers {vorhoeren: {<spur_id>: <take_id>}} (every track that is being auditioned; empty = none). '
    + 'Refused: take_unbekannt, aufnahme_laeuft, kein_projekt, ki_gestoppt (Stop Cypher is set: wait for Andreas); argument_ungueltig (400) locally for an empty or non-string spur_id, or a take_id that is neither a non-empty string nor null.',
    inputSchema: { type: 'object', required: ['spur_id', 'take_id'], properties: {
      spur_id: { type: 'string', description: 'track id from proj_lage, e.g. s3' },
      take_id: { type: ['string', 'null'], description: 'take id from proj_lage, or null to end the audition' } } },
    // the low-level server does not check the schema: a wrong shape is refused here without a request
    lauf: async (p) => {
      const nein = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
      if (typeof p.spur_id !== 'string' || p.spur_id === '') return nein('spur_id must be a non-empty string (a track id from proj_lage, e.g. s3)');
      if (!Object.prototype.hasOwnProperty.call(p, 'take_id') || (p.take_id !== null && (typeof p.take_id !== 'string' || p.take_id === ''))) return nein('take_id must be a non-empty string (a take id from proj_lage) or null to end the audition');
      return http('POST', '/proj/take_vorhoeren', { spur_id: p.spur_id, take_id: p.take_id });
    } },
  // S17: sound snapshot of the project (Baukasten graph + knob values per channel)
  { name: 'proj_bk', description: 'Sound snapshot of the open project: which Baukasten graph sits on erz/2, erz/3, deck/1|2, pad/1|2 (fx/3, fx/4 on request) and the graph knob values <kanal>/bk/1..64. '
    + 'aktion lage = saved against live per channel ({kanaele: [{kanal, gespeichert, live, regler_gespeichert, regler_live, gleich}]}; gleich true/false, null = a live value is unknown). '
    + 'merken = save what is loaded now (one undo step "Cypher Modular: save sound"; kanaele optional, default erz/2, erz/3, deck/1|2, pad/1|2 that have a graph; never removes an entry, remove one with proj_aendern bk_setzen {kanal, graph: null}); '
    + 'answers bk {gemerkt, unbekannt} (unbekannt = knobs whose live value was unknown: their stored value is kept). laden = apply the saved sound now (knobs, then graph). '
    + 'Opening the project and a kern restart apply it by themselves. Undo changes only the project, it does not change the running sound. '
    + 'Refused while Stop Cypher is set (ki_gestoppt); channels whose stream has AUTO off are skipped (auto_aus); bk_nicht_geladen, bk_nichts_geladen, kein_projekt (409).',
    inputSchema: { type: 'object', properties: {
      aktion: { type: 'string', enum: ['lage', 'merken', 'laden'] },
      kanaele: { type: 'array', items: { type: 'string' }, description: 'channels, e.g. ["erz/3", "deck/1"] (merken, laden); default: all that apply' } }, required: ['aktion'] },
    // the low-level server does not check the schema: an unknown aktion is refused here without a request
    lauf: async (p) => (p.aktion !== 'lage' && p.aktion !== 'merken' && p.aktion !== 'laden' ? { code: 400, j: { fehler: 'aktion_unbekannt', text: 'aktion must be lage, merken or laden' } }
      : p.aktion === 'lage' ? http('GET', '/proj/bk') : http('POST', p.aktion === 'merken' ? '/proj/bk/merken?antwort=kurz' : '/proj/bk/laden', p.kanaele ? { kanaele: p.kanaele } : {})) },
  // Paket 1.13 Slice 6 (D1, D14, D15): Stems trennen; die Antwort des Servers ist {auftrag_id, frames}, das Ende liest projStems aus /proj/aktuell
  { name: 'proj_stems', description: 'Separate one audio clip of the open project into stems on the GPU (BS-RoFormer; drums, bass, other, vocals always, '
    + 'guitar and piano only when they are not empty, otherwise they are in other): the whole clip or '
    + 'von_beat..bis_beat inside it (at most 600 s of source; about 45 s for 8 min). GPU only: less than 4.5 GB free ends with fehler gpu_belegt, '
    + 'no GPU with keine_gpu, the project unchanged. The end is one project change with one undo step: the original part is muted, four to six new '
    + 'tracks with the stems lie under it in a group "Stems: <name>", warped like the original. The call waits until the end (fertig, abgebrochen, veraltet, '
    + `fehler with grund) or up to ${FRIST_VORGABE_MS.proj_stems / 60_000} min (DJK_HAND_FRIST_PROJ_STEMS_MS), `
    + 'then answers laeuft with auftrag_id; the run goes on. '
    + 'If the project was changed or closed meanwhile, the run is cancelled and the answer is unbekannt (the result is not visible here: check proj_lage); '
    + 'a failed status query also answers unbekannt with detail. Only one run at a time (stems_laeuft). Refused on a track of Andreas (nur_andreas_spur), with Stop Cypher (ki_gestoppt), with a looped clip (stems_loop), with more or less than '
    + 'one audio clip in the range (mehrere_clips), when six free tracks are missing (zu_viele_spuren), before the core has reported (kein_kernstand), '
    + 'with a range over 600 s of source (stems_zu_gross). Runs on the GPU only (BS-RoFormer, about 45 s per 8-minute track, about 3 GB video memory); without a free GPU it is refused (keine_gpu, gpu_belegt).',
    inputSchema: { type: 'object', properties: {
      clip_id: { type: 'string', description: 'audio clip id from proj_lage, e.g. c3 (or spur_id)' },
      spur_id: { type: 'string', description: 'track id; exactly one audio clip must lie in the range' },
      von_beat: zahl('first project beat (default: clip start)', { minimum: 0 }), bis_beat: zahl('end beat (default: clip end)', { minimum: 0 }),
      geraet: { type: 'string', enum: ['cpu', 'gpu'], description: 'default gpu (falls back to the CPU when the GPU is busy); cpu forces the CPU' } } },
    lauf: (p) => projStems(p) },
  { name: 'proj_stems_abbrechen',
    description: 'Cancel the running stem separation (auftrag_id from proj_stems): the run ends with abgebrochen, nothing changes. Unknown id or a run that has already ended: kein_auftrag; zu_spaet only while the result is being saved.',
    inputSchema: { type: 'object', required: ['auftrag_id'], properties: { auftrag_id: { type: 'integer', minimum: 1 } } },
    lauf: (p) => http('POST', '/proj/stems/abbrechen', { auftrag_id: p.auftrag_id }) },
  // plan 1.11 tasks 8 and 10: the foreign plugins. Cypher may list, look at, read and set parameters; the scan and the plugin window are Andreas' hand only.
  { name: 'plugins', description: 'Foreign plugins (VST3, LV2). aktion liste {text?, art? (effekt | instrument | sonst)}: the plugin index [{id, format, pfad, uid, name, hersteller, art, audio_ein, audio_aus, parameter (count), status (ok | blockiert), grund?, text?}], at most 200 entries (abgeschnitten, gesamt say more; narrow it with text); an empty list means no scan has run yet (Andreas starts it). '
      + 'A VST3 bundle with several classes lists every class as its own entry; they load one by one through a small shim the install builds '
      + '(vst3_klasse/build.sh), and without it the later classes are blockiert (grund mehrklassen). '
      + 'aktion zeige {id}: one entry; plugin_unbekannt (404) when the ID is not in the index. Put an effect on a strip with proj_aendern insert_setzen art "host" and plugin_id (only status ok and art effekt). '
      + 'aktion parameter {insert_id or spur_id}: the parameters of the plugin on that host stage (or of the plugin instrument of that track) [{index, name, min, max, vorgabe, einheit, wert (0..1)}]; insert_id is the stage id from proj_lage (art host). '
      + 'A parameter can also be automated: proj_aendern auto_neu with ziel plugin.<stage id>.<index> (0..1, at most 16 lanes per host stage). '
      + 'A parameter can also sit on a controller knob: proj_aendern plugin_regler_setzen {insert_id, knopf 1..16, index} (index_doppelt when the parameter has another knob); the knob is the controller row plug/<host slot>/k<knopf>, a plugin lane on the same parameter wins while the transport plays; Andreas learns the controller onto the knob. '
      + 'A plugin with audio_ein >= 4 (a compressor with a sidechain input) takes a sidechain key on its host stage: proj_aendern insert_setzen art "host" with key, or insert_param_setzen param "key"; other plugins are kein_schluessel. '
      + 'A plugin INSTRUMENT is the device of a track: proj_aendern spur_neu {art: "instrument", geraet: {art: "wirt", name: "plugin", plugin_id}} (only status ok and art instrument, else kein_instrument; it takes one of the two Surge slots, a third host track is slot_belegt); parameter and param take spur_id of that track instead of insert_id. '
      + 'aktion param {insert_id or spur_id, werte: {<index>: 0..1}}: sets plugin knobs directly in the host (no project command, no undo step; Stop Cypher blocks it with ki_gestoppt). Reasons: insert_unbekannt, host_fehlt (host not ready), param_unbekannt, argument_ungueltig. '
      + 'There is no rescan, unblock or window action here: Andreas does those.',
    inputSchema: { type: 'object', required: ['aktion'], properties: { aktion: { type: 'string', enum: ['liste', 'zeige', 'parameter', 'param'] },
      text: { type: 'string', description: 'liste: part of the name, maker or path' }, art: { type: 'string', enum: ['effekt', 'instrument', 'sonst'] },
      id: { type: 'string', description: 'zeige: the plugin ID from liste' }, insert_id: { type: 'string', description: 'parameter, param: the host stage id' },
      spur_id: { type: 'string', description: 'parameter, param: the track id of a plugin instrument track (instead of insert_id)' },
      werte: { type: 'object', description: 'param: {<parameter index>: value 0..1}, 1 to 256 entries' } } },
    lauf: async (p) => {
      const fehlt = (was: string) => fehlerAntwort(400, 'argument_fehlt', `plugins ${String(p.aktion)} needs ${was}`);
      const stufe = typeof p.insert_id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(p.insert_id) ? p.insert_id : null;
      if (p.aktion === 'liste' || p.aktion === 'zeige') {
        const q = new URLSearchParams();
        if (p.aktion === 'liste') { if (typeof p.text === 'string' && p.text) q.set('text', p.text); if (typeof p.art === 'string' && p.art) q.set('art', p.art); }
        const r = await http('GET', `/plugins${q.size ? `?${q}` : ''}`);
        if (r.code !== 200) return r;
        const alle = (Array.isArray(r.j.plugins) ? r.j.plugins : []) as Json[];
        if (p.aktion === 'zeige') {
          if (typeof p.id !== 'string' || p.id === '') return fehlt('id');
          const e = alle.find((x) => x.id === p.id);
          return e ? { code: 200, j: e } : fehlerAntwort(404, 'plugin_unbekannt', 'that plugin is not in the plugin index');
        }
        return { code: 200, j: { plugins: alle.slice(0, 200), gesamt: alle.length, ...(alle.length > 200 ? { abgeschnitten: true } : {}) } };
      }
      if (p.aktion === 'parameter' || p.aktion === 'param') {
        const spur = typeof p.spur_id === 'string' && /^s[0-9]{1,6}$/.test(p.spur_id) ? p.spur_id : null;
        if (stufe !== null && spur !== null) return fehlerAntwort(400, 'argument_ungueltig', 'insert_id and spur_id name the same plugin: give one');
        if (stufe === null && spur === null) return fehlt('insert_id (the host stage id) or spur_id (a plugin instrument track)');
        const basis = spur !== null ? `/proj/spur/${spur}/geraet` : `/proj/insert/${stufe}`;
        if (p.aktion === 'parameter') return http('GET', `${basis}/parameter`);
        if (p.werte === null || typeof p.werte !== 'object' || Array.isArray(p.werte)) return fehlt('werte {<index>: 0..1}');
        return http('POST', `${basis}/param`, { werte: p.werte });
      }
      return fehlerAntwort(400, 'aktion_unbekannt', 'aktion is liste, zeige, parameter or param');
    } },
  { name: 'presets_suchen', description: SUCHE.description, inputSchema: SUCHE.input_schema as Json,
    lauf: (p) => http('POST', '/presets/suche', p) },
  { name: 'presets_lesen', description: 'Read one preset with its values, description and tags. id is the register id <werk|nutzer>:<geraet>/<slug> as presets_suchen returns it, e.g. werk:komp/drum-bus. A malformed id is refused here without a request.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'register id, e.g. werk:komp/drum-bus or nutzer:rb338/my-bass' } } },
    lauf: async (p) => {
      if (typeof p.id !== 'string' || !PRESET_ID.test(p.id)) return fehlerAntwort(400, 'preset_id_ungueltig', 'a preset id looks like werk:komp/drum-bus or nutzer:rb338/my-bass (<werk|nutzer>:<geraet>/<slug>)');
      const [, herkunft, geraet, slug] = /^(werk|nutzer):([^/]+)\/(.+)$/.exec(p.id)!;
      return http('GET', `/presets/${herkunft}/${encodeURIComponent(geraet)}/${encodeURIComponent(slug)}`);
    } },
  { name: 'presets_speichern', description: 'Save a preset as a user preset (nutzer), marked as mine (autor cypher). Give exactly one of werte (plugin parameter values by their ids, with geraet) or ziel (take the current values of a target, see presets_anwenden for the target shapes; only spur and insert targets; geraet and graph then come from the target and must not be given). beschreibung is {art, unterart, charakter[], genre[], einsatz[], energie 1..5, text}: its words come only from the closed vocabulary of presets_suchen; a refused word comes back as details with the allowed words (erlaubt), correct and send again. Saving over an existing name needs ueberschreiben true, and I may overwrite only presets I saved myself (else nur_andreas_preset); factory presets (werk) are read only. Answer {herkunft, geraet, slug, geaendert}; read it back with presets_lesen id nutzer:<geraet>/<slug>.',
    inputSchema: { type: 'object', required: ['name', 'beschreibung'], properties: {
      name: { type: 'string', description: 'preset name (the file name is derived from it)' },
      geraet: { type: 'string', description: 'device id (rb338, baukasten, komp, eq, saett, hall, ...); required with werte, not allowed with ziel' },
      beschreibung: { type: 'object', description: '{art, unterart, charakter: [..], genre: [..], einsatz: [..], energie: 1..5, text}, words from the vocabulary' },
      werte: { type: 'object', description: 'parameter values by plugin id (plain values, enums by their text, switches as booleans)' },
      stifte: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, description: 'patch field pins [satz 0..1, zeile 0..15, spalte 0..15, wert -1..1 but not 0], sorted, no position twice (device baukasten with werte only; with ziel the pins come from the track)' },
      ziel: PRESET_ZIEL, graph: { type: 'string', description: 'Baukasten graph name (device baukasten only)' },
      tags: { type: 'array', items: { type: 'string' } }, notiz: { type: 'string' },
      ueberschreiben: { type: 'boolean', description: 'replace an existing user preset of this name (only one I saved)' } } },
    lauf: async (p) => {
      const hatW = p.werte !== undefined, hatZ = p.ziel !== undefined;
      if (hatW === hatZ) return fehlerAntwort(400, 'werte_oder_ziel', 'give exactly one of werte (values by plugin id, with geraet) or ziel (a target whose current values are taken)');
      if (hatW) {
        if (typeof p.geraet !== 'string') return fehlerAntwort(400, 'geraet_fehlt', 'saving werte needs geraet (the device id)');
        return http('POST', '/presets', definiert(p, 'name', 'geraet', 'beschreibung', 'werte', 'stifte', 'graph', 'tags', 'notiz', 'ueberschreiben'));
      }
      if (p.geraet !== undefined || p.graph !== undefined) return fehlerAntwort(400, 'geraet_aus_ziel', 'with ziel the device and graph come from the target; do not give geraet or graph');
      return http('POST', '/presets/von_ziel', definiert(p, 'ziel', 'name', 'beschreibung', 'tags', 'notiz', 'ueberschreiben'));
    } },
  { name: 'presets_anwenden', description: 'Apply a preset to a target: the server computes a plan from the preset, the target and the open project, and I send it through the normal routes, so it is one undo step with the source cypher (project targets: one proj_aendern with the label "Preset <name>"; kern channel targets: one regler call per value, no ramp; it stops at the first refusal and reports which values were accepted, which one was refused and which were never sent). Target shapes: {art: "spur", spur_id} (rb338 or bk track: its device values; a bk preset on a track with another graph is refused with graph_anders unless graph_laden is true), {art: "insert", insert_id} (an existing stage gets the values), {art: "insert_neu", strang_id} (a new stage at the end of the chain), {art: "kanal", kanal} (kern source channel such as deck/1: channel compressor and mix tools; an instrument channel such as erz/6: the 64 graph knobs). A refused plan sends nothing (kein_ziel for hall presets, art_nicht_aktiv, geraet_passt_nicht, kanal_art, ziel_unbekannt, kein_projekt). graph_laden true (optional, default false) lets a Baukasten instrument preset load its own instrument: on a track with another bk graph the track exchanges its graph in the same undo step (hinweise: graph_gewechselt, the old knob values are not carried over, a graph with latency stays refused on a SEQ pattern: graph_latenz); on an instrument channel I send the graph (POST /graph) FIRST and the knob requests only after the kern accepted it, a refused graph sends no knob. Without it a preset of another graph is refused graph_anders or kein_graph; a preset whose instrument is not installed is refused graph_fehlt. The answer carries uebersprungen (parameters the target cannot carry, never dropped silently) and hinweise; applying values to a frozen track drops its freeze (hinweise: freeze_geht). rev defaults to the current project revision (proj_lage); rev_veraltet means someone changed it: read again.',
    inputSchema: { type: 'object', required: ['id', 'ziel'], properties: { id: { type: 'string', description: 'register id <werk|nutzer>:<geraet>/<slug>' }, ziel: PRESET_ZIEL, rev: { type: 'integer', minimum: 0 },
      graph_laden: { type: 'boolean', description: 'true: a Baukasten instrument preset loads its graph on the target first (track: exchanged in the same change; channel: graph sent before the knobs). Default false: another graph is refused.' } } },
    lauf: (p) => presetsAnwenden(p) },
  { name: 'kollektionen', description: 'Collections: named lists of samples, presets and devices. Without slug: all collections [{slug, name, anzahl, autor?, geaendert}]. With slug: that collection {slug, name, autor?, angelegt, geaendert, posten}; an item is {art: "sample", sha} | {art: "preset", id} | {art: "geraet", geraet}. Read only; change with kollektion_aendern.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string', description: 'collection slug, e.g. dark-stuff' } } },
    lauf: (p) => (typeof p.slug === 'string' ? http('GET', `/kollektionen/${encodeURIComponent(p.slug)}`) : http('GET', '/kollektionen')) },
  { name: 'kollektion_aendern', description: 'Change collections. aktion neu {name}: create one (marked as mine). aktion posten {slug, hinzu?: [item], weg?: [item], erwartet?}: add and/or remove items (items as in kollektionen; erwartet = the geaendert stamp you read, a stale one is refused with veraltet; at most 500 items). aktion umbenennen {slug, name}. aktion loeschen {slug} (the collection goes to the trash folder). I may remove items from, rename or delete only collections I created myself (else nur_andreas_kollektion); I may add items to any. When Andreas renames one of mine it becomes his, and from then on I may not change it.',
    inputSchema: { type: 'object', required: ['aktion'], properties: { aktion: { type: 'string', enum: ['neu', 'posten', 'umbenennen', 'loeschen'] }, slug: { type: 'string' }, name: { type: 'string' },
      hinzu: { type: 'array', items: { type: 'object' } }, weg: { type: 'array', items: { type: 'object' } }, erwartet: { type: 'string', description: 'the geaendert stamp of the collection as read' } } },
    lauf: (p) => {
      const slug = typeof p.slug === 'string' ? encodeURIComponent(p.slug) : null;
      const fehlt = (was: string) => fehlerAntwort(400, 'argument_fehlt', `kollektion_aendern ${String(p.aktion)} needs ${was}`);
      if (p.aktion === 'neu') return typeof p.name === 'string' ? http('POST', '/kollektionen', { name: p.name }) : fehlt('name');
      if (p.aktion === 'posten') {
        if (!slug) return fehlt('slug');
        if (p.hinzu === undefined && p.weg === undefined) return fehlt('hinzu and/or weg');
        return http('POST', `/kollektionen/${slug}/posten`, definiert(p, 'hinzu', 'weg', 'erwartet'));
      }
      if (p.aktion === 'umbenennen') return !slug ? fehlt('slug') : typeof p.name !== 'string' ? fehlt('name') : http('POST', `/kollektionen/${slug}/umbenennen`, { name: p.name });
      if (p.aktion === 'loeschen') return slug ? http('POST', `/kollektionen/${slug}/loeschen`, {}) : fehlt('slug');
      return Promise.resolve(fehlerAntwort(400, 'aktion_unbekannt', 'aktion is one of neu, posten, umbenennen, loeschen'));
    } },
  // Live modules task 8 (decisions 7, 16): the blend of one stem of a module between the original and the new instrument path
  { name: 'modul_blend', description: 'Blend one stem of a live module between the original stem and its new instrument path (Drums: drums-909, Bass: synth-neuro, '
    + 'with the MIDI that was extracted from the stem). wert 0..1: 0 = the original alone, 1 = the new path alone, in between an equal-power crossfade of the two track faders. '
    + 'takte (0, 1, 2, 4, 8, 16; default 0): over that many bars on the core clock, answered at once with zustand rampe (the end follows in GET /modul/stand under blend); '
    + '0 sets it now, one undo step. Only stems with a new path can be blended. Answers {slot, stem, gruppe_id, wert, takte, zustand, rev, fader_db {original, neu}}. '
    + 'Refused: kein_neuer_pfad (409, that stem has no new path: Other, Vocals, Guitar and Piano never do, Drums and Bass only once their MIDI is in; GET /modul/stand shows midi_fehler when it failed), '
    + 'slot_leer, kein_liveprojekt, rampe_laeuft, ki_gestoppt (Stop Cypher), argument_ungueltig.',
    inputSchema: { type: 'object', required: ['slot', 'stem', 'wert'], properties: { slot: { enum: ['A', 'B', 'C', 'D', 1, 2, 3, 4], description: 'place A to D or 1 to 4 (A deck/1, B deck/2, C pad/1, D pad/2)' },
      stem: { type: 'string', enum: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] }, wert: zahl('0 = original, 1 = new path', { minimum: 0, maximum: 1 }),
      takte: { type: 'integer', enum: [0, 1, 2, 4, 8, 16], description: 'bars of the blend ramp (default 0 = at once)' } } },
    lauf: (p) => http('POST', '/modul/blend', { slot: p.slot, stem: p.stem, wert: p.wert, ...(p.takte === undefined ? {} : { takte: p.takte }) }) },
  // Sampler A1 task 9: the cut store and SLICE TO TRACK of the page server (routes /sampler/*, areas/sampler/area.ts). Plans B and C add `kit` and `ton` to the aktion enum (C: `ton`, below).
  { name: 'sampler', description: 'Sampler: cut a library loop or the audio of a workbench module into slices, and put the slices on a workbench track. '
    + 'aktion quellen = what can be cut, {loops: [{name, beats}], module: [{id, titel, beats, bpm, audio: [{stem, name}]}]} (stem null = the module\'s Loop track, else drums, bass, other, vocals, guitar, piano). '
    + 'liste = the cuts that exist, {schnitte: [{id, name, quelle, bpm, beats, scheiben, geraet}]}. '
    + 'neu {quelle, name?, scheiben?} = make a cut and answer {schnitt}: quelle {art: loop, ref: <loop name from quellen>} or {art: modul, ref: <module id>, stem?}; scheiben (4, 8, 16, 32 or 64 slices) default: the finest of 1/16, 1/8, 1/4, 1/2, 1 beat with at most 64 slices; the slices are equal steps of the beat grid. '
    + 'lies {id} = the cut as text: a header line (id, name, source, tempo, beats, slice count) and one line per slice with its number, start and length in beats, strength and grid distance (the answer is that text, not JSON). '
    + 'spur {id} or {quelle, name?, scheiben?} = SLICE TO TRACK: a new instrument track with a generated sampler device that plays the cut in its original order (with quelle the cut is made first and removed again if the track is refused); answers {rev, projekt, spur_id, schnitt_id, fit}. '
    + 'The tempo of the project is fitted to the cut on the SPEED knob when it is within 0.25x to 4x (fit is that value, else null and SPEED stays at 1). '
    + 'kit {id, nummern, namen?, kit?} = a drum kit of the slices nummern (numbers from 1, as in lies) of the cut id, written into the kit folder: every slice becomes one sound, in ascending slice order from note 36 whatever the order of nummern (the lowest slice number gets note 36, the next 37 ...; a number listed twice is refused, and namen follow their numbers), '
    + 'the slice as it is with a 5 ms fade at its end; answers {kit, klaenge: [{scheibe, note, name, datei, frames}]} (scheibe is 0-based) and the text "kit <name>: bd:0 = slice 1 (note 36), sd:0 = slice 3 (note 37)". '
    + 'namen (one bank per number, a-z, 0-9 and _, starting with a letter, at most 16 characters, e.g. bd, sd, hh, cp, perc) are the banks; absent, every bank is proposed from the low/mid/high balance of the first 100 ms of the slice (bd, sd, hh or perc). '
    + 'Numbers are given per bank in slice order (banks bd, sd, bd become bd:0, sd:0, bd:1), so write the bank only, never bd:1. kit is the kit name (a-z, 0-9, _ and -, 1 to 32 characters); absent, it is made from the name of the cut. '
    + 'A slice may be at most 10 s (klang_zu_lang); an existing kit name is refused (kit_vorhanden) and nothing is written. To place the kit on a track: proj_aendern werkbank_spur_neu {name, geraet: {art: \'intern\', name: \'kit\', kit}}. '
    + 'To play it from a Strudel text: proj_muster on that track with s("bd sd"); bd:1 is the second sound of the bank bd. The live DRUMS stream does not see a new kit: its base kit is fixed when the studio starts. '
    + 'ton {id, von, bis?, grund?, name?, spur?} = TONE: slice von (or the run von..bis of neighbouring slices, numbered from 1) of the cut id becomes a playable tone: a generated 8-voice sampler device that plays that piece at the pitch of the note you play, relative to its root note. grund = the root, a MIDI note 16 to 95 (60 = C3), by default proposed from a pitch detection, else from the key of the cut, else C3. spur (default true) also puts it on a new NOTE track of the open workbench module with one note at the root (one undo step; kein_werkbank and werkbank_voll as for spur); spur false only makes the tone; name is the name of the tone and of that track (default made from the cut and the slices). The answer text names the device (graph), root and how it was found, the detected note and its confidence (0 to 1). '
    + 'Numbering: slices are numbered from 1 in every text and grid; slice n plays on note n - 1 and reversed on note n + 63 (note 0..63 forward, 64..127 reversed). '
    + 'spur needs an open workbench module (kein_werkbank otherwise) with a free instrument slot (werkbank_voll); it changes the project in one undo step. '
    + 'Patterns of slice notes (a new order, repeats, reversed hits) are written with proj_aendern (noten_neu, noten_aendern) on that track, with ton = slice number - 1 (reversed: + 64). '
    + 'Names that look alike: scheiben (count of slices of a new cut, with neu and spur) is not scheibe (marke: the number of one slice, from 2) and not the 0-based scheibe in the kit answer; von and bis (ton) and nummern (kit) are slice numbers from 1; the field spur (ton: also make a track) is not the aktion spur and not spur_id (ursprung: the id of an existing track). '
    + 'Sampler A2: methode anschlag (neu, spur with quelle, schneiden) cuts at the hits found in the audio instead of the grid; empfindlichkeit 0..1 (default 0.5) sets how many are found; no hit at all is refused keine_anschlaege (422) and nothing is written. '
    + 'Every slice of a cut has a strength 0..1 (the hit at its marker; 0 = no hit there) and a grid distance in beats (to the nearest 1/16 step; 0 = on the grid), both shown by lies and by the answers below. '
    + 'schneiden {id, methode, scheiben?, empfindlichkeit?} = cut the same audio again under the same id (the cut, its generated device and its tracks follow); the patterns keep their slice numbers; answers the route text and then the cut as text. '
    + 'marke {id, art, scheibe?, beat?, einrasten?} = edit one marker of the cut and answer the route text and then the cut as text: art schieben moves the marker where slice scheibe starts to beat (scheibe 4 moves the marker between slices 3 and 4; scheibe 2 is marker 1, so the refusal marke_unbekannt, which counts markers 1..n - 1, names marker k for scheibe k + 1); neu adds a marker at beat and splits the slice there; weg removes the marker where slice scheibe starts and merges it with the slice before. '
    + 'The cut then has methode hand. Moving a marker never changes a pattern; adding or removing one renumbers the patterns of the open module that play this cut in one undo step (a split slice keeps its hits on its first part), modules that are not open keep their numbers; an undo in PRODUCTION reverts the renumbering only, not the marker. '
    + 'Refused: marke_unbekannt (404, no such marker), marke_zu_nah (409, a slice under 4 frames or two markers on one frame), zu_viele_scheiben (409, a cut has 64 slices at most). '
    + 'liste shows the cuts that exist, each with the name of its device (geraet); loeschen {id} = delete that cut together with its tones, and loeschen {ton_graph} = delete only one tone (ton_graph is the graph name of the tone, as the answer of ton names it; graphen lists it as an instrument). Both answer {ok: true}. A cut or tone that a track of the open project, a stored project or a module still plays is refused schnitt_in_gebrauch or ton_in_gebrauch (409) and nothing is deleted: the detail of the refusal lists fundstellen (which project, module or track uses it) and spuren, so remove the track there first and then delete again; ton_unbekannt (404) for a tone that does not exist. '
    + 'ursprung {spur_id} = write the original order again on that track: its first MIDI clip gets one note per slice, in cut order (the old notes of that clip are replaced, one undo step); needs an open workbench module; refused spur_unbekannt (404), kein_schnitt_geraet (409, the track does not play a cut), kein_clip (409). '
    + 'Sample player: dateien {wurzel?, ordner?, suche?} = the sample files of the sample roots (GET /sampler/dateien): without wurzel it lists the roots, {wurzeln: [{name, fehlt?}]}; with wurzel it lists that folder (ordner = a path inside the root, default the root itself), {wurzel, ordner, ordner_liste, ordner_zahl, dateien, instrument?, mehr?}, and instrument is present when the folder reads as a multisample instrument; with suche (words that all occur in the path) it searches below ordner instead, {dateien, mehr?} (at most 300 hits). ordner and suche need wurzel. '
    + 'instrument {wurzel, ordner?, name?, release?, spur?} = INSTRUMENT FROM FILES (POST /sampler/instrument): the audio files of that folder become a playable multisample instrument (a generated sampler device, one zone per file or pitch), answers the text of the instrument and the JSON; release true also builds the release sounds (default false); spur true also puts the instrument on a new NOTE track of the open workbench module (one undo step; kein_projekt, kein_werkbank, werkbank_voll; default false: only the instrument is made). Stop Cypher is refused (409 ki_gestoppt). '
    + 'Refused: argument_ungueltig (400, also locally without a request: spur needs exactly one of id and quelle, lies needs id, neu needs quelle, kit needs id and nummern from 1 and namen of the same length when given, ton needs id and von from 1, bis not before von, grund 16 to 95; schneiden needs id and methode raster or anschlag; marke schieben and weg need scheibe from 2, schieben and neu need beat, weg takes no beat; ursprung needs spur_id; loeschen needs exactly one of id and ton_graph; scheiben only with raster, empfindlichkeit only with anschlag), aktion_unbekannt, schnitt_unbekannt (404), kein_projekt, kein_werkbank, werkbank_voll, ki_gestoppt (Stop Cypher is set: wait for Andreas); the kit refusals klang_zu_lang (400) and kit_vorhanden (409); the ton refusals toene_voll (409) and ton_in_gebrauch (409, also from loeschen); the cut refusals zu_lang, kein_raster, quelle_unbekannt and the rest answer with their reason and an English text.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['quellen', 'liste', 'neu', 'lies', 'spur', 'kit', 'ton', 'schneiden', 'marke', 'ursprung', 'loeschen', 'dateien', 'instrument'] },
      id: { type: 'string', description: 'cut id from neu or liste (lies, spur, kit, ton, schneiden, marke, loeschen)' },
      quelle: { type: 'object', required: ['art', 'ref'], description: 'what to cut (neu, spur): a library loop or the audio of a module',
        properties: { art: { type: 'string', enum: ['loop', 'modul'] }, ref: { type: 'string', description: 'loop name (art loop) or module id (art modul), from quellen' },
          stem: { type: 'string', description: 'art modul only: drums, bass, other, vocals, guitar or piano; absent = the module\'s Loop track' } } },
      name: { type: 'string', description: 'neu, spur with quelle: name of the cut and the track, default the source name; ton: name of the tone (its device graph) and of the NOTE track, default made from the cut and the slices' },
      scheiben: { type: 'integer', enum: [4, 8, 16, 32, 64], description: 'number of slices (neu, spur with quelle); default: the finest grid step with at most 64 slices' },
      nummern: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'kit: the slice numbers from 1 (as in lies) that become the sounds of the kit, at most 92' },
      namen: { type: 'array', items: { type: 'string' }, description: 'kit: one bank per number (bd, sd, hh, cp, perc ...; the bank only, the number follows from the slice order); absent: proposed from the sound' },
      kit: { type: 'string', description: 'kit: the kit name (a-z, 0-9, _ and -, 1 to 32 characters); absent: made from the name of the cut' },
      von: { type: 'integer', minimum: 1, description: 'ton: the first slice, numbered from 1' },
      bis: { type: 'integer', minimum: 1, description: 'ton: the last slice of a run of neighbouring slices (default: von)' },
      grund: { type: 'integer', minimum: 16, maximum: 95, description: 'ton: root note, MIDI 16 to 95 (60 = C3); default: proposed' },
      spur: { type: 'boolean', description: 'ton: also put the tone on a new NOTE track (default true); instrument: also put the instrument on a new NOTE track (default false); this is a flag of the ton action and has nothing to do with the aktion spur (SLICE TO TRACK) or with spur_id' },
      // Sampler A2 task 9
      methode: { type: 'string', enum: ['raster', 'anschlag'], description: 'neu, spur with quelle, schneiden: raster = equal steps of the beat grid, anschlag = one slice per hit found in the audio (the count follows the hits). hand is never given: it is the state of a cut after marker edits' },
      empfindlichkeit: { type: 'number', minimum: 0, maximum: 1, description: 'with methode anschlag only: hit sensitivity 0..1 (default 0.5; higher finds more hits)' },
      art: { type: 'string', enum: ['schieben', 'neu', 'weg'], description: 'marke: schieben = move a marker (scheibe, beat), neu = add a marker (beat), weg = remove a marker (scheibe)' },
      scheibe: { type: 'integer', minimum: 2, description: 'marke schieben and weg: the number (from 1, as in lies) of the slice that starts at the marker, 2 to the slice count; slice 1 starts at 0 and has no marker' },
      beat: { type: 'number', description: 'marke schieben and neu: the position in beats from the start of the cut' },
      einrasten: { type: 'boolean', description: 'marke schieben and neu: snap to the nearest hit or 1/16 step within 1/16 beat (default true)' },
      spur_id: { type: 'string', description: 'ursprung: the id of a track of the open project that plays a cut (from proj_lage)' },
      wurzel: { type: 'string', description: 'dateien, instrument: the name of a sample root (from dateien without wurzel)' },
      ordner: { type: 'string', description: 'dateien, instrument: a folder path inside the root, default the root itself' },
      suche: { type: 'string', description: 'dateien: words that all occur in the path of a file; the search runs below ordner' },
      release: { type: 'boolean', description: 'instrument: also build the release sounds (default false)' },
      ton_graph: { type: 'string', description: 'loeschen: the graph name of the tone to delete (instead of id, which deletes a whole cut); sent to the server as graph' } } },
    // the low-level server does not check the schema: a wrong shape is refused here without a request
    lauf: async (p) => {
      const nein = (text: string) => fehlerAntwort(400, 'argument_ungueltig', text);
      const hat = (k: string) => Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
      if (p.aktion === 'quellen') return http('GET', '/sampler/quellen');
      if (p.aktion === 'liste') return http('GET', '/sampler/liste');
      if (p.aktion === 'kit') {
        // slices from 1 as in lies; the server counts from 0
        if (typeof p.id !== 'string' || p.id === '') return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        const n = p.nummern;
        if (!Array.isArray(n) || n.length === 0 || n.some((x) => typeof x !== 'number' || !Number.isInteger(x) || x < 1)) return nein('nummern must be a non-empty list of slice numbers from 1');
        if (hat('namen') && (!Array.isArray(p.namen) || p.namen.length !== n.length || p.namen.some((x) => typeof x !== 'string'))) {
          return nein('namen must be a list of strings, one bank per number in nummern');
        }
        if (hat('kit') && typeof p.kit !== 'string') return nein('kit must be a string (the kit name)');
        const r = await http('POST', '/sampler/kit', { id: p.id, scheiben: (n as number[]).map((x) => x - 1), ...(hat('namen') ? { banken: p.namen } : {}), ...(hat('kit') ? { kit: p.kit } : {}) });
        if (r.code !== 200 || !Array.isArray(r.j.klaenge)) return r;
        const zeilen = (r.j.klaenge as Json[]).map((k) => `${String(k.name)} = slice ${Number(k.scheibe) + 1} (note ${String(k.note)})`);
        return { ...r, text: `kit ${String(r.j.kit)}: ${zeilen.join(', ')}\n${JSON.stringify(r.j)}` };
      }
      // Sampler A2 task 9: methode, scheiben and empfindlichkeit as the routes take them (the routes refuse the same; this saves the request)
      const optionenFehler = (): { code: number; j: Json } | null => {
        if (hat('methode') && p.methode !== 'raster' && p.methode !== 'anschlag') return nein('methode must be raster or anschlag');
        if (hat('scheiben') && p.methode === 'anschlag') return nein('scheiben: only with methode raster; the hits decide the count');
        if (hat('empfindlichkeit')) {
          if (p.methode !== 'anschlag') return nein('empfindlichkeit: only with methode anschlag');
          if (typeof p.empfindlichkeit !== 'number' || !(p.empfindlichkeit >= 0 && p.empfindlichkeit <= 1)) return nein('empfindlichkeit must be a number from 0 to 1');
        }
        return null;
      };
      // the answer text of a cut change, then the cut as text (the cut text is left out when it cannot be read)
      const mitSchnittText = async (r: { code: number; j: Json }, id: string): Promise<{ code: number; j: Json; text?: string }> => {
        if (r.code !== 200 || typeof r.j.text !== 'string') return r;
        const g = await http('GET', `/sampler/schnitt?id=${encodeURIComponent(id)}&format=text`);
        return { ...r, text: g.code === 200 && typeof g.j.text === 'string' ? `${r.j.text}\n${g.j.text}` : r.j.text };
      };
      if (p.aktion === 'schneiden') {
        if (typeof p.id !== 'string' || p.id === '') return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        if (p.methode !== 'raster' && p.methode !== 'anschlag') return nein('methode must be raster or anschlag');
        if (hat('scheiben') && ![4, 8, 16, 32, 64].includes(p.scheiben as number)) return nein('scheiben must be 4, 8, 16, 32 or 64');
        const f = optionenFehler();
        if (f) return f;
        return mitSchnittText(await http('POST', '/sampler/neu_schneiden', { id: p.id, methode: p.methode, ...(hat('scheiben') ? { scheiben: p.scheiben } : {}), ...(hat('empfindlichkeit') ? { empfindlichkeit: p.empfindlichkeit } : {}) }), p.id);
      }
      if (p.aktion === 'marke') {
        if (typeof p.id !== 'string' || p.id === '') return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        if (p.art !== 'schieben' && p.art !== 'neu' && p.art !== 'weg') return nein('art must be schieben, neu or weg');
        if (hat('einrasten') && typeof p.einrasten !== 'boolean') return nein('einrasten must be true or false');
        if (hat('beat') && (typeof p.beat !== 'number' || !Number.isFinite(p.beat))) return nein('beat must be a number (beats from the start of the cut)');
        if (hat('scheibe') && (typeof p.scheibe !== 'number' || !Number.isInteger(p.scheibe) || p.scheibe < 2)) return nein('scheibe must be an integer from 2 (the number of the slice that starts at the marker, as in lies)');
        if (p.art === 'neu') {
          if (hat('scheibe')) return nein('scheibe: only for schieben and weg; neu takes the position in beat');
          if (!hat('beat')) return nein('neu needs beat (where the new marker goes)');
        } else if (!hat('scheibe')) return nein(`${p.art} needs scheibe (the number of the slice that starts at the marker, from 2)`);
        else if (p.art === 'schieben' && !hat('beat')) return nein('schieben needs beat (where the marker goes)');
        else if (p.art === 'weg' && (hat('beat') || hat('einrasten'))) return nein('weg takes no beat and no einrasten');
        // slices are numbered from 1 in the tool; the server counts the bound index: the marker where slice n starts is bound n - 1
        const k = {
          id: p.id, art: p.art,
          ...(hat('scheibe') ? { marke: (p.scheibe as number) - 1 } : {}),
          ...(hat('beat') ? { beat: p.beat } : {}),
          ...(hat('einrasten') ? { einrasten: p.einrasten } : {}),
        };
        return mitSchnittText(await http('POST', '/sampler/marke', k), p.id);
      }
      if (p.aktion === 'loeschen') {
        // Sampler fix round 3: a cut (with its tones) by id, or one tone by its graph name (the route field is `graph`)
        if (hat('id') === hat('ton_graph')) return nein('loeschen needs exactly one of id (a cut) and ton_graph (a tone)');
        const wer = hat('id') ? p.id : p.ton_graph;
        if (typeof wer !== 'string' || wer === '') return nein(`${hat('id') ? 'id' : 'ton_graph'} must be a non-empty string`);
        const r = await http('POST', hat('id') ? '/sampler/loeschen' : '/sampler/ton/loeschen', hat('id') ? { id: wer } : { graph: wer });
        // the refusal lists where the device is still used: the hand's error form carries `detail`, so the places go there
        if (r.code >= 400 && (Array.isArray(r.j.fundstellen) || Array.isArray(r.j.spuren))) {
          return { code: r.code, j: { fehler: r.j.fehler, text: r.j.text, detail: { fundstellen: r.j.fundstellen, spuren: r.j.spuren } } };
        }
        return r;
      }
      if (p.aktion === 'ursprung') {
        if (typeof p.spur_id !== 'string' || p.spur_id === '') return nein('spur_id must be a non-empty string (the id of a track of the open project)');
        const r = await http('POST', '/sampler/ursprung', { spur_id: p.spur_id });
        return r.code === 200 && typeof r.j.text === 'string' ? { ...r, text: r.j.text } : r;
      }
      // sample player: the file list and the instrument of a folder. Fields that belong to no call of the action are refused, not dropped
      const fremdFelder = (erlaubt: string[]): { code: number; j: Json } | null => {
        const f = Object.keys(p).filter((k) => p[k] !== undefined && k !== 'aktion' && !erlaubt.includes(k));
        return f.length > 0 ? nein(`${f.join(', ')}: not a field of ${String(p.aktion)} (it takes ${erlaubt.join(', ')})`) : null;
      };
      const textOk = (k: string): boolean => !hat(k) || (typeof p[k] === 'string' && (p[k] as string).trim() !== '');
      if (p.aktion === 'dateien') {
        const f = fremdFelder(['wurzel', 'ordner', 'suche']);
        if (f) return f;
        if (!textOk('wurzel') || !textOk('suche') || (hat('ordner') && typeof p.ordner !== 'string')) return nein('wurzel and suche must be non-empty strings, ordner a string (a folder path inside the root)');
        if (!hat('wurzel') && (hat('ordner') || hat('suche'))) return nein('ordner and suche need wurzel (the name of a sample root, from dateien without wurzel)');
        const q = [...(hat('wurzel') ? [`wurzel=${encodeURIComponent(p.wurzel as string)}`] : []), ...(hat('ordner') ? [`ordner=${encodeURIComponent(p.ordner as string)}`] : []),
          ...(hat('suche') ? [`suche=${encodeURIComponent(p.suche as string)}`] : [])];
        return http('GET', `/sampler/dateien${q.length > 0 ? `?${q.join('&')}` : ''}`);
      }
      if (p.aktion === 'instrument') {
        const f = fremdFelder(['wurzel', 'ordner', 'name', 'release', 'spur']);
        if (f) return f;
        if (typeof p.wurzel !== 'string' || p.wurzel === '') return nein('wurzel must be a non-empty string (the name of a sample root, from dateien without wurzel)');
        if (hat('ordner') && typeof p.ordner !== 'string') return nein('ordner must be a string (a folder path inside the root)');
        if (!textOk('name')) return nein('name must be a non-empty string');
        if (hat('release') && typeof p.release !== 'boolean') return nein('release must be true or false');
        if (hat('spur') && typeof p.spur !== 'boolean') return nein('spur must be true or false');
        const r = await http('POST', '/sampler/instrument', { wurzel: p.wurzel, ...(hat('ordner') ? { ordner: p.ordner } : {}), ...(hat('name') ? { name: p.name } : {}),
          ...(hat('release') ? { release: p.release } : {}), ...(hat('spur') ? { spur: p.spur } : {}) });
        return r.code === 200 && typeof r.j.text === 'string' ? { ...r, text: r.j.text } : r;
      }
      if (p.aktion !== 'neu' && p.aktion !== 'lies' && p.aktion !== 'spur' && p.aktion !== 'ton') return fehlerAntwort(400, 'aktion_unbekannt', 'aktion is one of quellen, liste, neu, lies, spur, kit, ton, schneiden, marke, ursprung, loeschen, dateien, instrument');
      const idOk = (): boolean => typeof p.id === 'string' && p.id !== '';
      if (p.aktion === 'lies') {
        if (!idOk()) return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        const r = await http('GET', `/sampler/schnitt?id=${encodeURIComponent(p.id as string)}&format=text`);
        return r.code === 200 && typeof r.j.text === 'string' ? { ...r, text: r.j.text } : r;
      }
      if (p.aktion === 'ton') {   // plan C: slice numbers from 1 here, 0-based on the page server
        const ganz = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
        const fremd = Object.keys(p).filter((k) => p[k] !== undefined && !['aktion', 'id', 'von', 'bis', 'grund', 'name', 'spur'].includes(k));
        if (fremd.length > 0) return nein(`${fremd.join(', ')}: not a field of ton (ton takes id, von, bis, grund, name and spur)`);
        if (!idOk()) return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
        if (!ganz(p.von) || p.von < 1) return nein('von must be a whole number from 1 (the first slice, numbered from 1)');
        if (hat('bis') && (!ganz(p.bis) || p.bis < p.von)) return nein('bis must be a whole number, not before von (the last slice of the run)');
        if (hat('grund') && (!ganz(p.grund) || p.grund < 16 || p.grund > 95)) return nein('grund must be a whole number 16 to 95 (a MIDI note, 60 = C3)');
        if (hat('name') && (typeof p.name !== 'string' || p.name.trim() === '')) return nein('name must be a non-empty string');
        if (hat('spur') && typeof p.spur !== 'boolean') return nein('spur must be true or false');
        const r = await http('POST', '/sampler/ton', { id: p.id, von: p.von - 1, ...(hat('bis') ? { bis: (p.bis as number) - 1 } : {}),
          ...(hat('grund') ? { grund: p.grund } : {}), ...(hat('name') ? { name: p.name } : {}), spur: hat('spur') ? p.spur : true });
        return r.code === 200 && typeof r.j.text === 'string' ? { ...r, text: r.j.text } : r;
      }
      // neu and spur: the optional name and scheiben, and the source when a cut is made
      if (hat('name') && typeof p.name !== 'string') return nein('name must be a string');
      if (hat('scheiben') && ![4, 8, 16, 32, 64].includes(p.scheiben as number)) return nein('scheiben must be 4, 8, 16, 32 or 64');
      const of = optionenFehler();
      if (of) return of;
      const mitId = p.aktion === 'spur' && hat('id');
      if (p.aktion === 'spur') {
        if (hat('id') && hat('quelle')) return nein('give id (a cut that exists) or quelle (a cut to make), not both');
        if (!hat('id') && !hat('quelle')) return nein('give id (a cut from neu or liste) or quelle (a cut to make)');
        if (mitId) {
          if (!idOk()) return nein('id must be a non-empty string (the id of a cut, from neu or liste)');
          if (hat('name') || hat('scheiben') || hat('methode') || hat('empfindlichkeit')) return nein('name, scheiben, methode and empfindlichkeit belong to a new cut: leave them out with id');
          return http('POST', '/sampler/spur', { id: p.id });
        }
      }
      const q = p.quelle as Json | undefined;
      if (!isObj(q)) return nein('quelle must be an object {art: loop | modul, ref, stem?}');
      if (q.art !== 'loop' && q.art !== 'modul') return nein('quelle.art must be loop or modul');
      if (typeof q.ref !== 'string' || q.ref === '') return nein('quelle.ref must be a non-empty string (a loop name or a module id from quellen)');
      if (q.stem !== undefined && typeof q.stem !== 'string') return nein('quelle.stem must be a string (drums, bass, other, vocals, guitar or piano)');
      const koerper = { quelle: q, ...(hat('name') ? { name: p.name } : {}), ...(hat('scheiben') ? { scheiben: p.scheiben } : {}),
        ...(hat('methode') ? { methode: p.methode } : {}), ...(hat('empfindlichkeit') ? { empfindlichkeit: p.empfindlichkeit } : {}) };
      return http('POST', p.aktion === 'neu' ? '/sampler/schnitt' : '/sampler/spur', koerper);
    } },
  // Kraken patch field task 5: the pin matrix of a Baukasten track (block `matrix`, 16 x 16, two sets A/B). Shapes of the page server: GET /proj/steckfeld, project commands geraet_stift_setzen / geraet_stifte_setzen.
  { name: 'steckfeld', description: 'Patch field (pin matrix) of a Baukasten track whose graph has a matrix block: a 16 x 16 field of 16 rows (sources) and 16 columns (destinations), two sets A and B (the instrument morphs between them), '
    + 'a pin is a weight -1..1 from one row to one column, 0 = no pin. Rows and columns have labels from the graph; the labels come from zeige. '
    + 'aktion zeige {spur_id} = both sets as lines "A  VCO 1 > Cutoff  +0.40" (set, row > column, weight), the row and column labels, and whether the track still has the graph\'s default pins or its own. '
    + 'setze {spur_id, zeile, spalte, wert, satz?} = put a pin (geraet_stift_setzen; sounds at once while a note plays, one undo step per drag of the same pin). loesche {spur_id, zeile, spalte, satz?} = remove one pin (wert 0). '
    + 'leere {spur_id, satz?} = remove every pin of one set. kopiere {spur_id} = replace set B by a copy of set A. '
    + 'zeile and spalte: a label (case-insensitive, exact, from zeige) or an index 1..16 (a number, or a string of digits); satz is A or B (default A); wert -1..1. '
    + 'A track that has no pins of its own gets the graph defaults written into its list first, so the first setze keeps them. Answers of the writes: {rev, ...} of proj_aendern. '
    + 'Refused locally without a write request: argument_ungueltig (unknown or ambiguous label, index outside 1..16, wert outside -1..1, bad satz, missing argument). '
    + 'Refused by the server: spur_unbekannt, geraet_falsch (not a Baukasten track), kein_steckfeld (the graph has no matrix), kein_projekt, rev_veraltet, ki_gestoppt (Stop Cypher).',
    inputSchema: { type: 'object', required: ['aktion', 'spur_id'], properties: {
      aktion: { type: 'string', enum: ['zeige', 'setze', 'loesche', 'leere', 'kopiere'] },
      spur_id: { type: 'string', description: 'the id of the Baukasten track (from proj_lage)' },
      zeile: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 1, maximum: 16 }], description: 'setze, loesche: the row (source), a label from zeige or an index 1..16' },
      spalte: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 1, maximum: 16 }], description: 'setze, loesche: the column (destination), a label from zeige or an index 1..16' },
      wert: zahl('setze: the weight of the pin, -1..1 (0 removes it)', { minimum: -1, maximum: 1 }),
      satz: { type: 'string', enum: ['A', 'B'], description: 'setze, loesche, leere: the set, default A' },
      rev: { type: 'integer', minimum: 0, description: 'writes: the project revision to build on (default: the current one)' } } },
    // the low-level server does not check the schema: a wrong shape is refused here without a write request
    lauf: async (p) => {
      const nein = (text: string) => fehlerAntwort(400, 'argument_ungueltig', text);
      const aktion = p.aktion;
      if (aktion !== 'zeige' && aktion !== 'setze' && aktion !== 'loesche' && aktion !== 'leere' && aktion !== 'kopiere') return nein('aktion is one of zeige, setze, loesche, leere, kopiere');
      if (typeof p.spur_id !== 'string' || p.spur_id === '') return nein('spur_id must be a non-empty string (the id of a Baukasten track)');
      if (p.satz !== undefined && p.satz !== 'A' && p.satz !== 'B') return nein('satz must be A or B');
      const satz = p.satz === 'B' ? 1 : 0;
      const holen = (): Promise<{ code: number; j: Json }> => http('GET', `/proj/steckfeld?spur_id=${encodeURIComponent(p.spur_id as string)}`);
      const schreibe = (label: string, befehl: Json) => mitRev(p, '/proj/aendern', { label, befehle: [befehl] });
      const SATZ = ['A', 'B'];
      const bez = (l: unknown, i: number, was: string): string => (Array.isArray(l) && typeof l[i] === 'string' && l[i] !== '' ? (l[i] as string) : `${was} ${i + 1}`);
      if (aktion === 'zeige') {
        const r = await holen();
        if (r.code !== 200) return r;
        const j = r.j;
        const stifte = (Array.isArray(j.stifte) ? j.stifte : []) as number[][];
        const zeilen = Array.isArray(j.zeilen) ? j.zeilen : [], spalten = Array.isArray(j.spalten) ? j.spalten : [];
        const kopf = `Patch field of ${String(j.spur_id)} (graph ${String(j.graph)}, rev ${String(j.rev)}): ${j.eigene === false ? 'graph defaults, no pins of its own yet' : 'own pins'}`;
        const zeilenText: string[] = [];
        for (let s = 0; s < 2; ++s) {
          const dieser = stifte.filter((x) => x[0] === s);
          if (dieser.length === 0) { zeilenText.push(`${SATZ[s]}  (no pins)`); continue; }
          for (const [, z, sp, w] of dieser) zeilenText.push(`${SATZ[s]}  ${bez(zeilen, z, 'row')} > ${bez(spalten, sp, 'column')}  ${w >= 0 ? '+' : '-'}${Math.abs(w).toFixed(2)}`);
        }
        const namen = (l: unknown[], was: string) => l.map((_, i) => bez(l, i, was)).join(', ');
        return { code: 200, j, text: [kopf, ...zeilenText, `Rows: ${namen(zeilen, 'row')}`, `Columns: ${namen(spalten, 'column')}`].join('\n') };
      }
      if (aktion === 'leere') return schreibe(`Patch field: clear set ${SATZ[satz]}`, { befehl: 'geraet_stifte_setzen', spur_id: p.spur_id, satz, stifte: [] });
      if (aktion === 'kopiere') {
        const r = await holen();
        if (r.code !== 200) return r;
        const a = ((Array.isArray(r.j.stifte) ? r.j.stifte : []) as number[][]).filter((x) => x[0] === 0).map((x) => [1, x[1], x[2], x[3]]);
        return schreibe('Patch field: copy set A to B', { befehl: 'geraet_stifte_setzen', spur_id: p.spur_id, satz: 1, stifte: a });
      }
      // setze, loesche: arguments first (no request on a bad one), then the labels (one read), then the write
      if (aktion === 'setze' && (typeof p.wert !== 'number' || !Number.isFinite(p.wert) || p.wert < -1 || p.wert > 1)) return nein('setze needs wert, a number from -1 to 1');
      const wert = aktion === 'loesche' ? 0 : (p.wert as number);
      const index = (v: unknown): number | null | undefined => {      // 0-based; null = not an index form, undefined = refused
        if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 16 ? v - 1 : undefined;
        if (typeof v === 'string' && /^[0-9]+$/.test(v)) { const n = Number(v); return n >= 1 && n <= 16 ? n - 1 : undefined; }
        return typeof v === 'string' && v !== '' ? null : undefined;
      };
      const z0 = index(p.zeile), s0 = index(p.spalte);
      if (z0 === undefined) return nein('zeile must be a label from zeige or an index 1..16');
      if (s0 === undefined) return nein('spalte must be a label from zeige or an index 1..16');
      let zeile = z0, spalte = s0;
      if (zeile === null || spalte === null) {
        const r = await holen();
        if (r.code !== 200) return r;
        const finde = (v: unknown, liste: unknown, was: string): number | { fehler: string } => {
          const gesucht = String(v).toLowerCase();
          const treffer = (Array.isArray(liste) ? liste : []).map((l, i) => [String(l).toLowerCase(), i] as const).filter(([l]) => l === gesucht).map(([, i]) => i);
          if (treffer.length === 0) return { fehler: `${was} "${String(v)}" is not a label of this field; zeige lists them` };
          if (treffer.length > 1) return { fehler: `${was} "${String(v)}" is ambiguous (indices ${treffer.map((i) => i + 1).join(', ')}); use an index 1..16` };
          return treffer[0];
        };
        if (zeile === null) { const f = finde(p.zeile, r.j.zeilen, 'zeile'); if (typeof f !== 'number') return nein(f.fehler); zeile = f; }
        if (spalte === null) { const f = finde(p.spalte, r.j.spalten, 'spalte'); if (typeof f !== 'number') return nein(f.fehler); spalte = f; }
      }
      return schreibe(`Patch field: ${aktion === 'loesche' ? 'remove' : 'set'} pin ${SATZ[satz]} ${zeile + 1}/${spalte + 1}`, { befehl: 'geraet_stift_setzen', spur_id: p.spur_id, satz, zeile, spalte, wert });
    } },
  // plan 7: tags
  { name: 'tags', description: 'Tags of items (files, presets, kits, devices, projects, takes, exports, loops) are full <art>:<wort> strings taken from aktion vokabular (typ:kick, charakter:dark, tempo:128, frei:favorites); a tag set by a user or by me beats a measured one, and a removal (an false) survives every re-measurement. '
    + 'aktion lesen {item}: the effective tags of one item with their origin; setzen {items, tags, an}: add (an true, the default) or remove up to 500 items x 20 tags in one call, all or nothing; suchen {tags?, text?, art?}: items that carry every tag and whose name or tag words contain every word of text, art narrows to loop, oneshot, track, midi, preset, kit, ...; vokabular; gespeichert: the saved searches, each with its live count (anzahl null and frisch false: not counted yet or out of date, ask again); merken {name, tags?, text?, art?}: save a search; vergessen {name}. A refusal is {ok: false, grund, text}.',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      aktion: { type: 'string', enum: ['lesen', 'setzen', 'suchen', 'vokabular', 'gespeichert', 'merken', 'vergessen'] },
      item: { type: 'string', description: 'item id, e.g. datei:<sha256>, preset:werk:surge/pad, kit:<name>, loop:<name>' },
      items: { type: 'array', items: { type: 'string' }, description: 'setzen: up to 500 item ids' },
      tags: { type: 'array', items: { type: 'string' }, description: 'full <art>:<wort> tags' },
      an: { type: 'boolean', description: 'setzen: true adds (default), false removes' },
      text: { type: 'string', description: 'suchen, merken: words matched against names and tag words' },
      art: { type: 'string', description: 'suchen, merken: item kind such as loop, oneshot, track, midi, preset, kit' },
      name: { type: 'string', description: 'merken, vergessen: name of the saved search (1 to 40 characters)' } } },
    lauf: async (p) => {
      const nein = (text: string) => ({ code: 400, j: { fehler: 'argument_ungueltig', text }, roh: JSON.stringify({ ok: false, grund: 'argument_ungueltig', text }) });
      const tagListe = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null);
      const mitGrund = (r: { code: number; j: Json }): { code: number; j: Json; roh?: string } => {
        if (r.code >= 400 && r.j.grund !== undefined) return { ...r, roh: JSON.stringify({ ok: false, grund: r.j.grund, text: r.j.text, ...(r.j.betroffen !== undefined ? { betroffen: r.j.betroffen } : {}) }) };
        return r;
      };
      switch (p.aktion) {
        case 'lesen':
          return typeof p.item === 'string' && p.item !== '' ? mitGrund(await http('GET', `/tags?item=${encodeURIComponent(p.item)}`)) : nein('lesen needs item');
        case 'setzen': {
          const items = tagListe(p.items), tags = tagListe(p.tags);
          if (!items || items.length === 0) return nein('setzen needs items: a non-empty list of item ids');
          if (!tags || tags.length === 0) return nein('setzen needs tags: a non-empty list of <art>:<wort> strings');
          if (p.an !== undefined && typeof p.an !== 'boolean') return nein('an must be true or false');
          return mitGrund(await http('POST', '/tags/setzen', { items, tags, an: p.an ?? true }));
        }
        case 'suchen': {
          const tags = p.tags === undefined ? [] : tagListe(p.tags);
          if (!tags) return nein('tags must be a list of <art>:<wort> strings');
          const q: string[] = [];
          if (tags.length > 0) q.push(`tags=${tags.map(encodeURIComponent).join(',')}`);
          if (typeof p.text === 'string' && p.text !== '') q.push(`text=${encodeURIComponent(p.text)}`);
          if (typeof p.art === 'string' && p.art !== '') q.push(`art=${encodeURIComponent(p.art)}`);
          return mitGrund(await http('GET', `/tags/suche${q.length ? `?${q.join('&')}` : ''}`));
        }
        case 'vokabular': return http('GET', '/tags/vokabular');
        case 'gespeichert': return http('GET', '/tags/gespeichert');
        case 'merken': {
          if (typeof p.name !== 'string' || p.name.trim() === '') return nein('merken needs name');
          const tags = p.tags === undefined ? [] : tagListe(p.tags);
          if (!tags) return nein('tags must be a list of <art>:<wort> strings');
          return mitGrund(await http('POST', '/tags/gespeichert', { name: p.name, tags, text: typeof p.text === 'string' ? p.text : '', ...(typeof p.art === 'string' ? { art: p.art } : {}) }));
        }
        case 'vergessen':
          return typeof p.name === 'string' && p.name.trim() !== '' ? mitGrund(await http('POST', '/tags/gespeichert/weg', { name: p.name })) : nein('vergessen needs name');
        default: return nein(`unknown aktion ${String(p.aktion)}: lesen, setzen, suchen, vokabular, gespeichert, merken or vergessen`);
      }
    } },
  { name: 'verwandt', description: 'Related items of one item: gemacht_aus (what it was made from), steckt_in (where it is used), passt_zu (same kind, neighbouring key and tempo within 6 percent, computed on read), aehnlich (nearest by sound), daraus (items made from it), enthaelt (items used in it). Empty lists mean nothing is known, not that nothing exists.',
    inputSchema: { type: 'object', required: ['item'], properties: { item: { type: 'string', description: 'item id, e.g. datei:<sha256>, loop:<name>, kit:<name>, projekt:<slug>' } } },
    lauf: async (p) => {
      if (typeof p.item !== 'string' || p.item === '') return { code: 400, j: { fehler: 'argument_ungueltig', text: 'verwandt needs item' }, roh: JSON.stringify({ ok: false, grund: 'argument_ungueltig', text: 'verwandt needs item' }) };
      const r = await http('GET', `/tags/verwandt?item=${encodeURIComponent(p.item)}`);
      return r.code >= 400 && r.j.grund !== undefined ? { ...r, roh: JSON.stringify({ ok: false, grund: r.j.grund, text: r.j.text, ...(r.j.betroffen !== undefined ? { betroffen: r.j.betroffen } : {}) }) } : r;
    } },
  // browser plan 1 task 9: import a file by path, and drive the sample catalogue
  { name: 'import_datei',
    description: 'Imports a file from this machine by path. Audio lands in the import folder and is catalogued by itself; ziel auto decides by type, bibliothek forces the library, projekt forces the project. Only the allowed folders are accepted; anything else is refused with pfad_ausserhalb.',
    inputSchema: { type: 'object', properties: {
      pfad: { type: 'string', description: 'Absolute path of the file on this machine.' },
      ziel: { type: 'string', enum: ['auto', 'bibliothek', 'projekt'], description: 'Where it goes; default auto.' } }, required: ['pfad'] },
    lauf: (p) => httpGrund('POST', '/import/pfad', { pfad: p.pfad, ziel: p.ziel ?? 'auto' }) },
  { name: 'bibliothek_bauen',
    description: 'The sample catalogue. aktion bauen (default) starts a build and returns at once; stand shows the build state; quellen lists the registered folders; dazu registers a folder (needs pfad, optional typ auto, track, loop or oneshot).',
    inputSchema: { type: 'object', properties: {
      aktion: { type: 'string', enum: ['bauen', 'stand', 'quellen', 'dazu'], description: 'Default bauen.' },
      pfad: { type: 'string', description: 'Folder to register (aktion dazu).' },
      typ: { type: 'string', enum: ['auto', 'track', 'loop', 'oneshot'], description: 'Kind of the folder (aktion dazu); default auto.' } } },
    lauf: (p) => {
      const aktion = p.aktion ?? 'bauen';
      if (aktion === 'stand') return httpGrund('GET', '/bibliothek/stand');
      if (aktion === 'quellen') return httpGrund('GET', '/bibliothek/quellen');
      if (aktion === 'dazu') {
        if (typeof p.pfad !== 'string' || p.pfad === '') return fehlerAntwort(400, 'argument_ungueltig', 'aktion dazu needs pfad (the folder to register)');
        return httpGrund('POST', '/bibliothek/quellen/dazu', { pfad: p.pfad, typ: p.typ ?? 'auto' });
      }
      return httpGrund('POST', '/bibliothek/bauen');
    } },
  { name: 'preset_vorhoeren', description: 'Play a short preview of one preset on Andreas\' headphone preview. id is the register id <werk|nutzer>:<geraet>/<slug> as presets_suchen returns it. The page server renders the preview (first call, cached after that) and plays it on the headphones; I get no audio and no measurement back, so this is for Andreas to listen, not for me to judge. Answer {ok, aus_cache}. kein_kopfhoerer means no headphone edge is running, nobody is listening. A hall or other effect without a preview, an unknown id or a silent render comes back as a refusal with a reason. Whether a preset sounds good is Andreas\' call.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'register id, e.g. werk:komp/drum-bus or nutzer:rb338/my-bass' } } },
    lauf: async (p) => {
      if (typeof p.id !== 'string' || p.id === '') return fehlerAntwort(400, 'argument_fehlt', 'id is required: a preset register id like werk:komp/drum-bus');
      return httpGrund('POST', '/presets/vorhoeren', { id: p.id });
    } },
];

// Paket 1.13 Slice 6 (D1): proj_stems startet und fragt /proj/aktuell?noten=zahl ab, bis der Lauf endet oder die Frist abläuft; danach laeuft mit auftrag_id,
// der Lauf geht auf dem Server weiter (kein Abbruch). Frist: FRIST_VORGABE_MS.proj_stems (20 min,
// Begründung in FRIST_GRUND), Umgebung DJK_HAND_FRIST_PROJ_STEMS_MS.
// Nachbesserung T9: der Server bindet `stems` an das offene Projekt (session.ts); nach Wechsel oder Schließen fehlt das Feld. Fehlt der EIGENE Lauf in
// mindestens STEMS_FEHLT_N Abfragen in Folge UND STEMS_FEHLT_MS lang (flüchtiges Fehlen bleibt erlaubt), endet das Werkzeug mit `unbekannt`; eine Antwort
// ≠ 200 beendet sofort mit `unbekannt` und ihrem detail. Fremde Stände (andere auftrag_id) gelten als „eigener Lauf fehlt“.
const STEMS_FEHLT_N = 3;
const STEMS_FEHLT_MS = (): number => { const v = Number(process.env.DJK_HAND_STEMS_FEHLT_MS); return Number.isFinite(v) && v >= 0 ? v : 2000; };
const STEMS_UNBEKANNT = 'project changed or closed, the run was cancelled or its result is not visible here; check proj_lage';
async function projStems(p: Json): Promise<{ code: number; j: Json }> {
  const koerper: Json = {};
  for (const k of ['clip_id', 'spur_id', 'von_beat', 'bis_beat', 'geraet']) if (p[k] !== undefined) koerper[k] = p[k];
  const s = await http('POST', '/proj/stems', koerper);
  if (s.code !== 200) return s;
  const id = (s.j as { auftrag_id: number }).auftrag_id;
  const frist = fristVon('proj_stems');
  const t0 = Date.now();
  let fehltSeit = 0, fehlt = 0;
  for (;;) {
    const a = await http('GET', '/proj/aktuell?noten=zahl');
    if (a.code !== 200) {
      const d = [a.j.fehler, a.j.text, a.j.detail].filter((x) => typeof x === 'string').join(': ');
      return { code: 200, j: { auftrag_id: id, zustand: 'unbekannt', text: STEMS_UNBEKANNT, detail: `/proj/aktuell answered ${a.code}${d ? ` (${d})` : ''}` } };
    }
    const st = (a.j as { stems?: Json }).stems as (Json & { auftrag_id?: number; zustand?: string }) | undefined;
    const eigen = st && st.auftrag_id === id;
    if (eigen && st.zustand !== 'laeuft') return { code: 200, j: st };
    if (eigen) { fehlt = 0; } else {
      if (fehlt === 0) fehltSeit = Date.now();
      fehlt++;
      if (fehlt >= STEMS_FEHLT_N && Date.now() - fehltSeit >= STEMS_FEHLT_MS()) {
        return { code: 200, j: { auftrag_id: id, zustand: 'unbekannt', text: STEMS_UNBEKANNT } };
      }
    }
    if (Date.now() - t0 >= frist) {
      return { code: 200, j: { ...(eigen ? st : {}), auftrag_id: id, zustand: 'laeuft', text: `still running after ${Math.round(frist / 1000)} s (tool limit, `
        + 'DJK_HAND_FRIST_PROJ_STEMS_MS); the run goes on: call proj_lage later (field stems) or proj_stems_abbrechen' } };
    }
    await new Promise((r) => setTimeout(r, Math.min(2000, Math.max(50, frist / 8))));
  }
}

// Note editor B5: proj_noten. Without flags GET /proj/noten; erkennen posts the run, then reads /proj/aktuell every second (the field `noten` of the run's auftrag_id)
// until it ends or the deadline passes (laeuft with auftrag_id, the run goes on); abbrechen posts the auftrag_id. A run whose own state vanishes (project closed or
// switched) ends with unbekannt like proj_stems (same thresholds).
const NOTEN_UNBEKANNT = 'project changed or closed, the run was cancelled or its state is not visible here; read the clip with proj_noten (analyse) or proj_lage';
const ungueltigNoten = (text: string): { code: number; j: Json } => ({ code: 400, j: { fehler: 'argument_ungueltig', text } });
async function projNoten(p: Json): Promise<{ code: number; j: Json }> {
  const clip = p.clip_id;
  if (p.abbrechen !== undefined) {
    if (p.erkennen === true || p.neu !== undefined || clip !== undefined) return ungueltigNoten('abbrechen stands alone: give only the auftrag_id');
    if (!Number.isInteger(p.abbrechen) || (p.abbrechen as number) < 1) return ungueltigNoten('abbrechen: the auftrag_id (integer, 1 or more) is required');
    return http('POST', '/proj/noten/abbrechen', { auftrag_id: p.abbrechen });
  }
  if (typeof clip !== 'string' || clip === '') return ungueltigNoten('clip_id: a clip id is required');
  if (p.neu !== undefined && p.erkennen !== true) return ungueltigNoten('neu: only with erkennen: true');
  const lesen = (): Promise<{ code: number; j: Json }> => http('GET', `/proj/noten?clip_id=${encodeURIComponent(clip)}`);
  if (p.erkennen !== true) return lesen();
  const s = await http('POST', '/proj/noten/erkennen', p.neu === true ? { clip_id: clip, neu: true } : { clip_id: clip });
  if (s.code !== 200) {
    // antwort() keeps fehler, text and detail only: the id of the running job (noten_laeuft) goes into detail
    if (s.j.fehler === 'noten_laeuft' && typeof s.j.auftrag_id === 'number' && s.j.detail === undefined) s.j = { ...s.j, detail: `auftrag_id ${s.j.auftrag_id}` };
    return s;
  }
  const id = (s.j as { auftrag_id: number }).auftrag_id;
  const frist = fristVon('proj_noten');
  const t0 = Date.now();
  let fehltSeit = 0, fehlt = 0;
  for (;;) {
    const a = await http('GET', '/proj/aktuell?noten=zahl');
    if (a.code !== 200) {
      const d = [a.j.fehler, a.j.text, a.j.detail].filter((x) => typeof x === 'string').join(': ');
      return { code: 200, j: { auftrag_id: id, zustand: 'unbekannt', text: NOTEN_UNBEKANNT, detail: `/proj/aktuell answered ${a.code}${d ? ` (${d})` : ''}` } };
    }
    const st = (a.j as { noten?: Json }).noten as (Json & { auftrag_id?: number; zustand?: string }) | undefined;
    const eigen = !!st && st.auftrag_id === id;
    if (eigen && st.zustand !== 'laeuft') {
      if (st.zustand !== 'fertig') return { code: 200, j: st };
      const g = await lesen();
      return g.code === 200 ? { code: 200, j: { ...g.j, analyse: st } } : g;
    }
    if (eigen) { fehlt = 0; } else {
      if (fehlt === 0) fehltSeit = Date.now();
      fehlt++;
      if (fehlt >= STEMS_FEHLT_N && Date.now() - fehltSeit >= STEMS_FEHLT_MS()) return { code: 200, j: { auftrag_id: id, zustand: 'unbekannt', text: NOTEN_UNBEKANNT } };
    }
    if (Date.now() - t0 >= frist) {
      return { code: 200, j: { ...(eigen ? st : {}), auftrag_id: id, zustand: 'laeuft', text: `still running after ${Math.round(frist / 1000)} s (tool limit, `
        + 'DJK_HAND_FRIST_PROJ_NOTEN_MS); the run goes on: read the clip with proj_noten later (field analyse) or cancel it with abbrechen' } };
    }
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(50, frist / 8))));
  }
}

// Baukasten S15: proj_strom_aufnehmen. All reads first (a refusal changes nothing), then graph, pattern, track, arm, a bar wait, the recording
// and its stop (always sent once the recording started), the clip lookup (the stopp answer has no clip id: the take file name finds it) and the
// provenance on the clip. A tool error after the first write carries detail.getan.
const STROM_POLL_MS = (): number => { const v = Number(process.env.DJK_HAND_STROM_POLL_MS); return Number.isFinite(v) && v > 0 ? v : 100; };
const GRAPH_NAME = /^[a-z0-9_-]{1,32}$/;
const CODE_MAX = 20000;
interface SpurSicht { id: string; nr: number; name: string; art: string; clips?: { id: string; start_beat: number; laenge_beats: number; quelle?: { pfad_hinweis?: string } }[];
  aufnahme?: { scharf?: boolean; eingang?: { name?: string } | null } }
const fehlerAntwort = (code: number, fehler: string, text: string, detail?: unknown): { code: number; j: Json } => ({ code, j: { fehler, text, ...(detail === undefined ? {} : { detail }) } });
async function stromAufnehmen(p: Json): Promise<{ code: number; j: Json }> {
  const bad = (f: string, t: string) => fehlerAntwort(400, f, t);
  const strom = p.strom, takte = p.takte, graph = p.graph, code = p.code, spurArg = p.spur, vonBeat = p.von_beat === undefined ? 0 : p.von_beat;
  if (strom !== 2 && strom !== 3) return bad('strom', 'strom must be 2 (bass, erz/2) or 3 (melody, erz/3)');
  if (typeof takte !== 'number' || !Number.isInteger(takte) || takte < 1 || takte > 64) return bad('takte', 'takte must be a whole number 1..64');
  if (typeof graph !== 'string' || !GRAPH_NAME.test(graph)) return bad('graph', 'graph must be a graph name (a-z 0-9 _ -, 1..32), see graphen');
  if (typeof code !== 'string' || code.length < 1) return bad('code', 'code must be a non-empty Strudel pattern');
  if (code.length > CODE_MAX) return bad('code_zu_lang', `code has ${code.length} characters, at most ${CODE_MAX}`);
  if (typeof spurArg !== 'string' || spurArg.length < 1 || spurArg.length > 80) return bad('spur', 'spur must be an audio track id or name (1..80 characters)');
  if (typeof vonBeat !== 'number' || !Number.isFinite(vonBeat) || vonBeat < 0) return bad('von_beat', 'von_beat must be a number >= 0');
  const kanal = `erz/${strom}`, eingang = { art: 'intern', name: kanal };

  // 1. reads, no write
  const lage = await http('GET', '/lage');
  if (lage.code >= 400) return lage;
  const l = lage.j as { ki?: { gestoppt?: boolean }; studio?: { stroeme?: { autonom?: boolean }[] } };
  if (l.ki?.gestoppt) return fehlerAntwort(409, 'ki_gestoppt', 'Stop Cypher is set');
  if (l.studio?.stroeme?.[strom - 1]?.autonom === false) return fehlerAntwort(409, 'auto_aus', `AUTO of stream ${strom} is off: Andreas holds this stream`);
  const akt = await http('GET', '/proj/aktuell?noten=zahl');
  if (akt.code >= 400) return akt;
  const projekt0 = (akt.j as { projekt?: { spuren?: SpurSicht[] } | null }).projekt;
  if (!projekt0) return fehlerAntwort(409, 'kein_projekt', 'open or create a project first (proj_oeffnen, proj_neu)');
  const gr = await http('GET', '/graphen');
  if (gr.code >= 400) return gr;
  const g = ((gr.j as { graphen?: { name: string; art: string }[] }).graphen ?? []).find((x) => x.name === graph);
  if (!g) return fehlerAntwort(404, 'unbekannt', `no graph named ${graph}: see graphen`);
  if (g.art !== 'instrument') return fehlerAntwort(400, 'falsche_art', `${graph} is an ${g.art} graph: only instrument graphs go on a stream`);
  const auf = await http('GET', '/proj/aufnahme');
  if (auf.code >= 400) return auf;
  if ((auf.j as { lauf?: unknown }).lauf) return fehlerAntwort(409, 'aufnahme_laeuft', 'a recording is already running');
  const spuren0 = projekt0.spuren ?? [];
  const vorhanden = spuren0.find((s) => s.id === spurArg) ?? spuren0.find((s) => s.name === spurArg);
  if (vorhanden && vorhanden.art !== 'audio') return fehlerAntwort(400, 'falsche_art', `track ${vorhanden.id} (${vorhanden.name}) is an instrument track: a take needs an audio track`);
  const andere = spuren0.filter((s) => s !== vorhanden && s.art === 'audio' && s.aufnahme?.scharf);
  if (andere.length) {
    return fehlerAntwort(409, 'andere_scharf', `other tracks are armed (${andere.map((s) => s.id).join(', ')}): they would be recorded too and get their clips replaced; `
      + 'disarm them with proj_aendern spur_aendern arm false');
  }
  const belegt = (vorhanden?.clips ?? []).filter((k) => k.start_beat < vonBeat + 4 * takte + 1 && k.start_beat + k.laenge_beats > vonBeat);
  if (belegt.length) {
    return fehlerAntwort(409, 'spur_belegt', `track ${vorhanden!.id} has clips in the recorded range (${belegt.map((k) => k.id).join(', ')}): the recording would replace them; `
      + 'choose another von_beat or another track');
  }

  // 2. writes
  const getan: string[] = [];
  const fehler = (r: { code: number; j: Json }, fallback: string, extra: Json = {}): { code: number; j: Json } => ({ code: r.code >= 400 ? r.code : 409,
    j: { fehler: r.j.fehler ?? fallback, text: r.j.text, quittung: r.j.quittung ?? undefined, detail: { getan: [...getan], ...(r.j.detail === undefined ? {} : { server: r.j.detail }), ...extra } } });
  const gq = await http('POST', '/graph', { kanal, name: graph });
  const q = gq.j.quittung as { status: number; grund: string } | null | undefined;
  if (gq.code >= 400) return fehler(gq, 'graph_abgelehnt');
  if (!q || ![2, 3, 5].includes(q.status)) {
    return fehler({ code: 409, j: { fehler: q ? (q.grund || 'graph_nicht_bestaetigt') : 'keine_quittung', text: q ? `the kern did not accept the graph (status ${q.status})` : 'the kern did not answer the graph load in time (check graphen geladen)', quittung: q ?? null } }, 'graph_abgelehnt');
  }
  getan.push('graph');
  const sr = await http('POST', '/strudel', { strom, text: code });
  if (sr.code >= 400) return fehler(sr, 'strudel_abgelehnt');
  getan.push('strudel');
  let spurNeu = false;
  let spurId = vorhanden?.id;
  if (!vorhanden) {
    const neu = await mitRev({}, '/proj/aendern', { label: `Track ${spurArg}`, befehle: [{ befehl: 'spur_neu', art: 'audio', name: spurArg }] });
    if (neu.code >= 400) return fehler(neu, 'spur_neu_abgelehnt');
    getan.push('spur_neu');
    spurNeu = true;
    const a2 = await http('GET', '/proj/aktuell?noten=zahl');
    const kandidaten = (((a2.j as { projekt?: { spuren?: SpurSicht[] } }).projekt?.spuren) ?? []).filter((s) => s.name === spurArg && s.art === 'audio');
    spurId = kandidaten.sort((x, y) => y.nr - x.nr)[0]?.id;
    if (!spurId) return fehler({ code: 409, j: { fehler: 'spur_nicht_gefunden', text: 'the new track is not in the project' } }, 'spur_nicht_gefunden');
  }
  const schon = vorhanden?.aufnahme?.scharf && vorhanden.aufnahme.eingang?.name === kanal;
  if (!schon) {
    const arm = await mitRev({}, '/proj/aendern', { label: `Arm ${spurArg}`, befehle: [{ befehl: 'spur_aendern', spur_id: spurId, arm: true, eingang }] });
    if (arm.code >= 400) return fehler(arm, 'arm_abgelehnt');
  }
  getan.push('arm');

  // 3 to 5 run inside aufnehmen(); whatever happens there (answer, error, throw), the track is disarmed afterwards
  const aufnehmen = async (): Promise<{ code: number; j: Json }> => {
    // 3. the pattern plays from the next bar: wait until that bar has begun, then read the knob values
    const poll = STROM_POLL_MS();
    const beatLesen = async (): Promise<{ beat: number; bpm: number; regler: Record<string, number> }> => {
      const r = await http('GET', '/lage');
      const j = r.j as { uhr?: { beat?: number; bpm?: number }; regler?: Record<string, number> };
      if (r.code >= 400 || typeof j.uhr?.beat !== 'number') throw new Error(`lage answered ${r.code}${r.j.fehler ? ` (${String(r.j.fehler)})` : ''}`);
      return { beat: j.uhr.beat, bpm: typeof j.uhr.bpm === 'number' ? j.uhr.bpm : 128, regler: j.regler ?? {} };
    };
    const bisBeat = async (ziel: number, grenzeMs: number): Promise<void> => {
      const t0 = Date.now();
      for (;;) {
        if ((await beatLesen()).beat >= ziel) return;
        if (Date.now() - t0 > grenzeMs) throw new Error(`the master clock did not reach beat ${ziel} within ${Math.round(grenzeMs / 1000)} s`);
        await new Promise((r) => setTimeout(r, poll));
      }
    };
    let bpm0: number, regler: number[];
    try {
      const b0 = await beatLesen();
      // the erzeuger starts a new pattern at the first bar line after (now + 0.25 beat WECHSEL_ABSTAND + up to about 0.21 beat file poll): wait for the bar after b0 + 0.5
      await bisBeat(Math.ceil((b0.beat + 0.5) / 4) * 4 + 0.5, 4 * 4 * 60_000 / b0.bpm + 10_000);
      const r = await beatLesen();
      bpm0 = r.bpm;
      // knobs 1..64; trailing 0.5 are cut down to 8 numbers (a record of what was played, nothing reads it back as knob values)
      regler = Array.from({ length: 64 }, (_, i) => { const v = r.regler[`${kanal}/bk/${i + 1}`]; return typeof v === 'number' ? v : 0.5; });
      while (regler.length > 8 && regler[regler.length - 1] === 0.5) regler.pop();
    } catch (e) {
      return fehler({ code: 409, j: { fehler: 'uhr_nicht_lesbar', text: (e as Error).message } }, 'uhr_nicht_lesbar');
    }

    // 4. record; the stopp goes out even when the wait fails
    let start: { code: number; j: Json };
    try { start = await http('POST', '/proj/aufnahme', { aktion: 'start', von_beat: vonBeat }); }
    catch (e) { await http('POST', '/proj/aufnahme', { aktion: 'stopp' }).catch(() => undefined); throw e; }
    if (start.code >= 400) return fehler(start, 'aufnahme_abgelehnt');
    getan.push('aufnahme');
    let warteFehler: string | null = null;
    try {
      const s0 = await beatLesen();
      await bisBeat(s0.beat + 4 * takte, takte * 4 * 60_000 / bpm0 + 10_000);
    } catch (e) { warteFehler = (e as Error).message; }
    const stopp = await http('POST', '/proj/aufnahme', { aktion: 'stopp' });
    if (stopp.code >= 400) return fehler(stopp, 'stopp_abgelehnt', warteFehler ? { warte_fehler: warteFehler } : {});
    if (warteFehler) {
      return fehler({ code: 409, j: { fehler: 'warten_gescheitert', text: `the wait on the master clock failed (${warteFehler}); the recording was stopped, the take (if any) is on the track` } }, 'warten_gescheitert',
        { stopp: stopp.j });
    }
    const take = ((stopp.j as { takes?: Record<string, unknown>[] }).takes ?? []).find((x) => x.spur_id === spurId);
    if (!take) return fehler({ code: 409, j: { fehler: 'kein_take', text: 'the stop answer has no take for this track' } }, 'kein_take', { stopp: stopp.j });
    if (take.fehler) return fehler({ code: 409, j: { fehler: take.fehler, text: take.text } }, String(take.fehler), { take });

    // 5. the clip, found by its file; then the provenance
    const a3 = await http('GET', '/proj/aktuell?noten=zahl');
    const p3 = (a3.j as { projekt?: { tempo_bpm?: number; spuren?: SpurSicht[] } }).projekt;
    const clip = p3?.spuren?.find((s) => s.id === spurId)?.clips?.find((k) => k.quelle?.pfad_hinweis === take.datei);
    if (!clip) return fehler({ code: 409, j: { fehler: 'clip_nicht_gefunden', text: 'the take was saved but its clip is not on the track (the project changed meanwhile?)' } }, 'clip_nicht_gefunden', { take });
    const entstehung = { art: 'strom', strom, graph, regler, code, bpm: p3?.tempo_bpm ?? bpm0 };
    const ca = await mitRev({}, '/proj/aendern', { label: `Provenance ${clip.id}`, befehle: [{ befehl: 'clip_aendern', clip_id: clip.id, entstehung }] });
    if (ca.code >= 400) return fehler(ca, 'entstehung_abgelehnt', { take, clip_id: clip.id });
    return { code: 200, j: { spur_id: spurId, clip_id: clip.id, take: { frames: take.frames, luecken: take.luecken, status: take.status, datei: take.datei },
      entstehung, spur_neu: spurNeu, graph_quittung: q } };
  };
  let ergebnis: { code: number; j: Json } | undefined;
  let geworfen: { e: unknown } | undefined;
  try { ergebnis = await aufnehmen(); } catch (e) { geworfen = { e }; }
  // 6. disarm (the tool leaves no track armed: the next call on another track would be refused andere_scharf, a hand recording would record this one too)
  const dis = await mitRev({}, '/proj/aendern', { label: `Disarm ${spurArg}`, befehle: [{ befehl: 'spur_aendern', spur_id: spurId, arm: false }] })
    .catch((e: Error) => ({ code: 599, j: { fehler: 'disarm_fehlgeschlagen', text: e.message } as Json }));
  const disarmOk = dis.code < 400;
  if (geworfen) throw geworfen.e;
  const res = ergebnis!;
  const d = res.j.detail as { getan?: string[]; disarm_fehler?: unknown } | undefined;
  if (res.code >= 400) {
    if (d?.getan && disarmOk) d.getan.push('disarm');
    if (d && !disarmOk) d.disarm_fehler = { fehler: dis.j.fehler, text: dis.j.text };
  } else if (!disarmOk) {
    res.j.warnung = `the track ${spurId} is still armed (disarm failed: ${String(dis.j.fehler ?? dis.code)}): disarm it with proj_aendern spur_aendern arm false`;
  }
  return res;
}

// 1.16 rest U5: presets_anwenden. The server only COMPUTES the plan (POST /presets/anwenden changes nothing); this function sends it, with the
// rules of check/b116_send.mjs sendePlan: weg 'proj' = ONE /proj/aendern {rev, label, befehle}; weg 'regler' = one /regler {pfad, nach, ab: jetzt}
// per request in order, stopping at the first refusal; a refused plan sends nothing. Refusal of a /regler: HTTP >= 400 or a kern quittung with a
// FEHL_STATUS (sendePlan stops on status 6 only; 4, 7 and 8 are failures for every other hand tool too, so they stop here as well).
async function presetsAnwenden(p: Json): Promise<{ code: number; j: Json }> {
  if (typeof p.id !== 'string' || !PRESET_ID.test(p.id)) return fehlerAntwort(400, 'preset_id_ungueltig', 'a preset id looks like werk:komp/drum-bus or nutzer:rb338/my-bass (<werk|nutzer>:<geraet>/<slug>)');
  if (!isObj(p.ziel)) return fehlerAntwort(400, 'ziel_fehlt', 'ziel is an object such as {art: "insert", insert_id} (see the tool description)');
  const plan = await http('POST', '/presets/anwenden', { id: p.id, ziel: p.ziel, ...(p.graph_laden === true ? { graph_laden: true } : {}) });
  if (plan.code !== 200) return plan;
  const pl = plan.j as { weg?: string; label?: string; befehle?: Json[]; anfragen?: { pfad: string; nach: number }[]; uebersprungen?: string[]; hinweise?: string[]; graph?: { kanal: string; name: string } };
  const gemeinsam = { id: p.id, uebersprungen: pl.uebersprungen ?? [], hinweise: pl.hinweise ?? [] };
  if (pl.weg === 'proj') {
    const r = await mitRev(p, '/proj/aendern', { label: pl.label, befehle: pl.befehle });
    if (r.code >= 400) return r;
    return { code: 200, j: { ok: true, weg: 'proj', label: pl.label, ...gemeinsam, rev: r.j.rev, kern: r.j.kern } };
  }
  if (pl.weg === 'regler') {
    const anfragen = pl.anfragen ?? [];
    // D28: the plan of a sound whose instrument is not on the channel carries the graph. It goes FIRST and the kern must accept it (quittung 2, 3 or 5, like
    // proj_strom_aufnehmen) before any knob is sent: knobs into a channel without the graph would land on the wrong instrument.
    if (pl.graph) {
      const g = await http('POST', '/graph', { kanal: pl.graph.kanal, name: pl.graph.name });
      const gq = g.j.quittung as { status: number; grund: string } | null | undefined;
      if (g.code >= 400 || !gq || ![2, 3, 5].includes(gq.status)) {
        const grund = g.code >= 400 ? (g.j.fehler ?? `http ${g.code}`) : gq ? (gq.grund || 'graph_nicht_bestaetigt') : 'keine_quittung';
        const text = g.code >= 400 ? g.j.text : gq ? `the kern did not accept the graph ${pl.graph.name} (status ${gq.status})` : `the kern did not answer the load of the graph ${pl.graph.name} in time (check graphen geladen)`;
        return { code: g.code >= 400 ? g.code : 409, j: { ...g.j, fehler: grund, text, detail: { angenommen: [], abgelehnt: 'graph', offen: anfragen.map((x) => x.pfad), ...gemeinsam } } };
      }
    }
    for (let i = 0; i < anfragen.length; i++) {
      const a = anfragen[i];
      const r = await http('POST', '/regler', { pfad: a.pfad, nach: a.nach, ab: 'jetzt' });
      const q = r.j.quittung as { status: number; grund: string } | null | undefined;
      if (r.code >= 400 || (q && FEHL_STATUS.has(q.status))) {
        return { code: r.code >= 400 ? r.code : 409, j: { ...r.j, fehler: r.j.fehler ?? q?.grund ?? `http ${r.code}`,
          detail: { angenommen: anfragen.slice(0, i).map((x) => x.pfad), abgelehnt: a.pfad, offen: anfragen.slice(i + 1).map((x) => x.pfad), ...gemeinsam, ...(r.j.detail === undefined ? {} : { regler: r.j.detail }) } } };
      }
    }
    return { code: 200, j: { ok: true, weg: 'regler', gesendet: anfragen.length, ...(pl.graph ? { graph: pl.graph.name } : {}), ...gemeinsam } };
  }
  return fehlerAntwort(502, 'plan_unbekannt', 'the page server answered a plan without a known weg (proj or regler)');
}

// rev für proj_aendern/undo/redo: angegeben oder die aktuelle aus der schmalen Abfrage /proj/aktuell?nur=rev (Spec 6.30: nicht das ganze Projekt
// samt Noten); kein Projekt: 409 kein_projekt wie der Server. Spec 6.31: die Antwort ist schmal (?antwort=kurz: rev, kern, noten_zahl je Clip).
async function mitRev(p: Json, pfad: string, koerper: Json): Promise<{ code: number; j: Json }> {
  let rev = p.rev;
  if (rev === undefined) {
    const a = await http('GET', '/proj/aktuell?nur=rev');
    if (a.code !== 200) return a;
    const r = (a.j as { rev?: number | null }).rev;
    if (typeof r !== 'number') return { code: 409, j: { fehler: 'kein_projekt', text: 'open or create a project first (proj_oeffnen, proj_neu)' } };
    rev = r;
  }
  return http('POST', `${pfad}?antwort=kurz`, { ...koerper, rev });
}

// Oscilloscope answer as compact text: figures first, then one line of block characters (peak per group of points, -60..0 dB).
function osziText(j: Json): string {
  const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const liste = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const kuerze = (xs: string[], max: number): string => (xs.length > max ? [...xs.slice(0, max), `+${xs.length - max} more`] : xs).join(', ');
  const einsaetze = liste(j.einsaetze).map((e) => `${num((e as Json).t_ms)} ms +${num((e as Json).db)} dB`);
  const klicks = liste(j.klick_verdacht).map((t) => `${num(t)} ms`);
  const verfuegbar = num(j.verfuegbar_ms), angefragt = num(j.angefragt_ms);
  const bpm = typeof j.bpm === 'number' ? ` (${j.bpm} BPM)` : '';
  const pump = typeof j.pumptiefe_db === 'number' ? `${j.pumptiefe_db} dB per beat${bpm}` : 'unknown (no tempo, or less than one beat of data)';
  const hoch = liste(j.huellkurve_max_db).map(num);
  const ZEICHEN = 60, STUFEN = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
  let linie = '';
  for (let z = 0; z < Math.min(ZEICHEN, hoch.length); ++z) {
    const g = hoch.slice(Math.floor((z * hoch.length) / ZEICHEN), Math.max(Math.floor(((z + 1) * hoch.length) / ZEICHEN), Math.floor((z * hoch.length) / ZEICHEN) + 1));
    const m = Math.max(...g);
    linie += m <= -60 ? ' ' : STUFEN[Math.min(7, Math.floor(((m + 60) / 60) * 8))];
  }
  return [
    `Scope ${String(j.kanal)}, last ${Math.round(verfuegbar / 100) / 10} s${verfuegbar < angefragt ? ` (only ${verfuegbar} of ${angefragt} ms available)` : ''}, 1 ms envelope, no samples`,
    `Peak ${num(j.spitze_db)} dB at ${num(j.spitze_t_ms)} ms | RMS ${num(j.rms_db)} dB (-200 = silence)`,
    `Onsets (${einsaetze.length}): ${einsaetze.length ? kuerze(einsaetze, 12) : 'none'}`,
    `Pump depth: ${pump}`,
    `Click suspects (${klicks.length}): ${klicks.length ? kuerze(klicks, 10) : 'none'}`,
    `Envelope (peak, ${Math.round(verfuegbar / ZEICHEN)} ms per character, blank <= -60 dB, full block = 0 dB, right edge = now): ${linie}`,
  ].join('\n');
}

// Ergebnis → MCP: HTTP ≥ 400 oder eine Quittung mit Fehlerstatus ist ein Werkzeugfehler mit Grund
function antwort(r: { code: number; j: Json; text?: string; roh?: string }): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  const q = r.j.quittung as { status: number; grund: string } | null | undefined;
  const fehler = r.code >= 400 || (q && FEHL_STATUS.has(q.status));
  if (fehler && r.roh !== undefined) return { content: [{ type: 'text', text: r.roh }], isError: true };   // plan 7: the tag tools carry {ok, grund, text} of the page unchanged
  const text = fehler
    // Ohr T11: kein_hoerschein trägt urteil/gruende des letzten Scheins (server.ts regler()) — mitgeben, sonst
    // verschwindet der Beleg für den Fehlerfall hinter der generischen Fehlerform.
    // ziel: welche Fahrt einer Spur abgelehnt wurde (ueber_projekt, D1 Spec 6.22/6.30)
    // seq_geleert: a stopped track of a SEQ deck place was ejected by this refused open; the same call may succeed now (plan seq-fader-frei)
    ? JSON.stringify({ fehler: r.j.fehler ?? q?.grund ?? `http ${r.code}`, text: r.j.text, detail: r.j.detail, details: r.j.details, ziel: r.j.ziel, urteil: r.j.urteil, gruende: r.j.gruende, seq_geleert: r.j.seq_geleert, quittung: q ?? undefined })
    : r.text ?? JSON.stringify(r.j);
  return fehler ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

// MCP 2026-07-28: djk-hand ships the agent skills with its tools (skills over MCP), so a client that connects the hand
// gets them without copying files. Source: the public skills of the project, found next to the program (skills/ at the
// root of a checkout or the package; docs/veroeffentlichung/public/skills in the working repo). DJK_HAND_SKILLE names
// another folder of skill folders, DJK_HAND_SKILLE_NUR limits it to a comma list. No folder: no skills, tools unaffected.
const HIER = path.dirname(fileURLToPath(import.meta.url));
const SKILL_WURZEL = process.env.DJK_HAND_SKILLE
  ?? [path.resolve(HIER, '../../skills'), path.resolve(HIER, '../../docs/veroeffentlichung/public/skills')].find((d) => fs.existsSync(d));
const SKILL_NUR = process.env.DJK_HAND_SKILLE_NUR ? new Set(process.env.DJK_HAND_SKILLE_NUR.split(',').map((x) => x.trim()).filter(Boolean)) : undefined;
function nurDiese(f: SkillFiles, nur: Set<string>): SkillFiles {
  const erlaubt = (p: string) => nur.has(p.split('/')[0]);
  return {
    list: async (dir) => (dir === '' ? (await f.list(dir)).filter((e) => nur.has(e.name)) : (erlaubt(dir) ? f.list(dir) : [])),
    read: async (p) => { if (!erlaubt(p)) throw new Error(`skill not served: ${p}`); return f.read(p); },
  };
}

let skille: SkillsExtension | undefined;
try {
  if (!SKILL_WURZEL) throw new Error('no skills folder');
  const dateien = nodeSkillFiles(SKILL_WURZEL);
  const katalog = await SkillsExtension.load(SKILL_NUR ? nurDiese(dateien, SKILL_NUR) : dateien, { onWarning: (w) => console.error('djk-hand skill:', JSON.stringify(w)) });
  skille = katalog;
  console.error(`djk-hand: ${katalog.entries.length} skills`);
} catch (e) { console.error(`djk-hand: no skills (${(e as Error).message})`); }

// serveStdio picks the era from the opening exchange: 2026-07-28 (server/discover) or 2025 (initialize), one instance per connection
serveStdio(() => {
  const mcp = new McpServer({ name: 'djk-hand', version: '0.2.0' }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler('tools/list', async () => ({ tools: W.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
  mcp.server.setRequestHandler('tools/call', async (req) => {
    const w = W.find((x) => x.name === req.params.name);
    if (!w) return { content: [{ type: 'text', text: `unknown tool ${req.params.name}` }], isError: true };
    const args = (req.params.arguments ?? {}) as Json;
    const kopf = { werkzeug: w.name, aktion: typeof args.aktion === 'string' ? args.aktion : null, aufruf: `${AUFRUF_PRAEFIX}-${++aufrufZaehler}` };
    try { return antwort(await AUFRUF.run(kopf, () => w.lauf(args))); }
    catch (e) { return { content: [{ type: 'text', text: JSON.stringify({ fehler: 'seite_nicht_erreichbar', text: (e as Error).message, seite: SEITE }) }], isError: true }; }
  });
  skille?.attach(mcp);
  return mcp;
});
