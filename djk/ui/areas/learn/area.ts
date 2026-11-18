// S19 (MIDI learn): bereich lernen. GET /lernen (assignments with their controller place, what is waiting, the controller places, state of the files), POST /lernen (arm a graph
// knob, pfad null cancels), POST /lernen/setzen (assign a CC or a note to a target directly), POST /lernen/loeschen (remove an assignment). Learning needs a hand on the hardware: only Andreas arms or deletes
// (Cypher gets 403 nur_andreas). The capture takes a graph knob bk/1..64 or any continuous control of the table (controls_info.ts, unit not a switch), CC only.
// The direct assignment also takes a switch or a deck action (targets.ts) from a button or pad; the server picks the art of the entry from the target.
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { grundText } from '../../http/reasons.ts';
import { json } from '../../http/transport.ts';
import { controllerOrdner, geraeteDatei } from '../../paths.ts';
import { leseKoerper } from '../proj/area.ts';
import { ProjFehler } from '../proj/session.ts';
import { GeraeteFehler, GeraeteSpeicher, controllerPlaetze, type ControllerPlatz } from '../devices/store.ts';
import { beschriftung } from './beschriftung.ts';
import { LernAblauf, type Zeit } from './flow.ts';
import { LernFehler, LernSpeicher, PLAETZE } from './store.ts';
import { eintragsArt, zielArt } from './targets.ts';

export interface LernenOptionen { ordner?: string; geraeteKonfig?: string; fristMs?: number; zeit?: Zeit }

// What the capture can arm: a continuous target (a graph knob bk/1..64 or any control of the table whose unit is not a switch). A switch needs a button.
const erfassbar = (p: unknown): p is string => zielArt(p) === 'regler';
const zielFehler = (p: unknown, mitNull: boolean): LernFehler => zielArt(p) === 'schalter'
  ? new LernFehler('argument_ungueltig', 400, 'pfad: a switch needs a button; only knobs can be learned (notes are not learnable yet)')
  : new LernFehler('argument_ungueltig', 400, `pfad: a continuous target such as deck/1/fader or erz/5/bk/3${mitNull ? ', or null to cancel' : ''}`);
// What a direct assignment or a delete takes: any of the three kinds of targets.ts.
const setzbar = (p: unknown): p is string => zielArt(p) !== null;
const setzFehler = (): LernFehler => new LernFehler('argument_ungueltig', 400, 'pfad: a continuous target such as deck/1/fader, a switch such as deck/1/pfl or deck/1/kill/tief, or the deck action deck/1/play or deck/1/cue');

// What the host learn Bereich (areas/hostlernen) borrows: the same checks and the same arming as POST /lernen, without the HTTP layer.
export interface LernenBereich extends Bereich {
  speicher: LernSpeicher;
  pruefeBereit(): void;                     // throws LernFehler kein_midi_eingang / lernen_datei_kaputt (409) like POST /lernen
  arme(pfad: string): void;                 // pruefeBereit + arm the kern for this knob
  wartet(): string | null;                  // the armed path
  abbrechen(): void;
  midiPort(): string | null;                // the MIDI input on place 1 (null without one or with a damaged devices file)
  controller(): Required<ControllerPlatz>[]; // every assigned controller place (1..8), empty with a damaged devices file
  loesche(pfad: string): Promise<void>;     // remove the learn assignment (keine_zuordnung 404 when there is none)
}

export function lernenBereich(ctx: BereichKontext, opt: LernenOptionen = {}): LernenBereich {
  const speicher = new LernSpeicher(opt.ordner ?? controllerOrdner());
  const geraete = new GeraeteSpeicher(opt.geraeteKonfig ?? geraeteDatei());
  const ablauf = new LernAblauf(ctx, speicher, { fristMs: opt.fristMs, zeit: opt.zeit });
  const midiPort = (): string | null => { try { return geraete.lies().midi.port; } catch { return null; } };   // a damaged devices file means: no port known
  const controller = (): Required<ControllerPlatz>[] => { try { return controllerPlaetze(geraete.lies()); } catch { return []; } };

  const lage = (): Record<string, unknown> => {
    const s = speicher.lies();
    return { zuordnungen: s.zuordnungen.map((z) => ({ ...z, name: beschriftung(ctx, z.pfad) })), wartet: ablauf.lage(), midi: { port: midiPort() }, controller: controller(), datei: s.datei };
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

  const pruefeBereit = (): void => {
    if (controller().length === 0) throw new LernFehler('kein_midi_eingang', 409);
    if (speicher.lies().datei === 'kaputt') throw new LernFehler('lernen_datei_kaputt', 409);   // better refuse now than learn in vain
  };

  return {
    name: 'lernen',
    speicher,
    pruefeBereit,
    arme(pfad: string): void { pruefeBereit(); ablauf.scharf(pfad); },
    wartet: () => ablauf.lage()?.pfad ?? null,
    abbrechen: () => ablauf.abbrechen(),
    midiPort,
    controller,
    loesche: (pfad: string) => ablauf.loesche(pfad),
    routen: () => [
      { methode: 'GET', pfad: '/lernen', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse) => {
        try { json(a, 200, lage()); } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
      } },
      schreib('/lernen', (d) => {
        if (d.pfad === null) { ablauf.abbrechen(); return; }
        if (!erfassbar(d.pfad)) throw zielFehler(d.pfad, true);
        pruefeBereit();
        ablauf.scharf(d.pfad);
      }),
      // Direct assignment from a controller layout: CC or note <nr> (typ, default cc) on channel <kanal> of controller place <platz> drives <pfad>,
      // without moving a knob. The art follows from the target: a continuous target is a CC "absolut", a switch or deck action a press "taste".
      schreib('/lernen/setzen', async (d) => {
        if (!setzbar(d.pfad)) throw setzFehler();
        if (d.typ !== undefined && d.typ !== 'cc' && d.typ !== 'note') throw new LernFehler('argument_ungueltig', 400, "typ: 'cc' or 'note'");
        const typ = d.typ === 'note' ? 'note' : 'cc';
        const art = eintragsArt(zielArt(d.pfad)!, typ);
        if (art === null) throw new LernFehler('argument_ungueltig', 400, 'typ: a note has no value for a continuous target; pick a switch or a deck action for a pad, or a CC for a knob');
        const ganz = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
        if (!ganz(d.kanal, 1, 16)) throw new LernFehler('argument_ungueltig', 400, 'kanal: a MIDI channel 1..16');
        if (!ganz(d.nr, 0, 127)) throw new LernFehler('argument_ungueltig', 400, 'nr: a CC or note number 0..127');
        if (!ganz(d.platz, 1, PLAETZE)) throw new LernFehler('argument_ungueltig', 400, `platz: a controller place 1..${PLAETZE}`);
        pruefeBereit();
        if (!controller().some((c) => c.platz === d.platz)) throw new LernFehler('argument_ungueltig', 400, `platz: no controller on place ${d.platz}`);
        await ablauf.setze(d.pfad, d.kanal, d.nr, d.platz, { typ, art });
      }),
      schreib('/lernen/loeschen', async (d) => {
        if (!setzbar(d.pfad)) throw setzFehler();
        await ablauf.loesche(d.pfad);
      }),
    ],
    ereignis(adresse: string, f: Record<string, unknown>): void { ablauf.ereignis(adresse, f); },
  };
}
