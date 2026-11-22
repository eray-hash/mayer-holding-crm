// Prüft das Werkzeug unterschrift_status mit einer nachgebauten Datenbank: Rechte je Bereich, private Akten,
// offene vs. alle, abgelaufene Frist.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { fuehreUnterschriftWerkzeugAus, istUnterschriftWerkzeug, wirklicherStatus } from './unterschriftWerkzeug.ts'

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

function falscheDb(tabellen: Record<string, Zeile[]>) {
  function abfrage(tabelle: string) {
    const filter: ((z: Zeile) => boolean)[] = []
    let einzeln = false
    const lauf = () => {
      const t = (tabellen[tabelle] ?? []).filter((z) => filter.every((f) => f(z))).map((z) => ({ ...z }))
      return { data: einzeln ? t[0] ?? null : t, error: null }
    }
    const q = {
      select: () => q,
      eq: (s: string, v: unknown) => (filter.push((z) => z[s] === v), q),
      gte: (s: string, v: string) => (filter.push((z) => String(z[s]) >= v), q),
      in: (s: string, v: unknown[]) => (filter.push((z) => v.includes(z[s])), q),
      order: () => q,
      limit: () => q,
      maybeSingle: () => ((einzeln = true), q),
      // deno-lint-ignore no-explicit-any
      then: (ok: (r: any) => unknown, nein?: (e: unknown) => unknown) => Promise.resolve(lauf()).then(ok, nein),
    }
    return q
  }
  return { from: abfrage }
}

const jetzt = new Date().toISOString()
function daten(): Record<string, Zeile[]> {
  return {
    kunden: [
      { id: 'k_ber', bereich: 'beratung', firma: 'Muster GmbH', ansprechpartner: 'Erika Muster', verantwortlich_email: 'h@x.de' },
      { id: 'k_erb', bereich: 'erben', firma: 'Familie Huber', ansprechpartner: null, verantwortlich_email: 'q@x.de' },
      { id: 'k_priv', bereich: 'privat', firma: 'Privat Fremd', ansprechpartner: null, verantwortlich_email: 'gf@x.de' },
    ],
    unterschrift_anfragen: [
      { id: 'u1', kunde_id: 'k_ber', bereich: 'beratung', titel: 'Beratungsvereinbarung', email: 'e@x.de', status: 'offen', gueltig_bis: '2099-01-01T00:00:00Z', zugriffe: 2, letzter_zugriff: jetzt, erstellt_von: 'Hasan Süslü', erstellt_am: jetzt },
      { id: 'u2', kunde_id: 'k_ber', bereich: 'beratung', titel: 'Allgemeine Vollmacht', email: null, status: 'unterschrieben', gueltig_bis: '2099-01-01T00:00:00Z', unterschrieben_am: jetzt, name_getippt: 'Erika Muster', dokument: 'k_ber/dok_x.pdf', erstellt_von: 'Hasan Süslü', erstellt_am: jetzt },
      { id: 'u3', kunde_id: 'k_erb', bereich: 'erben', titel: 'Vollmacht', email: 'h@y.de', status: 'offen', gueltig_bis: '2099-01-01T00:00:00Z', zugriffe: 0, erstellt_von: 'Quirin', erstellt_am: jetzt },
      { id: 'u4', kunde_id: 'k_priv', bereich: 'privat', titel: 'Geheim', email: null, status: 'offen', gueltig_bis: '2099-01-01T00:00:00Z', erstellt_von: 'GF', erstellt_am: jetzt },
      { id: 'u5', kunde_id: 'k_ber', bereich: 'beratung', titel: 'Alt', email: null, status: 'offen', gueltig_bis: '2000-01-01T00:00:00Z', erstellt_von: 'X', erstellt_am: jetzt },
    ],
  }
}

const nurBeratung = { name: 'Hasan Süslü', email: 'h@x.de', rolle: 'mitarbeiter', bereiche: ['beratung'] }
const gf = { name: 'Andreas Mayer', email: 'am@x.de', rolle: 'geschaeftsfuehrung', bereiche: [] }

function ctx(m: Zeile, db = daten()) {
  return { supabase: falscheDb(db), mitarbeiter: m as never, protokolliere: () => {}, heute: jetzt.slice(0, 10) }
}

Deno.test('Name und Status', () => {
  assert(istUnterschriftWerkzeug('unterschrift_status'))
  assertEquals(wirklicherStatus({ status: 'offen', gueltig_bis: '2000-01-01T00:00:00Z' }), 'abgelaufen')
})

Deno.test('Offene: nur sichtbare Akten, abgelaufene fallen weg, private Akten anderer nie', async () => {
  const r = await fuehreUnterschriftWerkzeugAus('unterschrift_status', {}, ctx(nurBeratung))
  assertStringIncludes(r, 'id=u1')
  assert(!r.includes('id=u3'), 'Erben nicht freigegeben')
  assert(!r.includes('id=u4'))
  assert(!r.includes('id=u5'), 'abgelaufen')
  assertStringIncludes(r, '2× geöffnet')
  const g = await fuehreUnterschriftWerkzeugAus('unterschrift_status', {}, ctx(gf))
  assertStringIncludes(g, 'id=u3')
  assert(!g.includes('id=u4'), 'private Akte eines anderen auch für die Geschäftsführung unsichtbar')
})

Deno.test('Je Akte: alle Anfragen mit Stand; fremder Bereich → nicht freigegeben; fremde private → nicht gefunden', async () => {
  const r = await fuehreUnterschriftWerkzeugAus('unterschrift_status', { kunde_id: 'k_ber' }, ctx(nurBeratung))
  assertStringIncludes(r, 'Unterschrieben')
  assertStringIncludes(r, 'als „Erika Muster“')
  assertStringIncludes(r, 'Link abgelaufen')
  assertStringIncludes(await fuehreUnterschriftWerkzeugAus('unterschrift_status', { kunde_id: 'k_erb' }, ctx(nurBeratung)), 'Nicht freigegeben')
  assertStringIncludes(await fuehreUnterschriftWerkzeugAus('unterschrift_status', { kunde_id: 'k_priv' }, ctx(gf)), 'Fehler: Es gibt keine Akte')
})
