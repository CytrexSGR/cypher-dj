// Presets (package 1.16): HTTP routes under their OWN prefix /presets (never /proj/). Registered by server.ts as a Bereich
// (PATCH-server.diff in this folder); every POST carries schutz fremdePost, so the router answers 415/403 before a handler runs.
//   GET  /presets                          list; filters ?geraet= &geraet_typ= &herkunft= &tag= &q= and by description
//                                          ?familie= &art= &unterart= &charakter= &genre= &einsatz= (comma lists) &energie=3 | 2-4 | 2- | -3
//   GET  /presets/geraete                  device catalogue (parameter names, titles, ranges) for the page
//   GET  /presets/vokabular                the closed vocabulary (version, checksum, word lists, tag counts) for the page and agents
//   POST /presets/suche                    register query {familie?, art?, ..., text?, grenze?} → {gesamt, treffer} (agent tool shape)
//   GET  /presets/suche/schema             the agent tool definition for that query (presets_suchen)
//   GET  /presets/register                 the register built now from the store: {register, ungueltig, doppelt}
//   GET  /presets/register/pruefen         drift of the committed register.json against the factory presets
//   GET  /presets/<herkunft>/<geraet>/<slug>   one preset with its values
//   POST /presets                          save {name, geraet, graph?, werte, beschreibung, tags?, notiz?, ueberschreiben?, erwartet?} → 201 new, 200 overwritten
//                                          (1.16: a save by Cypher carries autor 'cypher'; she may overwrite, rename or delete only those, else 403)
//   POST /presets/nutzer/<geraet>/<slug>/umbenennen {name}   → {slug}
//   POST /presets/nutzer/<geraet>/<slug>/loeschen            → moved to the trash folder
//   GET  /presets/katalog                  1.16 rest: device catalogue for the browser {instrumente, effekte}
//   POST /presets/anwenden                 1.16 rest: {id, ziel} → the apply plan (presets/anwenden.ts); changes nothing itself
//   POST /presets/von_ziel                 1.16 rest: {ziel, name, beschreibung, tags?, notiz?, ueberschreiben?} → saved like POST /presets
// Factory presets (herkunft werk) only read: any write on /presets/werk/... is 403 werk_schreibgeschuetzt.
// A refusal is {fehler, text} plus, for beschreibung_ungueltig and anfrage_ungueltig, details [{feld, code, wert?, erlaubt?}].
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../http/router.ts';
import { json, koerper } from '../http/transport.ts';
import { GERAETE } from './geraete.ts';
import { ANZAHL } from './vokabular.ts';
import { PresetFehler, pruefeHerkunft, type BeschreibungsFilter } from './modell.ts';
import { PresetSpeicher, type SpeicherOptionen } from './speicher.ts';
import { bauen, frage, frageSchema, liesRegister, pruefe, pruefeAnfrage, FrageFehler, WERK_REGISTER } from './register.ts';
import { PRESET_ID } from './preset_id.ts';
import { planeAnwendung, werteVonZiel, type Ziel } from './anwenden.ts';
import { INSERT_ARTEN_AKTIV, type Projekt } from '../projekt/modell.ts';
import { listeGraphen, type GraphEintrag } from '../graphen.ts';

// register: the committed factory register checked by /presets/register/pruefen (default presets/register.json)
// projekt: the open project (1.16 rest, apply plan and von_ziel; absent = no project); graphen: the Baukasten graphs (default graphen.ts)
export interface PresetOptionen extends SpeicherOptionen {
  speicher?: PresetSpeicher; register?: string; projekt?: () => Projekt | null; graphen?: () => readonly Pick<GraphEintrag, 'name' | 'art'>[];
}

// 1.16 rest (S3): the device catalogue of the PRODUCTION browser. Instruments always make a new track (spur_neu); effects become a
// stage at the end of a chain (insert), `aktiv` from INSERT_ARTEN_AKTIV. No grand piano device exists in the code; none is listed.
export function katalog(graphen: readonly Pick<GraphEintrag, 'name' | 'art'>[]): Record<string, unknown> {
  const aktiv = (art: string): boolean => (INSERT_ARTEN_AKTIV as readonly string[]).includes(art);
  const effekt = (geraet: string, titel: string, grund: string): Record<string, unknown> =>
    ({ geraet, titel, ziel: 'insert', aktiv: aktiv(geraet), ...(aktiv(geraet) ? {} : { grund }) });
  return {
    instrumente: [{ geraet: 'rb338', titel: 'RB-338', ziel: 'spur_neu' }, { geraet: 'surge', titel: 'Surge', ziel: 'spur_neu' },
      ...graphen.filter((g) => g.art === 'instrument').map((g) => ({ geraet: 'bk', titel: g.name, ziel: 'spur_neu', graph: g.name }))],
    effekte: [effekt('komp', 'Compressor', 'not active yet'), effekt('eq', 'EQ', 'comes with slice 4b'), effekt('saett', 'Saett', 'comes with slice 4b'),
      { geraet: 'hall', titel: 'Hall', ziel: 'insert', aktiv: false, grund: 'the return hall lives on returns' }],
  };
}
type Ctx = Pick<BereichKontext, 'log' | 'quelle'>;

