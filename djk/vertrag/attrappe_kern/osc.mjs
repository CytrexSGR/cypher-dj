// OSC 1.0 kodieren und lesen, ohne Fremdbibliothek (SCHNITTSTELLEN §19.4: kein liblo).
// Typen: i (int32), h (int64, gelesen als BigInt), f (float32), d (float64), s (Zeichenkette).
// Bundles nur lesend (Erzeuger-Fenster §4.8). Vorlage: proben/02-uhr-sync-planer/kern/absender.mjs.

export const pad4 = (n) => (n + 4) & ~3;

export function kodiere(adresse, typen, werte) {
  if (werte.length !== typen.length) throw new Error(`osc: ${typen.length} Typen, ${werte.length} Werte`);
  const teile = [];
  const str = (s) => {
    const n = Buffer.byteLength(s);
    const b = Buffer.alloc(pad4(n));
    b.write(s);
    teile.push(b);
  };
  str(adresse);
  str(',' + typen);
  for (let i = 0; i < typen.length; i++) {
    const t = typen[i];
    const v = werte[i];
    let b;
    if (t === 'i') { b = Buffer.alloc(4); b.writeInt32BE(Number(v)); }
    else if (t === 'h') { b = Buffer.alloc(8); b.writeBigInt64BE(typeof v === 'bigint' ? v : BigInt(Math.round(Number(v)))); }
    else if (t === 'f') { b = Buffer.alloc(4); b.writeFloatBE(Number(v)); }
    else if (t === 'd') { b = Buffer.alloc(8); b.writeDoubleBE(Number(v)); }
    else if (t === 's') { const s = String(v); b = Buffer.alloc(pad4(Buffer.byteLength(s))); b.write(s); }
    else throw new Error(`osc: Typ ${t} unbekannt`);
    teile.push(b);
  }
  return Buffer.concat(teile);
}

export function dekodiere(buf) {
  if (buf.length >= 16 && buf.toString('latin1', 0, 8) === '#bundle\0') {
    const elemente = [];
    let o = 16;
    while (o < buf.length) {
      if (o + 4 > buf.length) throw new Error('osc: Bundle-Element abgeschnitten');
      const n = buf.readInt32BE(o);
      o += 4;
      if (n <= 0 || n % 4 !== 0 || o + n > buf.length) throw new Error('osc: Bundle-Element-Länge falsch');
      elemente.push(dekodiere(buf.subarray(o, o + n)));
      o += n;
    }
    return { bundle: true, zeitmarke: buf.readBigUInt64BE(8), elemente };
  }
  let o = 0;
  const lies = () => {
    const e = buf.indexOf(0, o);
    if (e < 0) throw new Error('osc: Zeichenkette ohne Ende');
    const s = buf.toString('utf8', o, e);
    o += pad4(e - o);
    if (o > buf.length) throw new Error('osc: Zeichenkette abgeschnitten');
    return s;
  };
  const adresse = lies();
  if (!adresse.startsWith('/')) throw new Error('osc: Adresse ohne /');
  if (o >= buf.length) return { adresse, typen: '', werte: [] };
  const tt = lies();
  if (!tt.startsWith(',')) throw new Error('osc: Typ-Zeichenkette ohne Komma');
  const typen = tt.slice(1);
  const werte = [];
  const brauche = (n) => { if (o + n > buf.length) throw new Error('osc: Argumente abgeschnitten'); };
  for (const t of typen) {
    if (t === 'i') { brauche(4); werte.push(buf.readInt32BE(o)); o += 4; }
    else if (t === 'h') { brauche(8); werte.push(buf.readBigInt64BE(o)); o += 8; }
    else if (t === 'f') { brauche(4); werte.push(buf.readFloatBE(o)); o += 4; }
    else if (t === 'd') { brauche(8); werte.push(buf.readDoubleBE(o)); o += 8; }
    else if (t === 's') werte.push(lies());
    else throw new Error(`osc: Typ ${t} unbekannt`);
  }
  if (o !== buf.length) throw new Error('osc: Überhang nach den Argumenten');
  return { adresse, typen, werte };
}

// Bundle bauen (nur für Tests und den schnellen Folgen-Läufer; Zeitmarke 1 = "sofort").
export function kodiereBundle(nachrichten) {
  const kopf = Buffer.alloc(16);
  kopf.write('#bundle\0', 0, 'latin1');
  kopf.writeBigUInt64BE(1n, 8);
  const teile = [kopf];
  for (const [adresse, typen, werte] of nachrichten) {
    const m = kodiere(adresse, typen, werte);
    const n = Buffer.alloc(4);
    n.writeInt32BE(m.length);
    teile.push(n, m);
  }
  return Buffer.concat(teile);
}
