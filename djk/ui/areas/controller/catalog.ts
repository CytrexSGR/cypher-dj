// Known controllers: the devices the studio has a way for, with what tells them apart on USB and (for MIDI devices) in a port name. The register
// lists them whether they are plugged in or not, so one view answers "what do I own, what is connected, where does it go". Three ways lead into
// the kern: `pult` = the desk bridge (djk/hand_bruecke, user service cypherdj-pult) translates the device and feeds hand_in with a fixed
// assignment file; `lernen` = a class-compliant MIDI device on a controller place (raw input midi_ein_<platz>) with a learn table of its own;
// `offen` = known and measured, but nothing binds it yet.
import fs from 'node:fs';
import path from 'node:path';

export type Weg = 'pult' | 'lernen' | 'offen';
/**
 * One control of a device, for the layout the page draws (zeile/spalte count from 1). `kanal`/`nr` are what the device sends in its default
 * mode; `kanal_daw` is the channel it sends on when it is on its DAW port (Launch Control 3 buttons), absent when it is the same.
 * A `note` control (a pad) is assigned to a switch or a deck action, never to a continuous target; a `cc` button likewise (learn/targets.ts).
 */
export interface Regler { name: string; typ: 'cc' | 'note'; kanal: number; nr: number; kanal_daw?: number; art: 'knob' | 'button' | 'pad'; zeile: number; spalte: number }
/** A bank of a device: the same controls on another MIDI channel (LPD8: its four programs). `noten` are the notes of its note controls, in layout order. */
export interface Bank { name: string; kanal: number; noten?: readonly number[] }
export interface KatalogGeraet {
  id: string; name: string;
  usb: string;                 // "vvvv:pppp", or "vvvv:*" for every product of the vendor
  midi: string | null;         // part of the MIDI port name of the device (null: no MIDI port of its own, e.g. HID)
  weg: Weg;
  belegung: string | null;     // the assignment file in the controller folder the desk bridge path uses (id without .json)
  kanaele: [number, number] | null;   // the MIDI channels of that file that belong to this device (the desk file holds several devices)
  rueckweg: string;            // what the studio sends back to the device
  rueckweg_port: string | null; // part of the name of the port that carries the feedback when it is a second port of the device (its place must be on that port)
  hinweis: string;
  regler?: readonly Regler[];  // the control layout of a learnable device (absent: the page lists only what is assigned)
  baenke?: readonly Bank[];    // the layout exists once per bank; the page picks one and assigns on its channel
  bedienung?: string;          // what the controls outside the layout do (mode buttons)
}
const reihe = (n: number, f: (i: number) => Regler): Regler[] => Array.from({ length: n }, (_, i) => f(i + 1));
// Launch Control 3: 16 endless encoders CC 13..28 (two rows of eight) and 8 buttons CC 37..44 below; channel 16 in the default custom mode, the buttons
// move to channel 1 on the DAW port (docs/controller/launch-control-3.md).
// The buttons left of the encoders (programmer's reference v1.1): in standalone mode Page, Track and the DAW-only buttons send nothing, Shift and Mode
// open the device's own menus; on the DAW port they report to the host (only Shift is documented: CC 63 on channel 7).
const LC3_BEDIENUNG = 'The buttons on the left are not tiles: Page ▲▼ and Track ◀▶ send nothing on the plain MIDI port and are not used by the studio on the DAW port yet. Mode picks the custom mode (the tiles show mode 8, the default; a control learned in another custom mode appears as an extra tile), Shift + Mode opens the device settings, Function/DAW belongs to the device.';
const LC3_REGLER: Regler[] = [
  ...reihe(16, (i) => ({ name: `Enc ${i}`, typ: 'cc', kanal: 16, nr: 12 + i, art: 'knob', zeile: i <= 8 ? 1 : 2, spalte: ((i - 1) % 8) + 1 })),
  ...reihe(8, (i) => ({ name: `Btn ${i}`, typ: 'cc', kanal: 16, nr: 36 + i, kanal_daw: 1, art: 'button', zeile: 3, spalte: i })),
];
// LPD8, read from his unit with its program dump (F0 47 7F 75 63 00 01 <program> F7) on 2026-11-18, all four programs as they are stored:
// knobs K1..K8 send CC 1..8, the pads send the notes below (PAD), CC 1..6, 8, 9 (CC) or program changes 0..7 (PROG CHNG); program n sends on
// MIDI channel n. The layout is the device's: pads on the left (5..8 above 1..4), knobs on the right (K1..K4 above K5..K8). A pad is
// assigned directly (POST /lernen/setzen with typ 'note') to a switch or a deck action; capture only reports CCs.
const LPD8_REGLER: Regler[] = [
  ...reihe(8, (i) => ({ name: `Pad ${i}`, typ: 'note', kanal: 1, nr: 35 + i, art: 'pad', zeile: i <= 4 ? 2 : 1, spalte: ((i - 1) % 4) + 1 })),
  ...reihe(8, (i) => ({ name: `K${i}`, typ: 'cc', kanal: 1, nr: i, art: 'knob', zeile: i <= 4 ? 1 : 2, spalte: ((i - 1) % 4) + 5 })),
];
const LPD8_BAENKE: Bank[] = [
  { name: 'Program 1', kanal: 1, noten: [36, 37, 38, 39, 40, 41, 42, 43] },
  { name: 'Program 2', kanal: 2, noten: [35, 36, 42, 39, 37, 38, 46, 44] },
  { name: 'Program 3', kanal: 3, noten: [60, 62, 64, 65, 67, 69, 71, 72] },
  { name: 'Program 4', kanal: 4, noten: [36, 38, 40, 41, 43, 45, 47, 48] },
];
const LPD8_BEDIENUNG = 'PROGRAM + pad 1–4 picks the program: four banks of the eight knobs, each on its own MIDI channel. PAD, CC and PROG CHNG set what the pads send: notes, CCs (CC 1–6, 8, 9: all but pad 8 share theirs with a knob) or program changes.';
export const KATALOG: readonly KatalogGeraet[] = [
  { id: 'apc20', name: 'Akai APC20', usb: '09e8:007b', midi: 'APC20', weg: 'pult', belegung: 'pult', kanaele: [1, 8], rueckweg: 'LEDs', rueckweg_port: null, hinweis: 'main console: four DJ channels and master' },
  { id: 's8', name: 'Traktor Kontrol S8', usb: '17cc:1370', midi: null, weg: 'pult', belegung: 'pult', kanaele: [9, 15], rueckweg: 'LEDs, two screens', rueckweg_port: null, hinweis: 'DJ desk: mixer, decks, stems, hot cues, loop, touch strip' },
  { id: 'mk2', name: 'Maschine MK2', usb: '17cc:1140', midi: null, weg: 'pult', belegung: null, kanaele: null, rueckweg: 'pads, two screens', rueckweg_port: null, hinweis: 'graph knobs of the modular channels' },
  { id: 'jam', name: 'Maschine Jam', usb: '17cc:1500', midi: null, weg: 'offen', belegung: null, kanaele: null, rueckweg: 'none yet', rueckweg_port: null, hinweis: 'protocol measured, nothing bound yet' },
  { id: 'xdj-xz', name: 'Pioneer XDJ-XZ', usb: '2b73:*', midi: 'XDJ-XZ', weg: 'offen', belegung: null, kanaele: null, rueckweg: 'none yet', rueckweg_port: null, hinweis: 'audio and MIDI profile under Devices; no assignment yet' },
  { id: 'lpd8', name: 'Akai LPD8', usb: '09e8:0075', midi: 'LPD8', weg: 'lernen', belegung: null, kanaele: null, rueckweg: 'none', rueckweg_port: null, hinweis: 'eight knobs, eight pads, four programs', regler: LPD8_REGLER, baenke: LPD8_BAENKE, bedienung: LPD8_BEDIENUNG },
  { id: 'lc3', name: 'Novation Launch Control 3', usb: '1235:0157', midi: 'LC3', weg: 'lernen', belegung: null, kanaele: null, rueckweg: 'encoder LEDs, display (on its DAW port)', rueckweg_port: 'DAW', hinweis: 'sixteen encoders, eight buttons, display', regler: LC3_REGLER, bedienung: LC3_BEDIENUNG },
];

/** USB ids "vvvv:pppp" of everything plugged in, read from sysfs (no process, a few small files). An unreadable tree is an empty list. */
export function usbGeraete(basis = '/sys/bus/usb/devices'): string[] {
  let namen: string[] = [];
  try { namen = fs.readdirSync(basis); } catch { return []; }
  const aus: string[] = [];
  for (const n of namen) {
    try {
      const v = fs.readFileSync(path.join(basis, n, 'idVendor'), 'utf8').trim().toLowerCase();
      const p = fs.readFileSync(path.join(basis, n, 'idProduct'), 'utf8').trim().toLowerCase();
      if (v && p) aus.push(`${v}:${p}`);
    } catch { /* interfaces and hubs without the two files */ }
  }
  return aus;
}
export const usbPasst = (muster: string, ids: readonly string[]): boolean => (muster.endsWith(':*') ? ids.some((i) => i.startsWith(muster.slice(0, -1))) : ids.includes(muster));
