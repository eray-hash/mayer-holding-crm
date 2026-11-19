// Gesendete Mails aus dem Gesendet-Ordner der Postfächer ins CRM holen (Wunsch von Andreas Mayer,
// 19.11.2026): Briefe an Kunden, die über info@amayer-holding.com aus Outlook oder dem Webmailer
// verschickt wurden, kamen nie im CRM an — in `gesendete_emails` stand bisher nur, was über das CRM
// selbst hinausging. Der Assistent konnte sie deshalb auch nicht finden.
//
// - Gemeinsame Postfächer (das Hauptpostfach `standard` und weitere ohne Besitzer): Zeilen ohne
//   `besitzer_email`, sichtbar für alle (in Akten nach den üblichen Bereichsrechten).
// - Persönliche Postfächer: Zeilen mit `besitzer_email` des Besitzers — nur er sieht sie (wie seine
//   abgeholten Eingangs-Mails), bis er sie selbst in den öffentlichen Bereich holt.
// - Doppelt wird nichts: `message_id` (eindeutig) trägt die Message-ID der Mail (persönliche Postfächer
//   mit vorangestellter Postfach-Kennung, wie beim Abruf der Eingangs-Mails). Eine über das CRM
//   verschickte Mail hat dort bisher keine Message-ID — taucht sie im Gesendet-Ordner auf (gleicher
//   Betreff, ein gemeinsamer Empfänger, höchstens fünf Minuten auseinander), bekommt die vorhandene
//   Zeile nur die Message-ID nachgetragen, statt ein zweites Mal angelegt zu werden.
// - Stand je Postfach: eine Buchhaltungszeile in `abteilung_eintraege` (id `gesendet_stand|<Postfach>`,
//   art `gesendet_stand`; Muster wie tagesmeldung_stand/treffer_stand) mit Ordner, UID-Gültigkeit und
//   der höchsten verarbeiteten UID. `postfaecher.ordner_stand` taugt dafür nicht: der Eingangs-Abruf
//   schreibt es als Ganzes zurück und streicht dabei unbekannte Schlüssel, und dem Besitzer werden
//   seine Schlüssel als Ordnernamen angezeigt.
// - Anhänge werden nicht abgelegt, nur mit Namen und Größe im Text vermerkt.
// - Wirft nie. Je Postfach höchstens ~60 s, je Lauf höchstens 200 Mails; der Rest folgt beim nächsten Lauf.
import { ImapFlow } from 'npm:imapflow@1'
import { abzuholendePostfaecher, STANDARD_ID, stelleStandardSicher, type Postfach } from './postfach.ts'

// deno-lint-ignore no-explicit-any
type Db = any
// deno-lint-ignore no-explicit-any
type Teil = any

export type GesendetErgebnis = {
  postfaecher: number
  /** Neu angelegte Zeilen in gesendete_emails. */
  neu: number
  /** Davon (bzw. bei abgeglichenen CRM-Zeilen neu) einer Kundenakte zugeordnet. */
  zugeordnet: number
  /** Über das CRM verschickte Mails, die im Gesendet-Ordner wiedergefunden wurden (nur Message-ID nachgetragen). */
  abgeglichen: number
  fehler: string[]
}

export type GesendetOptionen = {
  /** Nur dieses Postfach (Kennung aus `postfaecher.id`, z. B. 'standard'). */
  postfachId?: string
  /** Erzwingt eine Suche nach Datum über so viele Tage (statt ab dem gemerkten Stand). Höchstens 365. */
  tage?: number
  /** Zeit für den ganzen Lauf (Vorgabe 110 s). */
  budgetMs?: number
  /** Höchstens so viele Mails je Lauf (Vorgabe und Obergrenze 200). */
  hoechstens?: number
  /** Nur für Tests: liefert statt ImapFlow einen nachgebauten Mail-Server. */
  // deno-lint-ignore no-explicit-any
  imapFabrik?: (p: Postfach) => any
}

