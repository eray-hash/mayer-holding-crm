// Zentrale Typdefinitionen für das Mayer Holding CRM

export type Bereich =
  | 'beratung'
  | 'immobilien'
  | 'immobilienkunden'
  | 'erben'
  | 'betriebsuebergabe'
  | 'betriebsformen'
  | 'akademie'
  | 'finanzierungen'
  | 'privat'

// Bereiche, die eine Kunden-/Mandanten-Liste vom Typ Kunde[] führen. "immobilien" selbst führt
// stattdessen Objekte — die zugehörige Kunden-/Interessentenliste läuft separat unter
// "immobilienkunden" (eigener Status-Pfad, da "immobilien" als Bereichs-Key bereits für den
// Objekt-Status (Akquise/Vermarktung/...) vergeben ist, siehe statusNetworks.ts) — Basis für die
// bereichsübergreifende Objekt-Kunde-Zuweisung.
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
  leistungBezeichnung?: string
  leistungEinheit?: 'Stunde' | 'Tag'
  leistungMenge?: number
}

export type MahnstufeId = 'erinnerung' | 'mahnung1' | 'mahnung2' | 'inkasso'

// Gegenstück zu Rechnung: Geld, das Mayer Holding selbst schuldet (Lieferanten-/Kostenrechnungen),
// nicht an einen Kunden gebunden — Rechnung modelliert ausschließlich Geld, das Kunden Mayer
// Holding schulden. Wird sowohl automatisch aus eingehenden E-Mails erkannt (quelle
// 'email-automatisch', siehe inbound-email) als auch manuell angelegt. Die KI kann nicht in
// PDF-Anhänge hineinsehen — erkannte Felder bleiben leer, wenn sie nicht im Mailtext selbst stehen,
// und müssen dann von Hand nachgetragen werden (2026-11-06).
export type VerbindlichkeitStatus = 'offen' | 'bezahlt' | 'ueberfaellig'

export type Verbindlichkeit = {
  id: string
  lieferant: string
  lieferantEmail?: string
  rechnungsnummer?: string
  datum: string
  betragNetto?: number
  betragBrutto?: number
  zahlungsziel?: string
  status: VerbindlichkeitStatus
  notiz?: string
  quelle: 'email-automatisch' | 'manuell'
  quellEmailId?: string
}

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
  dauerSekunden?: number
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

// Käuferprofil: per Fragebogen erfasste Kaufkriterien eines Kunden/Mandanten (bereichsübergreifend,
// nicht nur für originär Immobilien-Kunden — auch ein Beratungs- oder Erben-Mandant kann
// Kaufinteresse haben) — Grundlage für das automatische Matching gegen den Objektbestand.
export type Kaeuferprofil = {
  budgetMin?: number
  budgetMax?: number
  objekttypen: ObjektTyp[]
  bevorzugteLage: string
  nutzung: 'Eigennutz' | 'Kapitalanlage' | 'Unklar'
  zeitrahmen: string
  finanzierungGesichert: boolean
  notizen: string
  erstelltAm: string
}

// Echte Unternehmensbewertung (Kaufpreis-Schätzung) statt nur einer KI-Einschätzung — kombiniert
// die drei in der Praxis üblichen Verfahren und zeigt eine Spanne statt eines einzelnen falsch
// präzisen Werts, da eine Bewertung immer eine Schätzung mit Ermessensspielraum bleibt:
// 1. Multiplikatorverfahren: EBIT × Branchenmultiplikator
// 2. Ertragswertverfahren: nachhaltiger Jahresüberschuss / Kapitalisierungszins
// 3. Substanzwertverfahren: Nettovermögen als Wertuntergrenze
// Alle Eingaben frei editierbar, die Berechnung läuft live im UI (siehe UnternehmensbewertungSection).
export type Unternehmensbewertung = {
  jahresumsatz?: number
  ebit?: number
  ebitda?: number
  substanzwert?: number
  nachhaltigerJahresueberschuss?: number
  branchenmultiplikator: number
  kapitalisierungszinsProzent: number
  notizen: string
  erstelltAm: string
  // Ausgangspunkt für die KI-Recherche (siehe UnternehmensbewertungRecherche), einmalig pro Kunde
  // hinterlegt statt bei jedem Durchlauf neu abgefragt.
  webseite?: string
}

