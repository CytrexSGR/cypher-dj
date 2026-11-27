// The tile text of an insert stage and the stage lists of a rack strip and the master strip (pure).

const KACHEL_TEXT = { komp: 'COMPRESSOR', eq: 'EQ', saett: 'SATURATION', lim: 'LIMITER', utility: 'UTILITY', gate: 'GATE', mb: 'MULTIBAND' };
/** The tile of one insert stage: { titel: 'EFFECT', text, an }. */
export function effektKachel(insert) {
  const text = insert.art === 'bk' ? String(insert.graph ?? 'EFFECT') : insert.art === 'host' ? String(insert.plugin?.name ?? 'PLUGIN') : KACHEL_TEXT[insert.art] ?? String(insert.art).toUpperCase();
  return { titel: 'EFFECT', text, an: insert.an !== false };
}

/** The stages of a rack strip in chain order: the Hall first (shown while it is on, or while the return has no other stage), then the inserts.
 *  [{teil: 'hall' | <insert id>, text, an, art}] */
export function rackTeile(ret) {
  const inserts = ret?.inserts ?? [];
  const teile = [];
  if (ret?.hall?.an !== false || inserts.length === 0) teile.push({ teil: 'hall', text: 'HALL', an: ret?.hall?.an !== false, art: 'hall' });
  for (const i of inserts) { const k = effektKachel(i); teile.push({ teil: i.id, text: k.text, an: k.an, art: i.art }); }
  return teile;
}

/** The stages of the master strip: its inserts. [{teil: <insert id>, text, an, art}] */
export function masterTeile(p) {
  return (p?.master?.inserts ?? []).map((i) => { const k = effektKachel(i); return { teil: i.id, text: k.text, an: k.an, art: i.art }; });
}
