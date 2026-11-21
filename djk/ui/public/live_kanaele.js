// Channel list of the EFFECTS tab and the dock: leaf module without imports (so any module may import it without an import cycle).
import { CONTAINER, fxIndex } from './kanaele.js';
// The containers A..D (path of the strip, letter); the index is the wire index of the strip (komp/sc = index + 1), both from kanaele.js.
export const FX_KANAELE = CONTAINER.map((c) => [c.pfad, c.id]);
export const FX_INDEX = Object.fromEntries(CONTAINER.map((c) => [c.pfad, fxIndex(c.pfad)]));
