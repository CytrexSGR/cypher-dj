// D1 S2-Integration, dritte Fix-Runde G2 (Spec 6.32): uebernimm (S3) prüft die Freeze-Sperre unmittelbar vor Laden und Loop wie holeNach
// (gesperrt: am Offen merken, die Freigabe holt es nach). Vorher lud uebernimm ohne Prüfung: Freeze 1 fertig, uebernimm stellt sich hinter eine
// belegte Kette, Freigabe 1, Freeze 2 sperrt, dann läuft uebernimm und lädt unter Sperre 2 (Spec-Re-Review W2: laden_unter_sperre2 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { aendere } from '../projekt/verlauf.ts';
import { pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

function aufbau(t) {
  const halte = new Set(); const wartend = [];
  const k = pruefKontext({ quittung: (adr) => (halte.has(adr)
    ? new Promise((ok) => wartend.push(() => ok({ status: 3, grund: '' }))) : { status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-g2-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const loese = () => { halte.clear(); for (const f of wartend.splice(0)) f(); };
  return { k, b, s: b.sitzung, d, halte, wartend, loese };
}
const n = (e, a) => e.k.an(a).length;
async function mitClip(e) {
  await e.s.neu('Eins', 'andreas');
  await e.s.aendern({ rev: 0, label: 'A', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  await e.s.aendern({ rev: 1, label: 'C', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4 }] }, 'andreas');
}
// Was S3 tut: aendere() mit dem Haken des Zugangs, dann uebernimm()
function s3Wirkung(e, befehle) {
  const z = e.b.zugang.offen();
  const w = aendere(z.verlauf, z.projekt, befehle, { quelle: 'andreas', label: 'S3' }, e.b.zugang.haken());
  return { w, u: () => e.b.zugang.uebernimm(w, { quelle: 'andreas', label: 'S3' }) };
}

for (const zweite of [true, false]) {
  test(`G2/W2 uebernimm hinter belegter Kette, dann zweite Sperre (zweite=${zweite}): unter Sperre 2 kein Laden, nach Freigabe 2 genau 1x`, async (t) => {
    const e = aufbau(t);
    await mitClip(e);
    const frei1 = e.b.zugang.sperreLaden();                                      // Freeze 1
    e.halte.add('/k/teil');
    const p = e.s.aendern({ rev: 2, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }] }, 'andreas');
    assert.ok(await warteBis(() => e.wartend.length > 0, 1000), 'Kette belegt');
    const clip = e.b.zugang.offen().projekt.spuren[0].clips[0].id;
    const { w, u } = s3Wirkung(e, [{ befehl: 'noten_neu', clip_id: clip, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] }]);
    assert.equal(w.betrifft_wiedergabe, true);
    const fertig = u();
    e.k.leere();
    frei1();
    const frei2 = zweite ? e.b.zugang.sperreLaden() : () => {};                  // Freeze 2
    e.loese();
    await p.catch(() => {}); await fertig;
    await schlaf(30);
    const unter = n(e, '/k/arr/laden'), merk = e.s.offen?.merk?.laden;
    frei2();
    await warteBis(() => n(e, '/k/arr/laden') > unter, 500);
    await schlaf(30);
    const m = { zweite, laden_unter_sperre2: unter, merk_laden: merk, laden_nach: n(e, '/k/arr/laden') };
    console.log(`G2 W2 ${JSON.stringify(m)}`);
    if (zweite) {
      assert.equal(unter, 0, 'kein /k/arr/laden während Sperre 2');
      assert.equal(merk, true, 'das Laden ist am Offen gemerkt');
    } else assert.equal(unter, 1, 'Negativ-Kontrolle: ohne Sperre lädt uebernimm genau einmal');
    assert.equal(m.laden_nach, 1, 'insgesamt genau ein Laden');
  });
}

for (const gesperrt of [true, false]) {
  test(`G2 uebernimm mit Loop-Änderung (gesperrt=${gesperrt}): unter Sperre weder Laden noch Loop, nach der Freigabe je 1x`, async (t) => {
    const e = aufbau(t);
    await mitClip(e);
    const frei = gesperrt ? e.b.zugang.sperreLaden() : () => {};
    const clip = e.b.zugang.offen().projekt.spuren[0].clips[0].id;
    const { u } = s3Wirkung(e, [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 },
      { befehl: 'noten_neu', clip_id: clip, noten: [{ beat: 0, laenge: 1, ton: 62, vel: 90 }] }]);
    e.k.leere();
    await u();
    const unter = { laden: n(e, '/k/arr/laden'), loop: n(e, '/k/arr/loop') };
    frei();
    await warteBis(() => n(e, '/k/arr/loop') > 0, 500);
    await schlaf(30);
    const nach = { laden: n(e, '/k/arr/laden'), loop: n(e, '/k/arr/loop') };
    console.log(`G2 Loop ${JSON.stringify({ gesperrt, unter, nach })}`);
    assert.deepEqual(unter, gesperrt ? { laden: 0, loop: 0 } : { laden: 1, loop: 1 });
    assert.deepEqual(nach, { laden: 1, loop: 1 });
    assert.equal(e.k.an('/k/arr/loop')[0].felder.an, 1, 'der Loop-Stand von dann (an)');
  });
}
