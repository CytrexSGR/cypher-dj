// Package 1.9 U3: the signal measurements of check/acceptance_i19_hosts.mjs, kept apart so that tests/check_i19_hosts.test.mjs can check them on synthetic signals.
//   peakFrequenz(x, rate)           frequency (Hz) of the strongest bin of the Hann-windowed FFT of x (length a power of two), parabolic interpolation
//   pegelBei(x, rate, f)            level (dB, 0 dB = a full-scale sine of that frequency) of the narrow band around f (Goertzel, Hann window)
//   laengsterStillstand(l, r, von, bis, schwelle)   the longest run of frames in [von, bis) with both channels at most `schwelle` in magnitude
//   hannPegel(x, rate, f0, f1)      the strongest level (dB) in the band [f0, f1] (the peak of the bins, for "the other fundamental" within 1 %)
import fs from 'node:fs';

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const w = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(w * k), s = Math.sin(w * k);
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

// magnitude spectrum of x (Hann window), amplitude-normalised so that a full-scale sine centred on a bin reads 1.0
export function spektrum(x) {
  const n = x.length;
  if ((n & (n - 1)) !== 0 || n < 2) throw new Error(`spektrum: length ${n} is not a power of two`);
  const re = new Float64Array(n), im = new Float64Array(n);
  let summe = 0;
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); re[i] = x[i] * w; summe += w; }
  fft(re, im);
  const m = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) m[k] = (2 * Math.hypot(re[k], im[k])) / summe;
  return m;
}

export function peakFrequenz(x, rate) {
  const m = spektrum(x);
  let k0 = 1;
  for (let k = 1; k < m.length - 1; k++) if (m[k] > m[k0]) k0 = k;
  const a = Math.log(m[k0 - 1] + 1e-30), b = Math.log(m[k0] + 1e-30), c = Math.log(m[k0 + 1] + 1e-30);
  const d = (a - c) / (2 * (a - 2 * b + c) || 1);
  return ((k0 + (Number.isFinite(d) ? d : 0)) * rate) / x.length;
}

export const db = (v) => (v > 0 ? 20 * Math.log10(v) : -200);

// strongest level (dB re full scale sine) among the bins within [f0, f1]
export function hannPegel(x, rate, f0, f1) {
  const m = spektrum(x), df = rate / x.length;
  let best = 0;
  for (let k = Math.max(1, Math.floor(f0 / df)); k <= Math.min(m.length - 1, Math.ceil(f1 / df)); k++) best = Math.max(best, m[k]);
  return db(best);
}

// Goertzel level (dB re full scale sine) at exactly f, Hann window
export function pegelBei(x, rate, f) {
  const n = x.length, w0 = (2 * Math.PI * f) / rate;
  let re = 0, im = 0, summe = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re += x[i] * w * Math.cos(w0 * i); im -= x[i] * w * Math.sin(w0 * i); summe += w;
  }
  return db((2 * Math.hypot(re, im)) / summe);
}

// the longest run of frames in [von, bis) where both channels are at most `schwelle` in magnitude (digital silence)
export function laengsterStillstand(l, r, von, bis, schwelle = 1e-7) {
  let lauf = 0, best = 0;
  for (let i = von; i < bis; i++) {
    if (Math.abs(l[i]) <= schwelle && Math.abs(r[i]) <= schwelle) { lauf++; if (lauf > best) best = lauf; } else lauf = 0;
  }
  return best;
}

// interleaved f32 stereo file (a freeze file or a cypherdj-mitschnitt recording) -> { l, r, frames }
export function leseF32Stereo(pfad) {
  const b = fs.readFileSync(pfad);
  const frames = Math.floor(b.length / 8);
  const l = new Float32Array(frames), r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { l[i] = b.readFloatLE(i * 8); r[i] = b.readFloatLE(i * 8 + 4); }
  return { l, r, frames };
}

// mono mix of one channel pair
export const mono = (l, r, von, n) => { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = 0.5 * (l[von + i] + r[von + i]); return x; };
