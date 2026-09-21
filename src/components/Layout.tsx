import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Menu, X, Building2, Briefcase, RotateCcw, User, ExternalLink, LogOut, Users, ScrollText, Handshake, Scale } from 'lucide-react'
import type { Bereich } from '../types'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { SidebarBeratung } from './SidebarBeratung'
import { SidebarImmobilien } from './SidebarImmobilien'
import { SidebarErben } from './SidebarErben'
import { SidebarBetriebsuebergabe } from './SidebarBetriebsuebergabe'
import { SidebarBetriebsformen } from './SidebarBetriebsformen'

const BEREICHE: {
  id: Bereich
  label: string
  beschreibung: string
  icon: typeof Briefcase
  pfad: string
  Sidebar: typeof SidebarBeratung
}[] = [
  { id: 'beratung', label: 'Unternehmensberatung', beschreibung: 'Kunden, Mandate, Rechnungen & Mahnwesen', icon: Briefcase, pfad: '/beratung', Sidebar: SidebarBeratung },
  { id: 'immobilien', label: 'Immobilien', beschreibung: 'Objekte, Dokumente & Finanzierungen', icon: Building2, pfad: '/immobilien', Sidebar: SidebarImmobilien },
  { id: 'erben', label: 'Erben', beschreibung: 'Mandanten, Vermögens- & Nachfolgeplanung', icon: ScrollText, pfad: '/erben', Sidebar: SidebarErben },
  { id: 'betriebsuebergabe', label: 'Betriebsübergabe', beschreibung: 'Unternehmensnachfolge & Übergabemandate', icon: Handshake, pfad: '/betriebsuebergabe', Sidebar: SidebarBetriebsuebergabe },
  { id: 'betriebsformen', label: 'Betriebsformen', beschreibung: 'Rechtsformberatung & Umwandlungen', icon: Scale, pfad: '/betriebsformen', Sidebar: SidebarBetriebsformen },
]

export function Layout({ children }: { children: ReactNode }) {
  const { state, dispatch } = useApp()
  const { session, mitarbeiter, signOut } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const navigate = useNavigate()

  const aktuellerBereich = BEREICHE.find((b) => b.id === state.bereich) ?? BEREICHE[0]

  function chooseBereich(b: Bereich) {
    dispatch({ type: 'SET_BEREICH', bereich: b })
    setDrawerOpen(false)
    navigate(BEREICHE.find((x) => x.id === b)!.pfad)
  }

  function resetData() {
    if (confirm('Alle Demo-Daten zurücksetzen? Änderungen gehen verloren.')) {
      dispatch({ type: 'RESET' })
    }
  }

  function rolleWechseln() {
    dispatch({ type: 'SET_ROLLE', rolle: null })
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* Topbar */}
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Bereichsmenü öffnen"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-semibold tracking-tight text-slate-800">Mayer Holding CRM</span>
          <span className="ml-2 hidden items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 sm:inline-flex">
            <aktuellerBereich.icon size={12} />
            {aktuellerBereich.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="#/portal/login"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 sm:inline-flex"
            title="Investoren-Portal in neuem Tab öffnen"
          >
            <ExternalLink size={13} /> Kundenportal (Demo)
          </a>
          {state.rolle === 'geschaeftsfuehrung' && (
            <button
              onClick={resetData}
              className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 sm:inline-flex"
              title="Daten zurücksetzen"
            >
              <RotateCcw size={13} /> Daten zurücksetzen
            </button>
          )}
          <button
            onClick={rolleWechseln}
            className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 sm:inline-flex"
            title="Rolle wechseln"
          >
            <Users size={13} /> {state.rolle === 'geschaeftsfuehrung' ? 'Geschäftsführung' : 'Mitarbeiter'}
          </button>
          {isSupabaseConfigured && session && (
            <>
              <span className="hidden text-xs text-slate-500 sm:inline">{mitarbeiter?.name ?? session.user.email}</span>
              <button
                onClick={signOut}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"
                title="Abmelden"
              >
                <LogOut size={15} />
              </button>
            </>
          )}
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-500">
            <User size={16} />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside
          className={`flex-shrink-0 border-r border-slate-200 bg-white transition-all duration-150 ${
            sidebarCollapsed ? 'w-14' : 'w-60'
          }`}
        >
          <aktuellerBereich.Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((c) => !c)} />
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-6 py-6">{children}</div>
        </main>
      </div>

      {/* Sandwich Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={() => setDrawerOpen(false)} />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Bereich wählen</h2>
              <button onClick={() => setDrawerOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {BEREICHE.map((b) => (
                <button
                  key={b.id}
                  onClick={() => chooseBereich(b.id)}
                  className={`group flex flex-col items-center gap-3 rounded-2xl border p-8 text-center transition ${
                    state.bereich === b.id
                      ? 'border-accent-400 bg-accent-50 ring-2 ring-accent-200'
                      : 'border-slate-200 hover:border-accent-300 hover:bg-slate-50'
                  }`}
                >
                  <b.icon size={36} className="text-accent-600" />
                  <span className="text-base font-semibold text-slate-800">{b.label}</span>
                  <span className="text-xs text-slate-500">{b.beschreibung}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function NavItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `block rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'
        }`
      }
    >
      {children}
    </NavLink>
  )
}
