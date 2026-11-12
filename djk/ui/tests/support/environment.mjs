// Clean environment for processes a test spawns: HOME and the XDG folders inside `dir`, no CYPHERDJ_* variable, PATH and the
// cargo variables kept (rustup fails with a foreign HOME unless CARGO_HOME and RUSTUP_HOME point at the real ones).
// Same rule as djk/testumgebung.py for the Python tests.
import os from 'node:os';
import path from 'node:path';

const BEHALTEN = ['PATH', 'CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR'];

/** @param {string} dir @returns {NodeJS.ProcessEnv} */
export function saubereUmgebung(dir) {
  const home = path.join(dir, 'home');
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
  };
  for (const n of BEHALTEN) if (process.env[n] !== undefined) env[n] = process.env[n];
  env.CARGO_HOME ??= path.join(os.homedir(), '.cargo');
  env.RUSTUP_HOME ??= path.join(os.homedir(), '.rustup');
  return env;
}
