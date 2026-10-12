//! Frühe Reflexionen (MATHE.md §1): dünnes FIR im Zeitbereich, ohne Blocklatenz.

use crate::zufall::Zufall;

pub const TAPS: usize = 24;

pub struct Frueh {
    puffer: Vec<f32>,
    pos: usize,
    verz: [usize; TAPS],
    gew: [f32; TAPS],
    samen: u64,
}

impl Frueh {
    /// `max_verz`: größte Verzögerung in Samples (Puffergröße), einmalig bei der Erzeugung.
    pub fn neu(max_verz: usize, samen: u64) -> Self {
        Frueh { puffer: vec![0.0; max_verz + 1], pos: 0, verz: [0; TAPS], gew: [0.0; TAPS], samen }
    }

    /// Taps quadratisch in [t_pre, t_pre + laenge] verteilt, Gewichte ±10^(−3 Δt / t60), Energie 1.
    pub fn setze(&mut self, fs: f64, t_pre: f64, laenge: f64, t60: f64) {
        let mut z = Zufall::neu(self.samen);
        let max = self.puffer.len() - 1;
        let mut energie = 0.0;
        for i in 0..TAPS {
            // quadratische Verteilung mit etwas Zufall, erster Tap genau bei t_pre
            let u = if i == 0 { 0.0 } else { ((i as f64 + 0.5 * z.sym()) / (TAPS - 1) as f64).clamp(0.0, 1.0) };
            let t = t_pre + laenge * u * u;
            self.verz[i] = ((t * fs).round() as usize).min(max);
            let vorzeichen = if z.u64() & 1 == 0 { 1.0 } else { -1.0 };
            let g = vorzeichen * 10f64.powf(-3.0 * (t - t_pre) / t60.max(0.05));
            self.gew[i] = g as f32;
            energie += g * g;
        }
        let norm = (1.0 / energie).sqrt() as f32;
        self.gew.iter_mut().for_each(|g| *g *= norm);
    }

    pub fn reset(&mut self) {
        self.puffer.iter_mut().for_each(|v| *v = 0.0);
    }

    #[inline]
    pub fn sample(&mut self, x: f32) -> f32 {
        let l = self.puffer.len();
        self.puffer[self.pos] = x;
        let mut y = 0.0;
        for i in 0..TAPS {
            y += self.gew[i] * self.puffer[(self.pos + l - self.verz[i]) % l];
        }
        self.pos = (self.pos + 1) % l;
        y
    }
}

/// Einfache Verzögerungsleitung mit fester Maximallänge.
pub struct Verzoegerung {
    puffer: Vec<f32>,
    pos: usize,
    pub verz: usize,
}

impl Verzoegerung {
    pub fn neu(max: usize) -> Self {
        Verzoegerung { puffer: vec![0.0; max + 1], pos: 0, verz: 0 }
    }
    pub fn reset(&mut self) {
        self.puffer.iter_mut().for_each(|v| *v = 0.0);
    }
    #[inline]
    pub fn sample(&mut self, x: f32) -> f32 {
        let l = self.puffer.len();
        self.puffer[self.pos] = x;
        let y = self.puffer[(self.pos + l - self.verz.min(l - 1)) % l];
        self.pos = (self.pos + 1) % l;
        y
    }
}
