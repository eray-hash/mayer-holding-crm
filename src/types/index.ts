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

/** Bereiche, nach denen ein privater Kontakt geführt werden kann (kunden.privat_art). */
export type PrivatArt = Exclude<KundeBereich, 'privat'>

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

// ---------- Stammdatenblatt der Immobilienabteilung (Papiervorlage "Stammdaten", Version 21.10.26) ----------

export type ImmoRolle = 'vermittler' | 'eigentuemer' | 'makler' | 'empfehler'
export type ImmoAuftragsart = 'alleinauftrag' | 'qualifizierter_alleinauftrag' | 'einfacher_maklerauftrag' | 'vermittlungsauftrag'

/** Was über den reinen Kontakt hinaus auf dem Stammdatenblatt steht. Name, Telefon und E-Mail bleiben in den Stammdaten der Akte. */
export type ImmoStammdaten = {
  startdatum?: string
  prio?: 'A' | 'B' | 'C'
  rollen: ImmoRolle[]
  auftragsart?: ImmoAuftragsart
  position?: string
  adresse?: string
  telefonBuero?: string
  emailDirekt?: string
  webseite?: string
  bonitaet?: string
  bearbeiter?: string
  /** "Angebotene Objekte": was die Person selbst anbietet. */
  bietetAn: string
  sonstiges: string
}

/** Ein Gesuch ("Suchende Objekte"): Eine Person kann mehrere haben. Grundlage für den Abgleich mit dem Objektbestand. */
export type Gesuch = {
  id: string
  erstelltAm: string
  titel: string
  objekttypen: ObjektTyp[]
  /** Orte oder Regionen, durch Komma getrennt ("Ulm, Neu-Ulm"). Leer = Lage egal. */
  lage: string
  budgetMin?: number
  budgetMax?: number
  /** Höchster Kaufpreisfaktor (Kaufpreis ÷ Jahresnettokaltmiete). Leer = egal. */
  faktorMax?: number
  /** Zahl der Einheiten (Wohnungen/Gewerbe), von–bis. Leer = egal. */
  einheitenMin?: number
  einheitenMax?: number
  /** Baujahr von–bis (vierstellig). Leer = egal. */
  baujahrMin?: number
  baujahrMax?: number
  nutzung: 'Eigennutz' | 'Kapitalanlage' | 'Unklar'
  notizen: string
  erledigt?: boolean
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
  /** Postanschrift, eine Zeile je Angabe (z. B. "Hauptstraße 1\n89073 Ulm"). Seit 20.11.2026, für Angebote und Vorlagen. */
  anschrift?: string
  // Nur bei bereich 'privat': nach welchem Bereich (Statusablauf, Vorlagen, Fragenkatalog) der private Kontakt
  // geführt wird — leer = „Allgemein“. Beim Übernehmen ins Mayer-CRM ist das der Zielbereich (20.11.2026).
  privatArt?: PrivatArt
  letzteAktivitaet: string
  activities: ActivityEntry[]
  unterlagenCheckliste?: Record<string, boolean>
  signaturen?: Signatur[]
  kaeuferprofil?: Kaeuferprofil
  immoStammdaten?: ImmoStammdaten
  gesuche?: Gesuch[]
  selbstauskunft?: Selbstauskunft
  dokumente?: Dokument[]
  unternehmensbewertung?: Unternehmensbewertung
  unternehmensbewertungRecherche?: UnternehmensbewertungRecherche
  potenzialAnalyse?: PotenzialAnalyse
  steuerAnalyse?: SteuerAnalyse
  bonitaet?: Bonitaetseinschaetzung
  // Wann welche Unterlagen beim Kunden angefordert wurden (neueste zuerst), siehe KundeUnterlagenAnfordern.tsx.
  unterlagenAnforderungen?: KundenUnterlagenAnforderung[]
  // Projekt-Checkliste (Hasan und Eray, 20.11.2026), siehe lib/checkliste.ts und pages/checkliste.
  /** Zwei, drei Sätze: worum es bei diesem Auftrag geht. */
  sachverhalt?: string
  branche?: string
  /** Wer den Kunden gebracht hat; kundeId/bereich, wenn der Vermittler selbst eine Akte hat. */
  vermittler?: Vermittler
  /** Bezeichnungen aus der Preisliste (leistungen_preisliste) oder frei. */
  dienstleistungen?: string[]
  auftragChance?: AuftragChance
  naechsteSchritte?: string
  /** Vom Berater gesetzte Ampel; leer = berechnet (lib/checkliste.ts). */
  ampelManuell?: AmpelManuell
  /** Akademie: angefragte, gebuchte oder besuchte Seminare (id = seminare.id). Seit 21.11.2026. */
  seminare?: SeminarBuchung[]
}

