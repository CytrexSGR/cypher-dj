// I08 Task 8: Profile, Konfiguration, Zuordnung. F3 (Andreas 22.10.): kein externer Eingang für Cypher ohne seine Einzelfreigabe; nur andreas setzt sie.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROFILE, profil } from '../bereiche/geraete/profile.ts';
import { GeraeteFehler, GeraeteSpeicher, standard } from '../bereiche/geraete/speicher.ts';
import { GRUND_TEXT } from '../http/gruende.ts';
import { gruendeGeraete } from './hilfen/gruende.mjs';
import { setzeEingang, setzeMidi, setzeLatenz } from '../bereiche/geraete/aendern.ts';

const PC = 'alsa_input.pci-0000_16_00.6.analog-stereo';
const ERK = {
  audio: [{ knoten: PC, beschreibung: 'Family 17h/19h', zustand: 'suspended', kanaele: 2, ports: [`${PC}:capture_FL`, `${PC}:capture_FR`], usb: null },
    { knoten: 'alsa_input.usb-X', beschreibung: 'XZ', zustand: 'running', kanaele: 12, ports: Array.from({ length: 12 }, (_, i) => `alsa_input.usb-X:capture_AUX${i}`), usb: { vendor: '0x2b73', produkt: '0x002d' } },
    { knoten: 'alsa_input.usb-Seiren', beschreibung: 'Seiren', zustand: 'idle', kanaele: 1, ports: ['alsa_input.usb-Seiren:capture_MONO'], usb: { vendor: '0x1532', produkt: '0x056a' } }],
  midi: [{ port: 'Midi-Bridge:Midi Through: Port-0 (capture)', alias: 'Midi Through:Midi Through Port-0' },
    { port: 'Midi-Bridge:XDJ-XZ (1): XDJ-XZ MIDI 1', alias: 'XDJ-XZ (1):XDJ-XZ MIDI 1' }],
};
const grund = (f) => { try { f(); } catch (e) { return e instanceof GeraeteFehler ? `${e.grund}/${e.code}` : String(e); } return null; };

test('Profile: genau zwei, PC-Eingang und XDJ-XZ; Zuordnung nach Knoten, USB-Hersteller und MIDI-Name', () => {
  assert.deepEqual(PROFILE.map((p) => p.id), ['pc-eingang', 'xdj-xz']);
  assert.ok(profil('pc-eingang').audio.passt(ERK.audio[0]) && !profil('pc-eingang').audio.passt(ERK.audio[1]));
  assert.ok(profil('xdj-xz').audio.passt(ERK.audio[1]) && !profil('xdj-xz').audio.passt(ERK.audio[2]), 'das Seiren (0x1532) ist kein XDJ-XZ');
  assert.ok(profil('xdj-xz').midi.passt(ERK.midi[1]) && !profil('xdj-xz').midi.passt(ERK.midi[0]));
  assert.equal(profil('nix'), undefined);
});

test('Standard: vier Eingänge, nichts zugeordnet, nichts für Cypher freigegeben', () => {
  const k = standard();
  assert.deepEqual(k.eingaenge.map((e) => [e.k, e.profil, e.audio, e.frei_fuer_cypher, e.latenz]), [1, 2, 3, 4].map((n) => [n, null, null, false, null]));
  assert.deepEqual(k.midi, { profil: null, port: null, frei_fuer_cypher: false });
});

