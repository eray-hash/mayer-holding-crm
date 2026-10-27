import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, PhoneCall, Flame, CalendarClock, StickyNote, Trash2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { collectPriorityEntries, type PriorityEntry, type PriorityKind } from '../../lib/todayPriorities'
import { TaskDetailModal } from '../../components/kanban/TaskDetailModal'
import { PROJEKT_BEREICH_LABEL } from '../../types/project'
import { Card } from '../../components/ui'
import { fmtDate } from '../../lib/dates'

function weekdayGerman(): string {
  return new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}

const iconFor: Record<PriorityKind, React.ReactNode> = {
  overdue: <PhoneCall size={15} className="text-rose-500" />,
  today: <CalendarClock size={15} className="text-sky-500" />,
  hoch: <Flame size={15} className="text-amber-500" />,
  claude: <Bot size={15} className="text-accent-600" />,
}

function EntryRow({ e, onOpen }: { e: PriorityEntry; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 text-left text-sm hover:bg-slate-100"
      >
        <span className="mt-0.5 shrink-0">{iconFor[e.kind]}</span>
        <div className="min-w-0 flex-1">
          <p className="text-slate-800">{e.aufgabe.titel}</p>
          <p className="text-xs text-slate-400">
            {e.projektName}
            {e.aufgabe.zustaendig ? ` · ${e.aufgabe.zustaendig}` : ''}
            {e.aufgabe.wiedervorlage
              ? ` · ${e.kind === 'overdue' ? 'überfällig seit' : 'fällig'} ${fmtDate(e.aufgabe.wiedervorlage)}`
              : ''}
          </p>
        </div>
      </button>
    </li>
  )
}

export function HeuteScreen() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [openEntry, setOpenEntry] = useState<PriorityEntry | null>(null)
  const { prioritaeten, demnaechst } = collectPriorityEntries(state.projekte)

  const gruss = state.rolle === 'geschaeftsfuehrung' ? 'Geschäftsführung' : 'Team'
  const offeneNotizen = state.notizen.filter((n) => !n.erledigt)

  return (
    <div className="mx-auto max-w-3xl">
      {offeneNotizen.length > 0 && (
        <Card className="mb-5 p-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <StickyNote size={14} className="text-accent-600" /> Notizen
          </h2>
          <ul className="flex flex-col gap-2">
            {offeneNotizen.map((n) => (
              <li key={n.id} className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={n.erledigt}
                  onChange={() => dispatch({ type: 'TOGGLE_NOTIZ', id: n.id })}
                  className="mt-0.5 rounded"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-800">{n.text}</p>
                  <p className="text-xs text-slate-400">
                    {fmtDate(n.erstelltAm)}
                    {n.faelligkeitsDatum ? ` · fällig ${fmtDate(n.faelligkeitsDatum)}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => dispatch({ type: 'DELETE_NOTIZ', id: n.id })}
                  className="flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                  title="Löschen"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <p className="text-sm text-slate-400">{weekdayGerman()}</p>
        <h1 className="mb-4 text-xl font-bold text-slate-800">Guten Tag, {gruss} 👋</h1>

        <h2 className="mb-2 text-sm font-semibold text-slate-700">Deine Prioritäten heute</h2>
        {prioritaeten.length === 0 ? (
          <p className="mb-4 text-sm text-slate-400">Nichts Dringendes — sauber!</p>
        ) : (
          <ul className="mb-4 flex flex-col gap-2">
            {prioritaeten.map((e) => (
              <EntryRow key={e.aufgabe.id} e={e} onOpen={() => setOpenEntry(e)} />
            ))}
          </ul>
        )}

        {demnaechst.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-slate-500">Diese Woche ({demnaechst.length})</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {demnaechst.map((e) => (
                <EntryRow key={e.aufgabe.id} e={e} onOpen={() => setOpenEntry(e)} />
              ))}
            </ul>
          </details>
        )}
      </Card>

      <div className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Projekte nach Bereich</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['beratung', 'immobilien', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen', 'intern'] as const).map(
            (bereich) => {
              const anzahl = state.projekte.filter((p) => p.bereich === bereich).length
              if (anzahl === 0) return null
              const clickable =
                bereich === 'beratung' ||
                bereich === 'immobilien' ||
                bereich === 'erben' ||
                bereich === 'betriebsuebergabe' ||
                bereich === 'betriebsformen' ||
                bereich === 'akademie' ||
                bereich === 'finanzierungen'
              return (
                <button
                  key={bereich}
                  disabled={!clickable}
                  onClick={() => {
                    if (bereich === 'beratung') navigate('/beratung/projekte')
                    if (bereich === 'immobilien') navigate('/immobilien/projekte')
                    if (bereich === 'erben') navigate('/erben/projekte')
                    if (bereich === 'betriebsuebergabe') navigate('/betriebsuebergabe/projekte')
                    if (bereich === 'betriebsformen') navigate('/betriebsformen/projekte')
                    if (bereich === 'akademie') navigate('/akademie/projekte')
                    if (bereich === 'finanzierungen') navigate('/finanzierungen/projekte')
                  }}
                  className={`flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm ${
                    clickable ? 'hover:border-accent-300 hover:shadow' : 'opacity-60'
                  }`}
                >
                  <span className="font-medium text-slate-700">{PROJEKT_BEREICH_LABEL[bereich]}</span>
                  <span className="text-xs text-slate-400">{anzahl} Projekt{anzahl === 1 ? '' : 'e'}</span>
                </button>
              )
            },
          )}
        </div>
      </div>

      {openEntry && (
        <TaskDetailModal
          aufgabe={openEntry.aufgabe}
          onClose={() => setOpenEntry(null)}
          onSave={(patch) =>
            dispatch({
              type: 'UPDATE_AUFGABE',
              projektId: openEntry.projektId,
              meilensteinId: openEntry.meilensteinId,
              aufgabeId: openEntry.aufgabe.id,
              patch,
            })
          }
        />
      )}
    </div>
  )
}
