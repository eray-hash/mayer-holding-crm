import { callAuthenticated } from './emailGateway'

// Outlook/Hotmail live (Bereich Privat). Server: supabase/functions/email-gateway/outlook.ts.
// Mails von/an Mayer-Adressen und an Mayer weitergeleitete Unterhaltungen liefert der Server gar nicht erst aus.

export type OutlookAdresse = { name: string; adresse: string }
export type OutlookArt = 'code' | 'dringend' | 'rechnung' | 'zahlung' | 'werbung' | 'wichtig' | 'unwichtig'
export type OutlookMail = {
  id: string
  unterhaltung: string
  betreff: string
  von: OutlookAdresse
  an: OutlookAdresse[]
  cc: OutlookAdresse[]
  datum: string
  vorschau: string
  hatAnhaenge: boolean
  gelesen: boolean
  fahne: 'notFlagged' | 'flagged' | 'complete'
  relevant: boolean
  art: OutlookArt
  link: string
  text?: string
}
export type OutlookOrdner = { id: string; name: string; pfad: string; ungelesen: number; gesamt: number }
export type OutlookAnhang = { id: string; name: string; typ: string; groesse: number }

export async function outlookOrdner(): Promise<OutlookOrdner[]> {
  return (await callAuthenticated({ action: 'outlook_ordner' })).ordner ?? []
}

export async function outlookListe(ordner: string, ab = 0, anzahl = 40): Promise<{ mails: OutlookMail[]; ausgeblendet: number; weiter: boolean; naechstesAb: number }> {
  return callAuthenticated({ action: 'outlook_liste', ordner, ab, anzahl })
}

export async function outlookSuche(begriff: string, anzahl = 100): Promise<{ mails: OutlookMail[]; ausgeblendet: number }> {
  return callAuthenticated({ action: 'outlook_suche', begriff, anzahl })
}

export async function outlookMail(id: string, alsGelesen = true): Promise<OutlookMail> {
  return (await callAuthenticated({ action: 'outlook_mail', id, alsGelesen })).mail
}

export async function outlookVerlauf(unterhaltung: string): Promise<OutlookMail[]> {
  return (await callAuthenticated({ action: 'outlook_verlauf', unterhaltung })).mails ?? []
}

export async function outlookAnhaenge(id: string): Promise<OutlookAnhang[]> {
  return (await callAuthenticated({ action: 'outlook_anhaenge', id })).anhaenge ?? []
}

export async function outlookAnhangOeffnen(id: string, anhangId: string): Promise<void> {
  const d = await callAuthenticated({ action: 'outlook_anhang', id, anhangId })
  const roh = atob(d.inhalt ?? '')
  const bytes = new Uint8Array(roh.length)
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: d.typ || 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url
  a.download = d.name || 'Anhang'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function outlookFahne(id: string, status: OutlookMail['fahne']): Promise<void> {
  await callAuthenticated({ action: 'outlook_fahne', id, status })
}

export async function outlookGelesen(id: string, gelesen: boolean): Promise<void> {
  await callAuthenticated({ action: 'outlook_gelesen', id, gelesen })
}

export async function outlookVerschieben(id: string, ordner: string): Promise<void> {
  await callAuthenticated({ action: 'outlook_verschieben', id, ordner })
}

export async function outlookOffenePunkte(tage = 60): Promise<{ mails: OutlookMail[]; ausgeblendet: number; tage: number }> {
  return callAuthenticated({ action: 'outlook_offene_punkte', tage })
}

export async function outlookAblegen(id: string, kundeId: string): Promise<{ ok: boolean; anhaenge?: number; ausgelassen?: string[]; schonAbgelegt?: boolean }> {
  return callAuthenticated({ action: 'outlook_ablegen', id, kundeId })
}

export type MayerRegelAnsicht = { domains: string[]; vorgabeDomains: string[]; eigeneDomains: boolean; adressen: string[]; crmAdressen: number; unterhaltungen: number }

export async function ladeMayerRegel(): Promise<MayerRegelAnsicht> {
  return callAuthenticated({ action: 'outlook_mayer_regel' })
}

export async function speichereMayerRegel(eingabe: { domains: string[]; adressen: string[]; vorgabe: boolean }): Promise<void> {
  await callAuthenticated({ action: 'outlook_mayer_regel_speichern', ...eingabe })
}

export const ART_TEXT: Record<OutlookArt, string> = {
  code: 'Code',
  dringend: 'Dringend',
  rechnung: 'Rechnung',
  zahlung: 'Zahlung',
  werbung: 'Werbung',
  wichtig: 'Wichtig',
  unwichtig: '',
}
