// PROJECTS (browser plan 2, task 4): the stored projects, most recently opened first, with NEW, OPEN, SAVE AS, RENAME, DUPLICATE and DELETE.
// Every action goes through a route the hand can reach too; a refusal shows the route's own text through host.melde(text, true).
import { baueAbschnitt, holeAbschnitt } from './abschnitt.js';
import { routeFuerDatei, echterSender } from './einwurf.js';

// rows of the section: the open project is marked, a broken project is shown but cannot be opened
export function projekteZeilen(liste, offenSlug) {
  return (Array.isArray(liste) ? liste : []).map((p) => ({
    slug: p.slug, name: p.name, zuletzt: p.zuletzt ?? p.geaendert ?? '', offen: p.slug === offenSlug,
    art: p.fehler ? 'broken' : p.werkbank ? 'module' : p.tracker ? 'tracker' : 'project',
    ...(p.text ? { text: p.text } : {}),
  }));
}

const melde = (host, r, text) => { if (!r.ok && r.text) host.melde(r.text, true); else if (r.ok && text) host.melde(text, false); };
const antwort = (r) => (r.status === 200 ? { ok: true, j: r.j } : { ok: false, text: r.j?.text ?? `The request failed (${r.status || 'no connection'})` });

// DUPLICATE: a copy named "<name> copy" next to the original; it stays unopened
export async function dupliziere(host, z) {
  const r = antwort(await host.holeJson('/proj/kopie', { slug: z.slug, name: `${z.name} copy` }));
  melde(host, r);
  return r;
}
// SAVE AS: a copy of the open project under a typed name, then the copy is opened
export async function speichereUnter(host, z, name) {
  const r = antwort(await host.holeJson('/proj/kopie', { slug: z.slug, name }));
  if (!r.ok) { melde(host, r); return r; }
  const o = await host.oeffne(r.j.slug);
  if (!o.ok && o.text) host.melde(o.text, true);
  return o;
}
export async function umbenenne(host, z, name) {
  const r = antwort(await host.holeJson('/proj/umbenennen', { slug: z.slug, name }));
  melde(host, r);
  return r;
}
// DELETE moves the project to the bin of the project folder after one question; the open project is never deleted from here
export async function loesche(host, z, frage = (t) => globalThis.confirm?.(t) ?? false) {
  if (z.offen) return { ok: false };
  if (!frage(`Move the project ${z.name} to the bin of the project folder?`)) return { ok: false };
  const r = antwort(await host.holeJson('/proj/loeschen', { slug: z.slug }));
  melde(host, r);
  return r;
}

// ---- IMPORT PROJECT and VERSIONS (task 12; routes of plans 5 and 3: a 404 is an honest state, nothing is faked) ----
export const NICHT_DA = 'Not available in this build yet';
const ok2 = (r) => r.status >= 200 && r.status < 300;
const FEHLER = (r) => r.j?.text || `The request failed (${r.status || 'no connection'})`;

export function importText(r) {
  const teile = [`Imported as "${r.slug}".`];
  for (const k of r.kits_umbenannt ?? []) teile.push(`Kit "${k.alt}" was installed as "${k.neu}" because another kit had that name.`);
  return teile.join(' ');
}
// the zip is checked here (project.json at its top) and sent as a raw body; the imported project is opened afterwards
export async function importiereProjekt(host, datei, opt = {}) {
  const route = opt.route ?? await routeFuerDatei(datei, 'bibliothek');
  if (route.art !== 'projekt') { const text = `${datei.name} is not a project zip (a project zip has project.json at its top)`; host.melde(text, true); return { status: 'fehler', text }; }
  const u = await (opt.sende ?? echterSender())(datei, route);
  if (u.status === 404 && !(u.j?.grund ?? u.j?.fehler)) return { status: 'nicht_da' };
  if (!ok2(u) || u.j?.ok === false) { const text = u.j?.text || `The import failed (${u.status || 'no connection'})`; host.melde(text, true); return { status: 'fehler', text }; }
  const text = importText(u.j);
  host.melde(text, false);
  const o = await host.oeffne(u.j.slug);
  if (!o.ok && o.text) host.melde(o.text, true);
  return { status: 'ok', slug: u.j.slug, text, geoeffnet: o.ok === true };
}

