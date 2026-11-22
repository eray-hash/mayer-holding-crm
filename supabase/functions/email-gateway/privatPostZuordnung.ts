// Private Post sortieren (22.11.2026): Mails in den persönlichen Postfächern der Mitarbeiter (besitzer_email gesetzt)
// gehören allein ihrem Besitzer. Dieser Schritt hilft dem Besitzer beim Aufräumen, ohne etwas für andere sichtbar zu
// machen:
//  1. Vorschlag, zu welcher Akte eine Mail wahrscheinlich gehört — mit derselben Bewertung wie die Post-Zuordnung im
//     gemeinsamen Postfach (mailZuordnung.ts: entscheide/ladeKontext). Kandidaten sind nur Akten, die der Besitzer
//     sehen darf (Bereichsrechte wie im Assistenten, rechte.ts), und seine eigenen privaten Kontakte.
//     Hier wird NIE automatisch zugeordnet oder übergeben: auch ein sicherer Treffer ist nur ein Vorschlag
//     (sicher: true). Übergeben ins CRM geht nur per Klick (Privat → Mein Postfach) oder per Assistent
//     (meine_post_vorschlaege) — dort über den bestehenden Weg mail_freigeben + mail_zuordnen.
//  2. Rundschreiben erkennen (Abmelde-Hinweise, Browser-Ansicht, Werbesprache im Text), damit sie in der Ansicht des
//     Besitzers ausgeblendet werden können. Abgeholte Mails tragen keine Kopfzeilen, deshalb zählt vor allem der Text.
//     Reine Benachrichtigungen (noreply: Termin, Bestellung, Konto) bleiben sichtbar.
//
// Gespeichert wird in eingegangene_emails.zuordnung_vorschlag mit art 'privat' und eigenen Status-Werten
// ('privat_…'), damit das gemeinsame Postfach (Status 'offen') diese Vorschläge nie zeigt. Die Zeilen bleiben privat:
// Die Datenbank zeigt eine Zeile mit besitzer_email nur ihrem Besitzer (Regel „eingegangene_emails lesen“).
// Beim Übergeben ins CRM wird der Vorschlag vorher geleert (Namen privater Kontakte dürfen nicht mitwandern).
//
// Ohne KI, ohne Nachrichten. Jede Mail wird genau einmal geprüft: Vor der Arbeit wird sie beansprucht (Status
// 'privat_pruefung'); bleibt ein Anspruch nach einem Abbruch hängen, wird er nach zehn Minuten neu vergeben.

import { akteName, entscheide, type AkteZeile, type GesendetZeile, type Kandidat, type Kontext, ladeKontext, type MailZeile, normText, rundschreibenHinweise } from './mailZuordnung.ts'
import { darfAkte, ohneNurPrivat, type RechteMitarbeiter, SAMMELAKTEN } from '../telegram-gateway/rechte.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Admin = any

const TAG_MS = 86_400_000
const ANSPRUCH_VERFAELLT_MS = 10 * 60_000
/** Nur Mails der letzten 30 Tage (beim ersten Lauf der Rückstand, danach nur neue). */
const STANDARD_TAGE = 30

export const PRIVAT_ART = 'privat'
export type PrivatStatus =
  | 'privat_pruefung'
  | 'privat_offen'
  | 'privat_rundschreiben'
  | 'privat_keiner'
  | 'privat_uebernommen'
  | 'privat_verworfen'

export type PrivatKandidat = Kandidat & { privat: boolean; sicher?: boolean }

export type PrivatVorschlag = {
  art: typeof PRIVAT_ART
  status: PrivatStatus
  erstellt_am?: string
  seit?: string
  kandidaten?: PrivatKandidat[]
  grund?: string
  erledigt_am?: string
  erledigt_von?: string
  kundeId?: string
}

export type PrivatEntscheidung =
  | { art: 'vorschlag'; kandidaten: PrivatKandidat[] }
  | { art: 'rundschreiben'; grund: string }
  | { art: 'nichts'; grund: string }

// ---------------------------------------------------------------------------------------------------
// Rundschreiben im Text erkennen (rein, getestet)
// ---------------------------------------------------------------------------------------------------

