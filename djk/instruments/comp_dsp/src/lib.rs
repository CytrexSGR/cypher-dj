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

/// Glue steps (D3): ratio, attack in ms, release in ms
const GLUE_RATIO: [f64; 4] = [1.5, 2.0, 4.0, 10.0];
const GLUE_ATTACK_MS: [f64; 6] = [0.1, 0.3, 1.0, 3.0, 10.0, 30.0];
const GLUE_RELEASE_MS: [f64; 5] = [100.0, 200.0, 400.0, 800.0, 1200.0];
/// Auto release (D4): fast branch time constant and slow branch time constant in seconds
const AUTO_SCHNELL_S: f64 = 0.1;
const AUTO_LANGSAM_S: f64 = 1.2;

/// Nearest step in the log domain; a tie goes to the lower step.
fn naechste_stufe(v: f64, stufen: &[f64]) -> f64 {
    let lv = v.max(1e-9).ln();
    let mut best = stufen[0];
    let mut best_d = (lv - best.ln()).abs();
    for &s in &stufen[1..] {
        let d = (lv - s.ln()).abs();
        if d < best_d - 1e-12 {
            best = s;
            best_d = d;
        }
    }
    best
}

pub struct Komp {
    fs: f64,
    /// effective settings (stepped when glue is on)
    e: Einstellung,
    /// settings as last given to `setze`
    roh: Einstellung,
    glue: bool,
    auto_rel: bool,
    y_f: f64,
    y_s: f64,
    a_s: f64,
    a_rel_fast: f64,
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
        let mut k = Komp { fs, e: Einstellung::default(), roh: Einstellung::default(), glue: false, auto_rel: false, y_f: 0.0, y_s: 0.0, a_s: (-1.0 / (AUTO_LANGSAM_S * fs)).exp(), a_rel_fast: (-1.0 / (AUTO_SCHNELL_S * fs)).exp(), a_att: 0.0, a_rel: 0.0, y1: 0.0, yl: 0.0, hp_g: 0.0, hp_a: 1.0, hp_an: false, hp_z: [[0.0; 2]; 2] };
        k.setze(&Einstellung::default());
        k
    }

    /// Echtzeitfest. Zeitkonstanten: α = exp(−1/(τ·fs)) (Gl. 7), Ratio mindestens 1.
    pub fn setze(&mut self, e: &Einstellung) {
        self.roh = *e;
        self.uebernehmen();
    }

    /// Glue character (stepped ratio, attack, release, D3) and auto release (D4). Real-time safe; the stepping runs here,
    /// not per sample. Takes effect with the settings last given to `setze`.
    pub fn setze_charakter(&mut self, glue: bool, auto_release: bool) {
        self.glue = glue;
        self.auto_rel = auto_release;
        self.uebernehmen();
    }

    /// Effective ratio, attack (ms) and release (ms); release is 0.0 while auto release is on.
    pub fn wirksam(&self) -> (f64, f64, f64) {
        (self.e.ratio, self.e.attack_ms, if self.auto_rel { 0.0 } else { self.e.release_ms })
    }

    fn uebernehmen(&mut self) {
        let mut e = self.roh;
        e.ratio = e.ratio.max(1.0);
        e.knie_db = e.knie_db.max(0.0);
        e.mix = e.mix.clamp(0.0, 1.0);
        if self.glue {
            e.ratio = naechste_stufe(e.ratio, &GLUE_RATIO);
            e.attack_ms = naechste_stufe(e.attack_ms, &GLUE_ATTACK_MS);
            e.release_ms = naechste_stufe(e.release_ms, &GLUE_RELEASE_MS);
        }
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
        self.y_f = 0.0;
        self.y_s = 0.0;
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
            if self.auto_rel {
                // D4: fast peak-hold branch (100 ms) and slow one-pole (1.2 s); the larger one wins
                self.y_f = x_l.max(self.a_rel_fast * self.y_f + (1.0 - self.a_rel_fast) * x_l);
                self.y_s = self.a_s * self.y_s + (1.0 - self.a_s) * x_l;
                self.y1 = self.y_f.max(self.y_s);
            } else {
                self.y1 = x_l.max(self.a_rel * self.y1 + (1.0 - self.a_rel) * x_l);
            }
            self.yl = self.a_att * self.yl + (1.0 - self.a_att) * self.y1;
            let g = 10f64.powf((e.makeup_db - self.yl) / 20.0);
            let w = e.mix * g + (1.0 - e.mix);
            l[i] = (l[i] as f64 * w) as f32;
            r[i] = (r[i] as f64 * w) as f32;
        }
    }
}
