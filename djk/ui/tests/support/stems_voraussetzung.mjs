// Preconditions of the tests that run the real stem job (werkstatt.stems in a child process): a NVIDIA GPU and a Python that can
// import the werkstatt and torch. A CYPHERDJ_PYTHON that points to a venv without the werkstatt dependencies made these tests wait for a child
// that died at once (they hung until the timeout). Now they are skipped with the reason.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pythonVorgabe } from '../../server.ts';
import { REPO_PFADE } from '../../paths.ts';

const ohneGpu = !fs.existsSync('/dev/nvidia0') && 'no NVIDIA GPU: stems run on the GPU only';

export function pythonKannStems(python = pythonVorgabe(), cwd = REPO_PFADE.werkstatt) {
  const r = spawnSync(python, ['-c', 'import werkstatt.stems, torch'], { cwd, stdio: 'ignore', timeout: 30000 });
  return r.status === 0;
}

const ohnePython = pythonKannStems() ? false : `${pythonVorgabe()} cannot import werkstatt.stems and torch (CYPHERDJ_PYTHON without the werkstatt dependencies, or torch not installed: it is not in requirements.txt)`;

// string (the reason) or false; usable as { skip: OHNE_GPU }
export const OHNE_GPU = ohneGpu || ohnePython;
// only the Python part, for tests that need the child but no GPU
export const OHNE_STEMS_PYTHON = ohnePython;
