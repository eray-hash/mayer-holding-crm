// Wünsche und Probleme der Mitarbeiter mit dem CRM erkennen und der Geschäftsführung einmal am Tag
// per Telegram melden — ohne offenes Browserfenster und ohne Klick. Die Mitarbeiter haben zugestimmt,
// dass ihre Nutzung dafür ausgewertet wird. Bewertet werden Funktionen des CRM, nie Personen.
//
// - Gesprächsauswertung: Der Zeitplan ruft `pruefeWunschAnalyse` jede Minute. In den Stunden
//   AUSWERTUNG_STUNDEN (Berliner Zeit, je in den ersten 30 Minuten) wird einmal ausgewertet, was
//   Mitarbeiter seit der letzten Auswertung mit dem Assistenten besprochen haben (Telegram und
//   CRM-Fenster liegen im selben Zustand `mitarbeiter.telegram_pending`). Warum nicht nur einmal am Tag:
//   Der Zustand hält je Mitarbeiter höchstens die letzten 10 Gesprächszüge der letzten 12 Stunden; eine
//   einzige Auswertung um 18 Uhr sähe bei regem Gebrauch nur den Nachmittag.
//   Das Modell geht JEDE Bitte durch und beurteilt, ob sie erfüllt wurde. Nicht oder nur teilweise
//   erfüllte Bitten werden als Eintrag in `wuensche` (quelle „analyse“) festgehalten, auf Ebene der
//   Funktion umschrieben, mit kurzem Grund.
// - Bericht (seit 19.11.2026 nach JEDER Auswertung, vorher einmal am Tag ab 18 Uhr): zusätzlich die
//   Probleme auf dem Server seit der letzten Auswertung (gescheiterte
//   Bewertungen und Analysen, nicht lesbare Dokumente, hängende Warteschlange, Bonitätseinschätzungen
//   ohne Ergebnis, Fehler im Browser, auffällige Zahl von KI-Aufrufen) als Einträge mit quelle „fehler“,
//   dann EINE Telegram-Nachricht an Admins mit Telegram — nur wenn es seit der letzten Meldung etwas
//   Neues gibt (`gemeldet_am`).
// - Datenschutz: Ins Modell gehen nur Text des Mitarbeiters und des Assistenten (gekürzt) und je
//   Werkzeug nur Name und Ergebnis (ok / Fehler mit gekürztem, entschärftem Fehlertext) — nie die
//   Eingaben oder Inhalte der Werkzeuge, nie Systemnachrichten wie Datei-Eingänge. Mitarbeiter heißen
//   dort P1, P2 …. Was zurückkommt, wird noch einmal entschärft (Kundennamen, Beträge, Nummern).
//   In Bericht und Tabelle stehen keine Kosten.
// - Buchhaltung: eine Zeile in `abteilung_eintraege` (id `wunsch_stand`): zuletzt beanspruchte Stunde,
//   Ende des zuletzt ausgewerteten Zeitraums, Tag des letzten Berichts. Wer auswerten will, stellt sie
//   VOR der Arbeit mit einer bedingten Änderung weiter; laufen zwei Aufrufe gleichzeitig, gewinnt einer.
// - Keine Importe aus index.ts; die Datenbank (Dienst-Zugang) und das Senden kommen als Parameter.
// - Wirft nie: Fehler stehen im Protokoll, die nächste Auswertung holt den Zeitraum nach.
import { kiAufruf, setzeAnlass } from '../_shared/kiVerbrauch.ts'
import { entschaerfe, kuerze, merkeWunsch, normTitel, OFFENE_STATUS, type WunschZeile } from '../_shared/wuensche.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>
/** Ein einfacher Aufruf des Modells: Anweisung rein, Text raus. */
export type ModellAufruf = (prompt: string) => Promise<string>

const TABELLE = 'abteilung_eintraege'
const STAND_ID = 'wunsch_stand'
export const AUSWERTUNG_STUNDEN = [8, 10, 12, 14, 16, 18, 20, 22]
const FENSTER_MINUTEN = 30
const TAG_MS = 24 * 60 * 60 * 1000
const MODELL = 'claude-haiku-5-5'

// Grenzen für den Auszug, der ins Modell geht.
export const GRENZE_MITARBEITER_TEXT = 500
export const GRENZE_ASSISTENT_TEXT = 400
export const GRENZE_FEHLER_TEXT = 120
export const GRENZE_JE_PERSON = 8000
export const GRENZE_GESAMT = 40000
const HOECHSTENS_ZEILEN = 15

// ---------------------------------------------------------------------------------------------
// Zeit in Berlin
// ---------------------------------------------------------------------------------------------

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const UHRZEIT = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

export function berlinZeit(jetzt: Date): { datum: string; stunde: number; minute: number } {
  const t: Record<string, string> = {}
  for (const p of BERLIN.formatToParts(jetzt)) t[p.type] = p.value
  return { datum: `${t.year}-${t.month}-${t.day}`, stunde: Number(t.hour) % 24, minute: Number(t.minute) }
}

function zeit(wert: unknown): number {
  const n = typeof wert === 'string' ? Date.parse(wert) : NaN
  return Number.isFinite(n) ? n : NaN
}

function alsObjekt(wert: unknown): Record<string, unknown> | null {
  return wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Record<string, unknown>) : null
}

// ---------------------------------------------------------------------------------------------
// Gesprächsauszüge
// ---------------------------------------------------------------------------------------------

export type MitarbeiterZeile = { name: string; email?: string | null; telegram_pending?: unknown }
export type Auszug = { text: string; personen: Map<string, string>; zuege: number }

type Werkzeugergebnis = { art: 'ok' | 'fehler' | 'abgelehnt' | 'nichts gefunden'; text?: string }

/** Ordnet das Ergebnis eines Werkzeugs ein — nur die Art, bei Fehlern und Ablehnungen der Anfang des Textes. */
export function werkzeugErgebnis(inhalt: unknown, namen: string[]): Werkzeugergebnis {
  const text = typeof inhalt === 'string'
    ? inhalt
    : Array.isArray(inhalt)
      ? inhalt.map((b) => (typeof alsObjekt(b)?.text === 'string' ? String(alsObjekt(b)!.text) : '')).join(' ')
      : ''
  const s = text.trim()
  const kurz = () => kuerze(entschaerfe(s.split('\n')[0], namen), GRENZE_FEHLER_TEXT)
  if (/^(Fehler|KI-Dienst|Da ist (gerade )?etwas schiefgelaufen)/i.test(s)) return { art: 'fehler', text: kurz() }
  if (/^(Nicht freigegeben|Nicht erlaubt|Nicht angelegt|Nicht erfasst|Nicht recherchiert|Nichts gesendet|Überschneidung)/.test(s)) return { art: 'abgelehnt', text: kurz() }
  if (/^(Kein|Keine|Es gibt keine)\b/.test(s)) return { art: 'nichts gefunden' }
  return { art: 'ok' }
}

