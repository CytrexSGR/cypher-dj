// Test helpers of browser plan 5: tiny kits written by hand (raw stereo float32 sounds) and zips built with Python's zipfile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const tmpOrdner = (t, praefix = 'kit5-') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

/** A valid kit folder: `noten` pads, each `frames` frames of stereo f32 filled with `fuell` + note/1000. */
export function schreibeKit(ordner, { noten = [36, 37], frames = 100, fuell = 0.25, name = path.basename(ordner), aendere } = {}) {
  fs.mkdirSync(ordner, { recursive: true });
  const klaenge = noten.map((note) => {
    const f = new Float32Array(frames * 2).fill(fuell + note / 1000);
    fs.writeFileSync(path.join(ordner, `${note}.f32`), Buffer.from(f.buffer));
    return { note, name: `bd:${note}`, datei: `${note}.f32`, frames };
  });
  const j = { schema: 1, name, klaenge };
  aendere?.(j, ordner);
  fs.writeFileSync(path.join(ordner, 'kit.json'), JSON.stringify(j));
  return ordner;
}

/** Zips `eintraege` ({ name: Buffer|string }) into `zip` with Python zipfile; names are taken as given (so '../x' is possible). */
export function schreibeZip(zip, eintraege) {
  const spec = JSON.stringify(Object.entries(eintraege).map(([n, b]) => [n, Buffer.from(b).toString('base64')]));
  execFileSync('python3', ['-I', '-c', 'import sys,json,base64,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor n,b in json.loads(sys.argv[2]): z.writestr(n,base64.b64decode(b))\nz.close()', zip, spec]);
  return zip;
}

/** The zip of a kit folder, entries at the zip root or inside `unter`. */
export function zipVonKit(zip, ordner, unter = '') {
  const e = {};
  for (const n of fs.readdirSync(ordner)) e[unter ? `${unter}/${n}` : n] = fs.readFileSync(path.join(ordner, n));
  return schreibeZip(zip, e);
}
