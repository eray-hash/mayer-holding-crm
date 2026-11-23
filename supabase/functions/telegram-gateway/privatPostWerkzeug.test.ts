// Prüft das Werkzeug meine_post_vorschlaege (privatPostWerkzeug.ts) ohne Netz: nur das eigene Postfach, Kandidaten nur
// mit Recht, Annehmen bei privatem Kontakt (bleibt privat) und bei einer Holding-Akte (Vorschlag leeren, übergeben,
// zuordnen über die Mail-Funktion), Verwerfen, Fehlerfälle.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { berlinTag, darfZiel, fuehrePrivatPostWerkzeugAus, istPrivatPostWerkzeug, type PrivatPostKontext } from './privatPostWerkzeug.ts'

const ICH = 'immo@amayer-holding.com'
const QUIRIN = { name: 'Quirin Lang', email: ICH, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['immobilien'], nurPrivat: true }

function vorschlag(kandidaten: unknown[], status = 'privat_offen') {
  return { art: 'privat', status, erstellt_am: '2026-11-22T10:00:00Z', kandidaten }
}

const K_HD = { kundeId: 'k_hd', bereich: 'immobilienkunden', name: 'HD-IMMO', grund: 'Absenderadresse ist in der Akte hinterlegt', privat: false, sicher: true }
const K_ERNA = { kundeId: 'k_priv', bereich: 'privat', name: 'Oma Erna', grund: 'Absender ist in der Akte hinterlegt', privat: true }
const K_LIPPS = { kundeId: 'k_lipps', bereich: 'beratung', name: 'Lipps', grund: 'Name steht in der Mail', privat: false }

function mails(): Zeile[] {
  return [
    { id: '00000000-0000-4000-8000-000000000001', message_id: 'pf_q:<a@x>', von: 'info@hdimmo.de', von_name: 'HD', betreff: 'Unterlagen', mail_datum: '2026-11-22T10:00:00Z', erstellt_am: '2026-11-22T10:00:00Z', ignoriert: false, besitzer_email: ICH, zugewiesener_kunde_id: null, zuordnung_vorschlag: vorschlag([K_HD, K_LIPPS]) },
    { id: '00000000-0000-4000-8000-000000000002', message_id: 'pf_q:<b@x>', von: 'erna@privat.de', von_name: 'Erna', betreff: 'Kuchen', mail_datum: '2026-11-21T10:00:00Z', erstellt_am: '2026-11-21T10:00:00Z', ignoriert: false, besitzer_email: ICH, zugewiesener_kunde_id: null, zuordnung_vorschlag: vorschlag([K_ERNA]) },
    { id: '00000000-0000-4000-8000-000000000003', message_id: 'pf_q:<c@x>', von: 'news@shop.de', von_name: 'Shop', betreff: 'Angebot', mail_datum: '2026-11-21T09:00:00Z', erstellt_am: '2026-11-21T09:00:00Z', ignoriert: false, besitzer_email: ICH, zugewiesener_kunde_id: null, zuordnung_vorschlag: { art: 'privat', status: 'privat_rundschreiben' } },
    // Fremdes privates Postfach: nie sichtbar.
    { id: '00000000-0000-4000-8000-000000000004', message_id: 'pf_e:<d@x>', von: 'info@hdimmo.de', von_name: 'HD', betreff: 'Geheim', mail_datum: '2026-11-22T11:00:00Z', erstellt_am: '2026-11-22T11:00:00Z', ignoriert: false, besitzer_email: 'eray@fundament-it.de', zugewiesener_kunde_id: null, zuordnung_vorschlag: vorschlag([K_HD]) },
  ]
}

