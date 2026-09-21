import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Users, FileText, ChevronDown, ChevronLeft, ChevronRight, PiggyBank, Sun, LayoutGrid } from 'lucide-react'

const VORLAGEN_LINKS = [
  { kind: 'vollmacht', label: 'Vollmacht' },
  { kind: 'schreiben', label: 'Schreiben' },
  { kind: 'vertraege', label: 'Verträge' },
]

export function SidebarFinanzierungen({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const location = useLocation()
  const [vorlagenOpen, setVorlagenOpen] = useState(location.pathname.includes('/vorlagen'))

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')

  return (
    <nav className="flex h-full flex-col justify-between py-4">
      <div className="space-y-1 px-2">
        <SideLink to="/heute" icon={<Sun size={17} />} label="Heute" collapsed={collapsed} active={isActive('/heute')} />
        <SideLink
          to="/finanzierungen/projekte"
          icon={<LayoutGrid size={17} />}
          label="Projekte"
          collapsed={collapsed}
          active={isActive('/finanzierungen/projekte')}
        />
        <SideLink
          to="/finanzierungen"
          icon={<Users size={17} />}
          label="Mandanten"
          collapsed={collapsed}
          active={isActive('/finanzierungen') && !location.pathname.includes('vorlagen') && !location.pathname.includes('projekte')}
        />

        <div>
          <button
            onClick={() => setVorlagenOpen((o) => !o)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 ${collapsed ? 'justify-center' : ''}`}
          >
            <FileText size={17} />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Vorlagen</span>
                <ChevronDown size={14} className={`transition-transform ${vorlagenOpen ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>
          {!collapsed && vorlagenOpen && (
            <div className="ml-6 mt-0.5 space-y-0.5 border-l border-slate-100 pl-3">
              {VORLAGEN_LINKS.map((v) => (
                <Link
                  key={v.kind}
                  to={`/finanzierungen/vorlagen/${v.kind}`}
                  className={`block rounded-md px-2 py-1.5 text-sm ${
                    isActive(`/finanzierungen/vorlagen/${v.kind}`) ? 'text-accent-700 font-medium' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {v.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-2">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
            <PiggyBank size={14} /> Finanzierungen
          </div>
        )}
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-center rounded-lg border border-slate-200 py-1.5 text-slate-400 hover:bg-slate-50"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </nav>
  )
}

function SideLink({
  to,
  icon,
  label,
  collapsed,
  active,
}: {
  to: string
  icon: React.ReactNode
  label: string
  collapsed: boolean
  active: boolean
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'
      } ${collapsed ? 'justify-center' : ''}`}
      title={collapsed ? label : undefined}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </Link>
  )
}
