// Note editor contract (plan A, task A1): the hand-written checks of djk/ui/project/notes_contract.ts agree with the example files
// of djk/contract/cases/noten/ and with the schemas; the render key matches the hand-written pre-images.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as V from '../project/notes_contract.ts';

const CASES = fileURLToPath(new URL('../../contract/cases/noten/', import.meta.url));
const SCHEMAS = fileURLToPath(new URL('../../contract/schemas/', import.meta.url));
const lies = (n) => JSON.parse(fs.readFileSync(path.join(CASES, n + '.json'), 'utf8'));
const schema = (n) => JSON.parse(fs.readFileSync(path.join(SCHEMAS, n + '.schema.json'), 'utf8'));
const kopie = (x) => JSON.parse(JSON.stringify(x));

const GUT = ['audio_noten_gut', 'audio_noten_leer_gut', 'audio_noten_ton_24_gut', 'kurve_gut', 'kurve_kurz_gut', 'kurve_mono_gut', 'kurve_mono_mehrstimmig_gut', 'roh_gut',
  'auftrag_gut'];
// every bad file: its expected reason code comes from cases/noten/gruende.json (the same table the C++ tests assert); the text carries the reason
const TEXTE = {
  audio_noten_schlecht_reihenfolge: /order/, audio_noten_schlecht_ueberlappung: /overlap/, audio_noten_schlecht_ton_gleich: /ton.*equal/,
  audio_noten_schlecht_ton_grenze: /ton.*(limit|24)/, audio_noten_schlecht_id: /\bid\b/, audio_noten_schlecht_id_doppelt: /duplicate/,
  audio_noten_schlecht_dauer: /duration/, audio_noten_schlecht_a_gleich: /\ba\b.*equal/, audio_noten_schlecht_e_gleich: /\be\b.*equal/,
  audio_noten_schlecht_ziel_ende: /e must be greater than a/, audio_noten_schlecht_ton_bereich: /ton.*0\.\.127/,
  audio_noten_schlecht_form_vor_regel: /\bid\b/, audio_noten_schlecht_regelfolge: /duplicate/,
  kurve_schlecht_laenge: /length/, kurve_schlecht_f0: /f0_ct/, kurve_schlecht_praefix: /kurve/, kurve_schlecht_noten_dauer: /duration/,
  kurve_schlecht_noten_reihenfolge: /order/, kurve_schlecht_noten_ueberlappung: /overlap/, kurve_schlecht_noten_ausserhalb: /after the end of the source/,
  kurve_schlecht_mono_anteil: /mehrstimmig/, kurve_schlecht_mono_leer: /geprueft_frames/,
  auftrag_schlecht_kurve: /kurve/, auftrag_schlecht_id_doppelt: /duplicate/, auftrag_schlecht_dauer: /duration/, auftrag_schlecht_a_gleich: /\ba\b.*equal/,
  auftrag_schlecht_e_gleich: /\be\b.*equal/, auftrag_schlecht_ziel_ende: /e must be greater than a/, auftrag_schlecht_ton_grenze: /ton.*(limit|24)/,
  auftrag_schlecht_ton_bereich: /ton.*0\.\.127/,
};
const GRUENDE = lies('gruende');
const SCHLECHT = Object.fromEntries(Object.entries(GRUENDE).map(([datei, grund]) => { const n = datei.replace(/\.json$/, ''); return [n, [grund, TEXTE[n]]]; }));
const PRUEFER = { audio_noten: V.audioNotenPruefung, kurve: V.kurvePruefung, roh: V.rohPruefung, auftrag: V.auftragPruefung };
const pruefer = (name) => PRUEFER[Object.keys(PRUEFER).filter((p) => name.startsWith(p + '_')).sort((a, b) => b.length - a.length)[0]];

test('gruende.json lists every bad file and the TS checks return exactly its code', () => {
  const dateien = fs.readdirSync(CASES).filter((n) => n.includes('_schlecht_')).sort();
  assert.deepEqual(Object.keys(GRUENDE).sort(), dateien);
  assert.deepEqual(Object.keys(TEXTE).sort(), dateien.map((n) => n.replace(/\.json$/, '')));
  for (const [name, [grund]] of Object.entries(SCHLECHT)) assert.equal(pruefer(name)(lies(name))?.grund, grund, name);
});

