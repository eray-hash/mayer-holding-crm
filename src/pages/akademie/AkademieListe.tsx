import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, List, LayoutGrid, ArrowRight } from 'lucide-react'
import { useApp, useAdvanceStatus } from '../../context/AppContext'
import { AKADEMIE_STATUS } from '../../data/statusNetworks'
import { PRIORITAET_ORDER, MITARBEITER, PRIORITAETEN } from '../../data/constants'
import { PriorityBadge, StatusBadge, PrimaryButton, Modal, Field, inputClass } from '../../components/ui'
import { StatusBoard } from '../../components/StatusBoard'
import { fmtDate, isOverdue, today, uid } from '../../lib/dates'
import type { Kunde, Prioritaet } from '../../types'

export function AkademieListe() {
  const { state, dispatch } = useApp()
  const { advanceAkademieTeilnehmer } = useAdvanceStatus()
  const navigate = useNavigate()
  const [view, setView] = useState<'liste' | 'board'>('liste')
  const [addOpen, setAddOpen] = useState(false)

  const [fStatus, setFStatus] = useState('')
  const [fPrio, setFPrio] = useState('')
  const [fVerantwortlich, setFVerantwortlich] = useState('')
  const [fOverdue, setFOverdue] = useState(false)

  const filtered = useMemo(() => {
    return state.akademieTeilnehmer
      .filter((k) => !fStatus || k.status === fStatus)
      .filter((k) => !fPrio || k.prioritaet === fPrio)
      .filter((k) => !fVerantwortlich || k.verantwortlich === fVerantwortlich)
      .filter((k) => !fOverdue || isOverdue(k.followUp.date, k.followUp.done))
      .sort((a, b) => PRIORITAET_ORDER[a.prioritaet] - PRIORITAET_ORDER[b.prioritaet])
  }, [state.akademieTeilnehmer, fStatus, fPrio, fVerantwortlich, fOverdue])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Teilnehmer</h1>
          <p className="text-sm text-slate-500">{filtered.length} von {state.akademieTeilnehmer.length} Teilnehmern</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setView('liste')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'liste' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}
            >
              <List size={14} /> Liste
            </button>
            <button
              onClick={() => setView('board')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'board' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}
            >
              <LayoutGrid size={14} /> Board
            </button>
          </div>
          <PrimaryButton onClick={() => setAddOpen(true)}>
            <Plus size={15} /> Neuer Teilnehmer
          </PrimaryButton>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Status</option>
          {Object.values(AKADEMIE_STATUS).map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <select value={fPrio} onChange={(e) => setFPrio(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Prioritäten</option>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={fVerantwortlich} onChange={(e) => setFVerantwortlich(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Verantwortlichen</option>
          {MITARBEITER.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={fOverdue} onChange={(e) => setFOverdue(e.target.checked)} className="rounded" />
          nur überfällige Follow-ups
        </label>
      </div>

      {view === 'liste' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Kontakt</th>
                <th className="px-4 py-3">Priorität</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Verantwortlich</th>
                <th className="px-4 py-3">Letzte Aktivität</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => {
                const overdue = isOverdue(k.followUp.date, k.followUp.done)
                const node = AKADEMIE_STATUS[k.status]
                return (
                  <tr
                    key={k.id}
                    onClick={() => navigate(`/akademie/teilnehmer/${k.id}`)}
                    className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">{k.firma}</td>
                    <td className="px-4 py-3 text-slate-500">{k.email}</td>
                    <td className="px-4 py-3"><PriorityBadge value={k.prioritaet} /></td>
                    <td className="px-4 py-3"><StatusBadge label={node.label} color={node.color} /></td>
                    <td className="px-4 py-3">
                      <div className={overdue ? 'font-medium text-rose-600' : 'text-slate-600'}>{fmtDate(k.followUp.date)}</div>
                      <div className="text-xs text-slate-400">{k.followUp.note}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{k.verantwortlich}</td>
                    <td className="px-4 py-3 text-slate-400">{fmtDate(k.letzteAktivitaet)}</td>
                    <td className="px-4 py-3 text-right">
                      {node.next.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            advanceAkademieTeilnehmer(k.id)
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100"
                        >
                          Weiter <ArrowRight size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">Keine Teilnehmer gefunden.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <StatusBoard
          bereich="akademie"
          basePath="/akademie/teilnehmer"
          onAdvance={(id) => advanceAkademieTeilnehmer(id)}
          items={filtered.map((k) => ({
            id: k.id,
            title: k.firma,
            subtitle: k.email,
            prioritaet: k.prioritaet,
            status: k.status,
            followUp: k.followUp,
          }))}
        />
      )}

      <NeuerTeilnehmerModal open={addOpen} onClose={() => setAddOpen(false)} onCreate={(k) => dispatch({ type: 'ADD_AKADEMIE_TEILNEHMER', kunde: k })} />
    </div>
  )
}

function NeuerTeilnehmerModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (k: Kunde) => void }) {
  const [firma, setFirma] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [prioritaet, setPrioritaet] = useState<Prioritaet>('Mittel')
  const [status, setStatus] = useState('interessent')
  const [followUpDate, setFollowUpDate] = useState(today())
  const [verantwortlich, setVerantwortlich] = useState(MITARBEITER[0])

  function submit() {
    if (!firma.trim()) return
    onCreate({
      id: uid('a'),
      firma,
      ansprechpartner: firma,
      email,
      telefon,
      prioritaet,
      status,
      followUp: { date: followUpDate, note: 'Erstkontakt', done: false },
      verantwortlich,
      letzteAktivitaet: today(),
      activities: [{ id: uid('act'), date: today(), text: 'Teilnehmer angelegt', user: verantwortlich }],
    })
    setFirma(''); setEmail(''); setTelefon('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Neuer Teilnehmer">
      <Field label="Name"><input className={inputClass} value={firma} onChange={(e) => setFirma(e.target.value)} /></Field>
      <Field label="E-Mail"><input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Telefon"><input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} /></Field>
      <Field label="Priorität">
        <select className={inputClass} value={prioritaet} onChange={(e) => setPrioritaet(e.target.value as Prioritaet)}>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Startstatus">
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.values(AKADEMIE_STATUS).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Follow-up-Datum"><input type="date" className={inputClass} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} /></Field>
      <Field label="Verantwortlich">
        <select className={inputClass} value={verantwortlich} onChange={(e) => setVerantwortlich(e.target.value)}>
          {MITARBEITER.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Abbrechen</button>
        <PrimaryButton onClick={submit}>Teilnehmer anlegen</PrimaryButton>
      </div>
    </Modal>
  )
}
