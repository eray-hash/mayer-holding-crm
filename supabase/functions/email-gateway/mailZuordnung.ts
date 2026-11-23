// Post-Zuordnung (22.11.2026): neue Mails im gemeinsamen Postfach ihrer Kundenakte zuordnen — als eigener,
// klar abgegrenzter Schritt neben den bestehenden Wegen, die hier NICHT verändert werden:
//  - inbound-email / _shared/mailEingang.ts (Relevanz per KI, Zuordnung bei exakt gleicher Absenderadresse beim Eingang),
//  - postfach.ts ordneOffeneMailsZu (alle zehn Minuten, gleiche Regel für die letzten drei Tage),
//  - classifyNewLeads (neue Absender → neue Akte), anfragenManager.ts (Objektanfragen), Werkzeug mail_zuordnen.
//
// Was dieser Schritt zusätzlich kann:
//  1. Sicher zuordnen (ohne Rückfrage) NUR wenn
//     a) die Absenderadresse genau einer Akte gehört (kunden.email; ein Feld für weitere Adressen gibt es nicht), oder
//     b) die Mail eine Antwort in einem Verlauf ist, der genau einer Akte gehört: In-Reply-To/References nennen eine
//        Mail, die wir aus dieser Akte geschickt haben (gesendete_emails.kunde_id) oder eine Mail, die schon dieser
//        Akte zugeordnet ist, oder
//     c) der Betreff eine Antwort („AW:“, „Re:“) auf eine Mail aus genau einer Akte ist UND der Absender genau der
//        Empfänger dieser Mail war (für abgeholte Mails ohne Kopfzeilen), oder
//     d) Scan-Eingang (23.11.2026): der Betreff ist der Name genau einer Akte („Max Muster“, auch „Muster, Max“,
//        „Max Muster Teil 2“, Teilnamen und ein Tippfehler je Wort) und die Mail hat Anhänge — so schicken Kollegen eingescannte Papierakten an info@.
//        Gilt auch für Absender ohne Akte und für Mails, die die KI als unwichtig eingestuft hat.
//     Geschrieben wird über ordneMailZu (postfach.ts) — dieselbe Zuordnung wie das Werkzeug mail_zuordnen,
//     samt Verlaufseintrag und Anhängen in den Dokumenten der Akte.
//  2. Unsichere Kandidaten (an diese Adresse wurde aus einer Akte geschrieben, gleiche Firmen-Domain, Name im
//     Betreff/Text, gleicher Betreff ohne passenden Absender) → Vorschlag in eingegangene_emails.zuordnung_vorschlag;
//     im Postfach unter „Vorschläge“ mit einem Klick zuordnen oder verwerfen.
//  3. Rundschreiben und Systemmeldungen (List-Unsubscribe, Precedence bulk/list, Auto-Submitted, noreply/
//     mailer-daemon …) werden wie in der bestehenden Kette als relevanz = 'nicht_relevant' markiert — aber nur,
//     wenn die KI-Einordnung noch fehlt (relevanz leer). Ein „kunde“ der KI wird nicht überstimmt.
//
// Bereichspostfächer (postfaecher.bereich, z. B. immo@amayer-holding.com seit 23.11.2026) zählen hier wie das gemeinsame
// Postfach: ihre Mails haben keinen Besitzer, sichtbar sind sie nur für den Bereich (postfach_bereich).
// Ohne KI, ohne Nachrichten. Private Postfächer (besitzer_email gesetzt) bleiben unberührt — sie gehören ihrem
// Besitzer, eine Zuordnung zur gemeinsamen Akte geht dort nur über „In öffentlichen Bereich übernehmen“.
// Jede Mail wird genau einmal geprüft: Vor der Arbeit wird sie über zuordnung_geprueft_am beansprucht (nur wer die
// Spalte von leer auf einen Zeitpunkt setzt, prüft sie). Bricht ein Lauf ab, bleibt die Mail unzugeordnet — die
// Zuordnung bei exakt gleicher Adresse holt dann ordneOffeneMailsZu nach.

import { ordneMailZu } from './postfach.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Admin = any

export const WER = 'System (automatische E-Mail-Zuordnung)'
const TAG_MS = 86_400_000
/** Wie weit zurück Mails aus unseren Akten für Verlauf und Betreff zählen. */
const GESENDET_FENSTER_TAGE = 180
const HOECHSTENS_KANDIDATEN = 3

export type MailZeile = {
  id: string
  message_id?: string | null
  von?: string | null
  von_name?: string | null
  betreff?: string | null
  ausschnitt?: string | null
  rohdaten?: unknown
  relevanz?: string | null
  ignoriert?: boolean | null
  besitzer_email?: string | null
  zugewiesener_kunde_id?: string | null
  mail_datum?: string | null
  erstellt_am?: string | null
  anhaenge?: unknown
  scan_status?: string | null
}

export type AkteZeile = { id: string; bereich: string; firma?: string | null; ansprechpartner?: string | null; email?: string | null }
export type GesendetZeile = { message_id?: string | null; an?: string | null; betreff?: string | null; kunde_id?: string | null; gesendet_am?: string | null }

