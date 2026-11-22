// Umsatzvorschau und Provisionen für die Geschäftsführung (22.11.2026). Reines Rechnen ohne Datenbank,
// ohne Browser und ohne Abhängigkeiten — dieselbe Datei rechnet im CRM (src/lib/umsatzvorschau.ts, Seite
// /auswertungen/umsatz) und im Assistenten (telegram-gateway/umsatzWerkzeuge.ts, Werkzeug umsatz_vorschau).
// So nennt Telegram dieselben Zahlen wie die Seite.
//
// Alle Beträge sind NETTO (ohne Umsatzsteuer). Monate werden als Text „JJJJ-MM“ geführt.
//
// ─── Die Regeln ──────────────────────────────────────────────────────────────────────────────────
// (a) Schon in Rechnung gestellt: jede Rechnung, die nicht mehr Entwurf ist (Versendet, Überfällig,
//     Bezahlt), zählt mit ihrem Nettobetrag im Monat ihres Rechnungsdatums — zu 100 %.
//     Zahlungseingang: jede erfasste (Teil-)Zahlung im Monat ihres Zahlungsdatums, auf netto
//     umgerechnet (Zahlung × netto ÷ brutto). Ältere bezahlte Rechnungen ohne erfasste Zahlungen zählen
//     als voll bezahlt am „bezahlt am“-Tag (sonst am Rechnungsdatum).
//     Rechnungsentwürfe zählen zu 100 % im Monat des Rechnungsdatums, frühestens im laufenden Monat.
// (b) Offene Rechnungen: Stand heute, unabhängig vom Zeitraum. Offen = Brutto minus erfasste Zahlungen
//     (für die Vorschau netto anteilig). Überfällig, wenn der Status „Überfällig“ ist, eine Mahnstufe
//     gesetzt ist oder die gültige Frist (neue Frist aus dem letzten Mahnschreiben, sonst Zahlungsziel)
//     vor heute liegt — wie src/lib/rechnungen.ts.
// (c) Angebote (Kostenvoranschläge) der Akten:
//     - zählen nur „offen“ und „angenommen“; „abgelehnt“ und „bezahlt“ nicht, ebenso keiner, aus dem schon
//       eine Rechnung gemacht wurde (Rechnung mit kvId) — der steckt dann in (a);
//     - Akten im Endstand (abgeschlossen, verloren, nicht qualifiziert) zählen nicht mehr;
//     - angenommen = 100 % (Auftrag ist erteilt); offen = Chance der Akte (Projekt-Checkliste). Ohne
//       Chance zählt ein offenes Angebot mit 0 € — wie in der Wochenbesprechung („ohne Chance zählt nichts“);
//     - erwarteter Monat = Datum des Kostenvoranschlags + Vorlauf (ANGEBOT_VORLAUF_MONATE: angenommen
//       1 Monat, offen 2 Monate), frühestens der laufende Monat. Ohne Datum gilt das Anlagedatum.
// (d) Immobilien-Provision je Objekt = Provision in Euro × Anteil nach Stand des Objekts
//     (OBJEKT_STUFEN, z. B. reserviert 50 %, Notartermin 80 %, beurkundet 95 %, Kaufpreis gezahlt 100 %).
//     Erwarteter Monat = laufender Monat + Vorlauf der Stufe. Ab „Verkauft“ zählt ein Objekt hier nicht
//     mehr — die Provision gehört dann als Rechnung ins CRM (sonst würde doppelt gezählt).
//     Woher die Provision kommt (erste Angabe, die da ist):
//       1. Provision in Euro aus der Abrechnung des Objekts (Reiter Abrechnung) — gilt als netto;
//       2. Kurzprüfung: Betrag in Euro, sonst Prozent vom Kaufpreis;
//       3. Provision aus der Freigabe an Interessenten (Käuferseite), zuerst eine zugestimmte;
//       4. Annahme STANDARD_PROVISION (3 % netto, Käuferseite).
//     Verkäuferprovision ist nur dabei, wenn sie in Abrechnung oder Kurzprüfung steht.
//     Kaufpreis = Kaufpreis des Objekts, sonst Zielverkaufspreis bzw. Kaufpreisvorstellung aus dem
//     Verkaufsdatenblatt. Prozent-Texte: „inkl. USt./MwSt.“ oder „brutto“ wird durch 1,19 geteilt,
//     „zzgl.“ oder „netto“ gilt so. Ohne Angabe gilt der Wert als netto — außer er ist offensichtlich ein
//     Bruttosatz (3,57 = 3 × 1,19; 5,95 = 5 × 1,19 …), dann wird zurückgerechnet.
//
// Private Akten, private Kostenvoranschläge und private Objekte zählen nie (gehören nicht zur Holding).
// Die Rechte (welche Bereiche jemand sehen darf) prüft der Aufrufer über die Option `darf`.

// ─── Stellschrauben (hier ändern, gilt für Seite und Assistent) ───────────────────────────────────

