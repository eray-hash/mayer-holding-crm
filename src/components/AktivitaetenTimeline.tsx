import { useState } from 'react'
import { Pencil, Trash2, Check, X, Plus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { EmptyState, inputClass } from './ui'
import { CURRENT_USER } from '../data/constants'
import { fmtDate, today, uid } from '../lib/dates'
import type { ActivityEntry, Kunde, KundeBereich } from '../types'

// Die Timeline war in allen Akten nur lesbar: eine falsch abgelegte Notiz (z.B. per Telegram beim
// falschen Kunden gelandet) ließ sich im CRM weder korrigieren noch entfernen, und eine eigene Notiz
// konnte man gar nicht von Hand eintragen. Schreibt über die generische UPDATE_KUNDE_IN_BEREICH-Aktion,
// funktioniert also identisch in allen Bereichen.
export function AktivitaetenTimeline({ bereich, kunde }: { bereich: KundeBereich; kunde: Kunde }) {
  const { dispatch } = useApp()
  const [neueNotiz, setNeueNotiz] = useState('')
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null)
  const [entwurf, setEntwurf] = useState('')
  const [loeschenId, setLoeschenId] = useState<string | null>(null)

  function speichereActivities(activities: ActivityEntry[], weitere: Partial<Kunde> = {}) {
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kunde.id, patch: { activities, ...weitere } })
  }

  function hinzufuegen() {
    const text = neueNotiz.trim()
    if (!text) return
    speichereActivities([{ id: uid('act'), date: today(), text, user: CURRENT_USER }, ...kunde.activities], { letzteAktivitaet: today() })
    setNeueNotiz('')
  }

  function bearbeitenOeffnen(a: ActivityEntry) {
    setLoeschenId(null)
    setBearbeiteId(a.id)
    setEntwurf(a.text)
  }

  function bearbeitungSpeichern() {
    const text = entwurf.trim()
    if (!text || !bearbeiteId) return
    speichereActivities(kunde.activities.map((a) => (a.id === bearbeiteId ? { ...a, text } : a)))
    setBearbeiteId(null)
  }

  function loeschen(id: string) {
    speichereActivities(kunde.activities.filter((a) => a.id !== id))
    setLoeschenId(null)
  }

  return (
    <div>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          hinzufuegen()
        }}
      >
        <input
          className={inputClass}
          placeholder="Notiz hinzufügen …"
          value={neueNotiz}
          onChange={(e) => setNeueNotiz(e.target.value)}
        />
        <button
          type="submit"
          disabled={!neueNotiz.trim()}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={13} /> Hinzufügen
        </button>
      </form>

      <ul className="space-y-3">
        {kunde.activities.map((a) => (
          <li key={a.id} className="group flex gap-3 text-sm">
            <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-400" />
            {bearbeiteId === a.id ? (
              <div className="min-w-0 flex-1">
                <textarea
                  className={inputClass}
                  rows={2}
                  autoFocus
                  value={entwurf}
                  onChange={(e) => setEntwurf(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setBearbeiteId(null)
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) bearbeitungSpeichern()
                  }}
                />
                <div className="mt-1.5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBearbeiteId(null)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={bearbeitungSpeichern}
                    disabled={!entwurf.trim()}
                    className="flex items-center gap-1 rounded-md bg-accent-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-700 disabled:opacity-40"
                  >
                    <Check size={13} /> Speichern
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap break-words text-slate-700">{a.text}</div>
                  <div className="text-xs text-slate-400">{fmtDate(a.date)} · {a.user}</div>
                </div>
                {loeschenId === a.id ? (
                  <div className="flex flex-shrink-0 items-start gap-1">
                    <button
                      type="button"
                      onClick={() => loeschen(a.id)}
                      className="rounded-md bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700"
                    >
                      Wirklich löschen?
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoeschenId(null)}
                      aria-label="Löschen abbrechen"
                      className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-shrink-0 items-start gap-0.5 text-slate-300 group-hover:text-slate-400">
                    <button
                      type="button"
                      onClick={() => bearbeitenOeffnen(a)}
                      aria-label="Eintrag bearbeiten"
                      title="Bearbeiten"
                      className="rounded-md p-1 hover:bg-slate-100 hover:text-accent-600"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBearbeiteId(null)
                        setLoeschenId(a.id)
                      }}
                      aria-label="Eintrag löschen"
                      title="Löschen"
                      className="rounded-md p-1 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
        {kunde.activities.length === 0 && <EmptyState text="Keine Aktivitäten." />}
      </ul>
    </div>
  )
}
