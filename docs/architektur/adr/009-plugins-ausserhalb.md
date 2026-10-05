# ADR 009: Plugins außerhalb des Kerns

- **Status:** vorläufig, Messung M7 (Wirt-Entkopplung per `node.async`) steht aus; Plugins frühestens Scheibe 8
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A18, A17, A21, A23
- **Hängt zusammen mit:** ADR 001, 010, 016

## Kontext

A18 will Plugins als Schnittstelle zu Instrumenten und Effekten. 05 §1 empfiehlt Deck-Effekte als CLAP/LV2 **im**
Kern; 10 §5 lässt Fremdcode nur parallel auf Sends; 10 NP K5 sagt, das widerspricht A18/A21, und schlägt
entkoppelte Rückwege vor. Die Entwürfe „KI“ und „Spiel“ erlauben später geprüfte CLAP/LV2 im Kern, „Robustheit“
nie; die Richter 1 und 2 empfehlen „kein Fremdcode im Kern, bis eine geprüfte Liste den Chaos-Prüfstand besteht“.

## Entscheidung

1. **Kein `dlopen` im Kern.** Deck-Effekte sind eigener Code (Faust-generiert oder C++); geprüfter Quelltext unter
   freier Lizenz, der statisch einkompiliert wird (etwa ein Airwindows-Effekt, MIT), gilt als eigener Code.
2. **Plugin-Wirte** je Gruppe als eigene Units `cypherdj-wirt@<gruppe>`: Carla 2.5.8 als Bibliothek (C-API), eigenes
   `HOME` und `XDG_*`, eigenes Xvfb-Display, Carlas OSC aus, Steuerung über einen Unix-Socket nur lokal; Rückwege als
   eigener JACK-Client mit **`node.async = true`** und einem **Puls-Port** als Lebenszeichen.
3. **Takt kommt aus dem Kern:** Noten und Parameter auf den Schlag nur als JACK-MIDI mit Sample-Versatz (CC per
   `set_parameter_mapped_control_index`); OSC nie für Zeitkritisches.
4. **Latenz je Slot** beim Laden per Klick durchgemessen und nach dem ersten Block erneut gelesen; der Kern hält
   Ereignisse um die Latenz des Rückwegs plus einen Block (async) vor.
5. Erlaubt: Instrument, Send-Effekt, und als **ausfallsicherer Insert** (der Kern hält den trockenen Weg zeitgleich
   bereit und blendet bei stehendem Puls zurück, Vermutung, M7). Nie in Reihe vor dem Master.
6. Eine Liste geprüfter Plugins im Kern ist ein späteres ADR, frühestens wenn sie den Chaos-Prüfstand besteht.
7. NI-Plugins über yabridge nur auf Andreas' Wunsch je Instrument (05 Frage 1); ohne Oberfläche.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| CLAP/LV2 im Kern | ein Adressraum: ein Plugin-Absturz nimmt die ganze Musik mit; Hänger im Carla-Prozess hielt über 6 s keinen Zyklus | 01 §6.1, 05 §4.5 |
| Carla-Brücke je Plugin | isoliert den Prozess, nicht den Takt: ganzer Graph 1 024 ms still (fest verdrahtete Wartezeit) | 05 §4.5, `CarlaPluginBridge.cpp` Z. 2000 |
| Plugin-Wirt synchron am Graphen | ein hängender Knoten in Reihe hält alles dahinter an | 10 Probe c (Kanten-Notbahn 181 bis 213 ms Stille) |
| nur parallel direkt an die Senke | umgeht Mixer, Limiter und Notbahn; widerspricht A21 | 10 NP K5 |
| PipeWire filter-chain | meldet Latenz nicht (ProcessLatency 0 bei 480 Samples Verzögerung), kein Ereignisweg | 05 §3.1 |
| OSC an Carla für Parameter | 1,67 bis 37,58 ms Streuung; Carlas OSC lauscht auf 0.0.0.0 | 05 §4.4, §4.1 |

## Folgen

- Jeder Wirt-Rückweg kostet einen Block Latenz (async), ausgeglichen durch Vorhalt der Ereignisse.
- Send-Effekte aus Wirten kommen über `fx/3` und `fx/4` zurück (Sends 3 und 4 je Kanal, `SCHNITTSTELLEN.md` §1.5);
  der Mixer ist eine Zuweisungstabelle, damit Wirt-Rückwege ohne Umbau dazukommen (A17).
- Offen und entscheidend: was ein toter oder hängender async-Vorgänger liefert (alten Block oder Stille), und der
  Widerspruch 05 §4.5 (Hänger im Prozess friert den Treiberkreis) gegen 10 NP N3 (paralleler Hänger hält ihn nicht).
  Fällt M7 schlecht aus, bleiben Plugins aus dem Mix, bis Carla mit kurzer Brücken-Wartezeit gebaut ist.
- Plugins schreiben in fremde Ordner (Dexed 34 Dateien, Surge Ordner, 05 §4.3): eigenes `HOME` ist Pflicht.

## Beleg

05 §3.1, §4.1, §4.2 (gemeldet 480/64/240 = gemessen, aber nicht weitergereicht; x42 ohne Atom-Ports rechnet gar
nicht), §4.4 (MIDI-CC 0 bis 3 Samples, 28 von 28), §4.5; 10 NP N9 (`node.async`: Hänger 0 ms Stille in 4 von 4,
Latenz genau ein Block), K5, N3; Bitwig-Handbuch „Individually“ (10 §3b). Dossier 05 ungeprüft.

## Kippt, wenn

M7 zeigt, dass ein hängender Wirt trotz `node.async` den Treiber anhält (dann keine Plugins im Set bis zu einem
Carla-Neubau) oder dass der Puls den toten Rückweg nicht zuverlässig erkennt.
