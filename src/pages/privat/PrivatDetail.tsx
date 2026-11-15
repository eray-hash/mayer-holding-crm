import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRightLeft } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { StatusWidget } from '../../components/StatusWidget'
import { Card, Modal, EmptyState } from '../../components/ui'
import { FollowUpForm } from '../../components/FollowUpEditor'
import { fmtDate, isOverdue } from '../../lib/dates'
import { PRIORITAETEN } from '../../data/constants'
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
import { KUNDEN_BEREICHE, kundeDetailPfad } from '../../data/kundenBereiche'
import { getHauptpfad } from '../../data/statusNetworks'
import { uid, today } from '../../lib/dates'
import type { KundeBereich, Prioritaet } from '../../types'

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

export function PrivatDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'uebersicht'
  const { state, dispatch } = useApp()
  const [editFollowUp, setEditFollowUp] = useState(false)
  const [uebernehmen, setUebernehmen] = useState(false)
  const [zielBereich, setZielBereich] = useState<KundeBereich>('beratung')

  const kontakt = state.privatKunden.find((k) => k.id === id)

  if (!kontakt) {
    return (
      <div>
        <button onClick={() => navigate('/privat')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück
        </button>
        <EmptyState text="Kontakt nicht gefunden." />
      </div>
    )
  }

  const overdue = isOverdue(kontakt.followUp.date, kontakt.followUp.done)

  return (
    <div>
      <button onClick={() => navigate('/privat')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zu meinen Kontakten
      </button>

      <Card className="mb-5 p-5">
        <StammdatenWarnungBanner kunde={kontakt} />
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{kontakt.firma}</h1>
            <p className="text-sm text-slate-500">{kontakt.email} · {kontakt.telefon}</p>
            <KundeHinweise bereich="privat" kunde={kontakt} />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={kontakt.prioritaet}
              onChange={(e) => dispatch({ type: 'SET_PRIVAT_PRIORITAET', id: kontakt.id, prioritaet: e.target.value as Prioritaet })}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
            >
              {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button
              onClick={() => setUebernehmen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <ArrowRightLeft size={13} /> In öffentlichen Bereich übernehmen
            </button>
            <LoeschenKundeButton bereich="privat" kundeId={kontakt.id} kundeName={kontakt.firma} listePfad="/privat" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget
              bereich="privat"
              status={kontakt.status}
              onChange={(next) => dispatch({ type: 'SET_PRIVAT_STATUS', id: kontakt.id, status: next })}
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Follow-up</div>
            <button onClick={() => setEditFollowUp(true)} className="text-left">
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kontakt.followUp.date)} {overdue && '· überfällig'}</div>
              <div className="text-xs text-slate-400">{kontakt.followUp.note}</div>
            </button>
          </div>
        </div>
      </Card>

      <AktenReiter reiter={REITER} aktiv={tab} onWaehle={(id) => setParams({ tab: id })} />

      {tab === 'uebersicht' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
            <StammdatenKarte bereich="privat" kunde={kontakt} labels={{ firma: 'Name', ansprechpartner: 'Zusatz' }} />
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kontakt.followUp.date)} — {kontakt.followUp.note}</div>
            </div>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
            <AktivitaetenTimeline bereich="privat" kunde={kontakt} />
          </Card>
        </div>
      )}

      {tab === 'protokolle' && <GespraechsprotokolleSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />}
      {tab === 'potenzial' && <PotenzialAnalyseSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />}
      {tab === 'kaeuferprofil' && <KaeuferprofilSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />}
      {tab === 'bewertung' && <UnternehmensbewertungSection bereich="privat" kundeId={kontakt.id} />}
      {tab === 'selbstauskunft' && <SelbstauskunftSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />}
      {tab === 'nda' && <NdaSection bereich="privat" kundeId={kontakt.id} />}
      {tab === 'dokumente' && <DokumenteSection bereich="privat" kundeId={kontakt.id} />}
      {tab === 'kommunikation' && <KommunikationSection kundeId={kontakt.id} />}

      <Modal open={uebernehmen} onClose={() => setUebernehmen(false)} title="In den öffentlichen Bereich übernehmen" width="max-w-md">
        <p className="mb-3 text-sm text-slate-600">
          <strong>{kontakt.firma}</strong> wird mit allem, was in dieser Akte liegt (Notizen, Protokolle, Dokumente, Rechnungen), in den gewählten Bereich verschoben. Danach sehen ihn alle Mitarbeiter dieses Bereichs.
        </p>
        <select className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={zielBereich} onChange={(e) => setZielBereich(e.target.value as KundeBereich)}>
          {KUNDEN_BEREICHE.filter((b) => b.id !== 'privat').map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button onClick={() => setUebernehmen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Abbrechen</button>
          <button
            onClick={() => {
              dispatch({
                type: 'MOVE_KUNDE_BEREICH',
                von: 'privat',
                nach: zielBereich,
                id: kontakt.id,
                patch: {
                  status: getHauptpfad(zielBereich)[0],
                  verantwortlichEmail: undefined,
                  letzteAktivitaet: today(),
                  activities: [{ id: uid('act'), date: today(), text: 'Aus dem privaten Bereich in den öffentlichen Bereich übernommen', user: kontakt.verantwortlich }, ...kontakt.activities],
                },
              })
              navigate(kundeDetailPfad(zielBereich, kontakt.id))
            }}
            className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700"
          >
            Übernehmen
          </button>
        </div>
      </Modal>

      <Modal open={editFollowUp} onClose={() => setEditFollowUp(false)} title="Follow-up bearbeiten">
        <FollowUpForm
          date={kontakt.followUp.date}
          note={kontakt.followUp.note}
          done={kontakt.followUp.done}
          onSubmit={(followUp) => {
            dispatch({ type: 'SET_PRIVAT_FOLLOWUP', id: kontakt.id, followUp })
            setEditFollowUp(false)
          }}
        />
      </Modal>
    </div>
  )
}
