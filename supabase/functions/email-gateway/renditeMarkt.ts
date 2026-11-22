// „Vergleich vor Ort prüfen“ im Rendite-Check eines Objekts (22.11.2026): eine Webrecherche (Sonnet 5.5, höchstens
// fünf Suchen) nach dem örtlichen Kaufpreis je m² für die Objektart und der üblichen Miete bzw. Pacht, mit
// Fundstellen und Stand. Aufgerufen über die Aktion `rendite_marktvergleich` (eigener Login oder der Assistent mit
// imAuftragVon); die Oberfläche ist src/components/ObjektRenditeCheck.tsx, die Rechnung _shared/renditeKern.ts.
//
// Das Ergebnis steht in objekte.rendite.markt (Form RenditeMarkt im Kern). Geschrieben wird immer frisch gelesen
// und zusammengeführt (mischeRenditeStand): Eingaben und Prüfsteine, die das Fenster inzwischen gespeichert hat,
// bleiben erhalten. Die Rechnung selbst macht weiterhin der Kern — die KI liefert nur Vergleichszahlen.
//
// Keine Importe aus index.ts: Datenbank-Zugang und die gemeinsamen Helfer kommen als Parameter.

import { mischeRenditeStand, type RenditeMarkt, type RenditeQuelle } from '../_shared/renditeKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type RenditeMarktHelfer = {
  /** callClaudeResearch aus index.ts (Websuche; der Verbrauch wird dort gemessen). */
  callClaudeResearch: (prompt: string, opts: { model: 'claude-sonnet-5-5'; maxSearches: number; maxTokens?: number; timeoutMs?: number; ohneNachdenken?: boolean }) => Promise<string>
  /** Verbleibende Lebenszeit des Workers in ms. */
  restMs: () => number
  /** Obergrenze für einen einzelnen langen Schritt (SCHRITT_HOECHSTENS_MS in index.ts). */
  hoechstensMs: number
  /** Kennzeichnet den Verbrauch als privat (private Objekte, setzePrivat aus kiVerbrauch.ts). */
  setzePrivat?: () => void
  jetzt?: () => Date
}

export type MarktStart =
  | { ok: true; gestartetAm: string; arbeit: Promise<MarktErgebnis> }
  | { ok: false; fehler: string; status: number }

export type MarktErgebnis = { ok: true; markt: RenditeMarkt } | { ok: false; fehler: string; status: number }

export const MARKT_SUCHEN = 5
/** Läuft schon eine Recherche, die jünger ist, wird keine zweite gestartet. */
const LAEUFT_HOECHSTENS_MS = 4 * 60_000

const SPALTEN = 'id, bezeichnung, adresse, typ, kaufpreis, verkaufsdaten, privat_besitzer, rendite'

