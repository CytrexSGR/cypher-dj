// Sampler C task 4: the routes /sampler/ton* (make a tone, read it, change its root, delete it), TO TONE as one history step on a new NOTE track (C-D8), the
// playback reload after a root change (C-D9) and the delete hook of a cut (C-D7). Joined to the sampler routes by one line in area.ts.
import type http from 'node:http';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { liesModul, listeModule } from '../../project/module_storage.ts';
import type { Projekt } from '../../project/model.ts';
import { MAX_WERKBANK_SPUREN } from '../../project/werkbank.ts';
import { liesSchnitt, SchnittFehler, type Ordner } from '../../sampler/schnitt.ts';
import { legeTon, listeToene, liesTonVonGraph, loescheTon, loescheToeneVon, setzeGrund, tonText, type Ton } from '../../sampler/tone.ts';
import { alsAntwort, leseKoerper } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import { nutzer, type Fund, type SamplerOptionen } from './area.ts';

type Quelle = 'andreas' | 'cypher';
const NAME_MAX = 80;            // the longest track name and history label of the project
const FUNDSTELLEN_MAX = 5;
const SPUR_BEATS = { min: 0.25, max: 4 };   // length of the one note of a tone track, in beats

const arg = (text: string): ProjFehler => new ProjFehler(400, 'argument_ungueltig', { text });
const nurSchluessel = (d: Record<string, unknown>, ...erlaubt: string[]): void => {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { text: `${k}: the request has no field of that name`, detail: k });
};
const istTonSpur = (s: { geraet?: { art?: string; name?: string; graph?: string } }, graph: string): boolean => s.geraet?.art === 'intern' && s.geraet.name === 'bk' && s.geraet.graph === graph;

