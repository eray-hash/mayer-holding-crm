// „Ihr Kundenbereich“ (22.11.2026): reine Typen, Konstanten und der kundengerechte Stand im Ablauf — gemeinsam für
// den Server (email-gateway/kundenPortal.ts) und die öffentliche Seite (src/pages/formulare/PublicKundenPortal.tsx).
// Bewusst ohne Deno- oder Browser-Funktionen.
import type { KundenAmpel } from './kundenberichtKern.ts'

export const PORTAL_GUELTIG_TAGE = 180
export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{43,128}$/
export const PORTAL_BEREICHE = ['beratung', 'immobilienkunden', 'erben', 'betriebsuebergabe', 'betriebsformen', 'finanzierungen', 'akademie'] as const
export const NACHRICHT_MAX_JE_TAG = 5
export const NACHRICHT_ABSTAND_MS = 2 * 60_000
export const NACHRICHT_MAX_ZEICHEN = 2000
/** Zeitraum für „Was zuletzt passiert ist“. */
export const ZEITRAUM_TAGE = 30

export const UNGUELTIG = 'Dieser Link ist ungültig. Bitte prüfen Sie, ob Sie ihn vollständig geöffnet haben, oder fragen Sie bei uns nach.'
export const BEENDET = 'Dieser Zugang wurde beendet. Wenn Sie einen neuen Link brauchen, melden Sie sich bitte bei uns.'
export const ABGELAUFEN = 'Dieser Link ist abgelaufen. Bitte fordern Sie bei uns einen neuen an.'


export const BEREICH_FUER_KUNDEN: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilienkunden: 'Immobilien',
  erben: 'Erbschaft und Nachlass',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Rechtsformberatung',
  finanzierungen: 'Finanzierungen',
  akademie: 'Akademie',
}

// ---------------------------------------------------------------------------------------------
// Stand im Ablauf — nur diese Sätze erscheinen. Reihenfolge = Hauptpfad aus src/data/statusNetworks.ts
// (*_HAUPTPFAD). Ändert sich dort ein Hauptpfad, hier nachziehen; unbekannte Status zeigen einfach nichts.

const KONTAKT = 'Wir haben Kontakt mit Ihnen aufgenommen.'
const FERTIG = 'Ihr Vorgang ist abgeschlossen.'
const INTERESSE = 'Wir haben Ihr Interesse vorgemerkt.'