test('Zuordnung: Andreas ordnet den PC-Eingang zu; die Ports werden gemerkt (für das Anstecken später); Mono geht auf einen Port', () => {
  const k = setzeEingang(standard(), 'andreas', { k: 1, profil: 'pc-eingang' }, ERK);
  assert.deepEqual(k.eingaenge[0].audio, { knoten: PC, ports: [`${PC}:capture_FL`, `${PC}:capture_FR`] });
  assert.equal(k.eingaenge[0].profil, 'pc-eingang');
  assert.equal(k.eingaenge[0].frei_fuer_cypher, false, 'zuordnen gibt nie frei');
  const alt = standard(), vor = structuredClone(alt);
  setzeEingang(alt, 'andreas', { k: 1, profil: 'pc-eingang', name: 'Neu' }, ERK);
  assert.deepEqual(alt, vor, 'die Eingabe bleibt unverändert (Reinheit; ein frisches standard() prüfte nichts)');
  const altM = standard(), vorM = structuredClone(altM);
  setzeMidi(altM, 'andreas', { profil: 'xdj-xz' }, ERK);
  assert.deepEqual(altM, vorM, 'auch setzeMidi ändert seine Eingabe nicht');
  const x = setzeEingang(standard(), 'andreas', { k: 2, profil: 'xdj-xz' }, ERK);
  assert.equal(x.eingaenge[1].audio.ports.length, 2, 'das XZ hat 12 Ports; ein Paar geht an den Eingang');
});

test('F3: nur Andreas ordnet zu und gibt frei; Cypher bekommt 403 und nichts ändert sich', () => {
  assert.equal(grund(() => setzeEingang(standard(), 'cypher', { k: 1, profil: 'pc-eingang' }, ERK)), 'nur_andreas/403');
  assert.equal(grund(() => setzeEingang(standard(), 'cypher', { k: 1, frei_fuer_cypher: true }, ERK)), 'freigabe_nur_andreas/403');
  assert.equal(grund(() => setzeMidi(standard(), 'cypher', { profil: 'xdj-xz' }, ERK)), 'nur_andreas/403');
  assert.equal(grund(() => setzeEingang(standard(), 'cypher', { k: 1, name: 'Fremd' }, ERK)), 'nur_andreas/403', 'auch den Namen setzt nur Andreas');
  // F3 für MIDI: Cypher gibt das XZ-MIDI nie frei, auch nicht wenn schon ein Port zugeordnet ist; die Konfiguration bleibt, wie sie war
  const mk = setzeMidi(standard(), 'andreas', { profil: 'xdj-xz' }, ERK);
  assert.equal(grund(() => setzeMidi(mk, 'cypher', { frei_fuer_cypher: true }, ERK)), 'freigabe_nur_andreas/403');
  assert.equal(mk.midi.frei_fuer_cypher, false);
  assert.equal(setzeMidi(mk, 'andreas', { frei_fuer_cypher: true }, ERK).midi.frei_fuer_cypher, true, 'Gegenprobe: Andreas gibt frei');
  const k = setzeEingang(standard(), 'andreas', { k: 1, profil: 'pc-eingang' }, ERK);
  const frei = setzeEingang(k, 'andreas', { k: 1, frei_fuer_cypher: true }, ERK);
  assert.equal(frei.eingaenge[0].frei_fuer_cypher, true);
  assert.equal(grund(() => setzeEingang(standard(), 'andreas', { k: 1, frei_fuer_cypher: true }, ERK)), 'eingang_leer/409', 'ohne Gerät gibt es nichts freizugeben');
});

test('Die Freigabe gilt für Eingang UND Gerät: Gerät wechseln oder lösen nimmt sie zurück', () => {
  let k = setzeEingang(standard(), 'andreas', { k: 1, profil: 'pc-eingang' }, ERK);
  k = setzeEingang(k, 'andreas', { k: 1, frei_fuer_cypher: true }, ERK);
  const gewechselt = setzeEingang(k, 'andreas', { k: 1, profil: 'xdj-xz' }, ERK);
  assert.equal(gewechselt.eingaenge[0].frei_fuer_cypher, false);
  const geloest = setzeEingang(k, 'andreas', { k: 1, profil: null }, ERK);
  assert.deepEqual([geloest.eingaenge[0].audio, geloest.eingaenge[0].profil, geloest.eingaenge[0].frei_fuer_cypher], [null, null, false]);
});

