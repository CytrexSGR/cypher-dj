// The six knobs of the channel compressor (threshold, ratio, attack, release, makeup, mix), pure and without imports. effects_view.js (the button of the
// compressor face) and effects_face.js (the face) both need the table; effects_view.js cannot import effects_face.js and be imported back, so the table lives here.
// tests/comp_controls_table.test.mjs pins it.
export const KOMP_SECHS = [
  { feld: 'schwelle', name: 'THRESHOLD', min: -60, max: 0, schritt: 0.5, vorgabe: -18, text: (w) => `${w.toFixed(1)} dB` },
  { feld: 'ratio', name: 'RATIO', min: 1, max: 20, schritt: 0.1, vorgabe: 4, text: (w) => `${w.toFixed(1)}:1` },
  { feld: 'attack', name: 'ATTACK', min: 0.1, max: 100, schritt: 0.1, vorgabe: 10, text: (w) => `${w.toFixed(1)} ms` },
  { feld: 'release', name: 'RELEASE', min: 10, max: 1000, schritt: 1, vorgabe: 120, text: (w) => `${Math.round(w)} ms` },
  { feld: 'makeup', name: 'MAKEUP', min: 0, max: 24, schritt: 0.1, vorgabe: 0, text: (w) => `+${w.toFixed(1)} dB` },
  { feld: 'mix', name: 'MIX', min: 0, max: 1, schritt: 0.01, vorgabe: 1, text: (w) => `${Math.round(w * 100)}%` },
];
