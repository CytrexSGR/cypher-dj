// Kern-Befehle des Bereichs proj (Spec D1 3.1), nur über den BereichKontext (Spec 2.10): sende mit dem gemeinsamen id-Zähler,
// warteQuittung wie die Bestandsrouten. Jede Methode wartet auf die Quittung und gibt sie zurück; was „gelungen“ heißt, sagt quittungOk.
import type { BereichKontext } from '../../http/router.ts';
import type { Projekt } from '../../projekt/modell.ts';
import { abBeatVon, tempoRampe, type Rampe } from '../../tempo_rampe.ts';
import type { KernLage } from './lage.ts';
import type { Soll } from './abbildung.ts';
import type { Quelle } from '../../projekt/verlauf.ts';

export type { Quelle } from '../../projekt/verlauf.ts';             // eine Definition (verlauf.ts), hier für die Aufrufer des Kern-Wegs
export type Quittung = { status: number; grund: string } | null;
const FEHL_STATUS = new Set([4, 6, 7, 8]);                  // §5.1: verworfen, abgelehnt, abgebrochen, storniert (5 = verspätet ausgeführt)
export const quittungOk = (q: Quittung): boolean => q !== null && !FEHL_STATUS.has(q.status);
// Spec 6.30: eine echte Ablehnung des Kerns (Quittung da, Status 4, 6, 7, 8). null heißt kein Kern (keine Quittung bis zur Frist): das ist
// keine Ablehnung, das Projekt bleibt die Wahrheit, beim nächsten Öffnen gilt 6.21.
export const quittungAbgelehnt = (q: Quittung): boolean => q !== null && FEHL_STATUS.has(q.status);
export interface ReglerErgebnis { pfad: string; wert: number; quittung: Quittung; ok: boolean }
// warteQuittung kehrt bei der ersten Quittung ≠ 1 zurück, spätestens bei abBeat + ¼ Beat und nach höchstens 4 s. Laden und Start
// quittieren erst am Ende des Ladens bzw. am Einsatz: mit einem weiten abBeat wartet der Bereich dann bis zu diesen 4 s.
const WEIT_BEATS = 16;

// 1.10 slice 3 (P11): the stellwerk holds at most MAX_TEILE = 256 open parts. Opening a maximum project sets 379 controls (41 fader ramps, 114 solo parts
// and 128 send ramps may come on top), so the controls go out in packets of at most this many, and each packet is waited for until its END status.
// Since slice 4a up to 120 insert rows (ten per stage, twelve stages) join them.
export const REGLER_PAKET = 100;

// 1.12 slice 3 (§4.11): the fields /k/arr/auto knows, the one server list; tests/proj_auto_uebersteuert.test.mjs pins it against osc.json werte.auto_ziel.
// (modell.ts AUTO_ZIELE is the longer list of lane targets, including geraet.*; the core override knows only these four)
export const KERN_AUTO_ZIELE = ['fader', 'pan', 'mute', 'solo'] as const;
export const istKernAutoZiel = (z: unknown): z is (typeof KERN_AUTO_ZIELE)[number] => (KERN_AUTO_ZIELE as readonly unknown[]).includes(z);
// How a core refusal of /k/arr/auto reaches the caller: the distinct ones keep their identity, `format` is a server bug (500, the core reason goes along
// as `kern`), every other refusal is a generic 409 auto_abgelehnt
export function autoAblehnung(grund: string): [code: number, fehler: string] {
  if (grund === 'auto_ziel_unbekannt') return [400, 'auto_ziel_unbekannt'];
  if (grund === 'ki_gestoppt') return [409, 'ki_gestoppt'];
  if (grund === 'nur_andreas') return [403, 'nur_andreas'];
  if (grund === 'format') return [500, 'auto_abgelehnt'];
  return [409, 'auto_abgelehnt'];
}

export class KernWeg {
  private readonly ctx: BereichKontext;
  private readonly lage: KernLage;
  private readonly paket: number;
  private readonly bisEnde: boolean;
  // paket / bisEnde: test seams for the negative controls (packet size unlimited, waiting only for the first status)
  constructor(ctx: BereichKontext, lage: KernLage, o: { paket?: number; bisEnde?: boolean } = {}) {
    this.ctx = ctx; this.lage = lage; this.paket = o.paket ?? REGLER_PAKET; this.bisEnde = o.bisEnde ?? true;
  }

  private beat(): number { return this.lage.uhr?.beat ?? 0; }
  private bpm(): number { return this.lage.uhr?.bpm ?? 128; }

