import { useState } from 'react'
import { meldeFrage } from '../lib/assistentServer'
import { Link } from 'react-router-dom'
import { MessageCircleQuestion, Pencil, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { Card, EmptyState, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { CURRENT_USER } from '../data/constants'
import { fmtDate, today, uid } from '../lib/dates'
import type { ImmoFrage, Objekt } from '../types'

type Prio = ImmoFrage['prio']

/** Wer ist angemeldet, und darf er antworten? Antworten (und jede Frage löschen) dürfen nur die
 *  Geschäftsführung und Admins — gleiche Prüfung wie beim Löschen einer Kundenakte. */
export function useFragenRechte(): { wer: string; darfAntworten: boolean } {
  const { state } = useApp()
  const { session, mitarbeiter } = useAuth()
  const darfAntworten = isSupabaseConfigured && session ? mitarbeiter?.rolle === 'geschaeftsfuehrung' || !!mitarbeiter?.ist_admin : state.rolle === 'geschaeftsfuehrung'
  return { wer: mitarbeiter?.name ?? CURRENT_USER, darfAntworten }
}

export function istBeantwortet(f: ImmoFrage): boolean {
  return !!f.antwort?.trim()
}

/** Offene Fragen zuerst, danach die beantworteten — jeweils die neueste oben. Bei gleichem Datum bleibt
 *  die Reihenfolge aus dem Bestand erhalten (dort steht die zuletzt gestellte Frage vorn). */
export function sortiereFragen(fragen: ImmoFrage[]): ImmoFrage[] {
  return [...fragen].sort((a, b) => Number(istBeantwortet(a)) - Number(istBeantwortet(b)) || b.erstelltAm.localeCompare(a.erstelltAm))
}

/** Die drei kleinen Knöpfe A / B / C wie auf dem Papierformular. Ein zweiter Klick nimmt die Wahl zurück. */
export function PrioWahl({ wert, onChange }: { wert: Prio; onChange: (p: Prio) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Priorität">
      <span className="mr-1 text-xs font-medium text-slate-500">Prio</span>
      {(['A', 'B', 'C'] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(wert === p ? undefined : p)}
          className={`h-8 w-8 rounded-lg border text-sm font-semibold ${wert === p ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`}
          aria-pressed={wert === p}
        >
          {p}
        </button>
      ))}
    </div>
  )
}

const kleinerKnopf = 'rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50'
const symbolKnopf = 'rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600'

/** Eine Frage mit allem, was dazugehört: wer hat wann gefragt, was hat die Geschäftsführung geantwortet.
 *  Wird im Reiter „Fragen" eines Objekts und in der Gesamtliste verwendet (dort mit `zeigeBezug`). */