/** Anteil (0–1) und Vorlauf in Monaten bis zur Provision je Stand eines Objekts. Nicht genannte Stände zählen nicht. */
export const OBJEKT_STUFEN: Record<string, { anteil: number; monate: number }> = {
  reserviert: { anteil: 0.5, monate: 2 },
  notarauftrag_vorbereitet: { anteil: 0.6, monate: 2 },
  vertragsentwurf_erhalten: { anteil: 0.65, monate: 1 },
  pruefung_verkaeufer: { anteil: 0.7, monate: 1 },
  pruefung_kaeufer: { anteil: 0.7, monate: 1 },
  aenderungswuensche: { anteil: 0.75, monate: 1 },
  notartermin: { anteil: 0.8, monate: 0 },
  beurkundet: { anteil: 0.95, monate: 0 },
  faelligkeitsmitteilung: { anteil: 0.95, monate: 0 },
  kaufpreis_gezahlt: { anteil: 1, monate: 0 },
  besitzuebergang: { anteil: 1, monate: 0 },
}

export const OBJEKT_STUFE_NAME: Record<string, string> = {
  reserviert: 'Reserviert',
  notarauftrag_vorbereitet: 'Notarauftrag vorbereitet',
  vertragsentwurf_erhalten: 'Vertragsentwurf erhalten',
  pruefung_verkaeufer: 'Prüfung durch Verkäufer',
  pruefung_kaeufer: 'Prüfung durch Käufer',
  aenderungswuensche: 'Änderungswünsche klären',
  notartermin: 'Notartermin',
  beurkundet: 'Beurkundet',
  faelligkeitsmitteilung: 'Fälligkeitsmitteilung versendet',
  kaufpreis_gezahlt: 'Kaufpreis gezahlt',
  besitzuebergang: 'Besitzübergang',
}

/** Monate vom Datum des Kostenvoranschlags bis zum erwarteten Umsatz. */
export const ANGEBOT_VORLAUF_MONATE: Record<'offen' | 'angenommen', number> = { angenommen: 1, offen: 2 }

/** Annahme, wenn am Objekt keine Provision hinterlegt ist. */
export const STANDARD_PROVISION = { prozentNetto: 3, text: '3 % netto (Käuferseite, Annahme — keine Provision hinterlegt)' }

/** Umsatzsteuersatz zum Zurückrechnen von „inkl. USt.“. */
export const UST_SATZ = 19

/** Endstände der Akten aller Bereiche (aus src/data/statusNetworks.ts, isTerminal): Hier gibt es keinen Umsatz mehr zu erwarten. */
export const AKTE_ENDSTAENDE: readonly string[] = ['abgeschlossen', 'verloren', 'nicht_qualifiziert', 'erledigt', 'abgebrochen']

export const BEREICH_NAMEN: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  buecher: 'Bücher & Verlag',
  ohne: 'Ohne Bereich',
}

