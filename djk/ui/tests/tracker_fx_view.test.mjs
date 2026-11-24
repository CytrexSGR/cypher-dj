// Tracker task 17: effect columns, TICKS and the effect status texts in the view. The model part is pure (projection, texts, builder); the view part runs
// against the DOM stand-in and a stand-in server. The stand-in server applies the commands with the real `fuehreListeAus` (`fx_setzen` and `MidiClip.fx`, task 12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { kopie } from './support/project.mjs';

installiere();
const M = await import('../public/tracker/grid_model.js');
const E = await import('../public/tracker/eingabe.js');
const T = await import('../public/tracker/tasten.js');
const { bindeTracker } = await import('../public/tracker/tracker.js');
const { projiziere, fxText, statusText, fxBeschreibung, FX_CODES } = M;

const CODES = ['ARP', 'SLU', 'SLD', 'GLD', 'VIB', 'TRM', 'VSL', 'LVL', 'RTG', 'PAN', 'OFS', 'REV'];
const note = (id, beat, laenge, ton) => ({ id, beat, laenge, ton, vel: 100 });
const fx = (beat, spalte, code, wert) => ({ beat, spalte, code, wert });

function projekt(extra = {}) {
  return {
    format: 'cypherdj-projekt/2', name: 'T', tempo_bpm: 120, taktart: [4, 4],
    spuren: [
      { id: 's1', nr: 1, name: 'lead', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'lead', parameter: {} },
        clips: [{ id: 'c1', art: 'midi', name: 'a', start_beat: 0, laenge_beats: 16, noten: [note('n1', 0, 4, 60)],
          fx: [fx(0, 0, 'VIB', 0x46), fx(0.5, 2, 'SLU', 0x10), fx(0.5, 0, 'ARP', 0x37)],
          huellkurven: [{ ziel: 'geraet.k12', punkte: [{ beat: 0.5, wert: 0, form: 'sprung' }] }] }] },
      { id: 's2', nr: 2, name: 'drums', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'k' },
        clips: [{ id: 'c2', art: 'midi', name: 'd', start_beat: 0, laenge_beats: 16, noten: [note('d1', 0, 1, 36)],
          fx: [fx(0, 0, 'SLU', 0x10), fx(0.25, 1, 'RTG', 0x02), fx(0.5, 0, 'PAN', 0xc0)] }] },
      { id: 's3', nr: 3, name: 'vox', art: 'audio', clips: [] },
    ],
    ...extra,
  };
}
const rast = (p, o = {}) => projiziere(p, { abschnitt_id: 'a1', lpb: 4, ...o });

// --- projection ---
test('FX_CODES lists the 12 mnemonics of the plan', () => {
  assert.deepEqual([...FX_CODES], CODES);
});

test('entries fill their stored column, a knob jump takes the first remaining column of its row', () => {
  const s = rast(projekt()).spuren[0];
  assert.deepEqual(s.fxspalten[0][0], { code: 'VIB', wert: 0x46 });
  assert.deepEqual(s.fxspalten[0][2], { code: 'ARP', wert: 0x37 });
  assert.deepEqual(s.fxspalten[2][2], { code: 'SLU', wert: 0x10 });
  assert.deepEqual(s.fxspalten[1][2], { knopf: 12, wert: 0x80 }, 'column 0 and 2 are taken in row 2: the knob goes to column 1');
  assert.equal(s.fxspalten.length, 3);
  assert.equal(s.fxspalten[1][0], null);
});

test('an entry off the row line after an LPB change is tinted in its row, never dropped', () => {
  const p = projekt();
  const r3 = rast(p, { lpb: 3 }).spuren[0];
  const z = r3.fxspalten[0];
  assert.equal(z[0].schief, undefined, 'beat 0 is on every row line');
  assert.equal(z[1].code, 'ARP'); assert.equal(z[1].schief, true, 'beat 0.5 lies inside row 1 (1/3 .. 2/3) at LPB 3');
  assert.equal(r3.fxspalten[2][1].code, 'SLU'); assert.equal(r3.fxspalten[2][1].schief, true);
  assert.equal(rast(p, { lpb: 4 }).spuren[0].fxspalten[0][2].schief, undefined);
});

