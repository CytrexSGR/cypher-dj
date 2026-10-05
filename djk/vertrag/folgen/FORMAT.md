# Golden-Folgen: Format und Läufer-Regeln (Vertrag 1)

Grundlage: `docs/architektur/SCHNITTSTELLEN.md` §19.0 (Format) und §19.3 (Pflichtfolgen). Aufbau je Zeile:
`djk/vertrag/folge.schema.json`. Prüfung aller Dateien: `python3 djk/vertrag/pruefe_folgen.py`. Jede Folge läuft
gegen die Kern-Attrappe (Scheibe 13) und gegen den Kern (Läufer `attrappe_leitstand.py`, Scheibe 08).

1. **Datei.** `djk/vertrag/folgen/<name>.jsonl`, UTF-8, eine JSON-Zeile je Schritt. Der Läufer arbeitet die Schritte
   in Dateireihenfolge ab.
2. **Zeitachse.** Der erste Schritt jeder Folge ist `sende` mit `/k/set/neu` und `sample` 0 („sofort“). Die Folge
   rechnet ab der Quittung `gestartet` dieses Befehls in Samples der neuen Zeitachse (§1.1: Sample 0 ist der erste
   Zyklus danach). Bis diese Quittung da ist, wartet der Läufer höchstens 2 s Wanduhr, sonst ist die Folge rot.
3. **`sende`** `{"t":"sende","sample":S,"osc":[adresse, typen, w1, …]}`: der Läufer schickt die Nachricht, sobald
   die Kern-Uhr S erreicht hat (aus `/uhr` hochgerechnet, §5.2). Den Vorlauf nach §3 plant die Folge selbst ein
   (S liegt früh genug vor dem Ziel-Beat des Befehls).
4. **Kennungen.** Felder mit Namen `id` oder `ziel_id` (Typ `h`, Namen aus `osc.json`) tragen in der Folge kleine
   Zahlen ab 1. Der Läufer addiert beim Senden und beim Vergleichen eine Basis B (sein `mono_ns` beim Start der
   Folge, §1.4), damit Kennungen über Läufe hinweg streng steigend bleiben.
5. **`hand`** `{"t":"hand","sample":S,"pfad":P,"midi_roh":x}`: der Läufer schickt `/test/hand ,sfh` mit
   `[P, x, S]` mindestens 2 Zyklen plus Transport vor S (§3); wirksam am Sample S (nur mit `pruefmodus = true`).
6. **`erwarte`** `{"t":"erwarte","bis_sample":S,"osc":[adresse, typen, w1, …],"toleranz":x}`: eine Nachricht mit
   gleicher Adresse und Typ-Zeichenkette, deren Werte passen, muss eintreffen, bevor die Kern-Uhr S überschreitet.
   Vergleich je Wert: `null` passt auf alles; `i`, `h`, `s` genau; `f`, `d` mit |ist − soll| ≤ `toleranz`
   (Vorgabe 0); `"NaN"` passt nur auf NaN, `"inf"`/`"-inf"` nur auf die Unendlichkeit mit diesem Vorzeichen.
   Gesucht wird in allen seit dem Start der Folge eingetroffenen, noch nicht verbrauchten Nachrichten; eine Nachricht
   erfüllt höchstens einen Schritt. Die Reihenfolge der `erwarte`-Zeilen legt keine Reihenfolge der Nachrichten fest.
7. **`wert`** `{"t":"wert","sample":S,"pfad":P,"wert":v,"toleranz":x}`: der Regler P hat am Sample S den Wert
   v ± x (Kern: aus `/e/regler`; Attrappe und Bibliotheken: direkt aus ihrer Regler-Tabelle).
8. **Ende.** Grün, wenn alle `erwarte`- und `wert`-Schritte erfüllt sind und keine unverbrauchte Nachricht
   `/e/protokollfehler`, `/e/invariante` oder `/q` mit Status 4 bis 8 übrig ist (eine unerwartete Ablehnung oder
   Verspätung macht die Folge rot).
