import type { Kunde } from '../types'

// Privat-Bereich: bewusst leer statt mit Demo-Daten befüllt — jeder Mitarbeiter sieht hier nur
// seine eigenen, erst selbst angelegten Kontakte (siehe RLS-Policy "privat kunden lesen").
export const seedPrivatKunden: Kunde[] = []
