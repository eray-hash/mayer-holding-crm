// Fehlende Kontaktdaten in Kundenakten (Runde 6, 23.11.2026) — Gegenstück zu objektVollstaendigkeit.ts.
//
// Anlass: 55 von 140 Akten hatten weder E-Mail noch Telefon. Das Team arbeitet fast nur per Telegram; deshalb
//   - zeigt der Assistent mit kontakt_luecken (telegram-gateway/kontaktLueckenWerkzeug.ts), welchen Akten was fehlt,
//   - fragt er einmal täglich beim Verantwortlichen nach (email-gateway/kontaktNachfrage.ts, höchstens 3 Akten),
//     und trägt die Antwort (Text oder Sprache) mit kunde_aendern ein.
//
// Reine Rechnung ohne Datenbank, damit sie sich ohne Netz prüfen lässt. Gezählt werden nur laufende Akten der
// Holding: keine privaten Kontakte, keine Sammelakten, keine Akten im Endstand (abgeschlossen, verloren …).

import { AKTE_ENDSTAENDE } from './umsatzKern.ts'

export const KONTAKT_SPALTEN = 'id, bereich, firma, ansprechpartner, email, telefon, anschrift, status, verantwortlich, verantwortlich_email'

export const SAMMELAKTEN_IDS: readonly string[] = ['k_eingang_ungeklaert', 'k_intern_holding']

export const BEREICH_TEXT: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilienkunden: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
}

export type KontaktZeile = {
  id: string
  bereich?: string | null
  firma?: string | null
  ansprechpartner?: string | null
  email?: string | null
  telefon?: string | null
  anschrift?: string | null
  status?: string | null
  verantwortlich?: string | null
}

export type Feld = 'telefon' | 'email' | 'anschrift'

export type KontaktLuecke = {
  id: string
  name: string
  bereich: string
  status: string
  verantwortlich: string
  fehlt: Feld[]
  /** Weder Telefon noch E-Mail — niemand kann den Kontakt erreichen. */
  ohneKontakt: boolean
}

const FELD_TEXT: Record<Feld, string> = { telefon: 'Telefon', email: 'E-Mail', anschrift: 'Anschrift' }

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

/** Anzeigename einer Akte: Firma (Ansprechpartner). */
export function akteName(z: Pick<KontaktZeile, 'firma' | 'ansprechpartner'>): string {
  const f = text(z.firma)
  const p = text(z.ansprechpartner)
  return p && p !== f ? (f ? `${f} (${p})` : p) : f || p || 'ohne Namen'
}

/** Wirkt die Angabe wie eine echte E-Mail-Adresse bzw. Telefonnummer? (Platzhalter wie „-“ oder „unbekannt“ zählen nicht.) */
export function istEmail(w: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text(w))
}
export function istTelefon(w: unknown): boolean {
  return text(w).replace(/\D/g, '').length >= 6
}

/** Zählt die Akte überhaupt (laufende Akte der Holding)? */
export function zaehlt(z: KontaktZeile, mitEndstand = false): boolean {
  if (!z?.id || SAMMELAKTEN_IDS.includes(z.id)) return false
  const b = text(z.bereich)
  if (!b || b === 'privat') return false
  if (!mitEndstand && AKTE_ENDSTAENDE.includes(text(z.status))) return false
  return true
}

/** Was fehlt in dieser Akte? null = nichts (oder zählt nicht). */
export function pruefeKontakt(z: KontaktZeile, o: { mitAnschrift?: boolean; mitEndstand?: boolean } = {}): KontaktLuecke | null {
  if (!zaehlt(z, o.mitEndstand)) return null
  const fehlt: Feld[] = []
  if (!istTelefon(z.telefon)) fehlt.push('telefon')
  if (!istEmail(z.email)) fehlt.push('email')
  if (o.mitAnschrift && !text(z.anschrift)) fehlt.push('anschrift')
  if (fehlt.length === 0) return null
  return {
    id: z.id,
    name: akteName(z),
    bereich: text(z.bereich),
    status: text(z.status),
    verantwortlich: text(z.verantwortlich),
    fehlt,
    ohneKontakt: fehlt.includes('telefon') && fehlt.includes('email'),
  }
}

