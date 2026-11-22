// Vorschläge im eigenen, privaten Postfach (Privat → Mein Postfach). Der Server bewertet jede private Mail einmal
// (supabase/functions/email-gateway/privatPostZuordnung.ts) und legt das Ergebnis in
// eingegangene_emails.zuordnung_vorschlag ab: { art: 'privat', status: 'privat_offen' | 'privat_rundschreiben' |
// 'privat_keiner' | 'privat_uebernommen' | 'privat_verworfen', kandidaten?: [...] }.
// Die Datenbank zeigt private Zeilen nur ihrem Besitzer; alle Abfragen hier filtern zusätzlich ausdrücklich auf die
// eigene Adresse.
//
// Annehmen:
//  - Akte der Holding: Vorschlag leeren → mail_freigeben (ins gemeinsame Postfach) → mail_zuordnen (Verlauf und
//    Anhänge in der Akte, mit Rechteprüfung auf dem Server).
//  - eigener privater Kontakt: Mail bleibt privat, wird nur bei ihm abgelegt.
import { supabase } from './supabaseClient'
import { callAuthenticated, holeMailInOeffentlich, type EingegangeneMail } from './emailGateway'
import type { KundeBereich } from '../types'

export type PrivatKandidat = { kundeId: string; bereich: KundeBereich; name: string; grund: string; privat?: boolean; sicher?: boolean }
export type PrivatVorschlagStatus = 'privat_pruefung' | 'privat_offen' | 'privat_rundschreiben' | 'privat_keiner' | 'privat_uebernommen' | 'privat_verworfen'
export type PrivatVorschlag = { art: 'privat'; status: PrivatVorschlagStatus; kandidaten?: PrivatKandidat[]; grund?: string } & Record<string, unknown>

export type PrivatMail = EingegangeneMail & { id: string; vorschlag: PrivatVorschlag | null }

type Zeile = {
  id: string
  message_id: string | null
  von: string
  von_name: string | null
  betreff: string | null
  mail_datum: string
  ausschnitt: string | null
  anhaenge: { filename: string; size: number; contentType: string; url: string }[] | null
  zugewiesener_kunde_id: string | null
  zugewiesener_bereich: string | null
  zugewiesener_kunde_name: string | null
  ignoriert: boolean | null
  postfach_id: string | null
  ordner?: string | null
  zuordnung_vorschlag: unknown
}

const SPALTEN =
  'id, message_id, von, von_name, betreff, mail_datum, ausschnitt, anhaenge, zugewiesener_kunde_id, zugewiesener_bereich, zugewiesener_kunde_name, ignoriert, postfach_id, zuordnung_vorschlag, ordner:rohdaten->>ordner'

/** Nur echte private Vorschläge (art 'privat'); alles andere zählt als „kein Vorschlag“. */
export function alsPrivatVorschlag(v: unknown): PrivatVorschlag | null {
  if (!v || typeof v !== 'object') return null
  const x = v as PrivatVorschlag
  return x.art === 'privat' && typeof x.status === 'string' ? x : null
}

function alsMail(z: Zeile): PrivatMail {
  return {
    id: z.id,
    messageId: z.message_id ?? z.id,
    von: z.von,
    vonName: z.von_name ?? z.von,
    betreff: z.betreff ?? '(ohne Betreff)',
    datum: z.mail_datum,
    ausschnitt: z.ausschnitt ?? '',
    anhaenge: z.anhaenge ?? undefined,
    zugewiesen:
      z.zugewiesener_kunde_id && z.zugewiesener_bereich && z.zugewiesener_kunde_name
        ? { bereich: z.zugewiesener_bereich as KundeBereich, kundeId: z.zugewiesener_kunde_id, kundeName: z.zugewiesener_kunde_name }
        : undefined,
    ignoriert: z.ignoriert ?? undefined,
    postfachId: z.postfach_id ?? undefined,
    ordner: z.ordner ?? undefined,
    vorschlag: alsPrivatVorschlag(z.zuordnung_vorschlag),
  }
}

