// Slice 4 (D1): Transienten einer Quelle für BEATS und Quantize Audio. Eigenes Verfahren, nicht das Prüfgerät (pruef/w3a_messen.mjs anschlaege misst anders).
// Mono-Summe, erste Differenz (betont Anschläge), Energie je Block von 64 Frames in dB; ein Transient ist ein Block ≥ 5 dB über dem LAUTESTEN der
// 8 Blöcke davor (rund 11 ms) und über −60 dB, frühestens 20 ms nach dem vorigen. Die Lage verfeinert der erste Frame im Block davor bis zwei Blöcke
// danach, dessen Differenz die Hälfte des Höchstwerts dort erreicht. Nicht endliche Samples zählen als 0. Rückgabe: Frames, streng steigend.
// Fix nach der Prüfung (gemessen mit scratchpad/proto.mjs, Zahlen in ~/messungen/2026-10-30-w4/t8-fix-echte-loops.txt):
//  - Hintergrund war das MITTEL der 16 Blöcke davor. Ein tiefer Dauerton (60 Hz) hat in Blöcken von 1,3 ms stark schwankende Differenz-Energie
//    (die Phase des Tons), jeder Block nach einem Nulldurchgang sprang gegen das Mittel: 40 Treffer in 3,56 s auf echtem Material (20440fb4) und bis zu
//    80 je 2 s auf pulsierendem Bass. Gegen das Maximum der letzten 8 Blöcke springt ein Dauerton nie; ein Schlag schon. Das Maximum ist 2 bis 5 dB
//    strenger als das Mittel, darum SPRUNG_DB 9 → 5.
//  - ABSTAND_S 0,03 → 0,02: eine Snare 30 ms nach einer Hat wurde verschluckt.
//  - Mit dem Maximum bleibt eine Hat mit −12 dB, 100 ms nach einer Snare mit 35 ms Rauschausklang, auffindbar (mit dem Mittel nur bis 30 ms).
//  - TRANSIENTEN_VERSION 2: Ablagen der Fassung 1 werden neu gerechnet.
import fs from 'node:fs';
import path from 'node:path';

export const TRANSIENTEN_VERSION = 3;
const BLOCK = 64, VORLAUF = 8, SPRUNG_DB = 5, BODEN_DB = -60, ABSTAND_S = 0.02;
const FUSS_SUCHE_S = 0.005, FUSS_HUELLE = 12, FUSS_ANTEIL = 0.1, FUSS_VORAUS_S = 0.005;   // D14, siehe unten

const endlich = (x: number): number => (Number.isFinite(x) ? x : 0);

// Fix-Runde Slice 4 (Punkt 1): kein diff-Array in Länge der Quelle mehr (bei 15 min Stereo 173 MB zusätzlich zur Quelle). Die Differenz entsteht im
// Lauf, Block für Block, und für die Verfeinerung je Treffer neu in einem Fenster von 256 Frames. Math.fround an jeder Differenz hält das Ergebnis
// bitgleich zur Fassung mit Float32Array (tests/hilfen/transienten_referenz.mjs, Gleichheitstest an den Testsignalen und an echten Loops).
export function findeTransienten(d: Float32Array, sr = 48000): number[] {
  const n = Math.floor(d.length / 2);
  const diff = (i: number): number => (i < 1 ? 0
    : Math.fround((endlich(d[2 * i]) + endlich(d[2 * i + 1]) - endlich(d[2 * i - 2]) - endlich(d[2 * i - 1])) * 0.5));
  const nb = Math.floor(n / BLOCK);
  const e = new Float64Array(nb);
  for (let j = 0; j < nb; j++) {
    let s = 0;
    for (let i = j * BLOCK; i < (j + 1) * BLOCK; i++) { const v = diff(i); s += v * v; }
    e[j] = 10 * Math.log10(s / BLOCK + 1e-12);
  }
  // D14: Hüllkurve = Mittel von (|L| + |R|) / 2 über die letzten 0,25 ms (12 Frames, kausal: ein Ein-Sample-Klick bleibt exakt auf seinem Frame).
  // Der Fuß ist der erste Frame nach dem spätesten Punkt vor dem Treffer, an dem die Hüllkurve unter Hintergrund + 10 % des Anstiegs liegt
  // (Hintergrund = Minimum im Suchfenster, Anstieg bis zum Höchstwert der folgenden 5 ms). Suchfenster höchstens 5 ms zurück und nie vor den
  // vorigen Treffer; findet sich kein Punkt darunter, gilt sein Beginn.
  const huelle = (i: number): number => {
    let s = 0;
    for (let k = Math.max(0, i - FUSS_HUELLE + 1); k <= i; k++) s += Math.abs(endlich(d[2 * k])) + Math.abs(endlich(d[2 * k + 1]));
    return s / (2 * FUSS_HUELLE);
  };
  const fuss = (treffer: number, voriger: number): number => {
    const lo = Math.max(1, treffer - Math.round(FUSS_SUCHE_S * sr), voriger + 1), hi = Math.min(n - 1, treffer + Math.round(FUSS_VORAUS_S * sr));
    if (lo >= treffer) return treffer;
    let grund = Infinity, hoch = 0;
    for (let i = lo; i <= hi; i++) { const h = huelle(i); if (i <= treffer && h < grund) grund = h; if (h > hoch) hoch = h; }
    const schwelle = grund + FUSS_ANTEIL * (hoch - grund);
    for (let i = treffer; i >= lo; i--) if (huelle(i) < schwelle) return Math.min(treffer, i + 1);
    return lo;
  };
  const aus: number[] = [];
  const abstand = Math.round(ABSTAND_S * sr);
  let roh = -Infinity;
  for (let j = VORLAUF; j < nb; j++) {
    let hintergrund = -Infinity;
    for (let k = j - VORLAUF; k < j; k++) if (e[k] > hintergrund) hintergrund = e[k];
    if (e[j] >= BODEN_DB && e[j] - hintergrund >= SPRUNG_DB) {
      const a = Math.max(1, (j - 1) * BLOCK), b = Math.min(n, (j + 3) * BLOCK);
      let hoch = 0;
      for (let i = a; i < b; i++) hoch = Math.max(hoch, Math.abs(diff(i)));
      let f = a;
      while (f < b && Math.abs(diff(f)) < hoch * 0.5) f++;
      if (!aus.length || f - roh >= abstand) { aus.push(fuss(f, roh)); roh = f; }
    }
  }
  return aus;
}

