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
import { UnternehmensbewertungSection } from '../../components/UnternehmensbewertungSection'
import { StammdatenWarnungBanner } from '../../components/StammdatenWarnungBanner'
import { StammdatenKarte } from '../../components/StammdatenKarte'
import { AktivitaetenTimeline } from '../../components/AktivitaetenTimeline'
import { KundeHinweise } from '../../components/PruefHinweisBadge'
import { SelbstauskunftSection } from '../../components/SelbstauskunftSection'
import { NdaSection } from '../../components/NdaSection'
import { DokumenteSection } from '../../components/DokumenteSection'
import { KommunikationSection } from '../../components/KommunikationSection'
import { LoeschenKundeButton } from '../../components/LoeschenKundeButton'
import { AktenReiter, type Reiter } from '../../components/AktenReiter'
import type { Prioritaet } from '../../types'

const REITER: Reiter[] = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'protokolle', label: 'Gesprächsprotokolle' },
  { id: 'potenzial', label: 'Potenzial-Analyse' },
  { id: 'kaeuferprofil', label: 'Käuferprofil' },
  { id: 'bewertung', label: 'Unternehmensbewertung' },
  { id: 'selbstauskunft', label: 'Selbstauskunft' },
  { id: 'nda', label: 'NDA' },
  { id: 'dokumente', label: 'Dokumente' },
  { id: 'kommunikation', label: 'Kommunikation' },
]

export function FinanzierungenDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'uebersicht'
  const { state, dispatch } = useApp()
  const [editFollowUp, setEditFollowUp] = useState(false)

  const mandant = state.finanzierungenMandanten.find((k) => k.id === id)

  if (!mandant) {
    return (
      <div>
        <button onClick={() => navigate('/finanzierungen')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück
        </button>
        <EmptyState text="Mandant nicht gefunden." />
      </div>
    )
  }

  const overdue = isOverdue(mandant.followUp.date, mandant.followUp.done)

  return (
    <div>
      <button onClick={() => navigate('/finanzierungen')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zur Mandantenliste
      </button>

      <Card className="mb-5 p-5">
        <StammdatenWarnungBanner kunde={mandant} />
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{mandant.firma}</h1>
            <p className="text-sm text-slate-500">{mandant.email} · {mandant.telefon}</p>
            <KundeHinweise bereich="finanzierungen" kunde={mandant} />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={mandant.prioritaet}
              onChange={(e) => dispatch({ type: 'SET_FINANZIERUNGEN_PRIORITAET', id: mandant.id, prioritaet: e.target.value as Prioritaet })}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
            >
              {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <LoeschenKundeButton bereich="finanzierungen" kundeId={mandant.id} kundeName={mandant.firma} listePfad="/finanzierungen" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget
              bereich="finanzierungen"
              status={mandant.status}
              onChange={(next) => dispatch({ type: 'SET_FINANZIERUNGEN_STATUS', id: mandant.id, status: next })}
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Follow-up</div>
            <button onClick={() => setEditFollowUp(true)} className="text-left">
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(mandant.followUp.date)} {overdue && '· überfällig'}</div>
              <div className="text-xs text-slate-400">{mandant.followUp.note}</div>
            </button>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Verantwortlich</div>
            <div className="text-sm text-slate-700">{mandant.verantwortlich}</div>
          </div>
        </div>
      </Card>

      <AktenReiter reiter={REITER} aktiv={tab} onWaehle={(id) => setParams({ tab: id })} />

      {tab === 'uebersicht' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
            <StammdatenKarte bereich="finanzierungen" kunde={mandant} labels={{ firma: 'Name' }} />
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(mandant.followUp.date)} — {mandant.followUp.note}</div>
            </div>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
            <AktivitaetenTimeline bereich="finanzierungen" kunde={mandant} />
          </Card>

          <ZugewieseneObjekte bereich="finanzierungen" kundeId={mandant.id} />
        </div>
      )}

      {tab === 'protokolle' && <GespraechsprotokolleSection bereich="finanzierungen" kundeId={mandant.id} kundeName={mandant.ansprechpartner || mandant.firma} />}
      {tab === 'potenzial' && <PotenzialAnalyseSection bereich="finanzierungen" kundeId={mandant.id} kundeName={mandant.ansprechpartner || mandant.firma} />}
      {tab === 'kaeuferprofil' && <KaeuferprofilSection bereich="finanzierungen" kundeId={mandant.id} kundeName={mandant.ansprechpartner || mandant.firma} />}
      {tab === 'bewertung' && <UnternehmensbewertungSection bereich="finanzierungen" kundeId={mandant.id} />}
      {tab === 'selbstauskunft' && <SelbstauskunftSection bereich="finanzierungen" kundeId={mandant.id} kundeName={mandant.ansprechpartner || mandant.firma} />}
      {tab === 'nda' && <NdaSection bereich="finanzierungen" kundeId={mandant.id} />}
      {tab === 'dokumente' && <DokumenteSection bereich="finanzierungen" kundeId={mandant.id} />}
      {tab === 'kommunikation' && <KommunikationSection kundeId={mandant.id} />}

      <Modal open={editFollowUp} onClose={() => setEditFollowUp(false)} title="Follow-up bearbeiten">
        <FollowUpForm
          date={mandant.followUp.date}
          note={mandant.followUp.note}
          done={mandant.followUp.done}
          onSubmit={(followUp) => {
            dispatch({ type: 'SET_FINANZIERUNGEN_FOLLOWUP', id: mandant.id, followUp })
            setEditFollowUp(false)
          }}
        />
      </Modal>
    </div>
  )
}
