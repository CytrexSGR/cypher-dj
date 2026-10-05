// Studio S7: Spurbänder in der STUDIO-Ansicht zeichnen und bedienen. Rechnen: spurband.js. Senden: POST /spur, /spur/stopp
// (Seiten-Server, Studio S6). Entwurf je Band im localStorage (nur Bequemlichkeit: ohne Speicher gilt die Vorgabe-Linie).
import { baender, spurName, vorgabePunkte, setzePunkt, verschiebePunkt, loeschePunkt, kuerze, entwurfGueltig, griffBei, zugStart, zugBewegung, segmentFuerKlick, naechsteForm, setzeForm, pfad, punkteZuFahrten, fremdPfad, raster, LAENGEN } from './spurband.js';

const NS = 'http://www.w3.org/2000/svg';
// viewBox = echte Pixelgröße des SVG (ResizeObserver), nichts wird gestreckt; Maße in Pixeln (Slice-1-Review F2)
const RAND = 8, PUNKT_R = 5, TREFFER = 10;
const el = (tag, attr = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attr)) e.setAttribute(k, v); return e; };

function lies(schluessel, vorgabe, band) {
  try { const x = JSON.parse(localStorage.getItem(schluessel)); if (entwurfGueltig(x, LAENGEN, band)) return x; } catch { /* Vorgabe */ }
  return vorgabe;
}
function merke(schluessel, x) { try { localStorage.setItem(schluessel, JSON.stringify(x)); } catch { /* ohne Speicher */ } }

