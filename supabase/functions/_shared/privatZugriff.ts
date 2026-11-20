// Regeln für private Daten auf dem Server (Bereich Privat, seit 20.11.2026).
//
// Die Edge Functions arbeiten mit Dienstrechten und umgehen damit die Regeln der Datenbank. Was die
// Datenbank für angemeldete Nutzer selbst durchsetzt, muss der Server deshalb hier nachprüfen:
// - Private Objekte (`objekte.privat_besitzer` gesetzt) sieht nur ihr Besitzer — auch keine
//   Geschäftsführung. Mayer-Objekte (`privat_besitzer` leer) sieht, wer den Bereich Immobilien darf.
// - Private Kontakte (`kunden.bereich = 'privat'`) sieht nur, wer in `verantwortlich_email` steht.
// Verglichen wird die Login-Adresse ohne Rücksicht auf Groß- und Kleinschreibung.

/** Adresse vergleichbar machen: ohne Leerraum, klein geschrieben. */
export function normalisiereAdresse(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

/** Ein Objekt ist privat, sobald ein Besitzer eingetragen ist. */
export function istPrivatesObjekt(o: { privat_besitzer?: string | null } | null | undefined): boolean {
  return !!normalisiereAdresse(o?.privat_besitzer)
}

/** Darf diese Person das Objekt sehen oder bearbeiten? Privat: nur der Besitzer. Mayer-Objekt: wer Immobilien darf. */
export function darfObjekt(o: { privat_besitzer?: string | null }, email: string, darfImmobilien: boolean): boolean {
  const besitzer = normalisiereAdresse(o?.privat_besitzer)
  if (besitzer) return !!normalisiereAdresse(email) && besitzer === normalisiereAdresse(email)
  return darfImmobilien
}

/** Ein Kontakt ist privat, wenn er im Bereich „privat“ liegt. */
export function istPrivaterKunde(k: { bereich?: string | null } | null | undefined): boolean {
  return k?.bereich === 'privat'
}

/** Darf diese Person den Kontakt sehen? Nur für private Kontakte entscheidend: dann nur der Besitzer.
 *  Für alle anderen Kontakte true — dort gelten die Bereichsrechte (darfBereichServer). */
export function darfPrivatKunde(k: { bereich?: string | null; verantwortlich_email?: string | null }, email: string): boolean {
  if (!istPrivaterKunde(k)) return true
  const besitzer = normalisiereAdresse(k.verantwortlich_email)
  return !!besitzer && besitzer === normalisiereAdresse(email)
}

/** Nur die Mayer-Objekte einer Liste (für Auswertungen und Abläufe, die für alle Mitarbeiter gelten). */
export function nurMayerObjekte<T extends { privat_besitzer?: string | null }>(liste: T[]): T[] {
  return liste.filter((o) => !istPrivatesObjekt(o))
}

/** Nur die Kontakte, die nicht privat sind. */
export function nurMayerKunden<T extends { bereich?: string | null }>(liste: T[]): T[] {
  return liste.filter((k) => !istPrivaterKunde(k))
}
