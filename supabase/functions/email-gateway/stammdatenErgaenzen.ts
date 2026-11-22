// Stammdaten aus E-Mail-Signaturen ergänzen (22.11.2026).
//
// Viele Akten haben keine Telefonnummer und keine Anschrift, obwohl der Kunde sie in jeder Mail unter
// seinen Namen schreibt. Dieser Ablauf liest die Signaturen (Regeln: _shared/signaturDaten.ts) und
// - FÜLLT NUR LEERE FELDER (Telefon, Anschrift; E-Mail-Adresse nur, wenn der Absendername eindeutig zur
//   Akte passt) mit einem Verlaufseintrag „Telefon aus E-Mail-Signatur vom … ergänzt: …“,
// - überschreibt nie: Nennt die Signatur etwas anderes als die Akte, entsteht ein Vorschlag in
//   kunden.stammdaten_vorschlaege (Hinweis in der Akte, Assistent-Werkzeug stammdaten_vorschlaege).
//
// Quellen je Akte: Mails, die der Akte zugeordnet sind; nicht zugeordnete Mails im gemeinsamen Postfach von
// der Adresse der Akte; gesendete Mails an die Akte (darin zitierte Antworten des Kunden). Gelesen wird nur,
// was der Kunde selbst geschrieben hat (Abschnitte mit seiner Adresse als Verfasser). Mails aus einem
// persönlichen Postfach zählen nur, wenn ihr Besitzer sie dieser Akte zugeordnet hat. Private Kontakte
// (Bereich „privat“) und die Sammelakten bleiben außen vor. Ohne KI, ohne Nachrichten an irgendwen.
//
// Takt: vom Minuten-Zeitplan (termin_erinnerungen) gerufen, läuft aber höchstens alle 30 Minuten und
// prüft dann die nächsten 15 Akten (reihum über alle Akten, Merker in abteilung_eintraege 'stammdaten_stand';
// bei rund 140 Akten ist jede Akte etwa alle fünf Stunden dran).
// Einmaliger Nachtrag für alle Akten: Aktion stammdaten_nachtrag (nur Geschäftsführung) mit Vorschau.

import {
  type EigeneDaten,
  eigeneDatenAus,
  gleicheAnschrift,
  gleicheNummer,
  htmlZuText,
  istEigeneAdresse,
  namePasstZurAkte,
  type SignaturDaten,
  signaturenVon,
  vergleichbareNummer,
} from '../_shared/signaturDaten.ts'
import {
  alsVorschlaege,
  ergaenztText,
  haengeAn,
  schonVorgeschlagen,
  type StammdatenFeld,
  type StammdatenVorschlag,
  wertAnzeige,
} from '../_shared/stammdatenVorschlag.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Db = any

const TABELLE_STAND = 'abteilung_eintraege'
export const STAND_ID = 'stammdaten_stand'
const TAKT_MS = 30 * 60 * 1000
const JE_LAUF = 15
const SAMMELAKTEN = ['k_intern_holding', 'k_eingang_ungeklaert']
const AKTEN_SPALTEN = 'id, bereich, firma, ansprechpartner, email, telefon, anschrift, stammdaten_vorschlaege'
const WER = 'automatisch'

export type AkteZeile = {
  id: string
  bereich: string | null
  firma: string | null
  ansprechpartner: string | null
  email: string | null
  telefon: string | null
  anschrift: string | null
  stammdaten_vorschlaege?: unknown
}

/** Eine Mail als Quelle, egal ob eingegangen oder gesendet. */
export type MailQuelle = {
  id: string
  art: 'eingang' | 'gesendet'
  absenderEmail: string | null
  absenderName: string | null
  /** ISO-Zeitpunkt der Mail. */
  datum: string
  text: string
  /** Akte, der die Mail zugeordnet ist. */
  kundeId: string | null
  /** Liegt die Mail (noch) in einem persönlichen Postfach? */
  privat: boolean
}

export type Ergaenzung = { feld: StammdatenFeld; wert: string; weitere?: string; mailDatum: string; mailId: string | null }
export type AktePlan = {
  kundeId: string
  name: string
  bereich: string
  ergaenzen: Ergaenzung[]
  vorschlaege: (Ergaenzung & { bisher: string })[]
}

