// Prüft den Kern des Statusberichts an den Kunden (ohne Netz): nichts Internes aus dem Verlauf, keine
// Namen von Kollegen, Beträge nur aus verschickten Rechnungen/bekannten Angeboten, Wiedervorlagen nur aus
// der festen Liste, fehlende Unterlagen, Ampel, Zeitraum und Mailtext.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  akteLink,
  berichtAlsText,
  erstelleKundenbericht,
  fehlendeUnterlagen,
  kurzfassung,
  ladeBerichtDaten,
  standardSeit,
  type BerichtEingabe,
} from './kundenberichtKern.ts'
import { FalscheDatenbank } from './testDoppel.ts'

function eingabe(over: Partial<BerichtEingabe> = {}): BerichtEingabe {
  return {
    heute: '2026-11-22',
    seit: '2026-11-16',
    akte: {
      id: 'k1',
      bereich: 'erben',
      firma: 'Familie Beispiel',
      ansprechpartner: 'Thomas Beispiel',
      email: 'thomas@beispiel.de',
      verantwortlich: 'Hasan Süslü',
      status: 'unterlagen_angefordert',
      naechsteSchritte: '- Testamentsentwurf vorbereiten\n- Quirin fragt beim Notar nach\n- Honorar 1.500 € klären\nIntern: Provision mit Vermittler klären',
      dienstleistungen: ['Erbfolgeberatung'],
      activities: [
        { date: '2026-11-18', text: 'E-Mail automatisch zugeordnet: „AW: Unterlagen Testament" von Thomas Beispiel (2 Anhänge)', user: 'System' },
        { date: '2026-11-19', text: 'E-Mail zugeordnet: „Fwd: Kunde Beispiel" von Andreas Mayer', user: 'Markus' },
        { date: '2026-11-19', text: 'Hintergrund (Andreas Mayer): Kunde hat Schulden von 30.000 €', user: 'Andreas Mayer' },
        { date: '2026-11-20', text: 'Per Telegram von Hasan Süslü abgelegt: „foto.jpg — Sonstiges"', user: 'Hasan Süslü' },
        { date: '2026-11-01', text: 'E-Mail automatisch zugeordnet: „Alt" von Thomas Beispiel', user: 'System' },
      ],
      dokumente: [
        { id: 'd1', name: 'Grundbuchauszug.pdf', datum: '2026-11-17' },
        { id: 'd2', name: 'foto.jpg', datum: '2026-11-20' },
        { id: 'd3', name: 'Rechnung RE-2026-7.pdf', datum: '2026-11-21' },
        { id: 'd4', name: 'Alt.pdf', datum: '2026-10-01' },
      ],
      unterlagenAnforderungen: [
        {
          datum: '2026-11-10',
          art: 'anforderung',
          punkte: ['Grundbuchauszug', 'Personalausweis', 'Testament (Kopie)', 'Selbstauskunft (ausgefüllt und unterschrieben)'],
          weitere: 'Kontoauszüge der letzten drei Monate',
          token: 't1',
          eingang: [{ punkt: 'Grundbuchauszug', datum: '2026-11-17', name: 'Grundbuchauszug.pdf' }],
        },
      ],
      unterlagenCheckliste: { 'Testament (Kopie)': true },
      selbstauskunftAm: '2026-11-19T10:00:00Z',
    },
    wiedervorlagen: [
      { regel: 'erb_notar', titel: 'Entwurf an den Notar geben', faellig: '2026-11-25' },
      { regel: 'allg_angebot_nachfassen', titel: 'Kostenvoranschlag nachfassen', faellig: '2026-11-24' },
      { regel: null, titel: 'Hasan: Kunde anrufen wegen Geld', faellig: '2026-11-23', quelle: 'hand' },
      { regel: 'erb_fragebogen', titel: 'Mandantenfragebogen zurück?', faellig: '2026-11-26' },
      { regel: 'erb_memo', titel: 'Mandantenmemo besprechen', faellig: '2026-11-18', erledigtAm: '2026-11-18T09:00:00Z', erledigtGrund: 'Stand geändert' },
      { regel: 'erb_erstgespraech', titel: 'Erstgespräch vereinbaren', faellig: '2026-11-17', erledigtAm: '2026-11-17T09:00:00Z' },
    ],
    mails: [
      { id: 'm1', betreff: 'Ihr Angebot zur Erbfolgeberatung', gesendetAm: '2026-11-17T08:00:00Z' },
      { id: 'm2', betreff: 'Terminbestätigung', gesendetAm: '2026-11-20T08:00:00Z' },
      { id: 'm3', betreff: 'Stand Ihres Projekts (15.11.2026)', gesendetAm: '2026-11-16T08:00:00Z' },
    ],
    termine: [
      { beginn: '2026-11-25T09:00:00Z', ganztags: false, gast: true },
      { beginn: '2026-11-24T09:00:00Z', ganztags: false, gast: false },
      { beginn: '2026-11-10T09:00:00Z', ganztags: false, gast: true },
    ],
    kvs: [
      { id: 'kv1', beschreibung: 'Erbfolgeberatung', status: 'offen', datum: '2026-11-16', betrag: 2380, mitPdf: true },
      { id: 'kv2', beschreibung: 'Geheim', status: 'offen', datum: '2026-11-16', betrag: 999, mitPdf: false },
      { id: 'kv3', beschreibung: 'Abgelehnt', status: 'abgelehnt', datum: '2026-11-16', betrag: 5, mitPdf: true },
    ],
    rechnungen: [
      { nummer: 'RE-2026-7', datum: '2026-11-21', brutto: 595, status: 'Versendet', versendetAm: '2026-11-21' },
      { nummer: 'RE-2026-8', datum: '2026-11-21', brutto: 777, status: 'Entwurf' },
      { nummer: 'RE-2026-3', datum: '2026-10-01', brutto: 100, status: 'Bezahlt', versendetAm: '2026-10-01', bezahltAm: '2026-11-19' },
    ],
    team: ['Hasan Süslü', 'Quirin Lutzenberger', 'Andreas Mayer', 'Eray Yesil'],
    fehler: [],
    stand: { label: 'Unterlagen angefordert', schritt: 3, schritte: 7 },
    ...over,
  }
}

