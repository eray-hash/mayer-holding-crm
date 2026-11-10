import { useState } from 'react'
import { Send, AlertTriangle, CheckCircle2, Paperclip, FileText, X } from 'lucide-react'
import { isEmailGatewayConfigured, sendEmail, type MailAnhang } from '../lib/emailGateway'
import { applyMailVorlage } from '../lib/mailVorlagen'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { leseAlsBase64 } from '../lib/objektDokumenteStorage'
import { erzeugeKundenDownloadUrl } from '../lib/kundenDokumenteStorage'
import { uid } from '../lib/dates'
import type { Dokument, KundeBereich } from '../types'

type Anhang = MailAnhang & { id: string; groesseLabel: string }

function formatiereGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type SendEmailKundeKontext = {
  bereich: KundeBereich
  id: string
  name: string
  firma?: string
  ansprechpartner?: string
}

export function SendEmailModal({
  open,
  onClose,
  to,
  defaultSubject = '',
  kunde,
  onSent,
}: {
  open: boolean
  onClose: () => void
  /** Fest vorgegebener Empfänger (z. B. aus der Kundenakte) — ohne diesen Wert ist das "An"-Feld frei editierbar. */
  to?: string
  defaultSubject?: string
  /** Optionaler Kunden-Kontext: füllt Platzhalter in Mailvorlagen und verknüpft die gesendete Mail im "Gesendet"-Ordner. */
  kunde?: SendEmailKundeKontext
  onSent: (data: { to: string; subject: string; text: string }) => void
}) {
  const { state } = useApp()
  const [toInput, setToInput] = useState(to ?? '')
  const [subject, setSubject] = useState(defaultSubject)
  const [text, setText] = useState('')
  const [vorlageId, setVorlageId] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [anhaenge, setAnhaenge] = useState<Anhang[]>([])
  const [aktenAuswahlOffen, setAktenAuswahlOffen] = useState(false)

  const vollerKunde = kunde ? KUNDEN_BEREICHE.find((b) => b.id === kunde.bereich)?.get(state).find((k) => k.id === kunde.id) : undefined
  const aktenDokumente = vollerKunde?.dokumente ?? []

  function reset() {
    setToInput(to ?? '')
    setSubject(defaultSubject)
    setText('')
    setVorlageId('')
    setError('')
    setSent(false)
    setAnhaenge([])
    setAktenAuswahlOffen(false)
  }

  async function dateiHochladen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const contentBase64 = await leseAlsBase64(file)
    setAnhaenge((a) => [...a, { id: uid('anh'), filename: file.name, contentBase64, contentType: file.type || undefined, groesseLabel: formatiereGroesse(file.size) }])
  }

  async function dokumentAusAkteHinzufuegen(d: Dokument) {
    setAktenAuswahlOffen(false)
    const url = d.url && !d.url.startsWith('http') ? await erzeugeKundenDownloadUrl(d.url) : d.url
    setAnhaenge((a) => [...a, { id: uid('anh'), filename: d.name, url, contentType: d.typ, groesseLabel: d.groesse }])
  }

  function anhangEntfernen(id: string) {
    setAnhaenge((a) => a.filter((x) => x.id !== id))
  }

  function handleClose() {
    reset()
    onClose()
  }

  function waehleVorlage(id: string) {
    setVorlageId(id)
    if (!id) return
    const vorlage = state.mailVorlagen.find((v) => v.id === id)
    if (!vorlage) return
    const { betreff, text: vorlageText } = applyMailVorlage(vorlage, kunde)
    setSubject(betreff)
    setText(vorlageText)
  }

  async function send() {
    setSending(true)
    setError('')
    try {
      // "Mein Profil" verspricht: "Wird an gesendete E-Mails aus dem Postfach angehängt" — bisher
      // wurde signaturHtml nirgendwo tatsächlich gelesen, die Signatur landete nie in einer echten
      // Mail (echter Fund beim Bugfixing-Durchgang 2026-11-03). Klartext-Mail bekommt eine aus der
      // HTML-Signatur abgeleitete Textversion angehängt; existiert eine Signatur, wird zusätzlich
      // eine HTML-Fassung mit der echten Formatierung mitgeschickt.
      const signaturHtml = state.profil.signaturHtml?.trim()
      const signaturText = signaturHtml
        ? signaturHtml
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
        : ''
      const finalText = signaturText ? `${text.trim()}\n\n--\n${signaturText}` : text.trim()
      const finalHtml = signaturHtml
        ? `<div>${text
            .trim()
            .split('\n')
            .map((line) => `<p>${line || '&nbsp;'}</p>`)
            .join('')}</div><div>${signaturHtml}</div>`
        : undefined
      await sendEmail(
        toInput.trim(),
        subject.trim(),
        finalText,
        finalHtml,
        {
          toName: kunde?.name ?? toInput.trim(),
          kundeBereich: kunde?.bereich,
          kundeId: kunde?.id,
          kundeName: kunde?.name,
        },
        anhaenge.map(({ filename, contentBase64, url, contentType }) => ({ filename, contentBase64, url, contentType })),
      )
      onSent({ to: toInput.trim(), subject: subject.trim(), text: text.trim() })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'E-Mail konnte nicht gesendet werden.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={to ? `E-Mail an ${to}` : 'Neue E-Mail'} width="max-w-lg">
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
          <p className="mb-5 text-xs text-slate-500">an {toInput}</p>
          <div className="flex justify-center">
            <PrimaryButton onClick={handleClose}>Fertig</PrimaryButton>
          </div>
        </div>
      ) : (
        <div>
          <Field label="An">
            <input className={inputClass} value={toInput} disabled={Boolean(to)} onChange={(e) => setToInput(e.target.value)} placeholder="empfaenger@beispiel.de" />
          </Field>

          {state.mailVorlagen.length > 0 && (
            <Field label="Vorlage anwenden (optional)">
              <select className={inputClass} value={vorlageId} onChange={(e) => waehleVorlage(e.target.value)}>
                <option value="">— Vorlage wählen —</option>
                {state.mailVorlagen.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Betreff">
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Nachricht">
            <textarea className={inputClass} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>

          <Field label="Anhänge (optional)">
            <div className="space-y-2">
              {anhaenge.length > 0 && (
                <ul className="space-y-1">
                  {anhaenge.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
                      <FileText size={14} className="flex-shrink-0 text-slate-400" />
                      <span className="flex-1 truncate text-slate-700">{a.filename}</span>
                      <span className="flex-shrink-0 text-xs text-slate-400">{a.groesseLabel}</span>
                      <button onClick={() => anhangEntfernen(a.id)} className="flex-shrink-0 text-slate-400 hover:text-rose-600">
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  <Paperclip size={13} /> Datei hochladen
                  <input type="file" className="hidden" onChange={dateiHochladen} />
                </label>
                {aktenDokumente.length > 0 && (
                  <button
                    onClick={() => setAktenAuswahlOffen((o) => !o)}
                    className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <FileText size={13} /> Aus Akte wählen
                  </button>
                )}
              </div>

              {aktenAuswahlOffen && (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1">
                  {aktenDokumente.map((d) => (
                    <li key={d.id}>
                      <button
                        onClick={() => dokumentAusAkteHinzufuegen(d)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
                      >
                        <FileText size={13} className="flex-shrink-0 text-slate-400" />
                        <span className="flex-1 truncate">{d.name}</span>
                        <span className="flex-shrink-0 text-slate-400">{d.groesse}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>

          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <SecondaryButton onClick={handleClose}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={send} disabled={sending || !toInput.trim() || !subject.trim() || !text.trim()}>
              <Send size={14} /> {sending ? 'Wird gesendet …' : 'Senden'}
            </PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  )
}
