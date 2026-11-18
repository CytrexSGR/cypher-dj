// Plan studio-taktart T5, golden: szenenZielBeat over a grid of 40 inputs (the one-argument call of the scene code).
import { szenenZielBeat } from '../../areas/proj/szenen_bar.ts';

export function lauf() {
  const aus = [];
  const kBeats = [0, 5.57, 7.99, 8, 61.5, 100, 108.35, 127.3];
  for (const kBeat of kBeats) {
    for (const [bpm, offset, loopAn, loopBis, laeuft] of [[128, 0, false, 64, true], [90, 0.37, true, 62, true], [140, 1.25, true, 64, true],
      [128, 0, false, 64, false], [174, 3.1, true, 30, true]]) {
      const eingang = { kBeat, offset, bpm, loopVon: 0, loopBis, loopAn, laeuft };
      aus.push({ eingang, ziel: szenenZielBeat(eingang) });
    }
  }
  return aus;
}
