// Cypher Space: POST /sampler/space_ir {wurzel, rel}. The file of a sample root becomes the impulse response of a NEW copy of the `fx-space` graph (sampler/space_ir.ts);
// the answer is {graph, titel}. The open project is not touched: the page swaps the stage to the copy (one history step of its own).
import fs from 'node:fs';
import type http from 'node:http';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { graphenOrdner } from '../../graphs.ts';
import { dateiName, dekodiereDateiAsync, loeseAuf } from '../../sampler/file.ts';
import { SchnittFehler, type Ordner } from '../../sampler/schnitt.ts';
import { bereiteIrVor, IR_TITEL_MAX, neuerSpaceName, schreibeIr, schreibeSpace } from '../../sampler/space_ir.ts';
import { alsAntwort, leseKoerper } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { SamplerOptionen } from './area.ts';

/** Seconds decoded: the 2 s of the response plus room for a leading silence that is cut off. */
const DEKODIERT_S = 12;

const arg = (text: string): ProjFehler => new ProjFehler(400, 'argument_ungueltig', { text });
const textArg = (v: unknown, was: string): string => {
  if (typeof v !== 'string' || v === '') throw arg(`${was}: a text expected`);
  return v;
};

export function spaceIrRouten(ctx: BereichKontext, opt: SamplerOptionen): Route[] {
  const ordner = (): Ordner => ({ ordner: opt.ordner, loops: opt.loops, module: opt.module });
  const neu = async (d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<Antwort> => {
    for (const k of Object.keys(d)) if (k !== 'wurzel' && k !== 'rel') throw new ProjFehler(400, 'argument_unbekannt', { text: `${k}: the request has no field of that name`, detail: k });
    const wurzel = textArg(d.wurzel, 'wurzel'), rel = textArg(d.rel, 'rel');
    if (quelle === 'cypher' && ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    const pfad = loeseAuf(wurzel, rel, ordner());
    let datei = false;
    try { datei = fs.statSync(pfad).isFile(); } catch { /* gone */ }
    if (!datei) throw new SchnittFehler(404, 'quelle_unbekannt', `${rel} is not a file`);
    const ir = bereiteIrVor(await dekodiereDateiAsync(pfad, DEKODIERT_S));   // refusals: format_falsch, ir_zu_kurz
    const titel = dateiName(pfad).slice(0, IR_TITEL_MAX).trim() || 'file';
    const bk = graphenOrdner();
    const f = schreibeIr(ir, bk);
    try {
      const name = neuerSpaceName(bk);
      schreibeSpace(name, f, titel, bk);
      return { code: 200, j: { graph: name, titel } };
    } catch (e) { fs.rmSync(`${bk}/samples/${f}`, { force: true }); throw e; }
  };
  const antworte = async (r: http.ServerResponse, f: () => Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = e instanceof SchnittFehler ? { code: e.code, j: { fehler: e.grund, text: e.text } } : alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  return [{
    methode: 'POST', pfad: '/sampler/space_ir', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                           // read at the start of the request
      await antworte(r, async () => neu(await leseKoerper(q), quelle));
    },
  }];
}
