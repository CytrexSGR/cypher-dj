//! DSP der RB-338 (Kreativ-Werkstatt W1). Ohne Host, ohne Allokation pro Sample; offline messbar (tests/messen.rs).
//! `parameter`: die Parameterschicht des Plugins ohne nih-plug, für die RB-FFI im Kern (D1 K2a).
pub mod filter;
pub mod huellkurve;
pub mod noten;
pub mod osz;
pub mod parameter;
pub mod stimme;
pub use filter::Ladder;
pub use osz::Osz;
pub use stimme::{Stimme, StimmParams, ACCENT_AB};
