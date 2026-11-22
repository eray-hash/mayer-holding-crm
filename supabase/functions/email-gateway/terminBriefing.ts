// Termin-Briefing per Telegram vor Kundenterminen (22.11.2026) — vom Zeitplan jede Minute gerufen
// (Aktion termin_erinnerungen in index.ts), ohne offenes Browserfenster.
//
// - Vor dem Termin: Beginnt ein Termin mit Bezug zu einer Kunden- oder Objektakte (Regeln in
//   _shared/terminBriefingKern.ts, findeBezug) in höchstens „Vorlauf + 5“ Minuten und noch mehr als 5 Minuten,
//   bekommt jeder Beteiligte aus dem Team (Besitzer und Teilnehmer) mit Telegram ein Briefing — bei 60 Minuten
//   Vorlauf also zwischen 65 und 55 Minuten vorher; ein erst kurzfristig angelegter Termin bekommt es sofort.
// - Morgenübersicht (wahlweise): an jedem Tag beim ersten Minutentakt ab 7:30 Uhr (bis 9:30 Uhr, ein verpasster
//   Morgen wird nicht nachgeholt) die Kundentermine des Tages in Kurzform, ohne Gesprächspunkte. Ohne
//   Kundentermin keine Nachricht.
// - Einstellungen je Mitarbeiter in kalender_einstellungen: briefing_an (Standard an), briefing_vorlauf
//   (Minuten, Standard 60), briefing_morgen (Standard aus). Keine Zeile = Standard.
// - Einmal je Termin, Empfänger und Beginn: Vor dem Senden wird eine Zeile in termin_briefings angelegt
//   (Schlüssel `vorlauf|<termin>|<adresse>|<beginn>`). Wer die Zeile nicht anlegen kann (schon da, oder die
//   Tabelle fehlt), sendet nicht. Wird ein Termin verschoben, gibt es zum neuen Beginn ein neues Briefing.
//   Klappt das Senden nicht, wird es nicht wiederholt (sonst liefe die KI jede Minute erneut).
// - Rechte: Nur wer die Akte bzw. das Objekt sehen darf (darfBezug), bekommt das Briefing; private Akten und
//   Objekte nur ihr Besitzer. Ist die Akte privat und nutzt der Besitzer den privaten Assistenten, geht das
//   Briefing über diesen Bot (wie die Erinnerungen in kalender.ts) — nie ersatzweise über den Mayer-Bot.
// - Höchstens 6 Briefings mit KI je Lauf (der Rest folgt im nächsten Takt, solange das Fenster offen ist).
// - Runde 5: Das Briefing endet mit „🎙️ Gespräch aufnehmen: <Link>“ — Direkt-Link in die Gesprächs-App mit Termin
//   und Akte (_shared/gespraechLink.ts), ein Tipp bis zur Einwilligung.
// - Runde 5, Erinnerung zum Terminbeginn (beimTerminbeginn, wahlweise, Spalte gespraech_erinnerung, Standard aus):
//   von 1 Minute vor bis 5 Minuten nach Beginn eines Termins mit Akte eine kurze Telegram-Nachricht mit dem
//   Direkt-Link. Einmal je Termin, Empfänger und Beginn (Sperrzeile `aufnahme|…`, art 'aufnahme'); nicht, wenn zum
//   Termin schon eine Aufnahme läuft oder vorliegt. Gleiche Rechte- und Privat-Regeln wie das Briefing. Ohne KI.
// - Wirft nie: Fehler stehen im Protokoll und im Ergebnis.

import {
  akteText,
  type BriefingDaten,
  type BriefingPerson,
  type BriefingTermin,
  briefingText,
  type Bezug,
  darfBezug,
  findeBezug,
  gespraechspunkte,
  istAbgesagterTitel,
  istPrivaterBezug,
  kandidatenLader,
  type KiFunktion,
  ladeBriefingDaten,
  ladeLinkBasis,
  TERMIN_SPALTEN,
  uhrzeit,
} from '../_shared/terminBriefingKern.ts'
import { privatBotAktiv, sendePrivat } from '../_shared/telegramPrivat.ts'
import { aufnehmenLink } from '../_shared/gespraechLink.ts'
import { termineMitAufnahme } from './nachTermin.ts'
import { berlinTagesbeginn, berlinZeit, plusTage } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type Senden = (chat: number | string, text: string) => Promise<boolean>

