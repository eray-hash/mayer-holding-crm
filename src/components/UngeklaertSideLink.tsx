import { Link, useLocation } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AKTE_UNGEKLAERT, PFAD_UNGEKLAERT } from '../data/sammelakten'

// Fester Eintrag "Ungeklärte Eingänge" für die Seitenleiste jedes Bereichs: Was per Telegram kam und
// niemandem zuzuordnen war, liegt in einer Sammelakte (in der Unternehmensberatung). Der Eintrag
// steht überall, damit niemand die Akte suchen muss; die Zahl zeigt, wie viel dort wartet.
// Die Akte öffnet sich im Bereich Unternehmensberatung — wer dafür keine Berechtigung hat, landet
// nach dem Klick auf "Heute" (Stand heute haben alle Mitarbeiter diese Berechtigung).
export function UngeklaertSideLink({ collapsed }: { collapsed: boolean }) {
  const location = useLocation()
  const { state } = useApp()
  const anzahl = state.kunden.find((k) => k.id === AKTE_UNGEKLAERT)?.dokumente?.length ?? 0
  const active = location.pathname === PFAD_UNGEKLAERT
  return (
    <Link
      to={PFAD_UNGEKLAERT}
      title="Per Telegram geschickt, aber niemandem zuzuordnen"
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'
      } ${collapsed ? 'justify-center' : ''}`}
    >
      <span className="relative">
        <Inbox size={17} />
        {collapsed && anzahl > 0 && <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-amber-500" />}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1">Ungeklärte Eingänge</span>
          {anzahl > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">{anzahl}</span>}
        </>
      )}
    </Link>
  )
}
