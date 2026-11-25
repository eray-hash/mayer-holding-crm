// Nachfrage nach Kundenterminen (22.11.2026) — vom Zeitplan jede Minute gerufen (Aktion termin_erinnerungen in
// index.ts), ohne offenes Browserfenster. Anlass: Im ganzen CRM gab es nur zwei Gesprächsprotokolle, obwohl die
// Mitarbeiter viele Kundentermine haben.
//
// - 10 bis 20 Minuten nach dem ENDE eines Termins, der mit genau einer Kundenakte verbunden ist (findeBezug aus
//   _shared/terminBriefingKern.ts; Objekte und Sammelakten zählen nicht), fragt der Assistent den Besitzer des
//   Termins einmal per Telegram: „Wie lief der Termin mit X? …“. Die Frage wird über telegram-gateway (intern
//   'rueckfrage', art 'mitteilung') in den Gesprächsverlauf des Assistenten gelegt — so versteht er die Antwort
//   (Sprachnachricht oder Text) im Zusammenhang und legt daraus das Gesprächsprotokoll an
//   (telegram-gateway/nachTerminWerkzeug.ts). Die Akte steht dabei im Feld „von“ der Systemmeldung.
// - Einstellung je Mitarbeiter: kalender_einstellungen.nachfrage_an (Standard an; keine Zeile = an). Fehlt die
//   Spalte (SQL nicht eingespielt), wird gar nichts gesendet.
// - Einmal je Termin: Vor dem Senden wird eine Zeile in termin_briefings angelegt (Schlüssel `nachfrage|<termin>`,
//   art 'nachfrage'). Wer sie nicht anlegen kann (schon da, Tabelle/Regel fehlt), sendet nicht. Klappt das Senden
//   nicht, wird es nicht wiederholt.
// - Übersprungen wird, wenn für die Akte heute schon ein Gesprächsprotokoll angelegt wurde, wenn der Besitzer die
//   Akte nicht sehen darf (darfBezug), wenn er nicht mit Telegram verbunden ist, und bei privaten Akten, wenn der
//   Besitzer den privaten Assistenten nutzt (der interne Weg schreibt nur in den Verlauf des Mayer-Bots — Privates
//   soll nicht dort landen).
// - Runde 5: Übersprungen (es wird gar nichts gesendet), wenn zum Termin schon eine Aufnahme aus der Gesprächs-App
//   vorliegt (gespraech_aufnahmen.termin_id, ohne verworfene) — das Protokoll entsteht dann aus der Aufnahme. Ist die
//   Tabelle nicht lesbar, wird wie bisher gefragt (Fehler im Ergebnis).
// - Wenig Lärm: je Mitarbeiter höchstens eine Nachfrage je Lauf (die nächste folgt frühestens im nächsten Takt)
//   und höchstens HOECHSTENS_JE_TAG am Tag.
// - Ohne KI. Wirft nie: Fehler stehen im Protokoll und im Ergebnis.

import {
  type BriefingPerson,
  type BriefingTermin,
  darfBezug,
  findeBezug,
  istAbgesagterTitel,
  istPrivaterBezug,
  kandidatenLader,
  TERMIN_SPALTEN,
  uhrzeit,
} from '../_shared/terminBriefingKern.ts'
import { privatBotAktiv } from '../_shared/telegramPrivat.ts'
import { istPrivaterTermin } from '../_shared/privatGrenze.ts'
import { berlinTagesbeginn, berlinZeit } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

/** Legt die Frage in den Verlauf des Assistenten und schickt sie. true = zugestellt. */
export type Frage = (mitarbeiterId: string, text: string, von: string) => Promise<boolean>

export type NachfrageOptionen = {
  jetzt?: Date
  frage: Frage
  /** Nutzt die Person den privaten Assistenten? (Standard: _shared/telegramPrivat.ts) */
  privatAktiv?: (email: string) => Promise<boolean>
}

export type NachfrageErgebnis = { gefragt: number; fehler: string[] }

/** Zeitfenster nach dem Ende des Termins (Minuten). */
export const NACH_AB = 10
export const NACH_BIS = 20
export const HOECHSTENS_JE_TAG = 4
const TABELLE = 'termin_briefings'

