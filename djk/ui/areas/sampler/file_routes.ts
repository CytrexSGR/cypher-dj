// Sample player stage 1: the routes /sampler/dateien, /sampler/datei/hoer and /sampler/datei/spur. Files of the sample roots (sampler/file.ts) are listed,
// searched, heard in the browser and made into a cut ("whole" method), a tone and a NOTE track in one history step. Joined to the sampler routes in area.ts.
import type http from 'node:http';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { dateiName, grundVonDatei, ladeDateiPfad, listeOrdner, listeWurzeln, loeseAuf, sucheDateien, vorhoerWav, wurzelEcht } from '../../sampler/file.ts';
import { ordnerInstrumentFeld } from '../../sampler/instrument.ts';
import { kitMitKlang } from '../../sampler/kit.ts';
import { kitsOrdnerVorgabe } from '../../paths.ts';
import { ladeSchnittAudio, legeSchnitt, loescheSchnitt, SchnittFehler, type Ordner } from '../../sampler/schnitt.ts';
import { legeTon } from '../../sampler/tone.ts';
import { alsAntwort, leseKoerper } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { SamplerOptionen } from './area.ts';
import { offenFuerSpur, tonAufSpur } from './tone_routes.ts';
import fs from 'node:fs';
import path from 'node:path';
import { KatalogFehler, type Zeile } from '../../catalog.ts';

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

  // The file of a catalog row by sha. The row decides: unknown, without a path or not a file is 404; a library track and a protected row are 422;
  // a refusal of the catalog (bad sha, missing or damaged file) keeps its code. Nothing is read from the file here.
  const katalogDatei = (sha: unknown): { pfad: string; name: string | null } => {
    if (typeof sha !== 'string' || sha === '') throw arg('sha: a text expected');
    if (!opt.katalog) throw new SchnittFehler(503, 'katalog_fehlt', 'no catalog is available');
    let z: Zeile | null;
    try { z = opt.katalog.eintrag(sha); } catch (e) { if (e instanceof KatalogFehler) throw new SchnittFehler(e.code, e.fehler, e.fehler); throw e; }
    if (!z || z.pfad === null) throw new SchnittFehler(404, 'quelle_unbekannt', `catalog file ${sha.slice(0, 16)} is unknown or has no file`);
    if (z.typ === 'track') throw new SchnittFehler(422, 'format_falsch', 'a library track is not a sample');
    if (z.schutz !== null) throw new SchnittFehler(422, 'format_falsch', 'this sample is protected (an Ableton factory sample); only Live reads it');
    let datei = false;
    try { datei = fs.statSync(z.pfad).isFile(); } catch { /* the file vanished */ }
    if (!datei) throw new SchnittFehler(404, 'quelle_unbekannt', `${path.basename(z.pfad)} is not on disk (any more)`);
    return { pfad: z.pfad, name: z.name };
  };
  // exactly one way to name a file: `sha` or the pair `wurzel`/`rel`
  const eindeutig = (sha: unknown, wurzel: unknown, rel: unknown): boolean => {
    const mitSha = sha !== undefined && sha !== null, mitPaar = (wurzel !== undefined && wurzel !== null) || (rel !== undefined && rel !== null);
    if (mitSha === mitPaar) throw arg('exactly one of sha and the pair wurzel/rel expected');
    return mitSha;
  };

  const spur = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'wurzel', 'rel', 'sha', 'grund', 'name');
    const mitSha = eindeutig(d.sha, d.wurzel, d.rel);
    const k = mitSha ? katalogDatei(d.sha) : null;
    const wurzel = mitSha ? '' : stringArg(d.wurzel, 'wurzel'), rel = mitSha ? '' : stringArg(d.rel, 'rel');
    if (d.grund !== undefined && (typeof d.grund !== 'number' || !Number.isInteger(d.grund))) throw arg('grund: a MIDI note, a whole number, expected');
    if (d.name !== undefined && (typeof d.name !== 'string' || d.name.trim() === '' || d.name.trim().length > NAME_MAX)) throw arg(`name: a text of 1..${NAME_MAX} characters expected`);
    gesperrt(quelle);
    const o0 = offenFuerSpur(opt);                                       // before anything is made
    const o: Ordner = { ...ordner(), tempo: o0.projekt.tempo_bpm, ...(k ? { katalogPfad: () => k.pfad } : {}) };
    const zeilenName = k?.name?.trim() ? k.name.trim().slice(0, NAME_MAX).trim() : undefined;   // else the cut takes the file name
    const s = legeSchnitt({ quelle: mitSha ? { art: 'katalog', ref: d.sha as string } : { art: 'datei', ref: `${wurzel}/${rel}` },
      name: (d.name as string | undefined)?.trim() ?? zeilenName, methode: 'ganz' }, o);
    const weg = (): void => { try { loescheSchnitt(s.id, ordner()); } catch { /* the original error is the one to report */ } };
    try {
      const g = d.grund === undefined ? grundVonDatei(ladeSchnittAudio(s, o), k ? path.basename(k.pfad) : rel.split('/').pop() ?? rel) : { note: d.grund as number, herkunft: 'angabe' as const };
      const t = legeTon({ schnitt_id: s.id, von: 0, grund: g.note, name: s.name }, ordner());
      const a = await tonAufSpur(opt, ordner(), t, quelle);              // removes the tone on a refusal
      if (a.code !== 200) { weg(); return a; }
      return { code: 200, j: { ...(a.j as Record<string, unknown>), schnitt_id: s.id, grund_herkunft: g.herkunft } };
    } catch (e) { weg(); throw e; }
  };

  // A catalog sample onto one row (note) of a drum track: a COPY of the track's kit with that sound replaced or added, the track switched to the copy in
  // one history step. The old kit is never written (other tracks and stored projects play it). No track is added, so no `werkbank_voll`.
  const pad = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'spur_id', 'ton', 'sha');
    const spurId = stringArg(d.spur_id, 'spur_id');
    if (typeof d.ton !== 'number' || !Number.isInteger(d.ton) || d.ton < 0 || d.ton > 127) throw arg('ton: a MIDI note, a whole number from 0 to 127, expected');
    if (d.sha === undefined) throw arg('sha: a text expected');
    gesperrt(quelle);
    const o = opt.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    if (!o.projekt.werkbank) throw new ProjFehler(409, 'kein_werkbank', { text: 'the open project is not a workbench module' });
    const sp = o.projekt.spuren.find((x) => x.id === spurId && x.art === 'instrument');
    if (!sp) throw new ProjFehler(404, 'spur_unbekannt', { text: `track ${spurId} does not exist` });
    const g = sp.geraet;
    if (g?.art !== 'intern' || g.name !== 'kit') throw new ProjFehler(409, 'kein_kit', { text: `Track ${sp.name} plays no sample kit` });
    const k = katalogDatei(d.sha);
    const audio = ladeDateiPfad(k.pfad, ordner());
    const dateiname = path.basename(k.pfad);
    const neu = kitMitKlang({ kit: g.kit, ton: d.ton, daten: audio.daten, quelle: `datei:${d.sha as string}` });
    const weg = (): void => { try { fs.rmSync(path.join(kitsOrdnerVorgabe(), neu.kit), { recursive: true, force: true }); } catch { /* the original error is the one to report */ } };
    try {
      const a = await opt.sitzung.aendern({ rev: o.projekt.rev, label: `Sound on ${neu.name}`,
        befehle: [{ befehl: 'spur_aendern', spur_id: sp.id, geraet: { art: 'intern', name: 'kit', kit: neu.kit } }] }, quelle);
      if (a.code !== 200) { weg(); return a; }
      const j = a.j as { rev: number; projekt: unknown };
      return { code: 200, j: { rev: j.rev, projekt: j.projekt, kit: neu.kit, ton: d.ton, name: neu.name, text: `${dateiname} is now ${neu.name} on ${sp.name} (kit ${neu.kit})` } };
    } catch (e) { weg(); throw e; }
  };

  const hoer = (r: http.ServerResponse, url: URL): void => {
    const q = url.searchParams;
    const pfad = eindeutig(q.get('sha') ?? undefined, q.get('wurzel') ?? undefined, q.get('rel') ?? undefined) ? katalogDatei(q.get('sha')).pfad : loeseAuf(q.get('wurzel'), q.get('rel'), ordner());
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
    { methode: 'POST', pfad: '/sampler/datei/pad', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                       // read at the start of the request
      await antworte(r, async () => pad(await leseKoerper(q), quelle));
    } },
  ];
}
