// Tempo-Karte nach SCHNITTSTELLEN §1.3 (normativ): Segmente linear in der Zeit, höchstens 64.
// Formeln wie proben/02-uhr-sync-planer/kern/uhrkern.cpp Z. 60-100. Der Segmentanfang s0 wird als
// float64 gehalten (wie uhrkern.cpp); für die Golden-Werte ist das gleichwertig mit einem int64-s0 und
// dem exakten Beat an diesem Sample als b0 (nachgerechnet in tests/uhr.test.mjs).

export const SR = 48000;
export const MAX_SEGMENTE = 64;

// llround: nächste ganze Zahl, bei ,5 vom Nullpunkt weg (§1.1)
export const llround = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));

export const taktVon = (b) => Math.floor(b / 4) + 1;
export const schlagVon = (b) => Math.floor(((b % 4) + 4) % 4) + 1;
export const phraseVon = (b) => Math.floor(b / 32) + 1;

export class Karte {
  constructor(bpm = 128) {
    this.seg = [{ s0: 0, b0: 0, bpm0: bpm, k: 0, dauer_s: Infinity }];
  }

  static aus(segmente) {
    const k = new Karte();
    k.seg = segmente.map((g) => ({ ...g, dauer_s: g.dauer_s === null ? Infinity : g.dauer_s }));
    return k;
  }

  sicher() {
    return this.seg.map((g) => ({ ...g, dauer_s: Number.isFinite(g.dauer_s) ? g.dauer_s : null }));
  }

  segBeiSample(s) {
    let i = 0;
    while (i + 1 < this.seg.length && this.seg[i + 1].s0 <= s) i++;
    return this.seg[i];
  }

  segBeiBeat(b) {
    let i = 0;
    while (i + 1 < this.seg.length && this.seg[i + 1].b0 <= b) i++;
    return this.seg[i];
  }

  beat(s) {
    const g = this.segBeiSample(s);
    const dt = (s - g.s0) / SR;
    return g.b0 + (g.bpm0 * dt + (g.k * dt * dt) / 2) / 60;
  }

  bpm(s) {
    const g = this.segBeiSample(s);
    return g.bpm0 + (g.k * (s - g.s0)) / SR;
  }

  kBei(s) {
    return this.segBeiSample(s).k;
  }

  bpmBeiBeat(b) {
    const g = this.segBeiBeat(b);
    return Math.sqrt(g.bpm0 * g.bpm0 + 120 * g.k * (b - g.b0));
  }

  sample(b) {
    const g = this.segBeiBeat(b);
    const db = b - g.b0;
    return g.s0 + (SR * 120 * db) / (g.bpm0 + Math.sqrt(g.bpm0 * g.bpm0 + 120 * g.k * db));
  }

  // Zahl der Segmente, die eine Rampe ab Beat ab ergäbe (für karte_voll beim Einsortieren)
  segmenteNachRampe(ab) {
    return this.seg.filter((g) => g.b0 < ab).length + 2;
  }

  // Rampe ab Beat ab vom dann gültigen Tempo auf ziel über dauer Beats, danach konstant ziel.
  // Alle Segmente ab ab werden ersetzt. Rückgabe null oder 'karte_voll'.
  rampe(ab, ziel, dauer) {
    if (this.segmenteNachRampe(ab) > MAX_SEGMENTE) return 'karte_voll';
    const sX = this.sample(ab);
    const bpmX = this.bpmBeiBeat(ab);
    const behalten = this.seg.filter((g) => g.b0 < ab);
    if (behalten.length) behalten[behalten.length - 1].dauer_s = (sX - behalten[behalten.length - 1].s0) / SR;
    if (dauer > 0) {
      const T = (dauer * 60) / ((bpmX + ziel) / 2);
      behalten.push({ s0: sX, b0: ab, bpm0: bpmX, k: (ziel - bpmX) / T, dauer_s: T });
      behalten.push({ s0: sX + T * SR, b0: ab + dauer, bpm0: ziel, k: 0, dauer_s: Infinity });
    } else {
      behalten.push({ s0: sX, b0: ab, bpm0: ziel, k: 0, dauer_s: Infinity });
    }
    this.seg = behalten;
    return null;
  }

  // Segmente, die vor Sample s enden, verwerfen (das Segment, das s enthält, bleibt)
  verwerfe(s) {
    while (this.seg.length > 1 && this.seg[1].s0 <= s) this.seg.shift();
  }
}