const EINZEL = /^\/presets\/([^/]+)\/([^/]+)\/([^/]+?)(\/umbenennen|\/loeschen)?$/;

// Description filters from the query string, in the register's query shape, so the same validation (words from the vocabulary
// only, P-R6) applies to the page list and to agents. Lists are comma separated; energie is one value or a range a-b, a-, -b.
const LISTEN = ['art', 'unterart', 'charakter', 'genre', 'einsatz'] as const;
export function beschreibungsFilter(s: URLSearchParams): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  const fam = s.get('familie');
  if (fam !== null && fam !== '') a.familie = fam;
  for (const k of LISTEN) { const v = s.get(k); if (v !== null && v !== '') a[k] = v.split(',').map((w) => w.trim()); }
  const e = s.get('energie');
  if (e !== null && e !== '') {
    const zahl = (x: string): number | string => (/^\d+$/.test(x) ? Number(x) : x);
    const m = /^(\d*)-(\d*)$/.exec(e);
    a.energie = m && (m[1] || m[2]) ? { ...(m[1] ? { min: zahl(m[1]) } : {}), ...(m[2] ? { max: zahl(m[2]) } : {}) } : zahl(e);
  }
  return a;
}

// A lock held by a foreign process (409 preset_busy): retry up to 4 times after 25 ms, never block (as server.ts wiederhole)
async function wiederhole<T>(f: () => T): Promise<T> {
  for (let i = 0; ; i++) {
    try { return f(); }
    catch (e) { if (!(e instanceof PresetFehler) || e.fehler !== 'preset_busy' || i >= 4) throw e; await new Promise((ok) => setTimeout(ok, 25)); }
  }
}

// A preset by its register id "<herkunft>:<geraet>/<slug>" for the project command preset_anwenden (1.9, O28): its device and values, or null for
// an id that is malformed, names no file or names a damaged one. Never throws.
export function presetInhaltVon(speicher: PresetSpeicher, id: string): { geraet: string; werte: Record<string, unknown> } | null {
  const m = /^(werk|nutzer):([a-z0-9]+)\/([a-z0-9-]+)$/.exec(id);
  if (!m) return null;
  try { const p = speicher.lies(m[1] as 'werk' | 'nutzer', m[2], m[3]); return { geraet: p.geraet, werte: p.werte }; } catch { return null; }
}

// The own prefix: /presets and everything below it, nothing else (not /presetsx, never /proj/...)
export const istPresetPfad = (p: string): boolean => p === '/presets' || p.startsWith('/presets/');

