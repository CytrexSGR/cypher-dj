// Workbench SOUND region, sampler C task 5: TO TONE on the cut strip and the ROOT box of a tone track.
//
// TO TONE (C-D11) is a button the strip draws after FIT (the action hook of schnitt_streifen.js). It is active while the selection of slices is not empty and
// contiguous, sends POST /sampler/ton {id, von, bis, spur: true} (0-based indices) and selects the NOTE track the server made.
//
// The ROOT box is shown while the selected track plays a tone device (instrument intern/bk, graph `ton-...`): a selector of the root note (MIDI 16..95, named as
// the piano roll names it) and the text of the detection. The tone is fetched when the selected track's graph changes; a change of the selector sends
// POST /sampler/ton/grund and a refusal puts the selector back.
//
// Markup: div[data-w="ton"] (inserted after the strip host, hidden unless the track plays a tone) holding select[data-w="ton-grund"] and span[data-w="ton-erkannt"].
import { tonName } from '../production/pianoroll.js';

export const TON_TEXT = {
  knopf: 'TO TONE', titel: 'Make the selected slice, or a run of neighbouring slices, a tone on a new NOTE track',
  wurzel: 'ROOT', wurzelTitel: 'The note at which the slice plays at its original pitch',
  erkannt: 'Detected', keinTon: 'No clear pitch', zuversicht: 'confidence',
};
const GRUND_MIN = 16, GRUND_MAX = 95;   // MIDI notes of the block's root range 20..2000 Hz

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const markiere = (e, name) => { e.setAttribute('data-w', name); return e; };
const grossAnfang = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
// a reason the page has no text for (the sampler routes carry their own English text) shows the text of the answer, as the strip does
const refusalText = (ctx, r) => {
  const t = ctx.antwortText(r);
  return t.startsWith('Rejected:') && typeof r?.j?.text === 'string' && r.j.text !== '' ? grossAnfang(r.j.text) : t;
};
const QUELLE_TEXT = { erkannt: 'from detection', vorgabe: 'default', hand: 'set by hand' };
const quelleText = (quelle, tonart) => (quelle === 'tonart' ? `from the key${tonart ? ` ${tonart}` : ''}` : QUELLE_TEXT[quelle] ?? quelle);
const zusammenhaengend = (s) => s.length > 0 && s.every((x, k) => k === 0 || x === s[k - 1] + 1);

export function bindeSchnittTon(ctx, streifenHost) {
  const { st } = ctx;

  // ---- TO TONE ----
  let laeuft = false;
  async function lauf(wahl) {
    if (laeuft || !zusammenhaengend(wahl.scheiben)) return;
    const slug = st.slug;
    laeuft = true; ctx.zeichneSchnitt();
    try {
      const r = await ctx.holeJson('/sampler/ton', { id: wahl.schnitt_id, von: wahl.scheiben[0], bis: wahl.scheiben.at(-1), spur: true });
      if (r.status !== 200 || !r.j?.projekt) { ctx.melde(refusalText(ctx, r), true); return; }   // a refusal keeps the selection and the track as they were
      const t = r.j.ton;
      if (st.slug === slug) {
        ctx.uebernimm(slug, r.j.projekt);
        if (typeof r.j.spur_id === 'string') ctx.waehle(r.j.spur_id);
      }
      ctx.melde(`Tone ${t.name}: root ${tonName(t.grund)} (${quelleText(t.grund_quelle, r.j.tonart)})`);
    } finally { laeuft = false; ctx.zeichneSchnitt(); }
  }
  (ctx.schnittAktionen ??= []).push({ id: 'ton', text: TON_TEXT.knopf, titel: TON_TEXT.titel, aktiv: (wahl) => !laeuft && zusammenhaengend(wahl.scheiben), lauf });
  ctx.zeichneSchnitt();

  // ---- the ROOT box ----
  const box = markiere(el('div', 'w-ton'), 'ton');
  box.hidden = true;
  const wahl = markiere(el('select', 'w-ton-grund'), 'ton-grund');
  wahl.setAttribute('title', TON_TEXT.wurzelTitel);
  for (let n = GRUND_MIN; n <= GRUND_MAX; n++) { const o = el('option', '', tonName(n)); o.value = String(n); wahl.append(o); }
  const erkanntEl = markiere(el('span', 'w-ton-erkannt'), 'ton-erkannt');
  box.append(el('span', 'w-ton-name', TON_TEXT.wurzel), wahl, erkanntEl);
  streifenHost.after(box);

  let graph = null, ton = null, tonart = null, anfrage = 0;
  const spurJetzt = () => (st.projekt?.spuren ?? []).find((s) => s.id === st.wahl && s.art === 'instrument') ?? null;
  const tonGraph = () => {
    const g = spurJetzt()?.geraet;
    return g?.art === 'intern' && g.name === 'bk' && typeof g.graph === 'string' && g.graph.startsWith('ton-') ? g.graph : null;
  };
  function zeige() {
    if (!ton) return;
    wahl.value = String(ton.grund);
    const e = ton.erkannt ?? { note: null, konfidenz: 0 };
    const kopf = e.note === null || e.note === undefined ? TON_TEXT.keinTon : `${TON_TEXT.erkannt} ${tonName(e.note)}`;
    const wo = ton.grund_quelle === 'tonart' ? ` · root from the key${tonart ? ` ${tonart}` : ''}` : ton.grund_quelle === 'vorgabe' ? ` · root ${tonName(ton.grund)} (default)`
      : ton.grund_quelle === 'hand' ? ' · root set by hand' : '';
    erkanntEl.textContent = `${kopf} · ${TON_TEXT.zuversicht} ${Number(e.konfidenz ?? 0).toFixed(2)}${wo}`;
  }
  async function lade(g) {
    const nr = ++anfrage;
    const r = await ctx.holeGet(`/sampler/ton?graph=${encodeURIComponent(g)}`);
    if (nr !== anfrage || g !== graph) return;   // another track was selected meanwhile
    if (r.status === 200 && r.j?.ton) { ton = r.j.ton; tonart = r.j.tonart ?? null; zeige(); } else erkanntEl.textContent = refusalText(ctx, r);
  }
  function aktualisiere() {
    const g = tonGraph();
    if (g === null) { box.hidden = true; graph = null; ton = null; anfrage++; return; }
    box.hidden = false;
    if (g === graph) return;
    graph = g; ton = null; tonart = null; erkanntEl.textContent = '';
    lade(g);
  }
  wahl.addEventListener('change', async () => {
    if (!ton || graph === null) { return; }
    const g = graph, neu = Number(wahl.value);
    const r = await ctx.holeJson('/sampler/ton/grund', { graph: g, grund: neu });
    if (g !== graph || !ton) return;             // another track was selected meanwhile: nothing here belongs to it any more
    if (r.status !== 200 || !r.j?.ton) { wahl.value = String(ton.grund); ctx.melde(refusalText(ctx, r), true); return; }
    ton = r.j.ton; tonart = r.j.tonart ?? tonart; zeige();
    if (typeof r.j.neu_laden_fehler === 'string') ctx.melde(grossAnfang(r.j.neu_laden_fehler), true);
    else ctx.melde(`Root ${tonName(ton.grund)}`);
  });
  ctx.beiWahl.push(() => aktualisiere());
  ctx.beimProjekt.push(() => aktualisiere());
  aktualisiere();
}
