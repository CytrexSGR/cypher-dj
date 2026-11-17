// ANALYZE window, slice 2: the level-matched difference of a source against a reference (pure, shared by the page and the page server).
// Both spectra are the 1/12 octave mean levels of the analysis (120 bands on the A440 grid). They are reduced to 1/3 octave; the reference is
// shifted by the median difference of the bands that both carry (versatz_db), so the comparison reads the tonal balance, not the loudness.
// diff_db > 0: the source has more than the reference in that band. A deviation is a run of neighbouring bands that differ by at least 3 dB
// in the same direction; the up to three strongest are named.
export const ABGLEICH = { minDb: -60, hzVon: 40, hzBis: 16000, schwelleDb: 3, boden: -200 };

const TERZ = 30, K0 = -53;
const kante = (j) => 440 * 2 ** ((j + K0 - 0.5) / 12);
export const terzHz = (m) => 440 * 2 ** ((-51.5 + 4 * m) / 12);

// 120 -> 30 levels by the power sum of four (as terzVon of project/sound_contract.ts).
export function terzAus12(db12) {
  const aus = [];
  for (let m = 0; m < TERZ; m++) {
    let p = 0;
    for (let i = 4 * m; i < 4 * m + 4; i++) { const d = db12[i]; if (Number.isFinite(d) && d > ABGLEICH.boden) p += 10 ** (d / 10); }
    aus.push(p > 0 ? Math.max(ABGLEICH.boden, 10 * Math.log10(p)) : ABGLEICH.boden);
  }
  return aus;
}

export function abgleich(quelle12, referenz12) {
  const q = terzAus12(quelle12), v = terzAus12(referenz12);
  const beide = (m) => q[m] > ABGLEICH.minDb && v[m] > ABGLEICH.minDb;
  const mitte = [];
  for (let m = 0; m < TERZ; m++) { const hz = terzHz(m); if (beide(m) && hz >= ABGLEICH.hzVon && hz <= ABGLEICH.hzBis) mitte.push(q[m] - v[m]); }
  mitte.sort((a, b) => a - b);
  const h = mitte.length >> 1;
  const versatz_db = mitte.length === 0 ? 0 : mitte.length % 2 ? mitte[h] : (mitte[h - 1] + mitte[h]) / 2;
  const baender = [];
  for (let m = 0; m < TERZ; m++) baender.push({ hz: terzHz(m), diff_db: beide(m) ? q[m] - v[m] - versatz_db : null });
  const laeufe = [];
  for (let m = 0; m < TERZ;) {
    const d = baender[m].diff_db;
    if (d === null || Math.abs(d) < ABGLEICH.schwelleDb) { m++; continue; }
    let e = m, summe = 0;
    while (e < TERZ && baender[e].diff_db !== null && Math.abs(baender[e].diff_db) >= ABGLEICH.schwelleDb && Math.sign(baender[e].diff_db) === Math.sign(d)) summe += baender[e++].diff_db;
    const n = e - m;
    laeufe.push({ hz_von: kante(4 * m), hz_bis: kante(4 * e), diff_db: summe / n, gewicht: Math.abs(summe / n) * Math.sqrt(n) });
    m = e;
  }
  laeufe.sort((a, b) => b.gewicht - a.gewicht);
  return { versatz_db, baender, abweichungen: laeufe.slice(0, 3).map(({ gewicht: _g, ...x }) => x) };
}

// 'above 8.0 kHz', 'below 60 Hz', '80 Hz to 125 Hz' for a deviation range (the outer bands read as open ends).
const hzKurz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);
export function abweichungText(x) {
  const wo = x.hz_von <= kante(0) * 1.001 ? `below ${hzKurz(x.hz_bis)}` : x.hz_bis >= kante(120) * 0.999 ? `above ${hzKurz(x.hz_von)}` : `${hzKurz(x.hz_von)} to ${hzKurz(x.hz_bis)}`;
  return `${x.diff_db > 0 ? '+' : ''}${x.diff_db.toFixed(1)} dB ${wo}`;
}
