// Moved unchanged out of hand.ts: the shared helpers of the hand: call head, HTTP routes, deadlines, common schema pieces.
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import nodeHttp from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Ziele } from './mischung.ts';
import { ladeVokabular } from '../ui/presets/vocabulary.ts';   // 1.16 U5: the search tool's schema is the server's own definition
import { frageSchema } from '../ui/presets/register.ts';
import { ALLE_STROEME } from '../contract/streams.ts';   // container core U7: the stream list is the shared table, not a copy here
import { RANG } from '../ui/http/hand_klassen.ts';   // strand 9: the level order the server enforces, one table

export const { values: arg } = parseArgs({ options: { seite: { type: 'string', default: 'http://127.0.0.1:47300' } } });
export const SEITE = arg.seite as string;
export const FEHL_STATUS = new Set([4, 6, 7, 8]);   // §5.1: verworfen, abgelehnt, abgebrochen, storniert (5 = verspätet ausgeführt)

export type Json = Record<string, unknown>;
// Instrumente nachrüsten startet Units, das kann der Seiten-Server nicht: die Hand ruft djk-instrumente selbst auf.
// Instanz aus dem Seiten-Port (47300 + 1000·k, k = 1 → a), wie djk-start sie vergibt.
export const INSTRUMENTE = process.env.DJK_INSTRUMENTE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'start', 'djk-instrumente');
export const SP = Number(new URL(SEITE).port || 80) - 47300, K = SP / 1000;
export const INSTANZ = Number.isInteger(K) && K >= 1 && K <= 9 ? String.fromCharCode(96 + K) : '';
// Agent key (strand 9): the page server makes the file at start. Production page: the user's file; test instance: its /dev/shm folder;
// any other --seite (a stub in a test) reads no key unless DJK_HAND_SCHLUESSEL_DATEI says so.
export const SCHLUESSEL_DATEI = process.env.DJK_HAND_SCHLUESSEL_DATEI ?? (SP === 0 && ['127.0.0.1', 'localhost'].includes(new URL(SEITE).hostname)
  ? path.join(os.homedir(), '.config', 'cypherdj', 'hand.token') : INSTANZ ? `/dev/shm/cypherdj-${INSTANZ}/hand.token` : '');
export let schluesselWert: string | null | undefined;   // undefined = not read yet
export function schluessel(neu = false): string | null {
  if (neu) schluesselWert = undefined;
  if (schluesselWert !== undefined) return schluesselWert;
  let k: string | null = null;
  try { const t = SCHLUESSEL_DATEI ? fs.readFileSync(SCHLUESSEL_DATEI, 'utf8').trim() : ''; k = /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null; } catch { k = null; }
  if (k === null && SCHLUESSEL_DATEI) process.stderr.write(`djk-hand: no key file ${SCHLUESSEL_DATEI}; the studio will refuse agent writes\n`);
  return (schluesselWert = k);
}
// Strand 9: every tool call names itself to the page server (tool, action, call id), so the server can class and log it per call.
export const AUFRUF = new AsyncLocalStorage<{ werkzeug: string; aktion: string | null; aufruf: string }>();
export const AUFRUF_PRAEFIX = crypto.randomBytes(4).toString('hex');

