//! Chorus nach dem Vorbild des Juno-60 (BBD-Chorus, Slice 2b): eine Verzögerungsleitung, zwei Abgriffe, deren
//! Verzögerung ein gemeinsames Dreieck gegenläufig moduliert. Links = trocken + nass(A), rechts = trocken + nass(B).
//! Werte (Modus I 0,513 Hz, II 0,863 Hz, I+II 9,75 Hz; Verzögerung 1,66–5,35 ms bzw. 3,3–3,7 ms) aus der
//! Nachbau-Literatur, nicht am Service Manual gegengeprüft (Plan Slice 2b, D2). Der nasse Weg geht durch einen Tiefpass
//! 2. Ordnung bei 9 kHz, wie die Filter um die Eimerkette. Lesen mit kubischer Lagrange-Interpolation (Spec E14).
//!
//! Der Chorus rechnet auf der Summe der Stimmen (Summenpunkt, D1): eine Leitung statt einer je Stimme. Er ist linear
//! und zeitvariant nur über das gemeinsame Dreieck, deshalb klingt das wie ein Chorus je Stimme mit gemeinsamem LFO.
use crate::svf::Stufe;

/// (Rate Hz, kleinste und größte Verzögerung ms) je Modus 1, 2, 3 (= I+II)
pub const MODI: [(f64, f64, f64); 3] = [(0.513, 1.66, 5.35), (0.863, 1.66, 5.35), (9.75, 3.3, 3.7)];
const BBD_HZ: f64 = 9_000.0;

pub struct Chorus {
    buf: Vec<f32>,
    maske: usize,
    pos: usize,
    phase: f64,
    rate: f64,
    min: f64,
    tiefe: f64,
    an: bool,
    g: f64,
    tp: [Stufe; 2],
}

/// Wert `verz` Samples vor `buf[pos]`, kubische Lagrange-Interpolation über vier Nachbarn (Spec E14). `verz` ≥ 1;
/// genutzt von `Chorus` und `echo::Echo`.
pub fn lagrange4(buf: &[f32], maske: usize, pos: usize, verz: f64) -> f32 {
    let ganz = verz.floor();
    let d = verz - ganz + 1.0; // Lage zwischen x0..x3 mit x1 bei d = 1
    let i = pos.wrapping_sub(ganz as usize).wrapping_add(1);
    let x = |k: usize| buf[i.wrapping_sub(k) & maske] as f64;
    let (x0, x1, x2, x3) = (x(0), x(1), x(2), x(3));
    let w0 = -(d - 1.0) * (d - 2.0) * (d - 3.0) / 6.0;
    let w1 = d * (d - 2.0) * (d - 3.0) / 2.0;
    let w2 = -d * (d - 1.0) * (d - 3.0) / 2.0;
    let w3 = d * (d - 1.0) * (d - 2.0) / 6.0;
    (w0 * x0 + w1 * x1 + w2 * x2 + w3 * x3) as f32
}

impl Chorus {
    /// `modus` 0 = aus (beide Seiten trocken), 1, 2, 3. Der Puffer wird hier angefordert, nie im Lauf.
    pub fn neu(modus: u8, sr: f32) -> Self {
        let sr = sr as f64;
        let (rate, lo, hi) = MODI[(modus.clamp(1, 3) - 1) as usize];
        let laenge = ((hi * 1e-3 * sr) as usize + 8).next_power_of_two();
        Chorus {
            buf: vec![0.0; laenge],
            maske: laenge - 1,
            pos: 0,
            phase: 0.0,
            rate: rate / sr,
            min: lo * 1e-3 * sr,
            tiefe: (hi - lo) * 1e-3 * sr,
            an: modus != 0,
            // Grenzfrequenz wie in svf.rs auf 0,45·sr geklemmt: bei sr 16 kHz läge 9 kHz über Nyquist·0,5 und der
            // Tiefpass liefe weg (gemessen im Review)
            g: (std::f64::consts::PI * BBD_HZ.min(0.45 * sr) / sr).tan(),
            tp: [Stufe::default(); 2],
        }
    }

