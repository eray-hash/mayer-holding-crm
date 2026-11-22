// Kontaktangaben aus E-Mail-Signaturen lesen (22.11.2026) — reine Funktionen ohne Datenbank und ohne Netz,
// damit Server (email-gateway/stammdatenErgaenzen.ts), Assistent und Browser dieselben Regeln nutzen.
//
// Ablauf:
// 1. zerlegeMail: Eine Mail besteht oft aus der eigenen Nachricht plus zitierten oder weitergeleiteten
//    älteren Mails („Am … schrieb …:“, „Von: … Gesendet: …“, „> …“). Jeder Abschnitt bekommt seinen
//    Verfasser (Adresse aus der Kopfzeile), der oberste den Absender der Mail. So lässt sich die Signatur
//    eines Kunden auch aus einer zitierten Antwort in unserer eigenen gesendeten Mail lesen — und eine
//    zitierte Signatur von uns oder Dritten landet nie beim Falschen.
// 2. findeSignaturBlock: Im Abschnitt beginnt die Signatur nach der letzten Grußformel („Mit freundlichen
//    Grüßen“, „LG“ …) oder nach einem Trenner („-- “); sonst gelten nur die letzten Zeilen.
// 3. leseSignatur: Telefon/Mobil/Fax (deutsche Schreibweisen, +49/0049/(0)), Anschrift (Straße + PLZ Ort,
//    auch in einer Zeile oder umgekehrter Reihenfolge), Webseite, Position, Firma.
// Eigene Daten (Domains amayer-holding.com und fundament-it.de, Namen, Adressen, Nummern und Signaturen der
// Mitarbeiter) werden ausgeschlossen: Ein Block mit unserem Namen oder unserer Domain zählt gar nicht.

export type SignaturDaten = {
  telefon?: string
  mobil?: string
  fax?: string
  /** "Straße Hausnummer\nPLZ Ort" — dieselbe Form wie das Feld Anschrift in der Akte. */
  anschrift?: string
  webseite?: string
  position?: string
  firma?: string
}

/** Unsere eigenen Angaben, die nie als Kundendaten gelten. Alles klein geschrieben bzw. vergleichbar gemacht. */
export type EigeneDaten = {
  domains: string[]
  emails: string[]
  /** Volle Namen der Mitarbeiter, klein geschrieben (nur der volle Name — Nachnamen teilen sich auch Kunden). */
  namen: string[]
  /** Nummern in vergleichbarer Form (siehe vergleichbareNummer). */
  nummern: string[]
  /** Anschriften in vergleichbarer Form (siehe anschriftSchluessel). */
  anschriften: string[]
}

export type Abschnitt = {
  autorEmail: string | null
  autorName: string | null
  /** JJJJ-MM-TT aus der Kopfzeile des Zitats, sonst null (dann gilt das Datum der Mail). */
  datum: string | null
  text: string
}

export const EIGENE_DOMAINS: readonly string[] = ['amayer-holding.com', 'fundament-it.de']
/** Bekannte eigene Anschrift (Schwabstr. 3, 89075 Ulm), auch ohne Mitarbeiter-Signatur ausgeschlossen. */
const EIGENE_ANSCHRIFTEN_FEST = ['89075|schwabstrasse|3']

/** Leere eigene Daten mit den festen Domains — für Tests und als Grundlage. */
export function leereEigeneDaten(): EigeneDaten {
  return { domains: [...EIGENE_DOMAINS], emails: [], namen: [], nummern: [], anschriften: [...EIGENE_ANSCHRIFTEN_FEST] }
}

// ---------------------------------------------------------------------------------------------
// Text vorbereiten

/** Unsichtbare Zeichen entfernen, Zeilenenden vereinheitlichen, geschützte Leerzeichen zu normalen. */
export function bereinigeText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b\u200c\u200d\u2060\ufeff\u00ad\u001f]/g, '')
    // Word schreibt den geschützten Bindestrich als Steuerzeichen 0x1E ("D\u001e79761 Waldshut\u001eTiengen").
    .replace(/[\u001e\u2011]/g, '-')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001d]/g, ' ')
    .replace(/[\u00a0\u2007\u202f\t]/g, ' ')
    .split('\n')
    .map((z) => z.replace(/\s+$/, ''))
    .join('\n')
}

const ENTITAETEN: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  szlig: 'ß', euro: '€', ndash: '–', mdash: '—', middot: '·', bull: '•', copy: '©', reg: '®', shy: '',
}

/** HTML einer Mail in Text mit Zeilen umwandeln (Absätze, Zeilenumbrüche, Tabellenzellen). */
export function htmlZuText(html: string): string {
  return String(html ?? '')
    .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ganz, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : ganz
      }
      return ENTITAETEN[e] ?? ENTITAETEN[e.toLowerCase()] ?? ganz
    })
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}