// Mehrstufige KI-Recherche (Firmenidentifikation → Recherche-Agents → Prüf-Agent → Bewertung) als
// Vorschlag für die obigen Eingabefelder — läuft asynchron im Hintergrund der Edge Function
// (siehe email-gateway "bewertung_recherche_start"), das Frontend pollt den Status. Ersetzt die
// echte Unternehmensbewertung oben nicht, sondern liefert nur Vorschläge zur Übernahme.
export type UnternehmensbewertungRecherche = {
  status: 'laeuft' | 'fertig' | 'fehler'
  schritt?: string
  bericht?: string
  abgeleiteteZahlen?: {
    ebit?: number
    substanzwert?: number
    nachhaltigerJahresueberschuss?: number
    branchenmultiplikator?: number
    kapitalisierungszinsProzent?: number
  }
  anlass: string
  stichtag: string
  gestartetAm: string
  abgeschlossenAm?: string
  fehler?: string
  // Vom Server gepflegt: welcher der vier Schritte als Nächstes dran ist und wann zuletzt etwas
  // geschrieben wurde — daran erkennt die Oberfläche eine hängen gebliebene Recherche.
  schrittNr?: number
  aktualisiertAm?: string
}

// Fragenkatalog (Selbstauskunft): pro Bereich frei im CRM konfigurierbare Fragen, die einem
// bestehenden Kunden/Mandanten als ausfüllbarer Link geschickt werden (siehe
// /formular/selbstauskunft/:bereich/:kundeId). Eine komplett neue öffentliche Lead-Gen-Website pro
// Bereich ist bewusst nicht Teil dieses Repos (separate Website-Projekte) — hier geht es nur um
// die interne Verwaltung der Fragen plus den Link-Versand an bereits angelegte Kunden.
export type FragenkatalogFragetyp = 'text' | 'zahl' | 'auswahl' | 'checkbox'

export type FragenkatalogFrage = {
  id: string
  bereich: KundeBereich
  text: string
  typ: FragenkatalogFragetyp
  optionen?: string[] // nur bei typ "auswahl"
  pflichtfeld: boolean
}

export type SelbstauskunftAntwort = {
  frageId: string
  frageText: string // Snapshot der Frage zum Ausfüllzeitpunkt, falls der Katalog später geändert wird
  antwort: string
}

export type Selbstauskunft = {
  antworten: SelbstauskunftAntwort[]
  signaturDataUrl: string
  eingereichtAm: string
}

// Hinweis "sollte nochmal geprüft werden" — allgemein gehalten, nicht nur für eine konkrete
// Fehleinordnung, siehe PruefHinweisBadge.tsx. vorschlagBereich ist optional, da nicht jeder
// Prüfhinweis zwingend einen alternativen Bereich vorschlägt.
export type PruefHinweis = {
  text: string
  vorschlagBereich?: KundeBereich
}

export type Kunde = {
  id: string
  firma: string
  ansprechpartner: string
  email: string
  telefon: string
  // Siehe PruefHinweisBadge.tsx: rotes "!" in Liste/Akte, löst sich per Verschieben/Verknüpfen/Behalten auf.
  pruefHinweis?: PruefHinweis
  // Gesetzt, wenn dieser Kunde bewusst parallel in einem zweiten Bereich geführt wird (PruefHinweis
  // "in beiden Bereichen führen") — z.B. damit neue Dokumente in beiden Akten landen.
  verknuepfteKunden?: { id: string; bereich: KundeBereich }[]
  prioritaet: Prioritaet
  status: string // StatusNode id (Beratungsnetz)
  followUp: FollowUp
  verantwortlich: string
  // Nur für bereich 'privat' gesetzt: E-Mail des Mitarbeiters, dem dieser Kontakt gehört — Grundlage
  // der Datenbank-Berechtigung (RLS), die private Kontakte/Protokolle auf den Besitzer beschränkt.
  verantwortlichEmail?: string
  letzteAktivitaet: string
  activities: ActivityEntry[]
  unterlagenCheckliste?: Record<string, boolean>
  signaturen?: Signatur[]
  kaeuferprofil?: Kaeuferprofil
  selbstauskunft?: Selbstauskunft
  dokumente?: Dokument[]
  unternehmensbewertung?: Unternehmensbewertung
  unternehmensbewertungRecherche?: UnternehmensbewertungRecherche
  potenzialAnalyse?: PotenzialAnalyse
}

