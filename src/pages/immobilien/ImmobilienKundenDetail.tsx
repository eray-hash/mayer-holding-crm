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
import { KostenvoranschlaegeSection, useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { WiedervorlagenListe } from '../../components/WiedervorlagenListe'
import { WillkommenHinweis } from '../../components/WillkommenHinweis'
import { KundenberichtModal } from '../../components/KundenberichtModal'
import { UnterschriftAnfragen } from '../../components/UnterschriftAnfragen'
import { KommunikationSection } from '../../components/KommunikationSection'
import { LoeschenKundeButton } from '../../components/LoeschenKundeButton'
import { AkteZuObjektKnopf } from '../../components/AkteZuObjektKnopf'
import { AktenReiter } from '../../components/AktenReiter'
import { ImmoStammdatenblatt } from '../../components/ImmoStammdatenblatt'
import type { Prioritaet } from '../../types'
import { immoKunden, immoKundenBereich, immoPfade } from './privatModus'

const TABS = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'stammdatenblatt', label: 'Stammdatenblatt' },
  { id: 'protokolle', label: 'Gesprächsprotokolle' },
  { id: 'potenzial', label: 'Potenzial-Analyse' },
  { id: 'kaeuferprofil', label: 'Käuferprofil' },
  { id: 'selbstauskunft', label: 'Selbstauskunft' },
  { id: 'nda', label: 'NDA' },
  { id: 'dokumente', label: 'Dokumente' },
  { id: 'kostenvoranschlaege', label: 'Kostenvoranschläge' },
  { id: 'kommunikation', label: 'Kommunikation' },
]

// Privat ohne Käuferprofil: dessen Abgleich läuft gegen den Mayer-Bestand und legt Mayer-Vorschläge mit
// öffentlichem Exposé-Link an. Gesuche (im Stammdatenblatt) gleichen privat nur mit den eigenen Objekten ab.
const TABS_PRIVAT = TABS.filter((t) => t.id !== 'kaeuferprofil')

// Immobilien-Kunden (Interessenten/Eigentümer-Kontakte) — eigene Kunden-/Mandantenliste wie bei den
// übrigen Bereichen, getrennt von den Objekten selbst. Nutzt bewusst die generischen bereichs-
// übergreifenden Aktionen (UPDATE_KUNDE_IN_BEREICH/ADD_KUNDE_IN_BEREICH, siehe AppContext.tsx) statt
// eigener SET_IMMOBILIENKUNDE_*-Actions, um den Reducer nicht unnötig aufzublähen.
// `privat`: Akte eines eigenen privaten Immobilien-Kontakts (Bereich „privat“). Gleiche Reiter, aber ohne
// Mayer-Vorschläge (zugewiesene Objekte, Käuferprofil-Abgleich); Verweise führen auf /privat/immobilien/….
export function ImmobilienKundenDetail({ privat }: { privat?: boolean } = {}) {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const nutzer = useKvNutzer()
  const [editFollowUp, setEditFollowUp] = useState(false)

  const bereich = immoKundenBereich(privat)
  const pfade = immoPfade(privat)
  const kunde = immoKunden(state, privat).find((k) => k.id === id)
  const tab = params.get('tab') ?? 'uebersicht'

  if (!kunde) {
    return (
      <div>
        <button onClick={() => navigate(pfade.kundenListe)} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück
        </button>
        <EmptyState text="Kunde nicht gefunden." />
      </div>
    )
  }

  const overdue = isOverdue(kunde.followUp.date, kunde.followUp.done)

  return (
    <div>
      <button onClick={() => navigate(pfade.kundenListe)} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zur Kundenliste
      </button>

      <Card className="mb-5 p-5">
        <StammdatenWarnungBanner kunde={kunde} />
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{kunde.firma}</h1>
            <p className="text-sm text-slate-500">{kunde.ansprechpartner} · {kunde.email} · {kunde.telefon}</p>
            <KundeHinweise bereich={bereich} kunde={kunde} />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={kunde.prioritaet}
              onChange={(e) =>
                dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kunde.id, patch: { prioritaet: e.target.value as Prioritaet } })
              }
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
            >
              {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {!privat && <AkteZuObjektKnopf kundeId={kunde.id} nurLesen={nutzer.nurLesen} />}
            <LoeschenKundeButton bereich={bereich} kundeId={kunde.id} kundeName={kunde.firma} listePfad={pfade.kundenListe} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget
              bereich="immobilienkunden"
              status={kunde.status}
              onChange={(next) => dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kunde.id, patch: { status: next } })}
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

      <AktenReiter reiter={privat ? TABS_PRIVAT : TABS} aktiv={tab} onWaehle={(id) => setParams({ tab: id })} />

      {tab === 'uebersicht' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
            <StammdatenKarte bereich={bereich} kunde={kunde} labels={{ firma: 'Name/Firma' }} />
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kunde.followUp.date)} — {kunde.followUp.note}</div>
            </div>
            {bereich !== 'privat' && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-3"><WillkommenHinweis kundeId={kunde.id} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} /></div>
                <div className="mb-3"><KundenberichtModal bereich={bereich} kunde={kunde} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} /></div>
                <div className="mb-3"><UnterschriftAnfragen bereich={bereich} kunde={kunde} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} /></div>
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Wiedervorlagen</h3>
                <WiedervorlagenListe kundeId={kunde.id} bereich={bereich} verantwortlich={kunde.verantwortlich} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} />
              </div>
            )}
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
            <AktivitaetenTimeline bereich={bereich} kunde={kunde} />
          </Card>

          {/* Zugewiesene Objekte = Mayer-Vorschläge an diesen Kontakt — im privaten Bereich gibt es keine. */}
          {!privat && <ZugewieseneObjekte bereich="immobilienkunden" kundeId={kunde.id} />}
        </div>
      )}

      {tab === 'stammdatenblatt' && <ImmoStammdatenblatt key={kunde.id} kunde={kunde} privat={privat} />}

      {tab === 'protokolle' && <GespraechsprotokolleSection bereich={bereich} kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'potenzial' && <PotenzialAnalyseSection bereich={bereich} kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'kaeuferprofil' && !privat && <KaeuferprofilSection bereich="immobilienkunden" kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'selbstauskunft' && <SelbstauskunftSection bereich={bereich} kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'nda' && <NdaSection bereich={bereich} kundeId={kunde.id} />}

      {tab === 'dokumente' && <DokumenteSection bereich={bereich} kundeId={kunde.id} />}

      {tab === 'kostenvoranschlaege' && <KostenvoranschlaegeSection kunde={kunde} bereich={bereich} />}

      {tab === 'kommunikation' && <KommunikationSection kundeId={kunde.id} />}

      <Modal open={editFollowUp} onClose={() => setEditFollowUp(false)} title="Follow-up bearbeiten">
        <FollowUpForm
          date={kunde.followUp.date}
          note={kunde.followUp.note}
          done={kunde.followUp.done}
          onSubmit={(followUp) => {
            dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kunde.id, patch: { followUp } })
            setEditFollowUp(false)
          }}
        />
      </Modal>
    </div>
  )
}
