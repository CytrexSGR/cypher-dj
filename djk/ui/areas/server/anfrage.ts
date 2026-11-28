// Request entry of the page server: guards, id handling, the route table of the page itself and its small handlers (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import http from 'node:http';
import { postAbgewiesen, quelleAusKopf } from '../../http/transport.ts';
import { pruefeHand, type HandAnfrage } from '../../http/hand_schutz.ts';
import { kopfWert } from '../../http/hand_stufe.ts';
import { handLogKopf } from '../../http/hand_log.ts';
import { Router, type Route } from '../../http/router.ts';
import { HarmonieFehler } from '../live/harmonie.ts';
import { ZIELE, ZIEL_KURVE } from '../../public/curves.js';
import { HAND_PRUEFMODUS_TEXT } from '../../public/messages.js';
import { leseLoops } from '../../loops.ts';
import { type Hotcue, type Fassung } from '../../deck_operation.ts';
import { kanalOffen } from '../../hand_operation.ts';
import { Mediathek, bestandIds } from '../../media_library.ts';
import { leseAusgang } from '../../output.ts';
import { oszi } from '../../ear.ts';
import { leseMusterStand, setzeAutonom } from '../../../generator/src/pattern_state.mjs';
import { pultContainerPfad } from '../../../contract/pult.ts';
import { geraetePanel } from '../../devices_parameter.ts';
import { listeGraphen, findeGraph, ladePanel } from '../../graphs.ts';
import { leseBestand, istOffenesDeck } from '../../server_kopf.ts';
import { Oberflaeche } from '../../server.ts';