function neuesBand(wurzel, strom, band, post, geaendert = () => {}) {
  const name = spurName(strom, band.schluessel), speicher = `djk-${name}`;
  const z = lies(speicher, { laenge: 8, punkte: vorgabePunkte(band, 8) }, band);
  const b = document.createElement('div');
  b.className = 'spurband';
  b.innerHTML = `<div class="spurband-kopf">
      <select aria-label="Length in bars">${LAENGEN.map((l) => `<option value="${l}"${l === z.laenge ? ' selected' : ''}>${l} bars</option>`).join('')}</select>
      <button class="spielen" title="Play this lane from the next bar">PLAY</button>
      <button class="halten" title="Stop this lane; values stay where they are">STOP</button></div>
      <span class="meldung" role="status"></span>`;
  const svg = el('svg', { role: 'group', 'aria-label': `${band.name} automation lane (mouse only)` });
  b.append(svg);
  wurzel.append(b);
  const meldung = (t, art = '') => { const m = b.querySelector('.meldung'); m.textContent = t; m.title = t; m.className = `meldung ${art}`.trim(); };
  let B = 0, H = 0;   // Pixelmaße des SVG (0, solange die Ansicht nicht sichtbar ist)
  const r = () => raster(band, z.laenge, B, H, RAND);
  let zug = null;     // zugStart(...) während ein Punkt gezogen wird
  const titel = el('title');   // Hinweis beim Überfahren eines Segments (Tooltip des SVG), wird bei jedem Zeichnen wieder angehängt
  let kopf = null;    // Abspielkopf (Slice 4); VOR dem ersten zeichne() deklariert (TDZ, Review S7 #4)
  let fremd = null;   // gestrichelte Linie einer fremden Spur auf diesem Ziel (ebenfalls vor dem ersten zeichne())
  let eigenAnker = null, kopfTakt = null, fremdFahrten = [];   // Stand der laufenden Spuren (GET /spur), überlebt jedes Neuzeichnen

  const zeichne = () => {
    svg.replaceChildren();
    kopf = null;
    if (B < 2 * RAND + 2 || H < 2 * RAND + 2) return;   // unsichtbar (DJ-Ansicht): nichts zeichnen, beim Einblenden meldet der Beobachter
    svg.setAttribute('viewBox', `0 0 ${B} ${H}`);
    const q = r();
    for (let t = 1; t <= z.laenge + 1; t++) svg.append(el('line', { class: 'taktlinie', x1: q.x(t), x2: q.x(t), y1: 0, y2: H }));
    const p = z.punkte;
    svg.append(titel);
    svg.append(el('path', { class: 'linie', d: pfad(p, q, B - RAND) }));   // Auslauf bis zur rechten Kante der Innenfläche
    p.forEach((x) => svg.append(el('circle', { class: 'spurpunkt', cx: q.x(x.takt), cy: q.y(x.wert), r: PUNKT_R })));
    fremd = el('path', { class: 'fremd', d: '' });
    svg.append(fremd);
    kopf = el('line', { class: 'kopf', x1: -10, x2: -10, y1: 0, y2: H });
    svg.append(kopf);
    stelleLaufEin();
  };
  // Kopf und fremde Linie aus dem gemerkten Laufstand setzen (nach jedem Zeichnen und bei jedem neuen Beat)
  const stelleLaufEin = () => {
    if (kopf) { const x = kopfTakt == null ? -10 : r().x(kopfTakt); kopf.setAttribute('x1', x); kopf.setAttribute('x2', x); }
    if (fremd) fremd.setAttribute('d', fremdFahrten.length ? fremdPfad(band, fremdFahrten, B, H, RAND) : '');   // im Raster IHRER Länge (Final-Review F2)
  };
  // Abspielkopf aus dem Kern-Beat: nur die eigene Spur hat einen Kopf; vor dem Anker und hinter dem Ende steht er bei −10
  const kopfNachBeat = (beat) => {
    const takt = eigenAnker != null && beat != null ? (beat - eigenAnker) / 4 + 1 : null;
    const neu = takt != null && takt >= 1 && takt <= z.laenge + 1 ? takt : null;
    if (neu !== kopfTakt) { kopfTakt = neu; stelleLaufEin(); } else if (neu != null) stelleLaufEin();
  };
  // liste = GET /spur; beat = Kern-Beat (oder null). Antwort: läuft auf diesem Ziel eine Spur (eigene oder fremde)?
  const zeigeLauf = (liste, beat) => {
    const eigen = liste.find((x) => x.name === name);
    const andere = liste.filter((x) => x.name !== name && (x.fahrten ?? []).some((f) => f.ziel === band.ziel));
    eigenAnker = eigen ? eigen.anker_beat : null;
    fremdFahrten = andere.length ? andere[0].fahrten : [];
    spielen.classList.toggle('an', !!eigen);
    b.title = andere.length ? `${andere[0].name} (${andere[0].quelle}) is moving this lane` : '';
    kopfNachBeat(beat);
    stelleLaufEin();
    return !!eigen || andere.length > 0;
  };
  // speichern = false während des Ziehens: localStorage erst beim Ende der Änderung (Review F4)
  const aendere = (punkte, speichern = true) => { z.punkte = punkte; if (speichern) merke(speicher, z); zeichne(); };
  const lokal = (ev) => {   // Mauskoordinaten → Pixel im SVG (viewBox = Pixel)
    const k = svg.getBoundingClientRect();
    return { x: ev.clientX - k.left - svg.clientLeft, y: ev.clientY - k.top - svg.clientTop };
  };

  // Hinweis und Rechtsklick fragen dieselbe Funktion (Slice-2-Review B2)
  const segmentUnter = (ev) => { const { x, y } = lokal(ev); return segmentFuerKlick(z.punkte, r(), x, y, TREFFER); };
  // Greifen (griffBei): Radius, dann Spalte; freie Spalte setzt UND zieht sofort. Nie ev.target (Pointer-Capture, Review S7 #1).
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !ev.isPrimary || !B) return;
    const { x, y } = lokal(ev), q = r(), g = griffBei(z.punkte, q, x, y, TREFFER);
    if (g.neu) aendere(setzePunkt(z.punkte, g.takt, q.wert(y)), false);
    zug = zugStart(z.punkte, q, x, y, g);   // gegriffen wird relativ, erst ab 3 px Bewegung; ein neuer Punkt folgt dem Zeiger
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!zug) {   // kein Zug: über einem Segment den Formhinweis zeigen (nur schreiben, wenn sich der Text ändert)
      const t = B && segmentUnter(ev) !== null ? 'right-click: shape (straight → round → step)' : '';
      if (titel.textContent !== t) titel.textContent = t;
      return;
    }
    if (!ev.isPrimary) return;
    const { x, y } = lokal(ev), e = zugBewegung(zug, z.punkte, r(), x, y, z.laenge + 1);
    zug = e.zug;
    if (e.punkte !== z.punkte) aendere(e.punkte, false);
  });
  const loslassen = (ev) => {   // pointerup, pointercancel und lostpointercapture (Rereview R4)
    if (!zug || (ev.isPrimary === false)) return;
    if (zug.aktiv) merke(speicher, z);
    zug = null;
  };
  svg.addEventListener('pointerup', loslassen);
  svg.addEventListener('pointercancel', loslassen);
  svg.addEventListener('lostpointercapture', loslassen);
  svg.addEventListener('dblclick', (ev) => {
    const { x, y } = lokal(ev), g = griffBei(z.punkte, r(), x, y, TREFFER);
    // gelöscht wird nur, was wirklich unter dem Zeiger liegt (Radius), nie eine Spalte daneben
    const q = r(), p = z.punkte[g.i];
    if (!g.neu && (q.x(p.takt) - x) ** 2 + (q.y(p.wert) - y) ** 2 <= TREFFER * TREFFER) aendere(loeschePunkt(z.punkte, g.i));
  });
  // Rechtsklick: Form des Segments weiterschalten (gerade → rund → Sprung). Das Browser-Menü öffnet nie.
  svg.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (zug || !B) return;   // während eines Zugs ändert der Rechtsklick nichts (Slice-2-Review B3)
    const i = segmentUnter(ev);
    if (i !== null) aendere(setzeForm(z.punkte, i, naechsteForm(z.punkte[i].form)));
  });
  b.querySelector('select').addEventListener('change', (ev) => {
    z.laenge = Number(ev.target.value);
    aendere(kuerze(z.punkte, z.laenge));   // speichert
  });

  // PLAY/STOP (Review F5): Stopp und Start getrennt behandelt, Antwort-JSON im eigenen try, PLAY gesperrt, solange es wartet
  const spielen = b.querySelector('.spielen'), halten = b.querySelector('.halten');
  const sperre = (an) => { spielen.disabled = an; };   // STOP bleibt bedienbar, auch während PLAY auf die Antwort wartet (Rereview R5)
  const FEHLER = { keine_uhr: 'no kernel clock yet', ki_gestoppt: 'AI stopped', laeuft: 'lane is running, stop it first', ab: 'bad start mode', spur: 'kernel refused the lane' };
  const fehlerText = (j, status) => j?.text ?? FEHLER[j?.fehler] ?? (j?.fehler ? `error: ${j.fehler}` : `error ${status}`);
  // Zug-Zähler (Rereview2 Q2): STOP erhöht ihn; ein PLAY, dessen Antwort erst nach einem STOP kommt, schreibt nichts mehr und
  // bricht die eben gestartete Spur wieder ab, sonst überschriebe „from bar N“ das „stopped“ und die Spur liefe trotzdem.
  let zaehler = 0;
  spielen.addEventListener('click', async () => {
    if (spielen.disabled) return;
    const mein = zaehler, gilt = () => zaehler === mein;
    const melde = (t, art) => { if (gilt()) meldung(t, art); };
    sperre(true); meldung('');
    geaendert();   // Antworten von GET /spur, die vor diesem PLAY gestartet wurden, sind veraltet (Final-Review F1)
    try {
      let s;
      try { s = await post('/spur/stopp', { name }); } catch { return melde('page server unreachable, nothing sent', 'fehler'); }
      if (!s.ok && s.status !== 404) return melde(`could not stop the running lane (${s.status}), nothing sent`, 'fehler');   // 404: lief nicht, in Ordnung
      if (!gilt()) return;   // STOP kam schon, bevor der Start gesendet war: nicht mehr starten
      let r2;
      const vor = s.ok ? 'stopped, ' : '';   // die alte Spur ist dann wirklich weg (Rereview R3)
      try { r2 = await post('/spur', { spur: { name, fahrten: punkteZuFahrten(band, z.punkte) }, ab: 'takt' }); } catch { return melde(`${vor}new lane not started (page server unreachable)`, 'fehler'); }
      let j = null;
      try { j = await r2.json(); } catch { /* keine JSON-Antwort */ }
      if (!gilt()) {   // STOP kam, während der Start unterwegs war: die eben gestartete Spur wieder stoppen, Meldung gehört dem STOP
        if (r2.ok) { try { await post('/spur/stopp', { name }); } catch { /* der Seiten-Server ist weg, nichts zu tun */ } }
        return;
      }
      if (!r2.ok) return meldung(`${vor}new lane not started (${fehlerText(j, r2.status)})`, 'fehler');
      if (j?.abgelehnt?.length) return meldung(`${vor}kernel rejected ${j.abgelehnt.length} part(s)`, 'fehler');
      const takt = j?.anker_takt ?? (Number.isFinite(j?.anker_beat) ? Math.floor(j.anker_beat / 4) + 1 : null);
      meldung(takt === null ? 'started' : `from bar ${takt}`, 'ok');
    } finally { sperre(false); geaendert(); }
  });
  halten.addEventListener('click', async () => {
    zaehler++;   // gilt für ein gerade wartendes PLAY
    geaendert();
    try {
      const r2 = await post('/spur/stopp', { name });
      if (r2.ok) meldung('stopped', 'ok'); else if (r2.status === 404) meldung('was not running', 'ok'); else meldung(`stop failed (${r2.status})`, 'fehler');
    } catch { meldung('page server unreachable, not stopped', 'fehler'); } finally { geaendert(); }
  });

  // Größe: viewBox = Pixel. Auch beim Einblenden (STUDIO), da meldet der Beobachter erstmals eine Größe.
  const messe = () => { const bb = svg.clientWidth, hh = svg.clientHeight; if (bb !== B || hh !== H) { B = bb; H = hh; zeichne(); } };
  if (typeof ResizeObserver === 'function') new ResizeObserver(messe).observe(svg);
  messe();
  return { name, band, z, b, zeigeLauf, kopfNachBeat };
}

