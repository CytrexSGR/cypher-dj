//! Makros auflösen (Spec E24): jeder Knoten `"art": "makro:<name>"` wird beim Laden durch die Knoten des Makros ersetzt,
//! mit IDs `<instanz>/<knoten>`. Im Lauf gibt es keine Makros mehr, nur einen flachen Graphen (kein Aufwand im Callback).
//! Kanten an `<instanz>.<port>` gehen an die inneren Ziele aus `ein` bzw. kommen vom inneren Ausgang aus `aus`.
use crate::format::{Graph, Kante, Knoten};
use crate::uebersetzen::Fehler;
use std::collections::BTreeMap;

const PRAEFIX: &str = "makro:";

pub fn aufloesen(g: Graph) -> Result<Graph, Fehler> {
    for k in &g.knoten {
        if k.id.contains('.') || k.id.contains('/') || k.id.is_empty() {
            return Err(Fehler::Id(k.id.clone()));
        }
    }
    for (name, m) in &g.makros {
        for k in &m.knoten {
            if k.id.contains('.') || k.id.contains('/') || k.id.is_empty() {
                return Err(Fehler::Id(format!("{name}: {}", k.id)));
            }
            if k.art.starts_with(PRAEFIX) || k.art == "note" || k.art == "ausgang" || k.art == "eingang" {
                return Err(Fehler::MakroInhalt { makro: name.clone(), knoten: k.id.clone(), art: k.art.clone() });
            }
        }
        let innen = |adr: &str| -> Result<(), Fehler> {
            let (kn, _) = adr.split_once('.').ok_or_else(|| Fehler::Adresse(format!("{name}: {adr}")))?;
            if m.knoten.iter().any(|k| k.id == kn) { Ok(()) } else { Err(Fehler::UnbekannterKnoten(format!("{name}: {kn}"))) }
        };
        for z in m.ein.values().flat_map(|z| z.liste()) {
            innen(z)?;
        }
        for z in m.aus.values() {
            innen(z)?;
        }
    }
    // Instanz-ID → Makro
    let mut instanz: BTreeMap<&str, &crate::format::Makro> = BTreeMap::new();
    for k in &g.knoten {
        if let Some(name) = k.art.strip_prefix(PRAEFIX) {
            let m = g.makros.get(name).ok_or_else(|| Fehler::UnbekannterMakro { knoten: k.id.clone(), makro: name.to_string() })?;
            instanz.insert(k.id.as_str(), m);
        }
    }
    if instanz.is_empty() {
        return Ok(Graph { makros: BTreeMap::new(), ..g });
    }
    let mut knoten: Vec<Knoten> = Vec::new();
    let mut kanten: Vec<Kante> = Vec::new();
    for k in &g.knoten {
        let Some(m) = instanz.get(k.id.as_str()) else {
            knoten.push(k.clone());
            continue;
        };
        let mut innen: Vec<Knoten> = m.knoten.iter().map(|ik| Knoten { id: format!("{}/{}", k.id, ik.id), ..ik.clone() }).collect();
        for (schluessel, w) in &k.werte {
            let ziele: Vec<(String, String)> = match schluessel.split_once('.') {
                Some((ik, wert)) => vec![(ik.to_string(), wert.to_string())],
                None => m.ein.get(schluessel)
                    .ok_or_else(|| Fehler::UnbekannterWert { knoten: k.id.clone(), wert: schluessel.clone() })?
                    .liste().iter()
                    .map(|z| { let (a, b) = z.split_once('.').unwrap(); (a.to_string(), b.to_string()) })
                    .collect(),
            };
            for (ik, wert) in ziele {
                let ziel = innen.iter_mut().find(|n| n.id == format!("{}/{}", k.id, ik))
                    .ok_or_else(|| Fehler::UnbekannterWert { knoten: k.id.clone(), wert: schluessel.clone() })?;
                ziel.werte.insert(wert, *w);
            }
        }
        knoten.extend(innen);
        for e in &m.kanten {
            kanten.push(Kante { von: format!("{}/{}", k.id, e.von), nach: format!("{}/{}", k.id, e.nach), verzoegerung: e.verzoegerung });
        }
    }
    for e in &g.kanten {
        let von = match e.von.split_once('.') {
            Some((kn, port)) => match instanz.get(kn) {
                Some(m) => format!("{kn}/{}", m.aus.get(port).ok_or_else(|| Fehler::UnbekannterPort(e.von.clone()))?),
                None => e.von.clone(),
            },
            None => return Err(Fehler::Adresse(e.von.clone())),
        };
        match e.nach.split_once('.') {
            Some((kn, port)) => match instanz.get(kn) {
                Some(m) => {
                    for z in m.ein.get(port).ok_or_else(|| Fehler::UnbekannterPort(e.nach.clone()))?.liste() {
                        kanten.push(Kante { von: von.clone(), nach: format!("{kn}/{z}"), verzoegerung: e.verzoegerung });
                    }
                }
                None => kanten.push(Kante { von, nach: e.nach.clone(), verzoegerung: e.verzoegerung }),
            },
            None => return Err(Fehler::Adresse(e.nach.clone())),
        }
    }
    Ok(Graph { knoten, kanten, makros: BTreeMap::new(), ..g })
}
