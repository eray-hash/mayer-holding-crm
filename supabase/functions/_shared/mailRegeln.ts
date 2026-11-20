// Regeln für das private Postfach eines Mitarbeiters, das das CRM live über Microsoft Graph liest (nichts
// wird kopiert). Zwei Aufgaben:
//  1. Mayer-Geschäft ausblenden: Der Mitarbeiter erledigt aus dem privaten Postfach auch Arbeit für die
//     Mayer Holding (leitet z. B. Kundenmails an info@/immo@ weiter). Solche Mails dürfen weder in der
//     privaten Ansicht noch beim Assistenten noch im Morgenbericht auftauchen.
//  2. Mails einordnen (dringend, Rechnung, Zahlung, Werbung, Code …) für den Morgenbericht; Übertragung
//     der Regeln aus dem ursprünglichen Python-Skript, gleiche Muster, Groß-/Kleinschreibung egal.
// Reine Funktionen ohne Abhängigkeiten, damit sie überall (Edge-Funktionen, Tests) laufen.

export type GraphAdresse = { emailAddress?: { name?: string | null; address?: string | null } | null }

export type GraphMail = {
  id?: string
  conversationId?: string | null
  subject?: string | null
  from?: GraphAdresse | null
  sender?: GraphAdresse | null
  toRecipients?: GraphAdresse[] | null
  ccRecipients?: GraphAdresse[] | null
  bccRecipients?: GraphAdresse[] | null
  replyTo?: GraphAdresse[] | null
  receivedDateTime?: string | null
  bodyPreview?: string | null
  hasAttachments?: boolean | null
  isRead?: boolean | null
  flag?: { flagStatus?: 'notFlagged' | 'flagged' | 'complete' | string | null } | null
  inferenceClassification?: 'focused' | 'other' | string | null
}

export type MayerRegel = {
  /** Domains klein und ohne @, z. B. 'amayer-holding.com'; Subdomains zählen mit. */
  domains: string[]
  /** Einzelne vollständige Adressen. */
  adressen: string[]
  /** conversationIds, von denen bekannt ist, dass eine Mail an/von Mayer darin steckt. */
  unterhaltungen: Set<string>
}

// ---------------------------------------------------------------------------------------------------
// Adressen

/** Reine Adresse aus „Name <a@b.de>“ oder „a@b.de“, klein und ohne Leerzeichen; '' wenn nichts da ist. */
export function adresseNormal(adresse: string | null | undefined): string {
  let a = String(adresse ?? '').trim()
  const spitz = a.match(/<([^<>]*)>/)
  if (spitz) a = spitz[1]
  a = a.trim().replace(/^mailto:/i, '').toLowerCase()
  return a
}

/** Domain einer Adresse, klein; '' wenn kein @ vorhanden ist. */
export function domainVon(adresse: string): string {
  const a = adresseNormal(adresse)
  const at = a.lastIndexOf('@')
  if (at < 0) return ''
  return a.slice(at + 1).trim().replace(/\.+$/, '')
}

function domainNormal(domain: string): string {
  return String(domain ?? '').trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, '')
}

/** Gleiche Domain oder Subdomain davon (mail.x.de passt zu x.de, nichtx.de nicht). */
function passtZuDomain(domain: string, regelDomain: string): boolean {
  if (!domain || !regelDomain) return false
  return domain === regelDomain || domain.endsWith('.' + regelDomain)
}

function adressenAus(liste: GraphAdresse[] | null | undefined): string[] {
  return (liste ?? []).map((e) => adresseNormal(e?.emailAddress?.address)).filter(Boolean)
}

/** Alle Beteiligten einer Mail (Absender, Sender, Antwort-an, An, Cc, Bcc), klein und ohne Doppelte. */
export function beteiligteAdressen(m: GraphMail): string[] {
  const alle = [
    adresseNormal(m.from?.emailAddress?.address),
    adresseNormal(m.sender?.emailAddress?.address),
    ...adressenAus(m.replyTo),
    ...adressenAus(m.toRecipients),
    ...adressenAus(m.ccRecipients),
    ...adressenAus(m.bccRecipients),
  ].filter(Boolean)
  return [...new Set(alle)]
}

