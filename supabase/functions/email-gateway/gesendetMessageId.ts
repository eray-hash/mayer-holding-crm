// Message-ID für Mails, die über das CRM verschickt werden (Aktion `send`), 22.11.2026.
//
// Bisher bekam eine über das CRM verschickte Mail ihre Message-ID in `gesendete_emails.message_id` erst,
// wenn der Gesendet-Abruf (gesendetAbruf.ts) sie im Gesendet-Ordner wiederfand — oft gar nicht, denn
// das CRM legt keine Kopie dort ab. Antworten des Kunden (In-Reply-To/References) ließen sich deshalb
// nicht dem Verlauf der Akte zuordnen (mailZuordnung.ts sucht genau diese Kennung).
//
// Jetzt erzeugt `send` die Message-ID selbst, gibt sie dem Versand mit (nodemailer-Option `messageId`)
// und schreibt sie sofort in die Zeile. Die Schreibweise in der Tabelle ist dieselbe wie beim
// Gesendet-Abruf, damit dieselbe Mail dort als „schon vorhanden“ erkannt und nicht doppelt angelegt wird:
// gemeinsame Postfächer die Message-ID selbst (`<…@…>`), persönliche mit vorangestellter Postfach-Kennung
// (`<postfach-id>:<…@…>`).

const ERSATZ_DOMAIN = 'amayer-holding.com'

/** Domain einer Absenderadresse (auch aus „Name <adresse>“), sonst die Firmendomain. */
export function domainVon(adresse: string | null | undefined): string {
  const roh = String(adresse ?? '').trim().toLowerCase()
  const inKlammern = roh.match(/<([^<>]+)>/)
  const reine = (inKlammern ? inKlammern[1] : roh).trim()
  const domain = reine.includes('@') ? reine.slice(reine.lastIndexOf('@') + 1) : ''
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain) ? domain : ERSATZ_DOMAIN
}

/** Neue, eindeutige Message-ID `<zufall@domain-des-absenders>` (wie sie Mail-Programme erzeugen). */
export function neueMessageId(absenderAdresse: string | null | undefined, zufall: string = crypto.randomUUID()): string {
  const teil = String(zufall).replace(/[^A-Za-z0-9.-]/g, '') || crypto.randomUUID()
  return `<${teil}.crm@${domainVon(absenderAdresse)}>`
}

/**
 * Wert für `gesendete_emails.message_id` — gleiche Form wie `kennungVon` in gesendetAbruf.ts.
 * `persoenlich` = das Absender-Postfach hat einen Besitzer (`postfaecher.besitzer_email`).
 */
export function gesendetKennung(messageId: string | null | undefined, postfach: { id: string; persoenlich: boolean }): string | null {
  const mid = String(messageId ?? '').trim()
  if (!mid) return null
  const mitKlammern = mid.startsWith('<') ? mid : `<${mid}>`
  return postfach.persoenlich ? `${postfach.id}:${mitKlammern}` : mitKlammern
}
