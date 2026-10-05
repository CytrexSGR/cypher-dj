// Typprüfung von osc_adressen.ts: npx tsc --noEmit -p djk/vertrag/tsconfig.json
// Jede Zeile mit @ts-expect-error MUSS einen Typfehler erzeugen, sonst schlägt tsc fehl.
import { ADRESSEN, STATUS, POLITIK, VERTRAG, type Adresse, type Werte } from '../osc_adressen.ts';

const vertrag: 1 = VERTRAG;
const teil: Werte['/k/teil'] = [1n, 'cypher', 'p17', 0, 'deck/2/fader', 448.0, 32.0, 0.0, 0, 0, 'b_rein', 'h12'];
const rampe: Werte['/k/tempo/rampe'] = [2n, 'pruefstand', 128.0, 132.0, 32.0];
const typen: ',hssisddfiiss' = ADRESSEN['/k/teil'].typen;
const storniert: 8 = STATUS.storniert;
const raster: 2 = POLITIK.raster;
const klick: Adresse = '/test/klick';

// @ts-expect-error: id ist int64 und damit bigint, nicht number
const falscheId: Werte['/k/storno'] = [1, 'pruefstand', 2n];
// @ts-expect-error: /k/tempo/rampe hat fünf Felder, nicht vier
const zuKurz: Werte['/k/tempo/rampe'] = [2n, 'pruefstand', 128.0, 132.0];
// @ts-expect-error: diese Adresse gibt es im Vertrag nicht
const unbekannt: Adresse = '/k/gibt_es_nicht';

export const genutzt = [vertrag, teil, rampe, typen, storniert, raster, klick, falscheId, zuKurz, unbekannt];
