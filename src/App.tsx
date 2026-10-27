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
import { HeuteScreen } from './pages/heute/HeuteScreen'
import { Postfach } from './pages/postfach/Postfach'
import { Kampagnen } from './pages/kampagnen/Kampagnen'
import { MeinProfil } from './pages/profil/MeinProfil'
import { MitarbeiterVerwalten } from './pages/admin/MitarbeiterVerwalten'
import { ProjekteListe } from './pages/projekte/ProjekteListe'
import { PortalLogin } from './pages/portal/PortalLogin'
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
        <Route path="/mitarbeiter" element={<MitarbeiterVerwalten />} />

        <Route path="/beratung" element={<KundenListe />} />
        <Route path="/beratung/kunden/:id" element={<KundenDetail />} />
        <Route path="/beratung/vorlagen/:kind" element={<VorlagenPage />} />
        <Route path="/beratung/mahnwesen" element={<Mahnwesen />} />
        <Route path="/beratung/rechnungen" element={<Rechnungen />} />
        <Route path="/beratung/projekte" element={<ProjekteListe />} />

        <Route path="/immobilien" element={<ObjektListe />} />
        <Route path="/immobilien/objekte/:id" element={<ObjektDetail />} />
        <Route path="/immobilien/finanzierungen" element={<Finanzierungen />} />
        <Route path="/immobilien/vorlagen/:kind" element={<VorlagenPageImmobilien />} />
        <Route path="/immobilien/projekte" element={<ProjekteListe />} />

        <Route path="/erben" element={<ErbenListe />} />
        <Route path="/erben/mandanten/:id" element={<ErbenDetail />} />
        <Route path="/erben/vorlagen/:kind" element={<VorlagenPageErben />} />
        <Route path="/erben/projekte" element={<ProjekteListe />} />

        <Route path="/betriebsuebergabe" element={<BetriebsuebergabeListe />} />
        <Route path="/betriebsuebergabe/mandanten/:id" element={<BetriebsuebergabeDetail />} />
        <Route path="/betriebsuebergabe/vorlagen/:kind" element={<VorlagenPageBetriebsuebergabe />} />
        <Route path="/betriebsuebergabe/projekte" element={<ProjekteListe />} />

        <Route path="/betriebsformen" element={<BetriebsformenListe />} />
        <Route path="/betriebsformen/mandanten/:id" element={<BetriebsformenDetail />} />
        <Route path="/betriebsformen/vorlagen/:kind" element={<VorlagenPageBetriebsformen />} />
        <Route path="/betriebsformen/projekte" element={<ProjekteListe />} />

        <Route path="/akademie" element={<AkademieListe />} />
        <Route path="/akademie/teilnehmer/:id" element={<AkademieDetail />} />
        <Route path="/akademie/vorlagen/:kind" element={<VorlagenPageAkademie />} />
        <Route path="/akademie/projekte" element={<ProjekteListe />} />

        <Route path="/finanzierungen" element={<FinanzierungenListe />} />
        <Route path="/finanzierungen/mandanten/:id" element={<FinanzierungenDetail />} />
        <Route path="/finanzierungen/vorlagen/:kind" element={<VorlagenPageFinanzierungen />} />
        <Route path="/finanzierungen/projekte" element={<ProjekteListe />} />

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

function RequirePortalAuth({ children }: { children: ReactNode }) {
  const { investorId } = usePortalAuth()
  if (!investorId) return <Navigate to="/portal/login" replace />
  return <>{children}</>
}

function PortalRoutes() {
  return (
    <Routes>
      <Route path="/portal/login" element={<PortalLogin />} />
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
