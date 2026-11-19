import { isSupabaseConfigured } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'

// Ob der wirklich angemeldete Mitarbeiter Superuser ist (mitarbeiter.ist_superuser, aus AuthContext —
// auch während „Ansehen als …“ zählt der echte Mensch). null = Login noch nicht geladen.
export function useIstSuperuser(): boolean | null {
  const { echterMitarbeiter, istSuperuser, session } = useAuth()
  if (!isSupabaseConfigured) return false
  if (session && !echterMitarbeiter) return null
  return istSuperuser
}
