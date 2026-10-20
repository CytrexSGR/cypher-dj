// D1 S2-Integration, Fix-Runde B3 (Spec 6.25, 6.30): ProjZugang.naechsteNummer() gibt die nächste Nummer des EINEN Wiedergabe-Zählers der
// Instanz. S3 nimmt sie als Freeze-Kennung; derselbe Zähler vergibt die Wiedergabe-Nummern (6.1) und steht in der Zustandsdatei (A4), eine
// Kennung kommt also nie zweimal und nie gleich einer Wiedergabe-Nummer.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { pruefKontext } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

function bereich(t, d) {
  const b = projBereich(pruefKontext(), { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  return b;
}

test('B3 naechsteNummer: Kennung und folgende Wiedergabe-Nummer verschieden und steigend, auch über einen Server-Neustart', async (t) => {
  const d = tmpOrdner(t, 'djk-b3-');
  const b = bereich(t, d), s = b.sitzung;
  const n = await s.neu('K', 'andreas');
  const w0 = n.j.kern.wiedergabe.nr;
  const kennung = b.zugang.naechsteNummer();
  const r = await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  const w1 = r.j.kern.wiedergabe.nr;
  const k2 = b.zugang.naechsteNummer();
  const w2 = b.zugang.schreibeWiedergabe(s.aktuell().j.projekt).nr;
  assert.deepEqual([w0 < kennung, kennung < w1, w1 < k2, k2 < w2], [true, true, true, true], JSON.stringify({ w0, kennung, w1, k2, w2 }));
  s.schliesse();
  const neu = bereich(t, d);                                                     // Server-Neustart auf denselben Ordnern
  const k3 = neu.zugang.naechsteNummer();
  assert.ok(k3 > w2, `nach dem Neustart ${k3} > ${w2}`);
});

test('B3 Negativ-Kontrolle: ohne naechsteNummer folgen die Wiedergabe-Nummern lückenlos aufeinander', async (t) => {
  const b = bereich(t, tmpOrdner(t, 'djk-b3n-')), s = b.sitzung;
  const n = await s.neu('K', 'andreas');
  const r = await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  assert.equal(r.j.kern.wiedergabe.nr, n.j.kern.wiedergabe.nr + 1);
});