/** Feste Reihenfolge der Bereiche in Tabellen und Texten. */
export const BEREICH_REIHENFOLGE: readonly string[] = ['beratung', 'immobilien', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen', 'buecher', 'ohne']

// ─── Eingaben ────────────────────────────────────────────────────────────────────────────────────

export type RechnungEingabe = {
  id: string
  nummer: string
  kundeId?: string
  /** Bereich der Akte (Kundenakten-Schlüssel oder Bereichs-Kennung); leer = ohne Akte. */
  bereich?: string
  akteName?: string
  datum: string
  netto: number
  brutto: number
  status: string
  zahlungsziel?: string
  mahnstufe?: string | null
  /** Neue Frist aus dem letzten Mahnschreiben. */
  neueFrist?: string
  zahlungen?: { datum: string; betrag: number }[]
  bezahltAm?: string
  kvId?: string
}

export type AngebotEingabe = {
  id: string
  kundeId?: string
  bereich?: string
  privat?: boolean
  name: string
  beschreibung?: string
  status: string
  datum?: string
  erstelltAm?: string
  betrag?: number | null
  positionen?: { menge: number; einzelpreis: number }[] | null
  aufschlagProzent?: number | null
  ustSatz?: number | null
}

export type AkteEingabe = {
  id: string
  bereich: string
  name: string
  status: string
  /** Chance in Prozent (Projekt-Checkliste). */
  chance?: number
  chanceBestaetigt?: boolean
}

export type ObjektEingabe = {
  id: string
  name: string
  status: string
  privat?: boolean
  kaufpreis?: number | null
  /** Zielverkaufspreis oder Kaufpreisvorstellung aus dem Verkaufsdatenblatt. */
  zielpreis?: number | null
  /** Provision in Euro aus der Abrechnung des Objekts. */
  abrechnungProvision?: number | null
  kurzpruefungProzent?: string
  kurzpruefungBetrag?: string
  /** Provisionstexte der Freigaben an Interessenten; zugestimmte gehen vor, sonst die neueste (Reihenfolge egal). */
  freigaben?: { provision: string; status?: string; erstelltAm?: string }[]
}

export type UmsatzEingabe = {
  heute: string
  rechnungen: RechnungEingabe[]
  angebote: AngebotEingabe[]
  akten: AkteEingabe[]
  objekte: ObjektEingabe[]
}

export type UmsatzOptionen = {
  /** Darf der Nutzer diesen Bereich sehen (Bereichs-Kennung, „immobilienkunden“ kommt als „immobilien“)? „ohne“ ist immer sichtbar. */
  darf?: (bereich: string) => boolean
}

// ─── Ergebnis ────────────────────────────────────────────────────────────────────────────────────

export type PostenArt = 'rechnung' | 'entwurf' | 'angebot' | 'provision'

export type Posten = {
  art: PostenArt
  id: string
  /** Akte bzw. Objekt. */
  titel: string
  /** Zusatz: Rechnungsnummer, Name des Kostenvoranschlags … */
  zusatz?: string
  bereich: string
  monat: string
  /** Netto, ungewichtet; undefined = Betrag unbekannt (z. B. Objekt ohne Kaufpreis). */
  betrag?: number
  /** 0–1 */
  anteil: number
  gewichtet: number
  warum: string
  verweis: { typ: 'akte' | 'objekt' | 'rechnung' | 'angebot'; id: string; bereich?: string }
}

export type Eingang = { rechnungId: string; nummer: string; titel: string; bereich: string; datum: string; monat: string; netto: number; brutto: number }

export type OffeneRechnung = {
  id: string
  nummer: string
  titel: string
  bereich: string
  kundeId?: string
  offenBrutto: number
  offenNetto: number
  frist?: string
  ueberfaellig: boolean
  tageUeberfaellig: number
}

export type UmsatzVorschau = {
  heute: string
  aktuellerMonat: string
  posten: Posten[]
  eingaenge: Eingang[]
  offene: OffeneRechnung[]
  hinweise: {
    /** Offene Angebote ohne Chance (zählen mit 0 €). */
    angeboteOhneChance: number
    /** Offene Angebote ohne Betrag. */
    angeboteOhneBetrag: number
    /** Laufende Akten mit Chance, aber ohne Kostenvoranschlag mit Betrag. */
    aktenMitChanceOhneAngebot: number
    /** Objekte in einer zählenden Stufe ohne Kaufpreis (Provision unbekannt). */
    objekteOhnePreis: number
    /** Objekte, bei denen die Standard-Provision angenommen wurde. */
    objekteMitAnnahme: number
  }
}

export type Summen = {
  /** (a) Rechnungen mit Rechnungsdatum im Zeitraum, netto. */
  berechnet: number
  /** Zahlungseingang im Zeitraum, netto. */
  eingegangen: number
  /** Rechnungsentwürfe. */
  entwuerfe: number
  /** (c) Angebote gewichtet. */
  angebote: number
  angeboteUngewichtet: number
  /** (d) Provisionen gewichtet. */
  provision: number
  provisionUngewichtet: number
  /** berechnet + entwuerfe + angebote + provision */
  erwartet: number
  anzahlAngebote: number
  anzahlObjekte: number
}

// ─── Hilfen ──────────────────────────────────────────────────────────────────────────────────────

export function runde2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Kundenakten-Schlüssel oder Bereichs-Kennung → Bereichs-Kennung; leer → „ohne“. */
export function bereichKennung(b: string | null | undefined): string {
  const s = String(b ?? '').trim()
  if (!s) return 'ohne'
  return s === 'immobilienkunden' ? 'immobilien' : s
}

export function bereichName(b: string): string {
  return BEREICH_NAMEN[b] ?? b
}

export function monatVon(iso: string | null | undefined): string | undefined {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}` : undefined
}

/** „2026-11“ + 2 → „2027-01“ */
export function plusMonate(monat: string, n: number): string {
  const [j, m] = monat.split('-').map(Number)
  const gesamt = j * 12 + (m - 1) + n
  return `${Math.floor(gesamt / 12)}-${String((gesamt % 12) + 1).padStart(2, '0')}`
}

const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export function monatName(monat: string): string {
  const [j, m] = monat.split('-').map(Number)
  return `${MONATSNAMEN[m - 1] ?? '?'} ${j}`
}

export function monatKurz(monat: string): string {
  const [j, m] = monat.split('-').map(Number)
  return `${MONATE_KURZ[m - 1] ?? '?'} ${String(j).slice(2)}`
}

export function euro(n: number): string {
  return `${Math.round(n).toLocaleString('de-DE')} €`
}

export function prozentText(p: number): string {
  return `${p.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} %`
}

const maxMonat = (a: string, b: string) => (a > b ? a : b)

function tageZwischen(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis.slice(0, 10)}T12:00:00Z`) - Date.parse(`${von.slice(0, 10)}T12:00:00Z`)) / 86_400_000)
}

/** Deutsche Zahl aus Text: „3,57“ → 3.57, „1.200.000“ → 1200000, „5.000,50“ → 5000.5, „2.5“ → 2.5. */
export function leseDeutscheZahl(roh: string): number | undefined {
  const s = String(roh ?? '').replace(/\s/g, '')
  if (!s) return undefined
  let t: string
  if (s.includes('.') && s.includes(',')) t = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',')) t = s.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) t = s.replace(/\./g, '')
  else t = s
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

// ─── Provision aus Text ──────────────────────────────────────────────────────────────────────────

export type ProvisionSatz =
  | { art: 'prozent'; prozentNetto: number; erklaerung: string }
  | { art: 'betrag'; nettoBetrag: number; erklaerung: string }

const INKL = /inkl|einschl|incl|brutto/i
const ZZGL = /zzgl|zuzügl|zuzuegl|netto|plus|\+\s*(ust|mwst)/i