test('audio tracks have no effect columns; a clip without fx projects exactly as before', () => {
  assert.deepEqual(rast(projekt()).spuren[2].fxspalten, []);
  const p = projekt(); delete p.spuren[0].clips[0].fx; delete p.spuren[0].clips[0].huellkurven;
  const s = rast(p).spuren[0];
  assert.equal(s.fxspalten.length, 1); assert.ok(s.fxspalten[0].every((c) => c === null));
});

test('a loop copy shows the entries again, an entry behind the loop end is silent', () => {
  const p = projekt(); const c = p.spuren[0].clips[0];
  c.loop_beats = 2; c.fx = [fx(0, 0, 'LVL', 0x80), fx(3, 0, 'PAN', 0x80)];
  const col = rast(p).spuren[0].fxspalten[0];
  assert.deepEqual([col[0]?.code, col[8]?.code, col[16]?.code], ['LVL', 'LVL', 'LVL']);
  assert.equal(col.filter((x) => x?.code === 'PAN').length, 0);
});

// --- cell texts ---
test('effect cell text: three letters and two hex digits, three decimal digits in DEC, same width as a knob cell', () => {
  assert.equal(fxText({ code: 'VIB', wert: 0x46 }, 'hex'), 'VIB 46');
  assert.equal(fxText({ code: 'VIB', wert: 0x46 }, 'dec'), 'VIB 070');
  assert.equal(fxText({ code: 'PAN', wert: 0 }, 'hex'), 'PAN 00');
  assert.equal(fxText({ code: 'PAN', wert: 255 }, 'hex').length, fxText({ knopf: 1, wert: 1 }, 'hex').length);
  assert.equal(fxText({ code: 'PAN', wert: 255 }, 'dec').length, fxText(null, 'dec').length);
});

// --- status texts ---
const TEXTE = [
  ['ARP', 0x37, 'arpeggio, one jump per tick through +0, +3 and +7 semitones'],
  ['SLU', 0x10, 'slide up 1 semitone per tick from the second tick'],
  ['SLD', 0x08, 'slide down 1/2 semitone per tick from the second tick'],
  ['GLD', 0x08, 'glide to this note, 1/2 semitone per tick'],
  ['VIB', 0x46, 'vibrato, speed 4/64 of a cycle per tick, depth 6/8 semitone'],
  ['TRM', 0x84, 'tremolo, speed 8/64 of a cycle per tick, depth 4/16 of the level'],
  ['VSL', 0x30, 'volume slide up 3/64 of the level per tick'],
  ['LVL', 0x80, 'level 50 % of the output, until the next new note'],
  ['RTG', 0x02, 'retrigger the sounding note every 2 ticks inside the row'],
  ['PAN', 0x40, 'pan left 50 %'],
  ['OFS', 0x80, 'sample start at 128/256 of the sample'],
  ['REV', 0x01, 'play the sample backwards'],
];
test('the status line explains each of the 12 codes in words with its values', () => {
  assert.deepEqual(TEXTE.map((t) => t[0]), CODES);
  for (const [code, wert, text] of TEXTE) assert.equal(fxBeschreibung(code, wert), text, code);
  const p = projekt(); p.spuren[0].clips[0].fx = TEXTE.map(([code, wert], i) => fx(i / 4, 0, code, wert)).slice(0, 12);
  const r = rast(p, { rollen: () => ({ start: 3, rueckwaerts: 4 }) });
  TEXTE.forEach(([code, wert, text], i) => {
    const s = statusText(r, { spur: 0, spalte: 0, zeile: i, unterspalte: 'fx', fxspalte: 0 }, 'hex');
    assert.equal(s, `A lead, row ${String(i).padStart(2, '0')}, FX: ${code} ${wert.toString(16).toUpperCase().padStart(2, '0')} = ${text}`, code);
  });
});

