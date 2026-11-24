// Workbench FIND SOUND window: the variant round of the sound of one Baukasten track. The server holds the round (areas/proj/sound_runde.ts); the window
// shows what the server has: place A (the sound as the project has it) and up to three neighbours B to D that differ in one knob, a status line, the
// family tree path, and the buttons PICK, COMPARE (A and the selected place alternate every bar on the server), NEW NEIGHBOURS and BACK. A click on a place listens to it (the loop keeps playing, the project is not
// written); PICK writes the plan of the server as one undo step through ctx.aendere. It appends one button to the top bar (after ANALYZE) and opens one
// floating window of kind `runde` (window.js). The shapes are the contract of project/sound_runde_contract.ts; the window does no tree logic itself.
// Rules: the round follows the selected Baukasten track (a selection change starts a round, another kind of track shows a hint); while the round
// measures the window reads GET /proj/klang/runde every 400 ms (one request in flight), otherwise every 2 s; a stale round is restarted only after
// 800 ms without a further project event; closing the window (and leaving the page) ends the round. UI texts English.
const ENTPRELL_MS = 800, MISST_MS = 400, RUHE_MS = 2000;
const FENSTER_ID = 'runde';
const SCHRITT_KEY = 'runde.schritt';
const SCHRITTE = [['fein', 'subtle'], ['normal', 'clear'], ['grob', 'strong']];
const PLAETZE = ['A', 'B', 'C', 'D'];
const PEGEL_ANZEIGE_DB = 0.5;
const TEXT = {
  knopf: 'FIND SOUND', knopfTitel: 'Find a sound by trying one-knob neighbours of the selected Cypher Modular track', titel: 'FIND SOUND',
  keinBk: 'Select a track with a Cypher Modular instrument.', schritt: 'STEP', misst: 'measuring…', leer: '–', waehlen: 'PICK', neu: 'NEW NEIGHBOURS', zurueck: 'BACK',
  waehlenTitel: 'Write the chosen sound into the project (one undo step) and look for new neighbours', neuTitel: 'Look for other neighbours of the sound on A',
  zurueckTitel: 'Go back one step on the path (Undo also works)', keineNachbarn: 'no audible neighbour at this step size',
  schrittTitel: 'How clearly audible the neighbours must differ from A',
  vergleich: 'COMPARE', vergleichTitel: 'Alternate between A and the selected place, one bar each, on the bar line (the transport must run; key c)',
  vergleichEnde: 'COMPARE ended', klingt: 'sounding',
  verworfen: 'The project changed meanwhile: the pick was not written. Choose again from the new neighbours.',
};
const el = (tag, klasse, w, text) => {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (w) e.setAttribute('data-w', w);
  if (text !== undefined) e.textContent = text;
  return e;
};
const gueltig = (j) => !!j && typeof j === 'object' && Number.isFinite(j.runde) && Array.isArray(j.plaetze) && typeof j.zustand === 'string';
const pegelText = (db) => (Math.abs(db) >= PEGEL_ANZEIGE_DB ? `${db > 0 ? '+' : '-'}${Math.abs(db).toFixed(1)} dB` : '');
const ausgleichText = (db) => (Math.abs(db) >= 0.05 ? ` · played ${db > 0 ? '+' : '-'}${Math.abs(db).toFixed(1)} dB` : '');
const nachbarnText = (n) => `${n} neighbour${n === 1 ? '' : 's'} found`;

