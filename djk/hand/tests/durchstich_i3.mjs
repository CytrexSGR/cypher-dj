// Ohr T14 Step 5 (von Hand, nicht Teil der Suite): rohes OSC am Server vorbei, direkt an den Kern der Prüfinstanz i
// (CYPHERDJ_INSTANZ=i, Port 47100 + 1000·9 = 56100). Belegt am echten Kern-Binary (nicht der Attrappe), dass I3a
// (PrueferI3, Ohr T14) ein Öffnen ohne Hörschein ablehnt, wo der alte Kern es noch annimmt.
// Aufruf:  node djk/hand/tests/durchstich_i3.mjs
// Umgebung (optional): CYPHERDJ_I3_PORT (Vorgabe 56100), CYPHERDJ_I3_MATERIAL (Vorgabe: legt selbst eine Klick-Fassung an)
import dgram from 'node:dgram';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { kodiere, dekodiere } from '../../vertrag/attrappe_kern/osc.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const DJK = path.resolve(HIER, '..', '..');
const PORT = Number(process.env.CYPHERDJ_I3_PORT ?? 56100);
const MID = process.env.CYPHERDJ_I3_MATERIAL ?? 'd15300000000i3a1';  // 16 Hex nötig, siehe unten (wird geprüft)
const BPM = 128.0;
const FASSUNG = 1;

const j = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
const assert = (bed, text) => {
  console.log(`${bed ? 'BELEG ' : 'FEHLGESCHLAGEN'} ${text}`);
  if (!bed) throw new Error(`Beleg gescheitert: ${text}`);
};

// Material für die Prüfinstanz anlegen (eigener Arbeitsbestand /dev/shm/cypherdj-i/material, Z2): dieselbe
// klick_fassung.py wie die C++-Tests (djk/kern/tests/deck). Idempotent: ein bestehender Ordner wird übersprungen.
function materialAnlegen(materialId) {
  const ziel = '/dev/shm/cypherdj-i/material';
  try {
    execFileSync('python3', [path.join(DJK, 'kern/tests/deck/klick_fassung.py'), '--ziel', ziel,
      '--material-id', materialId, '--beats', '256', '--bpm', String(BPM), '--fassung', String(FASSUNG)],
      { stdio: 'inherit' });
  } catch (e) {
    console.log(`materialAnlegen: ${e.message} (evtl. schon vorhanden, weiter)`);
  }
}

let id = 1000;
const neueId = () => ++id;

