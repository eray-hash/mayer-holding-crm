// Besichtigungen je Objekt (21.11.2026, nach dem Vergleich mit Propstack): wer hat das Objekt wann
// angesehen, wie war die Rückmeldung, gab es ein Kaufpreisangebot? Tabelle `besichtigungen`
// (Zeilenschutz: aktive Mitarbeiter mit Freigabe für Immobilien). Gelesen und geschrieben wird direkt
// aus dem Fenster; der Kalendertermin dazu läuft wie jeder Termin über den Server (termin_speichern).
import { supabase } from './supabaseClient'
import { callAuthenticated, loescheTerminRemote } from './emailGateway'

export type BesichtigungStatus = 'geplant' | 'durchgefuehrt' | 'abgesagt' | 'nicht_erschienen'
export type BesichtigungInteresse = 'hoch' | 'mittel' | 'gering' | 'kein'

export type Besichtigung = {
  id: string
  objektId: string
  /** Kontakt im CRM (Immobilien-Kontakte), falls der Interessent dort geführt wird. */
  kundeId?: string
  kundeBereich?: string
  interessent: string
  telefon: string
  email: string
  /** ISO-Zeitpunkt. */
  beginn: string
  dauerMin: number
  durchgefuehrtVon: string
  status: BesichtigungStatus
  interesse?: BesichtigungInteresse
  rueckmeldung: string
  /** Kaufpreisangebot in Euro. */
  angebot?: number
  naechsterSchritt: string
  /** Termin im Kalender dessen, der die Besichtigung eingetragen hat. */
  kalenderTerminId?: string
  erstelltVon: string
  erstelltAm?: string
}

export const BESICHTIGUNG_STATUS: { id: BesichtigungStatus; label: string; farbe: string }[] = [
  { id: 'geplant', label: 'Geplant', farbe: 'bg-sky-100 text-sky-700' },
  { id: 'durchgefuehrt', label: 'Durchgeführt', farbe: 'bg-emerald-100 text-emerald-700' },
  { id: 'abgesagt', label: 'Abgesagt', farbe: 'bg-slate-100 text-slate-600' },
  { id: 'nicht_erschienen', label: 'Nicht erschienen', farbe: 'bg-rose-100 text-rose-700' },
]

export const BESICHTIGUNG_INTERESSE: { id: BesichtigungInteresse; label: string; farbe: string }[] = [
  { id: 'hoch', label: 'Großes Interesse', farbe: 'bg-emerald-100 text-emerald-700' },
  { id: 'mittel', label: 'Mittleres Interesse', farbe: 'bg-amber-100 text-amber-700' },
  { id: 'gering', label: 'Wenig Interesse', farbe: 'bg-orange-100 text-orange-700' },
  { id: 'kein', label: 'Kein Interesse', farbe: 'bg-slate-100 text-slate-600' },
]

export const statusLabel = (s: BesichtigungStatus) => BESICHTIGUNG_STATUS.find((x) => x.id === s)?.label ?? s
export const interesseLabel = (i?: BesichtigungInteresse) => (i ? BESICHTIGUNG_INTERESSE.find((x) => x.id === i)?.label ?? i : '')

/** „Sa., 21.11.2026, 14:30 Uhr" in deutscher Zeit. */
export function zeitText(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const tag = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
  return `${tag}, ${uhr} Uhr`
}

function client() {
  if (!supabase) throw new Error('Die Besichtigungen brauchen die Verbindung zur Datenbank.')
  return supabase
}

// deno-lint-ignore no-explicit-any
function ausZeile(z: any): Besichtigung {
  return {
    id: z.id,
    objektId: z.objekt_id,
    kundeId: z.kunde_id ?? undefined,
    kundeBereich: z.kunde_bereich ?? undefined,
    interessent: z.interessent ?? '',
    telefon: z.telefon ?? '',
    email: z.email ?? '',
    beginn: z.beginn,
    dauerMin: Number(z.dauer_min ?? 30),
    durchgefuehrtVon: z.durchgefuehrt_von ?? '',
    status: z.status,
    interesse: z.interesse ?? undefined,
    rueckmeldung: z.rueckmeldung ?? '',
    angebot: z.angebot === null || z.angebot === undefined ? undefined : Number(z.angebot),
    naechsterSchritt: z.naechster_schritt ?? '',
    kalenderTerminId: z.kalender_termin_id ?? undefined,
    erstelltVon: z.erstellt_von ?? '',
    erstelltAm: z.erstellt_am ?? undefined,
  }
}

