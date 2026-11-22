// Suchanfrage für die Volltextsuche (public.suche_alles, 22.11.2026): macht aus dem, was jemand ins
// Suchfeld tippt, eine sichere Anfrage in der Schreibweise von to_tsquery. Genutzt vom CRM
// (src/components/GlobaleSuche.tsx) und vom Assistenten (telegram-gateway/sucheWerkzeug.ts).
// Reine Funktionen ohne Datenbank, damit sie sich ohne Netz prüfen lassen.
//
// Regeln:
// - Jedes Wort zählt als Wortanfang: „Müll“ findet „Müller“ (Umlaute, Akzente und ß/ss gleicht die
//   Datenbank selbst an, ebenso Wortstämme: „Häuser“ findet „Haus“).
// - Mehrere Wörter: alle müssen vorkommen (irgendwo im Eintrag).
// - "In Anführungszeichen" (auch „deutsche“ oder «diese»): genau diese Wortfolge, ohne Wortanfang —
//   außer das Zeichen ist noch nicht geschlossen (man tippt gerade), dann gilt das letzte Wort als Anfang.
// - -wort: Einträge mit diesem Wort ausschließen. Nur Ausschlüsse ergeben keine Suche.
// - ODER (groß geschrieben) bzw. | zwischen zwei Begriffen: einer von beiden genügt.
// - Zusammengesetztes wie „Müller-Lüdenscheidt“ oder „07162/45569“: die Teile direkt hintereinander.
// - E-Mail-Adressen bleiben ein Begriff.
// - Einzelne Buchstaben fallen weg (sie wären der Anfang von fast allem).
// Ausgabe enthält nur Buchstaben, Ziffern, die Operatoren & | ! <-> ( ) :* und in Hochkommas gesetzte
// E-Mail-Adressen — to_tsquery kann daran nicht scheitern.

export type SuchBegriff = {
  /** wort = getipptes Wort (ggf. aus Teilen), folge = Wortfolge in Anführungszeichen, adresse = E-Mail-Adresse */
  art: 'wort' | 'folge' | 'adresse'
  /** Teile in Kleinbuchstaben (nur Buchstaben/Ziffern; bei adresse die ganze Adresse) */
  teile: string[]
  /** Ausschluss (-wort) */
  ohne: boolean
  /** Letzter Teil als Wortanfang */
  anfang: boolean
}

/** UND über die Gruppen, ODER innerhalb einer Gruppe. */
export type SuchGruppe = SuchBegriff[]

export const MAX_EINGABE = 300
export const MAX_BEGRIFFE = 10

