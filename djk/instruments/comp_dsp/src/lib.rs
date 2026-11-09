//! Cypher Komp: Feed-forward-Kompressor nach Giannoulis, Massberg, Reiss 2012 (JAES 60(6), Abschnitt 5):
//! Pegel im Log-Bereich, Gain-Computer mit weichem Knie (Gl. 4), danach der smooth decoupled peak detector
//! im Log-Bereich (Gl. 17): kein Attack-Verzug, kein Knick beim Wechsel zwischen Attack und Release.
//! Ohne Host und ohne Allokation im Block; die Hülle `komp` macht daraus das VST3.

/// Statische Kennlinie in dB (Gl. 4): Ausgangspegel zum Eingangspegel `x_g`, Schwelle `t`, Ratio `r`, Knie `w`
/// (0 = hartes Knie).
pub fn gain_computer(x_g: f64, t: f64, r: f64, w: f64) -> f64 {
    let d = x_g - t;
    if 2.0 * d < -w {
        x_g
    } else if w > 0.0 && 2.0 * d.abs() <= w {
        let u = d + w / 2.0;
        x_g + (1.0 / r - 1.0) * u * u / (2.0 * w)
    } else {
        t + d / r
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    pub schwelle_db: f64,
    pub ratio: f64,
    pub knie_db: f64,
    pub attack_ms: f64,
    pub release_ms: f64,
    pub makeup_db: f64,
    /// 0 = trocken (bitgleich), 1 = voll komprimiert; dazwischen Parallelkompression
    pub mix: f64,
    /// Hochpass 2. Ordnung im Detektor (Sidechain-Filter), Hz; 0 = aus. Der Bass löst dann weniger Absenkung aus.
    pub sc_hochpass_hz: f64,
}

impl Default for Einstellung {
    fn default() -> Self {
        Einstellung { schwelle_db: -18.0, ratio: 4.0, knie_db: 6.0, attack_ms: 10.0, release_ms: 120.0, makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 }
    }
}

pub struct Komp {
    fs: f64,
    e: Einstellung,
    a_att: f64,
    a_rel: f64,
    y1: f64,
    yl: f64,
    // Detektor-Hochpass: TPT-SVF (Zavalishin) je Kanal des Detektorsignals, Güte 1/√2
    hp_g: f64,
    hp_a: f64,
    hp_an: bool,
    hp_z: [[f64; 2]; 2],
}

/// Untergrenze des Pegels (−120 dBFS): Stille erzeugt keine unendliche Absenkung
const PEGEL_MIN: f64 = 1e-6;

impl Komp {
    pub fn neu(fs: f64) -> Self {
        let mut k = Komp { fs, e: Einstellung::default(), a_att: 0.0, a_rel: 0.0, y1: 0.0, yl: 0.0, hp_g: 0.0, hp_a: 1.0, hp_an: false, hp_z: [[0.0; 2]; 2] };
        k.setze(&Einstellung::default());
        k
    }

    /// Echtzeitfest. Zeitkonstanten: α = exp(−1/(τ·fs)) (Gl. 7), Ratio mindestens 1.
    pub fn setze(&mut self, e: &Einstellung) {
        let mut e = *e;
        e.ratio = e.ratio.max(1.0);
        e.knie_db = e.knie_db.max(0.0);
        e.mix = e.mix.clamp(0.0, 1.0);
        self.e = e;
        self.a_att = (-1.0 / (e.attack_ms.max(0.01) * 1e-3 * self.fs)).exp();
        self.a_rel = (-1.0 / (e.release_ms.max(0.1) * 1e-3 * self.fs)).exp();
        self.hp_an = e.sc_hochpass_hz > 0.0;
        if self.hp_an {
            let fc = e.sc_hochpass_hz.min(0.45 * self.fs);
            self.hp_g = (std::f64::consts::PI * fc / self.fs).tan();
            self.hp_a = 1.0 / (1.0 + self.hp_g * (self.hp_g + std::f64::consts::SQRT_2));
        }
    }

    /// Hochpass-Ausgang für Kanal c des Detektorsignals (ein Schritt des TPT-SVF)
    fn hochpass(&mut self, c: usize, x: f64) -> f64 {
        let [ic1, ic2] = &mut self.hp_z[c];
        let v1 = (*ic1 + self.hp_g * (x - *ic2)) * self.hp_a;
        let v2 = *ic2 + self.hp_g * v1;
        *ic1 = 2.0 * v1 - *ic1;
        *ic2 = 2.0 * v2 - *ic2;
        x - std::f64::consts::SQRT_2 * v1 - v2
    }

    pub fn leeren(&mut self) {
        self.y1 = 0.0;
        self.yl = 0.0;
        self.hp_z = [[0.0; 2]; 2];
    }

    /// Absenkung in dB (≥ 0) nach dem letzten Sample, für die Anzeige.
    pub fn gr_db(&self) -> f64 {
        self.yl
    }

    /// In place auf L und R (gleich lang). `kette`: externer Sidechain (L, R), gleich lang; None = das Signal selbst.
    /// Stereo verkoppelt über max(|L|, |R|). Allokiert nicht.
    pub fn block(&mut self, l: &mut [f32], r: &mut [f32], kette: Option<(&[f32], &[f32])>) {
        let e = self.e;
        if e.mix <= 0.0 {
            return;
        }
        let n = l.len().min(r.len());
        for i in 0..n {
            let (dl, dr) = match kette {
                Some((a, b)) => (a[i] as f64, b[i] as f64),
                None => (l[i] as f64, r[i] as f64),
            };
            let pegel = if self.hp_an { self.hochpass(0, dl).abs().max(self.hochpass(1, dr).abs()) } else { dl.abs().max(dr.abs()) };
            // NaN/Inf im Pegel: wie Stille behandeln, sonst wird x_L = inf − inf = NaN und bleibt im Detektor stehen
            let pegel = if pegel.is_finite() { pegel } else { 0.0 };
            let x_g = 20.0 * pegel.max(PEGEL_MIN).log10();
            let x_l = x_g - gain_computer(x_g, e.schwelle_db, e.ratio, e.knie_db);
            // Gl. 17: Release-Zweig hält die Spitze, der Attack-Zweig glättet ihn
            self.y1 = x_l.max(self.a_rel * self.y1 + (1.0 - self.a_rel) * x_l);
            self.yl = self.a_att * self.yl + (1.0 - self.a_att) * self.y1;
            let g = 10f64.powf((e.makeup_db - self.yl) / 20.0);
            let w = e.mix * g + (1.0 - e.mix);
            l[i] = (l[i] as f64 * w) as f32;
            r[i] = (r[i] as f64 * w) as f32;
        }
    }
}