export type SeminarStand = 'interessiert' | 'angemeldet' | 'teilgenommen'
export type SeminarBuchung = { id: string; titel: string; stand: SeminarStand }

export type Vermittler = { name: string; kundeId?: string; bereich?: KundeBereich }

/** Chance, dass der Auftrag kommt. Ein Vorschlag des Assistenten ist bestaetigt=false, bis ihn ein Berater bestätigt. */
export type AuftragChance = { prozent: number; bestaetigt: boolean; begruendung?: string; von?: string; am?: string }

export type AmpelFarbe = 'gruen' | 'gelb' | 'rot'
export type AmpelManuell = { farbe: AmpelFarbe; grund: string; von?: string; am?: string }

/** Eine Anforderung von Unterlagen beim Kunden per E-Mail, mit Link zur Hochlade-Seite
 *  /formular/unterlagen/:token. Der Server (email-gateway, kundenUnterlagen.ts) findet die Akte nur
 *  über `token` und trägt jeden Eingang unter `eingang` ein. */
export type KundenUnterlagenAnforderung = {
  id: string
  datum: string
  /** E-Mail-Adresse, an die die Anforderung ging. */
  an: string
  anName?: string
  von: string
  /** Angeforderte Unterlagen (Wörter aus data/kundenUnterlagen.ts oder frei). */
  punkte: string[]
  /** Weitere, frei beschriebene Unterlagen. */
  weitere?: string
  art: 'anforderung' | 'erinnerung'
  /** Geheime Kennung im Link (32 Zufallsbytes, base64url). 60 Tage gültig ab `datum`. */
  token: string
  /** Vom Server eingetragen: was der Kunde über diesen Link hochgeladen hat. */
  eingang?: { punkt: string; datum: string; dokumentId: string; name: string }[]
}

export type BonitaetPunkt = {
  text: string
  /** Name der Unterlage, „Selbstauskunft" oder die Adresse der öffentlichen Quelle. */
  quelle: string
  url?: string
  art: 'dokument' | 'selbstauskunft' | 'oeffentlich'
}

// Interne Bonitätseinschätzung (keine Auskunft einer Auskunftei). Schreibt nur der Server
// (email-gateway „bonitaet_pruefen", supabase/functions/email-gateway/bonitaet.ts) in kunden.bonitaet.
export type Bonitaetseinschaetzung = {
  version: 1
  ampel: 'gruen' | 'gelb' | 'rot' | 'nicht_beurteilbar'
  begruendung: string
  positiv: BonitaetPunkt[]
  negativ: BonitaetPunkt[]
  /** Was für eine bessere Einschätzung fehlt. */
  fehlt: string[]
  /** Womit geprüft wurde (von der Mitarbeiterin bestätigt) und was das Programm aus der Akte vorgeschlagen hatte. */
  art: 'person' | 'firma'
  artErkannt: 'person' | 'firma'
  artGrund: string
  /** Bei Privatpersonen immer 'nicht_erlaubt'. */
  webRecherche: 'nicht_erlaubt' | 'ok' | 'fehlgeschlagen' | 'kein_firmenname'
  dokumente: { name: string; url?: string; stand: 'verwendet' | 'wird_eingelesen' | 'nicht_lesbar' | 'nicht_verwendet'; hinweis?: string }[]
  selbstauskunftVerwendet: boolean
  erstelltAm: string
  erstelltVon: string
}

