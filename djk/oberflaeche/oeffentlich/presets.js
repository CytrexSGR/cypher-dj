// Preset browser panel (package 1.16 "Browser"): list, filter by device, origin, tag and description, search, save current with a
// description, apply, rename, delete.
// Talks only to /presets (presets/bereich.ts). Pure parts first (tested in tests/presets_seite.test.mjs without a browser), then the
// panel class, which renders with innerHTML and listens by delegation on its root, so it needs nothing but that one element.
// What "current values" and "apply" mean depends on where the panel sits; the page passes both in (host.aktuell, host.anwenden).
// The page imports it (app.js, 1.16 preset browser).
import { htmlText, werkzeugAnfrage } from './effekte.js';
import { PRESET_TYP, presetNutzlast } from './produktion/preset_ziel.js';   // 1.16 rest U7: the drag payload (pure, shared with the drop side)

export const HERKUNFT_TEXT = { nutzer: 'MINE', werk: 'FACTORY' };
export const TYP_TEXT = { effekt: 'Effect', instrument: 'Instrument' };
export const FEHLER_TEXT = {   // short page texts; the server's own `text` wins when it sends one
  json_kaputt: 'file damaged', schema_unbekannt: 'newer format', preset_ungueltig: 'file damaged', zu_gross: 'file too large',
  beschreibung_ungueltig: 'description not valid',
};
// Labels of the description fields (the identifiers stay German, the page speaks English)
export const FELD_TEXT = { art: 'kind', unterart: 'sub-kind', charakter: 'character', genre: 'genre', einsatz: 'use', energie: 'energy', text: 'sentence', beschreibung: 'description', familie: 'kind' };
// Prefilled kind when saving a preset of a device (ENTSCHEIDUNGEN.md D15); only a suggestion, the user may pick another kind of the family
export const VORGABE_ART = { komp: 'compressor', eq: 'eq', hall: 'reverb', saett: 'saturation', rb338: 'bass',
  gate: 'compressor', multiband: 'compressor', 'kanal-limiter': 'compressor', utility: 'utility' };   // A8: the kern mix tools (no gate or limiter kind in the vocabulary)

export const presetId = (e) => `${e.herkunft}/${e.geraet}/${e.slug}`;
// The device group matches PRESET_ID of the server (presets/preset_id.ts): device ids carry hyphens ("kanal-limiter").
export function teileId(id) {
  const m = /^(werk|nutzer)\/([a-z0-9-]+)\/([a-z0-9][a-z0-9-]{0,47})$/.exec(String(id));
  return m ? { herkunft: m[1], geraet: m[2], slug: m[3] } : null;
}
/** The register id the server routes take ("werk:komp/drum-bus") from the page id ("werk/komp/drum-bus"); null for a malformed one. */
export function registerId(id) { const t = teileId(id); return t ? `${t.herkunft}:${t.geraet}/${t.slug}` : null; }
export const presetPfad = (id, was = '') => { const t = teileId(id); return t ? `/presets/${t.herkunft}/${t.geraet}/${t.slug}${was}` : null; };

