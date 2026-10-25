// I08 Task 9: Kanten-Text für den Kern (eingaenge-kanten). Zeile QUELLE<TAB>PORT, Mono auf beide Seiten, nichts zugeordnet = leere Datei.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baueKantenText, schreibeAtomar } from '../bereiche/geraete/kanten.ts';
import { standard } from '../bereiche/geraete/speicher.ts';

test('Kanten-Text: zwei Ports -> L und R; ein Port -> beide Seiten; MIDI -> midi_ein_1; leer -> leer', () => {
  assert.equal(baueKantenText(standard()), '');
  {  // Gesamtreview B1: die Datei trägt die Ports so, wie sie die Erkennung liefert (node.description-Form), Leerzeichen und Schrägstrich bleiben heil
    const g = standard();
    g.eingaenge[0].audio = { knoten: 'alsa_input.pci-0000_16_00.6.analog-stereo', ports: ['Family 17h/19h HD Audio Controller Analoges Stereo:capture_FL', 'Family 17h/19h HD Audio Controller Analoges Stereo:capture_FR'] };
    assert.equal(baueKantenText(g), 'Family 17h/19h HD Audio Controller Analoges Stereo:capture_FL\tein_1_L\nFamily 17h/19h HD Audio Controller Analoges Stereo:capture_FR\tein_1_R\n');
  }
  const k = standard();
  k.eingaenge[0].audio = { knoten: 'a', ports: ['a:FL', 'a:FR'] };
  k.eingaenge[2].audio = { knoten: 's', ports: ['s:MONO'] };
  k.midi.port = 'Midi-Bridge:XDJ-XZ (1): XDJ-XZ MIDI 1';
  assert.equal(baueKantenText(k), 'a:FL\tein_1_L\na:FR\tein_1_R\ns:MONO\tein_3_L\ns:MONO\tein_3_R\nMidi-Bridge:XDJ-XZ (1): XDJ-XZ MIDI 1\tmidi_ein_1\n');
});

test('schreibeAtomar: Inhalt da, keine .teil-Reste, zweites Schreiben ersetzt', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-gk-'));
  const p = path.join(d, 'x', 'eingaenge-kanten');
  schreibeAtomar(p, 'eins\n');
  schreibeAtomar(p, 'zwei\n');
  assert.equal(fs.readFileSync(p, 'utf8'), 'zwei\n');
  assert.deepEqual(fs.readdirSync(path.dirname(p)), ['eingaenge-kanten']);
  fs.rmSync(d, { recursive: true, force: true });
});
