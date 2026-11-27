// I08: Bereich geraete. GET /geraete (Lage: Eingänge, erkannte Quellen, Profile, Kern-Zustand), POST /geraete/eingang, /geraete/midi, /geraete/controller, /geraete/latenz.
// Schreiben nur mit fremdePost (Router); Quelle aus x-djk-quelle. Zuordnung und Freigabe nur andreas (F3). Kanten-Datei und Konfiguration werden atomar
// geschrieben; Hotplug ändert sie nicht (der Verbinder des Kerns holt Kanten nach, sobald beide Ports da sind).
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { grundText } from '../../http/reasons.ts';
import { json } from '../../http/transport.ts';
import { leseKoerper } from '../proj/area.ts';
import { ProjFehler } from '../proj/session.ts';
import { eingangsKantenDatei, geraeteDatei } from '../../paths.ts';
import { setzeController, setzeEingang, setzeLatenz, setzeMidi, type Quelle } from './change.ts';
import { baueKantenText, schreibeAtomar } from './edges.ts';
import { PROFILE, profil } from './profile.ts';
import { pwDumpErkenne, LEER, type Erkennung } from './pwdump.ts';
import { GeraeteFehler, GeraeteSpeicher, controllerPlaetze, type Konfig } from './store.ts';
import { echteGeraeteErlaubt, istEchtesGeraet } from './lock.ts';

// beiAenderung: called after every written change of the devices file (the controller follow re-resolves when a place starts following or its device changes)
export interface GeraeteOptionen { beiAenderung?: () => void; konfigPfad?: string; kantenPfad?: string; erkenne?: () => Promise<Erkennung>; cacheMs?: number; jetzt?: () => number; kernFristMs?: number;
  echteGeraete?: boolean }   // real MIDI devices may be wired; default: the production instance yes, a test instance only with CYPHERDJ_ECHTE_GERAETE=1 (lock.ts)

const num = (x: unknown): number => Number(x ?? 0);

