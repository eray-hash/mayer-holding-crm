// Abend-Rückblick im Mayer-Bot für alle Mitarbeiter (23.11.2026) — vom Minutentakt (Aktion termin_erinnerungen) gerufen,
// ohne KI und ohne offenes Browserfenster. Vorbild: der Abend-Rückblick des privaten Bots (privatTagesplan.ts, 21:30).
//
// - Werktags (Mo–Fr) beim ersten Takt ab der eingestellten Uhrzeit (assistent_hinweis_einstellung.abend_rueckblick_uhrzeit,
//   Vorgabe 17:30) bis 90 Minuten danach; ein verpasster Abend wird nicht nachgeholt. Über den MAYER-Bot.
// - Inhalt, kurz: „Heute erledigt: N“, dann die heute fälligen und überfälligen OFFENEN Aufgaben der Person (höchstens 5,
//   je zwei Knöpfe „✓ Erledigt“ = ar:e:<todo_id> und „→ Morgen“ = ar:m:<todo_id>, dazu „… und N weitere“), dann eine
//   Zeile für den nächsten Werktag (Termine + fällige Wiedervorlagen). Ohne offene und ohne erledigte Aufgabe: nichts.
// - Welche Aufgaben: dieselben wie in der Morgen-Übersicht des Mayer-Bots (tagesmeldung.ts aufgabenZeilen 'mayer'):
//   Bereichslisten, wo die Person zuständig ist, und die eigene Liste. Privat bleibt privat: nie Microsoft To Do
//   (todos.ms_id, damit auch keine ausgeblendeten Listen); nutzt die Person den privaten Assistenten, gilt ihre eigene
//   Liste als privat und fehlt hier ganz (die kommt abends über den privaten Bot). Termine aus Microsoft und Termine
//   mit privater Akte fehlen ebenso, Wiedervorlagen nur aus Mayer-Akten und Mayer-Objekten.
// - Kein doppelter Abend: Wer den Tagesablauf-Abend „Offen geblieben“ eingeschaltet hat (tagesplan_einstellungen.abend_an,
//   z. B. Quirin, tagesplanMeldungen.ts), bekommt diesen Rückblick nicht.
// - Schalter assistent_hinweis_einstellung.abend_rueckblick: 'aus' | 'superuser' (Vorgabe: Probelauf — nur Superuser
//   bekommen ihren eigenen Rückblick und dazu in einer zweiten Nachricht, was an die Kollegen „ginge an …“, dort ohne
//   Knöpfe) | 'alle'. Erays Regel: neue automatische Nachrichten an Kollegen erst nach Freigabe der Texte. Schalter nicht
//   lesbar → nichts. Je Mitarbeiter abschaltbar (assistent_hinweise.abend_rueckblick, Assistent „Abend-Rückblick aus“).
// - Höchstens einmal je Person und Tag: Stempel assistent_hinweise.abend_rueckblick_tag (assistentHinweise.ts beanspruche).
//   Erst lesen, dann beanspruchen, dann senden; klappt das Senden nicht, wird es nicht wiederholt.
// - Knöpfe: fuehreAbendKnopfAus (telegram-gateway verarbeiteKnopf, nur im Mayer-Bot) — nur Aufgaben, die der Person
//   gehören bzw. für die sie zuständig ist; danach ersetzt nachrichtNachKlick die Zeile („✓ erledigt“) und nimmt die Knöpfe weg.
// - Trockenlauf ohne Senden und ohne Schreiben: abendRueckblickTrockenlauf (Aktion abend_rueckblick_test).
// - Wirft nie: Fehler stehen im Ergebnis.

import { istPrivaterTermin } from '../_shared/privatGrenze.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { istAbgesagterTitel } from '../_shared/terminBriefingKern.ts'
import { privatBotAktiv } from '../_shared/telegramPrivat.ts'
import { beanspruche, EINSTELLUNG_TABELLE, ladeEinstellungen, type Modus, offeneEmpfaenger, type Person as HinweisPerson, type PersonEinstellung } from './assistentHinweise.ts'
import { type TelegramApi, telegramMayerBot } from './bitteBestaetigen.ts'
import { aufgabenZeile, type FaelligeAufgabe, faelligkeit, type PlanTodo, sortiereFaellige } from './privatTagesplan.ts'
import { alsDatum, berlinTagesbeginn, berlinZeit, gehoertZu, plusTage } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const ART = 'abend_rueckblick'
export const VORGABE_UHRZEIT = '17:30'
/** So lange nach der Uhrzeit darf der Rückblick noch kommen. */
export const FENSTER_MINUTEN = 90
export const HOECHSTENS_AUFGABEN = 5
const HOECHSTENS_TERMINE_GENANNT = 2
/** Telegram erlaubt 4096 Zeichen je Nachricht — der Probelauf wird darunter aufgeteilt. */
const NACHRICHT_HOECHSTENS = 3800
const EINSTELLUNG_CACHE_MS = 10 * 60_000
export const KNOPF_PRAEFIX = 'ar:'
const KNOPF_MUSTER = /^ar:([em]):([A-Za-z0-9_-]{1,59})$/
const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const TODO_SPALTEN = 'id, aufgabe, prio, erledigen_bis, geplante_wiedervorlage, erledigt_am, kunde_projekt, besitzer_email, bereich, zustaendig, ms_id, ms_liste_id'

