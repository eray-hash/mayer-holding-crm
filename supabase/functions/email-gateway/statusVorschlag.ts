// Statuswechsel vorschlagen (Runde 6, 23.11.2026) — vom Minutentakt (Aktion termin_erinnerungen) gerufen, ohne KI.
//
// Warum: 1 Statuswechsel in 348 Verlaufseinträgen (Nutzungsauswertung 23.11.2026). Statusabhängige Abläufe
// (Willkommen, Wiedervorlagen, Portal) liefen deshalb leer. Aus Ereignissen wird ein Vorschlag abgeleitet und dem
// Verantwortlichen der Akte mit Knopf („Ja, Status auf X“ / „Nein“) geschickt; ausgeführt wird in
// telegram-gateway/bitteBestaetigenWerkzeug.ts. Regeln für das Ziel: _shared/statusVorschlagKern.ts.
//
// Ereignisse seit dem letzten Lauf:
//  - termin   Termin in der Zukunft mit Akte (neu angelegt oder gerade zugeordnet; termine.kunde_id).
//  - vertrag  Vertrag/Vollmacht als PDF/Scan in den Dokumenten der Akte (dokumentEreignis), auch online unterschrieben.
//  - angebot  Kostenvoranschlag angelegt (kostenvoranschlaege) oder Angebot in den Dokumenten.
//  - antwort  Mail des Kunden, die einer Akte zugeordnet ist, nachdem wir der Akte geschrieben hatten (gesendete_emails).
//
// Regeln:
//  - Nur bei eingeschaltetem Schalter (telegram_vorschlaege, Zeile 'einstellung', status_an) und nur an eingetragene
//    Empfänger — Standard AUS, Empfänger nur Eray (_shared/bestaetigenKern.ts).
//  - Werktags 8–19 Uhr Berliner Zeit, höchstens alle 15 Minuten (Zeile 'status_stand', erledigt_am = letzter Lauf;
//    bedingt weitergestellt, zwei Takte gleichzeitig laufen nie doppelt). Ereignisse außerhalb kommen beim nächsten Lauf.
//  - Höchstens ein offener Vorschlag je Akte; nach „Nein“ frühestens nach 7 Tagen wieder. Ein unbeantworteter
//    Vorschlag verfällt nach 14 Tagen (dann darf ein neuer kommen).
//  - Nur vorhandene Status, nie rückwärts. Der Empfänger muss die Akte sehen dürfen (Bereichsrechte, private
//    Kontakte nur ihr Besitzer).
//  - Wirft nie.

import { anlassText, EINSTELLUNG_ID, istEmpfaenger, leseEinstellung, neueKennung, STATUS_STAND_ID, type StatusDaten, statusKnoepfe, statusText, TABELLE, wannText, zufall } from '../_shared/bestaetigenKern.ts'
import { bestesZiel, dokumentEreignis, type StatusEreignis, statusName, statusNetzVon } from '../_shared/statusVorschlagKern.ts'
import { istAbgesagterTitel } from '../_shared/terminBriefingKern.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { darfAkte, SAMMELAKTEN } from '../telegram-gateway/rechte.ts'
import { type Person, type TelegramApi, telegramMayerBot } from './bitteBestaetigen.ts'
import { berlinZeit } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type StatusLauf = {
  gelaufen: boolean
  vorschlaege: number
  gesendet: number
  fehler: string[]
  vorschau?: { an: string; text: string; knoepfe: string[] }[]
}

const TAG_MS = 86_400_000
const ABSTAND_MS = 15 * 60_000
const UEBERLAPPUNG_MS = 5 * 60_000
const NEIN_SPERRE_TAGE = 7
const OFFEN_VERFALL_TAGE = 14
const HOECHSTENS_JE_PERSON_UND_LAUF = 3
const HOLDING = /@amayer-holding\.(com|de)$/i

export function imStatusFenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  return b.wochentag >= 1 && b.wochentag <= 5 && b.stunde >= 8 && b.stunde < 19
}

