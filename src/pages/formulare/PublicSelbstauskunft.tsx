import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Printer } from 'lucide-react'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import { DEFAULT_FRAGENKATALOG } from '../../data/fragenkataloge'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { today } from '../../lib/dates'
import { holePublicKunde, sendePublicFormular, type PublicKunde } from '../../lib/emailGateway'
import type { KundeBereich } from '../../types'

// Öffentliches, nicht-authentifiziertes Selbstauskunft-Formular für einen bereits angelegten
// Kunden/Mandanten. Der Fragenkatalog kommt bewusst aus dem festen DEFAULT_FRAGENKATALOG statt aus
// dem im CRM editierbaren state.fragenkataloge — Letzteres wird aktuell nicht nach Supabase
// synchronisiert (lebt nur im Browser des jeweiligen Mitarbeiters), ein unauthentifizierter externer
// Besucher könnte es also ohnehin nie sehen. Eine komplett neue öffentliche Lead-Gen-Website pro
// Bereich ist bewusst nicht Teil dieses Formulars.
export function PublicSelbstauskunft() {
  const { bereich: bereichParam, kundeId } = useParams()
  const [kunde, setKunde] = useState<PublicKunde | null | undefined>(undefined)
  const [submitted, setSubmitted] = useState(false)
  const [senden, setSenden] = useState(false)
  const [antworten, setAntworten] = useState<Record<string, string>>({})
  const [einverstanden, setEinverstanden] = useState(false)
  const [signatur, setSignatur] = useState<string | null>(null)
  const [error, setError] = useState('')

  const bereichRoh = KUNDEN_BEREICHE.find((b) => b.id === bereichParam)?.id as KundeBereich | undefined

  useEffect(() => {
    if (!bereichRoh || !kundeId) return
    holePublicKunde(bereichRoh, kundeId)
      .then(setKunde)
      .catch(() => setKunde(null))
  }, [bereichRoh, kundeId])

  if (!bereichRoh) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Link ungültig</h1>
          <p className="text-sm text-slate-500">Dieser Fragebogen-Link ist nicht mehr verfügbar. Bitte fordern Sie einen neuen Link an.</p>
        </Card>
      </div>
    )
  }

  if (kunde === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    )
  }

  if (!kunde) {
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

  const fragen = DEFAULT_FRAGENKATALOG.filter((f) => f.bereich === bereich)
  const bereitsEingereicht = !!kunde.selbstauskunft

  function setAntwort(frageId: string, wert: string) {
    setAntworten((a) => ({ ...a, [frageId]: wert }))
  }

  async function submit() {
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
    setSenden(true)
    try {
      await sendePublicFormular({
        bereich,
        kundeId: kundeId!,
        aktivitaetText: 'Selbstauskunft digital ausgefüllt und unterschrieben.',
        aktivitaetUser: `${kunde!.ansprechpartner} (Formular)`,
        selbstauskunft: {
          antworten: fragen.map((f) => ({ frageId: f.id, frageText: f.text, antwort: antworten[f.id] ?? '' })),
          signaturDataUrl: signatur,
          eingereichtAm: today(),
        },
      })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Übermittlung fehlgeschlagen. Bitte versuchen Sie es erneut.')
    } finally {
      setSenden(false)
    }
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

        <div className="mb-3 flex justify-end print:hidden">
          <SecondaryButton onClick={() => window.print()} className="gap-1.5 text-xs">
            <Printer size={13} /> Zum Ausdrucken (handschriftlich ausfüllen & unterschreiben)
          </SecondaryButton>
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

          <div className="print:hidden">
            <Field label="Unterschrift *">
              <SignaturePad onChange={setSignatur} />
            </Field>
          </div>
          <div className="hidden print:block print:mt-8">
            <p className="text-sm text-slate-700">Ort, Datum: ________________________</p>
            <p className="mt-8 text-sm text-slate-700">Unterschrift: ________________________________</p>
          </div>

          {error && <p className="mb-3 text-sm font-medium text-rose-600">{error}</p>}

          <PrimaryButton onClick={submit} disabled={senden} className="w-full justify-center print:hidden">
            {senden ? 'Wird übermittelt …' : 'Absenden'}
          </PrimaryButton>
          <p className="hidden print:block print:mt-4 print:text-xs print:text-slate-400">
            Bitte ausgedruckt, handschriftlich ausgefüllt und unterschrieben an die Andreas Mayer Holding zurückgeben (per Post, persönlich oder eingescannt per E-Mail).
          </p>
        </Card>
      </div>
    </div>
  )
}
