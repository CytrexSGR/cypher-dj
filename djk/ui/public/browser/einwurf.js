// Upload queue, type routing and drop zone of the browser (browser plan 2, task 6).
// The page decides the route before uploading (contract "Uploads by file type"): audio, MIDI and plain zips go to /import/datei, preset files to
// /presets/import, kit zips (kit.json at the top) to /kits/import, project zips (project.json at the top) to /proj/import_zip.
// A file is sent as a raw body (fetch with the File: it streams, no base64). Nothing here reads a whole file; a zip costs two small slices.
import { nutzlast } from '../production/drag.js';
export const ERLAUBT = ['wav', 'aif', 'aiff', 'flac', 'ogg', 'mp3', 'm4a', 'opus', 'mid', 'midi', 'zip'];   // .json is accepted too, as a preset file
export const MAX_BYTES = 2147483648;
const AUDIO = new Set(['wav', 'aif', 'aiff', 'flac', 'ogg', 'mp3', 'm4a', 'opus']);
export const ROH = { 'x-djk-roh': '1', 'Content-Type': 'application/octet-stream' };
const JSON_KOPF = { 'Content-Type': 'application/json' };

const endung = (name) => { const i = String(name).lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); };

export function pruefeDatei(datei) {
  const e = endung(datei.name);
  if (![...ERLAUBT, 'json'].includes(e)) {
    return { ok: false, grund: 'typ', text: `${datei.name} is not a file type the library takes. Accepted: ${ERLAUBT.join(', ')} and json (preset files).` };
  }
  if (datei.size > MAX_BYTES) {
    return { ok: false, grund: 'gross', text: `${datei.name} is ${(datei.size / 1073741824).toFixed(2)} GB (${datei.size} bytes); the limit is 2 GB per file.` };
  }
  return { ok: true };
}

const u32 = (v, o) => v.getUint32(o, true);
const u16 = (v, o) => v.getUint16(o, true);
// the entry names of a zip's central directory, read from slices of the end of the file; null when it cannot be read (zip64, broken, encrypted, too large)
async function zipNamen(datei) {
  const groesse = datei.size;
  if (groesse < 22) return null;
  const von = Math.max(0, groesse - 65558);
  const ende = new DataView(await datei.slice(von, groesse).arrayBuffer());
  let e = -1;
  for (let i = ende.byteLength - 22; i >= 0; i--) if (u32(ende, i) === 0x06054b50) { e = i; break; }
  if (e < 0) return null;
  const anzahl = u16(ende, e + 10), cdGroesse = u32(ende, e + 12), cdStart = u32(ende, e + 16);
  if (anzahl === 0xFFFF || cdGroesse === 0xFFFFFFFF || cdStart === 0xFFFFFFFF) return null;   // zip64
  if (cdGroesse > 4 * 1024 * 1024 || cdStart + cdGroesse > groesse) return null;
  let v;
  if (cdStart >= von) v = new DataView(ende.buffer, ende.byteOffset + (cdStart - von), cdGroesse);
  else v = new DataView(await datei.slice(cdStart, cdStart + cdGroesse).arrayBuffer());
  const namen = [];
  const dec = new TextDecoder('utf-8');
  let o = 0;
  while (o + 46 <= v.byteLength && u32(v, o) === 0x02014b50) {
    if (u16(v, o + 8) & 1) return null;   // encrypted
    const n = u16(v, o + 28), x = u16(v, o + 30), k = u16(v, o + 32);
    if (o + 46 + n > v.byteLength) return null;
    namen.push(dec.decode(new Uint8Array(v.buffer, v.byteOffset + o + 46, n)));
    o += 46 + n + x + k;
  }
  return namen.length > 0 ? namen : null;
}
// as zipwerk.py _top_hat: the file at the top level, or inside the one folder that holds everything
const oben = (namen, datei) => {
  const teile = namen.map((n) => n.split('/').filter((t) => t !== '' && t !== '.')).filter((t) => t.length > 0);
  if (teile.some((t) => t.length === 1 && t[0] === datei)) return true;
  const tops = new Set(teile.map((t) => t[0]));
  return tops.size === 1 && teile.some((t) => t.length === 2 && t[1] === datei);
};

