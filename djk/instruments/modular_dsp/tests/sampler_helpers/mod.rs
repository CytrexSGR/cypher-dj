//! Shared helpers of the S10 sampler tests: temp sample roots, generated files, a small FFT, graph text.
#![allow(dead_code)]
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

static ZAEHLER: AtomicUsize = AtomicUsize::new(0);

/// A fresh, empty sample root under the system temp dir (unique per process and call).
pub fn wurzel() -> PathBuf {
    let p = std::env::temp_dir().join(format!("bk-s10-{}-{}", std::process::id(), ZAEHLER.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&p).unwrap();
    p
}

pub fn bytes(d: &[f32]) -> Vec<u8> { d.iter().flat_map(|v| v.to_le_bytes()).collect() }

pub fn schreibe(w: &Path, name: &str, d: &[f32]) { std::fs::write(w.join(name), bytes(d)).unwrap(); }

/// Interleaved stereo (both sides equal) from a mono function of the frame index.
pub fn stereo(frames: usize, f: impl Fn(usize) -> f32) -> Vec<f32> {
    (0..frames).flat_map(|i| { let v = f(i); [v, v] }).collect()
}

/// Sine at 48 kHz, `frames` long, interleaved stereo.
pub fn sinus(hz: f64, frames: usize, amp: f32) -> Vec<f32> {
    stereo(frames, |i| (amp as f64 * (2.0 * std::f64::consts::PI * hz * i as f64 / 48_000.0).sin()) as f32)
}

/// A file of `n` equal segments of `len` frames; segment k is the constant (k+1)/10.
pub fn segmente(n: usize, len: usize) -> Vec<f32> { stereo(n * len, |i| (i / len + 1) as f32 / 10.0) }

fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 { j ^= bit; bit >>= 1; }
        j ^= bit;
        if i < j { re.swap(i, j); im.swap(i, j); }
    }
    let mut len = 2;
    while len <= n {
        let w = -2.0 * std::f64::consts::PI / len as f64;
        for s in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (c, sn) = ((w * k as f64).cos(), (w * k as f64).sin());
                let (a, b) = (s + k, s + k + len / 2);
                let (tr, ti) = (re[b] * c - im[b] * sn, re[b] * sn + im[b] * c);
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
            }
        }
        len <<= 1;
    }
}

/// Peak frequency in Hz of `x` (Hann window, zero padded to 2^16, parabolic interpolation on the log magnitude).
pub fn spitze_hz(x: &[f32], sr: f64) -> f64 {
    let n = 65_536;
    let m = x.len().min(n);
    let mut re = vec![0.0f64; n];
    let mut im = vec![0.0f64; n];
    for i in 0..m {
        re[i] = x[i] as f64 * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / m as f64).cos());
    }
    fft(&mut re, &mut im);
    let mag: Vec<f64> = (0..n / 2).map(|k| (re[k] * re[k] + im[k] * im[k]).sqrt()).collect();
    let k = (1..n / 2 - 1).max_by(|a, b| mag[*a].partial_cmp(&mag[*b]).unwrap()).unwrap();
    let (a, b, c) = (mag[k - 1].max(1e-30).ln(), mag[k].max(1e-30).ln(), mag[k + 1].max(1e-30).ln());
    let d = 0.5 * (a - c) / (a - 2.0 * b + c);
    (k as f64 + d) * sr / n as f64
}

/// Graph with one sampler fed by a note: note.hz/trig/gate -> sampler -> ausgang. `werte` is added to the sampler node.
pub fn graph(datei: &str, werte: &str, stimmen: usize) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"s","stimmen":{stimmen},"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"sampler","datei":"{datei}"{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.trig","nach":"s.trig"}},{{"von":"n.gate","nach":"s.gate"}},{{"von":"s.l","nach":"o.l"}},{{"von":"s.r","nach":"o.r"}}]}}"#
    )
}

/// Spectral centroid in Hz of `x` (Hann window over the whole segment, zero padded to the next power of two, power
/// spectrum, bins 1..n/2).
pub fn schwerpunkt_hz(x: &[f32], sr: f64) -> f64 {
    let n = x.len().next_power_of_two() * 2;
    let m = x.len();
    let mut re = vec![0.0f64; n];
    let mut im = vec![0.0f64; n];
    for i in 0..m {
        re[i] = x[i] as f64 * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / m as f64).cos());
    }
    fft(&mut re, &mut im);
    let (mut zaehler, mut nenner) = (0.0f64, 0.0f64);
    for k in 1..n / 2 {
        let p = re[k] * re[k] + im[k] * im[k];
        zaehler += p * (k as f64 * sr / n as f64);
        nenner += p;
    }
    zaehler / nenner.max(1e-300)
}

/// Power in the band `lo..hi` Hz of `x` (Hann window, zero padded to the next power of two, bins in the band summed).
pub fn band_energie(x: &[f32], sr: f64, lo: f64, hi: f64) -> f64 {
    let n = x.len().next_power_of_two() * 2;
    let m = x.len();
    let mut re = vec![0.0f64; n];
    let mut im = vec![0.0f64; n];
    for i in 0..m {
        re[i] = x[i] as f64 * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / m as f64).cos());
    }
    fft(&mut re, &mut im);
    (1..n / 2).filter(|k| { let f = *k as f64 * sr / n as f64; f >= lo && f < hi }).map(|k| re[k] * re[k] + im[k] * im[k]).sum()
}

