// Gäste an Terminen per Telegram (23.11.2026): externe Gäste („Name <adresse>“ oder nur die Adresse) und der Kunde der
// verknüpften Akte bekommen eine Einladung mit Kalenderdatei und Erinnerungsmails (email-gateway/kalender.ts).

/** Eingaben des Werkzeugs → Felder für termin_speichern. Nur was angegeben ist, wird übergeben. */
export function gaesteEingabe(input: Record<string, unknown>): { gaeste?: { email: string }[]; gast_einladen?: boolean } {
  const aus: { gaeste?: { email: string }[]; gast_einladen?: boolean } = {}
  if (Array.isArray(input.gaeste)) aus.gaeste = input.gaeste.map((g) => ({ email: String(g ?? '').trim() })).filter((g) => g.email)
  if (typeof input.kunde_einladen === 'boolean') aus.gast_einladen = input.kunde_einladen
  return aus
}

/** Rückmeldung zu Einladungen für die Antwort des Werkzeugs (leer, wenn nichts passiert ist). */
export function gaesteZeile(daten: Record<string, unknown> | null | undefined): string {
  if (!daten) return ''
  const teile: string[] = []
  const eingeladen = Array.isArray(daten.gaesteEingeladen) ? (daten.gaesteEingeladen as string[]) : []
  if (eingeladen.length > 0) teile.push(`Einladung mit Kalenderdatei per Mail an: ${eingeladen.join(', ')} (Erinnerungsmail 1 Tag und 1 Stunde vorher kommt automatisch).`)
  if (daten.gastEingeladen === true) teile.push('Der Kunde aus der Akte wurde per Mail mit Kalenderdatei eingeladen (Erinnerungen kommen automatisch).')
  for (const h of [daten.gastHinweis, daten.gaesteHinweis]) if (typeof h === 'string' && h) teile.push(h)
  return teile.join(' ')
}

/** Gäste eines Termins als kurzer Text für termine_zeigen. */
export function gaesteText(t: { gaeste?: unknown; gast?: unknown }): string {
  const namen: string[] = []
  const kunde = (t.gast ?? {}) as { email?: string; eingeladen?: boolean }
  if (kunde.eingeladen && kunde.email) namen.push(`${kunde.email} (Kunde)`)
  for (const g of Array.isArray(t.gaeste) ? (t.gaeste as { email?: string; name?: string; eingeladen?: boolean }[]) : []) {
    if (g?.email) namen.push(g.name ? `${g.name} <${g.email}>` : g.email)
  }
  return namen.length > 0 ? `Gäste: ${namen.join(', ')}` : ''
}
