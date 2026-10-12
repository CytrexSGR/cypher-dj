//! Cypher Hall: spektraler Hall nach Vickers u. a. und FDverb (ETH 2026), Herleitung in MATHE.md.
//!
//! y = (1 − mix)·x + mix·( early·ER(x) + T(x) ). ER im Zeitbereich, Fahne T im STFT-Bereich, um
//! T_pre + L_er/2 verzögert. Keine gemeldete Latenz, der trockene Weg bleibt unverzögert. Alle
//! Puffer und FFT-Pläne für alle Rahmengrößen werden bei `neu` angelegt; im Echtzeitpfad wird
//! kein Speicher angefordert.

mod fahne;
mod frueh;
mod zufall;

pub use fahne::Fahne;
use frueh::{Frueh, Verzoegerung};

pub const RAHMEN: [usize; 5] = [512, 1024, 2048, 4096, 8192];
const PRE_MAX: f64 = 0.250;
const ER_MAX: f64 = 0.200;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HallEinstellung {
    /// Anteil nass 0..1
    pub mix: f64,
    /// Pegel der frühen Reflexionen relativ zur Fahne, 0..1
    pub frueh: f64,
    /// Pegel der Fahne in dB (Energie des Impulses)
    pub fahne_db: f64,
    pub pre_ms: f64,
    /// Länge des Bereichs der frühen Reflexionen („Größe“), ms
    pub groesse_ms: f64,
    /// Nachhallzeit bei 1 kHz, s
    pub decay_s: f64,
    /// Faktor auf die Nachhallzeit bei 150 Hz
    pub tief_faktor: f64,
    /// Faktor auf die Nachhallzeit bei 8 kHz
    pub hoch_faktor: f64,
    pub lowcut_hz: f64,
    pub highcut_hz: f64,
    /// 0 = tonal/eingefroren, 1 = volle Diffusion
    pub diffusion: f64,
    /// Stereobreite 0..1
    pub breite: f64,
    /// Ducking je Frequenz 0..1
    pub duck: f64,
    pub freeze: bool,
    /// Index in RAHMEN
    pub rahmen: usize,
}

impl Default for HallEinstellung {
    fn default() -> Self {
        HallEinstellung {
            mix: 0.3,
            frueh: 0.5,
            fahne_db: 0.0,
            pre_ms: 10.0,
            groesse_ms: 60.0,
            decay_s: 2.0,
            tief_faktor: 1.2,
            hoch_faktor: 0.6,
            lowcut_hz: 80.0,
            highcut_hz: 12000.0,
            diffusion: 1.0,
            breite: 1.0,
            duck: 0.0,
            freeze: false,
            rahmen: 2,
        }
    }
}

/// T60(f) aus drei Stützwerten, linear in log2(f) (MATHE §3).
pub fn t60_kurve(e: &HallEinstellung, f: f64) -> f64 {
    let (lt, lm, lh) = (150f64.log2(), 1000f64.log2(), 8000f64.log2());
    let x = f.max(1.0).log2();
    let (ft, fh) = (e.tief_faktor.max(0.05), e.hoch_faktor.max(0.05));
    let faktor_log = if x <= lt {
        ft.log2()
    } else if x <= lm {
        ft.log2() * (lm - x) / (lm - lt)
    } else if x <= lh {
        fh.log2() * (x - lm) / (lh - lm)
    } else {
        fh.log2()
    };
    e.decay_s * faktor_log.exp2()
}

/// Klangfilter der Fahne als Betragskurve (2. Ordnung Butterworth-Form), mal Pegel.
pub fn fahnen_pegel(e: &HallEinstellung, f: f64) -> f64 {
    let f = f.max(1.0);
    let hp = 1.0 / (1.0 + (e.lowcut_hz / f).powi(4)).sqrt();
    let tp = 1.0 / (1.0 + (f / e.highcut_hz).powi(4)).sqrt();
    10f64.powf(e.fahne_db / 20.0) * hp * tp
}

struct Glatt {
    wert: f64,
    ziel: f64,
    a: f64,
}
impl Glatt {
    fn neu(w: f64, fs: f64) -> Self {
        Glatt { wert: w, ziel: w, a: 1.0 - (-1.0 / (0.02 * fs)).exp() }
    }
    #[inline]
    fn next(&mut self) -> f64 {
        self.wert += self.a * (self.ziel - self.wert);
        self.wert
    }
}

