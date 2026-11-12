//! Selector (multiplexer), type 38: the input `wahl` picks one of `e1`..`e8`, per voice, for audio and control signals alike.
//! The graph computes every candidate every sample anyway; the block only selects, it saves no cost.
//!
//! Switch (`modus` 0): `norm` 1 splits the input 0..1 into `n` equal zones (position = min(n-1, floor(wahl * n)), computed
//! in f64); `norm` 0 reads the plain index 0..n-1, rounded. A change of position crossfades linearly over `blende` ms:
//! one weight per input moves towards the new one-hot weights and the weights always sum to 1 (a signal that is the same on
//! both inputs passes unchanged). A change during a running fade continues from the current weights, so there is no jump.
//! `blende` 0 is a hard switch. The first position of a voice applies at once, without a fade from input 0.
//! Morph (`modus` 1): `wahl` runs over the inputs 0..n-1 (with `norm` 1, 0..1 spans that whole path) and interpolates
//! linearly between neighbours; no fade, smoothing is up to the driver.
//! Non-finite candidates count as silence; a non-finite `wahl` keeps the last position.

pub const MAX_EIN: usize = 8;
pub const BLENDE_MAX_MS: f32 = 5000.0;

#[derive(Clone, Copy, Debug)]
pub struct Einstellung {
    pub n: usize,
    pub norm: bool,
    pub morph: bool,
    /// weight step per sample (1 = hard switch)
    pub schritt: f32,
}

impl Einstellung {
    pub fn neu(n: usize, norm: bool, morph: bool, blende_ms: f32, sr: f32) -> Self {
        let samples = (blende_ms as f64 * sr as f64 / 1000.0).max(1.0);
        Einstellung { n, norm, morph, schritt: (1.0 / samples) as f32 }
    }
}

/// Position from the input (switch mode). Non-finite: `None`.
#[inline]
pub fn position(wahl: f32, n: usize, norm: bool) -> Option<usize> {
    if !wahl.is_finite() {
        return None;
    }
    let w = wahl as f64;
    let p = if norm { (w.clamp(0.0, 1.0) * n as f64).floor() } else { w.round() };
    Some((p.max(0.0) as usize).min(n - 1))
}

#[derive(Clone, Copy)]
pub struct Stimme {
    w: [f32; MAX_EIN],
    ziel: usize,
    /// false until the first sample: the first position applies at once
    gesetzt: bool,
    /// the weights are not one-hot right now
    blendet: bool,
}

impl Default for Stimme {
    fn default() -> Self { Stimme { w: [0.0; MAX_EIN], ziel: 0, gesetzt: false, blendet: false } }
}

#[inline]
fn endlich(x: f32) -> f32 { if x.is_finite() { x } else { 0.0 } }

impl Stimme {
    #[inline]
    pub fn prozess(&mut self, e: &Einstellung, ein: &[f32; MAX_EIN], wahl: f32) -> f32 {
        let n = e.n;
        if e.morph {
            let w = if wahl.is_finite() { wahl as f64 } else { 0.0 };
            let pos = if e.norm { w.clamp(0.0, 1.0) * (n - 1) as f64 } else { w.clamp(0.0, (n - 1) as f64) };
            let i = (pos.floor() as usize).min(n - 1);
            let j = (i + 1).min(n - 1);
            let t = (pos - i as f64) as f32;
            let y = endlich(ein[i]) * (1.0 - t) + endlich(ein[j]) * t;
            return if y.is_finite() { y } else { 0.0 };
        }
        match position(wahl, n, e.norm) {
            Some(p) if !self.gesetzt => {
                self.gesetzt = true;
                self.ziel = p;
                self.w[p] = 1.0;
            }
            Some(p) if p != self.ziel => {
                self.ziel = p;
                self.blendet = true;
            }
            _ => {}
        }
        if self.blendet {
            let z = self.ziel;
            let rest = 1.0 - self.w[z];
            let d = e.schritt.min(rest);
            if d >= rest {
                self.w = [0.0; MAX_EIN];
                self.w[z] = 1.0;
                self.blendet = false;
            } else {
                // the target's gain is taken proportionally from the other weights: the sum stays 1
                let faktor = 1.0 - d / rest;
                for (i, g) in self.w.iter_mut().enumerate().take(n) {
                    if i != z { *g *= faktor; }
                }
                self.w[z] += d;
            }
        }
        if !self.blendet {
            return endlich(ein[self.ziel]);
        }
        let y: f32 = (0..n).map(|i| self.w[i] * endlich(ein[i])).sum();
        if y.is_finite() { y } else { 0.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zonen_n3() {
        assert_eq!(position(0.0, 3, true), Some(0));
        assert_eq!(position(0.32, 3, true), Some(0));
        assert_eq!(position(0.34, 3, true), Some(1));
        assert_eq!(position(1.0, 3, true), Some(2));
        assert_eq!(position(9.0, 3, true), Some(2));
        assert_eq!(position(-1.0, 3, true), Some(0));
        assert_eq!(position(f32::NAN, 3, true), None);
    }

    #[test]
    fn index_gerundet() {
        assert_eq!(position(1.4, 4, false), Some(1));
        assert_eq!(position(1.6, 4, false), Some(2));
        assert_eq!(position(7.0, 4, false), Some(3));
        assert_eq!(position(-3.0, 4, false), Some(0));
    }
}
