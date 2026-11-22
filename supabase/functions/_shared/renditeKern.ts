// Rendite- und Kaufpreis-Check für Anlageobjekte (22.11.2026). Reines Rechnen ohne Datenbank, ohne Browser
// und ohne Abhängigkeiten — dieselbe Datei rechnet im CRM (src/components/ObjektRenditeCheck.tsx, Reiter
// „Rendite“ der Objektakte) und im Assistenten (telegram-gateway/renditeWerkzeuge.ts, Werkzeug
// rendite_rechnen). So nennt Telegram dieselben Zahlen wie die Objektakte.
//
// Anlass: Die Geschäftsführung hat zum „Boarding House Remstal“ (Lorch, 1.200.000 €, 590 m², 15 Appartements,
// 3,57 % Käuferprovision) die Einschätzung einer fremden KI eingefügt („2.100 €/m² günstig gegenüber
// 2.800–3.000 €/m² vor Ort; Pacht 12,50–15,50 €/m² netto kalt im Monat → Bruttorendite 7–9 %“) und will diese
// Prüfung im CRM selbst haben, mit nachvollziehbarem Rechenweg.
//
// Gespeichert wird alles in objekte.rendite (jsonb, Form RenditeStand unten): die Eingaben, woher sie stammen,
// das letzte Ergebnis, der Marktvergleich (schreibt nur der Server, email-gateway/renditeMarkt.ts) und die
// abgehakten Prüfsteine.
//
// ─── Die Formeln (alle Beträge in Euro, Renditen in Prozent, „im Jahr“ = erstes Jahr) ───────────────
//  Kaufnebenkosten
//    Grunderwerbsteuer      = Kaufpreis × Steuersatz des Bundeslands (Vorgabe Baden-Württemberg 5 %)
//    Notar und Grundbuch    = Kaufpreis × 2 % (Faustwert: Notar rund 1,5 %, Grundbuch rund 0,5 %)
//    Makler                 = Kaufpreis × Käuferprovision in % (brutto, wie im Angebot genannt)
//    Nebenkosten            = Grunderwerbsteuer + Notar/Grundbuch + Makler
//    Gesamtinvestition      = Kaufpreis + Nebenkosten + einmalige Zusatzkosten (Möblierung, Renovierung …)
//  Preis
//    Kaufpreis je m²        = Kaufpreis ÷ Fläche          (ohne Nebenkosten, so vergleicht der Markt)
//    Gesamtkosten je m²     = Gesamtinvestition ÷ Fläche
//    Kaufpreis je Einheit   = Kaufpreis ÷ Einheiten
//  Miete / Pacht (Sollmiete = volle Jahresnettokaltmiete ohne Ausfall)
//    aus €/m² im Monat      : Sollmiete = Betrag × Fläche × 12
//    aus € im Monat         : Sollmiete = Betrag × 12
//    aus € im Jahr          : Sollmiete = Betrag
//    Miete je m² im Monat   = Sollmiete ÷ 12 ÷ Fläche
//  Kennzahlen
//    Kaufpreisfaktor        = Kaufpreis ÷ Sollmiete      („das Wievielfache der Jahresmiete“)
//    Bruttomietrendite      = Sollmiete ÷ Kaufpreis × 100 (ohne Nebenkosten und Kosten — so rechnen
//                             Angebote und die eingefügte Einschätzung; Kehrwert des Faktors)
//    Mietausfall            = Sollmiete × Leerstand in %
//    Verwaltung/Nebenkosten = Sollmiete × nicht umlagefähige Kosten in %
//    Instandhaltung         = Instandhaltung je m² und Jahr × Fläche
//    Kosten im Jahr         = Mietausfall + Verwaltung/Nebenkosten + Instandhaltung + feste Kosten im Jahr
//    Reinertrag             = Sollmiete − Kosten im Jahr
//    Nettomietrendite       = Reinertrag ÷ Gesamtinvestition × 100 (mit Nebenkosten und laufenden Kosten)
//  Finanzierung (nur, wenn Eigenkapital, Zins oder Tilgung angegeben ist; sonst ganz aus eigenem Geld)
//    Darlehen               = Gesamtinvestition − Eigenkapital (nie unter 0)
//    Zinsen im Jahr         = Darlehen × Zins in %
//    Tilgung im Jahr        = Darlehen × anfängliche Tilgung in %
//    Kapitaldienst          = Zinsen + Tilgung (Rate des ersten Jahres)
//    Cashflow vor Steuern   = Reinertrag − Kapitaldienst (im Monat: ÷ 12)
//    Eigenkapitalrendite    = (Reinertrag − Zinsen) ÷ Eigenkapital × 100 — die Tilgung ist Vermögensaufbau
//                             und zählt deshalb als Ertrag des Eigenkapitals
//    Cashflow-Rendite       = Cashflow ÷ Eigenkapital × 100 (was bar übrig bleibt)
//    Schuldendienstdeckung  = Reinertrag ÷ Kapitaldienst (Banken wollen meist mindestens 1,2)
//  Break-even-Miete (Sollmiete, bei der der Cashflow genau 0 ist)
//    Cashflow = S × (1 − Leerstand − Verwaltung) − Instandhaltung − feste Kosten − Kapitaldienst = 0
//    → S = (Instandhaltung + feste Kosten + Kapitaldienst) ÷ (1 − Leerstand − Verwaltung)
//    je m² im Monat = S ÷ 12 ÷ Fläche; Anteil = S ÷ heutige Sollmiete × 100
//  Empfindlichkeit
//    Dieselbe Rechnung mit Miete −10 % / +10 % und Zins −1 / +1 Prozentpunkt (Zins nie unter 0).
//
// Alles ist eine Überschlagsrechnung vor Steuern und kein Gutachten; die Vorgaben (Leerstand, Kosten,
// Steuersatz) stehen im Ergebnis unter „annahmen“, damit niemand sie für belegte Zahlen hält.

export type MieteArt = 'qm_monat' | 'monat' | 'jahr'

export type Bundesland = 'BW' | 'BY' | 'BE' | 'BB' | 'HB' | 'HH' | 'HE' | 'MV' | 'NI' | 'NW' | 'RP' | 'SL' | 'SN' | 'ST' | 'SH' | 'TH'

/** Grunderwerbsteuer in % je Bundesland (Stand der Gesetze Mitte 2025; ändert ein Land den Satz, hier anpassen
 *  oder im Einzelfall grunderwerbsteuerProzent überschreiben). */
export const GRUNDERWERBSTEUER: Record<Bundesland, { name: string; prozent: number }> = {
  BW: { name: 'Baden-Württemberg', prozent: 5.0 },
  BY: { name: 'Bayern', prozent: 3.5 },
  BE: { name: 'Berlin', prozent: 6.0 },
  BB: { name: 'Brandenburg', prozent: 6.5 },
  HB: { name: 'Bremen', prozent: 5.5 },
  HH: { name: 'Hamburg', prozent: 5.5 },
  HE: { name: 'Hessen', prozent: 6.0 },
  MV: { name: 'Mecklenburg-Vorpommern', prozent: 6.0 },
  NI: { name: 'Niedersachsen', prozent: 5.0 },
  NW: { name: 'Nordrhein-Westfalen', prozent: 6.5 },
  RP: { name: 'Rheinland-Pfalz', prozent: 5.0 },
  SL: { name: 'Saarland', prozent: 6.5 },
  SN: { name: 'Sachsen', prozent: 5.5 },
  ST: { name: 'Sachsen-Anhalt', prozent: 5.0 },
  SH: { name: 'Schleswig-Holstein', prozent: 6.5 },
  TH: { name: 'Thüringen', prozent: 5.0 },
}

