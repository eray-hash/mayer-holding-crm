import { assertEquals } from 'jsr:@std/assert@1'
import { aeltesteVerlaufszeile, darfAkteSelbstLoeschen, istErstellerFrischerAkte } from './akteSelbstLoeschen.ts'

const jetzt = new Date('2026-11-25T12:00:00Z')
const wer = { name: 'Test Mitarbeiter', email: 'test@beispiel.de' }
const leer = { rechnungen: 0, kostenvoranschlaege: 0, protokolle: 0 }
const akte = (activities: unknown, extra: Record<string, unknown> = {}) => ({ id: 'k_1', activities, ...extra })

Deno.test('älteste Verlaufszeile nach Datum, nicht nach Position', () => {
  const z = aeltesteVerlaufszeile([
    { date: '2026-11-24', user: 'B' },
    { date: '2026-11-20', user: 'A' },
    { date: '2026-11-22', user: 'C' },
  ])
  assertEquals(z?.user, 'A')
})

Deno.test('Ersteller einer frischen Akte ohne Anhänge darf löschen', () => {
  const r = darfAkteSelbstLoeschen(akte([{ date: '2026-11-25', user: 'Kollege' }, { date: '2026-11-20', user: 'Test Mitarbeiter' }]), wer, leer, jetzt)
  assertEquals(r.ok, true)
})

Deno.test('verantwortlich (Name oder E-Mail) zählt als Ersteller', () => {
  assertEquals(darfAkteSelbstLoeschen(akte([{ date: '2026-11-20', user: 'System' }], { verantwortlich: 'test mitarbeiter' }), wer, leer, jetzt).ok, true)
  assertEquals(darfAkteSelbstLoeschen(akte([{ date: '2026-11-20', user: 'System' }], { verantwortlich_email: 'TEST@beispiel.de' }), wer, leer, jetzt).ok, true)
})

Deno.test('fremde Akte: nein', () => {
  const r = darfAkteSelbstLoeschen(akte([{ date: '2026-11-20', user: 'Kollege' }]), wer, leer, jetzt)
  assertEquals(r.ok, false)
})

Deno.test('älter als 14 Tage: nein', () => {
  const r = istErstellerFrischerAkte(akte([{ date: '2026-11-01', user: 'Test Mitarbeiter' }]), wer, jetzt)
  assertEquals(r.ok, false)
})

Deno.test('ohne Verlauf oder Sammelakte: nein', () => {
  assertEquals(istErstellerFrischerAkte(akte([]), wer, jetzt).ok, false)
  assertEquals(istErstellerFrischerAkte({ id: 'k_intern_holding', activities: [{ date: '2026-11-24', user: 'Test Mitarbeiter' }] }, wer, jetzt).ok, false)
})

Deno.test('Rechnung, Kostenvoranschlag oder Protokoll verhindern das Selbst-Löschen', () => {
  const a = akte([{ date: '2026-11-24', user: 'Test Mitarbeiter' }])
  for (const anh of [{ ...leer, rechnungen: 1 }, { ...leer, kostenvoranschlaege: 2 }, { ...leer, protokolle: 1 }]) {
    const r = darfAkteSelbstLoeschen(a, wer, anh, jetzt)
    assertEquals(r.ok, false)
  }
})
