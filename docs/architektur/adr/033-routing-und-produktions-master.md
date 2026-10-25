# ADR 033: Routing und Produktions-Master im Modul Arrangement (Gruppen-Spuren, PM, Export-Abgriff)

Status: gebaut auf dem Zweig `r1-routing` (Paket 1.10, Slice 1 und 2), 2026-10-24; Abnahme durch Andreas offen, nicht gemergt.
Entschieden: E2 (eigener Produktions-Master mit Export-Abgriff vor dem Set-Limiter) von Andreas am 2026-10-20; F1 bis F3 (Gruppen
und Returns auf eigenen Plätzen neben den 32 Spuren, Mute nullt die Spur samt Sends, Solo lässt Gruppe und Returns klingen,
neues Projekt ohne Returns) von Andreas am 2026-10-22; die Form (Entscheidungen 1 bis 7) von Cypher im Plan
`docs/superpowers/plans/2026-10-23-1.10-routing-slice1-2.md` (P1 bis P14) und von der Hauptinstanz am 2026-10-24 (N7, N8).
Spec: `docs/superpowers/specs/2026-10-22-1.10-routing-busse.md`. Stand und Messzahlen: `docs/architektur/stand/routing-1-10.md`.
Vorgänger: ADR 030 ("Produktions-Kanalzüge (Inserts, Sends, Gruppen) wachsen im Modul, nicht im DJ-Mixer").

## Kontext

Nach D1, E1 und E3 summiert das Modul Arrangement bis zu 32 Spuren flach und gibt die Summe in den Eingang von `erz/4`
(`djk/kern/src/arr_ausgang.cpp`, `Arrangement::mischen`). Es gibt keine Gruppen, keinen eigenen Master der Produktion und keinen
Export, der etwas anderes liest als den Ring-Master hinter dem Set-Limiter (`djk/kern/src/render.cpp`, `ring.h`: vier
Kanäle). Ein Export, der Saal-Limiter, Kleber, `master/pegel` und das Crossfader-Gewicht mitnimmt, ist für Mastering außerhalb
unbrauchbar. Paket 1.10 soll Gruppen, Returns, Sidechain, Matrix und Resampling bringen; dieser ADR hält die Entscheidungen
der Slices 1 und 2 fest (eine Gruppe samt PM-Fader von der Seite bis zum Ausgang, dann der Export-Abgriff mit Anzeige).

## Entscheidung

1. **Gruppen und PM sind Streifen im Modul Arrangement, nicht im DJ-Mixer.** Der Mischer rechnet in fester Reihenfolge
   Spuren, Gruppen, Produktions-Master (PM); Tiefe 1 (Gruppen verschachteln nicht), kein Sidechain in diesen Slices. Es gibt acht
   Gruppen (`ARR_GRUPPEN`, `djk/kern/include/cypherdj/arr_wiedergabe.h:27`), der PM hat den Streifen-Index `ARR_PM`
   (`arrangement.h:28`). Die Summe des PM geht wie bisher in den Eingang von `erz/4`. Mute einer Gruppe nullt alle Mitglieder;
   Solo auf einer Spur lässt ihre Gruppe klingen (die anderen Mitglieder nicht), Solo auf einer Gruppe lässt alle ihre Mitglieder
   klingen (F2, P7). Ein Ziel-Wechsel einer Spur (Master, Gruppe) blendet linear über 480 Samples (`ARR_ZIEL_BLENDE`,
   `arrangement.h:27`, P8). Ein Projekt ohne Gruppen rechnet bitgleich wie vorher (Referenzdatei `arr_mixer_solo_ref.bin`
   unverändert).
2. **Die Topologie steht in der Wiedergabe, die Pegel sind Stellwerk-Regler.** Wiedergabe `cypherdj-arr/2` trägt je Spur `ausgang`
   (`{"art":"master"}` oder `{"art":"gruppe","nr":n}`) und die Liste `gruppen` (`nr`, `ausgang`); keine `reihenfolge` (kommt in
   Slice 5). Pegel sind die Regler `grp/<n>/{fader,pan,mute,solo}` (n = 1 bis 8) und `pm/fader`, angehängt hinter `spur/32/solo`
   (Index 564 bis 596), kein bestehender Index wandert. Die Pegel `grp/<n>` und `pm` meldet der Kern über `/pegel`.
3. **Der Pan einer Gruppe ist eine Balance, nicht das Spur-Gesetz** (P14, Abweichung von Spec AK5). Mitte 0 dB; zur Seite wird die
   abgewandte Seite bis stumm leiser (`arr_ausgang.cpp:39`, benutzt an `:230`). Das Spur-Gesetz (−3 dB in der Mitte) auf eine schon
   stereo gemischte Gruppensumme angewandt senkte jede Gruppe um 3 dB; Bass und Pad in eine Gruppe zu stecken machte die Mischung
   leiser. Der Test `gruppieren_aendert_pegel_nicht` hält das fest. Das ist hörbar und gehört Andreas; eine Zeile (`pan_gain`
   statt `balance_gain`) stellt es um.
