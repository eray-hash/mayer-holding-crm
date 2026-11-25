// Wann eine gezeigte, noch nicht freigegebene Mail (state.mail_anfrage) über einen Gesprächszug hinaus
// freigebbar bleibt (index.ts, agentAntwort). Anlass: Andreas 25.11.2026 — Rückfrage zwischen Fassung und „Ja“.

/** Bleibt die zuletzt gezeigte Mail über diesen Zug hinaus freigebbar? Nicht bei Ablehnung, neuer Fassung oder Versand. */
export function behaeltMailEntwurf(eingang: string, warDa: boolean, neuVorbereitet: boolean, gesendet: boolean): boolean {
  if (!warDa || neuVorbereitet || gesendet) return false
  const getippt = eingang.replace(/^\[Sprachnachricht[^\]]*\]\s*/, '').trim()
  return !/^(nein|ne|nö|noe|stopp?|abbrechen|abbruch|verwerfen|lösch|nicht (senden|schicken|verschicken)|lass (es|das|mal)|doch nicht|vergiss)/i.test(getippt)
}

