//! Das JSON-Format `baukasten/2` (liest auch `baukasten/1`): Knoten mit `id` und `art` (dazu feste Werte wie `wert` oder
//! `a`/`d`/`s`/`r`), Kanten `von` "knoten.port" `nach` "knoten.port". Eine Kante mit `"verzoegerung": 1` liest den Wert
//! des vorigen Samples; nur über eine solche Kante darf ein Kreis entstehen (Spec E1). Ein Eingang ohne Kante liest den
//! gleichnamigen festen Wert des Knotens, fehlt der, 0.
//!
//! Neu in /2: `makros` (wiederverwendbare Teilgraphen, Spec E24; ein Knoten `"art": "makro:<name>"` setzt eines ein) und
//! `regler_namen` ({"1": "Cutoff", …}, nur zur Anzeige; der Klang hängt nicht daran).
use serde::Deserialize;
use std::collections::BTreeMap;

pub const FORMAT: &str = "baukasten/2";
/// Formate, die `uebersetze` annimmt
pub const FORMATE: [&str; 2] = ["baukasten/1", "baukasten/2"];

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Graph {
    pub format: String,
    pub name: String,
    #[serde(default = "acht")]
    pub stimmen: usize,
    pub knoten: Vec<Knoten>,
    #[serde(default)]
    pub kanten: Vec<Kante>,
    #[serde(default)]
    pub makros: BTreeMap<String, Makro>,
    #[serde(default)]
    pub regler_namen: BTreeMap<String, String>,
}

fn acht() -> usize { 8 }

#[derive(Debug, Clone, Deserialize)]
pub struct Knoten {
    pub id: String,
    pub art: String,
    /// Feste Werte des Knotens. Welche erlaubt und welche Pflicht sind, steht in `uebersetzen::ARTEN`. Bei einem Makro:
    /// `"port": w` gibt jedem Ziel des Makro-Eingangs `port` den Wert `w`, `"knoten.wert": w` setzt einen Wert innen.
    #[serde(flatten)]
    pub werte: BTreeMap<String, f32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Kante {
    pub von: String,
    pub nach: String,
    #[serde(default)]
    pub verzoegerung: u32,
}

/// Teilgraph mit benannten Ein- und Ausgängen. Innen sind `note`, `ausgang` und weitere Makros nicht erlaubt.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Makro {
    /// Makro-Eingang → ein oder mehrere innere Eingänge ("knoten.port")
    #[serde(default)]
    pub ein: BTreeMap<String, Ziele>,
    /// Makro-Ausgang → ein innerer Ausgang ("knoten.port")
    #[serde(default)]
    pub aus: BTreeMap<String, String>,
    pub knoten: Vec<Knoten>,
    #[serde(default)]
    pub kanten: Vec<Kante>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Ziele {
    Eins(String),
    Viele(Vec<String>),
}

impl Ziele {
    pub fn liste(&self) -> Vec<&str> {
        match self {
            Ziele::Eins(z) => vec![z.as_str()],
            Ziele::Viele(v) => v.iter().map(|z| z.as_str()).collect(),
        }
    }
}

impl Graph {
    pub fn lies(json: &str) -> Result<Graph, String> { serde_json::from_str(json).map_err(|e| e.to_string()) }
}
