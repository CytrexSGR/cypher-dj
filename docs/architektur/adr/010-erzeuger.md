# ADR 010: Erzeuger (Strudel-Muster, Spielzettel, SunVox, MIDI)

- **Status:** vorläufig, Messung M7 (Klang-Wirt als `node.async`) steht aus; Scheibe 7
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A21, A22, A14, A4, A1
- **Hängt zusammen mit:** ADR 017, 009, 005

## Kontext

A21: Instrumente und Erzeuger sind gleichrangig im selben Takt wie die Decks, nicht an einen DJ-Mixer angeflanscht.
A22: Strudel bleibt für Muster zu Ereignissen. 06 schlägt SunVox als Klangerzeuger **im** Kern vor (sample-genau
nur mit Blockteilung); „Robustheit“ und die Richter 1 und 2 wollen keinen Fremdcode im Kern.

## Entscheidung

1. **Erzeuger liefern nur Ereignisse mit Beat-Stempel.** Der Strudel-Kern läuft als eigene Unit
   `cypherdj-erzeuger@strudel` (Node, `@strudel/core`/`mini` 1.2.6, nur `queryArc`), wacht je Takt auf und schickt
   ein Fenster `[n+1, n+3)` als „ersetzen“ direkt an den Kern (`/erz/fenster`, `/erz/ev`). Vergangenes wird nie
   angefasst; zu spät Eingetroffenes zählt der Kern als `zu_spaet` und spielt es nicht.
2. **Musterwechsel** auf der Rastergrenze: der Erzeuger schickt sofort ein Fenster `[q, Horizont)` mit dem neuen
   Muster; Vorgabe-Raster ist der nächste Takt.
3. **Spielzettel** (Tracker-Zeilen für Zeit, Sprung und Übergang, Mini-Notation für Inhalt) ist der gemeinsame Text
   von Andreas und Cypher; Fehler kommen mit Zeilennummer. KI-Mustertext läuft in einem Worker ohne Datei- und
   Netzrechte. Übergänge im Spielzettel (`uebergang A->B basstausch 16T`) gehen an den Leitstand und werden dort wie
   eine Wahl expandiert (ADR 013).
4. **SunVox im eigenen Klang-Wirt** `cypherdj-klang@sunvox` (C++ um `sunvox.so` 2.1.4d): Ereignisse per JACK-MIDI
   mit Sample-Versatz aus dem Kern, der Wirt teilt seinen Block an der Ereignisstelle, Rückweg `node.async` mit
   Puls; der Kern stempelt die Ereignisse um die Rückweg-Latenz früher. SunVox' eigener Sequencer wird nicht
   benutzt (Tempo nur in ganzen BPM).
5. **Jeder Erzeuger ist ein voller Kanal im Kern** (Kanalzug wie ein Deck), sein Fader startet bei −200 dB und
   geht nur mit Hörschein auf (A4 für Erzeuger, 09 NP K10). **Auch ein Musterwechsel ist neuer Inhalt:** auf einem
   offenen Kanal spielt der Kern Ereignisse eines Musters nur mit gültigem Hörschein `muster/<m>` dieses Kanals, sonst
   zählt er sie als `ungehoert` (I3c, `SCHNITTSTELLEN.md` §4.8). Ein neues Muster klingt darum zuerst auf einem
   geschlossenen Erzeuger-Kanal und kommt dann per Plan hinein, wie ein neuer Track; `/erz/strom` nennt dafür den
   Kern-Kanal, auf dem der Klang zurückkommt.
6. **MIDI an Geräte** nur als Ausgang des Kerns (JACK-MIDI mit Sample-Versatz), nie direkt aus Node.
7. Renoise nein.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Strudels Cyclist als Scheduler | 0,1 s Latenz, `setPattern` ersetzt sofort ohne Raster; Anhängen statt Ersetzen: Wechsel erst nach 4,4 s | 06 §3.1, Probe a Strom 2 |
| Sekunden-Stempel | in der Tempo-Rampe bis 12,8 ms daneben | 06 Probe a Strom 3 |
| SunVox im Kern | fremde Binärbibliothek im Echtzeit-Prozess; Genauigkeit bleibt auch außerhalb über JACK-MIDI mit Versatz und Blockteilung | 06 Probe b (T2 60 von 60), 02 k_midi1 (0 Frames), 05 §4.5 |
| SunVox als Taktgeber | Tempo nur in ganzen BPM (`uint16_t bpm`) | 06 §3.1 |
| MIDI direkt aus Node | ohne Stempel median 12 ms, bis 29 ms daneben | 06 Probe a Strom 4 |
| Renoise als Erzeuger | braucht X.org, Tools nicht in Echtzeit, proprietär | 06 §3.1, Recherche Tracker |

## Folgen

- Vorlauf mindestens ein Takt (1,875 s bei 128), deckt Node-Hänger bis zum Horizont (gemessen 4,7 s), danach Stille
  statt Schwall.
- Wechsel-Bundles doppelt schicken oder Quittung abwarten (Verlust eines Wechsels verschiebt ihn um bis zu einen
  Takt, Vermutung 06 Risiko 3).
- Strudel ist AGPL: unverändert als eigener Prozess, kein Fork weitergeben.

## Beleg

06 Probe a (295 von 295 frame-genau, auch in der Rampe; jedes dritte Paket verloren: nichts fehlt; Wechsel auf dem
Takt nach 0,61 s; Node 6 s lahm: bis Horizont exakt, danach 2,8 Beats Stille), Probe b (SunVox mit Teilung 60 von 60,
ohne bis 15,9 ms), Probe c (Spielzettel 64 Takte in 17,5 ms, Fehler mit Zeilennummer), Risiko 1 bis 7. Dossier 06
ungeprüft.

## Kippt, wenn

M7 zeigt, dass ein hängender Klang-Wirt trotz `node.async` den Kern mitreißt; dann SunVox erst nach eigener
Prüfung oder gar nicht.
