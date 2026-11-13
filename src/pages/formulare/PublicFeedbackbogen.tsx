import { useState } from 'react'
import { CheckCircle2, Printer } from 'lucide-react'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { addDays, fmtDate, today } from '../../lib/dates'
import { erstellePublicLead } from '../../lib/emailGateway'
import type { Prioritaet } from '../../types'
import { FEEDBACKBOGEN as F } from '../../data/originalTexte'

// Wortlaut und Aufbau wie im Original-Feedbackbogen der Kanzlei (data/originalTexte.ts).
type JaNein = 'ja' | 'nein' | ''

export function PublicFeedbackbogen() {
  const [submitted, setSubmitted] = useState(false)
  const [senden, setSenden] = useState(false)

  const [veranstaltung, setVeranstaltung] = useState('Vermögensschutz in unsicheren Zeiten')
  const [datum, setDatum] = useState(today())
  const [anrede, setAnrede] = useState('')
  const [name, setName] = useState('')
  const [telefon, setTelefon] = useState('')
  const [email, setEmail] = useState('')
  const [feedback, setFeedback] = useState<Record<string, JaNein>>({})
  // Tabelle "Kriterien (unternehmerisch)": je Zeile Anzahl und ungefährer Wert.
  const [unternehmerisch, setUnternehmerisch] = useState<Record<string, { anzahl: string; wert: string }>>({})
  const [offenesFeedback, setOffenesFeedback] = useState('')
  const [familienstand, setFamilienstand] = useState('')
  const [kinder, setKinder] = useState('')
  const [ehevertrag, setEhevertrag] = useState<JaNein>('')
  const [nachfolgeGeregelt, setNachfolgeGeregelt] = useState<JaNein>('')
  const [terminWunsch, setTerminWunsch] = useState<JaNein>('')
  const [einverstanden, setEinverstanden] = useState(false)
  const [signatur, setSignatur] = useState<string | null>(null)
  const [error, setError] = useState('')

  function setzeUnternehmerisch(zeile: string, feld: 'anzahl' | 'wert', wert: string) {
    setUnternehmerisch((u) => ({ ...u, [zeile]: { anzahl: u[zeile]?.anzahl ?? '', wert: u[zeile]?.wert ?? '', [feld]: wert } }))
  }

  async function submit() {
    // Pflichtfelder wie im Original mit Stern gekennzeichnet.
    if (!veranstaltung.trim() || !datum || !anrede || !name.trim() || !telefon.trim() || !email.trim()) {
      setError('Bitte alle Felder mit Stern ausfüllen: Veranstaltung, Datum, Anrede, Name, Telefon und E-Mail.')
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
    setSenden(true)

    const bewertet = F.kriterien.filter((k) => feedback[k]).map((k) => `${k}: ${feedback[k] === 'ja' ? 'JA' : 'NEIN'}`)
    const unternehmen = F.unternehmerisch.zeilen
      .filter((z) => unternehmerisch[z]?.anzahl || unternehmerisch[z]?.wert)
      .map((z) => `${z}: Anzahl ${unternehmerisch[z]?.anzahl || '–'}, ca. Wert ${unternehmerisch[z]?.wert || '–'}`)
    const prioritaet: Prioritaet = terminWunsch === 'ja' ? 'Hoch' : 'Niedrig'

    const activityLines = [
      `Feedbackbogen "${veranstaltung}" vom ${fmtDate(datum)} digital ausgefüllt und unterschrieben (${anrede} ${name}).`,
      bewertet.length > 0 ? `Feedback: ${bewertet.join('; ')}.` : '',
      unternehmen.length > 0 ? `Aufstellung unternehmerisch: ${unternehmen.join('; ')}.` : '',
      offenesFeedback ? `Größte Erkenntnis: „${offenesFeedback}"` : '',
      familienstand || kinder || ehevertrag || nachfolgeGeregelt
        ? `Aufstellung persönlich: Familienstand ${familienstand || '–'}, Kinder ${kinder || '–'}, Ehevertrag ${ehevertrag || '–'}, Nachfolge geregelt ${nachfolgeGeregelt || '–'}.`
        : '',
      `Beratungsgespräch (3.250 € zzgl. USt für Sichtung/Erstbewertung) gewünscht: ${terminWunsch === 'ja' ? 'Ja' : 'Nein'}.`,
    ].filter(Boolean)

    try {
      await erstellePublicLead({
        firma: name,
        ansprechpartner: name,
        email,
        telefon,
        prioritaet,
        followUp: {
          date: addDays(today(), terminWunsch === 'ja' ? 1 : 5),
          note: terminWunsch === 'ja' ? 'Rückruf: Termin für Beratungsgespräch vereinbaren' : 'Nachfassen nach Feedbackbogen',
          done: false,
        },
        aktivitaetText: activityLines.join(' '),
        aktivitaetUser: 'Kunde (Formular)',
        signatur: { name, dataUrl: signatur, kontext: `Feedbackbogen – ${veranstaltung}` },
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
          <h1 className="mt-1 text-xl font-bold text-slate-800">{F.titel}</h1>
        </div>

        <div className="mb-3 flex justify-end print:hidden">
          <SecondaryButton onClick={() => window.print()} className="gap-1.5 text-xs">
            <Printer size={13} /> Zum Ausdrucken (handschriftlich ausfüllen & unterschreiben)
          </SecondaryButton>
        </div>

        <Card className="p-6">
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Veranstaltung*">
              <input className={inputClass} value={veranstaltung} onChange={(e) => setVeranstaltung(e.target.value)} />
            </Field>
            <Field label="Datum*">
              <input type="date" className={inputClass} value={datum} onChange={(e) => setDatum(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Anrede*">
              <select className={inputClass} value={anrede} onChange={(e) => setAnrede(e.target.value)}>
                <option value="">– bitte wählen –</option>
                <option>Herr</option>
                <option>Frau</option>
                <option>Divers</option>
              </select>
            </Field>
            <div className="col-span-2">
              <Field label="Name*">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Telefon/ mobil*">
              <input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} />
            </Field>
            <Field label="E-Mail*">
              <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <p className="mb-4 text-xs text-slate-400">{F.pflichtHinweis}</p>

          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700">{F.abschnitt1}</h3>
          <table className="mb-1 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-2">Kriterium</th>
                <th className="w-12 py-1.5 text-center">JA</th>
                <th className="w-12 py-1.5 text-center">NEIN</th>
              </tr>
            </thead>
            <tbody>
              {F.kriterien.map((k) => (
                <tr key={k} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-2 text-slate-700">{k}</td>
                  {(['ja', 'nein'] as const).map((wert) => (
                    <td key={wert} className="py-1.5 text-center">
                      <input
                        type="radio"
                        name={`kriterium-${k}`}
                        aria-label={`${k}: ${wert === 'ja' ? 'JA' : 'NEIN'}`}
                        checked={feedback[k] === wert}
                        onChange={() => setFeedback((f) => ({ ...f, [k]: wert }))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mb-4 text-xs text-slate-400">{F.bewertungsHinweis}</p>

          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-700">{F.abschnitt2}</h3>
          <Field label={F.frageErkenntnis}>
            <textarea className={inputClass} rows={3} value={offenesFeedback} onChange={(e) => setOffenesFeedback(e.target.value)} />
          </Field>

          <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-700">{F.abschnitt3}</h3>
          <p className="mb-3 text-xs text-slate-500">{F.aufstellungHinweis}</p>
          <table className="mb-4 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
                <th className="py-1.5 pr-2">{F.unternehmerisch.kopf[0]}</th>
                <th className="w-24 py-1.5">{F.unternehmerisch.kopf[1]}</th>
                <th className="w-40 py-1.5">{F.unternehmerisch.kopf[2]}</th>
              </tr>
            </thead>
            <tbody>
              {F.unternehmerisch.zeilen.map((z) => (
                <tr key={z} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-2 text-slate-700">{z}</td>
                  <td className="py-1 pr-2">
                    <input className={inputClass} aria-label={`${z}: Anzahl`} value={unternehmerisch[z]?.anzahl ?? ''} onChange={(e) => setzeUnternehmerisch(z, 'anzahl', e.target.value)} />
                  </td>
                  <td className="py-1">
                    <input className={inputClass} aria-label={`${z}: ca. Wert`} value={unternehmerisch[z]?.wert ?? ''} onChange={(e) => setzeUnternehmerisch(z, 'wert', e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mb-2 text-xs font-medium text-slate-500">{F.persoenlich.kopf}</p>
          <div className="mb-4 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label={F.persoenlich.zeilen[0]}>
              <select className={inputClass} value={familienstand} onChange={(e) => setFamilienstand(e.target.value)}>
                <option value="">– bitte wählen –</option>
                <option value="verheiratet">verheiratet</option>
                <option value="geschieden">geschieden</option>
                <option value="verwitwet">verwitwet</option>
                <option value="ledig">ledig</option>
              </select>
            </Field>
            <Field label={F.persoenlich.zeilen[1]}>
              <input className={inputClass} value={kinder} onChange={(e) => setKinder(e.target.value)} />
            </Field>
            <Field label={F.persoenlich.zeilen[2]}>
              <select className={inputClass} value={ehevertrag} onChange={(e) => setEhevertrag(e.target.value as JaNein)}>
                <option value="">– bitte wählen –</option>
                <option value="ja">Ja</option>
                <option value="nein">Nein</option>
              </select>
            </Field>
            <Field label={F.persoenlich.zeilen[3]}>
              <select className={inputClass} value={nachfolgeGeregelt} onChange={(e) => setNachfolgeGeregelt(e.target.value as JaNein)}>
                <option value="">– bitte wählen –</option>
                <option value="ja">Ja</option>
                <option value="nein">Nein</option>
              </select>
            </Field>
          </div>

          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-700">{F.abschnitt4}</h3>
          <p className="mb-2 text-sm text-slate-600">{F.anspruch}</p>
          <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
            <p>
              {F.kosten} <strong>{F.betrag}</strong>
            </p>
            <p>{F.verrechnung}</p>
          </div>
          <div className="mb-4 space-y-1.5 text-sm text-slate-700">
            <label className="flex items-start gap-2">
              <input type="radio" name="termin" className="mt-1" checked={terminWunsch === 'ja'} onChange={() => setTerminWunsch('ja')} />
              {F.ja}
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="termin" className="mt-1" checked={terminWunsch === 'nein'} onChange={() => setTerminWunsch('nein')} />
              {F.nein}
            </label>
          </div>

          <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-700">{F.abschnitt5}</h3>
          <label className="mb-3 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={einverstanden} onChange={(e) => setEinverstanden(e.target.checked)} className="mt-0.5 rounded" />
            {F.einverstaendnis} *
          </label>
          <p className="mb-4 text-xs leading-relaxed text-slate-500">{F.datenschutz}</p>

          <div className="print:hidden">
            <Field label={`${F.unterschrift} *`}>
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
