// strudel-clip: the PATTERN field of a MIDI clip in the detail area. A text field with the Strudel code, a BARS field and GENERATE: one clip_aus_muster
// command (the same one the hand sends), in place on the selected clip (notes and envelopes replaced; id, place and length kept unless BARS says otherwise).
// The pure part (musterBefehl, musterInfo) is tested without a DOM (tests/production_pattern_field.test.mjs).
export const MUSTER_TEXT = {
  titel: 'PATTERN',
  erzeugen: 'GENERATE',
  erzeugen_titel: 'Generate the notes of this clip from the Strudel pattern (Ctrl+Enter). Replaces the notes and the envelopes of this clip; one undo step',
  takte: 'BARS',
  takte_titel: 'Clip length in bars; empty keeps the clip length. A pattern that repeats sooner than the clip sets the clip loop',
  platzhalter: 's("bd*4, ~ hh ~ hh")  or  note("gs1 ~ gs1 b1").velocity("<0.8 1>")',
  leer: 'Write a Strudel pattern first',
  takte_ungueltig: 'BARS: a number above 0, for example 4 or 0.5, or empty',
  label: 'Generate pattern',
  ueberschreiben: 'OVERWRITE',
  ueberschreiben_titel: 'Replace notes and envelopes that were changed by hand since the pattern made them (otherwise GENERATE refuses)',
  hilfe: '1 cycle = 1 bar. Kit track: s("bd hh"); instrument track: note("c2 e2") or n("0 2").scale("C:minor"). Fields without a target (room, delay ...) are reported, not applied',
};

// text inside an HTML attribute: the pattern hints contain double quotes
export const attr = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The command for GENERATE, or {fehler}. codeText: the field; takteText: the BARS field (empty = keep the length); ueberschreiben: the OVERWRITE box. */
export function musterBefehl(clip, codeText, takteText, ueberschreiben = false) {
  if (clip?.art !== 'midi') return { fehler: MUSTER_TEXT.leer };
  const code = String(codeText ?? '').trim();
  if (!code) return { fehler: MUSTER_TEXT.leer };
  const t = String(takteText ?? '').trim();
  const befehl = { befehl: 'clip_aus_muster', clip_id: clip.id, code };
  if (t !== '') {
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > 1024) return { fehler: MUSTER_TEXT.takte_ungueltig };
    befehl.takte = n;
  }
  if (ueberschreiben === true) befehl.ueberschreiben = true;
  return { befehl, label: MUSTER_TEXT.label };
}

/** The line under the field: what the clip remembers, and what was not applied. */
export function musterInfo(clip) {
  if (!clip?.muster) return '';
  const ohne = clip.muster.ohne_ziel;
  return ohne?.length ? `Not applied (no target here): ${ohne.join(', ')}` : 'All fields of this pattern were applied';
}

export function bindeMusterFeld(ctx, wurzel) {
  wurzel.innerHTML = `<label class="p-muster-code">${MUSTER_TEXT.titel} <textarea data-m="code" rows="2" spellcheck="false" autocomplete="off" placeholder="${attr(MUSTER_TEXT.platzhalter)}" title="${attr(MUSTER_TEXT.hilfe)}"></textarea></label>
<span class="p-muster-rechts"><label title="${attr(MUSTER_TEXT.takte_titel)}">${MUSTER_TEXT.takte} <input data-m="takte" inputmode="decimal" autocomplete="off" placeholder="keep"></label>
<label title="${attr(MUSTER_TEXT.ueberschreiben_titel)}"><input type="checkbox" data-m="ueberschreiben"> ${MUSTER_TEXT.ueberschreiben}</label>
<button data-m="erzeugen" title="${attr(MUSTER_TEXT.erzeugen_titel)}">${MUSTER_TEXT.erzeugen}</button></span>
<span class="p-muster-info" data-m="info"></span>`;
  const m = (n) => wurzel.querySelector(`[data-m="${n}"]`);
  let zeigt = null;
  const erzeugen = () => {
    if (!zeigt) return;
    const r = musterBefehl(zeigt, m('code').value, m('takte').value, m('ueberschreiben').checked);
    if (r.fehler) { ctx.melde(r.fehler, true); return; }
    ctx.aendere(r.label, [r.befehl]);
  };
  m('erzeugen').addEventListener('click', erzeugen);
  for (const f of [m('code'), m('takte')]) {
    f.addEventListener('keydown', (e) => {
      e.stopPropagation();   // typing a pattern must not trigger the arrangement keys (Delete, Ctrl+D ...)
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || f === m('takte'))) { e.preventDefault(); erzeugen(); }
    });
  }
  return {
    // erzwungen: also a field with focus is overwritten
    zeige(t, erzwungen = false) {
      const c = t?.clip?.art === 'midi' ? t.clip : null;
      wurzel.hidden = !c;
      if (!c) { zeigt = null; return; }
      const wechsel = zeigt?.id !== c.id;
      zeigt = c;
      if (erzwungen || wechsel || document.activeElement !== m('code')) m('code').value = c.muster?.code ?? (wechsel || erzwungen ? '' : m('code').value);
      m('info').textContent = musterInfo(c);
    },
  };
}
