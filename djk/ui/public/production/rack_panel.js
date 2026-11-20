// PRODUCTION: the rack panel of a strip (four macro knobs, the mapping editor, the variations), extracted from inserts.js with its behaviour unchanged.
// baueRackPanel(ctx, strang) -> { el, aktualisiere(strang) } builds the panel; aktualisiere(strang) shows the live macro values (a knob under the hand keeps its
// position). bindeRackFenster(ctx) sets ctx.oeffneRack(strang): the same panel in a floating window of the dock (ctx.fenster), rebuilt when the strip's rack or chain
// changed and refreshed on every project; it closes with its strip, with a project switch (window.js) and when the strip has no stage left.
// Every change goes through ctx.aendere (rack_makro coalesced per macro, rack_setzen, variation commands), like the old row did.
import {
  ARTEN, MAX_MAKROS, MAX_MAKRO_ZIELE, MAKRO_NAME_MAX, MAX_VARIATIONEN, VARIATION_NAME_MAX, straenge, hatRack, parameterVon, parameterLabel, rackLabels, rackMakros,
  rackWerte, rackZiele, freieZiele, freieGliedZiele, gliedZiele, gliedZielBereich, zielHinzu, zielHinzuGlied, zielWeg, zielWerte, makroName, rackSetzenBefehl,
  rackMakroBefehl, rackVariationen, variationBefehl,
} from './inserts.js';
import { stufenZustand } from './insert_popover.js';

