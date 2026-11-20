// PRODUCTION: the parameter popover of one insert stage as a function (extracted from inserts.js, behaviour unchanged), and the floating popover the dock opens
// at a chip. baueStufenPopover(ctx, strang, insert, { liste }) -> { el, aktualisiere(p), zerstoere() } builds the rows of a utility, a plugin (its generic parameter
// list), a compressor (with the key select), a saturator, a limiter, an EQ, or the K rows of a Baukasten stage (liste: true; a Baukasten panel is the window's or
// the old row's business, see inserts.js and dock/window.js). bindeStufenPopover(ctx) sets ctx.oeffneStufenPopover(strang, insert, anker) -> { schliesse }:
// one floating popover at a time, position: fixed at the bottom left of the anchor, closed by its X, Escape, a click outside, a project switch or when its stage is gone.
// Every change goes through ctx.aendere (insert_param_setzen, coalesced per parameter), like the old rows did.
import {
  ARTEN, KOPF, BK_PARAMETER, EQ_BAENDER, EQ_BAND_PARAMETER, POS_MAX, bkZahl, eqBandName, freqVonPos, posVonFreq, parameterVon, wertText, paramBefehl, straenge,
  gemapptVon, rackWerte, makroWert,
} from './inserts.js';
import { baueParameterListe } from './plugin_parameter.js';
import { SC_EIGEN, schluesselGruppen, schluesselBefehl, schluesselWert, schluesselLabel } from './key_choice.js';

const zeileHtml = (art, q, name, beschriftung) => {
  const wahl = q.typ === 'wahl', schalter = q.typ === 'schalter';
  const titel = `Double click: ${wertText(art, name, q.vorgabe)}`;
  let steuer;
  if (schalter) steuer = `<input class="p-ins-param" data-param="${name}" type="checkbox">`;
  else if (wahl) steuer = `<select class="p-ins-param" data-param="${name}">${q.optionen.map((o, k) => `<option value="${k}">${o}</option>`).join('')}</select>`;
  else if (q.skala === 'log') steuer = `<input class="p-ins-param" data-param="${name}" data-skala="log" type="range" min="0" max="${POS_MAX}" step="1" title="${titel}">`;
  else steuer = `<input class="p-ins-param" data-param="${name}" type="range" min="${q.min}" max="${q.max}" step="${q.schritt}" title="${titel}">`;
  return `<label class="p-ins-zeile">${beschriftung}${steuer}<output class="p-ins-wert" data-param="${name}"></output></label>`;
};
// the value a control carries: a log slider maps its position, a checkbox is 0/1, everything else is the number in it
const lies = (r, q) => (r.type === 'checkbox' ? (r.checked ? 1 : 0) : r.dataset.skala === 'log' ? freqVonPos(Number(r.value), q) : Number(r.value));
const setze = (r, q, v) => {
  if (r.type === 'checkbox') r.checked = v >= 0.5;
  else if (r.dataset.skala === 'log') r.value = String(posVonFreq(v, q));
  else r.value = String(v);
};

const zustaende = new WeakMap();
/** The state every popover of one view shares: the sliders under the hand, the key options per stage, the graph list (knob rows and latencies of Baukasten graphs). */
export function stufenZustand(ctx) {
  let z = zustaende.get(ctx);
  if (z) return z;
  z = {
    greift: new Set(),        // `${insert}:${param}` while the hand is on a slider
    graphNamen: new Map(),    // graph name -> regler_namen (GET /graphen): how many knob rows a Baukasten popover shows
    graphLatenzen: {},        // graph name -> latency in samples (GET /graphen): counted in the strip latency (pdc.js)
    schl: new Map(),          // insert id -> {gruppen} (the server's key options of the stage) or {fehler} (why they are not available)
    ladeGraphNamen: null,
  };
  z.ladeGraphNamen = async () => {
    // a plain fetch: a missing list must neither throw nor change the connection state the project calls keep (holeGet does)
    let j = null;
    try { const r = await fetch('/graphen'); if (r.ok) j = await r.json(); } catch { /* no list: the popover shows k1..k8 */ }
    for (const g of j?.graphen ?? []) if (g && typeof g.name === 'string') { z.graphNamen.set(g.name, g.regler_namen); if (Number.isFinite(g.latenz)) z.graphLatenzen[g.name] = g.latenz; }
  };
  zustaende.set(ctx, z);
  return z;
}

