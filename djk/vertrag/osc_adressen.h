// ERZEUGT von djk/vertrag/erzeuge_osc.py aus djk/vertrag/osc.json. Nicht von Hand ändern.
// Vertrag: docs/architektur/SCHNITTSTELLEN.md, Version 1. Prüfung: python3 djk/vertrag/pruefe_osc.py
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace cypherdj::osc {

inline constexpr int vertrag = 1;

enum class Richtung : std::uint8_t { an_kern, vom_kern, von_notbahn };

struct Adresse {
  std::string_view pfad;
  std::string_view typen;
  Richtung richtung;
  bool nur_pruefmodus;
  std::size_t felder;
};

// §4.1 /k/hallo ,sii
inline constexpr Adresse k_hallo{"/k/hallo", ",sii", Richtung::an_kern, false, 3};
static_assert(k_hallo.typen.size() - 1 == k_hallo.felder);
// §4.1 /k/tschuess ,s
inline constexpr Adresse k_tschuess{"/k/tschuess", ",s", Richtung::an_kern, false, 1};
static_assert(k_tschuess.typen.size() - 1 == k_tschuess.felder);
// §4.1 /k/willkommen ,iihdds
inline constexpr Adresse k_willkommen{"/k/willkommen", ",iihdds", Richtung::vom_kern, false, 6};
static_assert(k_willkommen.typen.size() - 1 == k_willkommen.felder);
// §4.2 /k/set/neu ,hsd
inline constexpr Adresse k_set_neu{"/k/set/neu", ",hsd", Richtung::an_kern, false, 3};
static_assert(k_set_neu.typen.size() - 1 == k_set_neu.felder);
// §4.2 /k/tempo/rampe ,hsddd
inline constexpr Adresse k_tempo_rampe{"/k/tempo/rampe", ",hsddd", Richtung::an_kern, false, 5};
static_assert(k_tempo_rampe.typen.size() - 1 == k_tempo_rampe.felder);
// §4.2 /k/storno ,hsh
inline constexpr Adresse k_storno{"/k/storno", ",hsh", Richtung::an_kern, false, 3};
static_assert(k_storno.typen.size() - 1 == k_storno.felder);
// §4.3 /k/teil ,hssisddfiiss
inline constexpr Adresse k_teil{"/k/teil", ",hssisddfiiss", Richtung::an_kern, false, 12};
static_assert(k_teil.typen.size() - 1 == k_teil.felder);
// §4.3 /k/abbruch ,hsss
inline constexpr Adresse k_abbruch{"/k/abbruch", ",hsss", Richtung::an_kern, false, 4};
static_assert(k_abbruch.typen.size() - 1 == k_abbruch.felder);
// §4.4 /k/deck/laden ,hsisdii
inline constexpr Adresse k_deck_laden{"/k/deck/laden", ",hsisdii", Richtung::an_kern, false, 7};
static_assert(k_deck_laden.typen.size() - 1 == k_deck_laden.felder);
// §4.4 /k/deck/entladen ,hsi
inline constexpr Adresse k_deck_entladen{"/k/deck/entladen", ",hsi", Richtung::an_kern, false, 3};
static_assert(k_deck_entladen.typen.size() - 1 == k_deck_entladen.felder);
// §4.4 /k/deck/start ,hssssiddi
inline constexpr Adresse k_deck_start{"/k/deck/start", ",hssssiddi", Richtung::an_kern, false, 9};
static_assert(k_deck_start.typen.size() - 1 == k_deck_start.felder);
// §4.4 /k/deck/stopp ,hssssidi
inline constexpr Adresse k_deck_stopp{"/k/deck/stopp", ",hssssidi", Richtung::an_kern, false, 8};
static_assert(k_deck_stopp.typen.size() - 1 == k_deck_stopp.felder);
// §4.4 /k/deck/loop ,hssssiddid
inline constexpr Adresse k_deck_loop{"/k/deck/loop", ",hssssiddid", Richtung::an_kern, false, 10};
static_assert(k_deck_loop.typen.size() - 1 == k_deck_loop.felder);
// §4.4 /k/deck/roll ,hssssiddiid
inline constexpr Adresse k_deck_roll{"/k/deck/roll", ",hssssiddiid", Richtung::an_kern, false, 11};
static_assert(k_deck_roll.typen.size() - 1 == k_deck_roll.felder);
// §4.4 /k/deck/sprung ,hssssiddid
inline constexpr Adresse k_deck_sprung{"/k/deck/sprung", ",hssssiddid", Richtung::an_kern, false, 10};
static_assert(k_deck_sprung.typen.size() - 1 == k_deck_sprung.felder);
// §4.4 /k/deck/hotcue ,hssssidiid
inline constexpr Adresse k_deck_hotcue{"/k/deck/hotcue", ",hssssidiid", Richtung::an_kern, false, 10};
static_assert(k_deck_hotcue.typen.size() - 1 == k_deck_hotcue.felder);
// §4.4 /k/deck/hotcue_setzen ,hsiid
inline constexpr Adresse k_deck_hotcue_setzen{"/k/deck/hotcue_setzen", ",hsiid", Richtung::an_kern, false, 5};
static_assert(k_deck_hotcue_setzen.typen.size() - 1 == k_deck_hotcue_setzen.felder);
// §4.4 /k/deck/raster ,hsisdii
inline constexpr Adresse k_deck_raster{"/k/deck/raster", ",hsisdii", Richtung::an_kern, false, 7};
static_assert(k_deck_raster.typen.size() - 1 == k_deck_raster.felder);
// §4.4 /k/deck/slip ,hsii
inline constexpr Adresse k_deck_slip{"/k/deck/slip", ",hsii", Richtung::an_kern, false, 4};
static_assert(k_deck_slip.typen.size() - 1 == k_deck_slip.felder);
// §4.4 /k/deck/basis_tausch ,hsidid
inline constexpr Adresse k_deck_basis_tausch{"/k/deck/basis_tausch", ",hsidid", Richtung::an_kern, false, 6};
static_assert(k_deck_basis_tausch.typen.size() - 1 == k_deck_basis_tausch.felder);
// §4.5 /k/hoerschein ,hsssssddddfff
inline constexpr Adresse k_hoerschein{"/k/hoerschein", ",hsssssddddfff", Richtung::an_kern, false, 13};
static_assert(k_hoerschein.typen.size() - 1 == k_hoerschein.felder);
// §4.5 /k/hoerschein/weg ,hss
inline constexpr Adresse k_hoerschein_weg{"/k/hoerschein/weg", ",hss", Richtung::an_kern, false, 3};
static_assert(k_hoerschein_weg.typen.size() - 1 == k_hoerschein_weg.felder);
// §4.6 /k/schuss ,hsdsiiifi
inline constexpr Adresse k_schuss{"/k/schuss", ",hsdsiiifi", Richtung::an_kern, false, 9};
static_assert(k_schuss.typen.size() - 1 == k_schuss.felder);
// §4.7 /k/ki/stopp ,hs
inline constexpr Adresse k_ki_stopp{"/k/ki/stopp", ",hs", Richtung::an_kern, false, 2};
static_assert(k_ki_stopp.typen.size() - 1 == k_ki_stopp.felder);
// §4.7 /k/ki/frei ,hs
inline constexpr Adresse k_ki_frei{"/k/ki/frei", ",hs", Richtung::an_kern, false, 2};
static_assert(k_ki_frei.typen.size() - 1 == k_ki_frei.felder);
// §4.7 /k/ki/spur ,hss
inline constexpr Adresse k_ki_spur{"/k/ki/spur", ",hss", Richtung::an_kern, false, 3};
static_assert(k_ki_spur.typen.size() - 1 == k_ki_spur.felder);
// §4.7 /k/ki/stufe ,hsi
inline constexpr Adresse k_ki_stufe{"/k/ki/stufe", ",hsi", Richtung::an_kern, false, 3};
static_assert(k_ki_stufe.typen.size() - 1 == k_ki_stufe.felder);
// §4.7 /k/vorschlag_kanal ,hss
inline constexpr Adresse k_vorschlag_kanal{"/k/vorschlag_kanal", ",hss", Richtung::an_kern, false, 3};
static_assert(k_vorschlag_kanal.typen.size() - 1 == k_vorschlag_kanal.felder);
// §4.7 /k/led ,hssi
inline constexpr Adresse k_led{"/k/led", ",hssi", Richtung::an_kern, false, 4};
static_assert(k_led.typen.size() - 1 == k_led.felder);
// §4.7 /k/kiste ,hs
inline constexpr Adresse k_kiste{"/k/kiste", ",hs", Richtung::an_kern, false, 2};
static_assert(k_kiste.typen.size() - 1 == k_kiste.felder);
// §4.7 /k/mapping ,hss
inline constexpr Adresse k_mapping{"/k/mapping", ",hss", Richtung::an_kern, false, 3};
static_assert(k_mapping.typen.size() - 1 == k_mapping.felder);
// §4.7 /k/latenz ,hssi
inline constexpr Adresse k_latenz{"/k/latenz", ",hssi", Richtung::an_kern, false, 4};
static_assert(k_latenz.typen.size() - 1 == k_latenz.felder);
// §4.8 /erz/strom ,hsiss
inline constexpr Adresse erz_strom{"/erz/strom", ",hsiss", Richtung::an_kern, false, 5};
static_assert(erz_strom.typen.size() - 1 == erz_strom.felder);
// §4.8 /erz/fenster ,iiiiddh
inline constexpr Adresse erz_fenster{"/erz/fenster", ",iiiiddh", Richtung::an_kern, false, 7};
static_assert(erz_fenster.typen.size() - 1 == erz_fenster.felder);
// §4.8 /erz/ev ,iiiiddf
inline constexpr Adresse erz_ev{"/erz/ev", ",iiiiddf", Richtung::an_kern, false, 7};
static_assert(erz_ev.typen.size() - 1 == erz_ev.felder);
// §4.8 /erz/cc ,iiidf
inline constexpr Adresse erz_cc{"/erz/cc", ",iiidf", Richtung::an_kern, false, 5};
static_assert(erz_cc.typen.size() - 1 == erz_cc.felder);
// §4.9 /k/loop/laden ,hsis
inline constexpr Adresse k_loop_laden{"/k/loop/laden", ",hsis", Richtung::an_kern, false, 4};
static_assert(k_loop_laden.typen.size() - 1 == k_loop_laden.felder);
// §4.9 /k/loop/start ,hsi
inline constexpr Adresse k_loop_start{"/k/loop/start", ",hsi", Richtung::an_kern, false, 3};
static_assert(k_loop_start.typen.size() - 1 == k_loop_start.felder);
// §4.9 /k/loop/stopp ,hsi
inline constexpr Adresse k_loop_stopp{"/k/loop/stopp", ",hsi", Richtung::an_kern, false, 3};
static_assert(k_loop_stopp.typen.size() - 1 == k_loop_stopp.felder);
// §4.9 /k/loop/raster ,hsii
inline constexpr Adresse k_loop_raster{"/k/loop/raster", ",hsii", Richtung::an_kern, false, 4};
static_assert(k_loop_raster.typen.size() - 1 == k_loop_raster.felder);
// §4.9 /k/loop/rec ,hsis
inline constexpr Adresse k_loop_rec{"/k/loop/rec", ",hsis", Richtung::an_kern, false, 4};
static_assert(k_loop_rec.typen.size() - 1 == k_loop_rec.felder);
// §4.10 /k/fx ,hsiidddddi
inline constexpr Adresse k_fx{"/k/fx", ",hsiidddddi", Richtung::an_kern, false, 10};
static_assert(k_fx.typen.size() - 1 == k_fx.felder);
// §4.10 /k/fx/zuweisung ,hsisi
inline constexpr Adresse k_fx_zuweisung{"/k/fx/zuweisung", ",hsisi", Richtung::an_kern, false, 5};
static_assert(k_fx_zuweisung.typen.size() - 1 == k_fx_zuweisung.felder);
// §4.10 /k/fx/routing ,hsi
inline constexpr Adresse k_fx_routing{"/k/fx/routing", ",hsi", Richtung::an_kern, false, 3};
static_assert(k_fx_routing.typen.size() - 1 == k_fx_routing.felder);
// §4.8 /erz/quittung ,iiiiiii
inline constexpr Adresse erz_quittung{"/erz/quittung", ",iiiiiii", Richtung::vom_kern, false, 7};
static_assert(erz_quittung.typen.size() - 1 == erz_quittung.felder);
// §5.1 /q ,hsihds
inline constexpr Adresse q{"/q", ",hsihds", Richtung::vom_kern, false, 6};
static_assert(q.typen.size() - 1 == q.felder);
// §5.1 /q/stand ,hsihds
inline constexpr Adresse q_stand{"/q/stand", ",hsihds", Richtung::vom_kern, false, 6};
static_assert(q_stand.typen.size() - 1 == q_stand.felder);
// §5.2 /uhr ,hhddd
inline constexpr Adresse uhr{"/uhr", ",hhddd", Richtung::vom_kern, false, 5};
static_assert(uhr.typen.size() - 1 == uhr.felder);
// §5.3 /takt ,iihdd
inline constexpr Adresse takt{"/takt", ",iihdd", Richtung::vom_kern, false, 5};
static_assert(takt.typen.size() - 1 == takt.felder);
// §5.4 /zustand/kern ,iihiiiiiiii
inline constexpr Adresse zustand_kern{"/zustand/kern", ",iihiiiiiiii", Richtung::vom_kern, false, 11};
static_assert(zustand_kern.typen.size() - 1 == zustand_kern.felder);
// §5.5 /zustand/deck ,iisdidddfiifii
inline constexpr Adresse zustand_deck{"/zustand/deck", ",iisdidddfiifii", Richtung::vom_kern, false, 14};
static_assert(zustand_deck.typen.size() - 1 == zustand_deck.felder);
// §5.5b /zustand/box ,iiiiii
inline constexpr Adresse zustand_box{"/zustand/box", ",iiiiii", Richtung::vom_kern, false, 6};
static_assert(zustand_box.typen.size() - 1 == zustand_box.felder);
// §5.6 /pegel ,sfffffff
inline constexpr Adresse pegel{"/pegel", ",sfffffff", Richtung::vom_kern, false, 8};
static_assert(pegel.typen.size() - 1 == pegel.felder);
// §5.7 /e/regler ,sfshd
inline constexpr Adresse e_regler{"/e/regler", ",sfshd", Richtung::vom_kern, false, 5};
static_assert(e_regler.typen.size() - 1 == e_regler.felder);
// §5.8 /e/hand ,sfhd
inline constexpr Adresse e_hand{"/e/hand", ",sfhd", Richtung::vom_kern, false, 4};
static_assert(e_hand.typen.size() - 1 == e_hand.felder);
// §5.8 /e/taste ,sihd
inline constexpr Adresse e_taste{"/e/taste", ",sihd", Richtung::vom_kern, false, 4};
static_assert(e_taste.typen.size() - 1 == e_taste.felder);
// §5.9 /e/geladen ,isdiih
inline constexpr Adresse e_geladen{"/e/geladen", ",isdiih", Richtung::vom_kern, false, 6};
static_assert(e_geladen.typen.size() - 1 == e_geladen.felder);
// §5.9 /e/halter ,sshd
inline constexpr Adresse e_halter{"/e/halter", ",sshd", Richtung::vom_kern, false, 4};
static_assert(e_halter.typen.size() - 1 == e_halter.felder);
// §5.9 /e/invariante ,ssihd
inline constexpr Adresse e_invariante{"/e/invariante", ",ssihd", Richtung::vom_kern, false, 5};
static_assert(e_invariante.typen.size() - 1 == e_invariante.felder);
// §5.9 /e/rueckfall ,iidddh
inline constexpr Adresse e_rueckfall{"/e/rueckfall", ",iidddh", Richtung::vom_kern, false, 6};
static_assert(e_rueckfall.typen.size() - 1 == e_rueckfall.felder);
// §5.9 /e/frist ,iddh
inline constexpr Adresse e_frist{"/e/frist", ",iddh", Richtung::vom_kern, false, 4};
static_assert(e_frist.typen.size() - 1 == e_frist.felder);
// §5.9 /e/luecke ,hii
inline constexpr Adresse e_luecke{"/e/luecke", ",hii", Richtung::vom_kern, false, 3};
static_assert(e_luecke.typen.size() - 1 == e_luecke.felder);
// §5.9 /e/quantum ,iih
inline constexpr Adresse e_quantum{"/e/quantum", ",iih", Richtung::vom_kern, false, 3};
static_assert(e_quantum.typen.size() - 1 == e_quantum.felder);
// §5.9 /e/raster ,isdfh
inline constexpr Adresse e_raster{"/e/raster", ",isdfh", Richtung::vom_kern, false, 5};
static_assert(e_raster.typen.size() - 1 == e_raster.felder);
// §5.9 /e/hotcue ,isidh
inline constexpr Adresse e_hotcue{"/e/hotcue", ",isidh", Richtung::vom_kern, false, 5};
static_assert(e_hotcue.typen.size() - 1 == e_hotcue.felder);
// §5.9 /e/rueckweg ,sih
inline constexpr Adresse e_rueckweg{"/e/rueckweg", ",sih", Richtung::vom_kern, false, 3};
static_assert(e_rueckweg.typen.size() - 1 == e_rueckweg.felder);
// §5.9 /e/ki ,ish
inline constexpr Adresse e_ki{"/e/ki", ",ish", Richtung::vom_kern, false, 3};
static_assert(e_ki.typen.size() - 1 == e_ki.felder);
// §5.9 /e/tempo ,dddh
inline constexpr Adresse e_tempo{"/e/tempo", ",dddh", Richtung::vom_kern, false, 4};
static_assert(e_tempo.typen.size() - 1 == e_tempo.felder);
// §5.9 /e/neustart ,ih
inline constexpr Adresse e_neustart{"/e/neustart", ",ih", Richtung::vom_kern, false, 2};
static_assert(e_neustart.typen.size() - 1 == e_neustart.felder);
// §5.9 /e/protokollfehler ,ss
inline constexpr Adresse e_protokollfehler{"/e/protokollfehler", ",ss", Richtung::vom_kern, false, 2};
static_assert(e_protokollfehler.typen.size() - 1 == e_protokollfehler.felder);
// §5.10 /nb ,iiih
inline constexpr Adresse nb{"/nb", ",iiih", Richtung::von_notbahn, false, 4};
static_assert(nb.typen.size() - 1 == nb.felder);
// §5.11 /e/loop ,iisiidf
inline constexpr Adresse e_loop{"/e/loop", ",iisiidf", Richtung::vom_kern, false, 7};
static_assert(e_loop.typen.size() - 1 == e_loop.felder);
// §5.12 /e/fx ,iidddddi
inline constexpr Adresse e_fx{"/e/fx", ",iidddddi", Richtung::vom_kern, false, 8};
static_assert(e_fx.typen.size() - 1 == e_fx.felder);
// §5.12 /e/fx/zuweisung ,isi
inline constexpr Adresse e_fx_zuweisung{"/e/fx/zuweisung", ",isi", Richtung::vom_kern, false, 3};
static_assert(e_fx_zuweisung.typen.size() - 1 == e_fx_zuweisung.felder);
// §5.12 /e/fx/routing ,i
inline constexpr Adresse e_fx_routing{"/e/fx/routing", ",i", Richtung::vom_kern, false, 1};
static_assert(e_fx_routing.typen.size() - 1 == e_fx_routing.felder);
// §5.11 /e/mitschnitt ,siid
inline constexpr Adresse e_mitschnitt{"/e/mitschnitt", ",siid", Richtung::vom_kern, false, 4};
static_assert(e_mitschnitt.typen.size() - 1 == e_mitschnitt.felder);
// §19.0 /test/hand ,sfh
inline constexpr Adresse test_hand{"/test/hand", ",sfh", Richtung::an_kern, true, 3};
static_assert(test_hand.typen.size() - 1 == test_hand.felder);
// §19.0 /test/klick ,hssi
inline constexpr Adresse test_klick{"/test/klick", ",hssi", Richtung::an_kern, true, 4};
static_assert(test_klick.typen.size() - 1 == test_klick.felder);

inline constexpr std::array<Adresse, 78> alle{
    k_hallo,
    k_tschuess,
    k_willkommen,
    k_set_neu,
    k_tempo_rampe,
    k_storno,
    k_teil,
    k_abbruch,
    k_deck_laden,
    k_deck_entladen,
    k_deck_start,
    k_deck_stopp,
    k_deck_loop,
    k_deck_roll,
    k_deck_sprung,
    k_deck_hotcue,
    k_deck_hotcue_setzen,
    k_deck_raster,
    k_deck_slip,
    k_deck_basis_tausch,
    k_hoerschein,
    k_hoerschein_weg,
    k_schuss,
    k_ki_stopp,
    k_ki_frei,
    k_ki_spur,
    k_ki_stufe,
    k_vorschlag_kanal,
    k_led,
    k_kiste,
    k_mapping,
    k_latenz,
    erz_strom,
    erz_fenster,
    erz_ev,
    erz_cc,
    k_loop_laden,
    k_loop_start,
    k_loop_stopp,
    k_loop_raster,
    k_loop_rec,
    k_fx,
    k_fx_zuweisung,
    k_fx_routing,
    erz_quittung,
    q,
    q_stand,
    uhr,
    takt,
    zustand_kern,
    zustand_deck,
    zustand_box,
    pegel,
    e_regler,
    e_hand,
    e_taste,
    e_geladen,
    e_halter,
    e_invariante,
    e_rueckfall,
    e_frist,
    e_luecke,
    e_quantum,
    e_raster,
    e_hotcue,
    e_rueckweg,
    e_ki,
    e_tempo,
    e_neustart,
    e_protokollfehler,
    nb,
    e_loop,
    e_fx,
    e_fx_zuweisung,
    e_fx_routing,
    e_mitschnitt,
    test_hand,
    test_klick,
};

constexpr const Adresse* finde(std::string_view pfad) {
  for (const auto& a : alle) {
    if (a.pfad == pfad) return &a;
  }
  return nullptr;
}

// Feldnummern je Adresse: feld::<adresse>::<feld>
namespace feld {
namespace k_hallo { enum : std::size_t { name = 0, port = 1, protokoll = 2 }; }
namespace k_tschuess { enum : std::size_t { name = 0 }; }
namespace k_willkommen { enum : std::size_t { protokoll = 0, generation = 1, sample = 2, beat = 3, bpm = 4, kern_version = 5 }; }
namespace k_set_neu { enum : std::size_t { id = 0, quelle = 1, start_bpm = 2 }; }
namespace k_tempo_rampe { enum : std::size_t { id = 0, quelle = 1, ab_beat = 2, ziel_bpm = 3, dauer_beats = 4 }; }
namespace k_storno { enum : std::size_t { id = 0, quelle = 1, ziel_id = 2 }; }
namespace k_teil { enum : std::size_t { id = 0, quelle = 1, plan = 2, teil = 3, pfad = 4, ab_beat = 5, dauer_beats = 6, nach = 7, form = 8, politik = 9, gruppe = 10, hoerschein = 11 }; }
namespace k_abbruch { enum : std::size_t { id = 0, quelle = 1, plan = 2, teile = 3 }; }
namespace k_deck_laden { enum : std::size_t { id = 0, quelle = 1, deck = 2, material_id = 3, basis_bpm = 4, fassung = 5, mit_stems = 6 }; }
namespace k_deck_entladen { enum : std::size_t { id = 0, quelle = 1, deck = 2 }; }
namespace k_deck_start { enum : std::size_t { id = 0, quelle = 1, plan = 2, gruppe = 3, hoerschein = 4, deck = 5, ab_beat = 6, quell_beat = 7, politik = 8 }; }
namespace k_deck_stopp { enum : std::size_t { id = 0, quelle = 1, plan = 2, gruppe = 3, hoerschein = 4, deck = 5, ab_beat = 6, politik = 7 }; }
namespace k_deck_loop { enum : std::size_t { id = 0, quelle = 1, plan = 2, gruppe = 3, hoerschein = 4, deck = 5, ab_beat = 6, laenge_beats = 7, politik = 8, raster_beats = 9 }; }
namespace k_deck_roll { enum : std::size_t { id = 0, quelle = 1, plan = 2, gruppe = 3, hoerschein = 4, deck = 5, ab_beat = 6, laenge_beats = 7, art = 8, politik = 9, raster_beats = 10 }; }
namespace k_deck_sprung { enum : std::size_t { id = 0, quelle = 1, plan = 2, gruppe = 3, hoerschein = 4, deck = 5, ab_beat = 6, delta_beats = 7, politik = 8, raster_beats = 9 }; }
namespace k_deck_hotcue { enum : std::size_t { id = 0, quelle = 1, plan = 2, gruppe = 3, hoerschein = 4, deck = 5, ab_beat = 6, nr = 7, politik = 8, raster_beats = 9 }; }
namespace k_deck_hotcue_setzen { enum : std::size_t { id = 0, quelle = 1, deck = 2, nr = 3, quell_beat = 4 }; }
namespace k_deck_raster { enum : std::size_t { id = 0, quelle = 1, deck = 2, material_id = 3, basis_bpm = 4, fassung = 5, versatz_frames = 6 }; }
namespace k_deck_slip { enum : std::size_t { id = 0, quelle = 1, deck = 2, an = 3 }; }
namespace k_deck_basis_tausch { enum : std::size_t { id = 0, quelle = 1, deck = 2, basis_bpm = 3, fassung = 4, ab_beat = 5 }; }
namespace k_hoerschein { enum : std::size_t { id = 0, quelle = 1, hs_id = 2, kanal = 3, inhalt = 4, urteil = 5, bpm_messung = 6, gueltig_bis_beat = 7, quell_von = 8, quell_bis = 9, sync_ms = 10, pegel_diff_db = 11, lufs_kurz = 12 }; }
namespace k_hoerschein_weg { enum : std::size_t { id = 0, quelle = 1, hs_id = 2 }; }
namespace k_schuss { enum : std::size_t { id = 0, quelle = 1, ab_beat = 2, material_id = 3, fassung = 4, schuss_nr = 5, pad = 6, pegel_db = 7, politik = 8 }; }
namespace k_ki_stopp { enum : std::size_t { id = 0, quelle = 1 }; }
namespace k_ki_frei { enum : std::size_t { id = 0, quelle = 1 }; }
namespace k_ki_spur { enum : std::size_t { id = 0, quelle = 1, kanaele = 2 }; }
namespace k_ki_stufe { enum : std::size_t { id = 0, quelle = 1, stufe = 2 }; }
namespace k_vorschlag_kanal { enum : std::size_t { id = 0, quelle = 1, kanal = 2 }; }
namespace k_led { enum : std::size_t { id = 0, quelle = 1, name = 2, zustand = 3 }; }
namespace k_kiste { enum : std::size_t { id = 0, quelle = 1 }; }
namespace k_mapping { enum : std::size_t { id = 0, quelle = 1, geraet = 2 }; }
namespace k_latenz { enum : std::size_t { id = 0, quelle = 1, ziel = 2, samples = 3 }; }
namespace erz_strom { enum : std::size_t { id = 0, quelle = 1, strom = 2, ziel = 3, kanal = 4 }; }
namespace erz_fenster { enum : std::size_t { strom = 0, sendung = 1, modus = 2, reserve = 3, ab_beat = 4, bis_beat = 5, t_send_us = 6 }; }
namespace erz_ev { enum : std::size_t { strom = 0, muster = 1, ev_id = 2, note = 3, beat = 4, dauer_beats = 5, velocity = 6 }; }
namespace erz_cc { enum : std::size_t { strom = 0, ev_id = 1, cc = 2, beat = 3, wert = 4 }; }
namespace k_loop_laden { enum : std::size_t { id = 0, quelle = 1, box = 2, name = 3 }; }
namespace k_loop_start { enum : std::size_t { id = 0, quelle = 1, box = 2 }; }
namespace k_loop_stopp { enum : std::size_t { id = 0, quelle = 1, box = 2 }; }
namespace k_loop_raster { enum : std::size_t { id = 0, quelle = 1, box = 2, versatz_frames = 3 }; }
namespace k_loop_rec { enum : std::size_t { id = 0, quelle = 1, beats = 2, name = 3 }; }
namespace k_fx { enum : std::size_t { id = 0, quelle = 1, einheit = 2, art = 3, beats = 4, wet = 5, param1 = 6, param2 = 7, param3 = 8, an = 9 }; }
namespace k_fx_zuweisung { enum : std::size_t { id = 0, quelle = 1, einheit = 2, kanal = 3, an = 4 }; }
namespace k_fx_routing { enum : std::size_t { id = 0, quelle = 1, routing = 2 }; }
namespace erz_quittung { enum : std::size_t { strom = 0, sendung = 1, verworfen = 2, verworfen_anderes_muster = 3, eingefuegt = 4, zu_spaet = 5, ungehoert = 6 }; }
namespace q { enum : std::size_t { id = 0, quelle = 1, status = 2, ist_sample = 3, ist_beat = 4, grund = 5 }; }
namespace q_stand { enum : std::size_t { id = 0, quelle = 1, status = 2, ist_sample = 3, ist_beat = 4, grund = 5 }; }
namespace uhr { enum : std::size_t { sample = 0, mono_ns = 1, beat = 2, bpm = 3, bpm_pro_s = 4 }; }
namespace takt { enum : std::size_t { takt = 0, phrase = 1, sample = 2, beat = 3, bpm = 4 }; }
namespace zustand_kern { enum : std::size_t { generation = 0, quantum = 1, sample = 2, frame_luecken = 3, ausgelassene_perioden = 4, cb_max_us = 5, cb_p99_us = 6, aufwach_max_us = 7, stretcher_aktiv = 8, befehle_wartend = 9, ki_gestoppt = 10 }; }
namespace zustand_deck { enum : std::size_t { deck = 0, status = 1, material_id = 2, basis_bpm = 3, fassung = 4, quell_beat = 5, beats_bis_ende = 6, faktor = 7, vorlauf_ms = 8, hoerweg = 9, stretcher_fuell = 10, versatz_intern_ms = 11, keylock_unterlauf = 12, keylock_aufgegeben = 13 }; }
namespace zustand_box { enum : std::size_t { box = 0, status = 1, keylock_unterlauf = 2, keylock_aufgegeben = 3, keylock_ring_voll = 4, keylock_kein_platz = 5 }; }
namespace pegel { enum : std::size_t { kanal = 0, spitze_db = 1, echtspitze_dbtp = 2, lufs_m = 3, lufs_s = 4, band_tief_db = 5, band_mitte_db = 6, band_hoch_db = 7 }; }
namespace e_regler { enum : std::size_t { pfad = 0, wert = 1, halter = 2, sample = 3, beat = 4 }; }
namespace e_hand { enum : std::size_t { pfad = 0, wert = 1, sample = 2, beat = 3 }; }
namespace e_taste { enum : std::size_t { name = 0, wert = 1, sample = 2, beat = 3 }; }
namespace e_geladen { enum : std::size_t { deck = 0, material_id = 1, basis_bpm = 2, fassung = 3, mit_stems = 4, sample = 5 }; }
namespace e_halter { enum : std::size_t { pfad = 0, halter = 1, sample = 2, beat = 3 }; }
namespace e_invariante { enum : std::size_t { art = 0, plan = 1, teil = 2, sample = 3, beat = 4 }; }
namespace e_rueckfall { enum : std::size_t { deck = 0, an = 1, quell_beat_start = 2, laenge_beats = 3, beat = 4, sample = 5 }; }
namespace e_frist { enum : std::size_t { deck = 0, beats_bis_ende = 1, beat = 2, sample = 3 }; }
namespace e_luecke { enum : std::size_t { sample = 0, frames = 1, zyklen = 2 }; }
namespace e_quantum { enum : std::size_t { alt = 0, neu = 1, sample = 2 }; }
namespace e_raster { enum : std::size_t { deck = 0, material_id = 1, quell_beat = 2, versatz_ms = 3, sample = 4 }; }
namespace e_hotcue { enum : std::size_t { deck = 0, material_id = 1, nr = 2, quell_beat = 3, sample = 4 }; }
namespace e_rueckweg { enum : std::size_t { kanal = 0, lebt = 1, sample = 2 }; }
namespace e_ki { enum : std::size_t { gestoppt = 0, grund = 1, sample = 2 }; }
namespace e_tempo { enum : std::size_t { bpm = 0, ab_beat = 1, dauer_beats = 2, sample = 3 }; }
namespace e_neustart { enum : std::size_t { generation = 0, sample = 1 }; }
namespace e_protokollfehler { enum : std::size_t { adresse = 0, grund = 1 }; }
namespace nb { enum : std::size_t { zustand = 0, takte_in_schleife = 1, generation_gesehen = 2, w = 3 }; }
namespace e_loop { enum : std::size_t { box = 0, status = 1, name = 2, beats = 3, fx_art = 4, fx_beats = 5, fx_wet = 6 }; }
namespace e_fx { enum : std::size_t { einheit = 0, art = 1, beats = 2, wet = 3, param1 = 4, param2 = 5, param3 = 6, an = 7 }; }
namespace e_fx_zuweisung { enum : std::size_t { einheit = 0, kanal = 1, an = 2 }; }
namespace e_fx_routing { enum : std::size_t { routing = 0 }; }
namespace e_mitschnitt { enum : std::size_t { name = 0, beats = 1, status = 2, ab_beat = 3 }; }
namespace test_hand { enum : std::size_t { pfad = 0, midi_roh = 1, sample = 2 }; }
namespace test_klick { enum : std::size_t { id = 0, quelle = 1, kanal = 2, an = 3 }; }
}  // namespace feld

// Optionaler Schwanz nach den festen Feldern (Scheibe 3): 0 bis n Wiederholungen dieser Typen, z. B. (nr, wert)
namespace schwanz {
inline constexpr std::string_view erz_ev = "if";
}  // namespace schwanz

// Bereiche aus dem Vertragstext: bereich::<adresse>::<feld>_min, _max
namespace bereich {
namespace k_hallo { inline constexpr double protokoll_min = 1; inline constexpr double protokoll_max = 1; }
namespace k_tempo_rampe { inline constexpr double ziel_bpm_min = 60; inline constexpr double ziel_bpm_max = 200; inline constexpr double dauer_beats_min = 1.0; }
namespace k_teil { inline constexpr double teil_min = 0; inline constexpr double dauer_beats_min = 0; }
namespace k_deck_laden { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; inline constexpr double fassung_min = 1; }
namespace k_deck_entladen { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; }
namespace k_deck_start { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; }
namespace k_deck_stopp { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; }
namespace k_deck_loop { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; inline constexpr double laenge_beats_min = 0; inline constexpr double laenge_beats_max = 128; }
namespace k_deck_roll { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; inline constexpr double laenge_beats_min = 0; }
namespace k_deck_sprung { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; }
namespace k_deck_hotcue { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; inline constexpr double nr_min = 1; inline constexpr double nr_max = 8; }
namespace k_deck_hotcue_setzen { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; inline constexpr double nr_min = 1; inline constexpr double nr_max = 8; }
namespace k_deck_raster { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; inline constexpr double versatz_frames_min = -192000; inline constexpr double versatz_frames_max = 192000; }
namespace k_deck_slip { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; }
namespace k_deck_basis_tausch { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; inline constexpr double fassung_min = 1; }
namespace k_schuss { inline constexpr double fassung_min = 1; inline constexpr double pad_min = 1; inline constexpr double pad_max = 2; }
namespace k_ki_stufe { inline constexpr double stufe_min = 0; inline constexpr double stufe_max = 3; }
namespace erz_strom { inline constexpr double strom_min = 1; inline constexpr double strom_max = 16; }
namespace erz_fenster { inline constexpr double strom_min = 1; inline constexpr double strom_max = 16; }
namespace erz_ev { inline constexpr double strom_min = 1; inline constexpr double strom_max = 16; inline constexpr double note_min = 0; inline constexpr double note_max = 255; inline constexpr double velocity_min = 0; inline constexpr double velocity_max = 1; }
namespace erz_cc { inline constexpr double strom_min = 1; inline constexpr double strom_max = 16; inline constexpr double wert_min = 0; inline constexpr double wert_max = 1; }
namespace k_loop_laden { inline constexpr double box_min = 1; inline constexpr double box_max = 2; }
namespace k_loop_start { inline constexpr double box_min = 1; inline constexpr double box_max = 2; }
namespace k_loop_stopp { inline constexpr double box_min = 1; inline constexpr double box_max = 2; }
namespace k_loop_raster { inline constexpr double box_min = 1; inline constexpr double box_max = 2; }
namespace k_fx { inline constexpr double einheit_min = 1; inline constexpr double einheit_max = 2; inline constexpr double art_min = 1; inline constexpr double art_max = 4; inline constexpr double wet_min = 0; inline constexpr double wet_max = 1; inline constexpr double param1_min = 0; inline constexpr double param1_max = 1; inline constexpr double param2_min = 0; inline constexpr double param2_max = 1; inline constexpr double param3_min = 0; inline constexpr double param3_max = 1; inline constexpr double an_min = 0; inline constexpr double an_max = 1; }
namespace k_fx_zuweisung { inline constexpr double einheit_min = 1; inline constexpr double einheit_max = 2; inline constexpr double an_min = 0; inline constexpr double an_max = 1; }
namespace k_fx_routing { inline constexpr double routing_min = 0; inline constexpr double routing_max = 1; }
namespace erz_quittung { inline constexpr double strom_min = 1; inline constexpr double strom_max = 16; }
namespace takt { inline constexpr double takt_min = 1; inline constexpr double phrase_min = 1; }
namespace zustand_deck { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; inline constexpr double stretcher_fuell_min = -1; }
namespace zustand_box { inline constexpr double box_min = 1; inline constexpr double box_max = 2; }
namespace e_geladen { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; }
namespace e_rueckfall { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; }
namespace e_frist { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; }
namespace e_raster { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; }
namespace e_hotcue { inline constexpr double deck_min = 1; inline constexpr double deck_max = 4; inline constexpr double nr_min = 1; inline constexpr double nr_max = 8; }
namespace e_loop { inline constexpr double box_min = 1; inline constexpr double box_max = 2; inline constexpr double status_min = 0; inline constexpr double status_max = 5; inline constexpr double fx_art_min = 0; inline constexpr double fx_art_max = 4; }
namespace e_fx { inline constexpr double einheit_min = 1; inline constexpr double einheit_max = 2; inline constexpr double art_min = 0; inline constexpr double art_max = 4; inline constexpr double an_min = 0; inline constexpr double an_max = 1; }
namespace e_fx_zuweisung { inline constexpr double einheit_min = 1; inline constexpr double einheit_max = 2; inline constexpr double an_min = 0; inline constexpr double an_max = 1; }
namespace e_fx_routing { inline constexpr double routing_min = 0; inline constexpr double routing_max = 1; }
namespace e_mitschnitt { inline constexpr double status_min = 0; inline constexpr double status_max = 1; }
namespace test_hand { inline constexpr double midi_roh_min = 0; inline constexpr double midi_roh_max = 1; }
}  // namespace bereich

namespace werte {
inline constexpr std::array<std::string_view, 6> quelle{"andreas", "cypher", "leitstand", "erzeuger", "werkstatt", "pruefstand"};
enum class Politik : std::int32_t { musik = 0, zustand = 1, raster = 2 };
enum class PolitikTeil : std::int32_t { musik = 0, zustand = 1 };
enum class Form : std::int32_t { linear = 0, s_kurve = 1 };
inline constexpr std::array<double, 5> raster_beats{0.25, 1.0, 4.0, 16.0, 32.0};
inline constexpr std::array<double, 7> fx_beats{0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0};
inline constexpr std::array<std::string_view, 8> fx_kanal{"deck/1", "deck/2", "erz/1", "erz/2", "erz/3", "pad/1", "pad/2", "master"};
enum class RollArt : std::int32_t { band_schatten = 0, puffer_keylock = 1 };
inline constexpr std::array<std::string_view, 1> urteil{"ok"};
enum class LedZustand : std::int32_t { aus = 0, an = 1, blinkt = 2, blinkt_schnell = 3 };
enum class ErzParameter : std::int32_t { begin = 0, end = 1 };
enum class ErzModus : std::int32_t { B = 66 };
enum class Status : std::int32_t { angenommen = 1, gestartet = 2, fertig = 3, verspaetet_verworfen = 4, verspaetet_ausgefuehrt = 5, abgelehnt = 6, abgebrochen = 7, storniert = 8 };
enum class StatusStand : std::int32_t { wartet = 1, laeuft = 2 };
enum class DeckStatus : std::int32_t { leer = 0, geladen = 1, laeuft = 2, loop = 3, roll = 4, rueckfall = 5 };
enum class Hoerweg : std::int32_t { direkt = 0, stretcher = 1, puffer = 2 };
inline constexpr std::array<std::string_view, 17> taste{"annehmen", "verwerfen", "cypher_vorschlag", "cypher_hoeren", "stopp", "freigabe", "urteil_gut", "urteil_daneben", "autonomie", "spielart", "laenge", "spielart_start", "basstausch", "kiste_laden", "kiste_wahl", "tempo_basis", "zuruf"};
inline constexpr std::array<std::string_view, 3> invariante_art{"sub_doppelt", "master_leer", "hoerschein"};
inline constexpr std::array<std::string_view, 3> protokollfehler_grund{"unbekannte_adresse", "falsche_typen", "protokoll"};
enum class NbZustand : std::int32_t { durchreichen = 0, schleife = 1, ausgeblendet = 2, rueckgabe = 3 };
inline constexpr std::array<std::string_view, 42> gruende{"zu_spaet", "regler_beim_menschen", "regler_verplant", "ueberlappung", "nur_hand", "unbekannter_regler", "unbekanntes_deck", "ausserhalb_bereich", "kein_hoerschein", "hoerschein_anderer_kanal", "hoerschein_anderer_inhalt", "hoerschein_anderes_tempo", "hoerschein_abgelaufen", "hoerschein_anderer_abschnitt", "ziel_ungehoert", "keine_stems", "hoerschein_nicht_sync", "hoerschein_pegel", "invariante_sub_doppelt", "invariante_master_leer", "deck_beruehrt", "deck_hoerbar", "deck_laeuft", "nicht_geladen", "material_fehlt", "pruefung", "budget_speicher", "budget_stretcher", "karte_voll", "ki_gestoppt", "rechner_fehlt", "kein_stretcher", "autonomie", "form", "hand", "abbruch", "ki_stopp", "unbekannte_adresse", "falsche_typen", "protokoll", "grenze_sub", "neustart"};
}  // namespace werte

}  // namespace cypherdj::osc
