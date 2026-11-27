// PRODUCTION: the master meter at the end of the transport bar (M, S, true peak with held max and OVER, correlation).
// It shows the master output as heard, taken from GET /analyse/pegel (a streaming meter in the page server). The page polls every
// MM_MS (10 Hz), only while the view and the browser tab are visible, one request at a time. It sets a few texts and one bar width
// per answer: no canvas, no requestAnimationFrame. A missing route or a failed request shows a dash and polling goes on.
// Everything that computes is a pure function here (tested in node, no DOM at import).
import { vektorPunkte, zeichneVektor } from '../werkbank/analysis_zeichnen.js';
import { ZIEL_VORGABEN, SPEICHER_SCHLUESSEL, dialogVorgabe } from './export_dialog.js';

export const MM_MS = 100;
const DASH = '–';
const BALKEN_MIN = -40;   // LUFS at the left end of the bar; 0 LUFS is the right end

const endlich = (x) => typeof x === 'number' && Number.isFinite(x);

export function lufsText(x) { return endlich(x) ? x.toFixed(1).replace('-', '−') : DASH; }
export function korrText(x) {
  if (!endlich(x)) return DASH;
  const t = x.toFixed(2);
  if (t === '0.00' || t === '-0.00') return '0.00';
  return x > 0 ? `+${t}` : t.replace('-', '−');
}
export function balkenAnteil(lufs) { return endlich(lufs) ? Math.min(1, Math.max(0, (lufs - BALKEN_MIN) / -BALKEN_MIN)) : 0; }

// `gespeichert`: the parsed storage value of SPEICHER_SCHLUESSEL, or null
export const decke = (gespeichert) => ZIEL_VORGABEN[dialogVorgabe(null, gespeichert).ziel]?.true_peak_dbtp ?? 0;
export const zielLufs = (gespeichert) => ZIEL_VORGABEN[dialogVorgabe(null, gespeichert).ziel]?.lufs_i ?? null;
export const ueberNeu = (war, tpMax, deckeDb) => !!war || (endlich(tpMax) && tpMax > deckeDb);

// distance of the integrated loudness to the target: one decimal with sign, '' without a value or without a target
export function abstandText(lufsI, ziel) {
  if (!endlich(lufsI) || !endlich(ziel)) return '';
  const d = Math.round((lufsI - ziel) * 10) / 10;
  const t = Math.abs(d).toFixed(1);
  return d > 0 ? `+${t}` : d < 0 ? `−${t}` : '0.0';
}
// title of the I value: what it is, the target, a gap of the measurement (page hidden)
export function iTitel(j, ziel) {
  let t = 'Integrated loudness since RESET or since PLAY';
  if (endlich(ziel)) t += ` · target ${lufsText(ziel)} LUFS`;
  if (endlich(j?.luecke_s) && j.luecke_s >= 1) t += ` · not measured: ${Math.round(j.luecke_s)} s (the page was hidden)`;
  return t;
}
// PLAY starts: the arrangement status changes from a KNOWN other value to 2 (playing); an unknown old value (page just loaded) is no start
export const playStart = (alt, neu) => neu === 2 && alt !== undefined && alt !== null && alt !== 2;

// vectorscope popover: a click on CORR toggles it, Escape closes it; it polls only while open and the view and tab are visible
export const vektorOffen = (alt, ereignis) => (ereignis === 'klick' ? !alt : ereignis === 'escape' || ereignis === 'schliessen' ? false : !!alt);
export const vektorPollt = (offen, sichtbar) => !!offen && !!sichtbar;

// A/B of the master stages (POST /proj/master_ab, state per the contract of slice 4). `lage` = the server state, or null (off).
export const AB_TITEL = 'Fair A/B of the master stages: measures the loop range once with and without them and turns the louder side down so both play at the same loudness. '
  + 'Matched for the measured range, not for every moment; not re-measured while on; bypasses all master stages together; B has no limiter. A project change ends it.';
// `abgeglichen` false: A/B runs but no level match was possible (silent range, difference over the limit); the title then says why
export function abAnzeige(lage) {
  const z = lage?.zustand ?? 'aus', text = lage?.text ? String(lage.text) : '';
  if (z === 'misst') return { knopf: 'MEASURING…', gedrueckt: false, seite: null, titel: text || 'Measuring the loop range with and without the master stages', abgeglichen: true };
  if (z === 'an' || z === 'veraltet') {
    return { knopf: 'A/B', gedrueckt: true, seite: lage.seite === 'a' || lage.seite === 'b' ? lage.seite : null, titel: text || AB_TITEL, abgeglichen: lage.abgeglichen !== false };
  }
  if (z === 'fehler') return { knopf: 'A/B', gedrueckt: false, seite: null, titel: text || AB_TITEL, abgeglichen: true };
  return { knopf: 'A/B', gedrueckt: false, seite: null, titel: AB_TITEL, abgeglichen: true };
}
// the project changed (another project, or another revision than the one measured): A/B ends
export const abEndet = (lage, p, wechsel) => !!lage?.an && (!!wechsel || !p || (lage.rev != null && p.rev !== lage.rev));

