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

export class KernWeg {
  private readonly ctx: BereichKontext;
  private readonly lage: KernLage;
  constructor(ctx: BereichKontext, lage: KernLage) { this.ctx = ctx; this.lage = lage; }

  private beat(): number { return this.lage.uhr?.beat ?? 0; }
  private bpm(): number { return this.lage.uhr?.bpm ?? 128; }

  // Regler setzen (/k/teil, Dauer 0, ab sofort, Politik 1: zu spät heißt sofort ausgeführt, Quittung 5). Alle parallel, Ergebnis je Pfad.
  setzeRegler(liste: readonly Soll[], quelle: Quelle): Promise<ReglerErgebnis[]> {
    return this.teile(liste, abBeatVon(this.beat(), this.bpm(), 'jetzt'), quelle);
  }
  // Alle Regler als /k/teil, parallel; Quittung je Regler. Cyphers Teile tragen den Plan "cypher" (/k/abbruch trifft sie).
  private async teile(liste: readonly Soll[], ab: number, quelle: Quelle): Promise<ReglerErgebnis[]> {
    const ids = liste.map((r) => this.ctx.sende('/k/teil', { quelle, plan: quelle === 'cypher' ? 'cypher' : '', teil: 0,
      pfad: r.pfad, ab_beat: ab, dauer_beats: 0, nach: r.wert, form: 0, politik: 1, gruppe: '', hoerschein: '' }));
    return Promise.all(liste.map(async (r, i) => {
      const q = await this.ctx.warteQuittung(ids[i], ab);
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
