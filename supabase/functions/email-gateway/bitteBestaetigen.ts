// „Bitte bestätigen“ per Telegram-Knopf (Runde 6, 23.11.2026) — der tägliche Versand. Vom Minutentakt
// (Aktion termin_erinnerungen in index.ts) gerufen, ohne KI.
//
// Warum: Das Team arbeitet fast nur über Telegram. Vorschläge, die nur im Browser bestätigt werden, blieben liegen
// (Nutzungsauswertung 23.11.2026: 88 Termin→Akte-Vorschläge bei Hasan, 41 Mail→Akte-Vorschläge aus Quirins
// persönlichem Postfach, Kundenmails und Dateien ohne Akte).
//
// Ablauf:
//  - Werktags (Mo–Fr) beim ersten Takt ab 8:20 Uhr Berliner Zeit (nach der Morgen-Übersicht), bis 11:00. Ein verpasster
//    Morgen wird nicht nachgeholt.
//  - Nur bei eingeschaltetem Schalter (telegram_vorschlaege, Zeile 'einstellung', zuordnung_an) und nur an die
//    eingetragenen Empfänger (_shared/bestaetigenKern.ts). Standard: AUS, Empfänger nur Eray.
//  - Je Person höchstens einmal am Tag (Sperrzeile 'lauf|<adresse>|<datum>' VOR dem Senden) und höchstens 5 Vorschläge,
//    reihum aus den Quellen:
//      termin       Termin→Akte-Vorschläge seiner eigenen Termine (termine.zuordnung_vorschlag, terminZuordnung.ts) —
//                   nur wenn er die Akte sehen darf (vorschlagSichtbar). NIE private Termine (_shared/privatGrenze.ts)
//                   und nie Vorschläge auf private Akten (die sieht er nur im privaten Assistenten) — 25.11.2026 nach
//                   zwei Vorfällen. Je Serie (serienSchluessel) höchstens ein Vorschlag, und eine Serie, zu der in den
//                   letzten 14 Tagen schon gefragt wurde, kommt nicht wieder (auch nicht mit dem nächsten Vorkommen).
//      mail_privat  Vorschläge in seinem persönlichen Postfach (privatPostZuordnung.ts, Status 'privat_offen') — der
//                   erste Kandidat, den er als Ziel wählen darf (darfZiel wie das Werkzeug meine_post_vorschlaege).
//                   Nicht für Nutzer des privaten Assistenten (deren persönliche Post ist privat, istPrivateMail;
//                   dort gibt es meine_post_vorschlaege) und nie mit einer privaten Akte als Ziel.
//      mail         Vorschläge im gemeinsamen Postfach (mailZuordnung.ts, Status 'offen') — an den Verantwortlichen
//                   der vermuteten Akte, wenn er sie sehen darf.
//      eingang      Dateien in „Ungeklärte Eingänge“ mit genau einem eindeutigen Vorschlag (gleiche Bewertung wie die
//                   Seite, _shared/eingangVorschlagKern.ts) — an den, der die Datei geschickt hat, sonst an den
//                   Verantwortlichen des Ziels; nur wenn er das Ziel sehen darf. Private Kontakte/Objekte nie.
//  - Was in den letzten 14 Tagen schon gefragt wurde (egal mit welchem Ausgang), kommt nicht wieder.
//  - Je Vorschlag eine Nachricht mit Knöpfen; die Entscheidung führt telegram-gateway/bitteBestaetigenWerkzeug.ts aus.
//  - Wirft nie: Fehler stehen im Ergebnis.
//
// trockenlauf: nichts schreiben, nichts senden — nur die Texte zurückgeben, die eine Person bekäme (Aktion
// bitte_bestaetigen_test, nur mit Dienst-Schlüssel; zur Freigabe der Texte).