/** Eindeutige Hinweise: einer genügt. */
const STARK: [RegExp, string][] = [
  [/\bunsubscribe\b/, 'Abmelde-Link'],
  [/newsletter (abbestellen|abmelden|kuendigen)|vom newsletter abmelden|abmeldung vom newsletter|newsletter abmeldung/, 'Newsletter-Abmeldung'],
  [/(im|in ihrem|in deinem) browser (ansehen|anzeigen|oeffnen|lesen)|view (it |this email )?in (your )?browser|online version|webversion|web version|darstellungsprobleme/, 'Hinweis auf Browser-Ansicht'],
  [/manage (your )?(email )?preferences|e mail einstellungen (verwalten|aendern|anpassen)|benachrichtigungseinstellungen|newsletter einstellungen/, 'Hinweis auf Mail-Einstellungen'],
  [/(wenn|falls) (sie|du) (diese|unsere|keine) (e mails?|mails?|nachrichten|newsletter) (nicht mehr|kuenftig nicht|nicht laenger|mehr) (erhalten|empfangen|bekommen)/, 'Hinweis „keine Mails mehr erhalten“'],
  [/(sie|du) (erhalten|erhaeltst) diese (e mail|mail|nachricht),? (weil|da)/, 'Hinweis „Sie erhalten diese Mail, weil …“'],
]

/** Schwache Hinweise auf Werbung/Rundschreiben: zählen nur zusammen mit einem zweiten schwachen Hinweis. */
const WERBUNG: [RegExp, string][] = [
  [/\b(abmelden|abbestellen|austragen)\b/, 'abmelden'],
  [/\bnewsletter\b/, 'Newsletter'],
  [/\b(jetzt|hier) (entdecken|shoppen|bestellen|sichern|buchen)\b|\bgutschein(code)?\b|\brabatt\b|\bangebot(e)? der woche\b|\b\d{1,2} ?% (rabatt|sparen)\b/, 'Werbesprache'],
]
/** Schwache Hinweise, die auch in Bestätigungen und Benachrichtigungen stehen (Bestellung, Termin, Konto) — allein nie genug. */
const ALLGEMEIN_SCHWACH: [RegExp, string][] = [
  [/\bimpressum\b/, 'Impressum'],
  [/alle rechte vorbehalten|all rights reserved/, 'Rechtehinweis'],
]

/** Typische Versand-Namen vorn in der Adresse von Rundschreiben. */
const SAMMEL_LOKAL = /^(newsletter|news|marketing|mailing|mailings|promo|promotion|angebote|deals|aktion|aktionen|kampagne|campaign|offers?|hello|info-?news|service-?news)([._+-]|$)/
/** Versand-Unterdomains großer Versender (mail.firma.de, news.firma.de, e.firma.de …). */
const SAMMEL_DOMAIN = /^(mail|mailing|mailer|news|newsletter|email|e|em|m|info|marketing|crm|campaign|go|reply)\.[a-z0-9-]+\.[a-z]+$/
/** Bekannte Versanddienste. */
const VERSANDDIENST = /(mailchimp|mcsv\.net|mcdlv\.net|sendinblue|brevo|rsgsv|cleverreach|klaviyo|hubspot|mailjet|sendgrid|mandrillapp|amazonses|newsletter2go|rapidmail|getresponse|constantcontact|campaign-archive|emarsys|salesforce|exacttarget|inxmail|optivo|episerver)/

function adresseKlein(s: string | null | undefined): string {
  const roh = String(s ?? '').trim().toLowerCase()
  const m = roh.match(/<([^>]+)>/)
  return (m ? m[1] : roh).trim()
}

/** Ist die Mail eine Antwort oder Weiterleitung in einem Gespräch? Dann nie „Rundschreiben“ (außer Systemabsender). */
function istGespraech(betreff: string | null | undefined): boolean {
  return /^\s*(re|aw|antw|wg|fw|fwd|sv|vs)\s*(\[\d+\])?\s*:/i.test(String(betreff ?? ''))
}

