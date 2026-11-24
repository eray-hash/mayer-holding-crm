// Stand und Schalter der automatischen Nachrichten (24.11.2026) — Browser-Seite der Server-Aktionen
// `automatik_stand` (lesen) und `automatik_schalter` (ändern, nur Geschäftsführung/Superuser), siehe
// email-gateway/automatik.ts. Antwortet der Server (noch) nicht, liest die Seite, was der Browser selbst lesen darf
// (Regeln der automatischen Mails, Wiedervorlage-Regeln, Willkommens-Schalter) — dann ist `quelle` 'ersatz'.
import { supabase } from '../supabaseClient'
import { callAuthenticated } from '../emailGateway'
import { setzeAutoRegel } from '../autoNachrichten'
import { setzeWillkommenEinstellung } from '../willkommen'
import { getStatusMap } from '../../data/statusNetworks'
import { PROJEKT_BEREICH_LABEL } from '../../types/project'
import type { Bereich } from '../../types'
import type { AutomatikEintrag } from './katalog'

export type SchalterWert = boolean | 'aus' | 'superuser' | 'alle'

export type SchalterStand = {
  wert: SchalterWert
  uhrzeit?: string
  wartezeitMinuten?: number | null
  empfaenger?: string[]
  geaendertVon?: string
  geaendertAm?: string
}

export type RegelStand = {
  id: string
  bereich?: string
  titel: string
  aktiv: boolean
  wartezeitMinuten: number | null
  anWen?: string
  vorlageId: string
}

export type WvRegelStand = {
  id: string
  bereich?: string
  ausloeser: string
  titel: string
  tage: number
  schliesst: string[]
  aktiv: boolean
  sortierung: number
}

export type AutomatikStand = {
  schalter: Record<string, SchalterStand>
  regeln: RegelStand[]
  wvRegeln: WvRegelStand[]
  /** 'server' = vollständiger Stand vom Server; 'ersatz' = nur, was der Browser selbst lesen kann. */
  quelle: 'server' | 'ersatz'
}

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

