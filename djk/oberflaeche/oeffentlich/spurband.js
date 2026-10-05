// Studio S7: Spurbänder. Eine Linie aus Punkten ist eine andere Schreibweise der S6-Fahrten (djk/oberflaeche/spur.ts).
// Umwandlungsregeln: docs/superpowers/plans/2026-09-29-djk-studio-s7-spurbaender.md, Abschnitt „Umwandlungsregeln".
// Läuft im Browser und in node (Tests).

export const LAENGEN = [4, 8, 16, 32];   // Takte je Linie
const FORM_FAHRT = { rund: 's', gerade: 'linear' };

// Bänder je Strom (1 DRUMS, 2 BASS, 3 MELODY)
export function baender(strom) {
  const b = [
    { schluessel: 'fader', name: 'FADER', ziel: `erz/${strom}/fader`, min: -60, max: 0, aus: -200, wirt: false, vorgabe: 0, einheit: 'dB' },
    { schluessel: 'filter', name: 'FILTER', ziel: `erz/${strom}/filter`, min: -1, max: 1, wirt: false, vorgabe: 0, einheit: '' },
  ];
  const gruppe = { 2: 'bass', 3: 'melodie' }[strom];
  // Bereich −60..70 aus djk/wirte/carla/surge_bereiche.json (a_filter1_cutoff.punkte); Vorgabe = Mitte, bis die Seite den Ist-Wert kennt
  if (gruppe) b.push({ schluessel: 'cutoff', name: 'CUTOFF', ziel: `wirt:${gruppe}/a_filter1_cutoff`, min: -60, max: 70, wirt: true, vorgabe: 5, einheit: '' });
  return b;
}

export const spurName = (strom, schluessel) => `band-${strom}-${schluessel}`;

export const vorgabePunkte = (band, laenge) => [
  { takt: 1, wert: band.vorgabe, form: 'gerade' }, { takt: laenge + 1, wert: band.vorgabe, form: 'gerade' },
];

const sortiert = (p) => [...p].sort((a, b) => a.takt - b.takt);

// Neuer Punkt; auf einem schon belegten Takt ersetzt er dessen Wert (Form bleibt)
export function setzePunkt(punkte, takt, wert) {
  const da = punkte.find((x) => x.takt === takt);
  if (da) return punkte.map((x) => (x === da ? { ...x, wert } : x));
  return sortiert([...punkte, { takt, wert, form: 'gerade' }]);
}

// Punkt i ziehen: Takt bleibt echt zwischen den Nachbarn (Reihenfolge ändert sich nie), 1 ≤ Takt ≤ maxTakt (Länge + 1)
export function verschiebePunkt(punkte, i, takt, wert, maxTakt) {
  const lo = i > 0 ? punkte[i - 1].takt + 1 : 1;
  const hi = i < punkte.length - 1 ? punkte[i + 1].takt - 1 : maxTakt;
  const t = Math.min(Math.max(Math.round(takt), lo), hi);
  return punkte.map((x, k) => (k === i ? { ...x, takt: t, wert } : x));
}

export const loeschePunkt = (punkte, i) => (punkte.length <= 1 ? punkte : punkte.filter((_, k) => k !== i));

// Neue Länge: Punkte hinter Länge + 1 fallen; die Liste wird NIE leer (eine leere Liste bräche das Zeichnen, Review S7 #2)
export function kuerze(punkte, laenge) {
  const rest = punkte.filter((x) => x.takt <= laenge + 1);
  return rest.length ? rest : [{ ...punkte[0], takt: laenge + 1 }];
}

// Gespeicherter Entwurf gültig? (localStorage kann alles enthalten) — mindestens ein Punkt, Takte ganzzahlig, aufsteigend, in der Länge, Werte im Band
export function entwurfGueltig(x, laengen, band) {
  if (!x || !laengen.includes(x.laenge) || !Array.isArray(x.punkte) || x.punkte.length === 0) return false;
  return x.punkte.every((p, k) => Number.isInteger(p.takt) && p.takt >= 1 && p.takt <= x.laenge + 1 && Number.isFinite(p.wert) && p.wert >= band.min && p.wert <= band.max
    && ['gerade', 'rund', 'sprung'].includes(p.form) && (k === 0 || p.takt > x.punkte[k - 1].takt));
}

