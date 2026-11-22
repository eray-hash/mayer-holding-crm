// Prüft das Ergänzen von Belegen und Angaben der Verbindlichkeiten mit einer Datenbank im Speicher und
// einer falschen KI (ohne Netz): Rechnungs-Anhang wählen, PDF aus Mailtext nur bei echten Belegen, nur
// leere Felder füllen, geprüfte Einträge nicht anfassen, Kennzeichnung, Fehler mit Wiederholung, Takt,
// Sperre und die Aktion (nur Geschäftsführung, Vorschau ohne KI).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { belegLuecken, erkanntAus, fehltKurz, istUnvollstaendig } from '../_shared/belegLuecken.ts'
import {
  belegErgaenzenAktion,
  belegVorschau,
  bereinigeAuslese,
  type KiAuslesen,
  type KiBlock,
  mailText,
  pdfAusMail,
  planeFelder,
  pruefeBelege,
  STAND_ID,
  type VerbZeile,
  waehleRechnungsAnhang,
} from './belegErgaenzen.ts'

Deno.env.set('SUPABASE_URL', 'https://test.supabase.co')
const OEFFENTLICH = 'https://test.supabase.co/storage/v1/object/public/email-anhaenge'

// deno-lint-ignore no-explicit-any
type Lose = Record<string, any>
type Db = ReturnType<typeof falscheDatenbank>
const verb = (db: Db, id: string): Lose => db.tabelle('verbindlichkeiten').find((v) => v.id === id) as Lose
const JETZT = new Date('2026-11-22T12:00:00Z')

function verbindlichkeit(id: string, felder: Partial<Zeile> = {}): Zeile {
  return {
    id, lieferant: 'Lieferant', lieferant_email: 'rechnung@lieferant.de', rechnungsnummer: null, datum: '2026-11-10', betrag_netto: null, betrag_brutto: null,
    zahlungsziel: null, status: 'offen', notiz: null, quelle: 'email-automatisch', quell_email_id: `<${id}>`, erstellt_am: '2026-11-10T08:00:00+00:00',
    kategorie: null, beleg: null, geprueft: null, automatisch_erkannt: null, ...felder,
  }
}

function mail(id: string, felder: Partial<Zeile> = {}): Zeile {
  return { id: `mail-${id}`, message_id: `<${id}>`, von: 'rechnung@lieferant.de', von_name: 'Lieferant', betreff: 'Ihre Rechnung', mail_datum: '2026-11-10T08:00:00+00:00', erstellt_am: '2026-11-10T08:00:00+00:00', ausschnitt: 'Guten Tag, anbei Ihre Rechnung.', anhaenge: null, besitzer_email: null, rohdaten: {}, ...felder }
}

const PAYPAL_TEXT = 'Beleg für Ihre Zahlung an Apple Services \n\n Sie haben 22,00 € EUR an Apple Services gezahlt \n\n Transaktionsdatum \n 13.11.2026 \n\n Bestellnummer \n MK5YHH8HBXa0 \n\n Gesamtbetrag \n 22,00 € EUR \n\n &zwnj; &zwnj; Fragen? Hilfe &amp; Kontakt ☁️💳'

async function kleinesPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.addPage([200, 200])
  return await pdf.save()
}

/** Falsche KI: Antwort je Lieferant (über den Auftragstext erkannt); merkt sich die Aufrufe. */
function falscheKi(antworten: Record<string, Record<string, unknown> | Error>): KiAuslesen & { aufrufe: KiBlock[][] } {
  const aufrufe: KiBlock[][] = []
  const f = ((inhalt: KiBlock[]) => {
    aufrufe.push(inhalt)
    const auftrag = inhalt.map((b) => (b.type === 'text' ? b.text : '')).join('\n')
    for (const [schluessel, antwort] of Object.entries(antworten)) {
      if (auftrag.includes(schluessel)) return antwort instanceof Error ? Promise.reject(antwort) : Promise.resolve(antwort)
    }
    return Promise.resolve({ art: 'unklar' })
  }) as KiAuslesen & { aufrufe: KiBlock[][] }
  f.aufrufe = aufrufe
  return f
}

