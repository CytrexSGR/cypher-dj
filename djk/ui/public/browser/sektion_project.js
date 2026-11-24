// THIS PROJECT (browser plan 2, tasks 3 and 7): the files of the open project. Rows come from GET /proj/dateien in the order of spec B3.
// File names are shown as text (textContent), never as markup. Actions: COLLECT ALL, CLEAN UP, EXPORT PROJECT, FIND for a missing file, PLACE for a recovered take.
// Relink sequence (spike of task 2 step 5, read from code in the commit of POST /proj/relink): the clip decodes again after the project is opened once more,
// so after a relink the page calls host.oeffne(<slug of the open project>) = POST /proj/oeffnen {slug}; `schliessen` first is the fallback if that is ever refused.
import { baueAbschnitt, holeAbschnitt } from './abschnitt.js';
import { routeFuerDatei, echterSender } from './einwurf.js';

const KOPF = { audio: 'AUDIO', midi: 'MIDI', take: 'TAKES', export: 'EXPORTS', stem: 'STEMS', bounce: 'BOUNCES', resample: 'RESAMPLES', instrument: 'INSTRUMENTS', kit: 'KITS', preset: 'PRESETS' };

// the first audio clip of a project that names `sha` (a row click selects it), else null
export function ersterClip(projekt, sha) {
  for (const s of projekt?.spuren ?? []) for (const c of s.clips ?? []) if (c.art === 'audio' && c.quelle?.sha256 === sha) return c.id;
  return null;
}

export function projektZeilen(d) {
  if (!d) return [];
  const z = [];
  for (const a of d.audio ?? []) z.push({ art: 'audio', text: a.name, zusatz: a.clips === 1 ? '1 clip' : `${a.clips} clips`, sha256: a.sha256, ...(a.fehlt ? { fehlt: true } : {}) });
  for (const m of d.midi ?? []) z.push({ art: 'midi', text: m.name, clip_id: m.clip_id, spur_id: m.spur_id });
  for (const t of d.takes ?? []) z.push({ art: 'take', text: t.datei, datei: t.datei, ...(t.spur_id ? { spur_id: t.spur_id } : {}), gerettet: t.gerettet === true, ...(t.gerettet ? { zusatz: 'RECOVERED' } : {}) });
  for (const [art, liste] of [['export', d.exporte], ['stem', d.stems], ['bounce', d.bounces], ['resample', d.resamples]]) {
    for (const e of liste ?? []) z.push({ art, text: e.datei, datei: e.datei, zusatz: (e.zeit ?? '').slice(0, 16).replace('T', ' ') });
  }
  for (const i of d.instrumente ?? []) z.push({ art: 'instrument', text: i.spur_name, zusatz: i.geraet, spur_id: i.spur_id });
  for (const k of d.kits ?? []) z.push({ art: 'kit', text: k });
  for (const p of d.presets ?? []) z.push({ art: 'preset', text: p });
  return z;
}

// ---- actions (task 7): every one answers {status: 'ok'|'nicht_da'|'fehler'|..., text?}; a 404 of a route that is not built yet is `nicht_da`, never an error ----
export const NICHT_DA_TITEL = 'Not available in this build yet';
const ANTWORT_TEXT = (r) => r.j?.text || `The request failed (${r.status || 'no connection'})`;
const ok2 = (r) => r.status >= 200 && r.status < 300;

// the key is off while the action runs, on again in finally; a route that is not built stays off with its reason as the title
export async function fuehreAus(taste, fn) {
  taste.disabled = true;
  let ergebnis = null;
  try { ergebnis = await fn(); } finally {
    if (ergebnis?.status === 'nicht_da') { taste.disabled = true; taste.title = NICHT_DA_TITEL; } else taste.disabled = false;
  }
  return ergebnis;
}

export function aufraeumenText({ dateien }) {
  const n = dateien.length;
  if (n === 0) return { leer: true, frage: 'Nothing to clean up.' };
  const namen = dateien.slice(0, 20).join('\n') + (n > 20 ? `\nand ${n - 20} more` : '');
  return { leer: false, frage: `Move ${n} file${n === 1 ? '' : 's'} that nothing in this project uses to .papierkorb/ in the project folder?\n\n${namen}\n\nOlder undo steps and versions may name them; they stay in .papierkorb/ and can be moved back by hand. Your exports are kept.` };
}

export async function findeFehlende(host, sha256) {
  const r = await host.holeJson('/proj/finden', { sha256 });
  if (r.status === 404) return { status: 'nicht_da' };
  if (ok2(r) && r.j?.ok === true) return { status: 'verknuepft', pfad: r.j.pfad };
  if (ok2(r) && (r.j?.grund ?? r.j?.fehler) === 'nicht_gefunden') return { status: 'frage_datei' };
  return { status: 'fehler', text: ANTWORT_TEXT(r) };
}

