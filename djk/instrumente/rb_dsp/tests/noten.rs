use rb_dsp::noten::{plane, Aktion, Ereignis, Stapel};

fn lauf(ev: &[Ereignis]) -> Vec<Aktion> {
    let mut st = Stapel::default();
    let mut a = [Aktion::Nichts; 64];
    let n = plane(ev, &mut st, &mut a);
    a[..n].to_vec()
}
fn an(t: u32, note: u8, vel: f32) -> Ereignis { Ereignis::An { t, note, vel } }
fn aus(t: u32, note: u8) -> Ereignis { Ereignis::Aus { t, note } }
fn a(t: u32, note: u8, vel: f32, slide: bool) -> Aktion { Aktion::An { t, note, vel, slide } }

#[test]
fn ueberlappung_ist_slide_und_aus_der_aelteren_ist_still() {
    assert_eq!(lauf(&[an(0, 45, 0.6), an(100, 47, 0.6), aus(200, 45), aus(300, 47)]),
               vec![a(0, 45, 0.6, false), a(100, 47, 0.6, true), Aktion::Aus { t: 300 }]);
}

#[test]
fn gleicher_zeitstempel_ist_neuanschlag_beide_reihenfolgen() {
    let x = lauf(&[an(0, 45, 0.6), an(100, 47, 0.6), aus(100, 45)]);
    let y = lauf(&[an(0, 45, 0.6), aus(100, 45), an(100, 47, 0.6)]);
    assert_eq!(x, vec![a(0, 45, 0.6, false), a(100, 47, 0.6, false)]);
    assert_eq!(x, y);
}

#[test]
fn dritte_note_gehalten_reihenfolge_egal() {
    let x = lauf(&[an(0, 40, 0.6), an(10, 45, 0.6), an(100, 47, 0.6), aus(100, 45)]);
    let y = lauf(&[an(0, 40, 0.6), an(10, 45, 0.6), aus(100, 45), an(100, 47, 0.6)]);
    assert_eq!(x, y);
    assert_eq!(x.last(), Some(&a(100, 47, 0.6, false)));
}

#[test]
fn gleiche_note_wiederholt_ist_neuanschlag() {
    assert_eq!(lauf(&[an(0, 45, 0.6), aus(100, 45), an(100, 45, 0.6)]),
               vec![a(0, 45, 0.6, false), a(100, 45, 0.6, false)]);
}

#[test]
fn zurueck_zur_zuletzt_gehaltenen_nicht_zur_hoechsten() {
    // 50, 45, 47 an; 47 los → 45 (zuletzt davor), nicht 50 (höchste)
    let x = lauf(&[an(0, 50, 0.6), an(10, 45, 0.6), an(20, 47, 0.6), aus(30, 47)]);
    assert_eq!(x.last(), Some(&a(30, 45, 0.6, true)));
}

#[test]
fn zurueckgleiten_nimmt_die_gespeicherte_velocity() {
    let x = lauf(&[an(0, 45, 1.0), an(10, 47, 0.6), aus(20, 47)]);
    assert_eq!(x.last(), Some(&a(20, 45, 1.0, true)));
}

#[test]
fn gehalten_ueber_blockgrenze() {
    let mut st = Stapel::default();
    let mut a1 = [Aktion::Nichts; 4];
    plane(&[an(500, 45, 0.6)], &mut st, &mut a1);
    let n = plane(&[an(3, 47, 0.6)], &mut st, &mut a1);
    assert_eq!(&a1[..n], &[a(3, 47, 0.6, true)]);
}

#[test]
fn stapel_voll_verliert_die_aelteste() {
    let mut ev: Vec<Ereignis> = (0..17u8).map(|i| an(i as u32, 30 + i, 0.6)).collect();
    ev.extend((1..17u8).map(|i| aus(100 + i as u32, 30 + i)));
    let x = lauf(&ev);
    assert_eq!(x.last(), Some(&Aktion::Aus { t: 116 }), "Note 30 fiel heraus, also ist nach 16 Aus alles still");
}
