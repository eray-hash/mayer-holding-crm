// Erinnerungen zu To-dos (Spalte todos.erinnern_um, gesetzt im CRM oder vom Assistenten mit todo_anlegen /
// todo_aendern). Der Zeitplan ruft jede Minute sendeTodoErinnerungen.
//
// - Wer erinnert wird: Bei der eigenen Liste (bereich leer) ihr Besitzer (besitzer_email). Bei einer
//   Bereichsliste der Zuständige (Freitext wie „Andreas“ oder „Eray, Hasan“ → aktive Mitarbeiter); steht dort
//   niemand, der Mitarbeiter, der das To-do angelegt hat (besitzer_email). Nur wer mit Telegram verbunden ist.
// - Gesendet = erinnert_am wird gesetzt — VOR dem Versand (beansprucht, bedingt auf unveränderte Zeit). Scheitert der
//   Versand an alle, wird der Vermerk zurückgenommen (nächster Versuch in der nächsten Minute). Auch gesetzt, wenn der
//   Versand sicher nie klappen kann (niemand zuordenbar, kein Telegram) — sonst würde es jede Minute erneut versucht. Ändert jemand die
//   Erinnerungszeit, setzt die Datenbank erinnert_am selbst wieder auf leer.
// - Was länger als 2 Tage überfällig ist und nie ging (z. B. Zeitplan stand still), wird still abgehakt
//   statt Tage später noch verschickt.
// - Wiederholung (Spalte todos.erinnerung_wiederholung, 25.11.2026, Wunsch aus dem Wünsche-Tracking): 'taeglich',
//   'werktags' (Mo–Fr) oder 'woechentlich' — nach dem Versand rückt erinnern_um auf das nächste Vorkommen zur gleichen
//   Berliner Uhrzeit (die Datenbank leert erinnert_am dabei selbst), bis das To-do erledigt ist. Zu alt oder nicht
//   zustellbar: nicht abhaken, sondern auf das nächste künftige Vorkommen springen.
//   Solange supabase/sql/2026-11-25_todo_wiederholung.sql nicht ausgeführt ist, fehlt die Spalte: dann wird ohne sie
//   gelesen (alles einmalig wie bisher).
import { ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { sendeTelegram } from './kalender.ts'
import { privatBotAktiv, sendePrivat } from '../_shared/telegramPrivat.ts'
import { berlinTeile, naechsterZeitpunkt } from '../_shared/erinnerungKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

type TodoZeile = {
  id: string
  aufgabe: string
  bereich: string | null
  besitzer_email: string | null
  zustaendig: string | null
  kunde_projekt: string | null
  erledigen_bis: string | null
  erinnern_um: string
  erinnerung_wiederholung?: string | null
}

export type TodoWiederholung = 'taeglich' | 'werktags' | 'woechentlich'
export const TODO_WIEDERHOLUNG_TEXT: Record<TodoWiederholung, string> = { taeglich: 'täglich', werktags: 'werktags', woechentlich: 'wöchentlich' }

function istWiederholung(w: unknown): w is TodoWiederholung {
  return w === 'taeglich' || w === 'werktags' || w === 'woechentlich'
}

/**
 * Nächstes Vorkommen einer wiederkehrenden To-do-Erinnerung nach `nach`, zur gleichen Berliner Uhrzeit (auch über die
 * Zeitumstellung). werktags = nächster Montag bis Freitag. null = keine (gültige) Wiederholung.
 */
export function naechsteWiederholung(iso: string, wiederholung: string | null | undefined, nach = Date.now()): string | null {
  if (!istWiederholung(wiederholung) || !Number.isFinite(Date.parse(iso))) return null
  if (wiederholung === 'woechentlich') return naechsterZeitpunkt(iso, 'woechentlich', nach)
  let z = naechsterZeitpunkt(iso, 'taeglich', nach)
  if (wiederholung === 'werktags') {
    for (let i = 0; z && i < 7; i++) {
      const tag = berlinTeile(z).wochentag
      if (tag !== 0 && tag !== 6) break
      z = naechsterZeitpunkt(z, 'taeglich', Date.parse(z))
    }
  }
  return z
}

const SPALTEN = 'id, aufgabe, bereich, besitzer_email, zustaendig, kunde_projekt, erledigen_bis, erinnern_um'

type Person = { name: string; email: string | null; chat: number | string | null }

const HOECHSTENS_JE_LAUF = 50
const ZU_ALT_MS = 2 * 24 * 60 * 60 * 1000

const BEREICH_NAME: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
}

