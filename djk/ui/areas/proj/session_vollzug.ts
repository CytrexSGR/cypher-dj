import {
  BK_LIVE_SLOTS, BK_PARAMETER, FADER_MAX, FADER_MIN, type Projekt, alleStraenge, bkSlot, kanonisch, sucheClip, sucheSpur, sucheStrang,
} from '../../project/model.ts';
import { HK_ZIELE } from '../../project/envelope.ts';
import type { Haken, Meta, Wirkung } from '../../project/history.ts';
import { type Quelle, type Quittung, quittungAbgelehnt, quittungOk } from './core_path.ts';
import type { Soll } from './mapping.ts';
import type { StiftAenderung } from '../../project/commands_helpers.ts';
import { beatBeiQuelle, segmentBpm } from '../../project/warp.ts';
import { schreibeWiedergabe } from '../../project/playback.ts';
import { sichereWerksProbenImStandardOrdner } from '../../sampler/werksproben.ts';
import { teileReglerLive, teileStummStart } from '../../project/controls_order.ts';
import { trackerVorlageBefehle, trackerVorlageVon, trackerVorlagenListe } from '../../project/tracker.ts';
import { vorlageBefehle, vorlageVon, vorlagenListe } from '../../project/werkbank.ts';
import {
  AUTO_PUNKTE_VORGABE, type Antwort, MARKER_VORGABE, type Offen, ProjFehler, TRANSIENTEN_VORGABE, gegenprobe, huellkurveAnsicht,
  laneAnsicht, neueQuelle, tempoUebersicht,
} from './session_helpers.ts';
import { ladeNr } from './session_playback.ts';
import { betrifftWiedergabe } from './session_dekodiert.ts';
import type { ProjSitzung } from './session.ts';

