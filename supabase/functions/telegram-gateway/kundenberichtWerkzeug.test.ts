// Prüft das Werkzeug statusbericht_entwurf (ohne Netz): Rechte je Bereich, private Akten, Sammelakten,
// Inhalt des Entwurfs und dass nichts geschrieben oder gesendet wird.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { fuehreBerichtWerkzeugAus, istBerichtWerkzeug, type BerichtKontext } from './kundenberichtWerkzeug.ts'
import { FalscheDatenbank, type AbfrageInfo } from '../_shared/testDoppel.ts'

function db() {
  return new FalscheDatenbank({
    kunden: [
      {
        id: 'k1',
        bereich: 'erben',
        firma: 'Familie Beispiel',
        ansprechpartner: 'Thomas Beispiel',
        email: 'thomas@beispiel.de',
        verantwortlich: 'Hasan Süslü',
        status: 'erstkontakt',
        naechste_schritte: 'Testament prüfen\nQuirin klärt Provision',
        activities: [{ date: '2026-11-20', text: 'Notiz: Kunde wirkt knapp bei Kasse', user: 'Hasan Süslü' }],
        dokumente: [],
        unterlagen_anforderungen: [{ datum: '2026-11-10', art: 'anforderung', punkte: ['Personalausweis'], token: 't', eingang: [] }],
      },
      { id: 'p1', bereich: 'privat', firma: 'Privat', verantwortlich_email: 'eray@test.de' },
      { id: 'k_intern_holding', bereich: 'beratung', firma: 'Intern' },
    ],
    wiedervorlagen: [],
    gesendete_emails: [],
    termine: [],
    kostenvoranschlaege: [],
    rechnungen: [],
    mitarbeiter: [{ id: 'a', name: 'Hasan Süslü', aktiv: true }, { id: 'b', name: 'Quirin Lutzenberger', aktiv: true }],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.test/' }],
  })
}

function ctx(d: FalscheDatenbank, m: Partial<BerichtKontext['mitarbeiter']> = {}): BerichtKontext & { protokoll: string[] } {
  const protokoll: string[] = []
  return {
    supabase: d,
    mitarbeiter: { name: 'Hasan Süslü', email: 'hasan@test.de', rolle: 'mitarbeiter', bereiche: ['erben'], ...m },
    protokolliere: (t) => protokoll.push(t),
    heute: '2026-11-22',
    protokoll,
  }
}

Deno.test('Entwurf: Text für den Kunden, nichts Internes, Link ins CRM, nichts geschrieben', async () => {
  const d = db()
  const schreiben: AbfrageInfo[] = []
  const urspruenglich = d.from.bind(d)
  // Jede Abfrage mitschreiben, um sicherzugehen, dass nur gelesen wird.
  d.from = (t: string) => {
    const q = urspruenglich(t)
    for (const art of ['insert', 'update', 'upsert', 'delete'] as const) {
      // deno-lint-ignore no-explicit-any
      const alt = (q as any)[art].bind(q)
      // deno-lint-ignore no-explicit-any
      ;(q as any)[art] = (...a: unknown[]) => (schreiben.push({ tabelle: t, art, anzahl: 1 }), alt(...a))
    }
    return q
  }
  const c = ctx(d)
  assert(istBerichtWerkzeug('statusbericht_entwurf'))
  const r = await fuehreBerichtWerkzeugAus('statusbericht_entwurf', { kunde_id: 'k1' }, c)
  assertStringIncludes(r, 'ENTWURF (nicht gesendet). Zeitraum 16.11.2026 bis 22.11.2026.')
  assertStringIncludes(r, 'Guten Tag Thomas Beispiel,')
  assertStringIncludes(r, '- Personalausweis')
  assertStringIncludes(r, '[Link zum Hochladen — wird beim Senden im CRM erzeugt]')
  assertStringIncludes(r, '- Testament prüfen.')
  assert(!r.includes('knapp bei Kasse'), r)
  assert(!r.split('---')[1].includes('Quirin'), 'Kollege nicht im Kundentext')
  assertStringIncludes(r, 'Nur für den Mitarbeiter')
  assertStringIncludes(r, 'https://crm.test/#/erben/mandanten/k1?tab=uebersicht&statusbericht=1')
  assertEquals(schreiben, [])
  assertEquals(c.protokoll.length, 1)
})

Deno.test('Entwurf: eigener Zeitraum', async () => {
  const r = await fuehreBerichtWerkzeugAus('statusbericht_entwurf', { kunde_id: 'k1', seit: '2026-11-01' }, ctx(db()))
  assertStringIncludes(r, 'Zeitraum 01.11.2026 bis 22.11.2026')
})

Deno.test('Rechte: fremder Bereich, private Akte, Sammelakte, unbekannte Akte', async () => {
  const fremd = await fuehreBerichtWerkzeugAus('statusbericht_entwurf', { kunde_id: 'k1' }, ctx(db(), { bereiche: ['immobilien'] }))
  assertStringIncludes(fremd, 'Nicht freigegeben')
  assert(!fremd.includes('Beispiel'))
  const gf = await fuehreBerichtWerkzeugAus('statusbericht_entwurf', { kunde_id: 'k1' }, ctx(db(), { rolle: 'geschaeftsfuehrung', bereiche: [] }))
  assertStringIncludes(gf, 'ENTWURF')
  assertStringIncludes(await fuehreBerichtWerkzeugAus('statusbericht_entwurf', { kunde_id: 'p1' }, ctx(db())), 'gibt es für dich nicht')
  assertStringIncludes(await fuehreBerichtWerkzeugAus('statusbericht_entwurf', { kunde_id: 'p1' }, ctx(db(), { email: 'eray@test.de' })), 'private Kontakte')
  assertStringIncludes(await fuehreBerichtWerkzeugAus('statusbericht_entwurf', { kunde_id: 'k_intern_holding' }, ctx(db(), { rolle: 'geschaeftsfuehrung' })), 'Sammelakten')
  assertStringIncludes(await fuehreBerichtWerkzeugAus('statusbericht_entwurf', { kunde_id: 'xx' }, ctx(db())), 'keine Akte')
  assertStringIncludes(await fuehreBerichtWerkzeugAus('statusbericht_entwurf', {}, ctx(db())), 'kunde_id fehlt')
})