test('Die Freigabe gilt für das Gerät an denselben Ports: andere Ports (auch nur der Knoten) nehmen sie zurück; dieselben Ports lassen sie stehen', () => {
  const SEI = ['alsa_input.usb-Seiren:capture_MONO'], X = ERK.audio[1].ports.slice(0, 2);
  let k = setzeEingang(standard(), 'andreas', { k: 1, profil: 'xdj-xz' }, ERK);
  k = setzeEingang(k, 'andreas', { k: 1, frei_fuer_cypher: true }, ERK);
  assert.equal(k.eingaenge[0].frei_fuer_cypher, true);
  assert.equal(setzeEingang(k, 'andreas', { k: 1, profil: 'xdj-xz' }, ERK).eingaenge[0].frei_fuer_cypher, true, 'erneut zuordnen, dasselbe Gerät: bleibt frei');
  assert.equal(setzeEingang(k, 'andreas', { k: 1, profil: 'xdj-xz', ports: X }, ERK).eingaenge[0].frei_fuer_cypher, true, 'ausdrücklich dieselben Ports: bleibt frei');
  // P1: XZ abgesteckt, ausdrückliche Ports eines anderen Geräts
  const p1 = setzeEingang(k, 'andreas', { k: 1, profil: 'xdj-xz', ports: SEI }, { audio: [], midi: [] });
  assert.deepEqual([p1.eingaenge[0].frei_fuer_cypher, p1.eingaenge[0].audio], [false, { knoten: 'alsa_input.usb-Seiren', ports: SEI }]);
  // P1b: XZ angesteckt und ausdrückliche Ports eines anderen Geräts: Knoten und Ports sind von demselben Gerät
  const p1b = setzeEingang(k, 'andreas', { k: 1, profil: 'xdj-xz', ports: SEI }, ERK);
  assert.deepEqual([p1b.eingaenge[0].frei_fuer_cypher, p1b.eingaenge[0].audio], [false, { knoten: 'alsa_input.usb-Seiren', ports: SEI }]);
  // nur ein anderes Portpaar am selben Knoten
  assert.equal(setzeEingang(k, 'andreas', { k: 1, profil: 'xdj-xz', ports: [X[1], X[0]] }, ERK).eingaenge[0].frei_fuer_cypher, false);
});

test('MIDI: ein Portwechsel nach der Freigabe nimmt sie zurück, derselbe Port nicht; ohne Gerät kein Freigeben', () => {
  let k = setzeMidi(standard(), 'andreas', { profil: 'xdj-xz' }, ERK);
  k = setzeMidi(k, 'andreas', { frei_fuer_cypher: true }, ERK);
  assert.equal(k.midi.frei_fuer_cypher, true);
  assert.equal(setzeMidi(k, 'andreas', { profil: 'xdj-xz' }, ERK).midi.frei_fuer_cypher, true, 'derselbe Port: bleibt frei');
  const wechsel = setzeMidi(k, 'andreas', { profil: 'xdj-xz', port: 'Midi-Bridge:XDJ-XZ (2): XDJ-XZ MIDI 1' }, ERK);
  assert.deepEqual([wechsel.midi.port, wechsel.midi.frei_fuer_cypher], ['Midi-Bridge:XDJ-XZ (2): XDJ-XZ MIDI 1', false], 'Portwechsel: Freigabe fällt zurück');
  assert.equal(grund(() => setzeMidi(standard(), 'andreas', { frei_fuer_cypher: true }, ERK)), 'eingang_leer/409');
  assert.deepEqual(setzeMidi(k, 'andreas', { profil: null }, ERK).midi, { profil: null, port: null, frei_fuer_cypher: false });
});

