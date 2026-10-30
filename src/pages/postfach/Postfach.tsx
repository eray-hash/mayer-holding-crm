import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Inbox, Send, RefreshCw, UserPlus, Check, X, AlertTriangle, Plus, Reply, ListPlus, Search, Sparkles, Megaphone, Paperclip } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { isEmailInboxDbConfigured, fetchStoredEmails, searchStoredEmails } from '../../lib/emailInboxDb'
import { isSentEmailsDbConfigured, fetchSentEmails, searchSentEmails } from '../../lib/sentEmailsDb'
import { isLeadsDbConfigured, fetchOffeneLeads, setLeadStatus } from '../../lib/leadsDb'
import { isEmailGatewayConfigured, classifyNewLeads } from '../../lib/emailGateway'
import { matchKundeByEmail, suggestKunde } from '../../lib/matchKunde'
import { KUNDEN_BEREICHE, kundeBereichLabel } from '../../data/kundenBereiche'
import { uid, today, addDays, fmtDateTime } from '../../lib/dates'
import { MITARBEITER } from '../../data/constants'
import { SendEmailModal } from '../../components/SendEmailModal'
import { MailVorlagenModal } from '../../components/MailVorlagenModal'
import { PrimaryButton, SecondaryButton, EmptyState, inputClass } from '../../components/ui'
import type { EingegangeneEmail, GesendeteEmail, KundeBereich, VorgeschlagenerLead } from '../../types'

type Ordner = 'posteingang' | 'gesendet' | 'leads'

function fmtGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function neuerKunde(lead: VorgeschlagenerLead) {
  return {
    id: uid('k'),
    firma: lead.firma || lead.name || lead.email,
    ansprechpartner: lead.name || lead.firma || lead.email,
    email: lead.email,
    telefon: lead.telefon || '',
    prioritaet: 'Mittel' as const,
    status: 'lead',
    followUp: { date: addDays(today(), 2), note: 'Erstkontakt aufnehmen', done: false },
    verantwortlich: MITARBEITER[0],
    letzteAktivitaet: today(),
    activities: [{ id: uid('act'), date: today(), text: `Als Lead aus E-Mail-Analyse übernommen: „${lead.notiz}"`, user: 'KI-Lead-Analyse' }],
  }
}

function addKundeZuBereich(dispatch: ReturnType<typeof useApp>['dispatch'], bereich: KundeBereich, lead: VorgeschlagenerLead) {
  const kunde = neuerKunde(lead)
  switch (bereich) {
    case 'beratung':
      return dispatch({ type: 'ADD_KUNDE', kunde })
    case 'erben':
      return dispatch({ type: 'ADD_ERBEN_MANDANT', kunde })
    case 'betriebsuebergabe':
      return dispatch({ type: 'ADD_BETRIEBSUEBERGABE_MANDANT', kunde })
    case 'betriebsformen':
      return dispatch({ type: 'ADD_BETRIEBSFORMEN_MANDANT', kunde })
    case 'akademie':
      return dispatch({ type: 'ADD_AKADEMIE_TEILNEHMER', kunde })
    case 'finanzierungen':
      return dispatch({ type: 'ADD_FINANZIERUNGEN_MANDANT', kunde })
  }
}

