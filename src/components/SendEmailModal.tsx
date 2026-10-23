import { useState } from 'react'
import { Send, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { isEmailGatewayConfigured, sendEmail } from '../lib/emailGateway'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'

export function SendEmailModal({
  open,
  onClose,
  to,
  defaultSubject = '',
  onSent,
}: {
  open: boolean
  onClose: () => void
  to: string
  defaultSubject?: string
  onSent: (data: { to: string; subject: string; text: string }) => void
}) {
  const [subject, setSubject] = useState(defaultSubject)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  function reset() {
    setSubject(defaultSubject)
    setText('')
    setError('')
    setSent(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function send() {
    setSending(true)
    setError('')
    try {
      await sendEmail(to, subject.trim(), text.trim())
      onSent({ to, subject: subject.trim(), text: text.trim() })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'E-Mail konnte nicht gesendet werden.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={`E-Mail an ${to}`} width="max-w-lg">
      {!isEmailGatewayConfigured ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          Postfach noch nicht verbunden — sobald die Zugangsdaten als Supabase-Secrets hinterlegt sind,
          kann hier direkt aus dem CRM gesendet werden.
        </div>
      ) : sent ? (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={36} />
          <p className="mb-1 text-sm font-medium text-slate-800">E-Mail gesendet.</p>
          <p className="mb-5 text-xs text-slate-500">an {to}</p>
          <div className="flex justify-center">
            <PrimaryButton onClick={handleClose}>Fertig</PrimaryButton>
          </div>
        </div>
      ) : (
        <div>
          <Field label="An">
            <input className={inputClass} value={to} disabled />
          </Field>
          <Field label="Betreff">
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Nachricht">
            <textarea className={inputClass} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>

          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <SecondaryButton onClick={handleClose}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={send} disabled={sending || !subject.trim() || !text.trim()}>
              <Send size={14} /> {sending ? 'Wird gesendet …' : 'Senden'}
            </PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  )
}
