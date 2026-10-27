import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Menu,
  X,
  Building2,
  Briefcase,
  RotateCcw,
  User,
  ExternalLink,
  LogOut,
  Users,
  ScrollText,
  Handshake,
  Scale,
  GraduationCap,
  PiggyBank,
  Camera,
  Inbox,
  Sparkles,
  Bell,
  UserCog,
  ChevronDown,
} from 'lucide-react'
import type { Bereich } from '../types'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { collectPriorityEntries } from '../lib/todayPriorities'
import { collectFollowUpPriorities, followUpDetailPfad } from '../lib/followUpPriorities'
import { DokumentenImportModal } from './DokumentenImportModal'
import { KiAssistentPanel } from './KiAssistentPanel'
import { SidebarBeratung } from './SidebarBeratung'
import { SidebarImmobilien } from './SidebarImmobilien'
import { SidebarErben } from './SidebarErben'
import { SidebarBetriebsuebergabe } from './SidebarBetriebsuebergabe'
import { SidebarBetriebsformen } from './SidebarBetriebsformen'
import { SidebarAkademie } from './SidebarAkademie'
import { SidebarFinanzierungen } from './SidebarFinanzierungen'

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
  { id: 'akademie', label: 'Akademie', beschreibung: 'Kurse, Seminare & Teilnehmer', icon: GraduationCap, pfad: '/akademie', Sidebar: SidebarAkademie },
  { id: 'finanzierungen', label: 'Finanzierungen', beschreibung: 'Vermögensanlage "Ulmer Cash" & Beteiligungen', icon: PiggyBank, pfad: '/finanzierungen', Sidebar: SidebarFinanzierungen },
]

