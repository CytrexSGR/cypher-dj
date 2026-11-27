//! Doppelte Abtastrate mit linearphasigem Halbband-FIR (Kaiser-Fenster, ~100 dB Sperrdämpfung).
//!
//! Durchlass bis 0,4535·fs (20 kHz bei 44,1 kHz), Sperrband ab 0,5465·fs. Polyphasig: von den
//! 139 Taps sind nur die 70 geraden plus die Mitte ungleich null. Hin und zurück zusammen
//! verzögern um `LATENZ` Basis-Samples.
//!
//! Implementation note: the FIR sums the 35 folded pairs (`h[j]·(s[j] + s[69-j])`) and picks its kernel once at construction (`Pfad`: portable or AVX2+FMA, runtime dispatch).

use std::f64::consts::PI;

/// Mittelindex des Halbbands (ungerade). Länge = 2·MITTE + 1.
const MITTE: usize = 69;
/// Anzahl der geraden Taps h[0], h[2], …, h[2·MITTE] (alle ≠ 0, beide Seiten der Mitte).
const GERADE: usize = MITTE + 1; // 70
/// Gefaltete Paare (h[j] = h[GERADE-1-j]): 35 Multiplikationen statt 70.
const PAARE: usize = GERADE / 2; // 35
/// Gesamtlatenz Hin + Zurück in Basis-Samples.
pub const LATENZ: usize = MITTE;
/// Inputs `Hoch` keeps: the 70 of the current window plus the 69 older windows `Runter::aus_verlauf` needs to rebuild
/// its even history exactly.
const LANG: usize = 2 * GERADE - 1; // 139
/// Length of `Runter`'s odd history.
const UNGERADE: usize = MITTE / 2 + 2; // 36

fn bessel_i0(x: f64) -> f64 {
    let (mut summe, mut term, mut k) = (1.0, 1.0, 1.0);
    while term > 1e-14 * summe {
        term *= (x / (2.0 * k)).powi(2);
        summe += term;
        k += 1.0;
    }
    summe
}

/// Which FIR kernel runs. Chosen once at construction, never per sample.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pfad {
    /// Portable Rust, four explicit lane accumulators (SSE2 on x86, NEON on aarch64).
    Skalar,
    /// AVX2 + FMA kernel (x86_64 only, only when the CPU has both).
    #[cfg(target_arch = "x86_64")]
    Avx2Fma,
}

impl Pfad {
    /// The best path this CPU supports.
    pub fn erkannt() -> Pfad {
        #[cfg(target_arch = "x86_64")]
        {
            if is_x86_feature_detected!("avx2") && is_x86_feature_detected!("fma") {
                return Pfad::Avx2Fma;
            }
        }
        Pfad::Skalar
    }

    /// A requested path, downgraded to `Skalar` when this CPU cannot run it.
    fn zulaessig(self) -> Pfad {
        match self {
            Pfad::Skalar => Pfad::Skalar,
            #[cfg(target_arch = "x86_64")]
            Pfad::Avx2Fma => Pfad::erkannt(),
        }
    }
}

/// Gerade Taps, nur die erste Hälfte h[2j], j = 0..PAARE; die zweite Hälfte ist die exakte Spiegelung
/// (h[GERADE-1-j] = h[j]). Gleichanteil wie bisher: Σ aller 70 geraden Taps = 0,5.
fn gerade_taps() -> [f64; PAARE] {
    let beta = 0.1102 * (100.0 - 8.7);
    let laenge = (2 * MITTE) as f64;
    let mut h = [0.0; PAARE];
    for (j, hj) in h.iter_mut().enumerate() {
        let n = 2 * j;
        let x = n as f64 - MITTE as f64; // ungerade, ≠ 0
        let sinc = (PI * x / 2.0).sin() / (PI * x / 2.0);
        let r = 2.0 * n as f64 / laenge - 1.0;
        let fenster = bessel_i0(beta * (1.0 - r * r).max(0.0).sqrt()) / bessel_i0(beta);
        *hj = 0.5 * sinc * fenster;
    }
    let summe: f64 = 2.0 * h.iter().sum::<f64>();
    for hj in h.iter_mut() {
        *hj *= 0.5 / summe;
    }
    h
}