export function bindeKlangRunde(ctx) {
  const { st, $ } = ctx;
  const knopf = el('button', 'w-export w-runde-auf', 'runde-auf', TEXT.knopf);
  knopf.type = 'button'; knopf.title = TEXT.knopfTitel; knopf.disabled = true;
  $('kopf').append(knopf);

  // state of the open window (null/false while closed)
  let offen = false, ui = null, lage = null, meldung = '', gen = 0;
  let startet = false, schreibt = false, liest = false, pollUhr = null, entprellUhr = null;
  let gewaehlt = null;   // the selected place B..D (the one COMPARE plays against A, the one a PICK takes during COMPARE)
  let beendet = false;   // the server ended COMPARE by itself (seen on a read): said once in the status line
  let verworfen = false;   // a PICK/BACK plan was dropped because the project changed: said in the status line until the user acts again
  let abgelehntFuer = null;   // the track whose start was refused: not started again by itself (a graph without knobs would be asked every 2 s)
  let wegSchluessel = '';

  const bkSpur = () => {
    const s = (st.projekt?.spuren ?? []).find((x) => x.id === st.wahl && x.art === 'instrument');
    return s?.geraet?.art === 'intern' && s.geraet.name === 'bk' ? s : null;
  };
  const schritt = () => { const v = ctx.lies(SCHRITT_KEY, 'normal'); return SCHRITTE.some((x) => x[0] === v) ? v : 'normal'; };
  const vergleichAn = () => !!lage?.vergleich?.an;
  const wahlPlatz = () => (gewaehlt && lage?.plaetze.some((p) => p.platz === gewaehlt) ? gewaehlt : null);
  // the place a PICK takes: during COMPARE the selected one (A may be the side that sounds), else the one that plays
  const pickPlatz = () => (vergleichAn() ? wahlPlatz() ?? lage.vergleich.platz : lage?.aktiv);
  const grundVon = (r) => r?.j?.grund ?? r?.j?.fehler ?? '';
  const refusalText = (r) => (typeof r?.j?.text === 'string' && r.j.text ? r.j.text : ctx.antwortText(r));
  const zeitgeber = (f, ms) => { const u = setTimeout(f, ms); u?.unref?.(); return u; };

  // ---- drawing -----------------------------------------------------------------------------------------------------------------------------------
  function standText() {
    if (meldung) return meldung;
    if (verworfen) return TEXT.verworfen;
    if (beendet) return TEXT.vergleichEnde;
    if (!lage) return '';
    if (lage.zustand === 'fehler') return lage.text ?? lage.grund ?? '';
    if (lage.zustand === 'misst') return `measuring ${lage.fortschritt?.gemessen ?? 0} of ${lage.fortschritt?.hoechstens ?? 0}`;
    const n = Math.max(0, lage.plaetze.length - 1);
    return n === 0 ? (typeof lage.hinweis === 'string' && lage.hinweis ? lage.hinweis : TEXT.keineNachbarn) : nachbarnText(n);
  }
  function zeige() {
    if (!ui) return;
    const spur = bkSpur();
    ui.hinweis.hidden = !!spur;
    ui.inhalt.hidden = !spur;
    if (!spur) return;
    ui.kopf.textContent = lage ? `${lage.spur_name} · ${lage.graph}` : spur.name ?? '';
    ui.schritt.value = lage?.schritt ?? schritt();
    const misst = lage?.zustand === 'misst';
    for (const name of PLAETZE) {
      const b = ui.plaetze[name], p = lage?.plaetze.find((x) => x.platz === name) ?? null;
      const sig = p ? `${p.text}|${pegelText(p.pegel_db)}|${ausgleichText(p.ausgleich_db ?? 0)}` : misst ? 'misst' : 'leer';
      if (b._sig !== sig) {
        b._sig = sig;
        b.replaceChildren(el('span', 'w-runde-buchstabe', undefined, name),
          el('span', 'w-runde-text', undefined, p ? p.text : misst ? TEXT.misst : TEXT.leer),
          el('span', 'w-runde-pegel', undefined, p ? pegelText(p.pegel_db) : ''));
        b.title = `${name} (key ${PLAETZE.indexOf(name) + 1})${p ? ausgleichText(p.ausgleich_db ?? 0) : ''}`;
      }
      b.disabled = !p;
      b.setAttribute('aria-pressed', lage && lage.aktiv === name && !!p ? 'true' : 'false');
      b.classList.toggle('w-runde-aktiv', b.getAttribute('aria-pressed') === 'true');
      b.classList.toggle('w-runde-gewaehlt', vergleichAn() && gewaehlt === name && !!p);
    }
    ui.stand.textContent = standText();
    ui.stand.classList.toggle('w-runde-fehler', lage?.zustand === 'fehler' || !!meldung || verworfen);
    const pick = lage ? pickPlatz() : null;
    const waehlbar = !!lage && lage.zustand !== 'fehler' && pick !== 'A' && lage.plaetze.some((p) => p.platz === pick);
    ui.waehlen.disabled = !waehlbar || schreibt;
    ui.zurueck.disabled = !lage || !lage.zurueck_moeglich || schreibt;
    ui.neu.disabled = !lage || schreibt;
    ui.vergleich.setAttribute('aria-pressed', vergleichAn() ? 'true' : 'false');
    ui.vergleich.classList.toggle('w-runde-an', vergleichAn());
    ui.vergleich.disabled = !lage || schreibt || lage.zustand === 'fehler' || (!vergleichAn() && wahlPlatz() === null);
    ui.klingt.textContent = vergleichAn() ? `${lage.vergleich.klingt} ${TEXT.klingt}` : '';
    zeigeWeg();
  }
  function zeigeWeg() {
    const weg = lage?.weg ?? [];
    const aktiv = weg.at(-1)?.id ?? null;
    const schluessel = JSON.stringify([weg, aktiv]);
    if (schluessel === wegSchluessel) return;
    wegSchluessel = schluessel;
    ui.weg.replaceChildren(...weg.map((k) => {
      const b = el('button', 'w-runde-knoten', 'runde-knoten', k.zweige > 0 ? `${k.text} +${k.zweige}` : k.text);
      b.type = 'button'; b.setAttribute('data-knoten', k.id);
      if (k.id === aktiv) { b.setAttribute('aria-current', 'true'); b.classList.add('w-runde-aktiv'); }
      else b.addEventListener('click', () => { schreibePlan('/proj/klang/zurueck', { knoten: k.id }); });
      return b;
    }));
  }

  // ---- the requests ------------------------------------------------------------------------------------------------------------------------------
  const nimm = (j) => {
    const neueRunde = !lage || lage.runde !== j.runde;
    lage = j; meldung = '';
    if (neueRunde) gewaehlt = null;
    if (j.vergleich?.an && j.vergleich.platz) gewaehlt = j.vergleich.platz;
    else if (gewaehlt === null && j.aktiv !== 'A') gewaehlt = j.aktiv;
  };
  // a refusal: its text on the status line; a round that is out of date or gone is replaced
  function lehneAb(r) {
    meldung = refusalText(r);
    zeige();
    const g = grundVon(r);
    if (g === 'runde_veraltet' || g === 'keine_runde') starte();
  }
  async function beende() {
    if (lage === null) return;
    lage = null; gen += 1;
    await ctx.holeJson('/proj/klang/ende', {});
  }
  async function starte() {
    if (!offen) return;
    clearTimeout(entprellUhr); entprellUhr = null;
    const spur = bkSpur();
    if (!spur) { await beende(); zeige(); return; }
    const meine = ++gen;
    startet = true;
    const r = await ctx.holeJson('/proj/klang/runde', { spur_id: spur.id, schritt: schritt() });
    if (meine === gen) startet = false;
    if (!offen || meine !== gen) return;
    if (r.status === 200 && gueltig(r.j)) { nimm(r.j); abgelehntFuer = null; }
    else { lage = null; meldung = refusalText(r); abgelehntFuer = spur.id; }
    zeige();
    planePoll();
  }
  // listen to a place; `vergleich` (places B..D) asks the server to alternate it with A every bar instead of playing it steadily
  async function hoere(platz, vergleich = false) {
    if (!lage || schreibt || !lage.plaetze.some((p) => p.platz === platz)) return;
    verworfen = false; beendet = false;
    if (platz !== 'A') gewaehlt = platz;
    const meine = gen, r = await ctx.holeJson('/proj/klang/hoeren', vergleich && platz !== 'A' ? { platz, runde: lage.runde, vergleich: true } : { platz, runde: lage.runde });
    if (!offen || meine !== gen) return;
    if (r.status === 200 && gueltig(r.j)) { nimm(r.j); zeige(); } else lehneAb(r);
  }
  // COMPARE on: the selected place against A; off: the selected place plays steadily (a plain listen ends COMPARE on the server)
  function schalteVergleich() {
    if (!lage || schreibt) return;
    if (vergleichAn()) hoere(wahlPlatz() ?? lage.vergleich.platz ?? lage.aktiv, false);
    else if (wahlPlatz() !== null) hoere(wahlPlatz(), true);
  }
  // PICK and BACK: the server answers a plan, the window writes it (only on the revision the plan was computed on), then a new round
  async function schreibePlan(weg, koerper) {
    if (!lage || schreibt) return;
    schreibt = true; verworfen = false; beendet = false; zeige();
    let neuStarten = true;
    try {
      const r = await ctx.holeJson(weg, { ...koerper, runde: lage.runde });
      if (!offen) return;
      if (r.status === 200 && Array.isArray(r.j?.befehle)) {
        if (st.projekt && st.projekt.rev === r.j.rev) await ctx.aendere(r.j.label, r.j.befehle);
        else verworfen = true;
      } else { lehneAb(r); neuStarten = false; }
    } finally { schreibt = false; }
    if (offen && neuStarten) starte(); else zeige();
  }
  // read the round the server has (the hand may have started or changed it); `neuHoeren` sends the active place again after a project event
  async function lies(neuHoeren) {
    if (!offen || liest || startet || schreibt || !bkSpur()) return;
    liest = true;
    const meine = gen;
    const r = await ctx.holeGet('/proj/klang/runde');
    liest = false;
    if (!offen || meine !== gen || schreibt || startet) return;
    if (r.status === 404) { lage = null; if (abgelehntFuer !== bkSpur()?.id) starte(); return; }
    if (r.status !== 200 || !gueltig(r.j) || (lage && r.j.runde < lage.runde)) return;
    const gewechselt = !lage || lage.runde !== r.j.runde, warAn = vergleichAn();
    nimm(r.j);
    beendet = warAn && !gewechselt && !r.j.vergleich?.an;
    zeige();
    if (r.j.zustand === 'veraltet') planeNeu(false);
    else if (neuHoeren && !gewechselt && r.j.aktiv !== 'A' && !r.j.vergleich?.an) hoere(r.j.aktiv);   // a plain listen would end COMPARE
  }
  function planeNeu(erneuern) {
    if (entprellUhr && !erneuern) return;
    clearTimeout(entprellUhr);
    entprellUhr = zeitgeber(() => {
      entprellUhr = null;
      if (offen && !schreibt && lage?.zustand === 'veraltet') starte();
    }, ENTPRELL_MS);
  }
  function planePoll() {
    clearTimeout(pollUhr); pollUhr = null;
    if (!offen) return;
    pollUhr = zeitgeber(async () => { pollUhr = null; await lies(false); planePoll(); }, lage?.zustand === 'misst' || vergleichAn() ? MISST_MS : RUHE_MS);
  }

  // ---- the window ---------------------------------------------------------------------------------------------------------------------------------
  function bauen(koerper) {
    offen = true; lage = null; meldung = ''; verworfen = false; gewaehlt = null; beendet = false; wegSchluessel = ''; startet = false; schreibt = false; liest = false;
    const wurzel = el('div', 'w-runde', 'runde-koerper');
    wurzel.setAttribute('tabindex', '0');
    const hinweis = el('div', 'w-runde-hinweis', 'runde-hinweis', TEXT.keinBk);
    const inhalt = el('div', 'w-runde-inhalt');
    const kopfZeile = el('div', 'w-analyse-kopf w-runde-kopfzeile');
    const kopf = el('b', 'w-runde-name', 'runde-kopf', '');
    const wahl = el('select', 'w-analyse-wahl', 'runde-schritt');
    wahl.setAttribute('aria-label', TEXT.schritt); wahl.title = TEXT.schrittTitel;
    for (const [wert, name] of SCHRITTE) { const o = el('option', undefined, undefined, name); o.value = wert; wahl.append(o); }
    wahl.value = schritt();
    const stand = el('div', 'w-analyse-stand w-runde-stand', 'runde-stand', '');
    kopfZeile.append(kopf, wahl, stand);
    const plaetze = {}, reihe = el('div', 'w-runde-plaetze');
    for (const name of PLAETZE) {
      const b = el('button', 'w-runde-platz', `runde-platz-${name}`);
      b.type = 'button'; b._sig = null; b.disabled = true; b.setAttribute('aria-pressed', 'false'); b.title = `${name} (key ${PLAETZE.indexOf(name) + 1})`;
      b.addEventListener('click', () => { hoere(name, vergleichAn()); });
      plaetze[name] = b; reihe.append(b);
    }
    const knopfReihe = el('div', 'w-runde-knoepfe');
    const mach = (klasse, w, t, titel, f) => { const b = el('button', `w-analyse-weg ${klasse}`, w, t); b.type = 'button'; b.title = titel; b.addEventListener('click', f); return b; };
    const waehlen = mach('w-runde-waehlen', 'runde-waehlen', TEXT.waehlen, TEXT.waehlenTitel, () => { if (lage) schreibePlan('/proj/klang/waehlen', { platz: pickPlatz() }); });
    const neu = mach('w-runde-neu', 'runde-neu', TEXT.neu, TEXT.neuTitel, () => { starte(); });
    const zurueck = mach('w-runde-zurueck', 'runde-zurueck', TEXT.zurueck, TEXT.zurueckTitel, () => { schreibePlan('/proj/klang/zurueck', {}); });
    const vergleich = mach('w-runde-vergleich', 'runde-vergleich', TEXT.vergleich, TEXT.vergleichTitel, () => { schalteVergleich(); });
    vergleich.setAttribute('aria-pressed', 'false'); vergleich.disabled = true;
    const klingt = el('span', 'w-runde-klingt', 'runde-klingt', '');
    knopfReihe.append(waehlen, vergleich, klingt, neu, zurueck);
    const weg = el('div', 'w-runde-weg', 'runde-weg');
    inhalt.append(kopfZeile, reihe, knopfReihe, weg);
    wurzel.append(hinweis, inhalt);
    koerper.append(wurzel);
    ui = { wurzel, hinweis, inhalt, kopf, schritt: wahl, stand, plaetze, waehlen, vergleich, klingt, neu, zurueck, weg };
    wahl.addEventListener('change', () => {
      const v = SCHRITTE.some((x) => x[0] === wahl.value) ? wahl.value : 'normal';
      ctx.merke(SCHRITT_KEY, v);
      starte();
    });
    wurzel.addEventListener('keydown', (e) => {
      const t = e.target?.tagName;
      if (t === 'SELECT' || t === 'INPUT' || t === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      const i = ['1', '2', '3', '4'].indexOf(e.key);
      if (i >= 0) { e.preventDefault?.(); hoere(PLAETZE[i], vergleichAn()); }
      else if (e.key === 'c') { e.preventDefault?.(); schalteVergleich(); }
    });
    zeige();
    starte();
    return {
      aktualisiere: () => {},
      zerstoere: () => {
        offen = false; gen += 1;
        clearTimeout(pollUhr); pollUhr = null; clearTimeout(entprellUhr); entprellUhr = null;
        ui = null;
        if (lage !== null || startet) ctx.holeJson('/proj/klang/ende', {});
        lage = null; startet = false;
      },
    };
  }

  knopf.addEventListener('click', () => {
    if (!st.projekt) return;
    ctx.fenster.oeffne({ id: FENSTER_ID, titel: TEXT.titel, untertitel: '', art: FENSTER_ID, pruefe: () => !!st.projekt, bauen });
  });
  // a project event: another project starts anew; otherwise read the round and send the active place again (a graph reload resets the listening)
  ctx.beimProjekt.push((p, wechsel) => {
    knopf.disabled = !p;
    if (!offen || !p || schreibt) return;
    if (wechsel) { lage = null; gen += 1; starte(); return; }
    if (!bkSpur()) { beende().then(zeige); return; }
    if (entprellUhr) planeNeu(true);
    lies(true);
  });
  // a selection starts a round for that track; selecting the track the round already runs on (every click on its card does) changes nothing
  ctx.beiWahl.push(() => {
    if (!offen || schreibt) return;
    const spur = bkSpur();
    if (spur && lage && lage.spur_id === spur.id && lage.zustand !== 'veraltet' && lage.zustand !== 'fehler') return;
    abgelehntFuer = null;
    starte();
  });
  // leaving the page: the override of the instrument is removed on the server
  globalThis.addEventListener?.('pagehide', () => {
    if (!offen || lage === null) return;
    try {
      if (typeof navigator.sendBeacon === 'function') navigator.sendBeacon('/proj/klang/ende', new Blob(['{}'], { type: 'application/json' }));
      else fetch('/proj/klang/ende', { method: 'POST', body: '{}', keepalive: true, headers: { 'content-type': 'application/json' } });
    } catch { /* the idle end of the server removes it */ }
  });
  knopf.disabled = !st.projekt;
}
