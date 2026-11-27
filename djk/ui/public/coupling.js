// Pair tablet (task 10): the dialog on the main page (loopback listener only). POST /kopplung gives a one-time link (valid 2 minutes); it is shown as a QR code
// (qr.js, drawn in the page, no library) and as text. Paired devices are listed and can be revoked. The server refuses all of this on the tablet listener.
import { qrSvg } from './qr.js';
import { datumText } from './format_text.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const TABLET_AUS_TEXT = 'Tablet access is off. Turn it on with {"an": true} in ~/.config/cypherdj/tablet.json, then restart the page server.';

/** A readable name for a paired device from the stored name (a raw user-agent string): "Chrome on Android", "Safari on iPad", "Firefox on Linux"; "Tablet" when
 *  the browser or the system is not recognised. The raw string belongs in a `title`. */
export function geraeteName(g) {
  const ua = String(g?.name ?? '');
  const browser = /\bEdgA?\/|\bEdg\//.test(ua) ? 'Edge' : /\bOPR\//.test(ua) ? 'Opera' : /\bFirefox\/|\bFxiOS\//.test(ua) ? 'Firefox'
    : /\bChrome\/|\bCriOS\//.test(ua) ? 'Chrome' : /\bSafari\//.test(ua) && /\bVersion\//.test(ua) ? 'Safari' : null;
  const system = /\biPad\b/.test(ua) ? 'iPad' : /\biPhone\b/.test(ua) ? 'iPhone' : /\bAndroid\b/.test(ua) ? 'Android' : /\bCrOS\b/.test(ua) ? 'ChromeOS'
    : /\bWindows\b/.test(ua) ? 'Windows' : /\bMac OS X\b|\bMacintosh\b/.test(ua) ? 'macOS' : /\bLinux\b|\bX11\b/.test(ua) ? 'Linux' : null;
  return browser && system ? `${browser} on ${system}` : 'Tablet';
}

const STUFEN = { lesen: 'read only', schreiben: 'write', zerstoerend: 'full' };
/** Level of an agent key as shown in the page: lesen "read only", schreiben "write", zerstoerend "full". Unknown values are shown as they are. */
export const stufeText = (stufe) => STUFEN[stufe] ?? String(stufe ?? '');
export const SCHLUESSEL_HINWEIS = 'Copy it now; it is not shown again. Give it to the agent as its key file.';

/** One row of the agent key list: name, level and last use as text (the cells of the row, not markup). */
export function schluesselZeile(s) {
  const zuletzt = s?.zuletzt ? datumText(s.zuletzt) : 'never';
  return { id: String(s?.id ?? ''), name: String(s?.name ?? '') || 'Agent', stufe: stufeText(s?.stufe), zuletzt: `last used ${zuletzt}` };
}

