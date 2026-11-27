// The registry of the project command handlers (project/commands_helpers.ts): mergeTabellen fills one object and refuses a command that two tables define.
import test from 'node:test';
import assert from 'node:assert/strict';
// commands.ts first: it is the entry of the module graph (routing_rules.ts imports it back, so entering through commands_helpers.ts would hit the registry before it exists)
import { PRO_BEFEHL, BEFEHL_NAMEN, fuehreAus } from '../project/commands.ts';
import { SPUR } from '../project/commands_track.ts';
import { CLIP } from '../project/commands_clip.ts';
import { GRUPPE } from '../project/commands_group.ts';
import { INSERT } from '../project/commands_insert.ts';
import { AUTO } from '../project/commands_auto.ts';
import { TRANSPORT } from '../project/commands_transport.ts';
import { SZENEN } from '../project/commands_szenen.ts';
import { SESSION } from '../project/commands_session.ts';
import { TRACKER } from '../project/commands_tracker.ts';
import { LOOPDECK } from '../project/commands_loopdeck.ts';
import { CONTAINER } from '../project/commands_container.ts';
import { AUDIO_NOTEN } from '../project/commands_audio_notes.ts';
import { neuesProjekt } from '../project/model.ts';
import { mergeTabellen, PRO_BEFEHL as REGISTER } from '../project/commands_helpers.ts';

test('mergeTabellen: returns the target itself with the keys of every table', () => {
  const f = () => {}, g = () => {};
  const z = {};
  const r = mergeTabellen(z, { x: f }, { y: g });
  assert.equal(r, z);
  assert.deepEqual(Object.keys(z), ['x', 'y']);
  assert.equal(z.x, f);
  assert.equal(z.y, g);
});

test('mergeTabellen: a key that is already defined throws duplicate command', () => {
  const f = () => {}, g = () => {};
  assert.throws(() => mergeTabellen({}, { x: f }, { x: g }), /^Error: duplicate command: x$/);
  assert.throws(() => mergeTabellen({ x: f }, { x: g }), /duplicate command: x/);
});

test('commands.ts exports the registry object of commands_helpers.ts', () => {
  assert.equal(PRO_BEFEHL, REGISTER);
  assert.ok(Object.keys(PRO_BEFEHL).length > 0);
});

// the command names of the table as it stood before the split (main 7267f21e0, taken with grep over the old literal)
const NAMEN_MAIN = [
  'audio_quantisieren', 'aufnahme_setzen', 'auto_aendern', 'auto_dehnen', 'auto_form', 'auto_loeschen', 'auto_neigen', 'auto_neu', 'auto_punkte',
  'auto_vereinfachen', 'bk_setzen', 'blend_setzen', 'blend_trim_setzen', 'clip_aendern', 'clip_aus_muster', 'clip_duplizieren', 'clip_loeschen',
  'clip_neu', 'clips_verbinden', 'clip_teilen', 'comp_waehlen', 'duck_durch_kick', 'eins_hier', 'geraet_param_setzen', 'geraet_richtung',
  'gruppenspur_aendern', 'gruppenspur_loeschen', 'gruppenspur_neu', 'huellkurve_loeschen', 'huellkurve_setzen', 'insert_an', 'insert_entfernen',
  'insert_latenz_extra', 'insert_ordnung', 'insert_param_setzen', 'insert_setzen', 'insert_werte_setzen', 'loop_setzen', 'makro_variation_laden',
  'makro_variation_loeschen', 'makro_variation_speichern', 'master_aendern', 'metronom_setzen', 'modul_setzen', 'noten_aendern', 'noten_loeschen',
  'noten_neu', 'preset_anwenden', 'rack_glied_entfernen', 'rack_glied_setzen', 'rack_kette', 'rack_makro', 'rack_setzen', 'return_aendern',
  'return_loeschen', 'return_neu', 'send_setzen', 'seq_anlegen', 'seq_folge_neu', 'seq_leeren', 'spur_aendern', 'spur_loeschen', 'spur_neu',
  'spur_verschieben', 'stammbaum_setzen', 'take_loeschen', 'take_neu', 'take_umbenennen', 'taktart_setzen', 'tempo_setzen', 'tempo_vom_clip',
  'tonart_setzen', 'variante_waehlen', 'warp_ab_hier', 'warp_auto', 'warp_marker', 'warp_setzen', 'warp_tempo', 'werkbank_bereich',
  'werkbank_spur_neu', 'zeile_setzen', 'ziel_setzen',
];
// the SEQ scene commands (family SZENEN) came after the split
const NAMEN_SZENEN = ['szene_anwenden', 'szene_loeschen', 'szene_speichern'];
// the tracker command (family TRACKER) came with the tracker view
const NAMEN_TRACKER = ['tracker_setzen'];
// the time and section commands (family TRACKER) came with the section list
const NAMEN_ABSCHNITTE = ['abschnitt_duplizieren', 'abschnitt_laenge', 'abschnitt_loeschen', 'abschnitt_neu', 'abschnitt_umbenennen', 'abschnitt_verschieben',
  'zeit_einfuegen', 'zeit_entfernen'];