/** Alle Lücken, Akten ganz ohne Kontakt zuerst, dann nach Name. */
export function kontaktLuecken(zeilen: KontaktZeile[], o: { nurOhneKontakt?: boolean; mitAnschrift?: boolean; mitEndstand?: boolean } = {}): KontaktLuecke[] {
  return zeilen
    .map((z) => pruefeKontakt(z, o))
    .filter((l): l is KontaktLuecke => !!l && (!o.nurOhneKontakt || l.ohneKontakt))
    .sort((a, b) => Number(b.ohneKontakt) - Number(a.ohneKontakt) || a.name.localeCompare(b.name, 'de'))
}

/** „Telefon und E-Mail“, „Telefon, E-Mail und Anschrift“ … */
export function fehltText(fehlt: Feld[]): string {
  const t = fehlt.map((f) => FELD_TEXT[f])
  return t.length <= 1 ? (t[0] ?? '') : `${t.slice(0, -1).join(', ')} und ${t[t.length - 1]}`
}

function verb(fehlt: Feld[]): string {
  return fehlt.length > 1 ? 'fehlen' : 'fehlt'
}

/** Darf die Person Akten dieses Bereichs sehen? Wie rechte.ts darfBereich (Geschäftsführung/Admins alles). */
export function darfBereichPerson(p: { rolle?: string | null; ist_admin?: boolean | null; bereiche?: string[] | null }, bereich: string): boolean {
  if (!bereich || bereich === 'privat') return false
  if (p.rolle === 'geschaeftsfuehrung' || p.ist_admin === true) return true
  const id = bereich === 'immobilienkunden' ? 'immobilien' : bereich
  return Array.isArray(p.bereiche) && p.bereiche.includes(id)
}

/** Höchstens so viele Akten je Nachfrage und Tag. */
export const NACHFRAGE_HOECHSTENS = 3

/**
 * Text der täglichen Nachfrage. `probe` = Probelauf: geht an einen Superuser statt an die genannten
 * Verantwortlichen (je Akte steht dann dabei, an wen sie ginge).
 */
export function nachfrageText(eintraege: (KontaktLuecke & { an?: string })[], probe = false): string {
  const liste = eintraege.slice(0, NACHFRAGE_HOECHSTENS)
  const kopf = probe ? 'Probelauf der Kontakt-Nachfrage (geht noch an niemanden sonst):\n\n' : ''
  const abschalten = 'Abschalten: schreib mir „Kontakt-Nachfrage aus“.'
  if (liste.length === 1 && !probe) {
    const e = liste[0]
    return `Zu Akte ${e.name} (${BEREICH_TEXT[e.bereich] ?? e.bereich}) ${verb(e.fehlt)} ${fehltText(e.fehlt)} – weißt du ${e.fehlt.length > 1 ? 'sie' : 'es'}? Schreib oder sprich sie mir einfach, dann trage ich sie ein. Wenn nicht, ist das auch in Ordnung.\n\n${abschalten}`
  }
  return [
    `${kopf}Kurze Frage zu ${probe ? 'Akten' : 'deinen Akten'} – hier fehlen Kontaktdaten:`,
    ...liste.map((e) => `• ${e.name} (${BEREICH_TEXT[e.bereich] ?? e.bereich}): ${fehltText(e.fehlt)} ${verb(e.fehlt)}${probe && e.an ? ` – ginge an ${e.an}` : ''}`),
    '',
    'Weißt du etwas davon? Schreib oder sprich es mir einfach (z. B. „Maier: 0731 12345“), dann trage ich es ein. Was du nicht weißt, lass einfach weg.',
    '',
    abschalten,
  ].join('\n')
}