/** Gehört die Adresse zu Mayer? Genaue Adresse oder Domain einschließlich Subdomains. */
export function istMayerAdresse(adresse: string, regel: MayerRegel): boolean {
  const a = adresseNormal(adresse)
  if (!a) return false
  if (regel.adressen.some((x) => adresseNormal(x) === a)) return true
  const d = domainVon(a)
  return regel.domains.some((x) => passtZuDomain(d, domainNormal(x)))
}

// ---------------------------------------------------------------------------------------------------
// Mayer-Geschäft ausblenden

/** Mayer-Mail, wenn ein Beteiligter zu Mayer gehört oder die Unterhaltung als Mayer-Unterhaltung bekannt ist. */
export function istMayerMail(m: GraphMail, regel: MayerRegel): boolean {
  if (m.conversationId && regel.unterhaltungen.has(m.conversationId)) return true
  return beteiligteAdressen(m).some((a) => istMayerAdresse(a, regel))
}

/** Trennt Mayer-Mails ab; zurück kommen die sichtbaren Mails und wie viele ausgeblendet wurden. */
export function filtereMayer<T extends GraphMail>(mails: T[], regel: MayerRegel): { sichtbar: T[]; ausgeblendet: number } {
  const sichtbar = mails.filter((m) => !istMayerMail(m, regel))
  return { sichtbar, ausgeblendet: mails.length - sichtbar.length }
}

/**
 * Aus dem Ordner „Gesendete Elemente“: conversationIds der Mails, die an eine Mayer-Adresse gingen
 * (z. B. weitergeleitete Kundenmails). Damit wird die ganze Unterhaltung gemerkt und auch die
 * ursprüngliche Kundenmail im Posteingang ausgeblendet.
 */
export function mayerUnterhaltungenAus(gesendete: GraphMail[], regel: MayerRegel): string[] {
  const ids = new Set<string>()
  for (const m of gesendete) {
    if (!m.conversationId) continue
    const empfaenger = [...adressenAus(m.toRecipients), ...adressenAus(m.ccRecipients), ...adressenAus(m.bccRecipients)]
    if (empfaenger.some((a) => istMayerAdresse(a, regel))) ids.add(m.conversationId)
  }
  return [...ids]
}

// Freemail-/Verbraucheranbieter: deren Domains sind nie „die Firma“.
const FREEMAIL_GENAU = new Set([
  'msn.com', 'gmail.com', 'googlemail.com', 'web.de', 't-online.de', 'icloud.com', 'me.com', 'mac.com',
  'freenet.de', 'mailbox.org', 'proton.me', 'pm.me', 'arcor.de', '1und1.de', 'online.de',
])
// Anbieter mit beliebiger Länderendung (hotmail.de, yahoo.co.uk, gmx.net …).
const FREEMAIL_JEDE_ENDUNG = /^(?:hotmail|outlook|live|gmx|yahoo|aol|posteo|protonmail)\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/

export function istFreemailDomain(domain: string): boolean {
  const d = domainNormal(domain)
  return FREEMAIL_GENAU.has(d) || FREEMAIL_JEDE_ENDUNG.test(d)
}

/**
 * Vorschlag für die Mayer-Domains aus den Postfach-Adressen des CRM und den Login-Adressen der
 * Mitarbeiter; Freemail-Anbieter und die zusätzlich ausgeschlossenen Domains (samt Subdomains) fallen
 * weg. Ohne Doppelte, sortiert.
 */
export function standardMayerDomains(postfachAdressen: string[], mitarbeiterAdressen: string[], ausgeschlossen: string[] = []): string[] {
  const aus = ausgeschlossen.map(domainNormal).filter(Boolean)
  const domains = new Set<string>()
  for (const a of [...postfachAdressen, ...mitarbeiterAdressen]) {
    const d = domainVon(a)
    if (!d || istFreemailDomain(d)) continue
    if (aus.some((x) => passtZuDomain(d, x))) continue
    domains.add(d)
  }
  return [...domains].sort()
}

// ---------------------------------------------------------------------------------------------------
// Einordnen für den Morgenbericht (aus dem Python-Original übertragen)

