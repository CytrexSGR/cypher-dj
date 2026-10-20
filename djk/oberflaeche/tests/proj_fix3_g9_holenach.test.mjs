// D1 S2-Integration, dritte Fix-Runde G9: holeNach löscht o.merk.laden erst nach dem gelungenen Laden. Vorher wurde das Flag vor dem Laden
// gelöscht; warf das Laden (kein Kern, Netz), war das gemerkte Laden verloren, und der Kern spielte bis zur nächsten Änderung den alten Stand.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
function aufbau(t) {
  const z = { halte: false, wirf: false, wartend: [] };
  const k = pruefKontext({ quittung: (adr) => {
    if (adr === '/k/arr/laden' && z.wirf) throw new Error('Netz weg');
    return adr === '/k/teil' && z.halte ? new Promise((ok) => z.wartend.push(() => ok({ status: 3, grund: '' }))) : { status: 3, grund: '' };
  } });
  const d = tmpOrdner(t, 'djk-g9-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  return { k, b, s: b.sitzung, z };
}
const n = (e, a) => e.k.an(a).length;

for (const wirft of [true, false]) {
  test(`G9 holeNach mit ${wirft ? 'werfendem' : 'gelingendem'} Laden: das Flag bleibt bis zum gelungenen Laden, die nächste Freigabe versucht es erneut`, async (t) => {
    const e = aufbau(t);
    await e.s.neu('R', 'andreas');
    e.z.halte = true; e.k.leere();
    const p = e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
    for (let i = 0; i < 200 && e.z.wartend.length === 0; i++) await schlaf(5);
    const frei = e.b.zugang.sperreLaden();
    e.z.halte = false; for (const f of e.z.wartend.splice(0)) f();
    assert.deepEqual((await p).j.kern.wiedergabe, { nr: null, aufgeschoben: true });
    e.z.wirf = wirft;
    frei();                                                                   // holeNach: Laden wirft (oder gelingt)
    assert.ok(await warteBis(() => n(e, '/k/arr/laden') > 0, 1000));
    await schlaf(30);
    const erst = { laden: n(e, '/k/arr/laden'), merk: e.s.offen.merk.laden, fehler: e.k.protokoll.filter((z) => z.typ === 'proj_nachladen_fehler').length };
    e.z.wirf = false;
    e.b.zugang.sperreLaden()();                                               // nächste Freigabe (z. B. nach dem nächsten Freeze)
    await schlaf(60);
    const dann = { laden: n(e, '/k/arr/laden'), merk: e.s.offen.merk.laden };
    const geladen = e.k.an('/k/arr/laden').at(-1).felder.nr;
    console.log(`G9 ${JSON.stringify({ wirft, erst, dann, geladen, wiedergabe_rev: e.s.aktuell().j.projekt.wiedergabe_rev })}`);
    if (wirft) {
      assert.deepEqual(erst, { laden: 1, merk: true, fehler: 1 }, 'Laden versucht und geworfen, das Flag bleibt');
      assert.deepEqual(dann, { laden: 2, merk: false }, 'die nächste Freigabe lädt erneut, danach ist das Flag weg');
    } else {
      assert.deepEqual(erst, { laden: 1, merk: false, fehler: 0 }, 'Negativ-Kontrolle: gelingt das Laden, ist das Flag weg');
      assert.deepEqual(dann, { laden: 1, merk: false }, 'und die nächste Freigabe lädt nicht noch einmal');
    }
    assert.equal(geladen, e.s.aktuell().j.projekt.wiedergabe_rev, 'zuletzt geladen ist die Wiedergabe, die das Projekt führt');
  });
}