// Ein Eintrag der Akte, der der KI für die Potenzial-Analyse vorlag — mit Kennung, damit jede
// vorgeschlagene Chance auf ihre Grundlage zurückverweisen kann.
export type PotenzialQuelle = {
  id: string
  art: 'Stammdaten' | 'Aktivität' | 'Dokument' | 'Gesprächsprotokoll' | 'Rechnung' | 'Internet-Recherche'
  text: string
  // Nur bei Internet-Recherche: Fundstelle, Sicherheit der Zuordnung zur Person, und ob der Fund
  // schon aus der Akte hervorging.
  url?: string
  sicherheit?: 'gesichert' | 'wahrscheinlich' | 'unsicher'
  bereitsBekannt?: boolean
}

// Gespeichertes Ergebnis der letzten Potenzial-Analyse eines Kunden. Vorher lebte es nur im
// Bildschirmzustand und war nach einem Reiterwechsel weg.
export type PotenzialAnalyse = {
  erstelltAm: string
  erstelltVon: string
  chancen: {
    bereich: string
    titel: string
    begruendung: string
    naechster_schritt: string
    prioritaet: 'Hoch' | 'Mittel' | 'Niedrig'
    quellen?: string[]
    annahmen?: string
    uebernommen?: 'followup' | 'vermerkt'
  }[]
  quellen: PotenzialQuelle[]
  // Wie die Internet-Recherche ausging: 'ok' (auch bei null Funden), 'fehlgeschlagen', oder fehlend
  // bei Analysen von vor dem 12.11.2026, als noch gar nicht im Internet gesucht wurde.
  webRecherche?: 'ok' | 'fehlgeschlagen'
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
  'Baulastenauskunft',
  'Betriebskostenabrechnung',
  'Bilder',
  'Energieausweis',
  'Exposé',
  'Finanzierung',
  'Flurkarte',
  'Gebäudeversicherung',
  'Genehmigung',
  'Grundbuch',
  'Grundrisse',
  'Gutachten',
  'Kostenaufstellung',
  'Lageplan',
  'Leistungsverzeichnisse',
  'Mieterliste',
  'Mietverträge',
  'Notarielle Dokumente',
  'Persönliche Daten des Eigentümers',
  'Pläne',
  'Protokolle',
  'Sanierungsunterlagen',
  'Sonstiges',
  'Teilungserklärung',
  'Verträge',
  'Wohnflächenberechnung',
] as const

export type DokumentOrdnerName = (typeof DOKUMENT_ORDNER)[number]

export type Dokument = {
  id: string
  name: string
  typ: string
  datum: string
  groesse: string
  url?: string
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
  // Vom Eigentümer selbst über das öffentliche Formular (/formular/eigentuemer/:objektId)
  // bestätigt/gepflegt — siehe PublicEigentuemerPortal.tsx.
  eigentuemer?: ObjektEigentuemer
  // Automatisch per KI erstelltes 1-Seiten-Exposé (Whitelabel) direkt bei Objektanlage, siehe
  // ObjektListe.tsx. undefined solange die Generierung noch läuft oder fehlgeschlagen ist.
  exposeText?: string
}

