// Hinweis für den Assistenten nach kostenvoranschlag_anlegen ohne Akte (22.11.2026): sucht passende Akten zu den
// eben angelegten Einträgen (Kern: _shared/kvZuordnung.ts) und hängt einen kurzen Satz an das Ergebnis, damit
// der Assistent nachfragt und mit kostenvoranschlag_aendern (kv_id + kunde_id) zuordnet. Ohne Zuordnung fehlen
// Kostenvoranschläge in Umsatzvorschau, Rechnungsvorschlägen, Wiedervorlagen und im Reiter der Akte.
// Nur Akten, die der Mitarbeiter sehen darf (rechte.ts); öffentliche Einträge nur zu öffentlichen Akten,
// private nur zu eigenen privaten (passtSichtbarkeit).

import { darfAkte, type RechteMitarbeiter } from './rechte.ts'
import { alleZeilen } from '../_shared/dublettenLaden.ts'
import { type AkteFuerZuordnung, findeKvKandidaten, KV_STUFE_TEXT, wortHaeufigkeit } from '../_shared/kvZuordnung.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type NeuerKv = { id: string; name: string; beschreibung?: string | null; notiz?: string | null; bereich?: string | null; privat_besitzer?: string | null }

function akteName(a: AkteFuerZuordnung): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

/**
 * Text zum Anhängen an das Ergebnis von kostenvoranschlag_anlegen (leer, wenn nichts passt oder ein Fehler
 * auftritt — der Hinweis darf das Anlegen nie stören). Höchstens 10 Einträge, je höchstens 2 Akten.
 */
export async function kvAkteHinweis(supabase: Supa, mitarbeiter: RechteMitarbeiter, eintraege: NeuerKv[]): Promise<string> {
  try {
    if (!eintraege.length) return ''
    const zeilen = await alleZeilen(supabase, 'kunden', 'id, bereich, firma, ansprechpartner, email, verantwortlich_email')
    const akten: AkteFuerZuordnung[] = zeilen
      .filter((a) => darfAkte(mitarbeiter, { id: a.id, bereich: a.bereich, verantwortlich_email: a.verantwortlich_email }))
      .map((a) => ({ id: String(a.id), bereich: String(a.bereich ?? ''), firma: a.firma, ansprechpartner: a.ansprechpartner, email: a.email, verantwortlich_email: a.verantwortlich_email }))
    const h = wortHaeufigkeit(zeilen.map((a) => ({ id: String(a.id), bereich: String(a.bereich ?? ''), firma: a.firma, ansprechpartner: a.ansprechpartner, email: a.email })))
    const byId = new Map(akten.map((a) => [a.id, a]))
    const teile: string[] = []
    for (const kv of eintraege.slice(0, 10)) {
      const k = findeKvKandidaten({ ...kv }, akten, { haeufigkeit: h }).slice(0, 2)
      if (!k.length) continue
      teile.push(`- „${kv.name}“ (kv_id=${kv.id}): ${k.map((c) => `${akteName(byId.get(c.kunde_id)!)} (kunde_id=${c.kunde_id}, ${KV_STUFE_TEXT[c.stufe]}: ${c.gruende.join('; ')})`).join(' oder ')}`)
    }
    if (!teile.length) return ''
    return `\nMögliche Akten (noch NICHT zugeordnet — frag nach und ordne erst nach Bestätigung mit kostenvoranschlag_aendern kv_id + kunde_id zu; bei „sicher“ genügt ein kurzes „Soll ich …?“):\n${teile.join('\n')}`
  } catch {
    return ''
  }
}

/**
 * Für die Verdrahtung in index.ts: nach kostenvoranschlag_anlegen OHNE kunde_id den Hinweis bilden. Nimmt die
 * IDs aus dem Ergebnis („IDs: kv_…, kv_…“, gleiche Reihenfolge wie input.eintraege). Leer in allen anderen Fällen.
 */
// deno-lint-ignore no-explicit-any
export async function kvAkteHinweisNachAnlegen(supabase: Supa, mitarbeiter: RechteMitarbeiter, input: any, ergebnis: string): Promise<string> {
  if (String(input?.kunde_id ?? '').trim() || !ergebnis.startsWith('Angelegt:')) return ''
  const ids = (ergebnis.match(/IDs: (.+)$/)?.[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('kv_'))
  const liste = Array.isArray(input?.eintraege) ? input.eintraege : []
  if (!ids.length || ids.length !== liste.length) return ''
  const privat = input?.privat === true
  const besitzer = privat ? String(mitarbeiter.email ?? '').trim().toLowerCase() || null : null
  const eintraege: NeuerKv[] = liste.map((e: { name?: unknown; beschreibung?: unknown; notiz?: unknown }, i: number) => ({
    id: ids[i],
    name: String(e?.name ?? '').replace(/\s+/g, ' ').trim(),
    beschreibung: e?.beschreibung ? String(e.beschreibung) : null,
    notiz: e?.notiz ? String(e.notiz) : null,
    bereich: privat ? 'privat' : null,
    privat_besitzer: besitzer,
  }))
  return await kvAkteHinweis(supabase, mitarbeiter, eintraege)
}
