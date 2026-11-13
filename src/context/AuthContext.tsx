import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured, passwortFestlegenNoetig, setzePasswortFestlegenNoetig } from '../lib/supabaseClient'
import { setCurrentUser } from '../data/constants'

export type Mitarbeiter = {
  id: string
  name: string
  email: string
  rolle: 'geschaeftsfuehrung' | 'mitarbeiter'
  bereiche: string[]
  aktiv: boolean
  ist_admin: boolean
  telefon: string | null
  signatur_html: string | null
  foto_data_url: string | null
  buchungslink: string | null
}

type AuthState = {
  ready: boolean
  session: Session | null
  user: User | null
  mitarbeiter: Mitarbeiter | null
  // true, solange jemand über einen Einladungs-/Login-/Passwort-Link angemeldet ist und noch kein
  // Passwort festgelegt hat — die App zeigt dann nur den Schritt "Passwort festlegen".
  passwortFestlegen: boolean
  passwortFestgelegt: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isSupabaseConfigured)
  const [session, setSession] = useState<Session | null>(null)
  const [mitarbeiter, setMitarbeiter] = useState<Mitarbeiter | null>(null)
  const [passwortFestlegen, setPasswortFestlegen] = useState(passwortFestlegenNoetig)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setzePasswortFestlegenNoetig(true)
        setPasswortFestlegen(true)
      }
      if (event === 'SIGNED_OUT') {
        setzePasswortFestlegenNoetig(false)
        setPasswortFestlegen(false)
      }
      setSession(newSession)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !session?.user?.email) {
      setMitarbeiter(null)
      return
    }
    let cancelled = false
    supabase
      .from('mitarbeiter')
      .select('id, name, email, rolle, bereiche, aktiv, ist_admin, telefon, signatur_html, foto_data_url, buchungslink')
      .eq('email', session.user.email)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setMitarbeiter(data as Mitarbeiter | null)
      })
    return () => {
      cancelled = true
    }
  }, [session?.user?.email])

  // Aktivitäts-Logs/Signaturen im ganzen CRM verwenden CURRENT_USER als Akteur-Namen — ohne das
  // hier zu setzen, bliebe es für immer beim ursprünglichen Demo-Platzhalter (siehe constants.ts).
  useEffect(() => {
    if (mitarbeiter?.name) setCurrentUser(mitarbeiter.name)
  }, [mitarbeiter?.name])

  const value: AuthState = {
    ready,
    session,
    user: session?.user ?? null,
    mitarbeiter,
    passwortFestlegen,
    passwortFestgelegt() {
      setzePasswortFestlegenNoetig(false)
      setPasswortFestlegen(false)
    },
    async signOut() {
      // Nur dieses Gerät abmelden. Ohne die Angabe meldet Supabase ALLE Geräte ab: Wer sich am
      // Laptop abmeldete, musste danach auch am Handy das Passwort neu eingeben.
      await supabase?.auth.signOut({ scope: 'local' })
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden')
  return ctx
}
