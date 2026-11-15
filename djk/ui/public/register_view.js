// CONTROLLERS tab: the read-only controller register (GET /register). Device chips (inactive grey, damaged red) and one table of assignments with a text filter.
const SPALTEN = ['geraet', 'rolle', 'quelle', 'ziel', 'art', 'kurve', 'weg'];
const KOPF = { geraet: 'Device', rolle: 'Role', quelle: 'Source', ziel: 'Target', art: 'Kind', kurve: 'Curve', weg: 'Via' };
const FEHLER_TEXT = { json: 'does not parse', form: 'not a mapping file (version 1 with eintraege)' };

/** Rows of the table: one per edge; the filter matches case-insensitively over all columns. */
export function registerZeilen(daten, filter) {
  const rolle = new Map((daten?.geraete ?? []).map((g) => [g.id, g.rolle]));
  const f = String(filter ?? '').trim().toLowerCase();
  const quelleText = (q) => (q && q.name !== undefined ? String(q.name) : `${q?.typ} ${q?.kanal}/${q?.nr}`);
  const zeilen = (daten?.kanten ?? []).map((k) => ({ geraet: k.geraet, rolle: rolle.get(k.geraet) ?? '', quelle: quelleText(k.quelle), ziel: k.ziel, art: k.art, kurve: k.kurve ?? '', weg: k.weg }));
  return f === '' ? zeilen : zeilen.filter((z) => SPALTEN.some((s) => String(z[s]).toLowerCase().includes(f)));
}

function zelle(tag, text, klasse) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (klasse) e.classList.add(klasse);
  return e;
}

/** Fills `el` with the chips and the table (textContent only: file names and targets come from files). */
export function baueRegister(el, daten, filter) {
  const chips = document.createElement('div');
  chips.classList.add('reg-chips');
  for (const g of daten?.geraete ?? []) {
    const c = zelle('span', `${g.id} ${g.eintraege}${g.leds ? ` +${g.leds} LED` : ''}${g.fehler ? ` (${FEHLER_TEXT[g.fehler] ?? g.fehler})` : ''}`, 'reg-chip');
    if (g.rolle === 'inaktiv') c.classList.add('reg-inaktiv');
    if (g.fehler) c.classList.add('reg-fehler');
    c.setAttribute('title', `${g.datei}: ${g.rolle}`);
    chips.append(c);
  }
  const tabelle = document.createElement('table');
  tabelle.classList.add('reg-tabelle');
  const kopf = document.createElement('tr');
  for (const s of SPALTEN) kopf.append(zelle('th', KOPF[s]));
  tabelle.append(kopf);
  for (const z of registerZeilen(daten, filter)) {
    const tr = document.createElement('tr');
    tr.classList.add('reg-zeile');
    if (z.rolle === 'inaktiv') tr.classList.add('reg-inaktiv');
    for (const s of SPALTEN) tr.append(zelle('td', z[s]));
    tabelle.append(tr);
  }
  el.replaceChildren(chips, tabelle);
}

/**
 * The LEARN row: a target input with a datalist of continuous targets, LEARN / CANCEL, and every learned assignment with a DELETE.
 * `lern` is the learn table as GET /lernen reports it ({zuordnungen, wartet, midi}); `opt.schicken(pfad, daten)` posts to the learn routes,
 * `opt.ziele(q)` answers the paths for the datalist. Only text is set from data.
 */
export function baueLernen(el, lern, opt) {
  const zeile = document.createElement('div');
  zeile.classList.add('reg-lernen');
  const eingabe = document.createElement('input');
  eingabe.setAttribute('type', 'text');
  eingabe.setAttribute('list', 'reg-ziele');
  eingabe.setAttribute('placeholder', 'Target to learn, e.g. deck/1/filter');
  eingabe.classList.add('reg-ziel');
  eingabe.value = opt?.wert ?? '';
  const liste = document.createElement('datalist');
  liste.setAttribute('id', 'reg-ziele');
  eingabe.addEventListener('input', async () => {
    if (opt) opt.wert = eingabe.value;
    const z = (await opt?.ziele?.(eingabe.value)) ?? [];
    liste.replaceChildren(...z.map((p) => { const o = document.createElement('option'); o.setAttribute('value', p); return o; }));
  });
  const wartet = lern?.wartet?.pfad ?? null;
  const knopf = zelle('button', wartet ? 'CANCEL' : 'LEARN', 'reg-learn');
  knopf.setAttribute('type', 'button');
  knopf.addEventListener('click', () => opt?.schicken('/lernen', { pfad: wartet ? null : eingabe.value.trim() }));
  const status = zelle('span', wartet ? `Waiting for a knob: ${wartet}` : lern?.midi?.port ? `MIDI input: ${lern.midi.port}` : 'No MIDI input connected', 'reg-status');
  zeile.append(eingabe, liste, knopf, status);
  const gelernt = document.createElement('div');
  gelernt.classList.add('reg-gelernt');
  for (const z of lern?.zuordnungen ?? []) {
    const r = document.createElement('div');
    r.classList.add('reg-gelernt-zeile');
    const weg = zelle('button', 'DELETE', 'reg-loeschen');
    weg.setAttribute('type', 'button');
    weg.addEventListener('click', () => opt?.schicken('/lernen/loeschen', { pfad: z.pfad }));
    r.append(zelle('span', `${z.pfad}  cc ${z.kanal}/${z.nr}`), weg);
    gelernt.append(r);
  }
  el.replaceChildren(zeile, gelernt);
}

let stand = null, filter = '', inhalt = null, lernEl = null, lernOpt = null, lernHolen = null;
const ziele = async (q) => { try { return ((await (await fetch(`/register/ziele?q=${encodeURIComponent(q)}&limit=50`)).json())?.ziele ?? []).map((z) => z.pfad); } catch { return []; } };
const zeichneLernen = () => { if (lernEl && lernOpt && lernHolen) baueLernen(lernEl, lernHolen.stand(), lernOpt); };
/**
 * Opens the tab: builds the learn row and the filter field once, reads the register and draws it.
 * `lern` = { stand: () => learn table, schicken: (pfad, daten) => Promise, hole: () => Promise } from learn_view.js (injected, so this module
 * stays free of the page's other modules and runs in the page test).
 */
export async function zeigeRegister(wurzel, lern) {
  if (!inhalt) {
    lernEl = document.createElement('div');
    lernEl.classList.add('reg-lernzeile');
    lernHolen = lern ?? null;
    lernOpt = { wert: '', ziele, schicken: async (p, d) => { await lern?.schicken(p, d); zeichneLernen(); } };
    const eingabe = document.createElement('input');
    eingabe.setAttribute('type', 'search');
    eingabe.setAttribute('placeholder', 'Filter by device, source, target, curve');
    eingabe.classList.add('reg-filter');
    inhalt = document.createElement('div');
    inhalt.classList.add('reg-inhalt');
    eingabe.addEventListener('input', () => { filter = eingabe.value; if (stand) baueRegister(inhalt, stand, filter); });
    wurzel.append(lernEl, eingabe, inhalt);
    setInterval(() => { if (!wurzel.hidden) Promise.resolve(lern?.hole?.()).then(zeichneLernen); }, 1500);   // follows the learn events while the tab is open
  }
  await lern?.hole?.();
  zeichneLernen();
  try { stand = await (await fetch('/register')).json(); } catch { /* the page server is gone: keep what is shown */ }
  if (stand) baueRegister(inhalt, stand, filter);
}