/** Text der ersten Nachricht eines Zugs, für das Modell aufbereitet; null = ganzen Zug überspringen. */
function mitarbeiterText(inhalt: unknown): string | null {
  if (typeof inhalt !== 'string') return null
  const s = inhalt.trim()
  if (/^\[Systemmeldung/.test(s)) return null
  if (/^\[Datei-Eingang/.test(s)) return 'Mitarbeiter: (hat Dateien geschickt — Systemmeldung, Inhalt ausgelassen)'
  if (/^\[Weitergeleitete Nachricht/.test(s)) return 'Mitarbeiter: (hat eine Nachricht aus einem anderen Chat zum Ablegen weitergeleitet — Inhalt ausgelassen)'
  let text = s.replace(/\s*\[Vom CRM ergänzt[^\]]*\]\s*$/, '')
  let gesprochen = false
  const sprache = text.match(/^\[Sprachnachricht[^\]]*\]\s*/)
  if (sprache) {
    text = text.slice(sprache[0].length)
    gesprochen = true
  }
  if (/^\[/.test(text)) return null // unbekannte Systemnachricht
  if (!text.trim()) return null
  return `Mitarbeiter${gesprochen ? ' (gesprochen)' : ''}: ${kuerze(text, GRENZE_MITARBEITER_TEXT)}`
}

/** Ein Gesprächszug als kurze Zeilen: was der Mitarbeiter wollte, welche Werkzeuge mit welchem Ergebnis, die Antwort. */
export function zugAlsText(msgs: unknown[], namen: string[]): string | null {
  if (!Array.isArray(msgs) || msgs.length === 0) return null
  const erste = alsObjekt(msgs[0])
  if (erste?.role !== 'user') return null
  const kopf = mitarbeiterText(erste.content)
  if (!kopf) return null
  const zeilen = [kopf]
  const werkzeugNamen = new Map<string, string>()
  const werkzeuge: string[] = []
  let antwort = ''
  for (const m of msgs.slice(1)) {
    const n = alsObjekt(m)
    if (!n) continue
    if (n.role === 'assistant') {
      if (typeof n.content === 'string') antwort = n.content
      else if (Array.isArray(n.content)) {
        for (const b of n.content) {
          const block = alsObjekt(b)
          if (block?.type === 'tool_use' && typeof block.id === 'string') werkzeugNamen.set(block.id, String(block.name ?? 'unbekannt'))
          // Zwischentexte vor Werkzeug-Aufrufen sind meist „Ich sehe nach …“ — nur die Schlussantwort zählt.
        }
      }
    } else if (n.role === 'user' && Array.isArray(n.content)) {
      for (const b of n.content) {
        const block = alsObjekt(b)
        if (block?.type !== 'tool_result') continue
        const name = werkzeugNamen.get(String(block.tool_use_id)) ?? 'unbekannt'
        const e = werkzeugErgebnis(block.content, namen)
        werkzeuge.push(e.text ? `${name} ${e.art} („${e.text}“)` : `${name} ${e.art}`)
      }
    }
  }
  if (werkzeuge.length > 0) zeilen.push(`Werkzeuge: ${werkzeuge.join('; ')}`)
  if (antwort.trim()) zeilen.push(`Assistent: ${kuerze(antwort, GRENZE_ASSISTENT_TEXT)}`)
  return zeilen.join('\n')
}

/** Sammelt die Gesprächszüge aller Mitarbeiter mit Zeitpunkt in (von, bis]. Mitarbeiter heißen P1, P2 …;
 *  je Person höchstens GRENZE_JE_PERSON Zeichen (die jüngsten Züge zuerst behalten), insgesamt GRENZE_GESAMT. */
export function sammleAuszuege(team: MitarbeiterZeile[], von: Date, bis: Date, namen: string[] = []): Auszug {
  const personen = new Map<string, string>()
  const bloecke: string[] = []
  let zuege = 0
  let gesamt = 0
  for (const m of team) {
    const roh = alsObjekt(m.telegram_pending)
    const liste = Array.isArray(roh?.zuege) ? (roh!.zuege as unknown[]) : []
    const passend = liste
      .map((z) => alsObjekt(z))
      .filter((z): z is Record<string, unknown> => !!z && Array.isArray(z.msgs) && zeit(z.z) > von.getTime() && zeit(z.z) <= bis.getTime())
      .sort((a, b) => zeit(a.z) - zeit(b.z))
    const texte: string[] = []
    for (const z of passend) {
      const t = zugAlsText(z.msgs as unknown[], namen)
      if (t) texte.push(`[${UHRZEIT.format(new Date(zeit(z.z)))} Uhr]\n${t}`)
    }
    if (texte.length === 0) continue
    // Die jüngsten Züge behalten, bis die Grenze je Person erreicht ist.
    const behalten: string[] = []
    let laenge = 0
    for (let i = texte.length - 1; i >= 0; i--) {
      if (laenge + texte[i].length > GRENZE_JE_PERSON && behalten.length > 0) break
      behalten.unshift(texte[i].slice(0, GRENZE_JE_PERSON))
      laenge += Math.min(texte[i].length, GRENZE_JE_PERSON)
    }
    const label = `P${personen.size + 1}`
    const block = `=== ${label} ===\n${behalten.join('\n\n')}`
    if (gesamt + block.length > GRENZE_GESAMT) {
      const rest = GRENZE_GESAMT - gesamt
      if (rest < 500) break
      personen.set(label, m.name)
      bloecke.push(block.slice(0, rest))
      zuege += behalten.length
      gesamt = GRENZE_GESAMT
      break
    }
    personen.set(label, m.name)
    bloecke.push(block)
    zuege += behalten.length
    gesamt += block.length + 2
  }
  return { text: bloecke.join('\n\n'), personen, zuege }
}

// ---------------------------------------------------------------------------------------------
// Analyse durch das Modell
// ---------------------------------------------------------------------------------------------

export function baueAnalysePrompt(auszug: string, offeneTitel: string[]): string {
  const offen = offeneTitel.length > 0 ? offeneTitel.slice(0, 80).map((t) => `- ${t}`).join('\n') : '(keine)'
  return `Du wertest für die Geschäftsführung einer Firmengruppe aus, wo ihr CRM den eigenen Mitarbeitern nicht helfen konnte. Unten stehen Ausschnitte aus Gesprächen von Mitarbeitern mit dem CRM-Assistenten (per Telegram oder im CRM-Fenster). Die Mitarbeiter heißen dort nur P1, P2 usw. Je Gesprächszug siehst du, was der Mitarbeiter geschrieben hat, welche Werkzeuge der Assistent benutzt hat und mit welchem Ergebnis (ok, Fehler, abgelehnt, nichts gefunden), und die Antwort des Assistenten. Die Mitarbeiter haben zugestimmt, dass ihre Nutzung dafür ausgewertet wird. Bewertet werden Funktionen des CRM, nie Personen.

Deine Aufgabe:
1. Geh JEDE Bitte und jeden Auftrag der Mitarbeiter durch, auch knappe Befehle wie „mach …“, „schick …“, „leg … an“. Beurteile je Bitte: erfüllt, teilweise erfüllt oder nicht erfüllt.
2. Nicht oder nur teilweise erfüllt ist eine Bitte vor allem, wenn
- der Assistent ablehnt oder sagt, dass er es nicht kann;
- er nur einen Umweg anbietet (z. B. „mach das bitte im CRM selbst“);
- ein Werkzeug mit Fehler oder abgelehnt endet und die Bitte danach nicht doch noch erledigt wird;
- der Mitarbeiter dieselbe Bitte wiederholt oder umformuliert;
- der Mitarbeiter aufgibt oder es selbst macht („dann mach ich's selbst“);
- eine Rückfrage des Assistenten zu einer Bitte des Mitarbeiters offen bleibt und die Sache nicht erledigt ist.
Kein Punkt sind Angebote, die der Assistent von sich aus macht, ohne dass der Mitarbeiter darum gebeten hat (z. B. „Soll ich daraus noch eine Aufgabe machen?“), wenn der Mitarbeiter nicht darauf eingeht — das ist seine Entscheidung, kein Mangel des CRM.
Ausdrückliche Wünsche („wäre gut, wenn …“, „Wunsch: …“, „könnte das CRM …“) sind ebenfalls ein Punkt.
3. Erfüllte Bitten lässt du weg. Ebenso: Gruß, Dank, beantwortete Fragen; Fälle, in denen es einen Kunden schlicht nicht gibt, eine Angabe fehlte oder ein Bereich für den Mitarbeiter bewusst nicht freigegeben ist (kein Mangel des CRM, außer er beschwert sich darüber); Bitten, bei denen der Assistent sagt, er habe sie als Wunsch für die Geschäftsführung notiert (die sind schon erfasst).
4. Fasse gleiche Punkte zusammen, auch über Personen hinweg, und zähle, wie oft sie vorkamen.

Datenschutz, streng einhalten:
- Beschreibe alles auf Ebene der Funktion, z. B. „Exposé direkt per WhatsApp verschicken“. Keine Namen von Kunden, Firmen oder anderen Personen, keine Beträge, Adressen, Telefonnummern, E-Mail-Adressen, keine Inhalte aus Unterlagen oder Mails. Statt eines Namens schreibst du „ein Kunde“, „ein Objekt“, „eine Unterlage“.
- „beleg“ ist eine kurze, anonyme Umschreibung dessen, was passiert ist (höchstens 160 Zeichen), nie ein Zitat.

Schon erfasste offene Wünsche. Passt ein Punkt zu einem davon, übernimm genau diesen Titel:
${offen}

Antworte NUR mit einem JSON-Objekt in genau dieser Form, ohne weiteren Text und ohne Codeblock:
{"punkte":[{"titel":"…","beschreibung":"…","grund":"Funktion fehlt","erfuellt":"nicht","wer":["P1"],"anzahl":1,"beleg":"…","geht_schon":"unklar"}]}
- titel: höchstens 70 Zeichen, deutsch, ohne englische Begriffe, beschreibt die gewünschte Funktion.
- beschreibung: ein bis zwei Sätze: was gewollt war und warum es nicht ging.
- grund: genau einer von „Funktion fehlt“, „Fehler“, „nur Umweg möglich“, „Rückfrage blieb offen“, „Wunsch“.
- erfuellt: „nicht“ oder „teilweise“.
- geht_schon: „ja“ nur, wenn das Gespräch zeigt, dass das CRM das eigentlich schon kann (z. B. der Assistent nennt einen Weg im CRM, den der Mitarbeiter nicht kannte); „nein“, wenn es klar fehlt; sonst „unklar“.
Gibt es nichts, antworte {"punkte":[]}.

Gesprächsausschnitte:
${auszug}`
}

export type Punkt = {
  titel: string
  beschreibung: string
  grund: string
  erfuellt: 'nicht' | 'teilweise'
  wer: string[]
  anzahl: number
  beleg: string
  geht_schon: 'ja' | 'nein' | 'unklar'
}

const GRUENDE = ['Funktion fehlt', 'Fehler', 'nur Umweg möglich', 'Rückfrage blieb offen', 'Wunsch']

/** Liest die Antwort des Modells; unbrauchbare Teile fallen weg. Wirft, wenn gar kein JSON zu finden ist. */
export function leseAntwort(text: string, namen: string[] = []): Punkt[] {
  const anfang = text.indexOf('{')
  const ende = text.lastIndexOf('}')
  if (anfang < 0 || ende <= anfang) throw new Error('Antwort des Modells enthält kein JSON.')
  const roh = JSON.parse(text.slice(anfang, ende + 1))
  const liste = Array.isArray(roh?.punkte) ? roh.punkte : []
  const punkte: Punkt[] = []
  for (const p of liste.slice(0, 40)) {
    const o = alsObjekt(p)
    if (!o) continue
    const titel = kuerze(entschaerfe(String(o.titel ?? ''), namen), 90)
    if (!normTitel(titel)) continue
    const grund = GRUENDE.includes(String(o.grund)) ? String(o.grund) : 'Funktion fehlt'
    punkte.push({
      titel,
      beschreibung: kuerze(entschaerfe(String(o.beschreibung ?? ''), namen), 400),
      grund,
      erfuellt: o.erfuellt === 'teilweise' ? 'teilweise' : 'nicht',
      wer: Array.isArray(o.wer) ? o.wer.map(String).filter((w) => /^P\d+$/.test(w)) : [],
      anzahl: Math.min(50, Math.max(1, Math.round(Number(o.anzahl) || 1))),
      beleg: kuerze(entschaerfe(String(o.beleg ?? ''), namen), 160),
      geht_schon: o.geht_schon === 'ja' ? 'ja' : o.geht_schon === 'nein' ? 'nein' : 'unklar',
    })
  }
  return punkte
}

async function haikuAufruf(prompt: string): Promise<string> {
  const schluessel = Deno.env.get('ANTHROPIC_API_KEY')
  if (!schluessel) throw new Error('ANTHROPIC_API_KEY ist nicht gesetzt.')
  setzeAnlass('wunsch_analyse')
  const res = await kiAufruf('email-gateway', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: { 'x-api-key': schluessel, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    // Haiku 5.5 denkt von sich aus nach, und das zählt gegen max_tokens — deshalb reichlich Platz.
    body: JSON.stringify({ model: MODELL, max_tokens: 12_000, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Anthropic-API-Fehler (${res.status}): ${detail.slice(0, 300)}`)
  }
  const data = await res.json()
  // deno-lint-ignore no-explicit-any
  const text = (data.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
  if (!text.trim()) throw new Error(`Keine Textantwort vom Modell (stop_reason: ${data.stop_reason ?? 'unbekannt'}).`)
  return text
}

// ---------------------------------------------------------------------------------------------
// Probleme auf dem Server
// ---------------------------------------------------------------------------------------------

export type Problem = { titel: string; beschreibung: string; anzahl: number }

/** Namen von Kunden und Firmen — nur, um sie aus Texten herauszuhalten. */
async function ladeNamen(admin: Db): Promise<string[]> {
  const { data } = await alleZeilen(() => admin.from('kunden').select('firma, ansprechpartner'))
  const namen: string[] = []
  for (const k of (data ?? []) as { firma?: string | null; ansprechpartner?: string | null }[]) {
    for (const n of [k.firma, k.ansprechpartner]) if (typeof n === 'string' && n.trim()) namen.push(n.trim())
  }
  return namen
}

function zustandZeit(z: Record<string, unknown>): number {
  for (const f of ['aktualisiertAm', 'abgeschlossenAm', 'gestartetAm']) {
    const t = zeit(z[f])
    if (Number.isFinite(t)) return t
  }
  return NaN
}

/** Zählt Analyse-Zustände: gescheitert im Zeitraum bzw. „läuft“, aber seit über einer Stunde ohne Fortschritt. */
function zaehleZustaende(werte: unknown[], vonMs: number, bisMs: number): { fehler: number; haengt: number } {
  let fehler = 0
  let haengt = 0
  for (const w of werte) {
    const z = alsObjekt(w)
    if (!z) continue
    const t = zustandZeit(z)
    if (z.status === 'fehler' && t > vonMs && t <= bisMs) fehler++
    if (z.status === 'laeuft' && Number.isFinite(t) && bisMs - t > 60 * 60 * 1000) haengt++
  }
  return { fehler, haengt }
}

async function ladeSeiten(abfrage: (von: number, bis: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>, hoechstens = 20000): Promise<unknown[]> {
  const alle: unknown[] = []
  for (let von = 0; von < hoechstens; von += 1000) {
    const { data, error } = await abfrage(von, von + 999)
    if (error) throw new Error(error.message)
    alle.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return alle
}

/** Auffällig viele KI-Aufrufe für einen Anlass: heute mindestens 30 und mindestens das Dreifache des
 *  Tagesschnitts der sieben Tage davor (mindestens 5). Erst ab drei Tagen Vorlauf in der Tabelle. Nur Zahlen. */
export function kiAuffaelligkeiten(zeilen: { funktion?: string | null; anlass?: string | null; am: string }[], jetzt: Date): Problem[] {
  const bis = jetzt.getTime()
  const heuteAb = bis - TAG_MS
  const vorherAb = bis - 8 * TAG_MS
  let aeltester = Infinity
  const heute = new Map<string, number>()
  const vorher = new Map<string, number>()
  for (const z of zeilen) {
    const t = zeit(z.am)
    if (!Number.isFinite(t) || t > bis || t <= vorherAb) continue
    aeltester = Math.min(aeltester, t)
    const schluessel = `${z.funktion ?? ''}|${z.anlass || 'ohne Anlass'}`
    const ziel = t > heuteAb ? heute : vorher
    ziel.set(schluessel, (ziel.get(schluessel) ?? 0) + 1)
  }
  if (!(bis - aeltester >= 3 * TAG_MS)) return []
  const probleme: Problem[] = []
  for (const [schluessel, n] of heute) {
    const schnitt = (vorher.get(schluessel) ?? 0) / 7
    if (n >= 30 && n >= 3 * Math.max(schnitt, 5)) {
      const [funktion, anlass] = schluessel.split('|')
      probleme.push({
        titel: `Auffällig viele KI-Aufrufe: ${anlass}`,
        beschreibung: `${n} Aufrufe in 24 Stunden (${funktion}), sonst etwa ${Math.round(schnitt)} am Tag. Kann auf Wiederholungen nach Fehlern hindeuten.`,
        anzahl: n,
      })
    }
  }
  return probleme
}

/** Alle Probleme auf dem Server im Zeitraum (von, bis] — nur Zahlen und Funktionsnamen, keine Kunden. */
export async function sammleProbleme(admin: Db, von: Date, bis: Date, namen: string[] = []): Promise<Problem[]> {
  const vonMs = von.getTime()
  const bisMs = bis.getTime()
  const vonIso = von.toISOString()
  const probleme: Problem[] = []
  const sicher = async (wo: string, arbeit: () => Promise<void>) => {
    try {
      await arbeit()
    } catch (err) {
      console.error(`Wunsch-Auswertung: ${wo} nicht lesbar:`, err instanceof Error ? err.message : err)
    }
  }
  const dazu = (anzahl: number, titel: string, beschreibung: string) => {
    if (anzahl > 0) probleme.push({ titel, beschreibung, anzahl })
  }

  await sicher('Objekt-Bewertungen', async () => {
    // Private Objekte (Bereich Privat) gehören einem Einzelnen und zählen im Bericht an die Admins nicht mit.
    const { data, error } = await admin.from('objekte').select('id, bewertung').in('bewertung->>status', ['fehler', 'laeuft']).is('privat_besitzer', null)
    if (error) throw new Error(error.message)
    const z = zaehleZustaende(((data ?? []) as { bewertung?: unknown }[]).map((o) => o.bewertung), vonMs, bisMs)
    dazu(z.fehler, 'Objektbewertung scheiterte', 'Die Bewertung eines Objekts endete mit einem Fehler.')
    dazu(z.haengt, 'Objektbewertung hängt', 'Eine Objektbewertung läuft seit über einer Stunde ohne Fortschritt.')
  })

  await sicher('Analysen der Kunden', async () => {
    const { data, error } = await admin
      .from('kunden')
      .select('id, bereich, steuer_analyse, unternehmensbewertung_recherche')
      .or('steuer_analyse->>status.in.(fehler,laeuft),unternehmensbewertung_recherche->>status.in.(fehler,laeuft)')
    if (error) throw new Error(error.message)
    // Private Kontakte zählen nicht mit (wie private Objekte oben).
    const zeilen = ((data ?? []) as { bereich?: string | null; steuer_analyse?: unknown; unternehmensbewertung_recherche?: unknown }[]).filter((k) => k.bereich !== 'privat')
    const steuer = zaehleZustaende(zeilen.map((k) => k.steuer_analyse), vonMs, bisMs)
    const recherche = zaehleZustaende(zeilen.map((k) => k.unternehmensbewertung_recherche), vonMs, bisMs)
    dazu(steuer.fehler, 'Steuer-Analyse scheiterte', 'Die Steuer-Analyse einer Kundenakte endete mit einem Fehler.')
    dazu(steuer.haengt, 'Steuer-Analyse hängt', 'Eine Steuer-Analyse läuft seit über einer Stunde ohne Fortschritt.')
    dazu(recherche.fehler, 'Unternehmensbewertung scheiterte', 'Die Recherche zur Unternehmensbewertung endete mit einem Fehler.')
    dazu(recherche.haengt, 'Unternehmensbewertung hängt', 'Eine Recherche zur Unternehmensbewertung läuft seit über einer Stunde ohne Fortschritt.')
  })

  await sicher('Bonitätseinschätzungen', async () => {
    const { data, error } = await admin.from('kunden').select('id, bereich, bonitaet').gte('bonitaet->>erstelltAm', vonIso)
    if (error) throw new Error(error.message)
    let ohne = 0
    let register = 0
    for (const k of (data ?? []) as { bereich?: string | null; bonitaet?: unknown }[]) {
      if (k.bereich === 'privat') continue
      const b = alsObjekt(k.bonitaet)
      const t = zeit(b?.erstelltAm)
      if (!b || !(t > vonMs && t <= bisMs)) continue
      if (b.ampel === 'nicht_beurteilbar') ohne++
      if (b.webRecherche === 'fehlgeschlagen') register++
    }
    dazu(ohne, 'Bonitätseinschätzung ohne Ergebnis', 'Eine Bonitätseinschätzung kam zu keinem Urteil (nicht beurteilbar).')
    dazu(register, 'Registersuche bei Bonitätseinschätzung scheiterte', 'Die Suche in öffentlichen Registern für eine Bonitätseinschätzung schlug fehl.')
  })

  await sicher('Dokumente', async () => {
    const { data, error } = await admin.from('dokument_inhalte').select('schluessel, status, aktualisiert_am').eq('status', 'fehler').gte('aktualisiert_am', vonIso)
    if (error) throw new Error(error.message)
    const n = ((data ?? []) as { status: string; aktualisiert_am: string }[]).filter((d) => d.status === 'fehler' && zeit(d.aktualisiert_am) > vonMs && zeit(d.aktualisiert_am) <= bisMs).length
    dazu(n, 'Dokument konnte nicht gelesen werden', 'Das Einlesen eines Dokuments (Abschrift und Kurzfassung) schlug fehl.')
  })

  await sicher('Telegram-Warteschlange', async () => {
    const grenze = new Date(bisMs - 30 * 60 * 1000).toISOString()
    const { data, error } = await admin.from('telegram_warteschlange').select('id, erstellt_am').lt('erstellt_am', grenze)
    if (error) throw new Error(error.message)
    const n = ((data ?? []) as { erstellt_am: string }[]).filter((z) => zeit(z.erstellt_am) < bisMs - 30 * 60 * 1000).length
    dazu(n, 'Dateien hängen in der Telegram-Warteschlange', 'Per Telegram geschickte Dateien warten seit über 30 Minuten auf die Ablage.')
  })

  await sicher('Fehler im Browser', async () => {
    const { data, error } = await admin.from('app_fehler').select('meldung, seite, am').gte('am', vonIso).order('am', { ascending: false }).limit(1000)
    if (error) throw new Error(error.message)
    const gruppen = new Map<string, { meldung: string; seiten: Set<string>; anzahl: number }>()
    for (const f of (data ?? []) as { meldung?: string | null; seite?: string | null; am: string }[]) {
      const t = zeit(f.am)
      if (!(t > vonMs && t <= bisMs)) continue
      const meldung = kuerze(entschaerfe(String(f.meldung ?? 'Unbekannter Fehler'), namen).replace(/\d+/g, '#'), 70)
      const g = gruppen.get(meldung) ?? { meldung, seiten: new Set<string>(), anzahl: 0 }
      g.anzahl++
      const seite = String(f.seite ?? '').replace(/[?#].*$/, '').replace(/\/[A-Za-z0-9_-]{12,}/g, '/…')
      if (seite) g.seiten.add(kuerze(seite, 40))
      gruppen.set(meldung, g)
    }
    for (const g of [...gruppen.values()].sort((a, b) => b.anzahl - a.anzahl).slice(0, 5)) {
      const seiten = [...g.seiten].slice(0, 3).join(', ')
      dazu(g.anzahl, `Fehler im CRM: ${g.meldung}`, `Fehlermeldung im Browser${seiten ? ` auf ${seiten}` : ''}.`)
    }
  })

  await sicher('KI-Verbrauch', async () => {
    const ab = new Date(bisMs - 8 * TAG_MS).toISOString()
    const zeilen = await ladeSeiten((a, b) => admin.from('ki_verbrauch').select('funktion, anlass, am').gte('am', ab).order('am', { ascending: true }).range(a, b))
    probleme.push(...kiAuffaelligkeiten(zeilen as { funktion?: string; anlass?: string; am: string }[], bis))
  })

  return probleme
}

// ---------------------------------------------------------------------------------------------
// Bericht
// ---------------------------------------------------------------------------------------------

export type Empfaenger = { name: string; email: string; chat: number | string }

/** Aktive Mitarbeiter mit Admin-Recht UND verknüpftem Telegram. Ist WUNSCH_BERICHT_AN gesetzt
 *  (E-Mail-Adressen, durch Komma getrennt), nur die davon. */
export async function ladeEmpfaenger(admin: Db, nurAn?: string[]): Promise<Empfaenger[]> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, aktiv, ist_admin, telegram_chat_id').eq('aktiv', true).eq('ist_admin', true)
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  const filter = (nurAn ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)
  return ((data ?? []) as { name: string; email: string; aktiv: boolean; ist_admin: boolean; telegram_chat_id: number | string | null }[])
    .filter((m) => m.aktiv === true && m.ist_admin === true && !!m.telegram_chat_id)
    .filter((m) => filter.length === 0 || filter.includes(String(m.email).toLowerCase()))
    .map((m) => ({ name: m.name, email: String(m.email).toLowerCase(), chat: m.telegram_chat_id! }))
}

/** Empfänger-Auswahl: Umgebungsvariable WUNSCH_BERICHT_AN, sonst `berichtAn` in der Buchhaltungszeile
 *  (wunsch_stand). Ist beides leer, gehen Berichte an alle Admins mit Telegram. */
async function berichtFilter(admin: Db): Promise<string[] | undefined> {
  try {
    const wert = Deno.env.get('WUNSCH_BERICHT_AN')
    if (wert) return wert.split(',')
  } catch { /* ohne Umgebung weiter mit der Datenbank */ }
  try {
    const { data } = await admin.from(TABELLE).select('daten').eq('id', STAND_ID).maybeSingle()
    const liste = (alsObjekt(data?.daten) as { berichtAn?: unknown } | null)?.berichtAn
    return Array.isArray(liste) && liste.length > 0 ? liste.map(String) : undefined
  } catch {
    return undefined
  }
}

/** Einträge, die in den letzten 24 Stunden neu sind oder hochgezählt wurden und noch nicht gemeldet sind. */
export function zuMelden(zeilen: WunschZeile[], jetzt: Date): WunschZeile[] {
  const ab = jetzt.getTime() - TAG_MS
  return zeilen.filter((z) => {
    const zuletzt = zeit(z.zuletzt_am)
    if (!(zuletzt > ab)) return false
    if (!OFFENE_STATUS.includes(z.status)) return false
    const gemeldet = zeit(z.gemeldet_am)
    return !Number.isFinite(gemeldet) || gemeldet < zuletzt
  })
}

/** Text der Telegram-Nachricht; null, wenn nichts zu melden ist. `heute` = Anzahl je Eintrag in diesem Lauf. */
export function berichtText(eintraege: WunschZeile[], heute: Map<string, number> = new Map()): string | null {
  const wuensche = eintraege.filter((e) => e.quelle !== 'fehler').sort((a, b) => b.anzahl - a.anzahl)
  const probleme = eintraege.filter((e) => e.quelle === 'fehler').sort((a, b) => (heute.get(b.id) ?? b.anzahl) - (heute.get(a.id) ?? a.anzahl))
  if (wuensche.length === 0 && probleme.length === 0) return null
  const teile: string[] = []
  if (wuensche.length > 0) {
    const zeilen = wuensche.slice(0, HOECHSTENS_ZEILEN).map((w) => {
      const grund = /Grund: ([^.]+)\./.exec(w.beschreibung ?? '')?.[1]
      return `• ${w.titel}${w.mitarbeiter ? ` – ${w.mitarbeiter}` : ''}${w.anzahl > 1 ? ` (${w.anzahl}×)` : ''}${grund ? ` – ${grund}` : ''}`
    })
    if (wuensche.length > HOECHSTENS_ZEILEN) zeilen.push(`… und ${wuensche.length - HOECHSTENS_ZEILEN} weitere`)
    teile.push(`Neu seit der letzten Meldung (${wuensche.length}):\n${zeilen.join('\n')}`)
  }
  if (probleme.length > 0) {
    const zeilen = probleme.slice(0, HOECHSTENS_ZEILEN).map((p) => `• ${p.titel} ${heute.get(p.id) ?? p.anzahl}×`)
    if (probleme.length > HOECHSTENS_ZEILEN) zeilen.push(`… und ${probleme.length - HOECHSTENS_ZEILEN} weitere`)
    teile.push(`Probleme seit der letzten Meldung:\n${zeilen.join('\n')}`)
  }
  teile.push('Alle Wünsche im CRM unter Wünsche.')
  return teile.join('\n\n')
}

// ---------------------------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------------------------

export type Optionen = {
  jetzt?: Date
  modell?: ModellAufruf
  /** Nur an diese E-Mail-Adressen berichten (Vorgabe: Umgebungsvariable WUNSCH_BERICHT_AN, sonst alle Admins mit Telegram). */
  berichtAn?: string[]
}

export type GefundenerPunkt = Punkt & { wer_namen: string[] }

type Auswertung = { punkte: GefundenerPunkt[]; zuege: number; personen: number; fehler?: string }

/** Wertet die Gespräche im Zeitraum (von, bis] aus. Schreibt nichts. */
async function werteGespraecheAus(admin: Db, von: Date, bis: Date, namen: string[], offeneTitel: string[], modell: ModellAufruf): Promise<Auswertung> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, aktiv, telegram_pending').eq('aktiv', true)
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  const team = ((data ?? []) as (MitarbeiterZeile & { aktiv?: boolean })[]).filter((m) => m.aktiv !== false)
  const auszug = sammleAuszuege(team, von, bis, namen)
  if (auszug.zuege === 0) return { punkte: [], zuege: 0, personen: 0 }
  const antwort = await modell(baueAnalysePrompt(auszug.text, offeneTitel))
  const punkte = leseAntwort(antwort, namen).map((p) => ({ ...p, wer_namen: p.wer.map((w) => auszug.personen.get(w)).filter((n): n is string => !!n) }))
  return { punkte, zuege: auszug.zuege, personen: auszug.personen.size }
}

function beschreibungMitGrund(p: Punkt): string {
  const zusatz = p.geht_schon === 'ja' ? ' Geht laut Gespräch vermutlich schon im CRM.' : ''
  return `${p.beschreibung}${p.beschreibung && !/[.!?]$/.test(p.beschreibung) ? '.' : ''} Grund: ${p.grund}.${p.erfuellt === 'teilweise' ? ' Nur teilweise erledigt.' : ''}${zusatz}`.trim()
}

async function ladeOffene(admin: Db): Promise<WunschZeile[]> {
  const { data, error } = await admin.from('wuensche').select('*').in('status', OFFENE_STATUS)
  if (error) throw new Error(`Wünsche nicht lesbar: ${error.message}`)
  return (data ?? []) as WunschZeile[]
}

/** Schreibt Punkte und Probleme in `wuensche`. Liefert die Anzahl je Eintrag aus diesem Lauf. */
async function schreibe(admin: Db, punkte: GefundenerPunkt[], probleme: Problem[], jetzt: Date, offene: WunschZeile[]): Promise<Map<string, number>> {
  const heute = new Map<string, number>()
  for (const p of punkte) {
    const ergebnis = await merkeWunsch(admin, { quelle: 'analyse', mitarbeiter: p.wer_namen, titel: p.titel, beschreibung: beschreibungMitGrund(p), beleg: p.beleg || null, anzahl: p.anzahl }, jetzt, offene)
    if (ergebnis) heute.set(ergebnis.id, (heute.get(ergebnis.id) ?? 0) + p.anzahl)
  }
  // Ein Problem nur einmal am Tag melden (21.11.2026): Die Zählung umfasst immer 24 Stunden, ein einmal
  // aufgetretenes Problem bliebe sonst bis zum nächsten Tag in jedem Zwei-Stunden-Bericht. Als erledigt
  // markierte Probleme der letzten zwei Tage werden nicht neu angelegt.
  const { data: kuerzlich } = await admin.from('wuensche').select('titel, status, gemeldet_am').eq('quelle', 'fehler').gte('zuletzt_am', new Date(jetzt.getTime() - 2 * TAG_MS).toISOString())
  const ruhig = new Set(
    ((kuerzlich ?? []) as { titel: string; status: string; gemeldet_am: string | null }[])
      .filter((z) => z.status === 'erledigt' || zeit(z.gemeldet_am) > jetzt.getTime() - TAG_MS)
      .map((z) => normTitel(z.titel)),
  )
  for (const pr of probleme) {
    if (ruhig.has(normTitel(pr.titel))) continue
    const ergebnis = await merkeWunsch(admin, { quelle: 'fehler', mitarbeiter: null, titel: pr.titel, beschreibung: pr.beschreibung, anzahl: pr.anzahl }, jetzt, offene)
    if (ergebnis) heute.set(ergebnis.id, (heute.get(ergebnis.id) ?? 0) + pr.anzahl)
  }
  return heute
}

/** Schickt den Bericht und vermerkt `gemeldet_am`. Liefert die Zahl der zugestellten Nachrichten. */
async function berichte(admin: Db, sende: SendeFunktion, jetzt: Date, heute: Map<string, number>, berichtAn?: string[]): Promise<{ gesendet: number; text: string | null; empfaenger: string[] }> {
  const { data, error } = await admin.from('wuensche').select('*').gte('zuletzt_am', new Date(jetzt.getTime() - TAG_MS).toISOString())
  if (error) throw new Error(`Wünsche nicht lesbar: ${error.message}`)
  const eintraege = zuMelden((data ?? []) as WunschZeile[], jetzt)
  const text = berichtText(eintraege, heute)
  if (!text) return { gesendet: 0, text: null, empfaenger: [] }
  const empfaenger = await ladeEmpfaenger(admin, berichtAn ?? (await berichtFilter(admin)))
  let gesendet = 0
  for (const e of empfaenger) if (await sende(e.chat, text)) gesendet++
  if (gesendet > 0) {
    const { error: fehler } = await admin.from('wuensche').update({ gemeldet_am: jetzt.toISOString() }).in('id', eintraege.map((e) => e.id))
    if (fehler) console.error('Wunsch-Bericht: gemeldet_am nicht gesetzt:', fehler.message)
  }
  return { gesendet, text, empfaenger: empfaenger.map((e) => e.name) }
}

type Stand = { slot?: string; bis?: string; berichtTag?: string; version?: string; berichtAn?: string[] }

export type LaufErgebnis = { gelaufen: boolean; zuege: number; punkte: number; probleme: number; gesendet: number }

/** Vom Minutentakt gerufen. Außerhalb der Auswertungsstunden ohne Datenbankzugriff. Wirft nie. */
export async function pruefeWunschAnalyse(admin: Db, sende: SendeFunktion, optionen: Optionen = {}): Promise<LaufErgebnis> {
  const ergebnis: LaufErgebnis = { gelaufen: false, zuege: 0, punkte: 0, probleme: 0, gesendet: 0 }
  try {
    await lauf(admin, sende, optionen, ergebnis)
  } catch (err) {
    console.error('Wunsch-Auswertung fehlgeschlagen:', err instanceof Error ? err.message : err)
  }
  return ergebnis
}

async function lauf(admin: Db, sende: SendeFunktion, optionen: Optionen, ergebnis: LaufErgebnis): Promise<void> {
  const jetzt = optionen.jetzt ?? new Date()
  const b = berlinZeit(jetzt)
  if (!AUSWERTUNG_STUNDEN.includes(b.stunde) || b.minute >= FENSTER_MINUTEN) return
  const slot = `${b.datum}|${b.stunde}`

  // ---- Stand lesen und den Lauf beanspruchen ----
  const { data: zeile, error: lesefehler } = await admin.from(TABELLE).select('daten').eq('id', STAND_ID).maybeSingle()
  if (lesefehler) throw new Error(`Stand nicht lesbar: ${lesefehler.message}`)
  const stand: Stand = (alsObjekt(zeile?.daten) as Stand | null) ?? {}
  if (stand.slot === slot) return
  const neu: Stand = { ...stand, slot, version: crypto.randomUUID(), berichtTag: b.datum }
  const jetztIso = jetzt.toISOString()
  if (!zeile) {
    const { error } = await admin.from(TABELLE).insert({ id: STAND_ID, art: STAND_ID, daten: neu, updated_at: jetztIso })
    if (error) return // ein gleichzeitiger Lauf hat die Zeile angelegt
  } else {
    let anspruch = admin.from(TABELLE).update({ daten: neu, updated_at: jetztIso }).eq('id', STAND_ID)
    anspruch = stand.version ? anspruch.eq('daten->>version', stand.version) : anspruch
    const { data: beansprucht, error } = await anspruch.select('id')
    if (error) throw new Error(`Stand nicht schreibbar: ${error.message}`)
    if (!Array.isArray(beansprucht) || beansprucht.length === 0) return
  }
  ergebnis.gelaufen = true

  // ---- Gespräche seit der letzten Auswertung (höchstens 24 Stunden) ----
  const bisher = zeit(stand.bis)
  const von = new Date(Math.max(jetzt.getTime() - TAG_MS, Number.isFinite(bisher) ? bisher : -Infinity))
  const namen = await ladeNamen(admin)
  const offene = await ladeOffene(admin)
  let punkte: GefundenerPunkt[] = []
  try {
    const a = await werteGespraecheAus(admin, von, jetzt, namen, offene.map((o) => o.titel), optionen.modell ?? haikuAufruf)
    punkte = a.punkte
    ergebnis.zuege = a.zuege
    // Zeitraum erst als ausgewertet vermerken, wenn das Modell geantwortet hat — sonst holt die nächste Auswertung ihn nach.
    const { data: aktuell } = await admin.from(TABELLE).select('daten').eq('id', STAND_ID).maybeSingle()
    await admin.from(TABELLE).update({ daten: { ...((alsObjekt(aktuell?.daten) as Stand | null) ?? neu), bis: jetztIso }, updated_at: jetztIso }).eq('id', STAND_ID)
  } catch (err) {
    console.error('Wunsch-Auswertung der Gespräche fehlgeschlagen:', err instanceof Error ? err.message : err)
  }

  // ---- Nach JEDER Auswertung: Probleme auf dem Server seit der letzten Auswertung und die Meldung ----
  // Eray (19.11.2026): Er will nicht bis 18 Uhr warten, sondern gleich erfahren, wenn etwas nicht geht.
  // `berichte` sendet nur, wenn es seit der letzten Meldung Neues gibt (`gemeldet_am`) — ohne Fund keine Nachricht.
  const probleme: Problem[] = await sammleProbleme(admin, von, jetzt, namen)
  const heute = await schreibe(admin, punkte, probleme, jetzt, offene)
  ergebnis.punkte = punkte.length
  ergebnis.probleme = probleme.length
  ergebnis.gesendet = (await berichte(admin, sende, jetzt, heute, optionen.berichtAn)).gesendet
}

// ---------------------------------------------------------------------------------------------
// Probelauf (nur mit Dienst-Schlüssel, siehe Aktion wunsch_analyse_test in index.ts)
// ---------------------------------------------------------------------------------------------

export type TestOptionen = { senden?: unknown; stunden?: unknown; schreiben?: unknown; jetzt?: unknown }

export type TestErgebnis = {
  ok: true
  zeitraum: { von: string; bis: string }
  zuege: number
  personen: number
  punkte: GefundenerPunkt[]
  probleme: Problem[]
  gespraechsFehler?: string
  geschrieben: boolean
  bericht: string | null
  empfaenger: string[]
  gesendet: number
}

/** Sofortige Auswertung ohne Zeitfenster und ohne die Buchhaltungszeile anzufassen. Schreibt in
 *  `wuensche` nur mit `schreiben` (Vorgabe: ja), sendet nur mit `senden: true`. */
export async function wunschAnalyseTest(admin: Db, sende: SendeFunktion, o: TestOptionen, modell: ModellAufruf = haikuAufruf, berichtAn?: string[]): Promise<TestErgebnis> {
  const jetzt = typeof o.jetzt === 'string' && Number.isFinite(Date.parse(o.jetzt)) ? new Date(o.jetzt) : new Date()
  const stunden = Math.min(48, Math.max(1, Number(o.stunden) || 24))
  const von = new Date(jetzt.getTime() - stunden * 60 * 60 * 1000)
  const schreiben = o.schreiben !== false
  const senden = o.senden === true
  const namen = await ladeNamen(admin)
  const offene = await ladeOffene(admin)
  let auswertung: Auswertung = { punkte: [], zuege: 0, personen: 0 }
  try {
    auswertung = await werteGespraecheAus(admin, von, jetzt, namen, offene.map((z) => z.titel), modell)
  } catch (err) {
    auswertung.fehler = err instanceof Error ? err.message : String(err)
  }
  const probleme = await sammleProbleme(admin, von, jetzt, namen)
  const ergebnis: TestErgebnis = {
    ok: true,
    zeitraum: { von: von.toISOString(), bis: jetzt.toISOString() },
    zuege: auswertung.zuege,
    personen: auswertung.personen,
    punkte: auswertung.punkte,
    probleme,
    ...(auswertung.fehler ? { gespraechsFehler: auswertung.fehler } : {}),
    geschrieben: schreiben,
    bericht: null,
    empfaenger: [],
    gesendet: 0,
  }
  if (schreiben) {
    const heute = await schreibe(admin, auswertung.punkte, probleme, jetzt, offene)
    if (senden) {
      const b = await berichte(admin, sende, jetzt, heute, berichtAn)
      Object.assign(ergebnis, { bericht: b.text, empfaenger: b.empfaenger, gesendet: b.gesendet })
    } else {
      const { data } = await admin.from('wuensche').select('*').gte('zuletzt_am', new Date(jetzt.getTime() - TAG_MS).toISOString())
      ergebnis.bericht = berichtText(zuMelden((data ?? []) as WunschZeile[], jetzt), heute)
      ergebnis.empfaenger = (await ladeEmpfaenger(admin, berichtAn ?? (await berichtFilter(admin)))).map((e) => e.name)
    }
  } else {
    // Nichts schreiben: den Bericht aus dem bestehenden Stand plus den Funden dieses Laufs vorhersagen.
    const vorschau = vorschauEintraege(offene, auswertung.punkte, probleme, jetzt)
    ergebnis.bericht = berichtText(vorschau.zeilen, vorschau.heute)
    const empfaenger = await ladeEmpfaenger(admin, berichtAn ?? (await berichtFilter(admin)))
    ergebnis.empfaenger = empfaenger.map((e) => e.name)
    if (senden && ergebnis.bericht) for (const e of empfaenger) if (await sende(e.chat, ergebnis.bericht)) ergebnis.gesendet++
  }
  return ergebnis
}

/** Wie der Bericht aussähe, ohne etwas zu schreiben (nur Funde dieses Laufs plus ungemeldete offene Einträge). */
function vorschauEintraege(offene: WunschZeile[], punkte: GefundenerPunkt[], probleme: Problem[], jetzt: Date): { zeilen: WunschZeile[]; heute: Map<string, number> } {
  const kopie = offene.map((z) => ({ ...z }))
  const heute = new Map<string, number>()
  const jetztIso = jetzt.toISOString()
  const merke = (quelle: WunschZeile['quelle'], titel: string, beschreibung: string, anzahl: number, wer: string[]) => {
    const vorhanden = kopie.find((z) => normTitel(z.titel) === normTitel(titel))
    if (vorhanden) {
      vorhanden.anzahl += anzahl
      vorhanden.zuletzt_am = jetztIso
      const namenListe = (vorhanden.mitarbeiter ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      for (const w of wer) if (!namenListe.includes(w)) namenListe.push(w)
      vorhanden.mitarbeiter = namenListe.join(', ') || null
      heute.set(vorhanden.id, (heute.get(vorhanden.id) ?? 0) + anzahl)
      return
    }
    const id = `vorschau_${kopie.length}`
    kopie.push({ id, quelle, mitarbeiter: wer.join(', ') || null, titel, beschreibung, beleg: null, status: 'neu', anzahl, erstellt_am: jetztIso, zuletzt_am: jetztIso, gemeldet_am: null, notiz: null })
    heute.set(id, anzahl)
  }
  for (const p of punkte) merke('analyse', p.titel, beschreibungMitGrund(p), p.anzahl, p.wer_namen)
  for (const pr of probleme) merke('fehler', pr.titel, pr.beschreibung, pr.anzahl, [])
  return { zeilen: zuMelden(kopie, jetzt), heute }
}
