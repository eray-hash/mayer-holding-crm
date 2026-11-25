// Termin → Akte dauerhaft zuordnen (22.11.2026). Anlass: Von rund 825 Terminen war nur einer mit einer Kundenakte
// verknüpft (termine.kunde_id). Briefing, „Wie lief's?“-Nachfrage, Wochenrückblick und die „Jetzt“-Karte der
// Gesprächs-App fanden die Akte deshalb nur selten (findeBezug rechnete sie jedes Mal neu aus, und meist ohne Erfolg).
//
// Gemeinsamer Kern für
//  - den Minutentakt (email-gateway/terminZuordnung.ts): jeden Termin einmal bewerten (bewerteTermin),
//  - die Zuordnung von Hand im CRM-Kalender (Aktion termin_zuordnen) und im Assistenten (Werkzeug termin_zuordnen,
//    telegram-gateway/terminZuordnungWerkzeug.ts): ordneVonHandZu.
//
// Regeln der Bewertung (Reihenfolge und Abgleich wie findeBezug in terminBriefingKern.ts):
//  - SICHER: Die E-Mail-Adresse eines Gastes (termine.gast, Outlook-Teilnehmer) steht bei genau EINER Akte →
//    kunde_id/kunde_bereich/kunde_name werden gesetzt (zuordnung_vorschlag.stand = 'automatisch').
//  - WAHRSCHEINLICH: Der Titel nennt genau eine Akte (voller Name, sonst eindeutiger Nachname) → nur ein Vorschlag
//    (zuordnung_vorschlag.stand = 'vorschlag'), den der Mitarbeiter im Kalender oder per Assistent bestätigt.
//    Anders als findeBezug auch bei aus Outlook übernommenen Terminen und Einladungen — als Vorschlag ist das
//    ungefährlich, und Hasans Outlook-Termine sind fast der ganze Bestand.
//  - Übersprungen: Titel mit „privat“, „persönlich“, „Urlaub“, reine Team-Termine (alle anderen
//    Beteiligten sind Mitarbeiter bzw. Adressen der Holding), abgesagte Termine, Bezug auf ein Objekt statt einer Akte.
//  - PRIVATE Termine (_shared/privatGrenze.ts istPrivaterTermin: ohne Kollegen, ohne Mayer-Akte, aus Outlook bzw.
//    Besitzer mit privatem Assistenten; 25.11.2026 nach zwei Vorfällen) bekommen NIE eine Mayer-Akte — weder sicher
//    noch als Vorschlag. Erlaubt ist nur eine PRIVATE Akte desselben Besitzers (sichtbar nur im privaten Assistenten,
//    termine_zeigen → akte_vorschlag; „Bitte bestätigen“ im Mayer-Bot zeigt sie nie).
//  - Serien (gleicher Besitzer, Titel, Wochentag und Uhrzeit; serienSchluessel): Wer bei einem Vorkommen von Hand
//    entschieden hat, entscheidet für die ganze Serie — eine abgelehnte Akte kommt für kein Vorkommen wieder, eine von
//    Hand gesetzte Akte bekommen auch neue Vorkommen (stand 'automatisch', wie 'serie').
//  - Eine Akte, die schon einmal von diesem Termin gelöst bzw. als Vorschlag abgelehnt wurde
//    (zuordnung_vorschlag.abgelehnt), kommt für diesen Termin nie wieder.
//  - Der Besitzer des Termins muss die Akte sehen dürfen (darfBezug); private Kontakte nur seine eigenen.
//
// Bewusst ohne Deno- oder Browser-Funktionen, damit es sich mit Testdoppeln prüfen lässt.

import { type BriefingPerson, type BriefingTermin, darfBezug, findeBezug, istAbgesagterTitel, kandidatenLader, type KundeKurz, normName, SAMMELAKTEN } from './terminBriefingKern.ts'
import { istPrivaterTermin, privatAssistentMerker, standardPrivatPruefer } from './privatGrenze.ts'

// deno-lint-ignore no-explicit-any
type Db = any

// ---------------------------------------------------------------------------------------------
// Typen

