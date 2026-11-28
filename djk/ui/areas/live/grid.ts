// Beat grid, listening and live analysis methods of the page server (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { leseBusRing, leseBusRingSeit, messeLive } from '../../project/sound_live.ts';
import { LIVE_VORLAUF_FRAMES, LIVE_LAUTHEIT_FRAMES } from '../../project/sound_contract.ts';
import { fassungQuelle } from '../../wave_cache.ts';
import { shmOrdner, rasterOrdnerVorgabe, huellenVorgabe } from '../../paths.ts';
import { hotcueDatei, schreibeHotcues, type Fassung, rasterSchritt, RASTER_MAX, rasterDatei, schreibeRaster, einsSetzen, rasterErbe, einsNachFix, einsZeile, haengeKorrekturAn, letzteEinsZeile } from '../../deck_operation.ts';
import { kanalOffen } from '../../hand_operation.ts';
import { OhrLeser, OSZI_KANAELE, oszi, hoerAntwort, hoerLage, partnerVon, sync as ohrSync, type DeckLage, type DeckStand as OhrDeckStand } from '../../ear.ts';
import { seqGruppe } from '../../project/seq.ts';
import { pultContainerPfad } from '../../../contract/pult.ts';
import { OFFENE_DECKS, istOffenesDeck } from '../../server_kopf.ts';
import { Oberflaeche } from '../../server.ts';

