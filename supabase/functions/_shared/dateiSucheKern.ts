// Unscharfe Suche nach hochgeladenen Dateien (25.11.2026, Wunsch aus dem Wünsche-Tracking: „Hochgeladene
// Datei über ungefähren Namen finden“ — die Suche nach einer hochgeladenen Übersichtsliste fand mit dem
// genannten Namen nichts, weil alles_durchsuchen nur ganze Wortanfänge in gelesenen Inhalten findet).
//
// Reine Funktionen ohne Datenbank: Das Werkzeug datei_finden (telegram-gateway/sucheWerkzeug.ts) lädt die
// Dokumentlisten der Akten und Objekte, prüft die Rechte und gibt hier nur noch Kandidaten herein.
//
// Was als Treffer zählt (je Suchwort der beste Wert über alle Felder, dann Mittelwert über die Suchwörter):
//   - gleiches Wort (Umlaute egal: ä = ae, ß = ss; Groß/klein egal)                   1,0
//   - Wortanfang („Übersicht“ → „Übersichtsliste“) oder Wortteil im zusammengezogenen Namen  0,85 / 0,75
//   - Tippfehler (Levenshtein aus dublettenKern.ts, 1–3 Zeichen je nach Wortlänge)        0,7 … 0,5
//   - Teil eines zusammengesetzten Suchworts („Übersichtsliste“ findet „Liste …“)          0,5
//   - Dateiart passt zum Wort („Liste“, „Tabelle“, „Excel“ → xlsx/csv; „Foto“ → Bild …)    0,5
//     (allein nur mit Zeitraum: „das Foto von heute“)
// Felder und Gewicht: Anzeigename und Dateiname 1,0 · Art/Ordner 0,7 · Kurzinhalt 0,6 · Aktenname 0,45.
// Datumsnähe: Ein Zeitraum („gestern hochgeladen“) filtert; einen Tag daneben gilt noch als „knapp
// daneben“ (Leute irren sich beim Tag), mit deutlichem Abzug. Gleich gute Treffer: der neuere zuerst.

import { abstand, grundform } from './dublettenKern.ts'

export type DateiKandidat = {
  dokument_id: string
  name: string
  /** Letzter Teil des Speicherorts (oft der ursprüngliche Dateiname). */
  dateiname?: string
  typ?: string
  /** Ordner in der Objektakte oder Art in der Kundenakte. */
  ordner?: string
  datum?: string | null
  kurzinhalt?: string | null
  /** Wo es liegt: kunde_id oder objekt_id. */
  ort_art: 'akte' | 'objekt'
  ort_id: string
  ort_name: string
}

export type DateiTreffer = DateiKandidat & { punkte: number; knapp_daneben?: boolean; gefunden_in: string[] }

export type DateiSuchOptionen = {
  /** Zeitraum (JJJJ-MM-TT, beide einschließlich). */
  ab?: string | null
  bis?: string | null
  /** Mindestpunkte (Vorgabe 0,45). */
  mindest?: number
}

/** Füllwörter, die beim Suchen nichts sagen („die Liste von gestern“). */
const FUELLWOERTER = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einer', 'eines', 'und', 'oder', 'von', 'vom', 'mit', 'fuer', 'zu', 'zum', 'zur',
  'im', 'in', 'am', 'an', 'auf', 'aus', 'bei', 'ich', 'du', 'er', 'sie', 'wir', 'mein', 'meine', 'meinen', 'deine', 'datei', 'dateien', 'dokument',
  'dokumente', 'hochgeladen', 'hochgeladene', 'hochgeladenen', 'gestern', 'heute', 'vorgestern', 'letzte', 'letzten', 'woche', 'neue', 'neuen',
  'hab', 'habe', 'hatte', 'geschickt', 'geschickte', 'gesendet', 'gesendete', 'so', 'was', 'wie', 'ungefaehr', 'irgendwas', 'irgendwie', 'etwa',
])

/** Wörter, die eher die Dateiart als den Namen meinen. */
const ART_WOERTER: { woerter: string[]; passt: RegExp }[] = [
  { woerter: ['liste', 'tabelle', 'excel', 'uebersicht', 'aufstellung', 'auflistung', 'kalkulation', 'xlsx', 'csv'], passt: /spreadsheet|excel|csv|\.xlsx?$|\.csv$|\.ods$/i },
  { woerter: ['pdf', 'scan', 'gescannt'], passt: /pdf|\.pdf$/i },
  { woerter: ['foto', 'fotos', 'bild', 'bilder', 'aufnahme', 'screenshot', 'jpg', 'png'], passt: /^image\/|\.(jpe?g|png|heic|webp|gif)$/i },
  { woerter: ['word', 'brief', 'schreiben', 'docx'], passt: /wordprocessing|msword|\.docx?$/i },
  { woerter: ['video', 'film'], passt: /^video\/|\.(mp4|mov)$/i },
  { woerter: ['sprachnachricht', 'audio', 'tonaufnahme'], passt: /^audio\/|\.(ogg|oga|mp3|m4a|wav)$/i },
]