export type ObjektEigentuemer = {
  name: string
  telefon: string
  email: string
  ansprechpartner?: string // falls im Tagesgeschäft eine andere Person als der Eigentümer selbst zuständig ist
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
export type EmailAnhang = {
  filename: string
  size: number
  contentType: string
  url: string
}

export type EingegangeneEmail = {
  id: string
  messageId: string
  von: string
  vonName: string
  betreff: string
  datum: string
  ausschnitt: string
  anhaenge?: EmailAnhang[]
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

// Profildaten des aktuellen CRM-Nutzers (lokal, solange kein echter Mitarbeiter-Login aktiv ist —
// siehe AuthContext.tsx/LoginScreen.tsx, die bereits fertig für echte Mitarbeiter-Accounts
// vorbereitet sind, aber erst eingehängt werden, sobald echte Zugänge angelegt sind).
export type MitarbeiterProfil = {
  name: string
  telefon: string
  email: string
  fotoDataUrl?: string
  signaturHtml: string
  buchungslink?: string
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

// 1:1 nachgebaut aus Erays privater "ToDo Liste"-Excel (Reiter "to Do" / "erledigte Aufgaben",
// Stand 6.11.2026) — bewusst freie Textfelder statt strenger Formate (z.B. startDatum, geplanteZeit),
// weil die echten Einträge selbst uneinheitlich sind ("18.08", "24.08 26", "180 std" statt Minuten).
// Prio ist ebenfalls freier Text, nicht streng A/B/C (in der Vorlage kommt z.B. auch "E" vor).
export type ToDoEintrag = {
  id: string
  besitzerEmail: string
  // Gesetzt = geteilte Bereichs-Aufgabe (für alle aktiven Mitarbeiter sichtbar/bearbeitbar, wie der
  // Rest des Bereichs) statt privater Aufgabe des Besitzers. besitzerEmail bleibt auch dann als
  // "zuletzt privater Besitzer/Ersteller" erhalten, wird aber nicht mehr zur Zugriffsprüfung
  // herangezogen — Aufgaben lassen sich in beide Richtungen verschieben (2026-11-06).
  bereich?: Bereich
  reihenfolge?: number
  startDatum?: string
  prio?: string
  unterPrio?: number
  kundeProjekt?: string
  aufgabe: string
  abteilung?: string
  aktuellerStand?: string
  welcheFragen?: string
  naechsteSchritte?: string
  zustaendig?: string
  geplanteZeit?: string
  istZeit?: number
  umsatzWert?: number
  geplanteWiedervorlage?: string
  erledigtAm?: string
  erstelltAm: string
}

// Freigabe der eigenen To-Do-Liste an einen Kollegen (Nutzer-Entscheidung 2026-11-06: jeder hat
// seine eigene Liste, kann sie aber gezielt mit Lese- oder Schreibrecht teilen — Löschen bleibt
// immer dem Besitzer vorbehalten, unabhängig vom Recht).
export type ToDoFreigabe = {
  id: string
  besitzerEmail: string
  empfaengerEmail: string
  recht: 'lesen' | 'schreiben'
  erstelltAm: string
}

// Vertretungs-Logik (Quirin Lutzenberger): "offener Pool" ohne feste Vertreter-Zuordnung — während
// des Zeitraums von–bis werden die offenen Follow-ups/Aufgaben des Mitarbeiters für Geschäftsführung/
// Admin zusätzlich sichtbar gemacht (siehe HeuteScreen.tsx), ohne das verantwortlich/zustaendig-Feld
// umzubuchen (Entscheidung 2026-11-03).
export type Abwesenheit = {
  id: string
  mitarbeiterName: string
  von: string
  bis: string
}

// Ein per KI aus der E-Mail-Historie (oder später aus Fragenkatalog-Formularen) extrahierter
// Lead-Vorschlag — rein lesend aus public.vorgeschlagene_leads, siehe scripts/extract-leads.mjs.
// Übernahme als echter Kunde/Mandant passiert im CRM selbst (Dedup-Check gegen lokale Kundendaten).
export type VorgeschlagenerLead = {
  id: string
  email: string
  name?: string
  firma?: string
  telefon?: string
  bereichVorschlag: KundeBereich | 'unklar'
  notiz: string
  status: 'offen' | 'uebernommen' | 'verworfen'
  erstelltAm: string
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
