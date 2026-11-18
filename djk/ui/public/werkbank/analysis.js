// Workbench ANALYZE window: measures one strip (track, return or MASTER) and an optional second one offline (POST /proj/analyse renders the loop range
// like the loudness run) and shows the 1/12-octave spectrum with the column under the playhead, the time picture, stereo correlation and width, the
// loudness numbers, the masking between the two strips and the hints of the measurement. It appends one button to the top bar (before SHELF) and
// opens one floating window of kind `analyse` (window.js). Request rules: at most one request in flight; a trigger during a request marks it
// stale, the stale answer is dropped and one fresh request follows; a project change measures again 800 ms after the last change. The window
// draws and measures only while it is open. Canvas pattern as schnitt_streifen.js (size from getBoundingClientRect, redraw by key).
// Slice 2: the source LIVE OUTPUT polls GET /analyse/live every 100 ms (spectrum with ballistics and held maxima, a rolling picture of 30 s, stereo,
// loudness, hints computed here); COMPARE WITH also takes stored references and a file dropped from the shelf (the page then measures the
// reference once and levels it itself); SAVE REF stores the shown range as a reference.
// The answer is the contract of project/klang_vertrag.ts. UI texts English.
import { beatsProTakt } from '../production/timeline.js';
import { ZIEH_TYP } from '../production/drag.js';
import { abgleich as rechneAbgleich, abweichungText } from '../sound_match.js';
import { ANALYSE_TEXT, HZ_LINIEN, hzZuX, xZuHz, dbZuY, linienText, notenName, bandBei, spalteBei, spalteDb, quellenListe, zahlText, taktLinien, breiteText, zeitbildBytes, zeitbildRgba, bildAnteil, minSekText, ballistik, maxHalten, neuesRollbild, rollbildSchiebe, vergleichOptionen, liveHinweise, haltHinweise } from './analysis_zeichnen.js';

const ENTPRELL_MS = 800;
const PEGEL_MIN_DB = -60;   // a stereo band shows its correlation only above this level
const FENSTER_ID = 'analyse';
const LIVE_MS = 100, LIVE_ABGLEICH_MS = 500, REF_DAUER_S = 15, WEG_MS = 3000;
const LIVE_ZAHLEN = [['Momentary (LUFS)', 'lufs_m'], ['Momentary max (LUFS)', 'lufs_m_max'], ['True peak (dBTP)', 'tp'], ['True peak max (dBTP)', 'tp_max'], ['Crest (dB)', 'crest']];
const ROLLEN_STANDARD = ['other'];
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
const DETAIL_MAX = 160;
// the server's own text first (as FIND SOUND does), else the text of the reason; then the detail, shortened to one line
const fehlerText = (antwortText, r) => {
  const t = typeof r?.j?.text === 'string' && r.j.text ? r.j.text : antwortText(r);
  const d = r?.j?.detail;
  const dt = (typeof d === 'string' ? d : d ? JSON.stringify(d) : '').replace(/\s+/g, ' ').trim();
  return dt ? `${t} \u00b7 ${dt.length > DETAIL_MAX ? `${dt.slice(0, DETAIL_MAX - 1)}\u2026` : dt}` : t;
};
const gueltig = (j) => !!j && typeof j === 'object' && Array.isArray(j.quelle?.spektrum?.hz) && !!j.quelle.zeitbild && Number.isFinite(j.rev);

