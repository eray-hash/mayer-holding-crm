// Wochenhinweis „Was fehlt noch in deinen Objektakten?“ per Telegram (22.11.2026).
//
// - Montags beim ersten Minutentakt ab 8:30 Uhr Berliner Zeit (spätestens bis 11 Uhr; ein verpasster Montag
//   wird nicht nachgeholt) — nach der Morgen-Übersicht (8 Uhr, tagesmeldung.ts), damit es nicht eine
//   einzige lange Nachricht wird.
// - Empfänger: jeder aktive Mitarbeiter mit Telegram, der für Objekte in Vorbereitung oder Vermarktung
//   verantwortlich ist (objekte.verantwortlich, Namen wie in /aufgaben über ordneZu), denen laut
//   _shared/objektVollstaendigkeit.ts noch etwas fehlt. Private Objekte nur an ihren Besitzer; Objekte der
//   Holding nur an Mitarbeiter mit Rechten für Immobilien. Ist nichts offen, kommt keine Nachricht.
// - Einstellung je Mitarbeiter: Tabelle objekt_luecken_hinweis (aktiv; keine Zeile = an). Abschalten im CRM
//   (Objektliste) oder beim Assistenten (objekt_luecken mit wochenhinweis=false).
// - Höchstens einmal pro Woche: letzte_woche (Datum des Montags) wird VOR dem Senden mit einer bedingten
//   Änderung gesetzt (bzw. die Zeile angelegt); laufen zwei Takte gleichzeitig, gewinnt nur einer.
// - Nur Namen der Objekte und was fehlt — keine Inhalte. Wirft nie.

import { ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { CRM_BASIS_STANDARD } from '../_shared/kundenberichtKern.ts'
import { eingabeAusZeile, fehlendKurz, istUnvollstaendig, PHASE_TEXT, pruefeVollstaendigkeit, VOLLSTAENDIGKEIT_SPALTEN, type Vollstaendigkeit } from '../_shared/objektVollstaendigkeit.ts'
import { berlinZeit } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>
export type LueckenHinweisErgebnis = { gelaufen: boolean; gesendet: number; meldungen: string[] }

export const HINWEIS_TABELLE = 'objekt_luecken_hinweis'
const AB_MINUTEN = 8 * 60 + 30
const BIS_STUNDE = 11
const AKTIVE_STATUS = ['vorbereitung', 'vermarktung']
const HOECHSTENS_OBJEKTE = 10

/** Montag zwischen 8:30 und 10:59 Uhr Berliner Zeit? */
export function imHinweisFenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  const minuten = b.stunde * 60 + b.minute
  return b.wochentag === 1 && minuten >= AB_MINUTEN && b.stunde < BIS_STUNDE
}

type Person = { email: string; name: string; chat: number | string; immobilien: boolean }
export type HinweisEintrag = { id: string; bezeichnung: string; v: Vollstaendigkeit }

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

/** Die Nachricht für eine Person. */
export function hinweisText(eintraege: HinweisEintrag[], basis: string): string {
  const b = basis.endsWith('/') ? basis : `${basis}/`
  const gezeigt = eintraege.slice(0, HOECHSTENS_OBJEKTE)
  return [
    `Wochenhinweis Objektakten — bei ${eintraege.length === 1 ? 'einem deiner Objekte' : `${eintraege.length} deiner Objekte`} fehlt noch etwas:`,
    ...gezeigt.map((e) => `• ${e.bezeichnung} (${PHASE_TEXT[e.v.phase]}, ${e.v.prozent} %): ${fehlendKurz(e.v, 4)}`),
    eintraege.length > gezeigt.length ? `… und ${eintraege.length - gezeigt.length} weitere.` : '',
    `Im CRM: ${b}#/immobilien?unvollstaendig=1`,
    'Abschalten: dem Assistenten „Wochenhinweis Objekte aus“ schreiben oder in der Objektliste den Haken entfernen.',
  ].filter(Boolean).join('\n')
}