// /proj/relink verifies the content hash on the server; the project is opened once more so the clip decodes (see the header)
export async function relinke(host, sha256, pfad) {
  const r = await host.holeJson('/proj/relink', { sha256, pfad });
  if (r.status === 404) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) return { status: 'fehler', text: ANTWORT_TEXT(r) };
  const slug = host.projekt?.()?.slug;
  if (slug && host.oeffne) { const o = await host.oeffne(slug); if (!o.ok && o.text) return { status: 'fehler', text: o.text }; }
  return { status: 'ok' };
}
// a path (from the library) or a file chosen on the desktop. A browser cannot reveal the path of a chosen file, so the file is uploaded into the
// library (the server names its sha256 while it streams) and relinked only when that hash is the missing one. The hash is checked HERE before the
// upload: a wrong file is never sent, so it never lands in the library's import folder (there is no route that deletes an import again).
export const HASH_GRENZE = 1073741824;   // crypto.subtle hashes in one piece: above 1 GiB the file is not read into memory
export async function sha256Datei(datei) {
  const b = await crypto.subtle.digest('SHA-256', await datei.arrayBuffer());
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function relinkeDatei(host, sha256, datei, opt = {}) {
  if (typeof datei === 'string') return relinke(host, sha256, datei);
  const route = opt.route ?? await routeFuerDatei(datei, 'bibliothek');
  if (route.art !== 'audio') return { status: 'fehler', text: `${datei.name} is not an audio file` };
  if (datei.size > HASH_GRENZE) return { status: 'fehler', text: `${datei.name} is too large to check here: import it through IMPORT, then use FIND` };
  let sha;
  try { sha = await (opt.hash ?? sha256Datei)(datei); } catch (e) { return { status: 'fehler', text: `${datei.name} could not be read: ${e?.message ?? e}` }; }
  if (sha !== sha256) return { status: 'fehler', text: 'That file is not the one the project uses; it was not copied' };
  const u = await (opt.sende ?? echterSender())(datei, route);
  if (u.status === 404) return { status: 'nicht_da' };
  if (u.status < 200 || u.status >= 300) return { status: 'fehler', text: u.j?.text || `The upload failed (${u.status || 'no connection'})` };
  if (u.j?.sha256 !== sha256) return { status: 'fehler', text: 'That file is not the one the project uses' };
  return relinke(host, sha256, u.j.pfad);
}

export async function sammleAlles(host) {
  const r = await host.holeJson('/proj/einsammeln', {});
  if (r.status === 404) return { status: 'nicht_da' };
  if (!ok2(r)) { const text = ANTWORT_TEXT(r); host.melde(text, true); return { status: 'fehler', text }; }
  const b = r.j ?? {};
  const teile = [`${b.kopiert ?? 0} files copied into the project`];
  if (b.schon_da) teile.push(`${b.schon_da} already there`);
  if (b.fehlt?.length) teile.push(`${b.fehlt.length} missing`);
  if (b.aufgeschoben) teile.push(`${b.aufgeschoben} postponed`);
  host.melde(teile.join(', '), (b.fehlt?.length ?? 0) > 0);
  return { status: 'ok', bericht: b };
}

export async function raeumeAuf(host, frage = (t) => globalThis.confirm?.(t) ?? false) {
  const v = await host.holeJson('/proj/aufraeumen', { nur_zeigen: true });
  if (v.status === 404) return { status: 'nicht_da' };
  if (!ok2(v)) { const text = ANTWORT_TEXT(v); host.melde(text, true); return { status: 'fehler', text }; }
  const t = aufraeumenText({ dateien: v.j?.dateien ?? [] });
  if (t.leer) { host.melde(t.frage, false); return { status: 'leer', text: t.frage }; }
  if (!frage(t.frage)) return { status: 'abgelehnt' };
  const r = await host.holeJson('/proj/aufraeumen', {});
  if (!ok2(r)) { const text = ANTWORT_TEXT(r); host.melde(text, true); return { status: 'fehler', text }; }
  host.melde(`${r.j?.dateien?.length ?? 0} files moved to .papierkorb/`, false);
  return { status: 'ok', dateien: r.j?.dateien ?? [] };
}

export async function platziere(host, datei) {
  const r = await host.holeJson('/proj/gerettet_platzieren', { datei });
  if (r.status === 404) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = ANTWORT_TEXT(r); host.melde(text, true); return { status: 'fehler', text }; }
  if (r.j?.clip_id && host.waehleClip) await host.waehleClip(r.j.clip_id);
  return { status: 'ok', clip_id: r.j?.clip_id };
}

