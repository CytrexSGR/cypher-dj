// PRODUCTION: select a clip from outside (the jump of the SEQ place, plan 2026-11-14-seq-deck-v2-s1 task 5). The clip of a pattern sits in a track of a
// deck group, and the group may be folded in the arrangement: unfolding is a project write (gruppenspur_aendern, Gruppe.gefaltet), and the selection is set only
// after that write has landed, because a selection of a clip the shown project does not hold is dropped (clip_operation.js, beimProjekt). The selection
// opens the clip in the detail area (piano roll) by itself (detail.js beimAuswahl).
//
// Pure of DOM. `h` holds the hooks of bindeProduktion:
//   st                the page state (st.projekt is the project shown)
//   geladen()         resolves when the newest load of the project has been applied (nachlader.fertig); the view switch has started one
//   aendere(label, befehle)   the write path of the page, resolves true when the write was accepted
//   setzeAuswahl(ids) ctx.setzeAuswahl
//   melde(text, fehler)
// Result of waehleClip: true when the clip is selected.
import { foldLabel } from './groups_kopf.js';

// The folded groups on the way from a track up to the top: the track's output group, then the group that one outputs into, and so on.
export function gefalteteGruppen(projekt, spur) {
  const gruppen = projekt?.gruppen ?? [];
  const aus = [];
  let id = spur?.ausgang?.id;
  for (let n = 0; id && n < gruppen.length; n++) {   // the bound ends a cycle in a broken project
    const g = gruppen.find((x) => x.id === id);
    if (!g) break;
    if (g.gefaltet) aus.push(g);
    id = g.ausgang?.id;
  }
  return aus;
}

export function neuerClipWaehler(h) {
  return async function waehleClip(clipId) {
    await h.geladen();
    const spur = h.st.projekt?.spuren?.find((s) => (s.clips ?? []).some((c) => c.id === clipId));
    if (!spur) { h.melde('The pattern is not in the project shown here', true); return false; }
    const falten = gefalteteGruppen(h.st.projekt, spur);
    if (falten.length) {
      const ok = await h.aendere(foldLabel(falten[0].name, true), falten.map((g) => ({ befehl: 'gruppenspur_aendern', gruppe_id: g.id, gefaltet: false })));
      if (!ok) return false;   // the write path has said why
    }
    h.setzeAuswahl([clipId]);
    return true;
  };
}