test('audioNotenPruefung accepts every good case and names the reason of every bad one', () => {
  for (const name of GUT.filter((n) => n.startsWith('audio_noten_'))) assert.equal(V.audioNotenPruefung(lies(name)), null, name);
  for (const [name, [grund, muster]] of Object.entries(SCHLECHT).filter(([n]) => n.startsWith('audio_noten_'))) {
    const r = V.audioNotenPruefung(lies(name));
    assert.ok(r, name);
    assert.equal(r.grund, grund, name);
    assert.match(r.text, muster, name);
  }
  const basis = lies('audio_noten_gut');
  const mit = (f) => { const k = kopie(basis); f(k); return V.audioNotenPruefung(k); };
  assert.equal(mit((k) => { k.liste[1].id = k.liste[0].id; })?.grund, 'argument_ungueltig');
  assert.match(mit((k) => { k.liste[1].id = k.liste[0].id; }).text, /duplicate/);
  assert.match(mit((k) => { k.liste[0].qe = k.liste[0].qa + 0.01; }).text, /duration/);
  assert.match(mit((k) => { k.liste[0].a = k.liste[0].qa; }).text, /equal/);
  assert.match(mit((k) => { k.liste[0].a = k.liste[0].qe + 0.1; }).text, /e must be greater than a/);
  assert.equal(mit((k) => { k.liste[0].ton = k.liste[0].qton + 24; }), null, 'exactly 24 is inside');
  assert.equal(mit((k) => { k.liste[0].ton = k.liste[0].qton - 24.01; })?.grund, 'noten_ton_grenze');
  assert.equal(mit((k) => { k.liste[0].ton = 127.5; })?.grund, 'noten_ton_grenze', 'outside 0..127');
  assert.equal(mit((k) => { k.liste[0].ton = -0.5; })?.grund, 'noten_ton_grenze');
  for (const [feld, wert] of [['vib', 1], ['drift', 1], ['formant', 0], ['gain_db', 0], ['vib', 4.1], ['drift', -0.1], ['formant', 12.1], ['gain_db', 12.5],
    ['gain_db', -48.5], ['extra', 1], ['p', 1.1], ['qton', 128], ['qa', -0.1], ['id', 't0'], ['id', 't1234567'], ['id', 5], ['qa', '1'], ['qa', null]]) {
    assert.equal(mit((k) => { k.liste[0][feld] = wert; })?.grund, 'argument_ungueltig', `${feld}=${wert}`);
  }
  for (const [feld, wert] of [['vib', 0], ['vib', 4], ['drift', 0.5], ['formant', -12], ['formant', 12], ['gain_db', -48], ['gain_db', 12]]) {
    assert.equal(mit((k) => { k.liste[0][feld] = wert; }), null, `${feld}=${wert}`);
  }
  for (const kurve of ['pyin-1', 'pyin-1.noten_hmm', 'PYIN-1.noten_hmm-1', 'pyin-1.noten_hmm-1 ', 5, undefined]) {
    assert.equal(V.audioNotenPruefung({ kurve, liste: [] })?.grund, 'argument_ungueltig', String(kurve));
  }
  for (const x of [null, undefined, 5, 'x', [], { kurve: basis.kurve }, { liste: [] }, { kurve: basis.kurve, liste: [], extra: 1 }, { kurve: basis.kurve, liste: {} }]) {
    assert.equal(V.audioNotenPruefung(x)?.grund, 'argument_ungueltig', JSON.stringify(x));
  }
  const viele = (n) => ({ kurve: basis.kurve, liste: Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, qa: i, qe: i + 0.5, qton: 60, p: 1 })) });
  assert.equal(V.audioNotenPruefung(viele(V.MAX_AUDIO_NOTEN)), null);
  assert.equal(V.audioNotenPruefung(viele(V.MAX_AUDIO_NOTEN + 1))?.grund, 'argument_ungueltig');
});

