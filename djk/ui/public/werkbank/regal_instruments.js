// Workbench shelf tab INSTRUMENTS (sample player stage 2): the stored multisample instruments, each with TO TRACK and DELETE.
// Routes (page server): GET /sampler/instrumente {instrumente: [{id, name, noten, zonen, bytes, erstellt, schleifen?, release?}]}, POST /sampler/instrument/spur {id},
// POST /sampler/instrument/loeschen {id} (refused while something plays it; the text names the places). Class names carry the prefix w-ins-.
import { groesseText, mehrzahl } from './regal_samples.js';

export const INSTRUMENTE_TEXT = {
  hint: 'TO TRACK puts an instrument on a new track · DELETE removes an instrument that nothing plays',
  leer: 'No instruments yet. Open a folder of note samples in SAMPLES and use INSTRUMENT TO TRACK.',
  liest: 'Reading…',
  liestLang: 'Reading instruments… the first read can take a few seconds',
  keinModul: 'Open a module first.',
  spurTitel: 'Put this instrument on a new track',
  wegTitel: 'Delete this instrument with its samples',
};
// what the empty list says while the read runs: the short text first, the long one after 1 s, with the seconds once the read passes 3 s
export const liestText = (ms) => (ms < 1000 ? INSTRUMENTE_TEXT.liest : ms < 3000 ? INSTRUMENTE_TEXT.liestLang : `${INSTRUMENTE_TEXT.liestLang} (${Math.floor(ms / 1000)} s)`);
export const loeschFrage = (name) => `Delete the instrument "${name}"? This cannot be undone.`;