const unten = (band, w) => band.aus !== undefined && w <= band.min;
const istRampe = (p) => p && p.form !== 'sprung';

export function punkteZuFahrten(band, punkte) {
  const p = sortiert(punkte), f = [], z = band.ziel;
  const setzwert = (i) => (unten(band, p[i].wert) ? (istRampe(p[i + 1]) ? band.min : band.aus) : p[i].wert);
  const rampe = (i) => ({ ziel: z, ab_takt: p[i - 1].takt, takte: p[i].takt - p[i - 1].takt,
    nach: Math.max(p[i].wert, band.min), form: FORM_FAHRT[p[i].form] });
  if (!band.wirt) {
    f.push({ ziel: z, ab_takt: p[0].takt, nach: setzwert(0) });
    for (let i = 1; i < p.length; i++) {
      if (p[i].form === 'sprung') { f.push({ ziel: z, ab_takt: p[i].takt, nach: setzwert(i) }); continue; }
      f.push(rampe(i));
      if (unten(band, p[i].wert) && !istRampe(p[i + 1])) f.push({ ziel: z, ab_takt: p[i].takt, nach: band.aus });
    }
    return f;
  }
  if (!istRampe(p[1])) f.push({ ziel: z, ab_takt: p[0].takt, nach: p[0].wert });
  for (let i = 1; i < p.length; i++) {
    if (p[i].form === 'sprung') { if (!istRampe(p[i + 1])) f.push({ ziel: z, ab_takt: p[i].takt, nach: p[i].wert }); continue; }
    f.push({ ...rampe(i), von: p[i - 1].wert });
  }
  return f;
}

// Pixel ↔ (Takt, Wert) für eine Linie der Länge `laenge` Takte auf breite × hoehe px mit Innenrand `rand` px (Slice-1-Review F2:
// Punkte am Rand werden sonst vom SVG abgeschnitten). Takt 1 links, Länge+1 rechts, beides auf der Innenfläche.
export function raster(band, laenge, breite, hoehe, rand = 0) {
  const iw = breite - 2 * rand, ih = hoehe - 2 * rand, proTakt = iw / laenge, klemm = (v, a, b) => Math.min(Math.max(v, a), b);
  return {
    x: (takt) => rand + (takt - 1) * proTakt,
    takt: (x) => klemm(Math.round((x - rand) / proTakt) + 1, 1, laenge + 1),
    y: (wert) => rand + ((band.max - wert) / (band.max - band.min)) * ih,
    // Ränder rasten ein (je 5 % der Innenhöhe): sonst ist min (Fader: aus) mit einem Klick im Band nie genau erreichbar (Review S7 #5)
    wert: (y) => { const yi = y - rand;
      return yi >= 0.95 * ih ? band.min : yi <= 0.05 * ih ? band.max : klemm(band.max - (yi / ih) * (band.max - band.min), band.min, band.max); },
  };
}

// Index des Punkts im Radius r (viewBox-Einheiten) um (x, y), sonst null. Trefferprüfung über Koordinaten statt ev.target:
// mit Pointer-Capture kommen click/dblclick am SVG an, nicht am Kreis (Review S7 #1, im Browser gemessen).
export function punktBei(punkte, q, x, y, r) {
  let best = null, abstand = r * r;
  punkte.forEach((p, i) => { const d = (q.x(p.takt) - x) ** 2 + (q.y(p.wert) - y) ** 2; if (d <= abstand) { abstand = d; best = i; } });
  return best;
}

// Was greift ein Zeigerdruck bei (x, y)? Erst Radius (punktBei), dann die Spalte: ist der Takt unter dem Zeiger schon belegt,
// wird dieser Punkt gegriffen (ein Fehlgriff ändert nie still einen Wert, Review Slice 1 F1). Ist die Spalte frei, entsteht ein
// neuer Punkt: i ist sein Index in der sortierten Liste NACH dem Einfügen, takt sein Takt. Der Aufrufer setzt und zieht ihn sofort.
export function griffBei(punkte, q, x, y, r) {
  const i = punktBei(punkte, q, x, y, r);
  if (i !== null) return { i, neu: false };
  const takt = q.takt(x), j = punkte.findIndex((p) => p.takt === takt);
  if (j >= 0) return { i: j, neu: false };
  return { i: punkte.filter((p) => p.takt < takt).length, neu: true, takt };
}