export type BriefingOptionen = {
  jetzt?: Date
  /** Senden über den Mayer-Bot (Standard: kalender.ts sendeTelegram, vom Aufrufer übergeben). */
  sende: Senden
  /** Senden über den privaten Bot (Standard: _shared/telegramPrivat.ts). */
  sendePrivat?: Senden
  /** Nutzt die Person den privaten Assistenten? (Standard: _shared/telegramPrivat.ts) */
  privatAktiv?: (email: string) => Promise<boolean>
  /** KI-Aufruf für die Gesprächspunkte (Standard: kiAufruf). */
  ki?: KiFunktion
  /** Schlüssel für den KI-Dienst (Standard: ANTHROPIC_API_KEY; null = ohne Gesprächspunkte). */
  apiKey?: string | null
}

export type BriefingErgebnis = { gesendet: number; morgen: number; aufnahme: number; fehler: string[] }

export const VORLAUF_STANDARD = 60
export const VORLAUF_WAHL = [15, 30, 45, 60, 90, 120]
const VORLAUF_HOECHSTENS = 240
/** Toleranz um den Vorlauf und Mindestabstand zum Beginn (Minuten). */
const SPIELRAUM = 5
const HOECHSTENS_MIT_KI = 6
const MORGEN_AB = 7 * 60 + 30
const MORGEN_BIS = 9 * 60 + 30
const TABELLE = 'termin_briefings'

type Einstellung = { an: boolean; vorlauf: number; morgen: boolean }
type Faellig = { t: BriefingTermin; minutenBis: number; personen: string[] }
type Kandidat = { f: Faellig; p: string; id: string }
type Person = BriefingPerson & { name: string; chat: number | string | null }

function adresse(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

/** Gespeicherter Vorlauf → gültiger Wert (10 bis 240 Minuten, sonst Standard). */
export function gueltigerVorlauf(v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 10 && n <= VORLAUF_HOECHSTENS ? n : VORLAUF_STANDARD
}

/** Ist das Briefing für diesen Vorlauf jetzt fällig? (zwischen „Vorlauf + 5“ und 5 Minuten vor Beginn) */
export function istFaellig(minutenBis: number, vorlauf: number): boolean {
  return minutenBis > SPIELRAUM && minutenBis <= vorlauf + SPIELRAUM
}

export function schluessel(art: 'vorlauf' | 'aufnahme', terminId: string, email: string, beginn: string): string
export function schluessel(art: 'morgen', email: string, datum: string): string
export function schluessel(art: string, ...teile: string[]): string {
  return [art, ...teile].join('|')
}

async function ladeEinstellungen(admin: Db, fehler: string[]): Promise<Map<string, Einstellung> | null> {
  const { data, error } = await admin.from('kalender_einstellungen').select('email, briefing_an, briefing_vorlauf, briefing_morgen')
  if (error) {
    // Spalten noch nicht angelegt (SQL nicht eingespielt): lieber gar nichts senden.
    fehler.push(`Einstellungen nicht lesbar: ${error.message}`)
    return null
  }
  const m = new Map<string, Einstellung>()
  for (const z of (data ?? []) as { email: string; briefing_an?: boolean | null; briefing_vorlauf?: number | null; briefing_morgen?: boolean | null }[]) {
    m.set(adresse(z.email), { an: z.briefing_an !== false, vorlauf: gueltigerVorlauf(z.briefing_vorlauf ?? VORLAUF_STANDARD), morgen: z.briefing_morgen === true })
  }
  return m
}

const STANDARD: Einstellung = { an: true, vorlauf: VORLAUF_STANDARD, morgen: false }

async function ladeTeam(admin: Db): Promise<Map<string, Person>> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, rolle, ist_admin, bereiche, telegram_chat_id, aktiv').eq('aktiv', true)
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  const team = new Map<string, Person>()
  for (const m of (data ?? []) as { name: string; email: string; rolle?: string; ist_admin?: boolean; bereiche?: string[]; telegram_chat_id?: number | string | null }[]) {
    const email = adresse(m.email)
    if (!email) continue
    team.set(email, { email, name: String(m.name ?? email), rolle: m.rolle ?? null, ist_admin: m.ist_admin === true, bereiche: Array.isArray(m.bereiche) ? m.bereiche : [], chat: m.telegram_chat_id ?? null })
  }
  return team
}