// Same folding as presets/modell.ts falte(): lower case, umlauts spelled out, accents dropped
export function falte(s) {
  return String(s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
}
// Same search rule as presets/modell.ts suchWoerter() and heuhaufen() (the list from the server carries no note)
const suchWoerter = (q) => falte(q).replace(/_/g, ' ').split(/\s+/).filter(Boolean);
function heuhaufen(e, geraete) {
  const b = e.beschreibung;
  const teile = [e.name, ...(e.tags ?? []), e.geraet, geraete.find((g) => g.id === e.geraet)?.titel ?? ''];
  if (b) teile.push(b.text, b.art, b.unterart, ...b.charakter, ...b.genre, ...b.einsatz);
  return falte(teile.join(' ')).replace(/_/g, ' ');
}

// The page filter holds single words from its selects (art, charakter, genre, einsatz) and a minimum energy. In the server's filter
// shape (modell.ts Filter, GET /presets query) that is a one-word list each and energie {min}.
export function alsServerFilter(f) {
  const aus = {};
  for (const k of ['q', 'tag', 'geraet', 'herkunft']) if (f[k]) aus[k] = f[k];
  for (const k of ['art', 'charakter', 'genre', 'einsatz']) if (f[k]) aus[k] = [f[k]];
  if (f.energie) aus.energie = { min: Number(f.energie) };
  return aus;
}
const hatBeschreibungsFilter = (f) => !!(f.art || f.charakter || f.genre || f.einsatz || f.energie);

// Instant filter in the page over the list the server sent (same rule as passt() in presets/modell.ts, without the note)
export function filtere(liste, f, geraete = []) {
  const woerter = suchWoerter(f.q);
  return liste.filter((e) => {
    if (f.geraet && e.geraet !== f.geraet) return false;
    if (f.herkunft && e.herkunft !== f.herkunft) return false;
    if (e.fehler && (woerter.length || f.tag)) return false;   // a damaged file has no searchable content (as speicher.ts liste)
    if (f.tag && !(e.tags ?? []).includes(f.tag)) return false;
    if (hatBeschreibungsFilter(f)) {
      const b = e.beschreibung;
      if (!b) return false;
      if (f.art && b.art !== f.art) return false;
      if (f.charakter && !b.charakter.includes(f.charakter)) return false;
      if (f.genre && !b.genre.includes(f.genre)) return false;
      if (f.einsatz && !b.einsatz.includes(f.einsatz)) return false;
      if (f.energie && b.energie < Number(f.energie)) return false;
    }
    if (woerter.length === 0) return true;
    const heu = heuhaufen(e, geraete);
    return woerter.every((w) => heu.includes(w));
  });
}
// Tags of the presets the device and origin filters leave, sorted, each once
export function tagsVon(liste, f = {}) {
  const s = new Set();
  for (const e of liste) if ((!f.geraet || e.geraet === f.geraet) && (!f.herkunft || e.herkunft === f.herkunft)) for (const t of e.tags ?? []) s.add(t);
  return [...s].sort();
}

// One value for the detail list: numbers rounded to what a knob shows, switches on/off, choices as they are
export function wertText(def, w) {
  if (!def) return String(w);
  if (def.art === 'schalter') return w ? 'on' : 'off';
  if (def.art === 'auswahl') return String(w);
  const n = Number(w);
  if (def.einheit === 'gain') return n > 0 ? `${(20 * Math.log10(n)).toFixed(1)} dB` : '-inf dB';
  const t = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
  return def.einheit ? `${t} ${def.einheit}` : t;
}
export function werteZeilen(preset, geraet) {
  return Object.entries(preset.werte ?? {}).map(([name, w]) => {
    const p = geraet?.parameter.find((x) => x.name === name);
    return { name, titel: p?.titel ?? name, text: wertText(p?.def, w) };
  });
}

export function fehlerText(antwort) {
  const j = antwort?.j ?? {};
  if (j.fehler === 'beschreibung_ungueltig' && j.details) return 'the description needs fixing (see below)';
  return j.text ?? FEHLER_TEXT[j.fehler] ?? `refused (${j.fehler ?? antwort?.code ?? 'no answer'})`;
}

// Vocabulary words are shown with a space for "_" (deep_house → deep house); the value sent stays the word itself
export const wortText = (w) => String(w).replace(/_/g, ' ');
export const energieText = (n) => `${'●'.repeat(n)}${'○'.repeat(Math.max(0, 5 - n))}`;

// One description error as a sentence with the admissible words, for the save form (details from the server, or from pruefeEntwurf)
export function beschreibungsFehlerText(d) {
  const feld = FELD_TEXT[d.feld] ?? d.feld;
  const wert = d.wert === undefined ? '' : JSON.stringify(d.wert);
  const satz = {
    fehlt: `${feld}: missing`,
    unbekanntes_wort: `${feld}: ${wert} is not in the vocabulary`,
    unbekanntes_feld: `${feld}: not a description field`,
    doppelt: `${feld}: ${wert} given twice`,
    anzahl: `${feld}: wrong number of words`,
    widerspruch: `${feld}: ${Array.isArray(d.wert) ? d.wert.join(' and ') : wert} contradict each other`,
    bereich: `${feld}: ${wert} is out of range`,
    laenge: `${feld}: wrong length`,
    satz: `${feld}: must be exactly one sentence ending in . ! or ?`,
    familie: `${feld}: ${wert} does not fit this device`,
    typ: `${feld}: wrong type`,
  }[d.code] ?? `${feld}: ${d.code}`;
  return d.erlaubt?.length ? `${satz}. Allowed: ${d.erlaubt.map(wortText).join(', ')}` : satz;
}

// The save form as typed: lists are words separated by commas or spaces. Kept as text until saved, so a typo stays visible.
export const ENTWURF_FELDER = ['name', 'tags', 'art', 'unterart', 'charakter', 'genre', 'einsatz', 'energie', 'text'];
export const leererEntwurf = (art = '') => ({ name: '', tags: '', art, unterart: '', charakter: '', genre: '', einsatz: '', energie: '', text: '' });
const woerter = (s) => String(s ?? '').split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
export function beschreibungAusEntwurf(e) {
  return { art: e.art ?? '', unterart: e.unterart ?? '', charakter: woerter(e.charakter), genre: woerter(e.genre), einsatz: woerter(e.einsatz),
    energie: e.energie === '' || e.energie === undefined ? undefined : Number(e.energie), text: String(e.text ?? '').trim() };
}
// Quick check in the page before sending, against the vocabulary from GET /presets/vokabular: required fields and words from the
// lists, with the allowed words. Counts, opposites and the one-sentence rule are left to the server, whose answer has the same shape.
export function pruefeEntwurf(b, vok, typ) {
  const f = [];
  if (!vok) return f;
  const fam = vok.inhalt.familien;
  const arten = typ ? Object.keys(fam[typ] ?? {}) : [...Object.keys(fam.instrument), ...Object.keys(fam.effekt)];
  if (!b.art) f.push({ feld: 'art', code: 'fehlt', erlaubt: arten });
  else if (!arten.includes(b.art)) f.push({ feld: 'art', code: 'unbekanntes_wort', wert: b.art, erlaubt: arten });
  const unter = fam.instrument[b.art] ?? fam.effekt[b.art];
  if (unter && !b.unterart) f.push({ feld: 'unterart', code: 'fehlt', erlaubt: unter });
  else if (unter && !unter.includes(b.unterart)) f.push({ feld: 'unterart', code: 'unbekanntes_wort', wert: b.unterart, erlaubt: unter });
  for (const k of ['charakter', 'genre', 'einsatz']) {
    if (k !== 'genre' && b[k].length === 0) f.push({ feld: k, code: 'fehlt', erlaubt: vok.inhalt[k] });
    for (const w of b[k]) if (!vok.inhalt[k].includes(w)) f.push({ feld: k, code: 'unbekanntes_wort', wert: w, erlaubt: vok.inhalt[k] });
  }
  if (b.energie === undefined) f.push({ feld: 'energie', code: 'fehlt', erlaubt: [`${vok.inhalt.energie.min}..${vok.inhalt.energie.max}`] });
  if (!b.text) f.push({ feld: 'text', code: 'fehlt' });
  return f;
}

// The kern's built-in channel compressor (POST /regler <kanal>/komp/<feld>) has the same ranges as the Cypher Komp plugin but its own
// field names; knee, external sidechain and its high-pass do not exist there (knee fixed at 6 dB, mixer.cpp komp_block).
// ENTSCHEIDUNGEN.md D9: a komp preset applied to a channel strip sets these six fields and skips the rest.
export const KERN_KOMP = { thresh: 'schwelle', ratio: 'ratio', attack: 'attack', release: 'release', makeup: 'makeup', mix: 'mix' };
export function kernKompAusPreset(werte) {
  const aus = {}, uebrig = [];
  for (const [name, w] of Object.entries(werte ?? {})) { if (KERN_KOMP[name]) aus[KERN_KOMP[name]] = w; else uebrig.push(name); }
  return { felder: aus, uebrig };
}
// 1.16 rest U3b (F1): a CHANNEL target is applied from the server's plan, not from the copies above: POST /presets/anwenden
// {id, ziel: {art: 'kanal', kanal}} answers {weg: 'regler', anfragen: [{pfad, nach}], uebersprungen}; the page then sends one
// POST /regler per request, as before. The copies above only decide which APPLY buttons are enabled; tests/presets_seite.test.mjs
// holds them equal to the server mapping. `senden(pfad, daten)` is the host's POST ({code, j}).
// Returns {ok: true, anfragen, uebersprungen} or {ok: false, text}: a refusal carries the server's text and no requests.
// `id` is the REGISTER id ("werk:komp/drum-bus") that the panel hands to host.anwenden (registerId() of the page id).
export async function kanalPlanHolen(senden, id, kanal) {
  if (!/^(werk|nutzer):[a-z0-9-]+\/[a-z0-9][a-z0-9-]{0,47}$/.test(String(id))) return { ok: false, text: 'not a preset id', anfragen: [] };
  const r = await senden('/presets/anwenden', { id, ziel: { art: 'kanal', kanal } });
  if (r?.code !== 200 || r.j?.weg !== 'regler' || !Array.isArray(r.j.anfragen)) return { ok: false, text: fehlerText(r), anfragen: [] };
  return { ok: true, anfragen: r.j.anfragen, uebersprungen: r.j.uebersprungen ?? [] };
}
export function presetAusKernKomp(lies) {   // lies(feld) → number | undefined
  const werte = {};
  for (const [name, feld] of Object.entries(KERN_KOMP)) { const w = lies(feld); if (typeof w === 'number' && Number.isFinite(w)) werte[name] = w; }
  return werte;
}

const optionen = (werte, gewaehlt, leer) => `<option value="">${htmlText(leer)}</option>${werte.map((w) => `<option value="${htmlText(w)}"${w === gewaehlt ? ' selected' : ''}>${htmlText(wortText(w))}</option>`).join('')}`;

function beschreibungKurz(b) {
  if (!b) return '';
  return `<span class="preset-art">${htmlText(wortText(b.art))} · ${htmlText(wortText(b.unterart))}</span>`
    + `<span class="preset-charakter">${b.charakter.map((w) => `<i>${htmlText(wortText(w))}</i>`).join('')}</span>`
    + `<span class="preset-energie" title="energy ${b.energie} of 5">${energieText(b.energie)}</span>`;
}

export function panelHtml(z) {
  const geraete = z.geraete ?? [];
  const vok = z.vok ?? null;
  const sichtbar = filtere(z.liste ?? [], z.filter, geraete);
  const tags = tagsVon(z.liste ?? [], z.filter);
  const g = geraete.find((x) => x.id === z.filter.geraet);
  const kannSpeichern = !!(g && z.kannSpeichern?.(g.id));
  const ziehbar = !!z.ziehbar?.();                       // 1.16 rest U7: PRODUCTION (host.ziehbar)
  const ziele = g ? z.ziele?.(g.id) : null;              // PRODUCTION: the tracks / stages of the open project that carry this device (null: DJ view)
  const zielWahl = Array.isArray(ziele) ? (ziele.find((x) => x.wert === z.zielWahl) ?? ziele[0])?.wert : undefined;
  const aus = kannSpeichern ? '' : 'disabled';
  const ent = z.entwurf ?? leererEntwurf();
  const zeile = (e) => {
    const id = presetId(e), an = id === z.gewaehlt;
    const titel = geraete.find((x) => x.id === e.geraet)?.titel ?? e.geraet;
    const b = e.beschreibung;
    const hinweis = e.fehler ? fehlerText({ j: { fehler: e.fehler } }) : b ? `${b.text} Genre: ${b.genre.map(wortText).join(', ') || 'any'}. Use: ${b.einsatz.map(wortText).join(', ')}.` : 'Show values';
    const zieh = ziehbar && !e.fehler;   // 1.16 rest U7: in PRODUCTION a readable row is dragged onto a track or a stage
    return `<li class="preset-zeile${an ? ' an' : ''}${e.fehler ? ' kaputt' : ''}" data-preset-id="${htmlText(id)}"${zieh ? ' draggable="true" data-preset-ziehen' : ''}>
      <button class="preset-name" data-preset-aktion="waehlen" data-preset-id="${htmlText(id)}" title="${htmlText(hinweis)}">${htmlText(e.name)}</button>
      <span class="preset-geraet">${htmlText(titel)}</span>
      <span class="preset-herkunft ${e.herkunft}">${HERKUNFT_TEXT[e.herkunft]}</span>${e.autor === 'cypher' ? '<span class="preset-autor" title="Saved by Cypher">by Cypher</span>' : ''}
      <span class="preset-beschreibung">${beschreibungKurz(b)}</span>
      <span class="preset-tags">${(e.tags ?? []).map((t) => `<i>${htmlText(t)}</i>`).join('')}${e.fehler ? `<i class="preset-fehler">${htmlText(FEHLER_TEXT[e.fehler] ?? e.fehler)}</i>` : ''}</span>
      <span class="preset-knoepfe">
        ${ziehbar ? '' : `<button data-preset-aktion="anwenden" data-preset-id="${htmlText(id)}" ${e.fehler || !z.kannAnwenden?.(e.geraet) ? 'disabled' : ''} title="Apply to the selected channel">APPLY</button>`}
        ${e.herkunft === 'nutzer' ? `<button data-preset-aktion="umbenennen" data-preset-id="${htmlText(id)}" ${e.fehler ? 'disabled' : ''} title="Rename">✎</button><button data-preset-aktion="loeschen" data-preset-id="${htmlText(id)}" title="Delete (moved to the trash folder)">✕</button>` : ''}
      </span></li>`;
  };
  const d = z.detail, db = d?.beschreibung;
  const detail = d
    ? `<div class="preset-detail"><b>${htmlText(d.name)}</b>
      ${db ? `<p class="preset-satz">${htmlText(db.text)}</p><dl class="preset-bdl">
        <dt>Kind</dt><dd>${htmlText(wortText(db.art))} · ${htmlText(wortText(db.unterart))}</dd>
        <dt>Character</dt><dd>${db.charakter.map((w) => htmlText(wortText(w))).join(', ')}</dd>
        <dt>Genre</dt><dd>${db.genre.map((w) => htmlText(wortText(w))).join(', ') || 'any'}</dd>
        <dt>Use</dt><dd>${db.einsatz.map((w) => htmlText(wortText(w))).join(', ')}</dd>
        <dt>Energy</dt><dd title="${db.energie} of 5">${energieText(db.energie)}</dd></dl>` : ''}
      ${d.notiz ? `<p>${htmlText(d.notiz)}</p>` : ''}
      <dl>${werteZeilen(d, geraete.find((x) => x.id === d.geraet)).map((r) => `<dt title="${htmlText(r.name)}">${htmlText(r.titel)}</dt><dd>${htmlText(r.text)}</dd>`).join('')}</dl>
      ${d.verworfen?.length ? `<p class="preset-hinweis">Ignored (no longer in the plugin): ${d.verworfen.map(htmlText).join(', ')}</p>` : ''}</div>`
    : '';
  const I = vok?.inhalt;
  const alleArten = I ? [...Object.keys(I.familien.instrument), ...Object.keys(I.familien.effekt)] : [];
  const filterSelects = I ? `
    <select data-preset-feld="art" aria-label="Kind">${optionen(alleArten, z.filter.art, 'Any kind')}</select>
    <select data-preset-feld="charakter" aria-label="Character">${optionen(I.charakter, z.filter.charakter, 'Any character')}</select>
    <select data-preset-feld="genre" aria-label="Genre">${optionen(I.genre, z.filter.genre, 'Any genre')}</select>
    <select data-preset-feld="einsatz" aria-label="Use">${optionen(I.einsatz, z.filter.einsatz, 'Any use')}</select>
    <select data-preset-feld="energie" aria-label="Minimum energy">${optionen(['1', '2', '3', '4', '5'], z.filter.energie, 'Any energy').replace(/>(\d)</g, (_, n) => `>${n === '1' ? '1 calm' : n === '5' ? '5 peak' : `${n}+`}<`)}</select>` : '';
  const arten = I && g ? Object.keys(I.familien[g.typ] ?? {}) : [];
  const unterarten = I && ent.art ? (I.familien.instrument[ent.art] ?? I.familien.effekt[ent.art] ?? []) : [];
  const fehlerListe = z.fehlerListe?.length
    ? `<ul class="preset-fehlerliste" role="alert">${z.fehlerListe.map((x) => `<li data-preset-fehler-feld="${htmlText(x.feld)}">${htmlText(beschreibungsFehlerText(x))}</li>`).join('')}</ul>` : '';
  const feld = (k, platz, extra = '') => `<input data-preset-entwurf="${k}" value="${htmlText(ent[k] ?? '')}" placeholder="${htmlText(platz)}" ${aus} ${extra}>`;
  return `<div class="preset-kopf" role="search">
    <select data-preset-feld="geraet" aria-label="Device"><option value="">All devices</option>${geraete.map((x) => `<option value="${htmlText(x.id)}"${x.id === z.filter.geraet ? ' selected' : ''}>${htmlText(x.titel)} · ${TYP_TEXT[x.typ]}</option>`).join('')}</select>
    <select data-preset-feld="herkunft" aria-label="Origin"><option value="">Mine and factory</option><option value="nutzer"${z.filter.herkunft === 'nutzer' ? ' selected' : ''}>Mine</option><option value="werk"${z.filter.herkunft === 'werk' ? ' selected' : ''}>Factory</option></select>
    <input type="search" data-preset-feld="q" placeholder="Search name, tag, device, description" value="${htmlText(z.filter.q ?? '')}" autocomplete="off">
  </div>
  <div class="preset-kopf preset-bfilter">${filterSelects}</div>
  ${ziehbar ? '<p class="preset-ziehen-hinweis">Drag a preset onto a track row (instrument or effect) or onto an insert stage.</p>' : ''}
  <div class="preset-tagleiste">${tags.map((t) => `<button data-preset-aktion="tag" data-preset-tag="${htmlText(t)}" class="${t === z.filter.tag ? 'an' : ''}" aria-pressed="${t === z.filter.tag}">${htmlText(t)}</button>`).join('')}</div>
  <div class="preset-rumpf"><ul class="preset-liste" aria-label="Presets">${sichtbar.length ? sichtbar.map(zeile).join('') : `<li class="preset-leer">${z.laedt ? 'Loading…' : 'No presets match.'}</li>`}</ul>${detail}</div>
  <div class="preset-fuss">
    ${Array.isArray(ziele) && ziele.length ? `<select data-preset-ziel aria-label="Save from">${ziele.map((x) => `<option value="${htmlText(x.wert)}"${x.wert === zielWahl ? ' selected' : ''}>${htmlText(x.text)}</option>`).join('')}</select>` : ''}
    ${feld('name', g ? `Name for the current ${g.titel} settings` : 'Pick a device to save its current settings', 'maxlength="64"')}
    ${feld('tags', 'tags, comma separated')}
    ${g?.id === 'baukasten' && !Array.isArray(ziele) ? `<select data-preset-graph aria-label="Graph" ${aus}>${optionen(z.graphen ?? [], z.graph ?? '', 'graph…')}</select>` : ''}
    <button data-preset-aktion="speichern" ${aus} title="Save the current settings of the selected device as a preset; the description is required">SAVE CURRENT</button>
    <span class="preset-meldung${z.meldung?.fehler ? ' fehler' : ''}" role="status">${htmlText(z.meldung?.text ?? '')}</span>
  </div>
  <div class="preset-fuss preset-bform" aria-label="Description (required)">
    <select data-preset-entwurf="art" aria-label="Kind" ${aus}>${optionen(arten, ent.art, 'kind…')}</select>
    <select data-preset-entwurf="unterart" aria-label="Sub-kind" ${aus}>${optionen(unterarten, ent.unterart, 'sub-kind…')}</select>
    ${feld('charakter', 'character: 1 to 6 words')}
    ${feld('genre', 'genre: up to 6 words (may be empty)')}
    ${feld('einsatz', 'use: 1 to 5 words')}
    <select data-preset-entwurf="energie" aria-label="Energy" ${aus}>${optionen(['1', '2', '3', '4', '5'], String(ent.energie ?? ''), 'energy…')}</select>
    ${feld('text', 'One sentence that describes the sound.', 'maxlength="160"')}
    ${fehlerListe}
  </div>`;
}

const VORGABE_HOST = {
  async holen(pfad) { const r = await fetch(pfad); return { code: r.status, j: await r.json() }; },
  async senden(pfad, daten) {
    const r = await fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten ?? {}) });
    return { code: r.status, j: await r.json() };
  },
  bestaetige: (text) => globalThis.confirm?.(text) ?? false,
  frage: (text, vorgabe) => globalThis.prompt?.(text, vorgabe) ?? null,
  ziehbar: () => false,                 // 1.16 rest U7: PRODUCTION rows are dragged onto the arrangement
  ziele: () => null,                    // 1.16 rest U7: PRODUCTION: geraet → [{wert, text, ziel}] of the open project (null: not PRODUCTION, save the values from aktuell)
  aktuell: () => null,                  // geraet → werte | null (null: this device has nothing to save here)
  anwenden: async () => ({ ok: false, text: 'nothing to apply to here' }),
  kannAnwenden: () => false,
  geaendert: () => {},                  // U7 review R1: a preset was saved, renamed or deleted (PRODUCTION: the origin marks are asked again)
};

