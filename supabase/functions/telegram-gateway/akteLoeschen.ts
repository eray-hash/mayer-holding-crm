// kunde_loeschen für Mitarbeiter ohne Geschäftsführungs-Rechte (Wunsch 25.11.2026): Eine selbst angelegte,
// frische Akte ohne Rechnungen/Kostenvoranschläge/Protokolle darf er selbst löschen (Regel in
// _shared/akteSelbstLoeschen.ts, gleich im CRM). Sonst geht eine kurze Löschbitte an die Geschäftsführung, statt
// nur „Nicht erlaubt“ zu antworten.
import { darfAkteSelbstLoeschen, type SelbstLoeschenErgebnis } from '../_shared/akteSelbstLoeschen.ts'
import { type MitteilungsWege, schickeMitteilung } from './teamWerkzeuge.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

type Akte = { id: string; activities?: unknown; verantwortlich?: string | null; verantwortlich_email?: string | null }
type Wer = { id?: string; name: string; email?: string | null }

async function anzahl(supabase: Supa, tabelle: string, kundeId: string): Promise<number> {
  const { data, error } = await supabase.from(tabelle).select('id').eq('kunde_id', kundeId).limit(20)
  // Nicht lesbar → vorsichtshalber so tun, als hinge etwas daran (dann entscheidet die Geschäftsführung).
  if (error) return 1
  return Array.isArray(data) ? data.length : 0
}

/** Prüft die Selbst-Löschen-Regel samt Rechnungen, Kostenvoranschlägen und Protokollen der Akte. */
export async function selbstLoeschRecht(supabase: Supa, wer: Wer, akte: Akte, jetzt: Date = new Date()): Promise<SelbstLoeschenErgebnis> {
  const [rechnungen, kostenvoranschlaege, protokolle] = await Promise.all([
    anzahl(supabase, 'rechnungen', akte.id),
    anzahl(supabase, 'kostenvoranschlaege', akte.id),
    anzahl(supabase, 'protokolle', akte.id),
  ])
  return darfAkteSelbstLoeschen(akte, wer, { rechnungen, kostenvoranschlaege, protokolle }, jetzt)
}

/**
 * Schickt der Geschäftsführung (aktive Mitarbeiter mit Rolle Geschäftsführung, ohne den Fragenden) eine kurze
 * Löschbitte über den Bot und liefert die Antwort für den Assistenten.
 */
export async function loeschBitteAnGf(
  supabase: Supa,
  wege: MitteilungsWege | undefined,
  wer: Wer,
  akte: { id: string; name: string; bereich: string },
  grund: string,
  anlass: string | undefined,
  protokolliere: (t: string) => void,
): Promise<string> {
  const kopf = `NICHT GELÖSCHT: ${grund} Kundenakten der Holding löscht sonst nur die Geschäftsführung.`
  const { data } = await supabase.from('mitarbeiter').select('id, name, rolle, aktiv, telegram_chat_id').eq('aktiv', true).eq('rolle', 'geschaeftsfuehrung')
  const gf = ((data ?? []) as { id: string; name: string; telegram_chat_id: unknown }[]).filter((m) => m.id !== wer.id)
  if (!wege || gf.length === 0) return `${kopf} Eine Löschbitte konnte nicht verschickt werden (keine Geschäftsführung erreichbar) — sag ihm, er soll die Geschäftsführung direkt fragen.`
  const zeilen = [
    `Löschbitte von ${wer.name}: Akte „${akte.name}“ (${akte.bereich}) soll gelöscht werden.`,
    `Warum nicht selbst: ${grund}`,
  ]
  const a = String(anlass ?? '').trim()
  if (a) zeilen.push(`Seine Nachricht: „${a.slice(0, 200)}${a.length > 200 ? ' …' : ''}“`)
  zeilen.push(`Wenn das passt, schreib mir „Akte ${akte.name} löschen“.`)
  const text = zeilen.join('\n')
  const erreicht: string[] = []
  for (const m of gf) {
    const r = await schickeMitteilung(supabase, wege, m.id, text, wer.name, 'mitteilung').catch(() => ({ ok: false as const }))
    if (r.ok) erreicht.push(m.name)
  }
  if (erreicht.length === 0) return `${kopf} Die Löschbitte an die Geschäftsführung ging nicht raus (nicht mit Telegram verbunden) — sag ihm, er soll direkt fragen.`
  protokolliere(`Löschbitte für Akte ${akte.name} an ${erreicht.join(', ')} geschickt`)
  return `${kopf} Löschbitte an ${erreicht.join(', ')} geschickt. Sag dem Mitarbeiter kurz, dass die Geschäftsführung Bescheid bekommen hat und die Akte löschen kann.`
}