function text(w: unknown): string {
  return typeof w === 'string' ? w : w == null ? '' : String(w)
}

function leer(w: unknown): boolean {
  return !text(w).trim()
}

const heuteBerlin = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d)

/** Adressen aus dem E-Mail-Feld der Akte (es kann mehrere enthalten), klein geschrieben. */
export function adressenDerAkte(email: string | null | undefined): string[] {
  return [...new Set(text(email).toLowerCase().split(/[\s,;]+/).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))]
}

/** Akte kommt in Frage: nicht privat, keine Sammelakte. Auch vollständige Akten werden gelesen — dort
 *  entstehen nur Vorschläge, wenn die Signatur etwas anderes nennt. */
export function kommtInFrage(a: AkteZeile): boolean {
  return a.bereich !== 'privat' && !SAMMELAKTEN.includes(a.id)
}

/** Nummern in einem Telefonfeld, das auch mehrere enthalten kann ("0731 123 / mobil 0172 …"). */
function nummernImFeld(feld: string | null | undefined): string[] {
  const t = text(feld)
  const teile = t.split(/[,;]|\s+(?:oder|und|mobil|handy|tel\.?|fax|privat|büro|geschäftlich)\s*:?\s*/i)
  return [t, ...teile].map((x) => vergleichbareNummer(x)).filter(Boolean)
}

function nummerBekannt(feld: string | null | undefined, nummer: string | null | undefined): boolean {
  const n = vergleichbareNummer(nummer)
  return !!n && nummernImFeld(feld).includes(n)
}

/** Welche Adressen gehören dem Kunden? Die der Akte; fehlt sie, der einzige Absender zugeordneter Mails,
 *  dessen Name zur Akte passt (dann wird die Adresse auch ergänzt). */
export function zielAdressen(akte: AkteZeile, mails: MailQuelle[], eigene: EigeneDaten): { adressen: string[]; neu: { adresse: string; datum: string; mailId: string } | null } {
  const eigeneAdressen = adressenDerAkte(akte.email)
  if (eigeneAdressen.length) return { adressen: eigeneAdressen.filter((a) => !istEigeneAdresse(a, eigene)), neu: null }
  const kandidaten = new Map<string, { datum: string; mailId: string }>()
  for (const m of mails) {
    if (m.art !== 'eingang' || m.kundeId !== akte.id) continue
    const adresse = text(m.absenderEmail).toLowerCase()
    if (!adresse || istEigeneAdresse(adresse, eigene) || /no-?reply|mailer-daemon|postmaster/i.test(adresse)) continue
    if (!namePasstZurAkte(m.absenderName, akte)) continue
    const bisher = kandidaten.get(adresse)
    if (!bisher || bisher.datum < m.datum) kandidaten.set(adresse, { datum: m.datum, mailId: m.id })
  }
  if (kandidaten.size !== 1) return { adressen: [], neu: null }
  const [adresse, info] = [...kandidaten.entries()][0]
  return { adressen: [adresse], neu: { adresse, datum: info.datum.slice(0, 10), mailId: info.mailId } }
}

export type Fund = { datum: string; mailId: string; daten: SignaturDaten }

/** Alle Signatur-Funde des Kunden in den Mails, neueste zuerst. */
export function sammleFunde(akte: AkteZeile, adressen: string[], mails: MailQuelle[], eigene: EigeneDaten): Fund[] {
  const funde: Fund[] = []
  for (const m of mails) {
    if (m.privat && m.kundeId !== akte.id) continue
    for (const adresse of adressen) {
      for (const f of signaturenVon(m.text, { absenderEmail: m.absenderEmail, absenderName: m.absenderName }, adresse, eigene)) {
        funde.push({ datum: f.datum ?? m.datum.slice(0, 10), mailId: m.id, daten: f.daten })
      }
    }
  }
  return funde.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0))
}

