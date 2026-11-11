// PRODUCTION: MIDI import on the page (spec docs/superpowers/specs/2026-11-10-midi-import.md).
// IMPORT MIDI opens a file picker; the file goes to POST /proj/midi_import with vorschau: true (nothing is written), the answer is shown as a short
// preview (tracks, notes, tempo, hints, the instrument of every part) with a checkbox per part; IMPORT sends the same request without vorschau and with
// the chosen parts. The planning, the instruments and the one-step history entry all live on the server: this is the same command the hand tool
// proj_midi_import calls. Pure parts first (tested without a browser), then the binding.

export const MIDI_DATEI_MAX = 8 * 1024 * 1024;   // as the server: bigger files are refused there, the page saves the upload

// reasons of the MIDI import (the server texts in http/reasons.ts are for the hand; these are for the person)
export const MIDI_FEHLER = {
  smf_kein_smf: 'That file is not a Standard MIDI file',
  smf_format2: 'MIDI format 2 (independent sequences) is not supported: save the file as format 0 or 1',
  smf_smpte: 'This MIDI file counts in SMPTE time, not in quarter notes: it cannot be imported',
  smf_beschaedigt: 'The MIDI file is damaged',
  smf_leer: 'The MIDI file holds no track',
  midi_keine_noten: 'The MIDI file holds no notes',
  midi_schluessel_unbekannt: 'A selected part is not in the file any more: choose the file again',
  midi_zu_viele_spuren: 'The project has too few free tracks for these parts: untick some parts',
  midi_zu_lang: 'The MIDI file is longer than a project can hold',
  midi_datei_zu_gross: 'The MIDI file is larger than 8 MiB',
  midi_datei_fehlt: 'The MIDI file could not be read',
};