export type Kontext = {
  akten: AkteZeile[]
  /** Adressen der Mitarbeiter (klein geschrieben) — nie als Kunde zuordnen. */
  mitarbeiterAdressen: Set<string>
  /** Wörter aus Mitarbeiternamen und der eigenen Firma, die beim Namensabgleich nicht zählen. */
  eigeneWoerter: Set<string>
  /** Domains, die nie eine Firmen-Domain einer Akte sein können (eigene, Mitarbeiter). */
  eigeneDomains: Set<string>
  /** Gesendete Mails aus Akten (gemeinsamer Bereich, kunde_id gesetzt). */
  gesendet: GesendetZeile[]
  /** Nachrichtenkennung (normalisiert) → Akten, zu denen sie gehört (gesendet oder schon zugeordnet). */
  kennungAkten: Map<string, Set<string>>
  /** Scanner-Adressen (scan_eingang.absender): deren Mails bearbeitet der Scan-Eingang (scanEingang.ts), nicht dieser Schritt. */
  scanAbsender?: Set<string>
}

export type Kandidat = { kundeId: string; bereich: string; name: string; grund: string }

export type Entscheidung =
  | { art: 'zuordnen'; kundeId: string; weg: 'absender' | 'verlauf' | 'betreff'; grund: string }
  | { art: 'vorschlag'; kandidaten: Kandidat[] }
  | { art: 'rundschreiben'; grund: string }
  | { art: 'nichts'; grund: string }

// ---------------------------------------------------------------------------------------------------
// Reine Hilfen (getestet)
// ---------------------------------------------------------------------------------------------------

const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.de', 'outlook.com', 'outlook.de', 'live.com', 'live.de', 'msn.com',
  'yahoo.com', 'yahoo.de', 'yahoo.it', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aol.de', 'gmx.de',
  'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.com', 'web.de', 't-online.de', 'freenet.de', 'mail.de', 'posteo.de', 'arcor.de',
  'online.de', 'email.de', 'vodafone.de', 'kabelmail.de', 'proton.me', 'protonmail.com', 'mailbox.org', 'magenta.de',
])

/** Wörter, die in Firmennamen nichts unterscheiden. */
const ALLGEMEIN = new Set([
  'gmbh', 'mbh', 'ug', 'kg', 'ag', 'ohg', 'gbr', 'ev', 'co', 'und', 'haftungsbeschraenkt', 'holding', 'immobilien', 'immo',
  'beratung', 'consulting', 'invest', 'verwaltung', 'gesellschaft', 'hotel', 'gasthof', 'restaurant', 'ristorante', 'cafe',
  'fahrschule', 'finanz', 'finanzen', 'service', 'services', 'gruppe', 'group', 'partner', 'team', 'herr', 'frau', 'dr',
  'prof', 'familie', 'der', 'die', 'das', 'von', 'van', 'den', 'zum', 'zur', 'the', 'and', 'kanzlei', 'steuerberatung',
  'unternehmensberatung', 'vermittlung', 'referenziert', 'firma', 'neu', 'kunde', 'interessent', 'privat', 'objekt', 'ulm',
  'muenchen', 'augsburg', 'stuttgart', 'boarding', 'house', 'mail', 'info', 'kontakt', 'intern', 'office', 'online',
])

const EIGENE_FIRMA = ['mayer', 'amayer', 'andreas', 'fundament']

export function normText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function woerter(s: string): string[] {
  return normText(s).split(' ').filter(Boolean)
}

export function adresseNorm(s: string | null | undefined): string {
  const roh = String(s ?? '').trim().toLowerCase()
  const m = roh.match(/<([^>]+)>/)
  return (m ? m[1] : roh).trim()
}

function domainVon(adresse: string): string {
  return adresse.split('@')[1]?.trim() ?? ''
}