const EMAIL_MUSTER = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i

function emailAus(text: string): string | null {
  const m = text.match(EMAIL_MUSTER)
  return m ? m[0].toLowerCase().replace(/^mailto:/, '') : null
}

const MONATE: Record<string, number> = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mär: 3, mar: 3, märz: 3, maerz: 3, march: 3, apr: 4, april: 4,
  mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dez: 12, dec: 12, dezember: 12, december: 12,
}

function zweistellig(n: number): string {
  return String(n).padStart(2, '0')
}

/** Datum aus einer Zitat-Kopfzeile: "12.10.2026", "12.10.26", "8. Oktober 2026", "Oct 12, 2026". */
export function datumAusKopf(text: string): string | null {
  let m = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/)
  if (m) {
    const jahr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const monat = Number(m[2])
    const tag = Number(m[1])
    if (monat >= 1 && monat <= 12 && tag >= 1 && tag <= 31) return `${jahr}-${zweistellig(monat)}-${zweistellig(tag)}`
  }
  m = text.match(/\b(\d{1,2})\.?\s+([A-Za-zÄäÖöÜü]{3,9})\.?\s+(\d{4})\b/)
  if (m && MONATE[m[2].toLowerCase()]) return `${m[3]}-${zweistellig(MONATE[m[2].toLowerCase()])}-${zweistellig(Number(m[1]))}`
  m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/)
  if (m && MONATE[m[1].toLowerCase()]) return `${m[3]}-${zweistellig(MONATE[m[1].toLowerCase()])}-${zweistellig(Number(m[2]))}`
  return null
}

// ---------------------------------------------------------------------------------------------
// Mail in Abschnitte je Verfasser zerlegen

const KOPF_SCHLUESSEL = /^\s*\*?(Von|From|Gesendet|Datum|Sent|Date|An|To|Cc|Kopie|Betreff|Subject|Antwort an|Reply-To|Wichtigkeit|Importance)\s*:\*?/i
const TRENNER = /^\s*-{2,}\s*(Ursprüngliche Nachricht|Original Message|Weitergeleitete Nachricht|Forwarded message|Original-Nachricht)\s*-*\s*$/i
const WEITERGELEITET = /^\s*(Anfang der weitergeleiteten Nachricht|Begin forwarded message)\s*:?\s*$/i
const GESENDET_VON = /^\s*(Von meinem \S+ gesendet|Gesendet von meinem|Gesendet mit|Sent from my|Von meinem iPhone|Get Outlook for|Outlook für)/i

/** Zerlegt eine Mail in Abschnitte je Verfasser. Der erste gehört dem Absender der Mail. Zitatzeichen (">")
 *  werden entfernt; die Kopfzeilen der Zitate legen fest, wer den folgenden Text geschrieben hat. Abschnitte
 *  hinter einem Trenner ohne erkennbaren Verfasser tragen autorEmail null. */