/// Σ_j h[j]·(s[j] + s[69-j]) over the 35 folded pairs; `s[0]` is the newest sample.
/// Two sets of four lane accumulators (l, m: independent dependency chains), 4 blocks of 8 pairs, the 3 remaining
/// pairs into l[0..3], then lanewise l+m, then (r0+r1)+(r2+r3). Both paths use exactly this order.
#[inline(always)]
fn mac_skalar(s: &[f64; GERADE], h: &[f64; PAARE]) -> f64 {
    let mut l = [0.0f64; 4];
    let mut m = [0.0f64; 4];
    for c in 0..4 {
        let j = 8 * c;
        for k in 0..4 {
            l[k] += (s[j + k] + s[GERADE - 1 - j - k]) * h[j + k];
            m[k] += (s[j + 4 + k] + s[GERADE - 5 - j - k]) * h[j + 4 + k];
        }
    }
    for k in 0..PAARE - 32 {
        let j = 32 + k;
        l[k] += (s[j] + s[GERADE - 1 - j]) * h[j];
    }
    let r = [l[0] + m[0], l[1] + m[1], l[2] + m[2], l[3] + m[3]];
    (r[0] + r[1]) + (r[2] + r[3])
}

/// Same sums in the same order as `mac_skalar`, with AVX2 loads and fused multiply-add.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
/// `s[0]` is stale here: the newest value `x` comes from a register (blended in), because a 32-byte load right after
/// the 8-byte store of `x` would defeat store forwarding.
unsafe fn mac_avx2(s: &[f64; GERADE], x: f64, h: &[f64; PAARE]) -> f64 {
    use std::arch::x86_64::*;
    let mut l = _mm256_setzero_pd();
    let mut m = _mm256_setzero_pd();
    for c in 0..4 {
        let j = 8 * c;
        // partners of j..j+3 are 69-j .. 66-j: load ascending from 66-j and reverse the lanes
        let mut a = _mm256_loadu_pd(s.as_ptr().add(j));
        if c == 0 {
            a = _mm256_blend_pd::<0b0001>(a, _mm256_set1_pd(x));
        }
        let b = _mm256_permute4x64_pd::<0x1B>(_mm256_loadu_pd(s.as_ptr().add(GERADE - 4 - j)));
        l = _mm256_fmadd_pd(_mm256_add_pd(a, b), _mm256_loadu_pd(h.as_ptr().add(j)), l);
        let a = _mm256_loadu_pd(s.as_ptr().add(j + 4));
        let b = _mm256_permute4x64_pd::<0x1B>(_mm256_loadu_pd(s.as_ptr().add(GERADE - 8 - j)));
        m = _mm256_fmadd_pd(_mm256_add_pd(a, b), _mm256_loadu_pd(h.as_ptr().add(j + 4)), m);
    }
    let mut ls = [0.0f64; 4];
    _mm256_storeu_pd(ls.as_mut_ptr(), l);
    for k in 0..PAARE - 32 {
        let j = 32 + k;
        ls[k] = (s[j] + s[GERADE - 1 - j]).mul_add(h[j], ls[k]);
    }
    let mut ms = [0.0f64; 4];
    _mm256_storeu_pd(ms.as_mut_ptr(), m);
    let r = [ls[0] + ms[0], ls[1] + ms[1], ls[2] + ms[2], ls[3] + ms[3]];
    (r[0] + r[1]) + (r[2] + r[3])
}

/// The folded FIR sum over one window (`w[0]` newest), with the kernel of `pfad`.
#[inline(always)]
fn mac_fenster(pfad: Pfad, w: &[f64; GERADE], h: &[f64; PAARE]) -> f64 {
    match pfad {
        Pfad::Skalar => mac_skalar(w, h),
        // SAFETY: see `schiebe_mac`.
        #[cfg(target_arch = "x86_64")]
        Pfad::Avx2Fma => unsafe { mac_avx2(w, w[0], h) },
    }
}

/// Push `x` into `v` and return the folded FIR sum over the new window.
#[inline(always)]
fn schiebe_mac<const N: usize, const D: usize>(pfad: Pfad, v: &mut Verlauf2<N, D>, x: f64, h: &[f64; PAARE]) -> f64 {
    match pfad {
        Pfad::Skalar => {
            v.schiebe(x);
            mac_skalar(v.fenster(), h)
        }
        // SAFETY: `Pfad::Avx2Fma` is only ever stored after `zulaessig()` saw avx2 and fma.
        #[cfg(target_arch = "x86_64")]
        Pfad::Avx2Fma => {
            v.pos = if v.pos == 0 { N - 1 } else { v.pos - 1 };
            let r = unsafe { mac_avx2(v.fenster(), x, h) };
            v.buf[v.pos] = x;
            v.buf[v.pos + N] = x;
            r
        }
    }
}