    /// Verzögerung beider Abgriffe in Samples (A, B) beim aktuellen Stand des Dreiecks
    pub fn verzoegerung(&self) -> (f64, f64) {
        let d = 1.0 - (2.0 * self.phase - 1.0).abs(); // Dreieck 0..1..0
        (self.min + self.tiefe * d, self.min + self.tiefe * (1.0 - d))
    }

    /// Wert `verz` Samples vor dem zuletzt geschriebenen, kubische Lagrange-Interpolation über vier Nachbarn
    pub fn lies(&self, verz: f64) -> f32 {
        lagrange4(&self.buf, self.maske, self.pos, verz)
    }

    /// Ein Sample: (links, rechts) = x + mix·nass. `mix` 0 gibt beide Seiten trocken.
    #[inline]
    pub fn prozess(&mut self, x: f32, mix: f32) -> (f32, f32) {
        self.pos = (self.pos + 1) & self.maske;
        self.buf[self.pos] = x;
        if !self.an {
            return (x, x);
        }
        let (a, b) = self.verzoegerung();
        let (na, nb) = (self.lies(a) as f64, self.lies(b) as f64);
        let na = self.tp[0].prozess(na, self.g, std::f64::consts::SQRT_2).0 as f32;
        let nb = self.tp[1].prozess(nb, self.g, std::f64::consts::SQRT_2).0 as f32;
        self.phase += self.rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        (x + mix * na, x + mix * nb)
    }