/** Was mit einer Akte passieren soll — rechnet nur, liest und schreibt nichts. */
export function planeAkte(akte: AkteZeile, mails: MailQuelle[], eigene: EigeneDaten): AktePlan {
  const plan: AktePlan = { kundeId: akte.id, name: text(akte.firma) || text(akte.ansprechpartner) || akte.id, bereich: text(akte.bereich), ergaenzen: [], vorschlaege: [] }
  if (!kommtInFrage(akte)) return plan
  const { adressen, neu } = zielAdressen(akte, mails, eigene)
  if (!adressen.length) return plan
  if (neu && leer(akte.email)) plan.ergaenzen.push({ feld: 'email', wert: neu.adresse, mailDatum: neu.datum, mailId: neu.mailId })
  const funde = sammleFunde(akte, adressen, mails, eigene)
  const bisherige = alsVorschlaege(akte.stammdaten_vorschlaege)

  // Telefon: die neueste Signatur mit einer Nummer; Festnetz vor Handy, das andere als Zusatz.
  const mitNummer = funde.find((f) => f.daten.telefon || f.daten.mobil)
  if (mitNummer) {
    const d = mitNummer.daten
    const wert = (d.telefon ?? d.mobil)!
    const weitere = d.telefon && d.mobil ? d.mobil : undefined
    const e: Ergaenzung = { feld: 'telefon', wert, ...(weitere ? { weitere } : {}), mailDatum: mitNummer.datum, mailId: mitNummer.mailId }
    if (leer(akte.telefon)) plan.ergaenzen.push(e)
    else {
      // Kennt irgendeine Signatur die Nummer der Akte, ist alles in Ordnung (kein Widerspruch).
      const bekannt = funde.some((f) => [f.daten.telefon, f.daten.mobil, f.daten.fax].some((n) => nummerBekannt(akte.telefon, n)))
      if (!bekannt && !schonVorgeschlagen(bisherige, 'telefon', wert)) plan.vorschlaege.push({ ...e, bisher: text(akte.telefon) })
    }
  }

  // Anschrift: die neueste Signatur mit Anschrift.
  const mitAnschrift = funde.find((f) => f.daten.anschrift)
  if (mitAnschrift) {
    const wert = mitAnschrift.daten.anschrift!
    const e: Ergaenzung = { feld: 'anschrift', wert, mailDatum: mitAnschrift.datum, mailId: mitAnschrift.mailId }
    if (leer(akte.anschrift)) plan.ergaenzen.push(e)
    else {
      const bekannt = funde.some((f) => f.daten.anschrift && gleicheAnschrift(f.daten.anschrift, akte.anschrift))
      if (!bekannt && !schonVorgeschlagen(bisherige, 'anschrift', wert)) plan.vorschlaege.push({ ...e, bisher: text(akte.anschrift) })
    }
  }
  return plan
}

export function hatWirkung(p: AktePlan): boolean {
  return p.ergaenzen.length > 0 || p.vorschlaege.length > 0
}

// ---------------------------------------------------------------------------------------------
// Lesen

function teile<T>(liste: T[], groesse: number): T[][] {
  const aus: T[][] = []
  for (let i = 0; i < liste.length; i += groesse) aus.push(liste.slice(i, i + groesse))
  return aus
}

/** Text einer eingegangenen Mail: das längste von Klartext, HTML und gespeichertem Ausschnitt
 *  (bei per IMAP abgeholten Mails steht der ganze Text im Ausschnitt). */
function eingangsText(z: Record<string, unknown>): string {
  const roh = (z.rohdaten && typeof z.rohdaten === 'object' ? z.rohdaten : {}) as Record<string, unknown>
  const kandidaten = [text(roh.plain), roh.html ? htmlZuText(text(roh.html)) : '', text(z.ausschnitt)]
  return kandidaten.sort((a, b) => b.length - a.length)[0]
}

function alsEingang(z: Record<string, unknown>): MailQuelle {
  return {
    id: text(z.id),
    art: 'eingang',
    absenderEmail: text(z.von).toLowerCase() || null,
    absenderName: text(z.von_name) || null,
    datum: text(z.mail_datum) || text(z.erstellt_am),
    text: eingangsText(z),
    kundeId: text(z.zugewiesener_kunde_id) || null,
    privat: !leer(z.besitzer_email),
  }
}

