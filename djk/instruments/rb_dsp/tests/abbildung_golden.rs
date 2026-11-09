//! Golden table of Def::wert (normalised 0..1 -> parameter value) at 11 points per parameter. Writes nothing. The same table is pinned in
//! djk/ui/project/rb_mapping.ts (test tests/project_rb_mapping.test.mjs), so the project server's mapping between the
//! project values (0..1) and the display units of the presets cannot drift away from this crate unnoticed (package 1.9, O28, T4.3).
//! The table was produced once by printing `d.wert(i / 10)` for i = 0..=10 of every entry of `defs()` (f32, `{:?}` round-trips).
use rb_dsp::parameter::defs;

const GOLD: [(&str, [f32; 11]); 7] = [
    ("lautstaerke", [0.003981071, 0.0040649557, 0.005394437, 0.011355927, 0.02779478, 0.063095726, 0.12823954, 0.23684719, 0.40521672, 0.65235376, 1.0]),
    ("wellenform", [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
    ("cutoff", [40.0, 40.496, 47.936, 80.17601, 166.97601, 350.0, 682.8161, 1230.8959, 2071.6162, 3294.2556, 5000.0]),
    ("resonanz", [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]),
    ("env_mod", [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]),
    ("decay", [0.2, 0.21800001, 0.272, 0.362, 0.48800004, 0.65, 0.848, 1.082, 1.3520001, 1.6579999, 2.0]),
    ("accent", [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]),
];

#[test]
fn abbildung_golden() {
    let d = defs();
    assert_eq!(d.len(), GOLD.len());
    for (def, (id, werte)) in d.iter().zip(GOLD.iter()) {
        assert_eq!(def.id, *id, "order of the parameters");
        for (i, soll) in werte.iter().enumerate() {
            let ist = def.wert(i as f32 / 10.0);
            assert_eq!(ist, *soll, "{id} at {}/10: {ist:?} vs {soll:?}", i);
        }
    }
}

// Negative control: a table that is NOT the mapping must be refused (a linear cutoff differs at the 0.5 point by a wide margin)
#[test]
fn abbildung_golden_gegenprobe() {
    let cutoff = defs()[2];
    assert!((cutoff.wert(0.5) - 2520.0).abs() > 1000.0, "the cutoff map is skewed, not linear: {}", cutoff.wert(0.5));
}
