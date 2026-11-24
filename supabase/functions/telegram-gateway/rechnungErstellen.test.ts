// Rechnung ausstellen, versenden, Follow-up — mit nachgebauter Datenbank (ohne Netz, erfundene Namen):
// Nummer nach dem Schema der Geschäftsführung (Kürzel einmal fest, laufende Nummer), gleichzeitige Vergabe, Eintrag wie
// das CRM, PDF in der Akte, Rechte, fehlende Anschrift, Versand nur vorbereitet, Anhang laden, Status nach dem Versand.
//
//   npx -y deno test --allow-all telegram-gateway/rechnungErstellen.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { folgeNachVersand, fuehreRechnungErstellenWerkzeugAus, type RechnungErstellenKontext, type RechnungMailEntwurf, rechnungNachVersand, versandAnhaenge } from './rechnungErstellen.ts'

const HEUTE = '2026-11-24'
const gf = { name: 'Erika Beispiel', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] as string[] }
const immo = { name: 'Ingo Immo', email: 'i@x.de', rolle: 'mitarbeiter', bereiche: ['immobilien'] }

const tabellen = (): Record<string, Zeile[]> => ({
  kunden: [
    { id: 'k_ls', bereich: 'beratung', status: 'erstkontakt', firma: 'Lukas Sommerfeld', ansprechpartner: 'Lukas und Stefan', anschrift: 'Musterweg 5\n89073 Ulm', email: 'lukas@beispiel.example', verantwortlich_email: null, dokumente: [], activities: [], rechnungs_kuerzel: null, follow_up: null },
    { id: 'k_cl', bereich: 'beratung', firma: 'Carl Lohmann', ansprechpartner: 'Carl Lohmann', anschrift: 'Weg 1\n10115 Berlin', email: 'c@beispiel.example', dokumente: [], activities: [], rechnungs_kuerzel: null },
    { id: 'k_ohne', bereich: 'beratung', firma: 'Otto Ohnadresse', anschrift: '', email: 'o@beispiel.example', dokumente: [], activities: [], rechnungs_kuerzel: null },
    { id: 'k_priv', bereich: 'privat', firma: 'Paul Privat', verantwortlich_email: 'gf@x.de', anschrift: 'Weg 2\n89073 Ulm', dokumente: [], activities: [], rechnungs_kuerzel: null },
  ],
  rechnungen: [{ id: 'r_alt', nummer: 'CL-001', kunde_id: 'k_cl', datum: '2026-11-05', status: 'Bezahlt', betrag_netto: 100, betrag_brutto: 119, zahlungsziel: '2026-11-19' }],
  wiedervorlage_regeln: [{ id: 'allg_geldeingang', ausloeser: 'ereignis:rechnung', bereich: null, titel: 'Geldeingang prüfen', tage: 0, aktiv: true }],
  wiedervorlagen: [],
  mahn_einstellung: [{ id: 1, aktiv: true, tage_erinnerung: 3, tage_mahnung1: 14, tage_mahnung2: 28, ruhe_tage_zahlung: 3 }],
  mahn_vorschlaege: [],
  crm_module: [{ id: 'e_rechnung', aktiv: true }],
})

function umgebung(mitarbeiter: Zeile = gf, db = falscheDatenbank(tabellen())) {
  const entwuerfe: RechnungMailEntwurf[] = []
  const k: RechnungErstellenKontext = {
    supabase: db,
    // deno-lint-ignore no-explicit-any
    mitarbeiter: mitarbeiter as any,
    protokolliere: () => {},
    heute: HEUTE,
    merkeMailEntwurf: (e) => entwuerfe.push(e),
  }
  return { db, k, entwuerfe }
}

const AUFTRAG = { kunde_id: 'k_ls', positionen: [{ bezeichnung: 'Beratungsleistung laut Vereinbarung', einzelpreis: 5000 }] }