// Regler zuerst (Quittungen abwarten), dann speichern. Spec 3.4: Ablehnung eines /k/teil setzt die Änderung zurück.
// Spec 6.30 (Leistung): betrifft die Änderung die Wiedergabe, entsteht diese vor dem Speichern (im Haken speichere), und die EINE Speicherung
// trägt ihre Nummer schon als wiedergabe_rev. Vorher speicherte ladeWiedergabe den Stand gleich danach ein zweites Mal.
// Kraken patch field: `stifte` are the live pins of a light pin command; they go out right after the knob rows (/k/arr/stift, packets of
// REGLER_PAKET) and are handled like
// them: a stale rev puts the pins back to the OPEN state, a refusal writes nothing and puts the accepted pins back to `alt`.
export async function vollziehe(this: ProjSitzung, o: Offen, quelle: Quelle, regler: Soll[], schreibe: (h: Haken) => Wirkung, quellen: Map<string, string>,
    betrifftWiedergabe: boolean, stifte: StiftAenderung[] = [], ziel?: Projekt): Promise<Antwort> {
  const alt = o.projekt;
  const gesetzt = await this.kern.setzeRegler(regler, quelle);
  const stiftQ = stifte.length ? await this.kern.stifte(stifte, quelle) : [];
  const zurueck = async (stand: Projekt): Promise<void> => {
    await this.reglerZurueck(stand, gesetzt, quelle); await this.stifteZurueck(stand, stifte, stiftQ, quelle);
    };
  // Spec 6.30: nach dem await die rev noch einmal gegen den offenen Stand. S3 setzt ihn über uebernimm() synchron, auch während diese
  // Änderung auf ihre Quittungen wartet; geprüft wurde sie gegen alt. Ihre Regler gehen dann auf den offenen Stand zurück.
  if (this.offen !== o || o.projekt !== alt || o.projekt.rev !== alt.rev) {
    await zurueck(o.projekt);
    if (this.offen !== o) throw new ProjFehler(409, 'kein_projekt');
    throw new ProjFehler(409, 'rev_veraltet', { rev: o.projekt.rev });
  }
  // Spec 6.30: nur eine echte Ablehnung dreht zurück. Ohne Kern (Quittung null) gilt die Änderung wie eine Noten-Änderung (kern.regler: kein_kern).
  const abgelehnt = gesetzt.filter((r) => quittungAbgelehnt(r.quittung));
  if (abgelehnt.length) {
    await zurueck(alt);
    throw new ProjFehler(409, 'regler_abgelehnt', { regler: abgelehnt });
  }
  const stiftAbgelehnt = stifte.flatMap((e, i) => (quittungAbgelehnt(stiftQ[i])
    ? [{ spur: e.nr, satz: e.satz, zeile: e.zeile, spalte: e.spalte, grund: stiftQ[i]!.grund, status: stiftQ[i]!.status }] : []));
  if (stiftAbgelehnt.length) {
    await zurueck(alt);
    throw new ProjFehler(409, 'stift_abgelehnt', { stifte: stiftAbgelehnt, kern: stiftAbgelehnt[0].grund });
  }
  // Container core M5: a container that leaves a module (or goes empty) is told before the swap; a refusal changes nothing
  if (ziel?.live) {
    const nein = await this.sendeContainer(ziel, 'vor', quelle);
    if (this.offen !== o || o.projekt !== alt || o.projekt.rev !== alt.rev) {
      await zurueck(o.projekt);
      if (this.offen !== o) throw new ProjFehler(409, 'kein_projekt');
      throw new ProjFehler(409, 'rev_veraltet', { rev: o.projekt.rev });
    }
    if (nein.length) { await zurueck(alt); throw new ProjFehler(409, 'kern_lehnt_ab', { container: nein[0].container, status: nein[0].status,
      kern: nein[0].grund }); }
  }
  // Haken-Vertrag mit history.ts (speichereDannProtokolliere, Spec 6.31 festgehalten): speichere wird genau einmal mit dem NEUEN Stand gerufen, vor
  // dem Log-Eintrag; nur wenn das Log scheitert, folgt ein zweiter Aufruf mit dem alten Stand (zurückschreiben). vollziehe hängt an genau dieser
  // Reihenfolge: nur der erste Aufruf fordert Dekodieren an, gleicht dekodiert ab und schreibt die Wiedergabe (bereiteWiedergabe prüft die
  // Freeze-Sperre), damit die eine Speicherung die neue wiedergabe_rev trägt. Ruft history.ts speichere anders (öfter, später, mit einem anderen
  // Stand zuerst), entstünde die Wiedergabe zum falschen Stand; Tests: proj_fix_b4_speichern, projekt_verlauf.
  const vorab: { wiedergabe: Record<string, unknown> | null; erster: boolean; vorhoeren: Map<string, string> | null } =
    { wiedergabe: null, erster: true, vorhoeren: null };
  const haken: Haken = { ...this.haken(o), speichere: (p) => {
    if (vorab.erster) {
      vorab.erster = false;
      for (const [sha, pfad] of quellen) {
        try { this.cache.fordereAn(sha, pfad); } catch (e) { this.ctx.log({ typ: 'proj_dekodier_fehler', sha, fehler: (e as Error).message }); }
      }
      const dekodiertAnders = this.betrifftWiedergabe(p, this.gleicheDekodiertAb(p, false));
      // 1.14: a gone track or take ends its audition and the map change always reloads. The map itself changes only after the entry is logged.
      vorab.vorhoeren = this.gueltigeVorhoeren(o, p);
      if (betrifftWiedergabe || dekodiertAnders || vorab.vorhoeren.size !== o.vorhoeren.size) {
        vorab.wiedergabe = this.bereiteWiedergabe(o, p, vorab.vorhoeren);
      }
    }
    this.projekte.speichere(o.slug, p);
  } };
  let w: Wirkung;
  try { w = schreibe(haken); } catch (e) { await zurueck(alt); throw e; }
  if (!w.eintrag) return { code: 200, j: { rev: alt.rev, projekt: alt } };
  const neu = w.projekt;
  const wiedergabe = vorab.wiedergabe;
  if (typeof wiedergabe?.nr !== 'number') neu.wiedergabe_rev = alt.wiedergabe_rev;   // ohne neue Wiedergabe gilt die alte Nummer
  o.projekt = neu;
  this.meldeStand(o);                        // 1.8 S3 (D13): also the way of undo and redo
  if (neueQuelle(alt, neu)) this.meldeEinsammeln(o);
  if (vorab.vorhoeren) this.setzeVorhoeren(o, vorab.vorhoeren);
  this.instrumente.abgleich(neu);                                        // plan 1.11 task 17: before the Surge mirror (it waits for a swapped slot)
  void this.surge.gleiche(neu);                                          // 1.9 U5: command, undo and redo (no await: the hosts answer in their own time)
  const kern: Record<string, unknown> = {};
  if (gesetzt.length) kern.regler = gesetzt.some((r) => r.quittung === null) ? 'kein_kern' : 'ok';
  if (stifte.length) {
    kern.stifte = stiftQ.some((q) => q === null) ? 'kein_kern' : 'ok';
    if (stiftQ.some((q) => quittungOk(q))) o.merk.stifte = true;   // the stored playback file lacks these pins: a core restart translates fresh
  }
  // Spec 6.30: die Freeze-Sperre gilt bis zum Laden. bereiteWiedergabe prüfte sie nach den Regler-Quittungen, zwischen dort und /k/arr/laden liegt
  // kein await. War sie gesetzt, bleibt die Änderung gespeichert und das Laden folgt nach der Freigabe.
  const nr = wiedergabe?.nr;
  const ladeNr = typeof wiedergabe?.laden === 'number' ? wiedergabe.laden : nr;   // 1.14: the audition file when one is on
  if (wiedergabe) kern.wiedergabe = typeof nr === 'number' ? { nr: ladeNr, quittung: await this.ladeNr(ladeNr as number, quelle, nr) } : wiedergabe;
  // Spec 6.31: Loop und Tempo sperrt 6.23 wie das Laden. Kam die Änderung vor der Sperre durch die Prüfung, werden sie gemerkt und nach der
  // Freigabe gesendet (holeNach, mit dem Stand von dann). Das Metronom sperrt 6.23 nicht.
  if (kanonisch(alt.loop) !== kanonisch(neu.loop)) {
    if (this.sperren > 0) { o.merk.loop = true; kern.loop = { aufgeschoben: true }; } else kern.loop = await this.kern.loop(neu, quelle);
  }
  if (kanonisch(alt.metronom) !== kanonisch(neu.metronom)) kern.metronom = await this.kern.metronom(neu, quelle);
  // a container that gets a module is told after the swap; a refusal takes the swap back (below); what the core reported stays in /lage
  const nach = neu.live ? await this.sendeContainer(neu, 'nach', quelle) : [];
  if (alt.tempo_bpm !== neu.tempo_bpm) {                                                               // Spec 2.7: ein Tempo-Weg
    if (this.sperren > 0) { o.merk.tempo = true; kern.tempo = { aufgeschoben: true }; } else kern.tempo = await this.kern.tempo(neu.tempo_bpm, quelle);
  }
  this.hosts.abgleich(neu);                  // plan 1.11 task 7: after the playback is loaded (a removed stage is gone from the core before its host stops)
  this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: neu.rev, label: w.eintrag.label, quelle } });
  if (nach.length) {
    // the core refused a container source after the swap: the change is taken back (one undo step), so a refusal never leaves the project changed
    const grund = { fehler: 'kern_lehnt_ab', text: 'the core refused the container change; the project was set back', container: nach[0].container,
      status: nach[0].status, kern: nach[0].grund };
    try {
      const zu = await this.umkehrVollzug(o, 'undo', quelle);
      return { code: 409, j: { ...grund, rev: o.projekt.rev, projekt: o.projekt, zurueckgenommen: zu.code === 200 } };
    } catch (e) {
      this.ctx.log({ typ: 'proj_kern_lehnt_ab_zurueck_fehler', fehler: (e as Error).message });
      return { code: 409, j: { ...grund, rev: neu.rev, projekt: neu, zurueckgenommen: false } };
    }
  }
  return { code: 200, j: { rev: neu.rev, projekt: neu, kern } };
}

