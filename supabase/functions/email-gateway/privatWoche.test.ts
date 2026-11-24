// Prüft privatWoche.ts ohne Netz: Briefing-Fenster (Sommer/Winter), Personenerkennung, nur private Termine, kein
// Doppelversand, Einstellungen aus, Sonntag ja / Samstag nein, keine Nachricht ohne Inhalt, Einstellungs-Rückweg.
// Alle Namen und Adressen sind ausgedacht.
import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { fuehrePersonWerkzeugAus, type HotmailAufruf } from '../telegram-gateway/personUeberblick.ts'
import type { PlanSenden } from './privatTagesplan.ts'
import {
  BRIEFING_AUS_SATZ,
  briefingKennung,
  briefingText,
  type BriefingTermin,
  erkennePerson,
  personAusTitel,
  type PersonNachschlagen,
  sendePrivatTerminBriefings,
  sendePrivatWochenrueckblicke,
  setzeWochenEinstellung,
  verdichteUeberblick,
  WOCHE_AUS_SATZ,
  wochenEinstellung,
  wochenFenster,
  wochenKennung,
  wochenrueckblickText,
} from './privatWoche.ts'

const ICH = 'privat.person@beispiel.de'
const ICH_MS = 'privat.person@hotmail.example'
const KOLLEGE = 'kollege@firma.example'
// November: Berlin = UTC+1. 2026-11-24 ist ein Dienstag, 2026-11-29 ein Sonntag, 2026-11-28 ein Samstag.
const JETZT = new Date('2026-11-24T13:00:00.000Z') // Dienstag 14:00 Berlin
const SO = '2026-11-29'
const SO_ABEND = new Date('2026-11-29T17:05:00Z') // Sonntag 18:05 Berlin

function termin(id: string, titel: string, beginn: string, extra: Zeile = {}): Zeile {
  const ende = new Date(new Date(beginn).getTime() + 3600_000).toISOString()
  return { id, titel, ort: null, beschreibung: null, beginn, ende, ganztags: false, teilnehmer: [], kunde_id: null, kunde_bereich: null, besitzer_email: ICH, ms_teilnehmer: [], ...extra }
}

function welt(extra: Record<string, Zeile[]> = {}): FalscheDatenbank {
  return falscheDatenbank({
    mitarbeiter: [
      { id: 'm1', name: 'Paul Privat', email: ICH, telegram_chat_id: 222, aktiv: true },
      { id: 'm2', name: 'Karl Kollege', email: KOLLEGE, telegram_chat_id: 333, aktiv: true },
      { id: 'm3', name: 'Ohne Telegram', email: 'ohne@firma.example', telegram_chat_id: null, aktiv: true },
    ],
    privat_einstellungen: [{ login_email: ICH, briefing: { privatBot: true } }],
    ms_konten: [{ login_email: ICH, ms_adresse: ICH_MS }],
    termine: [
      // In 30 Minuten, Outlook-Teilnehmer: er selbst (Hotmail) und eine fremde Person.
      termin('tm_outlook', 'Kaufvertrag besprechen', '2026-11-24T13:30:00.000Z', { ort: 'Café am Markt', ms_teilnehmer: [{ name: 'Paul Privat', email: ICH_MS }, { name: 'Erika Muster', email: 'erika@muster.example' }] }),
      // In 35 Minuten, Person nur im Titel.
      termin('tm_titel', 'Treffen mit Herrn Dr. Beispiel', '2026-11-24T13:35:00.000Z'),
      // In 30 Minuten, aber ohne erkennbare Person.
      termin('tm_zahnarzt', 'Zahnarzt', '2026-11-24T13:30:00.000Z'),
      // In 30 Minuten, aber mit Kollege im CRM bzw. mit Mayer-Akte bzw. ganztags bzw. abgesagt bzw. fremder Besitzer.
      termin('tm_team', 'Termin mit Frau Muster', '2026-11-24T13:30:00.000Z', { teilnehmer: [KOLLEGE] }),
      termin('tm_mayer', 'Termin mit Frau Muster', '2026-11-24T13:30:00.000Z', { kunde_id: 'k1', kunde_bereich: 'beratung' }),
      termin('tm_ganztags', 'Termin mit Frau Muster', '2026-11-24T13:30:00.000Z', { ganztags: true }),
      termin('tm_abgesagt', 'Abgesagt: Termin mit Frau Muster', '2026-11-24T13:30:00.000Z'),
      termin('tm_fremd', 'Termin mit Frau Muster', '2026-11-24T13:30:00.000Z', { besitzer_email: KOLLEGE }),
      // Nur Kollege als Outlook-Teilnehmer — keine fremde Person.
      termin('tm_nur_kollege', 'Abstimmung', '2026-11-24T13:30:00.000Z', { ms_teilnehmer: [{ name: 'Karl Kollege', email: KOLLEGE }] }),
      // Außerhalb des Fensters (in 20 bzw. 45 Minuten).
      termin('tm_zu_frueh', 'Termin mit Frau Früh', '2026-11-24T13:20:00.000Z'),
      termin('tm_zu_spaet', 'Termin mit Frau Spät', '2026-11-24T13:45:00.000Z'),
    ],
    ...extra,
  })
}

