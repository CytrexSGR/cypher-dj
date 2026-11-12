// I08: Geräteprofile. Andreas' Entscheidung 2026-10-22: PC-Eingang oder Pioneer XDJ-XZ. Erkennung nach Knotenname, USB-Hersteller 0x2b73 und MIDI-Name.
import type { AudioQuelle, MidiQuelle } from './pwdump.ts';

export interface Profil {
  id: string; name: string;
  audio: { passt: (q: AudioQuelle) => boolean; hinweis: string } | null;
  midi: { passt: (q: MidiQuelle) => boolean } | null;
}
export const PROFILE: readonly Profil[] = [
  { id: 'pc-eingang', name: 'PC input (onboard)',
    audio: { passt: (q) => /^alsa_input\.pci-[0-9a-f_.]+\.analog-stereo$/.test(q.knoten), hinweis: '' }, midi: null },
  { id: 'xdj-xz', name: 'Pioneer XDJ-XZ',
    audio: { passt: (q) => q.usb?.vendor === '0x2b73',
      hinweis: 'Audio unmeasured: all captures so far held only zero bytes; it needs the quirk_alias module option, a linked deck and a playing track (task H4).' },
    midi: { passt: (m) => /XDJ-XZ/i.test(m.port) || /XDJ-XZ/i.test(m.alias) } },
  // 1.8 T5a: any USB audio interface (Seiren V3 Mini, K6, ...). The XDJ-XZ keeps its own profile (0x2b73), onboard PCI cards stay with pc-eingang (their usb is null).
  // Several matching nodes: setzeEingang takes the first, `knoten` or explicit ports pick another one.
  { name: 'USB audio interface', id: 'usb-audio', audio: { passt: (q) => q.usb !== null && q.usb !== undefined && q.usb.vendor !== '0x2b73', hinweis: '' }, midi: null },
  // S19 (MIDI learn): any MIDI controller. No audio; every detected MIDI source fits except software ports (PipeWire's Bluetooth MIDI
  // server, ALSA's Midi Through): those are listed first by pw-dump and were picked instead of a plugged-in USB controller (an LPD8, 2026-11-11).
  // setzeMidi takes the first fitting one or the explicit port the caller gives. The controller is then wired to midi_ein_1 and drives graph
  // knobs through the learn table.
  { id: 'midi-controller', name: 'MIDI controller', audio: null, midi: { passt: (m) => !istSoftwarePort(m) } },
];
/** Ports that no hardware stands behind: the Bluetooth MIDI server of PipeWire and ALSA's Midi Through loopback. */
export const istSoftwarePort = (m: MidiQuelle): boolean => /^bluez_midi\./.test(m.port) || /Midi Through/i.test(m.port) || /Midi Through/i.test(m.alias);
export const profil = (id: unknown): Profil | undefined => PROFILE.find((p) => p.id === id);