/** Ist der Satz offensichtlich ein Bruttosatz (runder Nettosatz × 1,19, z. B. 3,57 oder 5,95)? */
export function istBruttoSatz(p: number): boolean {
  const netto = p / (1 + UST_SATZ / 100)
  const halbe = Math.round(netto * 2) / 2
  if (Math.abs(netto - halbe) > 0.006 || halbe <= 0) return false
  // Selbst schon rund (3, 3,5 …) → als netto gemeint.
  return Math.abs(p * 2 - Math.round(p * 2)) > 0.001
}

/**
 * Liest einen Provisionstext. `feld` sagt, woher er kommt: 'prozent' (Feld „Provision in %“ der Kurzprüfung,
 * Zahl ohne %-Zeichen), 'betrag' (Feld „Provision als Betrag“), 'frei' (Text der Freigabe, z. B.
 * „3 % des beurkundeten Kaufpreises zzgl. gesetzlicher Umsatzsteuer“ oder „pauschal 5.000 € inkl. MwSt.“).
 */
export function leseProvision(text: string | null | undefined, feld: 'prozent' | 'betrag' | 'frei' = 'frei'): ProvisionSatz | undefined {
  const t = String(text ?? '').trim()
  if (!t) return undefined
  const inkl = INKL.test(t) && !ZZGL.test(t)
  const zzgl = ZZGL.test(t)
  const zahlMitProzent = t.match(/(\d[\d.,]*)\s*(%|prozent)/i)
  const ersteZahl = t.match(/\d[\d.,]*/)
  const hatEuro = /€|eur\b|euro/i.test(t)
  let prozent: number | undefined
  if (zahlMitProzent) prozent = leseDeutscheZahl(zahlMitProzent[1])
  else if (feld === 'prozent' && ersteZahl) prozent = leseDeutscheZahl(ersteZahl[0])
  else if (feld === 'frei' && ersteZahl && !hatEuro) {
    const z = leseDeutscheZahl(ersteZahl[0])
    if (z !== undefined && z > 0 && z <= 15) prozent = z
  }
  if (prozent !== undefined) {
    if (!(prozent > 0 && prozent <= 100)) return undefined
    if (inkl) {
      const netto = prozent / (1 + UST_SATZ / 100)
      return { art: 'prozent', prozentNetto: netto, erklaerung: `${prozentText(prozent)} inkl. USt. = ${prozentText(runde2(netto))} netto` }
    }
    if (zzgl) return { art: 'prozent', prozentNetto: prozent, erklaerung: `${prozentText(prozent)} netto` }
    if (istBruttoSatz(prozent)) {
      const netto = prozent / (1 + UST_SATZ / 100)
      return { art: 'prozent', prozentNetto: netto, erklaerung: `${prozentText(prozent)} (sieht nach inkl. USt. aus) = ${prozentText(runde2(netto))} netto` }
    }
    return { art: 'prozent', prozentNetto: prozent, erklaerung: `${prozentText(prozent)} (ohne Angabe zur USt., als netto gerechnet)` }
  }
  if (feld === 'prozent') return undefined
  const m = t.match(/(\d[\d.,]*)\s*(mio\.?|millionen|million|tsd\.?|t€|k\b)?/i)
  if (!m) return undefined
  const z = leseDeutscheZahl(m[1])
  if (z === undefined || z <= 0) return undefined
  const einheit = (m[2] ?? '').toLowerCase()
  const faktor = einheit.startsWith('mio') || einheit.startsWith('million') ? 1_000_000 : einheit ? 1000 : 1
  const betrag = z * faktor
  if (inkl) {
    const netto = runde2(betrag / (1 + UST_SATZ / 100))
    return { art: 'betrag', nettoBetrag: netto, erklaerung: `${euro(betrag)} inkl. USt. = ${euro(netto)} netto` }
  }
  return { art: 'betrag', nettoBetrag: runde2(betrag), erklaerung: zzgl ? `${euro(betrag)} netto` : `${euro(betrag)} (ohne Angabe zur USt., als netto gerechnet)` }
}

