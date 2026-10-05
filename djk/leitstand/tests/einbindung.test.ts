// Die Änderungen dieser Scheibe an Dateien von Scheibe 12: Sample eines Beats (§1.3), Neuanmeldung mit /k/tschuess vor dem
// ersten /k/hallo (§4.1), Pläne, Vorschläge und Hörscheine im Takt-Zustand (§14.7), jetzt.seq in jeder Rückgabe (§10).
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { liesUndDekodiere } from '../src/adressen.ts';
import { KernAnbindung } from '../src/kern.ts';
import { TaktStrom, type TaktZustand } from '../src/takt.ts';
import { WsClient } from '../src/ws_client.ts';
import { sampleBeiBeat } from '../src/zeit.ts';
import { beende, freierTcpPort, freierUdpPort, starte, warte } from './hilfen/prozess.ts';

test('§1.3 Golden-Werte: sample(b) im Segment des Uhrstands', () => {
  const konstant = { sample: 0, mono_ns: 0, beat: 0, bpm: 128, bpm_pro_s: 0 };
  assert.equal(sampleBeiBeat(konstant, 64), 1440000);
  const rampe = { sample: 2880000, mono_ns: 0, beat: 128, bpm: 128, bpm_pro_s: 4 / (32 * 60 / 130) };
  assert.equal(sampleBeiBeat(rampe, 144), 3237188);   // 3 237 188,004 gerundet (§1.3 Tabelle)
  assert.equal(sampleBeiBeat(rampe, 160), 3588923);   // 3 588 923,077
});

async function ersteNachrichten(frisch: boolean): Promise<string[]> {
  const kernPort = await freierUdpPort();
  const kern = dgram.createSocket('udp4');
  const gesehen: string[] = [];
  kern.on('message', (b) => gesehen.push(liesUndDekodiere(b).adresse));
  await new Promise<void>((ok) => kern.bind(kernPort, '127.0.0.1', () => ok()));
  const k = new KernAnbindung({ kernPort, aboPort: await freierUdpPort(), name: 'leitstand', frischAnmelden: frisch },
    { nachricht: () => {}, gesendet: () => {}, zustand: () => {}, unlesbar: () => {} });
  await k.starte();
  await warte(120);
  await k.stoppe();
  kern.close();
  return gesehen.slice(0, 3);
}

test('§4.1: frisch anmelden schickt /k/tschuess genau einmal vor dem ersten /k/hallo; ohne Option nicht', async () => {
  assert.deepEqual(await ersteNachrichten(true), ['/k/tschuess', '/k/hallo', '/k/hallo']);
  assert.deepEqual(await ersteNachrichten(false), ['/k/hallo', '/k/hallo', '/k/hallo']);
});

test('§14.7: plaene, vorschlaege, hoerscheine kommen aus der Lage in den Takt-Zustand', () => {
  let z: TaktZustand | null = null;
  const t = new TaktStrom({
    berichtFristNs: 0, analyseDa: () => false, jetzt: () => 0, senden: (x) => { z = x; },
    lage: () => ({ set_basis_bpm: 128, autonomie: 1, ki_gestoppt: false, plaene: [{ id: 'p1' }], vorschlaege: [{ id: 'v1', verfaellt_takt: 16 }], hoerscheine: [] }),
  });
  t.aufTakt({ takt: 5, phrase: 1, sample: 360000, beat: 16, bpm: 128 }, 0);
  assert.deepEqual([z!.plaene, z!.vorschlaege], [[{ id: 'p1' }], [{ id: 'v1', verfaellt_takt: 16 }]]);
});

test('§10: plan_einreichen und plan_abbrechen tragen jetzt.seq = seq des Antwort-Umschlags, wie lage', { timeout: 15000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-einbindung-'));
  const [kern, ws, abo] = [await freierUdpPort(), await freierTcpPort(), await freierUdpPort()];
  const konfig = path.join(tmp, 'leitstand.toml');
  fs.writeFileSync(konfig, `version = 1\nws_port = ${ws}\nabo_port = ${abo}\nsets = "${tmp}/sets"\n`);
  const tg = await starte('tests/hilfen/taktgeber.ts', ['--port', String(kern), '--bpm', '480'], 'taktgeber:');
  const ls = await starte('src/leitstand.ts', ['--konfig', konfig, '--kern-port', String(kern), '--set-id', '2026-09-23_0000'], 'leitstand:');
  try {
    const m = await WsClient.angemeldet(ws, 'mcp', 'test-mcp');
    const t = await m.warteAuf((n) => n.typ === 'takt');
    const rpc = async (id: number, methode: string, parameter: Record<string, unknown>) => {
      m.sende('rpc', { id, methode, parameter });
      const r = await m.warteAuf((n) => n.typ === 'rpc_antwort' && n.daten.id === id);
      return { seq: r.seq, erg: r.daten.ergebnis as { jetzt: { seq: number }; plan_id?: string; status?: string } };
    };
    // Negativ-Kontrolle: lage (Scheibe 12) hielt die Regel schon
    const l = await rpc(1, 'lage', {});
    assert.equal(l.erg.jetzt.seq, l.seq);
    const e = await rpc(2, 'plan_einreichen', { grund: 'test', teile: [{ regler: 'deck/1/eq/hoch', art: 'setze',
      ab_takt: (t.daten.takt as number) + 40, nach: -6 }] });
    assert.ok(e.erg.plan_id && e.erg.status, JSON.stringify(e.erg));
    assert.equal(e.erg.jetzt.seq, e.seq, `plan_einreichen: jetzt.seq ${e.erg.jetzt.seq}, Umschlag ${e.seq}`);
    const a = await rpc(3, 'plan_abbrechen', { plan_id: e.erg.plan_id });
    assert.equal(a.erg.jetzt.seq, a.seq, `plan_abbrechen: jetzt.seq ${a.erg.jetzt.seq}, Umschlag ${a.seq}`);
    m.schliesse();
  } finally {
    await beende(ls); await beende(tg);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
