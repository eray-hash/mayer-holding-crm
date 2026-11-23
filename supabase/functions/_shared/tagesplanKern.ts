// Tagesplan („Tagesablauf klar definieren“, Quirins Vorlage vom 31.07.2026) — reine Regeln ohne Datenbank,
// gemeinsam für die Seite „Tagesablauf & Woche“ (src/pages/immobilien/Tagesablauf.tsx), den Assistenten
// (telegram-gateway/tagesplanWerkzeuge.ts) und die Telegram-Meldungen morgens/abends (email-gateway/tagesplanMeldungen.ts).
//
// Aufbau wie im Blatt: Organisatorisch → Fristsachen → A (ca. 2 Std.) → B (ca. 1,5 Std.) → C (ca. 1 Std., falls Zeit
// übrig) → viele kurze Arbeiten (ca. 1 Std.) → Unvorhergesehenes (ca. 2 Std. Puffer). „Fokus liegt auf Umsatz“: innerhalb
// gleicher Prio kommt zuerst, was mehr Geld bringt.
//
// Gespeichert wird ein Tag in abteilung_eintraege (art 'tagesplan', id `${mitarbeiter}|${datum}`) — dieselbe Form wie
// der Typ Tagesplan in src/types, um optionale Felder erweitert (todoId, Termin, Bezug, Stoppuhr …). Ältere Pläne ohne
// diese Felder bleiben gültig.

export type PlanBlock = 'organisation' | 'frist' | 'A' | 'B' | 'C' | 'kurz' | 'unvorhergesehen'

export const BLOCK_REIHENFOLGE: readonly PlanBlock[] = ['organisation', 'frist', 'A', 'B', 'C', 'kurz', 'unvorhergesehen']

/** Zeitbudget je Block in Minuten (Vorlage); null = ohne Grenze. */
export const BUDGET: Readonly<Record<PlanBlock, number | null>> = {
  organisation: null,
  frist: null,
  A: 120,
  B: 90,
  C: 60,
  kurz: 60,
  unvorhergesehen: 120,
}

export const BLOCK_TITEL: Readonly<Record<PlanBlock, string>> = {
  organisation: 'Organisatorisch',
  frist: 'Fristsachen',
  A: 'A-Aufgaben',
  B: 'B-Aufgaben',
  C: 'C-Aufgaben',
  kurz: 'Kurze Arbeiten',
  unvorhergesehen: 'Unvorhergesehenes',
}

/** Ohne Angabe „geplante Zeit“ rechnet der Vorschlag mit so vielen Minuten. */
export const STANDARD_MINUTEN = 30
/** Bis zu so vielen Minuten zählt eine Aufgabe als „kurze Arbeit“ (Vorlage: viele 3–7-Minuten-Arbeiten). */
export const KURZ_BIS = 10
/** Eine Wiedervorlage aus einer Akte (nachfassen, anrufen) braucht im Plan so lange. */
export const WIEDERVORLAGE_MINUTEN = 15
/** Offenes übernimmt der Vorschlag nur aus einem Plan, der höchstens so viele Tage zurückliegt (Freitag → Montag = 3,
 *  ein Feiertag dazu = 4). Ältere Pläne sind eher vergessen als offen — deren Reste kommen nicht mehr ungefragt mit. */
export const VORTAG_HOECHSTENS_TAGE = 4
/** Länger als einen Arbeitstag plant der Vorschlag keine einzelne Aufgabe ein. */
const HOECHSTENS_MINUTEN = 480
export const STANDARD_START = '08:30'

/** Stehen in jedem neuen Tag oben („wiederholte Aufgaben“). Den Tag aus dem Vortag kopieren macht jetzt das CRM. */
export const FESTE_AUFGABEN: readonly { was: string; dauerMin: number }[] = [
  { was: 'To-do-Liste überarbeiten', dauerMin: 20 },
  { was: 'Objektliste aktualisieren', dauerMin: 10 },
]

export type PlanBezug = { art: 'objekt' | 'kunde'; id: string; name: string; bereich?: string }

