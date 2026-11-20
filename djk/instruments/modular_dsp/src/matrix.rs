//! Pin matrix (type 60): 16 sources (`e1`..`e16`) to 16 destinations (`a1`..`a16`), two weight sets A and B with a morph.
//!
//! `a_j = sum_i w[i][j] * e_i` per voice, `w = A + (B - A) * clamp(morph, 0, 1)` per sample. The weights are not per voice:
//! they live here, in the program, and are set from outside without allocation (`Programm::stift_setzen` and friends).
//!
//! A weight is one pin of the set. Index in the flat arrays: `satz * 256 + zeile * 16 + spalte`. The audio path walks a
//! fixed-capacity list of ACTIVE positions (row, column; both sets together): a position is on the list while its target is
//! not 0 in A or in B, or while a smoothed state has not reached its target yet. A position whose targets and states are all
//! exactly 0 leaves the list, so the cost follows the pins in use and does not grow over a session.
//!
//! Smoothing: every weight state follows its target with a one-pole filter of about 5 ms (no click when a pin changes while a
//! note sounds). The state snaps to the target below `STIFT_EINRASTEN` or when a step no longer moves it, the rule and the
//! reason of `REGLER_EINRASTEN` in `reverb_ffi/src/baukasten.rs`: a float one-pole never reaches its target by itself, and
//! without the snap a removed pin would stay on the list for ever.
use crate::programm::MAX_STIMMEN;

pub const SAETZE: usize = 2;
pub const ZEILEN: usize = 16;
pub const SPALTEN: usize = 16;
/// positions of one set (row * 16 + column)
pub const POSITIONEN: usize = ZEILEN * SPALTEN;
/// weights of both sets
pub const GEWICHTE: usize = SAETZE * POSITIONEN;
/// most pins a stored list holds
pub const STIFTE_MAX: usize = GEWICHTE;
/// longest label of a row or a column, in characters
pub const NAME_MAX: usize = 16;
/// closer than this to its target, a weight state snaps to it (and a step that does not move the state snaps too)
pub const STIFT_EINRASTEN: f32 = 1e-5;

/// Pin rules shared by the translator and the setters: set 0|1, row and column 0..15 as whole numbers, value finite in -1..1.
pub fn pruefe_stifte(s: &[[f32; 4]]) -> Result<(), &'static str> {
    if s.len() > STIFTE_MAX {
        return Err("at most 512 pins");
    }
    let mut belegt = [false; GEWICHTE];
    for p in s {
        let ganz = |v: f32, max: usize| v.is_finite() && v.fract() == 0.0 && v >= 0.0 && v < max as f32;
        if !ganz(p[0], SAETZE) {
            return Err("pin set must be 0 or 1");
        }
        if !ganz(p[1], ZEILEN) {
            return Err("pin row must be a whole number 0..15");
        }
        if !ganz(p[2], SPALTEN) {
            return Err("pin column must be a whole number 0..15");
        }
        if !(p[3].is_finite() && (-1.0..=1.0).contains(&p[3])) {
            return Err("pin value must be finite in -1..1");
        }
        let i = index(p[0] as usize, p[1] as usize, p[2] as usize);
        if belegt[i] {
            return Err("duplicate pin position");
        }
        belegt[i] = true;
    }
    Ok(())
}

/// Labels of the rows or columns: exactly 16, 1..16 characters, no control characters, unique within the list.
pub fn pruefe_namen(n: &[String]) -> Result<(), &'static str> {
    if n.len() != ZEILEN {
        return Err("exactly 16 labels");
    }
    for (i, s) in n.iter().enumerate() {
        let len = s.chars().count();
        if len == 0 || len > NAME_MAX {
            return Err("a label has 1..16 characters");
        }
        if s.chars().any(char::is_control) {
            return Err("a label has no control characters");
        }
        if n[..i].contains(s) {
            return Err("labels must be unique");
        }
    }
    Ok(())
}

#[inline]
pub fn index(satz: usize, zeile: usize, spalte: usize) -> usize { satz * POSITIONEN + zeile * SPALTEN + spalte }

pub struct Matrix {
    /// graph defaults (`stifte` of the node), what `stifte_grund(true, ..)` writes
    vorgabe: [f32; GEWICHTE],
    ziel: [f32; GEWICHTE],
    ist: [f32; GEWICHTE],
    /// active positions (row * 16 + column), the first `n` entries
    liste: [u16; POSITIONEN],
    n: usize,
    in_liste: [bool; POSITIONEN],
    /// one-pole coefficient of about 5 ms
    a: f32,
}

