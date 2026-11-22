// Prüft „Vergleich vor Ort prüfen“ (renditeMarkt.ts) ohne Netz: Auswerten der Antwort, Schreiben in
// objekte.rendite.markt ohne Eingaben und Prüfsteine zu verlieren, doppelter Start, Fehler mit und ohne
// früheres Ergebnis, private Objekte, fehlende Adresse.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { leseMarktAntwort, marktAuftrag, type RenditeMarktHelfer, starteRenditeMarktvergleich } from './renditeMarkt.ts'
import { falscheDatenbank } from '../_shared/testDoppel.ts'

const ANTWORT = `Ich habe gesucht …
\`\`\`json
{"preisJeQmVon": 3000, "preisJeQmBis": "2.800", "preisJeQmMittel": 2900, "preisBezug": "Eigentumswohnungen im Bestand, Lorch", "mieteJeQmVon": 12.5, "mieteJeQmBis": 15.5, "mieteJeQmMittel": null, "mieteBezug": "Pacht für Beherbergungsbetriebe", "renditeVon": 7, "renditeBis": 9, "faktorVon": null, "faktorBis": 1000, "ortBezug": "Lorch (Ostalbkreis)", "einschaetzung": "Gute Anbindung über die B29.", "hinweise": ["Für Boarding Houses gibt es keine amtlichen Werte."], "quellen": [{"titel": "Immobilienpreise Lorch", "url": "https://beispiel.de/lorch", "stand": "Oktober 2026"}, {"titel": "kaputt", "url": "javascript:alert(1)"}]}
\`\`\``

function objekt(over: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    bezeichnung: 'Boarding House Remstal',
    adresse: 'Teckstraße 62, 73547 Lorch-Weitmars',
    typ: 'Gewerbe',
    kaufpreis: 1_200_000,
    verkaufsdaten: null,
    privat_besitzer: null,
    rendite: { version: 1, eingaben: { kaufpreis: 1_200_000, flaeche: 590, einheiten: 15 }, pruefsteine: { brandschutz: { erledigt: true } } },
    ...over,
  }
}

function helfer(antwort: string | Error, protokoll: { prompt?: string; opts?: Record<string, unknown>; privat?: boolean } = {}): RenditeMarktHelfer {
  return {
    callClaudeResearch: (prompt, opts) => {
      protokoll.prompt = prompt
      protokoll.opts = opts
      return antwort instanceof Error ? Promise.reject(antwort) : Promise.resolve(antwort)
    },
    restMs: () => 300_000,
    hoechstensMs: 150_000,
    setzePrivat: () => (protokoll.privat = true),
    jetzt: () => new Date('2026-11-22T10:00:00Z'),
  }
}

Deno.test('Antwort lesen: Spannen sortiert, unplausible Werte und unsichere Adressen fallen weg', () => {
  const m = leseMarktAntwort(ANTWORT, '2026-11-22')!
  assertEquals(m.preisJeQmVon, 2800)
  assertEquals(m.preisJeQmBis, 3000)
  assertEquals(m.mieteJeQmVon, 12.5)
  assertEquals(m.mieteJeQmMittel, undefined)
  assertEquals(m.faktorBis, undefined)
  assertEquals(m.ort, 'Lorch (Ostalbkreis)')
  assertEquals(m.quellen, [{ titel: 'Immobilienpreise Lorch', url: 'https://beispiel.de/lorch', stand: 'Oktober 2026' }])
  assertEquals(m.stand, '2026-11-22')
  assertEquals(leseMarktAntwort('kein Block', '2026-11-22'), null)
  assertEquals(leseMarktAntwort('```json\n{kaputt\n```', '2026-11-22'), null)
})

Deno.test('Auftrag: Objektart aus der Bezeichnung, höchstens fünf Suchen, kein englisches Wort verlangt', () => {
  const t = marktAuftrag({ bezeichnung: 'Boarding House Remstal', objektart: 'Gewerbe (Bezeichnung: „Boarding House Remstal“)', ort: 'Lorch', flaeche: 590, einheiten: 15, heute: '2026-11-22' })
  assertStringIncludes(t, 'höchstens 5 Suchen')
  assertStringIncludes(t, 'Fläche: rund 590 m²')
  assertStringIncludes(t, 'ohne englische Wörter')
})