Deno.test('Bericht: nichts Internes, keine Kollegen, Beträge nur wo erlaubt', () => {
  const b = erstelleKundenbericht(eingabe())
  const alles = berichtAlsText(b, 'https://crm.test/#/formular/unterlagen/x')
  // Interne Verlaufstexte, Kollegen (außer dem Ansprechpartner) und fremde Beträge fehlen.
  for (const verboten of ['Telegram', 'Schulden', '30.000', 'Quirin', 'Andreas', 'Provision', '1.500', '999', 'Geheim', 'Abgelehnt', 'RE-2026-8', '777', 'nachfassen', 'Geld', 'Fwd: Kunde Beispiel']) {
    assert(!alles.includes(verboten), `darf nicht im Bericht stehen: ${verboten}\n${alles}`)
  }
  assertStringIncludes(alles, 'Hasan Süslü') // Ansprechpartner im Gruß
  assertEquals(b.anrede, 'Guten Tag Thomas Beispiel,')
  assertStringIncludes(b.einleitung, 'Erbfolgeberatung')
  assertStringIncludes(b.einleitung, '16.11.2026 bis 22.11.2026')
  assertStringIncludes(b.stand, 'Unterlagen angefordert')
  assertStringIncludes(b.stand, 'Schritt 3 von 7')
})