// Ziehen (Rereview R2): ein gegriffener Punkt wird RELATIV bewegt (der Versatz zwischen Zeiger und Punkt bleibt) und erst ab
// `schwelle` px Bewegung überhaupt; ein Klick mit Zucken ändert nie einen Wert. Ein eben gesetzter Punkt (g.neu) folgt dem
// Zeiger direkt. `punkte` enthält den gegriffenen Punkt schon an Index g.i.
export function zugStart(punkte, q, x, y, g) {
  const p = punkte[g.i];
  return { i: g.i, x0: x, y0: y, px: q.x(p.takt), py: q.y(p.wert), direkt: !!g.neu, aktiv: !!g.neu };
}
export function zugBewegung(zug, punkte, q, x, y, maxTakt, schwelle = 3) {
  const aktiv = zug.aktiv || Math.hypot(x - zug.x0, y - zug.y0) >= schwelle;
  if (!aktiv) return { zug, punkte };
  const ax = zug.direkt ? x : zug.px + (x - zug.x0), ay = zug.direkt ? y : zug.py + (y - zug.y0);
  return { zug: { ...zug, aktiv: true }, punkte: verschiebePunkt(punkte, zug.i, q.takt(ax), q.wert(ay), maxTakt) };
}

const ZYKLUS = { gerade: 'rund', rund: 'sprung', sprung: 'gerade' };
export const naechsteForm = (form) => ZYKLUS[form] ?? 'gerade';

// Index des Punkts, in den das Segment unter x hineinführt (1..n−1), sonst null
export function segmentBei(punkte, q, x) {
  for (let i = 1; i < punkte.length; i++) if (x > q.x(punkte[i - 1].takt) && x < q.x(punkte[i].takt)) return i;
  return null;
}

export function setzeForm(punkte, i, form) { return punkte.map((x, k) => (k === i ? { ...x, form } : x)); }

// Rechtsklick bei (x, y), Hinweis und Klick über DIESELBE Funktion. Reihenfolge:
// 1. ein Punkt im Radius r: führt ein Segment in ihn (i ≥ 1), gilt dieses; der erste Punkt gehört zu Segment 1 (wenn es eins gibt),
//    links wie rechts von ihm;
// 2. die senkrechte Stufe eines Sprungs (Form am Punkt i): ±STUFE_PX um die Spalte des Punkts und y zwischen den beiden Werten
//    (mit STUFE_PX Toleranz) gehört zu Segment i, nicht zum Segment rechts davon (Slice-2-Review B1, B2: clientX kommt beim
//    contextmenu ganzzahlig, beim Überfahren gebrochen);
// 3. sonst das Segment unter x; hinter dem letzten Punkt (oder bei nur einem Punkt) null: die Form ändert sich nie still.
export const STUFE_PX = 4;
export function segmentFuerKlick(punkte, q, x, y, r) {
  const i = punktBei(punkte, q, x, y, r);
  if (i === 0) return punkte.length > 1 ? 1 : null;
  if (i !== null) return i;
  for (let k = 1; k < punkte.length; k++) {
    if (punkte[k].form !== 'sprung') continue;
    const yo = Math.min(q.y(punkte[k - 1].wert), q.y(punkte[k].wert)), yu = Math.max(q.y(punkte[k - 1].wert), q.y(punkte[k].wert));
    if (Math.abs(x - q.x(punkte[k].takt)) <= STUFE_PX && y >= yo - STUFE_PX && y <= yu + STUFE_PX) return k;
  }
  return segmentBei(punkte, q, x);
}

