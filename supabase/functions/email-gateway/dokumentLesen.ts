// Dokumente lesen (Tabelle dokument_inhalte): Warteschlange, Wiederaufnahme hängengebliebener Läufe,
// Wiederholen nach vorübergehenden Fehlern und weitere Dateiformate. Das eigentliche Lesen (KI-Abschrift,
// Teile langer PDFs) steht weiter in index.ts (leseDokument); hier liegt, was sich ohne Netz prüfen lässt.
//
// Befund vom 23.11.2026: 24 Zeilen standen seit Tagen auf „laeuft“. Ein Lauf setzt die Zeile auf „laeuft“
// und schreibt das Ergebnis (oder den Fehler) erst am Ende. Wird der Worker vorher beendet — Laufzeitgrenze
// von rund 400 s, oder zu viel Speicher, wenn zwölf zum Teil 20–38 MB große PDFs gleichzeitig auf einem
// Worker geladen werden (16.11.: 20 Dateien in zwei Sekunden) —, läuft kein catch mehr, und die Zeile bleibt
// stehen. Wieder angestoßen wurde sie nur, wenn jemand genau diese Akte noch einmal abfragte. Außerdem
// scheiterten lange PDFs endgültig an „Signal timed out.“ (8 Seiten je Teil bei 8192 Antwortzeichen dauern
// zu lange), und ein Neustart begann wieder bei Seite 1.
//
// Lösung:
//  - Minutentakt (setzeHaengendeDokumenteFort): „laeuft“ älter als 15 Minuten gilt als abgebrochen und wird
//    — nach Beanspruchen der Zeile — beim ersten noch fehlenden Teil fortgesetzt. Höchstens GLEICHZEITIG
//    Dateien laufen zugleich; nach MAX_VERSUCHE Versuchen wird endgültig „fehler“ gemeldet (keine Endlosschleife).
//  - Eine Zeile „laeuft“ mit sehr altem Zeitstempel (WARTESCHLANGE_ZEIT) ist ein Platz in der Warteschlange:
//    viele Dateien auf einmal werden nicht mehr gleichzeitig gestartet, sondern nacheinander abgearbeitet.
//  - Vorübergehende Fehler (Zeitüberschreitung, Überlastung, Netz) führen nicht mehr zu „fehler“, sondern
//    zurück in die Warteschlange (fehlerNachAbbruch); kleinere Teile (4 statt 8 Seiten) passen in die Zeit.
//  - Zusätzlich lesbar: Text (.txt), Webseiten (.html), OpenDocument (.odt/.ods/.odp), PowerPoint (.pptx)
//    und gespeicherte Mails (.eml). Nicht unterstützt bleiben die alten Binärformate .doc und .xls.

import { strFromU8, unzipSync } from 'npm:fflate@0.8.2'
import { simpleParser } from 'npm:mailparser@3'
import { Buffer } from 'node:buffer'
import { ERLAUBTE_EIMER, istSichererPfad } from '../_shared/speicherPfad.ts'

// ---------- Teile langer PDFs ----------

/** Seiten je Teil. Vorher 8: dichte Seiten ergaben bis zu 8192 Antwortzeichen und liefen in die Zeitgrenze. */
export const SEITEN_JE_TEIL = 4
/** Höchstens so viele Teile je Dokument (zusammen 64 Seiten, wie vorher mit 8 × 8). */
export const MAX_TEILE = 16

/** Bis zu dieser Größe geht eine Datei am Stück an die KI (die Anfrage darf höchstens rund 32 MB haben). */
export const AM_STUECK_BYTES = 20 * 1024 * 1024
/** Größere PDFs (gescannte Mietverträge, Kontoauszüge …) werden seitenweise gelesen — bis zu dieser Größe. */
export const PDF_MAX_BYTES = 60 * 1024 * 1024
/** Zielgröße eines Teils großer PDFs. */
export const TEIL_ZIEL_BYTES = 12 * 1024 * 1024

