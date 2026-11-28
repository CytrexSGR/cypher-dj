// Strand 6 slice 1 task 1.6: the modulator row in the lane head of a track or return. "+ Mod" makes a modulator on the target the lane row shows;
// when that target has one, the row shows its controls. Pure helpers first (tested without a DOM), the DOM part below.
export const MAX_MODULATOREN = 16;   // = model.ts MAX_MODULATOREN = ARR_MODS in arr_playback.h
export const MOD_TIEFE = { fader: [-24, 24], pan: [-1, 1], geraet: [-1, 1], send: [-24, 24], insert: [-1, 1], rack: [-1, 1], plugin: [-1, 1] };   // = model.ts MOD_TIEFE
export const MOD_FORMEN = [['sinus', 'Sine'], ['dreieck', 'Triangle'], ['saege', 'Saw'], ['rechteck', 'Square'], ['zufall', 'Random']];   // = model.ts MOD_FORMEN
export const MOD_TEXT = {
  neu: '+ Mod', neu_titel: 'Modulate this target with an LFO', voll: `${MAX_MODULATOREN} modulators per project`,
  neu_label: 'Add modulator', aendern_label: 'Change modulator', weg_label: 'Delete modulator',
  art: 'Kind', lfo: 'LFO', folger: 'Follower', quelle: 'Source track', quelle_weg: '(track gone)', keine_quelle: 'No other track to follow',
  angriff: 'Attack', abfall: 'Release', empfindlich: 'Sensitivity',
  form: 'Shape', rate: 'Rate', tiefe: 'Depth', uni: 'Unipolar', bi: 'Bipolar', an: 'On', aus: 'Off', weg: 'Delete modulator', hz: 'Hz',
};

// the target forms (= lanes.js SEND_ZIEL, KETTEN_ZIEL, PLUGIN_ZIEL; model.ts decides what a strip really takes)
const SEND_Z = /^send\.[A-Za-z][A-Za-z0-9_-]{0,31}$/, INSERT_Z = /^insert\.[A-Za-z][A-Za-z0-9_-]{0,31}\.[a-z0-9_]{1,16}(?:\/[a-z0-9_]{1,16})?$/;
const RACK_Z = /^rack\.m[1-4]$/, PLUGIN_Z = /^plugin\.[A-Za-z][A-Za-z0-9_-]{0,31}\.(?:0|[1-9][0-9]{0,4})$/;
const art = (ziel) => (ziel === 'fader' || ziel === 'pan' ? ziel : /^geraet\./.test(ziel) ? 'geraet' : SEND_Z.test(ziel) ? 'send' : INSERT_Z.test(ziel) ? 'insert'
  : RACK_Z.test(ziel) ? 'rack' : PLUGIN_Z.test(ziel) ? 'plugin' : null);
/** true when the page offers "+ Mod" on the shown target: fader, pan and device knobs of a track, the fader of a return; send.* on a track; insert.*, rack.* and plugin.* on any strip
 *  (the server refuses what the strip does not carry: a host stage has no insert.* target, a mapped parameter is param_gemappt) */
export const modZielOk = (strangArt, ziel) => {
  const a = art(ziel);
  if (a === 'insert' || a === 'rack' || a === 'plugin') return true;
  if (a === 'send') return strangArt === 'spur';
  return strangArt === 'return' ? ziel === 'fader' : strangArt === 'spur' && a !== null;
};
/** the depth range of a target (= MOD_TIEFE of model.ts) or null */
export const tiefeBereich = (ziel) => { const a = art(ziel); return a ? MOD_TIEFE[a] : null; };
/** the depth a new modulator starts with: fader and send -6 dB, pan 0.5, every other kind 0.25 (a quarter of the range) */
export const vorgabeTiefe = (ziel) => (ziel === 'fader' || art(ziel) === 'send' ? -6 : ziel === 'pan' ? 0.5 : 0.25);
/** the unit shown behind the depth field */
export const tiefeEinheit = (ziel) => (ziel === 'fader' || art(ziel) === 'send' ? 'dB' : '');
export const klemmeTiefe = (ziel, v) => { const b = tiefeBereich(ziel); return b ? Math.min(b[1], Math.max(b[0], v)) : v; };

