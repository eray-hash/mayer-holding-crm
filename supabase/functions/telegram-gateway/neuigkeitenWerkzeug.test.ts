// Prüft das Werkzeug neuigkeiten_im_crm mit der Testdatenbank (ohne Netz): Ungelesenes je Person, alle,
// als gelesen vermerken, Tipp der Woche an/aus.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreNeuigkeitenWerkzeugAus, istNeuigkeitenWerkzeug, type NeuigkeitenKontext } from './neuigkeitenWerkzeug.ts'

const QUIRIN = { name: 'Quirin Lutzenberger', email: 'Quirin@Mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'] }

const N = (id: string, bereiche: string[], rang: number) => ({
  id, datum: '2026-11-22', titel: `Titel ${id}`, text: `Text ${id}.`, bereiche, link: '/immobilien', telegram_beispiel: `Beispiel ${id}`, rang, aktiv: true,
})

function daten() {
  return falscheDatenbank({
    neuigkeiten: [N('immo', ['immobilien'], 30), N('gf', ['geschaeftsfuehrung'], 1), N('alle', ['alle'], 10)],
    neuigkeiten_gelesen: [],
    neuigkeiten_einstellung: [],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.example/' }],
  })
}

function kontext(db: ReturnType<typeof daten>): NeuigkeitenKontext & { protokoll: string[] } {
  const protokoll: string[] = []
  return { supabase: db, mitarbeiter: QUIRIN, protokolliere: (t) => protokoll.push(t), heute: '2026-11-23', protokoll }
}

Deno.test('Werkzeugname', () => {
  assert(istNeuigkeitenWerkzeug('neuigkeiten_im_crm'))
  assert(!istNeuigkeitenWerkzeug('objekt_luecken'))
})

Deno.test('Ungelesenes für Quirin, ohne Geschäftsführung, wichtigstes zuerst; dann als gelesen', async () => {
  const db = daten()
  const k = kontext(db)
  const t = await fuehreNeuigkeitenWerkzeugAus('neuigkeiten_im_crm', {}, k)
  assertStringIncludes(t, '2 ungelesene Neuerungen für dich')
  assert(!t.includes('Titel gf'))
  assert(t.indexOf('Titel alle') < t.indexOf('Titel immo'))
  assertStringIncludes(t, 'Im CRM: https://crm.example/#/immobilien')
  assertStringIncludes(t, 'Per Telegram: „Beispiel immo“')
  assertStringIncludes(t, 'Tipp der Woche per Telegram: an.')

  const t2 = await fuehreNeuigkeitenWerkzeugAus('neuigkeiten_im_crm', { als_gelesen: true }, k)
  assertStringIncludes(t2, '2 als gelesen vermerkt.')
  assertEquals(db.tabellen.neuigkeiten_gelesen.map((z) => z.email), ['quirin@mayer.de', 'quirin@mayer.de'])
  assertEquals(k.protokoll.length, 1)

  const t3 = await fuehreNeuigkeitenWerkzeugAus('neuigkeiten_im_crm', {}, k)
  assertStringIncludes(t3, 'keine ungelesenen Neuerungen')
  const t4 = await fuehreNeuigkeitenWerkzeugAus('neuigkeiten_im_crm', { alle: true }, k)
  assertStringIncludes(t4, 'Neuerungen im CRM (2, davon 0 ungelesen)')
  assertStringIncludes(t4, 'Titel immo (gelesen)')
})

Deno.test('Tipp der Woche aus und wieder an', async () => {
  const db = daten()
  const k = kontext(db)
  const aus = await fuehreNeuigkeitenWerkzeugAus('neuigkeiten_im_crm', { tipp_der_woche: false }, k)
  assertStringIncludes(aus, 'Tipp der Woche ist aus')
  assert(!aus.includes('Titel'))
  assertEquals(db.tabellen.neuigkeiten_einstellung[0].telegram_tipp, false)
  assertEquals(db.tabellen.neuigkeiten_einstellung[0].email, 'quirin@mayer.de')
  const an = await fuehreNeuigkeitenWerkzeugAus('neuigkeiten_im_crm', { tipp_der_woche: true }, k)
  assertStringIncludes(an, 'Tipp der Woche ist an')
  assertEquals(db.tabellen.neuigkeiten_einstellung.length, 1)
  assertEquals(db.tabellen.neuigkeiten_einstellung[0].telegram_tipp, true)
})

Deno.test('ohne E-Mail: Fehler', async () => {
  const k = kontext(daten())
  const t = await fuehreNeuigkeitenWerkzeugAus('neuigkeiten_im_crm', {}, { ...k, mitarbeiter: { ...QUIRIN, email: '' } })
  assert(t.startsWith('Fehler: '))
})
