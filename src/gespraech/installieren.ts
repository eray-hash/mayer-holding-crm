// „Auf den Home-Bildschirm legen“: Android/Chrome bietet das Installieren per Ereignis an (beforeinstallprompt),
// das iPhone nur über Teilen → „Zum Home-Bildschirm“. Das Ereignis kommt früh — main.tsx richtet das hier ein.
import { useSyncExternalStore } from 'react'

type InstallAngebot = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let angebot: InstallAngebot | null = null
const zuhoerer = new Set<() => void>()
const melde = () => zuhoerer.forEach((f) => f())

export function richteInstallierenEin(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    angebot = e as InstallAngebot
    melde()
  })
  window.addEventListener('appinstalled', () => {
    angebot = null
    melde()
  })
}

export function istInstalliert(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function useInstallAngebot(): (() => Promise<void>) | null {
  const a = useSyncExternalStore(
    (f) => {
      zuhoerer.add(f)
      return () => zuhoerer.delete(f)
    },
    () => angebot,
  )
  if (!a) return null
  return async () => {
    await a.prompt()
    await a.userChoice.catch(() => undefined)
    angebot = null
    melde()
  }
}
