// 1.10 slice 6 T4: the routing matrix view. Rows are the strips (tracks, groups, returns, master); columns are the targets (Master, one per group), the
// send level into each return (R1..R4, click toggles 0 dB / off, double click types a number), a PRE/POST switch in each return header and one key entry per
// compressor stage. Every cell is the server's answer (GET /proj/routing, plan D1, D2): the page copies no rule, a refused cell is greyed and its click
// sends nothing. Pure parts first (matrixZeilen, zellenBefehl, sendZahl), then the view (bindeMatrix).
import { FADER_AUS, FADER_MAX, FADER_MIN, faderWert } from './track_heads.js';
import { schluesselBefehl, schluesselGruppen, schluesselLabel, wertVon } from './key_choice.js';

export const NICHT_DA_TEXT = 'Routing unavailable';
const ENTPRELL_MS = 150;     // refetch debounce (plan D1)
const KLICK_WARTE_MS = 500;  // a single click on a send waits this long (the usual double click interval) for the second click; the spec asks for a double click to type

/** The rows of the matrix: [{id, art, name, pre?, ziele: [cell], sends: [cell], stufen: [cell]}]. A cell carries `typ`, the ids its command needs and
 *  what the server said (`erlaubt`, `text`). Returns and master have no target and no send cells. */
export function matrixZeilen(m) {
  const ist = (art) => m.straenge.filter((s) => s.art === art);
  const projekt = { spuren: ist('spur'), gruppen: ist('gruppe'), returns: ist('return') };
  return m.straenge.map((s) => ({
    id: s.id, art: s.art, name: s.name, ...(s.art === 'return' ? { pre: m.returns.find((r) => r.id === s.id)?.pre === true } : {}),
    ziele: s.ziel_zellen.map((c) => ({ typ: 'ziel', strang_id: s.id, ziel: c.ziel, name: m.ziele.find((z) => z.wert === c.ziel)?.name ?? c.ziel,
      aktiv: c.aktiv, erlaubt: c.erlaubt, ...(c.erlaubt ? {} : { text: c.text ?? c.grund ?? 'Not available' }) })),
    sends: s.art === 'spur' || s.art === 'gruppe'
      ? m.returns.map((r) => ({ typ: 'send', strang_id: s.id, return_id: r.id, db: s.sends.find((x) => x.return_id === r.id)?.db ?? FADER_AUS })) : [],
    stufen: s.stufen.filter((x) => x.art === 'komp').map((x) => {
      const wert = x.schluessel ? wertVon(x.schluessel.quelle, x.schluessel.nr, x.schluessel.punkt) : 'own';
      return { typ: 'schluessel', insert_id: x.insert_id, wert, label: `Comp ${x.slot}: ${schluesselLabel(wert, projekt)}` };
    }),
  }));
}

/** The one command of a cell click; `wert` is the new value (send dB, pre flag, key choice). null: a refused cell (the reason is `zelle.text`) or
 *  nothing to change (the active target). */
export function zellenBefehl(zelle, wert) {
  if (zelle.typ === 'ziel') {
    if (!zelle.erlaubt || zelle.aktiv) return null;
    return { befehl: 'ziel_setzen', strang_id: zelle.strang_id, ausgang: zelle.ziel === 'master' ? 'master' : { art: 'gruppe', id: zelle.ziel } };
  }
  if (zelle.typ === 'send') return { befehl: 'send_setzen', strang_id: zelle.strang_id, return_id: zelle.return_id, db: wert };
  if (zelle.typ === 'pre') return { befehl: 'return_aendern', return_id: zelle.return_id, pre: wert };
  if (zelle.typ === 'schluessel') return schluesselBefehl(zelle.insert_id, wert);
  return null;
}

