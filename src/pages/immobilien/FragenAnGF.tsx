import { useMemo, useState } from 'react'
import { meldeFrage } from '../../lib/assistentServer'
import { Plus, Search } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState, Field, inputClass, Modal, PrimaryButton, SecondaryButton } from '../../components/ui'
import { FrageKarte, istBeantwortet, PrioWahl, sortiereFragen, useFragenRechte } from '../../components/ObjektFragenSection'
import { today, uid } from '../../lib/dates'
import type { ImmoFrage, Objekt } from '../../types'

type Filter = 'offen' | 'beantwortet' | 'alle'

const FILTER: { id: Filter; label: string }[] = [
  { id: 'offen', label: 'offen' },
  { id: 'beantwortet', label: 'beantwortet' },
  { id: 'alle', label: 'alle' },
]

/** Alle Fragen der Immobilienabteilung an die Geschäftsführung auf einen Blick — zu Objekten und ohne Objekt.
 *  Die Geschäftsführung antwortet direkt in der Liste; nichts geht verloren, jede Frage bleibt mit ihrer
 *  Antwort stehen. Vorlage: Papierformular „Fragenkatalog" (Datum, Prio, Frage, Antworten). */
export function FragenAnGF() {
  const { state, dispatch } = useApp()
  const { wer, darfAntworten } = useFragenRechte()
  const [filter, setFilter] = useState<Filter>('offen')
  const [suche, setSuche] = useState('')
  const [neu, setNeu] = useState(false)

  const offenAnzahl = state.immoFragen.filter((f) => !istBeantwortet(f)).length
  const beantwortetAnzahl = state.immoFragen.length - offenAnzahl

  const fragen = useMemo(() => {
    const begriff = suche.trim().toLowerCase()
    const objektName = new Map(state.objekte.map((o) => [o.id, o.bezeichnung]))
    return sortiereFragen(
      state.immoFragen
        .filter((f) => filter === 'alle' || (filter === 'offen') !== istBeantwortet(f))
        .filter(
          (f) =>
            !begriff ||
            `${f.frage} ${f.antwort ?? ''} ${f.bezug} ${f.objektId ? (objektName.get(f.objektId) ?? '') : ''} ${f.gestelltVon} ${f.beantwortetVon ?? ''}`.toLowerCase().includes(begriff),
        ),
    )
  }, [state.immoFragen, state.objekte, filter, suche])

  const leerText =
    state.immoFragen.length === 0
      ? 'Noch keine Frage gestellt. Über „Neue Frage“ geht sie direkt an die Geschäftsführung.'
      : suche.trim()
        ? 'Keine Frage passt zu deiner Suche.'
        : filter === 'offen'
          ? 'Zurzeit ist keine Frage offen — alles beantwortet.'
          : 'Noch keine Frage beantwortet.'

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Fragen an die Geschäftsführung</h1>
          <p className="text-sm text-slate-500">
            {offenAnzahl} {offenAnzahl === 1 ? 'offene Frage' : 'offene Fragen'} · {beantwortetAnzahl} beantwortet
            {darfAntworten && offenAnzahl > 0 ? ' · du kannst direkt in der Liste antworten' : ''}
          </p>
        </div>
        <PrimaryButton onClick={() => setNeu(true)}>
          <Plus size={15} /> Neue Frage
        </PrimaryButton>
      </div>

      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-52 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} pl-8`} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Frage, Antwort, Objekt, Name …" aria-label="Fragen durchsuchen" />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Fragen filtern">
          {FILTER.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f.id ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              aria-pressed={filter === f.id}
            >
              {f.label}
              {f.id === 'offen' ? ` (${offenAnzahl})` : f.id === 'beantwortet' ? ` (${beantwortetAnzahl})` : ` (${state.immoFragen.length})`}
            </button>
          ))}
        </div>
      </Card>

      {fragen.length === 0 ? (
        <EmptyState text={leerText} />
      ) : (
        <Card className="space-y-3 p-3 sm:p-4">
          {fragen.map((f) => (
            <FrageKarte key={f.id} frage={f} zeigeBezug />
          ))}
        </Card>
      )}

      <Modal open={neu} onClose={() => setNeu(false)} title="Neue Frage an die Geschäftsführung">
        {neu && (
          <NeueFrage
            objekte={state.objekte}
            wer={wer}
            onAbbrechen={() => setNeu(false)}
            onSpeichern={(frage) => {
              dispatch({ type: 'SPEICHERE_FRAGE', frage })
              meldeFrage(frage.id, 'neu')
              // Die neue Frage ist offen — damit sie sofort zu sehen ist, nicht im Filter „beantwortet" bleiben.
              if (filter === 'beantwortet') setFilter('offen')
              setSuche('')
              setNeu(false)
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function NeueFrage({ objekte, wer, onSpeichern, onAbbrechen }: { objekte: Objekt[]; wer: string; onSpeichern: (frage: ImmoFrage) => void; onAbbrechen: () => void }) {
  const [objektId, setObjektId] = useState('')
  const [bezug, setBezug] = useState('')
  const [text, setText] = useState('')
  const [prio, setPrio] = useState<ImmoFrage['prio']>(undefined)
  const sortiert = [...objekte].sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de'))

  function speichern() {
    const frage = text.trim()
    if (!frage) return
    const objekt = objekte.find((o) => o.id === objektId)
    onSpeichern({
      id: uid('frage'),
      erstelltAm: today(),
      prio,
      objektId: objekt?.id,
      bezug: objekt ? objekt.bezeichnung : bezug.trim(),
      frage,
      gestelltVon: wer,
    })
  }

  return (
    <div>
      <Field label="Zu welchem Objekt? (kann leer bleiben)">
        <select className={inputClass} value={objektId} onChange={(e) => setObjektId(e.target.value)}>
          <option value="">ohne Objekt …</option>
          {sortiert.map((o) => (
            <option key={o.id} value={o.id}>
              {o.bezeichnung}
            </option>
          ))}
        </select>
      </Field>
      {objektId === '' && (
        <Field label="Kunde / Projekt">
          <input className={inputClass} value={bezug} onChange={(e) => setBezug(e.target.value)} placeholder="z. B. Familie Huber, Neubau Söflingen" />
        </Field>
      )}
      <Field label="Frage">
        <textarea className={`${inputClass} min-h-28`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Was soll die Geschäftsführung entscheiden oder klären?" />
      </Field>
      <div className="mb-4">
        <PrioWahl wert={prio} onChange={setPrio} />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SecondaryButton onClick={onAbbrechen}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={speichern} disabled={!text.trim()}>
          Frage stellen
        </PrimaryButton>
      </div>
    </div>
  )
}