/** Provision eines Objekts in Euro (netto) und woher sie kommt. betrag undefined = unbekannt (kein Kaufpreis). */
export function provisionFuerObjekt(o: ObjektEingabe): { betrag?: number; quelle: string; annahme: boolean } {
  const preis = Number(o.kaufpreis) > 0 ? Number(o.kaufpreis) : Number(o.zielpreis) > 0 ? Number(o.zielpreis) : 0
  const preisText = Number(o.kaufpreis) > 0 ? `Kaufpreis ${euro(preis)}` : preis > 0 ? `Zielpreis ${euro(preis)} (Verkaufsdatenblatt)` : ''
  const ausSatz = (s: ProvisionSatz, woher: string, annahme = false) => {
    if (s.art === 'betrag') return { betrag: s.nettoBetrag, quelle: `${woher}: ${s.erklaerung}`, annahme }
    if (!preis) return { betrag: undefined, quelle: `${woher}: ${s.erklaerung}, aber kein Kaufpreis eingetragen`, annahme }
    return { betrag: runde2((preis * s.prozentNetto) / 100), quelle: `${woher}: ${s.erklaerung} vom ${preisText}`, annahme }
  }
  const abr = Number(o.abrechnungProvision)
  if (Number.isFinite(abr) && abr > 0) return { betrag: runde2(abr), quelle: `Provision aus der Abrechnung des Objekts: ${euro(abr)}`, annahme: false }
  const kpBetragText = String(o.kurzpruefungBetrag ?? '').trim()
  if (kpBetragText) {
    // Steht im Betragsfeld ein Prozentwert, ist es kein Euro-Betrag (wie ObjektAbrechnungSection).
    const s = leseProvision(kpBetragText, kpBetragText.includes('%') ? 'frei' : 'betrag')
    if (s) return ausSatz(s, 'Kurzprüfung')
  }
  const kpProzent = leseProvision(o.kurzpruefungProzent, 'prozent')
  if (kpProzent) return ausSatz(kpProzent, 'Kurzprüfung')
  const freigaben = [...(o.freigaben ?? [])]
    .filter((f) => f.status !== 'widerrufen' && String(f.provision ?? '').trim())
    .sort((a, b) => Number(b.status === 'zugestimmt') - Number(a.status === 'zugestimmt') || String(b.erstelltAm ?? '').localeCompare(String(a.erstelltAm ?? '')))
  for (const f of freigaben) {
    const s = leseProvision(f.provision, 'frei')
    if (s) return ausSatz(s, f.status === 'zugestimmt' ? 'Freigabe (zugestimmt, Käuferseite)' : 'Freigabe (Käuferseite)')
  }
  return ausSatz({ art: 'prozent', prozentNetto: STANDARD_PROVISION.prozentNetto, erklaerung: STANDARD_PROVISION.text }, 'Annahme', true)
}

/** Netto eines Kostenvoranschlags — wie kvNetto in src/lib/checkliste.ts (Positionen mit Auf-/Abschlag, sonst Betrag; mit Steuersatz ist der Betrag brutto). */
export function angebotNetto(kv: Pick<AngebotEingabe, 'betrag' | 'positionen' | 'aufschlagProzent' | 'ustSatz'>): number | undefined {
  if (kv.positionen && kv.positionen.length > 0) {
    const a = Number(kv.aufschlagProzent) || 0
    return runde2(kv.positionen.reduce((s, p) => s + runde2((Number(p.menge) || 0) * runde2((Number(p.einzelpreis) || 0) * (1 + a / 100))), 0))
  }
  if (kv.betrag === undefined || kv.betrag === null || Number.isNaN(Number(kv.betrag))) return undefined
  if (kv.ustSatz !== undefined && kv.ustSatz !== null) return runde2(Number(kv.betrag) / (1 + Number(kv.ustSatz) / 100))
  return Number(kv.betrag)
}

export function istAkteAbgeschlossen(status: string | null | undefined): boolean {
  return AKTE_ENDSTAENDE.includes(String(status ?? ''))
}

// ─── Berechnung ──────────────────────────────────────────────────────────────────────────────────