4. **Der PM-Ausgang ist der Export-Abgriff.** Der Kern kopiert den PM-Ausgang jeden Block in vorallokierte Puffer
   (`Kern::pm_abgriff_l()`, `pm_abgriff_r()`, `kern.h:277`; Kopie direkt hinter `arr_->block` in `kern_stellwerk.cpp:410`), und
   `cypherdj-render` liest sie mit `--abgriff produktion` statt des Rings (`render.cpp:120`, `:161`). Das Programm liefert
   `ueber_decke` (Sample-Spitze des Abgriffs über `limiter_dbtp`) und `limiter_db_max` (größte Absenkung des Set-Limiters während
   des Renders, positive dB, 0 = griff nie ein; P10). `--abgriff set` bleibt die Vorgabe des Programms (heutiges Verhalten, P11);
   der Server schickt immer ausdrücklich `produktion` oder `set` und prüft, dass die Antwort denselben Wert nennt. `POST /proj/export`
   nimmt `abgriff`, Vorgabe `produktion`; die Lautheit der Antwort wird am PM gemessen. Nicht im Abgriff: Metronom, `erz/4`-Kanalzug,
   Kleber, `master/pegel`, Set-Limiter.
   **Befund N7 (gemessen, ändert die Spec-Gegenprobe):** `erz/4` ist bei neutraler Stellung nur im Betrag neutral. Der LR8-Isolator
   (Gains 1,0) wirkt als Allpass und verschiebt die Phase (1 kHz 0,8448 rad, 1,5 kHz 2,4847 rad, Betrag 0,0000 dB). Der PM-Abgriff ist der
   PM ohne DJ-Kanalzug, der Ring-Master derselbe PM durch den Isolator. Ein Sample-Vergleich "Export gegen Ring-Mitschnitt" ist deshalb
   nie null, auch bei leisem Material (Kern-Test: −11,4 dBFS Rest; live am echten Kern: −28,660 dBFS). Die Spec (Abschnitt 4,
   Gegenprobe) sagte: "Misst das nicht, gilt die Empfehlung nicht." Die Form der Gegenprobe (sampleweise Gleichheit) ist damit
   widerlegt; die Hauptinstanz hat entschieden, dass die Empfehlung bleibt: der Saal hört den PM durch einen Allpass, im Betrag
   gleich, und die Produktion bekommt bewusst keinen DJ-Kanalzug (`docs/masterplan/D1-SPEC.md` 2.3). AK17 vergleicht darum gegen
   `cypherdj::dsp::Isolator` (Gains 1,0, frisch ab Lauf- oder Renderbeginn) über dem Abgriff (Kern-Test −240 dBFS, live −758,990
   dBFS); ist der Isolator-Zustand nicht frisch, bleibt nur ein Betragsvergleich (Spitze und integrierte Lautheit auf 0,05 dB).
5. **Formate: Projekt `/2` mit Migration, Wiedergabe `/2` nur bei Routing (seit Paket 1.13 auch bei einem gewarpten Clip, ADR 031).** `cypherdj-projekt/2` verlangt `gruppen` und
   `master {fader_db}`; `Spur.ausgang` ist optional (fehlt = Master), damit alte Patches gültig bleiben. Ein `/1`-Projekt öffnet
   weiter und wird beim Laden im Speicher zu `/2` gehoben (`djk/oberflaeche/projekt/modell.ts:349`), gespeichert wird `/2`; das
   I08-Feld `aufnahme` bleibt unverändert. Der Verlauf (`undo.jsonl`) trägt keine Formatzeile. Der Übersetzer schreibt Wiedergabe
   `/2` nur, wenn das Projekt Gruppen hat oder eine Spur nicht auf Master zeigt (`wiedergabe.ts:157`; seit Paket 1.13 auch, wenn ein Audio-Clip einen
   Warp trägt, der an ist, siehe ADR 031 Punkt 5: dann steht `gruppen` immer da, auch leer), sonst `/1` byteweise wie bisher
   (AK3 auf Dateiebene); der Kern liest beide. Neue Server-Gründe: `routing_zyklus`, `routing_grenze`, `ziel_unbekannt`,
   `gruppe_unbekannt` (`djk/oberflaeche/http/gruende.ts:73`); der Kern lehnt eine zyklische oder verschachtelte Wiedergabe mit dem
   vorhandenen Grund `format` ab.
6. **Lampe SET LIMITER über `/zustand/arr` Feld `limiter_db`.** Der Kern liest die Absenkung des Set-Limiters nach jedem Mischer-Block
   und hält die größte 0,5 s (24 000 Samples, `kern.h:464`) nach dem letzten Eingriff über 0,1 dB (`kern_arr.cpp:313`); das Feld
   (float, ≤ 0, `,iiidhdif`) geht bei jedem Wechsel der Lampe sofort hinaus, weil der Server `/zustand/arr` auf 50 ms drosselt und
   ein kurzer Eingriff sonst verloren ginge. Die Seite zeigt "SET LIMITER", wenn der Wert unter −0,1 liegt
   (`djk/oberflaeche/oeffentlich/produktion/transport.js:27`); die Export-Zeile warnt bei `ueber_decke`.