// ---- the rack panel of a strip (slice 4c) ---------------------------------------------------------------------------------------------------
const rackAendere = (ctx, s, label, makros) => { if (makros) ctx.aendere(label, [rackSetzenBefehl(s.id, makros)]); };
function rackPanel(ctx, greift, s) {
  const el = document.createElement('div');
  el.className = 'p-ins-popover p-rack'; el.dataset.strang = s.id;
  const L = rackLabels(s.name), makros = rackMakros(s), frei = freieZiele(s), freiGlied = freieGliedZiele(s), voll = rackZiele(s) >= MAX_MAKRO_ZIELE;
  for (let nr = 1; nr <= MAX_MAKROS; nr++) {
    const m = makros[nr - 1], b = document.createElement('div');
    b.className = 'p-makro p-ins-band'; b.dataset.makro = String(nr);
    b.innerHTML = '<div class="p-makro-kopf"><input class="p-makro-name" type="text" maxlength="' + MAKRO_NAME_MAX + '" placeholder="Macro ' + nr + '">'
      + '<input class="p-makro-regler" type="range" min="0" max="1" step="0.001" title="Double click: 0"><output class="p-ins-wert p-makro-wert"></output></div>'
      + '<div class="p-makro-ziele"></div><div class="p-makro-neu"><select class="p-ziel-wahl"></select><button class="p-ziel-neu">+ Map</button></div>';
    const q = (x) => b.querySelector(x);
    q('.p-makro-name').value = m.name; q('.p-makro-name').setAttribute('aria-label', L.name(nr));
    const regler = q('.p-makro-regler'), kk = `rack:${s.id}:${nr}`;
    regler.setAttribute('aria-label', L.regler(nr, m.name)); regler.disabled = !s.rack;
    const sende = () => {
      q('.p-makro-wert').textContent = `${Math.round(Number(regler.value) * 100)} %`;
      ctx.aendere(`${m.name || `Macro ${nr}`} on ${s.name}`, [rackMakroBefehl(s.id, nr, Number(regler.value))], kk);
    };
    regler.addEventListener('input', sende);
    regler.addEventListener('pointerdown', () => greift.add(kk));
    regler.addEventListener('change', () => greift.delete(kk));
    regler.addEventListener('pointerup', () => greift.delete(kk));
    regler.addEventListener('dblclick', () => { regler.value = '0'; sende(); greift.delete(kk); });
    q('.p-makro-name').addEventListener('change', (e) => rackAendere(ctx, s, `Name macro ${nr} on ${s.name}`, makroName(rackMakros(ctx.st.projekt && straenge(ctx.st.projekt).find((x) => x.id === s.id)), nr, e.target.value.trim())));
    m.ziel.forEach((z, k) => {
      // the two target kinds: a stage parameter (insert) or a member parameter (glied, 1.9 U8 T11); pq = {min, max, einheit, schritt}, t = the row text
      let pq, t;
      if ('glied' in z) {
        pq = gliedZielBereich(s, z.glied, z.param);
        const gl = gliedZiele(s).find((x) => x.glied === z.glied && x.param === z.param);
        if (!pq || !gl) return;
        t = gl.text;
      } else {
        const st = s.inserts.findIndex((x) => x.id === z.insert), stufeX = s.inserts[st];
        if (!stufeX) return;
        pq = parameterVon(stufeX.art, z.param); t = `${ARTEN[stufeX.art].kurz} ${st + 1} · ${parameterLabel(stufeX.art, z.param)}`;
      }
      const row = document.createElement('div');
      row.className = 'p-ziel'; if ('glied' in z) row.dataset.glied = z.glied; else row.dataset.insert = z.insert; row.dataset.param = z.param;
      row.innerHTML = `<span class="p-ziel-text"></span><input class="p-ziel-von" type="number" step="${pq.schritt ?? 'any'}"><input class="p-ziel-bis" type="number" step="${pq.schritt ?? 'any'}"><button class="p-ziel-weg">✕</button>`;
      row.querySelector('.p-ziel-text').textContent = t;
      const von = row.querySelector('.p-ziel-von'), bis = row.querySelector('.p-ziel-bis');
      von.value = String(z.von); bis.value = String(z.bis);
      von.setAttribute('aria-label', L.von(nr, t)); bis.setAttribute('aria-label', L.bis(nr, t));
      von.title = `Value when the macro is at 0 (${pq.min} to ${pq.max}${pq.einheit ? ` ${pq.einheit}` : ''})`; bis.title = `Value when the macro is at 1 (${pq.min} to ${pq.max}${pq.einheit ? ` ${pq.einheit}` : ''})`;
      const aendern = () => {
        const v = Number(von.value), bb = Number(bis.value);
        const ok = Number.isFinite(v) && Number.isFinite(bb) && v >= pq.min && v <= pq.max && bb >= pq.min && bb <= pq.max;
        von.classList.toggle('falsch', !ok); bis.classList.toggle('falsch', !ok);
        if (ok) rackAendere(ctx, s, `Range of ${t} on ${s.name}`, zielWerte(rackMakros(straenge(ctx.st.projekt).find((x) => x.id === s.id)), nr, k, v, bb));
      };
      von.addEventListener('change', aendern); bis.addEventListener('change', aendern);
      const weg = row.querySelector('.p-ziel-weg');
      weg.setAttribute('aria-label', L.weg(nr, t)); weg.title = 'Remove this mapping (the parameter is free again)';
      weg.addEventListener('click', () => rackAendere(ctx, s, `Remove ${t} from macro ${nr} on ${s.name}`, zielWeg(rackMakros(straenge(ctx.st.projekt).find((x) => x.id === s.id)), nr, k)));
      q('.p-makro-ziele').append(row);
    });
    const wahl = q('.p-ziel-wahl'), neu = q('.p-ziel-neu');
    wahl.setAttribute('aria-label', L.wahl(nr)); neu.setAttribute('aria-label', L.neu(nr));
    for (const f of frei) { const o = document.createElement('option'); o.value = `${f.insert}|${f.param}`; o.textContent = f.text; wahl.append(o); }
    for (const f of freiGlied) { const o = document.createElement('option'); o.value = `g|${f.glied}|${f.param}`; o.textContent = f.text; wahl.append(o); }
    wahl.disabled = neu.disabled = voll || frei.length + freiGlied.length === 0;
    neu.title = voll ? `The strip has ${MAX_MAKRO_ZIELE} mappings, the most there are` : frei.length + freiGlied.length === 0 ? 'Every continuous parameter of this chain and rack is mapped' : 'Map the chosen parameter to this macro';
    neu.addEventListener('click', () => {
      const cur = straenge(ctx.st.projekt).find((x) => x.id === s.id);
      if (wahl.value.startsWith('g|')) {
        const [, glied, param] = wahl.value.split('|');
        rackAendere(ctx, s, `Map ${param} of member ${glied} to macro ${nr} on ${s.name}`, zielHinzuGlied(rackMakros(cur), nr, glied, param, gliedZielBereich(cur, glied, param)));
        return;
      }
      const [insert, param] = wahl.value.split('|');
      const stX = cur?.inserts.find((x) => x.id === insert);
      if (!stX) return;
      rackAendere(ctx, s, `Map ${param} to macro ${nr} on ${s.name}`, zielHinzu(rackMakros(cur), nr, insert, param, parameterVon(stX.art, param)));
    });
    el.append(b);
  }
  el.append(variationen(ctx, s));
  const info = document.createElement('div');
  info.className = 'p-rack-info';
  info.textContent = `${rackZiele(s)} of ${MAX_MAKRO_ZIELE} mappings. A mapped parameter is driven by its macro; its own control is greyed.`;
  el.append(info);
  return el;
}
// the variations of the rack (1.9 U8 T11, E13): named snapshots of the four macro values; save under a name (an existing name is replaced), load, delete
function variationen(ctx, s) {
  const b = document.createElement('div'), liste = rackVariationen(s);
  b.className = 'p-variationen';
  b.innerHTML = '<div class="p-variationen-kopf">Variations</div><div class="p-variationen-liste"></div>'
    + `<div class="p-variation-neu"><input class="p-variation-name" type="text" maxlength="${VARIATION_NAME_MAX}" placeholder="Name"><button class="p-variation-speichern">Save</button></div>`;
  const lst = b.querySelector('.p-variationen-liste');
  if (liste.length === 0) lst.textContent = 'None saved yet';
  for (const v of liste) {
    const r = document.createElement('div');
    r.className = 'p-variation'; r.dataset.name = v.name;
    r.innerHTML = '<span class="p-variation-text"></span><button class="p-variation-laden">Load</button><button class="p-variation-loeschen">✕</button>';
    r.querySelector('.p-variation-text').textContent = `${v.name} · ${v.werte.map((w) => Math.round(w * 100)).join(' / ')}`;
    const ld = r.querySelector('.p-variation-laden'), lo = r.querySelector('.p-variation-loeschen');
    ld.setAttribute('aria-label', `Load variation ${v.name} on ${s.name}`); ld.title = 'Set the four macros to this variation (a live change, Undo brings the old values back)';
    lo.setAttribute('aria-label', `Delete variation ${v.name} on ${s.name}`); lo.title = 'Delete this variation';
    ld.addEventListener('click', () => { const c = variationBefehl(s.id, 'laden', v.name); if (c) ctx.aendere(`Load variation ${v.name} on ${s.name}`, [c]); });
    lo.addEventListener('click', () => { const c = variationBefehl(s.id, 'loeschen', v.name); if (c) ctx.aendere(`Delete variation ${v.name} on ${s.name}`, [c]); });
    lst.append(r);
  }
  const name = b.querySelector('.p-variation-name'), sp = b.querySelector('.p-variation-speichern');
  name.setAttribute('aria-label', `Name of the variation to save on ${s.name}`); sp.setAttribute('aria-label', `Save variation on ${s.name}`);
  sp.disabled = !s.rack;
  sp.title = !s.rack ? 'Map a parameter first: a variation stores the macro values of the rack' : 'Save the four macro values under this name (an existing name is replaced)';
  sp.addEventListener('click', () => {
    const n = name.value.trim(), c = variationBefehl(s.id, 'speichern', n);
    if (!c) { ctx.melde?.(`A variation name has 1 to ${VARIATION_NAME_MAX} characters`, true); return; }
    if (liste.length >= MAX_VARIATIONEN && !liste.some((v) => v.name === n)) { ctx.melde?.(`A rack holds at most ${MAX_VARIATIONEN} variations: delete one first`, true); return; }
    ctx.aendere(`Save variation ${n} on ${s.name}`, [c]);
  });
  name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sp.click(); });
  return b;
}
// the live macro values on an open panel (a knob under the hand keeps its position)
function rackWerteZeigen(greift, el, s) {
  const w = rackWerte(s);
  el.querySelectorAll('.p-makro').forEach((b) => {
    const nr = Number(b.dataset.makro), r = b.querySelector('.p-makro-regler');
    if (!greift.has(`rack:${s.id}:${nr}`)) r.value = String(w[nr - 1]);
    r.disabled = !s.rack;
    b.querySelector('.p-makro-wert').textContent = `${Math.round(w[nr - 1] * 100)} %`;
  });
}

