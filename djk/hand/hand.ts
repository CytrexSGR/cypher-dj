#!/usr/bin/env node
// djk-hand: Cyphers Hand an djk als MCP-Server (stdio). Plan docs/superpowers/plans/2026-09-28-djk-hand-mcp.md.
// Jeder Aufruf geht als HTTP an den Seiten-Server mit dem Kopf x-djk-quelle: cypher; der Server setzt damit die Quelle
// cypher in jeden Kern-Befehl (Stop Cypher blockt, Andreas' Hand bricht Rampen ab, „nur Hand“-Regler lehnt der Kern ab,
// geschlossene Kanäle öffnen und auf offene Decks springen sperrt der Server, bis das Ohr Hörscheine ausstellt).
// Aufruf: node hand.ts [--seite http://127.0.0.1:47300]
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import nodeHttp from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ladeVokabular } from '../oberflaeche/presets/vokabular.ts';   // 1.16 U5: the search tool's schema is the server's own definition
import { frageSchema } from '../oberflaeche/presets/register.ts';
import { PRESET_ID } from '../oberflaeche/presets/preset_id.ts';
import { DEEP_FAKTOR } from '../oberflaeche/projekt/richtung.ts';   // review U4: the deep size in the text is the code's own
import { bandMitteHz, SPEKTRUM_FRIST_MS } from '../oberflaeche/oeffentlich/spektrum.js';   // 1.15 A9: one source for the band centres and the staleness limit

const { values: arg } = parseArgs({ options: { seite: { type: 'string', default: 'http://127.0.0.1:47300' } } });
const SEITE = arg.seite as string;
const FEHL_STATUS = new Set([4, 6, 7, 8]);   // §5.1: verworfen, abgelehnt, abgebrochen, storniert (5 = verspätet ausgeführt)
const QUELLE = { 'x-djk-quelle': 'cypher' };

type Json = Record<string, unknown>;
// Instrumente nachrüsten startet Units, das kann der Seiten-Server nicht: die Hand ruft djk-instrumente selbst auf.
// Instanz aus dem Seiten-Port (47300 + 1000·k, k = 1 → a), wie djk-start sie vergibt.
const INSTRUMENTE = process.env.DJK_INSTRUMENTE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'start', 'djk-instrumente');
const SP = Number(new URL(SEITE).port || 80) - 47300, K = SP / 1000;
const INSTANZ = Number.isInteger(K) && K >= 1 && K <= 9 ? String.fromCharCode(96 + K) : '';
// S18: the streams the page currently serves: 1..3 always, a Baukasten stream (5, 6, 7, 9, 10) while its erzeuger lives.
// /lage studio.stroeme says which; if /lage does not answer, the three studio streams as before.
const STUDIO_STROEME = [1, 2, 3, 5, 6, 7, 9, 10];
async function stroemeListe(): Promise<number[]> {
  const r = await http('GET', '/lage');
  const st = (r.j as { studio?: { stroeme?: unknown } }).studio?.stroeme;
  const nr = Array.isArray(st) ? st.map((x) => Number((x as Json)?.strom)).filter((n) => STUDIO_STROEME.includes(n)) : [];
  return r.code === 200 && nr.length ? [...new Set([1, 2, 3, ...nr])].sort((a, b) => a - b) : [1, 2, 3];
}
function instrumenteLaden(extra: string[] = []): Promise<{ code: number; j: Json }> {
  return new Promise((ok) => execFile(INSTRUMENTE, [...(INSTANZ ? ['--instanz', INSTANZ] : []), ...extra], { timeout: 90000 }, (e, aus, err) => {
    const zeilen = (t: string) => t.split('\n').map((z) => z.trim()).filter(Boolean);
    ok(e ? { code: 500, j: { fehler: 'instrumente_gescheitert', text: zeilen(err).join(' | ') || e.message, ausgabe: zeilen(aus) } }
      : { code: 200, j: { ok: true, ausgabe: zeilen(aus) } });
  }));
}
async function http(methode: 'GET' | 'POST', pfad: string, daten?: Json): Promise<{ code: number; j: Json }> {
  const r = await fetch(SEITE + pfad, methode === 'GET' ? { headers: QUELLE }
    : { method: 'POST', headers: { 'content-type': 'application/json', ...QUELLE }, body: JSON.stringify(daten ?? {}) });
  const text = await r.text();
  let j: Json;
  try { j = JSON.parse(text) as Json; } catch { j = { text }; }
  return { code: r.status, j };
}

// Fix-Runde S3 R6: proj_freeze und proj_export warten auf einen Lauf, der länger sein kann als Undicis 300 s (fetch bricht dann mit „fetch failed“
// ab, ohne Grund). Diese drei gehen über node:http mit eigenem Zeitlimit. Freeze und Export: gewählt über der längsten Dauer, die der Seiten-Server erlaubt:
//   Freeze: Rampe bis 20 s + Quittung bis 4 s + Frist (256 + 2 + 4 Beats bei 60 BPM + 5 s) ≈ 291 s          → Vorgabe 6 min
//   Export: Freeze ≈ 291 s + Render-Zeitlimit 4 · 1024 s + 60 s + Lautheit (ffmpeg) 120 s ≈ 4567 s          → Vorgabe 80 min
// (Grenzen aus oberflaeche/bereiche/proj/ausgabe.ts, sitzung.ts rampeWarteMs, server.ts warteQuittung, projekt/lautheit.ts, befehle.ts TEMPO_MIN.)
// Überschreibbar mit DJK_HAND_FRIST_PROJ_FREEZE_MS, DJK_HAND_FRIST_PROJ_EXPORT_MS und DJK_HAND_FRIST_PROJ_LAUTHEIT_MS (Tests: kurze Grenze).
type Lang = 'proj_freeze' | 'proj_export' | 'proj_lautheit' | 'proj_stems' | 'proj_zusammenfuehren' | 'proj_bounce';
// proj_lautheit (Paket 1.18, S3-Fix G5): der Server rendert seriell, bis zu 33 Renders (32 Spuren und Summe) zu je 4 · 1024 s + 60 s (Zeitlimit des Renders)
// plus ffmpeg 120 s je Messung plus ein Freeze ≈ 291 s: Grenzfall ≈ 2357 min (39,3 h). Die Vorgabe liegt NICHT darüber (80 min wie der Export): echte Renders
// brauchen Sekunden, das Zeitlimit ist eine Kill-Schwelle; wer den Grenzfall erreicht, bekommt hand_frist und fragt später (beschaeftigt, solange es läuft).
// Darum sagt fristText für proj_lautheit nicht „above the longest run“, sondern nennt Grenze, Grenzfall und Override.
export const FRIST_VORGABE_MS: Readonly<Record<Lang, number>> = { proj_freeze: 6 * 60_000, proj_export: 80 * 60_000, proj_lautheit: 80 * 60_000, proj_stems: 20 * 60_000,
  proj_zusammenfuehren: 80 * 60_000, proj_bounce: 80 * 60_000 };
const fristVon = (name: Lang): number => {
  const v = Number(process.env[`DJK_HAND_FRIST_${name.toUpperCase()}_MS`]);
  return Number.isFinite(v) && v > 0 ? v : FRIST_VORGABE_MS[name];
};
const FRIST_GRUND: Readonly<Record<Lang, string>> = {
  proj_freeze: 'above the longest run the server allows', proj_export: 'above the longest run the server allows',
  proj_stems: 'at most 600 s of source take about 1 min on the GPU (measured 2026-11-06: 8 min in 43 s); the limit keeps a wide reserve',
  proj_zusammenfuehren: 'one render of the range (time limit 4 * 1024 s + 60 s) plus hashing the result, below 80 min; a normal merge takes seconds',
  proj_bounce: 'one render of the range (time limit 4 * 1024 s + 60 s) plus hashing the result, below 80 min; a normal bounce takes seconds',
  proj_lautheit: 'enough for normal ranges, but the server allows about 39.3 h in the extreme case: thirty-three renders of 1024 beats at 60 BPM, each at its time limit',
};
const fristText = (name: Lang): string => `The call waits at most ${FRIST_VORGABE_MS[name] / 60_000} min (tool limit, DJK_HAND_FRIST_${name.toUpperCase()}_MS; `
  + `${FRIST_GRUND[name]}); after that it answers hand_frist, and the run may still finish on the server: a repeated call `
  + 'answers beschaeftigt while it runs.';