function alsGesendet(z: Record<string, unknown>): MailQuelle {
  return {
    id: text(z.id),
    art: 'gesendet',
    absenderEmail: text(z.von).toLowerCase() || null,
    absenderName: null,
    datum: text(z.gesendet_am),
    text: text(z.text),
    kundeId: text(z.kunde_id) || null,
    privat: !leer(z.besitzer_email),
  }
}

const EINGANG_SPALTEN = 'id, von, von_name, mail_datum, erstellt_am, ausschnitt, rohdaten, besitzer_email, zugewiesener_kunde_id'
const GESENDET_SPALTEN = 'id, von, an, text, gesendet_am, besitzer_email, kunde_id'

/** Alle Mails, die für diese Akten in Frage kommen. Wirft bei Datenbankfehlern. */
export async function ladeMails(admin: Db, akten: AkteZeile[]): Promise<MailQuelle[]> {
  const ids = akten.map((a) => a.id)
  const mails = new Map<string, MailQuelle>()
  const merke = (m: MailQuelle) => mails.set(`${m.art}:${m.id}`, m)
  const adressen = new Set(akten.flatMap((a) => adressenDerAkte(a.email)))
  // Schreibweisen der Adressen, wie sie in den Mails stehen (der Vergleich in der Datenbank achtet auf Groß/klein).
  const schreibweisen = new Set<string>()
  for (const a of akten) for (const e of text(a.email).split(/[\s,;]+/).filter((x) => x.includes('@'))) {
    schreibweisen.add(e.trim())
    schreibweisen.add(e.trim().toLowerCase())
  }

  for (const gruppe of teile(ids, 50)) {
    const { data, error } = await admin.from('eingegangene_emails').select(EINGANG_SPALTEN).in('zugewiesener_kunde_id', gruppe).order('mail_datum', { ascending: false }).limit(1000)
    if (error) throw new Error(`Mails nicht lesbar: ${error.message}`)
    for (const z of data ?? []) {
      merke(alsEingang(z))
      if (adressen.has(text(z.von).toLowerCase())) schreibweisen.add(text(z.von))
    }
    const { data: gesendet, error: gFehler } = await admin.from('gesendete_emails').select(GESENDET_SPALTEN).in('kunde_id', gruppe).order('gesendet_am', { ascending: false }).limit(500)
    if (gFehler) throw new Error(`Gesendete Mails nicht lesbar: ${gFehler.message}`)
    for (const z of gesendet ?? []) {
      merke(alsGesendet(z))
      if (adressen.has(text(z.an).toLowerCase())) schreibweisen.add(text(z.an))
    }
  }

  for (const gruppe of teile([...schreibweisen].filter(Boolean), 40)) {
    // Nicht zugeordnete Mails im gemeinsamen Postfach von der Adresse der Akte.
    const { data, error } = await admin.from('eingegangene_emails').select(EINGANG_SPALTEN).is('zugewiesener_kunde_id', null).is('besitzer_email', null).in('von', gruppe).limit(500)
    if (error) throw new Error(`Mails nicht lesbar: ${error.message}`)
    for (const z of data ?? []) merke(alsEingang(z))
    // Gesendete Mails an die Adresse ohne Akten-Zuordnung (nur gemeinsames Postfach).
    const { data: gesendet, error: gFehler } = await admin.from('gesendete_emails').select(GESENDET_SPALTEN).is('kunde_id', null).is('besitzer_email', null).in('an', gruppe).limit(500)
    if (gFehler) throw new Error(`Gesendete Mails nicht lesbar: ${gFehler.message}`)
    for (const z of gesendet ?? []) merke(alsGesendet(z))
  }
  return [...mails.values()]
}

export async function ladeEigeneDaten(admin: Db): Promise<EigeneDaten> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, telefon, signatur_html')
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  return eigeneDatenAus(data ?? [])
}