export type SteuerVorschlag = {
  titel: string
  art: 'Steuerersparnis' | 'Steuerverlagerung'
  firma: string
  massnahme: string
  wirkung: string
  voraussetzungen: string
  haken: string
  naechster_schritt: string
  rechtsgrundlage: string
  grundlage: string
  belastbarkeit: 'hoch' | 'mittel' | 'niedrig'
}

// Steuerliche Ansatzpunkte eines Kunden über alle seine Firmen. Wird vom Server Schritt für Schritt
// geschrieben (kunden.steuer_analyse) und im Browser nur gelesen — nie zurückgeschrieben.
export type SteuerAnalyse = {
  status: 'laeuft' | 'fertig' | 'fehler'
  schritt?: string
  schrittNr?: number
  gestartetAm: string
  gestartetVon?: string
  aktualisiertAm?: string
  abgeschlossenAm?: string
  fehler?: string
  gelesen?: { name: string; ergebnis: 'gelesen' | 'nicht lesbar' | 'übersprungen'; hinweis?: string }[]
  zusammenfassung?: string
  datenlage?: string
  vorschlaege?: SteuerVorschlag[]
  quellen?: string[]
  zwischen?: { unterlagen?: string; firmen?: string; zahlen?: string; rechtsstand?: string }
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
  // Wie viele Dokumente der Akte mit ihrem Inhalt (Kurzfassung) in die Analyse eingingen und wie
  // viele zum Zeitpunkt der Analyse noch eingelesen wurden. Fehlt bei älteren Analysen.
  dokumenteMitInhalt?: number
  dokumenteInArbeit?: number
}

export type Vorlage = {
  id: string
  // 'briefkopf' ist kein Schriftstück, sondern die eine Zeile mit den Briefkopf-Angaben (siehe data/briefkopf.ts).
  kategorie: 'vollmacht' | 'schreiben' | 'vertraege' | 'formulare' | 'ki' | 'briefkopf'
  name: string
  typ: string
  zuletztGeaendert: string
  text: string
  formularPfad?: string // gesetzt, wenn diese Vorlage ein echtes, ausfüllbares digitales Formular hat
  // Vorlage als Datei (Word, PDF, Excel, Bild) statt als Text: liegt in der geschützten Ablage
  // "kunden-dokumente" unter vorlagen/<bereich>/… und wird beim Klick über einen kurz gültigen Link geöffnet.
  datei?: { pfad: string; name: string; typ: string; groesse: string }
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
  // Gesetzt = privates Objekt dieses Mitarbeiters (nur für ihn sichtbar, Datenbank-Regel); leer = Mayer-Objekt.
  privatBesitzer?: string
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
  // Nicht öffentlich angeboten ("Off-Market") — Kennzeichen für die Objektliste zum Weitergeben.
  offMarket?: boolean
  // Die beiden Arbeitsblätter der Immobilienabteilung, siehe ObjektVerkaufsdatenblatt.tsx / ObjektKurzpruefungBlatt.tsx.
  verkaufsdaten?: ObjektVerkaufsdaten
  kurzpruefung?: ObjektKurzpruefung
  // Vom Eigentümer selbst über das öffentliche Formular (/formular/eigentuemer/:objektId)
  // bestätigt/gepflegt — siehe PublicEigentuemerPortal.tsx.
  eigentuemer?: ObjektEigentuemer
  // Automatisch per KI erstelltes 1-Seiten-Exposé (Whitelabel) direkt bei Objektanlage, siehe
  // ObjektListe.tsx. undefined solange die Generierung noch läuft oder fehlgeschlagen ist.
  exposeText?: string
  // Bewertung per Knopf: läuft auf dem Server in mehreren Schritten und wird NUR vom Server geschrieben
  // (das Fenster liest sie, speichert sie aber nie zurück — siehe objektToRow in crmSync.ts).
  bewertung?: ObjektBewertung
  // Wann welche Unterlagen beim Eigentümer angefordert wurden (neueste zuerst).
  unterlagenAnforderungen?: UnterlagenAnforderung[]
  // Geheimes Zeichen für den Link zur Eigentümer-Seite (/formular/eigentuemer/:objektId/:token). Erzeugt
  // die Datenbank beim Anlegen; das Fenster liest es nur und schreibt es nie zurück (siehe objektToRow).
  eigentuemerToken?: string
}