function text(w: unknown, max = 400): string {
  return typeof w === 'string' ? w.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/** Zahl innerhalb einer glaubwürdigen Spanne, sonst undefined (schützt vor Tippfehlern und Einheitenverwechslung). */
function zahlIn(w: unknown, von: number, bis: number): number | undefined {
  const n = typeof w === 'number' ? w : typeof w === 'string' ? Number(w.replace(/\./g, '').replace(',', '.')) : NaN
  return Number.isFinite(n) && n >= von && n <= bis ? Math.round(n * 100) / 100 : undefined
}

function spanne(von: number | undefined, bis: number | undefined): [number | undefined, number | undefined] {
  return von !== undefined && bis !== undefined && von > bis ? [bis, von] : [von, bis]
}

/** Liest den JSON-Block der Recherche. Fehlt er oder ist er kaputt: null. */
export function leseMarktAntwort(antwort: string, heute: string): Omit<RenditeMarkt, 'status'> | null {
  const block = antwort.match(/```json\s*([\s\S]*?)```/) ?? antwort.match(/(\{[\s\S]*\})/)
  if (!block) return null
  let roh: Record<string, unknown>
  try {
    roh = JSON.parse(block[1]) as Record<string, unknown>
  } catch {
    return null
  }
  if (!roh || typeof roh !== 'object') return null
  const [preisJeQmVon, preisJeQmBis] = spanne(zahlIn(roh.preisJeQmVon, 50, 50_000), zahlIn(roh.preisJeQmBis, 50, 50_000))
  const [mieteJeQmVon, mieteJeQmBis] = spanne(zahlIn(roh.mieteJeQmVon, 0.5, 300), zahlIn(roh.mieteJeQmBis, 0.5, 300))
  const [renditeVon, renditeBis] = spanne(zahlIn(roh.renditeVon, 0.5, 30), zahlIn(roh.renditeBis, 0.5, 30))
  const [faktorVon, faktorBis] = spanne(zahlIn(roh.faktorVon, 2, 100), zahlIn(roh.faktorBis, 2, 100))
  const quellen: RenditeQuelle[] = (Array.isArray(roh.quellen) ? roh.quellen : [])
    // deno-lint-ignore no-explicit-any
    .filter((q: any) => typeof q?.url === 'string' && /^https?:\/\//i.test(q.url))
    // deno-lint-ignore no-explicit-any
    .map((q: any) => ({ titel: text(q.titel, 160) || String(q.url).slice(0, 160), url: String(q.url).slice(0, 500), ...(text(q.stand, 40) ? { stand: text(q.stand, 40) } : {}) }))
    .slice(0, 15)
  const hinweise = (Array.isArray(roh.hinweise) ? roh.hinweise : []).map((h) => text(h, 300)).filter(Boolean).slice(0, 6)
  const aus: Omit<RenditeMarkt, 'status'> = { stand: heute, quellen, hinweise }
  const setze = <K extends Exclude<keyof RenditeMarkt, 'status'>>(k: K, w: RenditeMarkt[K] | undefined) => {
    if (w !== undefined && w !== '') aus[k] = w as never
  }
  setze('preisJeQmVon', preisJeQmVon)
  setze('preisJeQmBis', preisJeQmBis)
  setze('preisJeQmMittel', zahlIn(roh.preisJeQmMittel, 50, 50_000))
  setze('preisBezug', text(roh.preisBezug, 200))
  setze('mieteJeQmVon', mieteJeQmVon)
  setze('mieteJeQmBis', mieteJeQmBis)
  setze('mieteJeQmMittel', zahlIn(roh.mieteJeQmMittel, 0.5, 300))
  setze('mieteBezug', text(roh.mieteBezug, 200))
  setze('renditeVon', renditeVon)
  setze('renditeBis', renditeBis)
  setze('faktorVon', faktorVon)
  setze('faktorBis', faktorBis)
  setze('einschaetzung', text(roh.einschaetzung, 1200))
  const ortBezug = text(roh.ortBezug, 120)
  if (ortBezug) aus.ort = ortBezug
  return aus
}

// deno-lint-ignore no-explicit-any
function ortVon(o: any): string {
  const u = o?.verkaufsdaten?.uebersicht ?? {}
  return [text(u.strasse), text(u.plzOrt)].filter(Boolean).join(', ') || text(o?.adresse) || text(o?.bezeichnung)
}

// deno-lint-ignore no-explicit-any
function objektartVon(o: any): string {
  const art = text(o?.verkaufsdaten?.uebersicht?.objektart) || text(o?.typ) || 'Immobilie'
  // Die Bezeichnung verrät oft die eigentliche Nutzung („Boarding House Remstal“ bei Objektart „Gewerbe“).
  const b = text(o?.bezeichnung)
  return b && !b.toLowerCase().includes(art.toLowerCase()) ? `${art} (Bezeichnung: „${b}“)` : art
}

export function marktAuftrag(a: { bezeichnung: string; objektart: string; ort: string; flaeche?: number; einheiten?: number; heute: string }): string {
  return `Du recherchierst für eine Kaufentscheidung die Vergleichswerte am Standort einer Immobilie. Stichtag heute: ${a.heute}.

Objekt: „${a.bezeichnung}“
Objektart: ${a.objektart}
Lage: ${a.ort}${a.flaeche ? `\nFläche: rund ${Math.round(a.flaeche)} m²` : ''}${a.einheiten ? `\nEinheiten: ${a.einheiten}` : ''}

Suche mit höchstens ${MARKT_SUCHEN} Suchen nach:
1. Kaufpreisen je m² für genau diese Objektart in diesem Ort (gibt es dort nichts: Nachbarort oder Landkreis — dann sag das in ortBezug). Gibt es für die Objektart keine veröffentlichten Werte (z. B. Boarding House, Hotel, Pflegeheim), nimm die nächstliegende Vergleichsart (z. B. Wohnungen im Bestand oder Gewerbeflächen) und nenne sie in preisBezug.
2. Üblicher Miete bzw. Pacht netto kalt je m² und Monat für diese Nutzung — bei Beherbergung die Pacht, die ein Betreiber zahlt; sonst Mietspiegel oder Angebotsmieten. Nenne den Bezug in mieteBezug.
3. Üblichen Bruttorenditen (in %) oder Kaufpreisfaktoren für diese Objektart in der Region.

Regeln:
- Jede Zahl braucht eine Fundstelle mit Adresse und Stand. Nichts schätzen: Was du nicht findest, bleibt null.
- Zahlen aus dem Verkaufsangebot dieses einen Objekts zählen nicht als Vergleich.
- Schreibe Deutsch in einfacher Sprache, ohne englische Wörter.

Antworte am Ende mit genau einem Block in dieser Form:
\`\`\`json
{"preisJeQmVon": null, "preisJeQmBis": null, "preisJeQmMittel": null, "preisBezug": "worauf sich die Preise beziehen", "mieteJeQmVon": null, "mieteJeQmBis": null, "mieteJeQmMittel": null, "mieteBezug": "Miete oder Pacht, wofür", "renditeVon": null, "renditeBis": null, "faktorVon": null, "faktorBis": null, "ortBezug": "Ort oder Landkreis der Werte", "einschaetzung": "zwei bis vier Sätze zur Lage und Nachfrage", "hinweise": ["Einschränkung oder Auffälligkeit"], "quellen": [{"titel": "…", "url": "https://…", "stand": "Monat Jahr"}]}
\`\`\`
Preise in Euro je m² Wohn- bzw. Nutzfläche, Mieten in Euro je m² und Monat, Renditen in Prozent, Faktoren als Vielfaches der Jahresmiete — jeweils reine Zahlen.`
}

/** Schreibt markt in objekte.rendite (frisch gelesen, mit dem übrigen Stand zusammengeführt). Liefert false,
 *  wenn inzwischen eine neuere Recherche gestartet wurde — dann schreibt dieser Lauf nichts. */
async function schreibeMarkt(admin: Db, objektId: string, markt: RenditeMarkt, nurWennGestartetAm?: string): Promise<boolean> {
  const { data } = await admin.from('objekte').select('rendite').eq('id', objektId).maybeSingle()
  // deno-lint-ignore no-explicit-any
  const alt = (data as any)?.rendite
  if (nurWennGestartetAm && alt?.markt?.gestartetAm && alt.markt.gestartetAm !== nurWennGestartetAm) return false
  const { error } = await admin.from('objekte').update({ rendite: mischeRenditeStand(alt, { markt }) }).eq('id', objektId)
  if (error) throw new Error(error.message)
  return true
}

/**
 * Startet die Recherche: prüft das Objekt, vermerkt „läuft“ und gibt die eigentliche Arbeit als Promise zurück.
 * Der Aufrufer wartet darauf (Knopf im CRM) oder lässt sie im Hintergrund laufen (Assistent, EdgeRuntime.waitUntil).
 * Die Rechte prüft der Aufrufer vorher (darfObjektServer).
 */
export async function starteRenditeMarktvergleich(admin: Db, a: { objektId: string; wer: string }, h: RenditeMarktHelfer): Promise<MarktStart> {
  const objektId = String(a.objektId ?? '').trim()
  if (!objektId) return { ok: false, fehler: 'objektId fehlt.', status: 400 }
  const { data: o, error } = await admin.from('objekte').select(SPALTEN).eq('id', objektId).maybeSingle()
  if (error) return { ok: false, fehler: error.message, status: 500 }
  if (!o) return { ok: false, fehler: 'Dieses Objekt gibt es nicht (mehr).', status: 404 }
  const ort = ortVon(o)
  if (!ort || ort === text(o.bezeichnung)) return { ok: false, fehler: 'Für den Vergleich vor Ort fehlt die Adresse des Objekts (mindestens der Ort).', status: 400 }
  const jetzt = h.jetzt?.() ?? new Date()
  const laufend = o.rendite?.markt
  if (laufend?.status === 'laeuft' && laufend.gestartetAm && jetzt.getTime() - new Date(laufend.gestartetAm).getTime() < LAEUFT_HOECHSTENS_MS) {
    return { ok: false, fehler: 'Für dieses Objekt läuft der Vergleich vor Ort gerade schon — bitte ein, zwei Minuten warten.', status: 409 }
  }
  if (o.privat_besitzer) h.setzePrivat?.()
  const gestartetAm = jetzt.toISOString()
  const objektart = objektartVon(o)
  const vorher = laufend?.status === 'fertig' ? (laufend as RenditeMarkt) : undefined
  // Die alten Zahlen bleiben sichtbar, bis die neuen da sind; nur Status und Start werden gesetzt.
  await schreibeMarkt(admin, objektId, { ...(vorher ?? {}), status: 'laeuft', gestartetAm, gestartetVon: a.wer, objektart, ort, fehler: undefined })

  const arbeit = (async (): Promise<MarktErgebnis> => {
    const heute = gestartetAm.slice(0, 10)
    const eingaben = o.rendite?.eingaben ?? {}
    const flaeche = Number(eingaben.flaeche) > 0 ? Number(eingaben.flaeche) : undefined
    const einheiten = Number(eingaben.einheiten) > 0 ? Number(eingaben.einheiten) : undefined
    try {
      const timeoutMs = Math.min(h.hoechstensMs - 12_000, Math.max(30_000, h.restMs() - 15_000))
      const antwort = await h.callClaudeResearch(marktAuftrag({ bezeichnung: text(o.bezeichnung) || 'Objekt', objektart, ort, flaeche, einheiten, heute }), {
        model: 'claude-sonnet-5-5',
        maxSearches: MARKT_SUCHEN,
        maxTokens: 6000,
        timeoutMs,
        ohneNachdenken: true,
      })
      const gelesen = leseMarktAntwort(antwort, heute)
      if (!gelesen) throw new Error('Die Recherche hat kein auswertbares Ergebnis geliefert.')
      const markt: RenditeMarkt = { ...gelesen, status: 'fertig', gestartetAm, gestartetVon: a.wer, abgeschlossenAm: (h.jetzt?.() ?? new Date()).toISOString(), objektart, ort: gelesen.ort || ort }
      if (!(await schreibeMarkt(admin, objektId, markt, gestartetAm))) return { ok: false, fehler: 'Inzwischen wurde eine neuere Recherche gestartet.', status: 409 }
      return { ok: true, markt }
    } catch (err) {
      const zeit = err instanceof Error && /abort|timeout|timed out/i.test(`${err.name} ${err.message}`)
      const fehler = zeit ? 'Die Recherche hat zu lange gedauert. Bitte noch einmal versuchen.' : err instanceof Error ? err.message : String(err)
      try {
        // Gab es schon ein Ergebnis, bleibt es gültig; der Fehler der neuen Recherche steht dabei.
        const stand: RenditeMarkt = vorher ? { ...vorher, gestartetAm, fehler: `Die neue Recherche ist gescheitert: ${fehler}` } : { status: 'fehler', gestartetAm, gestartetVon: a.wer, objektart, ort, fehler }
        await schreibeMarkt(admin, objektId, stand, gestartetAm)
      } catch {
        // Der Fehler geht trotzdem an den Aufrufer.
      }
      return { ok: false, fehler, status: zeit ? 504 : 500 }
    }
  })()
  return { ok: true, gestartetAm, arbeit }
}
