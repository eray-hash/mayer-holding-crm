// Tagesplan auf dem Server: Daten eines Mitarbeiters für einen Tag laden und den Plan speichern — für den Assistenten
// (telegram-gateway/tagesplanWerkzeuge.ts) und die Meldungen morgens/abends (email-gateway/tagesplanMeldungen.ts).
// Läuft mit Dienstrechten; die Zeilenregeln der Datenbank bildet diese Datei nach:
// - To-dos: nur die eigene Liste (besitzer_email = Adresse, bereich leer), offen, zuständig leer oder die Person.
// - Termine: eigene und die, bei denen die Person Teilnehmer ist (wie der Kalender); abgesagte nicht.
// - Wiedervorlagen: offen, fällig bis zum Tag, verantwortlich die Person, nur aus Bereichen, die sie sehen darf.
// - Pläne: abteilung_eintraege art 'tagesplan', id `${name}|${datum}` (wie die Seite „Tagesablauf & Woche“).

import { alleZeilen } from './alleZeilen.ts'
import { istAbgesagterTitel } from './terminBriefingKern.ts'
import { alsBezug } from './tagesplanBezug.ts'
import { gehoertZu, type PlanTag, type PlanTermin, type PlanTodo, type PlanWiedervorlage, type PlanZeile } from './tagesplanKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type TagPerson = { name: string; email: string; rolle?: string | null; ist_admin?: boolean | null; bereiche?: string[] | null }

export type TagDaten = {
  todos: PlanTodo[]
  termine: PlanTermin[]
  wiedervorlagen: PlanWiedervorlage[]
  plan: PlanTag | null
  vortag: PlanTag | null
  /** Hinweise, wenn ein Teil nicht gelesen werden konnte (der Rest wird trotzdem genutzt). */
  fehler: string[]
}

const BERLIN_UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const BERLIN_TAG = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' })

export function berlinUhr(iso: string): string {
  return BERLIN_UHR.format(new Date(iso))
}
export function berlinTag(iso: string | Date): string {
  return BERLIN_TAG.format(typeof iso === 'string' ? new Date(iso) : iso)
}

/** Beginn eines Berliner Kalendertags als Zeitpunkt (Sommer-/Winterzeit richtig). */
export function berlinTagesbeginn(datum: string): Date {
  const [y, m, d] = datum.split('-').map(Number)
  let t = Date.UTC(y, m - 1, d)
  for (let i = 0; i < 2; i++) {
    const uhr = berlinUhr(new Date(t).toISOString()).split(':').map(Number)
    const tag = berlinTag(new Date(t))
    const [by, bm, bd] = tag.split('-').map(Number)
    const versatz = Date.UTC(by, bm - 1, bd, uhr[0], uhr[1]) - t
    t = Date.UTC(y, m - 1, d) - versatz
  }
  return new Date(t)
}

