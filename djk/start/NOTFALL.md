# Notfall-Karte djk

Start `~/cypher-dj/djk/start/djk-start` · Zustand `djk-start --zustand` · Stopp `djk-stop`. Der Ton gehört dem Kern;
Seite und Leitstand dürfen hängen, ohne dass es still wird. **Faustregel: erst hören, dann `--zustand`, dann handeln.**

**Prüfmodus ist bis Scheibe 35 die Vorgabe.** `djk-start` startet den Kern mit `--pruefmodus`, weil die Hand der Seite
(Fader, Tasten) bis `hand_osc` nur als `/test/hand` ankommt; der Start sagt das an (`test mode ON`), `--zustand` zeigt
es in der Zeile `kern`. Mit `--ohne-pruefmodus` startet er ohne, dann greifen die Regler der Seite **nicht**. MVP.md
sagt für den Betrieb: nicht der Prüfmodus; mit `hand_osc` wird die Vorgabe umgedreht und dieser Absatz fällt.

## 1. Stille

1. `djk-start --zustand` lesen. Zeile `output`: steht dort `cypher_stumm`, ist das die Vorgabe: **es war nie laut.**
   Neu starten mit dem echten Ausgang: erst `djk-ausgang` (liest nur; hängen **fremde** Clients an der Senke, Rückgabe 4,
   kein `--ton-frei`), dann `djk-stop`, dann `djk-start --master <senke>:playback_F --ohne-cue --ton-frei`.
   `<senke>` ist der `node.name` aus `pw-link -i` (ohne `:playback_FL`) **oder** die Beschreibung des Geräts; `djk-start`
   löst beides auf. **Portnamen-Falle:** `pw-link` kennt nur den `node.name`, der Kern läuft unter `pw-jack` und braucht
   die Beschreibung. `djk-start` gibt dem Kern deshalb selbst die Beschreibung (`--zustand`, Zeile `names under pw-jack`);
   den Kern nie von Hand mit dem `node.name` starten (gemessen an einer Test-Senke: „Verbinden … gescheitert“, Start
   abgebrochen). Cue bei echtem Master: `--ohne-cue`; ein Cue an der stummen Senke wird abgewiesen, Pro-Audio-Ports
   (`playback_AUX0…`) kann der Kern nicht anschließen. `djk-stop --alles` beendet zusätzlich Cue-Server und Vorhörer
   der Instanz (`--trocken` listet nur).
2. Alle vier `active`, `restarts` beim Kern steigt nicht? Dann liegt es am Mix: Kanalfader, Crossfader-Seite, Gain,
   EQ-Kill, Filter ganz links/rechts, Master. Auf der Seite prüfen, ob das Deck läuft (Takt bewegt sich).
3. `pw-link -l | grep -A2 cypherdj-kern:master_L` muss auf den Ausgang zeigen. Fehlt die Verbindung: `djk-stop`,
   `djk-start` neu (verbindet selbst, nie von Hand verkabeln).
4. Dauert es länger als ein Stück: **Rückweg auf den XZ (4.)**, danach suchen.

## 2. Neustart-Schleife

Kennzeichen: `restarts` beim Kern zählt hoch, Ton stottert oder fehlt. Der Kern startet ohne Pause neu (RestartSec=0,
kein Startlimit, gemessen bis 1659 Neustarts in 5 s), eine Schleife hört nicht von allein auf.

1. **Sofort `djk-stop`.** Das beendet die Schleife und räumt alles ab.
2. Ursache lesen: `journalctl --user -u cypherdj-kern -n 40 -o cat`. Häufig: PipeWire weg (`pw-link -o` schlägt fehl),
   Startfehler Rückgabe 2 (Konfiguration, `~/.config/cypherdj/kern.toml`), Ausgang verschwunden (Interface abgezogen).
3. Ist die Ursache behoben, einmal `djk-start`. Schleift es wieder: nicht ein drittes Mal, **Rückweg auf den XZ.**

## 3. Seite hängt

Der Ton läuft weiter, die Seite ist nur Anzeige und Hand. Nicht den Kern neu starten.

1. Im Browser neu laden (F5), Adresse aus `--zustand` (`open`, Vorgabe `http://127.0.0.1:47300/`).
2. Hilft das nicht: `systemctl --user restart cypherdj-oberflaeche`, danach neu laden.
3. Takt oder Ansagen fehlen, Regler gehen aber: `systemctl --user restart cypherdj-leitstand`.
4. Regler greifen von Anfang an nicht: `--zustand`, Zeile `kern`. Steht dort `without test mode`, lief der Start mit
   `--ohne-pruefmodus`; Stück auslaufen lassen, `djk-stop`, `djk-start` ohne diesen Schalter.
5. Regler greifen gar nicht mehr und der Kern ist `active`: Crossfader und Fader bleiben, wo sie sind. Stück
   auslaufen lassen, dann `djk-stop` und `djk-start`, oder Rückweg auf den XZ.

## 4. Rückweg auf den XDJ-XZ mit USB-Stick

Vorher bereit legen: ein Stick mit den Stücken als Dateien in Ordnern, Dateisystem **FAT32 oder HFS+** (exFAT und
NTFS liest der XZ nicht; Handbuch S. 6). Annahme, noch nicht mit Andreas geklärt: der XZ hängt mit MASTER OUT an
den Lautsprechern und läuft schon, während djk spielt.

1. Am Rechner leise machen: Master oder Crossfader auf der Seite runter, dann `djk-stop`.
2. Am XZ: Abdeckung von **[USB 1]** oder **[USB 2]** öffnen, Stick einstecken (Handbuch S. 111).
3. Taste **[USB 1]**/**[USB 2]** drücken, mit dem Drehregler den Ordner öffnen (drücken), **[BACK]** eine Ebene hoch.
4. Stück wählen, **[LOAD 1]** oder **[LOAD 2]**, dann **PLAY/PAUSE** (Handbuch S. 112 f.).
5. Stick erst abziehen, nachdem **[USB STOP]** 2 s gedrückt war und die USB-Anzeige aus ist (S. 112).

Zurück auf djk später: XZ-Kanal runter, `djk-start` mit denselben Parametern wie vorher, `--zustand` prüfen.
