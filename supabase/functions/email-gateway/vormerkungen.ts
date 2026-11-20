// Vormerken und Bestätigen (Regel aus dem Desktop-Assistenten, aktionen.py): Mails senden, Löschen und Termine mit
// Teilnehmern (Einladungen) führt der Assistent nie selbst aus. Er merkt sie vor; ausgeführt wird erst, wenn der
// Besitzer selbst bestätigt — per Klick im CRM (eigener Login) oder per Knopf unter der Telegram-Nachricht.
//
// - Tabelle `vormerkungen` (für den Besitzer lesbar, ohne `freigabe_code`; geschrieben wird nur hier).
// - Telegram-Knopf: `vb:<id>:<code>` (ausführen) / `vv:<id>:<code>` (verwerfen). Der Code steht nur in der
//   Telegram-Nachricht des Besitzers, nie in einer Antwort an die KI — die KI kann deshalb nichts bestätigen.
// - Bestätigen per Dienst-Schlüssel (Telegram-Funktion) geht nur mit diesem Code.
// - Ausführen setzt den Status vorher bedingt auf „laeuft“: zwei gleichzeitige Klicks führen nichts doppelt aus.
import { graph, MsFehler } from '../_shared/microsoft.ts'
import { istMayerMail } from '../_shared/mailRegeln.ts'
import { zufallsKennung } from '../_shared/geheim.ts'
import { ladeMayerRegel } from './outlook.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type Ausfuehrer = (admin: Db, ich: string, p: Record<string, unknown>) => Promise<string>

const ADRESSE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i
const KENNUNG = /^[A-Za-z0-9=_\-+/]{8,400}$/

function adressen(x: unknown, max = 20): string[] {
  const liste = (Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[,;\s]+/) : []).map((a) => String(a ?? '').trim().toLowerCase()).filter(Boolean)
  if (liste.some((a) => !ADRESSE.test(a))) throw new MsFehler(400, `Ungültige E-Mail-Adresse: ${liste.find((a) => !ADRESSE.test(a))}`)
  return [...new Set(liste)].slice(0, max)
}

function mailId(x: unknown): string {
  const s = String(x ?? '')
  if (!KENNUNG.test(s)) throw new MsFehler(400, 'Ungültige Mail-Kennung.')
  return s
}

const empfaenger = (liste: string[]) => liste.map((address) => ({ emailAddress: { address } }))
const alsHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')

type DateiAnhang = { name: string; typ: string; inhalt: string }

/** Anhänge: nur Dokumente eigener privater Kontakte (Ablage kunden-dokumente, Pfad <kundeId>/…). Höchstens 3 MB gesamt (Grenze der Microsoft-Schnittstelle). */
async function ladeAnhaenge(admin: Db, ich: string, x: unknown): Promise<DateiAnhang[]> {
  const liste = Array.isArray(x) ? x.slice(0, 10) : []
  const ergebnis: DateiAnhang[] = []
  let summe = 0
  for (const roh of liste) {
    const a = (roh ?? {}) as Record<string, unknown>
    const pfad = String(a.pfad ?? '')
    const kundeId = pfad.split('/')[0]
    if (!pfad || pfad.includes('..') || !kundeId) throw new MsFehler(400, 'Ungültiger Anhang.')
    const { data: kunde } = await admin.from('kunden').select('bereich, verantwortlich_email').eq('id', kundeId).maybeSingle()
    if (!kunde || kunde.bereich !== 'privat' || String(kunde.verantwortlich_email ?? '').toLowerCase() !== ich) throw new MsFehler(403, 'Anhänge nur aus deinen eigenen privaten Kontakten.')
    const { data, error } = await admin.storage.from('kunden-dokumente').download(pfad)
    if (error || !data) throw new MsFehler(404, `Anhang nicht gefunden: ${a.name ?? pfad}`)
    const bytes = new Uint8Array(await data.arrayBuffer())
    summe += bytes.length
    if (summe > 3 * 1024 * 1024) throw new MsFehler(413, 'Anhänge zusammen über 3 MB — bitte direkt aus Outlook senden.')
    let roh2 = ''
    for (let i = 0; i < bytes.length; i += 0x8000) roh2 += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    ergebnis.push({ name: String(a.name ?? pfad.split('/').pop() ?? 'Anhang'), typ: String(a.typ ?? data.type ?? 'application/octet-stream'), inhalt: btoa(roh2) })
  }
  return ergebnis
}