function sucheBereinigt(s: string): string {
  return s.replace(/[,()%]/g, ' ').trim()
}

const OHNE_RUNDSCHREIBEN = 'zuordnung_vorschlag.is.null,zuordnung_vorschlag->>status.is.null,zuordnung_vorschlag->>status.neq.privat_rundschreiben'

/**
 * Eigene private Mails, neueste zuerst. `ansicht`: 'alle' (ohne Rundschreiben), 'vorschlaege' (offene Vorschläge,
 * noch bei keiner Akte), 'rundschreiben' (nur die ausgeblendeten Rundschreiben).
 * `ordner`: nicht angegeben = alle Ordner, '' = nur Posteingang, sonst genau dieser Ordner.
 */
export async function ladePrivateMails(
  ich: string,
  ansicht: 'alle' | 'vorschlaege' | 'rundschreiben',
  limit = 40,
  suche = '',
  ordner?: string,
): Promise<PrivatMail[]> {
  if (!supabase || !ich) return []
  let q = supabase
    .from('eingegangene_emails')
    .select(SPALTEN)
    .eq('besitzer_email', ich.toLowerCase())
    .or('ignoriert.is.null,ignoriert.eq.false')
  if (ansicht === 'alle') q = q.or(OHNE_RUNDSCHREIBEN)
  if (ansicht === 'vorschlaege') q = q.is('zugewiesener_kunde_id', null).eq('zuordnung_vorschlag->>status', 'privat_offen')
  if (ansicht === 'rundschreiben') q = q.eq('zuordnung_vorschlag->>status', 'privat_rundschreiben')
  if (ordner === '') q = q.is('rohdaten->>ordner', null)
  else if (ordner) q = q.eq('rohdaten->>ordner', ordner)
  const term = sucheBereinigt(suche)
  if (term) q = q.or(`betreff.ilike.%${term}%,von.ilike.%${term}%,von_name.ilike.%${term}%,ausschnitt.ilike.%${term}%`)
  const { data, error } = await q.order('mail_datum', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Zeile[]).map(alsMail)
}

/** Wie viele offene Vorschläge und ausgeblendete Rundschreiben gibt es (ohne Inhalte zu laden)? */
export async function zaehlePrivatVorschlaege(ich: string): Promise<{ vorschlaege: number; rundschreiben: number }> {
  if (!supabase || !ich) return { vorschlaege: 0, rundschreiben: 0 }
  const basis = () =>
    supabase!
      .from('eingegangene_emails')
      .select('id', { count: 'exact', head: true })
      .eq('besitzer_email', ich.toLowerCase())
      .or('ignoriert.is.null,ignoriert.eq.false')
  const [v, r] = await Promise.all([
    basis().is('zugewiesener_kunde_id', null).eq('zuordnung_vorschlag->>status', 'privat_offen'),
    basis().eq('zuordnung_vorschlag->>status', 'privat_rundschreiben'),
  ])
  if (v.error) throw new Error(v.error.message)
  if (r.error) throw new Error(r.error.message)
  return { vorschlaege: v.count ?? 0, rundschreiben: r.count ?? 0 }
}

