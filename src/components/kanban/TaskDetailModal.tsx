import { useState } from 'react'
import { Bot } from 'lucide-react'
import type { Aufgabe, AufgabenStatus } from '../../types/project'
import { AUFGABEN_STATUS_LABEL, AUFGABEN_STATUS_ORDER } from '../../types/project'
import { PRIORITAETEN } from '../../data/constants'
import type { Prioritaet } from '../../types'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton } from '../ui'

export function TaskDetailModal({
  aufgabe,
  onClose,
  onSave,
}: {
  aufgabe: Aufgabe
  onClose: () => void
  onSave: (patch: Partial<Aufgabe>) => void
}) {
  const [draft, setDraft] = useState<Aufgabe>(aufgabe)

  function field<K extends keyof Aufgabe>(key: K, value: Aufgabe[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  function save() {
    onSave(draft)
    onClose()
  }

  function toggleClaudeHandoff() {
    onSave({ fuerClaude: !draft.fuerClaude })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="Aufgabe" width="max-w-2xl">
      <input
        value={draft.titel}
        onChange={(e) => field('titel', e.target.value)}
        className="mb-2 w-full border-b border-slate-100 bg-transparent pb-2 text-lg font-semibold text-slate-800 outline-none focus:border-accent-300"
      />

      <button
        type="button"
        onClick={toggleClaudeHandoff}
        className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
          draft.fuerClaude ? 'bg-accent-100 text-accent-700 hover:bg-accent-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        <Bot size={13} /> {draft.fuerClaude ? 'An Claude übergeben — zurücknehmen' : 'An Claude übergeben'}
      </button>

      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Status">
          <select value={draft.status} onChange={(e) => field('status', e.target.value as AufgabenStatus)} className={inputClass}>
            {AUFGABEN_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{AUFGABEN_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </Field>
        <Field label="Priorität">
          <select value={draft.prioritaet} onChange={(e) => field('prioritaet', e.target.value as Prioritaet)} className={inputClass}>
            {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Unter-Prio (1-9)">
          <input
            type="number"
            min={1}
            max={9}
            value={draft.unterPrio ?? ''}
            onChange={(e) => field('unterPrio', e.target.value ? Number(e.target.value) : null)}
            className={inputClass}
          />
        </Field>
        <Field label="Start-Datum">
          <input type="date" value={draft.startDatum ?? ''} onChange={(e) => field('startDatum', e.target.value || null)} className={inputClass} />
        </Field>
        <Field label="Kunde/Projekt">
          <input value={draft.kunde ?? ''} onChange={(e) => field('kunde', e.target.value || null)} className={inputClass} />
        </Field>
        <Field label="Zuständig">
          <input value={draft.zustaendig ?? ''} onChange={(e) => field('zustaendig', e.target.value || null)} className={inputClass} />
        </Field>
        <Field label="Wiedervorlage">
          <input type="date" value={draft.wiedervorlage ?? ''} onChange={(e) => field('wiedervorlage', e.target.value || null)} className={inputClass} />
        </Field>
        <Field label="Erledigt am">
          <input type="date" value={draft.erledigtAm ?? ''} onChange={(e) => field('erledigtAm', e.target.value || null)} className={inputClass} />
        </Field>
        <Field label="Geplante Zeit (Std.)">
          <input
            type="number"
            value={draft.geplanteZeitStunden ?? ''}
            onChange={(e) => field('geplanteZeitStunden', e.target.value ? Number(e.target.value) : null)}
            className={inputClass}
          />
        </Field>
        <Field label="Ist-Zeit (Std.)">
          <input
            type="number"
            value={draft.istZeitStunden ?? ''}
            onChange={(e) => field('istZeitStunden', e.target.value ? Number(e.target.value) : null)}
            className={inputClass}
          />
        </Field>
        <Field label="Umsatz (€)">
          <input
            type="number"
            value={draft.umsatzEuro ?? ''}
            onChange={(e) => field('umsatzEuro', e.target.value ? Number(e.target.value) : null)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Nächster Schritt">
        <textarea value={draft.naechsterSchritt ?? ''} onChange={(e) => field('naechsterSchritt', e.target.value || null)} rows={2} className={inputClass} />
      </Field>
      <Field label="Offene Fragen">
        <textarea value={draft.fragen ?? ''} onChange={(e) => field('fragen', e.target.value || null)} rows={2} className={inputClass} />
      </Field>
      <Field label="Benötigte Informationen">
        <textarea value={draft.benoetigteInfos ?? ''} onChange={(e) => field('benoetigteInfos', e.target.value || null)} rows={2} className={inputClass} />
      </Field>
      <Field label="Protokoll (Gesprächsmitschrift)">
        <textarea value={draft.protokoll ?? ''} onChange={(e) => field('protokoll', e.target.value || null)} rows={3} className={inputClass} />
      </Field>

      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={save}>Speichern</PrimaryButton>
      </div>
    </Modal>
  )
}
