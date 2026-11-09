//! Echo (Slice 4b): zwei Verzögerungsleitungen (links, rechts) mit Rückkopplung, Tiefpass im Rückweg und Ping-Pong.
//! Feste Zeit liest mit Thiran-Allpass 1. Ordnung (exakt allpass, stabil für Δ > N − 1, hier Δ ∈ [0,5, 1,5)),
//! modulierte Zeit mit kubischer Lagrange-Interpolation hinter einem EinPol-Glätter (Spec E14; Plan Slice 4b D4).
//! Ausgang = trocken + mix·nass. Puffer werden in `neu` angefordert, nie im Lauf.
use crate::chorus::lagrange4;

/// kürzeste Verzögerung in ms (Lagrange braucht T ≥ 2 Samples, Thiran N ≥ 1)
pub const MIN_MS: f32 = 1.0;
/// größte Rückkopplung; darüber wird im Lauf geklemmt (D6)
pub const FB_MAX: f32 = 0.98;
/// kleiner als das geht als 0 in die Leitung (D9)
const NULL: f32 = 1e-30;

/// Thiran 1. Ordnung für `t` Samples: ganzzahliger Teil N und Koeffizient a, mit t = N + Δ, Δ ∈ [0,5, 1,5)
pub fn thiran(t: f64) -> (usize, f64) {
    let n = (t - 0.5).floor();
    let delta = t - n;
    (n as usize, (1.0 - delta) / (1.0 + delta))
}

pub struct Echo {
    buf: [Vec<f32>; 2],
    maske: usize,
    pos: usize,
    /// Samples je ms
    je_ms: f32,
    max_ms: f32,
    /// Some((N, a)) bei fester Zeit
    fest: Option<(usize, f64)>,
    /// Thiran-Zustand je Seite: (x[n−1], y[n−1])
    ap: [(f64, f64); 2],
    /// geglättete Verzögerung in Samples (moduliert), in f64: in f32 bliebe der EinPol vor dem Ziel stehen (Plan-Review:
    /// 0,1–0,2 ms bei glatt 100); `erst` setzt sie beim ersten Sample auf das Ziel
    zeit: f64,
    erst: bool,
    k_glatt: f64,
    /// EinPol im Rückweg, 1 = aus
    k_tp: f32,
    tp: [f32; 2],
    pingpong: bool,
}

impl Echo {
    /// `fest_ms` Some: Thiran mit dieser Zeit, `prozess` ignoriert dann `zeit_ms`. `glatt_ms` 0 = ungeglättet,
    /// `daempf_hz` 0 = ohne Tiefpass.
    pub fn neu(sr: f32, max_ms: f32, fest_ms: Option<f32>, glatt_ms: f32, daempf_hz: f32, pingpong: bool) -> Self {
        let je_ms = sr / 1000.0;
        let laenge = ((max_ms * je_ms) as usize + 8).next_power_of_two();
        let fest = fest_ms.map(|ms| thiran((ms.clamp(MIN_MS, max_ms) * je_ms) as f64));
        let k_glatt = if glatt_ms > 0.0 { 1.0 - (-1.0 / (glatt_ms as f64 * je_ms as f64)).exp() } else { 1.0 };
        let k_tp = if daempf_hz > 0.0 { 1.0 - (-2.0 * std::f32::consts::PI * daempf_hz.min(0.45 * sr) / sr).exp() } else { 1.0 };
        Echo { buf: [vec![0.0; laenge], vec![0.0; laenge]], maske: laenge - 1, pos: 0, je_ms, max_ms, fest, ap: [(0.0, 0.0); 2],
               zeit: 0.0, erst: true, k_glatt, k_tp, tp: [0.0; 2], pingpong }
    }

    /// Thiran auf Seite `s`: liest w[n − N] (vor dem Schreiben steht w[n − 1] bei `pos`)
    fn thiran_lies(&mut self, s: usize, n: usize, a: f64) -> f32 {
        let x = self.buf[s][self.pos.wrapping_sub(n - 1) & self.maske] as f64;
        let (x1, y1) = self.ap[s];
        let y = a * x + x1 - a * y1;
        self.ap[s] = (x, y);
        y as f32
    }

    /// Ein Sample: (links, rechts) = trocken + mix·nass
    #[inline]
    pub fn prozess(&mut self, l: f32, r: f32, zeit_ms: f32, fb: f32, mix: f32) -> (f32, f32) {
        // NaN vergiftet sonst Zeit und Leitung dauerhaft: Zeit NaN gilt als `max`, fb NaN als 0
        let zeit_ms = if zeit_ms.is_nan() { self.max_ms } else { zeit_ms };
        let fb = if fb.is_nan() { 0.0 } else { fb.clamp(0.0, FB_MAX) };
        let (yl, yr) = match self.fest {
            Some((n, a)) => (self.thiran_lies(0, n, a), self.thiran_lies(1, n, a)),
            None => {
                let ziel = (zeit_ms.clamp(MIN_MS, self.max_ms) * self.je_ms) as f64;
                if self.erst {
                    self.zeit = ziel;
                    self.erst = false;
                } else {
                    self.zeit += self.k_glatt * (ziel - self.zeit);
                }
                let v = self.zeit - 1.0; // w[n − T] liegt T − 1 vor dem zuletzt geschriebenen w[n − 1]
                (lagrange4(&self.buf[0], self.maske, self.pos, v), lagrange4(&self.buf[1], self.maske, self.pos, v))
            }
        };
        let null = |v: f32| if v.abs() < NULL { 0.0 } else { v };
        let (yl, yr) = (null(yl), null(yr));
        self.tp[0] = null(self.tp[0] + self.k_tp * (yl - self.tp[0]));
        self.tp[1] = null(self.tp[1] + self.k_tp * (yr - self.tp[1]));
        let (rl, rr) = (fb * self.tp[0], fb * self.tp[1]);
        let (wl, wr) = if self.pingpong { ((l + r) * 0.5 + rr, rl) } else { (l + rl, r + rr) };
        self.pos = (self.pos + 1) & self.maske;
        self.buf[0][self.pos] = null(wl);
        self.buf[1][self.pos] = null(wr);
        (l + mix * yl, r + mix * yr)
    }

    /// Für Tests: ist ein innerer Zustand (Tiefpass, Thiran) denormal? Denormale ändern keinen Ausgabewert, nur die
    /// Rechenzeit (Plan Slice 4b D9).
    pub fn zustand_denormal(&self) -> bool {
        self.tp.iter().any(|v| *v != 0.0 && v.abs() < f32::MIN_POSITIVE)
            || self.ap.iter().any(|(x, y)| (*x != 0.0 && x.abs() < f64::MIN_POSITIVE) || (*y != 0.0 && y.abs() < f64::MIN_POSITIVE))
    }

    pub fn zuruecksetzen(&mut self) {
        self.buf.iter_mut().for_each(|b| b.iter_mut().for_each(|v| *v = 0.0));
        self.pos = 0;
        self.ap = [(0.0, 0.0); 2];
        self.zeit = 0.0;
        self.erst = true;
        self.tp = [0.0; 2];
    }
}
