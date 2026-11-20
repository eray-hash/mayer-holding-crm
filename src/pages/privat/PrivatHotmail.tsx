import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Flag, Forward, FolderInput, Inbox, ListChecks, Mail, MailOpen, Paperclip, PenSquare, RefreshCw, Reply, ReplyAll, Search, X } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { useMsStatus } from '../../lib/microsoftKonto'
import {
  ART_TEXT,
  outlookAblegen,
  outlookAnhaenge,
  outlookAnhangOeffnen,
  outlookFahne,
  outlookGelesen,
  outlookListe,
  outlookMail,
  outlookOffenePunkte,
  outlookOrdner,
  outlookSuche,
  outlookVerlauf,
  outlookVerschieben,
  type OutlookAnhang,
  type OutlookMail,
  type OutlookOrdner,
} from '../../lib/outlook'
import { fmtDateTime } from '../../lib/dates'
import { SecondaryButton, inputClass } from '../../components/ui'
import { OutlookSchreiben } from '../../components/OutlookSchreiben'

type Ansicht = { art: 'ordner'; ordner: string } | { art: 'offen' } | { art: 'suche'; begriff: string }

/** Bereich Privat → Hotmail: das Outlook-Postfach live (nichts wird kopiert); Mayer-Geschäft ist ausgeblendet. */
export function PrivatHotmail({ start = 'ordner' }: { start?: 'ordner' | 'offen' }) {
  const { ansichtAls, session } = useAuth()
  const { status } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())
  if (ansichtAls) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Private Mails werden in dieser Ansicht nicht gezeigt.</div>
  if (!status) return <p className="text-sm text-slate-400">Wird geladen …</p>
  if (!status.erlaubt) return <p className="text-sm text-slate-500">Die Microsoft-Anbindung ist für dein Konto nicht freigeschaltet.</p>
  if (!status.verbunden)
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        Noch kein Microsoft-Konto verbunden.{' '}
        <Link className="font-medium text-accent-700 hover:underline" to="/privat/einstellungen">
          Jetzt unter Einstellungen verbinden
        </Link>
        .
      </div>
    )
  return <Inhalt start={start} />
}