export function FrageKarte({ frage, zeigeBezug = false }: { frage: ImmoFrage; zeigeBezug?: boolean }) {
  const { state, dispatch } = useApp()
  const { wer, darfAntworten } = useFragenRechte()
  const [modus, setModus] = useState<'antwort' | 'bearbeiten' | null>(null)
  const [antwortText, setAntwortText] = useState('')
  const [frageText, setFrageText] = useState('')
  const [prio, setPrio] = useState<Prio>(undefined)

  const beantwortet = istBeantwortet(frage)
  const eigeneOffene = frage.gestelltVon === wer && !beantwortet
  const darfLoeschen = darfAntworten || eigeneOffene
  const objekt = frage.objektId ? state.objekte.find((o) => o.id === frage.objektId) : undefined
  const bezug = objekt?.bezeichnung || frage.bezug.trim() || 'Allgemein'

  function antwortOeffnen() {
    setAntwortText(frage.antwort ?? '')
    setModus('antwort')
  }

  function antwortSpeichern() {
    const text = antwortText.trim()
    if (!text) return
    dispatch({ type: 'SPEICHERE_FRAGE', frage: { ...frage, antwort: text, beantwortetVon: wer, beantwortetAm: today() } })
    meldeFrage(frage.id, 'antwort')
    setModus(null)
  }

  function bearbeitenOeffnen() {
    setFrageText(frage.frage)
    setPrio(frage.prio)
    setModus('bearbeiten')
  }

  function frageSpeichern() {
    const text = frageText.trim()
    if (!text) return
    dispatch({ type: 'SPEICHERE_FRAGE', frage: { ...frage, frage: text, prio } })
    setModus(null)
  }

  function loeschen() {
    const hinweis = beantwortet ? 'Frage samt Antwort löschen? Das lässt sich nicht rückgängig machen.' : 'Frage löschen?'
    if (!window.confirm(`${hinweis}\n\n„${frage.frage.slice(0, 120)}${frage.frage.length > 120 ? ' …' : ''}“`)) return
    dispatch({ type: 'LOESCHE_FRAGE', id: frage.id })
  }

  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
            {frage.prio && <span className="rounded bg-accent-50 px-1.5 py-0.5 font-semibold text-accent-700">Prio {frage.prio}</span>}
            <span className={`rounded-full px-2 py-0.5 font-medium ${beantwortet ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{beantwortet ? 'beantwortet' : 'offen'}</span>
            {zeigeBezug &&
              (objekt ? (
                <Link to={`/immobilien/objekte/${objekt.id}?tab=fragen`} className="font-medium text-accent-600 hover:underline">
                  {bezug}
                </Link>
              ) : (
                <span className="font-medium text-slate-600">{bezug}</span>
              ))}
          </div>

          {modus === 'bearbeiten' ? (
            <div>
              <textarea className={`${inputClass} min-h-20`} value={frageText} onChange={(e) => setFrageText(e.target.value)} aria-label="Frage ändern" autoFocus />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <PrioWahl wert={prio} onChange={setPrio} />
                <div className="flex items-center gap-2">
                  <SecondaryButton onClick={() => setModus(null)}>Abbrechen</SecondaryButton>
                  <PrimaryButton onClick={frageSpeichern} disabled={!frageText.trim()}>
                    Speichern
                  </PrimaryButton>
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words text-sm font-medium text-slate-800">{frage.frage}</p>
              <div className="mt-0.5 text-xs text-slate-400">
                gefragt von {frage.gestelltVon || 'unbekannt'} am {fmtDate(frage.erstelltAm)}
              </div>
            </>
          )}
        </div>

        {modus === null && (eigeneOffene || darfLoeschen) && (
          <div className="flex items-center gap-1">
            {eigeneOffene && (
              <button onClick={bearbeitenOeffnen} className={symbolKnopf} title="Frage ändern" aria-label="Frage ändern">
                <Pencil size={13} />
              </button>
            )}
            {darfLoeschen && (
              <button onClick={loeschen} className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Frage löschen" aria-label="Frage löschen">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {modus === 'antwort' ? (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <textarea
            className={`${inputClass} min-h-24`}
            value={antwortText}
            onChange={(e) => setAntwortText(e.target.value)}
            placeholder="Antwort der Geschäftsführung …"
            aria-label="Antwort der Geschäftsführung"
            autoFocus
          />
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <SecondaryButton onClick={() => setModus(null)}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={antwortSpeichern} disabled={!antwortText.trim()}>
              Antwort speichern
            </PrimaryButton>
          </div>
        </div>
      ) : beantwortet ? (
        <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2">
          <div className="mb-0.5 text-xs font-medium text-emerald-700">Antwort der Geschäftsführung</div>
          <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{frage.antwort}</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              beantwortet von {frage.beantwortetVon || 'unbekannt'}
              {frage.beantwortetAm ? ` am ${fmtDate(frage.beantwortetAm)}` : ''}
            </span>
            {darfAntworten && modus === null && (
              <button onClick={antwortOeffnen} className={`${kleinerKnopf} bg-white`}>
                Antwort ändern
              </button>
            )}
          </div>
        </div>
      ) : (
        modus === null && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <span className="text-xs font-medium text-amber-600">wartet auf Antwort der Geschäftsführung</span>
            {darfAntworten && (
              <button onClick={antwortOeffnen} className="rounded-md border border-accent-300 bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100">
                Antworten
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
}

/** Reiter „Fragen" am Objekt: Was beim Objekt unklar ist, geht als Frage an die Geschäftsführung.
 *  Frage und Antwort bleiben hier dauerhaft stehen. Vorlage: Papierformular „Fragenkatalog"
 *  (Spalten Datum, Prio, Frage, Antworten). */
export function ObjektFragenSection({ objekt }: { objekt: Objekt }) {
  const { state, dispatch } = useApp()
  const { wer } = useFragenRechte()
  const [text, setText] = useState('')
  const [prio, setPrio] = useState<Prio>(undefined)

  const fragen = sortiereFragen(state.immoFragen.filter((f) => f.objektId === objekt.id))
  const offen = fragen.filter((f) => !istBeantwortet(f)).length

  function stellen() {
    const frage = text.trim()
    if (!frage) return
    const id = uid('frage')
    dispatch({
      type: 'SPEICHERE_FRAGE',
      frage: { id, erstelltAm: today(), prio, objektId: objekt.id, bezug: objekt.bezeichnung, frage, gestelltVon: wer },
    })
    meldeFrage(id, 'neu')
    setText('')
    setPrio(undefined)
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <MessageCircleQuestion size={14} /> Fragen an die Geschäftsführung
          </h3>
          <p className="text-xs text-slate-400">Was bei diesem Objekt unklar ist, stellst du hier als Frage. Frage und Antwort bleiben beim Objekt stehen.</p>
        </div>
        <Field label="Neue Frage">
          <textarea className={`${inputClass} min-h-20`} value={text} onChange={(e) => setText(e.target.value)} placeholder="z. B. Dürfen wir beim Preis entgegenkommen?" />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PrioWahl wert={prio} onChange={setPrio} />
          <PrimaryButton onClick={stellen} disabled={!text.trim()}>
            Frage stellen
          </PrimaryButton>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Bisherige Fragen</h3>
          {fragen.length > 0 && (
            <p className="text-xs text-slate-400">
              {offen} offen · {fragen.length - offen} beantwortet
            </p>
          )}
        </div>
        {fragen.length === 0 ? (
          <EmptyState text="Zu diesem Objekt wurde noch keine Frage gestellt." />
        ) : (
          <div className="space-y-3">
            {fragen.map((f) => (
              <FrageKarte key={f.id} frage={f} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
