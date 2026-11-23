// Reine Bestätigungen („ok“, „danke“, „passt“, 👍 …) ohne KI beantworten (Runde 6, 23.11.2026).
//
// Anlass (Nutzungsauswertung 23.11.): Auf ein bloßes „Danke“ oder 👍 antwortete der Assistent mit neuen Angeboten
// und Fragen („Soll ich noch …?“) — Lärm im Chat und ein KI-Aufruf ohne Nutzen. Jetzt prüft der Eingang der
// Nachricht (verarbeiteNachricht in index.ts) VOR dem KI-Aufruf:
//   - Ist der Text nur eine Bestätigung (feste Wörter, nur Emojis, Satzzeichen)?
//   - Wartet der Assistent gerade NICHT auf eine Antwort? Steht in seiner letzten Nachricht eine Frage, oder ist
//     eine Rückfrage offen (Mail senden, Löschen, Aktenpflege, Weiterleitung), ist „ok“ eine Zustimmung und
//     geht wie bisher an den Assistenten.
// Dann reagiert der Bot nur mit 👍 an der Nachricht (Telegram-Reaktion, keine neue Nachricht) und speichert nichts.
// Klappt die Reaktion nicht, bleibt es still.

/** Wörter und kurze Wendungen, die nur bestätigen oder danken (klein, ohne Satzzeichen). */
const BESTAETIGUNGEN = new Set([
  'ok', 'okay', 'oki', 'okey', 'okidoki', 'k', 'kk', 'jo', 'jup', 'yes',
  'danke', 'dankeschoen', 'danke schoen', 'danke dir', 'danke sehr', 'vielen dank', 'besten dank', 'merci', 'thx', 'thanks', 'dank dir',
  'passt', 'passt so', 'passt danke', 'passt schon', 'alles klar', 'alles gut', 'klar', 'gut', 'sehr gut', 'super', 'prima', 'top', 'perfekt',
  'klasse', 'spitze', 'toll', 'wunderbar', 'genau', 'verstanden', 'gerne', 'gern', 'cool', 'nice', 'bestens',
  'ok danke', 'okay danke', 'super danke', 'perfekt danke', 'top danke', 'gut danke', 'alles klar danke', 'danke dir passt', 'ok super', 'ok passt', 'ok gut',
])

/** Emojis und Zeichen, die als Bestätigung allein stehen dürfen. */
const NUR_ZEICHEN = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s!.,:;)(-]+$/u

/** Text klein, Umlaute als ae/oe/ue/ss, Emojis und Satzzeichen weg, Leerraum zusammengefasst. */
function vereinfache(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, ' ')
    .replace(/[!.,:;?()\-–—"'„“…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ist die Nachricht nur eine Bestätigung oder ein Dank (höchstens ein paar Wörter, keine Frage)? */
export function istReineBestaetigung(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim()
  if (!t || t.length > 40 || t.includes('?')) return false
  if (NUR_ZEICHEN.test(t) && /[\p{Extended_Pictographic}]/u.test(t)) return true
  const v = vereinfache(t)
  if (!v) return false
  return BESTAETIGUNGEN.has(v)
}

// deno-lint-ignore no-explicit-any
type Zustand = { zuege?: { msgs?: { role?: string; content?: any }[] }[]; loesch_anfrage?: unknown; pflege_anfrage?: unknown; mail_anfrage?: unknown; weiterleitung_anfrage?: unknown }

/** Text der letzten Nachricht des Assistenten im gespeicherten Verlauf ('' wenn keine). */
export function letzteAssistentText(state: Zustand): string {
  const zuege = Array.isArray(state?.zuege) ? state.zuege : []
  for (let i = zuege.length - 1; i >= 0; i--) {
    const msgs = Array.isArray(zuege[i]?.msgs) ? zuege[i].msgs! : []
    for (let j = msgs.length - 1; j >= 0; j--) {
      const m = msgs[j]
      if (m?.role !== 'assistant') continue
      if (typeof m.content === 'string') return m.content
      if (Array.isArray(m.content)) {
        // deno-lint-ignore no-explicit-any
        const t = m.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n')
        if (t.trim()) return t
      }
    }
  }
  return ''
}

/** Wartet der Assistent auf eine Antwort (offene Rückfrage oder Frage am Ende seiner letzten Nachricht)? */
export function wartetAufAntwort(state: Zustand): boolean {
  if (state?.loesch_anfrage || state?.pflege_anfrage || state?.mail_anfrage || state?.weiterleitung_anfrage) return true
  const letzte = letzteAssistentText(state).trim()
  if (!letzte) return false
  // Eine Frage irgendwo in den letzten Zeilen (oft steht danach noch ein Satz wie „Sag einfach Bescheid.“).
  return /\?/.test(letzte.slice(-400))
}

/** Soll diese Nachricht ohne KI nur mit einer 👍-Reaktion beantwortet werden? */
export function nurDaumen(text: string | null | undefined, state: Zustand): boolean {
  return istReineBestaetigung(text) && !wartetAufAntwort(state)
}

/** Setzt 👍 als Reaktion an die Nachricht des Mitarbeiters. true = hat geklappt. Wirft nie. */
export async function reagiereMitDaumen(token: string | undefined, chatId: number | string, nachrichtId: number | undefined, holen: typeof fetch = fetch): Promise<boolean> {
  if (!token || !nachrichtId) return false
  try {
    const antwort = await holen(`https://api.telegram.org/bot${token}/setMessageReaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: nachrichtId, reaction: [{ type: 'emoji', emoji: '👍' }] }),
    })
    return antwort.ok
  } catch {
    return false
  }
}
