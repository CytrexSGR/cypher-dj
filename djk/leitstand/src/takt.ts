// Zustandsstrom je Takt (SCHNITTSTELLEN §18, §14.7): auf /takt folgt die WS-Nachricht takt an alle, spätestens
// 150 ms nach dem Taktanfang. Ist eine Analyse angemeldet, wartet der Leitstand auf ihren Bericht des vorigen
// Takts bis Taktanfang + 120 ms (Festlegung dieser Scheibe: 30 ms Reserve vor der Grenze von 150 ms); kommt er
// nicht, geht takt mit bericht_vorher: null. Ohne Analyse geht takt sofort.
import type { Zeitpunkt } from './zeit.ts';

export interface TaktMeldung { takt: number; phrase: number; sample: number; beat: number; bpm: number }

export interface Ereignis { art: string; takt: number; [feld: string]: unknown }

export interface TaktZustand {
  takt: number; phrase: number; beat: number; bpm: number; set_basis_bpm: number; autonomie: number;
  ki_gestoppt: boolean; decks: unknown[]; erzeuger: unknown[]; plaene: unknown[]; vorschlaege: unknown[];
  hoerscheine: unknown[]; fristen: unknown[]; bericht_vorher: Record<string, unknown> | null;
  auftraege: unknown[]; neu_in_kiste: string[]; ereignisse_seit: Ereignis[];
}

export interface TaktStromOptionen {
  berichtFristNs: number;
  analyseDa: () => boolean;
  lage: () => {
    set_basis_bpm: number; autonomie: number; ki_gestoppt: boolean;
    plaene?: unknown[]; vorschlaege?: unknown[]; hoerscheine?: unknown[]; // Scheibe 21 (§14.7)
  };
  senden: (z: TaktZustand, zeit: Zeitpunkt, taktanfangMono: number) => void;
  jetzt: () => number;
}

export const BERICHT_FRIST_NS = 120e6;

export class TaktStrom {
  letzter: TaktZustand | null = null;
  private ereignisse: Ereignis[] = [];
  private readonly berichte = new Map<number, Record<string, unknown>>();
  private wartend: { m: TaktMeldung; mono: number; timer: NodeJS.Timeout } | null = null;
  private readonly opt: TaktStromOptionen;

  constructor(opt: TaktStromOptionen) { this.opt = opt; }

  // Ereignis für ereignisse_seit des nächsten takt
  merke(e: Ereignis): void { this.ereignisse.push(e); }

  // takt_bericht der Analyse (§14.8): Feld takt = der abgeschlossene Takt
  bericht(b: Record<string, unknown>): void {
    if (typeof b.takt !== 'number') return;
    this.berichte.set(b.takt, b);
    if (this.wartend && b.takt === this.wartend.m.takt - 1) this.loese();
  }

  aufTakt(m: TaktMeldung, taktanfangMono: number): void {
    if (this.wartend) this.loese(); // der vorige Takt wartet noch: jetzt hinaus
    const frist = taktanfangMono + this.opt.berichtFristNs;
    const rest = frist - this.opt.jetzt();
    if (!this.opt.analyseDa() || this.berichte.has(m.takt - 1) || rest <= 0) {
      this.sende(m, taktanfangMono);
      return;
    }
    // +1 ms: Node-Timer laufen in ganzen Millisekunden und dürfen knapp vor der Frist feuern
    const timer = setTimeout(() => this.loese(), Math.ceil(rest / 1e6) + 1);
    this.wartend = { m, mono: taktanfangMono, timer };
  }

  private loese(): void {
    const w = this.wartend;
    if (!w) return;
    clearTimeout(w.timer);
    this.wartend = null;
    this.sende(w.m, w.mono);
  }

  private sende(m: TaktMeldung, mono: number): void {
    const l = this.opt.lage();
    const z: TaktZustand = {
      takt: m.takt, phrase: m.phrase, beat: m.beat, bpm: m.bpm,
      set_basis_bpm: l.set_basis_bpm, autonomie: l.autonomie, ki_gestoppt: l.ki_gestoppt,
      decks: [], erzeuger: [], plaene: l.plaene ?? [], vorschlaege: l.vorschlaege ?? [], hoerscheine: l.hoerscheine ?? [], fristen: [],
      bericht_vorher: this.berichte.get(m.takt - 1) ?? null,
      auftraege: [], neu_in_kiste: [], ereignisse_seit: this.ereignisse,
    };
    this.ereignisse = [];
    for (const k of this.berichte.keys()) if (k < m.takt - 1) this.berichte.delete(k);
    this.letzter = z;
    this.opt.senden(z, { sample: m.sample, beat: m.beat, takt: m.takt, phrase: m.phrase }, mono);
  }

  stoppe(): void {
    if (this.wartend) clearTimeout(this.wartend.timer);
    this.wartend = null;
  }
}