export function zerlegeMail(text: string, absender: { email?: string | null; name?: string | null } = {}): Abschnitt[] {
  const zeilen = bereinigeText(text).split('\n').map((z) => z.replace(/^(\s*>)+ ?/, ''))
  const abschnitte: Abschnitt[] = []
  let aktuell: Abschnitt = { autorEmail: absender.email ? absender.email.toLowerCase() : null, autorName: absender.name ?? null, datum: null, text: '' }
  const puffer: string[] = []
  const abschliessen = (neu: Abschnitt) => {
    aktuell.text = puffer.join('\n').trim()
    abschnitte.push(aktuell)
    puffer.length = 0
    aktuell = neu
  }

  for (let i = 0; i < zeilen.length; i++) {
    const zeile = zeilen[i]
    // a) "Am 10.10.2026 um 14:53 schrieb Robin Wallisch <r@x.de>:" (auch über bis zu drei Zeilen umbrochen) / "On … wrote:"
    if (/^\s*(Am|On)\s/.test(zeile)) {
      let kopf = ''
      let ende = -1
      for (let j = i; j < Math.min(zeilen.length, i + 3); j++) {
        kopf += (kopf ? ' ' : '') + zeilen[j].trim()
        if (/\b(schrieb|wrote)\b/i.test(kopf) && /:\s*$/.test(zeilen[j])) {
          ende = j
          break
        }
      }
      if (ende >= 0 && kopf.length < 400) {
        const nameTreffer = kopf.match(/schrieb\s+(?:"?)([^<":]+?)(?:"?)\s*(?:<[^>]*>)?\s*:\s*$/i) ?? kopf.match(/(?:\d{1,2}:\d{2}(?:\s*(?:Uhr|AM|PM))?,?)\s*([^<:]+?)\s*<[^>]*>\s*(?:schrieb|wrote)/i)
        abschliessen({ autorEmail: emailAus(kopf), autorName: nameTreffer ? nameTreffer[1].trim() : null, datum: datumAusKopf(kopf), text: '' })
        i = ende
        continue
      }
    }
    // b) Kopfblock "Von: Name <adresse>" + Gesendet/Datum/An/Betreff in den nächsten Zeilen
    const vonTreffer = zeile.match(/^\s*\*?(Von|From|Absender)\s*:\*?\s*(.+)$/i)
    if (vonTreffer && zeilen.slice(i + 1, i + 7).some((z) => KOPF_SCHLUESSEL.test(z))) {
      let j = i + 1
      let datum: string | null = null
      while (j < zeilen.length && (KOPF_SCHLUESSEL.test(zeilen[j]) || (zeilen[j].trim() === '' && j < i + 7 && zeilen.slice(j + 1, j + 3).some((z) => KOPF_SCHLUESSEL.test(z))))) {
        if (/^\s*\*?(Gesendet|Datum|Sent|Date)\s*:/i.test(zeilen[j])) datum = datumAusKopf(zeilen[j])
        j++
      }
      const von = vonTreffer[2]
      const name = von.replace(/<[^>]*>|\[mailto:[^\]]*\]|"/g, '').replace(EMAIL_MUSTER, '').trim()
      abschliessen({ autorEmail: emailAus(von), autorName: name || null, datum, text: '' })
      i = j - 1
      continue
    }
    // c) Trenner ohne Verfasser ("-----Ursprüngliche Nachricht-----", "Anfang der weitergeleiteten Nachricht:")
    //    Ein Strich aus Unterstrichen ist nur dann ein Trenner, wenn direkt ein Kopfblock folgt — sonst trennt
    //    er oft die Signatur vom Gruß und gehört zum Text.
    if (TRENNER.test(zeile) || WEITERGELEITET.test(zeile)) {
      abschliessen({ autorEmail: null, autorName: null, datum: null, text: '' })
      continue
    }
    if (/^\s*_{8,}\s*$/.test(zeile) && zeilen.slice(i + 1, i + 3).some((z) => /^\s*\*?(Von|From)\s*:/i.test(z))) {
      abschliessen({ autorEmail: null, autorName: null, datum: null, text: '' })
      continue
    }
    if (GESENDET_VON.test(zeile)) continue
    puffer.push(zeile)
  }
  abschliessen({ autorEmail: null, autorName: null, datum: null, text: '' })
  return abschnitte.filter((a) => a.text.length > 0)
}

// ---------------------------------------------------------------------------------------------
// Signatur-Block finden

const GRUSS = new RegExp(
  '^\\s*(' +
    [
      '(mit\\s+)?(freundlichen|freundliche|freundlicher|besten|beste|bester|herzlichen|herzliche|herzlicher|lieben|liebe|lieber|schönen|schöne|schöner|sonnigen|viele|vielen|freundlichem)\\s+(grüßen|grüssen|grüße|grüsse|gruß|gruss)',
      'mfg', 'lg', 'vg', 'bg', 'gruß', 'gruss', 'grüße', 'grüsse', 'schöne grüße', 'beste wünsche',
      'best regards', 'kind regards', 'regards', 'cheers', 'freundliche grüße', 'hochachtungsvoll', 'servus', 'ciao',
    ].join('|') +
    ')(?![A-Za-zÄÖÜäöüß])',
  'i',
)

/** Signatur-Block eines Abschnitts: Zeilen nach der letzten Grußformel bzw. nach "-- ". `sicher` = Grußformel
 *  oder Trenner gefunden; sonst sind es nur die letzten zwölf Zeilen (dann gelten nur beschriftete Nummern). */
export function findeSignaturBlock(text: string): { zeilen: string[]; sicher: boolean } {
  const zeilen = bereinigeText(text).split('\n').filter((z) => !GESENDET_VON.test(z))
  while (zeilen.length && !zeilen[zeilen.length - 1].trim()) zeilen.pop()
  let start = -1
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const z = zeilen[i].trim()
    if (z.length <= 60 && GRUSS.test(z)) {
      start = i
      break
    }
  }
  if (start < 0) {
    const trenner = zeilen.findIndex((z) => /^\s*--\s*$/.test(z))
    if (trenner >= 0) return { zeilen: zeilen.slice(trenner + 1, trenner + 30), sicher: true }
    return { zeilen: zeilen.slice(-12), sicher: false }
  }
  // Grußformel mit Namen in derselben Zeile ("Lg robin wallisch"): der Name gehört nicht zum Block.
  return { zeilen: zeilen.slice(start + 1, start + 30), sicher: true }
}