function Inhalt({ start }: { start: 'ordner' | 'offen' }) {
  const [ansicht, setAnsicht] = useState<Ansicht>(start === 'offen' ? { art: 'offen' } : { art: 'ordner', ordner: 'inbox' })
  const [ordner, setOrdner] = useState<OutlookOrdner[]>([])
  const [mails, setMails] = useState<OutlookMail[]>([])
  const [ausgeblendet, setAusgeblendet] = useState(0)
  const [weiter, setWeiter] = useState<number | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')
  const [suchText, setSuchText] = useState('')
  const [gewaehlt, setGewaehlt] = useState<string | null>(null)
  const [neueMail, setNeueMail] = useState(false)
  const [gesendet, setGesendet] = useState('')

  useEffect(() => {
    outlookOrdner()
      .then(setOrdner)
      .catch(() => undefined)
  }, [])

  async function lade(a: Ansicht, ab = 0) {
    setLaedt(true)
    setFehler('')
    try {
      if (a.art === 'ordner') {
        const r = await outlookListe(a.ordner, ab)
        setMails((alt) => (ab ? [...alt, ...r.mails] : r.mails))
        setAusgeblendet((alt) => (ab ? alt + r.ausgeblendet : r.ausgeblendet))
        setWeiter(r.weiter ? r.naechstesAb : null)
      } else if (a.art === 'offen') {
        const r = await outlookOffenePunkte(60)
        setMails(r.mails)
        setAusgeblendet(r.ausgeblendet)
        setWeiter(null)
      } else {
        const r = await outlookSuche(a.begriff, 150)
        setMails(r.mails)
        setAusgeblendet(r.ausgeblendet)
        setWeiter(null)
      }
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaedt(false)
    }
  }

  useEffect(() => {
    setGewaehlt(null)
    lade(ansicht)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ansicht])

  const aktualisiere = (id: string, patch: Partial<OutlookMail>) => setMails((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const entferne = (id: string) => {
    setMails((ms) => ms.filter((m) => m.id !== id))
    setGewaehlt(null)
  }

  const titel = ansicht.art === 'offen' ? 'Offene Punkte' : ansicht.art === 'suche' ? `Suche: „${ansicht.begriff}“` : ordner.find((o) => o.id === ansicht.ordner)?.pfad ?? 'Posteingang'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold text-slate-800">Hotmail</h1>
        <select
          className={`${inputClass} w-auto`}
          value={ansicht.art === 'ordner' ? ansicht.ordner : ''}
          onChange={(e) => e.target.value && setAnsicht({ art: 'ordner', ordner: e.target.value })}
          title="Ordner"
        >
          {ansicht.art !== 'ordner' && <option value="">Ordner wählen …</option>}
          <option value="inbox">Posteingang</option>
          {ordner
            .filter((o) => o.name.toLowerCase() !== 'posteingang' && o.name.toLowerCase() !== 'inbox')
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.pfad}
                {o.ungelesen ? ` (${o.ungelesen})` : ''}
              </option>
            ))}
        </select>
        <SecondaryButton onClick={() => setAnsicht({ art: 'offen' })} className={ansicht.art === 'offen' ? 'ring-2 ring-accent-300' : ''}>
          <ListChecks size={15} /> Offene Punkte
        </SecondaryButton>
        <form
          className="relative min-w-[14rem] flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (suchText.trim().length >= 2) setAnsicht({ art: 'suche', begriff: suchText.trim() })
          }}
        >
          <Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input className={`${inputClass} pl-8`} value={suchText} onChange={(e) => setSuchText(e.target.value)} placeholder="Kunde, Firma, Adresse oder Stichwort — ganzer Verlauf" />
        </form>
        <SecondaryButton onClick={() => setNeueMail(true)}>
          <PenSquare size={15} /> Neue Mail
        </SecondaryButton>
        <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Neu laden" onClick={() => lade(ansicht)}>
          <RefreshCw size={16} className={laedt ? 'animate-spin' : ''} />
        </button>
      </div>

      {neueMail && (
        <OutlookSchreiben
          modus="neu"
          onFertig={(m) => {
            setNeueMail(false)
            if (m) setGesendet(m)
          }}
        />
      )}
      {gesendet && <p className="text-sm text-emerald-700">{gesendet}</p>}
      {fehler && (
        <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {fehler}
        </p>
      )}

      <div className="flex flex-col gap-4 xl:flex-row">
        <div className={`min-w-0 xl:w-[26rem] xl:flex-shrink-0 ${gewaehlt ? 'hidden xl:block' : ''}`}>
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              {titel} · {mails.length} Mails
            </span>
            {ausgeblendet > 0 && <span title="Mails von/an Mayer-Adressen und an Mayer weitergeleitete Unterhaltungen">{ausgeblendet} Mayer-Mails ausgeblendet</span>}
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {mails.map((m) => (
              <li key={m.id}>
                <button className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 ${gewaehlt === m.id ? 'bg-accent-50' : ''}`} onClick={() => setGewaehlt(m.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${m.gelesen ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{m.von.name || m.von.adresse || 'Unbekannt'}</span>
                    <span className="shrink-0 text-xs text-slate-400">{m.datum ? fmtDateTime(m.datum) : ''}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {m.fahne === 'flagged' && <Flag size={12} className="shrink-0 text-rose-500" />}
                    {m.fahne === 'complete' && <Check size={12} className="shrink-0 text-emerald-600" />}
                    {m.hatAnhaenge && <Paperclip size={12} className="shrink-0 text-slate-400" />}
                    <span className="truncate text-sm text-slate-700">{m.betreff}</span>
                    {ART_TEXT[m.art] && m.art !== 'wichtig' && (
                      <span className={`ml-auto shrink-0 rounded px-1.5 text-[10px] font-medium ${m.art === 'dringend' ? 'bg-rose-100 text-rose-700' : m.art === 'rechnung' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>
                        {ART_TEXT[m.art]}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-500">{m.vorschau}</div>
                </button>
              </li>
            ))}
            {!laedt && mails.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">{ansicht.art === 'offen' ? 'Keine offenen Punkte.' : 'Keine Mails.'}</li>}
            {laedt && mails.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">Wird geladen …</li>}
          </ul>
          {weiter !== null && ansicht.art === 'ordner' && (
            <SecondaryButton className="mt-2 w-full justify-center" onClick={() => lade(ansicht, weiter)} disabled={laedt}>
              Ältere laden
            </SecondaryButton>
          )}
        </div>

        <div className={`min-w-0 flex-1 ${gewaehlt ? '' : 'hidden xl:block'}`}>
          {gewaehlt ? (
            <MailAnsicht key={gewaehlt} id={gewaehlt} ordner={ordner} onZurueck={() => setGewaehlt(null)} onGeaendert={aktualisiere} onWeg={entferne} />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">
              <Inbox size={16} className="mr-2" /> Mail auswählen
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MailAnsicht({
  id,
  ordner,
  onZurueck,
  onGeaendert,
  onWeg,
}: {
  id: string
  ordner: OutlookOrdner[]
  onZurueck: () => void
  onGeaendert: (id: string, patch: Partial<OutlookMail>) => void
  onWeg: (id: string) => void
}) {
  const { state } = useApp()
  const [mail, setMail] = useState<OutlookMail | null>(null)
  const [anhaenge, setAnhaenge] = useState<OutlookAnhang[]>([])
  const [verlauf, setVerlauf] = useState<OutlookMail[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const [ablegenSuche, setAblegenSuche] = useState<string | null>(null)
  const [schreiben, setSchreiben] = useState<'antworten' | 'allen' | 'weiterleiten' | null>(null)

  useEffect(() => {
    outlookMail(id)
      .then((m) => {
        setMail(m)
        onGeaendert(id, { gelesen: true })
        if (m.hatAnhaenge) outlookAnhaenge(id).then(setAnhaenge).catch(() => undefined)
      })
      .catch((e) => setFehler(e instanceof Error ? e.message : String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const kontakte = useMemo(() => {
    const q = (ablegenSuche ?? '').trim().toLowerCase()
    return state.privatKunden.filter((k) => !q || `${k.firma} ${k.ansprechpartner} ${k.email}`.toLowerCase().includes(q)).slice(0, 8)
  }, [ablegenSuche, state.privatKunden])

  async function tue(arbeit: () => Promise<void>, erfolg: string) {
    setFehler('')
    setHinweis('')
    setArbeitet(true)
    try {
      await arbeit()
      setHinweis(erfolg)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setArbeitet(false)
    }
  }

  const fahne = (status: OutlookMail['fahne'], text: string) =>
    tue(async () => {
      await outlookFahne(id, status)
      setMail((m) => (m ? { ...m, fahne: status } : m))
      onGeaendert(id, { fahne: status })
    }, text)

  if (fehler && !mail) return <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">{fehler}</p>
  if (!mail) return <p className="p-5 text-sm text-slate-400">Wird geladen …</p>

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <button className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 xl:hidden" onClick={onZurueck}>
        <ArrowLeft size={15} /> Zurück
      </button>
      <div>
        <h2 className="text-lg font-semibold text-slate-800">{mail.betreff}</h2>
        <div className="text-sm text-slate-600">
          Von <strong>{mail.von.name || mail.von.adresse}</strong> {mail.von.name && <span className="text-slate-400">&lt;{mail.von.adresse}&gt;</span>}
        </div>
        <div className="text-xs text-slate-500">
          An {mail.an.map((a) => a.name || a.adresse).join(', ')}
          {mail.cc.length > 0 && ` · Kopie ${mail.cc.map((a) => a.name || a.adresse).join(', ')}`} · {mail.datum ? fmtDateTime(mail.datum) : ''}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <SecondaryButton onClick={() => setSchreiben('antworten')} disabled={arbeitet}>
          <Reply size={15} /> Antworten
        </SecondaryButton>
        {mail.an.length + mail.cc.length > 1 && (
          <SecondaryButton onClick={() => setSchreiben('allen')} disabled={arbeitet}>
            <ReplyAll size={15} /> Allen
          </SecondaryButton>
        )}
        <SecondaryButton onClick={() => setSchreiben('weiterleiten')} disabled={arbeitet}>
          <Forward size={15} /> Weiterleiten
        </SecondaryButton>
        {mail.fahne !== 'complete' ? (
          <SecondaryButton onClick={() => fahne('complete', 'Als erledigt markiert (auch in Outlook).')} disabled={arbeitet}>
            <Check size={15} /> Erledigt
          </SecondaryButton>
        ) : (
          <SecondaryButton onClick={() => fahne('notFlagged', 'Erledigt-Haken entfernt.')} disabled={arbeitet}>
            <X size={15} /> Nicht erledigt
          </SecondaryButton>
        )}
        {mail.fahne !== 'flagged' && (
          <SecondaryButton onClick={() => fahne('flagged', 'Zur Nachverfolgung markiert.')} disabled={arbeitet}>
            <Flag size={15} /> Markieren
          </SecondaryButton>
        )}
        <SecondaryButton
          onClick={() =>
            tue(async () => {
              await outlookGelesen(id, false)
              onGeaendert(id, { gelesen: false })
            }, 'Als ungelesen markiert.')
          }
          disabled={arbeitet}
        >
          <MailOpen size={15} /> Ungelesen
        </SecondaryButton>
        <select
          className={`${inputClass} w-auto py-1.5 text-sm`}
          value=""
          disabled={arbeitet}
          onChange={(e) => {
            const ziel = e.target.value
            if (!ziel) return
            tue(async () => {
              await outlookVerschieben(id, ziel)
              onWeg(id)
            }, 'Verschoben.')
          }}
          title="In Ordner verschieben"
        >
          <option value="">Verschieben nach …</option>
          {ordner
            .filter((o) => !/gelöscht|deleted|papierkorb/i.test(o.name))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.pfad}
              </option>
            ))}
        </select>
        <SecondaryButton onClick={() => setAblegenSuche(ablegenSuche === null ? '' : null)} disabled={arbeitet}>
          <FolderInput size={15} /> Beim Kontakt ablegen
        </SecondaryButton>
        {mail.unterhaltung && verlauf === null && (
          <SecondaryButton onClick={() => tue(async () => setVerlauf(await outlookVerlauf(mail.unterhaltung)), '')} disabled={arbeitet}>
            <Mail size={15} /> Ganzer Verlauf
          </SecondaryButton>
        )}
        {mail.link && (
          <a className="inline-flex items-center gap-1 px-2 text-sm text-slate-500 hover:text-slate-700" href={mail.link} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> In Outlook
          </a>
        )}
      </div>

      {ablegenSuche !== null && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input className={inputClass} autoFocus value={ablegenSuche} onChange={(e) => setAblegenSuche(e.target.value)} placeholder="Privaten Kontakt suchen" />
          <ul className="mt-2 space-y-1">
            {kontakte.map((k) => (
              <li key={k.id}>
                <button
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-white"
                  onClick={() =>
                    tue(async () => {
                      const r = await outlookAblegen(id, k.id)
                      setAblegenSuche(null)
                      if (r.ausgelassen?.length) throw new Error(`Abgelegt, aber ohne: ${r.ausgelassen.join(', ')}`)
                    }, `Bei „${k.firma || k.ansprechpartner}“ abgelegt (mit Anhängen). Du findest die Mail dort und unter „Mein Postfach“.`)
                  }
                >
                  {k.firma || k.ansprechpartner}
                </button>
              </li>
            ))}
            {kontakte.length === 0 && <li className="text-xs text-slate-500">Kein privater Kontakt gefunden.</li>}
          </ul>
        </div>
      )}

      {schreiben && (
        <OutlookSchreiben
          modus={schreiben}
          mail={mail}
          onFertig={(m) => {
            setSchreiben(null)
            if (m) setHinweis(m)
          }}
        />
      )}
      {hinweis && <p className="text-sm text-emerald-700">{hinweis}</p>}
      {fehler && <p className="text-sm text-rose-600">{fehler}</p>}

      {anhaenge.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {anhaenge.map((a) => (
            <button
              key={a.id}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => tue(() => outlookAnhangOeffnen(id, a.id), '')}
            >
              <Paperclip size={12} /> {a.name} <span className="text-slate-400">({Math.max(1, Math.round(a.groesse / 1024))} KB)</span>
            </button>
          ))}
        </div>
      )}

      {verlauf ? (
        <div className="space-y-3">
          {verlauf.map((v) => (
            <div key={v.id} className="rounded-lg border border-slate-100 p-3">
              <div className="mb-1 text-xs text-slate-500">
                {v.von.name || v.von.adresse} · {v.datum ? fmtDateTime(v.datum) : ''}
              </div>
              <div className="whitespace-pre-wrap text-sm text-slate-700">{v.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{mail.text}</div>
      )}
    </div>
  )
}
