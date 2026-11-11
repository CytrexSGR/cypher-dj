// Builds small Standard MIDI Files from bytes for the MIDI import tests (nothing is read from disk, no real file is copied into the repository).
// A track is a list of events {dt, bytes} or {dt, meta: [type, ...data]}; `smf()` writes the chunks.
export const vlq = (n) => {
  const b = [n & 0x7f];
  while ((n >>= 7) > 0) b.unshift((n & 0x7f) | 0x80);
  return b;
};
const be = (n, len) => Array.from({ length: len }, (_, i) => (n >> (8 * (len - 1 - i))) & 0xff);
const text = (s) => [...Buffer.from(s, 'utf8')];

export const meta = (dt, typ, ...daten) => ({ dt, bytes: [0xff, typ, ...vlq(daten.length), ...daten] });
export const nameMeta = (name, dt = 0) => meta(dt, 0x03, ...text(name));
export const tempoMeta = (bpm, dt = 0) => { const us = Math.round(60_000_000 / bpm); return meta(dt, 0x51, ...be(us, 3)); };
export const taktMeta = (zaehler, nennerPot, dt = 0) => meta(dt, 0x58, zaehler, nennerPot, 24, 8);
export const programm = (kanal, nr, dt = 0) => ({ dt, bytes: [0xc0 | kanal, nr] });
export const an = (kanal, ton, vel, dt = 0) => ({ dt, bytes: [0x90 | kanal, ton, vel] });
export const aus = (kanal, ton, dt = 0) => ({ dt, bytes: [0x80 | kanal, ton, 64] });
export const ende = (dt = 0) => meta(dt, 0x2f);

/** one track chunk; `running: true` drops repeated status bytes the way real files do */
export function spur(ereignisse, { running = false, ohneEnde = false } = {}) {
  const b = [];
  let letzter = -1;
  for (const e of [...ereignisse, ...(ohneEnde ? [] : [ende()])]) {
    b.push(...vlq(e.dt));
    const s = e.bytes[0];
    if (running && s >= 0x80 && s < 0xf0 && s === letzter) b.push(...e.bytes.slice(1));
    else b.push(...e.bytes);
    letzter = s >= 0x80 && s < 0xf0 ? s : -1;
  }
  return [0x4d, 0x54, 0x72, 0x6b, ...be(b.length, 4), ...b];
}

/** a whole file: `spuren` are arrays of bytes from spur() */
export function smf(spuren, { format = 1, tpq = 192, spurenImKopf = spuren.length, division } = {}) {
  const kopf = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, ...be(format, 2), ...be(spurenImKopf, 2), ...be(division ?? tpq, 2)];
  return new Uint8Array([...kopf, ...spuren.flat()]);
}

/** a note of `lenTicks` ticks starting `dt` ticks after the previous event of the track (as two events) */
export const note = (kanal, ton, vel, lenTicks, dt = 0) => [an(kanal, ton, vel, dt), aus(kanal, ton, lenTicks)];
