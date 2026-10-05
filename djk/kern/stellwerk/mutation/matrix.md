| Mutation | abgeschaltete Regel | rote Fälle | Beispiele |
|---|---|---|---|
| M01_ereignis_am_blockanfang | Start und Griff am Sample, nicht an der Blockgrenze (§1.1, §7.3 P1) | 39 | test_ablauf:start_mitten_im_block_am_exakten_sample, test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60, test_ablauf:schaltrampe_beim_setzen_als_s_kurve |
| M02_hand_bricht_ganzen_plan | Hand bricht nur Regler und Gruppe (ADR 023 P2) | 7 | test_hand:erster_wert_nur_stellung_dann_totzone_dann_uebernahme, test_portiert:t02_handgriff_bei_takt_19_fader_teil_endet_am_selben_sample_kill_laeuft_weiter, test_portiert:t03_kill_und_griff_am_sample_nicht_an_der_blockgrenze |
| M03_ohne_gruppe | Gruppe fällt gemeinsam (§4.3 Feld 11) | 7 | test_einsortieren:abbruch_wartender_teile_samt_gruppe, test_hand:erster_wert_nur_stellung_dann_totzone_dann_uebernahme, test_hand:hand_bricht_auch_wartende_teile_ab |
| M04_ohne_schiedsrichter | Hand übernimmt, Plan hört auf (§7.3 P3) | 16 | test_angriffe:a4_knopf_unbekannt_erster_wert_nur_stellung_kein_sprung, test_angriffe:a4_negativ_kontrolle_knopf_wie_angenommen, test_angriffe:a5_positiv_kontrolle_ein_griff_ueber_der_totzone_bricht_ab |
| M05_erster_wert_wirkt | erster Wert nur Stellung (§7.3 P2) | 9 | test_angriffe:a4_knopf_unbekannt_erster_wert_nur_stellung_kein_sprung, test_hand:erster_wert_nur_stellung_dann_totzone_dann_uebernahme, test_hand:stellung_vergessen_nach_neuverbindung |
| M06_ohne_totzone | Totzone 3/128 (§7.3 P3) | 6 | test_angriffe:a4_knopf_unbekannt_erster_wert_nur_stellung_kein_sprung, test_angriffe:a4_negativ_kontrolle_knopf_wie_angenommen, test_angriffe:a5_ein_rauschschritt_unter_der_totzone_bricht_nichts_ab |
| M07_sprung_statt_skaliert | Übernahme skaliert ohne Sprung (§7.3 P3) | 6 | test_angriffe:a4_knopf_unbekannt_erster_wert_nur_stellung_kein_sprung, test_angriffe:a4_negativ_kontrolle_knopf_wie_angenommen, test_hand:erster_wert_nur_stellung_dann_totzone_dann_uebernahme |
| M08_relativ_als_absolut | Encoder relativ (§7.3 P3) | 2 | test_hand:relativ_mit_totzone_ueber_die_summe, test_portiert:t06_uebernahme_skaliert_und_relativ_ohne_sprung |
| M09_ohne_rueckgabe | Rückgabe nach 32 Beats (§7.3 P4, P5) | 4 | test_hand:rueckgabe_nach_32_beats_ohne_hand, test_hand:deck_halter_32_beats_nach_der_transport_taste, test_portiert:t02_handgriff_bei_takt_19_fader_teil_endet_am_selben_sample_kill_laeuft_weiter |
| M10_startwert_nicht_ist_wert | Rampe startet am Ist-Wert (§4.3) | 19 | test_ablauf:teil_rampe_golden, test_ablauf:halter_und_meldungen_bei_start_und_ende, test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60 |
| M11_setzen_ziel_nicht_uebergeben | Rampe beginnt beim Zielwert eines Setzens am selben Sample (§4.3) | 5 | test_ablauf:setzen_und_rampe_am_selben_sample, test_ablauf:setzen_fremder_plan_vor_rampe_am_selben_beat, folge:teil_rampe.jsonl |
| M12_ohne_stumm_regel | Rampen von/nach stumm über -60 dB (§1.2) | 9 | test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60, test_ablauf:stumm_nach_stumm_bleibt_stumm_und_kein_umweg_ueber_minus_60, test_ablauf:rampe_aus_stumm_und_s_kurve |
| M13_i4_nur_fremde_plaene | I4 auch im selben Plan (§17) | 4 | test_angriffe:a3_ueberlappung_im_selben_plan_abgelehnt_kein_sprung, test_einsortieren:i4_ueberlappung_auch_im_selben_plan, test_einsortieren:i4_setzen_und_rampe_am_selben_beat_nach_startfolge |
| M14_zu_spaet_trotzdem | Politik 0 zu spät verworfen (§16.1) | 4 | test_einsortieren:zu_spaet_politik_0_verworfen_politik_1_angenommen, test_portiert:t08_verriegelung_a4_nichts_wird_ungehoert_hoerbar, folge:zu_spaet.jsonl |
| M15_startsample_bei_annahme | Startsample je Zyklus nach der Tempo-Karte (§4.3, Beat-Zeit) | 2 | test_ablauf:tempo_132_nach_annahme_schaltpunkte_bleiben_auf_dem_takt, test_portiert:t07_tempo_132_ab_takt_18_schaltpunkte_bleiben_auf_ihrem_takt |
| M16_ki_stopp_ohne_abbruch | KI-Stopp bricht cypher-Teile ab (§4.7) | 3 | test_ki:stopp_bricht_cypher_teile_ab_andere_laufen, test_ki:stopp_taste_ohne_quittung_mit_wirkung, folge:ki_stopp.jsonl |
| M17_ki_ohne_sperre | nach dem Stopp cypher abgelehnt (§4.7) | 2 | test_ki:nach_dem_stopp_cypher_abgelehnt_bis_frei_von_andreas, folge:ki_stopp.jsonl |
| M18_ohne_halterpruefung_am_start | Start prüft Halter mensch (§4.3) | 2 | test_hand:halter_am_start_sample_nach_rueckgabe_im_selben_zyklus, test_portiert:t11_verriegelung_die_uebrigen_gruende_treffen_einzeln |
| M19_ohne_nur_hand | Wer darf: nur Hand (§1.5) | 1 | test_einsortieren:unbekannt_nur_hand_bereich_stems |
| M20_s_kurve_linear | Form 1 S-Kurve (§4.3 Feld 9) | 3 | test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60, test_ablauf:schaltrampe_beim_setzen_als_s_kurve, test_ablauf:rampe_aus_stumm_und_s_kurve |
| M21_beruehrung_ohne_uebernahme | Berührung übernimmt sofort (§7.3 P3) | 8 | test_hand:beruehrung_uebernimmt_sofort_ohne_wert, test_hand:hand_bricht_auch_wartende_teile_ab, test_portiert:t02_handgriff_bei_takt_19_fader_teil_endet_am_selben_sample_kill_laeuft_weiter |
| M22_pruefer_vor_teilstart_nie | Naht: vor_teilstart wird gefragt (§17) | 7 | test_echtzeit:fehlerfall_allokierender_pruefer_wird_gezaehlt, test_portiert:t08_verriegelung_a4_nichts_wird_ungehoert_hoerbar, test_portiert:t11_verriegelung_die_uebrigen_gruende_treffen_einzeln |
| M23_pruefer_je_zyklus_nie | Naht: je_zyklus wird gerufen (§17) | 5 | test_echtzeit:dauerlauf_mit_vollem_pruefer_0_allokationen, test_portiert:t08_verriegelung_a4_nichts_wird_ungehoert_hoerbar, test_pruefer:je_zyklus_bricht_vor_dem_oeffnen_ab |
| M24_pruefer_nach_handgriff_nie | Naht: nach_handgriff wird gerufen (§17) | 2 | test_pruefer:nach_handgriff_sieht_den_handwert_und_greift_ein, test_pruefer:nach_handgriff_auch_fuer_die_transport_taste |
| M25_vorschau_ohne_starts | Naht: Vorschau kennt die Starts des Zyklus | 3 | test_pruefer:pruefwert_vor_und_mit_bestimmen_den_oeffner, test_pruefer:basstausch_als_paar_am_selben_sample_gueltig, test_pruefer:vorschau_stimmt_mit_dem_ablauf_ueberein |
| M26_regler_ohne_drossel | /e/regler höchstens 50 Hz (§5.7) | 1 | test_melder:regler_waehrend_der_rampe_hoechstens_50_hz |
| M27_hand_ohne_nachzuegler | /e/hand letztes Ereignis der Geste (§5.8) | 1 | test_melder:hand_geste_erstes_letztes_und_hoechstens_20_hz |
| M28_allokation_im_prozess | keine Allokation im Prozessaufruf (ADR 002) | 2 | test_echtzeit:dauerlauf_64_regler_hand_ki_0_allokationen, test_echtzeit:dauerlauf_mit_vollem_pruefer_0_allokationen |
| M29_i4_zwei_setzen_erlaubt | I4: zwei Setzen am selben Beat überlappen (09 herleitung.py) | 1 | test_einsortieren:i4_setzen_und_rampe_am_selben_beat_nach_startfolge |
| M30_i4_setzen_nach_rampe_erlaubt | I4: Setzen nach der Rampe am selben Beat überlappt (§17 Reihenfolge) | 1 | test_einsortieren:i4_setzen_und_rampe_am_selben_beat_nach_startfolge |
| M31_halter_am_zyklusanfang | Halter am Start-Sample, nicht am Zyklusanfang (Rückgabe im selben Zyklus) | 1 | test_hand:halter_am_start_sample_nach_rueckgabe_im_selben_zyklus |
| M32_ohne_vormerkung | Prüfer sieht alle Teile eines Samples (§17 Reihenfolge) | 1 | test_pruefer:basstausch_als_paar_am_selben_sample_gueltig |
| M33_verspaetet_mit_grund | Quittung 5 mit Grund "" (§16.1, Lesart i, Andreas 2026-09-25) | 1 | test_ablauf:verspaetet_politik_1_restrampe_bis_zum_ende_beat |
| M34_gruppe_gefallen_nie | Naht: gruppe_gefallen wird gerufen (§4.4 Deck-Teile fallen mit) | 3 | test_pruefer:vor_teilstart_lehnt_ab_und_die_gruppe_faellt, test_pruefer:nach_handgriff_sieht_den_handwert_und_greift_ein, test_pruefer:gruppe_gefallen_bei_hand_und_abbruch_nicht_ohne_gruppe |
| M35_gruppe_abbrechen_wirkungslos | Naht: Eingriff::gruppe_abbrechen bricht die Gruppe ab | 1 | test_pruefer:nach_handgriff_sieht_den_handwert_und_greift_ein |
| M36_deck_taste_ohne_halter | Deck-Halter nach der Transport-Taste (§7.3 P5) | 1 | test_hand:deck_halter_32_beats_nach_der_transport_taste |
| M37_transport_als_regler_gemeldet | transport ist kein Regler: nur /e/halter (§5.9) | 1 | test_hand:deck_halter_32_beats_nach_der_transport_taste |
| M38_vorgaenger_wert_vor_dem_start | angrenzende Rampe beginnt beim Ist-Wert am Ziel-Sample (§4.3) | 2 | test_ablauf:angrenzende_rampe_beginnt_beim_endwert_der_vorigen, test_pruefer:vorschau_stimmt_mit_dem_ablauf_ueberein |
| M39_ki_blende_dem_pruefer_vorgelegt | KI-Stopp-Blende wird nie blockiert (ADR 013, pruefer.h intern) | 1 | test_pruefer:intern_teile_werden_nicht_vorgelegt |
| M40_abbruch_ohne_plan_fremde_quelle | /k/abbruch ohne Plan nur eigene Quelle (Festlegung F5) | 1 | test_einsortieren:abbruch_quittiert_angenommen_und_fertig_ohne_plan_nur_eigene_quelle |
| M41_folgenleser_ignoriert_erwarte_nicht | Werkzeug: erwarte_nicht ist eine Negativ-Kontrolle (FORMAT.md Punkt 16) | 1 | folgenleser:rot_nicht(0!=1) |
| M42_folgenleser_gruen_ohne_pruefung | Werkzeug: keine Prüfung ist kein Beleg | 1 | folgenleser:rot_nur_uebersprungen(0!=1) |
| M43_folgenleser_ohne_punkt_8 | Werkzeug: unverbrauchte /q 4 bis 8 macht rot (FORMAT.md Punkt 8) | 1 | folgenleser:rot_unerwartet(0!=1) |
| M44_folgenleser_ohne_verbrauch | Werkzeug: eine Nachricht erfüllt höchstens einen Schritt (FORMAT.md Punkt 6) | 5 | folge:hand_gewinnt.jsonl, folge:zu_spaet.jsonl, folge:i4_ueberlappung.jsonl |
| M45_uebergabe_ueber_frei | Übergabe am selben Sample ohne Halter frei dazwischen (§5.7, §5.9) | 1 | test_ablauf:setzen_und_rampe_am_selben_sample |
| M47_start_vor_hand | Hand gewinnt am selben Sample: vor den Starts angewandt (ADR 023 P2) | 1 | test_hand:hand_am_selben_sample_wie_teilstart_gewinnt |
| M48_stumm_umweg_ueber_minus_60 | Rampe von oder nach stumm nie lauter als beide Enden (F3) | 1 | test_ablauf:stumm_nach_stumm_bleibt_stumm_und_kein_umweg_ueber_minus_60 |
| M49_schaltrampe_linear | Schaltrampe als S-Kurve wie Scheibe 04 (F2) | 2 | test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60, test_ablauf:schaltrampe_beim_setzen_als_s_kurve |
| M50_regler_vorgabe_falsch | Regler-Tabelle gleich §1.5 (Vorgabe fx/<n>/rueckweg 0 dB) | 1 | regler_gegen_vertrag |
| M46_startwert_nicht_gemeldet | /e/regler beim Teilstart mit dem Wert am Start-Sample (§5.7, §1.2) | 1 | test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60 |

Original: 120 grün, 0 rot. Nach dem Zurücksetzen: 120 grün, rot []. Mutationen ohne roten Fall: keine. Baufehler: keine.
