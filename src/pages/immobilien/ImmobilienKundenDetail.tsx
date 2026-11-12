import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { StatusWidget } from '../../components/StatusWidget'
import { Card, Modal, EmptyState } from '../../components/ui'
import { FollowUpForm } from '../../components/FollowUpEditor'
import { fmtDate, isOverdue } from '../../lib/dates'
import { PRIORITAETEN } from '../../data/constants'
import { ZugewieseneObjekte } from '../../components/ZugewieseneObjekte'
import { GespraechsprotokolleSection } from '../../components/GespraechsprotokolleSection'
import { PotenzialAnalyseSection } from '../../components/PotenzialAnalyseSection'
import { KaeuferprofilSection } from '../../components/KaeuferprofilSection'
import { StammdatenWarnungBanner } from '../../components/StammdatenWarnungBanner'
import { StammdatenKarte } from '../../components/StammdatenKarte'
import { AktivitaetenTimeline } from '../../components/AktivitaetenTimeline'
import { KundeHinweise } from '../../components/PruefHinweisBadge'
import { SelbstauskunftSection } from '../../components/SelbstauskunftSection'
import { NdaSection } from '../../components/NdaSection'
import { DokumenteSection } from '../../components/DokumenteSection'
import { KommunikationSection } from '../../components/KommunikationSection'
import { LoeschenKundeButton } from '../../components/LoeschenKundeButton'
import type { Prioritaet } from '../../types'

const TABS = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'protokolle', label: 'Gesprächsprotokolle' },
  { id: 'potenzial', label: 'Potenzial-Analyse' },
  { id: 'kaeuferprofil', label: 'Käuferprofil' },
  { id: 'selbstauskunft', label: 'Selbstauskunft' },
  { id: 'nda', label: 'NDA' },
  { id: 'dokumente', label: 'Dokumente' },
  { id: 'kommunikation', label: 'Kommunikation' },
]

// Immobilien-Kunden (Interessenten/Eigentümer-Kontakte) — eigene Kunden-/Mandantenliste wie bei den
// übrigen Bereichen, getrennt von den Objekten selbst. Nutzt bewusst die generischen bereichs-
// übergreifenden Aktionen (UPDATE_KUNDE_IN_BEREICH/ADD_KUNDE_IN_BEREICH, siehe AppContext.tsx) statt
// eigener SET_IMMOBILIENKUNDE_*-Actions, um den Reducer nicht unnötig aufzublähen.
export function ImmobilienKundenDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const [editFollowUp, setEditFollowUp] = useState(false)

  const kunde = state.immobilienKunden.find((k) => k.id === id)
  const tab = params.get('tab') ?? 'uebersicht'

  if (!kunde) {
    return (
      <div>
        <button onClick={() => navigate('/immobilien/kunden')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück
        </button>
        <EmptyState text="Kunde nicht gefunden." />
      </div>
    )
  }

  const overdue = isOverdue(kunde.followUp.date, kunde.followUp.done)

  return (
    <div>
      <button onClick={() => navigate('/immobilien/kunden')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zur Kundenliste
      </button>

      <Card className="mb-5 p-5">
        <StammdatenWarnungBanner kunde={kunde} />
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{kunde.firma}</h1>
            <p className="text-sm text-slate-500">{kunde.ansprechpartner} · {kunde.email} · {kunde.telefon}</p>
            <KundeHinweise bereich="immobilienkunden" kunde={kunde} />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={kunde.prioritaet}
              onChange={(e) =>
                dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'immobilienkunden', id: kunde.id, patch: { prioritaet: e.target.value as Prioritaet } })
              }
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
            >
              {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <LoeschenKundeButton bereich="immobilienkunden" kundeId={kunde.id} kundeName={kunde.firma} listePfad="/immobilien/kunden" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget
              bereich="immobilienkunden"
              status={kunde.status}
              onChange={(next) => dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'immobilienkunden', id: kunde.id, patch: { status: next } })}
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Follow-up</div>
            <button onClick={() => setEditFollowUp(true)} className="text-left">
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kunde.followUp.date)} {overdue && '· überfällig'}</div>
              <div className="text-xs text-slate-400">{kunde.followUp.note}</div>
            </button>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Verantwortlich</div>
            <div className="text-sm text-slate-700">{kunde.verantwortlich}</div>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams({ tab: t.id })}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id ? 'border-accent-600 text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'uebersicht' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
            <StammdatenKarte bereich="immobilienkunden" kunde={kunde} labels={{ firma: 'Name/Firma' }} />
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kunde.followUp.date)} — {kunde.followUp.note}</div>
            </div>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
            <AktivitaetenTimeline bereich="immobilienkunden" kunde={kunde} />
          </Card>

          <ZugewieseneObjekte bereich="immobilienkunden" kundeId={kunde.id} />
        </div>
      )}

      {tab === 'protokolle' && <GespraechsprotokolleSection bereich="immobilienkunden" kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'potenzial' && <PotenzialAnalyseSection bereich="immobilienkunden" kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'kaeuferprofil' && <KaeuferprofilSection bereich="immobilienkunden" kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'selbstauskunft' && <SelbstauskunftSection bereich="immobilienkunden" kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'nda' && <NdaSection bereich="immobilienkunden" kundeId={kunde.id} />}

      {tab === 'dokumente' && <DokumenteSection bereich="immobilienkunden" kundeId={kunde.id} />}

      {tab === 'kommunikation' && <KommunikationSection kundeId={kunde.id} />}

      <Modal open={editFollowUp} onClose={() => setEditFollowUp(false)} title="Follow-up bearbeiten">
        <FollowUpForm
          date={kunde.followUp.date}
          note={kunde.followUp.note}
          done={kunde.followUp.done}
          onSubmit={(followUp) => {
            dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'immobilienkunden', id: kunde.id, patch: { followUp } })
            setEditFollowUp(false)
          }}
        />
      </Modal>
    </div>
  )
}
