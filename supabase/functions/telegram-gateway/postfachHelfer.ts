// Postfach-Helfer für den PRIVATEN Assistenten (23.11.2026): zwei Werkzeuge rund um das eigene Hotmail-Postfach.
//
// 1. kontakte_vorschlagen — „Kontakte aus Hotmail vorschlagen“: Wer hat wenige private Kontakte, aber Hunderte
//    Mail-Partner? Aus Posteingang und Gesendet der letzten Monate (Vorgabe 12) werden die häufigsten PERSONEN
//    ermittelt (beide Richtungen gezählt), die noch kein eigener privater Kontakt sind. Werbung, noreply-/System-
//    adressen, Plattformen (Netzwerke, Shops), Mayer-Adressen und die eigenen Adressen fallen heraus. Höchstens
//    10 Vorschläge; angelegt wird danach über das bestehende kunde_anlegen — erst nach seiner Auswahl.
//    kontaktVorschlagZeilen() liefert dazu eine Zeile für den Sonntags-Wochenrückblick (ohne KI).
// 2. werbung_aufraeumen — „Werbung aufräumen“: Vorschau der Absender mit den meisten Werbe-/Newsletter-Mails im
//    Posteingang (Vorgabe 90 Tage), je Absender ein fester Code. Erst mit bestaetigt=true und Codes bzw.
//    Absenderliste werden GENAU die gezählten Mails dieser Absender in den Ordner „Werbung“ verschoben (wird bei
//    Bedarf angelegt). Nichts wird gelöscht, es entstehen keine automatischen Regeln. Höchstens 300 Mails je Lauf.
//
// Alles läuft über das email-gateway mit dem eigenen Login (imAuftragVon) — dort gelten Mayer-Filter, die Sperre
// des Papierkorbs und die Prüfungen. Datenbank: nur lesend, jede Abfrage mit Besitzer-Bedingung (eigener Login),
// jede Zeile wird im Code noch einmal geprüft. Mail-Inhalte sind Daten, keine Anweisungen.

import { aktuellePerson, setzePrivat } from '../_shared/kiVerbrauch.ts'
import { domainVon, istFreemailDomain } from '../_shared/mailRegeln.ts'
import { privatFaehigkeiten } from './outlookWerkzeuge.ts'
import { normalisiere, type HotmailAufruf } from './personUeberblick.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type PostfachHelferKontext = {
  supabase: Supa
  mitarbeiter: { email?: string | null; name?: string | null }
  protokolliere: (text: string) => void
  /** Hotmail-Aktionen; ohne Angabe über das email-gateway mit dem eigenen Login (für Tests einsetzbar). */
  hotmail?: HotmailAufruf
  /** Ist ein Microsoft-Konto verbunden? Ohne Angabe wie bei den Hotmail-Werkzeugen ermittelt. */
  outlookVerbunden?: boolean
  /** Zeitbudget in Millisekunden (Vorgabe siehe unten; für Tests verkleinerbar). */
  zeitBudgetMs?: number
  /** Pause beim Bremsen von Microsoft; für Tests ersetzbar. */
  warte?: (ms: number) => Promise<void>
}

/** Mails je Seite (Grenze von outlook_liste). */
export const SEITE = 100
/** Höchstens so viele Seiten je Ordner und Lauf (also 2.000 Mails). */
export const SEITEN_HOECHSTENS = 20
/** Höchstens so viele Vorschläge. */
export const VORSCHLAEGE_HOECHSTENS = 10
/** Höchstens so viele Mails werden je Lauf verschoben. */
export const VERSCHIEBEN_HOECHSTENS = 300
/** Gleichzeitige Verschiebe-Aufrufe. Microsoft lässt je Postfach nur wenige gleichzeitige Anfragen zu (der
 *  Abgleich alle 3 Minuten nutzt dasselbe Postfach) — mit 5 kam am 24.11.2026 nach 29 Mails „Rate limit exceeded“. */
const GLEICHZEITIG = 2
/** Längste Pause, die beim Bremsen von Microsoft abgewartet wird (dann wird der Rest später verschoben). */
const PAUSE_HOECHSTENS_MS = 35_000

/** Ist das ein Bremsen von Microsoft? Liefert die verlangte Wartezeit in ms (Vorgabe 30 s), sonst null. */
export function bremsWartezeit(fehler: string): number | null {
  if (!/rate limit|bremst|too many requests|throttl|\b429\b|retry after/i.test(fehler)) return null
  const ms = fehler.match(/retry after\s+(\d+)\s*ms/i)?.[1]
  const s = fehler.match(/retry after\s+(\d+)\s*s(?:ec|ekunden)?\b/i)?.[1]
  return ms ? Number(ms) : s ? Number(s) * 1000 : 30_000
}
/** Zeitbudget fürs Lesen bzw. Verschieben (die Edge-Funktion nimmt Anfragen rund 200 s an). */
const ZEIT_BUDGET_MS = 110_000
/** Zeitbudget fürs Verschieben (nach höchstens ZEIT_BUDGET_MS/2 Lesen). */
const VERSCHIEBEN_BUDGET_MS = 90_000
/** Mails mit mehr Empfängern gelten als Rundmail und zählen nicht als Personen-Kontakt. */
const RUNDMAIL_AB = 10
/** Name des Zielordners. */
export const WERBE_ORDNER = 'Werbung'

