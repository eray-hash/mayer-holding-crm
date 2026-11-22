// Mahnvorschläge „Mahnen, ohne es zu vergessen“ (22.11.2026) — Tageslauf ab 9 Uhr Berliner Zeit.
// Regeln in _shared/mahnVorschlagKern.ts; diese Datei schreibt die Tabelle mahn_vorschlaege und benachrichtigt.
//
// Ablauf (einmal am Tag, vom Minutentakt gerufen; vor 9 Uhr und außerhalb jeder fünften Minute ohne Datenbankzugriff):
//   1. Den Tag beanspruchen: mahn_einstellung.letzter_lauf wird mit einer bedingten Änderung auf heute gesetzt — nur wer
//      das schafft, läuft (nie doppelt, auch bei parallelen Takten). Ist die Einstellung aus (aktiv = false), läuft nichts.
//   2. Erledigte Vorschläge abhaken (bezahlt → erledigt; Schreiben im CRM erstellt → gesendet).
//   3. Neue Vorschläge anlegen (id = <rechnung>:<stufe>; Anlage = Anspruch, doppelte scheitert am Primärschlüssel) und
//      abgelaufene Zurückstellungen wieder öffnen (bedingte Änderung — nur einmal).
//   4. Je Empfänger EINE Telegram-Nachricht für alles, was in diesem Lauf neu angelegt oder wieder geöffnet wurde.
//      Empfänger: der Verantwortliche der Akte (kunden.verantwortlich_email), wenn er aktiv ist, Telegram verbunden hat
//      und die Akte sehen darf; sonst die Geschäftsführung (bei privaten Akten nur der Besitzer). Einstellung je
//      Mitarbeiter in mahn_vorschlag_hinweis (keine Zeile = an). Kein erneutes Senden bei Fehlschlag.
// An Kunden wird NIE etwas geschickt. Wirft nie.

import { CRM_BASIS_STANDARD } from '../_shared/kundenberichtKern.ts'
import {
  akteName,
  EINSTELLUNG_TABELLE,
  grundText,
  HINWEIS_TABELLE,
  hinweisText,
  ladeMahnLage,
  vorschlagId,
  VORSCHLAG_TABELLE,
  type AkteKurz,
  type HinweisEintrag,
  type LageOptionen,
} from '../_shared/mahnVorschlagKern.ts'
import { darfAkte, darfBereich, istPrivat, type RechteMitarbeiter } from '../telegram-gateway/rechte.ts'
import { berlinZeit } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>

export type MahnLauf = {
  gelaufen: boolean
  neu: number
  wieder: number
  gesendet: number
  erledigt: number
  uebersprungen: number
  nachrichten: number
  fehler: string[]
}

export const AB_STUNDE = 9

/** Tag, an dem dieser Arbeiter schon gelaufen ist (spart die Anspruchs-Abfrage in den übrigen Takten des Tages). */
let schonGelaufenAm = ''

/** Nur für Tests: Gedächtnis des Arbeiters vergessen. */
export function vergiss(): void {
  schonGelaufenAm = ''
}

type Person = RechteMitarbeiter & { email: string; chat: number | string }

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

/** Wer bekommt die Nachricht zu einer Rechnung dieser Akte? */
export function empfaengerFuer(akte: AkteKurz | undefined, team: Person[]): Person[] {
  const darf = (p: Person) => darfBereich(p, 'beratung') && (!akte || darfAkte(p, akte))
  const verantwortlich = text(akte?.verantwortlich_email).toLowerCase()
  const v = verantwortlich ? team.find((p) => p.email === verantwortlich && darf(p)) : undefined
  if (v) return [v]
  if (akte && istPrivat(akte)) return []
  return team.filter((p) => p.rolle === 'geschaeftsfuehrung' && darf(p))
}