type Gesendet = { chat: number | string; text: string; extra?: Record<string, unknown> }
function sender(ok = true): PlanSenden & { gesendet: Gesendet[] } {
  const gesendet: Gesendet[] = []
  const f = ((chat, text, extra) => {
    gesendet.push({ chat, text, extra })
    return Promise.resolve(ok)
  }) as PlanSenden & { gesendet: Gesendet[] }
  f.gesendet = gesendet
  return f
}

/** Nachschlagen-Doppel: merkt sich die Suchbegriffe, liefert einen festen Text. */
function nachschlager(antwort = 'Person: X\nMails mit ihr/ihm: keine gefunden\n\nVollständig: ja.'): PersonNachschlagen & { begriffe: string[] } {
  const begriffe: string[] = []
  const f = ((_a: unknown, _e: string, suche: string) => {
    begriffe.push(suche)
    return Promise.resolve(antwort)
  }) as PersonNachschlagen & { begriffe: string[] }
  f.begriffe = begriffe
  return f
}

const nurIch = { privatAktiv: (e: string) => Promise.resolve(e === ICH) }

// ---------------------------------------------------------------------------------------------
// Personenerkennung
// ---------------------------------------------------------------------------------------------

Deno.test('Personenerkennung im Titel: mit Anrede, „mit X Y“, „Termin X“; Sachwörter und Kollegen zählen nicht', () => {
  assertEquals(personAusTitel('Treffen mit Herrn Dr. Beispiel'), { suche: 'Beispiel', anzeige: 'Herr Beispiel' })
  assertEquals(personAusTitel('Kaufvertrag mit Frau Muster besprechen'), { suche: 'Muster', anzeige: 'Frau Muster' })
  assertEquals(personAusTitel('Rückruf Frau Muster'), { suche: 'Muster', anzeige: 'Frau Muster' })
  assertEquals(personAusTitel('Essen mit Erika Muster'), { suche: 'Erika Muster', anzeige: 'Erika Muster' })
  assertEquals(personAusTitel('Termin Muster wegen Haus'), { suche: 'Muster', anzeige: 'Muster' })
  assertEquals(personAusTitel('Termin: Muster'), { suche: 'Muster', anzeige: 'Muster' })
  assertEquals(personAusTitel('Telefonat mit Herrn Muster Kaufvertrag')?.suche, 'Muster')
  assertEquals(personAusTitel('Dr. Beispiel Kontrolle')?.anzeige, 'Dr. Beispiel')
  // Keine Person:
  assertEquals(personAusTitel('Zahnarzt'), null)
  assertEquals(personAusTitel('Termin Zahnarzt'), null)
  assertEquals(personAusTitel('Termin Finanzamt'), null)
  assertEquals(personAusTitel('Essen mit Familie'), null)
  assertEquals(personAusTitel('Treffen mit der Bank'), null)
  assertEquals(personAusTitel('Besprechung Kaufvertrag'), null)
  assertEquals(personAusTitel('Elternabend'), null)
  assertEquals(personAusTitel(''), null)
  // Kollegen und er selbst:
  assertEquals(personAusTitel('Termin mit Karl', ['Karl Kollege', 'Paul Privat']), null)
  assertEquals(personAusTitel('Termin mit Herrn Kollege', ['Karl Kollege']), null)
})