test('kurvePruefung, rohPruefung, auftragPruefung and zeilePruefung agree with the example files', () => {
  for (const name of GUT.filter((n) => !n.startsWith('audio_noten_'))) assert.equal(pruefer(name)(lies(name)), null, name);
  for (const [name, [grund, muster]] of Object.entries(SCHLECHT).filter(([n]) => !n.startsWith('audio_noten_'))) {
    const r = pruefer(name)(lies(name));
    assert.ok(r, name);
    assert.equal(r.grund, grund, name);
    assert.match(r.text, muster, name);
  }
  // sidecar
  const k = lies('kurve_gut');
  const mitK = (f) => { const x = kopie(k); f(x); return V.kurvePruefung(x); };
  assert.equal(mitK((x) => { x.detektor = 'netz'; x.kurve = 'netz-1.noten_hmm-1'; }), null);
  assert.equal(mitK((x) => { x.detektor = 'netz'; })?.grund, 'format');
  assert.equal(mitK((x) => { x.sr = 44100; })?.grund, 'format');
  assert.equal(mitK((x) => { x.hop = 128; })?.grund, 'format');
  assert.equal(mitK((x) => { x.quelle = 'A'.repeat(64); })?.grund, 'format');
  assert.equal(mitK((x) => { x.stimmhaft_anteil = 1.5; })?.grund, 'format');
  assert.equal(mitK((x) => { x.f0_ct[3] = 11000.5; })?.grund, 'format');
  assert.equal(mitK((x) => { x.f0_ct[3] = 1499; })?.grund, 'format');
  assert.equal(mitK((x) => { x.f0_ct[3] = 6900.123; })?.grund, 'format', 'two decimals');
  assert.equal(mitK((x) => { x.konf[3] = 0.9501; })?.grund, 'format', 'three decimals');
  assert.equal(mitK((x) => { x.konf[3] = 1.1; })?.grund, 'format');
  assert.equal(mitK((x) => { x.konf.pop(); })?.grund, 'format');
  assert.equal(mitK((x) => { delete x.noten; })?.grund, 'format');
  assert.equal(mitK((x) => { x.noten[1].qa = 0; })?.grund, 'noten_ungueltig', 'order of the detected notes');
  assert.equal(mitK((x) => { x.noten[0].id = 't1'; })?.grund, 'format', 'detected notes carry no id');
  assert.equal(mitK((x) => { x.mono = { geprueft_frames: 6, anteil: 0.1, mehrstimmig: false, hrr_db_schwelle: 10, periode_schwelle: 0.3 }; }), null);
  const mono = (c) => (x) => { x.mono = { geprueft_frames: 6, anteil: 0, mehrstimmig: false, hrr_db_schwelle: 10, periode_schwelle: 0.3, ...c }; };
  assert.equal(mitK(mono({ anteil: V.MONO_ANTEIL_MAX })), null, 'exactly 0.30 is not more than 0.30');
  assert.equal(mitK(mono({ anteil: 0.31, mehrstimmig: true })), null);
  assert.equal(mitK(mono({ anteil: 0.31 }))?.grund, 'format');
  assert.equal(mitK(mono({ anteil: 0.1, mehrstimmig: true }))?.grund, 'format');
  assert.equal(mitK(mono({ geprueft_frames: 0 })), null);
  assert.equal(mitK(mono({ geprueft_frames: 0, anteil: 0.1 }))?.grund, 'format');
  assert.equal(mitK(mono({ geprueft_frames: 0, anteil: 0.5, mehrstimmig: true }))?.grund, 'format');
  assert.equal(mitK((x) => { x.noten[1].qe = (x.frames + V.NOTEN_HOP) / V.NOTEN_SR; }), null, 'one hop of slack after the last sample');
  assert.equal(mitK((x) => { x.noten[1].qe = (x.frames + V.NOTEN_HOP) / V.NOTEN_SR + 1e-3; })?.grund, 'noten_ungueltig');
  assert.equal(mitK((x) => { x.mono = { geprueft_frames: 6, anteil: 0.1, mehrstimmig: false, hrr_db_schwelle: 10 }; })?.grund, 'format');
  assert.equal(mitK((x) => { x.frames = 0; x.f0_ct = [0]; x.konf = [0]; x.noten = []; x.stimmhaft_anteil = 0; }), null, 'frameZahl(0) is 1');
  // external curve
  const r = lies('roh_gut');
  const mitR = (f) => { const x = kopie(r); f(x); return V.rohPruefung(x); };
  assert.equal(mitR((x) => { x.detektor = 'pyin'; })?.grund, 'format');
  assert.equal(mitR((x) => { x.detektor_version = 'pyin-1'; })?.grund, 'format');
  assert.equal(mitR((x) => { x.noten = []; })?.grund, 'format', 'no extra fields');
  assert.equal(mitR((x) => { x.konf.pop(); })?.grund, 'format');
  // render order
  const a = lies('auftrag_gut');
  const mitA = (f) => { const x = kopie(a); f(x); return V.auftragPruefung(x); };
  assert.equal(mitA((x) => { x.format = 'cdj-noten-auftrag/2'; })?.grund, 'format');
  assert.equal(mitA((x) => { x.liste[0].ton = x.liste[0].qton + 30; })?.grund, 'noten_ungueltig');
  assert.equal(mitA((x) => { x.liste[1].qa = 0.1; x.liste[1].qe = 0.2; })?.grund, 'noten_ungueltig');
  assert.equal(mitA((x) => { x.liste[0].extra = 1; })?.grund, 'format');
  assert.equal(mitA((x) => { x.liste = []; }), null, 'an empty order is well formed');
  // lines
  const paare = lies('zeilen');
  assert.ok(paare.length >= 15);
  for (const { zeile, gut } of paare) assert.equal(V.zeilePruefung(zeile) === null, gut, zeile);
  for (const { zeile, gut } of paare.filter((p) => p.gut)) assert.equal(V.zeilePruefung(JSON.parse(zeile)), null, zeile);
  assert.equal(V.zeilePruefung('{"status":"ok"}{"status":"ok"}')?.grund, 'format');
  const eine = JSON.stringify({ status: 'ok', mehrstimmig: false, anteil: 0.1, sekunden: 0.2 });
  assert.equal(V.zeilePruefung(eine), null);
  assert.equal(V.zeilePruefung(eine + '\n'), null, 'one trailing LF is the line end');
  assert.equal(V.zeilePruefung(eine + '\n\n')?.grund, 'format');
  assert.equal(V.zeilePruefung(eine + '\r\n')?.grund, 'format');
  assert.equal(V.zeilePruefung('\n' + eine)?.grund, 'format');
  assert.equal(V.zeilePruefung(null)?.grund, 'format');
  assert.equal(V.zeilePruefung({ status: 'fehler', fehler: 'kaputt', text: 'x' })?.grund, 'format');
  const codes = paare.filter((p) => p.gut).map((p) => JSON.parse(p.zeile)).filter((o) => o.status === 'fehler').map((o) => o.fehler);
  assert.deepEqual(codes, [...V.NOTEN_FEHLER]);
  // progress payload
  const f = { stufe: 2, von: 5, name: 'tonhoehe', prozent: 40.5 };
  assert.equal(V.fortschrittPruefung(f), null);
  assert.equal(V.fortschrittPruefung({ ...f, teil: 'stem 2' }), null, 'teil is read by liesFortschrittsZeichen');
  assert.equal(V.fortschrittPruefung({ ...f, teil: 3 })?.grund, 'format');
  for (const bad of [{ ...f, name: 'warten' }, { ...f, stufe: 0 }, { ...f, stufe: 6 }, { ...f, prozent: 101 }, { ...f, extra: 1 }, null]) {
    assert.equal(V.fortschrittPruefung(bad)?.grund, 'format', JSON.stringify(bad));
  }
});

