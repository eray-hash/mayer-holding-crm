// Wöchentliche Erinnerung „Statusbericht ist fertig — prüfen und senden“ (22.11.2026).
//
// Je Akte lässt sich im CRM (Fenster „Statusbericht an Kunden“) ein Wochentag einstellen
// (Tabelle kundenbericht_einstellung, Vorgabe aus). Dazu gibt es einen Schalter für alle
// (kundenbericht_schalter, Vorgabe AUS; ändern nur Geschäftsführung/Superuser).
//
// Läuft im Minutentakt (Aktion termin_erinnerungen). Am eingestellten Wochentag beim ersten Takt ab 8 Uhr
// Berliner Zeit (spätestens bis 11 Uhr; ein verpasster Morgen wird nicht nachgeholt) bekommt der
// Verantwortliche der Akte eine Telegram-Nachricht mit Kurzfassung und Link auf die Akte — der Link öffnet
// das Fenster gleich. Dem KUNDEN schickt der Server nie etwas: Gesendet wird nur im CRM nach Prüfung.
//
// - Außerhalb des Zeitfensters ohne Datenbankzugriff.
// - Höchstens einmal je Akte und Tag: letzter_hinweis wird VOR dem Senden mit einer bedingten Änderung
//   auf heute gesetzt; laufen zwei Takte gleichzeitig, gewinnt nur einer.
// - Empfänger: der Mitarbeiter, dessen Name in kunden.verantwortlich steht (mit Telegram); sonst, wer die
//   Erinnerung eingeschaltet hat (geaendert_von). Ist keiner erreichbar, steht das im Protokoll.
// - Abgeschlossene oder verlorene Fälle bekommen keine Erinnerung.
// - Wirft nie: Fehler stehen im Protokoll.

import { akteLink, CRM_BASIS_STANDARD, erstelleKundenbericht, kurzfassung, ladeBerichtDaten, standardSeit } from '../_shared/kundenberichtKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>
export type KundenberichtErgebnis = { gelaufen: boolean; erinnert: number; ohneEmpfaenger: number; meldungen: string[] }

const AB = 8
const BIS = 11
const VORBEI = new Set(['verloren', 'nicht_qualifiziert', 'abgebrochen', 'abgeschlossen'])
const HOECHSTENS = 50

const BERLIN = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })

/** Datum, Stunde und Wochentag (1 = Montag … 7 = Sonntag) in Berlin. */
export function berlinJetzt(jetzt: Date): { datum: string; stunde: number; wochentag: number } {
  const t: Record<string, string> = {}
  for (const p of BERLIN.formatToParts(jetzt)) t[p.type] = p.value
  const datum = `${t.year}-${t.month}-${t.day}`
  const wt = new Date(`${datum}T12:00:00Z`).getUTCDay()
  return { datum, stunde: Number(t.hour) % 24, wochentag: wt === 0 ? 7 : wt }
}

function akteName(k: { firma?: string | null; ansprechpartner?: string | null }): string {
  const f = String(k.firma ?? '').trim()
  const p = String(k.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

export async function pruefeKundenberichte(admin: Db, sende: SendeFunktion, jetzt = new Date()): Promise<KundenberichtErgebnis> {
  const ergebnis: KundenberichtErgebnis = { gelaufen: false, erinnert: 0, ohneEmpfaenger: 0, meldungen: [] }
  const z = berlinJetzt(jetzt)
  if (z.stunde < AB || z.stunde >= BIS) return ergebnis
  try {
    const { data: schalter } = await admin.from('kundenbericht_schalter').select('aktiv').eq('id', 1).maybeSingle()
    if (!schalter?.aktiv) return ergebnis
    ergebnis.gelaufen = true
    const offen = `letzter_hinweis.is.null,letzter_hinweis.lt.${z.datum}`
    const { data: faellige, error } = await admin
      .from('kundenbericht_einstellung')
      .select('kunde_id, bereich, geaendert_von')
      .eq('aktiv', true)
      .eq('wochentag', z.wochentag)
      .or(offen)
      .limit(HOECHSTENS)
    if (error) throw new Error(error.message)
    if (!faellige || faellige.length === 0) return ergebnis

    const [{ data: leute }, { data: wk }] = await Promise.all([
      admin.from('mitarbeiter').select('name, aktiv, telegram_chat_id').eq('aktiv', true),
      admin.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle(),
    ])
    const team = ((leute ?? []) as { name: string | null; telegram_chat_id: number | string | null }[])
      .map((m) => ({ name: String(m.name ?? '').trim(), chat: m.telegram_chat_id }))
      .filter((m) => m.name && m.chat !== null && m.chat !== undefined && m.chat !== '')
    const finde = (name: string | null | undefined) => {
      const n = String(name ?? '').trim().toLowerCase()
      return n ? team.find((m) => m.name.toLowerCase() === n) ?? null : null
    }
    const basis = String(wk?.link_basis || CRM_BASIS_STANDARD)

    for (const e of faellige as { kunde_id: string; bereich: string; geaendert_von: string | null }[]) {
      // Erst beanspruchen, dann senden: so kommt dieselbe Erinnerung nie zweimal am Tag.
      const { data: beansprucht } = await admin
        .from('kundenbericht_einstellung')
        .update({ letzter_hinweis: z.datum })
        .eq('kunde_id', e.kunde_id)
        .or(offen)
        .select('kunde_id')
      if (!beansprucht || beansprucht.length === 0) continue
      try {
        const daten = await ladeBerichtDaten(admin, e.kunde_id)
        if (!daten) {
          ergebnis.meldungen.push(`Akte ${e.kunde_id} gibt es nicht mehr.`)
          continue
        }
        if (VORBEI.has(String(daten.akte.status ?? ''))) continue
        const an = finde(daten.akte.verantwortlich) ?? finde(e.geaendert_von)
        if (!an) {
          ergebnis.ohneEmpfaenger++
          ergebnis.meldungen.push(`Statusbericht ${e.kunde_id}: niemand mit Telegram erreichbar.`)
          continue
        }
        const bericht = erstelleKundenbericht({ ...daten, heute: z.datum, seit: standardSeit(daten.akte, daten.letzterVersand, z.datum) })
        const text = [
          `Statusbericht für ${akteName(daten.akte)} ist fertig — bitte prüfen und senden.`,
          kurzfassung(bericht),
          akteLink(basis, daten.akte.bereich || e.bereich, e.kunde_id),
          'An den Kunden geht nichts von selbst — erst, wenn du im CRM auf „Per E-Mail senden“ klickst.',
        ].join('\n')
        if (await sende(an.chat as number | string, text).catch(() => false)) ergebnis.erinnert++
        else ergebnis.meldungen.push(`Statusbericht ${e.kunde_id}: Telegram-Versand fehlgeschlagen.`)
      } catch (err) {
        ergebnis.meldungen.push(`Statusbericht ${e.kunde_id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    console.error('Statusbericht-Erinnerungen fehlgeschlagen:', err)
    ergebnis.meldungen.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}
