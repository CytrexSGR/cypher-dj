// Workbench ANALYZE window: measures one strip (track, return or MASTER) and an optional second one offline (POST /proj/analyse renders the loop range
// like the loudness run) and shows the 1/12-octave spectrum with the column under the playhead, the time picture, stereo correlation and width, the
// loudness numbers, the masking between the two strips and the hints of the measurement. It appends one button to the top bar (before SHELF) and
// opens one floating window of kind `analyse` (window.js). Request rules: at most one request in flight; a trigger during a request marks it
// stale, the stale answer is dropped and one fresh request follows; a project change measures again 800 ms after the last change. The window
// draws and measures only while it is open. Canvas pattern as schnitt_streifen.js (size from getBoundingClientRect, redraw by key).
// The answer is the contract of project/klang_vertrag.ts. UI texts English.
import { beatsProTakt } from '../production/timeline.js';
import { ANALYSE_TEXT, HZ_LINIEN, hzZuX, xZuHz, dbZuY, linienText, notenName, bandBei, spalteBei, spalteDb, quellenListe, zahlText, taktLinien, breiteText, zeitbildBytes, zeitbildRgba, bildAnteil } from './analysis_zeichnen.js';

const ENTPRELL_MS = 800;
const PEGEL_MIN_DB = -60;   // a stereo band shows its correlation only above this level
const FENSTER_ID = 'analyse';
const ZAHLEN = [['lufs_i', 'LUFS-I', 'LUFS'], ['lufs_s_max', 'Short-term max', 'LUFS'], ['true_peak_dbtp', 'True peak', 'dBTP'], ['crest_db', 'Crest', 'dB'], ['lra', 'LRA', 'LU']];
const BAND_TEXT = ['< 120 Hz', '120 - 500 Hz', '500 Hz - 4 kHz', '> 4 kHz'];
const FARBE = { grund: '#0b0d11', gitter: 'rgba(255,255,255,.09)', text: 'rgba(255,255,255,.5)', quelle: '#5cd0ff', vergleich: '#e0a33e', kopf: '#ffffff', schwer: 'rgba(255,107,107,.18)', takt: 'rgba(255,255,255,.22)' };

const el = (tag, klasse, w, text) => {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (w) e.setAttribute('data-w', w);
  if (text !== undefined) e.textContent = text;
  return e;
};
const hzKurz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);
const gueltig = (j) => !!j && typeof j === 'object' && Array.isArray(j.quelle?.spektrum?.hz) && !!j.quelle.zeitbild && Number.isFinite(j.rev);