export function rasterWert(this: Oberflaeche, deck: number, f: Fassung): { versatz_frames: number; gespeichert_frames: number } {
  const g = this.rasterGespeichert(f);
  const x = this.rasterLive[String(deck)];
  return { versatz_frames: x && x.schluessel === Oberflaeche.fassungSchluessel(f) ? x.v : g, gespeichert_frames: g };
}
export function rasterOrdner(this: Oberflaeche): string { return this.opt.rasterOrdner ?? rasterOrdnerVorgabe(); }
export function huellenPfad(this: Oberflaeche): string { return this.opt.huellen ?? huellenVorgabe(); }
export function einsDerFassung(this: Oberflaeche, mid: string, bpm: number, fassung: number): { eins: number; esf: number } | null {
  const k = `${mid}|${bpm}|${fassung}`, c = this.einsGelesen.get(k);
  if (c !== undefined) return c;
  try {
    const q = fassungQuelle(this.opt.bestand, mid, bpm, fassung);
    const j = JSON.parse(fs.readFileSync(path.join(path.dirname(q.datei), 'fassung.json'), 'utf8')) as Record<string, unknown>;
    const e = { eins: Number(j.erste_eins_quell_beat), esf: Number(j.erster_schlag_frame) };
    if (!Number.isFinite(e.eins) || !Number.isFinite(e.esf)) return null;
    this.einsGelesen.set(k, e);
    return e;
  } catch { return null; }
}
export function rasterErbeVon(this: Oberflaeche, f: Fassung): { v: number; von: number | null } {
  return rasterErbe(this.rasterOrdner(), f, { fpb: 48000 * 60 / f.basis_bpm, einsVon: (r) => this.einsDerFassung(f.material_id, f.basis_bpm, r) });
}
export function rasterGespeichert(this: Oberflaeche, f: Fassung): number { return this.rasterErbeVon(f).v; }
// Nur FIX (der ausdrückliche Speicherakt, Review B4; SET bleibt flüchtig wie der Raster-Versatz): die ganzen Beats im Versatz sind die Eins; sie gehört ins Material (korrekturen.jsonl art=eins), damit sie in
// jeder Folgefassung von selbst stimmt (kette.korrigieren). Ein Fehler hier darf das Grid nicht blockieren: nur loggen.
export function einsZurueck(this: Oberflaeche, st: { f: Fassung; eins: number }, v: number, quelle: 'FIX'): void {
  try {
    const mo = path.join(this.opt.bestand, st.f.material_id);
    const fpb = 48000 * 60 / st.f.basis_bpm;
    const ziel = einsNachFix({ v, fpb, eins: st.eins, letzte: letzteEinsZeile(mo) });
    if (ziel === null) return;
    const k = Math.round(v / fpb);
    haengeKorrekturAn(mo, einsZeile(st.f, ziel, k, quelle));
    this.opt.log?.({ typ: 'eins_korrektur', quelle, material_id: st.f.material_id, fassung: st.f.fassung, eins: ziel, beats: k });
  } catch (e) { this.opt.log?.({ typ: 'eins_korrektur_fehler', material_id: st.f.material_id, fehler: (e as Error).message }); }
}
export function rasterSenden(this: Oberflaeche, deck: number, f: Fassung, v: number): void {
  this.kern.sende('/k/deck/raster', { id: Number(++this.id), quelle: this.quelle(), deck, material_id: f.material_id,
    basis_bpm: f.basis_bpm, fassung: f.fassung, versatz_frames: v });
  this.gesendet++;
  this.rasterLive[String(deck)] = { schluessel: Oberflaeche.fassungSchluessel(f), v };
}
// POST /deck/raster {deck, schritt_ms} (relativ, |schritt| ≤ 100 ms) oder {deck, versatz_frames} (absolut, ganzzahlig)
export function deckRaster(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  if (!istOffenesDeck(d.deck)) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
  const st = this.deckStand(d.deck);
  if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
  if (d.set === true) return this.deckRasterSet(st, a);
  let v: number;
  if (typeof d.versatz_frames === 'number' && Number.isInteger(d.versatz_frames) && Math.abs(d.versatz_frames) <= RASTER_MAX) {
    v = d.versatz_frames;
  } else if (typeof d.schritt_ms === 'number' && Number.isFinite(d.schritt_ms) && Math.abs(d.schritt_ms) <= 100) {
    v = rasterSchritt(this.rasterWert(st.deck, st.f).versatz_frames, d.schritt_ms);
  } else {
    return this.json(a, 400, { fehler: 'schritt_oder_versatz' });
  }
  this.rasterSenden(st.deck, st.f, v);
  this.json(a, 200, { ok: true, ...this.rasterWert(st.deck, st.f) });
}
// GET /hoeren?deck=1..4&takte=1..16 (Vorgabe 4): Ohr T5, erlaubt für jede Quelle (lesend).
export function hoerenAus(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  const deck = Number(url.searchParams.get('deck'));
  if (!istOffenesDeck(deck)) return this.json(a, 400, { fehler: 'deck' });
  const takteRoh = url.searchParams.get('takte');
  const takte = takteRoh === null ? 4 : Number(takteRoh);
  if (!Number.isInteger(takte) || takte < 1 || takte > 16) return this.json(a, 400, { fehler: 'takte' });
  const u = this.kern.uhr;
  if (!u) return this.json(a, 409, { fehler: 'kein_kernstand' });
  const st = this.deckStand(deck);
  // A place with a SEQ deck has no track on its deck player but a group that plays into deck/N (ADR 038): the ear reads that channel too
  const op = this.proj.zugang.offen();
  const arr = this.proj.sitzung.lage.arr;
  const lage: DeckLage = hoerLage(deck, { geladen: st !== null, laeuft: st ? Number(st.z.status) >= 2 : false,
    seqDeck: !!op?.projekt.live && seqGruppe(op.projekt, deck) !== undefined, seqLaeuft: !!arr && (arr.status === 1 || arr.status === 2),
    offen: kanalOffen(this.stand.regler, pultContainerPfad[deck - 1]) });
  const r = hoerAntwort(this.ohr, lage, u.beat, u.bpm, takte);
  if (r.code === 200) {
    // Ohr T8 (Plan Rev. 4): Sync unvalidiert (Befund Slice 2, anschlagPhase instabil an Mischungen,
    // ~/messungen/2026-09-28-ohr-slice2/anschlag_echt.json) — geht NICHT ins Urteil (Task 9), nur mitgeliefert.
    const kanalDeck = deck - 1;
    const saetzeDeck = this.ohr.saetze(kanalDeck, r.j.gemessen_von_beat, r.j.gemessen_bis_beat);
    // Decision 3 (places plan): the partner is the lowest other deck that runs with an open channel
    const laufendOffen = OFFENE_DECKS.filter((n) => {
      const stN = this.deckStand(n);
      return stN !== null && Number(stN.z.status) >= 2 && kanalOffen(this.stand.regler, pultContainerPfad[n - 1]);
    });
    const partnerDeck = partnerVon(deck, laufendOffen);
    const saetzePartner = partnerDeck !== null
      ? this.ohr.saetze(partnerDeck - 1, r.j.gemessen_von_beat, r.j.gemessen_bis_beat) : null;
    const s = ohrSync(saetzeDeck, saetzePartner, u.bpm);
    r.j.sync = { sync_ms: s.sync_ms, deck_gegen_deck_ms: s.deck_gegen_deck_ms, n: s.n, partner: partnerDeck, validiert: false };
    r.j.hoerschein = this.hoerscheinstelle.letzter(deck);   // Ohr T10
    // Task 1.5: der Mess-Abgriff liegt NACH dem Trim (adr/008), also relativ korrigieren, nicht absolut.
    // Einheit dB; absoluter Soll für deck/N/trim (derselbe Pfad wie /regler), geklemmt auf die Reglertabelle ±24.
    // Kein Vorschlag, wenn der alte Trim unbekannt ist (stand.regler startet nach Seiten-Neustart leer, der Kern
    // schickt Neuabonnenten keine Regler: `trim_unbekannt`) oder wenn eine Seite stumm ist (ohr db10 −200).
    const v = r.j.vergleich;
    const pd = v.pegel_diff_db;
    if (typeof pd === 'number' && Number.isFinite(pd) && v.neu.lufs > -200 && v.laufend.lufs > -200) {
      const trimAlt = this.stand.regler[`deck/${deck}/trim`];
      if (typeof trimAlt === 'number' && Number.isFinite(trimAlt)) {
        v.trim_vorschlag_db = Math.max(-24, Math.min(24, Math.round((trimAlt - pd) * 10) / 10));
      } else {
        v.trim_unbekannt = true;
      }
    }
  }
  this.json(a, r.code, r.j);
}
// GET /oszi?kanal=<name>&sek=1..15 (default 5): the last seconds of one ring channel as envelope plus measurements. The 100 ms reader keeps
// only deck/1, deck/2 and master; every other channel is read here, once per request, so the extra channels cost the tick nothing.
export function osziAus(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  const kanal = url.searchParams.get('kanal') ?? '';
  if (!Object.hasOwn(OSZI_KANAELE, kanal)) return this.json(a, 400, { fehler: 'kanal' });
  const sekRoh = url.searchParams.get('sek');
  const sek = sekRoh === null ? 5 : Number(sekRoh);
  if (sekRoh === '' || !Number.isInteger(sek) || sek < 1 || sek > 15) return this.json(a, 400, { fehler: 'sek' });
  const ring = OSZI_KANAELE[kanal];
  const leser = new OhrLeser(this.huellenPfad(), [ring], sek * 1000);
  if (leser.lies(sek * 1000) === 0) return this.json(a, 409, { fehler: 'kein_ring' });
  const bpm = this.kern.uhr && Number.isFinite(this.kern.uhr.bpm) && this.kern.uhr.bpm > 0 ? this.kern.uhr.bpm : null;
  this.json(a, 200, { kanal, bpm, ...oszi(leser.alle(ring), { sek, bpm }) });
}
// GET /analyse/live: live picture of the master output from the audio ring. Always 200; steht: the ring counter did not move for 150 ms or more.
export function analyseLiveAus(this: Oberflaeche, a: http.ServerResponse): void {
  const x = leseBusRing(this.opt.busRing ?? path.join(shmOrdner(), 'bus'), LIVE_VORLAUF_FRAMES + LIVE_LAUTHEIT_FRAMES);
  if (x === null) return this.json(a, 200, { leer: true, grund: 'kein_ring' });
  const jetzt = Date.now(), l = this.liveLetzt;
  const steht = l !== null && l.w === x.w && jetzt - l.t >= 150;
  if (!(l !== null && l.w === x.w)) this.liveLetzt = { w: x.w, t: jetzt };   // keep the time of the first sight of this w, so a long stall stays steht
  this.json(a, 200, { leer: false, w: x.w, steht, ...messeLive(x.daten) });
}
// GET /analyse/pegel (and POST .../reset with reset = true): streaming master meter. Always 200; reads only the frames written since the previous read.
export function analysePegelAus(this: Oberflaeche, a: http.ServerResponse, reset = false): void {
  const pfad = this.opt.busRing ?? path.join(shmOrdner(), 'bus');
  let x = leseBusRingSeit(pfad, this.masterPegelW, 48000);
  if (x !== null && this.masterPegelW !== null && x.w < this.masterPegelW) {   // ring recreated, the counter went back
    this.masterPegelW = null;
    x = leseBusRingSeit(pfad, null, 48000);
  }
  if (x === null) { this.masterPegelW = null; return this.json(a, 200, { leer: true, grund: 'kein_ring' }); }
  this.masterPegel.schiebe(x.daten, x.luecke);
  this.masterPegelW = x.w;
  if (reset) this.masterPegel.zuruecksetzen();
  const jetzt = Date.now(), l = this.masterPegelLetzt;
  const steht = l !== null && l.w === x.w && jetzt - l.t >= 150;
  if (!(l !== null && l.w === x.w)) this.masterPegelLetzt = { w: x.w, t: jetzt };
  this.json(a, 200, { leer: false, w: x.w, steht, ...this.masterPegel.stand() });
}
// Ohr T10: je neuem Takt der Master-Uhr (Beat überschreitet ein Vielfaches von 4) Hörscheine ausstellen/zurückziehen.
export function hoerscheinTakt(this: Oberflaeche): void {
  const u = this.kern.uhr;
  if (!u) return;
  const takt = Math.floor(u.beat / 4);
  if (takt === this.hoerscheinLetzterTakt) return;
  this.hoerscheinLetzterTakt = takt;
  const decks: OhrDeckStand[] = OFFENE_DECKS.map((n) => {
    const st = this.deckStand(n);
    const laeuft = st !== null && Number(st.z.status) >= 2;
    const inhalt = st ? `${st.f.material_id}/${Math.round(st.f.basis_bpm * 1000)}_r${st.f.fassung}` : '';
    return { deck: n, laeuft, inhalt, bpm: st ? st.f.basis_bpm : 0 };
  });
  const aktionen = this.hoerscheinstelle.takt(this.ohr, u.beat, u.bpm, decks, (deck) => kanalOffen(this.stand.regler, pultContainerPfad[deck - 1]));
  for (const akt of aktionen) {
    // §4.5: quelle fest 'cypher' (die Analyse spricht als Cyphers Ohr, unabhängig von der Anfrage, die den Takt auslöste)
    this.kern.sende(akt.adresse, { id: Number(++this.id), quelle: 'cypher', ...akt.felder });
    this.gesendet++;
  }
}
// POST /deck/raster {deck, set: true}: der Beat unter dem stehenden Kopf wird Takt-Eins (einsSetzen). Der Kern hält beim
// Versatz den Quell-Beat unter dem Kopf, der Ton rückt um k Beats; der Sprung um −k stellt den Kopf physisch zurück.
// Laufend 409: dort würde der Ton gegen den Master springen.
export function deckRasterSet(this: Oberflaeche, st: NonNullable<ReturnType<Oberflaeche['deckStand']>>, a: http.ServerResponse): void {
  if (Number(st.z.status) >= 2) return this.json(a, 409, { fehler: 'deck_laeuft' });
  const alt = this.rasterWert(st.deck, st.f).versatz_frames;
  const n = einsSetzen({ v: alt, quell: Number(st.z.quell_beat), eins: st.eins, fpb: 48000 * 60 / st.f.basis_bpm, erster: st.erster });
  if (!n) return this.json(a, 409, { fehler: 'ausserhalb_bereich' });
  if (n.k === 0) return this.json(a, 200, { ok: true, k: 0, ...this.rasterWert(st.deck, st.f) });
  // Reihenfolge so, dass der Kopf dazwischen nach HINTEN wandert: nach vorn klemmt der Kern am Frame 0 (Instanz i,
  // Kopf auf dem ersten Schlag, k −2: 1,56 Beats daneben). k > 0: Raster (sofort) rückt den Ton später, dann Sprung −k.
  // k < 0: erst Sprung +|k| (später), abwarten, bis der Kern ihn meldet, dann Raster.
  const deck = st.deck, q0 = Number(st.z.quell_beat);
  const sprung = () => this.deckTeil('/k/deck/sprung', st, this.deckAb(st, 0), 0, { delta_beats: -n.k });
  const fertig = () => {
    this.opt.log?.({ typ: 'raster_set', deck, k: n.k, versatz_frames: n.v });
    this.json(a, 200, { ok: true, k: n.k, ...this.rasterWert(deck, st.f) });
  };
  if (n.k > 0) { this.rasterSenden(deck, st.f, n.v); sprung(); return fertig(); }
  sprung();
  const ziel = q0 - n.k, t0 = Date.now();
  const warte = () => {
    const q = Number((this.stand.decks[String(deck)] as Record<string, unknown> | undefined)?.quell_beat);
    if (Math.abs(q - ziel) < 1e-3) { this.rasterSenden(deck, st.f, n.v); return fertig(); }
    if (Date.now() - t0 > 1500) return this.json(a, 504, { fehler: 'sprung_ohne_meldung' });
    setTimeout(warte, 20);
  };
  warte();
}
// POST /deck/raster/fix {deck}: der Live-Versatz wird der gespeicherte (D3)
export function deckRasterFix(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  if (!istOffenesDeck(d.deck)) return this.json(a, 400, { fehler: 'unbekanntes_deck' });
  const st = this.deckStand(d.deck);
  if (!st) return this.json(a, 409, { fehler: 'kein_kernstand' });
  const v = this.rasterWert(st.deck, st.f).versatz_frames;
  // Review F1: ein nur geerbter Satz hängt an der Audio-Stelle (rechnet mit dem gespeicherten Raster), ein eigener an der
  // Raster-Position. Vor dem neuen Raster mit dem alten Versatz festschreiben, sonst hängt das Ergebnis von der Reihenfolge ab.
  const hd = hotcueDatei(this.hotcueOrdner(), st.f);
  if (!fs.existsSync(hd)) { const e = this.hotcuesErbeVon(st.f); if (e.von !== null) schreibeHotcues(hd, e.hotcues); }
  schreibeRaster(rasterDatei(this.rasterOrdner(), st.f), v);
  this.opt.log?.({ typ: 'raster_fix', deck: st.deck, versatz_frames: v });
  this.einsZurueck(st, v, 'FIX');
  this.json(a, 200, { ok: true, ...this.rasterWert(st.deck, st.f) });
}
// Nach /e/geladen und nach /e/neustart: gespeicherten (bzw. beim Neustart den live) Versatz an den Kern (D3, D7)
export function rasterWieder(this: Oberflaeche, deck: number, f: Fassung, nachNeustart: boolean): void {
  if (!f?.material_id) return;
  const erbe = this.rasterErbeVon(f);
  const v = nachNeustart ? this.rasterWert(deck, f).versatz_frames : erbe.v;
  this.rasterLive[String(deck)] = { schluessel: Oberflaeche.fassungSchluessel(f), v };
  if (v === 0) return;
  this.rasterSenden(deck, f, v);
  this.opt.log?.({ typ: 'raster_wieder', deck, versatz_frames: v, ...(erbe.von !== null && v === erbe.v ? { geerbt_von: erbe.von } : {}) });
}
