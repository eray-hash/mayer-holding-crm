import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Printer } from 'lucide-react'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { holePublicKunde, sendePublicFormular, type PublicKunde } from '../../lib/emailGateway'
import { ALLGEMEINE_VOLLMACHT, KANZLEI_ANSCHRIFT } from '../../data/originalTexte'

export function PublicVollmachtErben() {
  const { mandantId } = useParams()
  const [mandant, setMandant] = useState<PublicKunde | null | undefined>(undefined)
  const [submitted, setSubmitted] = useState(false)
  const [senden, setSenden] = useState(false)

  const [vollmachtgeberWohnhaft, setVollmachtgeberWohnhaft] = useState('')
  const [bevollmaechtigterName, setBevollmaechtigterName] = useState('')
  const [bevollmaechtigterWohnhaft, setBevollmaechtigterWohnhaft] = useState('')
  const [rechtsgeschaeft, setRechtsgeschaeft] = useState('')
  const [ort, setOrt] = useState('Ulm')
  const [signatur, setSignatur] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!mandantId) return
    holePublicKunde('erben', mandantId)
      .then(setMandant)
      .catch(() => setMandant(null))
  }, [mandantId])

  if (mandant === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    )
  }

  if (!mandant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Link ungültig</h1>
          <p className="text-sm text-slate-500">Dieser Vollmacht-Link ist nicht mehr gültig. Bitte fordern Sie einen neuen Link an.</p>
        </Card>
      </div>
    )
  }

  async function submit() {
    if (!vollmachtgeberWohnhaft.trim() || !bevollmaechtigterName.trim() || !rechtsgeschaeft.trim()) {
      setError('Bitte eigene Anschrift, bevollmächtigte Person und Rechtsgeschäft ausfüllen.')
      return
    }
    if (!signatur) {
      setError('Bitte unten unterschreiben, bevor Sie absenden.')
      return
    }
    setError('')
    setSenden(true)

    const aktivitaetText = `Allgemeine Vollmacht digital ausgefüllt und unterschrieben in ${ort || 'Ulm'}. Vollmachtgeber wohnhaft: ${vollmachtgeberWohnhaft || '–'}. Bevollmächtigt: ${bevollmaechtigterName}${bevollmaechtigterWohnhaft ? ' (' + bevollmaechtigterWohnhaft + ')' : ''}. Rechtsgeschäft: ${rechtsgeschaeft}.`

    try {
      await sendePublicFormular({
        bereich: 'erben',
        kundeId: mandantId!,
        aktivitaetText,
        aktivitaetUser: `${mandant!.ansprechpartner} (Formular)`,
        signatur: { name: mandant!.ansprechpartner, dataUrl: signatur, kontext: 'Allgemeine Vollmacht' },
      })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Übermittlung fehlgeschlagen. Bitte versuchen Sie es erneut.')
    } finally {
      setSenden(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={40} />
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Vielen Dank, {mandant.ansprechpartner}!</h1>
          <p className="text-sm text-slate-500">
            Ihre unterschriebene Vollmacht wurde übermittelt und ist direkt in Ihrer Mandantenakte hinterlegt.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · {KANZLEI_ANSCHRIFT}</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">Allgemeine Vollmacht</h1>
        </div>

        <div className="mb-3 flex justify-end print:hidden">
          <SecondaryButton onClick={() => window.print()} className="gap-1.5 text-xs">
            <Printer size={13} /> Zum Ausdrucken (handschriftlich ausfüllen & unterschreiben)
          </SecondaryButton>
        </div>

        <Card className="p-6">
          <div className="text-sm leading-relaxed text-slate-700">
            <p className="mb-2">
              Herrn/Frau/Firma <strong>{mandant.ansprechpartner}</strong>,
            </p>
            <Field label="wohnhaft *">
              <input className={inputClass} value={vollmachtgeberWohnhaft} onChange={(e) => setVollmachtgeberWohnhaft(e.target.value)} />
            </Field>
            <p className="mb-2">bevollmächtigt hiermit</p>
            <Field label="Herrn/Frau *">
              <input className={inputClass} value={bevollmaechtigterName} onChange={(e) => setBevollmaechtigterName(e.target.value)} />
            </Field>
            <Field label="wohnhaft">
              <input className={inputClass} value={bevollmaechtigterWohnhaft} onChange={(e) => setBevollmaechtigterWohnhaft(e.target.value)} />
            </Field>
            <Field label="zu folgendem Rechtsgeschäft: *">
              <textarea className={inputClass} rows={3} value={rechtsgeschaeft} onChange={(e) => setRechtsgeschaeft(e.target.value)} />
            </Field>
            <p className="mb-3">{ALLGEMEINE_VOLLMACHT.befugnis}</p>
            <p className="mb-4">{ALLGEMEINE_VOLLMACHT.fortgeltung}</p>
            <Field label="Ort">
              <input className={inputClass} value={ort} onChange={(e) => setOrt(e.target.value)} />
            </Field>
          </div>

          <div className="print:hidden">
            <Field label="Unterschrift Vollmachtgeber *">
              <SignaturePad onChange={setSignatur} />
            </Field>
          </div>
          <div className="hidden print:block print:mt-8">
            <p className="text-sm text-slate-700">Ort, Datum: ________________________</p>
            <p className="mt-8 text-sm text-slate-700">Unterschrift Vollmachtgeber: ________________________________</p>
          </div>

          {error && <p className="mb-3 text-sm font-medium text-rose-600">{error}</p>}

          <PrimaryButton onClick={submit} disabled={senden} className="w-full justify-center print:hidden">
            {senden ? 'Wird übermittelt …' : 'Vollmacht unterschreiben & absenden'}
          </PrimaryButton>
          <p className="hidden print:block print:mt-4 print:text-xs print:text-slate-400">
            Bitte ausgedruckt, handschriftlich ausgefüllt und unterschrieben an die Andreas Mayer Holding zurückgeben (per Post, persönlich oder eingescannt per E-Mail).
          </p>
        </Card>
      </div>
    </div>
  )
}