const STAND_TABELLE = 'abteilung_eintraege'
const STAND_ART = 'gesendet_stand'
const TAGE_STANDARD = 14
const TAGE_ERSTER_LAUF = 60
const JE_POSTFACH_MS = 60000
const GESAMT_MS = 110000
const HOECHSTENS_JE_LAUF = 200
const TEXT_HOECHSTENS = 20000
const TEXTTEIL_BYTES = 300 * 1024
/** Höchster zeitlicher Abstand zwischen CRM-Zeile (Zeitpunkt des Eintrags) und Date-Kopf der Mail. */
export const DOPPEL_TOLERANZ_MS = 5 * 60 * 1000

function standId(postfachId: string): string {
  return `${STAND_ART}|${postfachId}`
}

function zeitlimit<T>(versprechen: Promise<T>, ms: number, meldung: string): Promise<T> {
  let uhr: ReturnType<typeof setTimeout> | undefined
  const grenze = new Promise<T>((_, ablehnen) => {
    uhr = setTimeout(() => ablehnen(new Error(meldung)), ms)
  })
  return Promise.race([versprechen, grenze]).finally(() => clearTimeout(uhr))
}

// ---------------------------------------------------------------------------------------------
// Reine Helfer (ohne Netz, siehe Tests)
// ---------------------------------------------------------------------------------------------

export type OrdnerEintrag = { path?: unknown; specialUse?: unknown; flags?: unknown; delimiter?: unknown }

// In dieser Reihenfolge, falls der Server den Ordner nicht als \Sent kennzeichnet.
const GESENDET_NAMEN = ['gesendete objekte', 'gesendete elemente', 'gesendete nachrichten', 'gesendet', 'sent items', 'sent messages', 'sent mail', 'sent']

/** Der Gesendet-Ordner aus der Ordnerliste des Servers: zuerst die Kennzeichnung \Sent, sonst die üblichen Namen (auch unter dem Posteingang, z. B. "INBOX.Sent"). */
export function findeGesendetOrdner(liste: OrdnerEintrag[]): string | null {
  const waehlbar = (liste ?? []).filter((o) => typeof o?.path === 'string' && o.path !== '' && !(o.flags instanceof Set && o.flags.has('\\Noselect')))
  const markiert = waehlbar.find((o) => String(o.specialUse ?? '') === '\\Sent')
  if (markiert) return String(markiert.path)
  const letzterTeil = (o: OrdnerEintrag) => {
    const pfad = String(o.path)
    const teile = o.delimiter ? pfad.split(String(o.delimiter)) : pfad.split(/[./]/)
    return String(teile[teile.length - 1] ?? pfad).trim().toLowerCase()
  }
  for (const name of GESENDET_NAMEN) {
    // Bei mehreren gleichnamigen der oberste (kürzeste Pfad).
    const treffer = waehlbar.filter((o) => letzterTeil(o) === name).sort((a, b) => String(a.path).length - String(b.path).length)[0]
    if (treffer) return String(treffer.path)
  }
  return null
}

const ADRESSE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

/** Alle E-Mail-Adressen aus einem freien Text ("a@b.de, Name <c@d.de>"), klein geschrieben, ohne Doppelte. */
export function adressenAusText(text: string | null | undefined): string[] {
  const gefunden = String(text ?? '').match(ADRESSE) ?? []
  return [...new Set(gefunden.map((a) => a.toLowerCase().replace(/^[.'-]+|[.'-]+$/g, '')))]
}

export type Empfaenger = { adresse: string; name: string; art: 'an' | 'cc' | 'bcc' }

/** Empfänger aus dem Umschlag der Mail (An, Kopie, Blindkopie — in dieser Reihenfolge), ohne Doppelte. */
// deno-lint-ignore no-explicit-any
export function empfaengerAusUmschlag(umschlag: any): Empfaenger[] {
  const ergebnis: Empfaenger[] = []
  const gesehen = new Set<string>()
  for (const [feld, art] of [['to', 'an'], ['cc', 'cc'], ['bcc', 'bcc']] as const) {
    const liste = Array.isArray(umschlag?.[feld]) ? umschlag[feld] : []
    for (const e of liste) {
      const adresse = adressenAusText(String(e?.address ?? ''))[0]
      if (!adresse || gesehen.has(adresse)) continue
      gesehen.add(adresse)
      ergebnis.push({ adresse, name: String(e?.name ?? '').trim(), art })
    }
  }
  return ergebnis
}