import {
  EINSTELLUNG_ID,
  type Einstellung,
  istEmpfaenger,
  leseEinstellung,
  neueKennung,
  TABELLE,
  type VorschlagArt,
  zufall,
  type ZuordnungDaten,
  zuordnungKnoepfe,
  zuordnungText,
} from '../_shared/bestaetigenKern.ts'
import { serienSchluessel, vorschlagSichtbar, type ZuordnungVorschlag } from '../_shared/terminZuordnungKern.ts'
import { istPrivateAkte, istPrivaterTermin, privatAssistentMerker, standardPrivatPruefer } from '../_shared/privatGrenze.ts'
import { type EingangKandidat, haeufigkeitAus, type Merkmale, merkmaleAus, ordnerFuer, vorschlaegeFuer, woerter } from '../_shared/eingangVorschlagKern.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { darfAkte, darfObjekt, darfPostfachBereich, type RechteMitarbeiter, SAMMELAKTEN } from '../telegram-gateway/rechte.ts'
import { darfZiel } from '../telegram-gateway/privatPostWerkzeug.ts'
import { inhaltSchluessel } from './akteZuObjekt.ts'
import { berlinZeit } from './tagesmeldung.ts'
import { protokolliereNachricht } from '../_shared/nachrichtenProtokoll.ts'

// deno-lint-ignore no-explicit-any
type Db = any

/** Telegram-Aufruf (sendMessage …). Liefert das Ergebnis (bei sendMessage die Nachricht) oder null. */
export type TelegramApi = (methode: string, daten: Record<string, unknown>) => Promise<Record<string, unknown> | null>

export type Person = RechteMitarbeiter & { name: string; email: string; telegram_chat_id?: number | string | null; ist_superuser?: boolean | null; aktiv?: boolean | null }

export type Kandidat = { art: Exclude<VorschlagArt, 'status'>; bezugId: string; kundeId: string; daten: ZuordnungDaten }

export type BestaetigenErgebnis = {
  personen: number
  gesendet: number
  fehler: string[]
  /** Nur im Trockenlauf: die Texte, die die Person bekäme. */
  vorschau?: { art: string; text: string; knoepfe: string[] }[]
}

export const HOECHSTENS_JE_PERSON = 5
const SCHON_GEFRAGT_TAGE = 14
const RUECKBLICK_TAGE = 30
const TAG_MS = 86_400_000
const AB_MINUTE = 8 * 60 + 20
const BIS_MINUTE = 11 * 60
const AKTE_UNGEKLAERT = 'k_eingang_ungeklaert'
const AKTE_INTERN = 'k_intern_holding'

/** Standard-Versand über den Mayer-Bot (TELEGRAM_BOT_TOKEN). Mit `art` (Kennung aus dem Katalog der automatischen
 *  Nachrichten) wird jede sendMessage in nachrichten_protokoll aufgezeichnet; `ohneInhalt` = ohne den Text (Inhalte
 *  nur für Superuser). */
export const telegramMayerBot = async (methode: string, daten: Record<string, unknown>, art?: string, ohneInhalt = false): Promise<Record<string, unknown> | null> => {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!token) {
    console.log(`[Telegram ${methode}] ${String(daten.text ?? '').slice(0, 200)}`)
    return null
  }
  let ergebnis: Record<string, unknown> | null = null
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${methode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) })
    const j = await r.json().catch(() => null)
    if (!r.ok) console.error(`Telegram ${methode} fehlgeschlagen`, r.status, j?.description)
    ergebnis = j?.result ?? null
  } catch (err) {
    console.error(`Telegram ${methode} fehlgeschlagen`, err)
  }
  if (art && methode === 'sendMessage') await protokolliereNachricht({ art, kanal: 'telegram', an_chat: daten.chat_id as string | number | null, text: ohneInhalt ? '(Inhalt nur für Superuser — nicht aufgezeichnet)' : String(daten.text ?? ''), status: ergebnis ? 'gesendet' : 'fehler' })
  return ergebnis
}

