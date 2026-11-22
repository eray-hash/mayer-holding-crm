// Prüft den „Tipp der Woche“ (neuigkeitenTipp.ts) mit der Testdatenbank (ohne Netz): Zeitfenster, Auswahl nach
// Bereich/Geschäftsführung/Schwerpunkt, Gelesenes und schon Geschicktes, Schalter (keine Zeile = an), höchstens
// einmal pro Woche auch bei gleichzeitigen Läufen, Text mit Link und Telegram-Beispiel.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { crmAdresse, istRelevant, sortiereNeuigkeiten, tippText } from '../_shared/neuigkeitenKern.ts'
import { imTippFenster, pruefeNeuigkeitenTipps } from './neuigkeitenTipp.ts'

// Dienstag, 24.11.2026, 10:05 Berliner Zeit (= 09:05 UTC, Winterzeit).
const DIENSTAG_10 = new Date('2026-11-24T09:05:00Z')
const DIENSTAG_9 = new Date('2026-11-24T08:59:00Z')
const DIENSTAG_12 = new Date('2026-11-24T11:00:00Z')
const MITTWOCH_10 = new Date('2026-11-25T09:05:00Z')
const NAECHSTER_DIENSTAG = new Date('2026-12-01T09:05:00Z')

const N = (id: string, bereiche: string[], rang = 50, datum = '2026-11-22', extra: Record<string, unknown> = {}) => ({
  id, datum, titel: `Titel ${id}`, text: `Text zu ${id}.`, bereiche, link: '/partner', telegram_beispiel: `Beispiel ${id}`, rang, aktiv: true, ...extra,
})

function daten(extra: Record<string, Record<string, unknown>[]> = {}) {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: 'Quirin Lutzenberger', email: 'quirin@mayer.de', rolle: 'mitarbeiter', ist_admin: false, aktiv: true, bereiche: ['immobilien'], telegram_chat_id: 11 },
      { id: 'm2', name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: true, aktiv: true, bereiche: [], telegram_chat_id: 22 },
      { id: 'm3', name: 'Ohne Telegram', email: 'ohne@mayer.de', rolle: 'mitarbeiter', ist_admin: false, aktiv: true, bereiche: ['immobilien'], telegram_chat_id: null },
      { id: 'm4', name: 'Alt', email: 'alt@mayer.de', rolle: 'mitarbeiter', ist_admin: false, aktiv: false, bereiche: ['immobilien'], telegram_chat_id: 44 },
    ],
    neuigkeiten: [
      N('gf-rueckblick', ['geschaeftsfuehrung'], 10),
      N('beratung-x', ['beratung'], 5),
      N('alle-suche', ['alle'], 20),
      N('immo-portal', ['immobilien'], 30),
      N('aus', ['alle'], 1, '2026-11-22', { aktiv: false }),
    ],
    neuigkeiten_gelesen: [],
    neuigkeiten_einstellung: [],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.example/' }],
    ...extra,
  })
}

function sammler() {
  const gesendet: { chat: number | string; text: string }[] = []
  return { gesendet, sende: async (chat: number | string, text: string) => (gesendet.push({ chat, text }), true) }
}

Deno.test('Zeitfenster: nur dienstags 10:00 bis 11:59 Berliner Zeit', () => {
  assert(imTippFenster(DIENSTAG_10))
  assert(!imTippFenster(DIENSTAG_9))
  assert(!imTippFenster(DIENSTAG_12))
  assert(!imTippFenster(MITTWOCH_10))
})

Deno.test('außerhalb des Fensters kein Datenbankzugriff', async () => {
  const db = daten()
  const s = sammler()
  const r = await pruefeNeuigkeitenTipps(db, s.sende, MITTWOCH_10)
  assertEquals(r, { gelaufen: false, gesendet: 0, meldungen: [] })
  assertEquals(db.protokoll.length, 0)
})

