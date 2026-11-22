// deno test src/gespraech/tests/warteschlange.test.ts
import {
  bereitZumAbschliessen,
  endungZu,
  geschaetzteDauer,
  istVerwaist,
  markerJson,
  mitFoto,
  mitSegment,
  nachErfolg,
  nachFehler,
  naechsteSegmentNr,
  naechsterSchritt,
  standText,
  wartezeit,
  HOECHSTE_WARTEZEIT_MS,
  type LokaleAufnahme,
} from '../warteschlange.ts'
import { gleich, test, wahr } from './hilfe.ts'

function aufnahme(x: Partial<LokaleAufnahme> = {}): LokaleAufnahme {
  return {
    lokalId: 'l1',
    serverId: null,
    erstelltAm: '2026-11-22T10:00:00.000Z',
    mitarbeiterEmail: 'a@b.de',
    art: 'termin',
    titel: 'Test',
    einwilligung: { bestaetigt: true, am: '2026-11-22T10:00:00.000Z', text: 'ok', wer: 'A' },
    aufbewahrenTage: 30,
    beendet: false,
    dauer_s: 0,
    lebtBis: 0,
    segmente: [],
    fotos: [],
    marker: [],
    markerGesendet: '[]',
    notizen: '',
    notizenGesendet: '',
    abgeschlossen: false,
    versuche: 0,
    naechsterVersuch: 0,
    letzterFehler: null,
    ...x,
  }
}

const seg = (nr: number, status: LokaleAufnahme['segmente'][number]['status']) => ({ nr, mime: 'audio/webm', dauer_s: 180, bytes: 1000, status })

test('zuerst anlegen, auch wenn schon Abschnitte da sind', () => {
  gleich(naechsterSchritt(aufnahme({ segmente: [seg(1, 'lokal')] }), 0), { art: 'anlegen' })
})

test('ohne Netz nichts tun', () => {
  gleich(naechsterSchritt(aufnahme(), 0, false), { art: 'nichts' })
})

test('Abschnitte der Reihe nach: hochladen, melden, dann der nächste', () => {
  const a = aufnahme({ serverId: 's1', segmente: [seg(2, 'lokal'), seg(1, 'hochgeladen')] })
  gleich(naechsterSchritt(a, 0), { art: 'segment_melden', nr: 1 })
  const b = mitSegment(a, 1, { status: 'gemeldet' })
  gleich(naechsterSchritt(b, 0), { art: 'segment_hochladen', nr: 2 })
})

test('laufender Abschnitt (aufnahme) wird übersprungen und blockiert das Abschließen', () => {
  const a = aufnahme({ serverId: 's1', beendet: true, segmente: [seg(1, 'gemeldet'), seg(2, 'aufnahme')] })
  gleich(naechsterSchritt(a, 0), { art: 'nichts' })
  wahr(!bereitZumAbschliessen(a))
})

test('Fotos: erst hochladen, dann gesammelt melden', () => {
  const a = aufnahme({
    serverId: 's1',
    segmente: [seg(1, 'gemeldet')],
    fotos: [
      { n: 1, name: 'a.jpg', mime: 'image/jpeg', sek: 5, status: 'lokal' },
      { n: 2, name: 'b.jpg', mime: 'image/jpeg', sek: 9, status: 'hochgeladen', pfad: 'x/foto_2.jpg' },
    ],
  })
  gleich(naechsterSchritt(a, 0), { art: 'foto_hochladen', n: 1 })
  gleich(naechsterSchritt(mitFoto(a, 1, { status: 'hochgeladen' }), 0), { art: 'fotos_melden' })
})

test('Markierungen und Notizen nur bei Änderung senden', () => {
  const marker = [{ sek: 12, art: 'wichtig' as const, text: 'Preis' }]
  const a = aufnahme({ serverId: 's1', marker, notizen: 'abc' })
  gleich(naechsterSchritt(a, 0), { art: 'marker' })
  const b = { ...a, markerGesendet: markerJson(marker) }
  gleich(naechsterSchritt(b, 0), { art: 'notiz' })
  gleich(naechsterSchritt({ ...b, notizenGesendet: 'abc' }, 0), { art: 'nichts' }, 'nicht beendet → noch nicht abschließen')
})

test('abschließen erst, wenn beendet und alles gemeldet', () => {
  const a = aufnahme({ serverId: 's1', beendet: true, segmente: [seg(1, 'gemeldet'), seg(2, 'gemeldet')] })
  gleich(naechsterSchritt(a, 0), { art: 'abschliessen' })
  gleich(naechsterSchritt({ ...a, abgeschlossen: true }, 0), { art: 'nichts' })
  wahr(!bereitZumAbschliessen({ ...a, segmente: [] }), 'ohne Ton nicht abschließen')
})

test('Wartezeit nach Fehlern wächst und ist gedeckelt', () => {
  gleich([1, 2, 3, 4].map(wartezeit), [2000, 4000, 8000, 16000])
  gleich(wartezeit(0), 0)
  gleich(wartezeit(50), HOECHSTE_WARTEZEIT_MS)
  const a = nachFehler(aufnahme(), 10_000, 'Netzfehler')
  gleich(a.versuche, 1)
  gleich(a.naechsterVersuch, 12_000)
  gleich(naechsterSchritt(a, 11_000), { art: 'warten', bis: 12_000 })
  gleich(naechsterSchritt(a, 12_000), { art: 'anlegen' })
  const b = nachErfolg(nachFehler(a, 12_000, 'nochmal'))
  gleich([b.versuche, b.naechsterVersuch, b.letzterFehler], [0, 0, null])
})

test('verwaist: nicht beendet und Lebenszeichen abgelaufen', () => {
  wahr(istVerwaist(aufnahme({ lebtBis: 100 }), 200))
  wahr(!istVerwaist(aufnahme({ lebtBis: 300 }), 200), 'lebt noch')
  wahr(!istVerwaist(aufnahme({ lebtBis: 100, beendet: true }), 200), 'beendet')
})

test('Nummern, Dauer, Endungen, Anzeige', () => {
  gleich(naechsteSegmentNr({ segmente: [] }), 1)
  gleich(naechsteSegmentNr({ segmente: [seg(1, 'gemeldet'), seg(3, 'lokal')] }), 4)
  gleich(geschaetzteDauer(36, 5000), 180)
  gleich([endungZu('audio/mp4'), endungZu('audio/webm;codecs=opus'), endungZu('image/jpeg')], ['m4a', 'webm', 'jpg'])
  const a = aufnahme({ beendet: true, serverId: 's', segmente: [seg(1, 'gemeldet'), seg(2, 'lokal')] })
  gleich(standText(a, 0, false), 'Wartet auf Netz (1 von 2 Abschnitten hochgeladen)')
  gleich(standText(a, 0, true), 'Wird hochgeladen (1 von 2)')
})