async function datenbank(): Promise<Db> {
  const db = falscheDatenbank({
    verbindlichkeiten: [
      // Rechnung als PDF-Anhang (wie IONOS), Brutto bekannt, Netto und Nummer fehlen
      verbindlichkeit('v-ionos', { lieferant: 'Rechnungsstelle IONOS', lieferant_email: 'noreply@ionos.de', betrag_brutto: 42 }),
      // PayPal-Zahlungsbeleg ohne Anhang, Lieferant ist nur die Absenderadresse
      verbindlichkeit('v-paypal', { lieferant: 'service@paypal.de', lieferant_email: 'service@paypal.de', erstellt_am: '2026-11-13T09:00:00+00:00', datum: '2026-11-13' }),
      // Betrugsversuch ohne Anhang
      verbindlichkeit('v-betrug', { lieferant: 'Cloud Space Review', lieferant_email: 'support@gravypass.com' }),
      // schon geprüft, aber ohne Beleg: nur der Beleg darf kommen
      verbindlichkeit('v-geprueft', { lieferant: 'HD TEC', geprueft: true }),
      // von Hand angelegt, keine Mail
      verbindlichkeit('v-hand', { quelle: 'manuell', quell_email_id: null, betrag_brutto: 49.35 }),
      // vollständig: nichts zu tun
      verbindlichkeit('v-fertig', { rechnungsnummer: 'R-1', betrag_brutto: 119, betrag_netto: 100, beleg: { name: 'r.pdf', url: 'verbindlichkeiten/r.pdf' } }),
    ],
    eingegangene_emails: [
      mail('v-ionos', {
        von: 'noreply@ionos.de', von_name: 'Rechnungsstelle IONOS', betreff: 'Ihre IONOS Rechnung ist da',
        anhaenge: [{ filename: 'Rechnung_2026-11-10_100195514446.pdf', size: 500, contentType: 'application/pdf', url: `${OEFFENTLICH}/ionos/Rechnung_2026-11-10_100195514446.pdf` }],
      }),
      mail('v-paypal', { von: 'service@paypal.de', von_name: 'PayPal', betreff: 'Beleg für Ihre Zahlung an Apple Services', ausschnitt: PAYPAL_TEXT }),
      mail('v-betrug', { von: 'support@gravypass.com', von_name: 'Cloud Space Review', betreff: 'Ways to keep your 250 GB storage plan running', ausschnitt: 'Payment Declined. Amount Due $2.99. Reactivate Now. Please update your payment method.' }),
      mail('v-geprueft', {
        von: 'info@hd-tec.eu', von_name: 'INFO HD TEC', betreff: 'Rechnung',
        anhaenge: [
          { filename: 'logo.png', size: 10, contentType: 'image/png', url: `${OEFFENTLICH}/hd/logo.png` },
          { filename: 'Mayer, Andreas 261004.pdf', size: 500, contentType: 'application/pdf', url: `${OEFFENTLICH}/hd/Mayer__Andreas_261004.pdf` },
        ],
      }),
    ],
  })
  const pdf = await kleinesPdf()
  await db.storage.from('email-anhaenge').upload('ionos/Rechnung_2026-11-10_100195514446.pdf', pdf, { contentType: 'application/pdf' })
  await db.storage.from('email-anhaenge').upload('hd/Mayer__Andreas_261004.pdf', pdf, { contentType: 'application/pdf' })
  return db
}

const KI_ANTWORTEN = {
  'Rechnungsstelle IONOS': { art: 'rechnung', lieferant: 'IONOS SE', rechnungsnummer: '100195514446', rechnungsdatum: '2026-11-10', betrag_brutto: 42, umsatzsteuer_betrag: 6.71, waehrung: 'EUR', kategorie: 'Software & Hosting' },
  'Apple Services': { art: 'zahlungsbeleg', lieferant: 'Apple Services', rechnungsnummer: 'MK5YHH8HBXa0', rechnungsdatum: '2026-11-13', betrag_brutto: 22, waehrung: 'EUR', kategorie: 'Software & Hosting' },
  'Cloud Space Review': { art: 'keine_rechnung', betrag_brutto: 2.99, waehrung: 'USD' },
  'HD TEC': { art: 'rechnung', rechnungsnummer: '261004', betrag_brutto: 1190, betrag_netto: 1000 },
}