function deDatum(iso?: string | null): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/** Empfänger einer Erinnerung; leer = niemand erreichbar (Grund steht dabei). */
function empfaengerVon(t: TodoZeile, team: Person[]): { personen: Person[]; grund?: string } {
  const perEmail = (email: string | null) => team.filter((p) => p.email && email && p.email.toLowerCase() === email.toLowerCase())
  let kandidaten: Person[]
  if (!t.bereich) {
    kandidaten = perEmail(t.besitzer_email)
    if (kandidaten.length === 0) return { personen: [], grund: `Besitzer ${t.besitzer_email ?? '(leer)'} ist kein aktiver Mitarbeiter` }
  } else if (String(t.zustaendig ?? '').trim()) {
    const { personen } = ordneZu(t.zustaendig, personenNamen(team.map((p) => p.name)))
    kandidaten = team.filter((p) => personen.includes(p.name))
    if (kandidaten.length === 0) return { personen: [], grund: `Zuständig „${t.zustaendig}“ ist keinem aktiven Mitarbeiter zuzuordnen` }
  } else {
    kandidaten = perEmail(t.besitzer_email)
    if (kandidaten.length === 0) return { personen: [], grund: 'kein Zuständiger eingetragen und Ersteller nicht im Team' }
  }
  const erreichbar = kandidaten.filter((p) => p.chat)
  if (erreichbar.length === 0) return { personen: [], grund: `${kandidaten.map((p) => p.name).join(', ')} nicht mit Telegram verbunden` }
  return { personen: erreichbar.slice(0, 5) }
}

function nachricht(t: TodoZeile): string {
  const zeilen = [`⏰ Erinnerung: ${t.aufgabe}${t.erledigen_bis ? ` (fällig ${deDatum(t.erledigen_bis)})` : ''}`]
  if (istWiederholung(t.erinnerung_wiederholung)) zeilen[0] += ` (wiederholt sich ${TODO_WIEDERHOLUNG_TEXT[t.erinnerung_wiederholung]}, bis erledigt)`
  if (t.kunde_projekt) zeilen.push(`Kunde/Projekt: ${t.kunde_projekt}`)
  zeilen.push(t.bereich ? `To-do-Liste ${BEREICH_NAME[t.bereich] ?? t.bereich}${t.zustaendig ? `, zuständig ${t.zustaendig}` : ''}` : 'Deine eigene To-do-Liste')
  const kurz = t.aufgabe.length > 40 ? `${t.aufgabe.slice(0, 40)} …` : t.aufgabe
  zeilen.push(`Ist es erledigt, schreib mir einfach: „${kurz} ist erledigt“.`)
  return zeilen.join('\n')
}

/** Im privaten Assistenten heißt die eigene Liste „deine private To-do-Liste“. */
function privatText(text: string): string {
  return text.replace('Deine eigene To-do-Liste', 'Deine private To-do-Liste')
}

/**
 * Vermerkt die Erinnerung als erledigt (beansprucht sie) — nur, wenn die Zeit inzwischen nicht geändert wurde und
 * kein anderer Lauf schneller war. Gibt den gesetzten Zeitstempel zurück oder null (nicht gesetzt → nicht senden).
 * Vorher wurde erst gesendet und danach vermerkt: Scheiterte das Vermerken, kam dieselbe Erinnerung jede Minute.
 */
async function vermerke(admin: Db, t: TodoZeile): Promise<string | null> {
  const stempel = new Date().toISOString()
  const { data, error } = await admin.from('todos').update({ erinnert_am: stempel }).eq('id', t.id).eq('erinnern_um', t.erinnern_um).is('erinnert_am', null).select('id')
  if (error) {
    console.error('To-do-Erinnerung: erinnert_am nicht gesetzt', t.id, error.message)
    return null
  }
  return Array.isArray(data) && data.length > 0 ? stempel : null
}

/** Nimmt einen Vermerk zurück, wenn der Versand an alle scheiterte (nächster Versuch im nächsten Lauf). */
async function nimmZurueck(admin: Db, t: TodoZeile, stempel: string): Promise<void> {
  const { error } = await admin.from('todos').update({ erinnert_am: null }).eq('id', t.id).eq('erinnert_am', stempel)
  if (error) console.error('To-do-Erinnerung: Vermerk nicht zurückgenommen (Erinnerung geht verloren)', t.id, error.message)
}

/**
 * Wiederkehrend: auf das nächste künftige Vorkommen rücken (erinnert_am leert die Datenbank beim Ändern von
 * erinnern_um selbst; hier zusätzlich gesetzt, falls der Auslöser fehlt). Nur solange offen und — nach einem Versand —
 * nur, wenn noch unser Vermerk drinsteht; ohne Versand nur, wenn noch nicht beansprucht.
 */
async function rueckeWeiter(admin: Db, t: TodoZeile, jetzt: number, stempel: string | null): Promise<boolean> {
  const naechster = naechsteWiederholung(t.erinnern_um, t.erinnerung_wiederholung, jetzt)
  if (!naechster) return false
  let q = admin.from('todos').update({ erinnern_um: naechster, erinnert_am: null }).eq('id', t.id).eq('erinnern_um', t.erinnern_um).is('erledigt_am', null)
  q = stempel ? q.eq('erinnert_am', stempel) : q.is('erinnert_am', null)
  const { error } = await q
  if (error) {
    console.error('To-do-Erinnerung: Wiederholung nicht weitergerückt', t.id, error.message)
    return false
  }
  return true
}

export type TodoVersand = {
  /** Nur für Tests: feste Uhrzeit. */
  jetzt?: () => number
  sende?: (chat: number | string | null, text: string) => Promise<boolean>
  sendePrivat?: (chat: number | string | null, text: string) => Promise<boolean>
  hatPrivatBot?: (email: string) => Promise<boolean>
}