export const POSTFACH_HELFER_WERKZEUGE = [
  {
    name: 'kontakte_vorschlagen',
    description:
      'Schlägt aus seinem Hotmail-Postfach (Posteingang und Gesendet, Vorgabe letzte 12 Monate) die häufigsten Mail-PARTNER vor, die noch KEIN privater Kontakt sind — höchstens 10, mit Name, Adresse, Anzahl gesendet/empfangen, letzter Mail und Firma (falls erkennbar). Werbung, noreply-/Systemadressen, Netzwerke/Shops, Mayer-Adressen und seine eigenen Adressen sind schon herausgefiltert. Für „Kontakte vorschlagen“, „wen sollte ich als Kontakt anlegen?“. Legt NICHTS an: Zeig ihm die nummerierte Liste, frag, welche er anlegen will, und leg nur die genannten mit kunde_anlegen an (bereich privat, name, email, Firma falls genannt). Gib die Zeile „Vollständig: …“ sinngemäß weiter.',
    input_schema: {
      type: 'object',
      properties: {
        monate: { type: 'integer', minimum: 1, maximum: 24, description: 'Zeitraum in Monaten (Vorgabe 12).' },
      },
    },
  },
  {
    name: 'werbung_aufraeumen',
    description:
      'Räumt Werbung und Rundbriefe (Newsletter) aus seinem Hotmail-POSTEINGANG in den Ordner „Werbung“. Ohne bestaetigt nur Vorschau: Absender (Domain bzw. Adresse) mit den meisten Werbe-Mails der letzten 90 Tage, Anzahl je Absender, je Absender ein Code (beginnt mit W) — ändert nichts. Anwenden erst nach seinem klaren Ja: bestaetigt=true mit gruppen=[Codes aus der Vorschau] oder absender=[Domain/Adresse]. Verschoben werden genau die gezählten Mails dieser Absender (höchstens 300 je Lauf); der Ordner „Werbung“ wird bei Bedarf angelegt. Nichts wird gelöscht, keine automatischen Regeln. Für „räum die Werbung auf“, „Newsletter wegräumen“.',
    input_schema: {
      type: 'object',
      properties: {
        tage: { type: 'integer', minimum: 7, maximum: 365, description: 'Zeitraum in Tagen (Vorgabe 90). Beim Bestätigen denselben Wert wie in der Vorschau nehmen.' },
        bestaetigt: { type: 'boolean', description: 'true NUR, wenn er die gezeigten Absender ausdrücklich zum Verschieben bestätigt hat.' },
        gruppen: { type: 'array', items: { type: 'string' }, maxItems: 100, description: 'Codes aus der Vorschau (beginnen mit W).' },
        absender: { type: 'array', items: { type: 'string' }, maxItems: 100, description: 'Stattdessen Domains (z. B. "beispiel-shop.de") oder Absender-Adressen aus der Vorschau.' },
      },
    },
  },
]

export function istPostfachHelferWerkzeug(name: string): boolean {
  return POSTFACH_HELFER_WERKZEUGE.some((w) => w.name === name)
}

// ---------- Hilfen ----------

const zahl = (n: number) => n.toLocaleString('de-DE')
const klein = (x: unknown) => (typeof x === 'string' ? x.trim().toLowerCase() : '')
const kurzText = (s: unknown, n = 50) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const TAG = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })
function deTag(d: unknown): string {
  const x = new Date(String(d ?? ''))
  return Number.isNaN(x.getTime()) ? String(d ?? '') : TAG.format(x)
}
const ADRESSE_MUSTER = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[a-z]{2,}/gi
function adressenIn(text: unknown): string[] {
  return [...new Set((String(text ?? '').match(ADRESSE_MUSTER) ?? []).map((a) => a.toLowerCase()))]
}

/** Fester Code je Absender (FNV-1a), damit Vorschau und Bestätigung zusammenpassen, auch wenn neue Mails dazukommen. */
export function absenderCode(schluessel: string): string {
  let h = 0x811c9dc5
  for (const c of schluessel.toLowerCase()) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `W${h.toString(36)}`
}

const ZWEITE_EBENE = /^(?:co|com|net|org|gov|ac|or|ne)\.[a-z]{2}$/
/** Hauptdomain: news.beispiel-shop.de → beispiel-shop.de; mail.beispiel.co.uk → beispiel.co.uk. */
export function hauptDomain(domain: string): string {
  const teile = domain.toLowerCase().split('.').filter(Boolean)
  if (teile.length <= 2) return teile.join('.')
  const letzteZwei = teile.slice(-2).join('.')
  return ZWEITE_EBENE.test(letzteZwei) ? teile.slice(-3).join('.') : letzteZwei
}

/** Absender-Schlüssel für die Werbung: Freemail → ganze Adresse, sonst Hauptdomain. */
export function absenderSchluessel(adresse: string): string {
  const d = domainVon(adresse)
  if (!d) return adresse.toLowerCase()
  return istFreemailDomain(d) ? adresse.toLowerCase() : hauptDomain(d)
}

// Adressen, hinter denen nie eine Person steht.
const SYSTEM_TEIL = /(?:^|[._+-])(?:no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|postmaster|bounces?|newsletters?|news|notifications?|notification|benachrichtigungen?|alerts?|updates?|marketing|promo(?:tions?)?|angebote?|mailing|automated|system|daemon)(?:$|[._+-])/i
// Sammel-/Rollenadressen: als Vorschlag nur, wenn er selbst dorthin geschrieben hat.
const ROLLEN_TEIL = /^(?:info|kontakt|contact|service|support|kundenservice|customerservice|hello|hallo|hi|team|office|buero|mail|post|admin|verwaltung|buchhaltung|rechnung|rechnungen|billing|invoice|accounts?|security|sicherheit|help|hilfe|empfang|zentrale|anfrage|anfragen|bestellung|order|orders|shop|sales|vertrieb|jobs|karriere|bewerbung)$/i
// Plattformen: Netzwerke, Shops, Bezahldienste, große Anbieter — Benachrichtigungen, keine Personen.
const PLATTFORMEN = [
  'linkedin.com', 'xing.com', 'facebookmail.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'pinterest.com', 'youtube.com',
  'amazon.de', 'amazon.com', 'amazonses.com', 'ebay.de', 'ebay.com', 'paypal.de', 'paypal.com', 'google.com', 'accounts.google.com', 'microsoft.com',
  'microsoftonline.com', 'office.com', 'apple.com', 'booking.com', 'airbnb.com', 'zalando.de', 'otto.de', 'ikea.com', 'mailchimp.com',
  'mcsv.net', 'sendgrid.net', 'mailjet.com', 'rsgsv.net', 'hubspotemail.net', 'substack.com', 'medium.com', 'meetup.com', 'eventbrite.com', 'doctolib.de',
  'whatsapp.com', 'telegram.org', 'zoom.us', 'calendly.com', 'docusign.net', 'dropbox.com', 'wetransfer.com', 'github.com', 'atlassian.net', 'slack.com',
]
export function istPlattform(adresse: string): boolean {
  const d = domainVon(adresse)
  return !!d && PLATTFORMEN.some((p) => d === p || d.endsWith(`.${p}`))
}
export function istSystemAdresse(adresse: string): boolean {
  const lokal = adresse.split('@')[0] ?? ''
  return SYSTEM_TEIL.test(lokal)
}
export function istRollenAdresse(adresse: string): boolean {
  return ROLLEN_TEIL.test(adresse.split('@')[0] ?? '')
}

