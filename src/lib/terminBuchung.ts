// Online-Terminbuchung: Aufrufe an den Server (email-gateway, Modul buchung.ts) und das Nachladen
// der Buchungsangaben (quelle, gast) zu Terminen im Kalender.
//
// - Einstellungen (nur die eigenen): buchung_einstellungen_laden / _speichern, mit Login.
// - Öffentliche Buchungsseite /formular/termin/:kennung: public_buchung_info / public_buchung_anlegen,
//   ohne Login. Alle Zeiten kommen als ISO-Zeitpunkte und werden in deutscher Zeit angezeigt.
import { call } from './emailGateway'
import { supabase } from './supabaseClient'

export type Zeitraum = [string, string]

export type BuchungsEinstellungen = {
  aktiv: boolean
  titel: string
  dauer_min: number
  puffer_min: number
  vorlauf_std: number
  tage_voraus: number
  /** ISO-Wochentag "1" (Montag) bis "7" (Sonntag) → Zeiträume ["HH:MM","HH:MM"]. */
  zeiten: Record<string, Zeitraum[]>
  ort: string
  hinweis: string
}

export const DAUER_WAHL = [15, 30, 45, 60, 90]
export const PUFFER_WAHL = [0, 5, 10, 15, 30]

export function buchungsLink(kennung: string): string {
  return `${window.location.origin}${window.location.pathname}#/formular/termin/${kennung}`
}

export async function ladeBuchungsEinstellungen(): Promise<{ buchung: BuchungsEinstellungen; kennung: string | null }> {
  const data = await call({ action: 'buchung_einstellungen_laden' })
  return { buchung: data.buchung, kennung: data.kennung ?? null }
}

export async function speichereBuchungsEinstellungen(buchung: BuchungsEinstellungen): Promise<{ buchung: BuchungsEinstellungen; kennung: string | null }> {
  const data = await call({ action: 'buchung_einstellungen_speichern', buchung })
  return { buchung: data.buchung, kennung: data.kennung ?? null }
}

// ---------- Öffentliche Buchungsseite ----------

export type BuchungsInfo = {
  name: string
  titel: string
  dauer_min: number
  ort: string
  hinweis: string
  /** Nur Tage mit freien Zeiten; datum = JJJJ-MM-TT (deutscher Kalendertag), zeiten = ISO-Zeitpunkte. */
  tage: { datum: string; zeiten: string[] }[]
}

export async function holeBuchungsInfo(kennung: string): Promise<BuchungsInfo> {
  const data = await call({ action: 'public_buchung_info', kennung })
  return {
    name: String(data.name ?? ''),
    titel: String(data.titel ?? ''),
    dauer_min: Number(data.dauer_min ?? 0),
    ort: String(data.ort ?? ''),
    hinweis: String(data.hinweis ?? ''),
    tage: Array.isArray(data.tage) ? data.tage : [],
  }
}

export type BuchungsAnfrage = {
  kennung: string
  beginn: string
  name: string
  email: string
  telefon?: string
  nachricht?: string
  /** Unsichtbares Feld gegen Programme — bei Menschen immer leer. */
  webseite: string
}

export async function legeBuchungAn(a: BuchungsAnfrage): Promise<{ beginn: string; ende: string; bestaetigungGesendet: boolean }> {
  const data = await call({ action: 'public_buchung_anlegen', ...a })
  return { beginn: data.beginn, ende: data.ende, bestaetigungGesendet: data.bestaetigungGesendet !== false }
}

// ---------- Kalender: Buchungsangaben zu den sichtbaren Terminen ----------

export type Gast = { name?: string; email?: string; telefon?: string; nachricht?: string; eingeladen?: boolean }
export type BuchungsZusatz = { quelle: string; gast: Gast | null }

/** Liest `quelle` und `gast` der Termine im Zeitraum (Zeilenschutz wie bei ladeTermine: nur eigene/gemeinsame). */
export async function ladeBuchungsZusatz(von: Date, bis: Date): Promise<Map<string, BuchungsZusatz>> {
  const karte = new Map<string, BuchungsZusatz>()
  if (!supabase) return karte
  const { data, error } = await supabase.from('termine').select('id, quelle, gast').lt('beginn', bis.toISOString()).gt('ende', von.toISOString())
  if (error) throw new Error(error.message)
  for (const t of (data ?? []) as { id: string; quelle: string | null; gast: Gast | null }[]) {
    karte.set(t.id, { quelle: t.quelle ?? '', gast: t.gast && typeof t.gast === 'object' ? t.gast : null })
  }
  return karte
}

export const WOCHENTAG_NAMEN: { nr: string; kurz: string; lang: string }[] = [
  { nr: '1', kurz: 'Mo', lang: 'Montag' },
  { nr: '2', kurz: 'Di', lang: 'Dienstag' },
  { nr: '3', kurz: 'Mi', lang: 'Mittwoch' },
  { nr: '4', kurz: 'Do', lang: 'Donnerstag' },
  { nr: '5', kurz: 'Fr', lang: 'Freitag' },
  { nr: '6', kurz: 'Sa', lang: 'Samstag' },
  { nr: '7', kurz: 'So', lang: 'Sonntag' },
]