export function berechneUmsatzvorschau(e: UmsatzEingabe, optionen: UmsatzOptionen = {}): UmsatzVorschau {
  const darf = (b: string) => b === 'ohne' || !optionen.darf || optionen.darf(b)
  const aktuell = monatVon(e.heute)!
  const posten: Posten[] = []
  const eingaenge: Eingang[] = []
  const offene: OffeneRechnung[] = []
  const hinweise = { angeboteOhneChance: 0, angeboteOhneBetrag: 0, aktenMitChanceOhneAngebot: 0, objekteOhnePreis: 0, objekteMitAnnahme: 0 }

  // (a) + (b) Rechnungen
  const kvInRechnung = new Set<string>()
  for (const r of e.rechnungen) {
    if (r.kvId) kvInRechnung.add(r.kvId)
    const bereich = bereichKennung(r.bereich)
    if (bereich === 'privat' || !darf(bereich)) continue
    const titel = r.akteName || 'ohne Akte'
    const netto = Number(r.netto) || 0
    const brutto = Number(r.brutto) || 0
    const quote = brutto > 0 ? netto / brutto : 1
    const verweis = { typ: 'rechnung' as const, id: r.id, bereich }
    const rmonat = monatVon(r.datum) ?? aktuell
    if (r.status === 'Entwurf') {
      const monat = maxMonat(rmonat, aktuell)
      posten.push({ art: 'entwurf', id: r.id, titel, zusatz: `Entwurf ${r.nummer}`, bereich, monat, betrag: netto, anteil: 1, gewichtet: runde2(netto), warum: `Rechnungsentwurf ${r.nummer}, zählt voll im ${monatName(monat)}`, verweis })
      continue
    }
    posten.push({ art: 'rechnung', id: r.id, titel, zusatz: r.nummer, bereich, monat: rmonat, betrag: netto, anteil: 1, gewichtet: runde2(netto), warum: `Rechnung ${r.nummer} vom ${deDatum(r.datum)} (${r.status})`, verweis })
    const zahlungen = (r.zahlungen ?? []).filter((z) => monatVon(z.datum) && Number(z.betrag))
    if (zahlungen.length) {
      for (const z of zahlungen) eingaenge.push({ rechnungId: r.id, nummer: r.nummer, titel, bereich, datum: z.datum.slice(0, 10), monat: monatVon(z.datum)!, brutto: runde2(Number(z.betrag)), netto: runde2(Number(z.betrag) * quote) })
    } else if (r.status === 'Bezahlt') {
      const datum = (monatVon(r.bezahltAm) ? r.bezahltAm! : r.datum).slice(0, 10)
      eingaenge.push({ rechnungId: r.id, nummer: r.nummer, titel, bereich, datum, monat: monatVon(datum) ?? rmonat, brutto: runde2(brutto), netto: runde2(netto) })
    }
    if (r.status === 'Versendet' || r.status === 'Überfällig') {
      const bezahlt = zahlungen.reduce((s, z) => s + Number(z.betrag), 0)
      const offenBrutto = Math.max(0, runde2(brutto - bezahlt))
      if (offenBrutto > 0) {
        const frist = (r.neueFrist || r.zahlungsziel || '').slice(0, 10) || undefined
        const fristVorbei = !!frist && /^\d{4}-\d{2}-\d{2}$/.test(frist) && frist < e.heute
        offene.push({
          id: r.id, nummer: r.nummer, titel, bereich, kundeId: r.kundeId, offenBrutto, offenNetto: runde2(offenBrutto * quote), frist,
          ueberfaellig: r.status === 'Überfällig' || !!r.mahnstufe || fristVorbei,
          tageUeberfaellig: fristVorbei ? tageZwischen(frist!, e.heute) : 0,
        })
      }
    }
  }

  // (c) Angebote der Akten
  const akten = new Map(e.akten.map((a) => [a.id, a]))
  const aktenMitBetrag = new Set<string>()
  for (const kv of e.angebote) {
    if (kv.privat) continue
    if (kv.status !== 'offen' && kv.status !== 'angenommen') continue
    if (kvInRechnung.has(kv.id)) continue
    const akte = kv.kundeId ? akten.get(kv.kundeId) : undefined
    const bereich = bereichKennung(akte?.bereich ?? kv.bereich)
    if (bereich === 'privat' || !darf(bereich)) continue
    if (akte && istAkteAbgeschlossen(akte.status)) continue
    const netto = angebotNetto(kv)
    const titel = akte?.name || kv.name || 'ohne Akte'
    const zusatz = `Kostenvoranschlag ${kv.beschreibung || kv.name || ''}`.trim()
    const basis = monatVon(kv.datum) ?? monatVon(kv.erstelltAm) ?? aktuell
    const vorlauf = ANGEBOT_VORLAUF_MONATE[kv.status as 'offen' | 'angenommen']
    const monat = maxMonat(plusMonate(basis, vorlauf), aktuell)
    let anteil = 0
    let wie: string
    if (kv.status === 'angenommen') {
      anteil = 1
      wie = 'angenommen, zählt voll'
    } else if (akte?.chance !== undefined && akte.chance !== null && Number.isFinite(Number(akte.chance))) {
      anteil = Math.max(0, Math.min(100, Number(akte.chance))) / 100
      wie = `offen, Chance ${prozentText(Number(akte.chance))}${akte.chanceBestaetigt === false ? ' (Vorschlag, noch nicht bestätigt)' : ''}`
    } else {
      wie = 'offen, keine Chance eingetragen — zählt nicht'
      hinweise.angeboteOhneChance++
    }
    if (netto === undefined) hinweise.angeboteOhneBetrag++
    else if (kv.kundeId) aktenMitBetrag.add(kv.kundeId)
    const datumText = kv.datum ? `vom ${deDatum(kv.datum)}` : 'ohne Datum'
    posten.push({
      art: 'angebot', id: kv.id, titel, zusatz, bereich, monat, betrag: netto, anteil,
      gewichtet: netto === undefined ? 0 : runde2(netto * anteil),
      warum: `${netto === undefined ? 'ohne Betrag' : euro(netto)} ${wie}; ${datumText} + ${vorlauf} ${vorlauf === 1 ? 'Monat' : 'Monate'} → ${monatName(monat)}`,
      verweis: kv.kundeId ? { typ: 'akte', id: kv.kundeId, bereich: akte?.bereich } : { typ: 'angebot', id: kv.id },
    })
  }
  for (const a of e.akten) {
    const b = bereichKennung(a.bereich)
    if (b === 'privat' || !darf(b) || istAkteAbgeschlossen(a.status)) continue
    if (a.chance !== undefined && a.chance !== null && Number(a.chance) > 0 && !aktenMitBetrag.has(a.id)) hinweise.aktenMitChanceOhneAngebot++
  }

  // (d) Immobilien-Provision
  if (darf('immobilien')) {
    for (const o of e.objekte) {
      if (o.privat) continue
      const stufe = OBJEKT_STUFEN[o.status]
      if (!stufe || stufe.anteil <= 0) continue
      const p = provisionFuerObjekt(o)
      if (p.betrag === undefined) hinweise.objekteOhnePreis++
      if (p.annahme) hinweise.objekteMitAnnahme++
      const monat = plusMonate(aktuell, stufe.monate)
      const stand = OBJEKT_STUFE_NAME[o.status] ?? o.status
      posten.push({
        art: 'provision', id: o.id, titel: o.name || 'Objekt ohne Bezeichnung', zusatz: stand, bereich: 'immobilien', monat,
        betrag: p.betrag, anteil: stufe.anteil, gewichtet: p.betrag === undefined ? 0 : runde2(p.betrag * stufe.anteil),
        warum: `${stand}: ${prozentText(stufe.anteil * 100)} · ${p.quelle} · erwartet ${monatName(monat)}`,
        verweis: { typ: 'objekt', id: o.id },
      })
    }
  }

  return { heute: e.heute, aktuellerMonat: aktuell, posten, eingaenge, offene, hinweise }
}