export function baueRackPanel(ctx, strang) {
  const { greift } = stufenZustand(ctx);
  const el = rackPanel(ctx, greift, strang);
  const aktualisiere = (s) => rackWerteZeigen(greift, el, s ?? strang);
  el.aktualisiere = aktualisiere;
  return { el, aktualisiere };
}

// what makes the panel's structure: the stages, the rack (names, mappings, variations) and the members; the live values are not part of it
const strukturSchluessel = (s) => JSON.stringify([s.name, s.inserts.map((i) => [i.id, i.art]), s.rack ? [s.rack.slot, s.rack.namen, s.rack.makros, s.rack.variationen] : null,
  s.geraet?.art === 'rack' ? s.geraet.glieder : null]);

/** Sets ctx.oeffneRack(strang): the rack panel in a floating window (id `rack:<strangId>`); a second call brings the open window to the front. */
export function bindeRackFenster(ctx) {
  ctx.oeffneRack = (strang) => {
    const jetzt = () => { const s = straenge(ctx.st.projekt).find((x) => x.id === strang.id); return s && hatRack(s) ? s : null; };
    if (!ctx.fenster || !jetzt()) return null;
    return ctx.fenster.oeffne({
      id: `rack:${strang.id}`, titel: `Rack · ${strang.name}`, untertitel: 'MACROS', art: 'rack',
      pruefe: () => jetzt() !== null,
      bauen: (koerper) => {
        const platz = document.createElement('div');
        platz.className = 'w-fenster-geraet'; platz.dataset.w = 'fenster-geraet';
        koerper.append(platz);
        let panel = null, schluessel = '';
        const aktualisiere = () => {
          const s = jetzt();
          if (!s) return;
          const neu = strukturSchluessel(s);
          if (!panel || neu !== schluessel) {
            schluessel = neu;
            panel = baueRackPanel(ctx, s);
            panel.el.style.margin = '0'; panel.el.style.width = '100%';   // the row's popover indent is not wanted in a window
            platz.replaceChildren(panel.el);
          }
          panel.aktualisiere(s);
        };
        aktualisiere();
        return { aktualisiere, zerstoere: () => { panel = null; platz.remove(); } };
      },
    });
  };
}
