// PRODUCTION V2 Nachzug (Slice 0b, Punkt 7f, Spec 6.23, 6.31, 6.32): Während eines Freeze antworten der Transport-Start und jede Änderung,
// die die Wiedergabe, das Tempo oder den Loop ändert, mit 409 beschaeftigt; Mixer und Metronom bleiben erlaubt, Stopp auch (er bricht den
// Freeze bewusst ab). Öffnen und Anlegen eines Projekts ebenfalls 409 (6.31). Die Attrappe hält das an ihrem Lauf-Zustand z.lauf fest
// (den in V2 Slice 3 der simulierte Freeze setzt; bis dahin und für Proben: POST /attrappe/lauf {art}). Die Seite zeigt „A freeze is running“,
// nie OFFLINE und nie „Rejected: beschaeftigt“.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { starteProjAttrappe } from '../pruef/proj_attrappe.mjs';
import { fehlerText } from '../oeffentlich/produktion/produktion.js';
import { offlineNach } from '../oeffentlich/produktion/laden.js';

async function oben() {
  const srv = http.createServer((q, a) => { a.writeHead(200, { 'content-type': 'text/plain' }); a.end('oben'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, stoppe: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
}
const post = async (url, weg, d) => { const r = await fetch(url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }); return { status: r.status, j: await r.json() }; };

test('V2 Freeze-Sperre (Attrappe): Transport-Start, Tempo, Loop, Clips 409 beschaeftigt; Mixer, Metronom, Stopp erlaubt', async () => {
  const o = await oben(), at = await starteProjAttrappe({ oben: o.url });
  try {
    await post(at.url, '/proj/neu', { name: 'Sperre' });
    const s = await post(at.url, '/proj/aendern', { rev: 1, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
    let rev = s.j.rev;
    const sid = s.j.projekt.spuren[0].id;
    assert.equal((await post(at.url, '/attrappe/lauf', { art: 'freeze' })).status, 200);
    const start = await post(at.url, '/proj/transport', { aktion: 'start', beat: 0 });
    assert.deepEqual([start.status, start.j.fehler], [409, 'beschaeftigt'], 'Transport-Start (Spec 6.32)');
    assert.equal(at.zustand.transport, null, 'nichts gestartet');
    for (const b of [{ befehl: 'tempo_setzen', bpm: 130 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }, { befehl: 'spur_neu', art: 'audio' }]) {
      const r = await post(at.url, '/proj/aendern', { rev, label: 'x', befehle: [b] });
      assert.deepEqual([r.status, r.j.fehler], [409, 'beschaeftigt'], b.befehl);
    }
    for (const [weg, d] of [['/proj/oeffnen', { slug: 'sperre' }], ['/proj/neu', { name: 'Zwei' }]]) {
      assert.deepEqual((await post(at.url, weg, d)).j.fehler, 'beschaeftigt', `${weg} (Spec 6.31)`);
    }
    // Negativ-Kontrollen: Mixer und Metronom gehen durch, Stopp auch
    const m = await post(at.url, '/proj/aendern', { rev, label: 'Mixer', befehle: [{ befehl: 'spur_aendern', spur_id: sid, fader_db: -6 }, { befehl: 'metronom_setzen', an: true }] });
    assert.equal(m.status, 200); rev = m.j.rev;
    assert.equal((await post(at.url, '/proj/transport', { aktion: 'stopp' })).status, 200);
    await post(at.url, '/attrappe/lauf', { art: null });
    assert.equal((await post(at.url, '/proj/transport', { aktion: 'start', beat: 0 })).status, 200, 'nach dem Freeze geht der Start durch');
    await post(at.url, '/proj/transport', { aktion: 'stopp' });
    assert.equal((await post(at.url, '/proj/aendern', { rev, label: 'Tempo 130', befehle: [{ befehl: 'tempo_setzen', bpm: 130 }] })).status, 200);
  } finally { await at.stoppe(); await o.stoppe(); }
});

// V2 Fix-Runde 2 H7 (Spec 6.34): beschaeftigt ist mehrdeutig, die Seite zeigt den text der Antwort (vorher fest „A freeze is running“)
test('V2 Freeze-Sperre (Seite): 409 beschaeftigt zeigt den Text des Servers („A freeze is running; …“), kein OFFLINE', () => {
  const r = { status: 409, j: { fehler: 'beschaeftigt', text: 'a freeze is running; changes to the playback wait until it is done' } };
  assert.equal(fehlerText(r), 'A freeze is running; changes to the playback wait until it is done');
  assert.equal(offlineNach(r), null, 'eine Ablehnung lässt OFFLINE, wie es ist');
});
