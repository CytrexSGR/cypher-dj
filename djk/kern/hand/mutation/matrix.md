| Mutation | disabled rule | failing cases | Examples |
|---|---|---|---|
| M01_blockgrenze | Event takes effect at the offset, not at the block boundary (§7.3 P1, 09 check b naiv_block) | 3 | test_naht:test_hand_und_midi_liefern_denselben_griff, test_naht:hand_bricht_plan_am_versatz_sample, test_uebersetzer:sample_am_versatz_nicht_am_blockanfang |
| M02_x_durch_128 | Position = value / 127 (end stop 127 = 1.0) | 5 | test_kurven:fader_db_tabelle_ueber_midi, test_kurven:linear_crossfader_ueber_midi, test_naht:test_hand_und_midi_liefern_denselben_griff |
| M03_zweierkomplement_als_versatz64 | two's complement sign-correct (F4) | 5 | test_naht:encoder_beider_kodierungen_richtig_herum_am_regler, test_naht:encoder_aus_kill_ganz_unten, test_uebersetzer:zweierkomplement_vorzeichenrichtig |
| M04_versatz64_als_zweierkomplement | offset-64 sign-correct (F4) | 4 | test_naht:encoder_beider_kodierungen_richtig_herum_am_regler, test_uebersetzer:versatz64_vorzeichenrichtig, test_uebersetzer:fehlerfall_falsche_kodierung_dreht_die_richtung |
| M05_note_on_0_ist_druck | Note-On with velocity 0 is release | 3 | test_uebersetzer:taste_note_druck_und_loslassen, test_uebersetzer:schalter_nur_beim_druck_beruehrung_nur_beim_beruehren, test_uebersetzer:deck_tempo_und_tasten_mit_werten |
| M06_ziel_ungeprueft | unknown target is rejected (§7.2) | 2 | test_mapping:fehlerhafte_mappings_mit_art_und_zeile, test_mapping:fehlertext_nennt_zeile_und_ziel |
| M07_kodierung_ungeprueft | wrong encoding is rejected (§7.2) | 1 | test_mapping:fehlerhafte_mappings_mit_art_und_zeile |
| M08_zeile_immer_1 | error names the line | 2 | test_mapping:fehlerhafte_mappings_mit_art_und_zeile, test_mapping:pflichtfelder_und_leere_datei |
| M09_umschalten_immer_an | key toggles the switch (F5) | 1 | test_naht:taste_schaltet_kill_um |
| M10_blinkt_als_an | LED state blinks sends the value `blinkt` (§7.2, §7.4) | 1 | test_led:nachricht_je_zustand |
