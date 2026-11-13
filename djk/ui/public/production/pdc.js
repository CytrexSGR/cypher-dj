// PRODUCTION (1.10 slice 4b T13): the latency read-out of the insert chains, the page's mirror of the delay compensation in the core (core/include/cypherdj/arr_pdc.h,
// model in its header). Pure: the project in, numbers in samples out. The core computes the same table when it loads the playback; tests/production_pdc.test.mjs binds
// LATENZ to project/insert_key.ts (generated from the contract) and the model to the cases of kern/tests/test_arr_pdc.cpp.
//
// Model (worst case): all tracks are aligned to the track with the longest chain. Groups nest: ein(g) = max(T_trk if a track sits directly in g, aus(c) of every used child c), aus(g) = ein(g) + chain of g;
// a group's output is delayed to what its target expects (ein of the parent group, T_G = the longest top-level aus for the master) and the direct-track sum of a parent waits for its latest child (ein - T_trk).
// The returns take every source at T_G: the track part waits T_G - T_trk, the sends of group g wait T_G - (arrival of g's output); the PM sum waits for the longest of tracks, groups and returns.
// Every path is delayed exactly once. A bypassed stage counts.
export const LATENZ = { komp: 0, eq: 69, saett: 69, lim: 86, utility: 0, bk: 0 };   // bk: the real latency is the graph's (measured by the core, at most 128 samples) and the page does not get it: it counts 0 and says so (bk below)   // samples at 48 kHz, equal to INSERT_ARTEN[art].latenz
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
  const direkt = new Set(spuren.map((s) => s.ausgang?.id).filter(Boolean));   // groups that hold a track directly
  const eltern = new Map(gruppen.map((g) => [g.id, g.ausgang?.id]));
  const benutztIds = new Set(direkt);
  for (let i = 0; i <= gruppen.length; ++i) for (const g of gruppen) if (benutztIds.has(g.id) && eltern.get(g.id)) benutztIds.add(eltern.get(g.id));   // a group of only child groups is used when a child is
  const benutzt = gruppen.filter((g) => benutztIds.has(g.id));
  const ein = new Map(), aGrp = new Map();   // aGrp: aus(g)
  for (let i = 0; i <= gruppen.length; ++i)
    for (const g of benutzt) {
      const e = Math.max(direkt.has(g.id) ? tTrk : 0, ...benutzt.filter((c) => eltern.get(c.id) === g.id).map((c) => aGrp.get(c.id) ?? 0));
      ein.set(g.id, e);
      aGrp.set(g.id, e + kette(g));
    }
  const tG = Math.max(tTrk, ...benutzt.filter((g) => !benutztIds.has(eltern.get(g.id))).map((g) => aGrp.get(g.id)));
  const ank = new Map(benutzt.map((g) => [g.id, benutztIds.has(eltern.get(g.id)) ? ein.get(eltern.get(g.id)) : tG]));   // the arrival its target expects
  const aRet = new Map(returns.map((r) => [r.id, tG + kette(r)]));
  const pIn = Math.max(tG, ...aRet.values());
  for (const s of spuren) aus.streifen[s.id] = { kette: a.get(s.id), versatz: tTrk - a.get(s.id) };
  for (const g of gruppen) aus.streifen[g.id] = { kette: kette(g), versatz: aGrp.has(g.id) ? ank.get(g.id) - aGrp.get(g.id) : 0 };
  for (const r of returns) aus.streifen[r.id] = { kette: kette(r), versatz: pIn - aRet.get(r.id) };
  aus.streifen.master = { kette: kette(p.master), versatz: 0 };
  aus.gesamt = pIn + kette(p.master);
  for (const st of [...spuren, ...gruppen, ...returns, p.master]) aus.bk += bkZahl(st);
  for (const [id, v] of Object.entries(aus.streifen)) v.bk = bkZahl(id === 'master' ? p.master : [...spuren, ...gruppen, ...returns].find((x) => x.id === id));
  // places with a delay: the strips above, the track sends into each return, the PM sums of tracks and groups
  const ds = [...Object.entries(aus.streifen).filter(([id]) => id !== 'master').map(([, v]) => v.versatz),
    ...returns.map(() => tG - tTrk), pIn - tTrk, benutzt.length ? pIn - tG : 0,
    ...benutzt.map((g) => (direkt.has(g.id) ? ein.get(g.id) - tTrk : 0)), ...benutzt.map((g) => tG - ank.get(g.id))];   // the nested-group places: input (direct-track sum) and sends
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
