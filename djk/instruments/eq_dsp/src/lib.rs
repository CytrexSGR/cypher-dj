//! Cypher EQ: parametrischer 8-Band-EQ, dessen Kurven bis 20 kHz der analogen Sollkurve folgen.
//!
//! Signalweg je Basis-Sample: (unter 88,2 kHz) doppelte Abtastrate → 8 Bänder in Reihe, jedes als
//! SVF-Kaskade mit matched/LS-entworfenen Koeffizienten → zurück auf Basisrate → Ausgangspegel.
//! Kein Speicher wird im Echtzeitpfad angelegt.

pub mod band;
pub mod dynamik;
pub mod entwurf;
pub mod ueberabtastung;

pub use band::{BandArt, BandEinstellung, Kanal, Steilheit};
pub use dynamik::{DynModus, Dynamik};

use band::Band;
use dynamik::{art_dynamisch, koeffizient, Detektor};
use ueberabtastung::{Hoch, Pfad, Runter, LATENZ};

pub const BAENDER: usize = 8;
/// Ab dieser Basisrate wird nicht mehr überabgetastet.
pub const OHNE_UEBERABTASTUNG_AB: f64 = 88000.0;

pub struct Eq {
    ueber: bool,
    baender: Vec<Band>,
    hoch: [Hoch; 2],
    runter: [Runter; 2],
    ausgang_ziel: f64,
    ausgang: f64,
    ausgang_alpha: f64,
    prop_q: bool,
    /// The last call ran as bypass (oversampled, all bands neutral): `runter` and the bands are stale.
    im_bypass: bool,
    fs: f64,
    dyn_einst: [Dynamik; BAENDER],
    detektoren: Vec<Detektor>,
    /// Number of bands with dynamics on (the per-sample detector loop is skipped at 0).
    dyn_aktiv: bool,
    att_ms: f64,
    rel_ms: f64,
    att: f64,
    rel: f64,
}

impl Eq {
    pub fn neu(fs: f64) -> Self {
        Self::mit_pfad(fs, Pfad::erkannt())
    }

    /// Like `neu`, with the oversampler's FIR path forced (tests; `Pfad::Skalar` runs everywhere).
    pub fn mit_pfad(fs: f64, pfad: Pfad) -> Self {
        let ueber = fs < OHNE_UEBERABTASTUNG_AB;
        let fs_intern = if ueber { 2.0 * fs } else { fs };
        Eq {
            ueber,
            baender: (0..BAENDER).map(|_| Band::neu(fs_intern)).collect(),
            hoch: [Hoch::mit_pfad(pfad), Hoch::mit_pfad(pfad)],
            runter: [Runter::mit_pfad(pfad), Runter::mit_pfad(pfad)],
            ausgang_ziel: 1.0,
            ausgang: 1.0,
            ausgang_alpha: 1.0 - (-1.0 / (0.015 * fs)).exp(),
            prop_q: false,
            im_bypass: false,
            fs,
            dyn_einst: [Dynamik::default(); BAENDER],
            detektoren: (0..BAENDER).map(|_| Detektor::default()).collect(),
            dyn_aktiv: false,
            att_ms: dynamik::ATTACK_STANDARD_MS,
            rel_ms: dynamik::RELEASE_STANDARD_MS,
            att: koeffizient(dynamik::ATTACK_STANDARD_MS, fs),
            rel: koeffizient(dynamik::RELEASE_STANDARD_MS, fs),
        }
    }

    /// Dynamics of band `i`. Only Bell, Low shelf and High shelf bands act on it; other types ignore it.
    pub fn setze_dyn(&mut self, i: usize, d: Dynamik) {
        if i >= BAENDER {
            return;
        }
        self.dyn_einst[i] = d;
        if d.modus == DynModus::Aus {
            self.detektoren[i].ruhe();
            self.detektoren[i].max_db = 0.0;
            self.baender[i].setze_dyn_zusatz(0.0);
        }
        self.dyn_aktiv = self.dyn_einst.iter().any(|d| d.modus != DynModus::Aus);
    }

