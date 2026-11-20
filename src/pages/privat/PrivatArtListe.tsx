import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Plus, List, LayoutGrid, ArrowRight, ClipboardList, Lock } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { getHauptpfad, getNextMainStep, getStatusMap } from '../../data/statusNetworks'
import { PRIORITAET_ORDER, PRIORITAETEN } from '../../data/constants'
import { privatArtInfo, type PrivatArtInfo } from '../../data/privatArten'
import { PriorityBadge, StatusBadge, PrimaryButton, SecondaryButton, Modal, Field, inputClass } from '../../components/ui'
import { StatusBoard } from '../../components/StatusBoard'
import { FragenkatalogModal } from '../../components/FragenkatalogModal'
import { useMsStatus } from '../../lib/microsoftKonto'
import { fmtDate, isOverdue, today, uid } from '../../lib/dates'
import type { Kunde, Prioritaet } from '../../types'

/**
 * Privater Unterbereich (Privat → Beratung, Erben, …): die eigenen Kunden dieser Art, mit Statusablauf, Board und
 * Fragenkatalog des gleichnamigen Mayer-Bereichs. Nur für den Besitzer sichtbar (Datenbank-Regel auf verantwortlich_email).
 */
export function PrivatArtListe() {
  const { art } = useParams()
  const info = privatArtInfo(art)
  const { ansichtAls, session } = useAuth()
  const { status } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())
  if (!info || info.id === 'immobilienkunden') return <Navigate to="/privat" replace />
  if (ansichtAls) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Private Kunden werden in dieser Ansicht nicht gezeigt.</div>
  if (!status) return <p className="text-sm text-slate-400">Wird geladen …</p>
  if (!status.erlaubt) return <Navigate to="/privat" replace />
  return <Inhalt key={info.id} info={info} />
}