/** Legt die Sperrzeile an. true = diese Ausführung darf senden. */
async function beanspruche(admin: Db, zeile: Record<string, unknown>, fehler: string[]): Promise<boolean> {
  const { error } = await admin.from(TABELLE).insert(zeile)
  if (!error) return true
  if (error.code !== '23505') fehler.push(`Briefing nicht vermerkt (${error.message}) — nicht gesendet.`)
  return false
}

async function vermerkeZustellung(admin: Db, id: string, zugestellt: boolean): Promise<void> {
  const { error } = await admin.from(TABELLE).update({ zugestellt }).eq('id', id)
  if (error) console.error('Termin-Briefing: Zustellung nicht vermerkt', id, error.message)
}

export async function sendeTerminBriefings(admin: Db, o: BriefingOptionen): Promise<BriefingErgebnis> {
  const ergebnis: BriefingErgebnis = { gesendet: 0, morgen: 0, aufnahme: 0, fehler: [] }
  const jetzt = o.jetzt ?? new Date()
  try {
    const einst = await ladeEinstellungen(admin, ergebnis.fehler)
    if (einst) {
      await vorDemTermin(admin, o, jetzt, einst, ergebnis)
      await morgenUebersicht(admin, o, jetzt, einst, ergebnis)
    }
  } catch (err) {
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  // Unabhängig vom Briefing (eigene Einstellung): Erinnerung zum Terminbeginn.
  try {
    await beimTerminbeginn(admin, o, jetzt, ergebnis)
  } catch (err) {
    ergebnis.fehler.push(`Erinnerung zum Terminbeginn: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (ergebnis.fehler.length > 0) console.error('Termin-Briefing:', ergebnis.fehler.join(' | '))
  return ergebnis
}

async function privatGenutzt(admin: Db, o: BriefingOptionen, email: string, merker: Map<string, boolean>): Promise<boolean> {
  if (!merker.has(email)) {
    const pruefe = o.privatAktiv ?? ((e: string) => privatBotAktiv(admin, e))
    merker.set(email, await pruefe(email).catch(() => false))
  }
  return merker.get(email) === true
}

/** Senden an eine Person: private Akte und privater Assistent → nur dieser Bot, sonst der Mayer-Bot. */
async function zustellen(admin: Db, o: BriefingOptionen, p: Person, privat: boolean, text: string, privatMerker: Map<string, boolean>): Promise<boolean> {
  if (!p.chat) return false
  if (privat) {
    if (await privatGenutzt(admin, o, p.email, privatMerker)) {
      const ueberPrivat = o.sendePrivat ?? (async (chat: number | string, t: string) => !!(await sendePrivat(chat, t)))
      // Nicht zugestellt: nie ersatzweise über den Mayer-Bot.
      return await ueberPrivat(p.chat, text)
    }
  }
  return await o.sende(p.chat, text)
}

async function vorDemTermin(admin: Db, o: BriefingOptionen, jetzt: Date, einst: Map<string, Einstellung>, ergebnis: BriefingErgebnis): Promise<void> {
  const ab = new Date(jetzt.getTime() + SPIELRAUM * 60000).toISOString()
  const bis = new Date(jetzt.getTime() + (VORLAUF_HOECHSTENS + SPIELRAUM) * 60000).toISOString()
  const { data, error } = await admin.from('termine').select(TERMIN_SPALTEN).eq('ganztags', false).gt('beginn', ab).lte('beginn', bis).order('beginn', { ascending: true }).limit(500)
  if (error) {
    ergebnis.fehler.push(`Termine nicht lesbar: ${error.message}`)
    return
  }
  const termine = ((data ?? []) as BriefingTermin[]).filter((t) => !istAbgesagterTitel(String(t.titel ?? '')))
  if (termine.length === 0) return

  // Wer ist bei welchem Termin jetzt fällig? (vor jedem Nachschlagen der Akte — die meisten Termine fallen hier raus)
  const faellig: Faellig[] = []
  for (const t of termine) {
    const minutenBis = (new Date(t.beginn).getTime() - jetzt.getTime()) / 60000
    const beteiligte = [...new Set([t.besitzer_email, ...(t.teilnehmer ?? [])].map(adresse).filter(Boolean))]
    const personen = beteiligte.filter((p) => {
      const e = einst.get(p) ?? STANDARD
      return e.an && istFaellig(minutenBis, e.vorlauf)
    })
    if (personen.length > 0) faellig.push({ t, minutenBis, personen })
  }
  if (faellig.length === 0) return
  const team = await ladeTeam(admin)

  // Schon verschickte gleich herausnehmen (eine Abfrage für alle).
  const kandidaten: Kandidat[] = faellig.flatMap((f) => f.personen.filter((p) => team.get(p)?.chat).map((p) => ({ f, p, id: schluessel('vorlauf', f.t.id, p, new Date(f.t.beginn).toISOString()) })))
  if (kandidaten.length === 0) return
  const { data: schon, error: schonFehler } = await admin.from(TABELLE).select('id').in('id', kandidaten.map((k) => k.id))
  if (schonFehler) {
    ergebnis.fehler.push(`Vermerke nicht lesbar: ${schonFehler.message}`)
    return
  }
  const erledigt = new Set(((schon ?? []) as { id: string }[]).map((z) => z.id))

  const teamAdressen = new Set(team.keys())
  const teamNamen = [...team.values()].map((p) => p.name)
  const namen = new Map([...team.values()].map((p) => [p.email, p.name]))
  const lader = kandidatenLader(admin)
  const heute = berlinZeit(jetzt).datum
  const privatMerker = new Map<string, boolean>()
  let linkBasis: string | null = null
  let mitKi = 0

  for (const f of faellig) {
    const offen = kandidaten.filter((k) => k.f === f && !erledigt.has(k.id))
    if (offen.length === 0) continue
    if (mitKi >= HOECHSTENS_MIT_KI) break
    let bezug: Bezug | null
    try {
      bezug = await findeBezug(admin, f.t, { team: teamAdressen, teamNamen, lader })
    } catch (err) {
      ergebnis.fehler.push(`Bezug zu Termin ${f.t.id} nicht ermittelbar: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    if (!bezug) continue
    const gefunden = bezug
    const empfaenger = offen.filter((k) => darfBezug(team.get(k.p)!, gefunden))
    if (empfaenger.length === 0) continue

    // Erst beanspruchen, dann bauen (die KI läuft nur, wenn wirklich jemand dran ist).
    const meine: Kandidat[] = []
    for (const k of empfaenger) {
      if (await beanspruche(admin, { id: k.id, termin_id: f.t.id, empfaenger: k.p, art: 'vorlauf', beginn: f.t.beginn, gesendet_am: jetzt.toISOString() }, ergebnis.fehler)) meine.push(k)
    }
    if (meine.length === 0) continue

    let daten: BriefingDaten | null = null
    try {
      linkBasis ??= await ladeLinkBasis(admin)
      daten = await ladeBriefingDaten(admin, bezug, heute, { linkBasis })
    } catch (err) {
      ergebnis.fehler.push(`Akte zu Termin ${f.t.id} nicht lesbar: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!daten) {
      for (const k of meine) await vermerkeZustellung(admin, k.id, false)
      continue
    }
    mitKi++
    const punkte = await gespraechspunkte(akteText(daten), { funktion: 'email-gateway', ki: o.ki, apiKey: o.apiKey })
    const text = mitAufnahmeLink(briefingText(daten, { termin: f.t, minutenBis: f.minutenBis, namen, gespraechspunkte: punkte }), linkBasis ?? (await ladeLinkBasis(admin)), f.t.id, bezug)
    for (const k of meine) {
      const ok = await zustellen(admin, o, team.get(k.p)!, istPrivaterBezug(bezug), text, privatMerker).catch(() => false)
      if (ok) ergebnis.gesendet++
      await vermerkeZustellung(admin, k.id, ok)
    }
  }
}

async function morgenUebersicht(admin: Db, o: BriefingOptionen, jetzt: Date, einst: Map<string, Einstellung>, ergebnis: BriefingErgebnis): Promise<void> {
  const b = berlinZeit(jetzt)
  const minute = b.stunde * 60 + b.minute
  if (minute < MORGEN_AB || minute >= MORGEN_BIS) return
  const wollen = [...einst.entries()].filter(([, e]) => e.an && e.morgen).map(([email]) => email)
  if (wollen.length === 0) return
  const ids = wollen.map((e) => schluessel('morgen', e, b.datum))
  const { data: schon, error: schonFehler } = await admin.from(TABELLE).select('id').in('id', ids)
  if (schonFehler) {
    ergebnis.fehler.push(`Vermerke nicht lesbar: ${schonFehler.message}`)
    return
  }
  const erledigt = new Set(((schon ?? []) as { id: string }[]).map((z) => z.id))
  const offen = wollen.filter((e) => !erledigt.has(schluessel('morgen', e, b.datum)))
  if (offen.length === 0) return

  const team = await ladeTeam(admin)
  const tagBeginn = berlinTagesbeginn(b.datum).toISOString()
  const tagEnde = berlinTagesbeginn(plusTage(b.datum, 1)).toISOString()
  const { data, error } = await admin.from('termine').select(TERMIN_SPALTEN).eq('ganztags', false).gte('beginn', tagBeginn).lt('beginn', tagEnde).order('beginn', { ascending: true }).limit(500)
  if (error) {
    ergebnis.fehler.push(`Termine des Tages nicht lesbar: ${error.message}`)
    return
  }
  const termine = ((data ?? []) as BriefingTermin[]).filter((t) => !istAbgesagterTitel(String(t.titel ?? '')))
  const teamAdressen = new Set(team.keys())
  const teamNamen = [...team.values()].map((p) => p.name)
  const lader = kandidatenLader(admin)
  const bezuege = new Map<string, Bezug | null>()
  const datenJe = new Map<string, BriefingDaten | null>()
  const linkBasis = await ladeLinkBasis(admin)
  const privatMerker = new Map<string, boolean>()

  for (const email of offen) {
    const p = team.get(email)
    if (!p?.chat) continue
    // Erst vermerken — auch ohne Kundentermin, damit der Morgen für diese Person erledigt ist.
    const id = schluessel('morgen', email, b.datum)
    if (!(await beanspruche(admin, { id, termin_id: null, empfaenger: email, art: 'morgen', beginn: null, gesendet_am: jetzt.toISOString() }, ergebnis.fehler))) continue
    const meine = termine.filter((t) => adresse(t.besitzer_email) === email || (t.teilnehmer ?? []).map(adresse).includes(email))
    const mayer: string[] = []
    const privat: string[] = []
    for (const t of meine) {
      if (!bezuege.has(t.id)) {
        try {
          bezuege.set(t.id, await findeBezug(admin, t, { team: teamAdressen, teamNamen, lader }))
        } catch (err) {
          ergebnis.fehler.push(`Bezug zu Termin ${t.id} nicht ermittelbar: ${err instanceof Error ? err.message : String(err)}`)
          bezuege.set(t.id, null)
        }
      }
      const bezug = bezuege.get(t.id)
      if (!bezug || !darfBezug(p, bezug)) continue
      const schl = `${bezug.art}:${bezug.id}`
      if (!datenJe.has(schl)) {
        try {
          datenJe.set(schl, await ladeBriefingDaten(admin, bezug, b.datum, { linkBasis }))
        } catch (err) {
          ergebnis.fehler.push(`Akte zu Termin ${t.id} nicht lesbar: ${err instanceof Error ? err.message : String(err)}`)
          datenJe.set(schl, null)
        }
      }
      const d = datenJe.get(schl)
      if (!d) continue
      ;(istPrivaterBezug(bezug) ? privat : mayer).push(morgenBlock(t, d))
    }
    if (mayer.length + privat.length === 0) {
      await vermerkeZustellung(admin, id, false)
      continue
    }
    const nachricht = (bloecke: string[]) => `☀️ Deine Kundentermine heute (${bloecke.length})\n\n${bloecke.join('\n\n')}`.slice(0, 3990)
    // Termine mit privaten Akten gehen bei Nutzern des privaten Assistenten getrennt über diesen Bot
    // (Privates bleibt privat); ohne privaten Assistenten stehen sie mit in der Mayer-Nachricht.
    let ok = false
    if (privat.length > 0 && (await privatGenutzt(admin, o, p.email, privatMerker))) {
      ok = await zustellen(admin, o, p, true, nachricht(privat), privatMerker).catch(() => false)
      if (mayer.length > 0) ok = (await zustellen(admin, o, p, false, nachricht(mayer), privatMerker).catch(() => false)) || ok
    } else {
      ok = await zustellen(admin, o, p, false, nachricht([...mayer, ...privat]), privatMerker).catch(() => false)
    }
    if (ok) ergebnis.morgen++
    await vermerkeZustellung(admin, id, ok)
  }

  // Einmal am Morgen alte Vermerke aufräumen (älter als 60 Tage).
  const grenze = new Date(jetzt.getTime() - 60 * 86400000).toISOString()
  const { error: weg } = await admin.from(TABELLE).delete().lt('gesendet_am', grenze)
  if (weg) console.error('Termin-Briefing: alte Vermerke nicht gelöscht', weg.message)
}

// ---------------------------------------------------------------------------------------------
// Gesprächs-App: Direkt-Link im Briefing und Erinnerung zum Terminbeginn (Runde 5)

/** Direkt-Link in die Gesprächs-App: Termin und Akte vorgewählt, die App geht gleich zur Einwilligung. */
export function aufnahmeLinkZu(linkBasis: string, terminId: string, bezug: Bezug): string {
  return aufnehmenLink(linkBasis, { termin: terminId, ...(bezug.art === 'kunde' ? { kunde: bezug.id } : { objekt: bezug.id }) })
}

/** Hängt „🎙️ Gespräch aufnehmen: <Link>“ an (Telegram erlaubt 4096 Zeichen, das Briefing ist auf 3900 begrenzt). */
export function mitAufnahmeLink(text: string, linkBasis: string, terminId: string, bezug: Bezug): string {
  return `${text}\n\n🎙️ Gespräch aufnehmen: ${aufnahmeLinkZu(linkBasis, terminId, bezug)}`
}

/** Fenster der Erinnerung um den Beginn (Minuten): von 1 vor bis 5 nach Beginn (falls ein Takt ausfällt). */
export const ERINNERUNG_VOR = 1
export const ERINNERUNG_NACH = 5
const ERINNERUNGEN_HOECHSTENS = 20

/** `zusatz` z. B. „mit Josef Lehle“ bzw. „zu Lagerhalle Neu-Ulm“ (leer, wenn der Name fehlt). */
export function erinnerungsText(t: Pick<BriefingTermin, 'titel' | 'beginn'>, zusatz: string, link: string): string {
  const titel = String(t.titel ?? '').trim().slice(0, 100) || 'Termin'
  return `🎙️ Dein Termin „${titel}“ (${uhrzeit(t.beginn)} Uhr)${zusatz ? ` ${zusatz.slice(0, 90)}` : ''} beginnt.\nGespräch aufnehmen: ${link}`
}

async function akteZusatz(admin: Db, bezug: Bezug): Promise<string> {
  if (bezug.art === 'kunde') {
    const { data } = await admin.from('kunden').select('firma, ansprechpartner').eq('id', bezug.id).maybeSingle()
    const name = String(data?.ansprechpartner ?? '').trim() || String(data?.firma ?? '').trim()
    return name ? `mit ${name}` : ''
  }
  const { data } = await admin.from('objekte').select('bezeichnung').eq('id', bezug.id).maybeSingle()
  const name = String(data?.bezeichnung ?? '').trim()
  return name ? `zu ${name}` : ''
}

async function beimTerminbeginn(admin: Db, o: BriefingOptionen, jetzt: Date, ergebnis: BriefingErgebnis): Promise<void> {
  // Wer will erinnert werden? (Standard aus — meist niemand, dann keine weitere Abfrage)
  const { data: einst, error: einstFehler } = await admin.from('kalender_einstellungen').select('email').eq('gespraech_erinnerung', true)
  if (einstFehler) {
    // Spalte noch nicht angelegt (SQL nicht eingespielt): still nichts tun.
    if (!/gespraech_erinnerung/.test(einstFehler.message ?? '')) ergebnis.fehler.push(`Einstellungen nicht lesbar: ${einstFehler.message}`)
    return
  }
  const wollen = new Set(((einst ?? []) as { email: string }[]).map((z) => adresse(z.email)).filter(Boolean))
  if (wollen.size === 0) return

  const ab = new Date(jetzt.getTime() - ERINNERUNG_NACH * 60000).toISOString()
  const bis = new Date(jetzt.getTime() + ERINNERUNG_VOR * 60000).toISOString()
  const { data, error } = await admin.from('termine').select(TERMIN_SPALTEN).eq('ganztags', false).gte('beginn', ab).lte('beginn', bis).order('beginn', { ascending: true }).limit(200)
  if (error) {
    ergebnis.fehler.push(`Termine nicht lesbar: ${error.message}`)
    return
  }
  const termine = ((data ?? []) as BriefingTermin[]).filter((t) => !istAbgesagterTitel(String(t.titel ?? '')))
  const faellig = termine
    .map((t) => ({ t, personen: [...new Set([t.besitzer_email, ...(t.teilnehmer ?? [])].map(adresse).filter((p) => p && wollen.has(p)))] }))
    .filter((f) => f.personen.length > 0)
  if (faellig.length === 0) return

  const team = await ladeTeam(admin)
  const kandidaten = faellig.flatMap((f) => f.personen.filter((p) => team.get(p)?.chat).map((p) => ({ f, p, id: schluessel('aufnahme', f.t.id, p, new Date(f.t.beginn).toISOString()) })))
  if (kandidaten.length === 0) return
  const { data: schon, error: schonFehler } = await admin.from(TABELLE).select('id').in('id', kandidaten.map((k) => k.id))
  if (schonFehler) {
    ergebnis.fehler.push(`Vermerke nicht lesbar: ${schonFehler.message}`)
    return
  }
  const erledigt = new Set(((schon ?? []) as { id: string }[]).map((z) => z.id))
  const offen = kandidaten.filter((k) => !erledigt.has(k.id))
  if (offen.length === 0) return

  // Läuft zum Termin schon eine Aufnahme (oder liegt eine vor)? Dann keine Erinnerung.
  const terminIds = [...new Set(offen.map((k) => k.f.t.id))]
  const mitAufnahme = await termineMitAufnahme(admin, terminIds, ergebnis.fehler)

  const teamAdressen = new Set(team.keys())
  const teamNamen = [...team.values()].map((p) => p.name)
  const lader = kandidatenLader(admin)
  const privatMerker = new Map<string, boolean>()
  const bezuege = new Map<string, Bezug | null>()
  let linkBasis: string | null = null
  let versucht = 0

  for (const k of offen) {
    if (versucht >= ERINNERUNGEN_HOECHSTENS) break
    const t = k.f.t
    if (mitAufnahme.has(String(t.id))) continue
    if (!bezuege.has(t.id)) {
      try {
        bezuege.set(t.id, await findeBezug(admin, t, { team: teamAdressen, teamNamen, lader }))
      } catch (err) {
        ergebnis.fehler.push(`Bezug zu Termin ${t.id} nicht ermittelbar: ${err instanceof Error ? err.message : String(err)}`)
        bezuege.set(t.id, null)
      }
    }
    const bezug = bezuege.get(t.id)
    const p = team.get(k.p)!
    if (!bezug || !darfBezug(p, bezug)) continue
    if (!(await beanspruche(admin, { id: k.id, termin_id: t.id, empfaenger: k.p, art: 'aufnahme', beginn: t.beginn, gesendet_am: jetzt.toISOString() }, ergebnis.fehler))) continue
    versucht++
    linkBasis ??= await ladeLinkBasis(admin)
    const zusatz = await akteZusatz(admin, bezug).catch(() => '')
    const text = erinnerungsText(t, zusatz, aufnahmeLinkZu(linkBasis, t.id, bezug))
    const ok = await zustellen(admin, o, p, istPrivaterBezug(bezug), text, privatMerker).catch(() => false)
    if (ok) ergebnis.aufnahme++
    await vermerkeZustellung(admin, k.id, ok)
  }
}

/** Kurzform für die Morgenübersicht: Uhrzeit, Titel, Akte, Stand, Offenes in Zahlen. */
export function morgenBlock(t: BriefingTermin, d: BriefingDaten): string {
  const z: string[] = []
  z.push(`${uhrzeit(t.beginn)} Uhr – ${String(t.titel ?? '').trim() || 'Termin'}${String(t.ort ?? '').trim() ? ` (${String(t.ort).trim()})` : ''}`)
  z.push(`${d.kopf}${d.stand ? ` · ${d.stand}` : ''}`)
  if (d.sachverhalt) z.push(d.sachverhalt)
  const hinweise: string[] = []
  if (d.offen.length) hinweise.push(d.offen[0])
  if (d.fehlend.length) hinweise.push(`${d.fehlend.length} Unterlage${d.fehlend.length === 1 ? '' : 'n'} fehlt${d.fehlend.length === 1 ? '' : 'en'} noch`)
  if (d.geld.length) hinweise.push(`${d.geld.length} offene Rechnung${d.geld.length === 1 ? '' : 'en'} / Angebot${d.geld.length === 1 ? '' : 'e'}`)
  if (hinweise.length) z.push(hinweise.join(' · '))
  z.push(d.link)
  return z.join('\n')
}
