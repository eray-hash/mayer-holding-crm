import { type ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PortalAuthProvider, usePortalAuth } from './context/PortalAuthContext'
import { RollenAuswahl } from './pages/auth/RollenAuswahl'
import { LoginScreen } from './pages/auth/LoginScreen'
import { isSupabaseConfigured } from './lib/supabaseClient'
import { Layout } from './components/Layout'
import { PortalLayout } from './components/PortalLayout'
import { KundenListe } from './pages/beratung/KundenListe'
import { KundenDetail } from './pages/beratung/KundenDetail'
import { VorlagenPage } from './pages/beratung/VorlagenPage'
import { Mahnwesen } from './pages/beratung/Mahnwesen'
import { Rechnungen } from './pages/beratung/Rechnungen'
import { Leistungen } from './pages/beratung/Leistungen'
import { ObjektListe } from './pages/immobilien/ObjektListe'
import { ObjektDetail } from './pages/immobilien/ObjektDetail'
import { Finanzierungen } from './pages/immobilien/Finanzierungen'
import { VorlagenPageImmobilien } from './pages/immobilien/VorlagenPageImmobilien'
import { ErbenListe } from './pages/erben/ErbenListe'
import { ErbenDetail } from './pages/erben/ErbenDetail'
import { VorlagenPageErben } from './pages/erben/VorlagenPageErben'
import { BetriebsuebergabeListe } from './pages/betriebsuebergabe/BetriebsuebergabeListe'
import { BetriebsuebergabeDetail } from './pages/betriebsuebergabe/BetriebsuebergabeDetail'
import { VorlagenPageBetriebsuebergabe } from './pages/betriebsuebergabe/VorlagenPageBetriebsuebergabe'
import { BetriebsformenListe } from './pages/betriebsformen/BetriebsformenListe'
import { BetriebsformenDetail } from './pages/betriebsformen/BetriebsformenDetail'
import { VorlagenPageBetriebsformen } from './pages/betriebsformen/VorlagenPageBetriebsformen'
import { AkademieListe } from './pages/akademie/AkademieListe'
import { AkademieDetail } from './pages/akademie/AkademieDetail'
import { VorlagenPageAkademie } from './pages/akademie/VorlagenPageAkademie'
import { FinanzierungenListe } from './pages/finanzierungen/FinanzierungenListe'
import { FinanzierungenDetail } from './pages/finanzierungen/FinanzierungenDetail'
import { VorlagenPageFinanzierungen } from './pages/finanzierungen/VorlagenPageFinanzierungen'
import { PrivatListe } from './pages/privat/PrivatListe'
import { PrivatDetail } from './pages/privat/PrivatDetail'
import { ToDoListe, BereichToDoListe } from './pages/todo/ToDoListe'
import { HeuteScreen } from './pages/heute/HeuteScreen'
import { Postfach } from './pages/postfach/Postfach'
import { Kampagnen } from './pages/kampagnen/Kampagnen'
import { MeinProfil } from './pages/profil/MeinProfil'
import { MitarbeiterVerwalten } from './pages/admin/MitarbeiterVerwalten'
import { ProjekteListe } from './pages/projekte/ProjekteListe'
import { PortalLogin } from './pages/portal/PortalLogin'
import { PortalMagicLink } from './pages/portal/PortalMagicLink'
import { PortalOverview } from './pages/portal/PortalOverview'
import { PortalRendite } from './pages/portal/PortalRendite'
import { PortalAuszahlungen } from './pages/portal/PortalAuszahlungen'
import { PortalDokumente } from './pages/portal/PortalDokumente'
import { PublicFeedbackbogen } from './pages/formulare/PublicFeedbackbogen'
import { PublicVollmachtErben } from './pages/formulare/PublicVollmachtErben'
import { PublicExpose } from './pages/formulare/PublicExpose'
import { PublicMandantenfragebogenErben } from './pages/formulare/PublicMandantenfragebogenErben'
import { PublicVollmachtBeratung } from './pages/formulare/PublicVollmachtBeratung'
import { PublicSelbstauskunft } from './pages/formulare/PublicSelbstauskunft'
import { PublicEigentuemerPortal } from './pages/formulare/PublicEigentuemerPortal'
import { PublicNda } from './pages/formulare/PublicNda'
import type { Bereich } from './types'