type Offen = NonNullable<ReturnType<SamplerOptionen['zugang']['offen']>>;
/** The checks of TO TONE that need no tone: a project is open, it is a workbench module and has a free instrument slot (the codes of SLICE TO TRACK). */
export function offenFuerSpur(opt: SamplerOptionen): Offen {
  const o = opt.zugang.offen();
  if (!o) throw new ProjFehler(409, 'kein_projekt');
  if (!o.projekt.werkbank) throw new ProjFehler(409, 'kein_werkbank', { text: 'the open project is not a workbench module' });
  if (o.projekt.spuren.filter((s) => s.art === 'instrument').length >= MAX_WERKBANK_SPUREN) {
    throw new ProjFehler(409, 'werkbank_voll', { text: `a module holds at most ${MAX_WERKBANK_SPUREN} instrument tracks` });
  }
  return o;
}
// " 2", " 3" ... until the name is free among the instrument tracks (ignoring case, as the command does); a copy of the rule of SLICE TO TRACK
const freierName = (p: Projekt, name: string): string => {
  const belegt = new Set(p.spuren.filter((s) => s.art === 'instrument').map((s) => s.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const rest = n === 1 ? '' : ` ${n}`;
    const z = `${name.slice(0, NAME_MAX - rest.length)}${rest}`;
    if (!belegt.has(z.toLowerCase())) return z;
  }
};
/** The answer part every tone route shares: the tone, its one-line text and (when the cut has one) the key the page names beside a root taken from it. */
export function tonKern(t: Ton, o: Ordner): Record<string, unknown> {
  const k = liesSchnitt(t.schnitt_id, o)?.tonart;
  return { ton: t, text: tonText(t, k), ...(k !== undefined ? { tonart: k } : {}) };
}
/** Puts a tone on a new NOTE track of the open workbench module: one note at the root, one history step. A refusal or failure removes the tone again
 *  (the refusal of the project is the error to report). The answer is the tone part plus `rev`, `projekt` and `spur_id`. */
export async function tonAufSpur(opt: SamplerOptionen, ordner: Ordner, t: Ton, quelle: Quelle): Promise<Antwort> {
  const weg = (): void => { try { loescheTon(t.graph, ordner); } catch { /* the refusal of the project is the error to report */ } };
  try {
    const a = await geraetAufSpur(opt, { graph: t.graph, name: t.name, ton: t.grund, label: `Tone ${t.name}`,
      laengeBeats: (tempo) => Math.min(SPUR_BEATS.max, Math.max(SPUR_BEATS.min, Math.round((t.b - t.a) / 48000 * tempo / 60 * 4) / 4)) }, quelle);
    if (a.code !== 200) { weg(); return a; }
    return { code: 200, j: { ...tonKern(t, ordner), ...(a.j as Record<string, unknown>) } };
  } catch (e) { weg(); throw e; }
}

/** Puts a device graph on a new NOTE track of the open workbench module: one note at `ton`, `laengeBeats(tempo)` beats long, one history step. Returns the
 *  refusal of the project as it is, or `{rev, projekt, spur_id}`; removing what was made for the track is the caller's job. */
export async function geraetAufSpur(opt: SamplerOptionen, g: { graph: string; name: string; ton: number; label: string; laengeBeats: (tempoBpm: number) => number }, quelle: Quelle): Promise<Antwort> {
  const o = offenFuerSpur(opt);                                          // the project may have changed while the device was written
  const befehl = { befehl: 'werkbank_spur_neu', name: freierName(o.projekt, g.name), loop_beats: 4,
    noten: [{ beat: 0, laenge: g.laengeBeats(o.projekt.tempo_bpm), ton: g.ton, vel: 100 }], geraet: { art: 'intern', name: 'bk', graph: g.graph, parameter: {} } };
  const a = await opt.sitzung.aendern({ rev: o.projekt.rev, label: g.label.slice(0, NAME_MAX), befehle: [befehl] }, quelle);
  if (a.code !== 200) return a;
  const j = a.j as { rev: number; projekt: Projekt };
  const neueSpur = [...j.projekt.spuren].reverse().find((x) => istTonSpur(x, g.graph));
  return { code: 200, j: { rev: j.rev, projekt: j.projekt, spur_id: neueSpur?.id ?? null } };
}

/** Where the graph is played: the open project (live state), every other stored project, the module store of the live set. Same search as A1's cut delete. */
export function fundstellen(opt: SamplerOptionen, graph: string): { imOffenen: Fund[]; stellen: string[] } {
  const o = opt.zugang.offen();
  const imOffenen = o ? nutzer(o.projekt, graph) : [];
  const stellen = imOffenen.map((f) => `${f.wo} of the open project "${o!.projekt.name}"`);
  for (const g of opt.sitzung.gespeicherte()) {
    if (g.slug === o?.slug) continue;                                    // the open project was checked above, from its live state
    if (nutzer(g.projekt, graph).length > 0) stellen.push(`project "${g.projekt.name}"`);
  }
  for (const e of listeModule({ basis: opt.module })) {
    const m = liesModul(e.id, opt.module);
    if (m && nutzer(m, graph).length > 0) stellen.push(`module "${e.titel}"`);
  }
  return { imOffenen, stellen };
}
export const inGebrauch = (was: string, stellen: string[], imOffenen: Fund[], code = 'ton_in_gebrauch'): ProjFehler => {
  const gezeigt = stellen.slice(0, FUNDSTELLEN_MAX).join(', '), rest = stellen.length - FUNDSTELLEN_MAX;
  return new ProjFehler(409, code, { text: `${was} in use by ${gezeigt}${rest > 0 ? ` and ${rest} more` : ''}; remove it there first`,
    spuren: [...new Set(imOffenen.map((f) => f.strang))], fundstellen: stellen });
};

/** The hook of the cut delete (C-D7): refuses with 409 `ton_in_gebrauch` before anything is removed when any tone of the cut is played by the open project, a
 *  stored project or a module of the store; otherwise removes the graph, panel and tone file of every tone of the cut. */
export function loescheToeneDesSchnitts(id: string, o: Ordner, opt: SamplerOptionen): void {
  const toene = listeToene(id, o);
  if (toene.length === 0) return;
  const imOffenen: Fund[] = [], stellen: string[] = [];
  for (const t of toene) {
    const f = fundstellen(opt, t.graph);
    imOffenen.push(...f.imOffenen);
    stellen.push(...f.stellen);
  }
  if (stellen.length > 0) throw inGebrauch('a tone of the cut is', [...new Set(stellen)], imOffenen);
  loescheToeneVon(id, o);
}

export function tonRouten(ctx: BereichKontext, opt: SamplerOptionen): Route[] {
  const ordner = (): Ordner => ({ ordner: opt.ordner, loops: opt.loops, module: opt.module });
  const gesperrt = (quelle: Quelle): void => { if (quelle === 'cypher' && ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt'); };
  const offen = (): NonNullable<ReturnType<typeof opt.zugang.offen>> => {
    const o = opt.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    return o;
  };
  const graphArg = (g: unknown): string => {
    if (typeof g !== 'string' || g === '') throw arg('graph: the name of a tone graph expected');
    return g;
  };
  const kern = (t: Ton): Record<string, unknown> => tonKern(t, ordner());

  const neu = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'id', 'von', 'bis', 'grund', 'name', 'spur');
    if (typeof d.id !== 'string' || d.id === '') throw arg('id: the id of a cut expected');
    if (d.spur !== undefined && typeof d.spur !== 'boolean') throw arg('spur: true or false expected');
    gesperrt(quelle);
    if (d.spur === true) offenFuerSpur(opt);                             // before anything is made
    const t = legeTon({ schnitt_id: d.id, von: d.von as number, bis: d.bis as number | undefined, grund: d.grund as number | undefined, name: d.name as string | undefined }, ordner());
    if (d.spur !== true) return { code: 200, j: kern(t) };
    return tonAufSpur(opt, ordner(), t, quelle);
  };

  const lies = (url: URL): Antwort => {
    const t = liesTonVonGraph(graphArg(url.searchParams.get('graph')), ordner());
    if (!t) throw new SchnittFehler(404, 'ton_unbekannt', `tone ${url.searchParams.get('graph')} does not exist`);
    return { code: 200, j: kern(t) };
  };

  const grund = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'graph', 'grund');
    const graph = graphArg(d.graph);
    gesperrt(quelle);
    const t = setzeGrund(graph, d.grund as number, ordner());
    // a rewritten graph reaches a playing track only when the playback is loaded again (C-F3); no history step, the notes of the track stay
    const o = opt.zugang.offen();
    const spielt = o !== null && o !== undefined && nutzer(o.projekt, graph).length > 0;
    // while a freeze, export or recording holds the load lock the load is only remembered and follows at the release (`neu_laden_aufgeschoben`)
    let neuGeladen = false, aufgeschoben = false, fehler: string | undefined;
    if (spielt) {
      try { neuGeladen = await opt.sitzung.ladeLiveNeuFrei(); aufgeschoben = !neuGeladen; } catch (e) { fehler = `the playback could not be reloaded: ${(e as Error).message}`; }
    }
    return { code: 200, j: { ...kern(t), neu_geladen: neuGeladen, ...(aufgeschoben ? { neu_laden_aufgeschoben: true } : {}), ...(fehler !== undefined ? { neu_laden_fehler: fehler } : {}) } };
  };

  const loeschen = (d: Record<string, unknown>, quelle: Quelle): Antwort => {
    nurSchluessel(d, 'graph');
    const graph = graphArg(d.graph);
    gesperrt(quelle);
    const t = liesTonVonGraph(graph, ordner());
    if (!t) throw new SchnittFehler(404, 'ton_unbekannt', `tone ${graph} does not exist`);
    const { imOffenen, stellen } = fundstellen(opt, graph);
    if (stellen.length > 0) throw inGebrauch('the tone is', stellen, imOffenen);
    loescheTon(graph, ordner());
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
    post('/sampler/ton', neu),
    { methode: 'GET', pfad: '/sampler/ton', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => lies(url)) },
    post('/sampler/ton/grund', grund),
    post('/sampler/ton/loeschen', loeschen),
  ];
}
