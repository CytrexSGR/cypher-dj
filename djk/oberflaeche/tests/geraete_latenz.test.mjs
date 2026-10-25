// I08 Task 12: Latenzprofil. Zahlen geprüft, >= 20 Läufe, Kabelwert nur von Andreas, nur auf einem Eingang mit Gerät.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setzeEingang, setzeLatenz } from '../bereiche/geraete/aendern.ts';
import { GeraeteFehler, standard } from '../bereiche/geraete/speicher.ts';

const PC = 'alsa_input.pci-0000_16_00.6.analog-stereo';
const ERK = { audio: [{ knoten: PC, beschreibung: '', zustand: '', kanaele: 2, ports: [`${PC}:capture_FL`, `${PC}:capture_FR`], usb: null }], midi: [] };
const mit = setzeEingang(standard(), 'andreas', { k: 1, profil: 'pc-eingang' }, ERK);
const messung = { k: 1, samples: 480, streuung: 1.5, min: 478, max: 483, laeufe: 20, quantum: 256, rate: 48000, art: 'kabel' };
const grund = (f) => { try { f(); } catch (e) { return e instanceof GeraeteFehler ? e.grund : String(e); } return null; };

test('Latenz: Andreas trägt eine Kabelmessung ein; Zeitpunkt kommt vom Server', () => {
  const k = setzeLatenz(mit, 'andreas', messung, () => '2026-10-23T10:00:00.000Z');
  assert.deepEqual(k.eingaenge[0].latenz, { samples: 480, streuung: 1.5, min: 478, max: 483, laeufe: 20, quantum: 256, rate: 48000, art: 'kabel', gemessen_am: '2026-10-23T10:00:00.000Z' });
  // ein mitgeschickter Zeitpunkt wird ignoriert: er kommt nie vom Client
  const k2 = setzeLatenz(mit, 'andreas', { ...messung, gemessen_am: '1999-01-01T00:00:00.000Z' }, () => '2026-10-23T10:00:00.000Z');
  assert.equal(k2.eingaenge[0].latenz.gemessen_am, '2026-10-23T10:00:00.000Z');
});
test('Latenz: Cypher darf software, nie kabel; weniger als 20 Läufe, Müll und ein Eingang ohne Gerät werden abgelehnt', () => {
  assert.equal(setzeLatenz(mit, 'cypher', { ...messung, art: 'software' }).eingaenge[0].latenz.art, 'software');
  assert.equal(grund(() => setzeLatenz(mit, 'cypher', messung)), 'latenz_nur_andreas');
  assert.equal(grund(() => setzeLatenz(mit, 'andreas', { ...messung, laeufe: 19 })), 'argument_ungueltig');
  for (const m of [{ samples: -1 }, { samples: NaN }, { samples: 48001 }, { rate: 'x' }, { rate: 7999 }, { rate: 192001 }, { laeufe: 20.5 }, { quantum: 256.5 }, { streuung: -1 }, { min: 500, max: 400 }, { art: 'luft' }, { k: 5 }]) assert.equal(grund(() => setzeLatenz(mit, 'andreas', { ...messung, ...m })), 'argument_ungueltig');
  assert.equal(grund(() => setzeLatenz(standard(), 'andreas', messung)), 'eingang_leer');
});
test('Latenz: gehört zum Gerät; sie fällt mit der Freigabe zurück (Profil weg, anderes Gerät), bleibt beim selben Gerät', () => {
  const XZ = 'alsa_input.usb-Pioneer_DJ_XDJ-XZ-00.multichannel-input';
  const erk2 = { audio: [{ knoten: XZ, beschreibung: '', zustand: '', kanaele: 12, ports: [`${XZ}:capture_AUX0`, `${XZ}:capture_AUX1`], usb: { vendor: '0x2b73', produkt: '0x0000' } }], midi: [] };
  const gemessen = setzeLatenz(mit, 'andreas', messung);
  assert.equal(gemessen.eingaenge[0].latenz.art, 'kabel');
  // Negativ-Kontrolle: dasselbe Gerät, dieselben Ports -> Wert bleibt
  assert.equal(setzeEingang(gemessen, 'andreas', { k: 1, profil: 'pc-eingang' }, ERK).eingaenge[0].latenz.samples, 480);
  // Fehlerfall 1: Profil entfernen
  assert.equal(setzeEingang(gemessen, 'andreas', { k: 1, profil: null }, ERK).eingaenge[0].latenz, null);
  // Fehlerfall 2: Ports ausdrücklich auf andere Ports desselben Profils
  assert.equal(setzeEingang(gemessen, 'andreas', { k: 1, profil: 'pc-eingang', ports: [`${PC}:capture_FR`, `${PC}:capture_FL`] }, ERK).eingaenge[0].latenz, null);
  // Fehlerfall 3: anderes Gerät auf dem Eingang
  const xz = setzeEingang(gemessen, 'andreas', { k: 1, profil: 'xdj-xz' }, erk2).eingaenge[0];
  assert.deepEqual([xz.profil, xz.latenz], ['xdj-xz', null]);
});