/** the rate steps [label, beats] for a time signature [numerator, denominator]: 4 beats per bar in 4/4, `numerator` beats per bar otherwise */
export function taktStufen(taktart) {
  const zaehler = Array.isArray(taktart) && Number.isInteger(taktart[0]) && taktart[0] > 0 ? taktart[0] : 4;
  const t = 2 / 3;
  const stufen = [['1/32', 0.125], ['1/16T', 0.25 * t], ['1/16', 0.25], ['1/8T', 0.5 * t], ['1/8', 0.5], ['1/8.', 0.75], ['1/4T', t], ['1/4', 1], ['1/4.', 1.5], ['1/2', 2],
    ['1 bar', zaehler], ...[2, 4, 8, 16].map((n) => [`${n} bars`, n * zaehler])];
  return stufen.filter(([, b]) => b <= 256);
}
/** the index of the step whose beats equal `takt`, or -1 (a free value) */
export const stufeVon = (stufen, takt) => stufen.findIndex(([, b]) => Math.abs(b - takt) < 1e-9);

/** the modulator that has the target (strang_id, ziel), or undefined */
export const modFuer = (projekt, strangId, ziel) => (projekt?.modulatoren ?? []).find((m) => m.ziele.some((z) => z.strang_id === strangId && z.ziel === ziel));
export const modZiel = (m, strangId, ziel) => m.ziele.find((z) => z.strang_id === strangId && z.ziel === ziel);
export const modVoll = (projekt) => (projekt?.modulatoren ?? []).length >= MAX_MODULATOREN;

/** "+ Mod": one mod_neu on the shown target with its default depth */
export const befehlNeu = (strangId, ziel) => ({ befehl: 'mod_neu', ziele: [{ strang_id: strangId, ziel, tiefe: vorgabeTiefe(ziel) }] });
/** one mod_aendern: `felder` are the fields of the command (form, takt, hz, phase, glatt_ms, an, ziele) */
export const befehlAendern = (mod, felder) => ({ befehl: 'mod_aendern', mod_id: mod.id, ...felder });
export const befehlLoeschen = (mod) => ({ befehl: 'mod_loeschen', mod_id: mod.id });
/** the `ziele` list with the depth and/or polarity of one target changed (the command replaces the whole list) */
export function ziele(mod, strangId, ziel, { tiefe, uni } = {}) {
  return mod.ziele.map((z) => {
    if (z.strang_id !== strangId || z.ziel !== ziel) return { ...z };
    const n = { ...z };
    if (tiefe !== undefined) n.tiefe = klemmeTiefe(ziel, tiefe);
    if (uni === true) n.polaritaet = 'uni'; else if (uni === false) delete n.polaritaet;
    return n;
  });
}
export const befehlTiefe = (mod, strangId, ziel, tiefe) => befehlAendern(mod, { ziele: ziele(mod, strangId, ziel, { tiefe }) });
export const befehlPolaritaet = (mod, strangId, ziel, uni) => befehlAendern(mod, { ziele: ziele(mod, strangId, ziel, { uni }) });
export const befehlAn = (mod, an) => befehlAendern(mod, { an });   // an: true removes the key, false switches the modulator off
// ---- envelope follower (task 3.3; model: model.ts MOD_ANGRIFF_*, MOD_ABFALL_*, MOD_EMPFINDLICH_MAX) ----
export const FOLGER_BEREICH = { angriff_ms: [0.1, 500], abfall_ms: [1, 5000], empfindlich_db: [-24, 24] };   // = model.ts
export const FOLGER_VORGABE = { angriff_ms: 5, abfall_ms: 150, empfindlich_db: 0 };                          // = model.ts (absent = default)
export const klemmeFolger = (feld, v) => { const [a, b] = FOLGER_BEREICH[feld]; return Math.min(b, Math.max(a, v)); };
/** the tracks a follower may take as its source: every track that is no target of this modulator (a follower never moves its own source), [[id, label]] */
export function quellenWahl(projekt, mod) {
  const eigene = new Set((mod?.ziele ?? []).map((z) => z.strang_id));
  return (projekt?.spuren ?? []).filter((t) => !eigene.has(t.id)).map((t) => [t.id, `${t.nr ?? ''} ${t.name ?? t.id}`.trim()]);
}
/** the kind switch: LFO -> Follower needs a source (the first allowed track; null when there is none), Follower -> LFO drops the follower fields on the server */
export function befehlArt(projekt, mod, art) {
  if (art === mod.art) return null;
  if (art === 'lfo') return befehlAendern(mod, { art: 'lfo' });
  const q = quellenWahl(projekt, mod)[0];
  return q ? befehlAendern(mod, { art: 'folger', quelle: q[0] }) : null;
}
export const befehlQuelle = (mod, id) => befehlAendern(mod, { quelle: id });
/** one follower field (angriff_ms, abfall_ms, empfindlich_db), clamped to its range */
export const befehlFolger = (mod, feld, wert) => befehlAendern(mod, { [feld]: klemmeFolger(feld, wert) });
export const befehlRate = (mod, wert) => (wert.hz !== undefined ? befehlAendern(mod, { hz: wert.hz }) : befehlAendern(mod, { takt: wert.takt }));