test('status line edge texts: 00 values, unchanged speed or depth, down slide, right pan, other REV values', () => {
  assert.equal(fxBeschreibung('VIB', 0x00), 'vibrato, speed and depth unchanged');
  assert.equal(fxBeschreibung('VIB', 0x40), 'vibrato, speed 4/64 of a cycle per tick, depth unchanged');
  assert.equal(fxBeschreibung('GLD', 0x00), 'glide to this note, at the speed of the last GLD');
  assert.equal(fxBeschreibung('SLU', 0x00), 'no slide');
  assert.equal(fxBeschreibung('SLU', 0x20), 'slide up 2 semitones per tick from the second tick');
  assert.equal(fxBeschreibung('VSL', 0x03), 'volume slide down 3/64 of the level per tick');
  assert.equal(fxBeschreibung('VSL', 0x00), 'no volume slide');
  assert.equal(fxBeschreibung('RTG', 0x30), 'no retrigger');
  assert.equal(fxBeschreibung('RTG', 0x01), 'retrigger the sounding note every 1 tick inside the row');
  assert.equal(fxBeschreibung('PAN', 0x80), 'pan centre');
  assert.equal(fxBeschreibung('PAN', 0xff), 'pan right 100 %');
  assert.equal(fxBeschreibung('REV', 0x00), 'play the sample forwards (only 01 reverses)');
});

test('an entry off the row line says so in the status line', () => {
  const r = rast(projekt(), { lpb: 3 });
  const s = statusText(r, { spur: 0, spalte: 0, zeile: 1, unterspalte: 'fx', fxspalte: 0 }, 'hex');
  assert.ok(s.startsWith('A lead, row 01, FX: ARP 37 = arpeggio'), s);
  assert.ok(s.endsWith('; off the row line at beat 0.50, retyping puts it on the row line'), s);
});

test('dimmed cell and the extra status text on a track that is not a Cypher Modular graph', () => {
  const r = rast(projekt());
  const kit = r.spuren[1].fxspalten;
  assert.equal(kit[0][0].ohne, true, 'SLU on a kit track');
  assert.equal(kit[0][2].ohne, undefined, 'PAN is a track lane: it acts on every device');
  assert.equal(kit[1][1].ohne, undefined, 'RTG starts notes again: it acts on every device');
  assert.equal(r.spuren[0].fxspalten[0][0].ohne, undefined, 'VIB on a graph');
  const s = statusText(r, { spur: 1, spalte: 0, zeile: 0, unterspalte: 'fx', fxspalte: 0 }, 'hex');
  assert.ok(s.endsWith('; no effect on this device'), s);
  assert.ok(!statusText(r, { spur: 1, spalte: 0, zeile: 2, unterspalte: 'fx', fxspalte: 0 }, 'hex').includes('no effect'));
});

test('OFS and REV without the role are dimmed on a graph, with the role they are not; without role information nothing is claimed', () => {
  const p = projekt(); p.spuren[0].clips[0].fx = [fx(0, 0, 'OFS', 0x40), fx(0, 1, 'REV', 0x01), fx(0.25, 0, 'VIB', 0x11)];
  const mit = rast(p, { rollen: () => ({ start: 3, rueckwaerts: 4 }) }).spuren[0].fxspalten;
  assert.equal(mit[0][0].ohne, undefined); assert.equal(mit[1][0].ohne, undefined);
  const ohne = rast(p, { rollen: () => null }).spuren[0].fxspalten;
  assert.equal(ohne[0][0].ohne, true); assert.equal(ohne[1][0].ohne, true); assert.equal(ohne[0][1].ohne, undefined);
  const nurStart = rast(p, { rollen: () => ({ start: 3 }) }).spuren[0].fxspalten;
  assert.equal(nurStart[0][0].ohne, undefined); assert.equal(nurStart[1][0].ohne, true);
  const unbekannt = rast(p).spuren[0].fxspalten;
  assert.equal(unbekannt[0][0].ohne, undefined);
  const s = statusText(rast(p, { rollen: () => null }), { spur: 0, spalte: 0, zeile: 0, unterspalte: 'fx', fxspalte: 0 }, 'hex');
  assert.ok(s.endsWith('; no effect on this device'), s);
});

// --- builder ---
const ort = (extra = {}) => ({ abschnitt_id: 'a1', spur_id: 's1', spalte: 0, zeile: 0, unterspalte: 'fx', fxspalte: 0, lpb: 4, ...extra });

test('fxSetzen writes one fx_setzen entry at the row start, in clip beats', () => {
  const p = projekt();
  const r = E.fxSetzen(p, ort({ zeile: 8, fxspalte: 1 }), 'GLD', 8);
  assert.deepEqual(r.befehle, [{ befehl: 'fx_setzen', clip_id: 'c1', eintraege: [{ beat: 2, spalte: 1, code: 'GLD', wert: 8 }] }]);
  assert.equal(r.label, 'Effect GLD 08');
});

