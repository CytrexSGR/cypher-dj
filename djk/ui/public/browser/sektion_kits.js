// KITS (browser plan 2, task 12): the global kits and those of the open project, from GET /kits (plan 5). PREVIEW (the key plays the whole kit, a click on the
// row plays pad 1), RENAME, DUPLICATE, DELETE, EXPORT (a plain download link), IMPORT KIT (a kit zip as a raw body) and NEW KIT FROM FOLDER.
// A route that answers 404 gives the honest state "not available in this build yet" and no key; nothing is faked.
import { baueAbschnitt, holeAbschnitt } from './abschnitt.js';
import { routeFuerDatei, echterSender } from './einwurf.js';

export const NICHT_DA = 'Not available in this build yet';
export const KITS_NICHT_DA = 'Kits are not available in this build yet';
const ok2 = (r) => r.status >= 200 && r.status < 300;
const FEHLER = (r) => r.j?.text || `The request failed (${r.status || 'no connection'})`;

export function kitZeilen(a) {
  return (Array.isArray(a?.kits) ? a.kits : []).filter((k) => typeof k?.name === 'string').map((k) => ({
    name: k.name, text: `${k.name}, ${k.pads} pad${k.pads === 1 ? '' : 's'}`, global: k.quelle === 'global', quelle: k.quelle === 'projekt' ? 'projekt' : 'global',
  }));
}

export const uebrigText = (uebrig) => `${uebrig.length} file${uebrig.length === 1 ? '' : 's'} did not fit: a kit has at most 16 pads`;

// every action answers {status: 'ok'|'nicht_da'|'fehler'|'abgebrochen', text?}
export async function ladeKits(host) {
  const r = await holeAbschnitt(host, '/kits');
  if (r.zustand === 'nicht_da') return { status: 'nicht_da', text: KITS_NICHT_DA, zeilen: [] };
  if (r.zustand !== 'inhalt') return { status: 'fehler', text: r.text, zeilen: [] };
  return { status: 'ok', zeilen: kitZeilen(r.j) };
}
const aktion = async (host, weg, body) => {
  const r = await host.holeJson(weg, body);
  if (r.status === 404 && !(r.j?.grund ?? r.j?.fehler)) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text, grund: r.j?.grund ?? r.j?.fehler, code: r.status }; }
  return { status: 'ok', name: r.j?.name };
};
export const benenneKitUm = (host, k, neu) => aktion(host, '/kits/umbenennen', { name: k.name, neu, quelle: k.quelle });
export const dupliziereKit = (host, k) => aktion(host, '/kits/kopie', { name: k.name, quelle: k.quelle });
export async function loescheKit(host, k, frage = (t) => globalThis.confirm?.(t) ?? false) {
  if (!frage(`Move the kit ${k.name} to the bin?`)) return { status: 'abgebrochen' };
  const r = await host.holeJson('/kits/loeschen', { name: k.name, quelle: k.quelle });
  if (r.status === 404 && !(r.j?.grund ?? r.j?.fehler)) return { status: 'nicht_da' };
  if (r.status === 409 && (r.j?.grund ?? r.j?.fehler) === 'kit_in_benutzung') {   // a project uses it: one more question, then the same delete with `trotzdem`
    if (!frage(`A project uses the kit ${k.name}. Move it to the bin anyway?`)) return { status: 'abgebrochen' };
    return aktion(host, '/kits/loeschen', { name: k.name, quelle: k.quelle, trotzdem: true });
  }
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  return { status: 'ok' };
}
export async function vorhoereKit(host, k, pad) {
  const r = await host.holeJson('/kits/vorhoeren', { name: k.name, quelle: k.quelle, ...(pad === undefined ? {} : { pad }) });
  if (r.status === 404 && !(r.j?.grund ?? r.j?.fehler)) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  return { status: 'ok' };
}
// IMPORT KIT: the zip is the raw body; the page checks that it is a kit zip (kit.json at its top) before it sends anything
export async function importiereKit(host, datei, opt = {}) {
  const route = opt.route ?? await routeFuerDatei(datei, 'bibliothek');
  if (route.art !== 'kit') { const text = `${datei.name} is not a kit zip (a kit zip has kit.json at its top)`; host.melde(text, true); return { status: 'fehler', text }; }
  const u = await (opt.sende ?? echterSender())(datei, route);
  if (u.status === 404 && !(u.j?.grund ?? u.j?.fehler)) return { status: 'nicht_da' };
  if (!ok2(u) || u.j?.ok === false) { const text = u.j?.text || `The import failed (${u.status || 'no connection'})`; host.melde(text, true); return { status: 'fehler', text }; }
  const u2 = u.j?.umbenannt;
  const text = u2 ? `Kit "${u2.alt}" was installed as "${u2.neu}" because another kit had that name.` : u.j?.neu === false ? `Kit "${u.j.name}" is already installed.` : `Kit "${u.j?.name}" installed.`;
  host.melde(text, false);
  return { status: 'ok', name: u.j?.name, text };
}
// NEW KIT FROM FOLDER: the folder from the picker, the name from `fragName` (prefilled with the folder's name); files beyond 16 pads are listed
export async function kitAusOrdner(host, dienste, fragName) {
  const pfad = await dienste.waehleOrdner?.();
  if (!pfad) return { status: 'abgebrochen' };
  const vorgabe = pfad.split('/').filter(Boolean).pop() ?? 'kit';
  const name = await fragName(vorgabe.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'kit');
  if (!name) return { status: 'abgebrochen' };
  const r = await host.holeJson('/kits/aus_ordner', { pfad, name });
  if (r.status === 404 && !(r.j?.grund ?? r.j?.fehler)) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  const uebrig = Array.isArray(r.j?.uebrig) ? r.j.uebrig : [];
  const text = uebrig.length > 0 ? `Kit ${r.j.name} made with ${r.j.pads} pads. ${uebrigText(uebrig)}: ${uebrig.slice(0, 10).join(', ')}${uebrig.length > 10 ? `, and ${uebrig.length - 10} more` : ''}` : `Kit ${r.j.name} made with ${r.j.pads} pads`;
  host.melde(text, false);
  return { status: 'ok', name: r.j.name, pads: r.j.pads, uebrig, text };
}

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const taste = (text, titel, fn) => {
  const b = el('button', 'b-taste', text);
  b.type = 'button'; b.title = titel;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
  return b;
};

