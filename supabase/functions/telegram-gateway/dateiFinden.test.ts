// Werkzeug datei_finden (sucheWerkzeug.ts) ohne Netz: lädt Akten, Objekte und Kurzfassungen, hält die Rechte ein
// (Bereiche, Sammelakten, private Akten/Objekte, privater Assistent) und findet Dateien unscharf. Erfundene Namen.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreSucheWerkzeugAus, istSucheWerkzeug, type SucheKontext, zeitraumAus } from './sucheWerkzeug.ts'

const dok = (id: string, name: string, datum: string, url = `k/${id}.pdf`) => ({ id, name, datum, url, typ: 'application/pdf' })

function db() {
  return falscheDatenbank({
    kunden: [
      { id: 'k_beratung', bereich: 'beratung', firma: 'Beispiel GmbH', ansprechpartner: null, verantwortlich_email: null, dokumente: [dok('d_b1', 'Übersichtsliste Kunden.xlsx', '2026-11-24', 'k_beratung/dok_aa11bb22cc33_Uebersichtsliste.xlsx')] },
      { id: 'k_erben', bereich: 'erben', firma: 'Erbfall Probe', ansprechpartner: null, verantwortlich_email: null, dokumente: [dok('d_e1', 'Übersichtsliste Nachlass.xlsx', '2026-11-24')] },
      { id: 'k_intern_holding', bereich: 'beratung', firma: 'Intern', ansprechpartner: null, verantwortlich_email: null, dokumente: [dok('d_i1', 'Liste Beträge Abteilung.xlsx', '2026-11-23')] },
      { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärt', ansprechpartner: null, verantwortlich_email: null, dokumente: [dok('d_u1', 'Scan Mietvertrag.pdf', '2026-11-20', 'k_eingang_ungeklaert/scan.pdf')] },
      { id: 'k_privat_eigen', bereich: 'privat', firma: 'Eigener Kontakt', ansprechpartner: null, verantwortlich_email: 'ich@x.de', dokumente: [dok('d_p1', 'Übersichtsliste privat.xlsx', '2026-11-24')] },
      { id: 'k_privat_fremd', bereich: 'privat', firma: 'Fremder Kontakt', ansprechpartner: null, verantwortlich_email: 'andere@x.de', dokumente: [dok('d_p2', 'Übersichtsliste fremd.xlsx', '2026-11-24')] },
    ],
    objekte: [
      { id: 'o_holding', bezeichnung: 'Wohnhaus', adresse: 'Musterweg 1', privat_besitzer: null, dokumente: { Grundbuch: [dok('d_o1', 'Auszug.pdf', '2026-11-10', 'objekt-dokumente:o_holding/auszug.pdf')] } },
      { id: 'o_privat_fremd', bezeichnung: 'Ferienhaus', adresse: null, privat_besitzer: 'andere@x.de', dokumente: { Sonstiges: [dok('d_o2', 'Übersichtsliste Ferienhaus.xlsx', '2026-11-24')] } },
    ],
    dokument_inhalte: [
      { id: 'x1', schluessel: 'objekt-dokumente/o_holding/auszug.pdf', status: 'gelesen', zusammenfassung: 'Grundbuchauszug Blatt 77' },
      { id: 'x2', schluessel: 'kunden-dokumente/k_eingang_ungeklaert/scan.pdf', status: 'gelesen', zusammenfassung: 'Mietvertrag für eine Wohnung, unterschrieben' },
    ],
  })
}

function kontext(m: Record<string, unknown> = {}): SucheKontext {
  return {
    supabase: db(),
    mitarbeiter: { name: 'Test', email: 'ich@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'], ...m },
    heute: '2026-11-25',
  }
}

const kennungen = (t: string) => [...t.matchAll(/dokument_id=([^,\]]+)/g)].map((x) => x[1]).sort()

Deno.test('datei_finden ist ein Suche-Werkzeug', () => {
  assert(istSucheWerkzeug('datei_finden'))
})