export type PlanZeile = {
  id: string
  block: PlanBlock
  was: string
  dauerMin?: number
  bisUhr?: string
  /** „Gewinn/Verlust“ der Vorlage: was es gebracht hat (freier Text). */
  ergebnis?: string
  /** Infos, aktueller Stand, Fragen, nächste Schritte. */
  stand?: string
  erledigt?: boolean
  /** Verknüpftes To-do (todos.id): Abhaken im Plan hakt auch das To-do ab. */
  todoId?: string
  /** Verknüpfte Wiedervorlage einer Akte (wiedervorlagen.id). */
  wvId?: string
  /** Termin aus dem Kalender (termine.id) — feste Zeit festVon–festBis. */
  terminId?: string
  festVon?: string
  festBis?: string
  /** Akte oder Objekt, um das es geht (Telefonnummern, „Anruf notieren“). */
  bezug?: PlanBezug
  /** Umsatz-Wert des To-dos beim Einplanen (Euro) — die Seite zeigt den aktuellen Wert des To-dos. */
  umsatz?: number
  /** Gestoppte Minuten an diesem Tag. */
  istMin?: number
  /** Stoppuhr läuft seit (ISO-Zeitpunkt). */
  laeuftSeit?: string
  /** Aus dem Plan dieses Tages übernommen (offen geblieben). */
  ausVortag?: string
  /** Von Hand / per Telegram dazugekommen (sonst: vom Vorschlag). */
  quelle?: 'vorschlag' | 'hand' | 'telegram'
}

export type PlanTag = {
  id: string
  mitarbeiter: string
  datum: string
  ort?: string
  zeilen: PlanZeile[]
  anrufe: string
  aktualisiertAm: string
  /** Arbeitsbeginn für die Zeitleiste, z. B. "08:30". */
  startUhr?: string
  /** Wann „Tag vorschlagen“ zuletzt lief (ISO). */
  vorgeschlagenAm?: string
}

/** Was der Vorschlag von einem To-do braucht (Spalten wie in der Tabelle todos). */
export type PlanTodo = {
  id: string
  aufgabe: string
  kundeProjekt?: string | null
  prio?: string | null
  unterPrio?: number | null
  umsatzWert?: number | null
  geplanteZeit?: string | null
  erledigenBis?: string | null
  geplanteWiedervorlage?: string | null
  erledigtAm?: string | null
  welcheFragen?: string | null
  reihenfolge?: number | null
  bezug?: PlanBezug | null
}

/** Termin des Tages, Uhrzeiten schon in deutscher Ortszeit ("HH:MM"). */
export type PlanTermin = {
  id: string
  titel: string
  von?: string
  bis?: string
  ganztags: boolean
  kundeName?: string | null
  ort?: string | null
  bezug?: PlanBezug | null
}

export type PlanWiedervorlage = { id: string; titel: string; faellig: string; akteName?: string | null; bezug?: PlanBezug | null }

// ── kleine Hilfen ─────────────────────────────────────────────────────────────────────────────────

const zwei = (n: number) => String(n).padStart(2, '0')

export function uhrZuMinuten(uhr: string | null | undefined): number | null {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(uhr ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h <= 24 && min < 60 ? h * 60 + min : null
}

export function minutenZuUhr(minuten: number): string {
  const m = Math.max(0, Math.round(minuten))
  return `${zwei(Math.floor(m / 60) % 24)}:${zwei(m % 60)}`
}

/** Datum aus Text (JJJJ-MM-TT…, TT.MM.JJ, TT.MM.JJJJ) als JJJJ-MM-TT; leer, wenn nichts zu erkennen ist. */
export function datumAus(wert: unknown): string {
  const s = String(wert ?? '').trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s)
  if (de) return `${de[3].length === 2 ? `20${de[3]}` : de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`
  return ''
}