// the rows of the answer of GET /sampler/instrumente: a broken entry (no id or name) is left out; newest first, then by name
export function instrumentZeilen(antwort) {
  const liste = Array.isArray(antwort?.instrumente) ? antwort.instrumente : [];
  return liste.filter((x) => typeof x?.id === 'string' && typeof x?.name === 'string').map((x) => ({
    id: x.id, name: x.name, erstellt: typeof x.erstellt === 'string' ? x.erstellt : '',
    info: [mehrzahl(x.noten ?? 0, 'note', 'notes'), mehrzahl(x.zonen ?? 0, 'zone', 'zones'),
      ...(x.schleifen > 0 ? ['looped'] : []), ...(x.release > 0 ? [`${x.release} release`] : [])].join(' · '),
    groesse: groesseText(x.bytes),
  })).sort((a, b) => b.erstellt.localeCompare(a.erstellt) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const markiere = (e, name) => { e.setAttribute('data-w', name); return e; };

// opt.host: the element the tab draws into; opt.setzeHinweis(text|null); opt.refusalText(r). Returns {zeige, verberge, lade}.
export function bindeInstrumente(ctx, { host, setzeHinweis = () => {}, refusalText = (r) => ctx.antwortText(r) }) {
  const { st } = ctx;
  let aktiv = false, daten = null, fehler = null, nr = 0, macht = false, liestSeit = null, liestUhr = null;
  const wurzelEl = el('div', 'w-ins');
  const liste = el('div', 'w-ins-liste');
  wurzelEl.append(liste);

  // the search view (regal_suche.js) draws rows of this binder into its own host: their buttons follow the same state
  const fremde = new Set();
  const alle = (sel) => [liste, ...fremde].flatMap((h) => [...h.querySelectorAll(sel)]);
  const zeigeKnoepfe = () => {
    for (const b of alle('[data-w="instrument-spur"]')) {
      b.disabled = !st.projekt || macht;
      b.setAttribute('title', st.projekt ? INSTRUMENTE_TEXT.spurTitel : INSTRUMENTE_TEXT.keinModul);
    }
    for (const b of alle('[data-w="instrument-weg"]')) b.disabled = macht;
  };
  // one row of a stored instrument (`z` as instrumentZeilen gives it)
  function baueZeile(z) {
    const r = markiere(el('div', 'w-ins-zeile'), 'instrument-zeile'); r.setAttribute('data-id', z.id); r.setAttribute('title', z.id);
    r.append(el('span', 'w-ins-name', z.name), el('span', 'w-ins-info', z.info), el('span', 'w-ins-groesse', z.groesse));
    const spur = el('button', 'w-ins-knopf', 'TO TRACK'); spur.type = 'button'; markiere(spur, 'instrument-spur');
    spur.addEventListener('click', () => zuSpur(z));
    const weg = el('button', 'w-ins-knopf', 'DELETE'); weg.type = 'button'; markiere(weg, 'instrument-weg');
    weg.setAttribute('title', INSTRUMENTE_TEXT.wegTitel);
    weg.addEventListener('click', () => loesche(z));
    r.append(spur, weg);
    return r;
  }
  function zeichne() {
    if (!daten) { liste.replaceChildren(el('div', 'w-ins-leer', fehler ?? liestText(liestSeit !== null ? Date.now() - liestSeit : 0))); return; }
    const zeilen = instrumentZeilen(daten).map(baueZeile);
    liste.replaceChildren(...(zeilen.length ? zeilen : [el('div', 'w-ins-leer', INSTRUMENTE_TEXT.leer)]));
    zeigeKnoepfe();
  }
  async function lade() {
    const mein = ++nr;
    // while nothing is read yet, the text grows with the wait; the timer lives only as long as this request
    if (!daten) {
      liestSeit = Date.now(); clearTimeout(liestUhr);
      const tick = () => { if (mein !== nr || daten || liestSeit === null) return; if (aktiv) zeichne(); liestUhr = setTimeout(tick, 1000); };
      liestUhr = setTimeout(tick, 1000);
    }
    const r = await ctx.holeGet('/sampler/instrumente');
    if (mein !== nr) return;   // a newer request is on its way
    clearTimeout(liestUhr); liestSeit = null;
    const ok = r.status === 200 && Array.isArray(r.j?.instrumente);
    daten = ok ? r.j : daten;
    fehler = ok ? null : refusalText(r);
    if (aktiv) zeichne();
  }
  async function zuSpur(z) {
    if (macht) return;
    if (!st.projekt) { ctx.melde(INSTRUMENTE_TEXT.keinModul, true); return; }
    const slug = st.slug;
    macht = true; zeigeKnoepfe();
    try {
      const r = await ctx.holeJson('/sampler/instrument/spur', { id: z.id });
      if (r.status !== 200 || !r.j?.projekt) { ctx.melde(refusalText(r), true); return; }
      if (st.slug !== slug) { ctx.melde('The track was added to the module you just left.'); return; }
      ctx.uebernimm(slug, r.j.projekt);
      if (typeof r.j.spur_id === 'string') ctx.waehle(r.j.spur_id);
      if (typeof r.j.text === 'string' && r.j.text !== '') ctx.melde(r.j.text);
    } finally { macht = false; zeigeKnoepfe(); }
  }
  async function loesche(z) {
    if (macht || !ctx.frage(loeschFrage(z.name))) return;
    macht = true; zeigeKnoepfe();
    try {
      const r = await ctx.holeJson('/sampler/instrument/loeschen', { id: z.id });
      if (r.status !== 200) ctx.melde(refusalText(r), true);
    } finally { macht = false; zeigeKnoepfe(); lade(); ctx.beiInstrumentGeaendert?.(); }
  }

  ctx.beimProjekt.push(() => { if (aktiv) zeigeKnoepfe(); });
  ctx.beimSichtwechsel.push((sichtbar) => { if (sichtbar && aktiv) lade(); });
  // a build that ended while this tab is shown adds a row (regal_samples.js calls it)
  const vorher = ctx.beiInstrumentGebaut;
  ctx.beiInstrumentGebaut = () => { vorher?.(); if (aktiv) lade(); };

  return {
    lade,
    // the search view: the row of the stored instrument `z` (a hit of GET /suche is the row of GET /sampler/instrumente) for `suchHost`
    zeileFuer(z, suchHost) { fremde.add(suchHost); const [r] = instrumentZeilen({ instrumente: [z] }); return r ? baueZeile(r) : null; },
    zeigeKnoepfe,
    zeige() { aktiv = true; setzeHinweis(null); host.replaceChildren(wurzelEl); zeichne(); if (st.sichtbar) lade(); },
    verberge() { aktiv = false; setzeHinweis(null); },
  };
}
