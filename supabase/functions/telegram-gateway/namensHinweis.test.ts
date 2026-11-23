import { assertEquals } from 'jsr:@std/assert@1'
import { frischeMailPartner, haeufigeNamen, hinweisAusNamen, namensHinweis, personenName } from './namensHinweis.ts'

Deno.test('personenName: Personen ja, Firmen und Systemabsender nein', () => {
  assertEquals(personenName('Max Muster', 'max@beispiel.de'), 'Max Muster')
  assertEquals(personenName('Muster, Max', 'max@beispiel.de'), 'Max Muster')
  assertEquals(personenName('Beispiel GmbH', 'info@beispiel.de'), '')
  assertEquals(personenName('Erika Beispiel', 'noreply@beispiel.de'), '')
  assertEquals(personenName('max@beispiel.de', 'max@beispiel.de'), '')
  assertEquals(personenName('Team 2024', 'x@beispiel.de'), '')
})

Deno.test('haeufigeNamen: zählt beide Richtungen, ohne eigene Adresse', () => {
  const mails = [
    { von: { name: 'Max Muster', adresse: 'max@beispiel.de' }, an: [{ name: 'Ich', adresse: 'ich@beispiel.de' }] },
    { von: { name: 'Erika Beispiel', adresse: 'erika@beispiel.de' }, an: [{ name: 'Ich', adresse: 'ich@beispiel.de' }] },
    { von: { name: 'Ich', adresse: 'ich@beispiel.de' }, an: [{ name: 'Erika Beispiel', adresse: 'erika@beispiel.de' }] },
  ]
  assertEquals(haeufigeNamen(mails, ['ich@beispiel.de']), ['Erika Beispiel', 'Max Muster'])
})

Deno.test('hinweisAusNamen: ohne Doppel und gekürzt', () => {
  assertEquals(hinweisAusNamen(['Max Muster', 'max muster', 'Erika Beispiel']), 'Namen: Max Muster, Erika Beispiel.')
  assertEquals(hinweisAusNamen([]), '')
  const lang = hinweisAusNamen(Array.from({ length: 100 }, (_, i) => `Person Nummer${'x'.repeat(i % 5)}${String.fromCharCode(65 + (i % 26))}${i}`.replace(/\d/g, '')), 80)
  assertEquals(lang.length <= 80, true)
})

// Kleines Datenbank-Doppel: liefert je Tabelle feste Zeilen und merkt sich Schreibzugriffe.
function doppel(zeilen: Record<string, unknown[]>, geschrieben: unknown[] = []) {
  return {
    from(tabelle: string) {
      const kette = {
        select: () => kette,
        eq: () => kette,
        limit: () => Promise.resolve({ data: zeilen[tabelle] ?? [] }),
        maybeSingle: () => Promise.resolve({ data: (zeilen[tabelle] ?? [])[0] ?? null }),
        upsert: (w: unknown) => {
          geschrieben.push(w)
          return Promise.resolve({ error: null })
        },
      }
      return kette
    },
  }
}

Deno.test('namensHinweis: Mayer-Bot nur Team, ohne sich selbst', async () => {
  const db = doppel({ mitarbeiter: [{ name: 'Max Muster', email: 'max@beispiel.de' }, { name: 'Ich Selbst', email: 'ich@beispiel.de' }] })
  assertEquals(await namensHinweis(db, { email: 'ich@beispiel.de' }, false), 'Namen: Max Muster.')
})

Deno.test('namensHinweis: privat mit Kontakten und Zwischenspeicher, frischt alten Stand auf', async () => {
  const db = doppel({
    kunden: [{ firma: null, ansprechpartner: 'Erika Beispiel' }],
    privat_einstellungen: [{ briefing: { abschriftNamen: { stand: '2026-11-01T00:00:00Z', namen: ['Paul Probe'] } } }],
    mitarbeiter: [],
  })
  let aufgefrischt = 0
  const text = await namensHinweis(db, { email: 'ich@beispiel.de' }, true, async () => [], () => aufgefrischt++, new Date('2026-11-23T10:00:00Z'))
  assertEquals(text, 'Namen: Erika Beispiel, Paul Probe.')
  assertEquals(aufgefrischt, 1)
})

Deno.test('namensHinweis: frischer Stand wird nicht neu geholt; Fehler ergeben leeren Text', async () => {
  const db = doppel({ kunden: [], privat_einstellungen: [{ briefing: { abschriftNamen: { stand: '2026-11-23T09:00:00Z', namen: [] } } }], mitarbeiter: [] })
  let aufgefrischt = 0
  await namensHinweis(db, { email: 'ich@beispiel.de' }, true, async () => [], () => aufgefrischt++, new Date('2026-11-23T10:00:00Z'))
  assertEquals(aufgefrischt, 0)
  const kaputt = { from() { throw new Error('weg') } }
  assertEquals(await namensHinweis(kaputt, { email: 'ich@beispiel.de' }, true), '')
})

Deno.test('frischeMailPartner: speichert Namen und behält andere Einstellungen', async () => {
  const geschrieben: Record<string, unknown>[] = []
  const db = doppel({ privat_einstellungen: [{ briefing: { morgenplan: false } }] }, geschrieben)
  const namen = await frischeMailPartner(db, 'ich@beispiel.de', async (_ich, ordner) =>
    ordner === 'sentitems' ? [{ von: { name: 'Ich', adresse: 'ich@beispiel.de' }, an: [{ name: 'Max Muster', adresse: 'max@beispiel.de' }] }] : [], new Date('2026-11-23T10:00:00Z'))
  assertEquals(namen, ['Max Muster'])
  // deno-lint-ignore no-explicit-any
  const b = (geschrieben[0] as any).briefing
  assertEquals(b.morgenplan, false)
  assertEquals(b.abschriftNamen.namen, ['Max Muster'])
})