const lokal = (z) => {
  const d = new Date(z), n = (x) => String(x).padStart(2, '0');
  return Number.isNaN(d.getTime()) ? String(z) : `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())} ${n(d.getHours())}:${n(d.getMinutes())}`;
};
// newest first; the text is the name (or "Automatic") and the local date and time
export function versionZeilen(a) {
  return (Array.isArray(a?.versionen) ? a.versionen : []).filter((v) => typeof v?.id === 'string')
    .map((v) => ({ id: v.id, zeit: v.zeit, auto: v.auto === true, text: `${v.name ? v.name : 'Automatic'} ${lokal(v.zeit)}` }))
    .sort((x, y) => (x.zeit < y.zeit ? 1 : x.zeit > y.zeit ? -1 : 0))
    .map(({ id, text, auto }) => ({ id, text, auto }));
}
export async function ladeVersionen(host) {
  const r = await host.holeGet('/proj/versionen');
  if (r.status === 404) return { status: 'nicht_da', zeilen: [] };
  if (r.status === 409) return { status: 'kein_projekt', zeilen: [] };
  if (!ok2(r)) return { status: 'fehler', zeilen: [], text: FEHLER(r) };
  return { status: 'ok', zeilen: versionZeilen(r.j) };
}
export async function sichereVersion(host, name) {
  const r = await host.holeJson('/proj/version_sichern', { name });
  if (r.status === 404 && !(r.j?.grund ?? r.j?.fehler)) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  return { status: 'ok', id: r.j?.id };
}
export const WIEDERHERSTELLEN_FRAGE = 'Restore this version? The current state is saved as a version first.';
export async function stelleWiederHer(host, id, frage = (t) => globalThis.confirm?.(t) ?? false) {
  if (!frage(WIEDERHERSTELLEN_FRAGE)) return { status: 'abgebrochen' };
  const r = await host.holeJson('/proj/version_zurueck', { id });
  if (r.status === 404 && !(r.j?.grund ?? r.j?.fehler)) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  host.nachWechsel?.();   // the project is read again
  host.melde('Version restored', false);
  return { status: 'ok', gesichert_als: r.j?.gesichert_als };
}

const taste = (text, titel, fn, aus = false) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'b-taste'; b.textContent = text; b.title = titel; b.disabled = aus;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
  return b;
};