Deno.test('Personenerkennung im Termin: Outlook-Teilnehmer vor Titel, ohne eigene Adressen und Kollegen', () => {
  const eigene = new Set([ICH, ICH_MS])
  const team = new Set([ICH, KOLLEGE])
  const t = (extra: Partial<BriefingTermin>): BriefingTermin => ({ id: 'x', titel: 'Abstimmung', beginn: '2026-11-24T13:30:00Z', besitzer_email: ICH, ...extra })
  assertEquals(erkennePerson(t({ ms_teilnehmer: [{ name: 'Paul Privat', email: ICH_MS }, { name: 'Erika Muster', email: 'Erika@Muster.example' }, { name: 'Max Beispiel', email: 'max@beispiel.example' }] }), eigene, team), {
    suche: 'Erika Muster erika@muster.example',
    anzeige: 'Erika Muster',
    weitere: 1,
  })
  // Ohne Namen: Adresse wird angezeigt.
  assertEquals(erkennePerson(t({ ms_teilnehmer: [{ name: '', email: 'erika@muster.example' }] }), eigene, team), { suche: 'erika@muster.example', anzeige: 'erika@muster.example', weitere: 0 })
  // Nur er selbst und ein Kollege → Titel entscheidet; „Abstimmung“ ist keine Person.
  assertEquals(erkennePerson(t({ ms_teilnehmer: [{ name: 'Paul Privat', email: ICH_MS }, { name: 'Karl Kollege', email: KOLLEGE }] }), eigene, team), null)
  // Titel als Ersatz.
  assertEquals(erkennePerson(t({ titel: 'Treffen mit Frau Muster', ms_teilnehmer: [] }), eigene, team)?.suche, 'Muster')
  // Teilnehmer nur mit Namen.
  assertEquals(erkennePerson(t({ ms_teilnehmer: [{ name: 'Erika Muster', email: '' }] }), eigene, team)?.suche, 'Erika Muster')
  assertEquals(erkennePerson(t({ ms_teilnehmer: [] }), eigene, team), null)
})

// ---------------------------------------------------------------------------------------------
// Verdichten (gegen die echte Personen-Übersicht mit Doppeln)
// ---------------------------------------------------------------------------------------------

/** Kleines Datenbank-Doppel mit ilike (wie in personUeberblick.test.ts). */
function ilikeDb(tabellen: Record<string, Zeile[]>) {
  const passt = (z: Zeile, f: { op: string; spalte: string; wert: unknown }) => {
    const v = z[f.spalte]
    if (f.op === 'eq') return v != null && String(v) === String(f.wert)
    if (f.op === 'ilike') return typeof v === 'string' && v.toLowerCase() === String(f.wert).toLowerCase()
    if (f.op === 'is') return f.wert === null ? v == null : v === f.wert
    if (f.op === 'in') return (f.wert as unknown[]).some((w) => String(w) === String(v))
    throw new Error(`Operator ${f.op} fehlt im Doppel`)
  }
  return {
    from(tabelle: string) {
      const filter: { op: string; spalte: string; wert: unknown }[] = []
      let einzel = false
      const q = {
        select: () => q,
        eq: (spalte: string, wert: unknown) => (filter.push({ op: 'eq', spalte, wert }), q),
        ilike: (spalte: string, wert: unknown) => (filter.push({ op: 'ilike', spalte, wert }), q),
        is: (spalte: string, wert: unknown) => (filter.push({ op: 'is', spalte, wert }), q),
        in: (spalte: string, wert: unknown[]) => (filter.push({ op: 'in', spalte, wert }), q),
        order: () => q,
        maybeSingle: () => ((einzel = true), q),
        then: (ok: (r: { data: unknown; error: null }) => unknown, nein?: (e: unknown) => unknown) => {
          const zeilen = (tabellen[tabelle] ?? []).filter((z) => filter.every((f) => passt(z, f)))
          return Promise.resolve({ data: einzel ? zeilen[0] ?? null : structuredClone(zeilen), error: null }).then(ok, nein)
        },
      }
      return q
    },
  }
}