// ---- S22: beat estimator for the detune tests ----

/// Beat in Hz between two equal-level layers at `f * 2^(-c/1200)` and `f * 2^(+c/1200)` (`2c` cents apart).
pub fn schwebung_hz(f: f64, cent: f64) -> f64 { 2.0 * f * (cent * std::f64::consts::LN_2 / 1200.0).sinh() }

/// Inverse of `schwebung_hz`: the per-layer detune `c` in cents for a beat of `d` Hz.
pub fn cent_aus_schwebung(f: f64, d: f64) -> f64 { 1200.0 * (d / (2.0 * f)).asinh() / std::f64::consts::LN_2 }

/// Least-squares fit `a cos(w t) + b sin(w t) + c` of `y` (sampled at `rate`): returns the residual energy.
fn sinus_rest(y: &[f64], rate: f64, hz: f64) -> f64 {
    let w = 2.0 * std::f64::consts::PI * hz / rate;
    let (mut g, mut r) = ([[0.0f64; 3]; 3], [0.0f64; 3]);
    let mut yy = 0.0;
    for (i, v) in y.iter().enumerate() {
        let (s, c) = (w * i as f64).sin_cos();
        let b = [c, s, 1.0];
        for j in 0..3 {
            r[j] += b[j] * v;
            for k in 0..3 { g[j][k] += b[j] * b[k]; }
        }
        yy += v * v;
    }
    // Gauss elimination with partial pivoting on the 3x3 normal equations
    let mut m = [[0.0f64; 4]; 3];
    for j in 0..3 { m[j][..3].copy_from_slice(&g[j]); m[j][3] = r[j]; }
    for col in 0..3 {
        let p = (col..3).max_by(|a, b| m[*a][col].abs().partial_cmp(&m[*b][col].abs()).unwrap()).unwrap();
        m.swap(col, p);
        if m[col][col].abs() < 1e-300 { return yy; }
        for row in col + 1..3 {
            let f = m[row][col] / m[col][col];
            for k in col..4 { m[row][k] -= f * m[col][k]; }
        }
    }
    let mut x = [0.0f64; 3];
    for row in (0..3).rev() {
        x[row] = (m[row][3] - (row + 1..3).map(|k| m[row][k] * x[k]).sum::<f64>()) / m[row][row];
    }
    (yy - (0..3).map(|j| x[j] * r[j]).sum::<f64>()).max(0.0)
}

/// Detune estimator (S22, plan review): the difference `s` of two layers is a carrier at `f` whose envelope beats at the
/// layers' distance, so `s^2` holds a line at that distance (plus one at `2 f`). `s^2` is block-averaged over one period of
/// the `2 f` line (which removes it), then a sine with a free mean is fitted by least squares: a coarse grid over
/// 0.3..25 Hz picks the start, a golden-section search refines it. A free mean in the fit is the unbiased form of "mean
/// removed": with fewer than three beat periods in the window, subtracting the sample mean first would bias the line.
/// Returns the beat in Hz.
pub fn schwebung_schaetzen(s: &[f64], f: f64, rate: f64) -> f64 {
    let blk = (rate / (2.0 * f)).round() as usize;
    let y: Vec<f64> = s.chunks_exact(blk).map(|c| c.iter().map(|v| v * v).sum::<f64>() / blk as f64).collect();
    let r = rate / blk as f64;
    let rest = |hz: f64| sinus_rest(&y, r, hz);
    let (mut best, mut best_hz) = (f64::MAX, 0.3);
    let schritt = 0.005;
    let mut hz = 0.3;
    while hz <= 25.0 {
        let e = rest(hz);
        if e < best { best = e; best_hz = hz; }
        hz += schritt;
    }
    let (mut a, mut b) = (best_hz - schritt, best_hz + schritt);
    let gr = 0.5 * (5.0f64.sqrt() - 1.0);
    let (mut c, mut d) = (b - gr * (b - a), a + gr * (b - a));
    let (mut ec, mut ed) = (rest(c), rest(d));
    for _ in 0..80 {
        if ec < ed { b = d; d = c; ed = ec; c = b - gr * (b - a); ec = rest(c); }
        else { a = c; c = d; ec = ed; d = a + gr * (b - a); ed = rest(d); }
    }
    0.5 * (a + b)
}

/// Estimator negative control: the difference of two synthetic sines at `f * 2^(-+c/1200)` (known detune) goes through
/// `schwebung_schaetzen`; the result comes back in cents. `frames` samples at 48 kHz.
pub fn kontrolle_cent(f: f64, c: f64, frames: usize) -> f64 {
    let w = 2.0 * std::f64::consts::PI / 48_000.0;
    let (ab, auf) = (f * 2f64.powf(-c / 1200.0), f * 2f64.powf(c / 1200.0));
    let s: Vec<f64> = (0..frames).map(|i| (w * ab * i as f64 + 0.4).sin() - (w * auf * i as f64 + 1.9).sin()).collect();
    cent_aus_schwebung(f, schwebung_schaetzen(&s, f, 48_000.0))
}
