// Gesprächsleitfaden aus Vorlagentext (Runde 5, 22.11.2026): Die Fragebögen der Bereiche liegen als Vorlagen
// in der Tabelle vorlagen (Spalte text, Markdown-artig mit {{Platzhaltern}}). Dieses Modul macht daraus eine
// abhakbare Liste für die laufende Aufnahme. Rein und ohne Browser-Abhängigkeit (Test: leitfadenText.test.ts).
//
// Erkannt wird:
//   ## Überschrift                       → neuer Abschnitt
//   **Fett allein**                      → Unterabschnitt (oder Frage, wenn darunter nur ein Platzhalter steht)
//   ☐ Punkt   /   ☐ | Punkt | … (Tabelle) → Punkt (eingerückt = Unterpunkt)
//   • Frage?  /  - Frage  /  o Frage     → Punkt; endet er auf „:“, ist es ein Unterabschnitt
//   Bezeichnung: {{Feld}}                → Punkt „Bezeichnung“ (Kopfzeilen wie Datum/Kunde/Telefon nicht)
//   Satz mit „?“                         → Punkt
//   Satz mit „:“ und darunter {{Feld}}   → Punkt
// Alles andere (Hinweistexte, Kopfzeilen mit mehreren Feldern, Tabellenköpfe) fällt weg.

export type LeitfadenPunkt = {
  /** Eindeutig innerhalb des Leitfadens (Abschnitt + Text). */
  id: string
  text: string
  /** Erläuterung hinter einem fetten Stichwort („**Kontoauszüge:** letzte 12 Monate“ → hinweis). */
  hinweis?: string
  unter?: boolean
}

export type LeitfadenAbschnitt = { titel: string; ober?: string; punkte: LeitfadenPunkt[] }

export type Leitfaden = {
  id: string
  name: string
  bereich: string
  typ: string
  abschnitte: LeitfadenAbschnitt[]
  anzahl: number
}

export type VorlageZeile = { id: string; name: string; bereich: string | null; typ: string | null; text: string | null }

/** Vorlagen-Typen, die als Leitfaden taugen. */
export const LEITFADEN_TYPEN = ['Fragebogen', 'Checkliste']

const PLATZHALTER = /\{\{([^{}]*)\}\}/g
const NUR_PLATZHALTER = /^\s*(\{\{[^{}]*\}\}\s*)+$/
const KAESTCHEN = /^(\s*)(?:☐|☑|☒|\[\s?[xX]?\s?\])\s*(.*)$/
const AUFZAEHLUNG = /^(\s*)(?:[•\-*–]|o)\s+(.+)$/
const FELD = /^([^{}:|]{1,80}):\s*\{\{[^{}]*\}\}\s*$/
/** Bezeichnungen, die nur Kopf- oder Fußzeile des Formulars sind. */
const UEBERGEHEN = new Set(['datum', 'kunde', 'telefon', 'bereich', 'notizen', 'notiz', 'ortdatum', 'unterschrift', 'ihrefragenbzwnotizen', 'fragenbzwnotizen', 'bemerkung', 'bearbeiter', 'aktenzeichen'])

function schluessel(s: string): string {
  return s.toLowerCase().replace(/[^a-zäöüß0-9]/g, '')
}

function ohneFett(s: string): string {
  return s.replace(/\*\*/g, '').replace(/__/g, '')
}

