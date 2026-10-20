// PRODUCTION (D1 V2): FREEZE im Spurkopf jeder Wirt-Spur und EXPORT in der Transportleiste (Spec 2.5, 3.4: POST /proj/freeze
// {spur_id, an} → {rev, projekt}; POST /proj/export {} → {datei, frames, spitze_db, …}, Vorgabe Loop-Klammer; Paket S3).
// Beides sind lange Anfragen (ein Freeze ist ein Echtzeit-Durchlauf): währenddessen ist jeder weitere Lauf gesperrt, die
// Transportleiste zeigt Phase, Takt (aus /zustand/arr status 3) und Sekunden, danach das Ergebnis oder den Grund.
// Der Schalter wird in den vorhandenen Spurkopf (spurkoepfe.js) eingesetzt, nicht in dessen Vorlage: V1 bleibt unverändert.
import { freezeKnopf, laufText, ergebnisText, ausgabeFehler } from './ausgabe.js';

export function bindeAusgabe(ctx) {
  const { st, $ } = ctx;
  const gruppe = document.createElement('div');
  gruppe.className = 'p-gruppe p-ausgabe';
  gruppe.innerHTML = '<button data-p="export" title="Export the loop bracket as a WAV file (48 kHz, 32 bit float); Surge tracks are frozen first" disabled>EXPORT</button>'
    + '<output data-p="ausgabe" class="p-ausgabe-text" aria-live="polite"></output>';
  $('meldung').before(gruppe);
  st.lauf = null;            // { art: 'freeze'|'export', spur_id?, name?, an?, seit } während einer Anfrage (seit: Start dieser Seite, performance.now())
  // V2 Fix F14 (Spec 6.34): ein Lauf, den diese Seite nicht selbst gestartet hat (Reload mitten im Lauf, eine zweite Seite, Cypher), aus
  // GET /proj/aktuell ausgabe_lauf; er sperrt FREEZE und EXPORT wie ein eigener und wird nachgefragt, bis er endet
  st.fremdLauf = null;
  const laufJetzt = () => st.lauf ?? st.fremdLauf;
  let frage = 0;
  ctx.ausgabeLauf = (x) => {
    clearTimeout(frage);
    if (!x || (x.art !== 'freeze' && x.art !== 'export') || st.lauf) { if (st.fremdLauf) { st.fremdLauf = null; knoepfe(); } return; }
    const s = x.art === 'freeze' ? st.projekt?.spuren.find((y) => y.id === x.spur_id) : null;
    const gleich = st.fremdLauf && st.fremdLauf.art === x.art && st.fremdLauf.spur_id === x.spur_id;
    st.fremdLauf = gleich ? st.fremdLauf : { art: x.art, ...(x.art === 'freeze' ? { spur_id: x.spur_id, name: s?.name ?? x.spur_id, an: !s?.freeze } : {}), seit: null };   // H3: kein Start bekannt
    knoepfe();
    frage = setTimeout(() => ctx.ladeAktuell(), 500);
  };
  st.exportErgebnis = null;  // letzte Antwort von /proj/export

  function knoepfe() {
    $('export').disabled = !st.projekt || !!laufJetzt();
    for (const s of st.projekt?.spuren ?? []) {
      const kopf = $('koepfe').querySelector(`.p-kopf[data-spur="${CSS.escape(s.id)}"]`);
      if (!kopf) continue;
      let k = kopf.querySelector('.p-freeze');
      if (s.geraet?.art !== 'wirt') { k?.remove(); delete kopf.dataset.wirt; continue; }
      if (!k) {
        k = document.createElement('button');
        k.className = 'p-freeze'; k.textContent = '❄';
        k.addEventListener('click', () => schalte(s.id));
        kopf.append(k); kopf.dataset.wirt = '1';
      }
      const z = freezeKnopf(s, laufJetzt());
      k.classList.toggle('an', z.an); k.classList.toggle('laeuft', z.laeuft);
      k.disabled = z.gesperrt; k.title = z.titel;
      k.setAttribute('aria-pressed', String(z.an)); k.setAttribute('aria-label', z.label);
    }
  }
  async function lauf(art, weg, koerper, extra) {
    const slug = st.slug;
    st.lauf = { art, seit: performance.now(), ...extra };
    if (art === 'export') st.exportErgebnis = null;
    knoepfe();
    const r = await ctx.holeJson(weg, koerper);
    st.lauf = null; st.fremdLauf = null;
    knoepfe();
    if (r.status !== 200) { ctx.melde(ausgabeFehler(r, ctx.antwortText), true); return null; }   // V2 Fix F3: 5xx ohne Grund wie der Schreibweg
    return st.slug === slug ? r.j : null;    // anderes Projekt geöffnet: die Antwort gehört nicht mehr hierher
  }
  async function schalte(spurId) {
    const s = st.projekt?.spuren.find((x) => x.id === spurId);
    if (!s || laufJetzt()) return;
    const an = !s.freeze;
    const j = await lauf('freeze', '/proj/freeze', { spur_id: spurId, an }, { spur_id: spurId, name: s.name, an });
    if (j?.projekt) { ctx.uebernimm(st.slug, j.projekt); ctx.melde(`${s.name} ${an ? 'frozen' : 'unfrozen'}`); }
  }
  $('export').addEventListener('click', async () => {
    if (!st.projekt || laufJetzt()) return;
    const j = await lauf('export', '/proj/export', {}, {});
    if (j && typeof j.datei === 'string') { st.exportErgebnis = j; ctx.melde('Export finished'); }
  });

  let letzter = null;
  ctx.vorBild.push((t0) => {
    const l = laufJetzt();
    const e = l ? { text: laufText(l, st.arr, t0), titel: '', warnung: false } : st.exportErgebnis ? ergebnisText(st.exportErgebnis) : { text: '', titel: '', warnung: false };
    const schluessel = `${e.text}|${e.titel}|${e.warnung}`;
    if (schluessel === letzter) return;
    letzter = schluessel;
    const o = $('ausgabe');
    o.textContent = e.text; o.title = e.titel; o.classList.toggle('warnung', e.warnung);
  });
  ctx.beimProjekt.push((p, wechsel) => { if (wechsel) st.exportErgebnis = null; knoepfe(); });
}