function RootRedirect() {
  return <Navigate to="/heute" replace />
}

function AdminRoutesContent() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/heute" element={<HeuteScreen />} />
        <Route path="/postfach" element={<Postfach />} />
        <Route path="/kampagnen" element={<Kampagnen />} />
        <Route path="/profil" element={<MeinProfil />} />
        <Route path="/mitarbeiter" element={<RequireAdmin><MitarbeiterVerwalten /></RequireAdmin>} />

        {/* Privat: bewusst NICHT per RequireBereich beschränkt — jeder Mitarbeiter hat seinen
            eigenen, persönlichen Bereich, das ist keine von der GF zuteilbare Berechtigung.
            Sichtbarkeit wird stattdessen über RLS in Supabase erzwungen (siehe crmSync.ts). */}
        <Route path="/privat" element={<PrivatListe />} />
        <Route path="/privat/kontakte/:id" element={<PrivatDetail />} />
        <Route path="/privat/todo" element={<ToDoListe />} />

        <Route path="/beratung" element={<RequireBereich bereich="beratung"><KundenListe /></RequireBereich>} />
        <Route path="/beratung/kunden/:id" element={<RequireBereich bereich="beratung"><KundenDetail /></RequireBereich>} />
        <Route path="/beratung/vorlagen/:kind" element={<RequireBereich bereich="beratung"><VorlagenPage /></RequireBereich>} />
        <Route path="/beratung/mahnwesen" element={<RequireBereich bereich="beratung"><Mahnwesen /></RequireBereich>} />
        <Route path="/beratung/rechnungen" element={<RequireBereich bereich="beratung"><Rechnungen /></RequireBereich>} />
        <Route path="/beratung/leistungen" element={<RequireBereich bereich="beratung"><Leistungen /></RequireBereich>} />
        <Route path="/beratung/projekte" element={<RequireBereich bereich="beratung"><ProjekteListe /></RequireBereich>} />
        <Route path="/beratung/todo" element={<RequireBereich bereich="beratung"><BereichToDoListe bereich="beratung" label="Unternehmensberatung" /></RequireBereich>} />

        <Route path="/immobilien" element={<RequireBereich bereich="immobilien"><ObjektListe /></RequireBereich>} />
        <Route path="/immobilien/objekte/:id" element={<RequireBereich bereich="immobilien"><ObjektDetail /></RequireBereich>} />
        <Route path="/immobilien/finanzierungen" element={<RequireBereich bereich="immobilien"><Finanzierungen /></RequireBereich>} />
        <Route path="/immobilien/vorlagen/:kind" element={<RequireBereich bereich="immobilien"><VorlagenPageImmobilien /></RequireBereich>} />
        <Route path="/immobilien/projekte" element={<RequireBereich bereich="immobilien"><ProjekteListe /></RequireBereich>} />

        <Route path="/erben" element={<RequireBereich bereich="erben"><ErbenListe /></RequireBereich>} />
        <Route path="/erben/mandanten/:id" element={<RequireBereich bereich="erben"><ErbenDetail /></RequireBereich>} />
        <Route path="/erben/vorlagen/:kind" element={<RequireBereich bereich="erben"><VorlagenPageErben /></RequireBereich>} />
        <Route path="/erben/projekte" element={<RequireBereich bereich="erben"><ProjekteListe /></RequireBereich>} />
        <Route path="/erben/todo" element={<RequireBereich bereich="erben"><BereichToDoListe bereich="erben" label="Erben" /></RequireBereich>} />

        <Route path="/betriebsuebergabe" element={<RequireBereich bereich="betriebsuebergabe"><BetriebsuebergabeListe /></RequireBereich>} />
        <Route path="/betriebsuebergabe/mandanten/:id" element={<RequireBereich bereich="betriebsuebergabe"><BetriebsuebergabeDetail /></RequireBereich>} />
        <Route path="/betriebsuebergabe/vorlagen/:kind" element={<RequireBereich bereich="betriebsuebergabe"><VorlagenPageBetriebsuebergabe /></RequireBereich>} />
        <Route path="/betriebsuebergabe/projekte" element={<RequireBereich bereich="betriebsuebergabe"><ProjekteListe /></RequireBereich>} />
        <Route path="/betriebsuebergabe/todo" element={<RequireBereich bereich="betriebsuebergabe"><BereichToDoListe bereich="betriebsuebergabe" label="Betriebsübergabe" /></RequireBereich>} />

        <Route path="/betriebsformen" element={<RequireBereich bereich="betriebsformen"><BetriebsformenListe /></RequireBereich>} />
        <Route path="/betriebsformen/mandanten/:id" element={<RequireBereich bereich="betriebsformen"><BetriebsformenDetail /></RequireBereich>} />
        <Route path="/betriebsformen/vorlagen/:kind" element={<RequireBereich bereich="betriebsformen"><VorlagenPageBetriebsformen /></RequireBereich>} />
        <Route path="/betriebsformen/projekte" element={<RequireBereich bereich="betriebsformen"><ProjekteListe /></RequireBereich>} />
        <Route path="/betriebsformen/todo" element={<RequireBereich bereich="betriebsformen"><BereichToDoListe bereich="betriebsformen" label="Betriebsformen" /></RequireBereich>} />

        <Route path="/akademie" element={<RequireBereich bereich="akademie"><AkademieListe /></RequireBereich>} />
        <Route path="/akademie/teilnehmer/:id" element={<RequireBereich bereich="akademie"><AkademieDetail /></RequireBereich>} />
        <Route path="/akademie/vorlagen/:kind" element={<RequireBereich bereich="akademie"><VorlagenPageAkademie /></RequireBereich>} />
        <Route path="/akademie/projekte" element={<RequireBereich bereich="akademie"><ProjekteListe /></RequireBereich>} />
        <Route path="/akademie/todo" element={<RequireBereich bereich="akademie"><BereichToDoListe bereich="akademie" label="Akademie" /></RequireBereich>} />

        <Route path="/finanzierungen" element={<RequireBereich bereich="finanzierungen"><FinanzierungenListe /></RequireBereich>} />
        <Route path="/finanzierungen/mandanten/:id" element={<RequireBereich bereich="finanzierungen"><FinanzierungenDetail /></RequireBereich>} />
        <Route path="/finanzierungen/vorlagen/:kind" element={<RequireBereich bereich="finanzierungen"><VorlagenPageFinanzierungen /></RequireBereich>} />
        <Route path="/finanzierungen/projekte" element={<RequireBereich bereich="finanzierungen"><ProjekteListe /></RequireBereich>} />
        <Route path="/finanzierungen/todo" element={<RequireBereich bereich="finanzierungen"><BereichToDoListe bereich="finanzierungen" label="Finanzierungen" /></RequireBereich>} />

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Layout>
  )
}

