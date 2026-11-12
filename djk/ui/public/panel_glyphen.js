// Waveform and filter glyphs for selector options. ONE module for the id list (validated by graphs.ts) and the drawing
// (panel.js, later task). Pure data, no DOM. Every path lives in a 24 x 12 box (x 0..24, y 0..12, y 6 is the centre line).

/** Fixed glyph ids; a panel's `glyphs` entries come from this list (or are null). */
export const GLYPHEN = ['saw', 'square', 'pulse', 'tri', 'sine', 'noise', 'ramp', 'sh', 'lp', 'bp', 'hp', 'notch', 'off'];

/** SVG path data per glyph id (stroke only, no fill). */
export const GLYPHEN_PFAD = {
  saw: 'M1 10 L12 2 L12 10 L23 2',
  ramp: 'M1 2 L12 10 L12 2 L23 10',
  square: 'M1 10 L1 2 L12 2 L12 10 L23 10 L23 2',
  pulse: 'M1 10 L1 2 L6 2 L6 10 L13 10 L13 2 L18 2 L18 10 L23 10',
  tri: 'M1 10 L6.5 2 L17.5 10 L23 2',
  sine: 'M1 6 C4 0 8 0 12 6 S20 12 23 6',
  noise: 'M1 6 L3 2 L4 10 L6 4 L8 9 L9 3 L11 8 L13 2 L14 10 L16 5 L18 9 L20 3 L22 8 L23 6',
  sh: 'M1 7 L5 7 L5 3 L9 3 L9 9 L13 9 L13 5 L17 5 L17 10 L23 10',
  lp: 'M1 3 L13 3 C17 3 17 10 23 10',
  hp: 'M1 10 C7 10 7 3 11 3 L23 3',
  bp: 'M1 10 C6 10 8 3 12 3 C16 3 18 10 23 10',
  notch: 'M1 3 L7 3 C10 3 10 10 12 10 C14 10 14 3 17 3 L23 3',
  off: 'M2 6 L22 6 M8 2 L16 10',
};
