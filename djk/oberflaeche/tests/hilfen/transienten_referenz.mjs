// Referenz für den Gleichheitstest (Fix-Runde Slice 4, Punkt 1): findeTransienten in der Fassung VOR dem Umbau auf blockweise Rechnung
// (Commit c97866e1, TRANSIENTEN_VERSION 2), Zeichen für Zeichen, mit dem diff-Array in voller Länge. Nicht ändern: der Test misst, dass die neue Fassung
// dieselbe Liste liefert. Die Parameter stehen hier als Kopie, damit eine Änderung der Schwellen in transienten.ts den Gleichheitstest rot macht.
const BLOCK = 64, VORLAUF = 8, SPRUNG_DB = 5, BODEN_DB = -60, ABSTAND_S = 0.02;
const endlich = (x) => (Number.isFinite(x) ? x : 0);

export function findeTransientenAlt(d, sr = 48000) {
  const n = Math.floor(d.length / 2);
  const diff = new Float32Array(n);
  for (let i = 1; i < n; i++) diff[i] = (endlich(d[2 * i]) + endlich(d[2 * i + 1]) - endlich(d[2 * i - 2]) - endlich(d[2 * i - 1])) * 0.5;
  const nb = Math.floor(n / BLOCK);
  const e = new Float64Array(nb);
  for (let j = 0; j < nb; j++) {
    let s = 0;
    for (let i = j * BLOCK; i < (j + 1) * BLOCK; i++) s += diff[i] * diff[i];
    e[j] = 10 * Math.log10(s / BLOCK + 1e-12);
  }
  const aus = [];
  const abstand = Math.round(ABSTAND_S * sr);
  for (let j = VORLAUF; j < nb; j++) {
    let hintergrund = -Infinity;
    for (let k = j - VORLAUF; k < j; k++) if (e[k] > hintergrund) hintergrund = e[k];
    if (e[j] >= BODEN_DB && e[j] - hintergrund >= SPRUNG_DB) {
      const a = Math.max(1, (j - 1) * BLOCK), b = Math.min(n, (j + 3) * BLOCK);
      let hoch = 0;
      for (let i = a; i < b; i++) hoch = Math.max(hoch, Math.abs(diff[i]));
      let f = a;
      while (f < b && Math.abs(diff[f]) < hoch * 0.5) f++;
      if (!aus.length || f - aus[aus.length - 1] >= abstand) aus.push(f);
    }
  }
  return aus;
}
