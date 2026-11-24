// Preset exchange routes of the browser (plan 6): preview, export and import.
//   POST /presets/vorhoeren {id}   renders (or takes from the cache) a short preview of the preset and plays it on the headphone preview path.
//                                  Answer { ok: true, aus_cache }; a refusal is { ok: false, grund, fehler, text } (the route contract's error shape).
//   GET  /presets/export?id=       the preset file exactly as stored, as a download (open: factory and user presets)
//   POST /presets/import           the file's text as the raw body (Content-Type application/json) → { ok, id, schon_da } (owner, loopback host)
// Registered by presetsBereich before its catch-all route. Without a preview service the preview route is left out.
import fs from 'node:fs';
import type http from 'node:http';
import type { Route } from '../http/router.ts';
import { json, koerper } from '../http/transport.ts';
import { PRESET_ID } from './preset_id.ts';
import { DATEI_MAX, PresetFehler, type Herkunft } from './model.ts';
import type { PresetSpeicher } from './store.ts';
import { PresetVorhoerFehler } from './prelisten.ts';
import { VorhoerFehler, type Element } from '../prelisten.ts';
import type { PresetOptionen } from './area.ts';

type Ctx = { log: (z: Record<string, unknown>) => void; quelle: () => 'cypher' | 'andreas' };

// Texts for the refusals of the headphone previewer (djk/ui/prelisten.ts); http/reasons.ts has none of them
const VORHOERER_TEXT: Readonly<Record<string, string>> = {
  kein_kopfhoerer: 'no headphones are connected to the preview output; connect them and try again',
  ueberholt: 'a newer preview replaced this one',
  kern_ohne_vorhoerkanal: 'the audio core is not running with the headphone preview channel',
};

const abgelehnt = (a: http.ServerResponse, code: number, grund: string, text: string): void => json(a, code, { ok: false, grund, fehler: grund, text });

class ZuGross extends Error {}
// The shared koerper() caps at 32 KiB; a preset file may be DATEI_MAX. Collects up to max bytes, then stops reading and refuses.
function leseRoh(q: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((ok, nein) => {
    const laenge = Number(q.headers['content-length']);
    if (Number.isFinite(laenge) && laenge > max) { q.resume(); return nein(new ZuGross()); }
    const teile: Buffer[] = [];
    let n = 0, fertig = false;
    q.on('data', (c: Buffer) => {
      if (fertig) return;
      n += c.length;
      if (n > max) { fertig = true; q.resume(); return nein(new ZuGross()); }
      teile.push(c);
    });
    q.on('end', () => { if (!fertig) { fertig = true; ok(Buffer.concat(teile)); } });
    q.on('error', (e) => { if (!fertig) { fertig = true; nein(e); } });
  });
}

type AustauschOptionen = Pick<PresetOptionen, 'vorhoerer' | 'spiele' | 'port' | 'neuerKlick'> & { speicher: PresetSpeicher };