// SVG-Pfad: gerade = L, sprung = waagerecht bis zum Takt, dann senkrecht, rund = kubische Bezier mit waagerechten
// Tangenten (sieht aus wie 3u²−2u³; exakt ist es nicht, Anzeige genügt). Nach dem letzten Punkt waagerecht bis `breite`
// (die Ansicht übergibt die rechte Kante der Innenfläche, damit nichts über den Innenrand hinaus gezeichnet wird).
export function pfad(punkte, q, breite) {
  const r = (v) => Math.round(v * 100) / 100;
  let d = `M ${r(q.x(punkte[0].takt))} ${r(q.y(punkte[0].wert))}`;
  for (let i = 1; i < punkte.length; i++) {
    const x0 = q.x(punkte[i - 1].takt), y0 = q.y(punkte[i - 1].wert), x1 = q.x(punkte[i].takt), y1 = q.y(punkte[i].wert);
    if (punkte[i].form === 'sprung') d += ` L ${r(x1)} ${r(y0)} L ${r(x1)} ${r(y1)}`;
    else if (punkte[i].form === 'rund') { const m = (x0 + x1) / 2; d += ` C ${r(m)} ${r(y0)} ${r(m)} ${r(y1)} ${r(x1)} ${r(y1)}`; }
    else d += ` L ${r(x1)} ${r(y1)}`;
  }
  return d + ` L ${r(breite)} ${r(q.y(punkte.at(-1).wert))}`;
}

const FORM_PUNKT = { s: 'rund', linear: 'gerade' };

// Umkehrung von punkteZuFahrten für die Fahrten EINES Ziels (Anzeige laufender Spuren, auch aus djk-spur).
// Setzen = Punkt mit Form sprung (erstes Setzen: Startpunkt); Rampe = Punkt am Ende, Start aus von oder dem Vorgänger.
// Fader: Setzen −200 direkt am Ende einer Rampe bis −60 ist kein eigener Punkt (Regel „unten = aus").
export function fahrtenZuPunkte(band, fahrten) {
  const f = fahrten.filter((x) => x.ziel === band.ziel);
  const p = [];
  const setze = (takt, wert, form) => {
    const da = p.find((x) => x.takt === takt);
    if (da) { da.wert = wert; return; }
    p.push({ takt, wert, form });
  };
  for (const x of f) {
    const wert = x.nach === band.aus ? band.min : x.nach;
    if (!x.takte) { setze(x.ab_takt, wert, p.length ? 'sprung' : 'gerade'); continue; }
    // Rampe ohne vorheriges Setzen und ohne von (djk-spur, z. B. aus-bass-4): Startwert unbekannt (Ist-Wert im Kern);
    // angezeigt wird band.max beim Fader bzw. band.vorgabe, damit die Linie die Richtung zeigt (Review S7, Empfehlung).
    if (!p.length || p.at(-1).takt !== x.ab_takt) setze(x.ab_takt, x.von ?? p.at(-1)?.wert ?? (band.aus !== undefined ? band.max : band.vorgabe), p.length ? 'sprung' : 'gerade');
    else if (x.von !== undefined) p.at(-1).wert = x.von;
    // Vorgabe-Form ohne form-Feld: Kern s (spur.ts: form === 'linear' ? 0 : 1), Wirt linear (Task 9)
    setze(x.ab_takt + x.takte, wert, FORM_PUNKT[x.form ?? (band.wirt ? 'linear' : 's')]);
  }
  return p.sort((a, b) => a.takt - b.takt);
}

// Länge (in Takten) der Fahrten eines Ziels: höchster Endtakt (ab_takt + takte) − 1; 0, wenn das Ziel nicht vorkommt.
export function fremdeLaenge(fahrten, ziel) {
  const f = fahrten.filter((x) => x.ziel === ziel);
  return f.length ? Math.max(...f.map((x) => x.ab_takt + (x.takte ?? 0))) - 1 : 0;
}

// Pfad einer FREMDEN Spur (Final-Review F2): im Raster IHRER Länge über dasselbe x-Feld (Innenfläche) gezeichnet, nicht im Zeitmaßstab
// des eigenen Entwurfs; sonst endet bass-auf-8 im 4-Takt-Band bei halber Fahrt. Nichts liegt rechts der Innenfläche.
export function fremdPfad(band, fahrten, breite, hoehe, rand) {
  const punkte = fahrtenZuPunkte(band, fahrten), laenge = fremdeLaenge(fahrten, band.ziel);
  if (!punkte.length || laenge < 1) return '';
  return pfad(punkte, raster(band, laenge, breite, hoehe, rand), breite - rand);
}
