import { isSupabaseConfigured } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'

// Wer die Seite „Automatische Nachrichten“ sieht: Geschäftsführung, Admin oder Superuser — immer der wirklich
// angemeldete Mensch (auch während „Ansehen als …“). Ändern nur ohne „Ansehen als …“; der Server prüft es ebenfalls.
// zugang null = Login noch nicht geladen.
export function useAutomatikZugang(): { zugang: boolean | null; darfAendern: boolean; wer: string } {
  const { session, echterMitarbeiter, istSuperuser, ansichtAls } = useAuth()
  if (!isSupabaseConfigured || !session) return { zugang: false, darfAendern: false, wer: '' }
  if (!echterMitarbeiter) return { zugang: null, darfAendern: false, wer: '' }
  const zugang = echterMitarbeiter.rolle === 'geschaeftsfuehrung' || !!echterMitarbeiter.ist_admin || istSuperuser
  return { zugang, darfAendern: zugang && !ansichtAls, wer: echterMitarbeiter.name ?? session.user.email ?? '' }
}