// ---------------------------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------------------------

function text(w: unknown): string {
  return typeof w === 'string' ? w : w == null ? '' : String(w)
}

function kurz(wert: string, laenge: number): string {
  const sauber = wert.replace(/\s+/g, ' ').trim()
  return sauber.length <= laenge ? sauber : `${sauber.slice(0, laenge - 1).trimEnd()}…`
}

function tagMonat(datum: string): string {
  return `${datum.slice(8, 10)}.${datum.slice(5, 7)}.`
}

function wochentagVon(datum: string): number {
  const [y, m, d] = datum.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Der nächste Werktag nach `datum` (Freitag/Samstag/Sonntag → Montag; Feiertage zählen nicht). */
export function naechsterWerktag(datum: string): string {
  let t = plusTage(datum, 1)
  while (wochentagVon(t) === 0 || wochentagVon(t) === 6) t = plusTage(t, 1)
  return t
}

/** „Morgen“ oder der Wochentag (z. B. „Montag“ am Freitag). */
export function naechsterTagName(heute: string): string {
  const n = naechsterWerktag(heute)
  return n === plusTage(heute, 1) ? 'Morgen' : WOCHENTAG[wochentagVon(n)]
}

// ---------------------------------------------------------------------------------------------
// Einstellung und Zeitfenster
// ---------------------------------------------------------------------------------------------

export type AbendEinstellung = { modus: Modus; uhrzeit: string }

/** „17:30“ → Minuten; Unlesbares → Vorgabe. Nur zwischen 12:00 und 22:00 (Abend, nicht nachts). */
export function uhrzeitMinuten(uhrzeit: unknown): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text(uhrzeit).trim())
  const vorgabe = 17 * 60 + 30
  if (!m) return vorgabe
  const min = Number(m[1]) * 60 + Number(m[2])
  return Number(m[1]) < 24 && Number(m[2]) < 60 && min >= 12 * 60 && min <= 22 * 60 ? min : vorgabe
}

/** Schalter und Uhrzeit lesen. Fehler oder fehlende Zeile → 'aus' (lieber nichts senden). */
export async function ladeAbendEinstellung(admin: Db): Promise<AbendEinstellung> {
  try {
    const { data, error } = await admin.from(EINSTELLUNG_TABELLE).select('abend_rueckblick, abend_rueckblick_uhrzeit').eq('id', 1).maybeSingle()
    if (error || !data) return { modus: 'aus', uhrzeit: VORGABE_UHRZEIT }
    const w = text(data.abend_rueckblick).trim()
    const min = uhrzeitMinuten(data.abend_rueckblick_uhrzeit)
    return { modus: w === 'superuser' || w === 'alle' ? w : 'aus', uhrzeit: `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}` }
  } catch {
    return { modus: 'aus', uhrzeit: VORGABE_UHRZEIT }
  }
}

/** Werktag und zwischen Uhrzeit und Uhrzeit + 90 Minuten (Berliner Zeit)? */
export function imAbendFenster(jetzt: Date, uhrzeit: string = VORGABE_UHRZEIT): boolean {
  const b = berlinZeit(jetzt)
  if (b.wochentag < 1 || b.wochentag > 5) return false
  const min = b.stunde * 60 + b.minute
  const ab = uhrzeitMinuten(uhrzeit)
  return min >= ab && min < ab + FENSTER_MINUTEN
}

/** Kann überhaupt ein Fenster offen sein (Werktag, 12:00 bis 23:30)? Ohne Datenbank — davor wird nichts gelesen. */
function vielleichtFenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  const min = b.stunde * 60 + b.minute
  return b.wochentag >= 1 && b.wochentag <= 5 && min >= 12 * 60 && min < 22 * 60 + FENSTER_MINUTEN
}

// Je Datenbank-Zugang zwischengespeichert: im Minutentakt nicht jede Minute lesen.
const einstellungCache = new WeakMap<object, { bis: number; wert: AbendEinstellung }>()

async function einstellungGemerkt(admin: Db): Promise<AbendEinstellung> {
  const c = admin && typeof admin === 'object' ? einstellungCache.get(admin) : undefined
  if (c && c.bis > Date.now()) return c.wert
  const wert = await ladeAbendEinstellung(admin)
  if (admin && typeof admin === 'object') einstellungCache.set(admin, { bis: Date.now() + EINSTELLUNG_CACHE_MS, wert })
  return wert
}

// ---------------------------------------------------------------------------------------------
// Personen und welche Aufgaben ihnen gehören
// ---------------------------------------------------------------------------------------------

/** Für Rechte und Zuordnung: wie Person in tagesmeldung.ts (gf = Geschäftsführung oder Admin). */
export type RueckblickPerson = { email: string; name: string; gf: boolean; bereiche: string[] }