/** Alle Akten, die in Frage kommen (nicht privat, keine Sammelakte), nach id sortiert. */
export async function ladeAkten(admin: Db): Promise<AkteZeile[]> {
  const { data, error } = await alleZeilen(() => admin.from('kunden').select(AKTEN_SPALTEN).neq('bereich', 'privat'))
  if (error) throw new Error(`Akten nicht lesbar: ${error.message}`)
  return ((data ?? []) as AkteZeile[]).filter(kommtInFrage).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Pläne für die angegebenen Akten (liest nur). */
export async function planeAkten(admin: Db, akten: AkteZeile[], eigene?: EigeneDaten): Promise<AktePlan[]> {
  if (!akten.length) return []
  const [mails, eig] = await Promise.all([ladeMails(admin, akten), eigene ? Promise.resolve(eigene) : ladeEigeneDaten(admin)])
  return akten.map((a) => planeAkte(a, mails, eig))
}

// ---------------------------------------------------------------------------------------------
// Schreiben

export type Wirkung = { ergaenzt: number; vorgeschlagen: number; texte: string[] }

/** Plan anwenden: Zeile frisch lesen, nur noch leere Felder füllen, Verlauf und Vorschläge zusammenführen,
 *  nur geänderte Spalten schreiben. */
export async function wendePlanAn(admin: Db, plan: AktePlan, optionen: { jetzt?: Date; wer?: string } = {}): Promise<Wirkung> {
  const wirkung: Wirkung = { ergaenzt: 0, vorgeschlagen: 0, texte: [] }
  if (!hatWirkung(plan)) return wirkung
  const jetzt = optionen.jetzt ?? new Date()
  const heute = heuteBerlin(jetzt)
  const wer = optionen.wer ?? WER
  const { data: frisch, error } = await admin.from('kunden').select('id, bereich, telefon, anschrift, email, activities, stammdaten_vorschlaege').eq('id', plan.kundeId).maybeSingle()
  if (error) throw new Error(`Akte ${plan.kundeId} nicht lesbar: ${error.message}`)
  if (!frisch || frisch.bereich === 'privat') return wirkung

  const aenderung: Record<string, unknown> = {}
  const eintraege: { id: string; date: string; text: string; user: string }[] = []
  for (const e of plan.ergaenzen) {
    if (!leer(frisch[e.feld]) || aenderung[e.feld] !== undefined) continue
    aenderung[e.feld] = e.wert
    const t = ergaenztText(e.feld, e.wert, e.mailDatum, e.weitere)
    eintraege.push({ id: crypto.randomUUID(), date: heute, text: t, user: wer })
    wirkung.ergaenzt++
    wirkung.texte.push(t)
  }

  const liste = alsVorschlaege(frisch.stammdaten_vorschlaege)
  const neu: StammdatenVorschlag[] = []
  for (const v of plan.vorschlaege) {
    const jetzigerWert = text(frisch[v.feld])
    if (!jetzigerWert.trim()) continue // inzwischen leer: der nächste Lauf ergänzt es
    if (v.feld === 'telefon' ? nummerBekannt(jetzigerWert, v.wert) : v.feld === 'anschrift' ? gleicheAnschrift(jetzigerWert, v.wert) : jetzigerWert.toLowerCase() === v.wert.toLowerCase()) continue
    if (schonVorgeschlagen(liste, v.feld, v.wert)) continue
    neu.push({
      id: `sv_${crypto.randomUUID().slice(0, 12)}`,
      feld: v.feld,
      wert: v.wert,
      bisher: jetzigerWert,
      ...(v.weitere ? { weitere: v.weitere } : {}),
      mailDatum: v.mailDatum,
      mailId: v.mailId,
      erstellt: jetzt.toISOString(),
      status: 'offen',
    })
    wirkung.vorgeschlagen++
    wirkung.texte.push(`Vorschlag ${v.feld}: ${wertAnzeige(v.feld, v.wert)}`)
  }
  if (neu.length) aenderung.stammdaten_vorschlaege = haengeAn(liste, neu)
  if (eintraege.length) aenderung.activities = [...eintraege, ...(Array.isArray(frisch.activities) ? frisch.activities : [])]
  if (!Object.keys(aenderung).length) return { ergaenzt: 0, vorgeschlagen: 0, texte: [] }
  const { error: schreibFehler } = await admin.from('kunden').update(aenderung).eq('id', plan.kundeId)
  if (schreibFehler) throw new Error(`Akte ${plan.kundeId} nicht speicherbar: ${schreibFehler.message}`)
  return wirkung
}

// ---------------------------------------------------------------------------------------------
// Zeitplan

export type LaufErgebnis = { gelaufen: boolean; geprueft: number; ergaenzt: number; vorgeschlagen: number }

/** Vom Minuten-Zeitplan gerufen; arbeitet höchstens alle 30 Minuten und dann JE_LAUF Akten reihum.
 *  Wirft nie: Fehler stehen im Protokoll, der nächste Lauf versucht es erneut. */
export async function pruefeStammdaten(admin: Db, optionen: { jetzt?: Date; ohneTakt?: boolean; hoechstens?: number } = {}): Promise<LaufErgebnis> {
  const ergebnis: LaufErgebnis = { gelaufen: false, geprueft: 0, ergaenzt: 0, vorgeschlagen: 0 }
  try {
    const jetzt = optionen.jetzt ?? new Date()
    const jetztIso = jetzt.toISOString()
    const { data: stand, error } = await admin.from(TABELLE_STAND).select('daten, updated_at').eq('id', STAND_ID).maybeSingle()
    if (error) throw new Error(`Stand nicht lesbar: ${error.message}`)
    const daten = (stand?.daten && typeof stand.daten === 'object' ? stand.daten : {}) as { letzterLauf?: string; zeiger?: string }
    if (!optionen.ohneTakt && daten.letzterLauf) {
      const letzter = Date.parse(daten.letzterLauf)
      if (Number.isFinite(letzter) && Math.abs(jetzt.getTime() - letzter) < TAKT_MS) return ergebnis
    }
    // Lauf beanspruchen: nur wer den Stand weiterstellt, arbeitet (zwei gleichzeitige Aufrufe → einer).
    if (!stand) {
      const { error: anlegeFehler } = await admin.from(TABELLE_STAND).insert({ id: STAND_ID, art: STAND_ID, daten: { letzterLauf: jetztIso, zeiger: '' }, updated_at: jetztIso })
      if (anlegeFehler) return ergebnis // gleichzeitig angelegt: der andere Aufruf arbeitet
    } else {
      const { data: beansprucht, error: anspruchFehler } = await admin
        .from(TABELLE_STAND)
        .update({ daten: { ...daten, letzterLauf: jetztIso }, updated_at: jetztIso })
        .eq('id', STAND_ID)
        .eq('updated_at', stand.updated_at)
        .select('id')
      if (anspruchFehler) throw new Error(`Stand nicht schreibbar: ${anspruchFehler.message}`)
      if (!Array.isArray(beansprucht) || beansprucht.length === 0) return ergebnis
    }
    ergebnis.gelaufen = true

    const alle = await ladeAkten(admin)
    if (!alle.length) return ergebnis
    const zeiger = daten.zeiger ?? ''
    const ab = alle.findIndex((a) => a.id > zeiger)
    const reihe = ab < 0 ? alle : [...alle.slice(ab), ...alle.slice(0, ab)]
    const stapel = reihe.slice(0, Math.max(1, optionen.hoechstens ?? JE_LAUF))
    const plaene = await planeAkten(admin, stapel)
    for (const p of plaene) {
      ergebnis.geprueft++
      if (!hatWirkung(p)) continue
      try {
        const w = await wendePlanAn(admin, p, { jetzt })
        ergebnis.ergaenzt += w.ergaenzt
        ergebnis.vorgeschlagen += w.vorgeschlagen
      } catch (err) {
        console.error('Stammdaten ergänzen:', err instanceof Error ? err.message : err)
      }
    }
    await admin
      .from(TABELLE_STAND)
      .update({ daten: { letzterLauf: jetztIso, zeiger: stapel[stapel.length - 1].id }, updated_at: new Date(jetzt.getTime() + 1).toISOString() })
      .eq('id', STAND_ID)
  } catch (err) {
    console.error('Stammdaten aus Signaturen fehlgeschlagen:', err instanceof Error ? err.message : err)
  }
  return ergebnis
}

// ---------------------------------------------------------------------------------------------
// Einmaliger Nachtrag für alle Akten (Geschäftsführung, mit Vorschau)

export type NachtragZeile = {
  kundeId: string
  name: string
  bereich: string
  ergaenzen: { feld: StammdatenFeld; wert: string; mailDatum: string }[]
  vorschlaege: { feld: StammdatenFeld; wert: string; bisher: string; mailDatum: string }[]
}

function alsZeile(p: AktePlan): NachtragZeile {
  return {
    kundeId: p.kundeId,
    name: p.name,
    bereich: p.bereich,
    ergaenzen: p.ergaenzen.map((e) => ({ feld: e.feld, wert: wertAnzeige(e.feld, e.wert), mailDatum: e.mailDatum })),
    vorschlaege: p.vorschlaege.map((v) => ({ feld: v.feld, wert: wertAnzeige(v.feld, v.wert), bisher: wertAnzeige(v.feld, v.bisher), mailDatum: v.mailDatum })),
  }
}

/** Vorschau: was der Nachtrag täte, für alle Akten. Liest nur. */
export async function nachtragVorschau(admin: Db): Promise<{ geprueft: number; zeilen: NachtragZeile[] }> {
  const akten = await ladeAkten(admin)
  const eigene = await ladeEigeneDaten(admin)
  const plaene: AktePlan[] = []
  for (const gruppe of teile(akten, 40)) plaene.push(...(await planeAkten(admin, gruppe, eigene)))
  return { geprueft: akten.length, zeilen: plaene.filter(hatWirkung).map(alsZeile) }
}

/** Nachtrag ausführen für die gewählten Akten — rechnet auf dem Server neu (Werte aus dem Browser zählen nicht). */
export async function nachtragAusfuehren(admin: Db, kundeIds: string[], wer: string): Promise<{ ergaenzt: number; vorgeschlagen: number; akten: number; fehler: string[] }> {
  const gewuenscht = new Set(kundeIds)
  const akten = (await ladeAkten(admin)).filter((a) => gewuenscht.has(a.id))
  const eigene = await ladeEigeneDaten(admin)
  const aus = { ergaenzt: 0, vorgeschlagen: 0, akten: 0, fehler: [] as string[] }
  for (const gruppe of teile(akten, 40)) {
    for (const p of await planeAkten(admin, gruppe, eigene)) {
      if (!hatWirkung(p)) continue
      try {
        const w = await wendePlanAn(admin, p, { wer })
        if (w.ergaenzt || w.vorgeschlagen) aus.akten++
        aus.ergaenzt += w.ergaenzt
        aus.vorgeschlagen += w.vorgeschlagen
      } catch (err) {
        aus.fehler.push(`${p.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  return aus
}

/** Aktion "stammdaten_nachtrag" (email-gateway): { schritt: 'vorschau' } oder { schritt: 'ausfuehren', kundeIds: [...] }.
 *  Nur Geschäftsführung und Admins. */
export async function stammdatenNachtragAktion(
  admin: Db,
  aufrufer: { email: string; name: string; istGf: boolean },
  body: Record<string, unknown>,
): Promise<{ status: number; daten: Record<string, unknown> }> {
  if (!aufrufer.istGf) return { status: 403, daten: { error: 'Den Nachtrag der Stammdaten kann nur die Geschäftsführung starten.' } }
  if (body.schritt === 'ausfuehren') {
    const ids = Array.isArray(body.kundeIds) ? body.kundeIds.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 500) : []
    if (!ids.length) return { status: 400, daten: { error: 'Keine Akten ausgewählt.' } }
    const ergebnis = await nachtragAusfuehren(admin, ids, aufrufer.name || aufrufer.email)
    return { status: 200, daten: ergebnis }
  }
  const vorschau = await nachtragVorschau(admin)
  return { status: 200, daten: vorschau }
}