/** Fehlermeldungen verständlich auf Deutsch. */
export function fehlerText(e: unknown, vorgabe = 'Das hat nicht geklappt.'): string {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (!m) return vorgabe
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Keine Verbindung zum Server. Bitte später noch einmal versuchen.'
  if (/unknown action|unbekannte aktion/i.test(m)) return 'Der Server kennt diese Einstellung noch nicht.'
  if (/row-level security|permission denied|not allowed|forbidden/i.test(m)) return 'Das darf nur die Geschäftsführung ändern.'
  // Englische Rohmeldungen (Datenbank, Netz) nicht zeigen — nur in der Konsole.
  if (/\b(the|is|not|error|invalid|failed|column|relation|does)\b/i.test(m) && !/[äöüß]/i.test(m)) {
    console.warn('Automatische Nachrichten:', m)
    return vorgabe
  }
  return m
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function regelAus(z: any): RegelStand {
  return {
    id: String(z.id),
    bereich: z.bereich ?? undefined,
    titel: z.titel ?? String(z.id),
    aktiv: !!z.aktiv,
    wartezeitMinuten: z.wartezeitMinuten ?? z.wartezeit_minuten ?? null,
    anWen: z.anWen ?? z.an_wen ?? undefined,
    vorlageId: z.vorlageId ?? z.vorlage_id ?? '',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wvRegelAus(z: any): WvRegelStand {
  return {
    id: String(z.id),
    bereich: z.bereich ?? undefined,
    ausloeser: z.ausloeser ?? '',
    titel: z.titel ?? '',
    tage: Number(z.tage ?? 0),
    schliesst: Array.isArray(z.schliesst) ? z.schliesst : [],
    aktiv: z.aktiv !== false,
    sortierung: Number(z.sortierung ?? 0),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function standAus(r: any, quelle: AutomatikStand['quelle']): AutomatikStand {
  const schalter: Record<string, SchalterStand> = {}
  for (const [id, s] of Object.entries(r?.schalter ?? {})) {
    if (s && typeof s === 'object') schalter[id] = s as SchalterStand
  }
  return {
    schalter,
    regeln: Array.isArray(r?.regeln) ? r.regeln.map(regelAus) : [],
    wvRegeln: (Array.isArray(r?.wvRegeln) ? r.wvRegeln.map(wvRegelAus) : []).sort((a: WvRegelStand, b: WvRegelStand) => a.sortierung - b.sortierung),
    quelle,
  }
}

/** Was der Browser ohne die Server-Aktion lesen kann. */
async function ersatzStand(): Promise<AutomatikStand> {
  const db = client()
  const [regeln, wv, wk] = await Promise.all([
    db.from('auto_nachricht_regeln').select('*').order('reihenfolge'),
    db.from('wiedervorlage_regeln').select('*').order('sortierung', { ascending: true }),
    db.from('willkommen_einstellung').select('*').eq('id', 1).maybeSingle(),
  ])
  const schalter: Record<string, SchalterStand> = {}
  if (!wk.error && wk.data) {
    schalter.willkommen = {
      wert: !!wk.data.aktiv,
      wartezeitMinuten: wk.data.verzoegerung_minuten ?? 60,
      geaendertVon: wk.data.geaendert_von ?? undefined,
      geaendertAm: wk.data.geaendert_am ?? undefined,
    }
  }
  return standAus({ schalter, regeln: regeln.error ? [] : regeln.data, wvRegeln: wv.error ? [] : wv.data }, 'ersatz')
}

export async function ladeAutomatikStand(): Promise<AutomatikStand> {
  try {
    const r = await callAuthenticated({ action: 'automatik_stand' })
    return standAus(r, 'server')
  } catch {
    return ersatzStand()
  }
}

export type SchalterAenderung = {
  wert?: SchalterWert
  uhrzeit?: string
  wartezeitMinuten?: number | null
  empfaenger?: string[]
  tage?: number
  titel?: string
}

/**
 * Ändert einen Schalter (ids aus dem Katalog, 'regel:<id>' oder 'wv:<id>'). Liefert den neuen Stand.
 * Ist der Server noch nicht bereit (Stand aus dem Ersatz), gehen Willkommen und Mail-Regeln direkt in die Datenbank.
 */
export async function setzeAutomatikSchalter(id: string, aenderung: SchalterAenderung, stand: AutomatikStand, von: string): Promise<AutomatikStand> {
  if (stand.quelle === 'ersatz') {
    if (id === 'willkommen') {
      await setzeWillkommenEinstellung(
        {
          aktiv: typeof aenderung.wert === 'boolean' ? aenderung.wert : undefined,
          verzoegerungMinuten: aenderung.wartezeitMinuten ?? undefined,
        },
        von,
      )
      return ersatzStand()
    }
    if (id.startsWith('regel:')) {
      await setzeAutoRegel(
        id.slice(6),
        { aktiv: typeof aenderung.wert === 'boolean' ? aenderung.wert : undefined, wartezeitMinuten: aenderung.wartezeitMinuten ?? undefined },
        von,
      )
      return ersatzStand()
    }
  }
  const r = await callAuthenticated({ action: 'automatik_schalter', id, ...aenderung })
  if (r?.stand) return standAus(r.stand, 'server')
  return ladeAutomatikStand()
}

// ── Anzeige ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Pille = { label: string; farbe: string; titel?: string }

const GRUEN = 'bg-emerald-100 text-emerald-700'
const GRAU = 'bg-slate-100 text-slate-600'
const GELB = 'bg-amber-100 text-amber-700'
const BLAU = 'bg-sky-100 text-sky-700'

/** Status-Pille für eine Karte: an / aus / Probelauf / je Person / immer an / pro Vorgang. */
export function pilleFuer(e: AutomatikEintrag, stand: AutomatikStand | null): Pille {
  const s = e.schalter
  switch (s.art) {
    case 'immer':
      return { label: 'immer an', farbe: GRUEN }
    case 'je_person':
      return { label: 'je Person', farbe: BLAU, titel: s.wo }
    case 'je_vorgang':
      return { label: 'pro Vorgang', farbe: BLAU, titel: s.wo }
    case 'regel': {
      const r = stand?.regeln.find((x) => x.id === s.id)
      if (!r) return { label: 'Stand unbekannt', farbe: GRAU }
      return r.aktiv ? { label: 'an', farbe: GRUEN } : { label: 'aus', farbe: GRAU }
    }
    case 'stufe': {
      const w = stand?.schalter[s.id]?.wert
      if (w === undefined) return { label: 'Stand unbekannt', farbe: GRAU }
      if (w === 'superuser') return { label: 'Probelauf', farbe: GELB, titel: 'geht nur an Superuser' }
      if (w === 'alle' || w === true) return { label: 'an', farbe: GRUEN }
      return { label: 'aus', farbe: GRAU }
    }
    case 'an_aus':
    case 'empfaenger': {
      const w = stand?.schalter[s.id]?.wert
      if (w === undefined) return { label: 'Stand unbekannt', farbe: GRAU }
      return w === true || w === 'alle' ? { label: 'an', farbe: GRUEN } : { label: 'aus', farbe: GRAU }
    }
  }
}

export function wartezeitWahlText(m: number): string {
  if (m === 0) return 'sofort'
  if (m < 60) return `${m} Minuten`
  if (m === 1440) return '1 Tag'
  if (m % 1440 === 0) return `${m / 1440} Tage`
  return `${m / 60} Std.`
}

export const BEREICH_NAME = (b?: string): string => (b ? (PROJEKT_BEREICH_LABEL as Record<string, string>)[b] ?? (b === 'immobilienkunden' ? 'Immobilien-Kunden' : b) : 'alle Bereiche')

const ALLE_NETZE: Bereich[] = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen', 'immobilienkunden', 'immobilien']

/** Name eines Stands („Erstkontakt hergestellt“) für eine Wiedervorlage-Regel. */
export function standName(status: string, bereich?: string): string {
  const netze = bereich ? [bereich as Bereich] : ALLE_NETZE
  for (const b of netze) {
    const knoten = getStatusMap(b)[status]
    if (knoten) return knoten.label
  }
  return status
}

const UHR = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
export function zeitText(iso?: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : UHR.format(d)
}

// ── Mitarbeiter (für Empfänger-Namen) ───────────────────────────────────────────────────────────────────────────────

export type MitarbeiterKurz = { name: string; email: string; chat?: string }

export async function ladeMitarbeiterKurz(): Promise<MitarbeiterKurz[]> {
  const db = client()
  const mitChat = await db.from('mitarbeiter').select('name, email, telegram_chat_id').eq('aktiv', true).order('name')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let zeilen: any[] | null = mitChat.error ? null : mitChat.data
  if (!zeilen) {
    const ohne = await db.from('mitarbeiter').select('name, email').eq('aktiv', true).order('name')
    zeilen = ohne.error ? [] : ohne.data
  }
  return (zeilen ?? []).map((z) => ({
    name: z.name ?? z.email ?? 'Mitarbeiter',
    email: String(z.email ?? '').toLowerCase(),
    chat: z.telegram_chat_id ? String(z.telegram_chat_id) : undefined,
  }))
}

/** Empfängerliste lesbar: '*' = alle, 'superuser' = alle Superuser, sonst Namen statt Adressen. */
export function empfaengerNamen(liste: string[] | undefined, mitarbeiter: MitarbeiterKurz[]): string {
  if (!liste || liste.length === 0) return 'niemand eingetragen'
  if (liste.includes('*')) return 'alle Mitarbeiter'
  return liste
    .map((x) => (x === 'superuser' ? 'alle Superuser' : mitarbeiter.find((m) => m.email === x.toLowerCase())?.name ?? x))
    .join(', ')
}