/** Betreff ohne Antwort-/Weiterleitungs-Vorsätze und Spam-Kennzeichen, klein geschrieben. */
export function normBetreff(s: string | null | undefined): string {
  let b = String(s ?? '').replace(/\*{2,}\s*spam\s*\*{2,}/gi, ' ').trim()
  const vorsatz = /^\s*((re|aw|antw|antwort|wg|fw|fwd|wtr|tr|sv|vs|r)\s*(\[\d+\])?\s*:\s*)/i
  for (let i = 0; i < 10 && vorsatz.test(b); i++) b = b.replace(vorsatz, '')
  return b.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Ist der Betreff eine Antwort (nicht bloß eine Weiterleitung)? */
export function istAntwortBetreff(s: string | null | undefined): boolean {
  const b = String(s ?? '').replace(/\*{2,}\s*spam\s*\*{2,}/gi, ' ').trim()
  return /^\s*(re|aw|antw|antwort|sv)\s*(\[\d+\])?\s*:/i.test(b)
}

/** Nachrichtenkennung vergleichbar machen: klein, ohne Postfach-Vorsatz („pf_…:<…>“), mit spitzen Klammern. */
export function kennungNorm(s: string | null | undefined): string {
  let k = String(s ?? '').trim().toLowerCase()
  const lt = k.indexOf('<')
  if (lt > 0) k = k.slice(lt)
  if (!k) return ''
  if (!k.startsWith('<')) k = `<${k}`
  if (!k.endsWith('>')) k = `${k}>`
  return k.length > 4 ? k : ''
}

/** Alle Werte einer Kopfzeile aus rohdaten — CloudMailin legt sie flach ab („headers[references]“, auch „…][0]“). */
export function kopfzeile(roh: unknown, name: string): string[] {
  if (!roh || typeof roh !== 'object') return []
  const r = roh as Record<string, unknown>
  const aus: string[] = []
  const flach = `headers[${name}]`
  for (const [k, v] of Object.entries(r)) {
    if ((k === flach || k.startsWith(`${flach}[`)) && typeof v === 'string') aus.push(v)
  }
  const verschachtelt = r.headers && typeof r.headers === 'object' ? (r.headers as Record<string, unknown>)[name] : undefined
  if (typeof verschachtelt === 'string') aus.push(verschachtelt)
  else if (Array.isArray(verschachtelt)) aus.push(...verschachtelt.filter((x): x is string => typeof x === 'string'))
  return aus
}

/** Kennungen aus In-Reply-To und References. */
export function verlaufsKennungen(roh: unknown): string[] {
  const roheWerte = [...kopfzeile(roh, 'in_reply_to'), ...kopfzeile(roh, 'references'), ...kopfzeile(roh, 'in-reply-to')]
  const aus = new Set<string>()
  for (const wert of roheWerte) {
    const inKlammern = wert.match(/<[^<>\s]+>/g)
    const teile = inKlammern && inKlammern.length > 0 ? inKlammern : wert.split(/\s+/).filter((t) => t.includes('@'))
    for (const t of teile) {
      const k = kennungNorm(t)
      if (k) aus.add(k)
    }
  }
  return [...aus]
}

const SYSTEM_ABSENDER = /^(no-?reply|noreply|donotreply|do-not-reply|mailer-daemon|postmaster|bounces?|notifications?|benachrichtigungen?|newsletter|news|alerts?|system|automated|auto-confirm)([._+-]|@|$)/i
/** „noreply“ irgendwo im vorderen Teil der Adresse (z. B. info-noreply@bank.de). */
const NOREPLY_IRGENDWO = /(no-?reply|donotreply|do-not-reply)/i

/** Warum die Mail nach Rundschreiben/Systemmeldung aussieht (leer = kein Hinweis). */
export function rundschreibenHinweise(m: MailZeile): { liste: string[]; system: boolean } {
  const liste: string[] = []
  const roh = m.rohdaten
  if (kopfzeile(roh, 'list_unsubscribe').length > 0 || kopfzeile(roh, 'list_id').length > 0) liste.push('Abmelde-Kopfzeile (Rundschreiben)')
  const vorrang = kopfzeile(roh, 'precedence').join(' ').toLowerCase()
  if (/\b(bulk|list|junk)\b/.test(vorrang)) liste.push(`Kopfzeile Precedence: ${vorrang.trim()}`)
  const auto = kopfzeile(roh, 'auto_submitted').join(' ').toLowerCase().trim()
  if (auto && auto !== 'no') liste.push(`automatisch erzeugt (${auto})`)
  const lokal = adresseNorm(m.von).split('@')[0] ?? ''
  const system = SYSTEM_ABSENDER.test(`${lokal}@`) || NOREPLY_IRGENDWO.test(lokal) || adresseNorm(m.von).includes('mailer-daemon')
  return { liste, system }
}

export function akteName(a: AkteZeile): string {
  const firma = String(a.firma ?? '').trim()
  const ap = String(a.ansprechpartner ?? '').trim()
  if (!firma) return ap || a.id
  return ap && ap !== firma ? `${firma} (${ap})` : firma
}

function bedeutsam(w: string, eigene: Set<string>): boolean {
  return w.length >= 3 && !/^\d+$/.test(w) && !ALLGEMEIN.has(w) && !eigene.has(w)
}

/** Kommt ein Name der Akte (Ansprechpartner: Nachname plus ein weiterer Teil; Firma: alle unterscheidenden Wörter) im Text vor? */
export function nameImText(a: AkteZeile, textWoerter: Set<string>, eigene: Set<string>): string | null {
  const person = woerter(String(a.ansprechpartner ?? '')).filter((w) => bedeutsam(w, eigene))
  if (person.length >= 2) {
    const nachname = person[person.length - 1]
    if (nachname.length >= 4 && textWoerter.has(nachname) && person.slice(0, -1).some((w) => textWoerter.has(w))) {
      return `Name „${String(a.ansprechpartner).trim()}“ steht in der Mail`
    }
  }
  const firma = woerter(String(a.firma ?? '')).filter((w) => bedeutsam(w, eigene))
  if (firma.length >= 2 && firma.every((w) => textWoerter.has(w))) return `Firma „${String(a.firma).trim()}“ steht in der Mail`
  if (firma.length === 1 && firma[0].length >= 6 && textWoerter.has(firma[0])) return `„${firma[0]}“ aus dem Firmennamen steht in der Mail`
  return null
}

/** Wörter, die beim Scan-Eingang neben dem Namen im Betreff stehen dürfen („Teil 2“, „Scan“, „Akte“ …). */
const SCAN_FUELLWOERTER = new Set([
  'teil', 'scan', 'scans', 'akte', 'kundenakte', 'ordner', 'unterlagen', 'dokument', 'dokumente', 'seite', 'seiten', 'nr',
  'und', 'fortsetzung', 'rest', 'von', 'bis', 'kunde', 'mappe', 'eingescannt',
])
const ANREDE = new Set(['herr', 'frau', 'dr', 'prof', 'familie', 'fam'])

function namensWoerter(s: string, fuell: boolean): string[] {
  return woerter(s).filter((w) => !/^\d+$/.test(w) && w.length >= 2 && !ANREDE.has(w) && !ALLGEMEIN.has(w) && !(fuell && SCAN_FUELLWOERTER.has(w)))
}

/** Gleiches Wort, bei längeren Wörtern auch mit einem Tippfehler („Schebek“/„Schebeck“). */
function aehnlich(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  // Abstand höchstens 1 (ein Zeichen anders, zu viel oder zu wenig).
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i)
}

