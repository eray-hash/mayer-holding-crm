import { useState } from 'react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import type { Bereich } from '../types'
import { getStatusMap, getNextMainStep } from '../data/statusNetworks'
import { StatusBadge } from './ui'

export function StatusWidget({
  bereich,
  status,
  onChange,
}: {
  bereich: Bereich
  status: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const map = getStatusMap(bereich)
  const node = map[status]
  const next = getNextMainStep(bereich, status)
  const nextNode = next ? map[next] : null

  if (!node) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge label={node.label} color={node.color} />
      {nextNode && (
        <button
          onClick={() => onChange(next!)}
          className="inline-flex items-center gap-1 rounded-lg bg-accent-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-700"
          title={`Weiter zu: ${nextNode.label}`}
        >
          Weiter <ArrowRight size={13} />
        </button>
      )}
      {node.next.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Status ändern <ChevronDown size={13} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {node.next.map((n) => {
                  const target = map[n]
                  if (!target) return null
                  return (
                    <button
                      key={n}
                      onClick={() => {
                        onChange(n)
                        setOpen(false)
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                    >
                      {target.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
      {node.isTerminal && <span className="text-xs text-slate-400">(final)</span>}
    </div>
  )
}