Deno.test('Bericht: was passiert ist', () => {
  const b = erstelleKundenbericht(eingabe())
  const e = b.erledigt.join('\n')
  assertStringIncludes(e, '17.11.: Unser Angebot „Erbfolgeberatung“ über 2.380,00 € haben wir Ihnen geschickt.')
  assert(!e.includes('Ihr Angebot zur Erbfolgeberatung'), 'die Angebotsmail steht nicht doppelt')
  assertStringIncludes(e, '20.11.: Wir haben Ihnen geschrieben: „Terminbestätigung“.')
  assert(!e.includes('Stand Ihres Projekts'), 'frühere Berichte zählen nicht')
  assertStringIncludes(e, '18.11.: Ihre E-Mail „AW: Unterlagen Testament“ ist bei uns eingegangen.')
  assert(!e.includes('„Alt“'), 'vor dem Zeitraum')
  assertStringIncludes(e, '17.11.: Ihre Unterlagen sind eingegangen: Grundbuchauszug.')
  assertStringIncludes(e, '19.11.: Ihre Selbstauskunft ist eingegangen.')
  assertStringIncludes(e, 'Eine weitere Unterlage haben wir zu Ihrem Vorgang abgelegt.') // foto.jpg, nicht die Rechnung
  assertStringIncludes(e, '21.11.: Unsere Rechnung Nr. RE-2026-7 über 595,00 € haben wir Ihnen geschickt.')
  assertStringIncludes(e, '19.11.: Ihre Zahlung zu Rechnung Nr. RE-2026-3 ist eingegangen.')
  assertStringIncludes(e, '17.11.: Der Termin für das Erstgespräch ist vereinbart.')
  assert(!e.includes('Mandantenmemo'), '„Stand geändert“ ist nicht erledigt')
  // nach Datum sortiert
  assert(b.erledigt.findIndex((z) => z.startsWith('17.11.')) < b.erledigt.findIndex((z) => z.startsWith('21.11.')))
})

Deno.test('Bericht: nächste Schritte und was wir brauchen', () => {
  const b = erstelleKundenbericht(eingabe())
  assertEquals(b.naechste[0], 'Unser nächster gemeinsamer Termin: Mi., 25.11.2026, 10:00 Uhr.')
  assert(!b.naechste.some((z) => z.includes('24.11.')), 'Termin ohne Gast ist intern')
  assert(b.naechste.includes('Wir geben den Entwurf an den Notar.'))
  assert(b.naechste.includes('Testamentsentwurf vorbereiten.'))
  assertEquals(b.naechste.length, 3)
  assertEquals(b.vonIhnen, [
    'Personalausweis',
    'Kontoauszüge der letzten drei Monate',
    'Der ausgefüllte Mandantenfragebogen',
    'Ihre Rückmeldung zu unserem Angebot „Erbfolgeberatung“ vom 16.11.2026',
  ])
  assertEquals(b.fehlendePunkte, ['Personalausweis'])
  assertEquals(b.ampel, 'gelb')
  assert(b.hinweise.some((h) => h.includes('3 Zeilen aus „Nächste Schritte“')), b.hinweise.join('\n'))
  assert(b.hinweise.some((h) => h.includes('2 offene Wiedervorlagen sind intern')), b.hinweise.join('\n'))
})

Deno.test('Bericht: ohne Offenes grün, Mailtext ohne Link-Absatz', () => {
  const b = erstelleKundenbericht(
    eingabe({
      akte: { id: 'k2', bereich: 'beratung', firma: 'Muster GmbH', ansprechpartner: '', email: '', verantwortlich: '', status: 'konzept', activities: [] },
      wiedervorlagen: [],
      mails: [],
      termine: [],
      kvs: [],
      rechnungen: [],
      stand: undefined,
    }),
  )
  assertEquals(b.ampel, 'gruen')
  assertEquals(b.anrede, 'Guten Tag Muster GmbH,')
  assertEquals(b.stand, '')
  const text = berichtAlsText(b, 'https://crm.test/x')
  assert(!text.includes('crm.test'), 'ohne fehlende Unterlagen kein Link')
  assertStringIncludes(text, 'In diesem Zeitraum gab es keine neuen Schritte')
  assertStringIncludes(text, 'Ihr Team der Mayer Holding')
  assert(b.hinweise.some((h) => h.includes('keine E-Mail-Adresse')))
  assertStringIncludes(kurzfassung(b), 'nichts offen beim Kunden')
})

Deno.test('Mailtext mit Link, wenn etwas fehlt', () => {
  const b = erstelleKundenbericht(eingabe())
  const text = berichtAlsText(b, 'https://crm.test/#/formular/unterlagen/abc')
  assertStringIncludes(text, 'Was wir noch von Ihnen brauchen:\n- Personalausweis')
  assertStringIncludes(text, 'https://crm.test/#/formular/unterlagen/abc\nDer Link ist 60 Tage gültig.')
  assertStringIncludes(text, 'Ampel: Gelb – Wir warten noch auf Unterlagen')
})

