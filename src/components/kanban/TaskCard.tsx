import { useDraggable } from '@dnd-kit/core'
import { Bot, MessageCircleQuestion } from 'lucide-react'
import type { Aufgabe } from '../../types/project'
import { PriorityBadge } from '../ui'
import { fmtDate, isOverdue } from '../../lib/dates'

export function TaskCard({ aufgabe, onOpen }: { aufgabe: Aufgabe; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: aufgabe.id })

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 }
    : undefined

  const overdue = aufgabe.wiedervorlage ? isOverdue(aufgabe.wiedervorlage, aufgabe.status === 'erledigt') : false

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={`cursor-grab rounded-lg border p-2.5 text-sm shadow-sm active:cursor-grabbing ${
        aufgabe.fuerClaude ? 'border-accent-300 bg-accent-50' : 'border-slate-200 bg-white'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <p className="leading-snug text-slate-800">{aufgabe.titel}</p>
        <PriorityBadge value={aufgabe.prioritaet} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
        {aufgabe.fuerClaude && (
          <span className="inline-flex items-center gap-1 rounded bg-accent-100 px-1.5 py-0.5 text-accent-700">
            <Bot size={11} /> an Claude
          </span>
        )}
        {aufgabe.zustaendig && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{aufgabe.zustaendig}</span>}
        {aufgabe.wiedervorlage && (
          <span className={overdue ? 'font-medium text-rose-600' : ''}>{fmtDate(aufgabe.wiedervorlage)}</span>
        )}
        {aufgabe.fragen && <MessageCircleQuestion size={13} className="text-amber-500" />}
        {aufgabe.umsatzEuro != null && <span>{aufgabe.umsatzEuro.toLocaleString('de-DE')} €</span>}
      </div>
    </div>
  )
}
