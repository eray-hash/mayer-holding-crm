import { ERBEN_CHECKLISTE } from './originalTexte'
import type { KundeBereich } from '../types'

// Welche Unterlagen bei Kunden und Mandanten typischerweise angefordert werden — je Bereich eine
// Vorauswahl (`standard`, beim Anfordern schon angehakt) und weitere Unterlagen zum Dazuwählen.
// Gegenstück zu objektUnterlagenPflicht.ts für Objekte; bewusst eine einfache, direkt änderbare
// Daten-Datei.
//
// Woher die Listen kommen (nichts Neues erfunden, wo es schon etwas gibt):
// - Unternehmensberatung: aus der Vorlage „Notwendige Unterlagen – Checkliste für den Mandanten"
//   (seedBeratung.ts), gekürzt auf Dokumente.
// - Erben: wortgleich aus der Unterlagen-Checkliste des Mandantenfragebogens (ERBEN_CHECKLISTE),
//   nur die Punkte, die ein Schriftstück sind (nicht reine Angaben wie „Familienstand"). Weil die
//   Wörter gleich sind, erkennt das Anfordern-Fenster, was in der Checkliste schon abgehakt ist.
// - Selbstauskunft: das CRM hat ein eigenes Online-Formular (Reiter „Selbstauskunft"). Ist es
//   ausgefüllt, gilt der Punkt SELBSTAUSKUNFT als da — auch ohne hochgeladene Datei.

export const SELBSTAUSKUNFT = 'Selbstauskunft (ausgefüllt und unterschrieben)'
export const AUSWEIS = 'Personalausweis (Vorder- und Rückseite)'
/** Punkt für alles, was der Kunde zusätzlich schickt (freier Text der Anforderung oder ungefragt). */
export const SONSTIGE_UNTERLAGE = 'Sonstige Unterlage'

export type KundenUnterlagenListe = { standard: string[]; weitere: string[] }

/** Nimmt nur Punkte, die es in der Erben-Checkliste wirklich gibt — so bleiben die Wörter gleich. */
function ausErbenCheckliste(punkte: string[]): string[] {
  const alle = new Set(ERBEN_CHECKLISTE.flatMap((g) => g.punkte))
  return punkte.filter((p) => alle.has(p))
}

const BERATUNG: KundenUnterlagenListe = {
  standard: [
    'Einkommensteuerbescheide der letzten 3 Jahre',
    'Jahresabschlüsse (Bilanz und GuV) der letzten 2–3 Jahre',
    'Aktuelle BWA mit Summen- und Saldenliste',
    'Kontoauszüge Geschäftskonto der letzten 12 Monate',
    'Kredit- und Darlehensverträge mit Tilgungsplänen',
    'Gewerbeanmeldung oder Handelsregisterauszug',
  ],
  weitere: [
    'Einkommensteuererklärungen der letzten 3 Jahre',
    'Gewerbesteuererklärungen der letzten 3 Jahre',
    'Aktuelle Bescheide und Schreiben des Finanzamts',
    'Kontoauszüge Privatkonto der letzten 6–12 Monate',
    'Liste der offenen Forderungen',
    'Liste der offenen Rechnungen an Lieferanten',
    'Gesellschaftsvertrag',
    'Miet-, Pacht- und Leasingverträge des Betriebs',
    'Versicherungen des Betriebs',
    'Heiratsurkunde',
    'Ehevertrag oder Nachweis zum Güterstand',
    'Unterhaltsvereinbarungen oder -urteile',
    AUSWEIS,
  ],
}

const ERBEN: KundenUnterlagenListe = {
  standard: ausErbenCheckliste([
    'Eigenhändiges oder notarielles Testament',
    'Erbvertrag',
    'Ehevertrag, Partnerschaftsvertrag oder Güterstandsvereinbarung',
    'Vorsorgevollmacht',
    'Aktuelle Grundbuchauszüge zu sämtlichen Grundstücken und Miteigentumsanteilen',
    'Steuerbescheide zur Schenkung- oder Erbschaftsteuer',
  ]),
  weitere: [
    ...ausErbenCheckliste([
      'Gemeinschaftliches Testament von Ehegatten',
      'Pflichtteilsverzichts-, Erbverzichts- oder Abfindungsvereinbarungen',
      'Patientenverfügung',
      'Betreuungsverfügung',
      'Teilungserklärung bzw. Gemeinschaftsordnung, falls vorhanden',
      'Kaufvertrag, Übertragungsurkunde oder sonstiger Erwerbsnachweis je Objekt bzw. Anteil',
      'Aktuelles Verkehrswertgutachten oder belastbare Marktwertindikation',
      'Mieterliste, Hauptmietverträge und Nachträge',
      'Gesellschaftsverträge, Satzungen und Nachfolgeklauseln',
      'Aktuelle Handelsregisterauszüge und Gesellschafterlisten',
      'Sämtliche bestehenden Darlehensverträge',
      'Aktuelle Restschuldbescheinigungen',
      'Einkommensteuer- bzw. Feststellungserklärungen der letzten drei Jahre',
      'Jahresabschlüsse, Bilanzen oder Einnahmen-Überschuss-Rechnungen der letzten drei Jahre',
      'Bewertungsgutachten oder steuerliche Wertfeststellungen',
    ]),
    AUSWEIS,
  ],
}

