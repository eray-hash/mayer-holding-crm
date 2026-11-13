import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, Printer } from 'lucide-react'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { holePublicKunde, sendePublicFormular, type PublicKunde } from '../../lib/emailGateway'
import { generateDokumentPdf } from '../../lib/generateDokumentPdf'
import { today } from '../../lib/dates'
import { KANZLEI_ANSCHRIFT, VOLLMACHT_BANK, VOLLMACHT_FINANZAMT } from '../../data/originalTexte'

type VollmachtTyp = 'finanzamt' | 'bank'

const TITEL: Record<VollmachtTyp, string> = {
  finanzamt: VOLLMACHT_FINANZAMT.titel,
  bank: VOLLMACHT_BANK.titel,
}

// Der vollständige Wortlaut mit den eingesetzten Angaben — für das PDF an die Behörde. Derselbe Text
// steht im Formular auf dem Bildschirm (Wortlaut aus dem Original der Kanzlei, siehe data/originalTexte.ts).
function wortlaut(typ: VollmachtTyp, a: { name: string; geburtsdatum: string; adresse: string; steuernummer: string; bank: string }): string {
  if (typ === 'finanzamt') {
    const v = VOLLMACHT_FINANZAMT
    return [
      `${v.einleitung} ${a.name}`,
      `Geburtsdatum: ${a.geburtsdatum}`,
      `Adresse: ${a.adresse}`,
      `Steuernummer: ${a.steuernummer}`,
      '',
      ...v.bevollmaechtigter,
      '',
      v.auftrag,
      '',
      v.rechteEinleitung,
      ...v.rechte.map((r) => `• ${r}`),
      '',
      v.geltung,
    ].join('\n')
  }
  const v = VOLLMACHT_BANK
  return [
    `Vollmachtgeber: ${a.name}`,
    `wohnhaft: ${a.adresse}`,
    '',
    ...v.bevollmaechtigter,
    '',
    v.erteilung.replace('{name}', a.name).replace('{bank}', a.bank),
    '',
    v.rechteEinleitung,
    ...v.rechte.map((r) => `• ${r}`),
    '',
    v.geltung,
  ].join('\n')
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
  const [bank, setBank] = useState('')
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
    if (!adresse.trim() || (gueltigerTyp === 'finanzamt' && (!geburtsdatum.trim() || !steuernummer.trim())) || (gueltigerTyp === 'bank' && !bank.trim())) {
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
        : `Wohnhaft: ${adresse}, Bank: ${bank}.`

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
          felder.push({ label: 'Wohnhaft', value: adresse }, { label: 'Bank', value: bank })
        }
        const pdf = generateDokumentPdf({
          titel: TITEL[gueltigerTyp],
          absatzVorFeldern: `Diese Vollmacht wird für ${kunde!.ansprechpartner} (${kunde!.firma}) erstellt.`,
          felder,
          erlaeuterung: wortlaut(gueltigerTyp, { name: kunde!.ansprechpartner, geburtsdatum, adresse, steuernummer, bank }),
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
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · {KANZLEI_ANSCHRIFT}</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">{TITEL[gueltigerTyp]}</h1>
        </div>

        <div className="mb-3 flex justify-end print:hidden">
          <SecondaryButton onClick={() => window.print()} className="gap-1.5 text-xs">
            <Printer size={13} /> Zum Ausdrucken (handschriftlich ausfüllen & unterschreiben)
          </SecondaryButton>
        </div>

        <Card className="p-6">
          {gueltigerTyp === 'finanzamt' ? (
            <div className="text-sm leading-relaxed text-slate-700">
              <p className="mb-3">
                {VOLLMACHT_FINANZAMT.einleitung} <strong>{kunde.ansprechpartner}</strong>
              </p>
              <Field label="Geburtsdatum *">
                <input type="date" className={inputClass} value={geburtsdatum} onChange={(e) => setGeburtsdatum(e.target.value)} />
              </Field>
              <Field label="Adresse *">
                <input className={inputClass} value={adresse} onChange={(e) => setAdresse(e.target.value)} />
              </Field>
              <Field label="Steuernummer *">
                <input className={inputClass} value={steuernummer} onChange={(e) => setSteuernummer(e.target.value)} />
              </Field>
              <div className="mb-3 rounded-lg bg-slate-50 p-3">
                {VOLLMACHT_FINANZAMT.bevollmaechtigter.map((z) => (
                  <div key={z}>{z}</div>
                ))}
              </div>
              <p className="mb-3">{VOLLMACHT_FINANZAMT.auftrag}</p>
              <p className="mb-1">{VOLLMACHT_FINANZAMT.rechteEinleitung}</p>
              <ul className="mb-3 list-disc space-y-0.5 pl-5">
                {VOLLMACHT_FINANZAMT.rechte.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mb-4">{VOLLMACHT_FINANZAMT.geltung}</p>
            </div>
          ) : (
            <div className="text-sm leading-relaxed text-slate-700">
              <p className="mb-3">
                Vollmachtgeber: <strong>{kunde.ansprechpartner}</strong>
              </p>
              <Field label="wohnhaft *">
                <input className={inputClass} value={adresse} onChange={(e) => setAdresse(e.target.value)} />
              </Field>
              <div className="mb-3 rounded-lg bg-slate-50 p-3">
                {VOLLMACHT_BANK.bevollmaechtigter.map((z) => (
                  <div key={z}>{z}</div>
                ))}
              </div>
              <Field label="Bank *">
                <input className={inputClass} value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Name der Bank" />
              </Field>
              <p className="mb-3">
                {VOLLMACHT_BANK.erteilung.replace('{name}', kunde.ansprechpartner).replace('{bank}', bank.trim() || '______________')}
              </p>
              <p className="mb-1">{VOLLMACHT_BANK.rechteEinleitung}</p>
              <ul className="mb-3 list-disc space-y-0.5 pl-5">
                {VOLLMACHT_BANK.rechte.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mb-4">{VOLLMACHT_BANK.geltung}</p>
            </div>
          )}

          <div className="print:hidden">
            <Field label="Unterschrift Vollmachtgeber *">
              <SignaturePad onChange={setSignatur} />
            </Field>
          </div>
          <div className="hidden print:block print:mt-8">
            <p className="text-sm text-slate-700">Ort, Datum: ________________________</p>
            <p className="mt-8 text-sm text-slate-700">Unterschrift Vollmachtgeber: ________________________________</p>
            {gueltigerTyp === 'bank' && <p className="mt-8 text-sm text-slate-700">Unterschrift bevollmächtigte Person: ________________________________</p>}
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