export type RueckblickTodo = PlanTodo & { zustaendig?: string | null }

/** Dieselbe Regel wie darfBereich in tagesmeldung.ts (und darf_bereich in der Datenbank). */
function darfBereich(p: RueckblickPerson, bereich: string | null | undefined): boolean {
  if (!bereich || bereich === 'intern') return true
  if (p.gf) return true
  return p.bereiche.includes(bereich === 'immobilienkunden' ? 'immobilien' : bereich)
}

/**
 * Gehört die Aufgabe in den Mayer-Rückblick dieser Person? Wie tagesmeldung.ts aufgabenZeilen 'mayer' bzw. 'nur_bereiche':
 * Bereichsliste nur, wo die Person zuständig ist und den Bereich sehen darf; eigene Liste nur, wenn `eigeneListe` (also
 * ohne privaten Assistenten) und niemand anderes ausdrücklich zuständig ist. Microsoft To Do nie.
 */
export function istMayerAufgabe(p: RueckblickPerson, t: RueckblickTodo, eigeneListe: boolean): boolean {
  if (text(t.ms_id).trim()) return false
  const zustaendig = text(t.zustaendig).trim()
  const bereich = text(t.bereich).trim()
  if (bereich) return bereich !== 'privat' && darfBereich(p, bereich) && gehoertZu(zustaendig, p.name)
  if (!eigeneListe) return false
  return text(t.besitzer_email).trim().toLowerCase() === p.email && (!zustaendig || gehoertZu(zustaendig, p.name))
}

type TerminZeile = { id: string; titel?: string | null; beginn?: string | null; ende?: string | null; ganztags?: boolean | null; besitzer_email?: string | null; teilnehmer?: unknown; kunde_id?: string | null; kunde_bereich?: string | null; ms_id?: string | null }
type WvZeile = { id: string; bereich?: string | null; faellig?: string | null; verantwortlich?: string | null }
type FolgeZeile = { id: string; bereich?: string | null; verantwortlich?: string | null; follow_up?: { date?: unknown; done?: unknown } | null; privat_besitzer?: string | null }

/** Was einmal je Lauf für alle gelesen wird. */
export type GemeinsameDaten = {
  /** Offene To-dos mit Frist oder Wiedervorlage bis heute, ohne Microsoft To Do. */
  offen: RueckblickTodo[]
  /** Heute erledigte To-dos ohne Microsoft To Do. */
  erledigt: RueckblickTodo[]
  /** Termine, die den nächsten Werktag berühren. */
  termine: TerminZeile[]
  /** Offene Einträge der Tabelle wiedervorlagen bis zum nächsten Werktag. */
  wiedervorlagen: WvZeile[]
  kunden: FolgeZeile[]
  objekte: FolgeZeile[]
}

/** Liest alles für den Lauf. Wirft bei einem Lesefehler (dann versucht es der nächste Takt). */
export async function ladeGemeinsameDaten(admin: Db, heute: string): Promise<GemeinsameDaten> {
  const naechster = naechsterWerktag(heute)
  const von = berlinTagesbeginn(naechster).toISOString()
  const bis = berlinTagesbeginn(plusTage(naechster, 1)).toISOString()
  const pruefe = <T>(r: { data: T[]; error: { message: string } | null }, was: string): T[] => {
    if (r.error) throw new Error(`${was}: ${r.error.message}`)
    return r.data
  }
  const [offen, erledigt, termine, wv, kunden, objekte] = await Promise.all([
    alleZeilen<RueckblickTodo>(() => admin.from('todos').select(TODO_SPALTEN).is('erledigt_am', null).is('ms_id', null).or(`erledigen_bis.lte.${heute},geplante_wiedervorlage.lte.${heute}`)),
    alleZeilen<RueckblickTodo>(() => admin.from('todos').select(TODO_SPALTEN).eq('erledigt_am', heute).is('ms_id', null)),
    alleZeilen<TerminZeile>(() => admin.from('termine').select('id, titel, beginn, ende, ganztags, besitzer_email, teilnehmer, kunde_id, kunde_bereich, ms_id').lt('beginn', bis).gt('ende', von)),
    alleZeilen<WvZeile>(() => admin.from('wiedervorlagen').select('id, bereich, faellig, verantwortlich').is('erledigt_am', null).lte('faellig', naechster)),
    alleZeilen<FolgeZeile>(() => admin.from('kunden').select('id, bereich, verantwortlich, follow_up')),
    alleZeilen<FolgeZeile>(() => admin.from('objekte').select('id, verantwortlich, follow_up, privat_besitzer')),
  ])
  return {
    offen: pruefe(offen, 'To-dos'),
    erledigt: pruefe(erledigt, 'Erledigte To-dos'),
    termine: pruefe(termine, 'Termine'),
    // Die Wiedervorlagen sind nur ein Zusatz — fehlt die Tabelle, kommt der Rückblick trotzdem.
    wiedervorlagen: wv.error ? [] : wv.data,
    kunden: pruefe(kunden, 'Kunden'),
    objekte: pruefe(objekte, 'Objekte'),
  }
}