function Inhalt({ info }: { info: PrivatArtInfo }) {
  const { state, dispatch } = useApp()
  const { session, mitarbeiter } = useAuth()
  const navigate = useNavigate()
  const [view, setView] = useState<'liste' | 'board'>('liste')
  const [addOpen, setAddOpen] = useState(false)
  const [fragenOpen, setFragenOpen] = useState(false)
  const [fStatus, setFStatus] = useState('')
  const [fPrio, setFPrio] = useState('')
  const [fOverdue, setFOverdue] = useState(false)

  const ablauf = getStatusMap(info.id)
  const alle = useMemo(() => state.privatKunden.filter((k) => k.privatArt === info.id), [state.privatKunden, info.id])
  const filtered = useMemo(
    () =>
      alle
        .filter((k) => !fStatus || k.status === fStatus)
        .filter((k) => !fPrio || k.prioritaet === fPrio)
        .filter((k) => !fOverdue || isOverdue(k.followUp.date, k.followUp.done))
        .sort((a, b) => PRIORITAET_ORDER[a.prioritaet] - PRIORITAET_ORDER[b.prioritaet]),
    [alle, fStatus, fPrio, fOverdue],
  )
  const pfad = (id: string) => `/privat/art/${info.id}/${id}`
  const weiter = (k: Kunde) => {
    const next = getNextMainStep(info.id, k.status)
    if (next) dispatch({ type: 'SET_PRIVAT_STATUS', id: k.id, status: next })
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <Lock size={16} className="text-slate-400" /> {info.label} — meine {info.mehrzahl}
          </h1>
          <p className="text-sm text-slate-500">
            {filtered.length} von {alle.length} · nur für dich sichtbar
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button onClick={() => setView('liste')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'liste' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}>
              <List size={14} /> Liste
            </button>
            <button onClick={() => setView('board')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'board' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}>
              <LayoutGrid size={14} /> Board
            </button>
          </div>
          <SecondaryButton onClick={() => setFragenOpen(true)}>
            <ClipboardList size={15} /> Fragenkatalog
          </SecondaryButton>
          <PrimaryButton onClick={() => setAddOpen(true)}>
            <Plus size={15} /> Neuer {info.einzahl}
          </PrimaryButton>
        </div>
      </div>

      <FragenkatalogModal open={fragenOpen} onClose={() => setFragenOpen(false)} bereich={info.id} />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Status</option>
          {Object.values(ablauf).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={fPrio} onChange={(e) => setFPrio(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Prioritäten</option>
          {PRIORITAETEN.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={fOverdue} onChange={(e) => setFOverdue(e.target.checked)} className="rounded" />
          nur überfällige Wiedervorlagen
        </label>
      </div>

      {view === 'liste' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">{info.einzahl}</th>
                <th className="px-4 py-3">Ansprechpartner</th>
                <th className="px-4 py-3">Priorität</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Wiedervorlage</th>
                <th className="px-4 py-3">Letzte Aktivität</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => {
                const overdue = isOverdue(k.followUp.date, k.followUp.done)
                const node = ablauf[k.status]
                return (
                  <tr key={k.id} onClick={() => navigate(pfad(k.id))} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-800">{k.firma}</td>
                    <td className="px-4 py-3 text-slate-500">{k.ansprechpartner}</td>
                    <td className="px-4 py-3">
                      <PriorityBadge value={k.prioritaet} />
                    </td>
                    <td className="px-4 py-3">{node ? <StatusBadge label={node.label} color={node.color} /> : <span className="text-xs text-slate-400">{k.status}</span>}</td>
                    <td className="px-4 py-3">
                      <div className={overdue ? 'font-medium text-rose-600' : 'text-slate-600'}>{fmtDate(k.followUp.date)}</div>
                      <div className="text-xs text-slate-400">{k.followUp.note}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{fmtDate(k.letzteAktivitaet)}</td>
                    <td className="px-4 py-3 text-right">
                      {node && node.next.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            weiter(k)
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
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    Keine {info.mehrzahl} gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <StatusBoard
          bereich={info.id}
          basePath={`/privat/art/${info.id}`}
          onAdvance={(id) => {
            const k = alle.find((x) => x.id === id)
            if (k) weiter(k)
          }}
          items={filtered.map((k) => ({ id: k.id, title: k.firma, subtitle: k.ansprechpartner, prioritaet: k.prioritaet, status: k.status, followUp: k.followUp }))}
        />
      )}

      {addOpen && (
        <NeuerKontaktModal
          info={info}
          onClose={() => setAddOpen(false)}
          onCreate={(k) =>
            dispatch({
              type: 'ADD_PRIVAT_KONTAKT',
              kunde: { ...k, verantwortlichEmail: (session?.user.email ?? '').toLowerCase(), verantwortlich: mitarbeiter?.name ?? k.verantwortlich, privatArt: info.id },
            })
          }
        />
      )}
    </div>
  )
}

function NeuerKontaktModal({ info, onClose, onCreate }: { info: PrivatArtInfo; onClose: () => void; onCreate: (k: Kunde) => void }) {
  const startStatus = getHauptpfad(info.id)[0] ?? Object.keys(getStatusMap(info.id))[0]
  const [firma, setFirma] = useState('')
  const [ansprechpartner, setAnsprechpartner] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [prioritaet, setPrioritaet] = useState<Prioritaet>('Mittel')
  const [status, setStatus] = useState(startStatus)
  const [followUpDate, setFollowUpDate] = useState(today())

  function submit() {
    if (!firma.trim()) return
    onCreate({
      id: uid('pv'),
      firma: firma.trim(),
      ansprechpartner,
      email,
      telefon,
      prioritaet,
      status,
      followUp: { date: followUpDate, note: 'Erstkontakt', done: false },
      verantwortlich: '',
      letzteAktivitaet: today(),
      activities: [{ id: uid('act'), date: today(), text: `${info.einzahl} angelegt (privat, ${info.label})`, user: '' }],
    })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={`Neuer ${info.einzahl} (${info.label}, privat)`}>
      <Field label={info.id === 'beratung' ? 'Firma' : `${info.einzahl} / Familie`}>
        <input className={inputClass} value={firma} onChange={(e) => setFirma(e.target.value)} />
      </Field>
      <Field label="Ansprechpartner">
        <input className={inputClass} value={ansprechpartner} onChange={(e) => setAnsprechpartner(e.target.value)} />
      </Field>
      <Field label="E-Mail">
        <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Telefon">
        <input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} />
      </Field>
      <Field label="Priorität">
        <select className={inputClass} value={prioritaet} onChange={(e) => setPrioritaet(e.target.value as Prioritaet)}>
          {PRIORITAETEN.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Startstatus">
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.values(getStatusMap(info.id)).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Wiedervorlage">
        <input type="date" className={inputClass} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
          Abbrechen
        </button>
        <PrimaryButton onClick={submit}>Anlegen</PrimaryButton>
      </div>
    </Modal>
  )
}
