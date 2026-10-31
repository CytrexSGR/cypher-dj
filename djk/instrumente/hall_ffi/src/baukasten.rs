//! C-ABI um baukasten_dsp für den djk-Kern (Baukasten S3a): ein Graph als Instrument eines Erzeuger-Stroms. Kopf:
//! djk/kern/include/cypherdj/cypher_bk_ffi.h. In derselben Staticlib wie Hall, Komp und RB-338.
//!
//! `cypher_bk_neu` übersetzt und allokiert (Netz-Faden) und setzt danach zurück: das schreibt jeden Puffer einmal, die
//! Seiten liegen vor dem ersten Callback im Speicher. Alle anderen Aufrufe allokieren nicht. Noten kommen mit
//! Sample-Versatz relativ zum Anfang des nächsten `cypher_bk_block` in eine Warteschlange fester Größe; ein Versatz hinter
//! dem Block wandert in den Folgeblock. Am selben Sample: alle_aus vor aus vor an, sonst in Meldereihenfolge. Ein Panic
//! im Block kommt nicht über die Grenze: Stille, Zurücksetzen, Warteschlange leer, `panik` zählt.
use baukasten_dsp::{uebersetze, Programm, REGLER};
use std::ffi::{c_char, CStr};
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Ereignisse bis zum nächsten Block (wie RB_MAX_EREIGNISSE). Mehr meldet `-1` und zählt `verloren`.
pub const BK_MAX_EREIGNISSE: usize = 256;

#[derive(Clone, Copy)]
enum Ev {
    AlleAus { t: u32 },
    Aus { t: u32, ton: u8 },
    An { t: u32, ton: u8, vel: f32 },
}

impl Ev {
    fn t(&self) -> u32 {
        match *self {
            Ev::AlleAus { t } | Ev::Aus { t, .. } | Ev::An { t, .. } => t,
        }
    }
    /// am selben Sample: alle_aus (0) vor aus (1) vor an (2)
    fn rang(&self) -> u8 {
        match self {
            Ev::AlleAus { .. } => 0,
            Ev::Aus { .. } => 1,
            Ev::An { .. } => 2,
        }
    }
    fn verschiebe(&mut self, n: u32) {
        match self {
            Ev::AlleAus { t } | Ev::Aus { t, .. } | Ev::An { t, .. } => *t -= n,
        }
    }
}

pub struct CypherBk {
    p: Programm,
    warte: [Ev; BK_MAX_EREIGNISSE],
    n_warte: usize,
    verloren: u32,
    panik: u32,
    /// Reglerziele 0..1 (S5r), gesetzt von `cypher_bk_regler`
    ziel: [f32; REGLER],
    /// geglätteter Reglerstand, der am Programm liegt
    ist: [f32; REGLER],
    /// Einpol-Koeffizient für 20 ms: 1 - exp(-1 / (0,020 · fs))
    a: f32,
}

/// Reglerzeit wie im Plugin (`baukasten/src/lib.rs`: „20 ms geglättet“)
const REGLER_GLATT_S: f64 = 0.020;
/// Näher als das am Ziel rastet `ist` auf `ziel` ein (S5r K4), ebenso wenn ein Schritt `ist` nicht mehr bewegt. Das
/// Einpol-Filter erreicht in float32 sein Ziel nie (a·d unterschreitet das halbe ulp schon bei d ≈ 3e-5 > 1e-5,
/// gemessen: stand bei 0,89997137 für Ziel 0,9), ohne Einrasten bliebe `ist` knapp daneben und `setze_regler`
/// liefe in jedem Sample weiter.
const REGLER_EINRASTEN: f32 = 1e-5;

impl CypherBk {
    /// Je Sample: `ist` zieht einpolig auf `ziel`, rastet unter `REGLER_EINRASTEN` ein (ein letztes `setze_regler`);
    /// steht `ist` bitgleich auf `ziel`, kostet der Regler nur den Vergleich.
    #[inline]
    fn regler_schritt(&mut self) {
        for i in 0..REGLER {
            if self.ist[i] == self.ziel[i] {
                continue;
            }
            let d = self.ziel[i] - self.ist[i];
            let schritt = self.ist[i] + self.a * d;
            self.ist[i] = if d.abs() < REGLER_EINRASTEN || schritt == self.ist[i] { self.ziel[i] } else { schritt };
            self.p.setze_regler(i + 1, self.ist[i]);
        }
    }

    fn melde(&mut self, e: Ev) -> i32 {
        if self.n_warte >= BK_MAX_EREIGNISSE {
            self.verloren += 1;
            return -1;
        }
        self.warte[self.n_warte] = e;
        self.n_warte += 1;
        0
    }

