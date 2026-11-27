// Real controllers belong to the production instance. A test instance (CYPHERDJ_INSTANZ=a..i) lists them as present but not connected, writes no edge
// from them to the kern and does not put one on a place, unless CYPHERDJ_ECHTE_GERAETE=1 (a controller test that was asked for). The same variable
// opens the sequencer for the desk bridge (djk/hand_bruecke/alsa_seq.py).
import { instanz } from '../../paths.ts';

export function echteGeraeteErlaubt(i: string = instanz(), env: Record<string, string | undefined> = process.env): boolean {
  return i === '' || env.CYPHERDJ_ECHTE_GERAETE === '1';
}

/** A port of the ALSA bridge (PipeWire's "Midi-Bridge:") that no cypherdj client owns: a device somebody plugged in. Fixture clients and the soft controller carry "cypherdj". */
export const istEchtesGeraet = (port: string): boolean => port.startsWith('Midi-Bridge:') && !/cypherdj/i.test(port);