9. **`absicht`** (nur bei `sende`): `unbekannte_adresse` oder `falsche_typen` kennzeichnet eine absichtlich
   vertragswidrige Nachricht; `pruefe_folgen.py` prüft, dass sie es wirklich ist.
10. **`notiz`**: freier Text für Menschen, ohne Wirkung. Weitere Felder in einer Zeile ignoriert der Läufer
    (Vertragsregel für JSON: neue optionale Felder sind erlaubt); spätere Scheiben dürfen so etwa `herleitung`
    ergänzen, ohne dieses Format zu brechen. Neue Schritt-Arten (`t`) kommen nur mit einer Zeile in dieser Datei dazu.
11. **Quantum.** Folgen, die `/uhr` erwarten, wählen Blockanfänge, die bei Quantum 128 und 256 gelten (Vielfache
    von 256 Samples).
12. **Herkunft der Zahlen.** Erwartungswerte schreibt nie jemand ab: `erzeuge_folgen.py` rechnet sie mit `karte.py`
    (Formeln aus §1.3) aus, und `pruefe_folgen.py` vergleicht `karte.py` mit der Golden-Tabelle in §1.3.

## Zusätze von Scheibe 09

Additiv zu den Punkten 1 bis 12: keine bestehende Zeile ändert ihre Bedeutung. Aufbau je Zeile:
`folge.schema.json`; Herleitung und Prüfung der Folgen von 09: `erzeuge_golden.py`, `pruefe_golden.py`; Vergleich
einer Beobachtung mit einer Folge in Code: `folgen_vergleich.py`.

13. **Läufer als Abonnent.** Der Läufer meldet sich vor der ersten Zeile mit `/k/hallo` an (Name und Port seiner
    Prüfinstanz, Z2) und wiederholt es jede Sekunde (Herzschlag, §4.1); kommt 100 ms lang kein `/uhr`, sofort und dann
    alle 50 ms (§16.3). Eine Folge sendet `/k/hallo` nie selbst; `neustart` verlässt sich auf diesen Herzschlag.
14. **Zusatzfelder.** Jede Zeile darf `herleitung` (Abschnitt und Formel, nur zum Lesen) und `bereich` tragen
    (`zeitachse`, `regler`, `ki`, `deck`, `hoerschein`, `schuss`, `erzeuger`, `invariante`, `pruefstand`, `leitstand`,
    `rechner`). Ein Läufer fährt die Folgen, die `INDEX.json` unter `fuer` für seine Scheibe nennt. Baut er einen
    Bereich nicht (die Stellwerk-Bibliothek von Scheibe 11 ohne Decks, Hörscheine und Invarianten), überspringt er
    dessen Zeilen; die für ihn genannten Folgen sind so gebaut, dass die übrigen Zeilen für ihn dasselbe ergeben wie
    für den vollen Kern. `erwarte` darf `ab_sample` tragen: das Fenster ist dann `[ab_sample, bis_sample]`, sonst
    `[0, bis_sample]`; wer `ab_sample` nicht liest, prüft schwächer, nie falsch.
15. **Reihenfolge der Handlungen.** `sende`, `buendel`, `hand`, `aktion` und `ws_sende` stehen in nicht fallender
    Sample-Folge; der Läufer arbeitet sie in Dateireihenfolge ab.