Deno.test('rechnung_erstellen: LSA-001 mit festem Kürzel, Eintrag wie im CRM, PDF in der Akte, Follow-up', async () => {
  const { db, k } = umgebung()
  const text = await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', AUFTRAG, k)
  assertStringIncludes(text, 'Rechnung LSA-001 erstellt')
  assertStringIncludes(text, 'brutto 5.950,00 €')
  assertStringIncludes(text, 'Neues festes Rechnungskürzel für diesen Kunden: LSA')
  assertStringIncludes(text, '08.12. Zahlungsziel Rechnung LSA-001')
  assertStringIncludes(text, 'Zahlungserinnerung')
  const r = db.tabelle('rechnungen').find((x) => x.nummer === 'LSA-001')!
  assertEquals([r.status, r.kunde_id, r.datum, r.zahlungsziel, r.betrag_netto, r.betrag_brutto, r.ust_satz, r.anschrift, r.leistung_bezeichnung], ['Entwurf', 'k_ls', HEUTE, '2026-12-08', 5000, 5950, 19, 'Musterweg 5\n89073 Ulm', 'Beratungsleistung laut Vereinbarung'])
  assert(String(r.id).startsWith('r_'))
  assertEquals((r.positionen as Zeile[])[0].einheit, 'Pauschal')
  const akte = db.tabelle('kunden').find((x) => x.id === 'k_ls')!
  assertEquals(akte.rechnungs_kuerzel, 'LSA')
  const dok = (akte.dokumente as Zeile[])[0]
  assertEquals(dok.name, 'Rechnung LSA-001 (24.11.2026).pdf')
  assertEquals((r.dokument as Zeile).dokumentId, dok.id)
  const datei = db.ablage.get('kunden-dokumente')!.get(String(dok.url))!
  assertEquals((await PDFDocument.load(datei.bytes)).getTitle(), 'Rechnung LSA-001')
  assertStringIncludes(String((akte.activities as Zeile[])[0].text), 'Rechnung LSA-001 über 5.950,00 € erstellt')

  // Zweite Rechnung desselben Kunden: gleiches Kürzel, nächste Nummer.
  const zweite = await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', { ...AUFTRAG, positionen: [{ bezeichnung: 'Workshop', menge: 2, einheit: 'Tag', einzelpreis: 900 }], ust_satz: 7 }, k)
  assertStringIncludes(zweite, 'Rechnung LSA-002 erstellt')
  assert(!zweite.includes('Neues festes Rechnungskürzel'))
  assertEquals(db.tabelle('rechnungen').find((x) => x.nummer === 'LSA-002')!.betrag_brutto, 1926)
  // Der Kunde mit der alten CL-001 bekommt CLA-001 (alte Nummer bleibt unverändert).
  assertStringIncludes(await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', { ...AUFTRAG, kunde_id: 'k_cl' }, k), 'Rechnung CLA-001 erstellt')
  assert(db.tabelle('rechnungen').some((x) => x.nummer === 'CL-001'))
})

Deno.test('rechnung_erstellen: gleichzeitig vergebene Nummer → nächste, nichts doppelt', async () => {
  const db = falscheDatenbank(tabellen())
  let einmal = false
  const zwischen = {
    storage: db.storage,
    from: (t: string) => {
      const q = db.from(t)
      if (t === 'rechnungen' && !einmal) {
        const original = q.insert.bind(q)
        // deno-lint-ignore no-explicit-any
        ;(q as any).insert = (z: Zeile) => {
          einmal = true
          // Ein anderer Aufruf war schneller und hat dieselbe Nummer gespeichert.
          db.tabelle('rechnungen').push({ ...z, id: 'r_fremd' })
          void original
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "rechnungen_nummer_eindeutig"' } })
        }
      }
      return q
    },
  }
  const { k } = umgebung(gf, db)
  // deno-lint-ignore no-explicit-any
  k.supabase = zwischen as any
  const text = await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', AUFTRAG, k)
  assertStringIncludes(text, 'Rechnung LSA-002 erstellt')
  const nummern = db.tabelle('rechnungen').map((r) => r.nummer)
  assertEquals(nummern.filter((n) => n === 'LSA-001').length, 1)
  assertEquals(nummern.filter((n) => n === 'LSA-002').length, 1)
})

Deno.test('rechnung_erstellen: Rechte, private Kontakte, fehlende Anschrift, 0 % ohne Grund', async () => {
  const { db, k } = umgebung(immo)
  assertStringIncludes(await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', AUFTRAG, k), 'Unternehmensberatung')
  const g = umgebung(gf, db).k
  assertStringIncludes(await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', { ...AUFTRAG, kunde_id: 'k_priv' }, g), 'private Kontakte')
  assertStringIncludes(await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', { ...AUFTRAG, kunde_id: 'k_ohne' }, g), 'keine vollständige Anschrift')
  assertStringIncludes(await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', { ...AUFTRAG, ust_satz: 0 }, g), 'Bei 0 % Umsatzsteuer')
  assertEquals(db.tabelle('rechnungen').length, 1)
  // Mit genannter Anschrift: erstellt und in der Akte nachgetragen.
  assertStringIncludes(await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', { ...AUFTRAG, kunde_id: 'k_ohne', anschrift: 'Hauptstraße 3, 89073 Ulm' }, g), 'Rechnung OOA-001 erstellt')
  assertEquals(db.tabelle('kunden').find((x) => x.id === 'k_ohne')!.anschrift, 'Hauptstraße 3\n89073 Ulm')
})

Deno.test('rechnung_versenden: nur vorbereitet, Anhang PDF + XRechnung; nach dem Versand Versendet und Follow-up', async () => {
  const { db, k, entwuerfe } = umgebung()
  await fuehreRechnungErstellenWerkzeugAus('rechnung_erstellen', AUFTRAG, k)
  const text = await fuehreRechnungErstellenWerkzeugAus('rechnung_versenden', { nummer: 'lsa-001' }, k)
  assertStringIncludes(text, 'NOCH NICHT GESENDET')
  assertStringIncludes(text, 'lukas@beispiel.example')
  assertStringIncludes(text, 'Anhang: Rechnung LSA-001 (24.11.2026).pdf')
  assertStringIncludes(text, 'XRechnung')
  assertEquals(entwuerfe.length, 1)
  const e = entwuerfe[0]
  assertEquals(e.betreff, 'Rechnung LSA-001')
  assertEquals(e.empfaenger[0].kunde_id, 'k_ls')
  // Noch nichts geändert.
  assertEquals(db.tabelle('rechnungen').find((x) => x.nummer === 'LSA-001')!.status, 'Entwurf')

  const anhaenge = await versandAnhaenge(db, e)
  assert(Array.isArray(anhaenge))
  assertEquals(anhaenge.map((a) => a.filename), ['Rechnung LSA-001 (24.11.2026).pdf', 'LSA-001_XRechnung.xml'])
  assert(atob(anhaenge[0].contentBase64).startsWith('%PDF'))
  assertEquals(await versandAnhaenge(db, { anhaenge: [] }), [])
  assertEquals(typeof (await versandAnhaenge(db, { anhaenge: [{ ...e.anhaenge[0], pfad: 'gibt/es/nicht.pdf' }] })), 'string')

  await rechnungNachVersand(db, e.rechnung, 'lukas@beispiel.example', 'Erika Beispiel', HEUTE)
  const r = db.tabelle('rechnungen').find((x) => x.nummer === 'LSA-001')!
  assertEquals([r.status, r.versendet_am, r.versendet_an], ['Versendet', HEUTE, 'lukas@beispiel.example'])
  // Die Datenbank legt beim Statuswechsel die Wiedervorlage an (Trigger wv_rechnung) — hier von Hand nachgestellt.
  db.tabelle('wiedervorlagen').push({ id: 'wv_1', kunde_id: 'k_ls', regel: 'allg_geldeingang', titel: 'Geldeingang prüfen', faellig: '2026-12-08', quelle: 'regel', erledigt_am: null })
  const folge = await folgeNachVersand(db, e.rechnung, HEUTE)
  assertStringIncludes(folge, 'steht jetzt auf Versendet')
  assertStringIncludes(folge, '08.12. Zahlungsziel Rechnung LSA-001: 5.950,00 € offen; Wiedervorlage: Geldeingang prüfen (automatisch)')
  assertStringIncludes(folge, '11.12. Zahlungserinnerung')
  assertStringIncludes(String((db.tabelle('kunden').find((x) => x.id === 'k_ls')!.activities as Zeile[])[0].text), 'per E-Mail an lukas@beispiel.example gesendet')

  // Bezahlt: kein Versand.
  r.status = 'Bezahlt'
  assertStringIncludes(await fuehreRechnungErstellenWerkzeugAus('rechnung_versenden', { rechnung_id: r.id }, k), 'schon bezahlt')
})

Deno.test('followup_naechste_schritte: Akte ohne Rechnungen, Rechte', async () => {
  const { k } = umgebung()
  const t = await fuehreRechnungErstellenWerkzeugAus('followup_naechste_schritte', { kunde_id: 'k_ls' }, k)
  assertStringIncludes(t, 'Keine offenen Follow-up-Schritte')
  assertStringIncludes(await fuehreRechnungErstellenWerkzeugAus('followup_naechste_schritte', { kunde_id: 'k_ls' }, umgebung(immo).k), 'Unternehmensberatung')
})
