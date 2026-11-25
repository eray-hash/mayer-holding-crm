// Prüft die zentrale Privat-Regel (_shared/privatGrenze.ts) und — als Wächter — die Mayer-seitigen Ausgaben, die Termine
// nehmen: Ein privater Outlook-Termin („Geheimtreffen Musterfirma“) darf in keiner davon mit Titel oder Akte auftauchen.
// Dazu die Serien-Regel von „Bitte bestätigen“ (Ignorieren/Ja gilt für alle Vorkommen).
//
//   npx -y deno test --allow-all --no-check _shared/privatGrenze.test.ts
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { istPrivateAkte, istPrivateMail, istPrivaterTermin, istPrivatesObjekt, ladeBesitzer, nurMayerTermine, privatAssistentMerker } from './privatGrenze.ts'
import { FalscheDatenbank, type Zeile } from './testDoppel.ts'
import { bewerteTermin, ladeZuordnungsUmgebung, ordneVonHandZu, serienSchluessel, type ZuordnungTermin, type ZuordnungVorschlag } from './terminZuordnungKern.ts'
import { ladeTermineDesTags } from './tagesplanLaden.ts'
import { type Daten, morgenText, type Person } from '../email-gateway/tagesmeldung.ts'
import { rueckblickFuer, rueckblickNachricht } from '../email-gateway/abendRueckblick.ts'
import { type Person as BtPerson, terminKandidaten, type Umgebung } from '../email-gateway/bitteBestaetigen.ts'

const GF = 'gf@beispiel.test'
const KOLLEGE = 'kollege@beispiel.test'
const GEHEIM = 'Geheimtreffen Musterfirma'

// ---------------------------------------------------------------------------------------------
// 1. Die Regel

Deno.test('istPrivaterTermin: Regel aus 43222a1 plus private Akte und privater Assistent', () => {
  const t = (x: Record<string, unknown>) => ({ besitzer_email: GF, teilnehmer: [], kunde_id: null, kunde_bereich: null, ms_id: null, ...x })
  assert(istPrivaterTermin(t({ ms_id: 'AAMk1' })), 'Outlook ohne Kollegen und Akte')
  assert(istPrivaterTermin(t({ ms_id: 'AAMk1', kunde_id: 'k_p', kunde_bereich: 'privat' })), 'Outlook mit privater Akte')
  assert(istPrivaterTermin(t({ kunde_id: 'k_p', kunde_bereich: 'privat' })), 'CRM-Termin mit privater Akte')
  assertFalse(istPrivaterTermin(t({})), 'CRM-Termin ohne privaten Assistenten bleibt Mayer')
  assert(istPrivaterTermin(t({}), { besitzerPrivatAssistent: true }), 'CRM-Termin, Besitzer mit privatem Assistenten')
  assertFalse(istPrivaterTermin(t({ ms_id: 'AAMk1', teilnehmer: [KOLLEGE] })), 'mit Kollegen nie privat')
  assertFalse(istPrivaterTermin(t({ ms_id: 'AAMk1', kunde_id: 'k1', kunde_bereich: 'beratung' })), 'mit Mayer-Akte nie privat')
  assertFalse(istPrivaterTermin(t({ kunde_id: 'k1', kunde_bereich: 'beratung' }), { besitzerPrivatAssistent: true }))
  assert(istPrivaterTermin(t({ ms_id: 'AAMk1', teilnehmer: ['  '] })), 'leere Teilnehmer zählen nicht')
  assert(istPrivaterTermin(t({ ms_id: 'AAMk1', gast: { email: 'kunde@musterfirma.test' } })), 'ein Gast von außen macht keinen Firmentermin')
})

Deno.test('nurMayerTermine, istPrivateMail, istPrivateAkte, istPrivatesObjekt, Merker', async () => {
  const liste = [
    { id: 'a', besitzer_email: GF, teilnehmer: [], ms_id: 'X' },
    { id: 'b', besitzer_email: GF, teilnehmer: [] },
    { id: 'c', besitzer_email: KOLLEGE, teilnehmer: [] },
  ]
  assertEquals(nurMayerTermine(liste).map((t) => t.id), ['b', 'c'])
  assertEquals(nurMayerTermine(liste, (e) => e === GF).map((t) => t.id), ['c'])
  assert(istPrivateMail({ besitzer_email: GF }))
  assert(istPrivateMail({ besitzer_email: null, zuordnung_vorschlag: { art: 'privat' } }))
  assertFalse(istPrivateMail({ besitzer_email: null, zuordnung_vorschlag: { art: 'kunde' } }))
  assert(istPrivateAkte({ bereich: 'privat' }))
  assertFalse(istPrivateAkte({ bereich: 'beratung' }))
  assert(istPrivatesObjekt({ privat_besitzer: GF }))
  let aufrufe = 0
  const m = privatAssistentMerker((e) => {
    aufrufe++
    return Promise.resolve(e === GF)
  })
  await ladeBesitzer([...liste, ...liste], m)
  assert(m.bekannt('GF@beispiel.test'))
  assertFalse(m.bekannt(KOLLEGE))
  assertEquals(aufrufe, 2, 'je Adresse einmal')
  const fehler = privatAssistentMerker(() => Promise.reject(new Error('weg')))
  assertFalse(await fehler.nutzt(GF), 'Fehler zählen als „nutzt ihn nicht“')
})

