import { useId, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AutomatikSideLink } from './AutomatikSideLink'
import { EntgangenSideLink } from './EntgangenSideLink'
import { Building2, Landmark, FileText, ChevronDown, ChevronLeft, ChevronRight, ScrollText, Sun, LayoutGrid, UserCog, ListTodo, Users, Search, MessageCircleQuestion, Clock, CalendarClock, Forward, MailCheck } from 'lucide-react'
import { UngeklaertSideLink } from './UngeklaertSideLink'
import { useApp } from '../context/AppContext'
import { OBJEKT_GRUPPEN } from '../data/constants'
import { PFAD_UNGEKLAERT } from '../data/sammelakten'

const VORLAGEN_LINKS = [
  { kind: 'vollmacht', label: 'Vollmacht' },
  { kind: 'schreiben', label: 'Schreiben' },
  { kind: 'vertraege', label: 'Verträge' },
  { kind: 'formulare', label: 'Formulare & Checklisten' },
  { kind: 'ki', label: 'KI-Anweisungen' },
]

// Die Seitenleiste ist nach Tätigkeit gegliedert statt als lange Liste: Jede Gruppe hat eine kleine
// Überschrift zum Auf- und Zuklappen. Was auf- oder zugeklappt ist, merkt sich der Browser.
type GruppenId = 'tagesgeschaeft' | 'vermittlung' | 'abstimmung' | 'unterlagen'
const GRUPPEN_IDS: GruppenId[] = ['tagesgeschaeft', 'vermittlung', 'abstimmung', 'unterlagen']
const SPEICHER_PREFIX = 'seitenleiste-immobilien-'

function gruppenAusSpeicher(): Record<GruppenId, boolean> {
  const offen: Record<GruppenId, boolean> = { tagesgeschaeft: true, vermittlung: true, abstimmung: true, unterlagen: true }
  for (const id of GRUPPEN_IDS) {
    try {
      if (window.localStorage.getItem(SPEICHER_PREFIX + id) === 'zu') offen[id] = false
    } catch {
      // Speicher nicht verfügbar (z. B. privates Fenster) — dann bleibt die Gruppe offen.
    }
  }
  return offen
}

function gruppeMerken(id: GruppenId, offen: boolean) {
  try {
    window.localStorage.setItem(SPEICHER_PREFIX + id, offen ? 'offen' : 'zu')
  } catch {
    // Ohne Speicher gilt die Einstellung nur, bis die Seite neu geladen wird.
  }
}