test('fxSetzen over an off-line entry replaces it with one command; null removes entries', () => {
  const p = projekt();
  const r = E.fxSetzen(p, ort({ zeile: 1 }), 'RTG', 3);
  assert.deepEqual(r.befehle, [{ befehl: 'fx_setzen', clip_id: 'c1', eintraege: [{ beat: 0.25, spalte: 0, code: 'RTG', wert: 3 }] }]);
  const q = rast(p, { lpb: 3 });
  assert.equal(q.spuren[0].fxspalten[0][1].schief, true);
  const schief = E.fxSetzen(p, ort({ zeile: 1, lpb: 3 }), 'RTG', 3);
  assert.deepEqual(schief.befehle[0].eintraege, [{ beat: 0.5, spalte: 0, code: null }, { beat: 0.333333333, spalte: 0, code: 'RTG', wert: 3 }]);
  const weg = E.zelleLeeren(p, ort({ zeile: 2 }));
  assert.deepEqual(weg.befehle, [{ befehl: 'fx_setzen', clip_id: 'c1', eintraege: [{ beat: 0.5, spalte: 0, code: null }] }]);
  const wegSchief = E.zelleLeeren(p, ort({ zeile: 1, lpb: 3 }));
  assert.deepEqual(wegSchief.befehle[0].eintraege, [{ beat: 0.5, spalte: 0, code: null }]);
  assert.equal(E.zelleLeeren(p, ort({ zeile: 3 })), null, 'an empty cell: nothing to do');
  assert.equal(E.fxSetzen(p, ort({ zeile: 3 }), null, 0), null);
});

test('fxSetzen refusals: unknown mnemonic, bad value, no clip, audio track, column beyond 4', () => {
  const p = projekt();
  assert.equal(E.fxSetzen(p, ort(), 'XYZ', 1).fehler, 'Unknown effect: XYZ (ARP SLU SLD GLD VIB TRM VSL LVL RTG PAN OFS REV)');
  assert.equal(E.fxSetzen(p, ort(), 'VIB', 256).fehler, 'Effect value 00..FF expected');
  assert.equal(E.fxSetzen(p, ort(), 'VIB', 1.5).fehler, 'Effect value 00..FF expected');
  assert.equal(E.fxSetzen(p, ort({ fxspalte: 4 }), 'VIB', 1).fehler, 'Effect commands stand in the first four effect columns');
  assert.equal(E.fxSetzen(p, ort({ spur_id: 's3' }), 'VIB', 1).fehler, 'Audio track: it takes no notes or knob values');
  const leer = projekt(); leer.spuren[1].clips = [];
  assert.equal(E.fxSetzen(leer, ort({ spur_id: 's2' }), 'VIB', 1).fehler, 'No clip here: type a note first');
  assert.equal(E.fxSetzen(p, ort({ zeile: 64 }), 'VIB', 1).fehler, 'The row lies outside the section');
});

// --- keys ---
test('tasten: letters in the command half, hex digits in the value half', () => {
  const k = (code, key) => T.taste({ code, key }, { unterspalte: 'fx', zahlen: 'hex', fxteil: 'befehl' });
  assert.deepEqual(k('KeyV', 'v'), { art: 'buchstabe', zeichen: 'V' });
  assert.deepEqual(k('KeyA', 'a'), { art: 'buchstabe', zeichen: 'A' });
  assert.deepEqual(T.taste({ code: 'KeyB', key: 'b' }, { unterspalte: 'fx', zahlen: 'hex', fxteil: 'wert' }), { art: 'ziffer', wert: 11 });
  assert.equal(T.taste({ code: 'KeyB', key: 'b' }, { unterspalte: 'fx', zahlen: 'dec', fxteil: 'wert' }), null);
});

// --- the view ---
let server, wurzel, w, $t;
const post = (u, k) => fetch(u, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 40; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && (!weg || a.url === weg));
const AENDERN = () => POSTS('/proj/aendern').map((a) => a.koerper);