/** Ist der Betreff (ohne Füllwörter wie „Teil 2“) der Name dieser Akte? Reihenfolge egal („Muster, Max“); es reicht,
 *  wenn alle Namenswörter des Betreffs (mindestens zwei) im Namen der Akte vorkommen — „Bauer Schebek“ passt zur Akte
 *  „Christine Schebeck und Michael Bauer“. */
export function betreffIstAktenName(betreff: string | null | undefined, a: AkteZeile): boolean {
  const roh = normBetreff(betreff)
  if (!roh) return false
  const ganz = normText(roh)
  const imBetreff = [...new Set(namensWoerter(roh, true))]
  const imNamen = new Set<string>()
  for (const name of [a.ansprechpartner, a.firma]) {
    const n = String(name ?? '').trim()
    if (!n) continue
    // Ganz genau gleich (auch einteilige Firmennamen).
    if (normText(n).length >= 4 && ganz === normText(n)) return true
    for (const w of namensWoerter(n, false)) imNamen.add(w)
  }
  if (imBetreff.length < 2) return false
  // Mindestens ein Betreff-Wort muss ein richtiger Name sein (4+ Buchstaben), nicht nur Kürzel.
  if (!imBetreff.some((w) => w.length >= 4)) return false
  return imBetreff.every((w) => [...imNamen].some((n) => aehnlich(w, n)))
}

/** Teiltreffer für den Scan-Eingang: ein Namenswort des Betreffs (4+ Buchstaben) steckt im Namen der Akte —
 *  „Bauer Schebek“ findet auch die Akte „Christine Schebek“. Nur als Auswahl für die KI, nie für sicheres Zuordnen. */
export function betreffNenntTeilDesNamens(betreff: string | null | undefined, a: AkteZeile): boolean {
  const imBetreff = namensWoerter(normBetreff(betreff), true).filter((w) => w.length >= 4)
  if (imBetreff.length === 0) return false
  const imNamen = [a.ansprechpartner, a.firma].flatMap((n) => namensWoerter(String(n ?? ''), false)).filter((w) => w.length >= 4)
  return imBetreff.some((w) => imNamen.some((n) => aehnlich(w, n)))
}

function hatAnhaenge(m: MailZeile): boolean {
  return Array.isArray(m.anhaenge) && m.anhaenge.length > 0
}

// ---------------------------------------------------------------------------------------------------
// Entscheidung je Mail (rein, ohne Datenbank)
// ---------------------------------------------------------------------------------------------------

