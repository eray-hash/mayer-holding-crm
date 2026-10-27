// Zentrale Typdefinitionen für das Mayer Holding CRM

export type Bereich = 'beratung' | 'immobilien' | 'erben' | 'betriebsuebergabe' | 'betriebsformen' | 'akademie' | 'finanzierungen'

// Bereiche, die eine Kunden-/Mandanten-Liste vom Typ Kunde[] führen (alle außer Immobilien,
// das stattdessen Objekte führt) — Basis für die bereichsübergreifende Objekt-Kunde-Zuweisung.
export type KundeBereich = Exclude<Bereich, 'immobilien'>

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

export type Signatur = {
  id: string
  name: string
  dataUrl: string // erfasste Unterschrift als PNG (Data-URL)
  datum: string
  kontext: string // z.B. "Feedbackbogen Vermögensschutz"
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
  bereich: KundeBereich
  kundeId: string
  datum: string
  teilnehmer: string
  betreff: string
  text: string
  // Optionale KI-generierte Struktur (aus "Gespräch aufzeichnen" + Zusammenfassen) — manuell
  // angelegte Protokolle haben diese Felder nicht und zeigen nur `text`.
  kernthemen?: string[]
  vereinbarungen?: string[]
  offenePunkte?: string[]
  stimmung?: string
  kiZusammenfassung?: string
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
  signaturen?: Signatur[]
}

export type Vorlage = {
  id: string
  kategorie: 'vollmacht' | 'schreiben' | 'vertraege'
  name: string
  typ: string
  zuletztGeaendert: string
  text: string
  formularPfad?: string // gesetzt, wenn diese Vorlage ein echtes, ausfüllbares digitales Formular hat
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
  // Herkunft aus dem separaten ImmoRadar-Scan-Tool (eigenständiges Projekt, nicht Teil dieses
  // Repos) — der Link führt zurück zum Original-Inserat, die Lukrativität ist dessen eigene
  // Einschätzung (z.B. "sehr interessant"/"interessant"/"neutral"/"eher unattraktiv").
  quelle?: 'immoradar'
  immoRadarLink?: string
  lukrativitaet?: string
  zugewiesenerKunde?: { bereich: KundeBereich; kundeId: string; kundeName: string }
}

// Vorschlag/Exposé-Versand: ein Objekt wird einem Kunden (aus einem beliebigen Kunden-Bereich)
// mit einer Begründung (z.B. Steuerersparnis) vorgeschlagen. Der Kunde entscheidet über den
// personalisierten Formular-Link (/formular/expose/:id) selbst über Annahme/Ablehnung.
export type ObjektVorschlagStatus = 'offen' | 'akzeptiert' | 'abgelehnt'

export type ObjektVorschlag = {
  id: string
  objektId: string
  kundeBereich: KundeBereich
  kundeId: string
  kundeName: string
  steuerBegruendung: string
  status: ObjektVorschlagStatus
  erstelltAm: string
  erstelltVon: string
  beantwortetAm?: string
}

// Dokumenten-Import per Handyscan/Drucker: eine Datei (Foto/PDF) landet zunächst unzugewiesen hier,
// das System schlägt auf Basis des erfassten Texts einen passenden Kunden/Mandanten vor (beliebiger
// KundeBereich), die endgültige Zuweisung bestätigt ein Mitarbeiter.
export type ImportiertesDokument = {
  id: string
  dateiname: string
  hochgeladenAm: string
  vorschauDataUrl?: string
  erkannterText: string
  vorschlag?: { bereich: KundeBereich; kundeId: string; kundeName: string }
  zugewiesen?: { bereich: KundeBereich; kundeId: string; kundeName: string }
}

// Posteingang: eine via "email-gateway"-Edge-Function abgerufene echte E-Mail aus
// info@amayer-holding.com. Wird per messageId dedupliziert, einem Kunden zugeordnet (vorhandener
// Treffer per E-Mail-Adresse, sonst Text-Vorschlag) oder als neuer Lead übernommen.
export type EingegangeneEmail = {
  id: string
  messageId: string
  von: string
  vonName: string
  betreff: string
  datum: string
  ausschnitt: string
  vorschlag?: { bereich: KundeBereich; kundeId: string; kundeName: string }
  zugewiesen?: { bereich: KundeBereich; kundeId: string; kundeName: string }
  ignoriert?: boolean
}

// Textvorlage für den E-Mail-Versand (Postfach/Kundenakte) mit Platzhaltern wie {{firma}} und
// {{ansprechpartner}}, die beim Anwenden auf den aktuellen Kunden-Kontext ersetzt werden.
export type MailVorlage = {
  id: string
  name: string
  betreff: string
  text: string
}

// Freie Notiz aus dem KI-Assistenten, wenn dabei kein Kunde/Mandant erkannt bzw. ausgewählt wurde
// (landet sonst als Follow-up + Aktivität direkt beim erkannten Kunden, siehe ADD_VOICE_TASK).
export type Notiz = {
  id: string
  text: string
  erstelltAm: string
  faelligkeitsDatum?: string
  erledigt: boolean
}

// Eine über das CRM versendete E-Mail — rein lesend aus public.gesendete_emails (vom
// email-gateway beim erfolgreichen Versand mitgeschrieben), für den "Gesendet"-Ordner im Postfach.
export type GesendeteEmail = {
  id: string
  an: string
  anName: string
  betreff: string
  text: string
  gesendetAm: string
  kundeBereich?: KundeBereich
  kundeId?: string
  kundeName?: string
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
