// Personen-Akte auf Zuruf (Wunsch von Hasan, 23.11.2026): „Was läuft mit Herrn Muster?“, „Was habe ich an
// Herrn X geschickt?“ — eine kompakte, VOLLSTÄNDIGE Übersicht zu einer Person für den privaten Assistenten.
//
// Anlass: Am 23.11.2026 kamen auf so eine Frage nur 11 von 68 Mails, weil die Hotmail-Suche nach 30 Treffern
// abschnitt. Deshalb:
// - Hotmail: erst nach dem Namen suchen, daraus alle E-Mail-Adressen der Person sammeln, dann je Adresse erneut
//   suchen (bis 250 Treffer je Suche), alles nach Mail-Kennung zusammenführen. Meldet eine Suche `mehr`, steht
//   das ausdrücklich im Ergebnis.
// - Dazu aus dem CRM: eigene private Kontakte (Adressen, Notizen), eigene Termine ohne Kollegen, eigene To-dos,
//   Gesprächsprotokolle der eigenen privaten Kontakte, aus dem CRM gesendete und im eigenen Postfach
//   eingegangene Mails.
// - Der Assistent arbeitet mit Dienstrechten: JEDE Abfrage trägt die Besitzer-Bedingung (eigene Adresse bzw.
//   eigene private Kontakte), und jede Zeile wird danach im Code noch einmal geprüft.
// - Supabase liefert höchstens 1000 Zeilen je Abfrage — gelesen wird deshalb über alleZeilen.
// - Am Ende steht immer „Vollständig: ja“ oder „Vollständig: nein, weil …“.
// - Mehrdeutige Namen (mehrere Personen): kurze Liste, der Assistent fragt nach.
//
// Lesend — es wird nichts geschrieben und nichts verschickt.

import { alleZeilen } from '../_shared/alleZeilen.ts'
import { aktuellePerson, setzePrivat } from '../_shared/kiVerbrauch.ts'
import { privatFaehigkeiten } from './outlookWerkzeuge.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

/** Antwort einer Hotmail-Aktion des email-gateway. */
export type HotmailAntwort = { ok: boolean; status: number; daten: Record<string, unknown> }
/** Ruft eine Hotmail-Aktion des email-gateway auf (für Tests einsetzbar). */
export type HotmailAufruf = (body: Record<string, unknown>) => Promise<HotmailAntwort>

export type PersonKontext = {
  supabase: Supa
  mitarbeiter: { email?: string | null; name?: string | null }
  protokolliere: (text: string) => void
  /** Hotmail-Aktionen; ohne Angabe über das email-gateway mit dem eigenen Login. */
  hotmail?: HotmailAufruf
  /** Ist ein Microsoft-Konto verbunden? Ohne Angabe wie bei den Hotmail-Werkzeugen ermittelt. */
  outlookVerbunden?: boolean
}

/** Höchstens so viele Treffer je Hotmail-Suche (Grenze des email-gateway). */
export const SUCHE_HOECHSTENS = 250
/** Höchstens so viele Adressen je Person werden einzeln durchsucht. */
export const ADRESSEN_HOECHSTENS = 10
/** Ungefähre Höchstlänge des Ergebnistexts. */
export const TEXT_HOECHSTENS = 12_000

export const PERSON_WERKZEUGE = [
  {
    name: 'person_ueberblick',
    description:
      'Vollständige Übersicht zu EINER Person: alle Hotmail-Mails mit ihr (über alle ihre E-Mail-Adressen zusammengeführt, ohne Doppelte), gesendet/empfangen, erste und letzte Mail, Anzahl je Jahr, Zeitleiste mit mail_id; dazu seine privaten Kontaktakten, Termine, To-dos, Notizen und Gesprächsprotokolle mit dem Namen. Nimm es bei Fragen wie „Was läuft mit Herrn X?“, „Was habe ich an X geschickt?“, „Alle Mails mit X“ — statt outlook_suche. Gib die Zeile „Vollständig: …“ sinngemäß weiter; sag nie „das sind alle“, wenn dort „nein“ steht. Bei „Mehrdeutig“ frag nach, wer gemeint ist, und ruf es mit vollem Namen oder E-Mail-Adresse erneut auf.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name der Person (z. B. "Muster", "Thomas Muster") oder ihre E-Mail-Adresse(n).' },
        nur: { type: 'string', enum: ['mails', 'alles'], description: 'mails = nur Mails; alles (Vorgabe) = auch Kontaktakte, Termine, To-dos, Notizen, Protokolle.' },
        richtung: { type: 'string', enum: ['gesendet', 'empfangen', 'beide'], description: 'gesendet = was er ihr geschickt hat; empfangen = was sie ihm geschickt hat; beide (Vorgabe).' },
        seit: { type: 'string', description: 'Optional: nur ab diesem Datum (JJJJ-MM-TT).' },
        bis: { type: 'string', description: 'Optional: nur bis einschließlich diesem Datum (JJJJ-MM-TT), z. B. zum Eingrenzen auf ein Jahr.' },
        thema: { type: 'string', description: 'Optional: nur Mails, deren Betreff oder Anfang diese Wörter enthält.' },
      },
      required: ['name'],
    },
  },
]

export function istPersonWerkzeug(name: string): boolean {
  return PERSON_WERKZEUGE.some((w) => w.name === name)
}

// ---------- Text und Namen ----------

