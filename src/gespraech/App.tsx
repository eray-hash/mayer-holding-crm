// Gesprächs-App „Mayer Gespräch“: eigener Einstieg (gespraech/index.html), gleiche Anmeldung wie das CRM
// (AuthProvider, LoginScreen, PasswortFestlegen werden mitbenutzt). Seiten siehe typen.ts (Adressen).
import { useEffect, type ReactNode } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { House, ListChecks, LoaderCircle, Settings } from 'lucide-react'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { LoginScreen } from '../pages/auth/LoginScreen'
import { PasswortFestlegen } from '../pages/auth/PasswortFestlegen'
import { AufnahmenListe } from './auswertung/AufnahmenListe'
import { Aufnehmen } from './seiten/Aufnehmen'
import { AufnahmeRoute } from './seiten/AufnahmeRoute'
import { Einstellungen } from './seiten/Einstellungen'
import { Start } from './seiten/Start'
import { useSitzung, vorbereiten } from './sitzung'
import { Vorbereitung } from './auswertung/Vorbereitung'
import { richteHochladenEin, setzePerson } from './uploader'

function Mitte({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center text-sm text-slate-600">{children}</div>
}

function Tor() {
  const { ready, session, mitarbeiter, passwortFestlegen, signOut } = useAuth()
  const email = mitarbeiter?.aktiv ? mitarbeiter.email : null

  useEffect(() => {
    setzePerson(email)
    if (email) richteHochladenEin()
  }, [email])

  if (!isSupabaseConfigured) return <Mitte>Die Gesprächs-App braucht die Verbindung zur Datenbank (Einstellungen fehlen).</Mitte>
  if (!ready)
    return (
      <Mitte>
        <LoaderCircle className="h-6 w-6 animate-spin" /> Lädt …
      </Mitte>
    )
  if (!session) return <LoginScreen />
  if (!mitarbeiter || !mitarbeiter.aktiv)
    return (
      <Mitte>
        <p>{session.user.email} ist angemeldet, aber (noch) nicht als aktiver Mitarbeiter hinterlegt.</p>
        <button onClick={() => void signOut()} className="font-medium text-accent-600">
          Abmelden
        </button>
      </Mitte>
    )
  if (passwortFestlegen) return <PasswortFestlegen />
  return <Rahmen />
}

function Rahmen() {
  const ort = useLocation()
  const s = useSitzung()
  const nimmtAuf = ort.pathname === '/aufnehmen' && s.automat.phase !== 'bereit'
  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="mx-auto flex max-w-md items-center gap-2">
          <img src="./icons/icon-192.png" alt="" className="h-7 w-7 rounded-lg" />
          <span className="text-base font-semibold text-slate-900">Mayer Gespräch</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-4" style={{ paddingBottom: nimmtAuf ? 'max(1.5rem, env(safe-area-inset-bottom))' : 'calc(5rem + env(safe-area-inset-bottom))' }}>
        <Routes>
          <Route path="/" element={<Start />} />
          <Route path="/aufnehmen" element={<Aufnehmen />} />
          <Route path="/aufnahme/:id" element={<AufnahmeRoute />} />
          <Route path="/aufnahmen" element={<AufnahmenListe />} />
          <Route path="/einstellungen" element={<Einstellungen />} />
          <Route path="/vorbereitung" element={<VorbereitungRoute />} />
          <Route path="*" element={<Start />} />
        </Routes>
      </main>
      {!nimmtAuf && (
        <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="mx-auto grid max-w-md grid-cols-3">
            {[
              { to: '/', text: 'Start', Icon: House },
              { to: '/aufnahmen', text: 'Meine Aufnahmen', Icon: ListChecks },
              { to: '/einstellungen', text: 'Einstellungen', Icon: Settings },
            ].map(({ to, text, Icon }) => (
              <NavLink key={to} to={to} end className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'text-accent-600' : 'text-slate-500'}`}>
                <Icon className="h-5 w-5" />
                {text}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

/** Vorbereitung eines Termins (Briefing), danach direkt in die Aufnahme. */
function VorbereitungRoute() {
  const navigate = useNavigate()
  return <Vorbereitung onAufnahme={(v) => { vorbereiten(v); navigate('/aufnehmen') }} />
}

export default function GespraechApp() {
  return (
    <AuthProvider>
      <HashRouter>
        <Tor />
      </HashRouter>
    </AuthProvider>
  )
}