/** Vom Minutentakt (Aktion termin_erinnerungen) gerufen. Außerhalb des Fensters ohne Datenbankzugriff. */
export async function pruefeObjektLueckenHinweis(admin: Db, sende: SendeFunktion, jetzt: Date = new Date()): Promise<LueckenHinweisErgebnis> {
  const ergebnis: LueckenHinweisErgebnis = { gelaufen: false, gesendet: 0, meldungen: [] }
  if (!imHinweisFenster(jetzt)) return ergebnis
  try {
    const montag = berlinZeit(jetzt).datum
    const [{ data: leute, error: teamFehler }, { data: einst, error: einstFehler }] = await Promise.all([
      admin.from('mitarbeiter').select('name, email, rolle, ist_admin, aktiv, bereiche, telegram_chat_id').eq('aktiv', true),
      admin.from(HINWEIS_TABELLE).select('email, aktiv, letzte_woche'),
    ])
    if (teamFehler) throw new Error(`mitarbeiter: ${teamFehler.message}`)
    // Lieber gar nicht senden als an jemanden, der abgeschaltet hat.
    if (einstFehler) throw new Error(`${HINWEIS_TABELLE}: ${einstFehler.message}`)
    const einstellung = new Map<string, { aktiv: boolean; letzte: string }>()
    for (const z of (einst ?? []) as { email: string; aktiv: boolean | null; letzte_woche: string | null }[]) {
      einstellung.set(text(z.email).toLowerCase(), { aktiv: z.aktiv !== false, letzte: text(z.letzte_woche).slice(0, 10) })
    }
    // deno-lint-ignore no-explicit-any
    const alleNamen = personenNamen(((leute ?? []) as any[]).map((m) => text(m.name)).filter(Boolean))
    const offen: Person[] = []
    // deno-lint-ignore no-explicit-any
    for (const m of (leute ?? []) as any[]) {
      const email = text(m.email).toLowerCase()
      const chat = m.telegram_chat_id
      if (!email || chat === null || chat === undefined || chat === '') continue
      const e = einstellung.get(email)
      if (e && (!e.aktiv || e.letzte >= montag)) continue
      const gf = m.rolle === 'geschaeftsfuehrung' || m.ist_admin === true
      offen.push({ email, name: text(m.name), chat, immobilien: gf || (Array.isArray(m.bereiche) && m.bereiche.includes('immobilien')) })
    }
    if (offen.length === 0) return ergebnis
    ergebnis.gelaufen = true

    const { data: objekte, error: objFehler } = await admin.from('objekte').select(VOLLSTAENDIGKEIT_SPALTEN).in('status', AKTIVE_STATUS).limit(2000)
    if (objFehler) throw new Error(`objekte: ${objFehler.message}`)
    const bewertet = ((objekte ?? []) as Record<string, unknown>[])
      .map((o) => ({ o, v: pruefeVollstaendigkeit(eingabeAusZeile(o)) }))
      .filter((x) => istUnvollstaendig(x.v))
    if (bewertet.length === 0) return ergebnis

    const { data: wk } = await admin.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle()
    const basis = text(wk?.link_basis) || CRM_BASIS_STANDARD

    for (const p of offen) {
      const meine: HinweisEintrag[] = bewertet
        .filter(({ o }) => {
          const besitzer = text(o.privat_besitzer).toLowerCase()
          if (besitzer) return besitzer === p.email
          if (!p.immobilien) return false
          const v = text(o.verantwortlich)
          return ordneZu(v, alleNamen).personen.includes(p.name) || v.toLowerCase() === p.name.toLowerCase()
        })
        .map(({ o, v }) => ({ id: text(o.id), bezeichnung: text(o.bezeichnung) || text(o.id), v }))
        .sort((a, b) => (a.v.phase === b.v.phase ? (a.v.prozent ?? 0) - (b.v.prozent ?? 0) : a.v.phase === 'vermarktung' ? -1 : 1))
      if (meine.length === 0) continue

      // Erst die Woche beanspruchen, dann senden: so kommt der Hinweis nie zweimal.
      if (!(await beanspruche(admin, p.email, einstellung.has(p.email), montag))) continue
      try {
        if (await sende(p.chat, hinweisText(meine, basis)).catch(() => false)) ergebnis.gesendet++
        else ergebnis.meldungen.push(`Objekt-Wochenhinweis an ${p.email}: Telegram-Versand fehlgeschlagen.`)
      } catch (err) {
        ergebnis.meldungen.push(`Objekt-Wochenhinweis an ${p.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    console.error('Objekt-Wochenhinweis fehlgeschlagen:', err)
    ergebnis.meldungen.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}

/** Setzt letzte_woche auf diesen Montag — nur, wenn es noch niemand getan hat. true = wir dürfen senden. */
async function beanspruche(admin: Db, email: string, hatZeile: boolean, montag: string): Promise<boolean> {
  if (!hatZeile) {
    const { error } = await admin.from(HINWEIS_TABELLE).insert({ email, aktiv: true, letzte_woche: montag })
    if (!error) return true
    if (error.code !== '23505') throw new Error(`${HINWEIS_TABELLE}: ${error.message}`)
    // Gerade von einem anderen Lauf (oder dem Mitarbeiter selbst) angelegt: weiter mit der bedingten Änderung.
  }
  const { data, error } = await admin
    .from(HINWEIS_TABELLE)
    .update({ letzte_woche: montag })
    .eq('email', email)
    .eq('aktiv', true)
    .or(`letzte_woche.is.null,letzte_woche.lt.${montag}`)
    .select('email')
  if (error) throw new Error(`${HINWEIS_TABELLE}: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}
