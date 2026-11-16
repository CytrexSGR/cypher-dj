// The drum note maps of the drum graphs (drums-909, drums-808): which MIDI note plays which drum. The graphs hold no map; it lives in the core's drum node
// (`waehle`, djk/instruments/modular_dsp/src/trommeln.rs) and is documented in docs/presets/devices/GERAET-trommeln.md section 2. This is the list of the
// sounds worth a row in a grid, one note per sound, in the order of the grid rows. Other notes still play (any note below 36 is a kick, 40 a snare two
// semitones up, ...); the grid shows such a pitch as an extra row when a pattern holds it.
export interface TrommelKlang { readonly ton: number; readonly name: string }

export const TROMMEL_KARTEN: Readonly<Record<string, readonly TrommelKlang[]>> = Object.freeze({
  'drums-909': Object.freeze([
    { ton: 36, name: 'Kick' }, { ton: 37, name: 'Rim' }, { ton: 38, name: 'Snare' }, { ton: 39, name: 'Clap' },
    { ton: 42, name: 'Closed Hat' }, { ton: 44, name: 'Pedal Hat' }, { ton: 46, name: 'Open Hat' },
    { ton: 41, name: 'Low Tom' }, { ton: 45, name: 'Mid Tom' }, { ton: 48, name: 'High Tom' },
    { ton: 49, name: 'Crash' }, { ton: 51, name: 'Ride' }, { ton: 53, name: 'Ride Bell' },
  ]),
  'drums-808': Object.freeze([
    { ton: 35, name: 'Boom Kick' }, { ton: 36, name: 'Kick' }, { ton: 37, name: 'Rim' }, { ton: 38, name: 'Snare' }, { ton: 39, name: 'Clap' },
    { ton: 42, name: 'Closed Hat' }, { ton: 46, name: 'Open Hat' },
    { ton: 41, name: 'Low Tom' }, { ton: 45, name: 'Mid Tom' }, { ton: 48, name: 'High Tom' },
    { ton: 49, name: 'Cymbal' }, { ton: 56, name: 'Cowbell' }, { ton: 75, name: 'Clave' },
  ]),
});
