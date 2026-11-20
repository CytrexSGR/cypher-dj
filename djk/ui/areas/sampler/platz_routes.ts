// Tracker task 21: the slot bank routes of the `amiga` device (GET /sampler/plaetze, POST /sampler/platz, /sampler/platz/aendern, /sampler/platz/leeren).
// A track whose device has a slot role (register `rollen.slot`) and is the graph `amiga` or a bank `amiga-<6 hex>`: EVERY write makes a NEW bank graph (copy
// of the old one with the change) and switches the tracks that played the old bank in ONE history step (`spur_aendern`). A bank file is never changed after it
// was made: project copies, deck sections and undo keep the old bank. Slot files are written in the Amiga form (sampler/slots.ts): low rate, 8 bit, unless the request says `roh`.
import type http from 'node:http';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { geraetFx } from '../../devices_parameter.ts';
import { graphenOrdner } from '../../graphs.ts';
import { ladeDatei } from '../../sampler/file.ts';
import {
  BANK_NAME, FEIN_MAX, FEIN_MIN, GRUND_MAX, GRUND_MIN, GRUND_VORGABE, PLATZ_MAX, PLATZ_NAME_MAX, RATE_MAX, RATE_MIN, RATE_VORGABE,
  entferneSamples, frameZahl, istLeer, leerPlatz, leseGraphDatei, neuerBankName, platzEintrag, plaetzeVon, schreibeNeueBank, schreibeSample, sichereLeerDatei, wandleAmiga,
  type PlatzDaten,
} from '../../sampler/slots.ts';
import { SchnittFehler, type Ordner } from '../../sampler/schnitt.ts';
import { alsAntwort, leseKoerper } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { SamplerOptionen } from './area.ts';

type Quelle = 'andreas' | 'cypher';

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** The history label of a field change: one field is named, several are "settings". */
const aendernLabel = (w: Partial<PlatzDaten>): string => {
  const k = Object.keys(w);
  if (k.length !== 1) return 'settings';
  const [f] = k;
  if (f === 'schleife') return `loop ${w.schleife === 1 ? 'on' : 'off'}`;
  if (f === 'name') return `name ${w.name}`;
  if (f === 's_von') return `loop start ${w.s_von}`;
  if (f === 's_laenge') return `loop length ${w.s_laenge}`;
  if (f === 'pegel') return `level ${Math.round((w.pegel ?? 1) * 100)}%`;
  if (f === 'fein') return `finetune ${w.fein}`;
  return `root ${w.grund}`;
};

const arg = (text: string): ProjFehler => new ProjFehler(400, 'argument_ungueltig', { text });
const nurSchluessel = (d: Record<string, unknown>, ...erlaubt: string[]): void => {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { text: `${k}: the request has no field of that name`, detail: k });
};
const ganz = (v: unknown, von: number, bis: number, was: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < von || v > bis) throw arg(`${was}: a whole number ${von}..${bis} expected`);
  return v;
};
const zahl = (v: unknown, von: number, bis: number, was: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < von || v > bis) throw arg(`${was}: a number ${von}..${bis} expected`);
  return v;
};
const text = (v: unknown, was: string): string => {
  if (typeof v !== 'string' || v.trim() === '' || v.trim().length > PLATZ_NAME_MAX) throw arg(`${was}: a text of 1..${PLATZ_NAME_MAX} characters expected`);
  return v.trim();
};
const textArg = (v: unknown, was: string): string => {
  if (typeof v !== 'string' || v === '') throw arg(`${was}: a text expected`);
  return v;
};

/** The row of a slot as GET /sampler/plaetze shows it. */
export function platzZeile(nr: number, p: PlatzDaten): Record<string, unknown> {
  return { nr, name: p.name ?? '', frames: frameZahl(p.datei), rate: p.rate, schleife: p.schleife ?? 0, s_von: p.s_von ?? 0, s_laenge: p.s_laenge ?? 0,
    pegel: p.pegel ?? 1, fein: p.fein ?? 0, grund: p.grund, ...(istLeer(p) ? { leer: true } : {}) };
}