/** Inhalt von termine.zuordnung_vorschlag. */
export type ZuordnungVorschlag = {
  /** 'vorschlag' = wartet auf Bestätigung; 'automatisch' = vom Minutentakt gesetzt; 'hand' = von Hand gesetzt/gelöst; 'keiner' = geprüft, nichts gefunden. */
  stand?: 'vorschlag' | 'automatisch' | 'hand' | 'keiner'
  kunde_id?: string
  bereich?: string
  name?: string
  /** Woran erkannt: 'gast' (E-Mail-Adresse), 'titel' (Name im Titel) — bei 'hand' wer es war. */
  wie?: string
  am?: string
  /** Akten, die für diesen Termin nicht (mehr) in Frage kommen (gelöst oder abgelehnt). */
  abgelehnt?: string[]
}

export type ZuordnungTermin = BriefingTermin & { zuordnung_vorschlag?: ZuordnungVorschlag | null; zuordnung_geprueft_am?: string | null }

export const ZUORDNUNG_SPALTEN = 'id, titel, ort, beginn, ende, ganztags, besitzer_email, teilnehmer, kunde_id, kunde_bereich, kunde_name, quelle, gast, ms_teilnehmer, ms_id, zuordnung_vorschlag, zuordnung_geprueft_am'

export type Bewertung =
  | { art: 'sicher'; kunde: KundeKurz; name: string; wie?: 'gast' | 'serie' }
  | { art: 'vorschlag'; kunde: KundeKurz; name: string }
  | { art: 'uebersprungen'; grund: 'privat' | 'team' | 'abgesagt' | 'besitzer' }
  | { art: 'keiner' }