export function normBetreff(betreff: string | null | undefined): string {
  return String(betreff ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export type CrmZeile = { id: string; an: string | null; betreff: string | null; gesendet_am: string }

/**
 * Ist diese Mail aus dem Gesendet-Ordner eine, die schon über das CRM verschickt und in
 * gesendete_emails eingetragen wurde? Gleicher Betreff, mindestens ein gemeinsamer Empfänger,
 * Zeitpunkte höchstens `toleranzMs` auseinander. Bei mehreren die zeitlich nächste. Liefert die id.
 */
export function findeCrmDoppel(
  zeilen: CrmZeile[],
  mail: { betreff: string; datum: string; empfaenger: string[] },
  toleranzMs = DOPPEL_TOLERANZ_MS,
  schonVergeben: Set<string> = new Set(),
): string | null {
  const betreff = normBetreff(mail.betreff)
  const zeit = Date.parse(mail.datum)
  if (Number.isNaN(zeit)) return null
  const empfaenger = new Set(mail.empfaenger.map((a) => a.toLowerCase()))
  let beste: { id: string; abstand: number } | null = null
  for (const z of zeilen) {
    if (schonVergeben.has(z.id)) continue
    if (normBetreff(z.betreff) !== betreff) continue
    const abstand = Math.abs(Date.parse(z.gesendet_am) - zeit)
    if (Number.isNaN(abstand) || abstand > toleranzMs) continue
    if (!adressenAusText(z.an).some((a) => empfaenger.has(a))) continue
    if (!beste || abstand < beste.abstand) beste = { id: z.id, abstand }
  }
  return beste?.id ?? null
}

export type KundeKurz = { id: string; bereich: string; firma?: string | null; ansprechpartner?: string | null; email?: string | null; verantwortlich_email?: string | null }

/** Adresse → Akten mit dieser Adresse (kunden.email kann auch "Name <x@y.de>" oder mehrere Adressen enthalten). */
export function kundenNachAdresse(kunden: KundeKurz[]): Map<string, KundeKurz[]> {
  const index = new Map<string, KundeKurz[]>()
  for (const k of kunden) {
    for (const adresse of adressenAusText(k.email)) {
      const liste = index.get(adresse) ?? []
      if (!liste.some((x) => x.id === k.id)) liste.push(k)
      index.set(adresse, liste)
    }
  }
  return index
}

/**
 * Welcher Akte gehört die Mail? Der erste Empfänger (An vor Kopie vor Blindkopie), dessen Adresse zu
 * genau einer Akte gehört. Interne Adressen (Mitarbeiter, eigene Postfächer) zählen nicht. Private
 * Kontakte (bereich 'privat') nur beim persönlichen Postfach ihres Verantwortlichen — im gemeinsamen
 * Postfach nie (wie ordneOffeneMailsZu).
 */
export function waehleKunde(empfaenger: string[], index: Map<string, KundeKurz[]>, besitzer: string | null, intern: Set<string>): KundeKurz | null {
  const ich = String(besitzer ?? '').trim().toLowerCase()
  for (const roh of empfaenger) {
    const adresse = roh.toLowerCase()
    if (intern.has(adresse)) continue
    const passend = (index.get(adresse) ?? []).filter((k) => k.bereich !== 'privat' || (!!ich && String(k.verantwortlich_email ?? '').trim().toLowerCase() === ich))
    if (passend.length === 1) return passend[0]
  }
  return null
}

export function kundeAnzeigeName(k: KundeKurz): string {
  const firma = String(k.firma ?? '').trim()
  const ap = String(k.ansprechpartner ?? '').trim()
  if (!firma) return ap || 'Unbenannt'
  return ap && ap !== firma ? `${firma} (${ap})` : firma
}

export function textAusHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

function groesse(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Mailtext mit Nachsatz: alle Empfänger (wenn es mehr als einer ist) und die Anhänge, die nicht im CRM liegen. */
export function baueText(text: string, empfaenger: Empfaenger[], anhaenge: { name: string; bytes: number }[]): string {
  const zeilen: string[] = []
  if (empfaenger.length > 1) {
    for (const [art, titel] of [['an', 'An'], ['cc', 'Kopie'], ['bcc', 'Blindkopie']] as const) {
      const liste = empfaenger.filter((e) => e.art === art).map((e) => (e.name && e.name.toLowerCase() !== e.adresse ? `${e.name} <${e.adresse}>` : e.adresse))
      if (liste.length > 0) zeilen.push(`${titel}: ${liste.join(', ')}`)
    }
  }
  if (anhaenge.length > 0) zeilen.push(`Anhänge (nur im Mail-Programm, nicht im CRM gespeichert): ${anhaenge.map((a) => `${a.name} (${groesse(a.bytes)})`).join(', ')}`)
  const nachsatz = zeilen.length > 0 ? `\n\n---\n${zeilen.join('\n')}` : ''
  const rumpf = text.trim() || '(Kein Text — nur Anhänge oder leere Mail.)'
  return rumpf.slice(0, Math.max(0, TEXT_HOECHSTENS - nachsatz.length)) + nachsatz
}

/** Text- und HTML-Teil sowie Anhänge aus der Gliederung der Mail (wie gliedere in postfach.ts). */
export function gliedereGesendet(wurzel: Teil): { text?: Teil; html?: Teil; anhaenge: { name: string; bytes: number }[] } {
  const ergebnis: { text?: Teil; html?: Teil; anhaenge: { name: string; bytes: number }[] } = { anhaenge: [] }
  const gehe = (knoten: Teil) => {
    if (!knoten) return
    if (Array.isArray(knoten.childNodes) && knoten.childNodes.length > 0) {
      knoten.childNodes.forEach(gehe)
      return
    }
    const art = String(knoten.type ?? '').toLowerCase()
    const name = knoten.dispositionParameters?.filename ?? knoten.parameters?.name
    const alsAnhang = String(knoten.disposition ?? '').toLowerCase() === 'attachment' || (!!name && !art.startsWith('text/'))
    if (alsAnhang) {
      // Größe in Übertragungsform (Base64 etwa ein Drittel größer). Bilder ohne Namen sind Signatur-Logos.
      if (name) ergebnis.anhaenge.push({ name: String(name), bytes: Math.round(Number(knoten.size ?? 0) / (String(knoten.encoding ?? '').toLowerCase() === 'base64' ? 1.37 : 1)) })
    } else if (art === 'text/plain' && !ergebnis.text) ergebnis.text = knoten
    else if (art === 'text/html' && !ergebnis.html) ergebnis.html = knoten
  }
  gehe(wurzel)
  return ergebnis
}

// ---------------------------------------------------------------------------------------------
// Passwort (gleiche Ableitung wie in postfach.ts, dort nicht exportiert)
// ---------------------------------------------------------------------------------------------

function vonBase64(text: string): Uint8Array {
  const roh = atob(text)
  const bytes = new Uint8Array(roh.length)
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i)
  return bytes
}

async function passwortFuer(admin: Db, p: Postfach): Promise<string> {
  if (p.geheimnis_name) {
    const wert = Deno.env.get(p.geheimnis_name)
    if (!wert) throw new Error('kein Passwort hinterlegt')
    return wert
  }
  const { data } = await admin.from('postfach_geheimnisse').select('verschluesselt').eq('postfach_id', p.id).maybeSingle()
  if (!data?.verschluesselt) throw new Error('kein Passwort hinterlegt — bitte neu verbinden')
  const dienst = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!dienst) throw new Error('Fehlende Konfiguration: SUPABASE_SERVICE_ROLE_KEY')
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mh-postfach-v1:${dienst}`))
    const schluessel = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['decrypt'])
    const alles = vonBase64(String(data.verschluesselt))
    const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: alles.slice(0, 12) }, schluessel, alles.slice(12))
    return new TextDecoder().decode(klar)
  } catch {
    throw new Error('hinterlegtes Passwort nicht mehr lesbar — bitte neu verbinden')
  }
}

// ---------------------------------------------------------------------------------------------
// Stand je Postfach
// ---------------------------------------------------------------------------------------------

export type GesendetStand = { ordner?: string; g?: number; uid?: number; lauf?: string; fehler?: string | null }

async function ladeStand(admin: Db, postfachId: string): Promise<GesendetStand> {
  try {
    const { data } = await admin.from(STAND_TABELLE).select('daten').eq('id', standId(postfachId)).maybeSingle()
    const d = data?.daten
    return d && typeof d === 'object' && !Array.isArray(d) ? (d as GesendetStand) : {}
  } catch {
    return {}
  }
}

async function speichereStand(admin: Db, postfachId: string, stand: GesendetStand): Promise<void> {
  try {
    const jetzt = new Date().toISOString()
    const { error } = await admin.from(STAND_TABELLE).upsert({ id: standId(postfachId), art: STAND_ART, daten: { ...stand, lauf: jetzt }, updated_at: jetzt })
    if (error) console.error('Gesendet-Abruf: Stand nicht gespeichert', postfachId, error.message)
  } catch (err) {
    console.error('Gesendet-Abruf: Stand nicht gespeichert', postfachId, (err as Error)?.message ?? err)
  }
}

// ---------------------------------------------------------------------------------------------
// Ein Postfach
// ---------------------------------------------------------------------------------------------

type Laufwerte = {
  kundenIndex: Map<string, KundeKurz[]>
  intern: Set<string>
  rest: number
}

function alsText(bytes: Uint8Array, zeichensatz?: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder(zeichensatz || 'windows-1252').decode(bytes)
    } catch {
      return new TextDecoder('windows-1252').decode(bytes)
    }
  }
}

// deno-lint-ignore no-explicit-any
async function ladeText(client: any, uid: number, teil: Teil): Promise<string> {
  const antwort = await client.download(String(uid), teil.part ?? '1', { uid: true, maxBytes: TEXTTEIL_BYTES })
  if (!antwort?.content) return ''
  const stuecke: Uint8Array[] = []
  let laenge = 0
  for await (const stueck of antwort.content) {
    const b = stueck instanceof Uint8Array ? stueck : new TextEncoder().encode(String(stueck))
    stuecke.push(b)
    laenge += b.length
  }
  const bytes = new Uint8Array(laenge)
  let stelle = 0
  for (const b of stuecke) {
    bytes.set(b, stelle)
    stelle += b.length
  }
  return alsText(bytes, antwort.meta?.charset ?? teil.parameters?.charset)
}

function sicheresDatum(wert: unknown, ersatz?: unknown): string {
  for (const w of [wert, ersatz]) {
    if (!w) continue
    const d = w instanceof Date ? w : new Date(typeof w === 'string' || typeof w === 'number' ? w : NaN)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

async function holePostfach(
  admin: Db,
  p: Postfach,
  w: Laufwerte,
  budgetMs: number,
  tageErzwungen: number | undefined,
  imapFabrik?: GesendetOptionen['imapFabrik'],
): Promise<{ neu: number; zugeordnet: number; abgeglichen: number; verarbeitet: number; fehler?: string }> {
  const beginn = Date.now()
  const besitzer = p.besitzer_email ? p.besitzer_email.trim().toLowerCase() : null
  const gemeinsam = !besitzer
  const stand = await ladeStand(admin, p.id)
  let neu = 0
  let zugeordnet = 0
  let abgeglichen = 0
  let verarbeitet = 0
  // deno-lint-ignore no-explicit-any
  let client: any = null
  let ordner: string | null = null
  let gueltig = 0
  let hoechste = 0
  try {
    client = imapFabrik
      ? imapFabrik(p)
      : new ImapFlow({ host: p.imap_host, port: p.imap_port, secure: p.imap_port === 993, auth: { user: p.benutzer || p.adresse, pass: await passwortFuer(admin, p) }, logger: false })
    client.on('error', () => {})
    await zeitlimit(client.connect(), 20000, 'Der Mail-Server hat nach 20 Sekunden nicht geantwortet.')
    // deno-lint-ignore no-explicit-any
    const liste: any[] = await zeitlimit(client.list(), 20000, 'Der Mail-Server hat die Ordnerliste nicht rechtzeitig geliefert.')
    ordner = findeGesendetOrdner(liste)
    if (!ordner) throw new Error('Kein Gesendet-Ordner gefunden.')

    // Nur lesend öffnen: nichts wird als gelesen markiert oder verschoben.
    const sperre = await client.getMailboxLock(ordner, { readOnly: true })
    try {
      gueltig = Number(client.mailbox?.uidValidity ?? 0)
      const standGilt = stand.ordner === ordner && Number(stand.g) === gueltig && Number(stand.uid) > 0
      hoechste = standGilt ? Number(stand.uid) : 0
      const anzahl = Number(client.mailbox?.exists ?? 0)

      let uids: number[] = []
      if (anzahl > 0) {
        if (standGilt && !tageErzwungen) {
          const gefunden = await zeitlimit(client.search({ uid: `${hoechste + 1}:*` }, { uid: true }), 30000, 'Der Mail-Server hat die Suche nicht rechtzeitig beantwortet.')
          // "n:*" liefert laut IMAP immer mindestens die letzte Nachricht — auch wenn sie älter ist.
          uids = (Array.isArray(gefunden) ? gefunden : []).map(Number).filter((u: number) => u > hoechste)
        } else {
          const tage = Math.min(365, Math.max(1, Number(tageErzwungen) || (standGilt ? TAGE_STANDARD : TAGE_ERSTER_LAUF)))
          const seit = new Date(Date.now() - tage * 86400000)
          const gefunden = await zeitlimit(client.search({ since: seit }, { uid: true }), 30000, 'Der Mail-Server hat die Suche nicht rechtzeitig beantwortet.')
          uids = (Array.isArray(gefunden) ? gefunden : []).map(Number).filter((u: number) => u > 0)
        }
      }
      uids = [...new Set(uids)].sort((a, b) => a - b)
      const portion = uids.slice(0, Math.max(0, w.rest))
      if (uids.length === 0) {
        // Nichts Neues: Stand auf die zuletzt vergebene Nummer vorziehen.
        hoechste = Math.max(hoechste, Number(client.mailbox?.uidNext ?? 1) - 1)
      }

      // deno-lint-ignore no-explicit-any
      const mails: { uid: number; envelope: any; bodyStructure: Teil; internalDate: unknown }[] = []
      if (portion.length > 0) {
        const auflisten = async () => {
          for await (const n of client.fetch(portion.join(','), { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
            mails.push({ uid: Number(n.uid), envelope: n.envelope ?? {}, bodyStructure: n.bodyStructure, internalDate: n.internalDate })
          }
        }
        await zeitlimit(auflisten(), 40000, 'Der Mail-Server hat die Liste der gesendeten Mails nicht rechtzeitig geliefert.')
        mails.sort((a, b) => a.uid - b.uid)
        // Zwischen Suche und Abruf gelöscht: nichts zu tun, Stand trotzdem vorziehen.
        if (mails.length === 0) hoechste = Math.max(hoechste, ...portion)
      }

      if (mails.length > 0) {

        const kennungVon = (m: (typeof mails)[number]) => {
          const mid = String(m.envelope?.messageId ?? '').trim()
          if (!mid) return `${p.id}:gesendet:${gueltig}:${m.uid}`
          return gemeinsam ? mid : `${p.id}:${mid}`
        }
        // Schon vorhandene Kennungen in einem Rutsch.
        const vorhanden = new Set<string>()
        const alleKennungen = mails.map(kennungVon)
        for (let i = 0; i < alleKennungen.length; i += 100) {
          const { data } = await admin.from('gesendete_emails').select('message_id').in('message_id', alleKennungen.slice(i, i + 100))
          for (const z of (data ?? []) as { message_id: string }[]) vorhanden.add(z.message_id)
        }
        // Über das CRM verschickte Zeilen ohne Message-ID im Zeitraum dieser Mails (zum Abgleich).
        const daten = mails.map((m) => Date.parse(sicheresDatum(m.envelope?.date, m.internalDate)))
        const vonIso = new Date(Math.min(...daten) - DOPPEL_TOLERANZ_MS * 2).toISOString()
        const bisIso = new Date(Math.max(...daten) + DOPPEL_TOLERANZ_MS * 2).toISOString()
        let crmAbfrage = admin
          .from('gesendete_emails')
          .select('id, an, betreff, gesendet_am, kunde_id')
          .is('message_id', null)
          .gte('gesendet_am', vonIso)
          .lte('gesendet_am', bisIso)
        crmAbfrage = p.id === STANDARD_ID ? crmAbfrage.or(`postfach_id.is.null,postfach_id.eq.${STANDARD_ID}`) : crmAbfrage.eq('postfach_id', p.id)
        const { data: crmDaten } = await crmAbfrage.limit(1000)
        const crmZeilen = (crmDaten ?? []) as (CrmZeile & { kunde_id: string | null })[]
        const vergeben = new Set<string>()

        for (const m of mails) {
          if (Date.now() - beginn > budgetMs) break
          const kennung = kennungVon(m)
          if (vorhanden.has(kennung)) {
            hoechste = Math.max(hoechste, m.uid)
            verarbeitet++
            continue
          }
          const umschlag = m.envelope ?? {}
          const empfaenger = empfaengerAusUmschlag(umschlag)
          const adressen = empfaenger.map((e) => e.adresse)
          const betreff = String(umschlag.subject ?? '').trim() || '(ohne Betreff)'
          const datum = sicheresDatum(umschlag.date, m.internalDate)
          const kunde = waehleKunde(adressen, w.kundenIndex, besitzer, w.intern)

          const doppel = findeCrmDoppel(crmZeilen, { betreff, datum, empfaenger: adressen }, DOPPEL_TOLERANZ_MS, vergeben)
          if (doppel) {
            vergeben.add(doppel)
            const alt = crmZeilen.find((z) => z.id === doppel)
            const nachtrag: Record<string, unknown> = { message_id: kennung }
            if (kunde && !alt?.kunde_id) Object.assign(nachtrag, { kunde_id: kunde.id, kunde_bereich: kunde.bereich, kunde_name: kundeAnzeigeName(kunde) })
            const { error } = await admin.from('gesendete_emails').update(nachtrag).eq('id', doppel).is('message_id', null)
            if (error && error.code !== '23505') throw new Error(`Abgleich nicht gespeichert: ${error.message}`)
            if (!error) {
              abgeglichen++
              if (nachtrag.kunde_id) zugeordnet++
            }
            hoechste = Math.max(hoechste, m.uid)
            verarbeitet++
            continue
          }

          const { text: textTeil, html: htmlTeil, anhaenge } = gliedereGesendet(m.bodyStructure)
          let text = ''
          const quelle = textTeil ?? htmlTeil
          if (quelle) {
            try {
              const roh = await zeitlimit(ladeText(client, m.uid, quelle), 20000, 'Der Mail-Server hat den Text der Mail nicht rechtzeitig geliefert.')
              text = quelle === textTeil ? roh.trim() : textAusHtml(roh)
            } catch (err) {
              // Verbindung weg oder Zeitgrenze: abbrechen, der nächste Lauf versucht diese Mail erneut.
              if (!client?.usable || /rechtzeitig/.test(String((err as Error)?.message ?? ''))) throw err
              text = '(Der Text dieser Mail ließ sich nicht ins CRM übernehmen. Bitte im Mail-Programm öffnen.)'
            }
          }
          const erster = empfaenger.find((e) => e.art === 'an') ?? empfaenger[0]
          const vonAdresse = adressenAusText(String(umschlag.from?.[0]?.address ?? ''))[0] ?? p.adresse.toLowerCase()
          const zeile: Record<string, unknown> = {
            an: erster?.adresse ?? '(unbekannt)',
            an_name: erster ? erster.name || erster.adresse : '(unbekannt)',
            betreff,
            text: baueText(text, empfaenger, anhaenge),
            gesendet_am: datum,
            postfach_id: p.id,
            besitzer_email: besitzer,
            von: vonAdresse,
            message_id: kennung,
            quelle: 'postfach',
            kunde_id: kunde?.id ?? null,
            kunde_bereich: kunde?.bereich ?? null,
            kunde_name: kunde ? kundeAnzeigeName(kunde) : null,
          }
          const { error } = await admin.from('gesendete_emails').insert(zeile)
          // 23505 = gleichzeitiger Lauf hat dieselbe Mail gerade gespeichert — kein Fehler.
          if (error && error.code !== '23505') throw new Error(`Mail konnte nicht gespeichert werden: ${error.message}`)
          if (!error) {
            neu++
            if (kunde) zugeordnet++
          }
          hoechste = Math.max(hoechste, m.uid)
          verarbeitet++
        }
      }
    } finally {
      sperre.release()
    }
    await client.logout().catch(() => {})
    client = null
    await speichereStand(admin, p.id, { ordner, g: gueltig, uid: hoechste, fehler: null })
    return { neu, zugeordnet, abgeglichen, verarbeitet }
  } catch (err) {
    // deno-lint-ignore no-explicit-any
    const e = err as any
    const meldung = e?.authenticationFailed ? 'Anmeldung abgelehnt — das Passwort des Postfachs wurde offenbar geändert.' : String(e?.message ?? err)
    try {
      client?.close()
    } catch {
      // schon geschlossen
    }
    // Fortschritt bis hierher behalten (alles bis `hoechste` ist gespeichert).
    if (ordner && gueltig) await speichereStand(admin, p.id, { ordner, g: gueltig, uid: hoechste, fehler: meldung.slice(0, 300) })
    else await speichereStand(admin, p.id, { ...stand, fehler: meldung.slice(0, 300) })
    return { neu, zugeordnet, abgeglichen, verarbeitet, fehler: meldung }
  }
}

// ---------------------------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------------------------

/** Alle Akten mit hinterlegter Adresse, seitenweise (die Datenbank liefert höchstens 1000 Zeilen je Abfrage). */
async function ladeKundenMitAdresse(admin: Db): Promise<KundeKurz[]> {
  const alle: KundeKurz[] = []
  for (let ab = 0; ab < 50000; ab += 1000) {
    const { data, error } = await admin
      .from('kunden')
      .select('id, bereich, firma, ansprechpartner, email, verantwortlich_email')
      .not('email', 'is', null)
      .order('id')
      .range(ab, ab + 999)
    if (error) throw new Error(`Kundenakten nicht lesbar: ${error.message}`)
    alle.push(...((data ?? []) as KundeKurz[]))
    if (!data || data.length < 1000) break
  }
  return alle
}

/**
 * Holt die gesendeten Mails aller aktiven Postfächer (oder nur von `opts.postfachId`) ins CRM.
 * Wirft nie; Fehler stehen je Postfach in `fehler`.
 */
export async function holeGesendeteMails(admin: Db, opts: GesendetOptionen = {}): Promise<GesendetErgebnis> {
  const ergebnis: GesendetErgebnis = { postfaecher: 0, neu: 0, zugeordnet: 0, abgeglichen: 0, fehler: [] }
  const beginn = Date.now()
  const budget = Math.max(20000, Number(opts.budgetMs) || GESAMT_MS)
  const tage = opts.tage != null && Number(opts.tage) > 0 ? Math.min(365, Math.floor(Number(opts.tage))) : undefined
  try {
    await stelleStandardSicher(admin)
    const faecher = (await abzuholendePostfaecher(admin)).filter((p) => !opts.postfachId || p.id === opts.postfachId)
    if (faecher.length === 0) {
      if (opts.postfachId) ergebnis.fehler.push(`${opts.postfachId}: Postfach nicht gefunden oder nicht aktiv.`)
      return ergebnis
    }
    const [kunden, { data: team }, { data: alleFaecher }] = await Promise.all([
      ladeKundenMitAdresse(admin),
      admin.from('mitarbeiter').select('email'),
      admin.from('postfaecher').select('adresse'),
    ])
    const intern = new Set<string>([
      ...((team ?? []) as { email: string | null }[]).flatMap((m) => adressenAusText(m.email)),
      ...((alleFaecher ?? []) as { adresse: string | null }[]).flatMap((f) => adressenAusText(f.adresse)),
    ])
    const werte: Laufwerte = { kundenIndex: kundenNachAdresse((kunden ?? []) as KundeKurz[]), intern, rest: Math.min(HOECHSTENS_JE_LAUF, Math.max(1, Number(opts.hoechstens) || HOECHSTENS_JE_LAUF)) }

    for (const p of faecher) {
      const rest = budget - (Date.now() - beginn)
      if (rest < 20000 || werte.rest <= 0) break
      const r = await holePostfach(admin, p, werte, Math.min(JE_POSTFACH_MS, rest - 10000), tage, opts.imapFabrik)
      ergebnis.postfaecher++
      ergebnis.neu += r.neu
      ergebnis.zugeordnet += r.zugeordnet
      ergebnis.abgeglichen += r.abgeglichen
      werte.rest -= r.verarbeitet
      if (r.fehler) ergebnis.fehler.push(`${p.adresse}: ${r.fehler}`)
    }
  } catch (err) {
    ergebnis.fehler.push(`Gesendet-Abruf: ${String((err as Error)?.message ?? err)}`)
  }
  return ergebnis
}
