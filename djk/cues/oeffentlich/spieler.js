// Schmale Abspiel-Schnittstelle (Andreas, 2026-09-26: „wir sollten uns langsam davon lösen, dass der browser die
// audioausgabe macht … das muss separat wegen echtzeit erfolgen. browser dann nur anzeige“). app.js kennt nur
// laden/play/pause/springe/setzeLoop/position/on/paused/weg.
//
// Zwei Wege, gleiche API:
// - SpielerVorhoerer: sendet über den Cue-Server (server.ts, /api/vorhoerer/*) an den nativen Vorhörer (djk/vorhoerer,
//   OSC/UDP), Positionen kommen per Server-Sent-Events zurück. Aktiv, wenn der Server mit --ausgang gestartet wurde.
// - SpielerAudio: das bisherige <audio>-Element, Loop-Rücksprung per requestAnimationFrame. Fallback ohne
//   --ausgang oder wenn der Vorhörer-Start scheitert (server.ts meldet das über /api/vorhoerer/status).
//
// erzeugeSpieler() fragt einmal /api/vorhoerer/status und liefert den passenden Weg; app.js zeigt `spieler.weg`
// im Kopf an ("vorhoerer" oder "browser audio (fallback)").
export async function erzeugeSpieler() {
  let status;
  try { status = await fetch('/api/vorhoerer/status').then((r) => r.json()); } catch { status = { aktiv: false }; }
  return status.aktiv ? new SpielerVorhoerer() : new SpielerAudio();
}

// Gemessener Rücksprung-Fehler (rAF-getaktet, keine Sample-Genauigkeit): siehe pruef/bild.mjs, Feld
// `loop.ruecksprung_fehler_ms` — bis zu einer Bildwiederholung (~16 ms bei 60 Hz) plus Event-Loop-Jitter. Das ist
// die Grenze dieses Übergangs, nicht des Loop-Datenmodells (das bleibt exakt: `laenge_takte`, `ende_s`).
export class SpielerAudio {
  constructor() {
    this.weg = 'browser';
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this._schleife = null; // { a, b } in Sekunden, oder null
    this._hoerer = { position: new Set(), pause: new Set(), ended: new Set() };
    this.ruecksprünge = []; // { ende_soll, ende_ist, fehler_ms } je Loop-Rücksprung, für die Prüfung
    this.audio.addEventListener('pause', () => this._sende('pause', this.audio.currentTime));
    this.audio.addEventListener('ended', () => this._sende('ended', this.audio.currentTime));
    const takt = () => {
      if (!this.audio.paused) {
        if (this._schleife && this.audio.currentTime >= this._schleife.b) {
          const ende_ist = this.audio.currentTime;
          const rest = Math.max(0, ende_ist - this._schleife.b);
          this.audio.currentTime = this._schleife.a + rest;
          this.ruecksprünge.push({ ende_soll: this._schleife.b, ende_ist, fehler_ms: (ende_ist - this._schleife.b) * 1000 });
        }
        this._sende('position', this.audio.currentTime);
      }
      this._raf = requestAnimationFrame(takt);
    };
    this._raf = requestAnimationFrame(takt);
  }

  laden(rel) {
    this.audio.pause();
    this._schleife = null;
    this.audio.src = `/api/audio?rel=${encodeURIComponent(rel)}`;
  }
  play() { return this.audio.play(); }
  pause() { this.audio.pause(); }
  springe(s) { try { this.audio.currentTime = s; } catch { /* noch nicht geladen */ } }
  // (a, b) aktiviert den Rücksprung b -> a, (null, null) oder kein Argument schaltet ihn aus
  setzeLoop(a, b) { this._schleife = a != null && b != null ? { a, b } : null; }
  position() { return this.audio.currentTime; }
  get paused() { return this.audio.paused; }

  on(ev, cb) { (this._hoerer[ev] ??= new Set()).add(cb); }
  _sende(ev, wert) { for (const cb of this._hoerer[ev] ?? []) cb(wert); }
}

// Nativer Vorhörer über den Cue-Server. Der Server hält die UDP-Verbindung und den Rand-Fall „Loop hinter der
// Position“ (erst springen, dann Loop setzen, siehe vorhoerer-klient.ts); diese Klasse reicht nur weiter und
// schätzt die Position zwischen zwei /v/position-Meldungen (30 Hz) über die verstrichene Wanduhrzeit fort.
export class SpielerVorhoerer {
  constructor() {
    this.weg = 'vorhoerer';
    this._paused = true;
    this._pos = 0;
    this._empfangen_ms = performance.now();
    this._dauer = 0;
    this._schleife = null;
    this._hoerer = { position: new Set(), pause: new Set(), ended: new Set() };
    this._es = new EventSource('/api/vorhoerer/stream');
    this._es.addEventListener('position', (e) => {
      const d = JSON.parse(e.data);
      this._pos = d.s; this._empfangen_ms = performance.now(); this._paused = !d.spielt;
      this._sende('position', this.position());
    });
    this._es.addEventListener('geladen', (e) => { this._dauer = JSON.parse(e.data).dauer_s; });
    this._es.addEventListener('ended', () => { this._paused = true; this._sende('ended', this._dauer); });
  }

  laden(rel) {
    this._schleife = null; this._paused = true;
    return fetch(`/api/vorhoerer/laden?rel=${encodeURIComponent(rel)}`, { method: 'POST' });
  }
  play() { this._paused = false; return fetch('/api/vorhoerer/play', { method: 'POST' }); }
  pause() {
    this._paused = true; this._pos = this.position();
    const p = fetch('/api/vorhoerer/pause', { method: 'POST' });
    this._sende('pause', this._pos);
    return p;
  }
  springe(s) { this._pos = s; this._empfangen_ms = performance.now(); return fetch(`/api/vorhoerer/springe?s=${s}`, { method: 'POST' }); }
  setzeLoop(a, b) {
    this._schleife = a != null && b != null ? { a, b } : null;
    return this._schleife
      ? fetch(`/api/vorhoerer/loop?a=${a}&b=${b}`, { method: 'POST' })
      : fetch('/api/vorhoerer/loop_aus', { method: 'POST' });
  }
  // Zwischen zwei 30-Hz-Meldungen über die verstrichene Wanduhrzeit fortschätzen, wenn gespielt wird (sonst steht
  // die zuletzt gemeldete Sekunde). Der Graph-Versatz (1 Zyklus, ~5,33 ms bei 256/48000) ist in der Meldung selbst
  // schon Sekunden-genau enthalten (docs/architektur/stand/vorhoerer.md, B1) und wird hier nicht extra addiert.
  position() { return this._paused ? this._pos : this._pos + (performance.now() - this._empfangen_ms) / 1000; }
  get paused() { return this._paused; }

  on(ev, cb) { (this._hoerer[ev] ??= new Set()).add(cb); }
  _sende(ev, wert) { for (const cb of this._hoerer[ev] ?? []) cb(wert); }
}