export function baueStufenPopover(ctx, strang, i0, { liste = false } = {}) {
  const z = stufenZustand(ctx), { greift, graphNamen, schl } = z;
  const s = { id: strang.id, name: strang.name }, i = i0;
  const el = document.createElement('div');
  el.className = `p-ins-popover p-ins-${i.art}`; el.dataset.insert = i.id;
  let weg = false;
  const zerstoere = () => { weg = true; el.remove(); };
  if (i.art === 'host') {   // the generic parameter list of a plugin: its own module, the values live in the plugin
    const pfad = `/proj/insert/${encodeURIComponent(i.id)}`;
    baueParameterListe(el, { holeListe: () => ctx.holeGet(`${pfad}/parameter`), sende: (w) => ctx.holeJson(`${pfad}/param`, { werte: w }), fehler: (r) => ctx.melde(ctx.antwortText(r), true) });
    el.aktualisiere = () => {};
    return { el, aktualisiere: el.aktualisiere, zerstoere };
  }

  function baue() {
    const kopfZeilen = i.art === 'bk' ? BK_PARAMETER.slice(0, bkZahl(graphNamen.get(i.graph))) : KOPF[i.art];
    let html = kopfZeilen.map((q) => zeileHtml(i.art, q, q.name, q.label)).join('');
    if (i.art === 'komp') html += `<label class="p-ins-zeile">Key<select class="p-ins-sc" aria-label="Sidechain key of the compressor on ${s.name}"></select><output></output></label>`;
    if (i.art === 'eq') {
      for (let m = 1; m <= EQ_BAENDER; m++) {
        html += `<div class="p-ins-band" data-band="${m}"><span class="p-ins-band-kopf">Band ${m}</span>`
          + EQ_BAND_PARAMETER.map((q) => { const n = eqBandName(m, q.name); return zeileHtml('eq', parameterVon('eq', n), n, q.label); }).join('') + '</div>';
      }
    }
    const zu = el.querySelector(':scope > .p-ins-zu'), umschalter = el.querySelector(':scope > .p-ins-liste');   // what a caller put in front survives a rebuild
    el.innerHTML = html;
    if (umschalter) el.prepend(umschalter);
    if (zu) el.prepend(zu);
    for (const r of el.querySelectorAll('.p-ins-param')) {
      const name = r.dataset.param, k = `${i.id}:${name}`, q = parameterVon(i.art, name);
      const m = /^b([1-8])\//.exec(name);
      r.closest('.p-ins-zeile').dataset.name = name;
      r.setAttribute('aria-label', `${m ? `Band ${m[1]} ` : ''}${q.label} of the ${ARTEN[i.art].name} on ${s.name}`);
      const sende = () => {
        const v = lies(r, q);
        el.querySelector(`.p-ins-wert[data-param="${name}"]`).textContent = wertText(i.art, name, v);
        ctx.aendere(`${m ? `Band ${m[1]} ` : ''}${q.label} ${ARTEN[i.art].name} on ${s.name}`, [paramBefehl(i.id, name, v)], k);
      };
      const stetig = r.type === 'range';
      r.addEventListener(stetig ? 'input' : 'change', sende);
      if (stetig) {
        r.addEventListener('pointerdown', () => greift.add(k));
        r.addEventListener('change', () => greift.delete(k));
        r.addEventListener('pointerup', () => greift.delete(k));
        r.addEventListener('dblclick', () => { setze(r, q, q.vorgabe); sende(); greift.delete(k); });
      }
    }
    const sc = el.querySelector('.p-ins-sc');
    if (sc) {
      sc.addEventListener('change', (e) => ctx.aendere(`Key compressor on ${s.name}`, [schluesselBefehl(i.id, e.target.value)]));
      ladeOptionen();
    }
  }

  // the key options of one stage come from the server (every cell answered by its rules); the select shows the offline fallback until they arrive
  async function ladeOptionen() {
    schl.delete(i.id);
    const r = await ctx.holeGet(`/proj/routing?optionen=${encodeURIComponent(i.id)}`);
    const o = r.status === 200 ? r.j?.straenge?.flatMap((x) => x.stufen).find((x) => x.insert_id === i.id)?.optionen : null;
    schl.set(i.id, o ? { gruppen: schluesselGruppen(o, ctx.st.projekt) } : { fehler: `Key options not available: ${ctx.fehlerText(r)}` });
    const jetzt = straenge(ctx.st.projekt).flatMap((x) => x.inserts).find((x) => x.id === i.id);
    if (el.isConnected && jetzt) werte(el, s, jetzt, ctx.st.projekt);
  }

  function werte(e, st, ins, p) {
    e.panel?.aktualisiere();
    const str = straenge(p).find((x) => x.id === st.id), mw = rackWerte(str);
    for (const r of e.querySelectorAll('.p-ins-param')) {
      const name = r.dataset.param, q = parameterVon(ins.art, name);
      // slice 4c: a mapped parameter is driven by its macro; its own control is greyed and shows what the macro gives (Q4: the own row is ignored)
      const nr = gemapptVon(str, ins.id, name), zeile = r.closest('.p-ins-zeile');
      let v = ins.werte[name];
      if (nr !== null) { const zl = str.rack.makros[nr - 1].ziel.find((x) => x.insert === ins.id && x.param === name); v = makroWert(zl, mw[nr - 1]); }
      r.disabled = nr !== null;
      zeile.classList.toggle('gemappt', nr !== null);
      zeile.title = nr !== null ? `Driven by macro ${nr}${str.rack.namen?.[nr - 1] ? ` (${str.rack.namen[nr - 1]})` : ''} of the rack on ${st.name}: remove the mapping to use this control` : '';
      if (!greift.has(`${ins.id}:${name}`)) setze(r, q, v);
      e.querySelector(`.p-ins-wert[data-param="${name}"]`).textContent = (nr !== null ? `M${nr} ` : '') + wertText(ins.art, name, v);
    }
    const sc = e.querySelector('.p-ins-sc');
    if (!sc) return;
    const info = schl.get(ins.id), jetzt = schluesselWert(ins);
    // before the server answers (or when it cannot): own signal and the tracks' pre keys, the offline fallback
    let gr = info?.gruppen ?? [{ titel: 'Tracks', eintraege: [{ label: SC_EIGEN, wert: 'own', gesperrt: false },
      ...(p.spuren ?? []).map((x) => ({ label: `Track ${x.nr} ${x.name}`, wert: `spur:${x.nr}:pre`, gesperrt: false }))] }];
    // a stage whose key is not in the list (stored before the rules changed) still shows what it holds
    if (!gr.some((g) => g.eintraege.some((x) => x.wert === jetzt))) gr = [...gr, { titel: 'Current', eintraege: [{ label: schluesselLabel(jetzt, p), wert: jetzt, gesperrt: false }] }];
    const sig = JSON.stringify(gr);
    if (sc.dataset.sig !== sig) {
      sc.dataset.sig = sig; sc.textContent = '';
      for (const g of gr) {
        const og = document.createElement('optgroup'); og.label = g.titel;
        for (const x of g.eintraege) {
          const o = document.createElement('option'); o.value = x.wert; o.textContent = x.label; o.disabled = x.gesperrt; if (x.text) o.title = x.text;
          og.append(o);
        }
        sc.append(og);
      }
    }
    sc.value = jetzt;
    sc.disabled = !!info?.fehler;
    sc.closest('label').querySelector('output').textContent = info?.fehler ?? '';
  }

  baue();
  if (i.art === 'bk' && !graphNamen.has(i.graph)) {   // opens at once with the knobs known so far; the graph list rebuilds it with as many rows as the graph defines
    z.ladeGraphNamen().then(() => { if (!weg && el.isConnected && graphNamen.has(i.graph)) { baue(); aktualisiere(ctx.st.projekt); } });
  }
  function aktualisiere(p) {
    const str = straenge(p).find((x) => x.id === s.id), ins = str?.inserts.find((x) => x.id === i.id);
    if (str && ins) werte(el, s, ins, p);
  }
  el.aktualisiere = aktualisiere;
  return { el, aktualisiere, zerstoere };
}

