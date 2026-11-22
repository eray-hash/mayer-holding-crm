// Online-Unterschrift (22.11.2026): Der Kunde öffnet seinen Link, liest das vorbereitete Dokument, ergänzt seine
// Angaben, bestätigt „gelesen“, tippt seinen Namen und unterschreibt mit Finger oder Maus. Das unterschriebene PDF
// erzeugt der Server (email-gateway/unterschrift.ts) und legt es in die Akte.
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Download, Loader2, Lock, PenLine, XCircle } from 'lucide-react'
import { Card, PrimaryButton, SecondaryButton } from '../../components/ui'
import { SignaturePad } from '../../components/SignaturePad'
import { DatenschutzHinweis } from '../../components/DatenschutzHinweis'
import { UnterschriftDokument } from '../../components/UnterschriftDokument'
import { holeUnterschriftSeite, lehneUnterschriftAb, sendeUnterschrift, type UnterschriftSeite } from '../../lib/unterschrift'
import { zeitDe } from '../../../supabase/functions/_shared/unterschriftKern.ts'

function Kopf() {
  return <p className="mb-1 text-center text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstraße 3, 89075 Ulm</p>
}

const datum = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function PublicUnterschrift() {
  const { token } = useParams()
  const [seite, setSeite] = useState<UnterschriftSeite | null>(null)
  const [werte, setWerte] = useState<Record<string, string>>({})
  const [gelesen, setGelesen] = useState(false)
  const [name, setName] = useState('')
  const [unterschrift, setUnterschrift] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [ablehnen, setAblehnen] = useState(false)
  const [grund, setGrund] = useState('')

  useEffect(() => {
    if (!token) return
    holeUnterschriftSeite(token)
      .then(setSeite)
      .catch(() => setSeite({ stufe: 'ungueltig', grund: 'Die Seite lässt sich gerade nicht laden. Bitte versuchen Sie es später erneut.' }))
  }, [token])

  const fehlend = useMemo(() => (seite?.stufe === 'offen' ? seite.felder.filter((f) => f.pflicht && !(werte[f.name] ?? '').trim()).map((f) => f.name) : []), [seite, werte])
  const nameOk = name.trim().split(/\s+/).filter(Boolean).length >= 2 && name.trim().length >= 4

  async function absenden() {
    if (!token || !unterschrift) return
    setLaeuft(true)
    setFehler('')
    try {
      const s = await sendeUnterschrift(token, { gelesen, name: name.trim(), unterschrift, werte })
      setSeite(s)
      window.scrollTo({ top: 0 })
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.')
    } finally {
      setLaeuft(false)
    }
  }

  async function ablehnenSenden() {
    if (!token) return
    setLaeuft(true)
    setFehler('')
    try {
      setSeite(await lehneUnterschriftAb(token, grund.trim()))
      window.scrollTo({ top: 0 })
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.')
    } finally {
      setLaeuft(false)
    }
  }

  if (!seite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    )
  }

  if (seite.stufe === 'ungueltig') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <Lock className="mx-auto mb-3 text-slate-400" size={32} />
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Kein Zugang</h1>
          <p className="text-sm text-slate-500">{seite.grund}</p>
        </Card>
      </div>
    )
  }

  if (seite.stufe === 'unterschrieben') {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-md">
          <Kopf />
          <Card className="mt-3 p-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={40} />
            <h1 className="mb-2 text-lg font-semibold text-slate-800">Vielen Dank{seite.name ? `, ${seite.name}` : ''}!</h1>
            <p className="text-sm text-slate-600">
              Sie haben „{seite.titel}“ {seite.am ? `am ${zeitDe(seite.am)}` : ''} elektronisch unterschrieben. Wir haben das Dokument erhalten und melden uns bei Ihnen.
            </p>
            {seite.kopieUrl && (
              <a href={seite.kopieUrl} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700">
                <Download size={16} /> Ihre Kopie herunterladen (PDF)
              </a>
            )}
          </Card>
          <DatenschutzHinweis />
        </div>
      </div>
    )
  }

  if (seite.stufe === 'abgelehnt') {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-md">
          <Kopf />
          <Card className="mt-3 p-8 text-center">
            <XCircle className="mx-auto mb-3 text-slate-400" size={40} />
            <h1 className="mb-2 text-lg font-semibold text-slate-800">Ihre Rückmeldung ist angekommen</h1>
            <p className="text-sm text-slate-600">Sie haben uns mitgeteilt, dass Sie „{seite.titel}“ so nicht unterschreiben möchten. Wir melden uns bei Ihnen.</p>
          </Card>
          <DatenschutzHinweis />
        </div>
      </div>
    )
  }

  const bereit = gelesen && nameOk && !!unterschrift && fehlend.length === 0 && !laeuft
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <Kopf />
        <Card className="p-5">
          <h1 className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-800">
            <PenLine size={20} className="text-accent-600" /> {seite.titel}
          </h1>
          <p className="text-sm text-slate-600">
            {seite.anrede} wir bitten Sie, das folgende Dokument zu lesen{seite.felder.length > 0 ? ', die gelb markierten Angaben zu ergänzen' : ''} und unten zu unterschreiben. Ausdrucken und Einscannen ist nicht nötig. Der Link gilt bis {datum(seite.gueltigBis)}.
          </p>
        </Card>

        <UnterschriftDokument text={seite.text} kopfstil={seite.kopfstil} felder={seite.felder} werte={werte} onWert={(n, w) => setWerte((alt) => ({ ...alt, [n]: w }))} />

        {!ablehnen ? (
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Unterschreiben</h2>
            {fehlend.length > 0 && (
              <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Bitte im Dokument oben noch ausfüllen: {fehlend.join(', ')}.</p>
            )}
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={gelesen} onChange={(e) => setGelesen(e.target.checked)} />
              Ich habe das Dokument vollständig gelesen und bin mit seinem Inhalt einverstanden.
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Ihr vollständiger Vor- und Nachname</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" autoComplete="name" maxLength={120} />
            </label>
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-500">Ihre Unterschrift</span>
              <SignaturePad onChange={setUnterschrift} />
            </div>
            {fehler && <p className="text-sm font-medium text-rose-600">{fehler}</p>}
            <PrimaryButton className="w-full justify-center" disabled={!bereit} onClick={absenden}>
              {laeuft ? 'Wird gespeichert …' : 'Verbindlich unterschreiben'}
            </PrimaryButton>
            <p className="text-xs text-slate-400">
              Mit Klick auf „Verbindlich unterschreiben“ unterschreiben Sie das Dokument elektronisch. Als Nachweis speichern wir Datum und Uhrzeit, Ihren Namen, Ihre Unterschrift, Ihre IP-Adresse und die Angaben Ihres Browsers zusammen mit dem genauen Wortlaut.
            </p>
            <button type="button" onClick={() => { setAblehnen(true); setFehler('') }} className="text-xs text-slate-500 underline hover:text-slate-700">
              Ich möchte so nicht unterschreiben
            </button>
          </Card>
        ) : (
          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Nicht unterschreiben</h2>
            <p className="text-sm text-slate-600">Schade. Wenn Sie mögen, schreiben Sie uns kurz, woran es liegt oder was geändert werden soll. Wir melden uns dann bei Ihnen.</p>
            <textarea value={grund} onChange={(e) => setGrund(e.target.value)} rows={3} maxLength={300} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" aria-label="Grund" />
            {fehler && <p className="text-sm font-medium text-rose-600">{fehler}</p>}
            <div className="flex flex-wrap gap-2">
              <PrimaryButton onClick={ablehnenSenden} disabled={laeuft}>{laeuft ? 'Wird gesendet …' : 'Rückmeldung senden'}</PrimaryButton>
              <SecondaryButton onClick={() => setAblehnen(false)} disabled={laeuft}>Zurück zum Unterschreiben</SecondaryButton>
            </div>
          </Card>
        )}
        <DatenschutzHinweis />
      </div>
    </div>
  )
}
