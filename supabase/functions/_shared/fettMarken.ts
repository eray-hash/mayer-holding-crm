// Hervorhebung in Assistenten-Antworten (Wunsch Hasan 25.11.2026: „das Wesentliche farbig hervorheben“).
// Der Assistent setzt das Wichtigste zwischen doppelte Sternchen (**so**), davor eine farbige Marke
// (🟢 erledigt, 🟡 wartet auf dich, 🔴 Problem). Telegram kennt keine Schriftfarbe: Dort wird der
// markierte Teil fett (als „entities“, ohne parse_mode — so kann kein Sonderzeichen die Nachricht
// unzustellbar machen). Das CRM-Fenster zeigt ihn fett auf gelbem Grund (KiAssistentPanel).

export type FettStelle = { type: 'bold'; offset: number; length: number }

/** Entfernt **…**-Paare und liefert die Stellen (UTF-16-Versatz, wie Telegram ihn erwartet). Unpaarige ** bleiben stehen. */
export function fettMarken(text: string): { text: string; entities: FettStelle[] } {
  const entities: FettStelle[] = []
  let aus = ''
  let rest = text
  for (;;) {
    const a = rest.indexOf('**')
    if (a < 0) break
    const b = rest.indexOf('**', a + 2)
    if (b < 0) break
    const innen = rest.slice(a + 2, b)
    // Nur echte Hervorhebungen: nicht leer, nicht über Absätze hinweg, nicht nur Leerraum.
    if (!innen.trim() || innen.includes('\n\n') || innen.length > 600) {
      aus += rest.slice(0, a + 2)
      rest = rest.slice(a + 2)
      continue
    }
    aus += rest.slice(0, a)
    const fuehrend = innen.length - innen.trimStart().length
    const inhalt = innen.trim()
    entities.push({ type: 'bold', offset: aus.length + fuehrend, length: inhalt.length })
    aus += innen
    rest = rest.slice(b + 2)
  }
  return { text: aus + rest, entities }
}

/** Nur die Sternchen-Paare entfernen (für Sprachausgabe, Verlauf in Mails o. Ä.). */
export function ohneFettMarken(text: string): string {
  return fettMarken(text).text
}