/** Vorgaben, wenn nichts angegeben ist. Jede verwendete Vorgabe erscheint im Ergebnis unter „annahmen“. */
export const RENDITE_VORGABEN = {
  bundesland: 'BW' as Bundesland,
  notarGrundbuchProzent: 2.0,
  maklerProzent: 0,
  zusatzkosten: 0,
  /** Mietausfall durch Leerstand und Zahlungsausfall, üblicher Ansatz 2 %. */
  leerstandProzent: 2,
  /** Nicht umlagefähige Kosten (Verwaltung, nicht umlagefähige Nebenkosten) in % der Sollmiete. */
  bewirtschaftungProzent: 3,
  /** Instandhaltung in € je m² und Jahr (Dach und Fach, Technik); üblich 7–14 €. */
  instandhaltungJeQm: 10,
  sonstigeKostenJahr: 0,
  /** Nur bei Finanzierung: Eigenkapital = Nebenkosten + Zusatzkosten + 20 % des Kaufpreises. */
  eigenkapitalAnteilKaufpreis: 20,
  zinsProzent: 3.8,
  tilgungProzent: 2,
}

export type RenditeEingaben = {
  kaufpreis?: number
  /** Wohn-/Nutzfläche in m² (bei einem Boarding House die vermietete Gesamtfläche). */
  flaeche?: number
  einheiten?: number
  /** Miete bzw. Pacht netto kalt, Einheit nach mieteArt (Vorgabe €/m² im Monat). */
  miete?: number
  mieteArt?: MieteArt
  /** true = es ist eine Pacht (nur für die Beschriftung, gerechnet wird gleich). */
  pacht?: boolean
  bundesland?: Bundesland
  /** Überschreibt den Satz des Bundeslands. */
  grunderwerbsteuerProzent?: number
  notarGrundbuchProzent?: number
  maklerProzent?: number
  /** Einmalige Kosten zum Kauf: Möblierung, Renovierung, Ablöse (€). */
  zusatzkosten?: number
  leerstandProzent?: number
  bewirtschaftungProzent?: number
  instandhaltungJeQm?: number
  /** Feste Kosten im Jahr, die der Eigentümer trägt (Versicherung, Erbbauzins …), €. */
  sonstigeKostenJahr?: number
  eigenkapital?: number
  zinsProzent?: number
  tilgungProzent?: number
}

export const EINGABE_FELDER: (keyof RenditeEingaben)[] = [
  'kaufpreis', 'flaeche', 'einheiten', 'miete', 'mieteArt', 'pacht', 'bundesland', 'grunderwerbsteuerProzent', 'notarGrundbuchProzent',
  'maklerProzent', 'zusatzkosten', 'leerstandProzent', 'bewirtschaftungProzent', 'instandhaltungJeQm', 'sonstigeKostenJahr', 'eigenkapital',
  'zinsProzent', 'tilgungProzent',
]

/** Mit allen Vorgaben aufgefüllte Eingaben, so wie gerechnet wurde. */
export type VerwendeteEingaben = {
  kaufpreis: number
  flaeche: number | null
  einheiten: number | null
  jahresmieteSoll: number | null
  pacht: boolean
  bundesland: Bundesland
  grunderwerbsteuerProzent: number
  notarGrundbuchProzent: number
  maklerProzent: number
  zusatzkosten: number
  leerstandProzent: number
  bewirtschaftungProzent: number
  instandhaltungJeQm: number
  sonstigeKostenJahr: number
  finanziert: boolean
  eigenkapital: number
  zinsProzent: number
  tilgungProzent: number
}

export type RenditeErgebnis = {
  kaufpreis: number
  grunderwerbsteuerProzent: number
  grunderwerbsteuer: number
  notarGrundbuch: number
  makler: number
  zusatzkosten: number
  nebenkosten: number
  /** Nebenkosten in % des Kaufpreises. */
  nebenkostenProzent: number
  gesamtinvestition: number
  kaufpreisJeQm: number | null
  gesamtJeQm: number | null
  kaufpreisJeEinheit: number | null
  jahresmieteSoll: number | null
  mieteJeQmMonat: number | null
  mieteJeEinheitMonat: number | null
  faktor: number | null
  bruttorendite: number | null
  mietausfall: number | null
  bewirtschaftung: number | null
  instandhaltung: number
  sonstigeKosten: number
  kostenJahr: number | null
  reinertrag: number | null
  nettorendite: number | null
  finanziert: boolean
  eigenkapital: number
  darlehen: number
  zinsProzent: number
  tilgungProzent: number
  zinsJahr: number
  tilgungJahr: number
  kapitaldienstJahr: number
  cashflowJahr: number | null
  cashflowMonat: number | null
  ekRendite: number | null
  cashflowRendite: number | null
  schuldendienstdeckung: number | null
  breakEvenMieteJahr: number | null
  breakEvenMieteJeQmMonat: number | null
  /** Break-even-Miete in % der heutigen Sollmiete (unter 100 = Puffer). */
  breakEvenAnteil: number | null
  /** Welche Vorgaben statt eigener Angaben verwendet wurden — in Klartext. */
  annahmen: string[]
  /** Was für eine vollständige Rechnung noch fehlt. */
  fehlt: string[]
}

// ─── Zahlen lesen ────────────────────────────────────────────────────────────────────────────────

/** Liest deutsche und gemischte Schreibweisen: 1.200.000 · 1200000 · 12,50 · 1,2 Mio · "590 m²" · "ca. 2.033 €".
 *  undefined, wenn keine Zahl erkennbar ist. */
