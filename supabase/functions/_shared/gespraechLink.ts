// Direkt-Links in die Gesprächs-App „Mayer Gespräch“ (Runde 5): mit einem Tipp aus dem Termin-Briefing, der
// Erinnerung zum Terminbeginn, der Akte im CRM, dem Kalender oder vom Home-Bildschirm (Schnellaktionen im
// Manifest) direkt zur Einwilligung — Akte und Termin sind schon gewählt.
//
//   <CRM-Adresse>gespraech/#/aufnehmen?termin=<id>
//   <CRM-Adresse>gespraech/#/aufnehmen?kunde=<id>
//   <CRM-Adresse>gespraech/#/aufnehmen?objekt=<id>&art=termin|telefon|notiz
//
// Kombinationen sind erlaubt (z. B. termin + kunde, damit die App die Akte nicht erst suchen muss). Rein, ohne
// Abhängigkeiten: wird vom Server (Deno) und von der App (Vite, relativer Import) benutzt.

export type AufnehmenArt = 'termin' | 'telefon' | 'notiz'

export type AufnehmenZiel = {
  termin?: string
  kunde?: string
  objekt?: string
  art?: AufnehmenArt
  /** Ein Teil des Links war unbrauchbar (unbekannte Art, Nummer mit falschen Zeichen) und wurde weggelassen. */
  fehlerhaft?: boolean
}

export const GESPRAECH_APP_PFAD = 'gespraech/'
export const AUFNEHMEN_ARTEN: AufnehmenArt[] = ['termin', 'telefon', 'notiz']

/** Nummern von Terminen, Akten und Objekten: Buchstaben, Ziffern, _ - . : (UUIDs, „k_lehle“, „o_…“). */
const ID_MUSTER = /^[A-Za-z0-9_.:-]{1,100}$/

export function gueltigeId(x: unknown): string | null {
  const s = String(x ?? '').trim()
  return ID_MUSTER.test(s) ? s : null
}

/** Baut den Link; leere Teile fallen weg. `basis` ist die CRM-Adresse (z. B. https://…/mayer-holding-crm/). */
export function aufnehmenLink(basis: string, ziel: Omit<AufnehmenZiel, 'fehlerhaft'>): string {
  const b = basis.endsWith('/') ? basis : `${basis}/`
  const teile: string[] = []
  const termin = gueltigeId(ziel.termin)
  const kunde = gueltigeId(ziel.kunde)
  const objekt = gueltigeId(ziel.objekt)
  if (termin) teile.push(`termin=${encodeURIComponent(termin)}`)
  if (kunde) teile.push(`kunde=${encodeURIComponent(kunde)}`)
  if (objekt) teile.push(`objekt=${encodeURIComponent(objekt)}`)
  if (ziel.art && AUFNEHMEN_ARTEN.includes(ziel.art)) teile.push(`art=${ziel.art}`)
  return `${b}${GESPRAECH_APP_PFAD}#/aufnehmen${teile.length ? `?${teile.join('&')}` : ''}`
}

/**
 * Liest den Suchteil der Adresse (`?termin=…`, mit oder ohne „?“). null = kein Direkt-Link (normales Öffnen der
 * Aufnahme-Seite). Unbrauchbare Teile werden weggelassen und mit `fehlerhaft` vermerkt.
 */
export function leseAufnehmenZiel(suche: string | null | undefined): AufnehmenZiel | null {
  const text = String(suche ?? '').replace(/^\?/, '')
  if (!text) return null
  let p: URLSearchParams
  try {
    p = new URLSearchParams(text)
  } catch {
    return null
  }
  const schluessel = ['termin', 'kunde', 'objekt', 'art'] as const
  if (!schluessel.some((s) => p.has(s))) return null
  const ziel: AufnehmenZiel = {}
  for (const s of ['termin', 'kunde', 'objekt'] as const) {
    if (!p.has(s)) continue
    const id = gueltigeId(p.get(s))
    if (id) ziel[s] = id
    else ziel.fehlerhaft = true
  }
  if (p.has('art')) {
    const art = String(p.get('art') ?? '').trim().toLowerCase()
    if ((AUFNEHMEN_ARTEN as string[]).includes(art)) ziel.art = art as AufnehmenArt
    else ziel.fehlerhaft = true
  }
  return ziel
}
