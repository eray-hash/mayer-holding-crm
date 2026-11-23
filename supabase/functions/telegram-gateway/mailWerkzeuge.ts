// Mail-Werkzeuge des Assistenten: eine Mail ganz lesen (mail_lesen) und eine Mail an einen Kollegen
// oder eine genannte Adresse weiterleiten (mail_weiterleiten).
//
// Anlass (Wünsche vom 19.11.2026, Eray):
// - „Terminangaben aus dem vollständigen Text einer Mail auslesen" — der Assistent sah aus dem
//   privaten Postfach nur die ersten 400 Zeichen einer Mail und konnte Datum und Uhrzeit nicht prüfen.
// - „Mails an Kollegen weiterleiten" — z. B. eine Termineinladung mit Link an einen Kollegen.
//
// Hier liegen nur Helfer ohne Rechteprüfung. Welche Mail ein Mitarbeiter sehen darf, entscheidet der
// Aufrufer in index.ts (eigenes privates Postfach oder gemeinsames Postfach mit Bereichsrechten).
import { istSichererPfad } from '../_shared/speicherPfad.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

/** Höchstlänge des Textes, den mail_lesen liefert. Reicht für lange Mails samt Verlauf. */
export const VOLLTEXT_HOECHSTENS = 40000
/** Anhänge einer Weiterleitung zusammen höchstens so groß (Rohgröße). */
// (als Base64 im Aufruf an email-gateway rund ein Drittel größer — darum nicht höher)
export const WEITERLEITUNG_ANHAENGE_HOECHSTENS = 8 * 1024 * 1024

const OEFFENTLICHE_ABLAGE = 'email-anhaenge'
const PRIVATE_ABLAGE = 'postfach-anhaenge'
const PRIVAT_VORSATZ = 'privat:'

export type MailZeile = {
  id: string
  message_id?: string | null
  von?: string | null
  von_name?: string | null
  betreff?: string | null
  mail_datum?: string | null
  ausschnitt?: string | null
  anhaenge?: { filename?: string; size?: number; contentType?: string; url?: string }[] | null
  rohdaten?: unknown
  besitzer_email?: string | null
  postfach_id?: string | null
  zugewiesener_kunde_id?: string | null
  zugewiesener_kunde_name?: string | null
  zugewiesener_bereich?: string | null
  /** Mail aus einem Bereichspostfach (z. B. immo@… → 'immobilien'): nur für Mitarbeiter dieses Bereichs. */
  postfach_bereich?: string | null
}

export const MAIL_SPALTEN = 'id, message_id, von, von_name, betreff, mail_datum, ausschnitt, anhaenge, rohdaten, besitzer_email, postfach_id, zugewiesener_kunde_id, zugewiesener_kunde_name, zugewiesener_bereich, postfach_bereich'