/** Wörter eines Textes in Grundform (ohne Dateiendung, getrennt an allem außer Buchstaben/Ziffern). */
export function woerterVon(s: unknown): string[] {
  const ohneEndung = String(s ?? '').replace(/\.[A-Za-z0-9]{2,5}$/, '')
  // „UebersichtsListe“ → „Uebersichts Liste“: Binnengroßbuchstaben trennen (vor grundform, die klein macht).
  const getrennt = ohneEndung.replace(/([a-zäöüß])([A-ZÄÖÜ])/g, '$1 $2')
  return grundform(getrennt).split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
}

/** Suchwörter: ohne Füllwörter; bleibt nichts übrig, doch alle. */
export function suchWoerter(suchbegriff: unknown): string[] {
  const alle = woerterVon(suchbegriff)
  const ohne = alle.filter((w) => !FUELLWOERTER.has(w))
  return [...new Set(ohne.length ? ohne : alle)]
}

/** Zwei benachbarte Buchstaben vertauscht („Lsite“ ↔ „Liste“) — Levenshtein zählt das als 2. */
function vertauscht(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 3) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return i < a.length - 1 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
}

function erlaubterAbstand(laenge: number): number {
  if (laenge <= 3) return 0
  if (laenge <= 5) return 1
  if (laenge <= 9) return 2
  return 3
}

/** Wie gut passt ein Suchwort zu einem Feld (0 … 1)? */
export function wortWert(wort: string, feldWoerter: string[]): number {
  if (!wort || feldWoerter.length === 0) return 0
  const kompakt = feldWoerter.join('')
  let best = 0
  for (const fw of feldWoerter) {
    if (fw === wort) return 1
    if (wort.length >= 3 && fw.startsWith(wort)) best = Math.max(best, 0.85)
    // Wortende abgeschnitten („Liste“ ↔ „Listen“, „Vertrag“ ↔ „Vertraege“): Wortanfang gleich, höchstens 2 Zeichen mehr
    if (fw.length >= 4 && wort.startsWith(fw) && wort.length - fw.length <= 2) best = Math.max(best, 0.8)
    if (vertauscht(wort, fw)) best = Math.max(best, 0.7)
    const grenze = erlaubterAbstand(wort.length)
    if (grenze > 0) {
      const d = abstand(wort, fw, grenze)
      if (d <= grenze) best = Math.max(best, 0.7 - 0.1 * (d - 1))
      // Tippfehler im Anfang eines längeren Worts („Uebersichs“ → „Uebersichtsliste“)
      if (fw.length > wort.length) {
        const dAnfang = abstand(wort, fw.slice(0, wort.length), grenze)
        if (dAnfang <= grenze) best = Math.max(best, 0.65 - 0.1 * (dAnfang - 1))
      }
    }
    // Teil eines zusammengesetzten Suchworts: „Übersichtsliste“ findet „Liste“, „Mietvertragsentwurf“ findet „Mietvertrag“
    if (fw.length >= 4 && wort.length > fw.length + 2 && wort.includes(fw)) best = Math.max(best, 0.5)
  }
  if (best < 0.75 && wort.length >= 4 && kompakt.includes(wort)) best = 0.75
  // Unscharf im zusammengezogenen Namen („Ubersichtliste“ in „uebersichtsliste“)
  if (best < 0.55 && wort.length >= 6) {
    const grenze = erlaubterAbstand(wort.length)
    for (let laenge = wort.length - 1; laenge <= wort.length + 1 && best < 0.55; laenge++) {
      for (let i = 0; i + laenge <= kompakt.length; i++) {
        if (abstand(wort, kompakt.slice(i, i + laenge), grenze) <= grenze) {
          best = 0.55
          break
        }
      }
    }
  }
  return best
}

function artWert(wort: string, k: DateiKandidat): number {
  const art = `${k.typ ?? ''} ${k.name ?? ''} ${k.dateiname ?? ''}`
  for (const g of ART_WOERTER) {
    if (g.woerter.some((w) => w === wort || (wort.length >= 5 && abstand(w, wort, 1) <= 1)) && g.passt.test(art)) return 0.5
  }
  return 0
}

