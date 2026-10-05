// Legt eine Hüllkurven-Ring-Datei im Layout aus Task 1 an (SCHNITTSTELLEN §6.2): Kopf CDJH/1/1000/16/cap,
// Datensätze per DataView/Buffer, little-endian. Von tests/ohr.test.mjs und tests/server.test.mjs benutzt (T5).
import fs from 'node:fs';

const KOPF = 64;
const SATZ = 64;
const KANAELE = 16;

// saetzeJeKanal: { [kanal]: Array<{sample, beat, quell, band[6], k, spitze}> }, alle Arrays gleich lang.
// rAb: Zeilenindex, ab dem geschrieben wird (für Anhängen an eine bestehende Datei). neu: Datei frisch anlegen.
export function schreibeRing(pfad, saetzeJeKanal, { rAb = 0, cap = 16384, neu = true } = {}) {
  const n = Object.values(saetzeJeKanal)[0]?.length ?? 0;
  const bytes = KOPF + cap * KANAELE * SATZ;
  let fd;
  if (neu) {
    fd = fs.openSync(pfad, 'w');
    const kopf = Buffer.alloc(KOPF);
    kopf.write('CDJH', 0, 'ascii');
    kopf.writeUInt32LE(1, 4);
    kopf.writeUInt32LE(1000, 8);
    kopf.writeUInt32LE(KANAELE, 12);
    kopf.writeUInt32LE(cap, 16);
    kopf.writeBigUInt64LE(0n, 32);
    fs.writeSync(fd, kopf, 0, KOPF, 0);
    fs.ftruncateSync(fd, bytes);
  } else {
    fd = fs.openSync(pfad, 'r+');
  }
  for (let i = 0; i < n; ++i) {
    const r = rAb + i;
    const zeile = r % cap;
    for (const [kanalStr, saetze] of Object.entries(saetzeJeKanal)) {
      const kanal = Number(kanalStr);
      const s = saetze[i];
      const buf = Buffer.alloc(SATZ);
      buf.writeBigInt64LE(BigInt(s.sample), 0);
      buf.writeDoubleLE(s.beat, 8);
      buf.writeDoubleLE(s.quell, 16);
      for (let b = 0; b < 6; ++b) buf.writeFloatLE(s.band[b], 24 + b * 4);
      buf.writeFloatLE(s.k, 48);
      buf.writeFloatLE(s.spitze, 52);
      const off = KOPF + (zeile * KANAELE + kanal) * SATZ;
      fs.writeSync(fd, buf, 0, SATZ, off);
    }
  }
  const wneu = Buffer.alloc(8);
  wneu.writeBigUInt64LE(BigInt(rAb + n), 0);
  fs.writeSync(fd, wneu, 0, 8, 32);
  fs.closeSync(fd);
  return rAb + n;
}

// Leere, aber gültige Ring-Datei (für Route-Tests, die keine Sätze brauchen).
export function schreibeLeerenRing(pfad, cap = 16384) {
  return schreibeRing(pfad, {}, { cap });
}
