// „Ihr Kundenbereich“ (22.11.2026): Der Kunde öffnet seinen persönlichen Link und sieht an einem Ort den Stand
// seines Vorgangs, was wir noch von ihm brauchen (mit Hochladen über die bestehende Hochlade-Seite), offene
// Unterschriften, freigegebene Dokumente, Termine, Rechnungen, seinen Ansprechpartner — und kann uns schreiben.
// Was hier erscheint, entscheidet allein der Server (email-gateway/kundenPortal.ts). Große Knöpfe, einfache Wörter.
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Circle, FileText, Loader2, Lock, Mail, MessageSquare, PenLine, Phone, Receipt, Upload, UserRound } from 'lucide-react'
import { Card, PrimaryButton } from '../../components/ui'
import { DatenschutzHinweis } from '../../components/DatenschutzHinweis'
import { fmtEURCent } from '../../lib/dates'
import { holeKundenPortal, holeKundenPortalDatei, sendeKundenPortalNachricht, type KundenPortalSeite } from '../../lib/kundenPortal'

type Frei = Extract<KundenPortalSeite, { stufe: 'frei' }>

const BERLIN = 'Europe/Berlin'
const datumDe = (iso?: string) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('de-DE', { timeZone: BERLIN, day: '2-digit', month: '2-digit', year: 'numeric' }) : ''

