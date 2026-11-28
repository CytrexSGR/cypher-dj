import { MAX_BEAT, type Projekt, kanonisch, sucheSpur } from '../../project/model.ts';
import { type Quelle, type Quittung, quittungAbgelehnt, quittungOk } from './core_path.ts';
import { grundText } from '../../http/reasons.ts';
import { type Antwort, type Koerper, MARKER_TOLERANZ_S, type Offen, ProjFehler, VORZAEHL_BEATS, schlaf } from './session_helpers.ts';
import type { ProjSitzung } from './session.ts';

// --- Transport (Spec 2.2, 2.7) -----------------------------------------------------------------------------------------
export function transport(this: ProjSitzung, d: Koerper, quelle: Quelle): Promise<Antwort> {
  return this.seriell(async () => {
    const o = this.brauchOffen();
    this.riegel(quelle);
    if (d.aktion === 'stopp') {
      // Spec 6.37 (Andreas 16.10.: „Cypher stoppt nur einen Transport, den sie selbst gestartet hat“): Cyphers Stopp über Andreas' Lauf wird
      // abgelehnt, nichts gestoppt. Andreas' Stopp stoppt immer. Ohne Lauf (status 0) geht Cyphers Stopp durch, er ist ohne Wirkung.
      if (this.fremderLauf(quelle)) {
        throw new ProjFehler(409, 'transport_laeuft', { text: 'a transport Andreas started is running; Cypher stops only a transport she started' });
      }
      const q = await this.kern.stopp(quelle);
      if (quittungOk(q)) this.transportQuelle = null;
      return { code: 200, j: { ok: quittungOk(q), quittung: q } };
    }
    if (d.aktion !== 'start') throw new ProjFehler(400, 'aktion_unbekannt');
    const beat = d.beat === undefined ? 0 : d.beat;
    if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 0 || beat > MAX_BEAT) throw new ProjFehler(400, 'beat_ungueltig');
    // Spec 6.37 Nachtrag (Re-Review Fix7 RR7-2, rr7 T_start: der Kern beendet beim Start einen laufenden Lauf, core_arr.cpp:97, und Cypher wurde
    // Starterin; ihr Stopp ging danach durch): Cyphers Start über Andreas' Lauf (oder einen unbekannten) wird abgelehnt, nichts gesendet. Geprüft
    // vor der Tempo-Rampe und noch einmal unmittelbar vor /k/arr/start (Andreas kann während der Rampe am Gerät starten).
    this.sperreFremderStart(quelle);
    this.sperreTransport();                                            // Spec 6.32: vor der Tempo-Rampe
    const tempo = await this.tempoVorStart(o.projekt.tempo_bpm, quelle);
    // Paket 1.18, E-a (Entscheidung von Cypher 2026-10-20, Andreas kann umstellen): fällt Stop Cypher in die Wartezeit auf die Tempo-Rampe, beendet der Kern
    // Cyphers Rampe mit 7 ki_stopp. Dann dieselbe Antwort wie beim verworfenen wartenden Start (200, ok false, 7 ki_stopp) statt 409 tempo_abgelehnt; es ging
    // kein Start hinaus, und transportQuelle ist unberührt.
    const tq = tempo.quittung as { status?: number; grund?: string } | null | undefined;
    if (tempo.fehler === 'tempo_abgelehnt' && tq?.status === 7 && tq.grund === 'ki_stopp') return { code: 200, j: { ok: false, quittung: tq, tempo } };
    if (tempo.fehler) throw new ProjFehler(tempo.fehler === 'kein_kern' ? 503 : 409, tempo.fehler as string, { tempo });
    // Review 9a: fiel Stop Cypher in die schon laufende Rampe, geht Cyphers Start nicht mehr hinaus (dieselbe Antwort, kein 6 ki_gestoppt vom Kern)
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) {
      const quittung = { status: 7, grund: 'ki_stopp', text: 'Stop Cypher was pressed; the start was dropped and nothing was started' };
      return { code: 200, j: { ok: false, quittung, tempo } };
    }
    this.sperreFremderStart(quelle);
    this.sperreTransport();                                            // und unmittelbar vor /k/arr/start (die Sperre kann während der Rampe kommen)
    // Always the next master bar, also when nothing else plays: the master clock runs on and an immediate start put the project bar one off the
    // master bar one (SEQ deck 0.59 beats behind, 2026-11-14). The core has no way to re-anchor the clock, so the start waits for the one.
    const quant = 2;
    const vorzaehl = d.vorzaehl_beats ?? 0;                            // 1.8 S4b.1a: only the recording area sets it (the HTTP route refuses the key)
    if (!VORZAEHL_BEATS.includes(vorzaehl as number)) throw new ProjFehler(400, 'argument_ungueltig', { text: 'vorzaehl_beats: 0, 4, 8 or 16 expected' });
    // Spec 6.37 (D1 S3 Auftrag 17 b, Re-Review Fix8 Probe K, am Stapel gemessen: mit quant 2 kam die Quittung erst 1,87 s nach dem Absenden, bis
    // dahin galt der Lauf noch als Cyphers, und ein Stop Cypher in diesem Fenster stoppte Andreas' Lauf): der Start gehört ab dem Absenden dem,
    // der ihn sendet (der Kern beendet beim Start den laufenden Lauf, core_arr.cpp:97). Lehnt der Kern ab oder antwortet nicht, gilt wieder der
    // vorige, sofern nichts anderes (Hand-Taste, KI-Stopp, Stopp) inzwischen entschieden hat.
    const vorher = this.transportQuelle;
    this.transportQuelle = quelle;
    const q = await this.kern.start(beat, quant, quelle, vorzaehl as number);
    if (!quittungOk(q) && this.transportQuelle === quelle) this.transportQuelle = vorher;
    return { code: 200, j: { ok: quittungOk(q), quittung: q, quant, start_beat: beat, tempo } };
  });
}

