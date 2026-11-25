// Kalender: Termine je Mitarbeiter.
//
// - Tabelle `termine`: gehört dem, der den Termin anlegt (`besitzer_email`); weitere Mitarbeiter
//   stehen in `teilnehmer`. Voll sichtbar ist ein Termin nur für Besitzer und Teilnehmer
//   (Zeilenschutz). Alle anderen sehen über die Datenbankfunktion `kalender_belegt` nur, WANN
//   jemand belegt ist — nie was.
// - Geschrieben wird ausschließlich hier (kein Schreibrecht aus dem Browser): So laufen Prüfung auf
//   Überschneidung, Telegram-Nachricht an die Beteiligten und das Zurücksetzen der Erinnerungen an
//   einer Stelle — egal, ob der Termin aus der Oberfläche, per Telegram oder per Sprache kommt.
// - Erinnerungen: Der Zeitplan ruft jede Minute `sendeErinnerungen`. Jeder stellt für sich ein, wie
//   lange vorher er erinnert werden will (`kalender_einstellungen.erinnerungen`, Minuten, mehrere möglich).
// - Einladung an den Kunden (`gast_einladen`): Ist der Termin mit einer Kundenakte verknüpft, die eine
//   E-Mail-Adresse hat, bekommt der Kunde eine Mail mit Kalenderdatei (.ics, UID `<termin-id>@mayer-holding-crm`).
//   Spätere Änderungen an Zeit/Ort/Titel gehen als Aktualisierung hinterher, Löschen als Absage.
//   Der eingeladene Gast steht in `termine.gast` ({ email, name, eingeladen, sequenz }); `sequenz` zählt bei
//   jeder verschickten Fassung hoch und bleibt auch nach einer Absage stehen, damit eine spätere neue
//   Einladung derselben UID von den Kalendern wieder angenommen wird. Die interne Notiz (`beschreibung`)
//   geht bewusst NICHT an den Kunden.
// - Externe Gäste (23.11.2026): beliebige E-Mail-Adressen in `termine.gaeste` ([{ email, name, eingeladen, sequenz }]).
//   Wie beim Kunden: Einladung mit Kalenderdatei, Änderung als Aktualisierung, Entfernen/Löschen als Absage.
//   Erinnerungsmail an alle eingeladenen Gäste (auch den Kunden) 1 Tag und 1 Stunde vorher; erledigte Vorläufe stehen
//   in `erinnert` unter dem Schlüssel `gast:<adresse>`.
import type { Aufrufer } from './postfach.ts'
import { icsAnhang } from '../_shared/ics.ts'
import { privatBotAktiv, sendePrivat } from '../_shared/telegramPrivat.ts'
import { protokolliereNachricht } from '../_shared/nachrichtenProtokoll.ts'
import { istPrivaterTermin } from '../_shared/privatGrenze.ts'
import { gastWerte, ladeMailVorlage, type MailText, rendere, VORLAGE, type VorlageId } from './automatikVorlagen.ts'

// deno-lint-ignore no-explicit-any
type Db = any

/** Versand einer Mail — wird vom Aufrufer (index.ts) mit dem passenden Absender-Postfach übergeben. */
export type SendeMail = (to: string, subject: string, text: string, anhaenge?: { filename: string; contentBase64: string; contentType: string }[]) => Promise<void>

/** Eingeladener Kunde. Bei aus Einladungen übernommenen Terminen liegt hier außerdem deren Stand
 *  (`extern_sequenz`, `extern_stempel`, siehe _shared/einladung.ts). */
export type TerminGast = { email?: string; name?: string; eingeladen?: boolean; sequenz?: number; extern_sequenz?: number; extern_stempel?: string }

export type Termin = {
  id: string
  titel: string
  beschreibung: string
  ort: string
  beginn: string
  ende: string
  ganztags: boolean
  besitzer_email: string
  teilnehmer: string[]
  kunde_id: string | null
  kunde_bereich: string | null
  kunde_name: string | null
  quelle: string
  erinnert: Record<string, number[]>
  gast?: TerminGast | null
  gaeste?: ExternerGast[] | null
  extern_uid?: string | null
}

/** Externer Gast eines Termins (keine Kundenakte nötig). */
export type ExternerGast = { email: string; name?: string; eingeladen?: boolean; sequenz?: number }

/** Erinnerungsmails an Gäste: 1 Tag und 1 Stunde vorher. */
export const GAST_ERINNERUNGEN = [1440, 60]

type Person = { email: string; name: string; chat: number | string | null }

export const ERLAUBTE_ERINNERUNGEN = [1440, 60, 30, 15]

async function ladeTeam(admin: Db): Promise<Map<string, Person>> {
  const { data } = await admin.from('mitarbeiter').select('name, email, telegram_chat_id').eq('aktiv', true)
  const team = new Map<string, Person>()
  for (const m of (data ?? []) as { name: string; email: string; telegram_chat_id: number | string | null }[]) {
    team.set(String(m.email).toLowerCase(), { email: String(m.email).toLowerCase(), name: m.name, chat: m.telegram_chat_id })
  }
  return team
}

/**
 * Telegram über den Mayer-Bot. `art` = Kennung aus dem Katalog der automatischen Nachrichten (src/lib/automatik/katalog.ts);
 * jede versuchte Nachricht steht danach in nachrichten_protokoll (gesendet oder fehler). Nie für den privaten Bot.
 * `ohneInhalt`: nur DASS die Nachricht ging, nicht ihr Text — für Inhalte nur für Superuser (das Protokoll lesen auch
 * Geschäftsführer, die keine Superuser sind).
 */
export async function sendeTelegram(chat: number | string | null, text: string, art = 'telegram', ohneInhalt = false): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token || !chat) return false
  let ok = false
  try {
    const antwort = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    })
    if (!antwort.ok) console.error('Telegram-Nachricht zum Termin fehlgeschlagen:', antwort.status)
    ok = antwort.ok
  } catch (err) {
    console.error('Telegram-Nachricht zum Termin fehlgeschlagen:', err)
  }
  await protokolliereNachricht({ art, kanal: 'telegram', an_chat: chat, text: ohneInhalt ? NUR_SUPERUSER_TEXT : text, status: ok ? 'gesendet' : 'fehler' })
  return ok
}

export const NUR_SUPERUSER_TEXT = '(Inhalt nur für Superuser — nicht aufgezeichnet)'

/** Wie sendeTelegram, mit fester Katalog-Kennung — zum Übergeben an Module, die nur (chat, text) kennen. */
export function sendeTelegramAls(art: string, ohneInhalt = false): (chat: number | string | null, text: string) => Promise<boolean> {
  return (chat, text) => sendeTelegram(chat, text, art, ohneInhalt)
}

const TAG = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

