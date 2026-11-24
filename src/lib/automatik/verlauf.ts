// Verlauf der automatischen Nachrichten (24.11.2026): eine gemeinsame Liste aus allen Stellen, an denen geplante oder
// verschickte Nachrichten stehen — nachrichten_protokoll (Telegram des Mayer-Bots, Gast-Mails, Buchung, Unterschrift),
// willkommen_nachrichten, auto_nachrichten, telegram_vorschlaege („Bitte bestätigen“, Statuswechsel) und die offenen
// automatischen Wiedervorlagen der nächsten 14 Tage. Je Quelle höchstens ~300 Zeilen. Lässt sich eine Quelle nicht
// lesen (Rechte), fehlt sie still mit einem Hinweis. Der private Assistent wird bewusst nirgends aufgezeichnet.
import { supabase } from '../supabaseClient'
import { KATALOG, type Kanal } from './katalog'
import type { MitarbeiterKurz } from './schalter'

export type VerlaufStand = 'geplant' | 'gesendet' | 'fehler' | 'abgebrochen'

export type VerlaufEintrag = {
  key: string
  /** Kennung aus dem Katalog, falls bekannt. */
  katalogId?: string
  /** Rohe Art aus der Quelle (für Nachrichten, die (noch) nicht im Katalog stehen). */
  artRoh: string
  kanal: Kanal
  /** 'mail' | 'telegram' | 'intern' (Wiedervorlage) */
  weg: 'mail' | 'telegram' | 'intern'
  /** Geplant für bzw. gesendet am (ISO oder JJJJ-MM-TT). */
  zeitpunkt: string
  stand: VerlaufStand
  standText: string
  an: string
  betreff?: string
  text?: string
}

export type Verlauf = { eintraege: VerlaufEintrag[]; hinweise: string[] }

const GRENZE = 300
const KATALOG_IDS = new Set(KATALOG.map((e) => e.id))
const KANAL_VON = new Map(KATALOG.map((e) => [e.id, e.kanal]))

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

type Kontext = { seit: string; kundenName: (id?: string | null) => string | undefined; mitarbeiter: MitarbeiterKurz[] }

