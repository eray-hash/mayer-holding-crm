import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Card, Field, inputClass, PrimaryButton } from '../../components/ui'
import { ERBEN_CHECKLISTE, KANZLEI_ANSCHRIFT, MANDANTENFRAGEBOGEN_ERBEN as F } from '../../data/originalTexte'
import { holePublicKunde, sendePublicFormular, type PublicKunde } from '../../lib/emailGateway'

export function PublicMandantenfragebogenErben() {
  const { mandantId } = useParams()
  const [mandant, setMandant] = useState<PublicKunde | null | undefined>(undefined)
  const [submitted, setSubmitted] = useState(false)
  const [senden, setSenden] = useState(false)
  const [checkliste, setCheckliste] = useState<Record<string, boolean>>({})
  const [anmerkungen, setAnmerkungen] = useState('')
  const [vermoegen, setVermoegen] = useState('')
  const [ziele, setZiele] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!mandantId) return
    holePublicKunde('erben', mandantId)
      .then((k) => {
        setMandant(k)
        if (k?.unterlagenCheckliste) setCheckliste(k.unterlagenCheckliste)
      })
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

  async function submit() {
    setError('')
    setSenden(true)
    const activityText = [
      `Mandantenfragebogen digital ausgefüllt (${erledigtCount}/${alleItems.length} Punkte vorhanden).`,
      vermoegen.trim() ? `Vermögensübersicht: ${vermoegen.trim()}` : '',
      ziele.trim() ? `Ziele und offene Fragen: ${ziele.trim()}` : '',
      anmerkungen.trim() ? `Bemerkung: ${anmerkungen.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' ')
    try {
      await sendePublicFormular({
        bereich: 'erben',
        kundeId: mandantId!,
        aktivitaetText: activityText,
        aktivitaetUser: `${mandant!.ansprechpartner} (Formular)`,
        unterlagenCheckliste: checkliste,
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
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · {KANZLEI_ANSCHRIFT}</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">{F.titel}</h1>
          <p className="text-sm text-slate-500">{F.untertitel}</p>
        </div>

        <Card className="p-6">
          <p className="mb-4 text-sm leading-relaxed text-slate-600">{F.einleitung}</p>
          <div className="mb-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <p className="mb-1 font-semibold text-slate-700">{F.umfangTitel}</p>
            <p className="mb-3">{F.umfang}</p>
            <p className="mb-1 font-semibold text-slate-700">{F.datenschutzTitel}</p>
            {F.datenschutz.map((absatz) => (
              <p key={absatz.slice(0, 30)} className="mb-2 last:mb-0">
                {absatz}
              </p>
            ))}
          </div>
          <p className="mb-2 text-sm text-slate-500">
            Für <strong>{mandant.ansprechpartner}</strong> ({mandant.firma}). Bitte kreuzen Sie an, was vorliegt — {erledigtCount} von{' '}
            {alleItems.length} angekreuzt.
          </p>

          <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-accent-500 transition-all" style={{ width: `${(erledigtCount / alleItems.length) * 100}%` }} />
          </div>

          {/* Reihenfolge wie im Original: Abschnitte 1–3, dann die Vermögensübersicht (4), dann 5–6, zuletzt 7. */}
          <div className="space-y-5">
            {ERBEN_CHECKLISTE.slice(0, 3).map((gruppe) => (
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
            <div>
              <h4 className="mb-1 text-sm font-semibold text-slate-700">{F.vermoegenTitel}</h4>
              <p className="mb-2 text-sm text-slate-600">{F.vermoegenEinleitung}</p>
              <textarea className={inputClass} rows={5} value={vermoegen} onChange={(e) => setVermoegen(e.target.value)} />
              <p className="mb-4 mt-1 text-xs text-slate-500">{F.vermoegenBereiche}</p>
            </div>
            {ERBEN_CHECKLISTE.slice(3).map((gruppe) => (
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
            <h4 className="mb-1 text-sm font-semibold text-slate-700">{F.zieleTitel}</h4>
            <p className="mb-2 text-sm text-slate-600">{F.zieleFrage}</p>
            <textarea className={inputClass} rows={4} value={ziele} onChange={(e) => setZiele(e.target.value)} />

            <div className="mt-4">
              <Field label="Bemerkung (z. B. „Nicht vorhanden“, „Wird nachgereicht bis …“)">
                <textarea className={inputClass} rows={3} value={anmerkungen} onChange={(e) => setAnmerkungen(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-slate-500">{F.schlussHinweis}</p>
            <p className="mt-2 text-xs font-medium text-slate-400">{F.fusszeile}</p>
          </div>

          {error && <p className="mb-3 text-sm font-medium text-rose-600">{error}</p>}

          <PrimaryButton onClick={submit} disabled={senden} className="mt-2 w-full justify-center">
            {senden ? 'Wird übermittelt …' : 'Angaben absenden'}
          </PrimaryButton>
        </Card>
      </div>
    </div>
  )
}
