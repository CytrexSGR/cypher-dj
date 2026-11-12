//! Per-voice analog drift (type 49): a slow random value in -1..1 for each voice, the way every unit and every voice of
//! an analog synth sits slightly off (u-he Diva "variance"). Output = `fest` * a constant per-voice offset + (1 - `fest`) *
//! a wandering part. The offset is a hash of `saat` and the voice number, so the same graph always plays the same. The
//! wandering part picks a new random target about `rate` times per second and glides to it with a smoothstep (zero slope
//! at every target: smooth, no corners, never outside the targets, so bounded by construction). Each voice starts at its
//! own phase, so the voices never wander in step. Everything is a pure function of (`saat`, voice, sample count, rate):
//! no allocation, no locks, no panics, deterministic.

/// default rate in Hz
pub const RATE: f32 = 0.3;
/// upper limit of `rate` in Hz
pub const MAX_RATE: f32 = 20.0;

/// splitmix32-style finalizer: a good avalanche for sequential seeds
#[inline]
fn mische(mut x: u32) -> u32 {
    x = x.wrapping_add(0x9E37_79B9);
    x = (x ^ (x >> 16)).wrapping_mul(0x85EB_CA6B);
    x = (x ^ (x >> 13)).wrapping_mul(0xC2B2_AE35);
    x ^ (x >> 16)
}

/// uniform in -1..1 (exclusive of +1)
#[inline]
fn gleichmaessig(x: u32) -> f32 { (x >> 8) as f32 * (2.0 / 16_777_216.0) - 1.0 }

#[derive(Clone, Copy, Debug)]
pub struct Drift {
    zufall: u32,
    fest: f32,
    phase: f64,
    von: f32,
    nach: f32,
}

impl Drift {
    pub fn neu(stimme: usize, saat: u32) -> Self {
        let basis = mische(saat ^ mische((stimme as u32).wrapping_mul(0x27D4_EB2F).wrapping_add(0x1656_67B1)));
        let mut zufall = mische(basis ^ 0xA511_E9B3);
        let mut ziehe = || { zufall = mische(zufall); gleichmaessig(zufall) };
        let fest = gleichmaessig(mische(basis ^ 0x5EED_0FF5));
        let (von, nach) = (ziehe(), ziehe());
        let phase = ((ziehe() + 1.0) * 0.5) as f64;
        Self { zufall, fest, phase, von, nach }
    }

    /// One sample. `rate_hz` in Hz (clamped to 0..20, non-finite counts as the default), `fest` 0..1 (clamped, non-finite 0.5).
    #[inline]
    pub fn prozess(&mut self, rate_hz: f32, fest: f32, sr: f32) -> f32 {
        let rate = if rate_hz.is_finite() { rate_hz.clamp(0.0, MAX_RATE) } else { RATE };
        let fest_anteil = if fest.is_finite() { fest.clamp(0.0, 1.0) } else { 0.5 };
        self.phase += (rate / sr) as f64; // f64: at 0.003 Hz and below an f32 sum would stall
        if self.phase >= 1.0 {
            self.phase -= self.phase.floor();
            self.von = self.nach;
            self.zufall = mische(self.zufall);
            self.nach = gleichmaessig(self.zufall);
        }
        let t = self.phase as f32;
        let w = t * t * (3.0 - 2.0 * t);
        let wandernd = self.von + (self.nach - self.von) * w;
        (fest_anteil * self.fest + (1.0 - fest_anteil) * wandernd).clamp(-1.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SR: f32 = 48_000.0;

    fn lauf(stimme: usize, saat: u32, rate: f32, fest: f32, n: usize) -> Vec<f32> {
        let mut d = Drift::neu(stimme, saat);
        (0..n).map(|_| d.prozess(rate, fest, SR)).collect()
    }

    #[test]
    fn deterministisch_je_saat() {
        let a = lauf(3, 7, 0.3, 0.4, 20_000);
        let b = lauf(3, 7, 0.3, 0.4, 20_000);
        assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()));
        let c = lauf(3, 8, 0.3, 0.4, 20_000);
        assert!(a.iter().zip(&c).any(|(x, y)| x != y), "another seed must sound different");
    }

    #[test]
    fn stimmen_unterscheiden_sich() {
        let v: Vec<f32> = (0..8).map(|i| lauf(i, 1, 0.3, 0.5, 1)[0]).collect();
        for i in 0..8 {
            for j in i + 1..8 {
                assert!(v[i] != v[j], "voices {i} and {j} start equal");
            }
        }
    }

    #[test]
    fn begrenzt_und_endlich() {
        for (rate, fest) in [(0.3, 0.0), (0.3, 1.0), (20.0, 0.5), (500.0, 0.3), (0.0, 0.0), (f32::NAN, f32::NAN), (f32::INFINITY, 2.0), (-3.0, -1.0)] {
            for s in 0..16 {
                let y = lauf(s, 99, rate, fest, 50_000);
                assert!(y.iter().all(|v| v.is_finite() && (-1.0..=1.0).contains(v)), "rate {rate} fest {fest} voice {s}");
            }
        }
    }

    #[test]
    fn wandert_wirklich_und_glatt() {
        let y = lauf(0, 5, 2.0, 0.0, 96_000);
        let (lo, hi) = y.iter().fold((9.0f32, -9.0f32), |(l, h), &v| (l.min(v), h.max(v)));
        assert!(hi - lo > 0.3, "wanders only {lo}..{hi}");
        let sprung = y.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        assert!(sprung < 1e-3, "step {sprung}: not smooth");
        // rate 0 and fest 1: constant
        let k = lauf(2, 5, 0.0, 1.0, 1000);
        assert!(k.iter().all(|v| *v == k[0]));
    }

    #[test]
    fn sehr_kleine_rate_bleibt_nicht_stehen() {
        // 0.002 Hz: rate / sr = 4e-8 per sample; an f32 phase would stall near 0.3 and never move
        let mut d = Drift::neu(1, 3);
        let erster = d.prozess(0.002, 0.0, SR);
        let mut letzter = erster;
        for _ in 0..2_000_000 {
            letzter = d.prozess(0.002, 0.0, SR);
        }
        assert!(letzter != erster, "the wander stalled at {erster}");
    }

    #[test]
    fn mittelwert_ueber_viele_stimmen_nahe_null() {
        let n = 4000;
        for fest in [0.0f32, 0.5, 1.0] {
            let mittel = (0..n).map(|s| lauf(s, 42, 0.3, fest, 1000)[999]).sum::<f32>() / n as f32;
            assert!(mittel.abs() < 0.05, "fest {fest}: mean over {n} voices {mittel}");
        }
        // the static offsets alone span the range, not a narrow clump
        let (lo, hi) = (0..n).map(|s| lauf(s, 42, 0.0, 1.0, 1)[0]).fold((9.0f32, -9.0f32), |(l, h), v| (l.min(v), h.max(v)));
        assert!(lo < -0.9 && hi > 0.9, "offsets span {lo}..{hi}");
    }
}