    pub fn zuruecksetzen(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
        self.pos = 0;
        self.phase = 0.0;
        self.tp = [Stufe::default(); 2];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lagrange_trifft_einen_hohen_sinus_zwischen_den_samples() {
        // 6 kHz bei 48 kHz, halbes Sample versetzt: linear interpoliert verliert 0,7 dB, kubisch unter 0,05 dB
        let mut c = Chorus::neu(1, 48_000.0);
        let w = 2.0 * std::f64::consts::PI * 6_000.0 / 48_000.0;
        let mut fehler: f64 = 0.0;
        for n in 0..400 {
            c.pos = (c.pos + 1) & c.maske;
            c.buf[c.pos] = (w * n as f64).sin() as f32;
            if n > 20 {
                let soll = (w * (n as f64 - 10.5)).sin();
                fehler = fehler.max((c.lies(10.5) as f64 - soll).abs());
            }
        }
        assert!(fehler < 0.01, "größter Fehler {fehler}");
    }

    #[test]
    fn dreieck_laeuft_mit_der_rate_des_modus_gegenlaeufig_im_bereich() {
        for (modus, (rate, lo, hi)) in MODI.iter().enumerate() {
            let mut c = Chorus::neu(modus as u8 + 1, 48_000.0);
            let periode = (48_000.0 / rate).round() as usize;
            let (mut kl, mut gr): (f64, f64) = (f64::MAX, 0.0);
            let start = c.verzoegerung();
            for i in 0..periode {
                if i == periode / 2 {
                    // nach einer halben Periode steht das Dreieck oben: so fällt auch eine falsche Rate auf, die nach
                    // einer ganzen Periode zufällig wieder am Anfang stünde
                    assert!((c.verzoegerung().0 - hi * 48.0).abs() < 0.5, "Modus {}: Mitte {}", modus + 1, c.verzoegerung().0);
                }
                let (a, b) = c.verzoegerung();
                assert!((a + b - (lo + hi) * 48.0).abs() < 1e-6, "A und B laufen gegenläufig");
                kl = kl.min(a);
                gr = gr.max(a);
                c.prozess(0.0, 1.0);
            }
            assert!((kl - lo * 48.0).abs() < 0.5 && (gr - hi * 48.0).abs() < 0.5, "Modus {}: {kl}..{gr}", modus + 1);
            let ende = c.verzoegerung();
            assert!((ende.0 - start.0).abs() < 0.2, "nach einer Periode wieder am Anfang: {} gegen {}", ende.0, start.0);
        }
    }

    #[test]
    fn aus_und_mix_null_sind_trocken() {
        let mut aus = Chorus::neu(0, 48_000.0);
        let mut null = Chorus::neu(2, 48_000.0);
        for n in 0..2000 {
            let x = ((n * 7919) % 101) as f32 / 50.0 - 1.0;
            assert_eq!(aus.prozess(x, 1.0), (x, x));
            assert_eq!(null.prozess(x, 0.0), (x, x));
        }
    }

    #[test]
    fn nasser_weg_ist_tiefpass() {
        // 16 kHz rein: der nasse Anteil (links − trocken) bleibt unter einem Viertel, 500 Hz kommt fast ganz durch
        // beide Seiten: jeder Abgriff hat seinen eigenen Tiefpass
        let pegel = |hz: f64| {
            let mut c = Chorus::neu(1, 48_000.0);
            let w = 2.0 * std::f64::consts::PI * hz / 48_000.0;
            let mut m = (0.0f32, 0.0f32);
            for n in 0..48_000 {
                let x = (w * n as f64).sin() as f32;
                let (l, r) = c.prozess(x, 1.0);
                if n > 24_000 {
                    m = (m.0.max((l - x).abs()), m.1.max((r - x).abs()));
                }
            }
            m
        };
        let (hoch, tief) = (pegel(16_000.0), pegel(500.0));
        assert!(hoch.0 < 0.25 && hoch.1 < 0.25, "16 kHz nass {hoch:?}");
        assert!(tief.0 > 0.9 && tief.1 > 0.9, "500 Hz nass {tief:?}");
    }

    #[test]
    fn juno_werte_sind_gepinnt() {
        // D2: Werte aus der Nachbau-Literatur; ein Test, der MODI nur aus MODI liest, sähe eine Änderung nicht
        assert_eq!(MODI, [(0.513, 1.66, 5.35), (0.863, 1.66, 5.35), (9.75, 3.3, 3.7)]);
    }

    #[test]
    fn puffer_reicht_bis_zur_groessten_verzoegerung() {
        // ein Impuls, genau so viele Samples zurück wie an der Spitze des Dreiecks, wird wiedergefunden
        for (modus, (_, _, hi)) in MODI.iter().enumerate() {
            let mut c = Chorus::neu(modus as u8 + 1, 48_000.0);
            let d = (hi * 48.0).ceil() as usize;
            c.pos = (c.pos + 1) & c.maske;
            c.buf[c.pos] = 1.0;
            for _ in 0..d {
                // wie `prozess`: jedes neue Sample überschreibt den ältesten Platz, Stille nach dem Impuls
                c.pos = (c.pos + 1) & c.maske;
                c.buf[c.pos] = 0.0;
            }
            assert!((c.lies(d as f64) - 1.0).abs() < 1e-6, "Modus {}: Impuls {d} Samples zurück: {}", modus + 1, c.lies(d as f64));
            assert!(c.lies(d as f64 - 1.0).abs() < 1e-6 && c.lies(d as f64 + 1.0).abs() < 1e-6, "Modus {}: Nachbarn leer", modus + 1);
        }
    }

    #[test]
    fn niedrige_abtastrate_bleibt_endlich() {
        // der Tiefpass bei 9 kHz liegt bei 16 kHz Abtastrate über 0,45·sr; ohne Klemme (wie in svf.rs) läuft er weg
        for sr in [16_000.0f32, 17_000.0] {
            let mut c = Chorus::neu(1, sr);
            let mut z: u32 = 12345;
            let mut m = 0.0f32;
            for n in 0..sr as usize {
                z = z.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let x = (z >> 8) as f32 / 8_388_608.0 - 1.0 + (n as f32 * 0.3).sin();
                let (l, r) = c.prozess(x, 1.0);
                assert!(l.is_finite() && r.is_finite(), "sr {sr}, Sample {n}");
                m = m.max(l.abs()).max(r.abs());
            }
            assert!(m < 10.0, "sr {sr}: Spitze {m}");
        }
    }
}
