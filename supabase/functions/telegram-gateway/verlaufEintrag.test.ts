import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { type LoeschAnfrage, verlaufEintragAendern } from './verlaufEintrag.ts'

const ma = { name: 'Test Mitarbeiter', email: 'test@beispiel.de', rolle: 'mitarbeiter', bereiche: ['immobilien'] }
const gf = { name: 'Chef Beispiel', email: 'chef@beispiel.de', rolle: 'geschaeftsfuehrung', bereiche: [] }

function db() {
  return falscheDatenbank({
    objekte: [{
      id: 'o1', bezeichnung: 'Testhaus', adresse: 'Musterweg 1', privat_besitzer: null, updated_at: null,
      activities: [
        { id: 'a2', date: '2026-11-24', text: 'Falsche Notiz', user: 'Test Mitarbeiter' },
        { id: 'a1', date: '2026-11-20', text: 'Objekt angelegt', user: 'Kollege' },
      ],
    }],
    kunden: [{ id: 'k1', bereich: 'immobilien', firma: 'Testfirma', activities: [{ id: 'b1', date: '2026-11-24', text: 'Alt', user: 'Test Mitarbeiter' }] }],
  })
}

function kontext(supabase: unknown, mitarbeiter: typeof ma, vorherigeAnfrage?: LoeschAnfrage) {
  const box: { anfrage?: LoeschAnfrage; log: string[] } = { log: [] }
  return {
    box,
    k: { supabase, mitarbeiter, heute: '2026-11-25', protokolliere: (t: string) => box.log.push(t), vorherigeAnfrage, setzeAnfrage: (a: LoeschAnfrage) => { box.anfrage = a } },
  }
}

// deno-lint-ignore no-explicit-any
async function verlauf(d: any, tabelle: string, id: string) {
  const { data } = await d.from(tabelle).select('activities').eq('id', id).maybeSingle()
  return data.activities as { id: string; text: string; bearbeitet_von?: string }[]
}

Deno.test('Objektakte: eigene Notiz korrigieren, nur activities geschrieben', async () => {
  const d = db()
  const { k } = kontext(d, ma)
  const t = await verlaufEintragAendern({ objekt_id: 'o1', aktivitaet_id: 'a2', neuer_text: 'Richtige Notiz' }, k)
  assertStringIncludes(t, 'Korrigiert')
  const v = await verlauf(d, 'objekte', 'o1')
  assertEquals(v.find((x) => x.id === 'a2')?.text, 'Richtige Notiz')
  assertEquals(v.find((x) => x.id === 'a2')?.bearbeitet_von, 'Test Mitarbeiter')
  assertEquals(v.length, 2)
})

Deno.test('Objektakte: Löschen erst nach Bestätigung, danach Vermerk ohne Inhalt', async () => {
  const d = db()
  const erst = kontext(d, ma)
  const t1 = await verlaufEintragAendern({ objekt_id: 'o1', aktivitaet_id: 'a2', loeschen: true }, erst.k)
  assertStringIncludes(t1, 'NOCH NICHT GELÖSCHT')
  assert(erst.box.anfrage)
  assertEquals((await verlauf(d, 'objekte', 'o1')).length, 2)

  const zweit = kontext(d, ma, erst.box.anfrage)
  const t2 = await verlaufEintragAendern({ objekt_id: 'o1', aktivitaet_id: 'a2', loeschen: true }, zweit.k)
  assertStringIncludes(t2, 'Gelöscht')
  const v = await verlauf(d, 'objekte', 'o1')
  assertEquals(v.some((x) => x.id === 'a2'), false)
  assertStringIncludes(v[0].text, 'gelöscht von Test Mitarbeiter')
  assertEquals(v[0].text.includes('Falsche Notiz'), false)
})

Deno.test('Bestätigung für einen anderen Eintrag zählt nicht', async () => {
  const d = db()
  const fremd: LoeschAnfrage = { kunde_id: 'eintrag:objekte:o1:a1', name: 'x', z: new Date().toISOString() }
  const { k } = kontext(d, gf, fremd)
  const t = await verlaufEintragAendern({ objekt_id: 'o1', aktivitaet_id: 'a2', loeschen: true }, k)
  assertStringIncludes(t, 'NOCH NICHT GELÖSCHT')
})

Deno.test('Fremden Eintrag darf nur die Geschäftsführung ändern', async () => {
  const d = db()
  const nein = await verlaufEintragAendern({ objekt_id: 'o1', aktivitaet_id: 'a1', neuer_text: 'x' }, kontext(d, ma).k)
  assertStringIncludes(nein, 'Nicht erlaubt')
  const ja = await verlaufEintragAendern({ objekt_id: 'o1', aktivitaet_id: 'a1', neuer_text: 'Objekt angelegt (korrigiert)' }, kontext(d, gf).k)
  assertStringIncludes(ja, 'Korrigiert')
})

Deno.test('Kundenakte geht weiter mit kunde_id', async () => {
  const d = db()
  const t = await verlaufEintragAendern({ kunde_id: 'k1', aktivitaet_id: 'b1', neuer_text: 'Neu' }, kontext(d, ma).k)
  assertStringIncludes(t, 'Korrigiert')
  assertEquals((await verlauf(d, 'kunden', 'k1'))[0].text, 'Neu')
})

Deno.test('Objekt ohne Immobilien-Freigabe: nicht freigegeben', async () => {
  const d = db()
  const t = await verlaufEintragAendern({ objekt_id: 'o1', aktivitaet_id: 'a2', neuer_text: 'x' }, kontext(d, { ...ma, bereiche: ['beratung'] }).k)
  assertStringIncludes(t, 'Nicht freigegeben')
})