// the real command list (fx_setzen is a command since task 12)
function wendeAn(p, befehle) { return fuehreListeAus(p, befehle).projekt; }
function neuerServer(p0) {
  const s = { projekt: p0 };
  const antwort = () => ({ rev: s.projekt.rev, projekt: s.projekt, slug: 'song' });
  s.antworten = {
    'GET /proj/aktuell': () => ({ j: antwort() }),
    'POST /proj/aendern': (k) => {
      if (k.rev !== s.projekt.rev) return { code: 409, j: { fehler: 'rev_veraltet' } };
      s.projekt = { ...wendeAn(s.projekt, k.befehle), rev: s.projekt.rev + 1 };
      return { j: antwort() };
    },
    'POST /sampler/hoeren': () => ({ j: {} }),
  };
  return s;
}
const mitClip = () => {
  const p = fuehreListeAus(kopie(neuesProjekt('Song')), [
    { befehl: 'spur_neu', art: 'instrument', name: 'I', geraet: { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} } },
  ]).projekt;
  return fuehreListeAus(kopie(p), [{ befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 16, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] }]).projekt;
};
async function aufbau(p = mitClip()) {
  server = neuerServer(p);
  installiere({ antworten: server.antworten });
  document.addEventListener = () => {};
  wurzel = document.createElement('section');
  w = bindeTracker({ post, wurzel, frage: () => true });
  $t = (n) => wurzel.querySelector(`[data-t="${n}"]`);
  w.zeige(); await ruhe();
}
const taste = (code, extra = {}) => $t('raster').dispatch('keydown', { code, key: extra.key ?? code, ...extra });
const buchstabe = (c) => taste(`Key${c}`, { key: c.toLowerCase() });
const ziffer = (z) => taste(`Digit${z}`, { key: String(z) });
const zelle = (s, sp, z, u, f = '') => wurzel.querySelector(`[data-k="${s}:${sp}:${z}:${u}:${f}"]`);
const gehe = (z) => w.ctx.setzeCursor({ spur: 0, spalte: 0, zeile: z, unterspalte: 'fx', fxspalte: 0 });
const clipFx = () => server.projekt.spuren[0].clips[0].fx;

test('typing VIB46 in an effect cell writes exactly one fx_setzen', async () => {
  await aufbau();
  gehe(4); $t('edit').dispatch('click'); await ruhe();
  buchstabe('V'); buchstabe('I'); buchstabe('B'); ziffer(4); await ruhe();
  assert.equal(AENDERN().length, 0, 'nothing is written before the value is complete');
  ziffer(6); await ruhe();
  assert.equal(AENDERN().length, 1);
  assert.deepEqual(AENDERN()[0].befehle, [{ befehl: 'fx_setzen', clip_id: server.projekt.spuren[0].clips[0].id, eintraege: [{ beat: 1, spalte: 0, code: 'VIB', wert: 0x46 }] }]);
  assert.deepEqual(clipFx(), [{ beat: 1, spalte: 0, code: 'VIB', wert: 0x46 }]);
  assert.equal(zelle(0, 0, 4, 'fx', 0).textContent, 'VIB 46');
  assert.ok(wurzel.querySelector('[data-t="status"]').textContent.includes('VIB 46 = vibrato, speed 4/64 of a cycle per tick, depth 6/8 semitone'));
});

test('hex letters A..F complete the value; DEC takes three digits', async () => {
  await aufbau();
  gehe(0); $t('edit').dispatch('click'); await ruhe();
  buchstabe('L'); buchstabe('V'); buchstabe('L'); buchstabe('B'); buchstabe('F'); await ruhe();
  assert.deepEqual(clipFx(), [{ beat: 0, spalte: 0, code: 'LVL', wert: 0xbf }]);
  $t('zahlen').dispatch('click'); await ruhe();
  gehe(1);
  buchstabe('P'); buchstabe('A'); buchstabe('N'); ziffer(1); ziffer(2); await ruhe();
  assert.equal(AENDERN().length, 1, 'two of three DEC digits: still pending');
  ziffer(8); await ruhe();
  assert.deepEqual(clipFx()[1], { beat: 0.25, spalte: 0, code: 'PAN', wert: 128 });
});

test('an unknown mnemonic is refused with the list, nothing is written', async () => {
  await aufbau();
  gehe(0); $t('edit').dispatch('click'); await ruhe();
  buchstabe('X'); buchstabe('Y'); buchstabe('Z'); await ruhe();
  assert.equal(AENDERN().length, 0);
  const m = $t('meldung');
  assert.equal(m.textContent, 'Unknown effect: XYZ (ARP SLU SLD GLD VIB TRM VSL LVL RTG PAN OFS REV)');
  assert.ok(m.classList.contains('fehler'));
  ziffer(1); await ruhe();
  assert.equal(AENDERN().length, 0, 'the buffer was dropped with the refusal: a digit alone writes nothing');
});

