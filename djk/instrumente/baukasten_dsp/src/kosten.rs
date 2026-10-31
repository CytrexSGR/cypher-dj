//! Kostenzähler je Graph (Spec E20): Blockdauer in Mikrosekunden als Histogramm mit festen Fächern, ohne Allokation.
//! Quantile werden als obere Fachgrenze gelesen, also eher zu hoch als zu niedrig.

pub const FAECHER: usize = 256;
/// Fach i deckt [i·5, (i+1)·5) µs; das letzte Fach nimmt alles ab 1275 µs.
pub const BREITE_US: f64 = 5.0;

#[derive(Clone, Copy)]
pub struct Kosten {
    faecher: [u64; FAECHER],
    pub bloecke: u64,
    pub max_us: f64,
}

impl Default for Kosten {
    fn default() -> Self { Self { faecher: [0; FAECHER], bloecke: 0, max_us: 0.0 } }
}

impl Kosten {
    #[inline]
    pub fn buche(&mut self, us: f64) {
        let i = ((us.max(0.0) / BREITE_US) as usize).min(FAECHER - 1);
        self.faecher[i] += 1;
        self.bloecke += 1;
        if us > self.max_us {
            self.max_us = us;
        }
    }

    /// Quantil q (0..1) als obere Fachgrenze in µs; 0 ohne gebuchte Blöcke.
    pub fn quantil_us(&self, q: f64) -> f64 {
        if self.bloecke == 0 {
            return 0.0;
        }
        let ziel = ((q * self.bloecke as f64).ceil() as u64).max(1);
        let mut summe = 0u64;
        for (i, n) in self.faecher.iter().enumerate() {
            summe += n;
            if summe >= ziel {
                return (i + 1) as f64 * BREITE_US;
            }
        }
        FAECHER as f64 * BREITE_US
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leer_ist_null() { assert_eq!(Kosten::default().quantil_us(0.99), 0.0); }

    #[test]
    fn quantile_aus_dem_histogramm() {
        let mut k = Kosten::default();
        for _ in 0..990 { k.buche(12.0); } // Fach 2: [10, 15)
        for _ in 0..10 { k.buche(503.0); } // Fach 100: [500, 505)
        assert_eq!(k.quantil_us(0.5), 15.0);
        assert_eq!(k.quantil_us(0.99), 15.0);
        assert_eq!(k.quantil_us(0.999), 505.0);
        assert_eq!(k.max_us, 503.0);
        assert_eq!(k.bloecke, 1000);
    }

    #[test]
    fn ueberlauf_landet_im_letzten_fach() {
        let mut k = Kosten::default();
        k.buche(1e6);
        assert_eq!(k.quantil_us(1.0), FAECHER as f64 * BREITE_US);
    }
}