// ---------------------------------------------------------------------------------------------
// Reine Regeln

Deno.test('Rechnungs-Anhang: Rechnung vor AGB, Logos nie, Bilder nur mit passendem Namen', () => {
  const europcar = [
    { filename: 'Europcar_DE_TermsAndConditions_20261027.pdf', contentType: 'application/pdf', url: 'u1' },
    { filename: 'RA_1101305537_20261027_113652.pdf', contentType: 'application/pdf', url: 'u2' },
  ]
  assertEquals(waehleRechnungsAnhang(europcar)?.url, 'u2')
  assertEquals(waehleRechnungsAnhang([{ filename: 'logo.png', contentType: 'image/png', url: 'u' }]), null)
  assertEquals(waehleRechnungsAnhang([{ filename: 'Rechnung 12.jpg', contentType: 'image/jpeg', url: 'u3' }])?.url, 'u3')
  assertEquals(waehleRechnungsAnhang([{ filename: 'Angebot.pdf', contentType: 'application/pdf', url: '' }]), null)
  assertEquals(waehleRechnungsAnhang(null), null)
})

Deno.test('KI-Antwort bereinigen: Fremdwährung ohne Beträge, Netto aus Steuer, Unsinn fällt weg', () => {
  assertEquals(bereinigeAuslese({ art: 'keine_rechnung', betrag_brutto: 2.99, waehrung: 'USD' }, JETZT), { art: 'keine_rechnung' })
  const a = bereinigeAuslese({ art: 'rechnung', betrag_brutto: '42,00', umsatzsteuer_betrag: 6.71, rechnungsdatum: '2026-11-10', zahlungsziel: 'bald', kategorie: 'Kaffee', lieferant: 'x@y.de' }, JETZT)
  assertEquals(a, { art: 'rechnung', brutto: 42, netto: 35.29, steuer: 6.71, datum: '2026-11-10' })
  assertEquals(bereinigeAuslese({ art: 'quatsch', rechnungsdatum: '2030-01-01', betrag_netto: 50, betrag_brutto: 40 }, JETZT), { art: 'unklar', brutto: 40 })
})

Deno.test('Felder planen: nur Leeres, Betrag 0 und Platzhalter ersetzen, geprüfte Einträge nie', () => {
  const v = verbindlichkeit('a', { lieferant: 'service@paypal.de', lieferant_email: 'service@paypal.de', betrag_brutto: 0, datum: '2026-11-10', erstellt_am: '2026-11-10T08:00:00+00:00', kategorie: 'Miete' }) as unknown as VerbZeile
  const a = { art: 'rechnung' as const, lieferant: 'Etsy Ireland UC', rechnungsnummer: 'T-1', datum: '2026-11-09', brutto: 186.14, kategorie: 'Bürobedarf' }
  assertEquals(planeFelder(v, a), { betrag_brutto: 186.14, rechnungsnummer: 'T-1', datum: '2026-11-09', lieferant: 'Etsy Ireland UC' })
  // Echter Lieferant und echtes Datum (nicht der Anlagetag) bleiben
  const echt = { ...v, lieferant: 'Rechnungsstelle IONOS', datum: '2026-11-01', betrag_brutto: 10 } as VerbZeile
  assertEquals(planeFelder(echt, a), { rechnungsnummer: 'T-1' })
  // Beleg nennt 0 € — bleibt 0
  assertEquals(planeFelder({ ...echt, betrag_brutto: 0 } as VerbZeile, { art: 'rechnung', brutto: 0 }), {})
  assertEquals(planeFelder({ ...v, geprueft: true } as VerbZeile, a), {})
  assertEquals(planeFelder(v, { ...a, art: 'keine_rechnung' }), {})
})