test('EDIT off: letters in an effect cell write nothing; Escape drops the pending letters; moving the cursor drops them', async () => {
  await aufbau();
  gehe(0);
  buchstabe('V'); buchstabe('I'); buchstabe('B'); ziffer(1); ziffer(1); await ruhe();
  assert.equal(AENDERN().length, 0);
  $t('edit').dispatch('click'); await ruhe();
  buchstabe('V'); buchstabe('I'); taste('Escape'); buchstabe('B'); ziffer(1); ziffer(1); await ruhe();
  assert.equal(AENDERN().length, 0, 'after Escape the B starts a new word');
  buchstabe('V'); buchstabe('I'); taste('ArrowDown'); gehe(0); buchstabe('B'); await ruhe();
  assert.equal(AENDERN().length, 0);
});

test('Delete in an effect cell removes the entry with one fx_setzen', async () => {
  const p = mitClip(); const cid = p.spuren[0].clips[0].id;
  p.spuren[0].clips[0].fx = [{ beat: 1, spalte: 0, code: 'VIB', wert: 0x46 }];
  await aufbau(p);
  gehe(4); $t('edit').dispatch('click'); await ruhe();
  taste('Delete'); await ruhe();
  assert.deepEqual(AENDERN()[0].befehle, [{ befehl: 'fx_setzen', clip_id: cid, eintraege: [{ beat: 1, spalte: 0, code: null }] }]);
  assert.equal(clipFx(), undefined);
  assert.equal(zelle(0, 0, 4, 'fx', 0).textContent, '... ..');
});

test('a command in a row without a clip is refused with the knob text', async () => {
  const p = mitClip(); p.spuren[0].clips[0].laenge_beats = 2;
  await aufbau(p);
  gehe(12); $t('edit').dispatch('click'); await ruhe();
  buchstabe('V'); buchstabe('I'); buchstabe('B'); ziffer(1); ziffer(1); await ruhe();
  assert.equal(AENDERN().length, 0);
  assert.equal($t('meldung').textContent, 'No clip here: type a note first');
});

test('the effect cell of a kit track is dimmed in the grid; off-line entries carry the tint class', async () => {
  const p = mitClip();
  p.spuren[0].geraet = { art: 'intern', name: 'kit', kit: 'k' };
  p.spuren[0].clips[0].fx = [{ beat: 0, spalte: 0, code: 'SLU', wert: 16 }, { beat: 0.5, spalte: 1, code: 'PAN', wert: 128 }];
  await aufbau(p);
  assert.ok(zelle(0, 0, 0, 'fx', 0).classList.contains('ohne'));
  assert.ok(!zelle(0, 0, 2, 'fx', 1).classList.contains('ohne'));
  gehe(0); w.ctx.zeichne();
  assert.ok(wurzel.querySelector('[data-t="status"]').textContent.endsWith('; no effect on this device'));
  $t('lpb').value = '3'; $t('lpb').dispatch('change'); await ruhe();
  assert.ok(zelle(0, 0, 1, 'fx', 1).classList.contains('schief'), 'beat 0.5 inside row 1 at LPB 3');
});

test('TICKS is a selector 1..24 that writes tracker_setzen {ticks}', async () => {
  await aufbau();
  assert.equal($t('ticks').disabled, false);
  assert.equal($t('ticks').value, '6');
  assert.equal($t('ticks').children.length, 24);
  $t('ticks').value = '12'; $t('ticks').dispatch('change'); await ruhe();
  assert.deepEqual(AENDERN().map((k) => k.befehle), [[{ befehl: 'tracker_setzen', ticks: 12 }]]);
  assert.equal(AENDERN()[0].label, 'TICKS 12');
});

// --- knob values typed in an effect cell (follow-up F3) ---
const knopfPunkte = (n) => server.projekt.spuren[0].clips[0].huellkurven?.find((h) => h.ziel === `geraet.k${n}`)?.punkte;