function LadeBildschirm({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
      {text}
    </div>
  )
}

function ZugangGesperrt({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="mb-2 text-lg font-semibold text-slate-800">Zugang noch nicht freigeschaltet</h1>
        <p className="mb-4 text-sm text-slate-500">
          {email} ist angemeldet, aber (noch) nicht als aktiver Mitarbeiter hinterlegt. Bitte bei der Geschäftsführung melden.
        </p>
        <button onClick={onSignOut} className="text-sm font-medium text-accent-600 hover:underline">
          Abmelden
        </button>
      </div>
    </div>
  )
}

// Echter Mitarbeiter-Login, sobald Supabase konfiguriert ist (siehe lib/supabaseClient.ts) — ohne
// Konfiguration (z.B. lokale Entwicklung ohne .env.local) bleibt der bisherige reine Rollenpicker
// als Demo-Modus aktiv, damit lokales Arbeiten ohne echte Zugangsdaten weiter funktioniert.
function AdminRoutes() {
  const { state, hydrated, hydrateError } = useApp()
  const { ready, session, mitarbeiter, signOut } = useAuth()

  if (!isSupabaseConfigured) {
    if (!state.rolle) return <RollenAuswahl />
    return <AdminRoutesContent />
  }

  if (!ready) return <LadeBildschirm text="Lädt …" />
  if (!session) return <LoginScreen />
  if (!mitarbeiter || !mitarbeiter.aktiv) return <ZugangGesperrt email={session.user.email ?? ''} onSignOut={signOut} />
  if (!hydrated) return <LadeBildschirm text="Daten werden geladen …" />
  if (hydrateError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">
          Daten konnten nicht geladen werden: {hydrateError}
        </div>
      </div>
    )
  }
  return <AdminRoutesContent />
}

