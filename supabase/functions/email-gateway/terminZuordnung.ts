// Termine dauerhaft einer Akte zuordnen (22.11.2026) — vom Zeitplan jede Minute gerufen (Aktion termin_erinnerungen in
// index.ts), ohne offenes Browserfenster. Regeln in _shared/terminZuordnungKern.ts (bewerteTermin):
//  - E-Mail-Adresse eines Gastes bei genau einer Akte → kunde_id/kunde_bereich/kunde_name werden gesetzt,
//  - Name genau einer Akte im Titel → nur ein Vorschlag (termine.zuordnung_vorschlag), den der Mitarbeiter im Kalender
//    oder per Assistent (termin_zuordnen) bestätigt,
//  - reine Team-Termine und abgesagte Termine bleiben unberührt; PRIVATE Termine (_shared/privatGrenze.ts) bekommen nie
//    eine Mayer-Akte, höchstens eine private Akte desselben Besitzers,
//  - Serien: eine von Hand gesetzte bzw. abgelehnte Akte gilt für alle Vorkommen (serienEntscheidung).
//
// Ablauf je Lauf (kleine Mengen, damit der Minutentakt nicht leidet):
//  - Offen = ohne Akte und noch nie geprüft (zuordnung_geprueft_am leer). Zuerst kommende Termine (nächste zuerst), dann
//    die letzten 30 Tage, zuletzt ältere — höchstens HOECHSTENS je Lauf.
//  - Jeder Termin wird vor der Arbeit beansprucht (zuordnung_geprueft_am setzen, nur wenn noch leer) — zwei Läufe
//    gleichzeitig prüfen nie denselben Termin, und jeder Termin wird genau einmal bewertet.
//  - Neu geprüft wird ein Termin erst, wenn sich Titel, Gast oder Outlook-Teilnehmer ändern: Das setzt ein Auslöser
//    in der Datenbank (SQL terminakte.sql) wieder auf leer. Wer eine Akte von Hand löst, trägt sie dort in
//    zuordnung_vorschlag.abgelehnt ein — sie kommt für diesen Termin nie wieder.
//  - Geschrieben wird nur, solange der Termin noch keine Akte hat (eine inzwischen von Hand gesetzte bleibt).
//  - Ohne KI, ohne Nachrichten. Wirft nie.
//
// Der Kalender-Abgleich mit Outlook (kalenderAbgleich.ts) schreibt nur einzelne Spalten (Titel, Zeiten, Teilnehmer …)
// und lässt kunde_* sowie die Zuordnungs-Spalten in Ruhe.

import { type Bewertung, bewerteTermin, ladeZuordnungsUmgebung, ordneVonHandZu, ZUORDNUNG_SPALTEN, type ZuordnungsUmgebung, type ZuordnungTermin, type ZuordnungVorschlag, abgelehnteAkten } from '../_shared/terminZuordnungKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const HOECHSTENS = 20
const ZEIT_BUDGET_MS = 20_000
const RUECKBLICK_TAGE = 30

export type ZuordnungLauf = {
  geprueft: number
  zugeordnet: number
  vorschlaege: number
  uebersprungen: number
  fehler: string[]
  /** Nur im Trockenlauf: was passieren würde (Titel, Beginn, Ergebnis). */
  liste?: { id: string; titel: string; beginn: string; ergebnis: string; akte?: string }[]
}

export type ZuordnungOptionen = {
  hoechstens?: number
  zeitBudgetMs?: number
  jetzt?: Date
  /** Nichts beanspruchen, nichts schreiben — alle offenen Termine bewerten und das Ergebnis auflisten. */
  trockenlauf?: boolean
  /** Nur im Trockenlauf: nur Termine ab diesem Zeitpunkt (z. B. jetzt = nur kommende). */
  trockenAb?: Date
}

/** Offene Termine in der Reihenfolge oben (höchstens n). */
async function offeneTermine(admin: Db, n: number, jetzt: Date): Promise<string[]> {
  const jetztIso = jetzt.toISOString()
  const rueckblick = new Date(jetzt.getTime() - RUECKBLICK_TAGE * 86400000).toISOString()
  const basis = () => admin.from('termine').select('id').is('kunde_id', null).is('zuordnung_geprueft_am', null)
  const ids: string[] = []
  const schritte = [
    () => basis().gte('beginn', jetztIso).order('beginn', { ascending: true }),
    () => basis().lt('beginn', jetztIso).gte('beginn', rueckblick).order('beginn', { ascending: false }),
    () => basis().lt('beginn', rueckblick).order('beginn', { ascending: false }),
  ]
  for (const schritt of schritte) {
    if (ids.length >= n) break
    const { data, error } = await schritt().limit(n - ids.length)
    if (error) throw new Error(`Termine nicht lesbar: ${error.message}`)
    for (const z of (data ?? []) as { id: string }[]) ids.push(String(z.id))
  }
  return ids
}

