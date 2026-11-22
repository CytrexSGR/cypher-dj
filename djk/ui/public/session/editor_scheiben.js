// SESSION clip editor, S1b lane E: the SLICES tab (spec §7 "Clip editor", mockup v5). The slice grid of the cell (`scheiben`: grenzen and folge, plan 2.1),
// 16 pads per page, the play order and the two ways out (a sampler instrument, a new cell). Registered by editor.js (`registriereTab('SLICES', scheibenTab)`);
// this file does not import editor.js, so the two do not form an import cycle. ctx: { zelle, spalte, index, sende(weg, daten), melde, waehle } of editor.js.
import { daumen } from './waves.js';

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const taste = (klasse, text, titel) => { const b = el('button', klasse, text); b.type = 'button'; b.setAttribute('type', 'button'); if (titel) b.title = titel; return b; };

export const PADS_PRO_SEITE = 16;
const TEILUNGEN = [['1/16', '1/16'], ['1/8', '1/8'], ['transienten', 'TRANSIENTS'], ['takt', 'BARS']];
const ORDNUNGEN = [['reset', 'RESET'], ['reverse', 'REVERSE'], ['shuffle', 'SHUFFLE'], ['stutter', 'STUTTER']];
export const NEUE_ZELLE_TITEL = "Renders dry: the re-ordered slices with reverse, gain and fade. Rendering with the track's devices comes in a later slice (resample of the track tap)";

// The new play order for one of the PLAY ORDER buttons. folge: the current order (entries 1..n). reset 1..n; reverse n..1 (of the slots, not of the current
// order); shuffle a permutation (Fisher-Yates with `zufall`); stutter: every second slot repeats the one before it.
export function folgeNeu(aktion, folge, zufall = Math.random) {
  const n = folge.length;
  if (aktion === 'reset') return Array.from({ length: n }, (_, i) => i + 1);
  if (aktion === 'reverse') return Array.from({ length: n }, (_, i) => n - i);
  if (aktion === 'shuffle') {
    const f = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) { const j = Math.min(i, Math.floor(zufall() * (i + 1))); [f[i], f[j]] = [f[j], f[i]]; }
    return f;
  }
  if (aktion === 'stutter') { const f = [...folge]; for (let i = 1; i < n; i += 2) f[i] = f[i - 1]; return f; }
  return [...folge];
}

function segment(optionen, aktiv, beiWahl, klasse) {
  const s = el('div', `seg ${klasse}`);
  for (const [wert, text] of optionen) {
    const b = taste('seg-b', text); b.dataset.wert = String(wert);
    b.classList.toggle('an', wert === aktiv); b.setAttribute('aria-pressed', String(wert === aktiv));
    b.addEventListener('click', () => beiWahl(wert));
    s.append(b);
  }
  return s;
}

export const scheibenTab = {
  passt: (z) => !!z && !z.halten && (z.art === 'loop' || z.art === 'einmal'),
  baue(wurzel, c) {
    const z = c.zelle, sch = z.scheiben ?? null, n = sch?.grenzen?.length ?? 0;
    const kopf = el('div', 'ed-zeile sl-kopf');
    kopf.append(el('label', 'sl-etikett', 'SLICE BY'), segment(TEILUNGEN, sch?.teilung ?? null, (t) => c.sende('/session/scheiben', { teilung: t }), 'sl-teilung'));
    wurzel.append(kopf);
    if (!sch || n === 0) return;

    const schreibeFolge = (folge) => c.sende('/session/zelle', { scheiben: { teilung: sch.teilung, grenzen: sch.grenzen, folge } });
    const folge = Array.isArray(sch.folge) && sch.folge.length === n ? sch.folge : Array.from({ length: n }, (_, i) => i + 1);

    kopf.append(el('label', 'sl-etikett', 'PLAY ORDER'), segment(ORDNUNGEN, null, (a) => schreibeFolge(folgeNeu(a, folge)), 'sl-ordnung'));
    const sampler = taste('sl-aus sl-sampler', '→ SAMPLER INSTRUMENT', 'The played slots become the sounds of a new sampler kit');
    sampler.addEventListener('click', async () => {
      const r = await c.sende('/session/zum_sampler', {});
      if (r) c.melde?.(`Sampler kit${r.kit ? ` "${r.kit}"` : ''} created`, false);
    });
    const neu = taste('sl-aus sl-neuzelle', '→ NEW CELL', NEUE_ZELLE_TITEL);
    neu.addEventListener('click', async () => {
      const r = await c.sende('/session/neue_zelle', {});
      if (r && r.spur_id !== undefined && r.zelle !== undefined) c.waehle?.(r.spur_id, r.zelle);
    });
    kopf.append(sampler, neu);

    const beats = z.beats > 0 ? z.beats : Math.max(1, ...sch.grenzen);
    const wv = el('div', 'ed-welle sl-welle'); wv.dataset.sha = z.sha256 ?? '';
    sch.grenzen.forEach((g, k) => {
      const m = el('i', 'sl-marke'); m.style.left = `${Math.max(0, Math.min(100, g / beats * 100))}%`; m.dataset.slice = String(k + 1);
      m.append(el('span', 'sl-nr', String(k + 1)));
      wv.append(m);
    });
    if (z.sha256) daumen(z.sha256, 480, 30).then((k) => { if (k && wv.isConnected !== false) wv.prepend(k); }, () => {});

    const unten = el('div', 'sl-unten');
    const seiten = Math.ceil(n / PADS_PRO_SEITE);
    const zs = c.zustand ?? {};
    let seite = Math.min(Math.max(0, zs.seite ?? 0), seiten - 1);
    const setzeSeite = (v) => { seite = v; zs.seite = v; };
    const pads = el('div', 'sl-pads');
    const nav = seiten > 1 ? el('div', 'sl-nav') : null;
    const zeichnePads = () => {
      pads.replaceChildren();
      for (let k = seite * PADS_PRO_SEITE; k < Math.min(n, (seite + 1) * PADS_PRO_SEITE); k++) {
        const p = taste('sl-pad', String(k + 1), `Slice ${k + 1}: play it`); p.dataset.slot = String(k + 1);
        p.addEventListener('click', () => c.sende('/session/vorhoeren', { slot: k + 1 }));
        pads.append(p);
      }
      if (nav) {
        nav.replaceChildren();
        const zu = taste('sl-zurueck', '‹', 'Previous 16 slices'), vor = taste('sl-vor', '›', 'Next 16 slices');
        zu.disabled = seite === 0; vor.disabled = seite >= seiten - 1;
        zu.addEventListener('click', () => { if (seite > 0) { setzeSeite(seite - 1); zeichnePads(); } });
        vor.addEventListener('click', () => { if (seite < seiten - 1) { setzeSeite(seite + 1); zeichnePads(); } });
        nav.append(zu, el('span', 'sl-seite', `${seite + 1}/${seiten}`), vor);
      }
    };
    zeichnePads();
    unten.append(pads); if (nav) unten.append(nav);

    const ordnung = el('div', 'sl-folge');
    folge.forEach((q, k) => {
      const e = taste('sl-fe', String(q), `Slot ${k + 1} plays slice ${q} (click: next slice)`);
      e.classList.toggle('geaendert', q !== k + 1);
      e.addEventListener('click', () => schreibeFolge(folge.map((x, i) => (i === k ? (x % n) + 1 : x))));
      ordnung.append(e);
    });
    wurzel.append(wv, unten, ordnung);
  },
};