Deno.test('Mailtext: Entitäten und unsichtbare Zeichen weg; PDF aus Mail mit Sonderzeichen', async () => {
  const t = mailText({ ausschnitt: PAYPAL_TEXT, rohdaten: {} })
  assertStringIncludes(t, 'Hilfe & Kontakt')
  assert(!t.includes('&zwnj;'))
  const bytes = await pdfAusMail({ von: 'service@paypal.de', von_name: 'PayPal', betreff: 'Beleg ☁️', mail_datum: '2026-11-13T09:00:00Z', erstellt_am: null, ausschnitt: PAYPAL_TEXT + '\n' + 'x'.repeat(400) + '\n'.repeat(200), rohdaten: {} })
  const pdf = await PDFDocument.load(bytes)
  assert(pdf.getPageCount() >= 1)
  // Kurzer Ausschnitt → HTML der Mail
  assertStringIncludes(mailText({ ausschnitt: '', rohdaten: { html: '<p>Gesamtbetrag&nbsp;12,00&nbsp;&euro;</p>' } }), 'Gesamtbetrag 12,00 €')
})

Deno.test('Lücken: Beleg, Betrag, Nummer fehlen; 0 € und nur brutto sind Hinweise', () => {
  assertEquals(fehltKurz({ beleg: null, brutto: null, netto: null, rechnungsnummer: '' }), 'Beleg, Betrag, Rechnungsnummer')
  assert(!istUnvollstaendig({ beleg: { url: 'p' }, brutto: 0, netto: null, rechnungsnummer: '1' }))
  assertEquals(belegLuecken({ beleg: { url: 'p' }, brutto: 10, netto: null, rechnungsnummer: '1' }).map((l) => l.art), ['netto'])
  assertEquals(fehltKurz({ beleg: { url: 'p' }, brutto: 1, netto: 1, rechnungsnummer: '1' }, { art: 'keine_rechnung' }), 'wohl keine Rechnung')
  assertStringIncludes(belegLuecken({ beleg: null, brutto: 1, netto: 1, rechnungsnummer: '1' }, { art: 'nur_im_kundenkonto' })[0].text, 'Kundenkonto')
})

// ---------------------------------------------------------------------------------------------
// Ablauf mit Datenbank

