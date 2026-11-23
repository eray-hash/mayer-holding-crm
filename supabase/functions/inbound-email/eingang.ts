// Reine Hilfsfunktionen für inbound-email (ohne Netz, ohne Datenbank) — getrennt, damit sie testbar sind.

// Message-IDs enthalten u.a. spitze Klammern und @ (z.B. "<123@mail.example.com>"), die im
// Storage-Pfad nicht erlaubt sind — deshalb wird hier auf ein sicheres Zeichenset reduziert.
export function sicheresPfadsegment(s: string): string {
  return s.replace(/^<|>$/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** Ablagepfad eines Anhangs. Mit laufender Nummer: Zwei Anhänge derselben Mail mit gleichem Namen (z. B. zweimal
 *  „inline“ oder „image.jpg“ vom Handy) überschrieben sich vorher gegenseitig — der erste war verloren (gesehen
 *  am 09.11.2026). */
export function anhangPfad(messageId: string, dateiname: string, nummer: number): string {
  return `${sicheresPfadsegment(messageId)}/${nummer}_${sicheresPfadsegment(dateiname || 'anhang')}`
}

/** Absender aus dem From-Kopf: 'Name <a@b.de>', '"Name" <a@b.de> (Kommentar)', 'a@b.de (Name)' oder 'a@b.de'.
 *  Die Adresse immer klein geschrieben (wie beim Postfach-Abruf) — vorher blieb bei einem Kommentar hinter der
 *  Adresse der ganze Kopf als „Adresse“ stehen. */
export function parseFromHeader(raw: string): { email: string; name: string } {
  const text = raw.trim()
  const inKlammern = text.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>/)
  if (inKlammern) {
    const email = inKlammern[2].trim().toLowerCase()
    const name = inKlammern[1].trim().replace(/^"|"$/g, '').trim()
    return { email, name: name || email }
  }
  const nackt = text.match(/^([^\s<>()]+@[^\s<>()]+)\s*(?:\((.*)\))?$/)
  if (nackt) {
    const email = nackt[1].toLowerCase()
    return { email, name: (nackt[2] ?? '').trim() || email }
  }
  return { email: text.toLowerCase(), name: text }
}

/** Text aus HTML — Stil- und Skriptblöcke fallen weg (vorher stand bei manchen Mails CSS im Mailtext). */
export function textAusHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Datum der Mail aus dem Date-Kopf. Fehlt er, ist er unlesbar oder liegt er in der Zukunft: Eingangszeit.
 *  Vorher stand bei jeder weitergeleiteten Mail die Eingangszeit (bei 45 von 338 Mails mehr als 10 Minuten daneben). */
export function mailDatum(kopf: string | undefined, jetzt = Date.now()): string {
  const ohneKommentar = String(kopf ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()
  const zeit = ohneKommentar ? Date.parse(ohneKommentar) : Number.NaN
  if (!Number.isFinite(zeit) || zeit > jetzt + 5 * 60_000 || zeit < Date.UTC(1990, 0, 1)) return new Date(jetzt).toISOString()
  return new Date(zeit).toISOString()
}