export async function routeFuerDatei(datei, ziel = 'auto') {
  const e = endung(datei.name);
  const roh = (url, art) => ({ url, art, headers: { ...ROH } });
  const importUrl = `/import/datei?name=${encodeURIComponent(datei.name)}&ziel=${encodeURIComponent(ziel)}`;
  if (e === 'json') return { url: '/presets/import', art: 'preset', headers: { ...JSON_KOPF } };
  if (e === 'zip') {
    let namen = null;
    try { namen = await zipNamen(datei); } catch { namen = null; }
    if (namen && oben(namen, 'project.json')) return roh('/proj/import_zip', 'projekt');
    if (namen && oben(namen, 'kit.json')) return roh('/kits/import', 'kit');
    return roh(importUrl, 'zip');
  }
  return roh(importUrl, e === 'mid' || e === 'midi' ? 'midi' : 'audio');
}

const NICHT_DA = 'Import is not available in this build yet';
const routeName = (url) => (url.startsWith('/kits/') ? 'kit import' : url.startsWith('/proj/') ? 'project import' : url.startsWith('/presets/') ? 'preset import' : 'import');
const routeSchluessel = (url) => url.split('?')[0];

// Every file ends in exactly one of three lists: added (ergebnisse), failed (fehler, with the reason) or not sent (nichtGesendet, with the reason).
// A 404 blocks only the route that answered it: the files bound for that route are not sent, files for other routes go on.
export function neueWarteschlange(a) {
  const parallel = a.parallel ?? 2;
  const stand = { fertig: 0, gesamt: 0, fehler: [], nichtGesendet: [], laeuft: false };
  const ergebnisse = [];
  let warten = [], kopf = 0, aktiv = 0, leer = [], bestaetigt = false;   // until one answer is in, one file at a time: a missing route stops after one call
  let gesperrt = new Map();   // route -> the reason its files are not sent
  const laufende = new Set();
  const kopie = () => ({ ...stand, fehler: [...stand.fehler], nichtGesendet: [...stand.nichtGesendet] });
  const melde = () => a.beiAenderung?.(kopie());
  const pruefeLeer = () => {
    if (!stand.laeuft || aktiv > 0 || kopf < warten.length) return;
    stand.laeuft = false; warten = []; kopf = 0;
    melde();
    const l = leer; leer = []; for (const f of l) f();
  };
  const nicht = (datei, text) => { stand.nichtGesendet.push({ name: datei.name, text }); stand.fertig++; };
  async function einer(datei, ziel) {
    aktiv++;
    const ctl = new AbortController();
    laufende.add(ctl);
    let gezaehlt = false;
    try {
      const route = await routeFuerDatei(datei, ziel);
      const k = routeSchluessel(route.url);
      if (gesperrt.has(k)) { nicht(datei, gesperrt.get(k)); gezaehlt = true; return; }
      if (ctl.signal.aborted) { nicht(datei, 'Cancelled'); gezaehlt = true; return; }
      const r = await a.sende(datei, route, ctl.signal);
      if (r.status !== 404) bestaetigt = true;
      if (r.status >= 200 && r.status < 300) {
        const j = r.j ?? {};
        const ein = { art: j.art ?? route.art, name: datei.name };
        if (j.slug !== undefined) ein.slug = j.slug;
        if (j.kits_umbenannt !== undefined) ein.kits_umbenannt = j.kits_umbenannt;
        if (j.sha256 !== undefined) ein.sha256 = j.sha256;
        if (j.pfad !== undefined) ein.pfad = j.pfad;
        ergebnisse.push(ein);
      } else if (r.status === 404) {
        const text = k === '/import/datei' ? NICHT_DA : `The ${routeName(route.url)} is not available in this build yet`;
        gesperrt.set(k, text);
        stand.fehler.push({ name: datei.name, text });
      } else {
        stand.fehler.push({ name: datei.name, text: r.j?.text || `The upload failed (${r.status || 'no connection'})` });
      }
    } catch (e) {
      if (ctl.signal.aborted) { if (!gezaehlt) nicht(datei, 'Cancelled'); gezaehlt = true; }
      else stand.fehler.push({ name: datei.name, text: `The upload failed: ${e?.message ?? e}` });
    } finally {
      laufende.delete(ctl);
      aktiv--; if (!gezaehlt) stand.fertig++;
      melde();
      pumpe();
    }
  }
  function pumpe() {
    while (aktiv < (bestaetigt ? parallel : 1) && kopf < warten.length) { const [d, z] = warten[kopf++]; einer(d, z); }
    pruefeLeer();
  }
  return {
    fuegeHinzu(dateien, ziel) {
      if (dateien.length === 0) return;
      if (!stand.laeuft) { stand.fertig = 0; stand.gesamt = 0; stand.fehler = []; stand.nichtGesendet = []; stand.laeuft = true; bestaetigt = false; gesperrt = new Map(); ergebnisse.length = 0; }
      for (const d of dateien) {
        stand.gesamt++;
        const p = pruefeDatei(d);
        if (!p.ok) { stand.fehler.push({ name: d.name, text: p.text }); stand.fertig++; continue; }
        warten.push([d, ziel]);
      }
      melde();
      pumpe();
    },
    stand: kopie,
    ergebnisse: () => [...ergebnisse],
    abbrechen() {   // what has not started is not sent; what runs is aborted; files added later start normally
      while (kopf < warten.length) nicht(warten[kopf++][0], 'Cancelled');
      for (const c of laufende) c.abort();
      pruefeLeer();
    },
    sobaldLeer: () => new Promise((ok) => { if (!stand.laeuft || (aktiv === 0 && kopf >= warten.length)) ok(); else leer.push(ok); }),
  };
}

