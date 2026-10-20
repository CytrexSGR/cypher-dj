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
    return this.teile(liste, abBeatVon(this.beat(), this.bpm(), 'jetzt'), 0, quelle);
  }
  // Spec 6.35: Regler über eine Gleitzeit fahren (/k/teil mit dauer_beats, Form 0, Politik 1), ab jetzt plus `versatz` Beats, frühestens ab
  // `fruehest`. Die Rückfahrt nach der KI-Freigabe: eine Rampe, die die Ausblende des Stopps überlappt, lehnt der Kern mit ueberlappung ab.
  // Spec 6.36: `plan` und `teil` (je Regler) benennen die Teile, damit der Server genau sie mit /k/abbruch beenden kann (ohne Plan träfe ein
  // Abbruch alle planlosen Teile derselben Quelle, Festlegung F5). Gesendet wird sofort (synchron); `ab` ist der Start-Beat, das Versprechen
  // wartet auf die Quittungen (bei einem späten Start bis zu dessen Beat, höchstens 4 s).
  // Spec 6.37: `kurz` wartet nur das kurze Fenster ab wie setzeRegler (Sofort-Ablehnungen des Kerns, etwa ueberlappung), nicht bis zum Start:
  // für eine Antwort an die Seite, die nicht auf den späten Start einer Rückfahrt warten soll (angenommen, Status 1, gilt als gelungen).
  fahreRegler(liste: readonly Soll[], dauerBeats: number, quelle: Quelle,
    o: { fruehest?: number | null; versatz?: number; plan?: string; teil?: (pfad: string) => number; kurz?: boolean } = {},
  ): { ab: number; ergebnis: Promise<ReglerErgebnis[]> } {
    const jetzt = abBeatVon(this.beat(), this.bpm(), 'jetzt');
    const ab = Math.max(jetzt + (o.versatz ?? 0), o.fruehest ?? -Infinity);
    return { ab, ergebnis: this.teile(liste, ab, dauerBeats, quelle, o.plan, o.teil, o.kurz ? jetzt : ab) };
  }
  // Spec 6.36: /k/abbruch für die genannten Teile eines Plans (laufende halten am Ist-Wert, wartende entfallen; SCHNITTSTELLEN §4.3)
  async abbruch(plan: string, teile: readonly number[], quelle: Quelle): Promise<Quittung> {
    const id = this.ctx.sende('/k/abbruch', { quelle, plan, teile: teile.join(',') });
    return this.ctx.warteQuittung(id);
  }
  // warteAb: bis zu welchem Beat auf eine Quittung ≠ 1 gewartet wird (Vorgabe: der Start ab)
  private async teile(liste: readonly Soll[], ab: number, dauer: number, quelle: Quelle, plan?: string, teil?: (pfad: string) => number,
    warteAb: number = ab): Promise<ReglerErgebnis[]> {
    const ids = liste.map((r) => this.ctx.sende('/k/teil', { quelle, plan: plan ?? (quelle === 'cypher' ? 'cypher' : ''), teil: teil ? teil(r.pfad) : 0,
      pfad: r.pfad, ab_beat: ab, dauer_beats: dauer, nach: r.wert, form: 0, politik: 1, gruppe: '', hoerschein: '' }));
    return Promise.all(liste.map(async (r, i) => {
      const q = await this.ctx.warteQuittung(ids[i], warteAb);
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