/**
 * Warum die private Mail nach Rundschreiben aussieht — leer (null), wenn nichts dafür spricht.
 * Ein starker Hinweis genügt (Abmelde-Link, Browser-Ansicht …). Sonst braucht es zwei verschiedene schwache Hinweise,
 * davon mindestens einen auf Werbung (abmelden, Newsletter, Werbesprache). Reine Benachrichtigungen von
 * „noreply“-Absendern (Termin, Bestellung, Konto, Prüfung) bleiben bewusst sichtbar — sie können wichtig sein.
 */
export function privatRundschreiben(m: MailZeile): string | null {
  const basis = rundschreibenHinweise(m)
  if (basis.liste.length > 0) return basis.liste.join(', ')
  if (istGespraech(m.betreff)) return null
  const text = normText(`${m.betreff ?? ''} ${m.ausschnitt ?? ''}`)
  for (const [muster, grund] of STARK) if (muster.test(text)) return grund
  const werbung = new Set<string>()
  for (const [muster, grund] of WERBUNG) if (muster.test(text)) werbung.add(grund)
  if (werbung.size === 0) return null
  const gruende = new Set<string>(werbung)
  for (const [muster, grund] of ALLGEMEIN_SCHWACH) if (muster.test(text)) gruende.add(grund)
  const von = adresseKlein(m.von)
  const [lokal = '', domain = ''] = von.split('@')
  if (SAMMEL_LOKAL.test(lokal) || basis.system) gruende.add('Versandadresse')
  if (SAMMEL_DOMAIN.test(domain) || VERSANDDIENST.test(domain)) gruende.add('Versanddienst')
  return gruende.size >= 2 ? [...gruende].join(', ') : null
}

// ---------------------------------------------------------------------------------------------------
// Entscheidung je Mail (rein, getestet)
// ---------------------------------------------------------------------------------------------------

/**
 * Vorschlag für eine private Mail. Nutzt entscheide() aus mailZuordnung.ts mit dem Kontext des Besitzers
 * (nur seine Akten). „zuordnen“ wird hier zu einem einzelnen Vorschlag mit sicher: true.
 */
export function entscheidePrivat(m: MailZeile, k: Kontext, jetzt = new Date()): PrivatEntscheidung {
  if (m.zugewiesener_kunde_id) return { art: 'nichts', grund: 'schon bei einer Akte abgelegt' }
  // entscheide() lässt private Mails absichtlich liegen — hier ist genau das gewollt, deshalb ohne Besitzer prüfen.
  const e = entscheide({ ...m, besitzer_email: null, ignoriert: false }, k, jetzt)
  const aktenNachId = new Map(k.akten.map((a) => [a.id, a]))
  const alsKandidat = (x: Kandidat, sicher?: boolean): PrivatKandidat => ({ ...x, privat: x.bereich === 'privat', ...(sicher ? { sicher: true } : {}) })

  if (e.art === 'zuordnen') {
    const a = aktenNachId.get(e.kundeId)
    if (!a) return { art: 'nichts', grund: 'Akte nicht sichtbar' }
    return { art: 'vorschlag', kandidaten: [alsKandidat({ kundeId: a.id, bereich: a.bereich, name: akteName(a), grund: e.grund }, true)] }
  }
  // Mails von Kollegen sind nie Rundschreiben.
  const vonKollege = k.mitarbeiterAdressen.has(adresseKlein(m.von))
  const rund = vonKollege ? null : privatRundschreiben(m)
  if (e.art === 'vorschlag') {
    // Absender ist bei einer Akte hinterlegt → zeigen, auch wenn der Text nach Rundschreiben klingt.
    const absenderBekannt = e.kandidaten.some((x) => adresseKlein(aktenNachId.get(x.kundeId)?.email) === adresseKlein(m.von))
    if (rund && !absenderBekannt) return { art: 'rundschreiben', grund: rund }
    return { art: 'vorschlag', kandidaten: e.kandidaten.map((x) => alsKandidat(x)) }
  }
  // entscheide() blendet Systemabsender (noreply …) aus; im privaten Postfach nur, wenn auch der Text nach Rundschreiben aussieht.
  if (rund) return { art: 'rundschreiben', grund: rund }
  return { art: 'nichts', grund: e.grund }
}

