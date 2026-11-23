// Abend-Rückblick im Mayer-Bot (email-gateway/abendRueckblick.ts, 23.11.2026): Werkzeug zum An-/Abschalten für den
// Fragenden („Abend-Rückblick aus“) und die Knöpfe „✓ Erledigt“ / „→ Morgen“ (callback ar:e:<todo_id> / ar:m:<todo_id>).
//
// - Werkzeug abend_rueckblick_einstellen: schreibt nur die eigene Zeile in assistent_hinweise (abend_rueckblick).
//   Ob der Rückblick überhaupt läuft, entscheidet der gemeinsame Schalter assistent_hinweis_einstellung.abend_rueckblick.
//   Nur im Mayer-Assistenten (der private Bot hat seinen eigenen Rückblick um 21:30).
// - Knopf: nur im Mayer-Bot und nur im Chat der Person; Rechte in fuehreAbendKnopfAus (nur Aufgaben, die in ihren
//   Rückblick gehören). Danach wird die Nachricht ersetzt: Vermerk an der Zeile, die beiden Knöpfe weg.

import { fuehreAbendKnopfAus, type Knopf, nachrichtNachKlick, setzeAbendRueckblick } from '../email-gateway/abendRueckblick.ts'
import type { RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type AbendKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
}

export const ABEND_RUECKBLICK_WERKZEUGE = [
  {
    name: 'abend_rueckblick_einstellen',
    description:
      'Schaltet den Abend-Rückblick für den Mitarbeiter, mit dem du sprichst, an oder aus: werktags gegen Feierabend eine kurze Telegram-Nachricht „Heute erledigt: N“, ' +
      'seine noch offenen fälligen Aufgaben mit Knöpfen „✓ Erledigt“ / „→ Morgen“ und eine Zeile mit Terminen und Wiedervorlagen für morgen. ' +
      'Nur auf ausdrücklichen Wunsch („Abend-Rückblick aus“, „keinen Rückblick mehr“, „Rückblick wieder an“).',
    input_schema: {
      type: 'object',
      properties: { an: { type: 'boolean', description: 'true = an, false = aus.' } },
      required: ['an'],
    },
  },
]

export function istAbendRueckblickWerkzeug(name: string): boolean {
  return ABEND_RUECKBLICK_WERKZEUGE.some((w) => w.name === name)
}

// deno-lint-ignore no-explicit-any
export async function fuehreAbendRueckblickWerkzeugAus(name: string, input: any, k: AbendKontext): Promise<string> {
  if (name !== 'abend_rueckblick_einstellen') return `Fehler: unbekanntes Werkzeug ${name}.`
  if (k.mitarbeiter.nurPrivat === true) return 'Im privaten Assistenten gibt es den Mayer-Abend-Rückblick nicht — dein privater Rückblick kommt hier um 21:30.'
  if (typeof input?.an !== 'boolean') return 'Fehler: an (true/false) fehlt.'
  const email = String(k.mitarbeiter.email ?? '').trim().toLowerCase()
  if (!email) return 'Fehler: Zu deinem Zugang ist keine E-Mail-Adresse hinterlegt.'
  const f = await setzeAbendRueckblick(k.supabase, email, input.an)
  if (f) return `Fehler beim Speichern: ${f}`
  k.protokolliere(`Abend-Rückblick ${input.an ? 'eingeschaltet' : 'ausgeschaltet'}`)
  return input.an
    ? 'Der Abend-Rückblick ist für dich an: werktags gegen Feierabend eine kurze Nachricht mit deinen offenen Aufgaben (sobald die Geschäftsführung ihn freigegeben hat).'
    : 'Der Abend-Rückblick ist für dich aus. Wieder einschalten: „Abend-Rückblick an“.'
}

export type TelegramApi = (methode: string, daten: Record<string, unknown>) => Promise<Record<string, unknown> | null>

/**
 * Knopf „ar:…“ unter dem Abend-Rückblick (nur Mayer-Bot; den privaten Bot prüft der Aufrufer). Führt aus, antwortet am
 * Knopf und ersetzt die Nachricht. Wirft nie.
 */
// deno-lint-ignore no-explicit-any
export async function verarbeiteAbendKnopf(k: { supabase: Supa; knopf: any; antworte: (text: string) => Promise<unknown>; telegram: TelegramApi; jetzt?: Date }): Promise<void> {
  try {
    const chatId = k.knopf?.message?.chat?.id
    const daten = String(k.knopf?.data ?? '')
    if (!chatId) return void (await k.antworte('Unbekannter Knopf.'))
    const { data: m } = await k.supabase.from('mitarbeiter').select('name, email, rolle, ist_admin, bereiche, aktiv').eq('telegram_chat_id', chatId).maybeSingle()
    if (!m?.aktiv || !m.email) return void (await k.antworte('Dieser Chat ist mit keinem CRM-Zugang verbunden.'))
    const person = {
      email: String(m.email).trim().toLowerCase(),
      name: String(m.name ?? ''),
      gf: m.rolle === 'geschaeftsfuehrung' || m.ist_admin === true,
      bereiche: Array.isArray(m.bereiche) ? m.bereiche.map(String) : [],
    }
    const r = await fuehreAbendKnopfAus(k.supabase, person, daten, k.jetzt)
    await k.antworte(r.text)
    const nachricht = k.knopf?.message
    if (r.vermerk && nachricht?.message_id) {
      const tastatur = (nachricht.reply_markup?.inline_keyboard ?? []) as Knopf[][]
      const neu = nachrichtNachKlick(String(nachricht.text ?? ''), tastatur, daten, r.vermerk)
      await k.telegram('editMessageText', { chat_id: chatId, message_id: nachricht.message_id, text: neu.text, reply_markup: { inline_keyboard: neu.tastatur } })
    }
  } catch (err) {
    console.error('Abend-Rückblick-Knopf fehlgeschlagen:', err)
    await k.antworte('Das hat nicht geklappt.').catch(() => undefined)
  }
}