export class PresetPanel {
  constructor(wurzel, host = {}) {
    this.wurzel = wurzel;
    this.host = { ...VORGABE_HOST, ...host };
    const geraet = host.geraet ?? '';
    this.z = { liste: [], geraete: [], vok: null,
      filter: { q: '', tag: '', geraet, herkunft: '', art: '', charakter: '', genre: '', einsatz: '', energie: '' },
      gewaehlt: null, detail: null, laedt: false, meldung: null, fehlerListe: [], entwurf: leererEntwurf(VORGABE_ART[geraet] ?? ''),
      kannAnwenden: (g) => this.host.kannAnwenden(g), kannSpeichern: (g) => { const zl = this.host.ziele(g); return Array.isArray(zl) ? zl.length > 0 : this.host.aktuell(g) !== null; },
      ziehbar: () => this.host.ziehbar(), ziele: (g) => this.host.ziele(g), zielWahl: null };
    this.gebunden = false;
  }

  zeige() { this.wurzel.innerHTML = panelHtml(this.z); this.zeigeSig = this.signatur(); }
  // 1.16 rest U7: what the panel shows of the host (draggable rows, the save targets of the open project)
  signatur() { const g = this.z.filter.geraet; return JSON.stringify([this.host.ziehbar(), g ? this.host.ziele(g) : null]); }
  // The open project or the view changed: draw again only when that changes what the panel shows (a redraw would take the focus from the form)
  aktualisiereZiele() { if (this.signatur() === this.zeigeSig) return false; this.zeige(); return true; }
  melde(text, fehler = false) { this.z.meldung = { text, fehler }; this.zeige(); }