/** In wie viele Teile ein PDF mit `seiten` Seiten zerlegt wird (bis SEITEN_JE_TEIL + 2 Seiten am Stück). */
export function teileFuer(seiten: number): number {
  return seiten > SEITEN_JE_TEIL + 2 ? Math.min(MAX_TEILE, Math.ceil(seiten / SEITEN_JE_TEIL)) : 1
}

/**
 * Große PDFs (über AM_STUECK_BYTES, seit 23.11.2026 — vorher gar nicht gelesen): Seiten nach ihrer tatsächlichen
 * Größe zu Teilen bündeln, höchstens SEITEN_JE_TEIL Seiten und etwa TEIL_ZIEL_BYTES je Teil (gescannte Seiten
 * sind sehr unterschiedlich groß). Liefert [von, bis) je Teil; eine einzelne zu große Seite bildet einen eigenen Teil.
 */
export function gruppiereSeiten(groessen: number[], zielBytes = TEIL_ZIEL_BYTES, maxSeiten = SEITEN_JE_TEIL): [number, number][] {
  const gruppen: [number, number][] = []
  let von = 0
  let summe = 0
  for (let i = 0; i < groessen.length; i++) {
    const g = groessen[i]
    if (i > von && (summe + g > zielBytes || i - von >= maxSeiten)) {
      gruppen.push([von, i])
      von = i
      summe = 0
    }
    summe += g
  }
  if (groessen.length > 0) gruppen.push([von, groessen.length])
  return gruppen
}

type TeilStand = { teile?: Record<string, string> | null; teile_gesamt?: number | null; seiten?: number | null }

/**
 * Bei welchem Teil ein abgebrochener Lauf weitermacht: beim ersten, der noch fehlt. 0 (von vorn), wenn es
 * nur einen Teil gibt, noch nichts gelesen ist oder die gespeicherte Aufteilung nicht mehr zur heutigen
 * passt (z. B. mit 8 Seiten je Teil begonnen).
 */
export function ersterOffenerTeil(z: TeilStand): number {
  const gesamt = Number(z.teile_gesamt ?? 0)
  if (!(gesamt > 1) || !z.teile || typeof z.teile !== 'object') return 0
  // Weniger Teile als heute üblich = alte, gröbere Aufteilung (mehr Teile haben große PDFs, die passen).
  if (z.seiten && gesamt < teileFuer(Number(z.seiten))) return 0
  for (let i = 0; i < gesamt; i++) if (!(String(i) in z.teile)) return i
  // Alle Teile da, nur das Abschließen fehlte: den letzten noch einmal lesen, das schließt ab.
  return gesamt - 1
}

// ---------- Warteschlange und Wiederaufnahme ----------

/** Ab diesem Alter gilt „laeuft“ als abgebrochen (ein Teil braucht höchstens 150 s, Weiterreichen eingerechnet). */
export const HAENGT_NACH_MS = 15 * 60_000
/** So lange zählt ein „laeuft“ als tatsächlich arbeitend (für die Höchstzahl gleichzeitiger Läufe). */
export const LAEUFT_FRISCH_MS = 5 * 60_000
/** Höchstens so viele Versuche je Datei, dann endgültig „fehler“. */
export const MAX_VERSUCHE = 4
/** Höchstens so viele Dateien gleichzeitig (große PDFs brauchen viel Speicher auf einem Worker). */
export const GLEICHZEITIG = 2
/** Sofort gestartete Dateien je Abfrage; der Rest kommt in die Warteschlange. */
export const SOFORT_HOECHSTENS = 2
/** Zeitstempel für „wartet in der Schlange“: älter als jede Hängegrenze, kommt also sofort dran. */
export const WARTESCHLANGE_ZEIT = '2000-01-01T00:00:00.000Z'