/** Alle offenen Termine für den Trockenlauf (seitenweise nach id, die Datenbank liefert höchstens 1000 Zeilen). */
async function alleOffenen(admin: Db, ab?: Date): Promise<ZuordnungTermin[]> {
  const alle: ZuordnungTermin[] = []
  for (let letzte = '', seite = 0; seite < 50; seite++) {
    let q = admin.from('termine').select(ZUORDNUNG_SPALTEN).is('kunde_id', null).order('id', { ascending: true }).limit(1000)
    if (ab) q = q.gte('beginn', ab.toISOString())
    if (letzte) q = q.gt('id', letzte)
    const { data, error } = await q
    if (error) throw new Error(`Termine nicht lesbar: ${error.message}`)
    const teil = (data ?? []) as ZuordnungTermin[]
    alle.push(...teil)
    if (teil.length < 1000) break
    letzte = String(teil[teil.length - 1].id)
  }
  return alle
}

/** Was in die Zeile geschrieben wird — null = nichts zu schreiben. */
export function aenderungFuer(t: ZuordnungTermin, b: Bewertung, am: string): Record<string, unknown> | null {
  const vorher = (t.zuordnung_vorschlag && typeof t.zuordnung_vorschlag === 'object' ? t.zuordnung_vorschlag : {}) as ZuordnungVorschlag
  const abgelehnt = abgelehnteAkten(vorher)
  const mitAbgelehnt = abgelehnt.length ? { abgelehnt } : {}
  if (b.art === 'sicher') {
    return {
      kunde_id: b.kunde.id,
      kunde_bereich: b.kunde.bereich || null,
      kunde_name: b.name,
      zuordnung_vorschlag: { stand: 'automatisch', kunde_id: b.kunde.id, bereich: b.kunde.bereich, name: b.name, wie: b.wie ?? 'gast', am, ...mitAbgelehnt } satisfies ZuordnungVorschlag,
    }
  }
  if (b.art === 'vorschlag') {
    if (vorher.stand === 'vorschlag' && vorher.kunde_id === b.kunde.id) return null
    return { zuordnung_vorschlag: { stand: 'vorschlag', kunde_id: b.kunde.id, bereich: b.kunde.bereich, name: b.name, wie: 'titel', am, ...mitAbgelehnt } satisfies ZuordnungVorschlag }
  }
  // Nichts gefunden bzw. übersprungen: einen alten Vorschlag (z. B. vor einer Titeländerung) zurücknehmen.
  if (vorher.stand === 'vorschlag') return { zuordnung_vorschlag: { stand: 'keiner', am, ...mitAbgelehnt } satisfies ZuordnungVorschlag }
  return null
}

function ergebnisText(b: Bewertung): string {
  if (b.art === 'uebersprungen') return `übersprungen (${b.grund})`
  return b.art
}

export async function ordneTermineZu(admin: Db, o: ZuordnungOptionen = {}): Promise<ZuordnungLauf> {
  const r: ZuordnungLauf = { geprueft: 0, zugeordnet: 0, vorschlaege: 0, uebersprungen: 0, fehler: [] }
  try {
    await lauf(admin, o, r)
  } catch (err) {
    r.fehler.push(err instanceof Error ? err.message : String(err))
  }
  if (r.fehler.length > 0) console.error('Termin-Zuordnung:', r.fehler.slice(0, 5).join(' | '))
  return r
}

