/// xorshift64*: schnell, ohne Speicher, reproduzierbar je Samen.
#[derive(Clone)]
pub struct Zufall(u64);

impl Zufall {
    pub fn neu(samen: u64) -> Self {
        Zufall(samen.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    #[inline]
    pub fn u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Gleichverteilt in [−1, 1).
    #[inline]
    pub fn sym(&mut self) -> f64 {
        (self.u64() >> 11) as f64 / (1u64 << 52) as f64 - 1.0
    }
}
