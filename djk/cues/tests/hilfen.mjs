// Testhilfen: erzeugte MP3 (ffmpeg lavfi, kein Ton nach außen), Temp-Ordner
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpOrdner(t, name = 'djk-cues-test-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), name));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// Sinus (oder Stille bei f = 0) als MP3; meta -> -metadata k=v; id3 = 3 oder 4
export function mp3(ziel, { f = 440, dauer = 2, meta = {}, id3 = 3, rate = 44100 } = {}) {
  const quelle = f > 0 ? `sine=frequency=${f}:sample_rate=${rate}:duration=${dauer}` : `anullsrc=r=${rate}:cl=mono:d=${dauer}`;
  const m = Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', quelle, ...m, '-id3v2_version', String(id3), '-b:a', '192k', '-y', ziel]);
  return ziel;
}
