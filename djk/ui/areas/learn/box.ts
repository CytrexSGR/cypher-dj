// The box (panel section) a Baukasten knob sits in, so a controller shows the same colour as the device window (public/device_window.js CTL_FARBEN).
// boxIndexe is the pure part (panel -> {knob number: section index}); boxVon reads the panel file of the graph behind a knob path, cached by file mtime.
import fs from 'node:fs';
import path from 'node:path';
import { graphenOrdner, ladePanel, normalisierePanel, panelOrdner, GRAPH_NAME } from '../../graphs.ts';
import type { BereichKontext } from '../../http/router.ts';
import { graphUndKnopf } from './beschriftung.ts';

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The section ids in the order the page builds them (public/panel.js): the flattened layout.rows, then the sections no row names in file order; without rows the order of `sections`. */
function sektionsFolge(panel: Record<string, unknown>): Record<string, unknown>[] {
  const sek = (Array.isArray(panel.sections) ? panel.sections : []).filter(istObjekt);
  const rows = istObjekt(panel.layout) && Array.isArray(panel.layout.rows) ? panel.layout.rows : null;
  if (!rows) return sek;
  const nachId = new Map(sek.map((s) => [s.id, s]));
  const benannt = new Set<unknown>(rows.flatMap((r) => (Array.isArray(r) ? r : [])));
  const folge = rows.flatMap((r) => (Array.isArray(r) ? r : [])).map((id) => nachId.get(id)).filter((s): s is Record<string, unknown> => !!s);
  return [...folge, ...sek.filter((s) => !benannt.has(s.id))];
}

/** {knob number: 0-based index of the section whose control binds knob k<number>} (bind.param, or bind.x.param / bind.y.param of an xy control); the first section wins. Pure. */
export function boxIndexe(panelRoh: unknown): Record<string, number> {
  const aus: Record<string, number> = {};
  const panel = normalisierePanel(panelRoh);
  if (!istObjekt(panel)) return aus;
  const binde = (b: unknown, i: number): void => {
    const param = istObjekt(b) ? b.param : undefined;
    const m = typeof param === 'string' ? /^k([1-9][0-9]*)$/.exec(param) : null;
    if (m && !(m[1] in aus)) aus[m[1]] = i;
  };
  sektionsFolge(panel).forEach((s, i) => {
    for (const c of Array.isArray(s.controls) ? s.controls : []) {
      if (!istObjekt(c) || !istObjekt(c.bind)) continue;
      if (c.type === 'xy') { binde(c.bind.x, i); binde(c.bind.y, i); } else binde(c.bind, i);
    }
  });
  return aus;
}

const zwischen = new Map<string, { stand: string; boxen: Record<string, number> }>();
const mtime = (datei: string): number => { try { return fs.statSync(datei).mtimeMs; } catch { return -1; } };

/** boxIndexe of the panel of graph `name`, cached by the mtimes of the graph and panel files (GET /lernen is polled every two seconds). {} without a valid panel. */
export function panelBoxen(name: string, ordner: string = graphenOrdner()): Record<string, number> {
  if (!GRAPH_NAME.test(name)) return {};
  const stand = `${mtime(path.join(ordner, `${name}.json`))}:${mtime(path.join(panelOrdner(ordner), `${name}.json`))}`;
  const schluessel = `${ordner}\0${name}`;
  const alt = zwischen.get(schluessel);
  if (alt && alt.stand === stand) return alt.boxen;
  const boxen = boxIndexe(ladePanel(name, ordner)?.panel);
  zwischen.set(schluessel, { stand, boxen });
  return boxen;
}

/** The box index of the knob a path like erz/5/bk/3 or spur/2/bk/3 drives, or undefined (not a graph knob, no panel, knob on no control). */
export function boxVon(ctx: Pick<BereichKontext, 'baukasten' | 'projekt'>, pfad: string, ordner?: string): number | undefined {
  const g = graphUndKnopf(ctx, pfad);
  return g ? panelBoxen(g.graph, ordner)[g.knopf] : undefined;
}