/** Vom Minutentakt gerufen: ab 9 Uhr Berliner Zeit, alle fünf Minuten ein Versuch, gearbeitet wird einmal am Tag. */
export async function pruefeMahnVorschlaege(admin: Db, sende: SendeFunktion, jetzt: Date = new Date(), optionen: LageOptionen & { immer?: boolean } = {}): Promise<MahnLauf> {
  const lauf: MahnLauf = { gelaufen: false, neu: 0, wieder: 0, gesendet: 0, erledigt: 0, uebersprungen: 0, nachrichten: 0, fehler: [] }
  const b = berlinZeit(jetzt)
  if (!optionen.immer && (b.stunde < AB_STUNDE || b.minute % 5 !== 0)) return lauf
  const heute = b.datum
  if (schonGelaufenAm === heute) return lauf
  try {
    // 1. Tag beanspruchen.
    const { data: anspruch, error: aFehler } = await admin
      .from(EINSTELLUNG_TABELLE)
      .update({ letzter_lauf: heute })
      .eq('id', 1)
      .eq('aktiv', true)
      .or(`letzter_lauf.is.null,letzter_lauf.lt.${heute}`)
      .select('id')
    if (aFehler) throw new Error(`${EINSTELLUNG_TABELLE}: ${aFehler.message}`)
    schonGelaufenAm = heute
    if (!Array.isArray(anspruch) || anspruch.length === 0) return lauf
    lauf.gelaufen = true

    const lage = await ladeMahnLage(admin, heute, optionen)
    const { plan, akten } = lage
    const jetztIso = jetzt.toISOString()
    lauf.uebersprungen = plan.uebersprungen.length

    // 2. Erledigtes abhaken.
    for (const a of plan.abschliessen) {
      const { error } = await admin
        .from(VORSCHLAG_TABELLE)
        .update({ status: a.status, erledigt_am: jetztIso, erledigt_von: a.von, geaendert_am: jetztIso })
        .eq('id', a.zeile.id)
        .eq('status', a.zeile.status)
      if (error) lauf.fehler.push(`${a.zeile.id}: ${error.message}`)
      else if (a.status === 'gesendet') lauf.gesendet++
      else lauf.erledigt++
    }

    // 3. Neu anlegen und wieder öffnen.
    const zuMelden: (HinweisEintrag & { kundeId: string | null })[] = []
    for (const f of plan.neu) {
      const r = f.rechnung
      const akte = r.kunde_id ? akten.get(r.kunde_id) : undefined
      const id = vorschlagId(r.id, f.stufe)
      const { error } = await admin.from(VORSCHLAG_TABELLE).insert({
        id,
        rechnung_id: r.id,
        stufe: f.stufe,
        kunde_id: r.kunde_id || null,
        kunde_bereich: akte?.bereich ?? null,
        rechnung_nummer: r.nummer,
        tage_ueberfaellig: f.tage,
        offen: f.offen,
        status: 'offen',
        grund: grundText(f, r),
        erstellt_am: jetztIso,
        geaendert_am: jetztIso,
      })
      if (error) {
        if (error.code !== '23505') lauf.fehler.push(`${id}: ${error.message}`)
        continue
      }
      lauf.neu++
      zuMelden.push({ id, nummer: r.nummer, kunde: akteName(akte), stufe: f.stufe, tage: f.tage, offen: f.offen, kundeId: r.kunde_id })
    }
    for (const w of plan.reaktivieren) {
      const r = w.rechnung
      const { data, error } = await admin
        .from(VORSCHLAG_TABELLE)
        .update({ status: 'offen', tage_ueberfaellig: w.tage, offen: w.offen, grund: grundText(w, r), geaendert_am: jetztIso })
        .eq('id', w.zeile.id)
        .eq('status', 'zurueckgestellt')
        .select('id')
      if (error) {
        lauf.fehler.push(`${w.zeile.id}: ${error.message}`)
        continue
      }
      if (!Array.isArray(data) || data.length === 0) continue
      lauf.wieder++
      const akte = r.kunde_id ? akten.get(r.kunde_id) : undefined
      zuMelden.push({ id: w.zeile.id, nummer: r.nummer, kunde: akteName(akte), stufe: w.stufe, tage: w.tage, offen: w.offen, wieder: true, kundeId: r.kunde_id })
    }
    if (zuMelden.length === 0) return lauf

    // 4. Benachrichtigen — je Empfänger eine Nachricht.
    const [{ data: leute, error: tFehler }, { data: einst, error: hFehler }] = await Promise.all([
      admin.from('mitarbeiter').select('email, name, rolle, ist_admin, aktiv, bereiche, telegram_chat_id').eq('aktiv', true),
      admin.from(HINWEIS_TABELLE).select('email, aktiv'),
    ])
    if (tFehler) throw new Error(`mitarbeiter: ${tFehler.message}`)
    // Lieber gar nicht senden als an jemanden, der abgeschaltet hat.
    if (hFehler) throw new Error(`${HINWEIS_TABELLE}: ${hFehler.message}`)
    const aus = new Set(((einst ?? []) as { email: string; aktiv: boolean | null }[]).filter((z) => z.aktiv === false).map((z) => text(z.email).toLowerCase()))
    const team: Person[] = []
    // deno-lint-ignore no-explicit-any
    for (const m of (leute ?? []) as any[]) {
      const email = text(m.email).toLowerCase()
      const chat = m.telegram_chat_id
      if (!email || chat === null || chat === undefined || chat === '') continue
      team.push({ email, chat, name: m.name, rolle: m.rolle, ist_admin: m.ist_admin, bereiche: Array.isArray(m.bereiche) ? m.bereiche : [] })
    }
    const jePerson = new Map<string, { person: Person; eintraege: HinweisEintrag[] }>()
    for (const e of zuMelden) {
      for (const p of empfaengerFuer(e.kundeId ? akten.get(e.kundeId) : undefined, team)) {
        if (aus.has(p.email)) continue
        const g = jePerson.get(p.email) ?? { person: p, eintraege: [] }
        g.eintraege.push(e)
        jePerson.set(p.email, g)
      }
    }
    if (jePerson.size === 0) return lauf
    const { data: wk } = await admin.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle()
    const basis = text(wk?.link_basis) || CRM_BASIS_STANDARD
    for (const { person, eintraege } of jePerson.values()) {
      const ok = await sende(person.chat, hinweisText(eintraege, basis)).catch(() => false)
      if (!ok) {
        lauf.fehler.push(`Mahnhinweis an ${person.email}: Telegram-Versand fehlgeschlagen.`)
        continue
      }
      lauf.nachrichten++
      const { error } = await admin.from(VORSCHLAG_TABELLE).update({ empfaenger: person.email, benachrichtigt_am: jetztIso }).in('id', eintraege.map((e) => e.id))
      if (error) lauf.fehler.push(`Empfänger vermerken: ${error.message}`)
    }
  } catch (err) {
    lauf.fehler.push(err instanceof Error ? err.message : String(err))
  }
  if (lauf.fehler.length) console.error('Mahnvorschläge:', lauf.fehler.join(' | '))
  return lauf
}