export function Postfach() {
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const [ordner, setOrdner] = useState<Ordner>('posteingang')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(30)

  const [gesendet, setGesendet] = useState<GesendeteEmail[]>([])
  const [gesendetLimit, setGesendetLimit] = useState(30)
  const [gesendetLoading, setGesendetLoading] = useState(false)

  const [leads, setLeads] = useState<VorgeschlagenerLead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [leadBereichWahl, setLeadBereichWahl] = useState<Record<string, KundeBereich>>({})
  const [klassifiziereNeueLeads, setKlassifiziereNeueLeads] = useState(false)

  const [composeOpen, setComposeOpen] = useState(false)
  const [vorlagenOpen, setVorlagenOpen] = useState(false)
  const [antwortAn, setAntwortAn] = useState<{ to: string; subject: string } | null>(null)

  const [bereichWahl, setBereichWahl] = useState<Record<string, KundeBereich>>({})
  const [kundeWahl, setKundeWahl] = useState<Record<string, string>>({})

  const [query, setQuery] = useState('')
  const [suche, setSuche] = useState(false)
  const [posteingangSucheIds, setPosteingangSucheIds] = useState<Set<string> | null>(null)

  const mailsOhneSuche = [...state.eingegangeneEmails]
    .filter((e) => !e.ignoriert)
    .sort((a, b) => (b.datum < a.datum ? -1 : b.datum > a.datum ? 1 : 0))
  const mails = posteingangSucheIds ? mailsOhneSuche.filter((m) => posteingangSucheIds.has(m.messageId)) : mailsOhneSuche

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
    if (isEmailGatewayConfigured && isLeadsDbConfigured) {
      setKlassifiziereNeueLeads(true)
      classifyNewLeads()
        .then((ergebnis) => {
          if (ergebnis.vorgeschlagen > 0 && ordner === 'leads') ladeLeads()
        })
        .catch(() => {
          // still best effort — der manuelle "npm run extract-leads"-Lauf bleibt als Fallback nutzbar
        })
        .finally(() => setKlassifiziereNeueLeads(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (ordner === 'gesendet' && isSentEmailsDbConfigured && gesendet.length === 0) ladeGesendet(gesendetLimit)
    if (ordner === 'leads' && isLeadsDbConfigured && leads.length === 0) ladeLeads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordner])

  async function ladeLeads() {
    setLeadsLoading(true)
    setError('')
    try {
      setLeads(await fetchOffeneLeads())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lead-Vorschläge konnten nicht geladen werden.')
    } finally {
      setLeadsLoading(false)
    }
  }

  async function leadUebernehmen(lead: VorgeschlagenerLead, bereich: KundeBereich) {
    addKundeZuBereich(dispatch, bereich, lead)
    await setLeadStatus(lead.id, 'uebernommen').catch(() => {})
    setLeads((ls) => ls.filter((l) => l.id !== lead.id))
    setSelectedId(null)
  }

  async function leadVerwerfen(lead: VorgeschlagenerLead) {
    await setLeadStatus(lead.id, 'verworfen').catch(() => {})
    setLeads((ls) => ls.filter((l) => l.id !== lead.id))
    setSelectedId(null)
  }

  // Server-seitige Suche (debounced) über Absender/Betreff/Text — ordnerabhängig, damit ältere,
  // noch nicht nachgeladene E-Mails auch gefunden werden statt nur die lokal geladene Seite zu filtern.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSuche(false)
      setPosteingangSucheIds(null)
      if (ordner === 'gesendet') ladeGesendet(gesendetLimit)
      return
    }
    const timeout = setTimeout(async () => {
      setSuche(true)
      setError('')
      try {
        if (ordner === 'posteingang') {
          const treffer = await searchStoredEmails(trimmed, 100)
          const emails: EingegangeneEmail[] = treffer.map((m) => {
            const vorschlagMatch = matchKundeByEmail(state, m.von) ?? suggestKunde(state, `${m.betreff} ${m.ausschnitt} ${m.vonName}`)
            return {
              id: uid('mail'),
              ...m,
              vorschlag: vorschlagMatch ? { bereich: vorschlagMatch.bereich, kundeId: vorschlagMatch.kundeId, kundeName: vorschlagMatch.kundeName } : undefined,
            }
          })
          dispatch({ type: 'ADD_EINGEGANGENE_EMAILS', emails })
          setPosteingangSucheIds(new Set(treffer.map((m) => m.messageId)))
        } else {
          setGesendet(await searchSentEmails(trimmed, 100))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Suche fehlgeschlagen.')
      } finally {
        setSuche(false)
      }
    }, 350)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ordner])

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
  const selectedLead = ordner === 'leads' ? leads.find((l) => l.id === selectedId) : undefined

  const dbConfigured = ordner === 'posteingang' ? isEmailInboxDbConfigured : ordner === 'gesendet' ? isSentEmailsDbConfigured : isLeadsDbConfigured

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
          <button
            onClick={() => { setOrdner('leads'); setSelectedId(null) }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              ordner === 'leads' ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Sparkles size={15} /> Neue Leads
            {leads.length > 0 && <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-xs font-semibold text-white">{leads.length}</span>}
          </button>
          {klassifiziereNeueLeads && (
            <p className="px-3 pt-1 text-[11px] text-slate-400">Neue Absender werden im Hintergrund geprüft …</p>
          )}
        </nav>
        <button
          onClick={() => navigate('/kampagnen')}
          className="mt-4 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
        >
          <Megaphone size={14} /> Kampagnen
        </button>
        <button
          onClick={() => setVorlagenOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
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
              : ordner === 'gesendet'
                ? 'Gesendet-Ordner noch nicht verbunden — sobald die E-Mail-Datenbank konfiguriert ist, erscheinen hier über das CRM versendete Mails.'
                : 'Lead-Vorschläge noch nicht verbunden — sobald die E-Mail-Datenbank konfiguriert ist, erscheinen hier per KI aus der E-Mail-Historie extrahierte Leads.'}
          </div>
        </div>
      ) : (
        <>
          {/* Mail-Liste */}
          <div className="flex w-80 flex-shrink-0 flex-col rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-xs font-medium text-slate-500">{ordner === 'posteingang' ? 'Posteingang' : ordner === 'gesendet' ? 'Gesendet' : 'Neue Leads'}</span>
              <button
                onClick={() => (ordner === 'posteingang' ? ladePosteingang(limit) : ordner === 'gesendet' ? ladeGesendet(gesendetLimit) : ladeLeads())}
                disabled={loading || gesendetLoading || leadsLoading}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                title="Aktualisieren"
              >
                <RefreshCw size={13} className={loading || gesendetLoading || leadsLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {ordner !== 'leads' && (
              <div className="relative border-b border-slate-100 p-2">
                <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${inputClass} py-1.5 pl-7 pr-7 text-xs`}
                  placeholder="Absender, Betreff oder Text durchsuchen…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {suche && <RefreshCw size={12} className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
              </div>
            )}

            {error && (
              <div className="m-2 flex items-start gap-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> {error}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {ordner === 'posteingang' &&
                (mails.length === 0 ? (
                  <EmptyState text={query.trim() ? 'Keine Treffer für diese Suche.' : 'Keine E-Mails geladen.'} />
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
                  <EmptyState text={query.trim() ? 'Keine Treffer für diese Suche.' : 'Noch keine gesendeten E-Mails.'} />
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

              {ordner === 'leads' &&
                (leads.length === 0 ? (
                  <EmptyState text="Keine offenen Lead-Vorschläge." />
                ) : (
                  leads.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => setSelectedId(lead.id)}
                      className={`block w-full border-b border-slate-50 px-3 py-2.5 text-left ${selectedId === lead.id ? 'bg-accent-50' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{lead.firma || lead.name || lead.email}</span>
                        <span className="flex-shrink-0 text-[11px] text-slate-400">{fmtDateTime(lead.erstelltAm)}</span>
                      </div>
                      <div className="truncate text-xs text-slate-600">{lead.name || lead.email}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{lead.bereichVorschlag === 'unklar' ? 'Bereich unklar' : kundeBereichLabel(lead.bereichVorschlag)}</div>
                    </button>
                  ))
                ))}
            </div>

            {ordner !== 'leads' && !query.trim() && (
              <div className="border-t border-slate-100 p-2">
                <SecondaryButton
                  onClick={() => (ordner === 'posteingang' ? mehrLadenPosteingang() : mehrLadenGesendet())}
                  disabled={loading || gesendetLoading}
                  className="w-full justify-center text-xs"
                >
                  Mehr laden
                </SecondaryButton>
              </div>
            )}
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

                <p className="mb-4 whitespace-pre-wrap text-sm text-slate-700">{selectedMail.ausschnitt || '(kein Textausschnitt verfügbar)'}</p>

                {selectedMail.anhaenge && selectedMail.anhaenge.length > 0 && (
                  <div className="mb-6 space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500">Anhänge</p>
                    {selectedMail.anhaenge.map((a) => (
                      <a
                        key={a.url}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-sm text-accent-600 hover:underline"
                      >
                        <Paperclip size={13} /> {a.filename} <span className="text-xs text-slate-400">({fmtGroesse(a.size)})</span>
                      </a>
                    ))}
                  </div>
                )}

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

            {selectedLead && (
              <LeadDetail
                lead={selectedLead}
                bereichWahl={leadBereichWahl[selectedLead.id] ?? (selectedLead.bereichVorschlag === 'unklar' ? 'beratung' : selectedLead.bereichVorschlag)}
                onBereichChange={(b) => setLeadBereichWahl((s) => ({ ...s, [selectedLead.id]: b }))}
                onUebernehmen={(bereich) => leadUebernehmen(selectedLead, bereich)}
                onVerwerfen={() => leadVerwerfen(selectedLead)}
              />
            )}

            {!selectedMail && !selectedGesendet && !selectedLead && <EmptyState text="Wähle links einen Eintrag aus." />}
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

function LeadDetail({
  lead,
  bereichWahl,
  onBereichChange,
  onUebernehmen,
  onVerwerfen,
}: {
  lead: VorgeschlagenerLead
  bereichWahl: KundeBereich
  onBereichChange: (b: KundeBereich) => void
  onUebernehmen: (bereich: KundeBereich) => void
  onVerwerfen: () => void
}) {
  const { state } = useApp()
  const bestehenderTreffer = matchKundeByEmail(state, lead.email)

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-800">{lead.firma || lead.name || lead.email}</h2>
      <p className="mt-1 text-xs text-slate-500">
        {lead.name && `${lead.name} · `}
        {lead.email}
        {lead.telefon && ` · ${lead.telefon}`}
      </p>
      <p className="mt-1 text-xs text-slate-400">Vorgeschlagen am {fmtDateTime(lead.erstelltAm)}</p>

      <p className="mb-6 mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{lead.notiz}</p>

      {bestehenderTreffer ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm text-amber-800">
            Es gibt bereits einen Kunden mit dieser E-Mail: <strong>{bestehenderTreffer.kundeName}</strong> ({kundeBereichLabel(bestehenderTreffer.bereich)}).
          </p>
          <SecondaryButton onClick={onVerwerfen} className="text-xs">
            Vorschlag verwerfen
          </SecondaryButton>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 p-3">
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Bereich</label>
          <select className={`${inputClass} mb-3 w-auto`} value={bereichWahl} onChange={(e) => onBereichChange(e.target.value as KundeBereich)}>
            {KUNDEN_BEREICHE.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <PrimaryButton onClick={() => onUebernehmen(bereichWahl)} className="text-xs">
              <UserPlus size={13} /> Als Kunde/Mandant anlegen
            </PrimaryButton>
            <button onClick={onVerwerfen} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600" title="Verwerfen">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
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
