// Verständliche deutsche Meldung, wenn der KI-Anbieter eine Anfrage wegen Kontogrenzen ablehnt (24.11.2026: die
// Monatsgrenze war erreicht, im CRM und in Telegram stand der rohe englische Text). Alle anderen Fehler bleiben, wie sie
// waren — an deren Wortlaut („Anthropic-API-Fehler (529)“ …) hängen Wiederholungsregeln (dokumentLesen.ts).

/** Gibt den deutschen Text für eine gesperrte KI zurück, sonst `sonst`. */
export function kiFehlerText(detail: string, sonst: string): string {
  const d = String(detail ?? '')
  if (/usage limits/i.test(d)) {
    const bis = d.match(/(\d{4})-(\d{2})-(\d{2})/)
    return `Die KI ist gerade gesperrt: Die Monatsgrenze beim KI-Anbieter ist erreicht${bis ? ` (ohne Änderung erst ab ${bis[3]}.${bis[2]}.${bis[1]} wieder frei)` : ''}. Die Geschäftsführung kann die Grenze in der Anthropic-Konsole erhöhen.`
  }
  if (/credit balance is too low/i.test(d)) {
    return 'Die KI ist gerade gesperrt: Das Guthaben beim KI-Anbieter ist aufgebraucht. Die Geschäftsführung kann es in der Anthropic-Konsole aufladen.'
  }
  return sonst
}
