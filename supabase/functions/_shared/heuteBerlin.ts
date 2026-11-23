// Heutiges Kalenderdatum in Deutschland (YYYY-MM-DD). Der Server läuft in UTC: zwischen 0 und 1 Uhr
// (Sommer: 2 Uhr) wäre toISOString() noch der Vortag.
export function heuteBerlin(jetzt = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(jetzt)
}