/** Fehler, bei denen ein späterer Versuch Erfolg haben kann. */
export function istVoruebergehenderFehler(meldung: string): boolean {
  const m = String(meldung ?? '')
  if (/Keine Textantwort/i.test(m)) return false // gleiche Anfrage ergäbe dasselbe
  return /timed? ?out|zeitüberschreitung|abort|Anthropic-API-Fehler \((408|409|425|429|500|502|503|504|520|522|524|529)\)|overloaded|rate.?limit|ECONNRESET|ETIMEDOUT|connection (reset|closed|refused)|network|fetch failed|error sending request|Ablage für Dokument-Inhalte nicht erreichbar/i.test(m)
}

/** Lesbarer deutscher Text für eine technische Fehlermeldung. */
function fehlerDeutsch(meldung: string): string {
  if (/timed? ?out|abort/i.test(meldung)) return 'Zeitüberschreitung beim Lesen'
  if (/\((429|529)\)|overloaded|rate.?limit/i.test(meldung)) return 'Lesedienst überlastet'
  return meldung.slice(0, 300)
}

/**
 * Was der catch-Zweig von leseDokument schreibt. Vorübergehende Fehler: zurück auf „laeuft“ (gelesene Teile
 * bleiben stehen), der Minutentakt setzt nach HAENGT_NACH_MS fort. Sonst — oder nach MAX_VERSUCHE — „fehler“.
 */
export function fehlerNachAbbruch(meldung: string, versuche: number, jetztIso: string): { status: 'laeuft' | 'fehler'; fehler: string; aktualisiert_am: string } {
  if (istVoruebergehenderFehler(meldung)) {
    if (versuche < MAX_VERSUCHE) return { status: 'laeuft', fehler: `Wird später erneut versucht: ${fehlerDeutsch(meldung)}`, aktualisiert_am: jetztIso }
    return { status: 'fehler', fehler: `${fehlerDeutsch(meldung)} (${versuche} Versuche). Die Datei ist vermutlich zu lang oder zu aufwendig.`, aktualisiert_am: jetztIso }
  }
  return { status: 'fehler', fehler: meldung, aktualisiert_am: jetztIso }
}

/**
 * Umkehrung von dokumentSchluessel (index.ts): aus dem Schlüssel die Angabe, mit der leseDokument die Datei
 * lädt. null, wenn der Schlüssel keine Datei im eigenen Speicher bezeichnet.
 */
