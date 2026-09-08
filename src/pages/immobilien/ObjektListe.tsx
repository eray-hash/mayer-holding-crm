import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, List, LayoutGrid, ArrowRight } from 'lucide-react'
import { useApp, useAdvanceStatus } from '../../context/AppContext'
import { IMMOBILIEN_STATUS } from '../../data/statusNetworks'
import { PRIORITAET_ORDER, MITARBEITER, PRIORITAETEN, OBJEKT_GRUPPEN, OBJEKT_TYPEN, gruppeLabel } from '../../data/constants'
import { PriorityBadge, StatusBadge, PrimaryButton, Modal, Field, inputClass } from '../../components/ui'
import { StatusBoard } from '../../components/StatusBoard'
import { fmtDate, isOverdue, today, uid, fmtEUR } from '../../lib/dates'
import type { Objekt, Prioritaet, ObjektGruppe, ObjektTyp } from '../../types'

export function ObjektListe() {
  const { state, dispatch } = useApp()
  const { advanceObjekt } = useAdvanceStatus()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'liste' | 'board'>('liste')
  const [addOpen, setAddOpen] = useState(false)

  const gruppe = params.get('gruppe') ?? ''
  const [fStatus, setFStatus] = useState('')
  const [fPrio, setFPrio] = useState('')
  const [fVerantwortlich, setFVerantwortlich] = useState('')
  const [fOverdue, setFOverdue] = useState(false)

  const filtered = useMemo(() => {
    return state.objekte
      .filter((o) => !gruppe || o.gruppe === gruppe)
      .filter((o) => !fStatus || o.status === fStatus)
      .filter((o) => !fPrio || o.prioritaet === fPrio)
      .filter((o) => !fVerantwortlich || o.verantwortlich === fVerantwortlich)
      .filter((o) => !fOverdue || isOverdue(o.followUp.date, o.followUp.done))
      .sort((a, b) => PRIORITAET_ORDER[a.prioritaet] - PRIORITAET_ORDER[b.prioritaet])
  }, [state.objekte, gruppe, fStatus, fPrio, fVerantwortlich, fOverdue])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Objekte {gruppe && `– ${gruppeLabel(gruppe as ObjektGruppe)}`}</h1>
          <p className="text-sm text-slate-500">{filtered.length} von {state.objekte.length} Objekten</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button onClick={() => setView('liste')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'liste' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}>
              <List size={14} /> Liste
            </button>
            <button onClick={() => setView('board')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'board' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}>
              <LayoutGrid size={14} /> Board
            </button>
          </div>
          <PrimaryButton onClick={() => setAddOpen(true)}><Plus size={15} /> Neues Objekt</PrimaryButton>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <select value={gruppe} onChange={(e) => setParams(e.target.value ? { gruppe: e.target.value } : {})} className={`${inputClass} w-auto`}>
          <option value="">Alle Gruppen</option>
          {OBJEKT_GRUPPEN.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Status</option>
          {Object.values(IMMOBILIEN_STATUS).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
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
                <th className="px-4 py-3">Objekt</th>
                <th className="px-4 py-3">Gruppe</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Priorität</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Verantwortlich</th>
                <th className="px-4 py-3">Kaufpreis</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const overdue = isOverdue(o.followUp.date, o.followUp.done)
                const node = IMMOBILIEN_STATUS[o.status]
                return (
                  <tr key={o.id} onClick={() => navigate(`/immobilien/objekte/${o.id}`)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{o.bezeichnung}</div>
                      <div className="text-xs text-slate-400">{o.adresse}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{gruppeLabel(o.gruppe)}</td>
                    <td className="px-4 py-3 text-slate-500">{o.typ}</td>
                    <td className="px-4 py-3"><PriorityBadge value={o.prioritaet} /></td>
                    <td className="px-4 py-3"><StatusBadge label={node.label} color={node.color} /></td>
                    <td className="px-4 py-3">
                      <div className={overdue ? 'font-medium text-rose-600' : 'text-slate-600'}>{fmtDate(o.followUp.date)}</div>
                      <div className="text-xs text-slate-400">{o.followUp.note}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{o.verantwortlich}</td>
                    <td className="px-4 py-3 text-slate-700">{fmtEUR(o.kaufpreis)}</td>
                    <td className="px-4 py-3 text-right">
                      {node.next.length > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); advanceObjekt(o.id) }} className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100">
                          Weiter <ArrowRight size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">Keine Objekte gefunden.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <StatusBoard
          bereich="immobilien"
          basePath="/immobilien/objekte"
          onAdvance={(id) => advanceObjekt(id)}
          items={filtered.map((o) => ({ id: o.id, title: o.bezeichnung, subtitle: o.adresse, prioritaet: o.prioritaet, status: o.status, followUp: o.followUp }))}
        />
      )}

      <NeuesObjektModal open={addOpen} onClose={() => setAddOpen(false)} onCreate={(o) => dispatch({ type: 'ADD_OBJEKT', objekt: o })} />
    </div>
  )
}

function NeuesObjektModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (o: Objekt) => void }) {
  const [bezeichnung, setBezeichnung] = useState('')
  const [adresse, setAdresse] = useState('')
  const [gruppe, setGruppe] = useState<ObjektGruppe>('aktuell')
  const [typ, setTyp] = useState<ObjektTyp>('Wohnung')
  const [kaufpreis, setKaufpreis] = useState(500000)
  const [prioritaet, setPrioritaet] = useState<Prioritaet>('Mittel')
  const [status, setStatus] = useState('akquise')
  const [followUpDate, setFollowUpDate] = useState(today())
  const [verantwortlich, setVerantwortlich] = useState(MITARBEITER[0])

  function submit() {
    if (!bezeichnung.trim()) return
    onCreate({
      id: uid('o'),
      bezeichnung,
      adresse,
      gruppe,
      typ,
      kaufpreis,
      prioritaet,
      status,
      followUp: { date: followUpDate, note: 'Objekt aufgenommen', done: false },
      verantwortlich,
      activities: [{ id: uid('act'), date: today(), text: 'Objekt angelegt', user: verantwortlich }],
      dokumente: {},
    })
    setBezeichnung(''); setAdresse('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Neues Objekt">
      <Field label="Bezeichnung"><input className={inputClass} value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} /></Field>
      <Field label="Adresse"><input className={inputClass} value={adresse} onChange={(e) => setAdresse(e.target.value)} /></Field>
      <Field label="Gruppe">
        <select className={inputClass} value={gruppe} onChange={(e) => setGruppe(e.target.value as ObjektGruppe)}>
          {OBJEKT_GRUPPEN.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </Field>
      <Field label="Objekttyp">
        <select className={inputClass} value={typ} onChange={(e) => setTyp(e.target.value as ObjektTyp)}>
          {OBJEKT_TYPEN.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Kaufpreis (€)"><input type="number" className={inputClass} value={kaufpreis} onChange={(e) => setKaufpreis(Number(e.target.value))} /></Field>
      <Field label="Priorität">
        <select className={inputClass} value={prioritaet} onChange={(e) => setPrioritaet(e.target.value as Prioritaet)}>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Startstatus">
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.values(IMMOBILIEN_STATUS).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
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
        <PrimaryButton onClick={submit}>Objekt anlegen</PrimaryButton>
      </div>
    </Modal>
  )
}
