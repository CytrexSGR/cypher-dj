// I08: Bereich geraete. GET /geraete (Lage: Eingänge, erkannte Quellen, Profile, Kern-Zustand), POST /geraete/eingang, /geraete/midi, /geraete/latenz.
// Schreiben nur mit fremdePost (Router); Quelle aus x-djk-quelle. Zuordnung und Freigabe nur andreas (F3). Kanten-Datei und Konfiguration werden atomar
// geschrieben; Hotplug ändert sie nicht (der Verbinder des Kerns holt Kanten nach, sobald beide Ports da sind).
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { grundText } from '../../http/gruende.ts';
import { json } from '../../http/transport.ts';
import { leseKoerper } from '../proj/bereich.ts';
import { ProjFehler } from '../proj/sitzung.ts';
import { eingangsKantenDatei, geraeteDatei } from '../../pfade.ts';
import { setzeEingang, setzeLatenz, setzeMidi, type Quelle } from './aendern.ts';
import { baueKantenText, schreibeAtomar } from './kanten.ts';
import { PROFILE, profil } from './profile.ts';
import { pwDumpErkenne, LEER, type Erkennung } from './pwdump.ts';
import { GeraeteFehler, GeraeteSpeicher, type Konfig } from './speicher.ts';

export interface GeraeteOptionen { konfigPfad?: string; kantenPfad?: string; erkenne?: () => Promise<Erkennung>; cacheMs?: number; jetzt?: () => number; kernFristMs?: number }

const num = (x: unknown): number => Number(x ?? 0);

export function geraeteBereich(ctx: BereichKontext, opt: GeraeteOptionen = {}): Bereich {
  const speicher = new GeraeteSpeicher(opt.konfigPfad ?? geraeteDatei());
  const kantenPfad = opt.kantenPfad ?? eingangsKantenDatei();
  const erkenneRoh = opt.erkenne ?? pwDumpErkenne;
  const uhr = opt.jetzt ?? Date.now, kernFrist = opt.kernFristMs ?? 2000;
  let kern: Record<string, number> | null = null;       // letzter /zustand/ein
  let kernZeit = 0;                                     // Gesamtreview m4: wann er kam; der Kern meldet im Takt der Pegel (50 ms), 2 s Schweigen heißt: unbekannt
  const pegel = new Map<string, number>();              // letzter /pegel je ein/<k>
  let cache: { bis: number; p: Promise<Erkennung> } | null = null;
  const erkenne = (): Promise<Erkennung> => {           // eine Abfrage je Sekunde, gemeinsam genutzt
    const jetzt = Date.now();
    if (!cache || cache.bis <= jetzt) cache = { bis: jetzt + (opt.cacheMs ?? 1000), p: erkenneRoh() };
    return cache.p;
  };
  const schreibeAlles = (k: Konfig): void => { speicher.schreibe(k); schreibeAtomar(kantenPfad, baueKantenText(k)); };
  // Beim Start die Kanten-Datei zur vorhandenen Konfiguration herstellen (der Kern liest sie bei seinem Start). Ohne Konfigurationsdatei: nichts anfassen.
  try { if (speicher.existiert()) schreibeAtomar(kantenPfad, baueKantenText(speicher.lies())); } catch (e) { ctx.log({ typ: 'geraete_start_fehler', fehler: (e as Error).message }); }

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
      midi: { ...k.midi, da: !!k.midi.port && erk.midi.some((m) => m.port === k.midi.port), verbunden: vb(256) },
      quellen: erk,
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
        const neu = f(speicher.lies(), d, quelle, erk);
        schreibeAlles(neu);
        cache = null;
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
      schreib('/geraete/latenz', (k, d, q) => setzeLatenz(k, q, d)),
    ],
    ereignis(adresse: string, f: Record<string, unknown>): void {
      if (adresse === '/zustand/ein') { kernZeit = uhr(); kern = { verbunden: num(f.verbunden), midi_gesehen: num(f.midi_gesehen), midi_verloren: num(f.midi_verloren), midi_sample: num(f.midi_sample), flanke_sample: num(f.flanke_sample) }; }
      else if (adresse === '/pegel' && typeof f.kanal === 'string' && f.kanal.startsWith('ein/')) pegel.set(f.kanal, num(f.spitze_db));
    },
  };
}