test('the module, the schemas and the constants say the same', () => {
  const zeile = schema('noten_zeile');
  assert.deepEqual(zeile.$defs.fehler_code.enum, [...V.NOTEN_FEHLER]);
  assert.deepEqual(zeile.$defs.fortschritt.properties.name.enum, [...V.FORTSCHRITT_NAMEN]);
  assert.equal(schema('noten_kurve').properties.format.const, V.KURVE_FORMAT);
  assert.equal(schema('noten_kurve_roh').properties.format.const, V.ROH_FORMAT);
  assert.equal(schema('noten_auftrag').properties.format.const, V.AUFTRAG_FORMAT);
  assert.equal(schema('noten_kurve').properties.sr.const, V.NOTEN_SR);
  assert.equal(schema('noten_kurve').properties.hop.const, V.NOTEN_HOP);
  assert.equal(schema('audio_noten').$defs.liste.maxItems, V.MAX_AUDIO_NOTEN);
  const props = Object.keys(schema('audio_noten').$defs.note.properties);
  assert.deepEqual(props, ['id', 'qa', 'qe', 'qton', 'p', ...V.ZIEL_FELDER]);
  assert.deepEqual([...V.ZIEL_FELDER], ['a', 'e', 'ton', 'vib', 'drift', 'formant', 'gain_db']);
  assert.equal(V.NOTEN_SR, 48000); assert.equal(V.NOTEN_HOP, 256); assert.equal(V.TON_SPANNE, 24); assert.equal(V.MAX_AUDIO_NOTEN, 4096);
  assert.equal(V.MONO_ANTEIL_MAX, 0.30);
  assert.equal(V.KURVE_FORMAT, 'cdj-noten-kurve/1'); assert.equal(V.ROH_FORMAT, 'cdj-noten-kurve-roh/1');
  assert.equal(V.AUFTRAG_FORMAT, 'cdj-noten-auftrag/1'); assert.equal(V.SCHLUESSEL_FORMAT, 'cdj-noten-render/1');
  assert.equal(V.DETEKTOR_VERSION, 'pyin-1'); assert.equal(V.NETZ_VERSION, 'netz-1'); assert.equal(V.SEGMENTIERER_VERSION, 'noten_hmm-1');
  assert.equal(V.MASCHINE_VERSION, 'teilton-2');
  // the version pattern of the curve id accepts the current ids
  const muster = new RegExp(schema('audio_noten').$defs.kurve_id.pattern);
  assert.match(`${V.DETEKTOR_VERSION}.${V.SEGMENTIERER_VERSION}`, muster);
  assert.match(`${V.NETZ_VERSION}.${V.SEGMENTIERER_VERSION}`, muster);
  const md = fs.readFileSync(fileURLToPath(new URL('../../contract/notes.md', import.meta.url)), 'utf8');
  for (const c of V.NOTEN_FEHLER) assert.ok(md.includes('`' + c + '`'), c);
});

