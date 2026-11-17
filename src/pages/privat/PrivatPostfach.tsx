import { useEffect, useRef, useState } from 'react'
import { Inbox, Send, RefreshCw, Plus, Reply, Search, AlertTriangle, Lock, Check, X, UserPlus, ArrowRightLeft } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { fetchPrivateEmails, ignoreMail } from '../../lib/emailInboxDb'
import { fetchPrivateSentEmails } from '../../lib/sentEmailsDb'
import { holeMailInOeffentlich, rufePostfachAb, type EingegangeneMail } from '../../lib/emailGateway'
import { usePostfaecher, ladePostfaecherNeu } from '../../lib/postfaecher'
import { matchKundeByEmail } from '../../lib/matchKunde'
import { KUNDEN_BEREICHE, kundeBereichLabel } from '../../data/kundenBereiche'
import { getHauptpfad } from '../../data/statusNetworks'
import { uid, today, addDays, fmtDateTime } from '../../lib/dates'
import { SendEmailModal } from '../../components/SendEmailModal'
import { PostfachVerbinden } from '../../components/PostfachVerbinden'
import { MailAnhangLink } from '../../components/MailAnhangLink'
import { PrimaryButton, SecondaryButton, EmptyState, inputClass } from '../../components/ui'
import type { GesendeteEmail, KundeBereich } from '../../types'

type Ordner = 'posteingang' | 'gesendet'
const OEFFENTLICHE_BEREICHE = KUNDEN_BEREICHE.filter((b) => b.id !== 'privat')

/**
 * Das private Postfach: die Mails des eigenen, persönlich verbundenen Postfachs. Niemand sonst sieht
 * sie — bis man eine Mail bewusst "in den öffentlichen Bereich holt" (dann liegt sie im gemeinsamen
 * Postfach, auf Wunsch gleich bei einer Akte).
 */