export function platzLogik(ctx: BereichKontext, opt: SamplerOptionen) {
  const ordner = (): Ordner => ({ ordner: opt.ordner, loops: opt.loops, module: opt.module });
  const gesperrt = (quelle: Quelle): void => { if (quelle === 'cypher' && ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt'); };

  /** The track, its device graph and its slots; refusals: no project, unknown track, a device without a slot bank. */
  const spurMitBank = (spurId: unknown) => {
    const id = textArg(spurId, 'spur_id');
    const o = opt.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    const sp = o.projekt.spuren.find((x) => x.id === id && x.art === 'instrument');
    if (!sp) throw new ProjFehler(404, 'spur_unbekannt', { text: `track ${id} does not exist` });
    const g = sp.geraet;
    if (g?.art !== 'intern' || g.name !== 'bk' || !(g.graph === 'amiga' || BANK_NAME.test(g.graph)) || geraetFx(g.graph).rollen.slot === undefined) throw new ProjFehler(409, 'keine_plaetze', { text: `Track ${sp.name} plays no device with a slot bank` });
    const graph = leseGraphDatei(g.graph);
    const plaetze = graph ? plaetzeVon(graph) : [];
    if (plaetze.length === 0) throw new ProjFehler(409, 'keine_plaetze', { text: `The graph ${g.graph} of track ${sp.name} holds no slots` });
    return { o, sp, g, plaetze, bank: BANK_NAME.test(g.graph) };
  };
  type Z = ReturnType<typeof spurMitBank>;

  /** Writes the new slot list: ALWAYS a new bank `amiga-<6 hex>` (a copy of the old one with the change, panel as before) and ONE history step that switches every
   *  track of the open project which played the old bank (a track on the factory `amiga` is switched alone). A bank file is never changed after it was made, so a
   *  project copy, a deck section or an undo keeps the old sound. The sample files named in `neu` were written by the caller; a failure removes them and the new
   *  bank again and leaves the project as it was. */
  const schreibe = async (z: Z, plaetze: PlatzDaten[], neu: string[], label: string, quelle: Quelle): Promise<Antwort> => {
    const bk = graphenOrdner();
    const neueBank = neuerBankName(bk);
    let zurueck: (() => void) | undefined;
    const weg = (): void => { try { zurueck?.(); } catch { /* the original error is the one to report */ } entferneSamples(neu, bk); };
    try {
      if (plaetze.some(istLeer)) sichereLeerDatei(bk);
      zurueck = schreibeNeueBank(neueBank, z.g.graph, plaetze, bk);
      const o = opt.zugang.offen();                                        // the project may have changed meanwhile
      if (!o) throw new ProjFehler(409, 'kein_projekt');
      const betroffen = o.projekt.spuren.filter((x) => x.id === z.sp.id || (z.bank && x.art === 'instrument' && x.geraet?.art === 'intern' && x.geraet.name === 'bk' && x.geraet.graph === z.g.graph));
      const a = await opt.sitzung.aendern({ rev: o.projekt.rev, label,
        befehle: betroffen.map((x) => ({ befehl: 'spur_aendern', spur_id: x.id, geraet: { ...x.geraet, graph: neueBank } })) }, quelle);
      if (a.code !== 200) { weg(); return a; }
      const j = a.j as { rev: number; projekt: unknown };
      return { code: 200, j: { graph: neueBank, bank_neu: true, rev: j.rev, projekt: j.projekt } };
    } catch (e) { weg(); throw e; }
  };

  const liste = (z: Z): Record<string, unknown>[] => z.plaetze.map((p, i) => platzZeile(i + 1, p));

  const lies = (url: URL): Antwort => {
    const z = spurMitBank(url.searchParams.get('spur_id'));
    return { code: 200, j: { graph: z.g.graph, plaetze: liste(z) } };
  };

  const neu = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'spur_id', 'platz', 'wurzel', 'rel', 'rate', 'roh', 'grund', 'name');
    const platz = ganz(d.platz, 1, PLATZ_MAX, 'platz');
    const wurzel = textArg(d.wurzel, 'wurzel'), rel = textArg(d.rel, 'rel');
    if (d.roh !== undefined && typeof d.roh !== 'boolean') throw arg('roh: true or false expected');
    if (d.rate !== undefined && d.roh === true) throw arg('rate and roh exclude each other: a raw slot keeps 48000 Hz');
    const rate = d.rate === undefined ? RATE_VORGABE : ganz(d.rate, RATE_MIN, RATE_MAX, 'rate');
    const grund = d.grund === undefined ? GRUND_VORGABE : zahl(d.grund, GRUND_MIN, GRUND_MAX, 'grund');
    const name = d.name === undefined ? undefined : text(d.name, 'name');
    gesperrt(quelle);
    const z = spurMitBank(d.spur_id);                                      // before anything is decoded or written
    const audio = ladeDatei(`${wurzel}/${rel}`, ordner());                 // 60 s limit, leading silence trimmed, refusals as for a cut
    const roh = d.roh === true;
    const w = roh ? { daten: audio.daten, frames: audio.frames } : wandleAmiga(audio.daten, rate);
    const slotRate = roh ? 48000 : rate;
    const slotName = (name ?? audio.name).slice(0, PLATZ_NAME_MAX).trim() || undefined;
    const datei = schreibeSample(w.daten);
    const plaetze = [...z.plaetze];
    while (plaetze.length < platz - 1) plaetze.push(leerPlatz());
    plaetze[platz - 1] = platzEintrag({ datei, ...(slotName !== undefined ? { name: slotName } : {}), grund, rate: slotRate });
    const a = await schreibe(z, plaetze, [datei], `Slot ${pad2(platz)}: ${slotName ?? 'file'}`, quelle);
    if (a.code !== 200) return a;
    return { code: 200, j: { ...(a.j as Record<string, unknown>), nr: platz, ...(slotName !== undefined ? { name: slotName } : {}), frames: w.frames, rate: slotRate, grund, roh,
      text: `Slot ${platz} holds ${slotName ?? 'the file'}: ${w.frames} frames at ${slotRate} Hz${roh ? ' (raw)' : ', 8 bit'}` } };
  };

  const aendern = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'spur_id', 'platz', 'name', 'schleife', 's_von', 's_laenge', 'pegel', 'fein', 'grund');
    const platz = ganz(d.platz, 1, PLATZ_MAX, 'platz');
    const felder = ['name', 'schleife', 's_von', 's_laenge', 'pegel', 'fein', 'grund'].filter((k) => d[k] !== undefined);
    if (felder.length === 0) throw arg('nothing to change: name, schleife, s_von, s_laenge, pegel, fein or grund expected');
    const wert: Partial<PlatzDaten> = {};
    if (d.name !== undefined) wert.name = text(d.name, 'name');
    if (d.schleife !== undefined) wert.schleife = ganz(d.schleife, 0, 1, 'schleife');
    if (d.s_von !== undefined) wert.s_von = ganz(d.s_von, 0, 0xffffffff, 's_von');
    if (d.s_laenge !== undefined) wert.s_laenge = ganz(d.s_laenge, 0, 0xffffffff, 's_laenge');
    if (d.pegel !== undefined) wert.pegel = zahl(d.pegel, 0, 1, 'pegel');
    if (d.fein !== undefined) wert.fein = ganz(d.fein, FEIN_MIN, FEIN_MAX, 'fein');
    if (d.grund !== undefined) wert.grund = zahl(d.grund, GRUND_MIN, GRUND_MAX, 'grund');
    gesperrt(quelle);
    const z = spurMitBank(d.spur_id);
    const alt = z.plaetze[platz - 1];
    if (!alt || istLeer(alt)) throw new ProjFehler(404, 'bank_platz_leer', { text: `Slot ${platz} holds no sample` });
    const neuP: PlatzDaten = { ...alt, ...wert };
    if (neuP.schleife === 1) {                                             // the block refuses a loop outside the data when it translates the graph
      const frames = frameZahl(neuP.datei), von = neuP.s_von ?? 0, laenge = neuP.s_laenge ?? 0;
      if (laenge < 1) throw arg('s_laenge: a loop needs at least 1 frame');
      if (von >= frames || von + laenge > frames) throw arg(`the loop ${von}+${laenge} must lie inside the ${frames} frames of the slot`);
    }
    const plaetze = [...z.plaetze];
    plaetze[platz - 1] = platzEintrag(neuP);
    const a = await schreibe(z, plaetze, [], `Slot ${pad2(platz)}: ${aendernLabel(wert)}`, quelle);
    if (a.code !== 200) return a;
    return { code: 200, j: { ...(a.j as Record<string, unknown>), platz: platzZeile(platz, platzEintrag(neuP)) } };
  };

  const leeren = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'spur_id', 'platz');
    const platz = ganz(d.platz, 1, PLATZ_MAX, 'platz');
    gesperrt(quelle);
    const z = spurMitBank(d.spur_id);
    const alt = z.plaetze[platz - 1];
    if (!alt || istLeer(alt)) throw new ProjFehler(404, 'bank_platz_leer', { text: `Slot ${platz} holds no sample` });
    const plaetze = [...z.plaetze];
    plaetze[platz - 1] = leerPlatz();
    const a = await schreibe(z, plaetze, [], `Slot ${pad2(platz)}: cleared`, quelle);
    if (a.code !== 200) return a;
    return { code: 200, j: { ...(a.j as Record<string, unknown>), platz: platzZeile(platz, leerPlatz()) } };
  };

  return { lies, neu, aendern, leeren };
}

export function platzRouten(ctx: BereichKontext, opt: SamplerOptionen): Route[] {
  const l = platzLogik(ctx, opt);
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = e instanceof SchnittFehler ? { code: e.code, j: { fehler: e.grund, text: e.text } } : alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  const post = (pfad: string, f: (d: Record<string, unknown>, q: Quelle) => Antwort | Promise<Antwort>): Route => ({
    methode: 'POST', pfad, schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                         // read at the start of the request
      await antworte(r, async () => f(await leseKoerper(q), quelle));
    },
  });
  return [
    { methode: 'GET', pfad: '/sampler/plaetze', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => l.lies(url)) },
    post('/sampler/platz', l.neu),
    post('/sampler/platz/aendern', l.aendern),
    post('/sampler/platz/leeren', l.leeren),
  ];
}
