// The APC20 in PRODUCTION (2026-11-18, Andreas: "nun richten wir den apc 20 ein für das production fenster"). While the main window shows PRODUCTION,
// the pult bridge (djk/hand_bruecke/apc_production.py) turns the APC20 from the DJ console into the project mixer: faders 1..8 = the tracks of the bank
// in front, master fader = the project master, activator = mute, solo/cue = solo, record arm = arm, Shift + play / stop = the arrangement transport,
// Shift + left / right = the bank (8 tracks), Shift + up / down = the track in front (the controller focus, the synths follow it).
// Faders, mute and solo go through the kern (pult.json, channel 16, rows spur/<nr>/* and pm/fader; the hand's write-back stores them in the project like a
// mouse move). This Bereich keeps what the bridge needs to know and cannot measure itself:
//   POST /controller/ansicht {ansicht}  the main window tells the view it shows (dj, produktion, werkbank, tracker) or studio = the loop deck pop-up is open, the APC20 grid launches cells
//   GET  /controller/pult               { produktion, ansicht, bank, banken, laeuft, spalten: 8 x ({nr, id, name, mute, solo, arm} | null), spuren }
//   POST /controller/pult/bank {schritt | bank}
//   POST /controller/pult/arm {nr}      toggles the arm of track <nr> (project command, label "Arm <name>" like the track head)
//   POST /controller/pult/laden         the kern reads the desk mapping again (/k/mapping with the name of kern.toml controller_geraet): a changed pult.json
//                                      takes effect without a kern restart
// A change of the view, the bank or the transport is sent as the event `pult` (the PRODUCTION page frames the tracks of the bank).
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { leseKoerper } from '../proj/area.ts';
import type { Projekt } from '../../project/model.ts';
import type { ZurueckZugang } from './zurueck.ts';

export const BANK_BREITE = 8;
export const SPUR_ZEILEN = 32;   // the kern has spur/<n>/* rows for n = 1..32 (SPUR_REGLER_SPUREN): tracks beyond have no APC column
const ANSICHT = /^(dj|studio|produktion|werkbank|tracker)$/;

export interface PultSpalte { nr: number; id: string; name: string; mute: boolean; solo: boolean; arm: boolean }

/** The tracks the APC can reach, in the order of the arrangement (track number), with their number for the kern rows. Pure. */
export function pultSpuren(p: Projekt | null): PultSpalte[] {
  if (!p) return [];
  return [...p.spuren].filter((s) => s.nr >= 1 && s.nr <= SPUR_ZEILEN).sort((a, b) => a.nr - b.nr)
    .map((s) => ({ nr: s.nr, id: s.id, name: s.name, mute: !!s.mute, solo: !!s.solo, arm: !!(s as { aufnahme?: { scharf?: boolean } }).aufnahme?.scharf }));
}

/** The number of banks for `n` tracks (at least one) and a bank clamped into them. Pure. */
export const bankenVon = (n: number): number => Math.max(1, Math.ceil(n / BANK_BREITE));
export const klemmeBank = (bank: number, n: number): number => Math.min(bankenVon(n) - 1, Math.max(0, Math.trunc(bank)));

export interface PultBereich extends Bereich { lage(): Record<string, unknown> }

