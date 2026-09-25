import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, Field, inputClass, PrimaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { today, uid } from '../../lib/dates'

export function PublicVollmachtErben() {
  const { mandantId } = useParams()
  const { state, dispatch } = useApp()
  const [submitted, setSubmitted] = useState(false)

  const mandant = state.erbenMandanten.find((k) => k.id === mandantId)

  const [bevollmaechtigterName, setBevollmaechtigterName] = useState('')
  const [bevollmaechtigterWohnhaft, setBevollmaechtigterWohnhaft] = useState('')
  const [rechtsgeschaeft, setRechtsgeschaeft] = useState('')
  const [ort, setOrt] = useState('Ulm')
  const [signatur, setSignatur] = useState<string | null>(null)
  const [error, setError] = useState('')

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

  function submit() {
    if (!bevollmaechtigterName.trim() || !rechtsgeschaeft.trim()) {
      setError('Bitte bevollmächtigte Person und Rechtsgeschäft ausfüllen.')
      return
    }
    if (!signatur) {
      setError('Bitte unten unterschreiben, bevor Sie absenden.')
      return
    }
    setError('')

    const activityText = `Allgemeine Vollmacht digital ausgefüllt und unterschrieben. Bevollmächtigt: ${bevollmaechtigterName}${bevollmaechtigterWohnhaft ? ' (' + bevollmaechtigterWohnhaft + ')' : ''}. Rechtsgeschäft: ${rechtsgeschaeft}.`

    dispatch({
      type: 'UPDATE_ERBEN_MANDANT',
      id: mandant!.id,
      patch: {
        letzteAktivitaet: today(),
        activities: [{ id: uid('act'), date: today(), text: activityText, user: `${mandant!.ansprechpartner} (Formular)` }, ...mandant!.activities],
        signaturen: [
          { id: uid('sig'), name: mandant!.ansprechpartner, dataUrl: signatur, datum: today(), kontext: 'Allgemeine Vollmacht' },
          ...(mandant!.signaturen ?? []),
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
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstrasse 3, 89075 Ulm</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">Allgemeine Vollmacht</h1>
        </div>

        <Card className="p-6">
          <p className="mb-4 text-sm text-slate-500">
            Diese Vollmacht wird für <strong>{mandant.ansprechpartner}</strong> ({mandant.firma}) erstellt. Bitte prüfen Sie die
            Angaben und tragen Sie die bevollmächtigte Person sowie das Rechtsgeschäft ein.
          </p>

          <div className="mb-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <div className="mb-1 font-medium text-slate-600">Vollmachtgeber</div>
            {mandant.ansprechpartner} · {mandant.email}
          </div>

          <Field label="Bevollmächtigte Person (Name) *">
            <input className={inputClass} value={bevollmaechtigterName} onChange={(e) => setBevollmaechtigterName(e.target.value)} />
          </Field>
          <Field label="Wohnhaft (Adresse der bevollmächtigten Person)">
            <input className={inputClass} value={bevollmaechtigterWohnhaft} onChange={(e) => setBevollmaechtigterWohnhaft(e.target.value)} />
          </Field>
          <Field label="Zu folgendem Rechtsgeschäft *">
            <textarea className={inputClass} rows={3} value={rechtsgeschaeft} onChange={(e) => setRechtsgeschaeft(e.target.value)} />
          </Field>
          <Field label="Ort">
            <input className={inputClass} value={ort} onChange={(e) => setOrt(e.target.value)} />
          </Field>

          <p className="mb-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
            Der Bevollmächtigte ist befugt, den Vollmachtgeber in allen Angelegenheiten vor Behörden und Privatpersonen zu
            vertreten. Diese Vollmacht erlischt nicht mit dem Tode des Vollmachtgebers, sondern besteht darüber hinaus fort. Sie
            kann nur durch den Vollmachtgeber selbst oder — nach dessen Tod — durch die Erben widerrufen werden.
          </p>

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
