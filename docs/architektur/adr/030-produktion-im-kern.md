# ADR 030: Produktion im Kern (Arrangement, Spur-Mixer, Instrumente, Offline-Export)

Status: angenommen 2026-10-15 (Cypher, Architektur-Auftrag von Andreas). Umsetzung: Durchstich D1, Pakete S1 bis S3, K1 bis K3, V1, V2.
Volltext der Entscheidungen und Schnittstellen: `docs/masterplan/D1-SPEC.md`, Abschnitt 2 und 3.

## Kontext

cypher-dj soll Produktionsumgebung werden (Masterplan Welle 1). Der Kern kennt Decks, Loop-Boxen, Erzeuger und einen
DJ-Mixer mit 18 festen Kanälen, aber keinen Transport, keine Spuren, kein Pan/Mute/Solo und keinen Export. Die
Erhebung vom 15.10. (u1 bis u6) und die adversariale Prüfung der Spec (2 BLOCKER, 20 MAJOR) sind die Grundlage.

## Entscheidung

1. Der Seiten-Server besitzt das Projekt (Ordner mit `project.json`, `undo.jsonl`); der Kern spielt eine Wiedergabe,
   die er über einen eigenen Lade-Faden lädt und per Zeigerübergabe tauscht.
2. Neues Kern-Modul `Arrangement` mit eigenem Transport auf der einen Uhr, ohne `/k/set/neu`, ohne JACK-Transport.
3. Eigener Spur-Mixer im Modul (8 Spuren, Regler-Rollen an Kanal −1); die Summe geht auf den für die Produktion
   reservierten Kanal `erz/4`. Der DJ-Mixer bleibt unverändert.
4. RB-338 läuft als FFI im Kern; fremde Instrumente im Carla-Wirt an eigenen Slots mit Vorhalt.
5. Export als Offline-Render desselben Kerns (`cypherdj-render`) mit dem Regler-Stand des laufenden Kerns;
   Wirt-Spuren werden vorher in Echtzeit eingefroren. JACK-Freewheel verworfen für D1.
6. Kein OSC-Feld trägt einen Pfad; Dateien liegen im Arbeitsordner je Instanz.

## Folgen

Die Produktion greift nicht in den DJ-Pfad ein, solange erz/4 neutral ist. Produktions-Kanalzüge (Inserts, Sends,
Gruppen) wachsen im Modul, nicht im DJ-Mixer. Mehr als 8 Spuren, Automation und Warp brauchen spätere Pakete.
Projekt-Takt gleich DJ-Takt nur bei Takt-Quantisierung.