export type PersonRueckblick = {
  offen: FaelligeAufgabe[]
  heuteErledigt: number
  /** Termine am nächsten Werktag, nach Beginn. */
  termine: TerminZeile[]
  wiedervorlagen: number
}

function folgeFaellig(f: FolgeZeile['follow_up'], bis: string): boolean {
  if (!f || f.done === true) return false
  const tag = alsDatum(f.date)
  return !!tag && tag <= bis
}

/** Was die Person betrifft. Rechnet nur. */
export function rueckblickFuer(p: RueckblickPerson, d: GemeinsameDaten, heute: string, eigeneListe: boolean): PersonRueckblick {
  const naechster = naechsterWerktag(heute)
  const offen = sortiereFaellige(
    d.offen.filter((t) => istMayerAufgabe(p, t, eigeneListe)).map((t) => faelligkeit(t, heute, heute)).filter((f): f is FaelligeAufgabe => !!f),
  )
  const heuteErledigt = d.erledigt.filter((t) => istMayerAufgabe(p, t, eigeneListe)).length

  const von = berlinTagesbeginn(naechster).getTime()
  const bis = berlinTagesbeginn(plusTage(naechster, 1)).getTime()
  const termine = d.termine
    .filter((t) => {
      // Outlook-Termine und private Akten nie (strenger als die zentrale Regel); dazu private Termine nach
      // _shared/privatGrenze.ts (z. B. eigene CRM-Termine ohne Kollegen und Akte bei Nutzern des privaten Assistenten).
      if (text(t.ms_id).trim() || text(t.kunde_bereich).trim() === 'privat' || istAbgesagterTitel(text(t.titel))) return false
      if (istPrivaterTermin(t, { besitzerPrivatAssistent: !eigeneListe })) return false
      const teilnehmer = Array.isArray(t.teilnehmer) ? t.teilnehmer.map((x) => text(x).trim().toLowerCase()) : []
      if (text(t.besitzer_email).trim().toLowerCase() !== p.email && !teilnehmer.includes(p.email)) return false
      const b = Date.parse(text(t.beginn))
      const e = Date.parse(text(t.ende) || text(t.beginn))
      return Number.isFinite(b) && b < bis && (e > von || (e === b && b >= von))
    })
    .sort((a, b) => Number(b.ganztags === true) - Number(a.ganztags === true) || text(a.beginn).localeCompare(text(b.beginn)))

  let wiedervorlagen = 0
  for (const w of d.wiedervorlagen) {
    const tag = alsDatum(w.faellig)
    if (tag && tag <= naechster && text(w.bereich) !== 'privat' && darfBereich(p, w.bereich) && gehoertZu(w.verantwortlich, p.name)) wiedervorlagen++
  }
  for (const k of d.kunden) {
    if (text(k.bereich) === 'privat' || !darfBereich(p, k.bereich) || !gehoertZu(k.verantwortlich, p.name)) continue
    if (folgeFaellig(k.follow_up, naechster)) wiedervorlagen++
  }
  if (darfBereich(p, 'immobilien')) {
    for (const o of d.objekte) {
      if (text(o.privat_besitzer).trim() || !gehoertZu(o.verantwortlich, p.name)) continue
      if (folgeFaellig(o.follow_up, naechster)) wiedervorlagen++
    }
  }
  return { offen, heuteErledigt, termine, wiedervorlagen }
}

// ---------------------------------------------------------------------------------------------
// Nachricht
// ---------------------------------------------------------------------------------------------

export type Knopf = { text: string; callback_data: string }
export type RueckblickNachricht = { text: string; knoepfe: Knopf[][] }

function terminKurz(t: TerminZeile): string {
  const wann = t.ganztags === true ? 'ganztags' : UHR.format(new Date(text(t.beginn)))
  return `${wann} ${kurz(text(t.titel) || 'Termin', 30)}`
}

/** Die Zeile für den nächsten Werktag, z. B. „Morgen: 2 Termine (09:00 Notar, 14:00 Besichtigung) · 3 Wiedervorlagen fällig“. */
export function naechsterTagZeile(a: Pick<PersonRueckblick, 'termine' | 'wiedervorlagen'>, heute: string): string {
  const name = naechsterTagName(heute)
  const n = a.termine.length
  const genannt = a.termine.slice(0, HOECHSTENS_TERMINE_GENANNT).map(terminKurz).join(', ')
  const teile: string[] = []
  if (n) teile.push(`${n === 1 ? '1 Termin' : `${n} Termine`} (${genannt}${n > HOECHSTENS_TERMINE_GENANNT ? ' …' : ''})`)
  if (a.wiedervorlagen) teile.push(`${a.wiedervorlagen} ${a.wiedervorlagen === 1 ? 'Wiedervorlage' : 'Wiedervorlagen'} fällig`)
  return `${name}: ${teile.length ? teile.join(' · ') : 'keine Termine, keine Wiedervorlagen'}`
}