export function bindeAnalyse(ctx) {
  // built here, not at module level: analysis_zeichnen.js reaches this file through an import cycle (mix.js -> sound.js -> werkbank.js) when a test loads it first
  const TEXT = { ...ANALYSE_TEXT, quelle: 'SOURCE', stumm: 'silent in the mix', keineHinweise: 'Nothing to note.', keinSignal: 'no signal', spektrum: 'SPECTRUM', zeitbild: 'OVER TIME',
    stereo: 'STEREO', zahlen: 'LOUDNESS', hinweise: 'HINTS', korrelation: 'Correlation', breite: 'Width', hoverLeer: 'Move over the spectrum to read a band' };
  const { st, $ } = ctx;
  const knopf = el('button', 'w-export w-analyse-auf', 'analyse-auf', TEXT.knopf);
  knopf.type = 'button'; knopf.title = TEXT.knopfTitel; knopf.disabled = true;
  $('kopf').append(knopf);

  // state of the open window (all null/false while closed)
  let offen = false, gen = 0;
  let antwort = null, laeuft = false, veraltet = false, uhr = null, gesehenRev = null, listeSchluessel = '';
  let wahlQuelle = null, wahlVergleich = '';   // 'spur:s1' style values; '' = no comparison
  let ui = null, beobachter = null;   // the elements of the window
  const zeichnung = { spektrum: '', zeitbild: '', hover: null, basis: null };
  let antwortNr = 0, farben = { quelle: '', vergleich: '' };   // antwortNr counts the answers (redraw key); farben are those of the strips that were measured

  const liste = () => quellenListe(st.projekt);
  const standard = () => {
    const l = liste(), s = st.wahl ? `spur:${st.wahl}` : null;
    return s && l.some((x) => x.wert === s) ? s : 'master';
  };
  // a vanished choice goes back (source: the selected track, comparison: none); the selectors show it
  function pruefeWahl() {
    const l = liste();
    if (wahlQuelle === null || !l.some((x) => x.wert === wahlQuelle)) wahlQuelle = standard();
    if (wahlVergleich !== '' && (wahlVergleich === wahlQuelle || !l.some((x) => x.wert === wahlVergleich))) wahlVergleich = '';   // never the source itself
    baueOptionen(l);
    if (ui) { ui.quelle.value = wahlQuelle; ui.vergleich.value = wahlVergleich; }
  }
  function baueOptionen(l) {
    if (!ui) return;
    const schluessel = `${wahlQuelle}#${l.map((x) => `${x.wert}=${x.text}`).join('|')}`;
    if (schluessel === listeSchluessel) return;
    listeSchluessel = schluessel;
    const mach = (x) => { const o = el('option', undefined, undefined, x.text); o.value = x.wert; return o; };
    ui.quelle.replaceChildren(...l.map(mach));
    const keiner = el('option', undefined, undefined, TEXT.keiner); keiner.value = '';
    ui.vergleich.replaceChildren(keiner, ...l.filter((x) => x.wert !== wahlQuelle).map(mach));   // the source is not offered as its own comparison
  }

  // ---- the requests ------------------------------------------------------------------------------------------------------------------------------
  const setzeStand = (t) => { if (ui) ui.stand.textContent = t; };
  function messe() {
    if (!offen || !st.projekt) return;
    if (laeuft) { veraltet = true; return; }   // at most one in flight: the answer to the running one is dropped
    sende();
  }
  async function sende() {
    pruefeWahl();
    const l = liste(), q = l.find((x) => x.wert === wahlQuelle), v = wahlVergleich === '' ? null : l.find((x) => x.wert === wahlVergleich);
    if (!q) return;
    const koerper = { quelle: q.quelle, ...(v ? { vergleich: v.quelle } : {}), ohne_freeze: true };   // the window never freezes a track (the hand tool does)
    laeuft = true; veraltet = false;
    const meine = gen;
    setzeStand(TEXT.misst);
    let r;
    try { r = await ctx.holeJson('/proj/analyse', koerper); } catch (e) { r = { status: 0, j: { fehler: 'netz', text: String(e?.message ?? e) } }; }
    laeuft = false;
    if (!offen) return;
    if (veraltet || meine !== gen) { messe(); return; }   // stale: dropped, one fresh request
    if (r.status === 200 && gueltig(r.j)) {
      antwort = r.j; antwortNr += 1; zeichnung.basis = null;
      farben = { quelle: q.farbe, vergleich: v?.farbe ?? '' };
      zeichnung.spektrum = ''; zeichnung.zeitbild = '';
      setzeStand(`rev ${r.j.rev}`);
      zeigeAntwort();
    } else {
      setzeStand(r.status === 200 ? 'The answer is not a measurement' : ctx.antwortText(r));   // the last drawing stays
    }
  }
  function planeNeu() {
    clearTimeout(uhr);
    uhr = setTimeout(() => { uhr = null; messe(); }, ENTPRELL_MS);
  }

  // ---- what the window shows ---------------------------------------------------------------------------------------------------------------------
  function zeigeAntwort() {
    if (!ui || !antwort) return;
    const a = antwort, q = a.quelle, v = a.vergleich ?? null;
    // numbers
    const kopfZeile = el('tr', undefined, 'analyse-kopfzeile');
    kopfZeile.append(el('th', undefined, undefined, ''), el('th', undefined, undefined, `${q.name}${q.stumm ? ` (${TEXT.stumm})` : ''}`));
    if (v) kopfZeile.append(el('th', undefined, undefined, `${v.name}${v.stumm ? ` (${TEXT.stumm})` : ''}`));
    const zeilen = [kopfZeile];
    for (const [feld, name, einheit] of ZAHLEN) {
      const z = el('tr', undefined, 'analyse-zeile');
      z.append(el('th', undefined, undefined, `${name} (${einheit})`), el('td', 'w-analyse-zahl', 'analyse-zahl', zahlText(q.stumm ? null : q.lautheit?.[feld])));
      if (v) z.append(el('td', 'w-analyse-zahl', 'analyse-zahl', zahlText(v.stumm ? null : v.lautheit?.[feld])));
      zeilen.push(z);
    }
    ui.zahlen.replaceChildren(...zeilen);
    // stereo
    const s = q.stereo, ohne = q.stumm || !s;
    ui.korrelationText.textContent = ohne ? TEXT.leer : `${TEXT.korrelation} ${zahlText(s.korrelation, 2)} (min ${zahlText(s.korrelation_min, 2)})`;
    ui.korrelationWert.style.left = `${ohne ? 50 : ((s.korrelation + 1) / 2) * 100}%`;
    ui.korrelationMin.style.left = `${ohne ? 50 : ((s.korrelation_min + 1) / 2) * 100}%`;
    ui.breite.textContent = `${TEXT.breite} ${ohne ? TEXT.leer : breiteText(s.breite_db)}`;
    ui.baender.forEach((b, i) => {
      const x = ohne ? null : s.baender?.[i];
      b.textContent = !x ? `${BAND_TEXT[i]}: ${TEXT.leer}` : x.pegel_db > PEGEL_MIN_DB ? `${BAND_TEXT[i]}: ${zahlText(x.korrelation, 2)} · ${breiteText(x.breite_db)}` : `${BAND_TEXT[i]}: ${TEXT.keinSignal}`;
    });
    // hints
    ui.hinweise.replaceChildren(...(a.hinweise?.length ? a.hinweise.map((h) => el('li', 'w-analyse-hinweis', undefined, h.text)) : [el('li', 'w-analyse-leer', undefined, TEXT.keineHinweise)]));
    zeichne();
  }

  // ---- canvas -----------------------------------------------------------------------------------------------------------------------------------
  // The size of a canvas is remembered (reset by a ResizeObserver) and read once per drawing; without an observer it is read on every drawing.
  const groesse = { spektrum: null, zeitbild: null };
  function messeLeinwand(name) {
    const c = ui[name];
    if (!groesse[name]) {
      const r = c.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
      if (W === 0 || H === 0) return null;
      groesse[name] = { W, H };
    }
    const { W, H } = groesse[name];
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return { W, H, g: c.getContext('2d') };
  }
  const kurve = (g, hz, db, W, H) => hz.forEach((f, i) => { const x = hzZuX(f, W), y = dbZuY(db[i], H); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
  const grosse = (name) => { const g = groesse[name]; return g ? `${g.W}x${g.H}` : '-'; };
  function zeichneSpektrum(spalte) {
    const a = antwort;
    const m = messeLeinwand('spektrum');
    if (!m) return;
    const schluessel = `${antwortNr}|${grosse('spektrum')}|${spalte}|${zeichnung.hover}`;
    if (schluessel === zeichnung.spektrum) return;
    zeichnung.spektrum = schluessel;
    const { W, H, g } = m;
    g.fillStyle = FARBE.grund; g.fillRect(0, 0, W, H);
    g.lineWidth = 1; g.font = '10px sans-serif';
    for (let db = 0; db > -90; db -= 12) {
      const y = dbZuY(db, H);
      g.strokeStyle = FARBE.gitter; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      g.fillStyle = FARBE.text; g.fillText(String(db), 2, y + 10);
    }
    for (const hz of HZ_LINIEN) {
      const x = hzZuX(hz, W);
      g.strokeStyle = FARBE.gitter; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.fillStyle = FARBE.text; g.fillText(linienText(hz), Math.min(W - 18, x + 2), H - 3);
    }
    if (!a) return;
    for (const s of a.ueberdeckung?.schwerpunkte ?? []) {
      g.fillStyle = FARBE.schwer;
      g.fillRect(hzZuX(s.hz_von, W), 0, Math.max(1, hzZuX(s.hz_bis, W) - hzZuX(s.hz_von, W)), H);
    }
    const q = a.quelle, v = a.vergleich;
    const farbeQ = farben.quelle || FARBE.quelle, farbeV = farben.vergleich || FARBE.vergleich;   // the strips that were measured, not the current selection
    if (!q.stumm) {
      g.beginPath(); kurve(g, q.spektrum.hz, q.spektrum.mittel_db, W, H);
      g.lineTo(hzZuX(q.spektrum.hz.at(-1), W), H); g.lineTo(hzZuX(q.spektrum.hz[0], W), H); g.closePath();
      g.globalAlpha = 0.3; g.fillStyle = farbeQ; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = farbeQ; g.beginPath(); kurve(g, q.spektrum.hz, q.spektrum.max_db, W, H); g.stroke();   // the maximum as a thin line
    }
    if (v && !v.stumm) { g.strokeStyle = farbeV; g.lineWidth = 2; g.beginPath(); kurve(g, v.spektrum.hz, v.spektrum.mittel_db, W, H); g.stroke(); g.lineWidth = 1; }
    if (spalte !== null && !q.stumm) {   // the column under the playhead
      g.strokeStyle = FARBE.kopf; g.lineWidth = 1.5; g.beginPath(); kurve(g, q.spektrum.hz, spalteDb(a, q, spalte), W, H); g.stroke(); g.lineWidth = 1;
    }
    if (zeichnung.hover !== null) { g.strokeStyle = FARBE.text; g.beginPath(); g.moveTo(zeichnung.hover, 0); g.lineTo(zeichnung.hover, H); g.stroke(); }
  }
  // The spectrogram is written once per answer into an image of spalten x zeilen pixels on a canvas of its own and scaled onto the window canvas; the
  // playhead and the bar lines are drawn over it per frame. Picture, bar lines and playhead share one time axis: the range width is dauer_s.
  function bildLeinwand(z) {
    if (zeichnung.basis || typeof ImageData !== 'function') return zeichnung.basis;   // no ImageData (a test stand-in): no picture
    const b = document.createElement('canvas'); b.width = z.spalten; b.height = z.zeilen;
    b.getContext('2d').putImageData(new ImageData(zeitbildRgba(zeitbildBytes(z.daten), z.spalten, z.zeilen), z.spalten, z.zeilen), 0, 0);
    zeichnung.basis = b;
    return b;
  }
  function zeichneZeitbild(beat) {
    const a = antwort;
    const m = messeLeinwand('zeitbild');
    if (!m) return;
    const { W, H, g } = m;
    const px = a && beat !== null ? Math.round(((beat - a.von_beat) / (a.bis_beat - a.von_beat)) * W) : -1;
    const schluessel = `${antwortNr}|${grosse('zeitbild')}|${px}`;
    if (schluessel === zeichnung.zeitbild) return;
    zeichnung.zeitbild = schluessel;
    g.fillStyle = FARBE.grund; g.fillRect(0, 0, W, H);
    if (!a) return;
    if (!a.quelle.stumm) {
      const b = bildLeinwand(a.quelle.zeitbild);
      if (b) g.drawImage(b, 0, 0, b.width, b.height, 0, 0, Math.round(W * bildAnteil(a)), H);
    }
    const laenge = a.bis_beat - a.von_beat;
    g.strokeStyle = FARBE.takt; g.lineWidth = 1;
    for (const b of taktLinien(a.von_beat, a.bis_beat, beatsProTakt(st.projekt?.taktart))) {   // bar lines by the time signature
      const x = Math.round(((b - a.von_beat) / laenge) * W) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    if (px >= 0 && px <= W) { g.strokeStyle = FARBE.kopf; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); g.lineWidth = 1; }
  }
  function zeichne(beat = null) {
    if (!offen || !ui) return;
    const spalte = spalteBei(beat, antwort);
    if (String(spalte ?? '') !== (ui.spektrum.getAttribute('data-spalte') ?? '')) ui.spektrum.setAttribute('data-spalte', spalte === null ? '' : String(spalte));
    zeichneSpektrum(spalte);
    zeichneZeitbild(beat);
  }

  // one hook for the whole page life; idle while the window is closed (hooks cannot be removed)
  ctx.vorBild.push(() => { if (offen && ui) zeichne(ctx.kopfBeat()); });

  // ---- the window --------------------------------------------------------------------------------------------------------------------------------
  function bauen(koerper, leiste) {
    offen = true; gen += 1; antwort = null; zeichnung.spektrum = ''; zeichnung.zeitbild = ''; zeichnung.hover = null;
    listeSchluessel = ''; wahlQuelle = null; wahlVergleich = ''; gesehenRev = st.projekt?.rev ?? null;
    const neu = el('button', 'w-effekt-knopf', 'analyse-neu', TEXT.neu); neu.type = 'button'; neu.title = 'Measure again';
    neu.addEventListener('click', () => messe());
    leiste.append(neu);
    const kopf = el('div', 'w-analyse-kopf');
    const quelle = el('select', 'w-analyse-wahl', 'analyse-quelle'), vergleich = el('select', 'w-analyse-wahl', 'analyse-vergleich');
    quelle.title = TEXT.quelle; vergleich.title = TEXT.vergleich;
    const stand = el('span', 'w-analyse-stand', 'analyse-stand', '');
    const beschrifte = (t, e) => { const l = el('label', 'w-analyse-etikett'); l.append(el('span', undefined, undefined, t), e); return l; };
    kopf.append(beschrifte(TEXT.quelle, quelle), beschrifte(TEXT.vergleich, vergleich), stand);
    const spektrum = el('canvas', 'w-analyse-spektrum', 'analyse-spektrum'), lesung = el('div', 'w-analyse-lesung', 'analyse-lesung', TEXT.hoverLeer);
    spektrum.setAttribute('data-spalte', '');
    const zeitbild = el('canvas', 'w-analyse-zeitbild', 'analyse-zeitbild');
    // stereo meters
    const stereo = el('div', 'w-analyse-stereo');
    const balken = el('div', 'w-analyse-balken', 'analyse-korrelation');
    const korrelationWert = el('i', 'w-analyse-marke'), korrelationMin = el('i', 'w-analyse-marke w-analyse-marke-min', 'analyse-korrelation-min');
    const korrelationText = el('span', 'w-analyse-balkentext');
    balken.append(korrelationWert, korrelationMin, korrelationText);
    const breite = el('div', 'w-analyse-breite', 'analyse-breite');
    const baender = [0, 1, 2, 3].map((i) => el('div', 'w-analyse-band', `analyse-band-${i}`));
    stereo.append(balken, breite, ...baender);
    const zahlen = el('table', 'w-analyse-zahlen', 'analyse-zahlen'), hinweise = el('ul', 'w-analyse-hinweise', 'analyse-hinweise');
    const abschnitt = (t, ...k) => { const s = el('section', 'w-analyse-abschnitt'); s.append(el('h4', undefined, undefined, t), ...k); return s; };
    koerper.append(kopf, abschnitt(TEXT.spektrum, spektrum, lesung), abschnitt(TEXT.zeitbild, zeitbild), abschnitt(TEXT.stereo, stereo), abschnitt(TEXT.zahlen, zahlen), abschnitt(TEXT.hinweise, hinweise));
    ui = { neu, quelle, vergleich, stand, spektrum, lesung, zeitbild, korrelationWert, korrelationMin, korrelationText, breite, baender, zahlen, hinweise };
    quelle.addEventListener('change', () => { wahlQuelle = quelle.value; pruefeWahl(); messe(); });
    vergleich.addEventListener('change', () => { wahlVergleich = vergleich.value; messe(); });
    const lies = (ev) => {
      if (!antwort) return;
      const r = spektrum.getBoundingClientRect(), x = Math.max(0, Math.min(r.width, (ev.clientX ?? 0) - (r.left ?? 0)));
      const hz = xZuHz(x, r.width || 1), q = antwort.quelle, i = bandBei(hz, q.spektrum.hz), f = q.spektrum.hz[i];
      const teile = [`${hzKurz(f)} · ${notenName(f)}`, `avg ${zahlText(q.stumm ? null : q.spektrum.mittel_db[i])} dB`, `max ${zahlText(q.stumm ? null : q.spektrum.max_db[i])} dB`];
      if (antwort.vergleich) teile.push(`other ${zahlText(antwort.vergleich.stumm ? null : antwort.vergleich.spektrum.mittel_db[i])} dB`);
      ui.lesung.textContent = teile.join(' · '); zeichnung.hover = x;
    };
    spektrum.addEventListener('pointermove', lies);
    spektrum.addEventListener('pointerleave', () => { zeichnung.hover = null; ui.lesung.textContent = TEXT.hoverLeer; });
    if (typeof ResizeObserver === 'function') {
      beobachter = new ResizeObserver(() => { groesse.spektrum = null; groesse.zeitbild = null; zeichnung.spektrum = ''; zeichnung.zeitbild = ''; });
      beobachter.observe(spektrum); beobachter.observe(zeitbild);
    }
    pruefeWahl();
    messe();
    return {
      aktualisiere: () => {
        if (!offen || !st.projekt) return;
        pruefeWahl();
        if (st.projekt.rev !== gesehenRev) { gesehenRev = st.projekt.rev; planeNeu(); }
      },
      zerstoere: () => { beobachter?.disconnect?.(); beobachter = null; offen = false; gen += 1; clearTimeout(uhr); uhr = null; ui = null; antwort = null; zeichnung.basis = null; },
    };
  }

  knopf.addEventListener('click', () => {
    if (!st.projekt) return;
    ctx.fenster.oeffne({ id: FENSTER_ID, titel: TEXT.titel, untertitel: '', art: FENSTER_ID, pruefe: () => !!st.projekt, bauen });
  });
  const zeigeKnopf = () => { knopf.disabled = !st.projekt; };
  ctx.beimProjekt.push(zeigeKnopf);
  zeigeKnopf();
}