export function imFenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  if (b.wochentag < 1 || b.wochentag > 5) return false
  const min = b.stunde * 60 + b.minute
  return min >= AB_MINUTE && min < BIS_MINUTE
}

function adresse(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

type KundeZeile = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich: string | null; verantwortlich_email: string | null }
type ObjektZeile = { id: string; bezeichnung: string | null; adresse: string | null; verantwortlich: string | null; privat_besitzer: string | null }

function akteName(k: Pick<KundeZeile, 'id' | 'firma' | 'ansprechpartner'>): string {
  return String(k.firma ?? '').trim() || String(k.ansprechpartner ?? '').trim() || k.id
}

/** Was je Lauf nur einmal geladen wird. */
export type Umgebung = {
  team: Person[]
  kunden: Map<string, KundeZeile>
  objekte: Map<string, ObjektZeile>
  /** Schon gefragt (art|bezug), egal an wen. */
  schonGefragt: Set<string>
  jetzt: Date
  /** Nutzt die Person den privaten Assistenten? (Vorgabe: privatBotAktiv, je Lauf gemerkt.) */
  privatAssistent?: (email: string) => Promise<boolean>
}

/** Verantwortlicher einer Akte oder eines Objekts (Adresse, sonst über den Namen). */
function verantwortlicher(team: Person[], email: string | null | undefined, name: string | null | undefined): Person | null {
  const a = adresse(email)
  if (a) return team.find((m) => adresse(m.email) === a) ?? null
  const n = String(name ?? '').trim().toLowerCase()
  return n ? team.find((m) => String(m.name ?? '').trim().toLowerCase() === n) ?? null : null
}

// ---------------------------------------------------------------------------------------------
// Quellen

/** Termin→Akte-Vorschläge der eigenen Termine: kommende zuerst (nächste zuerst), dann die letzten 30 Tage. */
export async function terminKandidaten(admin: Db, p: Person, u: Umgebung): Promise<Kandidat[]> {
  const seit = new Date(u.jetzt.getTime() - RUECKBLICK_TAGE * TAG_MS).toISOString()
  const privatAssistent = await (u.privatAssistent ?? standardPrivatPruefer(admin))(adresse(p.email)).catch(() => false)
  const { data, error } = await admin
    .from('termine')
    .select('id, titel, beginn, ganztags, besitzer_email, teilnehmer, kunde_id, kunde_bereich, ms_id, zuordnung_vorschlag')
    .eq('besitzer_email', adresse(p.email))
    .is('kunde_id', null)
    .gte('beginn', seit)
    .order('beginn', { ascending: true })
    .limit(1000)
  if (error) throw new Error(`Termine nicht lesbar: ${error.message}`)
  const jetztIso = u.jetzt.toISOString()
  type Zeile = { id: string; titel: string | null; beginn: string; ganztags: boolean | null; besitzer_email: string; teilnehmer: string[] | null; kunde_id: string | null; kunde_bereich: string | null; ms_id: string | null; zuordnung_vorschlag: ZuordnungVorschlag | null }
  // Privat bleibt privat: private Termine nie im Mayer-Bot (Regel _shared/privatGrenze.ts).
  const zeilen = ((data ?? []) as Zeile[]).filter((t) => !istPrivaterTermin(t, { besitzerPrivatAssistent: privatAssistent }))
  const kommend = zeilen.filter((t) => t.beginn >= jetztIso)
  const vorbei = zeilen.filter((t) => t.beginn < jetztIso).reverse()

  // Serien: schon gefragte Serien (anderes Vorkommen in den letzten 14 Tagen) und je Serie nur ein Vorschlag.
  const gefragteIds = [...u.schonGefragt].filter((x) => x.startsWith('termin|')).map((x) => x.slice('termin|'.length))
  const serienGefragt = new Set<string>()
  for (let i = 0; i < gefragteIds.length; i += 200) {
    const { data: gefragt } = await admin.from('termine').select('id, titel, beginn, ganztags, besitzer_email').in('id', gefragteIds.slice(i, i + 200))
    for (const g of (gefragt ?? []) as Zeile[]) if (serienSchluessel(g)) serienGefragt.add(serienSchluessel(g))
  }
  const aus: Kandidat[] = []
  for (const t of [...kommend, ...vorbei]) {
    const v = vorschlagSichtbar(p, t)
    if (!v?.kunde_id || v.bereich === 'privat') continue
    const k = u.kunden.get(v.kunde_id)
    if (!k || SAMMELAKTEN.includes(k.id) || istPrivateAkte(k) || !darfAkte(p, k)) continue
    const serie = serienSchluessel(t)
    if (serie) {
      if (serienGefragt.has(serie)) continue
      serienGefragt.add(serie)
    }
    aus.push({
      art: 'termin',
      bezugId: t.id,
      kundeId: k.id,
      daten: { titel: String(t.titel ?? ''), wann: t.beginn, ganztags: t.ganztags === true, ziel: { art: 'kunde', id: k.id, name: akteName(k), bereich: k.bereich ?? '' }, grund: 'Der Name der Akte steht im Titel des Termins.' },
    })
  }
  return aus
}