const BETRIEBSUEBERGABE: KundenUnterlagenListe = {
  standard: [
    'Jahresabschlüsse der letzten 3 Jahre',
    'Aktuelle BWA mit Summen- und Saldenliste',
    'Handelsregisterauszug',
    'Gesellschaftsvertrag',
    'Übersicht der Mitarbeiter (Anzahl, Aufgaben, Gehälter)',
    'Miet- und Pachtverträge des Betriebs',
  ],
  weitere: [
    'Anlagenverzeichnis',
    'Kredit- und Darlehensverträge',
    'Leasingverträge',
    'Wichtige Kunden- und Lieferantenverträge',
    'Versicherungen des Betriebs',
    'Steuerbescheide der letzten 3 Jahre',
    'Ehevertrag oder Nachweis zum Güterstand',
    'Testament oder Erbvertrag',
    AUSWEIS,
  ],
}

const BETRIEBSFORMEN: KundenUnterlagenListe = {
  standard: ['Handelsregisterauszug', 'Gesellschaftsvertrag', 'Gesellschafterliste', 'Jahresabschlüsse der letzten 2–3 Jahre', 'Gewerbeanmeldung', AUSWEIS],
  weitere: [
    'Aktuelle BWA mit Summen- und Saldenliste',
    'Steuerbescheide der letzten 3 Jahre',
    'Anstellungsvertrag des Geschäftsführers',
    'Miet- und Pachtverträge des Betriebs',
    'Kredit- und Darlehensverträge',
  ],
}

const AKADEMIE: KundenUnterlagenListe = {
  standard: [AUSWEIS, 'Anmeldung (unterschrieben)'],
  weitere: ['Lebenslauf', 'Zeugnisse und Nachweise', 'Nachweis über eine Förderung (z. B. Bildungsgutschein)', 'Bescheinigung des Arbeitgebers'],
}

const FINANZIERUNGEN: KundenUnterlagenListe = {
  standard: [
    SELBSTAUSKUNFT,
    AUSWEIS,
    'Gehaltsnachweise der letzten 3 Monate',
    'Kontoauszüge der letzten 3 Monate',
    'Einkommensteuerbescheid des letzten Jahres',
    'Nachweis über Eigenkapital',
  ],
  weitere: [
    'Arbeitsvertrag',
    'Lohnsteuerbescheinigung des letzten Jahres',
    'Einkommensteuererklärungen der letzten 2 Jahre',
    'BWA und Jahresabschlüsse der letzten 2 Jahre (bei Selbstständigen)',
    'Bestehende Kredit- und Darlehensverträge',
    'Renteninformation',
    'Nachweis über Mieteinnahmen',
    'Grundbuchauszug',
    'Kaufvertrag oder Entwurf des Kaufvertrags',
    'Unterlagen zum Objekt (Exposé, Grundrisse, Fotos)',
  ],
}

const IMMOBILIENKUNDEN: KundenUnterlagenListe = {
  standard: [SELBSTAUSKUNFT, AUSWEIS, 'Finanzierungsbestätigung der Bank', 'Nachweis über Eigenkapital'],
  weitere: [
    'Gehaltsnachweise der letzten 3 Monate',
    'Kontoauszüge der letzten 3 Monate',
    'Einkommensteuerbescheid des letzten Jahres',
    'Handelsregisterauszug (bei Firmen)',
    'Grundbuchauszug',
    'Vollmacht',
  ],
}

const PRIVAT: KundenUnterlagenListe = {
  standard: [AUSWEIS],
  weitere: [SELBSTAUSKUNFT, 'Gehaltsnachweise der letzten 3 Monate', 'Kontoauszüge der letzten 3 Monate', 'Einkommensteuerbescheid des letzten Jahres', 'Grundbuchauszug', 'Vollmacht'],
}

export const KUNDEN_UNTERLAGEN: Record<KundeBereich, KundenUnterlagenListe> = {
  beratung: BERATUNG,
  erben: ERBEN,
  betriebsuebergabe: BETRIEBSUEBERGABE,
  betriebsformen: BETRIEBSFORMEN,
  akademie: AKADEMIE,
  finanzierungen: FINANZIERUNGEN,
  immobilienkunden: IMMOBILIENKUNDEN,
  privat: PRIVAT,
}

/** Vorauswahl und weitere Punkte des Bereichs, ohne doppelte Einträge. */
export function unterlagenFuerBereich(bereich: KundeBereich): KundenUnterlagenListe {
  const liste = KUNDEN_UNTERLAGEN[bereich] ?? { standard: [], weitere: [] }
  const standard = Array.from(new Set(liste.standard))
  return { standard, weitere: Array.from(new Set(liste.weitere)).filter((p) => !standard.includes(p)) }
}
