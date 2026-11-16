// Sample player stage 1: the routes /sampler/dateien, /sampler/datei/hoer and /sampler/datei/spur. Files of the sample roots (sampler/file.ts) are listed,
// searched, heard in the browser and made into a cut ("whole" method), a tone and a NOTE track in one history step. Joined to the sampler routes in area.ts.
import type http from 'node:http';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { dateiName, grundVonDatei, listeOrdner, listeWurzeln, loeseAuf, sucheDateien, vorhoerWav, wurzelEcht } from '../../sampler/file.ts';
import { ordnerInstrumentFeld } from '../../sampler/instrument.ts';
import { ladeSchnittAudio, legeSchnitt, loescheSchnitt, SchnittFehler, type Ordner } from '../../sampler/schnitt.ts';
import { legeTon } from '../../sampler/tone.ts';
import { alsAntwort, leseKoerper } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { SamplerOptionen } from './area.ts';
import { offenFuerSpur, tonAufSpur } from './tone_routes.ts';
import fs from 'node:fs';

type Quelle = 'andreas' | 'cypher';
const NAME_MAX = 60;

const arg = (text: string): ProjFehler => new ProjFehler(400, 'argument_ungueltig', { text });
const nurSchluessel = (d: Record<string, unknown>, ...erlaubt: string[]): void => {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { text: `${k}: the request has no field of that name`, detail: k });
};

export function dateiRouten(ctx: BereichKontext, opt: SamplerOptionen): Route[] {
  const ordner = (): Ordner => ({ ordner: opt.ordner, loops: opt.loops, module: opt.module });
  const gesperrt = (quelle: Quelle): void => { if (quelle === 'cypher' && ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt'); };

  const dateien = (url: URL): Antwort => {
    const w = url.searchParams.get('wurzel');
    if (w === null || w === '') return { code: 200, j: { wurzeln: listeWurzeln(ordner()) } };
    wurzelEcht(w, ordner());
    const rel = url.searchParams.get('ordner') ?? '';
    const suche = url.searchParams.get('suche');
    if (suche !== null && suche.trim() !== '') {
      const r = sucheDateien(w, rel, suche, ordner());
      return { code: 200, j: { wurzel: w, ordner: r.ordner, suche, ordner_liste: [], dateien: r.dateien, ...(r.mehr ? { mehr: true } : {}) } };
    }
    const l = listeOrdner(w, rel, ordner());
    const instrument = ordnerInstrumentFeld(w, l.ordner, l.dateien, ordner());   // stage 2: the folder reads as an instrument; 2b: release and loop counts
    return { code: 200, j: { wurzel: w, ...l, ...(instrument ? { instrument } : {}) } };
  };

  const stringArg = (v: unknown, was: string): string => {
    if (typeof v !== 'string' || v === '') throw arg(`${was}: a text expected`);
    return v;
  };

  const spur = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'wurzel', 'rel', 'grund', 'name');
    const wurzel = stringArg(d.wurzel, 'wurzel'), rel = stringArg(d.rel, 'rel');
    if (d.grund !== undefined && (typeof d.grund !== 'number' || !Number.isInteger(d.grund))) throw arg('grund: a MIDI note, a whole number, expected');
    if (d.name !== undefined && (typeof d.name !== 'string' || d.name.trim() === '' || d.name.trim().length > NAME_MAX)) throw arg(`name: a text of 1..${NAME_MAX} characters expected`);
    gesperrt(quelle);
    const o0 = offenFuerSpur(opt);                                       // before anything is made
    const o: Ordner = { ...ordner(), tempo: o0.projekt.tempo_bpm };
    const s = legeSchnitt({ quelle: { art: 'datei', ref: `${wurzel}/${rel}` }, name: (d.name as string | undefined)?.trim(), methode: 'ganz' }, o);
    const weg = (): void => { try { loescheSchnitt(s.id, ordner()); } catch { /* the original error is the one to report */ } };
    try {
      const g = d.grund === undefined ? grundVonDatei(ladeSchnittAudio(s, o), rel.split('/').pop() ?? rel) : { note: d.grund as number, herkunft: 'angabe' as const };
      const t = legeTon({ schnitt_id: s.id, von: 0, grund: g.note, name: s.name }, ordner());
      const a = await tonAufSpur(opt, ordner(), t, quelle);              // removes the tone on a refusal
      if (a.code !== 200) { weg(); return a; }
      return { code: 200, j: { ...(a.j as Record<string, unknown>), schnitt_id: s.id, grund_herkunft: g.herkunft } };
    } catch (e) { weg(); throw e; }
  };

  const hoer = (r: http.ServerResponse, url: URL): void => {
    const pfad = loeseAuf(url.searchParams.get('wurzel'), url.searchParams.get('rel'), ordner());
    if (!fs.statSync(pfad).isFile()) throw new SchnittFehler(404, 'quelle_unbekannt', `${dateiName(pfad)} is not a file`);
    const wav = vorhoerWav(pfad);
    r.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' });
    r.end(wav);
  };

  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = e instanceof SchnittFehler ? { code: e.code, j: { fehler: e.grund, text: e.text } } : alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  return [
    { methode: 'GET', pfad: '/sampler/dateien', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => dateien(url)) },
    { methode: 'GET', pfad: '/sampler/datei/hoer', schutz: 'offen', handler: async (_q, r, url) => {
      try { hoer(r, url); } catch (e) { const x = e instanceof SchnittFehler ? { code: e.code, j: { fehler: e.grund, text: e.text } } : alsAntwort(e, ctx); json(r, x.code, x.j); }
    } },
    { methode: 'POST', pfad: '/sampler/datei/spur', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                       // read at the start of the request
      await antworte(r, async () => spur(await leseKoerper(q), quelle));
    } },
  ];
}
