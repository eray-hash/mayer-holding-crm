// Prüft alles_durchsuchen ohne Netz: Anfrage an suche_alles, Rechte je Mitarbeiter (Bereiche, private
// Akten/Objekte/Postfächer, freigegebene To-do-Listen, privater Assistent), Arten-Filter und Ausgabe.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { darfTreffer, fuehreSucheWerkzeugAus, istSucheWerkzeug, type SucheKontext, type SuchTreffer } from './sucheWerkzeug.ts'

function t(art: string, id: string, extra: Partial<SuchTreffer> = {}): SuchTreffer {
  return { art, id, titel: `Titel ${id}`, untertitel: null, ausschnitt: `Die ⟦Kaution⟧ bei ${id}`, ziel: null, datum: '2026-11-04T10:00:00Z', rang: 1, bereich: null, besitzer: null, bezug_art: null, bezug_id: null, bezug_besitzer: null, ...extra }
}

// Was suche_alles mit Dienstschlüssel liefert (alles, mit Rechte-Spalten)
const TREFFER: SuchTreffer[] = [
  t('akte', 'k_beratung', { bereich: 'beratung', bezug_art: 'akte', bezug_id: 'k_beratung' }),
  t('akte', 'k_erben', { bereich: 'erben', bezug_art: 'akte', bezug_id: 'k_erben' }),
  t('akte', 'k_eingang_ungeklaert', { bereich: 'beratung', bezug_art: 'akte', bezug_id: 'k_eingang_ungeklaert' }),
  t('akte', 'k_privat_hasan', { bereich: 'privat', bezug_art: 'akte', bezug_id: 'k_privat_hasan', bezug_besitzer: 'Hasan@X.de' }),
  t('akte', 'k_privat_andere', { bereich: 'privat', bezug_art: 'akte', bezug_id: 'k_privat_andere', bezug_besitzer: 'andere@x.de' }),
  t('objekt', 'o_holding', { bereich: 'immobilien', bezug_art: 'objekt', bezug_id: 'o_holding' }),
  t('objekt', 'o_privat_andere', { bereich: 'privat', bezug_art: 'objekt', bezug_id: 'o_privat_andere', bezug_besitzer: 'andere@x.de' }),
  t('dokument', 'dok_beratung', { bereich: 'beratung', bezug_art: 'akte', bezug_id: 'k_beratung' }),
  t('dokument', 'dok_erben', { bereich: 'erben', bezug_art: 'akte', bezug_id: 'k_erben' }),
  t('dokument', 'dok_objekt', { bereich: 'immobilien', bezug_art: 'objekt', bezug_id: 'o_holding' }),
  t('dokument', 'dok_privat_andere', { bereich: 'privat', bezug_art: 'akte', bezug_id: 'k_privat_andere', bezug_besitzer: 'andere@x.de' }),
  t('mail', 'm_frei'),
  t('mail', 'm_beratung', { bereich: 'beratung', bezug_art: 'akte', bezug_id: 'k_beratung' }),
  t('mail', 'm_erben', { bereich: 'erben', bezug_art: 'akte', bezug_id: 'k_erben' }),
  t('mail', 'm_eigen', { besitzer: 'hasan@x.de' }),
  t('mail', 'm_andere_privat', { besitzer: 'andere@x.de' }),
  t('gesendet', 'g_privat_akte_andere', { bereich: 'privat', bezug_art: 'akte', bezug_id: 'k_privat_andere', bezug_besitzer: 'andere@x.de' }),
  t('protokoll', 'p_beratung', { bereich: 'beratung', bezug_art: 'akte', bezug_id: 'k_beratung' }),
  t('protokoll', 'p_privat_andere', { bereich: 'privat', bezug_art: 'akte', bezug_id: 'k_privat_andere', bezug_besitzer: 'andere@x.de' }),
  t('todo', 't_eigen', { besitzer: 'hasan@x.de' }),
  t('todo', 't_freigegeben', { besitzer: 'chef@x.de' }),
  t('todo', 't_fremd', { besitzer: 'andere@x.de' }),
  t('todo', 't_immo', { bereich: 'immobilien', besitzer: 'andere@x.de' }),
  t('wiedervorlage', 'w_beratung', { bereich: 'beratung', bezug_art: 'akte', bezug_id: 'k_beratung' }),
  t('wiedervorlage', 'w_privat', { bereich: 'privat', bezug_art: 'akte', bezug_id: 'k_privat_hasan', bezug_besitzer: 'hasan@x.de' }),
  t('buch', 'b_1', { bereich: 'buecher' }),
  t('partner', 'pa_1'),
]

