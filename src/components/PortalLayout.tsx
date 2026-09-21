import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, LineChart, FileText, Banknote, LogOut, ShieldCheck } from 'lucide-react'
import { usePortalAuth } from '../context/PortalAuthContext'
import { useApp } from '../context/AppContext'

function PortalNavItem({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition ${
          isActive ? 'border-amber-400 text-white' : 'border-transparent text-slate-300 hover:text-white'
        }`
      }
    >
      {icon}
      {children}
    </NavLink>
  )
}

export function PortalLayout({ children }: { children: ReactNode }) {
  const { investorId, logout } = usePortalAuth()
  const { state } = useApp()
  const navigate = useNavigate()
  const investor = state.fondsInvestoren.find((i) => i.id === investorId)

  function handleLogout() {
    logout()
    navigate('/portal/login')
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="bg-slate-900">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-400 text-slate-900">
              <ShieldCheck size={18} strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide text-white">ANDREAS MAYER HOLDING</div>
              <div className="text-xs text-slate-400">Investoren-Portal · Investitionsfonds 2026</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {investor && <span className="hidden text-sm text-slate-300 sm:inline">{investor.name}</span>}
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              <LogOut size={13} /> Abmelden
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1200px] gap-6 px-6">
          <PortalNavItem to="/portal" icon={<LayoutDashboard size={15} />}>
            Übersicht
          </PortalNavItem>
          <PortalNavItem to="/portal/rendite" icon={<LineChart size={15} />}>
            Rendite &amp; Wertentwicklung
          </PortalNavItem>
          <PortalNavItem to="/portal/auszahlungen" icon={<Banknote size={15} />}>
            Ausschüttungen
          </PortalNavItem>
          <PortalNavItem to="/portal/dokumente" icon={<FileText size={15} />}>
            Dokumente
          </PortalNavItem>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-8">{children}</main>

      <footer className="border-t border-slate-200 bg-white px-6 py-4 text-center text-xs text-slate-400">
        Zielrendite, keine Garantie. Keine Anlageberatung. Jede Investition ist mit Risiken bis zum vollständigen
        Kapitalverlust verbunden. ·{' '}
        <a href="#/" className="text-slate-400 underline hover:text-slate-600">
          Zurück zum internen CRM
        </a>
      </footer>
    </div>
  )
}