Deno.test('Lauf: PDF-Anhang als Beleg, PDF aus Zahlungsbeleg, Betrug nur gekennzeichnet, Geprüftes nur Beleg', async () => {
  const db = await datenbank()
  const ki = falscheKi(KI_ANTWORTEN)
  const r = await pruefeBelege(db, { ki }, { jetzt: JETZT, hoechstens: 10 })
  assert(r.gelaufen)
  assertEquals(r.fehler, [])
  assertEquals(r.geprueft, 4) // v-hand (keine Mail) und v-fertig (vollständig) bleiben außen vor
  assertEquals(r.belege, 3)

  const ionos = verb(db, 'v-ionos')
  assertEquals(ionos.beleg.name, 'Rechnung_2026-11-10_100195514446.pdf')
  assert(String(ionos.beleg.url).startsWith('verbindlichkeiten/dok_'))
  assert(db.ablage.get('kunden-dokumente')?.has(ionos.beleg.url))
  assertEquals(ionos.betrag_brutto, 42) // war schon da
  assertEquals(ionos.betrag_netto, 35.29)
  assertEquals(ionos.rechnungsnummer, '100195514446')
  assertEquals(ionos.kategorie, 'Software & Hosting')
  assertEquals(ionos.lieferant, 'Rechnungsstelle IONOS') // kein Platzhalter
  assertEquals(ionos.geprueft, null) // „Angaben stimmen“ bleibt Handarbeit
  assertStringIncludes(ionos.notiz, 'Automatisch ergänzt am 22.11.2026: Beleg (Anhang der Mail')
  assertStringIncludes(ionos.notiz, 'bitte prüfen')
  const e = erkanntAus(ionos.automatisch_erkannt)!
  assertEquals([e.stand, e.art, e.beleg, e.versuche], ['fertig', 'rechnung', 'mail_anhang', 1])
  assertEquals(e.felder?.sort(), ['betrag_netto', 'kategorie', 'rechnungsnummer'])
  // Die KI bekam das PDF selbst
  const ionosAufruf = ki.aufrufe.find((a) => a.some((b) => b.type === 'text' && b.text.includes('Rechnungsstelle IONOS')))!
  assertEquals(ionosAufruf[0].type, 'document')

  const paypal = verb(db, 'v-paypal')
  assertEquals(paypal.beleg.typ, 'application/pdf')
  assertStringIncludes(paypal.beleg.name, 'Beleg aus E-Mail Apple Services 13.11.2026')
  const erzeugt = db.ablage.get('kunden-dokumente')!.get(paypal.beleg.url)!
  assert((await PDFDocument.load(erzeugt.bytes)).getPageCount() >= 1)
  assertEquals(paypal.lieferant, 'Apple Services')
  assertEquals(paypal.betrag_brutto, 22)
  assertEquals(paypal.rechnungsnummer, 'MK5YHH8HBXa0')
  assertEquals(paypal.datum, '2026-11-13') // gleich wie vorher → nicht in felder
  assertEquals(erkanntAus(paypal.automatisch_erkannt)?.beleg, 'mail_text')

  const betrug = verb(db, 'v-betrug')
  assertEquals(betrug.beleg, null)
  assertEquals(betrug.betrag_brutto, null)
  assertStringIncludes(betrug.notiz, 'wohl keine echte Rechnung')
  assertEquals(erkanntAus(betrug.automatisch_erkannt)?.art, 'keine_rechnung')

  const geprueft = verb(db, 'v-geprueft')
  assertEquals(geprueft.beleg.name, 'Mayer, Andreas 261004.pdf') // nicht das Logo
  assertEquals(geprueft.rechnungsnummer, null) // geprüft: Angaben unangetastet
  assertEquals(geprueft.betrag_brutto, null)
  assertEquals(ki.aufrufe.filter((a) => a.some((b) => b.type === 'text' && b.text.includes('HD TEC'))).length, 0) // keine KI nötig

  assertEquals(verb(db, 'v-hand').automatisch_erkannt, null)
  assertEquals(verb(db, 'v-fertig').automatisch_erkannt, null)

  // Sperre ist wieder frei; ein zweiter Lauf (nach dem Takt) findet nichts mehr
  const r2 = await pruefeBelege(db, { ki }, { jetzt: new Date(JETZT.getTime() + 3 * 60_000), hoechstens: 10 })
  assert(r2.gelaufen)
  assertEquals(r2.geprueft, 0)
})

Deno.test('Takt und Sperre: höchstens alle 2 Minuten; laufender Lauf blockiert die Aktion', async () => {
  const db = await datenbank()
  const ki = falscheKi(KI_ANTWORTEN)
  const r1 = await pruefeBelege(db, { ki }, { jetzt: JETZT, hoechstens: 1 })
  assertEquals(r1.geprueft, 1)
  const r2 = await pruefeBelege(db, { ki }, { jetzt: new Date(JETZT.getTime() + 60_000) })
  assertEquals(r2.gelaufen, false)
  // Fremder Lauf hält die Sperre
  const stand = db.tabelle('abteilung_eintraege').find((z) => z.id === STAND_ID) as Lose
  stand.daten = { ...stand.daten, laeuftBis: new Date(Date.now() + 60_000).toISOString() }
  const gf = { email: 'info@amayer-holding.com', name: 'Andreas Mayer', istGf: true }
  const a = await belegErgaenzenAktion(db, gf, { schritt: 'ausfuehren' }, { ki })
  assertEquals(a.status, 409)
})