  async lade() {
    this.z.laedt = true; this.zeige();
    try {
      if (!this.z.geraete.length) { const g = await this.host.holen('/presets/geraete'); if (g.code === 200) this.z.geraete = g.j; }
      if (!this.z.vok) { const v = await this.host.holen('/presets/vokabular'); if (v.code === 200) this.z.vok = v.j; }
      // 1.16 F2: a Baukasten preset names its graph; the instrument graphs the kern knows (a missing route only leaves the list empty)
      if (!this.z.graphen) {
        const gr = await this.host.holen('/graphen');
        this.z.graphen = gr.code === 200 && Array.isArray(gr.j?.graphen) ? gr.j.graphen.filter((x) => x.art === 'instrument').map((x) => x.name).sort() : [];
      }
      const r = await this.host.holen('/presets');
      if (r.code !== 200) return this.melde(`Presets: ${fehlerText(r)}`, true);
      this.z.liste = r.j;
      if (this.z.gewaehlt && !this.z.liste.some((e) => presetId(e) === this.z.gewaehlt)) { this.z.gewaehlt = null; this.z.detail = null; }
    } catch (e) { return this.melde(`Page server unreachable: ${e.message}`, true); }
    finally { this.z.laedt = false; }
    this.zeige();
  }

  setzeFilter(teil) {
    Object.assign(this.z.filter, teil);
    if (teil.geraet !== undefined || teil.herkunft !== undefined) {
      if (this.z.filter.tag && !tagsVon(this.z.liste, this.z.filter).includes(this.z.filter.tag)) this.z.filter.tag = '';
    }
    if (teil.geraet !== undefined) {   // another device: the kind suggestion follows, unless the user already typed a description
      const e = this.z.entwurf;
      if (!e.unterart && !e.charakter && !e.text) { e.art = VORGABE_ART[teil.geraet] ?? ''; }
      this.z.fehlerListe = [];
    }
    this.zeige();
  }

