// Kontoauszüge auslesen — übernommen aus dem früheren Einzelprogramm „Kontoauszug → Excel“. Aufgerufen
// über die Aktion `kontoauszug_auslesen` (nur mit eigenem Login), EINE Datei je Aufruf. Die Oberfläche
// prüft das Ergebnis und speichert es selbst in der Tabelle kontoauszug_auswertungen; diese Aktion
// schreibt weder in die Datenbank noch in den Dateispeicher.
//
// Ablauf wie im Einzelprogramm: Ein PDF wird in Blöcke zu je drei Seiten geteilt (pdf-lib statt mupdf,
// das im Server zu groß wäre), die Blöcke werden parallel gelesen (höchstens vier gleichzeitig), ein
// gescheiterter Block wird einmal wiederholt. Fehlt danach noch ein Block, steht das mit den Seitenzahlen
// in `fehler` — es gehen keine Buchungen stillschweigend verloren. Ein Foto ist ein einziger Block.
//
// KI-Aufruf: callClaudeResearch ohne Websuche und ohne Nachdenken vor der Antwort (thinking
// between_tools), Antwort als JSON im Text. Ein erzwungenes Werkzeug geht bei Sonnet 5.5 nicht zusammen
// mit dem Nachdenken, und mit tool_choice „auto“ denkt das Modell erst nach — das kostet Zeit und zählt
// gegen max_tokens; bei langen Buchungslisten blieb dann kein Platz für die Antwort. So steht das ganze
// Kontingent der Buchungsliste zur Verfügung, und ein abgeschnittenes Ergebnis ist am stop_reason erkennbar.
//
// Keine Importe aus index.ts: Datenbank-Zugang und die gemeinsamen Helfer kommen als Parameter.

import { PDFDocument } from 'npm:pdf-lib@1.17.1'

// deno-lint-ignore no-explicit-any
type Db = any

/** Kategorien wie im Einzelprogramm (Reihenfolge = Sortierung bei gleicher Summe). „Sonstiges“ bleibt der letzte Eintrag. */
export const KONTO_KATEGORIEN = [
  'Einkommen & Gehalt',
  'Nebeneinkünfte & Erstattungen',
  'Miete & Wohnen',
  'Nebenkosten & Energie',
  'Lebensmittel & Supermarkt',
  'Drogerie & Gesundheit',
  'Restaurant, Café & Lieferdienst',
  'Mobilität & ÖPNV',
  'Auto & Tankstelle',
  'Reisen & Urlaub',
  'Versicherungen',
  'Abos & Streaming',
  'Telefon, Internet & Rundfunk',
  'Shopping & Bekleidung',
  'Elektronik & Haushalt',
  'Freizeit, Sport & Unterhaltung',
  'Bildung & Weiterbildung',
  'Kinder & Familie',
  'Bargeldabhebung',
  'Bankgebühren & Zinsen',
  'Steuern & Behörden',
  'Sparen, Anlage & Vorsorge',
  'Kredite & Finanzierung',
  'Spenden & Gemeinnütziges',
  'Umbuchung & Eigenübertrag',
  'Sonstiges',
] as const

export type KontoKategorie = (typeof KONTO_KATEGORIEN)[number]

/** Gleiche Form wie KontoBuchung in src/types/index.ts. Ausgaben negativ, Einnahmen positiv. */
export type KontoBuchung = {
  id: string
  datum: string
  wertstellung?: string | null
  text: string
  gegenpartei?: string | null
  betrag: number
  waehrung: string
  kategorie: string
  konto?: string | null
  quelle?: string
}

/** Gleiche Form wie KontoauszugDatei in src/types/index.ts. */
export type KontoauszugDatei = {
  name: string
  url?: string
  bank?: string | null
  iban?: string | null
  kontoinhaber?: string | null
  von?: string | null
  bis?: string | null
  anzahl: number
  fehler?: string
}

export type KontoauszugErgebnis =
  | { ok: true; buchungen: KontoBuchung[]; datei: KontoauszugDatei }
  | { ok: false; fehler: string; status: number }

type KontoBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

export type KontoauszugHelfer = {
  /** callClaudeResearch aus index.ts (Verbrauch wird dort gemessen). */
  callClaudeResearch: (
    prompt: KontoBlock[],
    opts: { model: 'claude-sonnet-5-5'; maxSearches: number; maxTokens?: number; timeoutMs?: number; ohneNachdenken?: boolean; meldeStopp?: (grund: string) => void },
  ) => Promise<string>
  /** ladeDokumentBytes aus index.ts (gemeinsame Ablage, Bucket kunden-dokumente oder https). */
  ladeDokumentBytes: (admin: Db, url: string) => Promise<Uint8Array>
  /** Wie lange dieser Worker noch sicher lebt (Millisekunden). */
  restMs: () => number
  /** Höchstdauer einer Anfrage, bevor die Plattform sie abbricht (SCHRITT_HOECHSTENS_MS). */
  hoechstensMs: number
}

// ---------------------------------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------------------------------

const MODELL = 'claude-sonnet-5-5' as const
export const SEITEN_JE_BLOCK = 3
const GLEICHZEITIG = 4
// Zwei Durchgänge zu je vier Blöcken passen in die Zeit; mehr nicht.
const MAX_SEITEN = SEITEN_JE_BLOCK * GLEICHZEITIG * 2
// Wie im Einzelprogramm 12.000 je Block, mit etwas Reserve (kostet nur, wenn es gebraucht wird).
const MAX_TOKENS = 16_000
const MAX_DATEI_BYTES = 20 * 1024 * 1024
// Grenze der Anthropic-Schnittstelle für ein einzelnes Bild.
const MAX_BILD_BYTES = 5 * 1024 * 1024
// Ein Block wird nur (neu) begonnen, wenn noch so viel Zeit bleibt.
const MINDEST_ZEIT_MS = 20_000
// Erste und letzte Buchungen benachbarter Blöcke, die auf doppelte Erfassung geprüft werden.
const RAND = 2

const ZU_LANG = 'Der Auszug ist zu lang für einen Durchgang'

function zuLangText(seiten: number): string {
  const teil = Math.min(MAX_SEITEN, 12)
  return `${ZU_LANG}${seiten ? ` (${seiten} Seiten)` : ''} — bitte die Datei in kleinere Teile (z. B. je ${teil} Seiten) aufteilen und die Teile einzeln auslesen.`
}

// ---------------------------------------------------------------------------------------------------
// Auftrag an die KI (Regeln wie im Einzelprogramm)
// ---------------------------------------------------------------------------------------------------

