// Workbench file export (top bar): EXPORT WAV (the mix, every track alone, every fed return wet) and EXPORT MIDI (the notes, all parts in one file and
// one file per part). Both write a new folder into the export/ folder of the module; the result panel under the top bar shows the folder and the files.
// Pure helpers first (tested), the binder below. It appends to the top bar, so it runs after bindeKopf.

export const EXPORT_TEXT = {
  wav: 'EXPORT WAV',
  midi: 'EXPORT MIDI',
  wavTitel: 'Render the mix and every track alone as WAV files into a new folder (range: the module loop)',
  midiTitel: 'Write the notes as MIDI files into a new folder (range: the module loop)',
  laeuft: 'EXPORTING…',
  stoppt: 'The transport did not stop: nothing was exported',
  kopiert: 'Path copied',
  nichtKopiert: 'The path could not be copied: select it and copy by hand',
  keinStaerke: 'silent',
};

// The wait for the stopped transport: polls `fertig()` every `schritt` ms and answers true as soon as it holds, false after `ms`.
export async function warteBis(fertig, ms = 3000, schritt = 50) {
  const ende = Date.now() + ms;
  for (;;) {
    if (fertig()) return true;
    if (Date.now() >= ende) return false;
    await new Promise((ok) => setTimeout(ok, schritt));
  }
}

const KIND = { mix: 'Mix', spur: 'Track', return: 'Return', alle: 'All parts' };
export const dbText = (db) => (Number.isFinite(db) ? `${db.toFixed(1)} dB` : '');
const beatText = (n) => String(Math.round(n * 100) / 100);

// The rows of the result list from a server answer. art: 'wav' (answer of /proj/export_spuren) or 'midi' (/proj/export_midi).
// A row: {kind, name, datei (file name or ''), detail (peak or note count), stumm (silent or no file)}.
export function ergebnisZeilen(art, antwort) {
  return (antwort?.dateien ?? []).map((x) => {
    if (art === 'midi') return { kind: KIND[x.art] ?? x.art, name: x.name, datei: x.datei ?? '', detail: `${x.noten} note${x.noten === 1 ? '' : 's'}`, stumm: false };
    const stumm = x.stumm === true;
    return { kind: KIND[x.art] ?? x.art, name: x.name, datei: x.datei ?? '', detail: x.datei === null ? 'muted, no file' : dbText(x.spitze_db), stumm };
  });
}
export const ergebnisKopf = (art, antwort) =>
  `${art === 'midi' ? 'MIDI' : 'WAV'} export, beats ${beatText(antwort?.von_beat ?? 0)} to ${beatText(antwort?.bis_beat ?? 0)}`;

const el = (tag, text, klasse, w) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  if (w) e.setAttribute('data-w', w);
  return e;
};

export function bindeExport(ctx) {
  const { st, $ } = ctx;
  const kopf = $('kopf');
  const wav = el('button', EXPORT_TEXT.wav, 'w-export', 'export-wav'), midi = el('button', EXPORT_TEXT.midi, 'w-export', 'export-midi');
  wav.title = EXPORT_TEXT.wavTitel; midi.title = EXPORT_TEXT.midiTitel;
  wav.disabled = true; midi.disabled = true;
  const panel = el('div', undefined, 'w-export-ergebnis', 'export-ergebnis');
  panel.hidden = true;
  kopf.append(wav, midi, panel);

  let laeuft = false;
  const zeigeKnoepfe = () => {
    const aus = !st.projekt || laeuft;
    wav.disabled = aus; midi.disabled = aus;
    wav.classList.toggle('laeuft', laeuft); midi.classList.toggle('laeuft', laeuft);
  };
  const schliesse = () => { panel.hidden = true; panel.replaceChildren(); };

  function zeigeErgebnis(art, a) {
    panel.replaceChildren();
    const zu = el('button', '✕', 'w-export-zu', 'export-zu');
    zu.title = 'Close'; zu.addEventListener('click', schliesse);
    panel.append(el('div', ergebnisKopf(art, a), 'w-export-titel'), zu);
    const pfad = el('code', a.ordner, 'w-export-pfad', 'export-pfad');
    const kopieren = el('button', 'COPY PATH', undefined, 'export-kopieren');
    kopieren.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(a.ordner); ctx.melde(EXPORT_TEXT.kopiert); } catch { ctx.melde(EXPORT_TEXT.nichtKopiert, true); }
    });
    const zeigen = el('button', 'SHOW FOLDER', undefined, 'export-zeigen');
    zeigen.addEventListener('click', async () => {
      const r = await ctx.holeJson('/proj/export_zeige', { ordner: a.ordner });
      if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);
    });
    const zeile = el('div', undefined, 'w-export-pfadzeile');
    zeile.append(pfad, kopieren, zeigen);
    panel.append(zeile);
    const liste = el('ul', undefined, 'w-export-liste', 'export-liste');
    for (const z of ergebnisZeilen(art, a)) {
      const li = el('li', undefined, z.stumm ? 'w-export-stumm' : '');
      li.append(el('span', z.kind, 'w-export-art'), el('span', z.name, 'w-export-name'), el('span', z.datei, 'w-export-datei'));
      li.append(el('span', z.detail, 'w-export-detail'));
      if (z.stumm && z.datei !== '') li.append(el('span', EXPORT_TEXT.keinStaerke, 'w-export-marke'));
      liste.append(li);
    }
    panel.append(liste);
    panel.hidden = false;
  }

  async function exportiere(art) {
    if (laeuft || !st.projekt) return;
    laeuft = true; zeigeKnoepfe();
    const knopf = art === 'wav' ? wav : midi, text = knopf.textContent;
    knopf.textContent = EXPORT_TEXT.laeuft;
    try {
      if (art === 'wav' && st.arr && st.arr.status !== 0) {   // a render needs the stopped transport: stop it and wait for the core's report
        const s = await ctx.holeJson('/proj/transport', { aktion: 'stopp' });
        if (s.status !== 200) { ctx.melde(ctx.antwortText(s), true); return; }
        if (!(await warteBis(() => !st.arr || st.arr.status === 0))) { ctx.melde(EXPORT_TEXT.stoppt, true); return; }
      }
      const r = await ctx.holeJson(art === 'wav' ? '/proj/export_spuren' : '/proj/export_midi', {});
      if (r.status !== 200) { ctx.melde(ctx.antwortText(r), true); return; }
      zeigeErgebnis(art, r.j);
    } finally {
      knopf.textContent = text; laeuft = false; zeigeKnoepfe();
    }
  }
  wav.addEventListener('click', () => exportiere('wav'));
  midi.addEventListener('click', () => exportiere('midi'));

  ctx.beimProjekt.push((p, wechsel) => { if (wechsel) schliesse(); zeigeKnoepfe(); });
}
