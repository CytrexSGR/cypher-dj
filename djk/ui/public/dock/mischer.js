// The mixer parts of a group or return card in PRODUCTION (switch `mischer`): M and S, PAN, the output select of a group and the LEVEL that follows a playing
// fader lane. Every part returns nothing (or null) while `host.schalter.mischer` is off, so STUDIO stays as it is. A track card and the master card get nothing here.
import { returnFaderZeigt } from '../production/lanes.js';
import { ausgangOptionen, ausgangWert, ausgangBefehl } from '../production/routing.js';
import { panText } from '../production/track_heads.js';
import { neuerDrehknopf } from './drehknopf.js';
import { mk, knopfEl } from './blocks.js';

const AUTO_TITEL = 'AUTO: the lane plays the level';
const istGruppe = (karte) => karte?.art === 'grp';
const istReturn = (karte) => karte?.art === 'ret';
const an = (host) => host?.schalter?.mischer === true;

/** The command of a mixer field of a group or return card. `feld`: mute | solo | pan; `wert`: the new value (boolean, or the pan in -1..1). Labels as in the old panels. */
export function mischerBefehl(karte, feld, wert) {
  const grp = istGruppe(karte), art = grp ? 'group' : 'return';
  const label = feld === 'pan' ? `Balance ${art} ${karte.name}`
    : feld === 'mute' ? `${wert ? 'Mute' : 'Unmute'} ${art} ${karte.name}` : `${wert ? 'Solo' : 'Unsolo'} ${art} ${karte.name}`;
  const kopf = grp ? { befehl: 'gruppenspur_aendern', gruppe_id: karte.id } : { befehl: 'return_aendern', return_id: karte.id };
  return { label, befehle: [{ ...kopf, [feld]: wert }] };
}

/** What LEVEL shows for a group or return: `returnFaderZeigt` plus `auto` (a fader lane exists, also while the transport stands). */
export function levelZustand(strang, kopfBeat) {
  const z = returnFaderZeigt(strang, kopfBeat);
  return { db: z.db, auto: z.lane !== null, treibt: z.treibt };
}

// the strip of a card in the current project (read at call time), or null
function strangVon(host, karte) {
  const p = host.projekt?.();
  if (istGruppe(karte)) return (p?.gruppen ?? []).find((x) => x.id === karte.id) ?? null;
  if (istReturn(karte)) return (p?.returns ?? []).find((x) => x.id === karte.id) ?? null;
  return null;
}

// the LEVEL knob of the card of a strip in the dock as it is now (cards are rebuilt on structure changes, so nothing here holds on to a card)
function levelKnopfVon(host, id) {
  const karteEl = [...(host.dockEl?.querySelectorAll?.('[data-strang]') ?? [])].find((e) => e.getAttribute('data-strang') === id);
  return karteEl?.querySelector('[data-w="karte-level"]') ?? null;
}
// class `auto`, the title and a fresh value of a LEVEL knob
function levelAbgleich(k, z, name) {
  if (!k) return;
  k.classList.toggle('auto', z.auto);
  if (z.auto) k.title = AUTO_TITEL; else if (k.title === AUTO_TITEL) k.title = `Level of ${name}`;
  k.frisch?.();
}
// ONE frame hook per host (`beimBild` has no way to unregister): it looks up the cards that exist at each call. A knob that followed the lane gets one more
// refresh after the lane stopped (the rest value comes back); that memory sits on the knob, so a rebuilt card forgets it with the old one.
const haken = new WeakSet(), folgenDe = new WeakSet();
function levelHaken(host) {
  if (haken.has(host)) return;
  haken.add(host);
  host.beimBild?.(() => {
    const p = host.projekt?.();
    for (const el of host.dockEl?.querySelectorAll?.('[data-strang]') ?? []) {
      const id = el.getAttribute('data-strang');
      const grp = (p?.gruppen ?? []).find((x) => x.id === id), ret = grp ? null : (p?.returns ?? []).find((x) => x.id === id);
      const strang = grp ?? ret; if (!strang) continue;
      const k = el.querySelector('[data-w="karte-level"]'); if (!k) continue;
      const z = levelZustand(strang, host.kopfBeat?.() ?? null);
      if (z.treibt || folgenDe.has(k)) { levelAbgleich(k, z, strang.name); if (z.treibt) folgenDe.add(k); else folgenDe.delete(k); }
    }
  });
}

