// Prüft das Werkzeug termin_briefing (ohne Netz, ohne echte KI): bestimmter Termin, nächster Termin,
// Akte ohne Termin, Rechte (Bereich, private Akte, fremder Termin, privater Assistent), nichts geschrieben.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { fuehreBriefingWerkzeugAus, istBriefingWerkzeug, type BriefingKontext } from './briefingWerkzeug.ts'
import { FalscheDatenbank, type AbfrageInfo } from '../_shared/testDoppel.ts'

const JETZT = new Date('2026-11-25T09:00:00Z')
const ANDREAS = 'andreas@mayer.test'
const HASAN = 'hasan@mayer.test'

function termin(t: Record<string, unknown>) {
  return { titel: 'Termin', ort: '', beginn: '2026-11-27T13:00:00.000Z', ende: '2026-11-27T14:00:00.000Z', ganztags: false, besitzer_email: ANDREAS, teilnehmer: [], kunde_id: null, kunde_bereich: null, kunde_name: null, quelle: 'crm', gast: null, ms_teilnehmer: null, ...t }
}

function db() {
  return new FalscheDatenbank({
    termine: [
      termin({ id: 't_blocker', titel: 'Blocker', beginn: '2026-11-26T08:00:00.000Z', ende: '2026-11-26T09:00:00.000Z' }),
      termin({ id: 't_lehle', titel: 'Josef Lehle kommt nach Ulm', kunde_id: 'k_lehle', kunde_bereich: 'erben', teilnehmer: [HASAN] }),
      termin({ id: 't_fremd', titel: 'Termin von Hasan', besitzer_email: HASAN, kunde_id: 'k_lehle' }),
      termin({ id: 't_besichtigung', titel: 'Besichtigung', beginn: '2026-11-28T10:00:00.000Z', ende: '2026-11-28T11:00:00.000Z' }),
    ],
    mitarbeiter: [
      { id: 'a', name: 'Andreas Mayer', email: ANDREAS, aktiv: true },
      { id: 'h', name: 'Hasan Süslü', email: HASAN, aktiv: true },
    ],
    kunden: [
      { id: 'k_lehle', bereich: 'erben', firma: 'Josef Lehle', ansprechpartner: 'Josef Lehle', email: 'jl@beispiel.test', status: 'erstkontakt', sachverhalt: 'Nachfolge regeln.', activities: [], dokumente: [], unterlagen_anforderungen: [] },
      { id: 'k_privat', bereich: 'privat', firma: 'Max Huber', ansprechpartner: 'Max Huber', verantwortlich_email: HASAN, status: 'neu', activities: [] },
      { id: 'k_beratung', bereich: 'beratung', firma: 'Muster GmbH', ansprechpartner: 'Erika Muster', status: 'lead', activities: [] },
    ],
    objekte: [{ id: 'o1', bezeichnung: 'Lagerhalle Neu-Ulm', adresse: 'Neu-Ulm', status: 'vermarktung', privat_besitzer: null, activities: [], dokumente: {}, unterlagen_anforderungen: [] }],
    besichtigungen: [{ id: 'b1', objekt_id: 'o1', kalender_termin_id: 't_besichtigung', interessent: 'Familie Kaiser', beginn: '2026-11-28T10:00:00.000Z', status: 'geplant' }],
    wiedervorlagen: [],
    eingegangene_emails: [],
    gesendete_emails: [],
    protokolle: [],
    rechnungen: [],
    kostenvoranschlaege: [],
    willkommen_einstellung: [{ id: 1, link_basis: 'https://crm.test/' }],
  })
}

function ctx(d: FalscheDatenbank, m: Partial<BriefingKontext['mitarbeiter']> = {}, punkte: string[] = ['Stand der Nachfolge besprechen.']): BriefingKontext & { protokoll: string[] } {
  const protokoll: string[] = []
  return {
    supabase: d,
    mitarbeiter: { name: 'Andreas Mayer', email: ANDREAS, rolle: 'geschaeftsfuehrung', bereiche: [], ...m },
    protokolliere: (t) => protokoll.push(t),
    heute: '2026-11-25',
    jetzt: JETZT,
    apiKey: 'test',
    ki: () => Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'tool_use', input: { punkte } }] }), { status: 200 })),
    protokoll,
  }
}

Deno.test('Name erkannt', () => {
  assert(istBriefingWerkzeug('termin_briefing'))
  assert(!istBriefingWerkzeug('termine_zeigen'))
})

