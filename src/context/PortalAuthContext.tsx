import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchMyInvestorData, portalLogout } from '../lib/portalAuthDb'
import type { FondsInvestor } from '../types'

const STORAGE_KEY = 'mayer-holding-portal-session-v2'

type PortalAuthCtx = {
  // false, solange ein evtl. gespeicherter Session-Token noch gegen den Server geprüft wird —
  // verhindert einen kurzen "nicht eingeloggt"-Blitzer beim Neuladen, bevor die Prüfung durch ist.
  ready: boolean
  investor: FondsInvestor | null
  login: (sessionToken: string, investor: FondsInvestor) => void
  logout: () => void
}

const PortalAuthContext = createContext<PortalAuthCtx | null>(null)

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })
  const [investor, setInvestor] = useState<FondsInvestor | null>(null)
  const [ready, setReady] = useState(false)

  // Prüft einen aus einem früheren Besuch gespeicherten Session-Token serverseitig neu (statt ihm
  // blind zu vertrauen) — liefert außerdem die aktuellen Investoren-Daten gleich mit.
  useEffect(() => {
    if (!token) {
      setReady(true)
      return
    }
    let cancelled = false
    fetchMyInvestorData(token)
      .then((data) => {
        if (cancelled) return
        if (!data) {
          try {
            localStorage.removeItem(STORAGE_KEY)
          } catch {
            // ignore
          }
          setToken(null)
        }
        setInvestor(data)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value: PortalAuthCtx = {
    ready,
    investor,
    login: (sessionToken, neuerInvestor) => {
      try {
        localStorage.setItem(STORAGE_KEY, sessionToken)
      } catch {
        // ignore
      }
      setToken(sessionToken)
      setInvestor(neuerInvestor)
      setReady(true)
    },
    logout: () => {
      if (token) portalLogout(token).catch(() => {})
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
      setToken(null)
      setInvestor(null)
    },
  }

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>
}

export function usePortalAuth(): PortalAuthCtx {
  const ctx = useContext(PortalAuthContext)
  if (!ctx) throw new Error('usePortalAuth muss innerhalb von PortalAuthProvider verwendet werden')
  return ctx
}
