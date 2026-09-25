import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, Field, inputClass, PrimaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { MITARBEITER } from '../../data/constants'
import { addDays, today, uid } from '../../lib/dates'
import type { Prioritaet } from '../../types'

const FEEDBACK_KRITERIEN = [
  'Verständlichkeit der Inhalte',
  'Praxisrelevanz für meine Situation',
  'Ist es Ihnen bewusst, wie viel Geld Sie in der Vergangenheit verschenkt haben?',
  'Nutzen für meine persönliche Planung',
]

export function PublicFeedbackbogen() {
  const { dispatch } = useApp()
  const [submitted, setSubmitted] = useState(false)

  const [veranstaltung, setVeranstaltung] = useState('Vermögensschutz in unsicheren Zeiten')
  const [anrede, setAnrede] = useState('Herr')
  const [name, setName] = useState('')
  const [telefon, setTelefon] = useState('')
  const [email, setEmail] = useState('')
  const [feedback, setFeedback] = useState<Record<string, boolean>>({})
  const [offenesFeedback, setOffenesFeedback] = useState('')
  const [familienstand, setFamilienstand] = useState('')
  const [kinder, setKinder] = useState('')
  const [ehevertrag, setEhevertrag] = useState<'ja' | 'nein' | ''>('')
  const [nachfolgeGeregelt, setNachfolgeGeregelt] = useState<'ja' | 'nein' | ''>('')
  const [terminWunsch, setTerminWunsch] = useState<'ja' | 'nein' | ''>('')
  const [einverstanden, setEinverstanden] = useState(false)
  const [signatur, setSignatur] = useState<string | null>(null)
  const [error, setError] = useState('')

  function toggleFeedback(k: string) {
    setFeedback((f) => ({ ...f, [k]: !f[k] }))
  }

  function submit() {
    if (!name.trim() || !email.trim()) {
      setError('Bitte Name und E-Mail ausfüllen.')
      return
    }
    if (!einverstanden) {
      setError('Bitte dem Einverständnis zur Kontaktaufnahme zustimmen.')
      return
    }
    if (!signatur) {
      setError('Bitte unten unterschreiben, bevor Sie absenden.')
      return
    }
    setError('')

    const angekreuzt = FEEDBACK_KRITERIEN.filter((k) => feedback[k])
    const prioritaet: Prioritaet = terminWunsch === 'ja' ? 'Hoch' : 'Niedrig'

    const activityLines = [
      `Feedbackbogen "${veranstaltung}" digital ausgefüllt und unterschrieben.`,
      angekreuzt.length > 0 ? `Feedback: ${angekreuzt.join('; ')}.` : '',
      offenesFeedback ? `Größte Erkenntnis: „${offenesFeedback}"` : '',
      familienstand || kinder || ehevertrag || nachfolgeGeregelt
        ? `Aufstellung: Familienstand ${familienstand || '–'}, Kinder ${kinder || '–'}, Ehevertrag ${ehevertrag || '–'}, Nachfolge geregelt ${nachfolgeGeregelt || '–'}.`
        : '',
      `Beratungsgespräch (3.250 € zzgl. USt für Sichtung/Erstbewertung) gewünscht: ${terminWunsch === 'ja' ? 'Ja' : 'Nein'}.`,
    ].filter(Boolean)

    dispatch({
      type: 'ADD_KUNDE',
      kunde: {
        id: uid('k'),
        firma: name,
        ansprechpartner: name,
        email,
        telefon,
        prioritaet,
        status: 'lead',
        followUp: {
          date: addDays(today(), terminWunsch === 'ja' ? 1 : 5),
          note: terminWunsch === 'ja' ? 'Rückruf: Termin für Beratungsgespräch vereinbaren' : 'Nachfassen nach Feedbackbogen',
          done: false,
        },
        verantwortlich: MITARBEITER[0],
        letzteAktivitaet: today(),
        activities: [{ id: uid('act'), date: today(), text: activityLines.join(' '), user: 'Kunde (Formular)' }],
        signaturen: [{ id: uid('sig'), name, dataUrl: signatur, datum: today(), kontext: `Feedbackbogen – ${veranstaltung}` }],
      },
    })

    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={40} />
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Vielen Dank, {name}!</h1>
          <p className="text-sm text-slate-500">
            Ihr Feedbackbogen wurde übermittelt und ist direkt im CRM als neue Anfrage hinterlegt.
            {terminWunsch === 'ja'
              ? ' Wir melden uns in Kürze bei Ihnen, um einen Termin für das Beratungsgespräch zu vereinbaren.'
              : ' Falls Sie es sich anders überlegen, erreichen Sie uns jederzeit.'}
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Mayer Consulting</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">Feedbackbogen – {veranstaltung}</h1>
        </div>

        <Card className="p-6">
          <Field label="Veranstaltung">
            <input className={inputClass} value={veranstaltung} onChange={(e) => setVeranstaltung(e.target.value)} />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Anrede">
              <select className={inputClass} value={anrede} onChange={(e) => setAnrede(e.target.value)}>
                <option>Herr</option>
                <option>Frau</option>
                <option>Divers</option>
              </select>
            </Field>
            <div className="col-span-2">
              <Field label="Name *">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefon / Mobil">
              <input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} />
            </Field>
            <Field label="E-Mail *">
              <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700">1. Allgemeines Feedback zum Vortrag</h3>
          <div className="mb-4 space-y-1.5">
            {FEEDBACK_KRITERIEN.map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={!!feedback[k]} onChange={() => toggleFeedback(k)} className="mt-0.5 rounded" />
                {k}
              </label>
            ))}
          </div>

          <Field label="2. Offenes Feedback — Welcher Impuls hat Ihnen die größte Erkenntnis gebracht?">
            <textarea
              className={inputClass}
              rows={3}
              value={offenesFeedback}
              onChange={(e) => setOffenesFeedback(e.target.value)}
            />
          </Field>

          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-700">3. Ihre momentane Aufstellung</h3>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Field label="Familienstand">
              <select className={inputClass} value={familienstand} onChange={(e) => setFamilienstand(e.target.value)}>
                <option value="">– bitte wählen –</option>
                <option value="verheiratet">Verheiratet</option>
                <option value="geschieden">Geschieden</option>
                <option value="verwitwet">Verwitwet</option>
                <option value="ledig">Ledig</option>
              </select>
            </Field>
            <Field label="Kinder (Anzahl/Alter)">
              <input className={inputClass} value={kinder} onChange={(e) => setKinder(e.target.value)} />
            </Field>
            <Field label="Ehevertrag vorhanden?">
              <select className={inputClass} value={ehevertrag} onChange={(e) => setEhevertrag(e.target.value as 'ja' | 'nein' | '')}>
                <option value="">– bitte wählen –</option>
                <option value="ja">Ja</option>
                <option value="nein">Nein</option>
              </select>
            </Field>
            <Field label="Unternehmensnachfolge geregelt?">
              <select
                className={inputClass}
                value={nachfolgeGeregelt}
                onChange={(e) => setNachfolgeGeregelt(e.target.value as 'ja' | 'nein' | '')}
              >
                <option value="">– bitte wählen –</option>
                <option value="ja">Ja</option>
                <option value="nein">Nein</option>
              </select>
            </Field>
          </div>

          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-700">4. Beratungsgespräch / Kosten</h3>
          <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
            Für die Sichtung Ihrer Unterlagen und eine Erstbewertung erheben wir eine Aufwandsentschädigung in Höhe von{' '}
            <strong>3.250 € zzgl. gesetzlicher Mehrwertsteuer</strong>. Bei Umsetzung und Auftragserteilung wird diese vollständig
            verrechnet.
          </p>
          <div className="mb-4 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="termin" checked={terminWunsch === 'ja'} onChange={() => setTerminWunsch('ja')} />
              Ja, ich möchte einen Termin vereinbaren
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="termin" checked={terminWunsch === 'nein'} onChange={() => setTerminWunsch('nein')} />
              Nein, aktuell kein Interesse
            </label>
          </div>

          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-700">5. Einverständnis &amp; Datenschutz</h3>
          <label className="mb-4 flex items-start gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={einverstanden} onChange={(e) => setEinverstanden(e.target.checked)} className="mt-0.5 rounded" />
            Ich bin damit einverstanden, dass meine Angaben zur Kontaktaufnahme genutzt werden. *
          </label>
          <p className="mb-4 text-xs text-slate-400">
            Ihre Daten werden ausschließlich zum Zweck der Kontaktaufnahme und zur Vereinbarung eines Beratungsgesprächs
            gespeichert und verarbeitet. Eine Weitergabe an Dritte erfolgt nicht.
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