/** HTML grob in lesbaren Text; Links bleiben als „Text (Adresse)" erhalten — wichtig für Einladungen. */
export function htmlZuText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_g, href: string, inhalt: string) => {
      const sichtbar = inhalt.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      return !sichtbar || sichtbar === href ? ` ${href} ` : ` ${sichtbar} (${href}) `
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

/**
 * Vollständiger Text einer Mail. Abgeholte Mails (IMAP) tragen ihn im Ausschnitt (bis 20 000 Zeichen),
 * weitergeleitete (gemeinsames Postfach) in den Rohdaten (plain bzw. html) — der Ausschnitt dort hat
 * nur 500 Zeichen. Vorrang hat die Textfassung; die HTML-Fassung nur, wenn es keine längere gibt
 * (HTML wird beim Umwandeln durch Tabellen und Linkadressen oft deutlich länger als der eigentliche Text).
 */
export function volltextVon(m: MailZeile): string {
  const roh = m.rohdaten && typeof m.rohdaten === 'object' ? (m.rohdaten as Record<string, unknown>) : {}
  const ausschnitt = String(m.ausschnitt ?? '').trim()
  const text = ['plain', 'reply_plain'].map((f) => (typeof roh[f] === 'string' ? String(roh[f]).trim() : '')).sort((a, b) => b.length - a.length)[0] ?? ''
  if (text.length > 0 && text.length >= ausschnitt.length) return text
  const html = typeof roh.html === 'string' ? htmlZuText(String(roh.html)) : ''
  if (html.length > ausschnitt.length) return html
  return ausschnitt
}

/** An- und Kopie-Empfänger aus den Rohdaten, soweit bekannt. */
export function empfaengerVon(m: MailZeile): { an?: string; cc?: string } {
  const roh = m.rohdaten && typeof m.rohdaten === 'object' ? (m.rohdaten as Record<string, unknown>) : {}
  const text = (wert: unknown) => (typeof wert === 'string' && wert.trim() ? wert.trim() : undefined)
  // deno-lint-ignore no-explicit-any
  const kopf = (roh.headers && typeof roh.headers === 'object' ? roh.headers : {}) as any
  return {
    an: text(roh.an) ?? text(roh['headers[to]']) ?? text(kopf.to) ?? text(roh['envelope[to]']),
    cc: text(roh.cc) ?? text(roh['headers[cc]']) ?? text(kopf.cc),
  }
}

export function datumDeutsch(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short' }).format(d)
}

/** Text der Weiterleitung: Notiz, Trennzeile, Kopfdaten der Originalmail, Originaltext. */
export function weiterleitungsText(m: MailZeile, notiz: string, absenderName: string): string {
  const { an, cc } = empfaengerVon(m)
  const kopf = [
    '---------- Weitergeleitete Nachricht ----------',
    `Von: ${m.von_name && m.von_name !== m.von ? `${m.von_name} <${m.von}>` : m.von ?? ''}`,
    `Datum: ${datumDeutsch(m.mail_datum)}`,
    `Betreff: ${m.betreff ?? ''}`,
    an ? `An: ${an}` : '',
    cc ? `Cc: ${cc}` : '',
  ].filter(Boolean)
  const einleitung = notiz.trim() ? `${notiz.trim()}\n\nViele Grüße\n${absenderName}` : `Weitergeleitet von ${absenderName}.`
  return `${einleitung}\n\n${kopf.join('\n')}\n\n${volltextVon(m)}`
}

export function weiterleitungsBetreff(betreff: string | null | undefined): string {
  const b = String(betreff ?? '').trim() || '(ohne Betreff)'
  return /^(wg|fwd?|weitergeleitet)\s*:/i.test(b) ? b : `WG: ${b}`
}

function bytesZuBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Ort eines Anhangs im Speicher: gemeinsame Ablage (öffentliche Adresse) oder private Ablage („privat:…"). */
export function anhangOrt(url: string, supabaseUrl: string): { ablage: string; pfad: string } | null {
  if (url.startsWith(PRIVAT_VORSATZ)) {
    const pfad = url.slice(PRIVAT_VORSATZ.length)
    return istSichererPfad(pfad) ? { ablage: PRIVATE_ABLAGE, pfad } : null
  }
  const basis = `${supabaseUrl}/storage/v1/object/`
  if (!url.startsWith(basis)) return null
  const treffer = url.slice(basis.length).split(/[?#]/)[0].match(/^(?:public|sign|authenticated)\/([^/]+)\/(.+)$/)
  if (!treffer || treffer[1] !== OEFFENTLICHE_ABLAGE) return null
  try {
    const pfad = decodeURIComponent(treffer[2])
    return istSichererPfad(pfad) ? { ablage: OEFFENTLICHE_ABLAGE, pfad } : null
  } catch {
    return null
  }
}

/** Lädt die Anhänge einer Mail für den Versand (als Base64). Zu große oder unlesbare werden ausgelassen. */
export async function ladeAnhaengeFuerVersand(
  supabase: Supa,
  anhaenge: MailZeile['anhaenge'],
  supabaseUrl: string,
): Promise<{ fertig: { filename: string; contentType?: string; contentBase64: string }[]; ausgelassen: string[] }> {
  const fertig: { filename: string; contentType?: string; contentBase64: string }[] = []
  const ausgelassen: string[] = []
  let summe = 0
  for (const a of anhaenge ?? []) {
    const name = String(a.filename ?? 'Anhang')
    const ort = a.url ? anhangOrt(String(a.url), supabaseUrl) : null
    if (!ort) {
      ausgelassen.push(`${name} (nicht im CRM gespeichert)`)
      continue
    }
    if (Number(a.size ?? 0) > 0 && summe + Number(a.size) > WEITERLEITUNG_ANHAENGE_HOECHSTENS) {
      ausgelassen.push(`${name} (zu groß)`)
      continue
    }
    const { data, error } = await supabase.storage.from(ort.ablage).download(ort.pfad)
    if (error || !data) {
      ausgelassen.push(`${name} (nicht abrufbar)`)
      continue
    }
    const bytes = new Uint8Array(await data.arrayBuffer())
    if (summe + bytes.length > WEITERLEITUNG_ANHAENGE_HOECHSTENS) {
      ausgelassen.push(`${name} (zu groß)`)
      continue
    }
    summe += bytes.length
    fertig.push({ filename: name, contentType: a.contentType, contentBase64: bytesZuBase64(bytes) })
  }
  return { fertig, ausgelassen }
}

/** Vorbereitete, noch nicht bestätigte Weiterleitung (gilt nur für die direkt folgende Nachricht). */
export type WeiterleitungEntwurf = {
  id: string
  mail_id: string
  privat: boolean
  an: string
  an_name: string
  notiz: string
  betreff: string
  z: string
}

const GUELTIGE_ADRESSE = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/

/**
 * Empfänger aus der Angabe des Mitarbeiters: eine E-Mail-Adresse oder der Name eines Kollegen
 * (ganzer Name, Vor- oder Nachname — muss eindeutig sein). Kollegen bekommen die Mail an ihre
 * CRM-Adresse aus der Mitarbeiterliste.
 */
export function findeEmpfaenger(angabe: string, team: { name: string; email: string | null }[]): { email: string; name: string } | string {
  const roh = angabe.trim()
  const inKlammern = roh.match(/<([^<>]+)>/)?.[1]?.trim()
  const adresse = (inKlammern ?? roh).toLowerCase()
  if (GUELTIGE_ADRESSE.test(adresse)) {
    const kollege = team.find((m) => String(m.email ?? '').toLowerCase() === adresse)
    return { email: adresse, name: kollege?.name ?? (inKlammern ? roh.replace(/<[^<>]+>/, '').trim() || adresse : adresse) }
  }
  const einfach = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const gesucht = einfach(roh).replace(/^(herr|hr|frau|fr) /, '')
  if (!gesucht) return 'Fehler: Kein Empfänger angegeben — Name eines Kollegen oder eine E-Mail-Adresse.'
  const passend = team.filter((m) => {
    const n = einfach(m.name)
    const w = n.split(' ')
    return n === gesucht || w[0] === gesucht || (w.length > 1 && w[w.length - 1] === gesucht)
  })
  if (passend.length === 0) return `Fehler: Unter „${roh}" gibt es keinen Kollegen. Bitte den Namen genauer angeben oder eine E-Mail-Adresse nennen.`
  if (passend.length > 1) return `Fehler: „${roh}" ist nicht eindeutig (${passend.map((m) => m.name).join(', ')}). Bitte nachfragen, wer gemeint ist.`
  const k = passend[0]
  if (!k.email || !GUELTIGE_ADRESSE.test(String(k.email))) return `Fehler: Für ${k.name} ist keine E-Mail-Adresse hinterlegt.`
  return { email: String(k.email).toLowerCase(), name: k.name }
}