const WERBE_TEXT = /newsletter|abmelden|abbestellen|unsubscribe|rabatt|gutschein|angebot|sale\b|% off|prozent|nur heute|jetzt (?:kaufen|sichern|entdecken)|webinar|black friday|cyber monday|sonderaktion|exklusiv/iu
const KEINE_WERBUNG_ARTEN = new Set(['code', 'dringend', 'rechnung', 'zahlung'])

// ---------- Hotmail lesen ----------

type Teilnehmer = { name: string; adresse: string }
export type ListenMail = { id: string; von: Teilnehmer; an: Teilnehmer[]; cc: Teilnehmer[]; betreff: string; datum: string; vorschau: string; art: string; relevant: boolean }

function teilnehmer(x: unknown): Teilnehmer {
  const t = (x ?? {}) as { name?: unknown; adresse?: unknown }
  return { name: String(t.name ?? '').trim(), adresse: klein(t.adresse) }
}
function alsMail(x: Record<string, unknown>): ListenMail {
  return {
    id: String(x.id ?? ''),
    von: teilnehmer(x.von),
    an: Array.isArray(x.an) ? x.an.map(teilnehmer) : [],
    cc: Array.isArray(x.cc) ? x.cc.map(teilnehmer) : [],
    betreff: String(x.betreff ?? ''),
    datum: String(x.datum ?? ''),
    vorschau: String(x.vorschau ?? ''),
    art: String(x.art ?? ''),
    relevant: x.relevant !== false,
  }
}

