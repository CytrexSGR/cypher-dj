// OSC 1.0 kodieren und lesen (SCHNITTSTELLEN §2, §4, §5). Typen: i h d f s.
// Vorlage: proben/02-uhr-sync-planer/kern/absender.mjs (osc, parse); hier mit f, s, Längenprüfung.
export type OscWert = number | bigint | string;

export interface OscNachricht {
  adresse: string;
  typen: string; // ohne führendes Komma
  werte: OscWert[];
}

const auf4 = (n: number): number => (n + 3) & ~3;

function zeichenkette(s: string): Buffer {
  const roh = Buffer.from(s, 'ascii');
  const b = Buffer.alloc(auf4(roh.length + 1)); // mindestens ein Nullbyte
  roh.copy(b);
  return b;
}

export function kodiere(adresse: string, typen: string, werte: OscWert[]): Buffer {
  if (typen.length !== werte.length) {
    throw new Error(`${adresse}: ${typen.length} Typen, aber ${werte.length} Werte`);
  }
  const teile: Buffer[] = [zeichenkette(adresse), zeichenkette(',' + typen)];
  for (let i = 0; i < typen.length; i++) {
    const t = typen[i];
    const v = werte[i];
    if (t === 'i') {
      const b = Buffer.alloc(4); b.writeInt32BE(Number(v)); teile.push(b);
    } else if (t === 'h') {
      const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); teile.push(b);
    } else if (t === 'd') {
      const b = Buffer.alloc(8); b.writeDoubleBE(Number(v)); teile.push(b);
    } else if (t === 'f') {
      const b = Buffer.alloc(4); b.writeFloatBE(Number(v)); teile.push(b);
    } else if (t === 's') {
      const s = String(v);
      if (!/^[\x00-\x7f]*$/.test(s) || Buffer.byteLength(s) > 47) {
        throw new Error(`${adresse}: Zeichenkette nicht ASCII oder länger als 47 Bytes (§1.4): ${s}`);
      }
      teile.push(zeichenkette(s));
    } else {
      throw new Error(`${adresse}: Typ ${t} wird nicht unterstützt`);
    }
  }
  return Buffer.concat(teile);
}

export function lies(buf: Buffer): OscNachricht {
  let o = 0;
  const liesText = (): string => {
    const ende = buf.indexOf(0, o);
    if (ende < 0) throw new Error('OSC: Zeichenkette ohne Nullbyte');
    const s = buf.toString('ascii', o, ende);
    o = auf4(ende + 1);
    return s;
  };
  const brauche = (n: number): void => {
    if (o + n > buf.length) throw new Error('OSC: Nachricht zu kurz');
  };
  const adresse = liesText();
  if (!adresse.startsWith('/')) throw new Error(`OSC: keine Adresse (${adresse.slice(0, 16)})`);
  const typText = liesText();
  if (!typText.startsWith(',')) throw new Error(`OSC: Typ-Zeichenkette ohne Komma bei ${adresse}`);
  const typen = typText.slice(1);
  const werte: OscWert[] = [];
  for (const t of typen) {
    if (t === 'i') { brauche(4); werte.push(buf.readInt32BE(o)); o += 4; }
    else if (t === 'h') { brauche(8); werte.push(buf.readBigInt64BE(o)); o += 8; }
    else if (t === 'd') { brauche(8); werte.push(buf.readDoubleBE(o)); o += 8; }
    else if (t === 'f') { brauche(4); werte.push(buf.readFloatBE(o)); o += 4; }
    else if (t === 's') { werte.push(liesText()); }
    else throw new Error(`OSC: Typ ${t} bei ${adresse} wird nicht unterstützt`);
  }
  return { adresse, typen, werte };
}
