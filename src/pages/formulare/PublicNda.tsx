import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Printer } from 'lucide-react'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import { Card, PrimaryButton, SecondaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { holePublicKunde, sendePublicFormular, type PublicKunde } from '../../lib/emailGateway'
import type { KundeBereich } from '../../types'
import { GEHEIMHALTUNG, KANZLEI_ANSCHRIFT } from '../../data/originalTexte'

// Wortlaut exakt wie im Original der Kanzlei (data/originalTexte.ts), als öffentliches, signierbares Formular.
export function PublicNda() {
  const { bereich: bereichParam, kundeId } = useParams()
  const [kunde, setKunde] = useState<PublicKunde | null | undefined>(undefined)
  const [submitted, setSubmitted] = useState(false)
  const [senden, setSenden] = useState(false)
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
          <p className="text-sm text-slate-500">Dieser NDA-Link ist nicht mehr gültig. Bitte fordern Sie einen neuen Link an.</p>
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
          <p className="text-sm text-slate-500">Dieser NDA-Link ist nicht mehr gültig. Bitte fordern Sie einen neuen Link an.</p>
        </Card>
      </div>
    )
  }

  async function submit() {
    if (!signatur) {
      setError('Bitte unten unterschreiben, bevor Sie absenden.')
      return
    }
    setError('')
    setSenden(true)
    try {
      await sendePublicFormular({
        bereich: bereichRoh!,
        kundeId: kundeId!,
        aktivitaetText: 'Geheimhaltungs- und Quellenschutzvereinbarung (NDA) digital unterschrieben.',
        aktivitaetUser: `${kunde!.ansprechpartner} (Formular)`,
        signatur: { name: kunde!.ansprechpartner, dataUrl: signatur, kontext: 'NDA – Geheimhaltungsvereinbarung' },
      })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Übermittlung fehlgeschlagen. Bitte versuchen Sie es erneut.')
    } finally {
      setSenden(false)
    }
  }

  if (submitted || kunde.ndaUnterschrieben) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={40} />
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Vielen Dank, {kunde.ansprechpartner}!</h1>
          <p className="text-sm text-slate-500">Die unterschriebene Geheimhaltungsvereinbarung wurde übermittelt und ist direkt in Ihrer Akte hinterlegt.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · {KANZLEI_ANSCHRIFT}</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">{GEHEIMHALTUNG.titel}</h1>
        </div>

        <div className="mb-3 flex justify-end print:hidden">
          <SecondaryButton onClick={() => window.print()} className="gap-1.5 text-xs">
            <Printer size={13} /> Zum Ausdrucken (handschriftlich ausfüllen & unterschreiben)
          </SecondaryButton>
        </div>

        <Card className="p-6">
          <div className="mb-4 text-sm leading-relaxed text-slate-700">
            <p className="mb-2">zwischen</p>
            <p className="font-semibold">{kunde.firma}</p>
            {kunde.ansprechpartner && kunde.ansprechpartner !== kunde.firma && <p>vertreten durch {kunde.ansprechpartner}</p>}
            <p className="mb-3 text-slate-500">{GEHEIMHALTUNG.parteiBezeichnung}</p>
            <p className="mb-2">und</p>
            <p className="font-semibold">Andreas Mayer Holding UG</p>
            <p>{KANZLEI_ANSCHRIFT}</p>
            <p className="mb-3 text-slate-500">{GEHEIMHALTUNG.auftraggeberBezeichnung}</p>
            <p>{GEHEIMHALTUNG.ueberleitung}</p>
          </div>

          <div className="mb-4 space-y-3 rounded-lg bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
            {GEHEIMHALTUNG.paragraphen.map((par) => (
              <div key={par.titel}>
                <p className="font-semibold text-slate-700">{par.titel}</p>
                <p>{par.text}</p>
              </div>
            ))}
            <p>{GEHEIMHALTUNG.schluss}</p>
          </div>

          <div className="print:hidden">
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Unterschrift Auftragnehmer/Dienstleister *</label>
            <SignaturePad onChange={setSignatur} />
          </div>
          <div className="hidden print:block print:mt-8">
            <p className="text-sm text-slate-700">Ort, Datum: ________________________</p>
            <p className="mt-8 text-sm text-slate-700">Auftraggeber: ________________________________</p>
            <p className="mt-8 text-sm text-slate-700">Auftragnehmer/Dienstleister: ________________________________</p>
          </div>

          {error && <p className="mb-3 mt-3 text-sm font-medium text-rose-600">{error}</p>}

          <PrimaryButton onClick={submit} disabled={senden} className="mt-4 w-full justify-center print:hidden">
            {senden ? 'Wird übermittelt …' : 'Vereinbarung unterschreiben & absenden'}
          </PrimaryButton>
          <p className="hidden print:block print:mt-4 print:text-xs print:text-slate-400">
            Bitte ausgedruckt, handschriftlich ausgefüllt und unterschrieben an die Andreas Mayer Holding zurückgeben (per Post, persönlich oder eingescannt per E-Mail).
          </p>
        </Card>
      </div>
    </div>
  )
}
