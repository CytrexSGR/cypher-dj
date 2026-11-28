// The number of tools in djk/hand/hand.ts, counted in the source (one entry per line starting with "  { name: '").
// Every test that pins "the tool count" compares against this instead of a literal, so a new tool does not break ten files.
// The documented number (both AUFRUF.md files) is still checked against it for real in hand_presets.test.mjs (AK-B16-8).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handQuelle } from './hand_source.mjs';

export const HAND_QUELLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'hand.ts');
export const WERKZEUGE_IM_CODE = handQuelle().split('\n').filter((z) => z.startsWith("  { name: '")).length;
export const PROJ_WERKZEUGE_IM_CODE = handQuelle().split('\n').filter((z) => z.startsWith("  { name: 'proj_")).length;