// FIND SOUND: sets the transient core rows spur/<slot>/bk/<k> of some knobs of a Baukasten track (what the light command geraet_param_setzen sends),
// without changing the project: no revision, no undo step, no file. The core clears the rows with its next playback build. Without a core
// (no receipt) it resolves without effect; a refusal of the core (Stop Cypher, hand holds the regulator) is a 409.
export async function hoereBk(this: ProjSitzung, spurId: string, werte: Readonly<Record<string, number>>, quelle: Quelle, faderDb?: number): Promise<void> {
  const o = this.offen;
  if (!o) throw new ProjFehler(409, 'kein_projekt');
  const slot = bkSlot(o.projekt, spurId);
  if (slot === null) throw new ProjFehler(409, sucheSpur(o.projekt, spurId) ? 'geraet_falsch' : 'spur_unbekannt');
  // the core has the rows spur/<slot>/bk/<k> for the first BK_LIVE_SLOTS bk tracks (= every bk track)
  if (slot > BK_LIVE_SLOTS) {
    throw new ProjFehler(409, 'param_nicht_live', {
      text: `only the first ${BK_LIVE_SLOTS} Cypher Modular tracks have rows while a knob is dragged; change the track to hear the others`,
    });
  }
  const soll: Soll[] = [];
  for (const [k, v] of Object.entries(werte)) {
    if (!BK_PARAMETER.includes(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: `knob ${k}: only k1..k64 with a value from 0 to 1 exist` });
    }
    soll.push({ pfad: `spur/${slot}/bk/${Number(k.slice(1))}`, wert: v });
  }
  const faderPfad = `spur/${sucheSpur(o.projekt, spurId)!.nr}/fader`;
  if (faderDb !== undefined) {
    if (typeof faderDb !== 'number' || !Number.isFinite(faderDb) || faderDb < FADER_MIN || faderDb > FADER_MAX) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: `faderDb: a value from ${FADER_MIN} to ${FADER_MAX} dB is required` });
    }
    soll.push({ pfad: faderPfad, wert: faderDb });
  }
  if (!soll.length) return;
  const alle = (await this.kern.setzeRegler(soll, quelle)).filter((r) => quittungAbgelehnt(r.quittung));
  // a refused fader row only means the audition plays at its own level: ignored (logged), a refused knob row is the 409
  const abgelehnt = alle.filter((r) => r.pfad !== faderPfad);
  if (alle.length > abgelehnt.length) this.ctx.log({ typ: 'proj_klang_runde_pegel_abgelehnt', pfad: faderPfad });
  if (abgelehnt.length) throw new ProjFehler(409, 'regler_abgelehnt', { regler: abgelehnt });
}