test('Eingaben werden einheitlich geprüft: ungültiger MIDI-Port und Ports ohne Profil sind 400, ein Knoten ohne Ports ist kein Gerät, Latenz min über max ist 400', () => {
  assert.equal(grund(() => setzeMidi(standard(), 'andreas', { profil: 'xdj-xz', port: 'a\tb' }, ERK)), 'argument_ungueltig/400', 'P5: kein stilles Verwerfen');
  assert.equal(grund(() => setzeMidi(standard(), 'andreas', { profil: 'xdj-xz', port: 7 }, ERK)), 'argument_ungueltig/400');
  assert.equal(grund(() => setzeMidi(standard(), 'andreas', { port: 'x' }, ERK)), 'argument_ungueltig/400', 'port ohne profil');
  assert.equal(grund(() => setzeEingang(standard(), 'andreas', { k: 1, ports: ['a:1'] }, ERK)), 'argument_ungueltig/400', 'P6: ports ohne profil');
  assert.equal(grund(() => setzeEingang(standard(), 'andreas', { k: 1, profil: null, ports: ['a:1'] }, ERK)), 'argument_ungueltig/400');
  const leer = { audio: [{ ...ERK.audio[1], ports: [] }], midi: [] };
  assert.equal(grund(() => setzeEingang(standard(), 'andreas', { k: 1, profil: 'xdj-xz' }, leer)), 'geraet_nicht_da/409', 'P2: Knoten ohne Ports gibt kein ports:[]');
  const ok = setzeEingang(standard(), 'andreas', { k: 1, profil: 'xdj-xz' }, ERK);
  const lat = { k: 1, art: 'software', samples: 100, streuung: 2, min: 90, max: 110, laeufe: 20, quantum: 256, rate: 48000 };
  assert.equal(setzeLatenz(ok, 'andreas', lat).eingaenge[0].latenz.min, 90);
  assert.equal(grund(() => setzeLatenz(ok, 'andreas', { ...lat, min: 500, max: 5 })), 'argument_ungueltig/400', 'P7');
});

test('Gründe der Geräte-Konfiguration: jeder Grund aus bereiche/geraete hat einen englischen Text in http/gruende.ts', () => {
  const g = gruendeGeraete();
  for (const x of ['nur_andreas', 'freigabe_nur_andreas', 'latenz_nur_andreas', 'profil_unbekannt', 'profil_ohne_audio', 'profil_ohne_midi', 'geraet_nicht_da', 'eingang_leer', 'konfig_defekt', 'argument_ungueltig']) {
    assert.ok(g.has(x), `Positiv-Kontrolle: ${x} aus dem Code gezogen (gefunden: ${[...g.keys()].join(', ')})`);
  }
  assert.equal(g.has('gibt_es_nicht'), false);
  const ohne = [...g.keys()].filter((x) => typeof GRUND_TEXT[x] !== 'string' || GRUND_TEXT[x].length < 4 || /[^\x20-\x7e]/.test(GRUND_TEXT[x])).map((x) => `${x}: ${JSON.stringify(GRUND_TEXT[x])} (${[...g.get(x)].join(' | ')})`);
  assert.deepEqual(ohne, [], 'Gründe ohne englischen Text');
});

test('Fehler: unbekanntes Profil, Eingang außerhalb 1..4, Gerät nicht da (ohne Ports), Profil ohne Audio, Name zu lang', () => {
  assert.equal(grund(() => setzeEingang(standard(), 'andreas', { k: 1, profil: 'nix' }, ERK)), 'profil_unbekannt/400');
  for (const kk of [0, 5, 1.5, '1']) assert.equal(grund(() => setzeEingang(standard(), 'andreas', { k: kk, profil: null }, ERK)), 'argument_ungueltig/400');
  assert.equal(grund(() => setzeEingang(standard(), 'andreas', { k: 1, profil: 'xdj-xz' }, { audio: [], midi: [] })), 'geraet_nicht_da/409');
  const vorab = setzeEingang(standard(), 'andreas', { k: 1, profil: 'xdj-xz', ports: ['a:1', 'a:2'] }, { audio: [], midi: [] });
  assert.deepEqual(vorab.eingaenge[0].audio.ports, ['a:1', 'a:2'], 'mit ausdrücklichen Ports geht die Zuordnung auch ohne Gerät');
  assert.equal(grund(() => setzeEingang(standard(), 'andreas', { k: 1, profil: 'xdj-xz', ports: ['a:1\tx'] }, ERK)), 'argument_ungueltig/400', 'kein Tab, kein Zeilenumbruch in Portnamen');
  assert.equal(grund(() => setzeEingang(standard(), 'andreas', { k: 1, name: 'x'.repeat(41) }, ERK)), 'argument_ungueltig/400');
});

