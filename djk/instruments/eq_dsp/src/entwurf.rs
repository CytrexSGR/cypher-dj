//! Filterentwurf: analoge Prototypen zweiter Ordnung → digitales Biquad → SVF-Koeffizienten.
//!
//! Drei Entwürfe stehen nebeneinander, gemessen in `examples/matrix.rs`:
//! - `bilinear`: die Lehrbuchformel (RBJ-Cookbook, Vorverzerrung auf f0). So rechnen die meisten
//!   einfachen EQs, auch Ardours a-eq. Trifft f0 exakt, staucht aber alles darüber zur
//!   Nyquist-Grenze hin zusammen (Cramping). Negativkontrolle der Tests.
//! - `vicanek`: Pole impulsinvariant, Zähler an drei Punkten (0 Hz, f0, Nyquist) angepasst, nach
//!   M. Vicanek, „Matched Second Order Digital Filters“ (2016). Gut für Glocken, schwach bei
//!   Shelves und Hochpass. Vergleichsentwurf.
//! - `passend` (Betrieb): Pole impulsinvariant, Gleichanteil exakt, die übrigen zwei Freiheitsgrade
//!   des Betrags per Least-Squares über ein logarithmisches Raster (relativer Fehler). Zusammen
//!   mit doppelter interner Abtastrate ≤ 0,35 dB Abweichung bis 20 kHz für alle Arten (gemessen).

use std::f64::consts::PI;

/// Analoger Prototyp H(s) = (n2 s² + n1 s + n0) / (d2 s² + d1 s + d0), s normiert auf f0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Analog {
    pub n: [f64; 3], // [n2, n1, n0]
    pub d: [f64; 3], // [d2, d1, d0]
}

impl Analog {
    /// |H(jx)|² bei x = f / f0.
    pub fn betrag2(&self, x: f64) -> f64 {
        let qu = |c: &[f64; 3]| {
            let re = c[2] - c[0] * x * x;
            let im = c[1] * x;
            re * re + im * im
        };
        qu(&self.n) / qu(&self.d)
    }

    pub fn betrag_db(&self, x: f64) -> f64 {
        10.0 * self.betrag2(x).log10()
    }

    fn kehrwert(&self) -> Analog {
        Analog { n: self.d, d: self.n }
    }

    /// Normierte Polfrequenz und Dämpfung des Nenners.
    fn pol(&self) -> (f64, f64) {
        let [d2, d1, d0] = self.d;
        ((d0 / d2).sqrt(), d1 / (2.0 * (d0 * d2).sqrt()))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Art {
    Glocke,
    LowShelf,
    HighShelf,
    Tiefpass,
    Hochpass,
    Kerbe,
    Bandpass,
}

/// Analoger Prototyp nach dem RBJ-Cookbook (analoge Formen). `a = 10^(gain_db/40)`.
pub fn prototyp(art: Art, gain_db: f64, q: f64) -> Analog {
    let a = 10f64.powf(gain_db / 40.0);
    let sa = a.sqrt();
    match art {
        Art::Glocke => Analog { n: [1.0, a / q, 1.0], d: [1.0, 1.0 / (a * q), 1.0] },
        Art::LowShelf => Analog { n: [a, a * sa / q, a * a], d: [a, sa / q, 1.0] },
        Art::HighShelf => Analog { n: [a * a, a * sa / q, a], d: [1.0, sa / q, a] },
        Art::Tiefpass => Analog { n: [0.0, 0.0, 1.0], d: [1.0, 1.0 / q, 1.0] },
        Art::Hochpass => Analog { n: [1.0, 0.0, 0.0], d: [1.0, 1.0 / q, 1.0] },
        Art::Kerbe => Analog { n: [1.0, 0.0, 1.0], d: [1.0, 1.0 / q, 1.0] },
        Art::Bandpass => Analog { n: [0.0, 1.0 / q, 0.0], d: [1.0, 1.0 / q, 1.0] },
    }
}

/// Digitales Biquad, a0 = 1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Biquad {
    pub b: [f64; 3],
    pub a: [f64; 2], // [a1, a2]
}

impl Biquad {
    /// |H(e^jw)| in dB bei Frequenz f.
    pub fn betrag_db(&self, f: f64, fs: f64) -> f64 {
        let w = 2.0 * PI * f / fs;
        let (c1, s1, c2, s2) = (w.cos(), -w.sin(), (2.0 * w).cos(), -(2.0 * w).sin());
        let (nr, ni) = (self.b[0] + self.b[1] * c1 + self.b[2] * c2, self.b[1] * s1 + self.b[2] * s2);
        let (dr, di) = (1.0 + self.a[0] * c1 + self.a[1] * c2, self.a[0] * s1 + self.a[1] * s2);
        10.0 * ((nr * nr + ni * ni) / (dr * dr + di * di)).log10()
    }