Deno.test('Recherche schreibt markt und behält Eingaben und Prüfsteine', async () => {
  const db = falscheDatenbank({ objekte: [objekt()] })
  const p: { opts?: Record<string, unknown> } = {}
  const start = await starteRenditeMarktvergleich(db, { objektId: 'o1', wer: 'Andreas Mayer' }, helfer(ANTWORT, p))
  assert(start.ok)
  // Sofort nach dem Start steht „läuft“ in der Datenbank.
  // deno-lint-ignore no-explicit-any
  const zwischen = (db.tabelle('objekte')[0] as any).rendite
  assert(['laeuft', 'fertig'].includes(zwischen.markt.status))
  const erg = await start.arbeit
  assert(erg.ok)
  assertEquals(p.opts?.model, 'claude-sonnet-5-5')
  assertEquals(p.opts?.maxSearches, 5)
  // deno-lint-ignore no-explicit-any
  const r = (db.tabelle('objekte')[0] as any).rendite
  assertEquals(r.markt.status, 'fertig')
  assertEquals(r.markt.preisJeQmVon, 2800)
  assertEquals(r.markt.gestartetVon, 'Andreas Mayer')
  assertStringIncludes(r.markt.objektart, 'Boarding House')
  assertEquals(r.eingaben.flaeche, 590)
  assertEquals(r.pruefsteine.brandschutz.erledigt, true)
})

Deno.test('Zweiter Start, während einer läuft → 409; nach vier Minuten wieder erlaubt', async () => {
  const laeuft = { ...objekt().rendite, markt: { status: 'laeuft', gestartetAm: '2026-11-22T09:58:30Z' } }
  const db = falscheDatenbank({ objekte: [objekt({ rendite: laeuft })] })
  const r = await starteRenditeMarktvergleich(db, { objektId: 'o1', wer: 'X' }, helfer(ANTWORT))
  assertEquals(r.ok ? 0 : r.status, 409)
  const alt = falscheDatenbank({ objekte: [objekt({ rendite: { ...laeuft, markt: { status: 'laeuft', gestartetAm: '2026-11-22T09:50:00Z' } } })] })
  assert((await starteRenditeMarktvergleich(alt, { objektId: 'o1', wer: 'X' }, helfer(ANTWORT))).ok)
})

Deno.test('Fehler ohne früheres Ergebnis → status fehler; mit früherem Ergebnis bleibt es gültig', async () => {
  const db = falscheDatenbank({ objekte: [objekt()] })
  const s = await starteRenditeMarktvergleich(db, { objektId: 'o1', wer: 'X' }, helfer(new Error('Anthropic-API-Fehler (529)')))
  assert(s.ok)
  const e = await s.arbeit
  assertEquals(e.ok, false)
  // deno-lint-ignore no-explicit-any
  assertEquals((db.tabelle('objekte')[0] as any).rendite.markt.status, 'fehler')

  const frueher = { ...objekt().rendite, markt: { status: 'fertig', gestartetAm: '2026-11-01T10:00:00Z', preisJeQmVon: 2700, stand: '2026-11-01' } }
  const db2 = falscheDatenbank({ objekte: [objekt({ rendite: frueher })] })
  const s2 = await starteRenditeMarktvergleich(db2, { objektId: 'o1', wer: 'X' }, helfer('ohne Block'))
  assert(s2.ok)
  await s2.arbeit
  // deno-lint-ignore no-explicit-any
  const m = (db2.tabelle('objekte')[0] as any).rendite.markt
  assertEquals(m.status, 'fertig')
  assertEquals(m.preisJeQmVon, 2700)
  assertStringIncludes(m.fehler, 'kein auswertbares Ergebnis')
})

Deno.test('Privates Objekt wird als privat gezählt; ohne Adresse und ohne Objekt kein Start', async () => {
  const p: { privat?: boolean } = {}
  const db = falscheDatenbank({ objekte: [objekt({ privat_besitzer: 'hasan@beispiel.de' })] })
  const s = await starteRenditeMarktvergleich(db, { objektId: 'o1', wer: 'Hasan' }, helfer(ANTWORT, p))
  assert(s.ok)
  await s.arbeit
  assertEquals(p.privat, true)
  const ohneAdresse = falscheDatenbank({ objekte: [objekt({ adresse: '' })] })
  const r = await starteRenditeMarktvergleich(ohneAdresse, { objektId: 'o1', wer: 'X' }, helfer(ANTWORT))
  assertEquals(r.ok ? 0 : r.status, 400)
  const leer = falscheDatenbank({ objekte: [] })
  const r2 = await starteRenditeMarktvergleich(leer, { objektId: 'o1', wer: 'X' }, helfer(ANTWORT))
  assertEquals(r2.ok ? 0 : r2.status, 404)
})
