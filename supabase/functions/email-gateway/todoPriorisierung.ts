// Automatische Priorisierung der To-do-Listen (Wunsch Eray, 21.11.2026: „beides kombiniert“ — automatisch UND per Knopf).
//
// Eine Liste = alle offenen Aufgaben (erledigt_am leer) EINER Bereichsliste (todos.bereich) oder EINER privaten Liste
// (bereich leer, derselbe besitzer_email). Die KI (Haiku, erzwungene Werkzeug-Antwort) vergibt je Aufgabe Prio A/B/C,
// einen Rang (→ reihenfolge) und einen kurzen Grund. Kriterien: Frist (erledigen_bis / geplante_wiedervorlage,
// Überfälliges zuerst), Warten auf andere (niedriger, außer schon erhalten), Umsatz, Kundenbezug, Aufwand, Alter.
//
// - Von Hand gesetzte Prio (prio_quelle = 'hand') bleibt; die KI sieht sie als feste Vorgabe und vergibt nur den Rang.
//   Von Hand gesetzte Aufgaben behalten untereinander ihre bisherige Reihenfolge (innerhalb derselben Prio).
// - Mit Microsoft To Do abgeglichene Aufgaben (ms_id): „A“ entspricht dort „wichtig“ (todoAbgleich.ts). Die Automatik
//   ändert daran nie etwas — ein A bleibt A, aus Nicht-A wird nie A. So schreibt die Priorisierung nie nach Microsoft
//   und kann den Abgleich nicht anstoßen (der Abgleich-Hash kennt nur „A oder nicht“, reihenfolge gar nicht).
// - Geschrieben werden nur Zeilen, deren Werte sich ändern (prio, reihenfolge, prio_quelle, prio_grund; dazu prio_am).
// - Listen mit mehr als MAX_OFFEN offenen Aufgaben werden nicht priorisiert (Antwort der KI zu lang, Kosten).
//
// Automatik (aus dem Minutentakt termin_erinnerungen, wirft nie):
//   a) Werktags (Mo–Fr, deutsche Zeit) beim ersten Takt ab 06:30 (bis 12 Uhr nachgeholt): alle Listen mit offenen
//      Aufgaben — außer solchen ohne Änderung seit dem letzten Lauf und ohne Frist in den nächsten 7 Tagen.
//   b) Alle 10 Minuten: nur Listen mit neuen Aufgaben (prio_quelle leer, in den letzten 3 Tagen geändert — auch
//      „wieder automatisch“ in der Oberfläche leert prio_quelle).
//   Buchhaltung in der Tabelle todo_prio_stand: Zeile „zeitplan“ (beanspruchter Morgen-Tag und 10-Minuten-Platz,
//   gesichert über die Spalte version wie bei wunsch_stand), Zeilen „liste:…“ (Zeitpunkt des letzten Laufs je Liste).
//   Eine Änderung erkennt der Lauf an todos.updated_at — der Auslöser todo_geaendert setzt es bei jeder inhaltlichen
//   Änderung, NICHT bei prio/reihenfolge/prio_grund/prio_am/ms_* (sonst zählte die eigene Priorisierung als Änderung).
//   prio_quelle zählt (von Hand gesetzt / wieder automatisch); der Stand je Liste wird erst nach dem Schreiben gesetzt.
//
// Keine Importe aus index.ts: Datenbank-Zugang und der KI-Aufruf kommen als Parameter.

import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const MODELL = 'claude-haiku-4-5-20251001' as const
export const MAX_OFFEN = 150
const STAND = 'todo_prio_stand'
const TAG_MS = 86_400_000

export type Liste = { bereich: string; besitzer?: undefined } | { bereich?: undefined; besitzer: string }

export type KiWerkzeug = <T>(
  prompt: string,
  tool: { name: string; description: string; input_schema: Record<string, unknown> },
  maxTokens: number,
  model: typeof MODELL,
  toolChoice: 'tool' | 'auto',
  timeoutMs: number,
) => Promise<T>

