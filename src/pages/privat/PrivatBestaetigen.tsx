import { useEffect, useState } from 'react'
import { Check, PauseCircle, RefreshCw, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useMsStatus } from '../../lib/microsoftKonto'
import { bestaetigeVormerkungen, ladeVormerkungen, verwerfeVormerkungen, type Vormerkung } from '../../lib/vormerkungen'
import { fmtDateTime } from '../../lib/dates'
import { PrimaryButton, SecondaryButton } from '../../components/ui'

/**
 * Bereich Privat → Zu bestätigen: was der Assistent vorgemerkt hat (Mails senden, Löschen, Einladungen).
 * Ausgeführt wird erst nach Häkchen + „Ausführen“ (oder per Knopf in Telegram).
 */
export function PrivatBestaetigen() {
  const { ansichtAls, session } = useAuth()
  const { status } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())
  if (ansichtAls) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Wird in dieser Ansicht nicht gezeigt.</div>
  if (!status) return <p className="text-sm text-slate-400">Wird geladen …</p>
  if (!status.erlaubt) return <p className="text-sm text-slate-500">Für dein Konto nicht freigeschaltet.</p>
  return <Inhalt />
}

function Inhalt() {
  const [liste, setListe] = useState<Vormerkung[] | null>(null)
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set())
  const [arbeitet, setArbeitet] = useState(false)
  const [meldungen, setMeldungen] = useState<string[]>([])
  const [fehler, setFehler] = useState('')

  const lade = async () => {
    try {
      const l = await ladeVormerkungen()
      setListe(l)
      setGewaehlt(new Set(l.filter((v) => v.status === 'offen').map((v) => v.id)))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => {
    lade()
  }, [])

  const offen = (liste ?? []).filter((v) => v.status === 'offen' || v.status === 'laeuft')
  const erledigt = (liste ?? []).filter((v) => v.status !== 'offen' && v.status !== 'laeuft').slice(0, 15)

  async function ausfuehren() {
    const ids = [...gewaehlt]
    if (!ids.length) return
    if (!window.confirm(`${ids.length} Aktion(en) jetzt wirklich ausführen? Gesendete Mails lassen sich nicht zurückholen.`)) return
    setArbeitet(true)
    setFehler('')
    try {
      const e = await bestaetigeVormerkungen(ids)
      setMeldungen(e.map((x) => `${x.ok ? '✓' : '✗'} ${x.beschreibung || x.id}: ${x.meldung}`))
      await lade()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
    } finally {
      setArbeitet(false)
    }
  }

  async function verwerfen() {
    const ids = [...gewaehlt]
    if (!ids.length) return
    setArbeitet(true)
    setFehler('')
    try {
      const n = await verwerfeVormerkungen(ids)
      setMeldungen([`${n} verworfen — nichts wurde ausgeführt.`])
      await lade()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Zu bestätigen</h1>
          <p className="text-sm text-slate-500">Mails senden, Löschen und Einladungen führt der Assistent erst aus, wenn du hier (oder per Knopf in Telegram) bestätigst.</p>
        </div>
        <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Neu laden" onClick={lade}>
          <RefreshCw size={16} />
        </button>
      </div>

      {meldungen.length > 0 && (
        <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {meldungen.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      )}
      {fehler && <p className="text-sm text-rose-600">{fehler}</p>}
      {liste === null && !fehler && <p className="text-sm text-slate-400">Wird geladen …</p>}
      {liste && offen.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Nichts zu bestätigen.</p>}

      {offen.length > 0 && (
        <section className="space-y-3">
          {offen.map((v) => (
            <label key={v.id} className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <input
                type="checkbox"
                className="mt-1"
                checked={gewaehlt.has(v.id)}
                disabled={v.status === 'laeuft'}
                onChange={(e) =>
                  setGewaehlt((alt) => {
                    const neu = new Set(alt)
                    if (e.target.checked) neu.add(v.id)
                    else neu.delete(v.id)
                    return neu
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <PauseCircle size={15} className="text-amber-500" /> {v.beschreibung}
                </div>
                <div className="text-xs text-slate-400">
                  {fmtDateTime(v.erstellt_am)} · {v.quelle === 'assistent' ? 'vom Assistenten' : 'aus dem CRM'}
                  {v.status === 'laeuft' && ' · wird gerade ausgeführt'}
                </div>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 font-sans text-xs text-slate-700">{v.vorschau}</pre>
                {v.ergebnis && <div className="mt-1 text-xs text-rose-600">{v.ergebnis}</div>}
              </div>
            </label>
          ))}
          <div className="flex gap-2">
            <PrimaryButton onClick={ausfuehren} disabled={arbeitet || gewaehlt.size === 0}>
              <Check size={15} /> {arbeitet ? 'Läuft …' : `Ausführen (${gewaehlt.size})`}
            </PrimaryButton>
            <SecondaryButton onClick={verwerfen} disabled={arbeitet || gewaehlt.size === 0}>
              <X size={15} /> Verwerfen
            </SecondaryButton>
          </div>
        </section>
      )}

      {erledigt.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-600">Zuletzt erledigt</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {erledigt.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="truncate text-slate-700">{v.beschreibung}</span>
                <span className={`shrink-0 text-xs ${v.status === 'ausgefuehrt' ? 'text-emerald-700' : 'text-slate-400'}`}>
                  {v.status === 'ausgefuehrt' ? 'ausgeführt' : v.status === 'verworfen' ? 'verworfen' : v.status} {v.erledigt_am ? fmtDateTime(v.erledigt_am) : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