export function tageZwischen(von: string, bis: string): number {
  const a = Date.parse(`${von}T12:00:00Z`)
  const b = Date.parse(`${bis}T12:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : Infinity
}

/** „geplante Zeit“ (freier Text) → Minuten. "45", "45 min", "1,5 Std", "2h" — sonst null. */
export function minutenAusText(wert: unknown): number | null {
  if (typeof wert === 'number') return Number.isFinite(wert) && wert > 0 ? Math.min(Math.round(wert), HOECHSTENS_MINUTEN) : null
  const s = String(wert ?? '').trim().toLowerCase().replace(',', '.')
  const m = /^(\d+(?:\.\d+)?)\s*(min\.?|minuten|m|std\.?|stunden|stunde|h)?$/.exec(s)
  if (!m) return null
  const zahl = Number(m[1])
  if (!Number.isFinite(zahl) || zahl <= 0) return null
  const stunden = m[2] && /^(std|stunde|h)/.test(m[2])
  return Math.min(Math.round(stunden ? zahl * 60 : zahl), HOECHSTENS_MINUTEN)
}

export function dauerVonTodo(t: Pick<PlanTodo, 'geplanteZeit'>): number {
  return minutenAusText(t.geplanteZeit) ?? STANDARD_MINUTEN
}

/** 0 = A … 3 = D, 4 = ohne Prio. */
export function prioRang(prio: string | null | undefined): number {
  const p = String(prio ?? '').trim().toUpperCase().charAt(0)
  const i = ['A', 'B', 'C', 'D'].indexOf(p)
  return i < 0 ? 4 : i
}

/** Reihenfolge der Kandidaten: Prio, dann Umsatz (mehr zuerst — „Fokus Umsatz“), dann Unter-Prio, dann Listenreihenfolge. */
export function vergleicheTodos(a: PlanTodo, b: PlanTodo): number {
  return (
    prioRang(a.prio) - prioRang(b.prio) ||
    (b.umsatzWert ?? -1) - (a.umsatzWert ?? -1) ||
    (a.unterPrio ?? 9999) - (b.unterPrio ?? 9999) ||
    (a.reihenfolge ?? 99999) - (b.reihenfolge ?? 99999) ||
    a.aufgabe.localeCompare(b.aufgabe, 'de')
  )
}

export function todoText(t: Pick<PlanTodo, 'aufgabe' | 'kundeProjekt'>): string {
  const aufgabe = String(t.aufgabe ?? '').trim()
  const kunde = String(t.kundeProjekt ?? '').trim()
  return kunde && !aufgabe.toLowerCase().includes(kunde.toLowerCase()) ? `${aufgabe} (${kunde})` : aufgabe
}

export function textSchluessel(text: string): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Gehört ein To-do mit dieser Angabe „zuständig“ in den Tag dieser Person? Leer = ja (eigene Liste). Sonst muss der
 *  volle Name, der Vorname oder der Nachname darin stehen („Quirin Lutzenberger, Hasan Süslü“ → beide). */
export function gehoertZu(zustaendig: string | null | undefined, name: string): boolean {
  const text = textSchluessel(String(zustaendig ?? ''))
  if (!text) return true
  const n = textSchluessel(name)
  if (!n) return true
  if (text.includes(n)) return true
  const teile = n.split(/\s+/).filter((t) => t.length >= 3)
  const woerter = text.split(/[^\p{L}]+/u)
  return teile.some((t) => woerter.includes(t))
}

/** Ist das To-do am Tag fällig (Frist erreicht oder Wiedervorlage erreicht)? */
export function istFaellig(t: PlanTodo, datum: string): boolean {
  const bis = datumAus(t.erledigenBis)
  const wv = datumAus(t.geplanteWiedervorlage)
  return (bis !== '' && bis <= datum) || (wv !== '' && wv <= datum)
}

function istOffen(t: PlanTodo): boolean {
  return !String(t.erledigtAm ?? '').trim() && String(t.aufgabe ?? '').trim() !== ''
}

function zielBlock(prio: string | null | undefined): 'A' | 'B' | 'C' {
  const r = prioRang(prio)
  return r === 0 ? 'A' : r === 1 ? 'B' : 'C'
}

// ── Vorschlag für einen Tag ───────────────────────────────────────────────────────────────────────

export type VorschlagEingabe = {
  datum: string
  todos: PlanTodo[]
  termine?: PlanTermin[]
  wiedervorlagen?: PlanWiedervorlage[]
  /** Zeilen des letzten früheren Plans und dessen Datum — Offenes wird übernommen. */
  vortag?: { datum: string; zeilen: PlanZeile[] } | null
  /** Was schon im Plan des Tages steht — bleibt unverändert und zählt gegen die Budgets. */
  bestehend?: PlanZeile[]
  neueId?: () => string
}

export type VorschlagErgebnis = {
  zeilen: PlanZeile[]
  /** Offene To-dos, die heute nicht mehr in die Budgets passten (fürs „Später“). */
  nichtEingeplant: PlanTodo[]
  /** So viele Zeilen sind neu dazugekommen. */
  neu: number
}

let zaehler = 0
function standardId(): string {
  zaehler += 1
  return `tz_${Date.now().toString(36)}_${zaehler.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function minutenImBlock(zeilen: PlanZeile[], block: PlanBlock): number {
  return zeilen.filter((z) => z.block === block).reduce((s, z) => s + (z.dauerMin ?? 0), 0)
}

/** Offenes aus dem letzten Plan für den neuen Tag: ohne Häkchen, Ergebnis und Stoppuhr; Stand bleibt.
 *  Nicht übernommen werden Termine, die festen Aufgaben, Wiedervorlagen (die kommen frisch aus der Akte)
 *  und Zeilen, deren To-do inzwischen erledigt ist oder fehlt. */
export function uebertrag(vortag: { datum: string; zeilen: PlanZeile[] }, todosById: Map<string, PlanTodo>, neueId: () => string = standardId): PlanZeile[] {
  const feste = new Set(FESTE_AUFGABEN.map((f) => textSchluessel(f.was)))
  const raus: PlanZeile[] = []
  for (const z of vortag.zeilen ?? []) {
    if (z.erledigt || !String(z.was ?? '').trim()) continue
    if (z.terminId || z.wvId || z.block === 'organisation' || feste.has(textSchluessel(z.was))) continue
    if (z.todoId) {
      const t = todosById.get(z.todoId)
      if (!t || !istOffen(t)) continue
    }
    const neu: PlanZeile = { id: neueId(), block: z.block, was: z.was, ausVortag: z.ausVortag ?? vortag.datum }
    for (const k of ['dauerMin', 'stand', 'todoId', 'bezug', 'umsatz', 'quelle'] as const) {
      if (z[k] !== undefined) (neu as Record<string, unknown>)[k] = z[k]
    }
    raus.push(neu)
  }
  return raus
}

/** Baut den Tag: feste Aufgaben, Termine (feste Zeit), Fristsachen (fällige/überfällige To-dos und Wiedervorlagen),
 *  Offenes vom letzten Plan, dann A/B/C nach Prio und Umsatz innerhalb der Budgets, kurze Arbeiten (≤ 10 Min.)
 *  getrennt. Unvorhergesehenes bleibt frei. Bestehende Zeilen bleiben, wie sie sind; nichts kommt doppelt. */
export function schlageTagVor(e: VorschlagEingabe): VorschlagErgebnis {
  const neueId = e.neueId ?? standardId
  const bestehend = (e.bestehend ?? []).filter((z) => String(z.was ?? '').trim())
  const todos = e.todos.filter(istOffen)
  const todosById = new Map(e.todos.map((t) => [t.id, t]))
  const zeilen: PlanZeile[] = [...bestehend]
  const imPlanTodo = new Set(zeilen.map((z) => z.todoId).filter(Boolean) as string[])
  const imPlanTermin = new Set(zeilen.map((z) => z.terminId).filter(Boolean) as string[])
  const imPlanWv = new Set(zeilen.map((z) => z.wvId).filter(Boolean) as string[])
  const imPlanText = new Set(zeilen.map((z) => textSchluessel(z.was)))
  let neu = 0

  const dazu = (z: PlanZeile): boolean => {
    const s = textSchluessel(z.was)
    if (!s || imPlanText.has(s)) return false
    if (z.todoId && imPlanTodo.has(z.todoId)) return false
    if (z.terminId && imPlanTermin.has(z.terminId)) return false
    if (z.wvId && imPlanWv.has(z.wvId)) return false
    imPlanText.add(s)
    if (z.todoId) imPlanTodo.add(z.todoId)
    if (z.terminId) imPlanTermin.add(z.terminId)
    if (z.wvId) imPlanWv.add(z.wvId)
    zeilen.push(z)
    neu += 1
    return true
  }

  // 1. Organisatorisch (nur wenn der Block noch leer ist).
  if (!zeilen.some((z) => z.block === 'organisation')) {
    for (const f of FESTE_AUFGABEN) dazu({ id: neueId(), block: 'organisation', was: f.was, dauerMin: f.dauerMin, quelle: 'vorschlag' })
  }

  // 2. Termine mit fester Zeit (nach Beginn; ganztägige zuerst).
  const termine = [...(e.termine ?? [])].sort((a, b) => (a.ganztags === b.ganztags ? (a.von ?? '').localeCompare(b.von ?? '') : a.ganztags ? -1 : 1))
  for (const t of termine) {
    const titel = String(t.titel ?? '').trim() || 'Termin'
    const kunde = String(t.kundeName ?? '').trim()
    const zeit = t.ganztags || !t.von ? 'ganztägig' : `${t.von}${t.bis ? `–${t.bis}` : ''} Uhr`
    const von = uhrZuMinuten(t.von)
    const bis = uhrZuMinuten(t.bis)
    const z: PlanZeile = { id: neueId(), block: 'frist', was: `${zeit}: ${titel}${kunde && !titel.includes(kunde) ? ` (${kunde})` : ''}`, terminId: t.id, quelle: 'vorschlag' }
    if (!t.ganztags && t.von) {
      z.festVon = t.von
      if (t.bis) z.festBis = t.bis
      if (von !== null && bis !== null && bis > von) z.dauerMin = bis - von
    }
    if (t.bezug) z.bezug = t.bezug
    dazu(z)
  }

  // 3. Offenes vom letzten Plan (höchstens VORTAG_HOECHSTENS_TAGE alt) — fällig gewordene To-dos wandern in die Fristsachen.
  const vortagNah = e.vortag && tageZwischen(e.vortag.datum, e.datum) <= VORTAG_HOECHSTENS_TAGE
  const uebernommen = e.vortag && vortagNah ? uebertrag(e.vortag, todosById, neueId) : []
  for (const z of uebernommen) {
    const t = z.todoId ? todosById.get(z.todoId) : undefined
    if (t && istFaellig(t, e.datum)) z.block = 'frist'
    dazu(z)
  }

  // 4. Fristsachen: fällige und überfällige To-dos (älteste Frist zuerst), dann Wiedervorlagen aus den Akten.
  const faellig = todos
    .filter((t) => istFaellig(t, e.datum))
    .sort((a, b) => {
      const fa = [datumAus(a.erledigenBis), datumAus(a.geplanteWiedervorlage)].filter(Boolean).sort()[0] ?? ''
      const fb = [datumAus(b.erledigenBis), datumAus(b.geplanteWiedervorlage)].filter(Boolean).sort()[0] ?? ''
      return fa.localeCompare(fb) || vergleicheTodos(a, b)
    })
  for (const t of faellig) dazu(ausTodo(t, 'frist', neueId, e.datum))
  for (const w of [...(e.wiedervorlagen ?? [])].filter((w) => w.faellig && w.faellig <= e.datum).sort((a, b) => a.faellig.localeCompare(b.faellig))) {
    const akte = String(w.akteName ?? '').trim()
    const z: PlanZeile = { id: neueId(), block: 'frist', was: akte ? `${w.titel} (${akte})` : w.titel, wvId: w.id, dauerMin: WIEDERVORLAGE_MINUTEN, quelle: 'vorschlag' }
    if (w.bezug) z.bezug = w.bezug
    if (w.faellig < e.datum) z.stand = `Wiedervorlage seit ${w.faellig.slice(8, 10)}.${w.faellig.slice(5, 7)}.`
    dazu(z)
  }

  // 5. Der Rest nach Prio und Umsatz in A/B/C bzw. kurze Arbeiten — solange das Budget reicht.
  const rest = todos.filter((t) => !imPlanTodo.has(t.id)).sort(vergleicheTodos)
  const nichtEingeplant: PlanTodo[] = []
  for (const t of rest) {
    const dauer = dauerVonTodo(t)
    if (dauer <= KURZ_BIS) {
      if (minutenImBlock(zeilen, 'kurz') + dauer <= (BUDGET.kurz ?? 0)) dazu(ausTodo(t, 'kurz', neueId, e.datum))
      else nichtEingeplant.push(t)
      continue
    }
    const ziel = zielBlock(t.prio)
    const reihe: ('A' | 'B' | 'C')[] = ziel === 'A' ? ['A', 'B', 'C'] : ziel === 'B' ? ['B', 'C'] : ['C']
    let platz: 'A' | 'B' | 'C' | null = null
    for (const b of reihe) {
      const belegt = minutenImBlock(zeilen, b)
      // Ein leerer Block nimmt auch eine Aufgabe, die allein länger dauert als sein Budget.
      if (belegt + dauer <= (BUDGET[b] ?? 0) || !zeilen.some((z) => z.block === b)) {
        platz = b
        break
      }
    }
    if (platz) dazu(ausTodo(t, platz, neueId, e.datum))
    else nichtEingeplant.push(t)
  }

  return { zeilen: ordneNachBloecken(zeilen), nichtEingeplant, neu }
}

function ausTodo(t: PlanTodo, block: PlanBlock, neueId: () => string, datum: string): PlanZeile {
  const z: PlanZeile = { id: neueId(), block, was: todoText(t), todoId: t.id, dauerMin: dauerVonTodo(t), quelle: 'vorschlag' }
  if (t.umsatzWert !== null && t.umsatzWert !== undefined && t.umsatzWert > 0) z.umsatz = t.umsatzWert
  if (t.bezug) z.bezug = t.bezug
  const bis = datumAus(t.erledigenBis)
  const wv = datumAus(t.geplanteWiedervorlage)
  const tm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`
  if (bis) z.stand = bis < datum ? `überfällig seit ${tm(bis)}` : bis === datum ? 'Frist heute' : `Frist ${tm(bis)}`
  else if (wv && wv <= datum) z.stand = wv < datum ? `Wiedervorlage seit ${tm(wv)}` : 'Wiedervorlage heute'
  return z
}

/** Zeilen in Blockreihenfolge, innerhalb eines Blocks in der bisherigen Reihenfolge. */
export function ordneNachBloecken<T extends { block: string }>(zeilen: T[]): T[] {
  return BLOCK_REIHENFOLGE.flatMap((b) => zeilen.filter((z) => z.block === b)).concat(zeilen.filter((z) => !BLOCK_REIHENFOLGE.includes(z.block as PlanBlock)))
}

// ── Zeitleiste ────────────────────────────────────────────────────────────────────────────────────

export type ZeitEintrag = { id: string; von: number; bis: number; fest: boolean }

/** Von–bis je Zeile: Termine stehen fest, alles andere läuft der Reihe nach ab startUhr und weicht Terminen aus
 *  (eine Aufgabe, die in einen Termin hineinreichen würde, beginnt nach dem Termin). Zeilen ohne Dauer zählen mit
 *  STANDARD_MINUTEN; ganztägige Termine bekommen keinen Platz. Ergebnis nach Beginn sortiert, dazu das Ende des Tages
 *  ohne Puffer. */
export function zeitplan(zeilen: PlanZeile[], startUhr: string = STANDARD_START): { eintraege: ZeitEintrag[]; ende: number } {
  const start = uhrZuMinuten(startUhr) ?? (uhrZuMinuten(STANDARD_START) as number)
  const feste: ZeitEintrag[] = []
  for (const z of zeilen) {
    const von = uhrZuMinuten(z.festVon)
    if (von === null) continue
    const bis = uhrZuMinuten(z.festBis) ?? von + (z.dauerMin ?? STANDARD_MINUTEN)
    feste.push({ id: z.id, von, bis: Math.max(bis, von), fest: true })
  }
  feste.sort((a, b) => a.von - b.von)
  const eintraege: ZeitEintrag[] = [...feste]
  let zeiger = start
  for (const z of ordneNachBloecken(zeilen)) {
    // Feste Termine stehen schon drin; ganztägige Termine belegen keine Zeit in der Leiste.
    if (uhrZuMinuten(z.festVon) !== null || z.terminId || !String(z.was ?? '').trim()) continue
    const dauer = z.dauerMin && z.dauerMin > 0 ? z.dauerMin : STANDARD_MINUTEN
    let verschoben = true
    while (verschoben) {
      verschoben = false
      for (const f of feste) {
        if (f.von < zeiger + dauer && f.bis > zeiger) {
          zeiger = f.bis
          verschoben = true
        }
      }
    }
    eintraege.push({ id: z.id, von: zeiger, bis: zeiger + dauer, fest: false })
    zeiger += dauer
  }
  eintraege.sort((a, b) => a.von - b.von || (a.fest ? -1 : 1))
  const ende = eintraege.reduce((m, x) => Math.max(m, x.bis), start)
  return { eintraege, ende }
}

/** „Jetzt dran“: ein gerade laufender Termin, der nicht abgehakt ist — sonst die erste offene Aufgabe der Zeitleiste
 *  (wer hinterher ist, sieht die nächste fällige, nicht die nach Uhrzeit). Termine, die noch kommen, überspringt sie. */
export function jetztDran(zeilen: PlanZeile[], plan: { eintraege: ZeitEintrag[] }, jetztMinuten: number): string | null {
  const nachId = new Map(zeilen.map((z) => [z.id, z]))
  for (const e of plan.eintraege) {
    if (e.fest && e.von <= jetztMinuten && jetztMinuten < e.bis && !nachId.get(e.id)?.erledigt) return e.id
  }
  for (const e of plan.eintraege) {
    if (e.fest) continue
    if (!nachId.get(e.id)?.erledigt) return e.id
  }
  return null
}

// ── Stoppuhr ──────────────────────────────────────────────────────────────────────────────────────

/** Gelaufene Minuten seit laeuftSeit (mindestens 1, wenn sie lief). */
export function gelaufeneMinuten(laeuftSeit: string | undefined, jetzt: Date): number {
  if (!laeuftSeit) return 0
  const ms = jetzt.getTime() - new Date(laeuftSeit).getTime()
  // Über Nacht vergessene Stoppuhr: höchstens 12 Stunden zählen.
  return Number.isFinite(ms) && ms > 0 ? Math.min(12 * 60, Math.max(1, Math.round(ms / 60000))) : 0
}

/** Stoppt die Stoppuhr einer Zeile: istMin erhöht, laeuftSeit weg. Gibt die neue Zeile und die dazugekommenen Minuten. */
export function stoppe(z: PlanZeile, jetzt: Date): { zeile: PlanZeile; minuten: number } {
  if (!z.laeuftSeit) return { zeile: z, minuten: 0 }
  const minuten = gelaufeneMinuten(z.laeuftSeit, jetzt)
  const zeile: PlanZeile = { ...z, istMin: (z.istMin ?? 0) + minuten }
  delete zeile.laeuftSeit
  return { zeile, minuten }
}

// ── Bilanz ────────────────────────────────────────────────────────────────────────────────────────

export type Bilanz = {
  anzahl: number
  erledigt: number
  minutenGeplant: number
  minutenErledigt: number
  minutenIst: number
  umsatzMoeglich: number
  umsatzErledigt: number
}

/** Kennzahlen des Tages. umsatzVon liefert den aktuellen Umsatz-Wert einer Zeile (Standard: der beim Einplanen gemerkte). */
export function bilanz(zeilen: PlanZeile[], umsatzVon: (z: PlanZeile) => number | undefined = (z) => z.umsatz): Bilanz {
  const b: Bilanz = { anzahl: 0, erledigt: 0, minutenGeplant: 0, minutenErledigt: 0, minutenIst: 0, umsatzMoeglich: 0, umsatzErledigt: 0 }
  const gezaehlteTodos = new Set<string>()
  for (const z of zeilen) {
    if (!String(z.was ?? '').trim()) continue
    b.anzahl += 1
    b.minutenGeplant += z.dauerMin ?? 0
    b.minutenIst += z.istMin ?? 0
    // Ein To-do zweimal im Plan zählt beim Umsatz nur einmal.
    const doppelt = z.todoId ? gezaehlteTodos.has(z.todoId) : false
    if (z.todoId) gezaehlteTodos.add(z.todoId)
    const u = doppelt ? 0 : Math.max(0, umsatzVon(z) ?? 0)
    b.umsatzMoeglich += u
    if (z.erledigt) {
      b.erledigt += 1
      b.minutenErledigt += z.dauerMin ?? 0
      b.umsatzErledigt += u
    }
  }
  return b
}

/** Offene Zeilen eines Plans (für die Abendmeldung) — ohne Termine und feste Aufgaben. */
export function offeneZeilen(zeilen: PlanZeile[]): PlanZeile[] {
  const feste = new Set(FESTE_AUFGABEN.map((f) => textSchluessel(f.was)))
  return ordneNachBloecken(zeilen).filter((z) => !z.erledigt && String(z.was ?? '').trim() && !z.terminId && z.block !== 'organisation' && !feste.has(textSchluessel(z.was)))
}

// ── Texte (Telegram) ──────────────────────────────────────────────────────────────────────────────

export function euro(n: number): string {
  if (n >= 1000) {
    const k = n / 1000
    return `${k.toLocaleString('de-DE', { maximumFractionDigits: k >= 100 ? 0 : 1 })} Tsd. €`
  }
  return `${Math.round(n).toLocaleString('de-DE')} €`
}

export function dauerText(minuten: number): string {
  const std = Math.floor(minuten / 60)
  const min = minuten % 60
  if (std === 0) return `${min} Min.`
  return min === 0 ? `${std} Std.` : `${std} Std. ${min} Min.`
}

function zeileKurz(z: PlanZeile, nummer?: string): string {
  const teile = [z.festVon ? `${z.festVon}${z.festBis ? `–${z.festBis}` : ''}` : '', nummer ?? '', z.was].filter(Boolean)
  const zusatz = [z.umsatz ? euro(z.umsatz) : '', z.ausVortag ? 'von gestern' : ''].filter(Boolean)
  return `• ${teile.join(' ')}${zusatz.length ? ` (${zusatz.join(', ')})` : ''}`
}

/** Morgennachricht „Dein Tag“: Termine, Fristsachen, A-Aufgaben, Zahl der übrigen, möglicher Umsatz, Link. */
export function morgenText(plan: Pick<PlanTag, 'zeilen' | 'datum'>, opts: { link?: string; wochentag?: string } = {}): string | null {
  const zeilen = ordneNachBloecken(plan.zeilen.filter((z) => String(z.was ?? '').trim() && !z.erledigt))
  if (zeilen.length === 0) return null
  const termine = zeilen.filter((z) => z.terminId)
  const frist = zeilen.filter((z) => z.block === 'frist' && !z.terminId)
  const a = zeilen.filter((z) => z.block === 'A')
  const sonst = zeilen.filter((z) => ['B', 'C', 'kurz', 'unvorhergesehen'].includes(z.block)).length
  const b = bilanz(plan.zeilen)
  const kopf = `☀️ Dein Tag${opts.wochentag ? ` – ${opts.wochentag}` : ''}, ${plan.datum.slice(8, 10)}.${plan.datum.slice(5, 7)}.`
  const teile: string[] = [kopf]
  if (termine.length) teile.push(['Termine:', ...termine.map((z) => zeileKurz({ ...z, was: z.was.replace(/^[\d:–]+ Uhr: /, '') }))].join('\n'))
  if (frist.length) teile.push(['Fristsachen – unbedingt erledigen:', ...frist.slice(0, 6).map((z) => zeileKurz(z)), ...(frist.length > 6 ? [`… und ${frist.length - 6} weitere`] : [])].join('\n'))
  if (a.length) teile.push(['A-Aufgaben:', ...a.map((z, i) => zeileKurz(z, `A${i + 1}`))].join('\n'))
  const fuss: string[] = []
  if (sonst) fuss.push(`Dazu ${sonst} weitere Aufgabe${sonst === 1 ? '' : 'n'} (B, C, kurze Arbeiten).`)
  if (b.umsatzMoeglich > 0) fuss.push(`Möglicher Umsatz heute: ${euro(b.umsatzMoeglich)}.`)
  if (opts.link) fuss.push(`Plan ansehen und ändern: ${opts.link}`)
  if (fuss.length) teile.push(fuss.join('\n'))
  return teile.join('\n\n')
}

/** Abendnachricht „Offen geblieben“; null, wenn nichts offen ist. */
export function abendText(plan: Pick<PlanTag, 'zeilen'>, opts: { link?: string } = {}): string | null {
  const offen = offeneZeilen(plan.zeilen)
  if (offen.length === 0) return null
  const b = bilanz(plan.zeilen)
  const liste = offen.slice(0, 10).map((z) => zeileKurz(z))
  const teile = [
    `🌙 Offen geblieben – morgen übernehmen?`,
    `${b.erledigt} von ${b.anzahl} erledigt${b.minutenIst > 0 ? `, ${dauerText(b.minutenIst)} gestoppt` : ''}${b.umsatzErledigt > 0 ? `, Umsatz bewegt: ${euro(b.umsatzErledigt)}` : ''}.`,
    [...liste, ...(offen.length > 10 ? [`… und ${offen.length - 10} weitere`] : [])].join('\n'),
    'Ich nehme das Offene morgen früh automatisch in deinen Tagesvorschlag. Soll etwas wegfallen, schreib mir einfach z. B. „streich Tinyhäuser aus meinem Tag“.',
  ]
  if (opts.link) teile.push(opts.link)
  return teile.join('\n\n')
}
