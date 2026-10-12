//! DSP der RB-338 (Kreativ-Werkstatt W1). Ohne Host, ohne Allokation pro Sample; offline messbar (tests/messen.rs).
pub mod filter;
pub mod huellkurve;
pub mod noten;
pub mod osz;
pub mod stimme;
pub use filter::Ladder;
pub use osz::Osz;
pub use stimme::{Stimme, StimmParams, ACCENT_AB};