/** Platzhalter ersetzen: {{X=Wert}} → Wert, „Feld: {{X}}“ → „Feld“, sonst {{X}} → „…“. */
export function saeubere(s: string): string {
  return ohneFett(s)
    .replace(/:\s*\{\{([^{}=]*)\}\}/g, '')
    .replace(PLATZHALTER, (_, inhalt: string) => {
      const i = inhalt.indexOf('=')
      return i >= 0 ? inhalt.slice(i + 1).trim() : '…'
    })
    .replace(/_{3,}/g, '')
    .replace(/\s{3,}/g, ' – ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.)])/g, '$1')
    .replace(/(\s–)+\s*$/, '')
    .trim()
}

function zerlegePunkt(roh: string): { text: string; hinweis?: string } {
  // „**Stichwort:** Erläuterung“ → Stichwort + Hinweis
  const m = roh.match(/^\s*\*\*([^*]{2,80}?):?\*\*:?\s+(.+)$/)
  if (m && m[2].trim().length > 0) {
    const text = saeubere(m[1]).replace(/:$/, '')
    const hinweis = saeubere(m[2])
    if (text && hinweis) return { text, hinweis }
  }
  return { text: saeubere(roh).replace(/:$/, '') }
}

/** Macht aus dem Text einer Vorlage die Abschnitte eines Leitfadens (leere Abschnitte fallen weg). */
export function leitfadenAusText(text: string): LeitfadenAbschnitt[] {
  const zeilen = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const abschnitte: LeitfadenAbschnitt[] = []
  let ober: string | undefined
  let aktuell: LeitfadenAbschnitt = { titel: 'Allgemein', punkte: [] }
  abschnitte.push(aktuell)
  const ids = new Set<string>()

  const naechsteZeile = (i: number): string => {
    for (let j = i + 1; j < zeilen.length; j++) if (zeilen[j].trim()) return zeilen[j]
    return ''
  }
  const neuerAbschnitt = (titel: string, alsOber: boolean) => {
    const t = saeubere(titel).replace(/:$/, '')
    if (!t) return
    if (alsOber) ober = t
    aktuell = { titel: t, ober: alsOber ? undefined : ober, punkte: [] }
    abschnitte.push(aktuell)
  }
  // Einrückung je Punkt; „unter“ wird am Ende je Abschnitt bestimmt (tiefer als der flachste Punkt).
  const einzug = new Map<LeitfadenPunkt, number>()
  const punkt = (roh: string, tiefe = 0) => {
    const { text: t, hinweis } = zerlegePunkt(roh)
    if (!t || t === '…' || t.length < 2) return
    const nr = abschnitte.length - 1
    let id = `${nr}:${t}`
    for (let k = 2; ids.has(id); k++) id = `${nr}:${t}#${k}`
    ids.add(id)
    const p: LeitfadenPunkt = { id, text: t, ...(hinweis ? { hinweis } : {}) }
    einzug.set(p, tiefe)
    aktuell.punkte.push(p)
  }

  for (let i = 0; i < zeilen.length; i++) {
    const zeile = zeilen[i].replace(/\s+$/, '')
    const roh = zeile.trim()
    if (!roh) continue
    if (/^#\s/.test(roh)) continue // Titel der Vorlage
    if (/^#{2,}\s/.test(roh)) {
      neuerAbschnitt(roh.replace(/^#+\s*/, ''), true)
      continue
    }
    if (NUR_PLATZHALTER.test(roh)) continue
    const naechste = naechsteZeile(i)
    const folgtFeld = NUR_PLATZHALTER.test(naechste)

    const k = zeile.match(KAESTCHEN)
    if (k) {
      let inhalt = k[2]
      if (inhalt.startsWith('|')) inhalt = inhalt.split('|').map((x) => x.trim()).find(Boolean) ?? ''
      punkt(inhalt, k[1].length)
      continue
    }
    if (roh.includes('|')) continue // Tabellen ohne Kästchen (Kopfzeilen, Mandatsdaten)

    // Fett allein: Unterabschnitt — oder Frage, wenn nur ein Feld folgt
    const fett = roh.match(/^\*\*(.+?)\*\*:?$/)
    if (fett && !AUFZAEHLUNG.test(ohneFett(roh))) {
      const t = saeubere(fett[1]).replace(/:$/, '')
      if (UEBERGEHEN.has(schluessel(t))) continue
      if (folgtFeld) punkt(fett[1])
      else neuerAbschnitt(fett[1], false)
      continue
    }

    const a = ohneFett(zeile).match(AUFZAEHLUNG)
    if (a) {
      const inhalt = a[2].trim()
      if (/:$/.test(inhalt) && !folgtFeld) neuerAbschnitt(inhalt, false)
      else punkt(inhalt, a[1].length)
      continue
    }

    const f = roh.match(FELD)
    if (f) {
      if (!UEBERGEHEN.has(schluessel(ohneFett(f[1])))) punkt(f[1])
      continue
    }
    if ((roh.match(PLATZHALTER) ?? []).length > 0) continue // Kopfzeilen mit mehreren Feldern, Fließtext mit Feld

    const klar = saeubere(roh)
    // „Relevante Bereiche: Immobilien, Depots, …“ → Unterabschnitt mit je einem Punkt
    const aufzaehlung = klar.match(/^([^:]{3,60}):\s+(.+)$/)
    const teile = aufzaehlung ? aufzaehlung[2].replace(/\.$/, '').split(/,\s*/).map((x) => x.trim()).filter(Boolean) : []
    if (aufzaehlung && !klar.includes('?') && teile.length >= 4 && teile.every((x) => x.length <= 60)) {
      neuerAbschnitt(aufzaehlung[1], false)
      for (const t of teile) punkt(t.charAt(0).toUpperCase() + t.slice(1))
      continue
    }
    if (klar.includes('?') && klar.length <= 200) punkt(roh)
    else if (/:$/.test(klar) && folgtFeld) punkt(roh)
    else if (/:$/.test(klar) && klar.length <= 80) neuerAbschnitt(roh, false)
  }
  for (const x of abschnitte) {
    const flach = Math.min(...x.punkte.map((p) => einzug.get(p) ?? 0))
    for (const p of x.punkte) if ((einzug.get(p) ?? 0) > flach) p.unter = true
  }
  return abschnitte.filter((x) => x.punkte.length > 0)
}

export function leitfadenAusVorlage(v: VorlageZeile): Leitfaden | null {
  if (!v.text || !v.text.trim()) return null
  const abschnitte = leitfadenAusText(v.text)
  const anzahl = abschnitte.reduce((n, x) => n + x.punkte.length, 0)
  if (anzahl < 2) return null
  return { id: v.id, name: v.name, bereich: v.bereich ?? '', typ: v.typ ?? '', abschnitte, anzahl }
}

/** Bereich der Vorlagen zu einer Akte: Objekte und Immobilienkunden → „immobilien“. */
export function vorlagenBereich(kundeBereich?: string | null, objekt?: boolean): string | null {
  if (objekt) return 'immobilien'
  if (!kundeBereich) return null
  return kundeBereich === 'immobilienkunden' ? 'immobilien' : kundeBereich
}

/**
 * Vorschlag, welcher Leitfaden zur Aufnahme passt:
 *  - zuletzt für diesen Bereich und diese Art gewählt (auch „keiner“ = '') → genau das,
 *  - Notiz → keiner,
 *  - Termin → der Mandantenfragebogen des Bereichs, sonst der erste Fragebogen,
 *  - Telefonat → der Fragebogen mit dem größten Anteil echter Fragen („?“), wenn das mindestens ein Drittel ist;
 *    Bögen für Dritte („Fragen an den Steuerberater“) nicht.
 */
export function vorschlag(liste: Leitfaden[], opt: { bereich: string | null; art: 'termin' | 'telefon' | 'notiz'; zuletzt?: string | null }): string | null {
  if (opt.zuletzt !== undefined && opt.zuletzt !== null) {
    if (opt.zuletzt === '') return null
    if (liste.some((l) => l.id === opt.zuletzt)) return opt.zuletzt
  }
  if (opt.art === 'notiz' || !opt.bereich) return null
  const frageboegen = liste.filter((l) => l.bereich === opt.bereich && l.typ === 'Fragebogen')
  if (frageboegen.length === 0) return null
  if (opt.art === 'termin') return (frageboegen.find((l) => /mandantenfragebogen/i.test(l.name)) ?? frageboegen[0]).id
  const anteil = (l: Leitfaden) => l.abschnitte.reduce((n, a) => n + a.punkte.filter((p) => p.text.includes('?')).length, 0) / Math.max(1, l.anzahl)
  const fragen = frageboegen
    .filter((l) => l.anzahl >= 3 && !/\ban (den|die|das)\b/i.test(l.name) && anteil(l) >= 1 / 3)
    .sort((a, b) => anteil(b) - anteil(a))
  return fragen[0]?.id ?? null
}

/** Text der Markierung für eine Notiz zu einer Frage (Server kürzt Markierungen auf 300 Zeichen). */
export function frageMarkerText(frage: string, notiz: string): string {
  const f = frage.length > 140 ? `${frage.slice(0, 139).trimEnd()}…` : frage
  return `${f}: ${notiz.trim()}`.slice(0, 300)
}

/** Text der Markierung, die festhält, welcher Leitfaden benutzt wurde (gespraech_notiz kennt kein Feld dafür). */
export function leitfadenMarkerText(l: Pick<Leitfaden, 'id' | 'name'>): string {
  return `Leitfaden: ${l.name} [${l.id}]`.slice(0, 300)
}
