// Einstieg der Gesprächs-App (gespraech/index.html). Eigenes Manifest unter public/gespraech/; der
// Service-Worker ist derselbe wie beim CRM (../sw.js, Bereich: ganze Seite) — er hält auch die Dateien
// dieser App vor, damit sie ohne Netz startet, und leitet Aufrufe von …/gespraech/ nie auf das CRM um
// (navigateFallbackDenylist in vite.config.ts).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import GespraechApp from './App'
import { richteFehlerMeldenEin } from '../lib/fehlerMelden'
import { richteInstallierenEin } from './installieren'

richteFehlerMeldenEin()
richteInstallierenEin()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GespraechApp />
  </StrictMode>,
)
