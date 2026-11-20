import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Users, ChevronLeft, ChevronRight, Lock, Sun, UserCog, ListTodo, Mail, CalendarDays, Settings, PenLine, AtSign, ListChecks, PauseCircle, Stethoscope, ChevronDown, Briefcase, Building2, LayoutGrid, FileText } from 'lucide-react'
import { UngeklaertSideLink } from './UngeklaertSideLink'
import { useAuth } from '../context/AuthContext'
import { useMsStatus } from '../lib/microsoftKonto'
import { PRIVAT_ARTEN } from '../data/privatArten'

// Seiten des Bereichs Privat, die NICHT zur Kontaktliste gehören (für die Markierung „Meine Kontakte“).
const ANDERE_SEITEN = ['/privat/todo', '/privat/postfach', '/privat/kalender', '/privat/einstellungen', '/privat/brief', '/privat/hotmail', '/privat/offen', '/privat/bestaetigen', '/privat/systemcheck', '/privat/art', '/privat/immobilien', '/privat/projekte', '/privat/vorlagen']

export function SidebarPrivat({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const location = useLocation()
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')
  const { session, ansichtAls } = useAuth()
  // Microsoft-Anbindung nur für freigeschaltete Logins (Server entscheidet, siehe ms_status).
  const { status: ms } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())
  const imKundenBereich = ['/privat/art', '/privat/immobilien', '/privat/projekte', '/privat/vorlagen'].some((p) => isActive(p))
  const [kundenOffen, setKundenOffen] = useState(imKundenBereich)

  return (
    <nav className="flex h-full flex-col justify-between py-4">
      <div className="space-y-1 px-2">
        <SideLink to="/heute" icon={<Sun size={17} />} label="Heute" collapsed={collapsed} active={isActive('/heute')} />
        <SideLink
          to="/privat"
          icon={<Users size={17} />}
          label="Meine Kontakte"
          collapsed={collapsed}
          active={isActive('/privat') && !ANDERE_SEITEN.some((p) => isActive(p))}
        />
        {ms?.erlaubt && (
          <div>
            <button
              onClick={() => setKundenOffen((o) => !o)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${imKundenBereich ? 'text-accent-700' : 'text-slate-600'} hover:bg-slate-50 ${collapsed ? 'justify-center' : ''}`}
              title={collapsed ? 'Meine Kunden nach Bereich' : undefined}
            >
              <Briefcase size={17} />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Meine Kunden</span>
                  <ChevronDown size={14} className={`transition-transform ${kundenOffen ? 'rotate-180' : ''}`} />
                </>
              )}
            </button>
            {!collapsed && kundenOffen && (
              <div className="ml-6 mt-0.5 space-y-0.5 border-l border-slate-100 pl-3">
                {PRIVAT_ARTEN.filter((a) => a.id !== 'immobilienkunden').map((a) => (
                  <UnterLink key={a.id} to={`/privat/art/${a.id}`} label={a.label} active={isActive(`/privat/art/${a.id}`)} />
                ))}
                <div className="pt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  <Building2 size={11} className="mr-1 inline" />
                  Immobilien
                </div>
                <UnterLink to="/privat/immobilien" label="Objekte" active={location.pathname === '/privat/immobilien' || isActive('/privat/immobilien/objekte')} />
                <UnterLink to="/privat/immobilien/kunden" label="Kunden" active={isActive('/privat/immobilien/kunden')} />
                <UnterLink to="/privat/immobilien/gesuche" label="Gesuche" active={isActive('/privat/immobilien/gesuche')} />
              </div>
            )}
          </div>
        )}
        {ms?.erlaubt && <SideLink to="/privat/projekte" icon={<LayoutGrid size={17} />} label="Projekte" collapsed={collapsed} active={isActive('/privat/projekte')} />}
        {ms?.erlaubt && <SideLink to="/privat/vorlagen/beratung/vollmacht" icon={<FileText size={17} />} label="Vorlagen" collapsed={collapsed} active={isActive('/privat/vorlagen')} />}
        <SideLink to="/privat/postfach" icon={<Mail size={17} />} label="Mein Postfach" collapsed={collapsed} active={isActive('/privat/postfach')} />
        {ms?.erlaubt && ms.verbunden && (
          <>
            <SideLink to="/privat/hotmail" icon={<AtSign size={17} />} label="Hotmail" collapsed={collapsed} active={isActive('/privat/hotmail')} />
            <SideLink to="/privat/offen" icon={<ListChecks size={17} />} label="Offene Punkte" collapsed={collapsed} active={isActive('/privat/offen')} />
            <SideLink to="/privat/bestaetigen" icon={<PauseCircle size={17} />} label="Zu bestätigen" collapsed={collapsed} active={isActive('/privat/bestaetigen')} />
          </>
        )}
        <SideLink to="/privat/kalender" icon={<CalendarDays size={17} />} label="Mein Kalender" collapsed={collapsed} active={isActive('/privat/kalender')} />
        <UngeklaertSideLink collapsed={collapsed} />
        <SideLink to="/privat/todo" icon={<ListTodo size={17} />} label="To-Do-Liste" collapsed={collapsed} active={isActive('/privat/todo')} />
        {ms?.erlaubt && <SideLink to="/privat/brief" icon={<PenLine size={17} />} label="Brief schreiben" collapsed={collapsed} active={isActive('/privat/brief')} />}
        {ms?.erlaubt && <SideLink to="/privat/systemcheck" icon={<Stethoscope size={17} />} label="Systemcheck" collapsed={collapsed} active={isActive('/privat/systemcheck')} />}
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

function UnterLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link to={to} className={`block rounded-md px-2 py-1.5 text-sm ${active ? 'font-medium text-accent-700' : 'text-slate-500 hover:text-slate-700'}`}>
      {label}
    </Link>
  )
}
