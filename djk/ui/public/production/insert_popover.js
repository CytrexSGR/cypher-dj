// PRODUCTION: the parameter popover of one insert stage as a function (extracted from inserts.js, behaviour unchanged), and the floating popover the dock opens
// at a chip. baueStufenPopover(ctx, strang, insert, { liste }) -> { el, aktualisiere(p), zerstoere() } builds the rows of a utility, a gate, a multiband (grouped by band), a transient shaper, an imager, a plugin (its generic parameter
// list), a compressor (with the key select), a saturator, a limiter, an EQ, or the K rows of a Baukasten stage (liste: true; a Baukasten panel is the window's or
// the old row's business, see inserts.js and dock/window.js). bindeStufenPopover(ctx) sets ctx.oeffneStufenPopover(strang, insert, anker) -> { schliesse }:
// one floating popover at a time, position: fixed at the bottom left of the anchor, closed by its X, Escape, a click outside, a project switch or when its stage is gone.
// Every change goes through ctx.aendere (insert_param_setzen, coalesced per parameter), like the old rows did.
import {
  ARTEN, KOPF, BK_PARAMETER, EQ_BAENDER, EQ_BAND_PARAMETER, MB_BAENDER, MB_BAND_PARAMETER, bandText, mbBandName, POS_MAX, bkZahl, eqBandName, freqVonPos, posVonFreq, parameterVon, wertText, paramBefehl, straenge,
  gemapptVon, rackWerte, makroWert,
} from './inserts.js';
import { baueParameterListe } from './plugin_parameter.js';
import { PLUGIN_ZIEL } from './lanes.js';
import { baueModFeld, insertModZiel, pluginModZiel, pluginModIndizes, modKnopfZustand } from './mod_line.js';
import { SC_EIGEN, schluesselGruppen, schluesselBefehl, schluesselWert, schluesselLabel, hostHatSchluessel, ohneSpurPre } from './key_choice.js';

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
  // strand 6 task 4.4: the modulator controls of the target the last "Mod" button chose (a row button creates the modulator, a second click hides the controls)
  const modFeld = baueModFeld({ aendere: (...a) => ctx.aendere(...a), projekt: () => ctx.st.projekt, strangId: strang.id, art: strang.art });
  if (i.art === 'host') {   // the generic parameter list of a plugin: its own module, the values live in the plugin
    const pfad = `/proj/insert/${encodeURIComponent(i.id)}`;
    // "Lane" button per row: creates the lane `plugin.<stage id>.<index>` on this strip with the current value as its first point, then shows it
    const anlegen = async (index, wert) => {
      const ziel = `plugin.${i.id}.${index}`;
      const punkte = [{ beat: 0, wert: Number(wert) || 0, form: 'linear' }];
      const ok = await ctx.aendere(`Lane ${ziel} on ${s.name}`, [{ befehl: 'auto_neu', strang_id: s.id, ziel, punkte }]);
      if (ok !== false) ctx.waehle?.(s.id, ziel);
      return ok;
    };
    const pl = baueParameterListe(el, { holeListe: () => ctx.holeGet(`${pfad}/parameter`), sende: (w) => ctx.holeJson(`${pfad}/param`, { werte: w }),
      fehler: (r) => ctx.melde(ctx.antwortText(r), true), lane: { insertId: i.id, anlegen },
      mod: { zustand: (index) => modKnopfZustand(ctx.st.projekt, s.id, pluginModZiel(i.id, index)), knopf: (index) => modFeld.knopf(pluginModZiel(i.id, index)) },
      midi: { lernen: (index) => ctx.holeJson(`${pfad}/lernen`, { index }), loeschen: (index) => ctx.holeJson(`${pfad}/lernen/loeschen`, { index }) } });
    // strand 2 task 3.5: the key row of a host stage; the plugin's index entry (GET /plugins) says whether it has a key input (4 or more audio inputs)
    el.prepend(modFeld.el);
    const zeile = document.createElement('label'); zeile.className = 'p-ins-zeile p-ins-hostkey';
    zeile.append('Key');
    const sel = document.createElement('select'); sel.className = 'p-ins-sc'; sel.setAttribute('aria-label', `Sidechain key of the plugin on ${s.name}`);
    const aus = document.createElement('output'); zeile.append(sel, aus); el.prepend(zeile);
    let hk = { zustand: 'laedt', gruppen: [] };
    const zeichneKey = (p) => {
      const ins = straenge(p).flatMap((x) => x.inserts).find((x) => x.id === i.id);
      sel.hidden = hk.zustand !== 'ja';
      if (hk.zustand !== 'ja') { aus.textContent = hk.zustand === 'laedt' ? '' : hk.zustand === 'nein' ? 'No key input' : hk.zustand; return; }
      const jetzt = schluesselWert(ins);
      let gr = hk.gruppen;
      if (!gr.some((g) => g.eintraege.some((x) => x.wert === jetzt))) gr = [...gr, { titel: 'Current', eintraege: [{ label: schluesselLabel(jetzt, p), wert: jetzt, gesperrt: false }] }];
      const sig = JSON.stringify(gr);
      if (sel.dataset.sig !== sig) {
        sel.dataset.sig = sig; sel.textContent = '';
        for (const g of gr) {
          const og = document.createElement('optgroup'); og.label = g.titel;
          for (const x of g.eintraege) {
            const o = document.createElement('option'); o.value = x.wert; o.textContent = x.label; o.disabled = x.gesperrt; if (x.text) o.title = x.text;
            og.append(o);
          }
          sel.append(og);
        }
      }
      sel.value = jetzt; aus.textContent = '';
    };
    sel.addEventListener('change', (e) => ctx.aendere(`Key plugin on ${s.name}`, [schluesselBefehl(i.id, e.target.value)]));
    (async () => {
      const pr = await ctx.holeGet(`/plugins?${new URLSearchParams({ text: '', art: '', format: i.plugin?.format ?? '' })}`);
      const liste = Array.isArray(pr.j) ? pr.j : pr.j?.plugins;
      if (weg) return;
      if (pr.status !== 200 || !Array.isArray(liste)) hk = { zustand: 'Key input not known' };
      else if (!hostHatSchluessel(liste, i.plugin)) hk = { zustand: 'nein' };
      else {
        const r = await ctx.holeGet(`/proj/routing?optionen=${encodeURIComponent(i.id)}`);
        const o = r.status === 200 ? r.j?.straenge?.flatMap((x) => x.stufen).find((x) => x.insert_id === i.id)?.optionen : null;
        hk = o ? { zustand: 'ja', gruppen: ohneSpurPre(schluesselGruppen(o, ctx.st.projekt)) } : { zustand: `Key options not available: ${ctx.fehlerText(r)}` };
      }
      if (!weg && el.isConnected) zeichneKey(ctx.st.projekt);
    })();
    // the project says which parameters of this stage have a lane
    el.aktualisiere = (p) => {
      zeichneKey(p);
      modFeld.zeige();
      pl.setzeMods(pluginModIndizes(p, s.id, i.id));
      const st = [...(p?.spuren ?? []), ...(p?.gruppen ?? []), ...(p?.returns ?? []), ...(p?.master ? [p.master] : [])].find((x) => x.id === s.id);
      pl.setzeLanen((st?.automation ?? []).flatMap((l) => { const m = PLUGIN_ZIEL.exec(l.ziel ?? ''); return m && m[1] === i.id ? [Number(m[2])] : []; }));
    };
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
    if (i.art === 'mb') {   // the three bands as groups: b1 Low, b2 Mid, b3 High
      for (let m = 1; m <= MB_BAENDER; m++) {
        html += `<div class="p-ins-band" data-band="${m}"><span class="p-ins-band-kopf">${bandText('mb', m)}</span>`
          + MB_BAND_PARAMETER.map((q) => { const n = mbBandName(m, q.name); return zeileHtml('mb', parameterVon('mb', n), n, q.label); }).join('') + '</div>';
      }
    }
    const zu = el.querySelector(':scope > .p-ins-zu'), umschalter = el.querySelector(':scope > .p-ins-liste');   // what a caller put in front survives a rebuild
    el.innerHTML = html;
    if (umschalter) el.prepend(umschalter);
    el.prepend(modFeld.el);
    if (zu) el.prepend(zu);
    for (const r of el.querySelectorAll('.p-ins-param')) {
      const name = r.dataset.param, k = `${i.id}:${name}`, q = parameterVon(i.art, name);
      const m = /^b([1-8])\//.exec(name), bt = m ? bandText(i.art, Number(m[1])) : '';
      r.closest('.p-ins-zeile').dataset.name = name;
      r.setAttribute('aria-label', `${bt ? `${bt} ` : ''}${q.label} of the ${ARTEN[i.art].name} on ${s.name}`);
      const sende = () => {
        const v = lies(r, q);
        el.querySelector(`.p-ins-wert[data-param="${name}"]`).textContent = wertText(i.art, name, v);
        ctx.aendere(`${bt ? `${bt} ` : ''}${q.label} ${ARTEN[i.art].name} on ${s.name}`, [paramBefehl(i.id, name, v)], k);
      };
      const stetig = r.type === 'range';
      const modZiel = insertModZiel(i, name, q);   // a continuous parameter of a built-in stage: a Mod button at its row
      if (modZiel) {
        const mb = document.createElement('button');
        mb.type = 'button'; mb.className = 'p-ins-mod'; mb.textContent = 'Mod'; mb.dataset.ziel = modZiel;
        mb.setAttribute('aria-label', `Modulate ${q.label} of the ${ARTEN[i.art].name} on ${s.name}`);
        mb.addEventListener('click', () => { modFeld.knopf(modZiel).then(() => modKnoepfe()); });
        r.closest('.p-ins-zeile').append(mb);
      }
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

  // the state of the row buttons from the project (active = the parameter has a modulator)
  function modKnoepfe() {
    modFeld.zeige();
    for (const b of el.querySelectorAll('.p-ins-mod')) {
      const z = modKnopfZustand(ctx.st.projekt, s.id, b.dataset.ziel);
      b.classList.toggle('an', z.aktiv); b.setAttribute('aria-pressed', String(z.aktiv)); b.disabled = z.gesperrt || b.closest('.p-ins-zeile')?.classList.contains('gemappt'); b.title = z.titel;
    }
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
    modKnoepfe();
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