/** Kleinschreibung, Umlaute als ae/oe/ue/ss, ohne Akzente, nur Buchstaben/Ziffern mit einfachem Leerraum. */
export function normalisiere(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const ANREDEN = new Set(['herr', 'herrn', 'hr', 'frau', 'fr', 'dr', 'prof', 'professor', 'med', 'ing', 'dipl', 'mag', 'familie', 'fam'])
/** Wörter in Anzeigenamen, die keinen Vornamen bedeuten (Firmen, Sammeladressen). */
const KEIN_VORNAME = new Set([
  ...ANREDEN, 'gmbh', 'mbh', 'ag', 'kg', 'ug', 'ohg', 'gbr', 'ev', 'e', 'v', 'co', 'und', 'haftungsbeschraenkt', 'holding', 'immobilien', 'verwaltung',
  'info', 'kontakt', 'service', 'team', 'buero', 'office', 'mail', 'post', 'kanzlei', 'praxis', 'firma', 'noreply', 'no', 'reply',
])

const ADRESSE_MUSTER = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[a-z]{2,}/gi

/** Name aus der Eingabe zerlegen: E-Mail-Adressen, Suchtext für Hotmail, Wortteile zum Vergleichen. */
export function zerlegeName(eingabe: string): { adressen: string[]; suchtext: string; teile: string[] } {
  const adressen = [...new Set((eingabe.match(ADRESSE_MUSTER) ?? []).map((a) => a.toLowerCase()))]
  const rest = eingabe.replace(ADRESSE_MUSTER, ' ')
  const woerter = rest.split(/[\s,;]+/).map((w) => w.trim()).filter(Boolean).filter((w) => !ANREDEN.has(normalisiere(w)))
  const suchtext = woerter.join(' ').replace(/[„“"]/g, '').trim()
  const teile = [...new Set(normalisiere(suchtext).split(' ').filter((t) => t.length >= 2))]
  return { adressen, suchtext, teile }
}

/** Kommen alle Wortteile im Text vor? */
export function passtName(text: unknown, teile: string[]): boolean {
  if (!teile.length) return false
  const n = ` ${normalisiere(text)} `
  return teile.every((t) => n.includes(t))
}

function adresse(x: unknown): string {
  return typeof x === 'string' ? x.trim().toLowerCase() : ''
}

function adressenIn(text: unknown): string[] {
  return [...new Set((String(text ?? '').match(ADRESSE_MUSTER) ?? []).map((a) => a.toLowerCase()))]
}

// ---------- Datum ----------

const TAG = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' })
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
const ISO_TAG = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' })

function gueltig(d: unknown): Date | null {
  if (!d) return null
  const x = new Date(String(d))
  return Number.isNaN(x.getTime()) ? null : x
}
function deTag(d: unknown): string {
  const x = gueltig(d)
  return x ? TAG.format(x) : String(d ?? '')
}
/** JJJJ-MM-TT in Berliner Zeit. */
function isoTag(d: unknown): string {
  const x = gueltig(d)
  if (x) return ISO_TAG.format(x)
  return /^\d{4}-\d{2}-\d{2}/.test(String(d ?? '')) ? String(d).slice(0, 10) : ''
}

// ---------- Hotmail ----------

type Teilnehmer = { name: string; adresse: string }
type HotmailMail = { id: string; von: Teilnehmer; an: Teilnehmer[]; cc: Teilnehmer[]; betreff: string; datum: string; hatAnhaenge: boolean; vorschau: string }
type Suchergebnis = { begriff: string; mails: HotmailMail[]; mehr: boolean; ausgeblendet: number; fehler?: string }

function teilnehmer(x: unknown): Teilnehmer {
  const t = (x ?? {}) as { name?: unknown; adresse?: unknown }
  return { name: String(t.name ?? ''), adresse: adresse(t.adresse) }
}

function alsMail(x: Record<string, unknown>): HotmailMail {
  return {
    id: String(x.id ?? ''),
    von: teilnehmer(x.von),
    an: Array.isArray(x.an) ? x.an.map(teilnehmer) : [],
    cc: Array.isArray(x.cc) ? x.cc.map(teilnehmer) : [],
    betreff: String(x.betreff ?? '(ohne Betreff)'),
    datum: String(x.datum ?? ''),
    hatAnhaenge: x.hatAnhaenge === true,
    vorschau: String(x.vorschau ?? ''),
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

async function suche(hotmail: HotmailAufruf, begriff: string): Promise<Suchergebnis> {
  try {
    const r = await hotmail({ action: 'outlook_suche', begriff, anzahl: SUCHE_HOECHSTENS })
    if (!r.ok) return { begriff, mails: [], mehr: false, ausgeblendet: 0, fehler: String(r.daten?.error ?? `Anfrage fehlgeschlagen (${r.status})`) }
    const mails = (Array.isArray(r.daten.mails) ? r.daten.mails : []) as Record<string, unknown>[]
    return { begriff, mails: mails.map(alsMail).filter((m) => m.id), mehr: r.daten.mehr === true, ausgeblendet: Number(r.daten.ausgeblendet ?? 0) }
  } catch (e) {
    return { begriff, mails: [], mehr: false, ausgeblendet: 0, fehler: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- CRM-Zeilen ----------

type Kontakt = { id: string; firma: string | null; ansprechpartner: string | null; email: string | null; telefon: string | null; activities: unknown; dokumente: unknown; bereich: string | null; verantwortlich_email: string | null }
type Termin = { id: string; titel: string | null; ort: string | null; beschreibung: string | null; beginn: string | null; ende: string | null; ganztags: boolean | null; besitzer_email: string | null; teilnehmer: string[] | null; kunde_id: string | null; kunde_name: string | null }
type Todo = { id: string; aufgabe: string | null; kunde_projekt: string | null; aktueller_stand: string | null; erledigt_am: string | null; erledigen_bis: string | null; besitzer_email: string | null; bereich: string | null }
type Protokoll = { id: string; kunde_id: string | null; bereich: string | null; besitzer_email: string | null; datum: string | null; betreff: string | null; teilnehmer: string | null; text: string | null; ki_zusammenfassung: string | null }
type Gesendet = { id: string; an: string | null; an_name: string | null; betreff: string | null; gesendet_am: string | null; besitzer_email: string | null }
type Eingang = { message_id: string; von: string | null; von_name: string | null; betreff: string | null; mail_datum: string | null; anhaenge: unknown; besitzer_email: string | null }

function kontaktName(k: Pick<Kontakt, 'firma' | 'ansprechpartner'>): string {
  const a = String(k.ansprechpartner ?? '').trim()
  const f = String(k.firma ?? '').trim()
  return a && f && a !== f ? `${a} (${f})` : a || f || 'ohne Namen'
}

/** Liest Zeilen mit Fehlermeldung statt Ausnahme; Fehler landen in `luecken`. */
async function lies<T>(luecken: string[], was: string, baue: () => PromiseLike<{ data: unknown; error: unknown }>, ordnung: string | string[] = 'id'): Promise<T[]> {
  try {
    const { data, error } = await alleZeilen<T>(baue, { ordnung })
    if (error) luecken.push(`${was} nicht vollständig lesbar (${error.message})`)
    return data
  } catch (e) {
    luecken.push(`${was} nicht lesbar (${e instanceof Error ? e.message : String(e)})`)
    return []
  }
}

// ---------- Personen erkennen ----------

type Kandidat = { schluessel: string; adressen: Set<string>; namen: Set<string>; kontakte: Set<string>; treffer: number }

/** Vornamen (bzw. sonstige unterscheidende Wörter) aus Anzeigenamen; ohne Anzeigenamen aus der Adresse. */
function vornamenVon(k: Kandidat, teile: string[]): Set<string> {
  const aus = (text: string) =>
    normalisiere(text)
      .split(' ')
      .filter((w) => w && !/\d/.test(w) && !KEIN_VORNAME.has(w) && !teile.some((t) => w === t || w.includes(t)))
  const namen = [...k.namen].filter((n) => n.trim() && !n.includes('@'))
  const woerter = namen.length ? namen.flatMap(aus) : [...k.adressen].filter((a) => a.includes('@')).flatMap((a) => aus(a.split('@')[0]))
  return new Set(woerter)
}

function vertraeglich(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return true
  for (const x of a) for (const y of b) if (x === y || x.startsWith(y) || y.startsWith(x)) return true
  return false
}

/** Fasst Adressen/Kontakte zu Personen zusammen. Mehr als eine Person = mehrdeutig. */
const ALLGEMEINE_POSTFAECHER = /^(info|kontakt|office|mail|post|service|support|buero|buro|verwaltung|vertrieb|noreply|no-reply|newsletter|team|hallo|hello|zentrale|empfang)\b/

export function personenBilden(kandidaten: Kandidat[], teile: string[]): Kandidat[] {
  const eltern = kandidaten.map((_, i) => i)
  const wurzel = (i: number): number => (eltern[i] === i ? i : (eltern[i] = wurzel(eltern[i])))
  const vereine = (i: number, j: number) => {
    eltern[wurzel(i)] = wurzel(j)
  }
  const vn = kandidaten.map((k) => vornamenVon(k, teile))
  // Gleicher Kontakt = gleiche Person.
  for (let i = 0; i < kandidaten.length; i++) for (let j = i + 1; j < kandidaten.length; j++) if ([...kandidaten[i].kontakte].some((x) => kandidaten[j].kontakte.has(x))) vereine(i, j)
  // Gleicher persönlicher Adress-Teil vor dem @ (z. B. max.muster@bank-a.de und max.muster@firma-b.de) = gleiche
  // Person, auch wenn ein Anzeigename nur die Firma nennt („Muster Bank“). Allgemeine Postfächer zählen nicht.
  const lokal = kandidaten.map((k) => new Set([...k.adressen].map((a) => a.split('@')[0].toLowerCase()).filter((l) => l.length >= 5 && !ALLGEMEINE_POSTFAECHER.test(l))))
  for (let i = 0; i < kandidaten.length; i++) for (let j = i + 1; j < kandidaten.length; j++) if ([...lokal[i]].some((l) => lokal[j].has(l))) vereine(i, j)
  // Verträgliche Vornamen (gleich oder Initiale) = gleiche Person.
  for (let i = 0; i < kandidaten.length; i++) for (let j = i + 1; j < kandidaten.length; j++) if (vn[i].size && vn[j].size && vertraeglich(vn[i], vn[j])) vereine(i, j)
  const gruppenVon = () => {
    const m = new Map<number, number[]>()
    kandidaten.forEach((_, i) => m.set(wurzel(i), [...(m.get(wurzel(i)) ?? []), i]))
    return m
  }
  const mitVorname = [...gruppenVon().entries()].filter(([, l]) => l.some((i) => vn[i].size))
  // Adressen ohne Vornamen: bei genau einer Person dorthin, sonst zur Person mit derselben Domain, sonst eigene Gruppe.
  for (let i = 0; i < kandidaten.length; i++) {
    if (vn[i].size || mitVorname.some(([w]) => w === wurzel(i))) continue
    if (mitVorname.length === 1) {
      vereine(i, mitVorname[0][0])
      continue
    }
    const domain = [...kandidaten[i].adressen][0]?.split('@')[1]
    const gleiche = domain ? mitVorname.filter(([, l]) => l.some((j) => [...kandidaten[j].adressen].some((a) => a.split('@')[1] === domain))) : []
    if (gleiche.length === 1) vereine(i, gleiche[0][0])
  }
  return [...gruppenVon().values()].map((l) => vereinige(l.map((i) => kandidaten[i])))
}

function vereinige(liste: Kandidat[]): Kandidat {
  return {
    schluessel: liste.map((k) => k.schluessel).join('|'),
    adressen: new Set(liste.flatMap((k) => [...k.adressen])),
    namen: new Set(liste.flatMap((k) => [...k.namen])),
    kontakte: new Set(liste.flatMap((k) => [...k.kontakte])),
    treffer: liste.reduce((s, k) => s + k.treffer, 0),
  }
}

function besterName(p: Kandidat): string {
  const namen = [...p.namen].filter((n) => n.trim() && !n.includes('@'))
  return namen.sort((a, b) => b.length - a.length)[0] ?? [...p.adressen][0] ?? 'unbekannt'
}

// ---------- Mails zusammenführen ----------

type Richtung = 'gesendet' | 'empfangen' | 'beteiligt' | 'erwaehnt'
type Eintrag = { id: string; kennung: string; quelle: 'hotmail' | 'crm_gesendet' | 'crm_eingang'; datum: string; richtung: Richtung; betreff: string; anhang: boolean | null; text: string }

const RICHTUNG_TEXT: Record<Richtung, string> = { gesendet: 'gesendet', empfangen: 'empfangen', beteiligt: 'von Dritten (er/sie in An/Kopie)', erwaehnt: 'nur erwähnt' }

function richtungHotmail(m: HotmailMail, person: Set<string>, eigene: Set<string>, eigeneBekannt: boolean): Richtung {
  const beteiligt = person.has(m.von.adresse) || [...m.an, ...m.cc].some((t) => person.has(t.adresse))
  if (!beteiligt) return 'erwaehnt'
  if (person.has(m.von.adresse)) return 'empfangen'
  if (eigene.has(m.von.adresse) || !eigeneBekannt) return 'gesendet'
  return 'beteiligt'
}

// ---------- Ausführen ----------

export async function fuehrePersonWerkzeugAus(name: string, input: Record<string, unknown>, k: PersonKontext): Promise<string> {
  if (name !== 'person_ueberblick') return `Fehler: Unbekanntes Werkzeug ${name}`
  const ich = adresse(k.mitarbeiter?.email)
  if (!ich) return 'Fehler: Login des Mitarbeiters unbekannt.'
  const eingabe = String(input.name ?? '').trim().slice(0, 200)
  const { adressen: gegeben, suchtext, teile } = zerlegeName(eingabe)
  if (!gegeben.length && !teile.length) return 'Fehler: Bitte einen Namen oder eine E-Mail-Adresse angeben.'
  const nurMails = input.nur === 'mails'
  const richtungWunsch = input.richtung === 'gesendet' || input.richtung === 'empfangen' ? input.richtung : 'beide'
  const datumOk = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  if (input.seit && !datumOk(input.seit)) return 'Fehler: seit muss das Format JJJJ-MM-TT haben.'
  if (input.bis && !datumOk(input.bis)) return 'Fehler: bis muss das Format JJJJ-MM-TT haben.'
  const seit = datumOk(input.seit) ? String(input.seit) : ''
  const bis = datumOk(input.bis) ? String(input.bis) : ''
  const themaTeile = normalisiere(input.thema).split(' ').filter((t) => t.length >= 2)
  setzePrivat()

  const db = k.supabase
  const luecken: string[] = [] // Gründe für „Vollständig: nein“
  const hinweise: string[] = []

  // Eigene Adressen (für gesendet/empfangen) und ob Hotmail verbunden ist.
  const verbunden = k.outlookVerbunden ?? (await privatFaehigkeiten(db, ich).catch(() => ({ outlook: false }))).outlook
  const { data: konto } = await db.from('ms_konten').select('ms_adresse').eq('login_email', ich).maybeSingle().then((r: unknown) => r, () => ({ data: null }))
  const msAdresse = adresse(konto?.ms_adresse)
  const eigene = new Set([ich, msAdresse].filter(Boolean))

  // Eigene private Kontakte — Besitzer-Bedingung in der Abfrage UND im Code.
  const kontakte = (
    await lies<Kontakt>(luecken, 'Private Kontakte', () =>
      db.from('kunden').select('id, firma, ansprechpartner, email, telefon, activities, dokumente, bereich, verantwortlich_email').eq('bereich', 'privat').ilike('verantwortlich_email', ich),
    )
  ).filter((x) => x.bereich === 'privat' && adresse(x.verantwortlich_email) === ich)
  const eigeneKontaktIds = new Set(kontakte.map((x) => x.id))
  const passendeKontakte = kontakte.filter((x) => passtName(`${x.firma ?? ''} ${x.ansprechpartner ?? ''}`, teile) || adressenIn(x.email).some((a) => gegeben.includes(a)))

  // 1. Suche nach dem Namen (nur wenn ein Name angegeben ist).
  const hotmail = k.hotmail ?? gatewayFuer(ich)
  const suchen: Suchergebnis[] = []
  if (verbunden && teile.length && suchtext.length >= 2) suchen.push(await suche(hotmail, suchtext))
  const namensSuche = suchen[0]

  // Kandidaten: Teilnehmer der Treffer, deren Name (oder Adresse) passt, und passende private Kontakte.
  const kandidaten = new Map<string, Kandidat>()
  const kandidat = (schluessel: string) => {
    let x = kandidaten.get(schluessel)
    if (!x) kandidaten.set(schluessel, (x = { schluessel, adressen: new Set(), namen: new Set(), kontakte: new Set(), treffer: 0 }))
    return x
  }
  if (gegeben.length) {
    for (const a of gegeben) kandidat(a).adressen.add(a)
  } else {
    for (const m of namensSuche?.mails ?? []) {
      for (const t of [m.von, ...m.an, ...m.cc]) {
        if (!t.adresse || eigene.has(t.adresse)) continue
        if (!passtName(t.name, teile) && !passtName(t.adresse.split('@')[0], teile)) continue
        const x = kandidat(t.adresse)
        x.adressen.add(t.adresse)
        if (t.name) x.namen.add(t.name)
        x.treffer++
      }
    }
  }
  for (const kt of passendeKontakte) {
    const as = adressenIn(kt.email).filter((a) => !eigene.has(a))
    // Bei gegebener Adresse nur Kontakte, zu denen die Adresse gehört.
    if (gegeben.length && !as.some((a) => gegeben.includes(a))) continue
    const ziele = as.length ? as : [`kontakt:${kt.id}`]
    for (const a of ziele) {
      const x = kandidat(a)
      if (a.includes('@')) x.adressen.add(a)
      x.namen.add(kontaktName(kt))
      if (kt.ansprechpartner) x.namen.add(String(kt.ansprechpartner))
      x.kontakte.add(kt.id)
    }
  }

  // Mit angegebener Adresse ist die Person festgelegt: alles gehört zu ihr.
  const personen = gegeben.length ? [vereinige([...kandidaten.values()])] : personenBilden([...kandidaten.values()], teile)

  if (personen.length > 1) {
    const zeilen = personen
      .sort((a, b) => b.treffer - a.treffer)
      .slice(0, 8)
      .map((p, i) => {
        const adr = [...p.adressen].slice(0, 4).join(', ') || 'keine E-Mail-Adresse'
        const kt = [...p.kontakte].map((id) => `kontakt_id=${id}`).join(', ')
        return `${i + 1}. ${besterName(p)} — ${adr}${p.treffer ? ` (${p.treffer}× in Mails)` : ''}${kt ? ` · private Kontaktakte ${kt}` : ''}`
      })
    return `Mehrdeutig: Zu „${eingabe}“ passen ${personen.length} verschiedene Personen:\n${zeilen.join('\n')}${personen.length > 8 ? `\n… und ${personen.length - 8} weitere` : ''}\nFrag ihn kurz, wen er meint, und ruf person_ueberblick dann mit vollem Namen oder der E-Mail-Adresse erneut auf.\nVollständig: nein, weil der Name mehrdeutig ist — noch keine Übersicht erstellt.`
  }

  const person: Kandidat = personen[0] ?? { schluessel: '', adressen: new Set(), namen: new Set(), kontakte: new Set(), treffer: 0 }
  const personAdressen = new Set([...person.adressen].filter((a) => a.includes('@')))
  const personKontakte = kontakte.filter((x) => person.kontakte.has(x.id))

  // 2. Je Adresse erneut suchen (die häufigsten zuerst).
  if (verbunden) {
    const reihe = [...personAdressen]
    if (reihe.length > ADRESSEN_HOECHSTENS) luecken.push(`von ${reihe.length} Adressen wurden nur ${ADRESSEN_HOECHSTENS} durchsucht`)
    for (let i = 0; i < Math.min(reihe.length, ADRESSEN_HOECHSTENS); i += 3) {
      suchen.push(...(await Promise.all(reihe.slice(i, i + 3).map((a) => suche(hotmail, a)))))
    }
  } else {
    luecken.push('kein Microsoft-Konto verbunden — Hotmail wurde nicht durchsucht')
  }
  // Sind alle Adress-Suchen vollständig, fehlt bei einer übervollen NAMENS-Suche höchstens eine reine Erwähnung — die Mails
  // mit der Person selbst sind dann komplett (Muster: Name > 250 Treffer, beide Adressen vollständig, 68 von 68 gesendet).
  const adressSuchen = suchen.filter((s) => s.begriff.includes('@'))
  const adressenKomplett = adressSuchen.length > 0 && adressSuchen.every((s) => !s.fehler && !s.mehr)
  for (const s of suchen) {
    if (s.fehler) luecken.push(`Hotmail-Suche nach „${s.begriff}“ fehlgeschlagen (${s.fehler})`)
    else if (s.mehr && adressenKomplett && !s.begriff.includes('@')) hinweise.push(`Mails, in denen „${s.begriff}“ nur erwähnt wird, können fehlen (mehr als ${SUCHE_HOECHSTENS} Treffer) — die Mails mit der Person selbst sind vollständig.`)
    else if (s.mehr) luecken.push(`die Hotmail-Suche nach „${s.begriff}“ hat mehr als ${SUCHE_HOECHSTENS} Treffer (nur ${SUCHE_HOECHSTENS} gelesen)`)
  }
  const ausgeblendet = Math.max(0, ...suchen.map((s) => s.ausgeblendet))
  if (ausgeblendet) hinweise.push(`${ausgeblendet} Mails zum Mayer-Geschäft sind im privaten Bereich ausgeblendet (gehören ins Mayer-CRM).`)
  if (verbunden && !msAdresse) hinweise.push('Eigene Hotmail-Adresse unbekannt — gesendet/empfangen ist geschätzt.')

  // Zusammenführen nach Mail-Kennung.
  const eintraege = new Map<string, Eintrag>()
  for (const s of suchen) {
    for (const m of s.mails) {
      if (eintraege.has(`h:${m.id}`)) continue
      const richtung = richtungHotmail(m, personAdressen, eigene, !!msAdresse)
      // Treffer einer Adress-Suche ohne Beteiligung der Person (Adresse nur im Text) zählen als Erwähnung.
      eintraege.set(`h:${m.id}`, { id: `h:${m.id}`, kennung: `mail_id=${m.id}`, quelle: 'hotmail', datum: m.datum, richtung, betreff: m.betreff, anhang: m.hatAnhaenge, text: `${m.betreff} ${m.vorschau}` })
    }
  }

  // Aus dem CRM gesendete Mails (eigenes Postfach) — nur eigene.
  const gesendet = (
    await lies<Gesendet>(luecken, 'Aus dem CRM gesendete Mails', () => db.from('gesendete_emails').select('id, an, an_name, betreff, gesendet_am, besitzer_email').eq('besitzer_email', ich))
  ).filter((g) => adresse(g.besitzer_email) === ich)
  for (const g of gesendet) {
    const anIhn = adressenIn(g.an).some((a) => personAdressen.has(a)) || passtName(g.an_name, teile)
    const erwaehnt = !anIhn && passtName(g.betreff, teile)
    if (!anIhn && !erwaehnt) continue
    eintraege.set(`g:${g.id}`, { id: `g:${g.id}`, kennung: `CRM-Postfach, gesendet id=${g.id}`, quelle: 'crm_gesendet', datum: String(g.gesendet_am ?? ''), richtung: anIhn ? 'gesendet' : 'erwaehnt', betreff: String(g.betreff ?? '(ohne Betreff)'), anhang: null, text: String(g.betreff ?? '') })
  }
  // Im eigenen CRM-Postfach eingegangene Mails — ohne die aus Hotmail abgelegten (message_id „ms_…“, oben schon gezählt).
  const eingaenge = (
    await lies<Eingang>(luecken, 'Eingegangene Mails im eigenen CRM-Postfach', () => db.from('eingegangene_emails').select('message_id, von, von_name, betreff, mail_datum, anhaenge, besitzer_email').eq('besitzer_email', ich), 'message_id')
  ).filter((e) => adresse(e.besitzer_email) === ich && !String(e.message_id ?? '').startsWith('ms_'))
  for (const e of eingaenge) {
    const vonIhm = adressenIn(e.von).some((a) => personAdressen.has(a)) || passtName(e.von_name, teile)
    const erwaehnt = !vonIhm && passtName(e.betreff, teile)
    if (!vonIhm && !erwaehnt) continue
    eintraege.set(`e:${e.message_id}`, {
      id: `e:${e.message_id}`,
      kennung: `CRM-Postfach, Eingang mail_id=${e.message_id}`,
      quelle: 'crm_eingang',
      datum: String(e.mail_datum ?? ''),
      richtung: vonIhm ? 'empfangen' : 'erwaehnt',
      betreff: String(e.betreff ?? '(ohne Betreff)'),
      anhang: Array.isArray(e.anhaenge) ? e.anhaenge.length > 0 : null,
      text: String(e.betreff ?? ''),
    })
  }

  // Zeitraum und Thema.
  const imZeitraum = (d: string) => {
    const t = isoTag(d)
    return (!seit || (t && t >= seit)) && (!bis || (t && t <= bis))
  }
  const alle = [...eintraege.values()].filter((e) => imZeitraum(e.datum) && (!themaTeile.length || passtName(e.text, themaTeile)))
  alle.sort((a, b) => String(b.datum).localeCompare(String(a.datum)))
  const mitIhm = alle.filter((e) => e.richtung !== 'erwaehnt')
  const zaehle = (r: Richtung) => mitIhm.filter((e) => e.richtung === r).length

  // ---------- Text ----------
  const teileText: string[] = []
  const anzeigeName = besterName(person) !== 'unbekannt' ? besterName(person) : eingabe
  teileText.push(`Person: ${anzeigeName}${seit || bis ? ` · Zeitraum ${seit ? `ab ${deTag(seit)}` : ''}${seit && bis ? ' ' : ''}${bis ? `bis ${deTag(bis)}` : ''}` : ''}${themaTeile.length ? ` · Thema „${String(input.thema)}“` : ''}`)
  teileText.push(`E-Mail-Adressen: ${personAdressen.size ? [...personAdressen].join(', ') : 'keine gefunden'}`)
  if (!nurMails || personKontakte.length) {
    teileText.push(
      personKontakte.length
        ? `Private Kontaktakte: ${personKontakte.map((x) => `${kontaktName(x)} (kontakt_id=${x.id}${x.telefon ? `, Tel. ${x.telefon}` : ''}${Array.isArray(x.dokumente) && x.dokumente.length ? `, ${x.dokumente.length} Unterlagen` : ''})`).join('; ')}`
        : 'Private Kontaktakte: keine',
    )
  }
  if (mitIhm.length) {
    const jahre = new Map<string, number>()
    for (const e of mitIhm) jahre.set(isoTag(e.datum).slice(0, 4) || '?', (jahre.get(isoTag(e.datum).slice(0, 4) || '?') ?? 0) + 1)
    const beteiligt = zaehle('beteiligt')
    teileText.push(
      `Mails mit ihr/ihm: ${mitIhm.length} (gesendet ${zaehle('gesendet')}, empfangen ${zaehle('empfangen')}${beteiligt ? `, von Dritten mit ihr/ihm in An/Kopie ${beteiligt}` : ''}) — erste ${deTag(mitIhm[mitIhm.length - 1].datum)}, letzte ${deTag(mitIhm[0].datum)}`,
    )
    teileText.push(`Je Jahr: ${[...jahre.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([j, n]) => `${j}: ${n}`).join(' · ')}`)
  } else {
    teileText.push('Mails mit ihr/ihm: keine gefunden')
  }
  const nurErwaehnt = alle.length - mitIhm.length
  if (nurErwaehnt) teileText.push(`Dazu ${nurErwaehnt} Mails, in denen nur der Name vorkommt (sie/er ist nicht Absender oder Empfänger).`)
  teileText.push(...hinweise)

  // CRM-Abschnitte (bei nur=mails nicht).
  const abschnitte: string[] = []
  if (!nurMails) {
    const passt = (text: unknown) => passtName(text, teile) || adressenIn(text).some((a) => personAdressen.has(a))
    const begrenze = <T>(titel: string, liste: T[], zeile: (x: T) => string, hoechstens: number) => {
      if (!liste.length) return
      const gezeigt = liste.slice(0, hoechstens)
      if (liste.length > hoechstens) luecken.push(`${liste.length - hoechstens} ${titel} nicht einzeln aufgeführt`)
      abschnitte.push(`${titel} (${liste.length}):\n${gezeigt.map(zeile).join('\n')}${liste.length > hoechstens ? `\n… weitere ${liste.length - hoechstens} ${titel} nicht aufgeführt` : ''}`)
    }

    // Eigene Termine ohne Kollegen, deren Akte (falls verknüpft) ein eigener privater Kontakt ist.
    const termine = (
      await lies<Termin>(luecken, 'Termine', () => db.from('termine').select('id, titel, ort, beschreibung, beginn, ende, ganztags, besitzer_email, teilnehmer, kunde_id, kunde_name').ilike('besitzer_email', ich))
    )
      .filter((t) => adresse(t.besitzer_email) === ich && !(t.teilnehmer ?? []).length && (!t.kunde_id || eigeneKontaktIds.has(t.kunde_id)))
      .filter((t) => (t.kunde_id && person.kontakte.has(t.kunde_id)) || passt(`${t.titel ?? ''} ${t.ort ?? ''} ${t.beschreibung ?? ''} ${t.kunde_name ?? ''}`))
      .filter((t) => imZeitraum(String(t.beginn ?? '')))
      .sort((a, b) => String(b.beginn ?? '').localeCompare(String(a.beginn ?? '')))
    const jetzt = new Date().toISOString()
    begrenze('Termine', termine, (t) => `- ${deTag(t.beginn)}${t.ganztags ? '' : ` ${gueltig(t.beginn) ? UHR.format(gueltig(t.beginn)!) : ''}`} ${String(t.beginn ?? '') >= jetzt ? '(kommt noch) ' : ''}${t.titel ?? ''}${t.ort ? ` · ${t.ort}` : ''} termin_id=${t.id}`, 15)

    // Eigene To-dos (ohne Bereich = persönliche Liste).
    const todos = (
      await lies<Todo>(luecken, 'To-dos', () => db.from('todos').select('id, aufgabe, kunde_projekt, aktueller_stand, erledigt_am, erledigen_bis, besitzer_email, bereich').is('bereich', null).ilike('besitzer_email', ich))
    )
      .filter((t) => adresse(t.besitzer_email) === ich && !t.bereich)
      .filter((t) => passt(`${t.aufgabe ?? ''} ${t.kunde_projekt ?? ''} ${t.aktueller_stand ?? ''}`))
      .sort((a, b) => (a.erledigt_am ? 1 : 0) - (b.erledigt_am ? 1 : 0) || String(a.erledigen_bis ?? '9999').localeCompare(String(b.erledigen_bis ?? '9999')))
    begrenze('To-dos', todos, (t) => `- [${t.erledigt_am ? `erledigt ${deTag(t.erledigt_am)}` : 'offen'}] ${String(t.aufgabe ?? '').slice(0, 140)}${t.erledigen_bis && !t.erledigt_am ? ` (bis ${deTag(t.erledigen_bis)})` : ''} todo_id=${t.id}`, 15)

    // Notizen: Verlauf der passenden Kontaktakten ganz, der übrigen eigenen Kontakte nur mit dem Namen.
    type Notiz = { datum: string; text: string; wo: string; ausAkte: boolean }
    const notizen: Notiz[] = []
    for (const kt of kontakte) {
      const eigeneAkte = person.kontakte.has(kt.id)
      for (const a of (Array.isArray(kt.activities) ? kt.activities : []) as Record<string, unknown>[]) {
        const text = String(a?.text ?? '').trim()
        if (!text || !(eigeneAkte || passt(text))) continue
        if (!imZeitraum(String(a.date ?? ''))) continue
        notizen.push({ datum: String(a.date ?? ''), text, wo: kontaktName(kt), ausAkte: eigeneAkte })
      }
    }
    notizen.sort((a, b) => String(b.datum).localeCompare(String(a.datum)))
    begrenze('Notizen', notizen, (n) => `- ${deTag(n.datum)} ${n.text.replace(/\s+/g, ' ').slice(0, 200)}${n.ausAkte ? '' : ` [Akte ${n.wo}]`}`, 15)

    // Gesprächsprotokolle: nur der eigenen privaten Kontakte bzw. mit eigenem Besitzer.
    const protokolle = new Map<string, Protokoll>()
    const spalten = 'id, kunde_id, bereich, besitzer_email, datum, betreff, teilnehmer, text, ki_zusammenfassung'
    const ids = [...eigeneKontaktIds]
    for (let i = 0; i < ids.length; i += 100) {
      const stueck = ids.slice(i, i + 100)
      for (const p of await lies<Protokoll>(luecken, 'Gesprächsprotokolle', () => db.from('protokolle').select(spalten).eq('bereich', 'privat').in('kunde_id', stueck))) protokolle.set(p.id, p)
    }
    for (const p of await lies<Protokoll>(luecken, 'Gesprächsprotokolle', () => db.from('protokolle').select(spalten).eq('bereich', 'privat').ilike('besitzer_email', ich))) protokolle.set(p.id, p)
    const prot = [...protokolle.values()]
      .filter((p) => p.bereich === 'privat' && ((p.kunde_id && eigeneKontaktIds.has(p.kunde_id)) || adresse(p.besitzer_email) === ich))
      .filter((p) => (p.kunde_id && person.kontakte.has(p.kunde_id)) || passt(`${p.betreff ?? ''} ${p.teilnehmer ?? ''} ${p.text ?? ''} ${p.ki_zusammenfassung ?? ''}`))
      .filter((p) => imZeitraum(String(p.datum ?? '')))
      .sort((a, b) => String(b.datum ?? '').localeCompare(String(a.datum ?? '')))
    begrenze('Gesprächsprotokolle', prot, (p) => `- ${deTag(p.datum)} ${p.betreff ?? ''}${p.teilnehmer ? ` (${p.teilnehmer})` : ''}: ${String(p.ki_zusammenfassung || p.text || '').replace(/\s+/g, ' ').slice(0, 200)}`, 10)
  }

  // Zeitleiste der Mails im verbleibenden Platz.
  const liste = alle.filter((e) => (richtungWunsch === 'beide' ? true : e.richtung === richtungWunsch))
  const kopf = teileText.join('\n')
  const crm = abschnitte.length ? `\n\n${abschnitte.join('\n\n')}` : ''
  const platz = TEXT_HOECHSTENS - kopf.length - crm.length - 700
  const zeilen: string[] = []
  let laenge = 0
  let gezeigt = 0
  let jahr = ''
  const jahrAnzahl = new Map<string, number>()
  for (const e of liste) jahrAnzahl.set(isoTag(e.datum).slice(0, 4) || '?', (jahrAnzahl.get(isoTag(e.datum).slice(0, 4) || '?') ?? 0) + 1)
  // Mit Kennung (je ~150 Zeichen) passen nur ~40 Mails hinein. Passt die Liste ohne Kennung ganz, lieber alle ohne Kennung
  // zeigen — eine einzelne Mail findet der Assistent danach gezielt mit outlook_suche (Betreff).
  const ohneKennung = liste.reduce((summe, e) => summe + 30 + Math.min(90, e.betreff.length), 0)
  const mitKennung = liste.reduce((summe, e) => summe + 30 + Math.min(90, e.betreff.length) + e.kennung.length, 0)
  const kennungZeigen = mitKennung <= platz || ohneKennung > platz
  for (const e of liste) {
    const j = isoTag(e.datum).slice(0, 4) || '?'
    const ueberschrift = j !== jahr ? `${j} (${jahrAnzahl.get(j)}):` : ''
    const tag = deTag(e.datum).slice(0, 6)
    const zeile = `- ${tag} ${RICHTUNG_TEXT[e.richtung]} | ${e.betreff.replace(/\s+/g, ' ').slice(0, 90)}${e.anhang ? ' | Anhang' : ''}${kennungZeigen ? ` | ${e.kennung}` : ''}`
    const neu = (ueberschrift ? ueberschrift.length + 1 : 0) + zeile.length + 1
    if (laenge + neu > platz) break
    if (ueberschrift) zeilen.push(ueberschrift)
    zeilen.push(zeile)
    laenge += neu
    gezeigt++
    jahr = j
  }
  const fehlend = liste.length - gezeigt
  let zeitleiste = ''
  if (liste.length) {
    const titel = richtungWunsch === 'gesendet' ? 'Gesendete Mails an sie/ihn' : richtungWunsch === 'empfangen' ? 'Empfangene Mails von ihr/ihm' : 'Zeitleiste der Mails'
    zeitleiste = `\n\n${titel} (${liste.length}, neueste zuerst):\n${zeilen.join('\n')}`
    if (fehlend) {
      const rest = new Map<string, number>()
      for (const e of liste.slice(gezeigt)) rest.set(isoTag(e.datum).slice(0, 4) || '?', (rest.get(isoTag(e.datum).slice(0, 4) || '?') ?? 0) + 1)
      zeitleiste += `\n… weitere ${fehlend} Mails nicht aufgeführt (${[...rest.entries()].map(([j, n]) => `${j}: ${n}`).join(', ')}) — nach Jahr (seit/bis) oder Thema eingrenzen.`
      luecken.push(`${fehlend} der ${liste.length} Mails nicht einzeln aufgeführt (gezählt sind alle) — mit seit/bis oder thema eingrenzen`)
    }
  } else if (richtungWunsch !== 'beide' && alle.length) {
    zeitleiste = `\n\nKeine ${richtungWunsch === 'gesendet' ? 'gesendeten' : 'empfangenen'} Mails.`
  }

  const vollstaendig = luecken.length ? `Vollständig: nein, weil ${[...new Set(luecken)].join('; ')}.` : 'Vollständig: ja.'
  return `${kopf}${zeitleiste}${crm}\n\n${vollstaendig}`
}