export const STAND_FUER_KUNDEN: Record<string, [string, string][]> = {
  beratung: [
    ['lead', 'Ihre Anfrage ist bei uns eingegangen.'],
    ['erstkontakt', KONTAKT],
    ['termin', 'Der Termin für das Erstgespräch steht.'],
    ['durchgefuehrt', 'Das Erstgespräch hat stattgefunden.'],
    ['konzept', 'Wir stellen Ihnen unser Konzept vor.'],
    ['angebot', 'Unser Angebot und der Beratungsvertrag liegen Ihnen vor.'],
    ['unterschrieben', 'Der Beratungsvertrag ist unterschrieben.'],
    ['aktives_mandat', 'Die Beratung läuft.'],
    ['rechnung_gestellt', 'Die Leistung ist erbracht und abgerechnet.'],
    ['abgeschlossen', FERTIG],
  ],
  erben: [
    ['erstkontakt', KONTAKT],
    ['bedarfsanalyse', 'Wir besprechen mit Ihnen, was Sie brauchen.'],
    ['unterlagen_angefordert', 'Wir haben Unterlagen und den Mandantenfragebogen bei Ihnen angefragt.'],
    ['konzept_erstellt', 'Ihr Konzept ist erstellt.'],
    ['beratungsgespraech', 'Das Beratungsgespräch hat stattgefunden.'],
    ['umsetzung', 'Wir setzen die Regelungen um, zum Beispiel Testament, Vollmacht oder Stiftung.'],
    ['abgeschlossen', FERTIG],
  ],
  betriebsuebergabe: [
    ['erstkontakt', KONTAKT],
    ['bedarfsanalyse', 'Wir besprechen mit Ihnen, was Sie brauchen.'],
    ['unternehmensbewertung', 'Wir bewerten Ihr Unternehmen.'],
    ['nachfolgekonzept', 'Das Nachfolgekonzept ist erstellt.'],
    ['nachfolgersuche', 'Wir suchen passende Nachfolger oder Käufer.'],
    ['verhandlung', 'Die Verhandlungen und der Vertragsentwurf laufen.'],
    ['notartermin', 'Es geht um den Notartermin und die Übergabe.'],
    ['abgeschlossen', FERTIG],
  ],
  betriebsformen: [
    ['erstkontakt', KONTAKT],
    ['bedarfsanalyse', 'Wir prüfen Ihre bisherige Rechtsform.'],
    ['konzept_erstellt', 'Der Rechtsformvergleich ist erstellt.'],
    ['beratungsgespraech', 'Das Beratungsgespräch hat stattgefunden.'],
    ['umsetzung', 'Wir setzen die Gründung oder Umwandlung um.'],
    ['handelsregister', 'Es geht um den Notartermin und den Eintrag ins Handelsregister.'],
    ['abgeschlossen', FERTIG],
  ],
  akademie: [
    ['interessent', INTERESSE],
    ['anmeldung_eingegangen', 'Ihre Anmeldung ist eingegangen.'],
    ['platz_bestaetigt', 'Ihr Platz ist bestätigt.'],
    ['kurs_laeuft', 'Ihr Kurs läuft.'],
    ['abgeschlossen', 'Der Kurs ist abgeschlossen.'],
  ],
  finanzierungen: [
    ['interessent', INTERESSE],
    ['risikoprofil_erstellt', 'Ihr Anlageprofil ist erstellt.'],
    ['beratungsgespraech', 'Das Beratungsgespräch hat stattgefunden.'],
    ['zeichnung_eingegangen', 'Ihr Zeichnungsschein ist eingegangen.'],
    ['kapital_eingezahlt', 'Ihre Einzahlung ist eingegangen.'],
    ['abgeschlossen', 'Ihre Anlage ist abgeschlossen.'],
  ],
  immobilienkunden: [
    ['interessent', INTERESSE],
    ['besichtigung', 'Eine Besichtigung ist vereinbart.'],
    ['angebot', 'Ihr Angebot liegt vor.'],
    ['verhandlung', 'Die Verhandlungen laufen.'],
    ['abgeschlossen', FERTIG],
  ],
}

export type PortalStand = { text: string; schritt: number; schritte: number; abgeschlossen: boolean }

/** Kundengerechter Stand oder null (Status nicht auf dem Hauptpfad oder unbekannt). */
export function standFuerKunden(bereich: string, status: string | null | undefined): PortalStand | null {
  const pfad = STAND_FUER_KUNDEN[bereich]
  if (!pfad || !status) return null
  const i = pfad.findIndex(([s]) => s === status)
  if (i < 0) return null
  return { text: pfad[i][1], schritt: i + 1, schritte: pfad.length, abgeschlossen: i === pfad.length - 1 }
}

// ---------------------------------------------------------------------------------------------
// Ergebnis

export type PortalUnterlage = { name: string; /** Hochlade-Link (Kennung der Anforderung) oder null, wenn die Anforderung älter als 60 Tage ist. */ token: string | null }

export type KundenPortalSeite =
  | { stufe: 'ungueltig'; grund: string }
  | {
      stufe: 'frei'
      anrede: string
      bereich: string
      leistungen: string[]
      stand: PortalStand | null
      ampel: KundenAmpel
      ampelText: string
      /** Neueste zuerst. */
      erledigt: string[]
      naechste: string[]
      vonIhnen: string[]
      unterlagen: { fehlend: PortalUnterlage[]; hochladenToken: string | null }
      unterschriften: { id: string; titel: string; status: 'offen' | 'unterschrieben'; token: string; gueltigBis?: string; unterschriebenAm?: string }[]
      dokumente: { id: string; name: string; datum: string; groesse: string }[]
      termine: { id: string; titel: string; beginn: string; ende: string; ganztags: boolean; ort: string }[]
      rechnungen: { id: string; nummer: string; datum: string; betrag: number | null; stand: 'offen' | 'ueberfaellig' | 'bezahlt'; faelligAm: string; mitPdf: boolean }[]
      kontakt: { name: string; telefon: string; email: string } | null
      nachricht: { moeglich: boolean; grund?: string }
      gueltigBis: string
      hinweis?: string
    }