// Master A/B (POST /proj/master_ab): sets the transient core rows pm/fader and ins/<art>/<slot>/an of stages that sit on the master of the open
// project, without changing the project: no revision, no undo step, no file. A project load or a core restart sends every row of the project again.
// Without a core (no receipt) it resolves without effect; any refused row is a 409 regler_abgelehnt (A/B must not run half set).
export async function hoereMaster(this: ProjSitzung, zeilen: readonly { pfad: string; wert: number }[], quelle: Quelle): Promise<void> {
  const o = this.offen;
  if (!o) throw new ProjFehler(409, 'kein_projekt');
  const stufen = new Set((o.projekt.master?.inserts ?? []).map((i) => `ins/${i.art}/${i.slot}/an`));
  const soll: Soll[] = [];
  for (const z of zeilen) {
    if (z.pfad !== 'pm/fader' && !stufen.has(z.pfad)) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: `row ${z.pfad}: only pm/fader and the switches of master insert stages can be set` });
    }
    const imBereich = z.pfad === 'pm/fader' ? z.wert >= FADER_MIN && z.wert <= FADER_MAX : z.wert === 0 || z.wert === 1;
    if (typeof z.wert !== 'number' || !Number.isFinite(z.wert) || !imBereich) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: `row ${z.pfad}: the value is out of range` });
    }
    soll.push({ pfad: z.pfad, wert: z.wert });
  }
  if (!soll.length) return;
  const abgelehnt = (await this.kern.setzeRegler(soll, quelle)).filter((r) => quittungAbgelehnt(r.quittung));
  if (abgelehnt.length) throw new ProjFehler(409, 'regler_abgelehnt', { regler: abgelehnt });
}

