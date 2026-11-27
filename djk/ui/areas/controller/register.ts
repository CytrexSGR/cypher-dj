// Controller register (read-only): GET /register lists every controller assignment in one view, and the known devices (catalog.ts) with whether they
// are plugged in. Four places hold assignments: the kern's base mapping
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
import { KATALOG, usbGeraete, usbPasst } from './catalog.ts';
import { echteGeraeteErlaubt } from '../devices/lock.ts';
import { knopfName } from '../learn/beschriftung.ts';
import { AKTIONS_PFADE, zielArt } from '../learn/targets.ts';

export interface RegisterOptionen {
  ordner: string;                              // the controller folder
  aktiv: () => string | null;                  // the device of kern.toml controller_geraet (file name without .json)
  midiPort: () => string | null;               // the MIDI input assigned to learning (controller place 1)
  usb?: () => string[];                        // USB ids of everything plugged in (default: sysfs)
  host: () => Record<string, HostZiel>;        // host_ziele.json
  echte?: boolean;                             // real devices may be connected (default: the production instance yes, a test instance only with CYPHERDJ_ECHTE_GERAETE=1)
}
type Rolle = 'basis' | 'lernen' | 'bruecke' | 'inaktiv';
interface Geraet { id: string; datei: string; rolle: Rolle; eintraege: number; leds: number; fehler: 'json' | 'form' | null }
// besitzer: the device an assignment belongs to, as the page lists devices: "platz:<k>" for the learn table of controller place k, a catalogue id
// (catalog.ts) for the desk bridge (by the channels of the desk file, or as the bridge names it); null for files that are not loaded.
interface Kante { geraet: string; besitzer: string | null; weg: 'kern' | 'seite'; quelle: { typ: string; kanal: number; nr: number } | { name: string }; ziel: string; art: string; kurve: string | null; einheit: string | null }
interface Led { geraet: string; name: string; nachricht: { typ: string; kanal: number; nr: number } }

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const REIHENFOLGE: Record<Rolle, number> = { basis: 0, lernen: 1, bruecke: 2, inaktiv: 3 };

