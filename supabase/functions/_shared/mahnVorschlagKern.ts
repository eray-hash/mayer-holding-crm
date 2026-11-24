// Mahnvorschläge „Mahnen, ohne es zu vergessen“ (22.11.2026) — gemeinsame Regeln für den Tageslauf
// (email-gateway/mahnVorschlag.ts), das Assistent-Werkzeug mahn_vorschlaege (telegram-gateway/mahnVorschlagWerkzeug.ts)
// und die Seite Mahnwesen im CRM (src/pages/beratung/Mahnwesen.tsx, nur Typen/Konstanten).
//
// Grundsatz: Es wird NIE etwas automatisch an Kunden geschickt. Der Server legt nur einen Vorschlag an (Tabelle
// mahn_vorschlaege) und sagt dem zuständigen Mitarbeiter per Telegram Bescheid; erstellt und gesendet wird das Schreiben
// im CRM mit dem vorhandenen Mahn-Dialog oder seit 24.11.2026 direkt in Telegram (Antwort „Zahlungserinnerung LSA-001
// senden“ → Werkzeug mahnung_erstellen, telegram-gateway/mahnungWerkzeuge.ts; raus erst nach dem Ja des Mitarbeiters).
//
// Wann ist der nächste Schritt fällig? (Tage einstellbar in mahn_einstellung, Vorgabe 3 / 14 / 28)
//   - Rechnung versendet oder überfällig, noch etwas offen, gültiges Zahlungsziel.
//   - Nächster Schritt = auf die gespeicherte Mahnstufe folgende Stufe (ohne Mahnstufe: Zahlungserinnerung). Nach der
//     2. Mahnung schlägt der Server nichts mehr vor (Inkasso entscheidet ein Mensch).
//   - Fällig ab: Zahlungsziel + eingestellte Tage der Stufe — und frühestens am Tag nach der neuen Frist aus dem
//     letzten Schreiben (sonst käme die 1. Mahnung, bevor die Frist der Zahlungserinnerung abgelaufen ist).
//   - Übersprungen, wenn in den letzten Tagen (Vorgabe 3) eine Zahlung eingegangen ist oder ein vom Assistenten
//     gelesener Kontoauszug eine passende, noch nicht bestätigte Buchung enthält (Abgleich ausstehend).
//
// Je Rechnung und Stufe gibt es höchstens eine Zeile (id = <rechnung_id>:<stufe>); die Anlage ist zugleich der
// Anspruch auf die Nachricht — doppelte Anlage scheitert am Primärschlüssel, also auch keine doppelte Nachricht.
// Status: offen → gesendet (Schreiben erstellt) | erledigt (bezahlt/nicht mehr offen) | zurueckgestellt (bis Datum,
// z. B. Ratenzahlung; danach wieder offen mit neuer Nachricht).

import { gleicheAb, type AbgleichBuchung, type AbgleichRechnung, type BekannteZahlung } from './zahlungsAbgleich.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type MahnStufe = 'erinnerung' | 'mahnung1' | 'mahnung2'
export const MAHN_STUFEN: readonly MahnStufe[] = ['erinnerung', 'mahnung1', 'mahnung2']
const REIHENFOLGE = ['erinnerung', 'mahnung1', 'mahnung2', 'inkasso']
export const STUFE_NAME: Record<MahnStufe, string> = { erinnerung: 'Zahlungserinnerung', mahnung1: '1. Mahnung', mahnung2: '2. Mahnung' }

export const VORSCHLAG_TABELLE = 'mahn_vorschlaege'
export const EINSTELLUNG_TABELLE = 'mahn_einstellung'
export const HINWEIS_TABELLE = 'mahn_vorschlag_hinweis'

export type MahnEinstellung = { aktiv: boolean; tage: Record<MahnStufe, number>; ruheTage: number }
export const STANDARD_EINSTELLUNG: MahnEinstellung = { aktiv: true, tage: { erinnerung: 3, mahnung1: 14, mahnung2: 28 }, ruheTage: 3 }

