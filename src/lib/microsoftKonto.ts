import { useEffect, useState } from 'react'
import { callAuthenticated } from './emailGateway'

// Microsoft-Konto (Outlook/Hotmail, To Do, Kalender) im Bereich Privat — nur für freigeschaltete Logins.
// Der Zugang selbst liegt verschlüsselt auf dem Server; der Browser kennt nur den Status.

export type MsStatus = {
  erlaubt: boolean
  eingerichtet: boolean
  verbunden: boolean
  adresse?: string
  name?: string
  verbundenAm?: string
  letzterFehler?: string | null
  letzterErfolg?: string | null
  abgleich?: { todo?: AbgleichLauf; kalender?: AbgleichLauf }
  /** Listen in Microsoft To Do; aus = wird nicht abgeglichen und in der To-Do-Liste ausgeblendet. */
  todoListen?: ToDoListeStand[]
}

export type ToDoListeStand = { id: string; name: string; aus: boolean; markiert: boolean }

/** Welche To-Do-Listen nicht abgeglichen werden (Kennungen). Bereits übernommene Aufgaben bleiben, nur ausgeblendet. */
export async function setzeToDoListen(email: string, aus: string[]): Promise<void> {
  await callAuthenticated({ action: 'ms_todo_listen_setzen', aus })
  await ladeMsStatus(email)
}

export type AbgleichLauf = { am: string; vonMicrosoft: number; nachMicrosoft: number; geloescht: number; konflikte: number; fehler: string[] }

export async function gleicheJetztAb(email: string): Promise<void> {
  await callAuthenticated({ action: 'ms_abgleich_jetzt' })
  await ladeMsStatus(email)
}

let zwischenspeicher: { email: string; status: MsStatus } | null = null
const zuhoerer = new Set<() => void>()

export async function ladeMsStatus(email: string): Promise<MsStatus> {
  const status = (await callAuthenticated({ action: 'ms_status' })) as MsStatus
  zwischenspeicher = { email, status }
  zuhoerer.forEach((f) => f())
  return status
}

/** Status für den angemeldeten Menschen (einmal geladen, von allen Stellen geteilt). */
export function useMsStatus(email: string | undefined): { status: MsStatus | null; neuLaden: () => Promise<void> } {
  const [, setZaehler] = useState(0)
  useEffect(() => {
    const f = () => setZaehler((z) => z + 1)
    zuhoerer.add(f)
    if (email && zwischenspeicher?.email !== email) ladeMsStatus(email).catch(() => undefined)
    return () => {
      zuhoerer.delete(f)
    }
  }, [email])
  const status = email && zwischenspeicher?.email === email ? zwischenspeicher.status : null
  return {
    status,
    neuLaden: async () => {
      if (email) await ladeMsStatus(email)
    },
  }
}

/** Startet die Anmeldung bei Microsoft: der Browser wechselt auf die Microsoft-Seite und kommt danach zurück. */
export async function starteMsAnmeldung(): Promise<void> {
  const basis = `${window.location.origin}${window.location.pathname}`
  const data = await callAuthenticated({ action: 'ms_anmelden_start', basis })
  if (!data?.url) throw new Error('Microsoft-Anmeldung konnte nicht gestartet werden.')
  window.location.assign(data.url)
}

export async function trenneMsKonto(email: string): Promise<void> {
  await callAuthenticated({ action: 'ms_trennen' })
  await ladeMsStatus(email)
}