function besitzerVon(id: string, rolle: Rolle, e: Record<string, unknown>, kanal: number | null): string | null {
  if (rolle === 'lernen') return `platz:${id === 'lernen' ? 1 : Number(id.slice(7))}`;
  if (rolle === 'bruecke') return typeof e.geraet === 'string' ? e.geraet : null;
  if (rolle === 'basis' && kanal !== null) return KATALOG.find((k) => k.belegung === id && k.kanaele && kanal >= k.kanaele[0] && kanal <= k.kanaele[1])?.id ?? null;
  return null;
}
function kante(id: string, e: unknown, rolle: Rolle): Kante | null {
  if (!istObjekt(e) || typeof e.ziel !== 'string') return null;
  const n = e.nachricht;
  let quelle: Kante['quelle'];
  if (istObjekt(n)) quelle = { typ: String(n.typ), kanal: Number(n.kanal), nr: Number(n.nr) };
  else if (typeof e.quelle === 'string') quelle = { name: e.quelle };
  else return null;
  const kurve = istObjekt(e.kurve) && typeof e.kurve.typ === 'string' ? e.kurve.typ : null;
  return { geraet: id, besitzer: besitzerVon(id, rolle, e, 'kanal' in quelle ? quelle.kanal : null), weg: e.weg === 'seite' ? 'seite' : 'kern', quelle, ziel: e.ziel, art: typeof e.art === 'string' ? e.art : '', kurve, einheit: reglerInfo(e.ziel)?.einheit ?? null };
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
      const rolle: Rolle = id === aktiv ? 'basis' : /^lernen(-[2-8])?$/.test(id) ? 'lernen' : id === 'bruecke' ? 'bruecke' : 'inaktiv';   // lernen-<k>: the learn table of controller place k
      const g: Geraet = { id, datei, rolle, eintraege: 0, leds: 0, fehler: null };
      geraete.push(g);
      let j: unknown;
      try { j = JSON.parse(fs.readFileSync(path.join(opt.ordner, datei), 'utf8')); } catch (e) { ctx.log({ typ: 'register_datei', datei, fehler: (e as Error).message }); g.fehler = 'json'; continue; }
      if (!istObjekt(j) || j.version !== 1 || !Array.isArray(j.eintraege)) { g.fehler = 'form'; continue; }
      const ks = j.eintraege.map((e) => kante(id, e, rolle)).filter((k): k is Kante => k !== null);
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
    const usb = (opt.usb ?? usbGeraete)();
    const echte = opt.echte ?? echteGeraeteErlaubt();
    // the known devices, plugged in or not (`da`); `verbunden` is what this instance holds: a test instance holds none of the real devices. The bridge path counts the entries of its assignment file
    const katalog = KATALOG.map((k) => ({ id: k.id, name: k.name, weg: k.weg, midi: k.midi, da: usbPasst(k.usb, usb), verbunden: echte && usbPasst(k.usb, usb), belegung: k.belegung,
      eintraege: (k.belegung ? kanten.get(k.belegung) ?? [] : []).filter((e) => !k.kanaele || ('kanal' in e.quelle && e.quelle.kanal >= k.kanaele[0] && e.quelle.kanal <= k.kanaele[1])).length, rueckweg: k.rueckweg, rueckweg_port: k.rueckweg_port, hinweis: k.hinweis, ...(k.regler ? { regler: k.regler } : {}), ...(k.baenke ? { baenke: k.baenke } : {}), ...(k.bedienung ? { bedienung: k.bedienung } : {}) }));
    return { echte_geraete: echte, aktiv: opt.aktiv(), midi_port: opt.midiPort(), katalog, geraete, kanten: geraete.flatMap((g) => kanten.get(g.id) ?? []), leds: geraete.flatMap((g) => leds.filter((l) => l.geraet === g.id)), host: opt.host(), ziele_gesamt: REGLER.size };
  };
  return {
    name: 'register',
    routen: () => [
      // The assignable targets. Without `prefix`: the continuous ones whose path contains `q`, capped by `limit` (default 50, at most 200): what the
      // capture can learn. With `prefix`: EVERY target of a path prefix without a cap, of all three kinds: a target is in when it equals the prefix or lies below it
      // ("deck/1" gives deck/1/fader ... ; empty = all). `art` says what drives it: 'regler' (a knob, CC), 'schalter' (a switch: a button or pad) or
      // 'aktion' (a deck action: a button or pad); the deck actions come first within the answer. A graph knob carries `name`, the knob name of the graph
      // loaded on its channel, where one is known.
      { methode: 'GET', pfad: '/register/ziele', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse, url: URL) => {
        const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        const vor = url.searchParams.get('prefix');
        const n = Number(url.searchParams.get('limit') ?? 50);
        const limit = Number.isFinite(n) ? Math.min(200, Math.max(1, Math.trunc(n))) : 50;
        const vorn = vor === null ? null : vor.trim().replace(/\/+$/, '');
        const passt = (pfad: string): boolean => pfad.toLowerCase().includes(q) && (vorn === null || vorn === '' || pfad === vorn || pfad.startsWith(`${vorn}/`));
        const aktionen = vorn === null ? [] : AKTIONS_PFADE.filter(passt).map((pfad) => ({ pfad, einheit: 'aktion', art: 'aktion' as const }));
        const regler = [...REGLER.values()].filter((r) => (vorn !== null || r.einheit !== 'schalter') && passt(r.pfad)).map((r) => {
          const name = knopfName(ctx, r.pfad);
          return { pfad: r.pfad, einheit: r.einheit, min: r.min, max: r.max, art: zielArt(r.pfad), ...(name ? { name } : {}) };
        });
        const alle = [...aktionen, ...regler];
        json(a, 200, { ziele: vorn === null ? alle.slice(0, limit) : alle, gesamt: alle.length });
      } },
      { methode: 'GET', pfad: '/register', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse) => {
        try { json(a, 200, lies()); } catch (e) { ctx.log({ typ: 'register_fehler', fehler: (e as Error)?.message ?? String(e) }); json(a, 500, { fehler: 'intern' }); }
      } },
    ],
  };
}