export async function sendeTodoErinnerungen(admin: Db, versand: TodoVersand = {}): Promise<{ gesendet: number }> {
  const sende = versand.sende ?? ((chat: number | string | null, text: string) => sendeTelegram(chat, text, 'todo_erinnerung'))
  const sendeP = versand.sendePrivat ?? (async (chat: number | string | null, text: string) => !!(await sendePrivat(chat, text)))
  const jetzt = versand.jetzt ? versand.jetzt() : Date.now()
  const lies = (spalten: string) =>
    admin
      .from('todos')
      .select(spalten)
      .is('erledigt_am', null)
      .is('erinnert_am', null)
      .not('erinnern_um', 'is', null)
      .lte('erinnern_um', new Date(jetzt).toISOString())
      .order('erinnern_um', { ascending: true })
      .limit(HOECHSTENS_JE_LAUF)
  let { data, error } = await lies(`${SPALTEN}, erinnerung_wiederholung`)
  // Spalte noch nicht angelegt (SQL vom 25.11.2026 nicht ausgeführt): wie bisher ohne Wiederholung.
  if (error && /erinnerung_wiederholung/.test(String(error.message))) ({ data, error } = await lies(SPALTEN))
  if (error) {
    console.error('To-do-Erinnerungen: Abfrage fehlgeschlagen', error.message)
    return { gesendet: 0 }
  }
  const faellige = (data ?? []) as TodoZeile[]
  if (faellige.length === 0) return { gesendet: 0 }

  const { data: ma } = await admin.from('mitarbeiter').select('name, email, telegram_chat_id').eq('aktiv', true)
  const team: Person[] = ((ma ?? []) as { name: string | null; email: string | null; telegram_chat_id: number | string | null }[])
    .filter((m) => m.name)
    .map((m) => ({ name: String(m.name), email: m.email, chat: m.telegram_chat_id }))

  // Eigene Liste (bereich leer) einer Person mit privatem Assistenten = privat: nur über den privaten Bot,
  // nie über den Mayer-Bot (Erays Regel vom 21.11.2026). Klappt der Versand nicht, nächster Versuch beim nächsten Lauf.
  const privatAktiv = new Map<string, boolean>()
  const hatPrivatBot = async (email: string | null) => {
    const e = String(email ?? '').toLowerCase()
    if (!e) return false
    if (!privatAktiv.has(e)) privatAktiv.set(e, await (versand.hatPrivatBot ? versand.hatPrivatBot(e) : privatBotAktiv(admin, e)).catch(() => false))
    return privatAktiv.get(e)!
  }
  let gesendet = 0
  for (const t of faellige) {
    if (jetzt - new Date(t.erinnern_um).getTime() > ZU_ALT_MS) {
      // Wiederkehrend: nicht für immer abhaken, sondern beim nächsten Vorkommen wieder erinnern.
      if (istWiederholung(t.erinnerung_wiederholung) && (await rueckeWeiter(admin, t, jetzt, null))) continue
      console.warn('To-do-Erinnerung über 2 Tage alt, ohne Versand abgehakt:', t.id, t.erinnern_um)
      await vermerke(admin, t)
      continue
    }
    const { personen, grund } = empfaengerVon(t, team)
    if (personen.length === 0) {
      // Wiederkehrend: morgen (bzw. beim nächsten Vorkommen) erneut versuchen — vielleicht ist Telegram dann verbunden.
      if (istWiederholung(t.erinnerung_wiederholung) && (await rueckeWeiter(admin, t, jetzt, null))) {
        console.warn('To-do-Erinnerung nicht zustellbar, nächstes Vorkommen:', t.id, grund)
        continue
      }
      console.warn('To-do-Erinnerung nicht zustellbar, abgehakt:', t.id, grund)
      await vermerke(admin, t)
      continue
    }
    const text = nachricht(t)
    // Erst beanspruchen, dann senden: ohne gespeicherten Vermerk keine Nachricht (nie doppelt, auch bei zwei Läufen).
    const stempel = await vermerke(admin, t)
    if (!stempel) continue
    let einer = false
    for (const p of personen) {
      const privat = !t.bereich && (await hatPrivatBot(p.email))
      if (privat ? await sendeP(p.chat, privatText(text)).catch(() => false) : await sende(p.chat, text).catch(() => false)) {
        einer = true
        gesendet++
      }
    }
    // Klappt bei keinem der Versand (Telegram gestört), wird der Vermerk zurückgenommen und in der nächsten Minute erneut versucht.
    if (!einer) {
      console.error('To-do-Erinnerung: Telegram-Versand fehlgeschlagen, nächster Versuch beim nächsten Lauf', t.id)
      await nimmZurueck(admin, t, stempel)
      continue
    }
    if (istWiederholung(t.erinnerung_wiederholung)) await rueckeWeiter(admin, t, jetzt, stempel)
  }
  console.log(`To-do-Erinnerungen: ${gesendet} gesendet, ${faellige.length} fällig`)
  return { gesendet }
}