// the linked-clip commands (ADR 039, family CLIP) came with the tracker patterns
const NAMEN_VERBUND = ['clip_entknuepfen', 'clip_verknuepfen'];
// the effect command (family TRACKER, task 12)
const NAMEN_FX = ['fx_setzen'];
// the loop deck commands (family LOOPDECK): 5 deck commands (neu, leeren, aendern, send, effekt) and 3 cell commands (setzen, aendern, bewegen)
const NAMEN_LOOPDECK = ['loopdeck_aendern', 'loopdeck_effekt', 'loopdeck_leeren', 'loopdeck_neu', 'loopdeck_send', 'zelle_aendern', 'zelle_bewegen', 'zelle_setzen'];
// the container commands (family CONTAINER): the places and the strudel module
const NAMEN_CONTAINER = ['platz_setzen', 'strom_send', 'strom_spur_neu'];
// the session view commands (family SESSION): the launch grid, the hold slot and the scene rows (szene_loeschen stays in SZENEN and takes slot or zeile)
const NAMEN_SESSION = ['session_aendern', 'szene_aendern', 'szene_doppeln', 'szene_fangen', 'szene_neu', 'zelle_halten', 'zelle_huelle'];
const NAMEN_STECKFELD = ['geraet_stift_setzen', 'geraet_stifte_setzen'];
// the note editor commands (family AUDIO_NOTEN): pitch targets of the detected notes of an audio clip
const NAMEN_AUDIO_NOTEN = ['audio_noten_aendern', 'audio_noten_entfernen', 'audio_noten_zuruecksetzen'];
// the release metadata command (family TRANSPORT, export delivery plan task 4)
const NAMEN_ABGABE = ['abgabe_meta_setzen'];
// the piano roll tool commands (family CLIP): quantise with grid, strength and swing; humanise
const NAMEN_ROLLE = ['noten_humanisieren', 'noten_quantisieren'];
// the arrangement marker commands (family TRANSPORT)
const NAMEN_MARKER = ['marker_loeschen', 'marker_setzen'];
// the plugin knob command (family INSERT, strand 2 task 2.2)
const NAMEN_PLUGIN = ['plugin_regler_setzen'];
const NAMEN_ALLE = [...NAMEN_MAIN, ...NAMEN_SZENEN, ...NAMEN_TRACKER, ...NAMEN_ABSCHNITTE, ...NAMEN_VERBUND, ...NAMEN_FX, ...NAMEN_LOOPDECK,
  ...NAMEN_CONTAINER, ...NAMEN_SESSION, ...NAMEN_STECKFELD, ...NAMEN_AUDIO_NOTEN, ...NAMEN_ABGABE, ...NAMEN_ROLLE, ...NAMEN_MARKER, ...NAMEN_PLUGIN];

test('PRO_BEFEHL holds the 82 commands of the table before the split plus the 3 scene commands, the tracker command, the 8 time and section commands the 2 linked-clip commands and the effect command, the 8 loop deck commands, the 3 container commands, the 7 session commands, the 3 note editor commands, the release metadata command, the 2 piano roll tool commands and the 2 marker commands', () => {
  assert.equal(NAMEN_MAIN.length, 82);
  assert.equal(NAMEN_ALLE.length, 126);   // + the plugin knob command
  assert.deepEqual(Object.keys(PRO_BEFEHL).sort(), [...NAMEN_ALLE].sort());
});

test('every command is defined in exactly one family table; BEFEHL_NAMEN is the key list of the registry', () => {
  const familien = { SPUR, CLIP, GRUPPE, INSERT, AUTO, TRANSPORT, SZENEN, TRACKER, LOOPDECK, CONTAINER, SESSION, AUDIO_NOTEN };
  for (const [name, t] of Object.entries(familien)) assert.ok(Object.keys(t).length > 0, `${name} is not empty`);
  const alle = Object.values(familien).flatMap((t) => Object.keys(t));
  assert.equal(new Set(alle).size, alle.length, 'no command twice');
  assert.deepEqual([...alle].sort(), [...NAMEN_ALLE].sort());
  assert.deepEqual([...BEFEHL_NAMEN].sort(), [...NAMEN_ALLE].sort());
  for (const n of BEFEHL_NAMEN) assert.equal(typeof PRO_BEFEHL[n], 'function', n);
});

test('handlers reach each other across families through the registry: seq_folge_neu (GRUPPE) creates its track (SPUR) and clip (CLIP)', () => {
  assert.ok(Object.hasOwn(GRUPPE, 'seq_folge_neu') && Object.hasOwn(SPUR, 'spur_neu') && Object.hasOwn(CLIP, 'clip_neu'));
  const p0 = neuesProjekt('x'); p0.live = true; p0.plaetze = [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }];
  const p1 = fuehreAus(p0, { befehl: 'seq_anlegen', platz: 2 }).projekt;
  const g = p1.gruppen[0];
  const geraet = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
  const p2 = fuehreAus(p1, { befehl: 'seq_folge_neu', gruppe_id: g.id, name: 'Bass', geraet }).projekt;
  const spur = p2.spuren.find((s) => s.name === 'Bass');
  assert.ok(spur, 'the track exists');
  assert.equal(spur.clips.length, 1, 'its one clip exists');
  assert.equal(spur.clips[0].art, 'midi');
});
