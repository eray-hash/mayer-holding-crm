import { useState } from 'react'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { uid } from '../lib/dates'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton, EmptyState } from './ui'
import type { MailVorlage } from '../types'

const LEER: Omit<MailVorlage, 'id'> = { name: '', betreff: '', text: '' }

export function MailVorlagenModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null)
  const [form, setForm] = useState<Omit<MailVorlage, 'id'>>(LEER)
  const [formOffen, setFormOffen] = useState(false)

  function neu() {
    setBearbeiteId(null)
    setForm(LEER)
    setFormOffen(true)
  }

  function bearbeiten(v: MailVorlage) {
    setBearbeiteId(v.id)
    setForm({ name: v.name, betreff: v.betreff, text: v.text })
    setFormOffen(true)
  }

  function speichern() {
    if (!form.name.trim() || !form.betreff.trim() || !form.text.trim()) return
    if (bearbeiteId) {
      dispatch({ type: 'UPDATE_MAIL_VORLAGE', id: bearbeiteId, patch: form })
    } else {
      dispatch({ type: 'ADD_MAIL_VORLAGE', vorlage: { id: uid('mv'), ...form } })
    }
    setFormOffen(false)
  }

  function loeschen(id: string) {
    if (confirm('Diese Mailvorlage wirklich löschen?')) dispatch({ type: 'DELETE_MAIL_VORLAGE', id })
  }

  function handleClose() {
    setFormOffen(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Mailvorlagen" width="max-w-xl">
      {!formOffen ? (
        <div>
          <p className="mb-3 text-xs text-slate-500">
            Platzhalter <code className="rounded bg-slate-100 px-1">{'{{firma}}'}</code> und{' '}
            <code className="rounded bg-slate-100 px-1">{'{{ansprechpartner}}'}</code> werden beim Versenden aus der Kundenakte automatisch ersetzt.
          </p>
          <div className="mb-3 space-y-2">
            {state.mailVorlagen.length === 0 && <EmptyState text="Noch keine Mailvorlagen angelegt." />}
            {state.mailVorlagen.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{v.name}</p>
                  <p className="truncate text-xs text-slate-500">{v.betreff}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button onClick={() => bearbeiten(v)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600" title="Bearbeiten">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => loeschen(v.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Löschen">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between">
            <PrimaryButton onClick={neu} className="text-xs">
              <Plus size={13} /> Neue Vorlage
            </PrimaryButton>
            <SecondaryButton onClick={handleClose}>Schließen</SecondaryButton>
          </div>
        </div>
      ) : (
        <div>
          <Field label="Name der Vorlage">
            <input className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="z. B. Terminbestätigung" />
          </Field>
          <Field label="Betreff">
            <input className={inputClass} value={form.betreff} onChange={(e) => setForm((f) => ({ ...f, betreff: e.target.value }))} />
          </Field>
          <Field label="Text">
            <textarea className={inputClass} rows={8} value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <SecondaryButton onClick={() => setFormOffen(false)}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={speichern} disabled={!form.name.trim() || !form.betreff.trim() || !form.text.trim()}>
              Speichern
            </PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  )
}