export function SidebarImmobilien({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const location = useLocation()
  const { state } = useApp()
  const [objekteOpen, setObjekteOpen] = useState(true)
  const [vorlagenOpen, setVorlagenOpen] = useState(location.pathname.includes('/vorlagen'))
  const [gruppenOffen, setGruppenOffen] = useState(gruppenAusSpeicher)

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')
  const search = new URLSearchParams(location.search)
  const activeGruppe = search.get('gruppe')

  const offeneFragen = state.immoFragen.filter((f) => !f.antwort?.trim()).length

  function countFor(id: string) {
    return state.objekte.filter((o) => o.gruppe === id).length
  }

  // In welcher Gruppe liegt die Seite, die gerade offen ist? Diese Gruppe bleibt immer aufgeklappt.
  const gruppeAktiv: Record<GruppenId, boolean> = {
    tagesgeschaeft: isActive('/immobilien/tagesablauf') || isActive('/immobilien/todo') || isActive('/immobilien/zeiterfassung'),
    vermittlung:
      location.pathname === '/immobilien' ||
      isActive('/immobilien/objekte') ||
      isActive('/immobilien/kunden') ||
      isActive('/immobilien/gesuche') ||
      isActive('/immobilien/weitergaben') ||
      isActive('/immobilien/automatische-nachrichten'),
    abstimmung: isActive('/immobilien/fragen') || isActive('/immobilien/projekte'),
    unterlagen: isActive('/immobilien/vorlagen') || isActive('/immobilien/finanzierungen') || location.pathname === PFAD_UNGEKLAERT,
  }

  function gruppeUmschalten(id: GruppenId) {
    if (gruppeAktiv[id]) return
    const offen = !gruppenOffen[id]
    setGruppenOffen((alt) => ({ ...alt, [id]: offen }))
    gruppeMerken(id, offen)
  }

  const gruppenProps = (id: GruppenId) => ({
    collapsed,
    aktiv: gruppeAktiv[id],
    offen: gruppenOffen[id] || gruppeAktiv[id],
    onToggle: () => gruppeUmschalten(id),
  })

  return (
    <nav className="flex h-full w-full min-w-0 flex-col justify-between py-4">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2">
        <SideLink to="/heute" icon={<Sun size={17} />} label="Heute" collapsed={collapsed} active={isActive('/heute')} />

        <Gruppe titel="Tagesgeschäft" {...gruppenProps('tagesgeschaeft')}>
          <SideLink to="/immobilien/tagesablauf" icon={<CalendarClock size={17} />} label="Tagesablauf & Woche" collapsed={collapsed} active={isActive('/immobilien/tagesablauf')} />
          <SideLink to="/immobilien/todo" icon={<ListTodo size={17} />} label="To-do-Liste" collapsed={collapsed} active={isActive('/immobilien/todo')} />
          <SideLink to="/immobilien/zeiterfassung" icon={<Clock size={17} />} label="Zeiterfassung" collapsed={collapsed} active={isActive('/immobilien/zeiterfassung')} />
        </Gruppe>

        <Gruppe titel="Vermittlung" {...gruppenProps('vermittlung')}>
          <div>
            <button
              onClick={() => setObjekteOpen((o) => !o)}
              aria-expanded={collapsed ? undefined : objekteOpen}
              title={collapsed ? 'Objekte' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive('/immobilien/objekte') || location.pathname === '/immobilien'
                  ? 'bg-accent-50 text-accent-700'
                  : 'text-slate-600 hover:bg-slate-50'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <Building2 size={17} />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Objekte</span>
                  <ChevronDown size={14} className={`transition-transform ${objekteOpen ? 'rotate-180' : ''}`} />
                </>
              )}
            </button>
            {!collapsed && objekteOpen && (
              <div className="ml-6 mt-0.5 space-y-0.5 border-l border-slate-100 pl-3">
                <Link
                  to="/immobilien"
                  className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                    location.pathname === '/immobilien' && !activeGruppe ? 'text-accent-700 font-medium' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Alle Objekte
                  <span className="text-xs text-slate-400">{state.objekte.length}</span>
                </Link>
                {OBJEKT_GRUPPEN.map((g) => (
                  <Link
                    key={g.id}
                    to={`/immobilien?gruppe=${g.id}`}
                    className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                      activeGruppe === g.id ? 'text-accent-700 font-medium' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <span>{g.label}</span>
                    <span className="text-xs text-slate-400">{countFor(g.id)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <SideLink to="/immobilien/kunden" icon={<Users size={17} />} label="Kontakte" collapsed={collapsed} active={isActive('/immobilien/kunden')} />
          <SideLink to="/immobilien/gesuche" icon={<Search size={17} />} label="Gesuche" collapsed={collapsed} active={isActive('/immobilien/gesuche')} />
          <SideLink to="/immobilien/weitergaben" icon={<Forward size={17} />} label="Weitergaben" collapsed={collapsed} active={isActive('/immobilien/weitergaben')} />
          <SideLink to="/immobilien/automatische-nachrichten" icon={<MailCheck size={17} />} label="Immobilien-Nachrichten" collapsed={collapsed} active={isActive('/immobilien/automatische-nachrichten')} />
        </Gruppe>

        <Gruppe titel="Abstimmung" {...gruppenProps('abstimmung')}>
          <SideLink
            to="/immobilien/fragen"
            icon={<MessageCircleQuestion size={17} />}
            label={`Fragen an die GF${offeneFragen > 0 ? ` (${offeneFragen})` : ''}`}
            collapsed={collapsed}
            active={isActive('/immobilien/fragen')}
          />
          <SideLink to="/immobilien/projekte" icon={<LayoutGrid size={17} />} label="Projekte" collapsed={collapsed} active={isActive('/immobilien/projekte')} />
        </Gruppe>

        <Gruppe titel="Unterlagen" {...gruppenProps('unterlagen')}>
          <div>
            <button
              onClick={() => setVorlagenOpen((o) => !o)}
              aria-expanded={collapsed ? undefined : vorlagenOpen}
              title={collapsed ? 'Vorlagen' : undefined}
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
                    to={`/immobilien/vorlagen/${v.kind}`}
                    className={`block rounded-md px-2 py-1.5 text-sm ${
                      isActive(`/immobilien/vorlagen/${v.kind}`) ? 'text-accent-700 font-medium' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {v.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <SideLink
            to="/immobilien/finanzierungen"
            icon={<Landmark size={17} />}
            label="Finanzierungen"
            collapsed={collapsed}
            active={isActive('/immobilien/finanzierungen')}
          />
          <UngeklaertSideLink collapsed={collapsed} />
        </Gruppe>
      </div>

      <div className="flex-shrink-0 px-2 pt-2">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
            <ScrollText size={14} /> Immobilien
          </div>
        )}
        <EntgangenSideLink collapsed={collapsed} />
        <AutomatikSideLink collapsed={collapsed} />
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

// Eine Gruppe der Seitenleiste. Ausgeklappt: kleine Überschrift zum Auf- und Zuklappen, darunter die
// Einträge. Nur-Symbole-Ansicht: keine Überschrift, nur ein dünner Trennstrich vor den Symbolen.
function Gruppe({
  titel,
  collapsed,
  aktiv,
  offen,
  onToggle,
  children,
}: {
  titel: string
  collapsed: boolean
  aktiv: boolean
  offen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const inhaltId = useId()

  if (collapsed) {
    return (
      <>
        <div className="px-2 py-1" role="separator">
          <div className="border-t border-slate-200" />
        </div>
        {children}
      </>
    )
  }

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={offen}
        aria-controls={inhaltId}
        aria-disabled={aktiv || undefined}
        title={aktiv ? 'Bleibt aufgeklappt, solange eine Seite aus dieser Gruppe geöffnet ist' : undefined}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 transition md:py-1.5 ${
          aktiv ? 'cursor-default' : 'hover:bg-slate-50 hover:text-slate-600'
        }`}
      >
        <span className="flex-1">{titel}</span>
        <ChevronDown size={14} className={`transition-transform ${offen ? 'rotate-180' : ''} ${aktiv ? 'text-slate-300' : ''}`} />
      </button>
      {offen && (
        <div id={inhaltId} className="mt-0.5 space-y-1">
          {children}
        </div>
      )}
    </div>
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