export function baueProjekteAbschnitt(host) {
  const a = baueAbschnitt({ id: 'projekte', titel: 'PROJECTS', offen: false });
  let offenSlug = null;
  const laden = async () => {
    a.setze('laedt');
    const r = await holeAbschnitt(host, '/proj/liste');
    if (r.zustand !== 'inhalt') return a.setze(r.zustand === 'kein_projekt' ? 'leer' : r.zustand, r.text);
    offenSlug = host.projekt()?.slug ?? null;
    zeichne(projekteZeilen(r.j, offenSlug));
    if (offenSlug) { a.rumpf.append(versionen); await ladeVersionenBlock(); } else versionen.textContent = '';
  };
  // a name field in place of the row's own buttons: Enter confirms, Escape gives up
  const frageName = (zeile, vorgabe, fn) => {
    const f = document.createElement('input');
    f.type = 'text'; f.className = 'b-name'; f.value = vorgabe; f.maxLength = 80;
    f.addEventListener('click', (e) => e.stopPropagation());
    f.addEventListener('keydown', async (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') return zeichneNeu();
      if (e.key !== 'Enter' || f.value.trim() === '') return;
      const r = await fn(f.value.trim());
      if (r.ok) laden(); else f.focus();
    });
    zeile.append(f);
    f.focus(); f.select();
  };
  let zeichneNeu = () => laden();
  const importDatei = document.createElement('input');
  importDatei.type = 'file'; importDatei.accept = '.zip,application/zip'; importDatei.hidden = true;
  const importKnopf = taste('IMPORT PROJECT', 'Add a project from a project zip on this computer and open it', () => { importDatei.value = ''; importDatei.click(); });
  importDatei.addEventListener('change', async () => {
    const f = importDatei.files?.[0];
    if (!f) return;
    importKnopf.disabled = true;
    host.melde(`Importing ${f.name}…`, false);
    let x = null;
    try { x = await importiereProjekt(host, f); } finally { importKnopf.disabled = false; }
    if (x.status === 'nicht_da') { importKnopf.disabled = true; importKnopf.title = NICHT_DA; host.melde('Project import is not available in this build yet', true); }
    else if (x.status === 'ok') laden();
  });
  // VERSIONS of the open project: hidden while the route is missing (404) or no project is open
  const versionen = document.createElement('div');
  versionen.className = 'b-versionen';
  async function ladeVersionenBlock() {
    versionen.textContent = '';
    const x = await ladeVersionen(host);
    if (x.status !== 'ok') { if (x.status === 'fehler') host.melde(x.text, true); return; }
    const kopfZ = document.createElement('div'); kopfZ.className = 'b-gruppe'; kopfZ.textContent = 'VERSIONS';
    const neuZ = document.createElement('div'); neuZ.className = 'b-zeile';
    const f = document.createElement('input'); f.type = 'text'; f.className = 'b-name'; f.placeholder = 'Name of this version'; f.maxLength = 80; f.setAttribute('aria-label', 'Version name');
    f.addEventListener('click', (e) => e.stopPropagation()); f.addEventListener('keydown', (e) => e.stopPropagation());
    neuZ.append(f, taste('SAVE VERSION', 'Keep the current state under this name; named versions are never removed', async (b) => {
      b.disabled = true;
      const r = await sichereVersion(host, f.value.trim());
      b.disabled = false;
      if (r.status === 'ok') { host.melde('Version saved', false); ladeVersionenBlock(); } else if (r.status === 'nicht_da') { b.disabled = true; b.title = NICHT_DA; }
    }));
    versionen.append(kopfZ, neuZ);
    if (x.zeilen.length === 0) { const l = document.createElement('div'); l.className = 'b-zeile b-leer'; l.textContent = 'No versions yet'; versionen.append(l); }
    for (const v of x.zeilen) {
      const r = document.createElement('div'); r.className = `b-zeile b-version${v.auto ? ' auto' : ''}`;
      const t = document.createElement('span'); t.className = 'b-text'; t.textContent = v.text; t.title = v.text;
      r.append(t, taste('RESTORE', 'Go back to this version; the current state is saved as a version first', async (b) => {
        b.disabled = true;
        const o = await stelleWiederHer(host, v.id);
        b.disabled = false;
        if (o.status === 'ok') { laden(); }
      }));
      versionen.append(r);
    }
  }
  function zeichne(zeilen) {
    a.setze('inhalt');
    a.rumpf.textContent = '';
    const kopf = document.createElement('div');
    kopf.className = 'b-zeile';
    kopf.append(taste('NEW', 'Make a new project', () => {
      kopf.textContent = '';
      frageName(kopf, '', async (name) => { const r = await host.neu(name); if (!r.ok && r.text) host.melde(r.text, true); return r; });
    }));
    kopf.append(importKnopf, importDatei);
    a.rumpf.append(kopf);
    if (zeilen.length === 0) { const l = document.createElement('div'); l.className = 'b-zeile b-leer'; l.textContent = 'No stored projects yet'; a.rumpf.append(l); return; }
    for (const z of zeilen) {
      const r = document.createElement('div');
      r.className = `b-zeile b-${z.art}${z.offen ? ' offen' : ''}${z.art === 'broken' ? ' fehlt' : ' klickbar'}`;
      const t = document.createElement('span'); t.className = 'b-text'; t.textContent = z.name; t.title = z.text ?? z.name; r.append(t);
      const u = document.createElement('span'); u.className = 'b-zusatz';
      u.textContent = z.offen ? 'open' : z.art === 'broken' ? 'broken' : z.art === 'project' ? '' : z.art;
      r.append(u);
      if (z.art !== 'broken') {
        r.addEventListener('click', async (e) => { e.stopPropagation(); if (z.offen) return; const o = await host.oeffne(z.slug); if (!o.ok && o.text) host.melde(o.text, true); else if (o.ok) laden(); });
        if (z.offen) r.append(taste('SAVE AS', 'Copy the open project under a new name and open the copy', () => { r.textContent = ''; frageName(r, `${z.name} copy`, async (n) => { const o = await speichereUnter(host, z, n); if (o.ok) laden(); return o; }); }));
        else r.append(taste('RENAME', 'Change the name of this project', () => { r.textContent = ''; frageName(r, z.name, (n) => umbenenne(host, z, n)); }));
        r.append(taste('COPY', 'Make a copy named after this project', async () => { const o = await dupliziere(host, z); if (o.ok) laden(); }));
        r.append(taste('DELETE', z.offen ? 'The open project cannot be deleted; open another one first' : 'Move this project to the bin', async () => { const o = await loesche(host, z); if (o.ok) laden(); }, z.offen));
      }
      a.rumpf.append(r);
    }
  }
  return { wurzel: a.wurzel, laden };
}
