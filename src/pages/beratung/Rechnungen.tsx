import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, PrimaryButton, Modal, Field, inputClass } from '../../components/ui'
import { RechnungStatusBadge } from './KundenDetail'
import { fmtDate, fmtEUR, today, uid, addDays } from '../../lib/dates'
import type { Rechnung, RechnungStatus } from '../../types'

export function Rechnungen() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)

  const kpis = useMemo(() => {
    const offen = state.rechnungen.filter((r) => r.status === 'Versendet').reduce((s, r) => s + r.betragBrutto, 0)
    const ueberfaellig = state.rechnungen.filter((r) => r.status === 'Überfällig').reduce((s, r) => s + r.betragBrutto, 0)
    const now = new Date()
    const quarter = Math.floor(now.getMonth() / 3)
    const bezahltQ = state.rechnungen
      .filter((r) => r.status === 'Bezahlt')
      .filter((r) => {
        const d = new Date(r.datum)
        return Math.floor(d.getMonth() / 3) === quarter && d.getFullYear() === now.getFullYear()
      })
      .reduce((s, r) => s + r.betragBrutto, 0)
    return { offen, ueberfaellig, bezahltQ }
  }, [state.rechnungen])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Rechnungen</h1>
          <p className="text-sm text-slate-500">Globale Übersicht über alle Kunden</p>
        </div>
        <PrimaryButton onClick={() => setAddOpen(true)}><Plus size={15} /> Neue Rechnung</PrimaryButton>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Offen" value={fmtEUR(kpis.offen)} />
        <Kpi label="Überfällig" value={fmtEUR(kpis.ueberfaellig)} accent="text-rose-600" />
        <Kpi label="Bezahlt dieses Quartal" value={fmtEUR(kpis.bezahltQ)} accent="text-emerald-600" />
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Nr.</th>
              <th className="px-4 py-3">Kunde</th>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3">Betrag (netto/brutto)</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Zahlungsziel</th>
            </tr>
          </thead>
          <tbody>
            {state.rechnungen.map((r) => {
              const kunde = state.kunden.find((k) => k.id === r.kundeId)
              return (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-700">{r.nummer}</td>
                  <td className="px-4 py-3 cursor-pointer text-slate-600 hover:text-accent-700" onClick={() => kunde && navigate(`/beratung/kunden/${kunde.id}`)}>
                    {kunde?.firma ?? '–'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(r.datum)}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtEUR(r.betragNetto)} / {fmtEUR(r.betragBrutto)}</td>
                  <td className="px-4 py-3"><RechnungStatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(r.zahlungsziel)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <NeueRechnungModal open={addOpen} onClose={() => setAddOpen(false)} onCreate={(r) => dispatch({ type: 'ADD_RECHNUNG', rechnung: r })} />
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ?? 'text-slate-800'}`}>{value}</div>
    </Card>
  )
}

function NeueRechnungModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (r: Rechnung) => void }) {
  const { state } = useApp()
  const [kundeId, setKundeId] = useState(state.kunden[0]?.id ?? '')
  const [betragNetto, setBetragNetto] = useState(1000)
  const [status, setStatus] = useState<RechnungStatus>('Entwurf')

  function submit() {
    const nr = `RE-2026-${Math.floor(1000 + Math.random() * 8999)}`
    onCreate({
      id: uid('r'),
      nummer: nr,
      kundeId,
      datum: today(),
      betragNetto,
      betragBrutto: Math.round(betragNetto * 1.19),
      status,
      zahlungsziel: addDays(today(), 30),
    })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Neue Rechnung">
      <Field label="Kunde">
        <select className={inputClass} value={kundeId} onChange={(e) => setKundeId(e.target.value)}>
          {state.kunden.map((k) => <option key={k.id} value={k.id}>{k.firma}</option>)}
        </select>
      </Field>
      <Field label="Betrag netto (€)">
        <input type="number" className={inputClass} value={betragNetto} onChange={(e) => setBetragNetto(Number(e.target.value))} />
      </Field>
      <Field label="Status">
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as RechnungStatus)}>
          <option>Entwurf</option><option>Versendet</option><option>Bezahlt</option><option>Überfällig</option>
        </select>
      </Field>
      <div className="mt-4 flex justify-end">
        <PrimaryButton onClick={submit}>Rechnung anlegen</PrimaryButton>
      </div>
    </Modal>
  )
}