/** M and S of a card head. A click reads the value from the project at that moment. */
export function mischerKopf(host, karte, frisch) {
  if (!an(host) || !(istGruppe(karte) || istReturn(karte))) return [];
  const knoepfe = [['mute', 'M', 'karte-mute', 'Mute'], ['solo', 'S', 'karte-solo', 'Solo']].map(([feld, text, w, titel]) => {
    const b = knopfEl('w-karte-knopf', w, text, titel);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', (ev) => {
      ev.stopPropagation?.();
      const x = strangVon(host, karte); if (!x) return;
      const c = mischerBefehl({ ...karte, name: x.name }, feld, !x[feld]);
      host.aendere(c.label, c.befehle);
    });
    frisch.push(() => { const an_ = strangVon(host, karte)?.[feld] === true; b.setAttribute('aria-pressed', String(an_)); b.classList.toggle('an', an_); });
    return b;
  });
  return knoepfe;
}

/** PAN left of LEVEL, and the frame hook that keeps LEVEL on the lane while it plays. */
export function mischerZeile(host, karte, frisch) {
  if (!an(host) || !(istGruppe(karte) || istReturn(karte))) return [];
  const pan = neuerDrehknopf({
    w: 'karte-pan', name: 'Pan', titel: `Pan of ${karte.name}`,
    lies: () => { const x = strangVon(host, karte); return x ? ((x.pan ?? 0) + 1) / 2 : null; },
    setze: (k) => {
      const x = strangVon(host, karte); if (!x) return;
      const c = mischerBefehl({ ...karte, name: x.name }, 'pan', Math.round((k * 2 - 1) * 100) / 100);
      host.aendere(c.label, c.befehle, `${karte.id}:pan`, { wiederhole: true });
    },
    text: (k) => panText(k * 2 - 1), vorgabe: 0.5,
  });
  frisch.push(pan.frisch);

  // LEVEL: class and title follow the lane (see `levelHaken`, ONE frame hook per dock); the refresh of the card sets them once.
  const finde = () => levelKnopfVon(host, karte.id);
  const abgleich = (z) => levelAbgleich(finde(), z, karte.name);
  frisch.push(() => abgleich(levelZustand(strangVon(host, karte), host.kopfBeat?.() ?? null)));
  levelHaken(host);
  return [pan];
}

/** The output select of a group card (the subtitle); null for any other card or while the mixer is off (the card then shows the text of the model). */
export function untertitelEl(host, karte) {
  if (!an(host) || !istGruppe(karte)) return null;
  const p = host.projekt?.(), g = strangVon(host, karte);
  if (!p || !g) return null;
  const sel = mk('select', 'w-karte-ausgang', 'karte-ausgang');
  sel.replaceChildren(...ausgangOptionen(p, karte.id).map((o) => { const e = document.createElement('option'); e.value = o.wert; e.textContent = o.text; return e; }));
  sel.value = ausgangWert(g); sel.setAttribute('aria-label', `Output of group ${g.name}`);
  sel.addEventListener('click', (ev) => ev.stopPropagation?.());
  sel.addEventListener('change', () => {
    const x = strangVon(host, karte); if (!x) return;
    host.aendere(`Output group ${x.name}`, [ausgangBefehl(karte.id, sel.value)]);
  });
  return sel;
}

/** What LEVEL shows: the lane value at the playhead while it plays (`auto`: a fader lane exists), else the stored `fader_db` of the card. */
export function levelStand(host, karte) {
  const x = an(host) ? strangVon(host, karte) : null;
  if (!x) return { db: karte?.fader_db, auto: false };
  const z = levelZustand(x, host.kopfBeat?.() ?? null);
  return { db: z.db, auto: z.auto };
}