function httpLang(name: Lang, pfad: string, daten: Json): Promise<{ code: number; j: Json }> {
  const ms = fristVon(name), koerper = JSON.stringify(daten);
  return new Promise((ok, fehl) => {
    let fertig = false;
    const ende = (f: () => void): void => { if (fertig) return; fertig = true; clearTimeout(uhr); f(); };
    const q = nodeHttp.request(SEITE + pfad, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(koerper), ...QUELLE } },
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
const deck = { type: 'integer', enum: [1, 2], description: 'Deck 1 = A, 2 = B' };
const ab = { type: 'string', enum: ['jetzt', 'schlag', 'takt', 'phrase'], description: 'start on the master clock: now, next beat, next bar (default), next phrase (8 bars)' };
const raster = { type: 'number', enum: [0, 0.25, 1, 4, 16], description: 'snap in beats (0 = none, 4 = bar)' };

// 1.16 rest U5: presets and collections. presets_suchen takes its definition from frageSchema (the function behind GET /presets/suche/schema, P-R7),
// so the tool schema and the route cannot drift; tests/hand_presets.test.mjs compares the two against a real presetsBereich.
const SUCHE = frageSchema(ladeVokabular());
const isObj = (x: unknown): x is Json => x !== null && typeof x === 'object' && !Array.isArray(x);
const definiert = (p: Json, ...felder: string[]): Json => Object.fromEntries(felder.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
const PRESET_ZIEL = { type: 'object', description: 'where the values go: {art: "spur", spur_id} (rb338 or bk track), {art: "insert", insert_id} (an existing stage), {art: "insert_neu", strang_id} (a new stage at the end of the chain of a track, group, return or master), {art: "kanal", kanal} (a kern source channel such as deck/1, erz/2, pad/1: the channel compressor and the mix tools)', additionalProperties: true };

interface Werkzeug { name: string; description: string; inputSchema: Json; lauf: (p: Json) => Promise<{ code: number; j: Json }> }
const W: Werkzeug[] = [
  { name: 'lage', description: 'Current state: master clock (beat, bar, bpm), Stop-Cypher flag, both decks (track, bar in track, loop, open/closed), mixer values (incl. duck, reverb send and return, glue when off their defaults), loop boxes L1/L2, FX, my last acknowledgements, and the studio: AUTO/pattern per instance, loaded Surge sound (after a set it reads "edited": the name then says nothing about the content), and ins_gr (only while a project insert stage computes: {"ins/komp/<n>": gain reduction in dB, n = the slot of the stage as in proj_lage inserts; a stage that is bypassed or removed is absent after 0.5 s), hall_pool ({an, faeden, spaet, zurueck}: Hall pool of the kern for the return Halls, absent from an old kern; an false = no pool, no free cores or the pool switched itself off after repeated late blocks, the Halls then run in the callback and the sound stays the same), and the digital output (ausgang.zustand: gut = on, aus = OFF and silent, kampf = keeps dropping, wache_stumm = watch not running, unbewacht = silent sink; faelle = dropouts this session). Call this before every move.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/lage') },
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
  { name: 'deck_start', description: 'Start a deck in sync with the master, on the next bar by default, from the downbeat of the track (or quell_beat). Only on a CLOSED deck (fader down): that is how I pre-listen. On an open deck it is refused (ziel_ungehoert).',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck, ab, quell_beat: zahl('source beat to start from (default: first downbeat)') } },
    lauf: (p) => http('POST', '/deck/start', p) },
  { name: 'deck_stopp', description: 'Stop a deck (default: now).', inputSchema: { type: 'object', required: ['deck'], properties: { deck, ab } },
    lauf: (p) => http('POST', '/deck/stopp', p) },
  { name: 'sprung', description: 'Jump inside a track: to a source beat (ziel) or by delta beats. Snapped to the raster, phase kept. Refused on an open deck (unheard material).',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck, ziel: zahl('target source beat'), delta: zahl('beats to jump, negative = back'), raster } },
    lauf: (p) => http('POST', '/deck/sprung', { raster: 4, ...p }) },
  { name: 'loop', description: 'Deck loop on/off: beats 1, 2, 4, 8, 16 starts a loop at the raster; beats 0 ends it. Allowed on an open deck (repeats what is heard).',
    inputSchema: { type: 'object', required: ['deck', 'beats'], properties: { deck, beats: { type: 'integer', enum: [0, 1, 2, 4, 8, 16] }, raster } },
    lauf: (p) => http('POST', '/deck/loop', { deck: p.deck, laenge: p.beats, raster: p.raster ?? 4 }) },
  { name: 'pad', description: 'Hotcue pads 1-8: setzen (shot or loop cue at the playhead, or while a loop runs: that loop), spielen (jump in; refused on an open deck), loeschen.',
    inputSchema: { type: 'object', required: ['deck', 'nr', 'aktion'], properties: { deck, nr: { type: 'integer', minimum: 1, maximum: 8 },
      aktion: { type: 'string', enum: ['setzen', 'spielen', 'loeschen'] }, art: { type: 'string', enum: ['shot', 'loop'] },
      beats: { type: 'integer', enum: [1, 2, 4, 8, 16] }, raster } },
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
  { name: 'loop_nach_box', description: 'Cut the running deck loop sample-exact into the loop library and load it into loop box L1 or L2. Refused (409 box_offen_oder_faehrt) while that box is open or my own pad ramp on it is still running.',
    inputSchema: { type: 'object', required: ['deck', 'box'], properties: { deck, box: { type: 'integer', enum: [1, 2] } } },
    lauf: (p) => http('POST', '/deck/loop/sichern', p) },
  { name: 'box', description: 'Loop boxes L1/L2: laden (name from the loop library), start, stopp. Loading or starting an OPEN box is refused (unheard); foreign material (anything but my own recordings) is also refused (409 box_offen_oder_faehrt) while my pad ramp on that box is still running.',
    inputSchema: { type: 'object', required: ['box', 'aktion'], properties: { box: { type: 'integer', enum: [1, 2] }, aktion: { type: 'string', enum: ['laden', 'start', 'stopp'] }, name: { type: 'string' } } },
    lauf: (p) => http('POST', '/loop', p) },
  { name: 'regler', description: 'Move a mixer control, optionally as a ramp over bars (my way to blend: channel fader, EQ, filter). Paths: deck/1|2/(fader|trim|eq/tief|eq/mitte|eq/hoch|kill/tief|kill/mitte|kill/hoch|filter), pad/1|2/..., erz/1|2|3/..., fx/1|2/(notenwert|rueckkopplung|rueckweg), duck/tiefe (dB -24..0, 0 = off: kick ducks bass and melody), duck/release (ms 50..600). <kanal>/komp/(an 0/1, schwelle dB -60..0, ratio 1..20, attack ms 0.1..100, release ms 10..1000, makeup dB 0..24, mix 0..1, sc 0..14 = sidechain key: 0 own signal, else source channel + 1, erz/1 = 5): compressor per source channel (deck, erz, pad), after EQ/filter, before the fader; off by default. color/art (sound color FX like the XDJ-XZ, global for all channels: 0 FILTER, 1 SPACE, 2 DUB ECHO, 3 SWEEP, 4 NOISE, 5 CRUSH; set only, use ab:jetzt) and color/param (PARAMETER 0..1, default 0.5): the filter knob of every channel is the COLOR knob, center = dry, SPACE and DUB ECHO tails ring out when it returns to center. <kanal>/bk/1..8 (deck/1..4, erz/1|2|3|5|6|7, pad/1|2; 0..1, default 0.5, smoothed 20 ms in the engine) steer the eight knobs of the graph loaded on that channel (effect graph on a deck, instrument graph on erz/pad); a channel without a graph ignores them. fx/3/bk/1..8, fx/4/bk/1..8 (same range) steer the eight knobs of the effect graph on that send return. Mix tools: <source>/gate/(an 0/1, schwelle dBFS -90..0, hysterese dB 0..24, ratio 1..100 = 100 hard gate, bereich dB -120..0, attack ms 0.1..500, hold ms 0..2000, release ms 1..5000, sc 0..14 = sidechain key as komp/sc) on deck/1..4, erz/1..7, pad/1..2 (not erz/8); <source or bus>/util/(balance -1..1, breite % 0..200, bassmono Hz 0..500 = off, phase_l|phase_r|tausch|dc 0/1) on those and bus/1..4; bus/1..4 only: mb/an 0/1, mb/grenze_tief|grenze_hoch Hz 20..20000, mb/(tief|mitte|hoch)/(schwelle dB -60..0, ratio 1..20, attack ms 0.1..500, release ms 1..5000, knie dB 0..24, makeup dB -24..24 = trim on top of the automatic make-up, umgehen 0/1) = three-band compressor (every band adds back its own average gain reduction by itself, so compressing a band does not make it quieter; makeup 0 = automatic only), lim/(an 0/1, decke dBFS -60..0, abklingen ms 1..2000) = channel limiter (does nothing while kern.toml kanal_limiter_vorhalt_ms is 0, the default); global spektrum/kanal (0 off, 1..18 = channel index + 1, 19 = master sum) picks the analyser source. All off or neutral by default, none of them counts as making things quieter for my autonomy. keylock (0/1, set only, default 1): one switch for all sources (decks, loop boxes), 1 keeps the pitch at any tempo, 0 = varispeed. <kanal>/send/2 feeds the reverb (fx/2 return, 0 dB default; send -200..0 dB, -200 = off). Units: fader/trim/eq in dB (fader -200..0, eq -200..+6), filter -1..+1, kill 0/1. Crossfader, master (master/pegel, master/kleber = threshold of the sum compressor 0..1, 0 = off), PFL and cue are Andreas\' hand only (nur_hand). Opening a closed channel (trim+fader above -26 dB, deck/1|2 only) needs a valid hearing check from hoeren (urteil ok); the server attaches it. erz channels and pad boxes holding my own recordings open freely with regler; a pad box with a foreign loop stays refused (kein_hoerschein), and while my pad ramp is open I cannot load foreign material into that box (box_offen_oder_faehrt). Automation tracks (spur) still may not open pad boxes. Andreas touching the control aborts my ramp (status 7 hand). A move into my own running ramp on the same path is queued to the ramp\'s end (verschoben_auf). Rejections at the start beat itself only show in lage (quittungen). Project mixer paths (spur/1..32/*, grp/1..8/*, pm/fader, the sends spur|grp/n/send/1..4, the returns ret/1..4/* and the insert stages ins/komp/1..12/* (an, schwelle, ratio, knie, attack, release, makeup, mix, schp, sc), ins/eq/1..2/* (an, out, propq, b1..b8/an|typ|freq|gain|q|steil|platz) ins/saett/1/* (an, drive, out, mix) and ins/lim/1/* (an, decke dBFS -60..0, abklingen ms 1..2000) and the rack macros rack/1..12/m1..m4) are refused with ueber_projekt: they change only through the project (proj_aendern: spur_aendern, gruppenspur_aendern, master_aendern, send_setzen, return_aendern, insert_setzen, insert_param_setzen, insert_an, insert_entfernen, insert_ordnung, rack_setzen, rack_makro).',
    inputSchema: { type: 'object', required: ['pfad', 'nach'], properties: { pfad: { type: 'string' }, nach: zahl('target value'),
      takte: zahl('ramp length in bars (0 = set)', { minimum: 0, maximum: 64 }), ab, form: { type: 'string', enum: ['s', 'linear'] } } },
    lauf: (p) => http('POST', '/regler', p) },
  { name: 'fx', description: 'Beat FX unit 1 or 2: art 1-8 (1 echo, 2 flanger, 3 phaser, 4 filter, 5 reverb: beats = decay time, param1 = size; 6 delay: one repeat, param1 = tone; 7 ping pong: repeats alternate left/right, param1 = feedback; 8 trans: beat gate, param1 = duty; 9 roll: records at on, repeats in beat length; 10 slip roll: like roll, re-records when beats change; 11 vinyl brake: slows to a stop over beats; 12 spiral: echo whose pitch glides when beats change, param1 = feedback), beats, wet 0..1, params 0..1, an. Only while AUTO is on and I am not stopped.',
    inputSchema: { type: 'object', required: ['einheit', 'art', 'beats', 'wet', 'an'], properties: { einheit: { type: 'integer', enum: [1, 2] },
      art: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, beats: { type: 'number' }, wet: zahl('0..1'), param1: zahl('0..1'), param2: zahl('0..1'), param3: zahl('0..1'), an: { type: 'boolean' } } },
    lauf: (p) => http('POST', '/fx', { param1: 0.5, param2: 0.5, param3: 0.5, ...p }) },
  { name: 'fx_zuweisung', description: 'Assign a channel to Beat FX 1 or 2 (kanal like deck/1, pad/1, erz/1, master).',
    inputSchema: { type: 'object', required: ['einheit', 'kanal', 'an'], properties: { einheit: { type: 'integer', enum: [1, 2] }, kanal: { type: 'string' }, an: { type: 'boolean' } } },
    lauf: (p) => http('POST', '/fx/zuweisung', p) },
  { name: 'graphen', description: 'Baukasten graphs in the graph folder ($HOME/.config/cypherdj/baukasten): name, art (instrument = a synth/sampler that plays the notes of a Strudel stream; effekt = an insert with an input), regler_namen (the names of its eight knobs) and geladen (which graph sits on which channel, as the kern reports it; geladen_geprueft_vor_ms = age of the last kern report in ms, null = not known yet). uebersprungen lists files that were not usable (bad name or JSON). Free to read.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/graphen') },
  { name: 'graph', description: 'Put a Baukasten graph on a channel or take it off again (name "" removes). Instruments (art instrument) go on erz/2 (bass stream) or erz/3 (melody stream) and REPLACE that stream\'s sound (Surge or the Cypher synth) until removed or the kern restarts; the stream keeps playing its pattern through the graph. Five more instrument slots: erz/5, erz/6, erz/7 (streams 5, 6, 7) and pad/1, pad/2 (streams 9, 10, the loop boxes L1, L2: a graph on pad/N is summed with the loop of box N, one fader). Streams 5..10 are played by one extra erzeuger process (djk/start/djk-stroeme, or djk-start --bk-stroeme); without it the call fails with kein_erzeuger. Write their patterns with strudel (strom 5, 6, 7, 9, 10); a stream parked without a graph is silent. erz/1 is a drum kit stream: no instrument there. Effects (art effekt) go on deck/1..4 or the send returns fx/3, fx/4; their eight knobs are fx/3/bk/1..8, fx/4/bk/1..8 (regler). Sampler graphs read their files from <graph folder>/samples/ and may take a few seconds to load (the call waits up to 4 s; quittung null = no answer yet; graphen.geladen shows the kern state as soon as it has loaded). Refused while Stop Cypher is set (ki_gestoppt) and, for erz/N, while AUTO of that stream is off (auto_aus). A kern refusal comes back as a tool error with its reason (pruefung, kein_eingang, ...).',
    inputSchema: { type: 'object', required: ['kanal', 'name'], properties: { kanal: { type: 'string', enum: ['erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2', 'deck/1', 'deck/2', 'deck/3', 'deck/4', 'fx/3', 'fx/4'] }, name: { type: 'string', description: 'graph name from graphen, or "" to remove' } } },
    lauf: (p) => http('POST', '/graph', { kanal: p.kanal, name: p.name }) },
  { name: 'strudel', description: 'Send a Strudel pattern to one of the instances: strom 1 drums (erz/1), 2 bass (erz/2), 3 melody (erz/3); with the extra erzeuger process (djk-stroeme) also 5, 6, 7 (erz/5..7) and 9, 10 (pad/1, pad/2), which sound only through a Baukasten graph (graph). Plays from the next bar. Only while Andreas has AUTO on for that instance (auto_aus otherwise). After the next bar, studio shows status.taub: Strudel fields that do not sound in this studio (cutoff = lpf, hcutoff = hpf, room, delay, fmi ...); do not rely on them. taub lists at least these fields once taub_muster equals nr (fields first heard in later bars are added).',
    inputSchema: { type: 'object', required: ['code'], properties: { code: { type: 'string' }, strom: { type: 'integer', enum: [1, 2, 3, 5, 6, 7, 9, 10] } } },
    lauf: (p) => http('POST', '/strudel', { text: p.code, strom: p.strom ?? 1 }) },
  { name: 'abbrechen', description: 'Abort all my running and waiting ramps and deck commands; values stay where they are.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('POST', '/abbruch', {}) },
  { name: 'tempo', description: 'Set the master tempo (60-200 BPM): a 4-beat ramp starting on the next bar. Loop boxes, REC, Strudel and playing decks follow; a deck also starts at any tempo. All sources keep their pitch (keylock, on by default; `keylock` via regler). lage regler.keylock: 1 on, 0 off, null unknown. With keylock off decks and loop boxes follow in varispeed: their pitch moves with the tempo (128 -> 132 is +0.5 semitones). Exceptions with keylock on, still varispeed: a deck in a loop (until loops get keylock), a core started without keylock (kern.toml keylock = false), and about 0.1 s after each deck event (start, jump, hotcue) until the stretcher takes over; lage decks[].hoerweg 1 means the pitch is held. Refused while Stop Cypher is set (ki_gestoppt) and while a project freeze runs (beschaeftigt: proj_freeze, or the freeze inside proj_export; ask again when it is done).',
    inputSchema: { type: 'object', required: ['bpm'], properties: { bpm: zahl('target BPM', { minimum: 60, maximum: 200 }) } },
    lauf: (p) => http('POST', '/tempo', { bpm: p.bpm }) },
  { name: 'ansage', description: 'Show one line on the studio page over every view: what I am doing now, for an audience (demo overlay). Up to 300 characters; an empty text hides it. It fades by itself after a reading time. Speaking through cypher-say with CYPHER_SAY_ZIEL=studio sets the spoken sentence as the line already (shown in the voice colour).',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 300, description: 'the line, empty = hide' } } },
    lauf: (p) => http('POST', '/ansage', { text: p.text }) },
  { name: 'warte', description: 'Wait on the master clock for 1-8 bars, then return the state (lage).',
    inputSchema: { type: 'object', required: ['takte'], properties: { takte: { type: 'integer', minimum: 1, maximum: 8 } } },
    lauf: async (p) => {
      const start = ((await http('GET', '/lage')).j as { uhr: { beat: number } }).uhr.beat, ziel = start + 4 * Number(p.takte);
      const t0 = Date.now();
      for (;;) {
        const l = await http('GET', '/lage');
        if ((l.j as { uhr: { beat: number } }).uhr.beat >= ziel || Date.now() - t0 > 30000) return l;
        await new Promise((r) => setTimeout(r, 100));
      }
    } },
  { name: 'hoeren', description: 'Listen to a deck behind its fader: six bands, loudness, peak, overlap with the '
      + 'running master per band, level difference, EQ suggestion (tief/mitte/hoch in dB) and bass swap hint. Works '
      + 'on a CLOSED deck: start it with deck_start first, wait 4 bars. Use it again after changing EQ or trim. '
      + 'vergleich.trim_vorschlag_db is the absolute target for deck/N/trim in dB (current trim minus the level difference, clamped to -24..+24), meaningful only while the deck is closed; trim_unbekannt: true instead means the studio does not know the current trim (after a server restart), so no suggestion; none either if one side is silent.',
    inputSchema: { type: 'object', required: ['deck'], properties: { deck,
      takte: { type: 'integer', minimum: 1, maximum: 16, default: 4, description: 'bars to measure (default: 4)' } } },
    lauf: (p) => http('GET', `/hoeren?deck=${p.deck}&takte=${p.takte ?? 4}`) },
  { name: 'studio', description: 'Studio state of the Strudel instances (1 drums, 2 bass, 3 melody, plus the Baukasten streams 5, 6, 7, 9, 10 while their erzeuger runs): current pattern, AUTO flag (autonom) and author (von) per instance. Call before playing: AUTO off means Andreas holds that instance and my writes are refused (auto_aus). status.taub lists Strudel fields of the current pattern that do not sound here (at least these once taub_muster equals nr; fields first heard in later bars are added).',
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
  { name: 'loops', description: 'Loop library: name, beats and source of every recorded loop. Use the names with box (laden) and loop_klang.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/loops') },
  { name: 'rec', description: 'Record the master (C, pre-fader) into the loop library: beats 1, 2, 4, 8, 16 or 32, name [a-z0-9_-]{1,32}. Starts on the next multiple of beats. Works at any steady tempo (the loop is stored at 128 BPM and plays back at the master tempo); refused with ausserhalb_bereich while a tempo ramp is running or queued, and by the core while Stop Cypher is set or when a recording overlaps.',
    inputSchema: { type: 'object', required: ['beats', 'name'], properties: { beats: { type: 'integer', enum: [1, 2, 4, 8, 16, 32] }, name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' } } },
    lauf: (p) => http('POST', '/loop', { aktion: 'rec', beats: p.beats, name: p.name }) },
  { name: 'loop_klang', description: 'Turn a library loop into a Strudel sound rec0, rec1, ... (add-on to the drums kit), playable as s("rec0") without restart. Reloads the drums kit: it may cut sounding voices, so do it between phrases, not mid-fill. Refused while Stop Cypher is set or AUTO of instance 1 (drums) is off.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'loop name from loops' }, klang: { type: 'string', description: 'optional sound name' } } },
    lauf: (p) => http('POST', '/loop', { aktion: 'kit', name: p.name, ...(p.klang !== undefined ? { klang: p.klang } : {}) }) },
  { name: 'spur', description: 'Start an automation track: a list of moves on the bar grid, anchored at the next bar (ab: takt, default) or the next phrase (ab: phrase, 8 bars). Arguments: name [a-z0-9_-]{1,32}, fahrten, ab. '
      + 'Each move: {ziel, ab_takt, takte?, nach?, von?, form?: "s"|"linear", muster?}. Targets (ziel): mixer paths (erz/2/filter, deck/1/eq/tief, ...), wirt:bass/<param> and wirt:melodie/<param> (Surge parameters), strom:1..3 (with muster: switch that instance\'s pattern at ab_takt). '
      + 'A track may not open a closed channel and may not touch an instance whose AUTO is off. Andreas touching a control aborts the move on it. Stop it with spur_stopp. '
      + 'Track mixer paths spur/1..32/* (fader, pan, mute, solo of a project track) and the group and master paths grp/1..8/* and pm/fader, the send paths spur|grp/n/send/1..4, the return paths ret/1..4/* (fader, pan, mute, solo, hall/*) and the insert stage paths ins/komp/1..12/*, ins/eq/1..2/*, ins/saett/1/* and ins/lim/1/* (an, decke dBFS -60..0, abklingen ms 1..2000) and the rack macro paths rack/1..12/m1..m4 are refused with ueber_projekt: they change only through the project (proj_aendern: spur_aendern, gruppenspur_aendern, master_aendern, send_setzen, return_aendern, insert_setzen, insert_param_setzen, insert_an, insert_entfernen, insert_ordnung, rack_setzen, rack_makro). '
      + 'A track mixer automation line inside a project is a lane, not a spur: proj_aendern auto_neu / auto_punkte / auto_aendern / auto_loeschen, read it with proj_auto. '
      + 'Loop (Studio track band): schleife_takte n (1..64) plays the moves as a pass of n bars again and again until spur_stopp; every move lies inside the pass '
      + '(ab_takt <= n, a ramp ends at n+1 at the latest, no set on bar n+1, no strom: targets). A hand on a target, AUTO off or Stop Cypher ends my loop. '
      + 'aendern: true changes a running loop of mine (same name, schleife_takte required, it may change) from its next pass, never inside the current one; '
      + 'the answer gives ab_beat/ab_takt (uebernaechster: true when the next pass was already on its way). aendern exists for loops only (keine_schleife) '
      + 'and only for the owner (nur_andreas on his loops).',
    inputSchema: { type: 'object', required: ['name', 'fahrten'], properties: { name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' },
      fahrten: { type: 'array', items: { type: 'object', required: ['ziel', 'ab_takt'], properties: { ziel: { type: 'string' }, ab_takt: { type: 'number' }, takte: { type: 'number' },
        nach: { type: 'number' }, von: { type: 'number' }, form: { type: 'string', enum: ['s', 'linear'] }, muster: { type: 'string' } } } },
      ab: { type: 'string', enum: ['takt', 'phrase'] },
      schleife_takte: { type: 'integer', minimum: 1, maximum: 64 }, aendern: { type: 'boolean' } } },   // 1.12 S7: loop, change of a loop
    lauf: (p) => {
      const spur = { name: p.name, fahrten: p.fahrten, ...(p.schleife_takte !== undefined ? { schleife_takte: p.schleife_takte } : {}) };
      return p.aendern === true ? http('POST', '/spur/aendern', { name: p.name, spur }) : http('POST', '/spur', { spur, ab: p.ab ?? 'takt' });
    } },
  { name: 'spur_stopp', description: 'Stop one of MY automation tracks by name (Andreas\' tracks answer nur_andreas).',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    lauf: (p) => http('POST', '/spur/stopp', { name: p.name }) },
  { name: 'spuren', description: 'Running automation tracks, with the parts the core rejected.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/spur') },
  { name: 'stille', description: 'Silence all Strudel instances from the next bar (tails ring for about 10 s): the three studio streams and every Baukasten stream (5, 6, 7, 9, 10) whose erzeuger runs. All of them are always sent; if AUTO is off on one, that one is reported and the others still go silent.',
    inputSchema: { type: 'object', properties: {} },
    lauf: async () => {
      const stroeme: Json[] = [], fehler: string[] = [];
      let code = 200;
      for (const strom of await stroemeListe()) {
        const r = await http('POST', '/strudel', { text: 'silence', strom });
        code = Math.max(code, r.code);
        stroeme.push({ strom, code: r.code, ...r.j });
        if (r.code >= 400) fehler.push(`strom ${strom}: ${String(r.j.fehler ?? `http ${r.code}`)}`);
      }
      return { code, j: { stroeme, ...(fehler.length ? { fehler: 'teilweise: ' + fehler.join('; ') } : {}) } };
    } },
  { name: 'pegel', description: 'Levels of the last N seconds (1..10, default 3) per channel (erz/1..3, erz/5..7 (Baukasten instruments), pad/1..2, deck/1..2, spur/1..32 for each production track that has content, grp/1..8 for each group that has members, ret/1..4 for each return, pm (the production master after its fader, before the set limiter), master, cue): number of samples, peak dBFS (max_db, -200 = silence) and median of the audible peaks (median_db, null if silent). The peak is the sample peak after the track fader, not loudness: a 808 kick and a quiet pad can show the same peak and sound very different. For loudness per track use proj_lautheit. Read it after every change: master must stay below -3 dBFS, the kick leads.',
    inputSchema: { type: 'object', properties: { sek: { type: 'integer', minimum: 1, maximum: 10, default: 3, description: 'window in seconds (default: 3)' } } },
    lauf: (p) => http('GET', `/pegel?sek=${p.sek ?? 3}`) },
  { name: 'spektrum', description: 'The last frame of the spectrum analyser: 29 bands, three per octave, with the centre of each band in Hz (1000 Hz x 2^(i/3), i = -16..12, i.e. 24.8 Hz .. 16 kHz) and its level in dB (a full-scale sine reads about 0 dB, silence about -90 or lower). '
      + 'Answers {leer:true} while the analyser is off or no frame has arrived yet; right after choosing a source {leer:true} is normal (the window refills first), ask again after about 100 ms. '
      + 'Otherwise {leer:false, kanal (the source: deck/1, bus/2, master ...), rahmen (frame number since the last source change), alter_ms (age of the frame), veraltet (true when alter_ms is above 500 ms: the frame is stale, the analyser has stopped delivering, do not read it as the current sound), baender:[{hz, db}]}. '
      + 'The source is chosen with regler spektrum/kanal (0 off, 1..18 = channel index + 1, 19 = master sum; deck/1..4 = 1..4, erz/1..8 = 5..12, pad/1..2 = 13..14, bus/1..4 = 15..18); this tool only reads and changes nothing.',
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
  { name: 'klang', description: 'Surge XT sounds on the BASS (strom 2) and MELODY (strom 3) instances. gruppe: bass|melodie. aktion: '
      + 'liste (find factory/own patches by regex, e.g. filter "Leads/Acidofil"; no gruppe needed), zeige (current values, optional regex filter), lade (load a patch by name, e.g. "Chords/Minor Chord Retro Stab"), '
      + 'setze (werte {NAME: number}; non-continuous parameters reload the state = audible click), fahre (parameter, ziel, sekunden, optional von: stepless fade, e.g. volume -12 over 15 s from -40), '
      + 'speichere (save the running sound under name [a-z0-9_-]{1,32}), hoere (play a note directly on the host: note 0..127, dauer seconds). '
      + 'If the instance plays Cypher Modular (our own synth, see instrumente) instead of Surge: params (Knob 1..8 with value 0..1 and the knob names from the graph, e.g. "Knob 1": "Cutoff"; free like zeige) '
      + 'and param (name "Knob 1".."Knob 8", wert 0..1, set at once, smoothed 20 ms in the synth); the Surge actions do not apply there. '
      + 'Blend with fahre, never hard-set volume while playing. Writing actions are refused while Stop Cypher is set or AUTO of that instance is off; zeige and liste are free. Values must not start with "-".',
    inputSchema: { type: 'object', required: ['aktion'], properties: {
      gruppe: { type: 'string', enum: ['bass', 'melodie'], description: 'required except for liste' },
      aktion: { type: 'string', enum: ['liste', 'zeige', 'lade', 'setze', 'fahre', 'speichere', 'hoere', 'params', 'param'] },
      name: { type: 'string', description: 'lade: patch name or path; speichere: [a-z0-9_-]{1,32}; param: "Knob 1".."Knob 8"' },
      wert: { type: 'number', minimum: 0, maximum: 1, description: 'param: knob position 0..1' },
      werte: { type: 'object', additionalProperties: { type: 'number' }, description: 'setze: {PARAMETER: number}' },
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
  { name: 'proj_liste', description: 'Production projects (PRODUCTION view): slug, name, last change (geaendert).',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/proj/liste') },
  // 1.9 (L25): the kits a kit track can play, read from the kit folder of the page server
  { name: 'proj_kits', description: 'Kits for kit tracks: the kit folder of the page server (CYPHERDJ_KIT_ORDNER, else ~/.config/cypherdj/kits) lists every folder that holds a kit.json of the right shape: kits [{name, klaenge = number of sounds}], sorted by name. Use a name as geraet.kit in proj_aendern spur_neu / spur_aendern (geraet {art: intern, name: kit, kit}). The server checks only the shape; the core loads the sound files when the playback is loaded and refuses it with reason format when a kit does not load.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/proj/kits') },
  { name: 'proj_neu', description: 'Create a production project and open it: loads its (empty) playback into the core, sets erz/4 (the production group channel) neutral and all 32 track mixer slots. Closes the project that was open: a transport I started stops. While a transport Andreas started or took over with Stop Cypher is running (from the page, the hardware key, or unknown), it is refused with 409 transport_laeuft and nothing is stopped, opened or created: wait until he stops it. Answers slug, rev, spuren (tracks with clips, notes only as noten_zahl), noten_zahl (notes per MIDI clip) and kern, not the whole project: read it with proj_lage.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } },
    lauf: (p) => http('POST', '/proj/neu?antwort=kurz', { name: p.name }) },
  { name: 'proj_oeffnen', description: 'Open a production project by slug (from proj_liste): playback, erz/4 neutral, track mixer, loop, metronome go to the core. kern.regler_fehler lists mixer values the core refused (e.g. Andreas holds that fader); kern.regler_ohne_kern counts values without an answer (no core running). Closes the open project like proj_neu: a transport I started stops; while a transport Andreas started or took over with Stop Cypher is running, 409 transport_laeuft and nothing changes. Answers like proj_neu (slug, rev, spuren with noten_zahl per clip, noten_zahl, kern), not the notes; audio tracks with takes carry `takes_zahl` (count of take lanes); `vorhoeren` maps spur_id to the auditioned take_id. A clip with envelopes (huellkurve_setzen) shows `huellkurven: [{ziel, punkte_zahl, verknuepft? (false = unlinked), loop_beats?}]` without the points (the points via proj_auto clip_id).',
    inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    lauf: (p) => http('POST', '/proj/oeffnen?antwort=kurz', { slug: p.slug }) },
  { name: 'proj_lage', description: 'The open project (tracks with id and nr, clips with id and noten_zahl = number of notes (the notes themselves are not listed), tracks with an automation line show lanes [{id, ziel, punkte_zahl, gesperrt? (true when locked)}] (the points themselves via proj_auto), audio tracks with takes carry `takes_zahl` (count of take lanes); `vorhoeren` maps spur_id to the auditioned take_id (audition with take_vorhoeren), a clip with envelopes (huellkurve_setzen) shows `huellkurven: [{ziel, punkte_zahl, verknuepft? (false = unlinked), loop_beats?}]` without the points (the points via proj_auto clip_id), audio clips with warp {an, modus (repitch | beats | complex | tones), quelle, eins_unsicher, versatz_beats, marker_zahl, beats? (only when set: {raster, loop, huelle}; absent = default transienten/vor/100)} (the markers themselves via proj_warp); analyse [{clip_id, status: wartet|laeuft}] lists tracks the Werkstatt is analysing for a warp (absent when none), mixer, tempo, loop, metronome, rev) and the core state of the arrangement (kern.rev_geladen = playback number loaded, kern.status 0 stopped, 1 waiting, 2 playing). stems {auftrag_id, clip_id, zustand (laeuft | fertig | abgebrochen | veraltet | fehler), stufe (laden | trennen | schreiben), prozent, grund?, text?, hinweis?, spuren?} is the last stem separation of this project (proj_stems), kept after its end; absent when none ran. slug null = no project open. wirte {1: {laeuft, fehler[]}, 2: {laeuft, fehler[]}} says per Surge production host (slot 1 = arr1, slot 2 = arr2) whether it is running and lists the entries of its status file (a running host is never refused for them; for a host that is down a fatal entry makes freeze, export and loudness refuse with wirt_fehler, else wirt_fehlt). baukasten [{kanal, graph}] is the saved sound snapshot (values via proj_bk). A lane the hand has overridden carries uebersteuert: true (Andreas grabbed that field: fader, pan, mute or solo of a track; the lane stays and plays again only after a re-enable, until then the field keeps the value he set); Read it from the lane flag. Give a lane back with proj_auto_zustand. Call before proj_aendern.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/proj/aktuell?noten=zahl') },
  { name: 'proj_aendern', description: 'Change the open project with a list of commands (all or nothing, one undo step, label shows in the history). Each command is {befehl, ...}: spur_neu {art: audio|instrument, name?, gruppe? (text 1..32: tracks with the same gruppe are variants of each other), geraet?: {art: intern (rb338, parameter: lautstaerke, wellenform, cutoff, resonanz, env_mod, decay, accent, each 0..1; or name bk: graph = an instrument graph from graphen, parameter k1..k8 each 0..1, absent = 0.5; the notes of the track play through that graph inside the core, live and in proj_export, no freeze needed; a knob change is spur_aendern with the whole geraet; at most 8 bk tracks; or name kit: kit = a folder name from proj_kits, [a-z0-9_-] 1..32; a one-shot kit track: the notes of the track start the kit sound of that note number at the exact sample, note off is ignored, velocity scales the level, 16 voices per track (the 17th note steals the oldest with a 5 ms fade), a transport start clears the voices; it needs no freeze and plays the same in proj_export and live; the device has no parameter and cannot be automated; the track is named KIT · <kit> unless you give a name; a kit that is not in the kit folder is refused kit_unbekannt (404); at most 8 kit tracks; format cypherdj-projekt/2 only; a kit that does not load in the core refuses the playback with reason format) | wirt (surge, slot 1 or 2: without slot the first free one is taken, each slot is one host (arr1, arr2), a third Surge track is refused slot_belegt; parameter? = a sparse map {name: value} of Surge parameters in the display units of surge_bereiche (at most 32 entries, names like a_filter1_cutoff, a_env1_release; a name or value outside that range is refused argument_unbekannt or argument_ungueltig). An entry is a value the project holds for the host: it is sent to the Surge host when the project opens, on every change, undo and redo, and before a freeze; a parameter not in the map stays as the host patch has it. Absent = no map; spur_aendern takes the whole geraet, so send the whole map)}}; spur_aendern {spur_id, name?, gruppe? (text 1..32, null = leave the group), farbe?, fader_db? (-200..6), pan? (-1..1), mute?, solo?, geraet?, arm? (true|false), eingang? ({art: intern, name: erz/1|erz/2|erz/3|erz/5|erz/6|erz/7|pad/1|pad/2} or null; erz/4 and erz/8 cannot be recorded)}; variante_waehlen {gruppe, spur_id} (one undo step: the chosen variant plays (mute false), all other tracks of that gruppe are muted, tracks outside the gruppe are untouched; the page shows a key row A, B, C per gruppe; to accept a variant delete the others with spur_loeschen); gruppenspur_neu {name?, farbe?, mitglieder?: [spur_id]} (a group track, up to 8; the members play through it: their output moves from master to the group in the same undo step); gruppenspur_aendern {gruppe_id, name?, farbe?, fader_db? (-200..6), pan? (-1..1, a balance: centre is 0 dB), mute?, solo?, gefaltet?}; gruppenspur_loeschen {gruppe_id} (its members go back to master; an unknown gruppe_id here and in gruppenspur_aendern: gruppe_unbekannt); ziel_setzen {strang_id (a track id or a group id), ausgang: "master" | {art: "gruppe", id}} (a track can feed one group; groups do not nest: routing_grenze, a group onto itself: routing_zyklus; unknown strang_id: spur_unbekannt; unknown target group: ziel_unbekannt); master_aendern {fader_db -200..6} (the production master fader; the export is taken here, see proj_export); return_neu {name?, farbe?, hall?: {an?, pre?, decay?, groesse?, tief?, highcut?, fahne?}} (a return strip with Cypher Hall, up to 4: routing_grenze; no arguments gives the default Hall; the Hall values are 0..1 and map to units: pre 0..250 ms, decay 0.1..30 s (log), groesse (size) 5..200 ms, tief (low decay) factor 0.25..4 (log), highcut 1000..22000 Hz (log), fahne (tail level) -24..+12 dB; an = Hall on/off); return_aendern {return_id, name?, farbe?, fader_db? (-200..6), pan? (-1..1), mute?, solo?, hall?: {the same values}, pre? (true = the sends into this return are taken before the track fader and pan, mute and solo still silence them; false = after the fader, the default; a structure change)} (an unknown return_id: return_unbekannt); return_loeschen {return_id} (every send to it goes away in the same undo step); send_setzen {strang_id (a track id or a group id), return_id, db (-200..6, -200 = off)} (how much of the strand goes to the return; sends are post fader and post mute unless the return has pre, so the fader and mute of the track or group also act on the send; a return plays into the master; unknown ids: spur_unbekannt, return_unbekannt); insert_setzen {strang_id (a track, group or return id, or "master"), pos (0..3, at most the chain length; inserts, later stages move back), art: "komp" | "eq" | "saett" | "lim", werte? (lim: {decke -60..0 dB, abklingen 1..2000 ms}; komp: {schwelle -60..0 dB, ratio 1..20, knie 0..24 dB, attack 0.1..100 ms, release 10..1000 ms, makeup 0..24 dB, mix 0..1, schp 0..300 Hz}; saett: {drive 0..36 dB, out -24..12 dB, mix 0..1}; eq: {out -24..24 dB, propq 0|1, and per band m = 1..8 the names "b<m>/an" 0|1, "b<m>/typ" 0..6 (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass), "b<m>/freq" 10..22000 Hz, "b<m>/gain" -24..24 dB, "b<m>/q" 0.1..18, "b<m>/steil" 0..3 (12, 24, 36, 48 dB per octave), "b<m>/platz" 0..2 (stereo, mid, side)}; every band starts off, so a new EQ is flat), sc? (compressor only: 0 = own signal, n = the input of track number n), key? (compressor only, every other sidechain source: {quelle: spur | grp | ret | deck | erz, nr, punkt: pre | post}; spur with punkt post = the output of track nr after its fader and mute; grp and ret = group or return nr; deck nr 1..4 and erz nr 1 = the DJ mixer inputs, live only (punkt is left out); {quelle: spur, nr, punkt: pre} is the same as sc: nr; sc and key together: argument_ungueltig; a key is a structure change, a stage has one key at most), ersetzen? (true = replace the stage at pos), preset? (register id <werk|nutzer>:<geraet>/<slug> of the preset the values come from; the page sets it when a preset is dropped)} (a stage in the strip chain before the fader, at most 4 stages per strip; pools: 12 compressors, 2 EQs, 1 saturator and 1 limiter in the project: kette_voll, ins_voll, art_unbekannt; an EQ or saturator delays its strip by 69 samples, a limiter by 74 samples; the core compensates that, so every strip stays in time and the project is that much later against the transport, the export skips it; a structure change); insert_param_setzen {insert_id, param (one of werte, or sc on a compressor, or key on a compressor with wert = a key object as in insert_setzen or null to remove it; sc and key replace each other), wert} and insert_an {insert_id, an} (live, no new playback; changing sc between non-zero values is live too, but sc 0 or key with a key present, and any key change, is a structure change); duck_durch_kick {spur_id, kick_id, pos?} (Duck by Kick: a compressor stage on spur_id with the values of the Kick Sidechain preset (threshold -30 dB, ratio 8, knee 0, attack 1 ms, release 150 ms) keyed by the input of the kick track kick_id (sc = its number); pos defaults to the end of the chain; one undo step; refusals: kette_voll, ins_voll, spur_unbekannt, argument_ungueltig for the same track);  insert_entfernen {insert_id} (removes the stage; the slot goes back to the pool and the later stages move up; rack mappings onto it are removed with it, insert_unbekannt for an unknown id); insert_ordnung {strang_id, reihenfolge: [insert ids]} (a permutation of the chain); insert_werte_setzen {insert_id, werte (some of the insert_setzen werte, same names and ranges), preset? (register id <werk|nutzer>:<geraet>/<slug>, null clears it)} (several values of one stage in one undo step, live, no new playback; an and sc stay; applying a preset uses it); insert_setzen and the intern devices (rb338, bk) also take preset? and geraet.preset: the register id of the preset last applied, kept in the project, not part of the sound; changing a device\'s values on a frozen track drops the freeze; a change of only `preset` keeps it; rack_setzen {strang_id, makros: [up to 4 entries {name? (max 24 characters), ziel: [{insert (a stage id from the chain of that strip), param (a continuous parameter of that stage as in werte, not an, not sc, not a step list such as b1/typ), von, bis}]}]} (the whole mapping table of the rack of that strip: four macro knobs, each drives the listed parameters from von (macro at 0) to bis (macro at 1) in the real unit, von may be above bis; at most 16 mappings per strip: makro_voll, at most 12 racks in the project: rack_voll, one macro per parameter: ziel_doppelt, only continuous parameters: param_nicht_stetig; no mapping at all removes the rack; a mapping change is a structure change); rack_makro {strang_id, nr (1..4), wert (0..1)} (move a macro knob of the rack of that strip, live, no new playback; rack_unbekannt when the strip has no rack; while a parameter is mapped the own row of that parameter is ignored and insert_param_setzen on it is refused with param_gemappt, remove the mapping with rack_setzen first); sidechain key refusals of insert_setzen, insert_param_setzen and duck_durch_kick: sidechain_spaet (the source is computed after the stage: a track stage can listen to tracks and the DJ inputs only; groups also to the pre of other groups; returns also to groups; the master to everything but itself), sidechain_zyklus (the key would depend on the stage itself: its own strip, a member track keyed by its own group, two or more tracks keying each other through their post, the production master as a source, erz/4), sidechain_quelle (not available in the arrangement: erz/2, erz/3, erz/5 to erz/8, pad/1, pad/2); a key naming a strip that does not exist: spur_unbekannt, gruppe_unbekannt, return_unbekannt; deleting a track, group or return removes the keys that point at it in the same step; rack_makro {strang_id, nr (1..4), wert (0..1)} (move a macro knob of the rack of that strip, live, no new playback; rack_unbekannt when the strip has no rack; while a parameter is mapped the own row of that parameter is ignored and insert_param_setzen on it is refused with param_gemappt, remove the mapping with rack_setzen first); spur_loeschen {spur_id} (the track goes with its clips); spur_verschieben {spur_id, index} (index = the new position in the track list, 0 = first; index_bereich outside 0..tracks-1); clip_neu {spur_id, art: audio|midi, start_beat, laenge_beats, loop_beats? (null or missing = off, else 1/16..laenge_beats: the clip repeats [0, loop) up to its length; audio and MIDI), name? (the library title for audio), sha256? (audio: only a sha from the library, see stoebern/klaenge), pfad_hinweis? (audio: text up to 4096 characters, the file path the sha came from; only a hint stored with the source, it names the clip when name is missing), noten? (midi), warp? (audio: "auto" warps a loop or track to the project tempo from the library data, the server then computes laenge_beats from the warp and yours is only the fallback; one-shots and samples without a tempo stay unwarped; "aus" or missing = no warp; or a whole warp object)}; clip_aendern {clip_id, start_beat?, laenge_beats?, loop_beats? (null = off, else 1/16..laenge_beats: the clip repeats [0, loop) up to its length), offset_s? (refused with offset_bei_warp on a warped clip), versatz_beats? (warped clips only: which beat of the warp plays at the clip start), gain_db? (-96..24), fade_ein_beats?, fade_aus_beats? (fades >= 0, together at most laenge_beats), stumm? (audio clips only: true mutes the clip in the arrangement and in exports, false makes it audible again (null is refused); proj_stems mutes the original this way), spur_id?, name?, entstehung? (provenance of a stream take: {art: "strom", strom: 2|3, graph, regler: 8 numbers 0..1, code, bpm}, written by proj_strom_aufnehmen; null deletes it)}; clip_teilen {clip_id, beat} (splits at a project beat strictly inside the clip, beat_ausserhalb otherwise; a clip with a loop must have it switched off first); clip_duplizieren {clip_id, ziel_beat?} (a copy on the same track, at ziel_beat or directly after the original); clip_loeschen {clip_id} (the clip goes with its notes); warp_setzen {clip_id, an? (false keeps the markers but plays the clip unwarped), modus? (repitch | beats | complex | tones. repitch: the pitch follows the tempo like a record; beats: drums, every slice starts on its beat at its own speed and keeps its shape, played by the core without the warp engine; complex: whole tracks, the pitch stays; tones: tonal material, finer grains. complex and tones are stretched ahead of time by the warp engine of the core, 64 voices; a core without it refuses them with warp_maschine_fehlt and a full pool plays the clip as repitch), transpose_st? (whole semitones, -12 to 24), detune_ct? (cents, -50 to 50; together -12 to 24 semitones: transpose_st x 100 + detune_ct within -1200..2400; only in complex and tones, they re-render the clip ahead of time, so a change is heard after a short moment; repitch follows the tempo like a record and refuses any value but 0 with transpose_repitch, so set modus repitch together with transpose_st 0 and detune_ct 0), beats? (the whole parameter object, written beats {raster: transienten | 1/4 | 1/8 | 1/16 | 1/32, loop: aus | vor | vor_zurueck, huelle: 0..100}; read only in mode beats and kept when the mode changes; default transienten/vor/100: raster = where each slice starts (at the transients of the audio, without a transient list on 1/16), loop = what fills the gap when the tempo is slower than the audio (aus: silence, vor: the end of the slice looped forward, vor_zurueck: back and forth), huelle = 100 keeps each slice whole, lower fades it out sooner; beats follows the tempo like repitch and refuses transpose_st and detune_ct other than 0 with transpose_repitch), or warp: {the whole warp object} / null to remove it}; warp_auto {clip_id} (sets the warp from the best source: the Werkstatt analysis map with every beat as a marker, else the Traktor grid, else the bars (takte), else the library BPM; refused with kein_tempo when there is none, except for a long track (60 s and more) without a map or a grid: then the Werkstatt analyses it in the background, the answer carries hinweise analyse_angefordert and the clip is warped when the analysis arrives; the clip length stays); clip_neu with warp "auto" and warp_auto warp in this order: (1) the Werkstatt analysis map of the file (same sha256), one marker per beat, marker beat 0 = the first bar one, the clip starts there and is as long as the rest of the file; eins_unsicher when the analysis was unsure; (2) the Traktor grid (anchor and BPM, eins_unsicher); (3) loops with bars (takte) lie on takte x 4 beats; (4) the library BPM from second 0 (for a track the bar one is then unsure). One-shots never warp. Warp by hand (all take a clip with a warp, else kein_warp; beats here are CLIP beats = the beat of a marker, 0 = the bar one of the source; every one is a single undo step and sets quelle hand): warp_tempo {clip_id, faktor: 2 | 0.5} (x2 or :2: every marker beat, the offset, the clip length and the loop length are multiplied, so every segment tempo is multiplied; the same piece of the source takes twice (half) as many beats; refused with warp_faktor when a segment would leave 15..800 BPM); warp_marker {clip_id, setze?: [{quell_s, beat?}] (a marker at source second quell_s; without beat it gets the beat the grid has there, so the sound does not change), loesche?: [beat], verschiebe?: [{beat, neu_quell_s | neu_beat}] (the marker that has this beat now; neu_quell_s moves it in the source and keeps its beat, neu_beat keeps its source second and moves its beat)} (order: delete, move, set; refused with marker_unbekannt when no marker has that beat, with warp_marker when the result is not strictly rising or has under 2 or over 4096 markers; the clip length stays); warp_ab_hier {clip_id, beat, art: gerade | start} (Warp From Here: gerade replaces every marker from that clip beat on by ONE segment with the tempo that holds there; start sets the auto warp again from there on, like warp_auto, and needs a tempo source, else kein_tempo; the clip length stays); eins_hier {clip_id, quell_s} (Set 1.1.1 Here: source second quell_s becomes beat 0, rounded to the nearest whole beat of the analysis map in the correction line. The clip starts there (offset unchanged), so the track moves on the project by the beats the point lay behind the old bar one (like Live); its length changes so it plays the same end of the source; eins_unsicher becomes false. If the track is in the deck stock and this server writes corrections, a line von andreas (also when Cypher sends it) is saved: the next auto-warp of that track starts there and the decks use it after their next render; undo takes back the clip, not the line; hinweise tell: eins_gemeldet, eins_nur_hier (no line written: the track is not in the stock or this server writes none, only this clip changed), eins_rueckweg_fehler (the clip changed, the line could not be written)); tempo_vom_clip {clip_id} (sets the project tempo to the tempo at which the clip plays as long as the piece of the source it uses, 60 x laenge / (source seconds); refused like tempo_setzen: deck_laeuft, tempo_bereich); audio_quantisieren {clip_id, raster: 1/4|1/8|1/16|1/32, staerke? (0..1, default 1), von_beat?, bis_beat? (clip beats, the beats of the markers, 0 = 1.1.1 of the source; not project beats; default: the range of the clip)} (Quantize Audio: the grid is the project grid (a clip that starts off the grid still lands on it); moves the hits onto the grid by setting a hand marker at each transient of the audio, strength 1 puts it exactly on the grid line, 0.5 half way; markers outside the range stay, the ones inside are replaced; clip length stays, one undo step; refused with transienten_fehlen when the audio is not decoded yet, keine_transienten when the range holds none, quantisieren_konflikt when the new markers would not rise strictly, warp_faktor or warp_marker when a segment would leave 15..800 BPM or the marker count 4096: nothing is shortened silently); noten_neu {clip_id, noten: [{beat (in the clip), laenge, ton 0..127, vel 1..127}]}; noten_aendern {clip_id, noten: [{id, ...changed}]} (changes the given fields of existing notes: beat, laenge, ton, vel); noten_loeschen {clip_id, ids} (ids = note ids from proj_lage notes; an unknown id: noten_unbekannt); take_neu {spur_id, name?} (a new empty take lane on an audio track); take_umbenennen {spur_id, take_id, name} (renames a take; its kind stays, the Original lane keeps its mark); take_loeschen {spur_id, take_id} (removes the take lane only; it leaves the main track untouched); comp_waehlen {spur_id, take_id, von_beat, bis_beat} (copies [von_beat, bis_beat) from the take lane into the main track and replaces exactly that range there; gaps in the take become silence; four ms fades at the seams; one undo step; if the range is already equal nothing changes; it switches no playback: to listen to a take use take_vorhoeren). Recording onto an armed audio track writes the take into the main track, where it replaces the range, and at the same time into a take lane: the newest lane if it is empty in that range, else a new lane "Take <n>". The lane "Original" is never chosen for this; overwritten material that is not itself a take goes into it. Take refusals: take_unbekannt (404), takes_voll (at most 32 lanes per track), take_nur_audio, take_name_ungueltig, comp_leer; auto_neu {spur_id, ziel: "fader" | "pan" | "mute" | "solo" | "geraet.lautstaerke" | "geraet.cutoff" | "geraet.resonanz" | "geraet.env_mod", punkte?: [{beat, wert, form?}] (the lane and its points in one command, checked like auto_punkte; without it the lane starts as described below; this is also how a recorded take is written)} (a line under the track for one target; it starts as two points at the loop brackets on the current value of that target; ranges of wert: fader -200..6 dB (-200 = off), pan -1..1, mute and solo 0 or 1 (always jumps, form sprung), geraet.* 0..1 and only on tracks with the RB-338 device (not the bk device) (otherwise ziel_unbekannt; switching such a track to a host device while it has geraet.* lanes is refused with geraet_lanes from spur_aendern: delete the lanes first); one lane per target and track, else lane_doppelt; an unknown ziel: ziel_unbekannt; the value of the track itself stays the base value that sounds when the transport stops or the lane is gone); auto_punkte {lane_id, setze?: [{beat (project beat 0..100000), wert (in the unit and range of the lane target, see auto_neu), form? linear (default) | s | sprung}], loesche_von?, loesche_bis? (project beats, both ends included)} (first deletes the points from loesche_von to loesche_bis, then sets the given ones; a set point replaces every point at its beat; two points at the same beat make a jump, three are refused; beats rise; 1..8192 points per lane, 65536 per project: punkte_ungueltig, zu_gross; a wert outside the range of the target: punkte_ungueltig; to remove the last point use auto_loeschen); auto_loeschen {lane_id} (lane_unbekannt for an unknown lane_id); auto_aendern {lane_id, gesperrt: boolean} (lock or unlock a lane; on a locked lane auto_punkte and auto_loeschen are refused with lane_gesperrt (409) until it is unlocked; proj_auto and proj_lage show gesperrt: true); the lane editor tools (each one undo step, refused on a locked lane with lane_gesperrt; von_beat < bis_beat inside 0..100000, else bereich_leer): auto_vereinfachen {lane_id, von_beat, bis_beat, toleranz? (default per target: fader 0.3 dB, pan 0.008, geraet.* 0.004)} (thins the points in the range while the line stays within the tolerance; only runs of linear segments are thinned, every s or sprung point and its neighbours stay, so mute and solo lanes come back unchanged); auto_dehnen {lane_id, von_beat, bis_beat, neu_bis_beat (> von_beat)} (stretches the points in (von_beat, bis_beat] onto (von_beat, neu_bis_beat]; points that lay in the new span go; after the later of bis_beat and neu_bis_beat the line keeps its values); auto_neigen {lane_id, von_beat, bis_beat, faktor -1..1} (skews the timing inside the range: a point at the share u of the range moves to u^(4^faktor), values and forms stay, 0 changes nothing, 1 pulls the points towards von_beat); auto_form {lane_id, von_beat, bis_beat, form: rampe_auf | rampe_ab | sinus | dreieck | rechteck, perioden? 1..64 (default 1), unten?, oben? (default: fader -60..0 dB, pan -1..1, geraet.* 0..1)} (replaces the points in the range by the shape; at both edges a jump keeps the old value outside; mute and solo take rechteck only, else form_ungueltig); clip envelopes (slice 5, one per target and clip, set as a whole): huellkurve_setzen {clip_id, ziel: gain | transpose | spur_fader | spur_pan | geraet.lautstaerke | geraet.cutoff | geraet.resonanz | geraet.env_mod, punkte: [{beat (CLIP beat: from the clip start, 0..100000, rising, at most two at one beat = a jump), wert, form? linear (default) | s | sprung}] (1..8192), verknuepft? (only false is stored: unlinked), loop_beats? (only with verknuepft false, 1/16..clip length)} (the envelope of that target replaces the old one; gain: audio clips only, dB -200..0 on top of gain_db, a ramp from or to -200 runs from -60 like the fader; transpose: MIDI clips only, semitones -48..48, rounded at the start of each note (a note keeps its pitch while it sounds); spur_fader (dB -60..6), spur_pan (-2..2) and geraet.lautstaerke | cutoff | resonanz | env_mod (-1..1, MIDI clips on RB-338 tracks only) are RELATIVE: they ride on top of the track\'s own value or lane (the sum is clamped to the range of the target), so a track lane and a clip envelope on the same target work together; linked (default): the points of [0, clip loop) repeat with every loop copy of the clip; unlinked (verknuepft false): they repeat modulo loop_beats from the clip start over the whole clip, whatever the clip loop is (without loop_beats they do not repeat); the clip commands keep them consistent (clip_teilen cuts them at the split, clip_duplizieren copies them); there is no lock for envelopes; refused: huellkurve_ziel (400, the target does not fit this clip), punkte_ungueltig, zu_gross, argument_ungueltig, clip_unbekannt (404), geraet_huellkurven (400 from spur_aendern: a track with geraet.* envelopes cannot switch to a host device)); huellkurve_loeschen {clip_id, ziel} (huellkurve_unbekannt 404 when the clip has none); read an envelope back with proj_auto clip_id and ziel; tempo_setzen {bpm 60..200} (refused while a deck plays: deck_laeuft); loop_setzen {an, von_beat, bis_beat} (the loop range in project beats, at least 1 beat long: loop_bereich); metronom_setzen {an?, pegel_db? -60..0, ziel? master|cue} (the metronome on/off, its level and where it plays; at least one field); bk_setzen {kanal e.g. erz/2, graph (name) | null (removes the entry), regler? [8 values 0..1], sha256?} edits the sound snapshot (normally proj_bk does this); geraet_richtung {spur_id, wort, staerke? (1..3, default 1)} (description to sound on an RB-338 track: a word moves the device parameters by bounded steps of 0.12 x staerke, clamped to 0..1: bright (cutoff up, env_mod up), dark (cutoff down, env_mod down), aggressive (resonanz up, accent up), soft (resonanz down, accent down), tight (decay down: on the RB-338 this only shortens the decay of the filter envelope, a slightly shorter bright tail, not the amplitude, so the note keeps its length), deep (cutoff down by ' + DEEP_FAKTOR + ' steps, volume untouched); one undo step, name it with the label "<word> <track name>"; a word the device does not know is refused richtung_unbekannt (404) and the detail lists the words it knows; a track that is not an RB-338 or Surge (audio, bk, kit) knows none. On a Surge track the words are bright, dark (a_filter1_cutoff +/-), aggressive, soft (a_filter1_resonance +/-) and tight (a_env1_release and a_env1_decay down); they move entries of the parameter map of the device by the bounded steps of the table in projekt/richtung.ts times staerke, clamped to the range of surge_bereiche, starting from the value the map holds or, when it holds none, from the value the host plays now (read from the host; when the host is not running the word is refused wirt_wert_unbekannt (409) and nothing changes); deep does not exist on Surge and is refused richtung_unbekannt; when every parameter of the word is already at its bound the call is refused richtung_grenze (409) and nothing changes); preset_anwenden {spur_id, preset} (sets the whole parameter object of an RB-338 track from a preset: preset = an id from presets_suchen like werk:rb338/dark-dub; a parameter the preset does not name goes back to the plugin default; one undo step; an unknown preset is preset_unbekannt (404), an id that is not <werk|nutzer>:rb338/<slug> or a track that is not an RB-338 is argument_ungueltig). Beats are project beats (4/4). Solo on a track keeps its group sounding, solo on a group keeps all its members sounding; mute on a group silences its members. rev defaults to the current one (proj_lage); rev_veraltet means someone changed it in between: read again. regler_abgelehnt: the core refused a mixer value (nothing was changed). The arm of spur_aendern is the audio record arm (proj_aufnahme), not the automation record arm: arming a track to record fader, pan, mute or solo moves into a lane is Andreas\' hand (refused with nur_andreas, no tool exists for it). Stop Cypher stops only my hand: it lowers no fader, and what sounds keeps sounding (the track field von is cypher and never changes, it controls nothing). Answers rev, kern (what the core acknowledged) and noten_zahl (notes per MIDI clip), not the project: read it with proj_lage. hinweise [{index, hinweis}] appears when an auto-warp has something to say: kein_tempo (no source found: the clip was made without warp), analyse_angefordert (a long track has no map yet: the Werkstatt analyses it in the background and the clip is warped when it arrives, one history entry "Auto-Warp"; proj_lage lists the running analyses under analyse), analyse_laeuft (that analysis is already running), karte_zu_gross or karte_unbrauchbar (the analysis map was not usable, the next source was taken). Warp refusals: kein_warp, warp_marker, warp_faktor (segment tempo outside 15..800 BPM), warp_modus, transpose_repitch, offset_bei_warp, kein_tempo, warp_auto_neuer_clip (warp_auto names a clip created in the same list: use clip_neu with warp "auto").',
    inputSchema: { type: 'object', required: ['label', 'befehle'], properties: { label: { type: 'string', minLength: 1, maxLength: 200 },
      befehle: { type: 'array', minItems: 1, items: { type: 'object' } }, rev: { type: 'integer', minimum: 0 } } },
    lauf: (p) => mitRev(p, '/proj/aendern', { label: p.label, befehle: p.befehle }) },
  { name: 'proj_undo', description: 'Undo the last change of the open project (any source). rev defaults to the current one. Answers like proj_aendern (rev, kern, noten_zahl).',
    inputSchema: { type: 'object', properties: { rev: { type: 'integer', minimum: 0 } } }, lauf: (p) => mitRev(p, '/proj/undo', {}) },
  { name: 'proj_redo', description: 'Redo the last undone change (gone after a new change). rev defaults to the current one. Answers like proj_aendern (rev, kern, noten_zahl).',
    inputSchema: { type: 'object', properties: { rev: { type: 'integer', minimum: 0 } } }, lauf: (p) => mitRev(p, '/proj/redo', {}) },
  { name: 'proj_verlauf', description: 'History of the open project: rev, zeit (ms since 1970), quelle (andreas or cypher), label, art (aendern, undo, redo).',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/proj/verlauf') },
  { name: 'proj_transport', description: 'Arrangement transport: start (from beat, default 0) or stopp. If the master tempo differs from the project tempo and no deck plays, the master ramps to it first (one bar) and the start waits. quant 2 (on the bar) while a deck, loop box or open Strudel channel plays, else 0 (immediately). Stop Cypher stops no running transport, not even one I started: it keeps running and belongs to Andreas from then on (he takes over), so after Release start and stopp are refused with 409 transport_laeuft until he stops it. A start of mine that is still waiting for its downbeat, or for the tempo ramp before it, is dropped instead when Stop Cypher is pressed (ok false, quittung 7 ki_stopp, nothing is started); after Release I start again. I stop only a transport I started and he has not taken over, and I start only while no transport Andreas started is running: while one is running (from the page, the hardware key, after Stop Cypher, or unknown), start and stopp are refused with 409 transport_laeuft and nothing is sent, because the transport is his and a start would end his run; ask him.',
    inputSchema: { type: 'object', required: ['aktion'], properties: { aktion: { type: 'string', enum: ['start', 'stopp'] }, beat: zahl('project beat to start from', { minimum: 0 }) } },
    lauf: (p) => http('POST', '/proj/transport', p.beat === undefined ? { aktion: p.aktion } : { aktion: p.aktion, beat: p.beat }) },
  // Paket S3 (Spec D1 3.4, 3.5, 6.31): Freeze und Export des geöffneten Projekts, schmale Antworten; Stop Cypher sperrt beide (409 ki_gestoppt)
  { name: 'proj_freeze', description: 'Freeze a Surge (host) track of the open project: the core plays its notes once in real time (from the first to the last MIDI clip with sounding notes, plus 2 beats; at 124 BPM 8 bars take about 16 s, the call waits that long), and the track then plays as audio, live and in exports. an false discards the freeze (no run). Editing the notes, the instrument or the tempo discards it as well; undo brings it back. While it runs, note, clip, tempo and transport changes are refused (409 beschaeftigt), mixer changes go through. Answers rev, spur_id and freeze {datei, frames, kennung, sha256, von_beat} (null after discarding), not the project; one undo step ("Freeze <track>"). Refused: ki_gestoppt (Stop Cypher), transport_laeuft (stop it first), beschaeftigt (a freeze or export runs, a project is being opened, or the tempo is still ramping), keine_wirtspur, spur_leer (no sounding notes), zu_gross (over 256 beats), deck_laeuft, kein_kernstand, nicht_geladen, veraltet (the track changed meanwhile), wirt_fehlt (the Surge host for the slot of the track is not running: start djk-instrumente --arr1 or --arr2), wirt_fehler (that host is down and its status file holds a fatal entry, which the refusal quotes: fix it, then start the host again), freeze_fehler (the core aborted or restarted; nothing saved). ' + fristText('proj_freeze'),
    inputSchema: { type: 'object', required: ['spur_id', 'an'], properties: {
      spur_id: { type: 'string', description: 'track id from proj_lage, e.g. s3' },
      an: { type: 'boolean', description: 'true = freeze, false = discard the freeze' } } },
    lauf: (p) => httpLang('proj_freeze', '/proj/freeze?antwort=kurz', { spur_id: p.spur_id, an: p.an }) },
  { name: 'proj_export', description: 'Export the open project as WAV (48 kHz, 32 bit float) into its export folder (never overwrites): the loop range by default, or von_beat..bis_beat (1 to 1024 beats). Unfrozen Surge tracks with notes are frozen first in real time (see proj_freeze, one undo step each), then the core renders offline at low priority (a few seconds for 8 bars); the call waits for both. RB-338 and Baukasten (bk) tracks render offline directly, without a freeze. the export is taken at the production master (abgriff production, the default): after the master fader of the production (pm/fader) but before the DJ glue, the DJ master fader and the set limiter, so a mastering chain outside gets the unlimited signal; abgriff set is the signal as the room hears it (after the set limiter); loudness is measured on the written file. Answers {datei, frames, spitze_db, regler_quelle, abgriff, ueber_decke, limiter_db_max, lufs_i, lra, true_peak_dbtp, and dj_schluessel: true only when a compressor stage is keyed by a DJ input (deck or erz): no deck plays in a render, so that stage does not duck in the file}: regler_quelle kern = mixer as the running core has it, projekt = from the project file because no core ran since boot; ueber_decke true = the sample peak of the file is above the limiter ceiling (kern.toml limiter_dbtp): with abgriff production the set limiter would have reduced it, limiter_db_max is the largest reduction in dB it made while rendering (0 = never); the page shows SET LIMITER when it reduces while you listen; the loudness fields are null with loudness_fehler when ffmpeg failed (the WAV is still written). The transport must be stopped. Refused: ki_gestoppt, transport_laeuft, beschaeftigt (a freeze or export runs), export_bereich, audio_fehlt (an audio clip is still being prepared), kein_kernstand (a track needs freezing but the core has not reported), veraltet, wirt_fehlt (a track needs freezing but the Surge host of its slot is not running: start djk-instrumente --arr1 or --arr2; checked for every slot before the first freeze), wirt_fehler (that host is down with a fatal entry in its status file, quoted), freeze_fehler, render_fehler. ' + fristText('proj_export'),
    inputSchema: { type: 'object', properties: {
      von_beat: zahl('first beat (default: loop start)', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (default: loop end)', { minimum: 1 }),
      abgriff: { type: 'string', enum: ['produktion', 'set'], description: 'tap of the export: production master (default) or the master after the set limiter' } } },
    lauf: (p) => httpLang('proj_export', '/proj/export', { ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}), ...(p.bis_beat !== undefined ? { bis_beat: p.bis_beat } : {}), ...(p.abgriff !== undefined ? { abgriff: p.abgriff } : {}) }) },
  // Paket 1.18, E-b: Lautheit je Spur und als Summe, offline und auf Anfrage (kein Dauerbetrieb im Kern); friert Wirt-Spuren vorher ein wie proj_export
  { name: 'proj_lautheit', description: 'Measure loudness per track of the open project, offline and on request: the server renders every sounding track alone (its own fader and pan from the project, then through its group and the production master, all other tracks silent, no deck or master state of the core) and once all together, then measures each WAV with ffmpeg. Range: the loop range by default, or von_beat..bis_beat (1 to 1024 beats). Unfrozen Surge tracks with notes are frozen first in real time (see proj_freeze; needs the Surge host for the slot of each track, arr1 or arr2, else wirt_fehlt or wirt_fehler). Answers {von_beat, bis_beat, spuren: [{spur_id, nr, name, lufs_i, lra, true_peak_dbtp, spitze_db, stumm, unter_messgrenze}], summe: {lufs_i, lra, true_peak_dbtp, spitze_db, unter_messgrenze, regler_quelle}}. lufs_i is integrated loudness in LUFS (use it to match the kick: the sample peak misleads for a 808 kick), lra loudness range in LU, true_peak_dbtp in dBTP, spitze_db the sample peak in dBFS at the production master (before the set limiter). A muted track (or one with the fader off, or silent in the range) answers stumm true and lufs_i null (not -70). If any track or group of the project is on solo, a track without solo that is not in a group on solo counts as muted, like in the mix (stumm true, not rendered). A track that is quiet but not silent, below the measuring floor of -70 LUFS (peak between -90 and about -68 dBFS), answers unter_messgrenze true, stumm false, lufs_i and lra null (not -70.0) and true_peak_dbtp as measured; the same holds for the sum. Tracks without content in the range are not listed. The sum equals proj_export of the same range (default abgriff production) within 0.1 LU. Nothing is written into the project or the export folder. The transport must be stopped. Refused: ki_gestoppt, transport_laeuft, beschaeftigt (a freeze, export or measurement runs), export_bereich, audio_fehlt, wirt_fehlt (a track needs freezing but the Surge host of its slot is not running: start djk-instrumente --arr1 or --arr2), wirt_fehler (that host is down with a fatal entry in its status file, quoted), render_fehler. ' + fristText('proj_lautheit'),
    inputSchema: { type: 'object', properties: {
      von_beat: zahl('first beat (default: loop start)', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (default: loop end)', { minimum: 1 }) } },
    lauf: (p) => httpLang('proj_lautheit', '/proj/lautheit', { ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}), ...(p.bis_beat !== undefined ? { bis_beat: p.bis_beat } : {}) }) },
  // Paket 1.13 Slice 7: merge selected tracks into one new audio track by an isolated render (one undo step)
  { name: 'proj_zusammenfuehren', description: 'Merge selected tracks of the open project into ONE new audio track (merge, AK27): the server renders exactly '
    + 'these tracks '
    + 'over von_beat..bis_beat with their own faders and pans, their group and the production master neutral (a null '
    + 'test against the solo export of the sources '
    + 'is below -90 dBFS), writes the WAV into the project folder (merge/merge-<id>.wav, never replaced) and in ONE '
    + 'project change adds the new track with one clip '
    + 'and mutes the sources. 2 to 32 distinct spur_ids; a Stems group is chosen by its four tracks. The new track is '
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
      spur_ids: { type: 'array', minItems: 2, maxItems: 32, items: { type: 'string' }, description: 'ids of the tracks to merge (2 to 32, distinct)' },
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
    + 'transport_laeuft, beschaeftigt, and export_bereich (1 to 1024 beats), audio_fehlt, render_fehler (502). ' + fristText('proj_bounce'),
    inputSchema: { type: 'object', required: ['art'], properties: {
      art: { type: 'string', enum: ['an_ort', 'neue_spur', 'einfuegen'], description: 'an_ort: in place; neue_spur: to new track; einfuegen: paste' },
      spur_id: { type: 'string', description: 'an_ort: the audio track to bounce in place' },
      spur_ids: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string' }, description: 'neue_spur or einfuegen: the source tracks (1 to 32)' },
      gruppe_id: { type: 'string', description: 'neue_spur instead of spur_ids: all tracks whose target is this group' },
      von_beat: zahl('neue_spur (optional) or einfuegen: first beat of the range', { minimum: 0 }),
      bis_beat: zahl('neue_spur (optional) or einfuegen: end beat, exclusive (1 to 1024 beats)', { minimum: 1 }),
      ziel_spur_id: { type: 'string', description: 'einfuegen: the audio track that receives the clip' },
      ziel_beat: zahl('einfuegen: the beat where the clip starts', { minimum: 0 }) } },
    lauf: (p) => httpLang('proj_bounce', '/proj/bounce?antwort=kurz', Object.fromEntries(
      ['art', 'spur_id', 'spur_ids', 'gruppe_id', 'von_beat', 'bis_beat', 'ziel_spur_id', 'ziel_beat'].filter((k) => p[k] !== undefined).map((k) => [k, p[k]]))) },
  // 1.8 Task 28: Aufnahme auf armierte Audio-Spuren (interner Strom erz/1..3); Server: POST /proj/aufnahme, Quelle cypher
  { name: 'proj_aufnahme', description: 'Record onto the armed audio tracks of the open project. aktion start {von_beat? default 0}: arms the core for each track set with proj_aendern spur_aendern {arm: true, eingang: {art: intern, name: erz/1|erz/2|erz/3|erz/5|erz/6|erz/7|pad/1|pad/2}}, starts the transport and records from its start; the take is the internal stream of that input, taken before the mixer fader (erz/1 is the Strudel channel; erz/5..7 are Baukasten instruments, pad/1 and pad/2 the pad graph summed with the loop of that box). aktion stopp: stops the transport, saves the takes as files in the project folder (aufnahmen/take-<kennung>-<spur>.wav), places one clip per track (replacing what was there) as ONE undo step, and answers takes [{spur_id, frames, luecken, datei} or fehler]. If the transport was stopped some other way (proj_transport, the hand key, the end of the arrangement) the take is saved by itself; aktion stopp then returns that result once, and proj_aufnahme without a running recording shows it under letzte. Refused: nichts_scharf (no armed track), ueberlappung (a transport is running), transport_laeuft (Andreas\' transport is running: wait), ki_gestoppt, aufnahme_laeuft, keine_aufnahme (stopp without a running recording and nothing to hand over), aufnahme_abgebrochen (the core dropped the start, nothing was recorded; grund says why: zu_spaet, abbruch, ki_stopp), transport_laeuft (stopp by Cypher while Andreas started the recording: it keeps running), beschaeftigt (a freeze, an export or a project change is running). External inputs (microphone, XDJ-XZ) are not part of this: they need Andreas\' release per input (geraete_lage).',
    inputSchema: { type: 'object', required: ['aktion'], properties: { aktion: { type: 'string', enum: ['start', 'stopp'] }, von_beat: { type: 'number', minimum: 0 } } },
    // der Low-Level-Server prüft das Schema nicht (Handler oben): eine unbekannte Aktion wird hier mit 400 abgewiesen, ohne etwas an den Server zu schicken
    lauf: async (p) => (p.aktion !== 'start' && p.aktion !== 'stopp' ? { code: 400, j: { fehler: 'aktion_unbekannt', text: 'aktion must be start or stopp' } } : http('POST', '/proj/aufnahme', p.aktion === 'start' ? { aktion: 'start', ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}) } : { aktion: 'stopp' })) },
  // Baukasten S15: bounce of a bk instrument stream into an audio track of the open project, composed of existing page routes only
  { name: 'proj_strom_aufnehmen', description: 'Record a Baukasten instrument into the open project in one call (a stream bounce). Puts the instrument graph on stream 2 (erz/2) or 3 (erz/3), plays the Strudel pattern on that stream, records the stream after the graph into an audio track for the given number of bars (real time) and stores where the take came from on its clip (entstehung: graph, the eight graph knob values, the Strudel code, the project tempo). All checks are reads and come first, so a refusal changes nothing: ki_gestoppt (Stop Cypher), auto_aus (AUTO of that stream is off), kein_projekt, unbekannt (no such graph), falsche_art (the graph is an effect, or the track is an instrument track), aufnahme_laeuft (a recording is running), andere_scharf (other tracks are armed: they would be recorded too and get their clips replaced; disarm them with proj_aendern spur_aendern arm false), spur_belegt (the track already has clips in the recorded range: the recording would replace them; use a free range via von_beat or another track), plus argument errors strom, takte, graph, code, code_zu_lang (above 20000 characters), spur, von_beat. Then it loads the graph (a stream whose erzeuger runs in kit mode refuses with kein_midi_strom: run instrumente first), sends the pattern, finds the track by id or exact name (spur, created as an audio track when missing), arms it on erz/<strom>, waits for the next bar so the pattern is playing, reads the knob values, records takte bars from von_beat (default 0), stops and disarms the track again (also on every failure path after the arm; a disarm that fails is answered as warnung, or detail.disarm_fehler in a tool error). The wait for the next bar keeps a margin of half a beat (a new pattern starts at the first bar line after about 0.5 beat), so the take opens on the new pattern. The stop is sent even when the wait fails. Knob values are what the page server knows (lage regler erz/<strom>/bk/<k>; a knob never moved reads 0.5); the kern is not asked. The graph and the pattern STAY on the stream afterwards (remove them with graph and strudel if they should not keep playing). Notes of MIDI clips on instrument tracks do NOT sound through a Baukasten graph in this version: this bounce is the production path for bk instruments today. Effect graphs (fx-*) are for the DJ side and are refused. Answers {spur_id, clip_id, take {frames, luecken, status, datei}, entstehung, spur_neu, graph_quittung}. A tool error after the first write carries detail.getan (what was already done: graph, strudel, spur_neu, arm, aufnahme).',
    inputSchema: { type: 'object', required: ['spur', 'strom', 'graph', 'code', 'takte'], properties: {
      spur: { type: 'string', minLength: 1, maxLength: 80, description: 'audio track id (e.g. s3) or its exact name; a name that does not exist is created as an audio track' },
      strom: { type: 'integer', enum: [2, 3], description: '2 = bass stream (erz/2), 3 = melody stream (erz/3)' },
      graph: { type: 'string', description: 'instrument graph name from graphen' },
      code: { type: 'string', minLength: 1, maxLength: 20000, description: 'Strudel pattern for that stream (note(...) values; kit sounds are not used with a graph)' },
      takte: { type: 'integer', minimum: 1, maximum: 64, description: 'bars to record (real time)' },
      von_beat: zahl('project beat where the take starts (default 0)', { minimum: 0 }) } },
    lauf: (p) => stromAufnehmen(p) },
  { name: 'geraete_lage', description: 'Audio and MIDI inputs of the core and their devices: per input (1 to 4, plus the MIDI input) the assigned device profile (pc-eingang, xdj-xz), whether the device is present (da), linked in the core (verbunden; null = the core has sent no state for 2 s, unknown), the input level (pegel_db, -200 = silence, null = unknown), the measured latency (latenz, with art software or kabel) and frei_fuer_cypher. I may use an external input only when frei_fuer_cypher is true: Andreas releases each input himself, I cannot change it. Also the detected sources (quellen), the profiles and the last core state (kern.ein: verbunden bit mask, MIDI events seen and lost, last MIDI sample, last impulse sample).',
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
  // Automation Slice 1/2 (ADR 032): read the points of a lane; changing goes through proj_aendern (auto_neu, auto_punkte, auto_loeschen, auto_aendern)
  { name: 'proj_auto', description: 'Read the automation lines (lanes) of the open project. Give lane_id (from proj_lage lanes, e.g. a1) for one lane '
    + 'or spur_id for all lanes of one track. Answers {lane_id, spur_id, ziel, gesperrt? (true only when the lane is locked), punkte_zahl (all points of the lane), punkte_gezeigt, '
    + 'punkte: [{beat (project beat), wert, form (linear | s | sprung: the segment INTO this point)}], '
    + 'weiter_ab_beat? (more points after the shown ones), bei?: {beat, wert}}; with spur_id: {spur_id, lanes: [...]}. '
    + 'ziel and the unit of wert: fader (dB, -200..6, -200 = off), pan (-1..1), mute and solo (0 or 1, always jumps), '
    + 'geraet.lautstaerke, geraet.cutoff, geraet.resonanz, geraet.env_mod (0..1, only on tracks with the RB-338 device (not the bk device)). '
    + 'bei_beat reads the value the core plays at that project beat, in the unit of the lane (before the first point the first value holds, after the last the last); the answer carries it as bei. '
    + 'gesperrt: true = the lane is locked, auto_punkte and auto_loeschen are refused with lane_gesperrt until proj_aendern auto_aendern {lane_id, gesperrt: false}. '
    + 'von_beat and bis_beat (project beats, both included) narrow the list; punkte_max (default 200) caps it. '
    + 'A lane that Andreas recorded by hand (touch, latch or write take) is an ordinary lane here: read it like any other. '
    + 'Changing lanes: proj_aendern auto_neu, auto_punkte, auto_loeschen, auto_aendern. Refused: lane_unbekannt (404), spur_unbekannt (404), kein_projekt. '
    + 'CLIP ENVELOPES (slice 5): give clip_id (from proj_lage) and ziel (gain | transpose | spur_fader | spur_pan | geraet.lautstaerke | geraet.cutoff | geraet.resonanz | geraet.env_mod) to read the envelope of that target on that clip; clip_id alone lists every envelope of the clip as {clip_id, spur_id, huellkurven: [...]}, an empty list when it has none. '
    + 'Answers {clip_id, spur_id, ziel, verknuepft (true = linked: repeats with the clip loop; false = unlinked), loop_beats? (only unlinked), punkte_zahl, punkte_gezeigt, punkte: [{beat, wert, form}], weiter_ab_beat?, bei?: {beat, wert}}. '
    + 'For a clip envelope ALL beats (von_beat, bis_beat, bei_beat, the points) are CLIP beats counted from the clip start, not project beats; bei is the value the core plays at that clip beat (with the repetition of a linked or unlinked envelope), in the unit of the target (gain and spur_fader in dB, transpose in semitones before rounding, spur_pan and geraet.* plain). '
    + 'clip_id does not go with lane_id or spur_id (argument_ungueltig). Refused for a clip: clip_unbekannt (404), huellkurve_unbekannt (404, the clip carries no envelope for that ziel), huellkurve_ziel (400, ziel is not an envelope target).',
    inputSchema: { type: 'object', properties: {
      lane_id: { type: 'string', description: 'lane id from proj_lage, e.g. a1' },
      spur_id: { type: 'string', description: 'track id: all lanes of that track (instead of lane_id)' },
      clip_id: { type: 'string', description: 'clip id from proj_lage: read the clip envelopes (instead of lane_id or spur_id); then the beats below are CLIP beats' },
      ziel: { type: 'string', description: 'with clip_id: the envelope target to read (gain | transpose | spur_fader | spur_pan | geraet.lautstaerke | geraet.cutoff | geraet.resonanz | geraet.env_mod); without it every envelope of the clip' },
      von_beat: zahl('first beat of the point list (project beat for a lane, clip beat for a clip envelope)', {}),
      bis_beat: zahl('last beat of the point list (project beat for a lane, clip beat for a clip envelope)', {}),
      bei_beat: zahl('beat at which to read the lane value (project beat; clip beat for a clip envelope), in the unit of the lane target', {}),
      punkte_max: { type: 'integer', minimum: 1, maximum: 8192, description: 'at most this many points in the list (default 200)' } } },
    lauf: (p) => http('GET', `/proj/auto?${['lane_id', 'spur_id', 'clip_id', 'ziel', 'von_beat', 'bis_beat', 'bei_beat', 'punkte_max'].filter((k) => p[k] !== undefined)
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
    + 'take_id null ends the audition and the comp plays again. Takes are made and edited with proj_aendern (take_neu, take_umbenennen, take_loeschen, comp_waehlen); proj_lage shows the takes of each track. '
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
  // S17: sound snapshot of the project (Baukasten graph + eight knobs per channel)
  { name: 'proj_bk', description: 'Sound snapshot of the open project: which Baukasten graph sits on erz/2, erz/3, deck/1..4 (fx/3, fx/4 on request) and the eight graph knob values <kanal>/bk/1..8. '
    + 'aktion lage = saved against live per channel ({kanaele: [{kanal, gespeichert, live, regler_gespeichert, regler_live, gleich}]}; gleich true/false, null = a live value is unknown). '
    + 'merken = save what is loaded now (one undo step "Baukasten: save sound"; kanaele optional, default erz/2, erz/3, deck/1..4 that have a graph; never removes an entry, remove one with proj_aendern bk_setzen {kanal, graph: null}); '
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
      ziel: PRESET_ZIEL, graph: { type: 'string', description: 'Baukasten graph name (device baukasten only)' },
      tags: { type: 'array', items: { type: 'string' } }, notiz: { type: 'string' },
      ueberschreiben: { type: 'boolean', description: 'replace an existing user preset of this name (only one I saved)' } } },
    lauf: async (p) => {
      const hatW = p.werte !== undefined, hatZ = p.ziel !== undefined;
      if (hatW === hatZ) return fehlerAntwort(400, 'werte_oder_ziel', 'give exactly one of werte (values by plugin id, with geraet) or ziel (a target whose current values are taken)');
      if (hatW) {
        if (typeof p.geraet !== 'string') return fehlerAntwort(400, 'geraet_fehlt', 'saving werte needs geraet (the device id)');
        return http('POST', '/presets', definiert(p, 'name', 'geraet', 'beschreibung', 'werte', 'graph', 'tags', 'notiz', 'ueberschreiben'));
      }
      if (p.geraet !== undefined || p.graph !== undefined) return fehlerAntwort(400, 'geraet_aus_ziel', 'with ziel the device and graph come from the target; do not give geraet or graph');
      return http('POST', '/presets/von_ziel', definiert(p, 'ziel', 'name', 'beschreibung', 'tags', 'notiz', 'ueberschreiben'));
    } },
  { name: 'presets_anwenden', description: 'Apply a preset to a target: the server computes a plan from the preset, the target and the open project, and I send it through the normal routes, so it is one undo step with the source cypher (project targets: one proj_aendern with the label "Preset <name>"; kern channel targets: one regler call per value, no ramp; it stops at the first refusal and reports which values were accepted, which one was refused and which were never sent). Target shapes: {art: "spur", spur_id} (rb338 or bk track: its device values; a bk preset on a track with another graph is refused with graph_anders), {art: "insert", insert_id} (an existing stage gets the values), {art: "insert_neu", strang_id} (a new stage at the end of the chain), {art: "kanal", kanal} (kern source channel such as deck/1: channel compressor and mix tools). A refused plan sends nothing (kein_ziel for hall presets, art_nicht_aktiv, geraet_passt_nicht, kanal_art, ziel_unbekannt, kein_projekt). The answer carries uebersprungen (parameters the target cannot carry, never dropped silently) and hinweise; applying values to a frozen track drops its freeze (hinweise: freeze_geht). rev defaults to the current project revision (proj_lage); rev_veraltet means someone changed it: read again.',
    inputSchema: { type: 'object', required: ['id', 'ziel'], properties: { id: { type: 'string', description: 'register id <werk|nutzer>:<geraet>/<slug>' }, ziel: PRESET_ZIEL, rev: { type: 'integer', minimum: 0 } } },
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
];

// Paket 1.13 Slice 6 (D1): proj_stems startet und fragt /proj/aktuell?noten=zahl ab, bis der Lauf endet oder die Frist abläuft; danach laeuft mit auftrag_id,
// der Lauf geht auf dem Server weiter (kein Abbruch). Frist: FRIST_VORGABE_MS.proj_stems (20 min,
// Begründung in FRIST_GRUND), Umgebung DJK_HAND_FRIST_PROJ_STEMS_MS.
// Nachbesserung T9: der Server bindet `stems` an das offene Projekt (sitzung.ts); nach Wechsel oder Schließen fehlt das Feld. Fehlt der EIGENE Lauf in
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
      regler = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => { const v = r.regler[`${kanal}/bk/${k}`]; return typeof v === 'number' ? v : 0.5; });
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
// rules of pruef/b116_senden.mjs sendePlan: weg 'proj' = ONE /proj/aendern {rev, label, befehle}; weg 'regler' = one /regler {pfad, nach, ab: jetzt}
// per request in order, stopping at the first refusal; a refused plan sends nothing. Refusal of a /regler: HTTP >= 400 or a kern quittung with a
// FEHL_STATUS (sendePlan stops on status 6 only; 4, 7 and 8 are failures for every other hand tool too, so they stop here as well).
async function presetsAnwenden(p: Json): Promise<{ code: number; j: Json }> {
  if (typeof p.id !== 'string' || !PRESET_ID.test(p.id)) return fehlerAntwort(400, 'preset_id_ungueltig', 'a preset id looks like werk:komp/drum-bus or nutzer:rb338/my-bass (<werk|nutzer>:<geraet>/<slug>)');
  if (!isObj(p.ziel)) return fehlerAntwort(400, 'ziel_fehlt', 'ziel is an object such as {art: "insert", insert_id} (see the tool description)');
  const plan = await http('POST', '/presets/anwenden', { id: p.id, ziel: p.ziel });
  if (plan.code !== 200) return plan;
  const pl = plan.j as { weg?: string; label?: string; befehle?: Json[]; anfragen?: { pfad: string; nach: number }[]; uebersprungen?: string[]; hinweise?: string[] };
  const gemeinsam = { id: p.id, uebersprungen: pl.uebersprungen ?? [], hinweise: pl.hinweise ?? [] };
  if (pl.weg === 'proj') {
    const r = await mitRev(p, '/proj/aendern', { label: pl.label, befehle: pl.befehle });
    if (r.code >= 400) return r;
    return { code: 200, j: { ok: true, weg: 'proj', label: pl.label, ...gemeinsam, rev: r.j.rev, kern: r.j.kern } };
  }
  if (pl.weg === 'regler') {
    const anfragen = pl.anfragen ?? [];
    for (let i = 0; i < anfragen.length; i++) {
      const a = anfragen[i];
      const r = await http('POST', '/regler', { pfad: a.pfad, nach: a.nach, ab: 'jetzt' });
      const q = r.j.quittung as { status: number; grund: string } | null | undefined;
      if (r.code >= 400 || (q && FEHL_STATUS.has(q.status))) {
        return { code: r.code >= 400 ? r.code : 409, j: { ...r.j, fehler: r.j.fehler ?? q?.grund ?? `http ${r.code}`,
          detail: { angenommen: anfragen.slice(0, i).map((x) => x.pfad), abgelehnt: a.pfad, offen: anfragen.slice(i + 1).map((x) => x.pfad), ...gemeinsam, ...(r.j.detail === undefined ? {} : { regler: r.j.detail }) } } };
      }
    }
    return { code: 200, j: { ok: true, weg: 'regler', gesendet: anfragen.length, ...gemeinsam } };
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

// Ergebnis → MCP: HTTP ≥ 400 oder eine Quittung mit Fehlerstatus ist ein Werkzeugfehler mit Grund
function antwort(r: { code: number; j: Json }): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  const q = r.j.quittung as { status: number; grund: string } | null | undefined;
  const fehler = r.code >= 400 || (q && FEHL_STATUS.has(q.status));
  const text = fehler
    // Ohr T11: kein_hoerschein trägt urteil/gruende des letzten Scheins (server.ts regler()) — mitgeben, sonst
    // verschwindet der Beleg für den Fehlerfall hinter der generischen Fehlerform.
    // ziel: welche Fahrt einer Spur abgelehnt wurde (ueber_projekt, D1 Spec 6.22/6.30)
    ? JSON.stringify({ fehler: r.j.fehler ?? q?.grund ?? `http ${r.code}`, text: r.j.text, detail: r.j.detail, details: r.j.details, ziel: r.j.ziel, urteil: r.j.urteil, gruende: r.j.gruende, quittung: q ?? undefined })
    : JSON.stringify(r.j);
  return fehler ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

const server = new Server({ name: 'djk-hand', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: W.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const w = W.find((x) => x.name === req.params.name);
  if (!w) return { content: [{ type: 'text', text: `unknown tool ${req.params.name}` }], isError: true };
  try { return antwort(await w.lauf((req.params.arguments ?? {}) as Json)); }
  catch (e) { return { content: [{ type: 'text', text: JSON.stringify({ fehler: 'seite_nicht_erreichbar', text: (e as Error).message, seite: SEITE }) }], isError: true }; }
});
await server.connect(new StdioServerTransport());