test('MIDI: das XDJ-XZ wird nach MIDI-Name zugeordnet, Midi Through ist kein XZ', () => {
  const k = setzeMidi(standard(), 'andreas', { profil: 'xdj-xz' }, ERK);
  assert.deepEqual([k.midi.profil, k.midi.port], ['xdj-xz', 'Midi-Bridge:XDJ-XZ (1): XDJ-XZ MIDI 1']);
  assert.equal(grund(() => setzeMidi(standard(), 'andreas', { profil: 'pc-eingang' }, ERK)), 'profil_ohne_midi/400');
  assert.equal(grund(() => setzeMidi(standard(), 'andreas', { profil: 'xdj-xz' }, { audio: [], midi: [ERK.midi[0]] })), 'geraet_nicht_da/409');
});

test('Speicher: lesen ohne Datei = Standard; Schreiben atomar; defekte Datei wird gemeldet und nicht überschrieben', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-gr-'));
  const s = new GeraeteSpeicher(path.join(d, 'sub', 'geraete.json'));
  assert.deepEqual(s.lies(), standard());
  const k = setzeEingang(standard(), 'andreas', { k: 3, profil: 'pc-eingang', name: 'Line' }, ERK);
  s.schreibe(k);
  assert.deepEqual(new GeraeteSpeicher(s.pfad).lies(), k);
  assert.deepEqual(fs.readdirSync(path.dirname(s.pfad)), ['geraete.json'], 'keine .teil-Reste');
  fs.writeFileSync(s.pfad, '{kaputt');
  assert.equal(grund(() => s.lies()), 'konfig_defekt/500');
  assert.equal(fs.readFileSync(s.pfad, 'utf8'), '{kaputt', 'die defekte Datei bleibt, wie sie ist');
  fs.writeFileSync(s.pfad, JSON.stringify({ ...standard(), eingaenge: standard().eingaenge.slice(0, 3) }));
  assert.equal(grund(() => s.lies()), 'konfig_defekt/500', 'drei statt vier Eingänge ist defekt');
  // P4: eine von Hand bearbeitete Datei mit Freigabe ohne Gerät oder unbekanntem Profil ist defekt
  const mit = (f) => { const x = standard(); f(x); fs.writeFileSync(s.pfad, JSON.stringify(x)); return grund(() => s.lies()); };
  assert.equal(mit((x) => { x.eingaenge[0].frei_fuer_cypher = true; }), 'konfig_defekt/500', 'Freigabe ohne Audio');
  assert.equal(mit((x) => { x.midi.frei_fuer_cypher = true; }), 'konfig_defekt/500', 'Freigabe ohne MIDI-Port');
  assert.equal(mit((x) => { x.eingaenge[1].profil = 'gibt-es-nicht'; }), 'konfig_defekt/500', 'unbekanntes Profil');
  assert.equal(mit((x) => { x.midi.profil = 'gibt-es-nicht'; }), 'konfig_defekt/500', 'unbekanntes MIDI-Profil');
  assert.equal(mit(() => {}), null, 'Gegenprobe: die Standardkonfiguration ist heil');
  assert.equal(mit((x) => { Object.assign(x.eingaenge[0], { profil: 'pc-eingang', audio: { knoten: PC, ports: [`${PC}:capture_FL`] }, frei_fuer_cypher: true }); }), null, 'Gegenprobe: Freigabe mit Gerät ist heil');
  fs.rmSync(d, { recursive: true, force: true });
});

