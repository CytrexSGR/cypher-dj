// Panel header: preset picker, step buttons and SAVE for a channel front panel. Pure helpers first (tests/panel_kopf.test.mjs), then
// baueKopf, which renders into a host element and talks to the app through callbacks (so the page's own fetch/melde stay in app.js).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The preset tag of a graph name: the tag rule of the store is narrower than the graph name rule (lower case, a-z 0-9 space -, at most 24), so `_` becomes `-`
 *  and the name is cut to 24. '' when nothing valid is left. Two graphs whose names agree up to that cut share a tag (an apply then answers graph_anders). */
export function tagVonGraph(graph) {
  const t = String(graph ?? '').toLowerCase().replace(/_/g, '-').slice(0, 24);
  return /^[a-z0-9][a-z0-9 -]{0,23}$/.test(t) ? t : '';
}

/** Presets of the register that belong to a device. For {art: 'bk', graph}: baukasten entries tagged with the graph; for {art: 'rb338'}: every rb338 entry
 *  (the device has no graph, so no tag filter). Factory (werk) first, then user (nutzer), each by name. */
export function presetsFuer(register, geraet) {
  const alle = register?.eintraege ?? [];
  let aus;
  if (geraet?.art === 'bk') {
    const tag = tagVonGraph(geraet.graph);
    aus = tag ? alle.filter((e) => e.geraet === 'baukasten' && Array.isArray(e.tags) && e.tags.includes(tag)) : [];
  } else if (geraet?.art === 'rb338') aus = alle.filter((e) => e.geraet === 'rb338');
  else return [];
  const nach = (h) => aus.filter((e) => e.herkunft === h).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return [...nach('werk'), ...nach('nutzer')].map((e) => ({ id: e.id ?? `${e.herkunft}:${e.geraet}/${e.slug}`, name: e.name, herkunft: e.herkunft }));
}

/** The device page button in a plate's title bar (app.js appends it to `.fp-kopf` of every plate in #instrumente; one delegated listener finds it by GERAETEKNOPF). `an`: the page is open. */
export const GERAETEKNOPF = '[data-fp-gross]';
export function geraeteknopfHtml(an) {
  return `<button type="button" class="fp-gross" data-fp-gross aria-pressed="${an ? 'true' : 'false'}" title="${an ? 'Close device page (Esc)' : 'Open device page'}" aria-label="${an ? 'Close device page' : 'Open device page'}">${an ? '&#10529;' : '&#10530;'}</button>`;
}

/** The id one step further in the list (wraps both ways). An unknown id gives the first for +1 and the last for -1; an empty list gives ''. */
export function naechstes(liste, id, schritt) {
  if (!liste.length) return '';
  const i = liste.findIndex((p) => p.id === id);
  if (i < 0) return (schritt >= 0 ? liste[0] : liste[liste.length - 1]).id;
  return liste[(i + (schritt >= 0 ? 1 : -1) + liste.length) % liste.length].id;
}

/** Header markup. Everything from names and titles is escaped; `akzent` is used only when it is a #hex colour or one of the seven token names (AKZENTE). `lernen` adds the LEARN toggle; `lernAn` shows it pressed. */
export const AKZENTE = ['rot', 'orange', 'gelb', 'gruen', 'tuerkis', 'blau', 'violett'];
export function kopfHtml({ titel, akzent, presets = [], aktiv = '', lernen = false, lernAn = false } = {}) {
  const farbe = AKZENTE.includes(akzent) ? ` style="--fp-akzent:var(--ak-${akzent})"` : /^#[0-9a-f]{3,8}$/i.test(String(akzent ?? '')) ? ` style="--fp-akzent:${esc(akzent)}"` : '';
  const gewaehlt = presets.find((p) => p.id === aktiv);
  const opts = presets.map((p) => `<option value="${esc(p.id)}"${p.id === aktiv ? ' selected' : ''}>${esc(p.herkunft === 'nutzer' ? `${p.name} (mine)` : p.name)}</option>`).join('');
  return `<div class="fp-presetzeile"${farbe} aria-label="${esc(`Presets of ${titel ?? ''}`)}">`
    + '<button type="button" class="fp-knopf-klein" data-fp-zurueck aria-label="Previous preset" title="Previous preset">&lsaquo;</button>'
    + '<span class="fp-etikett">PRESET</span>'
    + `<select class="fp-preset" aria-label="Preset"${presets.length ? '' : ' disabled'}>${opts}</select>`
    + '<button type="button" class="fp-knopf-klein" data-fp-vor aria-label="Next preset" title="Next preset">&rsaquo;</button>'
    + '<button type="button" class="fp-knopf-klein" data-fp-sichern title="Save the current knob values as a preset">SAVE</button>'
    + (lernen ? `<button type="button" class="fp-knopf-klein${lernAn ? ' an' : ''}" data-fp-lernen aria-pressed="${lernAn ? 'true' : 'false'}" title="MIDI learn: click a control, then move a knob on your controller (right click forgets)">LEARN</button>` : '')
    + `<span class="fp-aktiv">${esc(gewaehlt?.name ?? '')}</span></div>`;
}

