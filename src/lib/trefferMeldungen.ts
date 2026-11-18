// Kleine Helfer rund um die vom Server gemeldeten Treffer (state.trefferMeldungen). Der Server hält
// je Paar aus Gesuch und Objekt eine Meldung fest (supabase/functions/email-gateway/gesuchTreffer.ts);
// hier wird nur entschieden, welche davon auf der Seite „Gesuche“ als neu hervorgehoben werden.
import type { TrefferMeldung } from '../types'

/** So viele Tage gilt ein Treffer als neu. */
export const NEU_TAGE = 7

export function paarSchluessel(gesuchId: string, objektId: string): string {
  return `${gesuchId}|${objektId}`
}

function zeit(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/**
 * Die Meldungen, die als neu gelten — neueste zuerst.
 *
 * Regel: in den letzten sieben Tagen entdeckt UND nicht Teil des stillen Erststands.
 * Beim allerersten Lauf hält der Server alle damals schon vorhandenen Treffer auf einmal fest, alle
 * mit demselben Zeitpunkt — und der ist zwangsläufig der älteste der ganzen Liste. Nach dem Erststand
 * entdeckt ist also, was einen späteren Zeitpunkt trägt als diesen ältesten.
 * Die andere denkbare Regel („nur Meldungen, zu denen jemand per Telegram benachrichtigt wurde“)
 * würde genau die Treffer verschweigen, bei denen niemand erreichbar war — dort ist der Hinweis auf
 * der Seite am nötigsten. Sie gilt hier nur zusätzlich: Wurde jemand benachrichtigt, war es sicher
 * kein Erststand. Das fängt den seltenen Fall ab, dass es beim Erststand gar keinen Treffer gab und
 * der erste echte Treffer deshalb selbst den ältesten Zeitpunkt trägt.
 */
export function neueTrefferMeldungen(meldungen: TrefferMeldung[], jetzt: Date = new Date()): TrefferMeldung[] {
  if (meldungen.length === 0) return []
  const grenze = jetzt.getTime() - NEU_TAGE * 24 * 60 * 60 * 1000
  const erststand = meldungen.reduce((min, m) => Math.min(min, zeit(m.entdecktAm)), Infinity)
  return meldungen
    .filter((m) => zeit(m.entdecktAm) >= grenze && (zeit(m.entdecktAm) > erststand || (m.gemeldetAn ?? []).length > 0))
    .sort((a, b) => zeit(b.entdecktAm) - zeit(a.entdecktAm))
}

/** Der Tag der Entdeckung, so wie er hier auf dem Kalender steht („17.11.2026“). */
export function entdecktText(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
