// Prüft rendite_rechnen und rendite_pruefstein an einer nachgebauten Datenbank (ohne Netz): Vorbefüllen aus der
// Akte, Angaben aus dem Gespräch, Speichern nur der Spalte rendite (Markt und Prüfsteine bleiben), Probe ohne
// Speichern, Start des Marktvergleichs über den Rückruf, PDF in „Kostenaufstellung“, Rechte.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { angabenAusEingabe, fuehreRenditeWerkzeugAus, istRenditeWerkzeug, type RenditeKontext } from './renditeWerkzeuge.ts'

function objekt(over: Record<string, unknown> = {}) {
  return {
    id: 'o_remstal',
    bezeichnung: 'Boarding House Remstal',
    adresse: 'Teckstraße 62, 73547 Lorch-Weitmars',
    typ: 'Gewerbe',
    kaufpreis: 1_200_000,
    verkaufsdaten: null,
    kurzpruefung: null,
    bewertung: null,
    dokumente: {},
    activities: [{ id: 'a1', date: '2026-11-22', text: 'Laut Exposé 15 Appartements, ca. 590 m² Hotelfläche, Kaufpreis 1.200.000 € zzgl. 3,57 % Käuferprovision.', user: 'Eray' }],
    rendite: { version: 1, markt: { status: 'fertig', preisJeQmVon: 2800, preisJeQmBis: 3000, mieteJeQmVon: 12.5, mieteJeQmBis: 15.5, stand: '2026-11-22', quellen: [{ titel: 'Q', url: 'https://q.de' }] }, pruefsteine: { brandschutz: { erledigt: true } } },
    privat_besitzer: null,
    ...over,
  }
}

function kontext(db: ReturnType<typeof falscheDatenbank>, over: Partial<RenditeKontext> = {}): RenditeKontext & { log: string[] } {
  const log: string[] = []
  return {
    supabase: db,
    mitarbeiter: { name: 'Andreas Mayer', email: 'am@beispiel.de', rolle: 'geschaeftsfuehrung', bereiche: [] },
    protokolliere: (t) => log.push(t),
    heute: '2026-11-22',
    log,
    ...over,
  }
}

// deno-lint-ignore no-explicit-any
const rendite = (db: ReturnType<typeof falscheDatenbank>): any => (db.tabelle('objekte')[0] as any).rendite

Deno.test('Werkzeugnamen', () => {
  assert(istRenditeWerkzeug('rendite_rechnen'))
  assert(istRenditeWerkzeug('rendite_pruefstein'))
  assert(!istRenditeWerkzeug('objekt_anlegen'))
})

Deno.test('Angaben aus dem Gespräch: deutsche Zahlen, ungültige Werte als Fehler', () => {
  const a = angabenAusEingabe({ miete: '12,50', miete_art: 'qm_monat', pacht: true, bundesland: 'bw', zins_prozent: '3,9' })
  assertEquals(a.eingaben, { miete: 12.5, mieteArt: 'qm_monat', pacht: true, bundesland: 'BW', zinsProzent: 3.9 })
  assertStringIncludes(angabenAusEingabe({ zins_prozent: 'viel' }).fehler!, 'Fehler: zins_prozent')
  assertStringIncludes(angabenAusEingabe({ makler_prozent: 35 }).fehler!, 'Fehler')
})

Deno.test('Rechnen mit Akte + Pacht aus dem Gespräch: Zahlen, Marktvergleich, gespeichert ohne Markt zu verlieren', async () => {
  const db = falscheDatenbank({ objekte: [objekt()] })
  const k = kontext(db)
  const antwort = await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'o_remstal', miete: 12.5, pacht: true }, k)
  assertStringIncludes(antwort, 'objekt_id=o_remstal')
  assertStringIncludes(antwort, '2.034 €/m²')
  assertStringIncludes(antwort, 'Bruttorendite 7,38 %')
  assertStringIncludes(antwort, 'Preis günstig')
  assertStringIncludes(antwort, 'Gespeichert in der Objektakte')
  assertStringIncludes(antwort, 'Offene Prüfsteine: Genehmigung der Nutzung')
  assert(!antwort.includes('Offene Prüfsteine: Genehmigung der Nutzung, Brandschutz'))
  const r = rendite(db)
  assertEquals(r.eingaben.flaeche, 590)
  assertEquals(r.eingaben.maklerProzent, 3.57)
  assertEquals(r.eingaben.bundesland, 'BW')
  assertEquals(r.eingaben.miete, 12.5)
  assertEquals(r.herkunft.miete, 'Angabe per Telegram (Andreas Mayer)')
  assertEquals(r.herkunft.flaeche, 'Verlauf der Objektakte')
  assertEquals(r.ergebnis.jahresmieteSoll, 88_500)
  assertEquals(r.markt.preisJeQmVon, 2800)
  assertEquals(r.pruefsteine.brandschutz.erledigt, true)
  assertEquals(r.berechnetVon, 'Andreas Mayer')
  assertEquals(k.log.length, 1)
  // Nur die Spalte rendite wurde geschrieben.
  // deno-lint-ignore no-explicit-any
  assertEquals((db.tabelle('objekte')[0] as any).activities.length, 1)
})

