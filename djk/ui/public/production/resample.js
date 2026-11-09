// 1.10 slice 7 (T7, spec 5.7): Resample on the page. Pure parts; the run itself goes through the frame of freeze_export.js (ctx.resample), the entry
// sits in the shared head menu (context_menu.js KOPF_MENUE), the matrix column in matrix.js.
// The strip ids are the project's own: track s<n>, group g<n>, return r<n>, the master the literal `master` (plan D6).

/** The body of POST /proj/resample for a strip ({id, name?}); the point is `post` (what the strip sends on). Without a range the server takes the
 *  loop bracket when it is on, else the whole song. null: no strip. */
export function resampleBefehl(strang, bereich) {
  if (typeof strang?.id !== 'string' || strang.id === '') return null;
  return { strang_id: strang.id, punkt: 'post', ...(bereich ?? {}) };
}

/** The name of a strip id for the busy text (a run learned from ausgabe_lauf only carries the id). */
export function strangName(projekt, id) {
  if (id === 'master') return 'Master';
  const alle = [...(projekt?.spuren ?? []), ...(projekt?.gruppen ?? []), ...(projekt?.returns ?? [])];
  return alle.find((x) => x.id === id)?.name ?? id;
}
