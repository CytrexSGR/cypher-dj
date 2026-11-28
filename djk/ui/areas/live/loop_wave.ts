// Loop, tempo, loop recording, kit, wave and file routes of the page server (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { type Route, type Bereich } from '../../http/router.ts';
import type { Felder } from '../../../conductor/src/addresses.ts';
import { LOOP_NAME } from '../../loops.ts';
import { WelleFehler, loopQuelle, schnittQuelle, fassungQuelle, dateiQuelle } from '../../wave_cache.ts';
import { OEFFENTLICH, instanz, kitsOrdnerVorgabe, zusatzKit, loopOrdnerVorgabe } from '../../paths.ts';
import { tempoRampe } from '../../tempo_ramp.ts';
import { type Fassung } from '../../deck_operation.ts';
import { loopZuKlang } from '../../../loops/kit_write.mjs';
import { kanalOffen } from '../../hand_operation.ts';
import { Katalog, KatalogFehler } from '../../catalog.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { graphenOrdner } from '../../graphs.ts';
import { TYPEN } from '../../server_kopf.ts';
import type { Oberflaeche } from '../../server.ts';

export function loopOrdner(this: Oberflaeche): string { return this.opt.loops ?? loopOrdnerVorgabe(instanz()); }
// Loop actions of the page server: rec and kit. Loading and starting loops is the loop deck (container core).
export function loop(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void | Promise<void> {
  const { aktion } = d;
  if (aktion === 'rec') return this.loopRec(d, a);  // MVP 2 Scheibe 2: kein box-Feld, eigener Zweig
  if (aktion === 'kit') return this.loopKit(d, a);  // MVP 2 Scheibe 3: → STRUDEL, nur Dateien, kein Kern
  return this.json(a, 400, { fehler: 'unbekannte_aktion', aktion });   // container core: the loop boxes are gone, loading is the loop deck
}
// Plan Tempo-Folge (§4.2 /k/tempo/rampe): das Master-Tempo fährt ab der nächsten Takt-Eins über einen Takt auf bpm
// (60 bis 200, auf 0,01 gerundet). Andreas und Cypher; bei Stop Cypher lehnt die Seite Cypher mit 409 ki_gestoppt ab. Laufende Decks
// folgen im Varispeed (Welle 3, ADR 028); die Antwort trägt die Quittung.
export async function tempo(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  // Andreas 2026-10-05: „du willst ernsthaft das ich dir 138 bpm vortippe?“ – Tempo ist auch Cyphers Hand; Stop Cypher hält es.
  if (this.quelle() === 'cypher' && this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
  // D1 Spec 6.32: eine Tempo-Rampe verändert eine laufende Freeze-Datei; während der Sperre des Bereichs proj (S3) nimmt die Route nichts an
  if (this.proj.sitzung.ladenGesperrt()) return this.json(a, 409, { fehler: 'beschaeftigt', text: 'a freeze is running; tempo changes wait until it is done' });
  const u = this.kern.uhr as unknown as { beat: number; bpm: number } | null;
  const rampe = tempoRampe(u?.beat ?? 0, u?.bpm ?? 128, d.bpm as number, this.proTakt());   // D1 S2: derselbe Weg wie der Bereich proj (Spec 2.7)
  if (!rampe) return this.json(a, 400, { fehler: 'bereich', text: 'bpm must be a number from 60 to 200' });
  const felder = { id: Number(++this.id), quelle: this.quelle(), ...rampe };
  this.kern.sende('/k/tempo/rampe', felder);
  this.gesendet++;
  const quittung = await this.warteQuittung(felder.id, felder.ab_beat);
  this.json(a, 200, { ok: true, gesendet: '/k/tempo/rampe', felder, quittung });
}
// MVP 2 Scheibe 2/3 (§4.9 /k/loop/rec): REC auf C. beats 1, 2, 4, 8, 16 oder 32; Name nur syntaktisch geprüft (ob er schon
// vergeben ist, weiß erst der Kern nach der Aufnahme: /e/mitschnitt Status 1).
// Plan djk-hand-mcp-studio (Review): die Antwort wartet auf die Kern-Quittung (wie /regler), damit Status 6 (Stop Cypher ki_gestoppt,
// ueberlappung, eine Tempo-Rampe im Mitschnittfenster; jedes feste Tempo ist erlaubt, core.cpp:196) beim Aufrufer ankommt statt still zu verpuffen.
export async function loopRec(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const beats = d.beats;
  const name = d.name;
  if (![1, 2, 4, 8, 16, 32].includes(beats as number)) return this.json(a, 400, { fehler: 'unbekannte_beats', beats });
  if (typeof name !== 'string' || !LOOP_NAME.test(name)) return this.json(a, 400, { fehler: 'unbekannter_name', name });
  const summe = d.summe === undefined ? 0 : d.summe === true || d.summe === 1 ? 1 : d.summe === false || d.summe === 0 ? 0 : -1;
  if (summe < 0) return this.json(a, 400, { fehler: 'unbekannte_summe', summe: d.summe });   // 1: Strudel sum erz/1+2+3 instead of erz/1
  const felder: Felder = { id: Number(++this.id), quelle: this.quelle(), beats: beats as number, name, summe };
  this.kern.sende('/k/loop/rec', felder);
  this.gesendet++;
  this.json(a, 200, { ok: true, gesendet: '/k/loop/rec', felder, quittung: await this.warteQuittung(felder.id) });
}
// pad/<n> as the module gate sees it (export, modul_einsetzen, modul_setzen): the rows say open, or a ramp of Cypher on trim or fader is planned or running
export function kanalGeoeffnet(this: Oberflaeche, kanal: string): boolean {
  return kanalOffen(this.stand.regler, kanal) || this.kanalFaehrt(kanal);
}
// a planned or running ramp of Cypher on fader or trim of a container strip (fahrtEnde holds Cypher's parts only)
export function kanalFaehrt(this: Oberflaeche, kanal: string): boolean {
  const beat = this.kern.uhr?.beat ?? 0;
  for (const [pfad, l] of this.fahrtEnde) if ((pfad === `${kanal}/fader` || pfad === `${kanal}/trim`) && l.some((e) => e.ab + e.dauer >= beat)) return true;
  return false;
}
// MVP 2 Scheibe 3 (E2): Loop wird Klang im Zusatz-Kit (rec, Prüfinstanz rec-<i>); der Erzeuger lädt ihn nach.
export function loopKit(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  const name = d.name;
  if (typeof name !== 'string' || !LOOP_NAME.test(name)) return this.json(a, 400, { fehler: 'unbekannter_loop', name });
  if (d.klang !== undefined && typeof d.klang !== 'string') return this.json(a, 400, { fehler: 'unbekannter_klang' });
  // Riegel für Cypher: der Zusatz-Kit rec hängt am Drums-Erzeuger (Strom 1); Stop Cypher und AUTO aus gelten auch hier
  if (this.quelle() === 'cypher') {
    if (this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
    if (!leseMusterStand(this.musterOrdner(1)).autonom) return this.json(a, 409, { fehler: 'auto_aus', strom: 1, text: 'AUTO is off for the drums instance: Andreas holds it' });
  }
  try {
    const r = loopZuKlang({ loopOrdner: this.loopOrdner(), kitsOrdner: this.opt.kits ?? kitsOrdnerVorgabe(),
      basis: this.opt.kit ?? 'battery', zusatz: zusatzKit(), loop: name, klang: d.klang as string | undefined });
    this.json(a, 200, { ok: true, ...r });
  } catch (e) {
    this.json(a, 400, { fehler: 'kit', text: (e as Error).message });
  }
}
// Plan Oberfläche T2 (Spec E4): ?loop=<name> oder ?material=<id>&bpm=<basis>&fassung=<n>. Liest nur, sendet nichts an den Kern.
export async function welleAus(this: Oberflaeche, url: URL, a: http.ServerResponse): Promise<void> {
  try {
    const loop = url.searchParams.get('loop'), material = url.searchParams.get('material'), sha = url.searchParams.get('sha');
    const schnitt = url.searchParams.get('schnitt');
    const q = loop !== null ? loopQuelle(this.loopOrdner(), loop)
      : schnitt !== null ? schnittQuelle(graphenOrdner(), schnitt)   // sampler A1: the cut audio
      // Browser (S5): der Pfad kommt aus dem Katalog, nie aus der Anfrage. Ableton-geschützte Dateien sind für ffmpeg nicht lesbar (422).
      : sha !== null ? (() => {
        // S6 Task 14: Stems und Takes liegen im Projektordner, nicht im Katalog; deren Pfad kommt aus dem offenen Projekt
        const ausProjekt = () => { const p = this.proj.sitzung.projektQuellPfad(sha); return p ? dateiQuelle(p, sha) : null; };
        let z;
        try { z = this.katalog.eintrag(sha); } catch (e) { const q = ausProjekt(); if (q) return q; throw e; }
        if (!z?.pfad) { const q = ausProjekt(); if (q) return q; throw new WelleFehler(404, 'unbekannt'); }
        if (z.schutz === 'ableton') throw new WelleFehler(422, 'nur_live');
        // sha eines unterlegenen Objekts: dessen eigene Datei (Fundort auf diesem Host), nie stillschweigend die des Gewinners
        const pfad = sha === z.sha ? z.pfad : (this.mediathek.vorhanden() ? this.mediathek.pfadVon(sha) : null);
        if (!pfad) throw new WelleFehler(404, 'unbekannt');
        return dateiQuelle(pfad, sha, z.dauer_s);
      })()
      : material !== null ? fassungQuelle(this.opt.bestand, material, Number(url.searchParams.get('bpm')), Number(url.searchParams.get('fassung')))
      : (() => { throw new WelleFehler(400, 'quelle_fehlt'); })();
    // Schließt die Seite die Anfrage (Auswahl gewechselt), bricht die Dekodierung ab, wenn sonst niemand auf sie wartet (S5-Review B2)
    const ac = new AbortController();
    a.on('close', () => { if (!a.writableFinished) ac.abort(); });
    const datei = await this.welle.hole(q, ac.signal);
    a.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(datei).on('error', () => a.destroy()).pipe(a);   // Review F6: Lesefehler beendet nur die Antwort
  } catch (e) {
    if (a.destroyed) return;                                   // die Seite ist weg (Abbruch): nichts mehr zu melden
    const code = e instanceof WelleFehler || e instanceof KatalogFehler ? e.code : 500;
    this.json(a, code, { fehler: (e as Error).message });
  }
}
// Plan Oberfläche T5: Raster der Fassung für die Deck-Welle (erster Schlag, erste Eins, Tempo, Länge). Liest nur.
export function fassungAus(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  try {
    const q = fassungQuelle(this.opt.bestand, url.searchParams.get('material') ?? '', Number(url.searchParams.get('bpm')), Number(url.searchParams.get('fassung')));
    const j = JSON.parse(fs.readFileSync(path.join(path.dirname(q.datei), 'fassung.json'), 'utf8')) as Record<string, unknown>;
    this.json(a, 200, { erster_schlag_frame: j.erster_schlag_frame, erste_eins_quell_beat: j.erste_eins_quell_beat, basis_bpm: j.basis_bpm, frames: j.frames });
  } catch (e) {
    this.json(a, e instanceof WelleFehler ? e.code : 500, { fehler: (e as Error).message });
  }
}
export function datei(this: Oberflaeche, pfad: string, a: http.ServerResponse): void {
  let rel: string;
  try { rel = pfad === '/' ? 'index.html' : decodeURIComponent(pfad).replace(/^\/+/, ''); } catch { return this.json(a, 400, { fehler: 'pfad', text: 'the path is not valid' }); }
  const voll = path.resolve(OEFFENTLICH, rel);
  if (!voll.startsWith(OEFFENTLICH + path.sep) || !fs.existsSync(voll) || !fs.statSync(voll).isFile()) {
    return this.json(a, 404, { fehler: 'nicht_gefunden' });
  }
  a.writeHead(200, { 'content-type': TYPEN[path.extname(voll)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(voll).on('error', () => a.destroy()).pipe(a);
}
