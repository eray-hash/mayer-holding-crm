// Was ein Exposé und eine Angebotsmail über ein Objekt sagen dürfen — und was nie.
//
// Erlaubt: Objektart, Ort (ohne Straße, außer der Mitarbeiter will die Adresse ausdrücklich zeigen),
// Flächen, Baujahr, Zimmer/Einheiten, Stellplätze, Kaufpreis (sonst „Preis auf Anfrage“), Mieteinnahmen.
// Nie: Eigentümer/Auftraggeber, interne Notizen und Verlauf, Kurzprüfung, Bewertung (auch nicht die
// Kaufpreisvorstellung oder den Zielverkaufspreis), Abrechnung, Unterlagen außer den gewählten Bildern.
import { fmtEUR } from './dates'
import type { Objekt } from '../types'

export type ExposeFakt = { label: string; wert: string }

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert.trim() : typeof wert === 'number' && Number.isFinite(wert) ? String(wert) : ''
}

function positiv(wert: unknown): number {
  const n = typeof wert === 'number' ? wert : typeof wert === 'string' && wert.trim() !== '' ? Number(wert) : NaN
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** „120“ → „120 m²“; Freitext („ca. 120 m²“) bleibt, wie er ist. */
function flaeche(wert: unknown): string {
  const t = text(wert)
  if (!t) return ''
  return /^\d+(?:[.,]\d+)?$/.test(t) ? `${t.replace('.', ',')} m²` : t
}

export function objektartVon(o: Objekt): string {
  return text(o.verkaufsdaten?.uebersicht?.objektart) || o.typ
}

/** Nur der Ort, ohne Straße und Postleitzahl. Leer, wenn er sich nicht sicher ablesen lässt. */
export function ortVon(o: Objekt): string {
  const ohnePlz = (t: string) => t.replace(/\b\d{5}\b/g, '').replace(/\s{2,}/g, ' ').trim()
  const plzOrt = text(o.verkaufsdaten?.uebersicht?.plzOrt)
  if (plzOrt) return ohnePlz(plzOrt)
  const adresse = o.adresse.trim()
  if (!adresse) return ''
  const teile = adresse.split(',').map((t) => t.trim()).filter(Boolean)
  if (teile.length > 1) {
    const letzter = teile[teile.length - 1]
    // „Musterweg 3, Ulm“ oder „…, 89075 Ulm“ — der letzte Teil darf keine Hausnummer mehr enthalten.
    const ort = ohnePlz(letzter)
    return /\d/.test(ort) ? '' : ort
  }
  const mitPlz = adresse.match(/\b\d{5}\s+([^\d,]+)$/)
  if (mitPlz) return mitPlz[1].trim()
  // Ohne Ziffern ist es vermutlich nur ein Ort („Ulm“); mit Ziffern vermutlich eine Straße.
  return /\d/.test(adresse) ? '' : adresse
}

/** Die volle Adresse — nur, wenn der Mitarbeiter sie ausdrücklich zeigen will. */
export function adresseVon(o: Objekt): string {
  const u = o.verkaufsdaten?.uebersicht
  const ausBlatt = [text(u?.strasse), text(u?.plzOrt)].filter(Boolean).join(', ')
  return ausBlatt || o.adresse.trim()
}

export function preisText(o: Objekt): string {
  return o.kaufpreis > 0 ? fmtEUR(o.kaufpreis) : 'Preis auf Anfrage'
}

/** Die Eckdaten für Tabelle und Mail — nur, was hinterlegt ist. Der Kaufpreis steht immer dabei. */
export function exposeFakten(o: Objekt): ExposeFakt[] {
  const k = o.verkaufsdaten?.kennzahlen
  const miete = positiv(k?.jahresnettokaltmiete)
  const fakten: ExposeFakt[] = [
    { label: 'Objektart', wert: objektartVon(o) },
    { label: 'Wohnfläche', wert: flaeche(k?.wohnflaeche) },
    { label: 'Nutzfläche', wert: flaeche(k?.nutzflaeche) },
    { label: 'Grundstück', wert: flaeche(k?.grundstuecksflaeche) },
    { label: 'Baujahr', wert: text(k?.baujahr) },
    { label: 'Zimmer', wert: text(k?.zimmer) },
    { label: 'Einheiten', wert: text(k?.einheiten) },
    { label: 'Stellplätze', wert: text(k?.stellplaetze) },
    { label: 'Mieteinnahmen im Jahr (netto kalt)', wert: miete > 0 ? fmtEUR(miete) : '' },
    { label: 'Kaufpreis', wert: preisText(o) },
  ]
  if (miete > 0 && o.kaufpreis > 0) {
    const faktor = (o.kaufpreis / miete).toFixed(1).replace('.', ',').replace(/,0$/, '')
    fakten.splice(fakten.length - 1, 0, { label: 'Kaufpreis-Faktor', wert: `${faktor}-fach` })
  }
  return fakten.filter((f) => f.wert !== '')
}

export function standardTitel(o: Objekt, ort: string): string {
  const art = objektartVon(o)
  return ort.trim() ? `${art} in ${ort.trim()}` : art
}

/** Wörter, die in einem anonymen Text nicht vorkommen sollten: Straße (wenn die Adresse nicht gezeigt
 *  wird) und Namen von Eigentümer/Auftraggeber. Liefert, was gefunden wurde. */
export function interneAngabenIn(o: Objekt, inhalt: string, adresseErlaubt: boolean): string[] {
  const t = inhalt.toLowerCase()
  const gefunden = new Set<string>()
  const namen = [o.eigentuemer?.name, o.eigentuemer?.ansprechpartner, o.verkaufsdaten?.auftraggeber?.name].map(text).filter((n) => n.length >= 4)
  for (const n of namen) {
    if (t.includes(n.toLowerCase())) gefunden.add(`Name des Eigentümers („${n}“)`)
    // Auch der Nachname allein („Frau Muster“).
    const nachname = n.split(/\s+/).pop() ?? ''
    if (nachname.length >= 4 && nachname !== n && new RegExp(`\\b${nachname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(inhalt)) gefunden.add(`Name des Eigentümers („${nachname}“)`)
  }
  if (!adresseErlaubt) {
    const strassen = [text(o.verkaufsdaten?.uebersicht?.strasse), o.adresse.includes(',') || /\d/.test(o.adresse) ? o.adresse.split(',')[0].trim() : '']
    for (const s of strassen) {
      if (!s || !/\d|str\.|straße|strasse|weg|gasse|platz|allee|ring/i.test(s)) continue
      const ohneNummer = s.replace(/\s*\d+\s*[a-z]?(?:\s*[-–/]\s*\d+\s*[a-z]?)?$/i, '').trim()
      if (ohneNummer.length >= 4 && t.includes(ohneNummer.toLowerCase())) gefunden.add(`Straße („${ohneNummer}“)`)
    }
  }
  return [...gefunden]
}

// ── Angebotsmail an passende Gesuche ─────────────────────────────────────────────────────────────

/** Platzhalter im Mailtext, der je Empfänger durch den Namen ersetzt wird. */
export const NAME_PLATZHALTER = '{Name}'

export function mailBetreffVorschlag(titel: string): string {
  return `Angebot passend zu Ihrer Suche: ${titel}`
}

export function mailTextVorschlag(eingabe: { titel: string; fakten: ExposeFakt[]; vertraulich: boolean; wer: string; mitSignatur: boolean }): string {
  const { titel, fakten, vertraulich, wer, mitSignatur } = eingabe
  const punkte = fakten.filter((f) => f.label !== 'Objektart').map((f) => `– ${f.label}: ${f.wert}`)
  const gruss = mitSignatur ? 'Freundliche Grüße' : `Freundliche Grüße\n${wer}`
  return [
    `Guten Tag ${NAME_PLATZHALTER},`,
    'Sie suchen bei uns eine Immobilie. Uns liegt ein Angebot vor, das zu Ihrer Suche passen könnte:',
    [titel, ...punkte].join('\n'),
    ...(vertraulich ? ['Dieses Objekt wird nicht öffentlich angeboten. Bitte behandeln Sie die Angaben vertraulich und geben Sie sie nicht weiter.'] : []),
    'Alle Einzelheiten und Bilder finden Sie im beigefügten Exposé. Wenn das Objekt für Sie in Frage kommt, melden Sie sich gern bei uns. Dann nennen wir Ihnen die genaue Lage und vereinbaren auf Wunsch einen Termin zur Besichtigung.',
    gruss,
  ].join('\n\n')
}

/** Setzt den Namen ein; ohne Namen wird aus „Guten Tag {Name},“ einfach „Guten Tag,“. */
export function mitName(vorlage: string, name: string): string {
  const n = name.trim()
  return n ? vorlage.split(NAME_PLATZHALTER).join(n) : vorlage.replace(new RegExp(`\\s*${NAME_PLATZHALTER.replace(/[{}]/g, '\\$&')}`, 'g'), '')
}
