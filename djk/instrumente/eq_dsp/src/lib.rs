//! Cypher EQ: parametrischer 8-Band-EQ, dessen Kurven bis 20 kHz der analogen Sollkurve folgen.
//!
//! Signalweg je Basis-Sample: (unter 88,2 kHz) doppelte Abtastrate → 8 Bänder in Reihe, jedes als
//! SVF-Kaskade mit matched/LS-entworfenen Koeffizienten → zurück auf Basisrate → Ausgangspegel.
//! Kein Speicher wird im Echtzeitpfad angelegt.

pub mod band;
pub mod entwurf;
pub mod ueberabtastung;

pub use band::{BandArt, BandEinstellung, Kanal, Steilheit};

use band::Band;
use ueberabtastung::{Hoch, Runter, LATENZ};

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
}

impl Eq {
    pub fn neu(fs: f64) -> Self {
        let ueber = fs < OHNE_UEBERABTASTUNG_AB;
        let fs_intern = if ueber { 2.0 * fs } else { fs };
        Eq {
            ueber,
            baender: (0..BAENDER).map(|_| Band::neu(fs_intern)).collect(),
            hoch: [Hoch::neu(), Hoch::neu()],
            runter: [Runter::neu(), Runter::neu()],
            ausgang_ziel: 1.0,
            ausgang: 1.0,
            ausgang_alpha: 1.0 - (-1.0 / (0.015 * fs)).exp(),
            prop_q: false,
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

    #[inline]
    fn sample(&mut self, l: f64, r: f64, stereo: bool) -> (f64, f64) {
        let (l, r) = if self.ueber {
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
        for (a, b) in l.iter_mut().zip(r.iter_mut()) {
            let (x, y) = self.sample(*a as f64, *b as f64, true);
            *a = x as f32;
            *b = y as f32;
        }
    }

    pub fn verarbeite_mono(&mut self, x: &mut [f32]) {
        for a in x.iter_mut() {
            *a = self.sample(*a as f64, 0.0, false).0 as f32;
        }
    }
}
