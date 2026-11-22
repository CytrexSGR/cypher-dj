// Lane strip (pop-up column, loop deck lanes): meter, long fader, knob row HI MID LOW, knob row COLOR HALL DLY, keys M S, keys 1 2 3 (Beat FX 1, 2 and FX3 Remix).
// Loop deck columns write the loop deck route (POST /loopdeck/spur {deck, spur, <field>}, ADR 042 item 8); solo is a project track
// fields (spur_aendern, one undo step each) and go out through the host's `spurAendern`. The values come from the stand: a control that is in
// the hand or has a write in flight keeps what the hand set, so a turned knob does not jump back.
import { el } from '../page_state.js';
import { KERN, kernAusX, kernZuX } from '../curves.js';
import { zeigeColorName } from '../color_kinds.js';

// Rotary knob. Without `opt` it is the filter knob (-1..+1, double click 0). `opt` generalises it for the strip row: the knob works on
// x = nachX(value) between nachX(min) and nachX(max); drag and keys move x, `beiWert` gets vonX(x) rounded to 1/rund; a double click sets `neutral`.
export function knopf(wert, beiWert, opt = {}) {
  const { klasse = 'knopf ld-filter', label = 'Filter', titel = 'Filter: low-pass left, high-pass right (double click: off)', min = -1, max = 1, neutral = 0,
    nachX = (v) => v, vonX = (x) => x, schritt = 0.05, rund = 100 } = opt;
  const x0 = nachX(min), x1 = nachX(max), spanne = x1 - x0;
  const k = el('div', klasse); k.setAttribute('role', 'slider'); k.tabIndex = 0; k.setAttribute('tabindex', '0');
  k.setAttribute('aria-label', label); k.title = titel;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 48 48');
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); ring.setAttribute('class', 'ring'); ring.setAttribute('cx', '24'); ring.setAttribute('cy', '24'); ring.setAttribute('r', '20');
  const zeiger = document.createElementNS('http://www.w3.org/2000/svg', 'line'); zeiger.setAttribute('class', 'zeiger'); zeiger.setAttribute('x1', '24'); zeiger.setAttribute('y1', '24');
  svg.append(ring, zeiger); k.append(svg);
  const xVon = (v) => Math.max(x0, Math.min(x1, nachX(Math.max(min, Math.min(max, v)))));
  const runde = (v) => Math.round(v * rund) / rund;
  let akt = wert;
  const setze = (v) => {
    const w = Math.max(min, Math.min(max, v)); akt = w;
    const a = ((xVon(w) - x0) / spanne * 2 - 1) * 135 * Math.PI / 180;
    zeiger.setAttribute('x2', (24 + 15 * Math.sin(a)).toFixed(2)); zeiger.setAttribute('y2', (24 - 15 * Math.cos(a)).toFixed(2));
    k.setAttribute('aria-valuenow', w.toFixed(2));
  };
  const ausX = (x) => runde(Math.max(min, Math.min(max, vonX(Math.max(x0, Math.min(x1, x))))));
  let start = null;
  k.addEventListener('pointerdown', (e) => { start = { y: e.clientY ?? 0, x: xVon(akt) }; k.classList.add('gegriffen'); k.setPointerCapture?.(e.pointerId); });
  k.addEventListener('pointermove', (e) => {
    if (!start) return;
    const v = ausX(start.x + (start.y - (e.clientY ?? 0)) / (e.shiftKey ? 600 : 150) * spanne);
    setze(v); beiWert(v);
  });
  const ende = () => { start = null; k.classList.remove('gegriffen'); };
  k.addEventListener('pointerup', ende); k.addEventListener('pointercancel', ende);
  k.addEventListener('dblclick', () => { setze(neutral); beiWert(neutral); });
  k.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? schritt : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -schritt : null;
    if (d === null) return;
    e.preventDefault?.();
    const v = ausX(xVon(akt) + d);
    setze(v); beiWert(v);
  });
  setze(wert);
  return { knoten: k, setze, gegriffen: () => start !== null };
}