Deno.test('Relevanz: alle, Geschäftsführung, Bereiche', () => {
  const quirin = { rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }
  const gf = { rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
  assert(istRelevant({ bereiche: ['alle'] }, quirin))
  assert(istRelevant({ bereiche: ['immobilien'] }, quirin))
  assert(istRelevant({ bereiche: ['immobilien'] }, { ...quirin, bereiche: ['immobilienkunden'] }))
  assert(istRelevant({ bereiche: [] }, quirin))
  assert(!istRelevant({ bereiche: ['beratung'] }, quirin))
  assert(!istRelevant({ bereiche: ['geschaeftsfuehrung'] }, quirin))
  assert(istRelevant({ bereiche: ['geschaeftsfuehrung'] }, gf))
  assert(istRelevant({ bereiche: ['beratung'] }, gf))
  assert(istRelevant({ bereiche: ['geschaeftsfuehrung', 'immobilien'] }, quirin))
})

Deno.test('Reihenfolge: Schwerpunkt vor Rang vor Datum', () => {
  const l = [N('a', ['beratung'], 1), N('b', ['immobilien'], 40), N('c', ['alle'], 1, '2026-11-23')]
  assertEquals(sortiereNeuigkeiten(l).map((n) => n.id), ['c', 'a', 'b'])
  assertEquals(sortiereNeuigkeiten(l, ['immobilien']).map((n) => n.id), ['b', 'c', 'a'])
})

Deno.test('je Person genau ein passender Tipp; keine Zeile = an; ohne Telegram und Inaktive nichts', async () => {
  const db = daten()
  const s = sammler()
  const r = await pruefeNeuigkeitenTipps(db, s.sende, DIENSTAG_10)
  assertEquals(r.gesendet, 2)
  assertEquals(r.meldungen, [])
  const anQuirin = s.gesendet.find((g) => g.chat === 11)!
  const anAndreas = s.gesendet.find((g) => g.chat === 22)!
  // Quirin: Beratung und Geschäftsführung gelten nicht, „aus“ ist abgeschaltet → „alle-suche“ (Rang 20).
  assertStringIncludes(anQuirin.text, 'Tipp der Woche aus dem CRM: Titel alle-suche')
  assertStringIncludes(anQuirin.text, 'Noch eine weitere Neuigkeit für dich')
  // Andreas (Geschäftsführung): bester Rang ist beratung-x (5).
  assertStringIncludes(anAndreas.text, 'Titel beratung-x')
  assertStringIncludes(anAndreas.text, 'Noch 3 weitere Neuigkeiten')
  assertStringIncludes(anAndreas.text, '„Beispiel beratung-x“')
  assertStringIncludes(anAndreas.text, 'Im CRM: https://crm.example/#/partner')
  const einst = db.tabellen.neuigkeiten_einstellung
  assertEquals(einst.length, 2)
  const q = einst.find((e) => e.email === 'quirin@mayer.de')!
  assertEquals(q.letzte_woche, '2026-11-24')
  assertEquals(q.gesendete_tipps, ['alle-suche'])
})

Deno.test('höchstens einmal pro Woche, nächste Woche der nächste Tipp', async () => {
  const db = daten()
  const s = sammler()
  await pruefeNeuigkeitenTipps(db, s.sende, DIENSTAG_10)
  const zweiter = await pruefeNeuigkeitenTipps(db, s.sende, new Date('2026-11-24T09:30:00Z'))
  assertEquals(zweiter.gesendet, 0)
  assertEquals(s.gesendet.length, 2)
  await pruefeNeuigkeitenTipps(db, s.sende, NAECHSTER_DIENSTAG)
  const quirin = s.gesendet.filter((g) => g.chat === 11)
  assertEquals(quirin.length, 2)
  assertStringIncludes(quirin[1].text, 'Titel immo-portal')
  // Der Tipp von letzter Woche ist noch ungelesen und zählt als „weitere“ mit.
  assertStringIncludes(quirin[1].text, 'Noch eine weitere Neuigkeit für dich')
  // Danach ist für Quirin nichts mehr offen: keine Nachricht, die Woche bleibt unberührt.
  await pruefeNeuigkeitenTipps(db, s.sende, new Date('2026-12-08T09:05:00Z'))
  assertEquals(s.gesendet.filter((g) => g.chat === 11).length, 2)
  assertEquals(db.tabellen.neuigkeiten_einstellung.find((e) => e.email === 'quirin@mayer.de')!.letzte_woche, '2026-12-01')
})

Deno.test('gleichzeitige Läufe: jeder bekommt nur eine Nachricht', async () => {
  const db = daten({
    neuigkeiten_einstellung: [
      { id: 'e1', email: 'quirin@mayer.de', telegram_tipp: true, letzte_woche: '2026-11-17', gesendete_tipps: [], schwerpunkte: [] },
      { id: 'e2', email: 'andreas@mayer.de', telegram_tipp: true, letzte_woche: null, gesendete_tipps: [], schwerpunkte: [] },
    ],
  })
  const s = sammler()
  const [a, b] = await Promise.all([pruefeNeuigkeitenTipps(db, s.sende, DIENSTAG_10), pruefeNeuigkeitenTipps(db, s.sende, DIENSTAG_10)])
  assertEquals(a.gesendet + b.gesendet, 2)
  assertEquals(s.gesendet.length, 2)
})

Deno.test('Gelesenes, schon Geschicktes, Schwerpunkt und Abgeschaltetes', async () => {
  const db = daten({
    neuigkeiten_gelesen: [{ id: 'g1', email: 'quirin@mayer.de', schluessel: 'alle-suche' }],
    neuigkeiten_einstellung: [
      { id: 'e1', email: 'quirin@mayer.de', telegram_tipp: true, letzte_woche: null, gesendete_tipps: [], schwerpunkte: ['immobilien'] },
      { id: 'e2', email: 'andreas@mayer.de', telegram_tipp: false, letzte_woche: null, gesendete_tipps: [], schwerpunkte: [] },
    ],
  })
  const s = sammler()
  const r = await pruefeNeuigkeitenTipps(db, s.sende, DIENSTAG_10)
  assertEquals(r.gesendet, 1)
  assertEquals(s.gesendet[0].chat, 11)
  assertStringIncludes(s.gesendet[0].text, 'Titel immo-portal')
  assertEquals(db.tabellen.neuigkeiten_einstellung.find((e) => e.email === 'andreas@mayer.de')!.letzte_woche, null)

  const db2 = daten({
    neuigkeiten_einstellung: [{ id: 'e1', email: 'quirin@mayer.de', telegram_tipp: true, letzte_woche: '2026-11-17', gesendete_tipps: ['alle-suche'], schwerpunkte: [] }],
  })
  const s2 = sammler()
  await pruefeNeuigkeitenTipps(db2, s2.sende, DIENSTAG_10)
  assertStringIncludes(s2.gesendet.find((g) => g.chat === 11)!.text, 'Titel immo-portal')
  assertEquals(db2.tabellen.neuigkeiten_einstellung.find((e) => e.email === 'quirin@mayer.de')!.gesendete_tipps, ['alle-suche', 'immo-portal'])
})

Deno.test('fehlende Einstellungstabelle: nichts senden, Meldung', async () => {
  const db = daten()
  const original = db.from.bind(db)
  // deno-lint-ignore no-explicit-any
  ;(db as any).from = (t: string) => {
    if (t !== 'neuigkeiten_einstellung') return original(t)
    return { select: () => Promise.resolve({ data: null, error: { message: 'relation does not exist' } }) }
  }
  const s = sammler()
  const r = await pruefeNeuigkeitenTipps(db, s.sende, DIENSTAG_10)
  assertEquals(r.gesendet, 0)
  assertEquals(s.gesendet.length, 0)
  assertStringIncludes(r.meldungen.join(' '), 'neuigkeiten_einstellung')
})

Deno.test('fehlgeschlagener Versand wird gemeldet, die Woche gilt trotzdem (keine Wiederholungsflut)', async () => {
  const db = daten()
  const r = await pruefeNeuigkeitenTipps(db, async () => false, DIENSTAG_10)
  assertEquals(r.gesendet, 0)
  assertEquals(r.meldungen.length, 2)
  const r2 = await pruefeNeuigkeitenTipps(db, async () => true, new Date('2026-11-24T09:06:00Z'))
  assertEquals(r2.gesendet, 0)
})

Deno.test('Adressen und Text', () => {
  assertEquals(crmAdresse('https://x.de/crm', '/partner'), 'https://x.de/crm/#/partner')
  assertEquals(crmAdresse('https://x.de/crm/', './gespraech/'), 'https://x.de/crm/gespraech/')
  assertEquals(crmAdresse('https://x.de/', null), 'https://x.de/#/neuigkeiten')
  const t = tippText({ titel: 'T', text: 'Satz.', link: null, telegram_beispiel: null }, 'https://x.de/', 0)
  assert(!t.includes('Im CRM:'))
  assert(!t.includes('zum Beispiel'))
  assertStringIncludes(t, 'Tipp der Woche aus')
})
