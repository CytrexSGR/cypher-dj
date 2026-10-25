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
];
export const profil = (id: unknown): Profil | undefined => PROFILE.find((p) => p.id === id);
