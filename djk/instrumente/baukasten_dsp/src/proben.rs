//! Generated sample material (S10, C1): no audio file lives in the repository. `orchester_schlag` is a synthetic
//! orchestra-hit-like chord, `orchester_schlag_schichten` (S22) the same hit with the detune layers as separate slices,
//! `feder_ir` (S21) a synthetic spring-tank impulse response; all are used by the tests and written to disk by
//! `examples/erzeuge_probe.rs`.

/// Raw little-endian float32 bytes of `d` (the sample file format).
pub fn bytes(d: &[f32]) -> Vec<u8> { d.iter().flat_map(|v| v.to_le_bytes()).collect() }

fn blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let t = t / dt;
        t + t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

/// Length of one hit in seconds (`orchester_schlag` and each slice of `orchester_schlag_schichten`).
const SCHLAG_SEKUNDEN: f64 = 0.6;
/// Fundamentals of the chord: C4, E4, G4, C5.
const SCHLAG_GRUND: [f64; 4] = [261.6256, 329.6276, 391.9954, 523.2511];
/// Pan gains (left, right) of the three detune layers: down, centre, up.
const SCHLAG_PAN: [(f64, f64); 3] = [(1.0, 0.25), (0.7, 0.7), (0.25, 1.0)];

/// Phase of the first sample of detune layer `k` (kept per layer so that the onset is not one coherent peak).
fn schlag_phase(k: usize) -> f64 { 0.13 * (k as f64 + 1.0) }

/// Band-limited saw chord of `n` samples, one detune of `cent` cents, starting phase `ph0`, no envelope.
fn schlag_akkord(sr: f64, n: usize, cent: f64, ph0: f64) -> Vec<f64> {
    let mut m = vec![0.0f64; n];
    for f0 in SCHLAG_GRUND {
        let dt = f0 * 2f64.powf(cent / 1200.0) / sr;
        let mut ph = ph0;
        for v in m.iter_mut() {
            *v += 2.0 * ph - 1.0 - blep(ph, dt);
            ph += dt;
            if ph >= 1.0 {
                ph -= 1.0;
            }
        }
    }
    m
}

/// Envelope of one hit: 2 ms attack, exponential decay (time constant 0.18 s), 20 ms fade at the end.
fn schlag_huellkurve(sr: f64, n: usize) -> Vec<f64> {
    (0..n)
        .map(|i| {
            let t = i as f64 / sr;
            let ende = ((n - i) as f64 / (0.02 * sr)).min(1.0);
            (-t / 0.18).exp() * (t / 0.002).min(1.0) * ende
        })
        .collect()
}

/// The unscaled stereo mix of `orchester_schlag` (detunes of +-9 cent, panned, enveloped) and its peak.
fn orchester_roh(sr: f64, n: usize) -> (Vec<f64>, Vec<f64>, f64) {
    let (mut l, mut r) = (vec![0.0f64; n], vec![0.0f64; n]);
    for f0 in SCHLAG_GRUND {
        for (k, cent) in [-9.0f64, 0.0, 9.0].iter().enumerate() {
            let dt = f0 * 2f64.powf(cent / 1200.0) / sr;
            let (gl, gr) = SCHLAG_PAN[k];
            let mut ph = schlag_phase(k);
            for i in 0..n {
                let s = 2.0 * ph - 1.0 - blep(ph, dt);
                l[i] += s * gl;
                r[i] += s * gr;
                ph += dt;
                if ph >= 1.0 {
                    ph -= 1.0;
                }
            }
        }
    }
    let env = schlag_huellkurve(sr, n);
    let mut spitze = 0.0f64;
    for i in 0..n {
        l[i] *= env[i];
        r[i] *= env[i];
        spitze = spitze.max(l[i].abs()).max(r[i].abs());
    }
    (l, r, spitze)
}

/// 0.6 s, interleaved stereo: detuned band-limited saws on C4, E4, G4 and C5 (three detunes each, the outer two panned
/// left and right), 2 ms attack, exponential decay (time constant 0.18 s), 20 ms fade at the end, peak scaled to 0.8.
/// Deterministic: plain f64 arithmetic, no random numbers.
pub fn orchester_schlag(sr: f32) -> Vec<f32> {
    let sr = sr as f64;
    let n = (SCHLAG_SEKUNDEN * sr).round() as usize;
    let (l, r, spitze) = orchester_roh(sr, n);
    let skala = 0.8 / spitze;
    let mut aus = vec![0.0f32; 2 * n];
    for i in 0..n {
        aus[2 * i] = (l[i] * skala) as f32;
        aus[2 * i + 1] = (r[i] * skala) as f32;
    }
    aus
}

