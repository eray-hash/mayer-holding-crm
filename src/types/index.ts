// Zentrale Typdefinitionen für das Mayer Holding CRM

export type Bereich = 'beratung' | 'immobilien' | 'erben' | 'betriebsuebergabe' | 'betriebsformen'

export type Prioritaet = 'Hoch' | 'Mittel' | 'Niedrig'

export type StatusNode = {
  id: string
  label: string
  color: string // Tailwind-Klassen für Badge (bg/text)
  isTerminal: boolean
  isMainPath: boolean
  next: string[]
}

export type FollowUp = {
  date: string // ISO yyyy-mm-dd
  note: string
  done: boolean
}

export type ActivityEntry = {
  id: string
  date: string // ISO
  text: string
  user: string
}

// ---------- Beratung ----------

export type RechnungStatus = 'Entwurf' | 'Versendet' | 'Bezahlt' | 'Überfällig'

export type Rechnung = {
  id: string
  nummer: string
  kundeId: string
  datum: string
  betragNetto: number
  betragBrutto: number
  status: RechnungStatus
  zahlungsziel: string
  mahnstufe?: MahnstufeId
}

export type MahnstufeId = 'erinnerung' | 'mahnung1' | 'mahnung2' | 'inkasso'

export type Protokoll = {
  id: string
  kundeId: string
  datum: string
  teilnehmer: string
  betreff: string
  text: string
}

export type Konzept = {
  id: string
  kundeId: string
  datum: string
  titel: string
  version: string
  status: string
}

export type Beratungsvertrag = {
  id: string
  kundeId: string
  vertragsnr: string
  datum: string
  laufzeit: string
  volumen: number
  datei: string
}

export type Kunde = {
  id: string
  firma: string
  ansprechpartner: string
  email: string
  telefon: string
  prioritaet: Prioritaet
  status: string // StatusNode id (Beratungsnetz)
  followUp: FollowUp
  verantwortlich: string
  letzteAktivitaet: string
  activities: ActivityEntry[]
  unterlagenCheckliste?: Record<string, boolean>
}

export type Vorlage = {
  id: string
  kategorie: 'vollmacht' | 'schreiben' | 'vertraege'
  name: string
  typ: string
  zuletztGeaendert: string
  text: string
}

// ---------- Immobilien ----------

export type ObjektGruppe =
  | 'aktuell'
  | 'ausland'
  | 'verkauf-intern'
  | 'verkauf-extern'
  | 'projektierung'

export type ObjektTyp = 'Wohnung' | 'Haus' | 'Grundstück' | 'Gewerbe' | 'Neubauprojekt'

export const DOKUMENT_ORDNER = [
  'Aktennotiz',
  'Angebote',
  'Bilder',
  'Energieausweis',
  'Exposé',
  'Finanzierung',
  'Genehmigung',
  'Grundbuch',
  'Grundrisse',
  'Gutachten',
  'Kostenaufstellung',
  'Lageplan',
  'Leistungsverzeichnisse',
  'Mietverträge',
  'Notarielle Dokumente',
  'Persönliche Daten des Eigentümers',
  'Pläne',
  'Sanierungsunterlagen',
  'Sonstiges',
  'Verträge',
] as const

export type DokumentOrdnerName = (typeof DOKUMENT_ORDNER)[number]

export type Dokument = {
  id: string
  name: string
  typ: string
  datum: string
  groesse: string
}

export type FinanzierungStatus = 'Angefragt' | 'In Prüfung' | 'Zugesagt' | 'Abgelehnt' | 'Ausgezahlt'

export type Finanzierung = {
  id: string
  objektId: string
  bank: string
  darlehenssumme: number
  zinssatz: number
  laufzeit: string
  status: FinanzierungStatus
  ansprechpartner: string
}

export type Objekt = {
  id: string
  bezeichnung: string
  adresse: string
  gruppe: ObjektGruppe
  typ: ObjektTyp
  kaufpreis: number
  prioritaet: Prioritaet
  status: string // StatusNode id (Immobiliennetz)
  followUp: FollowUp
  verantwortlich: string
  activities: ActivityEntry[]
  dokumente: Partial<Record<DokumentOrdnerName, Dokument[]>>
}

// ---------- Investorenportal (Investitionsfonds) ----------

export type FondsZeichnungStatus = 'Zeichnung eingegangen' | 'Kapital eingezahlt' | 'Allokiert' | 'Aktiv'

export type FondsZeichnung = {
  id: string
  investorId: string
  betrag: number
  datum: string
  laufzeitJahre: number
  status: FondsZeichnungStatus
}

export type FondsAusschuettungStatus = 'Geplant' | 'Ausgezahlt'

export type FondsAusschuettung = {
  id: string
  investorId: string
  datum: string
  betrag: number
  turnus: 'Halbjährlich' | 'Jährlich'
  status: FondsAusschuettungStatus
}

export type FondsDokumentKategorie = 'Zeichnungsschein' | 'Quartalsreport' | 'Prospekt' | 'Steuerbescheinigung' | 'Sonstiges'

export type FondsDokument = {
  id: string
  investorId?: string // fehlt = für alle Investoren sichtbar (z.B. Prospekt)
  name: string
  kategorie: FondsDokumentKategorie
  datum: string
  groesse: string
}

export type FondsInvestor = {
  id: string
  name: string
  email: string
  telefon: string
  seit: string
  zeichnungen: FondsZeichnung[]
  ausschuettungen: FondsAusschuettung[]
  dokumente: FondsDokument[]
}