export function entscheide(m: MailZeile, k: Kontext, jetzt = new Date()): Entscheidung {
  if (m.besitzer_email) return { art: 'nichts', grund: 'privates Postfach' }
  if (m.zugewiesener_kunde_id) return { art: 'nichts', grund: 'schon zugeordnet' }
  if (m.ignoriert) return { art: 'nichts', grund: 'ausgeblendet' }
  const von = adresseNorm(m.von)
  // Scans vom Bürokopierer teilt und verteilt scanEingang.ts; nur wenn das scheiterte, prüft dieser Schritt sie.
  if (k.scanAbsender?.has(von) && m.scan_status !== 'fehler') return { art: 'nichts', grund: 'Scan-Eingang' }
  const hinweise = rundschreibenHinweise(m)
  const relevanzLeer = !m.relevanz
  const unwichtig = m.relevanz === 'nicht_relevant'

  // Systemabsender (Zustellfehler, noreply …) gehören nie automatisch in eine Akte.
  if (hinweise.system) {
    return relevanzLeer ? { art: 'rundschreiben', grund: 'Systemabsender' } : { art: 'nichts', grund: 'Systemabsender' }
  }

  const aktenNachId = new Map(k.akten.map((a) => [a.id, a]))
  const istRundschreiben = hinweise.liste.length > 0

  const eigeneAdresse = !von || k.mitarbeiterAdressen.has(von)
  const exakt = eigeneAdresse ? [] : k.akten.filter((a) => adresseNorm(a.email) === von)

  // b) Verlauf: Antwort auf eine Mail, die genau einer Akte gehört.
  if (!istRundschreiben) {
    const akten = new Set<string>()
    for (const kennung of verlaufsKennungen(m.rohdaten)) for (const id of k.kennungAkten.get(kennung) ?? []) if (aktenNachId.has(id)) akten.add(id)
    if (akten.size === 1) {
      const kundeId = [...akten][0]
      // Gehört der Absender selbst zu einer anderen Akte (z. B. „Allen antworten“ in fremdem Verlauf), ist es nicht sicher.
      if (exakt.length === 1 && exakt[0].id !== kundeId) {
        const verlaufAkte = aktenNachId.get(kundeId)!
        return {
          art: 'vorschlag',
          kandidaten: [
            { kundeId: exakt[0].id, bereich: exakt[0].bereich, name: akteName(exakt[0]), grund: 'Absenderadresse ist in dieser Akte hinterlegt' },
            { kundeId, bereich: verlaufAkte.bereich, name: akteName(verlaufAkte), grund: 'Antwort auf eine Mail aus dieser Akte' },
          ],
        }
      }
      return { art: 'zuordnen', kundeId, weg: 'verlauf', grund: 'Antwort auf eine Mail aus dieser Akte' }
    }
  }

  // a) Absenderadresse gehört genau einer Akte.
  if (exakt.length === 1) {
    const a = exakt[0]
    if (!istRundschreiben && !unwichtig) return { art: 'zuordnen', kundeId: a.id, weg: 'absender', grund: 'Absenderadresse ist in der Akte hinterlegt' }
    // Ein Rundschreiben, das die KI ohnehin ausgeblendet hat (z. B. Angebots-Newsletter eines Partners), bleibt still.
    if (istRundschreiben && unwichtig) return { art: 'nichts', grund: 'Rundschreiben eines Akten-Absenders' }
    return {
      art: 'vorschlag',
      kandidaten: [{
        kundeId: a.id,
        bereich: a.bereich,
        name: akteName(a),
        grund: istRundschreiben ? 'Absender ist in der Akte hinterlegt, die Mail sieht aber nach Rundschreiben aus' : 'Absender ist in der Akte hinterlegt, die Mail wurde aber als unwichtig eingestuft',
      }],
    }
  }

  // d) Scan-Eingang: Betreff ist genau der Name einer Akte, die Mail hat Anhänge.
  if (!istRundschreiben && hatAnhaenge(m)) {
    const treffer = k.akten.filter((a) => betreffIstAktenName(m.betreff, a))
    if (treffer.length === 1) return { art: 'zuordnen', kundeId: treffer[0].id, weg: 'betreff', grund: 'Betreff ist der Name der Akte (Scan-Eingang)' }
    if (treffer.length > 1 && treffer.length <= HOECHSTENS_KANDIDATEN) {
      return { art: 'vorschlag', kandidaten: treffer.map((a) => ({ kundeId: a.id, bereich: a.bereich, name: akteName(a), grund: 'Betreff ist der Name dieser Akte (gleicher Name in mehreren Akten)' })) }
    }
  }

  // c) Betreff-Antwort auf eine Mail aus genau einer Akte, und der Absender war deren Empfänger.
  const betreffNorm = normBetreff(m.betreff)
  const seit = jetzt.getTime() - GESENDET_FENSTER_TAGE * TAG_MS
  const passendeGesendete = betreffNorm.length >= 4
    ? k.gesendet.filter((g) => g.kunde_id && aktenNachId.has(g.kunde_id) && normBetreff(g.betreff) === betreffNorm && (!g.gesendet_am || Date.parse(g.gesendet_am) >= seit))
    : []
  if (!istRundschreiben && !eigeneAdresse && istAntwortBetreff(m.betreff)) {
    const akten = new Set(passendeGesendete.filter((g) => adresseNorm(g.an) === von).map((g) => String(g.kunde_id)))
    if (akten.size === 1) return { art: 'zuordnen', kundeId: [...akten][0], weg: 'betreff', grund: 'Antwort mit gleichem Betreff an den Empfänger einer Mail aus dieser Akte' }
  }

  if (istRundschreiben) return relevanzLeer ? { art: 'rundschreiben', grund: hinweise.liste.join(', ') } : { art: 'nichts', grund: 'Rundschreiben' }
  // Was die KI als unwichtig eingestuft hat und nicht sicher zu einer Akte gehört, bleibt ausgeblendet.
  if (unwichtig) return { art: 'nichts', grund: 'als unwichtig eingestuft' }

  // Vorschläge (unsicher) — stärkste zuerst, je Akte nur der erste Grund.
  const kandidaten: Kandidat[] = []
  const dazu = (a: AkteZeile | undefined, grund: string) => {
    if (!a || kandidaten.some((x) => x.kundeId === a.id)) return
    kandidaten.push({ kundeId: a.id, bereich: a.bereich, name: akteName(a), grund })
  }
  if (!eigeneAdresse) {
    for (const g of k.gesendet) if (g.kunde_id && adresseNorm(g.an) === von) dazu(aktenNachId.get(g.kunde_id), 'An diese Adresse wurde aus der Akte geschrieben')
  }
  for (const g of passendeGesendete) dazu(aktenNachId.get(String(g.kunde_id)), 'Gleicher Betreff wie eine Mail aus der Akte')
  const domain = domainVon(von)
  if (domain && !eigeneAdresse && !FREEMAIL.has(domain) && !k.eigeneDomains.has(domain)) {
    const gleicheDomain = k.akten.filter((a) => domainVon(adresseNorm(a.email)) === domain)
    if (gleicheDomain.length <= HOECHSTENS_KANDIDATEN) for (const a of gleicheDomain) dazu(a, `Gleiche Absender-Domain wie die Akte (@${domain})`)
    // Eigene Domain, deren Name wie die Akte klingt (z. B. hello@sanny.rocks → „Sanny Simpfendörfer“).
    const kennwort = normText(domain.split('.').slice(0, -1).join(' ')).split(' ').filter((w) => bedeutsam(w, k.eigeneWoerter) && w.length >= 4)
    if (kennwort.length > 0) {
      const klingtWie = k.akten.filter((a) => {
        const namen = new Set(woerter(`${a.firma ?? ''} ${a.ansprechpartner ?? ''}`).filter((w) => bedeutsam(w, k.eigeneWoerter)))
        return kennwort.some((w) => namen.has(w))
      })
      if (klingtWie.length <= HOECHSTENS_KANDIDATEN) for (const a of klingtWie) dazu(a, `Die Absender-Domain @${domain} klingt nach dieser Akte`)
    }
  }
  const textWoerter = new Set(woerter(`${m.betreff ?? ''} ${m.von_name ?? ''} ${m.ausschnitt ?? ''}`))
  const namensTreffer: { a: AkteZeile; grund: string }[] = []
  for (const a of k.akten) {
    const grund = nameImText(a, textWoerter, k.eigeneWoerter)
    if (grund) namensTreffer.push({ a, grund })
  }
  // Viele Namenstreffer auf einmal (Sammelmail, Liste) sind kein Hinweis auf eine bestimmte Akte.
  if (namensTreffer.length <= HOECHSTENS_KANDIDATEN) for (const t of namensTreffer) dazu(t.a, t.grund)

  if (kandidaten.length === 0) return { art: 'nichts', grund: 'kein Hinweis auf eine Akte' }
  return { art: 'vorschlag', kandidaten: kandidaten.slice(0, HOECHSTENS_KANDIDATEN) }
}