function nameZu(email: string | null | undefined, k: Kontext): string | undefined {
  if (!email) return undefined
  return k.mitarbeiter.find((m) => m.email === email.toLowerCase())?.name
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Zeile = any

/** Geplante (alle) und kürzlich erledigte Zeilen einer Warteschlangen-Tabelle. */
async function warteschlange(tabelle: 'willkommen_nachrichten' | 'auto_nachrichten', seit: string): Promise<Zeile[]> {
  const db = client()
  const [geplant, neu] = await Promise.all([
    db.from(tabelle).select('*').in('status', ['geplant', 'ohne_adresse']).order('senden_ab', { ascending: true }).limit(GRENZE),
    db.from(tabelle).select('*').not('status', 'in', '(geplant,ohne_adresse)').gte('senden_ab', seit).order('senden_ab', { ascending: false }).limit(GRENZE),
  ])
  if (geplant.error) throw geplant.error
  if (neu.error) throw neu.error
  return [...(geplant.data ?? []), ...(neu.data ?? [])]
}

function warteschlangeStand(z: Zeile): { stand: VerlaufStand; standText: string; zeitpunkt: string } {
  switch (z.status) {
    case 'geplant':
      return { stand: 'geplant', standText: 'geplant', zeitpunkt: z.senden_ab }
    case 'ohne_adresse':
      return { stand: 'geplant', standText: 'wartet auf eine E-Mail-Adresse', zeitpunkt: z.senden_ab }
    case 'gesendet':
      return { stand: 'gesendet', standText: 'gesendet', zeitpunkt: z.gesendet_am ?? z.senden_ab }
    case 'fehler':
      return { stand: 'fehler', standText: z.grund ? `Fehler: ${z.grund}` : 'Fehler', zeitpunkt: z.senden_ab }
    default:
      return { stand: 'abgebrochen', standText: z.grund ? `nicht gesendet (${z.grund})` : 'nicht gesendet', zeitpunkt: z.senden_ab }
  }
}

async function ausWillkommen(k: Kontext): Promise<VerlaufEintrag[]> {
  const zeilen = await warteschlange('willkommen_nachrichten', k.seit)
  return zeilen.map((z) => {
    const kunde = k.kundenName(z.kunde_id)
    return {
      key: `wk:${z.id}`,
      katalogId: 'willkommen',
      artRoh: 'willkommen',
      kanal: 'kunde',
      weg: 'mail',
      ...warteschlangeStand(z),
      an: [kunde, z.an].filter(Boolean).join(' · ') || 'Kunde der Akte',
    }
  })
}

async function ausAutoNachrichten(k: Kontext): Promise<VerlaufEintrag[]> {
  const zeilen = await warteschlange('auto_nachrichten', k.seit)
  return zeilen.map((z) => ({
    key: `an:${z.id}`,
    katalogId: KATALOG_IDS.has(z.regel) ? z.regel : undefined,
    artRoh: z.regel ?? 'auto_nachricht',
    kanal: 'kunde',
    weg: 'mail',
    ...warteschlangeStand(z),
    an: [z.an_name ?? k.kundenName(z.kunde_id), z.an].filter(Boolean).join(' · ') || 'Interessent',
    betreff: z.betreff ?? undefined,
    text: z.text ?? undefined,
  }))
}

async function ausProtokoll(k: Kontext): Promise<VerlaufEintrag[]> {
  const { data, error } = await client().from('nachrichten_protokoll').select('*').gte('am', k.seit).order('am', { ascending: false }).limit(GRENZE)
  if (error) throw error
  return (data ?? []).map((z: Zeile) => {
    const katalogId = KATALOG_IDS.has(z.art) ? z.art : undefined
    const weg: 'mail' | 'telegram' = z.kanal === 'mail' ? 'mail' : 'telegram'
    const chatName = z.an_chat ? k.mitarbeiter.find((m) => m.chat && m.chat === String(z.an_chat))?.name : undefined
    return {
      key: `np:${z.id}`,
      katalogId,
      artRoh: z.art ?? 'unbekannt',
      kanal: katalogId ? KANAL_VON.get(katalogId)! : weg === 'telegram' ? 'telegram' : 'kunde',
      weg,
      zeitpunkt: z.am,
      stand: z.status === 'fehler' ? 'fehler' : 'gesendet',
      standText: z.status === 'fehler' ? 'Fehler' : 'gesendet',
      an: z.an_name || chatName || nameZu(z.an_email, k) || z.an_email || (weg === 'telegram' ? 'Mitarbeiter' : 'Empfänger'),
      betreff: z.betreff ?? undefined,
      text: z.text ?? undefined,
    } satisfies VerlaufEintrag
  })
}

const VORSCHLAG_STAND: Record<string, { stand: VerlaufStand; text: string }> = {
  offen: { stand: 'gesendet', text: 'wartet auf Antwort' },
  laeuft: { stand: 'gesendet', text: 'wird gerade ausgeführt' },
  erledigt: { stand: 'gesendet', text: 'bestätigt' },
  ignoriert: { stand: 'gesendet', text: 'ignoriert' },
  nein: { stand: 'gesendet', text: 'abgelehnt' },
  veraltet: { stand: 'gesendet', text: 'hat sich erledigt' },
  fehler: { stand: 'fehler', text: 'Fehler' },
}

async function ausVorschlaegen(k: Kontext): Promise<VerlaufEintrag[]> {
  const { data, error } = await client()
    .from('telegram_vorschlaege')
    .select('id, art, empfaenger_email, status, erstellt_am, erledigt_am, ergebnis, daten')
    .neq('art', 'lauf')
    .neq('id', 'einstellung')
    .gte('erstellt_am', k.seit)
    .order('erstellt_am', { ascending: false })
    .limit(GRENZE)
  if (error) throw error
  return (data ?? []).map((z: Zeile) => {
    const st = VORSCHLAG_STAND[z.status] ?? { stand: 'gesendet' as const, text: z.status }
    const istStatus = z.art === 'status'
    const d = z.daten ?? {}
    const text = istStatus
      ? [d.name && `Akte: „${d.name}“`, d.anlass && `Anlass: ${d.anlass}`, d.vonName && `Jetzt: ${d.vonName}`, d.nachName && `Vorschlag: ${d.nachName}`].filter(Boolean).join('\n')
      : [d.titel && `„${d.titel}“`, d.ziel?.name && `Vorschlag: Akte „${d.ziel.name}“`, d.grund && `Grund: ${d.grund}`].filter(Boolean).join('\n')
    return {
      key: `tv:${z.id}`,
      katalogId: istStatus ? 'status_vorschlag' : 'bitte_bestaetigen',
      artRoh: z.art,
      kanal: 'telegram',
      weg: 'telegram',
      zeitpunkt: z.erstellt_am,
      stand: st.stand,
      standText: z.ergebnis ? `${st.text} – ${z.ergebnis}` : st.text,
      an: nameZu(z.empfaenger_email, k) ?? z.empfaenger_email ?? 'Mitarbeiter',
      text: text || undefined,
    } satisfies VerlaufEintrag
  })
}

async function ausWiedervorlagen(k: Kontext): Promise<VerlaufEintrag[]> {
  const heute = new Date()
  const bis = new Date(heute.getTime() + 14 * 86400000)
  const tag = (d: Date) => d.toISOString().slice(0, 10)
  const { data, error } = await client()
    .from('wiedervorlagen')
    .select('id, titel, faellig, verantwortlich, kunde_id, regel, notiz')
    .is('erledigt_am', null)
    .not('regel', 'is', null)
    .gte('faellig', tag(heute))
    .lte('faellig', tag(bis))
    .order('faellig', { ascending: true })
    .limit(GRENZE)
  if (error) throw error
  return (data ?? []).map((z: Zeile) => {
    const akte = k.kundenName(z.kunde_id)
    return {
      key: `wv:${z.id}`,
      katalogId: 'wv_regeln',
      artRoh: 'wiedervorlage',
      kanal: 'wiedervorlage',
      weg: 'intern',
      zeitpunkt: String(z.faellig).slice(0, 10),
      stand: 'geplant',
      standText: 'fällig',
      an: z.verantwortlich || 'Verantwortlicher der Akte',
      betreff: z.titel,
      text: [akte && `Akte: ${akte}`, z.titel, z.notiz].filter(Boolean).join('\n') || undefined,
    } satisfies VerlaufEintrag
  })
}

const QUELLEN: { name: string; laden: (k: Kontext) => Promise<VerlaufEintrag[]> }[] = [
  { name: 'Aufzeichnung der Telegram- und Termin-Nachrichten', laden: ausProtokoll },
  { name: 'Willkommensnachrichten', laden: ausWillkommen },
  { name: 'Automatische Mails (Immobilien, Akademie)', laden: ausAutoNachrichten },
  { name: '„Bitte bestätigen“ und Statuswechsel-Vorschläge', laden: ausVorschlaegen },
  { name: 'Automatische Wiedervorlagen', laden: ausWiedervorlagen },
]

/** Lädt alle Quellen der letzten `tage` Tage (geplante immer). Schlägt eine Quelle fehl, fehlt sie mit Hinweis. */
export async function ladeVerlauf(tage: number, kundenName: Kontext['kundenName'], mitarbeiter: MitarbeiterKurz[]): Promise<Verlauf> {
  const k: Kontext = { seit: new Date(Date.now() - tage * 86400000).toISOString(), kundenName, mitarbeiter }
  const ergebnisse = await Promise.allSettled(QUELLEN.map((q) => q.laden(k)))
  const eintraege: VerlaufEintrag[] = []
  const hinweise: string[] = []
  ergebnisse.forEach((r, i) => {
    if (r.status === 'fulfilled') eintraege.push(...r.value)
    else {
      console.warn('Verlauf:', QUELLEN[i].name, r.reason)
      hinweise.push(`${QUELLEN[i].name}: lässt sich hier nicht lesen und fehlt in der Liste.`)
    }
  })
  return { eintraege, hinweise }
}

/** Neueste zuerst; geplante nach dem nächsten Zeitpunkt. */
export function ordneVerlauf(liste: VerlaufEintrag[]): { geplant: VerlaufEintrag[]; gesendet: VerlaufEintrag[]; fehler: VerlaufEintrag[] } {
  const geplant = liste.filter((e) => e.stand === 'geplant').sort((a, b) => a.zeitpunkt.localeCompare(b.zeitpunkt))
  const neuZuerst = (a: VerlaufEintrag, b: VerlaufEintrag) => b.zeitpunkt.localeCompare(a.zeitpunkt)
  const gesendet = liste.filter((e) => e.stand === 'gesendet').sort(neuZuerst)
  const fehler = liste.filter((e) => e.stand === 'fehler' || e.stand === 'abgebrochen').sort(neuZuerst)
  return { geplant, gesendet, fehler }
}

export const WEG_TEXT: Record<VerlaufEintrag['weg'], string> = { mail: 'E-Mail', telegram: 'Telegram', intern: 'Wiedervorlage' }

export const STAND_FARBE: Record<VerlaufStand, string> = {
  geplant: 'bg-sky-100 text-sky-700',
  gesendet: 'bg-emerald-100 text-emerald-700',
  fehler: 'bg-rose-100 text-rose-700',
  abgebrochen: 'bg-slate-100 text-slate-600',
}

const NAME = new Map(KATALOG.map((e) => [e.id, e.name]))
const ROH_NAME: Record<string, string> = { telegram: 'Telegram-Nachricht', unbekannt: 'Nachricht', auto_nachricht: 'Automatische Mail', wiedervorlage: 'Wiedervorlage' }
/** Name der Nachricht aus dem Katalog, sonst die rohe Art. */
export const nachrichtName = (v: VerlaufEintrag): string => (v.katalogId ? NAME.get(v.katalogId) : undefined) ?? ROH_NAME[v.artRoh] ?? v.artRoh
