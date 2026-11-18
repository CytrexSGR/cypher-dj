// The command modules load in any order: commands_helpers.ts holds the registry and must not reach commands.ts through one of its own imports
// (routing_rules.ts once imported BefehlFehler from commands.ts; entering through commands_helpers.ts then hit the registry before it existed).
// Each case runs in a fresh process, because the module cache of this process already holds one order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UI = fileURLToPath(new URL('..', import.meta.url));
const lade = (erst) => execFileSync(process.execPath, ['-e',
  `const a = await import('./project/${erst}'); const b = await import('./project/commands.ts');` +
  `console.log(Object.keys(b.PRO_BEFEHL).length, a.PRO_BEFEHL === undefined || a.PRO_BEFEHL === b.PRO_BEFEHL);`,
  '--input-type=module'], { cwd: UI, encoding: 'utf8' }).trim();

for (const erst of ['commands_helpers.ts', 'routing_rules.ts', 'commands_clip.ts', 'commands.ts']) {
  test(`entering through ${erst} loads the full command table`, () => {
    const [zahl, gleich] = lade(erst).split(' ');
    assert.ok(Number(zahl) >= 82, `commands: ${zahl}`);
    assert.equal(gleich, 'true');
  });
}
