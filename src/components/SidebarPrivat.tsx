import { Link, useLocation } from 'react-router-dom'
import { Users, ChevronLeft, ChevronRight, Lock, Sun, UserCog, ListTodo, Mail, CalendarDays, Settings } from 'lucide-react'
import { UngeklaertSideLink } from './UngeklaertSideLink'
import { useAuth } from '../context/AuthContext'
import { useMsStatus } from '../lib/microsoftKonto'

export function SidebarPrivat({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const location = useLocation()
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')
  const { session, ansichtAls } = useAuth()
  // Microsoft-Anbindung nur für freigeschaltete Logins (Server entscheidet, siehe ms_status).
  const { status: ms } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())

  return (
    <nav className="flex h-full flex-col justify-between py-4">
      <div className="space-y-1 px-2">
        <SideLink to="/heute" icon={<Sun size={17} />} label="Heute" collapsed={collapsed} active={isActive('/heute')} />
        <SideLink
          to="/privat"
          icon={<Users size={17} />}
          label="Meine Kontakte"
          collapsed={collapsed}
          active={isActive('/privat') && !isActive('/privat/todo') && !isActive('/privat/postfach') && !isActive('/privat/kalender') && !isActive('/privat/einstellungen')}
        />
        <SideLink to="/privat/postfach" icon={<Mail size={17} />} label="Mein Postfach" collapsed={collapsed} active={isActive('/privat/postfach')} />
        <SideLink to="/privat/kalender" icon={<CalendarDays size={17} />} label="Mein Kalender" collapsed={collapsed} active={isActive('/privat/kalender')} />
        <UngeklaertSideLink collapsed={collapsed} />
        <SideLink to="/privat/todo" icon={<ListTodo size={17} />} label="To-Do-Liste" collapsed={collapsed} active={isActive('/privat/todo')} />
        {ms?.erlaubt && (
          <SideLink to="/privat/einstellungen" icon={<Settings size={17} />} label="Einstellungen" collapsed={collapsed} active={isActive('/privat/einstellungen')} />
        )}
      </div>

      <div className="px-2">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
            <Lock size={14} /> Privat — nur für dich sichtbar
          </div>
        )}
        <SideLink to="/profil" icon={<UserCog size={17} />} label="Mein Profil" collapsed={collapsed} active={isActive('/profil')} />
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
