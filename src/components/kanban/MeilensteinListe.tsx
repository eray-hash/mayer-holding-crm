import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Meilenstein, Aufgabe, AufgabenStatus } from '../../types/project'
import { fmtDate } from '../../lib/dates'
import { KanbanBoard } from './KanbanBoard'

export function MeilensteinListe({
  meilensteine,
  onMoveAufgabe,
  onSaveAufgabe,
  onAddAufgabe,
}: {
  meilensteine: Meilenstein[]
  onMoveAufgabe: (meilensteinId: string, aufgabeId: string, status: AufgabenStatus) => void
  onSaveAufgabe: (meilensteinId: string, aufgabeId: string, patch: Partial<Aufgabe>) => void
  onAddAufgabe: (meilensteinId: string, titel: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const liveOpen = openId ? meilensteine.find((m) => m.id === openId) ?? null : null

  return (
    <div className="flex flex-col gap-1">
      {[...meilensteine]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => {
          const done = m.aufgaben.filter((a) => a.status === 'erledigt').length
          const total = m.aufgaben.length
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setOpenId(m.id)}
              className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-slate-50"
            >
              <ChevronRight size={14} className="text-slate-300" />
              <span className={done === total && total > 0 ? 'text-slate-400 line-through' : 'text-slate-700'}>{m.titel}</span>
              <span className="ml-auto shrink-0 text-xs text-slate-400">
                {done}/{total}
                {m.eta ? ` · ${fmtDate(m.eta)}` : ''}
              </span>
            </button>
          )
        })}

      {liveOpen && (
        <KanbanBoard
          meilenstein={liveOpen}
          onClose={() => setOpenId(null)}
          onMoveAufgabe={(aufgabeId, status) => onMoveAufgabe(liveOpen.id, aufgabeId, status)}
          onSaveAufgabe={(aufgabeId, patch) => onSaveAufgabe(liveOpen.id, aufgabeId, patch)}
          onAddAufgabe={(titel) => onAddAufgabe(liveOpen.id, titel)}
        />
      )}
    </div>
  )
}
