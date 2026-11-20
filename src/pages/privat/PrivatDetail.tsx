import { useState } from 'react'
import { Navigate, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRightLeft } from 'lucide-react'
import { uebernimmKontaktMails } from '../../lib/emailGateway'
import { useApp } from '../../context/AppContext'
import { StatusWidget } from '../../components/StatusWidget'
import { Card, Modal, EmptyState } from '../../components/ui'
import { FollowUpForm } from '../../components/FollowUpEditor'
import { fmtDate, isOverdue } from '../../lib/dates'
import { PRIORITAETEN } from '../../data/constants'
import { GespraechsprotokolleSection } from '../../components/GespraechsprotokolleSection'
import { PotenzialAnalyseSection } from '../../components/PotenzialAnalyseSection'
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
import { kundeDetailPfad } from '../../data/kundenBereiche'
import { useBereichsRechte } from '../../lib/bereichsRechte'
import { getHauptpfad, getStatusMap } from '../../data/statusNetworks'
import { PRIVAT_ARTEN, privatArtInfo } from '../../data/privatArten'
import { ERBEN_CHECKLISTE } from '../../data/seedErben'
import { FormularLinkButtons } from '../../components/FormularLink'
import { useAuth } from '../../context/AuthContext'
import { useMsStatus } from '../../lib/microsoftKonto'
import { uid, today } from '../../lib/dates'
import type { KundeBereich, PrivatArt, Prioritaet } from '../../types'