function kontext(m: Record<string, unknown> = {}, treffer = TREFFER, rpcFehler?: string) {
  const db = falscheDatenbank({
    todo_freigaben: [
      { id: 'f1', besitzer_email: 'Chef@x.de', empfaenger_email: 'hasan@x.de', recht: 'lesen' },
      { id: 'f2', besitzer_email: 'andere@x.de', empfaenger_email: 'dritte@x.de', recht: 'lesen' },
    ],
  })
  const aufrufe: { fn: string; args: Record<string, unknown> }[] = []
  Object.assign(db, {
    rpc: (fn: string, args: Record<string, unknown>) => {
      aufrufe.push({ fn, args })
      return Promise.resolve(rpcFehler ? { data: null, error: { message: rpcFehler } } : { data: structuredClone(treffer), error: null })
    },
  })
  const k: SucheKontext = {
    supabase: db,
    mitarbeiter: { name: 'Hasan', email: 'hasan@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'], ...m },
    protokolliere: () => {},
    heute: '2026-11-22',
  }
  return { k, aufrufe }
}

function kennungen(text: string): string[] {
  return [...text.matchAll(/\[(?:\w+_id|id)=([^,\]]+)/g)].map((m) => m[1]).sort()
}

Deno.test('Werkzeugname', () => {
  assert(istSucheWerkzeug('alles_durchsuchen'))
  assert(!istSucheWerkzeug('kunden_suchen'))
})

Deno.test('Anfrage geht als tsquery an suche_alles, großzügige Grenze', async () => {
  const { k, aufrufe } = kontext()
  await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: 'Kaution "drei Monatsmieten" -Entwurf' }, k)
  assertEquals(aufrufe, [{ fn: 'suche_alles', args: { q: 'kaution:* & (drei <-> monatsmieten) & !entwurf:*', grenze: 60 } }])
})

Deno.test('Mitarbeiter mit Bereich Beratung: nur Erlaubtes, private Dinge nur eigene', async () => {
  const { k } = kontext()
  const r = await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: 'Kaution', je_art: 15 }, k)
  const soll = [
    'k_beratung', 'k_eingang_ungeklaert', 'k_privat_hasan',
    'dok_beratung',
    'm_frei', 'm_beratung', 'm_eigen',
    'p_beratung',
    't_eigen', 't_freigegeben',
    'w_beratung',
    'pa_1',
  ].sort()
  assertEquals(kennungen(r), soll)
  // Fundstelle ohne Markierung, Kennungen für die Folgewerkzeuge
  assertStringIncludes(r, '„Die Kaution bei k_beratung“')
  assertStringIncludes(r, '[dokument_id=dok_beratung, kunde_id=k_beratung]')
  assertStringIncludes(r, '[mail_id=m_eigen, eigenes Postfach]')
  assertStringIncludes(r, 'Akten (3):')
  assertStringIncludes(r, '04.11.2026')
})