/**
 * Der Rückblick einer Person. `mitKnoepfen` = false für den Probelauf (Knöpfe auf fremde Aufgaben gingen ohnehin nicht).
 * null, wenn heute nichts erledigt wurde und nichts offen ist. Rechnet nur.
 */
export function rueckblickNachricht(a: PersonRueckblick, heute: string, mitKnoepfen = true): RueckblickNachricht | null {
  if (!a.offen.length && !a.heuteErledigt) return null
  const wt = wochentagVon(heute)
  const morgenKnopf = naechsterTagName(heute)
  const zeilen = [`🌙 Rückblick ${WOCHENTAG[wt]}, ${tagMonat(heute)}`, `✓ Heute erledigt: ${a.heuteErledigt}`]
  const knoepfe: Knopf[][] = []
  if (a.offen.length) {
    zeilen.push(`Noch offen (${a.offen.length}):`)
    a.offen.slice(0, HOECHSTENS_AUFGABEN).forEach((f, i) => {
      zeilen.push(`${i + 1}. ${aufgabenZeile(f, heute)}`)
      const e = `${KNOPF_PRAEFIX}e:${f.todo.id}`
      const m = `${KNOPF_PRAEFIX}m:${f.todo.id}`
      // Telegram erlaubt höchstens 64 Bytes je Knopf — sonst ohne Knopf (kommt bei den heutigen Kennungen nicht vor).
      if (mitKnoepfen && new TextEncoder().encode(e).length <= 64) {
        knoepfe.push([{ text: `✓ Erledigt (${i + 1})`, callback_data: e }, { text: `→ ${morgenKnopf} (${i + 1})`, callback_data: m }])
      }
    })
    if (a.offen.length > HOECHSTENS_AUFGABEN) zeilen.push(`… und ${a.offen.length - HOECHSTENS_AUFGABEN} weitere`)
  } else zeilen.push('Nichts mehr offen.')
  zeilen.push(naechsterTagZeile(a, heute))
  return { text: zeilen.join('\n'), knoepfe }
}

/** Probelauf: was an die Kollegen ginge, in Nachrichten unter der Telegram-Grenze. */
export function probeNachrichten(jePerson: { name: string; text: string }[], ausgelassen: string[] = []): string[] {
  const kopf = 'Probelauf Abend-Rückblick (geht noch an niemanden sonst). So käme er bei den Kollegen an:'
  const bloecke = jePerson.map((p) => `— ginge an ${p.name}:\n${p.text}`)
  if (ausgelassen.length) bloecke.push(`Ohne Rückblick: ${ausgelassen.join('; ')}.`)
  if (!jePerson.length) bloecke.push('Heute ginge an niemanden sonst etwas.')
  const teile: string[] = []
  let aktuell = kopf
  for (const b of bloecke) {
    if (`${aktuell}\n\n${b}`.length > NACHRICHT_HOECHSTENS) {
      teile.push(aktuell)
      aktuell = `Probelauf Abend-Rückblick (Fortsetzung):\n\n${b}`.slice(0, NACHRICHT_HOECHSTENS)
    } else aktuell = `${aktuell}\n\n${b}`
  }
  teile.push(aktuell)
  return teile
}

// ---------------------------------------------------------------------------------------------
// Der Lauf
// ---------------------------------------------------------------------------------------------

type TeamMensch = HinweisPerson & { gf: boolean }

async function ladeAlleAktiven(admin: Db): Promise<(Omit<TeamMensch, 'chat'> & { chat: number | string | null })[]> {
  const { data, error } = await admin.from('mitarbeiter').select('id, name, email, rolle, ist_admin, ist_superuser, bereiche, aktiv, telegram_chat_id').eq('aktiv', true)
  if (error) throw new Error(`mitarbeiter: ${error.message}`)
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[])
    .filter((m) => text(m.email).trim())
    .map((m) => ({
      id: text(m.id).trim(),
      name: text(m.name).trim(),
      email: text(m.email).trim().toLowerCase(),
      rolle: m.rolle ?? null,
      ist_admin: m.ist_admin === true,
      ist_superuser: m.ist_superuser === true,
      bereiche: Array.isArray(m.bereiche) ? m.bereiche.map(text) : [],
      gf: m.rolle === 'geschaeftsfuehrung' || m.ist_admin === true,
      chat: m.telegram_chat_id === null || m.telegram_chat_id === undefined || m.telegram_chat_id === '' ? null : m.telegram_chat_id,
    }))
}

/** Wer hat den Tagesablauf-Abend „Offen geblieben“ an? Wirft bei Lesefehler (dann lieber nicht senden als doppelt). */
async function ladeTagesplanAbend(admin: Db): Promise<Set<string>> {
  const { data, error } = await admin.from('tagesplan_einstellungen').select('email').eq('abend_an', true)
  if (error) throw new Error(`tagesplan_einstellungen: ${error.message}`)
  return new Set(((data ?? []) as { email?: string | null }[]).map((z) => text(z.email).trim().toLowerCase()).filter(Boolean))
}