export type PrioHelfer = {
  /** callClaudeTool aus index.ts (Verbrauch wird dort gemessen). */
  callClaudeTool: KiWerkzeug
  /** Für Tests: fester Zeitpunkt. */
  jetzt?: Date
  /** Rahmen je Liste für die Kostenzuordnung (Anlass, Person, privat) — vom Zeitplan gesetzt. */
  imRahmen?: <T>(liste: Liste, arbeit: () => Promise<T>) => Promise<T>
}

export type TodoZeile = {
  id: string
  prio: string | null
  reihenfolge: number | null
  aufgabe: string | null
  kunde_projekt?: string | null
  aktueller_stand?: string | null
  naechste_schritte?: string | null
  welche_fragen?: string | null
  zustaendig?: string | null
  geplante_zeit?: string | null
  umsatz_wert?: number | string | null
  geplante_wiedervorlage?: string | null
  erledigen_bis?: string | null
  warten_auf?: string | null
  erhalten_am?: string | null
  erstellt_am?: string | null
  updated_at?: string | null
  prio_quelle?: string | null
  prio_grund?: string | null
  prio_am?: string | null
  ms_id?: string | null
}

const SPALTEN =
  'id, prio, reihenfolge, aufgabe, kunde_projekt, aktueller_stand, naechste_schritte, welche_fragen, zustaendig, geplante_zeit, umsatz_wert, geplante_wiedervorlage, erledigen_bis, warten_auf, erhalten_am, erstellt_am, updated_at, prio_quelle, prio_grund, prio_am, ms_id'

export type Anlass = 'knopf' | 'morgen' | 'neu'

export type PrioErgebnis =
  | { ok: true; offen: number; geaendert: number; gelaufen: boolean; grund?: string }
  | { ok: false; status: number; fehler: string }

// ---------- Hilfen ----------

const BERLIN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function berlinZeit(jetzt: Date): { datum: string; stunde: number; minute: number; wochentag: number } {
  const t: Record<string, string> = {}
  for (const p of BERLIN.formatToParts(jetzt)) t[p.type] = p.value
  const datum = `${t.year}-${t.month}-${t.day}`
  return { datum, stunde: Number(t.hour) % 24, minute: Number(t.minute), wochentag: new Date(`${datum}T12:00:00Z`).getUTCDay() }
}

/** Tage von `heute` bis `datum` (beide JJJJ-MM-TT); negativ = vorbei. null, wenn kein Datum. */
export function tageBis(datum: unknown, heute: string): number | null {
  const text = String(datum ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null
  const d = Date.parse(`${text.slice(0, 10)}T00:00:00Z`)
  const h = Date.parse(`${heute}T00:00:00Z`)
  return Number.isFinite(d) && Number.isFinite(h) ? Math.round((d - h) / TAG_MS) : null
}

function kuerze(wert: unknown, n: number): string {
  const text = String(wert ?? '').replace(/\s+/g, ' ').trim()
  return text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text
}

/** Grund auf höchstens 12 Wörter / 120 Zeichen. */
export function kurzerGrund(wert: unknown): string | null {
  const woerter = String(wert ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (woerter.length === 0) return null
  return kuerze(woerter.slice(0, 12).join(' '), 120)
}

export function listenSchluessel(l: Liste): string {
  return l.bereich ? `bereich:${l.bereich}` : `privat:${String(l.besitzer).toLowerCase()}`
}

const istHand = (z: TodoZeile) => z.prio_quelle === 'hand'
/** Feste Prio: von Hand gesetzt, oder in Microsoft To Do als wichtig markiert (A). */
const istFest = (z: TodoZeile) => istHand(z) || (!!z.ms_id && z.prio === 'A')

function prioGruppe(prio: string | null | undefined): number {
  const p = String(prio ?? '').trim().toUpperCase().charAt(0)
  return p === 'A' ? 0 : p === 'B' ? 1 : p === 'C' ? 2 : 3
}

function fristText(datum: unknown, heute: string, name: string): string {
  const tage = tageBis(datum, heute)
  if (tage === null) return datum ? `${name}: ${kuerze(datum, 20)}` : ''
  const wann = tage < 0 ? `seit ${-tage} ${-tage === 1 ? 'Tag' : 'Tagen'} überfällig` : tage === 0 ? 'heute' : tage === 1 ? 'morgen' : `in ${tage} Tagen`
  return `${name}: ${String(datum).slice(0, 10)} (${wann})`
}

// ---------- Prompt und Werkzeug ----------

export const PRIO_WERKZEUG = {
  name: 'priorisierung',
  description: 'Prio, Rang und kurzer Grund für jede Aufgabe der Liste.',
  input_schema: {
    type: 'object',
    properties: {
      eintraege: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nr: { type: 'integer', description: 'Nummer der Aufgabe aus der Liste' },
            prio: { type: 'string', enum: ['A', 'B', 'C'] },
            rang: { type: 'integer', description: '1 = zuerst erledigen; jeder Rang nur einmal' },
            grund: { type: 'string', description: 'höchstens 12 Wörter, Deutsch' },
          },
          required: ['nr', 'prio', 'rang', 'grund'],
        },
      },
    },
    required: ['eintraege'],
  },
}