export function koepfe(): Record<string, string> {
  const k = schluessel();
  const a = AUFRUF.getStore();
  return {
    'x-djk-quelle': 'cypher', ...(k ? { authorization: `Bearer ${k}` } : {}),
    ...(a ? { 'x-djk-werkzeug': a.werkzeug, ...(a.aktion ? { 'x-djk-aktion': a.aktion } : {}), 'x-djk-aufruf': a.aufruf } : {}),
  };
}
// S18: the streams the page currently serves: 1..3 always, any other stream of ALLE_STROEME while its erzeuger lives.
// /lage studio.stroeme says which; if /lage does not answer, the three studio streams as before.
export async function stroemeListe(): Promise<number[]> {
  const r = await http('GET', '/lage');
  const st = (r.j as { studio?: { stroeme?: unknown } }).studio?.stroeme;
  const nr = Array.isArray(st) ? st.map((x) => Number((x as Json)?.strom)).filter((n) => (ALLE_STROEME as readonly number[]).includes(n)) : [];
  return r.code === 200 && nr.length ? [...new Set([1, 2, 3, ...nr])].sort((a, b) => a - b) : [1, 2, 3];
}
// instrumente starts units itself and bypasses the page server, so the stop switch and the level are checked here from GET /hand/ich.
// A 404 (old server) or an unreachable page goes on as before.
export async function instrumenteLaden(extra: string[] = []): Promise<{ code: number; j: Json }> {
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
export let lageBasis: Json | null = null;
export function lagePfade(w: unknown, pfad: string, aus: Map<string, unknown>): void {
  if (w !== null && typeof w === 'object' && !Array.isArray(w) && Object.keys(w).length) { for (const [k, v] of Object.entries(w)) lagePfade(v, pfad ? `${pfad}.${k}` : k, aus); }
  else aus.set(pfad, w);
}
export function lageForm(r: { code: number; j: Json }, p: Json): { code: number; j: Json } {
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
export async function http(methode: 'GET' | 'POST', pfad: string, daten?: Json, wiederholt = false, signal?: AbortSignal): Promise<{ code: number; j: Json }> {
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
export async function httpGrund(methode: 'GET' | 'POST', pfad: string, daten?: Json): Promise<{ code: number; j: Json }> {
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
export type Lang = 'proj_freeze' | 'proj_export' | 'proj_export_spuren' | 'proj_lautheit' | 'proj_stems' | 'proj_zusammenfuehren' | 'proj_bounce' | 'proj_resample' | 'proj_analyse' | 'proj_noten';
// proj_lautheit (Paket 1.18, S3-Fix G5): der Server rendert seriell, bis zu 129 Renders (128 Spuren und Summe) zu je 4 · 1024 s + 60 s (Zeitlimit des Renders)
// plus ffmpeg 120 s je Messung plus ein Freeze ≈ 291 s: Grenzfall ≈ 9198 min (153,3 h). Die Vorgabe liegt NICHT darüber (80 min wie der Export): echte Renders
// brauchen Sekunden, das Zeitlimit ist eine Kill-Schwelle; wer den Grenzfall erreicht, bekommt hand_frist und fragt später (beschaeftigt, solange es läuft).
// Darum sagt fristText für proj_lautheit nicht „above the longest run“, sondern nennt Grenze, Grenzfall und Override.
export const FRIST_VORGABE_MS: Readonly<Record<Lang, number>> = { proj_freeze: 6 * 60_000, proj_export: 80 * 60_000, proj_export_spuren: 80 * 60_000, proj_lautheit: 80 * 60_000, proj_stems: 20 * 60_000,
  proj_zusammenfuehren: 80 * 60_000, proj_bounce: 80 * 60_000,
  proj_resample: 6 * 60_000,
  proj_analyse: 30 * 60_000,   // 1.10 slice 7: the freeze's bound (a 256 beat tap at 60 BPM, ramp, receipt) plus the WAV conversion
  proj_noten: 2 * 60_000 };    // note editor B5: a detection of a normal clip takes seconds (spec: full analysis under 15 s); the run goes on after the wait, the answer is laeuft
export const fristVon = (name: Lang): number => {
  const v = Number(process.env[`DJK_HAND_FRIST_${name.toUpperCase()}_MS`]);
  return Number.isFinite(v) && v > 0 ? v : FRIST_VORGABE_MS[name];
};
export const FRIST_GRUND: Readonly<Record<Lang, string>> = {
  proj_freeze: 'above the longest run the server allows', proj_resample: 'above the longest run the server allows', proj_export: 'above the longest run the server allows',
  proj_export_spuren: 'above the longest run the server allows',
  proj_stems: 'at most 600 s of source take about 1 min on the GPU (measured 2026-11-06: 8 min in 43 s); the limit keeps a wide reserve',
  proj_zusammenfuehren: 'one render of the range (time limit 4 * 1024 s + 60 s) plus hashing the result, below 80 min; a normal merge takes seconds',
  proj_bounce: 'one render of the range (time limit 4 * 1024 s + 60 s) plus hashing the result, below 80 min; a normal bounce takes seconds',
  proj_lautheit: 'enough for normal ranges, but the server allows about 153.3 h in the extreme case: 129 renders of 1024 beats at 60 BPM, each at its time limit',
  proj_noten: 'a detection of a normal clip takes seconds; a long source takes longer, the run goes on after the wait',
  proj_analyse: 'one render of the strip and, with a comparison, of the second one, for at most 1024 beats each, plus the analysis in a worker thread; a normal range takes seconds, and a Surge track that must be frozen first adds its freeze',
};
export const fristText = (name: Lang): string => `The call waits at most ${FRIST_VORGABE_MS[name] / 60_000} min (tool limit, DJK_HAND_FRIST_${name.toUpperCase()}_MS; `
  + `${FRIST_GRUND[name]}); after that it answers hand_frist, and the run may still finish on the server: a repeated call `
  + 'answers beschaeftigt while it runs.';
export function httpLang(name: Lang, pfad: string, daten: Json): Promise<{ code: number; j: Json }> {
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

export const zahl = (beschreibung: string, extra: Json = {}) => ({ type: 'number', description: beschreibung, ...extra });
export const deck12 = { type: 'integer', enum: [1, 2, 3, 4], description: 'Deck 1 = A, 2 = B, 3 and 4 = the further decks (the hearing check knows all four)' };
export const deck = { type: 'integer', enum: [1, 2, 3, 4], description: 'Deck 1 = A, 2 = B, 3 and 4 = the further decks (deck 3 also serves loop work)' };
export const ab = { type: 'string', enum: ['jetzt', 'schlag', 'takt', 'phrase'], description: 'start on the master clock: now, next beat, next bar (default), next phrase (8 bars)' };
export const raster = { type: 'number', enum: [0, 0.25, 1, 4, 16], description: 'snap in beats (0 = none, 4 = bar)' };

// 1.16 rest U5: presets and collections. presets_suchen takes its definition from frageSchema (the function behind GET /presets/suche/schema, P-R7),
// so the tool schema and the route cannot drift; tests/hand_presets.test.mjs compares the two against a real presetsBereich.
export const SUCHE = frageSchema(ladeVokabular());
export const isObj = (x: unknown): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x);
export const definiert = (p: Json, ...felder: string[]): Json => Object.fromEntries(felder.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
export const PRESET_ZIEL = { type: 'object', description: 'where the values go: {art: "spur", spur_id} (rb338 or bk track), {art: "insert", insert_id} (an existing stage), {art: "insert_neu", strang_id} (a new stage at the end of the chain of a track, group, return or master), {art: "kanal", kanal} (a kern source channel such as deck/1, erz/2, pad/1: the channel compressor and the mix tools)', additionalProperties: true };

export const WARTE_FRIST_MAX_MS = 15 * 60_000;   // `warte bis spur_ende`: the longest total wait
// Beats per bar from the answer of GET /lage (`taktart: [n, 4]` appears only when it is not 4); 4 when absent
export const proTaktVon = (lage: unknown): number => {
  const n = (lage as { taktart?: unknown } | null)?.taktart;
  return Array.isArray(n) && Number.isInteger(n[0]) && n[0] >= 1 ? n[0] : 4;
};
export const MISCHUNG_ZIELE = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'mischung_ziele.json'), 'utf8')) as Ziele;   // ROUGH genre curves
export interface Werkzeug { name: string; description: string; inputSchema: Json; lauf: (p: Json) => Promise<{ code: number; j: Json; text?: string; roh?: string }> }

export const fehlerAntwort = (code: number, fehler: string, text: string, detail?: unknown): { code: number; j: Json } => ({ code, j: { fehler, text, ...(detail === undefined ? {} : { detail }) } });

// rev für proj_aendern/undo/redo: angegeben oder die aktuelle aus der schmalen Abfrage /proj/aktuell?nur=rev (Spec 6.30: nicht das ganze Projekt
// samt Noten); kein Projekt: 409 kein_projekt wie der Server. Spec 6.31: die Antwort ist schmal (?antwort=kurz: rev, kern, noten_zahl je Clip).
export async function mitRev(p: Json, pfad: string, koerper: Json): Promise<{ code: number; j: Json }> {
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