function plusTag(datum: string, n: number): string {
  const [y, m, d] = datum.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function planId(name: string, datum: string): string {
  return `${name}|${datum}`
}

/** Gespeicherten Plan in die vollständige Form bringen (ältere Pläne haben weniger Felder). */
export function alsPlan(daten: unknown): PlanTag | null {
  if (!daten || typeof daten !== 'object') return null
  const d = daten as Record<string, unknown>
  if (typeof d.id !== 'string' || typeof d.datum !== 'string' || typeof d.mitarbeiter !== 'string') return null
  return {
    ...(d as unknown as PlanTag),
    zeilen: Array.isArray(d.zeilen) ? (d.zeilen as PlanZeile[]).filter((z) => z && typeof z.id === 'string') : [],
    anrufe: typeof d.anrufe === 'string' ? d.anrufe : '',
  }
}

const TODO_SPALTEN = 'id, aufgabe, kunde_projekt, prio, unter_prio, umsatz_wert, geplante_zeit, erledigen_bis, geplante_wiedervorlage, erledigt_am, welche_fragen, reihenfolge, zustaendig'

// deno-lint-ignore no-explicit-any
export function alsPlanTodo(r: Record<string, any>): PlanTodo {
  return {
    id: r.id,
    aufgabe: String(r.aufgabe ?? ''),
    kundeProjekt: r.kunde_projekt ?? null,
    prio: r.prio ?? null,
    unterPrio: r.unter_prio === null || r.unter_prio === undefined ? null : Number(r.unter_prio),
    umsatzWert: r.umsatz_wert === null || r.umsatz_wert === undefined ? null : Number(r.umsatz_wert),
    geplanteZeit: r.geplante_zeit ?? null,
    erledigenBis: r.erledigen_bis ?? null,
    geplanteWiedervorlage: r.geplante_wiedervorlage ?? null,
    erledigtAm: r.erledigt_am ?? null,
    welcheFragen: r.welche_fragen ?? null,
    reihenfolge: r.reihenfolge ?? null,
    bezug: alsBezug(r.bezug),
  }
}

/** Offene To-dos der eigenen Liste, die der Person gehören. Ohne Spalte bezug (SQL noch nicht eingespielt) geht es ohne. */
export async function ladeEigeneTodos(db: Db, person: TagPerson, fehler: string[] = []): Promise<PlanTodo[]> {
  const email = person.email.trim().toLowerCase()
  const lies = (spalten: string) => alleZeilen(() => db.from('todos').select(spalten).eq('besitzer_email', email).is('bereich', null).is('erledigt_am', null))
  let r = await lies(`${TODO_SPALTEN}, bezug`)
  if (r.error && /bezug/.test(r.error.message)) r = await lies(TODO_SPALTEN)
  if (r.error) fehler.push(`To-dos nicht lesbar: ${r.error.message}`)
  // deno-lint-ignore no-explicit-any
  return (r.data as Record<string, any>[]).filter((t) => gehoertZu(t.zustaendig, person.name)).map(alsPlanTodo)
}

export async function ladeTermineDesTags(db: Db, email: string, datum: string, fehler: string[] = []): Promise<PlanTermin[]> {
  const beginn = berlinTagesbeginn(datum)
  const ende = berlinTagesbeginn(plusTag(datum, 1))
  const adresse = email.trim().toLowerCase()
  let data: unknown[] | null = null
  try {
    const r = await db
      .from('termine')
      .select('id, titel, ort, beginn, ende, ganztags, besitzer_email, teilnehmer, kunde_id, kunde_bereich, kunde_name')
      .lt('beginn', ende.toISOString())
      .gt('ende', beginn.toISOString())
      .or(`besitzer_email.eq.${adresse},teilnehmer.cs.{${adresse}}`)
      .order('beginn')
      .limit(200)
    if (r.error) throw new Error(r.error.message)
    data = r.data
  } catch (err) {
    fehler.push(`Termine nicht lesbar: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
  const raus: PlanTermin[] = []
  // deno-lint-ignore no-explicit-any
  for (const t of (data ?? []) as Record<string, any>[]) {
    const titel = String(t.titel ?? '')
    if (istAbgesagterTitel(titel)) continue
    const b = new Date(t.beginn)
    const e = new Date(t.ende)
    const beginntHeute = b >= beginn
    const endetHeute = e <= ende
    const p: PlanTermin = { id: t.id, titel, ganztags: !!t.ganztags || (!beginntHeute && !endetHeute), kundeName: t.kunde_name ?? null, ort: t.ort ?? null }
    if (!p.ganztags) {
      p.von = beginntHeute ? berlinUhr(t.beginn) : '00:00'
      p.bis = endetHeute ? berlinUhr(t.ende) : '23:59'
    }
    if (t.kunde_id) p.bezug = { art: 'kunde', id: t.kunde_id, name: t.kunde_name || t.kunde_id, ...(t.kunde_bereich ? { bereich: t.kunde_bereich } : {}) }
    raus.push(p)
  }
  return raus
}

function darfBereich(p: TagPerson, bereich: string | null | undefined): boolean {
  if (!bereich || bereich === 'intern') return true
  if (bereich === 'privat') return false
  if (p.rolle === 'geschaeftsfuehrung' || p.ist_admin) return true
  const kennung = bereich === 'immobilienkunden' ? 'immobilien' : bereich
  return Array.isArray(p.bereiche) && p.bereiche.includes(kennung)
}

export async function ladeWiedervorlagen(db: Db, person: TagPerson, datum: string, fehler: string[] = []): Promise<PlanWiedervorlage[]> {
  const { data, error } = await alleZeilen(() => db.from('wiedervorlagen').select('id, kunde_id, bereich, titel, faellig, verantwortlich').is('erledigt_am', null).lte('faellig', datum))
  if (error) {
    fehler.push(`Wiedervorlagen nicht lesbar: ${error.message}`)
    return []
  }
  // deno-lint-ignore no-explicit-any
  const meine = (data as Record<string, any>[]).filter((w) => String(w.verantwortlich ?? '').trim() && gehoertZu(w.verantwortlich, person.name) && darfBereich(person, w.bereich))
  const ids = [...new Set(meine.map((w) => w.kunde_id).filter(Boolean))]
  const namen = new Map<string, string>()
  if (ids.length) {
    const { data: akten } = await db.from('kunden').select('id, firma, ansprechpartner').in('id', ids)
    // deno-lint-ignore no-explicit-any
    for (const a of (akten ?? []) as Record<string, any>[]) namen.set(a.id, String(a.firma || a.ansprechpartner || a.id))
  }
  return meine.map((w) => {
    const name = namen.get(w.kunde_id) ?? null
    return { id: w.id, titel: String(w.titel ?? 'Wiedervorlage'), faellig: String(w.faellig).slice(0, 10), akteName: name, bezug: w.kunde_id ? { art: 'kunde' as const, id: w.kunde_id, name: name ?? w.kunde_id, ...(w.bereich ? { bereich: w.bereich } : {}) } : null }
  })
}

export async function ladePlan(db: Db, name: string, datum: string): Promise<PlanTag | null> {
  const { data } = await db.from('abteilung_eintraege').select('daten').eq('id', planId(name, datum)).eq('art', 'tagesplan').maybeSingle()
  return alsPlan(data?.daten)
}

/** Der letzte frühere Plan der Person (für die Übernahme des Offenen). */
export async function ladeVortag(db: Db, name: string, datum: string): Promise<PlanTag | null> {
  const { data } = await db
    .from('abteilung_eintraege')
    .select('daten')
    .eq('art', 'tagesplan')
    .gte('id', `${name}|`)
    .lt('id', planId(name, datum))
    .order('id', { ascending: false })
    .limit(1)
  return alsPlan(data?.[0]?.daten)
}

export async function ladeTagDaten(db: Db, person: TagPerson, datum: string): Promise<TagDaten> {
  const fehler: string[] = []
  const [todos, termine, wiedervorlagen, plan, vortag] = await Promise.all([
    ladeEigeneTodos(db, person, fehler),
    ladeTermineDesTags(db, person.email, datum, fehler),
    ladeWiedervorlagen(db, person, datum, fehler),
    ladePlan(db, person.name, datum),
    ladeVortag(db, person.name, datum),
  ])
  return { todos, termine, wiedervorlagen, plan, vortag, fehler }
}

/** Speichert den ganzen Plan (eine Zeile je Tag und Person). */
export async function speicherePlan(db: Db, plan: PlanTag): Promise<string | null> {
  const daten = { ...plan, aktualisiertAm: new Date().toISOString() }
  const { error } = await db.from('abteilung_eintraege').upsert({ id: plan.id, art: 'tagesplan', daten, updated_at: daten.aktualisiertAm })
  return error ? error.message : null
}

export function leererPlan(name: string, datum: string): PlanTag {
  return { id: planId(name, datum), mitarbeiter: name, datum, zeilen: [], anrufe: '', aktualisiertAm: new Date().toISOString() }
}
