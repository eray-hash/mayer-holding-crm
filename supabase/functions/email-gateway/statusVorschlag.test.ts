// Prüft die Statusvorschläge (statusVorschlag.ts, _shared/statusVorschlagKern.ts) ohne Netz: Ziel je Ereignis und
// Bereich, nur vorwärts, nur vorhandene Status, Vertrag nur als PDF/Scan und nie als Vorlage, Antwort nur nach eigener
// Mail, Schalter und Empfänger, höchstens alle 15 Minuten, ein offener Vorschlag je Akte, nach „Nein“ 7 Tage Ruhe.
//
//   npx -y deno test --allow-all --no-check email-gateway/statusVorschlag.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { bestesZiel, dokumentEreignis, statusNetzVon, zielFuer } from '../_shared/statusVorschlagKern.ts'
import { leseKnopf } from '../_shared/bestaetigenKern.ts'
import { imStatusFenster, pruefeStatusVorschlaege } from './statusVorschlag.ts'

const ERAY = { name: 'Eray Yesil', email: 'eray.yesil@fundament-it.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], aktiv: true, telegram_chat_id: 333, ist_superuser: true }
const HASAN = { name: 'Hasan Süslü', email: 'privat.gf@beispiel.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], aktiv: true, telegram_chat_id: 111, ist_superuser: false }
const QUIRIN = { name: 'Quirin Lutzenberger', email: 'immo@amayer-holding.com', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'], aktiv: true, telegram_chat_id: 222, ist_superuser: false }

// Dienstag, 24.11.2026, 10:00 Uhr in Berlin.
const JETZT = new Date('2026-11-24T09:00:00Z')
const VOR = (min: number) => new Date(JETZT.getTime() - min * 60_000).toISOString()
const ALT = '2026-11-01T10:00:00Z'

function einstellung(daten: Record<string, unknown>): Zeile {
  return { id: 'einstellung', empfaenger_email: '-', art: 'lauf', bezug_id: '-', code: '-', status: 'erledigt', daten }
}

function akte(id: string, bereich: string, status: string, verantwortlich: { email: string }, extra: Record<string, unknown> = {}): Zeile {
  return { id, bereich, status, firma: id.replace('k_', '').toUpperCase(), ansprechpartner: '', verantwortlich: null, verantwortlich_email: verantwortlich.email, updated_at: ALT, dokumente: [], activities: [], ...extra }
}

function termin(id: string, kundeId: string, titel = 'Erstgespräch', besitzer = HASAN.email): Zeile {
  return { id, titel, beginn: '2026-11-27T09:00:00Z', ganztags: false, kunde_id: kundeId, besitzer_email: besitzer, teilnehmer: [], erstellt_am: VOR(5), geaendert_am: VOR(5) }
}

function aufbau(einst: Record<string, unknown> | null = { status_an: true, empfaenger: ['*'] }) {
  const db = new FalscheDatenbank({
    mitarbeiter: [ERAY, HASAN, QUIRIN],
    telegram_vorschlaege: einst ? [einstellung(einst)] : [],
    kunden: [
      akte('k_lead', 'beratung', 'lead', HASAN),
      akte('k_vertrag', 'beratung', 'angebot', HASAN, { updated_at: VOR(3), dokumente: [{ name: 'Beratungsvereinbarung – unterschrieben 24.11.2026.pdf', datum: '2026-11-24', quelle: 'unterschrift' }] }),
      akte('k_entwurf', 'beratung', 'lead', HASAN, { updated_at: VOR(3), dokumente: [{ name: 'Beratungsvereinbarung_Entwurf.docx', datum: '2026-11-24' }, { name: 'Vorlage_Vollmacht.pdf', datum: '2026-11-24' }] }),
      akte('k_immo', 'immobilienkunden', 'interessent', QUIRIN),
      akte('k_weit', 'beratung', 'aktives_mandat', HASAN),
      akte('k_wv', 'beratung', 'wiedervorlage', HASAN),
      akte('k_antwort', 'beratung', 'lead', ERAY),
      akte('k_still', 'beratung', 'lead', ERAY),
      akte('k_privat', 'privat', 'neu', ERAY),
      akte('k_fremd', 'beratung', 'lead', HASAN),
    ],
    termine: [
      termin('t1', 'k_lead'),
      termin('t2', 'k_immo', 'Besichtigung Hirsch', QUIRIN.email),
      termin('t3', 'k_weit'),
      termin('t4', 'k_wv'),
      termin('t5', 'k_privat', 'Kaffee', ERAY.email),
      termin('t11', 'k_fremd', 'Geheimes Thema', ERAY.email), // Hasan ist nicht dabei: kein Titel in seiner Nachricht
      { ...termin('t6', 'k_still'), beginn: '2026-11-20T09:00:00Z' }, // vorbei
      { ...termin('t7', 'k_still', 'Abgesagt: Erstgespräch') },
    ],
    kostenvoranschlaege: [{ id: 'kv1', kunde_id: 'k_lead', name: 'Beratung 6 Stunden', erstellt_am: VOR(10) }],
    eingegangene_emails: [
      { id: 'e1', betreff: 'AW: Ihre Anfrage', von: 'kunde@antwort.de', mail_datum: VOR(20), erstellt_am: VOR(20), zugewiesener_kunde_id: 'k_antwort', besitzer_email: null },
      { id: 'e2', betreff: 'Anfrage', von: 'neu@still.de', mail_datum: VOR(20), erstellt_am: VOR(20), zugewiesener_kunde_id: 'k_still', besitzer_email: null },
      { id: 'e3', betreff: 'intern', von: 'info@amayer-holding.com', mail_datum: VOR(20), erstellt_am: VOR(20), zugewiesener_kunde_id: 'k_still', besitzer_email: null },
    ],
    gesendete_emails: [
      { id: 'g1', kunde_id: 'k_antwort', gesendet_am: '2026-11-22T10:00:00Z' },
      { id: 'g2', kunde_id: 'k_still', gesendet_am: VOR(1) }, // erst nach der Mail geschrieben
    ],
  })
  const gesendet: Record<string, unknown>[] = []
  const telegram = (methode: string, daten: Record<string, unknown>) => {
    if (methode === 'sendMessage') gesendet.push(daten)
    return Promise.resolve({ message_id: 700 + gesendet.length })
  }
  return { db, gesendet, telegram }
}

const vorschlaege = (db: FalscheDatenbank) => db.tabelle('telegram_vorschlaege').filter((z) => z.art === 'status')

Deno.test('Kern: Ziel nur vorwärts auf dem Hauptpfad und nur, wo es den Status gibt', () => {
  assertEquals(zielFuer('beratung', 'lead', 'termin'), 'termin')
  assertEquals(zielFuer('beratung', 'konzept', 'termin'), null) // rückwärts
  assertEquals(zielFuer('beratung', 'termin', 'termin'), null) // schon da
  assertEquals(zielFuer('beratung', 'wiedervorlage', 'angebot'), null) // Nebenstatus
  assertEquals(zielFuer('beratung', 'abgeschlossen', 'vertrag'), null)
  assertEquals(zielFuer('erben', 'erstkontakt', 'termin'), 'bedarfsanalyse')
  assertEquals(zielFuer('akademie', 'interessent', 'termin'), null) // kein Terminstatus
  assertEquals(zielFuer('immobilienkunden', 'interessent', 'termin'), 'besichtigung')
  assertEquals(zielFuer('immobilienkunden', 'interessent', 'antwort'), null) // beginnt schon bei Erstkontakt
  assertEquals(zielFuer('privat', 'neu', 'antwort'), 'in_kontakt')
  assertEquals(zielFuer('unbekannt', 'lead', 'termin'), null)
  assertEquals(bestesZiel('beratung', 'lead', ['termin', 'angebot', 'antwort']), { ziel: 'angebot', ereignis: 'angebot' })
  assertEquals(statusNetzVon({ bereich: 'privat', privat_art: 'beratung' }), 'beratung')
  assertEquals(statusNetzVon({ bereich: 'privat', privat_art: null }), 'privat')
})

Deno.test('Kern: Vertrag nur als PDF/Scan, nie Vorlage oder Entwurf; Angebot', () => {
  assertEquals(dokumentEreignis({ name: 'Beratungsvereinbarung – unterschrieben 24.11.2026.pdf', quelle: 'unterschrift' }), 'vertrag')
  assertEquals(dokumentEreignis({ name: 'Beratungsvertrag_Mueller.pdf' }), 'vertrag')
  assertEquals(dokumentEreignis({ name: 'Vollmacht_Scan.jpg' }), 'vertrag')
  assertEquals(dokumentEreignis({ name: 'Beratungsvereinbarung_aktuell_10.11.2026.docx' }), null)
  assertEquals(dokumentEreignis({ name: 'Vorlage_Beratungsvereinbarung_Vermoegensschutz.docx' }), null)
  assertEquals(dokumentEreignis({ name: 'Konzeptpapier_Vollmachtsservice.pdf' }), null)
  assertEquals(dokumentEreignis({ name: 'Mietvertrag_Wohnung.pdf' }), null)
  assertEquals(dokumentEreignis({ name: 'Angebot AN-2026-4EC9FF Eray Yesil (20.11.2026).pdf' }), 'angebot')
  assertEquals(dokumentEreignis({ name: 'Kooperationsangebot_Steuerkanzlei.docx' }), null)
  assertEquals(dokumentEreignis({ name: 'Grundbuch.pdf' }), null)
})

Deno.test('Lauf: Vorschläge aus Termin, Vertrag, Kostenvoranschlag und Antwort — an den Verantwortlichen, mit Knöpfen', async () => {
  const t = aufbau()
  const r = await pruefeStatusVorschlaege(t.db, { telegram: t.telegram, jetzt: JETZT })
  assertEquals(r.fehler, [])
  const zeilen = vorschlaege(t.db)
  const je = Object.fromEntries(zeilen.map((z) => [z.kunde_id as string, z]))
  assertEquals(Object.keys(je).sort(), ['k_antwort', 'k_fremd', 'k_immo', 'k_lead', 'k_privat', 'k_vertrag'])
  const d = (id: string) => je[id].daten as { von: string; nach: string; ereignis: string; anlass: string }
  assertEquals([d('k_lead').nach, d('k_lead').ereignis], ['angebot', 'angebot'])
  assertEquals([d('k_vertrag').von, d('k_vertrag').nach], ['angebot', 'unterschrieben'])
  assertEquals(d('k_immo').nach, 'besichtigung')
  assertEquals(d('k_antwort').nach, 'erstkontakt')
  assertEquals(d('k_privat').nach, 'termin_vereinbart')
  assertEquals(je.k_immo.empfaenger_email, QUIRIN.email)
  assertEquals(je.k_privat.empfaenger_email, ERAY.email)
  assertEquals(r.gesendet, 6)
  assertEquals(d('k_fremd').anlass, 'Termin mit dieser Akte eingetragen (am Fr 27.11. um 10:00).')
  const anQuirin = t.gesendet.find((n) => n.chat_id === 222)!
  assertEquals(String(anQuirin.text), 'Status ändern?\n\nAkte: „IMMO“ (Immobilien)\nAnlass: Termin mit dieser Akte eingetragen („Besichtigung Hirsch“ am Fr 27.11. um 10:00).\nJetzt: Interessent / Erstkontakt\nVorschlag: Besichtigung vereinbart')
  const knoepfe = (anQuirin.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat()
  assertEquals(knoepfe.map((k) => k.text), ['✅ Ja, Status auf „Besichtigung vereinbart“', 'Nein'])
  assertEquals(leseKnopf(knoepfe[0].callback_data)!.id, je.k_immo.id)
  assertStringIncludes(String(t.gesendet.find((n) => String(n.text).includes('„VERTRAG“'))!.text), 'Vertrag oder Vollmacht in der Akte abgelegt')
})

Deno.test('Schalter AUS bzw. nur Eray als Empfänger', async () => {
  const t = aufbau({ status_an: false, empfaenger: ['*'] })
  const r = await pruefeStatusVorschlaege(t.db, { telegram: t.telegram, jetzt: JETZT })
  assertEquals(r.gelaufen, false)
  assertEquals(t.gesendet.length, 0)

  const t2 = aufbau({ status_an: true, empfaenger: ['superuser'] })
  await pruefeStatusVorschlaege(t2.db, { telegram: t2.telegram, jetzt: JETZT })
  assertEquals(vorschlaege(t2.db).map((z) => z.kunde_id).sort(), ['k_antwort', 'k_privat'])
  assert(t2.gesendet.every((n) => n.chat_id === 333))

  const t3 = aufbau(null)
  await pruefeStatusVorschlaege(t3.db, { telegram: t3.telegram, jetzt: JETZT })
  assertEquals(t3.gesendet.length, 0)
})

Deno.test('Höchstens alle 15 Minuten; ein offener Vorschlag je Akte; nach Nein 7 Tage Ruhe', async () => {
  const t = aufbau()
  await pruefeStatusVorschlaege(t.db, { telegram: t.telegram, jetzt: JETZT })
  assertEquals(t.gesendet.length, 6)
  const zweiter = await pruefeStatusVorschlaege(t.db, { telegram: t.telegram, jetzt: new Date(JETZT.getTime() + 5 * 60_000) })
  assertEquals(zweiter.gelaufen, false)
  // 20 Minuten später: ein neuer Termin für k_lead — der offene Vorschlag sperrt.
  t.db.tabelle('termine').push({ ...termin('t8', 'k_lead'), erstellt_am: new Date(JETZT.getTime() + 18 * 60_000).toISOString() })
  const dritter = await pruefeStatusVorschlaege(t.db, { telegram: t.telegram, jetzt: new Date(JETZT.getTime() + 20 * 60_000) })
  assert(dritter.gelaufen)
  assertEquals(dritter.gesendet, 0)
  // Nein auf k_lead: nach 3 Tagen nichts, nach 8 Tagen wieder ein Vorschlag.
  const lead = vorschlaege(t.db).find((z) => z.kunde_id === 'k_lead')!
  lead.status = 'nein'
  lead.erledigt_am = new Date(JETZT.getTime() + 30 * 60_000).toISOString()
  const spaeter = (tage: number) => new Date(JETZT.getTime() + tage * 86_400_000)
  t.db.tabelle('termine').push({ ...termin('t9', 'k_lead'), erstellt_am: new Date(spaeter(3).getTime() - 60_000).toISOString() })
  assertEquals((await pruefeStatusVorschlaege(t.db, { telegram: t.telegram, jetzt: spaeter(3) })).gesendet, 0)
  t.db.tabelle('termine').push({ ...termin('t10', 'k_lead'), beginn: '2026-12-05T09:00:00Z', erstellt_am: new Date(spaeter(8).getTime() - 60_000).toISOString() })
  const neu = await pruefeStatusVorschlaege(t.db, { telegram: t.telegram, jetzt: spaeter(8) })
  assertEquals(neu.gesendet, 1)
  assertEquals((vorschlaege(t.db).at(-1)!.daten as { nach: string }).nach, 'termin')
})

Deno.test('Zeitfenster: werktags 8 bis 19 Uhr; Trockenlauf schreibt und sendet nichts', async () => {
  assert(imStatusFenster(JETZT))
  assert(!imStatusFenster(new Date('2026-11-24T18:30:00Z'))) // 19:30
  assert(!imStatusFenster(new Date('2026-11-29T10:00:00Z'))) // Sonntag
  const t = aufbau(null)
  const r = await pruefeStatusVorschlaege(t.db, { telegram: t.telegram, jetzt: JETZT, trockenSeit: new Date(JETZT.getTime() - 86_400_000) })
  assertEquals(t.gesendet.length, 0)
  assertEquals(vorschlaege(t.db).length, 0)
  assertEquals(r.vorschau?.length, 6)
})