/** A valid default description for a preset saved from a panel with no earlier preset to copy it from. The kind comes from the graph name
 *  (drums graphs drums/kit, bass graphs bass/sub, pad graphs pad/atmosphere, key or piano graphs keys/chord, anything else lead/mono); words are checked against the vocabulary
 *  (`inhalt` of GET /presets/vokabular, may be null) and fall back to its first word. One sentence, ends with a full stop. */
const EXPLIZIT = { 'synth-neuro': ['bass', 'sub'], 'synth-poly': ['pad', 'atmosphere'] };   // shipped graphs whose name does not say what they are
function beschreibungAus(wunsch, text, inhalt) {
  const fam = inhalt?.familien?.instrument ?? {};
  const arten = Object.keys(fam);
  const art = !arten.length || arten.includes(wunsch[0]) ? wunsch[0] : arten[0];
  const unter = fam[art] ?? [wunsch[1]];
  return { art, unterart: unter.includes(wunsch[1]) ? wunsch[1] : unter[0], charakter: [inhalt?.charakter?.[0] ?? 'warm'], genre: [], einsatz: [inhalt?.einsatz?.[0] ?? 'drop'],
    energie: 3, text };
}
export function standardBeschreibung(graph, kanal, inhalt) {
  const g = String(graph ?? '');
  const wunsch = EXPLIZIT[g] ?? (/^drum|^perc/.test(g) ? ['drums', 'kit'] : /^bass/.test(g) ? ['bass', 'sub'] : /^pad/.test(g) ? ['pad', 'atmosphere'] : /^(key|piano)/.test(g) ? ['keys', 'chord'] : ['lead', 'mono']);
  return beschreibungAus(wunsch, `Saved from the ${g} panel on channel ${kanal}.`, inhalt);
}
/** The same for a project track: the RB-338 is a bass synth (bass/acid when the vocabulary has the words, else its first sub-kind of bass); a bk track uses the graph name rule. */
export function spurBeschreibung(geraet, inhalt) {
  const text = `Saved from the ${geraet?.art === 'bk' ? geraet.graph : 'RB-338'} panel.`;   // no track name: a name like "Bass. Lead" would break the one-sentence rule
  if (geraet?.art === 'bk') return { ...standardBeschreibung(geraet.graph, '', inhalt), text };
  return beschreibungAus(['bass', 'acid'], text, inhalt);
}

/** Render the header into `host` and wire it. o: { titel, akzent, geraet: {art:'bk', graph}, register(): register|null, aktiv(): id, anwenden(id): Promise<{ok,text}>,
 *  sichern(name): Promise<{ok,text}>, melde(text, fehler), frage?(text): string|null,
 *  lernen?: { an(): boolean, umschalten(): void } (absent: no LEARN button) }. One delegated listener pair on `host` survives every redraw.
 *  Returns { neu() } to re-read register and active id. */
export function baueKopf(host, o) {
  const liste = () => presetsFuer(o.register(), o.geraet);
  const zeichne = () => {
    const presets = liste();
    const aktiv = o.aktiv() ?? '';
    host.innerHTML = kopfHtml({ titel: o.titel, akzent: o.akzent, presets, aktiv, lernen: !!o.lernen, lernAn: !!o.lernen?.an?.() });
    const sel = host.querySelector('select.fp-preset');
    if (sel && !presets.some((p) => p.id === aktiv)) sel.selectedIndex = -1;
  };
  let busy = false;
  const wende = async (id) => {
    if (!id || busy) return;
    busy = true;
    try {
      const r = await o.anwenden(id);
      o.melde(r.text, !r.ok);
    } catch (e) { o.melde(`Preset not applied: ${e.message}`, true); }
    finally { busy = false; zeichne(); }
  };
  const sichere = async () => {
    const name = (o.frage ?? ((t) => globalThis.prompt?.(t)))('Name for the preset');
    if (!name || !name.trim()) return;
    try {
      const r = await o.sichern(name.trim());
      o.melde(r.text, !r.ok);
    } catch (e) { o.melde(`Preset not saved: ${e.message}`, true); }
    zeichne();
  };
  const schritt = (n) => wende(naechstes(liste(), o.aktiv() ?? '', n));
  host.addEventListener('change', (e) => { const sel = e.target?.closest?.('select.fp-preset'); if (sel) wende(sel.value); });
  host.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button');
    if (!b) return;
    if (b.hasAttribute('data-fp-zurueck')) schritt(-1);
    else if (b.hasAttribute('data-fp-vor')) schritt(1);
    else if (b.hasAttribute('data-fp-sichern')) sichere();
    else if (b.hasAttribute('data-fp-lernen')) { o.lernen?.umschalten(); zeichne(); }
  });
  zeichne();
  return { neu: zeichne };
}