const dateiAnhaenge = (liste: DateiAnhang[]) => liste.map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.typ, contentBytes: a.inhalt }))

async function nichtMayer(admin: Db, ich: string, id: string): Promise<void> {
  const regel = await ladeMayerRegel(admin, ich)
  const m = await graph(admin, ich, `/me/messages/${encodeURIComponent(id)}?$select=id,conversationId,from,sender,replyTo,toRecipients,ccRecipients`)
  if (istMayerMail(m, regel)) throw new MsFehler(404, 'Diese Mail gehört zum Mayer-Geschäft — nicht aus dem privaten Bereich.')
}

/** Was nach Bestätigung ausgeführt werden kann. Weitere Arten (Aufgaben, Termine) tragen sich in todoAbgleich/kalenderAbgleich ein. */
export const AUSFUEHRER: Record<string, Ausfuehrer> = {
  async mail_senden(admin, ich, p) {
    const an = adressen(p.an)
    if (!an.length) throw new MsFehler(400, 'Kein Empfänger.')
    const cc = adressen(p.cc)
    const anhaenge = await ladeAnhaenge(admin, ich, p.anhaenge)
    await graph(admin, ich, '/me/sendMail', {
      methode: 'POST',
      daten: {
        message: {
          subject: String(p.betreff ?? '').slice(0, 300),
          body: { contentType: 'Text', content: String(p.text ?? '') },
          toRecipients: empfaenger(an),
          ccRecipients: empfaenger(cc),
          attachments: dateiAnhaenge(anhaenge),
        },
        saveToSentItems: true,
      },
    })
    return `Gesendet an ${an.join(', ')}.`
  },
  async mail_antworten(admin, ich, p) {
    const id = mailId(p.mailId)
    await nichtMayer(admin, ich, id)
    const anhaenge = await ladeAnhaenge(admin, ich, p.anhaenge)
    await graph(admin, ich, `/me/messages/${encodeURIComponent(id)}/${p.allen === true ? 'replyAll' : 'reply'}`, {
      methode: 'POST',
      daten: { comment: alsHtml(String(p.text ?? '')), ...(anhaenge.length ? { message: { attachments: dateiAnhaenge(anhaenge) } } : {}) },
    })
    return p.allen === true ? 'Antwort an alle gesendet.' : 'Antwort gesendet.'
  },
  async mail_weiterleiten(admin, ich, p) {
    const id = mailId(p.mailId)
    const an = adressen(p.an)
    if (!an.length) throw new MsFehler(400, 'Kein Empfänger.')
    await nichtMayer(admin, ich, id)
    await graph(admin, ich, `/me/messages/${encodeURIComponent(id)}/forward`, { methode: 'POST', daten: { comment: alsHtml(String(p.text ?? '')), toRecipients: empfaenger(an) } })
    return `Weitergeleitet an ${an.join(', ')}.`
  },
  async mail_loeschen(admin, ich, p) {
    const id = mailId(p.mailId)
    await nichtMayer(admin, ich, id)
    await graph(admin, ich, `/me/messages/${encodeURIComponent(id)}/move`, { methode: 'POST', daten: { destinationId: 'deleteditems' } })
    return 'In „Gelöschte Elemente“ verschoben (dort wiederherstellbar).'
  },
}

