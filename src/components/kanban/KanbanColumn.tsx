import { useDroppable } from '@dnd-kit/core'
import type { Aufgabe, AufgabenStatus } from '../../types/project'
import { AUFGABEN_STATUS_LABEL } from '../../types/project'
import { TaskCard } from './TaskCard'

export function KanbanColumn({
  status,
  aufgaben,
  onOpenAufgabe,
}: {
  status: AufgabenStatus
  aufgaben: Aufgabe[]
  onOpenAufgabe: (aufgabe: Aufgabe) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[220px] flex-1 flex-col gap-2 rounded-xl border p-2 transition ${
        isOver ? 'border-accent-300 bg-accent-50/50' : 'border-slate-200 bg-slate-100/70'
      }`}
    >
      <div className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span>{AUFGABEN_STATUS_LABEL[status]}</span>
        <span>{aufgaben.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {aufgaben.map((a) => (
          <TaskCard key={a.id} aufgabe={a} onOpen={() => onOpenAufgabe(a)} />
        ))}
        {aufgaben.length === 0 && <p className="px-1 py-3 text-center text-xs text-slate-300">–</p>}
      </div>
    </div>
  )
}