// Was /proj/aendern nach aendere() tut, für einen Schreiber außerhalb (S3): Stand synchron setzen, dann nachziehen. Die Freeze-Sperre lehnt hier
// nichts ab (der Stand ist schon gesetzt), aber sie gilt für das Senden (Spec 6.32): unmittelbar vor Laden und Loop wird sie geprüft wie in holeNach;
// gesperrt (auch die eigene des Aufrufers oder die des nächsten Freeze) bleibt beides am Offen gemerkt und folgt nach der letzten Freigabe.
export function uebernimm(this: ProjSitzung, w: Wirkung, meta: Meta): Promise<void> {
  const o = this.brauchOffen();
  if (!w.eintrag) return Promise.resolve();
  const alt = o.projekt, neu = w.projekt, quelle = meta.quelle;
  neu.wiedergabe_rev = alt.wiedergabe_rev;
  o.projekt = neu;                                                     // synchron, vor dem ersten await
  this.meldeStand(o);
  this.instrumente.abgleich(neu);
  void this.surge.gleiche(neu);
  return this.seriell(async () => {
    if (this.offen !== o) return;                                      // inzwischen geschlossen
    // Live container: rows that make something louder wait for the core's receipt of the playback load (project/controls_order.ts)
    const dekodiert = neu.live ? this.betrifftWiedergabe(neu, this.gleicheDekodiertAb(neu, false)) : false;
    const teilen = neu.live === true && (w.betrifft_wiedergabe || dekodiert);
    const geteilt = teilen ? teileReglerLive(alt, w.regler_aenderungen) : { vorher: w.regler_aenderungen, nachher: [] };
    const { vorher } = geteilt;
    // the mute of a track that sounds in the old playback goes into the load (stumm_start), not after its receipt: the stems and the silence of the loop
    // start in one block
    const { stummStart, rest: nachher } = teileStummStart(alt, geteilt.nachher);
    if (stummStart.length) o.merk.stummStart = stummStart;
    this.meldeRegler(o, await this.kern.setzeRegler(vorher, quelle));
    const dekodiertAnders = neu.live ? dekodiert : this.betrifftWiedergabe(neu, this.gleicheDekodiertAb(neu, false));
    if (w.betrifft_wiedergabe || dekodiertAnders) {
      const l = await this.ladeOderMerke(quelle);
      if (nachher.length) {
        if (l.aufgeschoben === true) o.merk.reglerNach.push(...nachher);
        else if (typeof l.nr === 'number' && !quittungAbgelehnt((l.quittung ?? null) as Quittung)) {
          this.meldeRegler(o, await this.kern.setzeRegler(nachher, quelle));
        } else {   // the old playback stays: its rows stay too
          this.ctx.log({ typ: 'proj_uebernimm_regler_nach_abgelehnt', slug: o.slug, zeilen: nachher.length });
        }
      }
    }
    if (kanonisch(alt.loop) !== kanonisch(neu.loop)) await this.loopOderMerke(o, quelle);
    if (kanonisch(alt.metronom) !== kanonisch(neu.metronom)) await this.kern.metronom(neu, quelle);
    this.ctx.verteile({ a: 'proj', f: { slug: o.slug, rev: neu.rev, label: w.eintrag.label, quelle } });
  });
}

