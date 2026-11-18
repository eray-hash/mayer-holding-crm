// Kalender: Termine je Mitarbeiter.
//
// - Tabelle `termine`: gehört dem, der den Termin anlegt (`besitzer_email`); weitere Mitarbeiter
//   stehen in `teilnehmer`. Voll sichtbar ist ein Termin nur für Besitzer und Teilnehmer
//   (Zeilenschutz). Alle anderen sehen über die Datenbankfunktion `kalender_belegt` nur, WANN
//   jemand belegt ist — nie was.
// - Geschrieben wird ausschließlich hier (kein Schreibrecht aus dem Browser): So laufen Prüfung auf
//   Überschneidung, Telegram-Nachricht an die Beteiligten und das Zurücksetzen der Erinnerungen an
//   einer Stelle — egal, ob der Termin aus der Oberfläche, per Telegram oder per Sprache kommt.
// - Erinnerungen: Der Zeitplan ruft jede Minute `sendeErinnerungen`. Jeder stellt für sich ein, wie
//   lange vorher er erinnert werden will (`kalender_einstellungen.erinnerungen`, Minuten, mehrere möglich).
import type { Aufrufer } from './postfach.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type Termin = {
  id: string
  titel: string
  beschreibung: string
  ort: string
  beginn: string
  ende: string
  ganztags: boolean
  besitzer_email: string
  teilnehmer: string[]
  kunde_id: string | null
  kunde_bereich: string | null
  kunde_name: string | null
  quelle: string
  erinnert: Record<string, number[]>
}

type Person = { email: string; name: string; chat: number | string | null }

export const ERLAUBTE_ERINNERUNGEN = [1440, 60, 30, 15]

async function ladeTeam(admin: Db): Promise<Map<string, Person>> {
  const { data } = await admin.from('mitarbeiter').select('name, email, telegram_chat_id').eq('aktiv', true)
  const team = new Map<string, Person>()
  for (const m of (data ?? []) as { name: string; email: string; telegram_chat_id: number | string | null }[]) {
    team.set(String(m.email).toLowerCase(), { email: String(m.email).toLowerCase(), name: m.name, chat: m.telegram_chat_id })
  }
  return team
}

export async function sendeTelegram(chat: number | string | null, text: string): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token || !chat) return false
  try {
    const antwort = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    })
    if (!antwort.ok) console.error('Telegram-Nachricht zum Termin fehlgeschlagen:', antwort.status)
    return antwort.ok
  } catch (err) {
    console.error('Telegram-Nachricht zum Termin fehlgeschlagen:', err)
    return false
  }
}

const TAG = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

export function zeitraumText(t: { beginn: string; ende: string; ganztags: boolean }): string {
  const von = new Date(t.beginn)
  const bis = new Date(t.ende)
  if (t.ganztags) {
    const letzter = new Date(bis.getTime() - 60000)
    return TAG.format(von) === TAG.format(letzter) ? `${TAG.format(von)}, ganztägig` : `${TAG.format(von)} bis ${TAG.format(letzter)}, ganztägig`
  }
  return TAG.format(von) === TAG.format(bis) ? `${TAG.format(von)}, ${UHR.format(von)}–${UHR.format(bis)} Uhr` : `${TAG.format(von)} ${UHR.format(von)} Uhr bis ${TAG.format(bis)} ${UHR.format(bis)} Uhr`
}

