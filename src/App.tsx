import { type ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PortalAuthProvider, usePortalAuth } from './context/PortalAuthContext'
import { isSupabaseConfigured } from './lib/supabaseClient'
import { LoginScreen } from './pages/auth/LoginScreen'
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
import { PortalLogin } from './pages/portal/PortalLogin'
import { PortalOverview } from './pages/portal/PortalOverview'
import { PortalRendite } from './pages/portal/PortalRendite'
import { PortalAuszahlungen } from './pages/portal/PortalAuszahlungen'
import { PortalDokumente } from './pages/portal/PortalDokumente'

function RootRedirect() {
  const { state } = useApp()
  return <Navigate to={state.bereich === 'immobilien' ? '/immobilien' : '/beratung'} replace />
}

function AdminRoutesContent() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<RootRedirect />} />

        <Route path="/beratung" element={<KundenListe />} />
        <Route path="/beratung/kunden/:id" element={<KundenDetail />} />
        <Route path="/beratung/vorlagen/:kind" element={<VorlagenPage />} />
        <Route path="/beratung/mahnwesen" element={<Mahnwesen />} />
        <Route path="/beratung/rechnungen" element={<Rechnungen />} />

        <Route path="/immobilien" element={<ObjektListe />} />
        <Route path="/immobilien/objekte/:id" element={<ObjektDetail />} />
        <Route path="/immobilien/finanzierungen" element={<Finanzierungen />} />
        <Route path="/immobilien/vorlagen/:kind" element={<VorlagenPageImmobilien />} />

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Layout>
  )
}

// Ohne Supabase-Konfiguration (z.B. die öffentliche GitHub-Pages-Demo) bleibt es beim reinen
// Mock-/localStorage-Modus ohne Login, exakt wie bisher. Nur wenn echte Zugangsdaten hinterlegt
// sind (internes Deployment), wird ein Mitarbeiter-Login davorgeschaltet.
function AdminRoutes() {
  const { ready, session } = useAuth()
  if (!isSupabaseConfigured) return <AdminRoutesContent />
  if (!ready) return null
  if (!session) return <LoginScreen />
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