const REITER: Reiter[] = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'protokolle', label: 'Gesprächsprotokolle' },
  { id: 'potenzial', label: 'Potenzial-Analyse' },
  // Käuferprofil bewusst nicht: es gleicht gegen Mayer-Objekte ab und legt für alle sichtbare Vorschläge an.
  // Private Immobilien-Gesuche gibt es im Unterbereich Immobilien (Privat → Meine Kunden → Immobilien).
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
  const kontaktVorab = state.privatKunden.find((k) => k.id === id)
  // Unterbereiche (Art) nur für Freigeschaltete — wie die übrigen Zusatzfunktionen des Bereichs Privat.
  const { session, ansichtAls } = useAuth()
  const { status: ms } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())
  // Privater Unterbereich: übernommen wird standardmäßig in den Bereich der Art (der Status passt dort schon).
  const [zielGewaehlt, setZielBereich] = useState<KundeBereich>(kontaktVorab?.privatArt ?? 'beratung')
  // Übernehmen nur in einen Bereich mit Freigabe — sonst lehnt die Datenbank das Verschieben ab und
  // der Kontakt wäre danach für den Mitarbeiter selbst nicht mehr sichtbar.
  const { oeffentlicheKundenBereiche } = useBereichsRechte()
  const zielBereich: KundeBereich | undefined = oeffentlicheKundenBereiche.some((b) => b.id === zielGewaehlt) ? zielGewaehlt : oeffentlicheKundenBereiche[0]?.id

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

  // Immobilien-Kunden haben eigene private Seiten (Gesuche, Käuferprofil).
  if (kontakt.privatArt === 'immobilienkunden') return <Navigate to={`/privat/immobilien/kunden/${kontakt.id}`} replace />

  const overdue = isOverdue(kontakt.followUp.date, kontakt.followUp.done)
  const art = privatArtInfo(kontakt.privatArt)
  const ablauf = kontakt.privatArt ?? 'privat'
  const listePfad = art ? `/privat/art/${art.id}` : '/privat'
  const checkliste = kontakt.unterlagenCheckliste ?? {}
  const checkPunkte = ERBEN_CHECKLISTE.flatMap((g) => g.punkte)
  const reiter: Reiter[] = kontakt.privatArt === 'erben' ? [REITER[0], { id: 'unterlagen', label: 'Unterlagen-Checkliste', zusatz: `(${checkPunkte.filter((p) => checkliste[p]).length}/${checkPunkte.length})` }, ...REITER.slice(1)] : REITER

  function wechsleArt(neu: PrivatArt | '') {
    if (!kontakt) return
    const ziel = neu || undefined
    if (ziel === kontakt.privatArt) return
    // Neuer Ablauf → Status auf den Anfang des neuen Ablaufs, wenn der bisherige dort nicht vorkommt.
    const map = getStatusMap(ziel ?? 'privat')
    const status = map[kontakt.status] ? kontakt.status : (getHauptpfad(ziel ?? 'privat')[0] ?? kontakt.status)
    const text = `Art geändert: ${privatArtInfo(kontakt.privatArt)?.label ?? 'Allgemein'} → ${privatArtInfo(ziel)?.label ?? 'Allgemein'}`
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'privat', id: kontakt.id, patch: { privatArt: ziel, status, letzteAktivitaet: today(), activities: [{ id: uid('act'), date: today(), text, user: kontakt.verantwortlich }, ...kontakt.activities] } })
    if (ziel === 'immobilienkunden') navigate(`/privat/immobilien/kunden/${kontakt.id}`)
    else navigate(ziel ? `/privat/art/${ziel}/${kontakt.id}` : `/privat/kontakte/${kontakt.id}`)
  }

  return (
    <div>
      <button onClick={() => navigate(listePfad)} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zu {art ? `${art.label} (privat)` : 'meinen Kontakten'}
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
            <LoeschenKundeButton bereich="privat" kundeId={kontakt.id} kundeName={kontakt.firma} listePfad={listePfad} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget
              bereich={ablauf}
              status={kontakt.status}
              onChange={(next) => dispatch({ type: 'SET_PRIVAT_STATUS', id: kontakt.id, status: next })}
            />
          </div>
          {(ms?.erlaubt || kontakt.privatArt) && <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Art</div>
            <select value={kontakt.privatArt ?? ''} onChange={(e) => wechsleArt(e.target.value as PrivatArt | '')} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium" title="Nach welchem Bereich dieser private Kontakt geführt wird">
              <option value="">Allgemein</option>
              {PRIVAT_ARTEN.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>}
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Follow-up</div>
            <button onClick={() => setEditFollowUp(true)} className="text-left">
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kontakt.followUp.date)} {overdue && '· überfällig'}</div>
              <div className="text-xs text-slate-400">{kontakt.followUp.note}</div>
            </button>
          </div>
        </div>
      </Card>

      <AktenReiter reiter={reiter} aktiv={tab} onWaehle={(id) => setParams({ tab: id })} />

      {tab === 'uebersicht' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
            <StammdatenKarte bereich="privat" kunde={kontakt} labels={{ firma: 'Name', ansprechpartner: 'Zusatz' }} />
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kontakt.followUp.date)} — {kontakt.followUp.note}</div>
            </div>
            {kontakt.privatArt === 'erben' && (
              <>
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-1.5 text-xs font-medium text-slate-400">Allgemeine Vollmacht digital versenden</div>
                  <FormularLinkButtons pfad={`/formular/vollmacht/privat/${kontakt.id}`} />
                </div>
                <div className="mt-3">
                  <div className="mb-1.5 text-xs font-medium text-slate-400">Mandantenfragebogen digital versenden</div>
                  <FormularLinkButtons pfad={`/formular/mandantenfragebogen/privat/${kontakt.id}`} />
                </div>
              </>
            )}
            {kontakt.privatArt === 'beratung' && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-1.5 text-xs font-medium text-slate-400">Vollmacht Bank digital versenden</div>
                <FormularLinkButtons pfad={`/formular/vollmacht/privat/bank/${kontakt.id}`} />
              </div>
            )}
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
            <AktivitaetenTimeline bereich="privat" kunde={kontakt} />
          </Card>
        </div>
      )}

      {tab === 'unterlagen' && kontakt.privatArt === 'erben' && (
        <Card className="p-5">
          <p className="mb-4 text-sm text-slate-500">Checkliste aus dem Mandantenfragebogen „Vermögens-, Familien- und Nachfolgeplanung“ — welche Angaben/Unterlagen schon vorliegen.</p>
          <div className="space-y-5">
            {ERBEN_CHECKLISTE.map((gruppe) => (
              <div key={gruppe.kategorie}>
                <h4 className="mb-2 text-sm font-semibold text-slate-700">{gruppe.kategorie}</h4>
                <div className="space-y-1.5">
                  {gruppe.punkte.map((punkt) => (
                    <label key={punkt} className="flex items-start gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={!!checkliste[punkt]}
                        onChange={() => dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'privat', id: kontakt.id, patch: { unterlagenCheckliste: { ...checkliste, [punkt]: !checkliste[punkt] } } })}
                        className="mt-0.5 rounded"
                      />
                      <span className={checkliste[punkt] ? 'text-slate-400 line-through' : ''}>{punkt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {tab === 'protokolle' && <GespraechsprotokolleSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />}
      {tab === 'potenzial' && <PotenzialAnalyseSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />}
      {tab === 'bewertung' && <UnternehmensbewertungSection bereich="privat" kundeId={kontakt.id} />}
      {tab === 'selbstauskunft' && <SelbstauskunftSection bereich="privat" kundeId={kontakt.id} kundeName={kontakt.ansprechpartner || kontakt.firma} />}
      {tab === 'nda' && <NdaSection bereich="privat" kundeId={kontakt.id} />}
      {tab === 'dokumente' && <DokumenteSection bereich="privat" kundeId={kontakt.id} />}
      {tab === 'kommunikation' && <KommunikationSection kundeId={kontakt.id} />}

      <Modal open={uebernehmen} onClose={() => setUebernehmen(false)} title="In den öffentlichen Bereich übernehmen" width="max-w-md">
        <p className="mb-3 text-sm text-slate-600">
          <strong>{kontakt.firma}</strong> wird mit allem, was in dieser Akte liegt (Notizen, Protokolle, Dokumente, abgelegte Mails), in den gewählten Bereich verschoben. Danach sehen ihn alle Mitarbeiter dieses Bereichs.
        </p>
        {zielBereich ? (
          <select className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={zielBereich} onChange={(e) => setZielBereich(e.target.value as KundeBereich)}>
            {oeffentlicheKundenBereiche.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        ) : (
          <p className="mb-4 text-sm text-amber-700">Du bist für keinen Bereich freigegeben. Bitte die Geschäftsführung fragen.</p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={() => setUebernehmen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Abbrechen</button>
          <button
            disabled={!zielBereich}
            onClick={() => {
              if (!zielBereich) return
              dispatch({
                type: 'MOVE_KUNDE_BEREICH',
                von: 'privat',
                nach: zielBereich,
                id: kontakt.id,
                patch: {
                  // Gleicher Ablauf (Art = Zielbereich): Status bleibt; sonst Anfang des Zielablaufs.
                  status: kontakt.privatArt === zielBereich && getStatusMap(zielBereich)[kontakt.status] ? kontakt.status : getHauptpfad(zielBereich)[0],
                  verantwortlichEmail: undefined,
                  privatArt: undefined,
                  letzteAktivitaet: today(),
                  activities: [{ id: uid('act'), date: today(), text: 'Aus dem privaten Bereich in den öffentlichen Bereich übernommen', user: kontakt.verantwortlich }, ...kontakt.activities],
                },
              })
              // Abgelegte private Mails (eigenes Postfach, Hotmail) wandern mit — sonst blieben sie privat hängen.
              uebernimmKontaktMails(kontakt.id, zielBereich, kontakt.firma || kontakt.ansprechpartner)
                .then((r) => {
                  if (!r.ok) window.alert(`Der Kontakt ist übernommen, aber nicht alle Mails: ${r.fehler.join('; ')}`)
                })
                .catch((e) => window.alert(`Der Kontakt ist übernommen, die Mails noch nicht: ${e instanceof Error ? e.message : e}`))
              navigate(kundeDetailPfad(zielBereich, kontakt.id))
            }}
            className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
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
