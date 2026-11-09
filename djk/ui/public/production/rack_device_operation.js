// PRODUCTION 1.9 U7 T5 (spec E9, E11): the rack panel in the detail area. Member rows with device, key and velocity zone bars (drag an edge), the chain zone,
// the gain, remove; above them the chain value of the rack and + MEMBER. Every change is one command through ctx.aendere (the server is the truth; the panel
// is rebuilt from the project after each answer, except while a hand holds an edge or a field).
// 1.9 U8 T11 (spec E12): under the head the four macro knobs of the strand rack (the same rack_makro control change and drag key as the knobs of the mapping editor in
// inserts.js); the mappings and the variations are edited there (RACK button of the strip). The knob values follow the project without a rebuild.
import { RACK_TEXT, gliedZeilen, glieder, kannGliedHinzu, zoneBefehl, kantenZug, tasteVonX, ketteBefehl, gainBefehl, gliedHinzuBefehl, gliedEntfernenBefehl,
  GLIED_GAIN_MIN, GLIED_GAIN_MAX, TON_MIN, TON_MAX, VEL_MIN, VEL_MAX, KETTE_MIN, KETTE_MAX } from './rack_device.js';

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const zahlFeld = (klasse, titel, wert, label) => {
  const i = el('input', klasse); i.setAttribute('inputmode', 'decimal'); i.setAttribute('autocomplete', 'off'); i.title = titel; i.value = String(wert);
  i.setAttribute('aria-label', label); return i;
};
const pct = (v, min, max) => `${((v - min) / (max - min)) * 100}%`;

import { rackMakroBefehl } from './inserts.js';