/// Einpoliger Tief-/Hochpass für den Klang der frühen Reflexionen.
struct EinPol {
    a_tp: f32,
    a_hp: f32,
    z_tp: f32,
    z_hp: f32,
}
impl EinPol {
    fn setze(&mut self, fs: f64, lowcut: f64, highcut: f64) {
        self.a_tp = (1.0 - (-2.0 * std::f64::consts::PI * highcut / fs).exp()) as f32;
        self.a_hp = (1.0 - (-2.0 * std::f64::consts::PI * lowcut / fs).exp()) as f32;
    }
    #[inline]
    fn sample(&mut self, x: f32) -> f32 {
        self.z_tp += self.a_tp * (x - self.z_tp);
        self.z_hp += self.a_hp * (self.z_tp - self.z_hp);
        self.z_tp - self.z_hp
    }
}

pub struct Hall {
    fs: f64,
    e: HallEinstellung,
    fahnen: Vec<[Fahne; 2]>,
    aktiv: usize,
    alt: Option<usize>,
    blende: f64,
    blend_schritt: f64,
    frueh: [Frueh; 2],
    ton: [EinPol; 2],
    verz_fahne: [Verzoegerung; 2],
    mix: Glatt,
    frueh_pegel: Glatt,
    breite: Glatt,
}

impl Hall {
    pub fn neu(fs: f64) -> Self {
        let max_pre = (PRE_MAX * fs) as usize;
        let max_er = ((PRE_MAX + ER_MAX) * fs) as usize;
        let e = HallEinstellung::default();
        let mut h = Hall {
            fs,
            e,
            fahnen: RAHMEN.iter().map(|&n| [Fahne::neu(n, fs, 0xA11 + n as u64), Fahne::neu(n, fs, 0xB22 + n as u64)]).collect(),
            aktiv: e.rahmen,
            alt: None,
            blende: 1.0,
            blend_schritt: 1.0 / (0.05 * fs),
            frueh: [Frueh::neu(max_er, 0x5EED_0001), Frueh::neu(max_er, 0x5EED_0002)],
            ton: [EinPol { a_tp: 1.0, a_hp: 0.0, z_tp: 0.0, z_hp: 0.0 }, EinPol { a_tp: 1.0, a_hp: 0.0, z_tp: 0.0, z_hp: 0.0 }],
            verz_fahne: [Verzoegerung::neu(max_pre + max_er), Verzoegerung::neu(max_pre + max_er)],
            mix: Glatt::neu(e.mix, fs),
            frueh_pegel: Glatt::neu(e.frueh, fs),
            breite: Glatt::neu(e.breite, fs),
        };
        h.anwenden(true);
        h
    }

    pub fn einstellung(&self) -> HallEinstellung {
        self.e
    }

    pub fn setze(&mut self, e: HallEinstellung) {
        if e == self.e {
            return;
        }
        let struktur = e.decay_s != self.e.decay_s
            || e.tief_faktor != self.e.tief_faktor
            || e.hoch_faktor != self.e.hoch_faktor
            || e.lowcut_hz != self.e.lowcut_hz
            || e.highcut_hz != self.e.highcut_hz
            || e.fahne_db != self.e.fahne_db
            || e.pre_ms != self.e.pre_ms
            || e.groesse_ms != self.e.groesse_ms;
        if e.rahmen != self.e.rahmen && e.rahmen < RAHMEN.len() {
            // Überblenden: alte Fahne klingt ohne Eingang aus, neue übernimmt
            self.alt = Some(self.aktiv);
            self.aktiv = e.rahmen;
            self.blende = 0.0;
            for f in self.fahnen[self.aktiv].iter_mut() {
                f.reset();
            }
        }
        self.e = e;
        self.anwenden(struktur);
    }

