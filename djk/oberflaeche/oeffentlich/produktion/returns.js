// PRODUCTION (1.10 Slice 3): return strips with Cypher Hall and the send controls, below the groups. Every operation goes through ctx.aendere to
// POST /proj/aendern (return_neu, return_aendern, return_loeschen, send_setzen), so it lands in the project and in the undo history. A drag of a fader
// or a send carries a coalescing key (one history line per drag). The level of a strip comes without code of its own: app.js fills every
// .meter[data-kanal="ret/<nr>"] from /pegel. The pre/post switch of a send is slice 4 and is not here.
import { faderWert, faderText, panText, FADER_MIN, FADER_MAX, naechsteFarbe, istUmbenennenTaste } from './spurkoepfe.js';
import { HALL_FELDER_ANZEIGE, hallText, neuerReturnBefehl, returnLabels, returnListe, sendBefehl, sendLabel, sendWert } from './routing.js';
import { MAX_RETURNS } from './grenzen.js';

export const RETURN_VOLL_TEXT = `All ${MAX_RETURNS} returns are used`;
const HALL_ZEILEN = HALL_FELDER_ANZEIGE.map(([feld, text]) => `<label class="p-hallzeile">${text}<input class="p-hall" data-feld="${feld}" type="range" min="0" max="1" step="0.001">`
  + `<output class="p-hallwert" data-feld="${feld}"></output></label>`).join('');
const KOPF = `<button class="p-farbe" title="Return colour: click for the next one"></button>
<span class="p-spurname" role="button" tabindex="0" title="Double click, Enter or F2 to rename"></span><span class="p-geraet">RETURN</span>
<button class="p-mute" aria-pressed="false" title="Mute the return">M</button><button class="p-solo" aria-pressed="false" title="Solo the return (silences the tracks that do not feed it)">S</button>
<button class="p-loeschen" title="Delete return (its sends go away; Undo brings it back)">✕</button>
<input class="p-fader" type="range" min="${FADER_MIN}" max="${FADER_MAX}" step="0.5" title="Volume (double click: 0 dB)">
<output class="p-faderwert"></output>
<input class="p-pan" type="range" min="-1" max="1" step="0.01" title="Balance (double click: centre)">
<output class="p-panwert"></output>
<div class="meter waagrecht p-pegel"><i></i></div>
<details class="p-hallblock" open><summary>Hall <button class="p-hallan" aria-pressed="true" title="Hall on or off">ON</button></summary>${HALL_ZEILEN}</details>`;