// The knob laws of the lane strip, shared with the DJ place (loopdeck/view.js): EQ bands -200..+6 dB (fully left = band off, the isolator law),
// HALL / DELAY sends -200..0 dB on the fader law (fully left = send off), COLOR -1..+1 (centre = dry).
export const EQ_OPT = { min: -200, max: 6, neutral: 0, nachX: (db) => kernZuX(KERN.eq, db), vonX: (x) => kernAusX(KERN.eq, x), schritt: 0.025 };
export const SEND_OPT = { min: -200, max: 0, neutral: -200, nachX: (db) => kernZuX(KERN.fader, db), vonX: (x) => Math.min(0, kernAusX(KERN.fader, x)), schritt: 0.025 };
export const EQ_BAENDER = [['hoch', 'HI'], ['mitte', 'MID'], ['tief', 'LOW']];
export const FX_EINHEITEN = ['1', '2', '3'];
const COLOR_TITEL = 'COLOR: the effect chosen at the main mixer (FILTER: low-pass left, high-pass right); centre is dry (double click: centre)';
// the knob rows: row 1 HI MID LOW, row 2 COLOR HALL DLY
const KNOEPFE = [
  ...EQ_BAENDER.map(([band, text]) => ({ art: `eq/${band}`, eq: band, label: `${text} EQ`, titel: `${text}: band gain in dB, fully left is off (double click: 0 dB)`, text })),
  { art: 'filter', label: 'COLOR', titel: COLOR_TITEL, text: 'COLOR' },
  { art: 'hall', send: 'hall', label: 'HALL send', titel: 'HALL send in dB (double click: off)', text: 'HALL' },
  { art: 'delay', send: 'delay', label: 'DELAY send', titel: 'DELAY send in dB (double click: off)', text: 'DLY' },
];
const taste = (klasse, text, titel) => { const b = el('button', klasse, text); b.type = 'button'; b.setAttribute('type', 'button'); b.title = titel; b.setAttribute('aria-pressed', 'false'); return b; };
const schalte = (b, an, klasse = 'an') => { b.classList.toggle(klasse, !!an); b.setAttribute('aria-pressed', String(!!an)); };

/**
 * Builds the strip into `slot`. opt.sende(body) -> Promise<json | null> posts to /loopdeck/spur (null: refused, the caller showed it);
 * opt.spurAendern(spurId, feld, wert, label) -> Promise<boolean> writes a project track field. Solo, arm and the meter channel (spur/<nr>) come from the stand column (nr, solo, arm).
 * Returns { zeichne(spalte), entferne }.
 */
