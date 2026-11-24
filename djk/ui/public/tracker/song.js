// TRACKER view, the SONG column (plan 2026-11-18-tracker.md, task 10): the list of sections (number, name, length in rows) with one small pattern cell per
// track, the buttons that send the section commands of task 8 for the selected section, and the pattern menu of a cell. DOM items (data-t): song-liste,
// song-neu, song-dup-link, song-dup-kopie, song-loeschen, song-hoch, song-runter, song-zeilen (ROWS), song-name (NAME), song-menue, song-muster (one per
// pattern of the track, data-clip = the clip to link with), song-leer (NEW), song-eigen (UNIQUE); a section row is `.t-lied-zeile[data-abschnitt]`, a
// pattern cell `[data-t="song-zelle"][data-abschnitt][data-spur]` (data-verbund + a colour from the verbund id when linked). Refusals reach the page
// through ctx.aendere (antwortText). Pure helpers first (tested in Node), the DOM below.
import { abschnitte, trackerEinstellung } from './grid_model.js';

export const SONG_TEXT = {
  neu: 'New empty section after the selected one', dupLink: 'Duplicate the section; its clips become members of the same patterns',
  dupKopie: 'Duplicate the section with independent copies of its clips', loeschen: 'Delete the selected section with the clips inside it',
  hoch: 'Move the section up', runter: 'Move the section down', zeilen: 'Length of the section in rows', name: 'Name of the section (empty removes it)',
  zeile: 'Select this section', zelle: 'Pattern of this track in the section; double click for the pattern menu',
  leer: 'NEW: an empty pattern as long as the section', eigen: 'UNIQUE: make the clip independent of its pattern',
  frageLoeschen: (n) => `Delete section ${n} with the clips inside it?`,
  zeilenFalsch: 'ROWS needs a whole number of rows, 1 or more',
};

const EPS = 1e-9;

// the clip of a track that covers most of the section (ties: the earlier start); null when none overlaps
export function deckendeClip(spur, abschnitt) {
  const bis = abschnitt.von_beat + abschnitt.laenge_beats;
  let best = null, bestLaenge = EPS;
  for (const c of spur?.clips ?? []) {
    const l = Math.min(bis, c.start_beat + c.laenge_beats) - Math.max(abschnitt.von_beat, c.start_beat);
    if (l > bestLaenge + EPS || (best !== null && Math.abs(l - bestLaenge) <= EPS && c.start_beat < best.start_beat)) { best = c; bestLaenge = l; }
  }
  return best;
}

// a stable colour from the verbund id (FNV-1a hash onto the hue circle)
export function verbundFarbe(id) {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return `hsl(${h % 360} 55% 38%)`;
}

