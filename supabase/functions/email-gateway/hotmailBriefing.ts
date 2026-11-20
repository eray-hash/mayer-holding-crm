// Hotmail-Teil der Morgen-Übersicht (Telegram) — Vorbild mail_briefing.py des Desktop-Assistenten.
//
// - Nur für Freigeschaltete (MS_ERLAUBT) mit verbundenem Microsoft-Konto; Mayer-Geschäft ausgeblendet.
// - Grundlage: Posteingang seit dem letzten Werktagmorgen; Outlooks „Relevant“, „Andere“ nur bei Rechnung/Mahnung.
// - Nie Anmeldecodes, nie Beträge oder Kontonummern (ohneBetraege), nur Betreff und Absender — keine Mailtexte.
// - Termine und To Do stehen schon über den Abgleich im CRM und erscheinen dort in der Übersicht.
// - Wirft nie: bei einem Fehler eine Zeile mit Hinweis statt der Liste.
import { graphAlle, msErlaubt } from '../_shared/microsoft.ts'
import { einordnen, filtereMayer, ohneBetraege, type GraphMail } from '../_shared/mailRegeln.ts'
import { ladeMayerRegel } from './outlook.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type Abschnitt = { titel: string; zeilen: string[] }

const FELDER = 'id,conversationId,subject,from,sender,replyTo,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,flag,inferenceClassification'

function absender(m: GraphMail): string {
  const a = m.from?.emailAddress
  return String(a?.name || a?.address || '?').slice(0, 40)
}

const zeile = (m: GraphMail) => `• ${ohneBetraege(String(m.subject || '(ohne Betreff)')).slice(0, 70)} — ${absender(m)}`

/** Seit wann gilt eine Mail als neu: montags seit Freitag 8 Uhr, sonst seit gestern 8 Uhr. */
export function seitWann(jetzt: Date): Date {
  const tag = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short' }).format(jetzt)
  const stunden = tag === 'Mon' ? 72 : 24
  return new Date(jetzt.getTime() - stunden * 3600_000)
}

export async function hotmailAbschnitte(admin: Db, email: string, jetzt = new Date()): Promise<Abschnitt[]> {
  const ich = email.toLowerCase()
  if (!msErlaubt(ich)) return []
  const { data: konto } = await admin.from('ms_konten').select('login_email').eq('login_email', ich).maybeSingle()
  if (!konto) return []
  try {
    const regel = await ladeMayerRegel(admin, ich)
    const seit = seitWann(jetzt).toISOString()
    const [neu, markiert] = await Promise.all([
      graphAlle<GraphMail & { id: string }>(admin, ich, `/me/mailFolders/inbox/messages?$select=${FELDER}&$top=100&$filter=receivedDateTime ge ${seit}&$orderby=receivedDateTime desc`, 300),
      graphAlle<GraphMail & { id: string }>(admin, ich, `/me/messages?$select=${FELDER}&$top=100&$filter=flag/flagStatus eq 'flagged'`, 300),
    ])
    const sichtbar = filtereMayer(neu, regel).sichtbar
    const dringend = sichtbar.filter((m) => einordnen(m) === 'dringend')
    const rechnungen = sichtbar.filter((m) => einordnen(m) === 'rechnung')
    const wichtig = sichtbar.filter((m) => einordnen(m) === 'wichtig' && !m.isRead)
    const offen = filtereMayer(markiert, regel).sichtbar.length
    const abschnitte: Abschnitt[] = []
    if (dringend.length) abschnitte.push({ titel: 'Hotmail — dringend (Mahnung, Frist, Amt)', zeilen: dringend.map(zeile) })
    if (rechnungen.length) abschnitte.push({ titel: 'Hotmail — neue Rechnungen', zeilen: rechnungen.map(zeile) })
    if (wichtig.length) abschnitte.push({ titel: `Hotmail — ${wichtig.length} neue wichtige Mail${wichtig.length === 1 ? '' : 's'}`, zeilen: wichtig.map(zeile) })
    if (offen) abschnitte.push({ titel: `Hotmail — ${offen} markierte Mail${offen === 1 ? '' : 's'} noch offen (CRM: Privat → Offene Punkte)`, zeilen: [] })
    return abschnitte
  } catch (e) {
    console.error('Hotmail-Teil der Morgen-Übersicht fehlgeschlagen', ich, e instanceof Error ? e.message : e)
    return [{ titel: 'Hotmail — gerade nicht erreichbar (im CRM unter Privat → Einstellungen prüfen)', zeilen: [] }]
  }
}