    pub fn dyn_einstellung(&self, i: usize) -> Dynamik {
        self.dyn_einst[i]
    }

    /// Attack (0.1..100 ms) and release (5..1000 ms) of the detector envelope, shared by all bands of the stage.
    pub fn setze_dyn_zeiten(&mut self, attack_ms: f64, release_ms: f64) {
        self.att_ms = attack_ms.clamp(dynamik::ATTACK_MIN_MS, dynamik::ATTACK_MAX_MS);
        self.rel_ms = release_ms.clamp(dynamik::RELEASE_MIN_MS, dynamik::RELEASE_MAX_MS);
        self.att = koeffizient(self.att_ms, self.fs);
        self.rel = koeffizient(self.rel_ms, self.fs);
    }

    /// Current dynamic gain change of band `i` in dB (0 = none).
    pub fn dyn_db(&self, i: usize) -> f32 {
        self.detektoren.get(i).map_or(0.0, |d| d.d_db as f32)
    }

    /// Signed value of the largest |D| of any band since the last call (negative = cut); reads and resets.
    pub fn dyn_max_db(&mut self) -> f32 {
        let mut m = 0.0f64;
        for d in self.detektoren.iter_mut() {
            if d.max_db.abs() > m.abs() {
                m = d.max_db;
            }
            d.max_db = 0.0;
        }
        m as f32
    }

    /// Once per call: re-design detection filters whose band changed.
    fn dyn_vorbereiten(&mut self) {
        if !self.dyn_aktiv {
            return;
        }
        for i in 0..BAENDER {
            let e = self.baender[i].einstellung();
            if self.dyn_einst[i].modus != DynModus::Aus && e.an && art_dynamisch(e.art) {
                self.detektoren[i].vorbereite(e.art, e.freq, e.q, self.fs);
            }
        }
    }

    /// Detectors on the base-rate input (or the key), before the bands.
    #[inline]
    fn dyn_rechnen(&mut self, l: f64, r: f64, key: Option<(f64, f64)>, stereo: bool) {
        for i in 0..BAENDER {
            let dy = self.dyn_einst[i];
            if dy.modus == DynModus::Aus {
                continue;
            }
            let e = self.baender[i].einstellung();
            if !e.an || !art_dynamisch(e.art) {
                if self.detektoren[i].d_db != 0.0 {
                    self.detektoren[i].ruhe();
                    self.baender[i].setze_dyn_zusatz(0.0);
                }
                continue;
            }
            let (dl, dr) = match key {
                Some(k) if dy.schluessel() => k,
                _ => (l, r),
            };
            let d = self.detektoren[i].schritt(&dy, e.kanal, dl, dr, stereo, self.att, self.rel);
            self.baender[i].setze_dyn_zusatz(d);
        }
    }

    /// Latenz in Basis-Samples (für die Laufzeitkompensation des Hosts).
    pub fn latenz(&self) -> usize {
        if self.ueber {
            LATENZ
        } else {
            0
        }
    }

    pub fn setze_band(&mut self, i: usize, e: BandEinstellung) {
        let p = self.prop_q;
        self.baender[i].setze(e, p);
    }

    pub fn band(&self, i: usize) -> BandEinstellung {
        self.baender[i].einstellung()
    }

    pub fn setze_prop_q(&mut self, an: bool) {
        self.prop_q = an;
        for b in self.baender.iter_mut() {
            let e = b.einstellung();
            b.setze(e, an);
        }
    }

    pub fn setze_ausgang_db(&mut self, db: f64) {
        self.ausgang_ziel = 10f64.powf(db.clamp(-24.0, 24.0) / 20.0);
    }

    pub fn reset(&mut self) {
        for b in self.baender.iter_mut() {
            b.reset();
        }
        for h in self.hoch.iter_mut() {
            h.reset();
        }
        for r in self.runter.iter_mut() {
            r.reset();
        }
        self.ausgang = self.ausgang_ziel;
    }