export function geraeteBereich(ctx: BereichKontext, opt: GeraeteOptionen = {}): Bereich {
  const speicher = new GeraeteSpeicher(opt.konfigPfad ?? geraeteDatei());
  const kantenPfad = opt.kantenPfad ?? eingangsKantenDatei();
  const erkenneRoh = opt.erkenne ?? pwDumpErkenne;
  const uhr = opt.jetzt ?? Date.now, kernFrist = opt.kernFristMs ?? 2000;
  const echte = opt.echteGeraete ?? echteGeraeteErlaubt();
  const gesperrt = (port: string | null): boolean => !echte && port !== null && istEchtesGeraet(port);   // a real device this instance does not wire
  let kern: Record<string, number> | null = null;       // letzter /zustand/ein
  let kernZeit = 0;                                     // Gesamtreview m4: wann er kam; der Kern meldet im Takt der Pegel (50 ms), 2 s Schweigen heißt: unbekannt
  const pegel = new Map<string, number>();              // letzter /pegel je ein/<k>
  let cache: { bis: number; p: Promise<Erkennung> } | null = null;
  const erkenne = (): Promise<Erkennung> => {           // eine Abfrage je Sekunde, gemeinsam genutzt
    const jetzt = Date.now();
    if (!cache || cache.bis <= jetzt) cache = { bis: jetzt + (opt.cacheMs ?? 1000), p: erkenneRoh() };
    return cache.p;
  };
  const schreibeAlles = (k: Konfig): void => { speicher.schreibe(k); schreibeAtomar(kantenPfad, baueKantenText(k, echte)); };
  // Beim Start die Kanten-Datei zur vorhandenen Konfiguration herstellen (der Kern liest sie bei seinem Start). Ohne Konfigurationsdatei: nichts anfassen.
  try { if (speicher.existiert()) schreibeAtomar(kantenPfad, baueKantenText(speicher.lies(), echte)); } catch (e) { ctx.log({ typ: 'geraete_start_fehler', fehler: (e as Error).message }); }

  async function lage(): Promise<Record<string, unknown>> {
    let erk = LEER, erkennung = 'ok';
    try { erk = await erkenne(); } catch (e) { erkennung = 'nicht_verfuegbar'; ctx.log({ typ: 'geraete_erkennung_fehler', fehler: (e as Error).message }); }
    const k = speicher.lies();
    const lebt = kern !== null && uhr() - kernZeit <= kernFrist;
    const maske = lebt ? (kern?.verbunden ?? 0) : 0;
    const vb = (bit: number): boolean | null => (lebt ? (maske & bit) !== 0 : null);   // null = unbekannt (Kern still oder noch nie gehört)
    return {
      erkennung,
      eingaenge: k.eingaenge.map((e) => ({
        ...e,
        da: !!e.audio && e.audio.ports.every((p) => erk.audio.some((q) => q.ports.includes(p))),
        verbunden: vb(1 << (e.k - 1)),
        pegel_db: pegel.get(`ein/${e.k}`) ?? null,
        audio_hinweis: e.profil ? (profil(e.profil)?.audio?.hinweis ?? '') : '',
      })),
      echte_geraete: echte,   // false: a test instance, real devices are listed as present and never connected
      midi: { ...k.midi, da: !!k.midi.port && erk.midi.some((m) => m.port === k.midi.port), gesperrt: gesperrt(k.midi.port), verbunden: gesperrt(k.midi.port) ? false : vb(256) },
      // every controller place (1 = the MIDI input above): bit 7 + platz of the kern's mask says whether its raw input midi_ein_<platz> is linked
      controller: controllerPlaetze(k).map((c) => ({ ...c, da: erk.midi.some((m) => m.port === c.port), gesperrt: gesperrt(c.port), verbunden: gesperrt(c.port) ? false : vb(1 << (7 + c.platz)) })),
      quellen: { ...erk, midi: erk.midi.map((m) => ({ ...m, gesperrt: gesperrt(m.port) })) },
      profile: PROFILE.map((p) => ({ id: p.id, name: p.name, audio: p.audio !== null, midi: p.midi !== null, audio_hinweis: p.audio?.hinweis ?? '' })),
      kern: { ein: lebt ? kern : null },
    };
  }

  const antwort = (e: unknown): { code: number; j: Record<string, unknown> } => {
    if (e instanceof GeraeteFehler) return { code: e.code, j: { fehler: e.grund, text: e.text || grundText(e.grund) } };
    if (e instanceof ProjFehler) return { code: e.code, j: { fehler: e.fehler, text: grundText(e.fehler), ...e.extra } };
    ctx.log({ typ: 'geraete_fehler', fehler: (e as Error)?.message ?? String(e) });
    return { code: 500, j: { fehler: 'intern', text: grundText('intern') } };
  };
  let kette: Promise<unknown> = Promise.resolve();   // Schreibwege nacheinander
  const schreib = (pfad: string, f: (k: Konfig, d: Record<string, unknown>, q: Quelle, erk: Erkennung) => Konfig): Route => ({
    methode: 'POST', pfad, schutz: 'fremdePost',
    handler: async (q: http.IncomingMessage, a: http.ServerResponse) => {
      const quelle = ctx.quelle();
      const lauf = kette.then(async () => {
        const d = await leseKoerper(q);
        let erk = LEER;
        try { erk = await erkenne(); } catch { /* ohne Erkennung nur mit ausdrücklichen Ports */ }
        const alt = speicher.lies();
        const neu = f(alt, d, quelle, erk);
        const neuePorts = [neu.midi.port, ...(neu.controller ?? []).map((c) => c.port)].filter((p): p is string => p !== null && ![alt.midi.port, ...(alt.controller ?? []).map((c) => c.port)].includes(p));
        if (neuePorts.some(gesperrt)) throw new GeraeteFehler('echte_geraete_gesperrt', 409);   // nothing is written: the real devices stay with the production instance
        schreibeAlles(neu);
        cache = null;
        try { opt.beiAenderung?.(); } catch (e) { ctx.log({ typ: 'geraete_haken_fehler', fehler: (e as Error).message }); }
        return lage();
      });
      kette = lauf.catch(() => undefined);
      try { json(a, 200, { ok: true, ...(await lauf) }); } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
    },
  });
  return {
    name: 'geraete',
    routen: () => [
      { methode: 'GET', pfad: '/geraete', schutz: 'offen', handler: async (_q: http.IncomingMessage, a: http.ServerResponse) => {
        try { json(a, 200, await lage()); } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
      } },
      schreib('/geraete/eingang', (k, d, q, erk) => setzeEingang(k, q, d, erk)),
      schreib('/geraete/midi', (k, d, q, erk) => setzeMidi(k, q, d, erk)),
      schreib('/geraete/controller', (k, d, q) => setzeController(k, q, d)),
      schreib('/geraete/latenz', (k, d, q) => setzeLatenz(k, q, d)),
    ],
    ereignis(adresse: string, f: Record<string, unknown>): void {
      if (adresse === '/zustand/ein') { kernZeit = uhr(); kern = { verbunden: num(f.verbunden), midi_gesehen: num(f.midi_gesehen), midi_verloren: num(f.midi_verloren), midi_sample: num(f.midi_sample), flanke_sample: num(f.flanke_sample) }; }
      else if (adresse === '/pegel' && typeof f.kanal === 'string' && f.kanal.startsWith('ein/')) pegel.set(f.kanal, num(f.spitze_db));
    },
  };
}
