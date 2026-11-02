import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Printer } from 'lucide-react'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import { Card, PrimaryButton, SecondaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { holePublicKunde, sendePublicFormular, type PublicKunde } from '../../lib/emailGateway'
import type { KundeBereich } from '../../types'

// Dieselbe Geheimhaltungs- und Quellenschutzvereinbarung wie die bestehende interne Vorlage
// (src/data/seedBeratung.ts, "geheimhaltungsvereinbarung") — hier als öffentliches, signierbares
// Formular statt nur als Text-Vorlage im CRM.
const NDA_TEXT_TEILE = [
  '§ 1 Gegenstand des Vertrages',
  'Die Parteien bestätigen unwiderruflich und rechtsverbindlich vollen Quellen-, Kunden-, Objekt- und Courtageschutz für alle im Rahmen der Geschäftstätigkeit erschlossenen Quellen, Firmen und Personen. Der Schutz gilt auch dann, wenn es aus welchem Grund auch immer nicht zum angestrebten Geschäftsabschluss kommen sollte.',
  '§ 2 Nichtoffenbarung',
  'Jede Partei verpflichtet sich, die ihr von der anderen Seite bekannt gegebenen Adressen streng vertraulich zu behandeln und nicht ohne Zustimmung der anderen Partei zur Verwertung anzubieten. Ferner verpflichtet man sich, keine Geschäfte über vorgeschobene Dritte – gleichgültig ob nahestehende oder juristische Personen – mit den zu Objekten, Kunden/Aufträgen zur Verfügung gestellten Informationen abzuwickeln.',
  '§ 3 Verschwiegenheit beteiligter Personen',
  'Jede Vertragspartei zeichnet für die Verschwiegenheit und Einhaltungspflicht der für sie tätigen Angestellten, freiberuflichen Mitarbeiter sowie weiterer Vertragspersonen (Dritte) verantwortlich. Die Verschwiegenheitspflicht wirkt über die Vertragsdauer hinaus.',
  '§ 4 Direkte Kontaktaufnahme',
  'Direkte Kontaktaufnahme ist nur über die Firma zulässig. Sollte bereits ein Kontakt zum Geschäftspartner der anderen Seite bestehen, muss dies nach Bekanntgabe unverzüglich mitgeteilt werden. Dies entbindet nicht vom Kunden-/Objektschutz.',
  '§ 5 Schriftformerfordernis',
  'Über jegliche im Sinne dieses Vertrages sich anbahnenden Geschäfte unterrichtet der Geschäftspartner unverzüglich und unaufgefordert.',
  '§ 6 Konventionalstrafe',
  'Bei fahrlässigem Verstoß oder vorsätzlicher Zuwiderhandlung gegen diese Vereinbarung unterliegt die verstoßende Partei einer Konventionalstrafe in doppelter Höhe des jeweils erzielten Geschäftsvolumens, mindestens jedoch 20.000,00 €.',
  '§ 7 Weiterbeauftragung',
  'Unterbeauftragte dürfen nur in Abstimmung mit der anderen Partei beauftragt werden. Rechte und Pflichten aus dieser Vereinbarung sind entsprechend an Unterbeauftragte weiterzugeben und zu überwachen.',
  '§ 8 Vertragsdauer',
  'Diese Vereinbarung gilt zunächst für fünf Jahre ab Vertragsdatum und verlängert sich automatisch um jeweils ein Jahr, sofern sie nicht mit einer Frist von 3 Monaten zum jeweiligen Vertragsende gekündigt wird. Das Recht zur Kündigung aus wichtigem Grund bleibt unberührt.',
  '§ 9 Salvatorische Klausel',
  'Sollten einzelne Bestimmungen dieses Vertrages ganz oder teilweise unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.',
]

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
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstrasse 3, 89075 Ulm</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">Geheimhaltungs- und Quellenschutzvereinbarung</h1>
        </div>

        <div className="mb-3 flex justify-end print:hidden">
          <SecondaryButton onClick={() => window.print()} className="gap-1.5 text-xs">
            <Printer size={13} /> Zum Ausdrucken (handschriftlich ausfüllen & unterschreiben)
          </SecondaryButton>
        </div>

        <Card className="p-6">
          <p className="mb-4 text-sm text-slate-500">
            zwischen <strong>Andreas Mayer Holding</strong>, Schwabstrasse 3, 89075 Ulm (nachfolgend "Auftraggeber" genannt) und{' '}
            <strong>{kunde.ansprechpartner}</strong> ({kunde.firma}) (nachfolgend "Partei" genannt).
          </p>

          <div className="mb-4 space-y-3 rounded-lg bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">
            {NDA_TEXT_TEILE.map((teil, i) =>
              teil.startsWith('§') ? (
                <p key={i} className="font-semibold text-slate-600">{teil}</p>
              ) : (
                <p key={i}>{teil}</p>
              ),
            )}
          </div>

          <div className="print:hidden">
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Unterschrift *</label>
            <SignaturePad onChange={setSignatur} />
          </div>
          <div className="hidden print:block print:mt-8">
            <p className="text-sm text-slate-700">Ort, Datum: ________________________</p>
            <p className="mt-8 text-sm text-slate-700">Unterschrift: ________________________________</p>
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