// Setzt mitarbeiter.bereiche/ist_admin tatsächlich am Routing durch (Beschluss 2026-11-02) — bis
// dahin sah ein eingeloggter Mitarbeiter trotz gesetzter Felder jeden Bereich. Im Demo-Modus (ohne
// Supabase) gibt es keine Mitarbeiter-Zugriffssteuerung, also ungefiltert durchlassen.
function RequireBereich({ bereich, children }: { bereich: Bereich; children: ReactNode }) {
  const { mitarbeiter } = useAuth()
  if (!isSupabaseConfigured) return <>{children}</>
  const erlaubt = !mitarbeiter || mitarbeiter.rolle === 'geschaeftsfuehrung' || mitarbeiter.ist_admin || mitarbeiter.bereiche.includes(bereich)
  if (!erlaubt) return <Navigate to="/heute" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { mitarbeiter } = useAuth()
  if (!isSupabaseConfigured) return <>{children}</>
  const erlaubt = !mitarbeiter || mitarbeiter.rolle === 'geschaeftsfuehrung' || mitarbeiter.ist_admin
  if (!erlaubt) return <Navigate to="/heute" replace />
  return <>{children}</>
}

function RequirePortalAuth({ children }: { children: ReactNode }) {
  const { ready, investor } = usePortalAuth()
  if (!ready) return <LadeBildschirm text="Lädt …" />
  if (!investor) return <Navigate to="/portal/login" replace />
  return <>{children}</>
}

function PortalRoutes() {
  return (
    <Routes>
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal/magic/:token" element={<PortalMagicLink />} />
      <Route
        path="/portal"
        element={
          <RequirePortalAuth>
            <PortalLayout>
              <PortalOverview />
            </PortalLayout>
          </RequirePortalAuth>
        }
      />
      <Route
        path="/portal/rendite"
        element={
          <RequirePortalAuth>
            <PortalLayout>
              <PortalRendite />
            </PortalLayout>
          </RequirePortalAuth>
        }
      />
      <Route
        path="/portal/auszahlungen"
        element={
          <RequirePortalAuth>
            <PortalLayout>
              <PortalAuszahlungen />
            </PortalLayout>
          </RequirePortalAuth>
        }
      />
      <Route
        path="/portal/dokumente"
        element={
          <RequirePortalAuth>
            <PortalLayout>
              <PortalDokumente />
            </PortalLayout>
          </RequirePortalAuth>
        }
      />
    </Routes>
  )
}

function AppRoutes() {
  const location = useLocation()
  // Öffentliche, ausfüllbare Formulare: brauchen weder Rollenwahl noch Portal-Login — genau
  // der Link, den man z.B. nach einem Vortrag an Interessenten verschickt.
  if (location.pathname.startsWith('/formular/')) {
    return (
      <Routes>
        <Route path="/formular/feedbackbogen" element={<PublicFeedbackbogen />} />
        <Route path="/formular/vollmacht/erben/:mandantId" element={<PublicVollmachtErben />} />
        <Route path="/formular/expose/:vorschlagId" element={<PublicExpose />} />
        <Route path="/formular/mandantenfragebogen/erben/:mandantId" element={<PublicMandantenfragebogenErben />} />
        <Route path="/formular/vollmacht/beratung/:typ/:kundeId" element={<PublicVollmachtBeratung />} />
        <Route path="/formular/selbstauskunft/:bereich/:kundeId" element={<PublicSelbstauskunft />} />
        <Route path="/formular/eigentuemer/:objektId" element={<PublicEigentuemerPortal />} />
        <Route path="/formular/nda/:bereich/:kundeId" element={<PublicNda />} />
      </Routes>
    )
  }
  const isPortal = location.pathname.startsWith('/portal')
  return isPortal ? <PortalRoutes /> : <AdminRoutes />
}

function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <PortalAuthProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </PortalAuthProvider>
      </AppProvider>
    </AuthProvider>
  )
}

export default App
