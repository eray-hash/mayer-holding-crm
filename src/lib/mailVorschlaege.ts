// Zuordnungs-Vorschläge der Post-Zuordnung (supabase/functions/email-gateway/mailZuordnung.ts): Mails im
// gemeinsamen Postfach, bei denen der Server eine Akte vermutet, aber nicht sicher ist. Gespeichert in
// eingegangene_emails.zuordnung_vorschlag ({ status: 'offen', kandidaten: [...] }). Zuordnen läuft über die
// normale Zuordnung im Postfach; hier wird nur der Stand des Vorschlags gelesen und fortgeschrieben.
import { supabase } from './supabaseClient'
import type { EingegangeneMail } from './emailGateway'
import type { KundeBereich } from '../types'

export type VorschlagKandidat = { kundeId: string; bereich: KundeBereich; name: string; grund: string }
export type MailMitVorschlag = { mail: EingegangeneMail; kandidaten: VorschlagKandidat[] }

type Zeile = {
  id: string
  message_id: string | null
  von: string
  von_name: string | null
  betreff: string | null
  mail_datum: string
  ausschnitt: string | null
  anhaenge: { filename: string; size: number; contentType: string; url: string }[] | null
  postfach_id: string | null
  zuordnung_vorschlag: { status?: string; kandidaten?: VorschlagKandidat[] } | null
}

/** Offene Vorschläge (gemeinsames Postfach, noch keiner Akte zugeordnet, nicht ausgeblendet), neueste zuerst. */
export async function ladeMailVorschlaege(limit = 100): Promise<MailMitVorschlag[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('eingegangene_emails')
    .select('id, message_id, von, von_name, betreff, mail_datum, ausschnitt, anhaenge, postfach_id, zuordnung_vorschlag')
    .is('besitzer_email', null)
    .is('zugewiesener_kunde_id', null)
    .or('ignoriert.is.null,ignoriert.eq.false')
    .eq('zuordnung_vorschlag->>status', 'offen')
    .order('mail_datum', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Zeile[]).map((z) => ({
    mail: {
      messageId: z.message_id ?? z.id,
      von: z.von,
      vonName: z.von_name ?? z.von,
      betreff: z.betreff ?? '(ohne Betreff)',
      datum: z.mail_datum,
      ausschnitt: z.ausschnitt ?? '',
      anhaenge: z.anhaenge ?? undefined,
      postfachId: z.postfach_id ?? undefined,
    },
    kandidaten: Array.isArray(z.zuordnung_vorschlag?.kandidaten) ? z.zuordnung_vorschlag!.kandidaten! : [],
  }))
}

/** Vorschlag erledigt: 'uebernommen' (zugeordnet) oder 'verworfen' (keiner der Kandidaten passt). */
export async function setzeVorschlagStand(messageId: string, status: 'uebernommen' | 'verworfen', wer: string): Promise<void> {
  if (!supabase) return
  const { data, error: lesefehler } = await supabase.from('eingegangene_emails').select('zuordnung_vorschlag').eq('message_id', messageId).is('besitzer_email', null).maybeSingle()
  if (lesefehler) throw new Error(lesefehler.message)
  const bisher = (data?.zuordnung_vorschlag ?? {}) as Record<string, unknown>
  const { error } = await supabase
    .from('eingegangene_emails')
    .update({ zuordnung_vorschlag: { ...bisher, status, erledigt_am: new Date().toISOString(), erledigt_von: wer } })
    .eq('message_id', messageId)
    .is('besitzer_email', null)
  if (error) throw new Error(error.message)
}