// ---- task 4.4: "Mod" buttons of the insert popover, the plugin rows and the ring on insert faces ----
const STETIG_NICHT = new Set(['an', 'sc']);   // the on switch and the key of a stage are no continuous parameter
/** the modulation target of a row of a built-in stage: `insert.<stage id>.<param>`, or null for a host stage (it has plugin.*), a switch, a choice or the key.
 *  `q` = the parameter entry of inserts.js (typ 'schalter' | 'wahl' | continuous without typ) */
export function insertModZiel(insert, param, q) {
  if (!insert || insert.art === 'host' || !q || q.typ === 'schalter' || q.typ === 'wahl' || STETIG_NICHT.has(param)) return null;
  return `insert.${insert.id}.${param}`;
}
/** `rack.m<nr>` (INTERFACES 20.37): the modulation target of rack macro nr (1 to 4, as the rack panel numbers them), or null outside 1 to 4 */
export const rackModZiel = (nr) => (Number.isInteger(nr) && nr >= 1 && nr <= 4 ? `rack.m${nr}` : null);
/** `plugin.<host stage id>.<index>` */
export const pluginModZiel = (insertId, index) => `plugin.${insertId}.${index}`;
/** the Mod button of one row: what a click does. 'neu' (with the command), 'zeige' (the target has a modulator: show its controls), 'voll' (16 modulators), or null (no target) */
export function modKnopfAktion(projekt, strangId, ziel, strangArt = 'spur') {
  if (!ziel || !modZielOk(strangArt, ziel)) return null;
  if (modFuer(projekt, strangId, ziel)) return { art: 'zeige' };
  if (modVoll(projekt)) return { art: 'voll', titel: MOD_TEXT.voll };
  return { art: 'neu', befehl: befehlNeu(strangId, ziel) };
}
/** the state of a Mod button: active when the target has a modulator, disabled (title) when it has none and the project holds 16 */
export function modKnopfZustand(projekt, strangId, ziel) {
  const hat = !!modFuer(projekt, strangId, ziel);
  const voll = !hat && modVoll(projekt);
  return { aktiv: hat, gesperrt: voll, titel: hat ? 'This parameter is modulated: show the modulator' : voll ? MOD_TEXT.voll : 'Modulate this parameter with an LFO' };
}
/** the indices of the plugin parameters of a host stage that have a modulator (for the row buttons) */
export function pluginModIndizes(projekt, strangId, insertId) {
  const pre = `plugin.${insertId}.`, r = [];
  for (const m of projekt?.modulatoren ?? []) for (const z of m.ziele) if (z.strang_id === strangId && z.ziel.startsWith(pre)) r.push(Number(z.ziel.slice(pre.length)));
  return r;
}
/** the position of the modulated value of a stage parameter on a face knob, as the value (real unit) the face converts to its knob angle: base + the summed offset, the offset being a
 *  fraction of the parameter's row range (D6), clamped to the row. undefined: no modulator targets it; null: targeted but no fresh output. `live` = mod_display.js summeVersatz. */