test('kanonischeListe gives the hand-written pre-image and renderSchluessel its sha256 for the three cases', () => {
  const faelle = lies('schluessel');
  assert.equal(faelle.length, 3);
  for (const f of faelle) {
    const zeilen = f.text.split('\n');
    assert.equal(zeilen.length, 5);
    assert.equal(V.kanonischeListe(f.liste), zeilen[4]);
    assert.equal(V.renderSchluessel(f.quelle, f.kurve, f.maschine, f.liste), f.sha256);
    assert.match(V.renderSchluessel(f.quelle, f.kurve, f.maschine, f.liste), /^[0-9a-f]{64}$/);
    // the expectation is the digest of the hand-written text, not of the code under test
    assert.equal(crypto.createHash('sha256').update(f.text, 'utf8').digest('hex'), f.sha256);
  }
  assert.equal(V.kanonischeListe([]), '[]');
});

test('the key ignores id and p and changes with any target, the curve id and the engine version', () => {
  const sha = 'ab'.repeat(32);
  const kurve = 'pyin-1.noten_hmm-1';
  const liste = lies('audio_noten_gut').liste;
  const basis = V.renderSchluessel(sha, kurve, V.MASCHINE_VERSION, liste);
  const schluessel = (l, k = kurve, m = V.MASCHINE_VERSION, s = sha) => V.renderSchluessel(s, k, m, l);
  const mit = (f) => { const l = kopie(liste); f(l); return l; };
  assert.equal(schluessel(mit((l) => { l.forEach((n, i) => { n.id = `t${i + 40}`; n.p = 0.1; }); })), basis, 'id and p do not change the sound');
  assert.equal(schluessel(mit((l) => { l[0].qa += 1e-7; })), basis, 'below the rounding of seconds');
  assert.notEqual(schluessel(mit((l) => { l[0].qa += 2e-6; })), basis);
  assert.notEqual(schluessel(mit((l) => { l[0].qton += 0.001; })), basis);
  assert.notEqual(schluessel(mit((l) => { l[2].ton = 61; })), basis, 'a new target');
  assert.notEqual(schluessel(mit((l) => { l[1].ton += 0.01; })), basis);
  for (const [feld, wert] of [['a', 0.4], ['e', 1.2], ['vib', 2], ['drift', 0.5], ['formant', 3], ['gain_db', -6]]) {
    assert.notEqual(schluessel(mit((l) => { l[2][feld] = wert; })), basis, feld);
  }
  const mitZiel = mit((l) => { l[2].vib = 2; });
  assert.notEqual(schluessel(mit((l) => { l[2].vib = 2.0001; })), schluessel(mitZiel));
  assert.equal(schluessel(mit((l) => { l[2].vib = 2.00001; })), schluessel(mitZiel), 'targets round to 1e-4');
  assert.notEqual(schluessel(liste, 'netz-1.noten_hmm-1'), basis, 'the curve id');
  assert.notEqual(schluessel(liste, 'pyin-1.noten_hmm-2'), basis);
  assert.notEqual(schluessel(liste, kurve, 'teilton-3'), basis, 'the engine version');
  assert.notEqual(schluessel(liste, kurve, V.MASCHINE_VERSION, 'cd'.repeat(32)), basis, 'the source');
  assert.notEqual(schluessel([liste[1], liste[0], liste[2]]), basis, 'the order of the list');
  assert.equal(schluessel(liste), basis, 'deterministic');
});