// Reiter je Instanz (Bandhöhe: immer nur EIN Band sichtbar, Scheibe-3-Entscheidung): die Reiterzeile steht in jedem Bandkopf,
// die Wahl liegt im localStorage (djk-band-reiter-<strom>, Vorgabe FADER); ein Punkt am Reiter zeigt eine laufende Spur.
function reiterLesen(strom, schluessel) {
  try { const x = localStorage.getItem(`djk-band-reiter-${strom}`); if (schluessel.includes(x)) return x; } catch { /* Vorgabe */ }
  return 'fader';
}
function reiterMerken(strom, k) { try { localStorage.setItem(`djk-band-reiter-${strom}`, k); } catch { /* ohne Speicher */ } }

// Einstieg aus app.js: je Instanz (.instanz[data-strom]) die Bänder mit Reitern. `beatVon` liefert den letzten Kern-Beat.
// GET /spur alle 250 ms, aber nur solange STUDIO sichtbar ist; der Abspielkopf folgt dem Beat je Bildschirmbild.
export function bindeSpurbaender(post, beatVon = () => null) {
  const alle = [], instanzen = [];
  // Poll-Sperre (Final-Review F1): höchstens eine Anfrage offen (Timeout 2 s); jede Anfrage hat eine Laufnummer, und eine Antwort, die vor dem letzten
  // eigenen PLAY/STOP gestartet wurde (Nummer < gueltigAb), wird verworfen: sie zeigt einen Stand von vor der Änderung.
  let offen = false, nummer = 0, gueltigAb = 0;
  for (const w of document.querySelectorAll('#deck-c .instanz')) {
    const strom = Number(w.dataset.strom), wurzel = w.querySelector('.spurbaender');
    if (!wurzel) continue;
    const def = baender(strom), laeuft = new Set();
    const bs = def.map((band) => neuesBand(wurzel, strom, band, post, () => { gueltigAb = nummer + 1; }));
    const zeilen = bs.map((x) => {   // eine Reiterzeile je Bandkopf, alle gleich und gemeinsam nachgeführt
      const z = document.createElement('div');
      z.className = 'spurreiter'; z.setAttribute('role', 'tablist'); z.setAttribute('aria-label', 'Lane');
      for (const band of def) {
        const k = document.createElement('button');
        k.type = 'button'; k.dataset.schluessel = band.schluessel; k.textContent = band.name; k.setAttribute('role', 'tab');
        k.addEventListener('click', () => { reiterMerken(strom, band.schluessel); zeige(); });
        z.append(k);
      }
      x.b.querySelector('.spurband-kopf').prepend(z);
      return z;
    });
    const zeige = () => {
      const gewaehlt = reiterLesen(strom, def.map((d) => d.schluessel));
      bs.forEach((x, i) => { x.b.hidden = def[i].schluessel !== gewaehlt; });
      for (const z of zeilen) for (const k of z.children) {
        k.setAttribute('aria-selected', String(k.dataset.schluessel === gewaehlt));
        k.classList.toggle('gewaehlt', k.dataset.schluessel === gewaehlt);
        k.classList.toggle('laeuft', laeuft.has(k.dataset.schluessel));   // Punkt: eigene oder fremde Spur auf diesem Ziel (GET /spur)
      }
    };
    zeige();
    instanzen.push({ bs, def, laeuft, zeige });
    alle.push(...bs);
  }
  const studio = () => document.body.classList.contains('studio');
  const hole = async () => {
    if (!studio() || document.hidden || offen) return;   // DJ-Ansicht und verdeckter Tab: nicht pollen; keine zweite Anfrage, solange eine offen ist
    offen = true;
    const meine = ++nummer, ac = new AbortController(), zeit = setTimeout(() => ac.abort(), 2000);
    let liste;
    try { const r = await fetch('/spur', { signal: ac.signal }); if (!r.ok) return; liste = await r.json(); } catch { return; } finally { clearTimeout(zeit); offen = false; }
    if (!Array.isArray(liste) || meine < gueltigAb) return;
    const beat = beatVon();
    for (const i of instanzen) {
      i.laeuft.clear();
      i.bs.forEach((x, k) => { if (x.zeigeLauf(liste, beat)) i.laeuft.add(i.def[k].schluessel); });
      i.zeige();
    }
  };
  const bild = () => { if (studio()) { const beat = beatVon(); for (const x of alle) x.kopfNachBeat(beat); } requestAnimationFrame(bild); };
  setInterval(hole, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) hole(); });   // Final-Review F4: beim Zeigen sofort wieder aufnehmen
  hole();
  requestAnimationFrame(bild);
  return alle;
}
