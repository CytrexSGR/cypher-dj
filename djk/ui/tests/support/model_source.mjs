// The source text of the project model for tests that read constants out of it: model.ts only re-exports since the split,
// the definitions sit in project/modell_*.ts. Joined in a fixed order (model.ts first, then the siblings by name).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJEKT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'project');

export function modellQuelle() {
  const namen = fs.readdirSync(PROJEKT).filter((n) => /^modell(_[a-z_]+)?\.ts$/.test(n)).sort((a, b) => (a === 'model.ts' ? -1 : b === 'model.ts' ? 1 : a.localeCompare(b)));
  return namen.map((n) => fs.readFileSync(path.join(PROJEKT, n), 'utf8')).join('\n');
}
