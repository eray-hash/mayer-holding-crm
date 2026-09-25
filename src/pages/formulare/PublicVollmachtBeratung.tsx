import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, Field, inputClass, PrimaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { today, uid } from '../../lib/dates'

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
  const { state, dispatch } = useApp()
  const [submitted, setSubmitted] = useState(false)

  const kunde = state.kunden.find((k) => k.id === kundeId)
  const gueltigerTyp: VollmachtTyp = typ === 'bank' ? 'bank' : 'finanzamt'

  const [geburtsdatum, setGeburtsdatum] = useState('')
  const [adresse, setAdresse] = useState('')
  const [steuernummer, setSteuernummer] = useState('')
  const [signatur, setSignatur] = useState<string | null>(null)
  const [error, setError] = useState('')

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

  function submit() {
    if (!adresse.trim() || (gueltigerTyp === 'finanzamt' && (!geburtsdatum.trim() || !steuernummer.trim()))) {
      setError('Bitte alle Felder ausfüllen.')
      return
    }
    if (!signatur) {
      setError('Bitte unten unterschreiben, bevor Sie absenden.')
      return
    }
    setError('')

    const details =
      gueltigerTyp === 'finanzamt'
        ? `Geburtsdatum: ${geburtsdatum}, Adresse: ${adresse}, Steuernummer: ${steuernummer}.`
        : `Wohnhaft: ${adresse}.`

    dispatch({
      type: 'UPDATE_KUNDE',
      id: kunde!.id,
      patch: {
        letzteAktivitaet: today(),
        activities: [
          { id: uid('act'), date: today(), text: `${TITEL[gueltigerTyp]} digital ausgefüllt und unterschrieben. ${details}`, user: `${kunde!.ansprechpartner} (Formular)` },
          ...kunde!.activities,
        ],
        signaturen: [
          { id: uid('sig'), name: kunde!.ansprechpartner, dataUrl: signatur, datum: today(), kontext: TITEL[gueltigerTyp] },
          ...(kunde!.signaturen ?? []),
        ],
      },
    })

    setSubmitted(true)
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

          <Field label="Unterschrift Vollmachtgeber *">
            <SignaturePad onChange={setSignatur} />
          </Field>

          {error && <p className="mb-3 text-sm font-medium text-rose-600">{error}</p>}

          <PrimaryButton onClick={submit} className="w-full justify-center">
            Vollmacht unterschreiben &amp; absenden
          </PrimaryButton>
        </Card>
      </div>
    </div>
  )
}