export type PersonStand = 'wuerde_senden' | 'nichts_offen' | 'abgeschaltet' | 'tagesplan_abend' | 'ohne_telegram' | 'schon_gesendet'

export type AbendErgebnis = {
  gelaufen: boolean
  gesendet: number
  fehler: string[]
}

export type AbendOptionen = {
  jetzt?: Date
  /** Senden über den Mayer-Bot (Vorgabe telegramMayerBot); in Tests einsetzbar. */
  telegram?: TelegramApi
  /** Nutzt die Person den privaten Assistenten? Vorgabe privatBotAktiv. */
  privatAktiv?: (email: string) => Promise<boolean>
  /** Nur für Tests: Einstellung statt aus der Datenbank. */
  einstellung?: AbendEinstellung
}

type Bewertet = { person: TeamMensch | (Omit<TeamMensch, 'chat'> & { chat: number | string | null }); stand: PersonStand; nachricht: RueckblickNachricht | null; probeNachricht: RueckblickNachricht | null }

/** Bewertet alle Personen für heute (ohne zu schreiben). */
async function bewerte(
  admin: Db,
  team: Awaited<ReturnType<typeof ladeAlleAktiven>>,
  einst: Map<string, PersonEinstellung>,
  tagesplanAbend: Set<string>,
  heute: string,
  privatAktiv: (email: string) => Promise<boolean>,
  daten: GemeinsameDaten,
): Promise<Bewertet[]> {
  const aus: Bewertet[] = []
  for (const p of team) {
    const e = einst.get(p.email)
    let stand: PersonStand = 'wuerde_senden'
    if (!p.chat) stand = 'ohne_telegram'
    else if (e && !e.an) stand = 'abgeschaltet'
    else if (tagesplanAbend.has(p.email)) stand = 'tagesplan_abend'
    else if (e && e.stempel >= heute) stand = 'schon_gesendet'
    let nachricht: RueckblickNachricht | null = null
    let probeNachricht: RueckblickNachricht | null = null
    if (stand === 'wuerde_senden' || stand === 'schon_gesendet') {
      const eigeneListe = !(await privatAktiv(p.email).catch(() => false))
      const a = rueckblickFuer(p, daten, heute, eigeneListe)
      nachricht = rueckblickNachricht(a, heute, true)
      probeNachricht = rueckblickNachricht(a, heute, false)
      if (!nachricht && stand === 'wuerde_senden') stand = 'nichts_offen'
    }
    aus.push({ person: p, stand, nachricht, probeNachricht })
  }
  return aus
}

const STAND_TEXT: Partial<Record<PersonStand, string>> = {
  abgeschaltet: 'abgeschaltet',
  tagesplan_abend: 'hat schon „Offen geblieben“',
  nichts_offen: 'nichts erledigt, nichts offen',
}