// Spec 6.37 Nachtrag: Cyphers Start, solange ein Transport läuft oder wartet, den sie nicht selbst gestartet hat (fremderLauf)
export function sperreFremderStart(this: ProjSitzung, quelle: Quelle): void {
  if (!this.fremderLauf(quelle)) return;
  throw new ProjFehler(409, 'transport_laeuft', {
    text: 'a transport Andreas started is running; Cypher starts the transport only when none of his is running',
  });
}

// Spec 6.32: ein Freeze ist ein Transport-Lauf; Start und Tempo-Rampe brechen ihn ab oder verändern die Datei. Stopp bleibt erlaubt.
export function sperreTransport(this: ProjSitzung): void {
  if (this.sperren > this.sperrenAufnahme) throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; transport start waits until it is done' });
}

// Spec 2.7: Projekttempo beim Start setzen, wenn das Master-Tempo abweicht und kein Deck läuft; der Start wartet das Rampen-Ende ab.
// Spec 6.30: läuft /uhr uhrStillMs lang nicht weiter (kein Kern), bricht das Warten mit kein_kern ab, statt die Kette zu halten.
export async function tempoVorStart(this: ProjSitzung, ziel: number, quelle: Quelle): Promise<Record<string, unknown>> {
  const u = this.lage.uhr;
  if (!u || Math.abs(u.bpm - ziel) < 0.005) return { gesetzt: false };
  if (this.lage.deckLaeuft()) return { gesetzt: false, grund: 'deck_laeuft', text: grundText('deck_laeuft'), master_bpm: u.bpm };
  const r = await this.kern.tempo(ziel, quelle);
  if (!r || !quittungOk(r.quittung)) return { gesetzt: false, fehler: 'tempo_abgelehnt', text: grundText('tempo_abgelehnt'), quittung: r?.quittung ?? null };
  const ende = r.ab_beat + r.dauer_beats, t0 = Date.now();
  let beat = this.lage.uhr?.beat ?? -Infinity, seit = t0;
  while (!(this.lage.uhr && this.lage.uhr.beat >= ende)) {
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) break;          // Stop Cypher: nicht bis zum Rampenende warten, die Start-Route verwirft
    const jetzt = Date.now(), b = this.lage.uhr?.beat ?? -Infinity;
    if (b > beat) { beat = b; seit = jetzt; } else if (jetzt - seit > this.uhrStillMs) {
      return { gesetzt: true, fehler: 'kein_kern', text: grundText('kein_kern'), ab_beat: r.ab_beat };
    }
    if (jetzt - t0 > this.rampeWarteMs) return { gesetzt: true, fehler: 'rampe_haengt', text: grundText('rampe_haengt'), ab_beat: r.ab_beat };
    await schlaf(20);
  }
  return { gesetzt: true, ziel_bpm: r.ziel_bpm, ab_beat: r.ab_beat };
}