export function urlAusSchluessel(schluessel: string, basisUrl: string): string | null {
  const s = String(schluessel ?? '')
  const i = s.indexOf('/')
  if (i <= 0) return null
  const eimer = s.slice(0, i)
  const pfad = s.slice(i + 1)
  if (!(ERLAUBTE_EIMER as readonly string[]).includes(eimer) || !istSichererPfad(pfad)) return null
  if (eimer === 'kunden-dokumente') return pfad
  if (eimer === 'objekt-dokumente') return `objekt-dokumente:${pfad}`
  if (!/^https?:\/\//i.test(basisUrl)) return null
  return `${basisUrl.replace(/\/+$/, '')}/storage/v1/object/public/${eimer}/${pfad.split('/').map(encodeURIComponent).join('/')}`
}

/** Name zum Lesen: der gespeicherte, oder — ohne Dateiendung — der letzte Teil des Speicherorts. */
export function nameZumLesen(name: string | null | undefined, schluessel: string): string {
  const n = String(name ?? '').trim()
  if (/\.[A-Za-z0-9]{2,5}$/.test(n)) return n
  const letzter = schluessel.split('/').pop() ?? ''
  return /\.[A-Za-z0-9]{2,5}$/.test(letzter) ? letzter : n || letzter
}

// deno-lint-ignore no-explicit-any
type Db = any
export type DokumentRefEinfach = { url: string; name: string; typ?: string }

/** Legt eine Datei in die Warteschlange, statt sie sofort zu lesen (der Minutentakt startet sie). */
export async function reiheDokumentEin(admin: Db, schluessel: string, name: string, versuche: number): Promise<void> {
  const { error } = await admin.from('dokument_inhalte').upsert({
    schluessel,
    name,
    status: 'laeuft',
    inhalt: '',
    teile: null,
    teile_gesamt: null,
    fehler: null,
    versuche,
    aktualisiert_am: WARTESCHLANGE_ZEIT,
  })
  if (error) throw new Error(`Warteschlange nicht erreichbar: ${error.message}`)
}

export type FortsetzenErgebnis = { angestossen: number; aufgegeben: number; laufend: number }

/**
 * Minutentakt: abgebrochene und wartende Leseläufe fortsetzen. Höchstens GLEICHZEITIG Dateien arbeiten
 * zugleich; jede Zeile wird vor dem Anstoßen beansprucht (bedingtes Update), damit zwei Takte sie nie
 * doppelt starten. Wirft nie.
 */
export async function setzeHaengendeDokumenteFort(
  admin: Db,
  h: {
    stosseAn: (ref: DokumentRefEinfach, extra: { teil: number; umleitungen: number; fortsetzen: true }) => Promise<void>
    basisUrl?: string
    jetzt?: number
    gleichzeitig?: number
  },
): Promise<FortsetzenErgebnis> {
  const ergebnis: FortsetzenErgebnis = { angestossen: 0, aufgegeben: 0, laufend: 0 }
  try {
    const jetzt = h.jetzt ?? Date.now()
    const basisUrl = h.basisUrl ?? Deno.env.get('SUPABASE_URL') ?? ''
    const frischAb = new Date(jetzt - LAEUFT_FRISCH_MS).toISOString()
    const haengtVor = new Date(jetzt - HAENGT_NACH_MS).toISOString()
    const jetztIso = new Date(jetzt).toISOString()
    const hoechstens = h.gleichzeitig ?? GLEICHZEITIG

    const { data: laufend, error: e1 } = await admin.from('dokument_inhalte').select('schluessel, gross').eq('status', 'laeuft').gte('aktualisiert_am', frischAb).limit(hoechstens)
    if (e1) throw new Error(e1.message)
    ergebnis.laufend = (laufend ?? []).length
    // Große Dateien (gross, gesetzt beim ersten Herunterladen) nur einzeln: zwei gleichzeitig sprengen den Speicher
    // eines Server-Prozesses, und beide brechen ohne Meldung ab (23.11.2026).
    let grossUnterwegs = ((laufend ?? []) as { gross?: boolean }[]).some((z) => z.gross)
    const frei = hoechstens - ergebnis.laufend
    if (frei <= 0) return ergebnis

    const { data, error } = await admin
      .from('dokument_inhalte')
      .select('schluessel, name, versuche, teile, teile_gesamt, seiten, fehler, aktualisiert_am, gross')
      .eq('status', 'laeuft')
      .lt('aktualisiert_am', haengtVor)
      .order('aktualisiert_am', { ascending: true })
      .limit(frei + 10)
    if (error) throw new Error(error.message)

    for (const z of (data ?? []) as (TeilStand & { schluessel: string; name: string | null; versuche: number | null; fehler: string | null; gross?: boolean })[]) {
      if (ergebnis.angestossen >= frei) break
      if (z.gross && grossUnterwegs) continue // wartet, bis die andere große Datei fertig ist
      const versuche = Number(z.versuche ?? 0)
      const url = urlAusSchluessel(z.schluessel, basisUrl)
      if (versuche >= MAX_VERSUCHE || !url) {
        const fehler = !url
          ? 'Die Datei ist im Speicher nicht mehr auffindbar.'
          : `Das Lesen ist ${versuche}-mal abgebrochen${z.fehler ? ` (zuletzt: ${z.fehler.replace(/^Wird später erneut versucht: /, '')})` : ''}. Die Datei ist vermutlich zu groß oder zu aufwendig.`
        await admin.from('dokument_inhalte').update({ status: 'fehler', fehler, aktualisiert_am: jetztIso }).eq('schluessel', z.schluessel).eq('status', 'laeuft').lt('aktualisiert_am', haengtVor)
        ergebnis.aufgegeben++
        continue
      }
      // Beanspruchen: nur, wenn die Zeile noch immer hängt (ein anderer Takt war nicht schneller).
      const { data: geholt, error: e2 } = await admin
        .from('dokument_inhalte')
        .update({ versuche: versuche + 1, aktualisiert_am: jetztIso })
        .eq('schluessel', z.schluessel)
        .eq('status', 'laeuft')
        .lt('aktualisiert_am', haengtVor)
        .select('schluessel')
      if (e2 || !(geholt ?? []).length) continue
      await h.stosseAn({ url, name: nameZumLesen(z.name, z.schluessel) }, { teil: ersterOffenerTeil(z), umleitungen: 0, fortsetzen: true })
      ergebnis.angestossen++
      if (z.gross) grossUnterwegs = true
    }
  } catch (err) {
    console.error('Dokumente lesen: Fortsetzen im Minutentakt fehlgeschlagen:', err)
  }
  return ergebnis
}

// ---------- Weitere Dateiformate (ohne KI, direkt als Text) ----------

const ODF_MIME = /^application\/vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)(-template)?$/
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

