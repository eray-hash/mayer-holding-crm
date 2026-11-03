import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, XCircle, Home } from 'lucide-react'
import { Card, PrimaryButton, SecondaryButton } from '../../components/ui'
import { fmtEUR } from '../../lib/dates'
import { gruppeLabel } from '../../data/constants'
import { holePublicVorschlag, entscheidePublicVorschlag, type PublicVorschlag, type PublicExposeObjekt } from '../../lib/emailGateway'

export function PublicExpose() {
  const { vorschlagId } = useParams()
  const [geladen, setGeladen] = useState(false)
  const [vorschlag, setVorschlag] = useState<PublicVorschlag | null>(null)
  const [objekt, setObjekt] = useState<PublicExposeObjekt | null>(null)
  const [entscheidet, setEntscheidet] = useState(false)
  const [entschieden, setEntschieden] = useState<'akzeptiert' | 'abgelehnt' | null>(null)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    if (!vorschlagId) return
    holePublicVorschlag(vorschlagId)
      .then(({ vorschlag, objekt }) => {
        setVorschlag(vorschlag)
        setObjekt(objekt)
      })
      .catch(() => {
        setVorschlag(null)
        setObjekt(null)
      })
      .finally(() => setGeladen(true))
  }, [vorschlagId])

  async function entscheiden(wahl: 'akzeptiert' | 'abgelehnt') {
    if (!vorschlagId) return
    setEntscheidet(true)
    setFehler('')
    try {
      const { status } = await entscheidePublicVorschlag(vorschlagId, wahl)
      setEntschieden(status === 'offen' ? wahl : status)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Übermittlung fehlgeschlagen. Bitte versuchen Sie es erneut.')
    } finally {
      setEntscheidet(false)
    }
  }

  if (!geladen) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    )
  }

  if (!vorschlag || !objekt) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Link ungültig</h1>
          <p className="text-sm text-slate-500">Dieses Exposé ist nicht mehr verfügbar. Bitte fordern Sie einen neuen Link an.</p>
        </Card>
      </div>
    )
  }

  const ergebnis = entschieden ?? (vorschlag.status === 'offen' ? null : vorschlag.status)

  if (ergebnis) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          {ergebnis === 'akzeptiert' ? (
            <>
              <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={40} />
              <h1 className="mb-2 text-lg font-semibold text-slate-800">Vielen Dank, {vorschlag.kundeName}!</h1>
              <p className="text-sm text-slate-500">
                {objekt.bezeichnung} wurde Ihrem Portfolio zugewiesen. Wir melden uns zeitnah mit den nächsten Schritten.
              </p>
            </>
          ) : (
            <>
              <XCircle className="mx-auto mb-3 text-slate-400" size={40} />
              <h1 className="mb-2 text-lg font-semibold text-slate-800">Danke für Ihre Rückmeldung</h1>
              <p className="text-sm text-slate-500">Kein Problem — wir melden uns bei passenderen Objekten wieder bei Ihnen.</p>
            </>
          )}
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstrasse 3, 89075 Ulm</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">Exposé für Sie vorbereitet</h1>
        </div>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 p-5">
            <Home className="text-accent-600" size={28} />
            <div>
              <h2 className="text-lg font-semibold text-slate-800">{objekt.bezeichnung}</h2>
              <p className="text-sm text-slate-500">{objekt.adresse}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 p-5 text-sm">
            <div><div className="text-xs text-slate-400">Typ</div><div className="text-slate-700">{objekt.typ}</div></div>
            <div><div className="text-xs text-slate-400">Gruppe</div><div className="text-slate-700">{gruppeLabel(objekt.gruppe)}</div></div>
            <div><div className="text-xs text-slate-400">Kaufpreis</div><div className="font-medium text-slate-800">{fmtEUR(objekt.kaufpreis)}</div></div>
          </div>

          <div className="border-t border-slate-100 p-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Warum dieses Objekt für Sie interessant sein könnte</h3>
            <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">{vorschlag.steuerBegruendung}</p>
          </div>

          {fehler && <p className="px-5 pt-3 text-sm font-medium text-rose-600">{fehler}</p>}

          <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row">
            <PrimaryButton className="flex-1 justify-center" disabled={entscheidet} onClick={() => entscheiden('akzeptiert')}>
              Ja, ich bin einverstanden
            </PrimaryButton>
            <SecondaryButton className="flex-1 justify-center" disabled={entscheidet} onClick={() => entscheiden('abgelehnt')}>
              Kein Interesse
            </SecondaryButton>
          </div>
        </Card>
      </div>
    </div>
  )
}