const ERIKA = { name: 'Erika Muster', adresse: 'erika@muster.example' }
const ICH_T = { name: 'Paul Privat', adresse: ICH_MS }
function hotmailMail(id: string, von: { name: string; adresse: string }, an: { name: string; adresse: string }, betreff: string, datum: string) {
  return { id, von, an: [an], cc: [], betreff, datum, hatAnhaenge: id === 'h1', vorschau: '' }
}
const hotmail: HotmailAufruf = (body) => {
  const mails = String(body.begriff).toLowerCase() === 'erika@muster.example'
    ? [
      hotmailMail('h1', ERIKA, ICH_T, 'Unterlagen zum Kaufvertrag', '2026-11-20T08:00:00Z'),
      hotmailMail('h2', ICH_T, ERIKA, 'Re: Termin nächste Woche', '2026-11-18T08:00:00Z'),
      hotmailMail('h3', ERIKA, ICH_T, 'Grundbuchauszug', '2026-10-02T08:00:00Z'),
      hotmailMail('h4', ICH_T, ERIKA, 'Erste Anfrage', '2025-12-01T08:00:00Z'),
    ]
    : []
  return Promise.resolve({ ok: true, status: 200, daten: { mails, ausgeblendet: 0, mehr: false } })
}
const PERSON_DATEN: Record<string, Zeile[]> = {
  ms_konten: [{ login_email: ICH, ms_adresse: ICH_MS }],
  kunden: [{ id: 'k_erika', firma: null, ansprechpartner: 'Erika Muster', email: 'erika@muster.example', telefon: null, activities: [{ id: 'a1', date: '2026-11-15', text: 'Will bis Jahresende verkaufen' }], dokumente: [], bereich: 'privat', verantwortlich_email: ICH }],
  termine: [],
  todos: [
    { id: 'td1', aufgabe: 'Erika Muster Grundbuch schicken', kunde_projekt: null, aktueller_stand: null, erledigt_am: null, erledigen_bis: '2026-11-30', besitzer_email: ICH, bereich: null },
    { id: 'td2', aufgabe: 'Erika Muster anrufen', kunde_projekt: null, aktueller_stand: null, erledigt_am: '2026-11-01', erledigen_bis: null, besitzer_email: ICH, bereich: null },
  ],
  protokolle: [],
  gesendete_emails: [],
  eingegangene_emails: [],
}

Deno.test('Verdichten der echten Personen-Übersicht: 3 letzte Mails mit Datum, offene To-dos, Notiz; Briefing ≤ 10 Zeilen', async () => {
  const roh = await fuehrePersonWerkzeugAus('person_ueberblick', { name: 'Erika Muster erika@muster.example', nur: 'alles' }, { supabase: ilikeDb(PERSON_DATEN), mitarbeiter: { email: ICH }, protokolliere: () => {}, hotmail, outlookVerbunden: true })
  const v = verdichteUeberblick(roh)
  assertEquals(v.mailAnzahl, 4)
  assertEquals(v.mails.slice(0, 3).map((m) => `${m.datum} ${m.richtung} ${m.betreff}`), [
    '20.11.2026 an dich Unterlagen zum Kaufvertrag',
    '18.11.2026 von dir Re: Termin nächste Woche',
    '02.10.2026 an dich Grundbuchauszug',
  ])
  assertEquals(v.todos.length, 1)
  assertStringIncludes(v.todos[0], 'Grundbuch schicken')
  assertFalse(v.todos[0].includes('todo_id'))
  assertEquals(v.notizen, [{ datum: '15.11.2026', text: 'Will bis Jahresende verkaufen' }])

  const t: BriefingTermin = { id: 'tm', titel: 'Kaufvertrag besprechen', ort: 'Café am Markt', beginn: '2026-11-24T13:30:00Z', ende: '2026-11-24T14:30:00Z', besitzer_email: ICH }
  const text = briefingText(t, { suche: 'Erika Muster erika@muster.example', anzeige: 'Erika Muster', weitere: 0 }, roh, JETZT)
  const zeilen = text.split('\n')
  assert(zeilen.length <= 10, text)
  assertEquals(zeilen[0], 'In 30 Min.: 14:30–15:30 Kaufvertrag besprechen (Café am Markt)')
  assertEquals(zeilen[1], 'Mit: Erika Muster')
  assertStringIncludes(text, 'Letzte Mails (von 4):')
  assertStringIncludes(text, '• 20.11. an dich: Unterlagen zum Kaufvertrag')
  assertFalse(text.includes('Erste Anfrage'))
  assertStringIncludes(text, '• Notiz 15.11.: Will bis Jahresende verkaufen')
  assertEquals(zeilen[zeilen.length - 1], BRIEFING_AUS_SATZ)
  assertFalse(text.includes('mail_id'))
})

