import { useNavigate } from 'react-router-dom'
import { Home } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, StatusBadge } from './ui'
import { fmtDate, fmtEUR } from '../lib/dates'
import type { KundeBereich } from '../types'

const STATUS_LABEL: Record<string, string> = { offen: 'Exposé versendet', akzeptiert: 'Angenommen', abgelehnt: 'Abgelehnt' }
const STATUS_COLOR: Record<string, string> = {
  offen: 'bg-sky-100 text-sky-700',
  akzeptiert: 'bg-emerald-100 text-emerald-700',
  abgelehnt: 'bg-rose-100 text-rose-700',
}

export function ZugewieseneObjekte({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string }) {
  const { state } = useApp()
  const navigate = useNavigate()
  const vorschlaege = state.objektVorschlaege.filter((v) => v.kundeBereich === bereich && v.kundeId === kundeId)

  if (vorschlaege.length === 0) return null

  return (
    <Card className="p-5 lg:col-span-3">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Vorgeschlagene / zugewiesene Objekte</h3>
      <div className="space-y-2">
        {vorschlaege.map((v) => {
          const objekt = state.objekte.find((o) => o.id === v.objektId)
          if (!objekt) return null
          return (
            <button
              key={v.id}
              onClick={() => navigate(`/immobilien/objekte/${objekt.id}`)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-accent-300 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2.5">
                <Home size={16} className="text-accent-500" />
                <div>
                  <div className="text-sm font-medium text-slate-800">{objekt.bezeichnung}</div>
                  <div className="text-xs text-slate-400">{objekt.adresse} · {fmtEUR(objekt.kaufpreis)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-slate-400 sm:inline">{fmtDate(v.erstelltAm)}</span>
                <StatusBadge label={STATUS_LABEL[v.status]} color={STATUS_COLOR[v.status]} />
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