// Manche Anbieter hängen alle Ordner unter den Posteingang ("INBOX.Kunden") — den Vorsatz nicht zeigen.
function ordnerAnzeige(pfad: string): string {
  return pfad.replace(/^INBOX[./]/i, '').replace(/\//g, ' › ')
}

export function PrivatPostfach() {
  const { state, dispatch } = useApp()
  const { session, mitarbeiter } = useAuth()
  const ich = (session?.user.email ?? '').toLowerCase()
  const { postfaecher, eigenes, geladen, fehler: postfachFehler } = usePostfaecher()
  const loginIstGemeinsam = postfaecher.some((p) => p.gemeinsam && p.adresse.toLowerCase() === ich)

  const [ordner, setOrdner] = useState<Ordner>('posteingang')
  // Ordner des eigenen Postfachs: 'alle', '' (nur Posteingang) oder der Name eines eigenen Ordners.
  const [mailOrdner, setMailOrdner] = useState('alle')
  const [mails, setMails] = useState<EingegangeneMail[]>([])
  const [gesendet, setGesendet] = useState<GesendeteEmail[]>([])
  const [limit, setLimit] = useState(40)
  const [query, setQuery] = useState('')
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compose, setCompose] = useState<{ to?: string; subject?: string } | null>(null)

  async function lade(l = limit, suche = query, aus = mailOrdner) {
    if (!ich) return
    setLaedt(true)
    setFehler('')
    try {
      const [ein, gesendete] = await Promise.all([fetchPrivateEmails(ich, l, suche, aus === 'alle' ? undefined : aus), fetchPrivateSentEmails(ich, l, suche)])
      setMails(ein)
      setGesendet(gesendete)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Postfach konnte nicht geladen werden.')
    } finally {
      setLaedt(false)
    }
  }

  // Beim Öffnen: erst zeigen, was schon da ist, dann einmal frisch beim Mail-Server nachsehen.
  useEffect(() => {
    if (!ich) return
    lade()
    if (eigenes) {
      rufePostfachAb(eigenes.id)
        .then((neu) => {
          if (neu > 0) lade()
        })
        .catch((err) => setFehler(err instanceof Error ? err.message : 'Abruf fehlgeschlagen.'))
        .finally(() => ladePostfaecherNeu().catch(() => {}))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ich, eigenes?.id])

  useEffect(() => {
    const warte = setTimeout(() => lade(limit, query), 350)
    return () => clearTimeout(warte)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function aktualisieren() {
    setHinweis('')
    setFehler('')
    if (eigenes) {
      setLaedt(true)
      try {
        const neu = await rufePostfachAb(eigenes.id)
        setHinweis(neu > 0 ? `${neu} neue ${neu === 1 ? 'Mail' : 'Mails'} abgeholt.` : 'Keine neuen Mails.')
      } catch (err) {
        setFehler(err instanceof Error ? err.message : 'Abruf fehlgeschlagen.')
      }
      ladePostfaecherNeu().catch(() => {})
    }
    await lade()
  }

  const selectedMail = ordner === 'posteingang' ? mails.find((m) => m.messageId === selectedId) : undefined
  const selectedGesendet = ordner === 'gesendet' ? gesendet.find((m) => m.id === selectedId) : undefined

  function alsPrivatenKontakt(mail: EingegangeneMail) {
    dispatch({
      type: 'ADD_KUNDE_IN_BEREICH',
      bereich: 'privat',
      kunde: {
        id: uid('k'),
        firma: mail.vonName,
        ansprechpartner: mail.vonName,
        email: mail.von,
        telefon: '',
        prioritaet: 'Mittel',
        status: getHauptpfad('privat')[0],
        followUp: { date: addDays(today(), 2), note: 'Rückmeldung geben', done: false },
        verantwortlich: mitarbeiter?.name ?? state.profil.name,
        verantwortlichEmail: ich,
        letzteAktivitaet: today(),
        activities: [{ id: uid('act'), date: today(), text: `Aus privater E-Mail angelegt: „${mail.betreff}"`, user: mitarbeiter?.name ?? 'Privates Postfach' }],
      },
    })
    setHinweis(`${mail.vonName} ist jetzt in „Meine Kontakte“.`)
  }

  async function ausblenden(mail: EingegangeneMail) {
    setMails((ms) => ms.filter((m) => m.messageId !== mail.messageId))
    setSelectedId(null)
    await ignoreMail(mail.messageId).catch((err) => setFehler(err instanceof Error ? err.message : 'Konnte nicht ausgeblendet werden.'))
  }

  return (
    <div className="flex flex-col gap-4 md:h-[calc(100vh-7.5rem)] lg:flex-row">
      <div className="flex-shrink-0 lg:w-48">
        <h1 className="mb-1 text-lg font-semibold text-slate-800">Mein Postfach</h1>
        <p className="mb-3 flex items-center gap-1.5 text-xs text-slate-400">
          <Lock size={12} /> nur für dich sichtbar
        </p>
        <PrimaryButton onClick={() => setCompose({})} disabled={!eigenes || eigenes.kannSenden === false} className="mb-4 w-full justify-center">
          <Plus size={14} /> Neue E-Mail
        </PrimaryButton>
        <nav className="flex gap-1 lg:block lg:space-y-1">
          {(
            [
              ['posteingang', 'Posteingang', <Inbox size={15} key="i" />, mails.length],
              ['gesendet', 'Gesendet', <Send size={15} key="s" />, gesendet.length],
            ] as const
          ).map(([id, label, icon, anzahl]) => (
            <button
              key={id}
              onClick={() => { setOrdner(id); setSelectedId(null) }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${ordner === id ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {icon} {label}
              <span className="ml-auto text-xs text-slate-400">{anzahl}</span>
            </button>
          ))}
        </nav>
        {eigenes && (
          <p className="mt-4 break-all px-1 text-[11px] text-slate-400">
            {eigenes.adresse}
            {eigenes.kannSenden === false && <><br />nur Empfang — der Anbieter lässt den Versand über das CRM nicht zu</>}
            {eigenes.letzterAbruf && <><br />zuletzt abgeholt: {fmtDateTime(eigenes.letzterAbruf)}</>}
          </p>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {geladen && !eigenes && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-800">Eigenes Postfach verbinden</h2>
            <p className="mb-4 text-sm text-slate-500">
              Einmal das Passwort deines Mail-Postfachs eingeben — danach kommen deine Mails von selbst hier an, und du kannst unter deiner eigenen Adresse schreiben.
            </p>
            <div className="max-w-md">
              <PostfachVerbinden adresse={loginIstGemeinsam ? '' : ich} onVerbunden={() => setTimeout(() => lade(), 8000)} />
            </div>
          </div>
        )}
        {eigenes?.letzterFehler && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <div>
              Der letzte Abruf ist fehlgeschlagen: {eigenes.letzterFehler}
              <div className="mt-3 max-w-md"><PostfachVerbinden adresse={eigenes.adresse} adresseAenderbar={false} onVerbunden={() => setTimeout(() => lade(), 8000)} /></div>
            </div>
          </div>
        )}
        {(fehler || postfachFehler) && (
          <div className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {fehler || postfachFehler}
          </div>
        )}
        {hinweis && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
            <Check size={14} /> {hinweis}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
          <div className="flex max-h-72 flex-shrink-0 flex-col rounded-xl border border-slate-200 bg-white md:max-h-none md:w-80">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-xs font-medium text-slate-500">{ordner === 'posteingang' ? 'Posteingang' : 'Gesendet'}</span>
              <button onClick={aktualisieren} disabled={laedt} className="rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600" title="Jetzt abholen">
                <RefreshCw size={13} className={laedt ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="relative border-b border-slate-100 p-2">
              <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputClass} py-1.5 pl-7 text-xs`} placeholder="Durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {ordner === 'posteingang' && (eigenes?.ordner?.length ?? 0) > 0 && (
              <div className="border-b border-slate-100 p-2">
                <select
                  className={`${inputClass} py-1.5 text-xs`}
                  value={mailOrdner}
                  onChange={(e) => {
                    setMailOrdner(e.target.value)
                    setSelectedId(null)
                    lade(limit, query, e.target.value)
                  }}
                  title="Ordner des Postfachs"
                >
                  <option value="alle">Alle Ordner</option>
                  <option value="">Posteingang</option>
                  {eigenes!.ordner!.map((o) => (
                    <option key={o} value={o}>{ordnerAnzeige(o)}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {ordner === 'posteingang' &&
                (mails.length === 0 ? (
                  <EmptyState text={query.trim() ? 'Keine Treffer.' : mailOrdner !== 'alle' ? 'In diesem Ordner liegt nichts.' : eigenes ? 'Noch keine Mails abgeholt.' : 'Noch kein Postfach verbunden.'} />
                ) : (
                  mails.map((mail) => (
                    <button
                      key={mail.messageId}
                      onClick={() => setSelectedId(mail.messageId)}
                      className={`block w-full border-b border-slate-50 px-3 py-2.5 text-left ${selectedId === mail.messageId ? 'bg-accent-50' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{mail.vonName}</span>
                        <span className="flex-shrink-0 text-[11px] text-slate-400">{fmtDateTime(mail.datum).split(',')[0]}</span>
                      </div>
                      <div className="truncate text-xs text-slate-600">{mail.betreff}</div>
                      {mailOrdner === 'alle' && mail.ordner && (
                        <span className="mt-1 inline-block max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{ordnerAnzeige(mail.ordner)}</span>
                      )}
                    </button>
                  ))
                ))}
              {ordner === 'gesendet' &&
                (gesendet.length === 0 ? (
                  <EmptyState text={query.trim() ? 'Keine Treffer.' : 'Noch nichts privat gesendet.'} />
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
                    </button>
                  ))
                ))}
            </div>
            {!query.trim() && (ordner === 'posteingang' ? mails.length : gesendet.length) >= limit && (
              <div className="border-t border-slate-100 p-2">
                <SecondaryButton onClick={() => { const n = limit + 40; setLimit(n); lade(n) }} disabled={laedt} className="w-full justify-center text-xs">
                  Mehr laden
                </SecondaryButton>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-5 md:min-h-0 md:overflow-y-auto">
            {selectedMail && (
              <div>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-slate-800">{selectedMail.betreff}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Von: {selectedMail.vonName} ({selectedMail.von}) · {fmtDateTime(selectedMail.datum)}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <SecondaryButton onClick={() => setCompose({ to: selectedMail.von, subject: `Re: ${selectedMail.betreff}` })} disabled={eigenes?.kannSenden === false} className="text-xs">
                      <Reply size={13} /> Antworten
                    </SecondaryButton>
                    <button onClick={() => ausblenden(selectedMail)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600" title="Ausblenden">
                      <X size={14} />
                    </button>
                  </div>
                </div>

                <RueberholenKasten
                  key={selectedMail.messageId}
                  absenderEmail={selectedMail.von}
                  absenderName={selectedMail.vonName}
                  betreff={selectedMail.betreff}
                  onHolen={async (kunde, vorher) => {
                    vorher?.()
                    await holeMailInOeffentlich('eingang', selectedMail.messageId, kunde)
                    setMails((ms) => ms.filter((m) => m.messageId !== selectedMail.messageId))
                    setSelectedId(null)
                    setHinweis(kunde ? `Mail liegt jetzt im öffentlichen Bereich bei ${kunde.name}.` : 'Mail liegt jetzt im gemeinsamen Postfach.')
                  }}
                  onPrivaterKontakt={matchKundeByEmail(state, selectedMail.von) ? undefined : () => alsPrivatenKontakt(selectedMail)}
                />

                <p className="mb-4 mt-4 whitespace-pre-wrap break-words text-sm text-slate-700">{selectedMail.ausschnitt || '(kein Text)'}</p>

                {selectedMail.anhaenge && selectedMail.anhaenge.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500">Anhänge</p>
                    {selectedMail.anhaenge.map((a) => (
                      <MailAnhangLink key={a.url} anhang={a} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedGesendet && (
              <div>
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-slate-800">{selectedGesendet.betreff}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    An: {selectedGesendet.anName} ({selectedGesendet.an}) · {fmtDateTime(selectedGesendet.gesendetAm)}
                    {selectedGesendet.von && <> · Von: {selectedGesendet.von}</>}
                  </p>
                </div>
                <RueberholenKasten
                  key={selectedGesendet.id}
                  absenderEmail={selectedGesendet.an}
                  absenderName={selectedGesendet.anName}
                  betreff={selectedGesendet.betreff}
                  onHolen={async (kunde, vorher) => {
                    vorher?.()
                    await holeMailInOeffentlich('gesendet', selectedGesendet.id, kunde)
                    setGesendet((ms) => ms.filter((m) => m.id !== selectedGesendet.id))
                    setSelectedId(null)
                    setHinweis(kunde ? `Mail liegt jetzt im öffentlichen Bereich bei ${kunde.name}.` : 'Mail liegt jetzt im gemeinsamen Gesendet-Ordner.')
                  }}
                />
                <p className="mt-4 whitespace-pre-wrap break-words text-sm text-slate-700">{selectedGesendet.text}</p>
              </div>
            )}

            {!selectedMail && !selectedGesendet && <EmptyState text="Wähle links eine Mail aus." />}
          </div>
        </div>
      </div>

      <SendEmailModal
        open={compose !== null}
        onClose={() => setCompose(null)}
        to={compose?.to}
        defaultSubject={compose?.subject ?? ''}
        privat
        onSent={() => lade()}
      />
    </div>
  )
}

type ZielKunde = { bereich: string; id: string; name: string }

/** "In den öffentlichen Bereich holen": nur ins gemeinsame Postfach, zu einer bestehenden Akte oder
 *  gleich als neuer Kunde in einem Bereich. */
function RueberholenKasten({
  absenderEmail,
  absenderName,
  betreff,
  onHolen,
  onPrivaterKontakt,
}: {
  absenderEmail: string
  absenderName: string
  betreff: string
  /** `vorher` läuft unmittelbar vor dem Server-Aufruf (legt z. B. die neue Akte an). */
  onHolen: (kunde?: ZielKunde, vorher?: () => void) => Promise<void>
  onPrivaterKontakt?: () => void
}) {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const treffer = matchKundeByEmail(state, absenderEmail)
  const oeffentlicherTreffer = treffer && treffer.bereich !== 'privat' ? treffer : undefined
  const [offen, setOffen] = useState(false)
  const [ziel, setZiel] = useState<'postfach' | 'akte' | 'neu'>(oeffentlicherTreffer ? 'akte' : 'postfach')
  const [bereich, setBereich] = useState<KundeBereich>(oeffentlicherTreffer?.bereich ?? OEFFENTLICHE_BEREICHE[0].id)
  const [kundeId, setKundeId] = useState(oeffentlicherTreffer?.kundeId ?? '')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  // Eine Kennung je Kasten: Wird nach einem Fehler erneut geklickt, entsteht kein zweiter Kunde.
  const [neueKundenId] = useState(() => uid('k'))
  const angelegt = useRef(false)
  // Nur Bereiche, für die der Mitarbeiter freigeschaltet ist (Geschäftsführung: alle).
  const darfAlles = !mitarbeiter || mitarbeiter.rolle === 'geschaeftsfuehrung' || mitarbeiter.ist_admin
  const bereiche = OEFFENTLICHE_BEREICHE.filter((b) => darfAlles || mitarbeiter.bereiche.includes(b.id === 'immobilienkunden' ? 'immobilien' : b.id))
  const kundenListe = OEFFENTLICHE_BEREICHE.find((b) => b.id === bereich)?.get(state) ?? []
  const ersterErlaubter = bereiche[0]?.id
  useEffect(() => {
    if (ersterErlaubter && !bereiche.some((b) => b.id === bereich)) setBereich(ersterErlaubter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ersterErlaubter])

  async function holen() {
    setLaeuft(true)
    setFehler('')
    try {
      if (ziel === 'postfach') {
        await onHolen()
      } else if (ziel === 'akte') {
        const kunde = kundenListe.find((k) => k.id === kundeId)
        if (!kunde) throw new Error('Bitte eine Akte auswählen.')
        await onHolen({ bereich, id: kunde.id, name: `${kunde.firma} (${kunde.ansprechpartner})` })
      } else {
        const id = neueKundenId
        await onHolen({ bereich, id, name: `${absenderName} (${absenderName})` }, () => {
          if (angelegt.current) return
          angelegt.current = true
          dispatch({
          type: 'ADD_KUNDE_IN_BEREICH',
          bereich,
          kunde: {
            id,
            firma: absenderName,
            ansprechpartner: absenderName,
            email: absenderEmail,
            telefon: '',
            prioritaet: 'Mittel',
            status: getHauptpfad(bereich)[0],
            followUp: { date: addDays(today(), 2), note: 'Erstkontakt aufnehmen', done: false },
            verantwortlich: mitarbeiter?.name ?? state.profil.name,
            letzteAktivitaet: today(),
            activities: [{ id: uid('act'), date: today(), text: `Aus dem privaten Postfach übernommen: „${betreff}"`, user: mitarbeiter?.name ?? 'Privates Postfach' }],
          },
        })
        })
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.')
      setLaeuft(false)
    }
  }

  if (!offen) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <Lock size={12} /> Privat
          {oeffentlicherTreffer && <> · Absender ist bereits Kunde: {oeffentlicherTreffer.kundeName} ({kundeBereichLabel(oeffentlicherTreffer.bereich)})</>}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onPrivaterKontakt && (
            <SecondaryButton onClick={onPrivaterKontakt} className="text-xs">
              <UserPlus size={13} /> Als privaten Kontakt
            </SecondaryButton>
          )}
          <PrimaryButton onClick={() => setOffen(true)} className="text-xs">
            <ArrowRightLeft size={13} /> In den öffentlichen Bereich holen
          </PrimaryButton>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-accent-200 bg-accent-50/40 p-3">
      <p className="mb-2 text-xs font-semibold text-slate-700">In den öffentlichen Bereich holen — danach sehen alle Mitarbeiter diese Mail.</p>
      <div className="space-y-1.5 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          <input type="radio" checked={ziel === 'postfach'} onChange={() => setZiel('postfach')} /> Nur ins gemeinsame Postfach
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={ziel === 'akte'} onChange={() => setZiel('akte')} /> Zu einer bestehenden Akte
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={ziel === 'neu'} onChange={() => setZiel('neu')} /> Als neuen Kunden anlegen ({absenderName})
        </label>
      </div>
      {ziel !== 'postfach' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <select className={`${inputClass} w-auto`} value={bereich} onChange={(e) => { setBereich(e.target.value as KundeBereich); setKundeId('') }}>
            {bereiche.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
          {ziel === 'akte' && (
            <select className={`${inputClass} w-auto max-w-full`} value={kundeId} onChange={(e) => setKundeId(e.target.value)}>
              <option value="">{kundenListe.length === 0 ? '– keine Akten –' : '– Akte wählen –'}</option>
              {kundenListe.map((k) => (
                <option key={k.id} value={k.id}>{k.firma} ({k.ansprechpartner})</option>
              ))}
            </select>
          )}
        </div>
      )}
      {fehler && <p className="mt-2 text-xs text-rose-600">{fehler}</p>}
      <div className="mt-3 flex gap-2">
        <PrimaryButton onClick={holen} disabled={laeuft || (ziel === 'akte' && !kundeId)} className="text-xs">
          {laeuft ? 'Wird rübergeholt …' : 'Rüberholen'}
        </PrimaryButton>
        <SecondaryButton onClick={() => setOffen(false)} className="text-xs">Abbrechen</SecondaryButton>
      </div>
    </div>
  )
}
