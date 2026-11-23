// Gemeinsames für die neuen automatischen Nachfragen des Assistenten (Runde 6, 23.11.2026):
// tägliche Kontakt-Nachfrage (kontaktNachfrage.ts) und wöchentlicher Kurzprüfungs-Hinweis (kurzpruefungHinweis.ts).
//
// - Gemeinsamer Schalter assistent_hinweis_einstellung (eine Zeile, id 1): 'aus' (Vorgabe) | 'superuser' (Probelauf —
//   nur Mitarbeiter mit ist_superuser bekommen die Nachrichten, die sonst an die Kollegen gingen) | 'alle'.
//   Erays Regel: Neue automatische Nachrichten an Kollegen erst nach seiner Freigabe der Texte. Ist der Schalter
//   nicht lesbar (Tabelle fehlt), wird nichts gesendet.
// - Je Mitarbeiter assistent_hinweise: abschalten (keine Zeile = an) und der Tag bzw. Montag der letzten Nachricht.
//   Beansprucht wird VOR dem Senden mit einer bedingten Änderung — laufen zwei Takte gleichzeitig, sendet nur einer.

// deno-lint-ignore no-explicit-any
type Db = any

export type Modus = 'aus' | 'superuser' | 'alle'
export type HinweisArt = 'kontakt_nachfrage' | 'kurzpruefung_hinweis'

export const EINSTELLUNG_TABELLE = 'assistent_hinweis_einstellung'
export const PERSON_TABELLE = 'assistent_hinweise'

/** Stempel-Spalte je Art (Tag bzw. Montag der letzten Nachricht). */
const STEMPEL: Record<HinweisArt, string> = { kontakt_nachfrage: 'kontakt_tag', kurzpruefung_hinweis: 'kurzpruefung_woche' }

export type Person = {
  id: string
  name: string
  email: string
  rolle: string | null
  ist_admin: boolean
  ist_superuser: boolean
  bereiche: string[]
  chat: number | string
}

export type PersonEinstellung = { an: boolean; stempel: string; hatZeile: boolean }

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

/** Schalter lesen. Fehler oder fehlende Zeile → 'aus' (lieber nichts senden). */
export async function ladeModus(admin: Db, art: HinweisArt): Promise<Modus> {
  try {
    const { data, error } = await admin.from(EINSTELLUNG_TABELLE).select(art).eq('id', 1).maybeSingle()
    if (error || !data) return 'aus'
    const w = text(data[art])
    return w === 'superuser' || w === 'alle' ? w : 'aus'
  } catch {
    return 'aus'
  }
}

/** Aktive Mitarbeiter mit Telegram. */
export async function ladeTeam(admin: Db): Promise<Person[]> {
  const { data, error } = await admin.from('mitarbeiter').select('id, name, email, rolle, ist_admin, ist_superuser, bereiche, aktiv, telegram_chat_id').eq('aktiv', true)
  if (error) throw new Error(`mitarbeiter: ${error.message}`)
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[])
    .filter((m) => text(m.email) && m.telegram_chat_id !== null && m.telegram_chat_id !== undefined && m.telegram_chat_id !== '')
    .map((m) => ({
      id: text(m.id),
      name: text(m.name),
      email: text(m.email).toLowerCase(),
      rolle: m.rolle ?? null,
      ist_admin: m.ist_admin === true,
      ist_superuser: m.ist_superuser === true,
      bereiche: Array.isArray(m.bereiche) ? m.bereiche : [],
      chat: m.telegram_chat_id,
    }))
}

/** Einstellungen je Mitarbeiter (E-Mail klein → an/aus, Stempel). Wirft bei Lesefehler (dann lieber nicht senden). */
export async function ladeEinstellungen(admin: Db, art: HinweisArt): Promise<Map<string, PersonEinstellung>> {
  const { data, error } = await admin.from(PERSON_TABELLE).select(`email, ${art}, ${STEMPEL[art]}`)
  if (error) throw new Error(`${PERSON_TABELLE}: ${error.message}`)
  const m = new Map<string, PersonEinstellung>()
  for (const z of (data ?? []) as Record<string, unknown>[]) {
    m.set(text(z.email).toLowerCase(), { an: z[art] !== false, stempel: text(z[STEMPEL[art]]).slice(0, 10), hatZeile: true })
  }
  return m
}

/** Setzt den Stempel auf `wert` — nur, wenn es noch niemand getan hat und die Person nicht abgeschaltet hat. true = senden. */
export async function beanspruche(admin: Db, art: HinweisArt, email: string, hatZeile: boolean, wert: string): Promise<boolean> {
  const stempel = STEMPEL[art]
  if (!hatZeile) {
    const { error } = await admin.from(PERSON_TABELLE).insert({ email, [art]: true, [stempel]: wert })
    if (!error) return true
    if (error.code !== '23505') throw new Error(`${PERSON_TABELLE}: ${error.message}`)
  }
  const { data, error } = await admin
    .from(PERSON_TABELLE)
    .update({ [stempel]: wert })
    .eq('email', email)
    .eq(art, true)
    .or(`${stempel}.is.null,${stempel}.lt.${wert}`)
    .select('email')
  if (error) throw new Error(`${PERSON_TABELLE}: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/** Wer bekommt im jeweiligen Modus überhaupt etwas? Ohne Abgeschaltete und ohne die, die schon dran waren. */
export function offeneEmpfaenger(team: Person[], einst: Map<string, PersonEinstellung>, modus: Modus, wert: string): Person[] {
  if (modus === 'aus') return []
  return team.filter((p) => {
    if (modus === 'superuser' && !p.ist_superuser) return false
    const e = einst.get(p.email)
    return !e || (e.an && e.stempel < wert)
  })
}
