import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { StatusWidget } from '../../components/StatusWidget'
import { StatusBadge, Card, Modal, inputClass, SecondaryButton, EmptyState } from '../../components/ui'
import { fmtDate, isOverdue, today, uid, fmtEUR, fmtEURCent } from '../../lib/dates'
import { PRIORITAETEN, CURRENT_USER } from '../../data/constants'
import { ZugewieseneObjekte } from '../../components/ZugewieseneObjekte'
import { FormularLinkButtons } from '../../components/FormularLink'
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
import { KostenvoranschlaegeSection, useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { WiedervorlagenListe } from '../../components/WiedervorlagenListe'
import { WillkommenHinweis } from '../../components/WillkommenHinweis'
import { RechnungVorschlagHinweis } from '../../components/rechnungen/RechnungVorschlaege'
import { KundenberichtModal } from '../../components/KundenberichtModal'
import { GespraechAufnahmenListe } from '../../components/GespraechAufnahmenListe'
import { StammdatenVorschlaege } from '../../components/StammdatenVorschlaege'
import { UnterschriftAnfragen } from '../../components/UnterschriftAnfragen'
import { KundenPortalKarte } from '../../components/KundenPortalKarte'
import { KommunikationSection } from '../../components/KommunikationSection'
import { LoeschenKundeButton } from '../../components/LoeschenKundeButton'
import { SendEmailModal } from '../../components/SendEmailModal'
import { FollowUpForm } from '../../components/FollowUpEditor'
import { AktenReiter } from '../../components/AktenReiter'
import type { Prioritaet } from '../../types'
import { angezeigterStatus } from '../../lib/rechnungen'
import { holeBehoerdenPruefzeichen } from '../../lib/emailGateway'

/** Link zur Finanzamt-Vollmacht. Mit eingetragener Behörden-Adresse holt das Fenster beim Server ein
 *  Prüfzeichen (seit 19.11.2026) — nur damit verschickt der Server die unterschriebene Vollmacht an
 *  genau diese Adresse. */
function VollmachtFinanzamtLink({ kundeId }: { kundeId: string }) {
  const [finanzamtEmail, setFinanzamtEmail] = useState('')
  const [pruef, setPruef] = useState<{ email: string; sig: string } | null>(null)
  const [fehler, setFehler] = useState('')
  const adresse = finanzamtEmail.trim()
  const gueltig = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(adresse)

  useEffect(() => {
    setFehler('')
    if (!gueltig) return
    let aktiv = true
    const uhr = window.setTimeout(() => {
      holeBehoerdenPruefzeichen(kundeId, adresse)
        .then((sig) => aktiv && setPruef({ email: adresse, sig }))
        .catch((err) => aktiv && setFehler(err instanceof Error ? err.message : 'Der Link konnte nicht vorbereitet werden.'))
    }, 500)
    return () => {
      aktiv = false
      window.clearTimeout(uhr)
    }
  }, [kundeId, adresse, gueltig])

  const basis = `/formular/vollmacht/beratung/finanzamt/${kundeId}`
  const fertig = gueltig && pruef?.email === adresse && !!pruef.sig
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="mb-1.5 text-xs font-medium text-slate-400">Vollmacht Finanzamt digital versenden</div>
      <input
        className={`${inputClass} mb-1.5 text-xs`}
        placeholder="E-Mail Finanzamt (für automatischen Versand nach Unterschrift, optional)"
        value={finanzamtEmail}
        onChange={(e) => setFinanzamtEmail(e.target.value)}
      />
      {!adresse ? (
        <FormularLinkButtons pfad={basis} />
      ) : fertig ? (
        <FormularLinkButtons pfad={`${basis}?behoerde=${encodeURIComponent(adresse)}&sig=${encodeURIComponent(pruef!.sig)}`} />
      ) : (
        <p className="text-xs text-slate-400">{gueltig ? 'Link wird vorbereitet …' : 'Bitte eine vollständige E-Mail-Adresse eintragen.'}</p>
      )}
      {fehler && <p className="mt-1 text-xs text-rose-600">{fehler}</p>}
      {fertig && (
        <p className="mt-1 text-xs text-slate-400">
          Sobald unterschrieben, wird die Vollmacht automatisch an {adresse} geschickt und eine Wiedervorlage angelegt.
        </p>
      )}
    </div>
  )
}

const TABS = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'rechnungen', label: 'Rechnungen' },
  { id: 'protokolle', label: 'Gesprächsprotokolle' },
  { id: 'potenzial', label: 'Potenzial-Analyse' },
  { id: 'kaeuferprofil', label: 'Käuferprofil' },
  { id: 'bewertung', label: 'Unternehmensbewertung' },
  { id: 'selbstauskunft', label: 'Selbstauskunft' },
  { id: 'nda', label: 'NDA' },
  { id: 'dokumente', label: 'Dokumente' },
  { id: 'kostenvoranschlaege', label: 'Kostenvoranschläge' },
  { id: 'kommunikation', label: 'Kommunikation' },
  { id: 'konzepte', label: 'Konzeptvorstellungen' },
  { id: 'vertraege', label: 'Unterschriebene Beratungsverträge' },
]

