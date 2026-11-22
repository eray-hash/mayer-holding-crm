// Export für den Steuerberater (22.11.2026) — reiner Rechenkern ohne Datenbank, genutzt vom CRM
// (src/components/rechnungen/SteuerberaterExport.tsx, baut daraus die ZIP-Datei) und vom Assistenten
// (telegram-gateway/datevWerkzeug.ts, Werkzeug export_steuerberater_status).
//
// Hintergrund: Entscheidungsvorlage Buchhaltungsprogramm vom 20.11.2026 — „Wenn der Steuerberater alles
// bucht: kein Programm, ich baue die Übergabe-Datei im CRM“. Die meisten Steuerberater arbeiten mit DATEV.
//
// ─── Inhalt der Übergabe ─────────────────────────────────────────────────────────────────────────
// 1) DATEV-Buchungsstapel „EXTF_Buchungsstapel_<Zeitraum>.csv“ (DATEV-Format, Kopfversion 700,
//    Formatkategorie 21, Formatversion 13). Eigenschaften, bewusst gewählt:
//    - Kopfzeile mit Berater- und Mandantennummer aus den Einstellungen; fehlen sie, stehen Platzhalter
//      (1001 / 1) drin und es gibt einen Hinweis — der Steuerberater kann die Datei trotzdem einlesen,
//      wenn er beim Einlesen seinen Mandanten wählt.
//    - Sachkontenlänge 4, Personenkonten 5-stellig: Debitoren 10000–69999, Kreditoren 70000–99999.
//      Die Nummern sind fest je Kunde bzw. Lieferant (Tabelle steuerberater_personenkonten), damit die
//      Konten von Monat zu Monat zusammenpassen.
//    - Kontenrahmen SKR03 (Vorgabe) oder SKR04, Zuordnung siehe STANDARD_KONTEN, in den Einstellungen
//      änderbar. Erlöskonten sind Automatikkonten (Umsatzsteuer rechnet DATEV selbst), deshalb ohne
//      Steuerschlüssel. Aufwandskonten sind keine Automatikkonten, deshalb Steuerschlüssel 9 (19 %
//      Vorsteuer) bzw. 8 (7 % Vorsteuer), wenn sich der Satz aus netto/brutto eindeutig ergibt.
//    - Ausgangsrechnung: Umsatz = brutto, „S“, Konto = Debitor, Gegenkonto = Erlöskonto.
//      Eingangsrechnung: Umsatz = brutto, „H“, Konto = Kreditor, Gegenkonto = Aufwandskonto (+ Steuerschlüssel).
//      Negative Beträge (Gutschriften) drehen Soll/Haben.
//    - Belegfeld 1 = Rechnungsnummer (DATEV erlaubt höchstens 36 Zeichen aus A–Z, 0–9 und $ & % * + - /;
//      andere Zeichen werden ersetzt). Belegdatum TTMM (das Jahr steht im Kopf, deshalb darf ein Stapel
//      nicht über ein Wirtschaftsjahr hinausgehen). Buchungstext höchstens 60 Zeichen.
//    - Belegverknüpfung: Ein echter DATEV-Beleglink („BEDI …“) setzt voraus, dass die Belege in DATEV
//      Unternehmen online liegen — das kann das CRM nicht. Stattdessen steht (abschaltbar) der Dateiname
//      des Belegs in der ZIP-Datei als Beleginfo („Beleginfo - Art 1“ = „Dateiname“).
//    - Festschreibung 0: Der Steuerberater kann alles noch ändern.
//    - Zahlungen werden NICHT gebucht: Bankbewegungen bucht der Steuerberater aus den Kontoauszügen,
//      sonst stünden sie doppelt drin. Der Zahlungsstand steht nur in den lesbaren Listen.
//    - Zeichensatz Windows-1252 (ANSI, wie DATEV es erwartet), Trennzeichen Semikolon, Zeilenende CR LF.
// 2) Lesbare Listen für Steuerberater ohne DATEV: Rechnungsausgangsbuch und Rechnungseingangsbuch
//    (Semikolon, UTF-8 mit Kennung, deutsche Zahlen — öffnet sich direkt in Excel), dazu eine Liste der
//    Personenkonten und „Hinweise.txt“ mit Summen, offenen Punkten und der Kontenzuordnung.
//
// WICHTIG: Die Kontenzuordnung ist ein Vorschlag. Der Steuerberater muss die Konten bestätigen (oder
// eigene nennen) — besonders 0 %-Rechnungen (je nach Grund 8100/8120/8125/8336 …), gemischte Steuersätze
// und ausländische Lieferanten (Steuerschuldnerschaft des Leistungsempfängers) kann das CRM nicht
// erkennen. Keine Steuerberatung.

// ─── Grunddaten ──────────────────────────────────────────────────────────────────────────────────

export type Kontenrahmen = 'SKR03' | 'SKR04'

export const DEBITOR_START = 10000
export const DEBITOR_ENDE = 69999
export const KREDITOR_START = 70000
export const KREDITOR_ENDE = 99999

/** Schlüssel „sonst“: Konto für alles, was nicht zugeordnet ist. */
export const SONST = 'sonst'

/** Kategorien der Verbindlichkeiten-Seite (src/pages/beratung/Verbindlichkeiten.tsx, KATEGORIEN). */
export const VERBINDLICHKEIT_KATEGORIEN = [
  'Miete',
  'Software & Hosting',
  'Telefon & Internet',
  'Bürobedarf',
  'Fahrzeug & Reise',
  'Beratung & Dienstleister',
  'Versicherung',
  'Werbung',
  'Sonstiges',
] as const

/** Vorschlag der Kontenzuordnung — muss der Steuerberater bestätigen. */
export const STANDARD_KONTEN: Record<Kontenrahmen, { erloese: Record<string, string>; aufwand: Record<string, string> }> = {
  SKR03: {
    // 8400 Erlöse 19 % USt, 8300 Erlöse 7 % USt, 8100 steuerfreie Umsätze § 4 Nr. 8 ff. UStG, 8200 Erlöse (ohne Zuordnung)
    erloese: { '19': '8400', '7': '8300', '0': '8100', [SONST]: '8200' },
    aufwand: {
      Miete: '4210', // Miete (unbewegliche Wirtschaftsgüter)
      'Software & Hosting': '4806', // Wartungskosten für Hard- und Software
      'Telefon & Internet': '4920', // Telefon
      Bürobedarf: '4930', // Bürobedarf
      'Fahrzeug & Reise': '4530', // Laufende Kfz-Betriebskosten (Reisekosten wären 4670)
      'Beratung & Dienstleister': '4950', // Rechts- und Beratungskosten
      Versicherung: '4360', // Versicherungen
      Werbung: '4600', // Werbekosten
      Sonstiges: '4900', // Sonstige betriebliche Aufwendungen
      [SONST]: '4900',
    },
  },
  SKR04: {
    erloese: { '19': '4400', '7': '4300', '0': '4100', [SONST]: '4200' },
    aufwand: {
      Miete: '6310',
      'Software & Hosting': '6495',
      'Telefon & Internet': '6805',
      Bürobedarf: '6815',
      'Fahrzeug & Reise': '6530',
      'Beratung & Dienstleister': '6825',
      Versicherung: '6400',
      Werbung: '6600',
      Sonstiges: '6300',
      [SONST]: '6300',
    },
  },
}

/** DATEV-Steuerschlüssel für Vorsteuer auf Nicht-Automatikkonten (SKR03 und SKR04 gleich). */
export const VORSTEUER_SCHLUESSEL: Record<string, string> = { '19': '9', '7': '8' }

export type SteuerberaterEinstellung = {
  beraterNr?: string
  mandantenNr?: string
  kontenrahmen: Kontenrahmen
  /** Erster Monat des Wirtschaftsjahres (1 = Januar). */
  wjBeginnMonat: number
  /** Eigene Erlöskonten je Steuersatz ("19", "7", "0", "sonst") — ergänzt die Vorgabe. */
  erloeskonten: Record<string, string>
  /** Eigene Aufwandskonten je Kategorie (+ "sonst") — ergänzt die Vorgabe. */
  aufwandskonten: Record<string, string>
  /** Dateiname des Belegs als Beleginfo in den Buchungsstapel schreiben. */
  belegInfo: boolean
  kontenBestaetigt?: boolean
}

