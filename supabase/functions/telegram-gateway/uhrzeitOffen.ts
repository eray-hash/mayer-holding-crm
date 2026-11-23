// Vorläufige Termine „Uhrzeit offen“ (Runde 6, 23.11.2026).
//
// Anlass: Nannte ein Mitarbeiter einen Termin mit Tag, aber ohne Uhrzeit, fragte der Assistent nur nach — kam die
// Antwort nicht, stand nichts im Kalender. Jetzt legt termin_anlegen mit uhrzeit_offen=true sofort einen ganztägigen
// Eintrag an, erkennbar im Titel („… (Uhrzeit offen)“) und in der Notiz. Ganztägige Einträge blockieren keine
// Termine mit Uhrzeit. Kommt die Uhrzeit später, macht termin_aendern daraus einen normalen Termin und nimmt den
// Zusatz aus Titel und Notiz wieder heraus.

export const ZUSATZ = '(Uhrzeit offen)'
export const NOTIZ_ZEILE = 'Vorläufiger Eintrag: Die Uhrzeit steht noch nicht fest.'

/** Titel mit dem Zusatz „(Uhrzeit offen)“ — nie doppelt. */
export function vorlaeufigerTitel(titel: string): string {
  const t = String(titel ?? '').trim()
  return istVorlaeufig(t) ? t : `${t || 'Termin'} ${ZUSATZ}`
}

/** Trägt der Titel den Zusatz? */
export function istVorlaeufig(titel: string | null | undefined): boolean {
  return /\(\s*uhrzeit offen\s*\)/i.test(String(titel ?? ''))
}

/** Titel ohne den Zusatz. */
export function ohneZusatz(titel: string | null | undefined): string {
  return String(titel ?? '').replace(/\s*\(\s*uhrzeit offen\s*\)\s*/gi, ' ').replace(/\s+/g, ' ').trim()
}

/** Notiz mit dem Hinweis auf den vorläufigen Eintrag (vorne), eigene Notiz bleibt dahinter. */
export function vorlaeufigeNotiz(notiz: string | null | undefined): string {
  const n = String(notiz ?? '').trim()
  if (n.includes(NOTIZ_ZEILE)) return n
  return n ? `${NOTIZ_ZEILE}\n${n}` : NOTIZ_ZEILE
}

/** Notiz ohne den Hinweis. */
export function notizOhneHinweis(notiz: string | null | undefined): string {
  return String(notiz ?? '').split('\n').filter((z) => z.trim() !== NOTIZ_ZEILE).join('\n').trim()
}

/** Gibt die Eingabe eine Uhrzeit an (JJJJ-MM-TTTHH:MM)? */
export function hatUhrzeit(eingabe: unknown): boolean {
  return /T\d{2}:\d{2}/.test(String(eingabe ?? ''))
}