async function schreibeVorschlag(ich: string, mailId: string, vorschlag: unknown, extra: Record<string, unknown> = {}): Promise<number> {
  if (!supabase) throw new Error('Datenbank ist nicht konfiguriert.')
  const { data, error } = await supabase
    .from('eingegangene_emails')
    .update({ zuordnung_vorschlag: vorschlag, ...extra })
    .eq('id', mailId)
    .eq('besitzer_email', ich.toLowerCase())
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

function erledigt(status: PrivatVorschlagStatus, wer: string, extra: Record<string, unknown> = {}): PrivatVorschlag {
  return { art: 'privat', status, erledigt_am: new Date().toISOString(), erledigt_von: wer, ...extra }
}

/** Keiner der Vorschläge passt. */
export async function verwirfPrivatVorschlag(ich: string, mail: PrivatMail, wer: string): Promise<void> {
  await schreibeVorschlag(ich, mail.id, erledigt('privat_verworfen', wer))
}

/** Als Rundschreiben ausgeblendete Mail ist doch keins: wieder normal zeigen. */
export async function keinRundschreiben(ich: string, mail: PrivatMail, wer: string): Promise<void> {
  await schreibeVorschlag(ich, mail.id, erledigt('privat_keiner', wer, { vonHand: true }))
}

/** Mail als Rundschreiben ausblenden (von Hand). */
export async function alsRundschreiben(ich: string, mail: PrivatMail, wer: string): Promise<void> {
  await schreibeVorschlag(ich, mail.id, erledigt('privat_rundschreiben', wer, { vonHand: true, grund: 'von Hand als Rundschreiben markiert' }))
}

/** Bei einem eigenen privaten Kontakt ablegen — die Mail bleibt privat. */
export async function legeBeiPrivatKontaktAb(ich: string, mail: PrivatMail, kunde: { id: string; name: string }, wer: string): Promise<void> {
  if (!supabase) throw new Error('Datenbank ist nicht konfiguriert.')
  const { data, error } = await supabase
    .from('eingegangene_emails')
    .update({
      zugewiesener_kunde_id: kunde.id,
      zugewiesener_bereich: 'privat',
      zugewiesener_kunde_name: kunde.name,
      zuordnung_vorschlag: erledigt('privat_uebernommen', wer, { kundeId: kunde.id }),
    })
    .eq('id', mail.id)
    .eq('besitzer_email', ich.toLowerCase())
    .is('zugewiesener_kunde_id', null)
    .select('id')
  if (error) throw new Error(error.message)
  if ((data ?? []).length === 0) throw new Error('Die Mail ist inzwischen schon abgelegt oder übergeben.')
}

/**
 * Ins CRM übergeben und einer Akte der Holding zuordnen (ein Klick). Ohne `kunde` landet sie nur im gemeinsamen
 * Postfach. Wirft mit einer verständlichen Meldung; ist die Übergabe gelungen, die Zuordnung aber nicht, sagt die
 * Meldung das ausdrücklich.
 */
export async function uebergibInsCrm(
  ich: string,
  mail: PrivatMail,
  wer: string,
  kunde?: { id: string; name: string; bereich?: string; neu?: boolean },
): Promise<{ abgelegt: number }> {
  const vorher = mail.vorschlag
  // Erst den Vorschlag leeren: Namen privater Kontakte dürfen nicht mit ins gemeinsame Postfach wandern.
  await schreibeVorschlag(ich, mail.id, erledigt('privat_uebernommen', wer, kunde ? { kundeId: kunde.id } : {}))
  // Gerade erst im Browser angelegte Akte: Sie steht evtl. noch nicht in der Datenbank — dann nur vermerken (wie bisher).
  const direkt = kunde?.neu && kunde.bereich ? { bereich: kunde.bereich, id: kunde.id, name: kunde.name } : undefined
  try {
    await holeMailInOeffentlich('eingang', mail.messageId, direkt)
  } catch (err) {
    await schreibeVorschlag(ich, mail.id, vorher).catch(() => {})
    throw err
  }
  if (!kunde || direkt) return { abgelegt: 0 }
  try {
    const r = await callAuthenticated({ action: 'mail_zuordnen', mailId: mail.id, kundeId: kunde.id })
    return { abgelegt: Number(r?.abgelegt ?? 0) }
  } catch (err) {
    throw new Error(`Die Mail liegt jetzt im gemeinsamen Postfach, aber die Zuordnung zu ${kunde.name} hat nicht geklappt (${err instanceof Error ? err.message : String(err)}). Bitte dort zuordnen.`)
  }
}