/** Ist dieser Anspruch eines früheren Laufs liegen geblieben (älter als zehn Minuten)? */
export function istHaengenderAnspruch(v: unknown, jetzt = new Date()): boolean {
  if (!v || typeof v !== 'object') return false
  const x = v as Partial<PrivatVorschlag>
  if (x.art !== PRIVAT_ART || x.status !== 'privat_pruefung') return false
  const seit = Date.parse(String(x.seit ?? ''))
  return !Number.isFinite(seit) || jetzt.getTime() - seit > ANSPRUCH_VERFAELLT_MS
}

// ---------------------------------------------------------------------------------------------------
// Kontext des Besitzers
// ---------------------------------------------------------------------------------------------------

export type Besitzer = RechteMitarbeiter & { email: string; name?: string | null; aktiv?: boolean | null }
export type PrivatAkte = AkteZeile & { verantwortlich_email?: string | null }

function domainVon(adresse: string): string {
  return adresse.split('@')[1]?.trim() ?? ''
}

/**
 * Der Kontext für einen Besitzer, aus dem allgemeinen Kontext (ladeKontext) abgeleitet:
 * nur Akten, die er sehen darf (Holding-Akten nach Bereichsrechten, keine Sammelakten), dazu seine privaten Kontakte
 * und seine privat gesendeten Mails an diese Kontakte. Die Adressen seiner Postfächer zählen als eigene.
 */
export function kontextFuerBesitzer(
  basis: Kontext,
  besitzer: Besitzer,
  privatAkten: PrivatAkte[],
  privatGesendet: (GesendetZeile & { besitzer_email?: string | null })[],
  postfachAdressen: string[],
): Kontext {
  const ich = String(besitzer.email ?? '').trim().toLowerCase()
  const rechte = ohneNurPrivat(besitzer)
  const oeffentlich = basis.akten.filter((a) => a.bereich !== 'privat' && !SAMMELAKTEN.includes(a.id) && darfAkte(rechte, a))
  const eigenePrivate = privatAkten.filter((a) => a.bereich === 'privat' && String(a.verantwortlich_email ?? '').trim().toLowerCase() === ich)
  const akten: AkteZeile[] = [...oeffentlich, ...eigenePrivate.map(({ id, bereich, firma, ansprechpartner, email }) => ({ id, bereich, firma, ansprechpartner, email }))]
  const erlaubt = new Set(akten.map((a) => a.id))
  const meineGesendet = privatGesendet.filter((g) => String(g.besitzer_email ?? '').toLowerCase() === ich && g.kunde_id && erlaubt.has(String(g.kunde_id)))
  const gesendet = [...basis.gesendet.filter((g) => g.kunde_id && erlaubt.has(String(g.kunde_id))), ...meineGesendet]
  const kennungAkten = new Map<string, Set<string>>()
  for (const [kennung, ids] of basis.kennungAkten) {
    const sichtbar = [...ids].filter((id) => erlaubt.has(id))
    if (sichtbar.length > 0) kennungAkten.set(kennung, new Set(sichtbar))
  }
  for (const g of meineGesendet) {
    const roh = String(g.message_id ?? '').trim().toLowerCase()
    const lt = roh.indexOf('<')
    const k = lt >= 0 ? roh.slice(lt) : roh ? `<${roh}>` : ''
    if (!k || !g.kunde_id) continue
    if (!kennungAkten.has(k)) kennungAkten.set(k, new Set())
    kennungAkten.get(k)!.add(String(g.kunde_id))
  }
  const eigeneDomains = new Set(basis.eigeneDomains)
  const eigeneWoerter = new Set(basis.eigeneWoerter)
  const mitarbeiterAdressen = new Set(basis.mitarbeiterAdressen)
  for (const adresse of [ich, ...postfachAdressen.map((p) => p.trim().toLowerCase())]) {
    if (!adresse) continue
    mitarbeiterAdressen.add(adresse)
    const d = domainVon(adresse)
    // Eigene Firmen-Domain des Postfachs: ihr Name steht in jeder Signatur und ist kein Hinweis auf eine Akte.
    if (d && !['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.de', 'outlook.com', 'outlook.de', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'icloud.com', 'yahoo.de', 'yahoo.com'].includes(d)) {
      eigeneDomains.add(d)
      for (const w of normText(d.split('.').slice(0, -1).join(' ')).split(' ')) if (w.length >= 3) eigeneWoerter.add(w)
    }
  }
  for (const w of normText(String(besitzer.name ?? '')).split(' ')) if (w) eigeneWoerter.add(w)
  return { akten, mitarbeiterAdressen, eigeneWoerter, eigeneDomains, gesendet, kennungAkten }
}