export const STANDARD_EINSTELLUNG: SteuerberaterEinstellung = {
  kontenrahmen: 'SKR03',
  wjBeginnMonat: 1,
  erloeskonten: {},
  aufwandskonten: {},
  belegInfo: true,
  kontenBestaetigt: false,
}

function textOderLeer(x: unknown): string | undefined {
  const s = String(x ?? '').trim()
  return s ? s : undefined
}

function kontoListe(x: unknown): Record<string, string> {
  const aus: Record<string, string> = {}
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      const konto = String(v ?? '').trim()
      if (k.trim() && konto) aus[k.trim()] = konto
    }
  }
  return aus
}

/** Zeile aus steuerberater_einstellung (Spalten wie in der Datenbank) → Einstellung. */
export function einstellungAusZeile(z: Record<string, unknown> | null | undefined): SteuerberaterEinstellung {
  if (!z) return { ...STANDARD_EINSTELLUNG }
  const monat = Number(z.wj_beginn_monat)
  return {
    beraterNr: textOderLeer(z.berater_nr),
    mandantenNr: textOderLeer(z.mandanten_nr),
    kontenrahmen: z.kontenrahmen === 'SKR04' ? 'SKR04' : 'SKR03',
    wjBeginnMonat: Number.isInteger(monat) && monat >= 1 && monat <= 12 ? monat : 1,
    erloeskonten: kontoListe(z.erloeskonten),
    aufwandskonten: kontoListe(z.aufwandskonten),
    belegInfo: z.beleg_info !== false,
    kontenBestaetigt: z.konten_bestaetigt === true,
  }
}

/** Einstellung → zu schreibende Spalten (nur die änderbaren). */
export function einstellungAlsZeile(e: SteuerberaterEinstellung): Record<string, unknown> {
  return {
    berater_nr: e.beraterNr?.trim() || null,
    mandanten_nr: e.mandantenNr?.trim() || null,
    kontenrahmen: e.kontenrahmen,
    wj_beginn_monat: e.wjBeginnMonat,
    erloeskonten: kontoListe(e.erloeskonten),
    aufwandskonten: kontoListe(e.aufwandskonten),
    beleg_info: e.belegInfo,
    konten_bestaetigt: !!e.kontenBestaetigt,
  }
}

/** Vorgabe des Kontenrahmens, überschrieben durch die eigene Zuordnung. */
export function kontenFuer(e: SteuerberaterEinstellung): { erloese: Record<string, string>; aufwand: Record<string, string> } {
  const std = STANDARD_KONTEN[e.kontenrahmen] ?? STANDARD_KONTEN.SKR03
  return { erloese: { ...std.erloese, ...e.erloeskonten }, aufwand: { ...std.aufwand, ...e.aufwandskonten } }
}

/** Prüft Berater-/Mandantennummer und die Konten; Ergebnis: Liste von Fehlern (leer = gut). */
export function pruefeEinstellung(e: SteuerberaterEinstellung): string[] {
  const f: string[] = []
  if (e.beraterNr && !/^\d{4,7}$/.test(e.beraterNr)) f.push('Die Beraternummer muss 4 bis 7 Ziffern haben (1001 bis 9999999).')
  else if (e.beraterNr && Number(e.beraterNr) < 1001) f.push('Die Beraternummer muss mindestens 1001 sein.')
  if (e.mandantenNr && !/^\d{1,5}$/.test(e.mandantenNr)) f.push('Die Mandantennummer muss 1 bis 5 Ziffern haben (1 bis 99999).')
  else if (e.mandantenNr && Number(e.mandantenNr) < 1) f.push('Die Mandantennummer muss mindestens 1 sein.')
  const k = kontenFuer(e)
  for (const [art, liste] of [['Erlöskonto', k.erloese], ['Aufwandskonto', k.aufwand]] as const) {
    for (const [schl, konto] of Object.entries(liste)) {
      if (!/^\d{4}$/.test(konto)) f.push(`${art} für „${schl === SONST ? 'alles andere' : schl}“ muss vierstellig sein (ist „${konto}“).`)
    }
  }
  return f
}

// ─── Zeitraum ────────────────────────────────────────────────────────────────────────────────────

export type Zeitraum = {
  von: string
  bis: string
  /** z. B. "November 2026" oder "4. Quartal 2026" */
  bezeichnung: string
  /** für Dateinamen: "2026-11" oder "2026-Q4" */
  kurz: string
}

export const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function zwei(n: number): string {
  return String(n).padStart(2, '0')
}

function letzterTag(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate()
}

export function monatsZeitraum(jahr: number, monat: number): Zeitraum {
  return {
    von: `${jahr}-${zwei(monat)}-01`,
    bis: `${jahr}-${zwei(monat)}-${zwei(letzterTag(jahr, monat))}`,
    bezeichnung: `${MONATSNAMEN[monat - 1]} ${jahr}`,
    kurz: `${jahr}-${zwei(monat)}`,
  }
}

export function quartalsZeitraum(jahr: number, quartal: number): Zeitraum {
  const erster = (quartal - 1) * 3 + 1
  return {
    von: `${jahr}-${zwei(erster)}-01`,
    bis: `${jahr}-${zwei(erster + 2)}-${zwei(letzterTag(jahr, erster + 2))}`,
    bezeichnung: `${quartal}. Quartal ${jahr}`,
    kurz: `${jahr}-Q${quartal}`,
  }
}

/** Der Monat vor dem Monat von `heute` (JJJJ-MM-TT) — der übliche Monat für die Übergabe. */
export function vormonat(heute: string): Zeitraum {
  const j = Number(heute.slice(0, 4))
  const m = Number(heute.slice(5, 7))
  return m === 1 ? monatsZeitraum(j - 1, 12) : monatsZeitraum(j, m - 1)
}

const MONATS_MUSTER: [RegExp, number][] = [
  [/^jan/, 1], [/^feb/, 2], [/^(mär|maer|mar)/, 3], [/^apr/, 4], [/^mai/, 5], [/^jun/, 6],
  [/^jul/, 7], [/^aug/, 8], [/^sep/, 9], [/^okt/, 10], [/^nov/, 11], [/^dez/, 12],
]

/**
 * Liest einen Zeitraum aus freiem Text: "2026-11", "11/2026", "11.2026", "November 2026", "November",
 * "Q4 2026", "2026-Q4", "4. Quartal 2026", "Vormonat", "letztes Quartal", "dieser Monat"; leer = Vormonat.
 * Ohne Jahr: das laufende Jahr, liegt der Zeitraum dann noch in der Zukunft, das Vorjahr.
 */