export type MahnVorschlagStatus = 'offen' | 'gesendet' | 'erledigt' | 'zurueckgestellt'

export type MahnVorschlagZeile = {
  id: string
  rechnung_id: string
  stufe: MahnStufe
  kunde_id: string | null
  kunde_bereich: string | null
  rechnung_nummer: string | null
  tage_ueberfaellig: number | null
  offen: number | string | null
  status: MahnVorschlagStatus
  zurueckgestellt_bis: string | null
  notiz: string | null
  grund: string | null
  empfaenger: string | null
  benachrichtigt_am: string | null
  erstellt_am: string | null
  geaendert_am: string | null
  erledigt_am: string | null
  erledigt_von: string | null
}

export type MahnRechnung = {
  id: string
  nummer: string
  kunde_id: string | null
  datum?: string | null
  status: string
  zahlungsziel: string | null
  mahnstufe: string | null
  betrag_brutto: number | string
  zahlungen: { datum?: string | null; betrag?: number | string | null; quelle?: string | null }[] | null
  mahnungen: { datum?: string | null; stufe?: string | null; neueFrist?: string | null }[] | null
}

export type AkteKurz = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null }

// ─── Kleine Helfer ────────────────────────────────────────────────────────────────────────────────

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

function zahl(w: unknown, vorgabe: number, min: number, max: number): number {
  const n = Math.round(Number(w))
  return Number.isFinite(n) && n >= min && n <= max ? n : vorgabe
}

function rundeCent(n: number): number {
  return Math.round(n * 100) / 100
}

function istDatum(d: unknown): d is string {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)
}