// ---------------------------------------------------------------------------------------------
// Telefonnummern

/** Vergleichbare Form einer Nummer: nur Ziffern, +49/0049/(0) → führende 0, andere Ländervorwahlen mit "+".
 *  Leer, wenn keine plausible Nummer (7 bis 15 Ziffern). */
export function vergleichbareNummer(roh: string | null | undefined): string {
  let s = String(roh ?? '').trim()
  if (!s) return ''
  s = s.replace(/\(\s*0\s*\)/g, '')
  let plus = ''
  if (/^\s*\+/.test(s)) plus = '+'
  let ziffern = s.replace(/\D/g, '')
  if (!plus && ziffern.startsWith('00')) {
    plus = '+'
    ziffern = ziffern.slice(2)
  }
  if (plus) {
    if (ziffern.startsWith('49')) ziffern = '0' + ziffern.slice(2).replace(/^0/, '')
    else ziffern = '+' + ziffern
  }
  const anzahl = ziffern.replace(/\D/g, '').length
  if (anzahl < 7 || anzahl > 15) return ''
  if (!ziffern.startsWith('0') && !ziffern.startsWith('+')) return ''
  if (ziffern.startsWith('00')) return ''
  return ziffern
}

export function gleicheNummer(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = vergleichbareNummer(a)
  const y = vergleichbareNummer(b)
  return !!x && x === y
}

/** Mobilfunk-Vorwahlen in Deutschland: 015x, 016x, 017x. */
export function istMobilnummer(nummer: string): boolean {
  return /^01[567]/.test(vergleichbareNummer(nummer))
}

/** Nummer zur Anzeige: Leerraum zusammenfassen, Satzzeichen am Rand weg; Schreibweise sonst wie im Original. */
function anzeigeNummer(roh: string): string {
  return roh.replace(/\s+/g, ' ').replace(/^[\s:.,;–-]+|[\s:.,;–-]+$/g, '').trim()
}