export function leseZeitraum(text: string | null | undefined, heute: string): Zeitraum | null {
  const t = String(text ?? '').trim().toLowerCase()
  const hj = Number(heute.slice(0, 4))
  const hm = Number(heute.slice(5, 7))
  const hq = Math.ceil(hm / 3)
  if (!t || /^(vormonat|letzte[rn]? monat|voriger monat|vorheriger monat)$/.test(t)) return vormonat(heute)
  if (/^(dieser|aktueller|laufender) monat$/.test(t)) return monatsZeitraum(hj, hm)
  if (/^(letztes|voriges|vorheriges) quartal$|^vorquartal$/.test(t)) return hq === 1 ? quartalsZeitraum(hj - 1, 4) : quartalsZeitraum(hj, hq - 1)
  if (/^(dieses|aktuelles|laufendes) quartal$/.test(t)) return quartalsZeitraum(hj, hq)

  const jahrAus = (s: string | undefined): number | null => {
    if (!s) return null
    const n = Number(s)
    if (s.length === 2) return 2000 + n
    return n >= 2000 && n <= 2100 ? n : null
  }
  let m = t.match(/^(\d{4})\s*-\s*q\s*([1-4])$/) ?? null
  if (m) return quartalsZeitraum(Number(m[1]), Number(m[2]))
  m = t.match(/^q\s*([1-4])\s*[/-]?\s*(\d{4}|\d{2})?$/)
  if (m) {
    const q = Number(m[1])
    const j = jahrAus(m[2]) ?? (q > hq ? hj - 1 : hj)
    return quartalsZeitraum(j, q)
  }
  m = t.match(/^([1-4])\s*\.?\s*quartal\s*(\d{4}|\d{2})?$/)
  if (m) {
    const q = Number(m[1])
    const j = jahrAus(m[2]) ?? (q > hq ? hj - 1 : hj)
    return quartalsZeitraum(j, q)
  }
  m = t.match(/^(\d{4})\s*[-/.]\s*(\d{1,2})$/)
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return monatsZeitraum(Number(m[1]), Number(m[2]))
  m = t.match(/^(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})$/)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
    const j = jahrAus(m[2])
    if (j) return monatsZeitraum(j, Number(m[1]))
  }
  m = t.match(/^([a-zäöü]+)\.?\s*(\d{4}|\d{2})?$/)
  if (m) {
    const treffer = MONATS_MUSTER.find(([re]) => re.test(m![1]))
    if (treffer) {
      const monat = treffer[1]
      const j = jahrAus(m[2]) ?? (monat > hm ? hj - 1 : hj)
      return monatsZeitraum(j, monat)
    }
  }
  return null
}

