// Sparschalter (28.11.2026): Aufrufe, die Sonnet 5.5 anfordern, laufen auf Haiku 5.5. Bei gleicher Menge kostet
// Haiku 5.5 etwa ein Zwanzigstel (Preisliste: 0,10 / 0,50 $ je Million statt 2 / 10 $). Eingestellt wird das in der
// Tabelle ki_spar_einstellung: aus, nur für bestimmte Personen (Probelauf) oder für alle; einzelne Anlässe können
// ausgenommen werden. Lehnt Haiku eine Anfrage ab, wiederholt kiAufruf sie unverändert mit Sonnet.

export const SPAR_VON = 'claude-sonnet-5-5'
export const SPAR_ZU = 'claude-haiku-5-5'
// Haiku 5.5 denkt ohne Einstellung immer vor der Antwort, und das zählt gegen max_tokens (bei 4096 brach es ab).
// Bezahlt wird nur, was tatsächlich erzeugt wird.
export const HAIKU_MIN_TOKENS = 12_000

export type SparEinstellung = { modus: 'aus' | 'personen' | 'alle'; personen: string[]; ausnahmen: string[] }
export const SPAR_AUS: SparEinstellung = { modus: 'aus', personen: [], ausnahmen: [] }

/** Gilt der Sparschalter für diesen Aufruf? */
export function sparenFuer(e: SparEinstellung, rahmen: { anlass: string; person: string }): boolean {
  if (e.modus === 'aus') return false
  const anlass = rahmen.anlass.toLowerCase()
  if (e.ausnahmen.some((a) => a && anlass.startsWith(a.toLowerCase()))) return false
  if (e.modus === 'alle') return true
  const person = rahmen.person.toLowerCase()
  return !!person && e.personen.some((p) => p.trim().toLowerCase() === person)
}

/**
 * Der Anfrage-Körper für Haiku 5.5, oder null, wenn nichts zu ändern ist (anderes Modell, Text nicht lesbar).
 * - „between_tools“ kennt Haiku 5.5 nicht: Diese Aufrufe wollten ohnehin kaum Nachdenken, also wird es abgeschaltet.
 * - Ohne Angabe denkt Haiku 5.5 nach: max_tokens auf mindestens 12.000, damit die Antwort nicht abbricht.
 */
export function sparKoerper(body: string): string | null {
  // deno-lint-ignore no-explicit-any
  let k: any
  try {
    k = JSON.parse(body)
  } catch {
    return null
  }
  if (!k || k.model !== SPAR_VON) return null
  const neu = { ...k, model: SPAR_ZU }
  const art = k.thinking?.type
  if (art === 'between_tools') neu.thinking = { type: 'disabled' }
  if (neu.thinking?.type !== 'disabled') neu.max_tokens = Math.max(Number(k.max_tokens) || 0, HAIKU_MIN_TOKENS)
  return JSON.stringify(neu)
}

/** Liest die Einstellung (höchstens einmal pro Minute aus der Datenbank). Fehler → aus. */
let zwischen: { wert: SparEinstellung; bis: number } | null = null
// deno-lint-ignore no-explicit-any
export async function ladeSparEinstellung(db: () => any, jetzt = Date.now()): Promise<SparEinstellung> {
  if (zwischen && zwischen.bis > jetzt) return zwischen.wert
  let wert = SPAR_AUS
  try {
    const { data } = await db().from('ki_spar_einstellung').select('modus, personen, ausnahmen').eq('id', 1).maybeSingle()
    if (data && ['aus', 'personen', 'alle'].includes(data.modus)) {
      wert = { modus: data.modus, personen: Array.isArray(data.personen) ? data.personen : [], ausnahmen: Array.isArray(data.ausnahmen) ? data.ausnahmen : [] }
    }
  } catch {
    // Ohne lesbare Einstellung bleibt alles wie bisher.
  }
  zwischen = { wert, bis: jetzt + 60_000 }
  return wert
}

/** Nur für Tests: Zwischenspeicher leeren. */
export function vergissSparEinstellung(): void {
  zwischen = null
}