function terminText(t: Frei['termine'][number]): string {
  const b = new Date(t.beginn)
  const tag = b.toLocaleDateString('de-DE', { timeZone: BERLIN, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
  if (t.ganztags) return tag
  const uhr = (d: Date) => d.toLocaleTimeString('de-DE', { timeZone: BERLIN, hour: '2-digit', minute: '2-digit' })
  return `${tag}, ${uhr(b)}${t.ende ? `–${uhr(new Date(t.ende))}` : ''} Uhr`
}

const RECHNUNG_TEXT: Record<Frei['rechnungen'][number]['stand'], { text: string; farbe: string }> = {
  offen: { text: 'offen', farbe: 'bg-amber-50 text-amber-700' },
  ueberfaellig: { text: 'Zahlungsziel überschritten', farbe: 'bg-rose-50 text-rose-700' },
  bezahlt: { text: 'bezahlt', farbe: 'bg-emerald-50 text-emerald-700' },
}

function Kopf() {
  return <p className="mb-1 text-center text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstraße 3, 89075 Ulm</p>
}

function Abschnitt({ titel, symbol, children }: { titel: string; symbol: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-800">
        <span className="text-accent-600">{symbol}</span> {titel}
      </h2>
      {children}
    </Card>
  )
}

function Liste({ zeilen }: { zeilen: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm text-slate-700">
      {zeilen.map((z, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-300" />
          <span>{z}</span>
        </li>
      ))}
    </ul>
  )
}

const knopf = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold'

export function PublicKundenPortal() {
  const { token } = useParams()
  const [seite, setSeite] = useState<KundenPortalSeite | null>(null)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    if (!token) return
    holeKundenPortal(token)
      .then(setSeite)
      .catch((e) => setSeite({ stufe: 'ungueltig', grund: e instanceof Error && /Zu viele/.test(e.message) ? e.message : 'Die Seite lässt sich gerade nicht laden. Bitte versuchen Sie es später erneut.' }))
  }, [token])

  async function oeffne(art: 'dokument' | 'rechnung', id: string) {
    if (!token) return
    setFehler('')
    // Fenster sofort öffnen (sonst blockt der Browser es nach dem Warten), Adresse danach setzen.
    const fenster = window.open('', '_blank')
    try {
      const url = await holeKundenPortalDatei(token, art, id)
      if (fenster) fenster.location.href = url
      else window.location.href = url
    } catch (e) {
      fenster?.close()
      setFehler(e instanceof Error ? e.message : 'Das Dokument lässt sich gerade nicht öffnen.')
    }
  }

  if (!seite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    )
  }

  if (seite.stufe !== 'frei') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <Lock className="mx-auto mb-3 text-slate-400" size={32} />
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Kein Zugang</h1>
          <p className="text-sm text-slate-500">{seite.grund}</p>
        </Card>
      </div>
    )
  }

  const s = seite
  const offeneUnterschriften = s.unterschriften.filter((u) => u.status === 'offen')
  const fertigeUnterschriften = s.unterschriften.filter((u) => u.status === 'unterschrieben')

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Kopf />
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-800">Ihr Kundenbereich</h1>
          <p className="mt-1 text-sm text-slate-500">{[s.bereich, ...s.leistungen].filter(Boolean).join(' · ')}</p>
        </div>

        {s.hinweis && <p className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{s.hinweis}</p>}

        {/* Stand */}
        <Card className="p-5">
          <p className="text-base text-slate-800">{s.anrede.replace(/,\s*$/, '')}</p>
          <div className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-sm ${s.ampel === 'gelb' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
            <span className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ${s.ampel === 'gelb' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
            <span>{s.ampelText}</span>
          </div>
          {s.stand && (
            <div className="mt-4">
              <p className="text-sm font-medium text-slate-700">{s.stand.text}</p>
              {!s.stand.abgeschlossen && (
                <>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={s.stand.schritte} aria-valuenow={s.stand.schritt}>
                    <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.round((s.stand.schritt / s.stand.schritte) * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">Schritt {s.stand.schritt} von {s.stand.schritte}</p>
                </>
              )}
            </div>
          )}
          {s.naechste.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-sm font-semibold text-slate-700">Die nächsten Schritte</h3>
              <Liste zeilen={s.naechste} />
            </div>
          )}
          {s.erledigt.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-sm font-semibold text-slate-700">Was zuletzt passiert ist</h3>
              <Liste zeilen={s.erledigt} />
            </div>
          )}
        </Card>

        {/* Was wir von Ihnen brauchen */}
        {(s.vonIhnen.length > 0 || s.unterlagen.hochladenToken) && (
          <Abschnitt titel="Was wir noch von Ihnen brauchen" symbol={<Upload size={18} />}>
            {s.unterlagen.fehlend.length > 0 && (
              <ul className="space-y-2">
                {s.unterlagen.fehlend.map((u) => (
                  <li key={u.name} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 p-3">
                    <Circle size={16} className="flex-shrink-0 text-amber-500" />
                    <span className="min-w-0 flex-1 text-sm text-slate-700">{u.name}</span>
                    {u.token ? (
                      <Link to={`/formular/unterlagen/${u.token}`} className={`${knopf} bg-accent-600 text-white hover:bg-accent-700`}>
                        <Upload size={16} /> Hochladen
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500">Bitte per E-Mail schicken oder bei uns nach einem neuen Hochlade-Link fragen.</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(() => {
              // Was nicht schon als Unterlage oder Unterschrift oben/unten steht (z. B. Rückmeldung zu einem Angebot).
              const unterlagen = new Set(s.unterlagen.fehlend.map((u) => u.name))
              const sonst = s.vonIhnen.filter((z) => !unterlagen.has(z) && !z.startsWith('Ihre Unterschrift:'))
              return sonst.length > 0 ? <div className="mt-3"><Liste zeilen={sonst} /></div> : null
            })()}
            {offeneUnterschriften.length > 0 && <p className="mt-3 text-sm text-slate-600">Dazu {offeneUnterschriften.length === 1 ? 'ein Dokument' : `${offeneUnterschriften.length} Dokumente`} zum Unterschreiben — siehe unten.</p>}
            {s.unterlagen.hochladenToken && (
              <Link to={`/formular/unterlagen/${s.unterlagen.hochladenToken}`} className={`${knopf} mt-3 w-full border-2 border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
                <Upload size={16} /> Weitere Unterlagen hochladen
              </Link>
            )}
          </Abschnitt>
        )}

        {/* Unterschriften */}
        {s.unterschriften.length > 0 && (
          <Abschnitt titel="Zum Unterschreiben" symbol={<PenLine size={18} />}>
            <ul className="space-y-2">
              {offeneUnterschriften.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-100 bg-amber-50/40 p-3">
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-700">
                    {u.titel}
                    {u.gueltigBis && <span className="block text-xs font-normal text-slate-500">bitte bis {datumDe(u.gueltigBis)}</span>}
                  </span>
                  <Link to={`/formular/unterschrift/${u.token}`} className={`${knopf} bg-accent-600 text-white hover:bg-accent-700`}>
                    <PenLine size={16} /> Jetzt unterschreiben
                  </Link>
                </li>
              ))}
              {fertigeUnterschriften.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 p-3">
                  <CheckCircle2 size={16} className="flex-shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1 text-sm text-slate-700">
                    {u.titel}
                    {u.unterschriebenAm && <span className="block text-xs text-slate-500">unterschrieben am {datumDe(u.unterschriebenAm)}</span>}
                  </span>
                  <Link to={`/formular/unterschrift/${u.token}`} className="text-sm font-medium text-accent-700 hover:underline">Ansehen</Link>
                </li>
              ))}
            </ul>
          </Abschnitt>
        )}

        {/* Termine */}
        {s.termine.length > 0 && (
          <Abschnitt titel="Ihre Termine" symbol={<CalendarDays size={18} />}>
            <ul className="divide-y divide-slate-100">
              {s.termine.map((t) => (
                <li key={t.id} className="py-2.5 text-sm">
                  <p className="font-medium text-slate-800">{terminText(t)}</p>
                  <p className="text-slate-600">{t.titel}{t.ort ? ` · ${t.ort}` : ''}</p>
                </li>
              ))}
            </ul>
          </Abschnitt>
        )}

        {/* Dokumente */}
        {s.dokumente.length > 0 && (
          <Abschnitt titel="Ihre Dokumente" symbol={<FileText size={18} />}>
            <ul className="divide-y divide-slate-100">
              {s.dokumente.map((d) => (
                <li key={d.id}>
                  <button onClick={() => oeffne('dokument', d.id)} className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:bg-slate-50">
                    <FileText size={18} className="shrink-0 text-accent-600" />
                    <span className="min-w-0 flex-1 text-slate-700">{d.name}</span>
                    <span className="text-xs text-slate-400">{datumDe(d.datum)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Abschnitt>
        )}

        {/* Rechnungen */}
        {s.rechnungen.length > 0 && (
          <Abschnitt titel="Ihre Rechnungen" symbol={<Receipt size={18} />}>
            <ul className="divide-y divide-slate-100">
              {s.rechnungen.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800">Rechnung Nr. {r.nummer}</span>
                    <span className="block text-xs text-slate-500">
                      {datumDe(r.datum)}
                      {r.betrag !== null ? ` · ${fmtEURCent(r.betrag)}` : ''}
                      {r.stand !== 'bezahlt' && r.faelligAm ? ` · fällig am ${datumDe(r.faelligAm)}` : ''}
                    </span>
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${RECHNUNG_TEXT[r.stand].farbe}`}>{RECHNUNG_TEXT[r.stand].text}</span>
                  {r.mitPdf && (
                    <button onClick={() => oeffne('rechnung', r.id)} className="inline-flex items-center gap-1 text-sm font-medium text-accent-700 hover:underline">
                      <FileText size={14} /> PDF
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Abschnitt>
        )}

        {fehler && <p className="rounded-lg bg-rose-50 p-3 text-sm font-medium text-rose-700">{fehler}</p>}

        {token && <Nachricht token={token} stand={s.nachricht} onSeite={setSeite} />}

        {/* Ansprechpartner */}
        {s.kontakt && (
          <Abschnitt titel="Ihr Ansprechpartner" symbol={<UserRound size={18} />}>
            <p className="text-sm font-medium text-slate-800">{s.kontakt.name}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {s.kontakt.telefon && (
                <a href={`tel:${s.kontakt.telefon.replace(/[^\d+]/g, '')}`} className={`${knopf} border-2 border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
                  <Phone size={16} /> {s.kontakt.telefon}
                </a>
              )}
              {s.kontakt.email && (
                <a href={`mailto:${s.kontakt.email}`} className={`${knopf} border-2 border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
                  <Mail size={16} /> {s.kontakt.email}
                </a>
              )}
            </div>
          </Abschnitt>
        )}

        <p className="text-center text-xs text-slate-400">
          Dieser Link ist nur für Sie bestimmt und bis zum {datumDe(s.gueltigBis)} gültig. Bitte geben Sie ihn nicht weiter.
        </p>
        <DatenschutzHinweis />
      </div>
    </div>
  )
}

/** „Nachricht an uns“: landet in Ihrer Akte bei uns; der Ansprechpartner bekommt Bescheid. */
function Nachricht({ token, stand, onSeite }: { token: string; stand: Frei['nachricht']; onSeite: (s: KundenPortalSeite) => void }) {
  const [text, setText] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')

  async function senden() {
    if (laeuft || text.trim().length < 3) return
    setLaeuft(true)
    setFehler('')
    try {
      const s = await sendeKundenPortalNachricht(token, text)
      setText('')
      onSeite(s)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Die Nachricht konnte nicht gesendet werden. Bitte versuchen Sie es später erneut.')
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <Abschnitt titel="Nachricht an uns" symbol={<MessageSquare size={18} />}>
      {stand.moeglich ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 2000))}
            rows={4}
            placeholder="Ihre Frage oder Nachricht …"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-accent-400 focus:outline-none focus:ring-2 focus:ring-accent-100"
          />
          {fehler && <p className="mt-1 text-sm font-medium text-rose-600">{fehler}</p>}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">Ihre Nachricht landet direkt bei Ihrem Ansprechpartner.</span>
            <PrimaryButton disabled={laeuft || text.trim().length < 3} onClick={senden}>
              {laeuft ? 'Wird gesendet …' : 'Nachricht senden'}
            </PrimaryButton>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-600">{stand.grund}</p>
      )}
    </Abschnitt>
  )
}
