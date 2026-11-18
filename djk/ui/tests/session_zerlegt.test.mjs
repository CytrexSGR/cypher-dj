// ProjSitzung was split into collaborator classes (session_device.ts, session_sources.ts, ...): every method name the class had before the split (taken from
// the file at 7267f21e0 with grep -oE "^  (async |private async |private )?[a-zA-Z_]+\(") is still there, so no caller loses a method. A name that moved
// with its cluster and has no caller outside it lives on the collaborator class instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjSitzung } from '../areas/proj/session.ts';
import { SitzungGeraet } from '../areas/proj/session_device.ts';
import { SitzungQuellen } from '../areas/proj/session_sources.ts';
import { SitzungVorhoeren } from '../areas/proj/session_prelisten.ts';
import { SitzungAuto } from '../areas/proj/session_auto.ts';
import { sitzung } from './support/proj_context.mjs';

const BLEIBT = [
  'aendern', 'aktuell', 'analyseEnde', 'ankunft', 'armFreiMitLog', 'aufnahmeAktiv', 
  'autoArm', 'autoFreiMitLog', 'autoGeste', 'autoLage', 'autoReEnable', 'autoUebersteuern', 
  'basisSenden', 'beende', 'beendeVorhoeren', 'beiSchliessen', 'beiStand', 'bereiteWiedergabe', 'betrifftWiedergabe', 'bkLaden', 'bkLage',
  'bkMerken', 'brauchOffen', 'deckelDekodiert', 'dekodiertEreignis', 'einsRueckweg', 'ereignis', 'fremderLauf', 'geraetFenster',
  'geraetIst', 'geraetParam', 'geraetParameter', 'gleicheDekodiertAb', 'gueltigeVorhoeren', 'haken', 'handFreiMitLog', 'hoereBk',
  'holeNach', 'hostBelegung', 'hostGesundAlterMs', 'hostLage', 'hostNeuLaden', 'hostZustandSichern', 'insertFenster', 'insertParam',
  'insertParameter', 'istUebersteuert', 'istWiederanlauf', 'kanalOffenGesehen', 'kanalZuUndBekannt', 'katalogQuelle', 'kopie',
  'ladeEchtzeitSicht', 'ladeLiveNeu', 'ladeLiveNeuFrei', 'ladenGesperrt', 'ladeNr', 'ladeOderMerke', 'ladeWiedergabe',
  'leereKiMaske', 'leereVorhoeren', 'liesProjekt', 'liste', 'liveFaderErgebnis', 'liveFaderFaellig', 'liveModulFader', 'liveModulFaderLauf',
  'liveOeffnen', 'liveOeffnenOhneTempo', 'liveSpielt', 'liveTempo', 'loeschen', 'loeseQuellenAuf', 'loopOderMerke', 'meldeEinsammeln',
  'meldeRegler', 'meldeStand', 'musterVorlauf', 'nachNeustart', 'naechsteNummer', 'neu', 'nimmAuto', 'oeffneIntern',
  'oeffnen', 'oeffnetGerade', 'offeneShas', 'projektQuellPfad', 'pruefeAufnahmeSpuren', 'pruefeMarkerInQuelle', 'pruefeRev', 'pruefeSperre',
  'quellePfadVon', 'quellPfad', 'raeumeNummern', 'reglerZurueck', 'riegel', 'rueckweg', 'rueckwegSpeichern', 'schliesse', 'schliesseOffen',
  'schreibeNeueWiedergabe', 'schreibeTake', 'schreibeVorhoerWiedergabe', 'schreibeWiedergabeFuer', 'setzeAufnahmeLauf', 'setzeAusgabeLauf',
  'setzeStemsStand', 'setzeVorhoeren', 'slotGruppe', 'speichereStand', 'sperreFremderStart', 'sperreFremderTransport', 'sperreLaden',
  'sperreLiveLaeuft', 'sperreOeffnen', 'sperreTransport', 'starteAnalysen', 'surgeIstFuer', 'synchronisiere', 'tempoAnMaster',
  'tempoQuelleFuer', 'tempoVorStart', 'transport', 'uebernimm', 'uebernimmMixer', 'uebersetzeFuer', 'uebersteuertListe', 'umkehr',
  'unbekannteSpurRegler', 'verlaufListe', 'vollziehe', 'vorhoerenLage', 'vorhoerenSetzen', 'warpLage', 'wirtSpiegel', 'zugangHaken',
  'zugangOffen', 'zustandVon'
];
const VERSCHOBEN = [[SitzungGeraet, ['pluginSpur']], [SitzungQuellen, ['loeseQuellenAuf', 'tempoQuelleFuer']],
  [SitzungVorhoeren, ['meldeVorhoeren', 'ladeVorhoerenStand', 'vorhoerenLage', 'vorhoerenSetzen', 'beendeVorhoeren']],
  [SitzungAuto, ['autoZiel', 'autoSpur', 'autoAntwort', 'armAnsicht', 'armMelden', 'armZurueck', 'autoArmEins', 'autoUebersteuern', 'autoReEnable', 'autoArm', 'autoGeste']]];

test('ProjSitzung keeps every method name it had before the split', () => {
  assert.ok(BLEIBT.length >= 120, 'the name list is not empty');
  const fehlt = BLEIBT.filter((n) => typeof ProjSitzung.prototype[n] !== 'function');
  assert.deepEqual(fehlt, []);
});

test('names that moved with their cluster are on the collaborator class', () => {
  for (const [klasse, namen] of VERSCHOBEN) for (const n of namen) assert.equal(typeof klasse.prototype[n], 'function', `${klasse.name}.${n}`);
});

// the delegators of ProjSitzung reach the moved code: the same observable results as the session had before (no project open: the guard answers)
test('delegators call through: the pre-listen and automation calls of a session without a project', async (t) => {
  const e = sitzung(t, {});
  assert.deepEqual(e.s.vorhoerenLage(), { code: 200, j: { vorhoeren: {} } });
  assert.equal(await e.s.beendeVorhoeren(), undefined);
  const fehler = async (p) => { try { await p; } catch (x) { return [x.code, x.fehler]; } return null; };
  assert.deepEqual(await fehler(e.s.vorhoerenSetzen({ spur_id: 's1', take_id: 't1' }, 'andreas')), [409, 'kein_projekt']);
  assert.deepEqual(await fehler(e.s.autoArm({ spur_id: 's1', an: true }, 'andreas')), [409, 'kein_projekt']);
  assert.deepEqual(await fehler(e.s.autoUebersteuern({ spur_id: 's1', ziel: 'fader' }, 'andreas')), [409, 'kein_projekt']);
  assert.deepEqual(await fehler(e.s.autoReEnable({ spur_id: 's1', ziel: 'fader' }, 'andreas')), [409, 'kein_projekt']);
  assert.deepEqual(await fehler(Promise.resolve().then(() => e.s.autoGeste({ spur_id: 's1', ziel: 'fader', wert: -9 }, 'andreas'))), [409, 'kein_projekt']);
});