/// Peak of the attack noise of `orchester_schlag_schichten` relative to the peak of the centre chord. The first plan value
/// 0.25 lifted the energy above 4 kHz in the first 10 ms by only 1.8 dB against the bright saws; 0.75 gives 6.6 dB.
const SCHLAG_RAUSCHEN: f64 = 0.75;

/// Attack noise of `n` samples: deterministic xorshift32 white noise, linear decay over 6 ms, one-pole high-pass at 2 kHz,
/// scaled to peak `spitze`. No random numbers: the generator is seeded with a constant.
fn schlag_rauschen(sr: f64, n: usize, spitze: f64) -> Vec<f64> {
    let (mut x, mut z, mut y, mut vor) = (0x2545_f491u32, vec![0.0f64; n], 0.0f64, 0.0f64);
    let a = 1.0 / (1.0 + 2.0 * std::f64::consts::PI * 2000.0 / sr);
    let laenge = (0.006 * sr).round() as usize;
    for (i, o) in z.iter_mut().enumerate().take(laenge.min(n)) {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        let w = (x as f64 / u32::MAX as f64 * 2.0 - 1.0) * (1.0 - i as f64 / laenge as f64);
        y = a * (y + w - vor);
        vor = w;
        *o = y;
    }
    let max = z.iter().fold(0.0f64, |m, v| m.max(v.abs())).max(1e-12);
    z.iter().map(|v| v / max * spitze).collect()
}

/// The same hit as `orchester_schlag`, but with the detune taken out of the file (S22): three equal slices of 0.6 s
/// (interleaved stereo, left equals right), one per detune layer (slice 0 down, 1 centre, 2 up). Every slice is the
/// undetuned saw chord (C4, E4, G4, C5) with the old per-layer start phase and the old envelope; the graph
/// `sampler-fairlight` reads the slices at `2^(+-c/1200)` and pans them as the old file did (1.0/0.25, 0.7/0.7, 0.25/1.0),
/// so the detune `c` is a knob instead of 9 cent baked in. The centre slice also carries a 6 ms high-passed noise attack
/// (peak 0.75 of the centre chord peak), so it sounds once, not three times. All slices share one scale factor, the one of the old 12-saw
/// mix (`0.8 / peak of the old mix`): the graph's sum at 9 cent lands at the old level. Deterministic, no random numbers.
pub fn orchester_schlag_schichten(sr: f32) -> Vec<f32> {
    let sr = sr as f64;
    let n = (SCHLAG_SEKUNDEN * sr).round() as usize;
    let skala = 0.8 / orchester_roh(sr, n).2;
    let env = schlag_huellkurve(sr, n);
    let mut aus = vec![0.0f32; 6 * n];
    for k in 0..3 {
        let m = schlag_akkord(sr, n, 0.0, schlag_phase(k));
        let mut m: Vec<f64> = (0..n).map(|i| m[i] * env[i]).collect();
        if k == 1 {
            // the attack transient lives in the centre slice only, so the graph does not triple it
            let spitze = m.iter().fold(0.0f64, |a, v| a.max(v.abs()));
            for (v, r) in m.iter_mut().zip(schlag_rauschen(sr, n, SCHLAG_RAUSCHEN * spitze)) {
                *v += r;
            }
        }
        for i in 0..n {
            let v = (m[i] * skala) as f32;
            aus[2 * (k * n + i)] = v;
            aus[2 * (k * n + i) + 1] = v;
        }
    }
    aus
}

