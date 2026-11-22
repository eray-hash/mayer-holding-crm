// deno test src/gespraech/tests/automat.test.ts
import { dauerMs, istAktiv, schritt, START, zeitText, type AutomatEreignis, type AutomatZustand } from '../automat.ts'
import { gleich, test, wahr } from './hilfe.ts'

function lauf(ereignisse: AutomatEreignis[], z: AutomatZustand = START): AutomatZustand {
  return ereignisse.reduce(schritt, z)
}

test('normaler Ablauf mit Pause: Dauer ohne Pause', () => {
  const z = lauf([
    { typ: 'einwilligung_zeigen' },
    { typ: 'einwilligung_ok' },
    { typ: 'gestartet', jetzt: 1000 },
    { typ: 'pause', jetzt: 61_000 },
    { typ: 'weiter', jetzt: 121_000 },
    { typ: 'beenden', jetzt: 151_000 },
  ])
  gleich(z.phase, 'beendet')
  gleich(z.aktivMs, 90_000, 'Aufnahmezeit')
  gleich(dauerMs(z, 999_999), 90_000, 'nach dem Ende läuft keine Uhr mehr')
})

test('ohne Einwilligung kein Start', () => {
  gleich(schritt(START, { typ: 'einwilligung_ok' }), START)
  gleich(schritt(START, { typ: 'gestartet', jetzt: 1 }), START)
  const z = lauf([{ typ: 'einwilligung_zeigen' }, { typ: 'gestartet', jetzt: 5 }])
  gleich(z.phase, 'einwilligung', 'gestartet ohne einwilligung_ok wird ignoriert')
})

test('abbrechen in der Einwilligung führt zurück', () => {
  gleich(lauf([{ typ: 'einwilligung_zeigen' }, { typ: 'abbrechen' }]).phase, 'bereit')
})

test('Mikrofon verweigert: fehler, zurücksetzen möglich', () => {
  const z = lauf([{ typ: 'einwilligung_zeigen' }, { typ: 'einwilligung_ok' }, { typ: 'fehler', text: 'Kein Zugriff' }])
  gleich(z.phase, 'fehler')
  gleich(z.grund, 'Kein Zugriff')
  gleich(schritt(z, { typ: 'zuruecksetzen' }).phase, 'bereit')
})

test('Unterbrechung (Anruf/App verlassen) und Fortsetzen zählt die Zeit weiter', () => {
  const z = lauf([
    { typ: 'einwilligung_zeigen' },
    { typ: 'einwilligung_ok' },
    { typ: 'gestartet', jetzt: 0 },
    { typ: 'unterbrechung', jetzt: 30_000, grund: 'Mikrofon getrennt' },
  ])
  gleich(z.phase, 'unterbrochen')
  gleich(z.aktivMs, 30_000)
  wahr(!istAktiv(z), 'unterbrochen belegt kein Mikrofon')
  const weiter = lauf([{ typ: 'fortsetzen' }, { typ: 'gestartet', jetzt: 100_000 }], z)
  gleich(weiter.phase, 'laeuft')
  gleich(dauerMs(weiter, 110_000), 40_000)
})

test('Fehler beim Fortsetzen lässt die Aufnahme unterbrochen (Gesichertes bleibt beendbar)', () => {
  const z = lauf([
    { typ: 'einwilligung_zeigen' },
    { typ: 'einwilligung_ok' },
    { typ: 'gestartet', jetzt: 0 },
    { typ: 'unterbrechung', jetzt: 10_000, grund: 'weg' },
    { typ: 'fortsetzen' },
    { typ: 'fehler', text: 'Mikrofon belegt' },
  ])
  gleich(z.phase, 'unterbrochen')
  gleich(schritt(z, { typ: 'beenden', jetzt: 50_000 }).phase, 'beendet')
  gleich(schritt(z, { typ: 'beenden', jetzt: 50_000 }).aktivMs, 10_000)
})

test('Beenden aus der Pause zählt die Pause nicht', () => {
  const z = lauf([
    { typ: 'einwilligung_zeigen' },
    { typ: 'einwilligung_ok' },
    { typ: 'gestartet', jetzt: 0 },
    { typ: 'pause', jetzt: 5000 },
    { typ: 'beenden', jetzt: 900_000 },
  ])
  gleich(z.aktivMs, 5000)
})

test('ungültige Übergänge ändern nichts (gleiches Objekt)', () => {
  const z = lauf([{ typ: 'einwilligung_zeigen' }, { typ: 'einwilligung_ok' }, { typ: 'gestartet', jetzt: 0 }])
  wahr(schritt(z, { typ: 'weiter', jetzt: 1 }) === z, 'weiter ohne Pause')
  wahr(schritt(z, { typ: 'einwilligung_zeigen' }) === z, 'Einwilligung während der Aufnahme')
  wahr(schritt(z, { typ: 'zuruecksetzen' }) === z, 'zurücksetzen während der Aufnahme')
})

test('zeitText', () => {
  gleich(zeitText(0), '00:00')
  gleich(zeitText(65_400), '01:05')
  gleich(zeitText(3_723_000), '1:02:03')
})