export function bindeReturns(ctx) {
  const { $ } = ctx;
  const reihe = $('mixer-returns'), sendBlock = $('mixer-sends');
  const stand = new Map(), els = new Map(), greift = new Set();
  const returnAus = (id, rechne) => ctx.aendereAus((p) => {
    const r = p.returns?.find((x) => x.id === id), z = r ? rechne(r) : null;
    return z ? { label: z.label, befehle: [{ befehl: 'return_aendern', return_id: id, ...z.felder }] } : null;
  });

  function baue(id) {
    const el = document.createElement('div');
    el.className = 'p-kopf p-gruppenkopf p-returnkopf';
    el.dataset.ret = id;
    el.innerHTML = KOPF;
    const q = (s) => el.querySelector(s);
    const ret = () => stand.get(id);
    q('.p-mute').addEventListener('click', () => returnAus(id, (r) => ({ label: `${r.mute ? 'Unmute' : 'Mute'} return ${r.name}`, felder: { mute: !r.mute } })));
    q('.p-solo').addEventListener('click', () => returnAus(id, (r) => ({ label: `${r.solo ? 'Unsolo' : 'Solo'} return ${r.name}`, felder: { solo: !r.solo } })));
    q('.p-farbe').addEventListener('click', () => returnAus(id, (r) => ({ label: `Colour return ${r.name}`, felder: { farbe: naechsteFarbe(r.farbe) } })));
    q('.p-hallan').addEventListener('click', () => returnAus(id, (r) => ({ label: `Hall ${r.hall.an ? 'off' : 'on'} return ${r.name}`, felder: { hall: { an: !r.hall.an } } })));
    q('.p-loeschen').addEventListener('click', () => ctx.aendere(`Delete return ${ret().name}`, [{ befehl: 'return_loeschen', return_id: id }]));
    const regler = (r, k, vorgabe, wert, sende) => {
      r.addEventListener('pointerdown', () => greift.add(k));
      r.addEventListener('input', sende);
      r.addEventListener('change', () => greift.delete(k));
      r.addEventListener('pointerup', () => greift.delete(k));
      if (vorgabe !== null) r.addEventListener('dblclick', () => { r.value = String(vorgabe); sende(); greift.delete(k); });
    };
    for (const [klasse, feld, vorgabe] of [['.p-fader', 'fader_db', 0], ['.p-pan', 'pan', 0]]) {
      const r = q(klasse), k = `${id}:${feld}`;
      regler(r, k, vorgabe, null, () => {
        const v = feld === 'fader_db' ? faderWert(Number(r.value)) : Number(r.value);
        zeigeWerte(el, { ...ret(), [feld]: v });
        ctx.aendere(`${feld === 'fader_db' ? 'Volume' : 'Balance'} return ${ret().name}`, [{ befehl: 'return_aendern', return_id: id, [feld]: v }], k);
      });
    }
    for (const r of el.querySelectorAll('.p-hall')) {
      const feld = r.dataset.feld, k = `${id}:hall:${feld}`;
      regler(r, k, null, null, () => {
        const v = Number(r.value);
        el.querySelector(`.p-hallwert[data-feld="${feld}"]`).textContent = hallText(feld, v);
        ctx.aendere(`Hall ${feld} return ${ret().name}`, [{ befehl: 'return_aendern', return_id: id, hall: { [feld]: v } }], k);
      });
    }
    const name = q('.p-spurname');
    const umbenennen = () => {
      const ein = document.createElement('input');
      ein.className = 'p-namefeld'; ein.value = ret().name; ein.maxLength = 40; ein.setAttribute('aria-label', 'Return name');
      name.replaceWith(ein); ein.focus(); ein.select();
      let fertig = false;
      const ende = (uebernehmen, zurueckAnName) => {
        if (fertig) return; fertig = true;
        ein.replaceWith(name);
        if (zurueckAnName) name.focus();
        const neu = ein.value.trim();
        if (uebernehmen && neu && neu !== ret().name) ctx.aendere('Rename return', [{ befehl: 'return_aendern', return_id: id, name: neu }]);
      };
      ein.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ende(true, true); if (e.key === 'Escape') ende(false, true); });
      ein.addEventListener('blur', () => ende(false, false));
    };
    name.addEventListener('dblclick', umbenennen);
    name.addEventListener('keydown', (e) => { if (istUmbenennenTaste(e)) { e.preventDefault(); e.stopPropagation(); umbenennen(); } });
    return el;
  }

  function zeigeWerte(el, r) {
    const q = (x) => el.querySelector(x);
    el.style.setProperty('--farbe', r.farbe);
    q('.p-spurname').textContent = r.name;
    for (const [k, an] of [['.p-mute', r.mute], ['.p-solo', r.solo], ['.p-hallan', r.hall.an]]) { q(k).classList.toggle('an', an); q(k).setAttribute('aria-pressed', String(an)); }
    q('.p-hallan').textContent = r.hall.an ? 'ON' : 'OFF';
    if (!greift.has(`${r.id}:fader_db`)) q('.p-fader').value = String(Math.max(FADER_MIN, r.fader_db));
    if (!greift.has(`${r.id}:pan`)) q('.p-pan').value = String(r.pan);
    for (const h of el.querySelectorAll('.p-hall')) {
      if (!greift.has(`${r.id}:hall:${h.dataset.feld}`)) h.value = String(r.hall[h.dataset.feld]);
      el.querySelector(`.p-hallwert[data-feld="${h.dataset.feld}"]`).textContent = hallText(h.dataset.feld, r.hall[h.dataset.feld]);
    }
    const L = returnLabels(r.name);
    for (const [k, v] of [['.p-mute', L.mute], ['.p-solo', L.solo], ['.p-loeschen', L.loeschen], ['.p-spurname', L.umbenennen], ['.p-fader', L.fader], ['.p-pan', L.pan], ['.p-hallan', L.hall]]) {
      q(k).setAttribute('aria-label', v);
    }
    q('.p-faderwert').textContent = faderText(r.fader_db);
    q('.p-panwert').textContent = panText(r.pan);
    q('.p-pegel').dataset.kanal = `ret/${r.nr}`;
  }

  // The send rows: one line per track and group, one slider per existing return. Rebuilt only when tracks, groups or returns change in number or name;
  // the values are refreshed on every project.
  let sendSchluessel = '';
  function sendZeilen(p) {
    const rets = returnListe(p);
    const straenge = [...(p?.spuren ?? []).map((s) => ['spur', s]), ...[...(p?.gruppen ?? [])].sort((a, b) => a.nr - b.nr).map((g) => ['grp', g])];
    const schluessel = JSON.stringify([rets.map((r) => [r.id, r.name]), straenge.map(([a, s]) => [a, s.id, s.name])]);
    if (schluessel !== sendSchluessel) {
      sendSchluessel = schluessel;
      sendBlock.textContent = '';
      for (const [art, s] of straenge) {
        const zeile = document.createElement('div');
        zeile.className = 'p-sendzeile';
        zeile.dataset.strang = s.id;
        const n = document.createElement('span');
        n.className = 'p-sendname'; n.textContent = `${art === 'grp' ? 'Group ' : ''}${s.name}`;
        zeile.append(n);
        for (const r of rets) {
          const lab = document.createElement('label');
          lab.className = 'p-send'; lab.textContent = r.name;
          const reg = document.createElement('input');
          reg.type = 'range'; reg.min = String(FADER_MIN); reg.max = String(FADER_MAX); reg.step = '0.5'; reg.className = 'p-sendregler';
          reg.dataset.ret = r.id; reg.dataset.strang = s.id;
          reg.setAttribute('aria-label', sendLabel(s.name, r.name));
          reg.title = 'Send level (post fader and post mute). Double click: off';
          const out = document.createElement('output');
          out.className = 'p-sendwert';
          const k = `${s.id}:send:${r.id}`;
          const sende = () => {
            const v = faderWert(Number(reg.value));
            out.textContent = faderText(v);
            ctx.aendere(sendLabel(s.name, r.name), [sendBefehl(s.id, r.id, v)], k);
          };
          reg.addEventListener('pointerdown', () => greift.add(k));
          reg.addEventListener('input', sende);
          reg.addEventListener('change', () => greift.delete(k));
          reg.addEventListener('pointerup', () => greift.delete(k));
          reg.addEventListener('dblclick', () => { reg.value = String(FADER_MIN); sende(); greift.delete(k); });
          lab.append(reg, out);
          zeile.append(lab);
        }
        sendBlock.append(zeile);
      }
    }
    for (const reg of sendBlock.querySelectorAll('.p-sendregler')) {
      const s = straenge.find(([, x]) => x.id === reg.dataset.strang)?.[1];
      const db = sendWert(s, reg.dataset.ret);
      if (!greift.has(`${reg.dataset.strang}:send:${reg.dataset.ret}`)) reg.value = String(Math.max(FADER_MIN, db));
      reg.nextElementSibling.textContent = faderText(db);
    }
  }

  $('neu-return').addEventListener('click', () => { const b = neuerReturnBefehl(ctx.st.projekt); if (b) ctx.aendere('Add return: Hall', [b]); });

  ctx.beimProjekt.push((p) => {
    const knopf = $('neu-return'), b = neuerReturnBefehl(p);
    knopf.disabled = !b;
    knopf.title = b || !p ? 'Add a return strip with Cypher Hall (up to 4)' : RETURN_VOLL_TEXT;
    const rets = returnListe(p);
    stand.clear();
    for (const r of rets) stand.set(r.id, r);
    for (const [id, el] of els) if (!stand.has(id)) { el.remove(); els.delete(id); }
    rets.forEach((r, i) => {
      let el = els.get(r.id);
      if (!el) { el = baue(r.id); els.set(r.id, el); }
      zeigeWerte(el, r);
      if (reihe.children[i] !== el) reihe.insertBefore(el, reihe.children[i] ?? null);
    });
    $('returns').hidden = !p;
    $('sends').hidden = rets.length === 0;
    sendZeilen(p);
  });
}