type MailZeile = {
  id: string
  message_id: string | null
  von: string | null
  von_name: string | null
  betreff: string | null
  mail_datum: string | null
  ignoriert: boolean | null
  zugewiesener_kunde_id: string | null
  zuordnung_vorschlag: { art?: string; status?: string; kandidaten?: { kundeId: string; bereich?: string; name?: string; grund?: string; sicher?: boolean }[] } | null
  /** Bereichspostfach (z. B. immo@… → 'immobilien'): Vorschlag nur an Empfänger mit diesem Bereich. */
  postfach_bereich?: string | null
}

const MAIL_SPALTEN = 'id, message_id, von, von_name, betreff, mail_datum, ignoriert, zugewiesener_kunde_id, zuordnung_vorschlag, postfach_bereich'

function absender(m: MailZeile): string {
  const name = String(m.von_name ?? '').trim()
  const von = String(m.von ?? '').trim()
  return name && von && name.toLowerCase() !== von.toLowerCase() ? `${name} <${von}>` : name || von
}

/** Vorschläge im eigenen persönlichen Postfach (neueste zuerst). */
export async function privatMailKandidaten(admin: Db, p: Person, u: Umgebung): Promise<Kandidat[]> {
  const seit = new Date(u.jetzt.getTime() - RUECKBLICK_TAGE * TAG_MS).toISOString()
  const { data, error } = await admin
    .from('eingegangene_emails')
    .select(MAIL_SPALTEN)
    .eq('besitzer_email', adresse(p.email))
    .is('zugewiesener_kunde_id', null)
    .gte('erstellt_am', seit)
    .order('mail_datum', { ascending: false })
    .limit(1000)
  if (error) throw new Error(`Persönliches Postfach nicht lesbar: ${error.message}`)
  const aus: Kandidat[] = []
  for (const m of (data ?? []) as MailZeile[]) {
    const v = m.zuordnung_vorschlag
    if (m.ignoriert || v?.art !== 'privat' || v.status !== 'privat_offen') continue
    for (const k of v.kandidaten ?? []) {
      const akte = u.kunden.get(String(k.kundeId))
      if (!akte || istPrivateAkte(akte) || !darfZiel(p, akte)) continue
      aus.push({
        art: 'mail_privat',
        bezugId: m.id,
        kundeId: akte.id,
        daten: {
          titel: String(m.betreff ?? ''),
          wann: m.mail_datum,
          von: absender(m),
          ziel: { art: 'kunde', id: akte.id, name: akteName(akte), bereich: akte.bereich ?? '' },
          grund: `${String(k.grund ?? 'Vom CRM vermutet.').replace(/\.?$/, '.')}${k.sicher ? ' Sehr wahrscheinlich.' : ''}`,
          uebergabe: akte.bereich !== 'privat',
        },
      })
      break
    }
  }
  return aus
}

