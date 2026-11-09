//! Mono-Notenlogik der 303 (Regeln im Plan Task 3.1): aus den Ereignissen EINES Blocks (nach Zeit sortiert) die Aktionen
//! für die Stimme. Ohne Allokation; der Stapel überlebt die Blockgrenze.

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Ereignis { An { t: u32, note: u8, vel: f32 }, Aus { t: u32, note: u8 } }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Aktion { Nichts, An { t: u32, note: u8, vel: f32, slide: bool }, Aus { t: u32 } }

const TIEFE: usize = 16;

#[derive(Clone, Copy)]
pub struct Stapel { noten: [u8; TIEFE], vel: [f32; TIEFE], n: usize }

impl Default for Stapel {
    fn default() -> Self { Self { noten: [0; TIEFE], vel: [0.0; TIEFE], n: 0 } }
}

impl Stapel {
    pub fn oben(&self) -> Option<(u8, f32)> {
        if self.n == 0 { None } else { Some((self.noten[self.n - 1], self.vel[self.n - 1])) }
    }
    pub fn enthaelt(&self, note: u8) -> bool { self.noten[..self.n].contains(&note) }
    pub fn leeren(&mut self) { self.n = 0; }
    fn entferne(&mut self, note: u8) {
        if let Some(i) = self.noten[..self.n].iter().position(|&k| k == note) {
            self.noten.copy_within(i + 1..self.n, i);
            self.vel.copy_within(i + 1..self.n, i);
            self.n -= 1;
        }
    }
    fn lege(&mut self, note: u8, vel: f32) {
        self.entferne(note);
        if self.n == TIEFE {
            self.noten.copy_within(1..TIEFE, 0);
            self.vel.copy_within(1..TIEFE, 0);
            self.n -= 1;
        }
        self.noten[self.n] = note;
        self.vel[self.n] = vel;
        self.n += 1;
    }
}

fn zeit(e: &Ereignis) -> u32 { match *e { Ereignis::An { t, .. } | Ereignis::Aus { t, .. } => t } }

/// Schreibt die Aktionen nach `aus` und gibt ihre Anzahl zurück (abgeschnitten bei `aus.len()`).
pub fn plane(ev: &[Ereignis], st: &mut Stapel, aus: &mut [Aktion]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < ev.len() {
        let t = zeit(&ev[i]);
        let mut j = i;
        while j < ev.len() && zeit(&ev[j]) == t { j += 1; }
        let gruppe = &ev[i..j];
        let vorher = st.oben();
        for e in gruppe { if let Ereignis::Aus { note, .. } = *e { st.entferne(note); } }
        let mut letztes_an = None;
        for e in gruppe { if let Ereignis::An { note, vel, .. } = *e { letztes_an = Some((note, vel)); } }
        let slide = matches!(vorher, Some((k, _)) if st.enthaelt(k));
        for e in gruppe { if let Ereignis::An { note, vel, .. } = *e { st.lege(note, vel); } }
        let aktion = match letztes_an {
            Some((note, vel)) => Some(Aktion::An { t, note, vel, slide }),
            None => match (vorher, st.oben()) {
                (Some((alt, _)), Some((neu, vel))) if alt != neu => Some(Aktion::An { t, note: neu, vel, slide: true }),
                (Some(_), None) => Some(Aktion::Aus { t }),
                _ => None,
            },
        };
        if let Some(a) = aktion { if n < aus.len() { aus[n] = a; n += 1; } }
        i = j;
    }
    n
}