    fn block(&mut self, ein: Option<(&[f32], &[f32])>, l: &mut [f32], r: &mut [f32]) {
        let n = l.len();
        // stabil nach (Versatz, Rang) sortieren, Einfügen ohne Allokation
        for i in 1..self.n_warte {
            let mut j = i;
            while j > 0 && (self.warte[j - 1].t(), self.warte[j - 1].rang()) > (self.warte[j].t(), self.warte[j].rang()) {
                self.warte.swap(j - 1, j);
                j -= 1;
            }
        }
        let mut k = 0;
        for i in 0..n {
            while k < self.n_warte && self.warte[k].t() as usize <= i {
                match self.warte[k] {
                    Ev::AlleAus { .. } => self.p.alle_aus(),
                    Ev::Aus { ton, .. } => self.p.note_aus(ton),
                    Ev::An { ton, vel, .. } => self.p.note_an(ton, vel),
                }
                k += 1;
            }
            self.regler_schritt();
            if let Some((el, er)) = ein {
                self.p.setze_eingang(el[i], er[i]);
            }
            let (a, b) = self.p.sample_stereo();
            l[i] = a;
            r[i] = b;
        }
        let mut w = 0;
        for j in k..self.n_warte {
            let mut e = self.warte[j];
            e.verschiebe(n as u32);
            self.warte[w] = e;
            w += 1;
        }
        self.n_warte = w;
    }
}

fn schreibe_fehler(ziel: *mut c_char, laenge: usize, text: &str) {
    if ziel.is_null() || laenge == 0 {
        return;
    }
    let b = text.as_bytes();
    let n = b.len().min(laenge - 1);
    // SAFETY: der Aufrufer garantiert `laenge` beschreibbare Bytes ab `ziel`
    unsafe {
        std::ptr::copy_nonoverlapping(b.as_ptr(), ziel as *mut u8, n);
        *ziel.add(n) = 0;
    }
}