/** Vorschläge im gemeinsamen Postfach → je Empfänger (Verantwortlicher der vermuteten Akte). */
export async function gemeinsameMailKandidaten(admin: Db, team: Person[], kunden: Map<string, KundeZeile>, jetzt: Date): Promise<Map<string, Kandidat[]>> {
  const seit = new Date(jetzt.getTime() - RUECKBLICK_TAGE * TAG_MS).toISOString()
  const { data: zeilen, error } = await alleZeilen(() =>
    admin.from('eingegangene_emails').select(MAIL_SPALTEN).is('besitzer_email', null).is('zugewiesener_kunde_id', null).gte('erstellt_am', seit), { ordnung: ['mail_datum', 'id'], aufsteigend: false, hoechstens: 3000 })
  if (error) throw new Error(error.message)
  const je = new Map<string, Kandidat[]>()
  for (const m of (zeilen ?? []) as MailZeile[]) {
    const v = m.zuordnung_vorschlag
    if (m.ignoriert || !v || v.art === 'privat' || v.status !== 'offen') continue
    const k = (v.kandidaten ?? [])[0]
    const akte = k ? kunden.get(String(k.kundeId)) : undefined
    if (!akte || akte.bereich === 'privat' || SAMMELAKTEN.includes(akte.id)) continue
    const p = verantwortlicher(team, akte.verantwortlich_email, akte.verantwortlich)
    if (!p || !darfAkte(p, akte) || !darfPostfachBereich(p, m.postfach_bereich)) continue
    const liste = je.get(adresse(p.email)) ?? []
    liste.push({
      art: 'mail',
      bezugId: m.id,
      kundeId: akte.id,
      daten: { titel: String(m.betreff ?? ''), wann: m.mail_datum, von: absender(m), ziel: { art: 'kunde', id: akte.id, name: akteName(akte), bereich: akte.bereich ?? '' }, grund: String(k.grund ?? 'Vom CRM vermutet.') },
    })
    je.set(adresse(p.email), liste)
  }
  return je
}

type Dokument = { id: string; name?: string; typ?: string; datum?: string; url?: string }