impl Matrix {
    /// From the translated pins (already checked with `pruefe_stifte`): targets and states start at the pins, so a new
    /// instance sounds right from its first sample.
    pub fn neu(stifte: &[[f32; 4]], sr: f32) -> Matrix {
        let mut vorgabe = [0.0f32; GEWICHTE];
        for p in stifte {
            vorgabe[index(p[0] as usize, p[1] as usize, p[2] as usize)] = p[3];
        }
        let mut m = Matrix {
            vorgabe,
            ziel: vorgabe,
            ist: vorgabe,
            liste: [0; POSITIONEN],
            n: 0,
            in_liste: [false; POSITIONEN],
            a: 1.0 - (-1.0 / (0.005 * sr)).exp(),
        };
        m.liste_aufbauen();
        m
    }

    /// Back to the translated start for a plug-in reset: the targets stay (a reset is not a patch change), the smoothed
    /// state jumps to them so a transport start does not depend on a running glide.
    pub fn zuruecksetzen(&mut self) {
        self.ist = self.ziel;
        self.liste_aufbauen();
    }

    fn liste_aufbauen(&mut self) {
        self.n = 0;
        for p in 0..POSITIONEN {
            let belegt = self.ziel[p] != 0.0 || self.ziel[POSITIONEN + p] != 0.0 || self.ist[p] != self.ziel[p] || self.ist[POSITIONEN + p] != self.ziel[POSITIONEN + p];
            self.in_liste[p] = belegt;
            if belegt {
                self.liste[self.n] = p as u16;
                self.n += 1;
            }
        }
    }

    #[inline]
    fn einreihen(&mut self, p: usize) {
        if !self.in_liste[p] {
            self.in_liste[p] = true;
            self.liste[self.n] = p as u16;
            self.n += 1;
        }
    }

    /// Target of one weight; `sofort` also jumps the state. False for an index out of range or NaN. The value is clamped to -1..1.
    pub fn setzen(&mut self, satz: usize, zeile: usize, spalte: usize, wert: f32, sofort: bool) -> bool {
        if satz >= SAETZE || zeile >= ZEILEN || spalte >= SPALTEN || wert.is_nan() {
            return false;
        }
        let w = wert.clamp(-1.0, 1.0);
        let i = index(satz, zeile, spalte);
        self.ziel[i] = w;
        if sofort {
            self.ist[i] = w;
        }
        self.einreihen(zeile * SPALTEN + spalte);
        true
    }

    /// Every weight to the graph's pins (`vorgabe`) or to 0.
    pub fn grund(&mut self, vorgabe: bool, sofort: bool) {
        for i in 0..GEWICHTE {
            let w = if vorgabe { self.vorgabe[i] } else { 0.0 };
            self.ziel[i] = w;
            if sofort {
                self.ist[i] = w;
            }
        }
        self.liste_aufbauen();
    }

    pub fn ziel(&self, satz: usize, zeile: usize, spalte: usize) -> Option<f32> {
        (satz < SAETZE && zeile < ZEILEN && spalte < SPALTEN).then(|| self.ziel[index(satz, zeile, spalte)])
    }

    /// Positions on the active list.
    pub fn aktive(&self) -> usize { self.n }

    #[inline(always)]
    fn schritt(ist: &mut f32, ziel: f32, a: f32) {
        if *ist == ziel {
            return;
        }
        let d = ziel - *ist;
        let s = *ist + a * d;
        *ist = if d.abs() < STIFT_EINRASTEN || s == *ist { ziel } else { s };
    }

    /// One sample: `e(i)` is the source row `i` (a track of voices), `morph(v)` the morph per voice; the 16 outputs are summed into `aus`
    /// (voices `0..n`). Smooths the weight states, drops finished zero positions from the list.
    #[inline]
    pub fn prozess(&mut self, n: usize, e: impl Fn(usize) -> [f32; MAX_STIMMEN], morph: impl Fn(usize) -> f32, aus: &mut [[f32; MAX_STIMMEN]; SPALTEN]) {
        *aus = [[0.0; MAX_STIMMEN]; SPALTEN];
        let a = self.a;
        let mut m = [0.0f32; MAX_STIMMEN];
        for v in 0..n {
            m[v] = morph(v).clamp(0.0, 1.0);
        }
        let mut k = 0;
        while k < self.n {
            let p = self.liste[k] as usize;
            let (za, zb) = (self.ziel[p], self.ziel[POSITIONEN + p]);
            Self::schritt(&mut self.ist[p], za, a);
            Self::schritt(&mut self.ist[POSITIONEN + p], zb, a);
            let (wa, wb) = (self.ist[p], self.ist[POSITIONEN + p]);
            let (zeile, spalte) = (p / SPALTEN, p % SPALTEN);
            let x = e(zeile);
            let o = &mut aus[spalte];
            for v in 0..n {
                o[v] += (wa + (wb - wa) * m[v]) * x[v];
            }
            if wa == 0.0 && wb == 0.0 && za == 0.0 && zb == 0.0 {
                // finished: leaves the list (the last entry takes its place, it is looked at next)
                self.in_liste[p] = false;
                self.n -= 1;
                self.liste[k] = self.liste[self.n];
            } else {
                k += 1;
            }
        }
    }
}