// Ablage neben der .f32 des Dekodier-Caches: <sha>.transienten.json { version, sr, frames }. raeumeAuf (dekodier.ts) fasst nur *.teil an.
// Die .f32 als Float32Array ohne Kopie: ein View auf den Puffer der gelesenen Datei. Schief liegende Puffer (byteOffset nicht durch 4 teilbar, ein kleiner
// Buffer aus dem Pool) lassen keinen View zu; nur dann wird kopiert. Ein Rest unter 4 Byte am Ende fällt weg.
export function alsFloat32(b: Buffer): Float32Array {
  const n = Math.floor(b.length / 4);
  if (b.byteOffset % 4 === 0) return new Float32Array(b.buffer as ArrayBuffer, b.byteOffset, n);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + n * 4) as ArrayBuffer);
}
export class TransientenLager {
  private readonly merk = new Map<string, number[]>();
  private readonly ordner: string;
  private readonly o: { rechne?: (d: Float32Array, sr: number) => number[] };
  constructor(ordner: string, o: { rechne?: (d: Float32Array, sr: number) => number[] } = {}) {
    this.ordner = ordner; this.o = o;
    // Reste eines abgestürzten Servers: nur <sha>.transienten.json.<pid>.tmp (dekodier.ts räumt nur *.teil)
    try {
      for (const n of fs.readdirSync(ordner)) if (/\.transienten\.json\.[^/]*\.tmp$/.test(n)) fs.rmSync(path.join(ordner, n), { force: true });
    } catch { /* Ordner fehlt noch */ }
  }
  // Quellsekunden, aufsteigend; null = keine dekodierte Quelle (nicht gemerkt: die Dekodierung kann noch kommen)
  fuer(sha: string): number[] | null {
    const gemerkt = this.merk.get(sha);
    if (gemerkt) return gemerkt;
    const datei = path.join(this.ordner, `${sha}.transienten.json`), quelle = path.join(this.ordner, `${sha}.f32`);
    let frames: number[] | null = null;
    try {
      const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
      if (j.version === TRANSIENTEN_VERSION && j.sr === 48000 && Array.isArray(j.frames)) frames = j.frames;
    } catch { /* fehlt oder kaputt: neu rechnen */ }
    if (frames === null && fs.existsSync(quelle)) {
      frames = (this.o.rechne ?? findeTransienten)(alsFloat32(fs.readFileSync(quelle)), 48000);
      // Fix-Runde Slice 4: ein Schreibfehler (EACCES, Platte voll) darf das Ergebnis nicht kosten; es wird gemerkt und gemeldet, die Ablage fehlt dann nur
      const tmp = `${datei}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify({ version: TRANSIENTEN_VERSION, sr: 48000, frames }));
        fs.renameSync(tmp, datei);
      } catch (err) {
        console.error(`transienten: Ablage ${datei} nicht geschrieben (${(err as Error).message}); das Ergebnis gilt bis zum Ende dieses Laufs`);
        try { fs.rmSync(tmp, { force: true }); } catch { /* nichts zu räumen */ }
      }
    }
    if (frames === null) return null;
    const s = frames.map((f) => f / 48000);
    this.merk.set(sha, s);
    return s;
  }
}