Deno.test('Fehler: KI-Ausfall wird vermerkt und frühestens nach einer Stunde wiederholt', async () => {
  const db = await datenbank()
  const ki = falscheKi({ ...KI_ANTWORTEN, 'Rechnungsstelle IONOS': new Error('KI-Dienst antwortet mit 529: überlastet') })
  const r = await pruefeBelege(db, { ki }, { jetzt: JETZT, hoechstens: 10 })
  assertEquals(r.fehler.length, 1)
  const ionos = verb(db, 'v-ionos')
  assertEquals(ionos.beleg, null) // nichts halb geschrieben
  assertEquals(erkanntAus(ionos.automatisch_erkannt)?.stand, 'fehler')
  assertEquals(erkanntAus(ionos.automatisch_erkannt)?.versuche, 1)
  // nach 10 Minuten: noch nicht wieder dran
  const r2 = await pruefeBelege(db, { ki }, { jetzt: new Date(JETZT.getTime() + 10 * 60_000), hoechstens: 10 })
  assertEquals(r2.geprueft, 0)
  // nach über einer Stunde mit funktionierender KI: erledigt
  const r3 = await pruefeBelege(db, { ki: falscheKi(KI_ANTWORTEN) }, { jetzt: new Date(JETZT.getTime() + 61 * 60_000), hoechstens: 10 })
  assertEquals(r3.geprueft, 1)
  assertEquals(erkanntAus(verb(db, 'v-ionos').automatisch_erkannt)?.versuche, 2)
  assertEquals(erkanntAus(verb(db, 'v-ionos').automatisch_erkannt)?.stand, 'fertig')
})

Deno.test('KI lehnt die Datei ab (400): Mailtext wird trotzdem gelesen, Beleg kommt', async () => {
  const db = await datenbank()
  let n = 0
  const ki: KiAuslesen = (inhalt) => {
    n++
    if (inhalt.some((b) => b.type === 'document')) return Promise.reject(new Error('KI-Dienst antwortet mit 400: Datei nicht lesbar'))
    return Promise.resolve({ art: 'rechnung', rechnungsnummer: '100195514446' })
  }
  db.tabelle('verbindlichkeiten').splice(1) // nur IONOS
  await pruefeBelege(db, { ki }, { jetzt: JETZT })
  assertEquals(n, 2)
  assertEquals(verb(db, 'v-ionos').rechnungsnummer, '100195514446')
  assert(verb(db, 'v-ionos').beleg)
})

Deno.test('Inzwischen von Hand hochgeladener Beleg bleibt; die eigene Kopie wird wieder gelöscht', async () => {
  const db = await datenbank()
  db.tabelle('verbindlichkeiten').splice(1)
  const ki: KiAuslesen = () => {
    verb(db, 'v-ionos').beleg = { name: 'hand.pdf', url: 'verbindlichkeiten/hand.pdf' }
    return Promise.resolve({ art: 'rechnung', rechnungsnummer: 'X' })
  }
  await pruefeBelege(db, { ki }, { jetzt: JETZT })
  assertEquals(verb(db, 'v-ionos').beleg.name, 'hand.pdf')
  assertEquals(db.ablage.get('kunden-dokumente')?.size ?? 0, 0)
  assertEquals(erkanntAus(verb(db, 'v-ionos').automatisch_erkannt)?.beleg, null)
})

Deno.test('Aktion: nur Geschäftsführung; Vorschau zählt ohne KI und ohne Schreiben', async () => {
  const db = await datenbank()
  const ki = falscheKi(KI_ANTWORTEN)
  const nein = await belegErgaenzenAktion(db, { email: 'q@x.de', name: 'Quirin', istGf: false }, { schritt: 'ausfuehren' }, { ki })
  assertEquals(nein.status, 403)
  const v = await belegVorschau(db, JETZT)
  assertEquals([v.gesamt, v.ohneBeleg, v.ohneBetrag, v.kommtDran], [6, 5, 3, 4])
  const zeile = (id: string) => v.zeilen.find((z) => z.id === id)!
  assertEquals(zeile('v-ionos').beleg, 'mail_anhang')
  assertEquals(zeile('v-paypal').beleg, 'mail_text')
  assertEquals(zeile('v-hand').grund, 'keine Original-Mail (von Hand angelegt)')
  assertEquals(ki.aufrufe.length, 0)
  assertEquals(verb(db, 'v-ionos').automatisch_erkannt, null)
  const gf = { email: 'info@amayer-holding.com', name: 'Andreas Mayer', istGf: true }
  const r = await belegErgaenzenAktion(db, gf, { schritt: 'ausfuehren', ids: ['v-paypal'] }, { ki })
  assertEquals(r.status, 200)
  assertEquals((r.daten as Lose).geprueft, 1)
  assertEquals(verb(db, 'v-ionos').automatisch_erkannt, null)
  assert(verb(db, 'v-paypal').beleg)
})
