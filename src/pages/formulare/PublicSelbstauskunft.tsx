import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import { Card, Field, inputClass, PrimaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { today } from '../../lib/dates'
import type { KundeBereich } from '../../types'

// Öffentliches, nicht-authentifiziertes Selbstauskunft-Formular für einen bereits angelegten
// Kunden/Mandanten — der Fragenkatalog kommt aus state.fragenkataloge (im CRM pro Bereich frei
// editierbar, siehe FragenkatalogModal) statt hartcodiert zu sein. Eine komplett neue öffentliche
// Lead-Gen-Website pro Bereich ist bewusst nicht Teil dieses Formulars.
export function PublicSelbstauskunft() {
  const { bereich: bereichParam, kundeId } = useParams()
  const { state, dispatch } = useApp()
  const [submitted, setSubmitted] = useState(false)
  const [antworten, setAntworten] = useState<Record<string, string>>({})
  const [einverstanden, setEinverstanden] = useState(false)
  const [signatur, setSignatur] = useState<string | null>(null)
  const [error, setError] = useState('')

  const bereichRoh = KUNDEN_BEREICHE.find((b) => b.id === bereichParam)?.id as KundeBereich | undefined
  const kunde = bereichRoh ? KUNDEN_BEREICHE.find((b) => b.id === bereichRoh)!.get(state).find((k) => k.id === kundeId) : undefined

  if (!bereichRoh || !kunde) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Link ungültig</h1>
          <p className="text-sm text-slate-500">Dieser Fragebogen-Link ist nicht mehr verfügbar. Bitte fordern Sie einen neuen Link an.</p>
        </Card>
      </div>
    )
  }
  const bereich: KundeBereich = bereichRoh

  const fragen = state.fragenkataloge.filter((f) => f.bereich === bereich)
  const bereitsEingereicht = !!kunde.selbstauskunft

  function setAntwort(frageId: string, wert: string) {
    setAntworten((a) => ({ ...a, [frageId]: wert }))
  }

  function submit() {
    const fehlendePflichtfrage = fragen.find((f) => f.pflichtfeld && !antworten[f.id]?.trim())
    if (fehlendePflichtfrage) {
      setError(`Bitte beantworten Sie: „${fehlendePflichtfrage.text}"`)
      return
    }
    if (!einverstanden) {
      setError('Bitte dem Einverständnis zur Datenverarbeitung zustimmen.')
      return
    }
    if (!signatur) {
      setError('Bitte unten unterschreiben, bevor Sie absenden.')
      return
    }
    setError('')
    dispatch({
      type: 'SET_SELBSTAUSKUNFT',
      bereich,
      kundeId: kunde!.id,
      selbstauskunft: {
        antworten: fragen.map((f) => ({ frageId: f.id, frageText: f.text, antwort: antworten[f.id] ?? '' })),
        signaturDataUrl: signatur,
        eingereichtAm: today(),
      },
    })
    setSubmitted(true)
  }

  if (submitted || bereitsEingereicht) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={40} />
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Vielen Dank, {kunde.ansprechpartner}!</h1>
          <p className="text-sm text-slate-500">Ihre Angaben wurden übermittelt und sind direkt in Ihrer Akte hinterlegt.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstrasse 3, 89075 Ulm</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">Selbstauskunft</h1>
          <p className="mt-1 text-sm text-slate-500">für {kunde.firma}</p>
        </div>

        <Card className="p-6">
          {fragen.map((f) => (
            <Field key={f.id} label={`${f.text}${f.pflichtfeld ? ' *' : ''}`}>
              {f.typ === 'text' && (
                <input className={inputClass} value={antworten[f.id] ?? ''} onChange={(e) => setAntwort(f.id, e.target.value)} />
              )}
              {f.typ === 'zahl' && (
                <input type="number" className={inputClass} value={antworten[f.id] ?? ''} onChange={(e) => setAntwort(f.id, e.target.value)} />
              )}
              {f.typ === 'auswahl' && (
                <select className={inputClass} value={antworten[f.id] ?? ''} onChange={(e) => setAntwort(f.id, e.target.value)}>
                  <option value="">– bitte wählen –</option>
                  {(f.optionen ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {f.typ === 'checkbox' && (
                <label className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input type="checkbox" className="rounded" checked={antworten[f.id] === 'Ja'} onChange={(e) => setAntwort(f.id, e.target.checked ? 'Ja' : 'Nein')} />
                  Ja
                </label>
              )}
            </Field>
          ))}
          {fragen.length === 0 && <p className="mb-4 text-sm text-slate-500">Für diesen Bereich wurde noch kein Fragenkatalog hinterlegt.</p>}

          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-700">Einverständnis &amp; Datenschutz</h3>
          <label className="mb-4 flex items-start gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={einverstanden} onChange={(e) => setEinverstanden(e.target.checked)} className="mt-0.5 rounded" />
            Ich bin damit einverstanden, dass die hier gemachten Angaben für die Beratung bei der Andreas Mayer Holding gespeichert und verarbeitet werden. *
          </label>
          <p className="mb-4 text-xs text-slate-400">
            Ihre Daten werden ausschließlich im Rahmen der laufenden Beratung verwendet. Eine Weitergabe an Dritte erfolgt nicht.
          </p>

          <Field label="Unterschrift *">
            <SignaturePad onChange={setSignatur} />
          </Field>

          {error && <p className="mb-3 text-sm font-medium text-rose-600">{error}</p>}

          <PrimaryButton onClick={submit} className="w-full justify-center">
            Absenden
          </PrimaryButton>
        </Card>
      </div>
    </div>
  )
}