Deno.test('Briefing-Text: nichts gefunden, mehrdeutig, Fehler beim Nachschlagen', () => {
  const t: BriefingTermin = { id: 'tm', titel: 'Treffen mit Herrn Beispiel', beginn: '2026-11-24T13:35:00Z', ende: null, besitzer_email: ICH }
  const p = { suche: 'Beispiel', anzeige: 'Herr Beispiel', weitere: 0 }
  assertStringIncludes(briefingText(t, p, 'Person: Beispiel\nMails mit ihr/ihm: keine gefunden\n\nVollständig: ja.', JETZT), 'Keine Mails, offenen To-dos oder Notizen mit ihr/ihm gefunden.')
  assertStringIncludes(briefingText(t, p, 'Mehrdeutig: Zu „Beispiel“ passen 2 verschiedene Personen:\n1. …', JETZT), 'mehreren Personen')
  assertStringIncludes(briefingText(t, p, null, JETZT), 'nicht gelesen werden')
  assertStringIncludes(briefingText(t, p, null, JETZT), 'In 35 Min.: 14:35 Treffen mit Herrn Beispiel')
})

// ---------------------------------------------------------------------------------------------
// Briefing-Lauf
// ---------------------------------------------------------------------------------------------

Deno.test('Briefing: nur private Termine mit erkennbarer Person in 25–40 Minuten, über den privaten Bot', async () => {
  const db = welt()
  const s = sender()
  const n = nachschlager()
  const r = await sendePrivatTerminBriefings(db, JETZT, s, { ...nurIch, nachschlagen: n })
  assertEquals(r.fehler, [])
  assertEquals(r.gesendet, 2)
  assertEquals(n.begriffe, ['Erika Muster erika@muster.example', 'Beispiel'])
  assertEquals(s.gesendet.map((g) => g.chat), [222, 222])
  assertStringIncludes(s.gesendet[0].text, 'In 30 Min.: 14:30–15:30 Kaufvertrag besprechen (Café am Markt)')
  assertStringIncludes(s.gesendet[0].text, 'Mit: Erika Muster')
  assertStringIncludes(s.gesendet[1].text, 'Mit: Herr Beispiel')
  for (const g of s.gesendet) assert(g.text.endsWith(BRIEFING_AUS_SATZ))
  // Sperrzeilen mit art 'morgen' und eigener Kennung.
  const sperren = db.tabellen.tagesplan_meldungen
  assertEquals(sperren.map((z) => z.id).sort(), [briefingKennung('tm_outlook'), briefingKennung('tm_titel')])
  assert(sperren.every((z) => z.art === 'morgen' && z.zugestellt === true && z.email === ICH))
})

Deno.test('Briefing: kein Doppelversand beim nächsten Takt', async () => {
  const db = welt()
  const s = sender()
  await sendePrivatTerminBriefings(db, JETZT, s, { ...nurIch, nachschlagen: nachschlager() })
  const r = await sendePrivatTerminBriefings(db, new Date(JETZT.getTime() + 60_000), s, { ...nurIch, nachschlagen: nachschlager() })
  assertEquals(r.gesendet, 0)
  assertEquals(s.gesendet.length, 2)
})

Deno.test('Briefing: Sommerzeit — Uhrzeit in Berliner Zeit', async () => {
  const sommer = new Date('2026-07-14T12:00:00.000Z') // 14:00 Berlin (UTC+2)
  const db = welt({ termine: [termin('tm_s', 'Treffen mit Frau Muster', '2026-07-14T12:30:00.000Z')] })
  const s = sender()
  const r = await sendePrivatTerminBriefings(db, sommer, s, { ...nurIch, nachschlagen: nachschlager() })
  assertEquals(r.gesendet, 1)
  assertStringIncludes(s.gesendet[0].text, 'In 30 Min.: 14:30–15:30 Treffen mit Frau Muster')
})