// the line the page shows: the truth about every file of the batch
export function zusammenfassung(s) {
  const fehler = s.fehler.length, nicht = s.nichtGesendet.length;
  if (s.laeuft) return { text: `Adding files: ${s.fertig} of ${s.gesamt}${fehler + nicht ? ` (${fehler + nicht} not added)` : ''}`, fehler: false };
  const teile = [`${s.gesamt - fehler - nicht} of ${s.gesamt} files added`];
  if (fehler) teile.push(`${fehler} failed: ${[...new Set(s.fehler.slice(0, 3).map((f) => f.text))].join(' ')}`);
  if (nicht) teile.push(`${nicht} not sent: ${[...new Set(s.nichtGesendet.slice(0, 3).map((f) => f.text))].join(' ')}`);
  return { text: teile.join('; '), fehler: fehler + nicht > 0 };
}

// the real sender: the File is the body, the headers are those of the route
export function echterSender(fetchFn = globalThis.fetch) {
  return async (datei, route, signal) => {
    const r = await fetchFn(route.url, { method: 'POST', headers: route.headers, body: datei, signal });
    let j = null; try { j = await r.json(); } catch { /* an answer without JSON */ }
    return { status: r.status, j };
  };
}

// A desktop audio file dropped on an audio track (task 9): import it, wait until the library build has seen it, then place it where it was dropped.
// a: { host, datei, spurIndex, beat, sende, warte(ms), lege(nutzlast, spurIndex, beat), versuche? }. Informational endings carry info: true.
export async function legeNachImport(a) {
  const info = (text) => ({ ok: false, info: true, text });
  const p = pruefeDatei(a.datei);
  if (!p.ok) return { ok: false, text: p.text };
  const route = await routeFuerDatei(a.datei, 'auto');
  if (route.art !== 'audio') {
    if (route.art !== 'midi') return { ok: false, text: `${a.datei.name} is not an audio file; use the library drop zone for it` };
    const r = await a.sende(a.datei, route);
    return r.status >= 200 && r.status < 300 ? info('Imported. MIDI files are not placed from here; find it in your library.') : { ok: false, text: r.j?.text || `The upload failed (${r.status || 'no connection'})` };
  }
  const r = await a.sende(a.datei, route);
  if (r.status === 404) return { ok: false, text: NICHT_DA };
  if (r.status < 200 || r.status >= 300) return { ok: false, text: r.j?.text || `The upload failed (${r.status || 'no connection'})` };
  const sha = r.j?.sha256;
  if (typeof sha !== 'string') return info('Imported into your library. Drag it from LIBRARY once the build is done.');
  const platziere = async () => {   // the catalogue row of the file, when it is there and draggable
    const d = await a.host.holeGet(`/stoebern/detail?sha=${sha}`);
    const nutz = d.status === 200 ? nutzlast(d.j?.eintrag) : null;
    if (!nutz) return false;
    a.lege(nutz, a.spurIndex, a.beat);
    return true;
  };
  if (await platziere()) return { ok: true };   // the file is already known: no waiting
  const stand = async () => { const x = await a.host.holeGet('/bibliothek/stand'); return x.status === 200 ? (x.j ?? {}) : x.status === 404 ? 'fehlt' : null; };
  const OHNE_STAND = info('Imported into your library. This build cannot report the library build, so the file is not placed; drag it from LIBRARY.');
  const s0 = await stand();
  if (s0 === 'fehlt') return OHNE_STAND;
  if (s0?.fremd) return info("Imported. This library is managed by another tool, so the file cannot be placed from here; find it in the shelf's FOLDERS mode in STUDIO.");
  const versuche = a.versuche ?? 120;
  let basis = s0?.letzter_bau?.zeit ?? null, n = 0;
  const warteEnde = async (neuer) => {   // -> the stand at the end of a build; null after too many tries; 'fehlt' when the route is gone
    while (n < versuche) {
      await a.warte(1000); n++;
      const s = await stand();
      if (s === 'fehlt') return s;
      if (s && s.phase === 'ruht' && (!neuer || (s.letzter_bau?.zeit ?? null) !== basis)) return s;
    }
    return null;
  };
  const ZU_SPAET = { ok: false, text: 'The library build did not finish in time; drag the file from LIBRARY once it is done.' };
  if (s0 && s0.phase !== 'ruht') {
    // a build that was already running may have scanned before the file landed: after its end, start one more and wait for that one
    const e1 = await warteEnde(false);
    if (e1 === 'fehlt') return OHNE_STAND;
    if (!e1) return ZU_SPAET;
    basis = e1.letzter_bau?.zeit ?? null;
    await a.host.holeJson('/bibliothek/bauen', {});
  }
  const ende = await warteEnde(true);
  if (ende === 'fehlt') return OHNE_STAND;
  if (!ende) return ZU_SPAET;
  if (await platziere()) return { ok: true };
  return info('Imported into your library, but the file cannot be placed yet. Drag it from LIBRARY.');
}

