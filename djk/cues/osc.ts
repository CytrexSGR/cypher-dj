// OSC-Kodierung/Dekodierung für den Vorhörer-Vertrag (docs/architektur/stand/vorhoerer.md, §OSC-Vertrag).
// Portierung von djk/vorhoerer/vfern.py (kodiere/dekodiere), Typen nach OSC 1.0, Big Endian. Nur die Typen, die
// der Vorhörer benutzt: i (int32), h (int64, für jack_frame_time), f (float32), d (float64), s (string).
export type OscWert = number | string;

function textBlock(s: string): Buffer {
  const b = Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
  const pad = (4 - (b.length % 4)) % 4;
  return pad ? Buffer.concat([b, Buffer.alloc(pad)]) : b;
}

export function kodiere(adresse: string, typen: string, ...werte: OscWert[]): Buffer {
  const teile: Buffer[] = [textBlock(adresse), textBlock(`,${typen}`)];
  typen.split('').forEach((t, i) => {
    const w = werte[i];
    if (t === 'i') { const b = Buffer.alloc(4); b.writeInt32BE(Number(w)); teile.push(b); }
    else if (t === 'h') { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(Math.trunc(Number(w)))); teile.push(b); }
    else if (t === 'f') { const b = Buffer.alloc(4); b.writeFloatBE(Number(w)); teile.push(b); }
    else if (t === 'd') { const b = Buffer.alloc(8); b.writeDoubleBE(Number(w)); teile.push(b); }
    else if (t === 's') { teile.push(textBlock(String(w))); }
    else throw new Error(`unbekannter OSC-Typ: ${t}`);
  });
  return Buffer.concat(teile);
}

function leseText(b: Buffer, o: number): [string, number] {
  const e = b.indexOf(0, o);
  const s = b.toString('utf8', o, e);
  const ende = o + (((e - o + 4) >> 2) << 2);
  return [s, ende];
}

export function dekodiere(b: Buffer): { adr: string; werte: OscWert[] } {
  let o: number;
  let adr: string;
  [adr, o] = leseText(b, 0);
  if (o >= b.length) return { adr, werte: [] };
  let typen: string;
  [typen, o] = leseText(b, o);
  const werte: OscWert[] = [];
  for (const t of typen.slice(1)) {
    if (t === 'i') { werte.push(b.readInt32BE(o)); o += 4; }
    else if (t === 'f') { werte.push(b.readFloatBE(o)); o += 4; }
    else if (t === 'h') { werte.push(Number(b.readBigInt64BE(o))); o += 8; }
    else if (t === 'd') { werte.push(b.readDoubleBE(o)); o += 8; }
    else if (t === 's') { const [s, no] = leseText(b, o); werte.push(s); o = no; }
    else break;
  }
  return { adr, werte };
}

// Port-Berechnung wie vfern.py: 47740 + 1000·k, k aus CYPHERDJ_INSTANZ (a..i → 1..9), leer → Basis.
export function vorhoererPort(instanz: string | undefined): number {
  const inst = instanz ?? '';
  if (inst === '') return 47740;
  if (inst.length === 1 && inst >= 'a' && inst <= 'i') return 47740 + 1000 * (inst.charCodeAt(0) - 'a'.charCodeAt(0) + 1);
  throw new Error(`CYPHERDJ_INSTANZ ungültig: ${inst}`);
}