export function insertModWert(summe, basis, q) {
  if (summe === undefined) return undefined;
  if (summe === null || !Number.isFinite(basis)) return null;
  const spanne = q.max - q.min;
  return Math.min(q.max, Math.max(q.min, basis + summe * spanne));
}

// ---- DOM part ----
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const optionen = (sel, liste) => sel.replaceChildren(...liste.map(([w, t]) => { const o = document.createElement('option'); o.value = String(w); o.textContent = t; return o; }));

/**
 * The "+ Mod" button and the controls of a lane head. ctx: { aendere(label, befehle) → Promise<boolean>, stand() → {projekt, strangId, ziel, art} | null }.
 * Returns { el, zeige }: append `el` to the lane head; call `zeige()` whenever the head is drawn (it reads the current state through ctx.stand).
 */
export function baueModZeile(ctx) {
  const el = mk('span', 'p-modzeile');
  const neu = mk('button', 'p-mod-neu', MOD_TEXT.neu); neu.title = MOD_TEXT.neu_titel;
  const box = mk('span', 'p-modsteuer'); box.hidden = true;
  const artWahl = mk('select', 'p-mod-art'); artWahl.title = MOD_TEXT.art; artWahl.setAttribute('aria-label', MOD_TEXT.art); optionen(artWahl, [['lfo', MOD_TEXT.lfo], ['folger', MOD_TEXT.folger]]);
  const quelle = mk('select', 'p-mod-quelle'); quelle.title = MOD_TEXT.quelle; quelle.setAttribute('aria-label', MOD_TEXT.quelle);
  const folgerFeld = (feld, titel) => { const i = mk('input', `p-mod-${feld.replace('_', '-')}`); i.type = 'number'; i.title = titel; i.setAttribute('aria-label', titel);
    i.min = String(FOLGER_BEREICH[feld][0]); i.max = String(FOLGER_BEREICH[feld][1]); i.step = feld === 'empfindlich_db' ? '1' : '0.1'; i.dataset.feld = feld; return i; };
  const fAngriff = folgerFeld('angriff_ms', `${MOD_TEXT.angriff} ms`), fAbfall = folgerFeld('abfall_ms', `${MOD_TEXT.abfall} ms`), fEmpf = folgerFeld('empfindlich_db', `${MOD_TEXT.empfindlich} dB`);
  const folgerBox = [quelle, fAngriff, fAbfall, fEmpf];
  const form = mk('select', 'p-mod-form'); form.title = MOD_TEXT.form; form.setAttribute('aria-label', MOD_TEXT.form); optionen(form, MOD_FORMEN);
  const rate = mk('select', 'p-mod-rate'); rate.title = MOD_TEXT.rate; rate.setAttribute('aria-label', MOD_TEXT.rate);
  const hz = mk('input', 'p-mod-hz'); hz.type = 'number'; hz.min = '0.01'; hz.max = '40'; hz.step = '0.01'; hz.title = MOD_TEXT.hz; hz.setAttribute('aria-label', MOD_TEXT.hz);
  const tiefe = mk('input', 'p-mod-tiefe'); tiefe.type = 'number'; tiefe.title = MOD_TEXT.tiefe; tiefe.setAttribute('aria-label', MOD_TEXT.tiefe);
  const einheit = mk('span', 'p-mod-einheit');
  const live = mk('output', 'p-mod-live'); live.setAttribute('aria-live', 'off');   // task 2.2: "base → value", drawn by the frame loop of track_heads.js
  const pol = mk('button', 'p-mod-pol'); pol.setAttribute('aria-pressed', 'false');
  const an = mk('button', 'p-mod-an'); an.setAttribute('aria-pressed', 'true');
  const weg = mk('button', 'p-mod-weg', '✕'); weg.title = MOD_TEXT.weg; weg.setAttribute('aria-label', MOD_TEXT.weg);
  box.append(artWahl, ...folgerBox, form, rate, hz, tiefe, einheit, live, pol, an, weg);
  el.append(neu, box);
  let gestalt = null;   // the target and modulator the row shows right now
  const aktuell = () => { const s = ctx.stand(); const m = s ? modFuer(s.projekt, s.strangId, s.ziel) : undefined; return { s, m }; };
  const sende = async (label, befehl) => { const ok = await ctx.aendere(label, [befehl]); if (!ok) zeige(); return ok; };   // a refusal: draw the row from the project again
  function zeige() {
    const { s, m } = aktuell();
    const geht = !!s && modZielOk(s.art, s.ziel);
    el.hidden = !geht;
    if (!geht) { gestalt = null; return; }
    neu.hidden = !!m;
    const voll = modVoll(s.projekt);
    neu.disabled = voll; neu.title = voll ? MOD_TEXT.voll : MOD_TEXT.neu_titel;
    box.hidden = !m;
    if (!m) { gestalt = null; return; }
    const z = modZiel(m, s.strangId, s.ziel), stufen = taktStufen(s.projekt.taktart);
    gestalt = { id: m.id, strangId: s.strangId, ziel: s.ziel };
    const fo = m.art === 'folger';
    artWahl.value = fo ? 'folger' : 'lfo';
    const keine = fo ? false : quellenWahl(s.projekt, m).length === 0;
    artWahl.querySelector('option[value="folger"]').disabled = keine; artWahl.title = keine ? MOD_TEXT.keine_quelle : MOD_TEXT.art;
    for (const e of folgerBox) e.hidden = !fo;
    for (const e of [form, rate]) e.hidden = fo;
    pol.hidden = fo;   // the follower's output is unipolar (D6)
    if (fo) {
      const liste = quellenWahl(s.projekt, m);
      if (!liste.some(([id]) => id === m.quelle)) liste.unshift([m.quelle ?? '', MOD_TEXT.quelle_weg]);   // the source track went: the follower is off, the id stays
      optionen(quelle, liste); quelle.value = m.quelle ?? '';
      for (const [e, k] of [[fAngriff, 'angriff_ms'], [fAbfall, 'abfall_ms'], [fEmpf, 'empfindlich_db']]) if (document.activeElement !== e) e.value = String(m[k] ?? FOLGER_VORGABE[k]);
    }
    form.value = m.form ?? 'sinus';
    const frei = m.hz !== undefined;
    optionen(rate, [...stufen.map(([t], i) => [i, t]), ['hz', MOD_TEXT.hz]]);
    rate.value = frei ? 'hz' : String(Math.max(0, stufeVon(stufen, m.takt ?? 4)));
    hz.hidden = fo || !frei; if (frei && document.activeElement !== hz) hz.value = String(m.hz);
    const b = tiefeBereich(s.ziel);
    tiefe.min = String(b[0]); tiefe.max = String(b[1]); tiefe.step = tiefeEinheit(s.ziel) === 'dB' ? '0.5' : '0.05';
    if (document.activeElement !== tiefe) tiefe.value = String(z.tiefe);
    einheit.textContent = tiefeEinheit(s.ziel);
    const uni = z.polaritaet === 'uni';
    pol.textContent = uni ? MOD_TEXT.uni : MOD_TEXT.bi; pol.setAttribute('aria-pressed', String(uni)); pol.classList.toggle('an', uni);
    const ein = m.an !== false;
    an.textContent = ein ? MOD_TEXT.an : MOD_TEXT.aus; an.setAttribute('aria-pressed', String(ein)); an.classList.toggle('an', ein);
  }
  neu.addEventListener('click', () => {
    const { s, m } = aktuell();
    if (!s || m || modVoll(s.projekt) || !modZielOk(s.art, s.ziel)) return;   // a target with a modulator never gets a second one
    sende(MOD_TEXT.neu_label, befehlNeu(s.strangId, s.ziel));
  });
  const aendern = (rechne) => { const { s, m } = aktuell(); if (s && m) sende(MOD_TEXT.aendern_label, rechne(m, s)); };
  artWahl.addEventListener('change', () => { const { s, m } = aktuell(); const b = s && m ? befehlArt(s.projekt, m, artWahl.value) : null; if (b) sende(MOD_TEXT.aendern_label, b); else zeige(); });
  quelle.addEventListener('change', () => aendern((m) => befehlQuelle(m, quelle.value)));
  for (const e of [fAngriff, fAbfall, fEmpf]) {   // "change": the end of the gesture, one undo step
    e.addEventListener('change', () => { const v = Number(e.value); if (Number.isFinite(v) && e.value !== '') aendern((m) => befehlFolger(m, e.dataset.feld, v)); else zeige(); });
  }
  form.addEventListener('change', () => aendern((m) => befehlAendern(m, { form: form.value })));
  rate.addEventListener('change', () => aendern((m, s) => {
    if (rate.value === 'hz') return befehlRate(m, { hz: m.hz ?? 1 });
    return befehlRate(m, { takt: taktStufen(s.projekt.taktart)[Number(rate.value)][1] });
  }));
  hz.addEventListener('change', () => aendern((m) => befehlRate(m, { hz: Math.min(40, Math.max(0.01, Number(hz.value) || 1)) })));
  // the depth is sent at the end of the gesture only ("change" fires on release of a drag and on Enter), so one gesture is one undo step
  tiefe.addEventListener('change', () => aendern((m, s) => befehlTiefe(m, s.strangId, s.ziel, Number(tiefe.value) || 0)));
  pol.addEventListener('click', () => aendern((m, s) => befehlPolaritaet(m, s.strangId, s.ziel, modZiel(m, s.strangId, s.ziel).polaritaet !== 'uni')));
  an.addEventListener('click', () => aendern((m) => befehlAn(m, m.an === false)));
  weg.addEventListener('click', () => { const { m } = aktuell(); if (m) sende(MOD_TEXT.weg_label, befehlLoeschen(m)); });
  return { el, zeige, gestalt: () => gestalt, live: (text) => { if (live.textContent !== text) live.textContent = text; } };
}