Deno.test('Tippfehler findet nur, was der Mitarbeiter sehen darf (Bereich, Sammelakten, eigene private)', async () => {
  const t = await fuehreSucheWerkzeugAus('datei_finden', { suchbegriff: 'Ubersichtsliste' }, kontext())
  assertEquals(kennungen(t), ['d_b1', 'd_i1', 'd_p1'])
  assertStringIncludes(t, 'kunde_id=k_beratung')
  assertStringIncludes(t, 'Unterlagen des Hauses')
})

Deno.test('Geschäftsführung: alle Bereiche und Objekte, fremde private nie', async () => {
  const t = await fuehreSucheWerkzeugAus('datei_finden', { suchbegriff: 'Übersichtsliste' }, kontext({ rolle: 'geschaeftsfuehrung', bereiche: null }))
  assert(kennungen(t).includes('d_e1'))
  assert(!kennungen(t).includes('d_p2'))
  assert(!kennungen(t).includes('d_o2'))
})

Deno.test('Privater Assistent: nur eigene private Akten', async () => {
  const t = await fuehreSucheWerkzeugAus('datei_finden', { suchbegriff: 'Übersichtsliste' }, kontext({ nurPrivat: true }))
  assertEquals(kennungen(t), ['d_p1'])
})

Deno.test('Kurzinhalt und Objekt-Ordner werden durchsucht (mit Immobilien-Recht)', async () => {
  const t = await fuehreSucheWerkzeugAus('datei_finden', { suchbegriff: 'Grundbuchauszug' }, kontext({ bereiche: ['immobilien'] }))
  assertEquals(kennungen(t), ['d_o1'])
  assertStringIncludes(t, 'objekt_id=o_holding')
  assertStringIncludes(t, 'Ordner Grundbuch')
  const ohne = await fuehreSucheWerkzeugAus('datei_finden', { suchbegriff: 'Grundbuchauszug' }, kontext())
  assertEquals(kennungen(ohne).filter((x) => x === 'd_o1'), [])
})

Deno.test('wo = ungeklaert und Inhalt „Mietvertrag“', async () => {
  const t = await fuehreSucheWerkzeugAus('datei_finden', { suchbegriff: 'Mietvertrag', wo: 'ungeklaert' }, kontext())
  assertEquals(kennungen(t), ['d_u1'])
})

Deno.test('„gestern“ im Suchbegriff wird Zeitraum; ohne Treffer kommen die Dateien des Zeitraums', async () => {
  const t = await fuehreSucheWerkzeugAus('datei_finden', { suchbegriff: 'die Liste von gestern' }, kontext())
  assertStringIncludes(t, 'am 24.11.2026')
  assertEquals(kennungen(t).sort(), ['d_b1', 'd_i1', 'd_p1'])
  const leer = await fuehreSucheWerkzeugAus('datei_finden', { suchbegriff: 'Steuerbescheid', hochgeladen_ab: '2026-11-24', hochgeladen_bis: '2026-11-24' }, kontext())
  assertStringIncludes(leer, 'Keine Datei passt')
  assertStringIncludes(leer, 'Im Zeitraum hochgeladen')
  assert(kennungen(leer).includes('d_b1'))
})

Deno.test('Nur Zeitraum (tage_zurueck) ohne Namen; ohne beides Fehler', async () => {
  const t = await fuehreSucheWerkzeugAus('datei_finden', { tage_zurueck: 1 }, kontext())
  // 24.–25.11.; der 23.11. kommt als „knapp daneben“ hinten an
  assertEquals(kennungen(t).sort(), ['d_b1', 'd_i1', 'd_p1'])
  assertStringIncludes(t, 'knapp außerhalb')
  assert(t.indexOf('d_i1') > t.indexOf('d_b1'))
  assertStringIncludes(await fuehreSucheWerkzeugAus('datei_finden', {}, kontext()), 'Fehler')
  assertEquals(zeitraumAus({ tage_zurueck: 7 }, '', '2026-11-25'), { ab: '2026-11-18', bis: '2026-11-25' })
})