// one answer -> texts and flags; `alt` = { ueber, decke, ziel }. A stopped or absent meter shows dashes, a latched OVER stays latched.
export function meterZustand(j, alt) {
  const ueber = ueberNeu(alt.ueber, j?.tp_max_dbtp, alt.decke);
  if (!j || j.leer || j.steht) return { m: DASH, s: DASH, i: DASH, abstand: '', tp: DASH, korr: DASH, ueber: !!alt.ueber, leer: true };
  return { m: lufsText(j.lufs_m), s: lufsText(j.lufs_s), i: lufsText(j.lufs_i), abstand: abstandText(j.lufs_i, alt.ziel),
    tp: endlich(j.tp_max_dbtp) && j.tp_max_dbtp > -200 ? lufsText(j.tp_max_dbtp) : DASH,
    korr: korrText(j.korrelation), ueber, leer: false };
}

function gespeicherteWahl() {
  try { const t = localStorage.getItem(SPEICHER_SCHLUESSEL); return t ? JSON.parse(t) : null; } catch { return null; }
}

export function bindeMasterMeter(ctx) {
  const wurzel = ctx.$('mastermeter');
  if (!wurzel) return;
  const el = (k) => wurzel.querySelector(`[data-mm="${k}"]`);
  const b = (k) => el(k).querySelector('b');
  const zustand = { ueber: false, decke: 0, ziel: null };
  let laeuft = false, unterwegs = false, timer = null;
  let ab = null, abBusy = false, abTimer = null, abGen = 0;   // A/B: the last server state, a local command is running, poll timer, answer counter

  // target and ceiling are read at every update: the export dialog in the same view may have changed them
  function lieseZiel() {
    const g = gespeicherteWahl();
    zustand.decke = decke(g); zustand.ziel = zielLufs(g); ziel();
  }
  function zeige(j) {
    lieseZiel();
    const z = meterZustand(j, zustand);
    zustand.ueber = z.ueber;
    b('m').textContent = z.m; b('s').textContent = z.s; b('i').textContent = z.i;
    el('abstand').textContent = z.abstand; el('i').title = iTitel(z.leer ? null : j, zustand.ziel);
    b('tp').textContent = z.tp; b('korr').textContent = z.korr;
    const lufs = z.leer ? null : (j.lufs_s ?? j.lufs_m);
    el('balken').firstElementChild.style.width = `${(balkenAnteil(lufs) * 100).toFixed(1)}%`;
    el('ueber').hidden = !z.ueber;
    el('tp').classList.toggle('p-mm-heiss', !z.leer && endlich(j.tp_max_dbtp) && j.tp_max_dbtp > zustand.decke);
  }
  function ziel() {
    const t = el('ziel');
    t.hidden = zustand.ziel === null;
    if (zustand.ziel !== null) t.style.left = `${(balkenAnteil(zustand.ziel) * 100).toFixed(1)}%`;
  }
  async function runde() {
    timer = null;
    if (!laeuft || unterwegs) return;
    unterwegs = true;
    try { const r = await ctx.holeGet('/analyse/pegel'); zeige(r.status === 200 ? r.j : { leer: true }); }
    catch { zeige({ leer: true }); }
    unterwegs = false;
    if (laeuft) timer = setTimeout(runde, MM_MS);
  }
  const soll = () => !!ctx.st.sichtbar && document.visibilityState === 'visible';
  function abgleich() {
    if (soll() === laeuft) return;
    laeuft = soll();
    if (laeuft) {
      lieseZiel();
      abLies();   // the server may hold a running A/B (reload, second tab)
      if (timer === null && !unterwegs) runde();
    } else if (timer !== null) { clearTimeout(timer); timer = null; }
  }
  ctx.beimSichtwechsel.push(() => abgleich());
  // PLAY starts: measure the integrated loudness from here (once per change to status 2)
  let status = ctx.st.arr?.status;
  ctx.beimEreignis.push((a) => {
    if (a !== '/zustand/arr') return;
    const neu = ctx.st.arr?.status;
    if (playStart(status, neu)) ctx.holeJson('/analyse/pegel/reset', {});
    status = neu;
  });
  document.addEventListener('visibilitychange', abgleich);

  // A/B: the server holds the state; the page only sends the commands and shows the answer
  const zeigeAb = () => {
    const a = abAnzeige(abBusy ? { zustand: 'misst' } : ab);
    const k = el('ab');
    k.textContent = a.knopf; k.title = a.titel; k.disabled = abBusy; k.setAttribute('aria-pressed', String(a.gedrueckt));
    el('abseite').hidden = a.seite === null;
    k.classList.toggle('p-ab-ungleich', !a.abgeglichen);
    for (const s of ['a', 'b']) { el(s).setAttribute('aria-pressed', String(a.seite === s)); el(s).classList.toggle('an', a.seite === s); }
    abTakt();
  };
  // GET /proj/master_ab with a plain fetch (not ctx.holeGet): a failed answer must not raise OFFLINE. An answer that was overtaken by a command is dropped.
  async function abLies() {
    const gen = abGen;
    try {
      const r = await fetch('/proj/master_ab');
      if (r.status === 200) { const j = await r.json(); if (gen === abGen && !abBusy) ab = j; }
    } catch { /* keep the last state */ }
    zeigeAb();
  }
  // polls every second while the view is visible and the last known state is not off (a measurement, a running A/B)
  const abLaeuft = () => ab?.zustand === 'an' || ab?.zustand === 'veraltet' || ab?.zustand === 'misst';
  function abTakt() {
    if (abTimer !== null || !soll() || !abLaeuft()) return;
    abTimer = setTimeout(() => { abTimer = null; if (soll() && abLaeuft()) abLies(); }, 1000);
  }
  async function abSende(koerper, meldung = true) {
    abBusy = koerper.an === true; abGen++; zeigeAb();
    const r = await ctx.holeJson('/proj/master_ab', koerper);
    abBusy = false; abGen++;
    if (r.status === 200 && r.j) { ab = r.j; if (meldung && r.j.text) ctx.melde(r.j.text, r.j.zustand === 'fehler'); zeigeAb(); }
    else { ctx.melde(r.j?.text || ctx.antwortText(r), true); await abLies(); }   // the server may have ended A/B meanwhile: show what it holds
    return r;
  }
  el('ab').addEventListener('click', () => {
    if (abBusy) return;
    if (ab?.an) { abSende({ an: false }); return; }
    const l = ctx.st.projekt?.loop;
    abSende(l?.an ? { an: true, von_beat: l.von_beat, bis_beat: l.bis_beat } : { an: true });
  });
  for (const s of ['a', 'b']) el(s).addEventListener('click', () => { if (!abBusy && ab?.an) abSende({ seite: s }); });
  ctx.beimProjekt.push((p, wechsel) => {
    if (!abEndet(ab, p, wechsel)) return;
    ab = null; zeigeAb();
    abSende({ an: false }, false).then(() => { ab = null; zeigeAb(); ctx.melde('A/B ended: the project changed', false); });
  });
  zeigeAb();

  // vectorscope: own plain fetch (not ctx.holeGet): a failed answer must not raise OFFLINE; the last picture stays
  const VEKTOR = 160;
  let vOffen = false, vLaeuft = false, vUnterwegs = false, vTimer = null;
  const vSoll = () => vektorPollt(vOffen, soll());
  async function vRunde() {
    vTimer = null;
    if (!vLaeuft || vUnterwegs) return;
    vUnterwegs = true;
    try {
      const r = await fetch('/analyse/live');
      if (r.status === 200) {
        const j = await r.json();
        const g = el('vektorbild').getContext('2d');
        if (g) zeichneVektor(g, vektorPunkte(j?.vektor), VEKTOR, VEKTOR);
      }
    } catch { /* keep the last picture */ }
    vUnterwegs = false;
    if (vLaeuft) vTimer = setTimeout(vRunde, MM_MS);
  }
  function vAbgleich() {
    el('vektor').hidden = !vOffen;
    el('korr').setAttribute('aria-expanded', String(vOffen));
    if (vSoll() === vLaeuft) return;
    vLaeuft = vSoll();
    if (vLaeuft) { if (vTimer === null && !vUnterwegs) vRunde(); }
    else if (vTimer !== null) { clearTimeout(vTimer); vTimer = null; }
  }
  const vSetze = (e) => {
    const neu = vektorOffen(vOffen, e);
    if (neu && !vOffen) { try { const g = el('vektorbild').getContext('2d'); if (g) zeichneVektor(g, new Int8Array(0), VEKTOR, VEKTOR); } catch { /* no canvas */ } }
    vOffen = neu; vAbgleich();
  };
  el('korr').addEventListener('click', () => vSetze('klick'));
  el('korr').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vSetze('klick'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && vOffen) vSetze('escape'); });
  ctx.beimSichtwechsel.push(() => vAbgleich());
  document.addEventListener('visibilitychange', vAbgleich);

  el('ueber').addEventListener('click', () => { zustand.ueber = false; el('ueber').hidden = true; });
  el('reset').addEventListener('click', async () => {
    zustand.ueber = false; el('ueber').hidden = true;
    const r = await ctx.holeJson('/analyse/pegel/reset', {});
    zeige(r.status === 200 ? r.j : { leer: true });
  });
}