export function bindeAnalyse(ctx) {
  // built here, not at module level: analysis_zeichnen.js reaches this file through an import cycle (mix.js -> sound.js -> werkbank.js) when a test loads it first
  const TEXT = { ...ANALYSE_TEXT, quelle: 'SOURCE', stumm: 'silent in the mix', keineHinweise: 'Nothing to note.', keinSignal: 'no signal', spektrum: 'SPECTRUM', zeitbild: 'OVER TIME',
    stereo: 'STEREO', zahlen: 'LOUDNESS', hinweise: 'HINTS', korrelation: 'Correlation', breite: 'Width', hoverLeer: 'Move over the spectrum to read a band',
    vergleichTitel: 'Compare with a strip or a reference. Drop a track or sample from the shelf here.', abgleich: 'VS REFERENCE', nah: 'Close to the reference (within 3 dB)',
    merken: 'SAVE REF', merkenTitel: 'Store the shown range as a reference', ok: 'SAVE', abbruch: 'CANCEL', weg: '×', wegFrage: 'REMOVE?', wegTitel: 'Remove this reference',
    abgleichTitel: 'On: the reference is drawn shifted to the level of the source (tonal balance). Off: as measured.', namePlatz: 'name', nameFehlt: 'Give the reference a name',
    liveStand: 'live', liveStumm: 'no signal', liveLeer: 'engine not running', liveSteht: 'stopped', gemerkt: 'saved' };
  const { st, $ } = ctx;
  const knopf = el('button', 'w-export w-analyse-auf', 'analyse-auf', TEXT.knopf);
  knopf.type = 'button'; knopf.title = TEXT.knopfTitel; knopf.disabled = true;
  $('kopf').append(knopf);

  // state of the open window (all null/false while closed)
  let offen = false, gen = 0;
  let antwort = null, laeuft = false, veraltet = false, uhr = null, gesehenRev = null, listeSchluessel = '', antwortQuelle = null;
  let wahlQuelle = null, wahlVergleich = '';   // 'spur:s1' style values, 'live'; comparison '' = none, 'ref:<id>', 'datei'
  let referenzen = [], rollen = ROLLEN_STANDARD, datei = null;   // stored references, their roles, the file dropped on the window
  let live = null, liveUhr = null, liveLaeuft = false, liveNr = 0, liveFehler = '';   // the live mode: its state object while it is the source
  let liveRef = { schluessel: '', messung: null }, liveAbg = null, liveAbgT = -Infinity;
  let wegUhr = null;
  let ui = null, beobachter = null;   // the elements of the window
  const zeichnung = { spektrum: '', zeitbild: '', hover: null, basis: null, rollBild: null };
  let antwortNr = 0, farben = { quelle: '', vergleich: '' };   // antwortNr counts the answers (redraw key); farben are those of the strips that were measured

  const istLive = () => wahlQuelle === 'live';
  const istRef = () => wahlVergleich === 'datei' || wahlVergleich.startsWith('ref:');
  const liste = () => quellenListe(st.projekt);
  const standard = () => {
    const l = liste(), s = st.wahl ? `spur:${st.wahl}` : null;
    return s && l.some((x) => x.wert === s) ? s : 'master';
  };
  // a vanished choice goes back (source: the selected track, comparison: none); the selectors show it
  function pruefeWahl() {
    const l = liste();
    if (wahlQuelle === null || (wahlQuelle !== 'live' && !l.some((x) => x.wert === wahlQuelle))) wahlQuelle = standard();
    if (wahlVergleich !== '') {
      const ok = wahlVergleich === 'datei' ? !!datei : wahlVergleich.startsWith('ref:') ? referenzen.some((r) => `ref:${r.id}` === wahlVergleich)
        : !istLive() && wahlVergleich !== wahlQuelle && l.some((x) => x.wert === wahlVergleich);   // never the source itself, no strip next to the live output
      if (!ok) wahlVergleich = '';
    }
    baueOptionen(l);
    if (ui) { ui.quelle.value = wahlQuelle; ui.vergleich.value = wahlVergleich; }
  }
  function baueOptionen(l) {
    if (!ui) return;
    const eintraege = vergleichOptionen({ streifen: l, quelle: wahlQuelle, referenzen, datei });
    const schluessel = `${wahlQuelle}#${l.map((x) => `${x.wert}=${x.text}`).join('|')}#${eintraege.map((x) => (x.gruppe ? x.optionen.map((o) => `${o.wert}=${o.text}`).join(',') : `${x.wert}=${x.text}`)).join('|')}`;
    if (schluessel === listeSchluessel) return;
    listeSchluessel = schluessel;
    const mach = (x) => { const o = el('option', undefined, undefined, x.text); o.value = x.wert; return o; };
    ui.quelle.replaceChildren(...l.map(mach), mach({ wert: 'live', text: TEXT.live }));
    ui.vergleich.replaceChildren(...eintraege.map((x) => {
      if (!x.gruppe) return mach(x);
      const g = el('optgroup'); g.setAttribute('label', x.gruppe); g.append(...x.optionen.map(mach));
      return g;
    }));
  }
  // what depends on the comparison and the answer: MATCH, the remove button, the VS REFERENCE section, SAVE REF
  function aktualisiereKopf() {
    if (!ui) return;
    const ref = istRef();
    ui.abgleichAn.hidden = !ref; ui.abgleichEtikett.hidden = !ref;
    ui.refWeg.hidden = !wahlVergleich.startsWith('ref:');
    if (!ui.refWeg.hidden && wegUhr === null) ui.refWeg.textContent = TEXT.weg;
    ui.merkenKnopf.disabled = !speicherZiel();
    zeigeAbgleich();
  }

  // ---- the requests ------------------------------------------------------------------------------------------------------------------------------
  const setzeStand = (t) => { if (ui) ui.stand.textContent = t; };
  function messe() {
    if (!offen || !st.projekt || istLive()) return;
    if (laeuft) { veraltet = true; return; }   // at most one in flight: the answer to the running one is dropped
    sende();
  }
  const vergleichQuelle = () => (wahlVergleich === 'datei' ? { art: 'datei', sha: datei.sha } : { art: 'referenz', id: wahlVergleich.slice(4) });
  async function sende() {
    pruefeWahl();
    if (istLive()) return;
    const l = liste(), q = l.find((x) => x.wert === wahlQuelle), v = wahlVergleich === '' || istRef() ? null : l.find((x) => x.wert === wahlVergleich);
    if (!q) return;
    const koerper = { quelle: q.quelle, ...(v ? { vergleich: v.quelle } : istRef() ? { vergleich: vergleichQuelle() } : {}), ohne_freeze: true };   // the window never freezes a track (the hand tool does)
    laeuft = true; veraltet = false;
    const meine = gen;
    setzeStand(TEXT.misst);
    let r;
    try { r = await ctx.holeJson('/proj/analyse', koerper); } catch (e) { r = { status: 0, j: { fehler: 'netz', text: String(e?.message ?? e) } }; }
    laeuft = false;
    if (!offen) return;
    if (veraltet || meine !== gen) { messe(); return; }   // stale: dropped, one fresh request
    if (r.status === 200 && gueltig(r.j)) {
      antwort = r.j; antwortNr += 1; zeichnung.basis = null; antwortQuelle = q.quelle;
      farben = { quelle: q.farbe, vergleich: v?.farbe ?? '' };
      zeichnung.spektrum = ''; zeichnung.zeitbild = '';
      setzeStand(`rev ${r.j.rev}`);
      zeigeAntwort();
    } else {
      setzeStand(r.status === 200 ? 'The answer is not a measurement' : fehlerText(ctx.antwortText, r));   // the last drawing stays
    }
  }
  function planeNeu() {
    clearTimeout(uhr);
    uhr = setTimeout(() => { uhr = null; messe(); }, ENTPRELL_MS);
  }

  // ---- the live mode -----------------------------------------------------------------------------------------------------------------------------
  function liveNeu() {
    live = { hz: null, pegel: null, max: null, t: null, bild: neuesRollbild(), lufsMax: null, tpMax: null, letzte: null, status: '', halt: {}, hinweise: [] };
    zeichnung.rollBild = null; zeichnung.spektrum = ''; zeichnung.zeitbild = ''; liveNr += 1;
  }
  const liveReset = () => { if (live) { live.max = null; live.lufsMax = null; live.tpMax = null; live.hinweise = []; live.halt = {}; liveNr += 1; if (live.letzte) verarbeiteLive(live.letzte, true); } };
  function starteLive() {
    if (liveUhr === null && !liveLaeuft) liveRunde();
  }
  function stoppeLive() { clearTimeout(liveUhr); liveUhr = null; live = null; liveFehler = ''; liveRef = { schluessel: '', messung: null }; liveAbg = null; }
  async function liveRunde() {
    liveUhr = null;
    if (!offen || !istLive()) return;
    if (!document.hidden) {   // no polling for a hidden page; the timer keeps going
      liveLaeuft = true;
      const meine = gen;
      let r;
      try { r = await ctx.holeGet('/analyse/live'); } catch (e) { r = { status: 0, j: { fehler: 'netz', text: String(e?.message ?? e) } }; }
      liveLaeuft = false;
      if (offen && istLive() && meine === gen) {
        if (r.status === 200 && r.j && typeof r.j === 'object') verarbeiteLive(r.j);
        else setzeStand(fehlerText(ctx.antwortText, r));
      }
    }
    if (offen && istLive() && liveUhr === null) liveUhr = setTimeout(liveRunde, LIVE_MS);
  }
  const liveStandText = (j) => liveFehler || (j.leer ? TEXT.liveLeer : j.steht ? TEXT.liveSteht : j.stumm ? TEXT.liveStumm : TEXT.liveStand);
  function verarbeiteLive(j, nurMaxima = false) {
    if (!ui || !live) return;
    if (!nurMaxima) live.letzte = j;
    if (j.leer) { live.status = 'leer'; setzeStand(liveStandText(j)); return; }
    if (!Array.isArray(j.spektrum?.db) || !Array.isArray(j.spektrum?.hz)) { setzeStand('The answer is not a measurement'); return; }
    const jetzt = performance.now();
    live.hz = j.spektrum.hz;
    if (!nurMaxima) {
      const dt = live.t === null ? 0 : (jetzt - live.t) / 1000;
      live.t = jetzt;
      live.pegel = ballistik(live.pegel, j.spektrum.db, dt);
      rollbildSchiebe(live.bild, j.spektrum.db);
      liveNr += 1;
    }
    live.max = maxHalten(live.max, j.spektrum.db);
    if (Number.isFinite(j.lufs_m)) live.lufsMax = Math.max(live.lufsMax ?? -Infinity, j.lufs_m);
    if (Number.isFinite(j.true_peak_dbtp)) live.tpMax = Math.max(live.tpMax ?? -Infinity, j.true_peak_dbtp);
    const h = haltHinweise(live.halt, liveHinweise(j), jetzt);
    live.halt = h.gehalten; live.hinweise = h.liste;
    if (liveRef.messung && !j.stumm && live.pegel && jetzt - liveAbgT >= LIVE_ABGLEICH_MS) {   // the comparison at most twice per second
      liveAbgT = jetzt; liveAbg = rechneAbgleich(live.pegel, liveRef.messung.spektrum.mittel_db);
    }
    setzeStand(liveStandText(j));
    zeigeLive(j);
    aktualisiereKopf();
    zeichne();
  }
  async function holeLiveRef() {
    if (!offen || !istLive() || !istRef()) { liveRef = { schluessel: '', messung: null }; liveAbg = null; return; }
    const q = vergleichQuelle(), s = JSON.stringify(q);
    if (liveRef.schluessel === s) return;
    liveRef = { schluessel: s, messung: null }; liveAbg = null; liveAbgT = -Infinity; liveFehler = '';
    const meine = gen;
    setzeStand(TEXT.misst);
    const r = await ctx.holeJson('/analyse/referenz/messen', { quelle: q, dauer_s: REF_DAUER_S });
    if (!offen || meine !== gen || liveRef.schluessel !== s) return;
    if (r.status === 200 && Array.isArray(r.j?.messung?.spektrum?.mittel_db)) { liveRef.messung = r.j.messung; liveAbgT = -Infinity; if (live?.letzte) verarbeiteLive(live.letzte, true); aktualisiereKopf(); }
    else { liveFehler = r.status === 200 ? 'The answer is not a measurement' : fehlerText(ctx.antwortText, r); setzeStand(liveFehler); }
  }

  // ---- references --------------------------------------------------------------------------------------------------------------------------------
  async function ladeReferenzen() {
    const meine = gen;
    const r = await ctx.holeGet('/analyse/referenzen');
    if (!offen || meine !== gen) return;
    if (r.status === 200 && Array.isArray(r.j?.referenzen)) {
      referenzen = r.j.referenzen;
      rollen = Array.isArray(r.j.rollen) && r.j.rollen.length ? r.j.rollen : ROLLEN_STANDARD;
      baueRollen();
      const vorher = wahlVergleich;
      pruefeWahl();
      if (vorher !== wahlVergleich) vergleichGeaendert(); else aktualisiereKopf();
    }
  }
  function baueRollen() {
    if (!ui) return;
    const alt = ui.rolle.value;
    ui.rolle.replaceChildren(...rollen.map((x) => { const o = el('option', undefined, undefined, String(x).toUpperCase()); o.value = x; return o; }));
    ui.rolle.value = rollen.includes(alt) ? alt : rollen.includes('other') ? 'other' : rollen[0];
  }
  // what SAVE REF would store: a dropped file as the comparison (its measured range), else the source strip with the range of the shown answer; null = nothing
  function speicherZiel() {
    if (wahlVergleich === 'datei' && datei) {
      const b = istLive() ? liveRef.messung?.bereich : antwort?.vergleich?.bereich;
      return b ? { quelle: { art: 'datei', sha: datei.sha, von_s: b.von_s, bis_s: b.bis_s }, datei: true } : null;
    }
    if (istLive() || !antwort || !antwortQuelle) return null;
    return { projekt: { quelle: antwortQuelle, von_beat: antwort.von_beat, bis_beat: antwort.bis_beat }, datei: false };
  }
  function oeffneMerken() {
    if (!ui || ui.merkenKnopf.disabled) return;
    ui.reihe.hidden = !ui.reihe.hidden;
    if (!ui.reihe.hidden) { ui.name.value = wahlVergleich === 'datei' && datei ? datei.name : antwort?.quelle?.name ?? ''; }
  }
  async function merke() {
    const ziel = speicherZiel(), name = ui.name.value.trim();
    if (!ziel) return;
    if (!name) { setzeStand(TEXT.nameFehlt); return; }
    const { datei: warDatei, ...form } = ziel;
    const meine = gen;
    const r = await ctx.holeJson('/analyse/referenz/merken', { name, rolle: ui.rolle.value, ...form });
    if (!offen || meine !== gen) return;
    if (r.status !== 200 || !r.j?.referenz) { setzeStand(r.status === 200 ? 'The answer is not a reference' : fehlerText(ctx.antwortText, r)); return; }
    ui.reihe.hidden = true;
    setzeStand(TEXT.gemerkt);
    if (warDatei) { datei = null; wahlVergleich = `ref:${r.j.referenz.id}`; }   // the stored copy becomes the comparison
    await ladeReferenzen();
    if (warDatei) { pruefeWahl(); vergleichGeaendert(); }
    setzeStand(TEXT.gemerkt);
  }
  async function entferne() {
    const id = wahlVergleich.slice(4);
    if (!wahlVergleich.startsWith('ref:')) return;
    if (wegUhr === null) {   // first click: ask once for 3 s
      ui.refWeg.textContent = TEXT.wegFrage;
      wegUhr = setTimeout(() => { wegUhr = null; if (ui) ui.refWeg.textContent = TEXT.weg; }, WEG_MS);
      return;
    }
    clearTimeout(wegUhr); wegUhr = null; ui.refWeg.textContent = TEXT.weg;
    const meine = gen;
    const r = await ctx.holeJson('/analyse/referenz/loeschen', { id });
    if (!offen || meine !== gen) return;
    if (r.status !== 200) { setzeStand(fehlerText(ctx.antwortText, r)); return; }
    wahlVergleich = '';
    await ladeReferenzen();
    pruefeWahl(); vergleichGeaendert();
  }
  // the comparison changed: show what depends on it and measure
  function vergleichGeaendert() {
    liveFehler = '';
    if (ui) ui.vergleich.value = wahlVergleich;
    if (istLive()) { holeLiveRef(); if (live?.letzte) verarbeiteLive(live.letzte, true); } else messe();
    aktualisiereKopf();
  }
  function quelleGeaendert(vorherLive) {
    clearTimeout(uhr); uhr = null;
    if (istLive() !== vorherLive) {
      gen += 1; antwort = null; zeichnung.basis = null; zeichnung.spektrum = ''; zeichnung.zeitbild = ''; zeichnung.hover = null;
      leereAnzeige();
      if (istLive()) { liveNeu(); starteLive(); holeLiveRef(); setzeStand(TEXT.misst); }
      else { stoppeLive(); messe(); }
    } else messe();
    aktualisiereKopf();
  }

  // ---- what the window shows ---------------------------------------------------------------------------------------------------------------------
  function tabelle(namen, zeilen) {
    const kopfZeile = el('tr', undefined, 'analyse-kopfzeile');
    kopfZeile.append(el('th', undefined, undefined, ''), ...namen.map((n) => el('th', undefined, undefined, n)));
    ui.zahlen.replaceChildren(kopfZeile, ...zeilen.map(([name, ...werte]) => {
      const z = el('tr', undefined, 'analyse-zeile');
      z.append(el('th', undefined, undefined, name), ...werte.map((w) => el('td', 'w-analyse-zahl', 'analyse-zahl', zahlText(w))));
      return z;
    }));
  }
  function zeigeStereo(s, ohne) {
    ui.korrelationText.textContent = ohne ? TEXT.leer : `${TEXT.korrelation} ${zahlText(s.korrelation, 2)} (min ${zahlText(s.korrelation_min, 2)})`;
    ui.korrelationWert.style.left = `${ohne ? 50 : ((s.korrelation + 1) / 2) * 100}%`;
    ui.korrelationMin.style.left = `${ohne ? 50 : ((s.korrelation_min + 1) / 2) * 100}%`;
    ui.breite.textContent = `${TEXT.breite} ${ohne ? TEXT.leer : breiteText(s.breite_db)}`;
    ui.baender.forEach((b, i) => {
      const x = ohne ? null : s.baender?.[i];
      b.textContent = !x ? `${BAND_TEXT[i]}: ${TEXT.leer}` : x.pegel_db > PEGEL_MIN_DB ? `${BAND_TEXT[i]}: ${zahlText(x.korrelation, 2)} · ${breiteText(x.breite_db)}` : `${BAND_TEXT[i]}: ${TEXT.keinSignal}`;
    });
  }
  const zeigeHinweise = (texte) => ui.hinweise.replaceChildren(...(texte.length ? texte.map((t) => el('li', 'w-analyse-hinweis', undefined, t)) : [el('li', 'w-analyse-leer', undefined, TEXT.keineHinweise)]));
  function leereAnzeige() {
    if (!ui) return;
    ui.zahlen.replaceChildren(); zeigeStereo(null, true); zeigeHinweise([]);
  }
  // VS REFERENCE: one line about the reference and its up to three deviations; a strip comparison shows nothing here
  function zeigeAbgleich() {
    if (!ui) return;
    const ref = istLive() ? liveRef.messung : antwort?.abgleich ? antwort.vergleich : null;
    const abg = istLive() ? liveAbg : antwort?.abgleich ?? null;
    ui.abgleich.hidden = !(istRef() && ref);
    if (ui.abgleich.hidden) return;
    const b = ref.bereich, lufs = ref.lautheit?.lufs_i;
    const zeile = [ref.name, ...(b ? [`${minSekText(b.von_s)} - ${minSekText(b.bis_s)}`] : []), `${zahlText(lufs)} LUFS`].join(' · ');
    const punkte = !abg ? [] : abg.abweichungen?.length ? abg.abweichungen.map((x) => el('li', 'w-analyse-hinweis', 'analyse-abweichung', abweichungText(x))) : [el('li', 'w-analyse-leer', 'analyse-abweichung', TEXT.nah)];
    ui.abgleichInhalt.replaceChildren(el('div', 'w-analyse-ref-zeile', 'analyse-abgleich-zeile', zeile), el('ul', 'w-analyse-hinweise', undefined, ''));
    ui.abgleichInhalt.children[1].append(...punkte);
  }
  // the offset the reference curve is drawn with: 0 as measured
  const versatz = () => (ui?.abgleichAn.checked !== false && istRef() ? ((istLive() ? liveAbg : antwort?.abgleich)?.versatz_db ?? 0) : 0);
  const refKurve = () => (istLive() ? liveRef.messung : antwort?.abgleich ? antwort.vergleich : null);

  function zeigeAntwort() {
    if (!ui || !antwort) return;
    const a = antwort, q = a.quelle, v = a.vergleich ?? null;
    // numbers
    const nur = (m, f) => (m.stumm ? null : m.lautheit?.[f]);
    tabelle([`${q.name}${q.stumm ? ` (${TEXT.stumm})` : ''}`, ...(v ? [`${v.name}${v.stumm ? ` (${TEXT.stumm})` : ''}`] : [])],
      ZAHLEN.map(([feld, name, einheit]) => [`${name} (${einheit})`, nur(q, feld), ...(v ? [nur(v, feld)] : [])]));
    zeigeStereo(q.stereo, q.stumm || !q.stereo);
    zeigeHinweise(a.hinweise?.length ? a.hinweise.map((h) => h.text) : []);
    aktualisiereKopf();
    zeichne();
  }
  function zeigeLive(j) {
    const ohne = j.stumm || !j.stereo;
    const ref = liveRef.messung;
    const crest = Number.isFinite(j.spitze_db) && Number.isFinite(j.rms_db) ? j.spitze_db - j.rms_db : null;
    const wert = { lufs_m: j.lufs_m, lufs_m_max: live.lufsMax, tp: j.true_peak_dbtp, tp_max: live.tpMax, crest };
    const refWert = { tp: ref?.lautheit?.true_peak_dbtp, crest: ref?.lautheit?.crest_db };   // the numbers the reference shares with a live reading
    tabelle([TEXT.live, ...(ref ? [ref.name] : [])], LIVE_ZAHLEN.map(([name, k]) => [name, wert[k], ...(ref ? [refWert[k] ?? null] : [])]));
    zeigeStereo(j.stereo, ohne);
    zeigeHinweise(live.hinweise);
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
  const kurve = (g, hz, db, W, H, plus = 0) => hz.forEach((f, i) => { const x = hzZuX(f, W), y = dbZuY(db[i] + plus, H); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
  const grosse = (name) => { const g = groesse[name]; return g ? `${g.W}x${g.H}` : '-'; };
  function zeichneSpektrum(spalte) {
    const a = istLive() ? null : antwort, lv = istLive() ? live : null;
    const m = messeLeinwand('spektrum');
    if (!m) return;
    const schluessel = `${antwortNr}|${liveNr}|${istLive()}|${grosse('spektrum')}|${spalte}|${zeichnung.hover}|${versatz()}`;
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
    if (!a && !(lv?.pegel)) return;
    for (const s of a?.ueberdeckung?.schwerpunkte ?? []) {
      g.fillStyle = FARBE.schwer;
      g.fillRect(hzZuX(s.hz_von, W), 0, Math.max(1, hzZuX(s.hz_bis, W) - hzZuX(s.hz_von, W)), H);
    }
    const q = a?.quelle, v = a?.vergleich;
    const farbeQ = farben.quelle || FARBE.quelle, farbeV = farben.vergleich || FARBE.vergleich;   // the strips that were measured, not the current selection
    const hz = lv ? lv.hz : q.spektrum.hz, jetzt = lv ? lv.pegel : q.spektrum.mittel_db, max = lv ? lv.max : q.spektrum.max_db;
    if (lv || !q.stumm) {
      g.beginPath(); kurve(g, hz, jetzt, W, H);
      g.lineTo(hzZuX(hz.at(-1), W), H); g.lineTo(hzZuX(hz[0], W), H); g.closePath();
      g.globalAlpha = 0.3; g.fillStyle = farbeQ; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = farbeQ; g.beginPath(); kurve(g, hz, max, W, H); g.stroke();   // the maximum as a thin line
    }
    const r = refKurve(), vm = lv ? r : v;
    if (vm && !vm.stumm) { g.strokeStyle = farbeV; g.lineWidth = 2; g.beginPath(); kurve(g, vm.spektrum.hz, vm.spektrum.mittel_db, W, H, vm === r ? versatz() : 0); g.stroke(); g.lineWidth = 1; }
    if (spalte !== null && q && !q.stumm) {   // the column under the playhead
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
  // the rolling picture of the live mode: one image per answer (300 x 120 pixels)
  function rollLeinwand() {
    if (typeof ImageData !== 'function' || !live) return null;
    const bi = live.bild;
    const b = zeichnung.rollBild ?? document.createElement('canvas'); b.width = bi.spalten; b.height = bi.zeilen;
    b.getContext('2d').putImageData(new ImageData(zeitbildRgba(bi.daten, bi.spalten, bi.zeilen), bi.spalten, bi.zeilen), 0, 0);
    zeichnung.rollBild = b;
    return b;
  }
  function zeichneZeitbild(beat) {
    const a = istLive() ? null : antwort;
    const m = messeLeinwand('zeitbild');
    if (!m) return;
    const { W, H, g } = m;
    if (istLive()) {   // no bar lines, no playhead
      const schluessel = `live|${liveNr}|${grosse('zeitbild')}`;
      if (schluessel === zeichnung.zeitbild) return;
      zeichnung.zeitbild = schluessel;
      g.fillStyle = FARBE.grund; g.fillRect(0, 0, W, H);
      const b = rollLeinwand();
      if (b) g.drawImage(b, 0, 0, b.width, b.height, 0, 0, W, H);
      return;
    }
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
    const spalte = istLive() ? null : spalteBei(beat, antwort);
    if (String(spalte ?? '') !== (ui.spektrum.getAttribute('data-spalte') ?? '')) ui.spektrum.setAttribute('data-spalte', spalte === null ? '' : String(spalte));
    zeichneSpektrum(spalte);
    zeichneZeitbild(beat);
  }

  // one hook for the whole page life; idle while the window is closed (hooks cannot be removed)
  ctx.vorBild.push(() => { if (offen && ui) zeichne(ctx.kopfBeat()); });

  // ---- the window --------------------------------------------------------------------------------------------------------------------------------
  function bauen(koerper, leiste) {
    offen = true; gen += 1; antwort = null; zeichnung.spektrum = ''; zeichnung.zeitbild = ''; zeichnung.hover = null; zeichnung.rollBild = null;
    listeSchluessel = ''; wahlQuelle = null; wahlVergleich = ''; gesehenRev = st.projekt?.rev ?? null;
    live = null; liveUhr = null; liveLaeuft = false; liveFehler = ''; liveRef = { schluessel: '', messung: null }; liveAbg = null; datei = null; wegUhr = null; antwortQuelle = null;
    const neu = el('button', 'w-effekt-knopf', 'analyse-neu', TEXT.neu); neu.type = 'button'; neu.title = 'Measure again';
    neu.addEventListener('click', () => { if (istLive()) liveReset(); else messe(); });
    const merkenKnopf = el('button', 'w-effekt-knopf', 'analyse-ref-speichern', TEXT.merken); merkenKnopf.type = 'button'; merkenKnopf.title = TEXT.merkenTitel; merkenKnopf.disabled = true;
    merkenKnopf.addEventListener('click', oeffneMerken);
    leiste.append(neu, merkenKnopf);
    const kopf = el('div', 'w-analyse-kopf');
    const quelle = el('select', 'w-analyse-wahl', 'analyse-quelle'), vergleich = el('select', 'w-analyse-wahl', 'analyse-vergleich');
    quelle.title = TEXT.quelle; vergleich.title = TEXT.vergleichTitel;
    const stand = el('span', 'w-analyse-stand', 'analyse-stand', '');
    const beschrifte = (t, e) => { const l = el('label', 'w-analyse-etikett'); l.append(el('span', undefined, undefined, t), e); return l; };
    const refWeg = el('button', 'w-analyse-weg', 'analyse-ref-weg', TEXT.weg); refWeg.type = 'button'; refWeg.title = TEXT.wegTitel; refWeg.hidden = true;
    const abgleichAn = el('input', undefined, 'analyse-match'); abgleichAn.type = 'checkbox'; abgleichAn.checked = true; abgleichAn.title = TEXT.abgleichTitel; abgleichAn.hidden = true;
    const abgleichEtikett = el('label', 'w-analyse-match'); abgleichEtikett.title = TEXT.abgleichTitel; abgleichEtikett.hidden = true;
    abgleichEtikett.append(abgleichAn, el('span', undefined, undefined, 'MATCH'));
    kopf.append(beschrifte(TEXT.quelle, quelle), beschrifte(TEXT.vergleich, vergleich), refWeg, abgleichEtikett, stand);
    // inline row of SAVE REF
    const reihe = el('div', 'w-analyse-speichern', 'analyse-ref-reihe'); reihe.hidden = true;
    const name = el('input', 'w-analyse-name', 'analyse-ref-name'); name.type = 'text'; name.placeholder = TEXT.namePlatz; name.maxLength = 80;
    const rolle = el('select', 'w-analyse-wahl', 'analyse-ref-rolle');
    const ok = el('button', 'w-effekt-knopf', 'analyse-ref-ok', TEXT.ok), abbruch = el('button', 'w-effekt-knopf', 'analyse-ref-abbruch', TEXT.abbruch);
    ok.type = 'button'; abbruch.type = 'button';
    reihe.append(name, rolle, ok, abbruch);
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
    const abgleichInhalt = el('div', 'w-analyse-ref');
    const abgleich = abschnitt(TEXT.abgleich, abgleichInhalt); abgleich.setAttribute('data-w', 'analyse-abgleich'); abgleich.hidden = true;
    koerper.append(kopf, reihe, abschnitt(TEXT.spektrum, spektrum, lesung), abgleich, abschnitt(TEXT.zeitbild, zeitbild), abschnitt(TEXT.stereo, stereo), abschnitt(TEXT.zahlen, zahlen), abschnitt(TEXT.hinweise, hinweise));
    ui = { neu, merkenKnopf, quelle, vergleich, stand, spektrum, lesung, zeitbild, korrelationWert, korrelationMin, korrelationText, breite, baender, zahlen, hinweise,
      refWeg, abgleichAn, abgleichEtikett, reihe, name, rolle, abgleich, abgleichInhalt };
    baueRollen();
    quelle.addEventListener('change', () => { const vorher = istLive(); wahlQuelle = quelle.value; pruefeWahl(); quelleGeaendert(vorher); });
    vergleich.addEventListener('change', () => { wahlVergleich = vergleich.value; vergleichGeaendert(); });
    abgleichAn.addEventListener('change', () => { zeichnung.spektrum = ''; zeichne(); });
    refWeg.addEventListener('click', () => { entferne(); });
    ok.addEventListener('click', () => { merke(); });
    abbruch.addEventListener('click', () => { reihe.hidden = true; });
    // drop target: a track or sample dragged from the shelf becomes the comparison
    const hatTyp = (ev) => Array.from(ev.dataTransfer?.types ?? []).includes(ZIEH_TYP);
    koerper.addEventListener('dragover', (ev) => {
      if (!hatTyp(ev)) return;
      ev.preventDefault();
      try { ev.dataTransfer.dropEffect = 'copy'; } catch { /* read-only in some browsers */ }
      koerper.classList.add('w-analyse-ziel');
    });
    koerper.addEventListener('dragleave', (ev) => { if (ev.relatedTarget && koerper.contains(ev.relatedTarget)) return; koerper.classList.remove('w-analyse-ziel'); });
    koerper.addEventListener('drop', (ev) => {
      koerper.classList.remove('w-analyse-ziel');
      if (!hatTyp(ev)) return;
      ev.preventDefault();
      let nutz = null;
      try { nutz = JSON.parse(ev.dataTransfer.getData(ZIEH_TYP)); } catch { /* not ours */ }
      if (!nutz || typeof nutz.sha !== 'string') return;
      datei = { sha: nutz.sha, name: typeof nutz.name === 'string' && nutz.name ? nutz.name : 'file' };
      wahlVergleich = 'datei'; liveRef = { schluessel: '', messung: null }; liveAbg = null;
      pruefeWahl();
      vergleichGeaendert();
    });
    const lies = (ev) => {
      const lv = istLive() ? live : null;
      if (!lv && !antwort) return;
      if (lv && !lv.pegel) return;
      const r = spektrum.getBoundingClientRect(), x = Math.max(0, Math.min(r.width, (ev.clientX ?? 0) - (r.left ?? 0)));
      const hzListe = lv ? lv.hz : antwort.quelle.spektrum.hz;
      const hz = xZuHz(x, r.width || 1), i = bandBei(hz, hzListe), f = hzListe[i];
      const teile = [`${hzKurz(f)} · ${notenName(f)}`];
      if (lv) teile.push(`now ${zahlText(lv.pegel[i])} dB`, `max ${zahlText(lv.max?.[i])} dB`);
      else { const q = antwort.quelle; teile.push(`avg ${zahlText(q.stumm ? null : q.spektrum.mittel_db[i])} dB`, `max ${zahlText(q.stumm ? null : q.spektrum.max_db[i])} dB`); }
      const rk = refKurve();
      if (rk) {
        const vs = versatz(), roh = rk.stumm ? null : rk.spektrum.mittel_db[i];
        teile.push(`ref ${zahlText(roh === null ? null : roh + vs)} dB${istRef() && ui.abgleichAn.checked !== false ? ` (matched ${vs >= 0 ? '+' : ''}${vs.toFixed(1)})` : ''}`);
      } else if (!lv && antwort.vergleich) teile.push(`other ${zahlText(antwort.vergleich.stumm ? null : antwort.vergleich.spektrum.mittel_db[i])} dB`);
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
    ladeReferenzen();
    return {
      aktualisiere: () => {
        if (!offen || !st.projekt) return;
        pruefeWahl();
        if (st.projekt.rev !== gesehenRev) { gesehenRev = st.projekt.rev; if (!istLive()) planeNeu(); }
      },
      zerstoere: () => {
        beobachter?.disconnect?.(); beobachter = null; offen = false; gen += 1; clearTimeout(uhr); uhr = null; clearTimeout(liveUhr); liveUhr = null; clearTimeout(wegUhr); wegUhr = null;
        ui = null; antwort = null; live = null; zeichnung.basis = null; zeichnung.rollBild = null;
      },
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