/** Prüft die Angaben vorab, damit nichts Unausführbares zur Bestätigung vorgelegt wird. */
function pruefeVorab(art: string, p: Record<string, unknown>): void {
  if (!AUSFUEHRER[art]) throw new MsFehler(400, `Unbekannte Art: ${art}`)
  if (art === 'mail_senden') {
    if (!adressen(p.an).length) throw new MsFehler(400, 'Kein Empfänger.')
    adressen(p.cc)
    if (!String(p.text ?? '').trim()) throw new MsFehler(400, 'Die Mail hat keinen Text.')
  }
  if (art === 'mail_antworten' || art === 'mail_weiterleiten' || art === 'mail_loeschen') mailId(p.mailId)
  if (art === 'mail_weiterleiten' && !adressen(p.an).length) throw new MsFehler(400, 'Kein Empfänger.')
}

/** Kurzfassung für die Bestätigung (Telegram/CRM). */
export function vorschau(art: string, p: Record<string, unknown>): string {
  const text = String(p.text ?? '').trim()
  const kurz = text.length > 700 ? `${text.slice(0, 700)} …` : text
  const anh = Array.isArray(p.anhaenge) && p.anhaenge.length ? `\nAnhänge: ${(p.anhaenge as { name?: string }[]).map((a) => a.name ?? 'Datei').join(', ')}` : ''
  if (art === 'mail_senden') return `An: ${adressen(p.an).join(', ')}${adressen(p.cc).length ? `\nKopie: ${adressen(p.cc).join(', ')}` : ''}\nBetreff: ${String(p.betreff ?? '')}${anh}\n\n${kurz}`
  if (art === 'mail_antworten') return `Antwort${p.allen === true ? ' an alle' : ''} auf: ${String(p.bezug ?? '')}${anh}\n\n${kurz}`
  if (art === 'mail_weiterleiten') return `Weiterleiten an: ${adressen(p.an).join(', ')}\nMail: ${String(p.bezug ?? '')}${kurz ? `\n\n${kurz}` : ''}`
  if (art === 'mail_loeschen') return `Mail: ${String(p.bezug ?? '')}`
  return String(p.bezug ?? '')
}

async function telegramChat(admin: Db, ich: string): Promise<number | null> {
  const muster = ich.replace(/[\\%_]/g, (z) => `\\${z}`)
  const { data } = await admin.from('mitarbeiter').select('telegram_chat_id').ilike('email', muster).maybeSingle()
  return data?.telegram_chat_id ?? null
}

async function telegram(methode: string, daten: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) return null
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${methode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) })
    const j = await r.json().catch(() => null)
    if (!r.ok) console.error(`Telegram ${methode} fehlgeschlagen`, r.status, j?.description)
    return j?.result ?? null
  } catch (e) {
    console.error(`Telegram ${methode} fehlgeschlagen`, e)
    return null
  }
}

export async function merkeVor(admin: Db, ich: string, eingabe: { art: string; beschreibung: string; parameter: Record<string, unknown>; quelle?: string }): Promise<{ id: string; telegram: boolean }> {
  pruefeVorab(eingabe.art, eingabe.parameter)
  const id = `vm_${zufallsKennung(8).replace(/[-_]/g, 'x')}`
  const code = zufallsKennung(9).replace(/[-_]/g, 'y')
  const beschreibung = eingabe.beschreibung.trim().slice(0, 300) || eingabe.art
  const { error } = await admin.from('vormerkungen').insert({ id, besitzer_email: ich, art: eingabe.art, beschreibung, parameter: eingabe.parameter, freigabe_code: code, quelle: eingabe.quelle ?? 'assistent' })
  if (error) throw new Error(`Vormerken fehlgeschlagen: ${error.message}`)
  const chat = await telegramChat(admin, ich)
  if (!chat) return { id, telegram: false }
  const nachricht = await telegram('sendMessage', {
    chat_id: chat,
    text: `⏸ Bitte bestätigen: ${beschreibung}\n\n${vorschau(eingabe.art, eingabe.parameter)}`.slice(0, 4000),
    reply_markup: { inline_keyboard: [[{ text: '✅ Ausführen', callback_data: `vb:${id}:${code}` }, { text: '✖ Verwerfen', callback_data: `vv:${id}:${code}` }]] },
  })
  if (nachricht?.message_id) await admin.from('vormerkungen').update({ telegram_nachricht: { chat, id: nachricht.message_id } }).eq('id', id)
  return { id, telegram: !!nachricht }
}