/// Spring-tank impulse response for the `faltung` block (S21): 1.5 s, interleaved stereo, deterministic f64 arithmetic,
/// no random numbers, no third-party IR file. The model is a static version of the dispersive spring loop of
/// Valimaki, Parker and Abel, "Parametric spring reverberation effect", JAES 58(7/8), 2010:
///
/// * per side one loop: the input and the fed-back signal enter a cascade of M = 200 *stretched* first-order allpasses
///   `(a + z^-k) / (1 + a z^-k)` with k = 6 and a = 0.4. The group delay of one stage is
///   `k (1 - a^2) / (1 + a^2 + 2 a cos(k w))`: about 10 ms for the whole cascade at low frequencies, rising towards the
///   transition frequency `sr / (2k)` = 4 kHz to about 58 ms, so the low frequencies of an impulse arrive first and the
///   high ones later: the up-chirp ("boing") of a real spring;
/// * the impulse that excites the loop is band-limited to the transition frequency (four one-pole low-passes at 3 kHz):
///   above it the stretched allpass repeats its delay curve (images at 8, 12 kHz) and would smear the chirp;
/// * the cascade output passes two one-pole low-passes at 5 kHz (the tank loses its highs on every pass) and is the tap
///   (so the first chirp is heard at once, as in a real tank); it goes back through a delay of T (left 71.3 ms, right
///   83.7 ms; the echo period is T plus the low-frequency cascade delay of about 10.7 ms, so about 82 ms left and 95 ms
///   right, pinned by `tests/feder_ir.rs::echo_period`) with the loop gain `g = 10^(-3 T / 1.5)` (-60 dB per 1.5 s)
///   to the cascade input.
///
/// Afterwards a one-pole high-pass at 80 Hz, a 50 ms raised-cosine fade to exactly 0 at the end, and one common scale
/// factor so that the larger of the two side L2 norms is 0.35 (a noise-like input comes out at about 0.35 of its RMS).
/// Static: no level-dependent "drip" of a real spring (follow-up, a separate block).
///
/// The constants differ from the first plan values (T 37.1/43.3 ms in front of the cascade, M 80, a 0.7, no excitation
/// filter, decay 2.2 s): those gave a *down*-going centroid (late/early 0.53) in `tests/feder_ir.rs::up_chirp`, because the
/// stretched allpass images above 4 kHz arrived early and the second echo reached the late window, and a decay of only
/// -38 dB at the end of the 1.5 s file (a -60 dB decay in 2.2 s is -40 dB at 1.45 s). See
/// docs/architecture/stand/baukasten-s21.md.
pub fn feder_ir(sr: f32) -> Vec<f32> {
    const STUFEN: usize = 200;
    const STRECKUNG: usize = 6;
    const A: f64 = 0.4;
    let sr = sr as f64;
    let n = (1.5 * sr).round() as usize;
    let seite = |t_ms: f64| -> Vec<f64> {
        let t = ((t_ms * 1e-3 * sr).round() as usize).max(1);
        let mut ring = vec![0.0f64; t];
        // per stage the last STRECKUNG inputs and outputs (circular, index i % STRECKUNG)
        let mut xh = vec![[0.0f64; STRECKUNG]; STUFEN];
        let mut yh = vec![[0.0f64; STRECKUNG]; STUFEN];
        let (mut tp1, mut tp2) = (0.0f64, 0.0f64);
        let c = 1.0 - (-2.0 * std::f64::consts::PI * 5000.0 / sr).exp();
        let c_ein = 1.0 - (-2.0 * std::f64::consts::PI * 3000.0 / sr).exp();
        let mut ein = [0.0f64; 4];
        let g = 10f64.powf(-3.0 * (t as f64 / sr) / 1.5);
        let mut aus = vec![0.0f64; n];
        for i in 0..n {
            let k = i % STRECKUNG;
            // excitation: the unit impulse at i = 0 through the band-limiting low-passes
            let mut anregung = if i == 0 { 1.0 } else { 0.0 };
            for z in ein.iter_mut() {
                *z += c_ein * (anregung - *z);
                anregung = *z;
            }
            let mut v = anregung + ring[i % t];
            for s in 0..STUFEN {
                let y = A * v + xh[s][k] - A * yh[s][k];
                xh[s][k] = v;
                yh[s][k] = y;
                v = y;
            }
            tp1 += c * (v - tp1);
            tp2 += c * (tp1 - tp2);
            aus[i] = tp2;
            ring[i % t] = g * tp2;
        }
        // one-pole high-pass at 80 Hz
        let r = (-2.0 * std::f64::consts::PI * 80.0 / sr).exp();
        let (mut x1, mut y1) = (0.0f64, 0.0f64);
        for v in aus.iter_mut() {
            let y = *v - x1 + r * y1;
            x1 = *v;
            y1 = y;
            *v = y;
        }
        // 50 ms raised-cosine fade, exactly 0 at the last sample
        let fade = (0.05 * sr).round() as usize;
        for j in 1..=fade {
            aus[n - fade - 1 + j] *= 0.5 * (1.0 + (std::f64::consts::PI * j as f64 / fade as f64).cos());
        }
        aus
    };
    let (l, r) = (seite(71.3), seite(83.7));
    let norm = |x: &[f64]| x.iter().map(|v| v * v).sum::<f64>().sqrt();
    let skala = 0.35 / norm(&l).max(norm(&r));
    (0..n).flat_map(|i| [(l[i] * skala) as f32, (r[i] * skala) as f32]).collect()
}