export function austauschRouten(ctx: Ctx, opt: AustauschOptionen): Route[] {
  const routen: Route[] = [];
  const { vorhoerer, spiele, speicher, neuerKlick } = opt;
  let klick = 0;   // without a shared sequence (tests): the route's own counter; with one (the page server) the previewer decides across all callers
  if (vorhoerer && spiele) {
    routen.push({ methode: 'POST', pfad: '/presets/vorhoeren', schutz: 'fremdePost', handler: async (q, a) => {
      try {
        let d: Record<string, unknown>;
        try { d = await koerper(q); } catch { return abgelehnt(a, 400, 'koerper_ungueltig', 'the request body must be a JSON object'); }
        if (d.id === undefined) return abgelehnt(a, 400, 'argument_fehlt', 'the preset id is missing (id)');
        if (typeof d.id !== 'string' || !PRESET_ID.test(d.id)) return abgelehnt(a, 400, 'id_ungueltig', 'not a preset id <werk|nutzer>:<device>/<slug>');
        vorhoerer.pruefe(d.id);   // a request that cannot be previewed (hall, unknown, damaged) is refused here and takes no click number: it never cancels an older valid click
        const nr = neuerKlick ? neuerKlick() : ++klick;   // taken when the playable request arrives; only the newest click may play, however long its render took
        const r = await vorhoerer.vorhoer(d.id);
        if (!neuerKlick && nr !== klick) return abgelehnt(a, 409, 'ueberholt', VORHOERER_TEXT.ueberholt);   // rendered (and cached) for next time, but not played
        const e: Element = { pfad: r.datei, typ: 'oneshot', sha: r.schluessel, bpm: null };
        await spiele(e, neuerKlick ? nr : undefined);
        json(a, 200, { ok: true, aus_cache: r.aus_cache });
      } catch (e) {
        if (e instanceof PresetVorhoerFehler) return abgelehnt(a, e.code, e.grund, e.text);
        if (e instanceof VorhoerFehler) return abgelehnt(a, e.code, e.fehler, VORHOERER_TEXT[e.fehler] ?? 'the headphone preview could not play it');
        ctx.log({ typ: 'presets_fehler', fehler: (e as Error)?.message ?? String(e), route: '/presets/vorhoeren' });
        abgelehnt(a, 500, 'intern', 'internal error in the preset preview');
      }
    } });
  }
  // The file exactly as the store keeps it (a factory preset is read from the shipped folder)
  routen.push({ methode: 'GET', pfad: '/presets/export', schutz: 'offen', handler: (_q, a, url) => {
    try {
      const id = url.searchParams.get('id');
      if (id === null) return json(a, 400, { fehler: 'argument_fehlt', text: 'the preset id is missing (id)' });
      const m = PRESET_ID.test(id) ? /^(werk|nutzer):([a-z0-9-]+)\/(.+)$/.exec(id) : null;
      if (!m) return json(a, 400, { fehler: 'id_ungueltig', text: 'not a preset id <werk|nutzer>:<device>/<slug>' });
      speicher.lies(m[1] as Herkunft, m[2], m[3]);   // refuses an unknown, damaged or oversize file with the store's own answer
      const bytes = fs.readFileSync(speicher.pfad(m[1] as Herkunft, m[2], m[3]));
      a.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${m[3]}.preset.json"`, 'content-length': bytes.length });
      a.end(bytes);
    } catch (e) {
      if (e instanceof PresetFehler) return json(a, e.code, { fehler: e.fehler, text: e.text });
      ctx.log({ typ: 'presets_fehler', fehler: (e as Error)?.message ?? String(e), route: '/presets/export' });
      json(a, 500, { fehler: 'intern', text: 'internal error in the preset store' });
    }
  } });
  routen.push({ methode: 'POST', pfad: '/presets/import', schutz: 'fremdePost', handler: async (q, a) => {
    try {
      if (ctx.quelle() !== 'andreas') return abgelehnt(a, 403, 'nur_andreas', 'only Andreas may import presets');
      if (opt.port !== undefined) {   // owner routes answer on a loopback name only (DNS rebinding); the tablet listener is closed for this path by http/coupling.ts
        const host = String(q.headers.host ?? ''), p = typeof opt.port === 'function' ? opt.port() : opt.port;
        if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) return abgelehnt(a, 421, 'falscher_host', 'open the page as http://127.0.0.1:<port>/ to import presets');
      }
      let roh: Buffer;
      try { roh = await leseRoh(q, DATEI_MAX); } catch (e) {
        if (e instanceof ZuGross) return abgelehnt(a, 413, 'zu_gross', `the preset file is larger than ${DATEI_MAX / 1024} KiB`);
        throw e;
      }
      let j: unknown;
      try { j = JSON.parse(roh.toString('utf8')); } catch { return abgelehnt(a, 400, 'kein_json', 'the file is not JSON'); }
      if (j === null || typeof j !== 'object' || Array.isArray(j)) return abgelehnt(a, 400, 'kein_json', 'the file is not a JSON object');
      const r = speicher.importiere(j);
      ctx.log({ typ: 'preset_importiert', id: r.id, schon_da: r.schon_da });
      json(a, 200, { ok: true, id: r.id, schon_da: r.schon_da });
    } catch (e) {
      if (e instanceof PresetFehler) return json(a, e.code, { ok: false, grund: e.fehler, fehler: e.fehler, text: e.text, ...(e.details ? { details: e.details } : {}) });
      ctx.log({ typ: 'presets_fehler', fehler: (e as Error)?.message ?? String(e), route: '/presets/import' });
      abgelehnt(a, 500, 'intern', 'internal error while importing the preset');
    }
  } });
  return routen;
}