/// Übersetzt den Graphen `json` (UTF-8, nullterminiert) für die Rate `fs`. Fehler: nullptr und Text in `fehler`
/// (höchstens `fehler_laenge` Bytes mit Null; `fehler` darf null sein). Allokiert: nur außerhalb des Callbacks.
#[no_mangle]
pub extern "C" fn cypher_bk_neu(json: *const c_char, fs: f64, fehler: *mut c_char, fehler_laenge: usize) -> *mut CypherBk {
    if json.is_null() || !(fs.is_finite() && fs > 0.0) {
        schreibe_fehler(fehler, fehler_laenge, "json null oder fs ungültig");
        return std::ptr::null_mut();
    }
    // SAFETY: json ist nullterminiert (Vertrag des Kopfes)
    let text = unsafe { CStr::from_ptr(json) };
    let r = catch_unwind(|| -> Result<Programm, String> {
        let s = text.to_str().map_err(|e| format!("kein UTF-8: {e}"))?;
        let mut p = uebersetze(s, fs as f32).map_err(|e| e.to_string())?;
        p.zuruecksetzen();
        Ok(p)
    });
    match r {
        Ok(Ok(p)) => Box::into_raw(Box::new(CypherBk {
            p,
            warte: [Ev::AlleAus { t: 0 }; BK_MAX_EREIGNISSE],
            n_warte: 0,
            verloren: 0,
            panik: 0,
            ziel: [0.5; REGLER],
            ist: [0.5; REGLER],
            a: (1.0 - (-1.0 / (REGLER_GLATT_S * fs)).exp()) as f32,
        })),
        Ok(Err(e)) => {
            schreibe_fehler(fehler, fehler_laenge, &e);
            std::ptr::null_mut()
        }
        Err(_) => {
            schreibe_fehler(fehler, fehler_laenge, "Panic beim Übersetzen");
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "C" fn cypher_bk_frei(h: *mut CypherBk) {
    if !h.is_null() {
        // SAFETY: h stammt aus cypher_bk_neu und wird genau einmal freigegeben
        drop(unsafe { Box::from_raw(h) });
    }
}

/// `vel` 0..1 (geklemmt, NaN wird 0). Rückgabe 0, -1 voll oder h null, -2 Ton über 127.
#[no_mangle]
pub extern "C" fn cypher_bk_note_an(h: *mut CypherBk, versatz: u32, ton: u8, vel: f32) -> i32 {
    // SAFETY: h aus cypher_bk_neu oder null, kein nebenläufiger Aufruf (Vertrag des Kopfes)
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if ton > 127 {
        return -2;
    }
    let vel = if vel.is_finite() { vel.clamp(0.0, 1.0) } else { 0.0 };
    bk.melde(Ev::An { t: versatz, ton, vel })
}

#[no_mangle]
pub extern "C" fn cypher_bk_note_aus(h: *mut CypherBk, versatz: u32, ton: u8) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if ton > 127 {
        return -2;
    }
    bk.melde(Ev::Aus { t: versatz, ton })
}

#[no_mangle]
pub extern "C" fn cypher_bk_alle_aus(h: *mut CypherBk, versatz: u32) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    bk.melde(Ev::AlleAus { t: versatz })
}

/// Reglerziel `nr` (1..8) auf `wert` (0..1, geklemmt; NaN wird ignoriert). Der Graph folgt in 20 ms einpolig (Zeit aus
/// `fs`). Rückgabe 0, -1 bei h null oder nr außerhalb. Allokiert nicht; nicht nebenläufig mit block.
#[no_mangle]
pub extern "C" fn cypher_bk_regler(h: *mut CypherBk, nr: u32, wert: f32) -> i32 {
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else { return -1 };
    if !(1..=REGLER as u32).contains(&nr) {
        return -1;
    }
    if !wert.is_nan() {
        bk.ziel[nr as usize - 1] = wert.clamp(0.0, 1.0);
    }
    0
}

/// Rechnet `n` Samples Stereo in `aus_l`/`aus_r` (überschreibt). h null: Stille, Rückgabe 0. Panic: Stille,
/// Zurücksetzen, Rückgabe -1.
#[no_mangle]
pub extern "C" fn cypher_bk_block(h: *mut CypherBk, aus_l: *mut f32, aus_r: *mut f32, n: usize) -> i32 {
    if aus_l.is_null() || aus_r.is_null() || n == 0 {
        return 0;
    }
    // SAFETY: n beschreibbare floats je Kanal (Vertrag des Kopfes), Kanäle überlappen nicht
    let (l, r) = unsafe { (std::slice::from_raw_parts_mut(aus_l, n), std::slice::from_raw_parts_mut(aus_r, n)) };
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else {
        l.fill(0.0);
        r.fill(0.0);
        return 0;
    };
    if catch_unwind(AssertUnwindSafe(|| bk.block(None, &mut *l, &mut *r))).is_ok() {
        return 0;
    }
    bk.p.zuruecksetzen();
    bk.n_warte = 0;
    bk.panik += 1;
    l.fill(0.0);
    r.fill(0.0);
    -1
}

/// Effekt-Block (S3c): ein_l/ein_r sind das Host-Audio, aus_l/aus_r werden überschrieben. Eingang und Ausgang dürfen
/// sich nicht überlappen. h null: Stille. Panic: wie cypher_bk_block.
#[no_mangle]
pub extern "C" fn cypher_bk_effekt(h: *mut CypherBk, ein_l: *const f32, ein_r: *const f32, aus_l: *mut f32,
                                   aus_r: *mut f32, n: usize) -> i32 {
    if ein_l.is_null() || ein_r.is_null() || aus_l.is_null() || aus_r.is_null() || n == 0 {
        return 0;
    }
    // SAFETY: n lesbare bzw. beschreibbare floats je Kanal (Vertrag des Kopfes), Ein- und Ausgang überlappen nicht
    let (el, er) = unsafe { (std::slice::from_raw_parts(ein_l, n), std::slice::from_raw_parts(ein_r, n)) };
    let (l, r) = unsafe { (std::slice::from_raw_parts_mut(aus_l, n), std::slice::from_raw_parts_mut(aus_r, n)) };
    // SAFETY: wie cypher_bk_note_an
    let Some(bk) = (unsafe { h.as_mut() }) else {
        l.fill(0.0);
        r.fill(0.0);
        return 0;
    };
    if catch_unwind(AssertUnwindSafe(|| bk.block(Some((el, er)), &mut *l, &mut *r))).is_ok() {
        return 0;
    }
    bk.p.zuruecksetzen();
    bk.n_warte = 0;
    bk.panik += 1;
    l.fill(0.0);
    r.fill(0.0);
    -1
}

/// Takt für die folgenden Blöcke (S3c): beat0 = Beat des ersten Samples des nächsten Blocks, bps = Beats je Sample.
/// h null oder ungültige Werte: ohne Wirkung. Allokiert nicht.
#[no_mangle]
pub extern "C" fn cypher_bk_takt(h: *mut CypherBk, beat0: f64, bps: f64) {
    // SAFETY: wie cypher_bk_note_an
    if let Some(bk) = unsafe { h.as_mut() } {
        bk.p.setze_takt(beat0, bps);
    }
}

/// 1, wenn der Graph einen Knoten `eingang` hat (Effekt), sonst 0; h null: 0
#[no_mangle]
pub extern "C" fn cypher_bk_hat_eingang(h: *const CypherBk) -> u32 {
    // SAFETY: wie cypher_bk_latenz
    unsafe { h.as_ref() }.map_or(0, |b| b.p.hat_eingang() as u32)
}

/// Latenz des Graphen in Samples (Programm::latenz), h null: 0
#[no_mangle]
pub extern "C" fn cypher_bk_latenz(h: *const CypherBk) -> u32 {
    // SAFETY: h aus cypher_bk_neu oder null
    unsafe { h.as_ref() }.map_or(0, |b| b.p.latenz() as u32)
}

/// Wächter-Eingriffe des Graphen (Programm::rettungen), h null: 0
#[no_mangle]
pub extern "C" fn cypher_bk_rettungen(h: *const CypherBk) -> u32 {
    // SAFETY: wie cypher_bk_latenz
    unsafe { h.as_ref() }.map_or(0, |b| b.p.rettungen)
}

#[no_mangle]
pub extern "C" fn cypher_bk_verloren(h: *const CypherBk) -> u32 {
    // SAFETY: wie cypher_bk_latenz
    unsafe { h.as_ref() }.map_or(0, |b| b.verloren)
}

#[no_mangle]
pub extern "C" fn cypher_bk_panik(h: *const CypherBk) -> u32 {
    // SAFETY: wie cypher_bk_latenz
    unsafe { h.as_ref() }.map_or(0, |b| b.panik)
}