export function baueKitsAbschnitt(host, dienste = {}) {
  const a = baueAbschnitt({ id: 'kits', titel: 'KITS', offen: false });
  let aus = null;   // the routes that answered 404 once: `nicht_da` keys stay off, no second request
  const nicht = new Set();
  const spiel = async (b, fn) => {
    b.disabled = true;
    let x = null;
    try { x = await fn(); } finally { if (x?.status === 'nicht_da') b.title = NICHT_DA; else b.disabled = false; }
    return x;
  };
  const frageName = (zeile, vorgabe, fn) => {
    const f = el('input', 'b-name');
    f.type = 'text'; f.value = vorgabe; f.maxLength = 32; f.setAttribute('aria-label', 'Kit name');
    f.addEventListener('click', (e) => e.stopPropagation());
    f.addEventListener('keydown', async (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') return laden();
      if (e.key !== 'Enter' || f.value.trim() === '') return;
      const x = await fn(f.value.trim());
      if (x.status === 'ok') laden(); else f.focus();
    });
    zeile.append(f); f.focus(); f.select();
  };
  const datei = el('input'); datei.type = 'file'; datei.accept = '.zip,application/zip'; datei.hidden = true;
  datei.addEventListener('change', async () => {
    const f = datei.files?.[0];
    if (!f) return;
    host.melde(`Checking ${f.name}…`, false);
    const x = await importiereKit(host, f);
    if (x.status === 'nicht_da') { nicht.add('import'); host.melde('Kit import is not available in this build yet', true); }
    if (x.status === 'ok') laden();
  });
  function kopf() {
    const z = el('div', 'b-zeile b-aktionen');
    const imp = taste('IMPORT KIT', 'Add a kit from a kit zip on this computer', () => { datei.value = ''; datei.click(); });
    const ord = taste('NEW KIT FROM FOLDER', 'Make a kit from the sounds in a folder (at most 16 pads)', (b) => spiel(b, async () => {
      const x = await kitAusOrdner(host, dienste, (v) => new Promise((fertig) => {   // a name row on top: Enter gives the name, Escape gives up
        const zeile = el('div', 'b-zeile'), f = el('input', 'b-name');
        f.type = 'text'; f.value = v; f.maxLength = 32; f.setAttribute('aria-label', 'Kit name');
        const zu = (w) => { zeile.remove(); fertig(w); };
        f.addEventListener('click', (e) => e.stopPropagation());
        f.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') zu(null); else if (e.key === 'Enter' && f.value.trim() !== '') zu(f.value.trim()); });
        zeile.append(f); a.rumpf.prepend(zeile); f.focus(); f.select();
      }));
      if (x.status === 'nicht_da') nicht.add('ordner');
      if (x.status === 'ok') laden();
      return x;
    }));
    if (nicht.has('import')) { imp.disabled = true; imp.title = NICHT_DA; }
    if (nicht.has('ordner')) { ord.disabled = true; ord.title = NICHT_DA; }
    z.append(imp, ord, datei);
    return z;
  }
  function zeile(k) {
    const r = el('div', `b-zeile b-kit${k.global ? ' global' : ' projekt'}`);
    const t = el('span', 'b-text', k.text); t.title = `${k.text}: click to hear pad 1`;
    r.classList.add('klickbar');
    r.addEventListener('click', () => { if (!nicht.has('vorhoeren')) vorhoereKit(host, k, 1).then((x) => { if (x.status === 'nicht_da') { nicht.add('vorhoeren'); laden(); } }); });
    r.append(t, el('span', 'b-zusatz', k.global ? 'global' : 'project'));
    const v = taste('PREVIEW', nicht.has('vorhoeren') ? NICHT_DA : 'Play every pad once', (b) => spiel(b, async () => { const x = await vorhoereKit(host, k); if (x.status === 'nicht_da') nicht.add('vorhoeren'); return x; }));
    if (nicht.has('vorhoeren')) v.disabled = true;
    const um = taste('RENAME', 'Change the name of this kit', () => { r.textContent = ''; frageName(r, k.name, async (n) => { const x = await benenneKitUm(host, k, n); if (x.status === 'nicht_da') nicht.add('verwalten'); return x; }); });
    const du = taste('DUPLICATE', 'Make a copy of this kit', (b) => spiel(b, async () => { const x = await dupliziereKit(host, k); if (x.status === 'ok') laden(); return x; }));
    const lo = taste('DELETE', 'Move this kit to the bin', (b) => spiel(b, async () => { const x = await loescheKit(host, k); if (x.status === 'ok') laden(); return x; }));
    const ex = el('a', 'b-taste', 'EXPORT');
    ex.href = `/kits/export?name=${encodeURIComponent(k.name)}&quelle=${k.quelle}`; ex.download = ''; ex.title = 'Download this kit as a zip';
    ex.addEventListener('click', (e) => e.stopPropagation());
    if (nicht.has('verwalten')) for (const b of [um, du, lo]) { b.disabled = true; b.title = NICHT_DA; }
    r.append(v, um, du, lo, ex);
    return r;
  }
  async function laden() {
    a.setze('laedt');
    const x = await ladeKits(host);
    if (x.status !== 'ok') { aus = x; return a.setze(x.status === 'nicht_da' ? 'nicht_da' : 'fehler', x.text); }
    aus = null;
    a.setze('inhalt');
    a.rumpf.textContent = '';
    a.rumpf.append(kopf());
    if (x.zeilen.length === 0) { a.rumpf.append(el('div', 'b-zeile b-leer', 'No kits yet')); return; }
    for (const k of x.zeilen) a.rumpf.append(zeile(k));
  }
  return { wurzel: a.wurzel, laden, get aus() { return aus; } };
}