export function baueZug(slot, opt = {}) {
  const z = el('div', 'zug');
  let spalte = null;
  const inFlug = new Map(), gegriffen = new Set();   // key -> writes in flight / controls in the hand
  const frei = (k) => !(inFlug.get(k) > 0) && !gegriffen.has(k);
  const angenommen = {};   // what the server last accepted per control (stand or a successful write): a refused control goes back to it
  const fluege = new Map();   // key -> { laeuft, spaeter: body | null, warten: resolvers } : one request in flight per control, the latest value follows it
  const lauf = async (key, f, feld, warter, mein) => {
    f.laeuft = true; inFlug.set(key, 1);
    let r = null;
    try { r = await opt.sende?.({ deck: mein.deck, spur: mein.spur, ...feld }) ?? null; } catch { r = null; }
    for (const ok of warter) ok(r);
    if (f.spaeter) { const n = f.spaeter, w = f.warten; f.spaeter = null; f.warten = []; return lauf(key, f, n, w, mein); }
    f.laeuft = false; inFlug.set(key, 0);
  };
  // a write of a loop deck field -> Promise<json | null>; while one is in flight only the latest value of the key is kept
  const schicke = (key, feld) => new Promise((ok) => {
    if (!spalte) { ok(null); return; }
    let f = fluege.get(key); if (!f) { f = { laeuft: false, spaeter: null, warten: [] }; fluege.set(key, f); }
    if (f.laeuft) { f.spaeter = feld; f.warten.push(ok); return; }
    lauf(key, f, feld, [ok], spalte);
  });
  // a continuous control: send, on refusal go back to the accepted value unless a newer value is already on its way
  const stetig = (key, feld, wert, zeige, zurueck, nachOk) => {
    schicke(key, feld).then((r) => {
      const f = fluege.get(key);
      if (r === null) { if (!(f?.spaeter) && !gegriffen.has(key)) zurueck(); }
      else { angenommen[key] = wert; nachOk?.(); }
    });
  };

  const pegel = el('div', 'meter senkrecht'); pegel.append(el('i'));
  const fader = el('input', 'live-regler zug-fader'); fader.type = 'range'; fader.setAttribute('type', 'range');
  fader.min = '-60'; fader.max = '6'; fader.step = '0.5'; fader.value = '0'; fader.title = 'Track volume (dB)'; fader.setAttribute('aria-label', 'Track volume');
  fader.addEventListener('pointerdown', () => gegriffen.add('fader'));
  const loslassen = () => gegriffen.delete('fader');
  fader.addEventListener('pointerup', loslassen); fader.addEventListener('pointercancel', loslassen);
  fader.addEventListener('input', () => {
    const v = Number(fader.value); if (spalte) spalte.fader_db = v;
    stetig('fader', { fader_db: v }, v, null, () => { const a = angenommen.fader ?? 0; if (spalte) spalte.fader_db = a; fader.value = String(a); });
  });
  const vf = el('div', 'zug-vf'); vf.append(pegel, fader);

  const knoepfe = {}, knopfReihen = [el('div', 'zug-knoepfe'), el('div', 'zug-knoepfe')];
  KNOEPFE.forEach((d, i) => {
    const key = d.art;
    const opts = d.eq ? { ...EQ_OPT, klasse: 'zug-knopf', label: d.label, titel: d.titel }
      : d.send ? { ...SEND_OPT, klasse: 'zug-knopf', label: d.label, titel: d.titel }
      : { klasse: 'zug-knopf', label: d.label, titel: d.titel };
    const leer = d.eq ? 0 : d.send ? -200 : 0;
    const k = knopf(leer, (v) => {
      if (d.eq) {
        // a killed band shows its knob fully left; turning it takes the kill off in the same request
        const killKey = `kill/${d.eq}`, mein = spalte;
        const loese = !!angenommen[killKey];
        if (mein) { mein.eq = { ...(mein.eq ?? {}), [d.eq]: v }; if (loese) mein.kill = { ...(mein.kill ?? {}), [d.eq]: false }; }
        stetig(key, loese ? { eq: { [d.eq]: v }, kill: { [d.eq]: false } } : { eq: { [d.eq]: v } }, v, null, () => {
          const a = angenommen[key] ?? 0;
          if (mein) { mein.eq = { ...(mein.eq ?? {}), [d.eq]: angenommen[`roh/${d.eq}`] ?? 0 }; mein.kill = { ...(mein.kill ?? {}), [d.eq]: !!angenommen[killKey] }; }
          if (spalte === mein) knoepfe[key].setze(a);
        }, () => { angenommen[`roh/${d.eq}`] = v; if (loese) angenommen[killKey] = false; });   // accepted: the kill is off once the request that carried it went through
      } else if (d.send) {
        if (spalte) spalte.send = { ...(spalte.send ?? {}), [d.send]: v };
        stetig(key, { send: { [d.send]: v } }, v, null, () => { const a = angenommen[key] ?? -200; if (spalte) spalte.send = { ...(spalte.send ?? {}), [d.send]: a }; knoepfe[key].setze(a); });
      } else {
        if (spalte) spalte.filter = v;
        stetig('filter', { filter: v }, v, null, () => { const a = angenommen.filter ?? 0; if (spalte) spalte.filter = a; knoepfe.filter.setze(a); });
      }
    }, opts);
    k.knoten.dataset.art = d.art;
    k.knoten.addEventListener('pointerdown', () => gegriffen.add(key));
    const aus = () => gegriffen.delete(key);
    k.knoten.addEventListener('pointerup', aus); k.knoten.addEventListener('pointercancel', aus);
    const name = el('span', 'zug-name', d.text);
    if (d.art === 'filter') { name.dataset.colorname = '1'; zeigeColorName(name); }
    const einheit = el('div', 'zug-einheit'); einheit.append(k.knoten, name);
    knopfReihen[i < 3 ? 0 : 1].append(einheit); knoepfe[key] = k;
  });

  const msr = el('div', 'zug-msr');
  const mute = taste('zug-m', 'M', 'Mute');
  mute.addEventListener('click', () => {
    const neu = !spalte?.mute, mein = spalte;
    if (mein) mein.mute = neu;
    schalte(mute, neu);
    schicke('mute', { mute: neu }).then((r) => {
      if (r !== null) { angenommen.mute = neu; return; }
      if (fluege.get('mute')?.laeuft || !mein) return;   // a newer click is on its way and decides
      const a = angenommen.mute ?? false; mein.mute = a; if (spalte === mein) schalte(mute, a);
    });
  });
  const projekt = taste('zug-s', 'S', 'Solo');
  const spurFeld = (b, feld, wort, zurueck) => b.addEventListener('click', async () => {
    if (!spalte || !opt.spurAendern) return;
    const neu = !b.classList.contains('an'), mein = spalte;
    schalte(b, neu); mein[feld] = neu;
    inFlug.set(feld, (inFlug.get(feld) ?? 0) + 1);
    let ok = false;
    try { ok = await opt.spurAendern(mein.spur_id, feld, neu, `${neu ? wort : zurueck} ${mein.name ?? mein.kurz ?? ''}`.trim()); }
    finally { inFlug.set(feld, inFlug.get(feld) - 1); }
    if (ok) angenommen[feld] = neu;
    else if (!(inFlug.get(feld) > 0)) { const a = angenommen[feld] ?? false; mein[feld] = a; if (spalte === mein) schalte(b, a); }   // the last accepted value, not the one before the click
  });
  spurFeld(projekt, 'solo', 'Solo', 'Unsolo');
  msr.append(mute, projekt);

  // keys 1 2 3: Beat FX 1, Beat FX 2, FX3 (Remix) of this lane, lit = assigned; the look of the 1 2 3 keys of a mixer channel (style .zug-fx)
  const fxReihe = el('div', 'zug-fxreihe'), fxTasten = {};
  const FX_TITEL = { 1: 'Beat FX 1', 2: 'Beat FX 2', 3: 'FX3 (Remix): this lane passes the Remix together with the other lanes on 3' };
  for (const u of FX_EINHEITEN) {
    const b = taste('zug-fx', u, `Assign this lane to ${FX_TITEL[u]}`); b.dataset.einheit = u;
    b.addEventListener('click', () => {
      const key = `fx/${u}`, neu = !spalte?.fx?.[u], mein = spalte;
      if (mein) mein.fx = { ...(mein.fx ?? {}), [u]: neu };
      schalte(b, neu);
      schicke(key, { fx: { [u]: neu } }).then((r) => {
        if (r !== null) { angenommen[key] = neu; return; }
        if (fluege.get(key)?.laeuft || !mein) return;   // a newer click is on its way and decides
        const a = angenommen[key] ?? false;   // back to what the server last accepted, not to the value before this click
        mein.fx = { ...mein.fx, [u]: a }; if (spalte === mein) schalte(b, a);
      });
    });
    fxReihe.append(b); fxTasten[u] = b;
  }

  z.append(vf, knopfReihen[0], knopfReihen[1], msr, fxReihe);
  slot.append(z);

  function zeichne(neu) {
    spalte = neu && typeof neu === 'object' ? neu : null;
    if (!spalte) return;
    pegel.dataset.kanal = Number.isInteger(spalte.nr) ? `spur/${spalte.nr}` : '';   // the stand names the project track (nr, solo)
    if (frei('fader')) { const v = Number.isFinite(spalte.fader_db) ? spalte.fader_db : 0; angenommen.fader = v; fader.value = String(v); }
    for (const [band] of EQ_BAENDER) {
      const key = `eq/${band}`;
      if (!frei(key)) continue;
      const roh = Number.isFinite(spalte.eq?.[band]) ? spalte.eq[band] : 0, gekillt = !!spalte.kill?.[band], v = gekillt ? -200 : roh;   // a killed band shows its knob fully left
      angenommen[key] = v; angenommen[`roh/${band}`] = roh; angenommen[`kill/${band}`] = gekillt; knoepfe[key].setze(v);
    }
    if (frei('filter')) { const v = Number.isFinite(spalte.filter) ? spalte.filter : 0; angenommen.filter = v; knoepfe.filter.setze(v); }
    for (const art of ['hall', 'delay']) if (frei(art)) { const v = Number.isFinite(spalte.send?.[art]) ? spalte.send[art] : -200; angenommen[art] = v; knoepfe[art].setze(v); }
    for (const u of FX_EINHEITEN) if (frei(`fx/${u}`)) { angenommen[`fx/${u}`] = !!spalte.fx?.[u]; schalte(fxTasten[u], !!spalte.fx?.[u]); }
    if (frei('mute')) { angenommen.mute = !!spalte.mute; schalte(mute, !!spalte.mute); }
    if (frei('solo')) { angenommen.solo = !!spalte.solo; schalte(projekt, !!spalte.solo); }
  }
  return { zeichne, entferne() { z.remove(); } };
}