  // Typing in the save form only updates the draft (no re-render, the caret stays); picking a kind re-renders for its sub-kinds
  setzeEntwurf(k, wert) {
    this.z.entwurf[k] = wert;
    if (k === 'art') { this.z.entwurf.unterart = ''; this.zeige(); }
  }

  async waehle(id) {
    this.z.gewaehlt = id;
    const r = await this.host.holen(presetPfad(id));
    this.z.detail = r.code === 200 ? r.j : null;
    if (r.code !== 200) return this.melde(fehlerText(r), true);
    this.zeige();
  }

  async anwenden(id) {
    const r = await this.host.holen(presetPfad(id));
    if (r.code !== 200) return this.melde(fehlerText(r), true);
    const g = this.z.geraete.find((x) => x.id === r.j.geraet);
    const ergebnis = await this.host.anwenden(r.j, g, registerId(id));
    this.melde(ergebnis?.ok ? `Applied ${r.j.name}${ergebnis.text ? ` (${ergebnis.text})` : ''}` : `Not applied: ${ergebnis?.text ?? 'refused'}`, !ergebnis?.ok);
  }

  // Save the current settings of the selected device with a description (required). The page checks the description against the
  // vocabulary first and lists every problem with the allowed words; the server checks again and its refusal is listed the same way.
  // A taken name asks before overwriting, and the overwrite carries the stamp the panel saw, so a preset changed meanwhile in another
  // tab is not silently replaced (409 veraltet).
  async speichere(entwurf = this.z.entwurf) {
    const geraet = this.z.filter.geraet;
    // 1.16 rest U7: in PRODUCTION the server reads the values of a project target (POST /presets/von_ziel); elsewhere the page sends them
    const ziele = geraet ? this.host.ziele(geraet) : null, vonZiel = Array.isArray(ziele);
    const ziel = vonZiel ? (ziele.find((x) => x.wert === this.z.zielWahl) ?? ziele[0])?.ziel : null;
    const werte = !vonZiel && geraet ? this.host.aktuell(geraet) : null;
    if (vonZiel ? !ziel : (!werte || !Object.keys(werte).length)) return this.melde('Nothing to save: pick a device that is loaded here', true);
    const name = String(entwurf.name ?? '');
    const beschreibung = beschreibungAusEntwurf(entwurf);
    const typ = this.z.geraete.find((x) => x.id === geraet)?.typ;
    const vorab = pruefeEntwurf(beschreibung, this.z.vok, typ);
    if (vorab.length) { this.z.fehlerListe = vorab; return this.melde('Not saved: the description needs fixing', true); }
    const tags = String(entwurf.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    if (!vonZiel && geraet === 'baukasten' && !this.z.graph) return this.melde('Not saved: pick the graph of this Baukasten preset', true);
    const koerper = vonZiel ? { ziel, name, beschreibung, tags } : { name, geraet, ...(geraet === 'baukasten' ? { graph: this.z.graph } : {}), werte, beschreibung, tags };
    const pfad = vonZiel ? '/presets/von_ziel' : '/presets';
    let r = await this.host.senden(pfad, koerper);
    if (r.code === 409 && r.j.fehler === 'name_vergeben') {
      const alt = this.z.liste.find((e) => e.herkunft === 'nutzer' && e.geraet === geraet && falte(e.name) === falte(name.trim()));
      if (!this.host.bestaetige(`A preset named "${name.trim()}" already exists. Overwrite it?`)) return this.melde('Not saved');
      r = await this.host.senden(pfad, { ...koerper, ueberschreiben: true, ...(!vonZiel && alt?.geaendert ? { erwartet: alt.geaendert } : {}) });
    }
    if (r.code !== 200 && r.code !== 201) {
      this.z.fehlerListe = r.j?.fehler === 'beschreibung_ungueltig' ? (r.j.details ?? []) : [];
      return this.melde(`Not saved: ${fehlerText(r)}`, true);
    }
    this.z.fehlerListe = [];
    this.z.entwurf = leererEntwurf(VORGABE_ART[geraet] ?? '');
    this.z.gewaehlt = presetId(r.j);
    this.host.geaendert();
    await this.lade();
    if (this.z.gewaehlt) await this.waehle(this.z.gewaehlt);   // lade() drops a selection the list does not hold
    this.melde(`Saved ${name.trim()}`);
    return r.j;
  }

  async umbenennen(id) {
    const e = this.z.liste.find((x) => presetId(x) === id);
    const name = this.host.frage('New name', e?.name ?? '');
    if (name === null || name.trim() === '' || name.trim() === e?.name) return;
    const r = await this.host.senden(presetPfad(id, '/umbenennen'), { name });
    if (r.code !== 200) return this.melde(`Not renamed: ${fehlerText(r)}`, true);
    if (this.z.gewaehlt === id) this.z.gewaehlt = presetId(r.j);
    this.host.geaendert();
    await this.lade();
    this.melde(`Renamed to ${name.trim()}`);
  }

  async loesche(id) {
    const e = this.z.liste.find((x) => presetId(x) === id);
    if (!this.host.bestaetige(`Delete the preset "${e?.name ?? id}"? It is moved to the trash folder.`)) return;
    const r = await this.host.senden(presetPfad(id, '/loeschen'), {});
    if (r.code !== 200) return this.melde(`Not deleted: ${fehlerText(r)}`, true);
    if (this.z.gewaehlt === id) { this.z.gewaehlt = null; this.z.detail = null; }
    this.host.geaendert();
    await this.lade();
    this.melde(`Deleted ${e?.name ?? id}`);
  }

  // Delegated events on the root; the handlers return their promise so tests can await them
  ereignis(art, ev) {
    const t = ev.target;
    if (art === 'input' || art === 'change') {
      const feld = t?.dataset?.presetFeld;
      if (feld === 'q' && art === 'input') { this.setzeFilter({ q: t.value }); this.fokusSuche(); return null; }
      if (feld && feld !== 'q') { this.setzeFilter({ [feld]: t.value }); return null; }
      const k = t?.dataset?.presetEntwurf;
      if (k && ENTWURF_FELDER.includes(k)) this.setzeEntwurf(k, t.value);
      if (t?.dataset?.presetGraph !== undefined) this.z.graph = t.value;
      if (t?.dataset?.presetZiel !== undefined) this.z.zielWahl = t.value;
      return null;
    }
    if (art === 'dragstart') return this.ziehe(ev);
    if (art === 'keydown' && ev.key === 'Enter' && t?.dataset?.presetEntwurf) return this.speichereAusFeldern();
    if (art !== 'click') return null;
    const b = t?.closest?.('[data-preset-aktion]');
    if (!b || b.disabled) return null;
    const id = b.dataset.presetId;
    switch (b.dataset.presetAktion) {
      case 'waehlen': return this.waehle(id);
      case 'anwenden': return this.anwenden(id);
      case 'umbenennen': return this.umbenennen(id);
      case 'loeschen': return this.loesche(id);
      case 'tag': this.setzeFilter({ tag: this.z.filter.tag === b.dataset.presetTag ? '' : b.dataset.presetTag }); return null;
      case 'speichern': return this.speichereAusFeldern();
      default: return null;
    }
  }
  // 1.16 rest U7: a row of the list is dragged (PRODUCTION only); the payload is {id (register id), geraet, name}
  ziehe(ev) {
    const zeile = ev.target?.closest?.('[data-preset-ziehen]');
    const e = this.host.ziehbar() && zeile ? this.z.liste.find((x) => presetId(x) === zeile.dataset.presetId) : null;
    const n = presetNutzlast(e);
    if (!n) { ev.preventDefault?.(); return null; }
    ev.dataTransfer.setData(PRESET_TYP, JSON.stringify(n));
    ev.dataTransfer.effectAllowed = 'copy';
    return null;
  }
  // The fields win over the draft (a value typed without an input event, e.g. pasted by a test or autofill, still counts)
  speichereAusFeldern() {
    for (const k of ENTWURF_FELDER) {
      const f = this.wurzel.querySelector(`[data-preset-entwurf="${k}"]`);
      if (f && typeof f.value === 'string') this.z.entwurf[k] = f.value;
    }
    if (!this.z.entwurf.name.trim()) { this.melde('Type a name first', true); return null; }
    return this.speichere(this.z.entwurf);
  }
  // innerHTML replaces the search field while typing; give focus and caret back
  fokusSuche() {
    const s = this.wurzel.querySelector?.('[data-preset-feld="q"]');
    if (s?.focus) { s.focus(); const n = s.value.length; s.setSelectionRange?.(n, n); }
  }

  binde() {
    if (this.gebunden) return this;
    this.gebunden = true;
    for (const art of ['click', 'input', 'change', 'keydown', 'dragstart']) this.wurzel.addEventListener(art, (ev) => { this.ereignis(art, ev); });
    return this;
  }
}

// 1.16 rest U7: one panel serves two places. While the page is in PRODUCTION (aktiv()) the production host answers (ziehbar, ziele, aktuell,
// kannAnwenden, anwenden); otherwise the DJ host does. `prod()` is looked up per call, so the order of binding does not matter; without it
// (PRODUCTION not bound yet) the DJ host answers and nothing is draggable.
export function hostWechsel(dj, prod, aktiv) {
  const gilt = () => !!aktiv() && !!prod();
  const wahl = (name) => (...a) => (gilt() && prod()[name] ? prod()[name](...a) : dj[name]?.(...a));
  return { ...dj, ziehbar: () => gilt() && !!prod().ziehbar?.(), ziele: (g) => (gilt() ? (prod().ziele?.(g) ?? null) : null),
    aktuell: wahl('aktuell'), kannAnwenden: wahl('kannAnwenden'), anwenden: wahl('anwenden'),
    // U7 review R1: a store change concerns both places (the origin marks of PRODUCTION follow a change made in the DJ view too)
    geaendert: () => { dj.geaendert?.(); prod()?.geaendert?.(); } };
}

// Convenience for the page: build, bind and load in one call
export function bauePresetPanel(wurzel, host) {
  const p = new PresetPanel(wurzel, host).binde();
  p.lade();
  return p;
}

// ---- A8: the kern mix tools as a second kind of device (GET /presets/geraete: herkunft 'kern', kanalArten, pfad per parameter) ----------
// Applying one = one POST /regler per field on the chosen channel, like the compressor above. Switches are stored as true/false and
// sent as 1/0. A channel kind the device does not have (Gate on a bus, Multiband on a source) is refused, never sent.
export const kanalArtVon = (kanal) => (/^(deck\/[1-4]|erz\/[1-7]|pad\/[12])$/.test(kanal) ? 'quelle' : /^bus\/[1-4]$/.test(kanal) ? 'bus' : null);
const ARTEN_TEXT = { quelle: 'source channels (deck, erz, pad)', bus: 'buses' };
export const istKernGeraet = (g) => g?.herkunft === 'kern';
export function kernGeraetAnfragen(g, werte, kanal) {
  if (!istKernGeraet(g)) return { anfragen: [], uebrig: Object.keys(werte ?? {}), fehler: `${g?.titel ?? 'this device'} is a plugin device; the channel strip does not carry it` };
  const art = kanalArtVon(kanal);
  if (!art || !g.kanalArten.includes(art)) {
    return { anfragen: [], uebrig: [], fehler: `${g.titel} works on ${g.kanalArten.map((a) => ARTEN_TEXT[a]).join(' and ')} only, not on ${kanal}` };
  }
  const anfragen = [], uebrig = [];
  for (const [name, w] of Object.entries(werte ?? {})) {
    const p = g.parameter.find((x) => x.name === name);
    if (!p?.pfad) { uebrig.push(name); continue; }
    anfragen.push(werkzeugAnfrage(`${kanal}/${p.pfad}`, typeof w === 'boolean' ? (w ? 1 : 0) : w));
  }
  // Review 1.15: the tool's on switch (<tool>/an) goes last when it switches the tool on and first when it switches it off, so the tool
  // never runs with old settings while the preset is in flight and a refusal midway does not leave it on with a half-applied setting.
  const i = anfragen.findIndex((a) => a.pfad.endsWith('/an') && a.pfad.split('/').length === kanal.split('/').length + 2);
  if (i >= 0) {
    const [an] = anfragen.splice(i, 1);
    if (an.nach >= 0.5) anfragen.push(an); else anfragen.unshift(an);
  }
  return { anfragen, uebrig };
}
/** The live values of a kern device on one channel as a preset's `werte` (switches as booleans), from lies(pfad) → number | undefined.
 *  null: the channel kind does not carry the device, or no value is known. */
export function kernGeraetWerte(g, kanal, lies) {
  const art = kanalArtVon(kanal);
  if (!istKernGeraet(g) || !art || !g.kanalArten.includes(art)) return null;
  const werte = {};
  for (const p of g.parameter) {
    const w = lies(`${kanal}/${p.pfad}`);
    if (typeof w === 'number' && Number.isFinite(w)) werte[p.name] = p.def.art === 'schalter' ? w >= 0.5 : w;
  }
  return Object.keys(werte).length ? werte : null;
}
