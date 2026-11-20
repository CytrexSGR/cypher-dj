// TRACKER view, IMPORT MOD (plan 2026-11-18-tracker.md, task 26): a button and a file input in the tracker bar (and in the empty pane). The chosen ProTracker
// module goes to POST /tracker/import_mod as base64 (behind the confirmation of the live container, like every open); the server makes a new tracker module in
// one history step and answers the report, which the bar shows as one line: what came along, what was left out, with the counts.
// Every item carries data-t: import (the button), import-datei (the file input), import-bericht (the report line, in the bar).
// Pure parts (tested in Node): berichtText, importKoerper, tooBig. The server builds its answer text with berichtText too.
import { mitBestaetigung } from '../production/project_choice.js';

export const MOD_MAX = 4 * 1024 * 1024;   // the same limit as the server: a bigger file is refused here before it is read
export const IMPORT_TEXT = {
  knopf: 'IMPORT MOD', knopfTitel: 'Import a ProTracker module (.mod) as a new tracker module: patterns, notes, effects and the samples of the module',
  zuGross: 'That file is larger than 4 MiB: it is not imported',
  laeuft: 'Importing the module ...',
};

const plural = (n, einzahl, mehrzahl) => `${n} ${n === 1 ? einzahl : mehrzahl}`;

// The report of the parser in words, one line: what was imported, then what was left out (only what is not zero). Pure.
export function berichtText(b) {
  const da = `Imported ${plural(b.kanaele, 'channel', 'channels')}, ${plural(b.muster, 'pattern', 'patterns')} in ${plural(b.positionen, 'song position', 'song positions')} and ${plural(b.samples, 'sample', 'samples')}`;
  const w = b.weggelassen ?? {};
  const weg = [];
  if (w.tempo_wechsel > 0) weg.push(plural(w.tempo_wechsel, 'tempo or speed change', 'tempo or speed changes'));
  if (w.sprung > 0) weg.push(plural(w.sprung, 'position jump', 'position jumps'));
  if (w.muster_schleife > 0) weg.push(plural(w.muster_schleife, 'pattern loop', 'pattern loops'));
  for (const [k, n] of Object.entries(w.unbekannt ?? {})) if (n > 0) weg.push(`${k} (${n}x)`);
  return weg.length === 0 ? `${da}. Nothing was left out.` : `${da}. Left out: ${weg.join(', ')}.`;
}

// The request body for a module file: its name and the bytes as base64. Pure (a chunked btoa keeps the call stack small).
export function importKoerper(name, bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name, daten: btoa(s) };
}
export const tooBig = (groesse) => groesse > MOD_MAX;

export function bindeImport(ctx) {
  const { $ } = ctx;
  const el = (tag, klasse, t) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (t) e.setAttribute('data-t', t); return e; };
  let laeuft = false;

  // the import of one file: refuse the size, read, post (with the live confirmation), show the report; the view loads the new project
  ctx.importiereMod = async (name, bytes) => {
    if (laeuft) return false;
    if (tooBig(bytes.length)) { ctx.melde(IMPORT_TEXT.zuGross, true); return false; }
    laeuft = true;
    try {
      const bericht = $('import-bericht');
      if (bericht) bericht.textContent = IMPORT_TEXT.laeuft;
      const r = await mitBestaetigung(ctx.holeJson, '/tracker/import_mod', importKoerper(name, bytes), (t) => ctx.frage(t));
      if (r.abgelehnt) { if (bericht) bericht.textContent = ''; return false; }
      if (r.status !== 200 || !r.j?.slug) { if (bericht) bericht.textContent = ''; ctx.melde(ctx.antwortText(r), true); return false; }
      if (bericht) bericht.textContent = berichtText(r.j.bericht);
      await ctx.ladeAktuell();
      return true;
    } finally { laeuft = false; }
  };

  function baue(wo, mitBericht) {
    const huelle = el('span', 't-gruppe t-import');
    const knopf = el('button', 't-knopf', 'import');
    knopf.setAttribute('type', 'button'); knopf.textContent = IMPORT_TEXT.knopf; knopf.setAttribute('title', IMPORT_TEXT.knopfTitel);
    const datei = el('input', 't-datei', mitBericht ? 'import-datei' : 'import-datei-leer');
    datei.setAttribute('type', 'file'); datei.setAttribute('accept', '.mod,.MOD'); datei.hidden = true; datei.setAttribute('aria-label', IMPORT_TEXT.knopf);
    knopf.addEventListener('click', () => datei.click?.());
    datei.addEventListener('change', async () => {
      const f = datei.files?.[0];
      datei.value = '';
      if (!f) return;
      if (tooBig(f.size)) { ctx.melde(IMPORT_TEXT.zuGross, true); return; }
      ctx.importiereMod(f.name, new Uint8Array(await f.arrayBuffer()));
    });
    huelle.append(knopf, datei);
    if (mitBericht) { const b = el('span', 't-import-bericht', 'import-bericht'); b.setAttribute('role', 'status'); huelle.append(b); }
    wo.append(huelle);
    return huelle;
  }
  baue($('kopf'), true);
  baue($('leer'), false);
}
