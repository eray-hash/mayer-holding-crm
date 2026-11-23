// Prüft weitereVerweiseUmhaengen (aktenVerweise.ts) ohne Netz: Zeilen, die auf die doppelte Akte zeigen, wandern zur
// bleibenden — auch Kundenportal-Zugänge (die Datenbank löschte sie sonst mit), Mahn- und Rechnungsvorschläge.
import { assertEquals } from 'jsr:@std/assert@1'
import { FalscheDatenbank } from './testDoppel.ts'
import { WEITERE_VERWEISE, weitereVerweiseUmhaengen } from './aktenVerweise.ts'

Deno.test('Zusammenführen: Portal-Zugänge, Mahn- und Rechnungsvorschläge ziehen mit um', async () => {
  const db = new FalscheDatenbank({
    kunden_portal_zugaenge: [
      { id: 'p1', kunde_id: 'k_alt', kunde_bereich: 'beratung', status: 'aktiv' },
      { id: 'p2', kunde_id: 'k_anders', kunde_bereich: 'beratung', status: 'aktiv' },
    ],
    mahn_vorschlaege: [{ id: 'm1', kunde_id: 'k_alt', rechnung_id: 'r1', stufe: 'erinnerung' }],
    rechnung_vorschlaege: [{ id: 'v1', kunde_id: 'k_alt', status: 'offen' }],
    wiedervorlagen: [{ id: 'w1', kunde_id: 'k_alt' }],
  })
  const r = await weitereVerweiseUmhaengen(db, 'k_alt', 'k_neu')
  assertEquals(r.fehler, [])
  assertEquals(r.umgehaengt.kunden_portal_zugaenge, 1)
  assertEquals(r.umgehaengt.mahn_vorschlaege, 1)
  assertEquals(r.umgehaengt.rechnung_vorschlaege, 1)
  assertEquals(db.tabelle('kunden_portal_zugaenge').map((z) => z.kunde_id), ['k_neu', 'k_anders'])
  assertEquals(db.tabelle('mahn_vorschlaege')[0].kunde_id, 'k_neu')
  assertEquals(db.tabelle('rechnung_vorschlaege')[0].kunde_id, 'k_neu')
  assertEquals(db.tabelle('wiedervorlagen')[0].kunde_id, 'k_neu')
})

Deno.test('Liste enthält alle Tabellen mit Fremdschlüssel ON DELETE CASCADE auf kunden', () => {
  // Stand der Datenbank am 23.11.2026 (pg_constraint): ohne Umhängen gingen diese Zeilen beim Löschen verloren.
  const kaskade = ['wiedervorlagen', 'willkommen_nachrichten', 'kundenbericht_einstellung', 'unterschrift_anfragen', 'partner_bezug', 'kunden_portal_zugaenge']
  const bekannt = new Set(WEITERE_VERWEISE.map(([t]) => t))
  assertEquals(kaskade.filter((t) => !bekannt.has(t)), [])
})
