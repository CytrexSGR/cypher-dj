//! Cypher Sättigung: tanh-Kennlinie mit Antiderivative Antialiasing erster Ordnung (ADAA1, Bilbao, Esqueda,
//! Parker, Välimäki 2017), gerechnet bei doppelter Abtastrate (Halbband aus `eq_dsp::ueberabtastung`).
//!
//! Warum 2x zusätzlich zu ADAA: Bilbao et al. messen ADAA nur zusammen mit Überabtastung, weil ADAA1 selbst
//! wie ein Mittelwertfilter über ein Sample wirkt und bei 1x die Höhen bedämpft und das Aliasing nicht
//! weit genug drückt (FMS-Pilot 2026-10-15: Säge 50 Hz, Drive 10: 1x −49,8 dB, 2x unter −60 dB; Urteil
//! Andreas „3 ja“). Ab 88 kHz Basisrate entfällt die Überabtastung wie im EQ.
//!
//! Grenzfall x[n] ≈ x[n−1]: unter |Δ| = EPS Rückfall auf tanh des Mittelwerts (Gl. 17 der Arbeit), F1
//! überlaufsicher als |x| + ln1p(e^(−2|x|)) − ln 2 (Urteil „4 ok“). EPS = 1e-5 ist gemessen, nicht der
//! Literatur entnommen; gilt für f64, nicht für f32.
//! Ohne Allokation im Block.

use eq_dsp::ueberabtastung::{Hoch, Runter, LATENZ};

/// Ab dieser Basisrate wird nicht mehr überabgetastet (wie `eq_dsp::OHNE_UEBERABTASTUNG_AB`).
pub const OHNE_UEBERABTASTUNG_AB: f64 = 88000.0;
/// Unter diesem |x − x_vorher| rechnet ADAA1 mit tanh des Mittelwerts statt mit dem Differenzenquotienten.
pub const EPS: f64 = 1e-5;
/// Länge der Trocken-Verzögerung (größte Latenz, die vorkommt).
const TROCKEN_MAX: usize = LATENZ + 1;

/// Stammfunktion von tanh: ln cosh x, ohne Überlauf für große |x|.
pub fn f1(x: f64) -> f64 {
    let a = x.abs();
    a + (-2.0 * a).exp().ln_1p() - std::f64::consts::LN_2
}

/// ADAA1 für tanh, ein Kanal.
#[derive(Clone, Copy, Debug)]
pub struct Adaa1 {
    xp: f64,
    f1p: f64,
}

impl Default for Adaa1 {
    fn default() -> Self {
        Adaa1 { xp: 0.0, f1p: f1(0.0) }
    }
}

impl Adaa1 {
    #[inline]
    pub fn verarbeite(&mut self, x: f64) -> f64 {
        let fx = f1(x);
        let d = x - self.xp;
        let y = if d.abs() > EPS { (fx - self.f1p) / d } else { (0.5 * (x + self.xp)).tanh() };
        self.xp = x;
        self.f1p = fx;
        y
    }
    pub fn reset(&mut self) {
        *self = Adaa1::default();
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// Verstärkung vor der Kennlinie, dB
    pub drive_db: f64,
    /// Pegel nach der Kennlinie, dB
    pub ausgang_db: f64,
    /// 0 = trocken (um die Latenz verzögert, sonst bitgleich), 1 = voll gesättigt
    pub mix: f64,
}

impl Default for Einstellung {
    fn default() -> Self {
        Einstellung { drive_db: 12.0, ausgang_db: -6.0, mix: 1.0 }
    }
}

fn db(v: f64) -> f64 {
    10f64.powf(v / 20.0)
}

pub struct Saett {
    ueber: bool,
    hoch: [Hoch; 2],
    runter: [Runter; 2],
    adaa: [Adaa1; 2],
    // Gleitende Regler (ein Pol, ~10 ms), damit Drive-Änderungen nicht knacken
    drive: f64,
    drive_ziel: f64,
    ausgang: f64,
    ausgang_ziel: f64,
    mix: f64,
    mix_ziel: f64,
    alpha: f64,
    trocken: [[f64; TROCKEN_MAX]; 2],
    tpos: usize,
}

impl Saett {
    pub fn neu(fs: f64) -> Self {
        let mut s = Saett {
            ueber: fs < OHNE_UEBERABTASTUNG_AB,
            hoch: [Hoch::neu(), Hoch::neu()],
            runter: [Runter::neu(), Runter::neu()],
            adaa: [Adaa1::default(); 2],
            drive: 1.0,
            drive_ziel: 1.0,
            ausgang: 1.0,
            ausgang_ziel: 1.0,
            mix: 1.0,
            mix_ziel: 1.0,
            alpha: 1.0 - (-1.0 / (0.010 * fs)).exp(),
            trocken: [[0.0; TROCKEN_MAX]; 2],
            tpos: 0,
        };
        s.setze(&Einstellung::default());
        s.drive = s.drive_ziel;
        s.ausgang = s.ausgang_ziel;
        s.mix = s.mix_ziel;
        s
    }

    /// Latenz in Basis-Samples (dem Host melden).
    pub fn latenz(&self) -> usize {
        if self.ueber { LATENZ } else { 0 }
    }

    pub fn setze(&mut self, e: &Einstellung) {
        self.drive_ziel = db(e.drive_db);
        self.ausgang_ziel = db(e.ausgang_db);
        self.mix_ziel = e.mix.clamp(0.0, 1.0);
    }

    pub fn leeren(&mut self) {
        for k in 0..2 {
            self.hoch[k].reset();
            self.runter[k].reset();
            self.adaa[k].reset();
        }
        self.trocken = [[0.0; TROCKEN_MAX]; 2];
        self.tpos = 0;
        self.drive = self.drive_ziel;
        self.ausgang = self.ausgang_ziel;
        self.mix = self.mix_ziel;
    }

    /// Ein Basis-Sample eines Kanals durch die nasse Kette (ohne Mix und Ausgang).
    #[inline]
    fn nass(&mut self, k: usize, x: f64) -> f64 {
        let v = x * self.drive;
        if self.ueber {
            let [a, b] = self.hoch[k].verarbeite(v);
            let y = [self.adaa[k].verarbeite(a), self.adaa[k].verarbeite(b)];
            self.runter[k].verarbeite(y)
        } else {
            self.adaa[k].verarbeite(v)
        }
    }

    pub fn block(&mut self, l: &mut [f32], r: &mut [f32]) {
        let lat = self.latenz();
        for i in 0..l.len().min(r.len()) {
            self.drive += self.alpha * (self.drive_ziel - self.drive);
            self.ausgang += self.alpha * (self.ausgang_ziel - self.ausgang);
            self.mix += self.alpha * (self.mix_ziel - self.mix);
            self.tpos = (self.tpos + 1) % TROCKEN_MAX;
            let lies = (self.tpos + TROCKEN_MAX - lat) % TROCKEN_MAX;
            for (k, s) in [(0usize, &mut l[i]), (1, &mut r[i])] {
                let x = *s as f64;
                self.trocken[k][self.tpos] = x;
                let t = self.trocken[k][lies];
                let n = self.nass(k, x) * self.ausgang;
                *s = (t + self.mix * (n - t)) as f32;
            }
        }
    }
}
