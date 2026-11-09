//! Limiter (Slice 4c, D1): Min-Hold der rohen Verstärkung über N Samples, dann ein Release-Glätter, der nur das
//! Wiederansteigen bremst, dann ein gleitendes Mittel über dieselben N Samples; das Signal läuft N − 1 Samples
//! verzögert. Jede Verstärkung im Mittelungsfenster ist damit höchstens die, die das verzögerte Sample braucht: die
//! Spitze bleibt unter der Decke, ohne Überschwinger (Probe limiter_probe.py: 0,31623 gegen 0,8205 beim reinen
//! Delay-Limiter). Stereo gekoppelt über max(|L|, |R|). Puffer werden in `neu` angefordert, nie im Lauf.

/// Vorlauf in Samples für `ms` Millisekunden, mindestens 1
pub fn vorlauf(ms: f32, sr: f32) -> usize {
    ((ms * sr / 1000.0).round() as usize).max(1)
}

pub struct Limiter {
    decke: f32,
    k_rel: f64,
    /// Ringe der Länge N: rohe Verstärkung, geglättete Verstärkung, Eingang links und rechts
    g: Vec<f32>,
    h: Vec<f64>,
    xl: Vec<f32>,
    xr: Vec<f32>,
    pos: usize,
    /// Summe über `h`
    summe: f64,
    /// Zustand des Release-Glätters
    rel: f64,
}

impl Limiter {
    /// `decke_db` Spitze am Ausgang in dBFS, `n` Vorlauf in Samples (mindestens 1), `release_ms` Zeitkonstante des
    /// Wiederansteigens
    pub fn neu(decke_db: f32, n: usize, release_ms: f32, sr: f32) -> Self {
        let n = n.max(1);
        let k_rel = 1.0 - (-1.0 / (release_ms.max(0.01) as f64 * sr as f64 / 1000.0)).exp();
        Limiter { decke: 10f32.powf(decke_db / 20.0), k_rel, g: vec![1.0; n], h: vec![1.0; n], xl: vec![0.0; n], xr: vec![0.0; n],
                  pos: 0, summe: n as f64, rel: 1.0 }
    }

    /// Verzögerung des Signals in Samples
    pub fn latenz(&self) -> usize {
        self.g.len() - 1
    }

    /// Ein Sample: (links, rechts) von vor N − 1 Samples, mit der geglätteten Verstärkung
    #[inline]
    pub fn prozess(&mut self, l: f32, r: f32) -> (f32, f32) {
        let n = self.g.len();
        let p = l.abs().max(r.abs());
        self.pos = (self.pos + 1) % n;
        self.g[self.pos] = if p > self.decke { self.decke / p } else { 1.0 };
        self.xl[self.pos] = l;
        self.xr[self.pos] = r;
        let gm = self.g.iter().fold(1.0f32, |m, &v| m.min(v)) as f64;
        // abwärts folgt `rel` dem Min-Hold sofort, aufwärts mit der Release-Zeit
        self.rel = gm.min(self.rel + self.k_rel * (gm - self.rel));
        self.summe += self.rel - self.h[self.pos];
        self.h[self.pos] = self.rel;
        let alt = (self.pos + 1) % n; // N − 1 Samples vor dem gerade geschriebenen
        let v = (self.summe / n as f64) as f32;
        (v * self.xl[alt], v * self.xr[alt])
    }

    pub fn zuruecksetzen(&mut self) {
        self.g.iter_mut().for_each(|v| *v = 1.0);
        self.h.iter_mut().for_each(|v| *v = 1.0);
        self.xl.iter_mut().for_each(|v| *v = 0.0);
        self.xr.iter_mut().for_each(|v| *v = 0.0);
        self.pos = 0;
        self.summe = self.h.len() as f64;
        self.rel = 1.0;
    }
}
