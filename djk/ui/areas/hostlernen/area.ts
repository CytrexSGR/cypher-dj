// Host learn (MIDI learn for the parameters of the instrument host on erz/2 = bass and erz/3 = melodie, Surge XT, RB-338, Cypher Modular VST3).
// The core already learns CC onto the slot rows `erz/2|3/bk/1..64`; this Bereich gives such a slot a host parameter (host_ziele.json) and, while no graph is
// loaded on the channel, forwards the slot's CC moves to the host (weiterleitung.ts). Routes: GET /lernen/host (the mappings, learned or waiting),
// POST /lernen/host {kanal, name} (pick the lowest free slot, put the row on the parameter's current value so the controller picks up from there, arm
// learning for the slot; answers {pfad}), POST /lernen/host/loeschen {kanal, name} (forget host mapping and CC assignment). Only Andreas arms or deletes.
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { grundText } from '../../http/reasons.ts';
import { json } from '../../http/transport.ts';
import { RB338_PARAM_NAMEN, parameterTabelle, type Parameter } from '../../devices_parameter.ts';
import { leseKoerper } from '../proj/area.ts';
import { ProjFehler } from '../proj/session.ts';
import { GeraeteFehler } from '../devices/store.ts';
import { LernFehler } from '../learn/store.ts';
import type { LernenBereich } from '../learn/area.ts';
import { HostSpeicher, freierSlot, slotNr, type HostArt, type HostZiel } from './store.ts';
import { Weiterleitung, normVonAnzeige } from './weiterleitung.ts';

export interface HostLernenOptionen { ordner: string; surgeParameter?: (name: string) => Parameter | undefined }

const KANAL_GRUPPE: Record<string, string> = { 'erz/2': 'bass', 'erz/3': 'melodie' };
const artVon = (wirtArt: string): HostArt | null => (wirtArt === 'lv2' ? 'surge' : wirtArt === 'vst3:rb338' ? 'rb338' : wirtArt.startsWith('vst3:') ? 'vst3' : null);