export function leseZahl(wert: unknown): number | undefined {
  if (typeof wert === 'number') return Number.isFinite(wert) ? wert : undefined
  if (typeof wert !== 'string') return undefined
  const t = wert.trim().toLowerCase()
  if (!t) return undefined
  const m = t.match(/-?\d[\d.,' ]*/)
  if (!m) return undefined
  let roh = m[0].replace(/[' ]/g, '').replace(/[.,]$/, '')
  const komma = roh.lastIndexOf(',')
  const punkt = roh.lastIndexOf('.')
  if (komma >= 0 && punkt >= 0) {
    // Das zuletzt stehende Zeichen ist das Dezimalzeichen.
    roh = komma > punkt ? roh.replace(/\./g, '').replace(',', '.') : roh.replace(/,/g, '')
  } else if (komma >= 0) {
    // Nur Kommas: „1,2“ / „12,50“ = Dezimal; „1,200,000“ = Tausender.
    roh = (roh.match(/,/g) ?? []).length > 1 ? roh.replace(/,/g, '') : roh.replace(',', '.')
  } else if (punkt >= 0) {
    // Nur Punkte: „1.200.000“ oder „1.200“ (genau drei Ziffern dahinter) = Tausender, sonst Dezimal („3.57“).
    const teile = roh.split('.')
    roh = teile.length > 2 || teile[teile.length - 1].length === 3 ? roh.replace(/\./g, '') : roh
  }
  let n = Number(roh)
  if (!Number.isFinite(n)) return undefined
  const rest = t.slice((m.index ?? 0) + m[0].length)
  if (/^\s*(mio|millionen)/.test(rest)) n *= 1_000_000
  else if (/^\s*(tsd|tausend|t€|k\b)/.test(rest)) n *= 1_000
  return n
}

/** Prozentsatz aus Text („3,57 % inkl. MwSt.“ → 3.57). */
export function leseProzent(wert: unknown): number | undefined {
  const n = leseZahl(wert)
  return n !== undefined && n >= 0 && n <= 100 ? n : undefined
}

const ZAHL = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)`

/** Käufer- bzw. Maklerprovision aus freiem Text (Verlauf, Notiz), z. B. „zzgl. 3,57 % Käuferprovision“. */
export function findeProvision(text: string): number | undefined {
  const t = String(text ?? '')
  const vorne = t.match(new RegExp(String.raw`(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:inkl\.?\s*(?:der\s*)?(?:gesetzl\.?\s*)?(?:mwst|ust)\.?\s*)?(?:käufer|kaeufer|makler)?[\s-]*(?:provision|courtage)`, 'i'))
  if (vorne) return leseProzent(vorne[1])
  const hinten = t.match(/(?:käufer|kaeufer|makler)?(?:provision|courtage)[^%\d]{0,30}(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i)
  return hinten ? leseProzent(hinten[1]) : undefined
}

/** Fläche aus freiem Text: „ca. 590 m² Hotelfläche“, „Wohnfläche 240 qm“. Grundstücksflächen zählen nicht. */
export function findeFlaeche(text: string): number | undefined {
  const t = String(text ?? '')
  const muster = new RegExp(String.raw`${ZAHL}\s*(?:m²|m2|qm)(?![\w/])`, 'gi')
  for (const m of t.matchAll(muster)) {
    const vor = t.slice(Math.max(0, (m.index ?? 0) - 30), m.index).toLowerCase()
    const nach = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 20).toLowerCase()
    // Preise je m² („2.100 €/m²“) erreichen das Muster nicht; Grundstück und Preise davor aussortieren.
    if (/grundst|€\s*$|euro\s*$/.test(vor)) continue
    if (/^\s*grundst/.test(nach)) continue
    const n = leseZahl(m[1])
    if (n && n >= 15 && n <= 200_000) return n
  }
  return undefined
}

/** Anzahl Einheiten aus freiem Text: „15 Appartements“, „8 Wohneinheiten“. */
export function findeEinheiten(text: string): number | undefined {
  const m = String(text ?? '').match(/\b(\d{1,4})\s*(?:appartements?|apartments?|wohneinheiten|einheiten|wohnungen|we\b|zimmer)/i)
  const n = m ? Number(m[1]) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Bundesland nur aus eindeutigen Postleitzahl-Bereichen (BW: 70–75, 77–79; BY: 80–87, 90–96). Grenzgebiete
 *  wie 88/89 (Ulm/Neu-Ulm) oder 76/97 bleiben offen — dann gilt die Vorgabe und steht als Annahme da. */
export function bundeslandAusAdresse(adresse: unknown): Bundesland | undefined {
  const plz = String(adresse ?? '').match(/\b(\d{5})\b/)?.[1]
  if (!plz) return undefined
  const z = Number(plz.slice(0, 2))
  if ((z >= 70 && z <= 75) || (z >= 77 && z <= 79)) return 'BW'
  if ((z >= 80 && z <= 87) || (z >= 90 && z <= 96)) return 'BY'
  return undefined
}

// ─── Rechnen ─────────────────────────────────────────────────────────────────────────────────────

const positiv = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined)
const nichtNegativ = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined)

/** Sollmiete im Jahr aus Betrag und Einheit. null, wenn die Angabe fehlt oder sich ohne Fläche nicht umrechnen lässt. */
export function jahresmiete(miete: number | undefined, art: MieteArt | undefined, flaeche: number | undefined): number | null {
  const betrag = positiv(miete)
  if (!betrag) return null
  const a = art ?? 'qm_monat'
  if (a === 'jahr') return betrag
  if (a === 'monat') return betrag * 12
  const f = positiv(flaeche)
  return f ? betrag * f * 12 : null
}

/** Füllt die Eingaben mit den Vorgaben auf und notiert jede verwendete Vorgabe. */
export function vervollstaendige(e: RenditeEingaben): { v: VerwendeteEingaben; annahmen: string[]; fehlt: string[] } {
  const annahmen: string[] = []
  const fehlt: string[] = []
  const kaufpreis = positiv(e.kaufpreis) ?? 0
  if (!kaufpreis) fehlt.push('Kaufpreis')
  const flaeche = positiv(e.flaeche) ?? null
  if (!flaeche) fehlt.push('Fläche')
  const einheiten = positiv(e.einheiten) ?? null
  const jahresmieteSoll = jahresmiete(e.miete, e.mieteArt, flaeche ?? undefined)
  if (jahresmieteSoll === null) fehlt.push(positiv(e.miete) && (e.mieteArt ?? 'qm_monat') === 'qm_monat' ? 'Fläche für die Miete je m²' : e.pacht ? 'Pacht' : 'Miete oder Pacht')

  const bundesland = e.bundesland && GRUNDERWERBSTEUER[e.bundesland] ? e.bundesland : RENDITE_VORGABEN.bundesland
  let grunderwerbsteuerProzent = nichtNegativ(e.grunderwerbsteuerProzent)
  if (grunderwerbsteuerProzent === undefined) {
    grunderwerbsteuerProzent = GRUNDERWERBSTEUER[bundesland].prozent
    annahmen.push(`Grunderwerbsteuer ${prozentText(grunderwerbsteuerProzent, 1)} (${GRUNDERWERBSTEUER[bundesland].name}${e.bundesland ? '' : ', Bundesland angenommen'})`)
  }
  const mitVorgabe = <K extends keyof typeof RENDITE_VORGABEN>(wert: number | undefined, schluessel: K, text: (n: number) => string): number => {
    const n = nichtNegativ(wert)
    if (n !== undefined) return n
    const vorgabe = RENDITE_VORGABEN[schluessel] as number
    const t = text(vorgabe)
    if (t) annahmen.push(t)
    return vorgabe
  }
  const notarGrundbuchProzent = mitVorgabe(e.notarGrundbuchProzent, 'notarGrundbuchProzent', (n) => `Notar und Grundbuch ${prozentText(n, 1)} des Kaufpreises`)
  const maklerProzent = mitVorgabe(e.maklerProzent, 'maklerProzent', () => 'keine Maklerprovision angegeben')
  const zusatzkosten = mitVorgabe(e.zusatzkosten, 'zusatzkosten', () => '')
  const leerstandProzent = mitVorgabe(e.leerstandProzent, 'leerstandProzent', (n) => `Mietausfall/Leerstand ${prozentText(n, 0)}`)
  const bewirtschaftungProzent = mitVorgabe(e.bewirtschaftungProzent, 'bewirtschaftungProzent', (n) => `nicht umlagefähige Kosten ${prozentText(n, 0)} der Miete`)
  const instandhaltungJeQm = mitVorgabe(e.instandhaltungJeQm, 'instandhaltungJeQm', (n) => `Instandhaltung ${zahlText(n)} € je m² und Jahr`)
  const sonstigeKostenJahr = mitVorgabe(e.sonstigeKostenJahr, 'sonstigeKostenJahr', () => '')

  // Finanzierung nur, wenn mindestens eine ihrer Angaben gemacht wurde; sonst ganz aus eigenem Geld.
  const finanziert = nichtNegativ(e.eigenkapital) !== undefined || positiv(e.zinsProzent) !== undefined || positiv(e.tilgungProzent) !== undefined
  const nebenkosten = kaufpreis * (grunderwerbsteuerProzent + notarGrundbuchProzent + maklerProzent) / 100
  const gesamt = kaufpreis + nebenkosten + zusatzkosten
  let eigenkapital = gesamt
  let zinsProzent = 0
  let tilgungProzent = 0
  if (finanziert) {
    const ek = nichtNegativ(e.eigenkapital)
    if (ek === undefined) {
      eigenkapital = nebenkosten + zusatzkosten + (kaufpreis * RENDITE_VORGABEN.eigenkapitalAnteilKaufpreis) / 100
      annahmen.push(`Eigenkapital = Nebenkosten + ${RENDITE_VORGABEN.eigenkapitalAnteilKaufpreis} % des Kaufpreises`)
    } else eigenkapital = Math.min(ek, gesamt)
    zinsProzent = positiv(e.zinsProzent) ?? (annahmen.push(`Zins ${prozentText(RENDITE_VORGABEN.zinsProzent, 1)}`), RENDITE_VORGABEN.zinsProzent)
    tilgungProzent = nichtNegativ(e.tilgungProzent) ?? (annahmen.push(`anfängliche Tilgung ${prozentText(RENDITE_VORGABEN.tilgungProzent, 0)}`), RENDITE_VORGABEN.tilgungProzent)
  }
  return {
    v: {
      kaufpreis, flaeche, einheiten, jahresmieteSoll, pacht: e.pacht === true, bundesland, grunderwerbsteuerProzent, notarGrundbuchProzent, maklerProzent,
      zusatzkosten, leerstandProzent, bewirtschaftungProzent, instandhaltungJeQm, sonstigeKostenJahr, finanziert, eigenkapital, zinsProzent, tilgungProzent,
    },
    annahmen,
    fehlt,
  }
}

/** Die eigentliche Rechnung auf vollständigen Eingaben (Formeln siehe Kopf der Datei). */
export function rechne(v: VerwendeteEingaben): Omit<RenditeErgebnis, 'annahmen' | 'fehlt'> {
  const kp = v.kaufpreis
  // Kaufnebenkosten
  const grunderwerbsteuer = (kp * v.grunderwerbsteuerProzent) / 100
  const notarGrundbuch = (kp * v.notarGrundbuchProzent) / 100
  const makler = (kp * v.maklerProzent) / 100
  const nebenkosten = grunderwerbsteuer + notarGrundbuch + makler
  const gesamtinvestition = kp + nebenkosten + v.zusatzkosten
  // Preis je m² und je Einheit
  const kaufpreisJeQm = v.flaeche && kp ? kp / v.flaeche : null
  const gesamtJeQm = v.flaeche && kp ? gesamtinvestition / v.flaeche : null
  const kaufpreisJeEinheit = v.einheiten && kp ? kp / v.einheiten : null
  // Miete
  const soll = v.jahresmieteSoll
  const mieteJeQmMonat = soll !== null && v.flaeche ? soll / 12 / v.flaeche : null
  const mieteJeEinheitMonat = soll !== null && v.einheiten ? soll / 12 / v.einheiten : null
  const faktor = soll && kp ? kp / soll : null
  const bruttorendite = soll !== null && kp ? (soll / kp) * 100 : null
  // Laufende Kosten und Reinertrag
  const instandhaltung = (v.flaeche ?? 0) * v.instandhaltungJeQm
  const sonstigeKosten = v.sonstigeKostenJahr
  const mietausfall = soll !== null ? (soll * v.leerstandProzent) / 100 : null
  const bewirtschaftung = soll !== null ? (soll * v.bewirtschaftungProzent) / 100 : null
  const kostenJahr = soll !== null ? mietausfall! + bewirtschaftung! + instandhaltung + sonstigeKosten : null
  const reinertrag = soll !== null ? soll - kostenJahr! : null
  const nettorendite = reinertrag !== null && gesamtinvestition > 0 ? (reinertrag / gesamtinvestition) * 100 : null
  // Finanzierung
  const eigenkapital = v.finanziert ? Math.min(v.eigenkapital, gesamtinvestition) : gesamtinvestition
  const darlehen = v.finanziert ? Math.max(0, gesamtinvestition - eigenkapital) : 0
  const zinsJahr = (darlehen * v.zinsProzent) / 100
  const tilgungJahr = (darlehen * v.tilgungProzent) / 100
  const kapitaldienstJahr = zinsJahr + tilgungJahr
  const cashflowJahr = reinertrag !== null ? reinertrag - kapitaldienstJahr : null
  const cashflowMonat = cashflowJahr !== null ? cashflowJahr / 12 : null
  const ekRendite = reinertrag !== null && eigenkapital > 0 ? ((reinertrag - zinsJahr) / eigenkapital) * 100 : null
  const cashflowRendite = cashflowJahr !== null && eigenkapital > 0 ? (cashflowJahr / eigenkapital) * 100 : null
  const schuldendienstdeckung = reinertrag !== null && kapitaldienstJahr > 0 ? reinertrag / kapitaldienstJahr : null
  // Break-even: Sollmiete, bei der der Cashflow 0 ist.
  const anteilVariabel = 1 - (v.leerstandProzent + v.bewirtschaftungProzent) / 100
  const breakEvenMieteJahr = anteilVariabel > 0 && kp ? (instandhaltung + sonstigeKosten + kapitaldienstJahr) / anteilVariabel : null
  const breakEvenMieteJeQmMonat = breakEvenMieteJahr !== null && v.flaeche ? breakEvenMieteJahr / 12 / v.flaeche : null
  const breakEvenAnteil = breakEvenMieteJahr !== null && soll ? (breakEvenMieteJahr / soll) * 100 : null
  return {
    kaufpreis: kp,
    grunderwerbsteuerProzent: v.grunderwerbsteuerProzent,
    grunderwerbsteuer,
    notarGrundbuch,
    makler,
    zusatzkosten: v.zusatzkosten,
    nebenkosten,
    nebenkostenProzent: kp ? (nebenkosten / kp) * 100 : 0,
    gesamtinvestition,
    kaufpreisJeQm,
    gesamtJeQm,
    kaufpreisJeEinheit,
    jahresmieteSoll: soll,
    mieteJeQmMonat,
    mieteJeEinheitMonat,
    faktor,
    bruttorendite,
    mietausfall,
    bewirtschaftung,
    instandhaltung,
    sonstigeKosten,
    kostenJahr,
    reinertrag,
    nettorendite,
    finanziert: v.finanziert && darlehen > 0,
    eigenkapital,
    darlehen,
    zinsProzent: v.zinsProzent,
    tilgungProzent: v.tilgungProzent,
    zinsJahr,
    tilgungJahr,
    kapitaldienstJahr,
    cashflowJahr,
    cashflowMonat,
    ekRendite,
    cashflowRendite,
    schuldendienstdeckung,
    breakEvenMieteJahr,
    breakEvenMieteJeQmMonat,
    breakEvenAnteil,
  }
}

/** Rendite-Check aus (teilweise) ausgefüllten Eingaben. */
export function berechneRendite(e: RenditeEingaben): RenditeErgebnis {
  const { v, annahmen, fehlt } = vervollstaendige(e)
  return { ...rechne(v), annahmen, fehlt }
}

export type EmpfindlichkeitsZeile = {
  /** Änderung der Miete in % bzw. des Zinses in Prozentpunkten. */
  aenderung: number
  jahresmieteSoll: number | null
  zinsProzent: number
  bruttorendite: number | null
  nettorendite: number | null
  cashflowMonat: number | null
  ekRendite: number | null
}

export type Empfindlichkeit = {
  /** Miete −10 %, heute, +10 %. */
  miete: EmpfindlichkeitsZeile[]
  /** Zins −1, heute, +1 Prozentpunkt — leer ohne Darlehen. */
  zins: EmpfindlichkeitsZeile[]
  /** Cashflow im Monat für jede Kombination (Zeilen Miete, Spalten Zins) — leer ohne Darlehen. */
  raster: { mieteAenderung: number; zinsAenderung: number; cashflowMonat: number | null }[]
}

export const MIETE_SCHRITTE = [-10, 0, 10]
export const ZINS_SCHRITTE = [-1, 0, 1]

/** Wie ändern sich die Ergebnisse, wenn Miete oder Zins anders kommen? (gleiche Rechnung, ein Wert verschoben) */
export function empfindlichkeit(e: RenditeEingaben): Empfindlichkeit {
  const { v } = vervollstaendige(e)
  const variante = (mieteAenderung: number, zinsAenderung: number, aenderung: number): EmpfindlichkeitsZeile => {
    const soll = v.jahresmieteSoll !== null ? v.jahresmieteSoll * (1 + mieteAenderung / 100) : null
    const zins = Math.max(0, v.zinsProzent + zinsAenderung)
    const r = rechne({ ...v, jahresmieteSoll: soll, zinsProzent: zins })
    return { aenderung, jahresmieteSoll: soll, zinsProzent: zins, bruttorendite: r.bruttorendite, nettorendite: r.nettorendite, cashflowMonat: r.cashflowMonat, ekRendite: r.ekRendite }
  }
  const mitDarlehen = rechne(v).darlehen > 0
  return {
    miete: MIETE_SCHRITTE.map((m) => variante(m, 0, m)),
    zins: mitDarlehen ? ZINS_SCHRITTE.map((z) => variante(0, z, z)) : [],
    raster: mitDarlehen ? MIETE_SCHRITTE.flatMap((m) => ZINS_SCHRITTE.map((z) => ({ mieteAenderung: m, zinsAenderung: z, cashflowMonat: variante(m, z, 0).cashflowMonat }))) : [],
  }
}

// ─── Marktvergleich ──────────────────────────────────────────────────────────────────────────────

export type RenditeQuelle = { titel: string; url: string; stand?: string }

/** Ergebnis der Webrecherche „Vergleich vor Ort prüfen“ (schreibt nur der Server, email-gateway/renditeMarkt.ts). */
export type RenditeMarkt = {
  status: 'laeuft' | 'fertig' | 'fehler'
  gestartetAm?: string
  gestartetVon?: string
  abgeschlossenAm?: string
  /** Wofür gesucht wurde (Objektart, Ort). */
  objektart?: string
  ort?: string
  preisJeQmVon?: number
  preisJeQmBis?: number
  preisJeQmMittel?: number
  /** Worauf sich die Preise beziehen, z. B. „Eigentumswohnungen Bestand Lorch“. */
  preisBezug?: string
  mieteJeQmVon?: number
  mieteJeQmBis?: number
  mieteJeQmMittel?: number
  /** z. B. „Pacht für Beherbergungsbetriebe, netto kalt je m² und Monat“. */
  mieteBezug?: string
  renditeVon?: number
  renditeBis?: number
  faktorVon?: number
  faktorBis?: number
  einschaetzung?: string
  hinweise?: string[]
  quellen?: RenditeQuelle[]
  /** Tag der Recherche (JJJJ-MM-TT). */
  stand?: string
  fehler?: string
}

export type Urteil = 'guenstig' | 'im_rahmen' | 'teuer' | 'niedrig' | 'hoch'

export type MarktVergleich = {
  preis?: { eigen: number; von?: number; bis?: number; mittel: number; abweichungProzent: number; urteil: 'guenstig' | 'im_rahmen' | 'teuer' }
  miete?: { eigen: number; von?: number; bis?: number; mittel: number; abweichungProzent: number; urteil: 'niedrig' | 'im_rahmen' | 'hoch' }
  /** Bruttorendite, wenn die Marktmiete (von/bis) erzielt wird. */
  renditeBeiMarktmiete?: { von: number | null; bis: number | null }
}

/** Mittelwert der Spanne: angegebenes Mittel, sonst (von + bis) ÷ 2, sonst der eine bekannte Wert. */
function mitte(von?: number, bis?: number, mittel?: number): number | undefined {
  if (positiv(mittel)) return mittel
  if (positiv(von) && positiv(bis)) return (von! + bis!) / 2
  return positiv(von) ?? positiv(bis)
}

/** Stellt den eigenen Preis je m² und die eigene Miete je m² der recherchierten Spanne gegenüber.
 *  Urteil: unter der Spanne (bzw. ≥ 10 % unter dem Mittel ohne Spanne) = günstig/niedrig, darüber = teuer/hoch. */
export function vergleicheMitMarkt(r: Pick<RenditeErgebnis, 'kaufpreisJeQm' | 'mieteJeQmMonat' | 'kaufpreis' | 'jahresmieteSoll'> & { flaeche?: number | null }, markt: RenditeMarkt | undefined | null): MarktVergleich {
  const aus: MarktVergleich = {}
  if (!markt || markt.status !== 'fertig') return aus
  const einordnen = (eigen: number, von?: number, bis?: number, m?: number) => {
    const abweichungProzent = m ? ((eigen - m) / m) * 100 : 0
    if (positiv(von) && eigen < von!) return { abweichungProzent, lage: -1 }
    if (positiv(bis) && eigen > bis!) return { abweichungProzent, lage: 1 }
    if (!positiv(von) && !positiv(bis)) return { abweichungProzent, lage: abweichungProzent <= -10 ? -1 : abweichungProzent >= 10 ? 1 : 0 }
    return { abweichungProzent, lage: 0 }
  }
  const pm = mitte(markt.preisJeQmVon, markt.preisJeQmBis, markt.preisJeQmMittel)
  if (r.kaufpreisJeQm && pm) {
    const e = einordnen(r.kaufpreisJeQm, markt.preisJeQmVon, markt.preisJeQmBis, pm)
    aus.preis = { eigen: r.kaufpreisJeQm, von: markt.preisJeQmVon, bis: markt.preisJeQmBis, mittel: pm, abweichungProzent: e.abweichungProzent, urteil: e.lage < 0 ? 'guenstig' : e.lage > 0 ? 'teuer' : 'im_rahmen' }
  }
  const mm = mitte(markt.mieteJeQmVon, markt.mieteJeQmBis, markt.mieteJeQmMittel)
  if (r.mieteJeQmMonat && mm) {
    const e = einordnen(r.mieteJeQmMonat, markt.mieteJeQmVon, markt.mieteJeQmBis, mm)
    aus.miete = { eigen: r.mieteJeQmMonat, von: markt.mieteJeQmVon, bis: markt.mieteJeQmBis, mittel: mm, abweichungProzent: e.abweichungProzent, urteil: e.lage < 0 ? 'niedrig' : e.lage > 0 ? 'hoch' : 'im_rahmen' }
  }
  // Bruttorendite bei Marktmiete = Marktmiete × Fläche × 12 ÷ Kaufpreis × 100
  const flaeche = positiv(r.flaeche ?? undefined) ?? (r.kaufpreisJeQm ? r.kaufpreis / r.kaufpreisJeQm : undefined)
  if (flaeche && r.kaufpreis > 0 && (positiv(markt.mieteJeQmVon) || positiv(markt.mieteJeQmBis))) {
    const br = (m?: number) => (positiv(m) ? ((m! * flaeche * 12) / r.kaufpreis) * 100 : null)
    aus.renditeBeiMarktmiete = { von: br(markt.mieteJeQmVon), bis: br(markt.mieteJeQmBis) }
  }
  return aus
}

// ─── Prüfsteine ──────────────────────────────────────────────────────────────────────────────────

export const PRUEFSTEINE: { id: string; titel: string; hinweis: string }[] = [
  { id: 'genehmigung', titel: 'Genehmigung der Nutzung', hinweis: 'Ist die Nutzung (z. B. Beherbergung, Boarding House, Gewerbe) beim Bauamt dauerhaft genehmigt? Baugenehmigung und Nutzungsänderung anfordern.' },
  { id: 'brandschutz', titel: 'Brandschutz', hinweis: 'Fluchtwege, Brandmeldeanlage, Auflagen und letzte Abnahme — entspricht er dem heutigen Stand?' },
  { id: 'moeblierung', titel: 'Möblierung', hinweis: 'Ist die Möblierung im Kaufpreis enthalten, wem gehört sie, in welchem Zustand ist sie?' },
  { id: 'vertrag', titel: 'Miet- oder Pachtvertrag', hinweis: 'Laufzeit, Höhe, Anpassung an die Teuerung, wer trägt welche Kosten, wie zahlungsfähig ist der Mieter oder Pächter?' },
  { id: 'instandhaltungsstau', titel: 'Instandhaltungsstau', hinweis: 'Dach, Fassade, Fenster, Heizung, Haustechnik: was steht in den nächsten Jahren an und was kostet es?' },
]

export type PruefsteinStand = { erledigt: boolean; notiz?: string; am?: string; von?: string }

// ─── Gespeicherter Stand (objekte.rendite) ───────────────────────────────────────────────────────

export type RenditeStand = {
  version: 1
  eingaben?: RenditeEingaben
  /** Woher ein vorbefüllter Wert stammt, z. B. { flaeche: "Verlauf der Objektakte" }. */
  herkunft?: Partial<Record<keyof RenditeEingaben, string>>
  ergebnis?: RenditeErgebnis
  berechnetAm?: string
  berechnetVon?: string
  markt?: RenditeMarkt
  pruefsteine?: Record<string, PruefsteinStand>
}

/** Liest einen gespeicherten Stand tolerant (fremde Felder und falsche Typen fallen weg). */
export function leseRenditeStand(roh: unknown): RenditeStand {
  const o = roh && typeof roh === 'object' && !Array.isArray(roh) ? (roh as Record<string, unknown>) : {}
  const eingaben: RenditeEingaben = {}
  const e = o.eingaben && typeof o.eingaben === 'object' ? (o.eingaben as Record<string, unknown>) : {}
  for (const f of EINGABE_FELDER) {
    const w = e[f]
    if (f === 'mieteArt') {
      if (w === 'qm_monat' || w === 'monat' || w === 'jahr') eingaben.mieteArt = w
    } else if (f === 'bundesland') {
      if (typeof w === 'string' && w in GRUNDERWERBSTEUER) eingaben.bundesland = w as Bundesland
    } else if (f === 'pacht') {
      if (typeof w === 'boolean') eingaben.pacht = w
    } else if (typeof w === 'number' && Number.isFinite(w)) {
      ;(eingaben as Record<string, number>)[f] = w
    }
  }
  const pruefsteine: Record<string, PruefsteinStand> = {}
  if (o.pruefsteine && typeof o.pruefsteine === 'object') {
    for (const [id, p] of Object.entries(o.pruefsteine as Record<string, unknown>)) {
      if (!p || typeof p !== 'object') continue
      const q = p as Record<string, unknown>
      pruefsteine[id] = { erledigt: q.erledigt === true, ...(typeof q.notiz === 'string' ? { notiz: q.notiz } : {}), ...(typeof q.am === 'string' ? { am: q.am } : {}), ...(typeof q.von === 'string' ? { von: q.von } : {}) }
    }
  }
  return {
    version: 1,
    eingaben,
    herkunft: o.herkunft && typeof o.herkunft === 'object' ? (o.herkunft as RenditeStand['herkunft']) : {},
    ...(o.ergebnis && typeof o.ergebnis === 'object' ? { ergebnis: o.ergebnis as RenditeErgebnis } : {}),
    ...(typeof o.berechnetAm === 'string' ? { berechnetAm: o.berechnetAm } : {}),
    ...(typeof o.berechnetVon === 'string' ? { berechnetVon: o.berechnetVon } : {}),
    ...(o.markt && typeof o.markt === 'object' ? { markt: o.markt as RenditeMarkt } : {}),
    pruefsteine,
  }
}

/** Führt einen frisch gelesenen Stand mit einer Änderung zusammen: oberste Felder ersetzen, Prüfsteine je Eintrag.
 *  So überschreibt das Fenster nie den Marktvergleich des Servers und der Server nie die Prüfsteine. */
export function mischeRenditeStand(frisch: unknown, aenderung: Partial<RenditeStand>): RenditeStand {
  const alt = leseRenditeStand(frisch)
  const { pruefsteine, ...rest } = aenderung
  return { ...alt, ...rest, version: 1, pruefsteine: { ...(alt.pruefsteine ?? {}), ...(pruefsteine ?? {}) } }
}

// ─── Vorschlag aus den Daten der Objektakte ──────────────────────────────────────────────────────

/** Die Teile eines Objekts, aus denen vorbefüllt wird (Spalten wie in der Datenbank bzw. src/types Objekt). */
export type ObjektDatenFuerRendite = {
  kaufpreis?: number | string | null
  adresse?: string | null
  verkaufsdaten?: { kennzahlen?: Record<string, unknown>; uebersicht?: Record<string, unknown> } | null
  kurzpruefung?: { zeilen?: Record<string, { ist?: string }>; provisionProzent?: string } | null
  bewertung?: { kennzahlen?: { mieteProQm?: number } } | null
  activities?: { text?: string }[] | null
}

/** Schlägt Eingaben aus der Objektakte vor und nennt die Herkunft jedes Werts. Nur was dort wirklich steht:
 *  Verkaufsdatenblatt, Kurzprüfung (Ist-Spalte), Bewertung, sonst der Verlauf (z. B. „15 Appartements, ca. 590 m²“).
 *  Eine Marktmiete aus einer Einschätzung wird bewusst NICHT als Miete übernommen. */
export function vorschlagAusObjekt(o: ObjektDatenFuerRendite): { eingaben: RenditeEingaben; herkunft: Partial<Record<keyof RenditeEingaben, string>> } {
  const eingaben: RenditeEingaben = {}
  const herkunft: Partial<Record<keyof RenditeEingaben, string>> = {}
  const k = o.verkaufsdaten?.kennzahlen ?? {}
  const verlauf = (o.activities ?? []).map((a) => String(a?.text ?? '')).filter(Boolean)

  const kp = positiv(leseZahl(o.kaufpreis ?? undefined)) ?? positiv(leseZahl(k.kaufpreisvorstellung))
  if (kp) {
    eingaben.kaufpreis = kp
    herkunft.kaufpreis = positiv(leseZahl(o.kaufpreis ?? undefined)) ? 'Kaufpreis der Objektakte' : 'Verkaufsdatenblatt (Kaufpreisvorstellung)'
  }

  const wohn = positiv(leseZahl(k.wohnflaeche))
  const nutz = positiv(leseZahl(k.nutzflaeche))
  if (wohn || nutz) {
    eingaben.flaeche = (wohn ?? 0) + (nutz ?? 0)
    herkunft.flaeche = wohn && nutz ? 'Verkaufsdatenblatt (Wohn- und Nutzfläche zusammen)' : wohn ? 'Verkaufsdatenblatt (Wohnfläche)' : 'Verkaufsdatenblatt (Nutzfläche)'
  } else {
    for (const t of verlauf) {
      const f = findeFlaeche(t)
      if (f) {
        eingaben.flaeche = f
        herkunft.flaeche = 'Verlauf der Objektakte'
        break
      }
    }
  }

  const einheiten = positiv(leseZahl(k.einheiten))
  if (einheiten) {
    eingaben.einheiten = Math.round(einheiten)
    herkunft.einheiten = 'Verkaufsdatenblatt'
  } else {
    for (const t of verlauf) {
      const n = findeEinheiten(t)
      if (n) {
        eingaben.einheiten = n
        herkunft.einheiten = 'Verlauf der Objektakte'
        break
      }
    }
  }

  const jnkm = positiv(leseZahl(k.jahresnettokaltmiete))
  const mieteKurz = positiv(leseZahl(o.kurzpruefung?.zeilen?.mieteProQm?.ist))
  const mieteBew = positiv(o.bewertung?.kennzahlen?.mieteProQm)
  if (jnkm) {
    eingaben.miete = jnkm
    eingaben.mieteArt = 'jahr'
    herkunft.miete = 'Verkaufsdatenblatt (Jahresnettokaltmiete)'
  } else if (mieteKurz) {
    eingaben.miete = mieteKurz
    eingaben.mieteArt = 'qm_monat'
    herkunft.miete = 'Kurzprüfung (Miete pro m², Ist)'
  } else if (mieteBew) {
    eingaben.miete = mieteBew
    eingaben.mieteArt = 'qm_monat'
    herkunft.miete = 'Bewertung (Miete pro m²)'
  }

  const provKurz = leseProzent(o.kurzpruefung?.provisionProzent)
  if (provKurz !== undefined && provKurz > 0) {
    eingaben.maklerProzent = provKurz
    herkunft.maklerProzent = 'Kurzprüfung (Provision)'
  } else {
    for (const t of verlauf) {
      const p = findeProvision(t)
      if (p !== undefined && p > 0) {
        eingaben.maklerProzent = p
        herkunft.maklerProzent = 'Verlauf der Objektakte'
        break
      }
    }
  }

  const adresse = [o.verkaufsdaten?.uebersicht?.plzOrt, o.adresse].filter(Boolean).join(' ')
  const land = bundeslandAusAdresse(adresse)
  if (land) {
    eingaben.bundesland = land
    herkunft.bundesland = 'Postleitzahl der Adresse'
  }
  return { eingaben, herkunft }
}

// ─── Darstellung (Deutsch) ───────────────────────────────────────────────────────────────────────

export function zahlText(n: number | null | undefined, stellen = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(n)
}
export function euroText(n: number | null | undefined, stellen = 0): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '–' : `${zahlText(n, stellen)} €`
}
export function prozentText(n: number | null | undefined, stellen = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '–' : `${zahlText(n, stellen)} %`
}
export function vorzeichen(n: number, text: string): string {
  return n > 0 ? `+${text}` : text
}

const URTEIL_TEXT: Record<Urteil, string> = { guenstig: 'günstig', im_rahmen: 'im üblichen Rahmen', teuer: 'teuer', niedrig: 'niedrig', hoch: 'hoch' }
export function urteilText(u: Urteil): string {
  return URTEIL_TEXT[u]
}

/** Kurzfassung in wenigen Zeilen, z. B. für Telegram. */
export function renditeKurzfassung(r: RenditeErgebnis, markt?: RenditeMarkt | null, e?: RenditeEingaben): string {
  const z: string[] = []
  const pachtWort = e?.pacht ? 'Pacht' : 'Miete'
  z.push(`Kaufpreis ${euroText(r.kaufpreis)}${r.kaufpreisJeQm ? ` (${euroText(r.kaufpreisJeQm)}/m²)` : ''}, Nebenkosten ${euroText(r.nebenkosten)} (${prozentText(r.nebenkostenProzent, 2)}), Gesamt ${euroText(r.gesamtinvestition)}.`)
  if (r.jahresmieteSoll !== null) {
    z.push(`${pachtWort} ${euroText(r.jahresmieteSoll)} im Jahr${r.mieteJeQmMonat ? ` (${euroText(r.mieteJeQmMonat, 2)}/m² im Monat)` : ''} → Faktor ${zahlText(r.faktor, 1)}, Bruttorendite ${prozentText(r.bruttorendite)}, Nettorendite ${prozentText(r.nettorendite)}.`)
    z.push(
      r.finanziert
        ? `Mit Darlehen ${euroText(r.darlehen)} (${prozentText(r.zinsProzent, 2)} Zins, ${prozentText(r.tilgungProzent, 1)} Tilgung): Cashflow vor Steuern ${euroText(r.cashflowMonat)} im Monat, Eigenkapitalrendite ${prozentText(r.ekRendite)} auf ${euroText(r.eigenkapital)}.`
        : `Ohne Darlehen gerechnet: Reinertrag ${euroText(r.reinertrag)} im Jahr (${euroText(r.cashflowMonat)} im Monat).`,
    )
    if (r.breakEvenMieteJeQmMonat !== null) z.push(`Break-even-${pachtWort}: ${euroText(r.breakEvenMieteJeQmMonat, 2)}/m² im Monat (${prozentText(r.breakEvenAnteil, 0)} der heutigen).`)
  }
  const vgl = vergleicheMitMarkt(r, markt)
  if (vgl.preis) z.push(`Vor Ort: ${euroText(vgl.preis.von)}–${euroText(vgl.preis.bis)}/m² → Preis ${urteilText(vgl.preis.urteil)} (${vorzeichen(vgl.preis.abweichungProzent, prozentText(vgl.preis.abweichungProzent, 0))} zum Mittel).`)
  if (vgl.miete) z.push(`Marktmiete ${euroText(vgl.miete.von, 2)}–${euroText(vgl.miete.bis, 2)}/m² → eigene ${pachtWort} ${urteilText(vgl.miete.urteil)}.`)
  else if (vgl.renditeBeiMarktmiete) z.push(`Bei Marktmiete ${euroText(markt?.mieteJeQmVon, 2)}–${euroText(markt?.mieteJeQmBis, 2)}/m²: Bruttorendite ${prozentText(vgl.renditeBeiMarktmiete.von)}–${prozentText(vgl.renditeBeiMarktmiete.bis)}.`)
  if (r.fehlt.length) z.push(`Fehlt noch: ${r.fehlt.join(', ')}.`)
  if (r.annahmen.length) z.push(`Annahmen: ${r.annahmen.join('; ')}.`)
  return z.join('\n')
}

/** Ausführliche Fassung mit Tabellen in der einfachen Auszeichnung („## “, „| a | b |“) — für das PDF. */
export function renditeBericht(titel: string, e: RenditeEingaben, r: RenditeErgebnis, markt?: RenditeMarkt | null, pruefsteine?: Record<string, PruefsteinStand>): string {
  const pachtWort = e.pacht ? 'Pacht' : 'Miete'
  const t: string[] = []
  t.push(`Überschlagsrechnung vor Steuern für „${titel}“ — kein Gutachten. Vorgaben, die nicht aus der Akte stammen, stehen unter „Annahmen“.`, '')
  t.push('## Kaufpreis und Nebenkosten', '| Posten | Betrag |', '|---|---|')
  t.push(`| Kaufpreis | ${euroText(r.kaufpreis)} |`)
  t.push(`| Grunderwerbsteuer (${prozentText(r.grunderwerbsteuerProzent, 1)}) | ${euroText(r.grunderwerbsteuer)} |`)
  t.push(`| Notar und Grundbuch | ${euroText(r.notarGrundbuch)} |`)
  t.push(`| Makler | ${euroText(r.makler)} |`)
  if (r.zusatzkosten) t.push(`| Zusatzkosten (Möblierung, Renovierung) | ${euroText(r.zusatzkosten)} |`)
  t.push(`| **Gesamtinvestition** | **${euroText(r.gesamtinvestition)}** |`, '')
  t.push('## Kennzahlen', '| Kennzahl | Wert |', '|---|---|')
  t.push(`| Kaufpreis je m² | ${r.kaufpreisJeQm ? euroText(r.kaufpreisJeQm) : '–'} |`)
  t.push(`| Kaufpreis je Einheit | ${r.kaufpreisJeEinheit ? euroText(r.kaufpreisJeEinheit) : '–'} |`)
  t.push(`| ${pachtWort} im Jahr (soll) | ${euroText(r.jahresmieteSoll)} |`)
  t.push(`| ${pachtWort} je m² im Monat | ${euroText(r.mieteJeQmMonat, 2)} |`)
  t.push(`| Kaufpreisfaktor | ${zahlText(r.faktor, 1)} |`)
  t.push(`| Bruttorendite | ${prozentText(r.bruttorendite)} |`)
  t.push(`| Laufende Kosten im Jahr | ${euroText(r.kostenJahr)} |`)
  t.push(`| Reinertrag im Jahr | ${euroText(r.reinertrag)} |`)
  t.push(`| Nettorendite | ${prozentText(r.nettorendite)} |`)
  if (r.finanziert) {
    t.push(`| Eigenkapital | ${euroText(r.eigenkapital)} |`)
    t.push(`| Darlehen (${prozentText(r.zinsProzent, 2)} Zins, ${prozentText(r.tilgungProzent, 1)} Tilgung) | ${euroText(r.darlehen)} |`)
    t.push(`| Kapitaldienst im Jahr | ${euroText(r.kapitaldienstJahr)} |`)
  }
  t.push(`| Cashflow vor Steuern im Monat | ${euroText(r.cashflowMonat)} |`)
  t.push(`| Eigenkapitalrendite | ${prozentText(r.ekRendite)} |`)
  t.push(`| Break-even-${pachtWort} je m² im Monat | ${euroText(r.breakEvenMieteJeQmMonat, 2)} |`, '')
  const em = empfindlichkeit(e)
  if (r.jahresmieteSoll !== null) {
    t.push('## Empfindlichkeit', `| ${pachtWort} | Bruttorendite | Nettorendite | Cashflow im Monat | Eigenkapitalrendite |`, '|---|---|---|---|---|')
    for (const z of em.miete) t.push(`| ${z.aenderung === 0 ? 'wie angesetzt' : `${vorzeichen(z.aenderung, String(z.aenderung))} %`} | ${prozentText(z.bruttorendite)} | ${prozentText(z.nettorendite)} | ${euroText(z.cashflowMonat)} | ${prozentText(z.ekRendite)} |`)
    if (em.zins.length) {
      t.push('', '| Zins | Cashflow im Monat | Eigenkapitalrendite |', '|---|---|---|')
      for (const z of em.zins) t.push(`| ${prozentText(z.zinsProzent, 2)}${z.aenderung === 0 ? ' (angesetzt)' : ''} | ${euroText(z.cashflowMonat)} | ${prozentText(z.ekRendite)} |`)
    }
    t.push('')
  }
  if (markt?.status === 'fertig') {
    const vgl = vergleicheMitMarkt({ ...r, flaeche: e.flaeche }, markt)
    t.push(`## Vergleich vor Ort (Recherche vom ${datumText(markt.stand)})`)
    if (markt.preisJeQmVon || markt.preisJeQmBis) t.push(`- Preise je m²${markt.preisBezug ? ` (${markt.preisBezug})` : ''}: ${euroText(markt.preisJeQmVon)} bis ${euroText(markt.preisJeQmBis)}${vgl.preis ? ` — eigener Preis ${urteilText(vgl.preis.urteil)}` : ''}`)
    if (markt.mieteJeQmVon || markt.mieteJeQmBis) t.push(`- Miete/Pacht je m² im Monat${markt.mieteBezug ? ` (${markt.mieteBezug})` : ''}: ${euroText(markt.mieteJeQmVon, 2)} bis ${euroText(markt.mieteJeQmBis, 2)}`)
    if (vgl.renditeBeiMarktmiete) t.push(`- Bruttorendite bei Marktmiete: ${prozentText(vgl.renditeBeiMarktmiete.von)} bis ${prozentText(vgl.renditeBeiMarktmiete.bis)}`)
    if (markt.einschaetzung) t.push('', markt.einschaetzung)
    if (markt.quellen?.length) t.push('', 'Quellen:', ...markt.quellen.slice(0, 10).map((q) => `- ${q.titel}: ${q.url}${q.stand ? ` (Stand ${q.stand})` : ''}`))
    t.push('')
  }
  t.push('## Prüfsteine')
  for (const p of PRUEFSTEINE) {
    const s = pruefsteine?.[p.id]
    t.push(`- ${s?.erledigt ? '[geklärt]' : '[offen]'} ${p.titel}${s?.notiz ? `: ${s.notiz}` : ''}`)
  }
  if (r.annahmen.length || r.fehlt.length) {
    t.push('', '## Annahmen')
    for (const a of r.annahmen) t.push(`- ${a}`)
    if (r.fehlt.length) t.push(`- Fehlt noch: ${r.fehlt.join(', ')}`)
  }
  return t.join('\n')
}

function datumText(iso?: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '–'
}