function vorname(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

function ausgelassenListe(b: Bewertet[], ohne: string): string[] {
  const jeStand = new Map<string, string[]>()
  for (const x of b) {
    const t = STAND_TEXT[x.stand]
    if (!t || x.person.email === ohne) continue
    jeStand.set(t, [...(jeStand.get(t) ?? []), vorname(x.person.name)])
  }
  return [...jeStand.entries()].map(([t, namen]) => `${namen.join(', ')} (${t})`)
}

/** Vom Minutentakt gerufen. Außerhalb möglicher Fenster ohne Datenbankzugriff. Wirft nie. */
export async function sendeAbendRueckblicke(admin: Db, o: AbendOptionen = {}): Promise<AbendErgebnis> {
  const jetzt = o.jetzt ?? new Date()
  const ergebnis: AbendErgebnis = { gelaufen: false, gesendet: 0, fehler: [] }
  if (!vielleichtFenster(jetzt)) return ergebnis
  try {
    const einstellung = o.einstellung ?? (await einstellungGemerkt(admin))
    if (einstellung.modus === 'aus' || !imAbendFenster(jetzt, einstellung.uhrzeit)) return ergebnis
    const heute = berlinZeit(jetzt).datum
    const telegram: TelegramApi = o.telegram ?? ((methode, daten) => telegramMayerBot(methode, daten, 'abend_rueckblick'))
    // Probelauf: Superuser sehen die Nachrichten der Kollegen — deren Inhalt kommt nicht ins Protokoll (das lesen auch Geschäftsführer).
    const telegramProbe: TelegramApi = o.telegram ?? ((methode, daten) => telegramMayerBot(methode, daten, 'abend_rueckblick', true))
    const privatAktiv = o.privatAktiv ?? ((e: string) => privatBotAktiv(admin, e))

    const [alle, einst] = await Promise.all([ladeAlleAktiven(admin), ladeEinstellungen(admin, ART)])
    const mitChat = alle.filter((p): p is TeamMensch => p.chat !== null)
    const empfaenger = offeneEmpfaenger(mitChat, einst, einstellung.modus, heute) as TeamMensch[]
    if (!empfaenger.length) return ergebnis
    const tagesplanAbend = await ladeTagesplanAbend(admin)
    if (empfaenger.every((p) => tagesplanAbend.has(p.email))) return ergebnis
    ergebnis.gelaufen = true

    const daten = await ladeGemeinsameDaten(admin, heute)
    const bewertet = await bewerte(admin, einstellung.modus === 'alle' ? empfaenger : alle, einst, tagesplanAbend, heute, privatAktiv, daten)

    for (const p of empfaenger) {
      if (tagesplanAbend.has(p.email)) continue
      const ich = bewertet.find((b) => b.person.email === p.email)
      const eigene = ich?.nachricht ?? null
      let probe: string[] = []
      if (einstellung.modus === 'superuser') {
        const kollegen = bewertet.filter((b) => b.person.email !== p.email && b.stand === 'wuerde_senden' && b.probeNachricht)
        probe = probeNachrichten(kollegen.map((b) => ({ name: b.person.name, text: b.probeNachricht!.text })), ausgelassenListe(bewertet, p.email))
      }
      if (!eigene && !probe.length) continue
      try {
        if (!(await beanspruche(admin, ART, p.email, einst.has(p.email), heute))) continue
        let ok = true
        if (eigene) {
          const extra = eigene.knoepfe.length ? { reply_markup: { inline_keyboard: eigene.knoepfe } } : {}
          ok = !!(await telegram('sendMessage', { chat_id: p.chat, text: eigene.text, ...extra }))
        }
        for (const t of probe) ok = !!(await telegramProbe('sendMessage', { chat_id: p.chat, text: t })) && ok
        if (ok) ergebnis.gesendet++
        else ergebnis.fehler.push(`Abend-Rückblick an ${p.email}: nicht (ganz) zugestellt.`)
      } catch (err) {
        ergebnis.fehler.push(`Abend-Rückblick an ${p.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}

export type TrockenErgebnis = {
  modus: Modus
  uhrzeit: string
  imFenster: boolean
  datum: string
  personen: { name: string; email: string; stand: PersonStand; text?: string; knoepfe?: string[] }[]
  fehler: string[]
}

/**
 * Trockenlauf (Aktion abend_rueckblick_test): was heute jeder (oder nur `email`) bekäme — ohne Zeitfenster, ohne
 * Schalter, ohne zu senden und ohne zu schreiben. Wirft nie.
 */
export async function abendRueckblickTrockenlauf(admin: Db, o: { email?: string; jetzt?: Date; privatAktiv?: (email: string) => Promise<boolean> } = {}): Promise<TrockenErgebnis> {
  const jetzt = o.jetzt ?? new Date()
  const heute = berlinZeit(jetzt).datum
  const einstellung = await ladeAbendEinstellung(admin)
  const ergebnis: TrockenErgebnis = { modus: einstellung.modus, uhrzeit: einstellung.uhrzeit, imFenster: imAbendFenster(jetzt, einstellung.uhrzeit), datum: heute, personen: [], fehler: [] }
  try {
    const nur = text(o.email).trim().toLowerCase()
    let team = await ladeAlleAktiven(admin)
    if (nur) team = team.filter((p) => p.email === nur)
    if (!team.length) {
      ergebnis.fehler.push(nur ? `Kein aktiver Mitarbeiter mit ${nur}.` : 'Keine aktiven Mitarbeiter.')
      return ergebnis
    }
    let einst = new Map<string, PersonEinstellung>()
    try {
      einst = await ladeEinstellungen(admin, ART)
    } catch (err) {
      ergebnis.fehler.push(`Einstellungen je Mitarbeiter nicht lesbar (SQL abend_rueckblick.sql schon ausgeführt?): ${err instanceof Error ? err.message : String(err)}`)
    }
    let tagesplanAbend = new Set<string>()
    try {
      tagesplanAbend = await ladeTagesplanAbend(admin)
    } catch (err) {
      ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
    }
    const daten = await ladeGemeinsameDaten(admin, heute)
    const bewertet = await bewerte(admin, team, einst, tagesplanAbend, heute, o.privatAktiv ?? ((e: string) => privatBotAktiv(admin, e)), daten)
    ergebnis.personen = bewertet.map((b) => ({
      name: b.person.name,
      email: b.person.email,
      stand: b.stand,
      ...(b.nachricht ? { text: b.nachricht.text, knoepfe: b.nachricht.knoepfe.flat().map((k) => k.text) } : {}),
    }))
  } catch (err) {
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}

// ---------------------------------------------------------------------------------------------
// Knöpfe „✓ Erledigt“ / „→ Morgen“
// ---------------------------------------------------------------------------------------------

/** Ist das ein Knopf dieses Bausteins (callback_data „ar:e:<id>“ oder „ar:m:<id>“)? */
export function istAbendKnopf(daten: unknown): boolean {
  return KNOPF_MUSTER.test(text(daten))
}

export type KnopfErgebnis = { ok: boolean; text: string; /** Vermerk für die Zeile in der Nachricht; fehlt = Nachricht bleibt. */ vermerk?: string }

/**
 * Führt einen Knopf aus dem Abend-Rückblick aus — nur für offene Aufgaben, die in den Rückblick dieser Person gehören
 * (eigene Liste ohne Microsoft To Do, Bereichsliste mit ihr als zuständig). Wie fuehrePlanKnopfAus im privaten Bot:
 * Erledigt → erledigt_am = heute. Morgen → erledigen_bis = nächster Werktag (eine fällige Wiedervorlage rückt mit).
 * Wirft nie.
 */
export async function fuehreAbendKnopfAus(admin: Db, person: RueckblickPerson, daten: unknown, jetzt: Date = new Date()): Promise<KnopfErgebnis> {
  const m = KNOPF_MUSTER.exec(text(daten))
  const p = { ...person, email: text(person.email).trim().toLowerCase() }
  if (!m || !p.email) return { ok: false, text: 'Unbekannter Knopf.' }
  const [, art, todoId] = m
  const fehler = { ok: false, text: 'Das hat gerade nicht geklappt. Bitte später noch einmal.' }
  try {
    const { data: t, error } = await admin.from('todos').select(TODO_SPALTEN).eq('id', todoId).maybeSingle()
    if (error) return fehler
    if (!t || !istMayerAufgabe(p, t as RueckblickTodo, true)) return { ok: false, text: 'Diese Aufgabe gibt es in deinen Listen nicht.' }
    const name = `„${kurz(text(t.aufgabe), 60)}“`
    if (text(t.erledigt_am).trim()) return { ok: false, text: `${name} ist schon erledigt.`, vermerk: '✓ schon erledigt' }
    const heute = berlinZeit(jetzt).datum
    const ziel = naechsterWerktag(heute)
    const zielName = naechsterTagName(heute)
    let aenderung: Record<string, string>
    if (art === 'e') aenderung = { erledigt_am: heute }
    else {
      aenderung = { erledigen_bis: ziel }
      const wv = alsDatum(t.geplante_wiedervorlage)
      if (wv && wv <= heute) aenderung.geplante_wiedervorlage = ziel
    }
    // Nur ändern, wenn es inzwischen nicht anderswo erledigt wurde.
    const { data: geaendert, error: f } = await admin.from('todos').update(aenderung).eq('id', todoId).is('erledigt_am', null).select('id')
    if (f) return fehler
    if (!(geaendert ?? []).length) return { ok: false, text: `${name} ist schon erledigt.`, vermerk: '✓ schon erledigt' }
    if (art === 'e') return { ok: true, text: `Erledigt: ${name}`, vermerk: '✓ erledigt' }
    const wohin = zielName === 'Morgen' ? 'morgen' : zielName
    return { ok: true, text: `Auf ${wohin} verschoben: ${name}`, vermerk: `→ auf ${wohin} verschoben` }
  } catch {
    return fehler
  }
}

/**
 * Nachricht nach einem Klick: Die Zeile der Aufgabe bekommt den Vermerk („… — ✓ erledigt“), ihre beiden Knöpfe fallen weg,
 * die übrigen bleiben. Erkennt die Aufgabe an der Nummer im Knopf („✓ Erledigt (2)“). Rechnet nur.
 */
export function nachrichtNachKlick(alterText: string, tastatur: Knopf[][], daten: string, vermerk: string): { text: string; tastatur: Knopf[][] } {
  const m = KNOPF_MUSTER.exec(daten)
  const reihen = Array.isArray(tastatur) ? tastatur : []
  if (!m) return { text: alterText, tastatur: reihen }
  const id = m[2]
  const passt = (k: Knopf) => k?.callback_data === `${KNOPF_PRAEFIX}e:${id}` || k?.callback_data === `${KNOPF_PRAEFIX}m:${id}`
  const index = reihen.findIndex((r) => Array.isArray(r) && r.some(passt))
  if (index < 0) return { text: alterText, tastatur: reihen }
  const nummer = /\((\d+)\)\s*$/.exec(text(reihen[index].find(passt)?.text))?.[1]
  const rest = reihen.filter((_, i) => i !== index)
  if (!nummer) return { text: alterText, tastatur: rest }
  const zeilen = text(alterText).split('\n')
  const z = zeilen.findIndex((x) => x.startsWith(`${nummer}. `))
  if (z >= 0 && !zeilen[z].includes(' — ')) zeilen[z] = `${zeilen[z]} — ${vermerk}`
  return { text: zeilen.join('\n'), tastatur: rest }
}

/** Abend-Rückblick für die Person an- oder ausschalten (Assistent „Abend-Rückblick aus“). null = gespeichert, sonst Fehlertext. */
export async function setzeAbendRueckblick(admin: Db, email: string, an: boolean): Promise<string | null> {
  const ich = text(email).trim().toLowerCase()
  if (!ich) return 'Keine Adresse.'
  try {
    const { error } = await admin.from('assistent_hinweise').upsert({ email: ich, abend_rueckblick: an, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
    return error ? error.message : null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