// the patterns a track offers to a cell: every other MIDI clip, one entry per verbund (the covering clip's own pattern is not offered)
export function musterListe(spur, deckend) {
  const aus = [], gesehen = new Set(deckend?.verbund ? [deckend.verbund] : []);
  for (const c of spur?.clips ?? []) {
    if (c.art !== 'midi' || c.id === deckend?.id) continue;
    if (c.verbund) { if (gesehen.has(c.verbund)) continue; gesehen.add(c.verbund); }
    aus.push(c);
  }
  return aus;
}

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function bindeSong(ctx) {
  const { st, $ } = ctx;
  const lied = $('lied');
  const el = (tag, klasse, t, text, titel) => {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (t) e.setAttribute('data-t', t);
    if (text !== undefined) e.textContent = text;
    if (titel) e.setAttribute('title', titel);
    if (tag === 'button') e.setAttribute('type', 'button');
    return e;
  };
  const titel = el('div', 't-titel', null, 'SONG');
  const liste = el('div', 't-lied-liste', 'song-liste');
  const menue = el('div', 't-lied-menue', 'song-menue');
  menue.hidden = true;
  const knoepfe = el('div', 't-lied-knoepfe', 'song-knoepfe');
  const kn = (t, text, tip) => knoepfe.appendChild(el('button', 't-knopf', t, text, tip));
  kn('song-neu', 'NEW', SONG_TEXT.neu); kn('song-dup-link', 'DUP LINK', SONG_TEXT.dupLink); kn('song-dup-kopie', 'DUP COPY', SONG_TEXT.dupKopie);
  kn('song-loeschen', 'DELETE', SONG_TEXT.loeschen); kn('song-hoch', 'UP', SONG_TEXT.hoch); kn('song-runter', 'DOWN', SONG_TEXT.runter);
  const feld = (t, beschriftung, tip) => {
    const l = el('label', 't-feld'); const s = document.createElement('span'); s.textContent = beschriftung;
    const i = el('input', 't-eingabe t-lied-feld', t); i.setAttribute('type', 'text'); i.setAttribute('title', tip); i.setAttribute('aria-label', beschriftung);
    l.append(s, i); knoepfe.appendChild(l);
    return i;
  };
  const zeilenFeld = feld('song-zeilen', 'ROWS', SONG_TEXT.zeilen);
  const nameFeld = feld('song-name', 'NAME', SONG_TEXT.name);
  lied.append(titel, liste, menue, knoepfe);

  let menuZiel = null;   // {spur_id, clip_id | null, abschnitt}
  const schliesse = () => { menuZiel = null; menue.hidden = true; menue.innerHTML = ''; };
  const liste_ = () => (st.projekt ? abschnitte(st.projekt) : []);
  const aktuell = () => liste_().find((a) => a.id === st.abschnitt_id) ?? null;
  const nummer = (n) => (st.zahlen === 'dec' ? String(n).padStart(2, '0') : n.toString(16).toUpperCase().padStart(2, '0'));

  function fuelleFelder(erzwinge = false) {
    const a = aktuell();
    const lpb = st.projekt ? trackerEinstellung(st.projekt).lpb : 4;
    if (erzwinge || document.activeElement !== zeilenFeld) zeilenFeld.value = a ? String(Math.round(a.laenge_beats * lpb)) : '';
    if (erzwinge || document.activeElement !== nameFeld) nameFeld.value = a?.name ?? '';
  }

  function zeichneListe() {
    const p = st.projekt;
    if (!p) { liste.innerHTML = ''; schliesse(); return; }
    const lpb = trackerEinstellung(p).lpb;
    const spuren = (ctx.raster?.()?.spuren ?? p.spuren.map((s, i) => ({ spur_id: s.id, buchstabe: String.fromCharCode(65 + i), art: s.art, name: s.name })));
    liste.innerHTML = abschnitte(p).map((a) => {
      const zellen = spuren.map((rs) => {
        const spur = p.spuren.find((s) => s.id === rs.spur_id);
        const c = deckendeClip(spur, a);
        const farbe = c?.verbund ? ` data-verbund="${esc(c.verbund)}" style="background:${verbundFarbe(c.verbund)}"` : '';
        return `<span class="t-lied-zelle${c ? '' : ' leer'}" data-t="song-zelle" data-abschnitt="${esc(a.id)}" data-spur="${esc(rs.spur_id)}" data-art="${esc(rs.art)}"`
          + ` title="${esc(`${c?.name ? `${c.name}: ` : ''}${SONG_TEXT.zelle} (${rs.buchstabe} ${rs.name})`)}"${farbe}>${esc(c?.name ?? '')}</span>`;
      }).join('');
      return `<div class="t-lied-zeile${a.id === st.abschnitt_id ? ' an' : ''}" data-abschnitt="${esc(a.id)}" role="button" tabindex="0" title="${SONG_TEXT.zeile}">`
        + `<span class="t-lied-nr">${nummer(a.nr)}</span><span class="t-lied-name">${esc(a.name)}</span><span class="t-lied-zeilen">${Math.round(a.laenge_beats * lpb)}</span>`
        + `<span class="t-lied-zellen">${zellen}</span></div>`;
    }).join('');
  }

  ctx.beimZeichnen.push(() => { schliesse(); zeichneListe(); fuelleFelder(); });

  liste.addEventListener('click', (e) => {
    const z = e.target.closest?.('[data-abschnitt]');
    if (z) ctx.waehleAbschnitt(z.getAttribute('data-abschnitt'));
  });
  liste.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const z = e.target.closest?.('.t-lied-zeile');
    if (z) { e.preventDefault?.(); ctx.waehleAbschnitt(z.getAttribute('data-abschnitt')); }
  });

  // --- the pattern menu of a cell ---
  liste.addEventListener('dblclick', (e) => {
    const z = e.target.closest?.('[data-t="song-zelle"]');
    const p = st.projekt;
    if (!z || !p || z.getAttribute('data-art') !== 'instrument') return;
    const a = abschnitte(p).find((x) => x.id === z.getAttribute('data-abschnitt'));
    const spur = p.spuren.find((s) => s.id === z.getAttribute('data-spur'));
    if (!a || !spur) return;
    ctx.waehleAbschnitt(a.id);
    const deckend = deckendeClip(spur, a);
    menuZiel = { spur_id: spur.id, clip_id: deckend?.id ?? null, abschnitt: { von_beat: a.von_beat, laenge_beats: a.laenge_beats } };
    menue.innerHTML = '';
    const kopfZeile = el('div', 't-titel', null, `PATTERN ${spur.name}`);
    menue.appendChild(kopfZeile);
    if (deckend) for (const c of musterListe(spur, deckend)) {
      const b = el('button', 't-lied-muster', 'song-muster', c.name, `Link this section's clip to the pattern ${c.name}`);
      b.setAttribute('data-clip', c.id);
      if (c.verbund) b.setAttribute('style', `border-left:6px solid ${verbundFarbe(c.verbund)}`);
      menue.appendChild(b);
    }
    menue.appendChild(el('button', 't-knopf', 'song-leer', 'NEW', SONG_TEXT.leer));
    const eigen = el('button', 't-knopf', 'song-eigen', 'UNIQUE', SONG_TEXT.eigen);
    eigen.disabled = !deckend?.verbund;
    menue.appendChild(eigen);
    menue.hidden = false;
  });
  lied.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliesse(); });

  menue.addEventListener('click', async (e) => {
    const b = e.target.closest?.('button');
    const ziel = menuZiel;
    if (!b || b.disabled || !ziel) return;
    const t = b.getAttribute('data-t');
    schliesse();
    if (t === 'song-muster') await ctx.aendere('Link pattern', [{ befehl: 'clip_verknuepfen', clip_id: ziel.clip_id, mit: b.getAttribute('data-clip') }]);
    else if (t === 'song-eigen') await ctx.aendere('Make pattern unique', [{ befehl: 'clip_entknuepfen', clip_id: ziel.clip_id }]);
    else if (t === 'song-leer') {
      const neu = { befehl: 'clip_neu', spur_id: ziel.spur_id, art: 'midi', start_beat: ziel.abschnitt.von_beat, laenge_beats: ziel.abschnitt.laenge_beats };
      await ctx.aendere('New empty pattern', ziel.clip_id ? [{ befehl: 'clip_loeschen', clip_id: ziel.clip_id }, neu] : [neu]);
    }
    ctx.zeichne();
  });

  // --- the section buttons ---
  const ids = () => liste_().map((a) => a.id);
  async function aendereAbschnitt(label, befehl, nachher) {
    const vorher = ids();
    const ok = await ctx.aendere(label, [befehl]);
    if (ok && nachher) nachher(vorher, ids());
    fuelleFelder(true);
    ctx.zeichne();
    return ok;
  }
  const mitAbschnitt = (f) => () => { const a = aktuell(); if (a) return f(a); return undefined; };
  const neuerId = (vorher, jetzt) => jetzt.find((i) => !vorher.includes(i));
  const waehleNeu = (vorher, jetzt) => { const n = neuerId(vorher, jetzt); if (n) ctx.waehleAbschnitt(n); };
  $('song-neu').addEventListener('click', mitAbschnitt((a) => aendereAbschnitt('New section', { befehl: 'abschnitt_neu', nach: a.id }, waehleNeu)));
  $('song-dup-link').addEventListener('click', mitAbschnitt((a) => aendereAbschnitt('Duplicate section (linked)', { befehl: 'abschnitt_duplizieren', id: a.id, als: 'verknuepft' }, waehleNeu)));
  $('song-dup-kopie').addEventListener('click', mitAbschnitt((a) => aendereAbschnitt('Duplicate section (copy)', { befehl: 'abschnitt_duplizieren', id: a.id, als: 'kopie' }, waehleNeu)));
  $('song-hoch').addEventListener('click', mitAbschnitt((a) => aendereAbschnitt('Move section up', { befehl: 'abschnitt_verschieben', id: a.id, richtung: -1 })));
  $('song-runter').addEventListener('click', mitAbschnitt((a) => aendereAbschnitt('Move section down', { befehl: 'abschnitt_verschieben', id: a.id, richtung: 1 })));
  $('song-loeschen').addEventListener('click', mitAbschnitt(async (a) => {
    if (!ctx.frage(SONG_TEXT.frageLoeschen(nummer(a.nr) + (a.name ? ` "${a.name}"` : '')))) return;
    const index = ids().indexOf(a.id);
    await aendereAbschnitt('Delete section', { befehl: 'abschnitt_loeschen', id: a.id }, (v, j) => { if (j.length < v.length && j.length) ctx.waehleAbschnitt(j[Math.min(index, j.length - 1)]); });
  }));
  zeilenFeld.addEventListener('change', mitAbschnitt(async (a) => {
    const n = Number(String(zeilenFeld.value).trim());
    if (!Number.isInteger(n) || n < 1) { ctx.melde(SONG_TEXT.zeilenFalsch, true); fuelleFelder(true); return; }
    await aendereAbschnitt('Section length', { befehl: 'abschnitt_laenge', id: a.id, zeilen: n });
  }));
  nameFeld.addEventListener('change', mitAbschnitt((a) => {
    const t = nameFeld.value.trim();
    return aendereAbschnitt('Rename section', { befehl: 'abschnitt_umbenennen', id: a.id, name: t === '' ? null : t });
  }));
}