/// History of `N >= GERADE` values as a doubled linear buffer: every value is written at `pos` and `pos + N`,
/// so `buf[pos..pos + N]` is always the last `N` values, newest first, contiguous. `pos` runs downwards.
#[derive(Clone)]
struct Verlauf2<const N: usize, const D: usize> {
    buf: [f64; D],
    pos: usize,
}

impl<const N: usize, const D: usize> Verlauf2<N, D> {
    fn neu() -> Self {
        Verlauf2 { buf: [0.0; D], pos: 0 }
    }
    #[inline(always)]
    fn schiebe(&mut self, v: f64) {
        self.pos = if self.pos == 0 { N - 1 } else { self.pos - 1 };
        self.buf[self.pos] = v;
        self.buf[self.pos + N] = v;
    }
    /// All `N` kept values, `[0]` newest.
    #[inline(always)]
    fn alle(&self) -> &[f64; N] {
        self.buf[self.pos..self.pos + N].try_into().unwrap()
    }
    /// The last 70 values, `[0]` newest.
    #[inline(always)]
    fn fenster(&self) -> &[f64; GERADE] {
        self.buf[self.pos..self.pos + GERADE].try_into().unwrap()
    }
}

/// Ringpuffer fester Länge.
#[derive(Clone)]
struct Verlauf<const N: usize> {
    x: [f64; N],
    pos: usize,
}

impl<const N: usize> Verlauf<N> {
    fn neu() -> Self {
        Verlauf { x: [0.0; N], pos: 0 }
    }
    fn schiebe(&mut self, v: f64) {
        self.pos = (self.pos + 1) % N;
        self.x[self.pos] = v;
    }
    /// Wert vor `d` Schritten (0 = neuester).
    fn vor(&self, d: usize) -> f64 {
        self.x[(self.pos + N - d) % N]
    }
}

#[derive(Clone)]
pub struct Hoch {
    h: [f64; PAARE],
    v: Verlauf2<LANG, { 2 * LANG }>,
    pfad: Pfad,
}

impl Hoch {
    pub fn neu() -> Self {
        Self::mit_pfad(Pfad::erkannt())
    }
    pub fn mit_pfad(pfad: Pfad) -> Self {
        Hoch { h: gerade_taps(), v: Verlauf2::neu(), pfad: pfad.zulaessig() }
    }
    pub fn pfad(&self) -> Pfad {
        self.pfad
    }
    pub fn reset(&mut self) {
        self.v = Verlauf2::neu();
    }
    /// Ein Basis-Sample rein, zwei Samples mit doppelter Rate raus.
    #[inline]
    pub fn verarbeite(&mut self, x: f64) -> [f64; 2] {
        let a = schiebe_mac(self.pfad, &mut self.v, x, &self.h);
        [2.0 * a, self.v.fenster()[MITTE / 2]]
    }

    /// Bypass: push `x` into the history without any MAC and return the input of `LATENZ` samples ago, which is what
    /// `Hoch` + neutral bands + `Runter` would return (to within the halfband's ripple).
    #[inline]
    pub fn umgehen(&mut self, x: f64) -> f64 {
        self.v.schiebe(x);
        self.v.fenster()[LATENZ]
    }
}

#[derive(Clone)]
pub struct Runter {
    h: [f64; PAARE],
    gerade: Verlauf2<GERADE, { 2 * GERADE }>,
    ungerade: Verlauf<UNGERADE>,
    pfad: Pfad,
}

impl Runter {
    pub fn neu() -> Self {
        Self::mit_pfad(Pfad::erkannt())
    }
    pub fn mit_pfad(pfad: Pfad) -> Self {
        Runter { h: gerade_taps(), gerade: Verlauf2::neu(), ungerade: Verlauf::neu(), pfad: pfad.zulaessig() }
    }
    pub fn pfad(&self) -> Pfad {
        self.pfad
    }
    pub fn reset(&mut self) {
        self.gerade = Verlauf2::neu();
        self.ungerade = Verlauf::neu();
    }
    /// Rebuild both histories exactly as if `hoch`'s outputs of the last samples had been fed in (neutral bands in
    /// between). Allocation free: 70 MACs, once, when a bypass ends.
    pub fn aus_verlauf(&mut self, hoch: &Hoch) {
        let x = hoch.v.alle();
        self.gerade = Verlauf2::neu();
        for j in (0..GERADE).rev() {
            let w: &[f64; GERADE] = x[j..j + GERADE].try_into().unwrap();
            self.gerade.schiebe(2.0 * mac_fenster(self.pfad, w, &hoch.h));
        }
        self.ungerade = Verlauf::neu();
        for j in (0..UNGERADE).rev() {
            self.ungerade.schiebe(x[j + MITTE / 2]);
        }
    }