export function Layout({ children }: { children: ReactNode }) {
  const { state, dispatch } = useApp()
  const { session, mitarbeiter, signOut } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [dokumentImportOpen, setDokumentImportOpen] = useState(false)
  const [kiAssistentOpen, setKiAssistentOpen] = useState(false)
  const [profilMenuOpen, setProfilMenuOpen] = useState(false)
  const [benachrichtigungenOpen, setBenachrichtigungenOpen] = useState(false)
  const navigate = useNavigate()

  const aktuellerBereich = BEREICHE.find((b) => b.id === state.bereich) ?? BEREICHE[0]
  const { prioritaeten } = collectPriorityEntries(state.projekte)
  const followUps = collectFollowUpPriorities(state)
  const benachrichtigungen = [
    ...followUps.map((f) => ({ key: `fu-${f.bereich}-${f.id}`, titel: f.note || 'Follow-up', subtitel: f.name, onClick: () => navigate(followUpDetailPfad(f)) })),
    ...prioritaeten.map((p) => ({ key: `pr-${p.aufgabe.id}`, titel: p.aufgabe.titel, subtitel: p.projektName, onClick: () => navigate('/heute') })),
  ]

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
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setKiAssistentOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50 px-2.5 py-1.5 text-xs font-medium text-accent-700 hover:bg-accent-100"
            title="KI-Assistent: Notiz/Aufgabe aufnehmen oder Frage stellen"
          >
            <Sparkles size={14} />
            <span className="hidden sm:inline">KI-Assistent</span>
          </button>
          <button
            onClick={() => navigate('/postfach')}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            title="Postfach (info@amayer-holding.com)"
          >
            <Inbox size={16} />
          </button>
          <button
            onClick={() => setDokumentImportOpen(true)}
            className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 sm:inline-flex"
            title="Dokument per Handyscan/Druckerscan importieren"
          >
            <Camera size={16} />
          </button>

          <div className="relative">
            <button
              onClick={() => setBenachrichtigungenOpen((o) => !o)}
              className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              title="Benachrichtigungen"
            >
              <Bell size={16} />
              {benachrichtigungen.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                  {benachrichtigungen.length}
                </span>
              )}
            </button>
            {benachrichtigungenOpen && (
              <>
                <button className="fixed inset-0 z-40 cursor-default" onClick={() => setBenachrichtigungenOpen(false)} aria-label="Schließen" />
                <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                  <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Offene Prioritäten</p>
                  {benachrichtigungen.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-slate-400">Nichts Dringendes.</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      {benachrichtigungen.slice(0, 8).map((e) => (
                        <button
                          key={e.key}
                          onClick={() => {
                            setBenachrichtigungenOpen(false)
                            e.onClick()
                          }}
                          className="block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <span className="block truncate text-slate-700">{e.titel}</span>
                          <span className="text-xs text-slate-400">{e.subtitel}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setProfilMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-lg p-1.5 pr-2 hover:bg-slate-100"
              title="Profil & Einstellungen"
            >
              {state.profil.fotoDataUrl ? (
                <img src={state.profil.fotoDataUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-500">
                  <User size={15} />
                </div>
              )}
              <span className="hidden text-xs font-medium text-slate-600 sm:inline">{state.profil.name}</span>
              <ChevronDown size={13} className="hidden text-slate-400 sm:inline" />
            </button>
            {profilMenuOpen && (
              <>
                <button className="fixed inset-0 z-40 cursor-default" onClick={() => setProfilMenuOpen(false)} aria-label="Schließen" />
                <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                  <div className="px-2.5 py-2">
                    <p className="text-sm font-medium text-slate-800">{state.profil.name}</p>
                    <p className="text-xs text-slate-400">{isSupabaseConfigured && session ? mitarbeiter?.name ?? session.user.email : state.rolle === 'geschaeftsfuehrung' ? 'Geschäftsführung' : 'Mitarbeiter'}</p>
                  </div>
                  <div className="border-t border-slate-100 pt-1">
                    <MenuItem icon={<UserCog size={15} />} onClick={() => { setProfilMenuOpen(false); navigate('/profil') }}>
                      Mein Profil
                    </MenuItem>
                    <MenuItem icon={<ExternalLink size={15} />} onClick={() => { setProfilMenuOpen(false); window.open('#/portal/login', '_blank') }}>
                      Kundenportal (Demo)
                    </MenuItem>
                    <MenuItem icon={<Users size={15} />} onClick={() => { setProfilMenuOpen(false); rolleWechseln() }}>
                      Rolle wechseln ({state.rolle === 'geschaeftsfuehrung' ? 'Geschäftsführung' : 'Mitarbeiter'})
                    </MenuItem>
                    {state.rolle === 'geschaeftsfuehrung' && (
                      <MenuItem icon={<RotateCcw size={15} />} onClick={() => { setProfilMenuOpen(false); resetData() }}>
                        Daten zurücksetzen
                      </MenuItem>
                    )}
                    {isSupabaseConfigured && session && (
                      <MenuItem icon={<LogOut size={15} />} onClick={() => { setProfilMenuOpen(false); signOut() }}>
                        Abmelden
                      </MenuItem>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar — ab md sichtbar; auf Mobile steckt dieselbe Navigation stattdessen im
            Bereichsmenü-Drawer (siehe unten), damit sie nicht den knappen Platz wegnimmt. */}
        <aside
          className={`hidden flex-shrink-0 border-r border-slate-200 bg-white transition-all duration-150 md:flex ${
            sidebarCollapsed ? 'w-14' : 'w-60'
          }`}
        >
          <aktuellerBereich.Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((c) => !c)} />
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">{children}</div>
        </main>
      </div>

      {/* Sandwich Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={() => setDrawerOpen(false)} />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between p-6 pb-0">
              <h2 className="text-lg font-semibold text-slate-800">Bereich wählen</h2>
              <button onClick={() => setDrawerOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
                <X size={20} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {/* Navigation des aktuellen Bereichs — nur auf Mobile sichtbar, da dort die feste
                  Sidebar (siehe oben, ab md) keinen Platz hat. */}
              <div
                className="mb-6 rounded-xl border border-slate-200 md:hidden"
                onClick={(e) => {
                  // Schließt das Drawer nur bei echter Navigation (Klick auf einen Link), nicht
                  // beim Aufklappen von Untergruppen wie "Vorlagen".
                  if ((e.target as HTMLElement).closest('a')) setDrawerOpen(false)
                }}
              >
                <aktuellerBereich.Sidebar collapsed={false} onToggle={() => setDrawerOpen(false)} />
              </div>

              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Bereich wechseln</h3>
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
        </div>
      )}

      <DokumentenImportModal open={dokumentImportOpen} onClose={() => setDokumentImportOpen(false)} />
      <KiAssistentPanel open={kiAssistentOpen} onToggle={() => setKiAssistentOpen((o) => !o)} />
    </div>
  )
}

function MenuItem({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-600 hover:bg-slate-50">
      {icon}
      {children}
    </button>
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