/** Binds the button and the dialog. ruf(methode, pfad, body?) -> {code, j}; defaults to fetch. Returns { oeffne, schliesse }. */
export function bindeKopplung({ knopf, dialog, ruf, jetzt = () => Date.now() }) {
  const http = ruf ?? (async (methode, pfad, body) => {
    const r = await fetch(pfad, { method: methode, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { code: r.status, j: await r.json().catch(() => ({})) };
  });
  const koerper = dialog.querySelector('[data-kopplung-inhalt]');
  let bis = 0, uhr = null, liste = null, aus = false, bereit = false;
  // schluessel: null loading, false route not there (section hidden), else the rows
  let currentLink = null, schluessel = null, neuerToken = null, schluesselFehler = '';
  const schluesselHtml = (name, stufe) => schluessel === false ? '' : `<h3>Agent keys</h3>
      ${neuerToken ? `<p class="kopplung-hinweis">${esc(SCHLUESSEL_HINWEIS)}</p>
        <input class="kopplung-link" readonly value="${esc(neuerToken)}" aria-label="New agent key" data-schluessel-token onfocus="this.select()">` : ''}
      ${schluesselFehler ? `<p class="kopplung-hinweis">${esc(schluesselFehler)}</p>` : ''}
      <div class="kopplung-reihe"><input data-schluessel-name placeholder="Name" aria-label="Agent key name" maxlength="60" value="${esc(name)}">
        <select data-schluessel-stufe aria-label="Agent key level">
          ${Object.keys(STUFEN).map((k) => `<option value="${k}"${k === stufe ? ' selected' : ''}>${esc(STUFEN[k])}</option>`).join('')}</select>
        <button type="button" data-schluessel-neu>NEW KEY</button></div>
      <ul class="kopplung-geraete" data-schluessel-liste></ul>`;
  const zeichne = (link, text) => {
    currentLink = link;
    const name = koerper.querySelector('[data-schluessel-name]')?.value ?? '', stufe = koerper.querySelector('[data-schluessel-stufe]')?.value ?? 'schreiben';
    koerper.innerHTML = `${link ? `<div class="kopplung-qr">${qrSvg(link)}</div>
      <p class="kopplung-text">Scan with the tablet camera, or type the address. Valid for <b data-kopplung-rest>2:00</b> and only once.</p>
      <input class="kopplung-link" readonly value="${esc(link)}" aria-label="Pairing link" onfocus="this.select()">` : ''}
      ${text ? `<p class="kopplung-hinweis">${esc(text)}</p>` : ''}
      <div class="kopplung-reihe"><button type="button" data-kopplung-neu${aus || !bereit ? ' disabled' : ''}>NEW LINK</button><button type="button" data-kopplung-zu>CLOSE</button></div>
      <h3>Paired devices</h3><ul class="kopplung-geraete" data-kopplung-liste></ul>${schluesselHtml(name, stufe)}`;
    koerper.querySelector('[data-kopplung-neu]').addEventListener('click', neu);
    koerper.querySelector('[data-kopplung-zu]').addEventListener('click', schliesse);
    koerper.querySelector('[data-schluessel-neu]')?.addEventListener('click', neuerSchluessel);
    zeigeListe();
    zeigeSchluessel();
  };
  const zeigeSchluessel = () => {
    const ul = koerper.querySelector('[data-schluessel-liste]');
    if (!ul) return;
    if (schluessel === null) { ul.innerHTML = '<li class="kopplung-leer">…</li>'; return; }
    ul.innerHTML = schluessel.length ? schluessel.map((k) => { const z = schluesselZeile(k);
      return `<li><span>${esc(z.name)} <small>${esc(z.stufe)}, ${esc(z.zuletzt)}</small></span>
        <button type="button" data-schluessel-weg="${esc(z.id)}" title="The agent loses access with this key">REVOKE</button></li>`; }).join('')
      : '<li class="kopplung-leer">none</li>';
    for (const b of ul.querySelectorAll('[data-schluessel-weg]')) b.addEventListener('click', async () => {
      try { await http('POST', '/hand/schluessel/loeschen', { id: b.dataset.schluesselWeg }); } catch { /* the list below shows the truth */ }
      await ladeSchluessel();
    });
  };
  // GET /hand/schluessel: an array or {schluessel: [...]}. Anything but 200 (404 on a server without the route) hides the section.
  const ladeSchluessel = async () => {
    const vorher = schluessel;
    try {
      const r = await http('GET', '/hand/schluessel');
      const rows = Array.isArray(r.j) ? r.j : r.j?.schluessel;
      schluessel = r.code === 200 && Array.isArray(rows) ? rows : false;
    } catch { schluessel = false; }
    if ((vorher === false) !== (schluessel === false)) zeichne(null, ''); else zeigeSchluessel();
  };
  async function neuerSchluessel() {
    const name = koerper.querySelector('[data-schluessel-name]')?.value.trim() ?? '';
    const stufe = koerper.querySelector('[data-schluessel-stufe]')?.value ?? 'schreiben';
    if (!name) { schluesselFehler = 'Give the key a name.'; zeichne(bis > 0 ? currentLink : null, ''); return; }
    let r;
    try { r = await http('POST', '/hand/schluessel', { name, stufe }); } catch (e) { r = { code: 0, j: { text: `Page server unreachable: ${e.message}` } }; }
    schluesselFehler = r.code === 200 && r.j?.token ? '' : (r.j?.text ?? `Refused (${r.code}).`);
    neuerToken = r.code === 200 ? (r.j?.token ?? null) : null;
    zeichne(bis > 0 ? currentLink : null, '');
    await ladeSchluessel();
  }
  const zeigeListe = () => {
    const ul = koerper.querySelector('[data-kopplung-liste]');
    if (!ul) return;
    if (liste === null) { ul.innerHTML = '<li class="kopplung-leer">…</li>'; return; }
    ul.innerHTML = liste.length ? liste.map((g) => `<li><span><span title="${esc(g.name ?? '')}">${esc(geraeteName(g))}</span> <small>paired ${esc(datumText(g.seit))}, last seen ${esc(datumText(g.zuletzt))}</small></span><button type="button" data-kopplung-weg="${esc(g.id)}" title="The device must be paired again">REVOKE</button></li>`).join('')
      : '<li class="kopplung-leer">none</li>';
    for (const b of ul.querySelectorAll('[data-kopplung-weg]')) b.addEventListener('click', async () => { await http('POST', '/kopplung/loeschen', { id: b.dataset.kopplungWeg }); await laden(); });
  };
  const laden = async () => {
    try {
      const r = await http('GET', '/kopplung');
      bereit = true;   // NEW LINK waits for this answer: until it is here the page does not know whether a link can be made
      if (r.code !== 200) return;
      liste = r.j.geraete ?? [];
      const war = aus;
      aus = r.j.an === false;
      if (aus && !war) { bis = 0; zeichne(null, TABLET_AUS_TEXT); return; }   // no QR block, NEW LINK disabled: it could only answer with the refusal
      zeigeListe();
    } catch { bereit = true; /* page server gone: the list stays */ }
  };
  const tick = () => {
    const rest = Math.max(0, Math.round((bis - jetzt()) / 1000));
    const e = koerper.querySelector('[data-kopplung-rest]');
    if (e) e.textContent = `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`;
    if (rest === 0 && bis > 0) { bis = 0; zeichne(null, 'The link expired. Create a new one.'); }
  };
  async function neu() {
    if (aus) return;
    let r;
    try { r = await http('POST', '/kopplung', {}); } catch (e) { zeichne(null, `Page server unreachable: ${e.message}`); return; }
    if (r.code !== 200) { zeichne(null, r.j?.text ?? `Refused (${r.code}).`); return; }
    bis = r.j.bis;
    zeichne(r.j.link, '');
    tick();
  }
  function oeffne() {
    if (!dialog.open) dialog.showModal?.();
    liste = null; schluessel = null; neuerToken = null; schluesselFehler = '';
    clearInterval(uhr);
    uhr = setInterval(() => { tick(); laden(); }, 1000);
    aus = false; bereit = false;
    zeichne(null, '');
    ladeSchluessel();
    laden().then(() => { if (!aus) neu(); });   // the answer of GET says whether a link can be made at all
  }
  function schliesse() { clearInterval(uhr); uhr = null; bis = 0; neuerToken = null; if (dialog.open) dialog.close?.(); koerper.innerHTML = ''; }
  knopf.addEventListener('click', oeffne);
  dialog.addEventListener('close', () => { clearInterval(uhr); uhr = null; bis = 0; neuerToken = null; });
  return { oeffne, schliesse };
}
