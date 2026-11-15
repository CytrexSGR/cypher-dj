// Controller register (read-only): GET /register lists every controller assignment in one view. Four places hold assignments: the kern's base mapping
// (kern.toml controller_geraet), the learn table lernen.json, the host mappings host_ziele.json and the controls the bridge handles in code (bruecke.json,
// written by djk/hand_bruecke/assignment.py). The register only reads; a damaged or foreign file is listed with an error, never a 500.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { kernToml } from '../proj/config.ts';
import { REGLER, reglerInfo } from '../../../conductor/src/controls_info.ts';
import type { HostZiel } from '../hostlernen/store.ts';

export interface RegisterOptionen {
  ordner: string;                              // the controller folder
  aktiv: () => string | null;                  // the device of kern.toml controller_geraet (file name without .json)
  midiPort: () => string | null;               // the MIDI input assigned to learning
  host: () => Record<string, HostZiel>;        // host_ziele.json
}
type Rolle = 'basis' | 'lernen' | 'bruecke' | 'inaktiv';
interface Geraet { id: string; datei: string; rolle: Rolle; eintraege: number; leds: number; fehler: 'json' | 'form' | null }
interface Kante { geraet: string; weg: 'kern' | 'seite'; quelle: { typ: string; kanal: number; nr: number } | { name: string }; ziel: string; art: string; kurve: string | null; einheit: string | null }
interface Led { geraet: string; name: string; nachricht: { typ: string; kanal: number; nr: number } }

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const REIHENFOLGE: Record<Rolle, number> = { basis: 0, lernen: 1, bruecke: 2, inaktiv: 3 };

function kante(id: string, e: unknown): Kante | null {
  if (!istObjekt(e) || typeof e.ziel !== 'string') return null;
  const n = e.nachricht;
  let quelle: Kante['quelle'];
  if (istObjekt(n)) quelle = { typ: String(n.typ), kanal: Number(n.kanal), nr: Number(n.nr) };
  else if (typeof e.quelle === 'string') quelle = { name: e.quelle };
  else return null;
  const kurve = istObjekt(e.kurve) && typeof e.kurve.typ === 'string' ? e.kurve.typ : null;
  return { geraet: id, weg: e.weg === 'seite' ? 'seite' : 'kern', quelle, ziel: e.ziel, art: typeof e.art === 'string' ? e.art : '', kurve, einheit: reglerInfo(e.ziel)?.einheit ?? null };
}

// The device of kern.toml `controller_geraet = "<name>"` (one-line read like arrOrdner in areas/proj/config.ts); null when unset or unreadable.
export function aktivesPult(instanz: string, datei: string = kernToml(instanz)): string | null {
  let text = '';
  try { text = fs.readFileSync(datei, 'utf8'); } catch { return null; }
  const m = /^[ \t]*controller_geraet[ \t]*=[ \t]*"([^"]*)"[ \t]*(#.*)?$/m.exec(text);
  return m && m[1] !== '' ? m[1].replace(/\.json$/, '') : null;
}

export function registerBereich(ctx: BereichKontext, opt: RegisterOptionen): Bereich {
  const lies = (): Record<string, unknown> => {
    let namen: string[] = [];
    try { namen = fs.readdirSync(opt.ordner); } catch { /* a missing folder is an empty register */ }
    const aktiv = (opt.aktiv() ?? '').replace(/\.json$/, '');
    const geraete: Geraet[] = [];
    const kanten = new Map<string, Kante[]>();
    const leds: Led[] = [];
    for (const datei of namen.filter((n) => n.endsWith('.json') && !n.includes('.bak') && n !== 'host_ziele.json')) {
      const id = datei.slice(0, -5);
      const rolle: Rolle = id === aktiv ? 'basis' : id === 'lernen' ? 'lernen' : id === 'bruecke' ? 'bruecke' : 'inaktiv';
      const g: Geraet = { id, datei, rolle, eintraege: 0, leds: 0, fehler: null };
      geraete.push(g);
      let j: unknown;
      try { j = JSON.parse(fs.readFileSync(path.join(opt.ordner, datei), 'utf8')); } catch (e) { ctx.log({ typ: 'register_datei', datei, fehler: (e as Error).message }); g.fehler = 'json'; continue; }
      if (!istObjekt(j) || j.version !== 1 || !Array.isArray(j.eintraege)) { g.fehler = 'form'; continue; }
      const ks = j.eintraege.map((e) => kante(id, e)).filter((k): k is Kante => k !== null);
      kanten.set(id, ks);
      g.eintraege = ks.length;
      for (const l of Array.isArray(j.leds) ? j.leds : []) {
        if (istObjekt(l) && typeof l.name === 'string' && istObjekt(l.nachricht)) {
          leds.push({ geraet: id, name: l.name, nachricht: { typ: String(l.nachricht.typ), kanal: Number(l.nachricht.kanal), nr: Number(l.nachricht.nr) } });
          g.leds++;
        }
      }
    }
    geraete.sort((a, b) => REIHENFOLGE[a.rolle] - REIHENFOLGE[b.rolle] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { aktiv: opt.aktiv(), midi_port: opt.midiPort(), geraete, kanten: geraete.flatMap((g) => kanten.get(g.id) ?? []), leds: geraete.flatMap((g) => leds.filter((l) => l.geraet === g.id)), host: opt.host(), ziele_gesamt: REGLER.size };
  };
  return {
    name: 'register',
    routen: () => [
      { methode: 'GET', pfad: '/register/ziele', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse, url: URL) => {
        const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        const n = Number(url.searchParams.get('limit') ?? 50);
        const limit = Number.isFinite(n) ? Math.min(200, Math.max(1, Math.trunc(n))) : 50;
        const alle = [...REGLER.values()].filter((r) => r.einheit !== 'schalter' && r.pfad.toLowerCase().includes(q));
        json(a, 200, { ziele: alle.slice(0, limit).map((r) => ({ pfad: r.pfad, einheit: r.einheit, min: r.min, max: r.max })), gesamt: alle.length });
      } },
      { methode: 'GET', pfad: '/register', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse) => {
        try { json(a, 200, lies()); } catch (e) { ctx.log({ typ: 'register_fehler', fehler: (e as Error)?.message ?? String(e) }); json(a, 500, { fehler: 'intern' }); }
      } },
    ],
  };
}
