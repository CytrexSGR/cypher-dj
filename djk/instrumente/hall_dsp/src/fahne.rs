//! Späte Fahne im STFT-Bereich (MATHE.md §2–§8): Energie je Bin akkumulieren und abklingen lassen,
//! Phase aus gewichteter Geschichte fortschreiben plus Diffusion, Ducking gegen das Trockene.

use crate::zufall::Zufall;
use realfft::num_complex::Complex;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};
use std::f64::consts::PI;
use std::sync::Arc;

pub struct Fahne {
    n: usize,
    h: usize,
    fwd: Arc<dyn RealToComplex<f32>>,
    inv: Arc<dyn ComplexToReal<f32>>,
    fenster: Vec<f32>,
    ein: Vec<f32>,
    /// unverzögertes Trockenes als Ducking-Quelle (eigener Rahmen, nur bei Ducking > 0 analysiert)
    trocken: Vec<f32>,
    ein_pos: usize,
    aus: Vec<f32>,
    aus_pos: usize,
    zaehler: usize,
    rahmen: Vec<f32>,
    spek: Vec<Complex<f32>>,
    kratz_f: Vec<Complex<f32>>,
    kratz_i: Vec<Complex<f32>>,
    // Zustand je Bin
    p: Vec<f64>,
    c: Vec<Complex<f64>>,
    phi: Vec<f64>,
    alt_phase: Vec<f64>,
    duck_d: Vec<f64>,
    // Einstellung je Bin
    g2: Vec<f64>,
    pegel: Vec<f64>,
    pub diffusion: f64,
    pub duck_a: f64,
    duck_abfall: f64,
    pub freeze: bool,
    skal: f32,
    zufall: Zufall,
}

impl Fahne {
    pub fn neu(n: usize, fs: f64, samen: u64) -> Self {
        let mut planer = RealFftPlanner::<f32>::new();
        let fwd = planer.plan_fft_forward(n);
        let inv = planer.plan_fft_inverse(n);
        let h = n / 4;
        let k = n / 2 + 1;
        let fenster = (0..n).map(|i| (0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).sqrt() as f32).collect();
        let kratz_f = fwd.make_scratch_vec();
        let kratz_i = inv.make_scratch_vec();
        Fahne {
            n,
            h,
            fwd,
            inv,
            fenster,
            ein: vec![0.0; n],
            trocken: vec![0.0; n],
            ein_pos: 0,
            aus: vec![0.0; n],
            aus_pos: 0,
            zaehler: 0,
            rahmen: vec![0.0; n],
            spek: vec![Complex::new(0.0, 0.0); k],
            kratz_f,
            kratz_i,
            p: vec![0.0; k],
            c: vec![Complex::new(0.0, 0.0); k],
            phi: vec![0.0; k],
            alt_phase: vec![0.0; k],
            duck_d: vec![0.0; k],
            g2: vec![0.0; k],
            pegel: vec![1.0; k],
            diffusion: 1.0,
            duck_a: 0.0,
            // Abfall 80 ms in der Amplitude = 40 ms in der Leistung
            duck_abfall: (-(h as f64) / (0.040 * fs)).exp(),
            freeze: false,
            // Energiebilanz: unnormierte iFFT (Faktor N), Fenster² summiert über die Überlappung
            // (Σ Hann = 2 bei Hop N/4) und Analyse-Energie (ebenfalls 2): Amplitude 1/N. Im Test
            // `impuls_energie` gegengemessen.
            skal: 1.0 / n as f32,
            zufall: Zufall::neu(samen),
        }
    }

    pub fn groesse(&self) -> usize {
        self.n
    }
    pub fn hop(&self) -> usize {
        self.h
    }
    pub fn bins(&self) -> usize {
        self.n / 2 + 1
    }

    /// Abklingen je Bin: Amplitudenfaktor pro Hop aus T60 (MATHE §3).
    pub fn setze_t60(&mut self, fs: f64, t60: impl Fn(f64) -> f64) {
        let n = self.n as f64;
        for (k, g2) in self.g2.iter_mut().enumerate() {
            let f = (k as f64 * fs / n).max(1.0);
            let g = 10f64.powf(-3.0 * self.h as f64 / (fs * t60(f).max(0.01)));
            *g2 = g * g;
        }
    }

    /// Pegel je Bin (Level und Klangfilter der Fahne), linear in Amplitude.
    pub fn setze_pegel(&mut self, fs: f64, pegel: impl Fn(f64) -> f64) {
        let n = self.n as f64;
        for (k, p) in self.pegel.iter_mut().enumerate() {
            *p = pegel(k as f64 * fs / n);
        }
    }