export function bauePrompt(zeilen: TodoZeile[], heute: string): string {
  const zeilenText = zeilen.map((z, i) => {
    const teile = [`${i + 1} | ${kuerze(z.aufgabe, 140) || '(ohne Titel)'}`]
    if (istFest(z)) teile.push(`fest: ${String(z.prio ?? '').trim() || '–'}`)
    else if (z.ms_id) teile.push('A nicht möglich')
    if (z.kunde_projekt) teile.push(`Kunde/Projekt: ${kuerze(z.kunde_projekt, 60)}`)
    const bis = fristText(z.erledigen_bis, heute, 'erledigen bis')
    if (bis) teile.push(bis)
    const wv = fristText(z.geplante_wiedervorlage, heute, 'Wiedervorlage')
    if (wv) teile.push(wv)
    if (z.warten_auf) teile.push(`wartet auf: ${kuerze(z.warten_auf, 50)}${z.erhalten_am ? ` (erhalten ${kuerze(z.erhalten_am, 12)})` : ''}`)
    const umsatz = Number(z.umsatz_wert)
    if (Number.isFinite(umsatz) && umsatz > 0) teile.push(`Umsatz: ${Math.round(umsatz)} €`)
    if (z.geplante_zeit) teile.push(`Aufwand: ${kuerze(z.geplante_zeit, 20)}`)
    if (z.zustaendig) teile.push(`zuständig: ${kuerze(z.zustaendig, 30)}`)
    const alter = tageBis(z.erstellt_am, heute)
    if (alter !== null && alter < 0) teile.push(`angelegt vor ${-alter} Tagen`)
    if (z.aktueller_stand) teile.push(`Stand: ${kuerze(z.aktueller_stand, 90)}`)
    if (z.naechste_schritte) teile.push(`nächster Schritt: ${kuerze(z.naechste_schritte, 70)}`)
    return teile.join(' · ')
  })
  return [
    `Du ordnest eine To-do-Liste eines kleinen Beratungsunternehmens nach Wichtigkeit. Heute ist ${heute}.`,
    '',
    'Prio:',
    '- A = jetzt dran: überfällig oder Frist in den nächsten 3 Tagen, ein Kunde wartet, oder hoher Umsatz mit naher Frist.',
    '- B = wichtig, aber nicht eilig: Frist in den nächsten Wochen, Umsatz oder Kundenbezug.',
    '- C = kann warten: keine Frist, kein Umsatz, interne Kleinigkeit, oder es wird auf jemand anderen gewartet.',
    'Wartet eine Aufgabe auf jemand anderen („wartet auf“), ist sie niedriger — außer es wurde schon etwas erhalten.',
    '',
    'Rang: Jede Aufgabe bekommt einen eigenen Rang über die ganze Liste (1 = zuerst). Erst nach Dringlichkeit (Überfälliges',
    'und bald Fälliges vorn), dann Umsatz und Kundenbezug, dann kurzer Aufwand vor langem, dann ältere vor neueren.',
    'Der Rang soll zur Prio passen (alle A vor allen B vor allen C).',
    'Aufgaben mit „fest: X“ haben eine feste Prio X — gib dort genau X an und vergib nur einen passenden Rang.',
    'Bei „A nicht möglich“ nur B oder C vergeben.',
    'Grund: höchstens 12 Wörter auf Deutsch, ohne englische Wörter, z. B. „Frist morgen, Kunde wartet auf Angebot“.',
    '',
    'Gib für JEDE Nummer genau einen Eintrag zurück.',
    '',
    'Aufgaben (Nummer | Aufgabe · Angaben):',
    ...zeilenText,
  ].join('\n')
}