export function bindeRackPanel(ctx, wurzel) {
  // haelt: a drag or an edit is running, the panel is not rebuilt meanwhile; stand: the device as last drawn, an unchanged device is not rebuilt
  // (a press must not lose its element)
  let spurId = null, haelt = 0, stand = null, makroRegler = [];
  const greiftMakro = new Set();   // the macro numbers a hand is dragging
  const MAKRO_N = 4;
  const spurNow = () => ctx.st.projekt?.spuren.find((s) => s.id === spurId);
  // draw again from the server state, also when it did not change (a refused or clamped input must not stay on screen, like detail.js zeige(true))
  const frisch = () => { stand = null; zeige(spurNow()); };
  // one command; the answer (accepted or refused) shows the server state again. Returns the promise, or undefined when there was nothing to send.
  const sende = (label, b) => {
    if (!b) { frisch(); return undefined; }
    return Promise.resolve(ctx.aendere(label, [b])).then(frisch, frisch);
  };

  // the four macro knobs: value, enabled state (no rack yet = no mapping = nothing to drive) and the readout follow the project; a knob under the hand keeps its place
  function makroAktualisieren(spur) {
    makroRegler.forEach(({ regler, wert }, i) => {
      const w = spur.rack?.werte?.[i] ?? 0;
      if (!greiftMakro.has(i + 1)) regler.value = String(w);
      regler.disabled = !spur.rack;
      wert.textContent = `${Math.round(Number(regler.value) * 100)} %`;
    });
  }
  function makroZeile(spur) {
    const z = el('div', 'p-irack-makros');
    makroRegler = [];
    for (let nr = 1; nr <= MAKRO_N; nr++) {
      const name = spur.rack?.namen?.[nr - 1] || `Macro ${nr}`, b = el('label', 'p-irack-makro', name);
      const regler = el('input', 'p-irack-makro-regler'); regler.type = 'range'; regler.min = '0'; regler.max = '1'; regler.step = '0.001'; regler.title = 'Double click: 0';
      regler.setAttribute('aria-label', `${name} of the rack macros`);
      const wert = el('output', 'p-irack-makro-wert');
      const sende = () => {
        if (regler.disabled) return;
        wert.textContent = `${Math.round(Number(regler.value) * 100)} %`;
        ctx.aendere(`${name} on ${spur.name}`, [rackMakroBefehl(spur.id, nr, Number(regler.value))], `rack:${spur.id}:${nr}`);
      };
      regler.addEventListener('input', sende);
      regler.addEventListener('pointerdown', () => greiftMakro.add(nr));
      regler.addEventListener('change', () => greiftMakro.delete(nr));
      regler.addEventListener('pointerup', () => greiftMakro.delete(nr));
      regler.addEventListener('dblclick', () => { regler.value = '0'; sende(); greiftMakro.delete(nr); });
      b.append(regler, wert); z.append(b);
      makroRegler.push({ regler, wert });
    }
    if (!spur.rack) z.append(el('span', 'p-irack-makro-hinweis', 'Map a member parameter to a macro (RACK button of this track in INSERTS) to use the knobs'));
    return z;
  }

  // a zone bar over the whole key (or velocity) range: the filled part is the zone, the two edges are handles
  function zonenBalken(spur, m, art, titel, min, max) {
    const balken = el('div', `p-irack-zone p-irack-${art}`); balken.title = titel; balken.setAttribute('role', 'group'); balken.setAttribute('aria-label', `${titel} of member ${m.id}`);
    const fuell = el('div', 'p-irack-fuell'); balken.append(fuell);
    const [lo, hi] = m.zonen[art];
    const lage = (a, b) => { fuell.style.left = pct(a, min, max); fuell.style.width = `${((b - a) / (max - min)) * 100}%`; };
    lage(lo, hi);
    const etikett = art === 'ton' ? RACK_TEXT.ton : RACK_TEXT.vel, text = el('span', 'p-irack-zonentext', `${etikett} ${lo}–${hi}`);
    for (const seite of ['lo', 'hi']) {
      const griff = el('button', `p-irack-griff p-irack-griff-${seite}`); griff.type = 'button';
      griff.setAttribute('aria-label', `${seite === 'lo' ? 'Lower' : 'Upper'} edge of the ${art === 'ton' ? 'key' : 'velocity'} zone of member ${m.id}`);
      griff.style.left = pct(seite === 'lo' ? lo : hi, min, max);
      griff.addEventListener('pointerdown', (e) => {
        e.preventDefault(); try { griff.setPointerCapture(e.pointerId); } catch { /* no active pointer (synthetic event): the listeners sit on the handle anyway */ } haelt++;
        const glied = glieder(spur).find((x) => x.id === m.id);
        const zug = kantenZug(spurId, glied, `${art}_${seite}`, (b) => sende(`Rack ${art === 'ton' ? 'key' : 'velocity'} zone`, b));
        const bewegt = (ev) => {
          const r = balken.getBoundingClientRect();
          const w = zug.bewegung(tasteVonX(ev.clientX - r.left, r.width, min, max));
          const [a, b] = seite === 'lo' ? [w, Math.max(w, hi)] : [Math.min(lo, w), w];
          lage(Math.min(a, b), Math.max(a, b)); griff.style.left = pct(w, min, max); text.textContent = `${etikett} ${seite === 'lo' ? w : lo}–${seite === 'lo' ? hi : w}`;
        };
        const ende = () => {
          griff.removeEventListener('pointermove', bewegt); griff.removeEventListener('pointerup', ende); griff.removeEventListener('pointercancel', ende);
          haelt--;
          if (zug.ende() === undefined) frisch();   // one body at the end; the preview stays until the answer (sende) redraws; nothing sent: redraw now
        };
        griff.addEventListener('pointermove', bewegt); griff.addEventListener('pointerup', ende); griff.addEventListener('pointercancel', ende);
      });
      balken.append(griff);
    }
    const huelle = el('div', 'p-irack-zwrap'); huelle.append(text, balken);
    return huelle;
  }

  // a number field that sends on change/Enter; Esc, a bad entry and a refused value show the server state again
  function feld(f, aktion) {
    f.addEventListener('focus', () => { haelt++; }); f.addEventListener('blur', () => { haelt--; });
    f.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') f.blur(); if (e.key === 'Escape') { f.blur(); frisch(); } });
    f.addEventListener('change', () => {
      const v = Number(String(f.value).replace(',', '.').trim());
      if (f.value.trim() === '' || !Number.isFinite(v)) { ctx.melde?.('Enter a number', true); frisch(); return; }
      aktion(v);
    });
    return f;
  }

  function zeile(spur, m) {
    const z = el('div', 'p-irack-glied'); z.dataset.glied = m.id;
    z.append(el('span', 'p-irack-name', `${m.id.toUpperCase()} ${m.text}`));
    z.append(zonenBalken(spur, m, 'ton', RACK_TEXT.ton_titel, TON_MIN, TON_MAX), zonenBalken(spur, m, 'vel', RACK_TEXT.vel_titel, VEL_MIN, VEL_MAX));
    const glied = () => glieder(spurNow() ?? spur).find((x) => x.id === m.id);
    const kz = el('label', 'p-irack-kz', RACK_TEXT.kette_zone);
    for (const [seite, i] of [['lo', 0], ['hi', 1]]) {
      kz.append(feld(zahlFeld(`p-irack-kette-${seite}`, `${RACK_TEXT.kette_zone}, ${seite === 'lo' ? 'lower' : 'upper'} value (${KETTE_MIN}..${KETTE_MAX})`, m.kette[i],
        `${RACK_TEXT.kette_zone} ${seite === 'lo' ? 'lower' : 'upper'} of member ${m.id}`), (v) => sende('Rack chain zone', zoneBefehl(spurId, glied(), `kette_${seite}`, v))));
    }
    const gl = el('label', 'p-irack-gain', RACK_TEXT.gain);
    const regler = el('input', 'p-irack-gainregler'); regler.type = 'range'; regler.min = String(GLIED_GAIN_MIN); regler.max = String(GLIED_GAIN_MAX); regler.step = '0.1';
    regler.value = String(m.gain); regler.title = RACK_TEXT.gain_titel; regler.setAttribute('aria-label', `Gain of member ${m.id}`);
    const zahl = feld(zahlFeld('p-irack-gainzahl', RACK_TEXT.gain_titel, m.gain, `Gain in dB of member ${m.id}`), (v) => sende('Rack member gain', gainBefehl(spurId, glied(), v)));
    regler.addEventListener('input', () => { zahl.value = regler.value; });
    regler.addEventListener('pointerdown', () => { haelt++; }); regler.addEventListener('change', () => { sende('Rack member gain', gainBefehl(spurId, glied(), Number(regler.value))); });
    const los = () => { if (haelt > 0 && document.activeElement !== zahl) haelt = Math.max(0, haelt - 1); };
    regler.addEventListener('pointerup', los); regler.addEventListener('pointercancel', los);
    regler.addEventListener('dblclick', () => sende('Rack member gain', gainBefehl(spurId, glied(), 0)));
    gl.append(regler, zahl, el('span', 'p-irack-einheit', 'dB'));
    const weg = el('button', 'p-irack-weg', RACK_TEXT.entfernen); weg.type = 'button'; weg.title = RACK_TEXT.entfernen_titel; weg.disabled = !m.kannEntfernen;
    weg.setAttribute('aria-label', `Remove member ${m.id}`);
    weg.addEventListener('click', () => ctx.aendere(`Remove rack member ${m.id}`, [gliedEntfernenBefehl(spurId, m.id)]));
    z.append(kz, gl, weg);
    return z;
  }

  function zeige(spur) {
    if (!spur || spur.geraet?.art !== 'rack') { spurId = null; stand = null; wurzel.replaceChildren(); return; }
    const jetzt = JSON.stringify([spur.id, spur.geraet, spur.rack?.namen ?? null, !!spur.rack]);
    if (spur.id === spurId && haelt > 0) { if (jetzt === stand) makroAktualisieren(spur); return; }   // a hand is on an edge or a field: the server state waits
    if (jetzt === stand && wurzel.children.length > 0) { makroAktualisieren(spur); return; }
    stand = jetzt;
    spurId = spur.id; haelt = 0;
    const kopf = el('div', 'p-irack-kopf');
    const kl = el('label', 'p-irack-kette', RACK_TEXT.kette);
    const kr = el('input', 'p-irack-ketteregler'); kr.type = 'range'; kr.min = String(KETTE_MIN); kr.max = String(KETTE_MAX); kr.step = '1'; kr.value = String(spur.geraet.kette);
    kr.title = RACK_TEXT.kette_titel; kr.setAttribute('aria-label', 'Chain value of the rack');
    const kz = feld(zahlFeld('p-irack-ketten-zahl', RACK_TEXT.kette_titel, spur.geraet.kette, 'Chain value of the rack'), (v) => sende('Rack chain', ketteBefehl(spurId, v)));
    kr.addEventListener('input', () => { kz.value = kr.value; });
    kr.addEventListener('change', () => sende('Rack chain', ketteBefehl(spurId, Number(kr.value))));
    kl.append(kr, kz);
    const neu = el('button', 'p-irack-neu', RACK_TEXT.hinzu); neu.type = 'button';
    neu.title = kannGliedHinzu(spur) ? RACK_TEXT.hinzu_titel : RACK_TEXT.voll; neu.disabled = !kannGliedHinzu(spur);
    neu.addEventListener('click', () => ctx.aendere('Add rack member', [gliedHinzuBefehl(spurId)]));
    kopf.append(kl, neu);
    wurzel.replaceChildren(kopf, makroZeile(spur), ...gliedZeilen(spur).map((m) => zeile(spur, m)));
    makroAktualisieren(spur);
  }
  return { zeige, spurId: () => spurId };
}