async function telegramAbschliessen(zeile: { telegram_nachricht?: { chat: number; id: number } | null; beschreibung: string }, text: string) {
  const t = zeile.telegram_nachricht
  if (!t?.chat || !t.id) return
  await telegram('editMessageText', { chat_id: t.chat, message_id: t.id, text: `${text}: ${zeile.beschreibung}`.slice(0, 4000) })
}

export type Ergebnis = { id: string; beschreibung: string; ok: boolean; meldung: string }

/** Führt vorgemerkte Aktionen des Besitzers aus. `code` ist Pflicht, wenn nicht der eigene Login bestätigt (Telegram-Knopf). */
export async function bestaetige(admin: Db, ich: string, ids: string[], code?: string): Promise<Ergebnis[]> {
  const ergebnisse: Ergebnis[] = []
  for (const id of ids.slice(0, 20)) {
    let abfrage = admin.from('vormerkungen').update({ status: 'laeuft' }).eq('id', id).eq('besitzer_email', ich).eq('status', 'offen')
    if (code !== undefined) abfrage = abfrage.eq('freigabe_code', code)
    const { data } = await abfrage.select('id, art, beschreibung, parameter, telegram_nachricht')
    const zeile = data?.[0]
    if (!zeile) {
      ergebnisse.push({ id, beschreibung: '', ok: false, meldung: 'Nicht mehr offen (schon erledigt oder verworfen).' })
      continue
    }
    try {
      const meldung = await AUSFUEHRER[zeile.art](admin, ich, zeile.parameter ?? {})
      await admin.from('vormerkungen').update({ status: 'ausgefuehrt', ergebnis: meldung, erledigt_am: new Date().toISOString() }).eq('id', id)
      await telegramAbschliessen(zeile, '✅ Ausgeführt')
      ergebnisse.push({ id, beschreibung: zeile.beschreibung, ok: true, meldung })
    } catch (e) {
      const meldung = e instanceof Error ? e.message : String(e)
      // Wieder offen: ein Fehler (z. B. Microsoft kurz nicht erreichbar) darf die Aktion nicht verschlucken.
      await admin.from('vormerkungen').update({ status: 'offen', ergebnis: `Fehler: ${meldung}`.slice(0, 500) }).eq('id', id)
      ergebnisse.push({ id, beschreibung: zeile.beschreibung, ok: false, meldung })
    }
  }
  return ergebnisse
}

export async function verwerfe(admin: Db, ich: string, ids: string[], code?: string): Promise<number> {
  let n = 0
  for (const id of ids.slice(0, 50)) {
    let abfrage = admin.from('vormerkungen').update({ status: 'verworfen', erledigt_am: new Date().toISOString() }).eq('id', id).eq('besitzer_email', ich).eq('status', 'offen')
    if (code !== undefined) abfrage = abfrage.eq('freigabe_code', code)
    const { data } = await abfrage.select('beschreibung, telegram_nachricht')
    if (data?.[0]) {
      n++
      await telegramAbschliessen(data[0], '✖ Verworfen')
    }
  }
  return n
}

export async function offeneVormerkungen(admin: Db, ich: string) {
  const { data } = await admin
    .from('vormerkungen')
    .select('id, art, beschreibung, parameter, quelle, status, ergebnis, erstellt_am, erledigt_am')
    .eq('besitzer_email', ich)
    .order('erstellt_am', { ascending: false })
    .limit(40)
  return ((data ?? []) as Record<string, unknown>[]).map((z) => ({ ...z, vorschau: vorschau(String(z.art), (z.parameter ?? {}) as Record<string, unknown>) }))
}
