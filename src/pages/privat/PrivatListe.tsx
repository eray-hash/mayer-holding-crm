import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, List, LayoutGrid, ArrowRight, ClipboardList } from 'lucide-react'
import { useApp, useAdvanceStatus } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { PRIVAT_STATUS } from '../../data/statusNetworks'
import { PRIORITAET_ORDER, PRIORITAETEN } from '../../data/constants'
import { PriorityBadge, StatusBadge, PrimaryButton, SecondaryButton, Modal, Field, inputClass } from '../../components/ui'
import { StatusBoard } from '../../components/StatusBoard'
import { FragenkatalogModal } from '../../components/FragenkatalogModal'
import { fmtDate, isOverdue, today, uid } from '../../lib/dates'
import type { Kunde, Prioritaet } from '../../types'

// Eigener, pro Mitarbeiter isolierter Bereich (Entscheidung vom Nutzer: "nur für mich selbst
// sichtbar" + "genauso aufgebaut wie die anderen Bereiche") — gleiche Struktur wie z.B. Betriebsformen,
// aber die Sichtbarkeit wird nicht hier, sondern per RLS in Supabase erzwungen (siehe crmSync.ts /
// Migration "Privat-Bereich": bereich='privat' in der kunden-Tabelle, Policy auf verantwortlich_email).
export function PrivatListe() {
  const { state, dispatch } = useApp()
  const { session } = useAuth()
  const { advancePrivatKontakt } = useAdvanceStatus()
  const navigate = useNavigate()
  const [view, setView] = useState<'liste' | 'board'>('liste')
  const [addOpen, setAddOpen] = useState(false)
  const [fragenOpen, setFragenOpen] = useState(false)

  const [fStatus, setFStatus] = useState('')
  const [fPrio, setFPrio] = useState('')
  const [fOverdue, setFOverdue] = useState(false)

  const filtered = useMemo(() => {
    return state.privatKunden
      .filter((k) => !fStatus || k.status === fStatus)
      .filter((k) => !fPrio || k.prioritaet === fPrio)
      .filter((k) => !fOverdue || isOverdue(k.followUp.date, k.followUp.done))
      .sort((a, b) => PRIORITAET_ORDER[a.prioritaet] - PRIORITAET_ORDER[b.prioritaet])
  }, [state.privatKunden, fStatus, fPrio, fOverdue])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Meine Kontakte</h1>
          <p className="text-sm text-slate-500">{filtered.length} von {state.privatKunden.length} Kontakten · nur für dich sichtbar</p>
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
          <SecondaryButton onClick={() => setFragenOpen(true)}>
            <ClipboardList size={15} /> Fragenkatalog
          </SecondaryButton>
          <PrimaryButton onClick={() => setAddOpen(true)}>
            <Plus size={15} /> Neuer Kontakt
          </PrimaryButton>
        </div>
      </div>

      <FragenkatalogModal open={fragenOpen} onClose={() => setFragenOpen(false)} bereich="privat" />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Status</option>
          {Object.values(PRIVAT_STATUS).map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <select value={fPrio} onChange={(e) => setFPrio(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Prioritäten</option>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
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
                <th className="px-4 py-3">Zusatz</th>
                <th className="px-4 py-3">Priorität</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Letzte Aktivität</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => {
                const overdue = isOverdue(k.followUp.date, k.followUp.done)
                const node = PRIVAT_STATUS[k.status]
                return (
                  <tr
                    key={k.id}
                    onClick={() => navigate(`/privat/kontakte/${k.id}`)}
                    className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">{k.firma}</td>
                    <td className="px-4 py-3 text-slate-500">{k.ansprechpartner}</td>
                    <td className="px-4 py-3"><PriorityBadge value={k.prioritaet} /></td>
                    <td className="px-4 py-3"><StatusBadge label={node.label} color={node.color} /></td>
                    <td className="px-4 py-3">
                      <div className={overdue ? 'font-medium text-rose-600' : 'text-slate-600'}>{fmtDate(k.followUp.date)}</div>
                      <div className="text-xs text-slate-400">{k.followUp.note}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{fmtDate(k.letzteAktivitaet)}</td>
                    <td className="px-4 py-3 text-right">
                      {node.next.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            advancePrivatKontakt(k.id)
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
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">Noch keine eigenen Kontakte angelegt.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <StatusBoard
          bereich="privat"
          basePath="/privat/kontakte"
          onAdvance={(id) => advancePrivatKontakt(id)}
          items={filtered.map((k) => ({
            id: k.id,
            title: k.firma,
            subtitle: k.ansprechpartner,
            prioritaet: k.prioritaet,
            status: k.status,
            followUp: k.followUp,
          }))}
        />
      )}

      {addOpen && (
        <NeuerKontaktModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreate={(k) => dispatch({ type: 'ADD_PRIVAT_KONTAKT', kunde: { ...k, verantwortlichEmail: session?.user.email } })}
        />
      )}
    </div>
  )
}

function NeuerKontaktModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (k: Kunde) => void }) {
  const { mitarbeiter } = useAuth()
  const [firma, setFirma] = useState('')
  const [ansprechpartner, setAnsprechpartner] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [prioritaet, setPrioritaet] = useState<Prioritaet>('Mittel')
  const [status, setStatus] = useState('neu')
  const [followUpDate, setFollowUpDate] = useState(today())

  function submit() {
    if (!firma.trim()) return
    const verantwortlich = mitarbeiter?.name ?? 'Ich'
    onCreate({
      id: uid('priv'),
      firma,
      ansprechpartner,
      email,
      telefon,
      prioritaet,
      status,
      followUp: { date: followUpDate, note: 'Erstkontakt', done: false },
      verantwortlich,
      letzteAktivitaet: today(),
      activities: [{ id: uid('act'), date: today(), text: 'Kontakt angelegt', user: verantwortlich }],
    })
    setFirma(''); setAnsprechpartner(''); setEmail(''); setTelefon('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Neuer Kontakt">
      <Field label="Name"><input className={inputClass} value={firma} onChange={(e) => setFirma(e.target.value)} /></Field>
      <Field label="Zusatz (Firma/Rolle, optional)"><input className={inputClass} value={ansprechpartner} onChange={(e) => setAnsprechpartner(e.target.value)} /></Field>
      <Field label="E-Mail"><input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Telefon"><input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} /></Field>
      <Field label="Priorität">
        <select className={inputClass} value={prioritaet} onChange={(e) => setPrioritaet(e.target.value as Prioritaet)}>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Startstatus">
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.values(PRIVAT_STATUS).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Follow-up-Datum"><input type="date" className={inputClass} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Abbrechen</button>
        <PrimaryButton onClick={submit}>Kontakt anlegen</PrimaryButton>
      </div>
    </Modal>
  )
}