/** Dateien in „Ungeklärte Eingänge“ mit genau einem Vorschlag → je Empfänger. */
export async function eingangKandidaten(admin: Db, team: Person[], kunden: Map<string, KundeZeile>, objekte: Map<string, ObjektZeile>): Promise<Map<string, Kandidat[]>> {
  const je = new Map<string, Kandidat[]>()
  const { data: sammel, error } = await admin.from('kunden').select('id, dokumente, activities').eq('id', AKTE_UNGEKLAERT).maybeSingle()
  if (error) throw new Error(`Ungeklärte Eingänge nicht lesbar: ${error.message}`)
  const dokumente = (Array.isArray(sammel?.dokumente) ? sammel.dokumente : []) as Dokument[]
  if (dokumente.length === 0) return je
  const activities = (Array.isArray(sammel?.activities) ? sammel.activities : []) as { text?: string; user?: string }[]

  // Merkmale wie die Seite: Kunden aller Bereiche ohne private Kontakte und Sammelakten, Objekte ohne private.
  const intern = kunden.get(AKTE_INTERN)
  const sperre = new Set(woerter(`${intern ? `${intern.firma ?? ''} ${intern.ansprechpartner ?? ''}` : ''} ${team.map((m) => m.name).join(' ')}`))
  const merkmale: Merkmale[] = []
  for (const k of kunden.values()) {
    if (k.bereich === 'privat' || SAMMELAKTEN.includes(k.id)) continue
    merkmale.push(merkmaleAus({ art: 'kunde', id: k.id, bereich: k.bereich ?? '', name: akteName(k) }, k.firma ?? '', k.ansprechpartner ?? '', sperre))
  }
  for (const o of objekte.values()) {
    if (o.privat_besitzer) continue
    merkmale.push(merkmaleAus({ art: 'objekt', id: o.id, name: String(o.bezeichnung ?? '').trim() || 'Objekt ohne Bezeichnung' }, `${o.bezeichnung ?? ''} ${o.adresse ?? ''}`, '', sperre))
  }
  const haeufigkeit = haeufigkeitAus(merkmale)

  // Kurzfassungen, die der Server schon kennt (kein neues Lesen).
  const kurz = new Map<string, string>()
  const schluessel = [...new Set(dokumente.map((d) => (d.url ? inhaltSchluessel(d.url) : '')).filter(Boolean))]
  for (let i = 0; i < schluessel.length; i += 100) {
    const { data } = await admin.from('dokument_inhalte').select('schluessel, zusammenfassung, status').in('schluessel', schluessel.slice(i, i + 100))
    for (const r of (data ?? []) as { schluessel: string; zusammenfassung: string | null }[]) if (r.zusammenfassung) kurz.set(r.schluessel, r.zusammenfassung)
  }

  for (const d of dokumente) {
    if (!d?.id || !d.name) continue
    const treffer = vorschlaegeFuer(d.name, d.url ? kurz.get(inhaltSchluessel(d.url)) ?? '' : '', merkmale, haeufigkeit)
    if (treffer.length !== 1) continue
    const ziel = treffer[0] as EingangKandidat
    // Wer hat sie geschickt? (Verlaufszeile der Sammelakte mit dem Dateinamen.) Sonst der Verantwortliche des Ziels.
    const zeile = activities.find((a) => typeof a?.text === 'string' && a.text.includes(d.name!))
    const schicker = zeile?.user ? team.find((m) => m.name === String(zeile.user).trim()) ?? null : null
    let p: Person | null = schicker
    if (ziel.art === 'kunde') {
      const k = kunden.get(ziel.id)!
      if (!p || !darfAkte(p, k)) p = verantwortlicher(team, k.verantwortlich_email, k.verantwortlich)
      if (!p || !darfAkte(p, k)) continue
    } else {
      const o = objekte.get(ziel.id)!
      if (!p || !darfObjekt(p, o)) p = verantwortlicher(team, null, o.verantwortlich)
      if (!p || !darfObjekt(p, o)) continue
    }
    const liste = je.get(adresse(p.email)) ?? []
    liste.push({
      art: 'eingang',
      bezugId: d.id,
      kundeId: ziel.id,
      daten: {
        titel: d.name,
        wann: d.datum ?? null,
        ziel: ziel.art === 'kunde' ? { art: 'kunde', id: ziel.id, name: ziel.name, bereich: ziel.bereich } : { art: 'objekt', id: ziel.id, name: ziel.name, ordner: ordnerFuer(d) },
        grund: 'Der Name passt zum Dateinamen bzw. zur Kurzfassung der Datei.',
      },
    })
    je.set(adresse(p.email), liste)
  }
  return je
}

/** Reihum aus den Quellen (je eine, dann die nächste), ohne schon Gefragtes, höchstens n. */
export function reihum(quellen: Kandidat[][], schonGefragt: Set<string>, n: number): Kandidat[] {
  const aus: Kandidat[] = []
  const zeiger = quellen.map(() => 0)
  const gesehen = new Set<string>()
  while (aus.length < n) {
    let weiter = false
    for (let q = 0; q < quellen.length && aus.length < n; q++) {
      while (zeiger[q] < quellen[q].length) {
        const k = quellen[q][zeiger[q]++]
        const schluessel = `${k.art}|${k.bezugId}`
        if (schonGefragt.has(schluessel) || gesehen.has(schluessel)) continue
        gesehen.add(schluessel)
        aus.push(k)
        weiter = true
        break
      }
    }
    if (!weiter) break
  }
  return aus
}

