| Mutation | disabled rule | failing cases | Examples |
|---|---|---|---|
| M01_ereignis_am_blockanfang | Start and grab at the sample, not at the block boundary (§1.1, §7.3 P1) | 39 | test_ablauf:start_mitten_im_block_am_exakten_sample, test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60, test_ablauf:schaltrampe_beim_setzen_als_s_kurve |
| M02_hand_bricht_ganzen_plan | Hand aborts only the control and group (ADR 023 P2) | 7 | test_hand:erster_wert_nur_stellung_dann_totzone_dann_uebernahme, test_portiert:t02_handgriff_bei_takt_19_fader_teil_endet_am_selben_sample_kill_laeuft_weiter, test_portiert:t03_kill_und_griff_am_sample_nicht_an_der_blockgrenze |
| M03_ohne_gruppe | Group falls together (§4.3 field 11) | 7 | test_einsortieren:abbruch_wartender_teile_samt_gruppe, test_hand:erster_wert_nur_stellung_dann_totzone_dann_uebernahme, test_hand:hand_bricht_auch_wartende_teile_ab |
| M04_ohne_schiedsrichter | Hand takes over, plan stops (§7.3 P3) | 16 | test_angriffe:a4_knopf_unbekannt_erster_wert_nur_stellung_kein_sprung, test_angriffe:a4_negativ_kontrolle_knopf_wie_angenommen, test_angriffe:a5_positiv_kontrolle_ein_griff_ueber_der_totzone_bricht_ab |
| M05_erster_wert_wirkt | first value only position (§7.3 P2) | 9 | test_angriffe:a4_knopf_unbekannt_erster_wert_nur_stellung_kein_sprung, test_hand:erster_wert_nur_stellung_dann_totzone_dann_uebernahme, test_hand:stellung_vergessen_nach_neuverbindung |
| M06_ohne_totzone | dead zone 3/128 (§7.3 P3) | 6 | test_angriffe:a4_knopf_unbekannt_erster_wert_nur_stellung_kein_sprung, test_angriffe:a4_negativ_kontrolle_knopf_wie_angenommen, test_angriffe:a5_ein_rauschschritt_unter_der_totzone_bricht_nichts_ab |
| M07_sprung_statt_skaliert | Takeover scales without a jump (§7.3 P3) | 6 | test_angriffe:a4_knopf_unbekannt_erster_wert_nur_stellung_kein_sprung, test_angriffe:a4_negativ_kontrolle_knopf_wie_angenommen, test_hand:erster_wert_nur_stellung_dann_totzone_dann_uebernahme |
| M08_relativ_als_absolut | encoder relative (§7.3 P3) | 2 | test_hand:relativ_mit_totzone_ueber_die_summe, test_portiert:t06_uebernahme_skaliert_und_relativ_ohne_sprung |
| M09_ohne_rueckgabe | return after 32 beats (§7.3 P4, P5) | 4 | test_hand:rueckgabe_nach_32_beats_ohne_hand, test_hand:deck_halter_32_beats_nach_der_transport_taste, test_portiert:t02_handgriff_bei_takt_19_fader_teil_endet_am_selben_sample_kill_laeuft_weiter |
| M10_startwert_nicht_ist_wert | ramp starts at the actual value (§4.3) | 19 | test_ablauf:teil_rampe_golden, test_ablauf:halter_und_meldungen_bei_start_und_ende, test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60 |
| M11_setzen_ziel_nicht_uebergeben | ramp begins at the target value of a set at the same sample (§4.3) | 5 | test_ablauf:setzen_und_rampe_am_selben_sample, test_ablauf:setzen_fremder_plan_vor_rampe_am_selben_beat, folge:teil_rampe.jsonl |
| M12_ohne_stumm_regel | ramps from/to mute over -60 dB (§1.2) | 9 | test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60, test_ablauf:stumm_nach_stumm_bleibt_stumm_und_kein_umweg_ueber_minus_60, test_ablauf:rampe_aus_stumm_und_s_kurve |
| M13_i4_nur_fremde_plaene | I4 also within the same plan (§17) | 4 | test_angriffe:a3_ueberlappung_im_selben_plan_abgelehnt_kein_sprung, test_einsortieren:i4_ueberlappung_auch_im_selben_plan, test_einsortieren:i4_setzen_und_rampe_am_selben_beat_nach_startfolge |
| M14_zu_spaet_trotzdem | policy 0 discarded as too late (§16.1) | 4 | test_einsortieren:zu_spaet_politik_0_verworfen_politik_1_angenommen, test_portiert:t08_verriegelung_a4_nichts_wird_ungehoert_hoerbar, folge:zu_spaet.jsonl |
| M15_startsample_bei_annahme | start sample per cycle after the tempo card (§4.3, beat time) | 2 | test_ablauf:tempo_132_nach_annahme_schaltpunkte_bleiben_auf_dem_takt, test_portiert:t07_tempo_132_ab_takt_18_schaltpunkte_bleiben_auf_ihrem_takt |
| M16_ki_stopp_ohne_abbruch | AI stop aborts cypher parts (§4.7) | 3 | test_ki:stopp_bricht_cypher_teile_ab_andere_laufen, test_ki:stopp_taste_ohne_quittung_mit_wirkung, folge:ki_stopp.jsonl |
| M17_ki_ohne_sperre | after the stop, cypher rejected (§4.7) | 2 | test_ki:nach_dem_stopp_cypher_abgelehnt_bis_frei_von_andreas, folge:ki_stopp.jsonl |
| M18_ohne_halterpruefung_am_start | start checks the holder is mensch (§4.3) | 2 | test_hand:halter_am_start_sample_nach_rueckgabe_im_selben_zyklus, test_portiert:t11_verriegelung_die_uebrigen_gruende_treffen_einzeln |
| M19_ohne_nur_hand | Who may: only hand (§1.5) | 1 | test_einsortieren:unbekannt_nur_hand_bereich_stems |
| M20_s_kurve_linear | form 1 S-curve (§4.3 field 9) | 3 | test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60, test_ablauf:schaltrampe_beim_setzen_als_s_kurve, test_ablauf:rampe_aus_stumm_und_s_kurve |
| M21_beruehrung_ohne_uebernahme | touch takes over immediately (§7.3 P3) | 8 | test_hand:beruehrung_uebernimmt_sofort_ohne_wert, test_hand:hand_bricht_auch_wartende_teile_ab, test_portiert:t02_handgriff_bei_takt_19_fader_teil_endet_am_selben_sample_kill_laeuft_weiter |
| M22_pruefer_vor_teilstart_nie | seam: vor_teilstart is asked (§17) | 7 | test_echtzeit:fehlerfall_allokierender_pruefer_wird_gezaehlt, test_portiert:t08_verriegelung_a4_nichts_wird_ungehoert_hoerbar, test_portiert:t11_verriegelung_die_uebrigen_gruende_treffen_einzeln |
| M23_pruefer_je_zyklus_nie | seam: je_zyklus is called (§17) | 5 | test_echtzeit:dauerlauf_mit_vollem_pruefer_0_allokationen, test_portiert:t08_verriegelung_a4_nichts_wird_ungehoert_hoerbar, test_pruefer:je_zyklus_bricht_vor_dem_oeffnen_ab |
| M24_pruefer_nach_handgriff_nie | seam: nach_handgriff is called (§17) | 2 | test_pruefer:nach_handgriff_sieht_den_handwert_und_greift_ein, test_pruefer:nach_handgriff_auch_fuer_die_transport_taste |
| M25_vorschau_ohne_starts | seam: preview knows the starts of the cycle | 3 | test_pruefer:pruefwert_vor_und_mit_bestimmen_den_oeffner, test_pruefer:basstausch_als_paar_am_selben_sample_gueltig, test_pruefer:vorschau_stimmt_mit_dem_ablauf_ueberein |
| M26_regler_ohne_drossel | /e/regler at most 50 Hz (§5.7) | 1 | test_melder:regler_waehrend_der_rampe_hoechstens_50_hz |
| M27_hand_ohne_nachzuegler | /e/hand last event of the gesture (§5.8) | 1 | test_melder:hand_geste_erstes_letztes_und_hoechstens_20_hz |
| M28_allokation_im_prozess | no allocation in the process call (ADR 002) | 2 | test_echtzeit:dauerlauf_64_regler_hand_ki_0_allokationen, test_echtzeit:dauerlauf_mit_vollem_pruefer_0_allokationen |
| M29_i4_zwei_setzen_erlaubt | I4: two sets at the same beat overlap (09 herleitung.py) | 1 | test_einsortieren:i4_setzen_und_rampe_am_selben_beat_nach_startfolge |
| M30_i4_setzen_nach_rampe_erlaubt | I4: a set after the ramp at the same beat overlaps (§17 order) | 1 | test_einsortieren:i4_setzen_und_rampe_am_selben_beat_nach_startfolge |
| M31_halter_am_zyklusanfang | holder at the start sample, not at the cycle start (return within the same cycle) | 1 | test_hand:halter_am_start_sample_nach_rueckgabe_im_selben_zyklus |
| M32_ohne_vormerkung | checker sees all parts of a sample (§17 order) | 1 | test_pruefer:basstausch_als_paar_am_selben_sample_gueltig |
| M33_verspaetet_mit_grund | receipt 5 with reason "" (§16.1, reading i, Andreas 2026-09-25) | 1 | test_ablauf:verspaetet_politik_1_restrampe_bis_zum_ende_beat |
| M34_gruppe_gefallen_nie | seam: gruppe_gefallen is called (§4.4 deck parts fall with it) | 3 | test_pruefer:vor_teilstart_lehnt_ab_und_die_gruppe_faellt, test_pruefer:nach_handgriff_sieht_den_handwert_und_greift_ein, test_pruefer:gruppe_gefallen_bei_hand_und_abbruch_nicht_ohne_gruppe |
| M35_gruppe_abbrechen_wirkungslos | seam: Eingriff::gruppe_abbrechen aborts the group | 1 | test_pruefer:nach_handgriff_sieht_den_handwert_und_greift_ein |
| M36_deck_taste_ohne_halter | deck holder after the transport key (§7.3 P5) | 1 | test_hand:deck_halter_32_beats_nach_der_transport_taste |
| M37_transport_als_regler_gemeldet | transport is not a control: only /e/halter (§5.9) | 1 | test_hand:deck_halter_32_beats_nach_der_transport_taste |
| M38_vorgaenger_wert_vor_dem_start | adjacent ramp begins at the actual value at the target sample (§4.3) | 2 | test_ablauf:angrenzende_rampe_beginnt_beim_endwert_der_vorigen, test_pruefer:vorschau_stimmt_mit_dem_ablauf_ueberein |
| M39_ki_blende_dem_pruefer_vorgelegt | AI stop fade is never blocked (ADR 013, pruefer.h internal) | 1 | test_pruefer:intern_teile_werden_nicht_vorgelegt |
| M40_abbruch_ohne_plan_fremde_quelle | /k/abbruch without a plan only own source (decision F5) | 1 | test_einsortieren:abbruch_quittiert_angenommen_und_fertig_ohne_plan_nur_eigene_quelle |
| M41_folgenleser_ignoriert_erwarte_nicht | tool: erwarte_nicht is a negative control (FORMAT.md point 16) | 1 | folgenleser:rot_nicht(0!=1) |
| M42_folgenleser_gruen_ohne_pruefung | tool: no check is no evidence | 1 | folgenleser:rot_nur_uebersprungen(0!=1) |
| M43_folgenleser_ohne_punkt_8 | tool: unconsumed /q 4 to 8 makes it red (FORMAT.md point 8) | 1 | folgenleser:rot_unerwartet(0!=1) |
| M44_folgenleser_ohne_verbrauch | tool: one message fulfills at most one step (FORMAT.md point 6) | 5 | folge:hand_gewinnt.jsonl, folge:zu_spaet.jsonl, folge:i4_ueberlappung.jsonl |
| M45_uebergabe_ueber_frei | handover at the same sample, free of holder in between (§5.7, §5.9) | 1 | test_ablauf:setzen_und_rampe_am_selben_sample |
| M47_start_vor_hand | hand wins at the same sample: applied before the starts (ADR 023 P2) | 1 | test_hand:hand_am_selben_sample_wie_teilstart_gewinnt |
| M48_stumm_umweg_ueber_minus_60 | ramp from or to mute never louder than both ends (F3) | 1 | test_ablauf:stumm_nach_stumm_bleibt_stumm_und_kein_umweg_ueber_minus_60 |
| M49_schaltrampe_linear | switch ramp as an S-curve like slice 04 (F2) | 2 | test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60, test_ablauf:schaltrampe_beim_setzen_als_s_kurve |
| M50_regler_vorgabe_falsch | control table equal to §1.5 (spec fx/<n>/rueckweg 0 dB) | 1 | regler_gegen_vertrag |
| M46_startwert_nicht_gemeldet | /e/regler at part start with the value at the start sample (§5.7, §1.2) | 1 | test_ablauf:setzen_von_und_nach_stumm_ueber_minus_60 |

Original: 120 green, 0 red. After reverting: 120 green, red []. Mutations without a red case: none. Build errors: none.