export function hostlernenBereich(ctx: BereichKontext, lernen: LernenBereich, opt: HostLernenOptionen): Bereich {
  const speicher = new HostSpeicher(opt.ordner);
  let surgeTabelle: Map<string, Parameter> | null = null;
  const surgeParameter = opt.surgeParameter ?? ((name: string) => {
    surgeTabelle ??= new Map(parameterTabelle({ art: 'surge' }).map((p) => [p.name, p]));
    return surgeTabelle.get(name);
  });
  const weiter = new Weiterleitung({ host: () => ctx.host, ziele: () => speicher.lies().ziele, geladen: () => ctx.baukasten?.geladen() ?? {}, surgeParameter, log: (z) => ctx.log(z) });

  const antwort = (e: unknown): { code: number; j: Record<string, unknown> } => {
    if (e instanceof LernFehler || e instanceof GeraeteFehler) return { code: e.code, j: { fehler: e.grund, text: e.text || grundText(e.grund) } };
    if (e instanceof ProjFehler) return { code: e.code, j: { fehler: e.fehler, text: grundText(e.fehler), ...e.extra } };
    ctx.log({ typ: 'hostlernen_fehler', fehler: (e as Error)?.message ?? String(e) });
    return { code: 500, j: { fehler: 'intern', text: grundText('intern') } };
  };
  const nurAndreas = (): void => { if (ctx.quelle() !== 'andreas') throw new LernFehler('nur_andreas', 403); };
  const argument = (text: string): LernFehler => new LernFehler('argument_ungueltig', 400, text);
  const kanalUndName = (d: Record<string, unknown>): { kanal: string; gruppe: string; name: string } => {
    const kanal = d.kanal;
    if (typeof kanal !== 'string' || !(kanal in KANAL_GRUPPE)) throw argument('kanal: erz/2 or erz/3');
    if (typeof d.name !== 'string' || d.name === '' || d.name.length > 80) throw argument('name: the parameter name of the host');
    return { kanal, gruppe: KANAL_GRUPPE[kanal] as string, name: d.name };
  };
  const slotVon = (kanal: string, name: string): string | undefined => Object.entries(speicher.lies().ziele).find(([p, z]) => p.startsWith(`${kanal}/`) && z.name === name)?.[0];

  const lage = (): Record<string, unknown> => {
    const s = speicher.lies();
    const cc = new Set(lernen.speicher.lies().zuordnungen.map((z) => z.pfad));
    const wartet = lernen.wartet();
    return { datei: s.datei, wartet, ziele: Object.entries(s.ziele).map(([pfad, z]) => ({ pfad, kanal: pfad.split('/bk/')[0], slot: slotNr(pfad), ...z, gelernt: cc.has(pfad) })) };
  };

  // slots in use on a channel: every CC assignment of a row (graph knobs learned earlier too), the armed row, and host rows that are learned; a host row without
  // a CC (the learn timed out or was cancelled) is stale and may be taken again
  const belegt = (kanal: string): Set<number> => {
    const cc = new Set(lernen.speicher.lies().zuordnungen.map((z) => z.pfad));
    const wartet = lernen.wartet();
    const aus = new Set<number>();
    for (const pfad of cc) if (pfad.startsWith(`${kanal}/bk/`)) aus.add(slotNr(pfad) ?? 0);
    if (wartet?.startsWith(`${kanal}/bk/`)) aus.add(slotNr(wartet) ?? 0);
    return aus;
  };

  // normalised current value of the parameter in the host, and the display value for Surge (what the first ramp starts from)
  const istWert = async (gruppe: string, art: HostArt, name: string): Promise<{ norm: number; anzeige: number | null }> => {
    const host = ctx.host;
    if (!host) throw new LernFehler('kein_host', 409, 'this server has no instrument host connection');
    if (art === 'surge') {
      const p = surgeParameter(name) as Parameter;
      const r = await host.ruf(gruppe, { befehl: 'ist', namen: [name] });
      const w = (r.werte as Record<string, unknown> | undefined)?.[name];
      if (!r.ok || typeof w !== 'number' || !Number.isFinite(w)) throw new LernFehler('wirt', 409, String(r.fehler ?? 'the host did not report the value'));
      return { norm: normVonAnzeige(p, w), anzeige: w };
    }
    const r = await host.ruf(gruppe, { befehl: 'params' });
    const w = (r.params as Record<string, unknown> | undefined)?.[name];
    if (!r.ok || typeof w !== 'number' || !Number.isFinite(w)) throw new LernFehler('wirt', 409, String(r.fehler ?? 'the host did not report the value'));
    return { norm: Math.min(1, Math.max(0, w)), anzeige: null };
  };

  const schreib = (pfad: string, f: (d: Record<string, unknown>) => Promise<Record<string, unknown>>): Route => ({
    methode: 'POST', pfad, schutz: 'fremdePost',
    handler: async (q: http.IncomingMessage, a: http.ServerResponse) => {
      try {
        const d = await leseKoerper(q);
        nurAndreas();
        json(a, 200, { ok: true, ...(await f(d)) });
      } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
    },
  });

  return {
    name: 'hostlernen',
    routen: () => [
      { methode: 'GET', pfad: '/lernen/host', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse) => {
        try { json(a, 200, lage()); } catch (e) { const r = antwort(e); json(a, r.code, r.j); }
      } },
      schreib('/lernen/host', async (d) => {
        const { kanal, gruppe, name } = kanalUndName(d);
        const wirtArt = ctx.host?.art(gruppe) ?? null;
        if (wirtArt === null) throw new LernFehler('kein_wirt', 409, `no instrument host is running on ${kanal}`);
        const art = artVon(wirtArt);
        if (art === null) throw new LernFehler('kein_wirt', 409, 'this instrument has no controls to learn');
        if ((ctx.baukasten?.geladen()[kanal] ?? '') !== '') throw new LernFehler('graph_geladen', 409, `a graph is loaded on ${kanal}: its knobs are learned directly`);
        if (art === 'surge' && !surgeParameter(name)) throw argument(`name: ${name} is not a continuous Surge parameter`);
        if (art === 'rb338' && !RB338_PARAM_NAMEN.has(name)) throw argument(`name: ${name} is not an RB-338 parameter`);
        if (art === 'vst3' && !/^Knob ([1-9]|[1-5][0-9]|6[0-4])$/.test(name)) throw argument('name: Knob 1..64');
        lernen.pruefeBereit();
        const stand = speicher.lies();
        if (stand.datei === 'kaputt') throw new LernFehler('host_ziele_kaputt', 409, 'host_ziele.json is damaged; it was left untouched');
        let pfad = slotVon(kanal, name);
        if (pfad === undefined) {
          const nr = freierSlot(belegt(kanal));
          if (nr === null) throw new LernFehler('keine_slots', 409, `all 64 slots of ${kanal} are in use`);
          pfad = `${kanal}/bk/${nr}`;
        }
        const ist = await istWert(gruppe, art, name);
        const ziel: HostZiel = { gruppe, art, name };
        speicher.setze(pfad, ziel);
        weiter.merke(pfad, ist.anzeige);
        if (!(await ctx.host?.setzeRegler(pfad, ist.norm))) ctx.log({ typ: 'hostlernen_fehler', pfad, fehler: 'the row could not be set to the current value' });
        lernen.arme(pfad);
        return { pfad };
      }),
      schreib('/lernen/host/loeschen', async (d) => {
        const { kanal, name } = kanalUndName(d);
        const pfad = slotVon(kanal, name);
        if (pfad === undefined) throw new LernFehler('keine_zuordnung', 404);
        if (lernen.wartet() === pfad) lernen.abbrechen();
        speicher.entferne(pfad);   // first: forwarding stops at once
        weiter.vergiss(pfad);
        try { await lernen.loesche(pfad); } catch (e) { if (!(e instanceof LernFehler && e.grund === 'keine_zuordnung')) throw e; }   // armed but never learned: nothing to remove there
        return { pfad };
      }),
    ],
    ereignis(adresse: string, f: Record<string, unknown>): void { weiter.ereignis(adresse, f); },
  };
}
