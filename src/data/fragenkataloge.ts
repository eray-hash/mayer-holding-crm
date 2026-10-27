import { uid } from '../lib/dates'
import type { FragenkatalogFrage } from '../types'

// Vorbelegter Fragenkatalog (Selbstauskunft) je Bereich — im CRM über den "Fragenkatalog"-Editor
// frei anpassbar. Inhaltlich an den in den jeweiligen Bereichen üblichen Selbstauskunft-/
// Erstgesprächs-Angaben orientiert (allgemeines Fachwissen, keine Rechts-/Steuerberatung).
function f(bereich: FragenkatalogFrage['bereich'], text: string, typ: FragenkatalogFrage['typ'], pflichtfeld: boolean, optionen?: string[]): FragenkatalogFrage {
  return { id: uid('fk'), bereich, text, typ, pflichtfeld, ...(optionen ? { optionen } : {}) }
}

export const DEFAULT_FRAGENKATALOG: FragenkatalogFrage[] = [
  // Unternehmensberatung
  f('beratung', 'Branche', 'text', true),
  f('beratung', 'Anzahl Mitarbeiter', 'zahl', false),
  f('beratung', 'Ungefährer Jahresumsatz (€)', 'zahl', false),
  f('beratung', 'Hauptziel der Beratung', 'text', true),
  f('beratung', 'Aktuell größte Herausforderung', 'text', false),

  // Erben
  f('erben', 'Familienstand', 'auswahl', true, ['Ledig', 'Verheiratet', 'Geschieden', 'Verwitwet']),
  f('erben', 'Anzahl Kinder/Erben', 'zahl', false),
  f('erben', 'Ist bereits ein Testament vorhanden?', 'auswahl', true, ['Ja', 'Nein', 'Unsicher']),
  f('erben', 'Geschätzter Gesamtvermögenswert (€)', 'zahl', false),
  f('erben', 'Immobilienbesitz vorhanden?', 'auswahl', false, ['Ja', 'Nein']),

  // Betriebsübergabe
  f('betriebsuebergabe', 'Aktuelle Rechtsform des Unternehmens', 'text', true),
  f('betriebsuebergabe', 'Anzahl Gesellschafter', 'zahl', false),
  f('betriebsuebergabe', 'Geplanter Übergabezeitpunkt', 'text', false),
  f('betriebsuebergabe', 'Ist ein Nachfolger bereits bestimmt?', 'auswahl', true, ['Ja', 'Nein', 'In Prüfung']),
  f('betriebsuebergabe', 'Geschätzter Unternehmenswert (€)', 'zahl', false),

  // Betriebsformen
  f('betriebsformen', 'Aktuelle Rechtsform', 'text', true),
  f('betriebsformen', 'Anzahl Gesellschafter', 'zahl', false),
  f('betriebsformen', 'Bestehen aktuell Haftungsbedenken?', 'auswahl', false, ['Ja', 'Nein', 'Unsicher']),
  f('betriebsformen', 'Ist eine Umstrukturierung geplant?', 'auswahl', false, ['Ja', 'Nein', 'Unsicher']),

  // Akademie
  f('akademie', 'Gewünschte Schulungsthemen', 'text', true),
  f('akademie', 'Anzahl Teilnehmer', 'zahl', false),
  f('akademie', 'Bevorzugter Zeitraum', 'text', false),
  f('akademie', 'Bisherige Erfahrung mit vergleichbaren Weiterbildungen', 'text', false),

  // Finanzierungen
  f('finanzierungen', 'Finanzierungsvorhaben', 'text', true),
  f('finanzierungen', 'Benötigte Summe (€)', 'zahl', true),
  f('finanzierungen', 'Vorhandenes Eigenkapital (€)', 'zahl', false),
  f('finanzierungen', 'Gewünschte Laufzeit', 'text', false),
]
