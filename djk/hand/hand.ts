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
type Lang = 'proj_freeze' | 'proj_export' | 'proj_lautheit' | 'proj_stems';
// proj_lautheit (Paket 1.18, S3-Fix G5): der Server rendert seriell, bis zu 33 Renders (32 Spuren und Summe) zu je 4 · 1024 s + 60 s (Zeitlimit des Renders)
// plus ffmpeg 120 s je Messung plus ein Freeze ≈ 291 s: Grenzfall ≈ 2357 min (39,3 h). Die Vorgabe liegt NICHT darüber (80 min wie der Export): echte Renders
// brauchen Sekunden, das Zeitlimit ist eine Kill-Schwelle; wer den Grenzfall erreicht, bekommt hand_frist und fragt später (beschaeftigt, solange es läuft).
// Darum sagt fristText für proj_lautheit nicht „above the longest run“, sondern nennt Grenze, Grenzfall und Override.
export const FRIST_VORGABE_MS: Readonly<Record<Lang, number>> = { proj_freeze: 6 * 60_000, proj_export: 80 * 60_000, proj_lautheit: 80 * 60_000, proj_stems: 20 * 60_000 };
const fristVon = (name: Lang): number => {
  const v = Number(process.env[`DJK_HAND_FRIST_${name.toUpperCase()}_MS`]);
  return Number.isFinite(v) && v > 0 ? v : FRIST_VORGABE_MS[name];
};
const FRIST_GRUND: Readonly<Record<Lang, string>> = {
  proj_freeze: 'above the longest run the server allows', proj_export: 'above the longest run the server allows',
  proj_stems: 'at most 600 s of source at a real-time factor of 0.27 take about 3 min on the CPU, with reserve for a loaded machine',
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

interface Werkzeug { name: string; description: string; inputSchema: Json; lauf: (p: Json) => Promise<{ code: number; j: Json }> }
const W: Werkzeug[] = [
  { name: 'lage', description: 'Current state: master clock (beat, bar, bpm), Stop-Cypher flag, both decks (track, bar in track, loop, open/closed), mixer values (incl. duck, reverb send and return, glue when off their defaults), loop boxes L1/L2, FX, my last acknowledgements, and the studio: AUTO/pattern per instance, loaded Surge sound (after a set it reads "edited": the name then says nothing about the content), and the digital output (ausgang.zustand: gut = on, aus = OFF and silent, kampf = keeps dropping, wache_stumm = watch not running, unbewacht = silent sink; faelle = dropouts this session). Call this before every move.',
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
  { name: 'regler', description: 'Move a mixer control, optionally as a ramp over bars (my way to blend: channel fader, EQ, filter). Paths: deck/1|2/(fader|trim|eq/tief|eq/mitte|eq/hoch|kill/tief|kill/mitte|kill/hoch|filter), pad/1|2/..., erz/1|2|3/..., fx/1|2/(notenwert|rueckkopplung|rueckweg), duck/tiefe (dB -24..0, 0 = off: kick ducks bass and melody), duck/release (ms 50..600). <kanal>/komp/(an 0/1, schwelle dB -60..0, ratio 1..20, attack ms 0.1..100, release ms 10..1000, makeup dB 0..24, mix 0..1, sc 0..14 = sidechain key: 0 own signal, else source channel + 1, erz/1 = 5): compressor per source channel (deck, erz, pad), after EQ/filter, before the fader; off by default. color/art (sound color FX like the XDJ-XZ, global for all channels: 0 FILTER, 1 SPACE, 2 DUB ECHO, 3 SWEEP, 4 NOISE, 5 CRUSH; set only, use ab:jetzt) and color/param (PARAMETER 0..1, default 0.5): the filter knob of every channel is the COLOR knob, center = dry, SPACE and DUB ECHO tails ring out when it returns to center. keylock (0/1, set only, default 1): one switch for all sources (decks, loop boxes), 1 keeps the pitch at any tempo, 0 = varispeed. <kanal>/send/2 feeds the reverb (fx/2 return, 0 dB default; send -200..0 dB, -200 = off). Units: fader/trim/eq in dB (fader -200..0, eq -200..+6), filter -1..+1, kill 0/1. Crossfader, master (master/pegel, master/kleber = threshold of the sum compressor 0..1, 0 = off), PFL and cue are Andreas\' hand only (nur_hand). Opening a closed channel (trim+fader above -26 dB, deck/1|2 only) needs a valid hearing check from hoeren (urteil ok); the server attaches it. erz channels and pad boxes holding my own recordings open freely with regler; a pad box with a foreign loop stays refused (kein_hoerschein), and while my pad ramp is open I cannot load foreign material into that box (box_offen_oder_faehrt). Automation tracks (spur) still may not open pad boxes. Andreas touching the control aborts my ramp (status 7 hand). A move into my own running ramp on the same path is queued to the ramp\'s end (verschoben_auf). Rejections at the start beat itself only show in lage (quittungen). Project mixer paths (spur/1..32/*, grp/1..8/*, pm/fader) are refused with ueber_projekt: they change only through the project (proj_aendern: spur_aendern, gruppenspur_aendern, master_aendern).',
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
  { name: 'strudel', description: 'Send a Strudel pattern to one of the three instances: strom 1 drums (erz/1), 2 bass (erz/2), 3 melody (erz/3). Plays from the next bar. Only while Andreas has AUTO on for that instance (auto_aus otherwise). After the next bar, studio shows status.taub: Strudel fields that do not sound in this studio (cutoff = lpf, hcutoff = hpf, room, delay, fmi ...); do not rely on them. taub lists at least these fields once taub_muster equals nr (fields first heard in later bars are added).',
    inputSchema: { type: 'object', required: ['code'], properties: { code: { type: 'string' }, strom: { type: 'integer', enum: [1, 2, 3] } } },
    lauf: (p) => http('POST', '/strudel', { text: p.code, strom: p.strom ?? 1 }) },
  { name: 'abbrechen', description: 'Abort all my running and waiting ramps and deck commands; values stay where they are.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('POST', '/abbruch', {}) },
  { name: 'tempo', description: 'Set the master tempo (60-200 BPM): a 4-beat ramp starting on the next bar. Loop boxes, REC, Strudel and playing decks follow; a deck also starts at any tempo. All sources keep their pitch (keylock, on by default; `keylock` via regler). lage regler.keylock: 1 on, 0 off, null unknown. With keylock off decks and loop boxes follow in varispeed: their pitch moves with the tempo (128 -> 132 is +0.5 semitones). Exceptions with keylock on, still varispeed: a deck in a loop (until loops get keylock), a core started without keylock (kern.toml keylock = false), and about 0.1 s after each deck event (start, jump, hotcue) until the stretcher takes over; lage decks[].hoerweg 1 means the pitch is held. Refused while Stop Cypher is set (ki_gestoppt).',
    inputSchema: { type: 'object', required: ['bpm'], properties: { bpm: zahl('target BPM', { minimum: 60, maximum: 200 }) } },
    lauf: (p) => http('POST', '/tempo', { bpm: p.bpm }) },
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
  { name: 'studio', description: 'Studio state of the three Strudel instances (1 drums, 2 bass, 3 melody): current pattern, AUTO flag (autonom) and author (von) per instance. Call before playing: AUTO off means Andreas holds that instance and my writes are refused (auto_aus). status.taub lists Strudel fields of the current pattern that do not sound here (at least these once taub_muster equals nr; fields first heard in later bars are added).',
    inputSchema: { type: 'object', properties: {} },
    lauf: async () => {
      const stroeme: Json[] = [];
      let code = 200;
      for (const strom of [1, 2, 3]) {
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
      + 'Track mixer paths spur/1..32/* (fader, pan, mute, solo of a project track) and the group and master paths grp/1..8/* and pm/fader are refused with ueber_projekt: they change only through the project (proj_aendern: spur_aendern, gruppenspur_aendern, master_aendern).',
    inputSchema: { type: 'object', required: ['name', 'fahrten'], properties: { name: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' },
      fahrten: { type: 'array', items: { type: 'object', required: ['ziel', 'ab_takt'], properties: { ziel: { type: 'string' }, ab_takt: { type: 'number' }, takte: { type: 'number' },
        nach: { type: 'number' }, von: { type: 'number' }, form: { type: 'string', enum: ['s', 'linear'] }, muster: { type: 'string' } } } },
      ab: { type: 'string', enum: ['takt', 'phrase'] } } },
    lauf: (p) => http('POST', '/spur', { spur: { name: p.name, fahrten: p.fahrten }, ab: p.ab ?? 'takt' }) },
  { name: 'spur_stopp', description: 'Stop one of MY automation tracks by name (Andreas\' tracks answer nur_andreas).',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    lauf: (p) => http('POST', '/spur/stopp', { name: p.name }) },
  { name: 'spuren', description: 'Running automation tracks, with the parts the core rejected.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/spur') },
  { name: 'stille', description: 'Silence all three Strudel instances from the next bar (tails ring for about 10 s). All three are always sent; if AUTO is off on one, that one is reported and the others still go silent.',
    inputSchema: { type: 'object', properties: {} },
    lauf: async () => {
      const stroeme: Json[] = [], fehler: string[] = [];
      let code = 200;
      for (const strom of [1, 2, 3]) {
        const r = await http('POST', '/strudel', { text: 'silence', strom });
        code = Math.max(code, r.code);
        stroeme.push({ strom, code: r.code, ...r.j });
        if (r.code >= 400) fehler.push(`strom ${strom}: ${String(r.j.fehler ?? `http ${r.code}`)}`);
      }
      return { code, j: { stroeme, ...(fehler.length ? { fehler: 'teilweise: ' + fehler.join('; ') } : {}) } };
    } },
  { name: 'pegel', description: 'Levels of the last N seconds (1..10, default 3) per channel (erz/1..3, pad/1..2, deck/1..2, spur/1..32 for each production track that has content, grp/1..8 for each group that has members, pm (the production master after its fader, before the set limiter), master, cue): number of samples, peak dBFS (max_db, -200 = silence) and median of the audible peaks (median_db, null if silent). The peak is the sample peak after the track fader, not loudness: a 808 kick and a quiet pad can show the same peak and sound very different. For loudness per track use proj_lautheit. Read it after every change: master must stay below -3 dBFS, the kick leads.',
    inputSchema: { type: 'object', properties: { sek: { type: 'integer', minimum: 1, maximum: 10, default: 3, description: 'window in seconds (default: 3)' } } },
    lauf: (p) => http('GET', `/pegel?sek=${p.sek ?? 3}`) },
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
  { name: 'proj_neu', description: 'Create a production project and open it: loads its (empty) playback into the core, sets erz/4 (the production group channel) neutral and all 32 track mixer slots. Closes the project that was open: a transport I started stops. While a transport Andreas started or took over with Stop Cypher is running (from the page, the hardware key, or unknown), it is refused with 409 transport_laeuft and nothing is stopped, opened or created: wait until he stops it. Answers slug, rev, spuren (tracks with clips, notes only as noten_zahl), noten_zahl (notes per MIDI clip) and kern, not the whole project: read it with proj_lage.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } },
    lauf: (p) => http('POST', '/proj/neu?antwort=kurz', { name: p.name }) },
  { name: 'proj_oeffnen', description: 'Open a production project by slug (from proj_liste): playback, erz/4 neutral, track mixer, loop, metronome go to the core. kern.regler_fehler lists mixer values the core refused (e.g. Andreas holds that fader); kern.regler_ohne_kern counts values without an answer (no core running). Closes the open project like proj_neu: a transport I started stops; while a transport Andreas started or took over with Stop Cypher is running, 409 transport_laeuft and nothing changes. Answers like proj_neu (slug, rev, spuren with noten_zahl per clip, noten_zahl, kern), not the notes.',
    inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    lauf: (p) => http('POST', '/proj/oeffnen?antwort=kurz', { slug: p.slug }) },
  { name: 'proj_lage', description: 'The open project (tracks with id and nr, clips with id and noten_zahl = number of notes (the notes themselves are not listed), audio clips with warp {an, modus (repitch | beats | complex | tones), quelle, eins_unsicher, versatz_beats, marker_zahl, beats? (only when set: {raster, loop, huelle}; absent = default transienten/vor/100)} (the markers themselves via proj_warp); analyse [{clip_id, status: wartet|laeuft}] lists tracks the Werkstatt is analysing for a warp (absent when none), mixer, tempo, loop, metronome, rev) and the core state of the arrangement (kern.rev_geladen = playback number loaded, kern.status 0 stopped, 1 waiting, 2 playing). stems {auftrag_id, clip_id, zustand (laeuft | fertig | abgebrochen | veraltet | fehler), stufe (laden | trennen | schreiben), prozent, grund?, text?, hinweis?, spuren?} is the last stem separation of this project (proj_stems), kept after its end; absent when none ran. slug null = no project open. Call before proj_aendern.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/proj/aktuell?noten=zahl') },
  { name: 'proj_aendern', description: 'Change the open project with a list of commands (all or nothing, one undo step, label shows in the history). Each command is {befehl, ...}: spur_neu {art: audio|instrument, name?, gruppe? (text 1..32: tracks with the same gruppe are variants of each other), geraet?: {art: intern (rb338, parameter: lautstaerke, wellenform, cutoff, resonanz, env_mod, decay, accent, each 0..1) | wirt (surge, slot 1)}}; spur_aendern {spur_id, name?, gruppe? (text 1..32, null = leave the group), farbe?, fader_db? (-200..6), pan? (-1..1), mute?, solo?, geraet?, arm? (true|false), eingang? ({art: intern, name: erz/1|erz/2|erz/3} or null)}; variante_waehlen {gruppe, spur_id} (one undo step: the chosen variant plays (mute false), all other tracks of that gruppe are muted, tracks outside the gruppe are untouched; the page shows a key row A, B, C per gruppe; to accept a variant delete the others with spur_loeschen); gruppenspur_neu {name?, farbe?, mitglieder?: [spur_id]} (a group track, up to 8; the members play through it: their output moves from master to the group in the same undo step); gruppenspur_aendern {gruppe_id, name?, farbe?, fader_db? (-200..6), pan? (-1..1, a balance: centre is 0 dB), mute?, solo?, gefaltet?}; gruppenspur_loeschen {gruppe_id} (its members go back to master; an unknown gruppe_id here and in gruppenspur_aendern: gruppe_unbekannt); ziel_setzen {strang_id (a track id or a group id), ausgang: "master" | {art: "gruppe", id}} (a track can feed one group; groups do not nest: routing_grenze, a group onto itself: routing_zyklus; unknown strang_id: spur_unbekannt; unknown target group: ziel_unbekannt); master_aendern {fader_db -200..6} (the production master fader; the export is taken here, see proj_export); spur_loeschen {spur_id}; spur_verschieben {spur_id, index}; clip_neu {spur_id, art: audio|midi, start_beat, laenge_beats, loop_beats? (null or missing = off, else 1/16..laenge_beats: the clip repeats [0, loop) up to its length; audio and MIDI), name? (the library title for audio), sha256? (audio: only a sha from the library, see stoebern/klaenge), noten? (midi), warp? (audio: "auto" warps a loop or track to the project tempo from the library data, the server then computes laenge_beats from the warp and yours is only the fallback; one-shots and samples without a tempo stay unwarped; "aus" or missing = no warp; or a whole warp object)}; clip_aendern {clip_id, start_beat?, laenge_beats?, loop_beats? (null = off, else 1/16..laenge_beats: the clip repeats [0, loop) up to its length), offset_s? (refused with offset_bei_warp on a warped clip), versatz_beats? (warped clips only: which beat of the warp plays at the clip start), gain_db? (-96..24), fade_ein_beats?, fade_aus_beats? (fades >= 0, together at most laenge_beats), stumm? (audio clips only: true mutes the clip in the arrangement and in exports, false makes it audible again (null is refused); proj_stems mutes the original this way), spur_id?, name?}; clip_teilen {clip_id, beat}; clip_duplizieren {clip_id, ziel_beat?}; clip_loeschen {clip_id}; warp_setzen {clip_id, an? (false keeps the markers but plays the clip unwarped), modus? (repitch | beats | complex | tones. repitch: the pitch follows the tempo like a record; beats: drums, every slice starts on its beat at its own speed and keeps its shape, played by the core without the warp engine; complex: whole tracks, the pitch stays; tones: tonal material, finer grains. complex and tones are stretched ahead of time by the warp engine of the core, 64 voices; a core without it refuses them with warp_maschine_fehlt and a full pool plays the clip as repitch), transpose_st? (whole semitones, -12 to 24), detune_ct? (cents, -50 to 50; together -12 to 24 semitones: transpose_st x 100 + detune_ct within -1200..2400; only in complex and tones, they re-render the clip ahead of time, so a change is heard after a short moment; repitch follows the tempo like a record and refuses any value but 0 with transpose_repitch, so set modus repitch together with transpose_st 0 and detune_ct 0), beats? (the whole parameter object, written beats {raster: transienten | 1/4 | 1/8 | 1/16 | 1/32, loop: aus | vor | vor_zurueck, huelle: 0..100}; read only in mode beats and kept when the mode changes; default transienten/vor/100: raster = where each slice starts (at the transients of the audio, without a transient list on 1/16), loop = what fills the gap when the tempo is slower than the audio (aus: silence, vor: the end of the slice looped forward, vor_zurueck: back and forth), huelle = 100 keeps each slice whole, lower fades it out sooner; beats follows the tempo like repitch and refuses transpose_st and detune_ct other than 0 with transpose_repitch), or warp: {the whole warp object} / null to remove it}; warp_auto {clip_id} (sets the warp from the best source: the Werkstatt analysis map with every beat as a marker, else the Traktor grid, else the bars (takte), else the library BPM; refused with kein_tempo when there is none, except for a long track (60 s and more) without a map or a grid: then the Werkstatt analyses it in the background, the answer carries hinweise analyse_angefordert and the clip is warped when the analysis arrives; the clip length stays); clip_neu with warp "auto" and warp_auto warp in this order: (1) the Werkstatt analysis map of the file (same sha256), one marker per beat, marker beat 0 = the first bar one, the clip starts there and is as long as the rest of the file; eins_unsicher when the analysis was unsure; (2) the Traktor grid (anchor and BPM, eins_unsicher); (3) loops with bars (takte) lie on takte x 4 beats; (4) the library BPM from second 0 (for a track the bar one is then unsure). One-shots never warp. Warp by hand (all take a clip with a warp, else kein_warp; beats here are CLIP beats = the beat of a marker, 0 = the bar one of the source; every one is a single undo step and sets quelle hand): warp_tempo {clip_id, faktor: 2 | 0.5} (x2 or :2: every marker beat, the offset, the clip length and the loop length are multiplied, so every segment tempo is multiplied; the same piece of the source takes twice (half) as many beats; refused with warp_faktor when a segment would leave 15..800 BPM); warp_marker {clip_id, setze?: [{quell_s, beat?}] (a marker at source second quell_s; without beat it gets the beat the grid has there, so the sound does not change), loesche?: [beat], verschiebe?: [{beat, neu_quell_s | neu_beat}] (the marker that has this beat now; neu_quell_s moves it in the source and keeps its beat, neu_beat keeps its source second and moves its beat)} (order: delete, move, set; refused with marker_unbekannt when no marker has that beat, with warp_marker when the result is not strictly rising or has under 2 or over 4096 markers; the clip length stays); warp_ab_hier {clip_id, beat, art: gerade | start} (Warp From Here: gerade replaces every marker from that clip beat on by ONE segment with the tempo that holds there; start sets the auto warp again from there on, like warp_auto, and needs a tempo source, else kein_tempo; the clip length stays); eins_hier {clip_id, quell_s} (Set 1.1.1 Here: source second quell_s becomes beat 0, rounded to the nearest whole beat of the analysis map in the correction line. The clip starts there (offset unchanged), so the track moves on the project by the beats the point lay behind the old bar one (like Live); its length changes so it plays the same end of the source; eins_unsicher becomes false. If the track is in the deck stock and this server writes corrections, a line von andreas (also when Cypher sends it) is saved: the next auto-warp of that track starts there and the decks use it after their next render; undo takes back the clip, not the line; hinweise tell: eins_gemeldet, eins_nur_hier (no line written: the track is not in the stock or this server writes none, only this clip changed), eins_rueckweg_fehler (the clip changed, the line could not be written)); tempo_vom_clip {clip_id} (sets the project tempo to the tempo at which the clip plays as long as the piece of the source it uses, 60 x laenge / (source seconds); refused like tempo_setzen: deck_laeuft, tempo_bereich); audio_quantisieren {clip_id, raster: 1/4|1/8|1/16|1/32, staerke? (0..1, default 1), von_beat?, bis_beat? (clip beats, the beats of the markers, 0 = 1.1.1 of the source; not project beats; default: the range of the clip)} (Quantize Audio: the grid is the project grid (a clip that starts off the grid still lands on it); moves the hits onto the grid by setting a hand marker at each transient of the audio, strength 1 puts it exactly on the grid line, 0.5 half way; markers outside the range stay, the ones inside are replaced; clip length stays, one undo step; refused with transienten_fehlen when the audio is not decoded yet, keine_transienten when the range holds none, quantisieren_konflikt when the new markers would not rise strictly, warp_faktor or warp_marker when a segment would leave 15..800 BPM or the marker count 4096: nothing is shortened silently); noten_neu {clip_id, noten: [{beat (in the clip), laenge, ton 0..127, vel 1..127}]}; noten_aendern {clip_id, noten: [{id, ...changed}]}; noten_loeschen {clip_id, ids}; tempo_setzen {bpm 60..200} (refused while a deck plays: deck_laeuft); loop_setzen {an, von_beat, bis_beat}; metronom_setzen {an?, pegel_db? -60..0, ziel? master|cue}. Beats are project beats (4/4). Solo on a track keeps its group sounding, solo on a group keeps all its members sounding; mute on a group silences its members. rev defaults to the current one (proj_lage); rev_veraltet means someone changed it in between: read again. regler_abgelehnt: the core refused a mixer value (nothing was changed). Stop Cypher stops only my hand: it lowers no fader, and what sounds keeps sounding (the track field von is cypher and never changes, it controls nothing). Answers rev, kern (what the core acknowledged) and noten_zahl (notes per MIDI clip), not the project: read it with proj_lage. hinweise [{index, hinweis}] appears when an auto-warp has something to say: kein_tempo (no source found: the clip was made without warp), analyse_angefordert (a long track has no map yet: the Werkstatt analyses it in the background and the clip is warped when it arrives, one history entry "Auto-Warp"; proj_lage lists the running analyses under analyse), analyse_laeuft (that analysis is already running), karte_zu_gross or karte_unbrauchbar (the analysis map was not usable, the next source was taken). Warp refusals: kein_warp, warp_marker, warp_faktor (segment tempo outside 15..800 BPM), warp_modus, transpose_repitch, offset_bei_warp, kein_tempo, warp_auto_neuer_clip (warp_auto names a clip created in the same list: use clip_neu with warp "auto").',
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
  { name: 'proj_freeze', description: 'Freeze a Surge (host) track of the open project: the core plays its notes once in real time (from the first to the last MIDI clip with sounding notes, plus 2 beats; at 124 BPM 8 bars take about 16 s, the call waits that long), and the track then plays as audio, live and in exports. an false discards the freeze (no run). Editing the notes, the instrument or the tempo discards it as well; undo brings it back. While it runs, note, clip, tempo and transport changes are refused (409 beschaeftigt), mixer changes go through. Answers rev, spur_id and freeze {datei, frames, kennung, sha256, von_beat} (null after discarding), not the project; one undo step ("Freeze <track>"). Refused: ki_gestoppt (Stop Cypher), transport_laeuft (stop it first), beschaeftigt (a freeze or export runs, a project is being opened, or the tempo is still ramping), keine_wirtspur, spur_leer (no sounding notes), zu_gross (over 256 beats), deck_laeuft, kein_kernstand, nicht_geladen, veraltet (the track changed meanwhile), wirt_fehlt (the production host arr1 is not running: start djk-instrumente --arr1), freeze_fehler (the core aborted or restarted; nothing saved). ' + fristText('proj_freeze'),
    inputSchema: { type: 'object', required: ['spur_id', 'an'], properties: {
      spur_id: { type: 'string', description: 'track id from proj_lage, e.g. s3' },
      an: { type: 'boolean', description: 'true = freeze, false = discard the freeze' } } },
    lauf: (p) => httpLang('proj_freeze', '/proj/freeze?antwort=kurz', { spur_id: p.spur_id, an: p.an }) },
  { name: 'proj_export', description: 'Export the open project as WAV (48 kHz, 32 bit float) into its export folder (never overwrites): the loop range by default, or von_beat..bis_beat (1 to 1024 beats). Unfrozen Surge tracks with notes are frozen first in real time (see proj_freeze, one undo step each), then the core renders offline at low priority (a few seconds for 8 bars); the call waits for both. the export is taken at the production master (abgriff production, the default): after the master fader of the production (pm/fader) but before the DJ glue, the DJ master fader and the set limiter, so a mastering chain outside gets the unlimited signal; abgriff set is the signal as the room hears it (after the set limiter); loudness is measured on the written file. Answers {datei, frames, spitze_db, regler_quelle, abgriff, ueber_decke, limiter_db_max, lufs_i, lra, true_peak_dbtp}: regler_quelle kern = mixer as the running core has it, projekt = from the project file because no core ran since boot; ueber_decke true = the sample peak of the file is above the limiter ceiling (kern.toml limiter_dbtp): with abgriff production the set limiter would have reduced it, limiter_db_max is the largest reduction in dB it made while rendering (0 = never); the page shows SET LIMITER when it reduces while you listen; the loudness fields are null with loudness_fehler when ffmpeg failed (the WAV is still written). The transport must be stopped. Refused: ki_gestoppt, transport_laeuft, beschaeftigt (a freeze or export runs), export_bereich, audio_fehlt (an audio clip is still being prepared), kein_kernstand (a track needs freezing but the core has not reported), veraltet, wirt_fehlt (a track needs freezing but the production host arr1 is not running: start djk-instrumente --arr1), freeze_fehler, render_fehler. ' + fristText('proj_export'),
    inputSchema: { type: 'object', properties: {
      von_beat: zahl('first beat (default: loop start)', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (default: loop end)', { minimum: 1 }),
      abgriff: { type: 'string', enum: ['produktion', 'set'], description: 'tap of the export: production master (default) or the master after the set limiter' } } },
    lauf: (p) => httpLang('proj_export', '/proj/export', { ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}), ...(p.bis_beat !== undefined ? { bis_beat: p.bis_beat } : {}), ...(p.abgriff !== undefined ? { abgriff: p.abgriff } : {}) }) },
  // Paket 1.18, E-b: Lautheit je Spur und als Summe, offline und auf Anfrage (kein Dauerbetrieb im Kern); friert Wirt-Spuren vorher ein wie proj_export
  { name: 'proj_lautheit', description: 'Measure loudness per track of the open project, offline and on request: the server renders every sounding track alone (its own fader and pan from the project, then through its group and the production master, all other tracks silent, no deck or master state of the core) and once all together, then measures each WAV with ffmpeg. Range: the loop range by default, or von_beat..bis_beat (1 to 1024 beats). Unfrozen Surge tracks with notes are frozen first in real time (see proj_freeze; needs the production host arr1, else wirt_fehlt). Answers {von_beat, bis_beat, spuren: [{spur_id, nr, name, lufs_i, lra, true_peak_dbtp, spitze_db, stumm, unter_messgrenze}], summe: {lufs_i, lra, true_peak_dbtp, spitze_db, unter_messgrenze, regler_quelle}}. lufs_i is integrated loudness in LUFS (use it to match the kick: the sample peak misleads for a 808 kick), lra loudness range in LU, true_peak_dbtp in dBTP, spitze_db the sample peak in dBFS at the production master (before the set limiter). A muted track (or one with the fader off, or silent in the range) answers stumm true and lufs_i null (not -70). If any track or group of the project is on solo, a track without solo that is not in a group on solo counts as muted, like in the mix (stumm true, not rendered). A track that is quiet but not silent, below the measuring floor of -70 LUFS (peak between -90 and about -68 dBFS), answers unter_messgrenze true, stumm false, lufs_i and lra null (not -70.0) and true_peak_dbtp as measured; the same holds for the sum. Tracks without content in the range are not listed. The sum equals proj_export of the same range (default abgriff production) within 0.1 LU. Nothing is written into the project or the export folder. The transport must be stopped. Refused: ki_gestoppt, transport_laeuft, beschaeftigt (a freeze, export or measurement runs), export_bereich, audio_fehlt, wirt_fehlt (a track needs freezing but the production host arr1 is not running: start djk-instrumente --arr1), render_fehler. ' + fristText('proj_lautheit'),
    inputSchema: { type: 'object', properties: {
      von_beat: zahl('first beat (default: loop start)', { minimum: 0 }),
      bis_beat: zahl('end beat, exclusive (default: loop end)', { minimum: 1 }) } },
    lauf: (p) => httpLang('proj_lautheit', '/proj/lautheit', { ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}), ...(p.bis_beat !== undefined ? { bis_beat: p.bis_beat } : {}) }) },
  // 1.8 Task 28: Aufnahme auf armierte Audio-Spuren (interner Strom erz/1..3); Server: POST /proj/aufnahme, Quelle cypher
  { name: 'proj_aufnahme', description: 'Record onto the armed audio tracks of the open project. aktion start {von_beat? default 0}: arms the core for each track set with proj_aendern spur_aendern {arm: true, eingang: {art: intern, name: erz/1|erz/2|erz/3}}, starts the transport and records from its start; the take is the internal stream of that input (erz/1 is the Strudel channel). aktion stopp: stops the transport, saves the takes as files in the project folder (aufnahmen/take-<kennung>-<spur>.wav), places one clip per track (replacing what was there) as ONE undo step, and answers takes [{spur_id, frames, luecken, datei} or fehler]. If the transport was stopped some other way (proj_transport, the hand key, the end of the arrangement) the take is saved by itself; aktion stopp then returns that result once, and proj_aufnahme without a running recording shows it under letzte. Refused: nichts_scharf (no armed track), ueberlappung (a transport is running), transport_laeuft (Andreas\' transport is running: wait), ki_gestoppt, aufnahme_laeuft, keine_aufnahme (stopp without a running recording and nothing to hand over), aufnahme_abgebrochen (the core dropped the start, nothing was recorded; grund says why: zu_spaet, abbruch, ki_stopp), transport_laeuft (stopp by Cypher while Andreas started the recording: it keeps running), beschaeftigt (a freeze, an export or a project change is running). External inputs (microphone, XDJ-XZ) are not part of this: they need Andreas\' release per input (geraete_lage).',
    inputSchema: { type: 'object', required: ['aktion'], properties: { aktion: { type: 'string', enum: ['start', 'stopp'] }, von_beat: { type: 'number', minimum: 0 } } },
    // der Low-Level-Server prüft das Schema nicht (Handler oben): eine unbekannte Aktion wird hier mit 400 abgewiesen, ohne etwas an den Server zu schicken
    lauf: async (p) => (p.aktion !== 'start' && p.aktion !== 'stopp' ? { code: 400, j: { fehler: 'aktion_unbekannt', text: 'aktion must be start or stopp' } } : http('POST', '/proj/aufnahme', p.aktion === 'start' ? { aktion: 'start', ...(p.von_beat !== undefined ? { von_beat: p.von_beat } : {}) } : { aktion: 'stopp' })) },
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
  // Paket 1.13 Slice 6 (D1, D14, D15): Stems trennen; die Antwort des Servers ist {auftrag_id, frames}, das Ende liest projStems aus /proj/aktuell
  { name: 'proj_stems', description: 'Separate one audio clip of the open project into four stems (drums, bass, other, vocals) on the CPU: the whole clip or '
    + 'von_beat..bis_beat inside it (at most 600 s of source). The end is one project change with one undo step: the original part is muted, four new '
    + 'tracks with the stems lie under it in a group "Stems: <name>", warped like the original. The call waits until the end (fertig, abgebrochen, veraltet, '
    + `fehler with grund) or up to ${FRIST_VORGABE_MS.proj_stems / 60_000} min (DJK_HAND_FRIST_PROJ_STEMS_MS), `
    + 'then answers laeuft with auftrag_id; the run goes on. '
    + 'If the project was changed or closed meanwhile, the run is cancelled and the answer is unbekannt (the result is not visible here: check proj_lage); '
    + 'a failed status query also answers unbekannt with detail. Only one run at a time (stems_laeuft). Refused while the core runs at quantum 128 '
    + '(stems_quantum), on a track of Andreas (nur_andreas_spur), with Stop Cypher (ki_gestoppt), with a looped clip (stems_loop), with more or less than '
    + 'one audio clip in the range (mehrere_clips), when four free tracks are missing (zu_viele_spuren), before the core has reported (kein_kernstand), '
    + 'with a range over 600 s of source (stems_zu_gross). Runs on the GPU by default (about 4 s per 4-minute track) when enough video memory is free, otherwise on the CPU; the result names the device.',
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
    ? JSON.stringify({ fehler: r.j.fehler ?? q?.grund ?? `http ${r.code}`, text: r.j.text, detail: r.j.detail, ziel: r.j.ziel, urteil: r.j.urteil, gruende: r.j.gruende, quittung: q ?? undefined })
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