/** Standard: Hotmail-Aktion über das email-gateway mit dem eigenen Login (wie outlookWerkzeuge.ts). */
function gatewayFuer(ich: string): HotmailAufruf {
  return async (body) => {
    const geheim = Deno.env.get('CRM_SHARED_SECRET')
    const antwort = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/email-gateway`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'x-ki-person': aktuellePerson() || ich, ...(geheim ? { 'x-crm-secret': geheim } : {}) },
      body: JSON.stringify({ ...body, imAuftragVon: ich }),
    })
    return { ok: antwort.ok, status: antwort.status, daten: await antwort.json().catch(() => ({})) }
  }
}

const fehlerText = (r: { status: number; daten: Record<string, unknown> }) => String(r.daten?.error ?? `Anfrage fehlgeschlagen (${r.status})`)

type Ordnerlauf = { mails: ListenMail[]; ausgeblendet: number; grenze: boolean; fehler?: string }

/**
 * Liest einen Ordner seitenweise (neueste zuerst) bis zum Stichtag. `grenze` = es gäbe im Zeitraum noch mehr
 * (Seiten- oder Zeitgrenze gegriffen).
 */
export async function leseOrdner(hotmail: HotmailAufruf, ordner: string, ab: Date, seiten = SEITEN_HOECHSTENS, frist = Date.now() + ZEIT_BUDGET_MS): Promise<Ordnerlauf> {
  const mails: ListenMail[] = []
  let ausgeblendet = 0
  let start = 0
  for (let s = 0; s < seiten; s++) {
    if (Date.now() > frist) return { mails, ausgeblendet, grenze: true }
    let r
    try {
      r = await hotmail({ action: 'outlook_liste', ordner, anzahl: SEITE, ab: start })
    } catch (e) {
      return { mails, ausgeblendet, grenze: true, fehler: e instanceof Error ? e.message : String(e) }
    }
    if (!r.ok) return { mails, ausgeblendet, grenze: true, fehler: fehlerText(r) }
    const seite = (Array.isArray(r.daten.mails) ? r.daten.mails : []) as Record<string, unknown>[]
    ausgeblendet += Number(r.daten.ausgeblendet ?? 0)
    let zuAlt = false
    for (const roh of seite) {
      const m = alsMail(roh)
      if (!m.id) continue
      const t = Date.parse(m.datum)
      if (Number.isFinite(t) && t < ab.getTime()) {
        zuAlt = true
        continue
      }
      mails.push(m)
    }
    if (zuAlt || r.daten.weiter !== true) return { mails, ausgeblendet, grenze: false }
    start = Number(r.daten.naechstesAb) || start + SEITE
  }
  return { mails, ausgeblendet, grenze: true }
}

// ---------- Eigene Daten aus dem CRM (Besitzer-Bedingung in jeder Abfrage) ----------

type Kontakt = { id: string; firma: string | null; ansprechpartner: string | null; email: string | null; bereich: string | null; verantwortlich_email: string | null }

async function eigeneKontakte(db: Supa, ich: string): Promise<{ kontakte: Kontakt[]; fehler?: string }> {
  try {
    const { data, error } = await db.from('kunden').select('id, firma, ansprechpartner, email, bereich, verantwortlich_email').eq('bereich', 'privat').ilike('verantwortlich_email', ich)
    if (error) return { kontakte: [], fehler: String(error.message ?? error) }
    const kontakte = ((data ?? []) as Kontakt[]).filter((k) => k.bereich === 'privat' && klein(k.verantwortlich_email) === ich)
    return { kontakte }
  } catch (e) {
    return { kontakte: [], fehler: e instanceof Error ? e.message : String(e) }
  }
}

/** Eigene Adressen (Login und verbundenes Microsoft-Konto). */
async function eigeneAdressen(db: Supa, ich: string): Promise<Set<string>> {
  const eigene = new Set([ich])
  try {
    const { data } = await db.from('ms_konten').select('login_email, ms_adresse').eq('login_email', ich).maybeSingle()
    if (data && klein(data.login_email) === ich && klein(data.ms_adresse)) eigene.add(klein(data.ms_adresse))
  } catch { /* ohne Microsoft-Adresse weiter */ }
  return eigene
}

/** Mayer-Adressen zusätzlich zum Filter im email-gateway: Mitarbeiter-/Postfach-Adressen, deren Firmen-Domains, eigene Einstellungen. */
async function mayerAdressen(db: Supa, ich: string, eigene: Set<string>): Promise<{ adressen: Set<string>; domains: Set<string> }> {
  const adressen = new Set<string>()
  const domains = new Set<string>()
  const lies = async (f: () => PromiseLike<{ data: unknown }>) => {
    try {
      return ((await f()).data ?? []) as Record<string, unknown>[]
    } catch {
      return []
    }
  }
  const [leute, postfaecher, einst] = await Promise.all([
    lies(() => db.from('mitarbeiter').select('email')),
    lies(() => db.from('postfaecher').select('adresse')),
    lies(() => db.from('privat_einstellungen').select('login_email, mayer_domains, mayer_adressen').eq('login_email', ich)),
  ])
  for (const a of [...leute.map((x) => klein(x.email)), ...postfaecher.map((x) => klein(x.adresse))]) {
    if (!a.includes('@') || eigene.has(a)) continue
    adressen.add(a)
    const d = domainVon(a)
    if (d && !istFreemailDomain(d) && ![...eigene].some((e) => domainVon(e) === d)) domains.add(d)
  }
  for (const e of einst.filter((x) => klein(x.login_email) === ich)) {
    for (const d of (Array.isArray(e.mayer_domains) ? e.mayer_domains : []) as unknown[]) if (klein(d)) domains.add(klein(d).replace(/^@/, ''))
    for (const a of (Array.isArray(e.mayer_adressen) ? e.mayer_adressen : []) as unknown[]) if (klein(a)) adressen.add(klein(a))
  }
  return { adressen, domains }
}

function istMayer(adresse: string, m: { adressen: Set<string>; domains: Set<string> }): boolean {
  if (m.adressen.has(adresse)) return true
  const d = domainVon(adresse)
  return [...m.domains].some((x) => d === x || d.endsWith(`.${x}`))
}

// ---------- Kontakte vorschlagen ----------

export type Vorschlag = {
  adresse: string
  adressen: string[]
  name: string
  gesendet: number
  empfangen: number
  letzte: string
  firma: string
  rolle: boolean
}

type Partner = { adresse: string; namen: Map<string, number>; gesendet: number; empfangen: number; werbung: number; letzte: string; vorschauen: string[] }

const FIRMA_MUSTER = /([A-ZÄÖÜ][\p{L}\d&.'-]*(?:\s+[A-ZÄÖÜ&][\p{L}\d&.'-]*){0,4}\s+(?:GmbH(?:\s*&\s*Co\.?\s*KG)?|mbH|UG(?:\s*\(haftungsbeschränkt\))?|AG|KG|OHG|GbR|e\.\s?K\.|e\.\s?V\.|PartG(?:\s*mbB)?))/u

/** Firma aus Vorschau-Text (Rechtsform) oder Domain (keine Freemail). */
export function firmaErkennen(adresse: string, texte: string[]): string {
  for (const t of texte) {
    const f = t.match(FIRMA_MUSTER)
    if (f) return f[1].replace(/\s+/g, ' ').trim()
  }
  const d = domainVon(adresse)
  if (!d || istFreemailDomain(d)) return ''
  return `${hauptDomain(d)} (aus der Adresse)`
}

/** Anzeigename: häufigster echter Name; sonst aus der Adresse (vorname.nachname → Vorname Nachname). */
function besterName(p: Partner): string {
  const namen = [...p.namen.entries()].filter(([n]) => n && !n.includes('@')).sort((a, b) => b[1] - a[1])
  if (namen.length) return namen[0][0].replace(/^['"]|['"]$/g, '')
  const lokal = p.adresse.split('@')[0] ?? ''
  const teile = lokal.split(/[._-]+/).filter((t) => /^[a-zäöüß]{2,}$/i.test(t))
  return teile.length >= 2 ? teile.map((t) => t[0].toUpperCase() + t.slice(1)).join(' ') : p.adresse
}

/** Ist dieser Partner schon ein eigener privater Kontakt? Erst Adresse, sonst Name. */
export function istSchonKontakt(adresse: string, name: string, kontakte: Kontakt[]): boolean {
  for (const k of kontakte) if (adressenIn(k.email).includes(adresse)) return true
  const n = normalisiere(name)
  if (!n || n.includes(' ') === false) return false // einzelne Wörter (nur Vorname) sind zu unsicher
  for (const k of kontakte) {
    for (const kn of [k.ansprechpartner, k.firma]) {
      const x = normalisiere(kn)
      if (!x || !x.includes(' ')) continue
      if (x === n) return true
      const a = new Set(n.split(' '))
      const b = x.split(' ')
      if (b.every((t) => a.has(t))) return true
      const c = new Set(b)
      if (n.split(' ').every((t) => c.has(t))) return true
    }
  }
  return false
}

type Analyse = {
  vorschlaege: Vorschlag[]
  kandidaten: number
  gelesen: { eingang: number; gesendet: number }
  luecken: string[]
  ausgeblendet: number
  ohneKonto?: boolean
}

async function analysiereKontakte(db: Supa, ich: string, hotmail: HotmailAufruf, monate: number, seiten: number, verbunden: boolean): Promise<Analyse> {
  const luecken: string[] = []
  if (!verbunden) return { vorschlaege: [], kandidaten: 0, gelesen: { eingang: 0, gesendet: 0 }, luecken: ['kein Microsoft-Konto verbunden'], ausgeblendet: 0, ohneKonto: true }
  const ab = new Date(Date.now() - monate * 30.44 * 24 * 60 * 60 * 1000)
  const frist = Date.now() + ZEIT_BUDGET_MS
  const eigene = await eigeneAdressen(db, ich)
  const [eingang, gesendet, kt, mayer] = await Promise.all([
    leseOrdner(hotmail, 'inbox', ab, seiten, frist),
    leseOrdner(hotmail, 'sentitems', ab, seiten, frist),
    eigeneKontakte(db, ich),
    mayerAdressen(db, ich, eigene),
  ])
  if (kt.fehler) luecken.push(`private Kontakte konnten nicht gelesen werden (${kt.fehler}) — vorhandene Kontakte sind evtl. nicht herausgefiltert`)
  for (const [lauf, was] of [[eingang, 'Posteingang'], [gesendet, 'Gesendet']] as const) {
    if (lauf.fehler) luecken.push(`${was} nur teilweise gelesen (${lauf.fehler})`)
    else if (lauf.grenze) luecken.push(`${was}: nur die neuesten ${zahl(lauf.mails.length)} Mails gelesen (Grenze je Lauf)`)
  }

  const partner = new Map<string, Partner>()
  const hole = (t: Teilnehmer) => {
    let p = partner.get(t.adresse)
    if (!p) partner.set(t.adresse, (p = { adresse: t.adresse, namen: new Map(), gesendet: 0, empfangen: 0, werbung: 0, letzte: '', vorschauen: [] }))
    if (t.name && klein(t.name) !== t.adresse) p.namen.set(t.name, (p.namen.get(t.name) ?? 0) + 1)
    return p
  }
  const zaehltNicht = (a: string) => !a || !a.includes('@') || eigene.has(a) || istMayer(a, mayer) || istSystemAdresse(a) || istPlattform(a)

  for (const m of eingang.mails) {
    const a = m.von.adresse
    if (zaehltNicht(a)) continue
    const p = hole(m.von)
    p.empfangen++
    if (m.art === 'werbung' || !m.relevant || WERBE_TEXT.test(`${m.betreff} ${m.vorschau.slice(0, 200)}`)) p.werbung++
    if (m.datum > p.letzte) p.letzte = m.datum
    if (p.vorschauen.length < 5) p.vorschauen.push(m.vorschau)
  }
  for (const m of gesendet.mails) {
    const empfaenger = [...m.an, ...m.cc]
    if (empfaenger.length > RUNDMAIL_AB) continue
    for (const t of empfaenger) {
      if (zaehltNicht(t.adresse)) continue
      const p = hole(t)
      p.gesendet++
      if (m.datum > p.letzte) p.letzte = m.datum
    }
  }

  // Auswahl: Person (Rollenadresse nur, wenn er selbst dorthin schreibt), nicht überwiegend Werbung, kein Kontakt.
  const roh: Vorschlag[] = []
  for (const p of partner.values()) {
    const rolle = istRollenAdresse(p.adresse)
    if (p.gesendet === 0) {
      if (rolle) continue
      if (p.empfangen < 3) continue
      if (p.werbung * 2 >= p.empfangen) continue
    }
    const name = besterName(p)
    if (istSchonKontakt(p.adresse, name, kt.kontakte)) continue
    roh.push({ adresse: p.adresse, adressen: [p.adresse], name, gesendet: p.gesendet, empfangen: p.empfangen, letzte: p.letzte, firma: firmaErkennen(p.adresse, p.vorschauen), rolle })
  }

  // Dieselbe Person unter mehreren Adressen (gleicher vollständiger Name) zusammenführen.
  const nachName = new Map<string, Vorschlag>()
  const zusammen: Vorschlag[] = []
  for (const v of roh.sort((a, b) => b.gesendet + b.empfangen - (a.gesendet + a.empfangen))) {
    const n = normalisiere(v.name)
    const schon = n.includes(' ') && !v.rolle ? nachName.get(n) : undefined
    if (schon) {
      schon.adressen.push(v.adresse)
      schon.gesendet += v.gesendet
      schon.empfangen += v.empfangen
      if (v.letzte > schon.letzte) schon.letzte = v.letzte
      if (!schon.firma || schon.firma.endsWith('(aus der Adresse)')) schon.firma = v.firma && !v.firma.endsWith('(aus der Adresse)') ? v.firma : schon.firma || v.firma
      continue
    }
    if (n.includes(' ') && !v.rolle) nachName.set(n, v)
    zusammen.push(v)
  }
  zusammen.sort((a, b) => b.gesendet + b.empfangen - (a.gesendet + a.empfangen) || b.gesendet - a.gesendet || b.letzte.localeCompare(a.letzte))
  return {
    vorschlaege: zusammen.slice(0, VORSCHLAEGE_HOECHSTENS),
    kandidaten: zusammen.length,
    gelesen: { eingang: eingang.mails.length, gesendet: gesendet.mails.length },
    luecken,
    ausgeblendet: eingang.ausgeblendet + gesendet.ausgeblendet,
  }
}

async function kontakteVorschlagen(input: Record<string, unknown>, k: PostfachHelferKontext, ich: string, verbunden: boolean): Promise<string> {
  const monate = Math.min(24, Math.max(1, Math.round(Number(input.monate) || 12)))
  const hotmail = k.hotmail ?? gatewayFuer(ich)
  const a = await analysiereKontakte(k.supabase, ich, hotmail, monate, SEITEN_HOECHSTENS, verbunden)
  if (a.ohneKonto) return 'Fehler: Es ist kein Microsoft-Konto verbunden. Er kann es im CRM unter Privat → Einstellungen verbinden.'
  k.protokolliere(`Kontakte vorgeschlagen: ${a.vorschlaege.length} von ${a.kandidaten} Kandidaten (${a.gelesen.eingang} Eingang, ${a.gelesen.gesendet} Gesendet gelesen)`)
  const zeilen: string[] = []
  if (!a.vorschlaege.length) {
    zeilen.push(`Keine neuen häufigen Mail-Partner in den letzten ${monate} Monaten — alle Personen, mit denen er regelmäßig schreibt, sind schon private Kontakte (gelesen: ${zahl(a.gelesen.eingang)} Mails im Posteingang, ${zahl(a.gelesen.gesendet)} gesendete).`)
  } else {
    zeilen.push(`Häufige Mail-Partner der letzten ${monate} Monate, die noch KEIN privater Kontakt sind (${a.vorschlaege.length}${a.kandidaten > a.vorschlaege.length ? ` von ${a.kandidaten}` : ''}; gelesen: ${zahl(a.gelesen.eingang)} Mails im Posteingang, ${zahl(a.gelesen.gesendet)} gesendete):`)
    a.vorschlaege.forEach((v, i) => {
      const teile = [
        `${i + 1}. ${v.name}`,
        v.adressen.join(', '),
        `${v.gesendet}× gesendet, ${v.empfangen}× empfangen`,
        v.letzte ? `letzte Mail ${deTag(v.letzte)}` : '',
        v.firma ? `Firma: ${v.firma}` : '',
        v.rolle ? 'Sammeladresse einer Firma' : '',
      ].filter(Boolean)
      zeilen.push(teile.join(' · '))
    })
    zeilen.push('Noch nichts angelegt. Frag ihn, welche (Nummern) er als private Kontakte anlegen möchte, und leg NUR diese mit kunde_anlegen an (bereich privat, name, email; Firma nur, wenn sie aus dem Text stammt oder er sie bestätigt).')
  }
  if (a.ausgeblendet) zeilen.push(`(${zahl(a.ausgeblendet)} Mayer-Mails wurden nicht berücksichtigt.)`)
  zeilen.push(a.luecken.length ? `Vollständig: nein, weil ${a.luecken.join('; ')}.` : 'Vollständig: ja (Posteingang und Gesendet im ganzen Zeitraum gelesen).')
  return zeilen.join('\n')
}

/**
 * Für den Sonntags-Wochenrückblick (ohne KI): eine Zeile, wenn es häufige Mail-Partner gibt, die noch kein privater
 * Kontakt sind — nur solche, an die er selbst geschrieben hat und mit mindestens 3 Mails. Leer, wenn nichts da ist,
 * kein Microsoft-Konto verbunden ist oder etwas schiefgeht. Liest weniger als das Werkzeug (höchstens 5 Seiten je Ordner).
 */
export async function kontaktVorschlagZeilen(admin: Supa, email: string, hotmail?: HotmailAufruf, outlookVerbunden?: boolean): Promise<string[]> {
  const ich = klein(email)
  if (!ich) return []
  try {
    const verbunden = outlookVerbunden ?? (await privatFaehigkeiten(admin, ich).catch(() => ({ outlook: false }))).outlook
    if (!verbunden) return []
    const a = await analysiereKontakte(admin, ich, hotmail ?? gatewayFuer(ich), 12, 5, true)
    const gute = a.vorschlaege.filter((v) => v.gesendet >= 1 && v.gesendet + v.empfangen >= 3)
    if (!gute.length) return []
    const namen = gute.slice(0, 3).map((v) => v.name).join(', ')
    const n = gute.length
    return [`${n} ${n === 1 ? 'neuer häufiger Mail-Partner' : 'neue häufige Mail-Partner'} (z. B. ${namen}) — sag „Kontakte vorschlagen“, dann lege ich sie auf dein Ja als Kontakte an.`]
  } catch {
    return []
  }
}

// ---------- Werbung aufräumen ----------

export type WerbeGruppe = { schluessel: string; code: string; mails: ListenMail[]; beispiele: string[] }

/** Werbe-/Newsletter-Mail? Nie Codes, Mahnungen, Rechnungen, Zahlungen; nie von Kontakten oder Leuten, denen er schreibt. */
export function istWerbeMail(m: ListenMail): boolean {
  if (KEINE_WERBUNG_ARTEN.has(m.art)) return false
  const a = m.von.adresse
  const text = `${m.betreff} ${m.vorschau.slice(0, 240)}`
  // Privatperson mit Freemail-Adresse, nur von Outlook unter „Sonstige“ einsortiert: ohne Werbetext keine Werbung.
  const d = domainVon(a)
  if (d && istFreemailDomain(d) && !istSystemAdresse(a) && !WERBE_TEXT.test(text)) return false
  if (m.art === 'werbung' || !m.relevant) return true
  if (istPlattform(a)) return true
  return istSystemAdresse(a) && WERBE_TEXT.test(text)
}

type WerbeAnalyse = { gruppen: WerbeGruppe[]; gelesen: number; grenze: boolean; fehler?: string; geschuetzt: number }

async function analysiereWerbung(db: Supa, ich: string, hotmail: HotmailAufruf, tage: number): Promise<WerbeAnalyse> {
  const ab = new Date(Date.now() - tage * 24 * 60 * 60 * 1000)
  const frist = Date.now() + ZEIT_BUDGET_MS / 2
  const eigene = await eigeneAdressen(db, ich)
  const [eingang, gesendet, kt] = await Promise.all([
    leseOrdner(hotmail, 'inbox', ab, SEITEN_HOECHSTENS, frist),
    // Wem er in den letzten 12 Monaten geschrieben hat, der ist keine Werbung.
    leseOrdner(hotmail, 'sentitems', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), 10, frist),
    eigeneKontakte(db, ich),
  ])
  const geschuetzt = new Set<string>(eigene)
  for (const m of gesendet.mails) for (const t of [...m.an, ...m.cc]) if (t.adresse) geschuetzt.add(t.adresse)
  for (const k of kt.kontakte) for (const a of adressenIn(k.email)) geschuetzt.add(a)

  const gruppen = new Map<string, WerbeGruppe>()
  let geschuetztZahl = 0
  for (const m of eingang.mails) {
    const a = m.von.adresse
    if (!a || !istWerbeMail(m)) continue
    if (geschuetzt.has(a)) {
      geschuetztZahl++
      continue
    }
    const s = absenderSchluessel(a)
    let g = gruppen.get(s)
    if (!g) gruppen.set(s, (g = { schluessel: s, code: absenderCode(s), mails: [], beispiele: [] }))
    g.mails.push(m)
    if (g.beispiele.length < 2 && m.betreff) g.beispiele.push(m.betreff)
  }
  const fehler = eingang.fehler ?? (kt.fehler ? `private Kontakte nicht lesbar (${kt.fehler})` : gesendet.fehler ? `Gesendet nicht lesbar (${gesendet.fehler})` : undefined)
  return { gruppen: [...gruppen.values()].sort((x, y) => y.mails.length - x.mails.length || x.schluessel.localeCompare(y.schluessel)), gelesen: eingang.mails.length, grenze: eingang.grenze, fehler, geschuetzt: geschuetztZahl }
}

/** Ordner „Werbung“ (oberste Ebene) finden oder anlegen; liefert seine Kennung. */
async function werbeOrdner(hotmail: HotmailAufruf): Promise<{ id?: string; neu?: boolean; fehler?: string }> {
  const r = await hotmail({ action: 'outlook_ordner' })
  if (!r.ok) return { fehler: fehlerText(r) }
  const liste = (Array.isArray(r.daten.ordner) ? r.daten.ordner : []) as { id?: unknown; name?: unknown; pfad?: unknown }[]
  const da = liste.find((o) => klein(o.name) === WERBE_ORDNER.toLowerCase() && klein(o.pfad ?? o.name) === WERBE_ORDNER.toLowerCase())
  if (da?.id) return { id: String(da.id), neu: false }
  const neu = await hotmail({ action: 'outlook_ordner_anlegen', name: WERBE_ORDNER })
  if (!neu.ok || !neu.daten.id) return { fehler: `Ordner „${WERBE_ORDNER}“ konnte nicht angelegt werden (${fehlerText(neu)})` }
  return { id: String(neu.daten.id), neu: neu.daten.neu !== false }
}

async function werbungAufraeumen(input: Record<string, unknown>, k: PostfachHelferKontext, ich: string): Promise<string> {
  const tage = Math.min(365, Math.max(7, Math.round(Number(input.tage) || 90)))
  const hotmail = k.hotmail ?? gatewayFuer(ich)
  const a = await analysiereWerbung(k.supabase, ich, hotmail, tage)
  if (a.fehler && !a.gelesen) {
    const gebremst = bremsWartezeit(a.fehler) !== null
    return `Fehler: Der Posteingang konnte nicht gelesen werden (${gebremst ? 'Microsoft bremst gerade, zu viele Anfragen an das Postfach' : a.fehler}). Nichts verschoben.${gebremst ? ' NICHT sofort noch einmal aufrufen: sag ihm, er soll es in etwa 5 Minuten noch einmal versuchen.' : ''}`
  }

  // ---------- Anwenden ----------
  if (input.bestaetigt === true) {
    const codes = (Array.isArray(input.gruppen) ? input.gruppen : []).map((x) => String(x ?? '').trim()).filter(Boolean)
    const absender = (Array.isArray(input.absender) ? input.absender : []).map((x) => klein(x).replace(/^@/, '')).filter(Boolean)
    if (!codes.length && !absender.length) return 'Fehler: Zum Verschieben gruppen=[Codes] oder absender=[Domain/Adresse] aus der Vorschau angeben. Nichts verschoben.'
    const gewaehlt: ListenMail[] = []
    const getroffen: string[] = []
    const unbekannt: string[] = []
    for (const c of codes) {
      const g = a.gruppen.find((x) => x.code === c)
      if (!g) unbekannt.push(c)
      else if (!getroffen.includes(g.schluessel)) {
        getroffen.push(g.schluessel)
        gewaehlt.push(...g.mails)
      }
    }
    for (const s of absender) {
      if (s.includes('@')) {
        // Einzelne Adresse: nur Mails genau dieses Absenders.
        const mails = a.gruppen.flatMap((g) => g.mails.filter((m) => m.von.adresse === s))
        if (!mails.length) unbekannt.push(s)
        else if (!getroffen.includes(s)) {
          getroffen.push(s)
          gewaehlt.push(...mails)
        }
      } else {
        const g = a.gruppen.find((x) => x.schluessel === s || x.schluessel === hauptDomain(s))
        if (!g) unbekannt.push(s)
        else if (!getroffen.includes(g.schluessel)) {
          getroffen.push(g.schluessel)
          gewaehlt.push(...g.mails)
        }
      }
    }
    const ids = [...new Map(gewaehlt.map((m) => [m.id, m])).values()]
    if (!ids.length) return `Nichts verschoben: Zu ${unbekannt.map((x) => `„${x}“`).join(', ') || 'der Auswahl'} gibt es im Posteingang (letzte ${tage} Tage) keine Werbe-Mails (mehr). Bitte die Vorschau neu abrufen.`
    const ordner = await werbeOrdner(hotmail)
    if (!ordner.id) return `Fehler: ${ordner.fehler}. Nichts verschoben.`
    const dieses = ids.slice(0, VERSCHIEBEN_HOECHSTENS)
    let ok = 0
    let fehl = 0
    let ausgelassen = 0
    let gebremst = false
    const fehlerBeispiele: string[] = []
    const frist = Date.now() + (k.zeitBudgetMs ?? VERSCHIEBEN_BUDGET_MS)
    const warte = k.warte ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const verschiebe = (m: ListenMail) =>
      hotmail({ action: 'outlook_verschieben', id: m.id, ordner: ordner.id }).then(
        (r) => (r.ok ? null : fehlerText(r)),
        (e) => (e instanceof Error ? e.message : String(e)),
      )
    // Langsam und der Reihe nach (je GLEICHZEITIG Mails). Bremst Microsoft, wird die verlangte Zeit gewartet und
    // dieselben Mails noch einmal versucht; reicht die Zeit nicht, bleibt der Rest für den nächsten Lauf liegen
    // (zählt nicht als fehlgeschlagen).
    let i = 0
    let versuche = 0
    while (i < dieses.length) {
      if (Date.now() > frist) {
        ausgelassen = dieses.length - i
        break
      }
      const stapel = dieses.slice(i, i + GLEICHZEITIG)
      const ergebnisse = await Promise.all(stapel.map(verschiebe))
      const bremse = Math.max(...ergebnisse.map((f) => (f === null ? -1 : bremsWartezeit(f) ?? -1)))
      if (bremse >= 0) {
        gebremst = true
        const wartezeit = Math.min(Math.max(bremse, 2_000), PAUSE_HOECHSTENS_MS)
        // Schon Verschobene des Stapels zählen; die gebremsten werden nach der Pause erneut versucht.
        const nochmal = stapel.filter((_, j) => ergebnisse[j] !== null && bremsWartezeit(ergebnisse[j]!) !== null)
        ok += ergebnisse.filter((f) => f === null).length
        for (const f of ergebnisse) if (f !== null && bremsWartezeit(f) === null) {
          fehl++
          if (fehlerBeispiele.length < 2 && !fehlerBeispiele.includes(f)) fehlerBeispiele.push(f)
        }
        versuche++
        if (versuche > 3 || Date.now() + wartezeit > frist) {
          ausgelassen = dieses.length - i - stapel.length + nochmal.length
          break
        }
        await warte(wartezeit)
        // Gebremste Mails vorne wieder einreihen.
        dieses.splice(i, stapel.length, ...nochmal)
        continue
      }
      versuche = 0
      for (const f of ergebnisse) {
        if (f === null) ok++
        else {
          fehl++
          if (fehlerBeispiele.length < 2 && !fehlerBeispiele.includes(f)) fehlerBeispiele.push(f)
        }
      }
      i += stapel.length
    }
    const weitere = ids.length - Math.min(ids.length, VERSCHIEBEN_HOECHSTENS) + ausgelassen
    k.protokolliere(`Werbung aufgeräumt: ${ok} verschoben, ${fehl} fehlgeschlagen nach „${WERBE_ORDNER}“ (Absender: ${getroffen.slice(0, 10).join(', ')}${getroffen.length > 10 ? ' …' : ''})`)
    return [
      `In den Ordner „${WERBE_ORDNER}“ verschoben: ${zahl(ok)} Mails${fehl ? `, ${zahl(fehl)} fehlgeschlagen (${fehlerBeispiele.join(' | ')})` : ''}. Absender: ${getroffen.join(', ')}.`,
      ordner.neu ? `Der Ordner „${WERBE_ORDNER}“ wurde neu angelegt.` : '',
      'Nichts wurde gelöscht und es gibt keine automatische Regel — neue Werbung landet weiter im Posteingang.',
      gebremst && ausgelassen > 0
        ? `Microsoft hat gebremst (zu viele Anfragen an das Postfach). ${zahl(weitere)} Werbe-Mails sind noch nicht verschoben — das ist kein Fehler. NICHT sofort noch einmal aufrufen: sag ihm, er soll es in etwa 5 Minuten mit denselben Codes noch einmal bestätigen.`
        : weitere > 0 ? `Es gibt weitere ${zahl(weitere)} Werbe-Mails dieser Absender (Grenze je Lauf ${VERSCHIEBEN_HOECHSTENS}) — mit denselben Codes noch einmal bestätigen, um weiterzumachen.` : '',
      a.grenze ? `Hinweis: Es wurden nur die neuesten ${zahl(a.gelesen)} Mails des Posteingangs gelesen — ältere Werbung im Zeitraum ist noch nicht erfasst.` : '',
      unbekannt.length ? `Nicht gefunden (nichts verschoben): ${unbekannt.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
  }

  // ---------- Vorschau ----------
  if (!a.gruppen.length) {
    return `Keine Werbe-Mails oder Rundbriefe im Posteingang der letzten ${tage} Tage gefunden (${zahl(a.gelesen)} Mails gelesen). Nichts verschoben.${a.grenze ? ` Vollständig: nein, nur die neuesten ${zahl(a.gelesen)} Mails gelesen.` : ''}`
  }
  const summe = a.gruppen.reduce((s, g) => s + g.mails.length, 0)
  const zeilen = [`Werbung im Posteingang (letzte ${tage} Tage): ${zahl(summe)} von ${zahl(a.gelesen)} Mails von ${zahl(a.gruppen.length)} Absendern. Noch nichts verschoben.`]
  zeilen.push('Absender mit den meisten Werbe-Mails (gruppe=Code):')
  const zeigen = 20
  for (const g of a.gruppen.slice(0, zeigen)) {
    const bsp = g.beispiele.map((b) => `„${kurzText(b, 45)}“`).join(', ')
    zeilen.push(`- ${g.schluessel} · ${zahl(g.mails.length)} Mails · gruppe=${g.code}${bsp ? ` (z. B. ${bsp})` : ''}`)
  }
  if (a.gruppen.length > zeigen) zeilen.push(`… und ${zahl(a.gruppen.length - zeigen)} weitere Absender mit zusammen ${zahl(a.gruppen.slice(zeigen).reduce((s, g) => s + g.mails.length, 0))} Mails.`)
  if (a.geschuetzt) zeilen.push(`(${zahl(a.geschuetzt)} werbeartige Mails von Kontakten oder Leuten, denen er schreibt, bleiben unberührt.)`)
  if (a.grenze || a.fehler) zeilen.push(`Vollständig: nein, ${a.fehler ? `weil ${a.fehler}` : `nur die neuesten ${zahl(a.gelesen)} Mails gelesen`}.`)
  zeilen.push(`Anwenden nur nach seinem Ja: bestaetigt=true mit gruppen=[Codes] (oder absender=[Domain/Adresse]) und gleichem tage. Verschiebt genau diese Mails in den Ordner „${WERBE_ORDNER}“ (legt ihn an, falls nötig), höchstens ${VERSCHIEBEN_HOECHSTENS} je Lauf; nichts wird gelöscht.`)
  return zeilen.join('\n')
}

// ---------- Ausführen ----------

export async function fuehrePostfachHelferAus(name: string, input: Record<string, unknown>, k: PostfachHelferKontext): Promise<string> {
  if (!istPostfachHelferWerkzeug(name)) return `Fehler: Unbekanntes Werkzeug ${name}`
  const ich = klein(k.mitarbeiter?.email)
  if (!ich) return 'Fehler: Login des Mitarbeiters unbekannt.'
  setzePrivat()
  const verbunden = k.outlookVerbunden ?? (await privatFaehigkeiten(k.supabase, ich).catch(() => ({ outlook: false }))).outlook
  if (!verbunden) return 'Fehler: Es ist kein Microsoft-Konto verbunden. Er kann es im CRM unter Privat → Einstellungen verbinden.'
  try {
    if (name === 'kontakte_vorschlagen') return await kontakteVorschlagen(input ?? {}, k, ich, verbunden)
    return await werbungAufraeumen(input ?? {}, k, ich)
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : String(e)}`
  }
}
