import { useEffect, useState } from 'react'
import { Inbox, Send, RefreshCw, UserPlus, Check, X, AlertTriangle, Plus, Reply, ListPlus } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { isEmailInboxDbConfigured, fetchStoredEmails } from '../../lib/emailInboxDb'
import { isSentEmailsDbConfigured, fetchSentEmails } from '../../lib/sentEmailsDb'
import { matchKundeByEmail, suggestKunde } from '../../lib/matchKunde'
import { KUNDEN_BEREICHE, kundeBereichLabel } from '../../data/kundenBereiche'
import { uid, today, addDays, fmtDateTime } from '../../lib/dates'
import { MITARBEITER } from '../../data/constants'
import { SendEmailModal } from '../../components/SendEmailModal'
import { MailVorlagenModal } from '../../components/MailVorlagenModal'
import { PrimaryButton, SecondaryButton, EmptyState, inputClass } from '../../components/ui'
import type { EingegangeneEmail, GesendeteEmail, KundeBereich } from '../../types'

type Ordner = 'posteingang' | 'gesendet'

export function Postfach() {
  const { state, dispatch } = useApp()
  const [ordner, setOrdner] = useState<Ordner>('posteingang')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(30)

  const [gesendet, setGesendet] = useState<GesendeteEmail[]>([])
  const [gesendetLimit, setGesendetLimit] = useState(30)
  const [gesendetLoading, setGesendetLoading] = useState(false)

  const [composeOpen, setComposeOpen] = useState(false)
  const [vorlagenOpen, setVorlagenOpen] = useState(false)
  const [antwortAn, setAntwortAn] = useState<{ to: string; subject: string } | null>(null)

  const [bereichWahl, setBereichWahl] = useState<Record<string, KundeBereich>>({})
  const [kundeWahl, setKundeWahl] = useState<Record<string, string>>({})

  const mails = [...state.eingegangeneEmails]
    .filter((e) => !e.ignoriert)
    .sort((a, b) => (b.datum < a.datum ? -1 : b.datum > a.datum ? 1 : 0))

  async function ladePosteingang(l = limit) {
    setLoading(true)
    setError('')
    try {
      const fetched = await fetchStoredEmails(l)
      const emails: EingegangeneEmail[] = fetched.map((m) => {
        const vorschlagMatch = matchKundeByEmail(state, m.von) ?? suggestKunde(state, `${m.betreff} ${m.ausschnitt} ${m.vonName}`)
        return {
          id: uid('mail'),
          ...m,
          vorschlag: vorschlagMatch ? { bereich: vorschlagMatch.bereich, kundeId: vorschlagMatch.kundeId, kundeName: vorschlagMatch.kundeName } : undefined,
        }
      })
      dispatch({ type: 'ADD_EINGEGANGENE_EMAILS', emails })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Postfach konnte nicht abgerufen werden.')
    } finally {
      setLoading(false)
    }
  }

  async function ladeGesendet(l = gesendetLimit) {
    setGesendetLoading(true)
    setError('')
    try {
      setGesendet(await fetchSentEmails(l))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gesendet-Ordner konnte nicht geladen werden.')
    } finally {
      setGesendetLoading(false)
    }
  }

  useEffect(() => {
    if (isEmailInboxDbConfigured) ladePosteingang(limit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (ordner === 'gesendet' && isSentEmailsDbConfigured) ladeGesendet(gesendetLimit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordner])

  function mehrLadenPosteingang() {
    const next = limit + 30
    setLimit(next)
    ladePosteingang(next)
  }

  function mehrLadenGesendet() {
    const next = gesendetLimit + 30
    setGesendetLimit(next)
    ladeGesendet(next)
  }

  function zuweisen(mailId: string, bereich: KundeBereich, kundeId: string) {
    const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
    if (!kunde) return
    dispatch({ type: 'ASSIGN_EINGEGANGENE_EMAIL', id: mailId, bereich, kundeId, kundeName: `${kunde.firma} (${kunde.ansprechpartner})` })
  }

  function alsNeuenKundenAnlegen(mail: EingegangeneEmail) {
    dispatch({
      type: 'ADD_KUNDE',
      kunde: {
        id: uid('k'),
        firma: mail.vonName,
        ansprechpartner: mail.vonName,
        email: mail.von,
        telefon: '',
        prioritaet: 'Mittel',
        status: 'lead',
        followUp: { date: addDays(today(), 2), note: 'Rückmeldung auf eingegangene E-Mail geben', done: false },
        verantwortlich: MITARBEITER[0],
        letzteAktivitaet: today(),
        activities: [{ id: uid('act'), date: today(), text: `Als Lead aus E-Mail-Posteingang angelegt: „${mail.betreff}"`, user: 'E-Mail-Posteingang' }],
      },
    })
    dispatch({ type: 'IGNORE_EINGEGANGENE_EMAIL', id: mail.id })
    setSelectedId(null)
  }

  const selectedMail = ordner === 'posteingang' ? mails.find((m) => m.id === selectedId) : undefined
  const selectedGesendet = ordner === 'gesendet' ? gesendet.find((m) => m.id === selectedId) : undefined

  const dbConfigured = ordner === 'posteingang' ? isEmailInboxDbConfigured : isSentEmailsDbConfigured

  return (
    <div className="flex h-[calc(100vh-7.5rem)] gap-4">
      {/* Ordner-Navigation */}
      <div className="w-48 flex-shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-800">Postfach</h1>
        </div>
        <PrimaryButton onClick={() => { setAntwortAn(null); setComposeOpen(true) }} className="mb-4 w-full justify-center">
          <Plus size={14} /> Neue E-Mail
        </PrimaryButton>
        <nav className="space-y-1">
          <button
            onClick={() => { setOrdner('posteingang'); setSelectedId(null) }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              ordner === 'posteingang' ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Inbox size={15} /> Posteingang
            <span className="ml-auto text-xs text-slate-400">{mails.length}</span>
          </button>
          <button
            onClick={() => { setOrdner('gesendet'); setSelectedId(null) }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              ordner === 'gesendet' ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Send size={15} /> Gesendet
            <span className="ml-auto text-xs text-slate-400">{gesendet.length}</span>
          </button>
        </nav>
        <button
          onClick={() => setVorlagenOpen(true)}
          className="mt-4 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
        >
          <ListPlus size={14} /> Mailvorlagen verwalten
        </button>
      </div>

      {!dbConfigured ? (
        <div className="flex-1">
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            {ordner === 'posteingang'
              ? 'Posteingang noch nicht verbunden — E-Mails an info@amayer-holding.com werden per Weiterleitung an einen Webhook-Dienst geschickt, der sie in eine Datenbank-Tabelle schreibt.'
              : 'Gesendet-Ordner noch nicht verbunden — sobald die E-Mail-Datenbank konfiguriert ist, erscheinen hier über das CRM versendete Mails.'}
          </div>
        </div>
      ) : (
        <>
          {/* Mail-Liste */}
          <div className="flex w-80 flex-shrink-0 flex-col rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-xs font-medium text-slate-500">{ordner === 'posteingang' ? 'Posteingang' : 'Gesendet'}</span>
              <button
                onClick={() => (ordner === 'posteingang' ? ladePosteingang(limit) : ladeGesendet(gesendetLimit))}
                disabled={loading || gesendetLoading}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                title="Aktualisieren"
              >
                <RefreshCw size={13} className={loading || gesendetLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {error && (
              <div className="m-2 flex items-start gap-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> {error}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {ordner === 'posteingang' &&
                (mails.length === 0 ? (
                  <EmptyState text="Keine E-Mails geladen." />
                ) : (
                  mails.map((mail) => (
                    <button
                      key={mail.id}
                      onClick={() => setSelectedId(mail.id)}
                      className={`block w-full border-b border-slate-50 px-3 py-2.5 text-left ${selectedId === mail.id ? 'bg-accent-50' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{mail.vonName}</span>
                        <span className="flex-shrink-0 text-[11px] text-slate-400">{fmtDateTime(mail.datum).split(',')[0]}</span>
                      </div>
                      <div className="truncate text-xs text-slate-600">{mail.betreff}</div>
                      {mail.zugewiesen && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                          <Check size={11} /> {mail.zugewiesen.kundeName}
                        </div>
                      )}
                    </button>
                  ))
                ))}

              {ordner === 'gesendet' &&
                (gesendet.length === 0 ? (
                  <EmptyState text="Noch keine gesendeten E-Mails." />
                ) : (
                  gesendet.map((mail) => (
                    <button
                      key={mail.id}
                      onClick={() => setSelectedId(mail.id)}
                      className={`block w-full border-b border-slate-50 px-3 py-2.5 text-left ${selectedId === mail.id ? 'bg-accent-50' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{mail.anName}</span>
                        <span className="flex-shrink-0 text-[11px] text-slate-400">{fmtDateTime(mail.gesendetAm).split(',')[0]}</span>
                      </div>
                      <div className="truncate text-xs text-slate-600">{mail.betreff}</div>
                      {mail.kundeName && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-400">
                          <Check size={11} /> {mail.kundeName}
                        </div>
                      )}
                    </button>
                  ))
                ))}
            </div>

            <div className="border-t border-slate-100 p-2">
              <SecondaryButton
                onClick={() => (ordner === 'posteingang' ? mehrLadenPosteingang() : mehrLadenGesendet())}
                disabled={loading || gesendetLoading}
                className="w-full justify-center text-xs"
              >
                Mehr laden
              </SecondaryButton>
            </div>
          </div>

          {/* Lesefenster */}
          <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5">
            {selectedMail && (
              <div>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-800">{selectedMail.betreff}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Von: {selectedMail.vonName} ({selectedMail.von}) · {fmtDateTime(selectedMail.datum)}
                    </p>
                  </div>
                  <SecondaryButton onClick={() => { setAntwortAn({ to: selectedMail.von, subject: `Re: ${selectedMail.betreff}` }); setComposeOpen(true) }} className="flex-shrink-0 text-xs">
                    <Reply size={13} /> Antworten
                  </SecondaryButton>
                </div>

                <p className="mb-6 whitespace-pre-wrap text-sm text-slate-700">{selectedMail.ausschnitt || '(kein Textausschnitt verfügbar)'}</p>

                {selectedMail.zugewiesen ? (
                  <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                    <Check size={14} /> Zugeordnet: {selectedMail.zugewiesen.kundeName}
                  </div>
                ) : (
                  <ZuordnungsZeile
                    mail={selectedMail}
                    bereichWahl={bereichWahl}
                    kundeWahl={kundeWahl}
                    setBereichWahl={setBereichWahl}
                    setKundeWahl={setKundeWahl}
                    onZuweisen={zuweisen}
                    onAlsLead={() => alsNeuenKundenAnlegen(selectedMail)}
                    onIgnorieren={() => {
                      dispatch({ type: 'IGNORE_EINGEGANGENE_EMAIL', id: selectedMail.id })
                      setSelectedId(null)
                    }}
                  />
                )}
              </div>
            )}

            {selectedGesendet && (
              <div>
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-slate-800">{selectedGesendet.betreff}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    An: {selectedGesendet.anName} ({selectedGesendet.an}) · {fmtDateTime(selectedGesendet.gesendetAm)}
                  </p>
                  {selectedGesendet.kundeName && <p className="mt-1 text-xs text-slate-400">Zugeordnet: {selectedGesendet.kundeName}</p>}
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{selectedGesendet.text}</p>
              </div>
            )}

            {!selectedMail && !selectedGesendet && <EmptyState text="Wähle links eine E-Mail aus." />}
          </div>
        </>
      )}

      <SendEmailModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        to={antwortAn?.to}
        defaultSubject={antwortAn?.subject ?? ''}
        onSent={() => {
          if (ordner === 'gesendet') ladeGesendet(gesendetLimit)
        }}
      />
      <MailVorlagenModal open={vorlagenOpen} onClose={() => setVorlagenOpen(false)} />
    </div>
  )
}

function ZuordnungsZeile({
  mail,
  bereichWahl,
  kundeWahl,
  setBereichWahl,
  setKundeWahl,
  onZuweisen,
  onAlsLead,
  onIgnorieren,
}: {
  mail: EingegangeneEmail
  bereichWahl: Record<string, KundeBereich>
  kundeWahl: Record<string, string>
  setBereichWahl: React.Dispatch<React.SetStateAction<Record<string, KundeBereich>>>
  setKundeWahl: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onZuweisen: (mailId: string, bereich: KundeBereich, kundeId: string) => void
  onAlsLead: () => void
  onIgnorieren: () => void
}) {
  const { state } = useApp()
  const bereich = bereichWahl[mail.id] ?? mail.vorschlag?.bereich ?? KUNDEN_BEREICHE[0].id
  const kundenListe = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state)
  const kundeId = kundeWahl[mail.id] ?? mail.vorschlag?.kundeId ?? kundenListe[0]?.id ?? ''

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-2 text-xs font-medium text-slate-500">
        {mail.vorschlag ? `Vorschlag: ${mail.vorschlag.kundeName} (${kundeBereichLabel(mail.vorschlag.bereich)})` : 'Kein automatischer Vorschlag gefunden.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${inputClass} w-auto`}
          value={bereich}
          onChange={(e) => setBereichWahl((s) => ({ ...s, [mail.id]: e.target.value as KundeBereich }))}
        >
          {KUNDEN_BEREICHE.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <select className={`${inputClass} w-auto`} value={kundeId} onChange={(e) => setKundeWahl((s) => ({ ...s, [mail.id]: e.target.value }))}>
          {kundenListe.length === 0 && <option value="">– keine Kunden –</option>}
          {kundenListe.map((k) => (
            <option key={k.id} value={k.id}>
              {k.firma} ({k.ansprechpartner})
            </option>
          ))}
        </select>
        <PrimaryButton onClick={() => kundeId && onZuweisen(mail.id, bereich, kundeId)} className="text-xs" disabled={!kundeId}>
          Zuweisen
        </PrimaryButton>
        <SecondaryButton onClick={onAlsLead} className="text-xs">
          <UserPlus size={13} /> Als neuen Lead anlegen
        </SecondaryButton>
        <button onClick={onIgnorieren} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600" title="Ignorieren">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
