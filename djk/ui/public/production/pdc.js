// PRODUCTION (1.10 slice 4b T13): the latency read-out of the insert chains, the page's mirror of the delay compensation in the core (core/include/cypherdj/arr_pdc.h,
// model in its header). Pure: the project in, numbers in samples out. The core computes the same table when it loads the playback; tests/production_pdc.test.mjs binds
// LATENZ to project/insert_key.ts (generated from the contract) and the model to the cases of kern/tests/test_arr_pdc.cpp.
//
// Model (worst case): all tracks are aligned to the track with the longest chain; a group chain adds on top and the groups are aligned to the longest group; the track
// part of a return waits for the groups; the PM sum waits for the longest of tracks, groups and returns. Every path is delayed exactly once. A bypassed stage counts.
export const LATENZ = { komp: 0, eq: 69, saett: 69, lim: 74 };   // samples at 48 kHz, equal to INSERT_ARTEN[art].latenz
export const SAMPLERATE = 48000;

const kette = (st) => (st?.inserts ?? []).reduce((n, i) => n + (LATENZ[i.art] ?? 0), 0);

// -> { gesamt, streifen: { [id]: { kette, versatz } }, ringe }
//    kette: the latency of the stages on that strip; versatz: the delay the core adds on that strip so that it stays in time with the longest path (tracks, groups, returns:
//    the delay of the strip's own output; the master has none); gesamt: the largest path latency (what the music is late against the transport); ringe: places with a delay
export function pdcRechnen(p) {
  const aus = { gesamt: 0, streifen: {}, ringe: 0 };
  if (!p) return aus;
  const spuren = p.spuren ?? [], gruppen = p.gruppen ?? [], returns = p.returns ?? [];
  const a = new Map(spuren.map((s) => [s.id, kette(s)]));
  const tTrk = Math.max(0, ...a.values());
  const benutzt = gruppen.filter((g) => spuren.some((s) => s.ausgang?.id === g.id));
  const aGrp = new Map(benutzt.map((g) => [g.id, tTrk + kette(g)]));
  const tG = Math.max(tTrk, ...aGrp.values());
  const aRet = new Map(returns.map((r) => [r.id, tG + kette(r)]));
  const pIn = Math.max(tG, ...aRet.values());
  for (const s of spuren) aus.streifen[s.id] = { kette: a.get(s.id), versatz: tTrk - a.get(s.id) };
  for (const g of gruppen) aus.streifen[g.id] = { kette: kette(g), versatz: aGrp.has(g.id) ? tG - aGrp.get(g.id) : 0 };
  for (const r of returns) aus.streifen[r.id] = { kette: kette(r), versatz: pIn - aRet.get(r.id) };
  aus.streifen.master = { kette: kette(p.master), versatz: 0 };
  aus.gesamt = pIn + kette(p.master);
  // places with a delay: the strips above, the track sends into each return, the PM sums of tracks and groups
  const ds = [...Object.entries(aus.streifen).filter(([id]) => id !== 'master').map(([, v]) => v.versatz),
    ...returns.map(() => tG - tTrk), pIn - tTrk, benutzt.length ? pIn - tG : 0];
  aus.ringe = ds.filter((d) => d > 0).length;
  return aus;
}

export const msText = (samples) => `${((samples / SAMPLERATE) * 1000).toFixed(1)} ms`;
// the line under the INSERTS header: empty when nothing in the project has a latency
export const latenzZeile = (p) => {
  const g = pdcRechnen(p).gesamt;
  return g > 0 ? `Latency ${msText(g)} (${g} samples): the strips are delayed to stay in time; the export skips it` : '';
};
// the text of one strip row: its own chain and the delay the core adds to it; empty for a strip without either
export const streifenText = (r) => (!r || (r.kette === 0 && r.versatz === 0) ? ''
  : [r.kette > 0 ? `chain ${msText(r.kette)}` : '', r.versatz > 0 ? `delayed ${msText(r.versatz)} to match` : ''].filter(Boolean).join(' · '));
