// Test: Ein einmal gespeicherter Microsoft-Fehler bleibt nicht für immer stehen — der nächste erfolgreiche Abruf
// löscht ihn und setzt letzter_erfolg. Falsches Microsoft und Datenbank im Speicher, ohne Netz.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { graph, vergissErfolgsVermerke } from './microsoft.ts'
import { falscheDatenbank, falschesMicrosoft, jsonAntwort, verbundenesKonto } from './testDoppel.ts'

Deno.test('Microsoft: Störung wird vermerkt, der nächste Erfolg löscht den Vermerk', async () => {
  vergissErfolgsVermerke()
  const db = falscheDatenbank()
  await verbundenesKonto(db, 'hasan@example.de')
  let stoerung = true
  const zurueck = falschesMicrosoft((a) => (a.weg === '/me' ? (stoerung ? jsonAntwort({ error: { message: 'Dienst nicht verfügbar' } }, 500) : { id: 'ich' }) : undefined))
  try {
    await graph(db, 'hasan@example.de', '/me').catch(() => undefined)
    assertEquals(db.tabelle('ms_konten')[0].letzter_fehler, 'Dienst nicht verfügbar')
    stoerung = false
    await graph(db, 'hasan@example.de', '/me')
    const konto = db.tabelle('ms_konten')[0]
    assertEquals(konto.letzter_fehler, null)
    assert(konto.letzter_erfolg, 'letzter_erfolg fehlt')
  } finally {
    zurueck()
    vergissErfolgsVermerke()
  }
})

Deno.test('Microsoft: Erfolg wird höchstens alle fünf Minuten geschrieben', async () => {
  vergissErfolgsVermerke()
  const db = falscheDatenbank()
  await verbundenesKonto(db, 'hasan@example.de')
  const zurueck = falschesMicrosoft((a) => (a.weg === '/me' ? { id: 'ich' } : undefined))
  try {
    for (let i = 0; i < 5; i++) await graph(db, 'hasan@example.de', '/me')
    const schreibzugriffe = db.protokoll.filter((p) => p.tabelle === 'ms_konten' && p.art === 'update')
    assertEquals(schreibzugriffe.length, 1)
  } finally {
    zurueck()
    vergissErfolgsVermerke()
  }
})
