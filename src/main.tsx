import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { richteFehlerMeldenEin } from './lib/fehlerMelden'

// Fehler im Browser landen in app_fehler (nur Meldung und Seite) — für den täglichen Bericht an die Geschäftsführung.
richteFehlerMeldenEin()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
