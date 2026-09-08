import { ArrowRight } from 'lucide-react'
import type { Bereich, FollowUp, Prioritaet } from '../types'
import { getStatusMap, getHauptpfad, getNextMainStep } from '../data/statusNetworks'
import { PriorityBadge } from './ui'
import { fmtDate, isOverdue } from '../lib/dates'
import { useNavigate } from 'react-router-dom'

export type BoardItem = {
  id: string
  title: string
  subtitle?: string
  prioritaet: Prioritaet
  status: string
  followUp: FollowUp
}

export function StatusBoard({
  bereich,
  items,
  onAdvance,
  basePath,
}: {
  bereich: Bereich
  items: BoardItem[]
  onAdvance: (id: string) => void
  basePath: string
}) {
  const map = getStatusMap(bereich)
  const columns = getHauptpfad(bereich)
  const navigate = useNavigate()

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((colId) => {
        const node = map[colId]
        const colItems = items.filter((i) => i.status === colId)
        return (
          <div key={colId} className="w-72 flex-shrink-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${node.color}`}>
                {node.label}
              </span>
              <span className="text-xs text-slate-400">{colItems.length}</span>
            </div>
            <div className="space-y-2 rounded-xl bg-slate-100/70 p-2 min-h-[120px]">
              {colItems.map((item) => {
                const overdue = isOverdue(item.followUp.date, item.followUp.done)
                const next = getNextMainStep(bereich, item.status)
                return (
                  <div
                    key={item.id}
                    onClick={() => navigate(`${basePath}/${item.id}`)}
                    className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-accent-300 hover:shadow"
                  >
                    <div className="mb-1.5 text-sm font-medium text-slate-800">{item.title}</div>
                    {item.subtitle && <div className="mb-1.5 text-xs text-slate-500">{item.subtitle}</div>}
                    <div className="mb-2 flex items-center justify-between">
                      <PriorityBadge value={item.prioritaet} />
                      <span className={`text-xs ${overdue ? 'font-medium text-rose-600' : 'text-slate-400'}`}>
                        {fmtDate(item.followUp.date)}
                      </span>
                    </div>
                    {next && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onAdvance(item.id)
                        }}
                        className="flex w-full items-center justify-center gap-1 rounded-md bg-accent-50 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100"
                      >
                        Weiter <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
              {colItems.length === 0 && <div className="p-3 text-center text-xs text-slate-300">–</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
