// Befüllbare Vorlagen.
//
// Eine Vorlage ist Text mit drei einfachen Auszeichnungen:
//   # Titel            → Dokumenttitel
//   ## Abschnitt       → Zwischenüberschrift
//   a | b | c          → Tabellenzeile (aufeinanderfolgende Zeilen bilden eine Tabelle)
//   **fett**           → Hervorhebung, wie im Original fett gedruckt
//   (Leerzeichen am Zeilenanfang) → Einrückung, z. B. für Unterpunkte
// und zwei Arten von Stellen, die beim Ausfüllen leben:
//   {{Feldname}}       → Feld; gleiche Namen bedeuten dasselbe Feld
//   {{Feldname=Text}}  → Feld mit Vorgabe (z. B. das übliche Honorar), die sich überschreiben lässt
//   ☐                  → Ankreuzkästchen (☒ = angekreuzt)
//
// Der Wortlaut der Vorlagen stammt aus den Originalen der Kanzlei; hier wird nichts umformuliert,
// nur eingesetzt. Dieselbe Zerlegung speist die Vorschau am Bildschirm und das PDF (vorlagePdf.ts),
// damit beides garantiert dasselbe zeigt.

export type InlineTeil =
  | { art: 'text'; text: string; fett?: boolean }
  | { art: 'feld'; name: string }
  | { art: 'kaestchen'; nr: number; vorbelegt: boolean }

export type VorlagenBlock =
  | { art: 'titel'; teile: InlineTeil[] }
  | { art: 'ueberschrift'; teile: InlineTeil[] }
  | { art: 'zeile'; teile: InlineTeil[]; einzug: number }
  | { art: 'leer' }
  | { art: 'tabelle'; zeilen: InlineTeil[][][] }

const FELD = /\{\{\s*([^{}]+?)\s*\}\}/g

const feldName = (roh: string) => roh.split('=')[0].trim()

/** Alle Feldnamen einer Vorlage, jeder einmal, in der Reihenfolge ihres ersten Auftretens. */
export function felderAus(text: string): string[] {
  const namen: string[] = []
  for (const m of text.matchAll(FELD)) {
    const name = feldName(m[1])
    if (!namen.includes(name)) namen.push(name)
  }
  return namen
}

/** Vorgaben aus der Vorlage selbst ({{Feld=Vorgabe}}); die erste Angabe je Feld gilt. */
export function vorgabenAus(text: string): Record<string, string> {
  const vorgaben: Record<string, string> = {}
  for (const m of text.matchAll(FELD)) {
    const i = m[1].indexOf('=')
    if (i < 0) continue
    const name = feldName(m[1])
    if (!(name in vorgaben)) vorgaben[name] = m[1].slice(i + 1).trim()
  }
  return vorgaben
}

/** Nummern der Kästchen, die in der Vorlage selbst schon angekreuzt sind (☒) — Ausgangszustand beim Ausfüllen. */
export function vorbelegteKaestchen(text: string): Set<number> {
  const an = new Set<number>()
  let nr = 0
  for (const m of text.matchAll(/[☐☒]/g)) {
    if (m[0] === '☒') an.add(nr)
    nr++
  }
  return an
}

function inline(text: string, zaehler: { nr: number }): InlineTeil[] {
  const teile: InlineTeil[] = []
  const muster = /\{\{\s*([^{}]+?)\s*\}\}|[☐☒]/g
  // Abschnitte zwischen ** sind fett; ungerade Stücke nach dem Aufteilen liegen innerhalb.
  text.split('**').forEach((stueck, i) => {
    const fett = i % 2 === 1
    let pos = 0
    const schiebe = (t: string) => {
      if (t) teile.push(fett ? { art: 'text', text: t, fett } : { art: 'text', text: t })
    }
    for (const m of stueck.matchAll(muster)) {
      schiebe(stueck.slice(pos, m.index))
      if (m[1] !== undefined) teile.push({ art: 'feld', name: feldName(m[1]) })
      else teile.push({ art: 'kaestchen', nr: zaehler.nr++, vorbelegt: m[0] === '☒' })
      pos = m.index + m[0].length
    }
    schiebe(stueck.slice(pos))
  })
  return teile
}