type Person = BriefingPerson & { id: string; name: string; chat: number | string | null }

function adresse(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

export function schluessel(terminId: string): string {
  return `nachfrage|${terminId}`
}

/** Ist die Nachfrage für dieses Terminende jetzt fällig? (10 bis 20 Minuten danach) */
export function istFaellig(ende: string, jetzt: Date): boolean {
  const minuten = (jetzt.getTime() - new Date(ende).getTime()) / 60000
  return minuten >= NACH_AB && minuten <= NACH_BIS
}

function deDatum(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso
}

/** Name der Akte für die Frage: Ansprechpartner, sonst Firma. */
export function akteName(k: { firma?: string | null; ansprechpartner?: string | null }): string {
  return String(k.ansprechpartner ?? '').trim() || String(k.firma ?? '').trim() || 'dem Kunden'
}

/** Der Text, den der Mitarbeiter bekommt. */
export function nachfrageText(name: string, t: Pick<BriefingTermin, 'titel' | 'beginn' | 'ende'>): string {
  const titel = String(t.titel ?? '').trim()
  const zeit = `${uhrzeit(t.beginn)}–${uhrzeit(t.ende)} Uhr`
  return `Wie lief der Termin mit ${name}${titel ? ` („${titel.slice(0, 80)}“, ${zeit})` : ` (${zeit})`}? Sprich mir kurz ein, was besprochen wurde und was als Nächstes passiert — ich lege das Protokoll an.`
}

/**
 * Feld „von“ der Systemmeldung im Verlauf des Assistenten (höchstens 80 Zeichen). Daran erkennt der Assistent
 * die Nachfrage und die Akte (siehe Absatz „Nachfrage nach Kundenterminen“ im Systemprompt).
 */
export function vonText(kundeId: string, datum: string): string {
  const voll = `Nachfrage nach Kundentermin (Akte ${kundeId}, ${deDatum(datum)})`
  return voll.length <= 80 ? voll : `Nachfrage nach Kundentermin (Akte ${kundeId})`.slice(0, 80)
}

/**
 * Standardweg für index.ts: telegram-gateway mit dem Dienst-Schlüssel, intern 'rueckfrage', art 'mitteilung'
 * (schickeMitteilung in telegram-gateway/teamWerkzeuge.ts schickt die Nachricht über den Mayer-Bot und legt sie
 * in den Gesprächsverlauf, damit der Assistent die Antwort versteht).
 */
export function frageUeberAssistent(supabaseUrl: string, dienstSchluessel: string, holen: typeof fetch = fetch): Frage {
  return async (mitarbeiterId, text, von) => {
    try {
      const antwort = await holen(`${supabaseUrl}/functions/v1/telegram-gateway`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${dienstSchluessel}` },
        body: JSON.stringify({ intern: 'rueckfrage', art: 'mitteilung', mitarbeiterId, text, von }),
      })
      if (!antwort.ok) console.error('Nachfrage nach Termin: telegram-gateway lehnt ab', antwort.status, await antwort.text().catch(() => ''))
      return antwort.ok
    } catch (err) {
      console.error('Nachfrage nach Termin: telegram-gateway nicht erreichbar', err)
      return false
    }
  }
}

/** Termine (aus `ids`), zu denen eine nicht verworfene Aufnahme der Gesprächs-App existiert. Wirft nie. */
export async function termineMitAufnahme(admin: Db, ids: string[], fehler: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  try {
    const { data, error } = await admin.from('gespraech_aufnahmen').select('termin_id').in('termin_id', ids).neq('status', 'verworfen')
    if (error) {
      fehler.push(`Aufnahmen nicht lesbar: ${error.message}`)
      return new Set()
    }
    return new Set(((data ?? []) as { termin_id: string | null }[]).map((z) => String(z.termin_id ?? '')).filter(Boolean))
  } catch (err) {
    fehler.push(`Aufnahmen nicht lesbar: ${err instanceof Error ? err.message : String(err)}`)
    return new Set()
  }
}

async function ladeEinstellungen(admin: Db, fehler: string[]): Promise<Map<string, boolean> | null> {
  const { data, error } = await admin.from('kalender_einstellungen').select('email, nachfrage_an')
  if (error) {
    fehler.push(`Einstellungen nicht lesbar: ${error.message}`)
    return null
  }
  const m = new Map<string, boolean>()
  for (const z of (data ?? []) as { email: string; nachfrage_an?: boolean | null }[]) m.set(adresse(z.email), z.nachfrage_an !== false)
  return m
}

async function ladeTeam(admin: Db): Promise<Map<string, Person>> {
  const { data, error } = await admin.from('mitarbeiter').select('id, name, email, rolle, ist_admin, bereiche, telegram_chat_id, aktiv').eq('aktiv', true)
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  const team = new Map<string, Person>()
  for (const m of (data ?? []) as { id: string; name: string; email: string; rolle?: string; ist_admin?: boolean; bereiche?: string[]; telegram_chat_id?: number | string | null }[]) {
    const email = adresse(m.email)
    if (!email || !m.id) continue
    team.set(email, { id: String(m.id), email, name: String(m.name ?? email), rolle: m.rolle ?? null, ist_admin: m.ist_admin === true, bereiche: Array.isArray(m.bereiche) ? m.bereiche : [], chat: m.telegram_chat_id ?? null })
  }
  return team
}

async function vermerkeZustellung(admin: Db, id: string, zugestellt: boolean): Promise<void> {
  const { error } = await admin.from(TABELLE).update({ zugestellt }).eq('id', id)
  if (error) console.error('Nachfrage nach Termin: Zustellung nicht vermerkt', id, error.message)
}

export async function frageNachTerminen(admin: Db, o: NachfrageOptionen): Promise<NachfrageErgebnis> {
  const ergebnis: NachfrageErgebnis = { gefragt: 0, fehler: [] }
  try {
    await lauf(admin, o, ergebnis)
  } catch (err) {
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  if (ergebnis.fehler.length > 0) console.error('Nachfrage nach Termin:', ergebnis.fehler.join(' | '))
  return ergebnis
}

async function lauf(admin: Db, o: NachfrageOptionen, ergebnis: NachfrageErgebnis): Promise<void> {
  const jetzt = o.jetzt ?? new Date()
  const ab = new Date(jetzt.getTime() - NACH_BIS * 60000).toISOString()
  const bis = new Date(jetzt.getTime() - NACH_AB * 60000).toISOString()
  const { data, error } = await admin.from('termine').select(TERMIN_SPALTEN).eq('ganztags', false).gte('ende', ab).lte('ende', bis).order('ende', { ascending: true }).limit(300)
  if (error) {
    ergebnis.fehler.push(`Termine nicht lesbar: ${error.message}`)
    return
  }
  let termine = ((data ?? []) as BriefingTermin[]).filter((t) => t.besitzer_email && !istAbgesagterTitel(String(t.titel ?? '')) && istFaellig(t.ende, jetzt))
  if (termine.length === 0) return

  const einst = await ladeEinstellungen(admin, ergebnis.fehler)
  if (!einst) return
  termine = termine.filter((t) => einst.get(adresse(t.besitzer_email)) !== false)
  if (termine.length === 0) return

  const team = await ladeTeam(admin)
  termine = termine.filter((t) => team.get(adresse(t.besitzer_email))?.chat)
  if (termine.length === 0) return

  // Schon gefragt? (eine Abfrage für alle)
  const { data: schon, error: schonFehler } = await admin.from(TABELLE).select('id').in('id', termine.map((t) => schluessel(t.id)))
  if (schonFehler) {
    ergebnis.fehler.push(`Vermerke nicht lesbar: ${schonFehler.message}`)
    return
  }
  const erledigt = new Set(((schon ?? []) as { id: string }[]).map((z) => z.id))
  termine = termine.filter((t) => !erledigt.has(schluessel(t.id)))
  if (termine.length === 0) return

  // Schon aufgenommen? Dann nicht fragen (eine Abfrage für alle).
  const mitAufnahme = await termineMitAufnahme(admin, termine.map((t) => t.id), ergebnis.fehler)
  termine = termine.filter((t) => !mitAufnahme.has(String(t.id)))
  if (termine.length === 0) return

  // Wie oft heute schon gefragt (je Besitzer)?
  const heute = berlinZeit(jetzt).datum
  const besitzer = [...new Set(termine.map((t) => adresse(t.besitzer_email)))]
  const { data: heuteGefragt, error: zaehlFehler } = await admin
    .from(TABELLE)
    .select('id, empfaenger')
    .eq('art', 'nachfrage')
    .in('empfaenger', besitzer)
    .gte('gesendet_am', berlinTagesbeginn(heute).toISOString())
  if (zaehlFehler) {
    ergebnis.fehler.push(`Vermerke nicht lesbar: ${zaehlFehler.message}`)
    return
  }
  const anzahl = new Map<string, number>()
  for (const z of (heuteGefragt ?? []) as { empfaenger: string }[]) anzahl.set(adresse(z.empfaenger), (anzahl.get(adresse(z.empfaenger)) ?? 0) + 1)

  const teamAdressen = new Set(team.keys())
  const teamNamen = [...team.values()].map((p) => p.name)
  const lader = kandidatenLader(admin)
  const privatMerker = new Map<string, boolean>()
  const dranInDiesemLauf = new Set<string>()

  for (const t of termine) {
    const email = adresse(t.besitzer_email)
    const p = team.get(email)!
    if (dranInDiesemLauf.has(email)) continue
    if ((anzahl.get(email) ?? 0) >= HOECHSTENS_JE_TAG) continue
    // Private Termine (_shared/privatGrenze.ts) fragt der Mayer-Bot nie nach — auch nicht, wenn ein Gast oder der Titel
    // zu einer Mayer-Akte passt (25.11.2026).
    if (!privatMerker.has(email)) {
      const pruefe = o.privatAktiv ?? ((e: string) => privatBotAktiv(admin, e))
      privatMerker.set(email, await pruefe(email).catch(() => true))
    }
    if (istPrivaterTermin(t, { besitzerPrivatAssistent: privatMerker.get(email) === true })) continue

    let bezug
    try {
      bezug = await findeBezug(admin, t, { team: teamAdressen, teamNamen, lader })
    } catch (err) {
      ergebnis.fehler.push(`Bezug zu Termin ${t.id} nicht ermittelbar: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    if (!bezug || bezug.art !== 'kunde' || !darfBezug(p, bezug)) continue

    if (istPrivaterBezug(bezug)) {
      if (!privatMerker.has(email)) {
        const pruefe = o.privatAktiv ?? ((e: string) => privatBotAktiv(admin, e))
        privatMerker.set(email, await pruefe(email).catch(() => true))
      }
      if (privatMerker.get(email)) continue
    }

    // Heute schon ein Gesprächsprotokoll zu dieser Akte? Dann nicht fragen.
    const { data: prot, error: protFehler } = await admin.from('protokolle').select('id').eq('kunde_id', bezug.id).eq('datum', heute).limit(1)
    if (protFehler) {
      ergebnis.fehler.push(`Protokolle zu ${bezug.id} nicht lesbar: ${protFehler.message}`)
      continue
    }
    if (Array.isArray(prot) && prot.length > 0) continue

    const { data: akte } = await admin.from('kunden').select('id, firma, ansprechpartner').eq('id', bezug.id).maybeSingle()
    if (!akte) continue

    // Erst beanspruchen, dann senden.
    const id = schluessel(t.id)
    const { error: anspruch } = await admin.from(TABELLE).insert({ id, termin_id: t.id, empfaenger: email, art: 'nachfrage', beginn: t.beginn, gesendet_am: jetzt.toISOString() })
    if (anspruch) {
      if (anspruch.code !== '23505') ergebnis.fehler.push(`Nachfrage nicht vermerkt (${anspruch.message}) — nicht gesendet.`)
      continue
    }
    dranInDiesemLauf.add(email)
    anzahl.set(email, (anzahl.get(email) ?? 0) + 1)

    const ok = await o.frage(p.id, nachfrageText(akteName(akte), t), vonText(bezug.id, heute)).catch(() => false)
    if (ok) ergebnis.gefragt++
    await vermerkeZustellung(admin, id, ok)
  }
}