// Uint8Array → base64 in chunks (String.fromCharCode.apply has an argument limit)
export function base64Von(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const rund = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;
const dauer = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${rund(s)} s`);

// The preview as plain data: head line, one row per part, hints. `offen`: a project is open (the import needs one).
export function vorschauModell(antwort, offen) {
  const b = antwort?.bericht;
  if (!b) return null;
  const d = b.datei, t = b.tempo, k = b.taktart;
  const tempo = t.quelle_bpm === null || t.quelle_bpm === undefined ? 'no tempo in the file'
    : t.gesetzt_bpm === null ? `${rund(t.quelle_bpm)} BPM in the file (project tempo kept)` : `${rund(t.quelle_bpm)} BPM (taken over)`;
  const kopf = [`${d.spuren_mit_noten} of ${d.midi_spuren} MIDI tracks have notes`, `${d.noten} notes`, `${dauer(d.dauer_s)}`, tempo,
    ...(t.aenderungen > 0 ? [`${t.aenderungen} tempo change${t.aenderungen === 1 ? '' : 's'} not carried over`] : []),
    ...(k.abweichend ? [`time signature ${k.quelle[0]}/${k.quelle[1]} in the file, the project is 4/4`] : [])];
  const zeilen = b.spuren.map((x) => ({
    schluessel: x.schluessel, name: x.name, noten: x.noten, schlagzeug: !!x.schlagzeug,
    klang: x.stumm && !x.geraet ? 'no sound' : x.geraet_text ?? (x.geraet ? 'instrument' : 'no sound'),
    stumm: !!x.stumm, mono: x.polyphonie > 1 && x.geraet?.name === 'rb338',
    text: `${x.name} · ${x.noten} notes · ${x.stumm && !x.geraet ? 'no sound' : x.geraet_text ?? 'no sound'}`,
  }));
  const hinweise = (b.hinweise ?? []).map((h) => h.text);
  if (!offen) hinweise.unshift('No project is open: open or create one to import');
  if (b.anlegbar === false) hinweise.unshift(b.grund_text ?? MIDI_FEHLER[b.grund] ?? 'The parts do not fit into the project');
  return { kopf, zeilen, hinweise, anlegbar: b.anlegbar !== false && offen, name: b.datei_name ?? 'MIDI' };
}

// Text of a refused request: the page's text of the reason, then the server's detail where it adds something (numbers, the cause of a damaged file).
// Not for the reasons whose detail only repeats the text (a file that is no MIDI file at all, format 2, SMPTE).
const MIT_DETAIL = new Set(['smf_beschaedigt', 'midi_zu_viele_spuren', 'midi_zu_lang', 'midi_schluessel_unbekannt', 'midi_datei_fehlt']);
export function importFehlerText(r, fehlerText) {
  const grund = r?.j?.fehler ?? r?.j?.grund;
  const text = MIDI_FEHLER[grund] ?? fehlerText(r);
  const detail = r?.j?.detail ?? (grund === 'midi_datei_fehlt' ? r?.j?.text : undefined);
  return typeof detail === 'string' && detail && MIT_DETAIL.has(grund) ? `${text} (${detail})` : text;
}

// the request body: the file, its name, the parts left ticked (only sent when some part is unticked, so "all" stays the server default)
export function importKoerper(daten, name, gewaehlt, alle, extra = {}) {
  const k = { daten_b64: daten, name, ...extra };
  if (gewaehlt.length < alle.length) k.auswahl = gewaehlt;
  return k;
}

export function bindeMidiImport(ctx) {
  const { st, $ } = ctx;
  const gruppe = document.createElement('div');
  gruppe.className = 'p-gruppe p-midi-wahl';
  const knopf = document.createElement('button');
  knopf.dataset.p = 'midi-import'; knopf.textContent = 'IMPORT MIDI'; knopf.disabled = true;
  knopf.title = 'Import a Standard MIDI file: one instrument track with a clip per MIDI track and channel, tempo from the file';
  const datei = document.createElement('input');
  datei.type = 'file'; datei.accept = '.mid,.midi,.rmi,audio/midi,audio/x-midi'; datei.hidden = true; datei.dataset.p = 'midi-datei';
  datei.setAttribute('aria-label', 'MIDI file');
  gruppe.append(knopf, datei);
  $('meldung').before(gruppe);
  const feld = document.createElement('section');
  feld.className = 'p-midi'; feld.hidden = true; feld.dataset.p = 'midi-vorschau'; feld.setAttribute('aria-label', 'MIDI import preview');
  $('verlauf-liste').before(feld);

  let lauf = false, aktuell = null;   // aktuell: { daten, name, modell }
  const sperre = () => { knopf.disabled = !st.projekt || lauf; };
  ctx.beimProjekt.push(() => sperre());
  knopf.addEventListener('click', () => { if (!knopf.disabled) datei.click(); });

  function schliesse() { feld.hidden = true; feld.replaceChildren(); aktuell = null; datei.value = ''; }
  function zeige(modell) {
    const kopf = document.createElement('div'); kopf.className = 'p-midi-kopf';
    kopf.textContent = `${modell.name}: ${modell.kopf.join(' · ')}`;
    const liste = document.createElement('ul'); liste.className = 'p-midi-spuren';
    for (const z of modell.zeilen) {
      const li = document.createElement('li'), l = document.createElement('label'), c = document.createElement('input');
      c.type = 'checkbox'; c.checked = true; c.dataset.schluessel = z.schluessel; c.setAttribute('aria-label', z.name);
      const t = document.createElement('span'); t.textContent = z.text + (z.mono ? ' (chords: one note at a time)' : '');
      l.append(c, t); li.append(l); liste.append(li);
    }
    const hinweise = document.createElement('ul'); hinweise.className = 'p-midi-hinweise';
    for (const h of modell.hinweise) { const li = document.createElement('li'); li.textContent = h; hinweise.append(li); }
    const los = document.createElement('button'); los.dataset.p = 'midi-los'; los.textContent = 'IMPORT'; los.disabled = !modell.anlegbar;
    const weg = document.createElement('button'); weg.dataset.p = 'midi-weg'; weg.textContent = 'CANCEL';
    weg.addEventListener('click', schliesse);
    los.addEventListener('click', () => starte(liste, los));
    feld.replaceChildren(kopf, liste, hinweise, los, weg);
    feld.hidden = false;
  }
  async function starte(liste, los) {
    if (!aktuell || lauf) return;
    const boxen = [...liste.querySelectorAll('input')];
    const gewaehlt = boxen.filter((b) => b.checked).map((b) => b.dataset.schluessel);
    if (gewaehlt.length === 0) { ctx.melde('Tick at least one part', true); return; }
    lauf = true; los.disabled = true; sperre(); ctx.melde('Importing…');
    try {
      await ctx.schreiber.leerWarten();   // our own writes first: the import carries the revision they produced
      const slug = st.slug, rev = st.projekt?.rev;
      const r = await ctx.holeJson('/proj/midi_import', importKoerper(aktuell.daten, aktuell.name, gewaehlt, boxen, { rev }));
      if (r.status !== 200) { ctx.melde(importFehlerText(r, ctx.antwortText), true); if (r.status === 409 && r.j?.fehler === 'rev_veraltet') ctx.ladeAktuell(); return; }
      const n = r.j?.angelegt?.length ?? 0;
      schliesse();
      if (st.slug === slug) ctx.ladeAktuell();
      ctx.melde(`Imported ${n} track${n === 1 ? '' : 's'} from ${r.j?.bericht?.datei_name ?? 'the MIDI file'} (one undo step)`);
    } finally { lauf = false; sperre(); }
  }
  datei.addEventListener('change', async () => {
    const f = datei.files?.[0];
    if (!f) return;
    if (f.size > MIDI_DATEI_MAX) { ctx.melde(MIDI_FEHLER.midi_datei_zu_gross, true); datei.value = ''; return; }
    lauf = true; sperre(); ctx.melde('Reading the MIDI file…');
    try {
      const daten = base64Von(new Uint8Array(await f.arrayBuffer()));
      const name = f.name.replace(/\.(mid|midi|rmi)$/i, '');
      const r = await ctx.holeJson('/proj/midi_import', { daten_b64: daten, name, vorschau: true });
      if (r.status !== 200) { ctx.melde(importFehlerText(r, ctx.antwortText), true); datei.value = ''; return; }
      const modell = vorschauModell(r.j, r.j.offen === true && !!st.projekt);
      if (!modell) { ctx.melde('The server sent no preview', true); return; }
      aktuell = { daten, name, modell };
      zeige(modell);
      ctx.melde('');
    } finally { lauf = false; sperre(); }
  });
}
