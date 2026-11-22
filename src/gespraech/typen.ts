// Gemeinsame Typen der Gesprächs-App „Mayer Gespräch“ (Vertrag der Helfer app, pipeline, auswertung, 22.11.2026).
// Spiegelt die Tabelle gespraech_aufnahmen und das Auswertungs-Schema (Spalte analyse). Der Server spiegelt
// dasselbe Schema in supabase/functions/_shared/gespraechSchema.ts.

export type GespraechArt = 'termin' | 'telefon' | 'notiz'

export type GespraechStatus = 'aufnahme' | 'hochladen' | 'transkription' | 'analyse' | 'fertig' | 'fehler' | 'verworfen'

export type GespraechSegment = {
  nr: number
  pfad: string
  mime: string
  dauer_s?: number
  bytes?: number
  status: 'offen' | 'hochgeladen' | 'transkribiert' | 'fehler'
  text?: string
}

export type GespraechMarker = { sek: number; text: string; art: 'wichtig' | 'aufgabe' | 'frage' }

export type GespraechFoto = { pfad: string; name: string; sek: number }

export type GespraechEinwilligung = { bestaetigt: true; am: string; text: string; wer: string }

export type GespraechSprecher = { label: string; name?: string; rolle?: 'mitarbeiter' | 'kunde' | 'sonstige' }

export type GespraechStammdatenFeld = 'telefon' | 'email' | 'anschrift' | 'firma' | 'ansprechpartner' | 'sonstiges'

export type GespraechAnalyse = {
  zusammenfassung: string
  kernthemen: string[]
  vereinbarungen: string[]
  offene_punkte: string[]
  naechste_schritte: { text: string; faellig?: string; wer?: string }[]
  termine: { titel: string; datum: string; uhrzeit?: string; ort?: string; mit?: string }[]
  todos: { text: string; faellig?: string; zustaendig?: string }[]
  wiedervorlagen: { titel: string; faellig: string }[]
  zahlen: { was: string; betrag: number | string; einheit?: string }[]
  kundenfragen: string[]
  einwaende: string[]
  stimmung: string
  risiken: string[]
  stammdaten: { feld: GespraechStammdatenFeld; wert: string }[]
  unterlagen_fehlen: string[]
  mail_entwurf: { betreff: string; text: string }
  sprecher: GespraechSprecher[]
  chance_hinweis?: { prozent?: number; begruendung: string }
}

/** Was „Übernehmen“ in der Akte angelegt hat (Spalte uebernommen; Schema von Helfer „auswertung“). */
export type GespraechUebernommen = {
  am: string
  von: string
  kundeId: string
  protokollId?: string
  naechsteSchritte?: boolean
  /** Index in analyse.wiedervorlagen (bzw. der bearbeiteten Liste) → id der Wiedervorlage. */
  wiedervorlagen?: Record<string, string>
  todos?: Record<string, string>
  termine?: Record<string, string>
  /** Index → 'ergaenzt' | 'gleich' | 'notiz' | 'schon_vorgeschlagen' | id des Stammdaten-Vorschlags. */
  stammdaten?: Record<string, string>
  audio?: { dokumentIds: string[]; uebersprungen?: string }
  fotos?: { dokumentIds: string[] }
  mailEntwurf?: boolean
  verlauf?: boolean
  objektVerlauf?: boolean
  hinweise?: string[]
}

/** Eine Zeile der Tabelle gespraech_aufnahmen. */
export type GespraechAufnahme = {
  id: string
  mitarbeiter_email: string
  kunde_id: string | null
  kunde_bereich: string | null
  objekt_id: string | null
  termin_id: string | null
  titel: string | null
  art: GespraechArt
  status: GespraechStatus
  fehler: string | null
  segmente: GespraechSegment[]
  marker: GespraechMarker[]
  notizen: string | null
  fotos: GespraechFoto[]
  einwilligung: GespraechEinwilligung | null
  transkript: string | null
  sprecher: GespraechSprecher[] | null
  analyse: GespraechAnalyse | null
  uebernommen: GespraechUebernommen | null
  dauer_s: number | null
  erstellt_am: string
  geaendert_am: string | null
  aufbewahren_bis: string | null
}

export type GespraechMarkerArt = GespraechMarker['art']

// ---------------------------------------------------------------------------------------------
// Ein- und Ausgaben der Server-Aktionen im email-gateway (Helfer „pipeline“)

export type GespraechAnlegenEingabe = {
  art: GespraechArt
  kundeId?: string
  kundeBereich?: string
  objektId?: string
  terminId?: string
  titel?: string
  einwilligung: GespraechEinwilligung
}

/** Antwort von gespraech_upload_url: Ziel für uploadToSignedUrl im Speicher „gespraech-aufnahmen“. */
export type GespraechUploadZiel = { pfad: string; signedUrl: string; token: string }

export const GESPRAECH_SPEICHER = 'gespraech-aufnahmen'

// ---------------------------------------------------------------------------------------------
// Adressen innerhalb der App (HashRouter unter …/gespraech/, Helfer „app“):
//   #/                 Start (Aufnahmeknopf, nächster Termin, Aktensuche)
//   #/aufnehmen        laufende Aufnahme
//   #/aufnahme/:id     Warten auf die Auswertung, danach der Prüfbildschirm (auswertung/AuswertungSeite.tsx)
//   #/aufnahmen        Meine Aufnahmen (auswertung/AufnahmenListe.tsx)
//   #/einstellungen    Einstellungen
// Der Server verlinkt „Auswertung fertig“ auf <CRM-Adresse>gespraech/#/aufnahme/<id>.
export const APP_PFAD = 'gespraech/'
export function aufnahmeLink(crmBasis: string, id: string): string {
  const b = crmBasis.endsWith('/') ? crmBasis : `${crmBasis}/`
  return `${b}${APP_PFAD}#/aufnahme/${encodeURIComponent(id)}`
}