/** Stand und Ergebnis der Bewertung eines Objekts nach einer hinterlegten KI-Anweisung. */
export type ObjektBewertung = {
  status: 'laeuft' | 'fertig' | 'fehler'
  /** Anzeigetext des laufenden Schritts, z. B. „Unterlagen lesen". */
  schritt?: string
  schrittNr?: number
  schritteGesamt?: number
  gestartetAm: string
  gestartetVon?: string
  aktualisiertAm?: string
  abgeschlossenAm?: string
  /** Die verwendete KI-Anweisung (Vorlage der Rubrik „KI-Anweisungen"). */
  vorlageId?: string
  vorlageName?: string
  zusatz?: string
  /** Welche Unterlagen gelesen wurden (Dateinamen) und welche wegen Größe oder Art nicht. */
  gelesen?: string[]
  nichtGelesen?: string[]
  /** Der fertige Bewertungstext. */
  bericht?: string
  /** Aus dem Bericht herausgezogene Werte — nur was dort wirklich steht, sonst leer. */
  kennzahlen?: {
    marktwertVon?: number
    marktwertBis?: number
    marktwert?: number
    preisProQm?: number
    mieteProQm?: number
    kaufpreisfaktor?: number
    rendite?: number
  }
  /** Fundstellen der Marktrecherche. */
  quellen?: { titel: string; url: string }[]
  fehler?: string
  /** KI-Kosten dieses Laufs in US-Dollar (alle Aufrufe, auch wiederholte). */
  kostenUsd?: number
  /** Aus dem vorigen Lauf übernommen statt neu gelesen bzw. neu recherchiert (Zeitpunkt der Grundlage). */
  wiederverwendet?: { unterlagenVom?: string; marktVom?: string }
  /** Vom Server für den nächsten Lauf aufgehoben (Faktenblatt, Marktrecherche) — hier nur durchgereicht. */
  grundlage?: { unterlagenAm: string; marktAm: string }
}

/** Eine Anforderung fehlender Unterlagen beim Eigentümer per E-Mail. */
export type UnterlagenAnforderung = {
  id: string
  datum: string
  /** E-Mail-Adresse, an die die Anforderung ging. */
  an: string
  anName?: string
  von: string
  /** Angeforderte Ordner (Unterlagen-Arten). */
  ordner: DokumentOrdnerName[]
  /** Weitere, frei beschriebene Unterlagen. */
  weitere?: string
  art: 'anforderung' | 'erinnerung'
}

/** Vom Server gemeldeter neuer Treffer zwischen einem Gesuch und einem Objekt (abteilung_eintraege, art „treffer"). id = `treffer|${gesuchId}|${objektId}`. */
export type TrefferMeldung = {
  id: string
  gesuchId: string
  kundeId: string
  objektId: string
  /** „treffer" = alle Angaben passen, „pruefen" = ein Wert fehlt noch am Objekt. */
  art: 'treffer' | 'pruefen'
  entdecktAm: string
  /** Wer per Telegram benachrichtigt wurde (Namen); leer = niemand erreichbar oder stiller Erststand. */
  gemeldetAn: string[]
}