    pub fn kill(&mut self) {
        self.p.iter_mut().for_each(|v| *v = 0.0);
        self.c.iter_mut().for_each(|v| *v = Complex::new(0.0, 0.0));
        self.aus.iter_mut().for_each(|v| *v = 0.0);
    }

    pub fn reset(&mut self) {
        self.kill();
        self.ein.iter_mut().for_each(|v| *v = 0.0);
        self.duck_d.iter_mut().for_each(|v| *v = 0.0);
        self.zaehler = 0;
    }

    /// Ein Sample rein (Eingang der Fahne `x`, unverzögerte Ducking-Quelle `d`), ein Sample raus.
    #[inline]
    pub fn sample(&mut self, x: f32, d: f32) -> f32 {
        self.ein[self.ein_pos] = x;
        self.trocken[self.ein_pos] = d;
        self.ein_pos = (self.ein_pos + 1) % self.n;
        let y = self.aus[self.aus_pos];
        self.aus[self.aus_pos] = 0.0;
        self.aus_pos = (self.aus_pos + 1) % self.n;
        self.zaehler += 1;
        if self.zaehler == self.h {
            self.zaehler = 0;
            self.rahmen_rechnen();
        }
        y
    }

    fn rahmen_rechnen(&mut self) {
        let n = self.n;
        // Ducking-Quelle zuerst analysieren: ihre Leistung je Bin landet in duck_d
        if self.duck_a > 0.0 {
            for i in 0..n {
                self.rahmen[i] = self.trocken[(self.ein_pos + i) % n] * self.fenster[i];
            }
            let _ = self.fwd.process_with_scratch(&mut self.rahmen, &mut self.spek, &mut self.kratz_f);
            for (d, x) in self.duck_d.iter_mut().zip(self.spek.iter()) {
                let e = x.norm_sqr() as f64;
                *d = e.max(*d * self.duck_abfall);
            }
        }
        for i in 0..n {
            self.rahmen[i] = self.ein[(self.ein_pos + i) % n] * self.fenster[i];
        }
        let _ = self.fwd.process_with_scratch(&mut self.rahmen, &mut self.spek, &mut self.kratz_f);

        let v = self.diffusion;
        for k in 0..self.spek.len() {
            let x = self.spek[k];
            let (xr, xi) = (x.re as f64, x.im as f64);
            let e = xr * xr + xi * xi;
            let ph = xi.atan2(xr);
            let mut d_in = ph - self.alt_phase[k];
            d_in -= 2.0 * PI * (d_in / (2.0 * PI)).round();
            self.alt_phase[k] = ph;

            let g2 = if self.freeze { 1.0 } else { self.g2[k] };
            let einspeisen = if self.freeze { 0.0 } else { e };
            self.p[k] = g2 * self.p[k] + einspeisen;
            self.c[k] = self.c[k] * g2 + Complex::new(einspeisen * d_in.cos(), einspeisen * d_in.sin());
            let m2 = if self.freeze { self.p[k] * (1.0 - self.g2[k]) } else { (1.0 - g2) * self.p[k] };
            let mut m = m2.max(0.0).sqrt() * self.pegel[k];

            // Ducking (MATHE §7): Hüllkurve des Trockenen, Wiener-Gewicht
            if self.duck_a > 0.0 {
                let mm = m * m;
                m *= (mm / (mm + self.duck_a * self.duck_d[k] * self.pegel[k] * self.pegel[k] + 1e-30)).sqrt();
            }

            let vorschub = if self.c[k].norm_sqr() > 0.0 { self.c[k].arg() } else { 0.0 };
            self.phi[k] += vorschub + v * PI * self.zufall.sym();
            self.phi[k] -= 2.0 * PI * (self.phi[k] / (2.0 * PI)).floor();
            self.spek[k] = Complex::new((m * self.phi[k].cos()) as f32, (m * self.phi[k].sin()) as f32);
        }
        let letzter = self.spek.len() - 1;
        self.spek[0].im = 0.0;
        self.spek[letzter].im = 0.0;
        let _ = self.inv.process_with_scratch(&mut self.spek, &mut self.rahmen, &mut self.kratz_i);
        for i in 0..n {
            let j = (self.aus_pos + i) % n;
            self.aus[j] += self.rahmen[i] * self.fenster[i] * self.skal;
        }
    }
}