// ---------- Neue Ordnung berechnen (ohne Datenbank, testbar) ----------

export type Plan = { id: string; reihenfolge: number; prio: string | null; grund: string | null; hand: boolean }

/**
 * Aus der Antwort der KI die neue Ordnung: sortiert nach Prio-Gruppe (A, B, C, Rest), dann Rang der KI, dann bisheriger
 * Reihenfolge. Von Hand gesetzte Aufgaben behalten innerhalb ihrer Gruppe ihre bisherige Reihenfolge untereinander.
 * `zeilen` muss in der bisherigen Reihenfolge stehen (Nummer der KI = Position + 1). Wirft, wenn die Antwort nichts
 * Brauchbares enthält.
 */
export function berechneOrdnung(zeilen: TodoZeile[], antwort: unknown): Plan[] {
  const roh = antwort && typeof antwort === 'object' ? (antwort as { eintraege?: unknown }).eintraege : null
  const nachNr = new Map<number, { prio: string | null; rang: number | null; grund: string | null }>()
  for (const e of Array.isArray(roh) ? roh : []) {
    if (!e || typeof e !== 'object') continue
    const x = e as Record<string, unknown>
    const nr = Math.round(Number(x.nr))
    if (!Number.isFinite(nr) || nr < 1 || nr > zeilen.length || nachNr.has(nr)) continue
    const prio = typeof x.prio === 'string' && /^[ABC]$/.test(x.prio.trim().toUpperCase()) ? x.prio.trim().toUpperCase() : null
    const rang = Number(x.rang)
    nachNr.set(nr, { prio, rang: Number.isFinite(rang) ? rang : null, grund: kurzerGrund(x.grund) })
  }
  if (nachNr.size === 0) throw new Error('Die KI hat keine brauchbare Priorisierung geliefert.')

  const punkte = zeilen.map((z, i) => {
    const a = nachNr.get(i + 1)
    const fest = istFest(z)
    let prio = fest ? (z.prio ?? null) : (a?.prio ?? z.prio ?? null)
    if (!fest && z.ms_id && prio === 'A') prio = 'B' // Microsoft-„wichtig“ setzt die Automatik nie
    return { z, i, hand: istHand(z), prio, rang: a?.rang ?? 1e9 + i, grund: istHand(z) ? (z.prio_grund ?? null) : (a?.grund ?? z.prio_grund ?? null) }
  })
  const sortiert = [...punkte].sort((x, y) => prioGruppe(x.prio) - prioGruppe(y.prio) || x.rang - y.rang || x.i - y.i)

  // Von Hand gesetzte: je Gruppe dieselben Plätze, aber in ihrer bisherigen Reihenfolge.
  for (let g = 0; g <= 3; g++) {
    const plaetze = sortiert.map((p, k) => (p.hand && prioGruppe(p.prio) === g ? k : -1)).filter((k) => k >= 0)
    const inAlterFolge = plaetze.map((k) => sortiert[k]).sort((x, y) => x.i - y.i)
    plaetze.forEach((k, n) => (sortiert[k] = inAlterFolge[n]))
  }
  return sortiert.map((p, k) => ({ id: p.z.id, reihenfolge: k + 1, prio: p.prio, grund: p.grund, hand: p.hand }))
}

// ---------- Eine Liste priorisieren ----------

