import { useState } from 'react'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { uid } from '../lib/dates'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton, EmptyState } from './ui'
import type { FragenkatalogFrage, FragenkatalogFragetyp, KundeBereich } from '../types'

const TYP_LABEL: Record<FragenkatalogFragetyp, string> = {
  text: 'Freitext',
  zahl: 'Zahl',
  auswahl: 'Auswahl',
  checkbox: 'Ja/Nein',
}

type Entwurf = { text: string; typ: FragenkatalogFragetyp; optionenText: string; pflichtfeld: boolean }
const LEER: Entwurf = { text: '', typ: 'text', optionenText: '', pflichtfeld: false }

// Fragenkatalog-Editor (Selbstauskunft) für einen Bereich — Liste/Editor-Modal analog zu
// MailVorlagenModal. Die Fragen landen in state.fragenkataloge und werden von PublicSelbstauskunft
// gerendert, wenn ein Mitarbeiter einem Kunden den Selbstauskunft-Link schickt.
export function FragenkatalogModal({ open, onClose, bereich }: { open: boolean; onClose: () => void; bereich: KundeBereich }) {
  const { state, dispatch } = useApp()
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null)
  const [form, setForm] = useState<Entwurf>(LEER)
  const [formOffen, setFormOffen] = useState(false)

  const fragen = state.fragenkataloge.filter((f) => f.bereich === bereich)

  function neu() {
    setBearbeiteId(null)
    setForm(LEER)
    setFormOffen(true)
  }

  function bearbeiten(f: FragenkatalogFrage) {
    setBearbeiteId(f.id)
    setForm({ text: f.text, typ: f.typ, optionenText: (f.optionen ?? []).join(', '), pflichtfeld: f.pflichtfeld })
    setFormOffen(true)
  }

  function speichern() {
    if (!form.text.trim()) return
    const optionen = form.typ === 'auswahl' ? form.optionenText.split(',').map((o) => o.trim()).filter(Boolean) : undefined
    if (bearbeiteId) {
      dispatch({ type: 'UPDATE_FRAGE', id: bearbeiteId, patch: { text: form.text, typ: form.typ, optionen, pflichtfeld: form.pflichtfeld } })
    } else {
      dispatch({ type: 'ADD_FRAGE', frage: { id: uid('fk'), bereich, text: form.text, typ: form.typ, optionen, pflichtfeld: form.pflichtfeld } })
    }
    setFormOffen(false)
  }

  function loeschen(id: string) {
    if (confirm('Diese Frage wirklich löschen?')) dispatch({ type: 'DELETE_FRAGE', id })
  }

  function handleClose() {
    setFormOffen(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Fragenkatalog (Selbstauskunft)" width="max-w-xl">
      {!formOffen ? (
        <div>
          <p className="mb-3 text-xs text-slate-500">
            Diese Fragen erscheinen im Selbstauskunft-Formular, das einem Kunden/Mandanten aus der Kundenakte geschickt werden kann.
          </p>
          <div className="mb-3 space-y-2">
            {fragen.length === 0 && <EmptyState text="Noch keine Fragen angelegt." />}
            {fragen.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{f.text}{f.pflichtfeld && ' *'}</p>
                  <p className="truncate text-xs text-slate-500">{TYP_LABEL[f.typ]}{f.optionen ? `: ${f.optionen.join(', ')}` : ''}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button onClick={() => bearbeiten(f)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600" title="Bearbeiten">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => loeschen(f.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Löschen">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <PrimaryButton onClick={neu} className="text-xs">
              <Plus size={13} /> Neue Frage
            </PrimaryButton>
            <SecondaryButton onClick={handleClose}>Schließen</SecondaryButton>
          </div>
        </div>
      ) : (
        <div>
          <Field label="Frage">
            <input className={inputClass} value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} placeholder="z. B. Familienstand" />
          </Field>
          <Field label="Antworttyp">
            <select className={inputClass} value={form.typ} onChange={(e) => setForm((f) => ({ ...f, typ: e.target.value as FragenkatalogFragetyp }))}>
              {(Object.keys(TYP_LABEL) as FragenkatalogFragetyp[]).map((t) => <option key={t} value={t}>{TYP_LABEL[t]}</option>)}
            </select>
          </Field>
          {form.typ === 'auswahl' && (
            <Field label="Optionen (durch Komma getrennt)">
              <input className={inputClass} value={form.optionenText} onChange={(e) => setForm((f) => ({ ...f, optionenText: e.target.value }))} placeholder="z. B. Ledig, Verheiratet, Geschieden" />
            </Field>
          )}
          <label className="mb-3 mt-1 flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" className="rounded" checked={form.pflichtfeld} onChange={(e) => setForm((f) => ({ ...f, pflichtfeld: e.target.checked }))} />
            Pflichtfeld
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <SecondaryButton onClick={() => setFormOffen(false)}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={speichern} disabled={!form.text.trim()}>Speichern</PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  )
}
