// Grund-Vorschlag für entgangene Klienten: Auftragstext, Bereinigung der KI-Antwort, Ablauf mit Datenbank-Doppel.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { baueGrundPrompt, bereinigeGrund, schlageGrundVor, WERKZEUG } from './entgangen.ts'

// deno-lint-ignore no-explicit-any
function db(tabellen: Record<string, any[]>): any {
  return {
    from(name: string) {
      const zeilen = tabellen[name] ?? []
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: zeilen, error: null }),
        maybeSingle: () => Promise.resolve({ data: zeilen[0] ?? null, error: null }),
      }
      return q
    },
  }
}

const kunde = {
  id: 'k_test',
  status: 'angebot',
  auftrag_chance: { prozent: 20, begruendung: 'Angebot liegt beim Kunden' },
  follow_up: { date: '2026-10-01', note: 'Nachfassen', done: false },
  activities: [
    { id: '1', date: '2026-09-01', text: 'Angebot verschickt', user: 'A' },
    { id: '2', date: '2026-09-20', text: 'Anruf, nicht erreicht', user: 'A' },
  ],
}

Deno.test('baueGrundPrompt: enthält Kategorien, Verlauf (neueste zuerst), Protokolle und Rechnungen', () => {
  const p = baueGrundPrompt({
    kunde,
    protokolle: [{ datum: '2026-08-15', betreff: 'Erstgespräch', ki_zusammenfassung: 'Kunde will erst mit seinem Steuerberater sprechen.', offene_punkte: ['Rückmeldung'] }],
    rechnungen: [{ nummer: 'R-1', betrag_brutto: 119, status: 'Überfällig', zahlungsziel: '2026-09-01' }],
    heute: '2026-11-24',
  })
  assertStringIncludes(p, '- eigener_steuerberater: Bleibt beim eigenen Steuerberater')
  assert(p.indexOf('Anruf, nicht erreicht') < p.indexOf('Angebot verschickt'))
  assertStringIncludes(p, 'Kunde will erst mit seinem Steuerberater sprechen.')
  assertStringIncludes(p, 'R-1: 119 € brutto, Stand Überfällig')
  assertStringIncludes(p, '<akte>')
  assertEquals((WERKZEUG.input_schema.properties as Record<string, { enum?: string[] }>).grund.enum?.length, 10)
})

Deno.test('bereinigeGrund: unbekannt → sonstiges, Satz gekürzt', () => {
  assertEquals(bereinigeGrund({ grund: 'zu_teuer', satz: '  Fand das Angebot zu teuer. ' }), { grund: 'zu_teuer', satz: 'Fand das Angebot zu teuer.' })
  assertEquals(bereinigeGrund({ grund: 'quatsch', satz: 'x'.repeat(400) }).grund, 'sonstiges')
  assertEquals(bereinigeGrund({ grund: 'quatsch', satz: 'x'.repeat(400) }).satz.length, 300)
  assertEquals(bereinigeGrund(null), { grund: 'sonstiges', satz: '' })
})

Deno.test('schlageGrundVor: liest Akte und fragt die KI; fehlende Akte → 404', async () => {
  let gefragt = ''
  const e = await schlageGrundVor(db({ kunden: [kunde], protokolle: [], rechnungen: [] }), 'k_test', '2026-11-24', (prompt) => {
    gefragt = prompt
    return Promise.resolve({ grund: 'keine_rueckmeldung', satz: 'Nach dem Angebot nicht mehr erreicht.' })
  })
  assertEquals(e, { ok: true, vorschlag: { grund: 'keine_rueckmeldung', satz: 'Nach dem Angebot nicht mehr erreicht.' } })
  assertStringIncludes(gefragt, 'Stand der Akte: angebot')
  const leer = await schlageGrundVor(db({ kunden: [] }), 'k_fehlt', '2026-11-24', () => Promise.reject(new Error('darf nicht gefragt werden')))
  assertEquals(leer, { ok: false, status: 404, fehler: 'Diese Akte gibt es nicht (mehr).' })
})