/** yyyy-mm-dd plus n Tage (reine Kalenderrechnung). */
export function plusTage(datum: string, n: number): string {
  const [y, m, d] = datum.slice(0, 10).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** Tage von `von` bis `bis` (positiv = bis liegt später). */
export function tageZwischen(von: string, bis: string): number {
  const a = Date.UTC(Number(von.slice(0, 4)), Number(von.slice(5, 7)) - 1, Number(von.slice(8, 10)))
  const b = Date.UTC(Number(bis.slice(0, 4)), Number(bis.slice(5, 7)) - 1, Number(bis.slice(8, 10)))
  return Math.round((b - a) / 86400000)
}

export function deDatum(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

export function euro(n: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`
}

export function akteName(a: Pick<AkteKurz, 'firma' | 'ansprechpartner'> | null | undefined): string {
  if (!a) return 'ohne Akte'
  const f = text(a.firma)
  const p = text(a.ansprechpartner)
  return f && p && f !== p ? `${f} (${p})` : f || p || 'ohne Namen'
}

export function vorschlagId(rechnungId: string, stufe: MahnStufe): string {
  return `${rechnungId}:${stufe}`
}

/** Einstellungszeile (mahn_einstellung) → Einstellung; fehlende/ungültige Werte = Vorgabe. */
export function einstellungAus(z: Record<string, unknown> | null | undefined): MahnEinstellung {
  if (!z) return STANDARD_EINSTELLUNG
  const s = STANDARD_EINSTELLUNG
  const erinnerung = zahl(z.tage_erinnerung, s.tage.erinnerung, 0, 365)
  const mahnung1 = Math.max(erinnerung, zahl(z.tage_mahnung1, s.tage.mahnung1, 0, 365))
  const mahnung2 = Math.max(mahnung1, zahl(z.tage_mahnung2, s.tage.mahnung2, 0, 365))
  return { aktiv: z.aktiv !== false, tage: { erinnerung, mahnung1, mahnung2 }, ruheTage: zahl(z.ruhe_tage_zahlung, s.ruheTage, 0, 60) }
}

// ─── Rechenregeln wie src/lib/rechnungen.ts ──────────────────────────────────────────────────────

export function istUnbezahlt(r: Pick<MahnRechnung, 'status'>): boolean {
  return r.status === 'Versendet' || r.status === 'Überfällig'
}

export function offenerBetrag(r: Pick<MahnRechnung, 'status' | 'betrag_brutto' | 'zahlungen'>): number {
  if (r.status === 'Bezahlt') return 0
  const bezahlt = (Array.isArray(r.zahlungen) ? r.zahlungen : []).reduce((s, z) => s + (Number(z?.betrag) || 0), 0)
  return Math.max(0, rundeCent(Number(r.betrag_brutto) - rundeCent(bezahlt)))
}

/** Gültige Frist: die neue Frist aus dem letzten Mahnschreiben, sonst das Zahlungsziel. */
export function aktuelleFrist(r: Pick<MahnRechnung, 'mahnungen' | 'zahlungsziel'>): string {
  const letzte = [...(Array.isArray(r.mahnungen) ? r.mahnungen : [])].reverse().find((m) => m?.neueFrist)
  return text(letzte?.neueFrist) || text(r.zahlungsziel)
}

/** Nächste Stufe, die der Server vorschlagen darf (nach der 2. Mahnung keine mehr). */
export function naechsteStufe(mahnstufe: string | null | undefined): MahnStufe | null {
  const i = mahnstufe ? REIHENFOLGE.indexOf(mahnstufe) : -1
  if (mahnstufe && i === -1) return null
  const naechste = REIHENFOLGE[i + 1]
  return (MAHN_STUFEN as readonly string[]).includes(naechste) ? (naechste as MahnStufe) : null
}

/** Hat die Rechnung die Stufe schon erreicht (Schreiben dieser oder einer höheren Stufe erstellt)? */
export function stufeErreicht(mahnstufe: string | null | undefined, stufe: MahnStufe): boolean {
  if (!mahnstufe) return false
  const i = REIHENFOLGE.indexOf(mahnstufe)
  return i >= 0 && i >= REIHENFOLGE.indexOf(stufe)
}

// ─── Prüfung je Rechnung ─────────────────────────────────────────────────────────────────────────

export type Pruefung =
  | { ergebnis: 'faellig'; stufe: MahnStufe; tage: number; offen: number }
  | { ergebnis: 'warten'; stufe: MahnStufe; tage: number; ab: string }
  | { ergebnis: 'uebersprungen'; stufe: MahnStufe; tage: number; grund: string }
  | { ergebnis: 'nichts' }

/** Ist für die Rechnung heute der nächste Mahnschritt fällig? `abgleichOffen` = Rechnungen mit ausstehendem Kontoauszug-Treffer. */
export function pruefeRechnung(r: MahnRechnung, heute: string, e: MahnEinstellung, abgleichOffen: ReadonlySet<string> = new Set()): Pruefung {
  if (!istUnbezahlt(r)) return { ergebnis: 'nichts' }
  const offen = offenerBetrag(r)
  if (offen < 0.01) return { ergebnis: 'nichts' }
  if (!istDatum(r.zahlungsziel)) return { ergebnis: 'nichts' }
  const stufe = naechsteStufe(r.mahnstufe)
  if (!stufe) return { ergebnis: 'nichts' }
  const tage = tageZwischen(r.zahlungsziel, heute)
  const frist = aktuelleFrist(r)
  const nachTagen = plusTage(r.zahlungsziel, e.tage[stufe])
  const nachFrist = istDatum(frist) ? plusTage(frist, 1) : nachTagen
  const ab = nachTagen > nachFrist ? nachTagen : nachFrist
  if (heute < ab) return { ergebnis: 'warten', stufe, tage, ab }
  const grenze = plusTage(heute, -e.ruheTage)
  const juengste = (Array.isArray(r.zahlungen) ? r.zahlungen : [])
    .map((z) => text(z?.datum).slice(0, 10))
    .filter((d) => istDatum(d) && d >= grenze && d <= heute)
    .sort()
    .pop()
  if (juengste) return { ergebnis: 'uebersprungen', stufe, tage, grund: `Zahlung am ${deDatum(juengste)} eingegangen — erst abwarten` }
  if (abgleichOffen.has(r.id)) return { ergebnis: 'uebersprungen', stufe, tage, grund: 'ein gelesener Kontoauszug enthält eine passende Buchung, die noch nicht bestätigt ist' }
  return { ergebnis: 'faellig', stufe, tage, offen }
}

// ─── Plan für einen Lauf ─────────────────────────────────────────────────────────────────────────

export type Faellig = { rechnung: MahnRechnung; stufe: MahnStufe; tage: number; offen: number }

export type MahnPlan = {
  /** Neue Vorschläge (noch keine Zeile für Rechnung und Stufe). */
  neu: Faellig[]
  /** Zurückgestellte Vorschläge, deren Datum abgelaufen ist und die weiter fällig sind. */
  reaktivieren: (Faellig & { zeile: MahnVorschlagZeile })[]
  /** Offene/zurückgestellte Vorschläge, die sich erledigt haben. */
  abschliessen: { zeile: MahnVorschlagZeile; status: 'gesendet' | 'erledigt'; von: string }[]
  /** Fällig, aber bewusst übersprungen (Zahlung eingegangen, Abgleich ausstehend). */
  uebersprungen: { rechnung: MahnRechnung; stufe: MahnStufe; tage: number; grund: string }[]
  /** Bis zu einem Datum zurückgestellt (Rechnung bleibt ruhig). */
  zurueckgestellt: { rechnung: MahnRechnung; zeile: MahnVorschlagZeile }[]
}

export function planeMahnVorschlaege(
  rechnungen: MahnRechnung[],
  vorhandene: MahnVorschlagZeile[],
  heute: string,
  e: MahnEinstellung,
  abgleichOffen: ReadonlySet<string> = new Set(),
): MahnPlan {
  const plan: MahnPlan = { neu: [], reaktivieren: [], abschliessen: [], uebersprungen: [], zurueckgestellt: [] }
  const rechnungJe = new Map(rechnungen.map((r) => [r.id, r]))
  const zeilenJe = new Map<string, MahnVorschlagZeile[]>()
  for (const z of vorhandene) zeilenJe.set(z.rechnung_id, [...(zeilenJe.get(z.rechnung_id) ?? []), z])

  // Erst die vorhandenen offenen/zurückgestellten Zeilen: erledigt? noch zurückgestellt? wieder fällig?
  const ruhig = new Set<string>()
  for (const z of vorhandene) {
    if (z.status !== 'offen' && z.status !== 'zurueckgestellt') continue
    const r = rechnungJe.get(z.rechnung_id)
    if (!r || !istUnbezahlt(r) || offenerBetrag(r) < 0.01) {
      plan.abschliessen.push({ zeile: z, status: 'erledigt', von: r?.status === 'Bezahlt' || (r && offenerBetrag(r) < 0.01) ? 'automatisch (bezahlt)' : 'automatisch (Rechnung nicht mehr offen)' })
      continue
    }
    if (stufeErreicht(r.mahnstufe, z.stufe)) {
      plan.abschliessen.push({ zeile: z, status: 'gesendet', von: 'automatisch (Schreiben erstellt)' })
      continue
    }
    ruhig.add(r.id)
    if (z.status === 'offen') continue
    const bis = text(z.zurueckgestellt_bis)
    if (istDatum(bis) && bis >= heute) {
      plan.zurueckgestellt.push({ rechnung: r, zeile: z })
      continue
    }
    const p = pruefeRechnung(r, heute, e, abgleichOffen)
    if (p.ergebnis === 'faellig' && p.stufe === z.stufe) plan.reaktivieren.push({ zeile: z, rechnung: r, stufe: p.stufe, tage: p.tage, offen: p.offen })
    else if (p.ergebnis === 'uebersprungen') plan.uebersprungen.push({ rechnung: r, stufe: p.stufe, tage: p.tage, grund: p.grund })
  }

  // Dann die Rechnungen ohne offene/zurückgestellte Zeile.
  for (const r of rechnungen) {
    if (ruhig.has(r.id)) continue
    const p = pruefeRechnung(r, heute, e, abgleichOffen)
    if (p.ergebnis === 'uebersprungen') {
      plan.uebersprungen.push({ rechnung: r, stufe: p.stufe, tage: p.tage, grund: p.grund })
      continue
    }
    if (p.ergebnis !== 'faellig') continue
    // Für diese Stufe gab es schon einen Vorschlag (gesendet/erledigt) → nicht noch einmal.
    if ((zeilenJe.get(r.id) ?? []).some((z) => z.stufe === p.stufe)) continue
    plan.neu.push({ rechnung: r, stufe: p.stufe, tage: p.tage, offen: p.offen })
  }
  return plan
}

// ─── Texte ───────────────────────────────────────────────────────────────────────────────────────

export function tageText(n: number): string {
  return `${n} ${n === 1 ? 'Tag' : 'Tage'}`
}

/** Link auf die Seite Mahnwesen, wahlweise mit einem Vorschlag geöffnet. */
export function mahnLink(basis: string, id?: string): string {
  const b = basis.endsWith('/') ? basis : `${basis}/`
  return `${b}#/beratung/mahnwesen${id ? `?vorschlag=${encodeURIComponent(id)}` : ''}`
}

/** Grund, wie er am Vorschlag steht. */
export function grundText(f: Pick<Faellig, 'stufe' | 'tage' | 'offen'>, rechnung: Pick<MahnRechnung, 'zahlungsziel' | 'mahnstufe'>): string {
  const vorher = rechnung.mahnstufe && (MAHN_STUFEN as readonly string[]).includes(rechnung.mahnstufe) ? `, zuletzt ${STUFE_NAME[rechnung.mahnstufe as MahnStufe]}` : ''
  return `Zahlungsziel ${deDatum(rechnung.zahlungsziel)} seit ${tageText(f.tage)} verstrichen${vorher}; offen ${euro(f.offen)}.`
}

export type HinweisEintrag = { id: string; nummer: string; kunde: string; stufe: MahnStufe; tage: number; offen: number; wieder?: boolean }

/** Telegram-Text an einen Mitarbeiter (ein oder mehrere Vorschläge). */
/** Antwortvorschlag: damit bereitet der Assistent das Schreiben direkt in Telegram vor (mahnung_erstellen). */
export function antwortVorschlag(e: Pick<HinweisEintrag, 'nummer' | 'stufe'>): string {
  return `„${STUFE_NAME[e.stufe]} ${e.nummer} senden“`
}

export function hinweisText(eintraege: HinweisEintrag[], basis: string): string {
  const fuss = 'Gesendet wird nichts automatisch. Abschalten: auf der Seite Mahnwesen unten den Haken entfernen.'
  if (eintraege.length === 1) {
    const e = eintraege[0]
    return [
      `${e.wieder ? 'Zurückstellung abgelaufen: ' : ''}Rechnung ${e.nummer} (${e.kunde}) ist ${tageText(e.tage)} überfällig — ${STUFE_NAME[e.stufe]} vorbereitet, bitte prüfen und senden (offen ${euro(e.offen)}).`,
      `Antworte z. B. ${antwortVorschlag(e)}, dann bereite ich sie hier vor (PDF und Mail, raus erst nach deinem Ja). Oder im CRM: ${mahnLink(basis, e.id)}`,
      fuss,
    ].join('\n')
  }
  return [
    `Mahnwesen: ${eintraege.length} Rechnungen sind überfällig — Schreiben vorbereitet, bitte prüfen und senden.`,
    ...eintraege.map((e) => `• ${e.nummer} (${e.kunde}): ${tageText(e.tage)} überfällig — ${STUFE_NAME[e.stufe]}, offen ${euro(e.offen)}${e.wieder ? ' (Zurückstellung abgelaufen)' : ''}`),
    `Antworte z. B. ${antwortVorschlag(eintraege[0])}, dann bereite ich das Schreiben hier vor (PDF und Mail, raus erst nach deinem Ja). Oder im CRM: ${mahnLink(basis)}`,
    fuss,
  ].join('\n')
}

// ─── Laden (Server und Assistent, Dienstschlüssel) ───────────────────────────────────────────────

const RECHNUNG_SPALTEN = 'id, nummer, kunde_id, datum, status, zahlungsziel, mahnstufe, betrag_brutto, zahlungen, mahnungen'
const SEITE = 1000
const IN_STUECK = 150
export const ABGLEICH_EIMER = 'kunden-dokumente'
export const ABGLEICH_ORDNER = 'kontoauszug-abgleich/assistent'
/** Kontoauszüge, die der Assistent in den letzten Tagen gelesen hat, gelten als „Abgleich ausstehend“. */
export const ABGLEICH_TAGE = 7

/** Alle Zeilen einer Tabelle seitenweise nach id (Supabase liefert höchstens 1000 je Abfrage). */
async function ladeAlle<T>(admin: Db, tabelle: string, spalten: string, weiter?: (q: Db) => Db): Promise<T[]> {
  const aus: T[] = []
  let letzte: string | null = null
  for (let runde = 0; runde < 200; runde++) {
    let q = admin.from(tabelle).select(spalten)
    if (weiter) q = weiter(q)
    if (letzte !== null) q = q.gt('id', letzte)
    const { data, error } = await q.order('id', { ascending: true }).limit(SEITE)
    if (error) throw new Error(`${tabelle}: ${error.message}`)
    const zeilen = (data ?? []) as (T & { id: string })[]
    aus.push(...zeilen)
    if (zeilen.length < SEITE) break
    letzte = zeilen[zeilen.length - 1].id
  }
  return aus
}

export async function ladeAkten(admin: Db, ids: string[]): Promise<Map<string, AkteKurz>> {
  const eindeutig = [...new Set(ids.filter(Boolean))]
  const aus = new Map<string, AkteKurz>()
  for (let i = 0; i < eindeutig.length; i += IN_STUECK) {
    const { data, error } = await admin.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').in('id', eindeutig.slice(i, i + IN_STUECK))
    if (error) throw new Error(`kunden: ${error.message}`)
    for (const a of (data ?? []) as AkteKurz[]) aus.set(a.id, a)
  }
  return aus
}

/** Gelesene Kontoauszüge (Ablage des Assistenten) der letzten Tage — je Datei die Buchungen. Fehler = keine. */
export async function ladeGeleseneAuszuege(admin: Db, heute: string): Promise<AbgleichBuchung[][]> {
  try {
    const fach = admin?.storage?.from?.(ABGLEICH_EIMER)
    if (!fach || typeof fach.list !== 'function') return []
    const { data, error } = await fach.list(ABGLEICH_ORDNER, { limit: 100, sortBy: { column: 'updated_at', order: 'desc' } })
    if (error || !Array.isArray(data)) return []
    const grenze = plusTage(heute, -ABGLEICH_TAGE)
    const aus: AbgleichBuchung[][] = []
    for (const d of data as { name?: string; updated_at?: string; created_at?: string }[]) {
      const wann = text(d.updated_at || d.created_at).slice(0, 10)
      if (!d.name?.endsWith('.json') || !istDatum(wann) || wann < grenze) continue
      const { data: blob } = await fach.download(`${ABGLEICH_ORDNER}/${d.name}`)
      if (!blob) continue
      try {
        const g = JSON.parse(await blob.text())
        if (Array.isArray(g?.buchungen)) aus.push(g.buchungen as AbgleichBuchung[])
      } catch { /* kaputte Datei überspringen */ }
    }
    return aus
  } catch {
    return []
  }
}

/** Rechnungen, zu denen ein gelesener Kontoauszug eine passende, noch nicht gebuchte Zahlung enthält (sicher/wahrscheinlich). */
export function offeneAbgleiche(auszuege: AbgleichBuchung[][], rechnungen: MahnRechnung[], akten: Map<string, AkteKurz>): Set<string> {
  const aus = new Set<string>()
  if (!auszuege.length) return aus
  const offen: AbgleichRechnung[] = rechnungen
    .filter((r) => istUnbezahlt(r) && offenerBetrag(r) >= 0.01)
    .map((r) => {
      const a = r.kunde_id ? akten.get(r.kunde_id) : undefined
      return { id: r.id, nummer: r.nummer, datum: text(r.datum) || text(r.zahlungsziel), brutto: Number(r.betrag_brutto) || 0, offen: offenerBetrag(r), kundeId: r.kunde_id, namen: [text(a?.firma), text(a?.ansprechpartner)].filter(Boolean) }
    })
  if (!offen.length) return aus
  const bekannte: BekannteZahlung[] = []
  for (const r of rechnungen) {
    for (const z of Array.isArray(r.zahlungen) ? r.zahlungen : []) {
      bekannte.push({ art: 'rechnung', zielId: r.id, bezeichnung: `Rechnung ${r.nummer}`, datum: text(z?.datum), betrag: Math.abs(Number(z?.betrag) || 0), quellen: z?.quelle ? [String(z.quelle)] : [] })
    }
  }
  for (const buchungen of auszuege) {
    const eingaenge = buchungen.filter((b) => Number(b?.betrag) > 0 && istDatum(b?.datum))
    if (!eingaenge.length) continue
    const e = gleicheAb(buchungen, offen, [], bekannte)
    for (const v of e.vorschlaege) {
      if (v.art !== 'rechnung' || v.sicherheit === 'unklar') continue
      for (const z of v.ziele) if (z.art === 'rechnung') aus.add(z.id)
    }
  }
  return aus
}

export type MahnLage = {
  einstellung: MahnEinstellung
  einstellungDa: boolean
  rechnungen: MahnRechnung[]
  vorhandene: MahnVorschlagZeile[]
  akten: Map<string, AkteKurz>
  abgleichOffen: Set<string>
  plan: MahnPlan
}

export type LageOptionen = {
  /** Für Tests ersetzbar; Vorgabe: Ablage des Assistenten (kunden-dokumente/kontoauszug-abgleich/assistent). */
  ladeAuszuege?: (admin: Db, heute: string) => Promise<AbgleichBuchung[][]>
  /** Ohne Tabelle mahn_vorschlaege (noch nicht eingerichtet) trotzdem rechnen (Assistent: nur lesen). */
  ohneTabelleOk?: boolean
}

/** Lädt Rechnungen, vorhandene Vorschläge, Einstellung, Akten und ausstehende Abgleiche und rechnet den Plan. */
export async function ladeMahnLage(admin: Db, heute: string, o: LageOptionen = {}): Promise<MahnLage> {
  const { data: ez, error: eFehler } = await admin.from(EINSTELLUNG_TABELLE).select('*').eq('id', 1).maybeSingle()
  if (eFehler && !o.ohneTabelleOk) throw new Error(`${EINSTELLUNG_TABELLE}: ${eFehler.message}`)
  const einstellung = einstellungAus(eFehler ? null : ez)
  const rechnungen = await ladeAlle<MahnRechnung>(admin, 'rechnungen', RECHNUNG_SPALTEN)
  let vorhandene: MahnVorschlagZeile[] = []
  try {
    vorhandene = await ladeAlle<MahnVorschlagZeile>(admin, VORSCHLAG_TABELLE, '*')
  } catch (err) {
    if (!o.ohneTabelleOk) throw err
  }
  const relevant = rechnungen.filter((r) => istUnbezahlt(r) || vorhandene.some((z) => z.rechnung_id === r.id && (z.status === 'offen' || z.status === 'zurueckgestellt')))
  const akten = await ladeAkten(admin, relevant.map((r) => text(r.kunde_id)))
  const auszuege = await (o.ladeAuszuege ?? ladeGeleseneAuszuege)(admin, heute)
  const abgleichOffen = offeneAbgleiche(auszuege, rechnungen, akten)
  const plan = planeMahnVorschlaege(rechnungen, vorhandene, heute, einstellung, abgleichOffen)
  return { einstellung, einstellungDa: !eFehler && !!ez, rechnungen, vorhandene, akten, abgleichOffen, plan }
}