// ---------------------------------------------------------------------------------------------------
// Kontext laden
// ---------------------------------------------------------------------------------------------------

export async function ladeKontext(admin: Admin, mails: MailZeile[], jetzt = new Date()): Promise<Kontext> {
  const seit = new Date(jetzt.getTime() - GESENDET_FENSTER_TAGE * TAG_MS).toISOString()
  const [akten, team, gesendet, scan] = await Promise.all([
    // Seitenweise (die Datenbank liefert höchstens 1000 Zeilen je Abfrage; ein limit(3000) hilft nicht).
    alleZeilen(() => admin.from('kunden').select('id, bereich, firma, ansprechpartner, email').neq('bereich', 'privat')),
    admin.from('mitarbeiter').select('name, email'),
    alleZeilen(() => admin.from('gesendete_emails').select('message_id, an, betreff, kunde_id, gesendet_am').is('besitzer_email', null).gte('gesendet_am', seit), { ordnung: ['gesendet_am', 'id'], aufsteigend: false, hoechstens: 3000 }),
    admin.from('scan_eingang').select('aktiv, absender').eq('id', 'standard').maybeSingle(),
  ])
  if (akten.error) throw new Error(`Akten nicht lesbar: ${akten.error.message}`)
  if (team.error) throw new Error(`Mitarbeiter nicht lesbar: ${team.error.message}`)
  if (gesendet.error) throw new Error(`Gesendete Mails nicht lesbar: ${gesendet.error.message}`)
  const leute = (team.data ?? []) as { name: string | null; email: string | null }[]
  const mitarbeiterAdressen = new Set(leute.map((p) => adresseNorm(p.email)).filter(Boolean))
  const eigeneWoerter = new Set<string>(EIGENE_FIRMA)
  for (const p of leute) for (const w of woerter(String(p.name ?? ''))) eigeneWoerter.add(w)
  const eigeneDomains = new Set(['amayer-holding.com', 'fundament-it.de'])
  for (const a of mitarbeiterAdressen) {
    const d = domainVon(a)
    if (d && !FREEMAIL.has(d)) eigeneDomains.add(d)
  }
  const ausAkten = ((gesendet.data ?? []) as GesendetZeile[]).filter((g) => g.kunde_id)
  const kennungAkten = new Map<string, Set<string>>()
  const merke = (kennung: string | null | undefined, kundeId: string | null | undefined) => {
    const k = kennungNorm(kennung)
    if (!k || !kundeId) return
    if (!kennungAkten.has(k)) kennungAkten.set(k, new Set())
    kennungAkten.get(k)!.add(String(kundeId))
  }
  for (const g of ausAkten) merke(g.message_id, g.kunde_id)
  // Frühere Mails desselben Verlaufs, die schon einer Akte zugeordnet sind (nur die, auf die sich die Mails beziehen).
  const roheKennungen = new Set<string>()
  for (const m of mails) {
    for (const wert of [...kopfzeile(m.rohdaten, 'in_reply_to'), ...kopfzeile(m.rohdaten, 'references')]) {
      for (const t of wert.match(/<[^<>\s]+>/g) ?? []) roheKennungen.add(t.trim())
    }
  }
  // Nur gewöhnliche Kennungen abfragen: Eine einzige ungewöhnliche (Sonderzeichen, sehr lang) ließ am 23.11.2026 die
  // Schutzschicht vor der Datenbank die ganze Abfrage abweisen — dann blieb die Zuordnung für ALLE Mails stehen.
  const liste = [...roheKennungen].filter((t) => t.length <= 200 && /^<[A-Za-z0-9._%+=$#!&*~^{}|/?'-]+@[A-Za-z0-9._-]+>$/.test(t))
  type VerlaufZeile = { message_id: string; zugewiesener_kunde_id: string | null }
  const frage = (teil: string[]) => admin.from('eingegangene_emails').select('message_id, zugewiesener_kunde_id').is('besitzer_email', null).in('message_id', teil)
  for (let i = 0; i < liste.length; i += 50) {
    const teil = liste.slice(i, i + 50)
    const { data, error } = await frage(teil)
    if (!error) {
      for (const z of (data ?? []) as VerlaufZeile[]) merke(z.message_id, z.zugewiesener_kunde_id)
      continue
    }
    // Abgewiesen: einzeln nachfragen, was nicht geht, auslassen (die Mail wird dann ohne diesen Verlaufs-Hinweis geprüft).
    for (const kennung of teil) {
      const einzeln = await frage([kennung])
      if (einzeln.error) {
        console.error('Post-Zuordnung: Verlaufs-Kennung nicht abfragbar, ausgelassen', kennung.slice(0, 80))
        continue
      }
      for (const z of (einzeln.data ?? []) as VerlaufZeile[]) merke(z.message_id, z.zugewiesener_kunde_id)
    }
  }
  const scanAbsender = new Set<string>(scan?.data?.aktiv ? ((scan.data.absender ?? []) as string[]).map((a) => String(a).trim().toLowerCase()) : [])
  return { akten: (akten.data ?? []) as AkteZeile[], mitarbeiterAdressen, eigeneWoerter, eigeneDomains, gesendet: ausAkten, kennungAkten, scanAbsender }
}

// ---------------------------------------------------------------------------------------------------
// Lauf (Minutentakt)
// ---------------------------------------------------------------------------------------------------

export type ZuordnungsOptionen = {
  /** Höchstens so viele Mails je Lauf (Standard 25). */
  hoechstens?: number
  /** Nur Mails, die in den letzten n Tagen eingegangen sind (Standard 3). */
  tage?: number
  /** Nichts beanspruchen, nichts schreiben — nur sagen, was passieren würde (alle offenen Mails im Zeitraum). */
  trockenlauf?: boolean
  zeitBudgetMs?: number
  jetzt?: Date
  /** Nur Mails dieses Postfachs (postfaecher.id) — für die einmalige Überführung ins Bereichspostfach (bereichspostfach.ts). */
  postfachId?: string
}

export type ZuordnungsErgebnis = {
  geprueft: number
  zugeordnet: number
  vorschlaege: number
  rundschreiben: number
  fehler: string[]
  entscheidungen?: { id: string; von: string; betreff: string; entscheidung: Entscheidung }[]
}

const SPALTEN = 'id, message_id, von, von_name, betreff, ausschnitt, rohdaten, relevanz, ignoriert, besitzer_email, zugewiesener_kunde_id, mail_datum, erstellt_am, anhaenge, scan_status'

/** Prüft neue Mails im gemeinsamen Postfach (siehe Kopf der Datei). Wirft nie. */
export async function ordneNeueMailsZu(admin: Admin, opts: ZuordnungsOptionen = {}): Promise<ZuordnungsErgebnis> {
  const ergebnis: ZuordnungsErgebnis = { geprueft: 0, zugeordnet: 0, vorschlaege: 0, rundschreiben: 0, fehler: [] }
  const beginn = Date.now()
  try {
    const jetzt = opts.jetzt ?? new Date()
    const seit = new Date(jetzt.getTime() - (opts.tage ?? 3) * TAG_MS).toISOString()
    const grenze = opts.trockenlauf ? 5000 : Math.max(1, Math.min(opts.hoechstens ?? 25, 100))
    let abfrage = admin
      .from('eingegangene_emails')
      .select(opts.trockenlauf ? SPALTEN : 'id')
      .is('besitzer_email', null)
      .is('zugewiesener_kunde_id', null)
      .gte('erstellt_am', seit)
    if (opts.postfachId) abfrage = abfrage.eq('postfach_id', opts.postfachId)
    if (!opts.trockenlauf) abfrage = abfrage.is('zuordnung_geprueft_am', null)
    const { data: offen, error } = await abfrage.order('erstellt_am', { ascending: true }).limit(grenze)
    if (error) throw new Error(`Postfach nicht lesbar: ${error.message}`)
    let mails: MailZeile[]
    if (opts.trockenlauf) {
      mails = (offen ?? []) as MailZeile[]
    } else {
      const ids = ((offen ?? []) as { id: string }[]).map((z) => String(z.id))
      if (ids.length === 0) return ergebnis
      // Beanspruchen: nur Zeilen, deren Prüfzeitpunkt noch leer war, gehören diesem Lauf.
      const { data: geholt, error: anspruchFehler } = await admin
        .from('eingegangene_emails')
        .update({ zuordnung_geprueft_am: jetzt.toISOString() })
        .in('id', ids)
        .is('zuordnung_geprueft_am', null)
        .select('id')
      if (anspruchFehler) throw new Error(`Mails nicht beanspruchbar: ${anspruchFehler.message}`)
      const meine = ((geholt ?? []) as { id: string }[]).map((z) => String(z.id))
      if (meine.length === 0) return ergebnis
      const { data: zeilen, error: lesefehler } = await admin.from('eingegangene_emails').select(SPALTEN).in('id', meine)
      if (lesefehler) throw new Error(`Mails nicht lesbar: ${lesefehler.message}`)
      mails = (zeilen ?? []) as MailZeile[]
    }
    if (mails.length === 0) return ergebnis
    // Beansprucht, aber nicht geprüft (Kontext nicht ladbar, Zeit um): wieder freigeben — sonst blieben diese Mails
    // für immer ungeprüft, und eine Antwort im Verlauf einer Akte würde nie zugeordnet (wie terminZuordnung.ts).
    const anspruch = jetzt.toISOString()
    const freigeben = async (ids: string[]) => {
      if (opts.trockenlauf || ids.length === 0) return
      const { error: e } = await admin.from('eingegangene_emails').update({ zuordnung_geprueft_am: null }).in('id', ids).eq('zuordnung_geprueft_am', anspruch)
      if (e) ergebnis.fehler.push(`Mails nicht freigegeben: ${e.message}`)
    }
    let kontext: Kontext
    try {
      kontext = await ladeKontext(admin, mails, jetzt)
    } catch (err) {
      await freigeben(mails.map((m) => m.id))
      throw err
    }
    if (opts.trockenlauf) ergebnis.entscheidungen = []
    for (const [i, m] of mails.entries()) {
      if (!opts.trockenlauf && Date.now() - beginn > (opts.zeitBudgetMs ?? 40_000)) {
        await freigeben(mails.slice(i).map((x) => x.id))
        break
      }
      ergebnis.geprueft++
      const e = entscheide(m, kontext, jetzt)
      if (e.art === 'zuordnen') ergebnis.zugeordnet++
      else if (e.art === 'vorschlag') ergebnis.vorschlaege++
      else if (e.art === 'rundschreiben') ergebnis.rundschreiben++
      if (opts.trockenlauf) {
        ergebnis.entscheidungen!.push({ id: m.id, von: String(m.von ?? ''), betreff: String(m.betreff ?? ''), entscheidung: e })
        continue
      }
      try {
        await fuehreAus(admin, m, e, jetzt)
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        ergebnis.fehler.push(`${m.id}: ${text}`)
        if (e.art === 'zuordnen') ergebnis.zugeordnet--
        else if (e.art === 'vorschlag') ergebnis.vorschlaege--
        else if (e.art === 'rundschreiben') ergebnis.rundschreiben--
      }
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    console.error('Post-Zuordnung fehlgeschlagen:', text)
    ergebnis.fehler.push(text)
  }
  return ergebnis
}

async function fuehreAus(admin: Admin, m: MailZeile, e: Entscheidung, jetzt: Date): Promise<void> {
  if (e.art === 'nichts') return
  if (e.art === 'rundschreiben') {
    const { error } = await admin.from('eingegangene_emails').update({ relevanz: 'nicht_relevant' }).eq('id', m.id).is('relevanz', null)
    if (error) throw new Error(error.message)
    return
  }
  if (e.art === 'vorschlag') {
    const vorschlag = { status: 'offen', erstellt_am: jetzt.toISOString(), kandidaten: e.kandidaten }
    const { error } = await admin.from('eingegangene_emails').update({ zuordnung_vorschlag: vorschlag }).eq('id', m.id).is('zugewiesener_kunde_id', null)
    if (error) throw new Error(error.message)
    return
  }
  // Unmittelbar vorher frisch lesen: Hat inzwischen jemand (Mitarbeiter, anderer Lauf) zugeordnet, bleibt es dabei.
  const { data: frisch, error: lesefehler } = await admin.from('eingegangene_emails').select('zugewiesener_kunde_id, relevanz').eq('id', m.id).maybeSingle()
  if (lesefehler) throw new Error(lesefehler.message)
  if (!frisch || frisch.zugewiesener_kunde_id) return
  const r = await ordneMailZu(admin, m.id, e.kundeId, WER)
  if (!r.ok) throw new Error(r.fehler)
  const nachtrag: Record<string, unknown> = { zuordnung_vorschlag: { status: 'automatisch', erstellt_am: jetzt.toISOString(), kundeId: e.kundeId, weg: e.weg, grund: e.grund } }
  // Eine Antwort in einem Akten-Verlauf ist nie unwichtig — sonst bliebe sie im Postfach ausgeblendet.
  if (frisch.relevanz === 'nicht_relevant') nachtrag.relevanz = 'kunde'
  const { error } = await admin.from('eingegangene_emails').update(nachtrag).eq('id', m.id)
  if (error) console.error('Post-Zuordnung: Vermerk nicht gespeichert', m.id, error.message)
}