// ---------------------------------------------------------------------------------------------
// 2. Wächter: Mayer-seitige Ausgaben mit einem privaten Outlook-Termin

const HEUTE_JETZT = new Date('2026-11-25T06:30:00Z') // Mittwoch 7:30 Uhr in Berlin
const privaterOutlookTermin = (extra: Record<string, unknown> = {}) => ({
  id: 'geheim1', titel: GEHEIM, ort: 'Musterstraße 1', beginn: '2026-11-25T16:00:00Z', ende: '2026-11-25T17:00:00Z', ganztags: false,
  besitzer_email: GF, teilnehmer: [], kunde_id: null, kunde_bereich: null, kunde_name: null, ms_id: 'AAMkGeheim', quelle: 'outlook',
  gast: null, ms_teilnehmer: [{ email: 'chef@musterfirma.test', name: 'Chef Musterfirma' }], ...extra,
})
const mayerTermin = { ...privaterOutlookTermin(), id: 'mayer1', titel: 'Teamrunde Beratung', ort: null, teilnehmer: [KOLLEGE], ms_id: null, ms_teilnehmer: null }

function leereDaten(termine: unknown[]): Daten {
  return { kunden: [], objekte: [], termine: termine as Daten['termine'], todos: [], treffer: [], fragen: [], ungeklaert: 0, trefferErststand: null }
}

Deno.test('Wächter: Morgen-Übersicht (tagesmeldung) zeigt den privaten Outlook-Termin nicht — weder dem Besitzer noch Kollegen', () => {
  const gf: Person = { email: GF, name: 'Gerda Führer', chat: 1, gf: true, bereiche: [] }
  const kollege: Person = { email: KOLLEGE, name: 'Kai Kollege', chat: 2, gf: false, bereiche: ['beratung'] }
  const d = leereDaten([privaterOutlookTermin(), mayerTermin, privaterOutlookTermin({ id: 'geheim2', ms_id: null, kunde_id: 'k_p', kunde_bereich: 'privat', kunde_name: 'Musterfirma privat' })])
  for (const [p, o] of [[gf, {}], [gf, { eigeneListe: false }], [kollege, {}]] as const) {
    const text = morgenText(p, d, HEUTE_JETZT, [], o) ?? ''
    assertFalse(text.includes('Geheimtreffen') || text.includes('Musterfirma') || text.includes('Musterstraße'), text)
  }
  assert((morgenText(gf, d, HEUTE_JETZT) ?? '').includes('Teamrunde Beratung'), 'Mayer-Termine bleiben')
})

Deno.test('Wächter: Abend-Rückblick zeigt den privaten Outlook-Termin für morgen nicht', () => {
  const morgen = privaterOutlookTermin({ beginn: '2026-11-26T09:00:00Z', ende: '2026-11-26T10:00:00Z' })
  const mayerMorgen = { ...mayerTermin, beginn: '2026-11-26T11:00:00Z', ende: '2026-11-26T12:00:00Z' }
  const d = { offen: [], erledigt: [], termine: [morgen, mayerMorgen], wiedervorlagen: [], kunden: [], objekte: [] }
  for (const eigeneListe of [true, false]) {
    // deno-lint-ignore no-explicit-any
    const r = rueckblickFuer({ email: GF, name: 'Gerda Führer', gf: true, bereiche: [] }, d as any, '2026-11-25', eigeneListe)
    assertEquals(r.termine.map((t) => t.id), ['mayer1'])
    const text = JSON.stringify(rueckblickNachricht(r, '2026-11-25'))
    assertFalse(text.includes('Geheimtreffen'), text)
  }
})

Deno.test('Wächter: Tagesplan (ladeTermineDesTags) lässt private Termine weg', async () => {
  const zeilen = [privaterOutlookTermin(), mayerTermin, { ...privaterOutlookTermin(), id: 'crm_eigen', titel: 'Eigener CRM-Termin', ms_id: null, ms_teilnehmer: null }]
  // Kleine Abfrage-Kette (die Testdatenbank kennt teilnehmer.cs nicht).
  const kette = { select: () => kette, lt: () => kette, gt: () => kette, or: () => kette, order: () => kette, limit: () => Promise.resolve({ data: zeilen, error: null }) }
  const db = { from: () => kette }
  const ohne = await ladeTermineDesTags(db, GF, '2026-11-25', [], false)
  assertEquals(ohne.map((t) => t.titel), ['Teamrunde Beratung', 'Eigener CRM-Termin'])
  const mitPrivatBot = await ladeTermineDesTags(db, GF, '2026-11-25', [], true)
  assertEquals(mitPrivatBot.map((t) => t.titel), ['Teamrunde Beratung'])
})