const hatDateien = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

export function bindeEinwurf(a) {
  const status = document.createElement('div');
  status.className = 'b-einwurf-status'; status.hidden = true; status.setAttribute('role', 'status');
  const zeige = (s) => {
    const z = zusammenfassung(s);
    status.hidden = s.gesamt === 0;
    status.textContent = z.text;
    status.classList.toggle('fehler', z.fehler && !s.laeuft);
  };
  const q = neueWarteschlange({ sende: a.sende ?? echterSender(), beiAenderung: zeige });
  const nachBatch = () => { q.sobaldLeer().then(() => { const e = q.ergebnisse(); if (e.length) a.beiBatch(e); }); };
  const nimm = (dateien, ziel = 'bibliothek') => { q.fuegeHinzu(dateien, ziel); nachBatch(); };

  let tiefe = 0;
  const weg = () => { tiefe = 0; a.wurzel.classList.remove('einwurf-an'); };
  a.wurzel.addEventListener('dragenter', (e) => { if (!hatDateien(e)) return; e.preventDefault(); tiefe++; a.wurzel.classList.add('einwurf-an'); });
  a.wurzel.addEventListener('dragover', (e) => { if (!hatDateien(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  a.wurzel.addEventListener('dragleave', (e) => { if (!hatDateien(e)) return; if (--tiefe <= 0) weg(); });
  a.wurzel.addEventListener('drop', (e) => {
    if (!hatDateien(e)) return;
    e.preventDefault(); weg();
    const items = [...(e.dataTransfer.items ?? [])];
    if (items.some((i) => i.webkitGetAsEntry?.()?.isDirectory)) { a.host.melde('Drop files here; use ADD FOLDER for a folder', true); return; }
    nimm([...e.dataTransfer.files]);
  });
  return {
    waehleDateien(ziel = 'bibliothek') {
      const f = document.createElement('input');
      f.type = 'file'; f.multiple = true; f.accept = [...ERLAUBT, 'json'].map((x) => `.${x}`).join(',');
      f.addEventListener('change', () => { nimm([...f.files], ziel); });
      f.click();
    },
    nimm,
    ziel: () => status,
  };
}
