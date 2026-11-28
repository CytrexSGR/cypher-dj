// One stream of the multi-stream erzeuger (S18): pattern file, planner, status files and heartbeat of ONE stream. The
// logic is the per-stream part of generator.mjs (which stays untouched, so streams 1..3 and the running studio keep their
// exact code); the socket, the hello and the clock belong to the process (generator_bk.mjs). MIDI streams only: there is
// no kit, notes go to a midi:<port>:<channel> target (or a bk: graph once the page has put one on the channel).
import fs from 'node:fs';
import path from 'node:path';
import { kodiere } from '../../contract/mock_core/osc.mjs';
import { kompiliere } from './compile.mjs';
import { Planer } from './planner.mjs';
import { schreibeStatus, schreibeLebt, leseVersatz } from './pattern_state.mjs';
import { leseHarmonie, HARMONIE_DATEI } from './harmonie_file.mjs';
import { leseTaktart, TAKTART_DATEI } from './taktart_file.mjs';

export class StromLauf {
  /**
   * @param {{strom: number, ziel: string, ordner: string, sende: (buf: Buffer) => void,
   *          beatJetzt: () => (number|null), log: (t: string) => void, jetztUs?: () => number}} o
   *   beatJetzt returns null before the first /uhr.
   */
  constructor({ strom, ziel, ordner, sende, beatJetzt, log, jetztUs = () => Number(process.hrtime.bigint() / 1000n) }) {
    this.strom = strom;
    this.ziel = ziel;
    this.ordner = ordner;
    this.muster = path.join(ordner, 'strom1.js');
    this.sende = sende;
    this.beatJetzt = beatJetzt;
    this.logRoh = log;
    this.taktartPfad = path.join(ordner, TAKTART_DATEI);
    this.harmoniePfad = path.join(ordner, HARMONIE_DATEI);
    this.planer = new Planer({ strom, kit: { midi: true }, sende, jetztUs, taktart: leseTaktart(ordner, 4), lane: leseHarmonie(ordner, []) });
    this.id = BigInt(Date.now()) * 1000n + BigInt(strom);   // per-stream ids stay distinct inside one process
    this.letzterStand = { taub: [], taub_muster: null };
    this.gemeldet = { nr: 0, n: 0 };
  }

  log(t) { this.logRoh(`stream ${this.strom}: ${t}`); }

  stromMelden() {
    this.sende(kodiere('/erz/strom', 'hsis', [++this.id, 'erzeuger', this.strom, this.ziel]));
  }

  status(stand) {
    try { schreibeStatus(this.ordner, stand); } catch (e) { this.log(`status.json: ${e.message}`); }
  }

  /** Heartbeat once per bar. Without write permission the process keeps running, the page then reports "no erzeuger". */
  lebt(zeit = Date.now()) {
    try { schreibeLebt(this.ordner, { strom: this.strom, ziel: this.ziel }, zeit); } catch (e) { this.log(`lebt.json: ${e.message}`); }
  }

  /** Read strom1.js; a new valid pattern applies from the next bar, a broken one keeps the old pattern. */
  musterLesen() {
    let text;
    try {
      text = fs.readFileSync(this.muster, 'utf8');
    } catch {
      return;   // no pattern yet: silence
    }
    const jetzt = this.beatJetzt();
    const jetztB = jetzt === null ? -Infinity : jetzt;
    const vorab = this.planer.abFuer(jetztB);
    const versatz = leseVersatz(this.ordner);
    // the anchor (.rein/.raus, ANKER) stays the switch bar: compile in inner time, .late(versatz) moves it back to the switch bar
    const r = kompiliere(text, { anker: (Number.isFinite(vorab) ? vorab / this.planer.proTakt : 0) - versatz });
    if (r.fehler) {
      this.log(`${this.muster}: ${r.fehler} (the old pattern stays)`);
      this.status(this.letzterStand = { ...this.letzterStand, nr: this.planer.nr, ab_beat: null, fehler: r.fehler });
      return;
    }
    const ab = this.planer.setze(r.muster, jetztB, versatz);
    this.log(`pattern ${this.planer.nr} applies from beat ${ab}`);
    this.status(this.letzterStand = { nr: this.planer.nr, ab_beat: Number.isFinite(ab) ? ab : null, fehler: null, taub: [], taub_muster: null });
  }

  /** The meter file of this stream folder changed (plan studio-taktart). Returns true when the bar length changed; a broken file keeps the old one. */
  taktartLesen() {
    const neu = leseTaktart(this.ordner, this.planer.proTakt);
    if (neu === this.planer.proTakt) return false;
    this.log(`bar ${this.planer.proTakt} -> ${neu} beats`);
    const jetzt = this.beatJetzt();
    this.planer.setzeTaktart(neu, jetzt === null ? -Infinity : jetzt);
    return true;
  }

  /** The lane file harmonie.json changed (strand 7). Returns true when the lane changed; a broken file keeps the old lane. */
  harmonieLesen() {
    const neu = leseHarmonie(this.ordner, this.planer.lane);
    if (JSON.stringify(neu) === JSON.stringify(this.planer.lane)) return false;
    this.log(`harmony lane changed (${neu.length} entries)`);
    const jetzt = this.beatJetzt();
    this.planer.setzeLane(neu, jetzt === null ? -Infinity : jetzt);
    return true;
  }

  /** Write the clash count of the latest window into status.json when it changed (absent without a lane). */
  harmonieMelden() {
    const h = this.planer.harmonie ?? undefined;
    if (JSON.stringify(h) === JSON.stringify(this.letzterStand.harmonie)) return;
    const { harmonie, ...rest } = this.letzterStand;
    this.status(this.letzterStand = h ? { ...rest, harmonie: h } : rest);
  }

  /** Bar n: send the next two bars (see Planer.takt), report deaf fields, write the heartbeat. */
  takt(n) {
    try {
      this.planer.takt(n);
    } catch (e) {   // a throw (too many events on one beat) must not end the process
      this.log(`bar ${n} not sent: ${e.message} (the process keeps running)`);
    }
    this.felderMelden();
    this.harmonieMelden();
    this.lebt();
  }

  felderMelden() {
    const p = this.planer;
    if (!p.nr) return;
    const gleich = this.gemeldet.nr === p.nr;
    const zuwachs = p.felder.size > (gleich ? this.gemeldet.n : 0);
    if (gleich && !zuwachs) return;
    this.gemeldet = { nr: p.nr, n: p.felder.size };
    if (zuwachs) this.log(`pattern ${p.nr}: Strudel fields without a way into the kern (they do not sound): ${[...p.felder].join(', ')}`);
    this.letzterStand = { ...this.letzterStand, taub: [...p.felder], taub_muster: p.nr };
    this.status(this.letzterStand);
  }

  /** The kern restarted: the stream and the queue are gone. */
  neustart() {
    this.stromMelden();
    this.planer.vergiss();
  }
}
