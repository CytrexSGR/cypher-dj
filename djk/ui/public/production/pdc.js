// PRODUCTION (1.10 slice 4b T13): the latency read-out of the insert chains, the page's mirror of the delay compensation in the core (core/include/cypherdj/arr_pdc.h,
// model in its header). Pure: the project in, numbers in samples out. The core computes the same table when it loads the playback; tests/production_pdc.test.mjs binds
// LATENZ to project/insert_key.ts (generated from the contract) and the model to the cases of kern/tests/test_arr_pdc.cpp.
//
// Model (worst case): all tracks are aligned to the track with the longest chain; a group chain adds on top and the groups are aligned to the longest group; the track
// part of a return waits for the groups; the PM sum waits for the longest of tracks, groups and returns. Every path is delayed exactly once. A bypassed stage counts.
export const LATENZ = { komp: 0, eq: 69, saett: 69, lim: 74, utility: 0, bk: 0 };   // bk: the real latency is the graph's (measured by the core, at most 128 samples) and the page does not get it: it counts 0 and says so (bk below)   // samples at 48 kHz, equal to INSERT_ARTEN[art].latenz
export const SAMPLERATE = 48000;

// Plan 1.11 task 11: a plugin (host) stage has no constant: its latency is what the host reported (HostLage.latenz in samples, keyed by insert id; `hosten`
// is {insert_id: samples}); before the host reports, the user's extra latency is all the page knows.
let hosten = {};
const stufeLatenz = (i) => (i.art === 'host' ? (hosten[i.id] ?? i.latenz_extra ?? 0) : (LATENZ[i.art] ?? 0));
// arr-bk: the number of Baukasten stages on a strip; their latency is unknown to the page (counted as 0 in `kette`), so the read-out says "unknown" instead of showing a sum that looks complete
const bkZahl = (st) => (st?.inserts ?? []).filter((i) => i.art === 'bk').length;
const kette = (st) => (st?.inserts ?? []).reduce((n, i) => n + stufeLatenz(i), 0);
export const hostLatenzen = (lage) => Object.fromEntries((lage ?? []).filter((h) => Number.isFinite(h.latenz)).map((h) => [h.insert_id, h.latenz]));

// -> { gesamt, streifen: { [id]: { kette, versatz, bk } }, ringe, bk }
//    bk: the number of Baukasten stages (strip) or of all of them (total), whose latency is not in the numbers; kette: the latency of the stages on that strip; versatz: the delay the core adds on that strip so that it stays in time with the longest path (tracks, groups, returns:
//    the delay of the strip's own output; the master has none); gesamt: the largest path latency (what the music is late against the transport); ringe: places with a delay
export function pdcRechnen(p, hostLage = null) {
  hosten = hostLage && !Array.isArray(hostLage) ? hostLage : hostLatenzen(hostLage);
  const aus = { gesamt: 0, streifen: {}, ringe: 0, bk: 0 };
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
  for (const st of [...spuren, ...gruppen, ...returns, p.master]) aus.bk += bkZahl(st);
  for (const [id, v] of Object.entries(aus.streifen)) v.bk = bkZahl(id === 'master' ? p.master : [...spuren, ...gruppen, ...returns].find((x) => x.id === id));
  // places with a delay: the strips above, the track sends into each return, the PM sums of tracks and groups
  const ds = [...Object.entries(aus.streifen).filter(([id]) => id !== 'master').map(([, v]) => v.versatz),
    ...returns.map(() => tG - tTrk), pIn - tTrk, benutzt.length ? pIn - tG : 0];
  aus.ringe = ds.filter((d) => d > 0).length;
  return aus;
}

export const msText = (samples) => `${((samples / SAMPLERATE) * 1000).toFixed(1)} ms`;
// the line under the INSERTS header: empty when nothing in the project has a latency
export const latenzZeile = (p, hostLage = null) => {
  const r = pdcRechnen(p, hostLage);
  const g = r.gesamt;
  return [g > 0 ? `Latency ${msText(g)} (${g} samples): the strips are delayed to stay in time; the export skips it` : '',
    r.bk > 0 ? `latency of ${r.bk} Baukasten stage${r.bk > 1 ? 's' : ''} unknown here (the core delays for it; not in this sum)` : ''].filter(Boolean).join(' · ');
};
// the text of one strip row: its own chain and the delay the core adds to it; empty for a strip without either
export const streifenText = (r) => (!r || (r.kette === 0 && r.versatz === 0 && !r.bk) ? ''
  : [r.kette > 0 ? `chain ${msText(r.kette)}` : '', r.bk > 0 ? 'Baukasten latency unknown' : '', r.versatz > 0 ? `delayed ${msText(r.versatz)} to match` : ''].filter(Boolean).join(' · '));