async function ladeOffene(admin: Db, liste: Liste): Promise<TodoZeile[]> {
  let q = admin.from('todos').select(SPALTEN).is('erledigt_am', null)
  q = liste.bereich ? q.eq('bereich', liste.bereich) : q.is('bereich', null).eq('besitzer_email', String(liste.besitzer).toLowerCase())
  const { data, error } = await q.order('reihenfolge', { ascending: true }).limit(MAX_OFFEN + 1)
  if (error) throw new Error(`Aufgaben nicht lesbar: ${error.message}`)
  const zeilen = (data ?? []) as TodoZeile[]
  // Bisherige Reihenfolge: reihenfolge aufsteigend, ohne Zahl ans Ende, dann nach Anlage.
  return zeilen.sort((a, b) => (a.reihenfolge ?? 1e9) - (b.reihenfolge ?? 1e9) || String(a.erstellt_am ?? '').localeCompare(String(b.erstellt_am ?? '')))
}

/** Lohnt sich ein Lauf? Knopf: immer. Neu: nur mit noch nie priorisierten Aufgaben. Morgen: bei Änderung seit dem
 *  letzten Lauf, neuen Aufgaben oder einer Frist in den nächsten 7 Tagen (Überfälliges eingeschlossen). */
async function lohntSich(admin: Db, liste: Liste, zeilen: TodoZeile[], anlass: Anlass, heute: string): Promise<string | null> {
  if (anlass === 'knopf') return null
  const neue = zeilen.some((z) => !istHand(z) && !z.prio_quelle)
  if (neue) return null
  if (anlass === 'neu') return 'keine neuen Aufgaben'
  const { data: stand } = await admin.from(STAND).select('am').eq('id', `liste:${listenSchluessel(liste)}`).maybeSingle()
  const zuletzt = Date.parse(String(stand?.am ?? ''))
  if (!Number.isFinite(zuletzt)) return null
  if (zeilen.some((z) => Date.parse(String(z.updated_at ?? '')) > zuletzt)) return null
  const nah = (d: unknown) => {
    const t = tageBis(d, heute)
    return t !== null && t <= 7
  }
  if (zeilen.some((z) => nah(z.erledigen_bis) || nah(z.geplante_wiedervorlage))) return null
  return 'seit dem letzten Lauf unverändert'
}

export async function priorisiereListe(admin: Db, liste: Liste, h: PrioHelfer, anlass: Anlass = 'knopf'): Promise<PrioErgebnis> {
  const jetzt = h.jetzt ?? new Date()
  const heute = berlinZeit(jetzt).datum
  const zeilen = await ladeOffene(admin, liste)
  if (zeilen.length > MAX_OFFEN) {
    return { ok: false, status: 422, fehler: `Die Liste hat mehr als ${MAX_OFFEN} offene Aufgaben — zu viele für die automatische Priorisierung. Bitte erledigte Aufgaben abhaken oder aufräumen.` }
  }
  if (zeilen.length === 0) return { ok: true, offen: 0, geaendert: 0, gelaufen: false, grund: 'keine offenen Aufgaben' }
  if (zeilen.every(istHand)) return { ok: true, offen: zeilen.length, geaendert: 0, gelaufen: false, grund: 'alle Prios von Hand gesetzt' }
  const auslassen = await lohntSich(admin, liste, zeilen, anlass, heute)
  if (auslassen) return { ok: true, offen: zeilen.length, geaendert: 0, gelaufen: false, grund: auslassen }

  const antwort = await h.callClaudeTool<unknown>(bauePrompt(zeilen, heute), PRIO_WERKZEUG, Math.min(8192, 400 + zeilen.length * 45), MODELL, 'tool', 90_000)
  const plan = berechneOrdnung(zeilen, antwort)

  const nachId = new Map(zeilen.map((z) => [z.id, z]))
  const jetztIso = jetzt.toISOString()
  let geaendert = 0
  for (const p of plan) {
    const z = nachId.get(p.id)!
    const aenderung: Record<string, unknown> = {}
    if (z.reihenfolge !== p.reihenfolge) aenderung.reihenfolge = p.reihenfolge
    if (!p.hand) {
      if ((z.prio ?? null) !== p.prio) aenderung.prio = p.prio
      if (z.prio_quelle !== 'auto') aenderung.prio_quelle = 'auto'
      if ((z.prio_grund ?? null) !== p.grund) aenderung.prio_grund = p.grund
    }
    if (Object.keys(aenderung).length === 0) continue
    aenderung.prio_am = jetztIso
    // Nur noch offene Aufgaben; eine inzwischen von Hand gesetzte Prio nie überschreiben.
    let q = admin.from('todos').update(aenderung).eq('id', p.id).is('erledigt_am', null)
    if (!p.hand) q = q.or('prio_quelle.is.null,prio_quelle.eq.auto')
    const { error } = await q
    if (error) console.error(`To-do-Priorisierung: ${p.id} nicht geschrieben:`, error.message)
    else geaendert++
  }
  const { error: standFehler } = await admin
    .from(STAND)
    .upsert({ id: `liste:${listenSchluessel(liste)}`, am: new Date().toISOString(), daten: { offen: zeilen.length, geaendert, anlass } })
  if (standFehler) console.error('To-do-Priorisierung: Stand nicht gespeichert:', standFehler.message)
  return { ok: true, offen: zeilen.length, geaendert, gelaufen: true }
}

