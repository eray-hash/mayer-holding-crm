// Monatlicher Hinweis „Du hast N alte To-dos — aufräumen?“ per Telegram (22.11.2026) — vom Zeitplan jede Minute
// gerufen (Aktion termin_erinnerungen in index.ts), ohne offenes Browserfenster.
//
// - Nur für Mitarbeiter, die ihn eingeschaltet haben (todo_aufraeumen_einstellungen.monatlich_hinweis, Standard
//   AUS; Schalter im CRM im Feld „Aufräumen“ der To-Do-Liste).
// - Werktags zwischen 9 und 10 Uhr (deutsche Zeit), höchstens einmal je Kalendermonat: Vor dem Senden wird
//   zuletzt_monat gesetzt (nur wenn er noch nicht dieser Monat ist) — wer das nicht schafft, sendet nicht.
//   Außerhalb des Fensters ohne Datenbankzugriff.
// - Gezählt werden die Aufgaben der eigenen Liste, die die Aufräum-Prüfung (_shared/todoAufraeumen.ts) vorschlägt.
//   Unter 10 keine Nachricht (der Monat gilt trotzdem als geprüft).
// - Privat bleibt privat (Erays Regel vom 21.11.2026): Nutzt die Person den privaten Assistenten, ist die eigene
//   Liste privat → Hinweis nur über den privaten Bot, nie ersatzweise über den Mayer-Bot. Sonst über den Mayer-Bot
//   und ohne Aufgaben aus Microsoft To Do.
// - Wirft nie.

import { analysiereTodos, ladeOffeneTodos } from '../_shared/todoAufraeumen.ts'
import { privatBotAktiv, sendePrivat } from '../_shared/telegramPrivat.ts'
import { sendeTelegram } from './kalender.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const HINWEIS_AB = 10

export type HinweisWege = {
  sendeMayer: (chat: number | string, text: string) => Promise<boolean>
  sendePrivat: (chat: number | string, text: string) => Promise<boolean>
  privatBotAktiv: (email: string) => Promise<boolean>
}

/** Wochentag (0 = Sonntag), Stunde, Datum und Monat in deutscher Zeit. */
export function berlinJetzt(jetzt: Date): { wochentag: number; stunde: number; datum: string; monat: string } {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(jetzt)
      .map((p) => [p.type, p.value]),
  )
  const tage: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const datum = `${teile.year}-${teile.month}-${teile.day}`
  return { wochentag: tage[teile.weekday] ?? 0, stunde: Number(teile.hour), datum, monat: datum.slice(0, 7) }
}

export function hinweisText(anzahl: number, privat: boolean): string {
  const liste = privat ? 'deiner privaten To-do-Liste' : 'deiner eigenen To-do-Liste'
  return `Kleiner Hinweis zum Monatsanfang: In ${liste} sind ${anzahl.toLocaleString('de-DE')} Aufgaben, die man wohl aufräumen kann (doppelt, lange unberührt, lange überfällig oder schon erledigt).\n\nAufräumen: im CRM in der To-Do-Liste über „Aufräumen“, oder schreib mir „räum meine To-dos auf“. Dort lässt sich dieser Hinweis auch abschalten.`
}

const STANDARD_WEGE = (admin: Db): HinweisWege => ({
  sendeMayer: (chat, text) => sendeTelegram(chat, text),
  sendePrivat: async (chat, text) => !!(await sendePrivat(chat, text)),
  privatBotAktiv: (email) => privatBotAktiv(admin, email),
})

export async function pruefeTodoAufraeumHinweise(admin: Db, wege?: HinweisWege, jetzt = new Date()): Promise<{ gelaufen: boolean; gesendet: number; fehler: string[] }> {
  const ergebnis = { gelaufen: false, gesendet: 0, fehler: [] as string[] }
  const z = berlinJetzt(jetzt)
  if (z.wochentag === 0 || z.wochentag === 6 || z.stunde !== 9) return ergebnis
  ergebnis.gelaufen = true
  const w = wege ?? STANDARD_WEGE(admin)
  try {
    const { data: einst, error } = await admin.from('todo_aufraeumen_einstellungen').select('email, zuletzt_monat').eq('monatlich_hinweis', true)
    if (error) {
      ergebnis.fehler.push(`Einstellungen nicht lesbar: ${error.message}`)
      return ergebnis
    }
    const offen = ((einst ?? []) as { email: string; zuletzt_monat: string | null }[]).filter((e) => e.email && e.zuletzt_monat !== z.monat)
    if (offen.length === 0) return ergebnis
    const { data: team } = await admin.from('mitarbeiter').select('email, telegram_chat_id, aktiv').eq('aktiv', true)
    const chatVon = new Map(((team ?? []) as { email: string | null; telegram_chat_id: number | string | null }[]).map((m) => [String(m.email ?? '').toLowerCase(), m.telegram_chat_id]))
    for (const e of offen) {
      const email = e.email.toLowerCase()
      try {
        // Erst den Monat beanspruchen — so kommt der Hinweis auch bei gleichzeitigen Läufen nur einmal.
        const { data: belegt, error: fehlerBeleg } = await admin
          .from('todo_aufraeumen_einstellungen')
          .update({ zuletzt_monat: z.monat })
          .eq('email', e.email)
          .or(`zuletzt_monat.is.null,zuletzt_monat.neq.${z.monat}`)
          .select('email')
        if (fehlerBeleg || !(belegt ?? []).length) continue
        const chat = chatVon.get(email)
        if (chat == null || chat === '') continue
        const privat = await w.privatBotAktiv(email).catch(() => false)
        let todos = await ladeOffeneTodos(admin, { besitzer: email })
        if (!privat) todos = todos.filter((t) => !t.ms_id)
        const v = analysiereTodos(todos, { heute: z.datum })
        const anzahl = new Set(v.flatMap((x) => x.todo_ids.filter((id) => id !== x.behalten_id))).size
        if (anzahl < HINWEIS_AB) continue
        const ok = privat ? await w.sendePrivat(chat, hinweisText(anzahl, true)) : await w.sendeMayer(chat, hinweisText(anzahl, false))
        if (ok) ergebnis.gesendet++
        else ergebnis.fehler.push(`Hinweis an ${email} nicht zugestellt`)
      } catch (err) {
        ergebnis.fehler.push(`${email}: ${err instanceof Error ? err.message : err}`)
      }
    }
  } catch (err) {
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  if (ergebnis.gesendet > 0 || ergebnis.fehler.length > 0) console.log(`To-do-Aufräumhinweis: ${ergebnis.gesendet} gesendet.`, ergebnis.fehler.join(' | '))
  return ergebnis
}