// ---------------------------------------------------------------------------------------------
// Der Lauf

export async function ladeEinstellung(admin: Db): Promise<Einstellung> {
  const { data } = await admin.from(TABELLE).select('daten').eq('id', EINSTELLUNG_ID).maybeSingle()
  return leseEinstellung(data?.daten)
}

async function ladeUmgebung(admin: Db, jetzt: Date): Promise<Umgebung> {
  const { data: team, error } = await admin.from('mitarbeiter').select('name, email, rolle, ist_admin, bereiche, aktiv, telegram_chat_id, ist_superuser').eq('aktiv', true)
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  const personen = ((team ?? []) as Person[]).filter((m) => m.email && m.name).map((m) => ({ ...m, email: adresse(m.email) }))
  const { data: kundenRoh } = await alleZeilen(() => admin.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich, verantwortlich_email'))
  const kunden = new Map(((kundenRoh ?? []) as KundeZeile[]).map((k) => [k.id, k]))
  const { data: objekteRoh } = await alleZeilen(() => admin.from('objekte').select('id, bezeichnung, adresse, verantwortlich, privat_besitzer'))
  const objekte = new Map(((objekteRoh ?? []) as ObjektZeile[]).map((o) => [o.id, o]))
  const seit = new Date(jetzt.getTime() - SCHON_GEFRAGT_TAGE * TAG_MS).toISOString()
  const { data: gefragt } = await alleZeilen(() => admin.from(TABELLE).select('art, bezug_id').neq('art', 'lauf').gte('erstellt_am', seit))
  const schonGefragt = new Set(((gefragt ?? []) as { art: string; bezug_id: string }[]).map((z) => `${z.art}|${z.bezug_id}`))
  return { team: personen, kunden, objekte, schonGefragt, jetzt, privatAssistent: privatAssistentMerker(standardPrivatPruefer(admin)).nutzt }
}

/** Kandidaten einer Person (höchstens n). Fehler einzelner Quellen landen in `fehler`, die übrigen zählen weiter. */
export async function kandidatenFuer(admin: Db, p: Person, u: Umgebung, mailJe: Map<string, Kandidat[]>, eingangJe: Map<string, Kandidat[]>, fehler: string[], n = HOECHSTENS_JE_PERSON): Promise<Kandidat[]> {
  const sicher = async (f: () => Promise<Kandidat[]>, was: string) => {
    try {
      return await f()
    } catch (err) {
      fehler.push(`${p.name}, ${was}: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }
  const termine = await sicher(() => terminKandidaten(admin, p, u), 'Termine')
  // Persönliche Post von Nutzern des privaten Assistenten ist privat (istPrivateMail) — nie im Mayer-Bot.
  const mitPrivatAssistent = await (u.privatAssistent ?? standardPrivatPruefer(admin))(adresse(p.email)).catch(() => false)
  const privat = mitPrivatAssistent ? [] : await sicher(() => privatMailKandidaten(admin, p, u), 'persönliches Postfach')
  return reihum([termine, privat, mailJe.get(adresse(p.email)) ?? [], eingangJe.get(adresse(p.email)) ?? []], u.schonGefragt, n)
}

export async function sendeBitteBestaetigen(admin: Db, o: { telegram?: TelegramApi; jetzt?: Date; trockenFuer?: string } = {}): Promise<BestaetigenErgebnis> {
  const ergebnis: BestaetigenErgebnis = { personen: 0, gesendet: 0, fehler: [] }
  const jetzt = o.jetzt ?? new Date()
  const telegram = o.telegram ?? telegramMayerBot
  const trocken = adresse(o.trockenFuer)
  try {
    if (!trocken && !imFenster(jetzt)) return ergebnis
    const einstellung = await ladeEinstellung(admin)
    if (!trocken && !einstellung.zuordnungAn) return ergebnis
    const u = await ladeUmgebung(admin, jetzt)
    const empfaenger = trocken ? u.team.filter((m) => m.email === trocken) : u.team.filter((m) => m.telegram_chat_id && istEmpfaenger(einstellung, m))
    if (empfaenger.length === 0) return ergebnis
    const datum = berlinZeit(jetzt).datum

    // Gemeinsame Quellen nur einmal je Lauf.
    let mailJe = new Map<string, Kandidat[]>()
    let eingangJe = new Map<string, Kandidat[]>()
    try {
      mailJe = await gemeinsameMailKandidaten(admin, u.team, u.kunden, jetzt)
    } catch (err) {
      ergebnis.fehler.push(`Gemeinsames Postfach: ${err instanceof Error ? err.message : String(err)}`)
    }
    try {
      eingangJe = await eingangKandidaten(admin, u.team, u.kunden, u.objekte)
    } catch (err) {
      ergebnis.fehler.push(`Ungeklärte Eingänge: ${err instanceof Error ? err.message : String(err)}`)
    }

    for (const p of empfaenger) {
      if (!trocken) {
        // Sperre VOR dem Senden: zwei gleichzeitige Takte senden nie doppelt; ein Fehler beim Senden wird nicht wiederholt.
        const { error: sperre } = await admin.from(TABELLE).insert({ id: `lauf|${p.email}|${datum}`, empfaenger_email: p.email, art: 'lauf', bezug_id: datum, code: '-', status: 'erledigt', daten: {} })
        if (sperre) {
          if (sperre.code !== '23505') ergebnis.fehler.push(`${p.name}: Sperre nicht gesetzt (${sperre.message}) — nichts gesendet.`)
          continue
        }
      }
      const liste = await kandidatenFuer(admin, p, u, mailJe, eingangJe, ergebnis.fehler)
      if (liste.length === 0) continue
      ergebnis.personen++
      if (trocken) {
        ergebnis.vorschau = liste.map((k, i) => ({
          art: k.art,
          text: zuordnungText(k.art, k.daten, i + 1, liste.length),
          knoepfe: zuordnungKnoepfe('tv_vorschau', 'vorschau', k.daten.ziel.name).flat().map((x) => x.text),
        }))
        continue
      }
      for (const [i, k] of liste.entries()) {
        const id = neueKennung()
        const code = zufall(9)
        const { error: anlegeFehler } = await admin.from(TABELLE).insert({ id, empfaenger_email: p.email, art: k.art, bezug_id: k.bezugId, kunde_id: k.kundeId, daten: k.daten, code, status: 'offen' })
        if (anlegeFehler) {
          ergebnis.fehler.push(`${p.name}: Vorschlag nicht gespeichert (${anlegeFehler.message}).`)
          continue
        }
        u.schonGefragt.add(`${k.art}|${k.bezugId}`)
        const nachricht = await telegram('sendMessage', {
          chat_id: p.telegram_chat_id,
          text: zuordnungText(k.art, k.daten, i + 1, liste.length),
          reply_markup: { inline_keyboard: zuordnungKnoepfe(id, code, k.daten.ziel.name) },
        })
        if (nachricht?.message_id) {
          ergebnis.gesendet++
          await admin.from(TABELLE).update({ telegram_nachricht: { chat: p.telegram_chat_id, id: nachricht.message_id } }).eq('id', id)
        } else {
          ergebnis.fehler.push(`${p.name}: Nachricht nicht zugestellt.`)
          await admin.from(TABELLE).update({ status: 'fehler', ergebnis: 'Nachricht nicht zugestellt', erledigt_am: jetzt.toISOString() }).eq('id', id)
        }
      }
    }
  } catch (err) {
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  if (ergebnis.fehler.length > 0) console.error('Bitte bestätigen:', ergebnis.fehler.slice(0, 5).join(' | '))
  return ergebnis
}