type Format = 'text' | 'html' | 'odf' | 'pptx' | 'eml'

function formatVon(name: string, typ?: string): Format | null {
  const t = String(typ ?? '').toLowerCase().split(';')[0].trim()
  if (/\.(txt|text|md|log)$/i.test(name) || t === 'text/plain' || t === 'text/markdown') return 'text'
  if (/\.html?$/i.test(name) || t === 'text/html') return 'html'
  if (/\.(odt|ods|odp|ott|ots|otp)$/i.test(name) || ODF_MIME.test(t)) return 'odf'
  if (/\.pptx$/i.test(name) || t === PPTX_MIME) return 'pptx'
  if (/\.eml$/i.test(name) || t === 'message/rfc822') return 'eml'
  return null
}

/** Kann weitererDateiText diese Datei lesen? (Ergänzt lesbareArt in index.ts als Art „buero“.) */
export function istWeiteresTextFormat(name: string, typ?: string): boolean {
  return formatVon(name, typ) !== null
}

const entitaeten: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€', ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', shy: '' }

function entschluessele(t: string): string {
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => entitaeten[n] ?? m)
}

function glaette(t: string): string {
  return t
    .split('\n')
    .map((z) => z.replace(/[  ]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Klartext erkennen: UTF-8, sonst UTF-16 (mit Kennung) oder Windows-1252 (ältere deutsche Dateien). */
export function dekodiereText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export function htmlText(html: string): string {
  return glaette(
    entschluessele(
      html
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(td|th)>/gi, '\t')
        .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    ),
  )
}

/** OpenDocument (.odt/.ods/.odp = ZIP mit content.xml): Absätze als Zeilen, Tabellenzellen durch Tabulator. */
export function odfText(bytes: Uint8Array): string {
  const zip = unzipSync(bytes, { filter: (f) => f.name === 'content.xml' })
  if (!zip['content.xml']) throw new Error('keine OpenDocument-Datei')
  const xml = strFromU8(zip['content.xml'])
    .replace(/<office:annotation[\s\S]*?<\/office:annotation>/g, '')
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n) => ' '.repeat(Math.min(Number(n ?? 1), 20)))
    .replace(/<text:tab\s*\/>/g, '\t')
    .replace(/<text:line-break\s*\/>/g, '\n')
    // Absätze innerhalb einer Zelle bleiben in der Zeile; die Zelle endet mit einem Tabulator.
    .replace(/<table:(?:covered-)?table-cell\b[^>]*\/>/g, '\t')
    .replace(/<table:(?:covered-)?table-cell\b[^>]*>([\s\S]*?)<\/table:(?:covered-)?table-cell>/g, (_, inhalt: string) => `${inhalt.replace(/<\/text:(p|h)>(?=[\s\S]*<text:(p|h)\b)/g, ' ').replace(/<\/text:(p|h)>/g, '')}\t`)
    .replace(/<\/(text:p|text:h|table:table-row)>/g, '\n')
    .replace(/<draw:page\b[^>]*>/g, '\n=== Folie ===\n')
    .replace(/<table:table\s[^>]*table:name="([^"]*)"[^>]*>/g, (_, n) => `\n=== Tabellenblatt: ${n} ===\n`)
    .replace(/<[^>]+>/g, '')
  return glaette(entschluessele(xml).split('\n').map((z) => z.replace(/\t+$/, '')).join('\n'))
}

