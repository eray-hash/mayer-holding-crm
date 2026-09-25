import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, Field, inputClass, PrimaryButton } from '../../components/ui'
import { ERBEN_CHECKLISTE } from '../../data/seedErben'
import { today, uid } from '../../lib/dates'

export function PublicMandantenfragebogenErben() {
  const { mandantId } = useParams()
  const { state, dispatch } = useApp()
  const [submitted, setSubmitted] = useState(false)

  const mandant = state.erbenMandanten.find((k) => k.id === mandantId)
  const [checkliste, setCheckliste] = useState<Record<string, boolean>>(mandant?.unterlagenCheckliste ?? {})
  const [anmerkungen, setAnmerkungen] = useState('')

  if (!mandant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Link ungültig</h1>
          <p className="text-sm text-slate-500">Dieser Fragebogen-Link ist nicht mehr gültig. Bitte fordern Sie einen neuen Link an.</p>
        </Card>
      </div>
    )
  }

  const alleItems = ERBEN_CHECKLISTE.flatMap((g) => g.punkte)
  const erledigtCount = alleItems.filter((p) => checkliste[p]).length

  function toggle(punkt: string) {
    setCheckliste((c) => ({ ...c, [punkt]: !c[punkt] }))
  }

  function submit() {
    const activityText = `Mandantenfragebogen digital ausgefüllt (${erledigtCount}/${alleItems.length} Punkte vorhanden).${
      anmerkungen ? ` Anmerkung: ${anmerkungen}` : ''
    }`

    dispatch({
      type: 'UPDATE_ERBEN_MANDANT',
      id: mandant!.id,
      patch: {
        unterlagenCheckliste: checkliste,
        letzteAktivitaet: today(),
        activities: [{ id: uid('act'), date: today(), text: activityText, user: `${mandant!.ansprechpartner} (Formular)` }, ...mandant!.activities],
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
            Ihre Angaben ({erledigtCount} von {alleItems.length} Punkten) wurden übermittelt und sind direkt in Ihrer
            Mandantenakte hinterlegt.
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
          <h1 className="mt-1 text-xl font-bold text-slate-800">Mandantenfragebogen</h1>
          <p className="text-sm text-slate-500">Vermögens-, Familien- und Nachfolgeplanung</p>
        </div>

        <Card className="p-6">
          <p className="mb-4 text-sm text-slate-500">
            Für <strong>{mandant.ansprechpartner}</strong> ({mandant.firma}). Bitte kreuzen Sie an, welche Angaben bzw.
            Unterlagen bei Ihnen bereits vorliegen — {erledigtCount} von {alleItems.length} bereits erfasst.
          </p>

          <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-accent-500 transition-all" style={{ width: `${(erledigtCount / alleItems.length) * 100}%` }} />
          </div>

          <div className="space-y-5">
            {ERBEN_CHECKLISTE.map((gruppe) => (
              <div key={gruppe.kategorie}>
                <h4 className="mb-2 text-sm font-semibold text-slate-700">{gruppe.kategorie}</h4>
                <div className="space-y-1.5">
                  {gruppe.punkte.map((punkt) => (
                    <label key={punkt} className="flex items-start gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={!!checkliste[punkt]} onChange={() => toggle(punkt)} className="mt-0.5 rounded" />
                      <span className={checkliste[punkt] ? 'text-slate-400 line-through' : ''}>{punkt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-slate-100 pt-5">
            <Field label="Anmerkungen (optional)">
              <textarea className={inputClass} rows={3} value={anmerkungen} onChange={(e) => setAnmerkungen(e.target.value)} />
            </Field>
          </div>

          <PrimaryButton onClick={submit} className="mt-2 w-full justify-center">
            Angaben absenden
          </PrimaryButton>
        </Card>
      </div>
    </div>
  )
}