/** Sets ctx.oeffneStufenPopover(strang, insert, anker) -> { schliesse } | null: the parameter popover of a stage, floating at the chip (anker). A second call for
 *  the stage that is open closes it; a call for another stage replaces it. */
export function bindeStufenPopover(ctx) {
  let offen = null;   // { insertId, strangId, pop, abbau }
  const zu = () => { const o = offen; offen = null; o?.abbau(); };
  ctx.oeffneStufenPopover = (strang, insert, anker) => {
    if (offen?.insertId === insert.id) { zu(); return null; }
    zu();
    const pop = baueStufenPopover(ctx, strang, insert, { liste: insert.art === 'bk' });
    const el = pop.el;
    el.classList.add('p-ins-schwebend');
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'p-ins-zu'; x.textContent = '✕';
    x.title = 'Close'; x.setAttribute('aria-label', `Close the parameters of ${insert.art === 'host' ? (insert.plugin?.name ?? 'Plugin') : ARTEN[insert.art]?.name ?? insert.art} on ${strang.name}`);
    x.addEventListener('click', zu);
    el.prepend(x);
    document.body.append(el);
    // at the bottom left of the chip, moved into the window like the context menu; without an anchor (a stage just added from the + menu) at the dock
    const ref = (anker ?? ctx.$?.('dock-wurzel'))?.getBoundingClientRect?.();
    el.style.left = `${ref ? ref.left : 16}px`; el.style.top = `${ref ? ref.bottom + 2 : 60}px`;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
    pop.aktualisiere(ctx.st.projekt);
    const aussen = (e) => {
      if (e.type === 'keydown') { if (e.key === 'Escape') zu(); return; }
      if (el.contains(e.target) || anker?.contains?.(e.target)) return;   // the chip toggles itself
      zu();
    };
    window.addEventListener('pointerdown', aussen, true); window.addEventListener('keydown', aussen, true);
    const abbau = () => { window.removeEventListener('pointerdown', aussen, true); window.removeEventListener('keydown', aussen, true); pop.zerstoere(); };
    offen = { insertId: insert.id, strangId: strang.id, pop, abbau };
    return { schliesse: () => { if (offen?.pop === pop) zu(); } };
  };
  ctx.beimProjekt.push((p, wechsel) => {
    if (!offen) return;
    if (!p || wechsel) { zu(); return; }
    const s = straenge(p).find((x) => x.id === offen.strangId);
    if (!s || !s.inserts.some((x) => x.id === offen.insertId)) { zu(); return; }   // the stage is gone
    offen.pop.aktualisiere(p);
  });
}