/** Was je Lauf nur einmal geladen wird. */
export type ZuordnungsUmgebung = {
  /** Adressen der Mitarbeiter, ihrer Postfächer und Microsoft-Konten (werden beim Gast-Abgleich übergangen). */
  team: Set<string>
  teamNamen: string[]
  /** Mitarbeiter je Adresse (für die Rechte des Besitzers). */
  personen: Map<string, BriefingPerson>
  lader: ReturnType<typeof kandidatenLader>
  /** Nutzt der Besitzer den privaten Assistenten? (Privat-Regel, je Lauf gemerkt.) */
  privatAssistent: (email: string) => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------
// Kleine Helfer

function adresse(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

/** Adressen der Holding selbst (Sammelpostfächer, Mitarbeiter-Adressen der Domain). */
const HOLDING_DOMAIN = /@amayer-holding\.(com|de)$/i

export function istTeamAdresse(a: string, team: Set<string>): boolean {
  const x = adresse(a)
  return !!x && (team.has(x) || HOLDING_DOMAIN.test(x))
}

/** Name, wie ihn auch der Kalender beim Verknüpfen speichert (Firma, sonst Ansprechpartner). */
export function akteName(k: Pick<KundeKurz, 'id' | 'firma' | 'ansprechpartner'>): string {
  return String(k.firma ?? '').trim() || String(k.ansprechpartner ?? '').trim() || k.id
}

const PRIVAT_TITEL = /(^|[^a-zäöüß])(privat|private|persönlich|urlaub)([^a-zäöüß]|$)/i

/** Privater Titel („privat“, „persönlich“, „Urlaub“) — wird nie zugeordnet. Die eigentliche Privat-Regel für Termine
 *  steht in _shared/privatGrenze.ts (istPrivaterTermin). */
export function istPrivatTitel(t: Pick<BriefingTermin, 'titel'>): boolean {
  return PRIVAT_TITEL.test(String(t.titel ?? ''))
}

/** Alle anderen Beteiligten (Kollegen, Gäste, Outlook-Teilnehmer) ohne den Besitzer. */
export function beteiligteAdressen(t: Pick<BriefingTermin, 'besitzer_email' | 'teilnehmer' | 'gast' | 'ms_teilnehmer'>): string[] {
  const besitzer = adresse(t.besitzer_email)
  const alle = new Set<string>()
  for (const p of t.teilnehmer ?? []) alle.add(adresse(p))
  for (const m of Array.isArray(t.ms_teilnehmer) ? t.ms_teilnehmer : []) alle.add(adresse(m?.email))
  alle.add(adresse(t.gast?.email))
  alle.delete('')
  alle.delete(besitzer)
  return [...alle]
}

/** Reiner Team-Termin: Es gibt andere Beteiligte, und alle gehören zur Holding. */
export function istTeamTermin(t: Pick<BriefingTermin, 'besitzer_email' | 'teilnehmer' | 'gast' | 'ms_teilnehmer'>, team: Set<string>): boolean {
  const andere = beteiligteAdressen(t)
  return andere.length > 0 && andere.every((a) => istTeamAdresse(a, team))
}

export function abgelehnteAkten(v: ZuordnungVorschlag | null | undefined): string[] {
  return Array.isArray(v?.abgelehnt) ? v!.abgelehnt!.map(String).filter(Boolean) : []
}

// ---------------------------------------------------------------------------------------------
// Serien (25.11.2026): Outlook liefert jedes Vorkommen als eigenen Termin (ms_serie = true), ohne Kennung der Serie.
// Eine Serie ist deshalb: gleicher Besitzer, gleicher Titel, gleicher Wochentag und gleiche Uhrzeit (Berliner Zeit).
// Dieselbe Regel gilt für CRM-Termine ohne ms_serie (wöchentlich gleich angelegte Termine).

const BERLIN_WOCHE = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Schlüssel der Serie eines Termins ('' ohne Titel oder Beginn). */
export function serienSchluessel(t: { besitzer_email?: string | null; titel?: string | null; beginn?: string | null; ganztags?: boolean | null }): string {
  const titel = normName(String(t.titel ?? ''))
  const beginn = new Date(String(t.beginn ?? ''))
  if (!titel || Number.isNaN(beginn.getTime())) return ''
  const wann = t.ganztags ? BERLIN_WOCHE.format(beginn).split(',')[0] + '|ganztags' : BERLIN_WOCHE.format(beginn)
  return `${adresse(t.besitzer_email)}|${titel}|${wann}`
}

type SerienZeile = { id: string; titel?: string | null; beginn: string; ganztags?: boolean | null; besitzer_email?: string | null; teilnehmer?: string[] | null; kunde_id?: string | null; zuordnung_vorschlag?: ZuordnungVorschlag | null }

/** Die anderen Vorkommen derselben Serie (seitenweise, höchstens 5000). */
export async function serienGeschwister(db: Db, t: { id: string; titel?: string | null; beginn: string; ganztags?: boolean | null; besitzer_email?: string | null }): Promise<SerienZeile[]> {
  const schl = serienSchluessel(t)
  if (!schl || !String(t.titel ?? '').trim()) return []
  const aus: SerienZeile[] = []
  for (let letzte = '', seite = 0; seite < 5; seite++) {
    let q = db.from('termine').select('id, titel, beginn, ganztags, besitzer_email, teilnehmer, kunde_id, zuordnung_vorschlag').eq('besitzer_email', adresse(t.besitzer_email)).eq('titel', String(t.titel)).order('id', { ascending: true }).limit(1000)
    if (letzte) q = q.gt('id', letzte)
    const { data, error } = await q
    if (error) throw new Error(`Serie nicht lesbar: ${error.message}`)
    const teil = (data ?? []) as SerienZeile[]
    for (const z of teil) if (String(z.id) !== String(t.id) && serienSchluessel(z) === schl) aus.push(z)
    if (teil.length < 1000) break
    letzte = String(teil[teil.length - 1].id)
  }
  return aus
}

/** Was bei anderen Vorkommen von Hand entschieden wurde: abgelehnte Akten und die zuletzt von Hand gesetzte Akte. */
export async function serienEntscheidung(db: Db, t: { id: string; titel?: string | null; beginn: string; ganztags?: boolean | null; besitzer_email?: string | null }): Promise<{ abgelehnt: string[]; kundeId: string | null }> {
  const geschwister = await serienGeschwister(db, t)
  const abgelehnt = new Set<string>()
  let kundeId: string | null = null
  let am = ''
  for (const z of geschwister) {
    for (const a of abgelehnteAkten(z.zuordnung_vorschlag)) abgelehnt.add(a)
    const v = z.zuordnung_vorschlag
    if (z.kunde_id && v?.stand === 'hand' && String(v.kunde_id ?? '') === String(z.kunde_id) && String(v.am ?? '') >= am) {
      kundeId = String(z.kunde_id)
      am = String(v.am ?? '')
    }
  }
  return { abgelehnt: [...abgelehnt], kundeId }
}

/** „Ignorieren“ für die ganze Serie: die Akte bei allen Vorkommen ohne Akte als abgelehnt eintragen; ein offener
 *  Vorschlag genau dieser Akte wird zurückgenommen. Liefert die Anzahl geänderter Vorkommen. */
async function serieAblehnen(db: Db, t: { id: string; titel?: string | null; beginn: string; ganztags?: boolean | null; besitzer_email?: string | null }, kundeId: string, wer: string, am: string): Promise<number> {
  let anzahl = 0
  for (const z of await serienGeschwister(db, t)) {
    if (z.kunde_id) continue
    const v: ZuordnungVorschlag = z.zuordnung_vorschlag && typeof z.zuordnung_vorschlag === 'object' ? { ...z.zuordnung_vorschlag } : {}
    const abgelehnt = new Set(abgelehnteAkten(v))
    const offen = v.stand === 'vorschlag' && String(v.kunde_id ?? '') === kundeId
    if (abgelehnt.has(kundeId) && !offen) continue
    abgelehnt.add(kundeId)
    const neu: ZuordnungVorschlag = offen ? { stand: 'keiner', wie: wer, am, abgelehnt: [...abgelehnt] } : { ...v, abgelehnt: [...abgelehnt] }
    const { data, error } = await db.from('termine').update({ zuordnung_vorschlag: neu }).eq('id', z.id).is('kunde_id', null).select('id')
    if (error) throw new Error(error.message)
    anzahl += Array.isArray(data) ? data.length : 0
  }
  return anzahl
}

// ---------------------------------------------------------------------------------------------
// Umgebung laden

/** Team-Adressen und Mitarbeiter (alle, auch ehemalige: deren Adressen sind trotzdem keine Kunden). */
export async function ladeZuordnungsUmgebung(db: Db, o: { privatPruefer?: (email: string) => Promise<boolean> } = {}): Promise<ZuordnungsUmgebung> {
  const { data, error } = await db.from('mitarbeiter').select('name, email, rolle, ist_admin, bereiche, aktiv')
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  const team = new Set<string>()
  const personen = new Map<string, BriefingPerson>()
  const teamNamen: string[] = []
  for (const m of (data ?? []) as { name?: string; email?: string; rolle?: string; ist_admin?: boolean; bereiche?: string[]; aktiv?: boolean }[]) {
    const email = adresse(m.email)
    if (!email) continue
    team.add(email)
    if (m.name) teamNamen.push(String(m.name))
    if (m.aktiv !== false) personen.set(email, { email, name: m.name ?? null, rolle: m.rolle ?? null, ist_admin: m.ist_admin === true, bereiche: Array.isArray(m.bereiche) ? m.bereiche : [] })
  }
  // Postfächer und verbundene Microsoft-Konten (z. B. hsueslue@… neben der Login-Adresse) — Fehler sind hier egal.
  try {
    const { data: faecher } = await db.from('postfaecher').select('adresse')
    for (const f of (faecher ?? []) as { adresse?: string }[]) if (adresse(f.adresse)) team.add(adresse(f.adresse))
  } catch { /* ohne Postfächer weiter */ }
  try {
    const { data: konten } = await db.from('ms_konten').select('ms_adresse')
    for (const k of (konten ?? []) as { ms_adresse?: string }[]) if (adresse(k.ms_adresse)) team.add(adresse(k.ms_adresse))
  } catch { /* ohne Microsoft-Konten weiter */ }
  return { team, teamNamen, personen, lader: kandidatenLader(db), privatAssistent: privatAssistentMerker(o.privatPruefer ?? standardPrivatPruefer(db)).nutzt }
}

// ---------------------------------------------------------------------------------------------
// Bewertung eines Termins

/** Wohin gehört der Termin? Schreibt nichts. */
export async function bewerteTermin(db: Db, t: ZuordnungTermin, u: ZuordnungsUmgebung): Promise<Bewertung> {
  if (istAbgesagterTitel(String(t.titel ?? ''))) return { art: 'uebersprungen', grund: 'abgesagt' }
  if (istPrivatTitel(t)) return { art: 'uebersprungen', grund: 'privat' }
  if (istTeamTermin(t, u.team)) return { art: 'uebersprungen', grund: 'team' }
  const besitzer = u.personen.get(adresse(t.besitzer_email))
  if (!besitzer) return { art: 'uebersprungen', grund: 'besitzer' }
  const besitzerAdresse = adresse(t.besitzer_email)
  const kunden = await u.lader.kunden()
  const kundeVon = (id: string) => kunden.find((k) => k.id === id) ?? null

  // Serie: Entscheidungen von Hand bei einem anderen Vorkommen gelten auch hier.
  const serie = await serienEntscheidung(db, t)
  const abgelehnt = new Set([...abgelehnteAkten(t.zuordnung_vorschlag), ...serie.abgelehnt])
  if (serie.kundeId && !abgelehnt.has(serie.kundeId)) {
    const k = kundeVon(serie.kundeId)
    if (k && !SAMMELAKTEN.includes(k.id) && (k.bereich !== 'privat' || adresse(k.verantwortlich_email) === besitzerAdresse) &&
      darfBezug(besitzer, { art: 'kunde', id: k.id, bereich: String(k.bereich ?? ''), verantwortlichEmail: k.verantwortlich_email ?? null, wie: 'titel' })) {
      return { art: 'sicher', kunde: k, name: akteName(k), wie: 'serie' }
    }
  }

  // Privater Termin: nur eine private Akte desselben Besitzers kommt in Frage (nie eine Mayer-Akte).
  const privat = istPrivaterTermin(t, { besitzerPrivatAssistent: await u.privatAssistent(besitzerAdresse) })

  // Gast-Adressen der Holding gelten wie Team-Adressen (findeBezug übergeht nur die genaue Liste).
  const team = new Set(u.team)
  for (const a of beteiligteAdressen(t)) if (istTeamAdresse(a, u.team)) team.add(a)
  // Namen der Kollegen zählen beim Titel nie: Volle Namen werden vorher aus dem Titel genommen („Hasan Süslü und Moritz
  // Beck“), und auch Vornamen gelten nicht als Nachname einer Akte (findeBezug nimmt nur den letzten Teil eines
  // Kollegen-Namens aus — sonst passte „Hasan“ auf die Akte „Zwei Ankaufsprofile an Hasan“, „Andreas“ auf
  // „Sundarp, Andreas“; beides im Trockenlauf am 22.11.2026 gesehen).
  const teamNamen = [...u.teamNamen, ...u.teamNamen.flatMap((n) => normName(n).split(' ').filter((w) => w.length >= 4))]
  const opts = { team, teamNamen, lader: u.lader }
  const titel = ohneTeamNamen(String(t.titel ?? ''), u.teamNamen)
  const erlaubt = (k: KundeKurz) =>
    !SAMMELAKTEN.includes(k.id) && !abgelehnt.has(k.id) && (k.bereich !== 'privat' || adresse(k.verantwortlich_email) === besitzerAdresse) &&
    (!privat || k.bereich === 'privat') &&
    darfBezug(besitzer, { art: 'kunde', id: k.id, bereich: String(k.bereich ?? ''), verantwortlichEmail: k.verantwortlich_email ?? null, wie: 'titel' })

  const pruefe = (b: Awaited<ReturnType<typeof findeBezug>>): KundeKurz | null => {
    if (!b || b.art !== 'kunde') return null
    const k = kundeVon(b.id)
    return k && erlaubt(k) ? k : null
  }

  const erster = await findeBezug(db, { ...t, titel, kunde_id: null }, opts)
  const k1 = pruefe(erster)
  if (k1 && erster?.art === 'kunde' && erster.wie === 'gast') return { art: 'sicher', kunde: k1, name: akteName(k1) }
  if (k1 && erster?.art === 'kunde' && erster.wie === 'titel') return { art: 'vorschlag', kunde: k1, name: akteName(k1) }
  if (erster?.art === 'objekt') return { art: 'keiner' }

  // Outlook-Termine und Einladungen: findeBezug lässt den Titel dort aus — für einen Vorschlag trotzdem prüfen.
  // (Ohne Gäste und mit „crm“ als Quelle, sonst landet es wieder beim Gast-Abgleich bzw. der Ausnahme.)
  const quelle = String(t.quelle ?? '')
  if (quelle === 'outlook' || quelle === 'einladung') {
    const zweiter = await findeBezug(db, { ...t, titel, kunde_id: null, quelle: 'crm', gast: null, ms_teilnehmer: null }, opts)
    const k2 = pruefe(zweiter)
    if (k2 && zweiter?.art === 'kunde' && zweiter.wie === 'titel') return { art: 'vorschlag', kunde: k2, name: akteName(k2) }
  }

  // Der ganze Titel ist der Name genau einer Akte (z. B. Hasans Serientermin „Caras“ → Akte „Caras“). findeBezug prüft
  // nur Namen aus mindestens zwei Wörtern; ein einzelnes Wort im Titel wäre zu unsicher, der ganze Titel nicht.
  const ganz = normName(titel)
  if (ganz.length >= 4) {
    const gleich = kunden.filter((k) => erlaubt(k) && [k.firma, k.ansprechpartner].some((n) => normName(n) === ganz))
    if (gleich.length === 1) return { art: 'vorschlag', kunde: gleich[0], name: akteName(gleich[0]) }
  }
  return { art: 'keiner' }
}

/** Titel ohne die vollen Namen der Kollegen (Groß/Klein egal). */
export function ohneTeamNamen(titel: string, teamNamen: string[]): string {
  let n = ` ${normName(titel)} `
  for (const name of teamNamen) {
    const k = normName(name)
    if (k.includes(' ')) n = n.split(` ${k} `).join(' ')
  }
  return n.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------------------------
// Zuordnung von Hand (CRM-Kalender und Assistent)

export type HandEingabe = {
  terminId: string
  /** Akte, die zugeordnet werden soll; null = bestehende Verknüpfung lösen. */
  kundeId: string | null
  /** true: den offenen Vorschlag ablehnen (ohne etwas zuzuordnen). */
  vorschlagAblehnen?: boolean
  /** Nur beim Zuordnen und nur für den Besitzer: auch seine anderen Termine mit genau diesem Titel ohne Akte
   *  (Serientermine wie „Caras“) derselben Akte zuordnen — außer denen, bei denen die Akte abgelehnt wurde. */
  gleicheTitel?: boolean
  /** Für die ganze Serie (gleicher Titel, Wochentag, Uhrzeit; serienSchluessel): Zuordnen ordnet alle Vorkommen ohne
   *  Akte derselben Akte zu, Ablehnen lehnt die Akte für alle Vorkommen ab („Bitte bestätigen“, 25.11.2026). */
  serie?: boolean
}

export type HandErgebnis =
  | { ok: true; termin: { id: string; titel: string; beginn: string; kunde_id: string | null; kunde_bereich: string | null; kunde_name: string | null; zuordnung_vorschlag: ZuordnungVorschlag | null }; text: string; weitere: number }
  | { ok: false; status: number; fehler: string }

/** Person mit Rechten (Zeile aus mitarbeiter, ggf. nurPrivat für den privaten Assistenten). */
export type HandPerson = BriefingPerson & { name?: string | null }

/**
 * Ordnet einen Termin von Hand einer Akte zu, löst die Verknüpfung oder lehnt den Vorschlag ab.
 * Dürfen: Besitzer und Teilnehmer des Termins. Die Akte muss die Person sehen dürfen; ein privater Kontakt nur an einem
 * eigenen Termin ohne Kollegen (sonst sähen die Kollegen seinen Namen). Schreibt nur die Zuordnungs-Spalten.
 */
export async function ordneVonHandZu(db: Db, p: HandPerson, e: HandEingabe, jetzt = new Date()): Promise<HandErgebnis> {
  const ich = adresse(p.email)
  if (!ich) return { ok: false, status: 401, fehler: 'Unbekannter Mitarbeiter.' }
  const id = String(e.terminId ?? '').trim()
  if (!id) return { ok: false, status: 400, fehler: 'Welcher Termin? (termin_id fehlt)' }
  const { data: zeile, error } = await db.from('termine').select('id, titel, beginn, ganztags, besitzer_email, teilnehmer, kunde_id, kunde_bereich, kunde_name, zuordnung_vorschlag').eq('id', id).maybeSingle()
  if (error) return { ok: false, status: 500, fehler: `Termin nicht lesbar: ${error.message}` }
  const t = zeile as (ZuordnungTermin & { teilnehmer?: string[] }) | null
  const besitzer = adresse(t?.besitzer_email)
  const teilnehmer = (t?.teilnehmer ?? []).map(adresse)
  if (!t || (besitzer !== ich && !teilnehmer.includes(ich))) return { ok: false, status: 404, fehler: 'Diesen Termin gibt es nicht (mehr) oder er gehört nicht zu deinem Kalender.' }
  if (p.nurPrivat === true && (besitzer !== ich || teilnehmer.length > 0)) return { ok: false, status: 403, fehler: 'Im privaten Assistenten nur eigene Termine ohne Kollegen.' }

  const vorher: ZuordnungVorschlag = t.zuordnung_vorschlag && typeof t.zuordnung_vorschlag === 'object' ? { ...t.zuordnung_vorschlag } : {}
  const abgelehnt = new Set(abgelehnteAkten(vorher))
  const am = jetzt.toISOString()
  const wer = String(p.name ?? '').trim() || ich
  let aenderung: Record<string, unknown>
  let text: string

  if (e.vorschlagAblehnen) {
    if (vorher.stand !== 'vorschlag' || !vorher.kunde_id) return { ok: false, status: 400, fehler: 'Für diesen Termin gibt es keinen offenen Vorschlag.' }
    abgelehnt.add(vorher.kunde_id)
    aenderung = { zuordnung_vorschlag: { stand: 'keiner', wie: wer, am, abgelehnt: [...abgelehnt] } satisfies ZuordnungVorschlag, zuordnung_geprueft_am: am }
    text = `Vorschlag „${vorher.name ?? vorher.kunde_id}“ für „${t.titel}“ abgelehnt.`
  } else if (!e.kundeId) {
    if (!t.kunde_id) return { ok: false, status: 400, fehler: 'Der Termin ist mit keiner Akte verknüpft.' }
    abgelehnt.add(String(t.kunde_id))
    aenderung = { kunde_id: null, kunde_bereich: null, kunde_name: null, zuordnung_vorschlag: { stand: 'hand', wie: wer, am, abgelehnt: [...abgelehnt] } satisfies ZuordnungVorschlag, zuordnung_geprueft_am: am }
    text = `Verknüpfung von „${t.titel}“ mit ${t.kunde_name ?? t.kunde_id} gelöst.`
  } else {
    const kundeId = String(e.kundeId).trim()
    const { data: k, error: kFehler } = await db.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kundeId).maybeSingle()
    if (kFehler) return { ok: false, status: 500, fehler: `Akte nicht lesbar: ${kFehler.message}` }
    if (!k || SAMMELAKTEN.includes(String(k.id))) return { ok: false, status: 404, fehler: 'Diese Akte gibt es nicht. Ermittle die kunde_id mit kunden_suchen.' }
    const bezug = { art: 'kunde' as const, id: String(k.id), bereich: String(k.bereich ?? ''), verantwortlichEmail: k.verantwortlich_email ?? null, wie: 'verknuepft' as const }
    if (!darfBezug(p, bezug)) return { ok: false, status: 403, fehler: 'Diese Akte darfst du nicht sehen — zuordnen geht deshalb nicht.' }
    if (bezug.bereich === 'privat' && (besitzer !== ich || teilnehmer.length > 0)) return { ok: false, status: 400, fehler: 'Einen privaten Kontakt kannst du nur an einen eigenen Termin ohne Kollegen hängen.' }
    abgelehnt.delete(bezug.id)
    const name = akteName(k as KundeKurz)
    aenderung = {
      kunde_id: bezug.id,
      kunde_bereich: bezug.bereich || null,
      kunde_name: name,
      zuordnung_vorschlag: { stand: 'hand', kunde_id: bezug.id, bereich: bezug.bereich, name, wie: wer, am, ...(abgelehnt.size ? { abgelehnt: [...abgelehnt] } : {}) } satisfies ZuordnungVorschlag,
      zuordnung_geprueft_am: am,
    }
    text = `„${t.titel}“ gehört jetzt zur Akte ${name} (${bezug.id}).`
  }

  const { data: neu, error: schreibFehler } = await db.from('termine').update(aenderung).eq('id', id).select('id, titel, beginn, kunde_id, kunde_bereich, kunde_name, zuordnung_vorschlag').maybeSingle()
  if (schreibFehler) return { ok: false, status: 500, fehler: `Nicht gespeichert: ${schreibFehler.message}` }
  if (!neu) return { ok: false, status: 404, fehler: 'Diesen Termin gibt es nicht mehr.' }
  let weitere = 0
  if ((e.gleicheTitel || e.serie) && neu.kunde_id && besitzer === ich) {
    const was = e.gleicheTitel ? 'mit demselben Titel' : 'derselben Serie'
    try {
      weitere = await gleicheTitelZuordnen(db, { id, titel: String(t.titel ?? ''), besitzer }, aenderung, String(neu.kunde_id), neu.kunde_bereich === 'privat', e.gleicheTitel ? '' : serienSchluessel(t))
      if (weitere > 0) text += ` Dazu ${weitere} weitere Termin${weitere === 1 ? '' : 'e'} ${was}.`
    } catch (err) {
      text += ` Die weiteren Termine ${was} ließen sich nicht zuordnen (${err instanceof Error ? err.message : err}).`
    }
  }
  if (e.serie && e.vorschlagAblehnen && vorher.kunde_id && besitzer === ich) {
    try {
      weitere = await serieAblehnen(db, t, String(vorher.kunde_id), wer, am)
      if (weitere > 0) text += ` Gilt auch für ${weitere} weitere Termin${weitere === 1 ? '' : 'e'} derselben Serie.`
    } catch (err) {
      text += ` Für die übrigen Termine der Serie ließ sich das nicht vermerken (${err instanceof Error ? err.message : err}).`
    }
  }
  return { ok: true, termin: neu, text, weitere }
}

/** Ordnet die anderen eigenen Termine mit genau diesem Titel (ohne Akte) derselben Akte zu. Liefert die Anzahl. */
async function gleicheTitelZuordnen(db: Db, t: { id: string; titel: string; besitzer: string }, aenderung: Record<string, unknown>, kundeId: string, privat: boolean, nurSerie = ''): Promise<number> {
  const ids: string[] = []
  const einzeln: { id: string; abgelehnt: string[] }[] = []
  // Seitenweise (die Datenbank liefert höchstens 1000 Zeilen je Abfrage).
  for (let letzte = '', seite = 0; seite < 20; seite++) {
    let q = db.from('termine').select('id, titel, beginn, ganztags, besitzer_email, teilnehmer, zuordnung_vorschlag').eq('besitzer_email', t.besitzer).eq('titel', t.titel).is('kunde_id', null).order('id', { ascending: true }).limit(1000)
    if (letzte) q = q.gt('id', letzte)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const teil = (data ?? []) as SerienZeile[]
    for (const z of teil) {
      if (z.id === t.id || abgelehnteAkten(z.zuordnung_vorschlag).includes(kundeId)) continue
      if (nurSerie && serienSchluessel(z) !== nurSerie) continue
      if (privat && (z.teilnehmer ?? []).length > 0) continue
      const abgelehnt = abgelehnteAkten(z.zuordnung_vorschlag)
      if (abgelehnt.length > 0) einzeln.push({ id: z.id, abgelehnt })
      else ids.push(z.id)
    }
    if (teil.length < 1000) break
    letzte = String(teil[teil.length - 1].id)
  }
  // Ohne die Liste „abgelehnt“ des ersten Termins (die gehört zu ihm); Termine mit eigener Liste behalten ihre.
  const { abgelehnt: _weg, ...vorschlag } = (aenderung.zuordnung_vorschlag ?? {}) as ZuordnungVorschlag
  let anzahl = 0
  for (const z of einzeln) {
    const { data, error } = await db.from('termine').update({ ...aenderung, zuordnung_vorschlag: { ...vorschlag, abgelehnt: z.abgelehnt } }).eq('id', z.id).is('kunde_id', null).select('id')
    if (error) throw new Error(error.message)
    anzahl += Array.isArray(data) ? data.length : 0
  }
  for (let i = 0; i < ids.length; i += 200) {
    const stueck = ids.slice(i, i + 200)
    const { data, error } = await db.from('termine').update({ ...aenderung, zuordnung_vorschlag: vorschlag }).in('id', stueck).is('kunde_id', null).select('id')
    if (error) throw new Error(error.message)
    anzahl += Array.isArray(data) ? data.length : 0
  }
  return anzahl
}

/** Kurzer Text zu einem offenen Vorschlag (für den Assistenten) — nur wenn die Person die Akte sehen darf. */
export function vorschlagSichtbar(p: BriefingPerson, t: Pick<ZuordnungTermin, 'besitzer_email' | 'kunde_id' | 'zuordnung_vorschlag'>): ZuordnungVorschlag | null {
  const v = t.zuordnung_vorschlag
  if (t.kunde_id || !v || v.stand !== 'vorschlag' || !v.kunde_id) return null
  // Private Kontakte schlägt die Bewertung nur dem Besitzer des Termins vor (es ist sein eigener Kontakt).
  if (v.bereich === 'privat') return adresse(p.email) === adresse(t.besitzer_email) ? v : null
  return darfBezug(p, { art: 'kunde', id: v.kunde_id, bereich: String(v.bereich ?? ''), verantwortlichEmail: null, wie: 'titel' }) ? v : null
}