/**
 * The modulator controls for a popover with many rows (task 4.4): one row of controls that shows the modulator of the target the last "Mod" button chose.
 * ctx: { aendere, projekt() -> project, strangId, art }. Returns { el, waehle(ziel), knopf(ziel) -> Promise, zeige(), ziel() }:
 * knopf(ziel) is what a row's Mod button calls: it creates the modulator when the target has none (one mod_neu), then shows it.
 */
export function baueModFeld(ctx) {
  let ziel = null;
  const mz = baueModZeile({ aendere: ctx.aendere, stand: () => (ziel ? { projekt: ctx.projekt(), strangId: ctx.strangId, ziel, art: ctx.art } : null) });
  mz.el.classList.add('p-modfeld');
  mz.el.querySelector('.p-mod-neu')?.remove();   // the row buttons create; the field only edits
  const waehle = (z) => { ziel = z; mz.zeige(); };
  return {
    el: mz.el, waehle, zeige: () => mz.zeige(), ziel: () => ziel,
    async knopf(z) {
      const a = modKnopfAktion(ctx.projekt(), ctx.strangId, z, ctx.art);
      if (!a || a.art === 'voll') return false;
      if (a.art === 'zeige') { if (ziel === z) waehle(null); else waehle(z); return true; }
      const ok = await ctx.aendere(MOD_TEXT.neu_label, [a.befehl]);
      if (ok !== false) waehle(z);
      return ok !== false;
    },
  };
}