/** Verkaufsdatenblatt (Papiervorlage „Verkaufsdaten", Version 3 vom 14.8.26): die Zusammenfassung eines Objekts auf einer Seite. */
export type ObjektVerkaufsdaten = {
  datum?: string
  prio?: 'A' | 'B' | 'C'
  auftraggeber: { name: string; telefon: string; email: string; adresse: string; webseite: string; bonitaet: string }
  auftragsart?: ImmoAuftragsart
  kennzahlen: {
    baujahr: string
    grundstuecksflaeche: string
    wohnflaeche: string
    nutzflaeche: string
    einheiten: string
    zimmer: string
    stellplaetze: string
    vermietungsstatus: string
    jahresnettokaltmiete?: number
    kaufpreisvorstellung?: number
    zielverkaufspreis?: number
  }
  bewertung: { rendite: string; faktor: string; verfahren: string[]; marktwert?: number }
  verkaufsstatus: string[]
  verkaufsstatusNotiz: string
  uebersicht: { strasse: string; plzOrt: string; flurstueck: string; gemarkung: string; objektart: string }
  unterlagen: Record<string, { vorhanden: boolean; geprueft: boolean }>
  sonstiges: string
}

/** Vorab-Kurzprüfung eines Immobilienobjekts (Papiervorlage Version 1 vom 14.04.26): lohnt sich der Auftrag? */
export type ObjektKurzpruefung = {
  datum?: string
  zeilen: Record<string, { ist: string; marktwert: string; ergebnis: string }>
  provisionProzent: string
  provisionBetrag: string
  verkaeuferBekannt: string
  direktesMandat: string
  offeneFragen: string
  gruendeDagegen: string[]
  gruendeDafuer: string[]
  prio?: 'A' | 'B' | 'C'
  prioBegruendung: string
  zeiterfordernis: string
  naechsteSchritte: string[]
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
  postfachId?: string
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
  // Aus der To-do-Vorlage der Immobilienabteilung (Papierformular „To Do", 2026-11): auf wen gewartet wird,
  // wann die Aufgabe kam, bis wann sie erledigt sein muss, und der Stundensatz für die Zeitaufwandskosten
  // (Kosten = Ist-Zeit in Minuten / 60 × Stundensatz).
  wartenAuf?: string
  erhaltenAm?: string
  erledigenBis?: string
  /** Erinnerung per Telegram zu diesem Zeitpunkt (ISO); '' = gelöscht. Server setzt erinnertAm nach dem Versand. */
  erinnernUm?: string
  erinnertAm?: string
  stundensatz?: number
}

// ---------- Arbeitsorganisation der Abteilung (Tabelle abteilung_eintraege: je Eintrag eine Zeile) ----------

/** Frage zu einem Objekt/Projekt an die Geschäftsführung, mit dokumentierter Antwort (Papierformular „Fragenkatalog"). */
export type ImmoFrage = {
  id: string
  erstelltAm: string // ISO-Datum
  prio?: 'A' | 'B' | 'C'
  objektId?: string
  /** Kunde, Projekt oder Vorgang als freier Text — für Fragen ohne Objekt oder zur Anzeige. */
  bezug: string
  frage: string
  gestelltVon: string
  antwort?: string
  beantwortetVon?: string
  beantwortetAm?: string
}

/** Eine Zeile der täglichen Zeiterfassung: wer hat wann wie lange woran gearbeitet. */
export type Zeiteintrag = {
  id: string
  mitarbeiter: string
  datum: string // ISO-Datum
  start?: string // "09:30"
  ende?: string
  dauerMin: number
  taetigkeit: string
  objektId?: string
  /** Projekt/Kunde als freier Text, wenn kein Objekt gewählt ist. */
  bezug?: string
  notiz?: string
}

export type TagesplanBlock = 'organisation' | 'frist' | 'A' | 'B' | 'C' | 'kurz'

export type TagesplanZeile = {
  id: string
  block: TagesplanBlock
  dauerMin?: number
  bisUhr?: string
  was: string
  /** „Gewinn/Verlust" der Vorlage: was es gebracht hat. */
  ergebnis?: string
  /** Infos, aktueller Stand, Fragen, nächste Schritte. */
  stand?: string
  erledigt?: boolean
}

/** Tagesablauf eines Mitarbeiters für einen Tag — für die ganze Abteilung einsehbar. id = `${mitarbeiter}|${datum}`. */
export type Tagesplan = {
  id: string
  mitarbeiter: string
  datum: string
  ort?: string
  zeilen: TagesplanZeile[]
  anrufe: string
  aktualisiertAm: string
}

