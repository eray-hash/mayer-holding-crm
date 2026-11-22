// Prüft das Werkzeug verbindlichkeiten_pruefen mit einer nachgebauten Datenbank (ohne Netz).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { fuehreVerbindlichkeitenWerkzeugAus, istVerbindlichkeitenWerkzeug, VERBINDLICHKEITEN_WERKZEUGE } from './verbindlichkeitenWerkzeug.ts'

const gf = { name: 'Andreas', email: 'gf@x.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const erben = { name: 'Erbin', email: 'e@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['erben'] }

const tabellen = (): Record<string, Zeile[]> => ({
  verbindlichkeiten: [
    { id: 'v1', lieferant: 'IONOS SE', rechnungsnummer: 'R1', datum: '2026-11-10', betrag_netto: 35.29, betrag_brutto: 42, status: 'offen', quelle: 'email-automatisch', geprueft: null, beleg: { name: 'a.pdf', url: 'verbindlichkeiten/a.pdf' }, automatisch_erkannt: { stand: 'fertig', felder: ['betrag_netto'] } },
    { id: 'v2', lieferant: 'Europcar', rechnungsnummer: '1101305537', datum: '2026-10-27', betrag_netto: null, betrag_brutto: null, status: 'offen', quelle: 'email-automatisch', geprueft: false, beleg: null, automatisch_erkannt: null },
    { id: 'v3', lieferant: 'Cloud Space Review', rechnungsnummer: null, datum: '2026-11-22', betrag_netto: null, betrag_brutto: null, status: 'offen', quelle: 'email-automatisch', geprueft: null, beleg: null, automatisch_erkannt: { stand: 'fertig', art: 'keine_rechnung', felder: [] } },
    { id: 'v4', lieferant: 'Amazon EU', rechnungsnummer: 'LU63', datum: '2026-07-10', betrag_netto: 41.47, betrag_brutto: 49.35, status: 'bezahlt', quelle: 'manuell', geprueft: null, beleg: null, automatisch_erkannt: null },
  ],
})

function ctx(mitarbeiter: Zeile, t = tabellen()) {
  const db = falscheDatenbank(t)
  // deno-lint-ignore no-explicit-any
  return { db, k: { supabase: db, mitarbeiter: mitarbeiter as any, protokolliere: () => {}, heute: '2026-11-22' } }
}

Deno.test('Werkzeugliste', () => {
  assertEquals(VERBINDLICHKEITEN_WERKZEUGE.map((w) => w.name), ['verbindlichkeiten_pruefen'])
  assert(istVerbindlichkeitenWerkzeug('verbindlichkeiten_pruefen'))
  assert(!istVerbindlichkeitenWerkzeug('export_steuerberater_status'))
})

Deno.test('Unvollständige Verbindlichkeiten mit Grund und id', async () => {
  const { k } = ctx(gf)
  const t = await fuehreVerbindlichkeitenWerkzeugAus('verbindlichkeiten_pruefen', {}, k)
  assertStringIncludes(t, '4 Verbindlichkeiten geprüft: 3 unvollständig, 3 automatisch erkannt')
  assertStringIncludes(t, 'Europcar Nr. 1101305537 vom 27.10.2026 — fehlt: Beleg fehlt; Betrag fehlt (Verbindlichkeit id=v2)')
  assertStringIncludes(t, 'Cloud Space Review vom 22.11.2026 — fehlt: Wohl keine echte Rechnung')
  assertStringIncludes(t, 'Amazon EU Nr. LU63 vom 10.07.2026, 49,35 € (bezahlt) — fehlt: Beleg fehlt')
  assert(!t.includes('id=v1')) // nur Hinweise
  const mit = await fuehreVerbindlichkeitenWerkzeugAus('verbindlichkeiten_pruefen', { mit_hinweisen: true, mit_bezahlten: false }, k)
  assertStringIncludes(mit, '(nur offene)')
  assertStringIncludes(mit, 'Automatisch ergänzt: Nettobetrag — bitte prüfen (Verbindlichkeit id=v1)')
  assert(!mit.includes('id=v4'))
})

Deno.test('Ohne Bereich Beratung: nicht freigegeben', async () => {
  const { k } = ctx(erben)
  assertStringIncludes(await fuehreVerbindlichkeitenWerkzeugAus('verbindlichkeiten_pruefen', {}, k), 'Nicht freigegeben')
})

Deno.test('Spalte automatisch_erkannt fehlt noch: Werkzeug läuft ohne sie', async () => {
  const { db, k } = ctx(gf)
  const orig = db.from.bind(db)
  // deno-lint-ignore no-explicit-any
  ;(db as any).from = (tabelle: string) => {
    const q = orig(tabelle)
    const sel = q.select.bind(q)
    // deno-lint-ignore no-explicit-any
    ;(q as any).select = (s: string) => (s.includes('automatisch_erkannt') ? { order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'column verbindlichkeiten.automatisch_erkannt does not exist' } }) }) } : sel(s))
    return q
  }
  const t = await fuehreVerbindlichkeitenWerkzeugAus('verbindlichkeiten_pruefen', {}, k)
  assertStringIncludes(t, '4 Verbindlichkeiten geprüft')
})
