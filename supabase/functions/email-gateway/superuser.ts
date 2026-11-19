// Superuser-Bereich (Eray, 19.11.2026): Auswertungen, die nur Mitarbeiter mit
// `mitarbeiter.ist_superuser` sehen — weder Geschäftsführung noch Kollegen.
//
// A Nutzung je Mitarbeiter   — nur Tatsachen: letzte Anmeldung, aktive Tage und Minuten (Messung im
//                              Browser seit 19.11.2026, Tabelle `nutzung_minuten`), Uhrzeiten, Anzahlen.
//                              Keine Noten, keine Ranglisten, keine wertenden Worte.
// B Verlauf                   — alle Verlaufseinträge aus Akten und Objekten, dazu gesendete Mails und
//                              angelegte Termine, nach Zeit sortiert (höchstens 500).
// C Geschäftszahlen           — je Woche: neue Akten je Bereich, Anfragen und was daraus wurde,
//                              Antwortzeit auf erste Mails, überfällige Wiedervorlagen, Objekte nach Status.
// D Technik & Kosten          — KI-Kosten (nur hier, Mitarbeiter sehen nie Beträge), Fehler, Postfächer,
//                              Sprachnachrichten von heute gegen die Groq-Tagesgrenze.
// F Wochenbericht             — freitags ab 16 Uhr einmal per Telegram an alle Superuser.
//
// Grenzen der Daten: `ki_verbrauch` kennt die Person erst seit 19.11.2026 (ältere Aufrufe und Zeitplan-
// Aufträge zählen als "automatisch"); der
// Assistent-Verlauf (`telegram_pending.zuege`) hält je Mitarbeiter nur die letzten Gesprächszüge;
// Verlaufseinträge tragen nur einen Tag, keine Uhrzeit; Akten haben kein Anlegedatum (erster
// Verlaufseintrag gilt als Anlage).

import { ermittleAufrufer } from './postfach.ts'
import { berlinZeit, plusTage, istDienstSchluessel } from './tagesmeldung.ts'
import { ordneAufgabenZu, ordneZu, personenNamen, OBJEKT_ABGESCHLOSSEN, type RohAufgabe } from '../_shared/aufgabenKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any
export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>

const USD_ZU_EUR = 0.92
const GROQ_TAGESGRENZE = 2000
const MESSUNG_SEIT = '19.11.2026'
const HOECHSTENS_VERLAUF = 500

const BEREICH_NAME: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  immobilienkunden: 'Immobilien (Kontakte)',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  privat: 'Privat',
}

function aktenPfad(bereich: string, id: string): string {
  switch (bereich) {
    case 'beratung':
      return `/beratung/kunden/${id}`
    case 'immobilienkunden':
      return `/immobilien/kunden/${id}`
    case 'erben':
    case 'betriebsuebergabe':
    case 'betriebsformen':
    case 'finanzierungen':
      return `/${bereich}/mandanten/${id}`
    case 'akademie':
      return `/akademie/teilnehmer/${id}`
    case 'privat':
      return `/privat/kontakte/${id}`
    default:
      return `/${bereich}/kunden/${id}`
  }
}

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------

function tag(wert: unknown): string {
  if (typeof wert !== 'string' || !wert) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(wert)) return wert
  const d = new Date(wert)
  return Number.isNaN(d.getTime()) ? '' : berlinZeit(d).datum
}

/** Montag der Woche (yyyy-mm-dd) eines Tages. */
function wochenbeginn(datum: string): string {
  const [y, m, d] = datum.split('-').map(Number)
  const wt = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sonntag
  return plusTage(datum, -((wt + 6) % 7))
}

function median(werte: number[]): number | null {
  if (werte.length === 0) return null
  const s = [...werte].sort((a, b) => a - b)
  const mitte = Math.floor(s.length / 2)
  return s.length % 2 ? s[mitte] : (s[mitte - 1] + s[mitte]) / 2
}

function kurz(t: unknown, n = 200): string {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function alsObjekt(w: unknown): Record<string, unknown> | null {
  return w && typeof w === 'object' && !Array.isArray(w) ? (w as Record<string, unknown>) : null
}

// deno-lint-ignore no-explicit-any
async function ladeAlle(admin: Db, tabelle: string, spalten: string, filter?: (q: any) => any): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const alle: any[] = []
  for (let ab = 0; ab < 20000; ab += 1000) {
    let q = admin.from(tabelle).select(spalten).range(ab, ab + 999)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`${tabelle} nicht lesbar: ${error.message}`)
    alle.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return alle
}

type TeamMitglied = { name: string; email: string; telegram_chat_id: number | string | null; ist_superuser: boolean; telegram_pending: unknown }

