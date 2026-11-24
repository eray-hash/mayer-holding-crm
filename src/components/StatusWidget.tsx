import { useState } from 'react'
import { ArrowRight, ChevronDown, RotateCcw } from 'lucide-react'
import type { Bereich, Kunde, KundeBereich } from '../types'
import { getStatusMap, getNextMainStep } from '../data/statusNetworks'
import { StatusBadge } from './ui'
import { VerlorenDialog } from './VerlorenDialog'
import { useApp } from '../context/AppContext'
import { useKvNutzer } from './KostenvoranschlaegeSection'
import { deDatum, grundLabel, nimmWiederAuf } from '../lib/entgangen'

export function StatusWidget({
  bereich,
  status,
  onChange,
  akte,
}: {
  bereich: Bereich
  status: string
  onChange: (next: string) => void
  /** Kundenakte: Wahl von „verloren“ öffnet den Grund-Dialog, eine verlorene Akte bekommt „Wieder aufnehmen“
   *  (Entgangene Klienten, 24.11.2026). Ohne akte (z. B. Objekte) wie bisher. */
  akte?: { kunde: Kunde; bereich: KundeBereich }
}) {
  const [open, setOpen] = useState(false)
  const [verlorenOffen, setVerlorenOffen] = useState(false)
  const { dispatch } = useApp()
  const nutzer = useKvNutzer()
  const map = getStatusMap(bereich)
  const waehle = (n: string) => {
    if (akte && n === 'verloren') setVerlorenOffen(true)
    else onChange(n)
  }
  const node = map[status]
  const next = getNextMainStep(bereich, status)
  const nextNode = next ? map[next] : null

  if (!node) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge label={node.label} color={node.color} />
      {nextNode && (
        <button
          onClick={() => waehle(next!)}
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
                        waehle(n)
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
      {node.isTerminal && !(akte && status === 'verloren') && <span className="text-xs text-slate-400">(final)</span>}
      {akte && status === 'verloren' && (
        <>
          {akte.kunde.verloren && (
            <span className="text-xs text-slate-500" title={akte.kunde.verloren.notiz ?? ''}>
              Grund: {grundLabel(akte.kunde.verloren.grund)} · seit {deDatum(akte.kunde.verloren.am)}
            </span>
          )}
          {!akte.kunde.verloren && (
            <button onClick={() => setVerlorenOffen(true)} className="text-xs font-medium text-accent-700 underline">
              Grund nachtragen
            </button>
          )}
          <button
            onClick={() => {
              if (nutzer.nurLesen) return
              if (confirm('Akte wieder aufnehmen? Sie geht auf den Stand vor dem Verlieren zurück; der Grund bleibt im Verlauf stehen.')) {
                nimmWiederAuf(dispatch, akte.bereich, akte.kunde, nutzer.name)
              }
            }}
            disabled={nutzer.nurLesen}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw size={13} /> Wieder aufnehmen
          </button>
        </>
      )}
      {akte && <VerlorenDialog open={verlorenOffen} bereich={akte.bereich} kunde={akte.kunde} onClose={() => setVerlorenOffen(false)} />}
    </div>
  )
}
