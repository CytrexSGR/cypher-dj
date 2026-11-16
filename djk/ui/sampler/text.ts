// Sampler A1: the cut as text (spec D9): one header line, a column line, one line per slice. Slice numbers are shown 1-based (D7).
import type { Schnitt } from './schnitt.ts';

const drei = (x: number): string => (Math.abs(x) < 0.0005 ? 0 : x).toFixed(3);

export function schnittText(s: Schnitt): string {
  const q = s.quelle;
  const n = s.grenzen.length - 1;
  const kopf = `cut ${s.id} "${s.name}"  source ${q.art} ${q.ref}${q.stem !== undefined ? ` ${q.stem}` : ''}  ${Number(s.bpm.toFixed(2))} BPM  ${s.beats} beats  method ${s.methode}${s.methode === 'anschlag' && s.empfindlichkeit !== undefined ? ` ${s.empfindlichkeit.toFixed(2)}` : ''}  ${n} slices`;
  const spalten = ['slice', 'start', 'length', 'strength', 'grid'];
  const breiten = [7, 9, 9, 10, 9];
  const zeile = (z: string[]): string => z.map((t, i) => (i === z.length - 1 ? t : t.padEnd(breiten[i]))).join('');
  const aus = [kopf, zeile(spalten)];
  for (let i = 0; i < n; i++) {
    const g = s.guete[i];
    aus.push(zeile([String(i + 1), drei(s.grenzen[i] * s.beats / s.frames), drei((s.grenzen[i + 1] - s.grenzen[i]) * s.beats / s.frames),
      g?.staerke == null ? '-' : g.staerke.toFixed(2), drei(g?.raster_abstand_beats ?? 0)]));
  }
  return aus.join('\n');
}
