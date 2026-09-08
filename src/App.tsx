import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { Layout } from './components/Layout'
import { KundenListe } from './pages/beratung/KundenListe'
import { KundenDetail } from './pages/beratung/KundenDetail'
import { VorlagenPage } from './pages/beratung/VorlagenPage'
import { Mahnwesen } from './pages/beratung/Mahnwesen'
import { Rechnungen } from './pages/beratung/Rechnungen'
import { ObjektListe } from './pages/immobilien/ObjektListe'
import { ObjektDetail } from './pages/immobilien/ObjektDetail'
import { Finanzierungen } from './pages/immobilien/Finanzierungen'
import { VorlagenPageImmobilien } from './pages/immobilien/VorlagenPageImmobilien'

function RootRedirect() {
  const { state } = useApp()
  return <Navigate to={state.bereich === 'immobilien' ? '/immobilien' : '/beratung'} replace />
}

function AppRoutes() {
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

function App() {
  return (
    <AppProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AppProvider>
  )
}

export default App