/** Gespeicherter Vorschlag zu einer Entscheidung. */
export function vorschlagAus(e: PrivatEntscheidung, jetzt: Date): PrivatVorschlag {
  const erstellt_am = jetzt.toISOString()
  if (e.art === 'vorschlag') return { art: PRIVAT_ART, status: 'privat_offen', erstellt_am, kandidaten: e.kandidaten }
  if (e.art === 'rundschreiben') return { art: PRIVAT_ART, status: 'privat_rundschreiben', erstellt_am, grund: e.grund }
  return { art: PRIVAT_ART, status: 'privat_keiner', erstellt_am }
}

// ---------------------------------------------------------------------------------------------------
// Lauf (Minutentakt)
// ---------------------------------------------------------------------------------------------------

export type PrivatLaufOptionen = {
  /** Höchstens so viele Mails je Lauf (Standard 40, höchstens 100). */
  hoechstens?: number
  /** Nur Mails, die in den letzten n Tagen eingegangen sind (Standard 30). */
  tage?: number
  /** Nichts beanspruchen, nichts schreiben — alle offenen Mails im Zeitraum bewerten und nur zählen. */
  trockenlauf?: boolean
  zeitBudgetMs?: number
  jetzt?: Date
}

export type PrivatLaufErgebnis = {
  geprueft: number
  vorschlaege: number
  sicher: number
  rundschreiben: number
  keiner: number
  fehler: string[]
  /** Nur im Trockenlauf: Zahlen je Besitzer (Adresse), ohne Inhalte. */
  jeBesitzer?: Record<string, { geprueft: number; vorschlaege: number; sicher: number; mitPrivatKontakt: number; rundschreiben: number; keiner: number }>
}

const SPALTEN = 'id, message_id, von, von_name, betreff, ausschnitt, rohdaten, relevanz, ignoriert, besitzer_email, zugewiesener_kunde_id, mail_datum, erstellt_am'

type MailMitBesitzer = MailZeile & { besitzer_email: string }