  // Regler setzen (/k/teil, Dauer 0, ab sofort, Politik 1: zu spät heißt sofort ausgeführt, Quittung 5). Alle parallel, Ergebnis je Pfad.
  async setzeRegler(liste: readonly Soll[], quelle: Quelle): Promise<ReglerErgebnis[]> {
    return (await this.setzeReglerPakete(liste, quelle)).ergebnis;
  }
  // In Paketen zu höchstens `paket` Reglern: jedes Paket geht parallel hinaus und wird bis zum Endstatus abgewartet, erst dann das nächste.
  // Abbruch (die späteren Pakete werden NICHT gesendet): ein Paket mit einer Ablehnung (Status 4, 6, 7, 8: der Kern ist voll oder lehnt ab) oder ein
  // Paket, in dem kein einziger Regler eine Quittung bekam (kein Kern). Heilung: das nächste Öffnen setzt alle Regler neu.
  async setzeReglerPakete(liste: readonly Soll[], quelle: Quelle): Promise<{ ergebnis: ReglerErgebnis[]; nicht_gesendet: number }> {
    const ergebnis: ReglerErgebnis[] = [];
    for (let von = 0; von < liste.length; von += this.paket) {
      const teil = await this.teile(liste.slice(von, von + this.paket), abBeatVon(this.beat(), this.bpm(), 'jetzt'), quelle);
      ergebnis.push(...teil);
      if (teil.some((r) => quittungAbgelehnt(r.quittung)) || teil.every((r) => r.quittung === null)) {
        return { ergebnis, nicht_gesendet: liste.length - ergebnis.length };
      }
    }
    return { ergebnis, nicht_gesendet: 0 };
  }
  // Ein Paket als /k/teil, parallel; Quittung je Regler. Cyphers Teile tragen den Plan "cypher" (/k/abbruch trifft sie).
  private async teile(liste: readonly Soll[], ab: number, quelle: Quelle): Promise<ReglerErgebnis[]> {
    const ids = liste.map((r) => this.ctx.sende('/k/teil', { quelle, plan: quelle === 'cypher' ? 'cypher' : '', teil: 0,
      pfad: r.pfad, ab_beat: ab, dauer_beats: 0, nach: r.wert, form: 0, politik: 1, gruppe: '', hoerschein: '' }));
    return Promise.all(liste.map(async (r, i) => {
      const q = await this.ctx.warteQuittung(ids[i], ab, this.bisEnde);
      return { pfad: r.pfad, wert: r.wert, quittung: q, ok: quittungOk(q) };
    }));
  }

  async laden(nr: number, quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/arr/laden', { quelle, nr });
    return this.ctx.warteQuittung(id, this.beat() + WEIT_BEATS);
  }
  async loop(p: Projekt, quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/arr/loop', { quelle, an: p.loop.an ? 1 : 0, von_beat: p.loop.von_beat, bis_beat: p.loop.bis_beat });
    return this.ctx.warteQuittung(id);
  }
  async metronom(p: Projekt, quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/arr/metronom', { quelle, an: p.metronom.an ? 1 : 0, pegel_db: p.metronom.pegel_db, ziel: p.metronom.ziel === 'cue' ? 1 : 0 });
    return this.ctx.warteQuittung(id);
  }
  async start(startBeat: number, quant: number, quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/arr/start', { quelle, start_beat: startBeat, quant });
    return this.ctx.warteQuittung(id, this.beat() + WEIT_BEATS);
  }
  async stopp(quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/arr/stopp', { quelle, quant: 0 });
    return this.ctx.warteQuittung(id);
  }
  // 1.12 slice 3 (§4.11): the lane override. spur = track number 1..32, 0 = all (only with an 1; ziel is then validated but ignored). an 0 = the hand
  // overrides (never from cypher), an 1 = the lane plays again. The state comes back as /e/auto, not in the acknowledgement.
  async auto(spur: number, ziel: string, an: 0 | 1, quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/arr/auto', { quelle, spur, ziel, an });
    return this.ctx.warteQuittung(id);
  }
  // A project switch is a fresh start (Andreas, 2026-11-02): release the human hand holder on the listed regulators (comma list, an entry ending in / is a
  // prefix, INTERFACES 4.3 /k/hand/frei) so the writes of the new project are not refused with regler_beim_menschen. Only the source andreas may.
  async handFrei(pfade: string, quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/hand/frei', { quelle, pfade });
    return this.ctx.warteQuittung(id);
  }
  // AK34 (D6): end every override in the core, source andreas (server housekeeping, as nachNeustart)
  autoFrei(): Promise<Quittung> { return this.auto(0, 'fader', 1, 'andreas'); }
  // 1.12 slice 3 (D11): arm one track for automation recording; spur 0 only with an 0 (disarms all). Only the source andreas may do it (nur_andreas).
  async arm(spur: number, an: 0 | 1, modus: 0 | 1 | 2, quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/arr/arm', { quelle, spur, an, modus });
    return this.ctx.warteQuittung(id);
  }
  // AK34 (D6): no track stays armed over a project open or a new core; server housekeeping, source andreas
  armFrei(): Promise<Quittung> { return this.arm(0, 0, 0, 'andreas'); }
  async kiSpur(kanaele: string, quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/ki/spur', { quelle, kanaele });
    return this.ctx.warteQuittung(id);
  }
  // Spec 2.7: derselbe Weg wie POST /tempo (tempo_rampe.ts). null bei einem Tempo außerhalb 60..200.
  async tempo(zielBpm: number, quelle: Quelle): Promise<(Rampe & { quittung: Quittung }) | null> {
    const r = tempoRampe(this.beat(), this.bpm(), zielBpm);
    if (!r) return null;
    const id = this.ctx.sende('/k/tempo/rampe', { quelle, ...r });
    return { ...r, quittung: await this.ctx.warteQuittung(id, r.ab_beat) };
  }
}
