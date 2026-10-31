//! Leitung (Slice 4f): verzögert um 0 bis `max` Samples, mit Bruchteil. Unter einem Sample linear zwischen den zwei
//! jüngsten Werten, darüber Lagrange 3. Ordnung (`chorus::lagrange4`); ganzzahlige Verzögerungen sind in beiden Zweigen
//! exakt. Geschrieben wird höchstens ±GRENZE, nicht Endliches als 0 und Denormales als 0: eine Rückkopplung über 1 ohne
//! Sättigung bleibt so beschränkt. Der Puffer wird in `neu` angefordert, nie im Lauf.
use crate::chorus::lagrange4;

/// Betrag, auf den jeder geschriebene Wert begrenzt wird (+12 dBFS)
pub const GRENZE: f32 = 4.0;
/// kleiner als das wird 0
const NULL: f32 = 1e-30;

pub struct Leitung {
    buf: Vec<f32>,
    maske: usize,
    pos: usize,
    max: f64,
}

impl Leitung {
    /// `max` größte Verzögerung in Samples
    pub fn neu(max: usize) -> Self {
        let laenge = (max + 4).next_power_of_two();
        Leitung { buf: vec![0.0; laenge], maske: laenge - 1, pos: 0, max: max as f64 }
    }

    /// Schreibt `x` und liest den Wert von vor `verz` Samples (0 = `x` selbst); `verz` wird auf 0..max geklemmt,
    /// nicht Endliches gilt als `max`
    #[inline]
    pub fn prozess(&mut self, x: f32, verz: f64) -> f32 {
        let x = if x.is_finite() { x.clamp(-GRENZE, GRENZE) } else { 0.0 };
        let x = if x.abs() < NULL { 0.0 } else { x };
        self.pos = (self.pos + 1) & self.maske;
        self.buf[self.pos] = x;
        let e = if verz.is_finite() { verz.clamp(0.0, self.max) } else { self.max };
        if e < 1.0 {
            let a = self.buf[self.pos] as f64;
            let b = self.buf[self.pos.wrapping_sub(1) & self.maske] as f64;
            (a + (b - a) * e) as f32
        } else {
            lagrange4(&self.buf, self.maske, self.pos, e)
        }
    }

    pub fn zuruecksetzen(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
        self.pos = 0;
    }
}