    /// Stabil, endlich, und als SVF realisierbar (g > 0, k > 0).
    pub fn gueltig(&self) -> bool {
        let [a1, a2] = self.a;
        let endlich = self.b.iter().chain(self.a.iter()).all(|v| v.is_finite());
        let stabil = a2.abs() < 1.0 - 1e-12 && a1.abs() < 1.0 + a2 - 1e-12;
        endlich && stabil && {
            let c = als_svf(self);
            [c.g, c.k, c.m0, c.m1, c.m2].iter().all(|v| v.is_finite()) && c.g > 0.0 && c.k > 0.0
        }
    }

    fn kehrwert(&self) -> Biquad {
        let b0 = self.b[0];
        Biquad { b: [1.0 / b0, self.a[0] / b0, self.a[1] / b0], a: [self.b[1] / b0, self.b[2] / b0] }
    }
}

/// Lehrbuch-Entwurf: bilineare Transformation, vorverzerrt auf f0.
pub fn bilinear(an: &Analog, f0: f64, fs: f64) -> Biquad {
    let k = (PI * f0 / fs).tan();
    let [n2, n1, n0] = an.n;
    let [d2, d1, d0] = an.d;
    let kk = k * k;
    let a0 = d2 + d1 * k + d0 * kk;
    Biquad {
        b: [(n2 + n1 * k + n0 * kk) / a0, 2.0 * (n0 * kk - n2) / a0, (n2 - n1 * k + n0 * kk) / a0],
        a: [2.0 * (d0 * kk - d2) / a0, (d2 - d1 * k + d0 * kk) / a0],
    }
}

/// Höchste Entwurfsfrequenz relativ zu fs. Darüber kippt die Impulsinvarianz der Pole.
pub const F0_MAX_REL: f64 = 0.47;

/// Vicanek-Entwurf. Liegen die Pole des Prototyps über f0 (High-Shelf-Boost, Low-Shelf-Cut),
/// wird der Kehrwert entworfen und digital invertiert: dessen Pole liegen dann unter f0.
pub fn vicanek(an: &Analog, f0: f64, fs: f64) -> Biquad {
    orientiert(an, f0, fs, vicanek_direkt)
}

/// Betriebsentwurf, siehe Modulkopf. Baut das Stützraster jedes Mal neu; im Echtzeitpfad
/// `passend_mit` mit einem vorab gebauten `Raster` nehmen.
pub fn passend(an: &Analog, f0: f64, fs: f64) -> Biquad {
    passend_mit(an, f0, fs, &Raster::neu(fs))
}

pub fn passend_mit(an: &Analog, f0: f64, fs: f64, raster: &Raster) -> Biquad {
    // Jeder Entwurf wird geprüft; scheitert er, gilt der nächstrobuste. Bilinear ist für jeden
    // stabilen Prototyp gültig und bei tiefen Frequenzen ohnehin praktisch exakt.
    let lsq = orientiert(an, f0, fs, |a, f, s| passend_direkt(a, f, s, raster));
    if lsq.gueltig() {
        return lsq;
    }
    let vic = vicanek(an, f0, fs);
    if vic.gueltig() {
        return vic;
    }
    bilinear(an, f0.min(F0_MAX_REL * fs), fs)
}

fn orientiert(an: &Analog, f0: f64, fs: f64, entwurf: impl Fn(&Analog, f64, f64) -> Biquad) -> Biquad {
    let f0 = f0.min(F0_MAX_REL * fs);
    if an.n[0].abs() > 0.0 && an.n[2].abs() > 0.0 && an.n[1].abs() > 0.0 {
        // Umkehrbar (Glocke, Shelves): die Orientierung entwerfen, deren scharfes Merkmal in den
        // Polen liegt (kleinere Dämpfung), bei gleicher Dämpfung die mit der tieferen Polfrequenz.
        // Grund: die Pole werden exakt abgebildet, der Zähler nur an drei Punkten angepasst.
        let ke = an.kehrwert();
        let ((wa, za), (wk, zk)) = (an.pol(), ke.pol());
        let kehr = if (za - zk).abs() > 1e-9 { zk < za } else { wk < wa };
        if kehr {
            return entwurf(&ke, f0, fs).kehrwert();
        }
    }
    entwurf(an, f0, fs)
}

/// Pole impulsinvariant: z = e^(s·T) für die Pole des analogen Nenners.
fn pole(an: &Analog, w0: f64) -> (f64, f64) {
    let (wn, zeta) = an.pol();
    let wp = w0 * wn;
    let r = (-zeta * wp).exp();
    let a1 = if zeta < 1.0 {
        -2.0 * r * (wp * (1.0 - zeta * zeta).sqrt()).cos()
    } else {
        -2.0 * r * (wp * (zeta * zeta - 1.0).sqrt()).cosh()
    };
    (a1, r * r)
}

/// Kerbe: Nullstellen exakt auf dem Einheitskreis bei w0, Gleichanteil 1.
fn kerbe(a1: f64, a2: f64, w0: f64) -> Biquad {
    let c = (1.0 + a1 + a2) / (2.0 - 2.0 * w0.cos());
    Biquad { b: [c, -2.0 * c * w0.cos(), c], a: [a1, a2] }
}

/// Aus den Betragsquadrat-Koeffizienten B0..B2 den minimalphasigen Zähler gewinnen.
fn zaehler(bb0: f64, bb1: f64, bb2: f64) -> [f64; 3] {
    let (r0, r1) = (bb0.max(0.0).sqrt(), bb1.max(0.0).sqrt());
    let w = 0.5 * (r0 + r1);
    let b1 = 0.5 * (r0 - r1);
    let b0 = 0.5 * (w + (w * w + bb2).max(0.0).sqrt());
    [b0, b1, w - b0]
}

/// φ-Basis: |H|² = (B0 φ0 + B1 φ1 + B2 φ2) / (A0 φ0 + A1 φ1 + A2 φ2).
fn phi(w: f64) -> (f64, f64, f64) {
    let p1 = (w / 2.0).sin().powi(2);
    let p0 = 1.0 - p1;
    (p0, p1, 4.0 * p0 * p1)
}

/// Anzahl Stützstellen des Least-Squares-Fits.
const FIT_PUNKTE: usize = 48;

/// Stützraster des Fits: hängt nur von fs ab, nicht von der Einstellung.
#[derive(Clone)]
pub struct Raster {
    f: [f64; FIT_PUNKTE],
    p: [(f64, f64, f64); FIT_PUNKTE],
    gewicht: [f64; FIT_PUNKTE],
}

impl Raster {
    pub fn neu(fs: f64) -> Self {
        let (f_lo, f_hi) = (10.0f64, 0.45 * fs);
        let mut r = Raster { f: [0.0; FIT_PUNKTE], p: [(0.0, 0.0, 0.0); FIT_PUNKTE], gewicht: [0.0; FIT_PUNKTE] };
        for i in 0..FIT_PUNKTE {
            let f = f_lo * (f_hi / f_lo).powf(i as f64 / (FIT_PUNKTE - 1) as f64);
            r.f[i] = f;
            r.p[i] = phi(2.0 * PI * f / fs);
            r.gewicht[i] = if f > 20000.0 { 0.1 } else { 1.0 };
        }
        r
    }
}

/// Zusätzliche Stützstellen um f0, im Abstand der Bandbreite: das globale Raster (≈ 19 % je
/// Schritt) löst schmale Merkmale (Q 18 bei 10 Hz: < 1 Hz breit) nicht auf.
const LOKAL_PUNKTE: usize = 16;

fn passend_direkt(an: &Analog, f0: f64, fs: f64, raster: &Raster) -> Biquad {
    let w0 = 2.0 * PI * f0 / fs;
    let (a1, a2) = pole(an, w0);
    if an.n == [1.0, 0.0, 1.0] {
        return kerbe(a1, a2, w0);
    }
    let (aa0, aa1, aa2) = ((1.0 + a1 + a2).powi(2), (1.0 - a1 + a2).powi(2), -4.0 * a2);
    let bb0 = aa0 * an.betrag2(0.0);
    // Normalgleichungen für (B1, B2): Residuum r = (B0 φ0 + B1 φ1 + B2 φ2) / (T·A) − 1
    let mut s = [0.0f64; 5]; // s11, s12, s22, t1, t2
    let mut punkt = |soll: f64, (p0, p1, p2): (f64, f64, f64), gewicht: f64| {
        if soll < 1e-3 {
            return; // unter −30 dB zählt der relative Fehler nicht
        }
        let nenner = soll * (aa0 * p0 + aa1 * p1 + aa2 * p2);
        let (x1, x2) = (p1 / nenner, p2 / nenner);
        let y = 1.0 - bb0 * p0 / nenner;
        s[0] += gewicht * x1 * x1;
        s[1] += gewicht * x1 * x2;
        s[2] += gewicht * x2 * x2;
        s[3] += gewicht * x1 * y;
        s[4] += gewicht * x2 * y;
    };
    for i in 0..FIT_PUNKTE {
        punkt(an.betrag2(raster.f[i] / f0), raster.p[i], raster.gewicht[i]);
    }
    // Bandbreite in Oktaven aus der Dämpfung des schärferen Teils (Pole oder Nullstellen)
    let zeta = an.pol().1.min(Analog { n: an.d, d: an.n }.pol().1).max(1e-3);
    let oktaven = (2.0 * zeta.asinh() / std::f64::consts::LN_2).clamp(0.02, 2.0);
    for i in 0..LOKAL_PUNKTE {
        let u = -1.5 + 3.0 * i as f64 / (LOKAL_PUNKTE - 1) as f64;
        let f = f0 * (u * oktaven).exp2();
        if f < 1.0 || f > 0.45 * fs {
            continue;
        }
        punkt(an.betrag2(f / f0), phi(2.0 * PI * f / fs), 1.0);
    }
    let det = s[0] * s[2] - s[1] * s[1];
    let bb1 = (s[2] * s[3] - s[1] * s[4]) / det;
    let bb2 = (s[0] * s[4] - s[1] * s[3]) / det;
    Biquad { b: zaehler(bb0, bb1, bb2), a: [a1, a2] }
}

fn vicanek_direkt(an: &Analog, f0: f64, fs: f64) -> Biquad {
    let w0 = 2.0 * PI * f0 / fs;
    let (a1, a2) = pole(an, w0);
    if an.n == [1.0, 0.0, 1.0] {
        return kerbe(a1, a2, w0);
    }

    let aa0 = (1.0 + a1 + a2).powi(2);
    let aa1 = (1.0 - a1 + a2).powi(2);
    let aa2 = -4.0 * a2;
    let (p0, p1, p2) = phi(w0);

    let h_dc = an.betrag2(0.0);
    let h_ny = an.betrag2(fs / 2.0 / f0);
    let h_f0 = an.betrag2(1.0);

    let bb0 = aa0 * h_dc;
    let bb1 = aa1 * h_ny;
    let bb2 = (h_f0 * (aa0 * p0 + aa1 * p1 + aa2 * p2) - bb0 * p0 - bb1 * p1) / p2;

    Biquad { b: zaehler(bb0, bb1, bb2), a: [a1, a2] }
}

/// SVF-Koeffizienten (Simper/Cytomic, trapezintegriert): y = m0·v0 + m1·v1 + m2·v2.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct SvfKoeff {
    pub g: f64,
    pub k: f64,
    pub m0: f64,
    pub m1: f64,
    pub m2: f64,
}

impl SvfKoeff {
    /// Durchlass (H = 1), z. B. als Startwert.
    pub fn durchlass() -> Self {
        SvfKoeff { g: 0.1, k: 1.0, m0: 1.0, m1: 0.0, m2: 0.0 }
    }
}

/// Jedes stabile Biquad ist die bilineare Abbildung GENAU EINES analogen Biquads. Das wird hier
/// zurückgerechnet und als SVF realisiert: gleicher Frequenzgang, aber zeitvariant robust.
pub fn als_svf(bq: &Biquad) -> SvfKoeff {
    let [b0, b1, b2] = bq.b;
    let [a1, a2] = bq.a;
    let (n2, n1, n0) = (b0 - b1 + b2, 2.0 * (b0 - b2), b0 + b1 + b2);
    let (d2, d1, d0) = (1.0 - a1 + a2, 2.0 * (1.0 - a2), 1.0 + a1 + a2);
    let g = (d0 / d2).sqrt();
    let wurzel = (d0 * d2).sqrt();
    let k = d1 / wurzel;
    let m0 = n2 / d2;
    let m1 = n1 / wurzel - m0 * k;
    let m2 = n0 / d0 - m0;
    SvfKoeff { g, k, m0, m1, m2 }
}
