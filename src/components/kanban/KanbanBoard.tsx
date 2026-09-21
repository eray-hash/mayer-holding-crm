import { useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ArrowLeft, Plus } from 'lucide-react'
import type { Meilenstein, Aufgabe, AufgabenStatus } from '../../types/project'
import { AUFGABEN_STATUS_ORDER } from '../../types/project'
import { KanbanColumn } from './KanbanColumn'
import { TaskDetailModal } from './TaskDetailModal'
import { inputClass } from '../ui'

export function KanbanBoard({
  meilenstein,
  onClose,
  onMoveAufgabe,
  onSaveAufgabe,
  onAddAufgabe,
}: {
  meilenstein: Meilenstein
  onClose: () => void
  onMoveAufgabe: (aufgabeId: string, status: AufgabenStatus) => void
  onSaveAufgabe: (aufgabeId: string, patch: Partial<Aufgabe>) => void
  onAddAufgabe: (titel: string) => void
}) {
  const [openAufgabe, setOpenAufgabe] = useState<Aufgabe | null>(null)
  const [neueAufgabe, setNeueAufgabe] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function submitNeueAufgabe(e: React.FormEvent) {
    e.preventDefault()
    if (!neueAufgabe.trim()) return
    onAddAufgabe(neueAufgabe.trim())
    setNeueAufgabe('')
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const newStatus = over.id as AufgabenStatus
    if (AUFGABEN_STATUS_ORDER.includes(newStatus)) {
      onMoveAufgabe(String(active.id), newStatus)
    }
  }

  const liveAufgabe = openAufgabe ? meilenstein.aufgaben.find((a) => a.id === openAufgabe.id) ?? null : null

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <button onClick={onClose} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={16} /> Zurück
        </button>
        <h2 className="font-semibold text-slate-800">{meilenstein.titel}</h2>
        <form onSubmit={submitNeueAufgabe} className="ml-auto flex items-center gap-2">
          <input
            value={neueAufgabe}
            onChange={(e) => setNeueAufgabe(e.target.value)}
            placeholder="Neue Aufgabe…"
            className={`${inputClass} w-56`}
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700"
          >
            <Plus size={14} /> Hinzufügen
          </button>
        </form>
      </header>

      <div className="flex-1 overflow-x-auto p-4 sm:p-6">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-3">
            {AUFGABEN_STATUS_ORDER.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                aufgaben={meilenstein.aufgaben.filter((a) => a.status === status)}
                onOpenAufgabe={setOpenAufgabe}
              />
            ))}
          </div>
        </DndContext>
      </div>

      {liveAufgabe && (
        <TaskDetailModal
          aufgabe={liveAufgabe}
          onClose={() => setOpenAufgabe(null)}
          onSave={(patch) => onSaveAufgabe(liveAufgabe.id, patch)}
        />
      )}
    </div>
  )
}