export function zeitraumText(t: { beginn: string; ende: string; ganztags: boolean }): string {
  const von = new Date(t.beginn)
  const bis = new Date(t.ende)
  if (t.ganztags) {
    const letzter = new Date(bis.getTime() - 60000)
    return TAG.format(von) === TAG.format(letzter) ? `${TAG.format(von)}, ganztägig` : `${TAG.format(von)} bis ${TAG.format(letzter)}, ganztägig`
  }
  return TAG.format(von) === TAG.format(bis) ? `${TAG.format(von)}, ${UHR.format(von)}–${UHR.format(bis)} Uhr` : `${TAG.format(von)} ${UHR.format(von)} Uhr bis ${TAG.format(bis)} ${UHR.format(bis)} Uhr`
}

function terminText(t: Termin, team: Map<string, Person>): string {
  const namen = [t.besitzer_email, ...t.teilnehmer].map((e) => team.get(e)?.name ?? e)
  return [
    t.titel,
    zeitraumText(t),
    t.ort ? `Ort: ${t.ort}` : '',
    t.kunde_name ? `Kunde: ${t.kunde_name}` : '',
    namen.length > 1 ? `Dabei: ${namen.join(', ')}` : '',
    t.beschreibung ? `\n${t.beschreibung.slice(0, 600)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// Wer von den genannten Personen ist im Zeitraum schon belegt? (ohne den Termin selbst)
// Nur Termine mit Uhrzeit blockieren einander. Ganztägige Einträge sind meist Erinnerungen
// („Antwort an … klären“) und dürfen eine Buchung mit Uhrzeit nicht verhindern — so lehnte der
// Assistent am 18.11.2026 eine Besprechung von Andreas wegen seiner ganztägigen Erinnerung ab.
// Umgekehrt blockiert ein neuer ganztägiger Eintrag nichts (der Aufrufer prüft dann gar nicht).
// Private Termine (_shared/privatGrenze.ts) eines Kollegen verraten hier nichts — auch nicht, dass er belegt ist (wie
// kalender_belegt im Assistenten); die eigenen zählen für den Anlegenden selbst (`ich`).
async function findeUeberschneidungen(admin: Db, personen: string[], beginn: string, ende: string, ohneId?: string, ich = ''): Promise<string[]> {
  if (personen.length === 0) return []
  const { data } = await admin.from('termine').select('id, besitzer_email, teilnehmer, kunde_id, kunde_bereich, ms_id').eq('ganztags', false).lt('beginn', ende).gt('ende', beginn)
  const belegt = new Set<string>()
  for (const t of (data ?? []) as { id: string; besitzer_email: string; teilnehmer: string[]; kunde_id: string | null; kunde_bereich: string | null; ms_id: string | null }[]) {
    if (t.id === ohneId) continue
    if (t.besitzer_email.toLowerCase() !== ich && istPrivaterTermin(t)) continue
    for (const p of [t.besitzer_email.toLowerCase(), ...(t.teilnehmer ?? [])]) if (personen.includes(p)) belegt.add(p)
  }
  return [...belegt]
}

export type TerminEingabe = {
  id?: string
  titel?: string
  beschreibung?: string
  ort?: string
  beginn?: string
  ende?: string
  ganztags?: boolean
  teilnehmer?: string[]
  kunde?: { id?: string; bereich?: string; name?: string } | null
  trotzUeberschneidung?: boolean
  quelle?: string
  /** true: den verknüpften Kunden per Mail mit Kalenderdatei einladen. false: eine bestehende Einladung
   *  zurückziehen (Absage an den Kunden). Weggelassen: bisherigen Stand beibehalten. */
  gast_einladen?: boolean
  /** Externe Gäste (E-Mail, optional Name). Angegeben = die vollständige Liste (Neue werden eingeladen, Fehlende
   *  bekommen eine Absage). Weggelassen = unverändert. */
  gaeste?: { email?: string; name?: string }[]
}

export type SpeicherErgebnis =
  | {
      ok: true
      termin: Termin
      benachrichtigt: string[]
      ohneTelegram: string[]
      /** true, wenn bei diesem Speichern eine Einladung (oder Aktualisierung) an den Kunden verschickt wurde. */
      gastEingeladen: boolean
      /** Erklärung, falls eine gewünschte Einladung nicht ging, oder Hinweis auf eine verschickte Absage. */
      gastHinweis?: string
      /** Adressen externer Gäste, an die bei diesem Speichern eine Einladung/Aktualisierung ging. */
      gaesteEingeladen?: string[]
      gaesteHinweis?: string
    }
  | { ok: false; status: number; fehler: string; belegt?: string[] }

const MAIL_MUSTER = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

/** E-Mail-Adresse und Name des Kunden aus der Akte — null, wenn keine Adresse hinterlegt ist. */
async function kundenAdresse(admin: Db, a: Aufrufer, kundeId: string, bereich: string | null): Promise<{ email: string; name: string } | null> {
  let abfrage = admin.from('kunden').select('id, bereich, firma, ansprechpartner, email, verantwortlich_email').eq('id', kundeId)
  if (bereich) abfrage = abfrage.eq('bereich', bereich)
  const { data } = await abfrage.limit(1).maybeSingle()
  if (!data) return null
  // Private Kontakte nur für den, dem sie gehören.
  if (data.bereich === 'privat' && String(data.verantwortlich_email ?? '').toLowerCase() !== a.email) return null
  // Manchmal stehen mehrere Adressen im Feld — die erste gültige.
  const email = String(data.email ?? '')
    .split(/[,;\s]+/)
    .map((x: string) => x.trim().replace(/^<|>$/g, '').toLowerCase())
    .find((x: string) => MAIL_MUSTER.test(x))
  if (!email) return null
  return { email, name: String(data.ansprechpartner || data.firma || '').trim() }
}

function icsFuerGast(t: Termin, organisator: { name: string; email: string }, gast: { email: string; name?: string }, methode: 'REQUEST' | 'CANCEL', sequenz: number) {
  return icsAnhang(
    {
      uid: `${t.id}@mayer-holding-crm`,
      titel: t.titel,
      beginn: t.beginn,
      // Ganztägig: `ende` ist im CRM der Folgetag 0 Uhr; ics.ts erwartet den letzten Tag selbst.
      ende: t.ganztags ? new Date(new Date(t.ende).getTime() - 60000).toISOString() : t.ende,
      ganztags: t.ganztags,
      ort: t.ort || undefined,
      beschreibung: `Termin mit ${organisator.name}`,
      organisator,
      teilnehmer: [{ email: gast.email, name: gast.name || undefined }],
      methode,
      sequenz,
    },
    methode === 'CANCEL' ? 'absage.ics' : 'einladung.ics',
  )
}

/** Gäste-Angaben säubern: „Name <a@b.de>“ oder nur die Adresse; doppelte und ungültige fallen weg. */
export function gaesteAusEingabe(eingabe: { email?: string; name?: string }[] | undefined): { gaeste: { email: string; name: string }[]; ungueltig: string[] } {
  const gaeste: { email: string; name: string }[] = []
  const ungueltig: string[] = []
  for (const g of eingabe ?? []) {
    const roh = String(g?.email ?? '').trim()
    const m = roh.match(/^(.*?)<([^<>]+)>\s*$/)
    const email = (m ? m[2] : roh).trim().toLowerCase()
    const name = String(g?.name ?? (m ? m[1] : '')).trim().replace(/^"|"$/g, '')
    if (!MAIL_MUSTER.test(email)) {
      if (roh) ungueltig.push(roh)
      continue
    }
    if (!gaeste.some((x) => x.email === email)) gaeste.push({ email, name })
  }
  return { gaeste, ungueltig }
}

export function erinnerungsMailText(t: Termin, gastName: string | undefined, absenderName: string, vorlauf: number): { betreff: string; text: string } {
  const zeit = zeitraumText(t)
  const anrede = gastName ? `Guten Tag ${gastName},` : 'Guten Tag,'
  const eckdaten = [t.titel, zeit, t.ort ? `Ort: ${t.ort}` : ''].filter(Boolean).join('\n')
  const wann = vorlauf >= 1440 ? 'bevorstehenden Termin' : 'Termin in einer Stunde'
  return {
    betreff: `Erinnerung: ${t.titel} – ${zeit}`,
    text: `${anrede}\n\nwir möchten Sie an unseren ${wann} erinnern:\n\n${eckdaten}\n\nSollte etwas dazwischengekommen sein, antworten Sie gern einfach auf diese Mail.\n\nMit freundlichen Grüßen\n${absenderName}\nAndreas Mayer Holding`,
  }
}

export function gastMailText(art: 'neu' | 'geaendert' | 'abgesagt', t: Termin, gastName: string | undefined, absenderName: string): { betreff: string; text: string } {
  const zeit = zeitraumText(t)
  const anrede = gastName ? `Guten Tag ${gastName},` : 'Guten Tag,'
  const eckdaten = [t.titel, zeit, t.ort ? `Ort: ${t.ort}` : ''].filter(Boolean).join('\n')
  const gruss = `Mit freundlichen Grüßen\n${absenderName}\nAndreas Mayer Holding`
  if (art === 'abgesagt') {
    return {
      betreff: `Abgesagt: ${t.titel} – ${zeit}`,
      text: `${anrede}\n\nleider müssen wir den folgenden Termin absagen:\n\n${eckdaten}\n\nMit der angehängten Kalenderdatei können Sie den Termin aus Ihrem Kalender entfernen. Für einen neuen Termin melden wir uns gern bei Ihnen.\n\n${gruss}`,
    }
  }
  if (art === 'geaendert') {
    return {
      betreff: `Geänderter Termin: ${t.titel} – ${zeit}`,
      text: `${anrede}\n\nunser gemeinsamer Termin hat sich geändert. Hier die aktuellen Angaben:\n\n${eckdaten}\n\nMit der angehängten Kalenderdatei können Sie Ihren Kalender aktualisieren.\n\n${gruss}`,
    }
  }
  return {
    betreff: `Einladung: ${t.titel} – ${zeit}`,
    text: `${anrede}\n\nhiermit laden wir Sie zu folgendem Termin ein:\n\n${eckdaten}\n\nMit der angehängten Kalenderdatei können Sie den Termin in Ihren Kalender übernehmen. Sollte der Termin für Sie nicht passen, antworten Sie gern einfach auf diese Mail.\n\n${gruss}`,
  }
}

// Bearbeitbare Texte (automatikVorlagen.ts): gastMailText/erinnerungsMailText oben bleiben der feste Ersatz, falls die
// Vorlage fehlt oder nicht lesbar ist.
export type GastArt = 'neu' | 'geaendert' | 'abgesagt'
const GAST_VORLAGE: Record<GastArt, VorlageId> = { neu: VORLAGE.gastEinladung, geaendert: VORLAGE.gastAenderung, abgesagt: VORLAGE.gastAbsage }
const GAST_KATALOG: Record<GastArt, string> = { neu: 'gast_einladung', geaendert: 'gast_aenderung', abgesagt: 'gast_absage' }

/** Lädt jede Vorlage höchstens einmal je Aufruf (und nur, wenn wirklich eine Mail hinausgeht). */
export type VorlagenLader = (id: VorlageId) => Promise<MailText | null>
export function vorlagenLader(admin: Db): VorlagenLader {
  const geladen = new Map<VorlageId, Promise<MailText | null>>()
  return (id) => {
    if (!geladen.has(id)) geladen.set(id, ladeMailVorlage(admin, id))
    return geladen.get(id)!
  }
}

/** Text einer Gast-Mail aus der Vorlage (sonst der feste Text). */
export function gastMail(art: GastArt, t: Termin, gastName: string | undefined, absenderName: string, vorlage: MailText | null): MailText {
  return rendere(vorlage, gastWerte({ titel: t.titel, zeit: zeitraumText(t), ort: t.ort, gastName, absender: absenderName }), () => gastMailText(art, t, gastName, absenderName))
}

/** Text der Erinnerungsmail aus der Vorlage (sonst der feste Text). */
export function erinnerungsMail(t: Termin, gastName: string | undefined, absenderName: string, vorlauf: number, vorlage: MailText | null): MailText {
  return rendere(vorlage, gastWerte({ titel: t.titel, zeit: zeitraumText(t), ort: t.ort, gastName, absender: absenderName, vorlauf }), () => erinnerungsMailText(t, gastName, absenderName, vorlauf))
}

/** Mail an einen Gast senden und aufzeichnen (nachrichten_protokoll). Wirft wie sendeMail, wenn der Versand scheitert. */
async function sendeUndProtokolliere(
  sendeMail: SendeMail,
  art: string,
  gast: { email: string; name?: string },
  mail: MailText,
  anhaenge: Parameters<SendeMail>[3],
  terminId: string,
): Promise<void> {
  const eintrag = { art, kanal: 'mail' as const, an_email: gast.email, an_name: gast.name || null, betreff: mail.betreff, text: mail.text, bezug: { termin_id: terminId } }
  try {
    await sendeMail(gast.email, mail.betreff, mail.text, anhaenge)
  } catch (err) {
    await protokolliereNachricht({ ...eintrag, status: 'fehler' })
    throw err
  }
  await protokolliereNachricht({ ...eintrag, status: 'gesendet' })
}

async function sendeGastMail(
  sendeMail: SendeMail,
  vorlagen: VorlagenLader,
  art: GastArt,
  t: Termin,
  gast: { email: string; name?: string },
  absenderName: string,
  anhang: { filename: string; contentBase64: string; contentType: string },
): Promise<void> {
  const mail = gastMail(art, t, gast.name, absenderName, await vorlagen(GAST_VORLAGE[art]))
  await sendeUndProtokolliere(sendeMail, GAST_KATALOG[art], gast, mail, [anhang], t.id)
}

export async function speichereTermin(admin: Db, a: Aufrufer, e: TerminEingabe, sendeMail?: SendeMail): Promise<SpeicherErgebnis> {
  const titel = String(e.titel ?? '').trim()
  if (!titel) return { ok: false, status: 400, fehler: 'Bitte einen Titel für den Termin angeben.' }
  const beginn = new Date(String(e.beginn ?? ''))
  const ende = new Date(String(e.ende ?? ''))
  if (Number.isNaN(beginn.getTime()) || Number.isNaN(ende.getTime())) return { ok: false, status: 400, fehler: 'Beginn oder Ende des Termins fehlt.' }
  if (ende.getTime() <= beginn.getTime()) return { ok: false, status: 400, fehler: 'Das Ende muss nach dem Beginn liegen.' }
  if (ende.getTime() - beginn.getTime() > 31 * 86400000) return { ok: false, status: 400, fehler: 'Ein Termin darf höchstens 31 Tage dauern.' }

  const team = await ladeTeam(admin)
  const teilnehmer = [...new Set((e.teilnehmer ?? []).map((t) => String(t).trim().toLowerCase()).filter((t) => t && t !== a.email))]
  const unbekannt = teilnehmer.filter((t) => !team.has(t))
  if (unbekannt.length > 0) return { ok: false, status: 400, fehler: `Kein aktiver Mitarbeiter: ${unbekannt.join(', ')}` }

  let vorher: Termin | null = null
  if (e.id) {
    const { data } = await admin.from('termine').select('*').eq('id', e.id).maybeSingle()
    vorher = (data as Termin | null) ?? null
    if (!vorher) return { ok: false, status: 404, fehler: 'Diesen Termin gibt es nicht mehr.' }
    if (vorher.besitzer_email.toLowerCase() !== a.email) return { ok: false, status: 403, fehler: 'Ändern kann einen Termin nur, wer ihn angelegt hat.' }
  }

  const zeitGeaendert = !vorher || new Date(vorher.beginn).getTime() !== beginn.getTime() || new Date(vorher.ende).getTime() !== ende.getTime() || vorher.ganztags !== (e.ganztags === true)
  // Geprüft wird nur, was sich für jemanden ändert: neuer oder verschobener Termin → alle Beteiligten;
  // nur Titel/Ort/Notiz geändert → niemand; neu hinzugekommene Teilnehmer → nur diese.
  if (e.trotzUeberschneidung !== true && e.ganztags !== true) {
    const zuPruefen = zeitGeaendert ? [a.email, ...teilnehmer] : teilnehmer.filter((p) => !(vorher?.teilnehmer ?? []).includes(p))
    const belegt = await findeUeberschneidungen(admin, zuPruefen, beginn.toISOString(), ende.toISOString(), vorher?.id, a.email)
    if (belegt.length > 0) {
      const namen = belegt.map((p) => (p === a.email ? 'du selbst' : team.get(p)?.name ?? p))
      return { ok: false, status: 409, fehler: `In dieser Zeit schon belegt: ${namen.join(', ')}.`, belegt }
    }
  }

  // Vorläufe, die beim Anlegen schon verstrichen sind, gelten als erledigt — sonst käme direkt nach
  // dem Anlegen eines Termins für heute Nachmittag die "1 Tag vorher"-Erinnerung.
  const bisBeginn = (beginn.getTime() - Date.now()) / 60000
  const schonVorbei = ERLAUBTE_ERINNERUNGEN.filter((m) => bisBeginn <= m)
  const erinnertStart: Record<string, number[]> = {}
  for (const person of [a.email, ...teilnehmer]) erinnertStart[person] = schonVorbei
  // Private Kontakte nie an Terminen mit Kollegen (sonst sähen die den Namen).
  if (e.kunde?.bereich === 'privat' && teilnehmer.length > 0) return { ok: false, status: 400, fehler: 'Private Kontakte nur an Terminen ohne Kollegen.' }
  const zeile = {
    titel,
    beschreibung: String(e.beschreibung ?? '').trim(),
    ort: String(e.ort ?? '').trim(),
    beginn: beginn.toISOString(),
    ende: ende.toISOString(),
    ganztags: e.ganztags === true,
    besitzer_email: a.email,
    teilnehmer,
    kunde_id: e.kunde?.id ?? null,
    kunde_bereich: e.kunde?.id ? e.kunde.bereich ?? null : null,
    kunde_name: e.kunde?.id ? e.kunde.name ?? null : null,
    geaendert_am: new Date().toISOString(),
    ...(vorher ? {} : { quelle: String(e.quelle ?? 'crm') }),
    // Verschobener Termin: Erinnerungen von vorn.
    ...(zeitGeaendert ? { erinnert: erinnertStart } : {}),
  }
  const abfrage = vorher ? admin.from('termine').update(zeile).eq('id', vorher.id) : admin.from('termine').insert(zeile)
  const { data: gespeichert, error } = await abfrage.select('*').single()
  if (error || !gespeichert) return { ok: false, status: 500, fehler: `Termin konnte nicht gespeichert werden: ${error?.message ?? 'unbekannter Fehler'}` }
  const termin = gespeichert as Termin

  // Nachricht an alle Beteiligten außer dem, der gerade gespeichert hat. Bei einer Änderung nur,
  // wenn sich für den Empfänger etwas Sichtbares geändert hat (Zeit, Ort, Titel) oder er neu dabei ist.
  const benachrichtigt: string[] = []
  const ohneTelegram: string[] = []
  // Ein reiner Tippfehler im Titel (Groß/Klein, Leerzeichen, Satzzeichen) ist keine Nachricht wert.
  const titelKern = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '')
  const sichtbarGeaendert = !vorher || zeitGeaendert || String(vorher.ort ?? '').trim() !== String(termin.ort ?? '').trim() || titelKern(vorher.titel) !== titelKern(termin.titel)
  for (const p of termin.teilnehmer) {
    const neuDabei = !vorher || !(vorher.teilnehmer ?? []).includes(p)
    if (!neuDabei && !sichtbarGeaendert) continue
    const person = team.get(p)
    const kopf = neuDabei ? `📅 Neuer Termin von ${a.name}` : `📅 Termin geändert von ${a.name}`
    if (await sendeTelegram(person?.chat ?? null, `${kopf}\n\n${terminText(termin, team)}`, 'termin_teilnehmer_info')) benachrichtigt.push(person?.name ?? p)
    else ohneTelegram.push(person?.name ?? p)
  }
  if (vorher) {
    for (const p of (vorher.teilnehmer ?? []).filter((x) => !termin.teilnehmer.includes(x))) {
      await sendeTelegram(team.get(p)?.chat ?? null, `📅 ${a.name} hat dich aus einem Termin genommen\n\n${vorher.titel}\n${zeitraumText(vorher)}`, 'termin_teilnehmer_info')
    }
  }

  const gast = await gastAbgleichen(admin, a, team, e, vorher, termin, sichtbarGeaendert, sendeMail)
  const extern = await gaesteAbgleichen(admin, a, team, e, vorher, gast.termin, sichtbarGeaendert, sendeMail)
  return {
    ok: true,
    termin: extern.termin,
    benachrichtigt,
    ohneTelegram,
    gastEingeladen: gast.eingeladen,
    ...(gast.hinweis ? { gastHinweis: gast.hinweis } : {}),
    ...(extern.eingeladen.length > 0 ? { gaesteEingeladen: extern.eingeladen } : {}),
    ...(extern.hinweis ? { gaesteHinweis: extern.hinweis } : {}),
  }
}

// Einladung des Kunden nach dem Speichern abgleichen: neu einladen, Änderung nachschicken, oder (Kunde
// entfernt/gewechselt, Einladung abgewählt) dem bisherigen Gast absagen. Fehler beim Versand machen das
// Speichern nicht rückgängig, sie landen im Hinweis.
async function gastAbgleichen(
  admin: Db,
  a: Aufrufer,
  team: Map<string, Person>,
  e: TerminEingabe,
  vorher: Termin | null,
  termin: Termin,
  sichtbarGeaendert: boolean,
  sendeMail?: SendeMail,
): Promise<{ termin: Termin; eingeladen: boolean; hinweis?: string }> {
  const bisher: TerminGast = (vorher?.gast ?? {}) as TerminGast
  const alterGast = bisher.eingeladen && bisher.email ? { email: bisher.email, name: bisher.name } : null
  const soll = e.gast_einladen === true || (e.gast_einladen === undefined && !!alterGast)
  if (!soll && !alterGast) return { termin, eingeladen: false }

  const organisator = { name: team.get(a.email)?.name || a.name || a.email, email: termin.besitzer_email.toLowerCase() }
  const vorlagen = vorlagenLader(admin)
  let sequenz = typeof bisher.sequenz === 'number' ? bisher.sequenz : -1
  let neuerGast: { email: string; name: string } | null = null
  const hinweise: string[] = []
  if (soll) {
    if (!termin.kunde_id) hinweise.push('Keine Einladung verschickt: Der Termin ist mit keiner Kundenakte verknüpft.')
    else {
      neuerGast = await kundenAdresse(admin, a, termin.kunde_id, termin.kunde_bereich)
      if (!neuerGast) hinweise.push('Keine Einladung verschickt: In der Kundenakte ist keine E-Mail-Adresse hinterlegt.')
    }
  }
  if (soll && neuerGast && !sendeMail) {
    hinweise.push('Keine Einladung verschickt: Der Mailversand steht an dieser Stelle nicht zur Verfügung.')
    neuerGast = null
  }

  let gastNeu: TerminGast = { ...bisher }
  let eingeladen = false

  // Bisheriger Gast fällt weg (Kunde gewechselt oder entfernt, Einladung abgewählt): absagen. Nicht aber,
  // wenn derselbe Kunde bleibt und nur gerade keine Einladung möglich ist (Adresse fehlt, kein Versand) —
  // dann bleibt die bestehende Einladung stehen.
  const behalten = soll && !neuerGast && termin.kunde_id === vorher?.kunde_id
  if (alterGast && !behalten && (!neuerGast || neuerGast.email !== alterGast.email)) {
    if (sendeMail) {
      sequenz++
      try {
        const vorlage = vorher ?? termin
        await sendeGastMail(sendeMail, vorlagen, 'abgesagt', vorlage, alterGast, organisator.name, icsFuerGast(vorlage, organisator, alterGast, 'CANCEL', sequenz))
        hinweise.push(`Absage an ${alterGast.email} verschickt.`)
        gastNeu = { ...gastNeu, eingeladen: false, sequenz }
      } catch (err) {
        console.error('Absage an den Kunden fehlgeschlagen', termin.id, (err as Error)?.message ?? err)
        hinweise.push(`Die Absage an ${alterGast.email} konnte nicht verschickt werden: ${(err as Error)?.message ?? 'unbekannter Fehler'}`)
        gastNeu = { ...gastNeu, eingeladen: false, sequenz }
      }
    } else {
      gastNeu = { ...gastNeu, eingeladen: false }
    }
  }

  if (neuerGast && sendeMail) {
    const neuDabei = !alterGast || alterGast.email !== neuerGast.email
    if (neuDabei || sichtbarGeaendert) {
      sequenz++
      try {
        await sendeGastMail(sendeMail, vorlagen, neuDabei ? 'neu' : 'geaendert', termin, neuerGast, organisator.name, icsFuerGast(termin, organisator, neuerGast, 'REQUEST', sequenz))
        eingeladen = true
        gastNeu = { ...gastNeu, email: neuerGast.email, name: neuerGast.name, eingeladen: true, sequenz }
      } catch (err) {
        console.error('Einladung an den Kunden fehlgeschlagen', termin.id, (err as Error)?.message ?? err)
        hinweise.push(`Die Einladung an ${neuerGast.email} konnte nicht verschickt werden: ${(err as Error)?.message ?? 'unbekannter Fehler'}`)
        // Nummer trotzdem merken: ging die Mail doch raus, muss die nächste Fassung höher liegen.
        gastNeu = { ...gastNeu, sequenz }
      }
    }
  }

  if (JSON.stringify(gastNeu) !== JSON.stringify(bisher)) {
    const { data, error } = await admin.from('termine').update({ gast: gastNeu }).eq('id', termin.id).select('*').single()
    if (error) console.error('Gast am Termin nicht gespeichert', termin.id, error.message)
    else if (data) termin = data as Termin
  }
  return { termin, eingeladen, ...(hinweise.length > 0 ? { hinweis: hinweise.join(' ') } : {}) }
}

// Externe Gäste abgleichen (wie gastAbgleichen, aber für eine Liste beliebiger Adressen).
async function gaesteAbgleichen(
  admin: Db,
  a: Aufrufer,
  team: Map<string, Person>,
  e: TerminEingabe,
  vorher: Termin | null,
  termin: Termin,
  sichtbarGeaendert: boolean,
  sendeMail?: SendeMail,
): Promise<{ termin: Termin; eingeladen: string[]; hinweis?: string }> {
  const bisher = ((vorher?.gaeste ?? []) as ExternerGast[]).filter((g) => g?.email)
  const soll = e.gaeste === undefined ? bisher.map((g) => ({ email: g.email, name: g.name ?? '' })) : gaesteAusEingabe(e.gaeste).gaeste
  const ungueltig = e.gaeste === undefined ? [] : gaesteAusEingabe(e.gaeste).ungueltig
  const kundeGast = (termin.gast ?? {}) as TerminGast
  if (bisher.length === 0 && soll.length === 0 && ungueltig.length === 0 && !(kundeGast.eingeladen && kundeGast.email)) return { termin, eingeladen: [] }
  const organisator = { name: team.get(a.email)?.name || a.name || a.email, email: termin.besitzer_email.toLowerCase() }
  const hinweise: string[] = ungueltig.length > 0 ? [`Keine gültige E-Mail-Adresse: ${ungueltig.join(', ')}.`] : []
  const vorlagen = vorlagenLader(admin)
  const eingeladen: string[] = []
  const neu: ExternerGast[] = []
  const nachBisher = new Map(bisher.map((g) => [g.email.toLowerCase(), g]))
  // Wegfallende Gäste: Absage.
  for (const g of bisher) {
    if (soll.some((x) => x.email === g.email.toLowerCase())) continue
    if (!g.eingeladen) continue
    if (!sendeMail) { hinweise.push(`Absage an ${g.email} nicht möglich: kein Mailversand.`); continue }
    const sequenz = (typeof g.sequenz === 'number' ? g.sequenz : 0) + 1
    try {
      const vorlage = vorher ?? termin
      await sendeGastMail(sendeMail, vorlagen, 'abgesagt', vorlage, { email: g.email, name: g.name }, organisator.name, icsFuerGast(vorlage, organisator, { email: g.email, name: g.name }, 'CANCEL', sequenz))
      hinweise.push(`Absage an ${g.email} verschickt.`)
    } catch (err) {
      hinweise.push(`Die Absage an ${g.email} konnte nicht verschickt werden: ${(err as Error)?.message ?? 'unbekannter Fehler'}`)
    }
  }
  // Neue und gebliebene Gäste: einladen bzw. Änderung nachschicken.
  const bisBeginn = (new Date(termin.beginn).getTime() - Date.now()) / 60000
  const vorbei = GAST_ERINNERUNGEN.filter((m) => bisBeginn <= m)
  const erinnertNeu: Record<string, number[]> = { ...((termin.erinnert ?? {}) as Record<string, number[]>) }
  for (const g of soll) {
    const alt = nachBisher.get(g.email)
    const name = g.name || alt?.name || ''
    let sequenz = typeof alt?.sequenz === 'number' ? alt.sequenz : -1
    const neuDabei = !alt?.eingeladen
    if ((neuDabei || sichtbarGeaendert) && sendeMail) {
      sequenz++
      try {
        await sendeGastMail(sendeMail, vorlagen, neuDabei ? 'neu' : 'geaendert', termin, { email: g.email, name: name || undefined }, organisator.name, icsFuerGast(termin, organisator, { email: g.email, name }, 'REQUEST', sequenz))
        eingeladen.push(g.email)
        // Vorläufe, die schon verstrichen sind, gelten für diesen Gast als erledigt.
        if (neuDabei || sichtbarGeaendert) erinnertNeu[`gast:${g.email}`] = [...new Set([...(neuDabei ? [] : erinnertNeu[`gast:${g.email}`] ?? []), ...vorbei])]
        neu.push({ email: g.email, name, eingeladen: true, sequenz })
      } catch (err) {
        hinweise.push(`Die Einladung an ${g.email} konnte nicht verschickt werden: ${(err as Error)?.message ?? 'unbekannter Fehler'}`)
        neu.push({ email: g.email, name, eingeladen: alt?.eingeladen ?? false, sequenz })
      }
    } else {
      if ((neuDabei || sichtbarGeaendert) && !sendeMail) hinweise.push(`Keine Einladung an ${g.email}: kein Mailversand an dieser Stelle.`)
      neu.push({ email: g.email, name, eingeladen: alt?.eingeladen ?? false, sequenz: alt?.sequenz })
    }
  }
  // Auch der eingeladene Kunde: keine Erinnerung für Vorläufe, die beim Einladen schon verstrichen waren.
  const kunde = (termin.gast ?? {}) as TerminGast
  if (kunde.eingeladen && kunde.email && erinnertNeu[`gast:${kunde.email.toLowerCase()}`] === undefined) erinnertNeu[`gast:${kunde.email.toLowerCase()}`] = vorbei
  const aenderung: Record<string, unknown> = {}
  if (JSON.stringify(neu) !== JSON.stringify(bisher)) aenderung.gaeste = neu
  if (JSON.stringify(erinnertNeu) !== JSON.stringify(termin.erinnert ?? {})) aenderung.erinnert = erinnertNeu
  if (Object.keys(aenderung).length > 0) {
    const { data, error } = await admin.from('termine').update(aenderung).eq('id', termin.id).select('*').single()
    if (error) console.error('Gäste am Termin nicht gespeichert', termin.id, error.message)
    else if (data) termin = data as Termin
  }
  return { termin, eingeladen, ...(hinweise.length > 0 ? { hinweis: hinweise.join(' ') } : {}) }
}

// Besitzer: Termin absagen (für alle). Teilnehmer: nur sich selbst austragen.
// War ein Kunde eingeladen und ist `sendeMail` übergeben, bekommt er eine Absage mit Kalenderdatei.
export async function loescheTermin(
  admin: Db,
  a: Aufrufer,
  id: string,
  sendeMail?: SendeMail,
): Promise<{ ok: true; art: 'abgesagt' | 'ausgetragen'; gastAbgesagt?: boolean } | { ok: false; status: number; fehler: string }> {
  const { data } = await admin.from('termine').select('*').eq('id', id).maybeSingle()
  const t = data as Termin | null
  if (!t) return { ok: false, status: 404, fehler: 'Diesen Termin gibt es nicht mehr.' }
  const team = await ladeTeam(admin)
  if (t.besitzer_email.toLowerCase() === a.email) {
    const { error } = await admin.from('termine').delete().eq('id', id)
    if (error) return { ok: false, status: 500, fehler: error.message }
    for (const p of t.teilnehmer ?? []) await sendeTelegram(team.get(p)?.chat ?? null, `📅 Termin abgesagt von ${a.name}\n\n${t.titel}\n${zeitraumText(t)}`, 'termin_teilnehmer_info')
    let gastAbgesagt = false
    const vorlagen = vorlagenLader(admin)
    const gast = (t.gast ?? {}) as TerminGast
    if (gast.eingeladen && gast.email && sendeMail) {
      try {
        const organisator = { name: team.get(a.email)?.name || a.name || a.email, email: t.besitzer_email.toLowerCase() }
        await sendeGastMail(sendeMail, vorlagen, 'abgesagt', t, { email: gast.email, name: gast.name }, organisator.name, icsFuerGast(t, organisator, { email: gast.email, name: gast.name }, 'CANCEL', (typeof gast.sequenz === 'number' ? gast.sequenz : 0) + 1))
        gastAbgesagt = true
      } catch (err) {
        console.error('Absage an den Kunden fehlgeschlagen', id, (err as Error)?.message ?? err)
      }
    }
    if (sendeMail) {
      const organisator = { name: team.get(a.email)?.name || a.name || a.email, email: t.besitzer_email.toLowerCase() }
      for (const g of ((t.gaeste ?? []) as ExternerGast[]).filter((x) => x?.eingeladen && x.email)) {
        try {
          await sendeGastMail(sendeMail, vorlagen, 'abgesagt', t, { email: g.email, name: g.name }, organisator.name, icsFuerGast(t, organisator, { email: g.email, name: g.name }, 'CANCEL', (typeof g.sequenz === 'number' ? g.sequenz : 0) + 1))
          gastAbgesagt = true
        } catch (err) {
          console.error('Absage an Gast fehlgeschlagen', id, (err as Error)?.message ?? err)
        }
      }
    }
    return { ok: true, art: 'abgesagt', gastAbgesagt }
  }
  if (!(t.teilnehmer ?? []).includes(a.email)) return { ok: false, status: 403, fehler: 'Das ist nicht dein Termin.' }
  const { error } = await admin.from('termine').update({ teilnehmer: t.teilnehmer.filter((p) => p !== a.email), geaendert_am: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, status: 500, fehler: error.message }
  await sendeTelegram(team.get(t.besitzer_email.toLowerCase())?.chat ?? null, `📅 ${a.name} hat abgesagt\n\n${t.titel}\n${zeitraumText(t)}`, 'termin_teilnehmer_info')
  return { ok: true, art: 'ausgetragen' }
}

function vorlaufText(minuten: number): string {
  if (minuten >= 1440) return 'morgen' // wird unten durch das genaue Datum ergänzt
  if (minuten >= 60) return `in ${Math.round(minuten / 60)} Stunde${minuten >= 120 ? 'n' : ''}`
  return `in ${minuten} Minuten`
}

/** Werte in fester Schlüsselreihenfolge — zum Vergleichen zweier `erinnert`-Stände. */
function stabil(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stabil).join(',')}]`
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stabil((x as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(x ?? null)
}

/**
 * Schreibt `neu` als `erinnert` des Termins — nur, wenn dort noch `alt` steht (sonst war ein anderer Lauf schneller
 * oder der Termin wurde inzwischen verschoben). true = geschrieben. Erst danach wird gesendet: Scheitert das
 * Speichern, geht keine Nachricht raus (vorher kam dieselbe Erinnerung dann jede Minute erneut).
 */
async function beanspruche(admin: Db, id: string, alt: Record<string, number[]> | null, neu: Record<string, number[]>): Promise<boolean> {
  let q = admin.from('termine').update({ erinnert: neu }).eq('id', id)
  q = alt === null ? q.is('erinnert', null) : q.eq('erinnert', JSON.stringify(alt))
  const { data, error } = await q.select('id, erinnert')
  if (!error && Array.isArray(data) && data.length > 0) return true
  // Nichts geschrieben: frisch lesen. Steht dort noch der alte Stand, lag es an der Bedingung selbst (technisch) —
  // dann ohne Bedingung schreiben, damit Erinnerungen nicht dauerhaft ausbleiben. Sonst: jemand anderes war schneller.
  if (error) console.error('Termin-Erinnerung: Stand nicht bedingt speicherbar', id, error.message)
  const { data: frisch, error: lesefehler } = await admin.from('termine').select('id, erinnert').eq('id', id).maybeSingle()
  if (lesefehler || !frisch) return false
  if (stabil(frisch.erinnert ?? null) !== stabil(alt)) return false
  const { data: ohne, error: fehler2 } = await admin.from('termine').update({ erinnert: neu }).eq('id', id).select('id')
  if (fehler2) console.error('Termin-Erinnerung: Stand nicht speicherbar, keine Nachricht', id, fehler2.message)
  return !fehler2 && Array.isArray(ohne) && ohne.length > 0
}

/** Gibt beanspruchte, aber nicht zugestellte Vorläufe wieder frei (nächster Versuch im nächsten Lauf). */
async function gibFrei(admin: Db, id: string, frei: Map<string, number[]>): Promise<void> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const { data: frisch } = await admin.from('termine').select('id, erinnert').eq('id', id).maybeSingle()
    if (!frisch) return
    const alt = (frisch.erinnert ?? {}) as Record<string, number[]>
    const neu: Record<string, number[]> = { ...alt }
    for (const [p, minuten] of frei) neu[p] = (alt[p] ?? []).filter((m) => !minuten.includes(m))
    const { data, error } = await admin.from('termine').update({ erinnert: neu }).eq('id', id).eq('erinnert', JSON.stringify(alt)).select('id')
    if (!error && Array.isArray(data) && data.length > 0) return
  }
  console.error('Termin-Erinnerung: nicht zugestellte Erinnerung nicht freigegeben (geht verloren)', id)
}

export type ErinnerungsVersand = {
  sende?: (chat: number | string | null, text: string) => Promise<boolean>
  sendePrivat?: (chat: number | string | null, text: string) => Promise<boolean>
  hatPrivatBot?: (email: string) => Promise<boolean>
  /** Erinnerungsmails an eingeladene Gäste (Kunde und externe). Ohne: keine Mails an Gäste. */
  sendeMail?: SendeMail
}

// Vom Zeitplan jede Minute gerufen. Je Person und Termin geht pro Lauf höchstens EINE Erinnerung raus:
// die knappste fällige. Größere, ebenfalls schon fällige Vorläufe gelten damit als erledigt — sonst
// kämen bei einem kurzfristig angelegten Termin vier Nachrichten auf einmal.
// Ablauf je Termin: erst den neuen Stand `erinnert` bedingt speichern (beanspruchen), dann senden.
export async function sendeErinnerungen(admin: Db, versand: ErinnerungsVersand = {}): Promise<{ gesendet: number }> {
  const sende = versand.sende ?? sendeTelegramAls('termin_erinnerung')
  // Private Termine (ohne Kollegen, ohne Mayer-Akte) bei Leuten ohne privaten Bot: im Protokoll nur DASS erinnert wurde,
  // nicht der Inhalt — das Protokoll liest die Geschäftsführung (Privates bleibt privat).
  const sendeOhneInhalt = versand.sende ?? sendeTelegramAls('termin_erinnerung', true)
  const sendeP = versand.sendePrivat ?? (async (chat: number | string | null, text: string) => !!(await sendePrivat(chat, text)))
  const jetzt = Date.now()
  const { data } = await admin
    .from('termine')
    .select('*')
    .gt('beginn', new Date(jetzt).toISOString())
    .lt('beginn', new Date(jetzt + 1441 * 60000).toISOString())
  const termine = (data ?? []) as Termin[]
  if (termine.length === 0) return { gesendet: 0 }
  const team = await ladeTeam(admin)
  const { data: einst } = await admin.from('kalender_einstellungen').select('email, erinnerungen')
  const wunsch = new Map<string, number[]>()
  for (const z of (einst ?? []) as { email: string; erinnerungen: number[] }[]) wunsch.set(z.email.toLowerCase(), z.erinnerungen ?? [])

  // Private Termine (eigener Termin ohne Kollegen, ohne Mayer-Akte — z. B. aus Outlook) gehen bei Leuten mit
  // privatem Assistenten nur über diesen, nie über den Mayer-Bot (Erays Regel vom 21.11.2026: Privates bleibt privat).
  const privatAktiv = new Map<string, boolean>()
  const hatPrivatBot = async (email: string) => {
    if (!privatAktiv.has(email)) privatAktiv.set(email, await (versand.hatPrivatBot ? versand.hatPrivatBot(email) : privatBotAktiv(admin, email)).catch(() => false))
    return privatAktiv.get(email)!
  }
  let gesendet = 0
  const vorlagen = vorlagenLader(admin)
  for (const t of termine) {
    const privaterTermin = (t.teilnehmer ?? []).length === 0 && (!t.kunde_id || t.kunde_bereich === 'privat')
    const bisBeginn = (new Date(t.beginn).getTime() - jetzt) / 60000
    const alt = (t.erinnert ?? null) as Record<string, number[]> | null
    const erinnert: Record<string, number[]> = { ...(alt ?? {}) }
    // Erst alles Fällige sammeln und als erledigt vormerken …
    const nachrichten: { p: string; chat: number | string | null; text: string; privat: boolean; privaterInhalt: boolean; faellig: number[] }[] = []
    for (const p of [t.besitzer_email.toLowerCase(), ...(t.teilnehmer ?? [])]) {
      const person = team.get(p)
      if (!person) continue
      const vorlaeufe = (wunsch.get(p) ?? [60]).filter((m) => ERLAUBTE_ERINNERUNGEN.includes(m))
      const schon = erinnert[p] ?? []
      const faellig = vorlaeufe.filter((m) => bisBeginn <= m && !schon.includes(m)).sort((x, y) => x - y)
      if (faellig.length === 0) continue
      const knappste = faellig[0]
      erinnert[p] = [...new Set([...schon, ...faellig])]
      // Ganztägige Termine: nur die Erinnerung am Vortag ist sinnvoll.
      if (t.ganztags && knappste < 1440) continue
      const wann = knappste >= 1440 ? `am ${zeitraumText(t)}` : `${vorlaufText(Math.max(1, Math.round(bisBeginn)))} (${zeitraumText(t)})`
      const text = `⏰ Erinnerung: ${t.titel} ${wann}${t.ort ? `\nOrt: ${t.ort}` : ''}${t.kunde_name ? `\nKunde: ${t.kunde_name}` : ''}`
      const privat = privaterTermin && p === t.besitzer_email.toLowerCase() && (await hatPrivatBot(p))
      nachrichten.push({ p, chat: person.chat, text, privat, privaterInhalt: privaterTermin, faellig })
    }
    // Eingeladene Gäste (Kunde aus der Akte und externe): Erinnerungsmail 1 Tag und 1 Stunde vorher.
    const mails: { schluessel: string; email: string; name?: string; vorlauf: number; faellig: number[] }[] = []
    if (versand.sendeMail) {
      const gaeste: { email: string; name?: string }[] = []
      const kunde = (t.gast ?? {}) as TerminGast
      if (kunde.eingeladen && kunde.email) gaeste.push({ email: kunde.email, name: kunde.name })
      for (const g of (t.gaeste ?? []) as ExternerGast[]) if (g?.eingeladen && g.email && !gaeste.some((x) => x.email === g.email)) gaeste.push({ email: g.email, name: g.name })
      for (const g of gaeste) {
        const schluessel = `gast:${g.email.toLowerCase()}`
        const schon = erinnert[schluessel] ?? []
        const faellig = GAST_ERINNERUNGEN.filter((m) => bisBeginn <= m && !schon.includes(m)).sort((x, y) => x - y)
        if (faellig.length === 0) continue
        erinnert[schluessel] = [...new Set([...schon, ...faellig])]
        if (t.ganztags && faellig[0] < 1440) continue
        mails.push({ schluessel, email: g.email, name: g.name, vorlauf: faellig[0], faellig })
      }
    }
    if (stabil(erinnert) === stabil(alt ?? {})) continue
    // … dann beanspruchen (nur ein Lauf gewinnt, und ohne gespeicherten Stand keine Nachricht) …
    if (!(await beanspruche(admin, t.id, alt, erinnert))) continue
    // … und erst jetzt senden.
    const frei = new Map<string, number[]>()
    for (const n of nachrichten) {
      const ok = n.privat ? await sendeP(n.chat, n.text).catch(() => false) : await (n.privaterInhalt ? sendeOhneInhalt : sende)(n.chat, n.text).catch(() => false)
      if (ok) gesendet++
      // Privat und nicht zugestellt: beim nächsten Lauf erneut versuchen, nie ersatzweise über den Mayer-Bot.
      else if (n.privat) frei.set(n.p, n.faellig)
    }
    if (mails.length > 0 && versand.sendeMail) {
      const absender = team.get(t.besitzer_email.toLowerCase())?.name || 'Ihr Ansprechpartner'
      const vorlage = await vorlagen(VORLAGE.gastErinnerung)
      for (const m of mails) {
        try {
          const mail = erinnerungsMail(t, m.name, absender, m.vorlauf, vorlage)
          await sendeUndProtokolliere(versand.sendeMail, 'gast_erinnerung', { email: m.email, name: m.name }, mail, undefined, t.id)
          gesendet++
        } catch (err) {
          console.error('Erinnerungsmail an Gast fehlgeschlagen', t.id, m.email, (err as Error)?.message ?? err)
          frei.set(m.schluessel, m.faellig)
        }
      }
    }
    if (frei.size > 0) await gibFrei(admin, t.id, frei)
  }
  return { gesendet }
}