async function main() {
  const materialId = /^[0-9a-f]{16}$/.test(MID) ? MID : 'd15300000000f01a';
  materialAnlegen(materialId);

  const sock = dgram.createSocket('udp4');
  await new Promise((res) => sock.bind(0, '127.0.0.1', res));
  const meinPort = sock.address().port;
  console.log(`Lokaler Abo-Port ${meinPort}, Ziel-Kern 127.0.0.1:${PORT}`);

  let stand = null;      // letztes /uhr: { sample, beat, bpm }
  const warten = new Map();  // id -> [{status,resolve}], Quittungen sammeln
  const gesehen = new Map(); // id -> [Quittung...]

  sock.on('message', (buf) => {
    let m;
    try { m = dekodiere(buf); } catch { return; }
    if (m.adresse === '/uhr') {
      stand = { sample: m.werte[0], beat: m.werte[2], bpm: m.werte[3] };
    } else if (m.adresse === '/q') {
      const [qid, quelle, status, sample, beat, grund] = m.werte;
      const rec = { id: qid, quelle, status, sample, beat, grund };
      if (!gesehen.has(String(qid))) gesehen.set(String(qid), []);
      gesehen.get(String(qid)).push(rec);
      console.log(`  /q id=${qid} quelle=${quelle} status=${status} sample=${sample} beat=${beat} grund=${j(grund)}`);
    } else if (m.adresse === '/k/willkommen') {
      stand = { sample: m.werte[2], beat: m.werte[3], bpm: m.werte[4] };
      console.log(`/k/willkommen: generation=${m.werte[1]} sample=${stand.sample} beat=${stand.beat} bpm=${stand.bpm} kern=${m.werte[5]}`);
    }
  });

  const senden = (adresse, typen, werte) => sock.send(kodiere(adresse, typen, werte), PORT, '127.0.0.1');

  // /k/hallo: name, port (Abo-Ziel), protokoll
  senden('/k/hallo', 'sii', ['durchstich_i3', meinPort, 1]);
  // §4.1: der Kern streicht einen Abonnenten nach 5 s ohne /k/hallo (abonnenten_pruefen, netz.cpp); Herzschlag alle
  // 1 s, sonst verliert das Skript mitten in einer Wartezeit sein Abo und sieht keine Quittungen mehr (Befund hier).
  const herzschlag = setInterval(() => senden('/k/hallo', 'sii', ['durchstich_i3', meinPort, 1]), 1000);
  for (let i = 0; i < 50 && !stand; i++) await new Promise((r) => setTimeout(r, 20));
  assert(stand, `/k/willkommen binnen 1 s erhalten (stand=${j(stand)})`);

  const wartenAufQuittung = async (zielId, status, timeoutMs = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const arr = gesehen.get(String(zielId)) ?? [];
      const treffer = arr.find((r) => Number(r.status) === status);
      if (treffer) return treffer;
      const abgelehnt = arr.find((r) => Number(r.status) === 6);
      if (status !== 6 && abgelehnt) return abgelehnt;   // 6 kommt statt 2: als Ergebnis zurückgeben, nicht endlos warten
      await new Promise((r) => setTimeout(r, 20));
    }
    return null;
  };

  // Deck 2 laden
  const inhalt = () => `${materialId}/${Math.round(BPM * 1000)}_r${FASSUNG}`;
  const idLaden = neueId();
  senden('/k/deck/laden', 'hsisdii', [idLaden, 'leitstand', 2, materialId, BPM, FASSUNG, 0]);
  const qLaden = await wartenAufQuittung(idLaden, 3, 8000);
  assert(qLaden, `Deck 2 geladen, Quittung 3 (ist ${j(qLaden)})`);

  const teilOeffnen = (jid, quelle, hs) => {
    const beat = Math.ceil((stand?.beat ?? 0) + 4);
    senden('/k/teil', 'hssisddfiiss', [jid, quelle, '', 0, 'deck/2/fader', beat, 0, 0.0, 0, 1, '', hs ?? '']);
    return beat;
  };
  const teilSchliessen = (jid, quelle) => {
    const beat = Math.ceil((stand?.beat ?? 0) + 1);
    senden('/k/teil', 'hssisddfiiss', [jid, quelle, '', 0, 'deck/2/fader', beat, 0, -200.0, 0, 1, '', '']);
    return beat;
  };

  // Ausgangslage erzwingen: deck/2/fader ist Kanal-Zustand, überlebt Neuladen UND einen früheren Lauf dieses
  // Skripts (Befund durchstich_ohr.mjs). Vor der Messung immer zu, Quelle andreas (nie blockiert).
  const idZu0 = neueId();
  teilSchliessen(idZu0, 'andreas');
  await wartenAufQuittung(idZu0, 2, 4000);

  // (a)/(b) Quelle cypher, ohne Hörschein
  const id1 = neueId();
  const beat1 = teilOeffnen(id1, 'cypher', '');
  console.log(`--- Öffnen ohne Hörschein (cypher), ab_beat=${beat1}, id=${id1} ---`);
  const q1 = await wartenAufQuittung(id1, 2, 6000);
  console.log(`Ergebnis (a/b): ${j(q1)}`);

  // zu (wieder schließen, falls offen): Schließen öffnet nicht, geht immer durch
  const idZu1 = neueId();
  teilSchliessen(idZu1, 'andreas');
  await wartenAufQuittung(idZu1, 2, 4000);

  // (c) mit passendem /k/hoerschein
  const idHs = neueId();
  senden('/k/hoerschein', 'hsssssddddfff', [idHs, 'leitstand', 'durchstich-hs', 'deck/2', inhalt(), 'ok', BPM,
    (stand?.beat ?? 0) + 1000, -1e9, 1e9, 0.0, 0.0, -20.0]);
  const qHs = await wartenAufQuittung(idHs, 3, 4000);
  assert(qHs, `/k/hoerschein registriert, Quittung 3 (ist ${j(qHs)})`);
  const id2 = neueId();
  const beat2 = teilOeffnen(id2, 'cypher', 'durchstich-hs');
  console.log(`--- Öffnen MIT Hörschein (cypher), ab_beat=${beat2}, id=${id2} ---`);
  const q2 = await wartenAufQuittung(id2, 2, 6000);
  console.log(`Ergebnis (c): ${j(q2)}`);

  const idZu2 = neueId();
  teilSchliessen(idZu2, 'andreas');
  await wartenAufQuittung(idZu2, 2, 4000);

  // (d) Negativ-Kontrolle: Quelle andreas, ohne Hörschein
  const id3 = neueId();
  const beat3 = teilOeffnen(id3, 'andreas', '');
  console.log(`--- Öffnen ohne Hörschein (andreas, Negativ-Kontrolle), ab_beat=${beat3}, id=${id3} ---`);
  const q3 = await wartenAufQuittung(id3, 2, 6000);
  console.log(`Ergebnis (d): ${j(q3)}`);

  // aufräumen: wieder schließen
  const idZu3 = neueId();
  teilSchliessen(idZu3, 'andreas');
  await wartenAufQuittung(idZu3, 2, 4000);

  console.log('\n=== ZUSAMMENFASSUNG ===');
  console.log(`(a/b) cypher ohne Schein:   status=${q1?.status} grund=${j(q1?.grund)}`);
  console.log(`(c)   cypher mit Schein:    status=${q2?.status} grund=${j(q2?.grund)}`);
  console.log(`(d)   andreas ohne Schein:  status=${q3?.status} grund=${j(q3?.grund)}`);

  clearInterval(herzschlag);
  sock.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