test('frameZahl(0) === 1, frameZahl(255) === 1, frameZahl(256) === 2; kurveDatei names <sha>.<kurve>.json', () => {
  assert.equal(V.frameZahl(0), 1);
  assert.equal(V.frameZahl(255), 1);
  assert.equal(V.frameZahl(256), 2);
  assert.equal(V.frameZahl(2560), 11);
  assert.equal(V.frameZahl(48000 * 240), 45001);
  const sha = '0123456789abcdef'.repeat(4);
  assert.equal(V.kurveDatei(sha, 'pyin-1.noten_hmm-1'), `${sha}.pyin-1.noten_hmm-1.json`);
  assert.equal(V.hatZiele([]), false);
  assert.equal(V.hatZiele(lies('audio_noten_gut').liste), true);
  const ohne = lies('audio_noten_gut').liste.map(({ ton, ...rest }) => rest);
  assert.equal(V.hatZiele(ohne), false);
  for (const f of V.ZIEL_FELDER) assert.equal(V.hatZiele([{ ...ohne[0], [f]: 1 }]), true, f);
  assert.equal(V.rundeS(0.1234567), 0.123457);
  assert.equal(V.rundeS(1.0000004), 1);
  assert.equal(V.rundeTon(60.123449), 60.1234);
  assert.equal(V.rundeTon(60.12346), 60.1235);
  assert.equal(Object.is(V.rundeTon(-1e-9), 0) || V.rundeTon(-1e-9) === 0, true);
});

