// Sampler A1 task 4: the routes /sampler/* of the page server. Sources, cuts (areas of the cut store in sampler/schnitt.ts), SLICE TO TRACK (one
// history step through the project session), FIT, delete, hear one slice (task 7). Plans B and C add their routes here. The cut audio is served as a waveform by GET /welle?schnitt=.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { leseLoops } from '../../loops.ts';
import { liesModul, listeModule } from '../../project/module_storage.ts';
import type { BkKanal } from '../../project/modular.ts';
import type { Gruppe, Master, Projekt, Return, Spur } from '../../project/model.ts';
import { MAX_WERKBANK_SPUREN } from '../../project/werkbank.ts';
import { fitWert, geraetName, speedVon, spurBefehl } from '../../sampler/device.ts';
import { setzeMarke, umnummerBefehle } from '../../sampler/marken.ts';
import { anschlaegeVon, legeSchnitt, liesSchnitt, listeSchnitte, loescheSchnitt, schneideNeu, schreibeGeaendert, sichereSchnitt, SchnittFehler, type Ordner, type Schnitt } from '../../sampler/schnitt.ts';
import { schnittText } from '../../sampler/text.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from '../proj/area.ts';
import { quittungAbgelehnt } from '../proj/core_path.ts';
import { ProjFehler, type Antwort, type ProjSitzung } from '../proj/session.ts';
import { loescheToeneDesSchnitts, tonRouten } from './tone_routes.ts';   // plan C

/** `ordner` (cut store, default `samplerOrdner()`), `loops` and `module` are read at every request, so a getter may follow the options of the server. */
export interface SamplerOptionen { sitzung: ProjSitzung; zugang: ProjZugang; ordner?: string; loops: string; module: string }
type Quelle = 'andreas' | 'cypher';

const STEMS = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];
const NAME_MAX = 80;   // the longest track name and history label of the project
const STUMM_SPITZE = 0.001;      // -60 dBFS: below this peak a loop counts as silent
const MODUL_BEATS = [4, 8, 16, 32, 64];   // the module lengths of the workbench top bar (1 to 16 bars)
const HOEREN_MAX_MS = 10_000;   // a slice that is heard by a click never sounds longer than this
const HOEREN_TON_MS = 400;      // a note heard by a click on a key or a drum row of the grid is held this long

const arg = (text: string): ProjFehler => new ProjFehler(400, 'argument_ungueltig', { text });
const nurSchluessel = (d: Record<string, unknown>, ...erlaubt: string[]): void => {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { text: `${k}: the request has no field of that name`, detail: k });
};
const istSpur = (s: Spur, id: string): boolean => s.geraet?.art === 'intern' && s.geraet.name === 'bk' && s.geraet.graph === geraetName(id);
// Every place of a project (or of a module) that names the graph `graph`: the Baukasten device of a track, a member of an instrument rack, an insert
// stage `bk` of any strip (track, group, return, master) and a Baukasten stream channel of the sound snapshot. `strang` is the name of the strip.
// (The provenance `entstehung.graph` of a recorded take is only a note and plays nothing: it is not a use.)
interface Teil { spuren?: Spur[]; gruppen?: Gruppe[]; returns?: Return[]; master?: Master; baukasten?: BkKanal[] }
export interface Fund { strang: string; wo: string }
export const nutzer = (t: Teil, graph: string): Fund[] => {
  const aus: Fund[] = [];
  for (const s of t.spuren ?? []) {
    const g = s.geraet;
    if (g?.art === 'intern' && g.name === 'bk' && g.graph === graph) aus.push({ strang: s.name, wo: `track "${s.name}"` });
    if (g?.art === 'rack') for (const m of g.glieder) {
      if (m.geraet.art === 'intern' && m.geraet.name === 'bk' && m.geraet.graph === graph) aus.push({ strang: s.name, wo: `rack member of track "${s.name}"` });
    }
  }
  const strang = (name: string, wie: string, x: { inserts?: { graph?: string }[] }): void => {
    if ((x.inserts ?? []).some((i) => i.graph === graph)) aus.push({ strang: name, wo: `insert stage of ${wie}` });
  };
  for (const s of t.spuren ?? []) strang(s.name, `track "${s.name}"`, s);
  for (const g of t.gruppen ?? []) strang(g.name, `group "${g.name}"`, g);
  for (const r of t.returns ?? []) strang(r.name, `return "${r.name}"`, r);
  if (t.master) strang('master', 'the master', t.master);
  if ((t.baukasten ?? []).some((k) => k.graph === graph)) aus.push({ strang: 'sound snapshot', wo: 'a Baukasten stream channel' });
  return aus;
};
const bkSchnittId = (s: Spur): string | null => (s.geraet?.art === 'intern' && s.geraet.name === 'bk' && s.geraet.graph.startsWith('smp-') ? s.geraet.graph.slice(4) : null);

