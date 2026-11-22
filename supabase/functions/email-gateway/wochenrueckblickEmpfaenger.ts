// Wer bekommt den Wochenrückblick? (Einstellung und Empfänger, aus wochenrueckblick.ts herausgelöst, 22.11.2026)
//
// Eigene Datei, damit tagesmeldung.ts und superuser.ts sie lesen können, ohne wochenrueckblick.ts zu laden
// (das wiederum beide einbindet). Grund: Freitags kamen bei Eray drei Berichte (Wochenbericht der
// Tagesmeldung, Superuser-Wochenbericht, Wochenrückblick). Wer den Wochenrückblick bekommt, bekommt die beiden
// anderen Wochenberichte nicht mehr — Superuser finden ihren Teil als Zusatz im Wochenrückblick.
//
// Einstellungszeile `abteilung_eintraege` id `wochenrueckblick_einstellung`
//   daten = { an, berichtAn: [E-Mails], wochentag (0 = Sonntag … 6 = Samstag), stunde, zusammenfassung }
// Empfänger = aktive Mitarbeiter mit Geschäftsführung- oder Admin-Recht UND verbundenem Telegram, die in
// `berichtAn` stehen — und nur, solange der Rückblick eingeschaltet ist.

import { personenNamen } from '../_shared/aufgabenKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

const TABELLE = 'abteilung_eintraege'
export const EINSTELLUNG_ID = 'wochenrueckblick_einstellung'

export type Einstellung = { an: boolean; berichtAn: string[]; wochentag: number; stunde: number; zusammenfassung: boolean; geaendertVon?: string; geaendertAm?: string }
export const VORGABE: Einstellung = { an: true, berichtAn: [], wochentag: 5, stunde: 16, zusammenfassung: true }

function alsObjekt(w: unknown): Record<string, unknown> | null {
  return w && typeof w === 'object' && !Array.isArray(w) ? (w as Record<string, unknown>) : null
}

function text(w: unknown): string {
  return typeof w === 'string' ? w : w == null ? '' : String(w)
}

function adresse(w: unknown): string {
  return text(w).trim().toLowerCase()
}

export function normalisiereEinstellung(roh: unknown): Einstellung {
  const o = alsObjekt(roh) ?? {}
  const wt = Number(o.wochentag)
  const st = Number(o.stunde)
  return {
    an: o.an !== false,
    berichtAn: Array.isArray(o.berichtAn) ? [...new Set(o.berichtAn.map(adresse).filter((a) => a.includes('@')))] : [],
    wochentag: Number.isInteger(wt) && wt >= 0 && wt <= 6 ? wt : VORGABE.wochentag,
    stunde: Number.isInteger(st) && st >= 0 && st <= 23 ? st : VORGABE.stunde,
    zusammenfassung: o.zusammenfassung !== false,
    ...(typeof o.geaendertVon === 'string' ? { geaendertVon: o.geaendertVon } : {}),
    ...(typeof o.geaendertAm === 'string' ? { geaendertAm: o.geaendertAm } : {}),
  }
}

export async function ladeEinstellung(admin: Db): Promise<Einstellung> {
  const { data, error } = await admin.from(TABELLE).select('daten').eq('id', EINSTELLUNG_ID).maybeSingle()
  if (error) throw new Error(`Einstellung nicht lesbar: ${error.message}`)
  return data ? normalisiereEinstellung(data.daten) : { ...VORGABE }
}

export type Empfaenger = { name: string; email: string; chat: number | string | null; erlaubt: boolean }

/** Alle aktiven Mitarbeiter mit Geschäftsführung- oder Admin-Recht (erlaubt = mit Telegram). */
export async function moeglicheEmpfaenger(admin: Db): Promise<Empfaenger[]> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, aktiv, rolle, ist_admin, telegram_chat_id').eq('aktiv', true)
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  const echte = new Set(personenNamen(((data ?? []) as { name: string }[]).map((m) => text(m.name))))
  return ((data ?? []) as { name: string; email: string; aktiv: boolean; rolle: string; ist_admin: boolean; telegram_chat_id: number | string | null }[])
    .filter((m) => m.aktiv === true && (m.rolle === 'geschaeftsfuehrung' || m.ist_admin === true) && echte.has(text(m.name).trim()))
    .map((m) => ({ name: m.name, email: adresse(m.email), chat: m.telegram_chat_id ?? null, erlaubt: !!m.telegram_chat_id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Die Empfänger laut Einstellung (ohne Blick auf „an“). */
export async function empfaengerAus(admin: Db, e: Einstellung): Promise<Empfaenger[]> {
  if (e.berichtAn.length === 0) return []
  return (await moeglicheEmpfaenger(admin)).filter((m) => m.erlaubt && e.berichtAn.includes(m.email))
}

/**
 * Adressen (klein geschrieben) aller, die den Wochenrückblick tatsächlich bekommen. Für tagesmeldung.ts und
 * superuser.ts: diese Personen bekommen deren Wochenberichte nicht zusätzlich. Ausgeschaltet → leere Menge.
 * Wirft, wenn Einstellung oder Mitarbeiter nicht lesbar sind (lieber im nächsten Takt erneut als doppelt senden).
 */
export async function wochenrueckblickAdressen(admin: Db): Promise<Set<string>> {
  const e = await ladeEinstellung(admin)
  if (!e.an) return new Set()
  return new Set((await empfaengerAus(admin, e)).map((m) => m.email))
}