export function inZeitraum(datum: string | null | undefined, z: Zeitraum): boolean {
  const d = String(datum ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= z.von && d <= z.bis
}

/** Beginn des Wirtschaftsjahres, in dem `datum` liegt (JJJJ-MM-01). */
export function wjBeginn(datum: string, beginnMonat: number): string {
  const j = Number(datum.slice(0, 4))
  const m = Number(datum.slice(5, 7))
  return `${m >= beginnMonat ? j : j - 1}-${zwei(beginnMonat)}-01`
}

// ─── Belege (vereinheitlicht aus rechnungen / verbindlichkeiten) ──────────────────────────────────

export type AusgangsRechnung = {
  id: string
  nummer: string
  datum: string
  kundeId: string
  kundeName: string
  netto: number
  brutto: number
  /** gespeicherter Satz; fehlt er, wird er aus netto/brutto erkannt */
  ustSatz?: number | null
  status: string
  leistung?: string
  bezahltAm?: string
  gezahlt?: number
  /** Rechnungs-PDF in den Dokumenten der Akte gespeichert (rechnungen.dokument) */
  hatPdf: boolean
}

export type Eingangsbeleg = {
  id: string
  lieferant: string
  rechnungsnummer?: string
  datum: string
  netto?: number | null
  brutto?: number | null
  kategorie?: string
  status: string
  bezahltAm?: string
  quelle?: string
  geprueft?: boolean
  /** eigener Beleg hochgeladen (verbindlichkeiten.beleg) */
  hatBeleg: boolean
  /** die Original-Mail hat Anhänge (werden beigelegt, wenn kein eigener Beleg da ist) */
  hatMailAnhang?: boolean
}

function zahl(x: unknown): number | null {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

export function rundeCent(n: number): number {
  return Math.round(n * 100) / 100
}

/** Zeile aus rechnungen (Spalten wie in der Datenbank) → AusgangsRechnung. */
export function ausRechnungZeile(z: Record<string, unknown>, kundeName = ''): AusgangsRechnung {
  const zahlungen = Array.isArray(z.zahlungen) ? (z.zahlungen as { betrag?: unknown }[]) : []
  return {
    id: String(z.id ?? ''),
    nummer: String(z.nummer ?? ''),
    datum: String(z.datum ?? ''),
    kundeId: String(z.kunde_id ?? ''),
    kundeName,
    netto: zahl(z.betrag_netto) ?? 0,
    brutto: zahl(z.betrag_brutto) ?? 0,
    ustSatz: zahl(z.ust_satz),
    status: String(z.status ?? ''),
    leistung: textOderLeer(z.leistung_bezeichnung),
    bezahltAm: textOderLeer(z.bezahlt_am),
    gezahlt: rundeCent(zahlungen.reduce((s, x) => s + (Number(x?.betrag) || 0), 0)),
    hatPdf: !!z.dokument && typeof z.dokument === 'object',
  }
}

/** Zeile aus verbindlichkeiten (Spalten wie in der Datenbank) → Eingangsbeleg. */
export function ausVerbindlichkeitZeile(z: Record<string, unknown>, hatMailAnhang = false): Eingangsbeleg {
  const beleg = z.beleg as { url?: unknown } | null | undefined
  return {
    id: String(z.id ?? ''),
    lieferant: String(z.lieferant ?? '').trim(),
    rechnungsnummer: textOderLeer(z.rechnungsnummer),
    datum: String(z.datum ?? ''),
    netto: zahl(z.betrag_netto),
    brutto: zahl(z.betrag_brutto),
    kategorie: textOderLeer(z.kategorie),
    status: String(z.status ?? ''),
    bezahltAm: textOderLeer(z.bezahlt_am),
    quelle: textOderLeer(z.quelle),
    geprueft: z.geprueft === true,
    hatBeleg: !!beleg && !!String(beleg.url ?? '').trim(),
    hatMailAnhang,
  }
}

/** Steuersatz aus netto/brutto: 19, 7 oder 0 — sonst null (gemischt oder unklar). */
export function satzAusBetraegen(netto: number | null | undefined, brutto: number | null | undefined): number | null {
  if (netto == null || brutto == null || !Number.isFinite(netto) || !Number.isFinite(brutto)) return null
  if (netto === 0 && brutto === 0) return null
  const toleranz = Math.max(0.02, Math.abs(brutto) * 0.0005)
  for (const s of [19, 7, 0]) if (Math.abs(netto * (1 + s / 100) - brutto) <= toleranz) return s
  return null
}

/** Umsatzsteuersatz einer Ausgangsrechnung: gespeichert, sonst aus den Beträgen (wie ustSatzVon im CRM). */
export function ustSatzRechnung(r: Pick<AusgangsRechnung, 'ustSatz' | 'netto' | 'brutto'>): number | null {
  if (r.ustSatz != null && Number.isFinite(r.ustSatz)) return r.ustSatz
  return satzAusBetraegen(r.netto, r.brutto)
}

/** Entwürfe sind noch keine Rechnungen — sie gehen nicht an den Steuerberater. */
export function istAusgestellt(r: Pick<AusgangsRechnung, 'status'>): boolean {
  return r.status !== 'Entwurf'
}

export function istUngeprueft(b: Pick<Eingangsbeleg, 'quelle' | 'geprueft'>): boolean {
  return b.quelle === 'email-automatisch' && !b.geprueft
}

/** Buchungsbetrag einer Eingangsrechnung: brutto, sonst netto; null ohne (oder mit 0) Betrag. */
export function eingangsBetrag(b: Pick<Eingangsbeleg, 'netto' | 'brutto'>): number | null {
  const x = b.brutto ?? b.netto
  return x == null || x === 0 ? null : x
}

// ─── Prüfung: was ist drin, was fehlt ─────────────────────────────────────────────────────────────

export type WarnungArt =
  | 'einstellung'
  | 'rechnung_ohne_pdf'
  | 'rechnung_satz_unklar'
  | 'rechnung_ohne_kunde'
  | 'rechnung_entwurf'
  | 'beleg_fehlt'
  | 'beleg_nur_mail'
  | 'ungeprueft'
  | 'ohne_betrag'
  | 'ohne_nummer'
  | 'vorsteuer_unklar'
  | 'ohne_kategorie'
  | 'datei_fehler'

export type Warnung = {
  art: WarnungArt
  /** 'fehlt' = sollte vor der Übergabe erledigt werden; 'hinweis' = zur Kenntnis */
  schwere: 'fehlt' | 'hinweis'
  text: string
  /** id der Rechnung bzw. Verbindlichkeit */
  id?: string
  bezug?: 'rechnung' | 'verbindlichkeit'
}

export type ExportSummen = {
  rechnungen: { anzahl: number; netto: number; ust: number; brutto: number }
  belege: { anzahl: number; imStapel: number; brutto: number; vorsteuer: number }
}

export type ExportPruefung = {
  zeitraum: Zeitraum
  rechnungen: AusgangsRechnung[]
  entwuerfe: AusgangsRechnung[]
  belege: Eingangsbeleg[]
  summen: ExportSummen
  warnungen: Warnung[]
}

function euro(n: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`
}

export function deDatum(iso: string | null | undefined): string {
  const d = String(iso ?? '')
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d
}

function belegName(b: Pick<Eingangsbeleg, 'lieferant' | 'rechnungsnummer' | 'datum'>): string {
  return `${b.lieferant || 'Ohne Lieferant'}${b.rechnungsnummer ? ` Nr. ${b.rechnungsnummer}` : ''} vom ${deDatum(b.datum)}`
}

/** Vorsteuer einer Eingangsrechnung (0, wenn der Satz unklar ist). */
function vorsteuer(b: Eingangsbeleg): number {
  if (b.netto == null || b.brutto == null) return 0
  return satzAusBetraegen(b.netto, b.brutto) == null ? 0 : rundeCent(b.brutto - b.netto)
}

/**
 * Was gehört in den Zeitraum, wie viel ist es, was fehlt noch? Rechnungen nach Rechnungsdatum,
 * Eingangsrechnungen nach Rechnungsdatum (verbindlichkeiten.datum).
 */
export function pruefeExport(
  alleRechnungen: AusgangsRechnung[],
  alleBelege: Eingangsbeleg[],
  einstellung: SteuerberaterEinstellung,
  zeitraum: Zeitraum,
): ExportPruefung {
  const w: Warnung[] = []
  const imZeitraum = alleRechnungen.filter((r) => inZeitraum(r.datum, zeitraum))
  const rechnungen = imZeitraum.filter(istAusgestellt).sort((a, b) => a.datum.localeCompare(b.datum) || a.nummer.localeCompare(b.nummer))
  const entwuerfe = imZeitraum.filter((r) => !istAusgestellt(r))
  const belege = alleBelege.filter((b) => inZeitraum(b.datum, zeitraum)).sort((a, b) => a.datum.localeCompare(b.datum) || a.lieferant.localeCompare(b.lieferant))

  if (!einstellung.beraterNr || !einstellung.mandantenNr) {
    w.push({ art: 'einstellung', schwere: 'hinweis', text: 'Berater- und/oder Mandantennummer sind noch nicht eingetragen — im Buchungsstapel stehen Platzhalter (1001 / 1).' })
  }
  for (const f of pruefeEinstellung(einstellung)) w.push({ art: 'einstellung', schwere: 'fehlt', text: f })
  if (!einstellung.kontenBestaetigt) {
    w.push({ art: 'einstellung', schwere: 'hinweis', text: 'Die Kontenzuordnung ist noch nicht vom Steuerberater bestätigt.' })
  }
  if (wjBeginn(zeitraum.von, einstellung.wjBeginnMonat) !== wjBeginn(zeitraum.bis, einstellung.wjBeginnMonat)) {
    w.push({ art: 'einstellung', schwere: 'fehlt', text: `Der Zeitraum ${zeitraum.bezeichnung} geht über zwei Wirtschaftsjahre — bitte monatsweise übergeben.` })
  }

  for (const r of rechnungen) {
    if (!r.hatPdf) {
      w.push({ art: 'rechnung_ohne_pdf', schwere: 'fehlt', id: r.id, bezug: 'rechnung', text: `Rechnung ${r.nummer} (${r.kundeName || 'ohne Kunde'}) hat kein gespeichertes PDF — es wird nachträglich erzeugt; bitte prüfen, ob es der versendeten Rechnung entspricht.` })
    }
    const satz = ustSatzRechnung(r)
    if (satz == null || !['19', '7', '0'].includes(String(satz))) {
      w.push({ art: 'rechnung_satz_unklar', schwere: 'fehlt', id: r.id, bezug: 'rechnung', text: `Rechnung ${r.nummer}: Umsatzsteuersatz unklar (netto ${euro(r.netto)}, brutto ${euro(r.brutto)}) — gebucht auf das Sammelkonto für Erlöse.` })
    } else if (satz === 0) {
      w.push({ art: 'rechnung_satz_unklar', schwere: 'hinweis', id: r.id, bezug: 'rechnung', text: `Rechnung ${r.nummer} ohne Umsatzsteuer — der Steuerberater muss das Erlöskonto passend zum Grund wählen.` })
    }
    if (!r.kundeId) w.push({ art: 'rechnung_ohne_kunde', schwere: 'fehlt', id: r.id, bezug: 'rechnung', text: `Rechnung ${r.nummer} ist keiner Akte zugeordnet.` })
  }
  if (entwuerfe.length) {
    w.push({ art: 'rechnung_entwurf', schwere: 'hinweis', text: `${entwuerfe.length} ${entwuerfe.length === 1 ? 'Rechnung ist' : 'Rechnungen sind'} noch Entwurf und ${entwuerfe.length === 1 ? 'geht' : 'gehen'} nicht mit: ${entwuerfe.map((r) => r.nummer).join(', ')}.` })
  }

  for (const b of belege) {
    const name = belegName(b)
    if (!b.hatBeleg && b.hatMailAnhang) {
      w.push({ art: 'beleg_nur_mail', schwere: 'hinweis', id: b.id, bezug: 'verbindlichkeit', text: `${name}: kein eigener Beleg hochgeladen — die Anhänge der Original-Mail werden beigelegt.` })
    } else if (!b.hatBeleg) {
      w.push({ art: 'beleg_fehlt', schwere: 'fehlt', id: b.id, bezug: 'verbindlichkeit', text: `${name}: Beleg fehlt.` })
    }
    if (istUngeprueft(b)) w.push({ art: 'ungeprueft', schwere: 'fehlt', id: b.id, bezug: 'verbindlichkeit', text: `${name}: automatisch erkannt und noch nicht geprüft.` })
    const betrag = eingangsBetrag(b)
    if (betrag == null) {
      w.push({ art: 'ohne_betrag', schwere: 'fehlt', id: b.id, bezug: 'verbindlichkeit', text: `${name}: kein Betrag eingetragen — fehlt im Buchungsstapel.` })
    } else {
      if (b.brutto == null) w.push({ art: 'vorsteuer_unklar', schwere: 'hinweis', id: b.id, bezug: 'verbindlichkeit', text: `${name}: nur Nettobetrag bekannt — gebucht ohne Vorsteuer.` })
      else if (b.netto == null) w.push({ art: 'vorsteuer_unklar', schwere: 'hinweis', id: b.id, bezug: 'verbindlichkeit', text: `${name}: nur Bruttobetrag bekannt — Vorsteuer bitte am Beleg prüfen (gebucht ohne Steuerschlüssel).` })
      else if (satzAusBetraegen(b.netto, b.brutto) == null) w.push({ art: 'vorsteuer_unklar', schwere: 'hinweis', id: b.id, bezug: 'verbindlichkeit', text: `${name}: Steuersatz aus netto/brutto nicht eindeutig (gemischt?) — gebucht ohne Steuerschlüssel.` })
    }
    if (!b.rechnungsnummer) w.push({ art: 'ohne_nummer', schwere: 'hinweis', id: b.id, bezug: 'verbindlichkeit', text: `${name}: Rechnungsnummer fehlt.` })
    if (!b.kategorie) w.push({ art: 'ohne_kategorie', schwere: 'hinweis', id: b.id, bezug: 'verbindlichkeit', text: `${name}: keine Kategorie — gebucht auf „Sonstige betriebliche Aufwendungen“.` })
  }

  const imStapel = belege.filter((b) => eingangsBetrag(b) != null)
  const summen: ExportSummen = {
    rechnungen: {
      anzahl: rechnungen.length,
      netto: rundeCent(rechnungen.reduce((s, r) => s + r.netto, 0)),
      ust: rundeCent(rechnungen.reduce((s, r) => s + (r.brutto - r.netto), 0)),
      brutto: rundeCent(rechnungen.reduce((s, r) => s + r.brutto, 0)),
    },
    belege: {
      anzahl: belege.length,
      imStapel: imStapel.length,
      brutto: rundeCent(imStapel.reduce((s, b) => s + (eingangsBetrag(b) ?? 0), 0)),
      vorsteuer: rundeCent(imStapel.reduce((s, b) => s + vorsteuer(b), 0)),
    },
  }
  return { zeitraum, rechnungen, entwuerfe, belege, summen, warnungen: w }
}

/** Kurzer Text „was fehlt noch“ (für den Assistenten und die Hinweise-Datei). */
export function offenePunkte(p: ExportPruefung): { fehlt: Warnung[]; hinweise: Warnung[] } {
  return { fehlt: p.warnungen.filter((x) => x.schwere === 'fehlt'), hinweise: p.warnungen.filter((x) => x.schwere === 'hinweis') }
}

// ─── Personenkonten (Debitoren / Kreditoren) ─────────────────────────────────────────────────────

export type Personenkonto = { art: 'debitor' | 'kreditor'; schluessel: string; nummer: number; name?: string }

/** Kreditor-Schlüssel: Lieferantenname klein, Leerzeichen zusammengefasst. */
export function kreditorSchluessel(lieferant: string): string {
  return String(lieferant ?? '').trim().toLowerCase().replace(/\s+/g, ' ') || 'ohne lieferant'
}

export function debitorSchluessel(kundeId: string): string {
  return String(kundeId ?? '').trim() || 'ohne kunde'
}

/**
 * Feste Nummern: vorhandene bleiben, neue Kunden/Lieferanten bekommen die nächste freie Nummer
 * (höchste vergebene + 1, in der Reihenfolge des ersten Auftretens). Wirft, wenn ein Bereich voll ist.
 */
export function ordnePersonenkontenZu(
  bestand: Personenkonto[],
  rechnungen: Pick<AusgangsRechnung, 'kundeId' | 'kundeName'>[],
  belege: Pick<Eingangsbeleg, 'lieferant'>[],
): { neu: Personenkonto[]; alle: Personenkonto[] } {
  const alle = bestand.map((k) => ({ ...k }))
  const neu: Personenkonto[] = []
  const vorhanden = new Map(alle.map((k) => [`${k.art}|${k.schluessel}`, k]))
  const belegt = new Set(alle.map((k) => k.nummer))
  const naechste = (art: Personenkonto['art']): number => {
    const [start, ende] = art === 'debitor' ? [DEBITOR_START, DEBITOR_ENDE] : [KREDITOR_START, KREDITOR_ENDE]
    const hoechste = alle.filter((k) => k.art === art && k.nummer >= start && k.nummer <= ende).reduce((m, k) => Math.max(m, k.nummer), start - 1)
    let n = hoechste + 1
    while (belegt.has(n) && n <= ende) n++
    if (n > ende) throw new Error(`Alle ${art === 'debitor' ? 'Debitoren' : 'Kreditoren'}nummern sind vergeben.`)
    return n
  }
  const hinzu = (art: Personenkonto['art'], schluessel: string, name: string) => {
    if (vorhanden.has(`${art}|${schluessel}`)) return
    const k: Personenkonto = { art, schluessel, nummer: naechste(art), name: name || undefined }
    alle.push(k)
    neu.push(k)
    belegt.add(k.nummer)
    vorhanden.set(`${art}|${schluessel}`, k)
  }
  for (const r of rechnungen) hinzu('debitor', debitorSchluessel(r.kundeId), r.kundeName)
  for (const b of belege) hinzu('kreditor', kreditorSchluessel(b.lieferant), b.lieferant)
  return { neu, alle }
}

function kontoVon(konten: Personenkonto[], art: Personenkonto['art'], schluessel: string): number | undefined {
  return konten.find((k) => k.art === art && k.schluessel === schluessel)?.nummer
}

// ─── Dateinamen in der ZIP-Datei ─────────────────────────────────────────────────────────────────

/** Für Dateinamen: keine Pfadzeichen, kurz. */
export function sichererName(s: string, max = 60): string {
  return String(s ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim() || 'ohne Namen'
}

function endung(dateiname: string, typ?: string): string {
  const m = String(dateiname ?? '').match(/\.([A-Za-z0-9]{1,5})$/)
  if (m) return m[1].toLowerCase()
  if (typ?.includes('pdf')) return 'pdf'
  if (typ?.includes('png')) return 'png'
  if (typ?.includes('jpeg') || typ?.includes('jpg')) return 'jpg'
  return 'pdf'
}

export function ausgangsrechnungPfad(r: Pick<AusgangsRechnung, 'nummer' | 'datum'>): string {
  return `Ausgangsrechnungen/${r.datum.slice(0, 10)} ${sichererName(r.nummer, 40)}.pdf`
}

/** Pfad eines Eingangsbelegs; bei mehreren Dateien (Mail-Anhänge) mit laufender Nummer. */
export function eingangsbelegPfad(
  b: Pick<Eingangsbeleg, 'datum' | 'lieferant' | 'rechnungsnummer'>,
  originalName: string,
  typ?: string,
  nr = 1,
  anzahl = 1,
): string {
  const teile = [b.datum.slice(0, 10), sichererName(b.lieferant || 'Ohne Lieferant', 40), b.rechnungsnummer ? sichererName(b.rechnungsnummer, 30) : '']
  return `Eingangsbelege/${teile.filter(Boolean).join(' ')}${anzahl > 1 ? ` (${nr})` : ''}.${endung(originalName, typ)}`
}

/** Macht einen Pfad eindeutig („… (2).pdf“), merkt ihn sich in `vergeben`. */
export function eindeutigerPfad(pfad: string, vergeben: Set<string>): string {
  let p = pfad
  let i = 2
  while (vergeben.has(p.toLowerCase())) {
    p = pfad.replace(/(\.[^./]+)?$/, (e) => ` (${i})${e}`)
    i++
  }
  vergeben.add(p.toLowerCase())
  return p
}

// ─── DATEV-Buchungsstapel ────────────────────────────────────────────────────────────────────────

/** Spaltennamen Buchungsstapel, Formatversion 13 (125 Felder). */
export const DATEV_SPALTEN: string[] = (() => {
  const s = [
    'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz',
    'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto',
    'Buchungstext', 'Postensperre', 'Diverse Adressnummer', 'Geschäftspartnerbank', 'Sachverhalt', 'Zinssperre', 'Beleglink',
  ]
  for (let i = 1; i <= 8; i++) s.push(`Beleginfo - Art ${i}`, `Beleginfo - Inhalt ${i}`)
  s.push(
    'KOST1 - Kostenstelle', 'KOST2 - Kostenstelle', 'Kost-Menge', 'EU-Land u. UStID (Bestimmung)', 'EU-Steuersatz (Bestimmung)',
    'Abw. Versteuerungsart', 'Sachverhalt L+L', 'Funktionsergänzung L+L', 'BU 49 Hauptfunktionstyp', 'BU 49 Hauptfunktionsnummer',
    'BU 49 Funktionsergänzung',
  )
  for (let i = 1; i <= 20; i++) s.push(`Zusatzinformation - Art ${i}`, `Zusatzinformation - Inhalt ${i}`)
  s.push(
    'Stück', 'Gewicht', 'Zahlweise', 'Forderungsart', 'Veranlagungsjahr', 'Zugeordnete Fälligkeit', 'Skontotyp', 'Auftragsnummer',
    'Buchungstyp', 'USt-Schlüssel (Anzahlungen)', 'EU-Mitgliedstaat (Anzahlungen)', 'Sachverhalt L+L (Anzahlungen)',
    'EU-Steuersatz (Anzahlungen)', 'Erlöskonto (Anzahlungen)', 'Herkunft-Kz', 'Buchungs GUID', 'KOST-Datum', 'SEPA-Mandatsreferenz',
    'Skontosperre', 'Gesellschaftername', 'Beteiligtennummer', 'Identifikationsnummer', 'Zeichnernummer', 'Postensperre bis',
    'Bezeichnung SoBil-Sachverhalt', 'Kennzeichen SoBil-Buchung', 'Festschreibung', 'Leistungsdatum', 'Datum Zuord. Steuerperiode',
    'Fälligkeit', 'Generalumkehr (GU)', 'Steuersatz', 'Land', 'Abrechnungsreferenz', 'BVV-Position', 'EU-Mitgliedstaat u. UStID (Ursprung)',
    'EU-Steuersatz (Ursprung)', 'Abw. Skontokonto',
  )
  return s
})()

/** Textfeld in Anführungszeichen (innere verdoppelt), ohne Zeilenumbrüche und Semikolon-Probleme. */
export function datevText(s: string | null | undefined): string {
  return `"${String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/"/g, '""')}"`
}