    /// Zwei Samples mit doppelter Rate rein, ein Basis-Sample raus.
    #[inline]
    pub fn verarbeite(&mut self, v: [f64; 2]) -> f64 {
        let a = schiebe_mac(self.pfad, &mut self.gerade, v[0], &self.h);
        self.ungerade.schiebe(v[1]);
        a + 0.5 * self.ungerade.vor(MITTE / 2 + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rauschen(n: usize) -> Vec<f64> {
        let mut z = 0x9E3779B97F4A7C15u64;
        (0..n)
            .map(|_| {
                z ^= z << 13;
                z ^= z >> 7;
                z ^= z << 17;
                (z >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
            })
            .collect()
    }

    #[test]
    fn taps_exakt_symmetrisch_und_gleichanteil() {
        let h = gerade_taps();
        let summe: f64 = 2.0 * h.iter().sum::<f64>();
        assert!((summe - 0.5).abs() < 1e-15);
    }

    #[test]
    fn pfade_stimmen_ueberein() {
        let beste = Pfad::erkannt();
        let x = rauschen(20000);
        let (mut hs, mut hb) = (Hoch::mit_pfad(Pfad::Skalar), Hoch::mit_pfad(beste));
        let (mut rs, mut rb) = (Runter::mit_pfad(Pfad::Skalar), Runter::mit_pfad(beste));
        let (mut max_h, mut max_r) = (0.0f64, 0.0f64);
        for &v in &x {
            let (a, b) = (hs.verarbeite(v), hb.verarbeite(v));
            max_h = max_h.max((a[0] - b[0]).abs()).max((a[1] - b[1]).abs());
            let (c, d) = (rs.verarbeite(a), rb.verarbeite(a));
            max_r = max_r.max((c - d).abs());
        }
        // noise peak is about 1; the relative bound is taken against that peak
        assert!(max_h < 1e-14, "Hoch: {max_h:e}");
        assert!(max_r < 1e-14, "Runter: {max_r:e}");
    }

    #[test]
    fn impuls_kommt_nach_latenz_zurueck() {
        for p in [Pfad::Skalar, Pfad::erkannt()] {
            let (mut h, mut r) = (Hoch::mit_pfad(p), Runter::mit_pfad(p));
            let mut best = (0, 0.0f64);
            for n in 0..2 * LATENZ {
                let o = r.verarbeite(h.verarbeite(if n == 0 { 1.0 } else { 0.0 }));
                if o.abs() > best.1 {
                    best = (n, o.abs());
                }
            }
            assert_eq!(best.0, LATENZ);
            assert!(best.1 > 0.3, "{}", best.1);
        }
    }

    #[test]
    fn aus_verlauf_baut_den_zustand_exakt_nach() {
        for p in [Pfad::Skalar, Pfad::erkannt()] {
            let x = rauschen(1000);
            let (mut h1, mut r1) = (Hoch::mit_pfad(p), Runter::mit_pfad(p));
            let (mut h2, mut r2) = (Hoch::mit_pfad(p), Runter::mit_pfad(p));
            for &v in &x[..700] {
                r1.verarbeite(h1.verarbeite(v));
                h2.umgehen(v);
            }
            r2.aus_verlauf(&h2);
            for &v in &x[700..] {
                let (a, b) = (r1.verarbeite(h1.verarbeite(v)), r2.verarbeite(h2.verarbeite(v)));
                assert_eq!(a.to_bits(), b.to_bits(), "{p:?}");
            }
        }
    }

    #[test]
    fn umgehen_verzoegert_um_latenz() {
        let mut h = Hoch::neu();
        let o: Vec<f64> = (0..200).map(|n| h.umgehen(n as f64)).collect();
        for n in 0..200 {
            assert_eq!(o[n], if n >= LATENZ { (n - LATENZ) as f64 } else { 0.0 });
        }
    }

    /// One quick timing, run by hand: `cargo test --release -p eq_dsp --lib zeit -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn zeit_hoch_runter_paar() {
        let x = rauschen(1 << 20);
        for p in [Pfad::Skalar, Pfad::erkannt()] {
            let (mut h, mut r) = (Hoch::mit_pfad(p), Runter::mit_pfad(p));
            let t = std::time::Instant::now();
            let mut s = 0.0;
            for &v in &x {
                s += r.verarbeite(h.verarbeite(v));
            }
            let ns = t.elapsed().as_nanos() as f64 / x.len() as f64;
            println!("{p:?}: {ns:.1} ns per Hoch+Runter pair (sum {s:.3})");
        }
    }
}
