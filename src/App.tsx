import { type ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { AuthProvider } from './context/AuthContext'
import { PortalAuthProvider, usePortalAuth } from './context/PortalAuthContext'
import { RollenAuswahl } from './pages/auth/RollenAuswahl'
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
import { HeuteScreen } from './pages/heute/HeuteScreen'
import { ProjekteListe } from './pages/projekte/ProjekteListe'
import { PortalLogin } from './pages/portal/PortalLogin'
import { PortalOverview } from './pages/portal/PortalOverview'
import { PortalRendite } from './pages/portal/PortalRendite'
import { PortalAuszahlungen } from './pages/portal/PortalAuszahlungen'
import { PortalDokumente } from './pages/portal/PortalDokumente'

function RootRedirect() {
  return <Navigate to="/heute" replace />
}

function AdminRoutesContent() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/heute" element={<HeuteScreen />} />

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

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Layout>
  )
}

// Vereinfachter Platzhalter statt echtem Login: eine reine Rollenwahl (Geschäftsführung/
// Mitarbeiter/Kunde), lokal gespeichert wie die Bereichswahl. Der echte Mitarbeiter-Login
// (AuthContext + LoginScreen, per Supabase) bleibt fertig im Code, wird aber erst wieder
// eingehängt, sobald echte Mitarbeiter-Zugänge angelegt sind.
function AdminRoutes() {
  const { state } = useApp()
  if (!state.rolle) return <RollenAuswahl />
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