const NUMMER = /(?:\+|00)?\(?\d[\d\s()\/.\-–]{5,22}\d/g
const KEINE_NUMMERN_ZEILE = /\b(iban|bic|swift|ust|ust-?id|steuer|st\.?-?nr|hrb|hra|amtsgericht|registergericht|handelsregister|konto|blz|kto|bankverbindung|plz|postfach)\b/i

/** Steht die Fundstelle frei (Zeilenanfang, Leerraum, Klammer, Doppelpunkt davor) — nicht mitten in einem Wort oder einer Adresse? */
function freiStehend(zeile: string, index: number): boolean {
  return index === 0 || /[\s(:\[/|·•,;]/.test(zeile[index - 1])
}

/** Plausible Telefonnummer? Keine Datumsangaben, keine Uhrzeiten, keine Postleitzahl mit Hausnummer. */
function istPlausibleNummer(roh: string): boolean {
  if (/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/.test(roh)) return false
  if (/\b\d{1,2}:\d{2}\b/.test(roh)) return false
  if ((roh.match(/\./g) ?? []).length >= 3 && !/\s/.test(roh)) return false
  return !!vergleichbareNummer(roh)
}

type Art = 'telefon' | 'mobil' | 'fax'

const BESCHRIFTUNG = /(telefax|fax|mobilfunk|mobiltelefon|mobil|mobile|handy|cell|telefon|tel|fon|phone|festnetz|büro|zentrale|\bT|\bM|\bF|\bP)\s*\.?\s*:?\s*/gi

function artAusBeschriftung(b: string): Art {
  const x = b.toLowerCase().replace(/[^a-zäöü]/g, '')
  if (x === 'fax' || x === 'telefax' || x === 'f') return 'fax'
  if (['mobil', 'mobile', 'mobilfunk', 'mobiltelefon', 'handy', 'cell', 'm'].includes(x)) return 'mobil'
  return 'telefon'
}

/** Beschriftete Nummern einer Zeile ("Tel. 0731 123 | Fax 0731 124 | Mobil 0172 …"). */
function beschrifteteNummern(zeile: string): { art: Art; nummer: string }[] {
  if (KEINE_NUMMERN_ZEILE.test(zeile)) return []
  const funde: { art: Art; nummer: string }[] = []
  const muster = new RegExp(BESCHRIFTUNG.source + '((?:\\+|00)?\\(?\\d[\\d\\s()\\/.\\-–]{5,22}\\d)', 'gi')
  for (const m of zeile.matchAll(muster)) {
    // Einzelbuchstaben (T, M, F, P) nur als echte Beschriftung: am Zeilenanfang oder nach Trennzeichen.
    const vorher = zeile.slice(0, m.index ?? 0)
    if (m[1].length === 1 && vorher.trim() && !/[|·•,;\/]\s*$/.test(vorher)) continue
    const nummer = anzeigeNummer(m[2])
    if (istPlausibleNummer(nummer)) funde.push({ art: artAusBeschriftung(m[1]), nummer })
  }
  return funde
}

/** Eine Zeile, die nur aus einer Nummer besteht ("+49 172 9019790"). */
function reineNummernZeile(zeile: string): string | null {
  const t = zeile.trim()
  if (!/^(?:\+|00)?\(?\d[\d\s()\/.\-–]{5,22}\d$/.test(t)) return null
  return istPlausibleNummer(t) ? anzeigeNummer(t) : null
}

/** Nummern im eigenen Text, wenn der Absender sie ausdrücklich nennt ("Gerne Rückruf unter 0152 …").
 *  Nicht, wenn die Zeile erkennbar von jemand anderem spricht. */
function genannteNummern(zeilen: string[]): { art: Art; nummer: string }[] {
  const funde: { art: Art; nummer: string }[] = []
  for (const zeile of zeilen) {
    if (!/(^|[\s(,;:])(rückruf|rueckruf|erreichen|erreichbar|anrufen|ruf(en)?\s+sie|telefonisch|telefonnummer|handynummer|mobilnummer|meine nummer|unter der nummer|tel\.?|telefon|handy|mobil)(?![a-zäöüß])/i.test(zeile)) continue
    if (KEINE_NUMMERN_ZEILE.test(zeile)) continue
    if (/\b(herrn?|frau|kollegin|kollege|steuerberater|notar|anwalt|büro von|sekretariat von)\b/i.test(zeile)) continue
    for (const m of zeile.matchAll(NUMMER)) {
      if (!freiStehend(zeile, m.index ?? 0)) continue
      const nummer = anzeigeNummer(m[0])
      if (istPlausibleNummer(nummer)) funde.push({ art: istMobilnummer(nummer) ? 'mobil' : 'telefon', nummer })
    }
  }
  return funde
}

// ---------------------------------------------------------------------------------------------
// Anschrift

const STRASSEN_WORT = /(stra(ß|ss)e|str\.|str\b|weg|platz|allee|gasse|ring|damm|ufer|steig|steige|pfad|hof|berg|markt|chaussee|promenade|zeile|graben|garten|winkel|anger|kamp|stieg|wall|höhe|halde|feld|park|siedlung|brücke|tor|au)\b/i
const STRASSEN_ANFANG = /^(am|an der|an den|im|in der|in den|auf der|auf dem|zum|zur|unter den|hinter der|vor dem|alte|neue)\s/i
const HAUSNUMMER = /\d{1,4}\s?[a-zA-Z]?(?:\s?[-–\/]\s?\d{1,4}\s?[a-zA-Z]?)?/
const STRASSE = new RegExp(`^([A-ZÄÖÜa-zäöüß][A-Za-zÄÖÜäöüß.'\\-\\s]{1,48}?)\\s*(${HAUSNUMMER.source})$`)
const PLZ_ORT = /^(?:D\s*[-–]?\s*)?(\d{5})\s*([A-ZÄÖÜa-zäöüß][A-Za-zÄÖÜäöüß.\-\s\/()]{1,40}?)(?:\s*,?\s*(?:Deutschland|Germany|DE))?$/

function bereinigeStrasse(s: string): string {
  return s
    .replace(/\s+\.\s*(?=\d)/g, '. ') // "Echterdingerstr .57" → "Echterdingerstr. 57"
    .replace(/\.(?=\d)/g, '. ')
    .replace(/\s+/g, ' ')
    .trim()
}

function alsStrasse(teil: string): string | null {
  const t = bereinigeStrasse(teil)
  if (/postfach|\bpf\b/i.test(t)) return null
  const m = t.match(STRASSE)
  if (!m) return null
  const name = m[1].trim()
  if (!STRASSEN_WORT.test(name) && !STRASSEN_ANFANG.test(name)) return null
  if (/^(tel|fax|mobil|handy|fon|ust|hrb|iban)\b/i.test(name)) return null
  return `${name} ${m[2].replace(/\s+/g, '')}`
}

function alsPlzOrt(teil: string): { plz: string; ort: string } | null {
  const m = teil.trim().match(PLZ_ORT)
  if (!m) return null
  const plz = m[1]
  if (Number(plz) < 1000) return null
  const ort = m[2].replace(/\s+/g, ' ').trim()
  if (ort.length < 2 || /^(tel|fax|mobil|uhr)\b/i.test(ort)) return null
  return { plz, ort }
}

/** Teile einer Zeile: getrennt an | · • , ; und an drei oder mehr Leerzeichen. */
function teileDerZeile(zeile: string): string[] {
  return zeile.split(/\s*[|·•;]\s*|\s*,\s*|\s{3,}/).map((t) => t.trim()).filter(Boolean)
}

/** Anschrift im Block: Straße und PLZ Ort in derselben Zeile oder in benachbarten Zeilen (auch PLZ Ort zuerst). */
function findeAnschrift(zeilen: string[]): string | null {
  const teile = zeilen.map(teileDerZeile)
  for (let i = 0; i < teile.length; i++) {
    for (let k = 0; k < teile[i].length; k++) {
      const strasse = alsStrasse(teile[i][k])
      if (!strasse) continue
      // dieselbe Zeile, direkt dahinter
      const gleich = teile[i][k + 1] ? alsPlzOrt(teile[i][k + 1]) : null
      if (gleich) return `${strasse}\n${gleich.plz} ${gleich.ort}`
      // nächste nichtleere Zeile(n)
      for (let j = i + 1; j < Math.min(teile.length, i + 3); j++) {
        if (!teile[j].length) continue
        const pl = alsPlzOrt(teile[j][0])
        if (pl) return `${strasse}\n${pl.plz} ${pl.ort}`
        break
      }
      // vorige Zeile (PLZ Ort vor der Straße)
      for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
        if (!teile[j].length) continue
        const letzter = teile[j][teile[j].length - 1]
        const pl = alsPlzOrt(letzter)
        if (pl) return `${strasse}\n${pl.plz} ${pl.ort}`
        break
      }
    }
  }
  return null
}

function umlautFrei(s: string): string {
  return s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

/** Vergleichbare Form einer Anschrift: "PLZ|strassenname|hausnummer". Ohne erkennbare PLZ: nur Buchstaben und Ziffern. */
export function anschriftSchluessel(roh: string | null | undefined): string {
  const text = bereinigeText(String(roh ?? '')).trim()
  if (!text) return ''
  const plz = text.match(/\b(\d{5})\b/)?.[1] ?? ''
  const zeilen = text.split(/\n|,|\|/).map((z) => z.trim()).filter(Boolean)
  for (const z of zeilen) {
    const s = alsStrasse(z)
    if (!s) continue
    const m = s.match(new RegExp(`^(.*?)\\s*(${HAUSNUMMER.source})$`))
    if (!m) continue
    const name = umlautFrei(m[1]).replace(/str\.?$|strasse$/, 'strasse').replace(/str\.?\s/, 'strasse ').replace(/[^a-z0-9]/g, '')
    return `${plz}|${name}|${m[2].replace(/\s+/g, '').toLowerCase()}`
  }
  return umlautFrei(text).replace(/[^a-z0-9]/g, '')
}

export function gleicheAnschrift(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = anschriftSchluessel(a)
  const y = anschriftSchluessel(b)
  return !!x && x === y
}

/** Anschrift in eine Zeile für Texte: "Musterstr. 1, 89073 Ulm". */
export function anschriftEinzeilig(anschrift: string): string {
  return anschrift.split('\n').map((z) => z.trim()).filter(Boolean).join(', ')
}

// ---------------------------------------------------------------------------------------------
// Webseite, Position, Firma

const FREMDE_SEITEN = /(linkedin|xing|facebook|instagram|twitter|x\.com|youtube|tiktok|gmail|gmx|web\.de|t-online|hotmail|outlook|icloud|yahoo|google|apple\.com|microsoft)/i

function findeWebseite(zeilen: string[], eigene: EigeneDaten): string | null {
  for (const z of zeilen) {
    for (const m of z.matchAll(/\b(?:https?:\/\/)?((?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:de|com|eu|net|org|info|biz|at|ch|io|immo|online|shop|gmbh|bayern|berlin))(?:\/[^\s>)]*)?/gi)) {
      const vorher = z[(m.index ?? 0) - 1]
      if (vorher === '@' || vorher === '.') continue
      const host = m[1].toLowerCase()
      if (FREMDE_SEITEN.test(host)) continue
      if (eigene.domains.some((d) => host === d || host.endsWith(`.${d}`))) continue
      // Nur mit www. oder http(s) — sonst sind es oft Teile von Mail-Adressen oder Dateinamen.
      if (!/^www\./.test(host) && !/^https?:\/\//i.test(m[0])) continue
      return host.startsWith('www.') ? host : `www.${host}`
    }
  }
  return null
}

const POSITION = /(geschäftsführ|geschaeftsfuehr|inhaber|vorstand|vorsitz|leiter|leitung|manager|berater|beraterin|assistenz|assistent|sachbearbeit|prokurist|gesellschafter|direktor|referent|ceo|cfo|coo|cto|founder|gründer|partner|head of|vertrieb|steuerberater|rechtsanwalt|rechtsanwältin|architekt|makler|immobilienkauf|bankkauf|kundenbetreuer|filialleiter|disponent|buchhaltung|personal)/i
const RECHTSFORM = /\b(GmbH|gGmbH|UG|AG|KG|OHG|GbR|e\.\s?K\.|e\.\s?Kfr\.|e\.\s?V\.|mbH|Ltd\.?|Inc\.?|SE|PartG|PartGmbB|KGaA|eG|Stiftung)\b|(GmbH|mbH)\s*&\s*Co/

function findePosition(zeilen: string[]): string | null {
  for (const z of zeilen.slice(0, 6)) {
    const t = z.trim()
    if (!t || t.length > 70 || /\d{3}/.test(t) || EMAIL_MUSTER.test(t)) continue
    if (POSITION.test(t) && !RECHTSFORM.test(t)) return t.replace(/^[\s|·•-]+|[\s|·•-]+$/g, '')
  }
  return null
}

function findeFirma(zeilen: string[], eigene: EigeneDaten): string | null {
  for (const z of zeilen.slice(0, 12)) {
    const t = z.trim()
    if (!t || t.length > 80 || EMAIL_MUSTER.test(t) || /\b(amtsgericht|registergericht|hrb|hra|sitz der gesellschaft|ust)/i.test(t)) continue
    if (!RECHTSFORM.test(t)) continue
    if (eigene.domains.some((d) => t.toLowerCase().includes(d.split('.')[0]))) continue
    return t.replace(/^[\s|·•-]+|[\s|·•-]+$/g, '')
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Zusammensetzen

/** HTML-Reste und Links (in Adressen von QR-Codes stehen sonst Ziffernfolgen wie "TEL%3A04102+66…") entfernen.
 *  Ein bloßes "www.firma.de" bleibt stehen (Webseite). */
function ohneLinks(text: string): string {
  return String(text ?? '')
    .replace(/<[^>]{0,2000}>/g, ' ')
    .replace(/\b(?:https?|mailto|tel|data):\/{0,2}[^\s<>"']+/gi, ' ')
    .replace(/\[\d{1,3}\]/g, '')
}

/** Enthält der Block unsere eigenen Angaben (Domain, Mitarbeitername)? Dann ist es unsere Signatur. */
export function istEigenerBlock(zeilen: string[], eigene: EigeneDaten): boolean {
  const text = zeilen.join('\n').toLowerCase()
  if (eigene.domains.some((d) => text.includes(d))) return true
  if (eigene.emails.some((e) => e && text.includes(e))) return true
  return eigene.namen.some((n) => n && n.includes(' ') && text.includes(n))
}

/** Liest die Kontaktangaben aus dem Text EINES Verfassers (Abschnitt aus zerlegeMail, ohne Zitate). */
export function leseSignatur(text: string, eigene: EigeneDaten = leereEigeneDaten()): SignaturDaten {
  text = ohneLinks(text)
  const { zeilen, sicher } = findeSignaturBlock(text)
  if (istEigenerBlock(zeilen, eigene)) return {}
  const eigeneNummer = (n: string) => eigene.nummern.includes(vergleichbareNummer(n))
  const daten: SignaturDaten = {}
  const setze = (art: Art, nummer: string) => {
    if (eigeneNummer(nummer)) return
    if (!daten[art]) daten[art] = nummer
  }

  for (const z of zeilen) for (const f of beschrifteteNummern(z)) setze(f.art, f.nummer)
  if (sicher) {
    for (const z of zeilen) {
      const n = reineNummernZeile(z)
      if (n) setze(istMobilnummer(n) ? 'mobil' : 'telefon', n)
    }
  }
  // Ausdrücklich genannte Nummern im eigenen Text, nur wenn die Signatur keine liefert.
  if (!daten.telefon && !daten.mobil) {
    const alle = bereinigeText(text).split('\n')
    if (!istEigenerBlock(alle, eigene)) for (const f of genannteNummern(alle)) setze(f.art, f.nummer)
  }
  // Eine als Telefon beschriftete Handynummer bleibt Telefon; doppelte Angaben weglassen.
  if (daten.mobil && daten.telefon && gleicheNummer(daten.mobil, daten.telefon)) delete daten.mobil
  if (daten.fax && (gleicheNummer(daten.fax, daten.telefon) || gleicheNummer(daten.fax, daten.mobil))) delete daten.fax

  const anschrift = findeAnschrift(zeilen)
  if (anschrift && !eigene.anschriften.includes(anschriftSchluessel(anschrift))) daten.anschrift = anschrift
  if (sicher) {
    const webseite = findeWebseite(zeilen, eigene)
    if (webseite) daten.webseite = webseite
    const position = findePosition(zeilen)
    if (position) daten.position = position
    const firma = findeFirma(zeilen, eigene)
    if (firma) daten.firma = firma
  }
  return daten
}

/** Hat das Ergebnis etwas, das in die Akte passt (Telefon, Mobil, Anschrift)? */
export function hatStammdaten(d: SignaturDaten): boolean {
  return !!(d.telefon || d.mobil || d.anschrift)
}

/** Alle Abschnitte einer Mail, die `zielEmail` geschrieben hat, mit ihren Kontaktangaben. Abschnitte von
 *  Mitarbeitern oder eigenen Domains zählen nie, auch wenn die Adresse passt. */
export function signaturenVon(
  text: string,
  mail: { absenderEmail?: string | null; absenderName?: string | null },
  zielEmail: string,
  eigene: EigeneDaten = leereEigeneDaten(),
): { datum: string | null; daten: SignaturDaten }[] {
  const ziel = zielEmail.trim().toLowerCase()
  if (!ziel || istEigeneAdresse(ziel, eigene)) return []
  return zerlegeMail(text, { email: mail.absenderEmail, name: mail.absenderName })
    .filter((a) => a.autorEmail === ziel)
    .map((a) => ({ datum: a.datum, daten: leseSignatur(a.text, eigene) }))
    .filter((x) => hatStammdaten(x.daten))
}

/** Gehört die Adresse uns (Mitarbeiter oder eigene Domain)? */
export function istEigeneAdresse(email: string | null | undefined, eigene: EigeneDaten): boolean {
  const e = String(email ?? '').trim().toLowerCase()
  if (!e) return false
  const domain = e.split('@')[1] ?? ''
  return eigene.emails.includes(e) || eigene.domains.some((d) => domain === d || domain.endsWith(`.${d}`))
}

/** Eigene Daten aus der Mitarbeiter-Tabelle: Adressen, volle Namen, Telefonnummern und was in den
 *  hinterlegten Signaturen steht (Nummern und Anschriften). */
export function eigeneDatenAus(mitarbeiter: { name?: string | null; email?: string | null; telefon?: string | null; signatur_html?: string | null }[]): EigeneDaten {
  const eigene = leereEigeneDaten()
  for (const m of mitarbeiter) {
    const email = String(m.email ?? '').trim().toLowerCase()
    if (email) eigene.emails.push(email)
    const name = String(m.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
    if (name.includes(' ')) eigene.namen.push(name)
    const tel = vergleichbareNummer(m.telefon)
    if (tel) eigene.nummern.push(tel)
    if (m.signatur_html) {
      const zeilen = bereinigeText(htmlZuText(m.signatur_html)).split('\n')
      for (const z of zeilen) {
        for (const f of beschrifteteNummern(z)) eigene.nummern.push(vergleichbareNummer(f.nummer))
        const n = reineNummernZeile(z)
        if (n) eigene.nummern.push(vergleichbareNummer(n))
      }
      const a = findeAnschrift(zeilen)
      if (a) eigene.anschriften.push(anschriftSchluessel(a))
    }
  }
  eigene.nummern = [...new Set(eigene.nummern.filter(Boolean))]
  eigene.anschriften = [...new Set(eigene.anschriften.filter(Boolean))]
  return eigene
}

/** Passt ein Absendername zur Akte (Ansprechpartner oder Firma)? Mindestens zwei gleiche Wörter, oder ein
 *  Wort, wenn der Absendername nur aus einem besteht. Rechtsformen und kurze Wörter zählen nicht. */
export function namePasstZurAkte(vonName: string | null | undefined, akte: { ansprechpartner?: string | null; firma?: string | null }): boolean {
  const woerter = (s: string | null | undefined) =>
    umlautFrei(String(s ?? ''))
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/[\s-]+/)
      .filter((w) => w.length >= 3 && !['gmbh', 'mbh', 'herr', 'frau', 'und', 'die', 'der', 'das', 'familie', 'info', 'kontakt', 'office', 'team'].includes(w))
  const von = new Set(woerter(vonName))
  if (!von.size) return false
  const akteWoerter = new Set([...woerter(akte.ansprechpartner), ...woerter(akte.firma)])
  let gleich = 0
  for (const w of von) if (akteWoerter.has(w)) gleich++
  return gleich >= 2 || (von.size === 1 && gleich === 1)
}
