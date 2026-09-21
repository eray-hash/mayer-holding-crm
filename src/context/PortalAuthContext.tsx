import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'mayer-holding-portal-auth-v1'

type PortalAuthCtx = {
  investorId: string | null
  login: (investorId: string) => void
  logout: () => void
}

const PortalAuthContext = createContext<PortalAuthCtx | null>(null)

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [investorId, setInvestorId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })

  useEffect(() => {
    try {
      if (investorId) localStorage.setItem(STORAGE_KEY, investorId)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [investorId])

  const value: PortalAuthCtx = {
    investorId,
    login: (id: string) => setInvestorId(id),
    logout: () => setInvestorId(null),
  }

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>
}

export function usePortalAuth(): PortalAuthCtx {
  const ctx = useContext(PortalAuthContext)
  if (!ctx) throw new Error('usePortalAuth muss innerhalb von PortalAuthProvider verwendet werden')
  return ctx
}
