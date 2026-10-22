import { useRef, useState } from 'react'
import { Camera, CheckCircle2, FileText } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { suggestKunde } from '../lib/matchKunde'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { uid, today } from '../lib/dates'
import type { KundeBereich } from '../types'

export function DokumentenImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dateiname, setDateiname] = useState('')
  const [vorschauDataUrl, setVorschauDataUrl] = useState<string | undefined>()
  const [erkannterText, setErkannterText] = useState('')
  const [bereich, setBereich] = useState<KundeBereich | ''>('')
  const [kundeId, setKundeId] = useState('')
  const [saved, setSaved] = useState(false)

  const suggestion = suggestKunde(state, `${erkannterText} ${dateiname}`)
  const kundenListe = bereich ? KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state) : []

  function reset() {
    setDateiname('')
    setVorschauDataUrl(undefined)
    setErkannterText('')
    setBereich('')
    setKundeId('')
    setSaved(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleFile(file: File | undefined) {
    if (!file) return
    setDateiname(file.name)
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => setVorschauDataUrl(reader.result as string)
      reader.readAsDataURL(file)
    } else {
      setVorschauDataUrl(undefined)
    }
  }

  function applySuggestion() {
    if (!suggestion) return
    setBereich(suggestion.bereich)
    setKundeId(suggestion.kundeId)
  }

  function save() {
    if (!dateiname) return
    const kunde = bereich ? kundenListe.find((k) => k.id === kundeId) : undefined
    const dokument = {
      id: uid('dok'),
      dateiname,
      hochgeladenAm: today(),
      vorschauDataUrl,
      erkannterText,
      vorschlag: suggestion ? { bereich: suggestion.bereich, kundeId: suggestion.kundeId, kundeName: suggestion.kundeName } : undefined,
    }
    dispatch({ type: 'ADD_IMPORTIERTES_DOKUMENT', dokument })
    if (bereich && kunde) {
      dispatch({
        type: 'ASSIGN_IMPORTIERTES_DOKUMENT',
        id: dokument.id,
        bereich,
        kundeId: kunde.id,
        kundeName: `${kunde.firma} (${kunde.ansprechpartner})`,
      })
    }
    setSaved(true)
  }

  return (
    <Modal open={open} onClose={handleClose} title="Dokument importieren" width="max-w-xl">
      {saved ? (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={36} />
          <p className="mb-1 text-sm font-medium text-slate-800">Dokument gespeichert{bereich && kundeId ? ' und zugewiesen' : ''}.</p>
          <p className="mb-5 text-xs text-slate-500">„{dateiname}"</p>
          <div className="flex justify-center gap-2">
            <SecondaryButton onClick={reset}>Weiteres Dokument</SecondaryButton>
            <PrimaryButton onClick={handleClose}>Fertig</PrimaryButton>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-4 text-xs text-slate-500">
            Foto per Handy (Kamera öffnet sich direkt) oder Scan vom Drucker hochladen — das System schlägt anhand des
            erkannten Texts automatisch einen passenden Kunden/Mandanten vor.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="mb-4 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-accent-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent-700 hover:file:bg-accent-100"
          />

          {dateiname && (
            <div className="mb-4 flex items-center gap-3 rounded-lg bg-slate-50 p-3">
              {vorschauDataUrl ? (
                <img src={vorschauDataUrl} alt="Vorschau" className="h-16 w-16 rounded object-cover" />
              ) : (
                <FileText className="text-slate-400" size={32} />
              )}
              <span className="text-sm text-slate-700">{dateiname}</span>
            </div>
          )}

          <Field label="Erkannter Text / Notiz (Platzhalter für OCR — Firmen-/Kundennamen helfen bei der Zuordnung)">
            <textarea
              className={inputClass}
              rows={3}
              value={erkannterText}
              onChange={(e) => setErkannterText(e.target.value)}
              placeholder="z.B. Inhalt des Dokuments eintippen oder einfügen …"
            />
          </Field>

          {suggestion && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-accent-200 bg-accent-50 p-3">
              <div className="text-xs text-accent-800">
                <span className="font-medium">Vorschlag:</span> {suggestion.kundeName} ·{' '}
                {KUNDEN_BEREICHE.find((b) => b.id === suggestion.bereich)?.label}
              </div>
              <SecondaryButton onClick={applySuggestion} className="text-xs">
                Übernehmen
              </SecondaryButton>
            </div>
          )}

          <Field label="Bereich (manuell wählen oder Vorschlag übernehmen)">
            <select
              className={inputClass}
              value={bereich}
              onChange={(e) => {
                const next = e.target.value as KundeBereich | ''
                setBereich(next)
                setKundeId(next ? KUNDEN_BEREICHE.find((b) => b.id === next)!.get(state)[0]?.id ?? '' : '')
              }}
            >
              <option value="">– später zuweisen –</option>
              {KUNDEN_BEREICHE.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </Field>

          {bereich && (
            <Field label="Kunde/Mandant">
              <select className={inputClass} value={kundeId} onChange={(e) => setKundeId(e.target.value)}>
                {kundenListe.length === 0 && <option value="">– keine Kunden in diesem Bereich –</option>}
                {kundenListe.map((k) => (
                  <option key={k.id} value={k.id}>{k.firma} ({k.ansprechpartner})</option>
                ))}
              </select>
            </Field>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <SecondaryButton onClick={handleClose}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={save} disabled={!dateiname}>
              <Camera size={14} /> Speichern{bereich && kundeId ? ' & zuweisen' : ''}
            </PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  )
}