// ---------- Automatik aus dem Minutentakt ----------

/** Aktive Mitarbeiter (Login-Adressen klein) — nur deren private Listen laufen automatisch. */
async function aktiveMitarbeiter(admin: Db): Promise<string[]> {
  const { data } = await admin.from('mitarbeiter').select('email').eq('aktiv', true)
  return [...new Set(((data ?? []) as { email?: string }[]).map((m) => String(m.email ?? '').trim().toLowerCase()).filter((e) => e.includes('@')))]
}

/** Alle Listen mit offenen Aufgaben: Bereichslisten und die privaten Listen der aktiven Mitarbeiter. */
async function alleListen(admin: Db): Promise<Liste[]> {
  // Seitenweise: offene Aufgaben können mehr als 1000 sein (die Datenbank liefert höchstens 1000 je Abfrage).
  const { data } = await alleZeilen(() => admin.from('todos').select('bereich').is('erledigt_am', null).neq('bereich', ''))
  const bereiche = [...new Set(((data ?? []) as { bereich?: string }[]).map((z) => z.bereich).filter((b): b is string => !!b))]
  return [...bereiche.sort().map((bereich) => ({ bereich })), ...(await aktiveMitarbeiter(admin)).map((besitzer) => ({ besitzer }))]
}

/** Listen mit neuen bzw. wieder automatisch gestellten Aufgaben (prio_quelle leer, in den letzten 3 Tagen geändert). */
async function listenMitNeuen(admin: Db, jetzt: Date): Promise<Liste[]> {
  // Seitenweise: nach einem Microsoft-Abgleich sind das schnell über 1000 (Hasan: 2.600) — sonst fehlten Listen.
  const { data } = await alleZeilen(() =>
    admin
      .from('todos')
      .select('bereich, besitzer_email')
      .is('erledigt_am', null)
      .is('prio_quelle', null)
      .gt('updated_at', new Date(jetzt.getTime() - 3 * TAG_MS).toISOString()),
  )
  const zeilen = (data ?? []) as { bereich?: string | null; besitzer_email?: string | null }[]
  if (zeilen.length === 0) return []
  const mitarbeiter = new Set(await aktiveMitarbeiter(admin))
  const gesehen = new Set<string>()
  const listen: Liste[] = []
  for (const z of zeilen) {
    const l: Liste | null = z.bereich ? { bereich: z.bereich } : z.besitzer_email && mitarbeiter.has(z.besitzer_email.toLowerCase()) ? { besitzer: z.besitzer_email.toLowerCase() } : null
    if (!l || gesehen.has(listenSchluessel(l))) continue
    gesehen.add(listenSchluessel(l))
    listen.push(l)
  }
  return listen
}

