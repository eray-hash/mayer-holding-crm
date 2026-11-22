// Automatische Nachrichten der Akademie an Seminar-Teilnehmer (22.11.2026). Vorgemerkt von der Datenbank
// (Auslöser an_seminar_anmeldungen / an_seminar_termine, nur wenn die Regel an ist), verschickt vom selben
// Minutentakt wie die Immobilien-Nachrichten (autoNachrichten.ts). Hier: Passt der Anlass noch, und mit
// welcher Datenbank-Funktion wird der Text frisch zusammengesetzt?

// deno-lint-ignore no-explicit-any
type Admin = any

export const SEMINAR_REGELN = ['akademie_seminar_bestaetigung', 'akademie_seminar_warteliste', 'akademie_seminar_erinnerung', 'akademie_seminar_absage'] as const

export function istSeminarRegel(regel: unknown): boolean {
  return typeof regel === 'string' && (SEMINAR_REGELN as readonly string[]).includes(regel)
}

const ANMELDUNG_NAME: Record<string, string> = { angemeldet: 'angemeldet', bestaetigt: 'bestätigt', warteliste: 'Warteliste', storniert: 'storniert', teilgenommen: 'teilgenommen' }
const TERMIN_NAME: Record<string, string> = { geplant: 'geplant', abgesagt: 'abgesagt', durchgefuehrt: 'durchgeführt' }

/** Passt der Anlass noch? Liefert den Grund, warum nicht — oder null. */
// deno-lint-ignore no-explicit-any
export async function pruefeSeminarAnlass(admin: Admin, zeile: any, jetzt = Date.now()): Promise<string | null> {
  if (!zeile.anmeldung_id) return 'Anmeldung gibt es nicht mehr'
  const { data: a } = await admin.from('seminar_anmeldungen').select('id, termin_id, status').eq('id', zeile.anmeldung_id).maybeSingle()
  if (!a) return 'Anmeldung gibt es nicht mehr'
  const { data: t } = await admin.from('seminar_termine').select('id, status, beginn').eq('id', a.termin_id).maybeSingle()
  if (!t) return 'Termin gibt es nicht mehr'
  const beginn = new Date(t.beginn).getTime()
  const anmeldung = `Anmeldung steht jetzt auf „${ANMELDUNG_NAME[a.status] ?? a.status}“`
  const termin = `Termin steht jetzt auf „${TERMIN_NAME[t.status] ?? t.status}“`
  switch (zeile.regel) {
    case 'akademie_seminar_bestaetigung':
    case 'akademie_seminar_erinnerung':
      if (t.status !== 'geplant') return termin
      if (!['angemeldet', 'bestaetigt'].includes(a.status)) return anmeldung
      if (!(beginn > jetzt)) return 'Termin ist schon vorbei'
      return null
    case 'akademie_seminar_warteliste':
      if (t.status !== 'geplant') return termin
      if (a.status !== 'warteliste') return anmeldung
      if (!(beginn > jetzt)) return 'Termin ist schon vorbei'
      return null
    case 'akademie_seminar_absage':
      if (t.status !== 'abgesagt') return termin
      if (['storniert', 'teilgenommen'].includes(a.status)) return anmeldung
      return null
    default:
      return 'Unbekannte Regel'
  }
}

/** Text frisch zusammensetzen (Datenbank-Funktion seminar_nachricht_bauen). Gleiche Antwortform wie auto_nachricht_bauen. */
// deno-lint-ignore no-explicit-any
export function baueSeminarNachricht(admin: Admin, zeile: any): Promise<{ data: any; error: { message: string } | null }> {
  return admin.rpc('seminar_nachricht_bauen', { p_regel: zeile.regel, p_anmeldung: zeile.anmeldung_id ?? null })
}
