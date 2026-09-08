import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, PrimaryButton, Modal, Field, inputClass, StatusBadge } from '../../components/ui'
import { fmtEUR, uid } from '../../lib/dates'
import { finStatusColor } from './ObjektDetail'
import type { Finanzierung, FinanzierungStatus } from '../../types'

export function Finanzierungen() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Finanzierungen</h1>
          <p className="text-sm text-slate-500">Alle Finanzierungen über alle Objekte</p>
        </div>
        <PrimaryButton onClick={() => setAddOpen(true)}><Plus size={15} /> Neue Finanzierung</PrimaryButton>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Objekt</th>
              <th className="px-4 py-3">Bank/Partner</th>
              <th className="px-4 py-3">Darlehenssumme</th>
              <th className="px-4 py-3">Zinssatz</th>
              <th className="px-4 py-3">Laufzeit</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ansprechpartner</th>
            </tr>
          </thead>
          <tbody>
            {state.finanzierungen.map((f) => {
              const objekt = state.objekte.find((o) => o.id === f.objektId)
              return (
                <tr key={f.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3 cursor-pointer font-medium text-slate-700 hover:text-accent-700" onClick={() => objekt && navigate(`/immobilien/objekte/${objekt.id}`)}>
                    {objekt?.bezeichnung ?? '–'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{f.bank}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtEUR(f.darlehenssumme)}</td>
                  <td className="px-4 py-3 text-slate-500">{f.zinssatz.toFixed(1)} %</td>
                  <td className="px-4 py-3 text-slate-500">{f.laufzeit}</td>
                  <td className="px-4 py-3"><StatusBadge label={f.status} color={finStatusColor(f.status)} /></td>
                  <td className="px-4 py-3 text-slate-500">{f.ansprechpartner}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <NeueFinanzierungModal open={addOpen} onClose={() => setAddOpen(false)} onCreate={(f) => dispatch({ type: 'ADD_FINANZIERUNG', finanzierung: f })} />
    </div>
  )
}

function NeueFinanzierungModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (f: Finanzierung) => void }) {
  const { state } = useApp()
  const [objektId, setObjektId] = useState(state.objekte[0]?.id ?? '')
  const [bank, setBank] = useState('')
  const [darlehenssumme, setDarlehenssumme] = useState(300000)
  const [zinssatz, setZinssatz] = useState(3.5)
  const [laufzeit, setLaufzeit] = useState('20 Jahre')
  const [status, setStatus] = useState<FinanzierungStatus>('Angefragt')
  const [ansprechpartner, setAnsprechpartner] = useState('')

  function submit() {
    onCreate({ id: uid('f'), objektId, bank, darlehenssumme, zinssatz, laufzeit, status, ansprechpartner })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Neue Finanzierung">
      <Field label="Objekt">
        <select className={inputClass} value={objektId} onChange={(e) => setObjektId(e.target.value)}>
          {state.objekte.map((o) => <option key={o.id} value={o.id}>{o.bezeichnung}</option>)}
        </select>
      </Field>
      <Field label="Bank / Partner"><input className={inputClass} value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
      <Field label="Darlehenssumme (€)"><input type="number" className={inputClass} value={darlehenssumme} onChange={(e) => setDarlehenssumme(Number(e.target.value))} /></Field>
      <Field label="Zinssatz (%)"><input type="number" step="0.1" className={inputClass} value={zinssatz} onChange={(e) => setZinssatz(Number(e.target.value))} /></Field>
      <Field label="Laufzeit"><input className={inputClass} value={laufzeit} onChange={(e) => setLaufzeit(e.target.value)} /></Field>
      <Field label="Status">
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as FinanzierungStatus)}>
          <option>Angefragt</option><option>In Prüfung</option><option>Zugesagt</option><option>Abgelehnt</option><option>Ausgezahlt</option>
        </select>
      </Field>
      <Field label="Ansprechpartner"><input className={inputClass} value={ansprechpartner} onChange={(e) => setAnsprechpartner(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end">
        <PrimaryButton onClick={submit}>Finanzierung anlegen</PrimaryButton>
      </div>
    </Modal>
  )
}