Deno.test('Gespeicherte Eingaben gelten weiter; ohne_finanzierung entfernt das Darlehen; probe speichert nichts', async () => {
  const db = falscheDatenbank({ objekte: [objekt({ rendite: { version: 1, eingaben: { kaufpreis: 1_200_000, flaeche: 590, miete: 13, mieteArt: 'qm_monat', zinsProzent: 4, eigenkapital: 400_000 } } })] })
  const k = kontext(db)
  const mit = await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'o_remstal', probe: true }, k)
  assertStringIncludes(mit, 'Mit Darlehen')
  assertStringIncludes(mit, 'nichts gespeichert')
  assertEquals(rendite(db).ergebnis, undefined)
  const ohne = await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'o_remstal', ohne_finanzierung: true }, k)
  assertStringIncludes(ohne, 'Ohne Darlehen')
  assertEquals(rendite(db).eingaben.zinsProzent, undefined)
  assertEquals(rendite(db).eingaben.miete, 13)
})

Deno.test('Marktvergleich wird über den Rückruf gestartet; ohne Rückruf ein Hinweis', async () => {
  const db = falscheDatenbank({ objekte: [objekt()] })
  const gestartet: string[] = []
  const k = kontext(db, { starteMarktvergleich: (id) => (gestartet.push(id), Promise.resolve(null)) })
  const a = await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'o_remstal', markt_vergleich: true }, k)
  assertEquals(gestartet, ['o_remstal'])
  assertStringIncludes(a, 'Vergleich vor Ort gestartet')
  const ohne = await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'o_remstal', markt_vergleich: true }, kontext(db))
  assertStringIncludes(ohne, 'Vergleich vor Ort prüfen')
  const fehler = await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'o_remstal', markt_vergleich: true }, kontext(db, { starteMarktvergleich: () => Promise.resolve('läuft schon') }))
  assertStringIncludes(fehler, 'Fehler beim Start des Vergleichs vor Ort: läuft schon')
})

Deno.test('Als PDF: liegt im Ordner Kostenaufstellung der Objektakte', async () => {
  const db = falscheDatenbank({ objekte: [objekt()] })
  const a = await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'o_remstal', miete: 12.5, als_pdf: true }, kontext(db))
  assertStringIncludes(a, 'Ordner Kostenaufstellung')
  // deno-lint-ignore no-explicit-any
  const doks = (db.tabelle('objekte')[0] as any).dokumente.Kostenaufstellung
  assertEquals(doks.length, 1)
  assertStringIncludes(doks[0].name, 'Rendite-Check Boarding House Remstal')
  assertEquals(doks[0].typ, 'application/pdf')
  assert(db.ablage.get('objekt-dokumente')?.has(doks[0].url))
})

Deno.test('Prüfstein abhaken und wieder öffnen, andere bleiben', async () => {
  const db = falscheDatenbank({ objekte: [objekt()] })
  const k = kontext(db)
  const a = await fuehreRenditeWerkzeugAus('rendite_pruefstein', { objekt_id: 'o_remstal', pruefstein: 'genehmigung', erledigt: true, notiz: 'Baugenehmigung 2005 liegt vor' }, k)
  assertStringIncludes(a, 'als geklärt abgehakt')
  assertEquals(rendite(db).pruefsteine.genehmigung, { erledigt: true, notiz: 'Baugenehmigung 2005 liegt vor', am: '2026-11-22', von: 'Andreas Mayer' })
  assertEquals(rendite(db).pruefsteine.brandschutz.erledigt, true)
  assertEquals(rendite(db).markt.preisJeQmVon, 2800)
  const b = await fuehreRenditeWerkzeugAus('rendite_pruefstein', { objekt_id: 'o_remstal', pruefstein: 'brandschutz', erledigt: false }, k)
  assertStringIncludes(b, 'wieder auf offen')
  assertStringIncludes(await fuehreRenditeWerkzeugAus('rendite_pruefstein', { objekt_id: 'o_remstal', pruefstein: 'dach', erledigt: true }, k), 'Fehler')
})

Deno.test('Rechte: ohne Immobilien-Freigabe und bei fremden privaten Objekten nichts', async () => {
  const db = falscheDatenbank({ objekte: [objekt()] })
  const ohne = kontext(db, { mitarbeiter: { name: 'Test', email: 't@beispiel.de', rolle: 'mitarbeiter', bereiche: ['beratung'] } })
  const a = await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'o_remstal' }, ohne)
  assert(!a.includes('Bruttorendite'))
  assertEquals(rendite(db).ergebnis, undefined)
  const priv = falscheDatenbank({ objekte: [objekt({ privat_besitzer: 'hasan@beispiel.de' })] })
  const b = await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'o_remstal' }, kontext(priv))
  assertStringIncludes(b, 'Fehler: Es gibt kein Objekt')
  assertStringIncludes(await fuehreRenditeWerkzeugAus('rendite_rechnen', { objekt_id: 'gibtsnicht' }, kontext(db)), 'Fehler')
})