/** Nachweis, wem welche Objekte wann angeboten wurden (Grundlage für den Provisionsanspruch). */
export type Weitergabe = {
  id: string
  datum: string // ISO-Datum
  /** Empfänger als Text (Name, Firma). */
  an: string
  /** Kontakt im CRM, falls der Empfänger dort geführt wird. */
  kontaktId?: string
  objektIds: string[]
  /** Unter welcher Bezeichnung jedes Objekt in der Liste stand (objektId → Text) — so ist nachvollziehbar, was der Empfänger gesehen hat. */
  bezeichnungen: Record<string, string>
  /** Welche Angaben mitgegeben wurden, z. B. ['Bezeichnung', 'Ort', 'Objektart', 'Kaufpreis']. */
  angaben: string[]
  /** Auf welchem Weg: 'Text kopiert', 'Ausdruck', … */
  weg: string
  /** Lag vor der Weitergabe eine Vertraulichkeits- oder Nichtumgehungsvereinbarung vor? */
  vereinbarung: 'keine' | 'nda' | 'nichtumgehung' | 'beides'
  notiz?: string
  von: string
}

/** Abrechnung eines Objekts/Projekts: Wer hat wie viel Zeit investiert, was kostet sie, wie wird die Provision geteilt. id = objektId. */
export type ObjektAbrechnung = {
  id: string
  objektId: string
  /** Erwartete oder erzielte Provision in Euro. */
  provision?: number
  /** Stundensatz je Mitarbeiter (Name → Euro je Stunde). */
  stundensaetze: Record<string, number>
  /** Fester Anteil an der Provision in Prozent je Mitarbeiter; leer = Aufteilung nach Zeitanteil. */
  anteile: Record<string, number>
  notiz: string
  aktualisiertAm: string
}

/** Wochenplan eines Mitarbeiters. id = `${mitarbeiter}|${wocheAb}`; zellen: Schlüssel `${tag}-${stunde}` (tag 0 = Montag, stunde 9–20). */
export type Wochenplan = {
  id: string
  mitarbeiter: string
  wocheAb: string // ISO-Datum des Montags
  zellen: Record<string, string>
  aktualisiertAm: string
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
  /** Absender-Adresse (ab 2026-11-15 mitgeschrieben). */
  von?: string
  postfachId?: string
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

// ---------- Kontoauszüge auswerten (aus dem früheren Einzelprogramm „Kontoauszug → Excel“) ----------
// Gespeichert in der Tabelle kontoauszug_auswertungen (eine Zeile je Auswertung, Rechte wie die Akte);
// wird nicht beim Start geladen, sondern erst, wenn jemand die Auswertungen einer Akte öffnet.

/** Eine Buchung aus einem Kontoauszug. Ausgaben negativ, Einnahmen positiv. */
export type KontoBuchung = {
  id: string
  /** Buchungsdatum JJJJ-MM-TT. */
  datum: string
  wertstellung?: string | null
  /** Buchungstext / Verwendungszweck. */
  text: string
  /** Empfänger oder Auftraggeber. */
  gegenpartei?: string | null
  betrag: number
  waehrung: string
  kategorie: string
  /** Konto / IBAN, aus dem die Buchung stammt. */
  konto?: string | null
  /** Name der Datei, aus der die Buchung stammt. */
  quelle?: string
}

/** Was aus einer Datei herausgelesen wurde. */
export type KontoauszugDatei = {
  name: string
  /** Verweis auf die Datei in der Akte, falls sie von dort stammt. */
  url?: string
  bank?: string | null
  iban?: string | null
  kontoinhaber?: string | null
  von?: string | null
  bis?: string | null
  anzahl: number
  /** Gesetzt, wenn die Datei (oder ein Teil davon) nicht ausgelesen werden konnte. */
  fehler?: string
}

export type KontoauszugAuswertung = {
  id: string
  kundeId: string
  bereich: KundeBereich
  titel: string
  erstelltAm: string
  erstelltVon?: string
  geaendertAm: string
  buchungen: KontoBuchung[]
  dateien: KontoauszugDatei[]
}
