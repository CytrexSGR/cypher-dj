# ADR 025: Loop-Boxen im Kern (MVP 2)

Status: angenommen 2026-09-27 (Cypher; Andreas: „mein nächstes mvp ist damit … 2 loop decks … wav extrakt aus einer
laufenden strudel loop … jede loop box braucht beatsynchrone filter“, FX-Vorschlag „ja“).

## Kontext

Das gemeinsame Spiel lebt in Strudel (ADR 024). Andreas will davon Loops abgreifen, in zwei Boxen legen, einblenden,
vorhören und mit Beat-FX bearbeiten. Scheibe 38 (Deck-Grammatik mit Loop) braucht Stretcher und Lader und ist groß.

## Entscheidung

Zwei Loop-Boxen im Kern auf `pad/1` und `pad/2`. Ein Loop ist genau N Takte bei 128 BPM (N = 1, 2, 4, 8); die Box
spielt ihn phasenstarr zur Kern-Uhr (Position = Beat mod 4·N), Start und Stopp auf der nächsten Takt-Eins. Das Netz
lädt Loops und legt Mitschnitt-Puffer an; der Kern tauscht Zeiger und gibt sie als Ereignis zur Freigabe zurück
(Muster `/k/mapping`, ADR 024). Beat-FX sitzen in der Box vor dem Kanalzug und haben eigene Befehle.

## Folgen

- Kein Stretcher, kein Keylock: Loops schweigen bei Tempo ≠ 128.
- Der Mitschnitt greift `erz/1` vor Trim ab und beginnt auf einem Vielfachen seiner Länge.
- Der DSP-Kanalzug (Naht, Scheibe 04) bleibt unberührt; `pad/*` sind keine Einzelschuss-Kanäle mehr, solange der
  Erzeuger sie nicht als Ziel wählt.

## Verworfen

| Weg | Warum nicht | Beleg |
|---|---|---|
| Loops auf Deck 3 und 4 (Deck-Engine, Scheibe 38) | Stretcher, Lader, Grammatik: groß; für Loops auf Set-Tempo unnötig | ROADMAP 38 |
| Beat-FX als §1.5-Regler im Kanalzug | Naht des Kanalzugs festgeschrieben; Regler zögen durch Tabelle, Attrappe, Leitstand, Seiten-Kurven | `kanalzug.h` Kopf, Spec Entscheidung 8 |
