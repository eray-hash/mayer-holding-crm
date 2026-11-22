// Gesprächs-App „Mayer Gespräch“: eigener Einstieg (gespraech/index.html), gleiche Anmeldung wie das CRM
// (AuthProvider, LoginScreen, PasswortFestlegen werden mitbenutzt). Seiten siehe typen.ts (Adressen).
import { useEffect, useMemo, type ReactNode } from 'react'
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
import { nimmtAuf, useSitzung, vorbereiten } from './sitzung'
import { leseAufnehmenZiel } from '../../supabase/functions/_shared/gespraechLink.ts'
import { loeseDirektLinkAuf } from './direktLink'
import { direktLader } from './direktLinkLader'
import { einstellungen } from './einstellungen'
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
          <Route path="/aufnehmen" element={<AufnehmenEinstieg />} />
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

/**
 * #/aufnehmen — mit Direkt-Link (?termin=…|kunde=…|objekt=…&art=…, siehe _shared/gespraechLink.ts) wird die
 * Aufnahme vorbereitet und es geht gleich zur Einwilligung; Aufnehmen.tsx liest dann nur die vorbereitete Sitzung.
 * Läuft schon eine Aufnahme, bleibt sie unberührt. Ist etwas aus dem Link nicht auffindbar, kommt die Startseite
 * mit allem Übrigen vorbelegt und einem Hinweis. Danach wird der Suchteil entfernt (neu laden startet nichts neu).
 */
function AufnehmenEinstieg() {
  const ort = useLocation()
  const navigate = useNavigate()
  const { mitarbeiter } = useAuth()
  const ziel = useMemo(() => leseAufnehmenZiel(ort.search), [ort.search])
  const email = mitarbeiter?.email ?? ''

  useEffect(() => {
    if (!ziel) return
    if (nimmtAuf()) {
      navigate('/aufnehmen', { replace: true })
      return
    }
    let aktiv = true
    void loeseDirektLinkAuf(ziel, direktLader(email), einstellungen().standardModus).then(({ vorbereitung, hinweis }) => {
      if (!aktiv) return
      if (hinweis) {
        navigate('/', { replace: true, state: { vorbelegung: vorbereitung, hinweis } })
        return
      }
      try {
        vorbereiten(vorbereitung)
        navigate('/aufnehmen', { replace: true })
      } catch (err) {
        navigate('/', { replace: true, state: { hinweis: err instanceof Error ? err.message : String(err) } })
      }
    })
    return () => {
      aktiv = false
    }
  }, [ziel, email, navigate])

  if (ziel)
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-slate-600">
        <LoaderCircle className="h-8 w-8 animate-spin" />
        <div className="text-sm">Aufnahme wird vorbereitet …</div>
      </div>
    )
  return <Aufnehmen />
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