// Wiedergabe-Datei mit der nächsten Nummer des einen Zählers, ohne /k/arr/laden (Plan S3: Freeze, Export)
export function schreibeWiedergabeFuer(this: ProjSitzung, p: Projekt): { nr: number; datei: string } {
  const nr = this.zaehler.naechste();
  const w = this.uebersetzeFuer(p, nr, undefined, false);
  return { nr, datei: schreibeWiedergabe(this.arbeitsordner, w) };
}

// Paket 1.13 (proj_warp): der Warp eines Audio-Clips mit Marker-Liste, Segment-Tempo und der Gegenprobe W(bei_beat). Beats in der Antwort:
// beat = Clip-Beat des Markers, projekt_beat = wo er im ersten Durchlauf des Clips liegt; von_beat, bis_beat und bei_beat sind Projekt-Beats.
// Slice 3a: höchstens max (Vorgabe MARKER_VORGABE) Marker, die Antwort sagt marker_zahl (im Clip), marker_gezeigt und weiter_ab_projekt_beat.
export function warpLage(this: ProjSitzung, clipId: string | null, von: number | null, bis: number | null, bei: number | null, max: number | null = null,
    transMax: number | null = null, quelleGanz = false): Antwort {
  const o = this.brauchOffen();
  if (!clipId) throw new ProjFehler(400, 'argument_ungueltig', { text: 'clip_id: an audio clip id is required' });
  const g = sucheClip(o.projekt, clipId);
  if (!g) throw new ProjFehler(404, 'clip_unbekannt');
  if (g.clip.art !== 'audio') throw new ProjFehler(409, 'feld_nur_audio');
  const c = g.clip, w = c.warp;
  if (!w) return { code: 200, j: { clip_id: c.id, start_beat: c.start_beat, laenge_beats: c.laenge_beats, warp: null } };
  const m = w.marker, grenze = max ?? MARKER_VORGABE;
  const passend = m.map(([quellS, beat], i) => ({ quell_s: quellS, beat, projekt_beat: c.start_beat + beat - w.versatz_beats,
    segment_bpm: i + 1 < m.length ? segmentBpm(m, i) : null }))
    .filter((x) => (von === null || x.projekt_beat >= von) && (bis === null || x.projekt_beat <= bis));
  const marker = passend.slice(0, grenze);
  // Slice 4: Transienten der Quelle (Quellsekunden). transienten_zahl = im Bereich des Clips (die Länge einer Kopie), null = Quelle nicht
  // dekodiert; transienten = die im Fenster von_beat..bis_beat (Projekt-Beats der ersten Kopie), gedeckelt durch transienten_max
  const tAlle = this.transientenLager.fuer(c.quelle.sha256);
  const bereichEnde = w.versatz_beats + (c.loop_beats ?? c.laenge_beats);
  const tBereich = tAlle === null ? null : tAlle.filter((q) => { const b = beatBeiQuelle(m, q); return b >= w.versatz_beats && b < bereichEnde; });
  const tFenster = (tBereich ?? []).filter((q) => {
    const pb = c.start_beat + beatBeiQuelle(m, q) - w.versatz_beats;
    return (von === null || pb >= von) && (bis === null || pb <= bis);
  });
  // quelleGanz (Schlussrunde): alle Transienten der Quelle, ohne Marker, Bereich und Fenster; der Editor bildet sie selbst über seine aktuellen Marker ab
  const tGezeigt = (quelleGanz ? tAlle ?? [] : tFenster).slice(0, transMax ?? TRANSIENTEN_VORGABE);
  const { marker: _alle, ...kopf } = w;
  return { code: 200, j: { clip_id: c.id, start_beat: c.start_beat, laenge_beats: c.laenge_beats,
    warp: { ...kopf, eins_unsicher: w.eins_unsicher === true, marker_zahl: m.length, marker_gezeigt: marker.length,
      transienten_zahl: tBereich === null ? null : tBereich.length, transienten: tGezeigt, transienten_gezeigt: tGezeigt.length,
      ...(passend.length > grenze ? { weiter_ab_projekt_beat: passend[grenze].projekt_beat } : {}),
      tempo: tempoUebersicht(m), erster_marker: { quell_s: m[0][0], beat: m[0][1] }, marker },
    ...(bei === null ? {} : { bei: gegenprobe(c, bei) }) } };
}