export function pultBereich(ctx: BereichKontext, opt: { zugang?: ZurueckZugang; pult?: () => string | null } = {}): PultBereich {
  let ansicht: string | null = null;
  let bank = 0;
  let laeuft = false;   // the arrangement runs or waits to start (/zustand/arr status 1 or 2)
  const projekt = (): Projekt | null => { try { return ctx.projekt?.() ?? null; } catch { return null; } };

  const lage = (): Record<string, unknown> => {
    const spuren = pultSpuren(projekt());
    bank = klemmeBank(bank, spuren.length);
    const spalten = Array.from({ length: BANK_BREITE }, (_, i) => spuren[bank * BANK_BREITE + i] ?? null);
    return { produktion: ansicht === 'produktion', ansicht, bank, banken: bankenVon(spuren.length), laeuft, spalten, spuren: spuren.map((s) => ({ nr: s.nr, id: s.id })) };
  };
  const melde = (): void => { const l = lage(); ctx.verteile({ a: 'pult', f: { produktion: l.produktion, bank: l.bank, banken: l.banken, ids: (l.spalten as (PultSpalte | null)[]).filter(Boolean).map((s) => s!.id) } }); };
  const fehler = (a: http.ServerResponse, code: number, grund: string, text: string): void => json(a, code, { fehler: grund, text });
  const post = (pfad: string, f: (d: Record<string, unknown>, a: http.ServerResponse) => Promise<void> | void): Route => ({
    methode: 'POST', pfad, schutz: 'fremdePost',
    handler: async (q: http.IncomingMessage, a: http.ServerResponse) => {
      let d: Record<string, unknown>;
      try { d = await leseKoerper(q); } catch { fehler(a, 400, 'json_ungueltig', 'the body must be a JSON object'); return; }
      await f(d, a);
    },
  });

  return {
    name: 'pult',
    lage,
    routen: () => [
      { methode: 'GET', pfad: '/controller/pult', schutz: 'offen', handler: (_q: http.IncomingMessage, a: http.ServerResponse) => json(a, 200, lage()) },
      post('/controller/ansicht', (d, a) => {
        if (typeof d.ansicht !== 'string' || !ANSICHT.test(d.ansicht)) { fehler(a, 400, 'argument_ungueltig', 'ansicht: dj, studio (the loop deck pop-up is open, the APC20 grid launches cells), produktion, werkbank or tracker'); return; }
        const neu = d.ansicht !== ansicht;
        ansicht = d.ansicht;
        if (neu) melde();
        json(a, 200, lage());
      }),
      post('/controller/pult/bank', (d, a) => {
        const n = pultSpuren(projekt()).length;
        let ziel: number;
        if (Number.isInteger(d.bank)) ziel = d.bank as number;
        else if (d.schritt === 1 || d.schritt === -1) ziel = bank + (d.schritt as number);
        else { fehler(a, 400, 'argument_ungueltig', 'bank (0-based) or schritt 1 / -1'); return; }
        const alt = bank;
        bank = klemmeBank(ziel, n);
        if (bank !== alt) melde();
        json(a, 200, lage());
      }),
      post('/controller/pult/laden', async (_d, a) => {
        const geraet = opt.pult?.() ?? null;
        if (!geraet) { fehler(a, 409, 'kein_pult', 'kern.toml names no controller_geraet'); return; }
        const q = await ctx.warteQuittung(ctx.sende('/k/mapping', { geraet }));
        json(a, q && q.status !== 6 ? 200 : 409, { geraet, quittung: q });
      }),
      post('/controller/pult/arm', async (d, a) => {
        const o = projekt();
        const s = o?.spuren.find((x) => x.nr === d.nr);
        if (!o || !s || !opt.zugang) { fehler(a, 404, 'keine_spur', 'no track with this number in the open project'); return; }
        const scharf = !!(s as { aufnahme?: { scharf?: boolean } }).aufnahme?.scharf;
        try {
          await opt.zugang.aendern({ rev: o.rev, label: `${scharf ? 'Disarm' : 'Arm'} ${s.name}`, befehle: [{ befehl: 'spur_aendern', spur_id: s.id, arm: !scharf }] }, 'andreas');
          json(a, 200, lage());
        } catch (e) {
          const x = e as { code?: number; fehler?: string; message?: string };
          fehler(a, typeof x.code === 'number' ? x.code : 409, x.fehler ?? 'abgelehnt', x.message ?? 'the track was not armed');
        }
      }),
    ],
    ereignis(adresse: string, f: Record<string, unknown>): void {
      if (adresse === '/zustand/arr') {
        const neu = Number(f.status) === 1 || Number(f.status) === 2;
        laeuft = neu;
      }
    },
  };
}