Deno.test('Briefing: Einstellung aus, privater Bot nicht aktiv, ohne Schlüssel kein Datenbankzugriff', async () => {
  const aus = welt({ privat_einstellungen: [{ login_email: ICH, briefing: { privatBot: true, terminBriefing: false } }] })
  const s = sender()
  assertEquals((await sendePrivatTerminBriefings(aus, JETZT, s, { ...nurIch, nachschlagen: nachschlager() })).gesendet, 0)
  assertEquals(aus.tabellen.tagesplan_meldungen ?? [], [])

  const niemand = welt()
  assertEquals((await sendePrivatTerminBriefings(niemand, JETZT, s, { privatAktiv: () => Promise.resolve(false), nachschlagen: nachschlager() })).gesendet, 0)
  assertFalse(niemand.protokoll.some((p) => p.tabelle === 'termine'))

  const ohne = welt()
  const vorher = Deno.env.get('PRIVAT_TELEGRAM_BOT_TOKEN')
  Deno.env.delete('PRIVAT_TELEGRAM_BOT_TOKEN')
  try {
    await sendePrivatTerminBriefings(ohne, JETZT, s)
    assertEquals(ohne.protokoll.length, 0)
  } finally {
    if (vorher) Deno.env.set('PRIVAT_TELEGRAM_BOT_TOKEN', vorher)
  }
  assertEquals(s.gesendet.length, 0)
})

Deno.test('Briefing: Nachschlagen wirft → Briefing trotzdem mit Hinweis; Senden scheitert → nicht wiederholt', async () => {
  const db = welt({ termine: [termin('tm_x', 'Treffen mit Frau Muster', '2026-11-24T13:30:00.000Z')] })
  const s = sender(false)
  const r = await sendePrivatTerminBriefings(db, JETZT, s, { ...nurIch, nachschlagen: () => Promise.reject(new Error('Hotmail weg')) })
  assertEquals(s.gesendet.length, 1)
  assertStringIncludes(s.gesendet[0].text, 'nicht gelesen werden')
  assertEquals(r.gesendet, 0)
  assert(r.fehler.some((f) => f.includes('Hotmail weg')))
  assert(r.fehler.some((f) => f.includes('nicht zugestellt')))
  assertEquals(db.tabellen.tagesplan_meldungen[0].zugestellt, false)
  await sendePrivatTerminBriefings(db, JETZT, s, { ...nurIch, nachschlagen: nachschlager() })
  assertEquals(s.gesendet.length, 1)
})

// ---------------------------------------------------------------------------------------------
// Wochenrückblick
// ---------------------------------------------------------------------------------------------

function todo(id: string, aufgabe: string, extra: Zeile = {}): Zeile {
  return { id, aufgabe, prio: null, erledigen_bis: null, geplante_wiedervorlage: null, erledigt_am: null, kunde_projekt: null, aktueller_stand: 'x', besitzer_email: ICH, bereich: null, ms_id: null, ms_liste_id: null, erstellt_am: '2026-11-01', ...extra }
}