const ANFUEHRUNG = /[„“”‟«»"]/g
// Buchstaben samt kombinierenden Zeichen (z. B. „İ“ → i + Punkt) und Ziffern
const TEIL = /[\p{L}\p{M}\p{N}]+/gu

function teileVon(text: string): string[] {
  return (text.normalize('NFC').toLowerCase().match(TEIL) ?? []) as string[]
}

/** Einzelne Buchstaben weg; einzelne Ziffern bleiben nur innerhalb einer Folge („Haus 3“). */
function sinnvolleTeile(teile: string[], inFolge: boolean): string[] {
  return teile.filter((t) => t.length >= 2 || (inFolge && /\p{N}/u.test(t)))
}

type Roh = { text: string; folge: boolean; geschlossen: boolean; ohne: boolean }

function zerlegeRoh(eingabe: string): Roh[] {
  const s = String(eingabe ?? '').slice(0, MAX_EINGABE).replace(ANFUEHRUNG, '"')
  const aus: Roh[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    let ohne = false
    if ((c === '-' || c === '+') && s[i + 1] === '"') {
      ohne = c === '-'
      i++
    }
    if (s[i] === '"') {
      const ende = s.indexOf('"', i + 1)
      const text = ende < 0 ? s.slice(i + 1) : s.slice(i + 1, ende)
      aus.push({ text, folge: true, geschlossen: ende >= 0, ohne })
      i = ende < 0 ? s.length : ende + 1
      continue
    }
    let j = i
    while (j < s.length && !/\s/.test(s[j]) && s[j] !== '"') j++
    aus.push({ text: s.slice(i, j), folge: false, geschlossen: true, ohne: false })
    i = j
  }
  return aus
}

function begriffAus(r: Roh): SuchBegriff | 'oder' | null {
  if (r.folge) {
    const teile = sinnvolleTeile(teileVon(r.text), true)
    if (teile.length === 0 || (teile.length === 1 && teile[0].length < 2)) return null
    return { art: 'folge', teile, ohne: r.ohne, anfang: !r.geschlossen }
  }
  let text = r.text
  if (text === '|' || text === 'ODER') return 'oder'
  let ohne = false
  if (text.length > 1 && text[0] === '-') {
    ohne = true
    text = text.slice(1)
  } else if (text[0] === '+') text = text.slice(1)
  if (text.includes('@')) {
    const adresse = text.toLowerCase().replace(/[^\p{L}\p{N}@._+-]/gu, '').replace(/^[._+-]+|[._+-]+$/g, '')
    if (/^[^@]+@[^@]*$/.test(adresse) && adresse.length >= 3) return { art: 'adresse', teile: [adresse], ohne, anfang: true }
  }
  const teile = sinnvolleTeile(teileVon(text), false)
  if (teile.length === 0) return null
  return { art: 'wort', teile, ohne, anfang: true }
}

/** Zerlegt die Eingabe in Gruppen (UND) von Begriffen (ODER). */
export function zerlegeSuche(eingabe: string): SuchGruppe[] {
  const gruppen: SuchGruppe[] = []
  let oderOffen = false
  let anzahl = 0
  for (const r of zerlegeRoh(eingabe)) {
    const b = begriffAus(r)
    if (b === null) continue
    if (b === 'oder') {
      oderOffen = gruppen.length > 0
      continue
    }
    if (anzahl >= MAX_BEGRIFFE) break
    anzahl++
    if (oderOffen) gruppen[gruppen.length - 1].push(b)
    else gruppen.push([b])
    oderOffen = false
  }
  return gruppen
}

function teilText(b: SuchBegriff): string {
  if (b.art === 'adresse') return `'${b.teile[0]}'${b.anfang ? ':*' : ''}`
  const teile = b.teile.map((t, i) => (b.anfang && i === b.teile.length - 1 ? `${t}:*` : t))
  return teile.length > 1 ? `(${teile.join(' <-> ')})` : teile[0]
}

function begriffText(b: SuchBegriff): string {
  return b.ohne ? `!${teilText(b)}` : teilText(b)
}

/**
 * Die Anfrage für suche_alles(q): '' heißt „nichts zu suchen“ (zu kurz, nur Ausschlüsse, nur Zeichen).
 * Eine Gruppe, in der alles ausgeschlossen ist, bleibt als Ausschluss stehen; es muss aber mindestens
 * ein Begriff gesucht (nicht ausgeschlossen) werden.
 */
export function alsTsquery(eingabe: string): string {
  const gruppen = zerlegeSuche(eingabe)
  if (!gruppen.some((g) => g.some((b) => !b.ohne))) return ''
  return gruppen
    .map((g) => (g.length > 1 ? `(${g.map(begriffText).join(' | ')})` : begriffText(g[0])))
    .join(' & ')
}

/** Die gesuchten (nicht ausgeschlossenen) Teile — z. B. zum Hervorheben in Treffern ohne Ausschnitt. */
export function gesuchteTeile(eingabe: string): string[] {
  const aus = new Set<string>()
  for (const g of zerlegeSuche(eingabe)) for (const b of g) if (!b.ohne) for (const t of b.teile) aus.add(t)
  return [...aus]
}

/** Markierung der Fundstellen in ausschnitt (ts_headline in suche_alles). */
export const MARKE_AUF = '⟦'
export const MARKE_ZU = '⟧'

/** Zerlegt einen Ausschnitt in Stücke mit/ohne Markierung (für die Anzeige ohne HTML). */
export function ausschnittTeile(ausschnitt: string | null | undefined): { text: string; treffer: boolean }[] {
  const s = String(ausschnitt ?? '')
  const aus: { text: string; treffer: boolean }[] = []
  let i = 0
  while (i < s.length) {
    const auf = s.indexOf(MARKE_AUF, i)
    if (auf < 0) {
      aus.push({ text: s.slice(i), treffer: false })
      break
    }
    if (auf > i) aus.push({ text: s.slice(i, auf), treffer: false })
    const zu = s.indexOf(MARKE_ZU, auf + 1)
    if (zu < 0) {
      aus.push({ text: s.slice(auf + 1), treffer: true })
      break
    }
    aus.push({ text: s.slice(auf + 1, zu), treffer: true })
    i = zu + 1
  }
  return aus.filter((t) => t.text !== '')
}

/** Ausschnitt als schlichter Text (Markierungen entfernt). */
export function ausschnittText(ausschnitt: string | null | undefined): string {
  return String(ausschnitt ?? '').split(MARKE_AUF).join('').split(MARKE_ZU).join('')
}
