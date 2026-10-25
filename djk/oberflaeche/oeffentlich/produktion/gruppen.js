// PRODUCTION (1.10 Slice 1): Gruppen-Köpfe und Produktions-Master unter dem Arrangement (P1). Jede Bedienung geht über ctx.aendere an POST /proj/aendern
// (gruppenspur_aendern, gruppenspur_neu, gruppenspur_loeschen, master_aendern), damit sie im Projekt und im Undo-Verlauf landet. Der Pegel kommt ohne
// eigenen Code: app.js zeigePegel füllt jedes .meter[data-kanal="grp/<nr>"] und [data-kanal="pm"] aus /pegel.
import { faderWert, faderText, panText, FADER_MIN, FADER_MAX, naechsteFarbe, istUmbenennenTaste } from './spurkoepfe.js';
import { gruppenLabels, neueGruppeBefehl } from './routing.js';

const KOPF = `<button class="p-farbe" title="Group colour: click for the next one"></button>
<span class="p-spurname" role="button" tabindex="0" title="Double click, Enter or F2 to rename"></span><span class="p-geraet">GROUP</span>
<button class="p-mute" aria-pressed="false" title="Mute the group (silences its members)">M</button><button class="p-solo" aria-pressed="false" title="Solo the group (all its members play)">S</button>
<button class="p-loeschen" title="Delete group (its tracks go back to Master; Undo brings it back)">✕</button>
<input class="p-fader" type="range" min="${FADER_MIN}" max="${FADER_MAX}" step="0.5" title="Volume (double click: 0 dB)">
<output class="p-faderwert"></output>
<input class="p-pan" type="range" min="-1" max="1" step="0.01" title="Balance (double click: centre)">
<output class="p-panwert"></output>
<div class="meter waagrecht p-pegel"><i></i></div>`;