function aufbau() {
  const db = new FalscheDatenbank({
    eingegangene_emails: mails(),
    kunden: [
      { id: 'k_hd', bereich: 'immobilienkunden', firma: 'HD-IMMO', ansprechpartner: 'Helmut Dick', verantwortlich_email: null, activities: [] },
      { id: 'k_lipps', bereich: 'beratung', firma: 'Lipps', ansprechpartner: 'Lipps', verantwortlich_email: null, activities: [] },
      { id: 'k_priv', bereich: 'privat', firma: 'Oma Erna', ansprechpartner: 'Erna', verantwortlich_email: ICH, activities: [{ id: 'alt', text: 'alt' }] },
      { id: 'k_priv_fremd', bereich: 'privat', firma: 'Fremd', ansprechpartner: 'Fremd', verantwortlich_email: 'eray@fundament-it.de', activities: [] },
      { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärt', ansprechpartner: '', verantwortlich_email: null, activities: [] },
    ],
  })
  const aufrufe: { action: string; body: Record<string, unknown> }[] = []
  const protokoll: string[] = []
  let fehlerBei = ''
  const ctx: PrivatPostKontext = {
    supabase: db,
    mitarbeiter: QUIRIN,
    protokolliere: (t) => protokoll.push(t),
    heute: '2026-11-22',
    mailFunktion: (action, body) => {
      aufrufe.push({ action, body })
      if (action === fehlerBei) return Promise.reject(new Error('Server sagt nein'))
      if (action === 'mail_freigeben') {
        const z = db.tabelle('eingegangene_emails').find((m) => m.message_id === body.id)!
        z.besitzer_email = null
      }
      return Promise.resolve(action === 'mail_zuordnen' ? { ok: true, abgelegt: 2 } : { ok: true })
    },
  }
  return { db, ctx, aufrufe, protokoll, setzeFehler: (a: string) => (fehlerBei = a) }
}

Deno.test('Werkzeug-Name', () => {
  assert(istPrivatPostWerkzeug('meine_post_vorschlaege'))
  assert(!istPrivatPostWerkzeug('privater_bereich'))
})

Deno.test('darfZiel: eigene private, Holding nach Bereichsrecht (auch im privaten Assistenten), keine Sammelakten', () => {
  assert(darfZiel(QUIRIN, { id: 'k_priv', bereich: 'privat', firma: '', ansprechpartner: '', verantwortlich_email: ICH }))
  assert(!darfZiel(QUIRIN, { id: 'k_x', bereich: 'privat', firma: '', ansprechpartner: '', verantwortlich_email: 'eray@fundament-it.de' }))
  assert(darfZiel(QUIRIN, { id: 'k_hd', bereich: 'immobilienkunden', firma: '', ansprechpartner: '', verantwortlich_email: null }))
  assert(!darfZiel(QUIRIN, { id: 'k_lipps', bereich: 'beratung', firma: '', ansprechpartner: '', verantwortlich_email: null }))
  assert(!darfZiel({ ...QUIRIN, rolle: 'geschaeftsfuehrung' }, { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: '', ansprechpartner: '', verantwortlich_email: null }))
})

Deno.test('liste: nur eigene Mails, Kandidaten ohne Recht fallen weg, Rundschreiben gezählt', async () => {
  const { ctx } = aufbau()
  const r = await fuehrePrivatPostWerkzeugAus('meine_post_vorschlaege', { aktion: 'liste' }, ctx)
  const daten = JSON.parse(r)
  assertEquals(daten.offen, 2)
  assertEquals(daten.rundschreiben_ausgeblendet, 1)
  assertEquals(daten.vorschlaege[0].kandidaten.map((k: { kunde_id: string }) => k.kunde_id), ['k_hd'])
  assertEquals(daten.vorschlaege[1].kandidaten[0].privater_kontakt, true)
  assert(!r.includes('Geheim'))
  assert(!r.includes('Lipps'))
})

Deno.test('annehmen privater Kontakt: bleibt privat, Verlauf beim Kontakt, keine Mail-Funktion', async () => {
  const { db, ctx, aufrufe, protokoll } = aufbau()
  const r = await fuehrePrivatPostWerkzeugAus('meine_post_vorschlaege', { aktion: 'annehmen', mail_id: 'pf_q:<b@x>' }, ctx)
  assertStringIncludes(r, 'bleibt privat')
  const z = db.tabelle('eingegangene_emails').find((m) => m.message_id === 'pf_q:<b@x>')!
  assertEquals([z.besitzer_email, z.zugewiesener_kunde_id, z.zugewiesener_bereich], [ICH, 'k_priv', 'privat'])
  assertEquals((z.zuordnung_vorschlag as { status: string }).status, 'privat_uebernommen')
  const k = db.tabelle('kunden').find((x) => x.id === 'k_priv')!
  assertEquals((k.activities as unknown[]).length, 2)
  assertEquals(aufrufe.length, 0)
  assertEquals(protokoll.length, 1)
})

Deno.test('annehmen Holding-Akte: Vorschlag geleert, übergeben, zugeordnet', async () => {
  const { db, ctx, aufrufe } = aufbau()
  const r = await fuehrePrivatPostWerkzeugAus('meine_post_vorschlaege', { aktion: 'annehmen', mail_id: 'pf_q:<a@x>', kunde_id: 'k_hd' }, ctx)
  assertStringIncludes(r, 'Erledigt')
  assertStringIncludes(r, '2 Anhänge')
  assertEquals(aufrufe.map((a) => a.action), ['mail_freigeben', 'mail_zuordnen'])
  assertEquals(aufrufe[0].body.imAuftragVon, ICH)
  assertEquals(aufrufe[1].body.kundeId, 'k_hd')
  const z = db.tabelle('eingegangene_emails').find((m) => m.message_id === 'pf_q:<a@x>')!
  const v = z.zuordnung_vorschlag as Record<string, unknown>
  assertEquals(v.status, 'privat_uebernommen')
  assertEquals(v.kandidaten, undefined)
})

Deno.test('annehmen: ohne kunde_id bei mehreren Kandidaten, Akte ohne Recht, fremde Mail, fremder Privatkontakt → Fehler', async () => {
  const { ctx, aufrufe } = aufbau()
  assertStringIncludes(await fuehrePrivatPostWerkzeugAus('meine_post_vorschlaege', { aktion: 'annehmen', mail_id: 'pf_q:<a@x>' }, ctx), 'Fehler: Bitte kunde_id')
  assertStringIncludes(await fuehrePrivatPostWerkzeugAus('meine_post_vorschlaege', { aktion: 'annehmen', mail_id: 'pf_q:<a@x>', kunde_id: 'k_lipps' }, ctx), 'nicht freigegeben')
  assertStringIncludes(await fuehrePrivatPostWerkzeugAus('meine_post_vorschlaege', { aktion: 'annehmen', mail_id: 'pf_e:<d@x>', kunde_id: 'k_hd' }, ctx), 'Fehler: Diese Mail liegt nicht')
  assertStringIncludes(await fuehrePrivatPostWerkzeugAus('meine_post_vorschlaege', { aktion: 'annehmen', mail_id: 'pf_q:<b@x>', kunde_id: 'k_priv_fremd' }, ctx), 'Fehler: Diese Akte gibt es nicht')
  assertEquals(aufrufe.length, 0)
})

Deno.test('annehmen: Übergabe scheitert → Vorschlag wiederhergestellt, Mail bleibt privat', async () => {
  const { db, ctx, setzeFehler } = aufbau()
  setzeFehler('mail_freigeben')
  const r = await fuehrePrivatPostWerkzeugAus('meine_post_vorschlaege', { aktion: 'annehmen', mail_id: 'pf_q:<a@x>', kunde_id: 'k_hd' }, ctx)
  assertStringIncludes(r, 'Fehler beim Übergeben')
  const z = db.tabelle('eingegangene_emails').find((m) => m.message_id === 'pf_q:<a@x>')!
  assertEquals(z.besitzer_email, ICH)
  assertEquals((z.zuordnung_vorschlag as { status: string }).status, 'privat_offen')
})

Deno.test('verwerfen', async () => {
  const { db, ctx } = aufbau()
  const r = await fuehrePrivatPostWerkzeugAus('meine_post_vorschlaege', { aktion: 'verwerfen', mail_id: '00000000-0000-4000-8000-000000000001' }, ctx)
  assertStringIncludes(r, 'verworfen')
  const z = db.tabelle('eingegangene_emails').find((m) => m.message_id === 'pf_q:<a@x>')!
  assertEquals((z.zuordnung_vorschlag as { status: string }).status, 'privat_verworfen')
})

Deno.test('berlinTag: Tag in deutscher Ortszeit, nicht in UTC', () => {
  // 23:30 UTC im Winter = 00:30 Uhr am nächsten Tag in Deutschland.
  assertEquals(berlinTag('2026-11-21T23:30:00+00:00'), '2026-11-22')
  // Sommerzeit: 22:30 UTC = 00:30 Uhr.
  assertEquals(berlinTag('2026-07-01T22:30:00Z'), '2026-07-02')
  assertEquals(berlinTag('2026-11-22T10:00:00Z'), '2026-11-22')
  assertEquals(berlinTag(null), '')
  assertEquals(berlinTag('kaputt'), 'kaputt')
})
