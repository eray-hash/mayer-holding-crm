// Prüft den gemeinsamen Kern für Reihenfolge, Titelbild und Angaben je Foto (objekte.bilder_reihenfolge),
// den beide Exposé-Erzeuger (CRM: src/lib/exposeBilder.ts, Server: exposeWerkzeuge.ts) und beide Oberflächen benutzen.
import { assertEquals } from 'jsr:@std/assert@1'
import {
  aendereEintrag,
  alsTitelbild,
  dreheWeiter,
  drehungVon,
  exposeBilderAuswahl,
  haengeAn,
  kombiniereAusrichtung,
  leseReihenfolge,
  neueReihenfolge,
  normaleDrehung,
  ordneBilder,
  verschiebe,
  vollstaendig,
} from './bilderReihenfolge.ts'

// Ordner „Bilder“ wie im CRM: neueste zuerst.
const ORDNER = [{ id: 'd4' }, { id: 'd3' }, { id: 'd2' }, { id: 'd1' }]
const ids = (l: { id: string }[]) => l.map((x) => x.id)
const geordnet = (roh: unknown) => ordneBilder(ORDNER, roh).map((g) => g.dok.id)

Deno.test('ohne Angabe gilt die Reihenfolge des Ordners', () => {
  assertEquals(geordnet(null), ['d4', 'd3', 'd2', 'd1'])
  assertEquals(geordnet([]), ['d4', 'd3', 'd2', 'd1'])
  assertEquals(geordnet('kaputt'), ['d4', 'd3', 'd2', 'd1'])
})

Deno.test('Reihenfolge: Genanntes zuerst, Unbekanntes übergangen, Rest hinten in Ordner-Reihenfolge', () => {
  assertEquals(geordnet([{ id: 'd1' }, { id: 'weg' }, 'd2']), ['d1', 'd2', 'd4', 'd3'])
  // Doppelte Kennungen zählen einmal.
  assertEquals(geordnet(['d2', 'd2', 'd1']), ['d2', 'd1', 'd4', 'd3'])
})

Deno.test('lesen ist tolerant und speichert keine Vorgaben', () => {
  assertEquals(leseReihenfolge([{ id: 'a', drehung: 450, im_expose: true, beschriftung: '  Küche  ' }, { id: 'b', drehung: 45 }, { nichts: 1 }, 7]), [
    { id: 'a', drehung: 90, beschriftung: 'Küche' },
    { id: 'b' },
  ])
  assertEquals(normaleDrehung(-90), 270)
  assertEquals(normaleDrehung('180'), 180)
  assertEquals(normaleDrehung(30), 0)
})

Deno.test('Exposé-Auswahl: Titelbild zuerst, ohne „nicht im Exposé“, höchstens max, mit Drehung', () => {
  const roh = [{ id: 'd2', drehung: 90 }, { id: 'd1', im_expose: false }, { id: 'd3', beschriftung: 'Bad' }]
  const a = exposeBilderAuswahl(ORDNER, roh, 7)
  assertEquals(a.map((x) => x.dok.id), ['d2', 'd3', 'd4'])
  assertEquals(a[0].drehung, 90)
  assertEquals(a[1].beschriftung, 'Bad')
  assertEquals(exposeBilderAuswahl(ORDNER, roh, 2).map((x) => x.dok.id), ['d2', 'd3'])
  assertEquals(exposeBilderAuswahl(ORDNER, roh, 0), [])
  assertEquals(drehungVon(roh, 'd2'), 90)
  assertEquals(drehungVon(roh, 'd4'), 0)
})

Deno.test('neue Reihenfolge behält die Angaben aus dem frischen Stand', () => {
  const frisch = [{ id: 'd3', drehung: 180 }, { id: 'd1', beschriftung: 'Garten' }]
  assertEquals(neueReihenfolge(ORDNER, frisch, ['d1', 'unbekannt', 'd1']), [{ id: 'd1', beschriftung: 'Garten' }, { id: 'd3', drehung: 180 }, { id: 'd4' }, { id: 'd2' }])
  // Gespeichert wird genau ein Eintrag je Foto des Ordners (Gelöschtes fällt heraus).
  assertEquals(ids(vollstaendig(ORDNER, ['weg', 'd2'])), ['d2', 'd4', 'd3', 'd1'])
})

Deno.test('Titelbild, Verschieben, Drehen, Angaben ändern', () => {
  assertEquals(ids(alsTitelbild(ORDNER, ['d1', 'd2', 'd3', 'd4'], 'd3')), ['d3', 'd1', 'd2', 'd4'])
  assertEquals(ids(verschiebe(ORDNER, ['d1', 'd2', 'd3', 'd4'], 'd3', -1)), ['d1', 'd3', 'd2', 'd4'])
  assertEquals(ids(verschiebe(ORDNER, ['d1', 'd2', 'd3', 'd4'], 'd4', 1)), ['d1', 'd2', 'd3', 'd4'])
  const gedreht = dreheWeiter(ORDNER, [{ id: 'd1', drehung: 270 }], 'd1')
  assertEquals(gedreht[0], { id: 'd1' })
  assertEquals(dreheWeiter(ORDNER, [], 'd3').find((e) => e.id === 'd3'), { id: 'd3', drehung: 90 })
  const aus = aendereEintrag(ORDNER, [], 'd2', { im_expose: false, beschriftung: 'Keller' })
  assertEquals(aus.find((e) => e.id === 'd2'), { id: 'd2', im_expose: false, beschriftung: 'Keller' })
  assertEquals(aendereEintrag(ORDNER, aus, 'd2', { im_expose: true, beschriftung: '' }).find((e) => e.id === 'd2'), { id: 'd2' })
})

Deno.test('neue Fotos kommen hinten an, das Titelbild bleibt', () => {
  const ordner = [{ id: 'n2' }, { id: 'n1' }, ...ORDNER]
  // Bisher ohne Angabe: Ordner-Reihenfolge der alten, dann die neuen in Sendereihenfolge.
  assertEquals(ids(haengeAn(ordner, [], ['n1', 'n2'])), ['d4', 'd3', 'd2', 'd1', 'n1', 'n2'])
  assertEquals(ids(haengeAn(ordner, ['d1'], ['n1', 'n2'])), ['d1', 'd4', 'd3', 'd2', 'n1', 'n2'])
})

Deno.test('Kamera-Ausrichtung und zusätzliche Drehung ergeben die Zeichen-Ausrichtung', () => {
  assertEquals(kombiniereAusrichtung(1, 0), 1)
  assertEquals(kombiniereAusrichtung(1, 90), 6)
  assertEquals(kombiniereAusrichtung(6, 90), 3)
  assertEquals(kombiniereAusrichtung(6, 270), 1)
  assertEquals(kombiniereAusrichtung(8, 180), 6)
  assertEquals(kombiniereAusrichtung(3, 0), 3)
})