/** Datum eines Eintrags als JJJJ-MM-TT (versteht auch TT.MM.JJJJ und ISO mit Uhrzeit). */
export function isoTag(datum: unknown): string | null {
  const s = String(datum ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

export function tagVerschieben(tag: string, tage: number): string {
  const d = new Date(`${tag}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return d.toISOString().slice(0, 10)
}

/** Wörter wie „heute“, „gestern“, „letzte Woche“ im Suchbegriff → Zeitraum (sonst null). */
export function zeitraumAusText(suchbegriff: unknown, heute: string): { ab: string; bis: string } | null {
  const s = grundform(suchbegriff)
  if (/\bvorgestern\b/.test(s)) return { ab: tagVerschieben(heute, -2), bis: tagVerschieben(heute, -2) }
  if (/\bgestern\b/.test(s)) return { ab: tagVerschieben(heute, -1), bis: tagVerschieben(heute, -1) }
  if (/\bheute\b/.test(s)) return { ab: heute, bis: heute }
  if (/\b(letzte|letzten|vergangene|vergangenen)\s+woche\b/.test(s)) return { ab: tagVerschieben(heute, -13), bis: heute }
  if (/\bdiese\s+woche\b/.test(s)) return { ab: tagVerschieben(heute, -6), bis: heute }
  return null
}

/** Bewertet und sortiert die Kandidaten. Ohne Suchwörter (nur Zeitraum): alle im Zeitraum, neueste zuerst. */
export function findeDateien(suchbegriff: string, kandidaten: DateiKandidat[], opt: DateiSuchOptionen = {}): DateiTreffer[] {
  const woerter = suchWoerter(suchbegriff)
  const mindest = opt.mindest ?? 0.45
  const ab = opt.ab ? isoTag(opt.ab) : null
  const bis = opt.bis ? isoTag(opt.bis) : null
  const mitZeitraum = !!(ab || bis)
  const aus: DateiTreffer[] = []
  for (const k of kandidaten) {
    let knapp = false
    if (mitZeitraum) {
      const tag = isoTag(k.datum)
      if (!tag) continue
      const drin = (!ab || tag >= ab) && (!bis || tag <= bis)
      if (!drin) {
        const daneben = (!ab || tag >= tagVerschieben(ab, -1)) && (!bis || tag <= tagVerschieben(bis, 1))
        if (!daneben) continue
        knapp = true
      }
    }
    if (woerter.length === 0) {
      if (!mitZeitraum) continue
      aus.push({ ...k, punkte: knapp ? 0.5 : 1, knapp_daneben: knapp || undefined, gefunden_in: [] })
      continue
    }
    const felder: { name: string; gewicht: number; woerter: string[] }[] = [
      { name: 'Name', gewicht: 1, woerter: [...woerterVon(k.name), ...woerterVon(k.dateiname)] },
      { name: 'Art/Ordner', gewicht: 0.7, woerter: woerterVon(k.ordner) },
      { name: 'Inhalt', gewicht: 0.6, woerter: woerterVon(k.kurzinhalt) },
      { name: 'Akte', gewicht: 0.45, woerter: woerterVon(k.ort_name) },
    ]
    let summe = 0
    let namensTreffer = false
    let nurArt = true
    const gefunden = new Set<string>()
    for (const w of woerter) {
      let best = 0
      let bestFeld = ''
      for (const f of felder) {
        const wert = wortWert(w, f.woerter) * f.gewicht
        if (wert > best) {
          best = wert
          bestFeld = f.name
        }
      }
      const art = artWert(w, k)
      if (art > best) {
        best = art
        bestFeld = 'Dateiart'
      }
      if (best > 0) gefunden.add(bestFeld)
      if (bestFeld !== 'Dateiart') nurArt = false
      if (best >= 0.5 && (bestFeld === 'Name' || bestFeld === 'Inhalt' || bestFeld === 'Art/Ordner')) namensTreffer = true
      summe += best
    }
    let punkte = summe / woerter.length
    // Nur über Aktenname oder Dateiart reicht nicht — sonst kommt jede Datei der Akte. Ausnahme: mit Zeitraum
    // darf die Dateiart allein entscheiden („das Foto von heute“).
    if (!namensTreffer && !(mitZeitraum && nurArt)) continue
    if (knapp) punkte -= 0.3
    if (punkte < mindest) continue
    aus.push({ ...k, punkte: Math.round(punkte * 100) / 100, knapp_daneben: knapp || undefined, gefunden_in: [...gefunden] })
  }
  return aus.sort((a, b) => b.punkte - a.punkte || String(isoTag(b.datum) ?? '').localeCompare(String(isoTag(a.datum) ?? '')))
}

/** Einschätzung für die Antwort. */
export function guete(punkte: number): string {
  if (punkte >= 0.9) return 'passt genau'
  if (punkte >= 0.7) return 'passt gut'
  return 'ähnlich'
}

/** Schlüssel in dokument_inhalte aus dem Speicherort (wie dokumentSchluessel in email-gateway/index.ts). */
export function inhaltSchluessel(url: unknown): string {
  const u = String(url ?? '')
  if (u.startsWith('objekt-dokumente:')) return `objekt-dokumente/${u.slice('objekt-dokumente:'.length)}`
  const marker = '/object/public/'
  if (/^https?:\/\//i.test(u)) {
    if (!u.includes(marker)) return u
    const rest = u.split(marker)[1].split('?')[0]
    try {
      return decodeURIComponent(rest)
    } catch {
      return rest
    }
  }
  return `kunden-dokumente/${u}`
}

/** Letzter Teil des Speicherorts ohne vorangestellte Kennung („dok_ab12cd_Liste_Betraege“ → „Liste_Betraege“). */
export function dateinameAusUrl(url: unknown): string {
  const letzter = String(url ?? '').split('?')[0].split('/').pop() ?? ''
  let n = letzter
  try {
    n = decodeURIComponent(letzter)
  } catch { /* so lassen */ }
  return n.replace(/^(dok|tg|datei|scan)_[0-9a-f]{6,}_/i, '').replace(/^\d{10,}[-_]/, '')
}