// EXPORT PROJECT: the browser streams the zip to disk itself (a download of GET /proj/export_zip, the server names the file `<slug>.cypherdj.zip`); nothing
// is buffered here. A cheap probe without a slug tells a missing route (404) from a present one (the route answers 409 `projekt_nicht_offen` at once, no zip is built).
// A refusal of the real download (for example `nicht_eingesammelt`) arrives as a JSON page inside the hidden frame; the frame's load event shows its text.
export async function exportiere(host, slug, opt = {}) {
  const f = opt.fetchFn ?? globalThis.fetch.bind(globalThis);
  let p;
  try { p = await f('/proj/export_zip?slug='); } catch (e) { const text = `The export failed: ${e.message}`; host.melde(text, true); return { status: 'fehler', text }; }
  if (p.status === 404) return { status: 'nicht_da' };
  if (p.status === 403 || p.status === 421) {
    let j = null; try { j = await p.json(); } catch { /* no JSON */ }
    const text = j?.text || `The export is not allowed (${p.status})`;
    host.melde(text, true);
    return { status: 'fehler', text };
  }
  (opt.starte ?? starteDownload)(`/proj/export_zip?slug=${encodeURIComponent(slug)}`, (text) => host.melde(text, true));
  host.melde('The export is being prepared: the download starts when the zip is ready', false);
  return { status: 'ok' };
}
// the download runs in a hidden frame: a file answer (Content-Disposition) is saved by the browser and fires no load event; a refusal is a JSON page and does
function starteDownload(url, beiFehler) {
  const alt = document.getElementById('b-export-rahmen');
  if (alt) alt.remove();
  const rahmen = document.createElement('iframe');
  rahmen.id = 'b-export-rahmen'; rahmen.hidden = true; rahmen.title = 'Project export';
  rahmen.addEventListener('load', () => {
    let text = 'The export failed';
    try { const j = JSON.parse(rahmen.contentDocument.body.textContent); text = j?.text || text; } catch { /* keep the generic sentence */ }
    beiFehler(text);
    rahmen.remove();
  });
  rahmen.src = url;
  document.body.append(rahmen);
}

const taste = (text, titel, fn) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'b-taste'; b.textContent = text; b.title = titel;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
  return b;
};

