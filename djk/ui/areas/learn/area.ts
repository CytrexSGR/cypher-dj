// S19 (MIDI learn): bereich lernen. GET /lernen (assignments, what is waiting, the assigned MIDI port, state of the file), POST /lernen (arm a graph
// knob, pfad null cancels), POST /lernen/loeschen (remove an assignment). Learning needs a hand on the hardware: only Andreas arms or deletes
// (Cypher gets 403 nur_andreas). The target rule is the one of the hand routes (PFAD from hand_operation.ts) narrowed to graph knobs bk/1..8.
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { grundText } from '../../http/reasons.ts';
import { json } from '../../http/transport.ts';
import { PFAD } from '../../hand_operation.ts';
import { controllerOrdner, geraeteDatei } from '../../paths.ts';
import { leseKoerper } from '../proj/area.ts';
import { ProjFehler } from '../proj/session.ts';
import { GeraeteFehler, GeraeteSpeicher } from '../devices/store.ts';
import { LernAblauf, type Zeit } from './flow.ts';
import { LernFehler, LernSpeicher } from './store.ts';

export interface LernenOptionen { ordner?: string; geraeteKonfig?: string; fristMs?: number; zeit?: Zeit }

const gueltigesZiel = (p: unknown): p is string => typeof p === 'string' && PFAD.test(p) && /\/bk\/[1-8]$/.test(p);

export function lernenBereich(ctx: BereichKontext, opt: LernenOptionen = {}): Bereich {
  const speicher = new LernSpeicher(opt.ordner ?? controllerOrdner());
  const geraete = new GeraeteSpeicher(opt.geraeteKonfig ?? geraeteDatei());
  const ablauf = new LernAblauf(ctx, speicher, { fristMs: opt.fristMs, zeit: opt.zeit });
  const midiPort = (): string | null => { try { return geraete.lies().midi.port; } catch { return null; } };   // a damaged devices file means: no port known

  const lage = (): Record<string, unknown> => {
    const s = speicher.lies();
    return { zuordnungen: s.zuordnungen, wartet: ablauf.lage(), midi: { port: midiPort() }, datei: s.datei };
  };
  const antwort = (e: unknown): { code: number; j: Record<string, unknown> } => {
    if (e instanceof LernFehler) return { code: e.code, j: { fehler: e.grund, text: e.text || grundText(e.grund) } };
    if (e instanceof GeraeteFehler) return { code: e.code, j: { fehler: e.grund, text: e.text || grundText(e.grund) } };
    if (e instanceof ProjFehler) return { code: e.code, j: { fehler: e.fehler, text: grundText(e.fehler), ...e.extra } };
    ctx.log({ typ: 'lernen_fehler', fehler: (e as Error)?.message ?? String(e) });
    return { code: 500, j: { fehler: 'intern', text: grundText('intern') } };
  };
  const nurAndreas = (): void => { if (ctx.quelle() !== 'andreas') throw new LernFehler('nur_andreas', 403); };
  const schreib = (pfad: string, f: (d: Record<string, unknown>) => Promise<void> | void): Route => ({
    methode: 'POST', pfad, schutz: 'fremdePost',
    handler: async (q: http.IncomingMessage, a: http.ServerResponse) => {
      try {
        const d = await leseKoerper(q);
        nurAndreas();
        await f(d);
        json(a, 200, { ok: true, ...lage() });
      } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
    },
  });

  return {
    name: 'lernen',
    routen: () => [
      { methode: 'GET', pfad: '/lernen', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse) => {
        try { json(a, 200, lage()); } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
      } },
      schreib('/lernen', (d) => {
        if (d.pfad === null) { ablauf.abbrechen(); return; }
        if (!gueltigesZiel(d.pfad)) throw new LernFehler('argument_ungueltig', 400, 'pfad: a graph knob such as erz/5/bk/3, or null to cancel');
        if (!midiPort()) throw new LernFehler('kein_midi_eingang', 409);
        if (speicher.lies().datei === 'kaputt') throw new LernFehler('lernen_datei_kaputt', 409);   // better refuse now than learn in vain
        ablauf.scharf(d.pfad);
      }),
      schreib('/lernen/loeschen', async (d) => {
        if (!gueltigesZiel(d.pfad)) throw new LernFehler('argument_ungueltig', 400, 'pfad: a graph knob such as erz/5/bk/3');
        await ablauf.loesche(d.pfad);
      }),
    ],
    ereignis(adresse: string, f: Record<string, unknown>): void { ablauf.ereignis(adresse, f); },
  };
}