export function zerlegeVorlage(text: string): VorlagenBlock[] {
  const zaehler = { nr: 0 }
  const bloecke: VorlagenBlock[] = []
  for (const roh of text.replace(/\r\n/g, '\n').split('\n')) {
    const zeile = roh.trimEnd()
    if (!zeile.trim()) {
      bloecke.push({ art: 'leer' })
    } else if (zeile.startsWith('## ')) {
      bloecke.push({ art: 'ueberschrift', teile: inline(zeile.slice(3), zaehler) })
    } else if (zeile.startsWith('# ')) {
      bloecke.push({ art: 'titel', teile: inline(zeile.slice(2), zaehler) })
    } else if (zeile.includes(' | ')) {
      const zellen = zeile.split(' | ').map((z) => inline(z.trim(), zaehler))
      const letzter = bloecke[bloecke.length - 1]
      if (letzter?.art === 'tabelle') letzter.zeilen.push(zellen)
      else bloecke.push({ art: 'tabelle', zeilen: [zellen] })
    } else {
      const einzug = zeile.length - zeile.trimStart().length
      bloecke.push({ art: 'zeile', teile: inline(zeile.trimStart(), zaehler), einzug })
    }
  }
  return bloecke
}

/** Erste Tabellenzeile ist eine Kopfzeile, wenn sie nur aus Text besteht (keine Felder, keine Kästchen). */
export function hatKopfzeile(zeilen: InlineTeil[][][]): boolean {
  return zeilen.length > 1 && zeilen[0].every((zelle) => zelle.every((t) => t.art === 'text'))
}

/** Felder, die außerhalb von Tabellen stehen — die Hauptangaben einer Vorlage. */
export function hauptfelder(text: string): string[] {
  const namen: string[] = []
  for (const b of zerlegeVorlage(text)) {
    if (b.art === 'leer' || b.art === 'tabelle') continue
    for (const t of b.teile) if (t.art === 'feld' && !namen.includes(t.name)) namen.push(t.name)
  }
  return namen
}

export type FuellKontext = {
  kunde?: { firma?: string; ansprechpartner?: string; email?: string; telefon?: string }
  mitarbeiter?: string
  heute: string // schon als TT.MM.JJJJ
}

const schluessel = (name: string) =>
  name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * Wert, der sich ohne Nachfragen aus der Akte ergibt — oder undefined, wenn das Feld von Hand
 * auszufüllen ist. Bewusst eng gefasst: lieber ein Feld leer lassen als etwas Falsches einsetzen
 * (z. B. nie den Ansprechpartner in ein Feld "Name der Bank" schreiben).
 */