/** Bewertet private Mails (siehe Kopf der Datei). Berührt ausschließlich Zeilen mit besitzer_email. Wirft nie. */
export async function pruefePrivatePost(admin: Admin, opts: PrivatLaufOptionen = {}): Promise<PrivatLaufErgebnis> {
  const ergebnis: PrivatLaufErgebnis = { geprueft: 0, vorschlaege: 0, sicher: 0, rundschreiben: 0, keiner: 0, fehler: [] }
  const beginn = Date.now()
  try {
    const jetzt = opts.jetzt ?? new Date()
    const seit = new Date(jetzt.getTime() - (opts.tage ?? STANDARD_TAGE) * TAG_MS).toISOString()

    // Nur Postfächer aktiver Mitarbeiter (wie der Abruf selbst).
    const { data: team, error: teamFehler } = await admin.from('mitarbeiter').select('name, email, aktiv, rolle, ist_admin, bereiche')
    if (teamFehler) throw new Error(`Mitarbeiter nicht lesbar: ${teamFehler.message}`)
    const besitzerNachAdresse = new Map<string, Besitzer>()
    for (const p of (team ?? []) as Besitzer[]) {
      const email = String(p.email ?? '').trim().toLowerCase()
      if (email && p.aktiv) besitzerNachAdresse.set(email, { ...p, email })
    }
    if (besitzerNachAdresse.size === 0) return ergebnis
    const adressen = [...besitzerNachAdresse.keys()]

    let mails: MailMitBesitzer[] = []
    if (opts.trockenlauf) {
      mails = await ladeAlleOffenen(admin, adressen, seit)
    } else {
      const grenze = Math.max(1, Math.min(opts.hoechstens ?? 40, 100))
      const { data: offen, error } = await admin
        .from('eingegangene_emails')
        .select('id, zuordnung_vorschlag')
        .in('besitzer_email', adressen)
        .is('zugewiesener_kunde_id', null)
        .gte('erstellt_am', seit)
        .or('zuordnung_vorschlag.is.null,zuordnung_vorschlag->>status.eq.privat_pruefung')
        .order('erstellt_am', { ascending: false })
        .limit(grenze)
      if (error) throw new Error(`Private Mails nicht lesbar: ${error.message}`)
      const zeilen = (offen ?? []) as { id: string; zuordnung_vorschlag: unknown }[]
      const frei = zeilen.filter((z) => z.zuordnung_vorschlag === null || z.zuordnung_vorschlag === undefined).map((z) => String(z.id))
      const haengend = zeilen.filter((z) => istHaengenderAnspruch(z.zuordnung_vorschlag, jetzt))
      if (frei.length === 0 && haengend.length === 0) return ergebnis
      const anspruch: PrivatVorschlag = { art: PRIVAT_ART, status: 'privat_pruefung', seit: jetzt.toISOString() }
      const meine: string[] = []
      if (frei.length > 0) {
        // Beanspruchen: nur Zeilen, deren Vorschlag noch leer war (und die noch privat sind), gehören diesem Lauf.
        const { data: geholt, error: anspruchFehler } = await admin
          .from('eingegangene_emails')
          .update({ zuordnung_vorschlag: anspruch })
          .in('id', frei)
          .in('besitzer_email', adressen)
          .is('zuordnung_vorschlag', null)
          .select('id')
        if (anspruchFehler) throw new Error(`Mails nicht beanspruchbar: ${anspruchFehler.message}`)
        for (const z of (geholt ?? []) as { id: string }[]) meine.push(String(z.id))
      }
      for (const z of haengend) {
        const alt = String((z.zuordnung_vorschlag as PrivatVorschlag).seit ?? '')
        const { data: geholt } = await admin
          .from('eingegangene_emails')
          .update({ zuordnung_vorschlag: anspruch })
          .eq('id', z.id)
          .in('besitzer_email', adressen)
          .eq('zuordnung_vorschlag->>seit', alt)
          .select('id')
        for (const g of (geholt ?? []) as { id: string }[]) meine.push(String(g.id))
      }
      if (meine.length === 0) return ergebnis
      const { data: volle, error: lesefehler } = await admin.from('eingegangene_emails').select(SPALTEN).in('id', meine)
      if (lesefehler) throw new Error(`Mails nicht lesbar: ${lesefehler.message}`)
      mails = ((volle ?? []) as MailZeile[]).filter((m): m is MailMitBesitzer => !!m.besitzer_email)
    }
    if (mails.length === 0) return ergebnis

    // Allgemeiner Kontext einmal je Lauf, dann je Besitzer eingeschränkt.
    const basis = await ladeKontext(admin, mails, jetzt)
    const besitzerDerMails = [...new Set(mails.map((m) => String(m.besitzer_email).toLowerCase()))]
    const gesendetSeit = new Date(jetzt.getTime() - 180 * TAG_MS).toISOString()
    const [privatAkten, privatGesendet, faecher] = await Promise.all([
      alleZeilen(() => admin.from('kunden').select('id, bereich, firma, ansprechpartner, email, verantwortlich_email').eq('bereich', 'privat')),
      alleZeilen(() => admin.from('gesendete_emails').select('message_id, an, betreff, kunde_id, gesendet_am, besitzer_email').in('besitzer_email', besitzerDerMails).gte('gesendet_am', gesendetSeit), { ordnung: ['gesendet_am', 'id'], aufsteigend: false, hoechstens: 3000 }),
      admin.from('postfaecher').select('adresse, besitzer_email').in('besitzer_email', besitzerDerMails),
    ])
    if (privatAkten.error) throw new Error(`Private Kontakte nicht lesbar: ${privatAkten.error.message}`)
    if (privatGesendet.error) throw new Error(`Private gesendete Mails nicht lesbar: ${privatGesendet.error.message}`)
    if (faecher.error) throw new Error(`Postfächer nicht lesbar: ${faecher.error.message}`)
    const kontexte = new Map<string, Kontext>()
    for (const ich of besitzerDerMails) {
      const besitzer = besitzerNachAdresse.get(ich)
      if (!besitzer) continue
      const adressenDesFachs = ((faecher.data ?? []) as { adresse: string; besitzer_email: string }[]).filter((f) => String(f.besitzer_email).toLowerCase() === ich).map((f) => f.adresse)
      kontexte.set(ich, kontextFuerBesitzer(basis, besitzer, (privatAkten.data ?? []) as PrivatAkte[], (privatGesendet.data ?? []) as GesendetZeile[], adressenDesFachs))
    }

    if (opts.trockenlauf) ergebnis.jeBesitzer = {}
    for (const m of mails) {
      if (!opts.trockenlauf && Date.now() - beginn > (opts.zeitBudgetMs ?? 25_000)) break
      const ich = String(m.besitzer_email).toLowerCase()
      const k = kontexte.get(ich)
      if (!k) continue
      const e = entscheidePrivat(m, k, jetzt)
      ergebnis.geprueft++
      const sicher = e.art === 'vorschlag' && e.kandidaten.some((x) => x.sicher)
      if (e.art === 'vorschlag') ergebnis.vorschlaege++
      if (sicher) ergebnis.sicher++
      if (e.art === 'rundschreiben') ergebnis.rundschreiben++
      if (e.art === 'nichts') ergebnis.keiner++
      if (opts.trockenlauf) {
        const z = (ergebnis.jeBesitzer![ich] ??= { geprueft: 0, vorschlaege: 0, sicher: 0, mitPrivatKontakt: 0, rundschreiben: 0, keiner: 0 })
        z.geprueft++
        if (e.art === 'vorschlag') z.vorschlaege++
        if (sicher) z.sicher++
        if (e.art === 'vorschlag' && e.kandidaten.some((x) => x.privat)) z.mitPrivatKontakt++
        if (e.art === 'rundschreiben') z.rundschreiben++
        if (e.art === 'nichts') z.keiner++
        continue
      }
      // Nur schreiben, wenn die Mail noch privat beim selben Besitzer liegt, unzugeordnet ist und diesem Lauf gehört.
      const { error } = await admin
        .from('eingegangene_emails')
        .update({ zuordnung_vorschlag: vorschlagAus(e, jetzt) })
        .eq('id', m.id)
        .eq('besitzer_email', m.besitzer_email)
        .is('zugewiesener_kunde_id', null)
      if (error) ergebnis.fehler.push(`${m.id}: ${error.message}`)
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    console.error('Private Post: Vorschläge fehlgeschlagen:', text)
    ergebnis.fehler.push(text)
  }
  return ergebnis
}

/** Trockenlauf: alle noch nicht bewerteten privaten Mails im Zeitraum, seitenweise (die Datenbank liefert höchstens 1000 je Abfrage). */
async function ladeAlleOffenen(admin: Admin, adressen: string[], seit: string): Promise<MailMitBesitzer[]> {
  const gesehen = new Set<string>()
  const aus: MailMitBesitzer[] = []
  let bis: string | null = null
  for (let runde = 0; runde < 50; runde++) {
    let q = admin
      .from('eingegangene_emails')
      .select(`${SPALTEN}, zuordnung_vorschlag`)
      .in('besitzer_email', adressen)
      .is('zugewiesener_kunde_id', null)
      .is('zuordnung_vorschlag', null)
      .gte('erstellt_am', seit)
    if (bis) q = q.lte('erstellt_am', bis)
    const { data, error } = await q.order('erstellt_am', { ascending: false }).limit(1000)
    if (error) throw new Error(`Private Mails nicht lesbar: ${error.message}`)
    const zeilen = (data ?? []) as MailMitBesitzer[]
    const neu = zeilen.filter((z) => !gesehen.has(z.id))
    for (const z of neu) {
      gesehen.add(z.id)
      aus.push(z)
    }
    if (zeilen.length < 1000 || neu.length === 0) break
    bis = String(zeilen[zeilen.length - 1].erstellt_am)
  }
  return aus
}