// Automation Slice 1 (proj_auto): the points of one lane (lane_id) or of all lanes of a track (spur_id), plus the lane value at bei_beat
// (dB for fader, the raw value for the other targets; the same laneWert the core computes).
// von_beat/bis_beat are project beats, inclusive; at most max points (default AUTO_PUNKTE_VORGABE).
export function autoLage(this: ProjSitzung, laneId: string | null, spurId: string | null, von: number | null, bis: number | null,
  bei: number | null, max: number | null, clipId: string | null = null, ziel: string | null = null): Antwort {
  const o = this.brauchOffen();
  if (clipId) {   // 1.12 slice 5: the envelopes of one clip (clip beats), one target or all
    if (laneId || spurId) throw new ProjFehler(400, 'argument_ungueltig', { text: 'clip_id comes alone: not together with lane_id or spur_id' });
    if (ziel !== null && !HK_ZIELE.includes(ziel)) throw new ProjFehler(400, 'huellkurve_ziel', { text: `ziel: ${HK_ZIELE.join(' | ')}` });
    const g = sucheClip(o.projekt, clipId);
    if (!g) throw new ProjFehler(404, 'clip_unbekannt');
    const grenzeC = max ?? AUTO_PUNKTE_VORGABE;
    if (ziel === null) {
      return { code: 200, j: { clip_id: g.clip.id, spur_id: g.spur.id,
        huellkurven: (g.clip.huellkurven ?? []).map((h) => huellkurveAnsicht(g.clip.id, g.spur.id, g.clip, h, von, bis, bei, grenzeC)) } };
    }
    const h = (g.clip.huellkurven ?? []).find((x) => x.ziel === ziel);
    if (!h) throw new ProjFehler(404, 'huellkurve_unbekannt', { text: `${g.clip.id} has no ${ziel} envelope` });
    return { code: 200, j: huellkurveAnsicht(g.clip.id, g.spur.id, g.clip, h, von, bis, bei, grenzeC) };
  }
  if (ziel !== null) throw new ProjFehler(400, 'argument_ungueltig', { text: 'ziel belongs to clip_id' });
  if (!laneId && !spurId) throw new ProjFehler(400, 'argument_ungueltig', { text: 'lane_id, spur_id or clip_id is required' });
  const grenze = max ?? AUTO_PUNKTE_VORGABE;
  if (laneId) {
    for (const { strang, strangId } of alleStraenge(o.projekt)) {   // 1.12 slice 6: a lane may sit on a group, a return or the master
      const l = (strang.automation ?? []).find((x) => x.id === laneId);
      if (l) return { code: 200, j: laneAnsicht(strangId, l, von, bis, bei, grenze) };
    }
    throw new ProjFehler(404, 'lane_unbekannt');
  }
  const s = sucheStrang(o.projekt, spurId!);   // a track, group, return or 'master'
  if (!s) throw new ProjFehler(404, 'spur_unbekannt');
  const sid = s === o.projekt.master ? 'master' : (s as { id: string }).id;
  return { code: 200, j: { spur_id: sid, lanes: (s.automation ?? []).map((l) => laneAnsicht(sid, l, von, bis, bei, grenze)) } };
}

