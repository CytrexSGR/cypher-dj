//! Ein EQ-Band: Parameter glätten, Koeffizienten nachführen, SVF-Sektionen rechnen, beim Umschalten
//! von Art/Steilheit/Kanal überblenden statt knacken.

use crate::entwurf::{als_svf, passend_mit, prototyp, Art, Raster, SvfKoeff};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BandArt {
    Glocke,
    LowShelf,
    HighShelf,
    LowCut,
    HighCut,
    Kerbe,
    Bandpass,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Steilheit {
    Db12,
    Db24,
    Db36,
    Db48,
}

impl Steilheit {
    fn sektionen(self) -> usize {
        match self {
            Steilheit::Db12 => 1,
            Steilheit::Db24 => 2,
            Steilheit::Db36 => 3,
            Steilheit::Db48 => 4,
        }
    }
}

/// Wo das Band wirkt. Bei Mono-Betrieb wird es ignoriert.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kanal {
    Stereo,
    Mid,
    Side,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BandEinstellung {
    pub an: bool,
    pub art: BandArt,
    pub freq: f64,
    pub gain_db: f64,
    pub q: f64,
    pub steilheit: Steilheit,
    pub kanal: Kanal,
}

impl Default for BandEinstellung {
    fn default() -> Self {
        BandEinstellung {
            an: false,
            art: BandArt::Glocke,
            freq: 1000.0,
            gain_db: 0.0,
            q: 0.707,
            steilheit: Steilheit::Db12,
            kanal: Kanal::Stereo,
        }
    }
}

pub const FREQ_MIN: f64 = 10.0;
pub const FREQ_MAX: f64 = 22000.0;
pub const GAIN_MAX: f64 = 24.0;
pub const Q_MIN: f64 = 0.1;
pub const Q_MAX: f64 = 18.0;
pub const MAX_SEKTIONEN: usize = 4;

/// Alle so viele (interne) Samples werden Koeffizienten neu entworfen; dazwischen linear gerampt.
pub const NACHFUEHR_TAKT: usize = 16;
/// Zeitkonstante der Parameterglättung.
const GLAETT_ZEIT: f64 = 0.015;
/// Dauer einer Überblendung beim Umschalten.
const BLEND_ZEIT: f64 = 0.010;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Struktur {
    art: BandArt,
    steilheit: Steilheit,
    kanal: Kanal,
}

impl Struktur {
    fn von(e: &BandEinstellung) -> Self {
        Struktur { art: e.art, steilheit: e.steilheit, kanal: e.kanal }
    }
}

/// Q der Glocke im Modus „proportional“: schmaler, je stärker der Eingriff.
/// Bei 12 dB genau das eingestellte Q, bei 0 dB die Hälfte, bei 24 dB das Anderthalbfache.
pub fn proportional_q(q: f64, gain_db: f64) -> f64 {
    (q * (0.5 + gain_db.abs() / 24.0)).clamp(Q_MIN, Q_MAX)
}

/// Koeffizienten aller Sektionen für eine Einstellung bei interner Rate `fs`.
#[allow(clippy::too_many_arguments)]
pub fn entwirf(art: BandArt, steil: Steilheit, freq: f64, gain_db: f64, q: f64, prop_q: bool, fs: f64, raster: &Raster) -> (usize, [SvfKoeff; MAX_SEKTIONEN]) {
    let mut k = [SvfKoeff::durchlass(); MAX_SEKTIONEN];
    let f = freq.clamp(FREQ_MIN, FREQ_MAX);
    let g = gain_db.clamp(-GAIN_MAX, GAIN_MAX);
    let q = q.clamp(Q_MIN, Q_MAX);
    let einzeln = |a: Art, g: f64, q: f64| als_svf(&passend_mit(&prototyp(a, g, q), f, fs, raster));
    match art {
        BandArt::Glocke => {
            k[0] = einzeln(Art::Glocke, g, if prop_q { proportional_q(q, g) } else { q });
            (1, k)
        }
        BandArt::LowShelf => {
            k[0] = einzeln(Art::LowShelf, g, q);
            (1, k)
        }
        BandArt::HighShelf => {
            k[0] = einzeln(Art::HighShelf, g, q);
            (1, k)
        }
        BandArt::Kerbe => {
            k[0] = einzeln(Art::Kerbe, 0.0, q);
            (1, k)
        }
        BandArt::Bandpass => {
            k[0] = einzeln(Art::Bandpass, 0.0, q);
            (1, k)
        }
        BandArt::LowCut | BandArt::HighCut => {
            let a = if art == BandArt::LowCut { Art::Hochpass } else { Art::Tiefpass };
            let n = steil.sektionen();
            if n == 1 {
                k[0] = einzeln(a, 0.0, q);
            } else {
                // Butterworth der Ordnung 2n; die schärfste Sektion trägt die Resonanz (q / 0,7071).
                for (i, ki) in k.iter_mut().take(n).enumerate() {
                    let theta = std::f64::consts::PI * (2 * i + 1) as f64 / (4 * n) as f64;
                    let mut qi = 1.0 / (2.0 * theta.cos());
                    if i == n - 1 {
                        qi *= q / std::f64::consts::FRAC_1_SQRT_2;
                    }
                    *ki = einzeln(a, 0.0, qi.clamp(Q_MIN, Q_MAX));
                }
            }
            (n, k)
        }
    }
}

#[derive(Clone, Copy, Default)]
struct SvfZustand {
    ic1: f64,
    ic2: f64,
}

impl SvfZustand {
    #[inline]
    fn tick(&mut self, c: &SvfKoeff, x: f64) -> f64 {
        let a1 = 1.0 / (1.0 + c.g * (c.g + c.k));
        let a2 = c.g * a1;
        let a3 = c.g * a2;
        let v3 = x - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        c.m0 * x + c.m1 * v1 + c.m2 * v2
    }

    fn entnormalisiere(&mut self) {
        if self.ic1.abs() < 1e-30 {
            self.ic1 = 0.0;
        }
        if self.ic2.abs() < 1e-30 {
            self.ic2 = 0.0;
        }
    }
}

fn plus(a: &SvfKoeff, b: &SvfKoeff) -> SvfKoeff {
    SvfKoeff { g: a.g + b.g, k: a.k + b.k, m0: a.m0 + b.m0, m1: a.m1 + b.m1, m2: a.m2 + b.m2 }
}

fn schritt(von: &SvfKoeff, nach: &SvfKoeff, n: f64) -> SvfKoeff {
    SvfKoeff {
        g: (nach.g - von.g) / n,
        k: (nach.k - von.k) / n,
        m0: (nach.m0 - von.m0) / n,
        m1: (nach.m1 - von.m1) / n,
        m2: (nach.m2 - von.m2) / n,
    }
}

pub struct Band {
    fs: f64,
    ziel: BandEinstellung,
    struktur: Struktur,
    /// geglättet: log2(f), Gain dB, ln(Q)
    glatt: [f64; 3],
    alpha: f64,
    n: usize,
    ist: [SvfKoeff; MAX_SEKTIONEN],
    delta: [SvfKoeff; MAX_SEKTIONEN],
    takt: usize,
    nass: f64,
    blend_schritt: f64,
    zustand: [[SvfZustand; MAX_SEKTIONEN]; 2],
    prop_q: bool,
    frisch: bool,
    /// Entwurf fällig, obwohl sich kein geglätteter Parameter bewegt (prop_q umgeschaltet).
    neu_entwerfen: bool,
    ramp_ende: Option<[SvfKoeff; MAX_SEKTIONEN]>,
    raster: Raster,
}

impl Band {
    pub fn neu(fs: f64) -> Self {
        let e = BandEinstellung::default();
        let mut b = Band {
            fs,
            ziel: e,
            struktur: Struktur::von(&e),
            glatt: [0.0; 3],
            alpha: 1.0 - (-(NACHFUEHR_TAKT as f64) / (GLAETT_ZEIT * fs)).exp(),
            n: 1,
            ist: [SvfKoeff::durchlass(); MAX_SEKTIONEN],
            delta: [SvfKoeff::default(); MAX_SEKTIONEN],
            takt: 0,
            nass: 0.0,
            blend_schritt: 1.0 / (BLEND_ZEIT * fs),
            zustand: [[SvfZustand::default(); MAX_SEKTIONEN]; 2],
            prop_q: false,
            frisch: true,
            neu_entwerfen: false,
            ramp_ende: None,
            raster: Raster::neu(fs),
        };
        b.springe();
        b
    }

    fn ziel_param(&self) -> [f64; 3] {
        [
            self.ziel.freq.clamp(FREQ_MIN, FREQ_MAX).log2(),
            self.ziel.gain_db.clamp(-GAIN_MAX, GAIN_MAX),
            self.ziel.q.clamp(Q_MIN, Q_MAX).ln(),
        ]
    }

    fn entwurf_jetzt(&self) -> (usize, [SvfKoeff; MAX_SEKTIONEN]) {
        let s = &self.struktur;
        entwirf(s.art, s.steilheit, self.glatt[0].exp2(), self.glatt[1], self.glatt[2].exp(), self.prop_q, self.fs, &self.raster)
    }

    /// Parameter sofort übernehmen, ohne Glättung (Start, Reset).
    fn springe(&mut self) {
        self.struktur = Struktur::von(&self.ziel);
        self.glatt = self.ziel_param();
        let (n, k) = self.entwurf_jetzt();
        self.n = n;
        self.ist = k;
        self.delta = [SvfKoeff::default(); MAX_SEKTIONEN];
        self.ramp_ende = None;
        self.nass = if self.ziel.an { 1.0 } else { 0.0 };
        self.zustand = [[SvfZustand::default(); MAX_SEKTIONEN]; 2];
    }

    pub fn setze(&mut self, e: BandEinstellung, prop_q: bool) {
        self.ziel = e;
        if prop_q != self.prop_q {
            self.prop_q = prop_q;
            self.neu_entwerfen = true;
        }
        if self.frisch {
            self.frisch = false;
            self.springe();
        }
    }

    pub fn einstellung(&self) -> BandEinstellung {
        self.ziel
    }

    pub fn reset(&mut self) {
        self.springe();
    }

    /// Ist das Band hörbar beteiligt (für die Abkürzung „alles aus“)?
    pub fn aktiv(&self) -> bool {
        self.nass > 0.0 || self.ziel.an
    }

    fn nachfuehren(&mut self) {
        // Umschalten der Struktur nur bei nass == 0 (vorher ausgeblendet).
        if self.nass == 0.0 && Struktur::von(&self.ziel) != self.struktur {
            self.struktur = Struktur::von(&self.ziel);
            self.glatt = self.ziel_param();
            let (n, k) = self.entwurf_jetzt();
            self.n = n;
            self.ist = k;
            self.delta = [SvfKoeff::default(); MAX_SEKTIONEN];
            self.ramp_ende = None;
            self.zustand = [[SvfZustand::default(); MAX_SEKTIONEN]; 2];
            return;
        }
        let ziel = self.ziel_param();
        let mut bewegt = false;
        for i in 0..3 {
            let d = ziel[i] - self.glatt[i];
            if d.abs() > 1e-6 {
                self.glatt[i] += self.alpha * d;
                bewegt = true;
            } else {
                self.glatt[i] = ziel[i];
            }
        }
        if bewegt || self.neu_entwerfen {
            self.neu_entwerfen = false;
            let (n, k) = self.entwurf_jetzt();
            for i in 0..n {
                self.delta[i] = schritt(&self.ist[i], &k[i], NACHFUEHR_TAKT as f64);
            }
            self.ramp_ende = Some(k);
        } else if let Some(k) = self.ramp_ende.take() {
            // Rampe ist durch: exakt auf das Ziel setzen, Rundungsdrift verwerfen.
            self.ist = k;
            self.delta = [SvfKoeff::default(); MAX_SEKTIONEN];
        }
        for z in self.zustand.iter_mut().flatten() {
            z.entnormalisiere();
        }
    }

    /// Ein internes Sample; `stereo == false` → nur Kanal 0 wird gerechnet.
    #[inline]
    pub fn verarbeite(&mut self, l: f64, r: f64, stereo: bool) -> (f64, f64) {
        if self.takt == 0 {
            self.nachfuehren();
        }
        self.takt = (self.takt + 1) % NACHFUEHR_TAKT;

        // Nass-Anteil: zum Umschalten erst auf 0, sonst Richtung an/aus.
        let struktur_wechsel = Struktur::von(&self.ziel) != self.struktur;
        let nass_ziel = if self.ziel.an && !struktur_wechsel { 1.0 } else { 0.0 };
        if self.nass < nass_ziel {
            if self.nass == 0.0 {
                self.zustand = [[SvfZustand::default(); MAX_SEKTIONEN]; 2];
            }
            self.nass = (self.nass + self.blend_schritt).min(1.0);
        } else if self.nass > nass_ziel {
            self.nass = (self.nass - self.blend_schritt).max(0.0);
        }

        for i in 0..self.n {
            self.ist[i] = plus(&self.ist[i], &self.delta[i]);
        }
        if self.nass == 0.0 {
            return (l, r);
        }

        let n = self.n;
        let ist = &self.ist;
        let kette = |z: &mut [SvfZustand; MAX_SEKTIONEN], mut x: f64| {
            for i in 0..n {
                x = z[i].tick(&ist[i], x);
            }
            x
        };
        let [z0, z1] = &mut self.zustand;
        let (yl, yr) = if !stereo {
            (kette(z0, l), r)
        } else {
            match self.struktur.kanal {
                Kanal::Stereo => (kette(z0, l), kette(z1, r)),
                Kanal::Mid => {
                    let (m, s) = (0.5 * (l + r), 0.5 * (l - r));
                    let m = kette(z0, m);
                    (m + s, m - s)
                }
                Kanal::Side => {
                    let (m, s) = (0.5 * (l + r), 0.5 * (l - r));
                    let s = kette(z0, s);
                    (m + s, m - s)
                }
            }
        };
        let w = self.nass;
        (l + w * (yl - l), r + w * (yr - r))
    }
}