7. **Regler-Haushalt: 597 von 1024, Reserve 427; der Gesamtbedarf von Slice 1 bis 8 ist 897, Reserve 127.** Gemessen an einer Kopie
   der Tabelle (Spec 5.3: Gruppen, PM, 32 mal 4 Sends, 4 Returns zu 11, 12 Inserts zu 8). Die Reserve liegt über 100, deshalb
   entfiel das Heben auf 2048 samt Zustandsversion 3. Fehlerfall der Messung: derselbe Zähler mit `MAX_REGLER 800` bricht ab
   (`ReglerTabelle: mehr als 800 Regler`). 1.11 und 1.12 entscheiden mit eigener Messung.

## Folgen

- **Rollout:** Kern und `cypherdj-render` müssen zusammen neu gebaut und gestartet werden. Ein älteres Render-Programm lehnt
  Regler-Dateien mit `grp/` und `--abgriff` ab; der Server erkennt das (P11) und antwortet `render_fehler`. Ein neuer Server mit
  altem Kern lädt die Wiedergabe nicht (`/zustand/arr` hat ein Feld weniger, Ursache ungeprüft).
- **Neustart-Zustand:** unverändert gültig. Er speichert nur Regler abseits der Vorgabe nach Pfad
  (`djk/kern/src/kern_zustand.cpp:125`), neue Regler am Tabellenende brauchen keine Zustandsversion.
- **Offene Flanke N8:** Der Export liest das Zustand-Fach des Kerns. Ein Export unmittelbar nach einer Regleränderung kann einen
  Zwischenwert fahren (gemessen: Wartezeit 0, 2 von 7 Exporten falsch; 1500 ms, 0 von 7). Die Abnahmeskripte warten 1000 ms vor jedem
  Export. Behoben ist es nicht; Cypher, die Regler ändert und gleich `proj_export` schickt, bekommt bis dahin ein falsches Ergebnis.
- **Ehrlichkeit statt Glätte:** "Gerendert = gehört" gilt für den Produktions-Export nur im Betrag (N7) und nur, solange der
  Set-Limiter nicht eingreift; greift er ein, leuchtet die Lampe und die WAV ist die ungebremste.
- **AK18 in der vollen Form fehlt:** der Produktions-Export bei heißem Material gegen eine Echtzeit-Referenz am JACK-getriebenen
  Kern ist erst mit `/k/arr/abgriff` (Slice 7) messbar; in Slice 2 tragen der Kern-Test (derselbe `Kern::audio`-Pfad, ohne JACK)
  und der Null-Test des Set-Exports.
- **Hörbar und Andreas' Sache:** P14 (Balance), P7 (Solo-Semantik mit Gruppen), P8 (lineare Blende statt S-Kurve).
- **Nicht in diesen Slices:** Returns und Sends, Pre/Post und Komp-Insert, Sidechain, Matrix, Resampling (Slice 3 bis 8);
  Gruppen im Zeitleisten-Layout (Einzug, Falten, Slice 6): die Köpfe von Gruppen und PM stehen in einem eigenen Mischer-Block unter
  dem Arrangement (P1).

## Verworfen

- **Den Ring auf mehr Kanäle erweitern** (`djk/kern/include/cypherdj/ring.h:13`, `:55`): `cdj_ring_gueltig` verlangt von jedem
  Leser die Kanalzahl 4, eine Erweiterung bräche jeden Leser (wer alles liest, ist ungeprüft); ein Abgriff im Modul braucht keinen
  Eingriff in den Ring-Vertrag.
- **Ein Limiter-Schalter im Master-Pfad** (Limiter nur für den Render umgehen): der Export enthielte weiter Kleber, `master/pegel`,
  `erz/4`-Fader und Crossfader-Gewicht, und ein Schalter im Master-Pfad ist ein Eingriff in den Live-Pfad.
- **Der PM an einen eigenen JACK-Ausgang** statt in `erz/4` (Spec Abschnitt 4): spätere Option (Booth, Individual Outs), ändert die
  Antwort auf die Export-Frage nicht und macht das Hören ohne Set-Limiter möglich, was der Saal-Schutz nicht will.
- **`/k/arr/abgriff` als OSC-Befehl in Slice 2** (P6): ein Befehl ohne Aufrufer im Server wäre totes Vertragsgewicht; er kommt mit
  Slice 7 (Resampling), wo der Server sein erster Kunde wird.
- **Wiedergabe `/2` immer** (Spec 5.2): neutrale Projekte schreiben weiter `/1`, damit AK3 auf Dateiebene trivial gilt und alle
  bestehenden Wiedergabe-Tests unverändert bleiben (P2).
- **Das Spur-Gesetz (−3 dB in der Mitte) für Gruppen** (Spec AK5): siehe Entscheidung 3.
