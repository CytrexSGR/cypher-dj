// Tracker stage 6: a small ProTracker module writer for tests (no file from the internet). Shared by mod_import.test.mjs and tracker_import_mod.test.mjs.
// sample: { name, bytes (Int8 array), vol, fine, loopStart, loopLen } (loop in words); cell: [period, sample, effect, param]
export const MUSTER_ZEILEN = 64;
export function zelle(periode, sample, eff, par) {
  return [((sample & 0xf0) | (periode >> 8)), periode & 255, ((sample & 15) << 4) | eff, par];
}
// muster: array of { zeile: { ch: cell } } sparse objects, one per pattern; kanaele: channels; sig: 4 characters
// st15: a Soundtracker module with 15 samples, no signature, the header ends at byte 600 (restart byte 127)
export function bauMod({ titel = 'test song', sig = 'M.K.', kanaele = 4, ordnung = [0], muster = [{}], samples = [], laenge, flt8 = false, st15 = false }) {
  const ns = st15 ? 15 : 31, kopf = st15 ? 600 : 1084, posLen = st15 ? 470 : 950, posListe = st15 ? 472 : 952;
  const proben = Array.from({ length: ns }, (_, i) => samples[i] ?? null);
  const datenLaenge = proben.reduce((a, s) => a + (s ? s.bytes.length : 0), 0);
  const bloecke = flt8 ? muster.length * 2 : muster.length;
  const kn = flt8 ? 4 : kanaele;
  const out = new Uint8Array(kopf + bloecke * MUSTER_ZEILEN * 4 * kn + datenLaenge);
  const text = (s, off, n) => { for (let i = 0; i < Math.min(n, s.length); i++) out[off + i] = s.charCodeAt(i); };
  text(titel, 0, 20);
  proben.forEach((s, i) => {
    const o = 20 + i * 30;
    if (!s) return;
    text(s.name ?? '', o, 22);
    const w = s.bytes.length >> 1;
    out[o + 22] = w >> 8; out[o + 23] = w & 255; out[o + 24] = (s.fine ?? 0) & 15; out[o + 25] = s.vol ?? 64;
    out[o + 26] = (s.loopStart ?? 0) >> 8; out[o + 27] = (s.loopStart ?? 0) & 255;
    const ll = s.loopLen ?? 1;
    out[o + 28] = ll >> 8; out[o + 29] = ll & 255;
  });
  out[posLen] = laenge ?? ordnung.length; out[posLen + 1] = 127;
  ordnung.forEach((p, i) => { out[posListe + i] = p; });
  if (!st15) text(sig, 1080, 4);
  muster.forEach((m, p) => {
    for (const [zeile, kanaeleMap] of Object.entries(m)) {
      for (const [ch, c] of Object.entries(kanaeleMap)) {
        let blk = p, kch = Number(ch);
        if (flt8) { blk = p * 2 + (kch >= 4 ? 1 : 0); kch %= 4; }
        const o = kopf + (blk * MUSTER_ZEILEN + Number(zeile)) * 4 * kn + kch * 4;
        out.set(zelle(...c), o);
      }
    }
  });
  let o = kopf + bloecke * MUSTER_ZEILEN * 4 * kn;
  for (const s of proben) { if (!s) continue; for (const b of s.bytes) out[o++] = b & 255; }
  return out;
}
