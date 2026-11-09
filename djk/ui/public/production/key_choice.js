// 1.10 slice 6 T2: the key choice of a compressor stage and Duck by Kick (pure: option list, grouping, request builders).
// A choice is a string: `own`, `spur:<nr>:pre|post`, `grp:<nr>:pre|post`, `ret:<nr>:pre|post`, `deck:<nr>`, `erz:<nr>` (DJ inputs have one point, `post`).
// The options come from the server (GET /proj/routing?optionen=<insert_id>): it answers every cell, the page copies no rule.
export const SC_EIGEN = 'Own signal';
const TITEL = { spur: 'Tracks', grp: 'Groups', ret: 'Returns', deck: 'DJ', erz: 'DJ' };

// the choice string of a source
export const wertVon = (quelle, nr, punkt) => (quelle === 'deck' || quelle === 'erz' ? `${quelle}:${nr}` : `${quelle}:${nr}:${punkt}`);

// what a stage holds now: the structural key wins over the row key `sc` (the server keeps at most one of them)
export function schluesselWert(insert) {
  if (insert?.key) return wertVon(insert.key.quelle, insert.key.nr, insert.key.punkt);
  return insert?.sc > 0 ? `spur:${insert.sc}:pre` : 'own';
}

function label(quelle, nr, punkt, projekt) {
  const name = (l) => (l ?? []).find((x) => x.nr === nr)?.name;
  const pkt = punkt === 'pre' ? 'pre' : 'post';
  if (quelle === 'spur') return `Track ${nr} ${name(projekt?.spuren) ?? ''} (${pkt})`.replace('  ', ' ');
  if (quelle === 'grp') return `Group ${name(projekt?.gruppen) ?? nr} (${pkt})`;
  if (quelle === 'ret') return `Return ${name(projekt?.returns) ?? nr} (${pkt})`;
  return quelle === 'deck' ? `Deck ${nr}` : `Arrangement group ${nr}`;
}

/** The server's options grouped for the select: [{titel, eintraege: [{label, wert, gesperrt, text?}]}]; a refused option is `gesperrt` and `text` is the
 *  server's reason. "Own signal" heads the tracks. */
export function schluesselGruppen(optionen, projekt) {
  const gruppen = ['Tracks', 'Groups', 'Returns', 'DJ'].map((titel) => ({ titel, eintraege: [] }));
  gruppen[0].eintraege.push({ label: SC_EIGEN, wert: 'own', gesperrt: false });
  for (const o of optionen ?? []) {
    const g = gruppen.find((x) => x.titel === TITEL[o.quelle]);
    if (!g) continue;
    g.eintraege.push({ label: label(o.quelle, o.nr, o.punkt, projekt), wert: wertVon(o.quelle, o.nr, o.punkt), gesperrt: !o.erlaubt, ...(o.erlaubt ? {} : { text: o.text ?? o.grund ?? 'Not available' }) });
  }
  return gruppen;
}

// the command for a choice: a track `pre` key is the row key `sc`, every other source the structural key, `own` is sc 0 (which also removes a key)
export function schluesselBefehl(insertId, wert) {
  const befehl = (param, w) => ({ befehl: 'insert_param_setzen', insert_id: insertId, param, wert: w });
  if (wert === 'own') return befehl('sc', 0);
  const m = /^(spur|grp|ret):([1-9]\d*):(pre|post)$/.exec(wert) ?? /^(deck|erz):([1-9]\d*)$/.exec(wert);
  if (!m) throw new Error(`key: unknown choice ${wert}`);
  const nr = Number(m[2]);
  if (m[1] === 'spur' && m[3] === 'pre') return befehl('sc', nr);
  return befehl('key', { quelle: m[1], nr, punkt: m[3] ?? 'post' });
}

// Duck by Kick: the tracks a strip can be keyed by (every track but itself), and the one command
export const duckKicks = (projekt, spurId) => (projekt?.spuren ?? []).filter((s) => s.id !== spurId).map((s) => ({ id: s.id, nr: s.nr, name: s.name }));
export function duckBefehl(spurId, kickId) {
  if (spurId === kickId) throw new Error('kick: a track cannot duck by itself');
  return { befehl: 'duck_durch_kick', spur_id: spurId, kick_id: kickId };
}

// the label of a choice from its string (a stage whose key is not in the server's list still shows what it holds)
export function schluesselLabel(wert, projekt) {
  if (wert === 'own') return SC_EIGEN;
  const [quelle, nr, punkt] = wert.split(':');
  return label(quelle, Number(nr), punkt, projekt);
}