/** Betrag ohne Vorzeichen, Komma, zwei Nachkommastellen, ohne Tausenderpunkt. */
export function datevBetrag(n: number): string {
  return Math.abs(rundeCent(n)).toFixed(2).replace('.', ',')
}

/** Belegdatum TTMM aus JJJJ-MM-TT. */
export function datevDatumTTMM(iso: string): string {
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}`
}

function umlauteAus(s: string): string {
  return s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
}

/** Belegfeld 1: höchstens 36 Zeichen aus A–Z a–z 0–9 $ & % * + - / (andere → „-“). */
export function datevBelegfeld(s: string | null | undefined): string {
  return umlauteAus(String(s ?? ''))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9$&%*+\-/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
}

/** Buchungstext: höchstens 60 Zeichen, eine Zeile. */
export function datevBuchungstext(s: string): string {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim()
}

function zeitstempel(d: Date): string {
  return `${d.getFullYear()}${zwei(d.getMonth() + 1)}${zwei(d.getDate())}${zwei(d.getHours())}${zwei(d.getMinutes())}${zwei(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}`
}

export type DatevBuchung = {
  umsatz: number
  sollHaben: 'S' | 'H'
  konto: number | string
  gegenkonto: number | string
  buSchluessel?: string
  belegdatum: string // JJJJ-MM-TT
  belegfeld1: string
  buchungstext: string
  belegDatei?: string
}

/** Kopfzeile (Zeile 1) des Buchungsstapels. */
export function datevKopfzeile(e: SteuerberaterEinstellung, z: Zeitraum, erzeugtAm: Date, erstelltVon = ''): string {
  const ymd = (iso: string) => iso.replace(/-/g, '')
  const felder: string[] = [
    datevText('EXTF'), '700', '21', datevText('Buchungsstapel'), '13', zeitstempel(erzeugtAm), '', datevText('RE'),
    datevText(datevBuchungstext(erstelltVon).slice(0, 25)), datevText(''),
    e.beraterNr && /^\d{4,7}$/.test(e.beraterNr) ? e.beraterNr : '1001',
    e.mandantenNr && /^\d{1,5}$/.test(e.mandantenNr) ? e.mandantenNr : '1',
    ymd(wjBeginn(z.von, e.wjBeginnMonat)), '4', ymd(z.von), ymd(z.bis),
    datevText(`Rechnungen ${z.kurz}`.slice(0, 30)), datevText(''), '1', '0', '0', datevText('EUR'), '', datevText(''), '', '',
    datevText(e.kontenrahmen === 'SKR04' ? '04' : '03'), '', '', datevText(''), datevText(''),
  ]
  return felder.join(';')
}

/** Eine Buchungszeile mit allen 125 Feldern (die meisten leer). */
export function datevZeile(b: DatevBuchung, mitBelegInfo: boolean): string {
  const f: string[] = new Array(DATEV_SPALTEN.length).fill('')
  f[0] = datevBetrag(b.umsatz)
  f[1] = datevText(b.sollHaben)
  f[2] = datevText('EUR')
  f[6] = String(b.konto)
  f[7] = String(b.gegenkonto)
  f[8] = b.buSchluessel ? datevText(b.buSchluessel) : ''
  f[9] = datevDatumTTMM(b.belegdatum)
  f[10] = datevText(datevBelegfeld(b.belegfeld1))
  f[13] = datevText(datevBuchungstext(b.buchungstext))
  if (mitBelegInfo && b.belegDatei) {
    f[20] = datevText('Dateiname')
    f[21] = datevText(b.belegDatei.slice(0, 210))
  }
  return f.join(';')
}

export function datevCsv(e: SteuerberaterEinstellung, z: Zeitraum, buchungen: DatevBuchung[], erzeugtAm: Date, erstelltVon = ''): string {
  const zeilen = [datevKopfzeile(e, z, erzeugtAm, erstelltVon), DATEV_SPALTEN.join(';'), ...buchungen.map((b) => datevZeile(b, e.belegInfo))]
  return `${zeilen.join('\r\n')}\r\n`
}

/** Erlöskonto für einen Steuersatz (sonst das Sammelkonto). */
export function erloeskontoFuer(e: SteuerberaterEinstellung, satz: number | null): string {
  const k = kontenFuer(e).erloese
  return (satz != null ? k[String(satz)] : undefined) ?? k[SONST]
}

/** Aufwandskonto für eine Kategorie (ohne Groß-/Kleinschreibung; sonst das Sammelkonto). */
export function aufwandskontoFuer(e: SteuerberaterEinstellung, kategorie: string | undefined): string {
  const k = kontenFuer(e).aufwand
  const kat = String(kategorie ?? '').trim().toLowerCase()
  if (kat) {
    const treffer = Object.entries(k).find(([name]) => name.toLowerCase() === kat && name !== SONST)
    if (treffer) return treffer[1]
  }
  return k[SONST]
}

/** Buchungen aus der Prüfung; Konten müssen vorher zugeordnet sein (ordnePersonenkontenZu). */
export function erstelleBuchungen(
  p: ExportPruefung,
  e: SteuerberaterEinstellung,
  konten: Personenkonto[],
  dateien: { rechnungen?: Record<string, string[]>; belege?: Record<string, string[]> } = {},
): DatevBuchung[] {
  const aus: DatevBuchung[] = []
  for (const r of p.rechnungen) {
    const debitor = kontoVon(konten, 'debitor', debitorSchluessel(r.kundeId))
    if (debitor == null) throw new Error(`Für Rechnung ${r.nummer} fehlt die Debitorennummer.`)
    aus.push({
      umsatz: r.brutto,
      sollHaben: r.brutto >= 0 ? 'S' : 'H',
      konto: debitor,
      gegenkonto: erloeskontoFuer(e, ustSatzRechnung(r)),
      belegdatum: r.datum.slice(0, 10),
      belegfeld1: r.nummer,
      buchungstext: `${r.nummer} ${r.kundeName}`.trim(),
      belegDatei: dateien.rechnungen?.[r.id]?.[0],
    })
  }
  for (const b of p.belege) {
    const betrag = eingangsBetrag(b)
    if (betrag == null) continue
    const kreditor = kontoVon(konten, 'kreditor', kreditorSchluessel(b.lieferant))
    if (kreditor == null) throw new Error(`Für ${b.lieferant} fehlt die Kreditorennummer.`)
    const satz = b.netto != null && b.brutto != null ? satzAusBetraegen(b.netto, b.brutto) : null
    aus.push({
      umsatz: betrag,
      sollHaben: betrag >= 0 ? 'H' : 'S',
      konto: kreditor,
      gegenkonto: aufwandskontoFuer(e, b.kategorie),
      buSchluessel: satz != null ? VORSTEUER_SCHLUESSEL[String(satz)] : undefined,
      belegdatum: b.datum.slice(0, 10),
      belegfeld1: b.rechnungsnummer || `ER-${b.id.slice(-8)}`,
      buchungstext: `${b.lieferant}${b.rechnungsnummer ? ` ${b.rechnungsnummer}` : ''}`,
      belegDatei: dateien.belege?.[b.id]?.[0],
    })
  }
  return aus
}

// ─── Lesbare Listen ──────────────────────────────────────────────────────────────────────────────

function csvFeld(x: string | number | null | undefined): string {
  const s = x == null ? '' : String(x)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function deZahl(n: number | null | undefined): string {
  return n == null ? '' : rundeCent(n).toFixed(2).replace('.', ',')
}

function csv(kopf: string[], zeilen: (string | number | null | undefined)[][]): string {
  return `${[kopf, ...zeilen].map((z) => z.map(csvFeld).join(';')).join('\r\n')}\r\n`
}

const STATUS_EINGANG: Record<string, string> = { offen: 'offen', bezahlt: 'bezahlt', ueberfaellig: 'überfällig' }

export function ausgangsbuchCsv(p: ExportPruefung, e: SteuerberaterEinstellung, konten: Personenkonto[], dateien: Record<string, string[]> = {}): string {
  return csv(
    ['Rechnungsnummer', 'Rechnungsdatum', 'Kunde', 'Debitor', 'Leistung', 'Netto', 'USt-Satz', 'USt', 'Brutto', 'Erlöskonto', 'Status', 'Bezahlt am', 'Bereits gezahlt', 'Noch offen', 'Datei'],
    p.rechnungen.map((r) => {
      const satz = ustSatzRechnung(r)
      const gezahlt = r.status === 'Bezahlt' ? r.brutto : (r.gezahlt ?? 0)
      return [
        r.nummer, deDatum(r.datum), r.kundeName, kontoVon(konten, 'debitor', debitorSchluessel(r.kundeId)) ?? '', r.leistung ?? '',
        deZahl(r.netto), satz == null ? 'unklar' : `${String(satz).replace('.', ',')} %`, deZahl(r.brutto - r.netto), deZahl(r.brutto),
        erloeskontoFuer(e, satz), r.status, deDatum(r.bezahltAm), deZahl(gezahlt), deZahl(Math.max(0, r.brutto - gezahlt)),
        (dateien[r.id] ?? []).join(', '),
      ]
    }),
  )
}

export function eingangsbuchCsv(p: ExportPruefung, e: SteuerberaterEinstellung, konten: Personenkonto[], dateien: Record<string, string[]> = {}): string {
  return csv(
    ['Rechnungsdatum', 'Lieferant', 'Rechnungsnummer', 'Kategorie', 'Kreditor', 'Aufwandskonto', 'Netto', 'Vorsteuer-Satz', 'Vorsteuer', 'Brutto', 'Im Buchungsstapel', 'Status', 'Bezahlt am', 'Geprüft', 'Datei'],
    p.belege.map((b) => {
      const satz = satzAusBetraegen(b.netto, b.brutto)
      return [
        deDatum(b.datum), b.lieferant, b.rechnungsnummer ?? '', b.kategorie ?? '', kontoVon(konten, 'kreditor', kreditorSchluessel(b.lieferant)) ?? '',
        aufwandskontoFuer(e, b.kategorie), deZahl(b.netto), satz == null ? (b.netto != null && b.brutto != null ? 'gemischt/unklar' : '') : `${satz} %`,
        satz == null || b.netto == null || b.brutto == null ? '' : deZahl(b.brutto - b.netto), deZahl(b.brutto),
        eingangsBetrag(b) == null ? 'nein (kein Betrag)' : 'ja', STATUS_EINGANG[b.status] ?? b.status, deDatum(b.bezahltAm),
        istUngeprueft(b) ? 'nein' : 'ja', (dateien[b.id] ?? []).join(', '),
      ]
    }),
  )
}

export function personenkontenCsv(konten: Personenkonto[], namen: Map<string, string> = new Map()): string {
  const sortiert = [...konten].sort((a, b) => a.nummer - b.nummer)
  return csv(['Konto', 'Art', 'Name'], sortiert.map((k) => [k.nummer, k.art === 'debitor' ? 'Debitor (Kunde)' : 'Kreditor (Lieferant)', namen.get(`${k.art}|${k.schluessel}`) ?? k.name ?? k.schluessel]))
}

export function hinweiseText(
  p: ExportPruefung,
  e: SteuerberaterEinstellung,
  o: { erzeugtAm: Date; erstelltVon?: string; dateien: string[]; zusatzWarnungen?: Warnung[] },
): string {
  const k = kontenFuer(e)
  const alle = [...p.warnungen, ...(o.zusatzWarnungen ?? [])]
  const fehlt = alle.filter((w) => w.schwere === 'fehlt')
  const hinweise = alle.filter((w) => w.schwere === 'hinweis')
  const z: string[] = []
  z.push(`Übergabe an den Steuerberater — ${p.zeitraum.bezeichnung} (${deDatum(p.zeitraum.von)} bis ${deDatum(p.zeitraum.bis)})`)
  z.push(`Erstellt am ${deDatum(o.erzeugtAm.toISOString().slice(0, 10))}${o.erstelltVon ? ` von ${o.erstelltVon}` : ''} mit dem CRM der Mayer Holding.`)
  z.push('')
  z.push('INHALT')
  for (const d of o.dateien) z.push(`- ${d}`)
  z.push('')
  z.push('SUMMEN')
  z.push(`Ausgangsrechnungen: ${p.summen.rechnungen.anzahl} — netto ${euro(p.summen.rechnungen.netto)}, Umsatzsteuer ${euro(p.summen.rechnungen.ust)}, brutto ${euro(p.summen.rechnungen.brutto)}`)
  z.push(`Eingangsrechnungen: ${p.summen.belege.anzahl}, davon ${p.summen.belege.imStapel} im Buchungsstapel — brutto ${euro(p.summen.belege.brutto)}, erkennbare Vorsteuer ${euro(p.summen.belege.vorsteuer)}`)
  z.push('')
  z.push(`NOCH ZU ERLEDIGEN (${fehlt.length})`)
  if (!fehlt.length) z.push('- nichts')
  for (const w of fehlt) z.push(`- ${w.text}`)
  z.push('')
  z.push(`ZUR KENNTNIS (${hinweise.length})`)
  if (!hinweise.length) z.push('- nichts')
  for (const w of hinweise) z.push(`- ${w.text}`)
  z.push('')
  z.push(`KONTENZUORDNUNG (${e.kontenrahmen}, ${e.kontenBestaetigt ? 'vom Steuerberater bestätigt' : 'Vorschlag — bitte vom Steuerberater bestätigen lassen'})`)
  z.push(`Erlöse 19 % USt: ${k.erloese['19']} · Erlöse 7 % USt: ${k.erloese['7']} · ohne USt: ${k.erloese['0']} · nicht zuzuordnen: ${k.erloese[SONST]}`)
  for (const [kat, konto] of Object.entries(k.aufwand)) if (kat !== SONST) z.push(`Aufwand „${kat}“: ${konto}`)
  z.push(`Aufwand ohne/mit unbekannter Kategorie: ${k.aufwand[SONST]}`)
  z.push(`Debitoren ab ${DEBITOR_START}, Kreditoren ab ${KREDITOR_START} (feste Nummer je Kunde bzw. Lieferant, siehe Personenkonten.csv).`)
  z.push('')
  z.push('ZUM BUCHUNGSSTAPEL')
  z.push(`- DATEV-Format (Buchungsstapel, Formatversion 13), Zeichensatz Windows-1252, Beraternummer ${e.beraterNr || '1001 (Platzhalter)'}, Mandantennummer ${e.mandantenNr || '1 (Platzhalter)'}, Sachkontenlänge 4, nicht festgeschrieben.`)
  z.push('- Ausgangsrechnungen: brutto, Debitor an Erlöskonto (Automatikkonto, Umsatzsteuer rechnet DATEV).')
  z.push('- Eingangsrechnungen: brutto, Aufwandskonto an Kreditor, Steuerschlüssel 9 (19 %) bzw. 8 (7 %), wenn der Satz aus netto/brutto eindeutig ist.')
  z.push('- Zahlungseingänge und -ausgänge sind nicht gebucht (bitte aus den Kontoauszügen buchen); der Zahlungsstand steht in den Listen.')
  z.push('- Ausländische Lieferanten (Steuerschuldnerschaft des Leistungsempfängers), gemischte Steuersätze und Gründe für 0 % kann das CRM nicht erkennen — bitte prüfen.')
  z.push(`- Belegdateien liegen in den Ordnern „Ausgangsrechnungen“ und „Eingangsbelege“${e.belegInfo ? '; ihr Dateiname steht im Buchungsstapel unter „Beleginfo“' : ''}.`)
  return `${z.join('\r\n')}\r\n`
}

// ─── Zeichensätze ────────────────────────────────────────────────────────────────────────────────

const CP1252_SONDER: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}

/** Text → Windows-1252 (DATEV erwartet ANSI). Nicht darstellbare Zeichen werden „?“. */
export function alsWindows1252(text: string): Uint8Array {
  const aus: number[] = []
  for (const zeichen of text.normalize('NFC')) {
    const c = zeichen.codePointAt(0)!
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) aus.push(c)
    else if (CP1252_SONDER[c] !== undefined) aus.push(CP1252_SONDER[c])
    else aus.push(0x3f)
  }
  return new Uint8Array(aus)
}

/** Text → UTF-8 mit Kennung (BOM), damit Excel Umlaute richtig zeigt. */
export function alsUtf8MitKennung(text: string): Uint8Array {
  const inhalt = new TextEncoder().encode(text)
  const aus = new Uint8Array(inhalt.length + 3)
  aus.set([0xef, 0xbb, 0xbf], 0)
  aus.set(inhalt, 3)
  return aus
}

// ─── Alles zusammen ──────────────────────────────────────────────────────────────────────────────

export type ExportTextdateien = {
  /** Dateiname → Inhalt (fertig kodiert) */
  dateien: { name: string; inhalt: Uint8Array }[]
  buchungen: DatevBuchung[]
}

/**
 * Baut die Textdateien der Übergabe. `dateien` = welche Belegdateien (Pfade in der ZIP-Datei) zu welcher
 * Rechnung bzw. Verbindlichkeit wirklich beiliegen; `namen` = aktuelle Namen der Personenkonten.
 */
export function erstelleExportDateien(
  p: ExportPruefung,
  e: SteuerberaterEinstellung,
  konten: Personenkonto[],
  o: {
    erzeugtAm: Date
    erstelltVon?: string
    dateien?: { rechnungen?: Record<string, string[]>; belege?: Record<string, string[]> }
    belegPfade?: string[]
    zusatzWarnungen?: Warnung[]
  },
): ExportTextdateien {
  const buchungen = erstelleBuchungen(p, e, konten, o.dateien)
  const k = p.zeitraum.kurz
  const genutzt = new Set([
    ...p.rechnungen.map((r) => `debitor|${debitorSchluessel(r.kundeId)}`),
    ...p.belege.map((b) => `kreditor|${kreditorSchluessel(b.lieferant)}`),
  ])
  const namen = new Map<string, string>()
  for (const r of p.rechnungen) if (r.kundeName) namen.set(`debitor|${debitorSchluessel(r.kundeId)}`, r.kundeName)
  for (const b of p.belege) if (b.lieferant) namen.set(`kreditor|${kreditorSchluessel(b.lieferant)}`, b.lieferant)
  const kontenImZeitraum = konten.filter((x) => genutzt.has(`${x.art}|${x.schluessel}`))

  const namenListe = {
    datev: `EXTF_Buchungsstapel_${k}.csv`,
    ausgang: `Rechnungsausgangsbuch_${k}.csv`,
    eingang: `Rechnungseingangsbuch_${k}.csv`,
    konten: 'Personenkonten.csv',
    hinweise: 'Hinweise.txt',
  }
  const dateien = [
    { name: namenListe.datev, inhalt: alsWindows1252(datevCsv(e, p.zeitraum, buchungen, o.erzeugtAm, o.erstelltVon)) },
    { name: namenListe.ausgang, inhalt: alsUtf8MitKennung(ausgangsbuchCsv(p, e, konten, o.dateien?.rechnungen)) },
    { name: namenListe.eingang, inhalt: alsUtf8MitKennung(eingangsbuchCsv(p, e, konten, o.dateien?.belege)) },
    { name: namenListe.konten, inhalt: alsUtf8MitKennung(personenkontenCsv(kontenImZeitraum, namen)) },
  ]
  const inhalt = [
    `${namenListe.datev} — Buchungsstapel zum Einlesen in DATEV`,
    `${namenListe.ausgang} — Rechnungsausgangsbuch (lesbar, z. B. in Excel)`,
    `${namenListe.eingang} — Rechnungseingangsbuch (lesbar, z. B. in Excel)`,
    `${namenListe.konten} — Debitoren und Kreditoren dieses Zeitraums`,
    `Ausgangsrechnungen/ — ${(o.belegPfade ?? []).filter((x) => x.startsWith('Ausgangsrechnungen/')).length} Rechnung(en) als PDF`,
    `Eingangsbelege/ — ${(o.belegPfade ?? []).filter((x) => x.startsWith('Eingangsbelege/')).length} Datei(en)`,
  ]
  dateien.push({ name: namenListe.hinweise, inhalt: alsUtf8MitKennung(hinweiseText(p, e, { erzeugtAm: o.erzeugtAm, erstelltVon: o.erstelltVon, dateien: inhalt, zusatzWarnungen: o.zusatzWarnungen })) })
  return { dateien, buchungen }
}

/** Kurzbericht für den Assistenten: Zahlen und was noch fehlt (mit ids). */
export function statusText(p: ExportPruefung, o: { ohneHinweise?: boolean } = {}): string {
  const { fehlt, hinweise } = offenePunkte(p)
  const z: string[] = []
  z.push(`Export für den Steuerberater — ${p.zeitraum.bezeichnung} (${deDatum(p.zeitraum.von)} bis ${deDatum(p.zeitraum.bis)}):`)
  z.push(`Ausgangsrechnungen: ${p.summen.rechnungen.anzahl} (netto ${euro(p.summen.rechnungen.netto)}, brutto ${euro(p.summen.rechnungen.brutto)})${p.entwuerfe.length ? `, dazu ${p.entwuerfe.length} Entwurf/Entwürfe (gehen nicht mit)` : ''}.`)
  z.push(`Eingangsrechnungen: ${p.summen.belege.anzahl} (brutto ${euro(p.summen.belege.brutto)}${p.summen.belege.imStapel < p.summen.belege.anzahl ? `, ${p.summen.belege.anzahl - p.summen.belege.imStapel} ohne Betrag` : ''}).`)
  const mitId = (w: Warnung) => `- ${w.text}${w.id ? ` (${w.bezug === 'rechnung' ? 'Rechnung' : 'Verbindlichkeit'} id=${w.id})` : ''}`
  if (!fehlt.length) z.push('Es fehlt nichts — der Export kann raus.')
  else {
    z.push(`Noch zu erledigen (${fehlt.length}):`)
    z.push(...fehlt.slice(0, 40).map(mitId))
    if (fehlt.length > 40) z.push(`… und ${fehlt.length - 40} weitere.`)
  }
  if (!o.ohneHinweise && hinweise.length) {
    z.push(`Zur Kenntnis (${hinweise.length}):`)
    z.push(...hinweise.slice(0, 20).map(mitId))
    if (hinweise.length > 20) z.push(`… und ${hinweise.length - 20} weitere.`)
  }
  return z.join('\n')
}