function wochenWelt(extra: Record<string, Zeile[]> = {}): FalscheDatenbank {
  return welt({
    todos: [
      todo('e1', 'Steuererklärung abgegeben', { erledigt_am: '2026-11-24' }),
      todo('e2', 'Auto angemeldet', { erledigt_am: '2026-11-29' }),
      todo('e3', 'Alt erledigt', { erledigt_am: '2026-11-20' }), // Vorwoche
      todo('e4', 'Mayer erledigt', { erledigt_am: '2026-11-25', bereich: 'beratung' }),
      todo('o1', 'Überfällig A', { erledigen_bis: '2026-11-20', prio: 'A' }),
      todo('o2', 'Überfällig B', { erledigen_bis: '2026-11-10', prio: 'B' }),
      todo('o3', 'Heute fällig', { erledigen_bis: SO }),
      todo('o4', 'Überfällig ohne Prio', { erledigen_bis: '2026-11-01' }),
      todo('n1', 'Nächste Woche Mittwoch', { erledigen_bis: '2026-12-02', prio: 'C' }),
      todo('n2', 'Nächste Woche Montag', { erledigen_bis: '2026-11-30' }),
      todo('n3', 'Übernächste Woche', { erledigen_bis: '2026-12-10' }),
      todo('f1', 'Fremde Aufgabe', { erledigen_bis: '2026-11-30', besitzer_email: KOLLEGE }),
    ],
    termine: [
      termin('w1', 'Zahnarzt', '2026-11-30T08:00:00.000Z', { ort: 'Neu-Ulm' }),
      termin('w2', 'Treffen mit Frau Muster', '2026-11-30T13:00:00.000Z'),
      termin('w3', 'Familienfest', '2026-12-05T00:00:00.000Z', { ganztags: true }),
      termin('w_team', 'Teamrunde', '2026-12-01T09:00:00.000Z', { teilnehmer: [KOLLEGE] }),
      termin('w_mayer', 'Mayer-Kunde', '2026-12-01T10:00:00.000Z', { kunde_id: 'k1', kunde_bereich: 'beratung' }),
      termin('w_alt', 'Diese Woche', '2026-11-27T10:00:00.000Z'),
      termin('w_spaet', 'Übernächste Woche', '2026-12-07T10:00:00.000Z'),
    ],
    ...extra,
  })
}

Deno.test('Wochenfenster: Sonntag 18:00–21:00 (Winter und Sommer), nicht Samstag', () => {
  assertEquals(wochenFenster(SO_ABEND), { datum: SO })
  assertEquals(wochenFenster(new Date('2026-11-29T16:59:00Z')), null) // 17:59
  assertEquals(wochenFenster(new Date('2026-11-29T17:00:00Z')), { datum: SO }) // 18:00
  assertEquals(wochenFenster(new Date('2026-11-29T19:59:00Z')), { datum: SO }) // 20:59
  assertEquals(wochenFenster(new Date('2026-11-29T20:00:00Z')), null) // 21:00
  assertEquals(wochenFenster(new Date('2026-11-28T17:30:00Z')), null) // Samstag 18:30
  // Sommerzeit: 18:00 Berlin = 16:00 UTC
  assertEquals(wochenFenster(new Date('2026-07-05T16:00:00Z')), { datum: '2026-07-05' })
  assertEquals(wochenFenster(new Date('2026-07-05T15:59:00Z')), null)
})

Deno.test('Wochenrückblick am Sonntag: erledigt, offen, nächste Woche nach Tag, Zusatzteil, einmal je Woche', async () => {
  const db = wochenWelt()
  const s = sender()
  const zusatz = [() => Promise.resolve(['Verträge — bald kündbar', '• Handyvertrag bis 15.12.']), () => Promise.reject(new Error('kaputt'))]
  const r = await sendePrivatWochenrueckblicke(db, SO_ABEND, s, { ...nurIch, zusatz })
  assertEquals(r.gesendet, 1)
  assertEquals(s.gesendet.length, 1)
  assertEquals(s.gesendet[0].chat, 222)
  const text = s.gesendet[0].text
  assertStringIncludes(text, 'Guten Abend Paul, dein Wochenrückblick (23.11.–29.11.):')
  assertStringIncludes(text, '✓ Diese Woche erledigt: 2')
  assertStringIncludes(text, '• Auto angemeldet\n• Steuererklärung abgegeben')
  assertFalse(text.includes('Alt erledigt'))
  assertFalse(text.includes('Mayer erledigt'))
  assertStringIncludes(text, 'Noch offen (davon 3 überfällig): 4')
  assertStringIncludes(text, '• Überfällig A')
  assertStringIncludes(text, '… und 1 weitere')
  assertStringIncludes(text, 'Nächste Woche (30.11.–06.12.):')
  assertStringIncludes(text, '• Mo 30.11.: 09:00 Zahnarzt (Neu-Ulm); 14:00 Treffen mit Frau Muster')
  assertStringIncludes(text, '• Sa 05.12.: ganztags Familienfest')
  assertFalse(text.includes('Teamrunde'))
  assertFalse(text.includes('Mayer-Kunde'))
  assertFalse(text.includes('Diese Woche\n'))
  assertFalse(text.includes('Übernächste Woche'))
  assertStringIncludes(text, 'Fällig:\n• Nächste Woche Montag – fällig morgen\n• Nächste Woche Mittwoch – fällig 02.12. · Prio C')
  assertFalse(text.includes('Fremde Aufgabe'))
  assertStringIncludes(text, 'Verträge — bald kündbar\n• Handyvertrag bis 15.12.')
  assert(text.endsWith(WOCHE_AUS_SATZ))
  assert(r.fehler.some((f) => f.includes('kaputt')))
  assertEquals(db.tabellen.tagesplan_meldungen.map((z) => [z.id, z.art, z.datum, z.zugestellt]), [[wochenKennung(ICH, SO), 'abend', SO, true]])

  // Nächster Takt: nichts mehr.
  const r2 = await sendePrivatWochenrueckblicke(db, new Date(SO_ABEND.getTime() + 60_000), s, nurIch)
  assertEquals(r2.gesendet, 0)
  assertEquals(s.gesendet.length, 1)
})