Deno.test('Geschäftsführung sieht alle Bereiche, aber nie Privates von Kollegen', async () => {
  const { k } = kontext({ rolle: 'geschaeftsfuehrung', email: 'chef@x.de' })
  const r = await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: 'Kaution', je_art: 15 }, k)
  const ids = kennungen(r)
  for (const id of ['k_beratung', 'k_erben', 'o_holding', 'dok_erben', 'dok_objekt', 'm_erben', 't_immo', 't_freigegeben', 'b_1', 'pa_1']) assert(ids.includes(id), id)
  for (const id of ['k_privat_hasan', 'k_privat_andere', 'o_privat_andere', 'dok_privat_andere', 'm_eigen', 'm_andere_privat', 'g_privat_akte_andere', 'p_privat_andere', 't_eigen', 't_fremd', 'w_privat']) assert(!ids.includes(id), id)
})

Deno.test('Privater Assistent: nur eigene private Akten, eigene Mails und eigene To-do-Liste', async () => {
  const { k } = kontext({ nurPrivat: true, rolle: 'geschaeftsfuehrung' })
  const r = await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: 'Kaution', je_art: 15 }, k)
  assertEquals(kennungen(r), ['k_privat_hasan', 'm_eigen', 't_eigen'].sort())
})

Deno.test('Arten eingrenzen und je_art begrenzen', async () => {
  const { k } = kontext({ rolle: 'geschaeftsfuehrung', email: 'chef@x.de' })
  const r = await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: 'Kaution', arten: ['dokument', 'unsinn'], je_art: 1 }, k)
  assertEquals(kennungen(r).length, 1)
  assertStringIncludes(r, 'Dokumente (1 von 3):')
  assert(!r.includes('Akten ('))
})

Deno.test('Leere oder zu kurze Anfrage, Datenbankfehler, keine Treffer', async () => {
  const { k, aufrufe } = kontext()
  assertStringIncludes(await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: 'a' }, k), 'Fehler: ')
  assertStringIncludes(await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: '-Kaution' }, k), 'Fehler: ')
  assertEquals(aufrufe.length, 0)
  assertStringIncludes(await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: 'Kaution' }, kontext({}, TREFFER, 'Zeitüberschreitung').k), 'Fehler: Die Suche hat nicht geklappt (Zeitüberschreitung)')
  assertStringIncludes(await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: 'Kaution' }, kontext({}, []).k), 'Keine Treffer für „Kaution“')
  // Nur Unerlaubtes gefunden → wie keine Treffer, ohne Hinweis auf das Verborgene
  const nurFremd = await fuehreSucheWerkzeugAus('alles_durchsuchen', { suchbegriff: 'Kaution' }, kontext({}, [TREFFER[1], TREFFER[4]]).k)
  assertStringIncludes(nurFremd, 'Keine Treffer')
  assert(!nurFremd.includes('k_erben'))
})

Deno.test('darfTreffer: Grenzfälle', () => {
  const m = { email: 'hasan@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung', 'immobilien'] }
  // private Akte ohne bekannten Besitzer: für niemanden
  assert(!darfTreffer(m, t('akte', 'x', { bereich: 'privat', bezug_art: 'akte', bezug_id: 'x' })))
  // Dokument ohne Bezug: nie
  assert(!darfTreffer(m, t('dokument', 'x')))
  // Mail mit Zuordnung ohne Bereich: wie im Postfach erlaubt
  assert(darfTreffer(m, t('mail', 'x', { bezug_art: 'akte', bezug_id: 'k' })))
  // Immobilienkunden-Akte mit Recht „immobilien“
  assert(darfTreffer(m, t('akte', 'x', { bereich: 'immobilienkunden', bezug_art: 'akte', bezug_id: 'x' })))
  // Privates Objekt: Groß-/Kleinschreibung egal
  assert(darfTreffer(m, t('objekt', 'o', { bezug_art: 'objekt', bezug_id: 'o', bezug_besitzer: 'HASAN@x.de' })))
  // To-do ohne Bereich und ohne Besitzer: nie
  assert(!darfTreffer(m, t('todo', 'x')))
  // Unbekannte Art: nie
  assert(!darfTreffer(m, t('termin', 'x')))
})