export function presetsBereich(ctx: Ctx, opt: PresetOptionen = {}): Bereich & { speicher: PresetSpeicher } {
  const speicher = opt.speicher ?? new PresetSpeicher(opt);
  const registerDatei = opt.register ?? WERK_REGISTER;
  const fehler = (a: http.ServerResponse, e: unknown): void => {
    if (e instanceof PresetFehler) return json(a, e.code, { fehler: e.fehler, text: e.text, ...(e.details ? { details: e.details } : {}) });
    if (e instanceof FrageFehler) return json(a, 400, { fehler: 'anfrage_ungueltig', text: e.message, details: e.fehler });
    ctx.log({ typ: 'presets_fehler', fehler: (e as Error)?.message ?? String(e) });
    json(a, 500, { fehler: 'intern', text: 'internal error in the preset store' });
  };
  const lesen = async (q: http.IncomingMessage): Promise<Record<string, unknown>> => {
    try { return await koerper(q); } catch { throw new PresetFehler(400, 'koerper_ungueltig'); }
  };
  // Path parts come URL-encoded; a part that does not decode is simply not a valid slug
  const teil = (s: string): string => { try { return decodeURIComponent(s); } catch { return '\u0000'; } };

  const handler = async (q: http.IncomingMessage, a: http.ServerResponse, url: URL): Promise<void> => {
    try {
      const p = url.pathname;
      if (p === '/presets' && q.method === 'GET') {
        const s = url.searchParams;
        const b = beschreibungsFilter(s);
        const falsch = pruefeAnfrage(b, speicher.vok);
        if (falsch.length) throw new PresetFehler(400, 'anfrage_ungueltig', undefined, falsch);
        const f = { q: s.get('q') ?? undefined, tag: s.get('tag') ?? undefined, geraet: s.get('geraet') ?? undefined,
          geraet_typ: s.get('geraet_typ') ?? undefined, herkunft: s.get('herkunft') ?? undefined, ...(b as BeschreibungsFilter) };
        return json(a, 200, speicher.liste(f).map(({ notiz: _n, ...e }) => e));
      }
      if (p === '/presets/geraete' && q.method === 'GET') return json(a, 200, GERAETE);
      if (p === '/presets/vokabular' && q.method === 'GET') {
        const v = speicher.vok;
        return json(a, 200, { version: v.version, pruefsumme: v.pruefsumme, inhalt: v.inhalt, anzahl: ANZAHL });
      }
      if (p === '/presets/suche' && q.method === 'POST') return json(a, 200, frage(bauen(speicher).register, await lesen(q), speicher.vok));
      if (p === '/presets/suche/schema' && q.method === 'GET') return json(a, 200, frageSchema(speicher.vok));
      if (p === '/presets/register' && q.method === 'GET') return json(a, 200, bauen(speicher));
      if (p === '/presets/register/pruefen' && q.method === 'GET') return json(a, 200, pruefe(liesRegister(registerDatei), speicher, ['werk']));
      if (p === '/presets/katalog' && q.method === 'GET') return json(a, 200, katalog(opt.graphen?.() ?? listeGraphen().graphen));
      if (p === '/presets/anwenden' && q.method === 'POST') {
        const d = await lesen(q);
        if (typeof d.id !== 'string' || !PRESET_ID.test(d.id)) throw new PresetFehler(400, 'preset_id_ungueltig');
        const [, herkunft, geraet, slug] = /^(werk|nutzer):([^/]+)\/(.+)$/.exec(d.id)!;
        const preset = speicher.lies(pruefeHerkunft(herkunft), geraet, slug);
        return json(a, 200, planeAnwendung({ ...preset, id: d.id }, d.ziel as Ziel, opt.projekt?.() ?? null));
      }
      if (p === '/presets/von_ziel' && q.method === 'POST') {
        const d = await lesen(q);
        const v = werteVonZiel(d.ziel as Ziel, opt.projekt?.() ?? null);
        const r = await wiederhole(() => speicher.speichere(
          { name: d.name, geraet: v.geraet, graph: v.graph, werte: v.werte, beschreibung: d.beschreibung, tags: d.tags, notiz: d.notiz },
          { ueberschreiben: d.ueberschreiben === true, quelle: ctx.quelle() }));
        ctx.log({ typ: 'preset_gespeichert', geraet: r.preset.geraet, slug: r.slug, neu: r.neu, quelle: ctx.quelle(), von_ziel: true });
        return json(a, r.neu ? 201 : 200, { herkunft: 'nutzer', geraet: r.preset.geraet, slug: r.slug, geaendert: r.preset.geaendert });
      }
      if (p === '/presets' && q.method === 'POST') {
        const d = await lesen(q);
        const r = await wiederhole(() => speicher.speichere(
          { name: d.name, geraet: d.geraet, geraet_typ: d.geraet_typ, graph: d.graph, werte: d.werte, beschreibung: d.beschreibung, tags: d.tags, notiz: d.notiz },
          { ueberschreiben: d.ueberschreiben === true, erwartet: typeof d.erwartet === 'string' ? d.erwartet : undefined, quelle: ctx.quelle() }));
        ctx.log({ typ: 'preset_gespeichert', geraet: r.preset.geraet, slug: r.slug, neu: r.neu, quelle: ctx.quelle() });
        return json(a, r.neu ? 201 : 200, { herkunft: 'nutzer', geraet: r.preset.geraet, slug: r.slug, geaendert: r.preset.geaendert });
      }
      const m = EINZEL.exec(p);
      if (!m) return json(a, 404, { fehler: 'nicht_gefunden', text: 'no such preset route' });
      const herkunft = pruefeHerkunft(teil(m[1])), geraet = teil(m[2]), slug = teil(m[3]), was = m[4] ?? '';
      if (q.method === 'GET' && was === '') {
        const { verworfen, ...preset } = speicher.lies(herkunft, geraet, slug);
        return json(a, 200, verworfen.length ? { ...preset, verworfen } : preset);
      }
      if (q.method !== 'POST' || was === '') return json(a, 405, { fehler: 'methode', text: 'method not allowed on this preset route' });
      if (herkunft === 'werk') throw new PresetFehler(403, 'werk_schreibgeschuetzt');
      if (was === '/umbenennen') {
        const d = await lesen(q);
        const r = await wiederhole(() => speicher.benenne(geraet, slug, d.name, ctx.quelle()));
        ctx.log({ typ: 'preset_umbenannt', geraet, slug, neu: r.slug, quelle: ctx.quelle() });
        return json(a, 200, { ok: true, herkunft, geraet, slug: r.slug });
      }
      await wiederhole(() => speicher.loesche(geraet, slug, ctx.quelle()));
      ctx.log({ typ: 'preset_geloescht', geraet, slug, quelle: ctx.quelle() });
      return json(a, 200, { ok: true });
    } catch (e) { fehler(a, e); }
  };

  const route: Route = { methode: '*', pfad: istPresetPfad, schutz: 'fremdePost', handler };
  return { name: 'presets', routen: () => [route], speicher };
}
