// Sample player stage 2, strand S: the routes /sampler/instrument*, /sampler/instrumente. A folder of multisamples is built into an instrument (sampler/instrument.ts),
// listed, put on a new instrument track (one history step) and deleted while nothing plays it. Joined to the sampler routes in area.ts.
import type http from 'node:http';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { baueInstrument, instrumentLauf, instrumentName, instrumentText, liesInstrument, listeInstrumente, loescheInstrument, mitteVon, zeileVon, type Instrument } from '../../sampler/instrument.ts';
import { SchnittFehler, type Ordner } from '../../sampler/schnitt.ts';
import { alsAntwort, leseKoerper } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { SamplerOptionen } from './area.ts';
import { fundstellen, geraetAufSpur, inGebrauch, offenFuerSpur } from './tone_routes.ts';

type Quelle = 'andreas' | 'cypher';
const SPUR_BEATS = 2;   // length of the one note of an instrument track, in beats

const arg = (text: string): ProjFehler => new ProjFehler(400, 'argument_ungueltig', { text });
const nurSchluessel = (d: Record<string, unknown>, ...erlaubt: string[]): void => {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { text: `${k}: the request has no field of that name`, detail: k });
};

/** The instrument part every route shares: `instrument` (the row of the list plus the graph name) and its one-line `text`. */
export const instrumentKern = (i: Instrument, varianten: string[] = []): Record<string, unknown> => ({
  instrument: { ...zeileVon(i), graph: instrumentName(i.id), ...(varianten.length > 0 ? { varianten } : {}) }, text: instrumentText(i),
});

export function instrumentRouten(ctx: BereichKontext, opt: SamplerOptionen): Route[] {
  const ordner = (): Ordner => ({ ordner: opt.ordner, loops: opt.loops, module: opt.module });
  const gesperrt = (quelle: Quelle): void => { if (quelle === 'cypher' && ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt'); };
  const idArg = (v: unknown): string => {
    if (typeof v !== 'string' || v === '') throw arg('id: the id of an instrument expected');
    return v;
  };
  const gefunden = (id: string): Instrument => {
    const i = liesInstrument(id, ordner());
    if (!i) throw new SchnittFehler(404, 'instrument_unbekannt', `instrument ${id} does not exist`);
    return i;
  };
  /** Puts the stored instrument on a new track; the answer is the instrument part plus `rev`, `projekt`, `spur_id`. A refusal or failure leaves the store as it was when `neu`. */
  const aufSpur = async (i: Instrument, quelle: Quelle, varianten: string[], neu: boolean): Promise<Antwort> => {
    const weg = (): void => { if (neu) { try { loescheInstrument(i.id, ordner()); } catch { /* the refusal of the project is the error to report */ } } };
    try {
      const a = await geraetAufSpur(opt, { graph: instrumentName(i.id), name: i.name, ton: mitteVon(i), label: `Instrument ${i.name}`, laengeBeats: () => SPUR_BEATS }, quelle);
      if (a.code !== 200) { weg(); return a; }
      return { code: 200, j: { ...instrumentKern(i, varianten), ...(a.j as Record<string, unknown>) } };
    } catch (e) { weg(); throw e; }
  };

  const neu = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'wurzel', 'ordner', 'name', 'spur', 'release');
    if (typeof d.wurzel !== 'string' || d.wurzel === '') throw arg('wurzel: the name of a sample root expected');
    if (d.ordner !== undefined && typeof d.ordner !== 'string') throw arg('ordner: a path inside the root expected');
    if (d.spur !== undefined && typeof d.spur !== 'boolean') throw arg('spur: true or false expected');
    if (d.release !== undefined && typeof d.release !== 'boolean') throw arg('release: true or false expected');
    gesperrt(quelle);
    if (d.spur === true) offenFuerSpur(opt);                             // before anything is made
    const g = await baueInstrument({ wurzel: d.wurzel, ordner: (d.ordner as string | undefined) ?? '', name: d.name as string | undefined, release: d.release as boolean | undefined }, ordner());
    if (d.spur !== true) return { code: 200, j: instrumentKern(g.instrument, g.varianten) };
    return aufSpur(g.instrument, quelle, g.varianten, true);
  };

  const spur = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'id');
    const i = gefunden(idArg(d.id));
    gesperrt(quelle);
    offenFuerSpur(opt);
    return aufSpur(i, quelle, [], false);
  };

  const loeschen = (d: Record<string, unknown>, quelle: Quelle): Antwort => {
    nurSchluessel(d, 'id');
    const i = gefunden(idArg(d.id));
    gesperrt(quelle);
    const { imOffenen, stellen } = fundstellen(opt, instrumentName(i.id));
    if (stellen.length > 0) throw inGebrauch('the instrument is', stellen, imOffenen, 'instrument_in_gebrauch');
    loescheInstrument(i.id, ordner());
    return { code: 200, j: { ok: true } };
  };

  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = e instanceof SchnittFehler ? { code: e.code, j: { fehler: e.grund, text: e.text } } : alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  const post = (pfad: string, f: (d: Record<string, unknown>, q: Quelle) => Antwort | Promise<Antwort>): Route => ({
    methode: 'POST', pfad, schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                       // read at the start of the request
      await antworte(r, async () => f(await leseKoerper(q), quelle));
    },
  });
  return [
    post('/sampler/instrument', neu),
    { methode: 'GET', pfad: '/sampler/instrument/lauf', schutz: 'offen', handler: async (_q, r) => antworte(r, () => ({ code: 200, j: instrumentLauf() })) },
    { methode: 'GET', pfad: '/sampler/instrumente', schutz: 'offen', handler: async (_q, r) => antworte(r, () => ({ code: 200, j: { instrumente: listeInstrumente(ordner()).map(zeileVon) } })) },
    post('/sampler/instrument/spur', spur),
    post('/sampler/instrument/loeschen', loeschen),
  ];
}