test('K, 1, 2, 8, 0 in HEX writes knob 12 with byte 0x80 as one history step', async () => {
  await aufbau();
  gehe(4); $t('edit').dispatch('click'); await ruhe();
  buchstabe('K'); ziffer(1); ziffer(2); ziffer(8); await ruhe();
  assert.equal(AENDERN().length, 0, 'nothing is written before the value is complete');
  ziffer(0); await ruhe();
  assert.equal(AENDERN().length, 1);
  assert.equal(AENDERN()[0].label, 'Knob 12');
  assert.equal(AENDERN()[0].befehle.length, 1);
  assert.equal(knopfPunkte(12).length, 1);
  assert.equal(E.knopfWert(server.projekt, ort({ zeile: 4 }), 12, 0x80), null, 'the stored point reads back as byte 0x80');
  assert.equal(zelle(0, 0, 4, 'fx', 0).textContent, 'K12 80');
});

test('hex letters complete the value of a knob; DEC takes three digits', async () => {
  await aufbau();
  gehe(0); $t('edit').dispatch('click'); await ruhe();
  buchstabe('K'); ziffer(0); ziffer(5); buchstabe('F'); buchstabe('F'); await ruhe();
  assert.equal(zelle(0, 0, 0, 'fx', 0).textContent, 'K05 FF');
  $t('zahlen').dispatch('click'); await ruhe();
  gehe(1);
  buchstabe('K'); ziffer(6); ziffer(4); ziffer(0); ziffer(6); await ruhe();
  assert.equal(AENDERN().length, 1, 'two of three DEC digits: still pending');
  ziffer(4); await ruhe();
  assert.equal(AENDERN().length, 2);
  assert.equal(zelle(0, 0, 1, 'fx', 0).textContent, 'K64 064');
});

test('knob 00 and knob 65 are refused at the second digit, nothing is written', async () => {
  await aufbau();
  gehe(0); $t('edit').dispatch('click'); await ruhe();
  buchstabe('K'); ziffer(0); ziffer(0); await ruhe();
  assert.equal($t('meldung').textContent, 'Knob 01..64 expected');
  assert.ok($t('meldung').classList.contains('fehler'));
  ziffer(8); ziffer(0); await ruhe();
  buchstabe('K'); ziffer(6); ziffer(5); await ruhe();
  assert.equal($t('meldung').textContent, 'Knob 01..64 expected');
  ziffer(8); ziffer(0); await ruhe();
  assert.equal(AENDERN().length, 0);
});

test('Delete on a knob cell removes the point; a command or another knob in the cell refuses a knob value', async () => {
  const p = mitClip();
  p.spuren[0].clips[0].huellkurven = [{ ziel: 'geraet.k12', punkte: [{ beat: 1, wert: 0, form: 'sprung' }] }];
  p.spuren[0].clips[0].fx = [{ beat: 2, spalte: 0, code: 'VIB', wert: 0x46 }];
  await aufbau(p);
  gehe(4); $t('edit').dispatch('click'); await ruhe();
  taste('Delete'); await ruhe();
  assert.equal(AENDERN().length, 1);
  assert.equal(knopfPunkte(12), undefined);
  gehe(8);
  buchstabe('K'); ziffer(0); ziffer(3); await ruhe();
  assert.equal($t('meldung').textContent, 'This cell holds an effect command, a curve or another knob: clear it first (Delete)');
  assert.equal(AENDERN().length, 1, 'refused, nothing written');
});

test('a knob value over the same knob in the cell replaces its value; Escape drops a pending knob word', async () => {
  const p = mitClip();
  p.spuren[0].clips[0].huellkurven = [{ ziel: 'geraet.k12', punkte: [{ beat: 1, wert: 0, form: 'sprung' }] }];
  await aufbau(p);
  gehe(4); $t('edit').dispatch('click'); await ruhe();
  buchstabe('K'); ziffer(1); ziffer(2); taste('Escape'); ziffer(1); await ruhe();
  assert.equal(AENDERN().length, 0, 'after Escape a digit alone writes nothing');
  buchstabe('K'); ziffer(1); ziffer(2); ziffer(4); ziffer(0); await ruhe();
  assert.equal(AENDERN().length, 1);
  assert.equal(knopfPunkte(12).length, 1);
  assert.equal(zelle(0, 0, 4, 'fx', 0).textContent, 'K12 40');
});