// ---- Cypher Space: room selector and LOAD IR (the header of a stage panel whose graph is `fx-space` or a `space-*` graph) ----

/** The four shipped rooms of Cypher Space: each is a graph of its own (they differ only in the impulse response file of the node `raum`). */
export const SPACE_RAEUME = [
  { text: 'Hall', graph: 'fx-space' }, { text: 'Room', graph: 'space-raum' }, { text: 'Plate', graph: 'space-platte' }, { text: 'Chamber', graph: 'space-kammer' },
];
/** The six knobs every Space graph has with the same meaning: their values carry over when the room (the graph) of a stage is swapped. */
export const SPACE_KNOEPFE = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'];
const SPACE_KOPIE = /^space-[0-9a-f]{6}$/;

/** Does the graph belong to Cypher Space: `fx-space` or any `space-*` graph (a room, or a copy with the user's impulse response). */
export const istSpace = (graph) => graph === 'fx-space' || (typeof graph === 'string' && graph.startsWith('space-'));

/** The text after "Room: " of the first text label of a Space panel (the file title of a copy); '' when the panel has none. */
export function raumNameAusPanel(panel) {
  for (const s of panel?.sections ?? []) for (const c of s.controls ?? []) {
    if (c.type === 'label' && typeof c.text === 'string') return c.text.replace(/^Room:\s*/, '').replace(/\.\s*Other rooms:.*$/, '').trim();
  }
  return '';
}

/** The entries of the room selector for the graph a stage runs: the four rooms, and for a copy `space-<6 hex>` a fifth entry (value = the copy, text = `kopieName`,
 *  "Loaded IR" without a name) that is the selected one. For a shipped room that room is selected. [] for a graph that is no Space graph. */
export function raumEintraege(graph, kopieName = '') {
  if (!istSpace(graph)) return [];
  const liste = SPACE_RAEUME.map((r) => ({ wert: r.graph, text: r.text, gewaehlt: r.graph === graph }));
  if (SPACE_KOPIE.test(graph)) liste.push({ wert: graph, text: String(kopieName ?? '').trim() || 'Loaded IR', gewaehlt: true });
  return liste;
}

/** The header row of a Space stage: room selector and LOAD IR. '' for a graph that is no Space graph. Names are escaped. */
export function raumKopfHtml(graph, kopieName = '') {
  const eintraege = raumEintraege(graph, kopieName);
  if (!eintraege.length) return '';
  const opts = eintraege.map((e) => `<option value="${esc(e.wert)}"${e.gewaehlt ? ' selected' : ''}>${esc(e.text)}</option>`).join('');
  return '<div class="fp-presetzeile fp-raumzeile" aria-label="Room of Cypher Space">'
    + '<span class="fp-etikett">ROOM</span>'
    + `<select class="fp-preset fp-raum" aria-label="Room">${opts}</select>`
    + '<button type="button" class="fp-knopf-klein" data-fp-ir title="Load your own impulse response (a file of a sample folder, up to 2 s)">LOAD IR</button></div>';
}

/** The command list that swaps the graph of the stage at `pos` of a strip: ONE `insert_setzen` that replaces the stage (`ersetzen`) and carries the six knob values
 *  of the old stage, so one undo step brings back room and values. Values that are no numbers are left out (the new stage starts there at the graph's default).
 *  A replacement starts on: a bypassed stage is switched off again by the caller (its new id is not known before). */
export function raumTauschBefehle({ strangId, pos, graph, werte = {} }) {
  const w = {};
  for (const k of SPACE_KNOEPFE) if (typeof werte[k] === 'number' && Number.isFinite(werte[k])) w[k] = werte[k];
  return [{ befehl: 'insert_setzen', strang_id: strangId, pos, art: 'bk', graph, ersetzen: true, ...(Object.keys(w).length ? { werte: w } : {}) }];
}