Deno.test('Ohne Angabe: nächster eigener Termin mit Bezug (Blocker übersprungen), nichts geschrieben', async () => {
  const d = db()
  const schreiben: AbfrageInfo[] = []
  d.nachAbfrage = (i) => {
    if (i.art !== 'select') schreiben.push(i)
  }
  const c = ctx(d)
  const r = await fuehreBriefingWerkzeugAus('termin_briefing', {}, c)
  assertStringIncludes(r, 'Josef Lehle kommt nach Ulm')
  assertStringIncludes(r, 'Akte: Josef Lehle (Erben)')
  assertStringIncludes(r, 'Sachverhalt: Nachfolge regeln.')
  assertStringIncludes(r, '• Stand der Nachfolge besprechen.')
  assert(!r.includes('Blocker'))
  assertEquals(schreiben, [])
  assertEquals(c.protokoll.length, 1)
})

Deno.test('termin_id: fremder Termin gibt es nicht; eigener als Teilnehmer schon', async () => {
  const d = db()
  assertStringIncludes(await fuehreBriefingWerkzeugAus('termin_briefing', { termin_id: 't_fremd' }, ctx(d)), 'Fehler: Diesen Termin gibt es nicht')
  const r = await fuehreBriefingWerkzeugAus('termin_briefing', { termin_id: 't_lehle' }, ctx(d, { name: 'Hasan Süslü', email: HASAN, rolle: 'mitarbeiter', bereiche: ['erben'] }))
  assertStringIncludes(r, 'Briefing zum Termin')
  assertStringIncludes(r, 'Dabei: Andreas Mayer, Hasan Süslü')
})

Deno.test('Rechte: Bereich nicht freigegeben, private Akte eines Kollegen, privater Assistent', async () => {
  const d = db()
  const quirin = { name: 'Quirin', email: 'quirin@mayer.test', rolle: 'mitarbeiter', bereiche: ['immobilien'] }
  assertStringIncludes(await fuehreBriefingWerkzeugAus('termin_briefing', { kunde_id: 'k_lehle' }, ctx(d, quirin)), 'Nicht freigegeben')
  assertStringIncludes(await fuehreBriefingWerkzeugAus('termin_briefing', { kunde_id: 'k_privat' }, ctx(d)), 'Fehler: Diese Akte gibt es für dich nicht.')
  const privat = await fuehreBriefingWerkzeugAus('termin_briefing', { kunde_id: 'k_privat' }, ctx(d, { name: 'Hasan Süslü', email: HASAN, rolle: 'mitarbeiter', bereiche: [] }))
  assertStringIncludes(privat, 'Max Huber (Privat)')
  assertStringIncludes(privat, 'https://crm.test/#/privat/kontakte/k_privat')
  assertStringIncludes(await fuehreBriefingWerkzeugAus('termin_briefing', { kunde_id: 'k_lehle' }, ctx(d, { nurPrivat: true })), 'Fehler: Diese Akte gibt es für dich nicht.')
})

Deno.test('kunde_id ohne Termin: Briefing zur Akte; objekt_id: Besichtigungstermin', async () => {
  const d = db()
  const r = await fuehreBriefingWerkzeugAus('termin_briefing', { kunde_id: 'k_beratung' }, ctx(d))
  assertStringIncludes(r, 'Kein anstehender Termin zu dieser Akte')
  assertStringIncludes(r, 'Stand: Neuanfrage')
  const o = await fuehreBriefingWerkzeugAus('termin_briefing', { objekt_id: 'o1' }, ctx(d, { bereiche: ['immobilien'], rolle: 'mitarbeiter' }))
  assertStringIncludes(o, 'Besichtigung')
  assertStringIncludes(o, 'Objekt Lagerhalle Neu-Ulm')
  assertStringIncludes(o, 'Stand: Aktiv in Vermarktung')
  assertStringIncludes(o, 'https://crm.test/#/immobilien/objekte/o1')
})

Deno.test('KI ohne Schlüssel: Briefing ohne Gesprächspunkte', async () => {
  const d = db()
  const c = { ...ctx(d), apiKey: null }
  const r = await fuehreBriefingWerkzeugAus('termin_briefing', { termin_id: 't_lehle' }, c)
  assert(!r.includes('Gesprächspunkte'))
  assertStringIncludes(r, 'Akte öffnen:')
})
