// TRACKER (task 4): the key map of the tracker as a pure function. No DOM. taste(e, ort) -> Aktion | null.
// e = { code, key, shiftKey, ctrlKey, altKey, metaKey }; ort = { unterspalte, zahlen, fxteil? }.
// unterspalte: 'note' | 'vol' | 'dly' | 'chn' | 'rpt' | 'ins' | 'fx'; zahlen: 'hex' (default) or 'dec' (hex is shown in VOL and in the value of an
// effect only, DLY, CHN and RPT are always decimal). fxteil ('befehl' default | 'wert') says which half of an effect cell the cursor is in:
// letters are typed in the command half, in the value half A..F are hex digits where hex is shown.

export const NOTEN_TASTEN = Object.freeze({
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22,
  KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
});

const PFEILE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const ZIFFER = /^(?:Digit|Numpad)(\d)$/;
const HEX_BUCHSTABE = /^Key([A-F])$/;

export function taste(e, ort = {}) {
  const { code, shiftKey: shift, ctrlKey: ctrl, altKey: alt, metaKey: meta } = e;
  if (typeof code !== 'string' || meta || /^F\d+$/.test(code)) return null;
  if (ctrl && alt) return null;                                          // AltGr
  const u = ort.unterspalte ?? 'note';
  const hexAn = ort.zahlen !== 'dec' && (u === 'vol' || (u === 'fx' && ort.fxteil === 'wert'));

  if (ctrl) {
    if (code === 'ArrowUp' || code === 'ArrowDown') return { art: 'transponieren', d: (code === 'ArrowUp' ? 1 : -1) * (shift ? 12 : 1) };
    if (shift) return code === 'KeyZ' ? { art: 'redo' } : null;
    switch (code) {
      case 'KeyA': return { art: 'alles' };
      case 'KeyC': return { art: 'kopieren' };
      case 'KeyX': return { art: 'ausschneiden' };
      case 'KeyV': return { art: 'einsetzen' };
      case 'KeyD': return { art: 'duplizieren' };
      case 'KeyI': return { art: 'interpolieren' };
      case 'KeyZ': return { art: 'undo' };
      case 'KeyY': return { art: 'redo' };
      default: return null;                                              // Ctrl+digit and the rest
    }
  }
  if (alt) {
    if (code === 'ArrowUp') return { art: 'schritt', d: 1 };
    if (code === 'ArrowDown') return { art: 'schritt', d: -1 };
    return null;
  }

  if (code in PFEILE) return shift ? { art: 'auswahl', dz: PFEILE[code][0], ds: PFEILE[code][1] } : { art: 'cursor', dz: PFEILE[code][0], ds: PFEILE[code][1] };
  switch (code) {
    case 'Tab': return { art: 'spur', d: shift ? -1 : 1 };
    case 'PageUp': return shift ? null : { art: 'seite', d: -1 };
    case 'PageDown': return shift ? null : { art: 'seite', d: 1 };
    case 'Home': return shift ? null : { art: 'anfang' };
    case 'End': return shift ? null : { art: 'ende' };
    case 'Space': return { art: shift ? 'schleife' : 'spielen' };
    case 'Enter': case 'NumpadEnter': return shift ? null : { art: 'ab_zeile' };
    case 'Escape': return { art: 'escape' };
    case 'Delete': return { art: 'leeren' };
    case 'Backspace': return { art: 'rueck' };
    case 'Insert': return { art: 'einfuegen' };
    case 'BracketLeft': return { art: 'oktave', d: -1 };
    case 'BracketRight': return { art: 'oktave', d: 1 };
    default: break;
  }

  if (u === 'note') {
    if (code === 'KeyA') return { art: 'aus' };
    if (code in NOTEN_TASTEN) return { art: 'note', halbton: NOTEN_TASTEN[code], akkord: !!shift };
    return null;
  }
  if (shift) return u === 'fx' && ort.fxteil !== 'wert' && /^[a-zA-Z]$/.test(e.key ?? '') ? { art: 'buchstabe', zeichen: e.key.toUpperCase() } : null;
  if (u === 'dly' && (code === 'Minus' || code === 'NumpadSubtract')) return { art: 'vorzeichen' };
  const z = ZIFFER.exec(code);
  if (z && (u === 'vol' || u === 'dly' || u === 'chn' || u === 'rpt' || u === 'ins' || u === 'fx')) return { art: 'ziffer', wert: Number(z[1]) };
  const h = HEX_BUCHSTABE.exec(code);
  if (h && hexAn) return { art: 'ziffer', wert: 10 + h[1].charCodeAt(0) - 65 };
  if (u === 'fx' && ort.fxteil !== 'wert') {
    const t = /^[a-zA-Z]$/.test(e.key ?? '') ? e.key : /^Key([A-Z])$/.exec(code)?.[1];
    if (t) return { art: 'buchstabe', zeichen: t.toUpperCase() };
  }
  return null;
}
