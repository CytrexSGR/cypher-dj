//! Cypher Baukasten (Spec docs/specs/2026-10-28-baukasten-design.md): Klang- und Effekt-Graphen aus Grundbausteinen.
//! `format` liest das JSON, `uebersetzen` prüft es und macht daraus ein `Programm` mit fester Rechenreihenfolge.
//! Speicher wird nur beim Übersetzen angefordert; `Programm::sample`, `note_an`, `note_aus`, `alle_aus` und
//! `zuruecksetzen` allokieren nicht (tests/keine_allokation.rs).
pub mod adsr;
pub mod chorus;
pub mod echo;
pub mod format;
pub mod gate;
pub mod kosten;
pub mod leitung;
pub mod limiter;
pub mod lfo;
pub mod makro;
pub mod osz;
pub mod programm;
pub mod svf;
pub mod uebersetzen;

pub use format::{Graph, Kante, Knoten, FORMAT, FORMATE};
pub use kosten::Kosten;
pub use programm::{Programm, MAX_STIMMEN, REGLER};
pub use uebersetzen::{hall_vorgabe, uebersetze, Fehler, ARTEN};
