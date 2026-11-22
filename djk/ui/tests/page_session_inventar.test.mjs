// Inventory of today's LIVE (Andreas: live, never take anything away). One row per function; each row pins that the element or action still exists in
// the code. The SESSION view that once gave these rows a second home is gone (2026-11-22: replaced by the loop deck pop-up), so only the "still in the
// code" half is left. The loop deck pop-up has its own tests (seite_loopdeck_gross*.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const enthaelt = (datei, ...teile) => { const t = lies(datei); for (const x of teile) assert.ok(t.includes(x), `${datei} has ${x}`); };

const ZEILEN = [
  ['clock', 'BAR, PHRASE, BPM and the four beat dots', () => enthaelt('index.html', 'id="takt"', 'id="phrase"', 'id="bpm"', 'id="schlaege"', 'class="uhr"')],
  ['arr-clock', 'transport clock of the live container for the SEQ play heads', () => enthaelt('live_view.js', 'export function merkeArr', 'export const arrLaeuft', 'export function arrBeat')],
  ['export', 'EXPORT of a deck loop into the first empty loop cell', () => enthaelt('live_view.js', 'export function exportTaste', 'export function zeigeExport')],
  ['strudel-rows', 'Strudel stream rows: editor, AUTO, PLAY, STOP, REVERT, SAVE, name, take over, error', () => {
    enthaelt('index.html', 'id="strudel-zeilen"');
    enthaelt('strudel_module.js', 'muster-feld', 'muster-auto', 'muster-senden', 'muster-stopp', 'muster-zurueck', 'muster-sichern', 'muster-name', 'muster-uebernehmen', 'muster-fehler');
  }],
  ['strudel-sound', 'sound column of every stream row', () => enthaelt('strudel_module.js', 'baueSoundStimme')],
  ['strudel-strip', 'the strip of every stream', () => enthaelt('strudel_module.js', "zug.className = 'zug'", 'zeigeSlotRegler', 'PAN')],
  ['strudel-device', 'device window button of a stream', () => enthaelt('strudel_module.js', 'data-strom-geraete')],
  ['strudel-plus', '+ STREAM picker', () => enthaelt('strudel_module.js', 'data-strom-plus', '+ STREAM')],
  ['strudel-head', 'record length chips, REC and the target buttons into the loop decks', () => enthaelt('index.html', 'id="rec-knopf"', 'data-recbeats="1"', 'data-recziel="1:1"', 'data-recziel="2:4"')],
  ['bands', 'track bands (automation lanes) of a stream', () => {
    enthaelt('strudel_module.js', 'class="spurbaender"', 'bindeSpurbandZeile');
    enthaelt('track_tape_view.js', 'export function bindeSpurbandZeile', 'export function bindeSpurbaender');
  }],
  ['strips', 'strips C and D (pad/1, pad/2) and A and B (deck/1, deck/2)', () => enthaelt('index.html', 'data-kanalzug="pad/1"', 'data-kanalzug="pad/2"', 'data-kanalzug="deck/1"', 'data-kanalzug="deck/2"', 'id="mischer-unten"')],
  ['master-meter', 'master level meter', () => enthaelt('index.html', 'data-kanal="master"')],
  ['band-poll', 'the poll and playhead of the track bands', () => enthaelt('track_tape_view.js', 'export function setzeBandSichtbar')],
  ['master-db', 'the master level number', () => enthaelt('index.html', 'data-pegelzahl="master"')],
  ['master-strip', 'MASTER level, GLUE, PFL, FX assign 1 2 3', () => enthaelt('index.html', 'data-pfad="master/pegel"', 'data-pfad="master/kleber"', 'data-pfad="master/pfl"', 'data-fxzuweisung="1" data-kanal="master"', 'data-fx3-alle')],
  ['seq-places', 'SEQ place nodes: PLAY, large view, widths, hide empty, open in PRODUCTION, + pattern, LOAD MODULE, CLEAR', () => enthaelt('seq_view.js', 'sq-spiel', 'sq-gross', 'sq-breite', 'sq-leer-aus', 'sq-produktion', 'sq-neu', 'sq-modul', 'sq-leeren', "'seqplatz deckflaeche'")],
  ['seq-scenes', 'SEQ scene keys stay in the header', () => assert.match(lies('index.html'), /<header id="kopf">[\s\S]*id="seq-szenen"[\s\S]*<\/header>/)],
  ['header', 'view buttons, PAIR TABLET, PHONES, DJ FX toggle, Cypher keys, connection dots', () => enthaelt('index.html', 'id="kopplung-knopf"', 'class="kopfmix"', 'id="fx"', 'id="t-stopp"', 'id="v-kern"', 'class="uhr"')],
  ['bottom', 'library, effects dock, instruments, presets, controllers', () => enthaelt('index.html', 'id="bestand"', 'id="live-dock"', 'id="instrumente"', 'id="register"')],
  ['decks', 'track decks, loop deck places, stems places', () => enthaelt('index.html', 'id="platz-loops"', 'id="platz-loops2"', 'data-platz-body="track"')],
];

for (const [id, was, pruefe] of ZEILEN) test(`inventory ${id} (${was}): still in the code`, pruefe);