test('Nachzug R2 (M1, P1): Cypher überschreibt nie einen Kabelwert, auch nicht mit art software; über software oder null darf er; Andreas darf alles', () => {
  const ok = setzeEingang(standard(), 'andreas', { k: 1, profil: 'xdj-xz' }, ERK);
  const lat = { k: 1, art: 'software', samples: 100, streuung: 2, min: 90, max: 110, laeufe: 20, quantum: 256, rate: 48000 };
  const kabel = setzeLatenz(ok, 'andreas', { ...lat, art: 'kabel', samples: 480 });
  assert.equal(grund(() => setzeLatenz(kabel, 'cypher', { ...lat, samples: 12 })), 'latenz_nur_andreas/403', 'P1: Software über Kabel');
  assert.equal(kabel.eingaenge[0].latenz.samples, 480, 'die Kabelmessung steht unverändert');
  assert.equal(grund(() => setzeLatenz(kabel, 'cypher', { ...lat, art: 'kabel' })), 'latenz_nur_andreas/403', 'Kabel von Cypher bleibt 403');
  // Gegenproben: was erlaubt bleibt
  assert.equal(setzeLatenz(ok, 'cypher', lat).eingaenge[0].latenz.samples, 100, 'Cypher über null');
  const sw = setzeLatenz(ok, 'cypher', lat);
  assert.equal(setzeLatenz(sw, 'cypher', { ...lat, samples: 101 }).eingaenge[0].latenz.samples, 101, 'Cypher über software');
  assert.deepEqual(setzeLatenz(kabel, 'andreas', { ...lat, samples: 12 }).eingaenge[0].latenz.art, 'software', 'Andreas darf den Kabelwert ersetzen');
});

test('Nachzug R2 (m3): Grenzen von streuung, min, max, laeufe, quantum, rate und samples werden an beiden Enden geprüft', () => {
  const ok = setzeEingang(standard(), 'andreas', { k: 1, profil: 'xdj-xz' }, ERK);
  const lat = { k: 1, art: 'software', samples: 100, streuung: 2, min: 90, max: 110, laeufe: 20, quantum: 256, rate: 48000 };
  // min wird gegen max verglichen: für die Grenzen von min steht max auf dem Höchstwert, für die von max min auf 0 (sonst fängt min > max den Müll, nicht die Grenze)
  const mitF = (f, v) => setzeLatenz(ok, 'andreas', { ...lat, ...(f === 'min' ? { max: 96000 } : f === 'max' ? { min: 0 } : {}), [f]: v });
  const grenzen = { samples: [0, 48000], streuung: [0, 48000], min: [0, 96000], max: [0, 96000], laeufe: [20, 10000], quantum: [16, 8192], rate: [8000, 192000] };
  for (const [f, [lo, hi]] of Object.entries(grenzen)) {
    for (const v of [hi + 1, 1e12, Infinity, NaN, '5', null]) assert.equal(grund(() => mitF(f, v)), 'argument_ungueltig/400', `${f}=${String(v)}`);
    if (f !== 'max') assert.equal(grund(() => mitF(f, lo - 1)), 'argument_ungueltig/400', `${f} unter ${lo}`);   // max unter 0 ist über min >= 0 nicht von min > max zu trennen
    assert.equal(grund(() => mitF(f, lo)), null, `Gegenprobe ${f}=${lo}`);
    assert.equal(grund(() => mitF(f, hi)), null, `Gegenprobe ${f}=${hi}`);
  }
  for (const f of ['laeufe', 'quantum', 'rate']) assert.equal(grund(() => mitF(f, grenzen[f][0] + 0.5)), 'argument_ungueltig/400', `${f} ganzzahlig`);
});

test('Nachzug R2 (m2): eine Datei mit Latenz ohne Gerät ist defekt; mit Gerät ist sie heil', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-gr-lat-'));
  const s = new GeraeteSpeicher(path.join(d, 'g.json'));
  const L = { samples: 480, streuung: 1, min: 470, max: 490, laeufe: 20, quantum: 256, rate: 48000, art: 'kabel', gemessen_am: '2026-10-22T00:00:00Z' };
  const mit = (f) => { const x = standard(); f(x); fs.writeFileSync(s.pfad, JSON.stringify(x)); return grund(() => s.lies()); };
  assert.equal(mit((x) => { x.eingaenge[0].latenz = L; }), 'konfig_defekt/500', 'P2: Latenz ohne Gerät');
  assert.equal(mit((x) => { Object.assign(x.eingaenge[0], { profil: 'pc-eingang', audio: { knoten: PC, ports: [`${PC}:capture_FL`] }, latenz: L }); }), null, 'Gegenprobe: Latenz mit Gerät ist heil');
  fs.rmSync(d, { recursive: true, force: true });
});
