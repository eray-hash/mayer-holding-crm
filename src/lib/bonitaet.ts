// Interne Bonitätseinschätzung eines Kunden: startet die Prüfung auf dem Server (email-gateway
// „bonitaet_pruefen", siehe supabase/functions/email-gateway/bonitaet.ts) und schlägt vor, ob die Akte
// eine Privatperson oder eine Firma beschreibt. Maßgeblich ist der Server; der Vorschlag hier nur
// die Vorbelegung der Auswahl — gleiche Regel wie erkenneKundenArt dort.
import { supabase } from './supabaseClient'
import type { Bonitaetseinschaetzung, KundeBereich } from '../types'

const FUNCTION_URL = import.meta.env.VITE_EMAIL_GATEWAY_URL as string | undefined
const SHARED_SECRET = import.meta.env.VITE_EMAIL_GATEWAY_SECRET as string | undefined

const RECHTSFORM_KUERZEL = ['GmbH', 'gGmbH', 'mbH', 'UG', 'AG', 'KG', 'KGaA', 'OHG', 'oHG', 'GbR', 'eG', 'SE', 'PartG', 'PartGmbB', 'Ltd', 'Inc', 'LLC', 'Co. KG', 'e.K.', 'e.Kfm.', 'e.Kfr.', 'e. K.', 'e.V.', 'e. V.']
const RECHTSFORM_WOERTER = /(gesellschaft|holding|stiftung|genossenschaft|haftungsbeschr[aä]nkt|aktiengesellschaft|kommanditgesellschaft|verein)/i

function rechtsformIn(text: string): string | null {
  const t = ` ${text.replace(/\s+/g, ' ')} `
  const grenze = (z: string | undefined) => !z || !/[A-Za-z0-9ÄÖÜäöüß]/.test(z)
  for (const k of RECHTSFORM_KUERZEL) {
    const i = t.indexOf(k)
    if (i >= 0 && grenze(t[i - 1]) && grenze(t[i + k.length])) return k.trim()
  }
  return text.match(RECHTSFORM_WOERTER)?.[0] ?? null
}

const vergleichsName = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '')

export function firmaIstNurPersonenname(firma: string, ansprechpartner: string): boolean {
  const f = vergleichsName(firma)
  if (!f) return true
  const p = vergleichsName(ansprechpartner)
  if (p && (f === p || f.replace(/^(herr|frau)/, '') === p)) return true
  return /^privat/.test(f)
}

export function erkenneKundenArt(firma: string, ansprechpartner: string): { art: 'person' | 'firma'; grund: string } {
  const f = String(firma ?? '').trim()
  const rf = f ? rechtsformIn(f) : null
  if (rf) return { art: 'firma', grund: `Rechtsform „${rf}" im Firmennamen` }
  if (firmaIstNurPersonenname(f, ansprechpartner)) return { art: 'person', grund: f ? 'Im Feld „Firma" steht nur der Name der Person' : 'Kein Firmenname in der Akte' }
  return { art: 'person', grund: 'Keine Rechtsform im Firmennamen erkannt — bitte prüfen' }
}

export async function pruefeBonitaet(e: { bereich: KundeBereich; kundeId: string; art: 'person' | 'firma' }): Promise<{ bonitaet: Bonitaetseinschaetzung; angestossen: number }> {
  if (!FUNCTION_URL) throw new Error('Der Server ist noch nicht eingerichtet (VITE_EMAIL_GATEWAY_URL fehlt).')
  const { data: sessionData } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Du bist nicht angemeldet.')
  let res: Response
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(SHARED_SECRET ? { 'x-crm-secret': SHARED_SECRET } : {}),
      },
      body: JSON.stringify({ action: 'bonitaet_pruefen', bereich: e.bereich, kundeId: e.kundeId, art: e.art }),
    })
  } catch {
    throw new Error('Der Server war nicht erreichbar. Bitte noch einmal versuchen.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data?.error === 'string') throw new Error(data?.error ?? `Die Prüfung ist fehlgeschlagen (${res.status}).`)
  if (!data?.bonitaet || typeof data.bonitaet !== 'object') throw new Error('Die Prüfung ist fehlgeschlagen: Der Server hat kein Ergebnis geschickt.')
  return { bonitaet: data.bonitaet as Bonitaetseinschaetzung, angestossen: Number(data.angestossen ?? 0) }
}

export const AMPEL: Record<Bonitaetseinschaetzung['ampel'], { label: string; kurz: string; punkt: string; flaeche: string }> = {
  gruen: { label: 'Grün — geordnete Verhältnisse', kurz: 'Grün', punkt: 'bg-emerald-500', flaeche: 'bg-emerald-50 text-emerald-800' },
  gelb: { label: 'Gelb — gemischtes Bild, genauer hinsehen', kurz: 'Gelb', punkt: 'bg-amber-400', flaeche: 'bg-amber-50 text-amber-800' },
  rot: { label: 'Rot — deutliche Warnzeichen', kurz: 'Rot', punkt: 'bg-rose-500', flaeche: 'bg-rose-50 text-rose-800' },
  nicht_beurteilbar: { label: 'Nicht beurteilbar — zu wenig Grundlage', kurz: 'Nicht beurteilbar', punkt: 'bg-slate-400', flaeche: 'bg-slate-100 text-slate-700' },
}

/** Kurztext für das freie Feld „Bonität" im Stammdatenblatt. */
export function bonitaetKurztext(b: Bonitaetseinschaetzung): string {
  const datum = new Date(b.erstelltAm).toLocaleDateString('de-DE')
  return `${AMPEL[b.ampel]?.kurz ?? b.ampel} (interne Einschätzung vom ${datum})`
}