function adresse(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

type KundeZeile = {
  id: string
  bereich: string | null
  status: string | null
  privat_art?: string | null
  firma: string | null
  ansprechpartner: string | null
  verantwortlich: string | null
  verantwortlich_email: string | null
  dokumente?: { name?: string; datum?: string; quelle?: string }[] | null
}

const KUNDE_SPALTEN = 'id, bereich, status, privat_art, firma, ansprechpartner, verantwortlich, verantwortlich_email'

/** angabe: Text für den Anlass. sichtbarFuer: nur diese Adressen sehen die angabe (sonst angabeKurz, z. B. Termin ohne
 *  Titel). nurFuer: das Ereignis zählt nur für diesen Empfänger (Mail aus einem persönlichen Postfach). */
type Ereignis = { ereignis: StatusEreignis; angabe: string; angabeKurz?: string; sichtbarFuer?: string[]; nurFuer?: string }

function merke(je: Map<string, Ereignis[]>, kundeId: string | null | undefined, e: Ereignis): void {
  const id = String(kundeId ?? '')
  if (!id || SAMMELAKTEN.includes(id)) return
  const liste = je.get(id) ?? []
  if (!liste.some((x) => x.ereignis === e.ereignis)) liste.push(e)
  je.set(id, liste)
}

/** Ereignisse seit `seit` je Akte. Fehler einzelner Quellen landen in `fehler`. */
export async function sammleEreignisse(admin: Db, seit: Date, jetzt: Date, team: Person[], fehler: string[]): Promise<{ je: Map<string, Ereignis[]>; kunden: Map<string, KundeZeile> }> {
  const je = new Map<string, Ereignis[]>()
  const kunden = new Map<string, KundeZeile>()
  const seitIso = seit.toISOString()
  const jetztIso = jetzt.toISOString()
  const teamAdressen = new Set(team.map((m) => adresse(m.email)))

  // Termine in der Zukunft, die seitdem angelegt, geändert oder zugeordnet wurden.
  try {
    const { data, error } = await admin
      .from('termine')
      .select('id, titel, beginn, ganztags, kunde_id, besitzer_email, teilnehmer')
      .or(`erstellt_am.gte.${seitIso},geaendert_am.gte.${seitIso},zuordnung_geprueft_am.gte.${seitIso}`)
      .gte('beginn', jetztIso)
      .limit(1000)
    if (error) throw new Error(error.message)
    for (const t of (data ?? []) as { titel: string | null; beginn: string; ganztags: boolean | null; kunde_id: string | null; besitzer_email: string | null; teilnehmer: string[] | null }[]) {
      if (!t.kunde_id || istAbgesagterTitel(String(t.titel ?? ''))) continue
      // Den Titel sehen nur Besitzer und Teilnehmer — alle anderen nur „Termin am …“ (wie die Privat-Blöcke im Kalender).
      const wann = wannText(t.beginn, t.ganztags === true)
      const sichtbarFuer = [adresse(t.besitzer_email), ...(t.teilnehmer ?? []).map(adresse)].filter(Boolean)
      merke(je, t.kunde_id, { ereignis: 'termin', angabe: `„${String(t.titel ?? '').trim() || 'Termin'}“ am ${wann}`, angabeKurz: `am ${wann}`, sichtbarFuer })
    }
  } catch (err) {
    fehler.push(`Termine: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Kostenvoranschläge.
  try {
    const { data, error } = await admin.from('kostenvoranschlaege').select('id, kunde_id, name, erstellt_am').gte('erstellt_am', seitIso).limit(500)
    if (error) throw new Error(error.message)
    for (const kv of (data ?? []) as { kunde_id: string | null; name: string | null }[]) merke(je, kv.kunde_id, { ereignis: 'angebot', angabe: String(kv.name ?? '').trim() || 'Kostenvoranschlag' })
  } catch (err) {
    fehler.push(`Kostenvoranschläge: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Dokumente: Akten, die sich seitdem geändert haben, mit Dokumenten ab dem Tag des letzten Laufs.
  try {
    const seitTag = berlinZeit(seit).datum
    const { data, error } = await alleZeilen(() => admin.from('kunden').select(`${KUNDE_SPALTEN}, dokumente`).gte('updated_at', seitIso))
    if (error) throw new Error(error.message)
    for (const k of (data ?? []) as KundeZeile[]) {
      kunden.set(k.id, { ...k, dokumente: undefined })
      for (const d of Array.isArray(k.dokumente) ? k.dokumente : []) {
        if (String(d?.datum ?? '') < seitTag) continue
        const e = dokumentEreignis(d)
        if (e) merke(je, k.id, { ereignis: e, angabe: String(d.name ?? '') })
      }
    }
  } catch (err) {
    fehler.push(`Dokumente: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Antworten des Kunden: zugeordnete Mails, nachdem wir der Akte geschrieben hatten.
  try {
    const { data, error } = await admin
      .from('eingegangene_emails')
      .select('id, betreff, von, mail_datum, zugewiesener_kunde_id, besitzer_email')
      .or(`erstellt_am.gte.${seitIso},zuordnung_geprueft_am.gte.${seitIso}`)
      .limit(1000)
    if (error) throw new Error(error.message)
    for (const m of (data ?? []) as { betreff: string | null; von: string | null; mail_datum: string | null; zugewiesener_kunde_id: string | null; besitzer_email: string | null }[]) {
      const von = adresse(m.von)
      if (!m.zugewiesener_kunde_id || !m.mail_datum || !von || teamAdressen.has(von) || HOLDING.test(von)) continue
      if (je.get(m.zugewiesener_kunde_id)?.some((x) => x.ereignis === 'antwort')) continue
      const { data: vorher } = await admin.from('gesendete_emails').select('id').eq('kunde_id', m.zugewiesener_kunde_id).lt('gesendet_am', m.mail_datum).limit(1)
      if (!Array.isArray(vorher) || vorher.length === 0) continue
      // Mail aus einem persönlichen Postfach: zählt nur für ihren Besitzer (sonst sähe ein Kollege den Betreff).
      merke(je, m.zugewiesener_kunde_id, { ereignis: 'antwort', angabe: String(m.betreff ?? '').trim(), ...(m.besitzer_email ? { nurFuer: adresse(m.besitzer_email) } : {}) })
    }
  } catch (err) {
    fehler.push(`Antworten: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Fehlende Akten nachladen.
  const fehlen = [...je.keys()].filter((id) => !kunden.has(id))
  for (let i = 0; i < fehlen.length; i += 200) {
    const { data, error } = await admin.from('kunden').select(KUNDE_SPALTEN).in('id', fehlen.slice(i, i + 200))
    if (error) fehler.push(`Akten: ${error.message}`)
    for (const k of (data ?? []) as KundeZeile[]) kunden.set(k.id, k)
  }
  return { je, kunden }
}

function verantwortlicher(team: Person[], k: KundeZeile): Person | null {
  const a = adresse(k.verantwortlich_email)
  if (a) return team.find((m) => adresse(m.email) === a) ?? null
  const n = String(k.verantwortlich ?? '').trim().toLowerCase()
  return n ? team.find((m) => String(m.name ?? '').trim().toLowerCase() === n) ?? null : null
}

function akteName(k: KundeZeile): string {
  return String(k.firma ?? '').trim() || String(k.ansprechpartner ?? '').trim() || k.id
}

/** Akten, für die gerade kein neuer Vorschlag kommen darf (offen bzw. „Nein“ innerhalb von 7 Tagen). Alte offene verfallen. */
async function gesperrteAkten(admin: Db, ids: string[], jetzt: Date, schreiben: boolean): Promise<Set<string>> {
  const gesperrt = new Set<string>()
  const neinGrenze = new Date(jetzt.getTime() - NEIN_SPERRE_TAGE * TAG_MS).toISOString()
  const verfall = new Date(jetzt.getTime() - OFFEN_VERFALL_TAGE * TAG_MS).toISOString()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from(TABELLE).select('id, kunde_id, status, erstellt_am, erledigt_am').eq('art', 'status').in('kunde_id', ids.slice(i, i + 200))
    if (error) throw new Error(`Vorschläge nicht lesbar: ${error.message}`)
    for (const z of (data ?? []) as { id: string; kunde_id: string; status: string; erstellt_am: string; erledigt_am: string | null }[]) {
      if (z.status === 'offen' || z.status === 'laeuft') {
        if (z.status === 'offen' && z.erstellt_am < verfall) {
          if (schreiben) await admin.from(TABELLE).update({ status: 'veraltet', erledigt_am: jetzt.toISOString() }).eq('id', z.id).eq('status', 'offen')
          continue
        }
        gesperrt.add(z.kunde_id)
      }
      if (z.status === 'nein' && String(z.erledigt_am ?? '') >= neinGrenze) gesperrt.add(z.kunde_id)
    }
  }
  return gesperrt
}

/** Stellt den Stand weiter. Liefert den bisherigen Zeitpunkt (oder null beim ersten Lauf) bzw. false, wenn jetzt nicht dran. */
async function beanspruche(admin: Db, jetzt: Date): Promise<string | null | false> {
  const { data, error } = await admin.from(TABELLE).select('erledigt_am').eq('id', STATUS_STAND_ID).maybeSingle()
  if (error) throw new Error(`Stand nicht lesbar: ${error.message}`)
  if (!data) {
    const { error: anlegeFehler } = await admin.from(TABELLE).insert({ id: STATUS_STAND_ID, empfaenger_email: '-', art: 'lauf', bezug_id: '-', code: '-', status: 'erledigt', daten: {}, erledigt_am: jetzt.toISOString() })
    if (anlegeFehler) return false
    return null
  }
  const alt = data.erledigt_am ? String(data.erledigt_am) : null
  if (alt && jetzt.getTime() - Date.parse(alt) < ABSTAND_MS) return false
  let abfrage = admin.from(TABELLE).update({ erledigt_am: jetzt.toISOString() }).eq('id', STATUS_STAND_ID)
  abfrage = alt ? abfrage.eq('erledigt_am', alt) : abfrage.is('erledigt_am', null)
  const { data: neu, error: schreibFehler } = await abfrage.select('id')
  if (schreibFehler) throw new Error(`Stand nicht schreibbar: ${schreibFehler.message}`)
  return Array.isArray(neu) && neu.length > 0 ? alt : false
}

export async function pruefeStatusVorschlaege(admin: Db, o: { telegram?: TelegramApi; jetzt?: Date; trockenSeit?: Date } = {}): Promise<StatusLauf> {
  const r: StatusLauf = { gelaufen: false, vorschlaege: 0, gesendet: 0, fehler: [] }
  const jetzt = o.jetzt ?? new Date()
  const telegram = o.telegram ?? telegramMayerBot
  const trocken = !!o.trockenSeit
  try {
    if (!trocken && !imStatusFenster(jetzt)) return r
    const { data: einstellungZeile } = await admin.from(TABELLE).select('daten').eq('id', EINSTELLUNG_ID).maybeSingle()
    const einstellung = leseEinstellung(einstellungZeile?.daten)
    if (!trocken && !einstellung.statusAn) return r

    let seit: Date
    if (trocken) seit = o.trockenSeit!
    else {
      const alt = await beanspruche(admin, jetzt)
      if (alt === false) return r
      seit = alt ? new Date(Date.parse(alt) - UEBERLAPPUNG_MS) : new Date(jetzt.getTime() - TAG_MS)
    }
    r.gelaufen = true

    const { data: teamRoh, error: teamFehler } = await admin.from('mitarbeiter').select('name, email, rolle, ist_admin, bereiche, aktiv, telegram_chat_id, ist_superuser').eq('aktiv', true)
    if (teamFehler) throw new Error(`Mitarbeiter nicht lesbar: ${teamFehler.message}`)
    const team = ((teamRoh ?? []) as Person[]).filter((m) => m.email && m.name).map((m) => ({ ...m, email: adresse(m.email) }))

    const { je, kunden } = await sammleEreignisse(admin, seit, jetzt, team, r.fehler)
    if (je.size === 0) return r
    const gesperrt = await gesperrteAkten(admin, [...je.keys()], jetzt, !trocken)
    const jePerson = new Map<string, number>()

    for (const [kundeId, ereignisse] of je) {
      const k = kunden.get(kundeId)
      if (!k || gesperrt.has(kundeId)) continue
      const netz = statusNetzVon(k)
      const bestes = bestesZiel(netz, k.status, ereignisse.map((e) => e.ereignis))
      if (!bestes) continue
      const p = verantwortlicher(team, k)
      if (!p || !darfAkte(p, k)) continue
      if (!trocken && (!p.telegram_chat_id || !istEmpfaenger(einstellung, p))) continue
      const schon = jePerson.get(p.email) ?? 0
      if (!trocken && schon >= HOECHSTENS_JE_PERSON_UND_LAUF) continue
      const gewaehlt = ereignisse.find((e) => e.ereignis === bestes.ereignis)
      if (gewaehlt?.nurFuer && gewaehlt.nurFuer !== p.email) continue
      const angabe = !gewaehlt ? '' : gewaehlt.sichtbarFuer && !gewaehlt.sichtbarFuer.includes(p.email) ? gewaehlt.angabeKurz ?? '' : gewaehlt.angabe
      const daten: StatusDaten = {
        name: akteName(k),
        bereich: String(k.bereich ?? ''),
        netz,
        von: String(k.status ?? ''),
        nach: bestes.ziel,
        vonName: statusName(netz, k.status),
        nachName: statusName(netz, bestes.ziel),
        ereignis: bestes.ereignis,
        anlass: anlassText(bestes.ereignis, angabe),
      }
      r.vorschlaege++
      if (trocken) {
        ;(r.vorschau ??= []).push({ an: p.name, text: statusText(daten), knoepfe: statusKnoepfe('tv_vorschau', 'vorschau', daten.nachName).flat().map((x) => x.text) })
        continue
      }
      const id = neueKennung()
      const code = zufall(9)
      const { error: anlegeFehler } = await admin.from(TABELLE).insert({ id, empfaenger_email: p.email, art: 'status', bezug_id: k.id, kunde_id: k.id, daten, code, status: 'offen' })
      if (anlegeFehler) {
        r.fehler.push(`${akteName(k)}: Vorschlag nicht gespeichert (${anlegeFehler.message}).`)
        continue
      }
      jePerson.set(p.email, schon + 1)
      const nachricht = await telegram('sendMessage', { chat_id: p.telegram_chat_id, text: statusText(daten), reply_markup: { inline_keyboard: statusKnoepfe(id, code, daten.nachName) } })
      if (nachricht?.message_id) {
        r.gesendet++
        await admin.from(TABELLE).update({ telegram_nachricht: { chat: p.telegram_chat_id, id: nachricht.message_id } }).eq('id', id)
      } else {
        r.fehler.push(`${akteName(k)}: Nachricht an ${p.name} nicht zugestellt.`)
        await admin.from(TABELLE).update({ status: 'fehler', ergebnis: 'Nachricht nicht zugestellt', erledigt_am: jetzt.toISOString() }).eq('id', id)
      }
    }
  } catch (err) {
    r.fehler.push(err instanceof Error ? err.message : String(err))
  }
  if (r.fehler.length > 0) console.error('Statusvorschläge:', r.fehler.slice(0, 5).join(' | '))
  return r
}