    #[inline]
    fn baender_rechnen(&mut self, l: f64, r: f64, stereo: bool) -> (f64, f64) {
        let (mut l, mut r) = (l, r);
        for b in self.baender.iter_mut() {
            (l, r) = b.verarbeite(l, r, stereo);
        }
        (l, r)
    }

    /// Decide once per call: oversampled and no band contributes. On leaving a bypass the up/down state is rebuilt
    /// from the kept input history and the silent bands catch up to their targets.
    fn bypass_fuer_aufruf(&mut self, stereo: bool) -> bool {
        if !self.ueber {
            return false;
        }
        let neutral = self.baender.iter().all(|b| !b.aktiv());
        if self.im_bypass && !neutral {
            for c in 0..if stereo { 2 } else { 1 } {
                self.runter[c].aus_verlauf(&self.hoch[c]);
            }
            for b in self.baender.iter_mut() {
                b.aufholen();
            }
        }
        self.im_bypass = neutral;
        neutral
    }

    #[inline]
    fn sample(&mut self, l: f64, r: f64, stereo: bool, bypass: bool) -> (f64, f64) {
        let (l, r) = if bypass {
            let l = self.hoch[0].umgehen(l);
            let r = if stereo { self.hoch[1].umgehen(r) } else { 0.0 };
            (l, r)
        } else if self.ueber {
            let ul = self.hoch[0].verarbeite(l);
            let ur = if stereo { self.hoch[1].verarbeite(r) } else { [0.0; 2] };
            let (a0, b0) = self.baender_rechnen(ul[0], ur[0], stereo);
            let (a1, b1) = self.baender_rechnen(ul[1], ur[1], stereo);
            let l = self.runter[0].verarbeite([a0, a1]);
            let r = if stereo { self.runter[1].verarbeite([b0, b1]) } else { 0.0 };
            (l, r)
        } else {
            self.baender_rechnen(l, r, stereo)
        };
        self.ausgang += self.ausgang_alpha * (self.ausgang_ziel - self.ausgang);
        (l * self.ausgang, r * self.ausgang)
    }

    pub fn verarbeite_stereo(&mut self, l: &mut [f32], r: &mut [f32]) {
        self.verarbeite_stereo_mit_schluessel(l, r, None, None);
    }

    /// Like `verarbeite_stereo`; bands in a key mode (3/4) detect on `key_l`/`key_r` when given (a missing `key_r`
    /// reuses `key_l`), else they act like modes 1/2. A key shorter than the block counts as absent.
    pub fn verarbeite_stereo_mit_schluessel(&mut self, l: &mut [f32], r: &mut [f32], key_l: Option<&[f32]>, key_r: Option<&[f32]>) {
        let bypass = self.bypass_fuer_aufruf(true);
        if !bypass {
            self.dyn_vorbereiten();
        }
        let dyn_an = self.dyn_aktiv && !bypass;
        let n = l.len().min(r.len());
        let kl = key_l.filter(|k| k.len() >= n);
        let kr = key_r.filter(|k| k.len() >= n).or(kl);
        for (idx, (a, b)) in l.iter_mut().zip(r.iter_mut()).enumerate() {
            if dyn_an {
                let key = kl.map(|k| (k[idx] as f64, kr.map_or(k[idx] as f64, |k2| k2[idx] as f64)));
                self.dyn_rechnen(*a as f64, *b as f64, key, true);
            }
            let (x, y) = self.sample(*a as f64, *b as f64, true, bypass);
            *a = x as f32;
            *b = y as f32;
        }
    }

    pub fn verarbeite_mono(&mut self, x: &mut [f32]) {
        let bypass = self.bypass_fuer_aufruf(false);
        if !bypass {
            self.dyn_vorbereiten();
        }
        let dyn_an = self.dyn_aktiv && !bypass;
        for a in x.iter_mut() {
            if dyn_an {
                self.dyn_rechnen(*a as f64, 0.0, None, false);
            }
            *a = self.sample(*a as f64, 0.0, false, bypass).0 as f32;
        }
    }
}
