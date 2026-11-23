// Anfangsstatus einer neuen Akte je Kundenakten-Bereich (Server-Seite).
//
// Muss zum ersten Schritt des Hauptpfads in src/data/statusNetworks.ts passen — sonst kennt die Liste
// des Bereichs den Status nicht. (Bis 23.11.2026 legte die automatische Lead-Erkennung in
// email-gateway/index.ts jede Akte mit „lead“ an, auch in Erben, Akademie usw.; „lead“ gibt es aber
// nur in der Beratung.) Geprüft in src/data/startStatus.test.ts.
//
// Gleiche Werte stehen noch als eigene Kopie in telegram-gateway/index.ts (START_STATUS) und
// email-gateway/gespraechUebernehmen.ts (START_STATUS).
export const START_STATUS: Record<string, string> = {
  beratung: 'lead',
  erben: 'erstkontakt',
  betriebsuebergabe: 'erstkontakt',
  betriebsformen: 'erstkontakt',
  akademie: 'interessent',
  finanzierungen: 'interessent',
  immobilienkunden: 'interessent',
  privat: 'neu',
}

/** Anfangsstatus für eine neue Akte im Bereich `bereich` (Werte wie kunden.bereich). */
export function startStatusFuer(bereich: string): string {
  return START_STATUS[bereich] ?? START_STATUS.beratung
}