// --- öffnen ---------------------------------------------------------------------------------------------------------
// opt.werkbank / opt.vorlage (workbench stage 1): a module is a project with the marker; a template is applied after the open, as ONE history step
// through aendern (not inside the serial open: it would wait on itself). Everything is checked before anything is created or opened.
// opt.tracker (tracker stage 4): the project gets the tracker marker; `vorlage` then names a tracker template (8bit-4kanal, chip); never with werkbank.
export async function neu(this: ProjSitzung, name: unknown, quelle: Quelle, bestaetigt = false,
    opt: { werkbank?: unknown; vorlage?: unknown; tracker?: unknown } = {}): Promise<Antwort> {
  const tracker = opt.tracker === true;
  const vorlage = opt.vorlage === undefined || tracker ? null : vorlageVon(opt.vorlage);
  const trackerVorlage = opt.vorlage === undefined || !tracker ? null : trackerVorlageVon(opt.vorlage);
  const r = await this.seriell(async () => {
    if (opt.werkbank !== undefined && opt.werkbank !== true) throw new ProjFehler(400, 'argument_ungueltig', { text: 'werkbank: true or absent expected' });
    if (opt.tracker !== undefined && opt.tracker !== true) throw new ProjFehler(400, 'argument_ungueltig', { text: 'tracker: true or absent expected' });
    if (tracker && opt.werkbank !== undefined) throw new ProjFehler(400, 'argument_ungueltig', { text: 'tracker and werkbank exclude each other' });
    if (opt.vorlage !== undefined && opt.werkbank !== true && !tracker) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: 'vorlage needs werkbank: true' });
    }
    if (opt.vorlage !== undefined && !tracker && vorlage === null) {
      throw new ProjFehler(400, 'vorlage_unbekannt', { text: `vorlage: one of ${vorlagenListe().map((v) => v.id).join(' | ')}` });
    }
    if (opt.vorlage !== undefined && tracker && trackerVorlage === null) {
      throw new ProjFehler(400, 'vorlage_unbekannt', { text: `vorlage: one of ${trackerVorlagenListe().map((v) => v.id).join(' | ')}` });
    }
    this.riegel(quelle);
    this.sperreOeffnen();
    this.sperreLiveLaeuft(quelle, bestaetigt);
    this.sperreFremderTransport(quelle);
    if (trackerVorlage !== null) sichereWerksProbenImStandardOrdner();   // the templates play the amiga device: its factory samples must exist
    // a template sets the tempo, which is refused while a deck plays; the open must not leave an empty module behind
    if ((vorlage !== null || trackerVorlage !== null) && this.lage.deckLaeuft()) {
      throw new ProjFehler(409, 'deck_laeuft', { text: 'Stop the decks first: a module sets its own tempo.' });
    }
    return this.oeffnetGerade(() => {
      const { slug } = this.projekte.lege(name as string, opt.werkbank === true ? { werkbank: true } : tracker ? { tracker: true } : {});
      return this.oeffneIntern(slug, quelle);
    });
  });
  const gewaehlt = vorlage !== null ? { name: vorlage.name, befehle: vorlageBefehle(vorlage) }
    : trackerVorlage !== null ? { name: trackerVorlage.name, befehle: trackerVorlageBefehle(trackerVorlage) } : null;
  if (gewaehlt === null || r.code !== 200) return r;
  const o = r.j as { projekt: Projekt };
  const a = await this.aendern({ rev: o.projekt.rev, label: `Template ${gewaehlt.name}`, befehle: gewaehlt.befehle }, quelle);
  return a.code === 200 ? { code: 200, j: { ...(r.j as object), projekt: (a.j as { projekt: Projekt }).projekt } } : a;
}