// Host guard (DNS rebinding), then the key: a valid bearer token makes the request an agent request whatever x-djk-quelle says.
export function anfrage(this: Oberflaeche, q: http.IncomingMessage, a: http.ServerResponse): Promise<void> {
  const host = String(q.headers.host ?? '');
  if (host !== `127.0.0.1:${this.opt.port}` && host !== `localhost:${this.opt.port}`) {
    this.json(a, 421, { fehler: 'falscher_host', text: 'open the page as http://127.0.0.1:<port>/' });
    return Promise.resolve();
  }
  const auth = q.headers.authorization;
  if (auth !== undefined) {
    const w = this.schluessel.pruefe(auth);
    if (w === null) {
      this.json(a, 401, { fehler: 'schluessel_ungueltig',
        text: 'the agent key is not valid (revoked or wrong); the hand re-reads ~/.config/cypherdj/hand.token' });
      return Promise.resolve();
    }
    return this.wer.run(w, () => this.qs.run('cypher', () => this.anfrageInnen(q, a)));
  }
  if (quelleAusKopf(q) === 'cypher') {
    if (this.streng()) {
      this.json(a, 401, { fehler: 'schluessel_fehlt',
        text: 'agents need the key from ~/.config/cypherdj/hand.token (djk-hand reads it by itself; restart the hand)' });
      return Promise.resolve();
    }
    const w = { id: 'ohne_schluessel', name: 'header only (test instance)', stufe: 'zerstoerend' as const };
    return this.wer.run(w, () => this.qs.run('cypher', () => this.anfrageInnen(q, a)));
  }
  return this.qs.run('andreas', () => this.anfrageInnen(q, a));
}
// true for the first request of one tool call (id + x-djk-aufruf); without an aufruf every non-GET counts as a call, GET polling does not
export function neuerAufruf(this: Oberflaeche, id: string, aufruf: string | null, methode: string): boolean {
  if (aufruf === null) return methode !== 'GET';
  const k = `${id}\u0000${aufruf}`;
  if (this.gesehenAufrufe.has(k)) return false;
  this.gesehenAufrufe.add(k);
  if (this.gesehenAufrufe.size > 2000) this.gesehenAufrufe.delete(this.gesehenAufrufe.values().next().value as string);
  return true;
}
export async function anfrageInnen(this: Oberflaeche, q: http.IncomingMessage, a: http.ServerResponse, herkunft?: string): Promise<void> {
  const url = new URL(q.url ?? '/', 'http://127.0.0.1');
  if (this.quelle() === 'cypher') {
    const anfrage: HandAnfrage = { methode: q.method ?? '', pfad: url.pathname, quelle: 'cypher', wer: this.wer.getStore() ?? null,
      werkzeug: kopfWert(q.headers['x-djk-werkzeug']), aktion: kopfWert(q.headers['x-djk-aktion']), aufruf: kopfWert(q.headers['x-djk-aufruf'], true) };
    const u = pruefeHand(this.handRegeln, anfrage);
    const w = anfrage.wer;
    if (w) {   // agent log: a refusal at once, an allowed call when its response is finished (first request of an aufruf only)
      const lk = handLogKopf(q, anfrage);
      const eintrag = { t: Date.now(), id: w.id, name: w.name, werkzeug: lk.werkzeug, aktion: lk.aktion, methode: anfrage.methode, pfad: anfrage.pfad };
      if (!u.ok) this.handLog.schreibe({ ...eintrag, code: u.code, ok: false, fehler: u.fehler });
      else if (this.neuerAufruf(w.id, lk.aufruf, anfrage.methode)) {
        a.once('finish', () => this.handLog.schreibe({ ...eintrag, code: a.statusCode, ok: a.statusCode < 400 }));
      }
    }
    if (!u.ok) {
      this.opt.log?.({ typ: 'hand_abgewiesen', methode: anfrage.methode, pfad: anfrage.pfad, fehler: u.fehler });
      return this.json(a, u.code, { fehler: u.fehler, text: u.text, ...u.mehr });
    }
  }
  const r = this.router.finde(q.method ?? '', url.pathname);
  if (r) {
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, this.opt.port, herkunft)) return;
    return await r.handler(q, a, url);
  }
  if (q.method === 'GET') return this.datei(url.pathname, a);
  this.json(a, 405, { fehler: 'methode' });
}
// Plan d1-s1 Task 9: die frühere if-Kette (bfdd3983 server.ts:1445-1648) als Routentabelle, Reihenfolge unverändert (erster Treffer
// gewinnt). schutz 'fremdePost' prüft der Router vor dem Handler, nur bei POST (415 vor 403, wie zuvor an jeder Stelle einzeln).
// Riegel (ki_gestoppt, nur_cypher, nur_andreas, AUTO) bleiben an ihrer Stelle im Handler: ihre Rangfolge hängt am Ort (Karte 01.10.).
export function routenOberflaeche(this: Oberflaeche): Route[] {
  const F = 'fremdePost' as const, O = 'offen' as const;
  return [
    ...this.seitenfehler.routen(),   // R7: POST /seite/fehler
    { methode: 'GET', pfad: '/strom', schutz: O, handler: (q, a) => this.strom(q, a) },
    { methode: 'GET', pfad: '/bestand', schutz: O, handler: (_q, a) => this.json(a, 200, leseBestand(this.opt.bestand)) },
    { methode: 'GET', pfad: '/mediathek/anschluss', schutz: O, handler: (_q, a, url) => this.anschlussAus(url, a) },
    { methode: 'GET', pfad: '/mediathek', schutz: O, handler: (_q, a, url) => this.mediathekSuche(url, a) },
    { methode: 'GET', pfad: '/mediathek/vorbereiten', schutz: O, handler: (_q, a, url) => this.vorbereitenStand(url, a) },
    { methode: 'POST', pfad: '/mediathek/vorbereiten', schutz: F, handler: async (q, a) => this.vorbereiten(await this.koerper(q), a) },
    { methode: 'GET', pfad: '/stoebern', schutz: O, handler: (_q, a, url) => (url.searchParams.get('typ') === 'strudel' ? this.stoebernMuster(url, a) : this.stoebern(url, a)) },
    { methode: 'GET', pfad: '/stoebern/quellen', schutz: O, handler: (_q, a, url) => this.stoebernQuellen(url, a) },
    { methode: 'GET', pfad: '/stoebern/detail', schutz: O, handler: (_q, a, url) => this.stoebernDetail(url, a) },
    { methode: 'GET', pfad: '/stoebern/baum', schutz: O, handler: (_q, a, url) => (url.searchParams.get('typ') === 'strudel' ? this.stoebernMusterBaum(a) : this.stoebernBaum(url, a)) },
    { methode: 'POST', pfad: '/muster', schutz: F, handler: (q, a) => this.musterSpeichern(q, a) },
    { methode: 'GET', pfad: '/vorhoeren', schutz: O, handler: async (_q, a) => this.json(a, 200, await this.vorhoeren.stand()) },
    { methode: 'POST', pfad: '/vorhoeren', schutz: F, handler: async (q, a) => this.vorhoerenAus(await this.koerper(q), a) },   // S7: Vorhören als Kern-Eingang
    { methode: 'GET', pfad: '/klaenge/karte', schutz: O, handler: (_q, a) => this.klaengeKarte(a) },
    { methode: 'GET', pfad: '/klaenge', schutz: O, handler: (_q, a, url) => this.klaengeSuche(url, a) },
    { methode: 'GET', pfad: '/mediathek/listen', schutz: O, handler: (_q, a) => { try { return this.json(a, 200, this.mediathek.listen()); } catch (e) { return this.mediathekFehler(e, a); } } },
    { methode: '*', pfad: (p) => p === '/sammlungen' || p.startsWith('/sammlungen/'), schutz: F, handler: (q, a, url) => this.sammlungRoute(q, url, a) },
    { methode: 'GET', pfad: '/konfig', schutz: O, handler: (_q, a) => this.json(a, 200, { leitstand_ws: `ws://127.0.0.1:${this.opt.leitstandWs}/`, ziel_kurve: this.opt.zielKurve ?? ZIEL_KURVE,
      kern_pruefmodus: this.pruefmodus }) },
    { methode: 'POST', pfad: '/griff', schutz: F, handler: async (q, a) => this.griff(await this.koerper(q), a) },   // Riegel 2026-09-30
    { methode: 'GET', pfad: '/lage', schutz: O, handler: (_q, a) => this.json(a, 200, this.lage()) },
    { methode: 'POST', pfad: '/plaetze', schutz: F, handler: async (q, a) => this.plaetzeSetzen(await this.koerper(q), a) },
    { methode: 'GET', pfad: '/spektrum', schutz: O, handler: (_q, a) => this.json(a, 200, this.spektrum()) },   // 1.15 A7b
    { methode: 'GET', pfad: '/ausgang', schutz: O, handler: (_q, a) => this.json(a, 200, leseAusgang(this.opt.digitalout)) },   // Glanz 2.1 (F22)
    { methode: 'POST', pfad: ['/deck/start', '/deck/stopp'], schutz: F, handler: async (q, a, url) => await this.deckStartStopp(url.pathname === '/deck/start', await this.koerper(q), a) },   // Plan Hand T5
    { methode: 'POST', pfad: '/abbruch', schutz: F, handler: async (_q, a) => {   // Plan Hand T8: Cypher bricht die eigenen Teile ab
      if (this.quelle() !== 'cypher') return this.json(a, 403, { fehler: 'nur_cypher', text: 'Andreas stops Cypher with Stop Cypher' });
      const felder = { id: Number(++this.id), quelle: 'cypher', plan: 'cypher', teile: '*' };
      this.kern.sende('/k/abbruch', felder);
      this.gesendet++;
      this.fahrtEnde.clear();
      await this.cypherSpurenAbbrechen();   // Studio S6: „alle meine Rampen“
      return this.json(a, 200, { ok: true, felder });
    } },
    { methode: 'GET', pfad: '/pegel', schutz: O, handler: (_q, a, url) => {   // Schnappschuss der letzten N Sekunden je Kanal
      const roh = url.searchParams.get('sek');
      const sek = roh === null ? 3 : Number(roh);
      if (roh !== null && !/^\d+$/.test(roh) || !Number.isInteger(sek) || sek < 1 || sek > 10) return this.json(a, 400, { fehler: 'sek', text: 'sek must be an integer 1..10' });
      return this.json(a, 200, { sek, kanaele: this.pegelPuffer.lies(sek) });
    } },
    { methode: 'GET', pfad: '/spur', schutz: O, handler: (_q, a) => this.json(a, 200, this.spurListe()) },
    { methode: 'POST', pfad: '/szene', schutz: F, handler: async (q, a) => { const d = await this.koerper(q); if (!this.aktionPasst(q, d, a)) return; await this.szene(d, a); } },   // strand 11 slice 5: live scenes
    { methode: 'POST', pfad: '/aufbau', schutz: F, handler: async (q, a) => { const d = await this.koerper(q); if (!this.aktionPasst(q, d, a)) return; await this.aufbau(d, a); } },   // strand 11 slice 7: session setups
    { methode: 'POST', pfad: ['/spur', '/spur/stopp'], schutz: F, handler: async (q, a, url) => {   // Studio S6
      const d = await this.koerper(q);
      return url.pathname === '/spur' ? await this.spurStart(d, a) : await this.spurStopp(d, a);
    } },
    { methode: 'POST', pfad: '/bogen', schutz: F, handler: async (q, a) => await this.bogenStart(await this.koerper(q), a) },   // strand 11 task 7.5
    { methode: 'POST', pfad: '/spur/aendern', schutz: F, handler: async (q, a) => await this.spurAendern(await this.koerper(q), a) },   // 1.12 S7
    { methode: 'POST', pfad: '/regler', schutz: F, handler: async (q, a) => await this.regler(await this.koerper(q), a) },   // Plan Hand
    { methode: 'POST', pfad: '/taste', schutz: F, handler: async (q, a) => this.taste(await this.koerper(q), a) },   // Riegel 2026-09-30
    { methode: 'POST', pfad: '/laden', schutz: F, handler: async (q, a) => await this.laden(await this.koerper(q), a) },   // Riegel 2026-09-30
    { methode: 'POST', pfad: '/tempo', schutz: F, handler: async (q, a) => await this.tempo(await this.koerper(q), a) },   // Plan Tempo-Folge: Master-Tempo, Andreas' Hand
    { methode: 'GET', pfad: '/loops', schutz: O, handler: (_q, a) => this.json(a, 200, leseLoops(this.loopOrdner())) },
    { methode: 'POST', pfad: '/loops/aus-katalog', schutz: F, handler: async (q, a) => this.loopAusKatalog(await this.koerper(q), a) },   // Browser S6
    { methode: 'POST', pfad: '/loop', schutz: F, handler: async (q, a) => this.loop(await this.koerper(q), a) },   // Riegel 2026-09-30
    { methode: 'GET', pfad: '/deck/hotcues', schutz: O, handler: (_q, a, url) => this.hotcuesAus(Number(url.searchParams.get('deck')), a) },
    { methode: 'GET', pfad: '/deck/loop', schutz: O, handler: (_q, a, url) => {   // aktiver Deck-Loop für die Anzeige, {} ohne
      const st = this.deckStand(Number(url.searchParams.get('deck')));
      const l = st ? this.loopVon(st) : null;
      return this.json(a, 200, l ? { start: Math.round(l.start * 1000) / 1000, laenge: l.laenge } : {});
    } },
    { methode: 'GET', pfad: '/deck/raster', schutz: O, handler: (_q, a, url) => {
      // D1 S3 Auftrag 15: nur an das gebunden, was rasterWert braucht (geladenes Deck mit Fassung), nicht an deckStand (Uhr, /zustand/deck)
      const deck = Number(url.searchParams.get('deck')), f = this.rasterFassung(deck);
      return f ? this.json(a, 200, this.rasterWert(deck, f)) : this.json(a, 409, { fehler: 'kein_kernstand' });   // Form wie bisher (Route-Golden)
    } },
    { methode: 'GET', pfad: '/hoeren', schutz: O, handler: (_q, a, url) => this.hoerenAus(url, a) },
    { methode: 'GET', pfad: '/analyse/live', schutz: O, handler: (_q, a) => this.analyseLiveAus(a) },
    { methode: 'GET', pfad: '/analyse/pegel', schutz: O, handler: (_q, a) => this.analysePegelAus(a) },
    { methode: 'POST', pfad: '/analyse/pegel/reset', schutz: F, handler: async (q, a) => { await this.koerper(q); this.analysePegelAus(a, true); } },
    { methode: 'GET', pfad: '/oszi', schutz: O, handler: (_q, a, url) => this.osziAus(url, a) },
    { methode: 'GET', pfad: '/fx', schutz: O, handler: (_q, a) => this.json(a, 200, this.stand.fx) },   // [FX1, FX2] oder null je Einheit
    { methode: 'GET', pfad: '/fx/zuweisung', schutz: O, handler: (_q, a) => this.json(a, 200, this.stand.fxZuweisung) },
    { methode: 'GET', pfad: '/graphen', schutz: O, handler: (_q, a) => this.json(a, 200, { ...listeGraphen(undefined, { ordner: this.opt.samplerOrdner }), geladen: this.stand.graphen_geladen, geladen_geprueft_vor_ms: this.graphenVomKernMs === null ? null : Date.now() - this.graphenVomKernMs }) },   // Baukasten S12/S16
    { methode: 'GET', pfad: '/graphen/panel', schutz: O, handler: (_q, a, url) => {   // front panel of one graph (sidecar panels/<name>.json) plus its knob ranges
      const r = ladePanel(url.searchParams.get('name') ?? '');
      if (!r) return this.json(a, 404, { fehler: 'unbekannt' });
      if (!r.panel) { const g = geraetePanel({ art: 'bk', graph: r.name }); if (g.panel) r.panel = g.panel; }   // no file or a refused one (fehler keeps its problems): the automatic panel
      return this.json(a, 200, r);
    } },
    { methode: 'GET', pfad: '/geraete/panel', schutz: O, handler: (_q, a, url) => {   // panel and parameter table of a device: ?art=bk&graph=<name> | ?art=rb338 | ?art=surge
      const art = url.searchParams.get('art') ?? '';
      if (art !== 'bk' && art !== 'rb338' && art !== 'surge') return this.json(a, 400, { fehler: 'art' });
      if (art !== 'bk') return this.json(a, 200, geraetePanel({ art }));
      const graph = url.searchParams.get('graph') ?? '';
      if (!findeGraph(graph)) return this.json(a, 404, { fehler: 'unbekannt' });
      return this.json(a, 200, geraetePanel({ art: 'bk', graph }));
    } },
    { methode: 'POST', pfad: '/graph', schutz: F, handler: async (q, a) => this.graphLaden(await this.koerper(q), a) },
    { methode: 'GET', pfad: '/fx/routing', schutz: O, handler: (_q, a) => this.json(a, 200, { routing: this.stand.fxRouting }) },
    { methode: 'POST', pfad: '/fx/routing', schutz: F, handler: async (q, a) => {   // Ohr T18: the Insert / Post Fader switch; strand 11: Cypher may switch it too (Stop Cypher still refuses)
      if (this.quelle() === 'cypher' && this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
      const d = await this.koerper(q);
      if (d.routing !== 'post_fader' && d.routing !== 'insert') return this.json(a, 400, { fehler: 'routing' });
      const felder = this.fxRoutingSenden(d.routing, this.quelle());
      this.fxRoutingWunsch = d.routing;
      return this.json(a, 200, { ok: true, felder, quittung: await this.warteQuittung(felder.id) });
    } },
    { methode: 'POST', pfad: ['/fx', '/fx/zuweisung'], schutz: F, handler: async (q, a, url) => {
      const d = await this.koerper(q);
      if (this.fxRiegel(a)) return;
      return url.pathname === '/fx' ? this.fx(d, a) : this.fxZuweisung(d, a);
    } },
    { methode: 'POST', pfad: ['/deck/sprung', '/deck/scrub', '/deck/hotcue', '/deck/loop', '/deck/loop/sichern', '/deck/raster', '/deck/raster/fix'], schutz: F, handler: async (q, a, url) => {   // Plan E9
      const d = await this.koerper(q);
      // Review Hand B1 / I3d: Sprung, Hotcue spielen auf einem OFFENEN Deck bringt ungehörten Inhalt; für cypher gesperrt,
      // bis das Ohr Hörscheine ausstellt. Loop ist frei (wiederholt Gehörtes). Andreas' Weg bleibt unberührt.
      if (this.quelle() === 'cypher' && istOffenesDeck(d.deck) && kanalOffen(this.stand.regler, pultContainerPfad[d.deck - 1])
        && (url.pathname === '/deck/sprung' || (url.pathname === '/deck/scrub' && d.phase !== 0) || (url.pathname === '/deck/hotcue' && d.aktion === 'spielen'))) {
        return this.json(a, 409, { fehler: 'ziel_ungehoert', text: 'deck is open; jumping there plays unheard material' });
      }
      if (url.pathname === '/deck/sprung') return this.deckSprung(d, a);
      if (url.pathname === '/deck/scrub') return this.deckScrub(d, a);
      if (url.pathname === '/deck/loop') return this.deckLoop(d, a);
      if (url.pathname === '/deck/loop/sichern') return this.deckLoopSichern(d, a);
      if ((url.pathname === '/deck/raster' || url.pathname === '/deck/raster/fix') && this.quelle() === 'cypher') {
        // strand 11: Cypher may move the grid; the old grid goes into the log line, so it is reversible
        if (this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
        const st = istOffenesDeck(d.deck) ? this.deckStand(d.deck) : null;
        this.opt.log?.({ typ: 'raster_cypher', deck: d.deck, vorher: st ? this.rasterWert(st.deck, st.f) : null });
      }
      if (url.pathname === '/deck/raster') return this.deckRaster(d, a);
      if (url.pathname === '/deck/raster/fix') return this.deckRasterFix(d, a);
      return this.deckHotcue(d, a);
    } },
    { methode: 'GET', pfad: '/harmonie', schutz: O, handler: (_q, a) => this.json(a, 200, this.harmonie.lesen(this.harmonieTakte()) ?? { tonart: null, folge: [], takte_je_akkord: null, ab_takt: null, jetzt: { takt: this.harmonieTakte().jetzt, akkord: null }, naechster_wechsel_takt: null }) },
    { methode: 'POST', pfad: '/harmonie', schutz: F, handler: async (q, a) => {
      const d = await this.koerper(q);
      if (this.quelle() === 'cypher' && this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
      try {
        const r = this.harmonie.setze(d, this.harmonieTakte());
        if (!r.probe) this.opt.log?.({ typ: 'harmonie', tonart: r.tonart, folge: r.folge, ab_takt: r.ab_takt });
        return this.json(a, 200, r);
      } catch (e) {
        if (e instanceof HarmonieFehler) return this.json(a, e.code, { fehler: e.fehler, text: e.message, ...e.extra });
        throw e;
      }
    } },
    { methode: 'GET', pfad: '/strudel', schutz: O, handler: (_q, a, url) => {
      const strom = Oberflaeche.strom(url.searchParams.get('strom'));
      if (strom === null) return this.json(a, 400, { fehler: 'strom' });
      return this.json(a, 200, leseMusterStand(this.musterOrdner(strom)));
    } },
    { methode: 'POST', pfad: ['/strudel', '/strudel/autonom'], schutz: F, handler: async (q, a, url) => {
      if (url.pathname === '/strudel/autonom') {
        if (this.quelle() === 'cypher') return this.json(a, 403, { fehler: 'nur_andreas' });   // sein AUTO-Schalter (Review M5)
        const d = await this.koerper(q);
        if (typeof d.an !== 'boolean') return this.json(a, 400, { fehler: 'an_muss_bool' });
        const strom = Oberflaeche.strom(d.strom);
        if (strom === null) return this.json(a, 400, { fehler: 'strom' });
        setzeAutonom(this.musterOrdner(strom), d.an);
        this.opt.log?.({ typ: 'autonom', an: d.an, strom });
        if (d.an === false && strom === 1) this.fxCypherAuslaufen();   // FX-Riegel hängt an Strom 1 (Plan: unverändert)
        return this.json(a, 200, { ok: true, autonom: d.an });
      }
      return await this.strudel(await this.koerper(q), a);
    } },
    // Demo overlay (2026-11-07): one line of text that the page shows over every view, "what Cypher is doing now". Both
    // sources may set it; an empty text clears it. GET answers the current line (null without one).
    { methode: 'GET', pfad: '/ansage', schutz: O, handler: (_q, a) => this.json(a, 200, { ansage: this.ansageZeile }) },
    { methode: 'POST', pfad: '/ansage', schutz: F, handler: async (q, a) => {
      const d = await this.koerper(q);
      if (typeof d.text !== 'string') return this.json(a, 400, { fehler: 'text_muss_text' });
      const text = d.text.replace(/\s+/g, ' ').trim();
      if (text.length > 300) return this.json(a, 400, { fehler: 'text_zu_lang', max: 300 });
      const art = d.quelle === 'stimme' ? 'stimme' : 'tat';
      this.ansageZeile = text ? { text, art, von: this.quelle(), zeit: Date.now() } : null;
      this.verteile({ a: 'ansage', f: this.ansageZeile });
      return this.json(a, 200, { ok: true, ansage: this.ansageZeile });
    } },
    { methode: 'GET', pfad: '/klang', schutz: O, handler: (_q, a) => this.json(a, 200, this.leseWirtMeldungen()) },   // Task 3: was die Wirte gerade melden (wirt-<gruppe>.json), null ohne Datei
    { methode: 'POST', pfad: '/klang', schutz: F, handler: async (q, a) => { const d = await this.koerper(q); if (!this.aktionPasst(q, d, a)) return; await this.klang(d, a); } },
    { methode: 'GET', pfad: '/welle', schutz: O, handler: async (_q, a, url) => await this.welleAus(url, a) },
    { methode: 'GET', pfad: '/fassung', schutz: O, handler: (_q, a, url) => this.fassungAus(url, a) },
  ];
}
// Ein Griff: pfad aus ZIELE, u = midi_roh 0..1. Riegel vor dem Senden: falsches Ziel → 400, nichts an den Kern.
export function griff(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): void {
  if (this.quelle() === 'cypher') return this.json(a, 403, { fehler: 'nur_hand' });   // Plan Hand D1: die Hand ist Andreas
  const pfad = d.pfad;
  const u = d.u;
  const riegel = !(this.opt.mutationen ?? []).includes('riegel_aus');
  if (typeof pfad !== 'string' || (riegel && !ZIELE.has(pfad))) {
    this.opt.log?.({ typ: 'abgelehnt', grund: 'unbekanntes_ziel', pfad });
    return this.json(a, 400, { fehler: 'unbekanntes_ziel', pfad });
  }
  if (typeof u !== 'number' || !(u >= 0 && u <= 1)) {
    this.opt.log?.({ typ: 'abgelehnt', grund: 'ausserhalb_bereich', pfad, u });
    return this.json(a, 400, { fehler: 'ausserhalb_bereich', pfad });
  }
  if (pfad.length > 47) return this.json(a, 400, { fehler: 'unbekanntes_ziel', pfad });
  // Kern ohne Prüfmodus: /test/hand käme nie an. Sichtbar ablehnen statt still 200 (bis 35 hand_osc bringt).
  if (this.pruefmodus === 'aus') {
    this.opt.log?.({ typ: 'abgelehnt', grund: 'pruefmodus_aus', pfad });
    return this.json(a, 409, { fehler: 'pruefmodus_aus', pfad, text: HAND_PRUEFMODUS_TEXT });
  }
  const felder = { pfad, midi_roh: u, sample: this.kern.uhr?.sample ?? 0 };
  this.kern.sende('/test/hand', felder);
  this.gesendet++;
  this.json(a, 200, { ok: true, gesendet: '/test/hand', felder });
}
// Mediathek T2 (Plan 2026-10-03): Suche über die ganze Mediathek (nur lesen) und Vorbereiten durch die Werkstatt.
// Kein Kern-Befehl in diesen Routen; ins Deck kommt ein vorbereiteter Track wie jeder andere über POST /laden.
// Anschluss-Vorauswahl (Plan 2026-10-10-anschluss-vorauswahl, T3/T4): material_id oder deck (1|2), energie halten|heben|senken,
// fenster in Prozent (Vorgabe 6, 1..16), limit (Vorgabe 10).
export function anschlussAus(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  try {
    const p = url.searchParams;
    let mid = p.get('material_id');
    const deck = p.get('deck');
    if (mid && deck) return this.json(a, 400, { fehler: 'material_id_oder_deck' });
    if (!mid && deck) {
      if (deck !== '1' && deck !== '2') return this.json(a, 400, { fehler: 'deck_ungueltig' });
      mid = (this.stand.geladen[deck]?.material_id as string | undefined) ?? null;
      if (!mid) return this.json(a, 409, { fehler: 'deck_leer' });
    }
    if (!mid) return this.json(a, 400, { fehler: 'material_id_oder_deck' });
    const energie = p.get('energie') ?? 'halten';
    if (energie !== 'halten' && energie !== 'heben' && energie !== 'senken') return this.json(a, 400, { fehler: 'energie_ungueltig' });
    const zahlOder = (s: string | null, vorgabe: number): number => { if (s === null || s === '') return vorgabe; const n = Number(s); return Number.isFinite(n) ? n : vorgabe; };
    const fenster = Math.min(16, Math.max(1, zahlOder(p.get('fenster'), 6)));
    const limit = Math.min(50, Math.max(1, Math.floor(zahlOder(p.get('limit'), 10))));
    this.json(a, 200, this.mediathek.anschluss(mid, { fenster, energie, limit }, bestandIds(this.opt.bestand), (m) => this.vorbereiter.anzeige(m)));
  } catch (e) { this.mediathekFehler(e, a); }
}