/** A typed send level: "-6", "-6.5 dB", "+3", "off", "-inf" -> dB (below the fader floor and "off" are -200, above the maximum is clamped); null: no number. */
export function sendZahl(t) {
  const s = String(t ?? '').trim().toLowerCase().replace(/\s*db$/, '').replace('−', '-');
  if (s === 'off' || s === '-inf') return FADER_AUS;
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return v <= FADER_MIN ? FADER_AUS : Math.min(FADER_MAX, v);
}
const sendText = (db) => (db <= FADER_MIN ? 'off' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`);

export function bindeMatrix(ctx) {
  const { $ } = ctx;
  const block = $('matrix'), status = $('matrix-status'), tabelle = $('matrix-tabelle');
  let daten = null, datenSlug = null, folge = 0, uhr = 0, offenesFeld = false;

  const el = (tag, klasse, textInhalt) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (textInhalt !== undefined) e.textContent = textInhalt; return e; };
  // a write from a cell: when the server refuses (the matrix was stale) the toast says why (writer) and the matrix is fetched again
  async function schreibe(label, befehl) {
    const ok = await ctx.aendere(label, [befehl]);
    if (!ok) holen();
    return ok;
  }
  const abgelehnt = (zelle) => ctx.melde(zelle.text ?? 'Not available', true);

  function zeichne() {
    if (offenesFeld) return;   // an open field keeps its place; it draws again when it closes
    tabelle.textContent = '';
    if (!daten) return;
    const m = daten, zeilen = matrixZeilen(m);
    const t = el('table', 'p-mx');
    const kopf = el('tr');
    kopf.append(el('th', 'p-mx-kopf-strang', 'Strip'));
    for (const z of m.ziele) kopf.append(el('th', 'p-mx-kopf-ziel', z.name));
    for (const r of m.returns) {
      const th = el('th', 'p-mx-kopf-ret'); th.dataset.ret = r.id;
      const knopf = el('button', 'p-mx-pre', r.pre ? 'PRE' : 'POST');
      knopf.dataset.ret = r.id; knopf.setAttribute('aria-pressed', String(r.pre));
      knopf.title = 'Sends into this return are taken after the track fader (POST) or before it (PRE)';
      knopf.addEventListener('click', () => schreibe(`Sends ${r.pre ? 'post' : 'pre'} fader, return ${r.name}`, zellenBefehl({ typ: 'pre', return_id: r.id, pre: r.pre }, !r.pre)));
      th.append(el('span', 'p-mx-retname', `R${r.nr} ${r.name}`), knopf);
      kopf.append(th);
    }
    kopf.append(el('th', 'p-mx-kopf-key', 'Key'));
    kopf.append(el('th', 'p-mx-kopf-resample', 'Resample'));   // 1.10 slice 7
    t.append(kopf);
    for (const z of zeilen) {
      const tr = el('tr', `p-mx-zeile p-mx-${z.art}`); tr.dataset.strang = z.id;
      tr.append(el('th', 'p-mx-name', z.name));
      if (z.ziele.length) for (const c of z.ziele) tr.append(zielZelle(c));
      else for (let i = 0; i < m.ziele.length; i++) tr.append(el('td', 'p-mx-leer'));
      if (z.sends.length) for (const c of z.sends) tr.append(sendZelle(c, z.name, m.returns.find((r) => r.id === c.return_id)));
      else for (let i = 0; i < m.returns.length; i++) tr.append(el('td', 'p-mx-leer'));
      const kz = el('td', 'p-mx-schl');
      for (const s of z.stufen) kz.append(schluesselKnopf(s, z.name));
      tr.append(kz);
      tr.append(resampleZelle(z));
      t.append(tr);
    }
    tabelle.append(t);
  }

  // 1.10 slice 7: one Resample button per strip (every row, the master too); the run, its busy text and refusals are the frame of freeze_export.js
  function resampleZelle(z) {
    const td = el('td'), b = el('button', 'p-mx-resample', '◉');
    b.dataset.strang = z.id; b.title = 'Resample: play this strip once into a new audio track'; b.setAttribute('aria-label', `Resample ${z.name}`);
    b.addEventListener('click', () => ctx.resample({ id: z.id, name: z.name }));
    td.append(b);
    return td;
  }

  function zielZelle(c) {
    const td = el('td'), b = el('button', `p-mx-ziel${c.aktiv ? ' aktiv' : ''}${c.erlaubt ? '' : ' gesperrt'}`, c.aktiv ? '●' : '○');
    b.dataset.strang = c.strang_id; b.dataset.ziel = c.ziel;
    b.setAttribute('aria-label', `${c.strang_id} to ${c.name}`);
    if (!c.erlaubt) { b.setAttribute('aria-disabled', 'true'); b.title = c.text; }
    b.addEventListener('click', () => {
      const befehl = zellenBefehl(c);
      if (befehl) schreibe(`Output ${c.strang_id} to ${c.name}`, befehl); else if (!c.erlaubt) abgelehnt(c);
    });
    td.append(b);
    return td;
  }

  function sendZelle(c, strangName, ret) {
    const td = el('td'), b = el('button', `p-mx-send${c.db > FADER_MIN ? ' an' : ''}`, sendText(c.db));
    b.dataset.strang = c.strang_id; b.dataset.ret = c.return_id;
    b.title = 'Click: 0 dB or off (after a moment). Double click: type a level';
    const label = `Send ${strangName} to ${ret?.name ?? c.return_id}`;
    let warte = 0;
    b.addEventListener('click', () => {
      clearTimeout(warte);
      // the level is read when the write is its turn (a second click before the matrix came back toggles again from the project, not from the drawn cell)
      warte = setTimeout(() => ctx.aendereAus((p) => {
        const st = (p.spuren ?? []).find((x) => x.id === c.strang_id) ?? (p.gruppen ?? []).find((x) => x.id === c.strang_id);
        const db = (st?.sends ?? []).find((x) => x.id === c.return_id)?.db ?? FADER_AUS;
        return st ? { label, befehle: [zellenBefehl(c, db > FADER_MIN ? FADER_AUS : 0)] } : null;
      }).then((ok) => { if (!ok) holen(); }), KLICK_WARTE_MS);
    });
    b.addEventListener('dblclick', () => {
      clearTimeout(warte);
      offenesFeld = true;
      const f = el('input', 'p-mx-sendfeld'); f.value = c.db > FADER_MIN ? String(c.db) : ''; f.size = 5; f.setAttribute('aria-label', `${label}, dB`);
      let fertig = false;
      const schliesse = () => { if (fertig) return; fertig = true; offenesFeld = false; zeichne(); };
      f.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { schliesse(); return; }
        if (e.key !== 'Enter') return;
        const db = sendZahl(f.value);
        if (db === null) ctx.melde('Type a level in dB (a number) or off', true);
        else schreibe(label, zellenBefehl(c, faderWert(db)));
        schliesse();
      });
      f.addEventListener('blur', schliesse);
      b.replaceWith(f); f.focus(); f.select();
    });
    td.append(b);
    return td;
  }

  // the key cell opens the same menu as the compressor popover: the options come from the server (disabled entries carry the reason)
  function schluesselKnopf(s, strangName) {
    const b = el('button', 'p-mx-key', s.label);
    b.dataset.insert = s.insert_id; b.title = 'Key source of this compressor';
    b.addEventListener('click', async () => {
      offenesFeld = true;
      const r = await ctx.holeGet(`/proj/routing?optionen=${encodeURIComponent(s.insert_id)}`);
      const o = r.status === 200 ? r.j?.straenge?.flatMap((x) => x.stufen).find((x) => x.insert_id === s.insert_id)?.optionen : null;
      if (!o) { offenesFeld = false; ctx.melde(`Key options not available: ${ctx.fehlerText(r)}`, true); return; }
      const sel = el('select', 'p-mx-keysel'); sel.setAttribute('aria-label', `Key source, ${strangName}`);
      let gr = schluesselGruppen(o, ctx.st.projekt);
      if (!gr.some((g) => g.eintraege.some((e) => e.wert === s.wert))) gr = [...gr, { titel: 'Current', eintraege: [{ label: s.label, wert: s.wert, gesperrt: false }] }];
      for (const g of gr) {
        const og = document.createElement('optgroup'); og.label = g.titel;
        for (const e of g.eintraege) { const op = document.createElement('option'); op.value = e.wert; op.textContent = e.label; op.disabled = e.gesperrt; if (e.text) op.title = e.text; og.append(op); }
        sel.append(og);
      }
      sel.value = s.wert;
      let fertig = false;
      const schliesse = () => { if (fertig) return; fertig = true; offenesFeld = false; zeichne(); };
      sel.addEventListener('change', () => { schreibe(`Key compressor on ${strangName}`, zellenBefehl(s, sel.value)); schliesse(); });
      sel.addEventListener('blur', schliesse);
      sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliesse(); });
      b.replaceWith(sel); sel.focus();
    });
    return b;
  }

  async function holen() {
    clearTimeout(uhr);
    if (!block.open || !ctx.st.projekt) return;
    const nr = ++folge;
    const r = await ctx.holeGet('/proj/routing');
    if (nr !== folge) return;   // a newer fetch overtook this one
    if (r.status === 200 && Array.isArray(r.j?.straenge)) { daten = r.j; datenSlug = r.j.slug ?? null; status.textContent = ''; }
    else { daten = null; datenSlug = null; status.textContent = NICHT_DA_TEXT; }
    zeichne();
  }
  const plane = () => { clearTimeout(uhr); uhr = setTimeout(holen, ENTPRELL_MS); };

  block.addEventListener('toggle', () => { if (block.open) holen(); else { clearTimeout(uhr); folge++; } });
  ctx.beimProjekt.push((p, wechsel) => {
    block.hidden = !p;
    if (!p || wechsel) { daten = null; datenSlug = null; tabelle.textContent = ''; status.textContent = ''; }
    if (!p || !block.open) return;
    if (daten && !wechsel && daten.rev === p.rev && datenSlug === ctx.st.slug) return;   // nothing changed since the shown matrix
    plane();
  });
}