const AUFTRAG = `Du bist ein präzises Extraktionssystem für Bank-Kontoauszüge (deutsch und international).

Aufgabe: Lies den Kontoauszug (PDF oder Foto) und gib ALLE Buchungen strukturiert zurück.

Regeln:
- Der Ausschnitt kann mitten im Auszug beginnen oder enden. Nur echte Buchungszeilen erfassen. Beginnt der Ausschnitt mit dem Rest einer Buchung von der vorigen Seite (ohne eigenes Datum und ohne Betrag), lass diesen Rest weg.
- Jede Buchungszeile genau einmal. Nichts auslassen, nichts erfinden.
- Anfangssaldo, Endsaldo, Zwischensummen, "Übertrag" sind KEINE Buchungen.
- Beträge: Ausgaben/Soll negativ, Eingänge/Haben positiv. "1.234,56" -> 1234.56. Vorzeichen aus "S"/"H" bzw. "-"/"+" ableiten.
- Datum als YYYY-MM-DD; nur Tag/Monat -> Jahr aus dem Zeitraum (Jahreswechsel beachten).
- t (Verwendungszweck): sehr kurz halten (max. 6 Wörter, keine Referenznummern). g: Name der Gegenpartei oder null.
- Interne Umbuchungen zwischen eigenen Konten, Überträge aufs Tagesgeld, Kreditkartenausgleich, sowie eine Buchung, zu der es im selben Auszug eine betragsgleiche Gegenbuchung mit umgekehrtem Vorzeichen gibt -> "Umbuchung & Eigenübertrag".
- Kategorie: genau ein Wert aus der Liste. Grobzuordnung:
  Gehalt/Lohn/Rente -> "Einkommen & Gehalt"; Erstattung/Rückzahlung/Verkaufserlös -> "Nebeneinkünfte & Erstattungen";
  REWE/EDEKA/Aldi/Lidl/Kaufland/Netto -> "Lebensmittel & Supermarkt"; dm/Rossmann/Apotheke/Arzt -> "Drogerie & Gesundheit";
  Restaurant/Bäcker/Lieferando/McDonald's -> "Restaurant, Café & Lieferdienst";
  Tankstellen (Shell/Aral/TOTAL) -> "Auto & Tankstelle"; Bahn/BVG/MVV -> "Mobilität & ÖPNV";
  Netflix/Spotify/Prime/iCloud -> "Abos & Streaming"; Telekom/Vodafone/O2/1&1/Rundfunk -> "Telefon, Internet & Rundfunk";
  Miete/Hausverwaltung -> "Miete & Wohnen"; Stadtwerke/Strom/Gas -> "Nebenkosten & Energie";
  Allianz/HUK/andere Versicherer -> "Versicherungen"; Geldautomat/Bargeldauszahlung -> "Bargeldabhebung";
  Kontoführung/Entgelt/Zinsen -> "Bankgebühren & Zinsen"; Finanzamt/Stadtkasse/KFZ-Steuer -> "Steuern & Behörden";
  Darlehen/Kreditrate/Baufinanzierung -> "Kredite & Finanzierung"; Elterngeld/Kindergeld -> "Kinder & Familie".
  Unklar -> "Sonstiges".
- Unleserliche Fotostellen: nur sicher Erkennbares erfassen.

Erlaubte Kategorien:
${KONTO_KATEGORIEN.map((k) => `- ${k}`).join('\n')}

Antworte NUR mit einem JSON-Objekt in genau dieser Form, ohne Text davor oder danach:
{"bank": "Name der Bank oder null", "iban": "IBAN des Kontos oder null", "kontoinhaber": "Kontoinhaber:in oder null", "waehrung": "Kontowährung als ISO-Code, meist EUR", "von": "Zeitraum-Beginn YYYY-MM-DD oder null", "bis": "Zeitraum-Ende YYYY-MM-DD oder null", "buchungen": [{"d": "YYYY-MM-DD", "t": "Verwendungszweck kurz", "g": "Gegenpartei oder null", "b": -12.34, "k": "Kategorie aus der Liste"}]}
b ist eine Zahl mit Dezimalpunkt, ohne Tausenderpunkt und ohne Anführungszeichen. Keine Buchungen gefunden: "buchungen": [].`

// ---------------------------------------------------------------------------------------------------
// Kleine Helfer (exportiert für die Tests)
// ---------------------------------------------------------------------------------------------------

function bytesNachBase64(bytes: Uint8Array): string {
  let binaer = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binaer)
}

