// MIDI learn state and the knob bindings of the effect graphs.
import { hostLernStand, hostLernAnfrage } from './host_adapter.js';
import { lernPfadVon } from './instruments_view.js';
import { lernKnopfHtml, lernStand, bkKnobListe, bkKnobHtml, htmlText, kennlinienPfad } from './effects.js';
import { SURGE_GRUPPE, baueHostBereich, baueKnobsNeu, feldModus, graphMitBereich, graphVon, hostZeile, kanalAdapter, kopfHandles, panelKopf, panelVon } from './graphs_view.js';
import { $, $$, melde, postJson, zustand } from './page_state.js';
import { kompWert, platteBauen } from './effects_gemeinsam.js';
import { KOMP_DETAIL, fxGewaehlt } from './effects_view.js';
// S19 (MIDI learn): the learn table as the page server reports it (GET /lernen); the buttons next to the graph knobs follow it
export let lernen = { zuordnungen: [], wartet: null, midi: { port: null }, datei: 'fehlt' };
export const lernModus = new Set();   // channels whose panel has the LEARN toggle on
// Host learn: the host parameters mapped onto slot rows (GET /lernen/host ziele: {pfad, kanal, name, gelernt}). A host panel control has the key `<kanal>/host/<name>`
// (adapter.lernPfad); the slot row `<kanal>/bk/<n>` is what the controller is learned onto.
let hostLernen = [];
const hostLernStandVon = (k) => hostLernStand(hostLernen, lernen.wartet?.pfad, k, lernModus.has(k));
/** LEARN options of a host panel: a click on a control arms (again: cancels) host learn, a right click forgets it; the header only has the LEARN toggle. */
export function hostLernOpt(k) {
  return {
    lernen: hostLernStandVon(k),
    beiLernen: (schluessel) => { const a = hostLernAnfrage(schluessel, hostLernen, lernen.wartet?.pfad); lernSchicken(a.pfad, a.daten); },
    beiVergessen: (schluessel) => lernSchicken('/lernen/host/loeschen', hostZiel(schluessel)),
    kopf: (kopfEl, info) => {
      if (!info?.lernen) return;
      const zeichne = () => {
        const an = lernModus.has(k);
        kopfEl.innerHTML = `<div class="fp-presetzeile"><button type="button" class="fp-knopf-klein${an ? ' an' : ''}" data-fp-lernen aria-pressed="${an}" title="MIDI learn: click a control, then move a knob on your controller (right click forgets)">LEARN</button></div>`;
      };
      kopfEl.addEventListener('click', (e) => { if (e.target?.closest?.('[data-fp-lernen]')) lernModusUmschalten(k); });
      kopfHandles.set(k, { neu: zeichne });
      zeichne();
    },
  };
}
/** What a panel needs to mark its controls: the mode of its channel, the armed path, every assigned path. */
const panelLernStand = (k) => ({ an: lernModus.has(k), wartet: lernen.wartet?.pfad ?? null, gelernt: new Set(lernen.zuordnungen.map((z) => z.pfad)) });
// An armed learn on a channel that is no longer in front is cancelled (tab switch, leaving INSTRUMENTS).
export function lernAbbrechenFuer(k) { if (k && lernPfadVon(lernen.wartet?.pfad, k)) lernSchicken('/lernen', { pfad: null }); }
export function lernModusUmschalten(k) {
  if (lernModus.has(k)) {
    lernModus.delete(k);
    if (lernen.wartet?.pfad?.startsWith(`${k}/bk/`)) lernSchicken('/lernen', { pfad: null });
  } else lernModus.add(k);
  zeigeLernen();
}
function setzeLernen(neu) {
  if (!neu || !Array.isArray(neu.zuordnungen)) return;
  lernen = neu;
  zeigeLernen();
}
function zeigeLernen() {
  for (const platz of $$('[data-lern-platz]')) {
    const pfad = platz.dataset.lernPlatz;
    platz.innerHTML = lernKnopfHtml(pfad, lernStand(lernen.zuordnungen, pfad), { midi: !!lernen.midi?.port, wartet: lernen.wartet?.pfad ?? null });
  }
  for (const liste of $$('.bkliste')) {   // front panels follow too
    if (liste._fp && liste._fpHostKanal) liste._fp.setzeLernen(hostLernStandVon(liste._fpHostKanal));
    else if (liste._fp && liste._fpKanal) liste._fp.setzeLernen(panelLernStand(liste._fpKanal));
  }
  for (const h of kopfHandles.values()) h.neu();   // the LEARN toggles (aria-pressed) follow lernModus, also when it changed outside the header
}
export async function holeLernen() {
  try { hostLernen = (await (await fetch('/lernen/host')).json())?.ziele ?? []; } catch { /* the host marks keep what they had */ }
  try { setzeLernen(await (await fetch('/lernen')).json()); } catch { /* the page server is gone: the buttons keep what they had */ }
}
export async function lernSchicken(pfad, daten) {
  let r;
  try { r = await postJson(pfad, daten); } catch (e) { melde(`Learn not sent: ${e.message}`, true); return; }
  window.djkGesendet.push({ lernen: { pfad, daten }, code: r.code, antwort: r.j });
  if (!r.ok) {
    if (r.code === 409 && r.j?.fehler === 'kein_midi_eingang') { lernModus.clear(); zeigeLernen(); melde('No MIDI input is connected: plug in your controller, then try LEARN again', true); return; }
    melde(`Learn refused: ${r.j?.text ?? r.j?.fehler ?? r.code}`, true); holeLernen(); return;
  }
  setzeLernen(r.j);
  if (pfad.startsWith('/lernen/host')) holeLernen();   // the host mappings changed (the answer is {pfad}, not the learn table)
}
const LERN_MELDUNG = {
  fertig: (f) => [`Learned: ${f.pfad} follows CC${f.nr} ch${f.kanal}`, false],
  geloescht: (f) => [`MIDI assignment of ${f.pfad} removed`, false],
  belegt: (f) => [`CC${f.nr} ch${f.kanal} already drives a knob of the base mapping; nothing changed`, true],
  hand_in: (f) => [f.text, true],
  abgelaufen: (f) => [`Learn timed out for ${f.pfad}`, true],
  abbrechen: () => ['', false],
  abgelehnt: (f) => [`The core refused the learn table (${f.grund}); the previous table is kept`, true],
  ohne_antwort: () => ['Learn table saved; the core did not answer yet, it loads it at its next start', true],
};
export function lernEreignis(f) {
  const m = LERN_MELDUNG[f?.stand];
  if (m) { const [text, fehler] = m(f); if (text) melde(text, fehler); }
  holeLernen();
}
// S5r: graph knobs <channel>/bk/1..64 over POST /regler (set at once, the engine smooths 20 ms); actual value from the control state
export function bindeBkKnobs(d, k) {
  const liste = d.querySelector('.bkliste');
  if (!liste) return;
  const info = panelVon(graphVon(k)?.name);
  liste._fp = null;
  liste._fpHostKanal = null;
  liste.classList.remove('mit-platte');
  if (!graphVon(k) && SURGE_GRUPPE[k]) { baueHostBereich(liste, k).catch((e) => { if (liste.isConnected) hostZeile(liste, `The instrument area failed: ${e.message}`, () => baueKnobsNeu()); }); return; }   // no graph here: the host on the channel decides what is shown
  const umbauen = (aus) => { if (aus) feldModus.add(k); else feldModus.delete(k); baueKnobsNeu(); };
  if (info && !feldModus.has(k)) {   // a front panel instead of the eight sliders
    liste.classList.add('mit-platte');
    const adapter = kanalAdapter(k);
    liste._fpKanal = k;
    liste._fp = platteBauen(liste, { panel: info.panel, regler: info.regler, adapter, lernen: panelLernStand(k),
      beiLernen: (pfad) => lernSchicken('/lernen', { pfad: lernen.wartet?.pfad === pfad ? null : pfad }),   // a second click on the armed control cancels
      beiVergessen: (pfad) => lernSchicken('/lernen/loeschen', { pfad }),
      kopf: panelKopf(k, graphVon(k).name, info.panel.title ?? graphVon(k).name, adapter),
      umschalter: { text: 'Sliders', beiKlick: (e) => { e.currentTarget.blur(); umbauen(true); } } });
    return;
  }
  liste.innerHTML = (info ? '<div class="bkzeile"><button type="button" class="fp-umschalter" data-fp-panel>Panel</button></div>' : '')
    + bkKnobListe(k, zustand.regler, { graph: graphMitBereich(k) })
    .map((x) => `<div class="bkzeile">${bkKnobHtml(x, k)}<span data-lern-platz="${htmlText(x.pfad)}"></span></div>`).join('');   // names from a graph file: escaped in bkKnobHtml
  liste.querySelector('[data-fp-panel]')?.addEventListener('click', (e) => { e.currentTarget.blur(); umbauen(false); });
  zeigeLernen();
  for (const inp of liste.querySelectorAll('input[data-bk]')) {
    let warte = null;
    inp.addEventListener('input', () => {
      inp.nextElementSibling.textContent = Number(inp.value).toFixed(2);
      if (warte) return;
      warte = setTimeout(async () => {
        warte = null;
        let a;
        try { a = await postJson('/regler', { pfad: inp.dataset.bk, nach: Number(inp.value), ab: 'jetzt' }); } catch (e) { melde(`Knob not sent: ${e.message}`, true); return; }
        if (!a.ok) melde(`Knob refused: ${a.j?.text ?? a.j?.fehler ?? a.code}`, true);
      }, 40);
    });
  }
}
// S14: knobs of the send returns; rebuilt when the graph (and so the knob names) changes, values refreshed from /e/regler
export function baueSendKnobs() {
  // the guard sits on the knob area, not on the whole row: the graph picker in the same row keeps focus after a pick and must not hold back the new panel
  for (const z of $$('.sendzeile[data-kanal]')) if (!z.querySelector('.bkliste')?.contains(document.activeElement)) bindeBkKnobs(z, z.dataset.kanal);
}
export function zeigeSendKnobs() { for (const z of $$('.sendzeile[data-kanal]')) zeigeBkKnobs(z, z.dataset.kanal); }
function zeigeBkKnobs(d, k) {
  const fp = d.querySelector('.bkliste')?._fp;
  if (fp) { fp.aktualisiere(); return; }   // the panel skips controls that are dragged or were just moved
  for (const x of bkKnobListe(k, zustand.regler, { graph: graphMitBereich(k) })) {
    const inp = d.querySelector(`input[data-bk="${x.pfad}"]`);
    if (!inp || document.activeElement === inp) continue;
    inp.value = String(x.wert);
    inp.nextElementSibling.textContent = x.wert.toFixed(2);
  }
}
export function zeigeFxDetail() {
  const d = $('#fxdetail');
  if (!d || !d.firstChild) return;
  const k = fxGewaehlt;
  const an = kompWert(k, 'an', 0) >= 0.5;
  const b = d.querySelector('.komp-an');
  b.classList.toggle('an', an);
  b.setAttribute('aria-pressed', String(an));
  for (const r of KOMP_DETAIL) {
    const inp = d.querySelector(`input[data-komp-feld="${r.feld}"]`);
    const w = kompWert(k, r.feld, r.vorgabe);
    if (document.activeElement !== inp) inp.value = String(w);
    inp.nextElementSibling.textContent = r.text(w);
  }
  const sl = d.querySelector('.schluessel');
  if (sl && document.activeElement !== sl) sl.value = String(kompWert(k, 'sc', 0));
  zeigeBkKnobs(d, k);
  const t = kompWert(k, 'schwelle', -18), ra = kompWert(k, 'ratio', 4), mu = kompWert(k, 'makeup', 0);
  d.querySelector('.kurve').setAttribute('d', kennlinienPfad(t, ra, mu, 240, 168));
  const sx = ((t + 60) / 60) * 240;
  const s = d.querySelector('.schwelle');
  s.setAttribute('x1', sx); s.setAttribute('x2', sx); s.setAttribute('y1', 0); s.setAttribute('y2', 168);
}