Deno.test('Wochenrückblick: Samstag nicht, außerhalb des Fensters kein Datenbankzugriff', async () => {
  const db = wochenWelt()
  const s = sender()
  await sendePrivatWochenrueckblicke(db, new Date('2026-11-28T17:30:00Z'), s, nurIch)
  await sendePrivatWochenrueckblicke(db, new Date('2026-11-29T12:00:00Z'), s, nurIch)
  assertEquals(db.protokoll.length, 0)
  assertEquals(s.gesendet.length, 0)
})

Deno.test('Wochenrückblick: Einstellung aus und ohne Inhalt keine Nachricht', async () => {
  const aus = wochenWelt({ privat_einstellungen: [{ login_email: ICH, briefing: { privatBot: true, wochenrueckblick: false } }] })
  const s = sender()
  const r = await sendePrivatWochenrueckblicke(aus, SO_ABEND, s, nurIch)
  assertEquals(r.gesendet, 0)
  assertEquals(aus.tabellen.tagesplan_meldungen ?? [], [])

  const leer = welt({ todos: [], termine: [] })
  const r2 = await sendePrivatWochenrueckblicke(leer, SO_ABEND, s, nurIch)
  assertEquals(r2.gesendet, 0)
  assertEquals(r2.leer, 1)
  assertEquals(s.gesendet.length, 0)
  assertEquals(wochenrueckblickText('Paul', { erledigt: [], faellig: [], termine: [], ausgeblendet: new Set() }, ICH, SO, [[], ['  ']]), null)
})

// ---------------------------------------------------------------------------------------------
// Einstellung
// ---------------------------------------------------------------------------------------------

Deno.test('Einstellung: fehlend = an, nur false = aus; setzen behält andere Schlüssel', async () => {
  assertEquals(wochenEinstellung(null), { terminBriefing: true, wochenrueckblick: true })
  assertEquals(wochenEinstellung({ terminBriefing: false }), { terminBriefing: false, wochenrueckblick: true })
  assertEquals(wochenEinstellung({ wochenrueckblick: 'nein' }), { terminBriefing: true, wochenrueckblick: true })

  const db = welt()
  assertEquals(await setzeWochenEinstellung(db, ` ${ICH.toUpperCase()} `, { terminBriefing: false }), null)
  assertEquals(db.tabellen.privat_einstellungen.find((z) => z.login_email === ICH)?.briefing, { privatBot: true, terminBriefing: false })
  assertEquals(await setzeWochenEinstellung(db, ICH, { wochenrueckblick: false, terminBriefing: true }), null)
  assertEquals(db.tabellen.privat_einstellungen.find((z) => z.login_email === ICH)?.briefing, { privatBot: true, terminBriefing: true, wochenrueckblick: false })
  // Neue Person ohne Zeile.
  assertEquals(await setzeWochenEinstellung(db, 'neu@beispiel.de', { wochenrueckblick: false }), null)
  assertEquals(db.tabellen.privat_einstellungen.find((z) => z.login_email === 'neu@beispiel.de')?.briefing, { wochenrueckblick: false })
  assertEquals(await setzeWochenEinstellung(db, '', { terminBriefing: false }), 'Keine Adresse.')
  assertEquals(await setzeWochenEinstellung(db, ICH, {}), 'Nichts zu ändern.')
})