async function lauf(admin: Db, o: ZuordnungOptionen, r: ZuordnungLauf): Promise<void> {
  const start = Date.now()
  const jetzt = o.jetzt ?? new Date()
  const budget = o.zeitBudgetMs ?? ZEIT_BUDGET_MS

  let termine: ZuordnungTermin[]
  if (o.trockenlauf) {
    termine = await alleOffenen(admin, o.trockenAb)
    r.liste = []
  } else {
    const ids = await offeneTermine(admin, Math.max(1, Math.min(o.hoechstens ?? HOECHSTENS, 100)), jetzt)
    if (ids.length === 0) return
    // Beanspruchen: nur Zeilen, die noch offen sind; zurück kommen genau die, die dieser Lauf bekommen hat.
    const { data, error } = await admin
      .from('termine')
      .update({ zuordnung_geprueft_am: jetzt.toISOString() })
      .in('id', ids)
      .is('zuordnung_geprueft_am', null)
      .is('kunde_id', null)
      .select(ZUORDNUNG_SPALTEN)
    if (error) throw new Error(`Termine nicht beanspruchbar: ${error.message}`)
    termine = (data ?? []) as ZuordnungTermin[]
  }
  if (termine.length === 0) return

  let u: ZuordnungsUmgebung
  try {
    u = await ladeZuordnungsUmgebung(admin)
  } catch (err) {
    // Beansprucht, aber nicht geprüft: wieder freigeben, sonst blieben sie für immer ungeprüft.
    if (!o.trockenlauf) await admin.from('termine').update({ zuordnung_geprueft_am: null }).in('id', termine.map((t) => t.id)).eq('zuordnung_geprueft_am', jetzt.toISOString())
    throw err
  }

  const am = jetzt.toISOString()
  const freigeben: string[] = []
  for (const t of termine) {
    if (!o.trockenlauf && Date.now() - start > budget) {
      freigeben.push(t.id)
      continue
    }
    let b: Bewertung
    try {
      b = await bewerteTermin(admin, t, u)
    } catch (err) {
      r.fehler.push(`„${String(t.titel ?? '').slice(0, 40)}“: ${err instanceof Error ? err.message : err}`)
      freigeben.push(t.id)
      continue
    }
    r.geprueft++
    if (b.art === 'sicher') r.zugeordnet++
    else if (b.art === 'vorschlag') r.vorschlaege++
    else if (b.art === 'uebersprungen') r.uebersprungen++
    if (o.trockenlauf) {
      r.liste!.push({ id: t.id, titel: String(t.titel ?? ''), beginn: t.beginn, ergebnis: ergebnisText(b), ...(b.art === 'sicher' || b.art === 'vorschlag' ? { akte: `${b.name} (${b.kunde.bereich}, ${b.kunde.id})` } : {}) })
      continue
    }
    const aenderung = aenderungFuer(t, b, am)
    if (!aenderung) continue
    const { error } = await admin.from('termine').update(aenderung).eq('id', t.id).is('kunde_id', null)
    if (error) r.fehler.push(`Zuordnung „${String(t.titel ?? '').slice(0, 40)}“ nicht gespeichert: ${error.message}`)
  }
  // Nicht geschafft (Zeit um, Fehler): wieder offen für den nächsten Lauf.
  if (freigeben.length > 0) {
    const { error } = await admin.from('termine').update({ zuordnung_geprueft_am: null }).in('id', freigeben).eq('zuordnung_geprueft_am', am)
    if (error) r.fehler.push(`Termine nicht freigegeben: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------------------------
// Aktion termin_zuordnen (CRM-Kalender): { terminId, kundeId | null, vorschlagAblehnen?, gleicheTitel? } — angemeldeter Mitarbeiter.

export async function terminZuordnenAktion(admin: Db, aufruferEmail: string, body: Record<string, unknown>): Promise<{ status: number; daten: Record<string, unknown> }> {
  const email = String(aufruferEmail ?? '').trim().toLowerCase()
  // Wenige Zeilen: alle lesen und ohne Groß/Klein vergleichen.
  const { data: alle } = await admin.from('mitarbeiter').select('name, email, rolle, ist_admin, bereiche, aktiv')
  // deno-lint-ignore no-explicit-any
  const m = ((alle ?? []) as any[]).find((z) => String(z.email ?? '').trim().toLowerCase() === email)
  if (!m || m.aktiv === false) return { status: 403, daten: { error: 'Kein aktiver Mitarbeiter.' } }
  const ergebnis = await ordneVonHandZu(admin, { email, name: m.name ?? null, rolle: m.rolle ?? null, ist_admin: m.ist_admin === true, bereiche: Array.isArray(m.bereiche) ? m.bereiche : [] }, {
    terminId: String(body.terminId ?? ''),
    kundeId: body.kundeId ? String(body.kundeId) : null,
    vorschlagAblehnen: body.vorschlagAblehnen === true,
    gleicheTitel: body.gleicheTitel === true,
  })
  if (!ergebnis.ok) return { status: ergebnis.status, daten: { error: ergebnis.fehler } }
  return { status: 200, daten: { ok: true, termin: ergebnis.termin, text: ergebnis.text, weitere: ergebnis.weitere } }
}