function terminText(t: Termin, team: Map<string, Person>): string {
  const namen = [t.besitzer_email, ...t.teilnehmer].map((e) => team.get(e)?.name ?? e)
  return [
    t.titel,
    zeitraumText(t),
    t.ort ? `Ort: ${t.ort}` : '',
    t.kunde_name ? `Kunde: ${t.kunde_name}` : '',
    namen.length > 1 ? `Dabei: ${namen.join(', ')}` : '',
    t.beschreibung ? `\n${t.beschreibung.slice(0, 600)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// Wer von den genannten Personen ist im Zeitraum schon belegt? (ohne den Termin selbst)
async function findeUeberschneidungen(admin: Db, personen: string[], beginn: string, ende: string, ohneId?: string): Promise<string[]> {
  const { data } = await admin.from('termine').select('id, besitzer_email, teilnehmer').lt('beginn', ende).gt('ende', beginn)
  const belegt = new Set<string>()
  for (const t of (data ?? []) as { id: string; besitzer_email: string; teilnehmer: string[] }[]) {
    if (t.id === ohneId) continue
    for (const p of [t.besitzer_email.toLowerCase(), ...(t.teilnehmer ?? [])]) if (personen.includes(p)) belegt.add(p)
  }
  return [...belegt]
}

export type TerminEingabe = {
  id?: string
  titel?: string
  beschreibung?: string
  ort?: string
  beginn?: string
  ende?: string
  ganztags?: boolean
  teilnehmer?: string[]
  kunde?: { id?: string; bereich?: string; name?: string } | null
  trotzUeberschneidung?: boolean
  quelle?: string
}

export type SpeicherErgebnis =
  | { ok: true; termin: Termin; benachrichtigt: string[]; ohneTelegram: string[] }
  | { ok: false; status: number; fehler: string; belegt?: string[] }

export async function speichereTermin(admin: Db, a: Aufrufer, e: TerminEingabe): Promise<SpeicherErgebnis> {
  const titel = String(e.titel ?? '').trim()
  if (!titel) return { ok: false, status: 400, fehler: 'Bitte einen Titel für den Termin angeben.' }
  const beginn = new Date(String(e.beginn ?? ''))
  const ende = new Date(String(e.ende ?? ''))
  if (Number.isNaN(beginn.getTime()) || Number.isNaN(ende.getTime())) return { ok: false, status: 400, fehler: 'Beginn oder Ende des Termins fehlt.' }
  if (ende.getTime() <= beginn.getTime()) return { ok: false, status: 400, fehler: 'Das Ende muss nach dem Beginn liegen.' }
  if (ende.getTime() - beginn.getTime() > 31 * 86400000) return { ok: false, status: 400, fehler: 'Ein Termin darf höchstens 31 Tage dauern.' }

  const team = await ladeTeam(admin)
  const teilnehmer = [...new Set((e.teilnehmer ?? []).map((t) => String(t).trim().toLowerCase()).filter((t) => t && t !== a.email))]
  const unbekannt = teilnehmer.filter((t) => !team.has(t))
  if (unbekannt.length > 0) return { ok: false, status: 400, fehler: `Kein aktiver Mitarbeiter: ${unbekannt.join(', ')}` }

  let vorher: Termin | null = null
  if (e.id) {
    const { data } = await admin.from('termine').select('*').eq('id', e.id).maybeSingle()
    vorher = (data as Termin | null) ?? null
    if (!vorher) return { ok: false, status: 404, fehler: 'Diesen Termin gibt es nicht mehr.' }
    if (vorher.besitzer_email.toLowerCase() !== a.email) return { ok: false, status: 403, fehler: 'Ändern kann einen Termin nur, wer ihn angelegt hat.' }
  }

  if (e.trotzUeberschneidung !== true) {
    const belegt = await findeUeberschneidungen(admin, [a.email, ...teilnehmer], beginn.toISOString(), ende.toISOString(), vorher?.id)
    if (belegt.length > 0) {
      const namen = belegt.map((p) => (p === a.email ? 'du selbst' : team.get(p)?.name ?? p))
      return { ok: false, status: 409, fehler: `In dieser Zeit schon belegt: ${namen.join(', ')}.`, belegt }
    }
  }

  const zeitGeaendert = !vorher || new Date(vorher.beginn).getTime() !== beginn.getTime() || new Date(vorher.ende).getTime() !== ende.getTime()
  // Vorläufe, die beim Anlegen schon verstrichen sind, gelten als erledigt — sonst käme direkt nach
  // dem Anlegen eines Termins für heute Nachmittag die "1 Tag vorher"-Erinnerung.
  const bisBeginn = (beginn.getTime() - Date.now()) / 60000
  const schonVorbei = ERLAUBTE_ERINNERUNGEN.filter((m) => bisBeginn <= m)
  const erinnertStart: Record<string, number[]> = {}
  for (const person of [a.email, ...teilnehmer]) erinnertStart[person] = schonVorbei
  const zeile = {
    titel,
    beschreibung: String(e.beschreibung ?? '').trim(),
    ort: String(e.ort ?? '').trim(),
    beginn: beginn.toISOString(),
    ende: ende.toISOString(),
    ganztags: e.ganztags === true,
    besitzer_email: a.email,
    teilnehmer,
    kunde_id: e.kunde?.id ?? null,
    kunde_bereich: e.kunde?.id ? e.kunde.bereich ?? null : null,
    kunde_name: e.kunde?.id ? e.kunde.name ?? null : null,
    geaendert_am: new Date().toISOString(),
    ...(vorher ? {} : { quelle: String(e.quelle ?? 'crm') }),
    // Verschobener Termin: Erinnerungen von vorn.
    ...(zeitGeaendert ? { erinnert: erinnertStart } : {}),
  }
  const abfrage = vorher ? admin.from('termine').update(zeile).eq('id', vorher.id) : admin.from('termine').insert(zeile)
  const { data: gespeichert, error } = await abfrage.select('*').single()
  if (error || !gespeichert) return { ok: false, status: 500, fehler: `Termin konnte nicht gespeichert werden: ${error?.message ?? 'unbekannter Fehler'}` }
  const termin = gespeichert as Termin

  // Nachricht an alle Beteiligten außer dem, der gerade gespeichert hat. Bei einer Änderung nur,
  // wenn sich für den Empfänger etwas Sichtbares geändert hat (Zeit, Ort, Titel) oder er neu dabei ist.
  const benachrichtigt: string[] = []
  const ohneTelegram: string[] = []
  const sichtbarGeaendert = !vorher || zeitGeaendert || vorher.ort !== termin.ort || vorher.titel !== termin.titel
  for (const p of termin.teilnehmer) {
    const neuDabei = !vorher || !(vorher.teilnehmer ?? []).includes(p)
    if (!neuDabei && !sichtbarGeaendert) continue
    const person = team.get(p)
    const kopf = neuDabei ? `📅 Neuer Termin von ${a.name}` : `📅 Termin geändert von ${a.name}`
    if (await sendeTelegram(person?.chat ?? null, `${kopf}\n\n${terminText(termin, team)}`)) benachrichtigt.push(person?.name ?? p)
    else ohneTelegram.push(person?.name ?? p)
  }
  if (vorher) {
    for (const p of (vorher.teilnehmer ?? []).filter((x) => !termin.teilnehmer.includes(x))) {
      await sendeTelegram(team.get(p)?.chat ?? null, `📅 ${a.name} hat dich aus einem Termin genommen\n\n${vorher.titel}\n${zeitraumText(vorher)}`)
    }
  }
  return { ok: true, termin, benachrichtigt, ohneTelegram }
}

// Besitzer: Termin absagen (für alle). Teilnehmer: nur sich selbst austragen.
export async function loescheTermin(admin: Db, a: Aufrufer, id: string): Promise<{ ok: true; art: 'abgesagt' | 'ausgetragen' } | { ok: false; status: number; fehler: string }> {
  const { data } = await admin.from('termine').select('*').eq('id', id).maybeSingle()
  const t = data as Termin | null
  if (!t) return { ok: false, status: 404, fehler: 'Diesen Termin gibt es nicht mehr.' }
  const team = await ladeTeam(admin)
  if (t.besitzer_email.toLowerCase() === a.email) {
    const { error } = await admin.from('termine').delete().eq('id', id)
    if (error) return { ok: false, status: 500, fehler: error.message }
    for (const p of t.teilnehmer ?? []) await sendeTelegram(team.get(p)?.chat ?? null, `📅 Termin abgesagt von ${a.name}\n\n${t.titel}\n${zeitraumText(t)}`)
    return { ok: true, art: 'abgesagt' }
  }
  if (!(t.teilnehmer ?? []).includes(a.email)) return { ok: false, status: 403, fehler: 'Das ist nicht dein Termin.' }
  const { error } = await admin.from('termine').update({ teilnehmer: t.teilnehmer.filter((p) => p !== a.email), geaendert_am: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, status: 500, fehler: error.message }
  await sendeTelegram(team.get(t.besitzer_email.toLowerCase())?.chat ?? null, `📅 ${a.name} hat abgesagt\n\n${t.titel}\n${zeitraumText(t)}`)
  return { ok: true, art: 'ausgetragen' }
}

function vorlaufText(minuten: number): string {
  if (minuten >= 1440) return 'morgen' // wird unten durch das genaue Datum ergänzt
  if (minuten >= 60) return `in ${Math.round(minuten / 60)} Stunde${minuten >= 120 ? 'n' : ''}`
  return `in ${minuten} Minuten`
}

// Vom Zeitplan jede Minute gerufen. Je Person und Termin geht pro Lauf höchstens EINE Erinnerung raus:
// die knappste fällige. Größere, ebenfalls schon fällige Vorläufe gelten damit als erledigt — sonst
// kämen bei einem kurzfristig angelegten Termin vier Nachrichten auf einmal.
export async function sendeErinnerungen(admin: Db): Promise<{ gesendet: number }> {
  const jetzt = Date.now()
  const { data } = await admin
    .from('termine')
    .select('*')
    .gt('beginn', new Date(jetzt).toISOString())
    .lt('beginn', new Date(jetzt + 1441 * 60000).toISOString())
  const termine = (data ?? []) as Termin[]
  if (termine.length === 0) return { gesendet: 0 }
  const team = await ladeTeam(admin)
  const { data: einst } = await admin.from('kalender_einstellungen').select('email, erinnerungen')
  const wunsch = new Map<string, number[]>()
  for (const z of (einst ?? []) as { email: string; erinnerungen: number[] }[]) wunsch.set(z.email.toLowerCase(), z.erinnerungen ?? [])

  let gesendet = 0
  for (const t of termine) {
    const bisBeginn = (new Date(t.beginn).getTime() - jetzt) / 60000
    const erinnert: Record<string, number[]> = { ...(t.erinnert ?? {}) }
    let geaendert = false
    for (const p of [t.besitzer_email.toLowerCase(), ...(t.teilnehmer ?? [])]) {
      const person = team.get(p)
      if (!person) continue
      const vorlaeufe = (wunsch.get(p) ?? [60]).filter((m) => ERLAUBTE_ERINNERUNGEN.includes(m))
      const schon = erinnert[p] ?? []
      const faellig = vorlaeufe.filter((m) => bisBeginn <= m && !schon.includes(m)).sort((x, y) => x - y)
      if (faellig.length === 0) continue
      const knappste = faellig[0]
      // Ganztägige Termine: nur die Erinnerung am Vortag ist sinnvoll.
      if (!(t.ganztags && knappste < 1440)) {
        const wann = knappste >= 1440 ? `am ${zeitraumText(t)}` : `${vorlaufText(Math.max(1, Math.round(bisBeginn)))} (${zeitraumText(t)})`
        const ok = await sendeTelegram(person.chat, `⏰ Erinnerung: ${t.titel} ${wann}${t.ort ? `\nOrt: ${t.ort}` : ''}${t.kunde_name ? `\nKunde: ${t.kunde_name}` : ''}`)
        if (ok) gesendet++
      }
      erinnert[p] = [...new Set([...schon, ...faellig])]
      geaendert = true
    }
    if (geaendert) await admin.from('termine').update({ erinnert }).eq('id', t.id)
  }
  return { gesendet }
}