function deDatum(iso: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

// ─── Zeiträume und Summen ────────────────────────────────────────────────────────────────────────

export type ZeitraumArt = 'monat' | 'quartal' | 'jahr'
export type Zeitraum = { art: ZeitraumArt; von: string; bis: string; label: string }

/** Laufender Monat, laufendes Quartal oder ganzes Kalenderjahr (jeweils ganz, auch was schon vorbei ist). */
export function zeitraum(art: ZeitraumArt, heute: string): Zeitraum {
  const monat = monatVon(heute)!
  const [j, m] = monat.split('-').map(Number)
  if (art === 'monat') return { art, von: monat, bis: monat, label: monatName(monat) }
  if (art === 'quartal') {
    const q = Math.floor((m - 1) / 3)
    const von = `${j}-${String(q * 3 + 1).padStart(2, '0')}`
    return { art, von, bis: plusMonate(von, 2), label: `${q + 1}. Quartal ${j}` }
  }
  return { art, von: `${j}-01`, bis: `${j}-12`, label: `Jahr ${j}` }
}

const imZeitraum = (monat: string, z: { von: string; bis: string }) => monat >= z.von && monat <= z.bis

export function summen(v: UmsatzVorschau, z: { von: string; bis: string }, bereich?: string): Summen {
  const s: Summen = { berechnet: 0, eingegangen: 0, entwuerfe: 0, angebote: 0, angeboteUngewichtet: 0, provision: 0, provisionUngewichtet: 0, erwartet: 0, anzahlAngebote: 0, anzahlObjekte: 0 }
  for (const p of v.posten) {
    if (!imZeitraum(p.monat, z) || (bereich && p.bereich !== bereich)) continue
    if (p.art === 'rechnung') s.berechnet += p.gewichtet
    else if (p.art === 'entwurf') s.entwuerfe += p.gewichtet
    else if (p.art === 'angebot') {
      s.angebote += p.gewichtet
      s.angeboteUngewichtet += p.betrag ?? 0
      s.anzahlAngebote++
    } else {
      s.provision += p.gewichtet
      s.provisionUngewichtet += p.betrag ?? 0
      s.anzahlObjekte++
    }
  }
  for (const g of v.eingaenge) if (imZeitraum(g.monat, z) && (!bereich || g.bereich === bereich)) s.eingegangen += g.netto
  for (const k of Object.keys(s) as (keyof Summen)[]) if (!k.startsWith('anzahl')) s[k] = runde2(s[k])
  s.erwartet = runde2(s.berechnet + s.entwuerfe + s.angebote + s.provision)
  return s
}

/** Summen je Bereich (nur Bereiche mit irgendeinem Betrag), in fester Reihenfolge. */
export function summenJeBereich(v: UmsatzVorschau, z: { von: string; bis: string }): { bereich: string; name: string; summen: Summen }[] {
  const da = new Set([...v.posten.map((p) => p.bereich), ...v.eingaenge.map((g) => g.bereich)])
  const liste = [...da].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  return liste
    .map((b) => ({ bereich: b, name: bereichName(b), summen: summen(v, z, b) }))
    .filter((x) => x.summen.erwartet > 0 || x.summen.eingegangen > 0 || x.summen.angeboteUngewichtet > 0 || x.summen.provisionUngewichtet > 0)
}

function rang(b: string): number {
  const i = BEREICH_REIHENFOLGE.indexOf(b)
  return i < 0 ? 99 : i
}

export type MonatsWert = { monat: string; label: string; berechnet: number; entwuerfe: number; angebote: number; provision: number; eingegangen: number; erwartet: number }

/** Werte je Monat von `von` bis `bis` (einschließlich). */
export function jeMonat(v: UmsatzVorschau, von: string, bis: string, bereich?: string): MonatsWert[] {
  const liste: MonatsWert[] = []
  for (let m = von, i = 0; m <= bis && i < 60; m = plusMonate(m, 1), i++) {
    const s = summen(v, { von: m, bis: m }, bereich)
    liste.push({ monat: m, label: monatKurz(m), berechnet: s.berechnet, entwuerfe: s.entwuerfe, angebote: s.angebote, provision: s.provision, eingegangen: s.eingegangen, erwartet: s.erwartet })
  }
  return liste
}

export function offeneSumme(v: UmsatzVorschau, bereich?: string): { netto: number; brutto: number; anzahl: number; ueberfaelligNetto: number; anzahlUeberfaellig: number } {
  const l = v.offene.filter((o) => !bereich || o.bereich === bereich)
  const u = l.filter((o) => o.ueberfaellig)
  return {
    netto: runde2(l.reduce((s, o) => s + o.offenNetto, 0)),
    brutto: runde2(l.reduce((s, o) => s + o.offenBrutto, 0)),
    anzahl: l.length,
    ueberfaelligNetto: runde2(u.reduce((s, o) => s + o.offenNetto, 0)),
    anzahlUeberfaellig: u.length,
  }
}

/** Größte Posten einer Art im Zeitraum, nach gewichtetem Wert. */
export function groesstePosten(v: UmsatzVorschau, z: { von: string; bis: string }, arten: PostenArt[], anzahl = 10, bereich?: string): Posten[] {
  return v.posten
    .filter((p) => arten.includes(p.art) && imZeitraum(p.monat, z) && (!bereich || p.bereich === bereich))
    .sort((a, b) => b.gewichtet - a.gewichtet || (b.betrag ?? 0) - (a.betrag ?? 0))
    .slice(0, anzahl)
}

/** Kurzer deutscher Bericht für den Assistenten. */
export function kurzbericht(v: UmsatzVorschau, art: ZeitraumArt, bereich?: string): string {
  const z = zeitraum(art, v.heute)
  const s = summen(v, z, bereich)
  const wo = bereich ? bereichName(bereich) : 'alle freigegebenen Bereiche'
  const zeilen: string[] = []
  zeilen.push(`Umsatzvorschau ${z.label} (${wo}), alles netto:`)
  zeilen.push(`Erwartet gesamt: ${euro(s.erwartet)}`)
  zeilen.push(`- schon in Rechnung gestellt: ${euro(s.berechnet)}`)
  if (s.entwuerfe) zeilen.push(`- Rechnungsentwürfe: ${euro(s.entwuerfe)}`)
  zeilen.push(`- Angebote nach Chance: ${euro(s.angebote)} (ungewichtet ${euro(s.angeboteUngewichtet)}, ${s.anzahlAngebote} ${s.anzahlAngebote === 1 ? 'Angebot' : 'Angebote'})`)
  if (!bereich || bereich === 'immobilien') zeilen.push(`- Immobilien-Provision nach Stand: ${euro(s.provision)} (ungewichtet ${euro(s.provisionUngewichtet)}, ${s.anzahlObjekte} ${s.anzahlObjekte === 1 ? 'Objekt' : 'Objekte'})`)
  zeilen.push(`Zahlungseingang im Zeitraum: ${euro(s.eingegangen)}`)
  const o = offeneSumme(v, bereich)
  if (o.anzahl) zeilen.push(`Offene Rechnungen heute: ${euro(o.netto)} netto (${o.anzahl}), davon überfällig ${euro(o.ueberfaelligNetto)} (${o.anzahlUeberfaellig}).`)
  else zeilen.push('Offene Rechnungen heute: keine.')
  if (!bereich) {
    const jb = summenJeBereich(v, z).filter((x) => x.summen.erwartet > 0)
    if (jb.length > 1) zeilen.push(`Je Bereich: ${jb.map((x) => `${x.name} ${euro(x.summen.erwartet)}`).join(', ')}.`)
  }
  const top = groesstePosten(v, z, ['angebot', 'provision', 'entwurf'], 5, bereich).filter((p) => p.gewichtet > 0)
  if (top.length) {
    zeilen.push('Größte erwartete Posten:')
    for (const p of top) zeilen.push(`- ${p.titel}${p.zusatz ? ` (${p.zusatz})` : ''}: ${euro(p.gewichtet)} — ${p.warum}`)
  }
  const h = v.hinweise
  const luecken: string[] = []
  if (h.angeboteOhneChance) luecken.push(`${h.angeboteOhneChance} offene ${h.angeboteOhneChance === 1 ? 'Angebot' : 'Angebote'} ohne Chance zählen nicht mit`)
  if (h.aktenMitChanceOhneAngebot) luecken.push(`${h.aktenMitChanceOhneAngebot} ${h.aktenMitChanceOhneAngebot === 1 ? 'Akte hat' : 'Akten haben'} eine Chance, aber keinen Kostenvoranschlag mit Betrag`)
  if (h.objekteOhnePreis && (!bereich || bereich === 'immobilien')) luecken.push(`${h.objekteOhnePreis} ${h.objekteOhnePreis === 1 ? 'Objekt' : 'Objekte'} ohne Kaufpreis`)
  if (h.objekteMitAnnahme && (!bereich || bereich === 'immobilien')) luecken.push(`bei ${h.objekteMitAnnahme} ${h.objekteMitAnnahme === 1 ? 'Objekt' : 'Objekten'} ist keine Provision hinterlegt, gerechnet mit 3 % netto`)
  if (luecken.length) zeilen.push(`Lücken: ${luecken.join('; ')}.`)
  zeilen.push('Regeln: Rechnungen zählen voll im Rechnungsmonat; Angebote mit der Chance der Akte (angenommen = 100 %) im Monat Angebotsdatum + 2 (angenommen + 1), frühestens jetzt; Provision = Kaufpreis × Satz × Anteil nach Stand (reserviert 50 %, Notartermin 80 %, beurkundet 95 %, Kaufpreis gezahlt 100 %).')
  return zeilen.join('\n')
}