export function KundenDetail() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const nutzer = useKvNutzer()
  const [sendEmailOpen, setSendEmailOpen] = useState(false)
  const [editFollowUp, setEditFollowUp] = useState(false)

  const kunde = state.kunden.find((k) => k.id === id)
  const tab = params.get('tab') ?? 'uebersicht'

  if (!kunde) {
    return (
      <div>
        <button onClick={() => navigate('/beratung')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück
        </button>
        <EmptyState text="Kunde nicht gefunden." />
      </div>
    )
  }

  const overdue = isOverdue(kunde.followUp.date, kunde.followUp.done)
  const rechnungen = state.rechnungen.filter((r) => r.kundeId === kunde.id)
  const konzepte = state.konzepte.filter((c) => c.kundeId === kunde.id)
  const vertraege = state.vertraege.filter((v) => v.kundeId === kunde.id)

  return (
    <div>
      <button onClick={() => navigate('/beratung')} className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zur Kundenliste
      </button>

      <Card className="mb-5 p-5">
        <StammdatenWarnungBanner kunde={kunde} />
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">{kunde.firma}</h1>
            <p className="text-sm text-slate-500">{kunde.ansprechpartner} · {kunde.email} · {kunde.telefon}</p>
            <KundeHinweise bereich="beratung" kunde={kunde} />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={kunde.prioritaet}
              onChange={(e) => dispatch({ type: 'SET_KUNDE_PRIORITAET', id: kunde.id, prioritaet: e.target.value as Prioritaet })}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium"
            >
              {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <LoeschenKundeButton bereich="beratung" kundeId={kunde.id} kundeName={kunde.firma} listePfad="/beratung" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">Status</div>
            <StatusWidget bereich="beratung" status={kunde.status} onChange={(next) => dispatch({ type: 'SET_KUNDE_STATUS', id: kunde.id, status: next })} akte={{ kunde, bereich: 'beratung' }} />
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

      <AktenReiter reiter={TABS} aktiv={tab} onWaehle={(id) => setParams({ tab: id })} />

      {tab === 'uebersicht' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Stammdaten</h3>
            <StammdatenKarte bereich="beratung" kunde={kunde} />
            <StammdatenVorschlaege bereich="beratung" kunde={kunde} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} />
            <div className="mt-4">
              <SecondaryButton onClick={() => setSendEmailOpen(true)} className="w-full justify-center">
                <Mail size={14} /> E-Mail senden
              </SecondaryButton>
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-400">Nächste Follow-up-Aufgabe</div>
              <div className={`text-sm ${overdue ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{fmtDate(kunde.followUp.date)} — {kunde.followUp.note}</div>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="mb-3 empty:hidden"><RechnungVorschlagHinweis kundeId={kunde.id} /></div>
              <div className="mb-3"><WillkommenHinweis kundeId={kunde.id} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} /></div>
              <div className="mb-3"><KundenberichtModal bereich="beratung" kunde={kunde} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} /></div>
              <div className="mb-3"><GespraechAufnahmenListe kundeId={kunde.id} /></div>
              <div className="mb-3"><UnterschriftAnfragen bereich="beratung" kunde={kunde} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} /></div>
              <div className="mb-3"><KundenPortalKarte bereich="beratung" kunde={kunde} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} /></div>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Wiedervorlagen</h3>
              <WiedervorlagenListe kundeId={kunde.id} bereich="beratung" verantwortlich={kunde.verantwortlich} nutzerName={nutzer.name} nurLesen={nutzer.nurLesen} />
            </div>
            <VollmachtFinanzamtLink kundeId={kunde.id} />
            <div className="mt-3">
              <div className="mb-1.5 text-xs font-medium text-slate-400">Vollmacht Bank digital versenden</div>
              <FormularLinkButtons pfad={`/formular/vollmacht/beratung/bank/${kunde.id}`} />
            </div>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Aktivitäten-Timeline</h3>
            <AktivitaetenTimeline bereich="beratung" kunde={kunde} />
          </Card>

          {kunde.signaturen && kunde.signaturen.length > 0 && (
            <Card className="p-5 lg:col-span-3">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Erfasste Unterschriften</h3>
              <div className="flex flex-wrap gap-4">
                {kunde.signaturen.map((s) => (
                  <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                    <img src={s.dataUrl} alt={`Unterschrift ${s.name}`} className="h-20 rounded bg-white" />
                    <div className="mt-1.5 text-xs text-slate-500">{s.kontext}</div>
                    <div className="text-xs text-slate-400">{s.name} · {fmtDate(s.datum)}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <ZugewieseneObjekte bereich="beratung" kundeId={kunde.id} />
        </div>
      )}

      {tab === 'rechnungen' && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Nr.</th><th className="px-4 py-3">Datum</th><th className="px-4 py-3">Betrag</th><th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rechnungen.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/beratung/rechnungen?rechnung=${encodeURIComponent(r.id)}`)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-700">{r.nummer}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(r.datum)}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtEURCent(r.betragBrutto)}</td>
                  <td className="px-4 py-3"><RechnungStatusBadge status={angezeigterStatus(r)} /></td>
                </tr>
              ))}
              {rechnungen.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Keine Rechnungen.</td></tr>}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-4 py-2.5">
            <button type="button" onClick={() => navigate(`/beratung/rechnungen?neu=${encodeURIComponent(kunde.id)}`)} className="text-sm font-medium text-accent-600 hover:text-accent-700">
              + Neue Rechnung für diesen Kunden
            </button>
          </div>
        </Card>
      )}

      {tab === 'protokolle' && <GespraechsprotokolleSection bereich="beratung" kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'potenzial' && <PotenzialAnalyseSection bereich="beratung" kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'kaeuferprofil' && <KaeuferprofilSection bereich="beratung" kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}
      {tab === 'bewertung' && <UnternehmensbewertungSection bereich="beratung" kundeId={kunde.id} />}

      {tab === 'selbstauskunft' && <SelbstauskunftSection bereich="beratung" kundeId={kunde.id} kundeName={kunde.ansprechpartner} />}

      {tab === 'nda' && <NdaSection bereich="beratung" kundeId={kunde.id} />}

      {tab === 'dokumente' && <DokumenteSection bereich="beratung" kundeId={kunde.id} />}

      {tab === 'kostenvoranschlaege' && <KostenvoranschlaegeSection kunde={kunde} bereich="beratung" />}

      {tab === 'kommunikation' && <KommunikationSection kundeId={kunde.id} />}

      {tab === 'konzepte' && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Datum</th><th className="px-4 py-3">Titel</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {konzepte.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 text-slate-500">{fmtDate(c.datum)}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{c.titel}</td>
                  <td className="px-4 py-3 text-slate-500">{c.version}</td>
                  <td className="px-4 py-3 text-slate-500">{c.status}</td>
                </tr>
              ))}
              {konzepte.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Keine Konzepte.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'vertraege' && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Vertragsnr.</th><th className="px-4 py-3">Datum</th><th className="px-4 py-3">Laufzeit</th><th className="px-4 py-3">Volumen</th><th className="px-4 py-3">Datei</th>
              </tr>
            </thead>
            <tbody>
              {vertraege.map((v) => (
                <tr key={v.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-700">{v.vertragsnr}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(v.datum)}</td>
                  <td className="px-4 py-3 text-slate-500">{v.laufzeit}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtEUR(v.volumen)}</td>
                  <td className="px-4 py-3 text-slate-500">{v.datei}</td>
                </tr>
              ))}
              {vertraege.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Keine unterschriebenen Verträge.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      <SendEmailModal
        open={sendEmailOpen}
        onClose={() => setSendEmailOpen(false)}
        to={kunde.email}
        kunde={{ bereich: 'beratung', id: kunde.id, name: kunde.ansprechpartner, firma: kunde.firma, ansprechpartner: kunde.ansprechpartner }}
        onSent={({ subject }) => {
          dispatch({
            type: 'UPDATE_KUNDE',
            id: kunde.id,
            patch: {
              letzteAktivitaet: today(),
              activities: [
                { id: uid('act'), date: today(), text: `E-Mail versendet: „${subject}"`, user: CURRENT_USER },
                ...kunde.activities,
              ],
            },
          })
        }}
      />

      <Modal open={editFollowUp} onClose={() => setEditFollowUp(false)} title="Follow-up bearbeiten">
        <FollowUpForm
          date={kunde.followUp.date}
          note={kunde.followUp.note}
          done={kunde.followUp.done}
          onSubmit={(followUp) => {
            dispatch({ type: 'SET_KUNDE_FOLLOWUP', id: kunde.id, followUp })
            setEditFollowUp(false)
          }}
        />
      </Modal>
    </div>
  )
}


export function RechnungStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Entwurf: 'bg-slate-100 text-slate-600',
    Versendet: 'bg-sky-100 text-sky-700',
    Bezahlt: 'bg-emerald-100 text-emerald-700',
    Überfällig: 'bg-rose-100 text-rose-700',
  }
  return <StatusBadge label={status} color={colors[status] ?? 'bg-slate-100 text-slate-600'} />
}

