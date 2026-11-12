//! Cypher Baukasten (Spec docs/specs/2026-10-28-baukasten-design.md): Klang- und Effekt-Graphen aus Grundbausteinen.
//! `format` liest das JSON, `uebersetzen` prüft es und macht daraus ein `Programm` mit fester Rechenreihenfolge.
//! Speicher wird nur beim Übersetzen angefordert; `Programm::sample`, `note_an`, `note_aus`, `alle_aus` und
//! `zuruecksetzen` allokieren nicht (tests/keine_allokation.rs).
pub mod adsr;
pub mod chorus;
pub mod echo;
pub mod faltung;
pub mod format;
pub mod gate;
pub mod kosten;
pub mod krume;
pub mod leitung;
pub mod limiter;
pub mod lfo;
pub mod makro;
pub mod osz;
pub mod phaser;
pub mod programm;
pub mod proben;
pub mod roehre;
pub mod sampler;
pub mod svf;
pub mod sem;
pub mod diode;
pub mod uebersetzen;
pub mod vocoder;
pub mod wavetable;
pub mod resonator;
pub mod metall;
pub mod fm;
pub mod granular;
pub mod saite;
pub mod sh;
pub mod mseg;
pub mod folger;
pub mod kamm;
pub mod formant;
pub mod ms20;
pub mod wahl;
pub mod zweige;
pub mod trommeln;
pub mod falter;
pub mod drift;

pub use format::{Graph, Kante, Knoten, FORMAT, FORMATE};
pub use kosten::Kosten;
pub use programm::{Fehlerprobe, Programm, MAX_STIMMEN, REGLER};
pub use uebersetzen::{hall_vorgabe, uebersetze, uebersetze_mit_wurzel, Fehler, ARTEN};