16. **Neue Schritt-Arten.** Ein Läufer, der eine Schritt-Art nicht kennt, bricht rot ab; still überspringen darf er nur
    nach Punkt 14.

    | `t` | Felder | Bedeutung |
    |---|---|---|
    | `erwarte_nicht` | `ab_sample`, `bis_sample`, `osc`, `toleranz`? | im Fenster trifft keine passende Nachricht ein (verbraucht oder nicht); Negativ-Kontrolle |
    | `erlaube` | `ab_sample`, `bis_sample`, `osc`, `herleitung` | passende Nachrichten im Fenster sind erlaubt (null bis viele) und zählen nicht nach Punkt 8; nur wo der Vertrag offen lässt, ob eine Meldung kommt (Punkt 22) |
    | `buendel` | `sample`, `nachrichten` | OSC-Bündel mit Zeitmarke 1 („sofort“), §4.8; `t_send_us` ist 0 (nur Diagnose) |
    | `deck_wert` | `sample`, `deck`, `feld`, `wert`, `toleranz` | `feld` aus `/zustand/deck` §5.5 (`status`, `quell_beat`, `beats_bis_ende`, `faktor`); Kern: aus `/zustand/deck` (50 Hz; zwischen zwei Meldungen linear, `status` die letzte davor); Attrappe und Bibliothek: aus ihrem Deck-Modell |
    | `messung` | `sample`, `name`, `wert`, `toleranz` | misst der Prüfstand am Ziel (JACK-Aufnehmer an eigener Null-Senke): `schleife_frames`, `stille_ms`, `rueckgabe_raster_abw_samples` |
    | `aktion` | `sample`, `was` | Eingriff des Prüfstands, heute nur `kern_kill9` |
    | `ws_sende`, `ws_erwarte` | `sample` bzw. `ab_sample`, `bis_sample`; `typ`, `daten` | WebSocket an bzw. vom Leitstand (§9); den Umschlag §9.1 setzt der Läufer; Vergleich als Teilmenge (erwartete Schlüssel müssen da sein und passen, weitere sind erlaubt, Listen gleich lang) |
    | `rechner_frage`, `rechner_antwort` | `zeile` | eine JSON-Zeile an den Rechner (§11) bzw. seine Antwort, Vergleich als Teilmenge |

17. **Rechner-Folgen** bestehen nur aus `rechner_frage` und `rechner_antwort` und haben keine Zeitachse (Ausnahme zu
    Punkt 2; `pruefe_folgen.py` lässt sie ohne `/k/set/neu` zu).
18. **Leitstand-Folgen.** Die OSC-Zeilen schickt der Läufer weiter direkt an den Kern (oder die Kern-Attrappe); der
    Leitstand läuft daneben als Abonnent; die `ws_*`-Zeilen gehen an den Leitstand.
19. **Kennungen in WebSocket und Rechner.** `id` in `rpc` und in Rechner-Zeilen gelten, wie sie stehen; die Basis B
    aus Punkt 4 gilt nur für OSC.
20. **Toleranz.** Wie Punkt 6 (Vorgabe 0). Die Folgen von 09 tragen `toleranz` in jeder Zeile mit Gleitkommawerten:
    1e-6 für Beats und BPM in Quittungen, sonst den Wert, den ihre `herleitung` begründet.
21. **Fixtures und Verzeichnis.** Jede `material_id` aus `/k/deck/laden` oder `/k/schuss` liegt unter
    `folgen/material/<material_id>/` (nur JSON; die Audiodaten sind deterministisch und werden erzeugt). Der Läufer
    schreibt das Material vor der Folge mit `python3 djk/vertrag/erzeuge_material.py --ziel <arbeitsbestand>` in den
    Arbeitsbestand (§6.4); `f0000000000000ff` fehlt mit Absicht (`material_fehlt`). `folgen/INDEX.json` nennt je Folge
    `von` (02 oder 09), `fuer` (Scheiben, die sie fahren), `bereiche`, `schritt_arten` und `material`.
    Die Folgen setzen die Vorgaben aus §2.1 voraus (`ziel_lufs` −16, `hoerbar_db` −26, `tief_offen_db` −12) und
    `pruefmodus = true`. Jede Fixture außer `f0000000000000c3` (−9,4 LUFS) und `f0000000000000d4` (−45 LUFS), die nur
    `laden` benutzt, hat `lufs_integriert` −16, also Trim 0 dB (§1.5): so liegen die Schwellen aus §1.6 direkt auf den
    Fader-Werten der Folgen.