export const MUSTER = {
  dringend: /mahnung|zahlungserinnerung|letzte aufforderung|inkasso|forderung|frist|vollstreckung|kontostand.*niedrig|gericht|finanzamt|kündigung|säumnis/iu,
  rechnung: /rechnung|invoice|gutschrift|einzugsermächtigung|lastschrift/iu,
  zahlung: /zahlung durchgeführt|überweisung (ist abgeschlossen|erhalten)|abonnementzahlung|zahlungsbeleg/iu,
  code: /(anmelde|verifizierungs|sicherheits|bestätigungs|einmal)[- ]?code|verification code|login code|\bOTP\b/iu,
  werbung: /newsletter|webinar|rabatt|% off|angebot|sorgenfrei|dispositionskredit|gute nachrichten|vorautorisierung|verify your identity|how was your stay/iu,
}

export type Einordnung = 'code' | 'dringend' | 'rechnung' | 'zahlung' | 'werbung' | 'wichtig' | 'unwichtig'

/** Geprüfter Text: Betreff + die ersten 200 Zeichen der Vorschau. */
export function pruefText(m: GraphMail): string {
  return `${m.subject ?? ''} ${(m.bodyPreview ?? '').slice(0, 200)}`
}

/**
 * Reihenfolge: Code → dringend → Rechnung → Zahlung → Werbung (Outlook „Sonstige“ oder Werbemuster) →
 * wichtig (markiert, oder „Relevant“ und ungelesen) → unwichtig. Dadurch schlägt z. B. eine Mahnung,
 * die Outlook unter „Sonstige“ einsortiert hat, trotzdem als dringend durch.
 */
export function einordnen(m: GraphMail): Einordnung {
  const t = pruefText(m)
  if (MUSTER.code.test(t)) return 'code'
  if (MUSTER.dringend.test(t)) return 'dringend'
  if (MUSTER.rechnung.test(t)) return 'rechnung'
  if (MUSTER.zahlung.test(t)) return 'zahlung'
  if (m.inferenceClassification === 'other' || MUSTER.werbung.test(t)) return 'werbung'
  if (m.flag?.flagStatus === 'flagged' || (m.inferenceClassification === 'focused' && m.isRead === false)) return 'wichtig'
  return 'unwichtig'
}

/** Offener Punkt: dringend, Rechnung oder markiert – aber nicht erledigt und nie ein Code. */
export function offenerPunkt(m: GraphMail): boolean {
  const art = einordnen(m)
  if (art === 'code') return false
  const status = m.flag?.flagStatus
  if (status === 'complete') return false
  return art === 'dringend' || art === 'rechnung' || status === 'flagged'
}

// ---------------------------------------------------------------------------------------------------
// Beträge und Kontonummern aus Push-Texten entfernen

const WAEHRUNG = String.raw`(?:€|EUR|Euro|USD|US\$|\$|CHF|£|GBP)`
const ZAHL = String.raw`\d{1,3}(?:[.'’]\d{3})+(?:,-{1,2}|[.,]\d{1,2})?|\d+(?:,-{1,2}|[.,]\d{1,2})?`
const BETRAG = new RegExp(
  String.raw`[-+]?(?<![\p{L}\d])${WAEHRUNG}\s?[-+]?(?:${ZAHL})(?!\d)|[-+]?(?<![\d.,])(?:${ZAHL})\s?${WAEHRUNG}(?![\p{L}])`,
  'giu',
)
// IBAN: zwei Buchstaben, zwei Prüfziffern, dann 11–30 Zeichen, gern in Vierergruppen.
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g
const KONTONUMMER = /\b(?:Konto(?:nummer|[- ]?Nr\.?)|Kto\.?(?:[- ]?Nr\.?)?)\s*:?\s*\d[\d ]{4,}\d/giu

/** Ersetzt Geldbeträge durch „[Betrag]“ und IBAN/Kontonummern durch „[Konto]“. */
export function ohneBetraege(text: string): string {
  return String(text ?? '')
    .replace(IBAN, '[Konto]')
    .replace(KONTONUMMER, '[Konto]')
    .replace(BETRAG, '[Betrag]')
}
