// I08 Task 7: Erkennung aus pw-dump. Nur echte Quellen (media.class Audio/Source), physische MIDI-Ausgänge, kein Kern-Eigenes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liesDump } from '../bereiche/geraete/pwdump.ts';

const knoten = (id, props, state = 'suspended') => ({ id, type: 'PipeWire:Interface:Node', info: { state, props } });
const geraet = (id, props) => ({ id, type: 'PipeWire:Interface:Device', info: { props } });
const port = (id, props) => ({ id, type: 'PipeWire:Interface:Port', info: { props } });
const AUDIO = '32 bit float mono audio', MIDI = '8 bit raw midi';
const DUMP = [
  geraet(52, { 'device.name': 'alsa_card.pci-0000_16_00.6', 'device.bus': 'pci' }),
  geraet(50, { 'device.name': 'alsa_card.usb-Razer_Inc._Razer_Seiren_V3_Mini-00', 'device.bus': 'usb', 'device.vendor.id': '0x1532', 'device.product.id': '0x056a' }),
  geraet(70, { 'device.name': 'alsa_card.usb-Pioneer_XDJ-XZ', 'device.bus': 'usb', 'device.vendor.id': '0x2b73', 'device.product.id': '0x002d' }),
  knoten(57, { 'node.name': 'alsa_input.pci-0000_16_00.6.analog-stereo', 'node.description': 'Family 17h/19h HD Audio Controller Analoges Stereo', 'media.class': 'Audio/Source', 'device.id': 52, 'audio.channels': 2 }),
  port(58, { 'node.id': 57, 'port.id': 1, 'port.name': 'capture_FR', 'port.direction': 'out', 'format.dsp': AUDIO }),
  port(44, { 'node.id': 57, 'port.id': 0, 'port.name': 'capture_FL', 'port.direction': 'out', 'format.dsp': AUDIO }),
  knoten(56, { 'node.name': 'alsa_output.pci-0000_16_00.6.iec958-stereo', 'media.class': 'Audio/Sink', 'device.id': 52, 'audio.channels': 2 }, 'running'),
  port(45, { 'node.id': 56, 'port.id': 0, 'port.name': 'monitor_FL', 'port.direction': 'out', 'format.dsp': AUDIO }),
  knoten(71, { 'node.name': 'alsa_input.usb-Pioneer_DJ_XDJ-XZ-00.multichannel-input', 'media.class': 'Audio/Source', 'device.id': 70, 'audio.channels': 12 }, 'running'),
  ...Array.from({ length: 12 }, (_, i) => port(100 + i, { 'node.id': 71, 'port.id': i, 'port.name': `capture_AUX${i}`, 'port.direction': 'out', 'format.dsp': AUDIO })),
  knoten(53, { 'node.name': 'Midi-Bridge', 'media.class': 'Midi/Bridge' }),
  port(54, { 'node.id': 53, 'port.id': 0, 'port.name': 'Midi Through: Port-0 (playback)', 'port.direction': 'in', 'format.dsp': MIDI, 'port.physical': true }),
  port(55, { 'node.id': 53, 'port.id': 0, 'port.name': 'Midi Through: Port-0 (capture)', 'port.alias': 'Midi Through:Midi Through Port-0', 'port.direction': 'out', 'format.dsp': MIDI, 'port.physical': true }),
  knoten(72, { 'node.name': 'cypherdj-kern' }),
  port(75, { 'node.id': 72, 'port.id': 4, 'port.name': 'midi_aus_1', 'port.alias': 'cypherdj-kern:midi_aus_1', 'port.direction': 'out', 'format.dsp': MIDI }),
];

test('Erkennung: zwei Audio-Quellen, Ports in Reihenfolge, USB-Kennung; Senke, Seiren ohne Knoten und Kern-Eigenes fehlen', () => {
  const e = liesDump(DUMP);
  assert.deepEqual(e.audio.map((a) => a.knoten), ['alsa_input.pci-0000_16_00.6.analog-stereo', 'alsa_input.usb-Pioneer_DJ_XDJ-XZ-00.multichannel-input']);
  const pc = e.audio[0];
  // Gesamtreview B1: unter pipewire-jack heißt der Client des Geräts node.description (nicht node.name); node.name bleibt nur die Kennung.
  assert.deepEqual(pc.ports, ['Family 17h/19h HD Audio Controller Analoges Stereo:capture_FL', 'Family 17h/19h HD Audio Controller Analoges Stereo:capture_FR']);
  assert.ok(pc.ports.every((p) => !p.startsWith('alsa_input.')), 'die node.name-Form findet der Kern unter pw-jack nicht');
  assert.deepEqual([pc.kanaele, pc.zustand, pc.usb], [2, 'suspended', null]);
  const xz = e.audio[1];
  assert.ok(xz.ports.every((p) => p.startsWith('alsa_input.usb-Pioneer_DJ_XDJ-XZ-00.multichannel-input:')), 'ohne node.description gilt node.name (wie ziel.py)');
  assert.deepEqual([xz.kanaele, xz.ports.length, xz.usb], [12, 12, { vendor: '0x2b73', produkt: '0x002d' }]);
  assert.ok(!e.audio.some((a) => a.knoten.startsWith('alsa_output')), 'eine Senke ist nie eine Quelle');
});

test('Erkennung: MIDI nur physische Ausgänge, nie der Kern', () => {
  const e = liesDump(DUMP);
  assert.deepEqual(e.midi, [{ port: 'Midi-Bridge:Midi Through: Port-0 (capture)', alias: 'Midi Through:Midi Through Port-0' }]);
});

test('Erkennung: Müll wirft nicht', () => {
  for (const x of [null, undefined, 5, 'x', {}, [], [{}], [{ id: 1 }], [{ id: 1, type: 'PipeWire:Interface:Node' }]]) assert.deepEqual(liesDump(x), { audio: [], midi: [] });
});

test('Erkennung: gleiche node.description bei zwei Quellen ist nicht eindeutig, also keine Ports (wie ziel.py: abweisen, nicht raten)', () => {
  const zwei = [
    knoten(1, { 'node.name': 'alsa_input.a', 'node.description': 'Gleich', 'media.class': 'Audio/Source' }),
    port(2, { 'node.id': 1, 'port.id': 0, 'port.name': 'capture_FL', 'port.direction': 'out', 'format.dsp': AUDIO }),
    knoten(3, { 'node.name': 'alsa_input.b', 'node.description': 'Gleich', 'media.class': 'Audio/Source' }),
    port(4, { 'node.id': 3, 'port.id': 0, 'port.name': 'capture_FL', 'port.direction': 'out', 'format.dsp': AUDIO }),
    knoten(5, { 'node.name': 'alsa_input.c', 'node.description': 'Eindeutig', 'media.class': 'Audio/Source' }),
    port(6, { 'node.id': 5, 'port.id': 0, 'port.name': 'capture_FL', 'port.direction': 'out', 'format.dsp': AUDIO }),
  ];
  const e = liesDump(zwei);
  assert.deepEqual(e.audio.map((a) => [a.knoten, a.ports]), [['alsa_input.a', []], ['alsa_input.b', []], ['alsa_input.c', ['Eindeutig:capture_FL']]]);
});