function zuZeile(b: Besichtigung) {
  return {
    id: b.id,
    objekt_id: b.objektId,
    kunde_id: b.kundeId ?? null,
    kunde_bereich: b.kundeId ? b.kundeBereich ?? 'immobilienkunden' : null,
    interessent: b.interessent.trim(),
    telefon: b.telefon.trim(),
    email: b.email.trim(),
    beginn: b.beginn,
    dauer_min: b.dauerMin,
    durchgefuehrt_von: b.durchgefuehrtVon.trim(),
    status: b.status,
    interesse: b.interesse ?? null,
    rueckmeldung: b.rueckmeldung.trim(),
    angebot: b.angebot ?? null,
    naechster_schritt: b.naechsterSchritt.trim(),
    kalender_termin_id: b.kalenderTerminId ?? null,
    erstellt_von: b.erstelltVon,
    geaendert_am: new Date().toISOString(),
  }
}

/** Alle Besichtigungen eines Objekts, neueste zuerst. */
export async function ladeBesichtigungen(objektId: string): Promise<Besichtigung[]> {
  const { data, error } = await client().from('besichtigungen').select('*').eq('objekt_id', objektId).order('beginn', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(ausZeile)
}

export async function speichereBesichtigung(b: Besichtigung): Promise<void> {
  const { error } = await client().from('besichtigungen').upsert(zuZeile(b))
  if (error) throw new Error(error.message)
}

export async function loescheBesichtigung(id: string): Promise<void> {
  const { error } = await client().from('besichtigungen').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Der Server meldet, dass in der Zeit schon ein Termin liegt — der Nutzer kann trotzdem eintragen. */
export class KalenderBelegt extends Error {}

/** Trägt die Besichtigung in den eigenen Kalender ein (oder ändert den vorhandenen Termin). Liefert die Termin-Kennung.
 *  Eine Einladung an den Interessenten geht dabei nicht hinaus. */
export async function besichtigungInKalender(
  b: Besichtigung,
  objekt: { bezeichnung: string; adresse: string },
  trotzUeberschneidung = false,
): Promise<string | undefined> {
  const beginn = new Date(b.beginn)
  const ende = new Date(beginn.getTime() + Math.max(15, b.dauerMin) * 60000)
  const notiz = [b.telefon && `Telefon: ${b.telefon}`, b.email && `E-Mail: ${b.email}`, b.naechsterSchritt && `Nächster Schritt: ${b.naechsterSchritt}`]
    .filter(Boolean)
    .join('\n')
  try {
    const data = await callAuthenticated({
      action: 'termin_speichern',
      termin: {
        ...(b.kalenderTerminId ? { id: b.kalenderTerminId } : {}),
        titel: `Besichtigung ${objekt.bezeichnung} – ${b.interessent}`,
        beschreibung: notiz,
        ort: objekt.adresse,
        beginn: beginn.toISOString(),
        ende: ende.toISOString(),
        kunde: b.kundeId ? { id: b.kundeId, bereich: b.kundeBereich ?? 'immobilienkunden', name: b.interessent } : null,
        trotzUeberschneidung,
      },
    })
    return data?.termin?.id ?? b.kalenderTerminId
  } catch (err) {
    if (err instanceof Error && /schon belegt/.test(err.message)) throw new KalenderBelegt(err.message)
    throw err
  }
}

/** Entfernt den Kalendertermin der Besichtigung (nur wer ihn angelegt hat, darf das). */
export async function besichtigungAusKalender(terminId: string): Promise<void> {
  await loescheTerminRemote(terminId)
}