// --- Sperre (P4, Spec 6.23) und Zugang für S3 (P5) ---------------------------------------------------------------------------------------
// Während eines Freeze lädt der Server nicht neu: jedes Laden bricht den Echtzeit-Durchlauf im Kern ab. Gesperrt sind Änderungen, die die
// Wiedergabe berühren (Noten, Clips, Spuren anlegen, löschen, verschieben, Gerät, Tempo, Loop); Mixer (Regler) bleibt frei.
// Spec 6.32: solange ein Öffnen oder Anlegen läuft, 409 beschaeftigt (wer zuerst kommt, gewinnt; S3 startet den Freeze dann nicht).
export function sperreLaden(this: ProjSitzung, fuer?: 'aufnahme'): () => void {
  if (this.oeffnet > 0) throw new ProjFehler(409, 'beschaeftigt', { text: 'a project is being opened; a freeze waits until it is open' });
  // Aufnahme und Freeze fahren beide den Transport: wer zuerst kommt, gewinnt (Nachbesserung 1, B1)
  // zwei getrennte Abfragen mit je einem Text-Literal: ein Ternär mit 'aufnahme' in der Bedingung hält tests/proj_reasons_text.test.mjs für
  // einen Text aus einer Variablen (Probelauf, N9)
  if (fuer === 'aufnahme' && this.sperren > 0) {
    throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze, an export or another recording holds the lock; a recording waits until it is done' });
  }
  if (fuer !== 'aufnahme' && this.sperrenAufnahme > 0) {
    throw new ProjFehler(409, 'beschaeftigt', { text: 'a recording is running; a freeze waits until it is done' });
  }
  this.sperren += 1;
  if (fuer === 'aufnahme') this.sperrenAufnahme += 1;
  let frei = false;
  return () => {
    if (frei) return;
    frei = true;
    this.sperren -= 1;
    if (fuer === 'aufnahme') this.sperrenAufnahme -= 1;
    const o = this.offen;
    if (this.sperren > 0 || !o || !(o.merk.laden || o.merk.loop || o.merk.tempo || o.merk.reglerNach.length)) return;
    // Spec 6.31: das Nachholen läuft in der Kette, also später. Ist das Projekt bis dahin geschlossen, verfällt es; setzt S3 inzwischen eine
    // neue Sperre (nächster Freeze), prüft holeNach sie direkt vor jedem Senden und lässt den Rest gemerkt bis zu deren Freigabe.
    void this.seriell(async () => { if (this.offen === o) await this.holeNach(o); })
      .catch((x) => this.ctx.log({ typ: 'proj_nachladen_fehler', fehler: (x as Error).message }));
  };
}

