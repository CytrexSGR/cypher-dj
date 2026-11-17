// ANALYZE window, slice 1: the worker of POST /proj/analyse. It runs in a node:worker_threads worker so the FFT work never blocks the page server.
// workerData {quelle, vergleich?, frames}: a path of a rendered float32 stereo WAV, or null for a silent strip (zeros are fed instead of a file);
// `vergleich` is absent when there is no comparison. `frames` holds the common frame count per entry (quelle, vergleich), so both analysers use one raster.
// The files are read in blocks of 65536 frames, so memory stays bounded however long the range is. Posts one WerkErgebnis.
import { parentPort, workerData } from 'node:worker_threads';
import { leseWavF32Bloecke } from '../../sampler/wav.ts';
import type { StreifenAnalysator as SA, ueberdeckung as UE, Teilmessung } from '../../project/sound_measurement.ts';
import type { Ueberdeckung } from '../../project/sound_contract.ts';

const BLOCK = 65536;
// `modul`: URL of the pure analysis module , loaded here so that this file does not need it to be imported by a test
interface Auftrag { modul: string; quelle: string | null; vergleich?: string | null; frames: number[] }

type Modul = { StreifenAnalysator: typeof SA; ueberdeckung: typeof UE };

function messe(m: Modul, datei: string | null, frames: number): Teilmessung {
  const an = new m.StreifenAnalysator(frames);
  if (datei === null) {
    const still = new Float32Array(BLOCK * 2);
    for (let rest = frames; rest > 0; rest -= BLOCK) an.schiebe(rest >= BLOCK ? still : still.subarray(0, rest * 2));
  } else {
    let rest = frames;
    leseWavF32Bloecke(datei, BLOCK, (b) => {                       // the block array is reused: schiebe consumes it before the next block is read
      const n = Math.min(b.length / 2, rest);
      if (n <= 0) return;
      an.schiebe(n * 2 === b.length ? b : b.subarray(0, n * 2));
      rest -= n;
    });
  }
  return an.ende();
}

export async function werk(d: Auftrag): Promise<{ quelle: Teilmessung; vergleich?: Teilmessung; ueberdeckung?: Ueberdeckung }> {
  const m = (await import(d.modul)) as Modul;
  const q = messe(m, d.quelle, d.frames[0]);
  if (d.vergleich === undefined) return { quelle: q };
  const v = messe(m, d.vergleich, d.frames[1] ?? d.frames[0]);
  return { quelle: q, vergleich: v, ueberdeckung: m.ueberdeckung(q, v) };
}

if (parentPort) werk(workerData as Auftrag).then((r) => parentPort!.postMessage(r), (e) => { throw e; });