function neueId(): string {
  return `kb_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/** Kategorie aus der Liste, sonst „Sonstiges“ (auch kleine Abweichungen in Groß-/Kleinschreibung oder Leerzeichen werden zugeordnet). */
export function kategorieOderSonstiges(wert: unknown): KontoKategorie {
  if (typeof wert !== 'string') return 'Sonstiges'
  const genau = KONTO_KATEGORIEN.find((k) => k === wert)
  if (genau) return genau
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  return KONTO_KATEGORIEN.find((k) => norm(k) === norm(wert)) ?? 'Sonstiges'
}

/**
 * Betrag als Zahl mit Vorzeichen: Ausgaben/Soll negativ, Eingänge/Haben positiv. Zahlen kommen
 * unverändert durch; Text wie „1.234,56 S“, „-12,50“, „+3.000,00 H“ oder „99.90“ wird umgerechnet.
 */
export function betragAusWert(wert: unknown): number | null {
  if (typeof wert === 'number') return Number.isFinite(wert) ? Math.sign(wert) * (Math.round(Math.abs(wert) * 100) / 100) : null
  if (typeof wert !== 'string') return null
  let s = wert.replace(/\s|€|EUR/gi, '')
  if (!s) return null
  let vorzeichen = 1
  const sh = s.match(/([SH])$/i)
  if (sh) {
    vorzeichen = sh[1].toUpperCase() === 'S' ? -1 : 1
    s = s.slice(0, -1)
  }
  if (/^-|-$/.test(s)) vorzeichen = -1
  s = s.replace(/^[+-]|[+-]$/g, '')
  if (!/^[\d.,]+$/.test(s)) return null
  const komma = s.lastIndexOf(',')
  const punkt = s.lastIndexOf('.')
  if (komma >= 0 && punkt >= 0) {
    s = komma > punkt ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (komma >= 0) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? vorzeichen * (Math.round(n * 100) / 100) : null
}

/** Datum als JJJJ-MM-TT; „31.12.2026“ und „31.12.26“ werden umgestellt, anderes bleibt zum Prüfen stehen. */
export function datumIso(wert: unknown): string {
  const s = typeof wert === 'string' ? wert.trim() : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (m) {
    const jahr = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${jahr}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return s
}

function textOderNull(wert: unknown): string | null {
  if (typeof wert !== 'string') return null
  const s = wert.trim()
  return s && s.toLowerCase() !== 'null' ? s : null
}

/** Was die KI zu einem Block liefert, schon bereinigt. */
export type BlockAuszug = {
  bank: string | null
  iban: string | null
  kontoinhaber: string | null
  waehrung: string | null
  von: string | null
  bis: string | null
  buchungen: { datum: string; text: string; gegenpartei: string | null; betrag: number; kategorie: KontoKategorie }[]
  /** Zeilen ohne lesbaren Betrag, die deshalb nicht übernommen wurden. */
  ohneBetrag: number
}

/** Liest die JSON-Antwort der KI (auch in ```json-Zäunen oder mit Text drumherum). Wirft, wenn sie nicht lesbar ist. */
export function leseAntwort(antwort: string): BlockAuszug {
  const ohneZaun = antwort.replace(/```(?:json)?/gi, '')
  const a = ohneZaun.indexOf('{')
  const e = ohneZaun.lastIndexOf('}')
  if (a < 0 || e <= a) throw new Error('Die KI hat keine lesbare Buchungsliste geliefert.')
  // deno-lint-ignore no-explicit-any
  let roh: any
  try {
    roh = JSON.parse(ohneZaun.slice(a, e + 1))
  } catch {
    throw new Error('Die KI hat keine lesbare Buchungsliste geliefert.')
  }
  if (!roh || typeof roh !== 'object' || !Array.isArray(roh.buchungen)) throw new Error('Die KI hat keine lesbare Buchungsliste geliefert.')
  const buchungen: BlockAuszug['buchungen'] = []
  let ohneBetrag = 0
  for (const z of roh.buchungen) {
    if (!z || typeof z !== 'object') continue
    const betrag = betragAusWert(z.b ?? z.betrag)
    const text = textOderNull(z.t ?? z.text) ?? ''
    const gegenpartei = textOderNull(z.g ?? z.gegenpartei)
    if (betrag === null) {
      if (text || gegenpartei) ohneBetrag++
      continue
    }
    buchungen.push({ datum: datumIso(z.d ?? z.datum), text, gegenpartei, betrag, kategorie: kategorieOderSonstiges(z.k ?? z.kategorie) })
  }
  const datumOderNull = (w: unknown) => (textOderNull(w) ? datumIso(w) : null)
  return {
    bank: textOderNull(roh.bank),
    iban: textOderNull(roh.iban),
    kontoinhaber: textOderNull(roh.kontoinhaber),
    waehrung: textOderNull(roh.waehrung)?.toUpperCase() ?? null,
    von: datumOderNull(roh.von),
    bis: datumOderNull(roh.bis),
    buchungen,
    ohneBetrag,
  }
}

function vergleichsText(s: string | null | undefined): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '')
}

function gleicheBuchung(a: BlockAuszug['buchungen'][number], b: BlockAuszug['buchungen'][number]): boolean {
  if (a.datum !== b.datum || Math.abs(a.betrag - b.betrag) > 0.004) return false
  const ga = vergleichsText(a.gegenpartei)
  const ta = vergleichsText(a.text)
  return (!!ga && ga === vergleichsText(b.gegenpartei)) || (!!ta && ta === vergleichsText(b.text))
}

/**
 * Führt die Blöcke in Seitenreihenfolge zusammen. Das Einzelprogramm hängte sie nur aneinander; hier
 * wird zusätzlich an jeder Blockgrenze geprüft, ob eine der ersten Buchungen des späteren Blocks schon
 * unter den letzten des vorigen steht (gleiches Datum, gleicher Betrag, gleiche Gegenpartei oder gleicher
 * Text) — dann ist sie doppelt erfasst und fällt weg. Nur direkt benachbarte, gelesene Blöcke.
 * `teile[i]` ist undefined, wenn Block i nicht gelesen werden konnte.
 */
export function fuegeZusammen(teile: (BlockAuszug | undefined)[]): { kopf: Omit<BlockAuszug, 'buchungen' | 'ohneBetrag'>; buchungen: BlockAuszug['buchungen']; doppelt: number; ohneBetrag: number } {
  const gelesen = teile.filter((t): t is BlockAuszug => !!t)
  const erstes = <K extends keyof BlockAuszug>(k: K, liste: BlockAuszug[]) => (liste.map((t) => t[k]).find((v) => v != null) ?? null) as BlockAuszug[K] | null
  const buchungen: BlockAuszug['buchungen'] = []
  let doppelt = 0
  let vorige: BlockAuszug['buchungen'] | null = null
  for (const teil of teile) {
    if (!teil) {
      vorige = null
      continue
    }
    let liste = teil.buchungen
    if (vorige && vorige.length > 0) {
      const ende = vorige.slice(-RAND)
      const benutzt = new Set<number>()
      const weg = new Set<number>()
      liste.slice(0, RAND).forEach((b, i) => {
        const j = ende.findIndex((v, k) => !benutzt.has(k) && gleicheBuchung(v, b))
        if (j >= 0) {
          benutzt.add(j)
          weg.add(i)
        }
      })
      if (weg.size > 0) {
        doppelt += weg.size
        liste = liste.filter((_b, i) => !weg.has(i))
      }
    }
    buchungen.push(...liste)
    vorige = teil.buchungen
  }
  return {
    kopf: {
      bank: erstes('bank', gelesen),
      iban: erstes('iban', gelesen),
      kontoinhaber: erstes('kontoinhaber', gelesen),
      waehrung: erstes('waehrung', gelesen),
      von: erstes('von', gelesen),
      bis: erstes('bis', [...gelesen].reverse()),
    },
    buchungen,
    doppelt,
    ohneBetrag: gelesen.reduce((s, t) => s + t.ohneBetrag, 0),
  }
}

/** Ein Block, wie er an die KI geht: die Seiten (1-basiert, einschließlich) und die Datei dazu. */
export type Block = { von: number; bis: number; inhalt: KontoBlock }

/**
 * Teilt ein PDF in Blöcke zu je SEITEN_JE_BLOCK Seiten. Bis zu SEITEN_JE_BLOCK Seiten, verschlüsselte
 * und nicht lesbare PDFs gehen unverändert als ein Block (pdf-lib kann verschlüsselte Seiten nicht
 * sinnvoll kopieren — die Kopie wäre unlesbar).
 */
export async function teilePdf(bytes: Uint8Array): Promise<{ bloecke: Block[]; seiten: number }> {
  const ganz = (seiten: number): { bloecke: Block[]; seiten: number } => ({
    bloecke: [{ von: 1, bis: seiten || 1, inhalt: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytesNachBase64(bytes) } } }],
    seiten,
  })
  let quelle: PDFDocument
  try {
    quelle = await PDFDocument.load(bytes, { ignoreEncryption: true })
  } catch {
    return ganz(0)
  }
  const seiten = quelle.getPageCount()
  if (seiten <= SEITEN_JE_BLOCK || quelle.isEncrypted) return ganz(seiten)
  const bloecke: Block[] = []
  for (let start = 0; start < seiten; start += SEITEN_JE_BLOCK) {
    const ende = Math.min(start + SEITEN_JE_BLOCK, seiten)
    const ziel = await PDFDocument.create()
    for (const seite of await ziel.copyPages(quelle, Array.from({ length: ende - start }, (_, i) => start + i))) ziel.addPage(seite)
    bloecke.push({ von: start + 1, bis: ende, inhalt: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytesNachBase64(await ziel.save()) } } })
  }
  return { bloecke, seiten }
}

function bildTyp(name: string, typ: string): string | null {
  const t = typ.toLowerCase()
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(t)) return t
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.webp$/i.test(name)) return 'image/webp'
  if (/\.gif$/i.test(name)) return 'image/gif'
  return null
}

function istHeic(name: string, typ: string): boolean {
  return /^image\/hei[cf]/i.test(typ) || /\.hei[cf]$/i.test(name)
}

function istPdf(name: string, typ: string): boolean {
  return typ.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(name)
}

function istZeitUm(err: unknown): boolean {
  return err instanceof Error && /abort|timeout|timed out/i.test(`${err.name} ${err.message}`)
}

function seitenText(b: { von: number; bis: number }): string {
  return b.von === b.bis ? `Seite ${b.von}` : `Seiten ${b.von}–${b.bis}`
}

function aufzaehlung(teile: string[]): string {
  return teile.length <= 1 ? (teile[0] ?? '') : `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`
}

/** Darf diese Datei für diese Akte gelesen werden? Nur Dateien der Akte selbst oder frisch in ihren Ordner hochgeladene. */
async function gehoertZurAkte(admin: Db, kundeId: string, bereich: string, url: string): Promise<'ja' | 'nein' | 'keine_akte'> {
  let abfrage = admin.from('kunden').select('id, dokumente').eq('id', kundeId)
  if (bereich) abfrage = abfrage.eq('bereich', bereich)
  const { data, error } = await abfrage.maybeSingle()
  if (error || !data) return 'keine_akte'
  // deno-lint-ignore no-explicit-any
  const dokumente = Array.isArray(data.dokumente) ? (data.dokumente as any[]) : []
  if (dokumente.some((d) => d && typeof d.url === 'string' && d.url === url)) return 'ja'
  // Frisch hochgeladen (ladeKundenDokumentHoch legt unter „<kundeId>/…“ im Bucket kunden-dokumente ab).
  if (!/^https?:\/\//i.test(url) && url.startsWith(`${kundeId}/`) && !url.includes('..')) return 'ja'
  return 'nein'
}

// ---------------------------------------------------------------------------------------------------
// Auslesen
// ---------------------------------------------------------------------------------------------------

/** Liest einen Block; wirft bei Fehler, Zeitüberschreitung oder abgeschnittener Antwort. */
async function leseBlock(h: KontoauszugHelfer, block: Block, seiten: number, name: string, timeoutMs: number): Promise<BlockAuszug> {
  const lage =
    seiten > SEITEN_JE_BLOCK && (block.von > 1 || block.bis < seiten)
      ? ` Dir liegen die Seiten ${block.von} bis ${block.bis} von insgesamt ${seiten} vor.`
      : ''
  let stopp = ''
  const antwort = await h.callClaudeResearch(
    [block.inhalt, { type: 'text', text: `${AUFTRAG}\n\nDateiname: ${name}.${lage}\n\nExtrahiere alle Buchungen aus diesem Kontoauszug und ordne jeder eine Kategorie zu.` }],
    { model: MODELL, maxSearches: 0, maxTokens: MAX_TOKENS, timeoutMs, ohneNachdenken: true, meldeStopp: (grund) => (stopp = grund) },
  )
  if (stopp === 'max_tokens') throw new Error(`${seitenText(block)}: zu viele Buchungen für eine Antwort.`)
  return leseAntwort(antwort)
}

export async function lieseKontoauszug(
  admin: Db,
  eingabe: { kundeId: unknown; bereich: unknown; datei: unknown },
  h: KontoauszugHelfer,
): Promise<KontoauszugErgebnis> {
  const start = Date.now()
  // Die Plattform bricht eine Anfrage ohne Antwort nach hoechstensMs ab, der Worker endet nach restMs.
  const frist = start + Math.min(h.hoechstensMs - 15_000, h.restMs() - 10_000)
  const bleibt = () => frist - Date.now()

  const kundeId = typeof eingabe.kundeId === 'string' ? eingabe.kundeId.trim() : ''
  const bereich = typeof eingabe.bereich === 'string' ? eingabe.bereich.trim() : ''
  // deno-lint-ignore no-explicit-any
  const d = (eingabe.datei ?? {}) as any
  const url = typeof d.url === 'string' ? d.url.trim() : ''
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 200) : 'Kontoauszug'
  const typ = typeof d.typ === 'string' ? d.typ.trim() : ''
  if (!kundeId) return { ok: false, fehler: 'kundeId fehlt.', status: 400 }
  if (!url) return { ok: false, fehler: 'Es wurde keine Datei übergeben.', status: 400 }

  const zugehoerig = await gehoertZurAkte(admin, kundeId, bereich, url)
  if (zugehoerig === 'keine_akte') return { ok: false, fehler: 'Die Akte wurde nicht gefunden.', status: 404 }
  if (zugehoerig === 'nein') return { ok: false, fehler: 'Diese Datei gehört nicht zu dieser Akte.', status: 403 }

  if (istHeic(name, typ)) {
    return { ok: false, fehler: 'Fotos im HEIC-Format kann der Server nicht lesen. Bitte als JPG oder PNG hochladen (am iPhone: Einstellungen → Kamera → Formate → „Maximale Kompatibilität“).', status: 415 }
  }
  const pdf = istPdf(name, typ)
  const bild = pdf ? null : bildTyp(name, typ)
  if (!pdf && !bild) return { ok: false, fehler: 'Diese Dateiart kann nicht ausgelesen werden — bitte ein PDF oder ein Foto (JPG, PNG, WEBP) des Kontoauszugs verwenden.', status: 415 }
  if (bleibt() < MINDEST_ZEIT_MS + 10_000) return { ok: false, fehler: 'Der Server ist gerade beschäftigt — bitte in einer Minute noch einmal versuchen.', status: 503 }

  let bytes: Uint8Array
  try {
    bytes = await h.ladeDokumentBytes(admin, url)
  } catch (err) {
    return { ok: false, fehler: `Die Datei ließ sich nicht laden: ${err instanceof Error ? err.message : String(err)}`, status: 502 }
  }
  if (bytes.length > MAX_DATEI_BYTES) return { ok: false, fehler: 'Die Datei ist größer als 20 MB.', status: 413 }

  let bloecke: Block[]
  let seiten = 1
  if (pdf) {
    const geteilt = await teilePdf(bytes)
    bloecke = geteilt.bloecke
    seiten = geteilt.seiten
    if (seiten > MAX_SEITEN) return { ok: false, fehler: zuLangText(seiten), status: 413 }
  } else {
    if (bytes.length > MAX_BILD_BYTES) return { ok: false, fehler: 'Das Foto ist größer als 5 MB — bitte mit geringerer Auflösung aufnehmen oder verkleinern.', status: 413 }
    bloecke = [{ von: 1, bis: 1, inhalt: { type: 'image', source: { type: 'base64', media_type: bild!, data: bytesNachBase64(bytes) } } }]
  }

  // Blöcke parallel lesen (höchstens GLEICHZEITIG), jeder gescheiterte Block einmal wiederholt.
  const teile = new Array<BlockAuszug | undefined>(bloecke.length)
  const gruende = new Array<'fehler' | 'zeit' | undefined>(bloecke.length)
  let letzterFehler = ''
  let naechster = 0
  const arbeite = async () => {
    while (naechster < bloecke.length) {
      const i = naechster++
      for (let versuch = 1; versuch <= 2; versuch++) {
        if (bleibt() < MINDEST_ZEIT_MS) {
          gruende[i] = 'zeit'
          break
        }
        try {
          teile[i] = await leseBlock(h, bloecke[i], seiten, name, bleibt() - 2_000)
          gruende[i] = undefined
          break
        } catch (err) {
          console.error(`Kontoauszug: ${seitenText(bloecke[i])}, Versuch ${versuch}`, err)
          letzterFehler = err instanceof Error ? err.message : String(err)
          gruende[i] = istZeitUm(err) ? 'zeit' : 'fehler'
          if (gruende[i] === 'zeit') break
          if (versuch === 1) await new Promise((r) => setTimeout(r, 1500))
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(GLEICHZEITIG, bloecke.length) }, arbeite))

  const fehlend = bloecke.map((b, i) => ({ b, grund: teile[i] ? undefined : (gruende[i] ?? 'fehler') })).filter((x) => x.grund)
  if (fehlend.length === bloecke.length) {
    if (fehlend.some((x) => x.grund === 'zeit')) return { ok: false, fehler: zuLangText(seiten > 1 ? seiten : 0), status: 504 }
    return { ok: false, fehler: `Der Auszug ließ sich nicht auslesen${letzterFehler ? ` (${letzterFehler.slice(0, 200)})` : ''}. Bitte noch einmal versuchen.`, status: 502 }
  }

  const { kopf, buchungen: roh, ohneBetrag } = fuegeZusammen(teile)
  const waehrung = kopf.waehrung || 'EUR'
  const buchungen: KontoBuchung[] = roh.map((b) => ({
    id: neueId(),
    datum: b.datum,
    wertstellung: null,
    text: b.text,
    gegenpartei: b.gegenpartei,
    betrag: b.betrag,
    waehrung,
    kategorie: b.kategorie,
    konto: kopf.iban,
    quelle: name,
  }))

  const hinweise: string[] = []
  const zeitWeg = fehlend.filter((x) => x.grund === 'zeit').map((x) => seitenText(x.b))
  const fehlerWeg = fehlend.filter((x) => x.grund === 'fehler').map((x) => seitenText(x.b))
  if (fehlerWeg.length > 0) hinweise.push(`${aufzaehlung(fehlerWeg)} von ${seiten} konnten nicht ausgelesen werden — dort fehlen Buchungen.`)
  if (zeitWeg.length > 0) hinweise.push(`${ZU_LANG}: ${aufzaehlung(zeitWeg)} von ${seiten} wurden in der verfügbaren Zeit nicht ausgelesen — dort fehlen Buchungen. Bitte diese Seiten als eigene Datei auslesen.`)
  if (ohneBetrag > 0) hinweise.push(`${ohneBetrag} ${ohneBetrag === 1 ? 'Zeile' : 'Zeilen'} ohne lesbaren Betrag wurden nicht übernommen — bitte im Auszug prüfen.`)
  if (buchungen.length === 0 && hinweise.length === 0) hinweise.push('Keine Buchungen gefunden — ist das ein Kontoauszug?')

  return {
    ok: true,
    buchungen,
    datei: {
      name,
      url,
      bank: kopf.bank,
      iban: kopf.iban,
      kontoinhaber: kopf.kontoinhaber,
      von: kopf.von,
      bis: kopf.bis,
      anzahl: buchungen.length,
      ...(hinweise.length > 0 ? { fehler: hinweise.join(' ') } : {}),
    },
  }
}