// ---------------------------------------------------------------------------------------------
// 3. Termin-Zuordnung und „Bitte bestätigen“

const MITARBEITER = [
  { name: 'Gerda Führer', email: GF, rolle: 'geschaeftsfuehrung', ist_admin: true, bereiche: [], aktiv: true, telegram_chat_id: 1 },
  { name: 'Kai Kollege', email: KOLLEGE, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'], aktiv: true, telegram_chat_id: 2 },
]
const AKTE_MAYER = { id: 'k_muster', bereich: 'finanzierungen', firma: 'Musterfirma', ansprechpartner: 'Musterfirma', email: 'chef@musterfirma.test', verantwortlich: null, verantwortlich_email: null }
const AKTE_PRIVAT = { id: 'k_muster_privat', bereich: 'privat', firma: 'Musterfirma', ansprechpartner: 'Musterfirma', email: '', verantwortlich: 'Gerda Führer', verantwortlich_email: GF }

function zuordnungDb(termine: Zeile[], kunden: Zeile[] = [AKTE_MAYER]): FalscheDatenbank {
  return new FalscheDatenbank({ termine, mitarbeiter: MITARBEITER, kunden, besichtigungen: [], objekte: [], postfaecher: [], ms_konten: [], eingegangene_emails: [] })
}

const zt = (x: Record<string, unknown>) => ({ ...privaterOutlookTermin(), titel: 'Musterfirma', zuordnung_vorschlag: null, zuordnung_geprueft_am: null, ...x }) as unknown as ZuordnungTermin

Deno.test('Zuordnung: privater Outlook-Termin bekommt NIE eine Mayer-Akte (weder über den Titel noch über den Gast)', async () => {
  const t = zt({})
  const db = zuordnungDb([t as unknown as Zeile])
  const u = await ladeZuordnungsUmgebung(db, { privatPruefer: () => Promise.resolve(false) })
  const b = await bewerteTermin(db, t, u)
  assertEquals(b.art, 'keiner')
  // Gleicher Titel, aber eine eigene private Akte gibt es: nur die darf vorgeschlagen werden.
  const db2 = zuordnungDb([t as unknown as Zeile], [AKTE_MAYER, AKTE_PRIVAT])
  const b2 = await bewerteTermin(db2, t, await ladeZuordnungsUmgebung(db2, { privatPruefer: () => Promise.resolve(true) }))
  assert(b2.art === 'vorschlag' && b2.kunde.id === 'k_muster_privat', JSON.stringify(b2))
  // Derselbe Termin mit einem Kollegen ist ein Firmentermin: Mayer-Akte über den Gast ist erlaubt.
  const firma = zt({ teilnehmer: [KOLLEGE] })
  const db3 = zuordnungDb([firma as unknown as Zeile])
  const b3 = await bewerteTermin(db3, firma, await ladeZuordnungsUmgebung(db3, { privatPruefer: () => Promise.resolve(false) }))
  assert(b3.art === 'sicher' && b3.kunde.id === 'k_muster', JSON.stringify(b3))
})

const BT_GF: BtPerson = { ...MITARBEITER[0], name: 'Gerda Führer', email: GF }

function umgebung(gefragt: string[] = [], privatAssistent = false): Umgebung {
  return { team: [BT_GF], kunden: new Map([[AKTE_MAYER.id, AKTE_MAYER], [AKTE_PRIVAT.id, AKTE_PRIVAT]]), objekte: new Map(), schonGefragt: new Set(gefragt), jetzt: HEUTE_JETZT, privatAssistent: () => Promise.resolve(privatAssistent) }
}

const vorschlag = (kundeId: string, bereich: string): ZuordnungVorschlag => ({ stand: 'vorschlag', kunde_id: kundeId, bereich, name: 'Musterfirma', wie: 'titel' })

Deno.test('Wächter: Bitte bestätigen (Mayer) schlägt private Termine nie vor — auch alte Vorschläge nicht, auch nicht auf private Akten', async () => {
  const termine = [
    zt({ id: 'alt_leck', zuordnung_vorschlag: vorschlag('k_muster', 'finanzierungen') }),
    zt({ id: 'privat_akte', ms_id: null, zuordnung_vorschlag: vorschlag('k_muster_privat', 'privat') }),
  ]
  const db = zuordnungDb(termine as unknown as Zeile[], [AKTE_MAYER, AKTE_PRIVAT])
  assertEquals(await terminKandidaten(db, BT_GF, umgebung()), [])
  assertEquals(await terminKandidaten(db, BT_GF, umgebung([], true)), [])
})

// ---------------------------------------------------------------------------------------------
// 4. Serien

/** Wöchentliche CRM-Serie (kein privater Termin: Besitzer ohne privaten Assistenten, ohne Outlook). */
function serie(n: number, extra: Record<string, unknown> = {}): Zeile[] {
  return Array.from({ length: n }, (_, i) => ({
    ...zt({}), id: `s${i}`, ms_id: null, ms_teilnehmer: null, quelle: 'crm', titel: 'Musterfirma',
    beginn: new Date(Date.parse('2026-11-25T16:00:00Z') + i * 7 * 86400000).toISOString(),
    ende: new Date(Date.parse('2026-11-25T17:00:00Z') + i * 7 * 86400000).toISOString(),
    zuordnung_vorschlag: vorschlag('k_muster', 'finanzierungen'), ...extra,
  })) as unknown as Zeile[]
}

Deno.test('Serie: Schlüssel = Besitzer, Titel, Wochentag, Uhrzeit (Berlin)', () => {
  const [a, b] = serie(2) as unknown as ZuordnungTermin[]
  assertEquals(serienSchluessel(a), serienSchluessel(b))
  assert(serienSchluessel(a) !== serienSchluessel({ ...a, beginn: '2026-11-25T17:00:00Z' }))
  assert(serienSchluessel(a) !== serienSchluessel({ ...a, besitzer_email: KOLLEGE }))
})

Deno.test('Serie: „Ignorieren“ bei einem Vorkommen gilt für alle — kein Vorschlag mehr, auch nicht für neue Vorkommen', async () => {
  const db = zuordnungDb(serie(4))
  const p = { email: GF, name: 'Gerda Führer', rolle: 'geschaeftsfuehrung', ist_admin: true, bereiche: [] }
  const r = await ordneVonHandZu(db, p, { terminId: 's0', kundeId: null, vorschlagAblehnen: true, serie: true }, HEUTE_JETZT)
  assert(r.ok, JSON.stringify(r))
  const zeilen = db.tabellen.termine as Zeile[]
  for (const z of zeilen) {
    const v = z.zuordnung_vorschlag as ZuordnungVorschlag
    assertEquals(v.stand, 'keiner', z.id as string)
    assert(v.abgelehnt?.includes('k_muster'))
  }
  assertEquals(await terminKandidaten(db, BT_GF, umgebung()), [])
  // Ein neues Vorkommen (z. B. später aus Outlook nachgeladen) erbt die Ablehnung.
  const neu = { ...serie(5)[4], zuordnung_vorschlag: null } as unknown as ZuordnungTermin
  zeilen.push(neu as unknown as Zeile)
  const b = await bewerteTermin(db, neu, await ladeZuordnungsUmgebung(db, { privatPruefer: () => Promise.resolve(false) }))
  assertEquals(b.art, 'keiner')
})

Deno.test('Serie: „Ja“ ordnet alle Vorkommen derselben Akte zu; neue Vorkommen erben die Akte', async () => {
  const db = zuordnungDb(serie(3))
  const p = { email: GF, name: 'Gerda Führer', rolle: 'geschaeftsfuehrung', ist_admin: true, bereiche: [] }
  const r = await ordneVonHandZu(db, p, { terminId: 's1', kundeId: 'k_muster', serie: true }, HEUTE_JETZT)
  assert(r.ok && r.weitere === 2, JSON.stringify(r))
  const zeilen = db.tabellen.termine as Zeile[]
  assertEquals(zeilen.map((z) => z.kunde_id), ['k_muster', 'k_muster', 'k_muster'])
  const neu = { ...serie(4)[3], zuordnung_vorschlag: null } as unknown as ZuordnungTermin
  zeilen.push(neu as unknown as Zeile)
  const b = await bewerteTermin(db, neu, await ladeZuordnungsUmgebung(db, { privatPruefer: () => Promise.resolve(false) }))
  assert(b.art === 'sicher' && b.kunde.id === 'k_muster' && b.wie === 'serie', JSON.stringify(b))
})

Deno.test('Serie: Bitte bestätigen fragt je Serie höchstens einmal, und eine schon gefragte Serie nicht mit dem nächsten Vorkommen', async () => {
  const db = zuordnungDb(serie(3))
  const k = await terminKandidaten(db, BT_GF, umgebung())
  assertEquals(k.length, 1)
  assertEquals(k[0].bezugId, 's0')
  assertEquals(await terminKandidaten(db, BT_GF, umgebung(['termin|s0'])), [], 'nächste Woche kein neues Vorkommen derselben Serie')
})