export function autoWert(feldName: string, ctx: FuellKontext): string | undefined {
  const k = schluessel(feldName)
  const hat = (...worte: string[]) => worte.some((w) => new RegExp(`(^| )${w}( |$)`).test(k))
  const kunde = ctx.kunde

  if (k === 'datum' || k === 'heutiges datum' || k === 'datum heute') return ctx.heute
  if (k === 'ort datum') return `Ulm, ${ctx.heute}`
  if (k === 'ort') return 'Ulm'
  if (hat('berater', 'bearbeiter', 'protokollfuehrer', 'sachbearbeiter') && !hat('steuerberater')) return ctx.mitarbeiter || undefined

  if (!kunde) return undefined
  // Durchnummerierte Zeilen (Teilnehmer 2, 3 …) meinen weitere Personen — nur die erste Zeile gehört dem Kunden.
  if (/ (?:[2-9]|\d{2,})$/.test(k)) return undefined
  // Alles, was erkennbar eine andere Person oder Stelle meint oder was die Akte gar nicht kennt
  // (Anschrift, Geburtsdatum, Steuernummer), bleibt leer.
  if (
    hat(
      'bank', 'steuerberater', 'notar', 'finanzamt', 'ehepartner', 'ehegatte', 'kind', 'kinder', 'bevollmaechtigter', 'bevollmaechtigte',
      'zeuge', 'geburtsdatum', 'geburtsort', 'geburtsname', 'unterzeichner', 'berater', 'bearbeiter', 'adresse', 'anschrift', 'strasse',
      'plz', 'wohnhaft', 'wohnort', 'steuernummer', 'steuer', 'nummer', 'aktenzeichen',
    )
  )
    return undefined
  const mail = hat('e mail', 'email', 'mail')
  const tel = hat('telefon', 'tel', 'mobil', 'telefonnummer')
  if (mail && tel) return [kunde.telefon, kunde.email].filter(Boolean).join(' / ') || undefined
  if (mail) return kunde.email || undefined
  if (tel) return kunde.telefon || undefined
  // Nur das Feld, das wirklich den Firmennamen meint — nicht etwa "Anzahl Unternehmen" in einem Fragebogen.
  if (['firma', 'firmenname', 'unternehmen', 'unternehmensname', 'name der firma', 'firma unternehmen', 'name des unternehmens'].includes(k)) {
    // Bei Privatpersonen steht in der Akte derselbe Name als Firma und Ansprechpartner — dann keine eigene Firmenzeile.
    return kunde.firma && kunde.firma.trim() !== kunde.ansprechpartner?.trim() ? kunde.firma : undefined
  }
  const person = kunde.ansprechpartner?.trim()
  const firma = kunde.firma?.trim()
  // "Name …" meint die unterschreibende Person, auch wenn dahinter die Rolle steht (Name Auftraggeber).
  if (k.startsWith('name ') && !k.includes('firma') && !k.includes('unternehmen')) return person || firma || undefined
  // Vertragspartei: Firma und Person, wenn beides bekannt und verschieden ist.
  if (hat('mandant', 'auftraggeber', 'vollmachtgeber', 'kunde')) return (firma && person && firma !== person ? `${firma}, ${person}` : person || firma) || undefined
  if (k === 'nachname') return person?.split(/\s+/).pop() || undefined
  if (hat('name', 'vorname', 'ansprechpartner', 'teilnehmer')) return person || firma || undefined
  return undefined
}

/**
 * Vorbelegung aller Felder einer Vorlage: die Vorgabe aus der Vorlage, sonst der Wert aus der Akte,
 * wo es einen gibt. Nicht ableitbare Felder fehlen im Ergebnis.
 */
export function vorbelegung(text: string, ctx: FuellKontext): Record<string, string> {
  const vorgaben = vorgabenAus(text)
  const werte: Record<string, string> = { ...vorgaben }
  for (const name of felderAus(text)) {
    // Eine Vorgabe der Vorlage (z. B. der Unterzeichner mit seiner Telefonnummer) wird nie von der Akte überschrieben.
    if (name in vorgaben) continue
    const w = autoWert(name, ctx)
    if (w) werte[name] = w
  }
  return werte
}

export const LEERES_FELD = '____________________'

/** Fertiger Fließtext (für E-Mail, Zwischenablage, Assistent): Felder eingesetzt, Kästchen gesetzt. */
export function fuelleAlsText(text: string, werte: Record<string, string>, angekreuzt: ReadonlySet<number> = vorbelegteKaestchen(text)): string {
  let nr = 0
  return text
    .replace(/[☐☒]/g, () => (angekreuzt.has(nr++) ? '☒' : '☐'))
    .replace(FELD, (_m, roh: string) => werte[feldName(roh)]?.trim() || LEERES_FELD)
    .replace(/^##? /gm, '')
    .replace(/\*\*/g, '')
}

/** Felder, die noch keinen Wert haben — für den Hinweis "noch offen" vor Druck oder Versand. */
export function offeneFelder(text: string, werte: Record<string, string>): string[] {
  return felderAus(text).filter((n) => !werte[n]?.trim())
}
