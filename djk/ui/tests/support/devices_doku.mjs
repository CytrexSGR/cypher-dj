// The device documents (docs/presets/devices/GERAET-*.md) are not part of the public export; the tests that check the register against
// them are skipped with the reason where the folder is absent.
import fs from 'node:fs';
import { REPO } from '../../paths.ts';
import { pfadeVon } from '../../devices_parameter.ts';

export const OHNE_DOKU = fs.existsSync(pfadeVon(REPO).doku) ? false : 'needs the device documents (docs/presets/devices), which are not part of the public export';
