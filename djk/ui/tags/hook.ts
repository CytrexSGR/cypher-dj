// Starts the tags measuring hook (python -m bibliothek.tags_measure) after the last catalogue build of a run (plan 7 task 12).
// Out of process, niced and detached; one child at a time here, the lock file of the hook is the second guard. A failure is logged, never thrown.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface TagsHookOptionen {
  python: string; cwd: string; env?: NodeJS.ProcessEnv; katalog: string; tags: string;
  log?: (zeile: string) => void;
  /** Test seam: starts the command line. */
  start?: (argv: string[], o: SpawnOptions) => ChildProcess;
}

export function tagsHook(o: TagsHookOptionen): () => void {
  let kind: ChildProcess | null = null;
  const start = o.start ?? ((argv: string[], so: SpawnOptions) => spawn(argv[0]!, argv.slice(1), so));
  return () => {
    if (kind) return;
    const argv = ['ionice', '-c3', 'nice', '-n', '19', o.python, '-m', 'bibliothek.tags_measure', '--katalog', o.katalog, '--tags', o.tags];
    try {
      const k = start(argv, { cwd: o.cwd, env: { ...process.env, ...(o.env ?? {}) }, stdio: 'ignore', detached: true });
      kind = k;
      const frei = (): void => { if (kind === k) kind = null; };
      k.on('exit', frei);
      k.on('error', (e: Error) => { o.log?.(`tags hook: ${e.message}`); frei(); });
      k.unref?.();
    } catch (e) { kind = null; o.log?.(`tags hook: ${(e as Error).message}`); }
  };
}