export function baueProjektAbschnitt(host) {
  const a = baueAbschnitt({ id: 'projekt', titel: 'THIS PROJECT', offen: true });
  let letzteDateien = null;
  // the row of a missing file: FIND, and after a miss the two ways to name the file
  function fehlendZeile(f) {
    const r = document.createElement('div');
    r.className = 'b-zeile fehlt b-fehlend'; r.title = 'This file is missing';
    const t = document.createElement('span'); t.className = 'b-text'; t.textContent = f.name; t.title = f.name; r.append(t);
    const aufdecken = () => { if (r.querySelector('.b-wahl')) return; r.classList.add('b-wahl-offen'); r.after(wahlZeile(f)); };
    r.append(taste('FIND', 'Look for this file in your library', (b) => fuehreAus(b, async () => {
      const x = await findeFehlende(host, f.sha256);
      if (x.status === 'verknuepft') { host.melde('Found and linked', false); const o = host.projekt?.()?.slug; if (o && host.oeffne) await host.oeffne(o); laden(); }
      else if (x.status === 'frage_datei') { host.melde('Not found in your library: choose the file', true); aufdecken(); }
      else if (x.status === 'fehler') host.melde(x.text, true);
      return x;
    })));
    return r;
  }
  function wahlZeile(f) {
    const w = document.createElement('div');
    w.className = 'b-zeile b-wahl';
    const feld = document.createElement('input');
    feld.type = 'search'; feld.className = 'b-name'; feld.placeholder = 'Search your library'; feld.setAttribute('aria-label', 'Search your library');
    const liste = document.createElement('div'); liste.className = 'b-wahlliste';
    feld.addEventListener('click', (e) => e.stopPropagation());
    feld.addEventListener('keydown', async (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter' || feld.value.trim() === '') return;
      liste.textContent = '';
      for (const typ of ['oneshot', 'loop', 'track']) {
        const r = await host.holeGet(`/stoebern?typ=${typ}&text=${encodeURIComponent(feld.value.trim())}`);
        for (const z of (r.j?.treffer ?? []).slice(0, 20)) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'b-taste'; b.textContent = z.name ?? z.titel ?? z.sha?.slice(0, 8); b.title = typ;
          b.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            if (z.sha !== f.sha256) { host.melde('That file is not the one the project uses', true); return; }
            const d = await host.holeGet(`/stoebern/detail?sha=${z.sha}`);
            if (typeof d.j?.pfad !== 'string') { host.melde('That library row has no file path', true); return; }
            const x = await relinke(host, f.sha256, d.j.pfad);
            if (x.status === 'ok') laden(); else if (x.status === 'fehler') host.melde(x.text, true);
          });
          liste.append(b);
        }
      }
      if (!liste.firstChild) liste.textContent = 'No match in your library';
    });
    const roh = document.createElement('input');
    roh.type = 'file'; roh.hidden = true;
    roh.addEventListener('change', async () => {
      const datei = roh.files[0];
      if (!datei) return;
      host.melde(`Checking ${datei.name}…`, false);
      const x = await relinkeDatei(host, f.sha256, datei);
      if (x.status === 'ok') { host.melde('Linked', false); laden(); }
      else host.melde(x.status === 'nicht_da' ? 'Import is not available in this build yet' : x.text, true);
    });
    w.append(feld, taste('PICK FILE', 'Choose the file on this computer; it is copied into your library and used only when it is the same file', () => roh.click()), roh, liste);
    return w;
  }
  const aktionen = () => {
    const z = document.createElement('div');
    z.className = 'b-zeile b-aktionen';
    z.append(
      taste('COLLECT ALL', 'Copy every outside audio file into the project folder', (b) => fuehreAus(b, async () => { const x = await sammleAlles(host); if (x.status === 'ok') laden(); return x; })),
      taste('CLEAN UP', 'Move files that nothing in this project uses into the bin of the project folder', (b) => fuehreAus(b, async () => { const x = await raeumeAuf(host); if (x.status === 'ok') laden(); else if (x.status === 'fehler') return x; return x; })),
      taste('EXPORT PROJECT', 'Save the project as a zip file', (b) => fuehreAus(b, async () => {
        const slug = host.projekt?.()?.slug;
        if (!slug) { host.melde('No project open', true); return { status: 'fehler' }; }
        return exportiere(host, slug);
      })));
    return z;
  };
  const zeichne = (zeilen, d) => {
    a.rumpf.textContent = '';
    a.rumpf.append(aktionen());
    const fehlend = (d.audio ?? []).filter((x) => x.fehlt);
    if (fehlend.length) {
      const k = document.createElement('div'); k.className = 'b-gruppe fehlt'; k.textContent = `MISSING (${fehlend.length})`; a.rumpf.append(k);
      for (const f of fehlend) a.rumpf.append(fehlendZeile(f));
    }
    let letzte = null;
    for (const z of zeilen) {
      if (z.art !== letzte) { const k = document.createElement('div'); k.className = 'b-gruppe'; k.textContent = KOPF[z.art]; a.rumpf.append(k); letzte = z.art; }
      const r = document.createElement('div');
      r.className = `b-zeile b-${z.art}${z.fehlt ? ' fehlt' : ''}${z.gerettet ? ' gerettet' : ''}`;
      const t = document.createElement('span'); t.className = 'b-text'; t.textContent = z.text; t.title = z.text; r.append(t);
      if (z.zusatz) { const u = document.createElement('span'); u.className = 'b-zusatz'; u.textContent = z.zusatz; r.append(u); }
      if (z.fehlt) r.title = 'This file is missing';
      if (z.art === 'take' && z.gerettet) r.append(taste('PLACE', 'Put the recovered take on its track at its recorded start', (b) => fuehreAus(b, async () => { const x = await platziere(host, z.datei); if (x.status === 'ok') laden(); return x; })));
      const waehle = klick(host, z);
      if (waehle) { r.classList.add('klickbar'); r.addEventListener('click', (e) => { e.stopPropagation(); waehle(); }); }   // stopped here: the page-wide plain click clears the track selection
      a.rumpf.append(r);
    }
  };
  async function laden() {
    a.setze('laedt');
    const r = await holeAbschnitt(host, '/proj/dateien');
    if (r.zustand === 'kein_projekt') return a.setze('leer', 'No project open');
    if (r.zustand !== 'inhalt') return a.setze(r.zustand, r.text);
    letzteDateien = r.j;
    const zeilen = projektZeilen(r.j);
    if (zeilen.length === 0) { a.setze('inhalt'); a.rumpf.textContent = ''; a.rumpf.append(aktionen()); const l = document.createElement('div'); l.className = 'b-zeile b-leer'; l.textContent = 'This project has no files yet'; a.rumpf.append(l); return; }
    a.setze('inhalt');
    zeichne(zeilen, r.j);
  }
  return { wurzel: a.wurzel, laden };
}

// what a click on a row does in this view; null when the view cannot (the row is then not clickable)
function klick(host, z) {
  if (z.art === 'audio' && host.waehleClip) return () => { const id = ersterClip(host.projekt()?.projekt, z.sha256); if (id) host.waehleClip(id); };
  if (z.art === 'midi' && host.waehleClip) return () => { host.waehleClip(z.clip_id); };
  if (z.art === 'instrument' && host.waehleSpur) return () => host.waehleSpur(z.spur_id);
  if (z.art === 'take' && z.spur_id && host.waehleSpur) return () => host.waehleSpur(z.spur_id);
  return null;
}