22. **Offene Lesarten des Vertrags** (Befund an die Hauptinstanz). Wo der Text zwei Lesarten zulässt, legt keine Folge
    eine fest, außer hier genannt; bis die Hauptinstanz entscheidet, gilt:
    a. Ob eine I3-Ablehnung zusätzlich `/e/invariante hoerschein` meldet (§5.9 kennt die Art, §17 nennt nur die
       Quittung): offen, `erlaube`.
    b. Ob eine Ablehnung am Start die Kopplungsgruppe mitreißt (§4.3 „fallen gemeinsam“): offen; Folgen, die eine
       Ablehnung prüfen, geben den abgelehnten Teilen keine Gruppe. (`kern_sim.mjs` der Nacht reißt sie mit.)
    c. Ein ausgeführter Deck-Start ist abgeschlossen und fällt bei einem späteren Gruppenabbruch nicht mehr
       (`hand_gewinnt`).
    d. Die Übernahme-Kurve „skaliert“ (§7.2) ist nicht festgelegt: die Folgen nutzen Anschläge (0,0 und 1,0) und
       Richtungen, nie einen Zwischenwert.
    e. Ein wartender Teil am gegriffenen Regler fällt beim Griff (Status 7 `hand`, ADR 023) oder an seinem Start
       (Status 6 `regler_beim_menschen`, §4.3): offen, Status frei (`sub_doppelt`).
    f. Ob ein wegen I2 wartender Plan-Stopp eine eigene `/e/invariante master_leer` meldet: offen, `erlaube`. Der
       wartende Stopp bleibt `angenommen` (§17 I2), eine Quittung `gestartet` ist rot.
    g. `/test/hand` auf `<k>/xseite` (drei Stellungen): Wert = `round(2·midi_roh)`; `crossfader_luecke` prüft das mit
       einer `wert`-Zeile, bevor sie sich darauf stützt.
    h. `/erz/quittung` zählt `ungehoert` beim Einsetzen des Fensters (Antwort auf das Bündel), nicht erst beim Spielen.
    i. Grund bei Status 5 (`verspaetet_ausgefuehrt`): `""` oder `zu_spaet`, beides zulässig; bei Status 4 `zu_spaet`.
    j. `/k/hoerschein` trägt in den Folgen die Quelle `pruefstand` (§1.4 kennt keine Quelle `analyse`).
    k. Ein am Start abgelehnter Teil meldet `ist_sample` = sein Ziel-Sample (§17 „am Start abgelehnt“).
    l. Ob `/e/frist` zwischen dem Setzen des Rückfall-Loops und dem Erreichen des Loops noch kommt (§5.5 „∞ im
       Loop“): offen, keine Zeile.
    m. Ob der Rückfall schon beim Eintreffen eines Befehls an das Deck endet oder erst beim Ausführen: offen, das
       Fenster beginnt beim Senden (`rueckfall`).
    n. Ob I1 ein Setzen mit seinem Zielwert prüft (Dossier 09 §5.3 V1) oder mit dem Wert seiner Schaltrampe (Dossier 09
       Nachprüfung NK3: der Plan §14.1 hätte dann 192 Samples Sub doppelt an S): offen. Keine Folge schließt einen Bass
       per Setzen am selben Sample, an dem ein Kanal hörbar wird, während ein anderer tief offen ist; das Setzen liegt
       einen Beat vorher, solange der Kanal noch hinter dem geschlossenen Fader liegt (`b_rein` in `folgen_bau.py`,
       `hand_stoppt_a_raus`).

    **Entschieden 2026-09-25 (Andreas; Blatt `docs/architektur/entwuerfe/2026-09-25-lesarten-09.md`):**
    b: ja, die Ablehnung am Start reißt die Gruppe mit (SCHNITTSTELLEN §4.3 Feld 11). e: der wartende Teil fällt beim
    Griff, Status 7 `hand` (§4.3, ADR 023). n: I1 prüft über die Schaltrampe (§17); die Regel §14.4 setzt B's Bass einen
    Beat vor S (`herleitung.expandiere`, `expandiere_sicher.jsonl`). a, f: je einmal melden. i: `""`. j: Quelle
    `leitstand`. l: keine `/e/frist`. m: Ende beim Ausführen. c, d, g, h, k: wie oben. **Noch offen:** die Folgen, die
    b, e, n, a, f, i, l, m mit `erlaube` oder Status `null` offenhalten, auf `erwarte`/`erwarte_nicht` schärfen
    (gehört Scheibe 20 bzw. vor 13; bis dahin lassen sie beide Lesarten durch).