export async function holeNach(this: ProjSitzung, o: Offen): Promise<void> {
  const ergebnis: Record<string, unknown> = {};
  if (o.merk.laden) {
    if (this.sperren > 0) return;
    ergebnis.wiedergabe = await this.ladeWiedergabe('andreas');
    o.merk.laden = false;                                              // erst nach dem gelungenen Laden: wirft es, bleibt es gemerkt (Fix3 G9)
    if (o.merk.reglerNach.length) {
      const z = o.merk.reglerNach; o.merk.reglerNach = [];
      const w = ergebnis.wiedergabe as { nr?: unknown; quittung?: Quittung };
      // audit U04: same test as uebernimm. A translator refusal ({nr: null, fehler}) has no receipt: the old playback stays, and so do its rows
      if (typeof w.nr === 'number' && !quittungAbgelehnt(w.quittung ?? null)) this.meldeRegler(o, await this.kern.setzeRegler(z, 'andreas'));
      else this.ctx.log({ typ: 'proj_uebernimm_regler_nach_abgelehnt', slug: o.slug, zeilen: z.length });
    }
  }
  if (o.merk.loop) {
    if (this.sperren > 0 || this.offen !== o) return;
    o.merk.loop = false;
    ergebnis.loop = await this.kern.loop(o.projekt, 'andreas');
  }
  if (o.merk.tempo) {
    if (this.sperren > 0 || this.offen !== o) return;
    o.merk.tempo = false;
    ergebnis.tempo = await this.kern.tempo(o.projekt.tempo_bpm, 'andreas');
  }
  this.ctx.log({ typ: 'proj_nachgeholt', slug: o.slug, ...ergebnis });
}

// Slice 3a (AK2): ein Marker hinter dem Ende der Quelle klingt nie (der Kern liest dort Stille, arr_voices.cpp:197) und ist ein Bedienfehler. Geprüft
// wird nur, wo sich der letzte Marker eines Warps geändert hat (die früheren sind kleiner); die Dauer ist die des Katalogs, die für denselben Clip
// schon Auto-Warp und Länge bestimmt.
export function pruefeMarkerInQuelle(this: ProjSitzung, alt: Projekt, neu: Projekt): void {
  if (!this.katalog) return;
  const vorher = new Map<string, number | undefined>();
  for (const s of alt.spuren) for (const c of s.clips) if (c.art === 'audio') vorher.set(c.id, c.warp?.marker[c.warp.marker.length - 1]?.[0]);
  for (const s of neu.spuren) for (const c of s.clips) {
    if (c.art !== 'audio' || !c.warp) continue;
    const letzter = c.warp.marker[c.warp.marker.length - 1][0];
    if (vorher.get(c.id) === letzter) continue;
    let dauer: number | null = null;
    try { dauer = this.katalog.eintrag(c.quelle.sha256)?.dauer_s ?? null; } catch { dauer = null; }
    if (dauer !== null && letzter > dauer + MARKER_TOLERANZ_S) {
      throw new ProjFehler(400, 'warp_marker', { text: `warp marker at ${letzter} s lies behind the end of the source (${dauer} s)`, clip_id: c.id });
    }
  }
}

// 1.8 T9 (AK2, fourth case): the input or the mode (it is part of the input) of a track the recording holds cannot change during the run; the core would
// refuse it with aufnahme_laeuft, so the refusal comes before any message. A monitor change passes (D12). While the start is still under way
// (lock held, run not set yet) every armed track counts as recording.
export function pruefeAufnahmeSpuren(this: ProjSitzung, p: Projekt, befehle: readonly unknown[]): void {
  const lauf = this.aufnahmeLauf as { spuren: { id: string }[] } | null;
  if (lauf === null && this.sperrenAufnahme === 0) return;
  for (const b of befehle as Koerper[]) {
    if (b?.befehl !== 'spur_aendern' || b.eingang === undefined) continue;
    const s = sucheSpur(p, b.spur_id as string);
    if (!s?.aufnahme || !(lauf ? lauf.spuren.some((x) => x.id === s.id) : s.aufnahme.scharf)) continue;
    if (kanonisch(b.eingang) === kanonisch(s.aufnahme.eingang)) continue;
    throw new ProjFehler(409, 'aufnahme_laeuft', { text: `${s.name} is recording; its input and mode cannot change until the take is done` });
  }
}

export function pruefeSperre(this: ProjSitzung, alt: Projekt, neu: Projekt, betrifftWiedergabe: boolean): void {
  if (this.sperren === 0) return;
  if (betrifftWiedergabe || alt.tempo_bpm !== neu.tempo_bpm || kanonisch(alt.loop) !== kanonisch(neu.loop)) {
    throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; changes to the playback wait until it is done' });
  }
}