type ZeitplanStand = { morgen?: string; neu?: string }

export type ZeitplanErgebnis = { lauf: 'morgen' | 'neu' | null; listen: number; geaendert: number; fehler: number }

/** Vom Minutentakt gerufen. Außerhalb der Zeitfenster ohne Datenbankzugriff. Wirft nie. */
export async function pruefeTodoPriorisierung(admin: Db, h: PrioHelfer, budgetMs = 150_000): Promise<ZeitplanErgebnis> {
  const ergebnis: ZeitplanErgebnis = { lauf: null, listen: 0, geaendert: 0, fehler: 0 }
  try {
    const start = Date.now()
    const jetzt = h.jetzt ?? new Date()
    const b = berlinZeit(jetzt)
    const minuten = b.stunde * 60 + b.minute
    const morgenFenster = b.wochentag >= 1 && b.wochentag <= 5 && minuten >= 6 * 60 + 30 && b.stunde < 12
    const neuFenster = b.minute % 10 === 0
    if (!morgenFenster && !neuFenster) return ergebnis
    const platz = `${b.datum} ${String(b.stunde).padStart(2, '0')}:${String(b.minute).padStart(2, '0')}`

    // ---- Stand lesen und den Lauf beanspruchen ----
    const { data: zeile, error: lesefehler } = await admin.from(STAND).select('daten, version').eq('id', 'zeitplan').maybeSingle()
    if (lesefehler) throw new Error(`Stand nicht lesbar: ${lesefehler.message}`)
    const stand = (zeile?.daten && typeof zeile.daten === 'object' ? zeile.daten : {}) as ZeitplanStand
    const morgen = morgenFenster && stand.morgen !== b.datum
    const neu = !morgen && neuFenster && stand.neu !== platz
    if (!morgen && !neu) return ergebnis
    const daten: ZeitplanStand = { ...stand, ...(morgen ? { morgen: b.datum } : {}), neu: neuFenster ? platz : stand.neu }
    const version = crypto.randomUUID()
    const jetztIso = jetzt.toISOString()
    if (!zeile) {
      const { error } = await admin.from(STAND).insert({ id: 'zeitplan', am: jetztIso, version, daten })
      if (error) return ergebnis // ein gleichzeitiger Lauf hat die Zeile angelegt
    } else {
      let anspruch = admin.from(STAND).update({ am: jetztIso, version, daten }).eq('id', 'zeitplan')
      anspruch = zeile.version ? anspruch.eq('version', zeile.version) : anspruch.is('version', null)
      const { data: beansprucht, error } = await anspruch.select('id')
      if (error) throw new Error(`Stand nicht schreibbar: ${error.message}`)
      if (!Array.isArray(beansprucht) || beansprucht.length === 0) return ergebnis
    }
    ergebnis.lauf = morgen ? 'morgen' : 'neu'

    // ---- Listen priorisieren ----
    const listen = morgen ? await alleListen(admin) : await listenMitNeuen(admin, jetzt)
    for (const liste of listen) {
      if (Date.now() - start > budgetMs) {
        console.log(`To-do-Priorisierung: Zeit aufgebraucht, ${listen.length - ergebnis.listen} Liste(n) nicht mehr bearbeitet.`)
        break
      }
      ergebnis.listen++
      try {
        const arbeit = () => priorisiereListe(admin, liste, h, morgen ? 'morgen' : 'neu')
        const r = h.imRahmen ? await h.imRahmen(liste, arbeit) : await arbeit()
        if (r.ok) ergebnis.geaendert += r.geaendert
        else if (r.status !== 422) ergebnis.fehler++
      } catch (err) {
        ergebnis.fehler++
        console.error(`To-do-Priorisierung (${listenSchluessel(liste)}) fehlgeschlagen:`, err instanceof Error ? err.message : err)
      }
    }
  } catch (err) {
    console.error('To-do-Priorisierung fehlgeschlagen:', err instanceof Error ? err.message : err)
  }
  return ergebnis
}