export function samplerBereich(ctx: BereichKontext, opt: SamplerOptionen): Bereich {
  const ordner = (): Ordner => ({ ordner: opt.ordner, loops: opt.loops, module: opt.module });
  const gesperrt = (quelle: Quelle): void => { if (quelle === 'cypher' && ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt'); };
  const offen = (): NonNullable<ReturnType<ProjZugang['offen']>> => {
    const o = opt.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    return o;
  };
  /** The checks of SLICE TO TRACK that need no cut: a workbench module is open and has a free instrument slot. */
  const werkbank = (o: ReturnType<typeof offen>): void => {
    if (!o.projekt.werkbank) throw new ProjFehler(409, 'kein_werkbank', { text: 'the open project is not a workbench module' });
    if (o.projekt.spuren.filter((s) => s.art === 'instrument').length >= MAX_WERKBANK_SPUREN) {
      throw new ProjFehler(409, 'werkbank_voll', { text: `a module holds at most ${MAX_WERKBANK_SPUREN} instrument tracks` });
    }
  };
  const holeSchnitt = (id: unknown): Schnitt => {
    if (typeof id !== 'string' || id === '') throw arg('id: the id of a cut expected');
    const s = liesSchnitt(id, ordner());
    if (!s) throw new SchnittFehler(404, 'schnitt_unbekannt', `cut ${id} does not exist`);
    return s;
  };
  const schnittKurz = (s: Schnitt): Record<string, unknown> => ({ id: s.id, name: s.name, quelle: s.quelle, bpm: s.bpm, beats: s.beats, scheiben: s.grenzen.length - 1, geraet: geraetName(s.id) });

  // A library loop whose audio never passes -60 dBFS (a recording of silence) is listed with `stumm: true`. The measurement is kept per file state.
  const stummMerker = new Map<string, { marke: string; stumm: boolean }>();
  const istStumm = (name: string): boolean => {
    const datei = path.join(opt.loops, name, 'loop.f32');
    try {
      const st = fs.statSync(datei), marke = `${st.size}:${st.mtimeMs}`;
      const alt = stummMerker.get(datei);
      if (alt?.marke === marke) return alt.stumm;
      const roh = fs.readFileSync(datei), n = roh.length >> 2;
      let stumm = true;
      for (let i = 0; i < n; i++) if (Math.abs(roh.readFloatLE(i * 4)) >= STUMM_SPITZE) { stumm = false; break; }
      stummMerker.set(datei, { marke, stumm });
      return stumm;
    } catch { return false; }
  };

  const quellen = (): Antwort => {
    const loops = leseLoops(opt.loops).filter((l) => l.ladbar).map((l) => ({ name: l.name, beats: l.beats, ...(istStumm(l.name) ? { stumm: true } : {}) }));
    const module = listeModule({ basis: opt.module }).flatMap((e) => {
      const m = liesModul(e.id, opt.module);
      if (!m) return [];
      const audio: { stem: string | null; name: string }[] = [];
      for (const stem of [null, ...STEMS]) {
        const name = stem === null ? 'Loop' : `${stem[0].toUpperCase()}${stem.slice(1)} original`;
        const clip = m.spuren.find((s) => s.name === name)?.clips.find((c) => c.art === 'audio');
        if (!clip || clip.art !== 'audio') continue;
        const hinweis = clip.quelle.pfad_hinweis, basis = path.resolve(opt.module, e.id), datei = path.resolve(basis, hinweis);
        if (path.isAbsolute(hinweis) || !datei.startsWith(`${basis}${path.sep}`) || !fs.existsSync(datei)) continue;   // the audio of a module may be missing
        audio.push({ stem, name });
      }
      return audio.length === 0 ? [] : [{ id: e.id, titel: e.titel, beats: e.laenge_beats, bpm: e.bpm, audio }];
    });
    return { code: 200, j: { loops, module } };
  };

  const liste = (): Antwort => ({ code: 200, j: { schnitte: listeSchnitte(ordner()).map(schnittKurz) } });

  const lies = (url: URL): Antwort => {
    const s = holeSchnitt(url.searchParams.get('id'));
    const format = url.searchParams.get('format');
    if (format === null) return { code: 200, j: { schnitt: s } };
    if (format !== 'text') throw arg('format: text or absent expected');
    return { code: 200, j: { id: s.id, text: schnittText(s) } };
  };

  const schnittNeu = (d: Record<string, unknown>, quelle: Quelle): Antwort => {
    gesperrt(quelle);
    const { quelle: q, name, methode, ...optionen } = d;
    const s = legeSchnitt({ quelle: q as never, name: name as string | undefined, methode: methode as string | undefined, optionen }, ordner());
    return { code: 200, j: { schnitt: s } };
  };

  // " 2", " 3" ... until the name is free among the instrument tracks (ignoring case, as the command does)
  const freierName = (p: Projekt, name: string): string => {
    const belegt = new Set(p.spuren.filter((s) => s.art === 'instrument').map((s) => s.name.toLowerCase()));
    for (let n = 1; ; n++) {
      const rest = n === 1 ? '' : ` ${n}`;
      const z = `${name.slice(0, NAME_MAX - rest.length)}${rest}`;
      if (!belegt.has(z.toLowerCase())) return z;
    }
  };

  const spur = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    const mitId = d.id !== undefined;
    if (mitId) nurSchluessel(d, 'id'); else nurSchluessel(d, 'quelle', 'name', 'scheiben', 'methode', 'empfindlichkeit');
    // `hand` is not a way to cut a source: its bounds come from marker edits. The method's own checks (range of the sensitivity) are the cut's.
    if (!mitId && d.methode !== undefined && d.methode !== 'raster' && d.methode !== 'anschlag') {
      throw new ProjFehler(400, 'methode_unbekannt', { text: `methode: raster or anschlag expected, not ${typeof d.methode === 'string' ? d.methode : JSON.stringify(d.methode)}` });
    }
    if (d.scheiben !== undefined && d.methode === 'anschlag') throw arg('scheiben: only with the method raster; the hits decide the count');
    if (d.empfindlichkeit !== undefined && d.methode !== 'anschlag') throw arg('empfindlichkeit: only with the method anschlag');
    gesperrt(quelle);
    werkbank(offen());                                                  // before anything is created
    let s: Schnitt, neu = false;
    if (mitId) s = holeSchnitt(d.id);
    else {
      s = legeSchnitt({ quelle: d.quelle as never, name: d.name as string | undefined, methode: d.methode as string | undefined,
        optionen: { ...(d.scheiben === undefined ? {} : { scheiben: d.scheiben }), ...(d.empfindlichkeit === undefined ? {} : { empfindlichkeit: d.empfindlichkeit }) } }, ordner());
      neu = true;
    }
    try {
      const o = offen();                                                // the project may have changed while the cut was written
      werkbank(o);
      const { befehl, fit } = spurBefehl(s, { name: freierName(o.projekt, s.name), projektBpm: o.projekt.tempo_bpm });
      // A cut longer than the module would play only its first part: the module grows to the first length that holds it, in the same history step.
      // Only a module length is raised (loop on, from beat 0, one of the bar counts of the top bar); any other loop is the person's and stays.
      const l = o.projekt.loop;
      const laenge = l.an && l.von_beat === 0 && MODUL_BEATS.includes(l.bis_beat) && l.bis_beat < s.beats ? MODUL_BEATS.find((b) => b >= s.beats) ?? null : null;
      const befehle = [...(laenge === null ? [] : [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: laenge }]), befehl];
      const a = await opt.sitzung.aendern({ rev: o.projekt.rev, label: `Slice ${s.name}`.slice(0, NAME_MAX), befehle }, quelle);
      if (a.code !== 200) { if (neu) loescheSchnitt(s.id, ordner()); return a; }
      const j = a.j as { rev: number; projekt: Projekt };
      const neueSpur = [...j.projekt.spuren].reverse().find((x) => istSpur(x, s.id));
      return { code: 200, j: { rev: j.rev, projekt: j.projekt, spur_id: neueSpur?.id ?? null, schnitt_id: s.id, fit, ...(laenge === null ? {} : { modul_takte: laenge / 4 }) } };
    } catch (e) {
      if (neu) { try { loescheSchnitt(s.id, ordner()); } catch { /* the refusal of the project is the error to report */ } }
      throw e;
    }
  };

  const fit = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'spur_id');
    if (typeof d.spur_id !== 'string' || d.spur_id === '') throw arg('spur_id: the id of a track expected');
    gesperrt(quelle);
    const o = offen();
    const t = o.projekt.spuren.find((x) => x.id === d.spur_id);
    if (!t) throw new ProjFehler(404, 'spur_unbekannt', { text: `track ${d.spur_id} does not exist` });
    const id = bkSchnittId(t);
    if (id === null) throw new ProjFehler(409, 'kein_schnitt_geraet', { text: `track ${t.name} does not play a sampler cut` });
    const s = holeSchnitt(id);
    const wert = fitWert(o.projekt.tempo_bpm, s.bpm);
    if (wert === null) {
      throw new ProjFehler(409, 'fit_ausserhalb', { text: `the project tempo ${o.projekt.tempo_bpm} BPM is outside 0.25x to 4x of the cut tempo ${Number(s.bpm.toFixed(2))} BPM; SPEED is unchanged` });
    }
    const a = await opt.sitzung.aendern({ rev: o.projekt.rev, label: `Fit ${t.name}`.slice(0, NAME_MAX), befehle: [{ befehl: 'geraet_param_setzen', spur_id: t.id, param: 'k2', wert }] }, quelle);
    if (a.code !== 200) return a;
    const j = a.j as { rev: number; projekt: Projekt };
    return { code: 200, j: { rev: j.rev, projekt: j.projekt, wert } };
  };

  // Task 7 (D12): click to hear. /k/arr/note on now, the off after the length of the slice at the speed of the track (at most 10 s). One note sounds per track: a new
  // request first ends the previous one. The off always goes as `andreas` (the safe direction: after Stop Cypher an off of Cypher's own request must still end its note).
  const klingend = new Map<string, { timer: NodeJS.Timeout; nr: number; ton: number }>();
  // `neuerTon`: a request that plays the same note again only discards the timer of the previous one (its off would end the new note at once)
  const aus = (spurId: string, neuerTon?: number): void => {
    const k = klingend.get(spurId);
    if (!k) return;
    clearTimeout(k.timer);
    klingend.delete(spurId);
    if (k.ton !== neuerTon) ctx.sende('/k/arr/note', { quelle: 'andreas', spur: k.nr, ton: k.ton, vel: 0 });
  };
  const hoeren = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'spur_id', 'scheibe', 'ton');
    if (typeof d.spur_id !== 'string' || d.spur_id === '') throw arg('spur_id: the id of a track expected');
    if ((d.scheibe === undefined) === (d.ton === undefined)) throw arg('exactly one of scheibe (a slice of a cut track) and ton (a note of any instrument track) expected');
    if (d.ton !== undefined) return hoerenTon(d.spur_id, d.ton, quelle);
    if (typeof d.scheibe !== 'number' || !Number.isInteger(d.scheibe)) throw arg('scheibe: the 0-based index of a slice expected');
    gesperrt(quelle);
    const o = offen();
    const t = o.projekt.spuren.find((x) => x.id === d.spur_id);
    if (!t) throw new ProjFehler(404, 'spur_unbekannt', { text: `track ${d.spur_id} does not exist` });
    const id = bkSchnittId(t);
    if (id === null) throw new ProjFehler(409, 'kein_schnitt_geraet', { text: `track ${t.name} does not play a sampler cut` });
    const s = holeSchnitt(id);
    const n = s.grenzen.length - 1;
    if (d.scheibe < 0 || d.scheibe >= n) throw arg(`scheibe: ${d.scheibe} is outside the cut (0 to ${n - 1})`);
    const k2 = t.geraet?.art === 'intern' ? t.geraet.parameter?.k2 : undefined;
    const speed = speedVon(typeof k2 === 'number' ? k2 : 0.5);                        // SPEED at its default (the middle) plays at 1
    const frames = s.grenzen[d.scheibe + 1] - s.grenzen[d.scheibe];
    const dauer = Math.min(HOEREN_MAX_MS, Math.max(1, Math.round(frames / 48 / speed)));
    return spiele(t, d.scheibe, dauer);
  };
  // A click on a key or a drum row of the grid: one note through the instrument of the track, whatever it is, held HOEREN_TON_MS.
  const hoerenTon = (spurId: string, ton: unknown, quelle: Quelle): Promise<Antwort> => {
    if (typeof ton !== 'number' || !Number.isInteger(ton) || ton < 0 || ton > 127) throw arg('ton: a note number 0 to 127 expected');
    gesperrt(quelle);
    const t = offen().projekt.spuren.find((x) => x.id === spurId);
    if (!t) throw new ProjFehler(404, 'spur_unbekannt', { text: `track ${spurId} does not exist` });
    if (t.art !== 'instrument') throw new ProjFehler(409, 'kein_instrument', { text: `track ${t.name} is not an instrument track` });
    return spiele(t, ton, HOEREN_TON_MS);
  };
  const spiele = async (t: Spur, ton: number, dauer: number): Promise<Antwort> => {
    aus(t.id, ton);                                                              // the previous note of this track ends first (not when it is the same one)
    const q = await ctx.warteQuittung(ctx.sende('/k/arr/note', { spur: t.nr, ton, vel: 100 }));
    if (!q) throw new ProjFehler(409, 'kein_kern', { text: 'the core did not answer' });
    if (quittungAbgelehnt(q)) throw new ProjFehler(409, q.grund === 'ki_gestoppt' ? 'ki_gestoppt' : 'hoeren_abgelehnt', { text: `the core refused the note: ${q.grund}`, kern: q.grund });
    aus(t.id, ton);                                                              // a request that overtook this one during the wait: its note ends too
    // after the end of the server the socket is closed and sending throws: nothing to end then
    const timer = setTimeout(() => { try { aus(t.id); } catch { /* the server has stopped */ } }, dauer);
    timer.unref();
    klingend.set(t.id, { timer, nr: t.nr, ton });
    return { code: 200, j: { ok: true, dauer_ms: dauer } };
  };

  const FUNDSTELLEN_MAX = 5;
  const loeschen = (d: Record<string, unknown>, quelle: Quelle): Antwort => {
    nurSchluessel(d, 'id');
    gesperrt(quelle);
    const s = holeSchnitt(d.id);
    const graph = geraetName(s.id);
    // 1. the open project (its live state), 2. every other stored project (workbench modules are projects with a marker), 3. the module store of the live set
    const o = opt.zugang.offen();
    const imOffenen = o ? nutzer(o.projekt, graph) : [];
    const stellen = imOffenen.map((f) => `${f.wo} of the open project "${o!.projekt.name}"`);
    for (const g of opt.sitzung.gespeicherte()) {
      if (g.slug === o?.slug) continue;                                  // the open project was checked above, from its live state
      if (nutzer(g.projekt, graph).length > 0) stellen.push(`project "${g.projekt.name}"`);
    }
    for (const e of listeModule({ basis: opt.module })) {
      const m = liesModul(e.id, opt.module);
      if (m && nutzer(m, graph).length > 0) stellen.push(`module "${e.titel}"`);
    }
    if (stellen.length > 0) {
      const gezeigt = stellen.slice(0, FUNDSTELLEN_MAX).join(', '), rest = stellen.length - FUNDSTELLEN_MAX;
      throw new ProjFehler(409, 'schnitt_in_gebrauch', { text: `the cut is in use by ${gezeigt}${rest > 0 ? ` and ${rest} more` : ''}; remove it there first`,
        spuren: [...new Set(imOffenen.map((f) => f.strang))], fundstellen: stellen });
    }
    loescheToeneDesSchnitts(s.id, ordner(), opt);   // plan C: refuses (409 ton_in_gebrauch) or removes the cut's tones
    loescheSchnitt(s.id, ordner());
    return { code: 200, j: { ok: true } };
  };

  // A2: changing a cut (cut again, marker edits, original order). The three routes run one after the other: each reads the cut and the open project and
  // writes both, with an await in between.
  let kette: Promise<unknown> = Promise.resolve();
  const nacheinander = <T>(f: () => Promise<T>): Promise<T> => { const r = kette.then(f, f); kette = r.catch(() => undefined); return r; };
  // The graph is read when a playback is loaded, and nobody watches the graph folder: a track that plays the cut hears new bounds only after the playback
  // of the open project is loaded again. A project step that changes notes loads it itself (after the cut files are written), so only the other cases call this.
  const spieltImOffenen = (id: string): boolean => { const o = opt.zugang.offen(); return o !== null && nutzer(o.projekt, geraetName(id)).length > 0; };
  const ladeNeu = async (id: string): Promise<void> => {
    if (!spieltImOffenen(id)) return;
    // under the load lock of a freeze, export or recording this only remembers the wish; the release loads
    try { await opt.sitzung.ladeLiveNeuFrei(); } catch (e) { ctx.log({ typ: 'sampler_neu_laden_fehler', schnitt: id, fehler: (e as Error).message }); }
  };
  const spurNamen = (id: string): string[] => { const o = opt.zugang.offen(); return o ? o.projekt.spuren.filter((x) => istSpur(x, id)).map((x) => x.name) : []; };

  const neuSchneiden = (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => nacheinander(async () => {
    nurSchluessel(d, 'id', 'methode', 'scheiben', 'empfindlichkeit');
    if (d.methode !== 'raster' && d.methode !== 'anschlag') throw new ProjFehler(400, 'methode_unbekannt', { text: 'methode: raster or anschlag expected' });
    if (d.scheiben !== undefined && d.methode !== 'raster') throw arg('scheiben: only with the method raster; the hits decide the count');
    if (d.empfindlichkeit !== undefined && d.methode !== 'anschlag') throw arg('empfindlichkeit: only with the method anschlag');
    gesperrt(quelle);
    const alt = holeSchnitt(d.id);
    const s = schneideNeu(alt.id, { methode: d.methode, optionen: { ...(d.scheiben === undefined ? {} : { scheiben: d.scheiben }), ...(d.empfindlichkeit === undefined ? {} : { empfindlichkeit: d.empfindlichkeit }) } }, ordner());
    await ladeNeu(s.id);
    const n = s.grenzen.length - 1;
    return { code: 200, j: { schnitt: s, spuren: spurNamen(s.id),
      text: `Cut again: ${n} slices by ${d.methode === 'raster' ? 'grid' : 'hits'}. The patterns keep their slice numbers; WRITE ORIGINAL ORDER puts the new order on a track.` } };
  });

  const marke = (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => nacheinander(async () => {
    nurSchluessel(d, 'id', 'art', 'marke', 'frame', 'beat', 'einrasten');
    gesperrt(quelle);
    const alt = holeSchnitt(d.id);
    const r = setzeMarke(alt, d, anschlaegeVon(alt, ordner()));                 // every refusal comes here, before anything is written
    const n = alt.grenzen.length - 1;
    const o = opt.zugang.offen();
    const befehle = o && r.art !== 'schieben' ? umnummerBefehle(o.projekt, alt.id, r.art, r.k, n) : [];
    const zurueck = sichereSchnitt(alt.id, ordner());
    schreibeGeaendert(r.schnitt, ordner());                                        // cut files first, then the project step
    let projektTeil: { rev: number; projekt: Projekt } | null = null;
    if (befehle.length > 0) {
      try {
        const a = await opt.sitzung.aendern({ rev: o!.projekt.rev, label: `${r.art === 'neu' ? 'Add' : 'Remove'} marker ${alt.name}`.slice(0, NAME_MAX), befehle }, quelle);
        if (a.code !== 200) { zurueck(); return a; }
        projektTeil = a.j as { rev: number; projekt: Projekt };
      } catch (e) { try { zurueck(); } catch { /* the refusal of the project is the error to report */ } throw e; }
    } else await ladeNeu(alt.id);                                                    // no notes changed: the project step that would load the playback did not happen
    const k = r.k + 1;                                                              // shown numbers are 1-based
    const text = r.art === 'schieben' ? `Marker ${r.k} moved to frame ${r.schnitt.grenzen[r.k]}. The patterns are unchanged.`
      : r.art === 'neu' ? `Marker added. Slice ${r.k} is split: its hits play the first part; slice ${k} has no hits yet. Patterns of open tracks that play this cut are renumbered in one step; tracks in modules that are not open keep their old numbers. Undo in PRODUCTION reverts the renumbering only, not the marker.`
      : `Marker ${r.k} removed. Slices ${r.k} and ${k} are merged into slice ${r.k}: the hits of both play it. Patterns of open tracks that play this cut are renumbered in one step; tracks in modules that are not open keep their old numbers. Undo in PRODUCTION reverts the renumbering only, not the marker.`;
    return { code: 200, j: { schnitt: r.schnitt, text, ...(projektTeil ? { rev: projektTeil.rev, projekt: projektTeil.projekt } : {}) } };
  });

  const ursprung = (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => nacheinander(async () => {
    nurSchluessel(d, 'spur_id');
    if (typeof d.spur_id !== 'string' || d.spur_id === '') throw arg('spur_id: the id of a track expected');
    gesperrt(quelle);
    const o = offen();
    const t = o.projekt.spuren.find((x) => x.id === d.spur_id);
    if (!t) throw new ProjFehler(404, 'spur_unbekannt', { text: `track ${d.spur_id} does not exist` });
    const id = bkSchnittId(t);
    if (id === null) throw new ProjFehler(409, 'kein_schnitt_geraet', { text: `track ${t.name} does not play a sampler cut` });
    const s = holeSchnitt(id);
    const clip = t.clips.find((c) => c.art === 'midi');
    if (!clip || clip.art !== 'midi') throw new ProjFehler(409, 'kein_clip', { text: `track ${t.name} has no MIDI clip` });
    const { befehl } = spurBefehl(s, { projektBpm: o.projekt.tempo_bpm });
    const befehle: Record<string, unknown>[] = [];
    if (clip.noten.length > 0) befehle.push({ befehl: 'noten_loeschen', clip_id: clip.id, ids: clip.noten.map((x) => x.id) });
    befehle.push({ befehl: 'noten_neu', clip_id: clip.id, noten: befehl.noten });
    const a = await opt.sitzung.aendern({ rev: o.projekt.rev, label: `Original order ${t.name}`.slice(0, NAME_MAX), befehle }, quelle);
    if (a.code !== 200) return a;
    const j = a.j as { rev: number; projekt: Projekt };
    return { code: 200, j: { rev: j.rev, projekt: j.projekt, text: `Original order: ${s.grenzen.length - 1} notes, one per slice, on track ${t.name}.` } };
  });

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
  const routen = (): Route[] => [
    { methode: 'GET', pfad: '/sampler/quellen', schutz: 'offen', handler: async (_q, r) => antworte(r, quellen) },
    { methode: 'GET', pfad: '/sampler/liste', schutz: 'offen', handler: async (_q, r) => antworte(r, liste) },
    { methode: 'GET', pfad: '/sampler/schnitt', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => lies(url)) },
    post('/sampler/schnitt', schnittNeu),
    post('/sampler/spur', spur),
    post('/sampler/fit', fit),
    post('/sampler/loeschen', loeschen),
    post('/sampler/hoeren', hoeren),
    post('/sampler/neu_schneiden', neuSchneiden),
    post('/sampler/marke', marke),
    post('/sampler/ursprung', ursprung),
    ...tonRouten(ctx, opt),   // plan C
  ];
  return { name: 'sampler', routen };
}