export function bindeGruppen(ctx) {
  const { $ } = ctx;
  const reihe = $('mixer-gruppen');
  const stand = new Map();   // gruppe_id → Gruppe laut letztem Projekt
  const els = new Map();
  const greift = new Set();  // `${id}:fader_db|pan`, solange die Hand am Regler ist
  const aendernG = (id, label, felder, schluessel = null) => ctx.aendere(label, [{ befehl: 'gruppenspur_aendern', gruppe_id: id, ...felder }], schluessel);
  // wie spurkoepfe.js spurAus: M, S und Farbe folgen aus dem Stand beim Senden (zwei schnelle Klicks: an, dann aus)
  const gruppeAus = (id, rechne) => ctx.aendereAus((p) => {
    const g = p.gruppen?.find((x) => x.id === id), r = g ? rechne(g) : null;
    return r ? { label: r.label, befehle: [{ befehl: 'gruppenspur_aendern', gruppe_id: id, ...r.felder }] } : null;
  });

  function baue(id) {
    const el = document.createElement('div');
    el.className = 'p-kopf p-gruppenkopf';
    el.dataset.gruppe = id;
    el.innerHTML = KOPF;
    const q = (s) => el.querySelector(s);
    const gruppe = () => stand.get(id);
    q('.p-mute').addEventListener('click', () => gruppeAus(id, (g) => ({ label: `${g.mute ? 'Unmute' : 'Mute'} group ${g.name}`, felder: { mute: !g.mute } })));
    q('.p-solo').addEventListener('click', () => gruppeAus(id, (g) => ({ label: `${g.solo ? 'Unsolo' : 'Solo'} group ${g.name}`, felder: { solo: !g.solo } })));
    q('.p-farbe').addEventListener('click', () => gruppeAus(id, (g) => ({ label: `Colour group ${g.name}`, felder: { farbe: naechsteFarbe(g.farbe) } })));
    q('.p-loeschen').addEventListener('click', () => ctx.aendere(`Delete group ${gruppe().name}`, [{ befehl: 'gruppenspur_loeschen', gruppe_id: id }]));
    for (const [klasse, feld, vorgabe] of [['.p-fader', 'fader_db', 0], ['.p-pan', 'pan', 0]]) {
      const r = q(klasse), k = `${id}:${feld}`;
      const sende = () => {
        const v = feld === 'fader_db' ? faderWert(Number(r.value)) : Number(r.value);
        zeigeWerte(el, { ...gruppe(), [feld]: v });
        aendernG(id, `${feld === 'fader_db' ? 'Volume' : 'Balance'} group ${gruppe().name}`, { [feld]: v }, k);
      };
      r.addEventListener('pointerdown', () => greift.add(k));
      r.addEventListener('input', sende);
      r.addEventListener('change', () => greift.delete(k));
      r.addEventListener('pointerup', () => greift.delete(k));
      r.addEventListener('dblclick', () => { r.value = String(vorgabe); sende(); greift.delete(k); });
    }
    const name = q('.p-spurname');
    const umbenennen = () => {
      const ein = document.createElement('input');
      ein.className = 'p-namefeld'; ein.value = gruppe().name; ein.maxLength = 40; ein.setAttribute('aria-label', 'Group name');
      name.replaceWith(ein); ein.focus(); ein.select();
      let fertig = false;
      const ende = (uebernehmen, zurueckAnName) => {
        if (fertig) return; fertig = true;
        ein.replaceWith(name);
        if (zurueckAnName) name.focus();
        const neu = ein.value.trim();
        if (uebernehmen && neu && neu !== gruppe().name) aendernG(id, 'Rename group', { name: neu });
      };
      ein.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ende(true, true); if (e.key === 'Escape') ende(false, true); });
      ein.addEventListener('blur', () => ende(false, false));
    };
    name.addEventListener('dblclick', umbenennen);
    name.addEventListener('keydown', (e) => { if (istUmbenennenTaste(e)) { e.preventDefault(); e.stopPropagation(); umbenennen(); } });
    return el;
  }

  function zeigeWerte(el, g) {
    const q = (x) => el.querySelector(x);
    el.style.setProperty('--farbe', g.farbe);
    q('.p-spurname').textContent = g.name;
    for (const [k, an] of [['.p-mute', g.mute], ['.p-solo', g.solo]]) { q(k).classList.toggle('an', an); q(k).setAttribute('aria-pressed', String(an)); }
    if (!greift.has(`${g.id}:fader_db`)) q('.p-fader').value = String(Math.max(FADER_MIN, g.fader_db));
    if (!greift.has(`${g.id}:pan`)) q('.p-pan').value = String(g.pan);
    const L = gruppenLabels(g.name);
    for (const [k, v] of [['.p-mute', L.mute], ['.p-solo', L.solo], ['.p-loeschen', L.loeschen], ['.p-spurname', L.umbenennen], ['.p-fader', L.fader], ['.p-pan', L.pan]]) q(k).setAttribute('aria-label', v);
    q('.p-faderwert').textContent = faderText(g.fader_db);
    q('.p-panwert').textContent = panText(g.pan);
    q('.p-pegel').dataset.kanal = `grp/${g.nr}`;
  }

  // Master (PM): ein Fader und der Pegel `pm`
  const pmFader = $('pm-fader'), pmWert = $('pm-wert');
  let pmGreift = false;
  const pmSende = () => {
    const v = faderWert(Number(pmFader.value));
    pmWert.textContent = faderText(v);
    ctx.aendere('Master volume', [{ befehl: 'master_aendern', fader_db: v }], 'pm:fader');
  };
  pmFader.addEventListener('pointerdown', () => { pmGreift = true; });
  pmFader.addEventListener('input', pmSende);
  pmFader.addEventListener('change', () => { pmGreift = false; });
  pmFader.addEventListener('pointerup', () => { pmGreift = false; });
  pmFader.addEventListener('dblclick', () => { pmFader.value = '0'; pmSende(); pmGreift = false; });

  $('neu-gruppe').addEventListener('click', () => { const b = neueGruppeBefehl(ctx.st.projekt); if (b) ctx.aendere('Add group', [b]); });

  ctx.beimProjekt.push((p) => {
    $('mixer').hidden = !p;
    $('neu-gruppe').disabled = !neueGruppeBefehl(p);
    const gruppen = [...(p?.gruppen ?? [])].sort((a, b) => a.nr - b.nr);
    stand.clear();
    for (const g of gruppen) stand.set(g.id, g);
    for (const [id, el] of els) if (!stand.has(id)) { el.remove(); els.delete(id); }
    gruppen.forEach((g, i) => {
      let el = els.get(g.id);
      if (!el) { el = baue(g.id); els.set(g.id, el); }
      zeigeWerte(el, g);
      if (reihe.children[i] !== el) reihe.insertBefore(el, reihe.children[i] ?? null);
    });
    const fader = p?.master?.fader_db ?? 0;
    if (!pmGreift) pmFader.value = String(Math.max(FADER_MIN, fader));
    pmWert.textContent = faderText(fader);
  });
}
