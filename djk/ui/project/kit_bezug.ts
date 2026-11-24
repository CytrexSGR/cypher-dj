// Which kits a project names (browser plan 5). Pure, no I/O: a kit is named by a device { art: 'intern', name: 'kit', kit: <name> } on an instrument
// track or on a rack member (project/model.ts KitGeraet). The walk looks at every object of the project, so a device in a place added later is found too.

const istKitGeraet = (x: unknown): x is { art: 'intern'; name: 'kit'; kit: string } =>
  typeof x === 'object' && x !== null && (x as { art?: unknown }).art === 'intern' && (x as { name?: unknown }).name === 'kit' &&
    typeof (x as { kit?: unknown }).kit === 'string';

function geh(x: unknown, f: (g: { kit: string }) => void): void {
  if (Array.isArray(x)) { for (const e of x) geh(e, f); return; }
  if (typeof x !== 'object' || x === null) return;
  if (istKitGeraet(x)) f(x);
  for (const v of Object.values(x)) geh(v, f);
}

/** Unique kit names the project uses, in order of first appearance. */
export function kitNamenImProjekt(projekt: unknown): string[] {
  const namen: string[] = [];
  geh(projekt, (g) => { if (!namen.includes(g.kit)) namen.push(g.kit); });
  return namen;
}

/** How many devices of the project name the kit. */
export function zaehleKitBezuege(projekt: unknown, name: string): number {
  let n = 0;
  geh(projekt, (g) => { if (g.kit === name) n++; });
  return n;
}

/** Rewrites every reference by `karte` (old name to new name) in one pass, so a chain a to b, b to c never moves a reference twice; returns the count. */
export function schreibeKitBezuegeKarte(projekt: unknown, karte: ReadonlyMap<string, string>): number {
  let n = 0;
  geh(projekt, (g) => { const neu = karte.get(g.kit); if (neu !== undefined) { g.kit = neu; n++; } });
  return n;
}

/** Rewrites every reference `alt` to `neu` in place; returns the count. */
export function schreibeKitBezuege(projekt: unknown, alt: string, neu: string): number {
  let n = 0;
  geh(projekt, (g) => { if (g.kit === alt) { g.kit = neu; n++; } });
  return n;
}