/** PowerPoint (.pptx = ZIP mit ppt/slides/slideN.xml): Text je Folie in Folienreihenfolge. */
export function pptxText(bytes: Uint8Array): string {
  const zip = unzipSync(bytes, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) })
  const folien = Object.keys(zip).sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))
  if (folien.length === 0) throw new Error('keine PowerPoint-Datei im .pptx-Format')
  return folien
    .map((f, i) => {
      const absaetze = strFromU8(zip[f])
        .split(/<\/a:p>/)
        .map((p) => entschluessele([...p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\s*\/>/g)].map((m) => m[1] ?? '\n').join('')).trim())
        .filter(Boolean)
      return `=== Folie ${i + 1} ===\n${absaetze.join('\n') || '(ohne Text)'}`
    })
    .join('\n\n')
}

/** Gespeicherte Mail (.eml): Kopfzeilen, Anhangsnamen und Text. */
export async function emlText(bytes: Uint8Array): Promise<string> {
  const m = await simpleParser(Buffer.from(bytes))
  // deno-lint-ignore no-explicit-any
  const adressen = (a: any) => (Array.isArray(a) ? a.map((x) => x?.text).filter(Boolean).join(', ') : a?.text ?? '')
  const kopf = [
    `Von: ${adressen(m.from)}`,
    `An: ${adressen(m.to)}`,
    adressen(m.cc) ? `Kopie: ${adressen(m.cc)}` : '',
    m.date ? `Datum: ${m.date.toISOString().slice(0, 10)}` : '',
    `Betreff: ${m.subject ?? ''}`,
    // deno-lint-ignore no-explicit-any
    (m.attachments ?? []).length ? `Anhänge: ${(m.attachments as any[]).map((a) => a.filename || 'ohne Namen').join(', ')}` : '',
  ].filter(Boolean)
  const text = String(m.text ?? '').trim() || (typeof m.html === 'string' ? htmlText(m.html) : '')
  return `${kopf.join('\n')}\n\n${glaette(text)}`
}

/** Text einer Datei der zusätzlichen Formate für die Ablage; null, wenn es keine solche Datei ist. */
export async function weitererDateiText(name: string, typ: string | undefined, bytes: Uint8Array, maxZeichen: number): Promise<string | null> {
  const format = formatVon(name, typ)
  if (!format) return null
  const kuerze = (t: string) => (t.length > maxZeichen ? `${t.slice(0, maxZeichen)}\n… (gekürzt: die Datei ist länger, als hier gelesen wurde)` : t)
  if (format === 'text') return `Inhalt der Textdatei:\n\n${kuerze(glaette(dekodiereText(bytes)))}`
  if (format === 'html') return `Text der Webseite (ohne Bilder und Gestaltung):\n\n${kuerze(htmlText(dekodiereText(bytes)))}`
  if (format === 'odf') return `Text der OpenDocument-Datei (eingebettete Bilder fehlen):\n\n${kuerze(odfText(bytes))}`
  if (format === 'pptx') return `Text der PowerPoint-Präsentation (Bilder und Diagramme fehlen):\n\n${kuerze(pptxText(bytes))}`
  return `Gespeicherte E-Mail:\n\n${kuerze(await emlText(bytes))}`
}