Deno.test('Zeitraum: Tag nach dem letzten Bericht, sonst sieben Tage', () => {
  assertEquals(standardSeit({ activities: [] }, null, '2026-11-22'), '2026-11-16')
  assertEquals(standardSeit({ activities: [] }, '2026-11-15', '2026-11-22'), '2026-11-16')
  assertEquals(standardSeit({ activities: [{ date: '2026-11-19', text: 'Statusbericht verschickt an x@y.de' }] }, '2026-11-15', '2026-11-22'), '2026-11-20')
  assertEquals(standardSeit({ activities: [] }, '2026-11-22', '2026-11-22'), '2026-11-16')
})

Deno.test('Fehlende Unterlagen: über alle Anforderungen, Checkliste und Erinnerungs-Links zählen', () => {
  const f = fehlendeUnterlagen({
    id: 'k',
    bereich: 'beratung',
    unterlagenAnforderungen: [
      { datum: '2026-11-20', art: 'erinnerung', punkte: ['A'], token: 't2', eingang: [{ punkt: 'A', datum: '2026-11-21' }] },
      { datum: '2026-11-01', art: 'anforderung', punkte: ['A', 'B', 'C'], token: 't1', eingang: [] },
    ],
    unterlagenCheckliste: { C: true },
  })
  assertEquals(f.punkte, ['B'])
})

Deno.test('Link auf die Akte öffnet das Fenster', () => {
  assertEquals(akteLink('https://crm.test/app', 'immobilienkunden', 'k 1'), 'https://crm.test/app/#/immobilien/kunden/k%201?tab=uebersicht&statusbericht=1')
  assertEquals(akteLink(null, 'akademie', 'k1'), 'https://eray-hash.github.io/mayer-holding-crm/#/akademie/teilnehmer/k1?tab=uebersicht&statusbericht=1')
})

Deno.test('Daten laden: Akte und Zusatztabellen, Fehler einzelner Teile werden gesammelt', async () => {
  const db = new FalscheDatenbank({
    kunden: [{ id: 'k1', bereich: 'erben', firma: 'F', ansprechpartner: 'P', verantwortlich: 'Hasan Süslü', status: 'x', activities: [], dokumente: [], unterlagen_anforderungen: [] }],
    wiedervorlagen: [{ id: 'w1', kunde_id: 'k1', regel: 'erb_notar', titel: 'T', faellig: '2026-11-25', quelle: 'regel', erledigt_am: null }],
    gesendete_emails: [
      { id: 'm1', kunde_id: 'k1', betreff: 'B', gesendet_am: '2026-11-20T08:00:00Z', besitzer_email: null },
      { id: 'm2', kunde_id: 'k1', betreff: 'Privat', gesendet_am: '2026-11-20T08:00:00Z', besitzer_email: 'x@y.de' },
    ],
    termine: [],
    kostenvoranschlaege: [{ id: 'kv1', kunde_id: 'k1', beschreibung: 'X', status: 'offen', betrag: '12.5', dokument: { kundeId: 'k1' } }],
    rechnungen: [{ id: 'r1', kunde_id: 'k1', nummer: 'RE-1', betrag_brutto: 10 }],
    mitarbeiter: [{ id: 'a', name: 'Hasan Süslü', aktiv: true }, { id: 'b', name: 'Alt', aktiv: false }],
    kundenbericht_einstellung: [{ id: 'k1', kunde_id: 'k1', letzter_versand: '2026-11-15' }],
  })
  const d = await ladeBerichtDaten(db, 'k1')
  assert(d)
  assertEquals(d.akte.verantwortlich, 'Hasan Süslü')
  assertEquals(d.wiedervorlagen.length, 1)
  assertEquals(d.mails.map((m) => m.id), ['m1'])
  assertEquals(d.kvs[0].betrag, 12.5)
  assertEquals(d.kvs[0].mitPdf, true)
  assertEquals(d.team, ['Hasan Süslü'])
  assertEquals(d.letzterVersand, '2026-11-15')
  assertEquals(d.fehler, [])
  assertEquals(await ladeBerichtDaten(db, 'gibtsnicht'), null)
})