async function ladeTeam(admin: Db): Promise<TeamMitglied[]> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, aktiv, telegram_chat_id, ist_superuser, telegram_pending').eq('aktiv', true)
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  const echte = new Set(personenNamen(((data ?? []) as { name: string }[]).map((m) => m.name)))
  return ((data ?? []) as (TeamMitglied & { aktiv: boolean })[])
    .filter((m) => m.name && echte.has(m.name.trim()))
    .map((m) => ({ ...m, email: String(m.email ?? '').toLowerCase() }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Freitext „wer“ (Verlauf-Feld user, Zuständig …) → Mitarbeitername oder null. */
function personVon(text: unknown, namen: string[]): string | null {
  const t = String(text ?? '').trim()
  if (!t) return null
  if (namen.includes(t)) return t
  const { personen } = ordneZu(t, namen)
  return personen.length === 1 ? personen[0] : null
}

type Zug = { z: number; gesprochen: boolean }
function zuegeVon(m: TeamMitglied): Zug[] {
  const roh = alsObjekt(m.telegram_pending)
  const liste = Array.isArray(roh?.zuege) ? (roh!.zuege as unknown[]) : []
  const out: Zug[] = []
  for (const z of liste) {
    const o = alsObjekt(z)
    if (!o) continue
    const zeit = typeof o.z === 'number' ? o.z : Date.parse(String(o.z ?? ''))
    if (!Number.isFinite(zeit)) continue
    const msgs = Array.isArray(o.msgs) ? o.msgs : []
    const erste = alsObjekt(msgs[0])
    const inhalt = typeof erste?.content === 'string' ? erste.content : ''
    if (/^\[(Systemmeldung|Datei-Eingang)/.test(inhalt.trim())) continue
    out.push({ z: zeit, gesprochen: /^\[Sprachnachricht/.test(inhalt.trim()) })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Gemeinsame Grunddaten
// ---------------------------------------------------------------------------------------------

type Eintrag = { datum: string; zeit?: string; wer: string | null; werText: string; bereich: string; akte: string; pfad: string; text: string; art: 'verlauf' | 'mail' | 'termin' }

type Grunddaten = {
  team: TeamMitglied[]
  namen: string[]
  von: string
  bis: string
  // deno-lint-ignore no-explicit-any
  kunden: any[]
  // deno-lint-ignore no-explicit-any
  objekte: any[]
  eintraege: Eintrag[]
}

async function ladeGrunddaten(admin: Db, tage: number, jetzt: Date): Promise<Grunddaten> {
  const team = await ladeTeam(admin)
  const namen = team.map((m) => m.name)
  const bis = berlinZeit(jetzt).datum
  const von = plusTage(bis, -(tage - 1))
  const vonIso = new Date(Date.parse(`${von}T00:00:00Z`) - 2 * 3600000).toISOString()
  const emailZuName = new Map(team.map((m) => [m.email, m.name]))

  const [kunden, objekte, mails, termine] = await Promise.all([
    ladeAlle(admin, 'kunden', 'id, bereich, firma, ansprechpartner, activities, follow_up, verantwortlich, status'),
    ladeAlle(admin, 'objekte', 'id, bezeichnung, status, activities, follow_up, verantwortlich'),
    ladeAlle(admin, 'gesendete_emails', 'id, von, an, an_name, betreff, gesendet_am, besitzer_email, kunde_id, kunde_bereich, kunde_name', (q) => q.gte('gesendet_am', vonIso)),
    ladeAlle(admin, 'termine', 'id, titel, beginn, besitzer_email, erstellt_am, quelle, kunde_name', (q) => q.gte('erstellt_am', vonIso)),
  ])

  const eintraege: Eintrag[] = []
  for (const k of kunden) {
    if (k.bereich === 'privat') continue // private Kontakte gehören nur ihrem Besitzer
    const akte = [k.firma, k.ansprechpartner && k.ansprechpartner !== k.firma ? k.ansprechpartner : ''].filter(Boolean).join(' · ')
    for (const a of Array.isArray(k.activities) ? k.activities : []) {
      const d = tag(a?.date)
      if (!d || d < von || d > bis) continue
      eintraege.push({ datum: d, wer: personVon(a?.user, namen), werText: kurz(a?.user, 60) || 'unbekannt', bereich: BEREICH_NAME[k.bereich] ?? k.bereich, akte, pfad: aktenPfad(k.bereich, k.id), text: kurz(a?.text), art: 'verlauf' })
    }
  }
  for (const o of objekte) {
    for (const a of Array.isArray(o.activities) ? o.activities : []) {
      const d = tag(a?.date)
      if (!d || d < von || d > bis) continue
      eintraege.push({ datum: d, wer: personVon(a?.user, namen), werText: kurz(a?.user, 60) || 'unbekannt', bereich: 'Immobilien', akte: `Objekt ${o.bezeichnung}`, pfad: `/immobilien/objekte/${o.id}`, text: kurz(a?.text), art: 'verlauf' })
    }
  }
  for (const m of mails) {
    const d = tag(m.gesendet_am)
    if (!d || d < von) continue
    // Absender: privates Postfach → Besitzer; sonst über die Absenderadresse, falls sie einem Mitarbeiter gehört.
    const wer = (m.besitzer_email && emailZuName.get(String(m.besitzer_email).toLowerCase())) || emailZuName.get(String(m.von ?? '').toLowerCase()) || null
    eintraege.push({
      datum: d,
      zeit: m.gesendet_am,
      wer,
      werText: wer ?? (m.von ? `Postfach ${m.von}` : 'Postfach'),
      bereich: m.kunde_bereich ? BEREICH_NAME[m.kunde_bereich] ?? m.kunde_bereich : '',
      akte: m.kunde_name ?? '',
      pfad: m.kunde_id && m.kunde_bereich ? aktenPfad(m.kunde_bereich, m.kunde_id) : '/postfach',
      text: kurz(`Mail gesendet: „${m.betreff ?? ''}“ an ${m.an_name || m.an || ''}`),
      art: 'mail',
    })
  }
  for (const t of termine) {
    const d = tag(t.erstellt_am)
    if (!d || d < von) continue
    const wer = emailZuName.get(String(t.besitzer_email ?? '').toLowerCase()) ?? null
    eintraege.push({ datum: d, zeit: t.erstellt_am, wer, werText: wer ?? 'unbekannt', bereich: '', akte: t.kunde_name ?? '', pfad: '/kalender', text: kurz(`Termin angelegt: „${t.titel ?? ''}“ am ${tag(t.beginn).split('-').reverse().join('.')}`), art: 'termin' })
  }
  eintraege.sort((a, b) => (b.zeit ?? `${b.datum}T23:59`).localeCompare(a.zeit ?? `${a.datum}T23:59`))
  return { team, namen, von, bis, kunden, objekte, eintraege }
}

// ---------------------------------------------------------------------------------------------
// A Nutzung
// ---------------------------------------------------------------------------------------------

export type NutzungZeile = {
  name: string
  letzteAnmeldung: string | null
  aktiveTage: number
  aktiveMinuten: number
  minutenJeTag: Record<string, number>
  stunden: number[] // 24 Werte: Minuten je Uhrzeit (Berlin)
  verlaufseintraege: number
  dokumenteAbgelegt: number
  mailsGesendet: number
  termineAngelegt: number
  todosErledigt: number
  assistentZuege: number
  sprachnachrichten: number
}

async function nutzung(admin: Db, g: Grunddaten): Promise<{ zeilen: NutzungZeile[]; hinweise: string[] }> {
  const vonIso = new Date(Date.parse(`${g.von}T00:00:00Z`) - 2 * 3600000).toISOString()
  const [minuten, todos, nutzer] = await Promise.all([
    ladeAlle(admin, 'nutzung_minuten', 'email, minute', (q) => q.gte('minute', vonIso)),
    ladeAlle(admin, 'todos', 'besitzer_email, zustaendig, erledigt_am', (q) => q.not('erledigt_am', 'is', null)),
    (async () => {
      const liste: { email?: string; last_sign_in_at?: string | null }[] = []
      for (let seite = 1; seite <= 5; seite++) {
        const { data, error } = await admin.auth.admin.listUsers({ page: seite, perPage: 200 })
        if (error) break
        liste.push(...(data?.users ?? []))
        if ((data?.users ?? []).length < 200) break
      }
      return liste
    })(),
  ])
  const anmeldung = new Map(nutzer.map((u) => [String(u.email ?? '').toLowerCase(), u.last_sign_in_at ?? null]))
  const vonMs = Date.parse(vonIso)

  const zeilen: NutzungZeile[] = g.team.map((m) => {
    const eigene = minuten.filter((x) => String(x.email).toLowerCase() === m.email)
    const minutenJeTag: Record<string, number> = {}
    const stunden = new Array(24).fill(0)
    for (const x of eigene) {
      const b = berlinZeit(new Date(x.minute))
      if (b.datum < g.von || b.datum > g.bis) continue
      minutenJeTag[b.datum] = (minutenJeTag[b.datum] ?? 0) + 1
      stunden[b.stunde]++
    }
    // Assistent-Züge zählen auch als Aktivität an ihrem Tag (Telegram ohne offenes CRM).
    const zuege = zuegeVon(m).filter((z) => z.z >= vonMs)
    const tageMitZug = new Set(zuege.map((z) => berlinZeit(new Date(z.z)).datum))
    const eigeneEintraege = g.eintraege.filter((e) => e.wer === m.name)
    const tageMitAktion = new Set(eigeneEintraege.map((e) => e.datum))
    const aktiveTage = new Set([...Object.keys(minutenJeTag), ...tageMitZug, ...tageMitAktion])
    return {
      name: m.name,
      letzteAnmeldung: anmeldung.get(m.email) ?? null,
      aktiveTage: aktiveTage.size,
      aktiveMinuten: Object.values(minutenJeTag).reduce((s, n) => s + n, 0),
      minutenJeTag,
      stunden,
      verlaufseintraege: eigeneEintraege.filter((e) => e.art === 'verlauf').length,
      dokumenteAbgelegt: eigeneEintraege.filter((e) => e.art === 'verlauf' && /abgelegt|hochgeladen|Dokument|Anhang|Anhänge/i.test(e.text)).length,
      mailsGesendet: eigeneEintraege.filter((e) => e.art === 'mail').length,
      termineAngelegt: eigeneEintraege.filter((e) => e.art === 'termin').length,
      todosErledigt: todos.filter((t) => {
        const d = tag(t.erledigt_am)
        if (!d || d < g.von || d > g.bis) return false
        const zust = personVon(t.zustaendig, g.namen)
        return zust ? zust === m.name : String(t.besitzer_email ?? '').toLowerCase() === m.email
      }).length,
      assistentZuege: zuege.length,
      sprachnachrichten: zuege.filter((z) => z.gesprochen).length,
    }
  })
  return {
    zeilen,
    hinweise: [
      `Aktive Minuten werden erst seit ${MESSUNG_SEIT} im CRM gemessen (eine Minute zählt, wenn das Fenster offen ist und benutzt wird). Telegram-Nutzung ist darin nicht enthalten.`,
      'Aktive Tage: Tage mit Minuten im CRM, mit Gesprächen mit dem Assistenten oder mit eigenen Einträgen.',
      'Assistent und Sprachnachrichten: Der Assistent behält je Mitarbeiter nur die letzten Gespräche (etwa die letzten 10 Züge bzw. 12 Stunden) — ältere sind nicht mehr zählbar.',
      'Dokumente abgelegt: gezählt über Verlaufseinträge, die ein Ablegen beschreiben (Dokumente selbst tragen keinen Namen dessen, der sie abgelegt hat).',
      'Erledigte Aufgaben: nach „Zuständig“, sonst nach Besitzer der Liste.',
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// C Geschäftszahlen
// ---------------------------------------------------------------------------------------------

async function zahlen(admin: Db, g: Grunddaten, jetzt: Date) {
  const vonIso = new Date(Date.parse(`${g.von}T00:00:00Z`) - 2 * 3600000).toISOString()
  const wochen: string[] = []
  for (let d = wochenbeginn(g.von); d <= g.bis; d = plusTage(d, 7)) wochen.push(d)

  // Neue Akten je Bereich: erster Verlaufseintrag im Zeitraum.
  const neueAkten: Record<string, Record<string, number>> = {}
  for (const k of g.kunden) {
    if (k.bereich === 'privat' || String(k.id).startsWith('k_intern') || String(k.id).startsWith('k_eingang')) continue
    const tage = (Array.isArray(k.activities) ? k.activities : []).map((a: { date?: unknown }) => tag(a?.date)).filter(Boolean).sort()
    const erste = tage[0]
    if (!erste || erste < g.von || erste > g.bis) continue
    const w = wochenbeginn(erste)
    const b = BEREICH_NAME[k.bereich] ?? k.bereich
    neueAkten[w] = neueAkten[w] ?? {}
    neueAkten[w][b] = (neueAkten[w][b] ?? 0) + 1
  }

  // Anfragen: Lead-Erkennung (vorgeschlagene_leads) und relevante Mails im gemeinsamen Postfach.
  const [leads, eingang, gesendet] = await Promise.all([
    ladeAlle(admin, 'vorgeschlagene_leads', 'email, status, quelle, erstellt_am, bereich_vorschlag', (q) => q.gte('erstellt_am', vonIso)),
    ladeAlle(admin, 'eingegangene_emails', 'von, mail_datum, relevanz, besitzer_email, postfach_id', (q) => q.gte('mail_datum', new Date(Date.parse(vonIso) - 30 * 86400000).toISOString())),
    ladeAlle(admin, 'gesendete_emails', 'an, gesendet_am', (q) => q.gte('gesendet_am', new Date(Date.parse(vonIso) - 30 * 86400000).toISOString())),
  ])
  const anfragen: Record<string, { erkannt: number; uebernommen: number; verworfen: number; nichtRelevant: number; relevanteMails: number }> = {}
  const leer = () => ({ erkannt: 0, uebernommen: 0, verworfen: 0, nichtRelevant: 0, relevanteMails: 0 })
  for (const l of leads) {
    const d = tag(l.erstellt_am)
    if (!d) continue
    const w = wochenbeginn(d)
    anfragen[w] = anfragen[w] ?? leer()
    anfragen[w].erkannt++
    if (l.status === 'uebernommen') anfragen[w].uebernommen++
    else if (l.status === 'verworfen') anfragen[w].verworfen++
    else if (l.status === 'nicht_relevant') anfragen[w].nichtRelevant++
  }
  const team = new Set(g.team.map((m) => m.email))
  const oeffentlich = eingang.filter((m) => !m.besitzer_email && m.relevanz === 'kunde' && !team.has(String(m.von).toLowerCase()))
  for (const m of oeffentlich) {
    const d = tag(m.mail_datum)
    if (!d || d < g.von || d > g.bis) continue
    const w = wochenbeginn(d)
    anfragen[w] = anfragen[w] ?? leer()
    anfragen[w].relevanteMails++
  }
  const quellen: Record<string, number> = {}
  for (const l of leads) quellen[l.quelle || 'unbekannt'] = (quellen[l.quelle || 'unbekannt'] ?? 0) + 1
  const vonPostfach: Record<string, number> = {}
  for (const m of oeffentlich) {
    const d = tag(m.mail_datum)
    if (!d || d < g.von || d > g.bis) continue
    const p = m.postfach_id || 'standard'
    vonPostfach[p] = (vonPostfach[p] ?? 0) + 1
  }

  // Antwortzeit: erste relevante Mail eines Absenders im Zeitraum → erste gesendete Mail an ihn danach.
  const ersteMail = new Map<string, number>()
  for (const m of oeffentlich) {
    const t = Date.parse(m.mail_datum)
    const d = tag(m.mail_datum)
    if (!Number.isFinite(t) || !d || d < g.von) continue
    const a = String(m.von).toLowerCase()
    if (!ersteMail.has(a) || t < ersteMail.get(a)!) ersteMail.set(a, t)
  }
  const antworten: number[] = []
  let ohneAntwort = 0
  for (const [adresse, t] of ersteMail) {
    const danach = gesendet
      .filter((s) => String(s.an ?? '').toLowerCase().includes(adresse) && Date.parse(s.gesendet_am) >= t)
      .map((s) => Date.parse(s.gesendet_am))
      .sort((a, b) => a - b)[0]
    if (danach) antworten.push((danach - t) / 3600000)
    else ohneAntwort++
  }

  // Überfällige Wiedervorlagen je Person (dieselbe Zuordnung wie „Aufgaben nach Mitarbeiter“).
  const heute = berlinZeit(jetzt).datum
  const todos = await ladeAlle(admin, 'todos', 'id, aufgabe, zustaendig, erledigen_bis, geplante_wiedervorlage, erledigt_am, bereich, besitzer_email', (q) => q.is('erledigt_am', null))
  const emailZuName = new Map(g.team.map((m) => [m.email, m.name]))
  const roh: RohAufgabe[] = []
  for (const k of g.kunden) {
    const fu = k.follow_up
    if (k.bereich === 'privat' || !fu || fu.done || !fu.date) continue
    roh.push({ id: `fu:${k.id}`, art: 'followup', titel: String(fu.note ?? 'Wiedervorlage'), zustaendig: k.verantwortlich, datum: fu.date })
  }
  for (const o of g.objekte) {
    const fu = o.follow_up
    if (!fu || fu.done || !fu.date || OBJEKT_ABGESCHLOSSEN.includes(o.status)) continue
    roh.push({ id: `fu:${o.id}`, art: 'followup', titel: String(fu.note ?? 'Wiedervorlage'), zustaendig: o.verantwortlich, datum: fu.date })
  }
  for (const t of todos) {
    roh.push({ id: `todo:${t.id}`, art: 'todo', titel: t.aufgabe ?? '', zustaendig: t.zustaendig, ersatzPerson: t.bereich ? undefined : emailZuName.get(String(t.besitzer_email ?? '').toLowerCase()), datum: t.erledigen_bis || t.geplante_wiedervorlage })
  }
  const zugeordnet = ordneAufgabenZu(roh, g.namen, heute)
  const ueberfaellig: Record<string, { followups: number; todos: number }> = {}
  for (const a of zugeordnet) {
    if (a.lage !== 'ueberfaellig') continue
    ueberfaellig[a.person] = ueberfaellig[a.person] ?? { followups: 0, todos: 0 }
    if (a.art === 'todo') ueberfaellig[a.person].todos++
    else ueberfaellig[a.person].followups++
  }

  const objekteNachStatus: Record<string, number> = {}
  for (const o of g.objekte) objekteNachStatus[o.status || 'ohne Status'] = (objekteNachStatus[o.status || 'ohne Status'] ?? 0) + 1

  return {
    wochen,
    neueAkten,
    anfragen,
    quellen,
    anfragenJePostfach: vonPostfach,
    antwortzeit: { medianStunden: median(antworten), beantwortet: antworten.length, ohneAntwort },
    ueberfaellig,
    objekteNachStatus,
    hinweise: [
      'Neue Akten: Akten haben kein Anlegedatum — als Anlage gilt der erste Verlaufseintrag.',
      'Anfragen: „erkannt“ = von der Lead-Erkennung geprüfte neue Absender; „übernommen“ wurden zur Akte.',
      'Antwortzeit: von der ersten relevanten Mail eines Absenders im Zeitraum bis zur ersten Mail, die das CRM an ihn geschickt hat. Antworten aus dem Mail-Programm am CRM vorbei sind nicht sichtbar.',
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// D Technik & Kosten
// ---------------------------------------------------------------------------------------------

async function technik(admin: Db, g: Grunddaten, jetzt: Date) {
  const vonIso = new Date(Date.parse(`${g.von}T00:00:00Z`) - 2 * 3600000).toISOString()
  const [ki, wuensche, postfaecher] = await Promise.all([
    ladeAlle(admin, 'ki_verbrauch', 'am, anlass, person, funktion, modell, kosten_usd', (q) => q.gte('am', vonIso)),
    ladeAlle(admin, 'wuensche', 'titel, quelle, status, anzahl, zuletzt_am', (q) => q.gte('zuletzt_am', vonIso)),
    ladeAlle(admin, 'postfaecher', 'id, adresse, besitzer_email, aktiv, letzter_abruf, letzter_fehler'),
  ])
  // deno-lint-ignore no-explicit-any
  let appFehler: any[] = []
  try {
    const { data } = await admin.from('app_fehler').select('*').limit(500)
    appFehler = (data ?? []).filter((f: Record<string, unknown>) => {
      const zeit = Object.entries(f).find(([k, v]) => /(_am|zeit|created|datum)/i.test(k) && typeof v === 'string')?.[1]
      return !zeit || tag(zeit) >= g.von
    })
  } catch {
    appFehler = []
  }
  const euro = (usd: number) => Math.round(usd * USD_ZU_EUR * 100) / 100
  const jeTag: Record<string, number> = {}
  const jeAnlass: Record<string, number> = {}
  const jeModell: Record<string, number> = {}
  const jePerson: Record<string, number> = {}
  const emailZuName = new Map(g.team.map((m) => [m.email.toLowerCase(), m.name]))
  let summe = 0
  for (const k of ki) {
    const usd = Number(k.kosten_usd ?? 0)
    if (!Number.isFinite(usd)) continue
    summe += usd
    const d = tag(k.am)
    jeTag[d] = (jeTag[d] ?? 0) + usd
    const anlass = k.anlass || `${k.funktion} (ohne Anlass)`
    jeAnlass[anlass] = (jeAnlass[anlass] ?? 0) + usd
    jeModell[k.modell || 'unbekannt'] = (jeModell[k.modell || 'unbekannt'] ?? 0) + usd
    const person = k.person ? (emailZuName.get(String(k.person).toLowerCase()) ?? String(k.person)) : 'Automatisch (ohne Person)'
    jePerson[person] = (jePerson[person] ?? 0) + usd
  }
  const runde = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, euro(v)]))

  // Sprachnachrichten heute (Telegram) gegen die Tagesgrenze des kostenlosen Groq-Kontos.
  const heute = berlinZeit(jetzt).datum
  let sprachHeute = 0
  for (const m of g.team) sprachHeute += zuegeVon(m).filter((z) => z.gesprochen && berlinZeit(new Date(z.z)).datum === heute).length

  return {
    kosten: {
      summeEuro: euro(summe),
      aufrufe: ki.length,
      jeTag: runde(jeTag),
      jeAnlass: runde(jeAnlass),
      jeModell: runde(jeModell),
      jePerson: runde(jePerson),
      umrechnung: `1 $ ≈ ${String(USD_ZU_EUR).replace('.', ',')} €`,
    },
    fehler: {
      browser: appFehler.length,
      browserBeispiele: appFehler.slice(0, 20).map((f) => kurz(f.meldung ?? f.nachricht ?? f.message ?? f.text ?? JSON.stringify(f), 160)),
      server: wuensche.filter((w) => w.quelle === 'fehler').map((w) => ({ titel: w.titel, anzahl: w.anzahl, status: w.status, zuletzt: w.zuletzt_am })),
      offeneWuensche: wuensche.filter((w) => w.quelle !== 'fehler' && w.status !== 'erledigt').length,
    },
    postfaecher: postfaecher.map((p) => ({ adresse: p.adresse, art: p.besitzer_email ? 'persönlich' : 'gemeinsam', aktiv: p.aktiv, letzterAbruf: p.letzter_abruf, letzterFehler: p.letzter_fehler })),
    sprachnachrichten: { heute: sprachHeute, tagesgrenze: GROQ_TAGESGRENZE },
    hinweise: [
      'KI-Kosten sind je Anlass und Tag erfasst, nicht je Person.',
      'Sprachnachrichten heute: gezählt aus den Telegram-Gesprächen; Aufnahmen im CRM-Fenster sind nicht enthalten.',
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// Aktion superuser_auswertung
// ---------------------------------------------------------------------------------------------

export async function istSuperuser(admin: Db, email: string): Promise<boolean> {
  const { data } = await admin.from('mitarbeiter').select('ist_superuser, aktiv').ilike('email', email.replace(/[\\%_]/g, (z) => `\\${z}`)).maybeSingle()
  return !!data?.aktiv && !!data?.ist_superuser
}

export async function superuserAuswertung(req: Request, admin: Db, body: Record<string, unknown>): Promise<{ status: number; daten: unknown }> {
  const aufrufer = await ermittleAufrufer(req, admin, body)
  if (!aufrufer) return { status: 401, daten: { error: 'Bitte neu anmelden.' } }
  if (!(await istSuperuser(admin, aufrufer.email))) return { status: 403, daten: { error: 'Nur für Superuser.' } }
  const tage = [7, 30, 90].includes(Number(body.zeitraum)) ? Number(body.zeitraum) : 30
  const teil = String(body.teil ?? 'nutzung')
  const jetzt = new Date()
  const g = await ladeGrunddaten(admin, tage, jetzt)
  const kopf = { zeitraum: { von: g.von, bis: g.bis, tage }, personen: g.namen, messungSeit: MESSUNG_SEIT }
  if (teil === 'verlauf') {
    const person = String(body.person ?? '').trim()
    const bereich = String(body.bereich ?? '').trim()
    const liste = g.eintraege.filter((e) => (!person || e.wer === person) && (!bereich || e.bereich === bereich))
    const bereiche = [...new Set(g.eintraege.map((e) => e.bereich).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))
    return { status: 200, daten: { ...kopf, bereiche, gesamt: liste.length, eintraege: liste.slice(0, HOECHSTENS_VERLAUF) } }
  }
  if (teil === 'zahlen') return { status: 200, daten: { ...kopf, ...(await zahlen(admin, g, jetzt)) } }
  if (teil === 'technik') return { status: 200, daten: { ...kopf, ...(await technik(admin, g, jetzt)) } }
  return { status: 200, daten: { ...kopf, ...(await nutzung(admin, g)) } }
}

// ---------------------------------------------------------------------------------------------
// F Wochenbericht (freitags ab 16 Uhr, einmal, an alle Superuser mit Telegram)
// ---------------------------------------------------------------------------------------------

const BERICHT_ID = 'superuser_wochenbericht'

function minutenText(n: number): string {
  if (n < 60) return `${n} Min.`
  const h = Math.floor(n / 60)
  const m = n % 60
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`
}

export async function wochenberichtText(admin: Db, jetzt: Date): Promise<string> {
  const g = await ladeGrunddaten(admin, 7, jetzt)
  const [n, z, t] = [await nutzung(admin, g), await zahlen(admin, g, jetzt), await technik(admin, g, jetzt)]
  const datum = (d: string) => d.split('-').reverse().slice(0, 2).join('.') + '.'
  const zeilen: string[] = [`Superuser-Wochenbericht ${datum(g.von)}–${datum(g.bis)}`, '', 'Nutzung (Fakten, CRM-Minuten seit ' + MESSUNG_SEIT + ' gemessen):']
  for (const p of n.zeilen) {
    const aktionen = p.verlaufseintraege + p.mailsGesendet + p.termineAngelegt + p.todosErledigt
    zeilen.push(`- ${p.name}: ${p.aktiveTage} aktive Tage, ${minutenText(p.aktiveMinuten)} im CRM, ${aktionen} Aktionen (${p.verlaufseintraege} Einträge, ${p.mailsGesendet} Mails, ${p.termineAngelegt} Termine, ${p.todosErledigt} erledigte Aufgaben), ${p.assistentZuege} Gespräche mit dem Assistenten${p.sprachnachrichten ? `, davon ${p.sprachnachrichten} gesprochen` : ''}`)
  }
  const neu: Record<string, number> = {}
  for (const w of Object.values(z.neueAkten)) for (const [b, k] of Object.entries(w)) neu[b] = (neu[b] ?? 0) + k
  const neuSumme = Object.values(neu).reduce((s, k) => s + k, 0)
  zeilen.push('', `Neue Akten: ${neuSumme}${neuSumme ? ` (${Object.entries(neu).sort(([a], [b]) => a.localeCompare(b, 'de')).map(([b, k]) => `${b} ${k}`).join(', ')})` : ''}`)
  const anfr = Object.values(z.anfragen).reduce((s, a) => ({ e: s.e + a.erkannt, u: s.u + a.uebernommen }), { e: 0, u: 0 })
  zeilen.push(`Anfragen: ${anfr.e} neue Absender geprüft, ${anfr.u} als Akte übernommen`)
  if (z.antwortzeit.medianStunden != null) zeilen.push(`Antwortzeit auf erste Mails (Mitte): ${z.antwortzeit.medianStunden < 24 ? `${Math.round(z.antwortzeit.medianStunden)} Std.` : `${(z.antwortzeit.medianStunden / 24).toFixed(1).replace('.', ',')} Tage`}`)
  zeilen.push(`Offene Wünsche: ${t.fehler.offeneWuensche}`)
  zeilen.push(`KI-Kosten der Woche: ${t.kosten.summeEuro.toFixed(2).replace('.', ',')} € (${t.kosten.aufrufe} Aufrufe)`)
  const personen = Object.entries(t.kosten.jePerson).sort(([, a], [, b]) => b - a).slice(0, 5)
  for (const [name, betrag] of personen) zeilen.push(`  ${name}: ${betrag.toFixed(2).replace('.', ',')} €`)
  zeilen.push('', 'Alles im CRM unter Superuser.')
  return zeilen.join('\n')
}

/** Vom Minutentakt gerufen; außerhalb von Freitag ab 16 Uhr ohne Datenbankzugriff. Wirft nie. */
export async function pruefeSuperuserWochenbericht(admin: Db, sende: SendeFunktion, jetzt = new Date()): Promise<number> {
  try {
    const b = berlinZeit(jetzt)
    if (b.wochentag !== 5 || b.stunde < 16) return 0
    const { data: zeile } = await admin.from('abteilung_eintraege').select('daten').eq('id', BERICHT_ID).maybeSingle()
    const stand = alsObjekt(zeile?.daten) ?? {}
    if (stand.woche === b.datum) return 0
    const neu = { woche: b.datum, version: crypto.randomUUID() }
    if (!zeile) {
      const { error } = await admin.from('abteilung_eintraege').insert({ id: BERICHT_ID, art: BERICHT_ID, daten: neu, updated_at: jetzt.toISOString() })
      if (error) return 0
    } else {
      let q = admin.from('abteilung_eintraege').update({ daten: neu, updated_at: jetzt.toISOString() }).eq('id', BERICHT_ID)
      if (typeof stand.version === 'string') q = q.eq('daten->>version', stand.version)
      const { data: beansprucht } = await q.select('id')
      if (!Array.isArray(beansprucht) || beansprucht.length === 0) return 0
    }
    const text = await wochenberichtText(admin, jetzt)
    const team = await ladeTeam(admin)
    let gesendet = 0
    for (const m of team.filter((x) => x.ist_superuser && x.telegram_chat_id)) if (await sende(m.telegram_chat_id!, text)) gesendet++
    return gesendet
  } catch (err) {
    console.error('Superuser-Wochenbericht fehlgeschlagen:', err instanceof Error ? err.message : err)
    return 0
  }
}

/** Probelauf nur mit Dienstschlüssel: gibt den Text zurück, sendet nur mit `senden: true` (an Superuser). */
export async function superuserWochenberichtTest(req: Request, admin: Db, body: Record<string, unknown>, sende: SendeFunktion): Promise<{ status: number; daten: unknown }> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!istDienstSchluessel(token)) return { status: 401, daten: { error: 'Nur mit Dienstschlüssel.' } }
  const text = await wochenberichtText(admin, new Date())
  let gesendet = 0
  if (body.senden === true) {
    const team = await ladeTeam(admin)
    for (const m of team.filter((x) => x.ist_superuser && x.telegram_chat_id)) if (await sende(m.telegram_chat_id!, text)) gesendet++
  }
  return { status: 200, daten: { ok: true, text, gesendet } }
}
