import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Printer } from 'lucide-react'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { holePublicKunde, sendePublicFormular, type PublicKunde } from '../../lib/emailGateway'
import { generateDokumentPdf } from '../../lib/generateDokumentPdf'
import { today } from '../../lib/dates'

type VollmachtTyp = 'finanzamt' | 'bank'

const TITEL: Record<VollmachtTyp, string> = {
  finanzamt: 'Vollmacht für das Finanzamt',
  bank: 'Vollmacht Bank – Kreditverhandlungen',
}

const ERLAEUTERUNG: Record<VollmachtTyp, string> = {
  finanzamt:
    'Hiermit bevollmächtigen Sie die Unternehmensberatung Andreas Mayer, Andreas Mayer und seine Mitarbeiter, Schwabstrasse 3, ' +
    '89075 Ulm, Sie in allen steuerlichen Angelegenheiten gegenüber dem Finanzamt zu vertreten — insbesondere zur Einsichtnahme in ' +
    'Ihre Steuerakten, zur Entgegennahme und Abgabe von Steuerbescheiden und Schriftstücken, zur Stellung und Entgegennahme von ' +
    'Anträgen, zur Teilnahme an Besprechungen und Verhandlungen sowie zur Einlegung und Rücknahme von Rechtsbehelfen. Die Vollmacht ' +
    'gilt ab dem Tag der Unterzeichnung und ist bis auf Widerruf gültig, mindestens 2 Monate.',
  bank:
    'Hiermit erteilen Sie der Unternehmensberatung Andreas Mayer Consulting, Schwabstrasse 3, 89075 Ulm, die Vollmacht, in Ihrem ' +
    'Namen und für Ihre Rechnung Verhandlungen über die Aufnahme von Krediten und Darlehen bei der Bank zu führen — einschließlich ' +
    'Prüfung und Verhandlung von Kreditangeboten, Unterzeichnung von Kreditverträgen und aller notwendigen Dokumente im ' +
    'Zusammenhang mit der Kreditaufnahme. Diese Vollmacht gilt ab sofort und bleibt gültig, bis sie schriftlich widerrufen wird.',
}

export function PublicVollmachtBeratung() {
  const { typ, kundeId } = useParams<{ typ: VollmachtTyp; kundeId: string }>()
  const [searchParams] = useSearchParams()
  const behoerdeEmail = searchParams.get('behoerde')
  const behoerdeName = searchParams.get('behoerdeName')
  const [kunde, setKunde] = useState<PublicKunde | null | undefined>(undefined)
  const [submitted, setSubmitted] = useState(false)
  const [senden, setSenden] = useState(false)

  const gueltigerTyp: VollmachtTyp = typ === 'bank' ? 'bank' : 'finanzamt'

  const [geburtsdatum, setGeburtsdatum] = useState('')
  const [adresse, setAdresse] = useState('')
  const [steuernummer, setSteuernummer] = useState('')
  const [signatur, setSignatur] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!kundeId) return
    holePublicKunde('beratung', kundeId)
      .then(setKunde)
      .catch(() => setKunde(null))
  }, [kundeId])

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
          <p className="text-sm text-slate-500">Dieser Vollmacht-Link ist nicht mehr gültig. Bitte fordern Sie einen neuen Link an.</p>
        </Card>
      </div>
    )
  }

  async function submit() {
    if (!adresse.trim() || (gueltigerTyp === 'finanzamt' && (!geburtsdatum.trim() || !steuernummer.trim()))) {
      setError('Bitte alle Felder ausfüllen.')
      return
    }
    if (!signatur) {
      setError('Bitte unten unterschreiben, bevor Sie absenden.')
      return
    }
    setError('')
    setSenden(true)

    const details =
      gueltigerTyp === 'finanzamt'
        ? `Geburtsdatum: ${geburtsdatum}, Adresse: ${adresse}, Steuernummer: ${steuernummer}.`
        : `Wohnhaft: ${adresse}.`

    try {
      let behoerde: { email: string; name?: string; pdfBase64?: string; pdfFilename?: string } | undefined
      if (behoerdeEmail) {
        const felder: { label: string; value: string }[] = [
          { label: 'Vollmachtgeber', value: `${kunde!.ansprechpartner} (${kunde!.firma})` },
          { label: 'E-Mail', value: kunde!.email },
        ]
        if (gueltigerTyp === 'finanzamt') {
          felder.push({ label: 'Geburtsdatum', value: geburtsdatum }, { label: 'Steuernummer', value: steuernummer }, { label: 'Adresse', value: adresse })
        } else {
          felder.push({ label: 'Wohnhaft', value: adresse })
        }
        const pdf = generateDokumentPdf({
          titel: TITEL[gueltigerTyp],
          absatzVorFeldern: `Diese Vollmacht wird für ${kunde!.ansprechpartner} (${kunde!.firma}) erstellt.`,
          felder,
          erlaeuterung: ERLAEUTERUNG[gueltigerTyp],
          signaturDataUrl: signatur,
          ort: 'Ulm',
          datum: today(),
        })
        behoerde = { email: behoerdeEmail, name: behoerdeName || 'Finanzamt', pdfBase64: pdf.base64, pdfFilename: `${TITEL[gueltigerTyp]}.pdf` }
      }

      await sendePublicFormular({
        bereich: 'beratung',
        kundeId: kundeId!,
        aktivitaetText: `${TITEL[gueltigerTyp]} digital ausgefüllt und unterschrieben. ${details}`,
        aktivitaetUser: `${kunde!.ansprechpartner} (Formular)`,
        signatur: { name: kunde!.ansprechpartner, dataUrl: signatur, kontext: TITEL[gueltigerTyp] },
        behoerde,
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
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Vielen Dank, {kunde.ansprechpartner}!</h1>
          <p className="text-sm text-slate-500">Ihre unterschriebene Vollmacht wurde übermittelt und ist direkt in Ihrer Akte hinterlegt.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstrasse 3, 89075 Ulm</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">{TITEL[gueltigerTyp]}</h1>
        </div>

        <div className="mb-3 flex justify-end print:hidden">
          <SecondaryButton onClick={() => window.print()} className="gap-1.5 text-xs">
            <Printer size={13} /> Zum Ausdrucken (handschriftlich ausfüllen & unterschreiben)
          </SecondaryButton>
        </div>

        <Card className="p-6">
          <p className="mb-4 text-sm text-slate-500">
            Diese Vollmacht wird für <strong>{kunde.ansprechpartner}</strong> ({kunde.firma}) erstellt.
          </p>

          <div className="mb-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <div className="mb-1 font-medium text-slate-600">Vollmachtgeber</div>
            {kunde.ansprechpartner} · {kunde.email}
          </div>

          {gueltigerTyp === 'finanzamt' && (
            <>
              <Field label="Geburtsdatum *">
                <input type="date" className={inputClass} value={geburtsdatum} onChange={(e) => setGeburtsdatum(e.target.value)} />
              </Field>
              <Field label="Steuernummer *">
                <input className={inputClass} value={steuernummer} onChange={(e) => setSteuernummer(e.target.value)} />
              </Field>
            </>
          )}
          <Field label={gueltigerTyp === 'finanzamt' ? 'Adresse *' : 'Wohnhaft *'}>
            <input className={inputClass} value={adresse} onChange={(e) => setAdresse(e.target.value)} />
          </Field>

          <p className="mb-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">{ERLAEUTERUNG[gueltigerTyp]}</p>

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
