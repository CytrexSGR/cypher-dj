// The source of the hand for tests that scan it for a fragment or count its tool entries: hand.ts plus the modules split off it
// (the files in djk/hand/ that carry the "Moved unchanged out of hand.ts" header). One string, so a fragment is found wherever it lives.
import fs from 'node:fs';
import path from 'node:path';

const HAND_ORDNER = path.join(import.meta.dirname, '..', '..');
const MARKE = 'Moved unchanged out of hand.ts';
export const HAND_DATEIEN = [
  path.join(HAND_ORDNER, 'hand.ts'),
  ...fs.readdirSync(HAND_ORDNER).filter((n) => n.endsWith('.ts') && n !== 'hand.ts').sort().map((n) => path.join(HAND_ORDNER, n))
    .filter((f) => fs.readFileSync(f, 'utf8').slice(0, 600).includes(MARKE)),
];
export const handQuelle = () => HAND_DATEIEN.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