test('tonImSpann, the reason table of the clip field and of the files, and the precedence of shape and rules', () => {
  assert.equal(V.tonImSpann(84.1235, 60.12346), true, 'the boundary example: a target rounded to 1e-4');
  assert.equal(V.tonImSpann(60.12 + 24, 60.12), true, 'float rounding');
  assert.equal(V.tonImSpann(84.2, 60.12346), false);
  assert.equal(V.tonImSpann(127.5, 110), false);
  assert.equal(V.tonImSpann(-0.5, 10), false);
  assert.equal(V.tonImSpann(0, 12), true);
  assert.equal(V.tonImSpann(127, 103), true);
  assert.equal(V.rundeTon(60.12346 + 24), 84.1235);
  const basis = lies('audio_noten_gut');
  const mitL = (f) => { const k = kopie(basis); f(k.liste); return k; };
  const clip = (f) => V.audioNotenPruefung(mitL(f));
  const datei = (f) => V.auftragPruefung({ format: V.AUFTRAG_FORMAT, kurve: basis.kurve, liste: mitL(f).liste });
  // ton outside 0..127: clip noten_ton_grenze, file format; ton beyond the span inside 0..127: clip noten_ton_grenze, file noten_ungueltig
  assert.equal(clip((l) => { l[0].ton = 130; l[0].qton = 110; })?.grund, 'noten_ton_grenze');
  assert.equal(datei((l) => { l[0].ton = 130; l[0].qton = 110; })?.grund, 'format');
  assert.equal(clip((l) => { l[0].ton = l[0].qton + 30; })?.grund, 'noten_ton_grenze');
  assert.equal(datei((l) => { l[0].ton = l[0].qton + 30; })?.grund, 'noten_ungueltig');
  // shape errors of the whole list win over every rule, the span result included
  const formVorRegel = (f) => { const g = (l) => f(l); return [clip(g), datei(g)]; };
  for (const f of [(l) => { l[0].ton = l[0].qton + 30; l[2].id = 'x9'; }, (l) => { l[1].id = l[0].id; l[2].vib = 9; },
    (l) => { l[0].qe = l[0].qa + 0.01; l[2].p = 2; }, (l) => { l[1].qa = 0.1; l[1].qe = 0.2; l[2].formant = 20; }]) {
    const [c, d] = formVorRegel(f);
    assert.equal(c.grund, 'argument_ungueltig'); assert.equal(d.grund, 'format');
  }
  // the ton range is a shape error too: a later range error beats an earlier rule
  assert.equal(clip((l) => { l[0].qe = l[0].qa + 0.01; l[2].ton = 200; })?.grund, 'noten_ton_grenze');
  assert.equal(datei((l) => { l[0].qe = l[0].qa + 0.01; l[2].ton = 200; })?.grund, 'format');
  // rule order over the whole list: duplicate ids, duration, targets (ton equal, span, a, e, end), order, overlap
  const text = (f) => clip(f).text;
  assert.match(text((l) => { l[1].id = l[0].id; l[2].qe = l[2].qa + 0.01; }), /duplicate/);
  assert.match(text((l) => { l[2].qe = l[2].qa + 0.01; l[0].ton = l[0].qton; }), /duration/);
  assert.match(text((l) => { l[1].qa = 0.1; l[1].qe = 0.4; l[2].ton = l[2].qton; }), /ton.*equal/, 'targets before order');
  assert.match(text((l) => { l[2].ton = l[2].qton + 30; l[1].ton = l[1].qton; }), /ton.*equal/, 'equal before span, per note in order');
  assert.match(text((l) => { l[2].ton = l[2].qton + 30; l[1].a = l[1].qa; }), /a.*equal/, 'note 1 comes before note 2');
  assert.match(text((l) => { l[1].qa = 0.1; l[1].qe = 0.4; }), /order/, 'order before overlap');
  assert.match(text((l) => { l[1].qa = 0.9; l[1].qe = 1.6; }), /overlap/);
  // duration: > 0.01, exactly 0.01 is refused
  assert.match(text((l) => { l[0].qa = 0; l[0].qe = 0.01; }), /duration/);
  assert.equal(clip((l) => { l[0].qa = 0; l[0].qe = 0.0100001; }), null);
  // curve against source and order against sidecar: kurve_passt_nicht
  const k = lies('kurve_gut');
  assert.equal(V.kurvePasstZurQuelle(k, k.frames), null);
  assert.equal(V.kurvePasstZurQuelle(k, k.frames + 1)?.grund, 'kurve_passt_nicht');
  assert.equal(V.kurvePasstZurQuelle(k, 0)?.grund, 'kurve_passt_nicht');
  const a = lies('auftrag_gut');
  assert.equal(V.auftragPasstZurKurve(a, k), null);
  assert.equal(V.auftragPasstZurKurve({ ...a, kurve: 'netz-1.noten_hmm-1' }, k)?.grund, 'kurve_passt_nicht');
});