    fn anwenden(&mut self, struktur: bool) {
        let e = self.e;
        self.mix.ziel = e.mix.clamp(0.0, 1.0);
        self.frueh_pegel.ziel = e.frueh.clamp(0.0, 1.0);
        self.breite.ziel = e.breite.clamp(0.0, 1.0);
        let fs = self.fs;
        for paar in self.fahnen.iter_mut() {
            for f in paar.iter_mut() {
                f.diffusion = e.diffusion.clamp(0.0, 1.0);
                f.duck_a = 30.0 * e.duck.clamp(0.0, 1.0).powi(2);
                f.freeze = e.freeze;
                if struktur {
                    f.setze_t60(fs, |fr| t60_kurve(&e, fr));
                    f.setze_pegel(fs, |fr| fahnen_pegel(&e, fr));
                }
            }
        }
        if struktur {
            let pre = (e.pre_ms / 1000.0).clamp(0.0, PRE_MAX);
            let laenge = (e.groesse_ms / 1000.0).clamp(0.005, ER_MAX);
            for fr in self.frueh.iter_mut() {
                fr.setze(fs, pre, laenge, (0.3 * e.decay_s).clamp(0.1, 1.0));
            }
            for t in self.ton.iter_mut() {
                t.setze(fs, e.lowcut_hz, e.highcut_hz);
            }
            let start = ((pre + 0.5 * laenge) * fs).round() as usize;
            for v in self.verz_fahne.iter_mut() {
                v.verz = start;
            }
        }
    }

    pub fn kill(&mut self) {
        for paar in self.fahnen.iter_mut() {
            for f in paar.iter_mut() {
                f.kill();
            }
        }
    }

    pub fn reset(&mut self) {
        for paar in self.fahnen.iter_mut() {
            for f in paar.iter_mut() {
                f.reset();
            }
        }
        for f in self.frueh.iter_mut() {
            f.reset();
        }
        for v in self.verz_fahne.iter_mut() {
            v.reset();
        }
        self.alt = None;
        self.blende = 1.0;
        // Glätter auf das Ziel setzen: nach einem Reset gilt die Einstellung sofort
        for g in [&mut self.mix, &mut self.frueh_pegel, &mut self.breite] {
            g.wert = g.ziel;
        }
    }

    #[inline]
    fn nass(&mut self, l: f32, r: f32) -> (f32, f32) {
        // Fahne: beide Fahnen hören die Summe (später Nachhall ist diffus, er kommt von überall: ein nur rechts
        // gespeistes Signal hallt auch links). Zwei Fahnen mit eigenem Zufall bleiben dekorreliert. Richtung tragen
        // die frühen Reflexionen, die je Seite bleiben. (l+r)/2 hält den Pegel für mittige Quellen wie bisher.
        let summe = 0.5 * (l + r);
        let (dl, dr) = (self.verz_fahne[0].sample(summe), self.verz_fahne[1].sample(summe));
        let mut tl = self.fahnen[self.aktiv][0].sample(dl, l);
        let mut tr = self.fahnen[self.aktiv][1].sample(dr, r);
        if let Some(a) = self.alt {
            let b = self.blende as f32;
            tl = b * tl + (1.0 - b) * self.fahnen[a][0].sample(0.0, 0.0);
            tr = b * tr + (1.0 - b) * self.fahnen[a][1].sample(0.0, 0.0);
            self.blende += self.blend_schritt;
            if self.blende >= 1.0 {
                self.blende = 1.0;
                self.alt = None;
            }
        }
        // frühe Reflexionen
        let fp = self.frueh_pegel.next() as f32;
        let el = self.ton[0].sample(self.frueh[0].sample(l)) * fp;
        let er = self.ton[1].sample(self.frueh[1].sample(r)) * fp;
        let (wl, wr) = (tl + el, tr + er);
        let w = self.breite.next() as f32;
        let (m, s) = (0.5 * (wl + wr), 0.5 * (wl - wr));
        (m + w * s, m - w * s)
    }

    pub fn verarbeite_stereo(&mut self, l: &mut [f32], r: &mut [f32]) {
        for (a, b) in l.iter_mut().zip(r.iter_mut()) {
            let (wl, wr) = self.nass(*a, *b);
            let m = self.mix.next() as f32;
            *a = (1.0 - m) * *a + m * wl;
            *b = (1.0 - m) * *b + m * wr;
        }
    }

    /// Nur der nasse Anteil (für Messungen und Send-Betrieb), Mix wird ignoriert.
    pub fn nur_nass(&mut self, l: &mut [f32], r: &mut [f32]) {
        for (a, b) in l.iter_mut().zip(r.iter_mut()) {
            let (wl, wr) = self.nass(*a, *b);
            *a = wl;
            *b = wr;
        }
    }

    pub fn fahne_ms_start(&self) -> f64 {
        (self.e.pre_ms + 0.5 * self.e.groesse_ms).min((PRE_MAX + ER_MAX) * 1000.0)
    }
}
